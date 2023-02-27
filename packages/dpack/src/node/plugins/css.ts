import path from 'node:path'
import type { RenderedChunk, NormalizedOutputOptions } from 'rollup'
import type { Plugin, ResolvedConfig } from '..'
import { CLIENT_PUBLIC_PATH, CSS_LANGS_RE } from '../constants'
import type { DpackDevServer } from '../server'
import { stripBomTag } from '../utils'
import { checkPublicFile, fileToUrl } from './asset'

type CssUrlReplacer = (
  url: string,
  importer?: string,
) => string | Promise<string>

const cssBundleName = 'style.css'

const enum PreprocessLang {
  less = 'less',
  sass = 'sass',
  scss = 'scss',
  styl = 'styl',
  stylus = 'stylus',
}
const enum PureCssLang {
  css = 'css',
}
const enum PostCssDialectLang {
  sss = 'sugarss',
}
type CssLang =
  | keyof typeof PureCssLang
  | keyof typeof PreprocessLang
  | keyof typeof PostCssDialectLang

const directRequestRE = /(?:\?|&)direct\b/

export const isCSSRequest = (request: string): boolean =>
  CSS_LANGS_RE.test(request)

export const isDirectCSSRequest = (request: string): boolean =>
  CSS_LANGS_RE.test(request) && directRequestRE.test(request)

export const isDirectRequest = (request: string): boolean =>
  directRequestRE.test(request)

function encodePublicUrlsInCSS(config: ResolvedConfig) {
  return config.command === 'build'
}

export function cssPlugin(config: ResolvedConfig): Plugin {
  let server: DpackDevServer

  const resolveUrl = config.createResolver({
    preferRelative: true,
    tryIndex: false,
    extensions: [],
  })

  return {
    name: 'dpack:css',

    configureServer(_server) {
      server = _server
    },

    buildStart() {},

    async transform(raw, id) {
      if (!isCSSRequest(id)) {
        return
      }

      const urlReplacer: CssUrlReplacer = async (url, importer) => {
        const resolved = await resolveUrl(url, importer)
        if (resolved) {
          return fileToUrl(resolved, config)
        }
        return url
      }

      const { code: css, map } = await compileCSS(id, raw, config, urlReplacer)

      if (server) {
        const { moduleGraph } = server
        const thisModule = moduleGraph.getModuleById(id)
        if (thisModule) {
          thisModule.isSelfAccepting = true
        }
      }
      return {
        code: css,
        map,
      }
    },
  }
}

export function cssPostPlugin(config: ResolvedConfig): Plugin {
  const styles: Map<string, string> = new Map<string, string>()
  let pureCssChunks: Set<RenderedChunk>

  const rollupOptionsOutput = config.build.rollupOptions.output

  const assetFileNames = (
    Array.isArray(rollupOptionsOutput)
      ? rollupOptionsOutput[0]
      : rollupOptionsOutput
  )?.assetFileNames
  const getCssAssetDirname = (cssAssetName: string) => {
    if (!assetFileNames) {
      return config.build.assetsDir
    } else if (typeof assetFileNames === 'string') {
      return path.dirname(assetFileNames)
    } else {
      return path.dirname(
        assetFileNames({
          name: cssAssetName,
          type: 'asset',
          source: '/* dpack internal call, ignore */',
        }),
      )
    }
  }

  return {
    name: 'dpack:css-post',

    async transform(css, id) {
      if (!isCSSRequest(id)) {
        return
      }

      css = stripBomTag(css)

      if (config.command === 'serve') {
        const getContentWithSourcemap = async (content: string) => {
          return content
        }

        if (isDirectCSSRequest(id)) {
          return css
        }

        const cssContent = css
        const code = [
          `import { updateStyle as __dpack__updateStyle, removeStyle as __dpack__removeStyle } from ${JSON.stringify(
            path.posix.join(config.base, CLIENT_PUBLIC_PATH),
          )}`,
          `const __dpack__id = ${JSON.stringify(id)}`,
          `const __dpack__css = ${JSON.stringify(cssContent)}`,
          `__dpack__updateStyle(__dpack__id, __dpack__css)`,
        ].join('\n')
        return { code, map: { mappings: '' } }
      }
    },
  }
}

// https://drafts.csswg.org/css-syntax-3/#identifier-code-point
export const cssUrlRE =
  /(?<=^|[^\w\-\u0080-\uffff])url\((\s*('[^']+'|"[^"]+")\s*|[^'")]+)\)/
export const cssDataUriRE =
  /(?<=^|[^\w\-\u0080-\uffff])data-uri\((\s*('[^']+'|"[^"]+")\s*|[^'")]+)\)/
export const importCssRE = /@import ('[^']+\.css'|"[^"]+\.css"|[^'")]+\.css)/

async function compileCSS(
  id: string,
  code: string,
  config: ResolvedConfig,
  urlReplacer?: CssUrlReplacer,
) {
  const needInlineImport = code.includes('@import')
  const hasUrl = cssUrlRE.test(code)
  const lang = id.match(CSS_LANGS_RE)?.[1] as CssLang | undefined

  if (lang === 'css' && !needInlineImport && !hasUrl) {
    return { code, map: null }
  }
  // 其他情况不考虑 预处理器 后处理器
  return { code, map: null }
}
