---
生成时间: 2026-09-22
更新时间: 2026-09-22
git-version: 9bd94252dd934c2fa8491977285e461b703f0f3e
git-module-path: src
level: L3
---

> ⚠️ **2026-10-19 定点修订**：宿主 `primitives` 升到 `0.2.1-rc.2` 后图标导出从尺寸后缀
> （`IconPlusOutline16`）改成线重后缀（`IconPlusOutlineRegular`/`Medium`），本文件描述的
> 渲染层原有 **17 处 `P.Icon*` 直接取用全部变成 `undefined`**，渲染期抛
> `Element type is invalid` ⇒ 侧栏整块失败。现在**所有图标一律经 `icon(name, props?)`**
> （内部走 `src/icons.ts` 的 `resolveIcon`，新旧命名都认、全缺回落空图标）。
> 下文出现的 `P.IconXxx16` 均为**历史写法**，不代表现行实现；现行契约见
> `INTERFACES.md` §2.3.0 与 [Icons技术文档](./Icons技术文档.md)。
> 证据：`docs/worklog/2026-10-19-sidebar-render-failure-icons.md`。
>
> 同轮第 2 处修正：会话行 live fact 的取数**已移出本文件**，改由纯逻辑模块
> `src/live-state.ts` 提供（宿主删除了 `useSessionPendingInteraction` 与 `byId.completed`，
> 现行来源是 `useSessionStatus`）。见 [LiveState技术文档](./LiveState技术文档.md)。

# SidebarBrowser 技术文档

> **文件路径**: `src/sidebar.tsx`

> ⚠️ **2026-10-22 定点修订**：`SidebarBridge.startSession` 增加可选第二参 `options`
> （`export interface StartSessionOptions`）并新增常量 `SAME_LOCATION_START_SESSION`
> （`{ clearPreviousDraft: false }`）；`newSession` 与其余三个「新建会话」入口都改传该常量，
> 用于修「切换会话后再点新建会话，未发送草稿丢失」（DSH 草稿按会话 id 存，宿主只有收到
> 第二参才按 cwd 复用空白会话）。行号已按当前文件重标（如 `newSession` 1778 → 2198）。
> 契约见 `INTERFACES.md` §2.3「同位置新建会话必须复用空白会话」，缺陷记录见
> `docs/worklog/2026-10-22-new-session-draft-retention.md`。
>
> 同轮第三次定点修订（DR6，用户报告「没法拖动工作区进行排序」）：`commitDrag` 三层换算由
> 直接 `reorderKeys` 改为 `reorderManualScope`（先与默认顺序对齐，补齐持久表外的**新增项**）。
> 旧的直接换算在陈旧持久表上会因「拖拽源/落点不在表里」返回 `null` ⇒ 拖拽静默无效。
> 见 `docs/worklog/2026-10-22-sidebar-reorder-stale-order.md`。
>
> 同轮第二次定点修订（DR5，复验「新会话掉到最下面」之后）：会话行拖拽判据由
> `!isTopZoneRunningSession(row, topZone)` 改为 `!isSessionDragLocked(row, topZone)`
> （= 运行中 ∪ **当前空白占位行**）。占位行被 `tree-model.ts` 的 `emitContainer` 钉在容器
> 最前，允许起拖只会「拖完弹回」。见本文「行渲染 / 拖拽」相关段落与
> `INTERFACES.md` §2.3.1。
>
> ⚠️ **2026-09-23 局部修订**：取词入口由「直接透传宿主 seat `props.t`」改为
> 「`createSeatT(props.t)` 兜底」（见「构造参数与依赖」的 `t` 行与「执行流程」第一行），
> 用于修「右键菜单渲染裸 key」缺陷。frontmatter 的 `git-version` 仍为知识库生成时的
> `9bd9425`，**未标注修订的行号锚点均对应旧版本**（文件已加长）。缺陷记录见
> `docs/worklog/2026-09-23-sidebar-menu-raw-keys.md`。

## 目录

- [概述](#概述)
- [构造参数与依赖](#构造参数与依赖)
- [核心方法签名](#核心方法签名)
- [执行流程](#执行流程)
- [状态机](#状态机)
- [并发与线程模型](#并发与线程模型)
- [边界条件](#边界条件)
- [代码示例](#代码示例)
- [已知缺陷与注意事项](#已知缺陷与注意事项)
- [相关文档](#相关文档)

## 概述

`src/sidebar.tsx`（2895 行）是 `dsh-worktree-groups` 插件的**侧栏渲染层唯一实现**：以
`priority: -1` 抢占宿主 `sidebar.workspaces` 槽位，把会话按「项目 → worktree → 会话」三级
树画出来，并提供搜索、展开态持久化、三层拖拽排序、右键菜单与三个弹窗。

核心特性（每条均可在源码定位）：

1. **只画行，不做树推导**。展开态、5 条截断（含 `expandedAll` 的「收起」more 行）、搜索扁平化、
   子代理深度、未分组容器全部由 `src/tree-model.ts` 的 `buildRows()` 推导（文件头注释
   `src/sidebar.tsx:9-11`）。本文件只把 `RenderRow` 画成 DOM。
2. **三层拖拽排序，范围约束在类型与计算两侧同时成立**。`DragState`（`src/sidebar.tsx:550`）携带
   `containerKey` / `projectKey` 作为范围载体，`accepts()`（`src/sidebar.tsx:2081`）决定是否
   画插入线与 `preventDefault`，`commitDrag`（`src/sidebar.tsx:2004`）在计算侧再兜一层
   （跨范围时换算找不到落点 ⇒ 返回 `null` ⇒ 不写任何东西；换算入口是 `reorderManualScope`，见 DR6）。
3. **零全局样式注入**。全部样式内联（`rowStyle`/`iconButtonStyle`/`fieldStyle`/`dimText`/
   `pillStyle`，`src/sidebar.tsx:634-703`），hover 态由 React state 表达，避免宿主换 CSS 变量后污染整页
   （文件头注释 `src/sidebar.tsx:14-15`）。
4. **自带错误边界**（`SidebarBoundary`，`src/sidebar.tsx:1479`）。异常不让它逃到宿主
   `SlotErrorBoundary`，否则宿主会 `abdicate` 本 entry 并投影回官方 `ui-workspace`
   （文件头注释 `src/sidebar.tsx:16-18`；PRD R2）。
5. **不写 JSX 语法**。`react/jsx-runtime` 是 esbuild external，直接 import `jsx`/`jsxs`
   并重新标注为宽松签名 `JsxLike`（`src/sidebar.tsx:71-95`）；`key` 由 `splitKey`
   （`src/sidebar.tsx:80`）在边界处从 props 摘出交给第三参。
6. **数据面 = HTTP 取树 + 宿主快照订阅**。树走 `POST /dsh-worktree-groups/tree`，
   `useSessions`/`useWorkspaces`/`useSessionPendingInteraction` 三个 root source 只用于驱动重取
   与补 live fact（`src/sidebar.tsx:1601-1607`）。

## 构造参数与依赖

### props（槽位注入契约）

`SidebarProps = Record<string, unknown>`（`src/sidebar.tsx:101`）——**故意宽松**，组件内按需收窄。
逐项读取点与语义：

| prop | 读取点 | 类型/取值 | 缺失行为 |
|---|---|---|---|
| `t` | `src/sidebar.tsx:1576`（旧锚点） | `(key, vars?) => string` | **2026-09-23 修订**：宿主 seat 先过 `createSeatT` 兜底（解不出就回落内置 `zh`，见 `src/locales.ts`）；`props.t` 完全缺失时退 `FALLBACK_T`（`createT(zh)`，`src/sidebar.tsx:136`） |
| `bridge` | `src/sidebar.tsx:1577` | `SidebarBridge`（`src/sidebar.tsx:109`） | `undefined` ⇒ 动作面全部降级为 no-op |
| `wide` | `src/sidebar.tsx:1579` `readBoolean` | `boolean` | 非 `false` 一律按展开态渲染（`src/sidebar.tsx:2135`） |
| `expandSidebar` | `src/sidebar.tsx:1580` `readFunction` | `() => void` | 轨道态按钮点击无动作 |
| `renderSlot` | `src/sidebar.tsx:1581` `readFunction` | `(key) => ReactNode` | 不挂载自建子槽位（`src/sidebar.tsx:2510`） |
| `useSessions` | `src/sidebar.tsx:1594` | 选择器 hook | 用 `directSource` 占位（`src/sidebar.tsx:1559`）⇒ 恒 `undefined` |
| `useWorkspaces` | `src/sidebar.tsx:1595` | 选择器 hook | 同上 |
| `useSessionPendingInteraction` | `src/sidebar.tsx:1596` | 选择器 hook | 同上 |
| `open` / `startSession` / `renameSession` / `archiveSession` / `forkSession` / `renameWorkspace` | `src/sidebar.tsx:1697-1727` | 函数 | 回退到 `bridge` 同名方法 |
| `hostInfo` 等其余值对象 | 不读 | — | 盲转函数会 TypeError，故有 `readFunction` 守卫（`src/sidebar.tsx:202-212`） |

三个 source 在**首渲染用 `useRef` 冻结**（`src/sidebar.tsx:1591-1599`）：`props.useSessions` 若在
两帧间从函数变 `undefined`，`useSyncExternalStore` 内部 hook 数量会变化，触发
"Rendered fewer hooks than expected"（注释 `src/sidebar.tsx:1587-1590`）。

### 宿主客户端 API 依赖

| 依赖 | 位置 | 用途 |
|---|---|---|
| `POST /dsh-worktree-groups/tree` | `ROUTE_TREE` `src/sidebar.tsx:165`，调用 `src/sidebar.tsx:1652` | 拉取树数据（`TreeResponse`，`src/sidebar.tsx:710`） |
| `workspace-open` / `worktree-create` / `worktree-remove` / `reveal` | `src/sidebar.tsx:166-169` | 懒注册（D5）、建/删 worktree、文件管理器打开 |
| `localStorage` | 键 `dsh-worktree-groups.collapsed` / `.expandedAll` / `.order`（`src/sidebar.tsx:143-150`） | 展开态与手动排序持久化，读写全 `try/catch` |
| `window` `focus` 事件 + `setInterval` | `src/sidebar.tsx:1686-1691` | 30s 轮询 + 聚焦强刷（D13） |
| `AbortController` | `src/sidebar.tsx:1647-1651` | 取树竞态取消 |
| `P.writeClipboard` / `navigator.clipboard` | `copyText` `src/sidebar.tsx:322-332` | 复制路径（回退链） |
| primitives 值导出 | `P` `src/sidebar.tsx:57` | `StateDot` / `Modal` / `Menu` / `Button` / 各 `Icon*` |

`@deepseek-ai/dsh-client-ui-primitives` **无 `.d.ts` 可从本包解析**（契约 §2.5 第 3 条），
故 `P: any`，只 import 值（文件头注释 `src/sidebar.tsx:22-23`）。

### 被谁装配

`src/client.tsx` 的 `apply(ctx)`（`src/client.tsx:219`）在 `slots.inject('sidebar.workspaces', …)`
后 `slots.register({ name, priority: -1, children: { [DIRECTORY_FLOW_SLOT]: {kind:'single', scope:'root'} }, locale: LOCALE_NS, inject: () => ({ bridge }) }, SidebarBrowser)`
（`src/client.tsx:240-256`）。`bridge` 由 `createBridge(ctx)`（`src/client.tsx:122`）用惰性
`ctx.get()` 包出 8 个方法，服务缺席时降级不抛（R6）。

## 核心方法签名

### 导出符号

| 签名（`src/sidebar.tsx` 行号） | 返回值 | 副作用 |
|---|---|---|
| `export function SidebarBrowser(props: SidebarProps): ReactNode`（1534） | 错误边界包裹的侧栏 | 无（仅组合 `SidebarBoundary` + `SidebarBrowserInner`） |
| `export interface SidebarBridge`（`2026-10-22` 修正后位于 `:197`） | — | 8 个方法：`pickDirectory(): Promise<string\|null>`、`createWorkspace(path): Promise<void>`、`renameWorkspace(id,title)`、`deleteWorkspace(id)`、`openSession(id): void`、`startSession(workspaceId, options?: StartSessionOptions): void`（2026-10-22 起接受第二参，必须原样转发）、`renameSession(id,title)`、`archiveSession(id)`、`forkSession(id)` |
| `export interface StartSessionOptions`（`2026-10-22` 新增，`:169`） | — | `{ clearPreviousDraft?: boolean }`：宿主 `uiWorkspace.startSession` 的第二参；`false` = 复用同 cwd 空白会话并保留草稿 |
| `export const SAME_LOCATION_START_SESSION = { clearPreviousDraft: false }`（`2026-10-22` 新增，`:189`） | 起始会话入参常量 | 全部插件自有「新建会话」入口共用；见 `INTERFACES.md` §2.3 的 DR1 约束 |
| `export type SidebarProps = Record<string, unknown>`（101） | — | 无 |
| `export const DIRECTORY_FLOW_SLOT = 'sidebar.workspaces.worktreeDirectoryFlow'`（130） | 自建子槽位键 | 绝不能用官方 `sidebar.workspaces.directoryFlow`（同键重复声明抛错，`src/sidebar.tsx:124-129`） |
| `export const LOCALE_NS = 'dsh-worktree-groups'`（133） | locale 命名空间 | 与 `src/client.tsx:250` 的 `locale` 声明同源 |
| `export function defaultTitleOf(session: SessionRowLike): string`（2891） | 标题 → 目录 basename → sessionId | 无（纯函数） |

### 内部关键函数（`SidebarBrowserInner`，`src/sidebar.tsx:1575`）

| 签名 | 行号 | 语义 / 副作用 |
|---|---|---|
| `reload(): void` | 1648 | abort 上一次请求 → `fetch(ROUTE_TREE)`；成功 `setTree` + `setLoadError(null)`，失败 `setLoadError`；`signal.aborted` 时丢弃结果 |
| `toggleCollapsed(key)` / `expandKeys(keys)` / `toggleExpandedAll(key)` | 1744 / 1754 / 1767 | 改 `collapsedKeys` / `expandedAllKeys` 并 `writeFlagMap` 落盘；`expandKeys` 无变化时返回原引用（避免无谓重渲染） |
| `newSession(extra: WorktreeExtra)` | 2198（2026-10-22 前为 1778） | 未注册（`workspaceId === undefined`）先 `workspace-open` 拿 id，再 `actions.startSession(workspaceId, SAME_LOCATION_START_SESSION)`；最后 `reload()`；异常落 `loadError`。**2026-10-22 DR1**：第二参让宿主复用同 cwd 的空白会话，保留未发送草稿（单参会每次铸新会话、草稿被隐藏） |
| `addWorkspace()` | 1804 | `bridge.pickDirectory()` → `bridge.createWorkspace(path)` → `reload()`；`null`/空串直接返回 |
| `persistOrder(next: ManualOrder)` | 1960 | `setManualOrder` + `writeManualOrder`（内存 + `localStorage`） |
| `commitDrag(active: DragState, over: DropTarget): void` | 2004 | 用 `effectiveOrder({...treeInput, manualOrder: undefined})` 固化全量顺序；三层分支分别 `reorderManualScope(order, defaults, …)`（2026-10-22 DR6：**先对齐默认顺序再换算**，避免陈旧持久表让拖拽静默失效）；`null` ⇒ 不写（原地抖动不切手动模式） |
| `dragHandlersFor(row, scope, draggable = true): DragHandlers \| undefined` | 2065 | 造 `draggable/dragging/marker` + 4 个事件处理器；`scope === undefined` ⇒ `undefined`（该行不可拖也不接落点） |
| `openMenu(target: MenuTarget)` | 2162 | `setMenuTarget` |
| `pointOf(event, fallback): {x,y}` | 2165 | 按钮用 `fallback.getBoundingClientRect()`，右键用 `event.clientX/clientY` |
| `rowHalf(event: Any): DropHalf` | 599 | 指针在行上半 ⇒ `'before'`，下半 ⇒ `'after'`（逐字移植原生 `rowHalf`）；无 rect 时兜底 `'after'` |
| `dragLineStyle(half, indent): CSSProperties` | 613 | 插入线样式：`position:'absolute'` + `height:2` + `var(--dsw-alias-brand-primary)` + `pointerEvents:'none'`，`before` 贴 `top:-1` / `after` 贴 `bottom:-1` |
| `rowStyle(active, hovered, indent)` / `iconButtonStyle(visible)` / `fieldStyle()` / `dimText(size = 12)` / `pillStyle()` | 634 / 652 / 672 / 688 / 693 | 全内联样式工厂，不注入全局 `<style>` |

`dragHandlersFor` 第三个形参 `draggable`（默认 `true`）**有测试锁定**：
`test/sidebar-wiring.test.mjs:333` 断言「恰好 3 个形参，第 3 个默认 `true`」，
`:383` 断言 session 行传入 `!isTopZoneRunningSession(row, topZone)`。

### 行组件与弹窗 props

| 组件（行号） | props 关键字段 | 返回值 |
|---|---|---|
| `ContainerRowView(props: ContainerRowProps)`（826） | `row: Extract<RenderRow,{kind:'project'\|'worktree'\|'history'}>`、`t`、`hovered`、`renderActions(hovered): ReactNode[]`、`onToggle`、`onHoverChange`、`onContextMenu?`、`drag?: DragHandlers` | `role="treeitem"` 的 `div`，`data-key={row.key}`，`draggable: drag !== undefined && drag.draggable`（921） |
| `HoverContainerRow(props)`（931） | 同上去掉 `hovered`/`onHoverChange` | 用 `useState(false)` 提升 hover，供动作按钮显隐（D14） |
| `SessionRowView(props: SessionRowProps)`（976） | `row: Extract<RenderRow,{kind:'session'}>`、`t`、`onOpen`、`onMenu(target)`、`drag?` | `role="treeitem"` + `aria-current` + `data-session-id`；`subagentCount > 0` 时画计数胶囊（998） |
| `MoreRowView(props)`（1053） | `row: Extract<RenderRow,{kind:'more'}>`、`t`、`expandedAll`、`onToggle` | `role="button"` + `tabIndex: 0`；`expandedAll` ⇒ `sessions.collapse`，否则 `sessions.expand({n: hiddenCount})`（`src/sidebar.tsx:1060-1062`） |
| `StatusDot(props: {running?,pending?,completed?})`（378） | 三布尔 | `P.StateDot`，`state` 优先级 `pending→'warning'` > `running→'ongoing'` > `completed→'done'` > `'idle'`（`src/sidebar.tsx:379-386`） |
| `RenameDialog`（1150）/ `CreateWorktreeDialog`（1210）/ `RemoveWorktreeDialog`（1375） | `state`/`target`（`null` ⇒ 返回 `null`，不渲染）、`t`、`onClose`、`onSubmit`/`onCreated`/`onRemoved`、`onBusy`、`onError`/`onWarning`、`post` | `P.Modal` |
| `MenuLayer(props)`（2627） | `target: MenuTarget \| null`、`t`、`actions`、`onClose`、`onNewSession`、`onRename`、`onCreateWorktree`、`onRemoveWorktree`、`reload`、`setLoadError`、`collectBaseCandidates(repoPath)`、`orderIsManual`、`onResetOrder` | `target === null` ⇒ `null`；否则 `P.Menu`（`portal: true` + 稳定的 `getAnchorRect`） |
| `SidebarBoundary`（1479） | `Component<{children?}, {error: unknown}>` | 正常渲染 `children`；出错渲染「错误 + 重试」，`getDerivedStateFromError`（1484）+ `componentDidCatch`（1489） |

## 执行流程

### 渲染主流程（含分支）

```
SidebarBrowser(props)
  └─ jsx(SidebarBoundary, {children: jsx(SidebarBrowserInner, props)})
       │
       ├─ t = props.t ? createSeatT(props.t) : FALLBACK_T ; bridge = props.bridge   // 2026-09-23 修订
       ├─ wide = readBoolean('wide') ; expandSidebar / renderSlot = readFunction(...)
       ├─ sourcesRef 首渲染冻结 {sessions, workspaces, pending}
       ├─ sessionsSnapshot = sources.sessions(identity)
       ├─ sources.workspaces(identity)      // 只为驱动重取
       ├─ pendingInteractions = sources.pending(identity)   // D2 琥珀态唯一来源
       ├─ useState × 14（collapsedKeys/expandedAllKeys/query/manualOrder/topZoneState/
       │                drag/dropTarget/tree/loadError/busyText/notice/menuTarget/
       │                renameState/createState/removeTarget）
       ├─ effects 注册：防抖重取 / 首拉+30s+focus / topZone 观测 / D2 落表
       │
       ├─ wide === false ?  ──► 36px 轨道按钮（icon('panelLeft')，onClick=expandSidebar）  // 2026-10-19 改
       │                        ★ 不渲染树、搜索、菜单、弹窗（src/sidebar.tsx:2135-2159）
       │
       └─ wide !== false
            ├─ treeInput = useMemo(...)   // 与 effectiveOrder 同源
            ├─ view = buildTreeView(tree, treeInput)
            ├─ rowNodes: for row of view.rows
            │     ├─ withLiveState(row, pendingInteractions, sessionsSnapshot)   // D2 覆盖
            │     ├─ kind==='session' → SessionRowView（drag = 同容器；运行中 draggable=false）
            │     ├─ kind==='more'    → MoreRowView（toggleExpandedAll）
            │     ├─ kind==='history' → HoverContainerRow（renderActions: () => []）
            │     ├─ kind==='worktree'→ HoverContainerRow（+ 新会话 / … 菜单；drag 需 worktreeOwner）
            │     └─ kind==='project' → HoverContainerRow（git: 仅 …；非 git: 仅 +；未分组: 无按钮）
            ├─ body = [搜索行(搜索框 + 添加工作区 +)]
            │     tree===null && loadError===null → 「正在加载工作区…」
            │     loadError!==null               → 错误框 + 重试按钮（替换整棵树）
            │     query.trim()!=='' && 0 行      → 「无匹配结果」
            │     否则                            → ...rowNodes
            ├─ busyText!==null → 忙碌行 ; notice!==null → 非阻塞警告行
            ├─ renderSlot?.(DIRECTORY_FLOW_SLOT)  // try/catch，失败仅 console.warn
            └─ return div[ scroll(div) , MenuLayer , CreateWorktreeDialog ,
                            RemoveWorktreeDialog , RenameDialog ]
```

### 拖拽交互主流程

```
dragstart(行)                         dragover(目标行)                    drop(目标行)
    │                                     │                                  │
    ├ draggable===false ? return          ├ drag===null ? return             ├ drag===null ? return
    ├ dataTransfer.effectAllowed='move'   ├ !accepts(drag) ? return          ├ !accepts(drag) ? return
    ├ dataTransfer.setData('text/plain',  │   （不 preventDefault ⇒           ├ preventDefault + stopPropagation
    │                      row.key)       │    禁止光标、无插入线）           ├ half = rowHalf(event)
    ├ setDrag(state)                      ├ preventDefault                   ├ setDrag(null); setDropTarget(null)
    └ setDropTarget(null)                 ├ dropEffect='move'                └ commitDrag(active, {key,half})
                                          └ setDropTarget({key,half})            │
                                                                                 ├ kind='session' → reorderManualScope(
                                                                                 │    effectiveOrder.sessions.get(containerKey), …)
                                                                                 ├ kind='worktree'→ reorderManualScope(order, defaults.worktrees.get(projectKey), …)
                                                                                 └ kind='project' → reorderManualScope(order, defaults.projects, …)
                                                                                       next===null ⇒ 不写
                                                                                       next!==null ⇒ persistOrder({manual:true, …})

dragend(任意) ─► setDrag(null) + setDropTarget(null)   // 拖到空白 / Esc 取消时 drop 不触发，只有 dragend 会
```

## 状态机

### 拖拽状态机（ASCII 流转图）

```
                 ┌──────────────────────────────────────────────────────────┐
                 │                        IDLE                              │
                 │  drag=null ∧ dropTarget=null  ⇒ 无插入线、无半透明行      │
                 └───────┬──────────────────────────────────────▲───────────┘
        dragstart(可拖行)│                                      │dragend / drop
                         ▼                                      │
                 ┌──────────────────────────┐                   │
                 │       DRAGGING           │  dragover(不接受) │
                 │  drag≠null, dropTarget=  │───────────────────┤（保持 DRAGGING）
                 │  null                    │  accepts()===false│
                 └───────┬──────────────────┘                   │
   dragover(accepts===true)│                                    │
                         ▼                                     │
                 ┌──────────────────────────┐  dragover(接受,   │
                 │    HOVER_ACCEPTED        │  换行/换半) ──────┤（更新 dropTarget）
                 │  drag≠null ∧ dropTarget= │                   │
                 │  {key, half}             │                   │
                 │  ⇒ 目标行画 2px 插入线    │                   │
                 └───────┬──────────────────┘                   │
        drop(accepts===true)│                                   │
                         ▼                                     │
                 ┌──────────────────────────┐                   │
                 │        COMMITTING        │───────────────────┘
                 │  commitDrag → reorder →  │   setDrag(null)
                 │  persistOrder(写盘)       │   setDropTarget(null)
                 └──────────────────────────┘
```

### 状态参考表

| 状态 | 含义 | 转入条件 | 转出条件 |
|---|---|---|---|
| `IDLE` | 无拖拽（`drag === null`） | 初值；`onDragEnd`；`onDrop` 后置空（`src/sidebar.tsx:2106-2107`、`2127-2128`） | 任一可拖行的 `onDragStart` 且 `draggable === true` |
| `DRAGGING` | 已起拖、尚未悬停到合法落点 | `setDrag(state)` + `setDropTarget(null)`（`src/sidebar.tsx:2100-2101`） | `onDragOver` 且 `accepts(drag) === true`；或 `dragend`/`drop` 回 `IDLE` |
| `HOVER_ACCEPTED` | 悬停在同层同范围的落点上，插入线可见 | `onDragOver` 里 `accepts(drag) === true` ⇒ `preventDefault` + `setDropTarget({key, half})`（`src/sidebar.tsx:2109-2119`） | 换行/换半 ⇒ 更新 `dropTarget`；`drop` ⇒ `COMMITTING`；`dragend` ⇒ `IDLE` |
| `COMMITTING` | `commitDrag` 正在换算并持久化新顺序 | `onDrop` 且 `accepts(drag) === true`（`src/sidebar.tsx:2121-2130`） | 同步完成：`reorderManualScope` 返回 `null` ⇒ 不写盘；否则 `persistOrder` 写 state + `localStorage` |
| `REJECTED`（隐式，非独立状态） | 跨容器/跨项目/未分组/history/more 行 | `accepts()` 返回 `false`（`kind` 不同或 `containerKey`/`projectKey` 不同，`src/sidebar.tsx:2081-2086`） | 不 `preventDefault` ⇒ 浏览器禁止光标、`drop` 不触发；`dragend` 回 `IDLE` |

> `marker` 的完整判据是 `drag !== null && accepts(drag) && dropTarget?.key === row.key`
> （`src/sidebar.tsx:2090`）—— 即「当前行既是合法落点、又正是悬停行」才画线。

### 排序模式状态

| 状态 | 含义 | 转入条件 | 转出条件 |
|---|---|---|---|
| 默认排序（`manual !== true`） | 完全走 `effectiveOrder` 的默认顺序 | 初值；`readManualOrder()` 读不到或结构不合法（`src/sidebar.tsx:282-301`）；`onResetOrder`（`src/sidebar.tsx:2543-2555`） | 首次有效拖拽 ⇒ `commitDrag` 全量固化并置 `manual: true` |
| 手动排序（`manual === true`） | 三层顺序均由 `dsh-worktree-groups.order` 决定 | `persistOrder({...base, manual: true, …})`（`src/sidebar.tsx:2028`/`2041`/`2050`） | 菜单「恢复默认排序」⇒ `clearManualOrder()` + `setManualOrder(EMPTY_ORDER)` |

## 并发与线程模型

浏览器单线程 + React 18 渲染周期，无真实多线程；需要处理的是**异步请求竞态**与**副作用清理**。

| 关注点 | 实现 | 位置 |
|---|---|---|
| 取树竞态 | `inflightRef: AbortController`；新 `reload` 先 `abort()` 旧的；两个 `then`/`catch` 都先判 `controller.signal.aborted` 再 `setState` | `src/sidebar.tsx:1647-1674` |
| 卸载清理 | 30s 轮询 + `focus` 监听 effect 的 cleanup：`clearInterval` + `removeEventListener` + `inflightRef.current?.abort()` | `src/sidebar.tsx:1689-1693` |
| 快照抖动 | 快照变化 effect 用 220ms `setTimeout` 防抖（`RELOAD_DEBOUNCE_MS`），cleanup `clearTimeout` | `src/sidebar.tsx:1678-1681` |
| 落表收敛 | D2 effect 依赖含 `manualOrder` ⇒ 用户每次拖拽都重跑；用 `pendingNewSessionIdsOf` 早退 + `markNewSessionsWritten` 记台账，保证同一新会话**只落表一次** | `src/sidebar.tsx:1919-1956` |
| 无限渲染防护 | `observeTopZone` 无变化时返回**同一引用**，`setTopZoneState` 收到相同引用 React 直接 bail out；该 effect 依赖 `tree` 而非 `treeInput`（后者依赖 `topZoneState`，会成环） | `src/sidebar.tsx:1816-1838` |
| hook 数量恒定 | 三个 source 首渲染冻结；`wide === false` 的提前 return 出现在**全部 hook 调用之后** | `src/sidebar.tsx:1591-1599`、`2135` |
| 弹窗重复提交 | `busy` state 门控：提交置 `true`，`finally` 置 `false`；`DialogActions` 的取消/确认按钮都 `disabled: props.busy` | `src/sidebar.tsx:1328-1359`、`1397-1423`、`1114-1143` |
| 异步异常不逃逸 | 错误边界**接不到**事件回调/异步里的异常，故每个动作自带 `try/catch` → `setLoadError`（`MenuLayer.handleSelect` 注释 `src/sidebar.tsx:2709`） | `src/sidebar.tsx:1791`、`1809`、`2603`、`2763` |
| `renderSlot` 隔离 | 自建子槽位渲染包 `try/catch`，失败仅 `console.warn`，不影响树 | `src/sidebar.tsx:2510-2517` |
| `actions` memo | `useMemo(..., [props, bridge])`；`props` 引用变化即重建（无正确性问题，仅重算成本） | `src/sidebar.tsx:1697-1741` |
| `reload` 依赖 `[t]` | 若宿主 `t` 每次渲染换引用，则 30s 轮询 effect 会反复重建并立即重拉 —— **未确认**（未在本任务做运行时验证；`src/locales.ts` 的 `createT` 本身是稳定闭包，风险来自宿主 localeSeat） | `src/sidebar.tsx:1675`、`1684-1694` |

## 边界条件

| 场景 | 行为 | 证据位置 |
|---|---|---|
| 空分组（某 git worktree 无会话） | 仍画 worktree 行，`sessionCount = 0`；无会话行、无 more 行 | 容器无条件创建 `src/tree-model.ts:1676-1691`；行渲染 `src/sidebar.tsx:2238-2300` |
| history 桶无可见成员 | **不画** history 行（存在性与子行同源：先过 `hasVisibleMembers`，否则会出现 `sessionCount = 0` 的空容器行） | `src/tree-model.ts:1713-1724` |
| 拖到自己（`draggedId === overId`） | `reorderManualScope` 返回 `null` ⇒ **不写盘**，不切手动模式 | `src/tree-model.ts:2161`；`src/sidebar.tsx:2025`/`2038`/`2049` |
| 跨容器拖会话 | `accepts()` 为 `false` ⇒ 不画线、不 `preventDefault`、`drop` 不触发；计算侧 `sessions.get(containerKey)` 无该 id ⇒ `null` | `src/sidebar.tsx:2083`、`2017-2029` |
| 跨项目拖 worktree | 同上，键为 `ProjectNode.key`（`view.worktreeOwner`，**不是** `repoPath`） | `src/sidebar.tsx:2241-2244`、`747-760` |
| 拖到未分组行 / 拖未分组行 | 未分组行 `drag === undefined`（`row.key === PREFIX_UNGROUPED`）；且 `effectiveOrder.projects` 不含 `UNGROUPED_KEY` ⇒ 项目拖不到它之后 | `src/sidebar.tsx:2306-2308`；`src/tree-model.ts:2044`、`2058-2061` |
| 运行中会话 / **当前空白占位行**（2026-10-22 DR5） | **不可拖**（`draggable: false`）但**仍接受落点**；判据 `!isSessionDragLocked(row, topZone)`（= 运行中 ∪ 当前空白占位行；其中「运行中」仍是唯一的 `isTopZoneRunningSession`） | `src/sidebar.tsx`（`dragHandlersFor` 调用点）；`src/tree-model.ts` 的 `isSessionDragLocked` / `isTopZoneRunningSession` |
| 未注册 worktree（`workspaceId === undefined`） | `+` 可用（懒注册：`workspace-open` 拿 id）；菜单隐藏「重命名工作区」「移除 worktree」 | `src/sidebar.tsx:1778-1790`、`2674-2685` |
| 非 git 工作区 | 项目行只有 `+`（`workspaceId === undefined` 时连 `+` 都不画）；菜单项为「新建会话」 | `src/sidebar.tsx:2356-2370`、`2700-2704` |
| 请求失败（取树） | `setLoadError` ⇒ 错误框 + 重试按钮**替换整棵树** | `src/sidebar.tsx:1671-1674`、`2445-2478` |
| 部分成功（worktree 建成但注册工作区失败） | 走 `notice` 行（非阻塞，树继续显示），**不能**用 `loadError`（会藏树）、也不能用 `busyText`（`finally` 立刻清掉） | `src/sidebar.tsx:1345-1349`、`2563-2567` |
| 删除 worktree 遇脏工作区 | 第一段返回 `needsForce` ⇒ 切第二段红色警告，确认后带 `force: true` 重试 | `src/sidebar.tsx:1411-1414`、`1440-1467` |
| 搜索无结果 | `query.trim() !== '' && rowNodes.length === 0` ⇒ 显示 `search.empty` | `src/sidebar.tsx:2479-2484` |
| 首次加载（`tree === null` 且无错误） | 显示 `state.loadingTree`；搜索行照常可交互 | `src/sidebar.tsx:2439-2444` |
| `wide === false`（轨道态） | 只渲染 36px 按钮（`RAIL_BUTTON = 36`，`src/sidebar.tsx:162`），点击 `expandSidebar()`；无树/搜索/菜单/弹窗 | `src/sidebar.tsx:2135-2159` |
| `localStorage` 不可用 / 数据被手改 | 读全捕获退化为 `{}` / `EMPTY_ORDER`；写入失败静默；读回内容按 `unknown` 清洗（只留非空字符串、去重） | `src/sidebar.tsx:215-238`、`250-319` |
| `pending` 快照键拼法不一致 | `pendingOf` / `completedOf` 先精确命中，再按 `sessionKeyOf`（去 `session-` 前缀）扫描兜底 | `src/sidebar.tsx:447-484` |
| `renderSlot` 抛错 | 仅 `console.warn`，树不受影响 | `src/sidebar.tsx:2514-2516` |
| 渲染期异常 | `SidebarBoundary` 接住 ⇒ 「侧栏渲染出错」+ 重试（不白屏、不让宿主 `abdicate`） | `src/sidebar.tsx:1494-1521` |

## 代码示例

以下示例使用真实符号名与 props 名（均来自 `src/sidebar.tsx`）。

### 1. 装配（`src/client.tsx` 同姿势）

```ts
import { SidebarBrowser, DIRECTORY_FLOW_SLOT, LOCALE_NS, type SidebarBridge } from './sidebar.js'

const bridge: SidebarBridge = {
  pickDirectory: async () => null,           // null = 用户取消（§2.7 裁定 5）
  createWorkspace: async (path) => { void path },
  renameWorkspace: async (id, title) => { void id; void title },
  deleteWorkspace: async (id) => { void id },
  openSession: (sessionId) => { void sessionId },
  startSession: (workspaceId, options) => { void workspaceId; void options },
  renameSession: async (id, title) => { void id; void title },
  archiveSession: async (id) => { void id },
  forkSession: async (id) => { void id },
}

slots.register(
  {
    name: 'sidebar.workspaces',
    priority: -1,                              // 低者渲染，压过官方 ui-workspace 的 0
    children: { [DIRECTORY_FLOW_SLOT]: { kind: 'single', scope: 'root' } },
    locale: LOCALE_NS,
    inject: () => ({ bridge }),
  },
  SidebarBrowser,
)
```

### 2. 造一行的拖拽接线（`dragHandlersFor` 的三层调用姿势）

```ts
// session：同容器内可拖；运行中 / 当前空白占位行的会话 draggable=false（仍可作落点）
const sessionDrag = dragHandlersFor(
  row,
  { kind: 'session', itemId: row.sessionId, containerKey: row.parentKey },
  !isSessionDragLocked(row, topZone),
)

// worktree：同项目内可拖（项目归属必须查 view.worktreeOwner，不能用 repoPath）
const worktreeDrag = dragHandlersFor(row, { kind: 'worktree', itemId: row.path, projectKey: owner })

// project：顶层之间可拖；未分组行传 undefined ⇒ 不可拖也不接受落点
const projectDrag = dragHandlersFor(row, { kind: 'project', itemId: row.key.slice('p:'.length) })

// 未分组行
const noDrag = dragHandlersFor(row, undefined)
```

### 3. 展开态与排序的读写

```ts
// 展开态：collapsedKeys 里存在即为折叠（缺省 = 展开）
toggleCollapsed('w:/Users/dev/repo-feature')   // 内部 writeFlagMap(LS_COLLAPSED, next)

// 手动顺序：只有 manual === true 才生效
const order: ManualOrder = { manual: true, sessions: { 'w:/repo': ['session-a', 'session-b'] } }
writeManualOrder(order)
clearManualOrder()                                // 「恢复默认排序」菜单项
```

## 已知缺陷与注意事项

1. **`SidebarProps` 是 `Record<string, unknown>`（`src/sidebar.tsx:101`），props 名写错不会编译报错**。
   所有读取都必须经 `readString` / `readBoolean` / `readFunction`（`src/sidebar.tsx:191-212`）；
   直接 `props[key] as Fn` 会在 `hostInfo` 这类值对象上抛 TypeError（注释 `src/sidebar.tsx:204-207`）。
2. **错误边界接不到异步/事件异常**（React 语义）。所有动作必须自带 `try/catch` 并落 `loadError`，
   否则异常会变成未处理的 Promise rejection，用户看不到任何反馈。
3. **`MenuTarget` 持有 `WorktreeExtra` 快照**（`src/sidebar.tsx:763-766`）。菜单打开期间若树已刷新
   （30s 轮询 / 聚焦强刷），菜单里的 `reveal` / `copyPath` / `removeWorktree` 仍用**打开时**的
   `extra.path`。行为影响**未确认**（未做运行时复现），仅从数据流上可见该快照语义。
4. **`onDragOver` 读取闭包里的 `drag` state**（`src/sidebar.tsx:2110`）。`drag` 由 `onDragStart`
   的 `setDrag` 写入并触发重渲染后才对新处理器可见；若浏览器在重渲染前派发首个 `dragover`，
   该次悬停会被忽略（下一帧即恢复）。属**未确认**的时序风险。
5. **`DRAGGING_OPACITY = 0.45` 是内联常量**（`src/sidebar.tsx:627`），与原生 CSS 类实现不同；
   宿主若改主题不影响它（刻意取舍，见文件头注释第 1 条）。
6. **`readFlagMap` 只保留 `=== true` 的项**（`src/sidebar.tsx:222-224`）：显式写入 `false` 的值
   在下次读回时消失（语义等价于「不存在」，因为缺省即展开/未展开全部）。
7. **`stringListMapOf` 会丢掉空数组值的键**（`src/sidebar.tsx:269`）：手动顺序里「把某容器的顺序
   清空」无法表达，退化为该容器走默认顺序。
8. **`baseName` / `parentDirOf` 同时接受 `/` 与 `\`**（`src/sidebar.tsx:335-346`），与宿主
   `normalizePath` 的 POSIX 归一并不完全一致；`normalizeRepoKey` 用「去尾分隔符 + `toLowerCase`」
   做**相等判定**（`src/sidebar.tsx:2818-2821`），仅用于比较、不用于拼路径。
9. **`collectBaseCandidates` 只认显式 `repoPath`**（`src/sidebar.tsx:2799-2809`）：未注册/非 git
   的 worktree 缺 `repoPath` 时**不参与**候选合并（「宁少不错」，D3 修复）。
10. **`isTopZoneRunningSession` 的判据只有一份**，被 `tree-model.ts` 的置顶与 `sidebar.tsx` 的
    「不可拖」共用（`src/sidebar.tsx:2200`；测试 `test/sidebar-wiring.test.mjs:468`）。任何本地复刻
    都会让「排在最前的行」与「拖不动的行」分叉，属被测试锁定的红线。
11. **`defaultTitleOf` 的兜底顺序是「标题 → 目录 basename → sessionId」**（`src/sidebar.tsx:2891-2894`），
    与原生 `displayTitleOf` 对齐；标题为空串时同样走兜底。
12. **`jsx`/`jsxs` 被重新标注为 `JsxLike`（`Any`）**（`src/sidebar.tsx:71-95`）：props 的类型责任
    回到各 `interface XxxProps`。注释明确声明这不是绕过类型检查，但**新增行组件若不写 props
    interface，就不会有类型保护**。

## 相关文档

- [WebClient 模块技术文档](../l2-modules/WebClient模块技术文档.md)
- [Client 技术文档](../l3-components/Client技术文档.md)
- [TreeModel 技术文档](../l3-components/TreeModel技术文档.md)
- [worktree-groups 知识库总览](../l1-architecture/worktree-groups-knowledge-base.md)
