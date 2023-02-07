import { readFileSync } from 'node:fs'

const { version } = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url)).toString(),
)

export const VERSION = version as string

export const DEFAULT_MAIN_FIELDS = [
  'module',
  'jsnext:main', // moment still uses this...
  'jsnext',
]

export const ESBUILD_MODULES_TARGET = [
  'es2020', // support import.meta.url
  'edge88',
  'firefox78',
  'chrome87',
  'safari14',
]

export const DEFAULT_EXTENSIONS = [
  '.mjs',
  '.js',
  '.mts',
  '.ts',
  '.jsx',
  '.tsx',
  '.json',
]

export const DEFAULT_CONFIG_FILES = [
  'vite.config.js',
  'vite.config.mjs',
  'vite.config.ts',
  'vite.config.cjs',
  'vite.config.mts',
  'vite.config.cts',
]

export const CSS_LANGS_RE =
  /\.(css|less|sass|scss|styl|stylus|pcss|postcss|sss)(?:$|\?)/

export const FS_PREFIX = `/@fs/`

export const VALID_ID_PREFIX = `/@id/`

export const wildcardHosts = new Set([
  '0.0.0.0',
  '::',
  '0000:0000:0000:0000:0000:0000:0000:0000',
])

export const NULL_BYTE_PLACEHOLDER = `__x00__`
