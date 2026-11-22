# 需求：归档工作空间（含设置页恢复与重添自动放出）、打开对话选中效果与侧栏底部「最近」分区

- **日期**：2026-10-21
- **状态**：已确认（用户经 `/grill-with-docs` 拍板并修订需求 1 为「归档工作空间」）
- **相关文档**：
  - [领域术语表（CONTEXT.md）](../../CONTEXT.md)
  - [设计文档](../design/2026-10-21-workspace-delete-selection-recent.md)
  - [工作记录](../worklog/2026-10-21-workspace-delete-selection-recent.md)
  - [PRD §13](../PRD.md)
  - [接口契约 §1.4 / §1.5 / §2.1 / §2.2 / §2.3 / §2.3.2](../INTERFACES.md)

## 1. 背景与问题

1. **Workspace 需支持「归档工作空间」与恢复管理**：
   - 用户希望将工作空间的“删除”改为**「归档工作空间」**：点击后直接将该工作空间归档隐藏（无需二次确认弹窗），归档期间该工作空间及其下的会话均在侧栏（工作区树、未分组、最近）中隐藏，不销毁底层工作区注册、磁盘文件与会话记录。
   - 已归档的工作空间可以在 **DSH 设置 → 通用** 页面中查看并点击**「放出」**恢复到侧栏。
   - 如果用户在首页或侧栏重新添加相同目录（或同 Git 仓下的目录）作为工作空间，则**自动从已归档中放出来**。
2. **打开对话时无选中效果**：
   - 宿主升级至 `0.2.1-rc.2` 后，`useSessions` 快照移除了顶层 `current` 字段，改为在 `byId[id].retainedBy.mainView > 0` 上标记当前主视图打开的会话（并受 `usePanelInfo` 的 `activePanelId` 约束）。
   - `src/sidebar.tsx` 仍只读 `sessionsSnapshot?.current`（恒为 `undefined`），导致 `row.isCurrent` 恒为 `false`。
   - 此外，旧 `rowStyle` 在 `active = true` 时仅复用了与 `hovered` 相同的浅灰背景，缺乏明确视觉区分。
3. **缺少参考 ChatGPT App 的底部「最近」会话区**：
   - 用户希望在左边栏最下方增加「最近」分区，与上方工作区保持明显间距，按最近活跃时间（`updatedAt`）倒序展示全局最近活跃的会话（最多 100 个），方便跨工作区快速切换近期对话。

## 2. 用户已确认决策（WSR1–WSR6）

| 编号 | 议题 | 确认结论 |
| --- | --- | --- |
| **WSR1** | 归档工作空间入口与直接归档 | 顶层「git 项目行」和「非 git 工作区行」的 `…` 菜单与右键菜单均提供「归档工作空间」（非 git 行补齐 hover `…` 按钮及「重命名工作区」；`未分组` 行不显示）；点击后**直接归档**，无需二次确认弹窗。 |
| **WSR2** | 归档语义、设置页管理与重添自动放出 | ① 归档状态持久化在台账 `worktree-groups.json` 的 `archivedProjects` 中，保留宿主 `workspaceRegistry` 记录不销毁；归档期间该工作空间及其会话从工作区树、`未分组` 和 `最近` 中一并隐藏；② 在 DSH「设置 → 通用」（`settings.general.item`）中挂载「已归档的工作空间」管理区，支持点击「放出」恢复；该管理区标题行支持点击折叠/展开下方已归档工作空间列表，**默认折叠**（显示已归档数量与 `chevronRight` / `chevronDown` 箭头，点击后展开下方列表或空态提示）；③ 在首页或侧栏重新添加相同目录（或同 Git 仓库目录）作为工作空间时，**自动解除归档并放出来**。 |
| **WSR3** | 打开对话选中态数据源 | 兼容宿主 `0.2.1-rc.2` 的 `byId[id].retainedBy.mainView > 0`（结合 `usePanelInfo` 判断 `activePanelId === null`）、旧版 `sessionsSnapshot.current`、以及点击打开会话时的乐观选中 ID；`tree-model.ts` 比对 `currentSessionId` 时统一做 `session-` 前缀归一化。 |
| **WSR4** | 打开对话选中态视觉样式 | 采用高对比度选中背景色 + 左侧 3px 品牌色竖条指示器 + `fontWeight: 600` 加粗，并输出 `aria-current="true"` 与 `data-selected="true"`，与普通 hover 明显区分。 |
| **WSR5** | 「最近」分区的收录范围与「未分组」关系 | **全局汇总 + 保留「未分组」**：「最近」汇总全局所有未归档工作空间及未分组的可见主会话（排除子代理、已归档会话、已归档工作空间的会话、非当前 blank 会话，按 `sessionId` 去重），工作区列表末尾仍保留 `未分组` 折叠行。 |
| **WSR6** | 「最近」分区的展示与交互 | 位于侧栏最下方，与工作区列表留出明显间距（约 18px）；标题「最近」可点击整体折叠/展开（默认展开，不做 5 条截断），按 `updatedAt` 倒序展示最多 **100** 个会话（`RECENT_SESSION_LIMIT = 100`）；行不可拖拽，保留状态点、子代理计数、右键菜单，并与上方工作区对应会话行同步选中高亮。 |

## 3. 验收标准（AC1–AC12）

| 编号 | 验收标准 | 验证方式 |
| --- | --- | --- |
| **AC1** | `src/locales.ts` 包含新增词条：`section.recent`（「最近」）、`menu.archiveWorkspace`（「归档工作空间」）、`settings.archivedWorkspaces.title`（「已归档的工作空间」）、`settings.archivedWorkspaces.description`、`settings.archivedWorkspaces.empty`、`settings.archivedWorkspaces.restore`（「放出」）。 | 单元测试（`test/locales.test.mjs`） |
| **AC2** | `currentSessionIdOf` 能从 `0.2.1-rc.2` 的 `byId[*].retainedBy.mainView > 0` 解析当前会话 ID；当 `panelInfo.activePanelId !== null` 时返回 `undefined`；支持旧版 `current` 字段与乐观选中回退。 | 单元测试（`test/live-state.test.mjs`） |
| **AC3** | `buildRows` 对 `currentSessionId` 执行 `session-` 前缀归一化比对：无论传入裸 ID 还是带前缀 ID，对应会话行的 `isCurrent` 均为 `true`（树行与「最近」行同步为 `true`），且当前 blank 会话正常豁免显示。 | 单元测试（`test/tree-model.test.mjs`） |
| **AC4** | `buildRows`（`includeRecent: true`）在非搜索模式下，当存在至少 1 条可见主会话时，在末尾（`未分组` 之后）输出 `kind: 'recent'` 分区头（`key: 'r:__recent__'`）及其下按 `updatedAt` 降序排列的会话行（`key: 'rs:<sessionId>'`，`parentKey: 'r:__recent__'`，`parentKind: 'recent'`，`depth: 1`）。 | 单元测试（`test/tree-model.test.mjs`） |
| **AC5** | 「最近」分区最多输出 `RECENT_SESSION_LIMIT = 100` 条会话，不产生 `more` 行（不做 5 条截断），排除子代理、归档会话与非当前 blank 会话，且按归一化 `sessionId` 去重。 | 单元测试（`test/tree-model.test.mjs`） |
| **AC6** | 当 `collapsedKeys['r:__recent__'] === true` 时，「最近」分区头 `expanded === false`，不输出其下的 `rs:*` 会话行；搜索模式（`query` 非空）不输出 `recent` 分区。 | 单元测试（`test/tree-model.test.mjs`） |
| **AC7** | `POST /dsh-worktree-groups/tree`（请求体 `{ archiveProjectKey }`，由导出函数 `archiveWorkspaceProject` 实现）将指定 `projectKey` 记入台账 `archivedProjects`；`buildTreePayload` 返回的 `projects` 排除已归档工作空间、其会话不落入 `ungrouped`，并在 `archivedProjects` 字段中返回已归档列表。同一路由的 `{ unarchiveProjectKey }` / `{ unarchivePath }`（由导出函数 `unarchiveWorkspaceProject` 实现，按 `projectKey` 或 `path`）及重新添加相同目录（`workspace-open` / `workspaceRegistry.create`）会自动从 `archivedProjects` 移除并完整恢复该工作空间与会话；客户端以 `localStorage` 键 `dsh-worktree-groups.archivedProjects` 与服务端台账双写同步。**不新增独立路由**（`ROUTE_PATHS` 恒为 5 个路径）。 | 集成测试（`test/routes.test.mjs`） |
| **AC8** | 顶层 git 项目行与非 git 工作区行（排除 `未分组`）均提供 `…` 动作按钮及「归档工作空间」菜单项，点击后直接向 `POST /dsh-worktree-groups/tree` 发送 `{ archiveProjectKey }` 并刷新（同时写入 `localStorage` `dsh-worktree-groups.archivedProjects`）；`client.tsx` 在 `settings.general.item` 注册已归档工作空间管理组件，支持点击「放出」向同一路由发送 `{ unarchiveProjectKey }`。设置项「已归档的工作空间」标题行支持点击折叠/展开，**默认折叠**（`useState(false)`）：标题行带 `role="button"`、`tabIndex=0`、`'aria-expanded': expanded`、数量徽章及 `expanded ? chevronDown : chevronRight` 箭头，支持 Enter/Space 键切换；下方列表/空态仅在 `expanded === true` 时渲染。 | AST / 接线测试（`test/sidebar-wiring.test.mjs`） |
| **AC9** | 选中会话行（`row.isCurrent === true`）渲染 `aria-current="true"`、`data-selected="true"`、左侧选中指示条及加深选中底色。 | AST / SSR 测试（`test/sidebar-wiring.test.mjs`、`test/render-smoke.test.mjs`） |
| **AC10** | 「最近」分区会话行（`row.parentKind === 'recent'`）不启用拖拽（`drag` 为 `undefined`），但保留打开会话、状态点、子代理胶囊与右键菜单。 | AST / 接线测试（`test/sidebar-wiring.test.mjs`） |
| **AC11** | 全量 `npm run typecheck`、`npm run build`、`npm test` 全部通过，零回归。 | 命令行实测 |
| **AC12** | 重建客户端与宿主产物后，在 DSH GUI 中人工确认工作空间归档/设置页放出/重添自动放出、对话选中高亮与底部「最近」分区视觉效果。 | 人工验收 |
