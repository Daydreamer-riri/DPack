import path from 'node:path'
import fs from 'node:fs'
import colors from 'picocolors'
import type { DpackDevServer } from '..'
import type { Connect } from 'dep-types/connect'
import {
  cleanUrl,
  injectQuery,
  isImportRequest,
  isJSRequest,
  normalizePath,
  removeImportQuery,
  removeTimestampQuery,
  unwrapId,
} from '../../utils'
import { DEP_VERSION_RE, NULL_BYTE_PLACEHOLDER } from '../../constants'
import { ResolvedConfig } from '../../config'
import { importAnalysisPlugin } from '../../plugins/importAnalysis'
import { getDepsOptimizer } from '../../optimizer/opimizer'
import { isCSSRequest, isDirectRequest } from '../../plugins/css'
import { isHTMLProxy } from '../../plugins/html'
import { ERR_LOAD_URL, transformRequest } from '../transformRequest'
import { send } from '../send'

const knownIgnoreList = new Set(['/', '/favicon.ico'])

export function transformMiddleware(
  server: DpackDevServer,
): Connect.NextHandleFunction {
  const { config, moduleGraph } = server
  const { root, logger } = config
  const importAnalysis = importAnalysisPlugin(config)
  return async function dpackTransformMiddleware(req, res, next) {
    if (req.method !== 'GET' || knownIgnoreList.has(req.url!)) {
      return next()
    }

    let url: string
    try {
      url = decodeURI(removeTimestampQuery(req.url!)).replace(
        NULL_BYTE_PLACEHOLDER,
        '\0',
      )
    } catch (e) {
      return next(e)
    }

    const withoutQuery = cleanUrl(url)

    try {
      const isSourceMap = withoutQuery.endsWith('.map')
      // 因为我们生成了source map的引用，所以在这里处理这些请求
      if (isSourceMap) {
        const depsOptimizer = getDepsOptimizer(server.config)
        if (depsOptimizer?.isOptimizedDepUrl(url)) {
          // ...
          // TODO: map的处理
        }
      }

      // 检查 public 目录在 root 目录内部
      const publicDir = normalizePath(server.config.publicDir)
      const rootDir = normalizePath(server.config.root)
      if (publicDir.startsWith(rootDir)) {
        const publicPath = `${publicDir.slice(rootDir.length)}/`
        if (url.startsWith(publicPath)) {
          let warning: string

          if (isImportRequest(url)) {
            const rawUrl = removeImportQuery(url)

            warning =
              'Assets in public cannot be imported from JavaScript.\n' +
              `Instead of ${colors.cyan(
                rawUrl,
              )}, put the file in the src directory, and use ${colors.cyan(
                rawUrl.replace(publicPath, '/src/'),
              )} instead.`
          } else {
            warning =
              `files in the public directory are served at the root path.\n` +
              `Instead of ${colors.cyan(url)}, use ${colors.cyan(
                url.replace(publicPath, '/'),
              )}.`
          }

          logger.warn(colors.yellow(warning))
        }
      }

      if (
        isJSRequest(url) ||
        isImportRequest(url) ||
        isCSSRequest(url) ||
        isHTMLProxy(url)
      ) {
        url = removeImportQuery(url)

        url = unwrapId(url)
        // 对于CSS，我们需要区分正常的CSS请求和导入的CSS请求。
        if (
          isCSSRequest(url) &&
          !isDirectRequest(url) &&
          req.headers.accept?.includes('text/css')
        ) {
          url = injectQuery(url, 'direct')
        }

        // 检查我们是否可以提前返回304
        const ifNoneMatch = req.headers['if-none-match']
        if (
          ifNoneMatch &&
          (await moduleGraph.getModuleByUrl(url))?.transformResult?.etag ===
            ifNoneMatch
        ) {
          res.statusCode = 304
          return res.end()
        }

        // 使用插件容器进行解析、加载和转换
        const result = await transformRequest(url, server, {
          html: req.headers.accept?.includes('text/html'),
        })
        if (result) {
          const depsOptimizer = getDepsOptimizer(server.config)
          const type = isDirectRequest(url) ? 'css' : 'js'
          const isDep =
            DEP_VERSION_RE.test(url) || depsOptimizer?.isOptimizedDepUrl(url)

          return send(req, res, result.code, type, {
            etag: result.etag,
            cacheControl: isDep ? 'max-age=31536000,immutable' : 'no-cache',
            headers: server.config.server.headers,
            map: result.map,
          })
        }
      }
    } catch (e) {
      if (e?.code === ERR_LOAD_URL) {
        return next()
      }
      return next(e)
    }

    next()
  }
}
