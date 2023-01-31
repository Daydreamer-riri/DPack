// export async function applyHtmlTransforms(
//   html: string,
//   hooks: IndexHtmlTransformHook[],
//   ctx: IndexHtmlTransformContext,
// ): Promise<string> {
//   for (const hook of hooks) {
//     const res = await hook(html, ctx)
//     if (!res) {
//       continue
//     }
//     if (typeof res === 'string') {
//       html = res
//     } else {
//       let tags: HtmlTagDescriptor[]
//       if (Array.isArray(res)) {
//         tags = res
//       } else {
//         html = res.html || html
//         tags = res.tags
//       }

//       const headTags: HtmlTagDescriptor[] = []
//       const headPrependTags: HtmlTagDescriptor[] = []
//       const bodyTags: HtmlTagDescriptor[] = []
//       const bodyPrependTags: HtmlTagDescriptor[] = []

//       for (const tag of tags) {
//         if (tag.injectTo === 'body') {
//           bodyTags.push(tag)
//         } else if (tag.injectTo === 'body-prepend') {
//           bodyPrependTags.push(tag)
//         } else if (tag.injectTo === 'head') {
//           headTags.push(tag)
//         } else {
//           headPrependTags.push(tag)
//         }
//       }

//       html = injectToHead(html, headPrependTags, true)
//       html = injectToHead(html, headTags)
//       html = injectToBody(html, bodyPrependTags, true)
//       html = injectToBody(html, bodyTags)
//     }
//   }

//   return html
// }
