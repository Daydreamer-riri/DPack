import type { SourceMap } from 'rollup'

export interface TransformResult {
  code: string
  map: SourceMap | null
  etag?: string
  deps?: string[]
  dynamicDeps?: string[]
}

export interface TransformOptions {
  ssr?: boolean
  html?: boolean
}
