# 静态原型制屏手册（给协作者 / 唯一口径）

> 目录：`docs/ux-v2-2026-11/prototype/`
> 任何新增屏必须严格按本手册，**不允许自创 class、不允许写行内色值、不允许改 design.css**

---

## 1. 文件骨架（逐字照抄，只改 4 处）

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>屏名 · 小智工作站</title>
<link rel="stylesheet" href="../assets/design.css">
</head>
<body data-mod="customer" data-screen="customer-list" data-base="../">
<div class="app">
  <div id="shell-side"></div>
  <div class="main">
    <div id="shell-top"></div>
    <div id="shell-tabs"></div>
    <main class="content">
      <div data-subtabs></div>
      <!-- ↓↓↓ 屏内容写这里 ↓↓↓ -->

      <!-- ↑↑↑ 屏内容写这里 ↑↑↑ -->
      <div data-pager></div>
    </main>
  </div>
</div>
<script src="../assets/manifest.js"></script>
<script src="../assets/shell.js"></script>
</body>
</html>
```

必改 4 处：
1. `<title>` — 与本屏 `tab` 名一致
2. `data-mod` — manifest 里的模块 key（如 `customer`）
3. `data-screen` — manifest 里的屏 id（如 `customer-list`）
4. 文件放在 `prototype/<模块key>/<文件名>.html`，文件名必须与 manifest 的 `file` 字段一致（去掉 `<模块key>/` 前缀）

外壳（侧栏 / 顶栏 / 多标签 / 屏内 Tab / 翻屏条 / ⌘K）**全部由 shell.js 自动渲染**，页面里不要手写导航。

---

## 2. 每屏必须有：页头（.ph）

```html
<div class="ph">
  <div class="ph-main">
    <h1>页面主标题<span class="badge badge--blue">状态徽标</span></h1>
    <div class="desc">一句话说清这屏<b>解决什么问题</b>。第二句说清与其他屏的分工。</div>
    <div class="meta">
      <span class="kv">共 <b>34</b> 条</span>
      <span class="kv">最近更新 <b>2026-11-08 09:14</b></span>
    </div>
  </div>
  <div class="ph-actions">
    <button class="btn">次级动作</button>
    <button class="btn btn--primary">＋ 主行动</button>   <!-- 一屏只能有 1 个 btn--primary -->
  </div>
</div>
```

## 3. 每屏建议有：设计说明条（.note）

放在页头下方，第一行写"拆前是什么样 → 拆后是什么样"，让评审人一眼看到改动理由。

```html
<div class="note">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
  <div><b>拆前</b>：……（引用实测数据：DOM 节点数 / 滚动高度 / 按钮数 / 页内标题数）。<b>拆后</b>：……</div>
</div>
```

实测基线（可直接引用）：
- 客户管理 9,688 节点 / 12,513px / 857 按钮 / 17 标题
- 方案工作室 9,862 节点 / 918 按钮 / 25 标题
- 情报中心 9,505 节点 / 1,136px / 843 按钮 / 22 标题
- 模型配置 7,013 节点 / 2,791px / 832 按钮
- 团队管理 6,710 节点 / 902px / 838 按钮
- 小智助手 6,368 节点 / 714 按钮
- 资质台账 6,105 节点 / 1,898px / 682 按钮
- 竞品分析 6,103 节点 / 1,641px
- 知识库 5,660 节点 / 2,052px
- 标书工作台 232k 字符单页 / 7 步内联
- 标书检查 61 按钮 / 健康但头重脚轻
- 格式刷新 143 按钮 / 1,491px

---

## 4. 组件速查（class 名严格照抄）

### 4.1 按钮
| 用途 | 写法 |
|---|---|
| 主 CTA（每屏 1 个） | `class="btn btn--primary"` |
| 次级 | `class="btn"` |
| 文字按钮 | `class="btn btn--ghost"` 或 `class="btn btn--link"` |
| 行内链接按钮 | `class="btn btn--link"` |
| 危险 | `class="btn btn--danger"`（描边红）/ `btn--danger-solid`（实心红，仅确认弹窗）|
| 小号 | `btn btn--sm` / `btn btn--sm btn--primary` |
| 大号 | `btn btn--lg` |
| 仅图标 | `btn btn--icon` 或 `icon-btn` |
| 禁用 | 加 `is-disabled`，**旁边必须有原因文案** |

按钮内图标：`<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7"><path d="..."/></svg>`（.btn 内会自动设尺寸，但显式写更稳）

### 4.2 表单
```html
<div class="field"><label class="label req">项目名称</label>
  <input class="input" value="……">
  <span class="help">辅助说明</span></div>

<div class="field"><label class="label">状态</label>
  <select class="select"><option>全部</option></select></div>

<label class="check"><input type="checkbox" checked> 选项文本</label>
<button class="switch on" data-toggle></button>
```

### 4.3 下拉（自绘，**禁止用原生 select 做主要筛选**）
```html
<div class="dd">
  <button class="btn" data-dd><span data-dd-label>全部状态</span>
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M6 9l6 6 6-6"/></svg></button>
  <div class="dd-menu">
    <div class="dd-label">按状态</div>
    <div class="dd-item on" data-label="全部状态">全部状态<span class="tick">✓</span></div>
    <div class="dd-item" data-label="进行中">进行中</div>
  </div>
</div>
```
（shell.js 已接管点击：打开、选中、回填 label）

### 4.4 筛选条
```html
<div class="filterbar">
  <div class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
    <input class="input" placeholder="搜索名称/编号"></div>
  <div class="row" data-chips>
    <span class="chip on">全部 <span class="n">34</span></span>
    <span class="chip">临期 <span class="n">3</span></span>
  </div>
  <div class="grow"></div>
  <button class="btn btn--sm">筛选 <span class="badge badge--primary">2</span></button>
</div>
```

### 4.5 指标卡 / 数据条
```html
<div class="stat-row">            <!-- 4 列；.c3 .c5 .c6 可选 -->
  <div class="stat is-red">        <!-- is-red/orange/amber/green/blue/primary -->
    <div class="lab">图标 标签</div>
    <div class="val">4<small>项</small></div>
    <div class="foot">副文案</div>
  </div>
</div>

<!-- 数据量少时优先用数据条（省 200px 高度） -->
<div class="databar">
  <div class="item">全部方案 <b>1</b></div>
  <div class="item green">已完成 <b>0</b></div>
</div>
```

### 4.6 表格（首选，密集合规）
```html
<div class="tbl-wrap">
  <div class="tbl-scroll">
  <table class="tbl">
    <thead><tr><th class="w-ck"><input type="checkbox"></th><th>名称</th><th>状态</th><th class="num">金额</th><th class="w-ops">操作</th></tr></thead>
    <tbody>
      <tr><td><input type="checkbox"></td>
        <td class="name">名称<div class="sub">编号 · 附加信息</div></td>
        <td><span class="badge badge--blue">编制中</span></td>
        <td class="num">286.0 万</td>
        <td class="w-ops"><span class="row-ops">
          <button class="icon-btn" title="编辑">…</button>
          <button class="icon-btn danger" title="删除">…</button></span></td></tr>
    </tbody>
  </table>
  </div>
  <div class="tbl-foot"><span>已选 0 / 共 3 条</span><span class="grow"></span>
    <div class="pager"><button disabled>‹</button><button class="on">1</button><button>2</button><button>›</button></div></div>
</div>
```

### 4.7 卡片 / 面板
```html
<div class="card">
  <div class="card-h"><h3>图标 标题</h3><span class="sub">副说明</span><div class="grow"></div><button class="btn btn--sm">动作</button></div>
  <div class="card-b">内容</div>
  <div class="card-f">底部条</div>
</div>
```

### 4.8 列表行（主从 / 待办）
```html
<div class="list">
  <div class="list-row">            <!-- 有 .on 表示选中 -->
    <span class="badge badge--red">阻断</span>
    <div class="grow"><div class="t">主标题</div><div class="s">副说明</div></div>
    <div class="r mono small">今天 18:00</div>
    <button class="btn btn--sm btn--primary">去处理</button>
  </div>
</div>
```

### 4.9 别怕用左右分栏（主从型页面的骨架）
```html
<div class="split split--l">     <!-- 300px + 自适应 -->
  <div class="col col--gap-16">左栏</div>
  <div class="col col--gap-16">右栏</div>
</div>
```
可选：`split--l`(300/1fr) `split--l-wide`(380/1fr) `split--r`(1fr/320) `split--r-wide`(1fr/400) `split--main`(1fr/280) `split--2` `split--3`

### 4.10 步骤条（流程屏必备）
```html
<div class="steps">
  <div class="step done"><div class="n">1</div><div class="tx"><b>导入招标文件</b><span>已完成</span></div></div>
  <div class="step on"><div class="n">2</div><div class="tx"><b>解析确认</b><span>进行中</span></div></div>
  <div class="step"><div class="n">3</div><div class="tx"><b>大纲编制</b><span>待开始</span></div></div>
</div>
```
状态：`.done` `.on` `.warn`（不写=未开始）

### 4.11 徽标语义（只能用这 8 个）
`badge--red` 阻断/失败/废标 · `badge--orange` 临期/待处理 · `badge--amber` 提示/评审中 ·
`badge--green` 完成/正常 · `badge--blue` 进行中 · `badge--purple` 特殊阶段 ·
`badge--gray` 归档/未开始 · `badge--primary` 品牌 · 加 `badge--dot` 出圆点

### 4.12 空态（四要素，禁止死白）
```html
<div class="empty">
  <div class="ico">图标</div>
  <h4>还没有投标项目</h4>
  <p>导入一份招标文件，系统会自动解析评分办法与废标条款</p>
  <div class="acts"><button class="btn btn--primary btn--sm">＋ 导入招标文件</button><button class="btn btn--sm">看演示</button></div>
</div>
```

### 4.13 骨架屏 / 进度 / 长任务
```html
<div class="sk sk-line" style="width:120px"></div>          <!-- 骨架 -->
<span class="spin"></span>                                   <!-- 转圈 -->
<div class="bar"><i style="width:62%"></i></div>             <!-- 进度条 -->
<div class="bar green"><i style="width:100%"></i></div>
```

### 4.14 提示条
```html
<div class="alert alert--red"><svg …/>  <div class="grow">…</div><div class="acts"><button class="btn btn--sm">定位</button></div></div>
```
颜色：`--red --orange --amber --blue --green --primary`

### 4.15 弹窗 / 抽屉（静态展示：用 mask 直接display:grid）
```html
<!-- 触发器 -->
<button class="btn" onclick="Proto.open('demo-modal')">打开</button>

<!-- 弹窗本体（放在 body 最后、</script> 前；默认 display:none 由 Proto.open 打开） -->
<div class="mask" data-modal="demo-modal" style="display:none">
  <div class="modal" style="--mw:560px">
    <div class="modal-h"><h3>标题<div class="sub">副说明</div></h3><button class="icon-btn" onclick="Proto.close('demo-modal')">✕</button></div>
    <div class="modal-b">内容</div>
    <div class="modal-f"><span class="tip">影响范围说明</span><div class="grow"></div>
      <button class="btn btn--sm" onclick="Proto.close('demo-modal')">取消</button>
      <button class="btn btn--sm btn--primary">确认</button></div>
  </div>
</div>
```
抽屉：`<div class="drawer-mask" data-modal="x" style="display:none"></div><div class="drawer" data-modal="x" style="display:none;--dw:560px">…</div>`

**静态原型允许"常驻展示"**：如果这一屏的重点就是弹窗/抽屉，就把它画成常驻的（不加 mask），旁边放上下文页面做底衬。但每屏最多 1 个常驻浮层。

### 4.16 图表（纯 CSS，禁止引入 JS 图表库）
```html
<!-- 横向条形（注意：fill 必须是 div；用 i 也可以，但 CSS 已设 display:block -->
<div class="chart-bars">
  <div class="cbar"><span class="k">卫宁健康</span><span class="track"><div class="fill" style="width:88%"></div></span><span class="v">58.8 亿</span></div>
</div>
<!-- 纵向柱（.b 必须写内联 height:%；CSS 已设 flex:0 0 auto 防被内容撑开） -->
<div class="vbars">
  <div class="col"><span class="n">12</span><span class="b" style="height:64%"></span><span class="l">10月</span></div>
</div>
<!-- 环形 -->
<div class="row"><div class="donut" style="background:conic-gradient(var(--primary) 0 62%,var(--line-2) 62% 100%)"><div class="ctr"><b>62%</b><span>覆盖率</span></div></div>
  <div class="legend"><div class="li"><span class="dot green"></span>已覆盖<span class="v">62%</span></div></div></div>
<!-- 热力 -->
<div class="heat"><i></i><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i></div>
```

**图表示例的三个已知坑（已修 CSS，写的时候仍要注意）**：
1. `.cbar .fill` 必须是块级（用 `<div>`；用 `<i>` 也行，CSS 已补 `display:block`）
2. `.vbars .col .b` 必须写内联 `height:60%`，否则高度为 0
3. `.donut` 必须用行内 `conic-gradient`——这是**允许的行内样式白名单**（图表比例类），不算"行内色值"违规

### 4.17 时间线
```html
<div class="timeline">
  <div class="tl-item done"><div class="when">11-02 · 已完成</div><div class="what"><b>导入招标文件</b><br>解析出 12 条废标项</div></div>
  <div class="tl-item on">…</div>
</div>
```

### 4.18 看板
```html
<div class="kanban">
  <div class="kan-col"><div class="kan-col-h">线索 <span class="cnt">3</span></div>
    <div class="kan-card"><b>厦门市中医院</b><div class="m"><span class="kan-money">286 万</span> · 46 天未跟进</div></div>
  </div>
</div>
```

### 4.19 目录树
```html
<div class="tree">
  <div class="tree-grp">团队知识库 · 2,175 篇</div>
  <div class="tree-item on">全部文档 <span class="n">2175</span></div>
  <div class="tree-item indent">标书范本 <span class="n">142</span></div>
</div>
```

### 4.21 缩略占位 / 参数卡 / 上传行 / 置信度条（v2.1 补充）
```html
<!-- 缩略占位块（素材、文件、PPT 封面） -->
<div class="thumb">图标</div>            <!-- 48×48 -->
<div class="thumb thumb--sm">图标</div>  <!-- 34×34 -->
<div class="thumb thumb--lg">…</div>     <!-- 100% × 112px，卡片封面用 -->
<div class="thumb thumb--gray">…</div>   <!-- 中性底 -->

<!-- 参数说明卡（税率/折扣底线/审批门槛这类键值小卡） -->
<div class="spec-card">
  <div class="sc-h">图标 价税与规则</div>
  <div class="kv-row"><span class="k">税率</span><span class="v">13%</span></div>
  <div class="kv-row"><span class="k">最低折扣</span><span class="v">85%</span></div>
</div>

<!-- 已上传文件行（替代行内 dashed 边框） -->
<div class="upload-row">图标 <div class="grow"><b>招标文件.docx</b><div class="small muted-2">4.2MB</div></div> <button class="btn btn--sm">删除</button></div>

<!-- 置信度条（对照页左列行首） -->
<div class="conf-bar"><i style="width:94%"></i></div>     <!-- 高：绿 -->
<div class="conf-bar mid"><i style="width:62%"></i></div> <!-- 中：amber -->
<div class="conf-bar low"><i style="width:28%"></i></div> <!-- 低：red -->

<!-- 关键字高亮 -->
<span class="hl">互联互通四甲</span>          <!-- amber 底 -->
<span class="hl hl--primary">互联互通四甲</span> <!-- primary 底 -->

<!-- 全宽勾选行（清单式选择） -->
<label class="check check--row"><input type="checkbox"> 系统名称 · 建议金额 126 万</label>
```

### 4.22 工具类
`row`(横排) `col`(竖排) `row wrap` `grow` `grid g2/g3/g4/g5` `mt8/12/16/24` `mb8/12/16` `muted` `muted-2` `small` `tiny` `mono` `b` `bb` `red/orange/amber/green/blue/primary` `trunc` `clamp2/clamp3` `divider` `p12/p16` `hairline` `kv-row` `fold` `bg-w`

**三栏工作区**：`.split--3col`（300 / 1fr / 340）、`.split--3col-wide`（340 / 1fr / 380）、`.split--r-tight`（1fr / 300）。

---

## 5. 业务数据口径（真实、可复现，禁止编造数字）

用下面这套数据，跨屏保持一致（评审会横向比对）：

**客户 / 商机**
- 客户总数 160；其中 32 家超 90 天未跟进；缺 3 项以上档案 41 家
- 厦门市中医院 / 信息化整体提升（含电子病历评级）/ 需求确认 / 286.0 万 / 46 天未跟进
- 安徽中医药大学第一附属医院 / 一体化核心业务系统扩容 / 方案交流 / 412.0 万 / 38 天未跟进
- 蚌埠医科大学第一附属医院 / 智慧医疗核心系统 / 初步接洽 / 预算未公开 / 92 天未跟进
- 宣城市人民医院 / 数据中台与互联互通四甲 / 需求确认 / 168.0 万 / 31 天未跟进
- 顾县人民医院 / HIS 升级改造 / 已投标 / 决定待定

**标书项目（3 个进行中 + 12 已归档）**
- 蚌埠医科大学第一附属医院智慧医疗核心 / BB2026SQCGZ052 / 编制中 / 11/11 章成稿 / 已开标
- 【UI测试】中医院信息化建设项目 / ZB-TEST-2026 / 厦门市中医院 / 距开标 25 天 / 0/0 章（卡在大纲）
- 安徽中医药大学第一附属医院一体化核心 / 2026BFAFZ50845 / 已评标 / 9/9 章成稿
- 七步：①导入招标 ②解析确认 ③大纲编制 ④正文编写 ⑤偏离表 ⑥交卷自查 ⑦组卷导出

**情报中心**
- 待确认 29 / 已确认 980 / 本周新增 40 / 可转商机 6
- 来源：中国政府采购网 / HIT专家网 / 新华网健康频道 / 健康界 / 医院官网
- 今日要闻示例：吉安市公立中医医院信息化建设项目变更澄清公告

**资质台账**
- 总数 34 / 已过期 1 / 30 天内到期 3 / 90 天内到期 0 / 未登记有效期 25
- 「信息系统安全等级保护三级」30 天内到期，被 2 个在投标项目引用

**知识库**
- 团队知识库 2,175 篇 / 我的笔记 4,825 条 / 知识原子 312 条待审核
- 分类：标书范本 142 / 方案素材 318 / 政策法规 76 / 产品资料 264 / 案例复盘 93

**竞品**
- 卫宁健康 58.8 亿 / 东软集团 42.2 亿 / 创业慧康 31.4 亿 / 万达信息 23.7 亿 / 深信服 18.9 亿（五年中标金额）
- 市场规模：医疗信息化 181.9 亿 / 电子病历 42.2 亿 / 数据中台 53.7 亿 / 互联互通 23.7 亿

**模型**
- 默认：deepseek-v4.1-flash；备选：glm-5.3-flash、qwen3-max、kimi-k2
- 今日调用：deepseek 62 次 98.4% / glm 21 次 100%；估算费用 ¥18.4

**团队**
- 7 名成员（含 2 个 QA 测试账号）；角色：管理员 / 编辑 / 只读

---

## 6. 硬性约束（评审会逐条查）

1. **一屏只服务一件事**。如果发现自己在一屏里写第二个"主行动"或第二套统计卡，说明该拆。
2. **每屏高度目标 ≤ 1,600px**（1600 宽视口下）。密集表格类可到 2,000px，但不能出现"滚 5 屏"。
3. **禁止行内色值**：不能出现 `style="color:#123456"`、`background:#fff` 之类；只能用 `style="width:62%"` / `style="height:64%"` 这类尺寸与图表比例。
4. **禁止 `<script>` 写业务逻辑**（shell.js 已提供交互）。页面末尾只允许引 2 个 js。
5. **禁止 emoji 当图标**。图标一律内联 SVG（stroke-width 1.7，24 viewBox），从下面这套里取。
6. **文案必须是售前的话**，不要写"该功能用于…"。写"距开标 25 天""3 处未逐条应答，未修复将判废标"。
7. **危险操作必须**：红描边按钮 + 二次确认弹窗 + 后果一句话。
8. **空态禁止死路**：必须有主行动按钮。
9. **表格超过 12 行要给分页**（`.tbl-foot` + `.pager`）。
10. 屏内 Tab 顺序与 manifest 一致，不要自己加屏。

---

## 7. 常用图标 path（直接复制，勿自造）

```html
<!-- 搜索 --><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
<!-- 加号 --><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 5v14M5 12h14"/></svg>
<!-- 下载 --><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/></svg>
<!-- 上传 --><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 8 5-5 5 5M12 3v12"/></svg>
<!-- 更多 --><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>
<!-- 编辑 --><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>
<!-- 删除 --><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
<!-- 警示 --><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>
<!-- 信息 --><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
<!-- 时钟 --><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
<!-- 日历 --><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
<!-- 对勾 --><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M20 6 9 17l-5-5"/></svg>
<!-- 关闭 --><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M18 6 6 18M6 6l12 12"/></svg>
<!-- 左箭头 --><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m15 18-6-6 6-6"/></svg>
<!-- 右箭头 --><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m9 18 6-6-6-6"/></svg>
<!-- 文档 --><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
<!-- 文件夹 --><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9L9.6 3.9A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z"/></svg>
<!-- 星星 --><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/></svg>
<!-- 盾牌 --><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>
<!-- 闪电 --><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M13 2 3 14h9l-1 8 10-12h-9z"/></svg>
<!-- 播放 --><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m6 3 14 9-14 9z"/></svg>
<!-- 刷新 --><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
<!-- 链接 --><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>
<!-- 锁 --><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
<!-- 眼睛 --><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>
<!-- 复制 --><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
<!-- 图表 --><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 3v18h18"/><path d="m7 14 3-4 4 3 5-7"/></svg>
<!-- 趋势 --><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/></svg>
<!-- 发送 --><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/></svg>
<!-- 回形针 --><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/></svg>
<!-- 帮助 --><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>
<!-- 旗帜 --><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V4s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/></svg>
<!-- 归档 --><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/></svg>
<!-- 演示 --><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M2 3h20M4 3v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V3"/><path d="m9 21 3-5 3 5"/></svg>
<!-- 芯片 --><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2"/></svg>
<!-- 用户组 --><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
<!-- 建筑 --><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M8 10h.01M16 10h.01"/></svg>
<!-- 书本 --><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
<!-- 天平 --><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3v18M8 21h8"/><path d="m3 7 4-4 4 4"/><path d="M5 7 3 14h8z"/><path d="m13 7 4-4 4 4"/><path d="m21 7-2 7h-8z"/></svg>
<!-- 层 --><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m12 2 9 5-9 5-9-5z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/></svg>
<!-- 目标 --><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>
```

---

## 8. 自检清单（提交前逐条打勾）

- [ ] `data-mod` / `data-screen` 与 manifest 完全一致，文件名与 `file` 字段一致
- [ ] 侧栏、顶栏、多标签、屏内 Tab、翻屏条都能正常渲染（用浏览器打开看）
- [ ] 全屏只有一个 `btn--primary`
- [ ] 没有任何行内色值（`grep -n "style=\"[^\"]*color:" ` 应为空）
- [ ] 表格 >12 行有分页；列表有选中态
- [ ] 危险操作有确认弹窗
- [ ] 空态/加载态至少各出现 1 次（如本屏数据非空，用"某筛选无结果"演示）
- [ ] 数字与第 5 节口径一致
- [ ] 页面高度 ≤1,600px（密集表格 ≤2,000px）
- [ ] 与本模块其他屏的 tab 名、术语一致（术语表见 `docs/术语规范表.md`：用「标书」不用「投标文件」于导航；用「编号」不用「ID」）
