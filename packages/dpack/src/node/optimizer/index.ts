// simple-vite/vit/index.js
import fs from 'node:fs'
import path from 'node:path'
import esbuild from 'esbuild'
import { init, parse } from 'es-module-lexer'
import type { BuildOptions as EsbuildBuildOptions } from 'esbuild'
import { build } from 'esbuild'
import colors from 'picocolors'
import { searchForPackageRoot } from '../server/searchRoot'
import { getDepOptimizationConfig, ResolvedConfig } from '../config'
import {
  createDebugger,
  emptyDir,
  flattenId,
  getHash,
  lookupFile,
  normalizePath,
} from '../utils'
export { initDepsOptimizer, getDepsOptimizer } from './opimizer'

export const debuggerDpackDeps = createDebugger('dpack:deps')
const debug = debuggerDpackDeps

export type ExportsData = {
  hasImports: boolean
  // 导出名称（对于`export { a as b }`，`b`是导出的名称）。
  exports: readonly string[]
  facade: boolean
  // es-module-lexer有一个facade检测，但对于我们的用例来说，当模块有默认出口时，并不总是准确的。
  hasReExports?: boolean
  // 如果dep需要以jsx形式加载，则提示。
  jsxLoader?: boolean
}

export interface DepsOptimizer {
  metadata: DepOptimizationMetadata
  scanProcessing?: Promise<void>
  registerMissingImport: (id: string, resolved: string) => OptimizedDepInfo
  run: () => void

  isOptimizedDepFile: (id: string) => boolean
  isOptimizedDepUrl: (url: string) => boolean
  getOptimizedDepId: (depInfo: OptimizedDepInfo) => string
  delayDepsOptimizerUntil: (id: string, done: () => Promise<any>) => void
  registerWorkersSource: (id: string) => void
  resetRegisteredIds: () => void
  ensureFirstRun: () => void

  close: () => Promise<void>

  options: DepOptimizationOptions
}

export interface DepOptimizationProcessing {
  promise: Promise<void>
  resolve: () => void
}
export interface OptimizedDepInfo {
  id: string
  file: string
  src?: string
  needsInterop?: boolean
  browserHash?: string
  fileHash?: string
  /**
   * 在优化过程中，ID仍然可以被解析到它们的最终位置，但捆绑物可能还没有被保存到磁盘上。
   */
  processing?: Promise<void>
  /**
   * ExportData缓存，被发现的deps将解析src条目以获得出口数据，用于定义是否需要互操作以及预捆绑时。
   */
  exportsData?: Promise<ExportsData>
}

export interface DepOptimizationMetadata {
  /**
   * 主要的哈希值是由用户配置和依赖性锁定文件决定的。
   * 这在服务器启动时被检查，以避免不必要的重新捆绑。
   */
  hash: string
  /**
   * 浏览器哈希值是由主哈希值加上运行时发现的额外依赖关系决定的。
   * 这被用来使浏览器对优化部署的请求无效。
   */
  browserHash: string
  /**
   * 每个已经优化的依赖关系的元数据
   */
  optimized: Record<string, OptimizedDepInfo>
  /**
   * 非入口优化chunks和动态导入的元数据
   */
  chunks: Record<string, OptimizedDepInfo>
  /**
   * 处理后每个新发现的依赖关系的元数据
   */
  discovered: Record<string, OptimizedDepInfo>
  /**
   * 优化的DepInfo列表
   */
  depInfoList: OptimizedDepInfo[]
}

export interface DepOptimizationConfig {
  /**
   * 强制优化列出的依赖关系（必须是可解析的导入路径，不能是globs）。
   */
  include?: string[]
  /**
   * 排除优化这些依赖关系（必须是可解析的导入路径，不能是globs）。
   */
  exclude?: string[]
  /**
   * Options to pass to esbuild during the dep scanning and optimization
   *
   * Certain options are omitted since changing them would not be compatible
   * with Vite's dep optimization.
   *
   * - `external` is also omitted, use Vite's `optimizeDeps.exclude` option
   * - `plugins` are merged with Vite's dep plugin
   *
   * https://esbuild.github.io/api
   */
  esbuildOptions?: Omit<
    EsbuildBuildOptions,
    | 'bundle'
    | 'entryPoints'
    | 'external'
    | 'write'
    | 'watch'
    | 'outdir'
    | 'outfile'
    | 'outbase'
    | 'outExtension'
    | 'metafile'
  >
  disabled?: boolean | 'build' | 'dev'
}

export type DepOptimizationOptions = DepOptimizationConfig

export interface DepOptimizationResult {
  metadata: DepOptimizationMetadata
  /**
   * 当重新运行时，如果有新发现的依赖关系，
   * 页面重载将被推迟到下一次重新运行，
   * 所以我们需要能够丢弃这个结果。
   */
  commit: () => Promise<void>
  cancel: () => void
}

// 因为我们的 vite 目录和测试的 src 目录在同一层，因此加了个../
// const cacheDir = path.join(__dirname, '../', 'node_modules/.vite')
export const optimizeDeps = async (config: ResolvedConfig) => {
  const { root, cacheDir, logger } = config
  // if (fs.existsSync(cacheDir)) return false
  fs.mkdirSync(cacheDir, { recursive: true })
  // 在分析依赖的时候 这里为简单实现就没按照源码使用 esbuild 插件去分析
  // 而是直接简单粗暴的读取了上级 package.json 的 dependencies 字段
  const pkgPath = path.join(searchForPackageRoot(root), 'package.json')
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))

  const deps = Object.keys(pkg?.dependencies ?? {})
  // 关于 esbuild 的参数可参考官方文档
  const result = await esbuild.build({
    entryPoints: deps,
    bundle: true,
    format: 'esm',
    logLevel: 'error',
    splitting: true,
    sourcemap: true,
    outdir: cacheDir,
    treeShaking: true,
    metafile: true,
    define: { 'process.env.NODE_ENV': '"development"' },
  })
  const outputs = Object.keys(result.metafile.outputs)
  const data: any = {}
  deps.forEach((dep) => {
    data[dep] = '/' + outputs.find((output) => output.endsWith(`${dep}.js`))
  })
  const dataPath = path.join(cacheDir, '_metadata.json')
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2))
}

export function initDepsOptimizerMetadata(
  config: ResolvedConfig,
  timestamp?: string,
): DepOptimizationMetadata {
  const hash = getDepHash(config)
  return {
    hash,
    browserHash: getOptimizedBrowserHash(hash, {}, timestamp),
    optimized: {},
    chunks: {},
    discovered: {},
    depInfoList: [],
  }
}

export function addOptimizedDepInfo(
  metadata: DepOptimizationMetadata,
  type: 'optimized' | 'discovered' | 'chunks',
  depInfo: OptimizedDepInfo,
): OptimizedDepInfo {
  metadata[type][depInfo.id] = depInfo
  metadata.depInfoList.push(depInfo)
  return depInfo
}

export function optimizedDepInfoFromId(
  metadata: DepOptimizationMetadata,
  id: string,
): OptimizedDepInfo | undefined {
  return (
    metadata.optimized[id] || metadata.discovered[id] || metadata.chunks[id]
  )
}

export function optimizedDepInfoFromFile(
  metadata: DepOptimizationMetadata,
  file: string,
): OptimizedDepInfo | undefined {
  return metadata.depInfoList.find((depInfo) => depInfo.file === file)
}

/**
 * 创建初始dep优化元数据，如果存在deps缓存，则从其加载，并且不强制预捆绑。
 */
export function loadCachedDepOptimizationMetadata(
  config: ResolvedConfig,
  force = false,
  asCommand = false,
): DepOptimizationMetadata | undefined {
  const log = asCommand ? config.logger.info : debug

  // 对于compat，如果我们发现旧的结构，我们就删除缓存
  // if (fs.existsSync(path.join(config.cacheDir, '_metadata.json'))) {
  //   emptyDir(config.cacheDir)
  // }

  const depsCacheDir = getDepsCacheDir(config)

  if (!force) {
    let cachedMetadata: DepOptimizationMetadata | undefined
    try {
      const cachedMetadataPath = path.join(depsCacheDir, '_metadata.json')
      cachedMetadata = parseDepsOptimizerMetadata(
        fs.readFileSync(cachedMetadataPath, 'utf-8'),
        depsCacheDir,
      )
    } catch (e) {}
    // 哈希值是一致的，不需要重新打包
    if (cachedMetadata && cachedMetadata.hash === getDepHash(config)) {
      log('哈希是一致的。跳过。使用 --force 覆盖。')
      // 由于使用缓存，没有需要提交或取消的，我们只需要解决处理Promise，以便请求可以继续进行。
      return cachedMetadata
    }
  } else {
    config.logger.info('强制重新优化依赖关系')
  }

  // 从新的缓存开始
  fs.rmSync(depsCacheDir, { recursive: true, force: true })
}

/**
 * 在服务器启动时初始优化Deps。使用esbuild进行快速扫描，
 * 找到预捆绑的仓库，并包括用户硬编码的依赖。
 */
export async function discoverProjectDependencies(
  config: ResolvedConfig,
): Promise<Record<string, string>> {
  const { deps, missing } = await scanImports(config)

  const missingIds = Object.keys(missing)
  if (missingIds.length) {
    throw new Error(
      `The following dependencies are imported but could not be resolved:\n\n  ${missingIds
        .map(
          (id) =>
            `${colors.cyan(id)} ${colors.white(
              colors.dim(`(imported by ${missing[id]})`),
            )}`,
        )
        .join(`\n  `)}\n\nAre they installed?`,
    )
  }

  return deps
}

export function toDiscoveredDependencies(
  config: ResolvedConfig,
  deps: Record<string, string>,
  timestamp?: string,
) {
  const browserHash = getOptimizedBrowserHash(
    getDepHash(config),
    deps,
    timestamp,
  )
  const discovered: Record<string, OptimizedDepInfo> = {}
  for (const id in deps) {
    const src = deps[id]
    discovered[id] = {
      id,
      file: getOptimizedDepPath(id, config),
      src,
      browserHash,
      exportsData: extractExportsData(src, config),
    }
  }
  return discovered
}

export function getOptimizedDepPath(
  id: string,
  config: ResolvedConfig,
): string {
  return normalizePath(
    path.resolve(getDepsCacheDir(config), flattenId(id) + '.js'),
  )
}

function getDepsCacheSuffix(config: ResolvedConfig): string {
  let suffix = ''
  if (config.command === 'build') {
    // 根据outDir区分构建缓存，以允许并行构建。
    const { outDir } = config.build
    const buildId =
      outDir.length > 8 || outDir.includes('/') ? getHash(outDir) : outDir
    suffix += `_build-${buildId}`
  }

  return suffix
}

export function getDepsCacheDirPrefix(config: ResolvedConfig): string {
  return normalizePath(path.resolve(config.cacheDir, 'deps'))
}

export function getDepsCacheDir(config: ResolvedConfig): string {
  return getDepsCacheDirPrefix(config) + getDepsCacheSuffix(config)
}

function parseDepsOptimizerMetadata(
  jsonMetadata: string,
  depsCacheDir: string,
): DepOptimizationMetadata | undefined {
  const { hash, browserHash, optimized, chunks } = JSON.parse(
    jsonMetadata,
    (key: string, value: string) => {
      // 路径可以是绝对的，也可以是相对于_metadata.json所在的deps cache dir
      if (key === 'file' || key === 'src') {
        return normalizePath(path.resolve(depsCacheDir, value))
      }
      return value
    },
  )
  if (
    !chunks ||
    Object.values(optimized).some((depInfo: any) => !depInfo.fileHash)
  ) {
    // 过期的_metadata.json版本，忽略
    return
  }
  const metadata = {
    hash,
    browserHash,
    optimized: {},
    discovered: {},
    chunks: {},
    depInfoList: [],
  }
  for (const id of Object.keys(optimized)) {
    addOptimizedDepInfo(metadata, 'optimized', {
      ...optimized[id],
      id,
      browserHash,
    })
  }
  for (const id of Object.keys(chunks)) {
    addOptimizedDepInfo(metadata, 'chunks', {
      ...chunks[id],
      id,
      browserHash,
      needsInterop: false,
    })
  }
  return metadata
}

export async function extractExportsData(
  filePath: string,
  config: ResolvedConfig,
) {
  await init

  const optimizeDeps = getDepOptimizationConfig(config)

  const esbuildOptions = optimizeDeps?.esbuildOptions ?? {}

  let parseResult: ReturnType<typeof parse>
  let usedJsxLoader = false

  const entryContent = fs.readFileSync(filePath, 'utf-8')
  try {
    parseResult = parse(entryContent)
  } catch {
    const loader = esbuildOptions.loader?.[path.extname(filePath)] || 'jsx'
    debug(
      `Unable to parse: ${filePath}.\n Trying again with a ${loader} transform.`,
    )
    // const transformed = await ransformWithEsbuild(entryContent, filePath, {
    //   loader,
    // })
    // TODO:  尝试其他转换
    parseResult = parse(entryContent)
  }

  const [imports, exports, facade] = parseResult
  const exportsData: ExportsData = {
    hasImports: imports.length > 0,
    exports: exports.map((e) => e.n),
    facade,
    hasReExports: imports.some(({ ss, se }) => {
      const exp = entryContent.slice(ss, se)
      return /export\s+\*\s+from/.test(exp)
    }),
  }
  return exportsData
}

const lockfileFormats = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml']

export function getDepHash(config: ResolvedConfig): string {
  let content = lookupFile(config.root, lockfileFormats) || ''

  const optimizeDeps = getDepOptimizationConfig(config)
  content += JSON.stringify(
    {
      mode: process.env.NODE_ENV || config.mode,
      root: config.root,
      resolve: config.resolve,
      buildTarget: config.build.target,
      // assetsInclude: config.assetsInclude,
      plugins: config.plugins.map((p) => p.name),
      optimizeDeps: {
        include: optimizeDeps.include,
        exclude: optimizeDeps.exclude,
        esbuildOptions: {
          ...optimizeDeps?.esbuildOptions,
          plugins: optimizeDeps?.esbuildOptions?.plugins?.map((p) => p.name),
        },
      },
    },
    (_, value) => {
      if (typeof value === 'function' || value instanceof RegExp) {
        return value.toString()
      }
      return value
    },
  )
  return getHash(content)
}

function getOptimizedBrowserHash(
  hash: string,
  deps: Record<string, string>,
  timestamp = '',
) {
  return getHash(hash + JSON.stringify(deps) + timestamp)
}

export function newDepOptimizationProcessing(): DepOptimizationProcessing {
  let resolve: () => void
  const promise = new Promise((_resolve) => {
    resolve = _resolve
  }) as Promise<void>
  return { promise, resolve: resolve! }
}
