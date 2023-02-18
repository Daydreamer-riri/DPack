import {
  addOptimizedDepInfo,
  initDepsOptimizerMetadata,
  loadCachedDepOptimizationMetadata,
  newDepOptimizationProcessing,
  toDiscoveredDependencies,
  discoverProjectDependencies,
  depsLogString,
  getOptimizedDepPath,
  depsFromOptimizedDepInfo,
  extractExportsData,
  runOptimizeDeps,
  createIsOptimizedDepUrl,
  isOptimizedDepFile,
  debuggerDpackDeps as debug,
} from '.'
import type {
  DepOptimizationProcessing,
  DepsOptimizer,
  DepOptimizationResult,
} from '.'
import type { OptimizedDepInfo } from '.'
import { getDepOptimizationConfig } from '../config'
import type { ResolvedConfig } from '../config'
import type { DpackDevServer } from '../server'
import colors from 'picocolors'
import { createDebugger, getHash } from '../utils'

const debounceMs = 100

const depsOptimizerMap = new WeakMap<ResolvedConfig, DepsOptimizer>()
const devSsrDepsOptimizerMap = new WeakMap<ResolvedConfig, DepsOptimizer>()

export function getDepsOptimizer(
  config: ResolvedConfig,
): DepsOptimizer | undefined {
  // Workers compilation shares the DepsOptimizer from the main build
  return depsOptimizerMap.get(config)
}

export async function initDepsOptimizer(
  config: ResolvedConfig,
  server?: DpackDevServer,
) {
  if (!getDepsOptimizer(config)) {
    await createDepsOptimizer(config, server)
  }
}

async function createDepsOptimizer(
  config: ResolvedConfig,
  server?: DpackDevServer,
) {
  const { logger } = config
  const isBuild = config.command === 'build'

  const sessionTimestamp = Date.now().toString()

  const cachedMetadata = loadCachedDepOptimizationMetadata(config)

  let handle: NodeJS.Timeout | undefined

  let closed = false

  let metadata =
    cachedMetadata || initDepsOptimizerMetadata(config, sessionTimestamp)

  const depsOptimizer: DepsOptimizer = {
    metadata,
    registerMissingImport,
    run: () => debouncedProcessing(0),
    isOptimizedDepFile: (id: string) => isOptimizedDepFile(id, config),
    isOptimizedDepUrl: createIsOptimizedDepUrl(config),
    getOptimizedDepId: (depInfo: OptimizedDepInfo) =>
      isBuild ? depInfo.file : `${depInfo.file}?v=${depInfo.browserHash}`,
    // registerWorkersSource,
    // delayDepsOptimizerUntil,
    // resetRegisteredIds,
    // ensureFirstRun,
    close,
    options: getDepOptimizationConfig(config),
  }

  depsOptimizerMap.set(config, depsOptimizer)

  let newDepsDiscovered = false

  let newDepsToLog: string[] = []
  let newDepsToLogHandle: NodeJS.Timeout | undefined
  const logNewlyDiscoveredDeps = () => {
    if (newDepsToLog.length) {
      config.logger.info(
        colors.green(
          `✨ new dependencies optimized: ${depsLogString(newDepsToLog)}`,
        ),
        {
          timestamp: true,
        },
      )
      newDepsToLog = []
    }
  }

  let depOptimizationProcessing = newDepOptimizationProcessing()
  let depOptimizationProcessingQueue: DepOptimizationProcessing[] = []
  const resolveEnqueuedProcessingPromises = () => {
    for (const processing of depOptimizationProcessingQueue) {
      processing.resolve()
    }
    depOptimizationProcessingQueue = []
  }

  let enqueuedRerun: (() => void) | undefined
  let currentlyProcessing = false

  // 如果没有缓存或者缓存已经过时，我们需要准备第一次运行
  let firstRunCalled = !!cachedMetadata

  let postScanOptimizationResult: Promise<DepOptimizationResult> | undefined

  let optimizingNewDeps: Promise<DepOptimizationResult> | undefined

  async function close() {
    closed = true
    await Promise.allSettled([
      depsOptimizer.scanProcessing,
      postScanOptimizationResult,
      optimizingNewDeps,
    ])
  }

  // 没有meta时
  if (!cachedMetadata) {
    // 进入处理状态
    currentlyProcessing = true

    // 用手动添加的optimationDeps.include信息初始化已发现的仓库。

    const deps: Record<string, string> = {}
    // await addManuallyIncludedOptimizeDeps(deps, config)
    const discovered = toDiscoveredDependencies(config, deps, sessionTimestamp)

    for (const depInfo of Object.values(discovered)) {
      addOptimizedDepInfo(metadata, 'discovered', {
        ...depInfo,
        processing: depOptimizationProcessing.promise,
      })
      newDepsDiscovered = true
    }

    if (!isBuild) {
      // 重点, scanner 进用于开发时
      depsOptimizer.scanProcessing = new Promise((resolve) => {
        setTimeout(async () => {
          try {
            logger.info(colors.green(`扫描依赖 ...`))

            // !扫描依赖
            const deps = await discoverProjectDependencies(config)

            logger.info(
              colors.green(
                Object.keys(deps).length > 0
                  ? `dependencies found by scanner: ${depsLogString(
                      Object.keys(deps),
                    )}`
                  : `no dependencies found by scanner`,
              ),
            )

            // 将这些依赖关系添加到已发现的列表中，因为这些依赖关系目前被preAliasPlugin用来支持别名和优化的部署。
            for (const id of Object.keys(deps)) {
              if (!metadata.discovered[id]) {
                addMissingDep(id, deps[id])
              }
            }

            if (!isBuild) {
              const knownDeps = prepareKnownDeps()
              postScanOptimizationResult = runOptimizeDeps(config, knownDeps)
            }
          } catch (e) {
            logger.error(e.message)
          } finally {
            resolve()
            depsOptimizer.scanProcessing = void 0
          }
        }, 0)
      })
    }
  }

  // 定义方法 --------

  function startNextDiscoveredBatch() {
    newDepsDiscovered = false

    // 将当前的depOptimizationProcessing添加到队列中，
    // 一旦重新运行被提交，这些Promises将被resolved。
    depOptimizationProcessingQueue.push(depOptimizationProcessing)

    // 为下一次重新运行创建一个新的Promise，
    // 被发现的缺失的依赖将从这里被分配给这个Promise。
    depOptimizationProcessing = newDepOptimizationProcessing()
  }

  async function optimizeNewDeps() {
    // 成功完成optimationDeps的重新运行后，
    // 将在cache dir中创建所有当前和发现的deps的新捆绑版本，
    // 以及分配给_metadata的新元数据信息对象。
    // 只有当之前的捆绑依赖性发生变化时，才会发出fullReload。

    // 如果重新运行失败，_metadata保持不动，当前发现的deps被清理，并发出fullReload。

    // 所有的deps，以前已知的和新发现的都被重新打包，遵从插入顺序，以保持元数据文件的稳定。

    const knownDeps = prepareKnownDeps()

    startNextDiscoveredBatch()

    return await runOptimizeDeps(config, knownDeps)
  }

  function prepareKnownDeps() {
    const knownDeps: Record<string, OptimizedDepInfo> = {}
    // 克隆优化的info objects，fileHash、browserHash可以为其改变。
    for (const dep of Object.keys(metadata.optimized)) {
      knownDeps[dep] = { ...metadata.optimized[dep] }
    }
    for (const dep of Object.keys(metadata.discovered)) {
      const { processing, ...info } = metadata.discovered[dep]
      knownDeps[dep] = info
    }
    return knownDeps
  }

  async function runOptimizer(preRunResult?: DepOptimizationResult) {
    const isRerun = firstRunCalled
    firstRunCalled = true

    // 确保按顺序调用rerun
    enqueuedRerun = void 0

    // 确保不会对当前发现的依赖发出重新运行的指令。
    if (handle) clearTimeout(handle)

    if (closed || Object.keys(metadata.discovered).length === 0) {
      currentlyProcessing = false
      return
    }

    currentlyProcessing = true

    try {
      const processingResult =
        preRunResult ?? (await (optimizingNewDeps = optimizeNewDeps()))
      optimizingNewDeps = void 0

      if (closed) {
        currentlyProcessing = false
        processingResult.cancel()
        resolveEnqueuedProcessingPromises()
        return
      }

      const newData = processingResult.metadata

      const needsInteropMismatch = findInteropMismatches(
        metadata.discovered,
        metadata.optimized,
      )

      // 在重新优化之后，如果内部捆绑的块发生变化，就需要进行全页面的
      // 重新加载。如果文件是稳定的，就可以避免重载
      const needsReload =
        needsInteropMismatch.length > 0 ||
        metadata.hash !== newData.hash ||
        Object.keys(metadata.optimized).some((dep) => {
          return (
            metadata.optimized[dep].fileHash !== newData.optimized[dep].fileHash
          )
        })

      const commitProcessing = async () => {
        await processingResult.commit()

        // 当optimationDeps运行时，可能会发现新的丢失的deps，
        // 在这种情况下，它们将不断被添加到metadata.discovered中。
        for (const id in metadata.discovered) {
          if (!newData.optimized[id]) {
            addOptimizedDepInfo(newData, 'discovered', metadata.discovered[id])
          }
        }

        // 保持哈希稳定
        if (!needsReload) {
          newData.browserHash = metadata.browserHash
          for (const dep in newData.chunks) {
            newData.chunks[dep].browserHash = metadata.browserHash
          }
          for (const dep in newData.optimized) {
            newData.optimized[dep].browserHash = (
              metadata.optimized[dep] || metadata.discovered[dep]
            ).browserHash
          }
        }

        // 将哈希值和needsInterop的变化提交给被发现的depsInfo对象。
        // 允许代码等待discovered processing promise，并在同一对象中使用这些信息
        for (const o in newData.optimized) {
          const discovered = metadata.discovered[o]
          if (discovered) {
            const optimized = newData.optimized[o]
            discovered.browserHash = optimized.browserHash
            discovered.fileHash = optimized.fileHash
            discovered.needsInterop = optimized.needsInterop
            discovered.processing = void 0
          }
        }

        if (isRerun) {
          newDepsToLog.push(
            ...Object.keys(newData.optimized).filter(
              (dep): boolean => !metadata.optimized[dep],
            ),
          )
        }

        metadata = depsOptimizer.metadata = newData
        resolveEnqueuedProcessingPromises()
      }

      if (!needsReload) {
        await commitProcessing()
        logger.info(
          colors.green(
            `✨ ${
              !isRerun
                ? `dependencies optimized`
                : `optimized dependencies unchanged`
            }`,
          ),
        )
      } else {
        if (newDepsDiscovered) {
          // 有新发现的deps，并且另一个rerun即将被执行。避免当前的完全重载丢弃这个重载结果
          processingResult.cancel()

          logger.info(
            colors.green(
              `✨ delaying reload as new dependencies have been found...`,
            ),
          )
        } else {
          // 当前阶段下重载
          await commitProcessing()

          logger.info(
            colors.green(`✨ optimized dependencies changed. reloading`),
            { timestamp: true },
          )
          if (needsInteropMismatch.length > 0) {
            logger.warn(
              `Mixed ESM and CJS detected in ${colors.yellow(
                needsInteropMismatch.join(', '),
              )}, add ${
                needsInteropMismatch.length === 1 ? 'it' : 'them'
              } to optimizeDeps.needsInterop to speed up cold start`,
              {
                timestamp: true,
              },
            )
          }
          fullReload()
        }
      }
    } catch (e) {
      logger.error(
        colors.red(`error while updating dependencies:\n${e.stack}`),
        { timestamp: true, error: e },
      )
      resolveEnqueuedProcessingPromises()

      // 重置缺失的deps，让server重新发现依赖
      metadata.discovered = {}
    }
  }

  function fullReload() {
    // 重置moduleGraph
    if (server) {
      server.moduleGraph.invalidateAll()

      // server.ws.send({
      //   type: 'full-reload',
      //   path: '*'
      // })
    }
  }

  // function ensureFirstRun() {
  //   if (!firstRunE)
  // }

  async function rerun() {
    // debounce time to wait for new missing deps finished, issue a new
    // optimization of deps (both old and newly found) once the previous
    // optimizeDeps processing is finished
    const deps = Object.keys(metadata.discovered)
    const depsString = depsLogString(deps)
    logger.info(colors.green(`new dependencies found: ${depsString}`))
    runOptimizer()
  }

  function getDiscoveredBrowserHash(
    hash: string,
    deps: Record<string, string>,
    missing: Record<string, string>,
  ) {
    return getHash(
      hash + JSON.stringify(deps) + JSON.stringify(missing) + sessionTimestamp,
    )
  }

  function registerMissingImport(
    id: string,
    resolved: string,
  ): OptimizedDepInfo {
    const optimized = metadata.optimized[id]
    if (optimized) {
      return optimized
    }
    const chunk = metadata.chunks[id]
    if (chunk) {
      return chunk
    }
    let missing = metadata.discovered[id]
    if (missing) {
      return missing
    }

    missing = addMissingDep(id, resolved)

    // Until the first optimize run is called, avoid triggering processing
    // We'll wait until the user codebase is eagerly processed by Vite so
    // we can get a list of every missing dependency before giving to the
    // browser a dependency that may be outdated, thus avoiding full page reloads

    if (firstRunCalled) {
      // Debounced rerun, let other missing dependencies be discovered before
      // the running next optimizeDeps
      debouncedProcessing()
    }

    // Return the path for the optimized bundle, this path is known before
    // esbuild is run to generate the pre-bundle
    return missing
  }

  function addMissingDep(id: string, resolved: string) {
    newDepsDiscovered = true

    return addOptimizedDepInfo(metadata, 'discovered', {
      id,
      file: getOptimizedDepPath(id, config),
      src: resolved,
      browserHash: getDiscoveredBrowserHash(
        metadata.hash,
        depsFromOptimizedDepInfo(metadata.optimized),
        depsFromOptimizedDepInfo(metadata.discovered),
      ),
      processing: depOptimizationProcessing.promise,
      exportsData: extractExportsData(resolved, config),
    })
  }

  function debouncedProcessing(timeout = debounceMs) {
    if (!newDepsDiscovered) {
      return
    }
    // Debounced rerun, let other missing dependencies be discovered before the running next optimizeDeps
    enqueuedRerun = undefined
    if (handle) clearTimeout(handle)
    if (newDepsToLogHandle) clearTimeout(newDepsToLogHandle)
    newDepsToLogHandle = undefined
    handle = setTimeout(() => {
      handle = undefined
      enqueuedRerun = rerun
      if (!currentlyProcessing) {
        enqueuedRerun()
      }
    }, timeout)
  }
}

function findInteropMismatches(
  discovered: Record<string, OptimizedDepInfo>,
  optimized: Record<string, OptimizedDepInfo>,
) {
  const needsInteropMismatch = []
  for (const dep in discovered) {
    const discoveredDepInfo = discovered[dep]
    const depInfo = optimized[dep]
    if (depInfo) {
      if (
        discoveredDepInfo.needsInterop !== void 0 &&
        depInfo.needsInterop !== discoveredDepInfo.needsInterop
      ) {
        needsInteropMismatch.push(dep)
        debug(colors.cyan(`✨ needsInterop mismatch detected for ${dep}`))
      }
    }
  }

  return needsInteropMismatch
}
