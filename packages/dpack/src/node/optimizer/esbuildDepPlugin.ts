import path from 'node:path'
import type { ImportKind, Plugin } from 'esbuild'
import { KNOWN_ASSET_TYPES } from '../constants'
import { getDepOptimizationConfig, ResolvedConfig } from '../config'
import { browserExternalId, optionalPeerDepId } from '../plugins/resolve'
import {
  flattenId,
  isExternalUrl,
  moduleListContains,
  normalizePath,
} from '../utils'

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
    const resolver = kind.startsWith('require') ? _resolveRequire : _resolve
    return resolver(id, _importer, void 0)
  }

  const resolveResult = (id: string, resolved: string) => {
    if (resolved.startsWith(browserExternalId)) {
      return {
        path: id,
        namespace: 'browser-external',
      }
    }
    if (resolved.startsWith(optionalPeerDepId)) {
      return {
        path: resolved,
        namespace: 'optional-peer-dep',
      }
    }
    if (isExternalUrl(resolved)) {
      return {
        path: resolved,
        external: true,
      }
    }
    return {
      path: path.resolve(resolved),
    }
  }

  return {
    name: 'dpack:dep-pre-bundle',
    setup(build) {
      // 外部化常见的资源文件和 non-js 文件
      build.onResolve(
        {
          filter: new RegExp(`\\.(${allExternalTypes.join('|')})(\\?.*)?$`),
        },
        async ({ path: id, importer, kind }) => {
          if (id.startsWith(convertedExternalPrefix)) {
            return {
              path: id.slice(convertedExternalPrefix.length),
              external: true,
            }
          }

          const resolved = await resolve(id, importer, kind)
          if (resolved) {
            if (kind === 'require-call') {
              return {
                path: resolved,
                namespace: externalWithConversionNamespace,
              }
            }
            return {
              path: resolved,
              external: true,
            }
          }
        },
      )

      build.onLoad(
        { filter: /./, namespace: externalWithConversionNamespace },
        (args) => {
          return {
            contents:
              `export { default } from "${convertedExternalPrefix}${args.path}";` +
              `export * from "${convertedExternalPrefix}${args.path}"`,
            loader: 'js',
          }
        },
      )

      function resolveEntry(id: string) {
        const flatId = flattenId(id)
        if (flatId in qualified) {
          return {
            path: qualified[flatId],
          }
        }
      }

      build.onResolve(
        { filter: /^[\w@][^:]/ },
        async ({ path: id, importer, kind }) => {
          if (moduleListContains(external, id)) {
            return {
              path: id,
              external: true,
            }
          }

          let entry: { path: string } | undefined
          if (!importer) {
            if ((entry = resolveEntry(id))) return entry
            // 检查这是否是一个entry的别名 - 同时返回entry名称空间
            const aliased = await _resolve(id, void 0, true)
            if (aliased && (entry = resolveEntry(aliased))) {
              return entry
            }
          }

          const resolved = await resolve(id, importer, kind)
          if (resolved) {
            return resolveResult(id, resolved)
          }
        },
      )

      build.onLoad(
        { filter: /.*/, namespace: 'browser-external' },
        ({ path }) => {
          return {
            contents: `\
module.export = Object.create(new Proxy({}, {
  get(_, key) {
    if (
      key !== '__esModule' &&
      key !== '__proto__' &&
      key !== 'constructor' &&
      key !== 'splice'
    ) {
      console.warn(\`Module "${path}" has been externalized for browser compatibility. Cannot access "${path}.\${key}" in client code.\`)
    }
  }
}))
            `,
          }
        },
      )

      build.onLoad(
        { filter: /.*/, namespace: 'optional-peer-dep' },
        ({ path }) => {
          const [, peerDep, parentDep] = path.split(':')
          return {
            contents: `throw new Error(\`Could not resolve "${peerDep}" imported by "${parentDep}". Is it installed?\`)`,
          }
        },
      )
    },
  }
}

// esbuild doesn't transpile `require('foo')` into `import` statements if 'foo' is externalized
// https://github.com/evanw/esbuild/issues/566#issuecomment-735551834
export function esbuildCjsExternalPlugin(
  externals: string[],
  platform: 'node' | 'browser',
): Plugin {
  return {
    name: 'cjs-external',
    setup(build) {
      const escape = (text: string) =>
        `^${text.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}$`
      const filter = new RegExp(externals.map(escape).join('|'))

      build.onResolve({ filter: new RegExp(`^${nonFacadePrefix}`) }, (args) => {
        return {
          path: args.path.slice(nonFacadePrefix.length),
          external: true,
        }
      })

      build.onResolve({ filter }, (args) => {
        // preserve `require` for node because it's more accurate than converting it to import
        if (args.kind === 'require-call' && platform !== 'node') {
          return {
            path: args.path,
            namespace: cjsExternalFacadeNamespace,
          }
        }

        return {
          path: args.path,
          external: true,
        }
      })

      build.onLoad(
        { filter: /.*/, namespace: cjsExternalFacadeNamespace },
        (args) => ({
          contents:
            `import * as m from ${JSON.stringify(
              nonFacadePrefix + args.path,
            )};` + `module.exports = m;`,
        }),
      )
    },
  }
}
