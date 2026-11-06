// Bake 的 vite.config.ts (0.0.7+ runtime). 已经 inline 了 rh-visual-edit 的
// rhSourcePlugin —— 模型不需要再调 rh-visual-edit skill 装它.
//
// ⚠️ 整体 Write 覆盖本文件是禁忌. 改时用 Read + Edit 局部改:
//   - 加 alias / 改 server 配置: 修对应字段
//   - 加别的 plugin: 在 plugins 数组里追加, 但 rhSourcePlugin() 必须在第 0 位 (enforce: 'pre' 保证它在 react/oxc 之前跑)
//   - 不要删 rhSourcePlugin 那段函数定义, 也不要删 @babel/parser / @babel/traverse / magic-string 这三个 import
import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { parse as babelParse } from '@babel/parser'
import _traverse from '@babel/traverse'
import MagicString from 'magic-string'
// R2（整仓重构 · 部署壳）：出口反代口径（/__pb + /__sc）与 vibex-local/vite.local.config.ts
// 共用同一份定义，避免「dev 有代理、preview 没有」这类静默分叉。
import { buildProxy } from './vite.proxy'

// @babel/traverse 在本仓库没有类型声明, 因此用本地别名收口（不再写 any）:
// 只描述本文件真正访问到的字段, 越界即编译报错.
type RhJsxName = { end?: number | null }
type RhJsxAttr = { type: string; name?: { name?: string } }
type RhJsxNode = {
  name?: RhJsxName
  attributes?: RhJsxAttr[]
  typeArguments?: RhJsxName | null
  typeParameters?: RhJsxName | null
  loc?: { start: { line: number; column: number } } | null
}
type RhVisitPath = { node: RhJsxNode }
type RhTraverse = (ast: unknown, visitors: { JSXOpeningElement: (path: RhVisitPath) => void }) => void

// @babel/traverse 在不同 bundler 下 ESM/CJS interop 形态不一致, 兜底取 default.
const traverse = ((_traverse as unknown as { default?: unknown }).default ?? _traverse) as RhTraverse

// rh-visual-edit: 独立 Vite plugin, 给每个 JSX 元素加 data-rh-src="<rel>:<line>:<col>".
// 不依赖 @vitejs/plugin-react 的 babel hook (plugin-react v6+ 已切到 oxc, 不再接受 babel 选项).
function rhSourcePlugin() {
  return {
    name: 'rh-source',
    enforce: 'pre' as const,
    apply: 'serve' as const,
    transform(code: string, id: string) {
      const cleanId = id.split('?')[0]
      if (!/\.(jsx|tsx)$/.test(cleanId)) return null
      if (cleanId.includes('/node_modules/')) return null
      const parsed = (() => {
        try {
          return babelParse(code, {
            sourceType: 'module',
            allowReturnOutsideFunction: true,
            plugins: ['jsx', 'typescript'],
          })
        } catch {
          return null
        }
      })()
      if (!parsed) return null
      // 注: @babel/parser 的返回类型是 ParseResult<File> = File & { comments, errors }，
      // 即返回值本身就是 File 节点（不是外层包装）。取 .program 会把 Program 当根传入，
      // traverse 找不到父作用域会抛 getBlockParent 错。
      const ast: unknown = parsed
      const cwd = process.cwd()
      const rel = cleanId.startsWith(cwd + '/') ? cleanId.slice(cwd.length + 1) : cleanId
      const filename = rel.replace(/\\/g, '/')
      const ms = new MagicString(code)
      traverse(ast, {
        JSXOpeningElement(p) {
          const node = p.node
          const loc = node.loc
          if (!loc) return
          const attrs = node.attributes ?? []
          const exists = attrs.some(
            (a) => a.type === 'JSXAttribute' && a.name?.name === 'data-rh-src',
          )
          if (exists) return
          const nameNode = node.name
          if (!nameNode || nameNode.end == null) return
          // TSX 里 <Foo<T> /> 合法; 必须插在 typeArguments 之后, 否则会变成
          // <Foo data-rh-src="..."<T> /> 导致 oxc/babel 解析失败.
          const insertEnd =
            node.typeArguments?.end ?? node.typeParameters?.end ?? nameNode.end
          if (insertEnd == null) return
          ms.appendRight(
            insertEnd,
            ` data-rh-src="${filename}:${loc.start.line}:${loc.start.column}"`,
          )
        },
      })
      if (!ms.hasChanged()) return null
      return {
        code: ms.toString(),
        map: ms.generateMap({ hires: true, source: id }),
      }
    },
  }
}

export default defineConfig({
  plugins: [rhSourcePlugin(), react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    allowedHosts: ['.runninghub.cn', '.vibex.cn'],
    host: '0.0.0.0',
    port: 8000,
    strictPort: true,
    // R2（整仓重构 · 部署壳）：此前本配置**没有** /__pb 代理，于是 `npm run dev`
    // 表现为「界面能开但数据全空」，长期靠 AGENTS.md 一句话劝人别用。
    // 现在与 vibex-local 配置共用 vite.proxy.ts 的口径，两条路径不再分叉；
    // 顺带把增强服务 /__sc 也接上，`npm run dev` 下增强功能同样可用。
    proxy: buildProxy(),
  },
  preview: {
    host: '0.0.0.0',
    port: 8000,
    // R2：build 产物托管的出口同样要能转 /__pb 与 /__sc，
    // 否则「改走 build」这条部署路径上数据全空、增强功能静默降级。
    proxy: buildProxy(),
  },
})
