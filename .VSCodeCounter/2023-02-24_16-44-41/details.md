# Details

Date : 2023-02-24 16:44:41

Directory d:\\Users\\ding.zhao\\Code\\MyProject\\DPack\\packages\\dpack\\src

Total : 54 files,  8147 codes, 1673 comments, 1167 blanks, all 10987 lines

[Summary](results.md) / Details / [Diff Summary](diff.md) / [Diff Details](diff-details.md)

## Files
| filename | language | code | comment | blank | total |
| :--- | :--- | ---: | ---: | ---: | ---: |
| [packages/dpack/src/client/client.ts](/packages/dpack/src/client/client.ts) | TypeScript | 147 | 5 | 28 | 180 |
| [packages/dpack/src/client/env.ts](/packages/dpack/src/client/env.ts) | TypeScript | 26 | 1 | 3 | 30 |
| [packages/dpack/src/client/tsconfig.json](/packages/dpack/src/client/tsconfig.json) | JSON with Comments | 10 | 0 | 1 | 11 |
| [packages/dpack/src/node/build.ts](/packages/dpack/src/node/build.ts) | TypeScript | 53 | 50 | 10 | 113 |
| [packages/dpack/src/node/cli.ts](/packages/dpack/src/node/cli.ts) | TypeScript | 143 | 1 | 18 | 162 |
| [packages/dpack/src/node/config.ts](/packages/dpack/src/node/config.ts) | TypeScript | 390 | 86 | 53 | 529 |
| [packages/dpack/src/node/constants.ts](/packages/dpack/src/node/constants.ts) | TypeScript | 91 | 11 | 22 | 124 |
| [packages/dpack/src/node/http.ts](/packages/dpack/src/node/http.ts) | TypeScript | 105 | 1 | 15 | 121 |
| [packages/dpack/src/node/index.ts](/packages/dpack/src/node/index.ts) | TypeScript | 4 | 0 | 3 | 7 |
| [packages/dpack/src/node/logger.ts](/packages/dpack/src/node/logger.ts) | TypeScript | 134 | 0 | 15 | 149 |
| [packages/dpack/src/node/optimizer/esbuildDepPlugin.ts](/packages/dpack/src/node/optimizer/esbuildDepPlugin.ts) | TypeScript | 229 | 14 | 23 | 266 |
| [packages/dpack/src/node/optimizer/index.ts](/packages/dpack/src/node/optimizer/index.ts) | TypeScript | 618 | 87 | 86 | 791 |
| [packages/dpack/src/node/optimizer/opimizer.ts](/packages/dpack/src/node/optimizer/opimizer.ts) | TypeScript | 526 | 43 | 91 | 660 |
| [packages/dpack/src/node/optimizer/scan.ts](/packages/dpack/src/node/optimizer/scan.ts) | TypeScript | 216 | 192 | 28 | 436 |
| [packages/dpack/src/node/packages.ts](/packages/dpack/src/node/packages.ts) | TypeScript | 113 | 2 | 10 | 125 |
| [packages/dpack/src/node/plugin.ts](/packages/dpack/src/node/plugin.ts) | TypeScript | 30 | 15 | 3 | 48 |
| [packages/dpack/src/node/plugins/asset.ts](/packages/dpack/src/node/plugins/asset.ts) | TypeScript | 21 | 3 | 2 | 26 |
| [packages/dpack/src/node/plugins/clientInjections.ts](/packages/dpack/src/node/plugins/clientInjections.ts) | TypeScript | 67 | 0 | 11 | 78 |
| [packages/dpack/src/node/plugins/css.ts](/packages/dpack/src/node/plugins/css.ts) | TypeScript | 8 | 0 | 5 | 13 |
| [packages/dpack/src/node/plugins/esbuild.ts](/packages/dpack/src/node/plugins/esbuild.ts) | TypeScript | 6 | 137 | 14 | 157 |
| [packages/dpack/src/node/plugins/html.ts](/packages/dpack/src/node/plugins/html.ts) | TypeScript | 297 | 24 | 38 | 359 |
| [packages/dpack/src/node/plugins/importAnalysis.ts](/packages/dpack/src/node/plugins/importAnalysis.ts) | TypeScript | 411 | 119 | 62 | 592 |
| [packages/dpack/src/node/plugins/importMetaGlob.ts](/packages/dpack/src/node/plugins/importMetaGlob.ts) | TypeScript | 17 | 0 | 2 | 19 |
| [packages/dpack/src/node/plugins/index.ts](/packages/dpack/src/node/plugins/index.ts) | TypeScript | 83 | 6 | 6 | 95 |
| [packages/dpack/src/node/plugins/loadFallback.ts](/packages/dpack/src/node/plugins/loadFallback.ts) | TypeScript | 15 | 3 | 2 | 20 |
| [packages/dpack/src/node/plugins/optimizedDeps.ts](/packages/dpack/src/node/plugins/optimizedDeps.ts) | TypeScript | 73 | 5 | 10 | 88 |
| [packages/dpack/src/node/plugins/preAlias.ts](/packages/dpack/src/node/plugins/preAlias.ts) | TypeScript | 94 | 7 | 5 | 106 |
| [packages/dpack/src/node/plugins/resolve.ts](/packages/dpack/src/node/plugins/resolve.ts) | TypeScript | 685 | 163 | 96 | 944 |
| [packages/dpack/src/node/server/hmr.ts](/packages/dpack/src/node/server/hmr.ts) | TypeScript | 250 | 12 | 35 | 297 |
| [packages/dpack/src/node/server/index.ts](/packages/dpack/src/node/server/index.ts) | TypeScript | 445 | 168 | 63 | 676 |
| [packages/dpack/src/node/server/middlewares/error.ts](/packages/dpack/src/node/server/middlewares/error.ts) | TypeScript | 21 | 0 | 3 | 24 |
| [packages/dpack/src/node/server/middlewares/htmlFallback.ts](/packages/dpack/src/node/server/middlewares/htmlFallback.ts) | TypeScript | 30 | 2 | 5 | 37 |
| [packages/dpack/src/node/server/middlewares/indexHtml.ts](/packages/dpack/src/node/server/middlewares/indexHtml.ts) | TypeScript | 209 | 3 | 27 | 239 |
| [packages/dpack/src/node/server/middlewares/proxy.ts](/packages/dpack/src/node/server/middlewares/proxy.ts) | TypeScript | 11 | 9 | 2 | 22 |
| [packages/dpack/src/node/server/middlewares/static.ts](/packages/dpack/src/node/server/middlewares/static.ts) | TypeScript | 0 | 0 | 1 | 1 |
| [packages/dpack/src/node/server/middlewares/transform.ts](/packages/dpack/src/node/server/middlewares/transform.ts) | TypeScript | 144 | 10 | 16 | 170 |
| [packages/dpack/src/node/server/moduleGraph.ts](/packages/dpack/src/node/server/moduleGraph.ts) | TypeScript | 119 | 2 | 14 | 135 |
| [packages/dpack/src/node/server/pluginContainer.ts](/packages/dpack/src/node/server/pluginContainer.ts) | TypeScript | 399 | 18 | 48 | 465 |
| [packages/dpack/src/node/server/searchRoot.ts](/packages/dpack/src/node/server/searchRoot.ts) | TypeScript | 30 | 9 | 9 | 48 |
| [packages/dpack/src/node/server/send.ts](/packages/dpack/src/node/server/send.ts) | TypeScript | 50 | 6 | 10 | 66 |
| [packages/dpack/src/node/server/transformRequest.ts](/packages/dpack/src/node/server/transformRequest.ts) | TypeScript | 147 | 7 | 29 | 183 |
| [packages/dpack/src/node/server/ws.ts](/packages/dpack/src/node/server/ws.ts) | TypeScript | 221 | 24 | 20 | 265 |
| [packages/dpack/src/node/shoutcut.ts](/packages/dpack/src/node/shoutcut.ts) | TypeScript | 89 | 13 | 18 | 120 |
| [packages/dpack/src/node/tsconfig.json](/packages/dpack/src/node/tsconfig.json) | JSON with Comments | 8 | 0 | 1 | 9 |
| [packages/dpack/src/node/utils.ts](/packages/dpack/src/node/utils.ts) | TypeScript | 577 | 44 | 79 | 700 |
| [packages/dpack/src/node/watch.ts](/packages/dpack/src/node/watch.ts) | TypeScript | 13 | 11 | 2 | 26 |
| [packages/dpack/src/types/alias.d.ts](/packages/dpack/src/types/alias.d.ts) | TypeScript | 13 | 42 | 7 | 62 |
| [packages/dpack/src/types/anymatch.d.ts](/packages/dpack/src/types/anymatch.d.ts) | TypeScript | 4 | 0 | 2 | 6 |
| [packages/dpack/src/types/chokidar.d.ts](/packages/dpack/src/types/chokidar.d.ts) | TypeScript | 58 | 137 | 35 | 230 |
| [packages/dpack/src/types/connect.d.ts](/packages/dpack/src/types/connect.d.ts) | TypeScript | 54 | 45 | 13 | 112 |
| [packages/dpack/src/types/http-proxy.d.ts](/packages/dpack/src/types/http-proxy.d.ts) | TypeScript | 156 | 76 | 19 | 251 |
| [packages/dpack/src/types/package.json](/packages/dpack/src/types/package.json) | JSON | 3 | 0 | 1 | 4 |
| [packages/dpack/src/types/shims.d.ts](/packages/dpack/src/types/shims.d.ts) | TypeScript | 4 | 0 | 2 | 6 |
| [packages/dpack/src/types/ws.d.ts](/packages/dpack/src/types/ws.d.ts) | TypeScript | 480 | 60 | 44 | 584 |

[Summary](results.md) / Details / [Diff Summary](diff.md) / [Diff Details](diff-details.md)