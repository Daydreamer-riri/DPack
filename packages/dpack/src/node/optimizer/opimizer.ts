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
    registerWorkersSource,
    delayDepsOptimizerUntil,
    resetRegisteredIds,
    ensureFirstRun,
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
          `??? new dependencies optimized: ${depsLogString(newDepsToLog)}`,
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

  // ??????????????????????????????????????????????????????????????????????????????
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

  // ??????meta???
  if (!cachedMetadata) {
    // ??????????????????
    currentlyProcessing = true

    // ??????????????????optimationDeps.include????????????????????????????????????

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
      // ??????, scanner ??????????????????
      depsOptimizer.scanProcessing = new Promise((resolve) => {
        setTimeout(async () => {
          try {
            logger.info(colors.green(`???????????? ...`))

            // !????????????
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

            // ???????????????????????????????????????????????????????????????????????????????????????preAliasPlugin???????????????????????????????????????
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

  // ???????????? --------

  function startNextDiscoveredBatch() {
    newDepsDiscovered = false

    // ????????????depOptimizationProcessing?????????????????????
    // ????????????????????????????????????Promises??????resolved???
    depOptimizationProcessingQueue.push(depOptimizationProcessing)

    // ??????????????????????????????????????????Promise???
    // ?????????????????????????????????????????????????????????Promise???
    depOptimizationProcessing = newDepOptimizationProcessing()
  }

  async function optimizeNewDeps() {
    // ????????????optimationDeps?????????????????????
    // ??????cache dir?????????????????????????????????deps?????????????????????
    // ???????????????_metadata??????????????????????????????
    // ???????????????????????????????????????????????????????????????fullReload???

    // ???????????????????????????_metadata??????????????????????????????deps?????????????????????fullReload???

    // ?????????deps???????????????????????????????????????????????????????????????????????????????????????????????????????????????

    const knownDeps = prepareKnownDeps()

    startNextDiscoveredBatch()

    return await runOptimizeDeps(config, knownDeps)
  }

  function prepareKnownDeps() {
    const knownDeps: Record<string, OptimizedDepInfo> = {}
    // ???????????????info objects???fileHash???browserHash?????????????????????
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

    // ?????????????????????rerun
    enqueuedRerun = void 0

    // ??????????????????????????????????????????????????????????????????
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

      // ??????????????????????????????????????????????????????????????????????????????????????????
      // ???????????????????????????????????????????????????????????????
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

        // ???optimationDeps??????????????????????????????????????????deps???
        // ????????????????????????????????????????????????metadata.discovered??????
        for (const id in metadata.discovered) {
          if (!newData.optimized[id]) {
            addOptimizedDepInfo(newData, 'discovered', metadata.discovered[id])
          }
        }

        // ??????????????????
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

        // ???????????????needsInterop??????????????????????????????depsInfo?????????
        // ??????????????????discovered processing promise??????????????????????????????????????????
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
            `??? ${
              !isRerun
                ? `dependencies optimized`
                : `optimized dependencies unchanged`
            }`,
          ),
        )
      } else {
        if (newDepsDiscovered) {
          // ???????????????deps??????????????????rerun?????????????????????????????????????????????????????????????????????
          processingResult.cancel()

          logger.info(
            colors.green(
              `??? delaying reload as new dependencies have been found...`,
            ),
          )
        } else {
          // ?????????????????????
          await commitProcessing()

          logger.info(
            colors.green(`??? optimized dependencies changed. reloading`),
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
      logger.info(colors.red(`error while updating dependencies:\n${e.stack}`))
      logger.error(
        colors.red(`error while updating dependencies:\n${e.stack}`),
        { timestamp: true, error: e },
      )
      resolveEnqueuedProcessingPromises()

      // ???????????????deps??????server??????????????????
      metadata.discovered = {}
    }
  }

  function fullReload() {
    logger.info(colors.gray('full reload'))
    // ??????moduleGraph
    if (server) {
      server.moduleGraph.invalidateAll()

      server.ws.send({
        type: 'full-reload',
        path: '*',
      })
    }
  }

  async function rerun() {
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

  async function onCrawEnd() {
    logger.info(colors.green(`??? static imports crawl ended`))
    if (firstRunCalled) {
      return
    }

    currentlyProcessing = false

    const crawlDeps = Object.keys(metadata.discovered)

    // ??????????????????????????????+????????????
    await depsOptimizer.scanProcessing

    if (!isBuild && postScanOptimizationResult) {
      const result = await postScanOptimizationResult
      postScanOptimizationResult = void 0

      const scanDeps = Object.keys(result.metadata.optimized)

      if (scanDeps.length === 0 && crawlDeps.length === 0) {
        logger.info(
          colors.green(
            `??? no dependencies found by the scanner or crawling static imports`,
          ),
        )
        result.cancel()
        firstRunCalled = true
        return
      }

      const needsInteropMismatch = findInteropMismatches(
        metadata.discovered,
        result.metadata.optimized,
      )
      const scannerMissedDeps = crawlDeps.some((dep) => !scanDeps.includes(dep))
      const outdatedResult =
        needsInteropMismatch.length > 0 || scannerMissedDeps

      if (outdatedResult) {
        // ??????????????????????????????????????????????????????????????????????????????
        result.cancel()

        // ?????????????????????????????????????????????????????????????????????
        for (const dep of scanDeps) {
          if (!crawlDeps.includes(dep)) {
            addMissingDep(dep, result.metadata.optimized[dep].src!)
          }
        }
        if (scannerMissedDeps) {
          logger.info(
            colors.yellow(
              `??? new dependencies were found while crawling that weren't detected by the scanner`,
            ),
          )
        }
        logger.info(colors.green(`??? re-running optimizer`))
        debouncedProcessing(0)
      } else {
        logger.info(
          colors.green(
            `??? using post-scan optimizer result, the scanner found every used dependency`,
          ),
        )
        startNextDiscoveredBatch()
        runOptimizer(result)
      }
    } else {
      if (crawlDeps.length === 0) {
        logger.info(
          colors.green(
            `no dependencies found while crawling the static imports`,
          ),
        )
        firstRunCalled = true
      } else {
        debouncedProcessing(0)
      }
    }
  }

  const runOptimizerIfIdleAfterMs = 100

  let registeredIds: { id: string; done: () => Promise<any> }[] = []
  let seenIds = new Set<string>()
  let workersSources = new Set<string>()
  let waitingOn: string | undefined
  let firstRunEnsured = false

  function resetRegisteredIds() {
    registeredIds = []
    seenIds = new Set<string>()
    workersSources = new Set<string>()
    waitingOn = void 0
    firstRunEnsured = false
  }

  function ensureFirstRun() {
    if (!firstRunEnsured && !firstRunCalled && registeredIds.length === 0) {
      setTimeout(() => {
        if (!closed && registeredIds.length === 0) {
          onCrawEnd()
        }
      }, runOptimizerIfIdleAfterMs)
    }
    firstRunEnsured = true
  }

  function registerWorkersSource(id: string): void {
    workersSources.add(id)
    // ??????????????????ID?????????????????????????????????????????????worker???rollup bundling??????????????????
    registeredIds = registeredIds.filter((registered) => registered.id !== id)
    if (waitingOn === id) {
      waitingOn = undefined
      runOptimizerWhenIdle()
    }
  }

  function delayDepsOptimizerUntil(id: string, done: () => Promise<any>): void {
    if (!depsOptimizer.isOptimizedDepFile(id) && !seenIds.has(id)) {
      seenIds.add(id)
      registeredIds.push({ id, done })
      runOptimizerWhenIdle()
    }
  }

  function runOptimizerWhenIdle() {
    if (!waitingOn) {
      const next = registeredIds.pop()
      if (next) {
        waitingOn = next.id
        const afterLoad = () => {
          waitingOn = void 0
          if (!closed && !workersSources.has(next.id)) {
            if (registeredIds.length > 0) {
              runOptimizerWhenIdle()
            } else {
              onCrawEnd()
            }
          }
        }
        next
          .done()
          .then(() => {
            setTimeout(
              afterLoad,
              registeredIds.length > 0 ? 0 : runOptimizerIfIdleAfterMs,
            )
          })
          .catch(afterLoad)
      }
    }
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
        debug(colors.cyan(`??? needsInterop mismatch detected for ${dep}`))
      }
    }
  }

  return needsInteropMismatch
}
