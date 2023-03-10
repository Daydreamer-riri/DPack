import type { OutputBundle, OutputChunk } from 'rollup'
import type { DefaultTreeAdapterMap, Token } from 'parse5'
import type { ResolvedConfig } from '..'
import type { Plugin } from '../plugin'
import { DpackDevServer } from '../server'

const htmlProxyRE = /\?html-proxy=?(?:&inline-css)?&index=(\d+)\.(js|css)$/
const htmlLangRE = /\.(?:html|htm)$/

// const importMapRE =
// /[ \t]*<script[^>]*type\s*=\s*(?:"importmap/

// this extends the config in @vue/compiler-sfc with <link href>
export const assetAttrsConfig: Record<string, string[]> = {
  link: ['href'],
  video: ['src', 'poster'],
  source: ['src', 'srcset'],
  img: ['src', 'srcset'],
  image: ['xlink:href', 'href'],
  use: ['xlink:href', 'href'],
}

export const isHTMLProxy = (id: string): boolean => htmlProxyRE.test(id)

export const isHTMLRequest = (request: string): boolean =>
  htmlLangRE.test(request)

export function nodeIsElement(
  node: DefaultTreeAdapterMap['node'],
): node is DefaultTreeAdapterMap['element'] {
  return node.nodeName[0] !== '#'
}

function traverseNodes(
  node: DefaultTreeAdapterMap['node'],
  visitor: (node: DefaultTreeAdapterMap['node']) => void,
) {
  visitor(node)
  if (
    nodeIsElement(node) ||
    node.nodeName === '#document' ||
    node.nodeName === '#document-fragment'
  ) {
    node.childNodes.forEach((childNode) => traverseNodes(childNode, visitor))
  }
}

export async function traverseHtml(
  html: string,
  filePath: string,
  visitor: (node: DefaultTreeAdapterMap['node']) => void,
) {
  const { parse } = await import('parse5')
  const ast = parse(html, {
    sourceCodeLocationInfo: true,
    onParseError: (e: any) => {
      // handleParseError(e, html, filePath)
    },
  })
  traverseNodes(ast, visitor)
}

export function getScriptInfo(node: DefaultTreeAdapterMap['element']) {
  let src: Token.Attribute | undefined
  let sourceCodeLocation: Token.Location | undefined
  let isModule = false
  let isAsync = false
  for (const p of node.attrs) {
    if (p.prefix !== undefined) continue
    if (p.name === 'src') {
      if (!src) {
        src = p
        sourceCodeLocation = node.sourceCodeLocation?.attrs!['src']
      }
    } else if (p.name === 'type' && p?.value === 'module') {
      isModule = true
    } else if (p.name === 'async') {
      isAsync = true
    }
  }
  return { src, sourceCodeLocation, isModule, isAsync }
}

export interface HtmlTagDescriptor {
  tag: string
  attrs?: Record<string, string | boolean | undefined>
  children?: string | HtmlTagDescriptor[]
  /**
   * default: 'head-prepend'
   */
  injectTo?: 'head' | 'body' | 'head-prepend' | 'body-prepend'
}

export type IndexHtmlTransformResult =
  | string
  | HtmlTagDescriptor[]
  | {
      html: string
      tags: HtmlTagDescriptor[]
    }

export interface IndexHtmlTransformContext {
  /**
   * public path when served
   */
  path: string
  /**
   * filename on disk
   */
  filename: string
  server?: DpackDevServer
  bundle?: OutputBundle
  chunk?: OutputChunk
  originalUrl?: string
}

export type IndexHtmlTransformHook = (
  this: void,
  html: string,
  ctx: IndexHtmlTransformContext,
) => IndexHtmlTransformResult | void | Promise<IndexHtmlTransformResult | void>

export type IndexHtmlTransform =
  | IndexHtmlTransformHook
  | {
      order?: 'pre' | 'post' | null
      transform: IndexHtmlTransformHook
    }
  | {
      order?: 'pre' | 'post' | null
      handler: IndexHtmlTransformHook
    }

export function resolveHtmlTransforms(
  plugins: readonly Plugin[],
): [
  IndexHtmlTransformHook[],
  IndexHtmlTransformHook[],
  IndexHtmlTransformHook[],
] {
  const preHooks: IndexHtmlTransformHook[] = []
  const normalHooks: IndexHtmlTransformHook[] = []
  const postHooks: IndexHtmlTransformHook[] = []

  for (const plugin of plugins) {
    const hook = plugin.transformIndexHtml
    if (!hook) continue

    if (typeof hook === 'function') {
      normalHooks.push(hook)
    } else {
      const order = hook.order ?? void 0
      // @ts-expect-error
      const handle = hook.handler ?? hook.transform
      if (order === 'pre') {
        preHooks.push(handle)
      } else if (order === 'post') {
        postHooks.push(handle)
      } else {
        normalHooks.push(handle)
      }
    }
  }

  return [preHooks, normalHooks, postHooks]
}

export async function applyHtmlTransforms(
  html: string,
  hooks: IndexHtmlTransformHook[],
  ctx: IndexHtmlTransformContext,
): Promise<string> {
  for (const hook of hooks) {
    const res = await hook(html, ctx)
    if (!res) {
      continue
    }
    if (typeof res === 'string') {
      html = res
    } else {
      let tags: HtmlTagDescriptor[]
      if (Array.isArray(res)) {
        tags = res
      } else {
        html = res.html || html
        tags = res.tags
      }

      const headTags: HtmlTagDescriptor[] = []
      const headPrependTags: HtmlTagDescriptor[] = []
      const bodyTags: HtmlTagDescriptor[] = []
      const bodyPrependTags: HtmlTagDescriptor[] = []

      for (const tag of tags) {
        if (tag.injectTo === 'body') {
          bodyTags.push(tag)
        } else if (tag.injectTo === 'body-prepend') {
          bodyPrependTags.push(tag)
        } else if (tag.injectTo === 'head') {
          headTags.push(tag)
        } else {
          headPrependTags.push(tag)
        }
      }

      html = injectToHead(html, headPrependTags, true)
      html = injectToHead(html, headTags)
      html = injectToBody(html, bodyPrependTags, true)
      html = injectToBody(html, bodyTags)
    }
  }

  return html
}
const headInjectRE = /([ \t]*)<\/head>/i
const headPrependInjectRE = /([ \t]*)<head[^>]*>/i

const htmlInjectRE = /<\/html>/i
const htmlPrependInjectRE = /([ \t]*)<html[^>]*>/i

const bodyInjectRE = /([ \t]*)<\/body>/i
const bodyPrependInjectRE = /([ \t]*)<body[^>]*>/i

const doctypePrependInjectRE = /<!doctype html>/i

function injectToHead(
  html: string,
  tags: HtmlTagDescriptor[],
  prepend = false,
) {
  if (tags.length === 0) return html

  if (prepend) {
    // ????????????head??????????????????
    if (headPrependInjectRE.test(html)) {
      return html.replace(
        headPrependInjectRE,
        (match, p1) => `${match}\n${serializeTags(tags, incrementIndent(p1))}`,
      )
    }
  } else {
    // inject before head close
    if (headInjectRE.test(html)) {
      // ??????head???????????????
      return html.replace(
        headInjectRE,
        (match, p1) => `${serializeTags(tags, incrementIndent(p1))}${match}`,
      )
    }
    // ?????????body???????????????
    if (bodyPrependInjectRE.test(html)) {
      return html.replace(
        bodyPrependInjectRE,
        (match, p1) => `${serializeTags(tags, p1)}\n${match}`,
      )
    }
  }
  // ????????????head?????????????????????prepend???append??????????????????
  return prependInjectFallback(html, tags)
}

function prependInjectFallback(html: string, tags: HtmlTagDescriptor[]) {
  // ???????????????html????????????doctype?????????????????????????????????????????????
  if (htmlPrependInjectRE.test(html)) {
    return html.replace(htmlPrependInjectRE, `$&\n${serializeTags(tags)}`)
  }
  if (doctypePrependInjectRE.test(html)) {
    return html.replace(doctypePrependInjectRE, `$&\n${serializeTags(tags)}`)
  }
  return serializeTags(tags) + html
}

function injectToBody(
  html: string,
  tags: HtmlTagDescriptor[],
  prepend = false,
) {
  if (tags.length === 0) return html

  if (prepend) {
    // inject after body open
    if (bodyPrependInjectRE.test(html)) {
      return html.replace(
        bodyPrependInjectRE,
        (match, p1) => `${match}\n${serializeTags(tags, incrementIndent(p1))}`,
      )
    }
    // ????????????body???????????????head??????????????????????????????html????????????
    if (headInjectRE.test(html)) {
      return html.replace(
        headInjectRE,
        (match, p1) => `${match}\n${serializeTags(tags, p1)}`,
      )
    }
    return prependInjectFallback(html, tags)
  } else {
    // inject before body close
    if (bodyInjectRE.test(html)) {
      return html.replace(
        bodyInjectRE,
        (match, p1) => `${serializeTags(tags, incrementIndent(p1))}${match}`,
      )
    }
    // ????????????body?????????????????????html??????????????????????????????????????????
    if (htmlInjectRE.test(html)) {
      return html.replace(htmlInjectRE, `${serializeTags(tags)}\n$&`)
    }
    return html + `\n` + serializeTags(tags)
  }
}

const unaryTags = new Set(['link', 'meta', 'base'])

function serializeTag(
  { tag, attrs, children }: HtmlTagDescriptor,
  indent: string = '',
): string {
  if (unaryTags.has(tag)) {
    return `<${tag}${serializeAttrs(attrs)}>`
  } else {
    return `<${tag}${serializeAttrs(attrs)}>${serializeTags(
      children,
      incrementIndent(indent),
    )}</${tag}>`
  }
}

function serializeTags(
  tags: HtmlTagDescriptor['children'],
  indent: string = '',
): string {
  if (typeof tags === 'string') {
    return tags
  } else if (tags && tags.length) {
    return tags.map((tag) => `${indent}${serializeTag(tag, indent)}\n`).join('')
  }
  return ''
}

function serializeAttrs(attrs: HtmlTagDescriptor['attrs']): string {
  let res = ''
  for (const key in attrs) {
    if (typeof attrs[key] === 'boolean') {
      res += attrs[key] ? ` ${key}` : ``
    } else {
      res += ` ${key}=${JSON.stringify(attrs[key])}`
    }
  }
  return res
}

function incrementIndent(indent: string = '') {
  return `${indent}${indent[0] === '\t' ? '\t' : '  '}`
}

export function getAttrKey(attr: Token.Attribute): string {
  return attr.prefix === undefined ? attr.name : `${attr.prefix}:${attr.name}`
}
