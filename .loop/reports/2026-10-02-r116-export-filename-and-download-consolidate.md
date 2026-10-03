# R116 全站导出/下载文件名清洗单一来源 + aigc Blob 下载克隆收编（download/export 单一入口续作）

## 选题
承接 R105→R115「单一来源收敛」主线，巡检 download/export 家族的两处未收编重复实现，均
零提示词、零数据模型、零 pb_hooks：

- A. **文件名非法字符清洗** 3 份平行克隆：`intelExports.safeExportFileName`、
  `deckExports.safeFileName`、`quoteExports.safeFileName` 各抄一遍同一条规则
  （正则 `/[\\/:*?"<>|]/g`→下划线 + `slice(0,60)`），仅差「空名兜底串」与「是否拼扩展名」。
- B. **Blob 下载** R110 建了全站唯一 `src/lib/download.ts` `triggerBlobDownload`
  （挂 DOM→click→延时 3s revoke），但 `aigc.ts:downloadAigcResult` 仍是私有克隆，
  且用「立即 revoke」——正是 download.ts 头注点名的「慢内核/旧引擎点击后立即 revoke 会
  打断刚触发的下载」风险源。属 R109→R115 同类「落地不彻底续作」。

## 变更
- 新增唯一入口 `src/lib/fileName.ts`：
  - `sanitizeFileBase(name, emptyBase="")` → `(name || emptyBase).replace(UNSAFE,"_").slice(0,60)`
  - `buildSafeFileName(name, ext, emptyBase="")` → `${sanitizeFileBase(...)}.${ext}`
- 三处保留本地函数名薄委托，调用点零改动、输出逐字节等价：
  - `safeExportFileName(name)` → `sanitizeFileBase(name)`
  - `safeFileName(name, ext)`（deck）→ `buildSafeFileName(name, ext, "汇报PPT")`
  - `safeFileName(name, ext)`（quote）→ `buildSafeFileName(name, ext, "报价单")`
- `downloadAigcResult` 尾部 8 行内联 createObjectURL+`<a>`+click+removeChild+revoke
  → 单行 `triggerBlobDownload(blob, name)`；补 `import { triggerBlobDownload } from "./download"`。

## 行为变化点（如实记录）
- A：三处清洗逐字节等价（60 字符上限、空名兜底、扩展名拼接方式均保持）。唯一细微差异：
  原 `safeExportFileName` 对 `undefined` 会抛、新实现经 `(name || emptyBase)` 不抛（更严格，
  现有调用方始终传模板字符串，正常路径无差异）。
- B：内存释放由「点击后立即 revoke」统一改为「延时 3s revoke」（与全站其余下载入口一致），
  下载内容与文件名一概不变，仅规避慢引擎打断下载的风险；锚点清理由 `removeChild` 改为
  `a.remove()`（等价）。

## 有意不并入（记录）
- `competitorEvidence.sanitizeSystemSlug`：去非「字母数字中文」并截 16，用于证据 ID slug，
  与「下载文件名清洗」目的/字符集不同，不并入。
- `CompanyTemplateHint`/`useFormatTool` 下载文件名：来源已是合法文件名（服务端 file_name/
  已存在文件 name），浏览器 `download` 属性自身会做基础非法字符处理，且本轮不宜对其
  施加 60 字符截断（会截掉合法长名），故不改动、不做行为变更。

## 四道门禁（目标项目目录）
- `npx tsc -b` exit 0
- `npx vitest run` 718 passed / 2 skipped（基线 711 → +7，全在新增 `fileName.test.ts`：
  oracle 法把被删的 3 份原实现逐字复刻为 prevIntel/prevDeck/prevQuote，跨「全非法字符/
  截断/空兜底/扩展名拼接/中文/120 长串」样本电池断言与迁移后逐字节等价 + 4 例显式行为）
- `npx eslint` 触及 6 文件净新增 0：fileName.ts/.test.ts、intel/deck/quote 三导出 0 error；
  aigc.ts 报 2 项 no-useless-assignment（L381/L721）为 HEAD 基线既有，`git diff -U0` 证本轮
  hunk 仅 L2-3 import 与 L1129+ 下载块，不含该行、非在途新增
- `npx vite build` exit 0（2.93s，chunk-size 警告为既有良性提示）

## 运行时收口（浏览器实机）
Vite :8000 + PocketBase :7000 均在。首页作战驾驶舱真实数据完整渲染（截图
`.qoder/tmp/r116_app_load.png`），加载 5 个变更模块 + 动态 import 应用实际加载的
`/src/lib/fileName.ts`、`/src/lib/download.ts`、`/src/lib/aigc.ts` 同一模块实例，
console 0 error / 0 warn。实机调用锁行为：
- `sanitizeFileBase('a\\b/c:d*e?f"g<h>i|j')` → `a_b_c_d_e_f_g_h_i_j`（9 个非法字符全替换）
- `sanitizeFileBase('x'.repeat(120))` → 长度 60（截断上限生效）
- `sanitizeFileBase('', '报价单')` → `报价单`（空名兜底）
- `buildSafeFileName('报价/测试','xlsx','报价单')` → `报价_测试.xlsx`（清洗+拼扩展名）
- `typeof triggerBlobDownload === 'function'`、`aigc.downloadAigcResult` 正常导出
（下载/文件名路径逐字节等价由 fileName.test.ts oracle 回归 + 上述实机调用双重坐实；
纯函数安全分支无法用正常业务值自然触发，与 R106/R107/R111 同一诚实降级惯例。）

## 约束遵循
零 collection / 零 pb_hooks / 非提示词（PROMPT_VERSION 不变）；维持 R89 编造未清零导出
「只报不拦」、lint-debt-01 残余不重构；禁止 commit；在途文件按 git diff 锚点核对后绕开
（本轮触及的 intel/deck/quote 均为 R108/R110/R112 自建区域、aigc 为 HEAD 干净文件，无在途
新功能命中）。
