// TEMP R187 probe: real-docx noise check for amountCaseMismatchHits (deleted after evidence capture)
import { describe, expect, it } from "vitest"
import mammoth from "mammoth"
import { amountCaseMismatchHits } from "./bidTypes"

const FILES: string[] = [
  "D:/重要文件/A重要客户情况/B标书/2022年标书/2022年标书/908昆明市呈贡区人民医院集成平台等系统（互联互通四级甲等改造）建设项目(定)/908昆明市呈贡区人民医院集成平台等系统（互联互通四级甲等改造）建设项目(定).docx",
  "D:/重要文件/A重要客户情况/B标书/2024年标书/福建/20241220厦门妇幼（BI）/20241224-WP--厦门市妇幼保健院临床决策支持系统BI（四期）-GH.docx",
  "D:/重要文件/A重要客户情况/B标书/2024年标书/福建/厦门五院维保/（厦门市第五医院）HIS系统维保服务--智业-ping.docx",
  "D:/重要文件/A重要客户情况/B标书/2024年标书/福建/厦门五院维保/（厦门市第五医院）HIS系统维保服务--智业.docx",
  "D:/重要文件/A重要客户情况/公司宣传手册/售前共享库/03政策文件库/02健康医疗政策文件/20其他资料/02国家信息化战略/2016-07中办、国办印发《国家信息化发展战略纲要》.docx",
  "D:/重要文件/A重要客户情况/B标书/2024年标书/安徽/池州二院信息化建设/20240930池州第二人民医院智慧医院信息化建设（一期）方案V4---报财审.docx",
  "D:/重要文件/A重要客户情况/B标书/2024年标书/福建/安溪县医院供应链平台+统一编码CUDI)/JH--安溪县医院供应链平台+统一编码（UDI）响应文件-GH--new(2).docx",
  "D:/重要文件/A重要客户情况/B标书/2026年标书/福建/杏林医院/HIS系统、电子病历、数据库、集成平台、移动护理系统维保【安盟】.docx",
  "D:/重要文件/A重要客户情况/A整体规划方案/江苏/邳州市人民医院/2025年/邳州市人民医院/维保标书/邳州市人民医院信息系统建设合同-1205.docx",
  "D:/重要文件/A重要客户情况/B标书/2022年标书/2022年标书/三区医保改造/三院区医保相关改造-技术商务部分--纵健信联-盛.docx",
  "D:/重要文件/A重要客户情况/B标书/2022年标书/2022年标书/三区医保改造/招标文件——三院区医保相关改造.docx",
  "D:/重要文件/A重要客户情况/B标书/2023年标书/华东标书/安医大二附院/笔架山医院微信公众号及合肥市人口健康平台HIS改造项目-智业.docx",
  "D:/重要文件/A重要客户情况/B标书/2023年标书/华东标书/泾县医院招标参数/泾县医院应标/3.25cr-泾县医院医疗服务能力提升信息化-招标文件 2(1).docx",
  "D:/重要文件/A重要客户情况/B标书/2023年标书/华东标书/泾县医院招标参数/泾县医院应标/3.29CR修改-泾县医院医疗服务能力提升信息化-招标文件.docx",
  "D:/重要文件/A重要客户情况/B标书/2024年标书/安徽/安中医针灸/安徽省针灸医院一院两区信息一体化服务能力提升项目_招标文件.docx",
  "D:/重要文件/A重要客户情况/B标书/2024年标书/海南/琼山妇幼/招标文件/海口市琼山区妇幼保健院新院信息化及智能化建设项目（施工）招标文件07.03.docx",
  "D:/重要文件/A重要客户情况/B标书/2025年标书/其他大区/钦州市第一人民医院医技预约/（定稿05.27-磋商文件）智能医技预约系统(1)(1).docx",
  "D:/重要文件/A重要客户情况/B标书/2025年标书/福建/漳浦/漳浦县医院HIS、EMR系统改造项目--谢(ok).docx",
  "D:/重要文件/A重要客户情况/友商公司产品/招标材料及方案/（东华656-2021）安庆市第二人民医院智慧医院信息化系统招标文件正文.docx",
  "D:/重要文件/A重要客户情况/A整体规划方案/安徽/整体建设规划方案/界首医共体/界首市城乡医共体建设项目-界首市中医院公共卫生服务楼、中药制剂室综合楼、众创大楼医疗信息化项目一包(1).docx",
]

describe("R187 真实标书金额大小写误报甄别", () => {
  it("扫描真实 docx 正文，打印命中分布（取证据用）", async () => {
    let total = 0
    let filesWithHit = 0
    let scanned = 0
    const samples: string[] = []
    for (const f of FILES) {
      let text = ""
      try {
        text = (await mammoth.extractRawText({ path: f })).value
      } catch {
        continue
      }
      scanned++
      const hits = amountCaseMismatchHits([{ title: f.split("/").pop(), content: text }] as never, null)
      total += hits.length
      if (hits.length) filesWithHit++
      for (const h of hits.slice(0, 3)) samples.push("[" + h.level + "] [" + h.chapter.slice(0, 22) + "] " + h.quote)
    }
    console.log("R187_PROBE scanned=" + scanned + " totalHits=" + total + " filesWithHit=" + filesWithHit)
    for (const s of samples.slice(0, 24)) console.log("R187_SAMPLE " + s)
    expect(scanned).toBeGreaterThan(0)
  }, 300000)
})
