import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // 只检查产品源码。以下目录为构建产物 / 运行时数据 / 备份快照 / 工具工作目录，
  // 纳入检查会产生约 2768 处与产品代码无关的噪声，把 src 的真实问题（约 150 处）淹没，
  // 使 `pnpm lint` 失去门禁价值（历史遗留项被噪声掩盖）。
  globalIgnores([
    'dist', // 构建产物
    'ui-redesign-pro', // 静态原型
    '.nightrun', // 循环作业的历史备份快照
    '.loop', // 循环作业账本与报告
    '.diag',
    '.vibex', // VibeX 平台往返配置
    '.cursor',
    '.workbuddy-ai',
    '_qa', // 实机验证辅助脚本与产物
    '_shots',
    '_edgeprofile',
    'pocketbase/pb_data', // PocketBase 运行时数据库
    'pocketbase/types.d.ts', // PocketBase 生成的类型声明
    'vibex-local/bin', // VibeX 打包的本地运行时（含自带 pb_data）
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
])
