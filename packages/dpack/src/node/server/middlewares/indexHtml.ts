import { DpackDevServer } from '..'

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
