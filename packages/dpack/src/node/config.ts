import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'
import { createRequire } from 'node:module'
import colors from 'picocolors'
import { createLogger, Logger, LogLevel } from './logger'
import type { HookHandler, Plugin } from './plugin'
import type { ESBuildOptions } from './plugins/esbuild'
import {
  ResolvedServerOptions,
  resolveServerOptions,
  ServerOptions,
} from './server'
import { DEFAULT_CONFIG_FILES } from './constants'
import type { RollupOptions } from 'rollup'
import {
  createFilter,
  isObject,
  lookupFile,
  mergeConfig,
  normalizePath,
} from './utils'
import { debug } from 'node:console'
import {
  BuildOptions,
  resolveBuildOptions,
  ResolvedBuildOptions,
} from './build'
import { ESBUILD_MODULES_TARGET } from './constants'
import { resolvePlugins } from './plugins'

export interface ConfigEnv {
  command: 'build' | 'serve'
  mode: string
  /**
   * @experimental
   */
  ssrBuild?: boolean
}

export type AppType = 'spa' | 'mpa' | 'custom'

export type UserConfigFn = (env: ConfigEnv) => UserConfig | Promise<UserConfig>
export type UserConfigExport = UserConfig | Promise<UserConfig> | UserConfigFn

export type PluginOption =
  | Plugin
  | false
  | null
  | undefined
  | PluginOption[]
  | Promise<Plugin | false | null | undefined | PluginOption[]>

export interface UserConfig {
  /**
   * 项目根目录
   * @default process.cwd()
   */
  root?: string
  /**
   * 基本公共路径
   * @default '/'
   */
  base?: string
  /**
   * 静态资源目录
   */
  publicDir?: string | false
  /**
   * 缓存目录，包含生成文件与依赖预构建文件
   * @default 'node_modules/.dpack'
   */
  // cacheDir?: string
  mode?: string
  /**
   * 定义全局变量的替换。
   * 条目将在开发过程中定义在`window`上，并在构建过程中替换。
   */
  define?: Record<string, any>
  /**
   * 要使用的插件阵列。
   */
  plugins?: PluginOption[]
  // TODO:
  /**
   * 配置 resolver
   */
  // resolve?: ResolveOptions & { alias?: AliasOptions }
  // css?: CSSOptions
  // json?: JsonOptions
  esbuild?: ESBuildOptions | false
  /**
   * 指定额外的picomatch模式，作为静态资产处理。
   */
  assetsInclude?: string | RegExp | (string | RegExp)[]
  /**
   * 服务器的具体选项，如host、port、https...
   */
  server?: ServerOptions
  build?: BuildOptions
  // preview?: PreviewOptions
  // ssr?: SSROptions
  /**
   * Log level.
   * @default: 'info'
   */
  logLevel?: LogLevel
  /**
   * @default true
   */
  clearScreen?: boolean
  /**
   * @default root
   */
  envDir?: string
  /**
   * 以 "envPrefix "开头的环境变量将通过import.meta.env暴露给你的客户端源代码。
   */
  enPrefix?: string | string[]
  /**
   * @default 'spa'
   */
  appType?: AppType
}

export interface ResolveWorkerOptions extends PluginHookUtils {
  format: 'es' | 'iife'
  plugins: Plugin[]
  rollupOptions: RollupOptions
}

export interface InlineConfig extends UserConfig {
  configFile?: string | false
  envFile?: false
}

export type ResolvedConfig = Readonly<
  Omit<UserConfig, 'plugins' | 'assetsInclude'> & {
    configFile: string | undefined
    configFileDependencies: string[]
    inlineConfig: InlineConfig
    root: string
    base: string
    /** @internal */
    rawBase: string
    publicDir: string
    cacheDir: string
    command: 'build' | 'serve'
    mode: string
    isWorker: boolean
    // TODO: more
    plugins: readonly Plugin[]
    server: ResolvedServerOptions
    build: ResolvedBuildOptions
    // preview: ResolvedPreviewOptions
    // ssr: ResolvedSSROptions
    // assetsInclude: (file: string) => boolean
    logger: Logger
  } & PluginHookUtils
>

export interface PluginHookUtils {
  getSortedPlugins: (hookName: keyof Plugin) => Plugin[]
  getSortedPluginHooks: <K extends keyof Plugin>(
    hookName: K,
  ) => NonNullable<HookHandler<Plugin[K]>>[]
}

export type ResolveFn = (
  id: string,
  importer?: string,
  aliasOnly?: boolean,
  ssr?: boolean,
) => Promise<string | undefined>

export async function resolveConfig(
  inlineConfig: InlineConfig,
  command: 'build' | 'serve',
  defaultMode = 'development',
  defaultNodeEnv = 'development',
): Promise<ResolvedConfig> {
  let config = inlineConfig
  let configFileDependencies: string[] = []
  let mode = inlineConfig.mode || defaultMode
  const isNodeEnvSet = !!process.env.NODE_ENV

  if (!isNodeEnvSet) {
    process.env.NODE_ENV = defaultNodeEnv
  }

  const configEnv = {
    mode,
    command,
  }

  let { configFile } = config
  if (configFile !== false) {
    // const loadResult = await
  }

  mode = inlineConfig.mode || config.mode || mode
  config.mode = mode

  const filterPlugin = (p: Plugin) => {
    if (!p) {
      return false
    } else if (!p.apply) {
      return true
    } else if (typeof p.apply === 'function') {
      // return p.apply()
    } else {
      return (p.apply = command)
    }
  }

  // plugin 相关 TODO:
  // ..........

  // 定义 logger
  const logger = createLogger(config.logLevel, {
    allowClearScreen: config.clearScreen,
  })

  // 解析 root
  const resolvedRoot = normalizePath(
    config.root ? path.resolve(config.root) : process.cwd(),
  )

  // const clientAlias = [
  //   { find: /^\/?@dpack\/env/, replacement: ENV_ENTRY },
  //   { find: /^\/?@dpack\/client/, replacement: CLIENT_ENTRY },
  // ]

  // const resolveOptions: ResolvedConfig['resolve']

  // env 相关 TODO:
  const envDir = config.envDir
    ? normalizePath(path.resolve(resolvedRoot, config.envDir))
    : resolvedRoot
  // const userEnv = inlineConfig.envFile !== false & load

  const isProduction = process.env.NODE_ENV === 'production'

  const isBuild = command === 'build'
  const relativeBaseShortcut = config.base === '' || config.base === './'
  const resolvedBase = relativeBaseShortcut
    ? !isBuild
      ? '/'
      : './'
    : resolveBaseUrl(config.base, isBuild, logger) ?? '/'

  const resolvedBuildOptions = resolveBuildOptions(config.build, logger)

  // resolve cache dir
  const pkgPath = lookupFile(resolvedRoot, ['package.json'], { pathOnly: true })
  const cacheDir = normalizePath(
    pkgPath
      ? path.join(path.dirname(pkgPath), `node_modules/.dpack`)
      : path.join(resolvedRoot, `.dpack`),
  )

  const assetsFilter =
    config.assetsInclude &&
    (!Array.isArray(config.assetsInclude) || config.assetsInclude.length)
      ? createFilter(config.assetsInclude)
      : () => false

  // createResolver TODO:

  const { publicDir } = config
  const resolvedPublicDir =
    publicDir !== false && publicDir !== ''
      ? path.resolve(
          resolvedRoot,
          typeof publicDir === 'string' ? publicDir : 'public',
        )
      : ''

  const server = resolveServerOptions(resolvedRoot, config.server, logger)

  const middlewareMode = config?.server?.middlewareMode

  const BADE_URL = resolvedBase

  // worker TODO:
  // let workerConfig = mergeConfig({}, config)
  // const resolvedWorkerOptions: ResolveWorkerOptions = {
  //   format: 'es',
  //   plugins: [],
  //   rollupOptions: workerConfig.worker
  // }

  const resolvedConfig: ResolvedConfig = {
    configFile: configFile ? normalizePath(configFile) : void 0,
    configFileDependencies: configFileDependencies.map((name) =>
      normalizePath(path.resolve(name)),
    ),
    inlineConfig,
    root: resolvedRoot,
    base: resolvedBase.endsWith('/') ? resolvedBase : resolvedBase + '/',
    rawBase: resolvedBase,
    // resolve
    publicDir: resolvedPublicDir,
    cacheDir,
    command,
    mode,
    isWorker: false,
    plugins: [],
    server,
    build: resolvedBuildOptions,
    logger,
    appType: config.appType ?? 'spa',
    getSortedPluginHooks: undefined!,
    getSortedPlugins: undefined!,
  }

  const resolved: ResolvedConfig = {
    ...config,
    ...resolvedConfig,
  }

  ;(resolved.plugins as Plugin[]) = await resolvePlugins(resolved)

  return resolved
}

/**
 * 解析 base url
 */
export function resolveBaseUrl(
  base: UserConfig['base'] = '/',
  isBuild: boolean,
  logger: Logger,
): string {
  if (base.startsWith('.')) {
    logger.warn(
      colors.yellow(
        colors.bold(
          `(!) 无效的 "base "选项：${base}. 该值只能是一个绝对` +
            `URL，./，或一个空字符串。`,
        ),
      ),
    )
    return '/'
  }

  return base
}

export async function loadConfigFromFile(
  configEnv: ConfigEnv,
  configFile?: string,
  configRoot: string = process.cwd(),
  logLevel?: LogLevel,
): Promise<{
  path: string
  config: UserConfig
  dependencies: string[]
} | null> {
  const start = performance.now()
  const getTime = () => `${(performance.now() - start).toFixed(2)}ms`

  let resolvedPath: string | undefined

  if (configFile) {
    resolvedPath = path.resolve(configFile)
  } else {
    for (const filename of DEFAULT_CONFIG_FILES) {
      const filePath = path.resolve(configRoot, filename)
      if (!fs.existsSync(filePath)) continue

      resolvedPath = filePath
      break
    }
  }

  if (!resolvedPath) {
    console.error('no config file found.')
    return null
  }

  let isESM = false
  if (/\.m[jt]s$/.test(resolvedPath)) {
    isESM = true
  } else if (/\.j[jt]s$/.test(resolvedPath)) {
    isESM = false
  } else {
    try {
      const pkg = lookupFile(configRoot, ['package.json'])
      isESM = !!pkg && JSON.parse(pkg).type === 'module'
    } catch (e) {}
  }

  try {
    const bundled = await bundleConfigFile(resolvedPath, isESM)
    const userConfig = await loadConfigFromBundledFile(
      resolvedPath,
      bundled.code,
      isESM,
    )
    debug(`bundled config file loaded in ${getTime()}`)

    const config = await (typeof userConfig === 'function'
      ? userConfig(configEnv)
      : userConfig)
    if (!isObject(config)) {
      throw new Error(`config must export or return an object.`)
    }
    return {
      path: normalizePath(resolvedPath),
      config,
      dependencies: bundled.dependencies,
    }
  } catch (e) {
    createLogger(logLevel).error(
      colors.red(`failed to load config from ${resolvedPath}`),
      { error: e },
    )
    throw e
  }
}

function bundleConfigFile(resolvedPath: string, isESM: boolean): any {
  throw new Error('Function not implemented.')
}

function loadConfigFromBundledFile(a: string, b: string, c: boolean): any {}
