import fs from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import glob from 'fast-glob'
import type { Loader, OnLoadResult, Plugin } from 'esbuild'
import { build, transform } from 'esbuild'
import colors from 'picocolors'
import type { ResolvedConfig } from '../config'
import {
  CSS_LANGS_RE,
  JS_TYPES_RE,
  KNOWN_ASSET_TYPES,
  SPECIAL_QUERY_RE,
} from '../constants'
import { createPluginContainer } from '../server/pluginContainer'

const htmlTypesRE = /\.(html|vue|svelte|astro|imba)$/

export const importsRE =
  /(?<!\/\/.*)(?<=^|;|\*\/)\s*import(?!\s+type)(?:[\w*{}\n\r\t, ]+from)?\s*("[^"]+"|'[^']+')\s*(?=$|;|\/\/|\/\*)/gm

export async function scanImports(
  config: ResolvedConfig,
): Promise<{ deps: Record<string, string>; missing: Record<string, string> }> {
  const start = performance.now()

  let entries: string[] = []

  // NOTE: 暂时不做
  // const explicitEntryPatterns = config.optimizeDeps.entries
  // const buildInput = config.build.rollupOptions?.input

  entries = await globEntries('**/*.html', config)
  entries = entries.filter(
    (entry) => isScannable(entry) && fs.existsSync(entry),
  )

  if (!entries.length) {
    config.logger.warn(
      colors.yellow('(!) 无法从rollupOptions或html文件中自动确定入口点'),
    )
    return { deps: {}, missing: {} }
  }

  const deps: Record<string, string> = {}
  const missing: Record<string, string> = {}
  const container = await createPluginContainer(config)
  // const plugin: any = esbuildScanPlugin(
  //   config,
  //   container,
  //   deps,
  //   missing,
  //   entries,
  // )

  const { plugins = [], ...esbuildOptions } =
    config.optimizeDeps?.esbuildOptions ?? {}

  await build({
    absWorkingDir: process.cwd(),
    write: false,
    // 模拟文件进行import
    stdin: {
      contents: entries.map((e) => `import ${JSON.stringify(e)}`).join('\n'),
      loader: 'js',
    },
    bundle: true,
    format: 'esm',
    logLevel: 'error',
    // plugins: [...plugins, plugin],
    ...esbuildOptions,
  })

  config.logger.info(
    `Scan completed in ${(performance.now() - start).toFixed(2)}ms`,
    deps,
  )
  return {
    // 确保一个固定的顺序，这样哈希值才会稳定并改善日志。
    deps,
    // deps: orderedDependencies(deps),
    missing,
  }
}

function globEntries(pattern: string | string[], config: ResolvedConfig) {
  return glob(pattern, {
    cwd: config.root,
    ignore: ['**/node_modules/**', '**/__tests__/**', '**/coverage/**'],
    absolute: true,
    suppressErrors: true,
  })
}

function isScannable(id: string): boolean {
  return JS_TYPES_RE.test(id) || htmlTypesRE.test(id)
}

function esbuildScanPlugin() {}
