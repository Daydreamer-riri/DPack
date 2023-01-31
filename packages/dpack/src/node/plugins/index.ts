// import type { Plugin } from '../plugin'

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
