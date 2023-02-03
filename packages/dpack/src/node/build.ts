import type { RollupOptions, WatcherOptions } from 'rollup'
import type { TransformOptions } from 'esbuild'
import { mergeConfig } from './utils'
import { ESBUILD_MODULES_TARGET } from './constants'
import type { Logger } from './logger'

export interface BuildOptions {
  target?: 'modules' | TransformOptions['target'] | false
  /**
   * @default true
   */
  modulePreload?: boolean
  /**
   * @default 'dist
   */
  outDir?: string
  /**
   * @default 'assets
   */
  assetsDir?: string
  /**
   * Static asset files smaller than this number (in bytes) will be inlined as
   * base64 strings. Default limit is `4096` (4kb). Set to `0` to disable.
   * @default 4096
   */
  assetsInlineLimit?: number
  /**
   * Whether to code-split CSS. When enabled, CSS in async chunks will be
   * inlined as strings in the chunk and inserted via dynamically created
   * style tags when the chunk is loaded.
   * @default true
   */
  cssCodeSplit?: boolean
  /**
   * An optional separate target for CSS minification.
   * As esbuild only supports configuring targets to mainstream
   * browsers, users may need this option when they are targeting
   * a niche browser that comes with most modern JavaScript features
   * but has poor CSS support, e.g. Android WeChat WebView, which
   * doesn't support the #RGBA syntax.
   */
  cssTarget?: TransformOptions['target'] | false
  /**
   * Will be merged with internal rollup options.
   * https://rollupjs.org/guide/en/#big-list-of-options
   */
  rollupOptions?: RollupOptions
  // /**
  //  * Options to pass on to `@rollup/plugin-dynamic-import-vars`
  //  */
  // dynamicImportVarsOptions?: RollupDynamicImportVarsOptions
  /**
   * Whether to write bundle to disk
   * @default true
   */
  write?: boolean
  /**
   * Empty outDir on write.
   * @default true when outDir is a sub directory of project root
   */
  emptyOutDir?: boolean | null
  /**
   * Rollup watch options
   * https://rollupjs.org/guide/en/#watchoptions
   */
  watch?: WatcherOptions | null
}

export interface ResolvedBuildOptions extends Required<BuildOptions> {}

export function resolveBuildOptions(
  raw: BuildOptions | undefined,
  logger: Logger,
): ResolvedBuildOptions {
  const modulePreload = raw?.modulePreload
  const defaultModulePreload = {
    polyfill: true,
  }

  const defaultBuildOptions: BuildOptions = {
    outDir: 'dist',
    assetsDir: 'assets',
    assetsInlineLimit: 4096,
    cssCodeSplit: false,
    rollupOptions: {},
    write: true,
    emptyOutDir: null,
    watch: null,
  }

  const userBuildOptions = raw
    ? mergeConfig(defaultBuildOptions, raw)
    : defaultBuildOptions

  // @ts-expect-error Fallback options instead of merging
  const resolved: ResolvedBuildOptions = {
    target: 'modules',
    cssTarget: false,
    ...userBuildOptions,
    // modulePreload:
  }

  if (resolved.target === 'modules') {
    resolved.target = ESBUILD_MODULES_TARGET
  }

  if (!resolved.cssTarget) {
    resolved.cssTarget = resolved.target
  }

  return resolved
}
