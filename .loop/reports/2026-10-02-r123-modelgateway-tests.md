# R123 modelGateway 补共置单测（零源改动）

日期：2026-10-02 · 轮次：123 · 优先级：P3

## 选型理由
工作树 221 M / 138 ??（自动循环百轮"禁止 commit"累积），git 状态已无法区分"循环编辑"与"用户在途"，
故择最安全且有实质价值的方向：**为共用纯函数模块补测试**（纯新增 `.test.ts`，绝不改动任何源文件，零误伤在途）。

`modelGateway.buildAvailableModels` 被"三个 AI 页面 + 模型配置页"共用，决定用户可见的可选模型清单与
默认模型回退（`defaultRef ?? platformRef`），此前 0 独立单测，其启用过滤 / source 映射 / 默认命中 /
未启用不入选等口径无回归保护。

## 测试（src/lib/modelGateway.test.ts，9 用例）
- buildAvailableModels：空配置 / 跳过未启用与 null 模型 / 平台 source 映射与 platformRef /
  无显式默认时 defaultRef 回退平台 / 个人 default_model 命中且优先于平台回退 / 默认模型未启用则 models 与 defaultRef 皆空
- modelRefKey：`source:configId:modelId` 三段键
- modelRefLabel：平台 / 个人两种文案（用 toContain 规避"·"分隔符字符歧义）
- costTextForModel：个人承担 vs 平台扣费（null 归平台）

## 环境验证
vitest 默认 node 环境（项目未装 jsdom/happy-dom、无 @vitest-environment）。实测导入 modelGateway
（→ pb/llm/rhLogin/llmCache 链）顶层不触发 window/localStorage 崩溃——该库对浏览器全局均有 `typeof` 守卫。

## 四门验证
| 门 | 结果 |
|---|---|
| tsc -b | EXIT 0 |
| vitest run | 777 passed + 2 skipped（基线 768，+9） |
| eslint --quiet | 新测试文件 0 error |
| vite build | built in 3.19s，EXIT 0 |

## 边界
零提示词 / 零 collection / 零源文件改动 / 未 commit。
