// ---------------------------------------------------------------------------
// 解析后端化（大文件通道）
//
// 解决什么（2026-10-27 用户拍板「第二步走 B：大文件解析」）：
//   前端解析受四条硬限制，真标书动辄 30-76 万字，全部超限：
//     wholeParse.ts:24   WHOLE_FILE_LIMIT = 60000      整文通道 6 万字
//     wholeParse.ts:26   PARSE_SEGMENT_CHARS = 45000   单段 4.5 万字
//     wholeParse.ts:38   PARSE_MAX_SEGMENTS = 20       最多 20 段
//     wholeParse.ts:46   PARSE_MAX_SEGMENTS_CRITICAL = 24
//   超限后回落「关键词检索通道」，而检索通道本质是抽样 —— 这是素材丢失的主因。
//
// 实测证据（真实库，2026-10-27）：
//     项目                原文      解析总字数   提取率    废标项
//     313131            762,209     36,363      4.8%      44 字
//     天坛医院           417,254     18,348      4.4%      0 字
//     三明(实测)         381,609     10,989      2.9%      0 字
//   而小标书（15 万字）能解析出 58,093 字（38%）。**长度直接决定解析质量。**
//
// 本模块做什么：
//   把「切段」搬到后端，去掉 20 段上限。因为服务端不需要在单次请求里返回全部结果，
//   可以按段分片、由前端逐段推进（也可后台跑完整轮再落库）。
//   本阶段先提供**切段计划**与**分段内容**两个端点，前端据此驱动原有解析流程。
//
// 不做什么：
//   不在这里调模型。模型调用仍走既有 modelGateway（前端已有一套重试/计费/失败降级），
//   搬过来会重复实现并破坏既有计费口径。后端只负责「切得动 + 给得全」。
// ---------------------------------------------------------------------------

/** 默认单段字数（与前端 PARSE_SEGMENT_CHARS 对齐，保持一致口径） */
const DEFAULT_SEGMENT_CHARS = 45000
/** 默认最多段数（前端是 20/24；后端放开到 64，覆盖 76 万字 ÷ 4.5 万 ≈ 17 段的两倍余量） */
const DEFAULT_MAX_SEGMENTS = 64

/**
 * 按字符数切段，但**优先在自然边界切**（换行 → 句号 → 分号 → 硬切）。
 *
 * 为什么不直接 slice：真实标书里常见的坑是切在表格行中间、切在「★条款」编号后，
 * 那样模型看到半句话会误判。这里逐级回退找边界，找不到才硬切。
 */
function splitByChars(text, segmentChars) {
  const src = String(text ?? "")
  if (!src) return []
  if (src.length <= segmentChars) return [src]

  const segments = []
  let pos = 0
  while (pos < src.length) {
    let end = Math.min(src.length, pos + segmentChars)
    if (end < src.length) {
      // 在 [end - 2000, end] 区间里找最好的边界
      const floor = Math.max(pos + Math.floor(segmentChars * 0.6), end - 2000)
      const window = src.slice(floor, end)
      // ① 换行（最优：整行/整表不切）
      let cut = window.lastIndexOf("\n")
      // ② 句号（次优）
      if (cut < 0) cut = Math.max(window.lastIndexOf("。"), window.lastIndexOf("！"), window.lastIndexOf("？"))
      // ③ 分号
      if (cut < 0) cut = Math.max(window.lastIndexOf("；"), window.lastIndexOf(";"))
      if (cut >= 0) end = floor + cut + 1
    }
    segments.push(src.slice(pos, end))
    pos = end
  }
  return segments
}

/**
 * 生成切段计划：每段的位置、字数、首尾摘要（前端用来显示进度）。
 * 不返回全文（76 万字一次传回前端就失去意义了）。
 */
function planSegments(text, segmentChars, maxSegments) {
  const segs = splitByChars(text, segmentChars)
  const capped = segs.slice(0, maxSegments)
  return {
    totalChars: text.length,
    segmentChars,
    segmentCount: capped.length,
    /** 是否因 maxSegments 被截断（true 说明还有内容没被覆盖，需调大或再分层） */
    truncated: segs.length > maxSegments,
    uncappedCount: segs.length,
    segments: capped.map((s, i) => ({
      index: i,
      chars: s.length,
      /** 首 80 字（前端进度条/调试用） */
      head: s.slice(0, 80).replace(/\s+/g, " "),
      /** 尾 40 字（确认切点没切坏） */
      tail: s.slice(-40).replace(/\s+/g, " "),
      /** 起止字符偏移（便于前端按需取单段） */
      start: capped.slice(0, i).reduce((a, x) => a + x.length, 0),
    })),
  }
}

export function register({ route, readJson, send }) {
  /**
   * POST /parse/plan
   * body: { text, segmentChars?, maxSegments? }
   * 返回切段计划（不含全文，体积小）
   */
  route("POST", "/parse/plan", async (req, res) => {
    const body = await readJson(req, 120 * 1024 * 1024)
    const text = String(body.text ?? "")
    if (!text.trim()) {
      send(res, 400, { error: "no_text", message: "text 为空" })
      return
    }
    const segmentChars = Math.max(5000, Math.min(200000, Number(body.segmentChars) || DEFAULT_SEGMENT_CHARS))
    const maxSegments = Math.max(1, Math.min(256, Number(body.maxSegments) || DEFAULT_MAX_SEGMENTS))
    const t0 = Date.now()
    const plan = planSegments(text, segmentChars, maxSegments)
    console.log(`[parse] plan ${text.length} 字 → ${plan.segmentCount} 段（上限 ${maxSegments}）/ ${Date.now() - t0}ms`)
    send(res, 200, plan)
  })

  /**
   * POST /parse/segment
   * body: { text, index, segmentChars?, maxSegments? }
   * 返回第 index 段的完整内容（前端逐段取，避免一次拉全文进内存）
   */
  route("POST", "/parse/segment", async (req, res) => {
    const body = await readJson(req, 120 * 1024 * 1024)
    const text = String(body.text ?? "")
    const index = Number(body.index)
    const segmentChars = Math.max(5000, Math.min(200000, Number(body.segmentChars) || DEFAULT_SEGMENT_CHARS))
    const maxSegments = Math.max(1, Math.min(256, Number(body.maxSegments) || DEFAULT_MAX_SEGMENTS))
    const segs = splitByChars(text, segmentChars).slice(0, maxSegments)
    if (!Number.isInteger(index) || index < 0 || index >= segs.length) {
      send(res, 400, { error: "bad_index", message: `index 越界（0..${segs.length - 1}）`, segmentCount: segs.length })
      return
    }
    send(res, 200, { index, total: segs.length, chars: segs[index].length, content: segs[index] })
  })
}
