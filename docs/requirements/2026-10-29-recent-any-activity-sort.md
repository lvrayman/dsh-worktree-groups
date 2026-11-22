# 需求：「最近」分区按会话最后更新时间（任意活动）倒序

- **日期**：2026-10-29
- **状态**：已确认（用户经 AskHuman 选定「任何活动都算」口径）
- **相关文档**：
  - [设计](../design/2026-10-29-recent-any-activity-sort.md)
  - [工作记录](../worklog/2026-10-29-recent-any-activity-sort.md)
  - [PRD §16](../PRD.md)
  - [接口契约 §1.1 / §1.13 / §2.2 / §2.3.3](../INTERFACES.md)
  - [领域术语表（CONTEXT.md）](../../CONTEXT.md)

## 1. 背景与问题

用户反馈：

> 最下面的「最近」中，如果历史对话有更新，应该上浮到上面，即根据最后更新时间倒序。

核实结果：

1. `src/tree-model.ts` 的 `emitRecentSection` 确实按 `updatedAt` 降序排列，界面 DOM 顺序与 `POST /dsh-worktree-groups/tree` 的载荷一致；**排序代码本身没有失效**。
2. 但 `updatedAt` 来自宿主 `SessionSummary.updatedAt`，其定义是
   `Math.max(header.createdAt, metadata.lastPromptAt)`（宿主
   `@deepseek-ai/dsh-api-session-controller/lib/types/list.js` 的 `updatedAt()`），而
   `lastPromptAt` **只在 `user/message`（`source.kind === 'user'`）时推进**。
3. 结论：助手回复、工具执行、子代理/后台任务活动都不会改变 `updatedAt`。一个正在被持续更新的会话
   （例如长时间任务、子代理协作）在「最近」里会停在它**最后一次用户发言**的位置，看起来就是「有更新但没上浮」。

AskHuman 已确认：

- **排序口径**：任何活动都算（用户消息、助手回复、工具/任务活动）。
- **实际现象**：没有新的用户消息、只有助手回复或后台任务活动时，会话没有上浮。

## 2. 目标与非目标

### 目标

1. 侧栏底部「最近」分区按会话的**最后更新时间**（`lastActivityAt`）倒序，而不是只按最后一次用户发言时间。
2. 「最后更新时间」覆盖宿主持久事件流上的任意事件：`user/message`、`assistant/message`、工具调用/结果、
   `turn/start`/`turn/end`、子代理活动等。
3. 子代理（嵌套）活动计入其**父会话**的活动时间，保证「父会话在等子代理」时也会上浮。
4. 无活动记录时回退到原有 `updatedAt`，不改变任何已有数据的可排性。

### 非目标

1. **不改**上方工作区树（worktree / history / flat）内部的会话顺序、顶部区与手动排序。
2. **不改**「最近」的收录范围、可见性过滤与 100 条上限。
3. **不新增**持久化：活动时间表是进程内内存态，DSH 重启后历史活动未知，回退到 `updatedAt`。
4. **不改**客户端轮询节奏（现有 `TREE_REFRESH_MS = 30_000` 与快照变化触发的防抖刷新）。
5. **不改**宿主本身对 `updatedAt` 的定义（插件只读宿主数据 + 监听宿主事件）。

## 3. 用户已确认决策（RAS1–RAS5）

| 编号 | 议题 | 确认结论 |
| --- | --- | --- |
| **RAS1** | 排序口径 | 「最后更新时间」= 任意会话活动时间，不只是用户发言。 |
| **RAS2** | 数据来源 | 宿主 Cordis 事件 `session/event(session, event)` 的 `event.time`；取该会话历史最大值。事件回调只做 O(1) 记录，不读日志、不做 IO。 |
| **RAS3** | 子代理归属 | 子代理事件计入其祖先主会话：载荷组装时沿 `parentSessionId` 向上取 `max`；「最近」仍只渲染主会话。 |
| **RAS4** | 回退与边界 | `lastActivityAt = max(updatedAt, 已记录活动时间)`；无记录时等于 `updatedAt`。进程重启后未再活动的会话回退到 `updatedAt`（已披露的已知限制）。 |
| **RAS5** | 影响面 | 只在「最近」分区使用 `lastActivityAt` 排序；上方工作区树仍按 `updatedAt` 排序，手动顺序/顶部区语义不变。 |

## 4. 验收标准（AC1–AC8）

| 编号 | 验收标准 | 验证方式 |
| --- | --- | --- |
| **AC1** | 新增 `src/activity.ts`：`createSessionActivityTracker` 按归一化会话 id 记录活动时间，只保留最大值；非法入参（非字符串/非有限数字）被忽略；容量上限内按 LRU 淘汰，不无界增长。 | 单元测试（`test/activity.test.mjs`） |
| **AC2** | `registerSessionActivityObserver(ctx)` 在宿主 Cordis 上下文上监听 `session/event`，把 `(session.id, event.time)` 记录进进程级跟踪器；上下文无 `on`、监听抛错或事件缺字段时**静默降级**，不崩。 | 单元测试 + `routes.test.mjs` 接线测试 |
| **AC3** | `POST /dsh-worktree-groups/tree` 返回的每条 `SessionRow` 都带有限数字 `lastActivityAt`，且 `lastActivityAt >= updatedAt`；未收到活动事件时等于 `updatedAt`。 | 集成测试（`test/routes.test.mjs`） |
| **AC4** | 子代理（多层）的活动时间会传播到祖先主会话，祖先行的 `lastActivityAt` 不小于任一后代；无环/异常父引用不会死循环。 | 单元测试（`test/activity.test.mjs`） |
| **AC5** | 「最近」分区按 `lastActivityAt` 降序（同值按 `sessionId` 升序）排列，最多 100 条；`lastActivityAt` 缺失或非法时回退 `updatedAt`；不同容器内同一 `sessionId` 去重时取活动时间更晚的一条。 | 单元测试（`test/tree-model.test.mjs`） |
| **AC6** | 上方工作区树的容器内顺序仍由 `updatedAt` / 手动顺序决定：给同一批会话设置更新的 `lastActivityAt` 不得改变容器内顺序。 | 单元测试（`test/tree-model.test.mjs`） |
| **AC7** | `npm run typecheck`、`npm run build`、`npm test` 全部通过，零回归。 | 命令行实测 |
| **AC8** | 重新构建 `lib/` 并让宿主加载新代码（**需要重启 DSH 或触发插件重载**）后，人工复验：持续产生助手/任务活动的会话在「最近」中上浮。 | 人工验收（本次按实际条件记录；未执行时明确写「未执行」） |

## 5. 已知限制

1. 宿主重启后，内存活动表清空；重启前最后活动晚于最后用户发言的会话会暂时回落到 `updatedAt`，直到它再次产生事件。
2. 活动表只覆盖**本进程**收到的 `session/event`；在其他 DSH 进程/远程实例里发生的活动不会写入本进程。
3. 「最近」的界面更新仍受现有刷新机制约束：本对话内的活动经 `sessionsSnapshot` 变化触发约 220ms 防抖刷新；其他会话的活动最迟在 30s 轮询后反映。
