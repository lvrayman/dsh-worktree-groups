# 设计：同位置「新建会话」复用空白会话以保留草稿

- **日期**：2026-10-22
- **状态**：已定稿（用户已确认 DR1「复用」口径）
- **需求依据**：[2026-10-22 需求与验收标准](../requirements/2026-10-22-new-session-draft-retention.md)
- **代码基线**：本仓库 `src/`（`git HEAD` = `835679d`），宿主 = 安装的 DSH Desktop
  `@deepseek-ai/dsh-client-ui-workspace` / `@deepseek-ai/dsh-client-ui-conversation`
  （行号取自当前安装产物，见 §1）。

## 1. 宿主事实（本次核实的证据）

| 事实 | 证据 |
| --- | --- |
| 输入草稿**按会话 id** 持久化，键为 `dsh.conversation.<sessionId>`，值是 `{ draft: { text, references }, view, viewRequest }` | `dsh-client-ui-conversation/lib/client.js:4426`（`CONVERSATION_STORE_KEY = "dsh.conversation"`）、`:4464`（`readConversationDraft(sessionId)`） |
| 只有**当前** blank 会话在侧栏可见，其它 blank 会话被过滤（草稿因此不可达） | `dsh-client-ui-workspace/lib/client.js:964`（`sessionVisible`：`if (session.blank && session.id !== current) return false`） |
| 宿主在 `options` 缺省时**总是铸新会话** | `dsh-client-ui-workspace/lib/client.js:1403`（`connectBlank(workspaceId, reuse)`：`if (reuse === void 0) return this.sessions.create({ workspaceId })`） |
| 宿主在 `options` 存在时**按 cwd 复用 blank 会话**（"reuse the saved blank Session"） | `dsh-client-ui-workspace/lib/client.js:1418`（`createInWorkspace`，`:1421` 的 `sessions.ids.find(... summary.blank && summary.cwd === workspace.path && workspace.sessionIds.includes(id) && !archived.includes(id))`）→ `:1436` `createNamed({ workspaceId, sessionId: blank })` |
| `startSession` 的第二参是公开能力，`clearPreviousDraft: false` 是"复用 + 不清空草稿" | `dsh-client-ui-workspace/lib/client.js:1499`；`dsh-cordis-client-runner/lib/client.js:1560`（"existing text or attachments are preserved unless clearPreviousDraft is true"） |
| 宿主自己的两个调用点用的就是这条路径 | `dsh-client-ui-workspace/lib/client.js:3938`（「添加工作区 → 开新会话」`startSession(workspaceId, { clearPreviousDraft: false })`）、`dsh-client-ui-agent-preset/lib/client.js:2396`（`startSession(void 0, { clearPreviousDraft: false, agentPreset: 'cordis' })`） |
| 宿主 `session.create` 只有在请求**点名** `sessionId` 时才复用，不会按 cwd 自动复用 | `dsh-api-session-controller/lib/index.js:264`（`createSession`：`request.sessionId === undefined` ⇒ `createMinted`）、`:416`（`claim`） |
| 复用的并发/连点由宿主合并：`connecting` Map 按 workspace（+agentPreset）复用同一个 in-flight attempt | `dsh-client-ui-workspace/lib/client.js:1403-1416` |

**结论**：插件只要把「新建会话」的 `startSession` 调用从"无第二参"改成
`{ clearPreviousDraft: false }`，就能让宿主在同 cwd 内复用带草稿的 blank 会话；
草稿不必搬迁，也不需要插件自己读 `localStorage`。

## 2. 数据流（修复后）

```
用户点 worktree 行 `+`
  └─ sidebar.tsx  newSession(extra)
       ├─ extra.workspaceId === undefined → POST /workspace-open 拿 id（D5，不变）
       └─ actions.startSession(workspaceId, { clearPreviousDraft: false })
            ├─ props.startSession 存在 → 原样转发 (workspaceId, options)
            └─ 否则 → bridge.startSession(workspaceId, options)
                 └─ uiWorkspace.startSession(workspaceId, options)       ← 2026-10-22 修复点
                      ├─ options 非 undefined ⇒ initializeDraft = false（不清草稿）
                      └─ openWorkspace → connectBlank(workspaceId, {})
                           └─ createInWorkspace：同 cwd 的 blank 会话存在？
                                ├─ 有 → createNamed({ workspaceId, sessionId: blank })
                                │        ⇒ 宿主复用同一 sessionId
                                │        ⇒ 对话区按 dsh.conversation.<id> 恢复草稿 ✅
                                └─ 无 → 正常铸新会话（与旧行为一致）
```

「同个位置」= 宿主 `createInWorkspace` 的 `summary.cwd === workspace.path`：
同一 worktree 路径复用，不同 worktree 各自独立（DR2）。

## 3. 模块改动

### 3.1 `src/sidebar.tsx`

1. 新增导出类型与常量（供 `client.tsx` 与测试共用）：
   ```ts
   /** `uiWorkspace.startSession` 的第二参（宿主 `DraftInitializationOptions` 的子集）。 */
   export interface StartSessionOptions {
     /** `false` = 复用同目录已有空白会话（保留其草稿），不铸新会话。 */
     clearPreviousDraft?: boolean
   }

   /** 「同位置新建会话」的固定入参（2026-10-22 D-D1；所有插件自有入口共用）。 */
   export const SAME_LOCATION_START_SESSION: StartSessionOptions = { clearPreviousDraft: false }
   ```
2. `Actions.startSession(workspaceId: string, options?: StartSessionOptions): void`
   —— 宿主 props 与 bridge 两条路径都把 `options` 原样传下去。
3. `SidebarBridge.startSession(workspaceId: string, options?: StartSessionOptions): void`。
4. 四个调用点统一传 `SAME_LOCATION_START_SESSION`：
   `newSession()`（worktree 行 `+` 与 worktree 右键菜单都走它）、非 git 工作区行 `+`、
   project 右键菜单「新建会话」、`CreateWorktreeDialog.onCreated` 的自动开新会话。

### 3.2 `src/client.tsx`

`bridge.startSession(workspaceId, options)` → `uiWorkspace.startSession(workspaceId, options)`；
降级分支（`uiWorkspace` 缺席时 `sessions.create({ workspaceId })`）**保持不变**并注释说明
它无法复用 blank 会话（因此也不保留草稿），因为宿主 `session.create` 只有在点名
`sessionId` 时才复用，而插件不该自己挑 blank 会话。

### 3.3 不改的部分（明确）

- 不新增 HTTP 路由、不改 `/tree` 响应结构、不改台账、不改宿主服务探测方式。
- 不改 blank 会话的渲染规则（`tree-model.ts` 的"只显示当前那一条"）。
- 不改宿主 Shell 顶部的「新建会话」按钮（非本插件槽位）。

### 3.4 追加修复（2026-10-22 复验）：复用后的「新会话」必须排在容器最前

**症状（用户复验原文）**：「草稿有了，但新会话没有出现在最上面，而是出现在了最下面，
新会话应该在最上面才对」。

**为什么第一轮修复会引出它**：第一轮把「新建会话」从「每次铸新会话」改成「复用同目录的
空白会话」。旧实现下每次都是**全新会话** ⇒ `updatedAt` 是当下 ⇒ ① 默认模式下按
`updatedAt` 降序天然靠前；② 更重要的是它会被 `observeTopZone` 判为「新会话」
（进程内首次观测且晚于启动水位）⇒ `topZoneSessionKeys` 把它放进顶部区，并且手动模式下
D2 落表把它插到固化表**最前**。复用之后同一个 `sessionId` 早就在 `known` 里（甚至早于
本进程启动水位），既不是「首次观测」，也没有 `blank → 非 blank` 的转换 ⇒ 它落在
`updatedAt`（创建时间，很旧）或手动顺序表（表外 ⇒ 追加末尾）的位置 —— 用户看到的就是
列表最下面。

**修复（DR4/DR5）**：

| 关注点 | 结论 | 落点 |
| --- | --- | --- |
| 位置 | 当前**空白**会话（「新会话」占位行）恒在其容器最前：先于手动排序、先于顶部区、先于 5 条截断 | `tree-model.ts` 的 `emitContainer`（`pinnedKeys` 首位） |
| 判据 | `isCurrentBlankSession(session, currentSessionId)`：`blank === true` 且（`isCurrent` 或 id 归一化后等于 `currentSessionId`） | 新导出纯函数（`tree-model.ts`） |
| 拖拽 | 该行**不可起拖**（仍接受落点） | `isSessionDragLocked`（新导出纯函数）= `isCurrentBlankSession` ∪ `isTopZoneRunningSession`；`sidebar.tsx` 的唯一调用点 |
| 持久化 | **不写** `localStorage`：占位行是运行时推导，`effectiveOrder` 仍不传任何置顶 | 与 T11 的「运行时顶部区不持久化」同一不变式 |
| 反向约束 | **非 blank** 的当前会话**不得**被置顶（T11 终裁「当前会话置顶已删除」不回退） | `2026-10-22/DR4` 反向用例 |

**为什么用「占位行」而不是把它塞进 `topZoneSessionKeys`**：`topZoneSessionKeys` 的契约是
「运行中 ∪ 未落表新会话」，且被「置顶集合 === 不可拖动集合」的历史用例锁定；把 blank 塞进去
会让该集合多出一类语义不同的成员。放在 `emitContainer` 里组合 `pinnedKeys`，含义清楚、
`topZoneSessionKeys` 零改动，且「占位行 → 顶部区 → 持久顺序」的先后次序在代码里一眼可见。

**宿主对照（原生行为）**：`dsh-client-ui-workspace/lib/client.js`
- `:983` `sectionMembers`：`blank` 成员统一排在本组最前；
- `:952` `pinCurrentBlank`：把**当前** blank 提到该账户首位；
- `:2261` `draggable = drag !== void 0 && !row.blank && !row.archived`：blank 行不可起拖；
- `:2990` drop 处理对 `source.blank` 直接 return（blank 行不能被拖走）；
- `:3258` 落点 `normalizeHalf = node.blank ? 'after' : half`（blank 行**仍是落点**）。

即：原生「blank 恒最前 + 不可拖 + 可作为落点」，本插件逐条对齐。

**与 T11 终裁的关系**：T11 删除的是「**普通**当前会话置顶」（`isCurrent` 不参与顶部区）。
空白会话不是「已结束的会话」，它是「新会话」占位行，原生从来都固定在组首 —— 因此 DR4 不是
对 T11 的翻案，而是补上原实现缺少的占位行语义。

## 4. 测试设计


| 编号 | 断言 | 手段 | 失败模式 |
| --- | --- | --- | --- |
| T1 | `sidebar.tsx` 的 `newSession` 回调以**两参**调用 `actions.startSession`，第二参是带 `clearPreviousDraft: false` 的对象（直接字面量或引用同一文件里的常量，值可追溯到 `false`） | TypeScript AST（`test/sidebar-wiring.test.mjs`） | 漏传第二参 ⇒ 回归到"每次铸新会话、草稿被隐藏" |
| T2 | 非 git 工作区行 `+` 的 `onClick` 同样传第二参 | AST | 修了 worktree 漏了非 git 工作区 |
| T3 | project 右键菜单 `MENU.newSession` 分支同样传第二参 | AST | 修了按钮漏了菜单 |
| T4 | `Actions.startSession` 的实现把形参 `options` 同时传给 `props.startSession` 与 `bridge.startSession`（两处都是两参） | AST | 在 `actions` 层吞掉 options |
| T5 | `client.tsx` 的 `bridge.startSession` 把 `options` 传给 `uiWorkspace.startSession`（两参） | AST | 在 bridge 层吞掉 options |
| T6 | 宿主契约锁：安装的 `dsh-client-ui-workspace/lib/client.js` 仍满足 ① `startSession(workspaceId, options)` 把 `options` 传进 `openWorkspace`/`connectBlank`；② `createInWorkspace` 用 `summary.cwd === workspace.path` 找 blank 会话。宿主文件不存在时 `test.skip` | 文本/AST 探测（与 `test/render-smoke.test.mjs` 同样的 skip 姿态） | 宿主升级后静默退回"每次铸新会话" |
| T8 | 当前空白会话在容器内**恒第一**：手动顺序排它到末尾、默认模式、传/不传 `topZone`、与运行中会话并存四种场景 | 单元测试（`test/tree-model.test.mjs` 的 `2026-10-22/DR4`） | 复用后的「新会话」掉回列表末尾（本次用户报告） |
| T9 | 反向约束：非 blank 的当前会话、非当前 blank 的行为都不变（不误置顶 / 不渲染） | 单元测试 | 为了修 DR4 顺手把「当前会话置顶」加回来 |
| T10 | `isSessionDragLocked` = 运行中 ∪ 当前占位行；`sidebar.tsx` 只经它判拖拽，且它内部复用唯一的 `isTopZoneRunningSession` | 单元测试 + AST（`test/sidebar-wiring.test.mjs`） | 占位行可拖 ⇒ 拖完弹回；或判据分叉成两份实现 |
| T7 | 全量回归：`npm run typecheck` / `npm run build` / `npm test` | 命令行 | 任何既有断言的回归 |

**为什么没有行为级单测**：真正的复用发生在**宿主浏览器端服务**（`uiWorkspace`）内部，
它依赖 client store、remote 层与 React 对话区，Node 侧无法在不复制宿主实现的前提下驱动；
按 `docs/AGENTS.md` 的要求，这里用「源码 AST 接线测试 + 宿主契约锁」替代，并在工作记录里
声明残余风险（人工 GUI 复验为 AC7）。

## 5. 风险与取舍

| 风险 | 影响 | 处置 |
| --- | --- | --- |
| 宿主 `createInWorkspace` 依赖**客户端**会话快照里的 `summary.cwd`，而 `sessions.create({ workspaceId })` 的占位 summary 不带 `cwd`（要等下一次列表刷新） | 极端时序下（铸新会话后立刻连点 `+`）可能找不到 blank，仍铸新会话 | 属宿主既有行为；插件侧 `reload()` + 宿主推送会很快补齐。记录为已知限制，不引入插件侧去重/猜测 |
| 宿主拒绝复用（该 blank 已开跑、被其它写者持有、已归档） | 回落为铸新会话，草稿不可达 | 这是宿主的语义边界（已开跑的会话草稿本来也已被消费），不再加插件逻辑 |
| 复用会改写会话的 agent preset（未点名 preset 时按当前默认重放） | 与官方「添加工作区 → 开新会话」同源行为 | 接受；不额外传 `agentPreset`，避免与宿主默认值打架 |
| `props.startSession` 若来自宿主 entry 的 inject，签名是 `(workspaceId, options)` | 本插件 entry 未 inject 该 prop，实际走 bridge | 仍按两参转发，保持与宿主签名一致 |
| 占位行被钉在容器最前，而用户把别的会话拖到「最上面」 | 视觉上那条会话排在占位行之下 | 与宿主原生一致（`sectionMembers` 的 placeholders 恒在最前）；占位行本身不可拖，不会出现回弹 |
| 占位行**不写**持久顺序 | 用户把它拖走（已禁止）/ 刷新后它的位置不变 | 刷新后仍按 `currentSessionId` 重新判定，行为确定 |
| 顶部区内同时有占位行、运行中与新会话 | 次序固定为「占位行 → 顶部区（`updatedAt` 降序）→ 持久顺序」 | 由 `2026-10-22/DR4` 的第三条例锁定 |
