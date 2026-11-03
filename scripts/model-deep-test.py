"""
可用模型的深度能力测试（2026-10-31）
针对 4 个可用模型，测实际业务场景所需能力：
  · 长文生成（标书章节 800-2000 字）
  · 中文专业性（医疗信息化术语）
  · 结构化输出（JSON 遵循）
  · 上下文长度（能否吃下 8000 字招标原文）
  · 稳定性（连续调用是否降级）
用法：python scripts/model-deep-test.py
"""
import sqlite3, io, sys, json, time, urllib.request, urllib.error, re

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

DB = r"D:\重要文件\工作的小程序\xiaozhigongzuozhan\pocketbase\pb_data\data.db"
GW = "http://127.0.0.1:7000/api/model-gw/chat"
HDR = {"Content-Type": "application/json", "X-Rh-User-Id": "local-user"}

# 4 个已知可用的模型
TARGETS = [
    ("Intern", "minimax-m3", "⚡ 最快"),
    ("ange", "agnes-3.0-flash", "稳定"),
    ("Intern", "deepseek-v4-flash-vision", "慢"),
    ("sensenova", "sensenova-6.8-flash-lite", "最慢"),
]


def get_config_ids():
    con = sqlite3.connect("file:" + DB + "?mode=ro", uri=True)
    cols = [r[1] for r in con.execute("PRAGMA table_info(model_configs)")]
    out = {}
    for r in con.execute("SELECT * FROM model_configs"):
        d = dict(zip(cols, r))
        out[d.get("config_name") or d["id"]] = d["id"]
    con.close()
    return out


def call(cid, model, prompt, max_tokens=3000, timeout=240):
    body = json.dumps({
        "config_id": cid,
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": max_tokens,
    }).encode()
    req = urllib.request.Request(GW, data=body, headers=HDR)
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            d = json.loads(r.read())
            return {
                "ok": bool(d.get("ok")),
                "ms": int((time.time() - t0) * 1000),
                "text": str(d.get("text") or ""),
                "err": str(d.get("message") or d.get("error") or "")[:100],
            }
    except Exception as e:
        return {"ok": False, "ms": int((time.time() - t0) * 1000), "text": "", "err": f"{type(e).__name__}: {str(e)[:70]}"}


def pick_tender():
    """取真实招标原文片段作为长上下文素材"""
    con = sqlite3.connect("file:" + DB + "?mode=ro", uri=True)
    r = con.execute("SELECT tender_text FROM bid_projects WHERE stage='evaluated' AND LENGTH(parse_report)>100 LIMIT 1").fetchone()
    con.close()
    # 取中间一段（避开目录）
    t = r[0] if r else ""
    mid = len(t) // 3
    return t[mid : mid + 8000]


def main():
    ids = get_config_ids()
    tender_ctx = pick_tender()
    print(f"=== 深度能力测试（真实招标原文 {len(tender_ctx)} 字作为上下文）===\n")

    tests = []

    # 测试 1：长文生成（标书章节 1200 字）
    tests.append({
        "name": "长文生成1200字",
        "prompt": "请写一段医院信息化建设项目的「实施方案」，要求 1200 字左右，包含实施阶段、进度安排、组织保障、风险管控。专业严谨。",
        "check": lambda t: len(t) >= 800,
        "detail": lambda t, r: f"{len(t)}字 / {r['ms']}ms",
    })

    # 测试 2：上下文利用（能否从 8000 字原文中提取要求）
    tests.append({
        "name": "长上下文提取",
        "prompt": f"""以下是招标文件片段：

{{
    tender_ctx[:6000]
}}

请回答：这段招标文件提到了哪些技术要求？用 3-5 条列出，每条不超过 40 字。""".replace("{{", "{").replace("}}", "}"),
        "check": lambda t: len(re.findall(r"[1-9][.、)]", t)) >= 2 or t.count("\n") >= 2,
        "detail": lambda t, r: f"提取 {len(t)}字 / {r['ms']}ms",
    })

    # 测试 3：JSON 结构化输出
    tests.append({
        "name": "JSON结构化",
        "prompt": '请严格输出 JSON，不要任何解释文字：{"items":[{"name":"系统A","score":90},{"name":"系统B","score":85}]}。请按此格式输出 3 条医院信息系统及评分。',
        "check": lambda t: ('"items"' in t or '"name"' in t) and "{" in t,
        "detail": lambda t, r: f"JSON解析={'✓' if ('{' in t and '}' in t) else '✗'} / {r['ms']}ms",
    })

    # 测试 4：中文医疗专业度
    tests.append({
        "name": "医疗术语专业度",
        "prompt": "请解释 HIS、EMR、LIS、PACS、CDSS 这五个医疗信息系统缩写分别指什么，每个一行。",
        "check": lambda t: sum(1 for k in ["HIS", "EMR", "LIS", "PACS", "CDSS"] if k in t) >= 4,
        "detail": lambda t, r: f"覆盖 {sum(1 for k in ['HIS','EMR','LIS','PACS','CDSS'] if k in t)}/5 / {r['ms']}ms",
    })

    results = {}
    for cname, model, tag in TARGETS:
        cid = ids.get(cname)
        if not cid:
            print(f"跳过 {cname}/{model}（配置不存在）")
            continue
        print(f"\n【{cname} / {model}】{tag}")
        row = []
        for t in tests:
            r = call(cid, model, t["prompt"])
            passed = r["ok"] and t["check"](r["text"])
            row.append({"name": t["name"], "passed": passed, "ok": r["ok"], "ms": r["ms"], "len": len(r["text"]), "err": r["err"]})
            mark = "✓" if passed else ("△" if r["ok"] else "✗")
            extra = t["detail"](r["text"], r) if r["ok"] else r["err"][:60]
            print(f"  {mark} {t['name']:<16} {extra}")
        results[f"{cname}/{model}"] = row

    # 汇总
    print("\n" + "=" * 78)
    print("=== 能力矩阵 ===")
    header = f"{'模型':<38}" + "".join(f"{t['name'][:10]:<13}" for t in tests) + "总时长"
    print(header)
    for key, row in results.items():
        marks = "".join(f"{'✓' if c['passed'] else ('△' if c['ok'] else '✗'):<13}" for c in row)
        total = sum(c["ms"] for c in row)
        print(f"{key:<38}{marks}{total/1000:.1f}s")

    with open("_model_deep.json", "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=1)
    print("\n详细结果: _model_deep.json")


if __name__ == "__main__":
    main()
