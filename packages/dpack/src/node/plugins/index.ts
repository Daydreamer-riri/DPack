import type { HookHandler, Plugin } from '../plugin'
import type { PluginHookUtils, ResolvedConfig } from '../config'
import { importAnalysisPlugin } from './importAnalysis'

// export function createPluginHookUtils(
//   plugins: readonly Plugin[],
// ): PluginHookUtils {
//   // sort plugins per hook
//   const sortedPluginsCache = new Map<keyof Plugin, Plugin[]>()
//   function getSortedPlugins(hookName: keyof Plugin): Plugin[] {
//     if (sortedPluginsCache.has(hookName))
//       return sortedPluginsCache.get(hookName)!
//     const sorted = getSortedPluginsByHook(hookName, plugins)
//     sortedPluginsCache.set(hookName, sorted)
//     return sorted
//   }
//   function getSortedPluginHooks<K extends keyof Plugin>(
//     hookName: K,
//   ): NonNullable<HookHandler<Plugin[K]>>[] {
//     const plugins = getSortedPlugins(hookName)
//     return plugins
//       .map((p) => {
//         const hook = p[hookName]!
//         return typeof hook === 'object' && 'handler' in hook
//           ? hook.handler
//           : hook
//       })
//       .filter(Boolean)
//   }

//   return {
//     getSortedPlugins,
//     getSortedPluginHooks,
//   }
// }

export async function resolvePlugins(
  config: ResolvedConfig,
  // prePlugins: Plugin[],
  // normalPlugins: Plugin[],
  // postPlugins: Plugin[],
) {
  const isBuild = config.command === 'build'

  return [...(isBuild ? [] : [importAnalysisPlugin(config)])]
}

export function createPluginHookUtils(
  plugins: readonly Plugin[],
): PluginHookUtils {
  // sort plugins per hook
  const sortedPluginsCache = new Map<keyof Plugin, Plugin[]>()
  function getSortedPlugins(hookName: keyof Plugin): Plugin[] {
    if (sortedPluginsCache.has(hookName))
      return sortedPluginsCache.get(hookName)!
    const sorted = getSortedPluginsByHook(hookName, plugins)
    sortedPluginsCache.set(hookName, sorted)
    return sorted
  }
  function getSortedPluginHooks<K extends keyof Plugin>(
    hookName: K,
  ): NonNullable<HookHandler<Plugin[K]>>[] {
    const plugins = getSortedPlugins(hookName)
    return plugins
      .map((p) => {
        const hook = p[hookName]!
        // @ts-expect-error cast
        return 'handler' in hook ? hook.handler : hook
      })
      .filter(Boolean)
  }

  return {
    getSortedPlugins,
    getSortedPluginHooks,
  }
}

export function getSortedPluginsByHook(
  hookName: keyof Plugin,
  plugins: readonly Plugin[],
): Plugin[] {
  const pre: Plugin[] = []
  const normal: Plugin[] = []
  const post: Plugin[] = []
  for (const plugin of plugins) {
    const hook = plugin[hookName]
    if (hook) {
      if (typeof hook === 'object') {
        if (hook.order === 'pre') {
          pre.push(plugin)
          continue
        }
        if (hook.order === 'post') {
          post.push(plugin)
          continue
        }
      }
      normal.push(plugin)
    }
  }
  return [...pre, ...normal, ...post]
}
