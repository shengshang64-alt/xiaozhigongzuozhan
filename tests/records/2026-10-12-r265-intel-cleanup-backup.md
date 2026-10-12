# 自测记录 · R265 情报「清理不相关」数据安全

日期：2026-10-12　模块：情报中心 /IntelCenter　关联：P0 伞项 R-033 cleanup-irrelevant 数据安全

## 操作步骤
1. 情报中心列表顶部出「检测到 N 条不相关」横幅 / 或工具栏「清理不相关」→ 打开预览对话框。
2. 对话框展示命中数与样例，说明改为「确认后先导出本地 JSON 备份再删除」，按钮为「导出备份并清理」。
3. 点「导出备份并清理」：
   - 先 `POST /api/intel/cleanup-irrelevant {backup:true}` 取全量命中记录（不删除）；
   - 前端 `canProceedToDelete` 校验：备份成功且条数==预览命中数才继续；
   - `serializeCleanupBackup` → `triggerBlobDownload` 落 `情报清理备份-YYYYMMDD_HHMMSS.json`；
   - 再发 `{confirm:true}` 删除，toast「已导出 N 条本地备份，并清理 M 条」。

## 输入 / 预期 / 实际
- 备份接口失败或返回条数与命中数不一致 → 预期拒绝删除、提示「未删除任何条目」；实际：安全闸返回 proceed=false，confirmCleanup 提前 return，不发删除。✔（intelCleanupBackup.test.ts 三例覆盖：未取得备份/命中0/条数漂移）
- 备份 JSON 无损 → 预期 parse 回来逐字等于写入条目、count==条数、中文不被转义；实际通过。✔
- 文件名走本地日历（非 UTC）→ 预期 2026-01-02 03:04:05 本地得 `20260102_030405`；实际通过。✔
- 空集/非法入参 → 预期 count=0、items=[]；实际通过。✔

## 发现问题
- 原实现「清理不相关」为纯物理删除、不可恢复，违反 §7 与项目内回收站范式——本轮已闭合为「备份优先、安全闸守门」。

## 四门
tsc -b 0 / vitest 170 files 1920 passed+2 skipped(+1 文件/+9 用例) / eslint 触及文件净新增 0 error / vite build 成功。
pb_hook backup 分支本机无实数据端到端复核，待真实采集数据到位后补测（与历轮同口径）。
