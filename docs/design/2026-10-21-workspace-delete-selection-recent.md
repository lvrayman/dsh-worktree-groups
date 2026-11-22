# 设计：归档工作空间（含设置页恢复与重添自动放出）、打开对话选中效果与侧栏底部「最近」分区

- **日期**：2026-10-21
- **状态**：已定稿
- **需求依据**：[2026-10-21 需求与验收标准](../requirements/2026-10-21-workspace-delete-selection-recent.md)

## 1. 宿主与代码基线事实

1. **宿主 `0.2.1-rc.2` 当前会话事实源变化**：
   - `dsh-api-session-controller/lib/client.js:3814`：`ClientSessions.list` 快照结构为 `{ ids, byId, phase, projectionsBySession }`，已移除 `0.1.5-rc.2` 时代的顶层 `current` 字段。
   - `dsh-client-ui-workspace/lib/client.js:866, 3025-3027`：原生侧栏通过 `usePanelInfo((info) => info.activePanelId !== null)` 判断主视图是否被其它面板占据；未占据时取 `Object.values(list.byId).find((s) => (s.retainedBy?.mainView ?? 0) > 0)?.id`。
2. **宿主设置面板扩展点**：
   - `dsh-client-ui-settings-general/lib/client.js:1329`：「设置 → 通用」分区声明了 `settings.general.item`（`kind: 'list'`, `scope: 'root'`），各插件（如 `ui-chat`、`ui-conversation`、`ui-shortcuts`）均通过 `ctx.slots.inject('settings.general.item', () => ctx.slots.register({ name: 'settings.general.item', id, order, locale }, Component))` 挂载设置项。
3. **宿主 `workspaceRegistry.create(path)` 行为**：
   - `dsh-workspace/lib/index.js:408-412`：用户在首页（Hero 区「打开文件夹」）或侧栏顶部 `+` 选择目录添加工作空间时，均调用 `workspaceRegistry.create(path)`；若该路径此前已注册过，宿主返回原实体并将其移回 `workspaceIds` 首位。

## 2. 模块设计

### 2.1 `src/locales.ts`：新增词条

在 `zh` 词条表中新增：
- `'section.recent': '最近'`
- `'menu.archiveWorkspace': '归档工作空间'`
- `'settings.archivedWorkspaces.title': '已归档的工作空间'`
- `'settings.archivedWorkspaces.description': '归档后的工作空间及其会话不在侧栏显示，可在此放出恢复，或重新添加相同目录自动放出'`
- `'settings.archivedWorkspaces.empty': '暂无已归档的工作空间'`
- `'settings.archivedWorkspaces.restore': '放出'`

### 2.2 `src/live-state.ts`：`currentSessionIdOf` 纯函数

- 解析优先级：
  1. `panelInfo.activePanelId !== null && activePanelId !== undefined` ⇒ `undefined`；
  2. `sessions.byId` 中 `retainedBy.mainView > 0` 的条目 id；
  3. `sessions.current`（旧版兜底）；
  4. `optimisticSessionId`（点击打开会话时的即时乐观选中兜底）。

### 2.3 `src/tree-model.ts`：选中 ID 归一化与「最近」分区

- 导出 `RECENT_SESSION_LIMIT = 100`、`RECENT_KEY = '__recent__'`、`buildRecentRows(input)`。
- `RenderRow` 新增 `kind: 'recent'` 分区头，会话行 `parentKind` 扩展支持 `'recent'`（`key: 'rs:<sessionId>'`，`parentKey: 'r:__recent__'`，`depth: 1`）。
- `SidebarModelInput` 新增可选 `includeRecent?: boolean`（`sidebar.tsx` 恒传 `true`；缺省不追加，保持既有 250+ 条树单测零回归）。
- `isCurrentSession` 统一对 `sessionId` 与 `currentSessionId` 执行 `session-` 前缀归一化比较，树行与「最近」行同步高亮。

### 2.4 `src/ledger.ts` 与 `src/routes.ts`：归档工作空间持久化与自动放出

#### 2.4.1 台账结构扩展（`src/ledger.ts` / `src/types.ts`）
- `LedgerData` 新增可选映射 `archivedProjects?: Record<string, LedgerArchivedProject>`：
  ```ts
  export interface LedgerArchivedProject {
    title: string
    path?: string
    isGit: boolean
    archivedAt: number
  }
  ```
- `ArchivedProjectRow`（`/tree` 响应中的已归档工作空间摘要）：
  ```ts
  export interface ArchivedProjectRow {
    key: string
    title: string
    path?: string
    isGit: boolean
    archivedAt: number
  }
  ```

#### 2.4.2 树构建与会话隐藏（`buildTreePayload`）
1. `buildProjects(input)` 先对**全量**项目计算归属，再调用 `collectUngrouped(input, allProjects)`：
   - 这样归属到「已归档工作空间」的会话已经被该工作空间认领，**绝不会漏进 `ungrouped`（未分组）**！
2. 随后根据 `ledger.archivedProjects` 将 `allProjects` 拆分为：
   - `projects`：未归档的工作空间（返回给侧栏渲染工作区树与「最近」分区 —— 因此已归档工作空间的会话也自动不进入「最近」分区）；
   - `archivedProjects`：已归档的工作空间列表（按 `archivedAt` 降序，供设置页展示与管理）。

#### 2.4.3 路由（复用 `POST /tree`）与首页重添自动放出
- **不新增独立路由**：归档 / 放出复用既有 `POST /dsh-worktree-groups/tree`，通过可选请求体字段触发，
  `ROUTE_PATHS` 保持 5 个路径（`tree` / `worktree-create` / `worktree-remove` / `reveal` / `workspace-open`）。
  - 归档：请求 `{ archiveProjectKey }`，由导出函数 `archiveWorkspaceProject(ctx, projectKey)` 校验 `projectKey`
    属于当前已知项目后写入 `ledger.archivedProjects[projectKey]`（保留宿主 `workspaceRegistry` 记录不销毁）。
  - 放出：请求 `{ unarchiveProjectKey }` 或 `{ unarchivePath }`，由导出函数
    `unarchiveWorkspaceProject(ctx, { projectKey, path })` 按 `projectKey` 或路径（匹配项目的 `mainPath` /
    `worktrees[*].path` / 非 git 工作区 `path`，含 `realpath` 与同 git 仓 worktree 路径）从
    `ledger.archivedProjects` 中移除对应条目。
  - 两种情况都在动作完成后返回同一份 `buildTreePayload` 载荷
    `{ ok: true, projects, ungrouped, archivedSessionIds, workspaceByPath, archivedProjects }`；
    失败返回 `{ ok: false, message }`（HTTP 400）。
- **客户端双写同步**：`src/sidebar.tsx` 维护 `localStorage` 键 `dsh-worktree-groups.archivedProjects`
  （`readArchivedProjectsMap` / `writeArchivedProjectsMap`），与服务端台账 `archivedProjects` 双写；
  客户端点击「归档工作空间」或「放出」时先在本地映射表生效并广播刷新，再向 `POST /tree` 发送
  `{ archiveProjectKey }` / `{ unarchiveProjectKey }`，因此即使宿主进程尚未重启也能立即隐藏/恢复。
- **首页/侧栏重新添加相同目录自动放出**：
  1. `POST /dsh-worktree-groups/workspace-open`（`{ path }`）在创建/打开工作区时，自动解除匹配该 `path`（或同 git `commonDir`）的 `ledger.archivedProjects` 条目；
  2. `registerRoutes(ctx)` 在宿主侧包装 `workspaceRegistry.create(path, title)`（幂等 guard，保留原方法行为并在其成功后异步触发 `unarchiveByPath(ctx, path)`），使无论从**首页 Hero「打开文件夹 / 添加工作区」**还是**侧栏顶部 `+`** 重新添加相同目录，都自动从已归档中放出来；
  3. 客户端 `bridge.createWorkspace(path)` 在调用 `workspaces.create({ path })` 后同步向 `POST /dsh-worktree-groups/tree` 发送 `{ unarchivePath: path }` 并广播刷新事件，确保侧栏立即展现恢复后的工作空间。

### 2.5 `src/sidebar.tsx` 与 `src/client.tsx`：UI 接线与设置页组件

1. **侧栏菜单「归档工作空间」**：
   - git 项目行与非 git 工作区行（非 git 行补齐 hover `…` 按钮与「重命名工作区」）菜单底部提供「归档工作空间」（`MENU.archiveWorkspace`，`icon('archive')`）。
   - 点击后直接向 `POST /dsh-worktree-groups/tree` 发送 `{ archiveProjectKey }` 并 `reload()`（无弹窗），同时把该工作空间写入 `localStorage` 键 `dsh-worktree-groups.archivedProjects`（双写同步）。
2. **设置 → 通用「已归档的工作空间」管理卡片（`ArchivedWorkspacesSettingItem`）**：
   - 在 `src/client.tsx` 中通过 `ctx.slots.inject('settings.general.item', () => ctx.slots.register({ name: 'settings.general.item', id: 'archived-workspaces', order: 90, locale: LOCALE_NS }, ArchivedWorkspacesSettingItem))` 注册。
   - 组件挂载及收到归档变更通知时拉取 `POST /dsh-worktree-groups/tree` 读取 `archivedProjects`；
   - 标题行可点击折叠/展开，**默认折叠**（`const [expanded, setExpanded] = useState(false)`）：标题行设 `role: 'button'`、`tabIndex: 0`、`cursor: 'pointer'`、`'aria-expanded': expanded`，右侧展示已归档数量徽章与 `expanded ? icon('chevronDown') : icon('chevronRight')` 箭头，并支持 Enter/Space 键切换（`onKeyDown` 内 `preventDefault()` 后切换）；下方列表区使用 `expanded ? (items.length === 0 ? 空态 : 列表) : null`，折叠时不渲染；
   - 展开后为空时显示「暂无已归档的工作空间」；非空时列出每个已归档工作空间的名称、路径与「放出」按钮；
   - 点击「放出」向 `POST /dsh-worktree-groups/tree` 发送 `{ unarchiveProjectKey }`（并同步清除 `localStorage` 中对应条目），刷新本列表并通过模块内事件通知 `SidebarBrowser` 立即 `reload()`。
3. **对话选中效果与「最近」分区渲染**：
   - `SessionRowView` 在 `row.isCurrent === true` 时应用加深选中背景、600 字重、左侧 3px 品牌色竖条、`aria-current="true"` 与 `data-selected="true"`。
   - `row.kind === 'recent'` 渲染带 `marginTop: 18` 与顶部分隔线的「最近」可折叠分区头；`row.parentKind === 'recent'` 的会话行不挂拖拽（`drag: undefined`），其余交互与状态点完全一致。
