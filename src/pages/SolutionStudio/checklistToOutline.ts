// R168：清单→标准方案骨架 正向组装（零 AI 纯函数）
// 用户诉求：方案先对照公司系统/产品清单，再据清单组装公司标准方案。
// 既有 systemsFromChecklist 已把清单勾选行抽成 product_name[]；本模块把它按方案类型的
// 标准章节模板铺成大纲骨架——「各系统/核心功能模块」章按清单命中的系统逐条展开为子节，
// 其余为固定标准章节。产出骨架可直接进向导第三步编辑，再复用既有逐章生成填充正文。
import { makeUid, type OutlineNode, type SolutionTypeKey } from "./solutionTypes"

/** 单个章节模板定义；systemsChapter=true 的章用清单命中的系统名铺子节 */
export type SkeletonChapterDef = { title: string; systemsChapter?: boolean }

/** 各方案类型的标准章节骨架（口径对齐 SOLUTION_TYPES.guidance，去散文取结构） */
export const SKELETON_TEMPLATES: Record<SolutionTypeKey, SkeletonChapterDef[]> = {
  standard: [
    { title: "产品总体介绍与价值主张" },
    { title: "总体技术架构" },
    { title: "核心功能模块介绍", systemsChapter: true },
    { title: "产品亮点与差异化优势" },
    { title: "实施方案与服务体系" },
    { title: "典型落地案例" },
    { title: "投资估算与服务报价" },
    { title: "效益分析" },
  ],
  preliminary: [
    { title: "总体设计" },
    { title: "各分系统初步设计", systemsChapter: true },
    { title: "基础设施与部署架构设计" },
    { title: "安全设计" },
    { title: "项目实施组织与进度计划" },
    { title: "初步设计概算" },
    { title: "效益分析" },
  ],
  planning: [
    { title: "项目背景与政策依据" },
    { title: "现状与需求分析" },
    { title: "总体规划思路与目标" },
    { title: "总体架构" },
    { title: "重点应用系统规划", systemsChapter: true },
    { title: "基础设施与云资源规划" },
    { title: "数据治理与标准体系" },
    { title: "网络与信息安全体系" },
    { title: "分期实施路径与保障措施" },
    { title: "投资估算与资金筹措" },
    { title: "效益分析与风险评估" },
  ],
  feasibility: [
    { title: "项目概述与建设必要性" },
    { title: "政策依据" },
    { title: "现状与差距分析" },
    { title: "需求分析" },
    { title: "建设方案论证", systemsChapter: true },
    { title: "信息安全等级保护与商用密码应用方案" },
    { title: "项目组织与实施进度计划" },
    { title: "投资估算与资金筹措" },
    { title: "社会效益与经济效益分析" },
    { title: "风险分析与对策" },
    { title: "可行性研究结论与建议" },
  ],
  custom: [
    { title: "项目背景与需求理解" },
    { title: "总体建设方案", systemsChapter: true },
    { title: "定制功能设计" },
    { title: "与院内现有系统的集成方案" },
    { title: "数据迁移方案" },
    { title: "安全设计" },
    { title: "实施计划与服务保障" },
    { title: "投资估算" },
    { title: "效益分析" },
  ],
}

/** 清洗清单系统名：去空、trim、按首次出现去重（与 systemsFromChecklist 同口径的防御） */
function normalizeSystems(systems: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const s of systems ?? []) {
    const name = (s ?? "").trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

/**
 * 清单命中的产品/系统 → 标准方案大纲骨架（零 AI）。
 * - systems 为空时仍产出固定标准章节（systemsChapter 章留空，用户可后续补）。
 * - 未知 typeKey 回落 standard 模板。
 * - systemsChapter 章把每个系统名铺成一个子节（叶），供逐章生成时按系统展开。
 */
export function checklistToOutlineSkeleton(systems: string[], typeKey: string): OutlineNode[] {
  const tpl = SKELETON_TEMPLATES[typeKey as SolutionTypeKey] ?? SKELETON_TEMPLATES.standard
  const list = normalizeSystems(systems)
  return tpl.map((def) => ({
    id: makeUid(),
    title: def.title,
    children: def.systemsChapter
      ? list.map((name) => ({ id: makeUid(), title: name, children: [] }))
      : [],
  }))
}
