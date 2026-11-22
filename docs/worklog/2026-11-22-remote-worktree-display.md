# 工作记录：dsh remote 控制远端机器 B 时侧栏切换显示机器 B 的 Worktree 工作区树

- **日期**：2026-11-22
- **主题**：修复 `ds-harness-remote` 远程控制机器 B 时，侧栏仍显示本地机器工作区树而非机器 B 的 worktree 工作区树的问题
- **状态**：已完成

---

## 1. 目标与范围

### 1.1 背景与根因

当机器 A 与机器 B 均安装了 `dsh-worktree-groups` 与 `ds-harness-remote`（`dsh remote`），且机器 A 通过 `ds-harness-remote` 切换到远程控制机器 B（`dshRemoteClient.status().mode === 'remote'`）时：

1. **宿主网关已切至远端，但插件自建 HTTP 路由仍读本地服务**：
   - `ds-harness-remote` 在机器 A 上通过 `TypertGatewaySwitch` 将 `ctx.typertGateway`（`invoke` / `stream` / `dispatchRpc` / `openWireStream`）切换到机器 B，并在机器 A 的 Cordis 上下文提供 `ctx.dshRemoteClient`（`ClientModeRuntime`），在机器 B 的 Cordis 上下文提供 `ctx.dshRemote`（`HostPluginRuntime`）。
   - 关闭本插件时，官方 `@deepseek-ai/dsh-client-ui-workspace` 消费 `useWorkspaces` / `useSessions`（底层经 `ctx.typertGateway` 转发至机器 B），因此能显示机器 B 的工作区。
   - 开启本插件时，浏览器端 `src/sidebar.tsx` 请求机器 A 本地 `ctx.webServer` 上的 `POST /dsh-worktree-groups/*`（`tree` / `worktree-create` / `worktree-remove` / `reveal` / `workspace-open`）；而 `src/routes.ts` 始终无条件读取机器 A 本地的 `ctx.workspaceRegistry`、`ctx.sessionPersistence`、`ctx.sessionController`、本地磁盘 `git worktree list` 与本地 `~/.dsh/worktree-groups.json` 台账，导致侧栏始终停留在机器 A 的工作区树。
2. **客户端 `useWorkspaces` 快照变更未接入防抖重取依赖**：
   - `src/sidebar.tsx` 虽调用了 `sources.workspaces(identity)` 订阅工作区快照，但未将其签名纳入 220 ms 防抖重取 `useEffect` 的依赖数组，远端工作区基线到达或切换时不会主动触发 `reload()`。

### 1.2 目标与验收标准

- **AC1（远端插件直连转发，Tier 1）**：当机器 B 也运行支持远程路由的 `dsh-worktree-groups` 时，机器 B 的 `dsh-worktree-groups` 在 `ctx.dshRemote`（`HostPluginRuntime`）的已认证对等连接路由器上响应 `plugin.route.call`（`route: 'dsh-worktree-groups'`）；机器 A 处于 `dshRemoteClient.status().mode === 'remote'`（`backend === 'harness'`）时，`/dsh-worktree-groups/*`（`tree` / `worktree-create` / `worktree-remove` / `reveal` / `workspace-open`）直接转发至机器 B 执行并返回机器 B 的完整 git worktree 树与操作结果。
- **AC2（远端网关回退推导与首拉性能，Tier 2）**：当机器 B 尚未升级到含 Tier 1 钩子的版本（或返回 `INVALID_MESSAGE` / `METHOD_NOT_FOUND` / `FEATURE_NOT_SUPPORTED`，或处于 Codex/ACP 虚拟远端工作区模式）时，机器 A **绝不回退读取机器 A 本地工作区**，而是通过已切换到远端的 `ctx.typertGateway` 拉取机器 B 的 `workspace/follow` 基线、`session/list` 会话列表，并结合 `directoryPicker/list` 与 `workspaceFiles/read` 探测机器 B 上的 `.git` 主工作树、`.git/worktrees/*` 关联 worktree 与分支信息，按相同 `buildProjects` / `collectUngrouped` 规则推导并以 worktree 树展示机器 B 的工作区与会话；`workspace-open` 走远端 `workspace/create`。
  - **Tier 2 首拉预算与防挂起要求**：
    1. **禁止遍历无关会话 `cwd`**：仅对已注册远端工作区（`workspaces[*].path`）以及由关联 worktree `.git` 文件逆推的主仓路径执行目录探测，不逐个遍历全部历史会话的 `cwd`（避免远端有数百个会话时产生百次串行跨网 RPC 导致首拉卡在「正在加载工作区…」）。
    2. **主树 ↔ 关联 worktree 命名启发式免 RPC 归并**：当已注册工作区集合中既有主工作树（如 `/path/to/Repo`）又有关联 worktree（如 `/path/to/worktrees/Repo-branch` 或 `/path/to/Repo-branch`，满足 `looksLikeWorktreeOf` 或 `basename` 前缀 `<RepoName>-<branch>`）时，即使主工作树/关联工作树下暂时没有活跃会话可供 `workspaceFiles/read` 读取 `.git/worktrees/*/gitdir`，也能直接把关联 worktree 归并到该主工作树下并提取分支名，不退化为几十个散落平铺项目。
    3. **并发池、单次调用超时与进程内缓存**：远端 `workspace/follow`、`session/list`、`directoryPicker/list`、`workspaceFiles/read` 均须带独立超时保护（避免远端流未就绪时永久挂起 `treeFlight`），目录探测并发执行并按 `(targetKey, workspaceSignature)` 缓存 repo 扫描结果（TTL 内零重复跨网探测）。
    4. **Tier 1 负缓存**：当机器 B 尚未升级插件返回 `INVALID_MESSAGE` 等不支持错误时，在当前连接周期内记住 Tier 1 不可用（60 s 负缓存或切换目标时重置），避免每次轮询多耗费一次必败 RPC。
- **AC3（本地与远端状态隔离）**：远程模式下不得读写或污染机器 A 本地的 `~/.dsh/worktree-groups.json` 台账，不得在机器 A 本地执行 D18 `sweepDeadWorkspaces` 删除本地工作区；本地与不同远端设备之间的会话缓存、扫描缓存及 `/tree` ETag 互不串台（切换 `local` ↔ `remote` 不会误命中 `304 Not Modified`）。
- **AC4（客户端工作区快照变化触发重取 & 远端目录选择器兜底）**：`src/sidebar.tsx` 从 `sources.workspaces(identity)` 派生工作区快照签名并接入 220 ms 防抖重取 `useEffect`（不进入 `reload` 的 `useCallback` 依赖以免重置轮询定时器）；`src/client.tsx` 在远程激活态（`html.dshRemoteTargetActive`）下跳过本机 Electron `desktopPicker`，使添加工作区回退路径输入弹窗。
- **AC5（零回归）**：本地模式（未安装 `ds-harness-remote` 或 `mode === 'local'`）行为、5 个路由 `ctx.effect` 注册契约及既有单测全部保持通过。

### 1.3 非目标

- 不修改第三方包 `ds-harness-remote` 源码或宿主安装包。
- 不改变 `RenderRow` 冻结字段集合与 `tree-model.ts` 的树推导纯函数契约。

---

## 2. 设计决策

1. **双层远程架构（Tier 1 + Tier 2）**：
   - **Tier 1（Host-to-Host `dsh-worktree-groups` 路由桥）**：
     - 机器 B 端：`registerRoutes(ctx)` 调用 `attachRemoteHostBridge(ctx)`（不调用 `ctx.effect`，保持 5 个路由 effect 注册契约不变），在检测到 `ctx.dshRemote`（`HostPluginRuntime`）或收到 `internal/service` 的 `'dshRemote'` 事件时，幂等包装 `dshRemote.connections.createRouter` 与 `connections.active` 中各连接路由器的 `pluginRoute.call` / `router.handle`，仅拦截 `route === 'dsh-worktree-groups'`，在机器 B 本地以 `{ forceLocal: true }` 调用 `buildTreePayload` / `archiveWorkspaceProject` / `unarchiveWorkspaceProject` / `handleWorktreeCreate` / `handleWorktreeRemove` / `handleReveal` / `workspace-open`。
     - 机器 A 端：当 `dshRemoteClient.status().mode === 'remote'` 且 `backend === 'harness'` 时，优先通过 `tryCallRemotePluginRoute(ctx, endpoint, body)` 转发至机器 B。
   - **Tier 2（基于远端 Typert Gateway 的无侵入回退）**：
     - 若机器 B 上的 `dsh-worktree-groups` 尚未升级 Tier 1 桥（`plugin.route.call` 拒绝 `route: 'dsh-worktree-groups'`）或处于虚拟工作区模式，机器 A 通过已切到远端的 `ctx.typertGateway`：
       1. 读取 `workspace/follow` 首帧 `baseline` 获取机器 B 的 `workspaces` 与 `archivedSessionIds`；
       2. 调用 `session/list`（`{ _request: {} }`）获取机器 B 的会话列表；
       3. 通过 `directoryPicker/list` 与 `workspaceFiles/read`（优先复用落在该工作区或主仓下的会话 `sessionId` 作为 `workspaceFileScopeId` 读取 `.git`、`.git/HEAD`、`.git/worktrees/<name>/gitdir`、`.git/worktrees/<name>/HEAD`，无会话时结合 `directoryPicker/list` 枚举 `.git/worktrees/*` 与同父目录兄弟目录）还原机器 B 的 `RepoInfo`（`commonDir`、`mainPath`、`worktrees`）；
       4. 使用按远端 `targetKey`（`remote:<deviceId>:<backend>`）隔离的内存台账（`remoteLedgerStore`）合成 `TreePayload`，并跳过本机 D18 `sweepDeadWorkspaces`。
2. **ETag 与客户端工作区联动**：
   - `/tree` 的 `treeFlight` 在计算 ETag 时以 `${remoteState.targetKey}\u0000${body}` 计算 SHA-1，确保从 `remote` 切回 `local`（或切换不同远端主机）时绝不会误命中 `304 Not Modified`。
   - `src/sidebar.tsx` 从 `sources.workspaces(identity)` 派生 `workspacesSignature`，并将其加入 220 ms 防抖重取 `useEffect` 的依赖数组（不加入 `reload` 的 `useCallback` 依赖），使 `dsh remote` 切换工作区快照时立即触发 `/tree` 刷新。
   - `src/client.tsx` 在 `document.documentElement.classList.contains('dshRemoteTargetActive')` 为真时跳过本机 Electron `globalThis.__DSH_DIRECTORY_PICKER__`，避免远程模式下误弹本机原生目录选择框。

---

## 3. 代码与文档变更清单

- **实现文件**：
  - `src/routes.ts`：新增 Tier 1 远端插件路由桥（`attachRemoteHostBridge` / `wrapRemoteHostRouter` / `dispatchLocalWorktreePluginCall` / `tryCallRemotePluginRoute`）、Tier 2 远端网关快照收集与 git worktree 探测（`collectRemoteGatewaySnapshot` / `readRemoteGatewayWorkspaces` / `readRemoteGatewaySessions` / `scanRemoteGatewayRepos` / `openRemoteGatewayWorkspace`）、远端内存台账隔离（`remoteLedgerStore`）与 `/tree` ETag `targetKey` 隔离。
  - `src/sidebar.tsx`：从 `sources.workspaces(identity)` 派生 `workspacesSignature` 并接入 220 ms 防抖重取 `useEffect`。
  - `src/client.tsx`：在 `dshRemoteTargetActive` 激活时跳过本机 `desktopPicker`。
- **测试文件**：
  - `test/routes.test.mjs`：新增 `§11 AC1`（Tier 1 远端插件直连转发与切换 local ETag 不串台）、`§11 AC2/AC3`（Tier 2 远端网关回退还原 git worktree 树 + 本地台账与 D18 清扫隔离）与 `§11 AC2-perf`（Tier 2 大量历史会话下不遍历无关会话 `cwd`、无会话可读 `gitdir` 时的 `<MainRepo>-<branch>` 命名启发式归并、Tier 1 负缓存与 Tier 2 扫描缓存）。
  - `test/sidebar-perf-wiring.test.mjs`：新增 `REMOTE-AC4`（`workspacesSignature` 接入防抖重取依赖且不进入 `reload` `useCallback` 依赖，`client.tsx` 在 `dshRemoteTargetActive` 下跳过本机 `desktopPicker`）。
- **文档更新**：
  - `docs/INTERFACES.md`（§1.5 补充远程控制模式契约）
  - `docs/README.md`（工作记录索引更新）
  - `docs/knowledge/l3-components/Routes-路由注册与契约技术文档.md`
  - `docs/knowledge/l3-components/Routes-快照组装与台账技术文档.md`

---

## 4. TDD 验证记录（Red → Green）

1. **Red 阶段**：
   - 运行 `node --test --test-name-pattern="§11|REMOTE-AC4" test/routes.test.mjs test/sidebar-perf-wiring.test.mjs`，新增测试均按预期失败（`REMOTE-AC4` 因未派生 `workspacesSignature` 失败；`§11 AC1` 与 `§11 AC2/AC3` 因返回机器 A 本地 `fixtureA.repo` 而非机器 B 的 `fixtureB.repo` 失败；`§11 AC2-perf` 因逐个遍历 200 个无关会话 `cwd` 发起跨网 `directoryPicker/list` 失败）。
2. **Green & 全量回归阶段**：
   - 完成 `src/routes.ts`、`src/sidebar.tsx`、`src/client.tsx` 实现后：
     - `npm run typecheck`：退出码 0，无类型错误。
     - `npm run build`：退出码 0，服务端与客户端产物构建成功。
     - `npm test`：558 项测试中 554 项通过、0 项失败、4 项跳过（宿主外部依赖哨兵）。
