---
生成时间: 2026-09-22
更新时间: 2026-09-22
git-version: 9bd94252dd934c2fa8491977285e461b703f0f3e
git-module-path: src
level: L2
---

# TreeModel 模块技术文档

> 模块路径：`src/tree-model.ts`
> 本文档为模块的组件目录和流程摘要，详细实现见各组件的 L3 文档。

---

## 目录

- [模块概览](#模块概览)
- [架构设计](#架构设计)
- [组件索引](#组件索引)
- [关键流程摘要](#关键流程摘要)
- [依赖关系](#依赖关系)
- [平台适配](#平台适配)
- [相关文档](#相关文档)

---

## 模块概览

**模块名称**: `tree-model`（侧栏树推导纯逻辑模块；单文件形态 `src/tree-model.ts`）

**平台支持**: Web（DSH 客户端侧栏渲染进程）/ Node（测试进程，`node --test` 直接加载编译产物）。
移动端（Android / iOS）**N/A** —— 本插件在 `package.json` 的 `dsh.client.platform` 中声明为
`web`，无任何移动端目标；详见「平台适配」。

**代码统计**（统计基准：`git-version` 锚定的 `src/` 目录）：

| 项 | 数值 | 依据 |
|---|---|---|
| 源文件数 | 1 个 TypeScript 文件 | `ls src/tree-model.ts` |
| 代码行数 | 2379 行 | `wc -l src/tree-model.ts` |
| 导出符号总数 | 35 个（20 个函数 + 2 个常量 + 13 个类型） | `grep -c "^export " src/tree-model.ts` ⇒ 35 |
| 模块内 `import` | 0 处（`import` 仅出现在文件头注释中） | `grep -n "import" src/tree-model.ts` 无运行时代码命中 |
| 直接测试文件 | 2 个（`test/tree-model.test.mjs` 250 条用例、`test/sidebar-wiring.test.mjs` 13 条用例） | `grep -c "test(" test/*.mjs` |

### 模块职责

`tree-model` 模块负责：

1. **渲染行推导（唯一入口）**：把宿主「项目 / worktree / 会话」原始数据摊平成侧栏可渲染的行序列
   （项目行、worktree 行、history 行、会话行、更多行），并保证同样输入永远推出同样行序列。
   模块只做推导、不画 DOM；渲染层不参与任何推导。
2. **容器内运行时顶部区**：把「正在运行」的会话（含任意层级有运行中子代理的会话）固定在所属容器最前、
   位于 5 条截断之前，且标记为不可拖动；顶部区是**纯运行时**推导，刷新即重置，绝不写入持久化存储
   （唯一写入例外是新会话落表，见职责 5）。
3. **三层手动排序（项目 / worktree / 会话）**：以持久化的手动顺序叠加在默认顺序之上，
   提供拖拽落点换算与三层完整生效顺序的查询；手动排序开关未开启时完全不生效（零回归）。
4. **可见性与折叠语义**：以单一可见性谓词统一「树 / 搜索 / 容器存在性」三处判据；
   实现容器内 5 条截断与「更多」行、blank 会话特例、归档会话剔除、未分组容器合成。
5. **子代理聚合**：子代理会话不产生会话行，只以父行计数胶囊体现；计数口径为
   「运行中的子代理后代数（所有层级）」，并提供会话折叠所需的一层嵌套视图。
6. **新会话落表编排（D2）与运行时状态推进**：维护顶部区运行时状态、从树数据生成观测批次、
   编排「新会话插入容器固化表最前」的写入意图，并以独立台账避免重复写入。
7. **搜索模式扁平化**：查询非空时改为跨容器扁平输出候选会话，刻意不应用手动顺序与运行时顶部区。

---

## 架构设计

下图只到「层职责与调用关系」的粒度；只列**导出**符号与文件名，模块私有内部函数不在图中展开（详见 L3 文档）。
所有函数与类型均位于 `src/tree-model.ts`。

```text
┌──────────────────────────────────────────────────────────────────────┐
│ ① 入参装配层（由唯一消费者 src/sidebar.tsx 组装）                      │
│    SidebarModelInput  ← 类型层：SessionRowLike / WorktreeNodeLike /    │
│                          ProjectNodeLike / ManualOrder / TopZoneInput │
│    RenderRow（冻结的渲染行联合类型）                                    │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
┌───────────────────────────────▼──────────────────────────────────────┐
│ ② 行推导层（主入口：分组树行构建 / 跨容器扁平搜索两条分支）          │
│    buildRows                                                         │
│    导出：applyManualOrder · topZoneSessionKeys · truncateSessions    │
│      ├─ 默认分支：项目 → worktree / history / flat / 未分组 → 会话行 │
│      │    经手动顺序重排、容器内置顶与 5 条截断后产出渲染行          │
│      └─ 搜索分支：查询非空时跨容器扁平输出候选会话                   │
│           刻意不应用手动顺序与运行时顶部区                           │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
┌───────────────────────────────▼──────────────────────────────────────┐
│ ③ 顺序与落位层                                                         │
│    applyManualOrder · effectiveOrder · reorderKeys                    │
│    placementOfSession · insertSessionAtFront · containerKeyOfSession  │
│    EffectiveOrder（三层完整生效顺序的类型）                             │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
┌───────────────────────────────▼──────────────────────────────────────┐
│ ④ 运行时顶部区层（状态机由 observeTopZone 推进；本层不写持久化）     │
│    initialTopZoneState · observeTopZone · observationsOf             │
│    topZoneInputOf · topZoneSessionKeys · isTopZoneRunningSession     │
│    类型：TopZoneState / TopZoneObservation /                         │
│          TopZoneObservationSource                                    │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
┌───────────────────────────────▼──────────────────────────────────────┐
│ ⑤ 子代理与 D2 落表层                                                 │
│    nestSubagents · indexRunningSubagentDescendants                   │
│    planNewSessionInserts · markNewSessionsWritten                    │
│    pendingNewSessionIdsOf · NewSessionInsertPlan /                   │
│    SubagentRunningCounts（类型）                                     │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 组件索引

下表覆盖模块的全部 35 个导出符号。所有行均为 `src/tree-model.ts` 内的组件，
详细实现统一见 [TreeModel 技术文档](../l3-components/TreeModel技术文档.md)。

### 入口与常量

| 组件/函数 | 文件路径 | 一句话职责 | L3 文档链接 |
|---|---|---|---|
| `buildRows` | `src/tree-model.ts` | 模块唯一主入口：由入参推导完整渲染行序列（含搜索分支） | [TreeModel 技术文档](../l3-components/TreeModel技术文档.md) |
| `COLLAPSED_SESSION_LIMIT` | `src/tree-model.ts` | 容器折叠时可见的非 blank 会话条数上限 | [TreeModel 技术文档](../l3-components/TreeModel技术文档.md) |
| `UNGROUPED_KEY` | `src/tree-model.ts` | 「未分组」容器的合成项目键 | [TreeModel 技术文档](../l3-components/TreeModel技术文档.md) |

### 顺序、置顶与落位

| 组件/函数 | 文件路径 | 一句话职责 | L3 文档链接 |
|---|---|---|---|
| `applyManualOrder` | `src/tree-model.ts` | 按手动顺序（可含置顶项）稳定重排任意列表 | [TreeModel 技术文档](../l3-components/TreeModel技术文档.md) |
| `effectiveOrder` | `src/tree-model.ts` | 取三层（项目/worktree/会话）完整生效顺序，供拖拽与落表作基底 | [TreeModel 技术文档](../l3-components/TreeModel技术文档.md) |
| `reorderKeys` | `src/tree-model.ts` | 把「被拖项 + 落点」换算成新的顺序列表 | [TreeModel 技术文档](../l3-components/TreeModel技术文档.md) |
| `placementOfSession` | `src/tree-model.ts` | 查某会话当前落在哪个容器 | [TreeModel 技术文档](../l3-components/TreeModel技术文档.md) |
| `containerKeyOfSession` | `src/tree-model.ts` | 会话 → 容器键的便捷包装（当前无生产调用点） | [TreeModel 技术文档](../l3-components/TreeModel技术文档.md) |
| `insertSessionAtFront` | `src/tree-model.ts` | 把会话插到指定容器固化表最前（幂等） | [TreeModel 技术文档](../l3-components/TreeModel技术文档.md) |
| `workspaceIdFromProjectKey` | `src/tree-model.ts` | 由项目键反解工作区 id | [TreeModel 技术文档](../l3-components/TreeModel技术文档.md) |

### 运行时顶部区

| 组件/函数 | 文件路径 | 一句话职责 | L3 文档链接 |
|---|---|---|---|
| `initialTopZoneState` | `src/tree-model.ts` | 顶部区运行时状态的初值 | [TreeModel 技术文档](../l3-components/TreeModel技术文档.md) |
| `observeTopZone` | `src/tree-model.ts` | 用一批观测推进顶部区运行时状态 | [TreeModel 技术文档](../l3-components/TreeModel技术文档.md) |
| `observationsOf` | `src/tree-model.ts` | 把树数据投影成观测批次（含归档会话补投影） | [TreeModel 技术文档](../l3-components/TreeModel技术文档.md) |
| `topZoneInputOf` | `src/tree-model.ts` | 把运行时状态投影成渲染期顶部区输入 | [TreeModel 技术文档](../l3-components/TreeModel技术文档.md) |
| `topZoneSessionKeys` | `src/tree-model.ts` | 算出某容器内应置顶的会话键集合 | [TreeModel 技术文档](../l3-components/TreeModel技术文档.md) |
| `isTopZoneRunningSession` | `src/tree-model.ts` | 「运行中、不可拖动」的唯一判据 | [TreeModel 技术文档](../l3-components/TreeModel技术文档.md) |

### 子代理与 D2 落表

| 组件/函数 | 文件路径 | 一句话职责 | L3 文档链接 |
|---|---|---|---|
| `indexRunningSubagentDescendants` | `src/tree-model.ts` | 建立「会话 → 运行中子代理后代数」索引 | [TreeModel 技术文档](../l3-components/TreeModel技术文档.md) |
| `nestSubagents` | `src/tree-model.ts` | 把同容器会话展平为带深度的序列（只展开一层） | [TreeModel 技术文档](../l3-components/TreeModel技术文档.md) |
| `truncateSessions` | `src/tree-model.ts` | 容器内会话截断，并给出被隐藏条数 | [TreeModel 技术文档](../l3-components/TreeModel技术文档.md) |
| `planNewSessionInserts` | `src/tree-model.ts` | 编排新会话落表的写入意图与消费清单 | [TreeModel 技术文档](../l3-components/TreeModel技术文档.md) |
| `markNewSessionsWritten` | `src/tree-model.ts` | 把已落表的新会话记入台账 | [TreeModel 技术文档](../l3-components/TreeModel技术文档.md) |
| `pendingNewSessionIdsOf` | `src/tree-model.ts` | 查询尚未落表的新会话 | [TreeModel 技术文档](../l3-components/TreeModel技术文档.md) |

### 类型与契约

| 组件/函数 | 文件路径 | 一句话职责 | L3 文档链接 |
|---|---|---|---|
| `RenderRow` | `src/tree-model.ts` | 冻结的渲染行联合类型（渲染层唯一消费形态） | [TreeModel 技术文档](../l3-components/TreeModel技术文档.md) |
| `SidebarModelInput` | `src/tree-model.ts` | 行推导的统一入参类型 | [TreeModel 技术文档](../l3-components/TreeModel技术文档.md) |
| `SessionRowLike` | `src/tree-model.ts` | 与宿主会话行结构兼容的本地声明 | [TreeModel 技术文档](../l3-components/TreeModel技术文档.md) |
| `WorktreeNodeLike` | `src/tree-model.ts` | 与宿主 worktree 节点结构兼容的本地声明 | [TreeModel 技术文档](../l3-components/TreeModel技术文档.md) |
| `ProjectNodeLike` | `src/tree-model.ts` | 与宿主项目节点结构兼容的本地声明 | [TreeModel 技术文档](../l3-components/TreeModel技术文档.md) |
| `ManualOrder` | `src/tree-model.ts` | 三层手动排序的持久化载体类型 | [TreeModel 技术文档](../l3-components/TreeModel技术文档.md) |
| `EffectiveOrder` | `src/tree-model.ts` | 三层完整生效顺序的类型 | [TreeModel 技术文档](../l3-components/TreeModel技术文档.md) |
| `TopZoneInput` | `src/tree-model.ts` | 渲染期顶部区输入类型 | [TreeModel 技术文档](../l3-components/TreeModel技术文档.md) |
| `TopZoneState` | `src/tree-model.ts` | 顶部区运行时状态类型 | [TreeModel 技术文档](../l3-components/TreeModel技术文档.md) |
| `TopZoneObservation` | `src/tree-model.ts` | 单条观测的类型 | [TreeModel 技术文档](../l3-components/TreeModel技术文档.md) |
| `TopZoneObservationSource` | `src/tree-model.ts` | 观测批次的数据源类型 | [TreeModel 技术文档](../l3-components/TreeModel技术文档.md) |
| `NewSessionInsertPlan` | `src/tree-model.ts` | 新会话落表编排的产物类型 | [TreeModel 技术文档](../l3-components/TreeModel技术文档.md) |
| `SubagentRunningCounts` | `src/tree-model.ts` | 运行中子代理后代数索引的类型 | [TreeModel 技术文档](../l3-components/TreeModel技术文档.md) |

### 协作组件（本模块边界外，仅供索引）

| 组件/函数 | 文件路径 | 一句话职责 | L3 文档链接 |
|---|---|---|---|
| `SidebarBrowser` | `src/sidebar.tsx` | 本模块唯一生产消费者：装配入参、调用各纯函数、把行画成 DOM | [SidebarBrowser 技术文档](../l3-components/Sidebar技术文档.md) |
| 宿主半边共享类型 | `src/types.ts` | 宿主侧数据结构真源，本模块以结构兼容方式消费 | [Types 技术文档](../l3-components/Types技术文档.md) |

---

## 关键流程摘要

### 流程 1 — 分组树行构建

> 由统一入参推出「项目 → worktree / history / flat / 未分组 → 会话」的完整行序列，
> 查询非空时改走跨容器扁平搜索分支。

**主要参与组件链**: `buildRows` → `applyManualOrder` → `containersOfProject` → `emitContainer`
→（`visibleMembers` / `isVisibleMember` / `applyManualOrder` / `topZoneSessionKeys` /
`truncateSessions` / `toSessionRow`）；搜索分支为 `buildRows` → `buildSearchRows` →
`collectSearchCandidates` → `isVisibleMember`。

详细实现见：[TreeModel 技术文档](../l3-components/TreeModel技术文档.md)

### 流程 2 — 顶部区运行态聚合与排序

> 把「正在运行」的会话（含子代理聚合口径）与尚未落表的新会话固定在所属容器最前，
> 该置顶是纯运行时推导，刷新即重置且不进入持久化顺序。

**主要参与组件链**: `allSessionsOf` → `indexRunningSubagentDescendants` → `observationsOf`
→ `observeTopZone` → `topZoneInputOf` →（`buildRows` 消费）`topZoneSessionKeys` →
`isTopZoneRunningSession` → `sortTopZone`；渲染层的拖动禁用判据复用 `isTopZoneRunningSession`。

详细实现见：[TreeModel 技术文档](../l3-components/TreeModel技术文档.md)

### 流程 3 — 手动排序与拖拽落位

> 三层（项目 / worktree / 会话）拖拽结果换算为新顺序并固化；未开启手动模式时该链路整体不生效。

**主要参与组件链**: `reorderKeys` →（渲染层写回持久化）→ 下次推导时 `applyManualOrder`
叠加在默认顺序之上；固化表基底取自 `effectiveOrder`，会话归属由 `placementOfSession` /
`containerKeyOfSession` 判定，新会话插入由 `insertSessionAtFront` 完成。

详细实现见：[TreeModel 技术文档](../l3-components/TreeModel技术文档.md)

### 流程 4 — 会话截断与子代理嵌套

> 容器内按 5 条上限截断并产出「更多」行，blank 会话不占名额；子代理不产生会话行，
> 只以父行计数胶囊体现。

**主要参与组件链**: `visibleMembers` → `applyManualOrder` → `truncateSessions` →
`toSessionRow`（父行计数来自 `subagentCountOf`）；折叠视图由 `nestSubagents` 提供，
深层后代计数由 `discoverChildEdges` → `indexRunningSubagentDescendants` 完成。

详细实现见：[TreeModel 技术文档](../l3-components/TreeModel技术文档.md)

### 流程 5 — 新会话落表编排（D2，唯一持久化写入例外）

> 检出本进程内新出现的会话后，把它插入所属容器的固化表最前，并以独立台账避免重复写入。

**主要参与组件链**: `observeTopZone` → `pendingNewSessionIdsOf` → `effectiveOrder`（作基底）
→ `planNewSessionInserts` → `insertSessionAtFront` → `markNewSessionsWritten`
（实际写持久化由渲染层执行）。

详细实现见：[TreeModel 技术文档](../l3-components/TreeModel技术文档.md)

---

## 依赖关系

**依赖的模块**：

- **无**。`src/tree-model.ts` 不含任何 `import` 语句，模块内无跨文件依赖。
  它对宿主数据结构的消费方式是**结构兼容**：自行声明 `SessionRowLike` /
  `WorktreeNodeLike` / `ProjectNodeLike` 三个本地接口，不 import 宿主半边类型文件
  （契约见 [Types 技术文档](../l3-components/Types技术文档.md) 与
  [接口契约](../../INTERFACES.md) §2.5「宿主包依赖规则」）。

**被依赖方**（known consumers）：

- `src/sidebar.tsx` —— **唯一生产消费者**：装配 `SidebarModelInput`、调用 `buildRows` /
  `effectiveOrder` / 顶部区系列函数 / `reorderKeys`，并把 `RenderRow` 画成 DOM。
  详见 [SidebarBrowser 技术文档](../l3-components/Sidebar技术文档.md)。
- `test/tree-model.test.mjs` —— 直接对编译产物做行为覆盖（250 条用例）。
- `test/sidebar-wiring.test.mjs` —— 源码级契约测试：锁定导出名在 `src/` 内只有一份声明
  及 `.tsx` 的接线方式（13 条用例）。
- `src/routes.ts` / `src/projects.ts` —— **仅注释提及**（说明排序与顺序约定的一致性），
  **无代码依赖**。

**关键外部库**：

- **无运行时第三方依赖**。`package.json` 的 `dependencies` 为空；本模块不使用
  `react`、`@deepseek-ai/*` 或任何 Node 专有 API。
- 测试期使用 Node 内置 test runner（`node --test`），属开发工具链而非模块依赖。
- 契约依据文档：[接口契约](../../INTERFACES.md) §2.2 / §2.3 / §2.6，
  [产品需求](../../PRD.md)（D2 / D10 / D11 / D13 / 需求 A 等）。

---

## 平台适配

本模块是**平台无关的纯逻辑单元**：无 IO、无 DOM、无 React、无 Node 专有 API、无模块级可变状态，
因此 Web 渲染进程与 Node 测试进程共用同一份实现，行为一致。

| 功能 | Web（浏览器渲染进程） | Node（`node --test`） | Android | iOS |
|---|---|---|---|---|
| 行推导 / 排序 / 顶部区 | 由 `src/sidebar.tsx` 在渲染进程调用 | 由 `test/tree-model.test.mjs` 直接调用编译产物 | N/A | N/A |
| 持久化读写 | 不适用：本模块零 IO，`localStorage` 读写由渲染层执行 | N/A（测试内联构造入参） | N/A | N/A |
| 移动端适配 | — | — | N/A：`package.json` 声明 `dsh.client.platform = web`，无移动端目标 | 同左 |

**移动端 N/A 的原因**：本仓库是 DeepSeek Harness 的 Web 客户端插件（侧栏槽位 `sidebar.workspaces`），
`package.json` 中 `dsh.client.platform` 为 `web`，不存在 Android / iOS 构建目标或平台分支代码。

**唯一的跨平台处理**：路径分隔符。目录名提取同时接受 `/` 与 `\` 并忽略尾分隔符，
使同一份逻辑在 Windows 路径下也不产生错误标签（纯字符串处理，无平台 API 调用）。

---

## 相关文档

- [TreeModel 技术文档](../l3-components/TreeModel技术文档.md) —— 本模块唯一组件的完整实现细节（L3）。
- [SidebarBrowser 技术文档](../l3-components/Sidebar技术文档.md) —— 唯一生产消费者的实现细节（L3）。
- [Types 技术文档](../l3-components/Types技术文档.md) —— 宿主半边共享数据结构（L3）。
- [接口契约](../../INTERFACES.md) §2.2 / §2.3 / §2.6 —— 本模块的导出契约与冻结裁定。
- [产品需求](../../PRD.md) —— D2 / D10 / D11 / D13 与需求 A 的需求来源。
- [宿主契约](../../HOST-CONTRACTS.md) —— 宿主 `SessionRow` / `WorktreeNode` / `ProjectNode` 事实核实。

- [worktree-groups 知识库（L1 架构）](../l1-architecture/worktree-groups-knowledge-base.md) —— 本模块所在的域架构总览。
- [知识库总索引](../README.md) —— 全部 L1/L2/L3 文档的分层索引与检索入口。
