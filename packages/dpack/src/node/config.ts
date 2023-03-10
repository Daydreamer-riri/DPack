import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'
import { build } from 'esbuild'
import colors from 'picocolors'
import aliasPlugin from '@rollup/plugin-alias'
import { createLogger, Logger, LogLevel } from './logger'
import type { HookHandler, Plugin } from './plugin'
import type { ESBuildOptions } from './plugins/esbuild'
import {
  ResolvedServerOptions,
  resolveServerOptions,
  ServerOptions,
} from './server'
import {
  CLIENT_ENTRY,
  DEFAULT_ASSETS_RE,
  DEFAULT_CONFIG_FILES,
  DEFAULT_EXTENSIONS,
  DEFAULT_MAIN_FIELDS,
  ENV_ENTRY,
} from './constants'
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
import { createPluginHookUtils, resolvePlugins } from './plugins'
import type { InternalResolveOptions, ResolveOptions } from './plugins/resolve'
import type { DepOptimizationConfig, DepOptimizationOptions } from './optimizer'
import type { PackageCache } from './packages'
import type { PluginContainer } from './server/pluginContainer'
import { createPluginContainer } from './server/pluginContainer'
import { resolvePlugin } from './plugins/resolve'
import type { Alias } from 'dep-types/alias'

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

export function defineConfig(config: UserConfigExport): UserConfigExport {
  return config
}

export type PluginOption =
  | Plugin
  | false
  | null
  | undefined
  | PluginOption[]
  | Promise<Plugin | false | null | undefined | PluginOption[]>

export interface UserConfig {
  /**
   * ???????????????
   * @default process.cwd()
   */
  root?: string
  /**
   * ??????????????????
   * @default '/'
   */
  base?: string
  /**
   * ??????????????????
   */
  publicDir?: string | false
  /**
   * ?????????????????????????????????????????????????????????
   * @default 'node_modules/.dpack'
   */
  // cacheDir?: string
  mode?: string
  /**
   * ??????????????????????????????
   * ????????????????????????????????????`window`????????????????????????????????????
   */
  define?: Record<string, any>
  /**
   * ???????????????????????????
   */
  plugins?: PluginOption[]
  /**
   * ?????? resolver
   */
  resolve?: ResolveOptions
  // css?: CSSOptions
  // json?: JsonOptions
  esbuild?: ESBuildOptions | false
  /**
   * ???????????????picomatch????????????????????????????????????
   */
  assetsInclude?: string | RegExp | (string | RegExp)[]
  /**
   * ??????????????????????????????host???port???https...
   */
  server?: ServerOptions
  build?: BuildOptions
  // preview?: PreviewOptions
  /**
   * Dep optimization options
   */
  optimizeDeps?: DepOptimizationOptions
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
   * ??? "envPrefix "??????????????????????????????import.meta.env????????????????????????????????????
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
    resolve: Required<ResolveOptions>
    logger: Logger
    createResolver: (options?: Partial<InternalResolveOptions>) => ResolveFn
    optimizeDeps: DepOptimizationOptions
    packageCache: PackageCache
    // preview: ResolvedPreviewOptions
    // ssr: ResolvedSSROptions
    assetsInclude: (file: string) => boolean
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
    const loadResult = await loadConfigFromFile(
      configEnv,
      configFile,
      config.root,
      config.logLevel,
    )

    if (loadResult) {
      config = mergeConfig(loadResult.config, config)
      configFile = loadResult.path
      configFileDependencies = loadResult.dependencies
    }
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

  // plugin ??????
  const rawUserPlugins = ((config.plugins || []) as Plugin[]).filter(
    filterPlugin,
  )

  const [prePlugins, normalPlugins, postPlugins] =
    sortUserPlugins(rawUserPlugins)

  // ?????? logger
  const logger = createLogger(config.logLevel, {
    allowClearScreen: config.clearScreen,
  })

  // ?????? root
  const resolvedRoot = normalizePath(
    config.root ? path.resolve(config.root) : process.cwd(),
  )

  const clientAlias = [
    { find: /^\/?@dpack\/env/, replacement: ENV_ENTRY },
    { find: /^\/?@dpack\/client/, replacement: CLIENT_ENTRY },
  ]

  const resolvedAlias: Alias[] = [
    ...clientAlias,
    ...(config.resolve?.alias || []),
  ]

  const resolveOptions: ResolvedConfig['resolve'] = {
    mainFields: config.resolve?.mainFields ?? DEFAULT_MAIN_FIELDS,
    conditions: config.resolve?.conditions ?? [],
    extensions: config.resolve?.extensions ?? DEFAULT_EXTENSIONS,
    dedupe: config.resolve?.dedupe ?? [],
    preserveSymlinks: config.resolve?.preserveSymlinks ?? false,
    alias: resolvedAlias,
  }

  // env ?????? TODO:
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

  // ???????????????????????????????????????????????????, e.g.
  // optimizer & handling css @imports
  const createResolver: ResolvedConfig['createResolver'] = (options) => {
    let aliasContainer: PluginContainer | undefined
    let resolverContainer: PluginContainer | undefined
    return async (id, importer, aliasOnly) => {
      let container: PluginContainer
      if (aliasOnly) {
        container =
          aliasContainer ||
          (aliasContainer = await createPluginContainer({
            ...resolved,
            plugins: [aliasPlugin({ entries: resolved.resolve.alias })],
          }))
      } else {
        container =
          resolverContainer ||
          (resolverContainer = await createPluginContainer({
            ...resolved,
            plugins: [
              aliasPlugin({ entries: resolved.resolve.alias }),
              resolvePlugin({
                ...resolved.resolve,
                root: resolvedRoot,
                isProduction,
                isBuild: command === 'build',
                asSrc: true,
                preferRelative: false,
                tryIndex: true,
                ...options,
              }),
            ],
          }))
      }
      return (
        await container.resolveId(id, importer, {
          scan: options?.scan,
        })
      )?.id
    }
  }

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

  const optimizeDeps = config.optimizeDeps || {}

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
    resolve: resolveOptions,
    publicDir: resolvedPublicDir,
    cacheDir,
    command,
    mode,
    isWorker: false,
    plugins: [],
    server,
    build: resolvedBuildOptions,
    assetsInclude(file: string) {
      return DEFAULT_ASSETS_RE.test(file) || assetsFilter(file)
    },
    logger,
    createResolver,
    packageCache: new Map(),
    optimizeDeps: {
      disabled: 'build',
      ...optimizeDeps,
      esbuildOptions: {
        preserveSymlinks: resolveOptions.preserveSymlinks,
        ...optimizeDeps.esbuildOptions,
      },
    },
    appType: config.appType ?? 'spa',
    getSortedPluginHooks: undefined!,
    getSortedPlugins: undefined!,
  }

  const resolved: ResolvedConfig = {
    ...config,
    ...resolvedConfig,
  }

  ;(resolved.plugins as Plugin[]) = await resolvePlugins(
    resolved,
    prePlugins,
    normalPlugins,
    postPlugins,
  )
  Object.assign(resolved, createPluginHookUtils(resolved.plugins))

  await Promise.all([
    ...resolved
      .getSortedPluginHooks('configResolved')
      .map((hook) => hook(resolved)),
  ])

  return resolved
}

/**
 * ?????? base url
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
          `(!) ????????? "base "?????????${base}. ???????????????????????????` +
            `URL???./???????????????????????????`,
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

async function bundleConfigFile(
  fileName: string,
  isESM: boolean = true,
): Promise<{ code: string; dependencies: string[] }> {
  const dirnameVarName = '__dpack_injected_original_dirname'
  const filenameVarName = '__dpack_injected_original_filename'
  const importMetaUrlVarName = '__dpack_injected_original_import_meta_url'
  const result = await build({
    absWorkingDir: process.cwd(),
    entryPoints: [fileName],
    outfile: 'out.js',
    write: false,
    target: ['node14.18', 'node16'],
    platform: 'node',
    bundle: true,
    format: isESM ? 'esm' : 'cjs',
    mainFields: ['main'],
    sourcemap: 'inline',
    metafile: true,
    define: {
      __dirname: dirnameVarName,
      __filename: filenameVarName,
      'import.meta.url': importMetaUrlVarName,
    },
  })
  const { text } = result.outputFiles[0]
  return {
    code: text,
    dependencies: result.metafile ? Object.keys(result.metafile.inputs) : [],
  }
}

async function loadConfigFromBundledFile(
  fileName: string,
  bundledCode: string,
): Promise<UserConfigExport> {
  const fileBase = `${fileName}.timestamp-${Date.now()}`
  const fileNameTmp = `${fileBase}.mjs`
  const fileUrl = `${pathToFileURL(fileBase)}.mjs`
  fs.writeFileSync(fileNameTmp, bundledCode)
  try {
    return (await import(fileUrl)).default
  } finally {
    try {
      fs.unlinkSync(fileNameTmp)
    } catch {
      // already removed if this function is called twice simultaneously
    }
  }
}
export function getDepOptimizationConfig(
  config: ResolvedConfig,
): DepOptimizationConfig {
  return config.optimizeDeps
}
export function isDepsOptimizerEnabled(config: ResolvedConfig): boolean {
  const { command } = config
  const { disabled } = getDepOptimizationConfig(config)
  return !(
    disabled === true ||
    (command === 'build' && disabled === 'build') ||
    (command === 'serve' && disabled === 'dev')
  )
}

export function sortUserPlugins(
  plugins: (Plugin | Plugin[])[] | undefined,
): [Plugin[], Plugin[], Plugin[]] {
  const prePlugins: Plugin[] = []
  const postPlugins: Plugin[] = []
  const normalPlugins: Plugin[] = []

  if (plugins) {
    plugins.flat().forEach((p) => {
      if (p.enforce === 'pre') prePlugins.push(p)
      else if (p.enforce === 'post') postPlugins.push(p)
      else normalPlugins.push(p)
    })
  }

  return [prePlugins, normalPlugins, postPlugins]
}
