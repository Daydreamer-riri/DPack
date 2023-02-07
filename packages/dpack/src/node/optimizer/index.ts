// simple-vite/vit/index.js
import fs from 'node:fs'
import path from 'node:path'
import esbuild from 'esbuild'
import type { BuildOptions as EsbuildBuildOptions } from 'esbuild'
import { searchForPackageRoot } from '../server/searchRoot'
import type { ResolvedConfig } from '../config'

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
   * The browser hash is determined by the main hash plus additional dependencies
   * discovered at runtime. This is used to invalidate browser requests to
   * optimized deps.
   */
  browserHash: string
  /**
   * Metadata for each already optimized dependency
   */
  optimized: Record<string, OptimizedDepInfo>
  /**
   * Metadata for non-entry optimized chunks and dynamic imports
   */
  chunks: Record<string, OptimizedDepInfo>
  /**
   * Metadata for each newly discovered dependency after processing
   */
  discovered: Record<string, OptimizedDepInfo>
  /**
   * OptimizedDepInfo list
   */
  depInfoList: OptimizedDepInfo[]
}

export interface DepOptimizationConfig {
  /**
   * Force optimize listed dependencies (must be resolvable import paths,
   * cannot be globs).
   */
  include?: string[]
  /**
   * Do not optimize these dependencies (must be resolvable import paths,
   * cannot be globs).
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
}

export type DepOptimizationOptions = DepOptimizationConfig

// 因为我们的 vite 目录和测试的 src 目录在同一层，因此加了个../
// const cacheDir = path.join(__dirname, '../', 'node_modules/.vite')
const optimizeDeps = async (config: ResolvedConfig) => {
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

export { optimizeDeps }
