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
 * 默认结构修复器：补齐模型被截断（max token 切断）的 JSON 骨架。
 * - 去掉 `}`/`]` 前的尾逗号；
 * - 若停在字符串中，补一个闭合双引号；
 * - 按未闭合的 `{`/`[` 栈逆序补全对应 `}`/`]`。
 * 仅在原始串直接解析失败后作为「放宽级」尝试，绝不改变合法 JSON 的结果。
 */
export function repairJsonStructure(s: string): string {
  let out = s.replace(/,(\s*[}\]])/g, "$1")
  const stack: string[] = []
  let inStr = false
  let esc = false
  for (const ch of out) {
    if (inStr) {
      if (esc) esc = false
      else if (ch === "\\") esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') {
      inStr = true
      continue
    }
    if (ch === "{" || ch === "[") stack.push(ch)
    else if (ch === "}" || ch === "]") stack.pop()
  }
  if (inStr) out += '"'
  out = out.replace(/,(\s*[}\]])/g, "$1").replace(/,\s*$/, "")
  while (stack.length) {
    const open = stack.pop()
    out += open === "{" ? "}" : "]"
  }
  return out
}

/**
 * 宽松解析一段（已截好界的）JSON 候选串。
 * @param text   候选串
 * @param repair 可选结构修复器（补全未闭合括号 / 去尾逗号等），在原始串与转义串上各再试一次；缺省时自动用内置 repairJsonStructure 兜底截断
 * @returns 解析后的值；成功路径与直接 JSON.parse 完全等价（第一次尝试即命中）
 * @throws Error 全部尝试失败时抛「AI 返回内容不是有效 JSON，请重试」（不裸抛 SyntaxError 给用户）
 */
export function parseJsonTolerant(text: string, repair?: (s: string) => string): unknown {
  // 未显式传入结构修复器时，默认用 repairJsonStructure 兜底截断（PPT 报价 / 方案编制共用路径）；
  // 显式传入者（如标书 bidTypes）行为完全不变。始终作为原始串解析失败后的追加尝试级。
  const fix = repair ?? repairJsonStructure
  const attempts: string[] = [text, fix(text)]
  const escaped = escapeControlCharsInStrings(text)
  if (escaped !== text) {
    attempts.push(escaped, fix(escaped))
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
