# 工作记录：「最近」分区按会话最后更新时间（任意活动）倒序

- **日期**：2026-10-29
- **状态**：已完成（自动验证全绿；GUI 人工复验待宿主重启，见 §5.3）
- **主题**：侧栏底部「最近」排序键从「最后一次用户发言」升级为「最后更新时间（任意活动）」，
  覆盖助手回复、工具执行、子代理/后台任务活动；排序口径经用户 AskHuman 确认。
- **相关文档**：[需求与验收标准](../requirements/2026-10-29-recent-any-activity-sort.md) ·
  [设计](../design/2026-10-29-recent-any-activity-sort.md) · [PRD §16](../PRD.md) ·
  [接口契约 §1.1 / §1.7 / §2.3.3](../INTERFACES.md) · [领域术语表](../../CONTEXT.md) ·
  [Activity 技术文档](../knowledge/l3-components/Activity技术文档.md)

## 1. 目标与范围

- 需求来源：用户 2026-10-29 反馈「最近」中历史对话有更新未上浮。
- 验收标准：见需求文档 AC1–AC8。
- 非目标：不改上方工作区树顺序、手动排序、顶部区、100 条上限、客户端轮询节奏；
  不为活动表做跨重启持久化。

## 2. 事实核实（改动前）

| 事实 | 证据 |
| --- | --- |
| 「最近」排序代码确实按 `updatedAt` 降序 | `src/tree-model.ts#emitRecentSection`、`lib/client.js` 同段；界面 AX 树的 100 条顺序与 `/tree` 载荷逐项一致 |
| 宿主 `updatedAt` 只由「创建时间 + 最后一次用户发言」构成 | `dsh-api-session-controller/lib/types/list.js` 的 `updatedAt()` 与 `applySessionListMetadata`（仅 `user/message` + `source.kind === 'user'` 推进） |
| 持续运行的会话确实停在旧的 `updatedAt` 位置 | 实测「电脑助理 / 批量分析未开始 issue 日志生成报告」日志在 20:00 仍有活动，但载荷 `updatedAt` 停在 11:09 |
| 用户确认口径 | AskHuman（2026-10-29）：「任何活动都算」；现象为「没有新用户消息、只有助手回复或后台任务活动时没有上浮」 |
| 宿主事件可用于取活动时间 | `dsh-session/lib/types/index.d.ts:61`：`'session/event'(this: Scoped<Session>, session: Session, event: SessionEvent)`；`event.time` 是持久时间戳 |

## 3. 决策与实现

| 决策 | 结论 |
| --- | --- |
| RAS1 排序口径 | 任意活动（用户/助手消息、工具、turn、子代理） |
| RAS2 数据源 | 宿主 `session/event` 的 `event.time`；进程内 Map（LRU 4096），回调只做 O(1) 记录 |
| RAS3 子代理 | 载荷组装时沿 `parentSessionId` 向祖先传播最大值 |
| RAS4 回退 | `lastActivityAt = max(updatedAt, 记录)`；无记录回退 `updatedAt`；不做跨重启持久化 |
| RAS5 影响面 | 只有「最近」分区消费 `lastActivityAt`；工作区树/顶部区/手动顺序保持原样 |

实现落点：

| 文件 | 变更 |
| --- | --- |
| `src/activity.ts`（新增） | 归一化 id、LRU 活动表、进程级单例、`registerSessionActivityObserver`（监听 `session/event`）、`attachLastActivityTimes`（含祖先传播与环保护） |
| `src/routes.ts` | `registerRoutes` 注册活动监听（不用 `ctx.effect`，路由 effect 数量仍 5）；`toSessionRow` 先回填 `lastActivityAt = updatedAt`；`buildSessionRows` 末尾 `attachLastActivityTimes(rows)` |
| `src/types.ts` | `SessionRow.lastActivityAt: number`（必填，恒有限且 ≥ `updatedAt`） |
| `src/tree-model.ts` | `SessionRowLike.lastActivityAt?`；新增导出 `recentActivityOf`；`emitRecentSection` 去重/排序改用 `byRecentActivity` |
| `test/activity.test.mjs`（新增） | 10 条纯逻辑用例 |
| `test/routes.test.mjs` | 1 条真实 `/tree` handler + 伪造 `session/event` 集成用例 |
| `test/tree-model.test.mjs` | 5 条「最近」排序/回退/去重/上限/树隔离用例 |

## 4. 执行记录（TDD Red → Green）

### 4.1 Red

```sh
npm run build
# ⇒ 通过（TDD 骨架：src/activity.ts 只有类型与空实现，保证失败来自行为缺失）

node --test test/activity.test.mjs test/tree-model.test.mjs test/routes.test.mjs
# ⇒ ℹ tests 85  / pass 74 / fail 11
# 失败原因全部是行为缺失，不是依赖/语法环境错误：
#   - activity：归一化返回 ''、tracker 恒 undefined、attach 不写字段（9 条断言失败）
#   - routes：registerRoutes 未注册 session/event 监听器（1 条断言失败）
#   - tree-model：`recentActivityOf` 尚未导出（文件加载 SyntaxError）
```

### 4.2 Green

```sh
npm run build
node --test test/activity.test.mjs test/tree-model.test.mjs test/routes.test.mjs
# ⇒ ℹ tests 373 / pass 373 / fail 0
```

### 4.3 全量回归

```sh
npm run typecheck
# ⇒ 通过（无输出）

npm test
# ⇒ ℹ tests 517 / pass 517 / fail 0 / duration_ms 40213
# 本次新增 16 条（activity 10 + tree-model 5 + routes 1），其余为既有回归
```

## 5. 验证证据

### 5.1 自动验证

- `npm run typecheck`：通过。
- `npm run build`：通过；`lib/activity.js`、`lib/tree-model.js`、`lib/client.js` 已重建。
- `npm test`：517 / 517 通过。
- 覆盖的核心行为：最近分区按 `lastActivityAt` 上浮、缺失/NaN/更旧值回退 `updatedAt`、
  同会话多容器去重取更晚活动、100 条上限、工作区树顺序不受影响；`/tree` 载荷带
  `lastActivityAt` 且随 `session/event`（含孙代理 → 祖先传播）更新；更旧事件不回退；
  畸形事件不抛；`ctx.on` 缺失/注册抛错静默降级。

### 5.2 运行实例证据（改动未生效）

```sh
curl -s -X POST http://127.0.0.1:3080/dsh-worktree-groups/tree -H 'content-type: application/json' -d '{}' | grep -c lastActivityAt
# ⇒ 0
```

原因：当前 DSH 宿主进程（`node … dsh web --port 3080`，本次会话由它提供服务）在启动时加载了
旧版插件模块；宿主侧代码（事件监听、路由载荷字段）**不随页面刷新重载**。

### 5.3 人工 GUI 复验（AC8）：**未执行**

- 前置条件：重启 DSH（会终结当前会话，PRD R1）或触发插件重载，让宿主加载新的
  `lib/activity.js` / `lib/routes.js`；之后刷新页面加载新 `lib/client.js`。
- 本次未执行的理由：重启会终结当前会话，不能在交付过程中擅自执行；已用集成测试覆盖
  宿主事件 → 载荷字段 → 树模型排序的完整链路，并在 §5.2 如实记录实例仍为旧代码。
- 复验步骤（重启后）：在旧会话中触发助手回复/任务活动（不发送用户消息）⇒ 该会话应在
  30 秒内（或触发一次树刷新后）出现在「最近」更靠上的位置。

## 6. 结果与后续

- 已完成：代码、测试、需求/设计/契约/PRD/术语表/知识库与索引更新。
- 已知限制（需求 §5 已披露）：
  1. 活动表是进程内内存态，DSH 重启后回退 `updatedAt`，直到会话再次产生事件。
  2. 只覆盖本进程收到的 `session/event`；其他 DSH 进程/远程实例的活动不进入本进程。
  3. 界面更新仍受现有刷新机制约束（本会话约 220ms 防抖；其他会话最迟 30s 轮询）。
- 后续：宿主重载后按 §5.3 做人工复验；若希望「界面秒级跟随活动」，另立需求调整轮询/推送。
- 变更文件：见 `git status`（`src/activity.ts`、`src/routes.ts`、`src/types.ts`、
  `src/tree-model.ts`；`test/activity.test.mjs`、`test/routes.test.mjs`、`test/tree-model.test.mjs`；
  `CONTEXT.md`、`README.md`、`docs/PRD.md`、`docs/INTERFACES.md`、`docs/README.md`、
  `docs/knowledge/README.md`、`docs/knowledge/l3-components/*`、本目录三份文档）。
