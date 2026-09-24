---
trigger: always_on
---
# VibeX 平台契约（不可协商）

本项目是从 **VibeX 应用**导出的 dev-source 快照，不是普通本地仓库。任何改动都必须保留平台契约，否则改动**回不到线上**。

## 身份事实

| 项 | 值 |
|---|---|
| app_id | `app-d61cf9ef4f3a43a9ac231816a7e5d501` |
| 应用类型 | `web`（见根目录 `.vibex-app-type`） |
| 导出时间 | 2026-09-17T08:50:04Z |
| 来源 | `dev-container` |
| 平台引导文件 | `AGENTS.md`（Codex）/ `CLAUDE.md`（Claude Code）/ `.cursor/rules/vibex-source-roundtrip.mdc`（Cursor） |

## 绝对不允许做的事

1. **不得修改 `app_id`、RunningHub 登录/计费集成、PocketBase 路由装配、`.vibex-app-type`。**
   —— 这些是平台识别应用的锚点，改了以后线上构建会认不出这个应用。
2. **不得把下列内容打进任何交付/上传包**：
   `.env` / `.env.local` / 任何凭证 / `pb_data` / `*.log` / `node_modules` / `dist` / 各类缓存 / agent 工作目录（`.nightrun` `.loop` `.diag` `_qa` `_shots` `_edgeprofile` `_vite_dev.log` `pb.log` `vite.log`）。
3. **不得删除或改写 VibeX 平台保护库**（上传时会返回 `platform_lib` 并被跳过，改了等于白改）。
4. **不得整体覆盖 `vite.config.ts`。** 其中的 `rhSourcePlugin` 是平台注入的可视化编辑标记插件（给每个 JSX 元素加 `data-rh-src`），必须保持在 `plugins` 数组第 0 位。要改只能用「读 + 局部编辑」，不得删除该函数定义，也不得删掉 `@babel/parser` / `@babel/traverse` / `magic-string` 三个 import。

## 回传时的打包规则

若用户要求把改动回传到 VibeX，按 `.vibex/skills/vibex-app-source-roundtrip/SKILL.md` 执行。要点：

- **ZIP 内路径必须与 VibeX 里选择的目录对齐，平台不会自动剥掉外层文件夹。**

| VibeX 里选择的目录 | 本地 `--source` | ZIP 内路径应形如 |
|---|---|---|
| `app/src/` | `<项目>/src` | `index.css`、`components/App.tsx` |
| `app/` | `<项目>` | `package.json`、`src/index.css` |
| `pb_hooks/` | `<项目>/pocketbase/pb_hooks` | `aigc.pb.js` |

- 每个目标目录**单独打一个 ZIP**，不要把 `src/` 和 `pb_hooks/` 混在一个包里。
- 上传后必须核对平台回显的路径是否为预期路径（如 `app/src/index.css`）。
  若看到 `app/src/<项目名>/...`、意外的 skip、`PATH_FORBIDDEN`、`INVALID_PATH`，**判定为回传失败，重新打包**，不要去排查运行时报错。

## 判定自检（每次改动收尾问自己）

> 我这次改动，有没有碰上面 4 条「绝对不允许」？
> 如果答案是「碰了」——停下来，把理由和影响写清楚，交用户决定，不要自己拍板。
