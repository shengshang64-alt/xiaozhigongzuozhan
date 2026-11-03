// ---------------------------------------------------------------------------
// R280（delivery-p0-02 根因定位前置）：章节生成失败原因的归一化。
// 失败瞬间 toast 里能看到原因，但页面刷新/重进方案后彻底丢失——演练记录里
// 「11 章全 failed、0 字、查无原因」正是这个断点导致的考古无门。
// 把真实原因归一成一行短文本随 chapters JSON 落库，才能回答「模型通道/超时/额度」哪一类。
// ---------------------------------------------------------------------------

/** 落库长度上限：够一行 tooltip 读完；整本批量全失败也不会把 chapters JSON 撑爆（与批量收口 roll-call 的旧截断口径一致） */
export const GEN_ERROR_MAX_LEN = 60

/** 模型空产出原因（单章/批量/重试三处统一口径，界面 toast 同文案） */
export const BLANK_OUTPUT_REASON = "模型返回空正文"

/**
 * 把 catch 到的未知异常压成一行原因：换行折叠、截断到上限；
 * 拿不到有效文本（空 message、非 Error 对象等）时落回 fallback，保证落库字段永远可读。
 */
export function describeGenFailure(e: unknown, fallback: string): string {
  const raw = e instanceof Error ? e.message : typeof e === "string" ? e : ""
  const oneLine = raw.replace(/[\r\n]+/g, " ").trim().slice(0, GEN_ERROR_MAX_LEN)
  return oneLine || fallback
}
