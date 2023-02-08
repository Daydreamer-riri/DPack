import { CSS_LANGS_RE } from '../constants'

const directRequestRE = /(?:\?|&)direct\b/

export const isCSSRequest = (request: string): boolean =>
  CSS_LANGS_RE.test(request)

export const isDirectCSSRequest = (request: string): boolean =>
  CSS_LANGS_RE.test(request) && directRequestRE.test(request)

export const isDirectRequest = (request: string): boolean =>
  directRequestRE.test(request)
