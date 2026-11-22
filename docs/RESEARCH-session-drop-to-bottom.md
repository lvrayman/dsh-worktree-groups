# 调研报告：会话「掉到侧栏最下面」的真实机制

- **任务 ID**：T4（调研，只读）
- **调研对象**：`/Users/dev/Documents/Project/AnyWork/dsh-worktree-groups`（插件，基线 `11b1144` + T2 未提交改动）
  与 `/Applications/DSH Desktop.app/Contents/Resources/app/`（DSH 本体 checkout，只读）
- **现象**：用户观察「**新会话，或者会话刚结束后，该会话掉到了侧栏最下面**」
- **本文件是本次调研唯一写入的产物**；未改 `src/**`、`lib/**`、`test/**`、`package.json`、其他 `docs/**`，未 commit。

> **证据分级约定**
> - 【确证】= 我实际读到的源码 / 实跑结果，附 `file:line` 与片段。
> - 【实测数据】= 我在本机 `~/.dsh` 上跑的只读统计（含**从浏览器 localStorage 解出的真实排序表**）。
> - 【推测】= 由代码推断但未在真实 GUI 复现。

---

## 0. 一句话结论（先给答案）

**用户当前处于「手动排序模式」，这是本现象的直接原因，而且已被真实数据完全证实。**

我从浏览器 localStorage（LevelDB `000853.ldb`）解出了用户真实的排序表：`"manual":true`，
且 AnyWork 容器的会话顺序**只固化了 16 条**（快照水位 = `2026-09-21T09:01:43Z`）。
而**本次对话会话 `0a1fd499`（09:03:47）与 10:32 新建的 `df1262ac` 都不在这张表里**。

`applyManualOrder`（`src/tree-model.ts:311-314`）对「不在持久顺序表里的项」的语义是
**一律追加到末尾**。于是：

| 场景 | 机制 | 结论 |
|---|---|---|
| **新会话掉底** | 新建会话时它是 `blank`，被 `isVisibleMember` 过滤 ⇒ **不进「首次拖拽固化」的快照**；发第一条消息后 `blank` 变 false 才可见，但顺序表里没有它 ⇒ 追加到**末尾** | 【确证】+【实测数据】 |
| **刚结束的会话掉底** | 它从来没进过顺序表（同上），因此**一直在末尾**；「当前会话置顶」只在它仍是 `isCurrent` 时把它临时提到第 1 位，用户切走后**立刻掉回末尾** | 【确证】+【实测数据】 |
| 新会话在**默认模式**下 | `updatedAt` 最大 ⇒ 天然最前 | 与用户现象**不符** ⇒ 反证用户不在默认模式 |

**没有发现任何「会话结束时被移动到 history / ungrouped 分区」的代码路径** ——
分桶（bucket）与运行状态**完全无关**（`src/projects.ts` 里 `running` / `completed` 出现 **0 次**）。
用户感知的「掉到最下面」是**容器内排序**，不是分区迁移。

---

## 1. 侧栏分区与渲染顺序（问题 1）

### 1.1 会话行的全部 bucket

`src/projects.ts:76-80` 定义归属结果，`:310-457` 组装：

```ts
// src/projects.ts:76-80
type Assignment =
  | { kind: 'worktree'; repoKey: string; path: string }
  | { kind: 'history'; projectKey: string }
  | { kind: 'flat'; projectKey: string }
  | { kind: 'ungrouped' }
```

| # | bucket | 宿主结构字段 | 归属规则（`assignSession`，`src/projects.ts:173-243`） |
|---|---|---|---|
| 1 | **worktree 会话** | `ProjectNode.worktrees[*].sessions` | 规则 1/2：cwd 命中**存在的** worktree 或已注册工作区（`:179-215`） |
| 2 | **flat 会话** | `ProjectNode.flatSessions` | 规则 2b：**非 git 工作区**（`:206-214`） |
| 3 | **history 会话** | `ProjectNode.history` | 规则 3/4：cwd 命中台账记录但目录已消失，或 `looksLikeWorktreeOf` 命中主树（`:223-239`） |
| 4 | **ungrouped 会话** | 顶层 `ungrouped`（不在任何 ProjectNode 里） | 规则 5：其余（含 `cwd` 缺失，`:176`） |
| — | **归档会话** | — | **直接被丢弃**（`src/projects.ts:400`），不进任何 bucket |

### 1.2 渲染先后顺序（**关键：确实存在一个渲染在底部的分区**）

决定顺序的代码在 `src/tree-model.ts:1436-1541`（`buildRows`），文档化于 `:1352-1366`：

```
[project 行]                                     ← :1466-1480
  [worktree 行]  …（按宿主/手动顺序）              ← :1483-1502
    [session 行] …                               ← :1501（depth 2）
    [more 行]
  [flat 行（非 git 项目，无 worktree 子行）]        ← :1504（depth 1）
  [history 行]  ← ★ 渲染在该项目所有 worktree 之后   ← :1506-1520（depth 1）
    [session 行] …                               ← :1518（depth 2）
[下一个 project 行]
…
[未分组行]  ← ★ 渲染在**所有项目之后**（全侧栏最后）  ← :1524-1541
  [session 行] …                                 ← :1540（depth 1）
```

**实跑确认**（用 `lib/tree-model.js` 构造「1 个 worktree + 1 个死 worktree 的 history + 1 个未分组」）：

```
PROJECT Repo depth=0
WORKTREE main depth=1
      SESSION s-wt (parent=w:/r)
WORKTREE old depth=1
HISTORY history.label depth=1          ← history 分区在 worktree 之后
      SESSION s-hist (parent=h:/r/.git)
PROJECT section.ungrouped depth=0      ← 未分组在最后
    SESSION s-ung (parent=p:__ungrouped__)
```

**回答**：
- **存在渲染在底部的分区**：① `history`（每个项目内，所有 worktree 之后，`src/tree-model.ts:1506`）；
  ② `ungrouped`（全侧栏最后，`:1524`）。文案见 `src/locales.ts:18`（`section.ungrouped` = 「未分组」）
  与 `src/locales.ts:25`（`history.label` = `history-worktree-session`）。
- 容器内会话顺序由 `emitContainer`（`src/tree-model.ts:1025-1095`）决定：
  `visibleMembers` → `sortedByRecency`（`updatedAt` 降序）→ `applyManualOrder` → `truncateSessions`。
- `src/sidebar.tsx` **不做任何排序**（`grep '\.sort(' src/sidebar.tsx` ⇒ 无匹配），
  只按 `view.rows` 顺序渲染（`src/sidebar.tsx:2012-2013` 的 `for (const viewRow of view.rows)`）。

---

## 2. 会话在什么条件下跨分区迁移（问题 2）

### 2a) 会话结束后（completed / idle）是否改变 bucket？—— **不会**【确证】

```bash
$ grep -n "running\|completed\|pendingInteraction" src/projects.ts
  (no matches -> bucketing is INDEPENDENT of run state)
```

`assignSession`（`src/projects.ts:173-243`）的判据**只有** `cwd` / `repos` / `ledger` /
`liveWorkspacePaths`，**从不读** `running`、`completed`、`pendingInteraction`。
`SessionRowLike` 里虽然有 `completed`（`src/tree-model.ts:63`），但它只在
`toSessionRow`（`src/tree-model.ts:1002`）被投影成行字段用于画状态点，**不参与任何排序或分桶**。

⇒ **「会话结束」这一事件在插件侧不产生任何 bucket 迁移。** 用户的「刚结束后掉底」**不是**分区迁移。

### 2b) worktree 被删除 / 不再是 git 仓 / cwd 不存在 ⇒ 是否归入 history 或 ungrouped？—— **会，但可证伪为本现象原因**【确证】

规则 3/4（`src/projects.ts:223-239`）：

```ts
// 规则 3：cwd 命中台账记录的 worktreePath，且该路径已不存在 ⇒ 该项目 history 桶。
const owner = input.ledger.sessions[session.sessionId]
if (owner !== undefined && !isKnownLivePath && input.repos[owner.projectKey] !== undefined) {
  return { kind: 'history', projectKey: owner.projectKey }
}
// 规则 4：cwd 是不存在的目录，且能被某项目 mainPath 用 looksLikeWorktreeOf 匹配。
if (!isKnownLivePath) { /* … looksLikeWorktreeOf ⇒ history */ }
// 规则 5：其余 ⇒ 未分组
return { kind: 'ungrouped' }
```

**实测**：本机 git 扫描**没有任何 `exists === false` 的 worktree**（`dead worktrees found by git scan: []`），
唯一一个 cwd 已消失的顶层会话是 `session-f6646251`（cwd = `…/LogAnalyst-toolbar-refactor`，目录确实不存在），
但它**已被归档**（`archived: true`）⇒ 被 `src/projects.ts:400` 丢弃，**连 history 桶都进不去**。
⇒ 本机**没有**任何会话因「worktree 被删」而落入 history 桶（`HISTORY buckets: (空)`）。

**注意**：规则 4 用的是 `looksLikeWorktreeOf`（`src/projects.ts:41-52`），要求**父目录相同**且
basename 以主树名开头。`LogAnalyst-toolbar-refactor` 与 `LogAnalyst` 满足该启发式 ——
**若它没被归档，它会落进 `LogAnalyst` 项目的 history 桶**（渲染在底部）。
⇒ **history 迁移是真实存在的路径，只是本机数据被归档截断了。**

### 2c) 归档行为 + `src/projects.ts:400` 的影响【确证】

```ts
// src/projects.ts:399-400
for (const session of input.sessions) {
  if (archived.has(session.sessionId)) continue   // ← 归档会话一律排除
```

归档集合来源：`src/routes.ts:493-497`（`registry.archivedSessionIds`）→
`src/routes.ts:648` → `src/routes.ts:885` → `buildProjects`。

**实测**：`workspace.json` 里 `archivedSessionIds` 共 **172** 条；我在 `buildProjects` 输出里
统计「归档会话仍出现在树中任意位置」的数量 = **0** ⇒ **归档会话对用户完全不可见**
（不在 worktree / flat / history / ungrouped 任何一处）。客户端 `isVisibleMember`
（`src/tree-model.ts:954-960`）还有第二道 `archived` 过滤，双保险。

**归档是自动的**：`~/.dsh/settings.yaml:303-305`

```yaml
dsh-session-archive:
  autoArchiveDays: 10
  autoArchiveEnabled: true
```

台账 `~/.dsh/dsh-session-archive/archive-ledger.json` 里 **132 条全部 `source: "auto"`**。
⇒ 10 天不活跃的会话会被自动归档并从侧栏消失。**这是「会话消失」而非「掉底」的机制**，需与用户现象区分。

### 2d) 宿主是否在会话结束后写入/更新 `lastPromptAt` / `updatedAt`？—— **不写**【确证】

宿主的 `updatedAt` 定义（`dsh-api-session-controller/lib/types/list.js:284-286`）：

```js
function updatedAt(header, metadata) {
    return Math.max(header.createdAt, metadata?.lastPromptAt ?? 0);
}
```

`lastPromptAt` 的唯一写入点（同文件 `:28-37` 的 projection reducer）：

```js
export function applySessionListMetadata(state, event) {
    const blank = state.blank && event.type !== 'turn/start';
    const lastPromptAt = event.type === 'user/message' && event.data.source.kind === 'user'
        ? event.time
        : state.lastPromptAt;          // ← 只有 user/message 会推进；其余事件一律不变
    ...
}
```

⇒ **`updatedAt` 只在「用户发出消息」时推进；agent 跑完、turn 结束、会话 idle 都【不】推进它。**

**实测数据**（541 个会话，对比 `lastEventTime`（日志最后事件）与 `updatedAt`）：

```
gap(lastEvent - updatedAt) ms: max=701057339 p99=250895319 p95=70954116 p50=402209
sessions with gap > 1min: 456 / 541 (84%)
sessions with gap > 10min: 225
sessions with gap > 1h: 81
sessions with gap > 6h: 50
```

**典型样本**（`updatedAt` 远落后于真实活动结束时间）：

| sessionId | lastPromptAt（=updatedAt 基准） | 日志最后事件 | 落后 |
|---|---|---|---|
| `session-0a1fd499`（本会话） | 09:03:47 | 11:31:53 | **8886 s ≈ 2.5 h** |
| `…54856bdc` | 09:06:00 | 10:19:02 | 4382 s |
| `…1f36f248` | 10:39:15 | 10:59:05 | 1190 s |
| `…860230`（BatteryCam） | 09-20 02:45 | 09-21 05:23 | **95 862 s ≈ 26.6 h** |

⇒ **「刚结束的会话」的 `updatedAt` 确实可能大幅落后于其他会话** —— 这一点【确证】。
但**本机真实数据表明它当前不是主因**（见 §3）。

> 补充核查：投影缓存（`~/.dsh/storages/session_projcache`）里 `sessionListMetadata` 的
> `lastPromptAt` 与日志真实值**只有 2/485 不一致** ⇒ 缓存滞后**不是**普遍现象。
> 【实测数据】缓存滞后样本：`1544af6b`（cache seq=2 / 真实 536 events）、`a0c54cfa`（lag 580 s）。

---

## 3. 根因判定与真实数据证据（问题 3）

### 3.1 决定性证据：用户处于**手动排序模式**

我从 Electron 渲染进程的 localStorage 解出了**真实排序表**
（`~/Library/Application Support/DSH Desktop/Partitions/dsh-desktop-renderer/Local Storage/leveldb/000853.ldb`，
snappy 解压后得 5837 字节 JSON）：

```json
{"manual":true,
 "projects":["/Users/dev/Documents/Project/Workspace/MyProject/.git", … 共 14 项],
 "worktrees":{ … 共 9 个项目的 worktree 顺序 … },
 "sessions":{ … 共 22 个容器 … }}
```

**`"manual":true`** ⇒ `sessionOrderOf`（`src/tree-model.ts:330-333`）不再返回 `undefined`
⇒ `applyManualOrder` 的手动分支**全程生效**。

### 3.2 该表「没有」本次对话会话与最新新会话

```
0a1fd499 anywhere in order JSON? false      ← 本会话（T4 自己）
df1262ac anywhere in order JSON? false      ← 10:32 新建的新会话
```

AnyWork 容器（key = `p:ws:fb0333d3-73a4-4fe6-9741-017eb9fd804c`）的固化内容：

```
AnyWork: visible=17  persistedOrderEntries=16  inOrder=15  notInOrder=2
NOT in order (=> appended to END by applyManualOrder):
    2026-09-21T10:32:23.968Z session-df1262ac-be5d-4182-95ee-fc94e801a526 (blank)
    2026-09-21T09:03:47.316Z session-0a1fd499-65d5-46fd-bce8-5ff0a1f4c67a
```

**全局统计**（所有可见顶层会话）：

```
visible top-level sessions: 58
present in persisted order: 52
MISSING from persisted order (=> appended to END of their container): 6
freeze watermark (newest updatedAt present in order): 2026-09-21T09:01:43.046Z
```

6 条缺失的会话中，**只有 2 条晚于水位线**（`df1262ac` 10:32、`0a1fd499` 09:03），
其余 4 条（`acaf03fd`、`af89d75c`、`6173f64c`、`401e6633`）水位线之前就存在却仍未入表 ——
说明固化快照本身也是**部分/不完整**的（见 §3.5）。

### 3.3 为什么「新会话」注定进不了这张表（**关键机理**）

`commitDrag`（`src/sidebar.tsx:1852-1897`）在**首次拖拽时把当时的完整顺序一次性固化**：

```ts
// src/sidebar.tsx:1854
const defaults = effectiveOrder({ ...treeInput, manualOrder: undefined })
// :1858-1863  manual:true, projects/worktrees/sessions 全量写入 localStorage
```

而 `effectiveOrder` 的会话顺序来自 `visibleMembers`（`src/tree-model.ts:963-965`）——
它**过滤掉了 `blank` 且非当前的会话**（`src/tree-model.ts:954-960`）：

```ts
function isVisibleMember(session, context) {
  return !isSubagentSession(session)
    && !context.archived.has(session.sessionId)
    && (!isBlank(session) || session.sessionId === context.currentSessionId)
}
```

⇒ **新建会话在「还没发第一条消息」时是 `blank`**，若它当时不是当前会话，**根本不在快照里**。
之后用户发了消息，`blank` 被宿主翻成 false（`manager.js:881-882`：
`blank: summary.blank && !mutation.running`），会话才可见 —— 但顺序表里**永远没有它**。

**实跑证明**（`lib/tree-model.js`，manual 模式 + 5 条已固化 + 1 条新会话）：

```
freeze snapshot has only old1..old5 (NEW was blank/invisible at freeze time)

NEW still blank (no prompt yet):     old5,old4,old3,old2,old1
NEW after 1st prompt (blank=false):  old5,old4,old3,old2,old1     ← NEW 追加在最后
```

### 3.4 为什么「刚结束的会话」也掉底

同一机理的**同一后果**：该会话从未进过顺序表 ⇒ 永远排在所有已固化项**之后**。
唯一的例外是「当前会话置顶」（`src/tree-model.ts:371-378` + `:1038-1043`，T2 需求 B）——
它只在 `isCurrent` 为真时把该会话临时提到容器第 1 位：

**实跑（真实数据 + 真实 localStorage 排序表）**：

```
--- manual, 无 current（会话已结束/切走） ---
  1. session-0bc7a19b…   2. session-d1f1533f…   3. session-5277f32b…
  4. session-404a84bc…   5. session-90bca53e…
  本会话 0a1fd499 可见? false     ← ★ 整行不可见（被 5 条截断吃掉）

--- manual, current=本会话 ---
  1. ★session-0a1fd499…          ← 靠「置顶」才回到第 1 位
  2. session-0bc7a19b…  …

--- manual, current=新会话 df1262ac ---
  1. ★session-df1262ac…
  … 本会话 0a1fd499 可见? false
```

⇒ **「刚结束」= 用户切走 ⇒ `isCurrent` 变 false ⇒ 置顶失效 ⇒ 立刻掉回末尾（甚至被截断隐藏）。**
这**精确复现**了用户描述的现象。

### 3.5 完整机理链（按时间顺序）

```
① 用户在某容器拖拽过一次
     → commitDrag 固化「当时的可见顺序」进 localStorage（src/sidebar.tsx:1854-1863）
② 该容器之后新建的会话，在新建瞬间是 blank
     → 若它不是当前会话，isVisibleMember 过滤掉它（src/tree-model.ts:954-960）
     → 它【不在】固化快照里
③ 用户发第一条消息 → blank 变 false → 会话可见
     → 但顺序表里没有它
     → applyManualOrder 把「列表外的项」追加到末尾（src/tree-model.ts:311-314）
     → ★ 掉到最下面
④ 会话结束后用户切走 → isCurrent=false → 置顶失效（src/tree-model.ts:371-378）
     → 它仍在末尾 → ★ 依然在最下面（折叠时甚至被 5 条截断隐藏）
```

### 3.6 反证：默认模式不会有此现象

**实跑（同一份真实数据，把 `manualOrder` 换成 `{manual:false}`）**：

```
--- default mode (manual:false) ---
  1. session-0a1fd499…   ← 本会话（updatedAt 最新）在最前 ✅
  2. session-0bc7a19b…  3. session-d1f1533f…  4. session-5277f32b…  5. session-404a84bc…
```

⇒ **默认模式下新会话与刚活跃的会话都天然在最前**（`updatedAt` 降序）。
用户既然观察到「掉底」，就**反证**其 localStorage 里 `manual === true` —— 与我解出的表**完全一致**。

### 3.7 次要机制（真实存在，但非本次主因）

| 机制 | 是否本机主因 | 证据 |
|---|---|---|
| **手动排序 append-to-end** | ✅ **是**（决定性的） | localStorage `"manual":true` + 6 条可见会话不在表中 |
| **`blank` 不进固化快照** | ✅ **是**（新会话为何注定掉底的机理） | `src/tree-model.ts:954-960` + `src/sidebar.tsx:1854` |
| `updatedAt` 滞后于真实活动 | ⚠️ 真实存在但**非本机主因**（manual 模式下被 append-to-end 覆盖；默认模式下样本 `0a1fd499` 仍排第 1） | 456/541 会话 gap > 1 min；`0a1fd499` gap 2.5 h |
| 宿主 `connectWorkspace` 复用旧 blank 会话 | ❌ 本机未观测到（T1 已确证代码路径存在） | `dsh-client-ui-workspace/lib/client.js:51-54` |
| history / ungrouped 分区迁移 | ❌ 本机 0 例（死 worktree 会话已被归档） | `HISTORY buckets: (空)`；`ungrouped` 仅 7 条 `/private/tmp` |
| 自动归档（10 天） | ❌ 是「消失」不是「掉底」 | `settings.yaml:303-305`；132 条 `source:"auto"` |

---

## 4. 「运行中的会话」与 `updatedAt` 的关系（问题 4）

### 4.1 subagent 活动**不会**推进父会话的 `updatedAt`【确证】

- `lastPromptAt` 只在 `event.type === 'user/message' && event.data.source.kind === 'user'` 时推进
  （`list.js:28-37`）。
- subagent 的**启动/结束/输出**都不是 `user/message`（是 `subagent/*`、`tool/*`、`assistant/message` 等）
  ⇒ **完全不触碰父会话的 `updatedAt`**。

**实测**：父会话 `0a1fd499` 在最后一次 prompt（09:03:47）之后仍有 **251 个事件**
（含 `subagent/catalog` ×6、`tool/call` ×37、`assistant/message` ×30），
而 `updatedAt` 停留在 09:03:47 ⇒ **agent 跑了 2.5 小时，`updatedAt` 一动不动**。

### 4.2 subagent 自己的 `lastPromptAt` 确实会被设置 —— 但它不渲染

**实测**：311 个 subagent 会话都有 `user/message`（`source.kind === "user"`）⇒ 它们**各自有** `lastPromptAt`。
但 `isVisibleMember` 第一项就是 `!isSubagentSession(session)`（`src/tree-model.ts:956`）
⇒ **subagent 行在任何容器里都不产生行**，只以父行的 `subagentCount` 胶囊体现。

### 4.3 排序**完全不看** `running`

```bash
$ grep -n "running" src/tree-model.ts | grep -i "sort\|order\|top\|rank"
  (none)
```

`byRecency`（`src/tree-model.ts:697-701`）**只有** `updatedAt` 与 `sessionId` 两个键。

**实跑证明**（3 条会话，`updatedAt` 10 / 20 / 30，其中 10 与 20 是 `running:true`）：

```
  sub-only   running=true  subagentCount=1  updatedAt=30
  run-2      running=true  subagentCount=0  updatedAt=20
  run-1      running=true  subagentCount=0  updatedAt=10
=> order is by updatedAt; running flag does NOT reorder.
```

### 4.4 ⇒ 对「运行中的会话应在顶部」诉求的直接结论

**只靠排序键（`updatedAt`）无法实现该诉求**【确证】：

- 一个「只有 subagent 在跑」的会话，其 `updatedAt` **完全不更新** ⇒ **不会浮上来**，
  甚至可能因长期无 prompt 而**沉到最底**（`updatedAt` 最旧）。
- 唯一能表达「正在运行」的字段是 `running`（`src/routes.ts:441`）与 `subagentCount`
  （`src/tree-model.ts:1004`，已含 subagent 聚合，T2 需求 A 已实现），
  但**两者都不参与排序**。

⇒ 「运行中的会话置顶」必须新增**排序维度**，不能靠改 `updatedAt` 的算法。

---

## 5. 插件当前已有的「置顶/保留」机制（问题 5）

**只有一个**：T2 的「当前会话置顶」。

| 位置 | 内容 |
|---|---|
| `src/tree-model.ts:371-378` | `pinnedSessionKeys(sessions, currentSessionId)` —— 判据**只有** `isCurrent`，返回 0 或 1 个 key |
| `src/tree-model.ts:345-351` | `currentSessionOf()` —— 回读 `items` 自己的 id，做 `session-` 前缀归一化 |
| `src/tree-model.ts:276-316` | `applyManualOrder` 的可选第 4 参 `pinnedKeys`（`:280`），置顶项先于 `order` 取出（`:298-303`） |
| `src/tree-model.ts:1038-1043` | **唯一**的生产调用点（`emitContainer`），且**先于** `truncateSessions`（`:1052`） |
| `src/tree-model.ts:1273-1277` | `effectiveOrder` **刻意不传** `pinnedKeys`（`:1271-1272` 注释）⇒ 固化进 localStorage 的顺序不含置顶 |
| `src/sidebar.tsx:1854` | `commitDrag` 用 `effectiveOrder({...treeInput, manualOrder: undefined})` 固化 |

**现状与作用范围**【确证】：

- ✅ **只作用于「当前打开的会话」**（`isCurrent`），**不限于 blank**（`src/tree-model.ts:353-369` 的裁决记录）。
- ✅ **纯运行时推导**，**不写进 localStorage**（有测试锁定：`test/tree-model.test.mjs` 的
  「`effectiveOrder` **不**应用置顶」「`JSON.stringify(order)` 里**没有**置顶痕迹」）。
- ❌ **不覆盖「刚结束的会话」** —— 用户切走后 `isCurrent` 变 false，置顶立即失效（§3.4 实跑）。
- ❌ **不覆盖「新会话」** —— 若它不是当前会话（例如在别的容器新建，或用户已切走），同样不受益。
- ❌ **不覆盖「运行中的会话」** —— 判据里没有 `running`。

**其它置顶类标识符搜索结果**：`grep -rn "pinned\|sticky\|retain\|keepTop\|topKeys" src/` 只命中上述
`pinnedKeys` / `pinnedSessionKeys`，**没有**任何别的 pinned/sticky/retained 逻辑。

---

## 6. 修复候选对比（问题 6）

> **前提约束**：本现象**只在 `manual === true` 时出现**（§3.6 反证）。所有候选都必须先回答
> 「是否要保留 `11b1144` 的『拖拽后顺序冻结』承诺」。

### 候选 ①：只改排序键（让 `updatedAt` 反映最近活动时间）

| 维度 | 评估 |
|---|---|
| **原理** | 让 `updatedAt`（或排序键）改为「最近一次真实活动时间」（含 assistant/tool 事件） |
| **改动范围** | **宿主**（`dsh-api-session-controller/lib/types/list.js:28-37` 的 projection reducer）+ 插件 `src/routes.ts:429` |
| **能否覆盖「新会话不掉底」** | ✅ 默认模式下会（已天然满足）；**❌ manual 模式下无效** —— `applyManualOrder` 根本不看 `updatedAt` |
| **能否覆盖「刚结束不掉底」** | **❌ manual 模式下无效**（同上） |
| **优点** | 语义最正确；同时修好「运行中会话不浮起」（若把活动事件纳入） |
| **风险** | ① **改不了**：宿主代码在 `DSH Desktop.app` 内，插件**无法修改**；② 会**推翻** `11b1144` 的「顺序冻结」承诺；③ 影响所有客户端（原生侧栏行为也变） |
| **可测试性** | 插件侧可测（`buildProjects` / `byRecency` 纯函数），但宿主侧改动**不可测** |
| **结论** | **不可行**（需改宿主，插件无权限） |

### 候选 ②：运行时「顶部区」（**推荐**）

| 维度 | 评估 |
|---|---|
| **原理** | 在**渲染路径**上，把「正在运行 / 刚运行过结束」的会话在内存中保留在容器顶部，直到用户手动拖拽该容器或出现新会话。**复用已有的 `applyManualOrder(…, pinnedKeys)` 通道**（`src/tree-model.ts:280/298-303`），把 `pinnedSessionKeys` 的判据从「仅 `isCurrent`」扩展为「`isCurrent` ∪ `running`（含 `subagentCount > 0`）∪ 刚结束（内存态）」 |
| **改动范围** | **纯插件 + 纯 `tree-model.ts`**：① 扩展 `pinnedSessionKeys`（`src/tree-model.ts:371-378`）的判据；② `SidebarModelInput` 增加可选「刚结束」集合（由 `src/sidebar.tsx` 的内存 state 维护）；③ `effectiveOrder` 保持**不传** `pinnedKeys`（`:1271-1272` 不变）⇒ **不污染 localStorage** |
| **能否覆盖「新会话不掉底」** | ✅ 新会话是 `isCurrent`（用户刚点开）⇒ 已由现有置顶覆盖；若用户切走，需靠「新会话」判据（可用 `blank` 或「未出现在 `order` 中且 `updatedAt` > 水位」） |
| **能否覆盖「刚结束不掉底」** | ✅ 正是该候选的核心：结束事件在 `sidebar.tsx` 内存里打一个时间戳，在 TTL 内保持置顶 |
| **优点** | ① **完全在插件内**，不改宿主；② **不污染持久顺序**（沿用 T2 的「运行时推导」设计，已有测试守卫）；③ 复用现成通道（`pinnedKeys` 已实现且已测）；④ 天然覆盖「运行中会话应在顶部」的诉求 |
| **风险** | ① 「刚结束」的 TTL 需要产品定义（多久算「刚」）；② `sidebar.tsx` 是 `.tsx`，**`node --test` 跑不到**（见 §7）⇒ 逻辑必须下沉到 `tree-model.ts` 纯函数；③ 与「用户手动把某会话拖到底部」的意图可能冲突（需定义「用户拖拽后清除置顶」） |
| **可测试性** | ✅ **高** —— 判据与排序都在 `tree-model.ts` 纯函数里，可写 `node --test` 用例（既有 `applyManualOrder` / `buildRows` 测试套件可直接扩展） |
| **结论** | **推荐**。唯一完全在插件权限内、且能同时覆盖两个诉求的方案 |

### 候选 ③：修 bucketing（避免会话在结束时被移到底部历史分区）

| 维度 | 评估 |
|---|---|
| **原理** | 阻止会话因 worktree 消失而落入 `history` / `ungrouped`（渲染在底部的分区） |
| **改动范围** | `src/projects.ts` 的 `assignSession` 规则 3/4/5（`:223-242`） |
| **能否覆盖「新会话不掉底」** | ❌ 无关 —— 新会话的 cwd 是活目录，**从来不会**进 history |
| **能否覆盖「刚结束不掉底」** | ❌ 无关 —— §2a 已确证分桶**与运行状态完全无关**，会话结束时**不迁移** |
| **优点** | 能改善「worktree 被删后会话掉到 history 底部」这一**独立**问题 |
| **风险** | ① **不解决用户现象**；② 改动归属语义会影响 PRD G2/G4 与台账契约，回归面大 |
| **可测试性** | ✅ 高（`projects.ts` 是纯函数，已有 `projects.test.mjs`） |
| **结论** | **不推荐作为本现象的修复**（可作为独立问题的后续任务） |

### 6.1 推荐项与理由

**推荐候选 ②（运行时顶部区）**，理由：

1. **唯一命中真实根因**：本现象是**容器内排序**问题，不是分桶问题（§2a 已证伪候选 ③），
   也不是宿主 `updatedAt` 问题（候选 ① 在 manual 模式下根本不生效）。
2. **完全在插件权限内**：不需要改 `DSH Desktop.app`（候选 ① 不可行）。
3. **复用已验证的通道**：`applyManualOrder` 的 `pinnedKeys` 第 4 参**已经实现并有测试**
   （`src/tree-model.ts:280/298-303`；`test/tree-model.test.mjs` 的「需求 B」系列用例）。
4. **不破坏既有承诺**：`effectiveOrder` 恒不传 `pinnedKeys`（`src/tree-model.ts:1271-1272`），
   置顶**不写进 localStorage** ⇒ `11b1144` 的「持久顺序冻结」承诺**保持**。
5. **同时覆盖两个诉求 + 第三个诉求**：新会话（`isCurrent`）、刚结束（内存 TTL）、运行中（`running`）。

**推荐实现骨架**（**仅示意，本任务不写业务代码**）：

```
tree-model.ts:
  - pinnedSessionKeys(sessions, currentSessionId, runningIds?, recentlyActiveIds?)
      判据从「仅 isCurrent」扩展为「isCurrent ∪ running ∪ recentlyActive」
      （仍然返回有序 key 数组，长度可 > 1）
  - SidebarModelInput 增加可选字段（如 recentlyActiveSessionIds?: readonly string[]）
  - effectiveOrder 保持【不传】pinnedKeys（不变式，已有测试锁定）
sidebar.tsx:
  - 维护「刚结束」内存集合（agent running true→false 时打时间戳，TTL 后清除）
  - 传给 treeInput（该处逻辑无法被 node --test 覆盖 —— 见 §7）
```

**必须同步处理的边界**：
- 用户**手动拖拽**某容器后，该容器的运行时置顶应如何处理（建议：拖拽不清除置顶，
  但置顶项在 `reorderKeys` 的完整顺序里仍是第 1 位 —— 需明确交互）；
- `running` 会话数量可能 > `COLLAPSED_SESSION_LIMIT`（5）⇒ 置顶后仍可能被截断
  （现有置顶**先于**截断，`src/tree-model.ts:1038-1052`，故置顶项必进前 5）；
- subagent 会话不可置顶（`isVisibleMember` 已过滤，`pinnedSessionKeys` 只收 `visible`）。

---

## 7. 不可测试区域提示（问题 7）

**构建/测试链路**【确证】：

```json
// package.json scripts
"build": "tsc -p tsconfig.json && node scripts/build-client.mjs && node scripts/clean-jsx.mjs",
"test":  "npm run build && node --test"
```

- `scripts/build-client.mjs` 用 esbuild 把 **`src/client.tsx`**（**不是** `sidebar.tsx` 单独）
  打成 `lib/client.js`；`sidebar.tsx` 被 `client.tsx` import 后**内联进同一 bundle**。
- `lib/` 下**没有** `sidebar.js`（只有 `sidebar.d.ts` 类型声明）⇒
  **`node --test` 无法 require 任何 `sidebar.tsx` 的运行时逻辑**。
- 5 个测试文件（`test/*.mjs`）**全部**只 import `../lib/{git,ledger,projects,routes,tree-model}.js`，
  **没有一个** import `sidebar` 或 `client`。

**⇒ 新增逻辑必须尽量放在 `src/tree-model.ts` 的纯函数里**，具体：

| 只存在于 `src/sidebar.tsx`（不可 `node --test`） | 应下沉到 `tree-model.ts`（可测） |
|---|---|
| 「刚结束」时间戳的**采集**（监听 `running` true→false） | 「刚结束」集合 → **置顶判据**（`pinnedSessionKeys`） |
| TTL 计时器 / 内存 state 生命周期 | 置顶项在容器内的**排序位置**（`applyManualOrder`） |
| `withLiveState`（`src/sidebar.tsx:498-518`，live fact 覆盖） | 与 5 条截断的**先后关系**（`emitContainer`） |
| localStorage 读写（`readManualOrder` 等） | 置顶是否进入持久顺序（`effectiveOrder` 的不变式） |

**具体建议**：把「哪些会话应置顶」做成 `tree-model.ts` 里接受
`{ currentSessionId, runningIds, recentlyActiveIds }` 的**纯函数**，
`sidebar.tsx` 只负责**采集**这三个入参并传入。这样：
- 判据、排序、截断交互**全部可测**；
- `sidebar.tsx` 的改动退化为「维护一个 Set + 传参」，出错面最小。

---

## 8. 未知 / 不确定项（问题 7 的补充）

| # | 项 | 为什么不确定 | 需要什么证据 |
|---|---|---|---|
| **U1** | 用户是否**知道**自己处于手动排序模式？ | 我只能证明 `manual:true` 存在于 localStorage，无法知道用户是否记得自己拖过 | 向用户确认；或提供「恢复默认排序」菜单项（已存在：`src/locales.ts:174` `resetOrder`，动作 `src/sidebar.tsx:2356-2362`） |
| **U2** | 「刚结束」的 TTL 应取多久？ | 产品语义问题，代码里无依据 | 需父代理/用户裁决 |
| **U3** | 置顶多个（`running` + `recentlyActive`）时**相对顺序**如何定？ | 现有 `pinnedKeys` 是数组（有序），但语义未定义 | 需裁决（建议：`isCurrent` > `running` > `recentlyActive`，各自按 `updatedAt`） |
| **U4** | 用户拖拽后置顶是否应清除？ | 交互设计问题 | 需裁决 |
| **U5** | 无 GUI 实测 | HTTP `/tree` 直连被 403 拒（T1 已确证）；我**没有**在浏览器里点开侧栏验证 | 改完后需真实 GUI 验证 |
| **U6** | 6 条缺失会话中 4 条「早于水位线却未入表」的原因 | 我的快照/水位推断无法区分「固化时不可见（blank）」与「固化后被归档又取消归档」 | 需查看 `000853.ldb` 的历史版本（只有最新一份） |
| **U7** | `updatedAt` 滞后是否会在**默认模式**下也造成掉底 | 本机 `0a1fd499` 在默认模式排第 1，样本不足以证明不会 | 需更大样本或 GUI 实测 |

---

## 9. 实际运行过的只读命令清单（问题 8 / 可复核）

```bash
# ── 仓库与源码定位 ───────────────────────────────────────────────
cd /Users/dev/Documents/Project/AnyWork/dsh-worktree-groups
git log --oneline -15 && git status --short && git diff --stat
grep -n "history\|ungrouped\|flatSessions\|worktrees" src/projects.ts
grep -n "history\|ungrouped\|flatSessions\|RenderRow" src/tree-model.ts
grep -n "buildTreeView\|useSessions\|currentSessionId\|LS_ORDER" src/sidebar.tsx
grep -n "updatedAt\|lastPromptAt" src/*.ts src/*.tsx
grep -n "running\|completed\|pendingInteraction" src/projects.ts          # ⇒ 0 匹配（分桶与运行状态无关）
grep -n "running" src/tree-model.ts | grep -i "sort\|order\|top\|rank"    # ⇒ 0 匹配
grep -n "\.sort(" src/sidebar.tsx                                          # ⇒ 0 匹配
grep -rn "pinned\|sticky\|retain\|keepTop\|topKeys" src/                   # ⇒ 只有 pinnedKeys
cat scripts/build-client.mjs scripts/clean-jsx.mjs
node -e 'console.log(JSON.stringify(require("./package.json").scripts,null,1))'

# ── 宿主契约（只读）───────────────────────────────────────────────
HOST="/Applications/DSH Desktop.app/Contents/Resources/app"
sed -n '1,80p'   "$HOST/node_modules/@deepseek-ai/dsh-api-session-controller/lib/types/list.js"
sed -n '250,330p' "$HOST/node_modules/@deepseek-ai/dsh-api-session-controller/lib/types/list.js"
grep -n "function updatedAt" "$HOST/node_modules/@deepseek-ai/dsh-api-session-controller/lib/types/list.js"   # ⇒ :284
grep -rn "lastPromptAt" --include=*.js "$HOST/node_modules/@deepseek-ai/" | grep -v "\.map"
grep -rn "sessionListMetadata" --include=*.js "$HOST/node_modules/@deepseek-ai/" | grep -v "\.map"
sed -n '44,62p' "$HOST/node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js"   # connectWorkspace 复用
sed -n '876,884p' "$HOST/node_modules/@deepseek-ai/dsh-api-session-controller/lib/types/client/sessions/manager.js"  # blank 翻转

# ── 真实数据统计（只读；临时脚本在 /tmp，未写入仓库）──────────────
node /tmp/t4_scan.mjs     # 解压 ~/.dsh/sessions/**/session.v3.jsonl.zstd ⇒ 541 会话
node /tmp/t4_analyze.mjs  # gap(lastEvent - updatedAt)、cwd 存在性
node /tmp/t4_lag.mjs      # 投影缓存 lastPromptAt vs 日志真实值
node /tmp/t4_replay.mjs   # 用真实数据跑 buildProjects
node /tmp/t4_replay2.mjs  # 按 cwd 统计 bucket 归属
node /tmp/t4_sim.mjs      # 用【真实 localStorage 排序表】跑 buildRows
node /tmp/t4_final.mjs    # 置顶交互 + 水位线
node /tmp/t4_diag.mjs     # 死 worktree / 归档 / 默认模式排名
node /tmp/t4_dbg.mjs      # blank 会话可见性
python3 /tmp/leveldb_read.py   # （失败：手写 leveldb 解析）
# ↓ 成功：snappy 暴力解出 localStorage 真实排序表
python3 - <<'PY'   # 见 §3.1；产物 /tmp/t4_order.json
...snappy_decompress 扫描 000853.ldb...
PY

# ── 插件纯函数实跑（只读，不写文件）─────────────────────────────
node -e '<require lib/tree-model.js> 构造 history+ungrouped 验证渲染顺序'   # §1.2
node -e '<require lib/tree-model.js> running 不参与排序'                    # §4.3
node -e '<require lib/tree-model.js> blank 不进固化快照 ⇒ 新会话落末尾'      # §3.3
node -e '<require lib/tree-model.js> expandedAll 矩阵'                      # §3.4
node --test    # 基线：282 tests / 282 pass / 0 fail（含 T2 未提交改动）

# ── 归档与设置 ──────────────────────────────────────────────────
grep -n "archive\|autoArchive" ~/.dsh/settings.yaml          # ⇒ :303-305 autoArchiveDays: 10
node -e '<统计 archive-ledger.json>'                          # ⇒ 132 条全 source:"auto"
node -e '<对比 workspace.json archivedSessionIds 与 archive-ledger>'  # ⇒ 172 vs 132
ls -d /Users/dev/Documents/Project/Desktop/LogAnalyst-toolbar-refactor   # ⇒ 不存在
```

**未运行的命令**（明确声明）：未联网、未安装依赖、未运行 `npm run build`、未 `git commit`、
未创建子代理、未改任何模型配置、未写 `~/.dsh` 任何文件。

---

## 10. 按结果模板汇报

### 任务 ID
T4（调研，只读）

### 状态
**完成**。报告已写入 `docs/RESEARCH-session-drop-to-bottom.md`。

### 结论

**根因（【确证】+【实测数据】）**

1. **用户处于手动排序模式** —— 我从 Electron 渲染进程 localStorage
   （`…/Partitions/dsh-desktop-renderer/Local Storage/leveldb/000853.ldb`，snappy 解压）
   解出真实排序表：`"manual":true`，AnyWork 容器只固化 16 条（水位 `2026-09-21T09:01:43Z`）。
2. **本次对话会话 `0a1fd499`（09:03:47）与 10:32 新建的 `df1262ac` 都不在该表里** ⇒
   `applyManualOrder`（`src/tree-model.ts:311-314`）把「列表外的项」**追加到末尾**。
3. **新会话注定进不了该表的机理**：新建时是 `blank`，被 `isVisibleMember`
   （`src/tree-model.ts:954-960`）过滤 ⇒ **不进「首次拖拽固化」快照**
   （`src/sidebar.tsx:1854` 用 `effectiveOrder` 固化，而它只含可见成员）；
   发第一条消息后 `blank` 翻 false 才可见，但表里没有它 ⇒ 落末尾。
4. **刚结束的会话同理**：它从未进过表 ⇒ 一直在末尾；「当前会话置顶」
   （`src/tree-model.ts:371-378`）只在 `isCurrent` 时临时提到第 1 位，用户切走即失效
   ⇒ 立刻掉回末尾（折叠时甚至被 5 条截断隐藏）。
5. **反证**：同一份真实数据下，`manual:false` 时 `0a1fd499` 排**第 1**、新会话排**第 0**
   ⇒ 默认模式不会有此现象，与用户观察**矛盾** ⇒ 确认用户不在默认模式。

**分桶与现象无关**【确证】：`grep running|completed src/projects.ts` ⇒ **0 匹配**；
`assignSession`（`src/projects.ts:173-243`）只看 `cwd`/`repos`/`ledger`。
**存在渲染在底部的分区**：`history`（每项目内，所有 worktree 之后，`src/tree-model.ts:1506`）
与 `ungrouped`（全侧栏最后，`:1524`）；本机 history 桶为空、ungrouped 仅 7 条 `/private/tmp`。

**`updatedAt` 与「运行中」**【确证】：`updatedAt = max(createdAt, lastPromptAt)`
（宿主 `list.js:284-286`），`lastPromptAt` **只在 `user/message` 推进**（`list.js:28-37`）
⇒ agent / subagent 活动**完全不更新**它（实测 `0a1fd499` 跑了 2.5 h，`updatedAt` 不动）；
**`running` 不参与任何排序**（`grep` 0 匹配 + 实跑证明）⇒
**「运行中的会话在顶部」无法只靠排序键实现**。

**现有置顶机制**：只有 T2 的「当前会话置顶」（`pinnedSessionKeys`，判据**仅** `isCurrent`），
纯运行时、不写 localStorage、**不覆盖**刚结束/运行中/非当前新会话。

### 产物改动
- **新增**：`docs/RESEARCH-session-drop-to-bottom.md`（本文件，唯一写入）
- **未改动**：`src/**`、`lib/**`、`test/**`、`package.json`、`README.md`、
  `docs/RESEARCH-running-and-sort.md`、`docs/REVIEW-running-and-sort.md`、其他 docs、DSH 本体、`~/.dsh` 配置
- **未 commit**；临时脚本全部在 `/tmp`（`t4_*.mjs`、`leveldb_read.py`、`t4_order.json`、`t4_rows.json`）

### 验收证据
- `node --test` 基线：**282 tests / 282 pass / 0 fail**
- **真实排序表**：`"manual":true`，22 个容器，AnyWork 16 条（水位 09:01:43Z）
- **缺失统计**：58 条可见顶层会话中 6 条不在表里；其中 2 条晚于水位（`df1262ac`、`0a1fd499`）
- **`0a1fd499` 在表中出现次数**：`raw.includes("0a1fd499")` ⇒ `false`
- **实跑（真实数据 + 真实排序表）**：
  - manual + 无 current ⇒ `0a1fd499` **不可见**（被截断）
  - manual + current=自身 ⇒ 第 1 位（靠置顶）
  - manual + current=别的会话 ⇒ `0a1fd499` **不可见**
  - default ⇒ `0a1fd499` **第 1 位**
- **渲染顺序实跑**：`PROJECT → WORKTREE → SESSION → HISTORY → SESSION → PROJECT(未分组) → SESSION`
- **`updatedAt` 滞后**：456/541 会话 gap > 1 min；`0a1fd499` gap 8886 s
- **归档**：172 条 archivedSessionIds；树中归档会话可见数 = **0**
- **死 worktree**：git 扫描 `exists === false` 数量 = **0**；history 桶为空

### 调研来源
- 插件源码：`src/projects.ts`、`src/tree-model.ts`、`src/sidebar.tsx`、`src/routes.ts`、
  `src/ledger.ts`、`src/git.ts`、`src/locales.ts`、`src/types.ts`、`lib/*.js`（实跑）、
  `test/*.mjs`、`package.json`、`scripts/build-client.mjs`、`scripts/clean-jsx.mjs`
- DSH 本体（只读）：`dsh-api-session-controller/lib/types/list.js`、
  `dsh-api-session-controller/lib/types/client/sessions/manager.js`、
  `dsh-client-ui-workspace/lib/client.js`、`dsh-session-projection-cache/lib/index.js`
- 真实数据（只读）：`~/.dsh/sessions/*/*/session.v3.jsonl.zstd`（541 会话）、
  `~/.dsh/storages/workspace.json`、`~/.dsh/storages/session_projcache/sessions/*.json`、
  `~/.dsh/worktree-groups.json`、`~/.dsh/dsh-session-archive/{archive-ledger,state}.json`、
  `~/.dsh/settings.yaml`、
  `~/Library/Application Support/DSH Desktop/Partitions/dsh-desktop-renderer/Local Storage/leveldb/000853.ldb`
- 前序产物（只读）：`docs/RESEARCH-running-and-sort.md`（T1）、`docs/REVIEW-running-and-sort.md`

### 风险与限制
1. **无 GUI 实测**：HTTP `/tree` 直连被 403 拒（T1 已确证），所有视觉结论为
   「代码推导 + 编译产物实跑 + 真实 localStorage 回放」，**非浏览器截图**。
2. **localStorage 只有最新一份**：`000853.ldb` 是当前状态，无法回溯「固化发生的确切时刻」；
   水位（09:01:43Z）是**推断**，非直接观测。
3. **6 条缺失中 4 条的成因未定**（U6）：无法区分「固化时 blank 不可见」与「固化后被归档」。
4. **`updatedAt` 滞后是否在默认模式下也致掉底，样本不足**（U7）。
5. **候选 ① 不可行**：需改 `DSH Desktop.app` 内的宿主代码，插件无权限。
6. **`.tsx` 不可测**：`sidebar.tsx` 内联进 `lib/client.js`，`node --test` 无法执行 ⇒
   新增逻辑必须下沉 `tree-model.ts`（§7）。

### 残留状态
- 无未完成的写入（报告已完成）。
- 未创建子代理、未改模型配置、未联网、未安装依赖、未运行 `npm run build`、未 commit。
- `/tmp/t4_*.mjs`、`/tmp/t4_order.json`、`/tmp/t4_rows.json`、`/tmp/leveldb_read.py`
  为临时文件，**不在仓库内**，不影响仓库状态。

### 需要父代理决定
1. **【最高优先，可能直接结案】用户是否知道自己处于手动排序模式？**
   若是无意拖拽导致的，**「恢复默认排序」菜单项已存在**
   （`src/locales.ts:174` `resetOrder`，动作 `src/sidebar.tsx:2356-2362`）——
   可能**无需写任何代码**。**建议先向用户确认这一点**。
2. **若确认要修**：选候选 ②（运行时顶部区）。需裁决：
   - **U2**「刚结束」的 TTL 取多久？
   - **U3** 多个置顶项（`isCurrent` / `running` / `recentlyActive`）的相对顺序？
   - **U4** 用户拖拽该容器后是否清除置顶？
3. **是否保留 `11b1144` 的「拖拽后顺序冻结」承诺？**（候选 ② 保留；候选 ① 推翻）
4. **候选 ③（修 bucketing）是否作为独立任务**处理「worktree 被删后会话落 history 底部」？
   （**不解决本现象**，但 `LogAnalyst-toolbar-refactor` 这类死 worktree 会话确实会落入底部 history 桶）
5. **是否需要在默认模式下也处理 `updatedAt` 滞后**（U7）？当前证据不足以判定其为真实问题。
