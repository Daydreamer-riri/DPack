import path from 'node:path'
import fs from 'node:fs'
import { performance } from 'node:perf_hooks'
import { init, parse as parseImports } from 'es-module-lexer'
import type { ExportSpecifier, ImportSpecifier } from 'es-module-lexer'
import { parse as parseJS } from 'acorn'
import MagicString from 'magic-string'
import colors from 'picocolors'
import type { Node } from 'estree'
import { makeLegalIdentifier } from '@rollup/pluginutils'
import { getDepOptimizationConfig, ResolvedConfig } from '../config'
import type { Plugin } from '../plugin'
import type { DpackDevServer } from '../server'
import {
  cleanUrl,
  createDebugger,
  fsPathFromId,
  injectQuery,
  isDataUrl,
  isExternalUrl,
  isJSRequest,
  joinUrlSegments,
  moduleListContains,
  normalizePath,
  prettifyUrl,
  removeImportQuery,
  stripBase,
  stripBomTag,
  unwrapId,
  wrapId,
  transformStableResult,
} from '../utils'
import { isCSSRequest, isDirectCSSRequest } from './css'
import {
  CLIENT_DIR,
  CLIENT_PUBLIC_PATH,
  DEP_VERSION_RE,
  FS_PREFIX,
} from '../constants'
import { getDepsOptimizer, optimizedDepNeedsInterop } from '../optimizer'
import { getDepsCacheDirPrefix } from '../optimizer'
import { browserExternalId } from './resolve'
import { transformRequest } from '../server/transformRequest'
import { ERR_OUTDATED_OPTIMIZED_DEP } from './optimizedDeps'

const isDebug = !!process.env.DEBUG
const debug = createDebugger('dpack:import-analysis')

const clientDir = normalizePath(CLIENT_DIR)

const skipRE = /\.(?:map|json)(?:$|\?)/
export const canSkipImportAnalysis = (id: string): boolean =>
  skipRE.test(id) || isDirectCSSRequest(id)

const optimizedDepChunkRE = /\/chunk-[A-Z\d]{8}\.js/
const optimizedDepDynamicRE = /-[A-Z\d]{8}\.js/

export function isExplicitImportRequired(url: string): boolean {
  return !isJSRequest(cleanUrl(url)) && !isCSSRequest(url)
}

function markExplicitImport(url: string) {
  if (isExplicitImportRequired(url)) {
    return injectQuery(url, 'import')
  }
  return url
}
/**
 * 仅供服务器使用的插件，用于词法、解析、重写和分析url导入。
 *
 * - 解决入口问题，以确保它们在磁盘上存在。
 *
 * - Lexes HMR接受调用并更新模块图中的入口关系
 *
 * - 裸模块导入被解析为（由@rollup-plugin/node-resolve）绝对文件路径, e.g.
 *
 *     ```js
 *     import 'foo'
 *     ```
 *     is rewritten to
 *     ```js
 *     import '/@fs//project/node_modules/foo/dist/foo.js'
 *     ```
 *
 * - CSS导入以`.js`为后缀，因为js模块和实际的css（通过`<link>`引用）都可以通过转换管道。:
 *
 *     ```js
 *     import './style.css'
 *     ```
 *     is rewritten to
 *     ```js
 *     import './style.css.js'
 *     ```
 */

export function importAnalysisPlugin(config: ResolvedConfig): Plugin {
  const { root, base } = config
  const clientPublicPath = path.posix.join(base, CLIENT_PUBLIC_PATH)
  let server: DpackDevServer

  return {
    name: 'dpack:import-analysis',

    configureServer(_server) {
      server = _server
    },

    async transform(source, importer) {
      if (!server) {
        return null
      }

      const prettyImporter = prettifyUrl(importer, root)

      if (canSkipImportAnalysis(importer)) {
        isDebug && debug(colors.dim(`[skipped] ${prettyImporter}`))
        return null
      }

      const start = performance.now()
      await init
      let imports!: readonly ImportSpecifier[]
      let exports!: readonly ExportSpecifier[]
      source = stripBomTag(source)
      try {
        ;[imports, exports] = parseImports(source)
      } catch (e: any) {
        this.error(
          `由于内容包含无效的JS语法，为导入分析解析源时失败了。` + e?.idx,
        )
      }

      const depsOptimizer = getDepsOptimizer(config)

      const { moduleGraph } = server

      const importerModule = moduleGraph.getModuleById(importer)!
      if (!importerModule && depsOptimizer?.isOptimizedDepFile(importer)) {
        // TODO: 优化相关逻辑
        // Ids of optimized deps could be invalidated and removed from the graph
        // Return without transforming, this request is no longer valid, a full reload
        // is going to request this id again. Throwing an outdated error so we
        // properly finish the request with a 504 sent to the browser.
        // throwOutdatedRequest(importer)
      }

      if (!imports.length && !(this as any)._addedImports) {
        importerModule.isSelfAccepting = false
        isDebug && debug(`${colors.dim(`[no imports] ${prettyImporter}`)}`)
        return source
      }

      let hasHMR = false
      let isSelfAccepting = false
      let hasEnv = false
      let needQueryInjectHelper = false
      let s: MagicString | undefined
      const str = () => s || (s = new MagicString(source))
      const importedUrls = new Set<string>()
      const staticImportedUrls = new Set<{ url: string; id: string }>()
      const acceptedUrls = new Set<{
        url: string
        start: number
        end: number
      }>()
      let isPartiallySelfAccepting = false
      const acceptedExports = new Set<string>()
      const importedBindings = null
      const toAbsoluteUrl = (url: string) =>
        path.posix.resolve(path.posix.dirname(importerModule.url), url)

      const normalizeUrl = async (
        url: string,
        pos: number,
        forceSkipImportAnalysis: boolean = false,
      ): Promise<[string, string]> => {
        url = stripBase(url, base)

        let importerFile = importer

        const opimizeDeps = getDepOptimizationConfig(config)
        // if (moduleListContains(opimizeDeps.exclude, url)) {
        //   if (depsOptimizer) {
        //     await depsOptimizer.scanProcessing

        //     // if the dependency encountered in the optimized file was excluded from the optimization
        //     // the dependency needs to be resolved starting from the original source location of the optimized file
        //     // because starting from node_modules/.Dpack will not find the dependency if it was not hoisted
        //     // (that is, if it is under node_modules directory in the package source of the optimized file)
        //     for (const optimizedModule of depsOptimizer.metadata.depInfoList) {
        //       if (!optimizedModule.src) continue // Ignore chunks
        //       if (optimizedModule.file === importerModule.file) {
        //         importerFile = optimizedModule.src
        //       }
        //     }
        //   }
        // }

        const resolved = await this.resolve(url, importerFile)

        if (!resolved) {
          importerModule.isSelfAccepting = false
          return this.error(
            `解析失败 import "${url}" from "${path.relative(
              process.cwd(),
              importerFile,
            )}", 请确认文件存在。`,
            pos,
          )
        }

        const isRelative = url.startsWith('.')
        const isSelfImport = !isRelative && cleanUrl(url) === cleanUrl(importer)
        // 将所有导入的数据规范化为已解析的URL
        // e.g. `import 'foo'` -> `import '/@fs/.../node_modules/foo/index.js'`
        if (resolved.id.startsWith(root + '/')) {
          url = resolved.id.slice(root.length)
        } else if (
          resolved.id.startsWith(getDepsCacheDirPrefix(config)) ||
          fs.existsSync(cleanUrl(resolved.id))
        ) {
          // 文件系统中可能还不存在一个优化的deps，或
          // 一个普通的文件存在，但不在根目录下：重写为绝对的/@fs/路径
          url = path.join(FS_PREFIX, resolved.id)
        } else {
          url = resolved.id
        }

        if (isExternalUrl(url)) {
          return [url, url]
        }

        // 如果解析的id不是一个有效的浏览器导入指定符，
        // 则将其前缀化，使其有效。在将其送回转换管道
        // 之前，我们将对其进行剥离
        if (!url.startsWith('.') && !url.startsWith('/')) {
          url = wrapId(resolved.id)
        }

        url = markExplicitImport(url)

        if (
          (isRelative || isSelfImport) &&
          !/[?&]import=?\b/.test(url) &&
          !url.match(DEP_VERSION_RE)
        ) {
          const versionMatch = importer.match(DEP_VERSION_RE)
          if (versionMatch) {
            url = injectQuery(url, versionMatch[1])
          }
        }

        // 检查该模块是否已经过hmr更新。
        // 如果是，我们需要附上最后更新的时间戳，
        // 以迫使浏览器获取该模块的最新版本。
        try {
          const depModule = await moduleGraph.ensureEntryFromUrl(
            unwrapId(url),
            canSkipImportAnalysis(url) || forceSkipImportAnalysis,
          )
          if (depModule.lastHMRTimestamp > 0) {
            url = injectQuery(url, `t=${depModule.lastHMRTimestamp}`)
          }
        } catch (e) {
          throw e
        }

        url = joinUrlSegments(base, url)

        return [url, resolved.id]
      }

      for (let index = 0; index < imports.length; index++) {
        const {
          s: start,
          e: end,
          ss: expStart,
          se: expEnd,
          d: dynamicIndex,
          n: specifier,
          a: assertIndex,
        } = imports[index]

        const rawUrl = source.slice(start, end)

        // check import.meta usage TODO:ia hmr
        // if (rawUrl === 'import.meta') {
        //   const prop = source.slice(end, end + 4)
        //   if (prop === '.hot') {
        //     hasHMR = true
        //     if (source.slice(end + 4, end + 11) === '.accept') {
        //       // further analyze accepted modules
        //       if (source.slice(end + 4, end + 18) === '.acceptExports') {
        //         lexAcceptedHmrExports(
        //           source,
        //           source.indexOf('(', end + 18) + 1,
        //           acceptedExports,
        //         )
        //         isPartiallySelfAccepting = true
        //       } else if (
        //         lexAcceptedHmrDeps(
        //           source,
        //           source.indexOf('(', end + 11) + 1,
        //           acceptedUrls,
        //         )
        //       ) {
        //         isSelfAccepting = true
        //       }
        //     }
        //   } else if (prop === '.env') {
        //     hasEnv = true
        //   }
        //   continue
        // }

        const isDynamicImport = dynamicIndex > -1

        if (!isDynamicImport && assertIndex > -1) {
          str().remove(end + 1, expEnd)
        }

        if (specifier) {
          if (isExternalUrl(specifier) || isDataUrl(specifier)) {
            continue
          }

          if (specifier === clientPublicPath) {
            continue
          }

          // warn imports to non-asset /public files
          if (specifier.startsWith('/') && !specifier.endsWith('.json')) {
            throw new Error(
              `Cannot import non-asset file ${specifier} which is inside /public.` +
                `JS/CSS files inside /public are copied as-is on build and ` +
                `can only be referenced via <script src> or <link href> in html.`,
            )
          }

          const [url, resolvedId] = await normalizeUrl(specifier, start)

          server?.moduleGraph.selfModulesPath.add(fsPathFromId(url))

          if (url !== specifier) {
            let rewriteDone = false
            if (
              depsOptimizer?.isOptimizedDepFile(resolvedId) &&
              !resolvedId.match(optimizedDepChunkRE)
            ) {
              // 对于优化的cjs仓库，通过将命名的导入改写为const分配来支持命名的导入。
              // 内部优化块不需要ES互操作，因此被排除在外。

              // resolvedId中的browserHash可能是过时的，在这种情况下，会有一个完整的页面重新加载。
              // 在这种情况下，我们可以返回一个404，但返回请求是安全的
              const file = cleanUrl(resolvedId)
              const needsInterop = await optimizedDepNeedsInterop(
                depsOptimizer.metadata,
                file,
                config,
              )

              if (needsInterop === undefined) {
              } else if (needsInterop) {
                config.logger.info(colors.black(`${url} needs interop`))
                interopNamedImports(str(), imports[index], url, index)
                rewriteDone = true
              }
            }
            // 如果源代码通过命名的导入导入内建模块，存根代理导出会失败，
            // 因为它是`默认导出`。为内置模块应用互操作，以正确抛出错误信息。
            else if (
              url.includes(browserExternalId) &&
              source.slice(expStart, start).includes('{')
            ) {
              interopNamedImports(str(), imports[index], url, index)
              rewriteDone = true
            }
            if (!rewriteDone) {
              let rewrittenUrl = JSON.stringify(url)
              if (!isDynamicImport) rewrittenUrl = rewrittenUrl.slice(1, -1)
              str().overwrite(start, end, rewrittenUrl, { contentOnly: true })
            }
          }

          // TODO:HMR
          const hmrUrl = unwrapId(stripBase(url, base))
          importedUrls.add(hmrUrl)

          if (!isDynamicImport) {
            staticImportedUrls.add({ url: hmrUrl, id: resolvedId })
          }
        } else if (!importer.startsWith(clientDir)) {
          // TODO:
          if (!importer.includes('node_modules')) {
          }
        }
      }

      if (hasHMR) {
        // TODO: HMR
      }

      if (needQueryInjectHelper) {
        str().prepend(
          `import { injectQuery as __dpack__injectQuery } from "${clientPublicPath}";`,
        )
      }

      const normalizedAcceptedUrls = new Set<string>()
      for (const { url, start, end } of acceptedUrls) {
        const [normalized] = await moduleGraph.resolveUrl(
          toAbsoluteUrl(markExplicitImport(url)),
        )
        normalizedAcceptedUrls.add(normalized)
        str().overwrite(start, end, JSON.stringify(normalized), {
          contentOnly: true,
        })
      }

      // 更新用于HMR分析的模块图。
      if (!isCSSRequest(importer)) {
        // TODO:HMR
      }

      config.logger.info(
        `${colors.dim(
          `[${importedUrls.size} imports rewritten] ${prettyImporter}`,
        )}`,
      )

      if (config.server.preTransformRequests && staticImportedUrls.size) {
        staticImportedUrls.forEach(({ url }) => {
          url = removeImportQuery(url)
          transformRequest(url, server).catch((e) => {
            if (e?.code === ERR_OUTDATED_OPTIMIZED_DEP) {
              // This are expected errors
              return
            }
            // 意外的错误，记录该问题，但要避免出现未处理的异常
            config.logger.error(e.message)
          })
        })
      }

      if (s) {
        return transformStableResult(s, importer, config)
      } else {
        return source
      }
    },
  }
}

export function interopNamedImports(
  str: MagicString,
  importSpecifier: ImportSpecifier,
  rewrittenUrl: string,
  importIndex: number,
): void {
  const source = str.original
  const {
    s: start,
    e: end,
    ss: expStart,
    se: expEnd,
    d: dynamicIndex,
  } = importSpecifier
  if (dynamicIndex > -1) {
    // rewrite `import('package')` to expose the default directly
    str.overwrite(
      expStart,
      expEnd,
      `import('${rewrittenUrl}').then(m => m.default && m.default.__esModule ? m.default : ({ ...m.default, default: m.default }))`,
      { contentOnly: true },
    )
  } else {
    const exp = source.slice(expStart, expEnd)
    const rawUrl = source.slice(start, end)
    const rewritten = transformCjsImport(exp, rewrittenUrl, rawUrl, importIndex)
    if (rewritten) {
      str.overwrite(expStart, expEnd, rewritten, { contentOnly: true })
    } else {
      //  export * from '...'
      str.overwrite(start, end, rewrittenUrl, { contentOnly: true })
    }
  }
}

type ImportNameSpecifier = { importedName: string; localName: string }

/** TODO:cjs转换
 * Detect import statements to a known optimized CJS dependency and provide
 * ES named imports interop. We do this by rewriting named imports to a variable
 * assignment to the corresponding property on the `module.exports` of the cjs
 * module. Note this doesn't support dynamic re-assignments from within the cjs
 * module.
 *
 * Note that es-module-lexer treats `export * from '...'` as an import as well,
 * so, we may encounter ExportAllDeclaration here, in which case `undefined`
 * will be returned.
 */
export function transformCjsImport(
  importExp: string,
  url: string,
  rawUrl: string,
  importIndex: number,
): string | undefined {
  const node = (
    parseJS(importExp, {
      ecmaVersion: 'latest',
      sourceType: 'module',
    }) as any
  ).body[0] as Node

  if (
    node.type === 'ImportDeclaration' ||
    node.type === 'ExportNamedDeclaration'
  ) {
    if (!node.specifiers.length) {
      return `import "${url}"`
    }

    const importNames: ImportNameSpecifier[] = []
    const exportNames: string[] = []
    let defaultExports: string = ''
    for (const spec of node.specifiers) {
      if (
        spec.type === 'ImportSpecifier' &&
        spec.imported.type === 'Identifier'
      ) {
        const importedName = spec.imported.name
        const localName = spec.local.name
        importNames.push({ importedName, localName })
      } else if (spec.type === 'ImportDefaultSpecifier') {
        importNames.push({
          importedName: 'default',
          localName: spec.local.name,
        })
      } else if (spec.type === 'ImportNamespaceSpecifier') {
        importNames.push({ importedName: '*', localName: spec.local.name })
      } else if (
        spec.type === 'ExportSpecifier' &&
        spec.exported.type === 'Identifier'
      ) {
        // for ExportSpecifier, local name is same as imported name
        // prefix the variable name to avoid clashing with other local variables
        const importedName = spec.local.name
        // we want to specify exported name as variable and re-export it
        const exportedName = spec.exported.name
        if (exportedName === 'default') {
          defaultExports = makeLegalIdentifier(
            `__dpack__cjsExportDefault_${importIndex}`,
          )
          importNames.push({ importedName, localName: defaultExports })
        } else {
          const localName = makeLegalIdentifier(
            `__dpack__cjsExport_${exportedName}`,
          )
          importNames.push({ importedName, localName })
          exportNames.push(`${localName} as ${exportedName}`)
        }
      }
    }

    // If there is multiple import for same id in one file,
    // importIndex will prevent the cjsModuleName to be duplicate
    const cjsModuleName = makeLegalIdentifier(
      `__dpack__cjsImport${importIndex}_${rawUrl}`,
    )
    const lines: string[] = [`import ${cjsModuleName} from "${url}"`]
    importNames.forEach(({ importedName, localName }) => {
      if (importedName === '*') {
        lines.push(`const ${localName} = ${cjsModuleName}`)
      } else if (importedName === 'default') {
        lines.push(
          `const ${localName} = ${cjsModuleName}.__esModule ? ${cjsModuleName}.default : ${cjsModuleName}`,
        )
      } else {
        lines.push(`const ${localName} = ${cjsModuleName}["${importedName}"]`)
      }
    })
    if (defaultExports) {
      lines.push(`export default ${defaultExports}`)
    }
    if (exportNames.length) {
      lines.push(`export { ${exportNames.join(', ')} }`)
    }

    return lines.join('; ')
  }
}
