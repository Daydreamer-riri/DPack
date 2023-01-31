import fs from 'node:fs'
import { join } from 'node:path'
import { Performance } from 'node:perf_hooks'
import { VERSION as rollupVersion } from 'rollup'
import type {
  MinimalPluginContext,
  ModuleInfo,
  InputOptions,
  PartialResolvedId,
  SourceDescription,
  LoadResult,
  PluginContext as RollupPluginContext,
  FunctionPluginHooks,
  AsyncPluginHooks,
  ParallelPluginHooks,
} from 'rollup'
import type { Plugin } from '../plugin'
import type { FSWatcher } from 'chokidar'
import type { ResolvedConfig } from '../config'
import type { ModuleGraph } from './moduleGraph'

export interface PluginContainer {
  options: InputOptions
  getModuleInfo(id: string): ModuleInfo | null
  buildStart(options: InputOptions): Promise<void>
  resolvedId(id: string, importer?: string): Promise<PartialResolvedId | null>
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

export async function CreatePluginContainer(
  config: ResolvedConfig,
  moduleGraph?: ModuleGraph,
  watcher?: FSWatcher,
): Promise<PluginContainer> {
  const isDebug = process.env.DEBUG
  const { plugins, logger, root } = config
  // const { getSortedPluginHooks, getSortedPlugins } =
  //   createPluginHookUtils(plugins)

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

  // parallel, ignores returns
  // async function hookParallel<H extends AsyncPluginHooks & ParallelPluginHooks>(
  //   hookName: H,
  //   context: (plugin: Plugin) => ThisType<FunctionPluginHooks[H]>,
  //   args: (plugin: Plugin) => Parameters<FunctionPluginHooks[H]>,
  // ): Promise<void> {
  //   const parallelPromises: Promise<unknown>[] = []
  //   for (const plugin of getSortedPlugins(hookName)) {
  //     const hook = plugin[hookName]
  //     if (!hook) continue
  //     const handler: Function = 'handler' in hook ? hook.handler : hook
  //     if ((hook as { sequential?: boolean }).sequential) {
  //       await Promise.all(parallelPromises)
  //       parallelPromises.length = 0
  //       await handler.apply(context(plugin), args(plugin))
  //     } else {
  //       parallelPromises.push(handler.apply(context(plugin), args(plugin)))
  //     }
  //   }
  //   await Promise.all(parallelPromises)
  // }

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

  const container: any = {
    options: {},
    getModuleInfo,

    async buildStart() {},
    // resolvedId(id, importer?) {
    //   const a: any = null
    //   return a
    // },

    // async resolvedId(rawId, importer = join(root, 'index.html')) {

    // },
  }
  return container
}
