import { Connect } from 'dep-types/connect'
import colors from 'picocolors'
import type {
  Server as HttpServer,
  OutgoingHttpHeaders as HttpServerHeaders,
} from 'node:http'
import type { ServerOptions as HttpsServerOptions } from 'node:https'
import { Logger } from './logger'
import type { ProxyOptions } from './server/middlewares/proxy'
import { rejects } from 'node:assert'
import { isObject } from './utils'

export interface CommonServerOptions {
  port?: number
  strictPort?: boolean
  host?: string | boolean
  https?: boolean | HttpsServerOptions
  open?: boolean | string
  proxy?: Record<string, string | ProxyOptions>
  cors?: CorsOptions | boolean
  headers?: HttpServerHeaders
}

export interface CorsOptions {
  origin?:
    | CorsOrigin
    | ((origin: string, cb: (err: Error, origins: CorsOrigin) => void) => void)
  methods?: string | string[]
  allowedHeaders?: string | string[]
  exposedHeaders?: string | string[]
  credentials?: boolean
  maxAge?: number
  preflightContinue?: boolean
  optionsSuccessStatus?: number
}

export type CorsOrigin = boolean | string | RegExp | (string | RegExp)[]

export async function resolveHttpServer(
  { proxy }: CommonServerOptions,
  app: Connect.Server,
  httpsOptions?: HttpsServerOptions,
): Promise<HttpServer> {
  if (!httpsOptions) {
    const { createServer } = await import('node:http')
    return createServer(app)
  }

  if (proxy) {
    const { createServer } = await import('node:https')
    return createServer(httpsOptions, app)
  } else {
    const { createSecureServer } = await import('node:http2')
    return createSecureServer(
      {
        maxSessionMemory: 1000,
        ...httpsOptions,
        allowHTTP1: true,
      },
      // @ts-expect-error
      app,
    ) as unknown as HttpServer
  }
}

export async function resolveHttpsConfig(
  https: boolean | HttpsServerOptions | undefined,
): Promise<HttpsServerOptions | undefined> {
  if (!https) return void 0

  const httpsOption = isObject(https) ? { ...https } : {}

  const { ca, cert, key, pfx } = httpsOption
  Object.assign(httpsOption, {})

  return httpsOption
}

export function setClientErrorHandler(
  server: HttpServer,
  logger: Logger,
): void {
  server.on('clientError', (err, socket) => {
    let msg = '400 Bad Request'
    if ((err as any).code === 'HPE_HEADER_OVERFLOW') {
      msg = '431 Request Header Fields Too Large'
      logger.warn(colors.yellow('Server responded with status code 431. '))
    }
    if ((err as any).code === 'ECONNRESET' || !socket.writable) {
      return
    }
    socket.end(`HTTP/1.1 ${msg}\r\n\r\n`)
  })
}

export async function httpServerStart(
  httpServer: HttpServer,
  serverOptions: { port: number; host?: string; logger: Logger },
) {
  let { port, host, logger } = serverOptions

  return new Promise((resolve, reject) => {
    const onError = (e: Error & { code?: string }) => {
      if (e.code === 'EADDRINUSE') {
        logger.info(`Port ${port} 已经被使用，尝试使用另一个`)
        httpServer.listen(++port, host)
      } else {
        httpServer.removeListener('error', onError)
        reject(e)
      }
    }

    httpServer.on('error', onError)

    httpServer.listen(port, host, () => {
      httpServer.removeListener('error', onError)
      resolve(port)
    })
  })
}
