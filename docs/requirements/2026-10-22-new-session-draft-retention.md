# 需求：同位置「新建会话」必须保留未发送草稿

- **日期**：2026-10-22
- **状态**：已确认（用户经 AskHuman 选定「复用同位置已有空白会话」口径；2026-10-22 追加 DR4/DR5 —— 复验发现「新会话」掉到列表最下面）
- **相关文档**：
  - [设计](../design/2026-10-22-new-session-draft-retention.md)
  - [工作记录](../worklog/2026-10-22-new-session-draft-retention.md)
  - [PRD §15](../PRD.md)
  - [接口契约 §2.3 / §2.4](../INTERFACES.md)
  - [宿主契约 §B1.2](../HOST-CONTRACTS.md)
  - [领域术语表（CONTEXT.md）](../../CONTEXT.md)

## 1. 背景与问题

用户报告：

> 在新建一个会话后，输入了一部分内容，此时我切换到其他会话，再点击新建会话，没有了刚才输入的草稿；
> 同个位置（同个 worktree 或无 worktree 的工作空间）的新会话是要保留草稿的。

复现步骤（插件侧栏）：

1. 在某个 worktree（或非 git 工作区）点 `+` / 右键「新建会话」⇒ 宿主铸出一条 `blank: true` 的空白会话 `S1`；
2. 在输入框敲入草稿（未发送）⇒ 宿主把它写进浏览器 `localStorage` 的 `dsh.conversation.<S1>`；
3. 切换到另一个会话（任意 worktree）；
4. 回到同一位置再点 `+` / 右键「新建会话」⇒ 插件调用 `uiWorkspace.startSession(workspaceId)`（**不带 options**）⇒ 宿主走 `connectBlank(workspaceId, undefined)` 分支，**总是** `sessions.create` 铸出一条新的空白会话 `S2`；
5. `S1` 因为宿主 `sessionVisible()` 的「blank 会话只显示当前那一条」规则被隐藏，草稿虽然还在 `localStorage` 里，但界面上**不可达** ⇒ 用户看到的就是「草稿没了」。

**根因**：草稿是**按会话 id** 持久化的（`dsh.conversation.<sessionId>`），而插件每次「新建会话」都铸新会话。宿主本身提供了复用同目录空白会话的能力（`startSession(workspaceId, { clearPreviousDraft: false })` ⇒ `createInWorkspace()` 按 `summary.cwd === workspace.path` 找回 blank 会话并复用其 `sessionId`），插件的所有「新建会话」入口都没用它。

## 2. 用户已确认决策（DR1–DR3）

| 编号 | 议题 | 确认结论 |
| --- | --- | --- |
| **DR1** | 同位置已存在带草稿的空白会话时，点「新建会话」的行为 | **复用该空白会话**：直接打开它，不再铸第二条，草稿原样保留。语义对齐宿主 `uiWorkspace.startSession(workspaceId, { clearPreviousDraft: false })`（官方「添加工作区 → 开新会话」走的就是这条路径）。 |
| **DR2** | 「同个位置」的判据 | 以**目录（cwd）**为准：同一 worktree 路径，或同一无 worktree 的非 git 工作区路径。不同 worktree 之间**不**互相复用（宿主 `createInWorkspace` 用 `summary.cwd === workspace.path` 过滤，天然满足）。 |
| **DR3** | 生效入口 | 插件**自有**的全部「新建会话」入口：worktree 行 `+`、worktree 右键菜单「新建会话」、非 git 工作区行 `+`、非 git 工作区右键菜单「新建会话」、新建 worktree 成功后的自动开新会话。宿主 Shell 顶部（`SidebarRoot`）的「新建会话」按钮**不在本插件控制范围内**，本次不改（见非目标）。 |
| **DR4** | 复用后的「新会话」行位置（2026-10-22 追加，用户复验原文：「草稿有了，但新会话没有出现在最上面，而是出现在了最下面，新会话应该在最上面才对」） | 当前打开的**空白会话**（=「新会话」占位行）**恒在其容器最前**：先于手动排序、先于顶部区（运行中 / 未落表新会话）、先于 5 条截断。判据 `isCurrentBlankSession`，与宿主 `sectionMembers`（blank 先）/ `pinCurrentBlank`（当前 blank 提到首位）同语义。**不写持久顺序**（纯渲染期）。反向约束：**非 blank** 的当前会话不得因此置顶（T11 终裁不回退）。 |
| **DR5** | 该占位行的拖拽（2026-10-22 追加） | **不可起拖**（仍接受别的会话落到它上/下方），判据 `isSessionDragLocked` = 运行中（`isTopZoneRunningSession`，与置顶判据同源）∪ 当前空白占位行。理由：该行被渲染期钉在最前，允许起拖只会「拖完弹回」（T9 缺陷 1 同类）；宿主原生同样不给 blank 行起拖（`dsh-client-ui-workspace/lib/client.js:2261`）。 |

## 3. 验收标准（AC1–AC7）

| 编号 | 验收标准 | 验证方式 |
| --- | --- | --- |
| **AC1** | `src/sidebar.tsx` 的所有「新建会话」入口都以 `{ clearPreviousDraft: false }` 调用 `startSession`（worktree/非 git 工作区行 `+`、worktree 右键菜单、project 右键菜单、worktree 创建成功后的自动开会话）。 | AST / 接线测试（`test/sidebar-wiring.test.mjs`） |
| **AC2** | `src/sidebar.tsx` 的 `Actions.startSession` 与 `SidebarBridge.startSession` 都接受并**原样转发**第二参 `options`（宿主 props 优先 → bridge 兜底两条路径都不得丢参）。 | AST / 接线测试（`test/sidebar-wiring.test.mjs`） |
| **AC3** | `src/client.tsx` 的 `bridge.startSession` 把 `options` 原样转发给 `uiWorkspace.startSession(workspaceId, options)`；降级路径（`sessions.create`）保持不变并在注释里标明「不保留草稿」。 | AST / 接线测试（`test/sidebar-wiring.test.mjs`） |
| **AC4** | 宿主契约锁：安装的宿主 `dsh-client-ui-workspace` 仍支持 `startSession(workspaceId, options)`，且 `options` 存在时按 `summary.cwd === workspace.path` 复用 blank 会话；宿主文件缺失时用例 **skip** 并说明（不静默放过）。 | 宿主源码契约测试（`test/sidebar-wiring.test.mjs`，`skip` 条件与 `test/render-smoke.test.mjs` 一致） |
| **AC5** | 同一位置重复点 `+` 不会累积空白会话：并发/连点由宿主 `connecting` Map 合并为同一次 `connectBlank`（不在插件侧另做去重）。 | 设计约束 + 代码评审（无法在 Node 侧驱动宿主客户端服务） |
| **AC6** | `npm run typecheck`、`npm run build`、`npm test` 全绿，零回归。 | 命令行实测 |
| **AC7** | 重新构建 `lib/` 后刷新 GUI，人工复验：点 `+` 输入草稿 → 切换会话 → 回同一位置点 `+` ⇒ 草稿仍在。 | 人工验收（本次未执行，见工作记录「未验证」） |
| **AC8** | 当前空白会话（`blank === true` 且当前）在其容器内**恒排第一**：无论手动顺序把它排到最后、无论容器里有几条按 `updatedAt` 更早的会话、无论是否传 `topZone`；运行中的会话紧随其后。非当前 blank 仍不渲染；**非 blank** 的当前会话仍按持久顺序（不得被置顶）。 | 单元测试（`test/tree-model.test.mjs` 的 `2026-10-22/DR4`） |
| **AC9** | 拖拽锁判据 `isSessionDragLocked` = 运行中 ∪ 当前空白占位行；`sidebar.tsx` 的 session 行拖拽接线必须走它（不得直接判 `isTopZoneRunningSession`），且该判据在 `src/` 只有一份声明、内部复用唯一的 `isTopZoneRunningSession`。 | 单元测试 + AST / 接线测试（`test/tree-model.test.mjs`、`test/sidebar-wiring.test.mjs`） |

## 4. 非目标

1. **不**修改宿主 Shell 顶部的「新建会话」按钮（`dsh-client-ui-sidebar` 的 `SidebarRoot`，调用 `startSession()` 无位置语义，插件无法接管）。
2. **不**把草稿搬进插件自己的存储，也**不**在插件侧迁移 `dsh.conversation.<id>` 的键 —— 复用同一 `sessionId` 是宿主既定机制，迁移会引入第二份草稿真相。
3. **不**改变「blank 会话只显示当前那一条」的渲染规则（沿用它才不会在侧栏堆出多条「新会话」）。
4. **不**恢复「当前会话置顶」：DR4 只针对 `blank === true` 的占位行，普通（已结束 / 正在查看）会话的位置仍完全由持久顺序决定。
5. **不**改「最近」分区的排序（它按 `updatedAt` 降序，占位行在其中的位置不属于本次范围）。
6. **不**涉及归档会话：宿主 `createInWorkspace` 自带 `!archived.includes(id)` 过滤，已归档的空白会话不会被复用。
7. **不**新增路由、不改台账结构（纯客户端接线修复）。
