# xz-mcp：小智工作站 MCP 插件（给 DeepSeek Harness 用）

让 Harness 里的智能体读写工作站的 **方案 / 标书 / 报价 / 客户** 四类数据，并把任务结果写进工作站通知表。stdio 传输，Node 24，只连本机 PocketBase（127.0.0.1:7000），不出网。

## 工具（Harness 里显示为 `mcp__xz__<名字>`）
| 工具 | 作用 |
|---|---|
| `list_records` | 列某类数据（分页，只回摘要字段） |
| `search_records` | 按名称关键词跨四类搜索 |
| `get_record` | 读一条；可指定字段，长字段截断 |
| `propose_update` / `propose_create` | 只生成字段级改动预览 + 确认码（15 分钟、一次性），**不写库** |
| `apply_change` | 凭确认码写库；必须先把预览给用户看、用户明确同意后才可调用 |
| `notify` | 往 `agent_notifications` 写一条通知 |

## 安全限制（写死在代码里）
- 集合白名单只有 `solutions` `bid_projects` `quotes` `customers`；可写字段也是白名单。
- **没有删除工具**；不能改 `archived` / `deleted_at`（防软删除）；不能把原本有内容的字段改成空。
- 写入两段式：propose → 展示给用户 → 用户同意 → apply。apply 前会核对记录在此期间没被别人改过。
- 脱敏：返回给模型前，医院/客户名、联系人、手机/座机、金额都换成 `[医院1]` `[联系人2]` `[电话3]` `[金额4]`；模型写回时自动还原。映射只在本进程内存（可选本地文件），不出网。含未知占位符或「已截断」标记的内容拒绝写入。
- 身份沿用工作站约定：请求头 `X-Rh-User-Id`，不绕过鉴权。

> 说明：Harness 当前版本的 MCP 客户端不支持 elicitation（服务器弹窗确认），所以用「确认码 + 工具描述约束」。这是软约束：模型若违规直接调 apply，代码拦不住。想要硬确认，可在 Harness 权限里把 `mcp__xz__apply_change` 设成每次询问。

## 环境变量
| 变量 | 默认 | 说明 |
|---|---|---|
| `XZ_USER_ID` | （必填） | 工作站身份，本地部署是 `local-user` |
| `XZ_PB_URL` | `http://127.0.0.1:7000` | PocketBase 地址 |
| `XZ_TEAM_TOKEN` | 空 | 可选，团队登录 token。注意 Harness 会清洗名字含 TOKEN/KEY 的继承变量，需在配置的 `env` 里显式写（用 `${credential:...}`，别写明文） |
| `XZ_MASK_FILE` | 空 | 可选，脱敏映射存本地文件，重启后占位符编号不变。文件含真实名称，别提交、别外传 |

## 在 Harness 注册
在 `C:\Users\Administrator\.dsh\profiles\desktop\cordis.patch.yml` 末尾追加（先备份）：
```yaml
- insert:
    - id: mcp-xz
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: xz
        transport: stdio
        command: 'D:\Program Files\nodejs\node.exe'
        args: ['D:\重要文件\工作的小程序\xiaozhigongzuozhan\tools\xz-mcp\src\server.js']
        env:
          XZ_USER_ID: local-user
          XZ_PB_URL: 'http://127.0.0.1:7000'
        startupTimeoutMs: 30000
```
建议在 Harness 没有任务在跑时追加，然后重启 Harness（或等它热重载）。工具列表里出现 `mcp__xz__list_records` 就算成功。

## 使用约定
- **只在 opendesign 通道的模型下用这些工具**。Harness 的 MCP 工具对所有模型通道都可见，没法按通道屏蔽；脱敏已在插件里做，但请别在第三方通道的会话里调它。
- 通知表要等工作站 PocketBase 下次重启、迁移 `pocketbase/pb_migrations/*_agent_notifications.js` 生效后才有；之前 `notify` 会友好报错。
- 微信推送放第 3 期：由 Harness 的 dsh-weixin 发，插件这边不直接发。

## 开发
```
npm install
npm test          # 单元测试（虚构数据）
node scripts/smoke.mjs   # 对本机工作站做只读冒烟（只打印统计，不打印内容）
```
