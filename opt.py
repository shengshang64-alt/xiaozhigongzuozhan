p = r"D:\重要文件\工作的小程序\xiaozhigongzuozhan\scripts\extract-atoms-bulk.mjs"
src = open(p, encoding="utf-8").read()
old = '''const MIN_SCORE = Number((args.find((a) => a.startsWith("--minscore=")) ?? "--minscore=0").split("=")[1])'''
new = '''const MIN_SCORE = Number((args.find((a) => a.startsWith("--minscore=")) ?? "--minscore=0").split("=")[1])
/**
 * 2026-11-01：是否排除「50000 字截断文档」。
 *
 * 背景：import-vault-office.mjs 曾把 content 截到 50000（应为 500000），
 * 导致 1226 篇文档后半部分永久丢失。这些文档抽出的原子只覆盖前半部分。
 * 优先抽完整文档，截断文档等问题补齐后再抽（--include-truncated 可强制包含）。
 */
const SKIP_TRUNCATED = !args.includes("--include-truncated")'''
if old in src:
    src = src.replace(old, new)
    print("选项已加")

# SQL 里加条件
src = src.replace(
  '''    WHERE d.extract_score > 0 AND LENGTH(d.content) > 3000 AND d.extract_score >= ${MIN_SCORE}''',
  '''    WHERE d.extract_score > 0 AND LENGTH(d.content) > 3000 AND d.extract_score >= ${MIN_SCORE}
      ${SKIP_TRUNCATED ? "AND LENGTH(d.content) <> 50000" : ""}'''
)
open(p, "w", encoding="utf-8", newline="\n").write(src)
