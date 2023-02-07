import fs from 'node:fs'
import { join } from 'node:path'
import { Performance } from 'node:perf_hooks'
import { EmitFile, GetModuleInfo, VERSION as rollupVersion } from 'rollup'
import type {
  MinimalPluginContext,
  RollupError,
  ModuleInfo,
  InputOptions,
  PartialResolvedId,
  NormalizedInputOptions,
  SourceDescription,
  LoadResult,
  PluginContext as RollupPluginContext,
  ResolvedId,
  FunctionPluginHooks,
  SourceMap,
  EmittedFile,
  AsyncPluginHooks,
  ParallelPluginHooks,
  CustomPluginOptions,
  TransformResult,
} from 'rollup'
import * as acorn from 'acorn'
import type { Plugin } from '../plugin'
import type { FSWatcher } from 'chokidar'
import type { ResolvedConfig } from '../config'
import type { ModuleGraph } from './moduleGraph'
import { buildErrorMessage } from './middlewares/error'
import colors from 'picocolors'
import {
  arraify,
  ensureWatchedFile,
  isExternalUrl,
  isObject,
  normalizePath,
} from '../utils'
import { createPluginHookUtils } from '../plugins'

export interface PluginContainer {
  options: InputOptions
  getModuleInfo(id: string): ModuleInfo | null
  buildStart(options: InputOptions): Promise<void>
  resolvedId(
    id: string,
    importer?: string,
    options?: {
      assertions?: Record<string, string>
      custom?: CustomPluginOptions
      skip?: Set<Plugin>
      // ssr?: boolean
      /**
       * @internal
       */
      scan?: boolean
      isEntry?: boolean
    },
  ): Promise<PartialResolvedId | null>
  transform(
    code: string,
    id: string,
    options?: {
      inMap?: SourceDescription['map']
    },
  ): Promise<SourceDescription | null>
  load(id: string): Promise<LoadResult | null>
  close(): Promise<void>
}

type PluginContext = Omit<
  RollupPluginContext,
  // not supported
  | 'load'
  // not documented
  | 'cache'
  // deprecated
  | 'moduleIds'
>

export let parser = acorn.Parser

export async function createPluginContainer(
  config: ResolvedConfig,
  moduleGraph?: ModuleGraph,
  watcher?: FSWatcher,
): Promise<PluginContainer> {
  const isDebug = process.env.DEBUG
  const {
    plugins,
    logger,
    root,
    build: { rollupOptions },
  } = config
  const { getSortedPluginHooks, getSortedPlugins } =
    createPluginHookUtils(plugins)
  const debugSourcemapCombineFlag = 'vite:sourcemap-combine'
  const isDebugSourcemapCombineFocused = process.env.DEBUG?.includes(
    debugSourcemapCombineFlag,
  )

  const ModuleInfoProxy: ProxyHandler<ModuleInfo> = {
    get(info: any, key: string) {
      if (key in info) {
        return info[key]
      }
      throw Error(`[dpack] “${key}” 属性不支持`)
    },
  }

  const watchFiles = new Set<string>()

  const minimalContext: MinimalPluginContext = {
    meta: {
      rollupVersion,
      watchMode: true,
    },
  }

  function warnIncompatibleMethod(method: string, plugin: string) {
    logger.warn(
      colors.cyan(`[plugin:${plugin}] `) +
        colors.yellow(
          `context method ${colors.bold(
            `${method}()`,
          )} is not supported in serve mode. This plugin is likely not vite-compatible.`,
        ),
    )
  }

  // parallel, ignores returns
  async function hookParallel<H extends AsyncPluginHooks & ParallelPluginHooks>(
    hookName: H,
    context: (plugin: Plugin) => ThisType<FunctionPluginHooks[H]>,
    args: (plugin: Plugin) => Parameters<FunctionPluginHooks[H]>,
  ): Promise<void> {
    const parallelPromises: Promise<unknown>[] = []
    for (const plugin of getSortedPlugins(hookName)) {
      const hook = plugin[hookName]
      if (!hook) continue
      const handler: Function = (hook as any)?.handler ?? hook
      if ((hook as { sequential?: boolean }).sequential) {
        await Promise.all(parallelPromises)
        parallelPromises.length = 0
        await handler.apply(context(plugin), args(plugin))
      } else {
        parallelPromises.push(handler.apply(context(plugin), args(plugin)))
      }
    }
    await Promise.all(parallelPromises)
  }

  // same default value of "moduleInfo.meta" as in Rollup
  const EMPTY_OBJECT = Object.freeze({})

  function getModuleInfo(id: string) {
    const module = moduleGraph?.getModuleById(id)
    if (!module) return null
    if (!module.info) {
      module.info = new Proxy(
        { id, meta: module.meta || EMPTY_OBJECT } as ModuleInfo,
        ModuleInfoProxy,
      )
    }
    return module.info
  }

  function updateModuleInfo(id: string, { meta }: { meta?: object | null }) {
    if (meta) {
      const moduleInfo = getModuleInfo(id)
      if (moduleInfo) {
        moduleInfo.meta = { ...moduleInfo.meta, ...meta }
      }
    }
  }

  class Context implements PluginContext {
    meta = minimalContext.meta
    _scan = false
    _activePlugin: Plugin | null
    _activeId: string | null = null
    _activeCode: string | null = null
    // _resolveSkips?: Set<Plugin>
    _addedImports: Set<string> | null = null

    constructor(initialPlugin?: Plugin) {
      this._activePlugin = initialPlugin || null
    }

    parse(code: string, opts: any = {}) {
      return parser.parse(code, {
        sourceType: 'module',
        ecmaVersion: 'latest',
        locations: true,
        ...opts,
      })
    }

    async resolve(id: string, importer?: string) {
      let out = await container.resolvedId(id, importer)
      if (typeof out === 'string') out = { id: out }
      return out as ResolvedId | null
    }

    getModuleInfo(id: string) {
      return getModuleInfo(id)
    }

    getModuleIds() {
      return moduleGraph
        ? moduleGraph.idToModuleMap.keys()
        : Array.prototype[Symbol.iterator]()
    }

    addWatchFile(id: string) {
      watchFiles.add(id)
      ;(this._addedImports || (this._addedImports = new Set())).add(id)
      if (watcher) ensureWatchedFile(watcher, id, root)
    }

    getWatchFiles() {
      return [...watchFiles]
    }

    emitFile(assetOrFile: EmittedFile) {
      warnIncompatibleMethod(`emitFile`, this._activePlugin!.name)
      return ''
    }

    setAssetSource() {
      warnIncompatibleMethod(`setAssetSource`, this._activePlugin!.name)
    }

    getFileName() {
      warnIncompatibleMethod(`getFileName`, this._activePlugin!.name)
      return ''
    }

    warn(
      e: RollupError | string,
      position?: number | { column: number; line: number },
    ) {
      if (typeof e === 'string') {
        logger.warn(e, { clear: true, timestamp: true })

        return
      }
      const msg = buildErrorMessage(
        e,
        [colors.yellow(`warning: ${e.message}`)],
        false,
      )
      logger.warn(msg, { clear: true, timestamp: true })
    }

    error(e: string | RollupError): never {
      throw e
    }
  }

  class TransformContext extends Context {
    filename: string
    originalCode: string
    originSourcemap: SourceMap | null = null
    sourcemapChain: NonNullable<SourceDescription['map']>[] = []
    combinedMap: SourceMap | null = null

    constructor(filename: string, code: string, inMap?: SourceMap | string) {
      super()
      this.filename = filename
      this.originalCode = code
      if (inMap) {
        if (isDebugSourcemapCombineFocused) {
          // @ts-expect-error inject name for debug purpose
          inMap.name = '$inMap'
        }
        this.sourcemapChain.push(inMap)
      }
    }

    // TODO:
    _getCombinedSourcemap(createIfNull = false) {
      let combinedMap = this.combinedMap
      for (let m of this.sourcemapChain) {
        if (typeof m === 'string') m = JSON.parse(m)
        if (!('version' in (m as SourceMap))) {
          combinedMap = this.combinedMap = null
          this.sourcemapChain.length = 0
          break
        }
        if (!combinedMap) {
          combinedMap = m as SourceMap
        } else {
          // combinedMap =
        }
      }
      return null
    }

    getCombinedSourceMap() {
      // TODO:
    }
  }

  let closed = false

  const container: PluginContainer = {
    options: await (async () => {
      let options = rollupOptions
      for (const optionsHook of getSortedPluginHooks('options')) {
        options = (await optionsHook.call(minimalContext, options)) || options
      }
      if (options.acornInjectPlugins) {
        parser = acorn.Parser.extend(
          ...(arraify(options.acornInjectPlugins) as any),
        )
      }
      return {
        acorn,
        acornInjectPlugins: [],
        ...options,
      }
    })(),

    getModuleInfo,

    async buildStart() {
      await hookParallel(
        'buildStart',
        (plugin) => new Context(plugin),
        () => [container.options as NormalizedInputOptions],
      )
    },

    async resolvedId(
      rawId: string,
      importer = join(root, 'index.html'),
      options,
    ) {
      const skip = options?.skip
      const scan = !!options?.scan

      const ctx = new Context()
      ctx._scan = scan // TODO:
      const resolveStart = isDebug ? performance.now() : 0

      let id: string | null = null
      const partial: Partial<PartialResolvedId> = {}
      for (const plugin of getSortedPlugins('resolveId')) {
        if (!plugin.resolveId) continue

        ctx._activePlugin = plugin

        const pluginResolveStart = isDebug ? performance.now() : 0
        const handler =
          'handler' in plugin.resolveId
            ? plugin.resolveId.handler
            : plugin.resolveId
        const result = await handler.call(ctx as any, rawId, importer, {
          assertions: options?.assertions ?? {},
          isEntry: !!options?.isEntry,
        })
        if (!result) continue

        if (typeof result === 'string') {
          id = result
        } else {
          id = result.id
          Object.assign(partial, result)
        }

        break
      }

      if (id) {
        partial.id = isExternalUrl(id) ? id : normalizePath(id)
        return partial as PartialResolvedId
      } else {
        return null
      }
    },

    async load(id) {
      const ctx = new Context()
      for (const plugin of getSortedPlugins('load')) {
        if (!plugin.load) continue
        ctx._activePlugin = plugin
        const handler =
          'handler' in plugin.load ? plugin.load.handler : plugin.load
        const result = await handler.call(ctx as any, id)
        if (result != null) {
          if (isObject(result)) {
            updateModuleInfo(id, result)
          }
          return result
        }
      }
      return null
    },

    async transform(code, id, options) {
      const inMap = options?.inMap
      const ctx = new TransformContext(id, code, inMap as SourceMap)
      for (const plugin of getSortedPlugins('transform')) {
        if (!plugin.transform) continue
        ctx._activePlugin = plugin
        ctx._activeId = id
        ctx._activeCode = code
        let result: TransformResult | string | undefined
        const handler =
          'handler' in plugin.transform
            ? plugin.transform.handler
            : plugin.transform
        try {
          result = await handler.call(ctx as any, code, id)
        } catch (e) {
          ctx.error(e)
        }
        if (!result) continue
        if (isObject(result)) {
          if (result.code !== undefined) {
            code = result.code
            if (result.map) {
              if (isDebugSourcemapCombineFocused) {
                // @ts-expect-error plugin name for debug purpose
                result.map.name = plugin.name
              }
              ctx.sourcemapChain.push(result.map)
            }
          }
          updateModuleInfo(id, result)
        } else {
          code = result
        }
      }
      return {
        code,
        map: ctx._getCombinedSourcemap(),
      }
    },

    async close() {
      if (closed) return
      const ctx = new Context()
      await hookParallel(
        'buildEnd',
        () => ctx,
        () => [],
      )
      await hookParallel(
        'closeBundle',
        () => ctx,
        () => [],
      )
      closed = true
    },
  }

  return container
}
