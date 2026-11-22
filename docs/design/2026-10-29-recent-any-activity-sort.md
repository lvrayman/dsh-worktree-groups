# 设计：「最近」分区按会话最后更新时间（任意活动）倒序

- **日期**：2026-10-29
- **状态**：已确认（对应需求 [RAS1–RAS5](../requirements/2026-10-29-recent-any-activity-sort.md)）
- **相关文档**：[需求与验收标准](../requirements/2026-10-29-recent-any-activity-sort.md) ·
  [工作记录](../worklog/2026-10-29-recent-any-activity-sort.md) ·
  [PRD §16](../PRD.md) · [接口契约 §2.3.3](../INTERFACES.md)

## 1. 为什么不能继续使用 `updatedAt`

| 事实 | 证据 | 后果 |
| --- | --- | --- |
| `SessionSummary.updatedAt = max(header.createdAt, metadata.lastPromptAt)` | 宿主 `dsh-api-session-controller/lib/types/list.js` 的 `updatedAt()` | 只有会话创建时间与最后一次**用户发言**两个来源 |
| `lastPromptAt` 仅在 `event.type === 'user/message' && event.data.source.kind === 'user'` 时推进 | 同文件 `applySessionListMetadata` | 助手回复、工具调用、子代理/后台任务活动都不推进 |
| 插件「最近」分区当前按 `updatedAt` 排序 | `src/tree-model.ts#emitRecentSection` | 会话持续被更新时仍停在最后一次用户发言的位置 |

宿主 Cordis 事件 `session/event(session, event)` 覆盖每一个持久化会话事件，且 `event.time` 是该事件的
**持久时间戳**（与日志 `time` 字段同源）。这是插件能够以最小代价获取「最后更新时间」的权威来源
（宿主 `dsh-session/lib/types/index.d.ts:61`：`'session/event'(session: Session, event: SessionEvent)`）。

## 2. 数据流

```
宿主提交会话事件
  └─ ctx.emit('session/event', session, event)                    （宿主 dsh-session）
       └─ registerSessionActivityObserver(ctx)                    （本插件宿主侧，src/activity.ts）
            └─ tracker.record(session.id, event.time)              （进程内 Map，LRU 上限 4096）

POST /dsh-worktree-groups/tree
  └─ buildSessionRows(ctx)                                          （src/routes.ts）
       ├─ 原有：sessionPersistence.list() + sessionController.list()
       ├─ 新增：attachLastActivityTimes(rows, tracker)              （src/activity.ts）
       │    ├─ 每行 lastActivityAt = max(updatedAt, 自身活动时间)
       │    ├─ 沿 parentSessionId 向上传播（子代理活动计入祖先）
       │    └─ 写回每行 lastActivityAt（永远是有限数字）
       └─ buildProjects(...) 原有容器归属不变
  └─ 客户端 buildRows / buildRecentRows                             （src/tree-model.ts）
       └─ 「最近」按 max(updatedAt, lastActivityAt) 降序、sessionId 升序 tiebreak
```

### 2.1 为什么不直接复用 `updatedAt` 字段叠加

- `updatedAt` 在树内还承担「容器默认顺序」「顶部区 / 新会话判定」等语义（见 PRD §5 决策与
  `tree-model.ts` 注释）。把它改成任意活动时间会连带改变上方工作区树与手动排序的既有行为（本次非目标）。
- 新增独立字段 `lastActivityAt`，只让「最近」分区消费，改动面最小、可回滚。

### 2.2 为什么在宿主侧而不是客户端计算

助手回复/工具/子代理事件只存在于宿主事件流；客户端的 `useSessions` 快照里只有 `updatedAt`、`running`
等投影，拿不到活动时间。宿主侧监听是唯一不读日志、不扫盘的实时来源。

## 3. 模块与接口

### 3.1 `src/activity.ts`（新增）

```ts
/** 规范化会话 id：去掉宿主顶层会话的 `session-` 前缀，保证事件与载荷对得上。 */
export function normalizeActivitySessionId(id: unknown): string

export interface SessionActivityTracker {
  record(sessionId: unknown, time: unknown): void
  lastActivityAt(sessionId: unknown): number | undefined
  readonly size: number
}

export function createSessionActivityTracker(limit?: number): SessionActivityTracker

/** 进程级跟踪器（宿主侧单例），route 组装与事件监听共用。 */
export function recordSessionActivity(sessionId: unknown, time: unknown): void
export function lastSessionActivityAt(sessionId: unknown): number | undefined
export function resetSessionActivity(): void

/** 监听宿主 `session/event`；缺失 on/异常时静默降级。返回 disposer（重复调用安全）。 */
export function registerSessionActivityObserver(ctx: Context): () => void

/** 纯函数：给一批会话行补 `lastActivityAt`（含祖先传播）。 */
export function attachLastActivityTimes(rows: SessionActivityBearing[]): void
```

约束：

- `record` 只接受非空 id 与有限数字；记录 `max(旧值, 新值)`；再次记录时把键移到 LRU 尾部。
- `limit` 默认 `SESSION_ACTIVITY_LIMIT = 4096`，超限淘汰最久未更新的一条。
- `attachLastActivityTimes` 对重复 id、缺失 `parentSessionId`、父引用不存在、自环/多级环都必须安全。
- 事件监听只做内存记录，**不**在回调里做 IO、日志或异常上抛（宿主逐监听器隔离异常，但本插件仍
  遵循「缺失即降级，绝不崩」）。

### 3.2 `src/routes.ts`

- `registerRoutes(ctx)` 顶部调用 `registerSessionActivityObserver(ctx)`；用 `ctx.effect` 绑定释放。
- `buildSessionRows(ctx, signal)` 组装完 `rows` 后调用 `attachLastActivityTimes(rows)`。
- 其余路由（worktree-create / remove / reveal / workspace-open）不变。

### 3.3 `src/types.ts` / 载荷

`SessionRow` 新增：

```ts
/** 会话最后更新时间（任意活动；>= updatedAt）。「最近」分区排序键。 */
lastActivityAt: number
```

HTTP `/tree` 载荷因此每条会话行都带 `lastActivityAt`；旧客户端忽略未知字段，向后兼容。

### 3.4 `src/tree-model.ts`

- `SessionRowLike` 新增可选 `lastActivityAt?: number`（旧载荷/测试构造仍兼容）。
- 新增纯函数 `recentActivityOf(session)` = `max(updatedAt, 有限 lastActivityAt)`，
  以及比较器 `byRecentActivity`（活动时间降序，`sessionId` 升序）。
- `emitRecentSection` 的去重与排序改用 `byRecentActivity`；渲染行结构不变。
- 工作区树路径（`emitContainer` / `effectiveOrder` / 顶部区）**不消费** `lastActivityAt`。

## 4. 边界与异常

| 场景 | 行为 |
| --- | --- |
| 宿主上下文没有 `on`（老宿主/测试替身） | 监听不注册，载荷全部回退 `updatedAt` |
| `session/event` 的 session 缺 `id` 或 event 缺有限 `time` | 忽略该事件 |
| 同一会话在多个容器重复出现 | 载荷按 `sessionId` 去重（原有），排序取活动时间更晚者 |
| 子代理会话的 `parentSessionId` 指向不存在的主会话 | 只影响该子代理行自身，不抛错 |
| 父链存在环 | 访问集合 + 最大深度保护，终止并保留已算出的最大值 |
| 进程重启 | 活动表清空；`lastActivityAt` 回退 `updatedAt`，直到再次收到事件 |
| 时钟回拨 / `event.time` 小于 `updatedAt` | `max` 保证 `lastActivityAt >= updatedAt`，排序仍确定 |

## 5. 测试设计

| 层次 | 测试文件 | 关键行为 |
| --- | --- | --- |
| 纯逻辑 | `test/activity.test.mjs` | 归一化、最大值、非法入参、LRU 上限、祖先传播（多层/缺失父/环）、重置 |
| 接线/集成 | `test/routes.test.mjs` | `registerRoutes` 注册 `session/event`；事件驱动载荷 `lastActivityAt`；子代理活动传播；无事件时回退 |
| 树模型 | `test/tree-model.test.mjs` | 「最近」按 `lastActivityAt` 排序、回退、去重、100 条上限；工作区树顺序不受影响 |

Red 阶段先写测试并运行，确认失败原因是行为缺失（字段/排序未实现），而不是依赖或语法错误；
Green 阶段做最小实现并复跑。

## 6. 交付与验证

- 自动：`npm run typecheck`、`npm run build`、`npm test`。
- 人工（AC8）：宿主侧代码变更需要 DSH 重启或插件重载后才生效；本次按实际执行情况记录，未执行时
  明确写「未执行」与前置条件，不以「刷新页面」冒充宿主重载。
