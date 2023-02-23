import type { Server } from 'node:http'
import { STATUS_CODES } from 'node:http'
import type { ServerOptions as HttpsServerOptions } from 'node:https'
import { createServer as createHttpsServer } from 'node:https'
import type { Socket } from 'node:net'
import colors from 'picocolors'
import type { ServerOptions, WebSocket as WebSocketRaw } from 'ws'
import { WebSocketServer as WebSocketServerRow } from 'ws'
import type { WebSocket as WebSocketTypes } from 'dep-types/ws'
import type { HMRPayload, CustomPayload, ErrorPayload } from 'types/hmrPayload'
import type { InferCustomEventPayload } from 'types/customEvent'
import type { ResolvedConfig } from '../config'
import { isObject } from '../utils'

export const HMR_HEADER = 'dpack-hmr'

export type WebSocketCustomListener<T> = (
  data: T,
  client: WebSocketClient,
) => void

export interface WebSocketServer {
  /**
   * 获取全部已连接客户端
   */
  clients: Set<WebSocketClient>
  /**
   * 广播事件至所有客户端
   */
  send(payload: HMRPayload): void
  /**
   * 发送自定义事件
   */
  send<T extends string>(event: T, payload?: InferCustomEventPayload<T>): void
  /**
   * 断开所有客户端的链接
   */
  close(): Promise<void>
  /**
   * 处理' import.meta.hot.send '触发的自定义事件
   */
  on: WebSocketTypes.Server['on'] & {
    <T extends string>(
      event: T,
      listener: WebSocketCustomListener<InferCustomEventPayload<T>>,
    ): void
  }
  off: WebSocketTypes.Server['off'] & {
    (event: string, listener: Function): void
  }
}

export interface WebSocketClient {
  /**
   * 发送事件至客户端
   */
  send(payload: HMRPayload): void
  /**
   * 发送自定义事件
   */
  send(event: string, payload?: CustomPayload['data']): void
  /**
   * 原生Websocket实例
   */
  socket: WebSocketTypes
}

const wsServerEvents = [
  'connection',
  'error',
  'headers',
  'listening',
  'message',
]

export function createWebSocketServer(
  server: Server | null,
  config: ResolvedConfig,
  httpsOptions?: HttpsServerOptions,
): WebSocketServer {
  let wss: WebSocketServerRow
  let httpsServer: Server | undefined = void 0

  const logger = config.logger

  const hmr = isObject(config.server.hmr) && config.server.hmr
  const hmrServer = hmr && hmr.server
  const hmrPort = hmr && hmr.port
  const portsAreCompatible = !hmrPort || hmrPort === config.server.port
  const wsServer = hmrServer || (portsAreCompatible && server)
  const customListeners = new Map<string, Set<WebSocketCustomListener<any>>>()
  const clientsMap = new WeakMap<WebSocketRaw, WebSocketClient>()

  if (wsServer) {
    logger.info(`[ws] ${colors.yellow('ws created')}`)
    wss = new WebSocketServerRow({ noServer: true })
    wsServer.on('upgrade', (req, socket, head) => {
      if (req.headers['sec-websocket-protocol'] === HMR_HEADER) {
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit('connection', ws, req)
        })
      }
    })
  } else {
    const websocketServerOptions: ServerOptions = {}
    const port = hmrPort || 24678
    const host = (hmr && hmr.host) || void 0
    if (httpsOptions) {
      httpsServer = createHttpsServer(httpsOptions, (req, res) => {
        const statusCode = 426
        const body = STATUS_CODES[statusCode]
        if (!body) {
          throw new Error(
            `No body text found for the ${statusCode} status code`,
          )
        }

        res.writeHead(statusCode, {
          'Content-Length': body.length,
          'Content-Type': 'text/plain',
        })
        res.end(body)
      })

      httpsServer.listen(port, host)
      websocketServerOptions.server = httpsServer
    } else {
      websocketServerOptions.port = port
      if (host) {
        websocketServerOptions.host = host
      }
    }

    wss = new WebSocketServerRow(websocketServerOptions)
  }

  wss.on('connection', (socket) => {
    socket.on('message', (raw) => {
      if (!customListeners.size) return
      let parsed: any
      try {
        parsed = JSON.parse(String(raw))
      } catch {}
      if (!parsed || parsed.type !== 'custom' || !parsed.event) return
      const listeners = customListeners.get(parsed.event)
      if (!listeners?.size) return
      const client = getSocketClient(socket)
      listeners.forEach((listener) => listener(parsed.data, client))
    })
    socket.send(JSON.stringify({ type: 'connected' }))
    if (bufferedError) {
      socket.send(JSON.stringify(bufferedError))
      bufferedError = null
    }
  })

  wss.on('error', (e: Error & { code: string }) => {
    if (e.code === 'EADDRINUSE') {
      config.logger.error(
        colors.red(`WebSocket server error: Port is already in use`),
        { error: e },
      )
    } else {
      config.logger.error(
        colors.red(`WebSocket server error:\n${e.stack || e.message}`),
        { error: e },
      )
    }
  })

  function getSocketClient(socket: WebSocketRaw) {
    if (!clientsMap.has(socket)) {
      clientsMap.set(socket, {
        send: (...args) => {
          let payload: HMRPayload
          if (typeof args[0] === 'string') {
            payload = {
              type: 'custom',
              event: args[0],
              data: args[1],
            }
          } else {
            payload = args[0]
          }
          socket.send(JSON.stringify(payload))
        },
        socket,
      })
    }
    return clientsMap.get(socket)!
  }

  let bufferedError: ErrorPayload | null = null

  return {
    on: ((event: string, fn: () => void) => {
      if (wsServerEvents.includes(event)) wss.on(event, fn)
      else {
        if (!customListeners.has(event)) {
          customListeners.set(event, new Set())
        }
        customListeners.get(event)!.add(fn)
      }
    }) as WebSocketServer['on'],
    off: ((event: string, fn: () => void) => {
      if (wsServerEvents.includes(event)) {
        wss.off(event, fn)
      } else {
        customListeners.get(event)?.delete(fn)
      }
    }) as WebSocketServer['off'],
    send: (...args: any[]) => {
      let payload: HMRPayload
      if (typeof args[0] === 'string') {
        payload = {
          type: 'custom',
          event: args[0],
          data: args[1],
        }
      } else {
        payload = args[0]
      }

      if (payload.type === 'error' && !wss.clients.size) {
        bufferedError = payload
        return
      }

      const stringified = JSON.stringify(payload)
      wss.clients.forEach((client) => {
        if (client.readyState === 1) {
          client.send(stringified)
        }
      })
    },
    get clients() {
      return new Set(Array.from(wss.clients).map(getSocketClient))
    },
    close: () => {
      return new Promise((res, rej) => {
        wss.clients.forEach((client) => {
          client.terminate()
        })
        wss.close((err) => {
          if (err) {
            rej(err)
          } else {
            if (httpsServer) {
              httpsServer.close((err) => {
                if (err) {
                  rej(err)
                } else {
                  res()
                }
              })
            } else {
              res()
            }
          }
        })
      })
    },
  }
}
