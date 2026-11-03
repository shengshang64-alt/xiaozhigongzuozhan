import { defineConfig, mergeConfig } from "vitest/config"
import viteConfig from "./vite.config"

// ---------------------------------------------------------------------------
// R165（闭环 R164 挂账「test 采集卫生」）：独立 vitest 配置。
// 此前项目无 vitest.config，测试发现走 Vitest 默认 glob（** 全仓），
// 会把 .loop/** 下的备份 *.test.ts 一并采集 → Cannot find module 假红
// （R163/R164 已两次踩中，R164 仅重命名脱离采集，根因未除）。
// 本轮以 include 白名单（src + scripts）锁定测试发现域，从结构上杜绝旁路采集。
// viteConfig 用 mergeConfig 合并进来——alias(@) 与 react plugin 保持单一真源，
// 不在本文件重复声明（重复会漂移）。
// ---------------------------------------------------------------------------

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      // 测试发现白名单：src 下的单元测试 + scripts 下的 pb_hooks 回归测试
      // （scripts/intelShared.test.ts 校验 PocketBase 情报中枢共享逻辑，属正式测试）。
      // .loop/** 的备份 *.test.ts 一律不采集——正是历轮假红的根因。
      include: [
        "src/**/*.{test,spec}.?(c|m)[jt]s?(x)",
        "scripts/**/*.{test,spec}.?(c|m)[jt]s?(x)",
      ],
      exclude: ["**/node_modules/**", "**/dist/**", "**/.loop/**"],
      environment: "node",
    },
  }),
)
