import path from 'node:path'
import fs from 'node:fs'
import type { ResolvedConfig } from '../config'
import { cleanUrl, joinUrlSegments } from '../utils'
import type { PluginContext, Plugin } from '../plugin'
import { FS_PREFIX } from '../constants'

const urlRE = /(\?|&)url(?:&|$)/

const assetCache = new WeakMap<ResolvedConfig, Map<string, string>>()

export interface GeneratedAssetMeta {
  originalName: string
  isEntry?: boolean
}

export const generatedAssets = new WeakMap<
  ResolvedConfig,
  Map<string, GeneratedAssetMeta>
>()

export function assetPlugin(config: ResolvedConfig): Plugin {
  return {
    name: 'dpack:asset',

    buildStart() {
      assetCache.set(config, new Map())
      generatedAssets.set(config, new Map())
    },

    resolveId(id) {
      if (!config.assetsInclude(cleanUrl(id))) {
        return
      }

      const publicFile = checkPublicFile(id, config)
      if (publicFile) {
        return id
      }
    },

    async load(id) {
      if (id.startsWith('\0')) {
        return
      }

      if (!config.assetsInclude(cleanUrl(id)) && !urlRE.test(id)) {
        return
      }

      id = id.replace(urlRE, '$1').replace(/[?&]$/, '')
      const url = await fileToUrl(id, config)
      return `export default ${JSON.stringify(url)}`
    },
  }
}

export function checkPublicFile(
  url: string,
  { publicDir }: ResolvedConfig,
): string | undefined {
  // note if the file is in /public, the resolver would have returned it
  // as-is so it's not going to be a fully resolved path.
  if (!publicDir || !url.startsWith('/')) {
    return
  }
  const publicFile = path.join(publicDir, cleanUrl(url))
  if (!publicFile.startsWith(publicDir)) {
    // can happen if URL starts with '../'
    return
  }
  if (fs.existsSync(publicFile)) {
    return publicFile
  } else {
    return
  }
}

export async function fileToUrl(
  id: string,
  config: ResolvedConfig,
  // ctx: PluginContext,
): Promise<string> {
  if (config.command === 'serve') {
    return fileToDevUrl(id, config)
  } else {
    // return fileToBuiltUrl(id, config, ctx)
    return fileToDevUrl(id, config)
  }
}

function fileToDevUrl(id: string, config: ResolvedConfig) {
  let rtn: string
  if (checkPublicFile(id, config)) {
    // 在public文件夹中，保持url不变。
    rtn = id
  } else if (id.startsWith(config.root)) {
    // 在项目内，推断short public path
    rtn = '/' + path.posix.relative(config.root, id)
  } else {
    // 在项目根目录之外，使用绝对的FS路径
    // (这是由server static 中间件特别处理的
    rtn = path.posix.join(FS_PREFIX, id)
  }
  const base = joinUrlSegments(config.server?.origin ?? '', config.base)
  return joinUrlSegments(base, rtn.replace(/^\//, ''))
}
