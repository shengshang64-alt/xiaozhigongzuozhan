"""
模型性能全面测试（2026-10-31）
测三件事：
  1. 可用性 —— 能否真正出内容
  2. 延迟 —— 首字/整体响应时间
  3. 能力 —— 中文质量、指令遵循、长文生成

用法：python scripts/model-bench.py
"""
import sqlite3, io, sys, json, time, urllib.request, urllib.error

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

DB = r"D:\重要文件\工作的小程序\xiaozhigongzuozhan\pocketbase\pb_data\data.db"
GW = "http://127.0.0.1:7000/api/model-gw/chat"
HDR = {"Content-Type": "application/json", "X-Rh-User-Id": "local-user"}


def load_models():
    con = sqlite3.connect("file:" + DB + "?mode=ro", uri=True)
    cols = [r[1] for r in con.execute("PRAGMA table_info(model_configs)")]
    out = []
    for r in con.execute("SELECT * FROM model_configs"):
        d = dict(zip(cols, r))
        if d.get("is_platform"):
            continue
        try:
            models = json.loads(d.get("models") or "[]")
        except Exception:
            models = []
        for m in models:
            if m.get("enabled"):
                out.append({"config_id": d["id"], "config_name": d.get("config_name") or d["id"], "model": m["id"]})
    con.close()
    return out


def call(config_id, model, prompt, max_tokens=600, timeout=120):
    body = json.dumps({
        "config_id": config_id,
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
                "error": str(d.get("message") or d.get("error") or d.get("code") or ""),
            }
    except Exception as e:
        return {"ok": False, "ms": int((time.time() - t0) * 1000), "text": "", "error": f"{type(e).__name__}: {str(e)[:80]}"}


# ---- 三个测试用例 ----
CASES = [
    {
        "name": "中文理解",
        "prompt": "用一句话解释什么是「电子病历应用水平分级评价」，不超过60字。",
        "check": lambda t: 30 <= len(t) <= 200 and ("电子病历" in t or "分级" in t),
    },
    {
        "name": "指令遵循",
        "prompt": "严格按此格式输出，不要任何解释：\nA=1\nB=2\nC=3",
        "check": lambda t: t.count("=") >= 3,
    },
    {
        "name": "长文生成",
        "prompt": "写一段 300 字左右的医院信息化建设方案开头，要求正式、专业。",
        "check": lambda t: len(t) >= 200,
    },
]


def main():
    models = load_models()
    print(f"=== 模型性能测试：{len(models)} 个模型 × {len(CASES)} 个用例 ===\n")

    results = []
    for m in models:
        row = {"name": m["config_name"], "model": m["model"], "cases": [], "total_ms": 0, "okCount": 0}
        for c in CASES:
            r = call(m["config_id"], m["model"], c["prompt"])
            passed = r["ok"] and c["check"](r["text"])
            row["cases"].append({
                "name": c["name"],
                "ok": r["ok"],
                "passed": passed,
                "ms": r["ms"],
                "len": len(r["text"]),
                "error": r["error"][:60] if not r["ok"] else "",
            })
            row["total_ms"] += r["ms"]
            if passed:
                row["okCount"] += 1
        results.append(row)
        status = "✓" if row["okCount"] == len(CASES) else ("△" if row["okCount"] else "✗")
        print(f"{status} {row['name']:<11} {row['model']:<32} 通过 {row['okCount']}/{len(CASES)}  {row['total_ms']:>6}ms")

    print("\n" + "=" * 80)
    print("=== 可用模型排名（按通过用例数 → 总延迟）===")
    good = [r for r in results if r["okCount"] > 0]
    good.sort(key=lambda r: (-r["okCount"], r["total_ms"]))
    for i, r in enumerate(good, 1):
        print(f"{i}. {r['name']} / {r['model']}  通过 {r['okCount']}/{len(CASES)}  延迟 {r['total_ms']}ms")

    print(f"\n=== 不可用模型：{len(results) - len(good)} 个 ===")
    for r in results:
        if r["okCount"] == 0:
            err = r["cases"][0]["error"] or "未知"
            print(f"  ✗ {r['name']:<11} {r['model']:<32} {err}")

    with open("_model_bench.json", "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=1)
    print("\n详细结果已存 _model_bench.json")


if __name__ == "__main__":
    main()
