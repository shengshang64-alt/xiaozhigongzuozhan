// ---------------------------------------------------------------------------
// anbidRegionPresets —— 暗标「地区格式标准」预置（数据级复用，非算法）。
//
// 来源：对「格式镖师 v2.4.25」逆向报告 §12.1 的三套预置标准（内蒙古 / 河北 / 四川）
//   的逐项核对复刻。原文给出的是「招标文件暗标条款摘要」，此处把能映射到
//   AnbidFormatStandard 的字段如实填入；原文未明确的字段（页数上限、是否单独成册）
//   一律留 null —— 保持「留空即不判」的既有红线（见 anbidCheckConfig 头注释）。
//
// 为什么值得复用：本项目的 L1-10 页边距 / L1-13 字号 / L1-14 行距 / L1-12 页数
//   与 L5-C1 字体 / C6 页码 / C7 颜色 / C9 页数，全部依赖 formatStandard 有值才判定；
//   默认全 null 时这些检查项一律 unconfigured（空转）。预置值让它们一键生效。
//
// ⚠️ 预置只是「起点」：具体项目必须以该项目招标文件的暗标条款为准（note 字段保留
//   了原文口径，供人工比对后微调）。
// ---------------------------------------------------------------------------

import type { AnbidFormatStandard } from "./anbidCheckConfig"

export type AnbidRegionPreset = {
  /** 稳定 id（用于下拉选项与测试断言，不用中文名做键） */
  id: string
  /** 地区名（展示用） */
  name: string
  /** 该地区招标文件暗标条款原文摘录（展示 + 人工比对用，不参与判定） */
  note: string
  /** 映射后的暗标格式标准（null=原文未明确，保持不判定） */
  standard: AnbidFormatStandard
}

/** 三套地区预置（原文未明确的字段一律 null，绝不编造） */
export const ANBID_REGION_PRESETS: AnbidRegionPreset[] = [
  {
    id: "neimenggu",
    name: "内蒙古",
    note:
      "图表均采用 WPS Word 黑白绘制；大标题三号（16pt）宋体加粗，正文四号（14pt）宋体，全黑色，左对齐，段前段后不设空行，不得设置页眉页脚和页码；固定行距 28 磅；表格字号五号（10.5pt）；一级标题加粗。",
    standard: {
      bodyFont: "宋体",
      bodySize: "14pt",
      lineSpacing: "固定28磅",
      margins: { top: 2, right: 2, bottom: 2, left: 2 },
      allowPageNumber: false,
      allowColor: false,
      requireSeparateBooklet: null,
      maxPages: null,
      allowBulletNumbering: null,
    },
  },
  {
    id: "hebei",
    name: "河北",
    note:
      "表格内宋体四号（14pt）；正文宋体四号，全黑色，禁用所有特殊格式，段落左对齐，段前段后不设空行，不得设置页眉页脚和页码；固定行距 30 磅。",
    standard: {
      bodyFont: "宋体",
      bodySize: "14pt",
      lineSpacing: "固定30磅",
      margins: { top: 2.5, right: 2, bottom: 2, left: 2 },
      allowPageNumber: false,
      allowColor: false,
      requireSeparateBooklet: null,
      maxPages: null,
      allowBulletNumbering: null,
    },
  },
  {
    id: "sichuan",
    name: "四川",
    note:
      "口径与河北一致：正文宋体四号（14pt），大标题三号（16pt）宋体，全黑色，禁用特殊格式，段落左对齐，段前段后不设空行，不得设置页眉页脚和页码；固定行距 28 磅；四边距 2.5cm。",
    standard: {
      bodyFont: "宋体",
      bodySize: "14pt",
      lineSpacing: "固定28磅",
      margins: { top: 2.5, right: 2.5, bottom: 2.5, left: 2.5 },
      allowPageNumber: false,
      allowColor: false,
      requireSeparateBooklet: null,
      maxPages: null,
      allowBulletNumbering: null,
    },
  },
]

/** 按 id 取预置；未知 id 返回 null（调用方据此不改配置，而不是回落某个地区） */
export function getAnbidRegionPreset(id: string): AnbidRegionPreset | null {
  return ANBID_REGION_PRESETS.find((p) => p.id === id) ?? null
}
