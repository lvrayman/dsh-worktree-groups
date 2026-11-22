# 设计：运行中任务的文件夹 / worktree 图标高亮

- **文档类型**：技术设计（实现前定稿，是 T-4 的唯一实现依据）
- **日期**：2026-10-20
- **任务**：T-3（只写文档，不改 `src/` / `test/`）
- **状态**：已定稿
- **需求**：[需求：运行中任务的文件夹 / worktree 图标高亮](../requirements/2026-10-20-running-task-highlight.md)（AC1–AC13）
- **契约落点**：[INTERFACES §2.1 / §2.2 / §2.3 / §2.3.2](../INTERFACES.md)；需求汇总 [PRD §12](../PRD.md)
- **证据来源**：[T-1 调研](../research/2026-10-20-running-task-highlight-research.md)（现状链路与落点行号）、
  [T-2 宿主核实](../research/2026-10-20-host-capability-verification.md)（图标 `style` 不透传、主题变量真实值、`useSessionStatus` 覆盖与频率、重启与截图限制）
- **行号基线**：本文引用的 `src/` 行号均为 **T-4 改动前**的磁盘状态（`src/sidebar.tsx` 2870 行、
  `src/tree-model.ts` 2379 行、`src/live-state.ts` 187 行）；T-4 落地后行号会偏移，**以符号名为准**。

## 章节目录

1. [事实基线与设计约束](#1-事实基线与设计约束)
2. [数据流](#2-数据流)
3. [字段语义与判定](#3-字段语义与判定)
4. [边界表（折叠 / 截断 / 空白 / 归档 / 搜索 / 轨道态 / 三桶）](#4-边界表折叠--截断--空白--归档--搜索--轨道态--三桶)
5. [渲染落点](#5-渲染落点)
6. [颜色、光晕、可访问性与主题](#6-颜色光晕可访问性与主题)
7. [快速刷新：签名与防抖](#7-快速刷新签名与防抖)
8. [性能量级](#8-性能量级)
9. [测试设计（Red → Green）](#9-测试设计red--green)
10. [T-4 实施清单与顺序](#10-t-4-实施清单与顺序)
11. [人工验收清单（重建 client bundle + 刷新页面）](#11-人工验收清单重建-client-bundle--刷新页面)
12. [风险与限制](#12-风险与限制)
13. [单一事实源检查点（文档一致性）](#13-单一事实源检查点文档一致性)

---

## 1. 事实基线与设计约束

| # | 事实 | 证据 | 对设计的强制影响 |
|---|---|---|---|
| F1 | 容器行（`project` / `worktree` / `history`）共用 `ContainerRowView`，lead 图标在此计算 | `src/sidebar.tsx:776`、`:781-785` | 高亮落点**唯一**在此；history 必须被排除 |
| F2 | 容器行目前没有运行态视觉；会话行蓝点已含子代理聚合 | `src/sidebar.tsx:421-430`、`:937`；`src/tree-model.ts:2216-2219` | 容器高亮应与蓝点**同源同口径**（否则子代理场景会出现「蓝点亮、图标不亮」的矛盾） |
| F3 | 容器已有 `runningCount` / `pendingCount`，但语义只数主会话 `running`，且渲染层零消费者（用户 Q1 裁决） | `src/tree-model.ts:1913-1915`、`:2311-2313`；`docs/INTERFACES.md:1212-1213`；`test/tree-model.test.mjs:1677` | **不改 `runningCount`**，新增独立布尔字段 `hasRunningTasks`（additive） |
| F4 | 容器可见会话 = `isVisibleMember`（非子代理、非归档、非当前之外的 blank），计数用**截断前**的 `heads` | `src/tree-model.ts:1760-1766`、`:1854-1875` | 判定必须基于 `heads`，且沿用同一可见性谓词 |
| F5 | 运行中子代理索引已在上下文里（`subagentRunningCounts`，键为归一化 id，查询走 `subagentCountOf`） | `src/tree-model.ts:1148`、`:1219`、`:1374-1376`、`:2257` | 聚合判定**零新增数据源** |
| F6 | 宿主图标组件只解构 `size/className/strokeWidth`，`style`/`color` 被丢弃；SVG 用 `currentColor` | T-2 §3.1（`dsh-client-ui-primitives/lib/index.js:1777-1781`、`:442-452`）；`src/sidebar.tsx:117-122` | 颜色**不能**走 `icon(name, { style })`，必须落在**外层 span** 的 `color` |
| F7 | `--dsw-alias-brand-primary` 是近黑/近白中性色，不是品牌蓝；品牌蓝是 `--dsw-alias-state-business-primary`（明 `#4176e6` / 暗 `#7aaaff`） | T-2 §4 | 用 `var(--dsw-alias-state-business-primary, #4176e6)`，**不用** `brand-primary` |
| F8 | `useSessionStatus` 覆盖客户端会话表全量（含未打开与子代理），只在 `agent/status` 迁移时发布并做内容去重 | T-2 §1.2–§1.3 | 「运行集合签名」是低噪声触发源；可得到约 0.3–1 s 的可见延迟 |
| F9 | 现有重取触发：快照防抖 220 ms、30 s 轮询、focus 强刷；`reload` 的 `useCallback` 依赖是 `[t]` | `src/sidebar.tsx:196`、`:199`、`:1623-1656`、`:1659-1669` | 签名**加进防抖依赖**，**禁止**加进 `reload` 依赖 |
| F10 | **部署生效路径（T-11 更正，依据审查 §17.8）**：`buildRows` 只随 `src/client.tsx` 打进 `lib/client.js`；`POST /tree` 返回**原始** projects/ungrouped（`src/routes.ts:820-825`、`:1386-1393`），从不调用 `buildRows` ⇒ **重建 client bundle + 刷新页面**即生效。只有**宿主代码**（`src/index.ts` / `routes.ts` / `projects.ts`）改动才必须重启（`hmr.root = []`，T-2 §5.2）；当前 GUI 无法脚本截图 | T-2 §5.2、§6；[审查 §17.8](../reviews/2026-10-20-running-task-highlight-review.md) | 本需求的 flat 聚合与高亮**不需要**重启 DSH Desktop；仅「首次安装 / 新增 bundle」（PRD :668）与宿主代码改动需重启；视觉只能人工验收 |

**设计约束（不可协商）**

- 字段名唯一：`hasRunningTasks: boolean`（`project` / `worktree` 行必填）。
- locale key 唯一：`a11y.runningTask`，中文「有任务正在运行」。
- 颜色唯一：`var(--dsw-alias-state-business-primary, #4176e6)`；光晕唯一：`drop-shadow(0 0 2px …)` 同色。
- 刷新信号唯一：`runningSignature(status: unknown): string`（`src/live-state.ts` 导出）。
- 不改 `runningCount`、不改会话行视觉、不新增宿主图标名、不注入 `<style>`。

## 2. 数据流

```
宿主 ctx.sessionController.list({})            ← 唯一权威运行态（含子代理会话，T-2 §2）
        │  SessionSummary.running / parentSessionId / origin / blank
        ▼
src/routes.ts（无需改动）→ POST /dsh-worktree-groups/tree
        ▼
src/tree-model.ts : buildRows → emitContainer（每容器）
        │  heads = visibleMembers(...) ──按 isVisibleMember 过滤（F4）
        │  hasRunningTasks = heads.some(自身 running===true || subagentCountOf(...)>0)   ← 新增
        ▼
RenderRow.project / RenderRow.worktree：新增 hasRunningTasks（history/session/more 不变）
        ▼
src/sidebar.tsx : ContainerRowView
        │  runningHighlight = row.kind === 'history' ? false : row.hasRunningTasks === true
        ├─ lead span：color / filter / title(t('a11y.runningTask'))
        └─ 行根 div：data-running="true"（仅高亮时）
        ▲
        │ 触发重取（新增第四条）
src/sidebar.tsx : runningSignature(sessionStatus) 变化 → 220 ms 防抖 → reload()
        ▲
src/live-state.ts : runningSignature(useSessionStatus 快照)   ← 纯函数，只取 running===true
```

**两条互不依赖的路径**：① 数据（host，字段）；② 刷新与视觉（client，span/属性/防抖）。
两者都落地后才能看到最终效果；只落一半的表现见 §12 R1。

## 3. 字段语义与判定

### 3.1 `RenderRow` 类型修订（additive）

```ts
// kind: 'project'（含未分组行，未分组也复用 project 形态）
hasRunningTasks: boolean
// kind: 'worktree'
hasRunningTasks: boolean
```

- **必填**（不是可选）：缺字段会在编译期暴露所有构造点，避免「漏填 = 静默 false」。
- `history` / `session` / `more` 三个变体**不加**字段（history 的 clock 永不高亮；未分组行虽然是
  `project` 形态，但按 RT2 恒为 `false`）。
- JSDoc 必须写明：语义 = 「该行是否有任务正在运行（含运行中的子代理）」，且**不是**
  `runningCount > 0` 的别名；`runningCount` 语义未变（见 §3.4）。

### 3.2 worktree 判定（唯一实现点：`emitContainer`）

```ts
// ContainerResult 新增内部字段（用于 project 聚合，不下发 history 行）
hasRunningTasks: heads.some(
  (session) =>
    session.running === true ||
    subagentCountOf(context.subagentRunningCounts, session.sessionId) > 0,
),
```

- `heads` = **截断之前**、**手动顺序之后**的可见顶层会话（`src/tree-model.ts:1855-1860`）⇒
  折叠 / 截断 / 视口外都不影响判定（AC5）。
- `heads` 已经过 `isVisibleMember`（`src/tree-model.ts:1854`）⇒ 归档、子代理、非当前 blank 自动排除（AC6）。
- 聚合判据与会话行 `running` **逐字同源**（`toSessionRow` 用 `subagentCountOf` 同一索引，
  `src/tree-model.ts:1891-1899`，`INTERFACES.md` §2.6 裁定 3）⇒ AC2 的「一致性」是结构性事实，
  不是注释承诺。**不要**另写一份 `running === true` 单口径（会重现 T-1 的 R1 矛盾）。

### 3.3 project 判定（唯一实现点：`buildRows` 的 project 分支）

```ts
// worktree 子项 OR 该 workspace 的 flat/普通会话（history / 未分组不参与）
hasRunningTasks:
  worktreeResults.some((entry) => entry.result.hasRunningTasks === true) ||
  flatResult.hasRunningTasks === true,
```

- **2026-10-20 追加裁决（T-8）**：本节原先只聚合 worktree 桶；用户追加拍板
  「所有 workspace 的 project 文件夹都聚合该 workspace 的普通/flat 会话」（含
  「worktree 都空闲、但有 flat 会话在跑时也要亮」），故判定扩为 **worktree OR flat**。
  history 桶与未分组仍**不参与**。
- `worktreeResults` 定义在 `src/tree-model.ts:2345-2349`；`allResults`（含 flat / history）
  **不得**整体用于此判定 —— 它会把 history 桶也带进来。
- `flatResult` = **该 project 的**普通/flat 会话容器结果（不是全局、不是未分组）。
  `containers.flat` 只对非 git 工作区存在（`src/tree-model.ts:1736-1747`，D11：git 项目的
  会话挂 worktree 子行）；因此 `buildRows` 对 git 项目用 `project.flatSessions` 构造一个
  **仅供判定**的等价容器（`rendersFlat` 控制渲染与 `sessionCount` 仍只走非 git）。
  真实宿主数据里 `flatSessions` 对 git 项目恒为空（`src/projects.ts:289`、`:423-431`），
  该分支用于锁住契约口径（A15）。
- flat 容器为空 / 无会话 ⇒ `hasRunningTasks` 为 `false`（`emitContainer` 的空 `heads`），
  **不要**为此特判，更不能把 `allResults` 整体并入。
- 未分组行（`kind: 'project'`，`src/tree-model.ts:2423-2446`）：**显式**写
  `hasRunningTasks: false`（即使 `result.hasRunningTasks` 为 true 也不许用），
  并加注释说明这是用户裁决 RT2。
- history 行（`src/tree-model.ts:2405-2419`）：**不加**字段；`historyResult.hasRunningTasks`
  计算了也不消费。

### 3.4 与 `runningCount` 的关系（旧裁决原样保留）

| 字段 | 口径 | 本轮是否改 | 消费者 |
|---|---|---|---|
| `runningCount` | `heads.filter(s => s.running === true).length`（**仅主会话**） | **不改** | 仍无（新视觉不读它） |
| `hasRunningTasks` | `heads.some(s => s.running === true \|\| subagentCount > 0)` | **新增** | `ContainerRowView` 的图标高亮 |

- 旧裁决原文保留在 `docs/INTERFACES.md:1212-1213` 与 `test/tree-model.test.mjs:1677`，**不得改写或删除**；
  T-4 只**新增**断言，那条既有用例必须继续通过（AC7）。
- 因两者口径不同，**允许**出现「`runningCount === 0` 但 `hasRunningTasks === true`」（只有子代理在跑），
  这是 RT1 的设计意图，不是缺陷。

### 3.5 构造点清单（必须全部填上，否则 `tsc` 报错）

| 构造点（基线行号） | 字段值 |
|---|---|
| `src/tree-model.ts:2360-2379`（project 行） | `worktreeResults.some(...) \|\| flatResult.hasRunningTasks === true`（T-8 追加 flat） |
| `src/tree-model.ts:2320-2334`（worktree 行） | `entry.result.hasRunningTasks` |
| `src/tree-model.ts:2363-2374`（未分组 project 行） | 常量 `false` |
| `src/tree-model.ts:2341-2351`（history 行） | **不加字段** |
| `src/tree-model.ts:1911-1918`（`ContainerResult` 返回） | 新增内部字段（§3.2） |

## 4. 边界表（折叠 / 截断 / 空白 / 归档 / 搜索 / 轨道态 / 三桶）

| 场景 | `hasRunningTasks` | 依据 / 说明 |
|---|---|---|
| worktree 内主会话 `running === true` | `true` | §3.2 |
| worktree 内**只有子代理**在跑（父会话 `running === false`） | `true` | RT1；同一时刻父会话行 `running === true`（同源） |
| 多层子代理（depth 3）仍在跑 | `true` | `indexRunningSubagentDescendants` 累加到顶层可见行（F5） |
| worktree **折叠**（`collapsedKeys['w:…'] = true`） | 仍为 `true` | 判定在 `emitContainer` 内、与渲染无关 |
| 容器 > `COLLAPSED_SESSION_LIMIT`(5)，运行中的会话排第 7 | 仍为 `true` | 用截断前的 `heads`（§3.2） |
| 行在视口外 / 侧栏滚动 | 仍为 `true` | 数据在 `rows` 数组里 |
| 运行中的会话是**归档**会话 | 不计入 | `isVisibleMember` 排除归档（既有语义） |
| 运行中的会话是**非当前 blank** 会话 | 不计入 | `isVisibleMember` 要求非 blank 或当前会话 |
| 运行中的会话是**当前 blank** 会话 | 计入 | 当前会话豁免 blank 过滤，与 `runningCount` 一致 |
| 运行中的会话是**子代理**（`origin === 'subagent'`） | 不单独计入，但通过宿主父行聚合体现 | 子代理不产行；只在父行 `subagentCount` 中体现 |
| **history** 桶有会话在跑 | history 行**无字段**；project 行仍按 worktree + flat 判定（可为 `false`） | RT2；clock 永不高亮 |
| **非 git 平铺**（flat）有会话在跑 | project 行 `true` | **T-8 追加裁决**：所有 workspace 都聚合本 workspace 的普通/flat 会话 |
| **git workspace 有 worktree 且全部空闲、flat 会话在跑** | project `true`；worktree `false` | **T-8 追加裁决（A15）**；真实数据里 git 的 `flatSessions` 恒为空，本行锁契约口径 |
| **git + worktrees 为空 + flat 有值**（扫描降级形状） | **只判定、不渲染、不计数**：project `true`，但 `sessionCount === 0`、行序列里没有任何运行中的可见会话 | **known（T-10 F17-5 / T-11 补记）**：即「幽灵高亮」边界。真实数据**不可达**——git 的 `flatSessions` 恒为空（`src/projects.ts` 归属规则 2b），`worktrees: []` 只在扫描降级时出现（既有用例锁定「不崩、不吞 flat」）；用 A15 的计数断言兜住「不渲染/不计数」，**不修行为**，仅作数据模型变化时的护栏 |
| **未分组**行有会话在跑 | 未分组 project 行 `false` | RT2 |
| 搜索模式（`query.trim() !== ''`） | **不适用** | 只产出 session 行（`tree-model.ts:2261-2262` 附近），无容器行 |
| `wide === false`（36 px 轨道态） | **不适用** | 该分支只渲染一个按钮（`sidebar.tsx:2110-2134`） |
| 全部 worktree **与 flat** 均空闲 | project `false` | §3.3 |

## 5. 渲染落点

唯一改动文件：`src/sidebar.tsx` 的 `ContainerRowView`（基线 `:776-879`）。

### 5.1 高亮判据（一行，唯一）

```ts
// history 行没有该字段；project / worktree 行必填 boolean。
const runningHighlight = row.kind === 'history' ? false : row.hasRunningTasks === true
```

- 用 `=== true` 而不是真值判断：宿主 / 旧产物可能给出 `undefined`（未重启时的旧 `lib/`），
  `=== true` 保证「不认识 ⇒ 不高亮、不崩」。
- **必须**先按 `kind === 'history'` 排除：① history 行没有字段（不排除则类型不通过）；
  ② 用户裁决「clock 不高亮」。

### 5.2 lead 图标 span（颜色 / 光晕 / title）

```ts
jsx('span', {
  key: 'lead',
  ...(runningHighlight ? { title: props.t('a11y.runningTask') } : {}),
  style: {
    display: 'inline-flex', alignItems: 'center', flex: 'none', lineHeight: 0,
    ...dimText(12),                                   // 既有：label-tertiary 灰
    ...(runningHighlight
      ? {
          color: 'var(--dsw-alias-state-business-primary, #4176e6)',
          filter: 'drop-shadow(0 0 2px var(--dsw-alias-state-business-primary, #4176e6))',
        }
      : {}),
  },
  children: lead,
}),
```

- 覆盖顺序：高亮色必须写在 `...dimText(12)` **之后**（`dimText` 带 `color: var(--dsw-alias-label-tertiary, …)`）。
- **不要**给 `icon(...)` 传 `style` / `color`（F6：宿主组件丢弃它们，看起来"改了却没效果"）。
- `filter` 只加在高亮行：普通行零额外绘制成本。
- 不改 `children` 顺序、不改 label / chevron / 动作按钮 / 插入线，**不插入任何新 DOM 节点**
  （因此不会推动布局，也不会与拖拽插入线叠加）。

### 5.3 行根节点 `data-running`

```ts
return jsx('div', {
  role: 'treeitem',
  'aria-expanded': row.expanded,
  'data-key': row.key,
  ...(runningHighlight ? { 'data-running': 'true' } : {}),
  style: { /* 不变 */ },
  /* 其余 props 全部不变 */
})
```

- 值为字符串 `'true'`；不高亮时**不出现该属性**（不是 `"false"`）。
- 用途：无浏览器环境下唯一能断言「视觉真的接上了判据」的钩子（§9.3）。
- 与既有 `data-key` 共存，不冲突（无 `className` 体系，全部内联样式，F6/`grep className` = 0）。

## 6. 颜色、光晕、可访问性与主题

### 6.1 颜色

| 候选 | 明色 | 暗色 | 判定 |
|---|---|---|---|
| `--dsw-alias-brand-primary` | `#0f1115`（18.08:1） | `#f9fafb`（16.47:1） | **不用**：是中性前景色，会被误读为「选中」而非「运行」 |
| **`--dsw-alias-state-business-primary`** | **`#4176e6`（4.05:1）** | **`#7aaaff`（7.39:1）** | **采用**：真品牌蓝，满足非文本 3:1 |
| `--dsw-alias-state-warn-primary` | `#f59e0b`（2.06:1） | `#f59e0b`（8.01:1） | **不用**：明色不达 3:1 |

对比度数值来自 T-2 §4 的 node 计算（背景取侧栏底色 `#f9fafb` / `#1b1b1c`），**不是截图实测**。

### 6.2 光晕

- 固定 `drop-shadow(0 0 2px <同色>)`：半径 2 px 是 T-2 建议的上限（R6：16 px 图标上更大半径会糊边）。
- 只在高亮行加；不使用双层图标 / 描边 / 背景块。
- 光晕是**装饰**，不是唯一信息通道；信息通道是「颜色 + `title` 文案」。

### 6.3 可访问性

- 宿主图标没有可访问名（`StatusDot` 的注释已明确"可访问性靠外层 `title`"，`src/sidebar.tsx:419`）；
  因此高亮态必须给 lead span 补 `title`。
- key 固定 `a11y.runningTask`，中文「有任务正在运行」；与既有 `a11y.subagents`（`:952` 的胶囊
  `title`）同一种通道，风格一致。
- 不新增 `aria-label`（避免与 `title` 形成两套文案源）；不新增 `aria-live`（行级提示不需要打断朗读）。
- 高亮是**颜色 + 文案**双通道：色盲用户仍可从 tooltip 得到语义（悬停），满足 WCAG 1.4.1 的最低要求；
  代价是「不悬停时只能靠颜色」—— 这是用户 ET3「不加状态点」的直接结果，已在需求 §4 明示非目标。

### 6.4 主题

- 颜色全部走宿主 CSS 变量 + `#4176e6` 兜底（明色值）；暗色由宿主变量覆盖为 `#7aaaff`。
- 不写死第二种颜色，不做暗色分支判断（仓库无类名 / 主题选择器体系）。
- 当前 profile `preference: light`；暗色需人工切换确认（§11 第 7 步）。

## 7. 快速刷新：签名与防抖

### 7.1 纯函数契约（`src/live-state.ts` 新增导出）

```ts
/**
 * 运行中会话集合签名：只取 `running === true` 的会话 id，归一化去重、排序、逗号拼接。
 * 任何不认识的形状 / 遍历抛错 ⇒ 返回空串（绝不抛）。
 */
export function runningSignature(status: unknown): string
```

**精确语义（T-4 按此实现，测试按此断言）**

1. `status === null | undefined` 或 `typeof (status as any).entries !== 'function'` ⇒ `''`。
2. 遍历 `entries()`：`id` 非字符串 ⇒ 跳过；`id === ''` ⇒ 跳过；条目为 `null`/非对象 ⇒ 跳过；
   `(entry as { running?: unknown }).running !== true` ⇒ 跳过（**只认 `=== true`**，`undefined`/真值对象都不算）。
3. `key = normalizeSessionKey(id)`（复用 `src/live-state.ts:65-70`）；`key === ''` ⇒ 跳过；放入 `Set` **去重**
   （同一会话若同时以 `session-x` 与 `x` 出现，只算一次）。
4. `[...set].sort()`（JS 默认按 UTF-16 码元升序，结果确定）→ `join(',')`。
5. 遍历过程中任何异常 ⇒ `''`（整体 try/catch）。
6. 纯函数：不 import react / 宿主包、无 IO、不读时间与随机数；**忽略** `pendingInteraction` 与
   `completionUnread`（否则审批弹窗、完成未读也会触发重取）。

示例：`{ 'session-b': {running:true}, 'a': {running:true}, 'c': {running:false}, 'd': {running:undefined} }`
⇒ `"a,b"`。

### 7.2 `sidebar.tsx` 接线

```ts
// ① 与现有 sessionStatus 并排派生（普通值，不改 hook 数量、不改调用顺序）
const sessionStatus = sources.status(identity)                  // 基线 :1581
const runningSignatureValue = runningSignature(sessionStatus)   // 新增

// ② 加进既有 220 ms 防抖重取的依赖（基线 :1653-1656）
useEffect(() => {
  const timer = setTimeout(reload, RELOAD_DEBOUNCE_MS)   // 220
  return () => { clearTimeout(timer) }
}, [reload, sessionsSnapshot, currentSessionId, runningSignatureValue])
```

- `reload` 的 `useCallback` 依赖（基线 `:1650` 的 `[t]`）**保持不变**；**禁止**把签名放进去 ——
  否则每次状态迁移都会重建 `reload` ⇒ 30 s 定时器被反复重置（每 220 ms 重置一次），轮询与 focus
  兜底的事实形态被破坏（AC11）。
- 首拉 + 30 s 轮询 + `window` focus 强刷的 effect（基线 `:1659-1669`）**一行不改**。
- 不新增 `useEffect`、不新增 hook、不把 `Map` 本身塞进依赖（每次 `publishStatus` 都是新引用 ⇒ 每帧重取）。

### 7.3 为什么是签名而不是 `status` 对象

| 做法 | 后果 |
|---|---|
| `status` 进依赖 | 每次发布都是新 `Map` 引用 ⇒ 每次渲染都重取，HTTP 风暴 |
| `useSessions().byId[].running` 做触发 | 会话表任何突变（活动/重命名）都变 ⇒ 更吵（T-2 §2） |
| **签名字符串**（本设计） | 只在「运行集合」变化时变；`sameSessionStatus` 已先做内容去重，噪声最低 |

### 7.4 时延与频率

| 环节 | 典型耗时 |
|---|---|
| 状态迁移 → `publishStatus` → React 重渲染 | 同帧（事件驱动） |
| 防抖窗口 | 220 ms（固定） |
| `POST /tree` 往返（本机） | 数 ms ~ 数十 ms |
| 合计可见延迟 | **约 0.3–1 s**（满足 RT4 的 0.3–1 s 目标） |

| 场景 | 状态事件数 | `/tree` 请求数（220 ms 合并后） |
|---|---|---|
| 单会话一次普通回合 | 2 | ≤ 2 |
| 回合内多次工具 / 步进 | 0 | 0 |
| 5 个子代理先后结束 | ≤ 5 | 1（同窗口合并） |
| 基线轮询 | — | 2 / min |
| 用户疯狂开关任务 | 多 | 仍被 220 ms 合并 |

## 8. 性能量级

| 维度 | 量级 | 说明 |
|---|---|---|
| 新增数据源 | **0** | 复用 `heads` + 已有 `subagentRunningCounts` 索引；O(容器内可见会话数) |
| 字段体积 | 每容器行 +1 个 boolean | JSON 增量可忽略 |
| 渲染成本 | 仅高亮行多一个 `filter` | 常态 0–3 行；高亮行无新增 DOM 节点、无布局变更 |
| 签名计算 | 每次渲染 O(n log n)，n = 状态表大小（会话量级，几百） | 字符串拼接；无需 memo 也远低于 1 ms 量级 |
| 请求增量 | ≤ 每回合 2 次 `/tree` | 与既有快照防抖同数量级（T-2 §7.3） |
| 子代理噪声 | 每个子代理启停各 1 次状态迁移 ⇒ 可能多 1 次 `/tree` | 可接受：这正是「容器高亮含子代理」需要的信号 |

## 9. 测试设计（Red → Green）

**总体策略**：先按行为写**会红**的测试，再最小实现。三层，分别对应三种边界：

| 层 | 文件 | 覆盖 | 备注 |
|---|---|---|---|
| L1 纯逻辑 | `test/tree-model.test.mjs` | AC1–AC7 | 直接 import `../lib/tree-model.js`（**需先 `npm run build`**） |
| L2 纯逻辑 | `test/live-state.test.mjs` | AC10（签名）、AC11（不抛） | 同上 |
| L3 源码接线 | `test/sidebar-wiring.test.mjs` | AC8、AC9、AC10、AC11 | TypeScript 编译器 API 解析**真实** `src/sidebar.tsx`，格式/换行/注释免疫 |

**不适用**：`test/render-smoke.test.mjs` 是 `react-dom/server` SSR，不执行 `useEffect` ⇒ `reload()` 不跑、
`tree === null`，只渲染 loading 文案，**渲染不出任何容器行**（T-1 §5.1），不能作为本需求的视觉证据。
真实像素与明暗对比度只能人工（§11）。

### 9.1 Red → Green 序列（每步独立红/绿，禁止批量写完再实现）

| 步 | 先写的红测试（示例名） | 预期红的原因 | Green 的最小实现 |
|---|---|---|---|
| S1 | `运行中高亮/A1: worktree 主会话在跑 ⇒ 该 worktree hasRunningTasks=true，兄弟 false` | `hasRunningTasks` 字段不存在（`undefined`） | 类型加字段 + `ContainerResult` 加字段 + `emitContainer` 计算 + 三个构造点填值 |
| S2 | `运行中高亮/A2: 只有子代理在跑 ⇒ worktree=true 且父会话行 running=true（同源）` | 同上；实现若只读 `session.running` 则红 | 聚合判据（§3.2） |
| S3 | `运行中高亮/A3: project 任一 worktree=true ⇒ project=true；全空闲 ⇒ false` | project 未填字段 | project 聚合 = `worktreeResults`（T-8 起再并入 `flatResult`） |
| S4 | `运行中高亮/A4: history/未分组在跑 ⇒ project 与未分组行为 false；history 行无该字段` | 未特判 | RT2 实现 + 未分组常量 `false` |
| S5 | `运行中高亮/A5: 折叠 / 第 7 条被截断 ⇒ 仍为 true` | 若实现误用 `selected` 则红 | 用 `heads`（截断前） |
| S6 | `运行中高亮/A6: 归档 / 非当前 blank 在跑 ⇒ false；当前 blank 在跑 ⇒ true` | 若另写可见性谓词则红 | 复用 `isVisibleMember` 的 `heads` |
| S7 | `运行中高亮/A7: 只有子代理在跑 ⇒ runningCount 仍为 0（既有 1677 用例保持通过，只新增断言）` | 若顺手改 `runningCount` 则红 | 不动 `runningCount` |
| S8 | `running-signature/S1: 只含 running===true；undefined/false/真值对象不算` | 函数不存在 | `runningSignature` 骨架 |
| S9 | `running-signature/S2: id 归一化 + 去重（session-x 与 x 只算一次）` | 未去重 | `Set` + `normalizeSessionKey` |
| S10 | `running-signature/S3: 稳定排序、逗号拼接；两次同输入同输出` | 未排序 | `sort().join(',')` |
| S11 | `running-signature/S4: 任何异常形状返回 '' 且不抛（undefined/null/0/''/[]/{}/抛错 entries）` | 未兜底 | try/catch + 形状守卫 |
| S12 | `运行中高亮/接线: lead span 在 project/worktree 高亮时设 color=state-business-primary（fallback #4176e6）与 drop-shadow(0 0 2px)` | 渲染未改 | `ContainerRowView` lead span 样式 |
| S13 | `运行中高亮/接线: 判据读 row.hasRunningTasks 且用 === true；history 分支不高亮` | 未接线 | `runningHighlight` 判据 |
| S14 | `运行中高亮/接线: 行根 data-running 由同一判据驱动（不是写死）` | 未加属性 | 行根展开属性 |
| S15 | `运行中高亮/接线: lead span 的 title 取 t('a11y.runningTask')` | 未加 title | title + locales 词条 |
| S16 | `运行中高亮/接线: 220 ms 防抖依赖含 runningSignature(sessionStatus) 派生值；reload 依赖不含它；30 s 轮询与 focus 仍在` | 未接刷新 | §7.2 接线 |
| **S17** | **【T-8】** `运行中高亮/A7: 非 git flat 在跑 ⇒ project=true` 与 `A15: git worktree 空闲但 flat 在跑 ⇒ project=true、worktree=false` | project 判定未并入 flat（`false`） | `\|\| flatResult.hasRunningTasks === true`（§3.3） |

**每步命令（T-4）**：

```sh
npm run build     # 测试 import ../lib/*.js，必须先构建（会写 lib/，T-4 允许）
node --test test/tree-model.test.mjs
node --test test/live-state.test.mjs
node --test test/sidebar-wiring.test.mjs
npm run typecheck
```

Red 阶段若「红」的原因不是行为缺失（而是语法 / import / 构建错误），**必须先修环境再重跑**，
不得把环境错误当作预期失败（AGENTS.md §4）。

### 9.2 用例矩阵（必须全覆盖）

**A. `test/tree-model.test.mjs`（纯逻辑，`buildRows` 夹具现成）**

| ID | 输入 | 断言 |
|---|---|---|
| A1 | 单 worktree，1 条 `running: true` 主会话 | worktree `hasRunningTasks === true`；project `true` |
| A2 | 父 `running: false` + 子代理 `running: true` | worktree `true`；父会话行 `running === true`；`runningCount === 0` |
| A3 | depth 3 子代理链在跑 | worktree `true`（多层累加） |
| A4 | 两个 worktree，仅 A 在跑 | A `true`、B `false`、project `true` |
| A5 | 全部空闲 | 所有容器行 `false` |
| A6 | history 桶会话 `running: true`，worktree 全空闲 | history 行 `!('hasRunningTasks' in row)`；project `false` |
| A7 | 非 git 工作区 flat 会话 `running: true`（**T-8 已反转**） | project `true`（worktreeCount=0、无 worktree 子行前置） |
| A8 | 未分组会话 `running: true` | 未分组 project 行 `false` |
| A9 | `collapsedKeys['w:/repo'] = true`，该 worktree 有运行中会话 | worktree `true`（折叠不影响） |
| A10 | 7 条会话，运行中的 `updatedAt` 最小（排第 7，被截断） | worktree `true` |
| A11 | 归档会话 `running: true`（在 `archivedSessionIds`） | worktree `false` |
| A12 | 非当前 blank 会话 `running: true` | worktree `false` |
| A13 | 当前 blank 会话 `running: true` | worktree `true` |
| A14 | 既有 `需求 A: 容器/项目行的 runningCount 口径**不变**` 用例 | **保持通过**（不修改、不删除） |
| **A15** | **【T-8】** git workspace 有 worktree 且 worktree 空闲，但该 workspace 的 `flatSessions` 有 `running: true` | project `true`；worktree `false`（worktree 行判定不变）；**【T-11 补锁】** project `sessionCount === 1` / `runningCount === 0` / `pendingCount === 0`（git flat 不计入）；flat 会话 `f-flat` **零渲染**（`rows` 中无该 session 行） |

> A1/A2 需同时断言**同一份输入**里 worktree 行与父会话行的一致性（防分叉），这是 RT1 的核心价值。

**B. `test/live-state.test.mjs`（纯逻辑，签名）**

| ID | 输入 | 期望 |
|---|---|---|
| B1 | `Map{ a:{running:true}, b:{running:false}, c:{running:undefined} }` | `'a'` |
| B2 | `session-x` 与 `x` 都 `running: true` | `'x'`（归一化 + 去重） |
| B3 | 乱序插入 `b`、`a` | `'a,b'`（稳定排序） |
| B4 | 空 Map / 无 running | `''` |
| B5 | `undefined / null / 0 / '' / [] / {} / { entries: 1 }` | `''`，且**不抛** |
| B6 | `entries()` 抛异常的伪 Map | `''`，且**不抛** |
| B7 | 条目带 `pendingInteraction` / `completionUnread` 但 `running !== true` | 不进入签名（只认 running） |
| B8 | 非字符串 id / 空字符串 id | 跳过，不产生空元素（结果无首尾逗号） |

**C. `test/sidebar-wiring.test.mjs`（AST，真实源码）**

| ID | 断言（对 AST，不锁字面格式） |
|---|---|
| C1 | `ContainerRowView` 内 lead span 的 style 对象含 `color`，其值是指定 CSS 变量表达式（`--dsw-alias-state-business-primary` + `#4176e6` 兜底） |
| C2 | 同一 style 含 `filter`，值是 `drop-shadow(0 0 2px …)` 且颜色同为该变量 |
| C3 | 高亮判据引用 `row.hasRunningTasks`，比较运算为 `===`（不是真值判断），且被 `row.kind === 'history'` 排除 |
| C4 | 行根 `jsx('div', …)` 的 props 里 `data-running` 的值**追溯到**同一判据标识符（不是字面量 `'true'`） |
| C5 | lead span 的 `title` 实参追溯 `t('a11y.runningTask')`（字符串字面量精确匹配） |
| C6 | `icon(` 在 `ContainerRowView` 中的调用**不携带** `style` / `color` 实参（防止回退到无效方案） |
| C7 | `sidebar.tsx` 从 `./live-state.js` import 了 `runningSignature` |
| C8 | 220 ms 防抖 effect 的依赖数组里有一个**局部派生值**，其初始化表达式调用 `runningSignature(sessionStatus)` |
| C9 | `reload` 的 `useCallback` 依赖数组中**不含**该派生值标识符 |
| C10 | `TREE_REFRESH_MS` 定时器与 `window.addEventListener('focus', …)` 仍存在（兜底不回归） |
| C11 | **【T-7 补】** lead span 的 `color` 与 `filter` 都**位于 `runningHighlight` 条件分支内**（条件展开的 `whenTrue`，或三元值 + `whenFalse` 为 `undefined`/`void 0`）；移出条件「常亮」必须红（审查 F1） |
| C12 | **【T-7 补，R1 加固】** 行根 `jsx('div', …)` 的 style **不得**出现 11 类整行着色/描边/发光键：`background`/`backgroundColor`/`backgroundImage`/`borderLeft`/`borderColor`/`border`/`boxShadow`/`textShadow`/`filter`/`color`/`outline`，且 `ContainerRowView` 子树内无 `StatusDot` 调用、无 `role="status"`（数字 `sessionCount` 不在范围）（审查 F2 / AC8；R1 为 T-6 复核补入 `border`/`filter`/`textShadow`） |
| C13 | **【T-7 补】** `data-running` 不高亮时**不出现**：三元形态 `whenFalse` 必须是 `undefined`/`void 0`；条件展开形态属性必须在 `whenTrue` 内且 `whenFalse` 是 `{}`（`'true' : 'false'` 恒出现必须红）（审查 F3 / AC9） |
| C14 | **【T-7 补，R2 加固】** `[reload]` mount effect 体的**第一条语句必须是无参 `reload()`**（首拉），且其位置**先于** `setInterval(reload, TREE_REFRESH_MS)`（删首拉必须红；R2 补的「第一条语句」同时堵住「删首拉 + 把 `onFocus` 前移」绕过顺序断言的写法；`onFocus` 闭包里的 `reload()` 在定时器之后，不构成恒真）（审查 F5 / AC10） |

**D. 变异验证（判别力证据，T-5 复核用；M8–M12 为 T-7 补测）**

| 变异 | 做法 | 必须变红 |
|---|---|---|
| M1 | `data-running` 写死 `'true'` | C4 |
| M2 | 删掉 lead span 的着色分支 | C1/C2 |
| M3 | 判据换成 `row.runningCount > 0` | C3（接线）+ A2/A4（逻辑，若同时改 tree-model） |
| M4 | 把签名从防抖依赖里删掉 | C8 |
| M5 | 把签名加进 `reload` 的 `useCallback` 依赖 | C9 |
| M6 | project 判定改用 `allResults`（把 history 也并入） | A6（T-8 起 flat 已合法聚合，判别力由 history 用例 A6 守住） |
| M7 | worktree 判定只读 `session.running`（丢掉子代理） | A2 |
| M8 | **【T-7】** 把 `color` / `filter` 移出 `runningHighlight` 条件（所有容器图标常亮蓝） | C11（T-7 实测：fail 1） |
| M9 | **【T-7】** 行根 style 加 `background` + `borderLeft`（整行着色 + 左侧竖条） | C12（T-7 实测：fail 1） |
| M10 | **【T-7】** `data-running` 改为恒出现 `runningHighlight ? 'true' : 'false'` | C13（T-7 实测：fail 1） |
| M11 | **【T-7】** 删除 `a11y.runningTask` 词条（`npx tsc` 仍 exit 0） | `test/locales.test.mjs` 的 F4 词条用例（T-7 实测：fail 1） |
| M12 | **【T-7】** 删除 mount effect 的首拉 `reload()` | C14（T-7 实测：fail 1） |
| M13 | **【T-11 补测】** 把 `...(rendersFlat ? [flatResult] : [])` 改为 `flatResult`（只污染计数、不改渲染门控） | A15 的计数断言（T-11 实测：定向 `263/264`、fail **1**；`sessionCount 1→2`、`runningCount 0→1`，flat 仍不渲染 —— 证明新断言堵住了「变异全绿」缺口 F17-1） |

> M8–M12 由 T-7 补测引入（对应审查报告 F1–F5），用于堵住「非删除式回退仍全绿」的判别力缺口；
> 实测记录见 [审查报告 §14](../reviews/2026-10-20-running-task-highlight-review.md#14-t-7-处理结果)
> 与 [工作记录 T-7 节](../worklog/2026-10-20-running-task-highlight.md#t-7-补测与审查闭环2026-10-20)。


每个变异至少要 1 条用例变红，并记录 fail 数（沿用仓库既有变异验证惯例，见 `test/mutation-t11.md`）。

## 10. 实施清单与顺序

### 10.1 T-4 实施清单（历史，2026-10-20）

**改动文件（且仅这些）**

| 文件 | 改动 |
|---|---|
| `src/tree-model.ts` | `RenderRow` 两处新字段 + `ContainerResult.hasRunningTasks` + `emitContainer` 计算 + 三个构造点填值 + 未分组显式 `false` + 注释（旧 Q1 裁决原样保留） |
| `src/live-state.ts` | 新增导出 `runningSignature` |
| `src/sidebar.tsx` | import `runningSignature`；`ContainerRowView` 的 `runningHighlight` / lead span / 行根属性；`runningSignatureValue` + 防抖依赖 |
| `src/locales.ts` | 新增 `'a11y.runningTask': '有任务正在运行'`（放在 `a11y.subagents` 之后） |
| `test/tree-model.test.mjs` | 新增 A1–A13（**不改** A14 那条既有用例） |
| `test/live-state.test.mjs` | 新增 B1–B8 |
| `test/sidebar-wiring.test.mjs` | 新增 C1–C10 |

**明确不改**：`src/routes.ts`（`running` 已在 HTTP 面）、`src/icons.ts`（图标已存在）、`src/client.tsx`、
`cordis.patch.yml`、`package.json`、`docs/HOST-CONTRACTS.md`、两份 research 报告。

**顺序**：S1→S7（host 数据）⇒ `npm run build` ⇒ S8→S11（签名）⇒ S12→S16（渲染 + 刷新）⇒
`npm run typecheck` / `npm test` ⇒ `npm run build:client` ⇒ 请父代理安排重启与人工验收。
**注意**：数据字段（`tree-model` 的 `hasRunningTasks`）与 client 渲染必须**同时**落地（同一份 client bundle 里），
否则中间态是「字段在但没人画」（不可见）或「画了但字段缺失」（`=== true` 保护 ⇒ 永不亮，不崩）。
**T-11 补充**：这两者都在 `lib/client.js` 内，不需要重启宿主（见 §1 F10、§11 前提）。

### 10.2 T-8 追加需求实施清单（2026-10-20）

**改动文件（且仅这些；只动 tree-model + 其测试 + 文档）**

| 文件 | 改动 |
|---|---|
| `src/tree-model.ts` | `buildRows` 为**所有项目**构建 flat/普通会话容器（git 项目仅供判定、不渲染不计数）；project 判定加 `\|\| flatResult.hasRunningTasks === true`；`RenderRow.project` / `ContainerResult` / `buildRows` / 未分组行注释；**worktree 行判定不变** |
| `test/tree-model.test.mjs` | A7 断言反转为 `project=true`；新增 A15（git workspace worktree 空闲 + flat 在跑）；A1/A2/A4/A6/A8 保持不变 |
| `docs/requirements/2026-10-20-running-task-highlight.md` | RT2 / AC4 / AC12 / AC13 / 非目标 + 新增 §2.2 追加裁决 |
| `docs/design/2026-10-20-running-task-highlight.md` | §3.3 / §3.5 / §4 / §9.1 S17 / §9.2 A7·A15 / §10.2 / §11 第 5 步 / §13 |
| `docs/PRD.md` | §12 状态 + RT2 覆盖说明 + 新增 RT7 + 非目标修正 |
| `docs/INTERFACES.md` | §2.2 project JSDoc + §2.2.1 判定表 / 边界表 |
| `docs/worklog/2026-10-20-running-task-highlight.md` | 追加 T-8 节（Red/Green/全量证据） |

**明确不改**：`src/sidebar.tsx`、`src/live-state.ts`、`src/locales.ts`、`src/routes.ts`、`src/icons.ts`、
`src/client.tsx`、其他测试文件、`docs/testing/` 与 `docs/reviews/` 正文、`docs/README.md`、
`package.json`、`cordis.patch.yml`、配置；**不重启 DSH**、不提交、不切分支。

**顺序**：改 A7 + 加 A15 ⇒ `npm run build && node --test test/tree-model.test.mjs`（红：fail 2）⇒
最小改 project 判定 ⇒ 定向全绿 ⇒ `npm run typecheck` / `npm run build` / `npm test` ⇒ 文档同步 ⇒ 视觉待人工。

## 11. 人工验收清单（重建 client bundle + 刷新页面）

> 前提（**T-11 更正**，依据审查 §17.8）：`npm run build`（只改客户端时 `npm run build:client` 已足够）
> 重建 `lib/client.js` ⇒ **重新加载页面**（普通刷新；无效再硬刷新）。
> `buildRows` 与 flat 聚合都只在 **client bundle**；`POST /tree` 只返回原始 projects/ungrouped
> ⇒ **本需求通常不需要重启 DSH Desktop**。只有「首次安装 / 新增 bundle」或改了
> `src/index.ts` / `src/routes.ts` / `src/projects.ts` 这类宿主代码时才必须重启。
> 刷新后仍看不到新行为，再用「重启 DSH Desktop」兜底（成本高、会终结会话）。
> **当前 GUI 无法脚本截图 / 抓 DOM**（HTTP 403、无 CDP、无 playwright，T-2 §6）⇒ 以下逐项**只能人工**看。

1. **亮起**：在另一个 worktree 的会话里发一条会跑一会的指令 ⇒ 该 worktree 的 `branch` 图标在
   **约 0.3–1 s** 内变成主题蓝并带轻微光晕（不是等 30 s）。
2. **熄灭**：回合结束 ⇒ 约 1 s 内恢复原灰色。
3. **折叠态**：折叠该 worktree 后再次运行 ⇒ 折叠行本身仍高亮。
4. **子代理聚合（最关键）**：派生一个子代理并让父回合结束 ⇒ worktree **保持高亮**，且父会话行蓝点仍亮
   （两者同源 ⇒ 不应出现「一个亮一个不亮」）。
5. **project 聚合 flat/普通会话**：在**任何** workspace（含 git 项目）的普通/flat 会话里跑任务 ⇒
   对应 project 文件夹**亮**（worktree 都空闲时也应亮）；history 桶里有会话在跑 ⇒ clock 图标**不亮**；
   未分组会话在跑 ⇒ 未分组行**不亮**。
6. **颜色语义**：高亮是蓝（`state-business-primary`），与「选中行文字 / 悬停背景」可区分；不是近黑/近白。
7. **暗色主题**：切 dark 重复 1/6，图标在 `#1b1b1c` 底上仍清晰（预期 `#7aaaff`，7.39:1）。
8. **不误伤**：拖拽插入线仍为 2px 独立视觉；hover / 选中不因 `filter` 发糊；`wide=false` 轨道态与
   搜索态无容器行（预期不适用）。
9. **无回归**：侧栏不出现「侧栏渲染出错」，控制台无 `React error #130`（图标名缺失的典型症状）。
10. **压力**：同时开 3–4 个任务再全部结束，观察是否出现请求风暴或闪烁（预期无）。

## 12. 风险与限制

| # | 风险 / 限制 | 影响 | 处置 |
|---|---|---|---|
| R1 | **未重建 client bundle / 页面仍在跑旧 `lib/client.js`**（构建漏掉或浏览器缓存）：旧 bundle 的 project 判定不含 flat 聚合 ⇒ 高亮永不出现（`=== true` 保护，不崩） | 误判为"功能没做" | 交付说明写明「`npm run build`（或 `build:client`）→ 刷新页面；无效先硬刷新，再考虑重启兜底」。**注意**：这不是「宿主字段不存在」——`buildRows` 只在客户端 bundle，宿主 `lib/index.js` 从不产出该字段（T-11 更正，审查 §17.8） |
| R2 | 宿主 `useSessionStatus` 的「覆盖全量会话」是**实现事实**而非文档契约（T-2 R1） | 宿主升级可能让签名漏事件 | 保留 30 s 轮询 + focus 兜底；签名对不认识的形状返回 `''` 不抛 |
| R3 | `running` 可能为 `undefined`（未观测过的会话） | 真值判断会误亮 | 全程 `=== true` |
| R4 | 主题 token 可能被 skin 覆盖（当前 profile 已禁用 `ui-skin-maid-atelier`） | 对比度变化 | 用宿主变量而非硬编码；换皮肤需重测（T-2 R7） |
| R5 | `drop-shadow` 在 16 px 上可能糊边 / 发灰（T-2 R6） | 视觉不精致 | 半径固定 2 px、颜色同主题色、只给高亮行；不接受就退回纯 `color`（属视觉微调，不改契约） |
| R6 | 高亮是「颜色为主」的单通道（用户明确不加状态点） | WCAG 1.4.1 仅靠 `title` 补足 | 需求 §4 已把"加状态点/徽章"列为非目标；如需强化须重新拍板 |
| R7 | 无法脚本化验证真实像素与明暗对比度 | 视觉缺陷可能漏检 | §11 人工清单 + T-2 §8 的 10 步验收 |
| R8 | `data-running` 只是可断言钩子，不代表真实像素 | 可能"测试全绿但渲染错" | C1–C6 同时锁 style 值（颜色/光晕表达式），不只锁属性 |
| R9 | 子代理启停会额外触发 `/tree`（每个子代理 1–2 次） | 请求数轻微上升 | 220 ms 防抖合并；量级仍为「每回合个位数」（§7.4） |
| R10 | 行号会随实现漂移 | 文档引用逐渐失效 | 本文以符号名为准（§ 头部声明）；T-4 完成后由 T-5 复核并按需更新行号 |

## 13. 单一事实源检查点（文档一致性）

T-4 / T-5 落地后用以下 grep 自检，确保**没有第二套字段名 / 第二套口径 / 第二套 key**：

```sh
# 字段名唯一：只允许 hasRunningTasks，不允许 active/running*/hasRunning/…
grep -rn "hasRunningTasks" docs/ src/ test/ | grep -v "2026-10-20-running-task-highlight" | wc -l
grep -rn "hasRunning\b\|activeRow\|isRunningTask" src/ test/ || true

# locale key 唯一：只允许 a11y.runningTask
grep -rn "a11y.runningTask" src/ docs/ test/
grep -rn "runningTask" src/locales.ts

# 颜色 / 光晕唯一
grep -rn "state-business-primary" src/sidebar.tsx

# 刷新信号唯一
grep -rn "runningSignature" src/ test/ docs/

# 旧裁决仍在（不得被删改）
grep -n "runningCount 的口径刻意不变" docs/INTERFACES.md
grep -n "容器/项目行的 runningCount 口径" test/tree-model.test.mjs
```

**文档间的同一事实**（改动任一文档必须同步其余两处）：

| 事实 | 需求 | 设计 | 契约 |
|---|---|---|---|
| 字段名 `hasRunningTasks`（project/worktree 必填） | §2 RT5、AC1–AC7 | §3.1 | INTERFACES §2.2、§2.2.1 |
| worktree 判据 = 自身 running 或运行中子代理 | RT1、AC2 | §3.2 | §2.2.1 |
| project = worktree 桶 **∪ 本 workspace 的 flat/普通会话**（history / 未分组排除） | RT2（含 §2.2 追加）、AC4 | §3.3 | §2.2.1 |
| 颜色 `state-business-primary` + 2px 光晕 | RT3、AC8 | §5.2、§6 | §2.3「运行中任务高亮」 |
| `a11y.runningTask` = 有任务正在运行 | RT6、AC9 | §6.3 | §2.1、§2.3 |
| `data-running` 钩子 | RT6、AC9 | §5.3 | §2.3 |
| `runningSignature` + 220ms 防抖，保留 30s/focus | RT4、AC10 | §7 | §2.3、§2.3.2 |
| 重建 client bundle（`npm run build` / `build:client`）+ 刷新页面即生效；仅首次安装 / 新增 bundle 或宿主代码改动才需重启；视觉只能人工验收 | §5 | §11 | —（PRD §12 说明） |
