# R137 讲标答辩手册导出（标书主链路·讲标答辩环节收尾交付）

## 选题
用户点名两项（quote-history-01 二期、prompt-fabscan-03 残余回注）经账本核实均已 closed（R102/R103），
backlog 实质项无未做残留（其余为命中在途代码的 defer 项，git 复核仍 M/??，继续绕开）。
按预案巡检新角度：讲标与答辩（DefensePanel）三块内容（专家问题池 / 讲标大纲 / 讲标稿要点）
只能在网页里看，无离线交付通道——售前带着打印版答辩口径进评标现场是真实高频场景，
且 PPT 侧已有同类收尾 exportSpeechDocx（讲稿 Word），标书侧对齐补齐属实质缺口。

## 变更
- 新增 `src/pages/BidWorkspace/defenseHandbook.ts`：
  - `buildDefenseHandbookBlocks(projectName, defense)` 纯函数：三块内容组装为中间块结构
    （title/meta/heading/subheading/text/bullet），章节动态编号（只给有内容的块编 一/二/三/四），
    未备答案的问题给占位提示 + 末章「待备答案自查」点名题号；三块全空抛友好提示不产出半成品。
  - `handbookFileName()` 走全局文件名单一源 buildSafeFileName；日期走 localDateStamp()（R112 成果）。
  - `exportDefenseHandbook()` 块→docx Paragraph 机械渲染（docx 库，先例 deckExports 同款），
    Packer.toBlob 后 triggerBlobDownload（R110 成果）。零 AI 调用、零网络请求、零 collection。
- 新增 `src/pages/BidWorkspace/defenseHandbook.test.ts` 12 用例：
  空内容抛错 / 空白 speech_notes 也算空 / 题号顺序与章节编号 / 考察点、可引用章节、答辩要点按有无渲染 /
  完整答案按行拆分去空白行 / 未备答案占位 / 待备自查章只点名未答、全备即消失 /
  章节动态编号（仅大纲时为第一章）/ 讲标稿开场-每页-收尾顺序 / meta 计数 / 文件名非法字符清洗 / 空项目名兜底。
- 修改 `src/components/bid-workspace/DefensePanel.tsx`（改前 git-CLEAN，4 锚点均 assert count==1）：
  面板 header 右侧新增「导出答辩手册」按钮（本地生成、不计费文案），三块全空时点击给 toast 引导不静默；
  导出中 Loader2 禁用防重复点击；归档只读不拦导出（只读操作）。

## 过程修正（留痕）
- r137b：测试文件一处多余括号笔误（tsc 抓到），定点修复。
- r137c：新文件引入 3 处全角空格 U+3000 触发 no-irregular-whitespace（eslint 抓到 2 处、主动清 3 处），
  改用 " · " / " | "，符合项目「代码字符串禁用全角空格」规范；r137d 同步主补丁脚本保持留档一致。

## 红线与裁定维持
无新 collection / 未动 pb_hooks / 会话内无新持久化 state（busy 为组件局部 useState）/
未动任何 AI 提示词（无 B 类流程需求，PROMPT_VERSION 不变）/ 未 commit。
维持裁定：编造扫描只报不拦（R89）、lint-debt-01 不重构、r112/money-count/r119/r124/r130-price/r136-FolderTree
等 defer 项锚点文件复核仍 git-M 或 ?? 在途，继续绕开。

## 四门验证
- npx tsc -b：0 错误
- npx vitest run：86 文件 917 passed + 2 skipped（基线 905+2skip，+12 全部为本轮新增 defenseHandbook.test.ts）
- npx eslint 触及 3 文件：exit 0（零新增 error/warning）
- npx vite build：成功 3.65s

## 场景等价性
导出为纯读操作：不写库、不改 defense 数据结构（仅 import type），三块内容在页面为空时按钮给出
与面板 Empty 态一致的引导。风险边界：docx 渲染层为薄转换未单测（先例：讲稿导出同款结构，由类型检查兜底）。


## 浏览器实机端到端验证（完成审计补记）
线上 Vite dev(:8000) + PocketBase(:7000) 在跑，改动的 defenseHandbook.ts / DefensePanel.tsx 经 HMR 已加载。
- 打开真实标书项目「贵港项目」→ 标书工作台，控制台 0 error / 0 warn（改动无运行期回归）。
- DefensePanel 挂在第 6 步「模拟评标」，其准入守卫为 `dup_report || void_check` 产物存在；
  本机存活项目均无该产物，强行进入需对用户真实医疗项目跑 AI 查重/废标（产生费用并改数据），
  违反数据安全规范与 AGENTS §7，故不做实机导航进入，改以下述方式验证交付物本身。
- evaluate_script 动态 import('/src/pages/BidWorkspace/defenseHandbook.ts') 拿到编译后模块，
  导出函数齐全 [buildDefenseHandbookBlocks, exportDefenseHandbook, handbookFileName]；
  喂入「2 问(1 已答 1 未答)+1 页大纲+讲标稿」样本，真实运行时产出 27 块、章节动态编号
  「一、专家问题池 / 二、讲标大纲 / 三、讲标稿要点 / 四、待备答案自查」，subheading 用 " · " 分隔
  （证实全角空格修复已进线上包），meta「生成日期：2026-10-03 | 问题 2 个（已备答案 1） | 讲标大纲 1 页」，
  空内容抛「尚未生成讲标答辩内容…」，文件名「贵港/项目:测试」→「贵港_项目_测试-讲标答辩手册-2026-10-03.docx」——
  与 12 项 vitest 单测逐条一致。
- 真实调用 exportDefenseHandbook('R137实机验证', …)：组装→docx Document→Packer.toBlob→triggerBlobDownload
  全链路 30ms 成功、无异常、控制台仍 0 error/warn（纯本地生成，零写库、零 AI）。
截图 .qoder/tmp/r137_live.png（线上标书工作台，主题正常、无报错）。
