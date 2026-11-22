---
生成时间: 2026-09-22
更新时间: 2026-09-22
git-version: 9bd94252dd934c2fa8491977285e461b703f0f3e
git-module-path: src
level: L3
---

# tree-model 技术文档

> ⚠️ **2026-11-14 定点修订（PX1–PX5，渐进式展开）**：新增导出 `visibleSessionLimit(L)`（`5 + 5·L(L+1)/2`）、
> `nextExpandCount(L, 剩余)`、`containerKeysUnder(projects, rowKey)`；`SidebarModelInput` 新增可选
> `expandLevels`（`expandedAllKeys` 降级为兼容输入，真 ⇒ 无限层级）。`emitContainer` 与 `emitRecentSection`
> 共用私有 `truncateByLevel`：more 行新增 `nextCount` / `canCollapse`，`hiddenCount` 改为「当前仍未显示」的条数；
> 「最近」取消 100 条上限、默认 5 条并产出 `m:r:__recent__` more 行（`parentKind: 'recent'`）。
> 下文涉及 `expandedAll` / 100 上限的段落为历史描述，以本条与契约 §2.2 为准。
> 记录：[工作记录](../../worklog/2026-11-14-perf-progressive-expand.md)。

> ⚠️ 同轮追加（DR6）：「拖动工作区排序无效」的根因是 `commitDrag` 直接拿持久表 `reorderKeys`；
> > ⚠️ **2026-10-29 定点修订（RAS1–RAS5）**：`src/tree-model.ts` 新增导出纯函数
> `recentActivityOf(session)` = `max(updatedAt, 有限 lastActivityAt)`；`emitRecentSection`
> 的去重与排序改用 `byRecentActivity`（活动时间降序、`sessionId` 升序），`SessionRowLike`
> 新增可选 `lastActivityAt`。**工作区树 / 手动顺序 / 顶部区仍按 `updatedAt`**，未改动。
> 记录：[工作记录](../../worklog/2026-10-29-recent-any-activity-sort.md)、契约 §2.3.3。

`manualOrder` 是首次拖拽的快照，表外新增项既不能拖、也不能当落点 ⇒ 新增
> `reconcileManualOrder` / `reorderManualScope` 两个纯函数，渲染层三层换算统一走后者。
> 记录：`docs/worklog/2026-10-22-sidebar-reorder-stale-order.md`。
>
> ⚠️ **2026-10-22 定点修订（DR4/DR5，复验「新会话掉到列表最下面」）**：新增两个导出纯函数
> `isCurrentBlankSession`（当前空白会话 = 「新会话」占位行）与 `isSessionDragLocked`
> （拖拽锁 = 运行中 ∪ 当前占位行）；`emitContainer` 的 `pinnedKeys` **首位**插入当前占位行
> （先于手动顺序、顶部区与 5 条截断，**不写**持久顺序）；`topZoneSessionKeys` 的语义与签名
> **不变**（仍只负责「运行中 / 未落表新会话」，`currentSessionId` 是兼容位）。
> 下文未标注修订的行号锚点仍对应 `9bd9425` 时的文件。契约见
> `docs/INTERFACES.md` §2.2「排序与过滤规则」，记录见
> `docs/worklog/2026-10-22-new-session-draft-retention.md` §6。

> **文件路径**: `src/tree-model.ts`（2379 行）。契约依据 `docs/INTERFACES.md` §2.2 / §2.3 / §2.6。
> 单文件形态（本文成文 499 行，未超 ≤500 行上限、未触发拆分规则；对应源码 2379 行）。下文 `:N` 指 `src/tree-model.ts` 第 N 行。

---

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

---

## 概述

**tree-model** 是 `dsh-worktree-groups` 插件的**侧栏树推导纯逻辑模块**：把宿主的
「项目 / worktree / 会话」原始数据摊平成渲染行序列，并维护顶部件排序、拖拽固化顺序与顶部区
运行时状态机。文件头注释（`:1-40`）明确其定位：**不 import react、不 import 任何
`@deepseek-ai/*` 包、不做 IO**，因此可被 `node --test` 直接覆盖（`test/tree-model.test.mjs`
从 `../lib/tree-model.js` import，共 250 条用例）。

**核心特性**:

1. **零依赖纯函数库**：全文件 **0 处 `throw`**、0 处 `async`/`await`/`Promise`、0 处 IO
   （`grep -c "throw " src/tree-model.ts` ⇒ 0）；所有异常输入走**静默降级**分支。
2. **单一可见性谓词**：`isVisibleMember`（`:1760`）是唯一会话可见性判据，逐字对齐原生
   `sessionVisible`；树（`visibleMembers`）、搜索（`collectSearchCandidates`）、容器行存在性
   （`hasVisibleMembers`）三处全走它，杜绝「树里滤了、搜索里忘了」的分叉。
3. **运行时态与持久态严格分离**：顶部区（运行中会话置顶）是纯运行时推导，`effectiveOrder`
   （`:2078`）刻意把 `context.topZone` 硬置 `undefined`（`:2091`），保证 `localStorage` 固化
   顺序永不含运行时置顶。
4. **三层手动排序（D10）**：项目 / worktree / 会话三层均可拖拽排序，以 `ManualOrder` 叠加在默认顺序之上；`manual !== true` 时**完全不生效**（零回归）。
5. **确定性输出**：容器内会话恒按 `updatedAt` 降序、同值按 `sessionId` 升序（`byRecency`，`:1519`），同样输入永远推出同样行序列。

---

## 构造参数与依赖

本模块**没有类、没有构造函数**，是纯函数 + 类型定义的集合。「装配」= 调用方（`src/sidebar.tsx`）
如何组装 `SidebarModelInput` 并串联各纯函数。

### 导出符号总表

**`const`**：`COLLAPSED_SESSION_LIMIT = 5`（`:53`，折叠时可见的**非 blank** 会话上限）、
`UNGROUPED_KEY = '__ungrouped__'`（`:62`，「未分组」容器的合成项目键）。

**`interface` / `type`**：`SessionRowLike`（`:68`，与宿主 `SessionRow`（`src/types.ts:44`）兼容）、
`WorktreeNodeLike`（`:83`，对 `src/types.ts:58`）、`ProjectNodeLike`（`:95`，对 `src/types.ts:70`）、
`RenderRow`（`:112`，**冻结的渲染行类型**，5 元联合 project/worktree/history/session/more）、
`ManualOrder`（`:242`）、`TopZoneInput`（`:360`）、`TopZoneObservation`（`:592`）、`TopZoneState`（`:616`）、
`NewSessionInsertPlan`（`:943`）、`SidebarModelInput`（`:1071`）、`SubagentRunningCounts`（`:1219`，
`ReadonlyMap<string, number>`）、`TopZoneObservationSource`（`:1393`）、`EffectiveOrder`（`:2042`，
三层完整生效顺序）。

**`function`**（按行号）：`applyManualOrder`（`:292`，按手动顺序稳定重排含置顶）、
`isTopZoneRunningSession`（`:443`，「运行中」的唯一判据；2026-10-22 起「不可拖动」由 `isSessionDragLocked` 组合它）、`isCurrentBlankSession` / `isSessionDragLocked`（2026-10-22 新增，当前空白占位行的判据与拖拽锁）、`topZoneSessionKeys`（`:517`，
算容器内置顶 key）、`initialTopZoneState`（`:645`）、`observeTopZone`（`:719`，推进状态机）、
`containerKeyOfSession`（`:836`）、`placementOfSession`（`:862`，查会话落点）、
`insertSessionAtFront`（`:901`，插到容器表首，幂等）、`planNewSessionInserts`（`:993`，D2 落表编排）、
`markNewSessionsWritten`（`:1043`，记台账）、`pendingNewSessionIdsOf`（`:1065`）、
`indexRunningSubagentDescendants`（`:1335`，运行中子代理后代数索引）、`observationsOf`（`:1448`，
树 → 观测批次）、`topZoneInputOf`（`:1499`，状态 → 渲染期输入）、`truncateSessions`（`:1578`，5 条截断）、
`nestSubagents`（`:1615`，子代理折叠一层）、`workspaceIdFromProjectKey`（`:1939`）、
`effectiveOrder`（`:2078`，取三层完整顺序）、`reorderKeys`（`:2155`，拖拽落点 → 新顺序）、
`reconcileManualOrder` / `reorderManualScope`（2026-10-22 DR6：持久表与默认顺序对齐后再换算）、
`buildRows`（`:2246`，**主入口**）。

**模块私有**（`lib/tree-model.d.ts:1013` 的 `export {}` 未导出，行号见源码）：`SESSION_ID_PREFIX`（`:65`）、
`Translate`（`:200`）、`worktreeOrderOf`（`:340`）、`sessionOrderOf`（`:346`）、`sortTopZone`（`:411`）、
`ContainerSpec`（`:1107`）、`ProjectContainers`（`:1121`）、`EmitContext`（`:1140`）、`ContainerResult`（`:1164`）、
`normalizeSessionId`（`:1183`）、`isBlank`（`:1188`）、`isSubagentSession`（`:1202`）、`Lineage`（`:1222`）、
`discoverChildEdges`（`:1242`）、`subagentCountOf`（`:1374`）、`allSessionsOf`（`:1399`）、`isCollapsed`（`:1514`）、
`byRecency`（`:1519`）、`sortedByRecency`（`:1526`）、`basenameOf`（`:1531`）、`sessionLabelOf`（`:1539`）、
`containersOfProject`（`:1672`）、`ungroupedContainer`（`:1729`）、`isVisibleMember`（`:1760`）、
`visibleMembers`（`:1769`）、`hasVisibleMembers`（`:1779`）、`toSessionRow`（`:1784`）、`emitContainer`（`:1831`）、
`worktreeLabels`（`:1921`）、`projectIdentity`（`:1944`）、`SearchCandidate`（`:1956`）、
`collectSearchCandidates`（`:1973`）、`buildSearchRows`（`:2018`）。

### 依赖注入 / 装配方式

**无 DI 容器**。装配发生在唯一消费者 `src/sidebar.tsx`：

| 依赖项 | 来源 | 说明 |
|---|---|---|
| `SessionRowLike` / `ProjectNodeLike` / `WorktreeNodeLike` | `src/types.ts:44/70/58` | `tree-model.ts` **不跨半边 import**，只声明同形 `*Like` 接口 |
| `titleOf` | `SidebarModelInput.titleOf`（`:1102`） | 会话标题兜底解析，由 `sidebar.tsx` 注入 |
| `t`（取词） | `SidebarModelInput.t`（`:1103`） | `Translate = (key, vars?) => string`（`:200`），取自 `src/locales.ts` 的 `createT` |
| `archivedSessionIds` / `collapsedKeys` / `expandedAllKeys` / `query` | `SidebarModelInput`（`:1071-1104`） | 全部由调用方组装 |
| `manualOrder` / `topZone` | `SidebarModelInput`（`:1090` / `:1100`） | **可选**；缺省 ⇒ 逐字零回归 |

### 被谁使用

- **`src/sidebar.tsx`**（唯一消费者）：`src/sidebar.tsx:32-53` 一次 import **13 个值 + 6 个类型**；调用点
  `buildRows`（`:2885`）、`effectiveOrder`（`:1929`、`:2006`）、`observeTopZone`（`:1828`）、`observationsOf`
  （`:1830`）、`topZoneInputOf`（`:1841`）、`pendingNewSessionIdsOf`（`:1923`）、`planNewSessionInserts`
  （`:1940`）、`markNewSessionsWritten`（`:1950`）、`reorderKeys`（`:2022`、`:2037`、`:2048`）、
  `isTopZoneRunningSession`（`:2200`）、`initialTopZoneState`（`:1629`）。
- **`test/tree-model.test.mjs`**：import 22 个符号，250 条用例。**`test/sidebar-wiring.test.mjs`**：用
  TypeScript 编译器 API 解析 `src/tree-model.ts`，断言 `isTopZoneRunningSession` 在 `src/` 全目录
  **只有一份**声明（`test/sidebar-wiring.test.mjs:478-482`，用例名见 `:468`）。
- ⚠️ **`containerKeyOfSession`（`:836`）当前无生产调用点**：`grep -rn containerKeyOfSession src/` 只命中
  自身定义与 JSDoc。它是 `placementOfSession` 的便捷包装，属**未接线的导出**，非死代码。

---

## 核心方法签名

> 下列签名从 `src/tree-model.ts` **逐字摘录**。

```ts
export function topZoneSessionKeys(                                        // :517-522
  sessions: SessionRowLike[],
  currentSessionId: string | undefined,
  containerKey: string,
  topZone?: TopZoneInput,
): string[] | undefined {
export function observeTopZone(                                            // :719-723
  state: TopZoneState,
  observations: readonly TopZoneObservation[],
  nowMs: number,
): TopZoneState {
export function planNewSessionInserts(                                     // :993-998
  order: ManualOrder,
  sessions: ReadonlyMap<string, readonly string[]>,
  newSessionIds: readonly string[],
  alreadyWritten: readonly string[],
): NewSessionInsertPlan {
export function truncateSessions<T extends { sessionId: string }>(         // :1578-1581
  sessions: T[],
  limit: number,
): { visible: T[]; hiddenCount: number } {
export function nestSubagents<                                             // :1615-1617
  T extends { sessionId: string; parentSessionId?: string; origin?: string },
>(sessions: T[]): Array<{ session: T; depth: number }> {
export function buildRows(input: SidebarModelInput): RenderRow[] {         // :2246
```

其余导出（**单行化形态**：换行与尾逗号归一，标识符与类型逐字不变，行号括注）：
`applyManualOrder<T>(items: T[], order: string[] | undefined, keyOf: (item: T) => string, pinnedKeys?: readonly string[]): T[]`（`:292-297`）、
`isTopZoneRunningSession(session: { sessionId: string; running?: boolean }, topZone?: TopZoneInput): boolean`（`:443-446`）、
`initialTopZoneState(): TopZoneState`（`:645`）、
`containerKeyOfSession(sessions: ReadonlyMap<string, readonly string[]>, sessionId: string): string | undefined`（`:836-839`）、
`placementOfSession(sessions: ReadonlyMap<string, readonly string[]>, sessionId: string): { containerKey: string; sessionId: string } | undefined`（`:862-865`）、
`insertSessionAtFront(order: ManualOrder, containerKey: string, sessionId: string, fullOrder?: readonly string[]): ManualOrder | undefined`（`:901-906`）、
`markNewSessionsWritten(state: TopZoneState, sessionIds: readonly string[]): TopZoneState`（`:1043`）、
`pendingNewSessionIdsOf(state: TopZoneState): string[]`（`:1065`）、
`indexRunningSubagentDescendants<T extends Lineage>(sessions: T[]): Map<string, number>`（`:1335-1337`）、
`observationsOf(source: TopZoneObservationSource): TopZoneObservation[]`（`:1448`）、
`topZoneInputOf(state: TopZoneState): TopZoneInput`（`:1499`）、
`workspaceIdFromProjectKey(key: string): string | undefined`（`:1939`）、
`effectiveOrder(input: SidebarModelInput): EffectiveOrder`（`:2078`）、
`reorderKeys(keys: string[], draggedId: string, overId: string, half: 'before' | 'after'): string[] | null`（`:2155-2160`）；
`reconcileManualOrder(order, defaults): string[]` 与 `reorderManualScope(order, defaults, draggedId, overId, half): string[] | null`
（2026-10-22 DR6 新增：先对齐再换算，陈旧持久表不再让拖拽静默失效）。

### 参数含义、返回值与抛错条件

| 方法 | 参数合法取值 | 返回值 | 抛错 |
|---|---|---|---|
| `applyManualOrder` | `order`：`string[] \| undefined`；`pinnedKeys`：`readonly string[] \| undefined` | 重排后**新数组**；`order` 空且 `pinnedKeys` 空 ⇒ 输入浅拷贝 | 无。重复 key 只认第一个下标（`:304-308`） |
| `isTopZoneRunningSession` | `session` 只需 `sessionId` + `running?`；`topZone` 缺省 ⇒ 只认裸 `running` | `boolean` | 无。`topZone` 为 `null`/非对象/字段非数组 ⇒ `false`（`:448-451`） |
| `topZoneSessionKeys` | `currentSessionId`/`containerKey` ⚠️ **T11 起无语义**（函数体首行 `void`，`:525-526`） | 置顶 key 数组；**无置顶项 ⇒ `undefined`**（零回归分支） | 无。`null`/非对象 `topZone` 静默降级（`:543-544`） |
| `observeTopZone` | `observations` 须含 blank/子代理/归档会话；`nowMs` 由调用方注入以便单测确定化 | 新状态；**无变化 ⇒ 返回入参同一引用**（`:810`） | 无 |
| `insertSessionAtFront` | `containerKey`/`sessionId` 须非空字符串；`fullOrder` 仅在表里无该容器或表项为空数组时作基底（`:911-915`） | 新 `ManualOrder`；**无需写入 ⇒ `undefined`** | 无 |
| `planNewSessionInserts` | `sessions` = `effectiveOrder({...,manualOrder:undefined}).sessions`；id 列表为归一化形态 | `{ order, consumed, changed }`（`:943-955`） | 无。`manual !== true` ⇒ `{ order, consumed: [], changed: false }`（`:999`） |
| `indexRunningSubagentDescendants` | `T extends Lineage`（`:1222-1227`，**未导出**：`sessionId`/`parentSessionId?`/`origin?`/`running?`） | **归一化** id → 运行中子代理后代数；**每个入参会话都有键**（无后代为 `0`，`:1346`）。查询走 `subagentCountOf`（`:1374`） | 无 |
| `truncateSessions` | `limit` 非有限值 ⇒ 按 `0`（`:1582`） | `{ visible, hiddenCount }`，`hiddenCount = sessions.length - visible.length`（`:1598`） | 无。⚠️ **形参恒为 2**，被 `test/tree-model.test.mjs:126` 的 `assert.equal(truncateSessions.length, 2)` 钉死 |
| `nestSubagents` | 同容器会话数组（**不被修改**） | 展平序列；顶层 `depth: 0`，直接子代理 `depth: 1` | 无。环/自指**软失败**：按顶层处理，不抛错、不丢行（`:1610`、`:1631`） |
| `effectiveOrder` | 与 `buildRows` 同一入参 | `EffectiveOrder`（`:2042-2049`） | 无。三处有意差异：不截断、不产出未分组行、**不应用运行时顶部区**（`:2091`） |
| `reorderKeys` | `half ∈ {'before','after'}` | 新顺序；**无需改动 ⇒ `null`**（落点是自身 `:2161`／已在原位 `:2170`／落点不在列表 `:2167`） | 无 |
| `buildRows` | `SidebarModelInput`（`:1071-1104`），11 字段，`manualOrder`/`topZone`/`currentSessionId` 可选 | `RenderRow[]`；**搜索无匹配 ⇒ 空数组** | 无。`query` 非字符串按 `''`（`:2261`） |

> 其余导出均不抛错：`placementOfSession` 对非字符串/空串返回 `undefined`（`:866`）；
> `workspaceIdFromProjectKey` 对非 `ws:` 前缀返回 `undefined`（`:1940`）。

---

## 执行流程

### 主流程 — `buildRows(input)`（`:2246`）

```
buildRows(input)
    ├─ 1. 建 EmitContext                                        :2248-2260
    │       ├─ archived = new Set(input.archivedSessionIds)
    │       ├─ subagentRunningCounts = indexRunningSubagentDescendants(
    │       │     allSessionsOf(input))    ← 索引建在【全部】会话上（含归档/blank/子代理）:2257
    │       └─ topZone = input.topZone（渲染期唯一读它的地方）
    ├─ 2. query = (typeof input.query === 'string' ? input.query : '').trim().toLowerCase()  :2261
    │       └─ [分支 A] query !== '' ⇒ return buildSearchRows(input, context, query)  :2262
    │                   ├─ collectSearchCandidates（走同一个 isVisibleMember）
    │                   ├─ 刻意【不应用】manualOrder 与 topZone             :2024-2027
    │                   └─ candidates.sort(byRecency) → toSessionRow(depth 0)
    └─ 3. [分支 B] 树模式
            ├─ 3.1 orderedProjects = applyManualOrder(input.projects,
            │         manualOrder?.manual === true ? manualOrder.projects : undefined,
            │         p => p.key)                               :2267-2268
            ├─ 3.2 containersOfProject(project, context)        :2272 / :1672
            │       ├─ hasWorktreeRows = project.isGit === true            :1677
            │       ├─ [git]    worktrees[] → 每个 `w:<path>` 容器（depth 2）
            │       ├─ [非 git] flat 容器（key = `p:<projectKey>`，depth 1）
            │       └─ history 容器（仅 hasVisibleMembers 为真时建，`h:<projectKey>`）
            ├─ 3.3 每容器 emitContainer(spec, context)          :1831
            │       ├─ visible = visibleMembers(spec, context)  :1854（唯一可见性谓词）
            │       ├─ heads = applyManualOrder(                             （2026-10-22 起 pinnedKeys 首位 = 当前空白占位行）
            │       │        [当前空白占位行, ...topZoneSessionKeys(...)]
            │       │       sortedByRecency(visible), sessionOrderOf(manualOrder, spec.key),
            │       │       s => s.sessionId,
            │       │       topZoneSessionKeys(visible, currentSessionId, spec.key, topZone))  :1859
            │       ├─ expandedAll = expandedAllKeys?.[spec.key] === true   :1863
            │       ├─ truncated = truncateSessions(heads, COLLAPSED_SESSION_LIMIT)  :1875
            │       ├─ [B1] heads.length <= 5 ⇒ selected = heads, hiddenCount = 0
            │       ├─ [B2] expandedAll      ⇒ selected = heads, hiddenCount = 真实值
            │       ├─ [B3] 否则             ⇒ selected = truncated.visible
            │       ├─ rows = selected.map(toSessionRow)                    :1891
            │       └─ hiddenCount > 0 ⇒ push 一条 more 行                  :1900-1909
            ├─ 3.4 applyManualOrder(containers.worktrees, worktreeOrderOf(...), e => e.node.path)  :2283-2287
            ├─ 3.5 push project 行（三个计数汇总）:2301-2315；projectCollapsed ⇒ continue :2316
            ├─ 3.6 push worktree 行 + 子行（折叠则跳过）:2318-2337；3.7 push flat 行 + 子行 :2339
            └─ 3.8 push history 行 + 子行（仅 containers.history 存在时）:2341-2355
    └─ 4. hasVisibleMembers(input.ungrouped, context) 为真时
            └─ push 未分组 project 行（key = `p:${UNGROUPED_KEY}`）+ 子行 :2359-2376 → return rows
```

### 子流程 — 顶部区置顶 `topZoneSessionKeys`（`:517`）与子代理计数索引（`:1335`）

```
topZoneSessionKeys(sessions, currentSessionId, containerKey, topZone)
    ├─ void currentSessionId; void containerKey   ← T11 起无语义       :525-526
    ├─ [1] topZone === undefined ⇒ return undefined（零回归）          :536
    ├─ [2] zone === null / 非对象 ⇒ return undefined（静默降级）       :543-544
    ├─ done = Set(writtenNewSessionIds):554-557；fresh = Set(newSessionIds):558-561
    ├─ 对每条 session：
    │     ├─ isRunning = isTopZoneRunningSession(session, zone)        :570
    │     │     ├─ session.running === true ⇒ true                     :447
    │     │     └─ id ∈ zone.runningSessionIds（归一化比较）⇒ true      :450-456
    │     ├─ isFresh = fresh.has(key) && !done.has(key)                :572
    │     └─ !isRunning && !isFresh ⇒ continue
    └─ sortTopZone(rest) = sortedByRecency(rest)（updatedAt 降序）:576
       → return keys.length === 0 ? undefined : keys                   :578

indexRunningSubagentDescendants(sessions)
    ├─ edges = discoverChildEdges(sessions)     ← 不动点迭代            :1338
    │     while (frontier.length > 0)
    │       ├─ nested = nestSubagents(frontier)                        :1252
    │       ├─ depth 0 ⇒ roots；depth ≥1 ⇒ 记边 (head, entry)
    │       ├─ 被展平的更深后代（父在集合内且未归属）进下一轮           :1279-1286
    │       └─ !added ⇒ break（无新边即收敛）                           :1287
    │     兜底：环 / 自指关系补成边（对齐原生直接读 parentId）:1295-1307
    ├─ 预置 counts：每个入参会话 key → 0                               :1346
    └─ 对每个【子代理】会话（按去重后 byKey 遍历）：                     :1356
          seen = new Set()
          while (current 是子代理 && !seen.has(currentKey)) {
              parentKey = parentOf.get(currentKey); 无 ⇒ break
              seen.add(currentKey)
              session.running === true ⇒ counts[parentKey] += 1          :1365
              currentKey = parentKey
          }
```

---

## 状态机

本模块维护**一个**显式状态机：**顶部区运行时状态机**（`TopZoneState`，`:616-642`），由
`observeTopZone`（`:719`）推进、`topZoneInputOf`（`:1499`）投影、`initialTopZoneState`（`:645`）
初始化。生命周期 = **一次页面会话，刷新即重置**（`:612-614`），除 D2 落表（由 `sidebar.tsx` 执行）
外**绝不写 `localStorage`**。

**状态字段**：`baselined: boolean`、`startedAtMs: number`、`knownSessionIds: readonly string[]`
（含归档与子代理）、`blankOf` / `runningOf`（`Readonly<Record<string, boolean>>`，仅非子代理非归档）、
`newSessionIds: readonly string[]`（**本进程内只增不减**）、`writtenNewSessionIds: readonly string[]`
（D2 落表台账）。

### ASCII 流转图

```
        initialTopZoneState()  baselined=false   :645
                     │ observeTopZone(state, obs, nowMs)
                     ▼
        ┌────────────────────────────┐
        │  S0: UNBASELINED           │  （首次拿到树数据之前）
        └────────────┬───────────────┘
                     │ 首次观测：已知会话全记入 known；startedAtMs = nowMs；
                     │ blankOf/runningOf 取初值；newSessionIds = []（基线不产生新会话）:740-758
                     ▼
        ┌────────────────────────────┐  无任何变化 ⇒ return state（同一引用）:810
   ┌───▶│  S1: BASELINED / STEADY    │◀──────────────────────────────┐
   │    └────────────┬───────────────┘                               │
   │                 │ 检出「新会话」：a) blank true→false（强证据）    │
   │                 │ b) 首次观测且 updatedAt >= startedAtMs（时间序）│
   │                 ▼                                               │
   │    ┌────────────────────────────┐                               │
   │    │  S2: NEW_SESSION_DETECTED  │  newSessionIds += id          │
   │    └────────────┬───────────────┘                               │
   │                 │ D2 落表（sidebar.tsx）：planNewSessionInserts   │
   │                 │ → insertSessionAtFront                        │
   │                 ▼                                               │
   │    ┌────────────────────────────┐                               │
   │    │  S3: WRITTEN               │  writtenNewSessionIds += id   │
   │    │  （markNewSessionsWritten）│                               │
   │    └────────────┬───────────────┘                               │
   │                 │ ⚠️ newSessionIds 【不】减少（D3d 输入，只增不减）│
   └─────────────────┴───────────────────────────────────────────────┘
```

### 状态参考表

| 状态 | 含义 | 转入条件 | 转出条件 |
|---|---|---|---|
| `S0 UNBASELINED` | 尚未建基线；不产生任何「新会话」 | `initialTopZoneState()`（`:645`） | `observeTopZone` 首次被调用 ⇒ 返回基线状态（`:749-757`） |
| `S1 BASELINED / STEADY` | 已建基线，无新会话待处理 | ① 基线建立（`:749`）；② 本次观测无任何字段变化 ⇒ **返回入参同一引用**（`:810`） | 检出「新会话」（判据 a/b，`:770-773`）⇒ 进 `S2` |
| `S2 NEW_SESSION_DETECTED` | `newSessionIds` 含尚未落表的新会话；渲染期由 `topZoneSessionKeys` 提升到容器顶部区 | `detectedNew.length > 0`（`:774`、`:785`） | 调用方执行 D2 落表并把 `consumed` 记入台账（`markNewSessionsWritten`，`:1043`）⇒ 进 `S3` |
| `S3 WRITTEN` | 落表意图已满足；渲染期**不再**提升（避免拖拽被回滚） | `markNewSessionsWritten` 收到 `consumed`（`:1055`） | 无自动转出；`newSessionIds` 不变（`topZoneInputOf` 仍投影它，`:1506`），台账只增不减 |

> ⚠️ **已删除的状态**：旧实现曾在 `running: true → false` 下降沿写入 `recentlyFinishedIds`（「刚结束保留」）并在出现新会话时清空。T11（2026-09-22 用户终裁）已**整体删除**（`:709-712`、`:778`）；`test/tree-model.test.mjs:3317` 用「状态机里**没有** `recentlyFinishedIds` 字段」锁定。
> ⚠️ **`unchanged` 判据**（`:796-810`）：不能用 `known.size === state.knownSessionIds.length`（插入顺序可能不同却长度相同），改为逐项比较 `sameIds` + `sameRecord`，保证「引用相同 ⟺ 内容逐字相同」。

---

## 并发与线程模型

| 维度 | 事实 | 证据 |
|---|---|---|
| **异步 / Promise** | **完全无**：0 处 `async` / `await` / `Promise` / `setTimeout` | `grep -n "async\|await\|Promise\|setTimeout" src/tree-model.ts` 无运行时代码命中 |
| **线程 / Worker** | **单线程**：无 `Worker`、无 `SharedArrayBuffer`、无原子操作 | 文件头声明「纯逻辑」`:1-6` |
| **IO** | **零 IO**：不读 `localStorage`、不发 `fetch`、不碰文件系统（`localStorage` 仅出现在 JSDoc） | `grep -n "localStorage\|fetch(" src/tree-model.ts` 全部命中注释行 |
| **共享可变状态** | **无模块级可变状态**：仅 2 个模块级 `const`（`:53`、`:62`），均为原始值常量 | 同上 |
| **入参可变性** | 所有导出函数**不修改入参**：`applyManualOrder` 先 `[...items]`（`:298`）、`sortedByRecency` 先拷贝（`:1527`） | 用例 `test/tree-model.test.mjs:1127`、`:1156`、`:2122`、`:2135` |
| **引用稳定性** | `observeTopZone` / `markNewSessionsWritten` 无变化时返回**入参同一引用** ⇒ 可直接用于 React `useState` 而不触发无限重渲染 | `:810`、`:1055`；`src/sidebar.tsx:1819` |
| **取消行为** | **N/A** —— 无异步、无长任务，不存在「取消」语义；effect 清理与请求取消不属本模块职责 | 全文件无 `AbortSignal` / 取消令牌 |
| **并发调用安全** | 纯函数 + 无共享可变状态 ⇒ 同一 `state` 可被并发调用 `observeTopZone`，各自返回独立新对象 | `:760-762` 全部 `new Set` / 展开拷贝 |

---

## 边界条件

| 条件 | 行为 | 证据 |
|---|---|---|
| `buildRows` 的 `query` 为 `undefined`/`null`/数字 / `''` / 纯空格 | 非字符串按 `''`；`trim()` 后为空 ⇒ **走树模式**，不抛错 | `:2261`；用例 `:848` |
| 搜索无匹配 | 返回**空数组**（渲染层据此显示 `search.empty`） | `:2023-2032`；用例 `:1058` |
| 容器会话数 ≤ 5 / > 5 且未 `expandedAll` / > 5 且 `expandedAll === true` | ① ≤5 ⇒ **不产生** more 行，`hiddenCount = 0`；② >5 未展开 ⇒ 前 5 条 + 一条 more 行；③ >5 已展开 ⇒ 全量输出但**仍产出恰好一条** more 行，`hiddenCount` 保留真实值 | `:1879-1889`；用例 `:355`、`:377` |
| 顶部区成员数 > 5 | 超出的部分**仍会被 5 条截断**（有意行为） | `:1841-1844`；用例「T5/截断: 顶部区成员数 > 5 时，只有前 5 条可见」 |
| `truncateSessions` 的 `limit` 非有限值（`NaN`/`Infinity`/`undefined`）或 `<= 0` | 按 `0` 处理 ⇒ 只留 blank 会话 | `:1582`；用例 `:176` |
| blank 会话 | 始终保留且**不占** 5 条名额；`hiddenCount` 仍按 `总数 - 可见数` | `:1588-1591`；用例 `:163` |
| 空输入（`projects: []`、`ungrouped: []`） | 返回空数组 / 仅项目行，不抛错 | 用例 `:2057` |
| `topZone` 为 `undefined`（未传） | **无任何置顶项**，逐字零回归 | `:536`、`:513`；用例 `:2105` |
| `topZone` 为 `null`/非对象，或 `runningSessionIds` 为 `42`/`null`（契约外）；id 元素非字符串 | 静默降级为不置顶（`Array.isArray` 收窄 + `typeof` 守卫），**不抛 `TypeError`** | `:543-544`、`:450-451`、`:454`、`:555-560` |
| `manualOrder.manual !== true` | 三层手动顺序**完全不生效** | `:341`、`:347`、`:907`、`:999` |
| `manualOrder.sessions[containerKey]` 是**空数组** | 视为「表里没有该容器」，用 `fullOrder` 作基底 ⇒ **不丢会话** | `:911-915`（S1 修复） |
| `order`/`pinnedKeys` 含 `items` 里不存在的 id；或同一 key 重复出现 | 不存在的 id **直接忽略**（无空洞、无 `undefined`，输出长度恒等于输入）；重复 key 只认**第一个**下标 | `:304-308`、`:316`、`:323`；用例 `:2037`、`:2089` |
| `insertSessionAtFront` 的 `containerKey`/`sessionId` 非字符串或空串 | 返回 `undefined`（不写） | `:908-909` |
| 表里已有该会话但写法带/不带 `session-` 前缀 | 复用**表里原形态**写入 ⇒ 不产生「永远匹配不上的死条目」 | `:923-926`（B1 修复） |
| `nestSubagents` 遇环 / 自指；父不在组内 / 父是自己 / 父自己也是子代理 | 环**软失败**：环上成员按顶层处理，不抛错、不丢行；其余情形平铺为 `depth: 0` | `:1606-1607`、`:1610`、`:1631`；用例 `:233`、`:276`、`:291` |
| 会话 id 带/不带 `session-` 前缀 | `normalizeSessionId` 归一化后比较，**输出仍用原 id** | `:1178-1185` |
| `origin === 'subagent'` 的会话 | **任何容器里都不产生行**；只通过父行 `subagentCount` 胶囊体现 | `:1760-1765`、`:2195-2196`；用例 `:1249` |
| 有 `parentSessionId` 但 `origin !== 'subagent'`（派生 / fork 会话） | **仍渲染为顶层行**（判据是 `origin` 而非 `parentSessionId`） | `:1195-1203`；用例 `:1560` |
| 归档会话（`archivedSessionIds` 命中） | 树与搜索结果里**都不出现** | `:1763`；用例 `:1086` |
| `history` / `ungrouped` 只有 blank 且非当前会话 | **不产生**该容器行（存在性判据同源） | `:1713-1724`、`:2358-2359`；用例 `:524`、`:591` |
| 零会话的 worktree；git 项目且 `worktrees` 为空（扫描降级） | 前者**仍然产生** worktree 行（PRD US1）；后者不崩、无子行，**flat 不接管**（不吞 `flatSessions`） | 用例 `:616`、`:717` |
| `titleOf` 返回 `undefined`/`null`/`''`/纯空格 | 全部回退为 `t('session.new')`，**返回值保证是 `string`** | `:1545-1550`；用例 `:469` |
| `observation.sessionId` 非字符串 / 空串；`updatedAt` 非有限值 | 前者跳过该观测；后者按 `0`（不会因此被时间序判据选中） | `:732`、`:772`、`:1461` |
| 归档会话不在树里（真实链路） | `observationsOf` **单独补投影** `archived: true` ⇒ 进 `seen`，取消归档后不误判新会话 | `:1469-1486`（N1/I3 修复） |
| 旧会话 `updatedAt` 晚于本进程基线且本进程内首次出现；「创建 + 发首条消息」全在首次树数据到达前；宿主时钟与渲染进程时钟严重不一致 | 分别 ⇒ **误报**为新会话（残余不确定性，已在 `docs/PRD.md` 披露）／**漏报**为新会话（可接受降级）／时间序判据可能误判（同机不可能） | `:683-689` |
| 平台差异（Windows 路径分隔符） | `basenameOf` 同时接受 `/` 与 `\`，忽略尾分隔符 | `:1530-1536` |
| 超时 | **N/A** —— 本模块无 IO、无异步、无超时概念 | 见「并发与线程模型」 |

---

## 代码示例

> 示例全部使用代码库中**真实存在**的导出名与数据结构，可在 `test/tree-model.test.mjs` 找到同构写法。

### 示例 1 — 组装入参并推导渲染行

```ts
import { buildRows, COLLAPSED_SESSION_LIMIT, UNGROUPED_KEY } from './tree-model.js'
import type { ProjectNodeLike, SessionRowLike, SidebarModelInput } from './tree-model.js'

const session = (id: string): SessionRowLike => ({
  sessionId: id, updatedAt: 1000, running: false, blank: false, title: `T-${id}`,
})
const project: ProjectNodeLike = {
  key: '/repo/.git', isGit: true, title: 'Repo',
  worktrees: [{ path: '/repo', branch: 'main', isMain: true, exists: true,
                title: 'Repo', sessions: [session('a'), session('b')] }],
  history: [], flatSessions: [],
}
const input: SidebarModelInput = {
  projects: [project], ungrouped: [], archivedSessionIds: [],
  collapsedKeys: {}, expandedAllKeys: {}, query: '',
  titleOf: (s) => s.title ?? '', t: (key) => key,
}
const rows = buildRows(input)   // RenderRow[]
// rows[0].kind==='project'（key==='p:/repo/.git'）；rows[1].kind==='worktree'（key==='w:/repo'）
// rows[2..3].kind==='session'（depth 2）
console.log(COLLAPSED_SESSION_LIMIT)   // 5 ；console.log(UNGROUPED_KEY) // '__ungrouped__'
```

### 示例 2 — 手动排序、拖拽落点与三层完整顺序

```ts
import { applyManualOrder, effectiveOrder, reorderKeys } from './tree-model.js'

const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
applyManualOrder(items, ['c', 'a'], (x) => x.id)          // ⇒ [c, a, b]（b 不在 order ⇒ 追加末尾）
applyManualOrder(items, ['a', 'b'], (x) => x.id, ['c'])   // ⇒ [c, a, b]（置顶项先摘出）
reorderKeys(['a', 'b', 'c'], 'c', 'a', 'before')          // ⇒ ['c','a','b']
reorderKeys(['a', 'b', 'c'], 'a', 'a', 'after')           // ⇒ null（落点是自己）

const order = effectiveOrder(input)   // 不截断、不含运行时顶部区；三层各取一份完整顺序
order.projects                        // string[]
order.worktrees.get('/repo/.git')     // string[]（worktree 绝对路径）
order.sessions.get('w:/repo')         // string[]（sessionId）
```

### 示例 3 — 顶部区状态机与 D2 落表（与 `src/sidebar.tsx` 同构）

```ts
import {
  initialTopZoneState, isTopZoneRunningSession, markNewSessionsWritten, observationsOf,
  observeTopZone, pendingNewSessionIdsOf, planNewSessionInserts, topZoneInputOf,
} from './tree-model.js'

const observations = observationsOf({          // ① 树数据 → 观测批次（含归档补投影）
  projects: input.projects, ungrouped: input.ungrouped,
  archivedSessionIds: input.archivedSessionIds,
})
let state = observeTopZone(initialTopZoneState(), observations, Date.now())  // ② 推进状态机
const topZone = topZoneInputOf(state)          // ③ 投影成渲染期输入（喂给 buildRows）
if (pendingNewSessionIdsOf(state).length > 0) { // ④ D2 落表：新会话插到容器固化表最前
  const defaults = effectiveOrder({ ...input, manualOrder: undefined })
  const plan = planNewSessionInserts(
    input.manualOrder ?? { manual: false }, defaults.sessions,
    state.newSessionIds, state.writtenNewSessionIds,
  )
  if (plan.changed) state = markNewSessionsWritten(state, plan.consumed)  // 写 localStorage 由调用方做
}
const draggable = !isTopZoneRunningSession(row, topZone)  // ⑤ src/sidebar.tsx:2200 的真实用法
```

### 示例 4 — 子代理折叠与运行中后代计数

```ts
import { indexRunningSubagentDescendants, nestSubagents, truncateSessions } from './tree-model.js'

const sessions = [
  { sessionId: 'p',     running: false, updatedAt: 3 },
  { sessionId: 'sub-1', parentSessionId: 'p',     origin: 'subagent', running: true, updatedAt: 2 },
  { sessionId: 'sub-2', parentSessionId: 'sub-1', origin: 'subagent', running: true, updatedAt: 1 },
]
nestSubagents(sessions)   // ⇒ [p@0, sub-1@1, sub-2@0]（⚠️ 只展开一层：孙被展平为 depth 0，
                          //    这正是 discoverChildEdges 需不动点迭代的原因）
indexRunningSubagentDescendants(sessions)  // ⇒ Map { 'p' => 2, 'sub-1' => 1, 'sub-2' => 0 }
truncateSessions([{ sessionId: 'x' }, { sessionId: 'y' }], 5)  // ⇒ { visible: [两条], hiddenCount: 0 }
```

---

## 已知缺陷与注意事项

1. **`containerKeyOfSession`（`:836`）当前无生产调用点**：`grep -rn containerKeyOfSession src/` 只命中自身
   定义与 JSDoc。它是 `placementOfSession`（`:862`）的便捷包装，属**未接线的导出**而非死代码
   （`lib/tree-model.d.ts:543` 仍对外导出）。
2. **`newSessionIds` 只增不减 —— 与台账刻意分离**：`TopZoneState.newSessionIds` 在本进程内**永不减少**（`:634-636`），因为它是 D3d 顶部区渲染输入；「是否已落表」由独立字段 `writtenNewSessionIds` 承载。**这是有意设计**，但调用方必须同时维护两个字段，否则会引入 T9 缺陷 1 的「拖动新会话弹回原位」（`:550-553`）。
3. **时间序判据的残余误报 / 漏报**（源码 `:681-689` 与 `docs/PRD.md` 已如实披露）：**漏报** = 创建会话 + 发首条消息全部发生在首次树数据到达前（~100ms 窗口）⇒ 进入基线 ⇒ 不被判为新会话；**误报** = 旧会话 `updatedAt` 因宿主时钟偏差或 `lastPromptAt` 被历史事件推进而晚于基线，且本进程内首次出现 ⇒ 误判为新会话（同机不可能）。
4. **`nestSubagents` 只展开一层**：契约只处理 `depth: 0/1`，深度 ≥2 的后代被展平为 `depth: 0`（`:1605`）。因此**不能直接用它数后代**；`discoverChildEdges`（`:1242`）用不动点迭代补齐深层边后再交给 `indexRunningSubagentDescendants` 累加。新增「按深度渲染子代理行」需求时需扩展其契约（当前无此需求）。
5. **`topZoneSessionKeys` 的两个形参已无语义**：`currentSessionId` / `containerKey`（`:519-520`）在 T11 起被 `void` 掉（`:525-526`），仅为**签名兼容**保留（既有调用方与 `docs/INTERFACES.md` §2.2 冻结签名）。**不要**据此认为「当前会话会置顶」—— 该例外已删除（2026-10-22 DR4 只让 **blank 占位行**在 `emitContainer` 里单独置顶，与 `isCurrent` 无关）。
6. **`runningCount` 口径不含子代理聚合**：`emitContainer` 的 `runningCount`（`:1914`）只数 `session.running === true`，而**行上的 `running`**（`toSessionRow`，`:1807`）是聚合口径（`session.running || subagentCount > 0`）。两者**有意不一致**（用户裁决 Q1：渲染层无消费者），已在文件头 `:19-22` 标注。修改时勿「顺手对齐」。
7. **顶部区不写 `localStorage` —— 被测试锁定的不变式**：`effectiveOrder`（`:2078`）把 `context.topZone` 硬置 `undefined`（`:2091`），`order()` 闭包也刻意不传置顶 key（`:2098-2104`）。用例「T11: `effectiveOrder` **不**应用运行时顶部区」「T11: `JSON.stringify(order)` 的持久化载荷里**没有**置顶痕迹」锁定。若在此应用顶部区，会把运行时置顶污染成「持久化钉在第 1 位」。
8. **搜索模式刻意不应用手动顺序与顶部区**：`buildSearchRows`（`:2018`）不读 `manualOrder` / `topZone`（`:2024-2027`、`:1158`）。搜索结果跨容器扁平输出，容器内相对顺序与运行时置顶都无成立前提。差异**有意为之**，已写入 `docs/INTERFACES.md` §2.3。
9. **归档会话在真实链路中不在树里**：`observationsOf`（`:1448`）必须从 `source.archivedSessionIds` **单独补投影** `archived: true`（`:1469-1486`），因为 `buildProjects`（`src/projects.ts`）已把归档会话从树里剔除。移除该补投影会让「基线时已归档、之后取消归档并收到新消息」的旧会话被误判为新会话并写进固化表表首（违反 D5）。T7 的单测 fixture 曾把归档会话同时放进树与 `archivedSessionIds`，与真实链路**不同构**，属**恒真测试**（`:1426-1434` 如实记录）。
10. **`.tsx` 接线不在 `test/tree-model.test.mjs` 覆盖范围**：`src/sidebar.tsx` 不进 `lib/`（`tsconfig.json` 的 `jsx: preserve` + `scripts/build-client.mjs`），`node --test` 无法执行它 ⇒ T11 拖拽接线由源码级契约测试 `test/sidebar-wiring.test.mjs` 用 TypeScript 编译器 API 锁定（「`isTopZoneRunningSession` 从 `./tree-model.js` import」、「`src/` 全目录只有一份声明」）。**修改本模块的导出名会同时打破该测试**。本文另有两处 `lib/tree-model.d.ts` 行号引用（`:85` / `:478`），该文件同为 `npm run build` 的构建产物：`lib/` 被 `.gitignore` 忽略且未被 git 跟踪，干净检出中并不存在，须先构建才能核对，且其行号与源码行号不同、不可混用。

---

## 相关文档

- [TreeModel 模块技术文档](../l2-modules/TreeModel模块技术文档.md) —— 本组件所属模块的职责说明与
  组件目录（L2）。
- [worktree-groups 知识库](../l1-architecture/worktree-groups-knowledge-base.md) —— 域架构概览与模块
  索引（L1）。
- [接口契约](../../INTERFACES.md) §2.2 / §2.3 / §2.6 —— `RenderRow` 冻结字段、组件契约与 T4 回报后的
  契约裁定。
- [宿主契约](../../HOST-CONTRACTS.md) —— 宿主 `SessionRow` / `WorktreeNode` / `ProjectNode` 的事实核实。
- [产品需求](../../PRD.md) —— D2 / D3 / D5 / D10 / D11 / D12 / D13 / D20、需求 A、US1–US7。
