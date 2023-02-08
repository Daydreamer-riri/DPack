import type { OutputBundle, OutputChunk } from 'rollup'
import { DpackDevServer } from '../server'

const htmlProxyRE = /\?html-proxy=?(?:&inline-css)?&index=(\d+)\.(js|css)$/
const htmlLangRE = /\.(?:html|htm)$/

export const isHTMLProxy = (id: string): boolean => htmlProxyRE.test(id)

export const isHTMLRequest = (request: string): boolean =>
  htmlLangRE.test(request)

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
    // 注入作为head的第一个元素
    if (headPrependInjectRE.test(html)) {
      return html.replace(
        headPrependInjectRE,
        (match, p1) => `${match}\n${serializeTags(tags, incrementIndent(p1))}`,
      )
    }
  } else {
    // inject before head close
    if (headInjectRE.test(html)) {
      // 尊重head标签的缩进
      return html.replace(
        headInjectRE,
        (match, p1) => `${serializeTags(tags, incrementIndent(p1))}${match}`,
      )
    }
    // 尽量在body标签前注入
    if (bodyPrependInjectRE.test(html)) {
      return html.replace(
        bodyPrependInjectRE,
        (match, p1) => `${serializeTags(tags, p1)}\n${match}`,
      )
    }
  }
  // 如果没有head标签，我们就为prepend和append的标签预置。
  return prependInjectFallback(html, tags)
}

function prependInjectFallback(html: string, tags: HtmlTagDescriptor[]) {
  // 预先添加到html标签，在doctype之后添加，或在文档开始时添加。
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
    // 如果没有body标签，就在head之后注入，或者回退到html中预置。
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
    // 如果没有body标签，则追加到html标签中，或追加到文件的最后。
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
