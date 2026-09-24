// AI 生成 JSON 的跨模块容错解析（标书 / 方案 / PPT 共用）
//
// 大模型在长文本字段里常吐出「裸控制字符」——真实的换行/制表符或其它 0x00–0x1F 字节，
// 而非合法 JSON 要求的 `\n` `\t` 转义。这是 JSON 规范里的非法项，会让 JSON.parse 直接抛
// "Bad control character in string literal in JSON at position N"，并以裸 SyntaxError 冒到用户面前。
// 这里逐级放宽（原样 → 结构修复 → 转义控制字符 → 二者叠加），全失败才抛一句可读、可重试的错误。

/**
 * 转义 JSON 字符串字面量内部的裸控制字符。
 * - 结构区（引号外）原样保留：那里的换行/空格是合法分隔符，不该动；
 * - 已有的合法转义（`\n`、`\"`、`\\` 等两字符序列）不受影响：靠 esc 态跳过转义值；
 * - 仅把字符串值内部 code<0x20 的裸字节替换为其转义写法。
 */
export function escapeControlCharsInStrings(s: string): string {
  let out = ""
  let inStr = false
  let esc = false
  for (const ch of s) {
    if (inStr) {
      if (esc) {
        esc = false
        out += ch
        continue
      }
      if (ch === "\\") {
        esc = true
        out += ch
        continue
      }
      if (ch === '"') {
        inStr = false
        out += ch
        continue
      }
      const code = ch.charCodeAt(0)
      if (code < 0x20) {
        out +=
          code === 0x0a
            ? "\\n"
            : code === 0x0d
              ? "\\r"
              : code === 0x09
                ? "\\t"
                : `\\u${code.toString(16).padStart(4, "0")}`
        continue
      }
      out += ch
      continue
    }
    if (ch === '"') {
      inStr = true
      out += ch
      continue
    }
    out += ch
  }
  return out
}

/**
 * 宽松解析一段（已截好界的）JSON 候选串。
 * @param text   候选串
 * @param repair 可选结构修复器（补全未闭合括号 / 去尾逗号等），在原始串与转义串上各再试一次
 * @returns 解析后的值；成功路径与直接 JSON.parse 完全等价（第一次尝试即命中）
 * @throws Error 全部尝试失败时抛「AI 返回内容不是有效 JSON，请重试」（不裸抛 SyntaxError 给用户）
 */
export function parseJsonTolerant(text: string, repair?: (s: string) => string): unknown {
  const attempts: string[] = [text]
  if (repair) attempts.push(repair(text))
  const escaped = escapeControlCharsInStrings(text)
  if (escaped !== text) {
    attempts.push(escaped)
    if (repair) attempts.push(repair(escaped))
  }
  for (const t of attempts) {
    try {
      return JSON.parse(t)
    } catch {
      // 逐级放宽，试下一级
    }
  }
  throw new Error("AI 返回内容不是有效 JSON，请重试")
}
