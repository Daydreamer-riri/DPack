import path from 'node:path'
import sirv from 'sirv'
import type { DpackDevServer } from '..'
import type { Connect } from 'dep-types/connect'
import { cleanUrl, isInternalRequest } from '../../utils'

export function serverStaticMiddleware(
  dir: string,
  server: DpackDevServer,
): Connect.NextHandleFunction {
  const serve = sirv(dir, {
    dev: true,
    etag: true,
  })

  return function dpackServerStaticMiddleware(req, res, next) {
    const cleanedUrl = cleanUrl(req.url!)

    if (
      cleanedUrl.endsWith('/') ||
      path.extname(cleanedUrl) === '.html' ||
      isInternalRequest(req.url!)
    ) {
      return next()
    }

    // const url = new URL(req.url!, 'http://example.com')
    // const resolvedPathname = decodeURIComponent(url.pathname)

    // let fileUrl = path.resolve(dir, resolvedPathname.replace(/^\//, ''))
    // if (resolvedPathname.endsWith('/') && !fileUrl.endsWith('/')) {
    //   fileUrl = fileUrl + '/'
    // }

    serve(req, res, next)
  }
}
