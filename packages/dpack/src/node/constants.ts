import { readFileSync } from 'node:fs'
import path, { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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
  'dpack.config.js',
  'dpack.config.mjs',
  'dpack.config.ts',
  'dpack.config.cjs',
  'dpack.config.mts',
  'dpack.config.cts',
]
export const JS_TYPES_RE = /\.(?:j|t)sx?$|\.mjs$/

export const CSS_LANGS_RE =
  /\.(css|less|sass|scss|styl|stylus|pcss|postcss|sss)(?:$|\?)/

export const OPTIMIZABLE_ENTRY_RE = /\.[cm]?[jt]s$/

export const SPECIAL_QUERY_RE = /[?&](?:worker|sharedworker|raw|url)\b/

/**
 * 用于解析fs路径的前缀，因为windows路径可能无法作为URL有效。
 */
export const FS_PREFIX = `/@fs/`

/**
 * 为已解析的Ids提供前缀，这些Ids不是有效的浏览器导入指定符。
 */
export const VALID_ID_PREFIX = `/@id/`

export const CLIENT_PUBLIC_PATH = `/@dpack/client`
export const ENV_PUBLIC_PATH = `/@dpack/env`
export const NULL_BYTE_PLACEHOLDER = `__x00__`

export const DPACK_PACKAGE_DIR = resolve(
  // import.meta.url is `dist/node/constants.js` after bundle
  fileURLToPath(import.meta.url),
  '../../..',
)

export const CLIENT_ENTRY = resolve(DPACK_PACKAGE_DIR, 'dist/client/client.mjs')
export const ENV_ENTRY = resolve(DPACK_PACKAGE_DIR, 'dist/client/env.mjs')
export const CLIENT_DIR = path.dirname(CLIENT_ENTRY)

export const KNOWN_ASSET_TYPES = [
  // images
  'png',
  'jpe?g',
  'jfif',
  'pjpeg',
  'pjp',
  'gif',
  'svg',
  'ico',
  'webp',
  'avif',

  // media
  'mp4',
  'webm',
  'ogg',
  'mp3',
  'wav',
  'flac',
  'aac',

  // fonts
  'woff2?',
  'eot',
  'ttf',
  'otf',

  // other
  'webmanifest',
  'pdf',
  'txt',
]

export const loopbackHosts = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '0000:0000:0000:0000:0000:0000:0000:0001',
])

export const wildcardHosts = new Set([
  '0.0.0.0',
  '::',
  '0000:0000:0000:0000:0000:0000:0000:0000',
])

export const DEFAULT_ASSETS_RE = new RegExp(
  `\\.(` + KNOWN_ASSET_TYPES.join('|') + `)(\\?.*)?$`,
)

export const DEP_VERSION_RE = /[?&](v=[\w.-]+)\b/
