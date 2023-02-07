import path from 'node:path'
import fs from 'node:fs'
import type { DpackDevServer } from '..'
import type { Connect } from 'dep-types/connect'
import { cleanUrl, removeTimestampQuery } from '../../utils'
import { NULL_BYTE_PLACEHOLDER } from '../../constants'
import { ResolvedConfig } from '../../config'

import { importAnalysisPlugin } from '../../plugins/importAnalysis'

const knownIgnoreList = new Set(['/', '/favicon.ico'])

export function transformMiddleware(
  server: DpackDevServer,
  config: ResolvedConfig,
): Connect.NextHandleFunction {
  const importAnalysis = importAnalysisPlugin(config)
  const { root } = config
  return async function dpackTransformMiddleware(req, res, next) {
    if (req.method !== 'GET' || knownIgnoreList.has(req.url!)) {
      return next()
    }

    let url: string
    try {
      url = decodeURI(removeTimestampQuery(req.url!)).replace(
        NULL_BYTE_PLACEHOLDER,
        '\0',
      )
    } catch (e) {
      return next(e)
    }

    const withoutQuery = cleanUrl(url)

    // 因为预构建我们配置生成了 map 文件所以同样要处理下 map 文件
    if (url.endsWith('.js') || url.endsWith('.map')) {
      const jsPath = path.join(root, url)
      const code = fs.readFileSync(jsPath, 'utf-8')
      res.setHeader('Content-Type', 'application/javascript')
      res.statusCode = 200
      // map 文件不需要分析 import 语句
      const transformCode = url.endsWith('.map')
        ? code
        : await importAnalysis.transform(code)
      return res.end(transformCode)
    }
    next()
  }
}
