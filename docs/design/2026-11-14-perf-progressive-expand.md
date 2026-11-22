# 设计：整体性能优化 + 会话列表渐进式展开

- **日期**：2026-11-14
- **状态**：已实现
- **需求**：[2026-11-14-perf-progressive-expand](../requirements/2026-11-14-perf-progressive-expand.md)
- **工作记录**：[worklog](../worklog/2026-11-14-perf-progressive-expand.md)

## 1. 总体思路

「新会话 / 新 worktree 出现慢」是两段延迟之和：**触发延迟**（客户端什么时候去问）+ **计算延迟**（服务端算一棵树要多久）。
本次两段都压到可忽略：

```
宿主 useSessions 快照 ──(同步)──► mergeLiveSessions ──► buildRows ──► 画   ← 新会话 0 往返可见
              │ pendingIds 变化
              ▼
   220ms 防抖 / 5s 轮询 / 聚焦 ──► reload（单在途 + 尾随，If-None-Match）
                                       │
                                       ▼
   /tree：createTreeFlight（合并） ──► buildTreePayload(reuseSessions)
        ├─ cachedSessionRows：活动版本号 + 活会话签名 + 30s 兜底
        ├─ scanRepos：仓指纹校验 + 6 并发 + 同仓共享
        ├─ ledger：mtime/size 读缓存；lastSeenAt 1h 节流 ⇒ 几乎不写盘
        └─ JSON + sha1 ETag ──► 200 / 304
```

## 2. 服务端（`src/routes.ts` / `src/git.ts` / `src/ledger.ts` / `src/activity.ts`）

| 项 | 旧 | 新 |
| --- | --- | --- |
| 会话列举 | 每请求 `sessionController.list` + `sessionPersistence.list` 串行，各自全量扫盘 | 两路并行；路由层 `reuseSessions: true` 时走 `cachedSessionRows`：`sessionActivityVersion()` 未变、`ctx.sessions.list()` 的 id 集合未变、未超过 `SESSION_ROWS_MAX_AGE_MS`（30 s）⇒ 复用；复用时用 `ctx.agents` 刷新运行态、重算 `lastActivityAt` |
| 并发请求 | 各算各的 | `createTreeFlight`：空闲立即算；忙时所有新请求共享**一个**排队计算（在当前计算结束后开始 ⇒ 一定反映请求到达前的状态） |
| git 扫描 | 30 s TTL；主路径旧条目优先；串行 | 仓指纹（`commonDir/HEAD`、`commonDir/worktrees/*/{HEAD,gitdir}` mtime、各 worktree 存在性）一致才复用，`SCAN_CACHE_MAX_AGE_MS` 5 min 兜底；负缓存指纹 = `<path>/.git` 是否存在；6 并发；扫完一个仓即覆盖其全部入口的缓存；`scanRepo` 内三条 git 命令并行 |
| 台账 | 每请求读两遍盘 + 必写（`lastSeenAt` 每次刷新） | `createFileLedger` 内存读缓存（mtime+size 校验，公开 `read()` 仍返回 `structuredClone` 副本）；`lastSeenAt` 按 `LEDGER_LAST_SEEN_REFRESH_MS`（1 h）节流 ⇒ 无实质变化不写盘 |
| 响应 | 每次 600 KB JSON | `ETag`（sha1/base64url）+ `cache-control: no-cache`；`If-None-Match` 命中 ⇒ 304 无体 |
| 工作区存在性 | 逐个 `await stat` | 并行 |

`clearScanCache()` 现在清空全部进程内缓存（扫描 + 会话列举 + 让既有合并器丢弃旧计算），供测试隔离。
直接调用导出函数（`buildTreePayload` / `collectSnapshot`）缺省不开启会话缓存，保持旧语义。

### 2.1 缓存正确性边界

- 会话缓存失效信号覆盖：任意宿主 `session/event`（消息、工具、标题投影等都会产生事件）、活会话集合增减、30 s 兜底。
  不覆盖的变化（例如纯磁盘层面删除冷会话日志）最迟 30 s 收敛。
- 指纹覆盖 `git worktree add/remove/move/prune`、任一工作树切分支、目录被删；不覆盖的罕见变化最迟 5 min 收敛。
- 指纹计算失败一律折算为哨兵值 ⇒ 最坏情况是多扫一次，绝不会用错的缓存。

## 3. 客户端（`src/sidebar.tsx` / 新增 `src/live-merge.ts`）

- **`mergeLiveSessions(tree, useSessions 快照)`**（纯函数）：
  - 已有行：标题 / `running` / `blank` 以快照为准；`updatedAt`、`lastActivityAt` 只增不减；
  - 新顶层会话（非子代理、未归档、有 cwd）：按 cwd 最长前缀匹配**存在的** git worktree 节点或非 git 工作区（`workspaceByPath`）立即插入容器最前；匹配不到不插；
  - 返回 `pendingIds`（快照有、服务端树没有的顶层可见会话），无变化返回同一引用。
- `sidebar.tsx`：`serverTree`（服务端）→ `merged` → `tree`（下游一律用叠加后的树）。
- **reload**：同一时刻至多一个在途请求，期间触发只置尾随标记；卸载才 abort；带 `If-None-Match`；页面隐藏时跳过。
- 防抖触发源：`pendingLiveSignature`（替代整份 `sessionsSnapshot`）、`currentSessionId`、`runningSignatureValue`。
- 轮询 30 s → 5 s（304 为主）；新增 `visibilitychange` 重新可见即拉。
- **会话行 memo 化（追加）**：`React.memo` + `sessionRowPropsEqual`（`src/row-memo.ts`）；处理器经稳定 ref 间接调用，保证跳过重绘时也不会触发陈旧闭包。

## 4. 渐进式展开（`src/tree-model.ts` / `src/sidebar.tsx` / `src/locales.ts`）

由子代理实现，细节见 [INTERFACES](../INTERFACES.md) 中 more 行 / `expandLevels` 契约与 [TreeModel 技术文档](../knowledge/l3-components/TreeModel技术文档.md)。要点：

- 层级 L 的可见数 `visibleSessionLimit(L) = 5 + 5·L(L+1)/2`；下一次展开数 `nextExpandCount(L, 剩余) = min(5·(L+1), 剩余)`；
- more 行新增 `nextCount`、`canCollapse`；「最近」同样产出 more 行，取消 100 条上限；
- 状态 `expandLevels` 存 `localStorage['dsh-worktree-groups.expandLevels']`；折叠工作区 / worktree / 「最近」时清零其下全部容器层级。

## 5. 取舍

| 取舍 | 选择 | 原因 |
| --- | --- | --- |
| 服务端推送（SSE / WebSocket） vs 轮询 | 5 s 轮询 + ETag | 插件只能注册普通 HTTP 路由；304 往返 < 10 ms，开销可忽略；新会话已由实时叠加层 0 延迟呈现 |
| 只信任客户端快照建树 | 否，仅叠加 | 服务端掌握 git / 台账 / history 归属规则；叠加层只处理能唯一判定的新会话，其余等服务端裁决 |
| 去掉插件自己的 `sessionPersistence.list` | 否（并行 + 缓存） | 它补齐无 cwd 的冷会话等边缘情况，删除会改变既有行为 |
| 会话缓存的最短刷新间隔 | 不设 | 客户端已不再因流式变化触发重取，合并器限制并发；简化正确性 |
