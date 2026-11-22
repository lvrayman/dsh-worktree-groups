# 工作记录：整体性能优化 + 会话列表渐进式展开

- **日期**：2026-11-14
- **状态**：已完成（自动验证全绿；服务端优化需宿主重启后生效，GUI 人工复验待用户执行，见 §5）
- **相关**：[需求](../requirements/2026-11-14-perf-progressive-expand.md) · [设计](../design/2026-11-14-perf-progressive-expand.md) ·
  [PRD §17](../PRD.md) · [契约](../INTERFACES.md) §1.5 / §2.2 / §2.3 / §2.3.4 · [CONTEXT](../../CONTEXT.md)

## 1. 目标与范围

- 需求来源：用户 2026-11-14（性能：新 worktree / 新会话出现慢；交互：展开其余会话改为渐进式，「最近」同逻辑且不限 100）。
- 验收标准：需求文档 §3.1 PERF1–PERF7、§3.2 PX-AC1–AC6。
- 非目标：不改归属规则 / 手动排序 / 顶部区 / 「最近」排序口径；不改宿主。
- 前置：工作区已有 2026-10-29「最近按任意活动排序」的未提交改动，本次在其上叠加，未回滚。

## 2. 确认与决策（AskHuman 2026-11-14）

| 问题 | 用户选择 |
| --- | --- |
| 子代理模型（DeepSeek Flash 路由被拒） | 改用 GLM |
| 收起入口 | 展开过一次后同行提供「收起」；全展开只剩「收起」 |
| 「最近」默认条数 | 5 条，按 5/10/15… 递增 |
| 层级持久化 | 存 localStorage，折叠时清零 |

过程记录：GLM 子代理 `expand-dev` 被派去做渐进展开，结束时**未产生任何文件改动**（`src/tree-model.ts` 等 mtime 未变），
因此该部分由主代理自行完成。

## 3. 根因（改动前实测）

见需求文档 §1：运行中宿主 `/tree` 3 次 1.42 / 0.71 / 0.69 s、601 695 B；会话目录被列举两次；
台账每请求 fsync 重写 352 KB；git 缓存 30 s 且旧条目优先；客户端 abort 饥饿。

## 4. 执行与产物

| 文件 | 变更 |
| --- | --- |
| `src/routes.ts` | 仓指纹 git 缓存 + 并发扫描；会话列举缓存 `cachedSessionRows`（`reuseSessions`）；两路列举并行；`createTreeFlight` 合并器；ETag/304；`lastSeenAt` 1 h 节流；工作区 stat 并行；`clearScanCache` 清全部缓存 |
| `src/git.ts` | `scanRepo` 三条 git 命令并行、worktree 存在性并行 |
| `src/ledger.ts` | mtime+size 读缓存（`read()` 返回 `structuredClone`，`update` 内部共享） |
| `src/activity.ts` | `sessionActivityVersion()` |
| `src/live-merge.ts`（新） | `mergeLiveSessions` 实时叠加层 |
| `src/sidebar.tsx` | 叠加层接入；reload 单在途 + 尾随 + If-None-Match + 隐藏跳过；轮询 5 s + visibilitychange；`expandLevels` 状态 / 持久化 / 折叠清零；`MoreRowView` 双按钮 |
| `src/tree-model.ts` | `visibleSessionLimit` / `nextExpandCount` / `containerKeysUnder`；`truncateByLevel`；more 行 `nextCount` / `canCollapse`；「最近」去 100 上限 |
| `src/locales.ts` | `sessions.expandMore` |
| 测试（新） | `test/perf.test.mjs`、`test/live-merge.test.mjs`、`test/progressive-expand.test.mjs`、`test/sidebar-perf-wiring.test.mjs` |
| 测试（改） | `test/tree-model.test.mjs` 4 条旧用例按新需求改预期（more 行字段集 6→8；全展开 `hiddenCount` 7→0 + `canCollapse`；「最近」100 上限两条）；`test/locales.test.mjs` +1 |
| 文档 | 需求 / 设计 / 本记录、INTERFACES、PRD §17、CONTEXT、README 索引、TreeModel 知识库修订注记 |

## 5. 验证证据

### 5.1 Red → Green

| 测试 | Red（实现前） | Green |
| --- | --- | --- |
| `node --test test/perf.test.mjs` | 7 失败 / 1 通过：PERF3×3（新 worktree / 删除 / 切分支在缓存期内不可见）、PERF2 台账 10 分钟后被重写、PERF1 并发 5 次列举 5 次、PERF1 第二次请求仍扫盘（2≠1）、PERF4 无 ETag。通过的 1 条为「读缓存感知外部改写」回归守卫 | 8/8 |
| `node --test test/live-merge.test.mjs` | `ERR_MODULE_NOT_FOUND lib/live-merge.js` | 7/7 |
| `node --test test/progressive-expand.test.mjs` | `does not provide an export named 'containerKeysUnder'` | 6/6 |
| `test/sidebar-perf-wiring.test.mjs` | 测试后写；以 `git archive HEAD` 的旧 `sidebar.tsx` 运行 ⇒ 6/6 失败（证明有判别力） | 6/6 |
| `test/ledger.test.mjs` 回归 | 首版读缓存直接返回共享对象 ⇒ 「read() 返回独立副本」2 条失败 | 改为 `structuredClone` 后通过 |

### 5.2 全量

- `npm run typecheck`：通过。
- `npm test`（构建 + `node --test`）：545/545 通过。

### 5.3 基准（`/tmp/bench-tree.mjs`，真实路由 handler + 用户真实 27 个工作区路径的 git 仓 + 3753 条会话；宿主两路列举各模拟 250 ms）

| 场景 | 旧（HEAD） | 新 |
| --- | --- | --- |
| 冷启动首个请求 | 1473 ms | 562 ms |
| 无变化的后续请求 | ~520 ms，200 + 600 KB | ~10 ms，304 无体 |
| 5 个并发请求 | 575 ms，列举 12+12 次 | 21 ms，列举 1+1 次 |

客户端 `buildRows`（真实 `/tree` 载荷）3–8 ms；「最近」从 100 行降到默认 5 行，总行数 234 → 140。

### 5.4 未执行 / 限制

- **服务端改动需宿主重启**才加载（插件以 link 方式装在 web profile）；本会话运行在该宿主内，未重启，GUI 上服务端效果**未验证**。
  客户端改动（实时叠加、渐进展开、reload 调度）在刷新页面后生效；旧服务端无 ETag 时客户端自动按 200 处理（兼容）。
- GUI 人工复验（未执行）：① 新建会话立即出现；② 终端 `git worktree add` 后 ≤5 s 出现；③ 展开 5→10→20、收起、折叠清零；④「最近」超过 100 条可展开。
- 会话缓存的残余收敛窗口：无任何 `session/event` 的纯磁盘变化最迟 30 s；git 指纹覆盖不到的变化最迟 5 min。

## 6. 结果与后续

- 完成需求全部验收项的自动化部分。
- 已提交：`4e6e744`（10-29 最近按活动排序）、`7946824`（perf）、`85e906a`（渐进展开）；按用户决定未关联 Issue-ID。

## 7. 追加（同日）：会话行组件 memo 化

- **需求来源**：用户在 whats-next 选择「会话行组件 memo 化，降低高频快照下的渲染开销」。
- **问题**：侧栏订阅 `useSessions` / `useSessionStatus` 等高频快照，任何一次变化都让 `SidebarBrowserInner`
  整体重渲染；`withLiveState` 每次浅拷贝行对象、处理器每次新建闭包 ⇒ 全部会话行重绘。
- **方案**：
  - 新增 `src/row-memo.ts`：`sessionRowPropsEqual`（行字段逐个 `Object.is`、拖拽只比 `draggable/dragging/marker`、
    `t` / `handlers` / `rowKey` 引用比较）与 `shallowEqualRecord`。
  - `sidebar.tsx`：渲染体改名 `SessionRowViewInner`，`const SessionRowView = memo(SessionRowViewInner, sessionRowPropsEqual)`；
    处理器（打开 / 右键菜单 / 四个拖拽事件）**不进 props**，父组件每次渲染把 `rowKey → 处理器` 表写进稳定的
    `sessionHandlersRef`，行内事件触发时经 `props.handlers.current.get(props.rowKey)` 取最新实现
    （避免 memo 跳过重绘后调用到持有陈旧 `drag` / `dropTarget` 的闭包）。
  - `src/client-shims.d.ts` 声明 `memo`。
- **取舍**：容器行（项目 / worktree / history，数量少、动作按钮闭包多）暂不 memo。
- **验证**：
  - Red：`node --test test/row-memo.test.mjs` ⇒ `ERR_MODULE_NOT_FOUND lib/row-memo.js`；
    `test/sidebar-perf-wiring.test.mjs` 新增 2 条 ROW-MEMO 用例 ⇒ 2 失败。
  - Green：row-memo 5/5；wiring 8/8。`test/sidebar-wiring.test.mjs` 中 2 条用例的查找目标由 `SessionRowView`
    改为 `SessionRowViewInner`（渲染体改名，断言强度不变）。
  - `npm run typecheck` 通过；`npm test` 552/552 通过（含 render-smoke 用真实 React 渲染 memo 组件）。
  - 未执行：浏览器内的重绘次数实测（无浏览器自动化环境）；需刷新 GUI 人工确认点击 / 右键 / 拖拽会话行正常。
