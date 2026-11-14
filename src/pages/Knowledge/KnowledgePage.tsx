// UX-v2（2026-11-11）：知识库按 docs/ux-v2-2026-11/prototype/kb/ 六屏拆分。
//
// 拆法与客户管理 / 情报中心 / 方案工作室 / 素材库 / 工作台同款：
// 一个顶层路由 + ?tab= 切换（口径见 components/knowledge/kbTabs.ts），不拆顶层路由——
// 拆成六条顶层路由会让工作区标签栏多出六个「知识库」标签，且 7000 篇文档列表要各拉一遍。
//
// 六屏与原型的对应：
//   文档库   browse  —— 入口：一个搜索框 + 目录树 + 文档卡（被引用 N 次）
//   全文检索 search  —— 一个框搜到底，标题命中 / 正文命中分两组
//   知识原子 atoms   —— 一等公民：引用次数 / 冲突提示 / 来源溯源
//   原子审核 review  —— 逐条采纳 / 改写 / 丢弃（复用 useKbReview 全部逻辑）
//   问知识库 qa      —— 答案带来源编号，未命中 vs 真无资料分开说
//   上传文档 upload  —— 上传即建索引，解析到哪一步都看得见
//
// 零能力丢失：原有的阅读区（DocReaderPanel）搬进弹窗、列表栏（DocListPanel）整体保留、
// 本机资料检索（AnyTXT）收进「查看配置」弹窗、上传与问答从抽屉/弹窗升级为独立屏。
import { useSearchParams } from "react-router-dom"
import { CostConfirmDialog } from "@/components/rh/CostConfirmDialog"
import { KbSubtabs } from "@/components/knowledge/KbSubtabs"
import { KbBrowseScreen } from "@/components/knowledge/KbBrowseScreen"
import { KbSearchScreen } from "@/components/knowledge/KbSearchScreen"
import { KbAtomsScreen } from "@/components/knowledge/KbAtomsScreen"
import { KbAtomReviewScreen } from "@/components/knowledge/KbAtomReviewScreen"
import { KbQaScreen } from "@/components/knowledge/KbQaScreen"
import { KbUploadScreen } from "@/components/knowledge/KbUploadScreen"
import { parseKbTab, type KbTab } from "@/components/knowledge/kbTabs"
import type { useKnowledge } from "./useKnowledge"

export function KnowledgePage(p: ReturnType<typeof useKnowledge>) {
  // 屏内 Tab 走 ?tab=（默认「文档库」，旧书签 / 旧链接行为不变）
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = parseKbTab(searchParams.get("tab"))
  const goTab = (next: KbTab) =>
    setSearchParams(next === "browse" ? {} : { tab: next }, { replace: true })

  return (
    <div className="text-foreground">
      <KbSubtabs active={tab} onSelect={goTab} />
      {tab === "browse" ? <KbBrowseScreen p={p} onTab={goTab} /> : null}
      {tab === "search" ? <KbSearchScreen p={p} onTab={goTab} /> : null}
      {tab === "atoms" ? <KbAtomsScreen onTab={goTab} userId={p.userId} /> : null}
      {tab === "review" ? <KbAtomReviewScreen userId={p.userId} onTab={goTab} /> : null}
      {tab === "qa" ? <KbQaScreen p={p} onTab={goTab} /> : null}
      {tab === "upload" ? <KbUploadScreen p={p} onTab={goTab} /> : null}
      <CostConfirmDialog {...p.costConfirm} />
    </div>
  )
}
