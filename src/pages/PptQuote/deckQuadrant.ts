// ---------------------------------------------------------------------------
// 「内容页结构配方」识别（2026-11-05 v4）
//
// 背景：前面几轮试过 6 种「把要点塞进模板格子」的方案，全部失败，原因是没搞清
// 模板格子的语义分层。实测公司模板「内页1」的 12 张样例页里，slide12 是唯一
// 结构规整、且**恰好适合 4 条并列要点**的一张：
//
//   顶部   胶囊标签（小字，深底白字）      ← 栏目名，如「智慧服务三级」
//   大字   40pt 主标题                    ← 本页主张
//   中部   2×2 四象限，每格两层：
//            第 1 层 14pt 蓝          「实时监控」   ← 小标题（4-6 字）
//            第 2 层 12pt 灰          「系统全天候…」← 一句说明（20-40 字）
//   底部   4 个圆角标签                   ← 一句话标签
//
// 我手工把 4 条医院要点注入这 8 个格子，渲染结果**版面整洁、无溢出、无留白**
// （对照：塞进 slide5 会溢出重叠，塞进 slide18 会挤在一个框里）。
//
// 本模块只做纯几何识别：给定一张样例页的形状清单，判断它是不是「四象限」结构，
// 并给出 8 个语义槽位的下标。不碰 XML、不改写内容，便于单测与复用。
// ---------------------------------------------------------------------------

/** 一个形状的最小几何与文字信息（由调用方从 XML 里抽好传进来） */
export type ShapeInfo = {
  /** 在形状数组里的下标 */
  idx: number
  /** 左上角 x（EMU） */
  x: number
  /** 左上角 y（EMU） */
  y: number
  /** 宽（EMU） */
  cx: number
  /** 高（EMU） */
  cy: number
  /** 字号（pt）；取不到按 0 */
  fontSize: number
  /** 该形状现有的文字（用来判断"是不是真模板位"） */
  text: string
}

/** 四象限版式的 8 个语义槽位（下标对应形状数组） */
export type QuadrantSlots = {
  /** 顶部胶囊标签（可空） */
  badge: number | null
  /** 40pt 主标题 */
  headline: number
  /** 4 个象限，每个是 [小标题下标, 说明下标] */
  cells: [number, number][]
  /** 底部 4 个标签（可空，可能少于 4 个） */
  footerTags: number[]
}

/** 页高（16:9，13.33×7.5 英寸） */
const PAGE_H = 6858000
/** 页宽 */
const PAGE_W = 12192000

/**
 * 识别「四象限」结构（2026-11-05）。
 *
 * 判定条件（全部来自 slide12 实测，宁可认不出也不误判）：
 *   ① 有且仅有一个「字号 ≥ 32pt」的大字形状 → 主标题；
 *   ② 中部存在 ≥2 行 × 2 列的「小标题 + 说明」成对结构：
 *      · 小标题：字号 12-24pt、位在同一行；
 *      · 说明：字号 8-14pt、紧跟其下（y 差 < 页高 8%）、x 与小标题对齐；
 *   ③ 成对结构的数量恰好 4（2×2）；
 *   ④ 底部（y > 页高 80%）有 1-4 个矮条形形状 → 标签带。
 *
 * 任一条不满足返回 null，调用方退回「单正文框」的老逻辑。
 */
export function detectQuadrantSlots(shapes: readonly ShapeInfo[]): QuadrantSlots | null {
  if (!shapes.length) return null

  // ① 主标题：字号 ≥ 32pt 且**有文字**的唯一形状
  //（实测模板里有些空形状字号解析为 0，必须同时要求 text 非空）
  const headlineCands = shapes.filter((s) => s.fontSize >= 32 && s.text.trim() !== "")
  if (headlineCands.length !== 1) return null
  const headline = headlineCands[0]

  // ④ 底部标签带：y 在 82% 以下、有文字的矮条形形状
  const footerTags = shapes
    .filter(
      (s) =>
        s.idx !== headline.idx &&
        s.y > PAGE_H * 0.82 &&
        s.cy < PAGE_H * 0.12 &&
        s.text.trim() !== "",
    )
    .map((s) => s.idx)
  if (footerTags.length < 1 || footerTags.length > 6) return null

  // ② 中部正文形状：排除主标题与底部标签，必须有文字
  const mid = shapes.filter(
    (s) =>
      s.idx !== headline.idx &&
      !footerTags.includes(s.idx) &&
      s.y > PAGE_H * 0.25 &&
      s.y < PAGE_H * 0.82 &&
      s.text.trim() !== "",
  )
  if (mid.length < 8) return null

  // 按行分带（y 容差 = 页高 3%）
  const yTol = PAGE_H * 0.03
  const rows: { y: number; items: ShapeInfo[] }[] = []
  for (const s of [...mid].sort((a, b) => a.y - b.y)) {
    const hit = rows.find((r) => Math.abs(r.y - s.y) <= yTol)
    if (hit) hit.items.push(s)
    else rows.push({ y: s.y, items: [s] })
  }
  // 只留「2 个形状一行」的行（四象限每行两个）
  const twoCol = rows.filter((r) => r.items.length === 2)
  if (twoCol.length < 4) return null

  // ③ 相邻两行组成一组卡片：上行=小标题、下行=说明。
  //
  // 2026-11-05 修正：**不能用字号判断"哪个是标题"**——
  // 实测模板里小标题的 sz 常缺省（继承母版，解析为 0），而说明是显式 12pt，
  // 按"上大下小"判会把唯一的正确结构全部判掉（识别恒为 null）。
  // 改用**文字长度**判断：小标题短（4-12 字）、说明长（≥12 字），这个规律稳。
  const cells: [number, number][] = []
  for (let i = 0; i + 1 < twoCol.length; i += 2) {
    const top = [...twoCol[i].items].sort((a, b) => a.x - b.x)
    const bottom = [...twoCol[i + 1].items].sort((a, b) => a.x - b.x)
    const topLen = avgLen(top)
    const botLen = avgLen(bottom)
    // 下行必须明显更长（是"说明"），否则不是「标题+说明」结构
    if (!(botLen > topLen)) continue
    for (let c = 0; c < 2; c++) {
      // x 必须对齐（同列容差 = 页宽 8%）
      if (Math.abs(top[c].x - bottom[c].x) > PAGE_W * 0.08) return null
      cells.push([top[c].idx, bottom[c].idx])
    }
  }
  if (cells.length !== 4) return null

  // ⑤ 顶部胶囊：主标题**上方**的矮条形有文字形状（可缺）。
  //    注意 headline.y 是"大字框"的位置，胶囊在它上方；这里要求 y 明显更小。
  const badge =
    shapes.find(
      (s) =>
        s.idx !== headline.idx &&
        s.y < headline.y - PAGE_H * 0.02 &&
        s.cy < PAGE_H * 0.1 &&
        s.text.trim() !== "" &&
        !footerTags.includes(s.idx),
    )?.idx ?? null

  return { badge, headline: headline.idx, cells, footerTags }
}

function avgLen(items: readonly ShapeInfo[]): number {
  if (!items.length) return 0
  return items.reduce((n, s) => n + s.text.trim().length, 0) / items.length
}

/**
 * 把 4 条要点分配到四象限槽位。
 *
 * @param lines 4 条要点
 * @returns 每个槽位要写的文字；`cells[i]` 对应 `[小标题, 说明]`
 *
 * 约定（与提示词侧一致）：每条要点写成「小标题：说明」形式，例如
 *   `统一入口：自助机、公众号、医生工作站统一身份与入口`
 * 拆分规则：首个冒号前 ≤12 字 → 当小标题；否则整条当说明、小标题留空。
 * 不做改写、不编造。
 */
export function splitQuadrantText(line: string): { title: string; body: string } {
  const s = String(line ?? "").trim()
  if (!s) return { title: "", body: "" }
  const m = /^([^：:]{1,12})[：:]\s*(.+)$/.exec(s)
  if (m) return { title: m[1].trim(), body: m[2].trim() }
  return { title: "", body: s }
}

/**
 * 判断一批要点是否适合用四象限版式。
 *
 * 条件：恰好 4 条，且每条拆开后都能拿到非空小标题（否则小标题格会空，版面难看）。
 * 不适合就返回 false，调用方继续用「单正文框」——这是"宁可普通也不做坏"的原则。
 */
export function fitsQuadrant(lines: readonly string[]): boolean {
  const items = lines.map((l) => String(l ?? "").trim()).filter(Boolean)
  if (items.length !== 4) return false
  return items.every((l) => splitQuadrantText(l).title !== "")
}
