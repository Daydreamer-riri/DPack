import type {
  CustomPluginOptions,
  ObjectHook,
  Plugin as RollupPlugin,
  PluginContext,
  ResolveIdResult,
} from 'rollup'
import type { UserConfig } from './config'
export type { PluginContext } from 'rollup'
import type { ServerHook, DpackDevServer } from './server'

export interface Plugin extends RollupPlugin {
  /**
   * 只在服务或构建，或在某些条件下应用该插件。
   */
  apply?: 'serve' | 'build'
  /**
   * 配置dpack服务。 这个hooks接收 {@link DpackDevServer} 实例。
   * 这也可以用来存储对服务器的引用，以便在其他hooks中使用。
   *
   * 这个hooks将在内部中间件被应用之前被调用。 hooks可以是异步函数，将被串联调用。
   */
  configureServer?: ObjectHook<ServerHook>
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
