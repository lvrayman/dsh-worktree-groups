# 需求：运行中任务的文件夹 / worktree 图标高亮

- **文档类型**：需求（文档驱动开发，先于实现）
- **日期**：2026-10-20
- **任务**：T-3（只写文档，不改 `src/` / `test/`）；**T-8 追加需求（2026-10-20）已同步**
- **状态**：已定稿并实现；**2026-10-20 追加裁决**：RT2 的聚合范围由「只聚合 worktree 子项」扩大为「worktree 子项 **OR** 该 workspace 的普通/flat 会话」（见 §2.2），history 桶与未分组仍排除
- **需求来源**：用户 2026-10-20 口述需求「workspace 内任意 worktree 有正在运行的任务时文件夹高亮；worktree 有正在运行的任务时其 icon 高亮」+ 同一轮的四项拍板（§2 RT1–RT4）
- **上游证据**：
  - [T-1 调研：运行中任务驱动的文件夹 / worktree 图标高亮](../research/2026-10-20-running-task-highlight-research.md)
  - [T-2 宿主能力核实：运行态数据面、图标着色与预览路径](../research/2026-10-20-host-capability-verification.md)
- **下游**：设计见 [2026-10-20-running-task-highlight 设计](../design/2026-10-20-running-task-highlight.md)；契约见 [INTERFACES §2.2 / §2.3 / §2.3.2](../INTERFACES.md)；需求汇总见 [PRD §12](../PRD.md)

## 章节目录

1. [背景与问题](#1-背景与问题)
2. [用户已确认口径](#2-用户已确认口径)
3. [验收标准](#3-验收标准)
4. [非目标](#4-非目标)
5. [约束、依赖与运行时事实](#5-约束依赖与运行时事实)
6. [相关文档](#6-相关文档)

---

## 1. 背景与问题

**现状（代码实证，T-1 §2）**

- 侧栏三类容器行（`project` / `worktree` / `history`）共用 `ContainerRowView`（`src/sidebar.tsx:776`），
  **目前没有任何运行态视觉**：只有 lead 图标（文件夹 / branch / clock）、chevron、label、
  `[主]` 胶囊、项目行会话数、hover 动作与拖拽插入线。
- 运行态视觉只存在于**会话行**：`StatusDot` 的蓝点（`src/sidebar.tsx:421-430`），其 `running`
  已是**含子代理**的聚合口径（自己 `running` 或 `subagentCount > 0`，`tree-model.ts:2216-2219`）。
- 容器行上其实**已有聚合数据** `runningCount`，但：① 语义只数主会话自身 `running`；② 渲染层
  **零消费者**（`grep runningCount src/sidebar.tsx` = 0）。这是用户此前的 Q1 裁决，见 §2 的保留说明。

**问题**

多个 worktree 并行开发时，用户无法从侧栏一眼看出「哪条 worktree / 哪个项目正在跑任务」。
折叠的容器看不到子行状态点；跨 worktree 扫视需要展开每一行逐个看。当前唯一的全局信号是
每 30 秒一次的树刷新（`TREE_REFRESH_MS = 30_000`）与 focus 强刷（`sidebar.tsx:1659-1669`），
即使有视觉也会滞后最多约 30 秒（T-1 §3.4）。

**目标**

把「有任务正在运行」这一**已经存在于行数据里**的事实，用**最小视觉改动**投影到容器行的
**图标**上，并在宿主运行状态变化时**快速刷新**（约 0.3–1 s），让用户在折叠、滚动、跨
worktree 场景下都能立刻定位正在跑的任务。

## 2. 用户已确认口径

**RT1–RT4 是用户 2026-10-20 的拍板结论**（原问题清单见 T-1 §6.3 Q1–Q4）；**RT5–RT6 是主代理
据 T-1 / T-2 证据定稿的实现级决策**，不改变用户可见行为，但为保证「唯一一套字段名与口径」
必须与 RT1–RT4 同等落地。**§2.2 是 2026-10-20 的追加裁决（对应 PRD RT7），覆盖 RT2 的聚合范围。**

| # | 问题 | 已确认结论 | 对实现的硬约束 |
|---|---|---|---|
| **RT1** | 「正在运行的任务」是否包含子代理 | **包含**：会话自身 `running === true` **或** 该会话有运行中的子代理 | worktree 判据必须用**聚合**口径（与会话行蓝点同源），不得只读 `session.running` |
| **RT2** | 文件夹（project）行的聚合范围 | **worktree 子项 OR 该 workspace 的普通/flat 会话**（2026-10-20 追加裁决，覆盖原「只聚合 worktree 子项」）；**不含**未分组、**不含** history 桶 | project 判据 = `worktrees.some(w => w.hasRunningTasks === true) \|\| flat.hasRunningTasks === true`；history / 未分组即使有运行中会话也**不算** |
| **RT3** | 视觉表达 | **只高亮** workspace 文件夹图标与 worktree 行首图标；**不整行、不加状态点**；用主题强调色 + 轻微光晕 | 落点唯一：`ContainerRowView` 的 lead 图标 `span`；禁止行背景 / 左侧竖条 / `StateDot` / 数字徽章 |
| **RT4** | 刷新时延 | 接入宿主会话运行状态做**防抖快速刷新**（约 0.3–1 s）；**保留** 30 s 轮询与 focus 强刷 | `runningSignature(status)` + 既有 220 ms 防抖；不得删除轮询 / focus 兜底 |
| **RT5** | 数据模型（主代理定稿） | `RenderRow` 的 `project` / `worktree` 行新增**必填布尔**字段 `hasRunningTasks`（**additive**）；`runningCount` 语义**保持不变** | 字段名唯一 `hasRunningTasks`；**不改** `runningCount`、**不改**既有 Q1 裁决文本；新消费者只用新字段 |
| **RT6** | 可访问性与可测试钩子（主代理定稿） | 图标 span 增加 `title`，locale key 固定为 **`a11y.runningTask`**，中文文案 **「有任务正在运行」**；高亮行根节点加 `data-running="true"` | key 与文案在上述位置唯一固定；T-4 不得另造 key；`data-running` 仅在 `true` 时出现 |

### 2.1 保留的旧裁决（**不得改写**）

`runningCount` 的语义是既有契约，本轮**不扩大**。旧裁决原文保留在两处：

- `docs/INTERFACES.md:1329-1330`：「⚠️ **`runningCount` 的口径刻意不变**（仍只数 `session.running`）：
  渲染层**无消费者**（`grep runningCount src/sidebar.tsx` 为空），用户裁决 Q1 明确「不改」，
  避免无声扩大契约。」
- `test/tree-model.test.mjs:1677`（测试名）：「需求 A: 容器/项目行的 runningCount 口径**不变**
  （用户裁决 Q1：渲染层无消费者）」。

**本轮的变化只在于「消费者改用新字段 `hasRunningTasks`」**：`runningCount` 依旧只数
`session.running`，那条既有测试**不需要、也不允许**被反转或删除（T-4 只**新增**断言）。
「新字段的存在」不推翻 Q1 —— Q1 管的是 `runningCount` 的口径，不是「容器行永远不能有运行态视觉」。

### 2.2 追加裁决（2026-10-20，T-8 覆盖 RT2 的聚合范围）

**用户原话**：

- 「无 worktree 的工作区，如果有任务在进行，文件夹 icon 也要高亮。」
- 追问「是否只有完全无 worktree 的 workspace 才统计普通会话」后，用户明确选：
  **所有 workspace 都统计普通会话** —— worktree 都空闲、但有 flat 会话在跑时，
  project 文件夹也要亮；**不局限于完全没有 worktree 的 workspace**。

**落地口径（原样）**：

1. project 行 `hasRunningTasks` = 任一 worktree 子行 `true` **OR** 该 workspace 的普通/flat
   会话容器 `hasRunningTasks === true`；
2. 统计范围只含**该 workspace 的** flat 会话，**不含** history 桶、**不含**未分组；
3. worktree 行判定**不变**（仍只读自己的容器结果）；
4. 无 worktree 子项、flat 也无会话/全空闲 ⇒ `false`（不得把 `allResults` 整体并入）。
5. **「该 workspace」的边界（F17-4 nit）**：非 git 工作区里 `project == workspace`，flat 容器就是它自己的；
   git 项目一个 repo 可承载多个 workspace，但 git 的 `flatSessions` 恒为空 ⇒ 实现取的是 **project（repo）级**
   `project.flatSessions` 合成容器，**仅作形状守卫**（真实数据不可达）。这不构成行为差异。

> 该裁决**覆盖**本节 RT2 原文中的「只聚合 worktree 子项」与「非 git 平铺不参与」；
> history / 未分组的排除**不变**。设计见 [§3.3 / §4](../design/2026-10-20-running-task-highlight.md)，
> 契约见 [INTERFACES §2.2.1](../INTERFACES.md)。

## 3. 验收标准

**约定**：每条标准都标注验证方式 —— `纯逻辑`（`node --test` 可覆盖）、`AST`（源码接线断言）、
`人工`（浏览器肉眼，当前 GUI 无法脚本截图，见 §5）。

| # | 验收标准 | 验证方式 |
|---|---|---|
| **AC1** | worktree 容器内**主会话**自身 `running === true` ⇒ 该 worktree 行的 `hasRunningTasks === true`，其它 worktree 为 `false` | 纯逻辑 |
| **AC2** | worktree 内**只有子代理在跑**（父会话 `running === false`、有运行中子代理后代）⇒ `hasRunningTasks === true`；同一时刻父会话行的 `running === true`（**同源同口径，不得分叉**） | 纯逻辑 |
| **AC3** | project 行：任一 worktree 子行 **或**该 workspace 的 flat 会话容器 `hasRunningTasks === true` ⇒ project 行 `true`；两者全空闲 ⇒ `false` | 纯逻辑 |
| **AC4** | project 行聚合 = worktree 子项 **OR** 该 workspace 的 flat/普通会话：任一 worktree 或 flat 有运行中会话 ⇒ `true`；**不聚合** history 桶与未分组：这两处有运行中会话时 project / 未分组行仍为 `false`；`history` 行**没有**该字段（clock 图标永不高亮） | 纯逻辑 |
| **AC5** | 数据不依赖渲染：worktree **折叠**、容器会话超过 5 条被截断（运行中的排在第 7 位）、行在视口外 ⇒ `hasRunningTasks` 仍为 `true` | 纯逻辑 |
| **AC6** | 沿用既有可见性语义（`isVisibleMember`）：**归档**会话、**非当前 blank** 会话即使 `running` 也不计入；**当前 blank** 会话可见且计入 | 纯逻辑 |
| **AC7** | `runningCount` **零回归**：只有子代理在跑时，worktree / project 行的 `runningCount` 仍为 `0`（T-1 的既有断言 `test/tree-model.test.mjs:1677` 保持通过，不被反转） | 纯逻辑 |
| **AC8** | 渲染只在 `project` / `worktree` 行、且 `hasRunningTasks === true` 时给 lead 图标着色：`color: var(--dsw-alias-state-business-primary, #4176e6)` + `filter: drop-shadow(0 0 2px var(--dsw-alias-state-business-primary, #4176e6))`；`history` 的 clock 永不高亮；**不整行着色、无状态点、无数字徽章** | AST + 人工 |
| **AC9** | 高亮行的行根 DOM 带 `data-running="true"`；不高亮时**不出现**该属性；高亮时 lead span 的 `title === t('a11y.runningTask')`，中文渲染为「有任务正在运行」；`a11y.runningTask` 是**唯一**新增 locale key | AST + 纯逻辑（locales） |
| **AC10** | 快速刷新：`runningSignature(status)` 只在「`running === true` 的会话集合」变化时改变；该值变化经**既有 220 ms 防抖**触发一次 `POST /dsh-worktree-groups/tree`；首拉、30 s 轮询（`TREE_REFRESH_MS`）、`window` focus 强刷全部保留 | 纯逻辑 + AST |
| **AC11** | 安全与性能边界：签名函数对任何非 `Map` / 抛错 / 异常形状返回空串且**不抛**；签名值**不得**进入 `reload` 的 `useCallback` 依赖（否则 30 s 定时器被反复重置）；hook 调用顺序不变 | AST |
| **AC12** | 非目标不越界：`wide === false` 轨道态、搜索态容器行、`history` / 未分组聚合、宿主或全局配置均不改（flat/普通会话聚合是 **2026-10-20 追加在目标内**的，不再是非目标） | 代码审查 + 人工 |
| **AC13** | 人工验收：**重建 client bundle（`npm run build` 或 `build:client`）+ 刷新页面**后按设计文档 §11 清单确认「亮起 / 熄灭 ≤1 s、折叠态仍亮、子代理场景一致、普通/flat 会话在任意 workspace 都亮、history/未分组不误亮、暗色可辨、无渲染错误」；刷新无效再重启 DSH Desktop 兜底（仅首次安装 / 新增 bundle 或宿主代码改动**必须**重启） | 人工（脚本不可截图） |

## 4. 非目标

1. **不加状态点**（含复用宿主 `StateDot`）、**不加数字徽章 / 「N 运行中」胶囊**。
2. **不整行着色**、不加左侧竖条（与拖拽插入线 `dragLineStyle` 视觉冲突）。
3. `history` 行（clock 图标）不高亮；`history` 桶与未分组**不参与** project 聚合；
   **flat/普通会话参与**（2026-10-20 追加裁决，所有 workspace 一致）。
4. `wide === false`（36 px 轨道态）不处理：该分支只渲染一个按钮，没有任何行可高亮。
5. 搜索模式（`query` 非空）不处理：只产出会话行，没有容器行。
6. 不改 `runningCount` / `pendingCount` / `sessionCount` 的口径；不改会话行 `StatusDot` 视觉。
7. 不改宿主、全局配置、`cordis.patch.yml`；不新增宿主图标名（复用 `folderOpen` / `folderClose` / `branch` / `clock`）。
8. 本任务（T-3）**不改** `src/`、`test/`、`package.json`、`lib/`；不提交、不切分支、不清理工作区。
9. 不追求「运行中数量」的展示精度，也不引入新的数据源或新的事件订阅通道（只用既有 root hook）。

## 5. 约束、依赖与运行时事实

**契约约束**

- `RenderRow` 的字段集合是**冻结契约**（`INTERFACES.md` §2.2）。本轮是**经用户确认的 additive 修订**：
  只**新增** `hasRunningTasks`，不改任何既有字段名 / 类型 / 语义，不改 `runningCount`。
- locale key 集合同为冻结集（`INTERFACES.md` §2.1）：先改契约、再用 key，避免界面露裸 key
  （历史缺陷见 `INTERFACES.md` §2.1 的 2026-09-23 记录）。

**运行时事实（决定验收方式）**

- **生效路径（T-11 更正，依据审查 §17.8）**：`hasRunningTasks` 由 `src/tree-model.ts` 的 `buildRows`
  计算，而 `buildRows` **只在 client bundle**（`src/sidebar.tsx` → `src/client.tsx` → `lib/client.js`）；
  宿主路由 `POST /tree` 只返回**原始** `projects` / `ungrouped`（`src/routes.ts:820-825`、`:1386-1393`），
  **不产出**该字段。⇒ 本需求的改动 **`npm run build`（或 `build:client`）+ 刷新页面**即生效，
  **不需要**重启 DSH Desktop；只有「首次安装 / 新增 bundle」（PRD :668）或改了宿主代码
  （`src/index.ts` / `src/routes.ts` / `src/projects.ts`）才必须重启。刷新无效再重启兜底。
- 渲染与刷新同属**客户端半边**；`npm run build:client` 后宿主 500 ms 轮询热重载，或手动刷新页面。
- **当前 GUI 无法脚本截图 / 抓 DOM**（HTTP 403、无 CDP 端口、无 playwright，T-2 §6）⇒
  视觉正确性**只能人工验收**；`test/render-smoke.test.mjs` 是 SSR、不跑 effect、渲染不出真实行，
  **不能**作为本需求的视觉证据。

## 6. 相关文档

| 文档 | 用途 |
|---|---|
| [设计：运行中任务图标高亮](../design/2026-10-20-running-task-highlight.md) | 数据流、字段语义与边界、渲染落点、签名与防抖、测试矩阵、风险 |
| [工作记录：运行中任务图标高亮](../worklog/2026-10-20-running-task-highlight.md) | 本轮 T-3 的决策、产物、证据与后续任务 |
| [PRD §12](../PRD.md) | 需求汇总与决策表（含旧 Q1 裁决的保留说明） |
| [INTERFACES §2.2 / §2.3 / §2.3.2](../INTERFACES.md) | `hasRunningTasks` 字段、渲染与刷新接线、`runningSignature` 导出契约、locale key |
| [T-1 调研](../research/2026-10-20-running-task-highlight-research.md) | 现状链路、落点行号、方案取舍、测试边界 |
| [T-2 宿主核实](../research/2026-10-20-host-capability-verification.md) | 图标 `style` 不透传、主题变量真实值、`useSessionStatus` 覆盖与频率、重启与截图限制 |
