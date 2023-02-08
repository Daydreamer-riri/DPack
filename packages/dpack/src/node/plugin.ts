import type {
  CustomPluginOptions,
  ObjectHook,
  Plugin as RollupPlugin,
  PluginContext,
  ResolveIdResult,
} from 'rollup'
import type { UserConfig } from './config'
export type { PluginContext } from 'rollup'

export interface Plugin extends RollupPlugin {
  /**
   * Apply the plugin only for serve or build, or on certain conditions.
   */
  apply?: 'serve' | 'build'
  // | ((this: void, config: UserConfig, env: ConfigEnv) => boolean)
  resolveId?: ObjectHook<
    (
      this: PluginContext,
      source: string,
      importer: string | undefined,
      options: {
        assertions: Record<string, string>
        custom?: CustomPluginOptions
        /**
         * @internal
         */
        scan?: boolean
        isEntry: boolean
      },
    ) => Promise<ResolveIdResult> | ResolveIdResult
  >
}

export type HookHandler<T> = T extends ObjectHook<infer H> ? H : T
