"""
产品映射 · 重复行清理（第二层：治本）

背景：
  check_products 里有 1128 行 in_company，其中 551 行是「同身份重复行」——
  历史两批导入叠加（2026-10-08 残缺行 + 2026-10-28 ONE-LINK 完整行）：
    10-08 行：只有 category / product_name / module_name（3 个非空字段）
    10-28 行：belong / category / product_name / module_category / standard_name
              / recommendation 齐全（7 个）
  身份口径（与 src/pages/ProductMapping/mappingCore.ts 的 sameIdentity 一致）：
    模块名 + 产品名 必须相同；产品类别一方为空则通配，双方都有值必须相同。

本脚本做三件事（顺序不可颠倒）：
  1) 体检：统计重复组 / 拟清理行；
  2) 重定向：把 check_mappings.product_id、checklists(JSON) 里指向「拟清理行」的引用
     改指到同身份的保留行 —— 不做这步直接删会制造悬空引用（实测有 17+1 处）；
  3) 清理：删除拟清理行。

安全设计：
  - 默认 --dry-run，只打印计划，不写库；
  - 写库前强制备份 data.db；
  - PocketBase 正在运行时拒绝写库（SQLite 单写者，避免损坏），需先停服；
  - 所有改动打印前后对照，可复核。

用法：
  python scripts/cleanup_product_duplicates.py                # 只体检
  python scripts/cleanup_product_duplicates.py --apply        # 备份 + 重定向 + 删除
"""
from __future__ import annotations

import argparse
import json
import shutil
import sqlite3
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "pocketbase" / "pb_data" / "data.db"

# 与 mappingCore.ts 的 COMPLETENESS_FIELDS 保持一致
FIELDS = [
    "product_belong", "category", "product_line", "product_name", "module_name",
    "module_func", "standard_name", "module_category", "module_attr",
    "recommendation", "charge_mode", "unit_price", "description",
]


def norm(v) -> str:
    return "".join(str(v or "").split()).lower()


def completeness(row: dict) -> int:
    n = 0
    for k in FIELDS:
        v = row.get(k)
        if v is None:
            continue
        if isinstance(v, str) and not v.strip():
            continue
        if isinstance(v, (int, float)) and not v:
            continue
        n += 1
    return n


def same_identity(a: dict, b: dict) -> bool:
    if norm(a.get("module_name")) != norm(b.get("module_name")):
        return False
    if norm(a.get("product_name")) != norm(b.get("product_name")):
        return False
    ca, cb = norm(a.get("module_category")), norm(b.get("module_category"))
    if not ca or not cb:
        return True
    return ca == cb


def coarse_key(row: dict) -> str:
    return f"{norm(row.get('module_name'))}§{norm(row.get('product_name'))}"


def pick_better(cur: dict, cand: dict) -> dict:
    if completeness(cand) != completeness(cur):
        return cand if completeness(cand) > completeness(cur) else cur
    cc, uc = str(cand.get("module_category") or "").strip(), str(cur.get("module_category") or "").strip()
    if cc and not uc:
        return cand
    if uc and not cc:
        return cur
    tc = str(cand.get("updated") or cand.get("created") or "")
    tu = str(cur.get("updated") or cur.get("created") or "")
    return cand if tc > tu else cur


def plan(rows: list[dict]) -> tuple[list[dict], list[dict]]:
    """返回 (保留行, 拟清理行)"""
    groups: dict[str, list[dict]] = {}
    order: list[str] = []
    for r in rows:
        k = coarse_key(r)
        if k not in groups:
            groups[k] = []
            order.append(k)
        groups[k].append(r)

    kept: list[dict] = []
    dropped: list[dict] = []
    for k in order:
        reps: list[dict] = []
        for r in groups[k]:
            idx = next((i for i, rep in enumerate(reps) if same_identity(rep, r)), -1)
            if idx < 0:
                reps.append(r)
            else:
                winner = pick_better(reps[idx], r)
                loser = r if winner is reps[idx] else reps[idx]
                reps[idx] = winner
                dropped.append(loser)
        kept.extend(reps)
    return kept, dropped


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="实际写库（默认只体检）")
    ap.add_argument("--db", default=str(DB))
    args = ap.parse_args()

    db = Path(args.db)
    if not db.exists():
        print(f"数据库不存在: {db}")
        return 1

    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    cur = con.cursor()
    cur.execute("SELECT * FROM check_products WHERE in_company = 1")
    rows = [dict(r) for r in cur.fetchall()]
    cur.execute("SELECT * FROM check_mappings")
    maps = [dict(r) for r in cur.fetchall()]
    cur.execute("SELECT * FROM checklists")
    checklists = [dict(r) for r in cur.fetchall()]
    con.close()

    kept, dropped = plan(rows)
    dropped_ids = {d["id"] for d in dropped}
    kept_by_key: dict[str, dict] = {}
    for k in kept:
        kept_by_key.setdefault(coarse_key(k), k)
    id_to_row = {r["id"]: r for r in rows}

    print("=" * 66)
    print("产品映射重复行清理 · 体检报告")
    print("=" * 66)
    print(f"in_company 行数 : {len(rows)}")
    print(f"去重后保留      : {len(kept)}")
    print(f"拟清理（重复）  : {len(dropped)}")
    print()

    # 引用体检
    def remap_target(pid: str) -> str | None:
        src = id_to_row.get(pid)
        if not src:
            return None
        tgt = kept_by_key.get(coarse_key(src))
        if tgt and same_identity(tgt, src):
            return tgt["id"]
        # 粗分组未命中时精确扫一遍
        for k in kept:
            if same_identity(k, src):
                return k["id"]
        return None

    map_fix = []
    for m in maps:
        pid = m.get("product_id") or ""
        if pid in dropped_ids:
            tgt = remap_target(pid)
            if tgt:
                map_fix.append((m["id"], m.get("customer_norm"), pid, tgt))
            else:
                print(f"  !! 映射 {m.get('customer_norm')!r} 的 product_id={pid} 找不到同身份保留行，跳过")

    cl_fix = []
    for c in checklists:
        blob = json.dumps(c, ensure_ascii=False, default=str)
        hit = [pid for pid in dropped_ids if pid in blob]
        if hit:
            cl_fix.append((c.get("id"), hit))

    print(f"check_mappings 引用拟清理行: {len(map_fix)} 条 → 需重定向")
    for mid, cnorm, old, new in map_fix[:20]:
        print(f"    {cnorm!r}: {old} → {new}")
    print(f"checklists 引用拟清理行     : {len(cl_fix)} 行 → 需重定向")

    if not args.apply:
        print()
        print("（未加 --apply，仅体检，未写库）")
        return 0

    # ---- 写库前：拒绝在 PB 运行时写 ----
    import socket
    with socket.socket() as s:
        busy = s.connect_ex(("127.0.0.1", 7000)) == 0
    if busy:
        print()
        print("PocketBase 正在 7000 端口运行，拒绝直接写库（SQLite 单写者）。")
        print("请先停服（stop-local.cmd 或结束 pocketbase.exe），再重跑 --apply。")
        return 2

    backup = db.with_name(f"data.db.bak-{time.strftime('%Y%m%d-%H%M%S')}")
    shutil.copy2(db, backup)
    print()
    print(f"已备份: {backup}")

    wcon = sqlite3.connect(db)
    wcur = wcon.cursor()
    try:
        wcur.execute("BEGIN")
        for mid, _cnorm, _old, new in map_fix:
            wcur.execute("UPDATE check_mappings SET product_id = ? WHERE id = ?", (new, mid))
        # checklists：仅替换 JSON 里的 id 字符串
        for cid, hits in cl_fix:
            wcur.execute("SELECT * FROM checklists WHERE id = ?", (cid,))
            row = wcur.fetchone()
            if not row:
                continue
            cols = [d[0] for d in wcur.description]
            rec = dict(zip(cols, row))
            changed = False
            newrec = {}
            for k, v in rec.items():
                if isinstance(v, str):
                    nv = v
                    for old_id in hits:
                        tgt = remap_target(old_id)
                        if tgt and old_id in nv:
                            nv = nv.replace(old_id, tgt)
                            changed = True
                    newrec[k] = nv
                else:
                    newrec[k] = v
            if changed:
                sets = ", ".join(f"{k} = ?" for k in newrec if k != "id")
                wcur.execute(f"UPDATE checklists SET {sets} WHERE id = ?", [v for k, v in newrec.items() if k != "id"] + [cid])
        # 删除重复行
        wcur.executemany("DELETE FROM check_products WHERE id = ?", [(i,) for i in dropped_ids])
        wcon.commit()
        print(f"已重定向 {len(map_fix)} 条映射、{len(cl_fix)} 行清单；已删除 {len(dropped_ids)} 行重复产品")
        print("完成。请重启 PocketBase。")
    except Exception as e:
        wcon.rollback()
        print(f"写库失败已回滚: {e}")
        return 3
    finally:
        wcon.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
