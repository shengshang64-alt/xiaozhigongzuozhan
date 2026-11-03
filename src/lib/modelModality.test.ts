// R88/F18：模态启发式判定回归——非文本模型误设默认是本轮修的产品缺陷，
// 重点锁定「含子串不得误伤文本模型」与「边界命中」两类误判。
import { describe, expect, it } from "vitest"

import { detectModelModality, isTextGenerationModel } from "./modelModality"

describe("detectModelModality", () => {
  it("文本/生成类通用模型判为 text（兜底，允许设为默认）", () => {
    for (const id of ["gpt-5.5", "claude-sonnet-4-5", "deepseek-v3", "qwen-max", "kimi-k2"]) {
      expect(detectModelModality(id), id).toBe("text")
    }
  })

  it("embedding 优先于其他子串命中", () => {
    expect(detectModelModality("text-embedding-3-large")).toBe("embedding")
    expect(detectModelModality("bge-m3")).toBe("embedding")
    expect(detectModelModality("BAAI/bge-reranker-v2")).toBe("embedding")
  })

  it("图像/视频模型识别为对应模态", () => {
    expect(detectModelModality("dall-e-3")).toBe("image")
    expect(detectModelModality("gpt-image-1")).toBe("image")
    expect(detectModelModality("jimeng-4.0")).toBe("image")
    expect(detectModelModality("sora-2")).toBe("video")
    expect(detectModelModality("kling-v2-master")).toBe("video")
  })

  it("语音合成/识别识别为 tts/stt，且 tts 必须词边界命中", () => {
    expect(detectModelModality("speech-2.8-hd-tts")).toBe("tts")
    expect(detectModelModality("cosyvoice-v2")).toBe("tts")
    expect(detectModelModality("whisper-1")).toBe("stt")
    // 防误伤：atlas/limestone 之类含 "tts" 子串但不是独立 token 的文本模型名
    expect(detectModelModality("atlas-pro")).toBe("text")
  })

  it("isTextGenerationModel 与 text 模态一致", () => {
    expect(isTextGenerationModel("gpt-5.5")).toBe(true)
    expect(isTextGenerationModel("dall-e-3")).toBe(false)
    expect(isTextGenerationModel("text-embedding-3-small")).toBe(false)
  })
})
