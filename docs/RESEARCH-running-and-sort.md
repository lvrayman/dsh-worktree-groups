# 调研报告：需求 A（subagent 运行中也要显示 running）与需求 B（新会话排最上面）

- **任务 ID**：T1（调研，只读）
- **调研对象**：`/Users/dev/Documents/Project/AnyWork/dsh-worktree-groups`（插件）
  与 `/Applications/DSH Desktop.app/Contents/Resources/app/`（DSH 本体 checkout，只读参考）
- **基线**：`11b1144`（HEAD，253/253 测试全绿，实测 `node --test` 通过）
- **本文件是本次调研唯一写入的产物**；未改 `src/**`、`lib/**`、`test/**`、`package.json`、其他 `docs/**`，未 commit。

> **证据分级约定**
> - 【确证】= 我实际读到的源码/实跑结果，附 `file:line` 与片段。
> - 【推测】= 由代码推断但未在真实 GUI 复现的结论。
> - 【实测数据】= 我在本机 `~/.dsh/sessions` 上跑的只读统计。

---

## 0. 一句话结论

| 需求 | 结论 | 改动量级 |
|---|---|---|
| **A** | 数据**已经全在插件手里**（HTTP `/tree` 载荷里就有 subagent 会话行，且带 `running`）。缺的只是 `tree-model.ts` 里「父行的 `running` 只读自己」这一步推导 —— 加一个「运行中 subagent 后代数 > 0 ⇒ 父行 running」的推导即可，**不需要任何新的宿主 API 或订阅**。 | 小（`tree-model.ts` 一个纯函数 + 若干测试） |
| **B** | 排序比较器是 `tree-model.ts` 的 `byRecency`（`updatedAt` 降序），新会话在**默认模式**下靠 `updatedAt` 天然靠前；但在**手动排序模式**下 `applyManualOrder` 把它追加到**末尾**，且被 5 条截断吃掉后**整行不可见**。另外「新建会话」按钮走的是宿主 `connectWorkspace`，它会**复用**该 workspace 下已存在的旧 blank 会话 ⇒ 该行 `updatedAt` 很旧，**默认模式下也可能排在末尾**。 | 中（`applyManualOrder` 新增「置顶」语义 + 截断交互 + 拖拽冲突策略） |

---

## 1. 需求 A 现状：running 标识在哪些文件/函数计算

### 1.1 标识的完整数据链路（自下而上）

```
宿主 Agent 运行状态 (dsh-agent-loop:773 get status)
  → agent/status 事件 (dsh-agent-loop:781)
  → 宿主 api-session/status (dsh-api-session-controller/lib/index.js:2755-2757)
  → SessionSummary.running (dsh-api-session-controller/lib/types/list.js:93)
  → 插件 HTTP /tree 载荷 SessionRow.running (src/routes.ts:441)
  → tree-model RenderRow.running (src/tree-model.ts:917)
  → sidebar StatusDot state (src/sidebar.tsx:366-374)
```

**逐段证据**

**① 宿主侧 `running` 的唯一真源 = agents 注册表里该会话对应 Agent 的 status**【确证】

`node_modules/@deepseek-ai/dsh-api-session-controller/lib/types/list.js:87-98`：

```js
summaryFor(session) {
    const projections = this.projectionsFor(session.header, session);
    const metadata = projections?.values.sessionListMetadata;
    return {
        sessionId: session.id,
        updatedAt: updatedAt(session.header, metadata),
        running: this.ctx.agents.get(session.id)?.status === 'running',   // ← 真源
        blank: metadata?.blank ?? session.seq === 0,
        ...listFields(session.header),
        ...(projections === undefined ? {} : { projections }),
    };
}
```

（同源副本：`dsh-api-session-controller/lib/index.js:1818`。）

`running` 的定义在 `dsh-agent-loop/lib/index.js:773-775`：

```js
get status() {
    return this.phase.kind === "idle" || this.phase.kind === "maintenance" ? "idle" : "running";
}
```

变更事件在 `:781`：`if (status !== previousStatus) this.dispatch.emit("agent/status", { status });`
宿主把它转成远端事件：`dsh-api-session-controller/lib/index.js:2755-2757`

```js
ctx.on("agent/status", ({ agent, status }) => {
    ctx.emit("api-session/status", agent.id, status === "running");
});
```

**② 冷会话（无 live Agent）恒 `running: false`**【确证】

`dsh-api-session-controller/lib/types/list.js:125-137` 的 `summarizeCold()` 写死 `running: false`。
⇒ 只有**进程内活着**的会话才可能有 `running: true`。

**③ 插件 HTTP 面**：`src/routes.ts:438-443`

```ts
const row: SessionRow = {
  sessionId,
  updatedAt,
  running: summary?.running === true,   // ← 只透传，不做任何 subagent 聚合
  blank: summary?.blank === true,
}
```

摘要来源三级降级：`src/routes.ts:289-376` 的 `loadSessionSummaries()`，权威源是
`ctx.sessionController.list({}, signal)`（`:295-298`）；活 `Session` 实例兜底时 `running` 被写死 `false`（`src/routes.ts:336`，测试锁定于 `test/routes.test.mjs:1635`）。

**④ view model**：`src/tree-model.ts:903-928` 的 `toSessionRow()`

```ts
running: session.running === true,     // :917  ← 原样透传，无 subagent 参与
subagentCount,                          // :920  ← 运行中 subagent 后代数（另一条独立通道）
```

**⑤ 渲染**：`src/sidebar.tsx:366-374`

```tsx
function StatusDot(props: { running?: boolean; pending?: boolean; completed?: boolean }): ReactNode {
  const state = props.pending === true
    ? 'warning'
    : props.running === true
      ? 'ongoing'          // ← 蓝色像素矩阵动画
      : props.completed === true
        ? 'done'
        : 'idle'
  return jsx(P.StateDot, { state, size: 10 })
}
```

唯一调用点：`src/sidebar.tsx:973-977`，入参 `running: row.running`（**只有** `row.running`，不看 `subagentCount`）。

**⑥ 计数胶囊是另一条独立通道**：`src/sidebar.tsx:986-993`（`subagentCount > 0` 才画），
`subagentCount` 由 `indexRunningSubagentDescendants()`（`src/tree-model.ts:558-594`）计算 —— 它**已经**正确统计了「运行中的 subagent 后代数」。

### 1.2 「当前为何仅主 agent 运行时才为真」

因为 `RenderRow.running` **只**来自该会话自己的 `SessionSummary.running`（`src/tree-model.ts:917` ← `src/routes.ts:441` ← `list.js:93` 的 `agents.get(session.id)`），
而 `subagentCount` 是**并列的第二个字段**，渲染层只把它画成计数胶囊（`src/sidebar.tsx:986-993`），**从不参与状态点**。

**实跑验证**（我用编译产物 `lib/tree-model.js` 直接跑）：

```
parent row: {"running":false,"subagentCount":1}
=> StatusDot state (sidebar.tsx:366-374) = idle
```

即：主 agent 空闲 + 1 个 subagent 在跑 ⇒ 状态点是**灰色 idle**，而原生此时是 **ongoing**。

### 1.3 与原生行为的差距（重要）

原生 `dsh-client-ui-workspace/lib/client.js:783-829` 的 `sessionStatuses()`：

```js
function sessionStatuses(node, t) {
    const subagents = node.runningSubagentCount === 0 ? void 0 : {
        state: "ongoing",
        label: t(node.runningSubagentCount === 1 ? "status.subagentsRunning.one" : "status.subagentsRunning.other", { n: node.runningSubagentCount })
    };
    ...
    if (pending !== void 0) return subagents === void 0 ? [pending] : [pending, subagents];
    if (node.running) { const primary = { state: "ongoing", label: t("status.running") }; return ...; }
    if (subagents !== void 0) return [subagents];      // ← :820 只有 subagent 在跑 ⇒ 主状态点就是 ongoing
    ...
}
```

`node.runningSubagentCount` 的来源是 `client.js:423`：

```js
runningSubagentCount: descendants.get(s.id)?.runningCount ?? 0,
```

⇒ **原生在「只有 subagent 在跑」时，状态点也是 ongoing（蓝）**；本插件因为 `StatusDot` 只看 `row.running`，此场景退化为 idle。**这就是需求 A 的缺口**【确证】。

---

## 2. 需求 A 可行数据源清单

> **核心发现：不需要任何新数据源。** 插件 HTTP `/tree` 载荷里**已经包含 subagent 会话行，并且已带正确的 `running` 值**。

### 2.1 候选 ①：HTTP `/tree` 载荷（**已在本插件现有数据流中，推荐**）

**证据链**

1. 宿主 `sessionController.list()` 返回**全量**会话（含 subagent），不按 origin 过滤 ——
   `dsh-api-session-controller/lib/types/list.js:104-124` 的 `list()` 遍历 `sessionQuery.listSessions()` 的全部 records；
   `dsh-session-query/lib/index.js:94-115` 的 `listSessions()` 也不过滤 `origin`。
2. 宿主 `summaryFor()` 对 subagent 会话同样用 `agents.get(session.id)?.status` ⇒ subagent 的 `running` 是**真的**
   （子代理是真实 Agent：`dsh-subagent-in-process-driver/lib/index.js:180-189` 与
   `dsh-subagent/lib/index.js:1071-1086` 都走 `agents.create({ parentAgent: parent, ... })`）。
3. 插件 `toSessionRow()` 把 `origin === 'subagent'` 与 `parentSessionId` 都投影进 `SessionRow`
   （`src/routes.ts:431-447`），**没有任何地方丢弃 subagent 行**。
4. **实测**（用 `lib/projects.js` 的 `buildProjects` 直接跑，两个会话：父 + 运行中的 subagent）：

```
payload session ids: [ 'child', 'parent' ]
child: { sessionId:'child', running:true, parentSessionId:'parent', origin:'subagent', cwd:'/tmp/x' }
```

⇒ **`running: true` 的 subagent 行已经在 `ProjectNode.worktrees[].sessions` 数组里了**。
插件只是**故意**在 `tree-model.ts:879-885` 的 `isVisibleMember()` 里把它过滤掉不渲染成行
（对齐原生 `sessionVisible`，见提交 `e9b5dbc`），但**过滤发生在 view-model 推导阶段，不在 HTTP 组装阶段**。

| 项 | 评估 |
|---|---|
| 可用性 | ✅ 立即可用，零新增宿主依赖 |
| 映射到父会话 | ✅ 已有现成实现：`indexRunningSubagentDescendants()`（`src/tree-model.ts:558-594`）沿 `parentSessionId` 上溯到第一个非 subagent 祖先 |
| 订阅 or 轮询 | 轮询 —— 已在既有 30s 轮询 + 快照防抖重取链路里（`src/sidebar.tsx:1654-1670`、`TREE_REFRESH_MS = 30_000` @ `:144`、`RELOAD_DEBOUNCE_MS = 220` @ `:147`）。**注意 30s 延迟问题见 §6** |
| 是否已在本插件数据流 | ✅ 已完全在（`routes.ts` → `ProjectNode.sessions` → `buildRows`） |

**关键限制（必须知道）**：因为索引建立在 `allSessionsOf(input)`（`src/tree-model.ts:609-618`）之上，
而 `buildProjects` 会**丢弃归档会话**（`src/projects.ts:400` `if (archived.has(session.sessionId)) continue`），
所以「已归档的 subagent」不会出现在输入里。这与现有 `subagentCount` 的口径**一致**（同一份输入、同一个索引），
但与原生 `indexSubagentDescendants(list.byId)`（未过滤）**有细微差异**：
现有测试 `test/tree-model.test.mjs:1397-1416` 断言的「归档的子代理仍计入父行计数」在**真实 HTTP 链路**下其实做不到（输入里没有它），
只在纯函数单测里成立（单测直接喂了归档会话）。**这是既有测试与真实链路的口径缝隙，本次改动不要踩进去。**

### 2.2 候选 ②：客户端 `useSessions` 快照的 `byId`（live fact，可作实时覆盖层）

**证据**

- 快照由 `dsh-api-session-controller/lib/types/client/sessions/service.js:435-455` 的 `projectList()` 构造，
  每个条目含：`id / displayTitle / running / completed? / blank / updatedAt / parentId? / origin?`：

```js
byId[entry.sessionId] = {
    id: entry.sessionId,
    displayTitle: displayTitleOf(entry.title, entry.cwd, entry.sessionId),
    running: entry.running,
    ...(entry.completed ? { completed: true } : {}),
    blank: entry.blank,
    updatedAt: entry.updatedAt,
    ...(entry.parentSessionId !== undefined ? { parentId: entry.parentSessionId } : {}),
    ...(entry.origin !== undefined ? { origin: entry.origin } : {}),
};
```

- 该快照经 `dsh-client-ui-session/lib/client.js:321-324` 暴露为 `hooks.sessions`，
  插件已在消费：`src/sidebar.tsx:1589`（`const sessionsSnapshot = sources.sessions(identity)`；source 冻结于 `:1581-1585`）。
- 子代理的 live 活动还有一条**更强**的通道：`manager.js:215-219`

```js
if (child?.kind === 'child') {
    session.handleBlank(false);
    session.handleRunning(child.activity === 'running');
}
```

以及 `manager.js:277` `const result = await this.remote.subagents.list(parentSessionId);`
—— **但这条只在某个父目录被打开/选中时才拉取**（`setSubagentCatalogOpen`，`manager.js:338-347`；
调用方 `dsh-client-ui-subagent/lib/client.js:844`）。

| 项 | 评估 |
|---|---|
| 可用性 | ✅ 运行时可用（条目确实带 `running`/`origin`/`parentId`） |
| 映射到父会话 | ⚠️ 需要自行按 `parentId` 上溯（快照里子代理条目的 `parentId` 只指直接父） |
| 订阅 or 轮询 | ✅ 订阅（`useSyncExternalStore`，`agent/status` 推送驱动，毫秒级） |
| 是否已在本插件数据流 | ⚠️ 部分 —— 快照已被消费，但 `SessionSnapshotEntry`（`src/sidebar.tsx:413-416`）**只声明了 `completed`**，未声明 `running`/`origin`/`parentId` |
| 主要缺陷 | 条目覆盖度不确定：`byId` 只含 host list 项 + 当前寻址链上的子代理（`service.js:459-486`），**深层/未寻址的子代理可能不在快照里** ⇒ 不能作为唯一真源 |

### 2.3 候选 ③：宿主侧 `ctx.agents` 注册表（**不推荐**）

- 服务名确证：`dsh-agent/lib/index.js:299` `super(ctx, "agents")`。
- `get(id)` @ `:563-565`、`list()` @ `:581-583`、`roots()` @ `:588`（返回 `owner === undefined` 的顶层 agent）。
- **本插件无法直接用它**：它是**宿主半边**服务，客户端半边没有；且插件架构刻意不静态 import 宿主包
  （`src/routes.ts:56-62` 的注释与「结构性类型」约定）。
- 若在宿主半边用：需要把 `agents.list()` 的 status 逐个映射到会话 id，再按 `parentSessionId` 上溯 —— 与候选 ① 等价但多一层耦合。
- 补充：`agent/status` / `subagent/start` / `subagent/end` 是宿主事件
  （`dsh-scope/lib/invariant.js:9-37` 的 scoped-event 表；`dsh-subagent/lib/types/lifecycle.js:66-75` 发射），
  **客户端插件不能直接订阅宿主 Cordis 事件**（跨半边，只走 `ctx.remote.$on('api-session/*')`，`dsh-api-session-controller/lib/types/client/index.js:22-35`）。

| 项 | 评估 |
|---|---|
| 可用性 | ⚠️ 仅宿主半边；跨半边不可达 |
| 订阅 or 轮询 | 事件（`agent/status`），但需宿主侧转发 |
| 结论 | **不采纳** —— 收益为零（候选 ① 已有同样信息），成本是新增加宿主半边代码 + 新契约面 |

### 2.4 数据源结论

**只用候选 ①**（HTTP 载荷 + 现有 `indexRunningSubagentDescendants`）。它已在数据流里、是纯函数、可被 `node --test` 覆盖、与现有 `subagentCount` 同一份索引，一致性天然保证。

候选 ② 可作为**后续**的实时性增强（把 30s 轮询延迟降到毫秒级），但属于可选项，不是本需求必需。

---

## 3. 需求 A 建议改动点（最小方案）

### 3.1 改动 1（核心，唯一必需）：`src/tree-model.ts`

在 `emitContainer()`（`src/tree-model.ts:941-1004`）里把父行的 `running` 与 `subagentCount` 合并。

**方案**：`toSessionRow()` 增加一个入参（或直接复用已有的 `subagentCount`）：

```ts
// src/tree-model.ts:903 附近
function toSessionRow(
  session: SessionRowLike,
  depth: number,
  subagentCount: number,
  spec: ContainerSpec,
  context: EmitContext,
): RenderRow {
  const base = {
    ...
    // 需求 A：主 agent 空闲但存在运行中的 subagent 后代 ⇒ 同样视为 running
    // （对齐原生 sessionStatuses，dsh-client-ui-workspace/lib/client.js:820）
    running: session.running === true || subagentCount > 0,
    ...
  }
}
```

调用点两处，都**已经**把 `subagentCount` 传进来了，无需改签名：

- `src/tree-model.ts:977-985`（`emitContainer` 内）
- `src/tree-model.ts:1115-1117`（`buildSearchRows` 内，`toSessionRow` 调用在 `:1116`）

**为什么放在 `toSessionRow` 而不是各调用点**：搜索行（`buildSearchRows`）与树行走同一个构造函数，
放这里 ⇒ 两条路径自动同源，不会出现「树里改了、搜索里忘了」（与 `isVisibleMember` 单一谓词同一设计原则）。

### 3.2 改动 2（一致性，建议一并做）：容器/项目行的 `runningCount`

`src/tree-model.ts:1000` 目前是：

```ts
runningCount: heads.filter((session) => session.running === true).length,
```

若要让「容器/项目行的 running 计数」与新的行语义一致，应改为「该容器内 `running || subagentCount>0` 的行数」。
**但这是一个产品决策，不是需求 A 的字面要求** —— 见 §6 待确认项 Q1。最小改动**可以不动**它。

⚠️ 注意：`runningCount` 在渲染层**目前没有任何消费者**（`grep runningCount src/sidebar.tsx` 为空；
唯一断言在 `test/tree-model.test.mjs:1751`）。所以不动它不会产生视觉差异。

### 3.3 改动 3（可选，实时性）：`src/sidebar.tsx` 的 live 覆盖层

若要把「subagent 开始跑」的视觉延迟从 ≤30s 降到毫秒级，在 `withLiveState()`（`src/sidebar.tsx:493-509`）
里用候选 ② 的 `byId` 推导 `runningSubagentCount` 并覆盖 `row.running`：

- 需要扩展 `SessionSnapshotEntry`（`src/sidebar.tsx:413-416`）声明 `running?: unknown` / `origin?: unknown` / `parentId?: unknown`；
- 需要新增一个纯函数（建议放 `tree-model.ts` 以便测试）从 `byId` 推导计数 —— 语义与 `indexRunningSubagentDescendants` 必须一致。

**建议：本期不做**，先落改动 1 验证效果（§6 Q2 请父代理定）。

### 3.4 必须同步更新的测试

| 文件 | 断言 | 说明 |
|---|---|---|
| `test/tree-model.test.mjs:1710-1729`「行字段: pendingInteraction 只在有值时出现，running/completed 归一为布尔」 | **会受影响** —— 该用例用 `session('p', {running:true})` 与普通会话断言 `running` 透传；普通会话无 subagent ⇒ `subagentCount=0` ⇒ 结果不变，**大概率仍通过**，需实跑确认 | 必跑 |
| `test/tree-model.test.mjs:1249-1283`「subagentCount = 运行中的子代理数；全不 running ⇒ 0」 | 该用例的**父会话**在 `idleAll` 分支下 `running` 会**从 false 变成 false**（计数为 0）⇒ 不变；在 `runningParent` 分支父行 `running` 会**从 false 变成 true**（计数 1）。用例只断言 `subagentCount`，**不受影响**，但应**新增**对 `running` 的断言 | 新增断言 |
| **新增用例（必须）** | ① 主 agent 空闲 + 1 个 running subagent ⇒ 父行 `running === true` 且 `subagentCount === 1`；② 主 agent 空闲 + subagent 全 idle ⇒ 父行 `running === false`；③ 多层（孙）在跑 ⇒ 父行 `running === true`（与 `subagentCount` 同源）；④ 搜索模式下同样 `running === true`（`buildSearchRows` 路径）；⑤ 不修改入参 | 新测试 |
| `test/routes.test.mjs` | **不需要改** —— HTTP 面契约不变（`SessionRow.running` 仍是该会话自己的值），聚合发生在客户端 view-model | — |

---

## 4. 需求 B 现状：会话排序比较器与新会话插入位置

### 4.1 排序比较器（**两处**，职责不同）

**① 宿主半边：`src/projects.ts:83-86`**（决定 `ProjectNode.*.sessions` 数组的初始顺序）

```ts
function compareSessions(a: SessionRow, b: SessionRow): number {
  if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt
  return a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0
}
```

调用点：`src/projects.ts:442-444`（worktrees / history / flatSessions）、`:456`（ungrouped）。

**② 客户端 view-model：`src/tree-model.ts:625-635`**

```ts
function byRecency<T extends { sessionId: string; updatedAt: number }>(a: T, b: T): number {
  if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt
  if (a.sessionId === b.sessionId) return 0
  return a.sessionId < b.sessionId ? -1 : 1
}
function sortedByRecency<T ...>(sessions: T[]): T[] { return [...sessions].sort(byRecency) }
```

（与原生 `byRecency` @ `dsh-client-ui-workspace/lib/client.js:325-328` 逐字对齐。）

**排序键 = `updatedAt`（降序），tiebreak = `sessionId` 升序。没有第三个键。**

`updatedAt` 的来源：`src/routes.ts:429`

```ts
const updatedAt = finiteNumber(summary?.updatedAt) ?? finiteNumber(header?.createdAt) ?? 0
```

而 `summary.updatedAt = Math.max(header.createdAt, metadata?.lastPromptAt ?? 0)`
（`dsh-api-session-controller/lib/types/list.js:284-286`）—— **不是 `Date.now()`**，是「创建时间 与 最后一次用户消息时间」的较大者。

### 4.2 新会话插入时如何决定位置

**默认模式（`manualOrder.manual !== true`）**：`src/tree-model.ts:948-952`

```ts
const heads = applyManualOrder(
  sortedByRecency(visibleMembers(spec, context)),
  sessionOrderOf(context.manualOrder, spec.key),   // manual!==true ⇒ 恒 undefined
  (session) => session.sessionId,
)
```

`sessionOrderOf()`（`src/tree-model.ts:304-307`）在 `manual !== true` 时返回 `undefined`
⇒ `applyManualOrder` 在 `order === undefined` 时**原样返回浅拷贝**（`src/tree-model.ts:266`）
⇒ 位置**完全由 `updatedAt` 降序决定**。

⇒ **全新会话**（`header.createdAt` = 刚刚）的 `updatedAt` 最大 ⇒ **天然排在最前**。**实跑确认**：

```
default   : ["new","o6","o5","o4","o3","o2","MORE(2)"]     // new 在最前 ✅
```

**但有两个会破坏「新会话在最前」的现实场景**（都【确证】）：

**场景 B-1：新建会话按钮复用旧 blank 会话** ⇒ 位置很旧。

`src/sidebar.tsx:1754-1768` 的 `newSession()` → `actions.startSession(workspaceId)`
→ `src/client.tsx:171-179` → 原生 `uiWorkspace.startSession(workspaceId)`
（`dsh-client-ui-workspace/lib/client.js:81-96`）→ `openWorkspace()` → `connectWorkspace()`：

```js
// dsh-client-ui-workspace/lib/client.js:44-60
async connectWorkspace(workspaceId) {
    ...
    for (const id of sessions.ids) {
        const summary = sessions.byId[id];
        if (summary !== void 0 && summary.blank && summary.cwd === workspace.path
            && workspace.sessionIds.includes(summary.id) && !archived.includes(summary.id)) return summary.id;   // ← 复用！
    }
    const attempt = this.sessions.create({ workspaceId }).finally(...)
```

⇒ 若该 workspace 下已有历史遗留的 blank 会话，点击「新建会话」**不会创建新会话**，而是复用它。
该会话的 `updatedAt` 是它当初的创建时间（可能很旧）⇒ **默认模式下它排在容器末尾**。**实跑确认**：

```
reused OLD blank (updatedAt=1), default  : ["o7","o6","o5","o4","o3","b(blank)","MORE(3)"]   // b 在最后 ❌
```

（`blank` 会话**不占 5 条名额**但**保持输入顺序**：`truncateSessions` 的 blank 分支是 `visible.push(session); continue`，见 `src/tree-model.ts:702-705`，**没有**「blank 置顶」逻辑。）

**场景 B-2：手动排序模式** ⇒ 新会话被追加到**末尾**。

`applyManualOrder`（`src/tree-model.ts:260-290`）的语义是明确的：

```ts
// :285-288
// 列表外的项：保持传入时的相对顺序，追加到末尾。
for (let i = 0; i < copy.length; i += 1) {
  if (!taken.has(i)) ordered.push(copy[i])
}
```

文档也写死了这个语义：`src/tree-model.ts:216-219`、`docs/PRD.md:310`「新会话出现在容器**末尾**」、`docs/INTERFACES.md:550`、`docs/INTERFACES.md:656`。

**实跑确认（这是最严重的一档）**：

```
manual, new blank current          : ["o0","o1","o2","o3","o4","new","MORE(15)"]   // 靠「当前会话保底」才可见，但在第 6 位
manual, new after 1st message      : ["o0","o1","o2","o3","new","MORE(16)"]        // 第 5 位
manual, new non-current (after msg): ["o0","o1","o2","o3","o4","MORE(4)"]           // ❌ 整行不可见！
manual, new non-current (still blank): ["o0","o1","o2","o3","o4","MORE(3)"]         // ❌ 整行不可见！
```

⇒ **手动排序模式下，新建会话可能既不在最前、也不可见**（被 5 条截断吃掉，只剩 `MORE(4)`）。
只有「它是 `currentSessionId`」时，才靠 `truncateSessions` 的保底提升（`src/tree-model.ts:688-696`、`:706-714`）挤进可见 5 条 —— 且位置是**第 `quota` 位（第 5/6 位）**，不是第一位。

### 4.3 提交 `11b1144`（三层拖拽排序）与「新会话插到最前」的交互

`11b1144` 引入的关键机制（从 commit message 与代码确证）：

1. **顺序持久化到 `localStorage` 键 `dsh-worktree-groups.order`**（`src/sidebar.tsx:141` 的 `LS_ORDER`；
   读写 `:273-311`；结构 `ManualOrder` @ `src/tree-model.ts:221-230`）。
2. **首次拖拽即全量固化三层顺序**（`src/sidebar.tsx:1844-1856` 的 `commitDrag`，输入是
   `effectiveOrder({...treeInput, manualOrder: undefined})` 的**纯默认顺序**，`src/tree-model.ts:1155-1215`）。
   这一条的目的就是「固化后新消息**不再**把会话顶到前面」（`docs/PRD.md:309-311`）。
3. **固化之后，新会话落在末尾** —— 这是**已被测试锁定的行为**：
   `test/tree-model.test.mjs:2439-2456`「D10 固化: 固化之后**新建的会话**落在容器末尾（顺序表里没有它）」，
   断言 `['a-old','a-new','a-fresh']`；同理 `:2458-2484` 锁定新建 worktree/项目落末尾；
   `:1848-1853` 锁定 `applyManualOrder` 的「列表外新项追加到末尾」。

**冲突分析（这是需求 B 的核心矛盾）**

| 语义 | 现状 | 需求 B 要求 |
|---|---|---|
| 默认模式新会话位置 | `updatedAt` 最大 ⇒ 最前（**但复用旧 blank 时例外**） | 最前 ✅ 已基本满足 |
| 手动模式新会话位置 | **末尾**（`applyManualOrder` :285-288），且可能被截断隐藏 | 最前 ❌ **直接冲突** |
| 冲突时的现有处理 | **没有冲突处理** —— `applyManualOrder` 对「不在 `order` 里的项」一律走末尾分支，**不区分**「新项」与「用户从没排过的项」 | — |

⇒ **需求 B 与 `11b1144` 的「固化即冻结顺序」承诺存在直接冲突**：
`docs/PRD.md:306-311` 明确承诺「拖拽之后在某个容器里发一条新消息 ⇒ 该会话**不会**被顶到容器最前（顺序已冻结）；
新会话出现在容器**末尾**」。需求 B 要的「新会话排最上面」正是在推翻后半句。

**必须由父代理/用户裁决的口径**（见 §6 Q3）：
- 选项 α：**只改「新会话」**（`blank` 会话 / 从未进过 `order` 表的会话）⇒ 置顶；「已有会话收到新消息」仍冻结。
- 选项 β：**新会话与收到新消息的会话都置顶** ⇒ 等于放弃 `11b1144` 的「不再顶到前面」承诺，退回 `orderBy: 'updated'` 的原生行为。
- 选项 γ：保持现状，只在**默认模式**下修「复用旧 blank」的 B-1 场景。

---

## 5. 需求 B 建议改动点

### 5.1 「该 worktree 分组内最前」vs「全局最前」—— 两种语义的区分

**先说清楚插件里根本没有「全局」这一层**【确证】：

- 渲染顺序是 `project → worktree → session` 三级（`src/tree-model.ts:1321-1427`）；
- **会话行永远隶属于某个容器**（`ContainerSpec` @ `src/tree-model.ts:336-347`：`worktree` / `history` / `project`(flat) / ungrouped），
  `RenderRow.parentKey` 恒非空（`src/tree-model.ts:922`）；
- `applyManualOrder` 的会话层键是**容器 key**（`sessions: Record<string, string[]>`，`src/tree-model.ts:227`）。

⇒ **「会话排最前」只可能是「该容器（worktree / history / flat / ungrouped）内最前」**。
若用户想要的是「新会话所在的项目行/worktree 行也提到最前」（真正的全局置顶），那是**另外两层**的改动（`projects` / `worktrees` 顺序表），见 §5.3 边界情况。

### 5.2 建议实现：给 `applyManualOrder` 增加「置顶集合」入参（最小侵入）

**改动点 1：`src/tree-model.ts:260-290` `applyManualOrder`** —— 新增可选第 4 参：

```ts
export function applyManualOrder<T>(
  items: T[],
  order: string[] | undefined,
  keyOf: (item: T) => string,
  /**
   * 需要**置顶**的项（需求 B：新建会话）。按此数组顺序排在最前，
   * 其余项仍走原有语义（order 内按索引、order 外按默认顺序追加到末尾）。
   * 缺省 / 空 ⇒ 与改动前逐字一致（零回归）。
   */
  pinnedKeys?: readonly string[],
): T[] {
  const copy = [...items]
  const pinned = pinnedKeys === undefined ? [] : [...pinnedKeys]
  if (pinned.length === 0 && (order === undefined || order.length === 0)) return copy
  // ... 先在 copy 里按 pinned 顺序取出置顶项（taken 集合复用），再走原有逻辑
}
```

**改动点 2：`src/tree-model.ts:948-952`（`emitContainer`）与 `:1171-1175`（`effectiveOrder` 的 `order` 闭包 @ `:1167-1175`）**
把「哪些会话该置顶」算出来传进去。

置顶判据（**推荐**，最小冲突）：`session.blank === true && session.sessionId === context.currentSessionId`
⇒ 只把「当前打开的、尚未发过消息的新会话」置顶。这样：

- 复用旧 blank 的场景 B-1 ✅ 修好（它是 current 且 blank）；
- 已有会话收到新消息 ⇒ `blank` 变 false（`manager.js:880-882`：`blank: summary.blank && !mutation.running`，
  且 `running:true` 时 `blank` 被清）⇒ **不置顶**，`11b1144` 的冻结承诺**保持**；
- 与 `truncateSessions` 的保底提升语义天然重合（它已经专门处理 current 会话），但把位置从「第 quota 位」提升到「第 1 位」。

**备选判据**（若父代理选 §6 Q3 的选项 β）：把「`order` 列表里没有的会话」全部置顶 ⇒ 但那样会同时打破 `test/tree-model.test.mjs:2395-2437`（固化后新消息不顶到前面）与 `:2439-2456`（新会话落末尾），**需要重写这两条既有测试**，且等于回退 `11b1144` 的核心承诺。**不推荐**。

### 5.3 边界情况清单

| # | 边界 | 现状 | 建议 |
|---|---|---|---|
| E1 | **首次出现的新 worktree 行是否也要置顶？** | 不置顶，落项目末尾（`src/tree-model.ts:1334-1338` + `applyManualOrder` :285-288；测试 `test/tree-model.test.mjs:2458-2484`） | 保持不置顶。理由：worktree 行是**持久结构**，用户拖过一次后不该被新建动作打乱；且 `docs/PRD.md:311` 明文承诺「新建的 worktree / 项目同样出现在各自列表末尾」。**除非用户明确要求，否则不改。** |
| E2 | **首次出现的新项目行是否也要置顶？** | 同 E1（`src/tree-model.ts:1318-1319`） | 同 E1 |
| E3 | **未分组容器** | 未分组行恒为最后一个 project 行（`src/tree-model.ts:1411-1426`），其会话容器 key = `p:${UNGROUPED_KEY}` | 置顶逻辑对未分组**同样适用**（容器内语义），无需特判 |
| E4 | **history 容器** | 容器 key = `h:<projectKey>`（`src/tree-model.ts:1198-1200`） | 新会话不可能落在 history（history 是「worktree 目录已消失」的桶，新会话的 cwd 是活目录），**无需处理** |
| E5 | **5 条截断** | `truncateSessions`（`src/tree-model.ts:677-734`）在手动顺序**之后**执行（`src/tree-model.ts:948-963`） | 置顶必须发生在**截断之前**（与现有 `applyManualOrder` 位置相同）⇒ 置顶行必进前 5 条 ✅。这正是需求 B 的必要条件（否则 B-2 场景仍不可见） |
| E6 | **`blank` 不占名额** | `src/tree-model.ts:702-705` | 置顶后：blank 新会话在第 1 位且不占名额 ⇒ 其余 5 条照常显示 ✅ |
| E7 | **拖拽顺序持久化数据结构是否需要迁移？** | `ManualOrder`（`src/tree-model.ts:221-230`）= `{manual, projects?, worktrees?, sessions?}`；`readManualOrder()`（`src/sidebar.tsx:273-292`）对结构不合法者退化为 `EMPTY_ORDER`（`:232`） | **不需要迁移**。置顶是**运行时推导**（由 `currentSessionId` + `blank` 决定），**不写进 `localStorage`**。这样：① 不改持久化格式；② 不污染用户的拖拽结果；③ 关闭新会话后它自然回到原位置 |
| E8 | **「恢复默认排序」** | 菜单项 `menu.resetOrder`（`src/locales.ts:57`），动作 `src/sidebar.tsx:2358-2362` | 不受影响 |
| E9 | **搜索模式** | 刻意**不应用**手动顺序（`src/tree-model.ts:1110-1114`，排序在 `:1114`），按 `updatedAt` 降序 | 置顶也**不应用**到搜索（保持一致）。新会话在搜索里按 `updatedAt` 排 —— 若它是复用的旧 blank，搜索里也不会靠前（可接受，属既有行为） |
| E10 | **`currentSessionId` 缺席**（极端时序：树先到、快照后到） | `truncateSessions` 的保底提升失效 | 置顶同时失效 ⇒ 退化为现状，**不崩**。这是可接受的降级 |
| E11 | **新会话是 subagent** | 不可能（subagent 由宿主创建，`blank` 恒 false，见 `manager.js:507` `blank: false`） | 无需处理 |

### 5.4 必须同步更新的测试

| 文件:行 | 用例 | 处理 |
|---|---|---|
| `test/tree-model.test.mjs:1848-1853` | `applyManualOrder: 列表外的**新项**追加到末尾（新建会话的落点）` | **保留**（第 4 参缺省时的语义不变），**新增**一条「传 `pinnedKeys` 时置顶」的用例 |
| `test/tree-model.test.mjs:2439-2456` | `D10 固化: 固化之后**新建的会话**落在容器末尾` | **必须改写** —— 若新会话是 current+blank，现在应**置顶**。建议拆成两条：① 非 current 的新会话仍落末尾；② current+blank 的新会话置顶 |
| `test/tree-model.test.mjs:2395-2437` | `D10 固化: 固化后新消息**不再**把会话顶到前面` | **保持不变**（新消息使 `blank` 变 false ⇒ 不置顶）—— 这是选项 α 的守卫 |
| `test/tree-model.test.mjs:2458-2484` | `D10 固化: 新建的 worktree / 项目同样落在末尾` | **保持不变**（E1/E2 不改） |
| `test/tree-model.test.mjs:2066-2144` | `buildRows: manualOrder.sessions …` / `手动顺序先于 5 条截断生效` / `不破坏当前会话保底进前 5` | 需检查：`:2116-2144` 的「保底进前 5」用例若 current 会话同时是 blank，位置会从第 5 位变成第 1 位 ⇒ **可能需改断言** |
| `test/tree-model.test.mjs:1633-1647` | `行字段: 当前会话 isCurrent=true 且保底进入可见集` | 该用例的 current 会话 `s0` **非 blank** ⇒ 不受置顶影响，**应仍通过** |
| `test/tree-model.test.mjs:2316-2357` | `simulateDrag()` 辅助函数（与 `sidebar.tsx` 的 `commitDrag` 同构） | 若 `commitDrag` 的固化输入 `effectiveOrder` 行为变化（置顶会让「固化时的默认顺序」变化），**必须同步** —— ⚠️ 注意 `effectiveOrder`（`src/tree-model.ts:1148`）**不产出未分组行**且**不截断**，置顶会影响它产出的 `sessions` 顺序 ⇒ **首次拖拽固化的顺序会变**，需评估 |
| `test/routes.test.mjs` | — | **不需要改**（排序是客户端 view-model 的事） |
| **新增** | ① `current+blank` 会话在 manual 模式下置顶；② 非 current 的 blank 不置顶；③ 置顶与 5 条截断的顺序（置顶行必在前 5）；④ 置顶项与 `order` 里的项重复时不重复搬运；⑤ 置顶项不在 `items` 里时忽略；⑥ 缺省 `pinnedKeys` ⇒ 与改动前逐字一致（零回归） | 新测试 |

---

## 6. 未知 / 不确定项清单（需父代理向用户确认或真实 GUI 验证）

| # | 项 | 为什么无法从代码确认 | 建议 |
|---|---|---|---|
| **Q1** | **容器/项目行的 `runningCount` 是否也要把「运行中的 subagent」算进去？** | `runningCount`（`src/tree-model.ts:1000`、`:1363`、`:1381`、`:1400`、`:1423`）在渲染层**没有任何消费者**（已 grep 确认），所以代码里看不出预期语义；需求 A 字面只说「显示 running 标识」 | 问用户。默认建议：**不动**（避免超范围） |
| **Q2** | **需求 A 是否要求「实时」？** | 走 HTTP 轮询时有 ≤30s 延迟（`TREE_REFRESH_MS` @ `src/sidebar.tsx:144`）+ 220ms 防抖（`:147`）。宿主快照变化会触发重取（`:1654-1658`），但 subagent 状态变化**是否**导致 `sessionsSnapshot` 引用变化取决于 `agent/status` 是否被 `markDirty` —— `manager.js:524-530` 的 `recordMutation` 确实 `markDirty()`，所以**理论上**秒级；但未在 GUI 实测 | 若用户抱怨延迟，再做 §3.3 的 live 覆盖层。**需真实 GUI 验证** |
| **Q3** | **需求 B 的语义：「新会话」= 仅 blank 会话，还是包括「收到新消息的已有会话」？** | 两种解释都能对上「新建会话时，新会话应排序在最上面」这句话；但后者**直接推翻** `11b1144` 的核心承诺与 `docs/PRD.md:306-311` | **必须问用户**。建议选项 α（只置顶 current+blank 的新会话），并明确告知：选 β 会回退「拖拽后新消息不再顶到前面」 |
| **Q4** | **需求 B 的「最上面」是容器内还是全局？** | 代码里会话行**必然**隶属于容器（见 §5.1），所以字面上只能是容器内。但用户可能是想让**整个项目/worktree 行**浮到侧栏最上面 | **必须问用户**。建议先做容器内，明确告知限制 |
| **Q5** | **「复用旧 blank 会话」这个行为要不要一并修？** | 它是宿主 `connectWorkspace`（`dsh-client-ui-workspace/lib/client.js:51-54`）的行为，**不在本插件控制范围内**。本插件只能通过「置顶 blank 会话」缓解视觉问题 | 建议用置顶缓解（§5.2 的判据天然覆盖）。**不改宿主行为** |
| **Q6** | **`test/tree-model.test.mjs:1397-1416`「归档的子代理仍计入父行计数」在真实 HTTP 链路下是否成立？** | 该用例直接喂了归档会话给纯函数；但真实链路里 `buildProjects` 会先丢弃归档会话（`src/projects.ts:400`）⇒ **真实链路上该断言不可能成立**。这是既有测试与真实链路的**口径缝隙** | 报告给父代理知悉。**本次不改**（属既有问题，且不在需求 A/B 范围内） |
| **Q7** | **`effectiveOrder` 置顶后对「首次拖拽固化」的影响** | `commitDrag`（`src/sidebar.tsx:1846`）用 `effectiveOrder({...treeInput, manualOrder: undefined})` 固化全量顺序。若 `effectiveOrder` 也应用置顶，则**固化的顺序里新会话被钉在第 1 位**（写进 `localStorage`）—— 这会把「运行时置顶」变成「持久化置顶」，与 E7 的设计意图冲突 | **需明确**：建议 `effectiveOrder` **不**应用置顶（保持它只反映「真实顺序」），或明确接受固化时钉住。**这是实现阶段必须先定的设计点** |
| **Q8** | **GUI 实测** | 我无法在浏览器里点开侧栏验证（HTTP `/tree` 直连返回 `403 forbidden`，由 `dsh-client-connection/lib/index.js:600-612` 的 `requestRejection` 拒绝非 GUI 请求）。所有「视觉效果」结论均为**代码推导 + 编译产物实跑**，非 GUI 截图 | 改完后需真实 GUI 验证：① subagent 跑起来时父行变蓝；② 新建会话出现在容器最前 |

---

## 7. 实际运行过的只读命令（可复核）

```bash
# 仓库与提交
cd /Users/dev/Documents/Project/AnyWork/dsh-worktree-groups
git log --oneline -20
git show e9b5dbc --stat && git show e9b5dbc | head -200
git show 11b1144 --stat
git status --short && git stash list && git log --all --oneline

# 插件源码定位
grep -rn "running" src/ docs/
grep -n "sort\|applyManualOrder\|byRecency\|updatedAt" src/tree-model.ts
grep -n "runningCount\|StatusDot\|subagentCount\|pendingCount" src/sidebar.tsx
grep -n "assignSession\|origin\|subagent" src/projects.ts
grep -n "startSession\|newSession" src/sidebar.tsx
grep -rn "新会话" test/*.mjs docs/*.md README.md

# 宿主 checkout 定位
cd "/Applications/DSH Desktop.app/Contents/Resources/app"
grep -n "running\|sessionVisible\|runningSubagentCount\|indexSubagentDescendants" \
  node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js
grep -rn "running:" --include=*.js \
  node_modules/@deepseek-ai/dsh-api-session-controller/lib \
  node_modules/@deepseek-ai/dsh-session/lib \
  node_modules/@deepseek-ai/dsh-agent/lib
grep -n "get status()" node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js
grep -rn "agent/status" --include=*.js node_modules/@deepseek-ai/ | head -20
grep -n "subagentsByParent\|refreshSubagents\|getListSnapshot" \
  node_modules/@deepseek-ai/dsh-api-session-controller/lib/types/client/sessions/manager.js
grep -rn "agents.create\|parentAgent" --include=*.js \
  node_modules/@deepseek-ai/dsh-subagent*/lib

# 编译产物实跑（只读，不写文件）
cd /Users/dev/Documents/Project/AnyWork/dsh-worktree-groups
node --test                     # 253/253 pass
node -e "<import('./lib/tree-model.js'); 模拟 A/B 场景>"     # 见 §1.2 / §4.2 的实跑输出
node -e "<import('./lib/projects.js'); 确认 subagent 行在 HTTP 载荷里>"

# 真实数据统计（只读）
ls ~/.dsh/sessions | wc -l
for d in ~/.dsh/sessions/*/*/; do zstd -dc "$d/session."* 2>/dev/null | head -1; done > /tmp/allhdr.txt
# ⇒ 536 会话，其中 307 个 origin=subagent，70 个的父也是 subagent，
#   delegationDepth 分布 {1:237, 2:27, 3:43}，33 个不同的顶层祖先
#   全部会话都有 cwd（0 个 _no-cwd），无重复 id

# 确认 GUI 之外无法直连 HTTP 面
curl -s -X POST http://127.0.0.1:43120/dsh-worktree-groups/tree \
  -H 'content-type: application/json' -H 'origin: http://127.0.0.1:43120' -d '{}' -w "%{http_code}\n"
# ⇒ 403 / body "forbidden"
```

### 7.1 真实数据回放（【实测数据】，支撑需求 A 的规模判断）

从本机 `~/.dsh/sessions/*/*/session*.jsonl.zstd` 解出 536 个会话头：

| 指标 | 值 |
|---|---|
| 会话总数 | 536 |
| `origin === 'subagent'` | **307（57%）** |
| 父也是 subagent（多层链） | 70 |
| `delegationDepth` 分布 | depth 1: 237 / depth 2: 27 / **depth 3: 43** |
| subagent 的**不同顶层祖先**数 | **33** |
| 无 `cwd` 的会话 | 0（本机不存在 `_no-cwd` 目录） |

⇒ **有 33 个顶层会话行会因为需求 A 而「在主 agent 空闲时也显示 running」**，规模不小；
且存在 depth 3 的多层链 ⇒ **必须**走「所有层级」的口径（现有 `indexRunningSubagentDescendants` 已经正确处理，见 `src/tree-model.ts:579-592`）。

---

## 8. 按结果模板汇报

### 任务 ID
T1（调研）

### 状态
**完成**。报告已写入 `docs/RESEARCH-running-and-sort.md`。

### 结论

**需求 A**
1. `running` 标识的完整链路：宿主 `agents.get(id).status` → `SessionSummary.running`（`dsh-api-session-controller/lib/types/list.js:93`）→ 插件 `SessionRow.running`（`src/routes.ts:441`）→ `RenderRow.running`（`src/tree-model.ts:917`）→ `StatusDot`（`src/sidebar.tsx:366-374`，唯一调用点 `:973-977`）。
2. **当前仅主 agent 运行才为真的根因**：`RenderRow.running` 只读该会话自己的 summary；`subagentCount`（`src/tree-model.ts:558-594`）是并列的第二个字段，渲染层只用它画计数胶囊（`src/sidebar.tsx:986-993`），**从不参与状态点**。原生在 `runningSubagentCount > 0` 时状态点是 ongoing（`dsh-client-ui-workspace/lib/client.js:820`），本插件退化为 idle。
3. **数据源无需新增**：HTTP `/tree` 载荷里**已经有** subagent 会话行且带正确的 `running`（实跑确认）；`indexRunningSubagentDescendants` 已经能把它映射到父会话。宿主侧 `ctx.agents` 注册表（`dsh-agent/lib/index.js:299/563/581`）跨半边不可达，**不采纳**。客户端 `useSessions.byId`（`service.js:435-455`）含 `running/origin/parentId`，可作可选的毫秒级覆盖层，但覆盖度不保证。
4. **最小改动**：`src/tree-model.ts:903-928` 的 `toSessionRow()` 把 `running` 改为 `session.running === true || subagentCount > 0`。两处调用点（`:976`、`:1115`）**已经**传入 `subagentCount`，无需改签名；搜索路径自动同源。

**需求 B**
1. 排序比较器：`src/tree-model.ts:625-635` 的 `byRecency`（`updatedAt` 降序、`sessionId` 升序）；宿主半边同式副本 `src/projects.ts:83-86`。
2. 默认模式：新会话 `updatedAt` 最大 ⇒ **天然最前**（实跑 `["new","o6",...]`）。
3. **两个破坏场景**：①「新建会话」走宿主 `connectWorkspace`，会**复用**同 cwd 的旧 blank 会话（`dsh-client-ui-workspace/lib/client.js:51-54`）⇒ 旧 `updatedAt` ⇒ **默认模式下也排末尾**（实跑 `[...,"b(blank)","MORE(3)"]`）；②手动模式下 `applyManualOrder` 把不在 `order` 里的项**追加到末尾**（`src/tree-model.ts:285-288`）⇒ 新会话排末尾，**非 current 时被 5 条截断吃掉、整行不可见**（实跑 `["o0".."o4","MORE(4)"]`）。
4. 与 `11b1144` 的冲突：该提交的承诺是「固化后新消息不再顶到前面，新会话落**末尾**」（`docs/PRD.md:306-311`、`docs/INTERFACES.md:550/656`），并被 `test/tree-model.test.mjs:2439-2456` 锁定 ⇒ **需求 B 直接推翻这条承诺的后半句**。现有实现**没有任何冲突处理**。
5. 建议：给 `applyManualOrder` 加可选第 4 参 `pinnedKeys`，判据取 `blank && isCurrent`（选项 α）⇒ 只置顶「当前打开的新会话」，**保持**「已有会话收到新消息不置顶」。置顶在截断**之前**生效，保证必进前 5。

### 产物改动
- **新增**：`docs/RESEARCH-running-and-sort.md`（本文件，唯一写入）
- **未改动**：`src/**`、`lib/**`、`test/**`、`package.json`、`docs/` 下其他文件、DSH 本体目录、任何全局配置
- **未 commit**

### 验收证据
- 基线 `node --test`：**253 tests / 253 pass / 0 fail**
- 需求 A 缺口实跑：`parent row: {"running":false,"subagentCount":1}` ⇒ `StatusDot state = idle`（原生为 ongoing）
- 需求 A 数据源实跑：`payload session ids: ['child','parent']`，`child.running === true && child.origin === 'subagent'` ⇒ **数据已在载荷里**
- 需求 B 实跑（4 组，见 §4.2）：默认模式新会话最前 ✅；复用旧 blank 排末尾 ❌；手动模式新会话排末尾/不可见 ❌
- 真实数据：536 会话 / 307 subagent / 33 个顶层祖先 / depth 3 多层链

### 调研来源
- 插件仓库：`src/routes.ts`、`src/tree-model.ts`、`src/sidebar.tsx`、`src/projects.ts`、`src/types.ts`、`src/client.tsx`、`src/locales.ts`、`lib/*.js`（实跑）、`test/*.mjs`、`docs/PRD.md`、`docs/INTERFACES.md`、`docs/HOST-CONTRACTS.md`
- git 历史：`e9b5dbc`（subagent 不渲染行）、`11b1144`（三层拖拽排序）
- DSH 本体（只读）：`dsh-client-ui-workspace/lib/client.js`、`dsh-api-session-controller/lib/{index.js,types/list.js,types/client/sessions/{manager.js,service.js,notifier.js}}`、`dsh-agent/lib/index.js`、`dsh-agent-loop/lib/index.js`、`dsh-session-query/lib/index.js`、`dsh-subagent/lib/{index.js,types/lifecycle.js}`、`dsh-subagent-in-process-driver/lib/index.js`、`dsh-client-store/lib/index.js`、`dsh-client-connection/lib/index.js`、`dsh-scope/lib/invariant.js`
- 真实数据：`~/.dsh/sessions/*/*/session*.jsonl.zstd`（536 个会话头，只读解压）

### 风险与限制
1. **无 GUI 实测**：HTTP `/tree` 直连被 403 拒绝（`dsh-client-connection/lib/index.js:600-612`），所有视觉结论是「代码推导 + 编译产物实跑」，不是截图。改完必须真实 GUI 验证。
2. **需求 B 与既有承诺冲突**：`11b1144` 的「固化后新会话落末尾」是被测试锁定的承诺；需求 B 要改它 ⇒ **必须**同步改测试并更新 `docs/PRD.md:306-311` / `docs/INTERFACES.md:550/656`，否则文档与实现自相矛盾。
3. **`effectiveOrder` 的置顶副作用（Q7）**：`commitDrag` 用 `effectiveOrder` 固化全量顺序（`src/sidebar.tsx:1846`）；若置顶也作用于 `effectiveOrder`，会把「运行时置顶」变成「持久化钉在第 1 位」，与「不写进 localStorage」的设计意图冲突。**实现前必须先定这个设计点。**
4. **既有测试口径缝隙（Q6）**：`test/tree-model.test.mjs:1397-1416` 断言的「归档的子代理仍计入父行计数」在真实 HTTP 链路下不成立（`src/projects.ts:400` 已丢弃归档会话）。不属本次范围，但改动 A 时**不要**误以为输入里有归档 subagent。
5. **需求 A 的实时性未验证（Q2）**：走 30s 轮询；虽然 `recordMutation` 会 `markDirty()` 触发快照变化与 220ms 防抖重取，但未在 GUI 实测端到端延迟。

### 残留状态
- 无未完成的写入（报告已完成）。
- 未创建任何子代理、未改模型配置、未联网、未安装依赖、未运行构建、未 commit。
- `/tmp/allhdr.txt`（会话头样本）与 `/tmp/tree.json`、`/tmp/t2.json`（403 响应）为本次调研的临时文件，**不在仓库内**，不影响仓库状态。

### 需要父代理决定
1. **Q3（阻塞需求 B 实现）**：需求 B 的「新会话」= 仅 `blank` 新会话，还是包括「收到新消息的已有会话」？
   - 建议 α：仅 `blank && isCurrent` ⇒ 保留 `11b1144` 的冻结承诺；
   - 选 β 会回退「拖拽后新消息不再顶到前面」，需重写 `test/tree-model.test.mjs:2395-2437` 与 `:2439-2456`。
2. **Q4（阻塞需求 B 实现）**：「最上面」= 该 worktree 容器内最前，还是整个侧栏最前（需同时置顶 project/worktree 行）？代码里会话行必然隶属于容器，字面上只能是前者。
3. **Q7（阻塞需求 B 实现）**：`effectiveOrder` 是否也应用置顶（影响首次拖拽固化的持久化顺序）？建议**不**应用。
4. **Q1**：容器/项目行的 `runningCount` 是否也要把「运行中的 subagent」算进去？（渲染层目前无消费者，建议不动。）
5. **Q2**：需求 A 是否要求毫秒级实时（决定是否做 §3.3 的 `useSessions.byId` 覆盖层）？
6. **Q5**：是否接受「用置顶缓解宿主复用旧 blank 会话」而不改宿主行为？
