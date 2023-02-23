import path from 'node:path'
import fs from 'node:fs'
import { resolve as _resolveExports } from 'resolve.exports'
import colors from 'picocolors'
import type { Plugin } from '../plugin'
import type { Alias } from 'dep-types/alias'
import {
  CLIENT_ENTRY,
  DEFAULT_EXTENSIONS,
  DEFAULT_MAIN_FIELDS,
  DEP_VERSION_RE,
  ENV_ENTRY,
  FS_PREFIX,
  OPTIMIZABLE_ENTRY_RE,
  SPECIAL_QUERY_RE,
} from '../constants'
import {
  DepsOptimizer,
  optimizedDepInfoFromFile,
  optimizedDepInfoFromId,
} from '../optimizer'
import {
  bareImportRE,
  cleanUrl,
  createDebugger,
  ensureVolumeInPath,
  fsPathFromId,
  getPotentialTsSrcPaths,
  injectQuery,
  isDataUrl,
  isExternalUrl,
  isFileReadable,
  isNonDriveRelativeAbsolutePath,
  isObject,
  isOptimizable,
  isPossibleTsOutput,
  isTsRequest,
  isWindows,
  lookupFile,
  nestedResolveFrom,
  normalizePath,
  resolveFrom,
} from '../utils'
import type { PartialResolvedId } from 'rollup'
import { loadPackageData, resolvePackageData } from '../packages'
import type { PackageData, PackageCache } from '../packages'

const debug = createDebugger('dpack:resolve-details')

const normalizedClientEntry = normalizePath(CLIENT_ENTRY)
const normalizedEnvEntry = normalizePath(ENV_ENTRY)

const nodeModulesInPathRE = /(?:^|\/)node_modules\//

// 用浏览器标记的路径的特殊ID：false
// https://github.com/defunctzombie/package-browser-field-spec#ignore-a-module
export const browserExternalId = '__dpack-browser-external'
// special id for packages that are optional peer deps
export const optionalPeerDepId = '__dpack-optional-peer-dep'

export interface ResolveOptions {
  mainFields?: string[]
  conditions?: string[]
  extensions?: string[]
  dedupe?: string[]
  preserveSymlinks?: boolean
  alias?: Alias[]
}

export interface InternalResolveOptions extends Required<ResolveOptions> {
  root: string
  isBuild: boolean
  isProduction: boolean
  packageCache?: PackageCache
  /**
   * src code mode also attempts the following:
   * - resolving /xxx as URLs
   * - resolving bare imports from optimized deps
   */
  asSrc?: boolean
  tryIndex?: boolean
  tryPrefix?: string
  skipPackageJson?: boolean
  preferRelative?: boolean
  isRequire?: boolean
  // when the importer is a ts module,
  // if the specifier requests a non-existent `.js/jsx/mjs/cjs` file,
  // should also try import from `.ts/tsx/mts/cts` source file as fallback.
  isFromTsImporter?: boolean
  tryEsmOnly?: boolean
  // True when resolving during the scan phase to discover dependencies
  scan?: boolean
  // Resolve using esbuild deps optimization
  getDepsOptimizer?: () => DepsOptimizer | undefined
  shouldExternalize?: (id: string) => boolean | undefined
}

export function resolvePlugin(resolveOptions: InternalResolveOptions): Plugin {
  const { root, isProduction, asSrc, preferRelative = false } = resolveOptions

  return {
    name: 'dpack:resolve',

    async resolveId(id, importer, resolveOpt) {
      // 我们需要将depsOptimizer延迟到这里，而不是将它作为一个选项
      // 传递给resolvePlugin，因为优化器是在开发过程中在服务器上创建的。
      const depsOptimizer = resolveOptions.getDepsOptimizer?.()

      // TODO: 清除
      if (id.startsWith(browserExternalId)) {
        return id
      }

      const targetWeb = true

      const isRequire: boolean =
        resolveOpt?.custom?.['node-resolve']?.isRequire ?? false

      const options: InternalResolveOptions = {
        isRequire,
        ...resolveOptions,
        scan: resolveOpt?.scan ?? resolveOptions.scan,
      }

      if (importer) {
        // const _importer = isWorkerRequest(importer) TODO: worker
        const _importer = importer
        if (
          isTsRequest(_importer) ||
          resolveOpt.custom?.depScan?.loader?.startsWith('ts')
        ) {
          options.isFromTsImporter = true
        } else {
          const moduleLang = this.getModuleInfo(_importer)?.meta?.dpack?.lang
          options.isFromTsImporter = moduleLang && isTsRequest(`.${moduleLang}`)
        }
      }

      let res: string | PartialResolvedId | undefined

      // 解析预先捆绑的deps请求，这些可以通过
      // tryFileResolve或/fs/解决，但如果我们正在重新处理deps，
      // 这些文件可能还不存在。
      if (asSrc && depsOptimizer?.isOptimizedDepUrl(id)) {
        const optimizedPath = id.startsWith(FS_PREFIX)
          ? fsPathFromId(id)
          : normalizePath(ensureVolumeInPath(path.resolve(root, id.slice(1))))
        return optimizedPath
      }

      const ensureVersionQuery = (resolved: string): string => {
        if (
          !options.isBuild &&
          depsOptimizer &&
          !(
            resolved === normalizedClientEntry ||
            resolved === normalizedEnvEntry
          )
        ) {
          // 确保直接导入node_modules的版本查询与通过裸导入导入的版本查询相同。
          // 使用原始ID进行检查，因为解析的ID可能是符号链接解决后的真实文件路径。
          const isNodeModule =
            nodeModulesInPathRE.test(normalizePath(id)) ||
            nodeModulesInPathRE.test(normalizePath(resolved))

          if (isNodeModule && !resolved.match(DEP_VERSION_RE)) {
            const versionHash = depsOptimizer.metadata.browserHash
            if (versionHash && isOptimizable(resolved)) {
              resolved = injectQuery(resolved, `v=${versionHash}`)
            }
          }
        }
        return resolved
      }

      // 以/@fs/*开头的明确fs路径
      if (asSrc && id.startsWith(FS_PREFIX)) {
        const fsPath = fsPathFromId(id)
        res = tryFsResolve(fsPath, options)
        debug(`[@fs] ${colors.cyan(id)} -> ${colors.dim(res)}`)
        // always return here even if res doesn't exist since /@fs/ is explicit
        // if the file doesn't exist it should be a 404
        return ensureVersionQuery(res || fsPath)
      }

      // URL
      // /foo -> /fs-root/foo
      if (asSrc && id.startsWith('/')) {
        const fsPath = path.resolve(root, id.slice(1))
        if ((res = tryFsResolve(fsPath, options))) {
          // isDebug && debug(`[url] ${colors.cyan(id)} -> ${colors.dim(res)}`)
          return ensureVersionQuery(res)
        }
      }

      // relative
      if (
        id.startsWith('.') ||
        ((preferRelative || importer?.endsWith('.html')) && /^\w/.test(id))
      ) {
        const basedir = importer ? path.dirname(importer) : process.cwd()
        const fsPath = path.resolve(basedir, id)

        const normalizedFsPath = normalizePath(fsPath)
        if (depsOptimizer?.isOptimizedDepFile(normalizedFsPath)) {
          // 优化后的文件在磁盘中尚不存在，解析为完整路径。
          // 如果路径中没有浏览器Hash版本，则注入当前的浏览器Hash版本
          if (!normalizedFsPath.match(DEP_VERSION_RE)) {
            const browserHash = optimizedDepInfoFromFile(
              depsOptimizer.metadata,
              normalizedFsPath,
            )?.browserHash
            if (browserHash) {
              return injectQuery(normalizedFsPath, `v=${browserHash}`)
            }
          }
          return normalizedFsPath
        }

        // if (
        //   targetWeb &&
        //   (res = tryResolveBrowserMapping(fsPath, importer, options, true))
        // ) {
        //   return res
        // }

        if ((res = tryFsResolve(fsPath, options))) {
          res = ensureVersionQuery(res)
          debug(`[relative] ${colors.cyan(id)} -> ${colors.dim(res)}`)

          const pkg = importer != null && idToPkgMap.get(importer)
          if (pkg) {
            idToPkgMap.set(res, pkg)
            return {
              id: res,
              moduleSideEffects: pkg.hasSideEffects(res),
            }
          }
          return res
        }
      }

      // drive relative fs paths (only windows)
      if (isWindows && id.startsWith('/')) {
        const basedir = importer ? path.dirname(importer) : process.cwd()
        const fsPath = path.resolve(basedir, id)
        if ((res = tryFsResolve(fsPath, options))) {
          debug(`[drive-relative] ${colors.cyan(id)} -> ${colors.dim(res)}`)
          return ensureVersionQuery(res)
        }
      }

      // absolute fs paths
      if (
        isNonDriveRelativeAbsolutePath(id) &&
        (res = tryFsResolve(id, options))
      ) {
        debug(`[fs] ${colors.cyan(id)} -> ${colors.dim(res)}`)
        return ensureVersionQuery(res)
      }

      // external
      if (isExternalUrl(id)) {
        return {
          id,
          external: true,
        }
      }

      // data uri: pass through (这只发生在构建过程中，将由专门的插件处理。)
      if (isDataUrl(id)) {
        return null
      }

      // 裸包导入，执行节点解析
      if (bareImportRE.test(id)) {
        const external = options.shouldExternalize?.(id)
        if (
          !external &&
          asSrc &&
          depsOptimizer &&
          !options.scan &&
          (res = await tryOptimizedResolve(depsOptimizer, id, importer))
        ) {
          return res
        }

        if (
          (res = tryNodeResolve(
            id,
            importer,
            options,
            targetWeb,
            depsOptimizer,
            external,
          ))
        ) {
          return res
        }
      }
    },
  }
}

function splitFileAndPostfix(path: string) {
  let file = path
  let postfix = ''

  let postfixIndex = path.indexOf('?')
  if (postfixIndex < 0) {
    postfixIndex = path.indexOf('#')
  }
  if (postfixIndex > 0) {
    file = path.slice(0, postfixIndex)
    postfix = path.slice(postfixIndex)
  }
  return { file, postfix }
}

function tryFsResolve(
  fsPath: string,
  options: InternalResolveOptions,
  tryIndex = true,
  targetWeb = true,
): string | undefined {
  const { file, postfix } = splitFileAndPostfix(fsPath)

  let res: string | undefined

  // 如果有一个后缀，先试着把它作为一个完整的路径进行解析
  if (
    postfix &&
    (res = tryResolveFile(
      fsPath,
      '',
      options,
      false,
      targetWeb,
      options.tryPrefix,
      options.skipPackageJson,
    ))
  ) {
    return res
  }

  if (
    (res = tryResolveFile(
      file,
      postfix,
      options,
      false,
      targetWeb,
      options.tryPrefix,
      options.skipPackageJson,
    ))
  ) {
    return res
  }

  for (const ext of options.extensions) {
    if (
      postfix &&
      (res = tryResolveFile(
        fsPath + ext,
        '',
        options,
        false,
        targetWeb,
        options.tryPrefix,
        options.skipPackageJson,
      ))
    ) {
      return res
    }

    if (
      (res = tryResolveFile(
        file + ext,
        postfix,
        options,
        false,
        targetWeb,
        options.tryPrefix,
        options.skipPackageJson,
      ))
    ) {
      return res
    }
  }

  if (
    postfix &&
    (res = tryResolveFile(
      fsPath,
      '',
      options,
      tryIndex,
      targetWeb,
      options.tryPrefix,
      options.skipPackageJson,
    ))
  ) {
    return res
  }

  if (
    (res = tryResolveFile(
      file,
      postfix,
      options,
      tryIndex,
      targetWeb,
      options.tryPrefix,
      options.skipPackageJson,
    ))
  ) {
    return res
  }
}

function tryResolveFile(
  file: string,
  postfix: string,
  options: InternalResolveOptions,
  tryIndex: boolean,
  targetWeb: boolean,
  tryPrefix?: string,
  skipPackageJson?: boolean,
): string | undefined {
  if (isFileReadable(file)) {
    if (!fs.statSync(file).isDirectory()) {
      return getRealPath(file, options.preserveSymlinks) + postfix
    } else if (tryIndex) {
      if (!skipPackageJson) {
        const pkgPath = file + '/package.json'
        try {
          // path points to a node package
          const pkg = loadPackageData(pkgPath, options.preserveSymlinks)
          const resolved = resolvePackageEntry(file, pkg, targetWeb, options)
          return resolved
        } catch (e) {
          if (e.code !== 'ENOENT') {
            throw e
          }
        }
      }
      const index = tryFsResolve(file + '/index', options)
      if (index) return index + postfix
    }
  }

  const tryTsExtension = options.isFromTsImporter && isPossibleTsOutput(file)
  if (tryTsExtension) {
    const tsSrcPaths = getPotentialTsSrcPaths(file)
    for (const srcPath of tsSrcPaths) {
      const res = tryResolveFile(
        srcPath,
        postfix,
        options,
        tryIndex,
        targetWeb,
        tryPrefix,
        skipPackageJson,
      )
      if (res) return res
    }
    return
  }

  if (tryPrefix) {
    const prefixed = `${path.dirname(file)}/${tryPrefix}${path.basename(file)}`
    return tryResolveFile(prefixed, postfix, options, tryIndex, targetWeb)
  }
}

export const idToPkgMap = new Map<string, PackageData>()

export function tryNodeResolve(
  id: string,
  importer: string | null | undefined,
  options: InternalResolveOptions,
  targetWeb: boolean,
  depsOptimizer?: DepsOptimizer,
  externalize?: boolean,
  allowLinkedExternal: boolean = true,
): PartialResolvedId | undefined {
  const { root, dedupe, isBuild, preserveSymlinks, packageCache } = options

  // 对于嵌套选择的包，通过最后的'>'来分割id，例如：
  // 'foo > bar > baz' => 'foo > bar' & 'baz'
  // 'foo'             => ''          & 'foo'
  const lastArrowIndex = id.lastIndexOf('>')
  const nestedRoot = id.substring(0, lastArrowIndex).trim()
  const nestedPath = id.substring(lastArrowIndex + 1).trim()

  const possiblePkgIds: string[] = []
  for (let prevSlashIndex = -1; ; ) {
    let slashIndex = nestedPath.indexOf('/', prevSlashIndex + 1)
    if (slashIndex < 0) {
      slashIndex = nestedPath.length
    }

    const part = nestedPath.slice(
      prevSlashIndex + 1,
      (prevSlashIndex = slashIndex),
    )
    if (!part) {
      break
    }

    if (possiblePkgIds.length ? path.extname(part) : part[0] === '@') {
      continue
    }

    const possiblePkgId = nestedPath.slice(0, slashIndex)
    possiblePkgIds.push(possiblePkgId)
  }

  let basedir: string
  if (dedupe?.some((id) => possiblePkgIds.includes(id))) {
    basedir = root
  } else if (
    importer &&
    path.isAbsolute(importer) &&
    fs.existsSync(cleanUrl(importer))
  ) {
    basedir = path.dirname(importer)
  } else {
    basedir = root
  }

  // 嵌套节点模块，逐步解析到nestedPath的basedir
  if (nestedRoot) {
    basedir = nestedResolveFrom(nestedRoot, basedir, preserveSymlinks)
  }

  // nearest package.json
  let nearestPkg: PackageData | undefined
  // nearest package.json that may have the `exports` field
  let pkg: PackageData | undefined

  let pkgId = possiblePkgIds.reverse().find((pkgId) => {
    nearestPkg = resolvePackageData(
      pkgId,
      basedir,
      preserveSymlinks,
      packageCache,
    )!
    return nearestPkg
  })!

  const rootPkgId = possiblePkgIds[0]
  const rootPkg = resolvePackageData(
    rootPkgId,
    basedir,
    preserveSymlinks,
    packageCache,
  )!
  if (rootPkg?.data?.exports) {
    pkg = rootPkg
    pkgId = rootPkgId
  } else {
    pkg = nearestPkg
  }

  if (!pkg || !nearestPkg) {
    // 如果找不到import，则检查它是否是一个可选的同级dep。
    // 如果是这样，我们可以解析为一个特殊的ID，只在导入时出错。
    if (
      basedir !== root && // root has no peer dep
      // !isBuiltin(nestedPath) &&
      !nestedPath.includes('\0') &&
      bareImportRE.test(nestedPath)
    ) {
      // find package.json with `name` as main
      const mainPackageJson = lookupFile(basedir, ['package.json'], {
        predicate: (content) => !!JSON.parse(content).name,
      })
      if (mainPackageJson) {
        const mainPkg = JSON.parse(mainPackageJson)
        if (
          mainPkg.peerDependencies?.[nestedPath] &&
          mainPkg.peerDependenciesMeta?.[nestedPath]?.optional
        ) {
          return {
            id: `${optionalPeerDepId}:${nestedPath}:${mainPkg.name}`,
          }
        }
      }
    }
    return
  }

  let resolveId = resolvePackageEntry
  let unresolvedId = pkgId
  // const isDeepImport = unresolvedId !== nestedPath
  // if (isDeepImport) {
  //   resolveId = resolveDeepImport
  //   unresolvedId = '.' + nestedPath.slice(pkgId.length)
  // }

  let resolved: string | undefined
  try {
    resolved = resolveId(unresolvedId, pkg, targetWeb, options)
  } catch (err) {
    if (!options.tryEsmOnly) {
      throw err
    }
  }
  if (!resolved && options.tryEsmOnly) {
    resolved = resolveId(unresolvedId, pkg, targetWeb, {
      ...options,
      isRequire: false,
      mainFields: DEFAULT_MAIN_FIELDS,
      extensions: DEFAULT_EXTENSIONS,
    })
  }
  if (!resolved) {
    return
  }

  const processResult = (resolved: PartialResolvedId) => {
    if (!externalize) {
      return resolved
    }
    // don't external symlink packages
    if (!allowLinkedExternal && !resolved.id.includes('node_modules')) {
      return resolved
    }
    const resolvedExt = path.extname(resolved.id)
    // don't external non-js imports
    if (
      resolvedExt &&
      resolvedExt !== '.js' &&
      resolvedExt !== '.mjs' &&
      resolvedExt !== '.cjs'
    ) {
      return resolved
    }
    let resolvedId = id
    // if (isDeepImport) {
    //   if (!pkg?.data.exports && path.extname(id) !== resolvedExt) {
    //     resolvedId = resolved.id.slice(resolved.id.indexOf(id))
    //   }
    // }
    return { ...resolved, id: resolvedId, external: true }
  }

  // link id to pkg for browser field mapping check
  idToPkgMap.set(resolved, pkg)
  if ((isBuild && !depsOptimizer) || externalize) {
    // Resolve package side effects for build so that rollup can better
    // perform tree-shaking
    return processResult({
      id: resolved,
      moduleSideEffects: pkg.hasSideEffects(resolved),
    })
  }

  const ext = path.extname(resolved)
  const isCJS =
    ext === '.cjs' || (ext === '.js' && nearestPkg.data.type !== 'module')

  if (
    !resolved.includes('node_modules') || // linked
    !depsOptimizer || // resolving before listening to the server
    options.scan // initial esbuild scan phase
  ) {
    return { id: resolved }
  }

  // 如果我们到达这里，它是一个有效的、没有被优化的dep进口。
  const isJsType = OPTIMIZABLE_ENTRY_RE.test(resolved)

  let exclude = depsOptimizer?.options.exclude
  let include = depsOptimizer?.options.include

  const skipOptimization =
    !isJsType ||
    importer?.includes('node_modules') ||
    exclude?.includes(pkgId) ||
    exclude?.includes(nestedPath) ||
    SPECIAL_QUERY_RE.test(resolved)

  if (skipOptimization) {
    // excluded from optimization
    // Inject a version query to npm deps so that the browser
    // can cache it without re-validation, but only do so for known js types.
    // otherwise we may introduce duplicated modules for externalized files
    // from pre-bundled deps.
    if (!isBuild) {
      const versionHash = depsOptimizer!.metadata.browserHash
      if (versionHash && isJsType) {
        resolved = injectQuery(resolved, `v=${versionHash}`)
      }
    }
  } else {
    // this is a missing import, queue optimize-deps re-run and
    // get a resolved its optimized info
    const optimizedInfo = depsOptimizer!.registerMissingImport(id, resolved)
    resolved = depsOptimizer!.getOptimizedDepId(optimizedInfo)
  }

  if (isBuild) {
    // 为构建解决软件包的副作用，以便rollup能够更好地执行tree-shaking。
    return {
      id: resolved,
      moduleSideEffects: pkg.hasSideEffects(resolved),
    }
  } else {
    return { id: resolved! }
  }
}

export async function tryOptimizedResolve(
  depsOptimizer: DepsOptimizer,
  id: string,
  importer?: string,
): Promise<string | undefined> {
  await depsOptimizer.scanProcessing

  const metadata = depsOptimizer.metadata

  const depInfo = optimizedDepInfoFromId(metadata, id)
  if (depInfo) {
    return depsOptimizer.getOptimizedDepId(depInfo)
  }

  if (!importer) return

  // 进一步检查id是否被嵌套的依赖关系所导入
  let resolvedSrc: string | undefined

  for (const optimizedData of metadata.depInfoList) {
    if (!optimizedData.src) continue // Ignore chunks

    const pkgPath = optimizedData.id
    // 检查情况, e.g.
    //   pkgPath  => "my-lib > foo"
    //   id       => "foo"
    // 这就缩小了进行全面解析的需要。
    if (!pkgPath.endsWith(id)) continue

    // 懒初始化ResolvedSrc
    if (resolvedSrc == null) {
      try {
        resolvedSrc = normalizePath(resolveFrom(id, path.dirname(importer)))
      } catch {
        break
      }
    }

    // 通过src匹配，正确识别id是否属于嵌套的依赖关系
    if (optimizedData.src === resolvedSrc) {
      return depsOptimizer.getOptimizedDepId(optimizedData)
    }
  }
}

export function resolvePackageEntry(
  id: string,
  { dir, data, setResolvedCache, getResolvedCache }: PackageData,
  targetWeb: boolean,
  options: InternalResolveOptions,
): string | undefined {
  const cached = getResolvedCache('.', targetWeb)
  if (cached) {
    return cached
  }
  try {
    let entryPoint: string | undefined | void

    // 以最高优先级解析 exports
    // using https://github.com/lukeed/resolve.exports
    if (data.exports) {
      entryPoint = resolveExports(data, '.', options, targetWeb)
    }

    // 如果出口被解析为.mjs，仍需解析其他字段。
    // 这是因为.mjs文件在技术上可以导入.cjs文件，这将使它们对纯ESM环境无效--

    if (!entryPoint || entryPoint.endsWith('.mjs')) {
      for (const field of options.mainFields) {
        if (field === 'browser') continue // already checked above
        if (typeof data[field] === 'string') {
          entryPoint = data[field]
          break
        }
      }
    }
    entryPoint ||= data.main

    // 当入口未被定义时，尝试默认入口
    // https://nodejs.org/api/modules.html#all-together
    const entryPoints = entryPoint
      ? [entryPoint]
      : ['index.js', 'index.json', 'index.node']

    for (let entry of entryPoints) {
      // make sure we don't get scripts when looking for sass
      if (
        options.mainFields[0] === 'sass' &&
        !options.extensions.includes(path.extname(entry))
      ) {
        entry = ''
        options.skipPackageJson = true
      }

      // resolve object browser field in package.json
      // const { browser: browserField } = data
      // if (targetWeb && options.mainFields && isObject(browserField)) {
      //   entry = mapWithBrowserField(entry, browserField) || entry
      // }

      const entryPointPath = path.join(dir, entry)
      const resolvedEntryPoint = tryFsResolve(entryPointPath, options)
      if (resolvedEntryPoint) {
        setResolvedCache('.', resolvedEntryPoint, targetWeb)
        return resolvedEntryPoint
      }
    }
  } catch (e) {
    packageEntryFailure(id, e.message)
  }
  packageEntryFailure(id)
}

function packageEntryFailure(id: string, details?: string) {
  throw new Error(
    `Failed to resolve entry for package "${id}". ` +
      `The package may have incorrect main/module/exports specified in its package.json` +
      (details ? ': ' + details : '.'),
  )
}

const conditionalConditions = new Set(['production', 'development', 'module'])

function resolveExports(
  pkg: PackageData['data'],
  key: string,
  options: InternalResolveOptions,
  targetWeb: boolean,
) {
  const overrideConditions = void 0

  const conditions = []
  if (options.isProduction) {
    conditions.push('production')
  }
  if (!options.isProduction) {
    conditions.push('development')
  }
  if (!options.isRequire) {
    conditions.push('module')
  }
  if (options.conditions.length > 0) {
    conditions.push(...options.conditions)
  }

  return _resolveExports(pkg, key, {
    browser: targetWeb && !conditions.includes('node'),
    require: options.isRequire && !conditions.includes('import'),
    conditions,
  })
}

// function resolveDeepImport(
//   id: string,
//   {
//     webResolvedImports,
//     setResolvedCache,
//     getResolvedCache,
//     dir,
//     data,
//   }: PackageData,
//   targetWeb: boolean,
//   options: InternalResolveOptions,
// ): string | undefined {
//   const cache = getResolvedCache(id, targetWeb)
//   if (cache) {
//     return cache
//   }

//   let relativeId: string | undefined | void = id
//   const { exports: exportsField, browser: browserField } = data

//   // map relative based on exports data
//   if (exportsField) {
//     if (isObject(exportsField) && !Array.isArray(exportsField)) {
//       // resolve without postfix (see #7098)
//       const { file, postfix } = splitFileAndPostfix(relativeId)
//       const exportsId = resolveExports(data, file, options, targetWeb)
//       if (exportsId !== undefined) {
//         relativeId = exportsId + postfix
//       } else {
//         relativeId = undefined
//       }
//     } else {
//       // not exposed
//       relativeId = undefined
//     }
//     if (!relativeId) {
//       throw new Error(
//         `Package subpath '${relativeId}' is not defined by "exports" in ` +
//           `${path.join(dir, 'package.json')}.`,
//       )
//     }
//   } else if (targetWeb && options.mainFields && isObject(browserField)) {
//     // resolve without postfix (see #7098)
//     const { file, postfix } = splitFileAndPostfix(relativeId)
//     const mapped = mapWithBrowserField(file, browserField)
//     if (mapped) {
//       relativeId = mapped + postfix
//     } else if (mapped === false) {
//       return (webResolvedImports[id] = browserExternalId)
//     }
//   }

//   if (relativeId) {
//     const resolved = tryFsResolve(
//       path.join(dir, relativeId),
//       options,
//       !exportsField, // try index only if no exports field
//       targetWeb,
//     )
//     if (resolved) {
//       // isDebug &&
//       //   debug(
//       //     `[node/deep-import] ${colors.cyan(id)} -> ${colors.dim(resolved)}`,
//       //   )
//       setResolvedCache(id, resolved, targetWeb)
//       return resolved
//     }
//   }
// }

function getRealPath(resolved: string, preserveSymlinks?: boolean): string {
  resolved = ensureVolumeInPath(resolved)
  if (!preserveSymlinks && browserExternalId !== resolved) {
    resolved = fs.realpathSync(resolved)
  }
  return normalizePath(resolved)
}
