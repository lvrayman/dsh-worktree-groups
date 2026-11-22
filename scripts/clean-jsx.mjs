// 清理 `tsc` 在 `"jsx": "preserve"` 下额外产出的 inert 垃圾：
// lib/client.jsx / lib/client.jsx.map / lib/sidebar.jsx / lib/sidebar.jsx.map。
//
// `"jsx": "preserve"` 是让 `.tsx` 走类型检查的正确选择（不要改 tsconfig），
// 副作用就是 tsc 会为每个 .tsx 同时吐出 .jsx。这些 .jsx 不参与运行时
// （esbuild 写的 lib/client.js 是后写的、形态正确），package.json 的 files
// 也只发布 `**/*.js`，但它们会让人误以为产物有两个版本。
//
// 用 Node 而不是 `rm -f`，保证 Windows 上也能跑；目录不存在时静默跳过。
import { readdirSync, rmSync } from 'node:fs'

let removed = 0
for (const entry of readdirSync('lib')) {
  if (!entry.endsWith('.jsx') && !entry.endsWith('.jsx.map')) continue
  rmSync(`lib/${entry}`)
  removed += 1
}

console.log(`[clean-jsx] removed ${removed} file(s) from lib/`)
