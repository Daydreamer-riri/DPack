import type { Connect } from 'dep-types/connect'
import path from 'node:path'
import fs from 'node:fs'
import { DpackDevServer } from '..'
import { FS_PREFIX } from '../../constants'
import { cleanUrl, fsPathFromId, normalizePath } from '../../utils'
import { send } from '../send'

export function createDevHtmlTransformFn(
  server: DpackDevServer,
): (url: string, html: string, originalUrl: string) => Promise<string> {
  // const [preHooks, normalHooks, postHooks] = resolveHtmlTransforms(
  //   server.config.plugins,
  // )
  return async (
    url: string,
    html: string,
    originalUrl: string,
  ): Promise<string> => {
    // return applyHtmlTransforms(
    //   html,
    //   [
    //     preImportMapHook(server.config),
    //     ...preHooks,
    //     devHtmlHook,
    //     ...normalHooks,
    //     ...postHooks,
    //     postImportMapHook(),
    //   ],
    //   {
    //     path: url,
    //     filename: getHtmlFilename(url, server),
    //     server,
    //     originalUrl,
    //   },
    // )
    return html
  }
}

function getHtmlFilename(url: string, server: DpackDevServer) {
  if (url.startsWith(FS_PREFIX)) {
    return decodeURIComponent(fsPathFromId(url))
  } else {
    return decodeURIComponent(
      normalizePath(path.join(server.config.root, url.slice(1))),
    )
  }
}

export function indexHtmlMiddleware(
  server: DpackDevServer,
): Connect.NextHandleFunction {
  return async function dpackIndexHtmlMiddleware(req, res, next) {
    if (res.writableEnded) {
      return next()
    }

    const url = req.url && cleanUrl(req.url)
    if (url?.endsWith('.html') && req.headers['sec-fetch-dest'] !== 'script') {
      const filename = getHtmlFilename(url, server)
      if (fs.existsSync(filename)) {
        try {
          let html = fs.readFileSync(filename, 'utf-8')
          html = await server.transformIndexHtml(url, html, req.originalUrl)
          return send(req, res, html, 'html', {
            headers: server.config.server.headers,
          })
        } catch (e) {
          return next(e)
        }
      }
    }
    next()
  }
}
