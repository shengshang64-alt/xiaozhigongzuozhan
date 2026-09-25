// ---------------------------------------------------------------------------
// R57/F13+F14：客户地区与医院等级的「展示/筛选层归一」——纯函数，不写库。
// 库里原始值保持不动（改数据需用户确认）；列表徽标、筛选项、过滤比较统一走这里，
// 解决「华东/福建/安徽省合肥市混用、筛选项出现市级组合」「三甲 vs 三级甲等不一致」。
// ---------------------------------------------------------------------------

/** 省级行政区短名（与库内主流口径一致：福建/海南/江苏……不带「省/市」后缀）+ 七大地理分区 */
export const CANONICAL_REGIONS = [
  "北京", "天津", "上海", "重庆",
  "河北", "山西", "辽宁", "吉林", "黑龙江",
  "江苏", "浙江", "安徽", "福建", "江西", "山东",
  "河南", "湖北", "湖南", "广东", "海南",
  "四川", "贵州", "云南", "陕西", "甘肃", "青海",
  "台湾", "内蒙古", "广西", "西藏", "宁夏", "新疆",
  "香港", "澳门",
  "华东", "华北", "华南", "华中", "西南", "西北", "东北",
] as const

/** 省级全称 → 库内短名（「安徽省合肥市」→「安徽」用：先剥后缀再对短名表） */
const SUFFIXES = ["省", "市", "自治区", "特别行政区", "维吾尔", "回族", "壮族"] as const

/**
 * 地区归一：识别「安徽」「安徽省」「安徽省合肥市」→「安徽」；
 * 非地区值（如「部门」）或识别不出的值返回 ""（不进筛选项；列表展示仍用原始值）。
 */
export function normalizeRegion(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim()
  if (!s) return ""
  if ((CANONICAL_REGIONS as readonly string[]).includes(s)) return s
  // 逐前缀试短名：「安徽省合肥市」→ 前缀命中「安徽」
  for (const canonical of CANONICAL_REGIONS) {
    if (s.startsWith(canonical)) {
      const rest = s.slice(canonical.length)
      // 命中短名后，余下部分必须是纯后缀/市级拼接（安徽省 | 市 | 自治州…），防「山东黄金」误命中
      if (!rest || SUFFIXES.some((suf) => rest.startsWith(suf))) return canonical
    }
  }
  // 全称兜底：「福建省」未命中短名开头不可能（短名含福建），此处处理「内蒙古自治区」类
  const stripped = SUFFIXES.reduce((acc, suf) => acc.split(suf).join(""), s)
  return (CANONICAL_REGIONS as readonly string[]).includes(stripped) ? stripped : ""
}

/** 等级简称 → 全称；无法识别的原样返回（不造数据） */
const LEVEL_ALIAS: Record<string, string> = {
  三甲: "三级甲等",
  三级甲等: "三级甲等",
  二甲: "二级甲等",
  二级甲等: "二级甲等",
  三乙: "三级乙等",
  三级乙等: "三级乙等",
  二乙: "二级乙等",
  二级乙等: "二级乙等",
}

/** 医院等级归一展示：「三甲」→「三级甲等」；「三级/县区」等原样保留 */
export function normalizeHospitalLevel(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim()
  return LEVEL_ALIAS[s] ?? s
}
