import type { Connect } from 'dep-types/connect'
import type { InlineConfig, ResolvedConfig } from '../config'
import {
  CommonServerOptions,
  resolveHttpServer,
  setClientErrorHandler,
} from '../http'
import type { HmrOptions } from './hmr'
import type * as http from 'node:http'
import chokidar from 'chokidar'
import type { FSWatcher, WatchOptions } from 'dep-types/chokidar'
import picomatch from 'picomatch'
import type { Matcher } from 'picomatch'
import type { ModuleNode } from './moduleGraph'
import { ModuleGraph } from './moduleGraph'
import type { TransformOptions, TransformResult } from './transformRequest'
import connect from 'connect'
import { createWebSocketServer } from './ws'
import path from 'node:path'

export interface ServerOptions extends CommonServerOptions {
  /**
   * HMR-specific 配置项 (port, host, path & protocol)
   */
  hmr?: HmrOptions | boolean
  /**
   * chokidar watch 配置项
   * https://github.com/paulmillr/chokidar#api
   */
  watch?: WatchOptions
  /**
   * 创建dpack开发服务器，用作现有服务器中的中间件
   */
  middlewareMode?: boolean | 'html' | 'ssr'
  /**
   * 将此文件夹预先添加到http请求，以便在代理dpack作为子文件夹时使用
   * 以 `/` 开头和结尾
   */
  base?: string
  /**
   * 文件服务选项 '/\@fs/'.
   */
  fs?: FileSystemServeOptions
  /**
   * 生成静态资源URL的源
   *
   * @example `http://127.0.0.1:8080`
   */
  origin?: string
  /**
   * @default true
   */
  preTransformRequests?: boolean
}

export interface ResolvedServerOptions extends ServerOptions {
  fs: Required<FileSystemServeOptions>
  middlewareMode: boolean
}

export interface FileSystemServeOptions {
  /**
   * 严格限制允许路径之外的文件访问
   * @default true
   */
  strict?: boolean

  /**
   * 限制访问允许目录以外的文件。
   *
   * 接受绝对路径或相对于项目根的路径。
   * 将尝试默认搜索到根工作区。
   */
  allow?: string[]

  /**
   * 限制对符合模式的文件的访问。
   *
   * 这将比`allow`具有更高的优先权。
   * 支持picomatch模式。
   *
   * @default ['.env', '.env.*', '*.crt', '*.pem']
   */
  deny?: string[]
}

export interface DpackDevServer {
  /**
   * 解析的config
   */
  config: ResolvedConfig
  /**
   * 一个连接应用实例。
   * - 可用于将自定义的中间件附加到开发服务器上。
   * - 也可以作为自定义http服务器的处理函数
   *   或作为任何连接式Node.js框架的中间件
   *
   * https://github.com/senchalabs/connect#use-middleware
   */
  middlewares: Connect.Server
  /**
   * 本地Node http服务器实例
   * 在中间件模式下将为空
   */
  httpServer: http.Server | null
  /**
   * chokidar watcher instance
   * https://github.com/paulmillr/chokidar#api
   */
  watcher: FSWatcher
  /**
   * TODO:
   * web socket server with `send(payload)` method
   */
  // ws: WebSocketServer
  /**
   * TODO:
   * Rollup plugin container that can run plugin hooks on a given file
   */
  // pluginContainer: PluginContainer
  /**
   * 追踪import关系的模块图，URL到文件的映射和 hmr 状态。
   */
  moduleGraph: ModuleGraph
  /**
   * 在CLI上打印出的已解决的Url
   */
  resolvedUrls: ResolvedServerUrls | null
  /**
   * 以编程方式解析、加载和转换一个URL并获得结果
   * 而不需要通过http请求管道。
   */
  transformRequest(
    url: string,
    options?: TransformOptions,
  ): Promise<TransformResult | null>
  /**
   * 应用内置的HTML转换和任何插件的HTML转换。
   */
  transformIndexHtml(
    url: string,
    html: string,
    originalUrl?: string,
  ): Promise<string>
  /**
   * TODO: SSR 先不做
   * Transform module code into SSR format.
   */
  // ssrTransform(
  //   code: string,
  //   inMap: SourceMap | null,
  //   url: string,
  //   originalCode?: string,
  // ): Promise<TransformResult | null>
  /**
   * Load a given URL as an instantiated module for SSR.
   */
  // ssrLoadModule(
  //   url: string,
  //   opts?: { fixStacktrace?: boolean },
  // ): Promise<Record<string, any>>
  /**
   * Returns a fixed version of the given stack
   */
  // ssrRewriteStacktrace(stack: string): string
  /**
   * Mutates the given SSR error by rewriting the stacktrace
   */
  // ssrFixStacktrace(e: Error): void
  /**
   * 触发模块图中某个模块的HMR。你可以使用 `server.moduleGraph`来检索要重新加载的模块
   */
  reloadModule(module: ModuleNode): Promise<void>
  /**
   * 启动服务
   */
  listen(port?: number, isRestart?: boolean): Promise<DpackDevServer>
  /**
   * 停止服务
   */
  close(): Promise<void>
  /**
   * 打印服务urls
   */
  printUrls(): void
  /**
   * 重启服务
   *
   * @param forceOptimize - force the optimizer to re-bundle, same as --force cli flag
   */
  restart(forceOptimize?: boolean): Promise<void>
  /**
   * @internal
   */
  _importGlobMap: Map<string, string[][]>
  // /**
  //  * Deps that are externalized
  //  * @internal
  //  */
  // _ssrExternals: string[] | null
  /**
   * @internal
   */
  _restartPromise: Promise<void> | null
  /**
   * @internal
   */
  _forceOptimizeOnRestart: boolean
  /**
   * @internal
   */
  _pendingRequests: Map<
    string,
    {
      request: Promise<TransformResult | null>
      timestamp: number
      abort: () => void
    }
  >
  /**
   * @internal
   */
  _fsDenyGlob: Matcher
}

export interface ResolvedServerUrls {
  local: string[]
  network: string[]
}

export async function createServer(
  inlineConfig: InlineConfig = {},
): Promise<DpackDevServer> {
  // const config = await resolveConfig
  // const { middlewareMode } = serverConfig
  // TODO:
  const config: any = {}
  const middlewareMode = false
  const serverConfig = {}
  const httpsOptions = {}
  const root = process.cwd()

  const middlewares = connect() as Connect.Server
  const httpServer = middlewareMode
    ? null
    : await resolveHttpServer(serverConfig, middlewares, httpsOptions)
  const ws = createWebSocketServer(httpServer, config, httpsOptions)

  if (httpServer) {
    setClientErrorHandler(httpServer, config.logger)
  }

  const watcher = chokidar.watch(path.resolve(root)) // TODO:options
}
