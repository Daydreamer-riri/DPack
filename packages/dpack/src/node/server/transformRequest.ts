import { promises as fs } from 'node:fs'
import type { SourceDescription, SourceMap } from 'rollup'
import type { DpackDevServer } from '.'
import { checkPublicFile } from '../plugins/asset'
import {
  cleanUrl,
  ensureWatchedFile,
  isObject,
  removeTimestampQuery,
} from '../utils'
import getEtag from 'etag'
import { getDepsOptimizer } from '../optimizer/opimizer'

export const ERR_LOAD_URL = 'ERR_LOAD_URL'
export const ERR_LOAD_PUBLIC_URL = 'ERR_LOAD_PUBLIC_URL'

export interface TransformResult {
  code: string
  map: SourceMap | null
  etag?: string
  deps?: string[]
  dynamicDeps?: string[]
}

export interface TransformOptions {
  html?: boolean
}

export function transformRequest(
  url: string,
  server: DpackDevServer,
  options: TransformOptions = {},
): Promise<TransformResult | null> {
  const cacheKey = (options.html ? 'html:' : '') + url

  const pending = server._pendingRequests.get(cacheKey)
  if (pending) {
    return server.moduleGraph
      .getModuleByUrl(removeTimestampQuery(url))
      .then((module) => {
        if (!module || pending.timestamp > module.lastInvalidationTimestamp) {
          // 待处理的请求仍然有效，我们可以安全地重复使用其结果
          return pending.request
        } else {
          pending.abort()
          return transformRequest(url, server, options)
        }
      })
  }

  const request = doTransform(url, server, options)

  let cleared = false
  const clearCache = () => {
    if (!cleared) {
      server._pendingRequests.delete(cacheKey)
      cleared = true
    }
  }

  const timestamp = Date.now()

  // 缓存请求，并在处理完成后清除它
  server._pendingRequests.set(cacheKey, {
    request,
    timestamp,
    abort: clearCache,
  })
  request.then(clearCache, clearCache)

  return request
}

async function doTransform(
  url: string,
  server: DpackDevServer,
  options: TransformOptions,
) {
  url = removeTimestampQuery(url)

  const { config, pluginContainer } = server
  const module = await server.moduleGraph?.getModuleByUrl(url)

  const cached = module && module.transformResult
  if (cached) {
    return cached
  }

  const id = (await pluginContainer.resolveId(url, undefined))?.id || url
  // const id =
  //   (await pluginContainer.resolvedId(url, undefined))?.id || config.root + url

  const result = loadAndTransform(id, url, server, options)

  // NOTE:
  getDepsOptimizer(config)?.delayDepsOptimizerUntil(id, () => result)

  return result
}

async function loadAndTransform(
  id: string,
  url: string,
  server: DpackDevServer,
  options: TransformOptions,
) {
  const { config, pluginContainer, moduleGraph, watcher } = server
  const { root, logger } = config
  const file = cleanUrl(id)

  let code: string | null = null
  let map: SourceDescription['map'] = null

  // load
  const loadResult = await pluginContainer.load(id)
  if (loadResult == null) {
    if (options.html && !id.endsWith('.html')) {
      return null
    }

    try {
      code = await fs.readFile(file, 'utf-8')
    } catch (e) {
      throw e
    }

    if (code) {
    }
  } else {
    if (isObject(loadResult)) {
      code = loadResult.code
      map = loadResult.map
    } else {
      code = loadResult
    }
  }
  if (code == null) {
    const isPublicFile = checkPublicFile(url, config)
    const msg = isPublicFile
      ? `这个文件在/public中，在构建过程中会被原样复制，而不经过插件转换，` +
        `因此不应该从源代码中导入。它只能通过HTML标签进行引用。`
      : '该文件是否存在？'
    const err: any = new Error(
      `Failed to load url ${url} (resolved id: ${id}). ${msg}`,
    )
    err.code = isPublicFile ? ERR_LOAD_PUBLIC_URL : ERR_LOAD_URL
    throw err
  }

  const mod = await moduleGraph.ensureEntryFromUrl(url)
  ensureWatchedFile(watcher, mod.file, root)

  // transform
  const transformResult = await pluginContainer.transform(code, id, {
    inMap: map,
  })
  const originalCode = code
  if (
    transformResult == null ||
    (isObject(transformResult) && transformResult.code == null)
  ) {
  } else {
    code = transformResult.code
    map = transformResult.map
  }

  if (map && mod.file) {
    map = (typeof map === 'string' ? JSON.parse(map) : map) as SourceMap
    if (map.mappings && !map.sourcesContent) {
      // await injectSourcesContent(map, mod.file, logger) TODO:
    }
  }

  const result = {
    code,
    map,
    etag: getEtag(code, { weak: true }),
  } as TransformResult

  mod.transformResult = result

  return result
}
