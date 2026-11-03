import sqlite3, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
con = sqlite3.connect("file:D:\\重要文件\\工作的小程序\\xiaozhigongzuozhan\\pocketbase\\pb_data\\data.db?mode=ro", uri=True)
con.row_factory = sqlite3.Row
for r in con.execute("SELECT content_status, COUNT(*) n FROM kb_atoms GROUP BY content_status ORDER BY n DESC"):
    print(f"  {r['content_status']:<12} {r['n']}")
print(f"  {'总计':<12} {con.execute('SELECT COUNT(*) FROM kb_atoms').fetchone()[0]}")
n = con.execute("SELECT COUNT(DISTINCT source_doc_id) FROM kb_atoms").fetchone()[0]
print(f"\n已抽文档: {n} 篇 / 7005 ({n/7005*100:.1f}%)")
print("\n类型分布(approved):")
for r in con.execute("SELECT atom_type, COUNT(*) n FROM kb_atoms WHERE content_status='approved' GROUP BY atom_type ORDER BY n DESC"):
    print(f"  {r['atom_type']:<22} {r['n']}")
q = "SELECT COUNT(*) FROM kb_atoms WHERE content_status='approved' AND (subject_key IS NULL OR subject_key='' OR source_anchor IS NULL OR source_anchor='' OR usable_for IS NULL OR usable_for='' OR usable_for='[]')"
print(f"\n质量: 缺 key/anchor/用途 = {con.execute(q).fetchone()[0]}")
con.close()
