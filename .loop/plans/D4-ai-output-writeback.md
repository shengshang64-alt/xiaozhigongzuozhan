# D4：AI 产出交付闭环 ⑤ — 技能产出一键采用/写回

## 目标

小智助手预设技能产出后，ChatStream 气泡行内展示「采纳」按钮，一键将内容写回对应业务对象。

## 写回映射（复用既有通道，零新建集合）

| 技能名 | 写回目标 | 通道 | 交互 |
|--------|---------|------|------|
| 写客户跟进邮件 | follow_records | POST /api/follow_records | 选客户→存档 ✅已有 |
| 生成周报总结 | 导出 docx | 前端 docx 引擎 | 下载 Word ✅已有 |
| 竞品深度分析 | competitors.threat_notes | PATCH /api/competitors/{id} | 选竞品→追加写入 **新** |
| 方案大纲构思 | 方案编辑器 | 剪贴板+跳转 | 复制并去编辑 **已有** |
| 招标文件要点梳理 | bid_projects.ref_materials_text | PATCH /api/bid_projects/{id} | 选标书项目→追加 **新** |
| 客户拜访准备清单 | follow_records | POST /api/follow_records | 选客户→存档 **新** |

## 交互模式
- 统一气泡底部行 SkillAdoptRow
- 采纳按钮文案随技能动态
- 下拉选择器复用 PocketBase list API perPage=200
- 追加策略：threat_notes / ref_materials_text 换行追加不覆盖
- 成功 toast 附"查看"跳转

## 自定义技能
用户自建技能不展示采纳按钮（未知写回目标），仅保留复制。

## UI 密度收敛
- ChatStream gap-4 → gap-3（移动端保持 gap-4）
- 卡片圆角统一 rounded-xl (14px)
- 字号层级收敛：标题 text-sm font-semibold、正文 text-sm、辅助 text-xs

## 验收标准
1. 六个预设技能产出均可一键采纳
2. 竞品/标书写回真实数据可验证
3. vitest SkillAdoptRow 单测 ≥5 用例
