/// <reference path="../pb_data/types.d.ts" />
// 2026-10-28（DSB6）：kb_docs 增补案例/素材结构化字段。
//
// 为什么加：
//   kb_docs 现有 7,002 条全是纯文本，没有字段可以存「抽取出来的结构化信息」。
//   知识库 320 篇「项目案例」里，实测 287 篇（89.7%）能抽出金额/年份/医院名，
//   但只能存回 content 里当文本，检索只能全文模糊匹配，没法按金额区间、年份、医院筛选。
//
// 为什么这样加：
//   ① 纯增量：两个字段都可空、无默认值、不 required，既有 7002 行保持 NULL，
//      前端一律按「无结构化数据」处理，不改变任何现有读写路径（6 个写路由 + kbCore 均不读此字段）。
//   ② structured 用 json 类型而非 text：PocketBase 会对 json 字段做合法 JSON 校验，
//      能挡住「写进一个坏 JSON 字符串」；text 会原样收下任何内容
//      （2026-10-27 归档页白屏事故正是 JSON 数组列被写成空字符串导致的）。
//   ③ structured_ver 记抽取器版本，重抽时可判断新旧，避免旧抽取结果覆盖新口径。
//
// 回滚：down 里移除这两个字段。字段数据随字段一起丢弃，不影响其他列。
//
// 幂等：已存在则跳过（PB 迁移本身只跑一次，这里再加一层防御，便于手工重放）。
migrate(
  (app) => {
    const col = app.findCollectionByNameOrId("kb_docs")

    const hasField = (name) => {
      try {
        return !!col.fields.getByName(name)
      } catch (_) {
        return false
      }
    }

    let changed = false
    if (!hasField("structured")) {
      col.fields.add(new Field({ name: "structured", type: "json" }))
      changed = true
    }
    if (!hasField("structured_ver")) {
      col.fields.add(new Field({ name: "structured_ver", type: "text", max: 20 }))
      changed = true
    }
    if (changed) app.save(col)
  },
  (app) => {
    const col = app.findCollectionByNameOrId("kb_docs")
    col.fields.removeByName("structured")
    col.fields.removeByName("structured_ver")
    app.save(col)
  },
)
