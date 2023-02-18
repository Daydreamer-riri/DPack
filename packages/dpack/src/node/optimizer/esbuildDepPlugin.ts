import path from 'node:path'
import type { ImportKind, Plugin } from 'esbuild'
import { KNOWN_ASSET_TYPES } from '../constants'
import { getDepOptimizationConfig, ResolvedConfig } from '../config'
import { browserExternalId, optionalPeerDepId } from '../plugins/resolve'
import { normalizePath } from '../utils'

const externalWithConversionNamespace =
  'dpack:dep-pre-bundle:external-conversion'
const convertedExternalPrefix = 'dpack-dep-pre-bundle-external:'

const cjsExternalFacadeNamespace = 'dpack:cjs-external-facade'
const nonFacadePrefix = 'dpack-cjs-external-facade'

const externalTypes = [
  'css',
  // supported pre-processor types
  'less',
  'sass',
  'scss',
  'styl',
  'stylus',
  'pcss',
  'postcss',
  // wasm
  'wasm',
  // SFC types
  'vue',
  'svelte',
  'marko',
  'astro',
  'imba',
  // JSX/TSX可能被配置成与esbuild默认处理方式不同的编译方式，所以也要排除它们。
  'jsx',
  'tsx',
  ...KNOWN_ASSET_TYPES,
]

export function esbuildDepPlugin(
  qualified: Record<string, string>,
  external: string[],
  config: ResolvedConfig,
): Plugin {
  // const {} = getDepOptimizationConfig(config)
  const allExternalTypes = externalTypes

  // 默认的解析器，它更倾向于ESM
  const _resolve = config.createResolver({ asSrc: false, scan: true })

  // 偏爱Node的cjs解析器
  const _resolveRequire = config.createResolver({
    asSrc: false,
    isRequire: true,
    scan: true,
  })

  const resolve = (
    id: string,
    importer: string,
    kind: ImportKind,
    resolveDir?: string,
  ): Promise<string | undefined> => {
    let _importer: string
    // explicit resolveDir - 这只在yarn pnp解析条目时传递。
    if (resolveDir) {
      _importer = normalizePath(path.join(resolveDir, '*'))
    } else {
      // 将importer的ID映射到文件路径以获得正确的解析
      _importer = importer in qualified ? qualified[importer] : importer
    }
  }
}
