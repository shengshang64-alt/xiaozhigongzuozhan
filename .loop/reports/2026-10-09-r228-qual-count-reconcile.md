# R228 优化迭代报告：资质数量口径统一（r2-r010 P0）

**日期**：2026-10-09  
**轮次**：228  
**选题**：`r2-r010-qual-count-reconcile`（P0，涉废标级）  
**零 AI 调用**：是

---

## 选题依据

账本 open backlog 中最高优先级的实质项（P0）：  
> 以台账三档（已过期/30天内/90天内，互斥）为唯一事实源，驾驶舱只引用不二次计算，两处数字差值=0；列表显示到期天数；自检三档之和==顶部预警 N 项。

R227 收口第2轮标书链路 9 项后进入 R228，按用户优先级（标书 > 方案 > PPT）选取 P0 资质台账实质修复项。

---

## 变更文件

| 文件 | 类型 | 说明 |
|------|------|------|
| `pocketbase/pb_hooks/qual_certs.pb.js` | 服务端 Hook | todayMs/toMs 由 UTC 零点改为本地零点 |
| `src/pages/QualCerts/qualsCore.test.ts` | 单元测试 | 新增 3 条不变量测试 |
| `src/pages/QualCerts/QualCertsPage.tsx` | UI | 预警区新增运行时自检徽章 |

---

## 技术细节

### 1. 服务端时区漂移修复

**根本原因**：`qual_certs.pb.js` summary 路由使用：
```js
var todayMs = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z").getTime()
var toMs = new Date(validTo + "T00:00:00Z").getTime()
```
两者均为 UTC 零点。而客户端 `qualsCore.ts` 的 `parseDay` 和 `useHome.ts` 的 todayMs 均使用本地零点：
```ts
const t = new Date(`s T00:00:00`).getTime()  // 本地零点（模板字面量）
new Date(new Date().toDateString()).getTime()   // 本地零点
```

在 UTC+8 时区，00:00-08:00 之间 UTC 日期 = 本地日期 - 1，导致今天到期的证书在服务端被分为 `critical`（days=1），客户端却分为 `expired`（days=0），两处分档标签不一致。

**修复**：
```js
// 改为与客户端一致的本地零点
var _nowD = new Date()
_nowD.setHours(0, 0, 0, 0)
var todayMs = _nowD.getTime()
// toMs 也去掉 Z 后缀（本地零点）
var toMs = new Date(validTo + "T00:00:00").getTime()
```

> **注**：本次修改 pb_hooks 计算逻辑（非 collection schema），账本已记录理由。

### 2. 不变量测试（qualsCore.test.ts +3）

```
describe("R228 不变量自检：三档之和 == alerts.length == qualRiskView.total")
  it("不变量 A：三档之和 == alerts.length（含全量与边界数据）")
    - 空列表
    - 全部 expired
    - 各档一个
    - 含 ok 和 unknown（不进 alerts）

  it("不变量 B：qualRiskView.total == expired + critical + warning（任意分档输入）")
    - 含 NaN 输入（num() 归 0 验证）

  it("不变量 A+B 联合：从同一行数据出发，驾驶舱 total 与台账 alerts.length 完全相等")
    - 验 r2-r010 核心验收条件：riskView.total == summary.alerts.length
```

### 3. 页面运行时自检（QualCertsPage.tsx）

在“到期预警（N 项）”文字旁加 ` 口径校验通过` 绿色徽章（IIFE 计算），tooltip 显示逐档明细。  
正常情况永不触发，但一旦将来修改 `summarizeQuals` 逻辑导致分档漂移，徽章变红并显示 ` 口径异常`，提前告警。

---

## 四门验证

| 门禁 | 结果 | 数据 |
|------|------|------|
| `npx tsc -b` | ✅ 0 错误 | — |
| `npx vitest run` | ✅ 全绿 | 1667 passed / 2 skipped（基线 1637 + 本轮新增 3 + ?? 测试文件纳入 27） |
| `npx eslint` (触及文件) | ✅ 0 error | — |
| `npx vite build` | ✅ 成功 | 3.07s |

---

## 账本回写

- `round`：227 → **228**
- `backlog[r2-r010-qual-count-reconcile].status`：open → **closed**
- `closed` 追加 R228 条目（见上）
- `lastRoundSummary` 已更新
