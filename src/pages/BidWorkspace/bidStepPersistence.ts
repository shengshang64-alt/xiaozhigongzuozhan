// 标书工作台「当前步骤」持久化（2026-10-27，P0 行为逻辑修复）
//
// 问题（用户章程 P0「不丢状态」）：
//   `useBidWorkspace` 里 `const [activeStep, setActiveStep] = useState(1)` 是**纯内存**状态。
//   打开项目时按数据推断重设（`setActiveStep(rec.bid_chapters.length ? 3 : rec.parse_report ? 2 : 1)`），
//   于是：
//     · 用户在【第 6 步 导出】刷新页面（或误触后退、切项目再切回）→ 被弹回第 3 步正文生成；
//     · 第 4/5 步（偏离表 / 交卷体检）刷新后一律回落到 2 或 3，用户得重新点两次才能回到原位。
//   实测链路共 7 步（BidWorkspacePage.tsx: activeStep === 1..7）。
//
// 修法：按项目 id 把用户所处步骤记进 localStorage（与 complianceMatrix 的 bid_matrix_* 同模式：
//   按项目隔离、读写全部 try/catch 降级为「无记录」，绝不阻断主流程）。
//   恢复时取「已记录步骤」与「数据可支撑步骤」的较小值——防止用户手改 localStorage
//   或数据被清空后，界面停在一个没有数据可展示的空步骤上。
//
// 关键取舍：**只记录用户主动跳转的步骤**，不记录自动推断值。
// 否则「打开项目时推断出的步骤」会把用户上次的真实位置覆盖掉。

const KEY_PREFIX = "bid_step_"

/** 合法步骤范围：与 BidWorkspacePage.tsx 的 activeStep === 1..7 一一对应 */
export const MIN_BID_STEP = 1
export const MAX_BID_STEP = 7

function storageKeyFor(projectId: string): string {
  return `${KEY_PREFIX}${projectId}`
}

function clampStep(n: number): number | null {
  if (!Number.isFinite(n)) return null
  const i = Math.round(n)
  if (i < MIN_BID_STEP || i > MAX_BID_STEP) return null
  return i
}

/** 读该项目上次停留的步骤；无记录 / 脏值 / 存储不可用 → null */
export function readBidStep(projectId: string | null | undefined): number | null {
  const id = String(projectId ?? "").trim()
  if (!id) return null
  try {
    if (typeof window === "undefined" || !window.localStorage) return null
    const raw = window.localStorage.getItem(storageKeyFor(id))
    if (!raw) return null
    return clampStep(Number(raw))
  } catch {
    return null
  }
}

/** 记录用户当前步骤；任何异常静默降级（记不住步骤是体验问题，不能阻断主流程） */
export function writeBidStep(projectId: string | null | undefined, step: number): void {
  const id = String(projectId ?? "").trim()
  const s = clampStep(step)
  if (!id || s === null) return
  try {
    if (typeof window === "undefined" || !window.localStorage) return
    window.localStorage.setItem(storageKeyFor(id), String(s))
  } catch {
    /* 隐私模式 / 配额满 → 仅本次会话生效 */
  }
}

/** 清除某项目的步骤记录（项目删除 / 重置流程时调用） */
export function clearBidStep(projectId: string | null | undefined): void {
  const id = String(projectId ?? "").trim()
  if (!id) return
  try {
    if (typeof window === "undefined" || !window.localStorage) return
    window.localStorage.removeItem(storageKeyFor(id))
  } catch {
    /* ignore */
  }
}

/**
 * 计算「打开项目时应停在哪个步骤」——纯函数，便于单测。
 *
 * @param inferred  仅按数据推断出的步骤（旧逻辑：有正文=3 / 有报告=2 / 否则 1）
 * @param recorded  localStorage 里记录的用户步骤（可为 null）
 * @param dataMax   当前数据实际能支撑到的最大步骤（由调用方按数据算，如无正文则 <3）
 *
 * 规则：
 *   · 无记录 → 用推断值（保持旧行为）
 *   · 有记录 → 取 recorded 与 dataMax 的较小值：既尊重用户上次位置，
 *     又不会停在一个数据已被清空、根本无内容可看的步骤上
 */
export function resolveOpenStep(inferred: number, recorded: number | null, dataMax: number): number {
  const inf = clampStep(inferred) ?? MIN_BID_STEP
  const max = clampStep(dataMax) ?? inf
  const rec = recorded === null ? null : clampStep(recorded)
  if (rec === null) return Math.min(inf, max) || inf
  return Math.max(MIN_BID_STEP, Math.min(rec, max))
}

// ---------------------------------------------------------------------------
// 当前选中章（2026-10-27 第 2 轮 P0：章节编辑器刷新丢选中位置）
//
// 实测：在「投标文件编制」里点开「第16章 培训方案」→ 刷新页面 →
// 编辑区回到第一项（第11章 总体技术方案）。`activeChapterId` 是纯内存 useState，
// 进项目时无人恢复，UI 只能兜底选第一章。写正文时刷新一次就丢位置，属章程 P0「不丢状态」。
//
// 键按项目隔离，只记「每项目最后一次选中的章」（不按章各记一条，避免键膨胀）。
// ---------------------------------------------------------------------------

const CHAPTER_KEY_PREFIX = "bid_chapter_"

/** 读该项目上次选中的章 node_id；无记录/空值 → null */
export function readActiveChapterId(projectId: string | null | undefined): string | null {
  const id = String(projectId ?? "").trim()
  if (!id) return null
  try {
    if (typeof window === "undefined" || !window.localStorage) return null
    const raw = window.localStorage.getItem(CHAPTER_KEY_PREFIX + id)
    const v = String(raw ?? "").trim()
    return v || null
  } catch {
    return null
  }
}

/** 记录当前选中的章；异常静默降级（记不住位置是体验问题，不能阻断编辑） */
export function writeActiveChapterId(projectId: string | null | undefined, nodeId: string | null | undefined): void {
  const id = String(projectId ?? "").trim()
  const ch = String(nodeId ?? "").trim()
  if (!id || !ch) return
  try {
    if (typeof window === "undefined" || !window.localStorage) return
    window.localStorage.setItem(CHAPTER_KEY_PREFIX + id, ch)
  } catch {
    /* 隐私模式 / 配额满 → 仅本次会话生效 */
  }
}

/**
 * 计算「进项目时应选中哪一章」——纯函数，便于单测。
 *
 * @param recorded   记录的上次选中章 node_id（可为 null）
 * @param chapterIds 当前项目全部章的 node_id（按大纲顺序）
 *
 * 关键：**必须「记录值仍在清单里」才恢复**。项目重新生成大纲后旧 node_id 会失效，
 * 此时硬恢复会得到一个不存在的章（编辑区空白），因此回退第一项。
 */
export function resolveActiveChapterId(
  recorded: string | null | undefined,
  chapterIds: readonly string[],
): string | null {
  const list = (chapterIds ?? []).filter((x) => !!x)
  if (!list.length) return null
  const rec = String(recorded ?? "").trim()
  if (rec && list.includes(rec)) return rec
  return list[0]
}
