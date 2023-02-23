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

let socket: WebSocket

function cleanUrl(pathname: string): string {
  const url = new URL(pathname, location.toString())
  url.searchParams.delete('direct')
  return url.pathname + url.search
}
