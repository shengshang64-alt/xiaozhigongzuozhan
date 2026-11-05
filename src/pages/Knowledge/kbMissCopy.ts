/**
 * 知识问答「0 命中」的用户可见文案（纯函数，零 React / 零网络）。
 *
 * 背景（阶段 1 · 包 3「未命中 vs 真无资料可区分」）：
 *   M0 §1.2 记录的半残事实是「知识问答『有要点说找不到』」——用户明明传过相关资料，
 *   问的时候却得到「知识库中没找到」。排查下来根因有两层：
 *   ① 检索确实没命中（相关性不足 / 问法与原文用词差异大）；
 *   ② 知识库根本是空的（或当前检索范围里一篇都没有）。
 *   原实现把这两层**合并成同一句话**「知识库中没找到与这个问题相关的内容」，
 *   于是「你还没上传资料」与「有资料但这次没匹配上」对用户完全不可区分，
 *   用户只会得出「这个知识库不好用」的结论，也无从知道下一步该做什么。
 *
 * 现口径：按「范围内有没有文档」分成两类，各自给出**不同的原因 + 不同的下一步**：
 *   · 范围内 0 篇    → 告诉他库里/该范围里确实没有资料，先上传或换范围；
 *   · 有文档但没命中 → 告诉他资料在、只是这次没匹配上，给出换问法 / 换范围 / 转待补答。
 * 两类都保持「绝不编造」，且都保留原来的「已记入待补答队列」承诺。
 */

export type KbMissKind = "empty_scope" | "no_match" | "filtered_out"

export interface KbMissCopyInput {
  /** 问题原文（会原样出现在提示里，调用方负责不要传入含 PII 的内容） */
  question: string
  /** 本次检索范围内的文档数（已经按可见性过滤） */
  scopeDocs: number
  /** 全库可见文档数（用于区分「范围里没有但库里其实有」） */
  visibleDocs: number
  /** 当前检索范围的中文名，如「团队知识库」「个人笔记」「全部」 */
  scopeLabel: string
}

export interface KbMissCopy {
  kind: KbMissKind
  /** 直接展示给用户的一段话（含下一步动作） */
  text: string
}

/**
 * 生成 0 命中的可区分文案。
 *
 * 三态而不是两态，是因为「切到某个范围后一篇都没有、但全库其实有」是真实且高频的操作
 * （用户把范围切到「个人笔记」而资料都在团队库）——这种情况如果只说「知识库是空的」，
 * 用户会以为资料丢了。所以单独成一类：告诉他资料在其他范围里，建议切回去。
 */
export function buildKbMissCopy(input: KbMissCopyInput): KbMissCopy {
  const { scopeDocs, visibleDocs, scopeLabel } = input
  const q = (input.question ?? "").trim()
  const qText = q ? `「${q}」` : "这个问题"

  if (scopeDocs === 0) {
    // 范围里一篇都没有：若全库有，说明是范围选窄了；若全库也没有，才是真的空库
    if (visibleDocs > 0) {
      return {
        kind: "filtered_out",
        text:
          `当前检索范围「${scopeLabel}」里没有任何文档，所以${qText}检索不到内容——` +
          `但你的知识库里共有 ${visibleDocs} 篇可见文档，多半是范围选窄了。` +
          `请把检索范围切回「全部」或资料所在的范围再问一次。` +
          `我不会编造知识库里没有的资料。\n\n` +
          `已记入待补答队列，团队补充答案后下次直接命中。`,
      }
    }
    return {
      kind: "empty_scope",
      text:
        `你的知识库目前还没有可检索的文档，所以${qText}无法回答。` +
        `请先上传相关资料（支持 md / docx / pdf / zip），或在「知识库」里确认文档可见范围设置后再问。` +
        `我不会编造知识库里没有的资料。\n\n` +
        `已记入待补答队列，团队补充答案后下次直接命中。`,
    }
  }

  // 有文档、只是这次没匹配上：给出可操作的三个方向，不要含糊说「没找到」
  return {
    kind: "no_match",
    text:
      `当前范围「${scopeLabel}」里有 ${scopeDocs} 篇文档，但都没有匹配到${qText}的相关内容。` +
      `可以试试：① 换个问法，用资料里出现过的术语（例如把「能不能过级」写成「分级评价几级的要求」）；` +
      `② 放宽检索范围（切到「全部」）；③ 直接上传更贴题的文档。` +
      `我不会编造知识库里没有的资料。\n\n` +
      `已记入待补答队列，团队补充答案后下次直接命中。`,
  }
}

/** 检索范围的中文名（与 QaDrawer 的范围选择器口径一致） */
export function qaScopeLabel(scope: string): string {
  if (scope === "team") return "团队知识库"
  if (scope === "personal") return "个人笔记"
  return "全部"
}
