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
import type { PluginContainer } from '../server/pluginContainer'
import {
  cleanUrl,
  dataUrlRE,
  externalRE,
  isOptimizable,
  moduleListContains,
  multilineCommentsRE,
  normalizePath,
  singlelineCommentsRE,
  virtualModulePrefix,
} from '../utils'

type ResolveIdOptions = Parameters<PluginContainer['resolveId']>[2]

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
  const plugin = esbuildScanPlugin(config, container, deps, missing, entries)

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
    plugins: [...plugins, plugin],
    ...esbuildOptions,
  })

  config.logger.info(
    `Scan completed in ${(performance.now() - start).toFixed(2)}ms`,
    deps,
  )
  return {
    // 确保一个固定的顺序，这样哈希值才会稳定并改善日志。
    deps: orderedDependencies(deps),
    missing,
  }
}

function orderedDependencies(deps: Record<string, string>) {
  const depsList = Object.entries(deps)
  // 确保同一组依赖的browserHash相同
  depsList.sort((a, b) => a[0].localeCompare(b[0]))
  return Object.fromEntries(depsList)
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

const scriptModuleRE =
  /(<script\b[^>]+type\s*=\s*(?:"module"|'module')[^>]*>)(.*?)<\/script>/gis
export const scriptRE = /(<script(?:\s[^>]*>|>))(.*?)<\/script>/gis
export const commentRE = /<!--.*?-->/gs
const srcRE = /\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s'">]+))/i
const typeRE = /\btype\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s'">]+))/i
const langRE = /\blang\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s'">]+))/i
const contextRE = /\bcontext\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s'">]+))/i

function esbuildScanPlugin(
  config: ResolvedConfig,
  container: PluginContainer,
  depImports: Record<string, string>,
  missing: Record<string, string>,
  entries: string[],
): Plugin {
  const seen = new Map<string, string | undefined>()

  const resolve = async (
    id: string,
    importer?: string,
    options?: ResolveIdOptions,
  ) => {
    const key = id + (importer && path.dirname(importer))
    if (seen.has(key)) {
      return seen.get(key)
    }
    const resolved = await container.resolveId(
      id,
      importer && normalizePath(importer),
      {
        ...options,
        scan: true,
      },
    )
    const res = resolved?.id
    seen.set(key, res)
    return res
  }

  const exclude = ['@dpack/client', '@dpack/env']

  const externalUnlessEntry = ({ path }: { path: string }) => ({
    path,
    external: !entries.includes(path),
  })

  // const doTransformGlobImport = async (
  //   contents: string,
  //   id: string,
  //   loader: Loader
  // ) => {
  //   let transpiledContents

  //   if (loader !== 'js') {
  //     transpiledContents = (await transform(contents, {loader})).code
  //   } else {
  //     transpiledContents = contents
  //   }

  //   const result = await transformGlobImport()
  // }

  return {
    name: 'dpack:dep-scan',
    setup(build) {
      const scripts: Record<string, OnLoadResult> = {}

      // 如果是 http(s) 的外部文件，不打包到 bundle 中
      build.onResolve({ filter: externalRE }, ({ path }) => ({
        path,
        external: true,
      }))
      // 如果是以 data: 开头，不打包到 bundle 中
      build.onResolve({ filter: dataUrlRE }, ({ path }) => ({
        path,
        external: true,
      }))
      // css & json
      build.onResolve({ filter: CSS_LANGS_RE }, externalUnlessEntry)

      // known asset types
      build.onResolve(
        { filter: new RegExp(`\\.(${KNOWN_ASSET_TYPES.join('|')})$`) },
        externalUnlessEntry,
      )

      // known dpack query types: ?worker, ?raw
      build.onResolve({ filter: SPECIAL_QUERY_RE }, ({ path }) => ({
        path,
        external: true, // 不注入 boundle 中
      }))

      // local scripts (`<script>` in Svelte and `<script setup>` in Vue)
      // build.onResolve({ filter: virtualModuleRE }, ({ path }) => {
      //   return {
      //     // strip prefix to get valid filesystem path so esbuild can resolve imports in the file
      //     path: path.replace(virtualModulePrefix, ''),
      //     namespace: 'script',
      //   }
      // })

      build.onLoad({ filter: /.*/, namespace: 'script' }, ({ path }) => {
        return scripts[path]
      })

      // html
      build.onResolve({ filter: htmlTypesRE }, async ({ path, importer }) => {
        const resolved: string | undefined = await resolve(path, importer)
        if (!resolved) return

        return {
          path: resolved,
          namespace: 'html',
        }
      })

      // 在类似HTML的文件中提取script，并将其作为一个js模块处理
      build.onLoad(
        { filter: htmlTypesRE, namespace: 'html' },
        async ({ path }) => {
          let raw = fs.readFileSync(path, 'utf-8')
          raw = raw.replace(commentRE, '<!---->')
          const isHtml = path.endsWith('.html')
          // 如果是 .html 结尾，则 regex 匹配 type 为 module 的 script 标签，反之，比如 Vue 匹配没有 type 属性的 script 标签
          // scriptModuleRE[1]: <script type="module"> 开始标签
          // scriptModuleRE[2]、scriptRE[1]: script 标签的内容
          // scriptRE[1]: <script> 开始标签
          const regex = isHtml ? scriptModuleRE : scriptRE
          // 重置 regex.lastIndex
          regex.lastIndex = 0
          let js = ''
          let scriptId = 0
          let match: RegExpExecArray | null
          while ((match = regex.exec(raw))) {
            const [, openTag, content] = match
            const typeMatch = openTag.match(typeRE)
            const type =
              typeMatch && (typeMatch[1] || typeMatch[2] || typeMatch[3])
            const langMatch = openTag.match(langRE)
            const lang =
              langMatch && (langMatch[1] || langMatch[2] || langMatch[3])

            if (
              type &&
              !(
                type.includes('javascript') ||
                type.includes('ecmascript') ||
                type === 'module'
              )
            ) {
              continue
            }
            let loader: Loader = 'js'
            if (lang === 'ts' || lang === 'tsx' || lang === 'jsx') {
              loader = lang
            } else if (path.endsWith('.astro')) {
              loader = 'ts'
            }
            const srcMatch = openTag.match(srcRE)
            if (srcMatch) {
              const src = srcMatch[1] || srcMatch[2] || srcMatch[3]
              js += `import ${JSON.stringify(src)}\n`
            } else if (content.trim()) {
              const contents =
                content +
                (loader.startsWith('ts') ? extractImportPaths(content) : '')

              const key = `${path}?id=${scriptId++}`
              if (contents.includes('import.meta.glob')) {
                // scripts[key] = {
                //   loader: 'js',
                //   contents: await doTransformGlobImport(contents, path, loader),
                //   pluginData: {
                //     htmlType: { loader },
                //   },
                // }
              } else {
                scripts[key] = {
                  loader,
                  contents,
                  pluginData: {
                    htmlType: { loader },
                  },
                }
              }

              const virtualModulePath = JSON.stringify(
                virtualModulePrefix + key,
              )
              js += `export * from ${virtualModulePath}`
            }
          }

          if (!path.endsWith('.vue') || !js.includes('export default')) {
            js += '\nexport default {}'
          }

          return {
            loader: 'js',
            contents: js,
          }
        },
      )

      // bare imports: record and externalize
      build.onResolve(
        { filter: /^[\w@][^:]/ },
        async ({ path: id, importer, pluginData }) => {
          if (moduleListContains(exclude, id)) {
            return externalUnlessEntry({ path: id })
          }
          if (depImports[id]) {
            return externalUnlessEntry({ path: id })
          }
          const resolved = await resolve(id, importer, {
            custom: {
              depScan: { loader: pluginData?.htmlType?.loader },
            },
          })
          if (resolved) {
            if (shouldExternalizeDep(resolved, id)) {
              return externalUnlessEntry({ path: id })
            }
            if (resolved.includes('node_modules')) {
              if (isOptimizable(resolved)) {
                depImports[id] = resolved
              }
              return externalUnlessEntry({ path: id })
            } else if (isScannable(resolved)) {
              const namespace = htmlTypesRE.test(resolved) ? 'html' : undefined
              return {
                path: path.resolve(resolved),
                namespace,
              }
            } else {
              return externalUnlessEntry({ path: id })
            }
          } else {
            missing[id] = normalizePath(importer)
          }
        },
      )

      // catch all
      build.onResolve(
        { filter: /.*/ },
        async ({ path: id, importer, pluginData }) => {
          const resolved = await resolve(id, importer, {
            custom: {
              depScan: { loader: pluginData?.htmlType?.loader },
            },
          })
          if (resolved) {
            if (shouldExternalizeDep(resolved, id) || !isScannable(resolved)) {
              return externalUnlessEntry({ path: id })
            }

            const namespace = htmlTypesRE.test(resolved) ? 'html' : undefined

            return {
              path: path.resolve(cleanUrl(resolved)),
              namespace,
            }
          } else {
            return externalUnlessEntry({ path: id })
          }
        },
      )

      // jsx/tsx
      build.onLoad({ filter: JS_TYPES_RE }, async ({ path: id }) => {
        let ext = path.extname(id).slice(1)
        if (ext === 'mjs') ext = 'js'

        let contents = fs.readFileSync(id, 'utf-8')
        if (ext.endsWith('x') && config.esbuild && config.esbuild.jsxInject) {
          contents = config.esbuild.jsxInject + `\n` + contents
        }

        const loader =
          config.optimizeDeps?.esbuildOptions?.loader?.[`.${ext}`] ||
          (ext as Loader)

        return {
          loader,
          contents,
        }
      })
    },
  }
}

/**
 * 当使用TS + (Vue + `<script setup>`)或Svelte时，
 * import可能对esbuild来说是未使用的，并在构建输出中被丢弃，
 * 这阻止了esbuild的进一步爬行。
 * 解决方案是为每个源添加`import 'x'`，esbuild会因为潜在的副作用继续抓取。
 */
function extractImportPaths(code: string) {
  code = code
    .replace(multilineCommentsRE, '/* */')
    .replace(singlelineCommentsRE, '')

  let js = ''
  let m
  importsRE.lastIndex = 0
  while ((m = importsRE.exec(code)) != null) {
    js += `\nimport ${m[1]}`
  }
  return js
}

function shouldExternalizeDep(resolvedId: string, rawId: string) {
  if (!path.isAbsolute(resolvedId)) {
    return true
  }

  if (resolvedId === rawId || resolvedId.includes('\0')) {
    return true
  }
  return false
}
