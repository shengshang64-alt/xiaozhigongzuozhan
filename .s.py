import sqlite3, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
con = sqlite3.connect("file:D:\\重要文件\\工作的小程序\\xiaozhigongzuozhan\\pocketbase\\pb_data\\data.db?mode=ro", uri=True)
for r in con.execute("SELECT content_status, COUNT(*) FROM kb_atoms GROUP BY content_status ORDER BY 2 DESC"):
    print(f"  {r[0]:<12} {r[1]}")
print(f"  已抽文档: {con.execute('SELECT COUNT(DISTINCT source_doc_id) FROM kb_atoms').fetchone()[0]} 篇")
con.close()
