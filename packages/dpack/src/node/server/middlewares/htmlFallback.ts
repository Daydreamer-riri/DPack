import fs from 'node:fs'
import path from 'node:path'
import history from 'connect-history-api-fallback'
import type { Connect } from 'dep-types/connect'
import { createDebugger } from '../../utils'

export function htmlFallbackMiddleware(
  root: string,
  spaFallback: boolean,
): Connect.NextHandleFunction {
  const historyHtmlFallbackMiddleware: any = history({
    logger: createDebugger('dpack:html-fallback'),
    // support /dir/ without explicit index.html
    rewrites: [
      {
        from: /\/$/,
        to(context) {
          const { parsedUrl } = context
          const rewritten =
            decodeURIComponent(parsedUrl.pathname!) + 'index.html'

          if (fs.existsSync(path.join(root, rewritten))) {
            return rewritten
          }

          return spaFallback ? '/index.html' : '/index.html'
        },
      },
    ],
  })

  // Keep the named function. The name is visible in debug logs via `DEBUG=connect:dispatcher ...`
  return function dpackHtmlFallbackMiddleware(req, res, next) {
    return historyHtmlFallbackMiddleware(req, res, next)
  }
}
