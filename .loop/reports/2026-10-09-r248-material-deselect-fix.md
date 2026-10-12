# R248 — 素材库「取消选择」交互断链修复

## 选题
用户点名的 quote-history-01 / prompt-fabscan-03 均复核为已 closed。P1 项 r2-r012-list-tableize
剩余两站（标书工作台项目列表 / 资质明细）本轮 git status 复查仍为用户未提交在途(M)，按既有裁定绕开并记录。
改走「巡检新角度—交互断链」。

## 缺陷
素材库 → 联网抓取 Tab，选中多张后，顶栏提示条上的「取消选择」按钮实现为：

    onClick={() => p.toggleSelectUrl(p.selectedUrls[0])}

`toggleSelectUrl` 是「单项开关」语义（in 则移除、out 则加入），传入 `selectedUrls[0]` 只会从选择集里
拿掉**第一张**。当已选 N 张（N>1）时，点击「取消选择」后仍有 N-1 张保持高亮，提示条显示「已选 N-1 张」，
「批量入库」按钮依旧可点——与按钮字面含义（清空整批选择）不符，是真实交互断链。

## 修复
- `useMaterialLibrary.ts`：新增并导出 `clearSelection = useCallback(() => setSelectedUrls([]), [])`。
- `MaterialLibraryPage.tsx`：「取消选择」按钮 `onClick={p.clearSelection}`。
- `materialSelection.test.ts`（新增）：源码扫描哨兵（无 jsdom，沿用 disclosureA11y / onDemandHeavyLibs 风格），
  断言 hook 暴露整批清空、页面不再出现 `p.toggleSelectUrl(p.selectedUrls[0])`，防止回流。

## 影响面
零 collection / 零 pb_hooks / 零提示词（非 B 类）/ 零数据模型 / 零迁移。仅素材库一个 clean 目录，未触碰任何在途文件。

## 四门验证
- `npx tsc -b`：0 错误。
- `npx vitest run`：151 files，1778 passed / 2 skipped（基线 1776，+2 新增用例）。
- `npx eslint`（3 触及文件）：0 error。
- `npx vite build`：成功，3.32s（>500kB chunk 告警为既有基线噪声）。

未 git commit。
