# 工作记录：单个会话归档修复与 DSH 原生会话右键菜单支持

- **日期**：2026-11-24
- **主题**：修复单个会话归档失效/不同步问题，并将侧栏会话右键菜单接入 DSH 原生 `ctx.contextMenus`（`target: 'session'`）
- **状态**：已完成

## 1. 目标与范围

### 需求来源
用户反馈：「现在单个会话没法归档，右键菜单，支持 dsh 原生的右键会话功能」。

### 根因核实（基于本机运行中 DSH 源码）
经只读核查运行中 DSH（`/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/`）：

1. **会话右键未接入原生菜单**：
   - DSH 原生通过 `@deepseek-ai/dsh-client-ui-context-menu` 提供 `ctx.contextMenus` 服务，`@deepseek-ai/dsh-client-ui-workspace`（`src/client/session-actions/context-menus.tsx`）在其上为 `target: 'session'` 注册了全部原生会话菜单项：置顶/取消置顶（`session.pin`）、重命名（`session.rename` + `SessionRenameDialog`）、创建分支（`session.fork` + 迁移提示）、复制会话 ID（`session.id`）、归档/取消归档（`session.archive` + 运行中会话二次确认弹窗 `SessionArchiveConfirmDialog` + 撤销 Toast），同时承载第三方插件对 `target: 'session'` 及旧 `sidebar.workspaces.session.menu.item` 槽位的扩展。
   - 本插件 `src/sidebar.tsx` 之前在会话行右键时只弹出自绘 `MenuLayer`（仅含重命名 / 归档 / 派生三项），绕过了 DSH 原生菜单、确认弹窗、Toast 撤销与全部扩展项。
2. **单个会话归档失效 / 侧栏不即时更新**：
   - `src/client.tsx` 的 `bridge.archiveSession` 直接调用 `workspaces.archiveSession(sessionId)`，既不走 `uiWorkspace.archiveSession`（归档当前会话时不清除主区选中），遇到运行中会话抛 `WorkspaceArchiveError(workspace/session-active)` 时还被 `MenuLayer` 捕获并写入 `setLoadError` 导致整棵侧栏被错误页替换。
   - `src/sidebar.tsx` 的 `workspacesSignature` 只编码 `workspacesSnapshot.items`，**完全忽略 `archivedSessionIds`**；通过原生菜单或快捷键归档/取消归档后不会触发防抖 `reload()`。
   - `src/sidebar.tsx` 的 `treeInput.archivedSessionIds`、`observationsOf` 与 `mergeLiveSessions` 只读服务端快照 `tree.archivedSessionIds`，未消费 `useWorkspaces` 的实时 `archivedSessionIds`，导致归档后无法即时从侧栏消失。
   - `src/tree-model.ts` 的 `isVisibleMember` 与 `observationsOf` 用 `archived.has(session.sessionId)` 精确匹配，未按 `normalizeSessionId` 归一化 `session-` 前缀，与 `isCurrentSession` / `live-merge.ts` 口径不一致。
   - `dsh-client-ui-context-menu` 的外部点击关闭监听会忽略右键（`event.button === 2`），在原生会话菜单打开后直接右键项目/worktree 行时需显式调用 `contextMenus.close()`，避免双菜单重叠。

### 验收标准
- **AC1**：右键点击非空白会话行（或聚焦后按 `ContextMenu` / `Shift+F10`）时，优先调用 DSH 原生 `ctx.contextMenus.open({ kind: 'session', value: { sessionId, displayTitle } }, { x, y })`，完整支持 DSH 原生会话右键功能（置顶/取消置顶、重命名、派生、复制会话 ID、归档/取消归档、运行中会话确认弹窗、撤销 Toast 及插件扩展项）。
- **AC2**：空白会话行（`row.blank === true`）不弹出原生会话右键菜单，与原生 `SessionNodeItem` 行为一致。
- **AC3**：当宿主组合缺少 `contextMenus` 服务时，优雅降级回本插件内置 `MenuLayer`，且 `bridge.archiveSession` 优先走 `uiWorkspace.archiveSession`；打开本插件项目/worktree `MenuLayer` 时关闭已打开的原生 `contextMenus`，避免双菜单重叠。
- **AC4**：当 `useWorkspaces` 快照就绪（`phase === 'ready'` 或省略 `phase`）时，侧栏即时采用 `workspacesSnapshot.archivedSessionIds` 驱动 `treeInput`、`observationsOf` 与 `mergeLiveSessions`；`phase === 'pending'` 时回退服务端 `archivedSessionIds`，不误清空。
- **AC5**：`workspacesSignature` 纳入 `archivedSessionIds` 变化，归档或取消归档（含撤销 Toast）均触发防抖 `reload()`，使服务端树与客户端状态保持一致。
- **AC6**：`tree-model.ts` 对 `archivedSessionIds` 的匹配按 `normalizeSessionId` 归一化，兼容有无 `session-` 前缀，覆盖工作区/worktree、未分组与「最近」分区。

### 非目标
- 不替换项目行与 worktree 行的自定义右键菜单（仍由本插件 `MenuLayer` 提供新建 worktree、移除 worktree、归档工作空间、恢复默认排序等专属能力）。
- 不新增会话行悬浮快捷按钮（本次聚焦右键菜单与单会话归档闭环）。

## 2. 计划与设计

1. **`src/live-merge.ts`**：
   - 新增纯函数 `resolveArchivedSessionIds(serverArchived, workspacesSnapshot)`：就绪态取 `workspacesSnapshot.archivedSessionIds`，pending/缺席回退 `serverArchived`。
   - 新增纯函数 `workspacesSnapshotSignature(workspacesSnapshot)`：编码 `items` + 排序后的 `archivedSessionIds` + `phase`。
   - `mergeLiveSessions` 接受可选第三参 `liveArchivedSessionIds`（缺省用 `tree.archivedSessionIds`），保证已归档会话不会落入 `pendingIds` / 新增行。
2. **`src/tree-model.ts`**：
   - 新增 `buildArchivedSet` / `isArchivedSession`（按 `normalizeSessionId` 归一化），统一用于 `isVisibleMember`、`observationsOf`、`effectiveOrder`、`buildRows`、`collectRecentSessions`。
3. **`src/client.tsx`**：
   - `SidebarBridge` 增加 `openSessionContextMenu(target)` 与 `closeContextMenu()`，经 `ctx.get('contextMenus')` 惰性调用，缺席返回 `false` / no-op。
   - `bridge.archiveSession` 优先调用 `uiWorkspace()?.archiveSession(sessionId)`，缺席再回退 `workspaces()?.archiveSession(sessionId)`。
4. **`src/sidebar.tsx`**：
   - 使用 `workspacesSnapshotSignature` 与 `resolveArchivedSessionIds`，将其接入 `mergeLiveSessions`、`observationsOf` 与 `treeInput.archivedSessionIds`。
   - `SessionRowViewInner` 对 `row.blank` 放行原生行为，对非空白会话行响应 `onContextMenu`（含键盘触发的 `(0, 0)` 坐标回退元素边界）及 `ContextMenu` / `Shift+F10` 快捷键。
   - `sessionHandlers.onMenu` 优先走 `actions.openSessionContextMenu(...)` 并关闭 `MenuLayer`；返回 `false` 时降级 `openMenu({ kind: 'session', ... })`。
   - `openMenu` 打开项目/worktree 菜单前调用 `actions.closeContextMenu()`。

## 3. 执行与验证记录（TDD Red → Green）

### 变更文件
- `src/live-merge.ts`：新增 `resolveArchivedSessionIds`、`workspacesSnapshotSignature`，`mergeLiveSessions` 支持传入实时 `liveArchivedSessionIds`。
- `src/tree-model.ts`：新增 `buildArchivedSet` / `isArchivedSession`（按 `normalizeSessionId` 归一化 `session-` 前缀），统一接入 `observationsOf`、`isVisibleMember`、`effectiveOrder`、`buildRows`、`buildRecentRows`。
- `src/client.tsx`：`SidebarBridge` 新增 `openSessionContextMenu`（委托 `ctx.get('contextMenus').open({ kind: 'session', value: { sessionId, displayTitle } }, { x, y })`）与 `closeContextMenu`；`archiveSession` 优先走 `uiWorkspace.archiveSession` 再回退 `workspaces.archiveSession`。
- `src/sidebar.tsx`：
  - `SessionRowViewInner` 增加 `row.blank` 保护、`(0, 0)` 坐标回退元素边界、以及 `ContextMenu` / `Shift+F10` 键盘呼出。
  - `SidebarBrowserInner` 接入 `workspacesSnapshotSignature`、`resolveArchivedSessionIds`（同步到 `mergeLiveSessions`、`observationsOf`、`treeInput` 与 `planNewSessionInserts`）。
  - 会话行右键优先调用 `actions.openSessionContextMenu`，返回 `false` 时降级自绘 `MenuLayer`；打开项目/worktree 自绘菜单前调用 `actions.closeContextMenu()`。
- 测试：`test/live-merge.test.mjs`、`test/tree-model.test.mjs`、`test/client-context-menu.test.mjs`（新增）、`test/sidebar-wiring.test.mjs`、`test/sidebar-perf-wiring.test.mjs`。

### TDD Red → Green 证据
1. **循环 1（`live-merge` 实时归档解析与签名）**：
   - Red：`node --test test/live-merge.test.mjs` → 失败（`SyntaxError: does not provide an export named 'resolveArchivedSessionIds'`）。
   - Green：`npm run build && node --test test/live-merge.test.mjs` → 10/10 通过。
2. **循环 2（`tree-model` 归档 id 前缀归一化）**：
   - Red：`node --test --test-name-pattern="2026-11-24/AC6" test/tree-model.test.mjs` → 失败（`actual` 未过滤 `arch2` / `session-arch1` / `session-u-arch`）。
   - Green：`npm run build && node --test --test-name-pattern="2026-11-24/AC6" test/tree-model.test.mjs` → 1/1 通过。
3. **循环 3（客户端桥接与侧栏接线）**：
   - Red：`node --test test/client-context-menu.test.mjs` 与 `node --test --test-name-pattern="2026-11-24/AC1-AC5" test/sidebar-wiring.test.mjs` → 4/4 失败（`bridge.openSessionContextMenu` 为 `undefined`、`archiveSession` 未优先调 `uiWorkspace.archiveSession`、`sidebar.tsx` 未 import `resolveArchivedSessionIds`）。
   - Green：`npm run typecheck && npm run build && node --test test/client-context-menu.test.mjs && node --test --test-name-pattern="2026-11-24/AC1-AC5" test/sidebar-wiring.test.mjs` → 4/4 通过。
4. **全量回归与类型检查**：
   - `npm run typecheck && npm test` → 类型检查 0 错误，构建通过，全量测试 **562 pass / 0 fail / 4 skipped**（4 条 skip 为既有旧 `/Applications/DSH Desktop.app` 路径漂移哨兵）。

## 4. 结果与后续
- 已完成本仓库构建产物（`lib/`）更新与全量自动化验证。
- **未执行项 / 人工验证说明**：当前会话未做浏览器内 GUI 实操点击验证；若本插件已安装到当前 DSH profile，需重新安装/刷新插件并在 DSH 侧栏右键任意非空白会话，验证弹出原生菜单（置顶、重命名、创建分支、复制会话 ID、归档及运行中会话二次确认/撤销 Toast）且归档后会话立即消失。
