---
git-version: eddd89b2f454e0d4728dd066e6f58f8c225830f3
git-module-path: src/activity.ts
level: L3
更新时间: 2026-10-29
状态: 现行
---

# Activity 技术文档（`src/activity.ts`）

> 定位：会话**最后更新时间**（任意活动）的宿主侧跟踪与载荷补齐层。
> 上游：宿主 Cordis 事件 `session/event(session, event)`；`SessionSummary.updatedAt`
> （只有创建时间 + 最后一次用户发言）。
> 下游：`src/routes.ts#buildSessionRows` 给每条 `SessionRow.lastActivityAt` 赋值；
> `src/tree-model.ts` 的「最近」分区按它排序。
> 契约：[INTERFACES §1.7 / §2.3.3](../../INTERFACES.md)；设计：
> [2026-10-29 最近分区最后更新时间](../../design/2026-10-29-recent-any-activity-sort.md)。

## 1. 存在理由

宿主 `SessionSummary.updatedAt = Math.max(header.createdAt, metadata.lastPromptAt)`
（`dsh-api-session-controller/lib/types/list.js` 的 `updatedAt()`），而 `lastPromptAt`
只在 `user/message`（`source.kind === 'user'`）时推进。助手回复、工具调用、子代理/后台任务活动
都不改变它，于是侧栏「最近」分区无法让「正在被更新」的旧会话上浮（用户 2026-10-29 反馈）。

宿主 `session/event` 对每个持久化会话事件都会触发，`event.time` 是事件的持久时间戳。
本模块把 `(session.id, event.time)` 记进进程内 Map，并在组装 `/tree` 载荷时把子代理活动
沿 `parentSessionId` 传播到祖先主会话。

## 2. 导出与数据模型

```ts
export const SESSION_ACTIVITY_LIMIT = 4096
export function normalizeActivitySessionId(id: unknown): string   // 去 session- 前缀 + trim
export function createSessionActivityTracker(limit?: number): SessionActivityTracker
export function recordSessionActivity(sessionId: unknown, time: unknown): void
export function lastSessionActivityAt(sessionId: unknown): number | undefined
export function resetSessionActivity(): void
export function registerSessionActivityObserver(ctx: Context): () => void
export function attachLastActivityTimes(rows: SessionActivityBearing[]): void
```

`SessionActivityBearing` 是 `SessionRow` 的结构子集：

```ts
{ sessionId: string; updatedAt: number; parentSessionId?: string; lastActivityAt?: number }
```

| 行为 | 规则 |
|---|---|
| 归一化 | 非字符串 / 空串 ⇒ `''`；`session-<uuid>` ⇒ `<uuid>`（事件与载荷两种拼法统一） |
| 记录 | 只接受有限数字；保留最大值；重复记录把键移到 LRU 尾部 |
| 容量 | 默认 4096，超过后淘汰最久未更新的一条（防止长进程无界增长） |
| 回退 | 没有活动记录 / 活动比 `updatedAt` 旧 ⇒ `lastActivityAt = updatedAt` |
| 传播 | 沿 `parentSessionId` 向祖先取 max；缺失父、自环、多节点环安全终止 |
| 降级 | `ctx.on` 缺失 / 注册抛错 / 事件缺字段 ⇒ 静默忽略，不抛 |

## 3. 装配位置

1. `registerRoutes`（`src/routes.ts`）在注册 5 个路由之前调用
   `registerSessionActivityObserver(ctx)`。刻意**不**用 `ctx.effect`：监听器生命周期由
   Cordis 上下文负责，路由 effect 数量保持 5（§7 注册契约测试逐字断言）。
2. `buildSessionRows`（`src/routes.ts`）在全部会话行（含子代理）到齐后调用
   `attachLastActivityTimes(rows)`。必须在「全部行」之后，否则子代理活动传不到祖先。

## 4. 边界与已知限制

- 活动表是**进程内**内存态：DSH 重启后清空，未再活动的会话回退 `updatedAt`。
- 只覆盖本进程收到的 `session/event`；其他 DSH 进程/远程实例的活动不会进入本进程。
- 事件回调里不做 IO、不打日志、不抛错；单测覆盖缺失 `on`、`on` 抛错、畸形事件。
- `lastActivityAt` 字段只进「最近」分区排序；工作区树/手动顺序/顶部区仍用 `updatedAt`。

## 5. 测试

`test/activity.test.mjs`（10 条）：归一化、最大值、非法入参、LRU 淘汰、单例读写/重置、
无活动回退、活动优先、多层传播、缺失父/环、重复行、监听器降级。
集成：`test/routes.test.mjs` 的 `2026-10-29/RAS2/RAS3`（真实 `/tree` handler + 伪造事件）；
树模型：`test/tree-model.test.mjs` 的 `2026-10-29/RAS*`。
