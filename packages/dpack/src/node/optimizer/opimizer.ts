import {
  addOptimizedDepInfo,
  initDepsOptimizerMetadata,
  loadCachedDepOptimizationMetadata,
  newDepOptimizationProcessing,
  toDiscoveredDependencies,
  discoverProjectDependencies,
} from '.'
import type {
  DepOptimizationProcessing,
  DepsOptimizer,
  DepOptimizationResult,
} from '.'
import type { OptimizedDepInfo } from '.'
import type { ResolvedConfig } from '../config'
import type { DpackDevServer } from '../server'
import colors from 'picocolors'

const debounceMs = 100

const depsOptimizerMap = new WeakMap<ResolvedConfig, DepsOptimizer>()
const devSsrDepsOptimizerMap = new WeakMap<ResolvedConfig, DepsOptimizer>()

export function getDepsOptimizer(
  config: ResolvedConfig,
): DepsOptimizer | undefined {
  // Workers compilation shares the DepsOptimizer from the main build
  return depsOptimizerMap.get(config)
}

// export async function initDepsOptimizer(
//   config: ResolvedConfig,
//   server?: DpackDevServer,
// ) {
//   if (!getDepsOptimizer(config)) {
//     await createDepsOptimizer(config, server)
//   }
// }

// async function createDepsOptimizer(
//   config: ResolvedConfig,
//   server?: DpackDevServer,
// ) {
//   const { logger } = config
//   const isBuild = config.command === 'build'

//   const sessionTimestamp = Date.now().toString()

//   const cachedMetadata = loadCachedDepOptimizationMetadata(config)

//   let handle: NodeJS.Timeout | undefined

//   let closed = false

//   let metadata =
//     cachedMetadata || initDepsOptimizerMetadata(config, sessionTimestamp)

//   const depsOptimizer: DepsOptimizer = {
//     metadata,
//     registerMissingImport,
//     run: () => debouncedProcessing(0),
//     isOptimizedDepUrl: createIsOptimizedDepUrl(config),
//     getOptimizedDepId: (depInfo: OptimizedDepInfo) =>
//       isBuild ? depInfo.file : `${depInfo.file}?v=${depInfo.browserHash}`,
//     registerWorkersSource,
//     delayDepsOptimizerUntil,
//     resetRegisteredIds,
//     ensureFirstRun,
//     close,
//     options: getDepOptimizationConfig(config),
//   }

//   depsOptimizerMap.set(config, depsOptimizer)

//   let newDepsDiscovered = false

//   let newDepsToLog: string[] = []
//   let newDepsToLogHandle: NodeJS.Timeout | undefined
//   const logNewlyDiscoveredDeps = () => {
//     if (newDepsToLog.length) {
//       config.logger.info(
//         colors.green(
//           `✨ new dependencies optimized: ${depsLogString(newDepsToLog)}`,
//         ),
//         {
//           timestamp: true,
//         },
//       )
//       newDepsToLog = []
//     }
//   }

//   let depOptimizationProcessing = newDepOptimizationProcessing()
//   let depOptimizationProcessingQueue: DepOptimizationProcessing[] = []
//   const resolveEnqueuedProcessingPromises = () => {
//     for (const processing of depOptimizationProcessingQueue) {
//       processing.resolve()
//     }
//     depOptimizationProcessingQueue = []
//   }

//   let enqueueRerun: (() => void) | undefined
//   let currentlyProcessing = false

//   // 如果没有缓存或者缓存已经过时，我们需要准备第一次运行
//   let firstRunCalled = !!cachedMetadata

//   let postScanOptimizationResult: Promise<DepOptimizationResult> | undefined

//   let optimizingNewDeps: Promise<DepOptimizationResult> | undefined

//   async function close() {
//     closed = true
//     await Promise.allSettled([
//       depsOptimizer.scanProcessing,
//       postScanOptimizationResult,
//       optimizingNewDeps,
//     ])
//   }

//   // 没有meta时
//   if (!cachedMetadata) {
//     // 进入处理状态
//     currentlyProcessing = true

//     // 用手动添加的optimationDeps.include信息初始化已发现的仓库。

//     const deps: Record<string, string> = {}
//     // await addManuallyIncludedOptimizeDeps(deps, config)
//     // const discovered = toDiscoveredDependencies(config, deps, sessionTimestamp)

//     // for (const depInfo of Object.values(discovered)) {
//     //   addOptimizedDepInfo(metadata, 'discovered', {
//     //     ...depInfo,
//     //     processing: depOptimizationProcessing.promise,
//     //   })
//     //   newDepsDiscovered = true
//     // }

//     if (!isBuild) {
//       // 重点, scanner 进用于开发时
//       depsOptimizer.scanProcessing = new Promise((resolve) => {
//         setTimeout(async () => {
//           try {
//             logger.info(colors.green(`扫描依赖 ...`))

//             const deps = await discoverProjectDependencies(config)
//           } catch {}
//         }, 0)
//       })
//     }
//   }

//   function registerMissingImport(
//     id: string,
//     resolved: string,
//   ): OptimizedDepInfo {
//     const optimized = metadata.optimized[id]
//     if (optimized) {
//       return optimized
//     }
//     const chunk = metadata.chunks[id]
//     if (chunk) {
//       return chunk
//     }
//     let missing = metadata.discovered[id]
//     if (missing) {
//       return missing
//     }

//     missing = addMissingDep(id, resolved)

//     // Until the first optimize run is called, avoid triggering processing
//     // We'll wait until the user codebase is eagerly processed by Vite so
//     // we can get a list of every missing dependency before giving to the
//     // browser a dependency that may be outdated, thus avoiding full page reloads

//     if (firstRunCalled) {
//       // Debounced rerun, let other missing dependencies be discovered before
//       // the running next optimizeDeps
//       debouncedProcessing()
//     }

//     // Return the path for the optimized bundle, this path is known before
//     // esbuild is run to generate the pre-bundle
//     return missing
//   }
// }
