# 2026-10-02 R130 场景自测：PPT 逐页 AI 生图成本确认闸门

- 场景：三甲医院智慧服务汇报 PPT 制作（建 deck→逐页编辑→配图）。
- 步骤：/ppt-quote 新建通用介绍 deck(5页) → 逐页编辑第 1 页（imageHint 医院门诊
  大厅/文左图右）→ 点「AI 生图」→ 观察成本确认弹窗 → 点「取消」→ 复核网络与
  页面状态 → 删除测试 deck。
- 预期：点击后必须出现成本确认框（含生图次数与 RunningHub 扣费口径），取消后
  零生图请求零扣费；修复前为裸调直发生图。
- 实际：弹窗文案逐字命中；取消后网络层无生图请求、无成功提示；四门全绿
  （tsc 0 / vitest 869+2skip / eslint 净新增 0 / build 3.74s）。
- 发现问题（既有环境缺口，非本轮引入）：price-preview 端点本机 404，前端按契约
  优雅降级；已挂账 r130-price-preview-404。
- 取证：_shots/R130/slide-image-cost-confirm-dialog.png；
  报告 .loop/reports/2026-10-02-r130-slide-image-cost-gate.md
