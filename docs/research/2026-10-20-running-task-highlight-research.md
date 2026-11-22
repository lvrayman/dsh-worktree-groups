# 调研：运行中任务驱动的文件夹 / worktree 图标高亮

- **日期**：2026-10-20
- **任务**：T-1（调研，只读源码/文档，产出研究报告）
- **状态**：已完成（含未验证项，见 §6）
- **需求（待确认原文）**：workspace 内任意 worktree 有正在运行的任务时，**文件夹高亮**；worktree 有正在运行任务时，**其 icon 高亮**。
- **非目标**：本次不改 `src/`、`test/`、`package.json`、任何配置与现有文档；不提交、不切分支。
- **写入范围**：本文件 + 检查点 `~/.local/state/ai-work-dispatcher/runs/2026-10-20-running-highlight/progress/T-1.md`。

## 章节目录

1. [起点：工作区状态](#1-起点工作区状态)
2. [现状：渲染链路与视觉机制](#2-现状渲染链路与视觉机制)
3. [运行态数据事实](#3-运行态数据事实)
4. [高亮可行方案与推荐](#4-高亮可行方案与推荐)
5. [测试边界](#5-测试边界)
6. [风险、未知与需要拍板的问题](#6-风险未知与需要拍板的问题)
7. [证据：实际执行的命令与输出](#7-证据实际执行的命令与输出)

---

## 1. 起点：工作区状态

调研开始时的 `git status --porcelain`（**未做任何改动**，仅读取）：

```
 M docs/HOST-CONTRACTS.md
 M docs/INTERFACES.md
 M docs/README.md
 M docs/knowledge/README.md
 M docs/knowledge/l2-modules/WebClient模块技术文档.md
 M docs/knowledge/l3-components/Sidebar技术文档.md
 M src/sidebar.tsx
?? docs/knowledge/l3-components/Icons技术文档.md
?? docs/knowledge/l3-components/LiveState技术文档.md
?? docs/worklog/2026-10-19-sidebar-render-failure-icons.md
?? src/icons.ts
?? src/live-state.ts
?? test/icons.test.mjs
?? test/live-state.test.mjs
?? test/render-smoke.test.mjs
```

- 分支 `master`，HEAD `5d2fe51`（`fix(worktree-groups): 修复侧栏右键菜单渲染裸 key`）。
- **重要**：`src/icons.ts`、`src/live-state.ts` 及其测试是**未提交的新文件**，但已被 `src/sidebar.tsx` 引用（`sidebar.tsx:44` 起 import）。本报告把它们当作**当前事实**（磁盘上的源码即当前行为），不视为"未来改动"。
- 任何新实现都必须基于这份含未提交改动的工作树继续，**不能回滚这些文件**。

## 2. 现状：渲染链路与视觉机制

### 2.1 数据 → 行 → DOM 的完整链路

| # | 环节 | 位置 | 关键事实 |
|---|---|---|---|
| 1 | 树数据取数 | `src/sidebar.tsx:1623`（`reload`） | `POST /dsh-worktree-groups/tree`，带 `AbortController`（`:1624`） |
| 2 | 触发时机 | `:1653-1656`、`:1658-1669` | ① `sessionsSnapshot` / `currentSessionId` 变化 ⇒ 220ms 防抖重取（`:199`）；② **30s 轮询**（`:196` `TREE_REFRESH_MS = 30_000`，`:1661`）；③ 窗口 `focus` 强刷（`:1662`） |
| 3 | 服务端投影 | `src/routes.ts:293-372`（`loadSessionSummaries`）、`:387`、`:405` | 权威来源是 `ctx.sessionController.list({})` → `SessionSummary[]`（**含 `running`**，`:16` 注释表） |
| 4 | 行投影 | `src/routes.ts:421-448`（`toSessionRow`） | `running: summary?.running === true`（`:441`）——**裸 `SessionSummary.running`** |
| 5 | 建模 | `src/tree-model.ts:2246`（`buildRows`）→ `emitContainer`（`:1831` 声明，计数在 `:1911-1917`）、`toSessionRow`（`:1784`） | 产出冻结的 `RenderRow[]`；容器的 `runningCount` 在 `:1914` 计算 |
| 6 | 视图拼装 | `src/sidebar.tsx:2808`（`buildTreeView`）→ `:2860`（`buildRows` 调用） | 行 + `worktrees` / `projects` / `worktreeOwner` 三张附加表 |
| 7 | 行循环 | `src/sidebar.tsx:2149-2337` | 按 `row.kind` 分派：session（`:2177`）、more（`:2191`）、history（`:2203`）、worktree（`:2213-2235`）、project（`:2278-2337`） |
| 8 | 容器行渲染 | `src/sidebar.tsx:776`（`ContainerRowView`），`:882`（`HoverContainerRow`） | project / worktree / history **三种行共用同一个组件** |
| 9 | 会话行渲染 | `src/sidebar.tsx:927`（`SessionRowView`），`:421`（`StatusDot`） | 会话行的运行中蓝点在此 |

**文件夹（project 行）与 worktree 行是同一个组件 `ContainerRowView`**，两者只在 `row.kind` 与 lead 图标上分叉（见下），这是本次改造最关键的落点事实。

### 2.2 现有哪些"状态点"，分别代表什么

- 会话行 `StatusDot`（`sidebar.tsx:421-430`）：`pending → 'warning'`（琥珀）、`running → 'ongoing'`（蓝）、`completed → 'done'`（绿）、否则 `idle`；落到宿主原语 `P.StateDot`（`:429`）。
  - 这里的 `running` **已含子代理聚合**：`row.running = 该会话自己的 running || subagentCount > 0`（`TreeModel` 注释 `:2216-2219`；`INTERFACES.md:424-429`）。
- 容器行**目前没有任何状态点/高亮**：`ContainerRowView`（`sidebar.tsx:776-878`）只渲染 `lead`（图标）、`chevron`、`label`、`sublabel`、`[主]` 胶囊（`:832-835`）、项目行的 `sessionCount` 数字（`:837-839`）、动作按钮、插入线。
- 「当前会话高亮」是**行背景 + 字重**（`rowStyle`，`sidebar.tsx:584-599`：`background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.12))`、`fontWeight: 600`），只作用于 session 行（`:972`）。
- 容器行图标来源（`sidebar.tsx:780-785`）：
  ```js
  const chevron = row.expanded ? icon('chevronDown') : icon('chevronRight')
  const lead = row.kind === 'history' ? icon('clock')
    : isGroup ? (row.expanded ? icon('folderOpen') : icon('folderClose'))
    : icon('branch')
  ```
  ⇒ **文件夹图标**（`folderOpen`/`folderClose`）用于 project 行，**`branch` 图标**用于 worktree 行。三者都在 `src/icons.ts:60-62` 的 `ICON_SPECS` 里，已带新旧命名候选与环境漂移兜底（`icons.ts:120-145`）。

### 2.3 样式机制：**全内联，零 CSS 类**

- `grep -c className src/sidebar.tsx` = **0**。全部视觉通过内联 `style` 对象表达（`rowStyle` / `iconButtonStyle` / `fieldStyle` / `dimText` / `pillStyle` / `dragLineStyle`，`sidebar.tsx:563-653`）。
- 颜色一律走宿主官方 CSS 变量（`HOST-CONTRACTS.md:1111` 明确"建议照搬这套变量名"）。仓库内已使用的变量：
  `--dsw-alias-label-primary` / `-secondary` / `-tertiary` / `-dimmed`、`--dsw-alias-border-l2`、`--dsw-alias-interactive-bg-hover`、`--dsw-alias-brand-primary`、`--dsw-alias-state-error-primary`、`--dsw-alias-state-warn-primary`、`--dsw-alias-bg-multi-select`。
- 图标 `icon()`（`sidebar.tsx:117-122`）支持透传 props 给宿主组件，**因此 `icon('branch', { style: { color: ... } })` 或 `{ color }` 在机制上可行**（宿主图标组件是否把 `color` 落到 `currentColor`：见 §6 未验证项 U4）。
- 没有主题类名/暗色分支逻辑 ⇒ 明暗兼容**只能**依赖变量是否随主题切换。

### 2.4 结论：是否有现成的"运行中/活动"状态可复用

| 层级 | 是否已有字段 | 位置 | 渲染层是否消费 |
|---|---|---|---|
| session 行 | `running`（**聚合口径**）、`subagentCount` | `INTERFACES.md:423-447`；`tree-model.ts:172-183` | ✅ 蓝点 |
| worktree 行 | `runningCount: number`、`pendingCount: number` | `INTERFACES.md:402-404`；`tree-model.ts:147-149`、`:2329-2331` | ❌ **零消费者** |
| project（文件夹）行 | `runningCount: number`、`pendingCount: number` | `INTERFACES.md:387-389`；`tree-model.ts:130-131`、`:2311-2313` | ❌ **零消费者** |
| history 行 | `runningCount` / `pendingCount` | `INTERFACES.md:412-414`；`tree-model.ts:2348-2350` | ❌ |
| 未分组行（project 形态） | `runningCount` | `tree-model.ts:2369` | ❌ |

**这是本次需求最重要的好消息**：聚合数据**已经在行上**，不需要新增宿主 API、不需要新增轮询。`grep runningCount src/sidebar.tsx` = **0 命中**，确认渲染层确实尚未消费。

无消费者是**用户此前的明确裁决**，且被测试钉死：

- `tree-model.ts:2220-2221`：「`runningCount` 的口径**不变**（仍只数 `session.running`）—— 渲染层无消费者，本次不动（用户裁决 Q1）」
- `INTERFACES.md:443-445`：⚠️「`worktree` / `project` 行的 `runningCount` **刻意不含**该聚合（用户裁决 Q1…）⇒ 在那些行上"有运行中的子代理"与 `runningCount` 之间**没有**该蕴含关系」
- `test/tree-model.test.mjs:1677-1693`：`需求 A: 容器/项目行的 runningCount 口径**不变**（用户裁决 Q1：渲染层无消费者）`，断言 `worktree.runningCount === 0`、`project.runningCount === 0`（仅子代理在跑时）。

⇒ **本需求第一次给 `runningCount` 带来消费者，等价于重新打开 Q1**。是否扩大口径是必须由用户拍板的第一决策（§6 Q1）。

## 3. 运行态数据事实

### 3.1 宿主给插件提供了什么（区分"文档声明"与"代码实证"）

| 数据面 | 内容 | 证据类型 | 依据 |
|---|---|---|---|
| HTTP `/tree` 响应 | 每个会话 `running / blank / updatedAt / parentSessionId / origin / cwd / title`，由 `SessionSummary` + `SessionHeader` join 而成 | **代码实证**（插件侧）+ 宿主文档 | `routes.ts:421-448`、`:293-372`；`HOST-CONTRACTS.md:200`、`:229-232`、`:1790` |
| 客户端 root hook `useSessionStatus` | `Map<SessionId, { running, pendingInteraction, completionUnread }>`（`publishStatus()`） | **文档声明**（`HOST-CONTRACTS.md:1820-1822`；`INTERFACES.md` §2.2.1 同款）；插件侧只消费后两字段 | `sidebar.tsx:1570`、`:1581`；`live-state.ts:173-187`（返回值**不含** `running`） |
| 客户端 `useSessions` | `current`、`byId`（宿主 `0.2.1-rc.2` 已删 `completed`） | 文档声明 | `HOST-CONTRACTS.md:1820-1822`；`live-state.ts:69-73` |
| 事件 / 订阅 | **未见任何 per-worktree 或 per-session 的推送事件**；插件只有 30s 轮询 + focus 强刷 + 快照防抖 | 代码实证（插件只用这三种） | `sidebar.tsx:1653-1669` |

> ⚠️ `useSessionStatus` 的 `running` **当前没有被本插件读取**（`liveStateOf` 只取 `pendingInteraction` 与 `completionUnread`，`live-state.ts:173-187`）。它是**唯一比 30s 轮询更快的 per-session 运行态**，但覆盖范围（是否包含未打开的会话/子代理）**未验证**（§6 U2）。

### 3.2 "任意 worktree 有正在运行的任务"怎么判定（代码实证）

- `emitContainer` 对**容器的可见顶层会话**计数（`tree-model.ts:1911-1917`）：
  ```ts
  return { rows, sessionCount: heads.length,
    runningCount: heads.filter((session) => session.running === true).length,
    pendingCount: heads.filter((session) => session.pendingInteraction !== undefined).length, hiddenCount }
  ```
- worktree 行直接取所属容器结果（`:2329-2331`）；project 行对 **worktree + flat + history 三桶求和**（`:2294-2313`）。
- 可见成员过滤（`tree-model.ts:1760-1766`）：`!subagent && !archived && (!blank || 是当前会话)`。

**因此现有判据是：`worktree.runningCount > 0`（仅主会话自身在跑）；`project.runningCount > 0`（worktree + 非 git 平铺 + history 三桶之和）。**

四个必须知道的边界（都由上面的代码决定，不是猜测）：

1. **子代理在跑不算**：子代理会话被 `!isSubagent` 过滤掉，父会话自身 `running === false` 时 `runningCount` 为 0 ⇒ 只有子代理在跑时 worktree 不会高亮，而**同一时刻父会话行的蓝点会亮**（`row.running` 含聚合，`:2216-2219`）。这是一处**必然出现的视觉矛盾**（§6 Q1）。
2. **非当前会话的 blank 不算**：`isVisibleMember` 要求非 blank 或是当前会话。运行中的 blank 会话是否存在**未验证**（§6 U3）。
3. **归档会话不算**：归档 id 在 `context.archived` 中被排除。
4. **折叠 / 被 "展开其余 N 个" 截断的会话仍然算**：`runningCount` 用截断**之前**的 `heads`（`:1875` 的 `truncated` 只影响 `selected`）；折叠容器也照样 `emitContainer` 并保留计数（`:2275-2278` 注释"折叠时仍要显示计数"，`:2335-2337`）。

### 3.3 不在当前视图 / 折叠时数据是否仍可得

| 情形 | 数据是否可得 | 依据 |
|---|---|---|
| worktree 行被折叠 | ✅ 是 | `emitContainer` 无条件执行（`tree-model.ts:2275-2278`、`:2335`） |
| worktree 在侧栏滚动可视区之外 | ✅ 是 | 行在 `rows` 数组里，只是视口外 |
| 容器内会话被截断为 `more` 行 | ✅ 是 | `runningCount` 用截断前的 `heads`（`:1913-1915` vs `:1875`） |
| 整个 project 行被折叠 | ✅ 是（project 行本身仍渲染，计数仍算） | `:2301-2316` |
| `wide === false`（36px 轨道态） | ❌ 无行可高亮 | `sidebar.tsx:2110-2134` 提前 return，只渲染一个按钮 |
| 搜索模式 | ❌ 无容器行 | `buildRows` 非空 query 直接走 `buildSearchRows`（`tree-model.ts:2261-2262`），只产 session 行 |

**结论**：只要走 HTTP `/tree` 这条链路，高亮所需的聚合数据在折叠/截断/视口外都仍然完整。这使「workspace 文件夹高亮」在数据上**零新增成本**。

### 3.4 刷新链路与时延

- 服务端每次请求都重新 `sessionController.list({})`（`routes.ts:295-314`）⇒ 单次请求的数据是当时的。
- 但**客户端只会在**：快照防抖（`:1653-1656`）、30s 定时（`:1661`）、窗口 focus（`:1662`）时重取。
- ⚠️ `useSessionStatus` 的变化**不**在防抖依赖里（依赖是 `[reload, sessionsSnapshot, currentSessionId]`，`:1656`）。所以任务是"开始跑"还是"刚跑完"，高亮**最多滞后约 30 秒**（若无 focus 事件）。这是本次需求最直观的用户体验风险（§6 Q4）。

## 4. 高亮可行方案与推荐

### 4.1 落点（文件 + 函数 + 行号）

| 改动点 | 文件 / 函数 | 行号 | 说明 |
|---|---|---|---|
| ① 聚合计语义 | `src/tree-model.ts` `emitContainer` | `1913-1915`（`runningCount` 计算）、`2372`（未分组）、`2311-2313`（project 求和） | 已在 `EmitContext.subagentRunningCounts`（`tree-model.ts:1148`、`:2257`）里持有运行中子代理索引，**改口径不需要新增数据** |
| ② 行类型（若加字段） | `src/tree-model.ts` `RenderRow` | `112-162` | 字段集合是冻结契约（`INTERFACES.md:372-460`），加字段=契约修订 |
| ③ 图标着色 | `src/sidebar.tsx` `ContainerRowView` | `776-798`（`lead` 计算与 `lead` 的 `<span>`） | 文件夹 / branch 图标二选一分支已在此 |
| ④ 附加视觉（点/条/徽标） | 同上，`children` 数组 | `788-848` | 插入位置明确；`pillStyle()`（`:643-653`）可直接复用 |
| ⑤ 可测试钩子 | 同上，行 `jsx('div', ...)` | `859-878` | 建议加 `data-running="true"`（见 §5） |
| ⑥ 无障碍文案 | `src/locales.ts` 词条表 | `18-63` | 新增 key 需同步 `INTERFACES.md` §2.1 冻结集 |
| ⑦ 契约与决策记录 | `docs/INTERFACES.md` §2.2、`docs/PRD.md` 决策表 | — | 若改口径或加字段必须记录（本任务写入范围外，需后续任务） |

**不需要改**：`src/routes.ts`（running 已在 HTTP 面）、`src/icons.ts`（三个图标已存在且带漂移兜底）、`src/client.tsx`、`cordis.patch.yml`。

### 4.2 方案 A：把 `runningCount` 改为"聚合"口径（含子代理）

- **做法**：`emitContainer` 里把 `session.running === true` 换成会话行的聚合判据（`该会话 running || subagentRunningCounts[id] > 0`），project/worktree 自动继承（求和逻辑 `:2311-2313` 无需动）。渲染层读 `row.runningCount > 0`。
- **优点**：① 零新增字段，`RenderRow` 形状不变；② 与会话行蓝点**同源同口径**，不会出现"子代理在跑、父行蓝点但文件夹不亮"；③ 改动最小（1 处表达式 + project 继承）。
- **缺点**：① 直接推翻用户裁决 Q1，必须重写 `tree-model.ts:2220-2221`、`INTERFACES.md:443-445`、`PRD.md` 决策表；② 必须改 `test/tree-model.test.mjs:1677-1693` 这条"钉死"测试 —— 属于**契约变更**，不能偷偷改；③ 若将来有人把 `runningCount` 当数字展示，"3" 的含义从"3 个主会话在跑"变成"3 个会话在跑（含子代理）"，需要额外解释。
- **工作量**：改 1 处表达式 + 3 处文档 + 1 条测试反转 + 新增测试。

### 4.3 方案 B：保留 `runningCount`，新增布尔聚合字段

- **做法**：`RenderRow` 的 project / worktree / history 三类行各加一个可选字段（例如 `active?: boolean`，语义="该容器内有正在运行的任务，含子代理"）。`runningCount` 语义**完全不动**，`:1677` 测试不受影响。
- **优点**：① 语义清晰（"数"与"是否活动"分离），不动既有契约语义；② 不触发 Q1 的推翻，只是"新增一个消费者专用字段"；③ 未来若要做数字徽标（方案 C 的视觉）仍有干净的 `runningCount`。
- **缺点**：① **仍然是冻结契约的改动**（`INTERFACES.md:372-460` 字段集合冻结），只是 additive；② 需要新增一处计算（与 `runningCount` 并行的 `heads.some(聚合判据)`），有"两个口径并存"的解释成本；③ `test/tree-model.test.mjs` 需要新增而非修改。

### 4.4 方案 C：渲染层自行聚合（不改 `tree-model`）—— **不推荐**

- **做法**：在 `sidebar.tsx` 的行循环里扫 `view.rows`，按 `parentKey` 累加 session 行的 `running`（聚合口径），得到每个 worktree / project 的活动态。
- **致命缺陷（代码实证）**：① 折叠容器**不产出 session 行**（`tree-model.ts:2335-2337`），扫不到任何子行 ⇒ 折叠的 worktree 永远不高亮；② 超过 5 条时被截断的会话没有行（`:1875-1889`），运行中的会话可能正好被截断 ⇒ 漏高亮；③ project 层聚合需要跨 worktree 汇总，但 history/flat 桶的 `parentKind` 不同，容易算错。
- 结论：只能作为**临时 demo**，不能作为交付方案。

### 4.5 视觉表达选项（与数据方案正交）

| 视觉 | 具体做法 | 优点 | 缺点 / 风险 |
|---|---|---|---|
| **V1 图标着色** | worktree 的 `branch` 图标 + project 的 `folderOpen/folderClose` 用 `--dsw-alias-brand-primary`（或 state 变量）着色；`icon(name, { style: { color } })` | 改动最小（仅 `lead` 一处）；不占布局；主题变量自带明暗 | 颜色是唯一信息载体 ⇒ 违反 WCAG 1.4.1「不能只靠颜色」；小尺寸图标颜色变化不易察觉 |
| **V2 图标着色 + 行内状态点** | 在 `label` 前加 `P.StateDot state='ongoing' size={6}`（`sidebar.tsx:429` 已有同款用法） | 与原生"运行中"视觉语言一致；非颜色信息载体（形状/动画）；折叠态也可见 | 多一个 DOM 节点；project 行已有 `sessionCount` 数字，视觉密度上升；`StateDot` 的 `ongoing` 是否自带动画/深色适配**未验证** |
| **V3 数字徽标** | project 行显示「N 运行中」，复用 `pillStyle()`（`:643-653`） | 信息量最大；与 `[主]`、子代理胶囊同族 | 最拥挤；project 行已有 `sessionCount`，两个数字易混淆；需要新词条与复数处理 |
| **V4 整行着色/左侧竖条** | 给行加 2px 左竖条（类似插入线 `dragLineStyle`，`:563-574`） | 远距离可辨；不影响图标语义 | 与拖拽插入线（2px、`brand-primary`）**视觉冲突**，用户可能误认为拖拽态 |
| **V5 图标描边/发光** | `filter: drop-shadow(...)` 或双层图标 | 醒目 | 全内联样式 + 主题变量下 `drop-shadow` 颜色难保证；性能与像素对齐风险；暗色主题对比度未知 |

**推荐：数据用方案 B（新增布尔聚合字段），视觉用 V1 + V2 的组合**，理由：
1. 数据侧不推翻用户既有裁决，测试是"新增"而不是"反转"，风险最低；
2. 视觉侧 V1 保证"图标高亮"的字面需求，V2 提供非颜色的冗余通道（可访问性 + 折叠态可辨），且复用宿主已有的 `StateDot`；
3. 不接受 V4（与拖拽插入线冲突）与 V5（主题/性能不可控）。

若用户更看重"最小 diff 且只要图标变色"，可退到「方案 A + 仅 V1」，代价是必须重写 Q1 相关文档与测试。

### 4.6 可访问性与明暗主题

- **不要在代码里硬编码颜色**：沿用 `var(--dsw-alias-*, fallback)` 双写模式（`sidebar.tsx:596`、`:614`、`:626` 既有写法）。
- 图标默认 `aria-hidden`（`StatusDot` 的注释 `:419` 明确"可访问性靠外层 `title`"）；因此新增的活动态必须有**文字通道**：给容器行加 `title`（现有 `label` 的 `title` 是路径/标签，`sidebar.tsx:801`）或新增 `aria-label`，并配 `locales.ts` 新 key。
- 明暗对比度：`--dsw-alias-brand-primary` 在暗色主题下对三级灰图标底色的对比度**未验证**（§6 U4），必须真机截图；若不足，回落到 `--dsw-alias-state-warn-primary` 或加 V2 状态点。

## 5. 测试边界

### 5.1 现有框架（可复用）

| 文件 | 手段 | 可复用于本需求 |
|---|---|---|
| `test/tree-model.test.mjs`（5776 行 / 250 条） | 纯函数 `buildRows` 断言；夹具助手 `session(id, overrides)`（`:50`）、`worktree(path, {...})`（`:62`）、`project(overrides)`（`:75`）、`input(overrides)`（`:88`）、`singleWorktreeProject(list)`（`:344`）、`subagent(id, parentId, overrides)`（`:1245`） | ✅ **主战场**：聚合口径与边界（折叠/截断/归档/blank/history）全部可纯逻辑覆盖 |
| `test/sidebar-wiring.test.mjs`（793 行 / 10 条） | **TypeScript 编译器 API 解析真实 `src/sidebar.tsx`** 做 AST 接线断言（文件头 `:1-60` 说明动机与变异矩阵） | ✅ `.tsx` 无法被 `node --test` 直接执行，**渲染接线只能这样测** |
| `test/icons.test.mjs`（211 行） | AST 断言：`src/sidebar.tsx` **禁止**出现 `P.Icon*` 属性访问；`ICON_SPECS` 候选表与真实宿主导出表比对 | ✅ 新增图标用法必须过这一关（本需求复用已有图标，风险低） |
| `test/render-smoke.test.mjs`（192 行） | 读宿主真实 primitives 导出表造桩，`react-dom/server` SSR 渲染整块侧栏（`:144-176`） | ⚠️ **不能验证高亮**：SSR 不执行 `useEffect`，`reload()` 永不运行 ⇒ `tree === null` ⇒ 只渲染 loading 文案（`sidebar.tsx:2414-2419` 分支），**不会产出任何 project/worktree 行** |
| `test/live-state.test.mjs`（181 行）、`test/git.test.mjs`、`test/routes.test.mjs`、`test/projects.test.mjs`、`test/ledger.test.mjs`、`test/locales.test.mjs` | 各自纯逻辑 | 本需求基本无关（`locales.test.mjs` 可用于新增词条） |

### 5.2 必须新增的用例（按行为）

**A. 纯逻辑（`test/tree-model.test.mjs` 风格）**

1. worktree 内**主会话**在跑 ⇒ 该 worktree 行的活动字段为 true，其它 worktree 为 false。
2. worktree 内**只有子代理在跑**（父会话 `running: false`）⇒ 活动字段为 true（若采纳含子代理口径）；同时断言父会话行 `running === true`（两处一致，防分叉）。
3. project 行：任一 worktree 有活动 ⇒ true；全部空闲 ⇒ false。
4. **折叠**该 worktree（`collapsedKeys['w:/repo'] = true`）⇒ 活动字段**仍为 true**（证明数据不依赖渲染）。
5. 容器内 > `COLLAPSED_SESSION_LIMIT`(5) 条会话、运行中的那条第 7 ⇒ 活动字段仍为 true（防截断漏判）。
6. 归档会话 / 非当前 blank 会话在跑 ⇒ **不计入**（把现有 `isVisibleMember` 语义钉死，或按用户新裁决反转 —— 需明确）。
7. history 桶有会话在跑 ⇒ project 行是否算活动（取决于 §6 Q3；写测试前必须先裁决）。
8. 未分组行（`p_key = p:__ungrouped__`）同 project 形态 ⇒ 活动字段正确。
9. 搜索模式（`query` 非空）不产容器行 ⇒ 断言没有意外崩溃/字段（若决定搜索态不高亮，写明"不适用"）。
10. **方案 A 专属**：把 `test/tree-model.test.mjs:1677-1693` 的断言**反转**（这条是契约变更，必须在报告/PRD 里显式记录，不能悄悄改）。

**B. 渲染接线（`test/sidebar-wiring.test.mjs` 风格，AST）**

11. `ContainerRowView` 的 `lead` 计算里，**文件夹分支**（project）与 **branch 分支**（worktree）**都**引用了活动判据（防止只改一半）。
12. 活动判据**从 `./tree-model.js` 的字段**来（防止 `sidebar.tsx` 里再写一份"本地聚合"导致分叉，参照 `isTopZoneRunningSession` 的同源约束，`test/sidebar-wiring.test.mjs:1-60`）。
13. 行 DOM 上出现 `data-running`（或等价可断言属性），且其值由活动判据驱动 —— 这是**唯一能在无浏览器环境下确认"视觉真的接上了"的手段**。
14. 变异验证（仓库既有实践，见 `test/mutation-t11.md` §1）：把 `data-running` 写死 `true` / 删掉着色分支 / 判据换成 `row.runningCount > 0` —— 每个变异都必须让至少 1 条测试变红，并记录 fail 数。

### 5.3 只能手工 / 截图验证的部分

- 明暗主题下**真实颜色与对比度**（`--dsw-alias-brand-primary` 是否够亮/够暗）。
- `StateDot state='ongoing'` 在 6px 尺寸下的实际观感与动画。
- 高亮与 **hover 背景**、**当前会话高亮**、**拖拽插入线**叠加时的视觉层次。
- 30s 轮询造成的"开跑后多久才亮 / 结束后多久才灭"的实际手感。
- 折叠态、`wide: false` 轨道态、搜索态下的最终观感。
- 宿主图标组件是否把 `color/style` 透传到 SVG（§6 U4）。

## 6. 风险、未知与需要拍板的问题

### 6.1 风险（有代码依据）

| # | 风险 | 依据 | 建议处理 |
|---|---|---|---|
| R1 | **口径分叉导致视觉矛盾**：子代理在跑时父会话行蓝点会亮，但 worktree/文件夹不亮 | `tree-model.ts:2216-2219`（会话行聚合）vs `:1914`（容器行不聚合）、`:2220-2221` | 必须选 Q1 的 A；否则要在 PRD 里明确"蓝点与高亮语义不同" |
| R2 | **高亮滞后最多 ~30s** | `sidebar.tsx:196`、`:1661`；`useSessionStatus` 不在防抖依赖 `:1656` | Q4：接受 / 或把 `sessionStatus` 纳入防抖重取（每状态变化触发一次 HTTP，需评估频率） |
| R3 | **改契约必须同步改被钉死的测试与文档** | `test/tree-model.test.mjs:1677-1693`、`INTERFACES.md:443-445`、`tree-model.ts:2220-2221`、`PRD.md` 决策表 | 走 Doc-first：先改 PRD/INTERFACES，再改测试（红），再实现 |
| R4 | **`runningCount` 语义被复用为"数字"时的歧义**（方案 A） | `INTERFACES.md:387-414` | 优先方案 B（新增布尔字段） |
| R5 | **blank / 归档运行中会话被漏计** | `isVisibleMember`，`tree-model.ts:1760-1766` | Q3 一并裁决；未验证运行中 blank 是否存在（U3） |
| R6 | **搜索态无容器行 ⇒ 无高亮** | `tree-model.ts:2261-2262` | 接受（写明"不适用"）或后续单独需求 |
| R7 | **新增 `P.*` 图标名有崩溃风险** | `HOST-CONTRACTS.md` 硬约束 25；`icons.test.mjs` | 复用已有 `folderOpen/folderClose/branch`，**不新增**宿主图标名 |
| R8 | **新增词条未进冻结集 ⇒ 界面露裸 key** | `locales.ts:1-13`、`HOST-CONTRACTS.md` 硬约束 24 | 新 key 先改 `INTERFACES.md` §2.1，再改 `locales.ts`；或**不加新文案**（用现有 `a11y.*` 风格） |
| R9 | **全内联样式无类名 ⇒ 无法用 CSS 覆盖/主题选择器** | `grep className` = 0 | 继续内联 + CSS 变量；不要为此引入 `<style>` 注入（`sidebar.tsx:580` 注释明确"不注入全局 `<style>`"） |
| R10 | **轨道态（`wide:false`）无行** | `sidebar.tsx:2110-2134` | 明确非目标，无需处理 |

### 6.2 未验证 / 未知（如实标注）

| # | 未知项 | 为什么没验证 |
|---|---|---|
| U1 | `useSessionStatus` 的 `running` 是否覆盖**未打开 / 未订阅**的会话与子代理 | 需读宿主 `dsh-client-ui-session/lib/client.js` 的 `publishStatus()` 实现；本任务允许读取范围限于本仓库，仓库文档（`HOST-CONTRACTS.md:1820-1822`）只声明了 Map 形状，未声明覆盖范围 |
| U2 | `SessionSummary.running` 在宿主侧是**实时**还是缓存 | `routes.ts:16` 注释称"实时状态"来自 `sessionController.list()`；未在宿主侧核实刷新频率 |
| U3 | 是否存在"运行中的 blank 会话"（会影响 `isVisibleMember` 漏判） | 需真实数据观察；纯代码无法证明 |
| U4 | 宿主图标组件是否把 `style.color` / `color` 透传到 SVG | 需读宿主 primitives 实现或真机试验；`icon()` 只保证 props 被传递（`sidebar.tsx:117-122`） |
| U5 | `--dsw-alias-brand-primary` 在暗色主题下的对比度；`StateDot` 是否有 `ongoing` 动画 | 需真机 / 截图；仓库内只有变量名引用（`HOST-CONTRACTS.md:1111`） |
| U6 | 30s 轮询在真实使用中的实际滞后感受 | 需真机观察 |
| U7 | 本次未运行 `npm test`（会写 `lib/` 构建产物） | 仅运行 `typecheck`（`--noEmit`）与对**现有** `lib/` 的定向测试，见 §7 |

### 6.3 必须由用户拍板的问题（简洁选项）

**Q1（最关键）聚合口径：worktree "有正在运行的任务"是否包含"只有子代理在跑"？**
- A. **包含**（与父会话行蓝点同源，消除 R1 矛盾）—— *推荐*
- B. 只算主会话自己的 `running`（保持用户裁决 Q1 现状，接受"蓝点亮但文件夹不亮"）

**Q2 视觉表达：**
- A. 仅图标/文件夹着色（最小改动）—— *当前推荐组合的一半*
- B. **着色 + 行内小状态点**（`StateDot ongoing`）—— *推荐*（可访问性更好）
- C. 着色 + 「N 运行中」数字胶囊
- D. 整行着色 / 左侧竖条（**不推荐**：与拖拽插入线冲突）

**Q3 文件夹聚合范围（project 行"任意 worktree 有运行任务"）：**
- A. 只算 worktree 子行 —— *推荐*（贴合需求原文）
- B. worktree + history 桶
- C. worktree + history + 未分组（即 `runningCount` 现状语义）
- **⚠️ 已被 T-8 / RT7 覆盖（T-11 标注）**：用户 2026-10-20 追加拍板「所有 workspace 都统计普通/flat 会话」⇒
  现行口径是 **A + 本 workspace 的 flat/普通会话**（history 与未分组仍排除）。本节保留当时判断，不代表现行契约。

**Q4 刷新时延：**
- A. 接受最多 ~30s 滞后（零改动）—— *推荐（先做，后续再优化）*
- B. 把 `useSessionStatus` 纳入重取触发（更快，但每次状态变化触发一次 HTTP）

**Q5 空白/归档运行中会话是否计入**（依赖 U3）：
- A. 与现有可见性一致，不计入 —— *推荐（零额外风险）*
- B. 单独纳入（需放宽 `isVisibleMember`，会连带影响树与搜索）

## 7. 证据：实际执行的命令与输出

| # | 命令 | 退出码 | 关键输出摘要 |
|---|---|---|---|
| 1 | `pwd && git status --porcelain=v1 && git branch --show-current && git log --oneline -5` | 0 | 见 §1；HEAD `5d2fe51`，14 项未提交改动 |
| 2 | `wc -l AGENTS.md docs/*.md src/* test/*` | 0 | sidebar.tsx 2870 行、tree-model.ts 2379 行、INTERFACES.md 1362 行、HOST-CONTRACTS.md 1839 行 |
| 3 | `grep -n "running\|Running\|isRunning\|active" src/sidebar.tsx` | 0 | `StatusDot` `:421`；`row.running` `:937/2175`；**无 `runningCount` 命中** |
| 4 | `grep -n "runningCount\|pendingCount\|sessionCount" src/tree-model.ts` | 0 | `:1913-1915`（计算）、`:2311-2313`（project 求和）、`:2329-2331`、`:2372` |
| 5 | `grep -c className src/sidebar.tsx` | 0 | **0** |
| 6 | `grep -o "var(--dsw-alias-[a-z0-9-]*" src/*.tsx src/*.ts \| sort \| uniq -c` | 0 | 12 个变量名（§2.3 列出） |
| 7 | `npm run typecheck` | **0** | `tsc -p tsconfig.json --noEmit` 无错误 |
| 8 | `node --test test/tree-model.test.mjs test/live-state.test.mjs` | **0** | `tests 260 / pass 260 / fail 0`（对**现有** `lib/` 构建产物运行，未重新构建） |
| 9 | `grep -n "runningCount" test/*.mjs` | 0 | `test/tree-model.test.mjs:1677,1691,1692,1913,1933`（含"口径不变"钉死断言） |
| 10 | `grep -n "useSessionStatus\|publishStatus" docs/HOST-CONTRACTS.md` | 0 | `:1820-1822`（文档声明的 Map 形状） |
| 11 | `cat .gitignore` | 0 | `node_modules/`、`lib/`（因此未运行 `npm test`，避免改动构建产物） |

**测试基线说明**：全量套件历史基线为 393 条（`PRD.md:586`）；本次只定向运行了两个与主题相关的套件（260 条），**未运行全量**、**未运行 `npm run build`**（会写 `lib/`）。交付前应补跑全量。

---

## 附：一页速览（给实现任务）

1. **数据已就绪**：`RenderRow.runningCount` 在 project / worktree / history 行上已有值，且在折叠/截断/视口外都完整（`tree-model.ts:1913-1915`、`:2311-2313`）。渲染层零消费（`grep` 0 命中）。
2. **唯一语义缺口**：该值**不含子代理**，而会话行蓝点**含**（`tree-model.ts:2220-2221`）⇒ 必须先拍板 Q1。
3. **落点**：`ContainerRowView`（`sidebar.tsx:776`）的 `lead` 图标（`:780-785`）是"文件夹/分支图标高亮"的**唯一**位置；附加视觉插在 `children`（`:788-848`）。
4. **测试**：纯逻辑进 `test/tree-model.test.mjs`（夹具 `session/worktree/project/input/singleWorktreeProject` 已具备）；`.tsx` 接线只能走 `test/sidebar-wiring.test.mjs` 的 AST 断言；`render-smoke` **无法**覆盖（SSR 不跑 effect ⇒ 无行）。
5. **别碰**：`src/routes.ts`、`src/icons.ts`、`cordis.patch.yml`；别新增 `P.Icon*` 名；别为此注入 `<style>`。
6. **文档义务**：改口径/加字段必须同步 `INTERFACES.md` §2.2（字段集合冻结）、`PRD.md` 决策表，并反转 `test/tree-model.test.mjs:1677-1693`；新增文案要先扩 `INTERFACES.md` §2.1 冻结集。
