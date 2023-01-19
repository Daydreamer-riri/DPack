import type { ObjectHook, Plugin as RollupPlugin } from 'rollup'
import type { UserConfig } from './config'
export type { PluginContext } from 'rollup'

export interface Plugin extends RollupPlugin {
  /**
   * Apply the plugin only for serve or build, or on certain conditions.
   */
  apply?: 'serve' | 'build'
  // | ((this: void, config: UserConfig, env: ConfigEnv) => boolean)
}

export type HookHandler<T> = T extends ObjectHook<infer H> ? H : T
