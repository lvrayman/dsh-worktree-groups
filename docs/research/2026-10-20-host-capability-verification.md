# 宿主能力核实：运行态数据面、图标着色与预览路径

- **日期**：2026-10-20
- **状态**：已完成（只读核实；未改动任何业务文件）
- **⚠️ 历史快照（T-11 补注，2026-10-20）**：本文是 T-2 时点的核实结论，**正文不改**。其中**聚合口径**的表述
  （§8 第 5 步、§11 第 2 条「文件夹只聚合 worktree 子项」）**已被 T-8 / PRD RT7 覆盖**：现行口径为
  「worktree 子项 **OR** 该 workspace 的 flat/普通会话」，history 桶与未分组仍排除
  （见 [requirements §2.2](../requirements/2026-10-20-running-task-highlight.md)）。另：§8 第 5 步把
  「非 git 平铺会话」等同于 `ungrouped` 与现行实现**方向相反**——非 git flat 现在**会**让 project 亮，只有
  `ungrouped` 不亮。另：「host 改动必须重启」只适用于改宿主代码；本次高亮改动在 client bundle，
  重建 `lib/client.js` + 刷新页面即生效（审查 §17.8 / T-11）。
- **任务**：T-2（调研/验证），承接 T-1 报告 [`2026-10-20-running-task-highlight-research.md`](./2026-10-20-running-task-highlight-research.md) 的 U1/U2/U4/U5 与"快速刷新"可行性
- **核实对象**：DSH Desktop 运行时 checkout `/Applications/DSH Desktop.app/Contents/Resources/app/`（下文简称 `APP/`），版本 `0.2.1-rc.2` 系列包；本机 profile `~/.dsh/profiles/web`
- **核实方式**：源码逐行阅读 + 少量只读命令（`grep`/`sed`/`stat`/`ps`/`curl`/`node` 对比度计算）。**未**重启、未构建、未改配置、未读凭据
- **一句话结论**：**"用宿主会话运行状态触发防抖刷新"可行（有条件）**；`useSessionStatus` 的推送是"状态迁移级"而非 token 级，覆盖全量会话（含未打开与子代理），不会造成 HTTP 风暴；但**图标 `style` 不透传**、**`brand-primary` 不是品牌蓝**、**当前 GUI 无法被脚本截图/抓取（403 + 无调试端口）**，这三点会直接影响设计定稿

---

## 0. 结论摘要（给设计定稿用）

| # | 问题 | 结论 | 置信度 |
|---|---|---|---|
| 1 | `useSessionStatus` 覆盖范围 | **覆盖客户端会话表里的全部会话**：已打开、未打开、折叠、冷会话、**子代理**都在内（id 并集 = `byId` 键 ∪ 运行表 ∪ 待交互 ∪ 未读） | 高（源码） |
| 2 | 更新频率 | **只在 `agent/status` 迁移时推送**（idle↔running），不是每个 token；且 `sameSessionStatus` 做内容去重 ⇒ 订阅者只在 running/待交互/未读真正变化时被唤醒 | 高（源码） |
| 3 | `running` 语义 | 会话对应 Agent 的 `status === 'running'`（回合/步进进行中）。**子代理启动工具立即返回**，父会话回合结束后即为 idle ⇒ "子代理在跑、父会话不 running"是**真实存在**的，聚合口径必要 | 高（源码） |
| 4 | `SessionSummary.running` | 宿主侧**实时**（`agents.get(id).status`）；客户端会话表**由同一状态事件增量更新**（不是只能等 RPC）。折叠/未打开会话照样有；冷会话恒 `false` | 高（源码） |
| 5 | 图标 `style` 透传 | **不透传**。图标组件只解构 `size/className/strokeWidth`，`style`/`color` 被丢弃；但 SVG 全部用 `currentColor`，**在外层 span 上设 `color` + `filter` 可行** | 高（源码） |
| 6 | 主题变量 | `--dsw-alias-brand-primary` 明色 = `#0f1115`、暗色 = `#f9fafb` —— **是中性前景色，不是品牌蓝**；品牌蓝请用 `--dsw-alias-state-business-primary`（`#4176e6` / `#7aaaff`） | 高（宿主 CSS） |
| 7 | 快速刷新安全性 | **可行（有条件）**：只在运行集合签名变化时触发，沿用既有 220ms 防抖；量级 ≤ 每回合 2 次额外 `/tree` | 中高（源码推断 + 量级估算） |
| 8 | 当前 GUI 预览路径 | client 改动：`npm run build:client` → 宿主 500ms 轮询 → 自动热重载；**host 改动必须重启**（`hmr.root = []`，本任务禁止） | 高（源码） |
| 9 | 截图/视觉验证 | **不可脚本化**：HTTP 403（需 renderer 私有 header）、无 `--remote-debugging-port`、无 playwright/puppeteer ⇒ **只能用户人工确认** | 高（实测） |

---

## 1. `useSessionStatus` / `publishStatus` 的真实实现

### 1.1 实现位置与快照形状

| 事实 | 证据 |
|---|---|
| `sessionStatus` root source 在 `@deepseek-ai/dsh-client-ui-session` 的 `UiSession` 里，作为**根 hook** 提供给所有 Slot 组件；按 `standardHookPropName` 命名为 `useSessionStatus` | `APP/node_modules/@deepseek-ai/dsh-client-ui-session/lib/client.js:782-790`（store 定义）、`:1102-1113`（`slots.provideRoot({hooks:{sessions, sessionStatus}})`）；命名规则 `APP/node_modules/@deepseek-ai/dsh-client-ui-slots/lib/index.js:7-9`（`use` + 首字母大写） |
| 形状：`Map<SessionId, { running: boolean|undefined, pendingInteraction: Interaction|undefined, completionUnread: boolean }>` | `.../dsh-client-ui-session/lib/client.js:976-992`（`publishStatus()` 组装 `next`） |
| 注意 `running` 取值是 `this.running.get(id)`，**可能是 `undefined`**（尚未观测过的会话），不是恒 `false` | 同上 `:985` |

### 1.2 覆盖范围（关键结论）

`publishStatus()` 的 id 集合是四路并集（`.../dsh-client-ui-session/lib/client.js:977-982`）：

```js
const ids = new Set([
  ...Object.keys(this.sessions.list.getSnapshot().byId), // ① 客户端会话表全量
  ...this.running.keys(),                               // ② 已观测运行态
  ...this.pendingSnapshot.keys(),                       // ③ 待交互
  ...this.completionUnread,                             // ④ 未读
])
```

逐条核实 ① 的范围：

- 客户端会话表由 `ClientSessions.projectList()` 构建，`byId` 来自宿主 `session.list` 的**全部可见会话**（`list()` 注释："Read every visible attached and persisted Session"），**冷会话也在内**：`APP/node_modules/@deepseek-ai/dsh-api-session-controller/lib/index.js:1956-2000`；`.../lib/client.js:4148-4220`（`projectList`）。
- **子代理也在 `byId`**：`projectList` 会把父会话 `subagentCatalog` 的子项补进 `byId`（`parentId`、`origin:"subagent"`，`.../client.js:4166-4190`），并把已建 scope 的子代理再补一轮（`:4191-4218`）；宿主 `listFields` 会带 `parentSessionId`（`.../index.js:2127-2133`），客户端 `flattenLineage()` 把它们按 `depth` 展开（`.../client.js:1419-1450`）。
- ⇒ **"折叠 / 未打开 / 视口外"都不影响**：它们是同一份 `byId` 里的键。只有"已归档被宿主过滤"这类情况才不在表里（属于既有可见性语义，本次不改变）。

> ⚠️ 这与 T-1 报告 U1 的"未验证"不同：**现在可以确认覆盖未打开会话与子代理**。但这是**实现事实**而非文档契约（见 §9 R1）。

### 1.3 更新频率（是否每个 token 都推）

证据链（从产生到通知）：

1. **产生**：`dsh-agent-loop` 只在**状态字符串变化**时发 `agent/status`：
   `APP/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js:789-798`
   ```js
   get status() { return this.phase.kind === "idle" || this.phase.kind === "maintenance" ? "idle" : "running" }
   setPhase(next) { const previousStatus = this.status; this.phase = next;
     if (status !== previousStatus) this.dispatch.emit("agent/status", { status }) }
   ```
   ⇒ 回合内部的 `step` / 流式 token **不改变** `status`，**不产生事件**。
2. **转发**：宿主 `api-session-controller` 监听 `agent/status`，发 `api-session/status(sessionId, running)`：
   `APP/node_modules/@deepseek-ai/dsh-api-session-controller/lib/index.js:2989-2993`。
3. **过网**：`api-session/status` 是 `emit` 型转发事件，资源为 `session`，广播给所有非 waterfall 的 client peer（访问控制只拦非 owner）：
   `APP/node_modules/@deepseek-ai/dsh-api-remotes/lib/index.js:51-54`；`APP/node_modules/@deepseek-ai/dsh-api-gateway/lib/index.js:1037-1058`。
4. **进 Map**：`UiSession` 在构造时直接订阅 `ctx.remote.$on("api-session/status", …)` → `observeRunning()` → `publishStatus()`：
   `.../dsh-client-ui-session/lib/client.js:807-829`、`:948-955`。
5. **去重**：`publishStatus()` 用 `sameSessionStatus()` 比较"大小 + 每个 id 的 running/pendingInteraction/completionUnread"，**内容相同就不通知订阅者**：
   `:989`、`:1120-1127`。
6. **另一条入口**：会话表快照变化 → `reconcileStatus()`（用 `list.ids` 的 `row.running` 回填运行表）→ 同样走 `publishStatus()` 去重：
   `:807-813`、`:956-972`。

**结论**：订阅回调频率 = **运行态迁移次数**（正常一回合 2 次：开始、结束；加审批/计划评审等最多个位数），**不是** token 频率，也不是 30s 轮询频率。

### 1.4 `running` 的语义：父会话在子代理运行时是 `true` 吗？

**不一定为 `true`，这正是需要聚合的原因。**

- `subagent` 工具的 `execute` **不等待子代理完成**，启动后立即返回 `{kind:"activation", subagentId}`：
  `APP/node_modules/@deepseek-ai/dsh-tool-subagent/lib/index.js:442-477`（`return { kind:"activation", subagentId: (await runtimeCtx.subagents.startActivation({...})).childId }`）。
- `startActivation` 只是注册/启动子代理，不 join：
  `APP/node_modules/@deepseek-ai/dsh-subagent/lib/index.js:3036-3048`。
- 父 Agent 的 `status` 只由自己的 phase 决定（`dsh-agent-loop:789-798`）。父回合结束后 phase 回 `idle` ⇒ 父 `running=false`；子代理是**独立 Agent**，其 `agent/status` 以自己的 id 发 `api-session/status`。
- ⇒ 子代理仍在跑、父会话已 idle 的场景**真实存在**；只在 `runningCount` 里数父会话会漏。这与本仓库既有会话行聚合判据（`src/tree-model.ts:2216-2219`）一致。

### 1.5 能否用"运行集合签名"做刷新触发？会不会 HTTP 风暴？

**可以，且不会。** 量级：

- 每个会话一回合 ≤ ~4 次迁移（典型 2 次）；每次迁移只让 `statusSnapshot` 变一次。
- 插件已有 220ms 防抖 + `AbortController`（`src/sidebar.tsx:199`、`:1622-1657`）：**同一 220ms 窗口内的多次迁移只会发 1 次 `/tree`**。
- 现有 `/tree` 已经会在"会话表快照变化（新增会话/活动）"时重取（依赖 `sessionsSnapshot`），**运行态签名只是新增一个同量级的触发源**，不改变数量级。
- 对比一下：如果改用 `useSessions` 的 `byId[].running` 做触发，快照还会因 `updatedAt`/活动变化而变 ⇒ 触发更频繁。**用 `useSessionStatus` 更省**。

**条件（必须满足，见 §7）**：签名只取 `running === true` 的 id 集合（排序拼接），**忽略** `pendingInteraction`/`completionUnread`，并继续保持 220ms 防抖（不要在订阅回调里直接 `reload()`）。

---

## 2. `SessionSummary.running` 的来源与刷新语义

| 层次 | 事实 | 证据 |
|---|---|---|
| 宿主生成 | `summaryFor(session)` 的 `running = ctx.agents.get(session.id)?.status === "running"` —— **实时读 Agent 注册表**，每次 `list()` 现算 | `APP/node_modules/@deepseek-ai/dsh-api-session-controller/lib/index.js:1940-1951` |
| 冷会话 | `summarizeCold(...)` 恒 `running: false`（没有 Agent 就不可能在跑） | 同上 `:2002-2020` |
| 冷/热合并 | `list()` 读 `sessionQuery.listSessions()`，热会话用 `summaryFor`，其余用 `summarizeCold`，按 `updatedAt` 排序 | 同上 `:1956-2000` |
| 客户端基线 | `refreshList()` 走 `remote.session.list({})` 拉全量，作为基线 | `.../dsh-api-session-controller/lib/client.js:3246-3300` |
| 客户端增量 | `handleSessionStatus()` → `recordMutation({kind:"status", running})` → `applyMutation` 立刻改 `summary.running` 并 `markDirty` | 同上 `:3533-3546`、`:3418-3424`、`:3622-3645` |
| 客户端重连 | `handleConnected()` 清投影 + `refreshList()` 重新对基线 | 同上 `:3570-3600` |

**与客户端状态 Map 的差异**：

| 维度 | `useSessionStatus` Map | `SessionSummary.running`（`useSessions().byId`） |
|---|---|---|
| 值域 | `boolean \| undefined`（未观测过为 `undefined`） | 恒 `boolean` |
| 覆盖 | 会话表 ∪ 运行表 ∪ 待交互 ∪ 未读（可能含表里还没有的 id） | 会话表全量（含子代理条目） |
| 触发粒度 | 状态迁移（窄） | 会话表任何突变（活动/新增/重命名都会变，宽） |
| 折叠/未打开 | ✅ 有 | ✅ 有 |
| 结论 | **更适合做"运行集合"触发器** | 适合渲染，但做触发器更吵 |

**重要更正**：T-1 报告 §3.4 说"高亮最多滞后 30s"只对 **HTTP `/tree` 的取数时机**成立；宿主/客户端的**运行态数据本身**是事件驱动的、近实时的。滞后来自"插件没在状态变化时重取"，而不是数据源没有。

---

## 3. 宿主图标 primitives：`style` 不透传，但 `currentColor` 可用

### 3.1 `icon()` 与宿主组件

- 插件侧唯一取图标入口 `icon(name, props)`：`jsx(resolved.Component, { size: iconSize(name), ...props })` —— **props 确实透传**（`src/sidebar.tsx:117-122`）。
- 但宿主图标组件只解构三个 prop：

```js
// APP/node_modules/@deepseek-ai/dsh-client-ui-primitives/lib/index.js:1768-1775
const IconFolderOpenOutlineRegular = (props) => jsx(IconFolderOpenOutlineArtwork, { ...props, strokeWidth: 1 });
// :1777-1781
const IconFolderOpenArtwork = ({ size = 16, className, strokeWidth }) => jsxs("svg", { width: size, height: size, className, viewBox: "0 0 16 16", fill: "none", ... });
```

⇒ **`style` / `color` / `data-*` 都会被丢弃**（artwork 没有 `...rest`）。`branch` 图标同构（`:442-452`）。

**因此 T-1 报告 §4.5 V1 里写的 `icon(name, { style: { color } })` 不会生效** —— 必须改成"外层 span 设 `color`"。

### 3.2 在外层 span 上设 `color` / `filter` 是否可行

**可行**，因为：

- 所有图标 SVG 的描边/填充都用 `currentColor`：`folderOpen` 是 `fill:"currentColor"`（`.../index.js:1777-1795`，含 `opacity:0.16` 的填充面），`branch` 是 `stroke:"currentColor"`（`:442-452`）。
- 插件现有的 `lead` span **已经**设了 `color: var(--dsw-alias-label-tertiary)`：`dimText(12)` 在 `src/sidebar.tsx:638-640`，应用到 lead span `:789-794`。
- 所以在该 span 上覆盖 `color`（高亮态）或加 `filter: drop-shadow(...)` 都会作用到 SVG 上；`filter` 不需要额外 DOM。

**注意**：`filter` 在 16px 图标上做发光容易糊边、且"每行一个 filter"有渲染成本；建议**只给运行中的行**加，或干脆只用 `color`（见 §7 推荐）。

### 3.3 `StateDot` 的 `ongoing`（备选视觉）

证据：`.../dsh-client-ui-primitives/lib/index.js:3042-3095`（`StateDot`）与同目录 `StateDot.module.css`：

- `state === 'ongoing'` 渲染的是 **SVG 环形 spinner**（默认 `size=14`，可用 `size` 覆盖），**自带旋转 + dash 呼吸动画**（1.5s），`@media (prefers-reduced-motion: reduce)` 会关闭动画。
- `color` 由 CSS 类给 `--dsw-alias-label-tertiary`，内部 stroke 用 `currentColor` ⇒ 父级 `color` 可覆盖。
- 插件已在用：`StatusDot` 里 `jsx(P.StateDot, { state, size: 10 })`（`src/sidebar.tsx:421-429`），说明 `size=10` 可用、CSS 已由宿主加载。
- 可访问性：组件自身 `aria-hidden="true"`（`:3078`），**必须**靠外层 `title`/文案补通道（与既有 `StatusDot` 注释一致）。

---

## 4. 主题变量：`--dsw-alias-brand-primary` 的真实值

宿主主题 CSS 全部内联在 `APP/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js:1413`（一行巨型字符串，含 `body{...}` 与 `body[data-ds-dark-theme]{...}` 两套）。抽取到的关键值：

| 变量 | 明色 | 暗色 | 说明 |
|---|---|---|---|
| `--dsw-alias-brand-primary` | `var(--dsw-static-neutral-bluish-1000)` = **`#0f1115`** | `var(--dsw-static-neutral-bluish-50)` = **`#f9fafb`** | **中性前景色**（近黑/近白）；同时被 `--dsw-alias-button-primary-fill` 引用 ⇒ 它其实是"主按钮底色" |
| `--dsw-alias-brand-primary-new-colorprimary-new-color` | `#4176e6` | `var(--dsw-static-deepseek-450)` = `#5686fe` | 名字被压扁的"品牌蓝"token（存在但命名不规范，不建议依赖） |
| `--dsw-alias-state-business-primary` | `--dsw-static-deepseek-500` = **`#4176e6`** | `--dsw-static-deepseek-400` = **`#7aaaff`** | **推荐的"品牌蓝"着色变量** |
| `--dsw-alias-link` | `#4176e6` | `#5686fe` | 次选 |
| `--dsw-alias-label-tertiary`（图标现状色） | `--dsw-static-neutral-bluish-600` = `#81858c` | `--dsw-static-neutral-bluish-400` = `#adb2b8` | lead span 现在用的颜色 |
| `--dsw-specific-sidebar-fill`（侧栏底） | `--dsw-static-neutral-bluish-50` = `#f9fafb` | `--dsw-static-neutral-bluish-900` = `#1b1b1c` | 对比度计算背景（推定值，非截图） |
| `--dsw-alias-state-warn-primary` | `#f59e0b` | `#f59e0b` | 备选色，但见下表 |

**对比度（WCAG 2.x，node 计算，背景取侧栏底色）**：

| 前景 | 明色（on `#f9fafb`） | 暗色（on `#1b1b1c`） | 判定 |
|---|---|---|---|
| `label-tertiary`（现状） | `3.55:1` | `8.06:1` | 明色刚过非文本 3:1 |
| `brand-primary` | **`18.08:1`** | **`16.47:1`** | 极高对比，但**无彩色**（近黑/近白） |
| `state-business-primary` | **`4.05:1`** | **`7.39:1`** | 满足非文本 3:1；明色未达正文 4.5:1（图标不适用） |
| `state-warn-primary`（amber） | **`2.06:1`** ❌ | `8.01:1` | **明色不达 3:1，不能用于图标语义** |

**结论**：
1. 若"高亮"= **更强的前景对比**，`--dsw-alias-brand-primary` 足够（18:1 / 16.5:1），但视觉上是"变黑/变白"，**不是品牌色**，很容易与"选中行文字色（label-primary）"混淆。
2. 若用户期望"品牌蓝/有颜色"，应用 `--dsw-alias-state-business-primary`（或 `--dsw-alias-link`），两者都过 3:1。
3. 明确**不要**用 amber（明色 2.06:1）。
4. 当前 profile 是 `preference: light`（`~/.dsh/profiles/web/cordis.patch.yml:229-232`），暗色值需切主题后复核。

> 以上是**从宿主 CSS 取值算出**的对比度，不是截图实测；像素级观感仍需人工确认（§6）。

---

## 5. 插件装载与预览：当前 GUI 怎么加载它、改完怎么看到

### 5.1 装载链路（全部只读核实）

| 环节 | 事实 | 证据 |
|---|---|---|
| profile 声明 | `~/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles` 含 `dsh-worktree-groups`；`dependencies["dsh-worktree-groups"] = "link:/Users/dev/Documents/Project/AnyWork/dsh-worktree-groups"` | 该文件（只读） |
| 链接 | `~/.dsh/profiles/web/node_modules/dsh-worktree-groups -> ../../../../Documents/Project/AnyWork/dsh-worktree-groups` | `ls -la` 实测 |
| patch 层 | 包自带 `cordis.patch.yml` 声明 `insert: [{id: dsh-worktree-groups, name: dsh-worktree-groups}]`；profile 自己的 patch 里**没有**这条（不需要手写） | 仓库 `cordis.patch.yml`；`~/.dsh/profiles/web/cordis.patch.yml` 无 `worktree-groups` 命中 |
| host 入口 | `package.json.main = lib/index.js` | 仓库 `package.json` |
| client 入口 | `exports["./client"].default = ./lib/client.js`；宿主 `clientExportOf()` 取 `exports["./client"].default`，解析成 `clientPath` | `APP/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js:172-182`、`:732-744` |
| 运行中 | GUI 进程启动于 2026-10-19 18:47；`lib/client.js`/`lib/index.js` 构建于 17:01（晚于 `src/sidebar.tsx` 16:59、`src/live-state.ts` 16:57）⇒ **当前跑的就是当前 src 的构建产物**；台账 `~/.dsh/worktree-groups.json` 于 12:35:22 仍在被写 ⇒ host 半区活着 | `ps -o command= -p 59995`；`stat -f` 输出；`stat ~/.dsh/worktree-groups.json` |

### 5.2 改完代码怎么看到效果（精确步骤 + 风险）

**A. 只改 client（`src/client.tsx` / `src/sidebar.tsx` / `src/live-state.ts` / `src/icons.ts` 等被打进 client bundle 的部分）**

```sh
cd /Users/dev/Documents/Project/AnyWork/dsh-worktree-groups
npm run build:client        # 只跑 esbuild，重写 lib/client.js（不跑 tsc，不写 lib/*.js 的 host 产物）
```

然后**不需要重启、通常也不需要手动刷新**：

- 宿主 `client-hmr` 每 **500ms** 轮询每个 graph row 的 client bundle 的 `mtime/ctime/size`（`APP/node_modules/@deepseek-ai/dsh-client-hmr/lib/index.js:27-40`、`:80-110`）。
- 变化后调 `clientModules.rebuilt(id)` 重读文件、更新 graph rev（`.../dsh-client-modules/lib/index.js:631-655`），通过 SSE `/plugins/events` 推 `{type:"rebuilt"}`（`dsh-client-hmr/lib/index.js:160-180`），页面侧 `client-hmr` 收到后**热替换该 entry 的 fiber**（`dsh-client-hmr/lib/client.js:262-280`）。
- `client-hmr` 在 web profile 里**无条件挂载**（`APP/node_modules/@deepseek-ai/dsh-web-app/cordis.patch.yml:215-221`，注释明确"always mounted"）。

**风险（低但真实）**：esbuild 是直接写文件，**没有原子 rename**；500ms 轮询可能正好读到"写了一半"的文件 → 该次热重载可能失败（页面保留旧模块或报错）。**兜底：手动刷新页面（Cmd+R）**——刷新会重新拉 boot graph（此时 rev 已更新）与 bundle。

**B. 改 host（`src/index.ts` / `routes.ts` / `tree-model.ts` / `projects.ts` / `ledger.ts` / `git.ts`）**

```sh
npm run build     # tsc + esbuild + clean-jsx
```

**仅 build 不够**：宿主模块 HMR 默认关闭 —— `hmr` 行配置 `root: []`（`APP/node_modules/@deepseek-ai/dsh-base/cordis.patch.yml:26-33`，注释"module roots are opt-in"），只有 profile patch **文件内容**会被 `watchConfig` 监听（`APP/node_modules/@deepseek-ai/dsh-hmr/lib/index.js:17-110`）。

⇒ **host 改动必须重启 DSH Desktop 才生效。本任务明令禁止重启，因此本次不做 host 侧预览**。

**C. "刷新页面"到底够不够？**

- client bundle：**够**（`rebuilt()` 已把新字节写进内存，刷新拿到新 rev）。但前提是 watcher 已经看到变化（≤500ms）。
- host 代码：**不够**（Node 模块不会重新加载），必须重启。
- 若 `client-hmr` 被某个 patch 关掉：刷新也**不够**（bundle 字节缓存在 `responses` 里，只有 `rebuilt()` 会换）——当前 profile 未关闭它。

---

## 6. 截图 / 视觉验证：当前只能人工

实测与结论：

| 尝试 | 结果 | 证据 |
|---|---|---|
| `curl -si http://127.0.0.1:43120/` | **HTTP 403**，body `forbidden` | 命令输出；服务端在 `APP/lib/webserver.js:20-34`（`rejectBrowserRequest`） |
| 带 `Host: localhost` / `Origin` / 普通 UA | 仍 403 | 同上 |
| 原因 | 桌面 renderer 用**启动时随机生成的私有 header** 才能通过；普通浏览器访问需要 `ordinaryBrowserEnabled`，当前 `openBrowser:false` + `loopback` ⇒ 关闭 | `APP/lib/desktop-browser-access-5-Ph3Uv7.js:47-52`；`APP/lib/client.js:631-632`（`available && (storedOpenBrowser || exposure==="lan")`）；profile `desktop-shell` 配置 `openBrowser:false, networkExposure:loopback` |
| DevTools/CDP 端口 | 主进程参数里**没有** `--remote-debugging-port` / `--inspect` | `ps -o command= -p 59995 \| grep …` 退出码 **1**（无命中） |
| playwright / puppeteer | 未安装（PATH、profile `node_modules`、`/Applications` 均无） | `command -v playwright puppeteer` 无输出；`ls` 无命中 |
| `screencapture` | 系统自带 `/usr/sbin/screencapture`，但它抓的是**用户当前屏幕**（需要屏幕录制权限、窗口在最前、受缩放/遮挡影响），不是可复现的验收手段 | `command -v screencapture` |

**结论**：
1. **无法**在本会话内用脚本抓取 GUI DOM 或截图；`/tree` 的运行时返回也拿不到（同样 403）。
2. **只能由用户人工确认**，按 §8 清单逐项看。
3. 可选的"半自动"辅助（后续任务，不属本次）：给容器行加 `data-running="true"`，用 `test/sidebar-wiring.test.mjs` 做源码级断言；但 `render-smoke` 是 SSR、不跑 effect，**渲染不出真实行**，不能替代肉眼。

---

## 7. "快速刷新"可行性判定与推荐实现

### 7.1 判定：**可行（有条件）**

| 条件 | 说明 |
|---|---|
| C1 只用 `running === true` 的 id 构造签名 | 把 `pendingInteraction`/`completionUnread` 排除；否则审批弹窗、完成未读也会触发重取（不必要） |
| C2 签名必须是**稳定字符串**并 memo | `Map` 每次发布都是新对象；直接把它放进 deps 会每次渲染都触发 |
| C3 沿用 220ms 防抖 | 不要在新订阅里直接 `reload()`；现有 `useEffect` + `setTimeout(reload, 220)` 已经能合并突发 |
| C4 接受"变化时多一次 `/tree`" | 量级：每回合约 2 次；与现有 30s 轮询/快照防抖同一数量级 |
| C5 保留 30s 轮询 + focus 强刷 | 作为事件丢失/重连的兜底 |

### 7.2 推荐实现（最小 diff）

1. **纯逻辑**（放 `src/live-state.ts`，可被 `node --test` 覆盖）：

   ```ts
   /** 运行中会话集合签名：只取 running === true，归一化 id 后排序拼接。 */
   export function runningSignature(status: unknown): string {
     const source = status as { entries?: () => Iterable<[unknown, unknown]> } | null | undefined
     if (source === null || source === undefined || typeof source.entries !== 'function') return ''
     const ids: string[] = []
     try {
       for (const [id, value] of source.entries()) {
         if (typeof id !== 'string') continue
         if ((value as { running?: unknown } | undefined)?.running !== true) continue
         ids.push(normalizeSessionKey(id))
       }
     } catch {
       return ''
     }
     return ids.sort().join(',')
   }
   ```

   复用文件内已有的 `normalizeSessionKey`（`src/live-state.ts:65-70`）与 `entries()` 遍历范式（`sessionStatusOf`，`:115-131`）。

2. **接线**（`src/sidebar.tsx`）：

   ```ts
   const statusSignature = runningSignature(sessionStatus)   // :1581 之后
   useEffect(() => {
     const timer = setTimeout(reload, RELOAD_DEBOUNCE_MS)
     return () => { clearTimeout(timer) }
   }, [reload, sessionsSnapshot, currentSessionId, statusSignature])  // 现有 :1651-1657
   ```

   hook 调用顺序不变（`statusSignature` 是普通派生值），不会触发既有"hooks 数量变化"事故。

3. **不要**改用 `useSessions().byId[].running` 做触发（活动时间/重命名都会让快照变，吵）。
4. **不要**把签名放进 `reload()` 的 `useCallback` deps（会让 `reload` 每次变，导致下面的 30s effect 重建、定时器重置）。

### 7.3 频率评估（数量级）

| 场景 | 状态事件 | `/tree` 请求（220ms 防抖后） |
|---|---|---|
| 单会话一次普通回合 | 2（running→idle） | ≤ 2（首尾各 1） |
| 回合内多次工具/步进 | 0（phase 仍 running） | 0 |
| 5 个子代理同时结束 | ≤ 5 | 1（同一窗口合并） |
| 30s 轮询 | — | 2/min |
| 结论 | 事件级、低 | 不构成风暴；最坏情况是"用户疯狂开关任务"，仍被 220ms 合并 |

**残留风险**：如果未来宿主把 `running` 改成"每个 token 都重算/重发"，频率会变；但本版本由 `setPhase` 的 `status !== previousStatus` 保证（§1.3 第 1 条），且 `sameSessionStatus` 还有一层去重。

---

## 8. 视觉验收步骤（交给用户人工确认）

> 前提：只跑了 `npm run build:client`（或尚未构建），页面已热重载/已刷新；**不改 host**。

**准备**：把侧栏拉到能看到至少两个 worktree 的宽度（非 36px 轨道态），主题保持当前 light。

1. **亮起（worktree 行）**：在**另一个 worktree** 的会话里发一条会跑一会的指令；该 worktree 的 `branch` 图标应在 **~1 秒内**（状态事件 → 220ms 防抖 → `/tree`）变色/变亮，而不是等 30 秒。
2. **熄灭**：任务结束（回合完成）后 ~1 秒内恢复原色。
3. **折叠态**：把该 worktree 折叠，再次运行任务 —— 折叠行本身仍应高亮（数据在 `runningCount` 里，不依赖子行）。
4. **子代理聚合（最关键）**：让一个会话派生子代理后**父回合结束**（子代理继续跑）；该 worktree 应保持高亮；同时父会话行蓝点可能已灭 —— 此时"文件夹亮、父行不亮"是**预期**（因为聚合口径含子代理），需确认用户接受。
5. **project 行只聚合 worktree**：在**非 git 平铺会话**（ungrouped）里跑任务，project 文件夹**不应**亮（用户已拍板"文件夹只聚合 worktree 子项"）。
   **⚠️ 已被 T-8 / RT7 覆盖（T-11 标注）**：现行口径是「worktree 子项 **OR** 该 workspace 的 flat/普通会话」⇒ 非 git flat 在跑时 project **会**亮；只有 `ungrouped` 与 `history` 不亮。
6. **颜色语义**：确认高亮色与"选中行文字/悬停"能区分（若用 `brand-primary`，是近黑/近白；若用 `state-business-primary`，是蓝）。
7. **暗色主题**：切到 dark，重复 1/6，确认图标在 `#1b1b1c` 上仍清晰（预期 `state-business` 7.39:1，`brand-primary` 16.47:1）。
8. **不误伤**：拖拽排序时的 2px 插入线仍与高亮不同；hover/选中态不因新增 `filter` 发糊；`wide=false` 轨道态与搜索态按既有非目标处理（无容器行）。
9. **无回归**：侧栏不再出现"侧栏渲染出错"；控制台无 `React error #130`（历史上图标名缺失会导致）。
10. **（可选）压力**：同时开 3~4 个任务再全部结束，观察是否出现请求风暴/闪烁。

如果第 4 步的"文件夹亮、父行不亮"用户不接受，则必须改聚合口径或视觉语义（属于 Q1 决策，不在本次核实范围）。

---

## 9. 未知、风险与限制

| # | 项 | 性质 | 说明 / 缓解 |
|---|---|---|---|
| R1 | `useSessionStatus` 的"覆盖全量会话"是**实现事实**，不是文档契约 | 风险 | 宿主升级可能改并集逻辑；插件已用 `sessionStatusOf` 做形状兜底（`src/live-state.ts:115-131`），签名函数也应"不认识的形状 → 空串"，不要抛 |
| R2 | `running` 可能是 `undefined` | 事实 | 判定用 `=== true`，不要用真值判断 |
| R3 | 未做**运行时**观测（没抓到 Map 内容/通知次数） | 限制 | 403 + 无 CDP，无法在本任务内实测；频率结论来自源码链路，属**中高**置信 |
| R4 | `StateDot` 的 spinner 动画在低端机/多行时可能有成本 | 风险 | 仅运行中的容器行显示；`prefers-reduced-motion` 已兜底 |
| R5 | `brand-primary` 是中性色，可能被误读为"选中"而非"运行" | 设计风险 | 用 `state-business-primary` 或"着色 + 状态点"双通道 |
| R6 | `drop-shadow` 在 16px 上可能糊边/发灰 | 视觉风险 | 先不用；若要用，只给运行行、半径 ≤1px |
| R7 | 主题值可能被 skin 覆盖 | 风险 | 当前 `ui-skin-maid-atelier` 在 profile patch 中被 disabled；换皮肤需重测对比度 |
| R8 | client-hmr 若被禁用，刷新页面也拿不到新 bundle | 风险 | 当前 web profile 无条件挂载；若发现改了没生效，先确认 `/plugins/events` 是否连通，再考虑重启（本任务禁止） |
| R9 | `npm run build` 会重写 `lib/`（含 host 产物），但 host 不重载 | 限制 | 只改视觉时用 `build:client`；host 改动留给允许重启的任务 |
| R10 | 构建写入非原子，500ms 轮询可能读到半文件 | 风险 | 失败时手动刷新；必要时先 build 到临时文件再 `mv`（后续可优化构建脚本） |
| R11 | 本任务**未**执行 `npm run build` / `npm test` | 限制 | 避免写 `lib/` 与污染工作区；类型/测试状态以 T-1 与后续任务为准 |
| R12 | 403 使得无法复核 `/tree` 的真实返回 | 限制 | 若需运行时证据，只能由用户开 DevTools 或临时启用 ordinary browser access（需改配置，越权） |

---

## 10. 证据：实际执行的命令与输出（摘要）

| # | 命令（只读） | 退出码 | 关键输出 |
|---|---|---|---|
| 1 | `ls -la` / `ls src test lib docs/research` | 0 | 确认仓库结构与前置报告存在（33 KB） |
| 2 | `grep -n "publishStatus" APP/.../dsh-client-ui-session/lib/client.js` | 0 | 命中 `:946 :954 :971 :976` |
| 3 | `sed -n '760,1130p' …/dsh-client-ui-session/lib/client.js` | 0 | `running` Map `:774`；订阅 `:807-829`；`observeRunning` `:948-955`；`reconcileStatus` `:956-972`；`publishStatus` `:976-992`；`sameSessionStatus` `:1120-1127` |
| 4 | `grep -n "agent/status" …/dsh-agent-loop/lib/index.js` + `sed -n '780,800p'` | 0 | `status` getter `:789-791`；`setPhase` 比较后 emit `:794-798` |
| 5 | `grep -rn "agent/status" --include=*.js APP/node_modules/@deepseek-ai` | 0 | 唯一发射点 = `dsh-agent-loop/lib/index.js:798`；消费点含 `dsh-api-session-controller/lib/index.js:2991` |
| 6 | `sed -n '1925,2020p' …/dsh-api-session-controller/lib/index.js` | 0 | `summaryFor` `:1940-1951`（`running = agents.get(id)?.status === "running"`）；`list()` `:1956-2000`；`summarizeCold` `:2002-2020`（`running:false`） |
| 7 | `sed -n '3440,3620p' …/dsh-api-session-controller/lib/client.js` | 0 | `handleSessionStatus` `:3533-3546`；`recordMutation` `:3418-3424`；`refreshList` `:3246-3300` |
| 8 | `sed -n '4140,4235p' …/dsh-api-session-controller/lib/client.js` | 0 | `projectList` 把子代理补进 `byId`（`parentId/origin:"subagent"`） |
| 9 | `sed -n '1419,1450p' …/dsh-api-session-controller/lib/client.js` | 0 | `flattenLineage` 按 `parentSessionId` 展开子代理行 |
| 10 | `grep -n "api-session/status" …/dsh-api-remotes/lib/index.js` + `sed -n '1037,1060p' …/dsh-api-gateway/lib/index.js` | 0 | 事件声明 `:51-54`；广播 + 访问决策 `:1037-1058` |
| 11 | `sed -n '430,500p' …/dsh-tool-subagent/lib/index.js` | 0 | `execute` 返回 `{kind:"activation", subagentId}`（非阻塞，`:442-477`） |
| 12 | `sed -n '3036,3048p' …/dsh-subagent/lib/index.js` | 0 | `startActivation` 只启动/注册，不 join |
| 13 | `sed -n '1768,1800p' …/dsh-client-ui-primitives/lib/index.js` | 0 | 图标 artwork 只解构 `{size,className,strokeWidth}`；`fill/stroke: currentColor` |
| 14 | `sed -n '3042,3130p' …/dsh-client-ui-primitives/lib/index.js` + `cat StateDot.module.css` | 0 | `ongoing` = SVG spinner + 1.5s 动画 + reduced-motion 兜底；`aria-hidden` |
| 15 | `grep -o -- "--dsw-alias-brand-primary:[^;]*" …/dsh-client-ui-theme/lib/client.js`（`sed -n '1413p'`） | 0 | 明 `var(--dsw-static-neutral-bluish-1000)`=#0f1115；暗 `var(--dsw-static-neutral-bluish-50)`=#f9fafb；`state-business-primary`=#4176e6/#7aaaff |
| 16 | `node -e '…WCAG 对比度…'` | 0 | brand-primary 18.08:1 / 16.47:1；state-business 4.05:1 / 7.39:1；warn 明色 2.06:1 |
| 17 | `cat ~/.dsh/profiles/web/package.json` + `ls -la …/node_modules/dsh-worktree-groups` | 0 | bundle 列表含 `dsh-worktree-groups`；symlink → 本仓库 |
| 18 | `grep -n "client-hmr" …/dsh-web-app/cordis.patch.yml` + `sed -n '20,45p' …/dsh-base/cordis.patch.yml` | 0 | client-hmr 无条件挂载（`:218-221`）；`hmr.root: []`（`:26-33`） |
| 19 | `sed -n '27,110p' …/dsh-client-hmr/lib/index.js` | 0 | 500ms stat 轮询；`bundleStat` 比对 mtime/ctime/size |
| 20 | `grep -n "rebuilt(id)" -A 20 …/dsh-client-modules/lib/index.js` | 0 | 重读、换 rev、更新 graph、通知 |
| 21 | `curl -si http://127.0.0.1:43120/`（及 3 种 header 变体） | 0（HTTP 403） | body `forbidden`；`desktop-browser-access` 需 renderer header；`openBrowser:false` 关闭普通浏览器 |
| 22 | `ps -o command= -p 59995 \| tr ' ' '\n' \| grep -i "remote-debugging\|inspect\|expose-internals"` | **1** | 无命中 ⇒ 无 CDP 端口 |
| 23 | `command -v playwright puppeteer screencapture` | 0/非0 | 仅 `screencapture`；无 playwright/puppeteer |
| 24 | `stat -f '%Sm %N' src/*.ts src/*.tsx lib/client.js lib/index.js` | 0 | lib 构建 17:01:51 > src 最新 16:59:08 ⇒ 产物与 src 同代 |
| 25 | `git status --porcelain=v1` | 0 | 14 项未提交改动（含 `src/sidebar.tsx`、新 `icons.ts`/`live-state.ts`、`docs/research/`）；**本次未触碰** |
| 26 | `stat -f '%Sm' ~/.dsh/worktree-groups.json` | 0 | `2026-10-20 12:35:22` ⇒ host 半区在运行并写台账 |

> 说明：证据 2–16、18–20 是"源码行号级"证据；17、21–26 是"环境实测级"证据；两者都未做任何写操作（本报告文件除外）。

---

## 11. 对设计定稿的直接建议（基于以上证据）

1. **数据/刷新**：采用"运行集合签名 + 220ms 防抖重取"（§7.2），保留 30s 轮询与 focus 兜底；预计把"开始/结束"的可见延迟从 **≤30s** 降到 **约 0.3–1s**。
2. **聚合**：沿用已拍板的"含子代理 + 文件夹只聚合 worktree 子项"，但注意**父行蓝点与容器高亮可能不同步**（§1.4），需在 PRD 写清"容器高亮 = 有任务在跑（含子代理）"。
   **⚠️ 后半句已被 T-8 / RT7 覆盖（T-11 标注）**：project 现在同时聚合本 workspace 的 flat/普通会话；前半句「含子代理」仍有效。
3. **视觉**：**不要**用 `icon(...,{style})`（无效）；在 lead span 上设 `color`。颜色优先 `--dsw-alias-state-business-primary`（真·品牌蓝，4.05/7.39:1），若坚持最小改动且接受"变深/变亮"再用 `--dsw-alias-brand-primary`（18.08/16.47:1）。建议叠加 `StateDot ongoing` 作为非颜色通道（可选，`size=6~10`）。
4. **验收**：先只 build client 热重载，按 §8 人工过一遍；host 侧改动留到允许重启的窗口。
5. **可测试性**：把签名函数放进 `live-state.ts` 做纯单测；给容器行加 `data-running` 供后续断言（本次不改代码）。
