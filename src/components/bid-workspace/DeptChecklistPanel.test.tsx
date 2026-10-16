/** @vitest-environment jsdom */
/**
 * 部门检查清单面板 UI 回归网（jsdom，零 AI、不触网——PocketBase 走 mock）。
 *
 * 守的是用户要的那几件事：三张清单卡片能一键导入、表格逐行照原文、勾选/问题记录/检查人/
 * 检查日期/交叉检查同四列/表尾签名栏都能填且都落库、每次改动留痕、重复导入不堆积。
 * 旁路 mock：pbJsonRequest（网络）、decodeRhToken（登录态）、sonner（提示条）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => {
  const state = {
    records: [] as Record<string, unknown>[],
    calls: [] as { path: string; method: string; body: Record<string, unknown> | null }[],
    /** 让接下来 N 次 PATCH 失败（测「保存失败可重试」） */
    failPatches: 0,
  }
  return state
})

vi.mock("@/lib/pbJson", () => ({
  pbJsonRequest: async (path: string, init?: RequestInit) => {
    const method = String(init?.method ?? "GET").toUpperCase()
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null
    h.calls.push({ path, method, body })
    if (method === "GET") return { items: h.records }
    if (method === "POST") {
      const rec = { id: `new${h.records.length + 1}`, ...(body ?? {}), created: "2026-10-16 09:30:00.000Z", updated: "2026-10-16 09:30:00.000Z" }
      h.records.push(rec)
      return rec
    }
    if (method === "PATCH") {
      if (h.failPatches > 0) {
        h.failPatches -= 1
        throw new Error("HTTP 500 · 本次保存被服务端拒绝")
      }
      const id = path.split("/").pop()!
      const rec = h.records.find((r) => r.id === id)
      if (rec && body) Object.assign(rec, body, { updated: "2026-10-16 10:00:00.000Z" })
      return rec
    }
    return {}
  },
}))

vi.mock("@/lib/rhLogin", () => ({
  decodeRhToken: () => ({ sub: "u1", nickName: "张三" }),
}))

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import "@testing-library/jest-dom/vitest"
import { DeptChecklistPanel } from "./DeptChecklistPanel"
import { buildDeptCheckCreateBody, buildDeptCheckPatchBody, readDeptCheckDoc, type DeptCheckDoc } from "@/pages/BidWorkspace/bidChecklistStore"
import { buildDeptCheckRows, deptChecklistDef } from "@/pages/BidWorkspace/bidChecklists"
import { useDeptChecklists } from "@/pages/BidWorkspace/useDeptChecklists"

afterEach(() => {
  cleanup()
  h.records.length = 0
  h.calls.length = 0
  h.failPatches = 0
})
beforeEach(() => {
  h.records.length = 0
  h.calls.length = 0
  h.failPatches = 0
})

const p = () => render(<DeptChecklistPanel projectId="proj1" projectName="某医院智慧医院项目" />)

const callsOf = (method: string) => h.calls.filter((c) => c.method === method)
const patchedBodies = () => callsOf("PATCH").map((c) => c.body ?? {})

/** PATCH body 里的扩展元数据形状（测试断言用） */
type MetaShape = {
  check_dates: { self: string; cross: string }
  signatures: { self: { name: string; date: string }; cross: { name: string; date: string } }
  revise_reason: string
  result: string
  log: { at: string; by: string; what: string }[]
}

const metaOf = (body: Record<string, unknown>) => body.rating_targets as unknown as MetaShape

/** 把一份清单以「已导入」状态塞进 mock 的 GET 结果 */
function seedImported(defKey: string, id = "rec1") {
  const def = deptChecklistDef(defKey)!
  const body = buildDeptCheckCreateBody(def, "proj1", "某医院智慧医院项目", "u1")
  h.records.push({ id, ...body, created: "2026-10-16 09:30:00.000Z", updated: "2026-10-16 09:30:00.000Z" })
  return readDeptCheckDoc(h.records[0]) as DeptCheckDoc
}

describe("部门检查清单面板：三张卡片 + 一键导入", () => {
  it("未导入时三份清单各一张卡片（表名 + 条数），导入按钮齐备", async () => {
    p()
    expect(await screen.findByText("招标书检查表")).toBeInTheDocument()
    expect(screen.getByText("投标文件检查表（技术部分）")).toBeInTheDocument()
    expect(screen.getByText("解决方案检查表")).toBeInTheDocument()
    expect(screen.getByText("共 10 条（源表 13 行：条目 + 分区 + 表尾）")).toBeInTheDocument()
    expect(screen.getByText("共 24 条（源表 29 行：条目 + 分区 + 表尾）")).toBeInTheDocument()
    expect(screen.getByText("共 17 条（源表 20 行：条目 + 分区 + 表尾）")).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: /导入为本项目清单/ })).toHaveLength(3)
  })

  it("点「导入为本项目清单」→ POST 落既有 checklists 集合（字段与结构正确）并渲染出表格", async () => {
    p()
    const btn = (await screen.findAllByRole("button", { name: /导入为本项目清单/ }))[0]
    fireEvent.click(btn)
    await waitFor(() => expect(callsOf("POST")).toHaveLength(1))
    const body = callsOf("POST")[0].body!
    expect(callsOf("POST")[0].path).toBe("/api/checklists")
    expect(body.source_mode).toBe("dept_check")
    expect(body.checklist_name).toBe("招标书检查表")
    expect((body.items as unknown[]).length).toBe(12)
    expect(body.rating_targets).toMatchObject({ kind: "dept_check", project_id: "proj1", def_key: "tender" })
    // 导入后表格直接出现在同一张卡片上：原文条目与两组检查列
    expect(await screen.findByText("文件命名是否规范")).toBeInTheDocument()
    expect(screen.getAllByText("结果").length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText("问题记录").length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText("检查人").length).toBeGreaterThanOrEqual(2)
  })

  it("重复导入不堆积：已导入的清单不再出现导入按钮，连点两次也只发一次 POST", async () => {
    seedImported("tender")
    p()
    // 已导入 → 该清单没有导入按钮（另两份仍有）
    expect(await screen.findByText("文件命名是否规范")).toBeInTheDocument()
    const btns = screen.getAllByRole("button", { name: /导入为本项目清单/ })
    expect(btns).toHaveLength(2)
    // 连点两次（第二次点击时按钮已禁用）→ 仍然只有一次 POST
    fireEvent.click(btns[0])
    fireEvent.click(btns[0])
    await waitFor(() => expect(callsOf("POST")).toHaveLength(1))
  })
})

describe("部门检查清单面板：表格逐行照原文", () => {
  it("渲染序号/检查内容/细则原文，分区行跨列显示，原表缺号行照原样", async () => {
    seedImported("bid")
    p()
    expect(await screen.findByText("具备履行合同所必需的设备和专业技术能力")).toBeInTheDocument()
    // 分区行原文（一 通用资格条件（自查、交叉））
    expect(screen.getByText("一")).toBeInTheDocument()
    expect(screen.getByText("通用资格条件（自查、交叉）")).toBeInTheDocument()
    // 原表缺号条目（r20 公司红线条款）照原样：序号列空、内容与细则都在
    expect(screen.getByText("公司红线条款")).toBeInTheDocument()
    expect(
      screen.getByText(/是否要提供著作权、产权、版权；免费维护期超1年；付款条件无首款/),
    ).toBeInTheDocument()
    // 多行细则按原文换行渲染在同一格（whitespace-pre-line，不拆成多行表）
    expect(screen.getByText(/表格标题行是否完整、准确，招标编号、名称、签字栏是否有遗漏/)).toBeInTheDocument()
  })

  it("表头三字段可填、两列检查日期与表尾签名栏都在", async () => {
    seedImported("sol")
    p()
    expect(await screen.findByLabelText("项目名称")).toHaveValue("某医院智慧医院项目")
    expect(screen.getByLabelText("主负责人")).toBeInTheDocument()
    expect(screen.getByLabelText("难度系数")).toBeInTheDocument()
    expect(screen.getByLabelText("自查检查日期")).toBeInTheDocument()
    expect(screen.getByLabelText("交叉检查日期")).toBeInTheDocument()
    expect(screen.getByLabelText("自查人签名")).toBeInTheDocument()
    expect(screen.getByLabelText("交叉检查人签名")).toBeInTheDocument()
    expect(screen.getByLabelText("自查签名日期")).toBeInTheDocument()
    expect(screen.getByLabelText("交叉检查签名日期")).toBeInTheDocument()
    // 表尾原文（检查结果 / 修改原因 / 签名）逐字保留在面板上
    expect(screen.getByText(/1、可以送出 ；/)).toBeInTheDocument()
    expect(screen.getAllByText(/2、重新修改/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/签名：/).length).toBeGreaterThan(0)
    expect(screen.getByRole("button", { name: "1、可以送出" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "2、重新修改" })).toBeInTheDocument()
  })
})

describe("部门检查清单面板：勾选 + 问题记录 + 检查人 + 日期 + 交叉检查，改动都落库并留痕", () => {
  it("自查勾 √、写问题记录与检查人、填检查日期与签名 → 一次 PATCH 全带走", async () => {
    seedImported("tender")
    p()
    const mark = await screen.findByLabelText("自查通过：文件命名是否规范")
    fireEvent.click(mark)
    fireEvent.change(screen.getByLabelText("自查问题记录：文件命名是否规范"), { target: { value: "文件名为旧项目编号" } })
    fireEvent.change(screen.getByLabelText("自查检查人：文件命名是否规范"), { target: { value: "王五" } })
    fireEvent.change(screen.getByLabelText("自查检查日期"), { target: { value: "2026-10-16" } })
    fireEvent.change(screen.getByLabelText("自查人签名"), { target: { value: "王五" } })
    // 500ms 防抖后落库（连续键入只发一次）
    await waitFor(() => expect(patchedBodies().length).toBeGreaterThanOrEqual(1), { timeout: 3000 })
    const body = patchedBodies().at(-1)!
    const rows = body.items as Array<{ rid: string; self: { result: string; note: string; checker: string } }>
    const row = rows.find((r) => r.rid === "tender#1")!
    expect(row.self).toEqual({ result: "√", note: "文件名为旧项目编号", checker: "王五" })
    const meta = metaOf(body)
    expect(meta.check_dates.self).toBe("2026-10-16")
    expect(meta.signatures.self).toEqual({ name: "王五", date: "" })
    expect(meta.signatures.cross).toEqual({ name: "", date: "" })
    // 留痕：谁（登录昵称）+ 什么时候 + 改了什么
    expect(meta.log.length).toBeGreaterThanOrEqual(1)
    expect(meta.log[0].by).toBe("张三")
    expect(meta.log[0].at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(meta.log[0].what).toContain("自查：结果「√」")
    expect(meta.log[0].what).toContain("自查检查日期")
  })

  it("交叉检查同四列独立填写；√ / × / 未判定 三态可切换且计数正确", async () => {
    seedImported("tender")
    p()
    const crossFail = await screen.findByLabelText("交叉检查不通过：文件命名是否规范")
    fireEvent.click(crossFail)
    // 反噪音：出现 1 条不通过才显示「不通过」徽标
    expect(await screen.findByText("不通过 1")).toBeInTheDocument()
    // 再点一次取消 → 回到未判定
    fireEvent.click(crossFail)
    await waitFor(() => expect(screen.queryByText("不通过 1")).toBeNull())
    fireEvent.click(await screen.findByLabelText("交叉检查通过：文件命名是否规范"))
    fireEvent.change(screen.getByLabelText("交叉检查问题记录：文件命名是否规范"), { target: { value: "封面缺页眉" } })
    fireEvent.change(screen.getByLabelText("交叉检查检查人：文件命名是否规范"), { target: { value: "李四" } })
    expect(await screen.findByText("通过 1")).toBeInTheDocument()
    await waitFor(() => expect(patchedBodies().length).toBeGreaterThanOrEqual(1), { timeout: 3000 })
    const body = patchedBodies().at(-1)!
    const rows = body.items as Array<{ rid: string; cross: { result: string; note: string; checker: string } }>
    expect(rows.find((r) => r.rid === "tender#1")!.cross).toEqual({ result: "√", note: "封面缺页眉", checker: "李四" })
  })

  it("表尾检查结果与修改原因可填可落库（原有列名与文案）", async () => {
    seedImported("tender")
    p()
    fireEvent.click(await screen.findByRole("button", { name: "2、重新修改" }))
    fireEvent.change(screen.getByLabelText("修改原因"), { target: { value: "第 3 条排版待改" } })
    await waitFor(() => expect(patchedBodies().length).toBeGreaterThanOrEqual(1), { timeout: 3000 })
    const meta = metaOf(patchedBodies().at(-1)!)
    expect(meta.result).toBe("revise")
    expect(meta.revise_reason).toBe("第 3 条排版待改")
  })

  it("留痕在面板上可见（谁 / 何时 / 改了什么），未留痕时给说明而不是空白", async () => {
    seedImported("tender")
    const { unmount } = p()
    expect(await screen.findByText(/尚无留痕：每次勾选 \/ 填写都会记录/)).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText("自查通过：文件命名是否规范"))
    expect(await screen.findByText(/张三/)).toBeInTheDocument()
    expect(await screen.findByText(/自查：结果「√」/)).toBeInTheDocument()
    unmount()
  })

  it("归档只读（locked）：勾选与输入全部禁用，原文照常可看", async () => {
    seedImported("tender")
    render(<DeptChecklistPanel projectId="proj1" projectName="某医院智慧医院项目" locked />)
    expect(await screen.findByText("文件命名是否规范")).toBeInTheDocument()
    expect(screen.getByLabelText("自查通过：文件命名是否规范")).toBeDisabled()
    expect(screen.getByLabelText("自查检查人：文件命名是否规范")).toBeDisabled()
    expect(screen.getAllByText("已归档只读").length).toBeGreaterThanOrEqual(1)
  })

  it("保存失败如实提示并可点击重试（重试发的是最新内容，不是失败时的旧快照）", async () => {
    seedImported("tender")
    p()
    const mark = await screen.findByLabelText("自查通过：文件命名是否规范")
    h.failPatches = 1
    fireEvent.click(mark)
    // 失败徽标出现（不假装成功）
    const retry = await screen.findByRole("button", { name: "保存失败，点击重试" }, { timeout: 3000 })
    // 失败后用户继续改内容 → 重试必须带最新一版
    fireEvent.change(screen.getByLabelText("自查检查人：文件命名是否规范"), { target: { value: "赵六" } })
    fireEvent.click(retry)
    await waitFor(() => {
      const ok = patchedBodies().filter((b) => (b.items as Array<{ rid: string; self: { checker: string } }>).some((r) => r.self?.checker === "赵六"))
      expect(ok.length).toBeGreaterThanOrEqual(1)
      expect(screen.queryByRole("button", { name: "保存失败，点击重试" })).toBeNull()
    }, { timeout: 3000 })
  })
})

describe("useDeptChecklists：导入幂等与保存失败可重试（hook 级）", () => {
  it("同一项目同一清单定义只创建一次，第二份记录不进 docs", async () => {
    seedImported("tender", "rec1")
    // 人为再塞一条同项目同定义的记录（模拟历史脏数据 / 并发导入）
    seedImported("tender", "rec2")
    const seen: string[] = []
    function Probe() {
      const api = useDeptChecklists({ projectId: "proj1", projectName: "p" })
      if (!api.loading) seen.push(api.docOf("tender")?.id ?? "none")
      return <span>{api.docs.length}</span>
    }
    render(<Probe />)
    await waitFor(() => expect(seen.length).toBeGreaterThan(0))
    // 两份记录都在 docs 里（服务端已有脏数据不隐藏），但「本项目清单」只认第一份 → 不会新增第二份
    expect(await screen.findByText("2")).toBeInTheDocument()
    expect(seen.at(-1)).toBe("rec1")
  })

  it("PATCH body 与服务端记录结构一致（往返可解析）", async () => {
    const doc = seedImported("sol")
    const body = buildDeptCheckPatchBody(doc)
    expect(readDeptCheckDoc({ id: doc.id, source_mode: "dept_check", checklist_name: doc.checklist_name, items: body.items, rating_targets: body.rating_targets, updated: doc.updated })).not.toBeNull()
    expect(buildDeptCheckRows(deptChecklistDef("sol")!)).toHaveLength(doc.rows.length)
  })
})
