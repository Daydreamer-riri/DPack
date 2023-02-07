import path from 'node:path'
import fs from 'node:fs'
import type { ResolvedConfig } from '../config'
import { cleanUrl } from '../utils'

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
