import type { HMRPayload } from 'types/hmrPayload'
import type { InferCustomEventPayload } from 'types/customEvent'

// injected by the hmr plugin when served
declare const __BASE__: string
declare const __SERVER_HOST__: string
declare const __HMR_PROTOCOL__: string | null
declare const __HMR_HOSTNAME__: string | null
declare const __HMR_PORT__: number | null
declare const __HMR_DIRECT_TARGET__: string
declare const __HMR_BASE__: string
declare const __HMR_TIMEOUT__: number
declare const __HMR_ENABLE_OVERLAY__: boolean

console.debug('[dpack] connecting...')

const importMetaUrl = new URL(import.meta.url)

const serverHost = __SERVER_HOST__
const socketProtocol =
  __HMR_PROTOCOL__ || (location.protocol === 'https:' ? 'wss' : 'ws')
const hmrPort = __HMR_PORT__
const socketHost = `${__HMR_HOSTNAME__ || importMetaUrl.hostname}:${
  hmrPort || importMetaUrl.port
}${__HMR_BASE__}`
const directSocketHost = __HMR_DIRECT_TARGET__
const base = __BASE__ || '/'
const messageBuffer: string[] = []

let socket: WebSocket

try {
  let fallback: (() => void) | undefined
  if (!hmrPort) {
    fallback = () => {
      console.error('[dpack] failed to connect to websocket.')
    }
  }

  socket = setupWebSocket(socketProtocol, serverHost, fallback)
} catch (err) {
  console.error(`[dpack] failed to connect to websocket (${err}). `)
}

function setupWebSocket(
  protocol: string,
  hostAndPath: string,
  onCloseWithoutOpen?: () => void,
) {
  const socket = new WebSocket(`${protocol}://${hostAndPath}`, 'dpack-hmr')
  let isOpened = false

  socket.addEventListener(
    'open',
    () => {
      isOpened = true
    },
    { once: true },
  )

  // 监听messages
  socket.addEventListener('message', async (e) => {
    const { data } = e
    handleMessage(JSON.parse(data))
  })

  socket.addEventListener('close', async ({ wasClean }) => {
    if (wasClean) return

    if (!isOpened && onCloseWithoutOpen) {
      onCloseWithoutOpen()
      return
    }

    console.log(`[dpack] server connection lost. polling for restart...`)
    // await waitForSuccessfulPing(protocol, hostAndPath)
    location.reload()
  })

  return socket
}

function cleanUrl(pathname: string): string {
  const url = new URL(pathname, location.toString())
  url.searchParams.delete('direct')
  return url.pathname + url.search
}

let isFirstUpdate = true
const outdatedLinkTats = new WeakSet<HTMLLinkElement>()

async function handleMessage(payload: HMRPayload) {
  switch (payload.type) {
    case 'connected':
      console.debug(`[dpack] connected.`)
      sendMessageBuffer()

      setInterval(() => {
        if (socket.readyState === socket.OPEN) {
          socket.send(`{"type":"ping"}`)
        }
      }, __HMR_TIMEOUT__)
      break

    case 'update':
      // TODO:
      break

    case 'custom':
      notifyListeners(payload.event, payload.data)
      break

    case 'full-reload':
      notifyListeners('dpack:beforeFullReload', payload)
      if (payload.path?.endsWith?.('.html')) {
        // 如果html文件被编辑了，只有当浏览器目前在该页面上时才会重新加载该页面。
        const pagePath = decodeURI(location.pathname)
        const payloadPath = base + payload.path.slice(1)
        if (
          pagePath === payloadPath ||
          payload.path === '/index.html' ||
          (pagePath.endsWith('/') && pagePath + 'index.html' === payloadPath)
        ) {
          location.reload()
        }
        return
      } else {
        location.reload()
      }
      break

    case 'prune':
      notifyListeners('dpack:beforePrune', payload)
      payload.paths.forEach((path) => {
        const fn = pruneMap.get(path)
        if (fn) {
          fn(dataMap.get(path))
        }
      })
      break

    case 'error': {
      notifyListeners('dpack:error', payload)
      const err = payload.err
      console.error(
        `[dpack] Internal Server Error\n${err.message}\n${err.stack}`,
      )
      break
    }
    default: {
      const check: never = payload
      return check
    }
  }
}

function notifyListeners<T extends string>(
  event: T,
  data: InferCustomEventPayload<T>,
): void
function notifyListeners(event: string, data: any): void {
  const cbs = customListenersMap.get(event)
  if (cbs) {
    cbs.forEach((cb) => cb(data))
  }
}

function sendMessageBuffer() {
  if (socket.readyState === 1) {
    messageBuffer.forEach((msg) => socket.send(msg))
    messageBuffer.length = 0
  }
}

type CustomListenersMap = Map<string, ((data: any) => void)[]>

const pruneMap = new Map<string, (data: any) => void | Promise<void>>()
const dataMap = new Map<string, any>()
const customListenersMap: CustomListenersMap = new Map()
