/**
 * 情报「自动抓取到底什么时候在跑」的**如实说明**（纯函数，零 React / 零网络）。
 *
 * 背景（R3 · D4 /intel-center 🟡「关页即停」）：
 *   抓取的触发点只有前端——页面挂载 + 驻留期间每 15 分钟调一次 `POST /api/intel/tick`。
 *   浏览器一关，抓取就停。但界面文案写的是：
 *     · 「后台定时抓取为尽力而为，部分网站可能抓不到」
 *     · 空态「可以等待下一轮自动抓取」
 *   两句都暗示「不关页面也会抓」。用户在关页后等一天没有新情报，会认为抓取坏了——
 *   其实只是这条链路本来就没在服务端跑（实测 40 源里 14 源长期 error，也印证
 *   「需要持续重试」而不是「抓一次就够」）。
 *
 * 现口径：**说准边界**。前端无权探测 Windows 计划任务，所以不做「已启用/未启用」的断言，
 * 而是把两件事分开讲清楚：
 *   ① 本页开着的时候会抓（每 15 分钟一轮）——这是确定的；
 *   ② 关页之后要不要继续抓，取决于有没有注册服务端计划任务——本页探测不到，
 *      给出可执行动作与核实位置，而不是含糊其辞。
 *
 * 这不是 UI 重画，只换一句话——D6「不改壳，只修文案」。
 */

export interface AutoFetchCopyInput {
  /** 页面当前是否可见（document.visibilityState === "visible"） */
  pageVisible: boolean
}

/**
 * 抓取状态说明（替换原「后台定时抓取为尽力而为」那句）。
 *
 * 措辞纪律：**不出现「后台」二字**——原句里的「后台」正是误导来源
 * （用户会读成「服务端在跑」）。改说「本页打开期间」。
 */
export function describeAutoFetch(input: AutoFetchCopyInput): string {
  const base =
    "自动抓取在本页打开期间进行（每 15 分钟检查一次到期信息源）；关闭本页后抓取会停止，除非已在服务端注册计划任务（scripts/health/intel-tick-timer.ps1，注册后每 30 分钟一轮，本页无法探测是否已注册，可在系统的计划任务列表核实）。"
  const tail = "只入库医疗信息化相关内容；抓取结果需人工确认后作为正式情报。确认、忽略与收藏都是每人独立状态，不影响其他成员；内置源抓取结果全员可见，个人源与未公开的手动录入仅自己可见。"
  const paused = input.pageVisible ? "" : "本页当前不在前台，自动抓取已暂停；回到本页后会继续。"
  return `${paused}${base}${tail}`
}

/** 空态里那句「可以等待下一轮自动抓取」的替换文案。 */
export function describeWaitForNextRound(input: AutoFetchCopyInput): string {
  if (input.pageVisible) {
    return "可以保持本页打开等待下一轮自动抓取（每 15 分钟一轮），或到信息源管理里立即抓取一次。"
  }
  return "自动抓取只在页面打开时进行，本页不在前台时不会继续；请到信息源管理里立即抓取一次，或注册服务端计划任务（scripts/health/intel-tick-timer.ps1）。"
}
