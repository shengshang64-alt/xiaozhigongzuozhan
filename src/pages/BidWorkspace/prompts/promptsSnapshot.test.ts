import { describe, expect, it } from "vitest"
import {
  buildDupJudgeMessages,
  buildVoidCheckMessages,
  buildDefenseAnswerMessages,
  buildFactSettingsMessages,
  buildJsonRepairMessages,
  buildDefenseQuestionsMessages,
  buildDefenseOutlineMessages,
  buildSpeechNotesMessages,
  buildSectionResizeMessages,
  buildEvalMessages,
  buildBidRefineMessages,
  buildOrchestrationMessages,
  buildCoverageAuditMessages,
  buildOutlineLevel1Messages,
  buildOutlineChildrenMessages,
  buildTenderParseMessages,
  buildSectionParseMessages,
  buildBidOutlineMessages,
  buildOutlineFixMessages,
  buildBidChapterMessages,
} from "../bidTypes"
import type { DupPair, DefenseQuestion } from "../bidTypes"

// R65 提示词搬迁第一批的防改字快照：构造器已搬至 prompts/*，bidTypes 仅 re-export；
// 快照锁住 system+user 全文——任何一次「顺手改提示词」都会在这里现形（改字必须走 B 类流程：备份+对比+PROMPT_VERSION+1）。
// 用例输入取代表性最小样本；快照基线即搬迁时的原文。

const dupPairs: DupPair[] = [
  {
    target_chapter: "第三章 项目实施",
    target_text: "本项目采用分阶段实施方法，先试点后推广。",
    source_project: "2023 年某三甲医院项目",
    source_chapter: "第二章 实施方案",
    source_text: "本项目采用分阶段实施方法，先试点后推广。",
    similarity: 0.86,
  } as unknown as DupPair,
]

describe("R65 提示词搬迁快照（prompts/* 只搬不改字）", () => {
  it("buildDupJudgeMessages 内容与搬迁时一致", () => {
    expect(buildDupJudgeMessages(dupPairs)).toMatchSnapshot()
  })

  it("buildVoidCheckMessages 内容与搬迁时一致", () => {
    expect(
      buildVoidCheckMessages(
        ["1. 未按招标文件要求盖章的投标无效", "2. 投标报价超出最高限价的投标无效"],
        "投标文件正文示例：本项目提供五星售后服务承诺，响应时间 2 小时。",
        "【★实质性条款】★1 系统响应速度15分",
      ),
    ).toMatchSnapshot()
  })

  it("buildDefenseAnswerMessages 内容与搬迁时一致", () => {
    const q = {
      question: "你们的系统如何保证数据安全？",
      intent: "考察安全方案",
      answer_points: ["等保三级", "数据库审计"],
    } as unknown as DefenseQuestion
    expect(buildDefenseAnswerMessages(q, "第五章 安全设计：等级保护三级……", "【全局事实】本项目工期：90 天")).toMatchSnapshot()
  })

  it("buildFactSettingsMessages 内容与搬迁时一致", () => {
    expect(buildFactSettingsMessages("第三章 采购需求：工期 90 天，响应时间 2 小时。")).toMatchSnapshot()
  })

  it("buildJsonRepairMessages 内容与搬迁时一致", () => {
    expect(buildJsonRepairMessages('{"results":[{"index":1,"ai_verdict":"high"}')).toMatchSnapshot()
  })

  it("PROMPT_VERSION 均为正整数且随 re-export 可达", async () => {
    const mods = await Promise.all([
      import("./dupJudge"),
      import("./voidCheck"),
      import("./defenseAnswer"),
      import("./factSettings"),
      import("./jsonRepair"),
      import("./defenseQuestions"),
      import("./defenseOutline"),
      import("./speechNotes"),
      import("./sectionResize"),
    ])
    for (const m of mods) expect(m.PROMPT_VERSION).toBeGreaterThanOrEqual(1)
  })

  it("R66 第二批：buildDefenseQuestionsMessages 内容与搬迁时一致", () => {
    expect(
      buildDefenseQuestionsMessages(
        "技术方案 20 分；实施团队 15 分",
        "1. 未按要求盖章的投标无效",
        "第五章 安全设计：等级保护三级，数据库审计……",
        "【全局事实】本项目工期：90 天",
      ),
    ).toMatchSnapshot()
  })

  it("R66 第二批：buildDefenseOutlineMessages 内容与搬迁时一致", () => {
    expect(
      buildDefenseOutlineMessages(
        "1. 项目概述\n2. 总体设计\n3. 安全体系",
        "技术方案 20 分；实施团队 15 分",
        "【全局事实】本项目工期：90 天",
      ),
    ).toMatchSnapshot()
  })

  it("R66 第二批：buildSpeechNotesMessages 内容与搬迁时一致", () => {
    expect(
      buildSpeechNotesMessages(
        [{ page_title: "总体设计", bullets: ["双活架构", "信创适配"] }],
        "【全局事实】本项目工期：90 天",
      ),
    ).toMatchSnapshot()
  })

  it("R66 第二批：buildSectionResizeMessages 内容与搬迁时一致", () => {
    expect(
      buildSectionResizeMessages(
        "3.2 安全体系",
        "当前安全体系小节正文切片……",
        "expand",
        1200,
      ),
    ).toMatchSnapshot()
  })

  it("R67 第三批：buildEvalMessages 内容与搬迁时一致", () => {
    expect(
      buildEvalMessages(
        "技术方案 20 分；实施团队 15 分",
        [{ title: "第五章 安全设计", content: "等级保护三级，数据库审计全覆盖， BorderGuard 防泄漏。", node_id: "n5", sections: [], gen_status: "done" }],
      ),
    ).toMatchSnapshot()
  })

  it("R67 第三批：buildBidRefineMessages 内容与搬迁时一致", () => {
    expect(
      buildBidRefineMessages(
        "expand",
        "医院一体化核心业务系统",
        "安徽中医药大学第一附属医院",
        "第五章 安全设计",
        5,
        "当前章节正文：安全体系按等保三级设计……",
        { globalFacts: "【全局事实】本项目工期：90 天" },
      ),
    ).toMatchSnapshot()
  })

  it("R68 第四批：buildOrchestrationMessages 内容与搬迁时一致", () => {
    expect(
      buildOrchestrationMessages(
        [{ nodeId: "n1", title: "3.1 集成平台", chapter: "第三章 集成平台" }],
        "【项目概述】医院一体化核心业务系统，预算 2500 万。",
        { factsLines: ["本项目工期：90 天"], scoringItems: [] },
      ),
    ).toMatchSnapshot()
  })

  it("R68 第四批：buildCoverageAuditMessages 内容与搬迁时一致", () => {
    expect(
      buildCoverageAuditMessages([
        {
          leaf_id: "n1",
          title: "3.1 集成平台",
          chapter: "第三章 集成平台",
          writing_focus: "ESB 总线选型与接口清单",
          facts: ["本项目工期：90 天"],
          table_plan: "接口台账表",
          body_excerpt: "集成平台采用 ESB 架构，统一承载 HIS/LIS/PACS 接口……",
        },
      ]),
    ).toMatchSnapshot()
  })

  it("R68 第四批：buildOutlineLevel1Messages 内容与搬迁时一致", () => {
    expect(
      buildOutlineLevel1Messages("医院一体化核心业务系统", "安徽中医药大学第一附属医院", null, {
        globalFacts: "【全局事实】本项目工期：90 天",
      }),
    ).toMatchSnapshot()
  })

  it("R68 第四批：buildOutlineChildrenMessages 内容与搬迁时一致", () => {
    expect(
      buildOutlineChildrenMessages("第五章 安全设计", ["第四章 集成平台", "第六章 实施方案"], null, {
        quota: 6,
        level: 2,
        sectionWords: 800,
        globalFacts: "【全局事实】本项目工期：90 天",
      }),
    ).toMatchSnapshot()
  })

  it("R69 第五批：buildTenderParseMessages 内容与搬迁时一致", () => {
    expect(buildTenderParseMessages("某医院一体化系统招标文件全文……", { scope: "key" } as never, ["overview"])).toMatchSnapshot()
  })

  it("R69 第五批：buildSectionParseMessages 内容与搬迁时一致", () => {
    expect(buildSectionParseMessages("overview", "某医院一体化系统招标文件全文……")).toMatchSnapshot()
  })

  it("R69 第五批：buildBidOutlineMessages 内容与搬迁时一致", () => {
    expect(
      buildBidOutlineMessages("医院一体化核心业务系统", "安徽中医药大学第一附属医院", null, false, 2, undefined, {
        globalFacts: "【全局事实】本项目工期：90 天",
      }),
    ).toMatchSnapshot()
  })

  it("R69 第五批：buildOutlineFixMessages 内容与搬迁时一致", () => {
    expect(
      buildOutlineFixMessages(
        [{ id: "n1", title: "第五章 安全设计", children: [], part: "tech" }] as never,
        2,
        12,
        800,
        ["叶子数低于目标"],
      ),
    ).toMatchSnapshot()
  })

  it("R69 第五批：buildBidChapterMessages 内容与搬迁时一致", () => {
    const outline = [{ id: "n5", title: "第五章 安全设计", children: [], part: "tech" }] as never
    expect(
      buildBidChapterMessages(
        "医院一体化核心业务系统",
        "安徽中医药大学第一附属医院",
        null,
        outline,
        [{ title: "第五章 安全设计", node_id: "n5", sections: ["5.1 总体架构", "5.2 安全域划分"], gen_status: "done", content: "安全体系按等保三级设计……" }],
        0,
        (nodes) => (nodes ?? []).map((n) => n.title).join("\n"),
        { globalFacts: "【全局事实】本项目工期：90 天", wordBudget: 2000, figures: false },
      ),
    ).toMatchSnapshot()
  })
})
