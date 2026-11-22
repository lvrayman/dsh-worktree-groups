---
git-version: 5d2fe5126f9eae89c95f397d0b99c658ad6a9e26
git-module-path: src/live-state.ts
level: L3
更新时间: 2026-10-19
状态: 现行
---

# LiveState 技术文档（`src/live-state.ts`）

> 定位：会话行**客户端 live fact**（等待确认琥珀态 / 后台完成未读绿点）的纯逻辑取数层。
> 上游：`INTERFACES.md` §2.3.2；`HOST-CONTRACTS.md` 硬约束第 26 条；
> 下游：`src/sidebar.tsx` 的 `withLiveState(row, live)`。
> 运行契约：`PRD.md` US7（会话行三态：运行中 / 等待确认 / 后台完成未读）。

## 1. 存在理由（缺陷史）

这两个态**只能**从客户端快照取：宿主 HTTP 面的 `SessionSummary`
（`summarizeCold` / `summaryFor` / `listFields`）**没有** `pendingInteraction`，
也**没有** `completed`。所以 `routes.ts` 的 `toSessionRow` 读它们恒得 `undefined`，
HTTP 面永远给不出这两个态。

而客户端侧的取法随宿主版本变过两次：

| 状态 | `0.1.5-rc.2` | `0.2.1-rc.2`（当前安装） |
|---|---|---|
| 等待确认（琥珀） | root hook `useSessionPendingInteraction` → `Map<id, interaction>` | **该 source 已删除**（全宿主 0 处命中） |
| 后台完成未读（绿） | `useSessions().byId[id].completed` | **该字段已删除**（`projectList()` 不再写） |

失效的表现是**不崩但永远不亮**：`sidebar.tsx` 用 `asHook()` 取 source，
缺席时降级成恒 `undefined` 的占位，于是 PRD US7 的两个态静默消失。

现行唯一来源：

```js
// dsh-client-ui-session/lib/client.js 的 publishStatus()
new Map<SessionId, {
  running: boolean,
  pendingInteraction: { kind: 'approval' | 'plan-review' | 'question' | … } | undefined,
  completionUnread: boolean,
}>()
```

## 2. 导出符号

| 符号 | 形态 | 用途 |
|---|---|---|
| `visiblePendingKind(kind)` | `unknown → string \| undefined` | 复刻原生 `visiblePendingKind`：只有三种 kind 算等待确认 |
| `normalizeSessionKey(id)` | `string → string` | 去掉 `session-` 前缀的比较键（**只用于查表**） |
| `sessionStatusOf(status, id)` | `→ unknown` | 从 `useSessionStatus` 的 Map 取某会话条目（先精确、再归一化遍历） |
| `liveStateOf(input, id)` | `→ { pendingKind, completionUnread }` | 对外唯一入口：新源优先、旧源兜底 |

`LiveStateInput` = `{ status?, pending?, sessions? }`，三者都是**原始快照**（不做假设）。

## 3. 关键行为与不变量

1. **新源优先**：`status` 里有该会话的条目 ⇒ `pendingInteraction.kind` 与
   `completionUnread` 都只认它；旧源**不覆盖**最新事实。
2. **旧源兜底**：`status` 没数据时才回落到 `useSessionPendingInteraction`（`pending`）
   与 `byId[id].completed`（`sessions`）。保留旧路径是为了宿主回退 / 其它 profile 组合。
3. **kind 白名单**：`approval` / `plan-review` / `question`。其余 kind、非字符串
   （如 `'approval'` 直接是值而不是 `{ kind }`）、缺字段一律 `undefined` ——
   **不能因为快照里有值就点琥珀**。
4. **`completionUnread` 只认 `=== true`**：`'yes'` / `1` / `{}` 都不亮。
5. **id 两种拼法**：`session-<uuid>` 与裸 `<uuid>` 都能查到。先 `get(id)` 精确命中
   （绝大多数情况），未命中再按归一化键遍历（O(n)，只在未命中时发生）。
6. **绝不抛错**：`get` / `entries` 都包 try/catch；任何不认识的形状降级为「没有该态」。
7. **空 id 不误命中**：`sessionId === ''` 或归一化后为空直接返回 `undefined` / `false`。

## 4. 为什么是独立模块（而不是留在 `sidebar.tsx`）

`.tsx` **不进 `lib/`**（`tsconfig.json` 只编译 `.ts`；`.tsx` 走 esbuild 打进
`lib/client.js` 的 bundle），所以 `node --test` **无法执行**它。这段取数逻辑以前
埋在 `sidebar.tsx` 里，属于**零自动回归保护**的区域 —— 这也正是它失效两个宿主版本
都无人发现的原因。抽成纯逻辑后，10 条用例可直接执行。

## 5. 调用方契约（`src/sidebar.tsx`）

```ts
// 首渲染冻结（hook 数量恒定，见 SnapshotSources 注释）
sourcesRef.current = {
  sessions: asHook(props.useSessions),
  workspaces: asHook(props.useWorkspaces),
  status: asHook(props.useSessionStatus),        // ← 现行来源
  pending: asHook(props.useSessionPendingInteraction), // ← 旧宿主兜底
}
const sessionStatus = sources.status(identity)       // 必须读出返回值（否则订阅是死代码）
const pendingInteractions = sources.pending(identity)

// 渲染会话行
const row = withLiveState(viewRow, {
  status: sessionStatus,
  pending: pendingInteractions,
  sessions: sessionsSnapshot,
})
```

- `withLiveState` 只在 `row.kind === 'session'` 时覆盖，且**产出一个浅覆盖的新行对象** ——
  `RenderRow` 是冻结契约，不得往里塞字段。
- HTTP 面若给了 `row.pendingInteraction` / `row.completed`（其它宿主版本），仍**优先**于客户端值。

## 6. 验证

| 用例 | 断言 |
|---|---|
| 新源三态 | `approval` / `plan-review` / `question` 各自点亮琥珀 |
| 白名单拒绝 | `compact`、`undefined`、字符串 `'approval'`、`{}` 都不亮 |
| 绿点语义 | `completionUnread === true` 亮；`false` / 缺字段 / `'yes'` / `1` / `{}` 不亮 |
| id 拼法 | `session-abc` 与 `abc` 双向互查；`normalizeSessionKey` 等价 |
| 旧源兜底 | `status` 缺席时仍认 `useSessionPendingInteraction` 与 `byId.completed` |
| 新源优先 | 新旧同时有数据时以新源为准 |
| 健壮性 | `undefined/null/0/''/'x'/[]/{}/{get:1}/Map/Set` 全部不抛错、降级为无该态 |
| 空 id | `sessionId === ''` 不误命中 |
| 接线 | `sidebar.tsx` 必须出现 `useSessionStatus`、必须经 `withLiveState`、且不得退回单一路径 |

## 7. 已知边界

- `useSessionStatus` 的 `pendingInteraction` 只取 `kind`；具体交互内容（审批正文等）
  由宿主自己的 composer 渲染，本插件不读。
- 旧源兜底路径**无法在当前宿主上验证**（source / 字段都不存在），只由 `test` 用合成
  快照覆盖；宿主回退时才生效。
- `completionUnread` 的语义由宿主 `UiSession.observeRunning()` 维护（主视图会话不会
  被标记未读），本插件只读不写。
