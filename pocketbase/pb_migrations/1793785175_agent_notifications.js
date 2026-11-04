/// <reference path="../pb_data/types.d.ts" />
// 2026-11-04（Harness 改造第 1 期）：新增 agent_notifications —— 智能体（DeepSeek Harness / xz-mcp）回推任务结果的通知表。
//
// 为什么用迁移而不是 pb_hooks：pb_hooks 目录被 PocketBase 监听，新增文件会让运行中的 PocketBase 自动重启；
//   迁移只在 PocketBase 下次启动时执行，不影响正在运行的服务。
// 访问方式：走 PocketBase 原生 records API（/api/collections/agent_notifications/records），
//   规则沿用全站身份约定：只认 X-Rh-User-Id 头，且只能读写本人的记录。
//   - 新建：rh_user_id 必须等于请求头身份
//   - 修改：只允许改 read（标记已读），不能改标题/正文/归属
//   - 删除：不开放（deleteRule = null，仅超级管理员）
// 回滚：down 删除整个集合。
// 幂等：集合已存在则跳过。
migrate(
  (app) => {
    try {
      app.findCollectionByNameOrId("agent_notifications")
      return
    } catch (_) {}
    const own = '@request.headers.x_rh_user_id != "" && rh_user_id = @request.headers.x_rh_user_id'
    const col = new Collection({
      type: "base",
      name: "agent_notifications",
      listRule: own,
      viewRule: own,
      createRule: '@request.headers.x_rh_user_id != "" && @request.body.rh_user_id = @request.headers.x_rh_user_id',
      updateRule: own + ' && @request.body.rh_user_id:isset = false && @request.body.title:isset = false && @request.body.body:isset = false && @request.body.source:isset = false',
      deleteRule: null,
      fields: [
        { name: "rh_user_id", type: "text", required: true, max: 64 },
        { name: "title", type: "text", required: true, max: 200 },
        { name: "body", type: "text", max: 20000 },
        { name: "level", type: "select", maxSelect: 1, values: ["info", "success", "warning", "error"] },
        { name: "source", type: "text", max: 40 },
        { name: "read", type: "bool" },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      indexes: ["CREATE INDEX idx_agent_notif_user ON agent_notifications (rh_user_id, created)"],
    })
    app.save(col)
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId("agent_notifications"))
    } catch (_) {}
  },
)
