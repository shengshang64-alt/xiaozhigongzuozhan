# R155 · 方案编制主链路：客户建设需求条目正文级逐条覆盖 + 服务类条目承载（B类）

日期：2026-10-05 ｜ 分类：B类（提示词口径变更）｜ PROMPT_VERSION：建立 sol-v1 基线 → **sol-v2/R155-2026-10-05** ｜ 闭环：r150-outline-consulting-gap（P2 · /solution-studio）

## 1. 选题依据

- 账本 open 项中唯一的方案编制主链路实质项（用户选题权重：标书>方案>PPT）；R150 专项轮D 发现、方案已写明「正文级逐条覆盖或单独成节开关，走 B 类流程」。
- 两个残余缺口：
  1. 大纲把评级当「目标/预测」章处理，未回应「采购的服务内容本身」（三明招标含智慧医疗五级/智慧服务三级/互联互通五乙 3 条评级咨询服务条目）；
  2. prompt 章数量 8-12 约束下，66 条系统组名逐字上章标题天花板实测约 35%（集群语义覆盖≈94%），正文生成没有把需求条目分派到对应章的机制。

## 2. 变更内容（src/pages/SolutionStudio/solutionTypes.ts，单一文件 + 新测试文件）

- **A. checklistScopeBlock**（大纲 buildOutlineMessages 与逐章 buildChapterMessages 共用的清单块）：硬性要求行之后新增服务类条目承载规则一行。
- **B. buildOutlineMessages 硬性要求 1**：追加「集群合章允许，但每个系统与需求条目名称至少逐字出现在一个节或小节标题中」——正面回应 8-12 章约束下的逐字覆盖天花板（把逐字位从章标题下沉到节/小节，天花板随可命名节点数放大）。
- **C. 新增纯函数 requirementTitleSegments / chapterRequirementLines**：章/节标题按非文字数字字符切分、连词（与/及）再拆、去泛词表（分系统/子系统/总体/设计/建设/方案/规划/概述/介绍/系统/平台/中心——刻意不含服务/咨询/培训/测评，服务类条目路由依赖这些字样）得名称段；与条目双向包含匹配（纯字母数字段走词边界正则防短缩写误伤内部子串）；命中≥4 条且占比≥80% 视为章名无区分度，宁缺毋滥不注入。**未做 wizard 开关**：条目路由是纯确定性规则，无需用户拍板。
- **D. buildChapterMessages taskUser 注入块**：命中条目数>0 时，在本章差异块（不动 system/stableUser 前缀缓存）注入「【本章须逐条回应的客户建设需求条目（共 N 条）】+ 编号条目 + 每条须独立小节/段落、服务类条目写清服务内容/方法/交付物、无法承载的条目章末注明归入哪一章不得默默丢弃」。
- **E. SOL_PROMPT_VERSION 指纹建立**：R155 前口径追认 sol-v1，本次 = sol-v2/R155-2026-10-05，测试钉死。

## 3. 新旧口径逐字对比（B类强制项）

### 3.1 checklistScopeBlock（末两行，原 → 新）

原：
```
    "硬性要求：分系统设计章节必须逐一覆盖上述清单中的全部系统与客户建设需求条目，不得遗漏；",
  ].join("\n")
```
新：
```
    "硬性要求：分系统设计章节必须逐一覆盖上述清单中的全部系统与客户建设需求条目，不得遗漏；",
    "服务类条目（条目名含咨询、服务、培训、测评陪跑等字样）属于采购的服务内容本身，须有专门章节或小节承载其服务内容、实施方法与交付物，不得只作为评级目标或预期成效表述；",
  ].join("\n")
```

### 3.2 buildOutlineMessages 硬性要求 1（单行替换，原 → 新）

原：
```
    "1. 章节骨架必须符合医疗信息化行业惯例与评审口径，结合医院等级、规模、需求科室与建设系统清单定制，勾选的每个系统都要落到具体的分系统章节；",
```
新：
```
    "1. 章节骨架必须符合医疗信息化行业惯例与评审口径，结合医院等级、规模、需求科室与建设系统清单定制，勾选的每个系统都要落到具体的分系统章节；条目多时可按业务集群合并章节承载，但每个系统与需求条目的名称至少逐字出现在一个节或小节标题中；",
```

### 3.3 buildChapterMessages taskUser（在「本章无预设小节…」行与 kbMaterial 行之间插入，原无 → 新）

```
    chapterReqs.length
      ? `【本章须逐条回应的客户建设需求条目（共 ${chapterReqs.length} 条）】\n${chapterReqs
          .map((r, i) => `${i + 1}) ${r}`)
          .join("\n")}\n以上每条必须落在本章独立小节或独立段落，写明针对该条的建设内容与功能范围；其中服务类条目（条目名含咨询、服务、培训、测评陪跑字样）要写清服务内容、实施方法与交付物；确属本章无法承载的条目，在章末用一行注明归入哪一章，不得默默丢弃。`
      : "",
```
以及 taskUser 前的路由调用（原无 → 新）：
```
  const chapterReqs = chapterRequirementLines(
    ch.title,
    ch.sections,
    sol.hospital_info?.ref_checklist_snapshot?.customer_requirements,
  )
```

### 3.4 其余 prompt 文本

人设、写作铁律 1-4、SOL_STYLE_RULES、三模式边界规则、字数预算、配图契约——**逐字未动**（测试「system 与 stableUser 跨章恒定」与「无清单快照时 prompt 与既有口径一致」钉死）。

## 4. 快照测试处理

SolutionStudio 模块此前无 .snap 快照文件（仓内仅有的两份 prompts 快照属 BidWorkspace，本轮零触及）；既有 checklistScopeBlock 断言均为 toContain 增补安全（systemsFromChecklist.test.ts 10 例原样通过，无需 -u）。本轮以新增 16 例定点测试（solReqCoverage.test.ts）建立后续 B 类改动的钉死基线，含 SOL_PROMPT_VERSION 指纹断言。

## 5. 验证证据（四门）

- npx tsc -b：exit 0 零错误
- npx vitest run：95 文件 **1017 passed / 2 skipped**（R154 基线 1001+2，增量 **+16** 全为本轮新测试，零回退）
- npx eslint solutionTypes.ts + solReqCoverage.test.ts：exit 0 零输出
- npx vite build：exit 0，3.66s

## 6. 边界与裁定维持

- 零 collection / 零 pb_hooks / 零数据模型 / 零新会话外 state（chapterReqs 为 prompt 构造期局部量）。
- 在途代码规避：本轮只动 SolutionStudio（git 在途改动仅在 BidWorkspace scoreItemsScan/starClauseNoise，未触及）；未 commit。
- 维持裁定不动：编造嫌疑未清零导出「只报告不拦截」（R89）、lint-debt-01 有意保留不重构。
- 风险与回退：注入块只在命中时出现、路由函数纯本地零 AI 零费用；若实机出现某章过度注入，收紧点在 requirementSegHit/泛词表，单点可改可回退（补丁脚本 D:\KFDXCX\MedPreSales\scripts\r155_sol_req_coverage.py / r155b_sol_req_coverage_fix.py）。

## 7. 遗留

- r150 的「向导加服务类条目单独成节开关」交互形态未采纳（确定性路由已覆盖诉求）；如后续实机验证大纲仍系统性漏服务条目，再评估向导级开关。
- 正文级逐条覆盖的实机效果验证需一次真实清单（66 条）生成轮，受 AI 调用预算约束顺延（同 R151/R152 轮D 节奏）。
