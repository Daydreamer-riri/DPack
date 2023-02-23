import type { Connect } from 'dep-types/connect'
import path from 'node:path'
import fs from 'node:fs'
import type { DefaultTreeAdapterMap } from 'parse5'
import { DpackDevServer } from '..'
import { CLIENT_PUBLIC_PATH, FS_PREFIX } from '../../constants'
import {
  cleanUrl,
  ensureWatchedFile,
  fsPathFromId,
  joinUrlSegments,
  normalizePath,
  wrapId,
} from '../../utils'
import {
  applyHtmlTransforms,
  assetAttrsConfig,
  getAttrKey,
  getScriptInfo,
  IndexHtmlTransformHook,
  nodeIsElement,
  resolveHtmlTransforms,
  traverseHtml,
} from '../../plugins/html'
import { send } from '../send'
import MagicString from 'magic-string'
import type { SourceMapInput } from 'rollup'

interface AssetNode {
  start: number
  end: number
  code: string
}

export function createDevHtmlTransformFn(
  server: DpackDevServer,
): (url: string, html: string, originalUrl: string) => Promise<string> {
  const [preHooks, normalHooks, postHooks] = resolveHtmlTransforms(
    server.config.plugins,
  )
  return async (
    url: string,
    html: string,
    originalUrl: string,
  ): Promise<string> => {
    return applyHtmlTransforms(
      html,
      [...preHooks, devHtmlHook, ...normalHooks, ...postHooks],
      {
        path: url,
        filename: getHtmlFilename(url, server),
        server,
        originalUrl,
      },
    )
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

const processNodeUrl: any = () => {}

const devHtmlHook: IndexHtmlTransformHook = async (
  html,
  { path: htmlPath, filename, server, originalUrl },
) => {
  const { config, moduleGraph, watcher } = server!
  const base = config.base || '/'

  let proxyModulePath: string
  let proxyModuleUrl: string

  const trailingSlash = htmlPath.endsWith('/')
  if (!trailingSlash && fs.existsSync(filename)) {
    proxyModulePath = htmlPath
    proxyModuleUrl = joinUrlSegments(base, htmlPath)
  } else {
    // ...
    const validPath = `${htmlPath}${trailingSlash ? 'index.html' : ''}`
    proxyModulePath = `\0${validPath}`
    proxyModuleUrl = wrapId(proxyModulePath)
  }

  const s = new MagicString(html)
  let inlineModuleIndex = -1
  const proxyCacheUrl = cleanUrl(proxyModulePath).replace(
    normalizePath(config.root),
    '',
  )
  const styleUrl: AssetNode[] = []

  const addInlineModule = (node: any, ext: 'js') => {
    inlineModuleIndex++

    const contentNode = node.childNodes[0]

    const code: string = contentNode.value

    let map: SourceMapInput | undefined
    if (!proxyModulePath.startsWith('\0')) {
      map = new MagicString(html)
        .snip(
          contentNode.sourceCodeLocation!.startOffset,
          contentNode.sourceCodeLocation!.endOffset,
        )
        .generateMap({ hires: true })
      map.sources = [filename]
      map.file = filename
    }

    const modulePath = `${proxyModuleUrl}?html-proxy&index=${inlineModuleIndex}.${ext}`

    const module = server?.moduleGraph.getModuleById(modulePath)
    if (module) {
      server?.moduleGraph.invalidateModule(module)
    }
    s.update(
      node.sourceCodeLocation!.startOffset,
      node.sourceCodeLocation!.endOffset,
      `<script type="module" src="${modulePath}"></script>`,
    )
  }

  await traverseHtml(html, filename, (node) => {
    if (!nodeIsElement(node)) {
      return
    }

    if (node.nodeName === 'script') {
      const { src, sourceCodeLocation, isModule } = getScriptInfo(node)

      if (src) {
        processNodeUrl(
          src,
          sourceCodeLocation!,
          s,
          config,
          htmlPath,
          originalUrl,
          moduleGraph,
        )
      } else if (isModule && node.childNodes.length) {
        addInlineModule(node, 'js')
      }
    }

    if (node.nodeName === 'style' && node.childNodes.length) {
      const children = node.childNodes[0] as DefaultTreeAdapterMap['textNode']
      styleUrl.push({
        start: children.sourceCodeLocation!.startOffset,
        end: children.sourceCodeLocation!.endOffset,
        code: children.value,
      })
    }

    // elements with [href/src] attrs
    const assetAttrs = assetAttrsConfig[node.nodeName]
    if (assetAttrs) {
      for (const p of node.attrs) {
        const attrKey = getAttrKey(p)
        if (p.value && assetAttrs.includes(attrKey)) {
          processNodeUrl(
            p,
            node.sourceCodeLocation!.attrs![attrKey],
            s,
            config,
            htmlPath,
            originalUrl,
          )
        }
      }
    }
  })

  await Promise.all(
    styleUrl.map(async ({ start, end, code }, index) => {
      const url = `${proxyModulePath}?html-proxy&direct&index=${index}.css`

      // ensure module in graph after successful load
      const mod = await moduleGraph.ensureEntryFromUrl(url, false)
      ensureWatchedFile(watcher, mod.file, config.root)

      const result = await server!.pluginContainer.transform(code, mod.id!)
      s.overwrite(start, end, result?.code || '')
    }),
  )

  html = s.toString()

  return {
    html,
    tags: [
      {
        tag: 'script',
        attrs: {
          type: 'module',
          src: path.posix.join(base, CLIENT_PUBLIC_PATH),
        },
        injectTo: 'head-prepend',
      },
    ],
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
