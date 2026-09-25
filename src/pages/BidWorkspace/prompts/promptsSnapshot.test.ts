import { describe, expect, it } from "vitest"
import {
  buildDupJudgeMessages,
  buildVoidCheckMessages,
  buildDefenseAnswerMessages,
  buildFactSettingsMessages,
  buildJsonRepairMessages,
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
    ])
    for (const m of mods) expect(m.PROMPT_VERSION).toBeGreaterThanOrEqual(1)
  })
})
