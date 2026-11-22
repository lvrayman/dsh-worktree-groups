# 接口契约（冻结）

> 本文件是模块边界与函数签名的**唯一真源**。实现者必须遵守；如需变更，先在此文件改并说明理由。
> 配套：`docs/PRD.md`（需求与决策）、`docs/HOST-CONTRACTS.md`（宿主契约调研结论）。

## 0. 文件所有权（避免多写者冲突）

| 文件 | 所有者任务 | 说明 |
|---|---|---|
| `package.json` `tsconfig.json` `cordis.patch.yml` `scripts/build-client.mjs` `.gitignore` `README.md` | **T0** | 脚手架，T0 完成后仅 T8 可追加 README 内容 |
| `src/types.ts` `src/git.ts` `src/projects.ts` | **T1** | 宿主核心：git 扫描 + 项目模型 |
| `src/ledger.ts` | **T2** | 台账持久化 |
| `src/routes.ts` `src/index.ts` | **T3** | HTTP 路由 + 宿主入口 |
| `src/tree-model.ts` `src/locales.ts` | **T4** | 客户端纯逻辑（可单测） |
| `src/sidebar.tsx` `src/client.tsx` | **T5** | 客户端 UI + 槽位注册 |
| `test/*.test.mjs` | **T6** | 独立测试（每人只写自己那份文件） |

**规则**：任何时刻一个文件只有一个写者。T3 依赖 T1+T2 完成；T5 依赖 T4 的接口（接口本文件已冻结，可并行开工，T5 不得修改 `tree-model.ts`）。

## 1. 宿主半边

### 1.1 `src/types.ts`

```ts
/** 一条 git worktree 记录（来自 `git worktree list --porcelain`）。 */
export interface WorktreeEntry {
  /** 绝对路径，已归一为 POSIX 分隔符、无尾斜杠。 */
  path: string
  /** 检出的分支短名（如 "feature/ohos"）；detached 时为 undefined。 */
  branch?: string
  /** HEAD commit sha。 */
  head?: string
  /** 是否为主工作树（origin repo 本身）。 */
  isMain: boolean
  /** bare 仓条目。 */
  bare: boolean
  /** 扫描时目录是否存在（false ⇒ 已关闭 ⇒ 会话进 history 桶）。 */
  exists: boolean
}

/** 一个 git 仓的事实（按 common dir 去重后）。 */
export interface RepoInfo {
  /** 共享 .git 目录的绝对路径 —— 仓库身份键。 */
  commonDir: string
  /** 主工作树绝对路径。 */
  mainPath: string
  /** 全部 worktree，主树在首位。 */
  worktrees: WorktreeEntry[]
}

/**
 * 一个 dsh 工作区（宿主持久记录的投影）。
 *
 * **D13**：字段里**没有** `sessionIds`。宿主的 `sessionIds` 是会实时过滤的 getter
 * （§2.7 裁定 6 明文禁止用它做归属判定），本包无任何消费者，故不再投影 ——
 * 裁定 6 因此从「靠注释约束」升级为「靠类型约束」。
 */
export interface WorkspaceRow {
  workspaceId: string
  path: string
  title: string
  createdAt: string
  updatedAt: string
}

/** 一个会话行（宿主 sessions 快照的投影）。 */
export interface SessionRow {
  sessionId: string
  updatedAt: number
  /**
   * 会话**最后更新时间**：`max(updatedAt, 宿主 session/event 记录的最大 event.time)`，恒为有限数字且
   * `>= updatedAt`。由 `src/activity.ts` 在 `buildSessionRows` 末尾补齐，并沿 `parentSessionId`
   * 把子代理活动传播到祖先。**只有「最近」分区消费它做排序**（§2.3.3）；工作区树/手动顺序不变。
   */
  lastActivityAt: number
  running: boolean
  blank: boolean
  cwd?: string
  parentSessionId?: string
  origin?: 'subagent'
  pendingInteraction?: string
  completed?: boolean
  title?: string
}

/** 侧栏树的一个 worktree 节点。 */
export interface WorktreeNode {
  path: string
  branch?: string
  isMain: boolean
  exists: boolean
  /** 已注册的 dsh 工作区 id；未注册为 undefined（懒注册）。 */
  workspaceId?: string
  title: string
  sessions: SessionRow[]
}

/** 侧栏树的一个项目节点 = 一个 git common dir（或一个非 git 工作区）。 */
export interface ProjectNode {
  /** commonDir；非 git 工作区用 `ws:<workspaceId>`。 */
  key: string
  isGit: boolean
  title: string
  mainPath?: string
  worktrees: WorktreeNode[]
  /** 已关闭 worktree 的会话（history-worktree-session 桶）。 */
  history: SessionRow[]
  /** **非 git 工作区**（唯一走 flat 容器的形态）：会话直接挂项目下。 */
  flatSessions: SessionRow[]
}
```

### 1.2 `src/git.ts`

```ts
/** 跑一条 git 命令，返回 stdout（trim 掉尾换行）。非零退出码时 reject。 */
export function runGit(cwd: string, args: string[], signal?: AbortSignal): Promise<string>

/** 同 runGit，但任何失败都返回 null（用于探测，不抛错）。 */
export function runGitSafe(cwd: string, args: string[], signal?: AbortSignal): Promise<string | null>

/** 解析 `git worktree list --porcelain` 输出。mainPath 由调用方给出（第一个条目即主树）。 */
export function parseWorktreeList(porcelain: string): WorktreeEntry[]

/** 归一化路径：绝对化、POSIX 分隔符、去尾斜杠（根路径除外）。 */
export function normalizePath(p: string): string

/** 解析仓库的 common dir（`git rev-parse --git-common-dir`），非 git 仓返回 null。 */
export function resolveCommonDir(repoPath: string, signal?: AbortSignal): Promise<string | null>

/** 解析主工作树路径（`git rev-parse --show-toplevel`），非 git 仓返回 null。 */
export function resolveToplevel(repoPath: string, signal?: AbortSignal): Promise<string | null>

/** 完整扫描一个仓：common dir + 主树 + 全部 worktree + 逐条目录存在性。非 git 仓返回 null。 */
export function scanRepo(repoPath: string, signal?: AbortSignal): Promise<RepoInfo | null>
```

**实现要求**
- 用 `execFile`（数组参数，**不经 shell**），`maxBuffer` 给足（≥ 8 MiB）。
- git 可执行文件：先 `git`，失败依次退 `/usr/bin/git`、`/usr/local/bin/git`、`/opt/homebrew/bin/git`（macOS 场景）。
- `exists` 用 `fs.stat` 判定，**不要**用 `git worktree list` 的输出推断（已 rm -rf 的 worktree 仍会出现在列表里）。

### 1.3 `src/projects.ts`

```ts
/** 归一化路径（复用 git.ts 的实现，此处再导出便于纯逻辑测试）。 */
export { normalizePath } from './git.js'

/**
 * 路径启发：`deadPath` 看起来像 `mainPath` 的 worktree 吗？
 * 规则：父目录相同 && basename(deadPath) 以 basename(mainPath) 开头且更长。
 * 例：/a/b/LogAnalyst-toolbar-refactor 与 /a/b/LogAnalyst ⇒ true
 *     /a/b/Other 与 /a/b/LogAnalyst ⇒ false
 *     /a/b/LogAnalyst 与 /a/b/LogAnalyst ⇒ false（自身不算）
 */
export function looksLikeWorktreeOf(deadPath: string, mainPath: string): boolean

export interface BuildProjectsInput {
  workspaces: WorkspaceRow[]
  /** 按 commonDir 索引的仓事实。 */
  repos: Record<string, RepoInfo>
  /** 工作区路径 → commonDir（非 git 工作区不在表里）。 */
  repoByWorkspacePath: Record<string, string>
  ledger: import('./ledger.js').LedgerData
  /** 全部会话（含 cwd 已死的）。 */
  sessions: SessionRow[]
  archivedSessionIds: string[]
}

/**
 * 把工作区 + 仓事实 + 台账 + 会话合成侧栏树。**纯函数**：不做 IO、不读时间以外的全局状态。
 *
 * 归属规则（按优先级）：
 *  1. 会话 cwd 命中某个「存在的 worktree 路径」⇒ 归该 worktree；
 *  2. 会话 cwd 命中某个「已注册工作区路径」⇒ 归该工作区对应的 worktree；
 *  3. 会话 cwd 命中台账 sessions[sessionId] 记录的 worktreePath，且该路径已不存在
 *     ⇒ 归该项目 history 桶；
 *  4. 会话 cwd 不存在的目录，且能被某项目 mainPath 用 looksLikeWorktreeOf 匹配
 *     ⇒ 归该项目 history 桶；
 *  5. 其余 ⇒ 进「未分组」（不在 ProjectNode 里，由调用方另行处理）。
 *
 * 排序：worktree 主树在前、其余按分支名 localeCompare；会话按 updatedAt 降序。
 */
export function buildProjects(input: BuildProjectsInput): { projects: ProjectNode[]; ungrouped: SessionRow[] }

/** 从全部会话中挑出既无 worktree 归属、又无项目归属的（规则 5）。 */
export function collectUngrouped(input: BuildProjectsInput, projects: ProjectNode[]): SessionRow[]
```

### 1.4 `src/ledger.ts`

```ts
export interface LedgerWorktree {
  branch?: string
  firstSeenAt: number
  /** 最近一次被 git 列表看到的时刻。 */
  lastSeenAt: number
  /** 首次被发现已消失的时刻（>= lastSeenAt）。 */
  goneAt?: number
}

export interface LedgerProject {
  /** 主工作树路径（便于 commonDir 变化时兜底）。 */
  mainPath: string
  /** worktree 路径（归一化）→ 记录。 */
  worktrees: Record<string, LedgerWorktree>
}

export interface LedgerSessionOwner {
  /** 项目键（commonDir）。 */
  projectKey: string
  worktreePath: string
}

export interface LedgerData {
  version: 1
  projects: Record<string, LedgerProject>
  /** sessionId → 归属快照（用于目录消失后的归位）。 */
  sessions: Record<string, LedgerSessionOwner>
}

export interface LedgerStore {
  read(): Promise<LedgerData>
  write(data: LedgerData): Promise<void>
  /** 读-改-写，串行化（内部锁），回调返回同一引用则跳过写盘。 */
  update(fn: (data: LedgerData) => LedgerData): Promise<LedgerData>
}

export function emptyLedger(): LedgerData

/** 默认介质：`<homeDir>/worktree-groups.json`，临时文件 + rename 原子写。homeDir 默认 defaultDshHome()。 */
export function createFileLedger(homeDir?: string): LedgerStore

/** 文件损坏 / 版本不符时返回空台账并备份坏文件为 `.bad-<ts>`，不抛错。 */
```

**实现要求**
- 写盘：写 `<file>.tmp` → `fsync` → `rename`（同目录，原子）；权限 `0o600`。
- `update` 内部串行化：任一时刻只有一次读-改-写在飞。
- 读失败（文件不存在）⇒ `emptyLedger()`，不抛。JSON 解析失败 ⇒ 备份坏文件 + 返回空台账。

### 1.5 `src/routes.ts`

```ts
import type { Context } from '@deepseek-ai/cordis'

/** 注册全部 HTTP 路由。前缀统一 `/dsh-worktree-groups/`。 */
export function registerRoutes(ctx: Context): void

/** 归档一个工作空间（2026-10-21 WSR1/WSR2，AC7）。由 `POST /tree` 的 `archiveProjectKey` 调用。 */
export async function archiveWorkspaceProject(
  ctx: Context,
  projectKey: string,
  options?: SnapshotOptions,
): Promise<{ ok: boolean; archivedProjects: Record<string, LedgerArchivedProject> }>

/** 放出已归档工作空间（按 `projectKey` 或 `path`）。由 `POST /tree` 的 `unarchiveProjectKey` / `unarchivePath` 调用。 */
export async function unarchiveWorkspaceProject(
  ctx: Context,
  target: { projectKey?: string; path?: string },
  options?: SnapshotOptions,
): Promise<{ ok: boolean; unarchivedKeys: string[] }>
```

| 方法 | 路径 | 请求体 | 响应 |
|---|---|---|---|
| POST | `/dsh-worktree-groups/tree` | `{ archiveProjectKey?, unarchiveProjectKey?, unarchivePath? }`（全部可选，省略即纯查询） | `{ ok: true, projects: ProjectNode[], ungrouped: SessionRow[], archivedSessionIds: string[], workspaceByPath: Record<string,string>, archivedProjects: ArchivedProjectRow[] }` / `{ ok:false, message }` |
| POST | `/dsh-worktree-groups/worktree-create` | `{ repoPath, branch, createBranch, baseRef?, targetPath? }` | `{ ok: true, worktreePath, workspaceId?, workspaceWarning? }` / `{ ok:false, message }` |
| POST | `/dsh-worktree-groups/worktree-remove` | `{ path, force? }` | `{ ok:true }` / `{ ok:false, needsForce:true, message }` |
| POST | `/dsh-worktree-groups/reveal` | `{ path }` | `{ ok:true }`（macOS `open -R`，其它平台降级为 `open`/`xdg-open`） / `{ ok:false, message }` |
| POST | `/dsh-worktree-groups/workspace-open` | `{ path }` | `{ ok:true, workspaceId }` —— 幂等 create，用于 directoryFlow 之外的场景（同时自动解除同目录已归档工作空间） |

**`tree` 承载归档 / 放出动作（2026-10-21 WSR1/WSR2，AC7/AC8）**
- **不新增独立路由**：归档与放出复用 `POST /dsh-worktree-groups/tree`，通过可选请求体字段触发，
  因此 `ROUTE_PATHS` 始终只有上述 **5 个**路由路径（`tree` / `worktree-create` / `worktree-remove` /
  `reveal` / `workspace-open`）。
- 请求体字段语义：
  - `archiveProjectKey`：把该 `projectKey` 写入台账 `archivedProjects`，由导出函数
    `archiveWorkspaceProject(ctx, projectKey)` 实现（保留宿主 `workspaceRegistry` 记录不销毁）；
  - `unarchiveProjectKey` / `unarchivePath`：按 `projectKey` 或路径（项目的 `mainPath` /
    `worktrees[*].path` / 非 git 工作区 `path`，含 `realpath` 与同 git 仓 worktree 路径匹配）
    从 `archivedProjects` 移除，由导出函数 `unarchiveWorkspaceProject(ctx, { projectKey?, path? })` 实现。
  两者可同时出现；任一命中即先执行动作，再返回**动作之后**的完整树载荷（`ok: true` 与上表响应同形）。
- 响应额外含 `archivedProjects: ArchivedProjectRow[]`（按 `archivedAt` 降序）；`projects` 已排除已归档
  工作空间，其会话不落入 `ungrouped`。
- 动作失败返回 `{ ok:false, message }`（HTTP 400），不会静默丢弃。
- 客户端另有 `localStorage` 键 `dsh-worktree-groups.archivedProjects` 与服务端台账**双写同步**：
  即使宿主进程尚未重启，点击「归档工作空间」/ 设置页「放出」也能立即生效并跨刷新保持。
- **2026-10-29 起**：响应里的每条 `SessionRow` 额外带 `lastActivityAt`（见 §1.1 与 §1.7）；
  旧客户端忽略该字段即可，载荷其余结构不变。

**性能契约（2026-11-14 PERF1–PERF4，见 [设计](design/2026-11-14-perf-progressive-expand.md)）**
- `/tree` 响应头带 `etag`（`"<sha1 base64url>"`）与 `cache-control: no-cache`；请求头 `if-none-match`
  与当前 ETag 相等 ⇒ **304 无响应体**。
- 路由内部用合并器计算：在途时到达的请求共享**下一次**计算（结果一定反映请求到达前的状态）。
- `SnapshotOptions.reuseSessions?: boolean`：为真时会话行走进程内缓存（活动版本号、活会话 id 签名、
  `SESSION_ROWS_MAX_AGE_MS = 30_000` 三者共同校验）；只有路由层开启，导出函数缺省关闭。
- git 扫描缓存由仓指纹校验，`SCAN_CACHE_MAX_AGE_MS = 300_000` 兜底；`SCAN_CACHE_TTL_MS` 仅保留导出、不再参与判定。
- 台账 `lastSeenAt` 按 `LEDGER_LAST_SEEN_REFRESH_MS = 3_600_000` 节流；`clearScanCache()` 清空全部进程内缓存。
- `src/activity.ts` 新增 `sessionActivityVersion(): number`（每观测一次 `session/event` +1，只增不减）。

**远程控制模式契约（2026-11-22，`ds-harness-remote` 协同，见 [工作记录](worklog/2026-11-22-remote-worktree-display.md)）**
- 当本机安装并启用了 `ds-harness-remote` 且 `ctx.get('dshRemoteClient')?.status?.()?.mode === 'remote'` 时，本机正远程控制目标机器 B：
  1. **Tier 1（远端插件直连转发 + 负缓存）**：若机器 B 也加载了支持远程路由桥的 `dsh-worktree-groups`（机器 B 在 `ctx.dshRemote.connections` 的对等连接路由器上拦截 `plugin.route.call` 中 `route === 'dsh-worktree-groups'` 的请求），机器 A 的 5 个 `/dsh-worktree-groups/*` 路由（`tree` / `worktree-create` / `worktree-remove` / `reveal` / `workspace-open`）优先通过 `dshRemoteClient.pluginRoute('dsh-worktree-groups', { endpoint, payload })`（或 `activeRemote().client.rpc('plugin.route.call', ...)`）直接转发到机器 B 的 `dsh-worktree-groups` 执行。当机器 B 返回不支持错误（如 `INVALID_MESSAGE`）时，在 `targetKey` 下记录 60 s 负缓存避免重复必败 RPC。
  2. **Tier 2（远端网关回退推导 + 并发/超时/缓存/命名启发式归并）**：若机器 B 的 `dsh-worktree-groups` 尚未升级到支持 Tier 1 的版本或处于 Codex/ACP 虚拟工作区模式，机器 A 通过已切换到远端的 `ctx.typertGateway` 读取机器 B 的 `workspace/follow` 基线、`session/list` 会话列表，并结合 `directoryPicker/list` 与 `workspaceFiles/read` 探测机器 B 的 `.git` 主树与 `.git/worktrees/*` 关联 worktree（仅探测已注册工作区与反推主仓，不遍历无关历史会话 `cwd`；支持 `<RepoName>-<branch>` 兄弟/worktrees 目录命名启发式归并；带单次 RPC 超时、并发池与按 `(targetKey, workspaceSignature)` 的进程内扫描缓存），按同一 `buildProjects` / `collectUngrouped` 规则合成机器 B 的 `TreePayload`；`workspace-open` 调用远端 `workspace/create`。
  3. **状态隔离**：远程模式下不读写机器 A 本地的 `~/.dsh/worktree-groups.json` 台账，不在机器 A 本地执行 D18 `sweepDeadWorkspaces`；`/tree` 的 ETag 与缓存按目标身份（`local` vs `remote:<deviceId>:<backend>`）隔离，切换模式不会误返回 `304 Not Modified`。
- 客户端 `src/sidebar.tsx` 将 `sources.workspaces(identity)` 派生的工作区快照签名纳入 220 ms 防抖重取 `useEffect` 依赖，使远端工作区基线到达或切换时自动触发 `reload()`。

**`worktree-create` 的部分成功语义（D10）**
- `ok:true` 只表示 **worktree 已建成**。`workspaceId` 仍可能缺省 —— 此时注册工作区失败，
  不会有自动新会话，故用 `workspaceWarning`（可选，字符串）把失败原因带给调用方。
- 客户端**必须**在拿到 `workspaceWarning` 时给出**可见但不阻塞**的提示，并且
  **仍走成功分支**（reload + 尝试 `startSession`）。

**安全边界（硬要求）**
- `worktree-remove` 的 `path` 必须命中「已知 worktree 集合」（git 扫描结果 ∪ 台账 ∪ 工作区路径），否则拒绝。
- `worktree-create` 的 `repoPath` 必须是已注册工作区路径（或已扫描出的 git 仓路径）。
- **`reveal` 的 `path` 必须命中「已知集合」= `knownWorktreePaths ∪ knownRepoPaths`**（与
  `worktree-remove` 同级；同样覆盖「已注册工作区路径」——`collectSnapshot` 会把它们补进
  `knownWorktreePaths`）。理由：该端点会把路径交给外部进程（`open -R` / `explorer /select,`
  / `xdg-open`），若不设白名单就只是一个「任意路径存在性探针 + 文件管理器打开器」。
  未命中时返回 `{ ok:false, message }`。
- 所有路径 resolve 后必须与白名单**精确相等**（不做前缀匹配，避免越权）。
- 全部走 `execFile` 数组参数，无 shell 拼接。
- 所有 case 返回 JSON，永不抛到 HTTP 层。

### 1.6 `src/index.ts`（T3 写）

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'dsh-worktree-groups'

/**
 * 宿主半边入口。依赖（全部惰性读取，缺失时降级不崩）：
 * workspaceRegistry / sessionPersistence / webServer。
 */
export function apply(ctx: Context): void
```

### 1.7 `src/activity.ts`（2026-10-29 新增：最后更新时间）

```ts
/** 活动表容量上限（超过后按 LRU 淘汰最久未更新的一条）。 */
export const SESSION_ACTIVITY_LIMIT = 4096

/** 归一化会话 id（去掉顶层会话的 `session-` 前缀）；空/非法返回 ''。 */
export function normalizeActivitySessionId(id: unknown): string

export interface SessionActivityTracker {
  /** 记录一次活动；只保留最大值；非法 id/时间忽略；重复记录把键移到 LRU 尾部。 */
  record(sessionId: unknown, time: unknown): void
  /** 取该会话已记录的最大活动时间（归一化 id）；没有则 undefined。 */
  lastActivityAt(sessionId: unknown): number | undefined
  readonly size: number
}

export function createSessionActivityTracker(limit?: number): SessionActivityTracker

/** 进程级单例：宿主事件监听器写入，`buildSessionRows` 读取。 */
export function recordSessionActivity(sessionId: unknown, time: unknown): void
export function lastSessionActivityAt(sessionId: unknown): number | undefined
/** 测试用：清空单例活动表。 */
export function resetSessionActivity(): void

/**
 * 监听宿主 Cordis 事件 `session/event(session, event)`，把 `(session.id, event.time)` 写入单例。
 * 宿主上下文没有 `on`、监听注册抛错、事件字段缺失时**静默降级**。返回 disposer。
 */
export function registerSessionActivityObserver(ctx: Context): () => void

/** 纯函数：给一批会话行写 `lastActivityAt = max(updatedAt, 自身/后代活动时间)`。 */
export function attachLastActivityTimes(rows: SessionActivityBearing[]): void
```

接线：

- `src/routes.ts#registerRoutes` 在注册路由前调用 `registerSessionActivityObserver(ctx)`（用 `ctx.effect` 绑定释放）。
- `src/routes.ts#buildSessionRows` 在组装完 `rows` 后调用 `attachLastActivityTimes(rows)`。
- `/tree` 响应的每条 `SessionRow` 因此都带 `lastActivityAt`（旧客户端忽略该字段，向后兼容）。

## 2. 客户端半边

### 2.1 `src/locales.ts`

```ts
/** 取词函数签名（`{name}` 占位符由 `vars.name` 替换）。 */
export type Translate = (key: string, vars?: Record<string, string | number>) => string
/** 中文词条表（key 稳定，便于后续加英文表）。 */
export const zh: Record<string, string>
/** 取词函数；缺 key 时返回 key 本身（不崩）。 */
export function createT(dict?: Record<string, string>): Translate
/** 宿主 seat 的兜底包装：seat 解不出（返回 key 本身）或抛错时回落 `dict`；同一 (seat, dict) 返回同一引用。 */
export function createSeatT(seat: Translate, dict?: Record<string, string>): Translate
```

**`createSeatT` 的语义（2026-09-23 追加，逐条有测试 `test/locales.test.mjs`）**

| 输入 | 输出 | 理由 |
|---|---|---|
| seat 返回**不是** key 的字符串 | **逐字透传** | 宿主 `common` 命名空间的译文、其它语言的译文不许被我们顶掉 |
| seat 返回 key 本身（宿主 `translate` 的兜底）/ seat 抛错 | `dict[key]`（占位符照常替换）；`dict` 也没有 ⇒ key | 界面**永不**露裸 key（见下方缺陷记录） |
| 同一 `(seat, dict)` 再次调用 | **同一函数引用** | `sidebar.tsx` 里以 `t` 为依赖的 `useMemo` 不能每帧失效 |

> **缺陷记录（2026-09-23）**：宿主 `locale` 的解析规则是「本命名空间查不到 → 查 `common` → 还查不到就**返回 key 本身**」；而 entry 声明了 `locale` 就**一定**拿到 seat `t`（renderer `standardKit` → `localeSeat`），`sidebar.tsx` 的 `FALLBACK_T` 因此**永远走不到**。于是词典注册一旦错过时机（见 §2.4 的 `ctx.inject`），侧栏每个取词点都会把 key 当文案渲染 —— 用户看到的就是「右键菜单全变成英文 key」。两层修复：注册等服务出现（§2.4）+ 取词兜底（本节）。

必须覆盖的 key（最少集）：

```
section.workspaces 工作区
section.ungrouped 未分组
search.placeholder 搜索会话…
search.empty 无匹配结果
session.new 新会话
session.blank 新会话
sessions.expand 展开其余 {n} 个会话
sessions.collapse 收起
history.label history-worktree-session
worktree.main 主
worktree.create 新建 worktree…
worktree.remove 移除 worktree
worktree.creating 正在创建…
worktree.removing 正在移除…
worktree.newBranch 新建分支
worktree.useExisting 复用已有分支
worktree.branchName 分支名
worktree.baseBranch 起始分支
worktree.path 路径
worktree.pathHint 默认：<主仓父目录>/<主仓名>-<分支名>
worktree.confirm 创建
worktree.cancel 取消
worktree.removeConfirm 确定移除 worktree “{name}”？
worktree.removeKeepBranch 分支会保留，可用 git branch -d 删除。
worktree.forceRemove 强制删除（丢失未提交改动）
worktree.dirty 该 worktree 有未提交改动。
worktree.workspaceWarning worktree 已创建，但注册为工作区失败，未自动新建会话：{message}
project.add 添加工作区…（2026-09-21 起用于**侧栏顶部**的独立 `+` 按钮，不再是菜单项）
menu.newSession 新建会话
menu.reveal 在文件管理器中打开
menu.copyPath 复制路径
menu.rename 重命名
menu.archive 归档
menu.fork 派生会话
menu.removeHistory 移出 history
menu.deleteWorkspace 删除工作区
menu.resetOrder 恢复默认排序（D10 2026-09-21：清除本地手动顺序；**仅 manual === true 时出现**）
dialog.rename 重命名
dialog.renameWorkspace 重命名工作区
dialog.renameSession 重命名会话
dialog.confirm 确定
dialog.cancel 取消
error.title 侧栏渲染出错
error.retry 重试
error.load 加载失败
state.loading 加载中…
a11y.runningTask 有任务正在运行
section.recent 最近
menu.archiveWorkspace 归档工作空间
settings.archivedWorkspaces.title 已归档的工作空间
settings.archivedWorkspaces.description 归档后的工作空间及其会话不在侧栏显示，可在此放出恢复，或重新添加相同目录自动放出
settings.archivedWorkspaces.empty 暂无已归档的工作空间
settings.archivedWorkspaces.restore 放出
```

> **2026-10-20 additive 修订**：新增 `a11y.runningTask` = 「有任务正在运行」，
> 是容器行运行中高亮的 `title` 文案（见 §2.3「运行中任务高亮」）。
> **2026-10-21 additive 修订**：新增 `section.recent`、`menu.archiveWorkspace` 与 `settings.archivedWorkspaces.*` 词条（见 WSR1/WSR2/WSR6）。

### 2.2 `src/tree-model.ts`

> **导出契约索引（T15 补录）**：下面的 `ts` 代码块是**逐字冻结的接口清单**，但历史上漏收了
> 若干**真实导出**。T15 已补录 `truncateSessions`（见本节末「补录：`truncateSessions` 导出契约」）。
> **全量真实导出清单以 `lib/tree-model.d.ts` 为准**（`npm run build` 产物）。

**冻结的渲染行类型**（组件只负责把行画出来，不做任何推导）：

```ts
export const COLLAPSED_SESSION_LIMIT = 5
export const RECENT_SESSION_LIMIT = 100
export const RECENT_KEY = '__recent__'

export type RenderRow =
  | {
      kind: 'recent'
      key: string            // `r:${RECENT_KEY}`
      label: string          // locales: section.recent
      depth: 0
      expanded: boolean
      sessionCount: number
    }
  | {
      kind: 'project'
      key: string            // `p:<projectKey>`
      label: string
      depth: 0
      expanded: boolean
      isGit: boolean
      path?: string          // 非 git 工作区时有值
      workspaceId?: string
      /**
       * worktree 子行数。**git 项目恒 = `worktrees.length`**（含单 worktree 的仓 ——
       * D11 2026-09-21 修订）；**非 git 工作区恒为 0**（它走 flat，不产生子行）。
       */
      worktreeCount: number
      sessionCount: number
      runningCount: number
      pendingCount: number
      /**
       * 该行是否「有任务正在运行」（**additive，2026-10-20**；用户裁决 RT2 / RT7）。
       *
       * 口径 = `worktrees.some(w => w.hasRunningTasks === true) ||
       * flatResult.hasRunningTasks === true` —— worktree 子行**或该 workspace 的
       * flat/普通会话**（2026-10-20 追加裁决：所有 workspace 都统计 flat 会话）；
       * history 桶与未分组**都不计入**。未分组行（同样是 `kind: 'project'`）恒为 `false`。
       *
       * ⚠️ **不是** `runningCount > 0` 的别名：`runningCount` 仍只数主会话自身 `running`
       * （用户裁决 Q1，见 §2.2.1 与 §2.6 裁定 3）。
       */
      hasRunningTasks: boolean
    }
  | {
      kind: 'worktree'
      key: string            // `w:<path>`
      label: string          // 分支名，无分支时用目录 basename
      sublabel?: string      // 目录 basename（与 label 不同才给）
      depth: 1
      expanded: boolean
      path: string
      isMain: boolean
      exists: boolean
      workspaceId?: string
      sessionCount: number
      runningCount: number
      pendingCount: number
      /**
       * 该行是否「有任务正在运行」（**additive，2026-10-20**；用户裁决 RT1）。
       *
       * 口径 = 该 worktree 容器内**任一可见顶层会话**满足
       * `session.running === true || subagentCountOf(subagentRunningCounts, sessionId) > 0`
       * （**含运行中的子代理**，与会话行 `running` 同源同口径）。可见性沿用
       * `isVisibleMember`（子代理 / 归档 / 非当前 blank 不计入），统计范围是**截断前**的
       * `heads` ⇒ 折叠、5 条截断、视口外都不影响。
       *
       * ⚠️ `history` 行**没有**该字段（clock 图标永不高亮）；`runningCount` 语义不变。
       */
      hasRunningTasks: boolean
    }
  | {
      kind: 'history'
      key: string            // `h:<projectKey>`
      label: string          // locales: history.label
      depth: 1
      expanded: boolean
      sessionCount: number
      runningCount: number
      pendingCount: number
    }
  | {
      kind: 'session'
      key: string            // `s:<sessionId>`
      sessionId: string
      label: string
      depth: number          // 1（非 git 工作区 flat / 未分组下）或 2（worktree / history 下）；无 3
      updatedAt: number
      /**
       * 会话是否在跑。**已含子代理聚合（需求 A，2026-09-21）**：
       * `该会话自己的 SessionSummary.running || subagentCount > 0` —— 对齐原生
       * `sessionStatuses`（`runningSubagentCount > 0` ⇒ 主状态点即 ongoing）。字段名与类型
       * 不变（§2.2 字段集合冻结），只有取值语义修正 —— 见 §2.6 裁定 3。
       */
      running: boolean
      completed: boolean
      blank: boolean
      pendingInteraction?: string
      /**
       * **运行中的**子代理后代数（所有层级）= 原生 `runningSubagentCount`；
       * 为 0 时渲染层不画胶囊。字段名保留（§2.2 字段集合冻结），只有语义修正 —— 见 §2.6 裁定 3。
       *
       * 与 `running` 的关系（**限定域，T3 次要问题 2 修正**）：**对 `RenderRow.kind === 'session'`
       * 的行而言**，`subagentCount > 0` **蕴含** `running === true`（需求 A）—— 两者由
       * `toSessionRow` 用**同一个** `subagentCount` 入参同时计算，所以在该限定域内恒成立。
       * 反向不成立（会话自己 running、无子代理时 `subagentCount === 0`）。两条通道语义不同、
       * 数据同源（同一份 `indexRunningSubagentDescendants` 索引）。
       *
       * ⚠️ 这**不是**全局不变式：`worktree` / `project` 行的 `runningCount`（见下）
       * **刻意不含**该聚合（用户裁决 Q1：渲染层无消费者，不扩大范围）⇒
       * 在那些行上「有运行中的子代理」与 `runningCount` 之间**没有**该蕴含关系。
       */
      subagentCount: number
      isCurrent: boolean
      /** 所属父节点 key（用于「移出 history」等动作定位；最近分区为 `r:${RECENT_KEY}`）。 */
      parentKey: string
      parentKind: 'worktree' | 'history' | 'project' | 'recent'
    }
  | {
      kind: 'more'
      key: string            // `m:<parentKey>`
      parentKey: string
      parentKind: 'worktree' | 'history' | 'project' | 'recent'   // 2026-11-14 PX4：「最近」也产出 more 行
      hiddenCount: number      // 2026-11-14 PX：当前**仍未显示**的顶层会话数（全部展开后为 0）
      nextCount: number        // 2026-11-14 PX：下一次「展开更多」多显示的条数 = min(5·(L+1), hiddenCount)
      canCollapse: boolean     // 2026-11-14 PX：层级 > 0（或旧式全展开）⇒ 提供「收起」
      depth: number
    }

export interface SidebarModelInput {
  projects: ProjectNodeLike[]        // 见下
  ungrouped: SessionRowLike[]
  archivedSessionIds: string[]
  currentSessionId?: string
  /** 节点 key → 是否展开；缺省视为展开。 */
  collapsedKeys: Record<string, boolean>
  /** 已点过「展开其余」的节点 key 集合。 */
  expandedAllKeys: Record<string, boolean>   // 旧式全展开（兼容输入，真 ⇒ 视为无限层级）；sidebar 恒传 {}
  expandLevels?: Record<string, number>      // 2026-11-14 PX1：容器 key → 渐进展开层级（缺省 0）
  /** 本地过滤查询串（空串 = 不过滤）。 */
  query: string
  /**
   * 浏览器本地的手动排序（D10 2026-09-21）。**可选**（不传 ⇒ 与改动前逐字一致）。
   * `manual !== true` ⇒ 完全走默认顺序；搜索模式**不应用**。
   */
  manualOrder?: ManualOrder
  /**
   * **顶部区**运行时输入（T11，2026-09-22 用户终裁）。**可选**
   * （不传 ⇒ **无任何置顶项**，逐字零回归）。
   *
   * ⚠️ **只进 `buildRows`**：`effectiveOrder` 内部把 `context.topZone` 硬置 `undefined`
   * ⇒ 运行时顶部区**绝不**进持久顺序（唯一例外见 `insertSessionAtFront`）。搜索模式不读它。
   */
  topZone?: TopZoneInput
  /**
   * 是否在末尾追加「最近」分区（2026-10-21 WSR5/WSR6）。**可选**
   * （不传 / `false` ⇒ 与改动前逐字一致，250 条既有树单测零回归；`sidebar.tsx` 恒传 `true`）。
   */
  includeRecent?: boolean
  /** 会话标题解析（宿主 title 投影缺失时兜底）。 */
  titleOf: (s: SessionRowLike) => string
  t: (key: string, vars?: Record<string, string | number>) => string
}

/**
 * 浏览器本地的手动顺序（D10 2026-09-21 用户决策变更）。
 *
 * **为什么是浏览器本地而不是宿主 API**：宿主 `workspaces.insertSessionBefore` 要求被拖会话
 * 与锚点同属一个 workspace（真实数据里 MyProject 的 6 个 worktree 只有 2 个已注册，其余 4 个
 * 的会话不在任何 workspace 里；history 桶 / 未分组同理），`insertBefore` 又只能排 dsh 工作区
 * （未注册 worktree 没有 workspaceId、项目节点还可能对应多个工作区）。两者都**无法统一覆盖**。
 * 本地顺序对未注册 worktree / history / 未分组全部适用，且它是**视图偏好**而非宿主数据。
 */
export interface ManualOrder {
  manual: boolean
  /** 顶层项目顺序（`ProjectNode.key`；**不含** `UNGROUPED_KEY`）。 */
  projects?: string[]
  /** 项目 key → 该项目内 worktree 路径顺序（`WorktreeNode.path`）。 */
  worktrees?: Record<string, string[]>
  /** 容器 key（= `RenderRow.parentKey`）→ 该容器内 sessionId 顺序。 */
  sessions?: Record<string, string[]>
}

/** 纯数据结构，与宿主 types.ts 的 ProjectNode 结构兼容（避免跨半边 import）。 */
export interface ProjectNodeLike { /* 与 ProjectNode 同构 */ }
export interface SessionRowLike { /* 与 SessionRow 同构；`lastActivityAt` 可选（旧载荷/测试构造兼容） */ }

/**
 * **顶部区**运行时输入（T11，2026-09-22 用户终裁）。**可选** ——
 * 缺省 ⇒ **无任何置顶项**（逐字零回归）。
 *
 * 由 `src/sidebar.tsx` 从 `TopZoneState` 投影（`topZoneInputOf`）而来。
 * ⚠️ **纯运行时**：`effectiveOrder` 内部把 `context.topZone` 硬置 `undefined`
 * ⇒ 绝不参与持久顺序（唯一例外是 D2 的新会话插入，那是 `sidebar.tsx` 的独立写入动作）。
 *
 * ## T11 终裁删除了两个字段（不要加回来）
 *
 * - ~~`recentlyFinishedSessionIds`~~（「刚结束保留」/ recentlyCompleted）——
 *   用户终裁「只要是结束了的会话就不再固定置顶了」；
 * - ~~`releasedContainerKeys`~~（拖动释放）—— 它唯一的作用是清除上一个字段，随之删除。
 */
export interface TopZoneInput {
  /**
   * **正在运行**（自身 running **或** 任意层级有运行中的子代理后代）。
   *
   * 这是顶部区**唯一**的常规成员类别（T11 终裁）：它们固定在所属容器最前，
   * 且**不可拖动**（`sidebar.tsx` 不给这些行装 `draggable`；判据共用
   * `isTopZoneRunningSession`）。
   */
  runningSessionIds?: readonly string[]
  /**
   * 新会话（判定口径见 `observeTopZone`；D2 允许插入固化表）。
   * ⚠️ **已落表**（在 `writtenNewSessionIds` 台账里）的新会话**不再**被渲染期提升 ——
   * 它的「在容器最前」已由持久顺序承载，再提升一次会让用户的拖拽被静默回滚（T9 缺陷 1）。
   */
  newSessionIds?: readonly string[]
  /**
   * **D2 落表台账**（`TopZoneState.writtenNewSessionIds` 的渲染期投影）：
   * 「落表意图已满足」的新会话 id（归一化）。已落表 ⇒ 渲染期**不再**提升它（T9 缺陷 1）。
   * ⚠️ **缺省（不传）⇒ 与旧行为逐字一致**（`newSessionIds` 全部参与提升），零回归。
   */
  writtenNewSessionIds?: readonly string[]
}

/** 顶部区运行时状态机的状态（**纯内存**，刷新即重置；`sidebar.tsx` 持有）。 */
export interface TopZoneState { /* baselined / startedAtMs / knownSessionIds（含归档，I3） / blankOf / runningOf / newSessionIds / writtenNewSessionIds（D2 落表台账，B2） */ }

/** 一次观测里的单条会话（`observationsOf` 的产物）。 */
export interface TopZoneObservation { /* sessionId / updatedAt / blank / running（聚合口径）/ subagent / archived */ }

/** 把树数据投影成顶部区观测批次（纯函数；`running` 用与 `toSessionRow` 同式的**聚合**口径）。 */
export function observationsOf(source: { projects: ProjectNodeLike[]; ungrouped: SessionRowLike[]; archivedSessionIds: string[] }): TopZoneObservation[]

/** 空状态（首次渲染初值）。 */
export function initialTopZoneState(): TopZoneState

/**
 * 推进顶部区状态机（**纯函数**；无变化时返回**同一引用**，供 `useState` 幂等使用）。
 *
 * 「新会话」判定 = ① 本进程内观测到 `blank: true → 非 blank`（强证据），或
 * ② 首次观测到且 `updatedAt >= 本进程基线时刻`（时间序证据）。**基线**里出现过的会话
 * **永不**判新会话。⚠️ **不是**「不在固化表里」—— T4 实测有 4 条旧表外会话会被误插。
 * ⚠️ **T11**：`running` 轨迹（`runningOf`）只用于投影「现在谁在跑」；旧实现在
 * `running: true → false` 的下降沿写入「刚结束保留」，该机制已按用户终裁删除。
 *
 * ⚠️ **归档语义（T6 缺陷 I3，2026-09-21 修正）**：「谁算旧会话」（`knownSessionIds`，
 * **含归档与子代理**）与「谁参与顶部区判定」（`eligible`，**排除归档与子代理**）是两个
 * 不同的事实。归档会话进 `known` ⇒ 取消归档 + 新消息**不会**被误判为新会话（否则会把
 * 旧会话插到固化表表首，违反 D5）；但它**不**进 `blankOf` / `runningOf` 轨迹、**不**进
 * `newSessionIds`、也不置顶。宿主当前无 unarchive API，该路径暂不可达，但语义按正确实现。
 */
export function observeTopZone(state: TopZoneState, observations: readonly TopZoneObservation[], nowMs: number): TopZoneState

/** 状态 → 渲染期输入（纯函数）。 */
export function topZoneInputOf(state: TopZoneState): TopZoneInput

/**
 * **「正在运行」判据的唯一来源**：这条会话是否在跑（⇒ 属于顶部区、且**不可拖动**）。
 *
 * 口径：`session.running === true`（渲染行的 `running` 是**聚合**口径，
 * 已覆盖「自身在跑」与「只有子代理在跑」）**或** id ∈ `topZone.runningSessionIds`。
 * ⚠️ **新会话不算「运行中」**（仍可拖动）—— 它「在容器最前」由 D2 落表承载。
 *
 * ⚠️ **2026-10-22（DR5）**：拖拽锁的唯一判据改由 {@link isSessionDragLocked} 承担
 * （= 本函数 ∪ 当前空白占位行）；本函数仍是「运行中」这一半的唯一实现，
 * `topZoneSessionKeys` 与 `isSessionDragLocked` 都调它，不得各写一份。
 */
export function isTopZoneRunningSession(
  session: { sessionId: string; running?: boolean },
  topZone?: TopZoneInput,
): boolean

/**
 * 是否是**当前打开的空白会话**（侧栏里的「新会话」占位行，2026-10-22 DR4）。
 *
 * 判据：`session.blank === true` **且**（`session.isCurrent === true` 或
 * `sessionId === currentSessionId`，`session-` 前缀归一化）。
 *
 * 语义与宿主原生一致（`dsh-client-ui-workspace/lib/client.js`）：
 * - `:983` `sectionMembers` 把 blank 成员放本组最前；
 * - `:952` `pinCurrentBlank` 把**当前** blank 提到首位；
 * - `:2261` blank 行**不可起拖**（`draggable = … && !row.blank && !row.archived`）。
 *
 * 由 `emitContainer` 用于**渲染期**把占位行排到容器最前（不写持久顺序）；不参与
 * `topZoneSessionKeys`（顶部区仍只含「运行中 / 未落表新会话」）。
 */
export function isCurrentBlankSession(
  session: { sessionId: string; blank?: boolean; isCurrent?: boolean },
  currentSessionId?: string,
): boolean

/**
 * 会话行**是否禁止拖拽**的唯一判据（T11 + 2026-10-22 DR5）。
 *
 * = ① 当前空白会话占位行（{@link isCurrentBlankSession}）∪ ② 正在运行
 * （{@link isTopZoneRunningSession}）。占位行被渲染期钉在容器最前，若允许起拖只会
 * 「拖完弹回」（T9 缺陷 1 同类）；宿主原生同样不给 blank 行起拖。
 *
 * ⚠️ **尚未落表的新会话（`newSessionIds`）不在此列**：它由 D2 落表承载持久顺序。
 * 占位行**仍接受落点**（`dragHandlersFor` 的第三参只关掉「自己起拖」）。
 */
export function isSessionDragLocked(
  session: { sessionId: string; running?: boolean; blank?: boolean; isCurrent?: boolean },
  topZone?: TopZoneInput,
): boolean

/**
 * 某容器内应置顶的会话 key（顶部区判据，**按 `updatedAt` 降序**）。
 *
 * **判据（T11 终裁，两类）**：
 * - a）**正在运行** —— id ∈ `runningSessionIds`，或该会话裸 `running === true`；
 * - b）**新会话** —— id ∈ `newSessionIds` **且**不在 `writtenNewSessionIds` 台账里
 *   （已落表 ⇒ 持久顺序已把它放在最前 ⇒ 无需再提升；T9 缺陷 1）。
 *
 * ⚠️ **已删除的两类判据（T11，不要改回去）**：
 * - ~~**刚结束保留**~~（`recentlyFinishedSessionIds`）—— 已结束的会话不再固定置顶。
 *   这是「已结束的会话拖不动 / 会回弹」的首要缺陷根因：它把会话钉在顶部区，
 *   `buildRows` 无论持久顺序怎么写都把它画回最前；
 * - ~~**当前会话置顶**~~（`isCurrent`）—— 用户明确选择**不保留**该例外。
 *
 * ⚠️ `currentSessionId` / `containerKey` 两个参数**已不参与任何判定**，仅为**向后兼容**
 * 保留签名位置（`docs/INTERFACES.md` 的冻结签名）；传入任何值都不改变结果。
 * ⚠️ **2026-10-22（DR4）**：当前空白会话（「新会话」占位行）**不**在本函数里置顶 ——
 * 它由 `emitContainer` 用 `isCurrentBlankSession` 单独排到容器最前（宿主
 * `sectionMembers` / `pinCurrentBlank` 同语义）。本函数仍只负责「运行中 / 未落表新会话」。
 * 契约外 `topZone`（`null` / 字段非数组）⇒ 静默降级为不置顶（T6 次要项 S2，不抛 `TypeError`）。
 */
export function topZoneSessionKeys(
  sessions: SessionRowLike[],
  currentSessionId: string | undefined,
  containerKey: string,
  topZone?: TopZoneInput,
): string[] | undefined

/** 从 `effectiveOrder().sessions` 反查某会话所属容器 key（归一化比较；找不到 ⇒ undefined）。 */
export function containerKeyOfSession(sessions: ReadonlyMap<string, readonly string[]>, sessionId: string): string | undefined

/**
 * 某会话在**树/固化表里的落点**：容器 key + **该会话在表里的真实 id 形态**。
 *
 * 存在理由（T6 缺陷 B1）：`observeTopZone` 内部一律用归一化 id 比较，所以
 * `newSessionIds` 里是**裸 id**；而宿主真实 id 恒带 `session-` 前缀（用户真实固化表 54 个
 * 条目全部带前缀）。D2 落表必须先用本函数还原成**树里的原形态**再写，否则写入的是
 * **永远匹配不上的死条目**，并顶掉原本正确的条目。
 */
export function placementOfSession(
  sessions: ReadonlyMap<string, readonly string[]>,
  sessionId: string,
): { containerKey: string; sessionId: string } | undefined

/**
 * **D2（唯一允许写持久顺序的运行时动作）**：把新会话插到其容器固化顺序表的**最前**。
 *
 * - `manual !== true` ⇒ 返回 `undefined`（**不写、不建表** —— 绝不静默把用户切成手动模式）；
 * - 已在表首 ⇒ 返回 `undefined`（**幂等**，不在每次渲染时反复写 `localStorage`）；
 * - 先把该 id 全部剔除再插首位（**去重**，不产生重复条目）；
 * - 只写这一个新会话：`running` / `刚结束` / `当前会话` **一律不进表**；
 * - **写入形态（T6 缺陷 B1）**：按可信度取「原形态」—— ① 表里已有该会话 ⇒ 用表里的写法；
 *   ② 否则 `fullOrder`（= `effectiveOrder` 的产物 = 树里的真实 id）里有 ⇒ 用树里的写法；
 *   ③ 都没有 ⇒ 用调用方给的 `sessionId`。**绝不写入与树/表形态不一致的死条目**；
 * - **空数组表项（T6 次要项 S1）**：表项是空数组时按「表里没有这个容器」处理、用
 *   `fullOrder` 作基底 ⇒ 不丢其余会话；
 * - 纯函数：不修改入参，返回新的 `ManualOrder`。
 */
export function insertSessionAtFront(
  order: ManualOrder,
  containerKey: string,
  sessionId: string,
  fullOrder?: readonly string[],
): ManualOrder | undefined

/**
 * **D2 落表编排（纯函数，T6 缺陷 B2）**：把 `newSessionIds` 里**尚未消费**的新会话逐个插到
 * 其容器固化表最前，并回答「哪些 id 就此消费掉」。
 *
 * 收敛机制：调用方把 `consumed` 记进 `TopZoneState.writtenNewSessionIds`
 * （`markNewSessionsWritten`），下次 effect 重跑时跳过它们 ⇒ **同一个新会话的落表只发生
 * 一次**，用户随后拖动它不会被静默回滚。
 *
 * - `order.manual !== true` ⇒ 原样返回、**不消费**（默认模式不写、不建表）；
 * - `alreadyWritten` 里的 id ⇒ 跳过；在 `sessions` 里找不到的 id ⇒ **不消费**（不可见：
 *   仍是 blank / 已归档 / 别的容器），等它可见时再落表，不永久丢失 D2 意图；
 * - 落表用 `placementOfSession` 的**树里真实 id 形态** ⇒ 不产生死条目（B1）。
 */
export function planNewSessionInserts(
  order: ManualOrder,
  sessions: ReadonlyMap<string, readonly string[]>,
  newSessionIds: readonly string[],
  alreadyWritten: readonly string[],
): NewSessionInsertPlan

/** `planNewSessionInserts` 的产物：`{ order, consumed, changed }`。 */
export interface NewSessionInsertPlan { /* order / consumed / changed */ }

/**
 * 把「落表意图已满足」的新会话 id 记入 `TopZoneState.writtenNewSessionIds`（B2 的收敛台账）。
 * 幂等：全部已记入 ⇒ 返回**同一引用**。⚠️ **只动台账，不动 `newSessionIds`** —— 后者是
 * D3d 的顶部区输入，新会话在整个页面会话内都应被提升到容器顶部区。
 */
export function markNewSessionsWritten(state: TopZoneState, sessionIds: readonly string[]): TopZoneState

/** 尚未消费（还没落表 / 还没确认已在表首）的新会话 id（归一化）；D2 effect 的早退判据。 */
export function pendingNewSessionIdsOf(state: TopZoneState): string[]

/** 把树模型摊平成渲染行序列（已应用展开态、5 条截断、搜索过滤；`includeRecent === true` 时末尾追加「最近」分区）。纯函数。 */
export function buildRows(input: SidebarModelInput): RenderRow[]

/** 单独推导侧栏底部「最近」分区行序列（`kind: 'recent'` 头 + 按「最后更新时间」降序的 `rs:<sessionId>` 会话行；2026-11-14 PX4 起**无 100 上限**，默认 5 条、按 `expandLevels['r:__recent__']` 渐进展开并产出 `m:r:__recent__` more 行；搜索模式或无可见会话时返回 `[]`）。纯函数。 */
export function visibleSessionLimit(level: number): number            // 5 + 5·L(L+1)/2
export function nextExpandCount(level: number, remaining: number): number // min(5·(L+1), remaining)
/** 折叠某行时需清零层级的容器 key：项目行 ⇒ 自身 + `h:<key>` + 全部 `w:<path>`；其余 ⇒ 自身。 */
export function containerKeysUnder(projects: readonly ProjectNodeLike[], rowKey: string): string[]
export function buildRecentRows(input: SidebarModelInput): RenderRow[]

/**
 * 按手动顺序**稳定重排**：置顶项最前，然后列表内的项按索引，列表外的项按默认顺序追加到末尾。
 * `order` 与 `pinnedKeys` 都空 ⇒ 原样返回；已消失的 id 忽略（不产生空洞）。
 * 纯函数：不修改入参。
 *
 * 第 4 参 `pinnedKeys` **可选**（T11 后**唯一**来源是 `topZoneSessionKeys`：
 * 正在运行 / 尚未落表的新会话）：置顶项**先于** `order` 取出
 * （`taken` 共用 ⇒ 同一项不会被搬两次），因此它压过 `order` 的索引。
 * **只有渲染路径传它**：`effectiveOrder` 刻意不传（置顶绝不写进持久顺序）。
 */
export function applyManualOrder<T>(
  items: T[],
  order: string[] | undefined,
  keyOf: (item: T) => string,
  pinnedKeys?: readonly string[],
): T[]

/**
 * 三层各自的**完整生效顺序**（默认 + 手动），**不截断、不折叠**、不含未分组项目行。
 * 容器 key 的推导与 `buildRows` 同源（`containersOfProject` / `visibleMembers`），
 * 因此不可能与树里看到的顺序分叉。渲染层拖拽落点用。
 *
 * ⚠️ **刻意不应用任何运行时顶部区（T11）**：本函数的输出是 `commitDrag` 首次拖拽时
 * 全量固化进 `localStorage` 的那份顺序。若这里也置顶，就把「运行时置顶」变成
 * 「持久化钉在第 1 位」⇒ 用户关掉那个会话后它仍赖在最前面，持久顺序被污染。
 * **被测试锁定的不变式**（`test/tree-model.test.mjs`「T11: `effectiveOrder` **不**应用运行时顶部区」）。
 */
export interface EffectiveOrder {
  projects: string[]
  worktrees: Map<string, string[]>
  sessions: Map<string, string[]>
}
export function effectiveOrder(input: SidebarModelInput): EffectiveOrder

/**
 * 「被拖项 + 落点」→ 新顺序（原生 `commitSessionDrag` 的可见项算法）。
 * **无需改动**（落点是自己 / 已在原位 / 落点不在列表里）⇒ 返回 `null`，
 * 调用方据此避免「拖了但没变」也把 `manual` 置 true。
 */
export function reorderKeys(keys: string[], draggedId: string, overId: string, half: 'before' | 'after'): string[] | null

/**
 * 把持久手动顺序表与「当前默认顺序」对齐（2026-10-22 DR6）。
 *
 * 规则与渲染期 `applyManualOrder` 的表外项语义逐字一致：表内项保持相对顺序（含当前
 * 不可见的归档项 ⇒ 取消归档时位置不丢）；表外项按 `defaults` 顺序追加到末尾；去重、
 * 忽略非字符串；纯函数。
 *
 * 存在理由：`manualOrder` 是**首次拖拽时固化的快照**，之后新增的工作区 / worktree / 会话
 * 不在表里；`reorderKeys` 对「拖拽源或落点不在表里」都返回 `null` ⇒ 整次拖拽静默无效。
 */
export function reconcileManualOrder(order: readonly string[] | undefined, defaults: readonly string[]): string[]

/**
 * **拖拽换算的唯一入口**（2026-10-22 DR6）：`reorderManualScope` =
 * `reorderKeys(reconcileManualOrder(order, defaults), …)`。
 *
 * `sidebar.tsx` 的 `commitDrag` 三层（project / worktree / session）都必须走它，
 * **不得**直接拿持久表调 `reorderKeys`。`undefined` 顺序（非手动模式）⇒ 等价于直接用
 * `defaults`，与旧行为逐字一致。无需改动 ⇒ `null`。
 */
export function reorderManualScope(
  order: readonly string[] | undefined,
  defaults: readonly string[],
  draggedId: string,
  overId: string,
  half: 'before' | 'after',
): string[] | null

/**
 * 从项目 key 解出 workspaceId —— **仅非 git 工作区**（key 形态 `ws:<workspaceId>`）。
 *
 * 非 git 工作区的 `worktrees` 恒为空数组（`buildProjects` 的 `'flat'` 分支不建 worktree 节点），
 * 所以它的 workspaceId 只能从 key 解出。`src/sidebar.tsx` 的 `buildTreeView` 用本函数填
 * `ProjectExtra.workspaceId` —— 那是非 git 行 hover 的 `+`（新建会话）**唯一**的 id 来源，
 * 漏掉它该按钮会因 `workspaceId === undefined` 而根本不渲染。导出以便单测覆盖
 * （`sidebar.tsx` 是 `.tsx`，不进 `lib/`，无法被 `node --test` 直接测）。
 */
export function workspaceIdFromProjectKey(key: string): string | undefined

/**
 * 单节点截断：按**输入顺序**保留前 `limit` 条非 blank 会话。导出以便单测。
 *
 * ⚠️ **T13（2026-09-22 用户终裁）**：签名**已收窄**为 `(sessions, limit)` ——
 * 曾经的 `currentSessionId?` 形参与「当前会话保底进前 limit 条」（`promote` 分支）
 * **一并删除**（见下方「D12 保底已删除」）。**不得**再加回第 3 个形参。
 */
export function truncateSessions<T extends { sessionId: string }>(
  sessions: T[],
  limit: number,
): { visible: T[]; hiddenCount: number }

/** 子代理折叠：parentSessionId 指向同组内存在的父会话时挂为子行（深度 +1）。 */
export function nestSubagents<T extends { sessionId: string; parentSessionId?: string; origin?: string }>(
  sessions: T[],
): Array<{ session: T; depth: number }>

/**
 * 运行中的子代理后代数索引（所有层级）= 原生 `indexSubagentDescendants` 的逐字移植。
 * `nestSubagents` 在上方被**复用于解析父子关系**（见 `discoverChildEdges`），不是死代码。
 * 返回的 Map 以**归一化** id 为键；查询请走内部的 `subagentCountOf`。
 */
export function indexRunningSubagentDescendants<T extends { sessionId: string; parentSessionId?: string; origin?: string; running?: boolean }>(
  sessions: T[],
): Map<string, number>
```

**补录：`truncateSessions` 导出契约（T15 补录，T13 收窄后的真实签名）**

```ts
/**
 * 单节点截断：按**输入顺序**保留前 `limit` 条非 blank 会话。导出以便单测。
 *
 * @param sessions 输入会话（**不被修改**，返回的是同一批引用）。
 * @param limit 每个容器的非 blank 可见上限；非有限值按 0 处理。
 * @returns `{ visible, hiddenCount }` —— 可见会话（保持输入顺序）与被隐藏条数
 *          （`hiddenCount = sessions.length - visible.length`，含 blank 之外被截断的条数）。
 */
export function truncateSessions<T extends { sessionId: string }>(
  sessions: T[],
  limit: number,
): { visible: T[]; hiddenCount: number }
```

- ✅ **D12 保底已删除（T13，2026-09-22 用户终裁）**：曾经的第 3 个形参 `currentSessionId?: string`
  与「当前会话保底进前 `limit` 条」（`promote` 分支）**一并删除**，签名**收窄为 2 形参**。
  **不得再加回第 3 个形参**；`src/` 内唯一调用点 `emitContainer` 亦只传 `(heads, COLLAPSED_SESSION_LIMIT)`。
- **blank 豁免**：`blank` 会话**不占** `limit` 名额但**保持输入顺序**（`visible.push` 后 `continue`）。
- **判别力锁**：`test/tree-model.test.mjs` 的 `assert.equal(truncateSessions.length, 2)` 钉死形参个数；
  `T13/截断` 系列用例在渲染层（`buildRows`）钉死「已结束会话位置完全由持久顺序决定」。
- **证据类型**：`审查真实代码`（`src/tree-model.ts:1578-1601`、`lib/tree-model.d.ts`）。

**排序与过滤规则**
- **容器划分（D11，2026-09-21 修订）**：`hasWorktreeRows = project.isGit === true` ——
  **git 项目一律产出 worktree 子行，含单 worktree 的仓**；`Containers.flat` **只**在
  `isGit === false` 时存在（非 git 工作区，会话挂 `p:<projectKey>`、`parentKind: 'project'`、
  `depth: 1`）。git 项目的会话一律挂 `w:<path>`（`parentKind: 'worktree'`、`depth: 2`）。
  `Containers.flat` **不再**携带 `worktree` 字段（非 git 工作区没有 worktree，也就没有分支名）——
  原先「恰好 1 个 worktree 时给 flat 挂 `worktree`」的特例已随本次修订删除。
- 项目顺序：保持宿主 `workspaceRegistry.list()` 的顺序（调用方传入时已排好）。
- worktree 顺序：主树在前，其余按分支名字典序。
- 会话顺序：`updatedAt` 降序；`updatedAt` 相同按 `sessionId` 升序（确定性）。
- **当前空白会话（「新会话」占位行）恒在最前（2026-10-22 DR4）**：`emitContainer` 用
  `isCurrentBlankSession(...)` 在 `applyManualOrder` 的 `pinnedKeys` **首位**插入该行 ⇒
  先于手动顺序、先于顶部区、先于 5 条截断。与宿主 `sectionMembers`（blank 先）/ `pinCurrentBlank`
  （当前 blank 提到首位）同语义。**不写持久顺序**（纯渲染期）。反向约束：`blank !== true` 的
  当前会话**不得**因此置顶（T11 终裁不回退），由 `2026-10-22/DR4` 对应用例锁定。
- **顶部区（T11，2026-09-22 用户终裁）**：每个容器内的顶部区判据由
  `topZoneSessionKeys(visible, currentSessionId, spec.key, context.topZone)` 统一给出
  （**唯一**实现；`emitContainer` 是唯一调用点）。判据 = **两类并集**：

  | # | 类别 | 判据 | 可拖动？ | 持久化 |
  |---|---|---|---|---|
  | a | **正在运行** | id ∈ `topZone.runningSessionIds` **或** 该会话的裸 `SessionRowLike.running === true`（聚合口径） | **❌ 不可拖动** | ❌ 不写 |
  | b | **新会话** | id ∈ `topZone.newSessionIds` **且**不在 `writtenNewSessionIds` 台账里 | ✅ 可拖动 | ✅ **唯一例外**（D2 插入固化表，见 `insertSessionAtFront`） |
  | c | **当前空白占位行**（2026-10-22 DR4） | **不**在本函数里判定：`emitContainer` 用 `isCurrentBlankSession(...)` 把它插到 `pinnedKeys` 首位（在 a/b 之前） | **❌ 不可拖动**（`isSessionDragLocked`） | ❌ 不写 |

  - ⚠️ **T11 删除的两类判据（不要加回来）**：
    - ~~**刚运行结束保留**~~（`topZone.recentlyFinishedSessionIds`）—— 用户终裁
      「只要是结束了的会话就不再固定置顶了」。这是「已结束的会话拖不动 / 会回弹」的**根因**。
    - ~~**当前会话**~~（`isCurrent`）—— 用户明确**不保留**该例外。
  - **顺序**：全部顶部区成员按 `updatedAt` 降序（`sessionId` 升序 tiebreak）—— **确定性**，
    且与容器内默认排序 / 搜索排序**同向**（理由见 PRD US8「顶部区」段：`updatedAt` 不随
    agent / subagent 活动推进，故「只有 subagent 在跑」的会话可能区内靠后，但它**一定进入
    顶部区**）。⚠️ T11 起**没有**「当前会话恒第一位」这一层（该例外已删除）。
  - **时机**：`emitContainer` 里顶部区在 `applyManualOrder` 内、**先于** `truncateSessions`
    ⇒ 顶部区成员在截断前就已排在最前。
    ⚠️ **措辞修正（T13 的 N-6）**：这**不**等于「顶部区会话一定可见」—— 同一容器若有
    **6 条以上**顶部区成员（例如 6 条并发运行中的会话），`truncateSessions` 仍只保留前 5 条
    （`test/tree-model.test.mjs` 的 `T5/截断: 顶部区成员数 > 5 时，只有前 5 条可见` 锁定该取舍）。
  - **不可拖动（T11 新增；2026-10-22 DR5 扩展）**：会话行由 `sidebar.tsx` 以
    `dragHandlersFor(row, scope, !isSessionDragLocked(row, topZone))` 接线
    ⇒ `draggable: false`，但**仍接受落点**（`accepts` 照常工作）。`isSessionDragLocked`
    = **运行中**（`isTopZoneRunningSession`，与置顶判据同一实现）**∪ 当前空白占位行**
    （`isCurrentBlankSession`）—— 后者被渲染期钉在最前，允许起拖只会「拖完弹回」，
    宿主原生同样不给 blank 行起拖（`dsh-client-ui-workspace/lib/client.js:2261`）。
    ⚠️ **该接线由源码级契约测试锁定**（T13 的 N-1；T15 扩到 10 条，含「`draggable` → DOM prop」
    与「`topZone` 实参身份」两条 `[P2]` 断言）：`test/sidebar-wiring.test.mjs` 用
    TypeScript 编译器 API 解析**真实 `src/sidebar.tsx`**，断言三形参、`draggable` 带进返回值、
    `onDragStart` 的 `!draggable` 守卫、session 行调用传入 `!isSessionDragLocked(row, topZone)`、
    worktree·project 行**不传**第 3 实参、判据从 `./tree-model.js` import 且全 `src/` 只有**一份**声明、
    `isSessionDragLocked` 内部复用唯一的 `isTopZoneRunningSession`（2026-10-22 收紧了这条断言）。
    （此前该接线**零自动回归保护**：T12 的 M7/M8 变异在 `tree-model.test.mjs` 上均 fail 0。）
  - ⚠️ **T11 删除的机制**：`releasedContainerKeys` / `releaseTopZoneContainer` /
    `isTopZoneReleasingDrag`（「拖动容器 ⇒ 清除该容器的刚结束保留」）—— 保留机制删除后
    它失去全部语义，属死代码。`sidebar.tsx` 的 `commitDrag` 现在**只改写持久顺序**，
    不再有任何顶部区动作。
  - **契约外 `topZone` 输入**（`null` / 字段非数组）⇒ 静默降级为不置顶，**不抛 `TypeError`**
    （T6 次要项 S2，与同函数内 id 元素的 `typeof` 守卫风格一致；真实链路不可达）。
  - **范围 = 所属容器内**，**不**改变 project / worktree 容器行自身的顺序。
  - **搜索模式不应用**（`buildSearchRows` 不读 `topZone`；与「不应用手动顺序」一致）。
  - 不可见的 id（子代理 / 已归档 / 别的容器）在 `applyManualOrder` 的 `items` 里找不到
    ⇒ **静默忽略**，不崩、不误置顶到别的容器。
  - **`topZone` 缺省 ⇒ 无任何置顶项**（逐字零回归）。
- **当前会话高亮（**不**置顶，T11）**：`RenderRow.isCurrent` 仍由 `context.currentSessionId`
  给出，**只**用于行高亮与「blank 会话只显示当前那一条」。
  ⚠️ T11 起它**不再参与任何置顶判定**（「当前会话置顶」已按用户终裁删除）；
  `topZoneSessionKeys` 的 `currentSessionId` / `containerKey` 两个参数**仅为签名兼容**保留。
  ⚠️ **唯一例外（2026-10-22 DR4）**：`blank === true` 的**当前空白会话**由 `emitContainer`
  钉在容器最前（`isCurrentBlankSession`），这是「新会话」占位行，不是「当前会话置顶」的回退。
- ✅ **D12 保底已删除（T13，2026-09-22 用户终裁）**：`truncateSessions` 的 `promote` 分支
  （「当前会话保底进前 limit 条」）**已整体删除**，其 `currentSessionId` 形参一并移除
  ⇒ 函数签名收窄为 `(sessions, limit)`。
  **背景**：T11 删除 `isCurrent` 置顶后该分支从「恒不可达」变成**可达**；T12 复审实测其触发面
  比原披露更宽 —— **默认未折叠态下容器超过 5 条会话即触发**（持久表 `[o0..o7,cur]` ⇒
  渲染 `[o0,o1,o2,o3,cur]`；把 `cur` 拖到第 7 位 ⇒ **渲染视觉零位移**，与用户投诉的
  首要缺陷**同形**）。**用户裁决：删除该保底，拖拽顺序完全优先**，并接受「当前会话被截断到
  不可见就是看不见」这一副作用。
  ⇒ **渲染层契约**：已结束会话（含当前打开的会话）的位置**完全**由持久拖拽顺序决定 ——
  渲染顺序 === 「当前空白占位行 + 运行中 + 尚未落表新会话」置顶 ∪ 持久顺序，再取前
  `COLLAPSED_SESSION_LIMIT` 条（占位行由 DR4 追加在最前，且不占 blank 之外的截断名额）。
  回归锁：`T13/截断: 当前会话拖到容器内任意位置 ⇒ 渲染 === 运行中置顶 + 其余逐字持久表（逐落点枚举）`。
- **手动顺序（D10，2026-09-21 用户决策变更）**：`manualOrder.manual === true` 时，三层各自在
  **默认排序之后、5 条截断之前**叠加 `applyManualOrder`：
  - 项目按 `projects`（键 = `ProjectNode.key`，**不含未分组**）；
  - worktree 按 `worktrees[projectKey]`（键 = `WorktreeNode.path`，**只在同一项目内**）；
  - 会话按 `sessions[容器key]`（键 = `sessionId`，**只在同一容器内**）。

  列表外的**非运行中、非新会话**的新项（新建会话 / worktree / 项目）按各自
  **默认顺序追加到末尾**（⚠️ 「新会话」受 D2 约束：手动模式下它会被 `insertSessionAtFront`
  插到其容器固化表**最前**；顶部区的**两类**（运行中 / 未落表新会话）由
  `topZoneSessionKeys` 在渲染期提升）；
  已消失的项（被删 / 归档）**忽略**。`manualOrder` 缺省或 `manual !== true` ⇒
  **与不传逐字一致**（零回归；`manual:false` 时即便带着顺序表也一律忽略）。
  **搜索模式不应用手动顺序**（`buildSearchRows` 恒按 `updatedAt` 降序）。
- 归档会话一律排除（`archivedSessionIds`）。
- **子代理会话（`origin === 'subagent'`）一律排除**（`isVisibleMember`，对齐原生 `sessionVisible`）——
  树上与搜索结果里都不出现；当前会话若就是 subagent 也不显示。父行只保留 `subagentCount`
  胶囊（= 运行中的子代理后代数），且 **`subagentCount > 0` 时父行 `running` 也为 `true`**
  （需求 A，见 §2.6 裁定 3）。
- `blank === true` 的会话：仅当它就是 `currentSessionId` 时才显示。
- 搜索：`query` 非空时，扁平输出——所有匹配的会话行（匹配标题 / 项目名 / worktree 分支名 / 工作区路径 basename / cwd basename），深度 0，不带父节点行。**搜索候选与树走同一个可见性谓词**，因此不会搜到子代理。分支名可搜性在**三种项目形态**（多 worktree / 单 worktree / 非 git）下均已回归锁定：git 项目走 worktree 子行 ⇒ `ContainerSpec.worktree` 恒非空；非 git 工作区没有分支名，靠 cwd basename 兜底。
- 数字归一化：子代理不计入父节点的 `sessionCount`（与原生一致：`sessionCount` 指顶层会话数）。
- 搜索行的 `depth` 恒为 0；树上的会话行 `depth` 只可能是 1（非 git flat / 未分组）或 2（worktree / history）。

#### 2.2.1 `hasRunningTasks` 的口径（additive 修订，2026-10-20；含同日追加裁决）

> 本节是**经用户确认的 additive 修订**：只**新增**一个必填布尔字段，既有字段名 / 类型 / 语义
> **一律不变**。`RenderRow` 的字段集合仍然冻结 —— 后续任何增删都必须再走一次本节的记录流程，
> 不允许在实现里静默扩字段。
>
> **2026-10-20 追加裁决（T-8）**：project 行的聚合范围由「只聚合 worktree 子行」扩大为
> 「worktree 子行 **OR** 该 workspace 的 flat/普通会话」。用户原话：「无 worktree 的工作区，
> 如果有任务在进行，文件夹 icon 也要高亮」；追问后明确**所有 workspace 都统计普通会话**
> （worktree 都空闲、但有 flat 会话在跑时也亮）。**history 桶与未分组仍排除**。

**类型**：`project` / `worktree` 两个变体各自新增 `hasRunningTasks: boolean`（**必填**，非可选）。
`history` / `session` / `more` 三个变体**不加**（history 行不带该信息 ⇒ 渲染层 `clock` 永不高亮）。

**判定（唯一实现点，写在 `tree-model.ts`）**

| 行 | 判定 | 说明 |
|---|---|---|
| `worktree` | `heads.some(s => s.running === true \|\| subagentCountOf(subagentRunningCounts, s.sessionId) > 0)` | `heads` = 截断前的可见顶层会话；含运行中子代理（RT1）；**判定不变** |
| `project` | `worktreeResults.some(entry => entry.result.hasRunningTasks === true) \|\| flatResult.hasRunningTasks === true` | worktree 桶 **OR** 该 workspace 的 flat/普通会话容器；flat 为空/无会话 ⇒ `false`；**不得**整体并入 `allResults`（会把 history 带进来） |
| 未分组行（`kind === 'project'`） | 常量 `false` | 不属于任何 workspace；RT2 明确不聚合未分组 |
| `history` | —（不设字段） | RT2 明确不聚合 history |

**与 `runningCount` 的关系（旧裁决不变）**：`runningCount` 仍只数 `session.running`，**语义不变**、
**消费者仍为零**（新视觉读 `hasRunningTasks`，不读它）。因此允许出现
「`runningCount === 0` 但 `hasRunningTasks === true`」（只有子代理在跑）—— 这是 RT1 的意图，
不是缺陷。用户裁决原文见 §2.6 裁定 3 与 `src/tree-model.ts` 的 `buildRows` JSDoc，**不得改写**。

**`flatResult` 的归属（实现事实）**：它是**当前 project 的**普通/flat 会话容器结果，不是全局、
不是未分组。`containers.flat` 只对非 git 工作区存在（D11）；`buildRows` 对 git 项目用
`project.flatSessions` 构造一个**仅供判定**的等价容器（不渲染、不计入 `sessionCount`）。
真实宿主数据里 `flatSessions` 对 git 项目恒为空（`src/projects.ts` 归属规则 2b），该分支锁契约形状。
术语上：**非 git 时 `project == workspace`**（flat 容器就是它自己的）；git 项目一个 repo 可承载多个
workspace，其等价 flat 容器是 **project（repo）级形状守卫**，不产生 workspace 级差异。

**边界（必须与设计文档 §4 一致）**

| 场景 | 值 |
|---|---|
| 容器折叠 / 会话被 5 条截断 / 行在视口外 | 仍按数据真实值（不受渲染影响） |
| 归档会话、非当前 blank 会话在跑 | 不计入（`isVisibleMember`） |
| 当前 blank 会话在跑 | 计入（当前会话豁免 blank 过滤，与 `runningCount` 一致） |
| 非 git 平铺（flat）有会话在跑 | project 行 `true`（T-8 追加） |
| git workspace 有 worktree 但全空闲、flat 会话在跑 | project `true`、worktree `false`（T-8 追加，A15） |
| 未分组 / history 有会话在跑 | project 行 `false`；history 行无字段 |
| 搜索模式 / `wide === false` 轨道态 | 不适用（无容器行，非目标） |

**消费者**：仅 `src/sidebar.tsx` 的 `ContainerRowView`（见 §2.3）。**任何其它模块不得**据此推导新行为。

### 2.3 `src/sidebar.tsx`（T5 写）

```tsx
/** 侧栏主组件；注册进 sidebar.workspaces 槽位。 */
export function SidebarBrowser(props: Record<string, unknown>): unknown
```

**必须遵守**
- 只从 `props` 取宿主推来的数据（`useWorkspaces` / `useSessions` / `renderSlot` / `useDirectoryFlow` / `t` 等）；**不要**臆造 props 名，以 `docs/HOST-CONTRACTS.md` 为准。
- **取词入口必须过 `createSeatT`（2026-09-23，D15 的配套）**：`SidebarBrowserInner` 的局部 `t`
  形如 `typeof props.t === 'function' ? createSeatT(props.t) : FALLBACK_T`。
  理由：entry 声明了 `locale` ⇒ seat **一定存在**，`FALLBACK_T` 分支在真实组合里走不到；
  一旦词典注册错过时机，seat 会把 key 本身当文案返回（见 §2.1 缺陷记录）。由
  `test/sidebar-wiring.test.mjs` 的 `T16/取词` 钉死（含「实参必须追溯到 `props.t`」与
  「`FALLBACK_T` 分支必须保留」两条）。
- 顶层错误边界：渲染异常时显示 `error.title` + 重新加载按钮，**绝不白屏**。
- 树数据来自 `POST /dsh-worktree-groups/tree`；用 `useSyncExternalStore` 订阅宿主快照触发重取，外加
  **运行集合签名变化（220 ms 防抖）**、定时轮询 + `window` focus 强刷（见下方「运行中任务高亮」段）。
- **2026-11-14 PERF5–PERF7**：
  - 下游消费的 `tree` = `mergeLiveSessions(serverTree, sessionsSnapshot).tree`（§2.3.4）；防抖触发源中的整份
    `sessionsSnapshot` 替换为 `pendingLiveSignature`（`pendingIds.join(',')`）。
  - `reload` 同一时刻至多一个在途请求，期间触发只置尾随标记、结束后补发一次；只在卸载时 abort；
    带 `If-None-Match`，304 不解析不 setState；`document.visibilityState === 'hidden'` 时跳过。
  - `TREE_REFRESH_MS = 5_000`；另监听 `visibilitychange`，重新可见即拉。
  - **会话行 memo 化（2026-11-14 追加）**：`SessionRowView = memo(SessionRowViewInner, sessionRowPropsEqual)`
    （比较器在 `src/row-memo.ts`）；处理器不进 props，经稳定的 `sessionHandlersRef`（`rowKey → 最新处理器`）在事件触发时取用。
- 展开/折叠态与渐进展开层级存 `localStorage`，键：`dsh-worktree-groups.collapsed` / `dsh-worktree-groups.expandLevels`
  （2026-11-14 PX5 起；旧 `.expandedAll` 不再读写）；折叠项目 / worktree / 「最近」时按 `containerKeysUnder` 清零层级；
  **手动排序**存 `dsh-worktree-groups.order`（D10，见 §2.3.1）。
- 收起态（`wide === false`）退化为 icon 列，不崩。
- **行按钮布局（2026-09-21）**：见 §2.6 裁定 1.1 —— git 项目行只有 `…`、非 git 工作区行只有 `+`、
  未分组行无按钮；`…` 的菜单项按行类型收敛（git 项目只有「新建 worktree」）。
- **工作区行不显示会话数（2026-10-21 WSR7）**：`ContainerRowView` **不得**读取/渲染
  `row.sessionCount`；该字段仍保留在 `RenderRow`（统计口径不变），只是顶层工作区行
  （`kind === 'project'`，含 `未分组`）不再展示数字。「最近」分区标题行
  （`RecentSectionHeaderView`）的数量显示不在此约束内。由 `test/sidebar-wiring.test.mjs`
  的 WSR7 AST 用例锁定。
- **同位置「新建会话」必须复用空白会话（2026-10-22 DR1，缺陷：切换会话后草稿丢失）**：
  1. `Actions.startSession(workspaceId, options?)` 与 `SidebarBridge.startSession(workspaceId, options?)`
     的 `options` 必须**原样转发**（宿主 props 与 bridge 两条路径都不得丢参）。
  2. 插件**自有**的全部「新建会话」入口（worktree 行 `+`、worktree 右键菜单、非 git 工作区行 `+`、
     非 git 工作区右键菜单、worktree 创建成功后的自动开）一律传**同一个常量**
     `SAME_LOCATION_START_SESSION = { clearPreviousDraft: false }`；**禁止**传
     `clearPreviousDraft: true`（会清空草稿），**禁止**省略第二参（宿主 `connectBlank(..., undefined)`
     会铸新空白会话，草稿随旧 blank 会话被 `sessionVisible()` 隐藏）。
  3. 判据是宿主侧 `summary.cwd === workspace.path`：「同个位置」= 同一 worktree 路径 / 同一无
     worktree 工作区路径，跨 worktree 不复用（DR2）。
  4. 由 `test/sidebar-wiring.test.mjs` 的 `2026-10-22/DR1` 四条用例锁定（入口数量 = 4、第二参值、
     `Actions` 双路径透传、宿主契约锁）。需求与宿主证据见
     `docs/requirements/2026-10-22-new-session-draft-retention.md` /
     `docs/design/2026-10-22-new-session-draft-retention.md`。
- **顶部搜索行**：`[搜索框 flex:1] + [添加工作区 + 按钮]` 两元素一行，对齐原生 `sectionHeader`
  （`dsh-client-ui-workspace/lib/client.js` 的 `headerActions`）。按钮用 `t('project.add')` 作
  `title` 与 `aria-label`。
- **「添加工作区」目录选择三层链路（2026-10-21 Fix3，缺陷：点击 `+` 无反应）**：
  1. **Desktop Electron 优先**：`client.tsx` 的 `bridge.pickDirectory()` **先**检查
     `globalThis.__DSH_DIRECTORY_PICKER__`，其 `.pick()` 由 DSH Desktop 注入、走 Electron 主进程
     `dialog.showOpenDialog`（宿主 macOS `osascript` 选择器在 Desktop 下会等待 AppleEvents 不显示
     窗口或超时，故必须优先）。与官方 `dsh-client-ui-directory-picker-native/lib/client.js:63-64` 一致。
  2. **Web / 宿主 native 回退**：无 `__DSH_DIRECTORY_PICKER__` 时调用
     `uiWorkspace()?.pickDirectory()`（`Promise<string | null>`，`null` = 用户取消）。
  3. **应用内兜底**：两者都不可用则 `pickDirectory()` **抛** `directory-picker/unavailable`，
     **绝不 `catch { return null }` 静默吞错**；`sidebar.tsx` 的 `addWorkspace` 捕获后打开
     `AddWorkspaceDialog`（`P.Modal` + 目录绝对路径输入框），确认后调
     `bridge.createWorkspace(path)`（`bridge` 缺席时回退 `POST /dsh-worktree-groups/workspace-open`）
     并 `reload()`；创建失败在弹窗内显示错误，**不允许「点击无任何反应」**。
     用户主动取消（`null`）不开弹窗。
- **搜索框行为不得回归**：`value=query` / `onChange` 写 `query` / `aria-label: t('search.placeholder')` /
  `placeholder: t('search.placeholder')`；`query.trim()` 非空仍走 `buildRows` 的扁平搜索模式。
- **`buildTreeView` 的 `WorktreeExtra` 构建条件**：`project.isGit === true`（**不再是**
  `worktrees.length > 1`）—— 单 worktree 的 git 项目也有子行，子行的 `+` / `…` 需要 extra。

**运行中任务高亮（2026-10-20，T-4 落地；需求见 `docs/requirements/2026-10-20-running-task-highlight.md`）**

- **渲染落点唯一**：`ContainerRowView` 的 lead 图标 `span`（`history` 的 `clock` 必须排除）。
  判据固定为 `const runningHighlight = row.kind === 'history' ? false : row.hasRunningTasks === true`
  —— **只认 `=== true`**（旧产物/宿主漂移时 `undefined` ⇒ 不高亮、不崩）。
- **颜色 / 光晕**：高亮时在该 span 上设
  `color: 'var(--dsw-alias-state-business-primary, #4176e6)'` 与
  `filter: 'drop-shadow(0 0 2px var(--dsw-alias-state-business-primary, #4176e6))'`。
  ⚠️ **禁止**给 `icon(name, props)` 传 `style` / `color`：宿主图标组件只解构
  `size/className/strokeWidth`，其余 props 被丢弃（T-2 §3.1）⇒ 只有外层 span 生效。
  ⚠️ **不要**用 `--dsw-alias-brand-primary`（它是近黑/近白中性色，不是品牌蓝）。
- **可访问性文案**：高亮时 lead span 加 `title: t('a11y.runningTask')`（中文「有任务正在运行」，
  key 见 §2.1）；不高亮时不加（不污染普通行的 tooltip）。
- **可测试钩子**：仅高亮行的行根 `div` 带 `'data-running': 'true'`；不高亮时**不出现**该属性
  （不是 `"false"`）。与既有 `data-key` 共存。
- **不做**：整行背景、左侧竖条、`StateDot` / 数字徽章、history 高亮、未分组聚合（flat/普通会话已按 2026-10-20 追加裁决参与 project 聚合）。
- **快速刷新（第 4 条重取触发）**：在 `sessionStatus` 旁派生
  `runningSignatureValue = runningSignature(sessionStatus)`（见 §2.3.2），并把它加入既有
  **220 ms 防抖**重取 effect 的依赖：`[reload, sessionsSnapshot, currentSessionId, runningSignatureValue]`。
  - ⚠️ **禁止**把签名放进 `reload` 的 `useCallback` 依赖：那会让 `reload` 每次状态迁移都变，
    30 s 定时 effect 反复重建 ⇒ 轮询被重置为「每 220 ms 一次」（性能事故）。
  - **保留**首拉、30 s 轮询（`TREE_REFRESH_MS`）与 `window` focus 强刷作兜底；hook 调用顺序不变。
  - 量级：每个回合 ≤2 次额外 `/tree`（突发被 220 ms 合并），见设计文档 §7.4。

### 2.3.0 `src/icons.ts`（2026-10-19 新增：宿主 primitives 图标命名漂移）

```ts
export const ICON_SPECS: Record<string, { candidates: readonly string[]; size: number }>
export const ICON_NAMES: readonly IconName[]
export function resolveIcon(face: unknown, name: IconName): { Component: (props?) => unknown; candidate: string | undefined }
export function unresolvedIcons(face: unknown): IconName[]
export function iconSize(name: IconName): number
```

**背景（缺陷）**：`src/sidebar.tsx` 原来直接以**尺寸后缀**取宿主图标
（`P.IconPlusOutline16` / `P.IconChevronDownOutline14` / `P.IconArchiveOutline20`）。宿主
`@deepseek-ai/dsh-client-ui-primitives@0.1.5-rc.2` 确实这样导出（`HOST-CONTRACTS.md` §B5.1 快照），
但 `0.2.1-rc.2` 改成了**线重后缀**：`IconPlusOutlineRegular`（1px）/ `IconPlusOutlineMedium`
（1.3px），尺寸改由 `size` prop 控制，**旧的 `Icon*16/14/20` 整套消失**（实测导出表里已无任何
`Icon*` + 数字后缀的名字）。后果不是"图标不显示"，而是渲染期硬崩：
`jsx(undefined, {})` 抛 `Element type is invalid` ⇒ `SidebarBoundary` 接管成"侧栏渲染出错"，
或异常逃到宿主 `SlotErrorBoundary` ⇒ entry 被 `abdicate`、整块侧栏静默回落官方 UI。

**必须遵守**
- **`src/sidebar.tsx` 不得直接访问 `P.Icon*`**，一律经 `icon(name, props?)` 助手
  （内部调 `resolveIcon`）。`test/icons.test.mjs` 的 AST 断言钉死：任何 `P.Icon*` 属性访问即红。
- `ICON_SPECS` 的候选序列**新命名在前、旧命名兜底**，让插件对两个宿主版本同时成立；
  `test/icons.test.mjs` 另有一条**漂移哨兵**直接读已安装宿主的 `lib/index.js` 导出表，
  宿主再次改名时该条会指名缺哪个首选候选。
- **解析失败必须回落空图标**（渲染 `null`），**绝不返回 `undefined`**：宿主再改一次命名，
  代价只是少几个图标，不是整块侧栏白掉。
- 同一 `(face, name)` 必须返回**同一组件引用**（渲染稳定；否则 React 每帧当新组件类型卸载重建）。
- 尺寸：`ICON_SPECS[name].size` 是默认值，调用方显式传 `size` 时以调用方为准
  （宿主新组件默认 16，旧 `ArchiveOutline` 画板是 20）。

**验证**：`test/icons.test.mjs`（8 条：解析层双向兼容、缺席回落、引用稳定、漂移哨兵、接线 AST）
+ `test/render-smoke.test.mjs`（2 条：按真实宿主导出表造 primitives 面，SSR 渲染 `wide` 与
`wide: false` 两个分支，断言未被错误边界接管）。

### 2.3.2 `src/live-state.ts`（2026-10-19 新增：live-fact 数据源漂移）

```ts
export function visiblePendingKind(kind: unknown): string | undefined
export function normalizeSessionKey(id: string): string
export function sessionStatusOf(status: unknown, sessionId: string): unknown
export function liveStateOf(input: LiveStateInput, sessionId: string): { pendingKind: string | undefined; completionUnread: boolean }

/** 运行中会话集合签名（2026-10-20 新增，纯函数）：只取 `running === true` 的 id，归一化去重、排序、逗号拼接。 */
export function runningSignature(status: unknown): string

/** 解析当前打开的会话 id（2026-10-21 新增，纯函数）：兼容 0.2.1 `byId[*].retainedBy.mainView > 0`（受 `panelInfo.activePanelId` 约束）、0.1.5 `sessions.current` 与点击乐观选中。 */
export function currentSessionIdOf(input: { sessions?: unknown; panelInfo?: unknown; optimisticSessionId?: string }): string | undefined
```

**背景（缺陷）**：会话行的「等待确认（琥珀）」与「后台完成未读（绿点）」两个态**只能**从客户端
快照取（宿主 HTTP 面的 `SessionSummary` 没有这两个字段）。插件原来的取法在宿主 `0.2.1-rc.2`
上**双双失效**：

| 状态 | `0.1.5-rc.2` 的取法 | `0.2.1-rc.2` 实况 |
|---|---|---|
| 等待确认 | root hook `useSessionPendingInteraction` | **source 已删除**（全宿主 0 处命中） |
| 后台完成未读 | `useSessions().byId[id].completed` | **字段已删除**（`projectList()` 不再写） |

于是 US7 的这两个态永远不亮（不崩：`asHook` 把缺席 source 降级为恒 `undefined`）。
现行唯一来源是 `useSessionStatus`：

```js
new Map<SessionId, { running: boolean, pendingInteraction: { kind } | undefined, completionUnread: boolean }>()
```

**必须遵守**
- **新源优先、旧源兜底**：`status` 有该会话数据时以它为准；`useSessionPendingInteraction` 与
  `byId.completed` 仍认（宿主回退或其它组合下不至于两态全灭）。
- **`kind` 白名单**：只有 `approval` / `plan-review` / `question` 算等待确认（对齐原生
  `visiblePendingKind`）；其余 kind、非字符串、缺字段一律 `undefined`。
- **`completionUnread` 只认 `=== true`**（快照是别的形状时不误亮）。
- **id 拼法归一化**：`session-<uuid>` 与裸 `<uuid>` 都要能查到（精确命中优先，再退归一化遍历）。
- **绝不抛错**：任何不认识的形状降级为「没有该态」。
- 这两个态**纯逻辑化**的理由：以前埋在 `sidebar.tsx`（`.tsx` 不进 `lib/`）里，**零单测**；
  现在 `src/live-state.ts` 可被 `node --test` 直接覆盖。
- `RenderRow` 形状**不变**：`sidebar.tsx` 的 `withLiveState` 产出浅覆盖的新行对象。
- **`runningSignature`（2026-10-20，运行中任务高亮的刷新信号）**：
  - 输入是 `useSessionStatus(identity)` 的快照（任意形状）；输出是**稳定字符串**。
  - **只**收集 `running === true` 的会话 id（`undefined` / 缺失 / 真值对象都不算）；
    **忽略** `pendingInteraction` 与 `completionUnread`（否则审批弹窗、完成未读也会触发 HTTP 重取）。
  - id 经 `normalizeSessionKey`（`session-` 前缀）后**去重**、按 JS 默认排序（UTF-16 码元升序）、
    以 `,` 拼接；空字符串 id、非字符串 id、空条目一律跳过（结果无首尾逗号）。
  - **任何不认识的形状 / `entries()` 抛错 ⇒ 返回 `''`，绝不抛**（与本节「绝不抛错」同一条纪律）。
  - 纯逻辑：不 import react / 宿主包、无 IO、不读时间与随机数 ⇒ 可被 `node --test` 直接覆盖。
  - ⚠️ 消费方式唯一：`sidebar.tsx` 在 `sessionStatus` 旁派生该值并加入 **220 ms 防抖**依赖（§2.3）；
    **禁止**把它放进 `reload` 的 `useCallback` 依赖。

**验证**：`test/live-state.test.mjs`（10 条既有 + 2026-10-20 新增 `runningSignature` 用例 B1–B8，
见 [设计文档 §9.2](design/2026-10-20-running-task-highlight.md)：只认 `=== true`、归一化去重、
稳定排序、异常形状不抛、忽略待交互/未读）；另：新源三态、白名单拒绝、`=== true` 语义、id 两种拼法、
旧源兜底、新源优先、任意形状不抛错、空 id 不误命中、`sidebar.tsx` 接线断言）。

### 2.3.4 `src/live-merge.ts`（2026-11-14 新增：实时会话叠加层）

```ts
export interface LiveMergeTree {
  projects: ProjectNodeLike[]; ungrouped: SessionRowLike[]; archivedSessionIds: string[]
  workspaceByPath?: Record<string, string>
}
export function mergeLiveSessions<T extends LiveMergeTree>(
  tree: T,
  snapshot: unknown, // useSessions(identity)：{ byId: Record<id, { id, cwd?, updatedAt?, running?, blank?, title?, parentId?, origin? }> }
): { tree: T; pendingIds: string[] }
```

- 纯函数、不修改入参；无变化返回**同一** `tree` 引用。
- 已有行：`title`（非空才覆盖）/ `running` / `blank` 取快照；`updatedAt` 与 `lastActivityAt` 只增不减。id 比较忽略 `session-` 前缀。
- 新行：非子代理（无 `parentId`、`origin !== 'subagent'`）、未归档、有 `cwd` 的会话计入 `pendingIds`；
  cwd 等于或位于某个 `exists !== false` 的 git worktree 路径 / 非 git 工作区路径（`workspaceByPath` → `ws:<id>`）之下时，
  按**最长前缀**插入该容器最前；匹配不到不插入。

### 2.3.3 「最近」排序键（2026-10-29 新增：最后更新时间）

```ts
/** 会话最后更新时间：`max(updatedAt, 有限 lastActivityAt)`。缺失/非法 lastActivityAt ⇒ updatedAt。纯函数。 */
export function recentActivityOf(session: { updatedAt: number; lastActivityAt?: number }): number
```

**规则**：

- 「最近」分区的排序键**只**是 `recentActivityOf(session)`，降序；同值按 `sessionId` 升序 tiebreak。
- 同一 `sessionId` 在多个容器里重复出现时，去重取「活动时间更晚」的那一条（先按
  `recentActivityOf` 比较，再按 `updatedAt`、`sessionId` 兜底，保证确定性）。
- **工作区树不受影响**：`emitContainer` / `effectiveOrder` / 顶部区 / 5 条截断仍使用
  `SessionRowLike.updatedAt` 与手动顺序；`lastActivityAt` 只进「最近」分区。
- 载荷缺 `lastActivityAt`（旧服务端/旧测试构造）时行为与 WSR6 完全一致（回退 `updatedAt`）。
- 不新增渲染字段：`RenderRow` 形状不变，行上仍带原 `updatedAt`；排序键只在推导期使用。

**验收**：`test/tree-model.test.mjs` 的 `2026-10-29/RAS` 用例（按活动上浮、回退、去重、上限、
工作区树顺序不变）。

### 2.3.1 拖拽排序（D10，2026-09-21 用户决策变更）

用户 2026-09-21 要求恢复拖拽排序，并在二选一里选了 **A：拖拽即切换为「手动排序」并记住
（持久化）**。选项 A 的承诺是「后续新消息**不再**把会话顶到前面，**直到你手动切回
最近更新**」⇒ 因此**必须**有「切回默认排序」的入口（见下）。

**三个层级都可拖，各自的范围约束是硬约束**：

| 层级 | 拖拽范围 | 默认顺序（未手动时） |
|---|---|---|
| project 行 | 顶层项目之间（**未分组行不参与**，见下） | 宿主 `workspaceRegistry.list()` 顺序 |
| worktree 行 | **同一项目内**的 worktree 之间 | 主树在前，其余按 branch 字典序 |
| session 行 | **同一容器内**的会话之间（`parentKey` 相同） | `updatedAt` 降序 |

- **session 不能跨容器拖**：跨容器 = 改会话的 cwd / 归属，宿主禁止且语义不明。实现方式是
  `DragState.containerKey` + `accepts()` —— 容器的 `parentKey` 不同时 `onDragOver`
  **直接返回、不 `preventDefault`** ⇒ 浏览器显示「禁止」光标、**不画插入线**、`drop` 不触发。
  计算侧还有第二道保险：`effectiveOrder.sessions.get(containerKey)` 里根本没有别的容器的会话，
  `reorderKeys` 找不到落点 ⇒ 返回 `null` ⇒ 什么都不写（即便 `drop` 事件被伪造也改不动）。
- **worktree 不能跨项目拖**：跨项目 = 把 worktree 移到别的仓，物理上不可能。机制同上，
  键是 `ProjectNode.key`（**不是** `WorktreeExtra.repoPath` —— 后者是主仓路径、未注册时缺失，
  且与项目 key 的拼法不同，拿它比较必然失配；`TreeView.worktreeOwner` 专为此存在）。
- **换算入口统一为 `reorderManualScope(order, defaults, …)`（2026-10-22 DR6）**：`commitDrag`
  的三层分支都必须先 `reconcileManualOrder` 把「持久表」与 `effectiveOrder` 的**当前默认顺序**
  对齐，再 `reorderKeys`。**禁止**直接拿持久表调 `reorderKeys` —— 持久表是首次拖拽时固化的
  快照，之后新增的工作区 / worktree / 会话不在表里，`reorderKeys` 会因「拖拽源或落点不在表里」
  返回 `null`，整次拖拽**静默无效**（用户报告：「没法拖动工作区进行排序」）。由
  `test/sidebar-wiring.test.mjs` 的 `2026-10-22/DR6 接线` 用例锁定（三层各一次调用、第二实参
  必须可追溯到 `defaults.*`、`sidebar.tsx` 不得 import `reorderKeys`）。
- **未分组行不参与拖拽**（它不是真实项目，§2.6 裁定 1），但它是**静止边界**：
  `effectiveOrder.projects` 不含 `UNGROUPED_KEY`，所以项目**拖不到未分组之后**。
- **`wide === false`（轨道态）不启用拖拽**：那一态只渲染一个 36px 图标按钮，没有行可拖。

**交互（对齐原生 `dsh-client-ui-workspace/lib/client.js`）**：

```js
draggable: drag !== undefined,
onDragStart: (e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', row.key); drag.start() },
onDragEnd: drag?.end,
onDragOver: (e) => { if (!drag.active) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; drag.hover(rowHalf(e)) },
onDrop: (e) => { if (!drag.active) return; e.preventDefault(); drag.drop(rowHalf(e)) },

/** Pointer-position half of a row (insert line above or below). */
function rowHalf(e) {
  const rect = e.currentTarget.getBoundingClientRect()
  return e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
}
```

**T5 必须遵守**
1. 用 **HTML5 原生拖拽 API**（`draggable` + `dataTransfer`），**禁止**引入第三方拖拽库。
2. **上半 / 下半决定插到前面还是后面**（`rowHalf` 语义，逐字对齐原生）。
3. **显示插入指示线**：`before` = 该行上方一条 2px 线，`after` = 下方。颜色用宿主 CSS 变量
   `var(--dsw-alias-brand-primary)`；线**绝对定位在行内**（行加 `position: relative`），
   不占布局、不推动其它行。
4. 被拖的行加视觉反馈（`opacity: 0.45`）。
5. **`onDragEnd` 必须清理状态**：拖到空白处松手 / 按 Esc 取消时 `drop` **不会**触发，
   只有 `dragend` 会 —— 漏了这一步插入线会永久残留。
6. **不能破坏现有交互**：行点击展开 / 折叠、hover 显示按钮、右键菜单全部照旧。行内的
   `<button>` 必须 `draggable={false}` + `onDragStart` 阻止冒泡，否则按住 `+` / `…` 拖动
   会拖走整行。
7. 拖拽**不产生任何宿主写入**：全部走 `localStorage`（见下）。宿主 `insertBefore` /
   `insertSessionBefore` 一律**不调用**（理由见 §2.2 的 `ManualOrder`）。

**顺序持久化**

- 键：`dsh-worktree-groups.order`（与 `.collapsed` / `.expandedAll` 命名风格一致）；
- 结构：`ManualOrder`（见 §2.2）；
- **首次拖拽时把 `manual` 置 true，并把当前看到的顺序全量固化**（`effectiveOrder` 的输出）。
  只挪一项、其余仍按 `updatedAt` 排的话，下一条新消息照样会顶上来 —— 用户会认为排序没生效。
  「全量固化」才是选项 A 那句承诺的实现方式。固化输入用 `effectiveOrder({...input, manualOrder: undefined})`，
  即**纯默认顺序**（不折叠、不截断，所以「第 6 条之后」的会话也被正确冻结）。
- ⚠️ **固化的是「不含运行时顶部区」的顺序（T11 终裁后语义不变）**。`effectiveOrder` 刻意
  **不应用**任何运行时置顶，所以 `commitDrag` 写进 `localStorage` 的永远是**真实顺序**：
  用户关掉那个会话后它不会赖在最前面，持久顺序也不会被运行时状态污染。
  **不要**把固化输入换成 `buildRows` 的可见顺序（那会把置顶钉进持久化）。
  这条被测试锁定：`test/tree-model.test.mjs`「T11: `effectiveOrder` **不**应用运行时顶部区」与
  「T11: `JSON.stringify(order)` 的持久化载荷里**没有**置顶痕迹」。
- ⚠️ **T5/T11 强化**：`effectiveOrder` 里 `context.topZone` 被**硬置 `undefined`**（不只是「不传」），
  所以「运行时顶部区混进持久顺序」在**结构上不可能**。锁定于
  `test/tree-model.test.mjs`「T5/持久化: 运行时顶部区不写持久顺序 —— 载荷与 `topZone` 完全无关」
  与「T5/持久化: `effectiveOrder` 的 JSDoc 不变式」。
- ⚠️ **唯一允许写持久顺序的运行时动作是 D2 的新会话插入**（`planNewSessionInserts` 编排、
  `insertSessionAtFront` 落表，由 `sidebar.tsx` 在观测到新会话时调用）：
  **只在 `manual === true`** 时生效、**幂等**（已在表首则不写）、**去重**（不产生重复条目）、
  **只写这一个新会话**（`running` 与新会话提升本身一律不进表）。
  默认模式下**不写、不建表** —— 绝不因为「新建了一个会话」就把用户静默切成手动排序模式。
  锁定于「T5/D2」「T7/B1」「T7/B2」系列用例。
  - **写入形态（T6 缺陷 B1）**：写入的字符串 = **树/表里的真实 id 形态**（宿主真实 id 恒带
    `session-` 前缀），由 `placementOfSession` 取得。绝不写入 `observeTopZone` 归一化后的
    裸 id —— 那是**永远匹配不上的死条目**，还会顶掉原本正确的条目（D2 的核心承诺
    「刷新后新会话仍在第一位」会因此失效，并实质违反 D1「不代改用户 localStorage」）。
  - **编排层收敛（T6 缺陷 B2）**：`observeTopZone` 的 `newSessionIds` 在本进程内**只增不减**
    （它是顶部区输入，不能因落表而移除），而落表 effect 的依赖含 `manualOrder`
    ⇒ **用户每次拖拽都会重跑**。收敛机制 = 落表后把该 id 记进
    `TopZoneState.writtenNewSessionIds`（`markNewSessionsWritten`）⇒ 同一个新会话的落表
    **只发生一次**；用户随后把它拖到任何位置都**不会被回滚**。原实现在编排层不收敛 ⇒
    用户在本页面会话内无法把刚建的新会话拖离第一位（持久顺序被静默改写）。
- 读写全部 `try/catch`（隐私模式会抛）：失败时退化为 `{ manual: false }` = 默认顺序，**不崩**。
  从 `localStorage` 读回的内容按 `unknown` 收窄清洗（只留非空字符串、去重）—— 那是用户可以
  手改、也可能是**上一个版本**写的，不清洗就会把 `undefined` 当 key 传下去。
- 顺序列表里没有的项 ⇒ 排在该列表**末尾**（按各自默认顺序）；列表里已不存在的项 ⇒ 忽略。
  **例外**：① 顶部区的**两类**（运行中 / 未落表的新会话，T11 终裁）在**渲染期**被提升；
  ② 手动模式下**新会话**还会被 `insertSessionAtFront` **写进**固化表最前
  （D2，唯一落表例外）。① 是**渲染期**行为，与持久化的内容无关（见 §2.2「顶部区」）。

**「切回默认排序」入口（选项 A 的必要配套）**

- 词条 `menu.resetOrder` → 「恢复默认排序」，加进 §2.1 冻结集；
- 行为：清除 `localStorage` 里的顺序键 + 立即重排 + `reload()`；
- **仅当 `manual === true` 时显示**（选「仅 manual 时显示」而不是「常显 no-op」：`manual`
  状态就在 `MenuLayer` 的 props 上，判断成本为零；菜单里放一个点了没反应的项比不放更糟）。
- **git 项目行与非 git 工作区行都要有**（需求原文），因此该段代码放在 `isGit` 分支**之外**；
  worktree 行与会话行也一并提供（用户刚拖完时 `…` 就在手边）。**未分组行不给**（它不参与拖拽）。

### 2.4 `src/client.tsx`（T5 写）

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'dsh-worktree-groups'
export const inject: string[]

export function apply(ctx: Context): void
```

**必须遵守**
- 用 `ctx.slots.inject('sidebar.workspaces', ...)` + `ctx.slots.register({ name:'sidebar.workspaces', priority: -1, children: { 'sidebar.workspaces.directoryFlow': { kind:'single', scope:'root' } }, inject: () => ({...}), locale: 'dsh-worktree-groups' }, SidebarBrowser)` 抢占。
- 所有宿主服务用 `ctx.get('x')` 惰性读取，缺失时降级（不抛）。
- **D9 — `locale` 的失败模式（勿误读）**：`inject` 数组里**只放 `slots`**；`locale` 不写进
  `inject`，否则 locale 缺席时 entry 永久 pending ⇒ `assertEntriesActive` 硬失败 ⇒ 整页白屏。
  但 **`register` 里的 `locale` 声明本身是「声明即无退路」**：renderer 的 `standardKit` 在
  `entry.locale !== undefined && host.locale === undefined` 时**抛 `SlotAssemblyError`** ⇒
  entry 被剔除（abdicate）、静默回落官方 `ui-workspace`；抛出点在**父层**，组件内的
  `ErrorBoundary` **接不到**。因此组件里的 `FALLBACK_T`（内置 `zh`）**不是** locale 服务
  缺席的兜底（那种情况组件根本不会被渲染），它只在**能拿到 props 但没拿到 `t`** 时生效。
  当前组合安全：`dsh-web-app/cordis.patch.yml` 挂载了 `locale`。详见 `src/client.tsx` 文件头。
- **D15（2026-09-23）— 词典注册必须走 `ctx.inject(['locale'], cb)`，不许一次性 `ctx.get` 探测**：
  DSH web 启动**并发创建所有 client entry**
  （`dsh-web-frontend` 的 `runPluginBoot`：`Promise.all(manifest.plugins.map(id => loader.create({ name: id })))`），
  而 `dsh-client-locale` 自己的 fiber 还要等 `slots` + `remote` + `settingsScope`
  ⇒ **本插件的 apply 完全可能先跑**。旧写法（一次性 `ctx.get('locale')` + 缺席静默跳过）
  在这种时序下会漏注册词典，而 entry 声明式拿到的 seat 仍指向**空命名空间**
  ⇒ 宿主 `translate` 返回 key 本身 ⇒ 侧栏满屏裸 key（2026-09-23 用户报告的缺陷）。
  `ctx.inject` 建的是**子 fiber**：locale 出现时补跑注册，且**不进 `loader.entries()`**
  ⇒ 不会把本 entry 拖成 pending（与 D9 不冲突：D9 禁止的是写进导出的 `inject` 数组）。
  两条断言由 `test/sidebar-wiring.test.mjs` 的 `T16/取词` 钉死（注册必须在 `ctx.inject` 回调内、
  导出的 `inject` 数组不得含 `locale`、entry 仍须声明 `locale: LOCALE_NS`）。
  第二层保险见 §2.1 的 `createSeatT`（`sidebar.tsx` 的取词入口必须过它）。
- **`bridge.startSession(workspaceId, options)` 必须转发 `options`（2026-10-22 DR1）**：
  `uiWorkspace.startSession(workspaceId, options)` 的第二参是宿主「是否复用同目录空白会话」的开关
  （`dsh-client-ui-workspace/lib/client.js:1499` / `:1403`）；漏传 ⇒ 每次铸新空白会话 ⇒
  未发送草稿随旧 blank 会话被隐藏。**降级路径**（`uiWorkspace` 缺席时
  `void sessions.create({ workspaceId })`）**不**保留草稿，因为宿主 `session.create` 只有在请求
  **点名 `sessionId`** 时才复用（`dsh-api-session-controller/lib/index.js:264`），插件不替宿主挑
  blank 会话。由 `test/sidebar-wiring.test.mjs` 的 `2026-10-22/DR1` 用例锁定。

## 2.5 宿主包依赖规则（T2 实测后追加，T3/T5 必须遵守）

**实测结论**：`@deepseek-ai/*` 包在 link 安装的插件里**无法静态 import**。

- 该包只存在于 `/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/`，本包 `node_modules` 里没有
- 即使装上，`@deepseek-ai/dsh-home-paths` 的 `package.json` 声明了 `"types": "./lib/types/index.d.ts"`，但该 `.d.ts` **实际不存在** ⇒ 静态 import 必然 `TS2307`

**统一规则**

1. 宿主服务一律通过 **`ctx` 运行时拿**（`ctx.get('x')` / `ctx.x`），**绝不** `import type` 宿主包——`Context` 类型本身除外（`@deepseek-ai/cordis` 在 devDependencies 里有，且它**有** `.d.ts`，可静态 import）。
2. 需要宿主包的工具函数（如 `defaultDshHome`）⇒ **惰性动态 import + 环境变量回退**（T2 已在 `ledger.ts` 落地，照抄该姿势）：
   ```ts
   const mod = await import(/* @vite-ignore */ specifier)  // specifier 用变量，避免 tsc 解析
   ```
3. 客户端半边**额外**禁止静态 import `@deepseek-ai/dsh-client-ui-primitives` 的**类型**——它是 esbuild `external`，运行时由 shell 注入；组件按 `any` 收窄使用（T5 见 `docs/HOST-CONTRACTS.md` 的结论）。
4. 数据结构的类型（`WorkspaceRow` / `SessionRow` / `ProjectNode` …）**自己定义**在 `src/types.ts`，不 import 宿主类型。

## 2.6 T4 回报后的契约裁定（主代理裁决，T5 必须遵守）

T4 提出三处契约缺口，裁定如下：

**裁定 1：未分组复用 `project` 行 —— 接受。**
`RenderRow` 不新增 kind。未分组行的判别键为 `key === UNGROUPED_KEY`（`'__ungrouped__'`，由 `tree-model.ts` 导出）。
**T5 要求**：未分组行必须隐藏「重命名项目」「新建 worktree」入口（它不是一个真实项目），
且**不渲染任何 hover 动作按钮**（`renderActions` 返回 `[]`）。

**裁定 1.1（2026-09-21 修订）：行按钮布局按 `isGit` 二分 —— 覆盖原「未分组隐藏添加工作区」的表述。**

用户 2026-09-21 明确要求（原话见 PRD §5.2.1）：

| 行 | hover 按钮 | 菜单内容 |
|---|---|---|
| git 项目行 | **只有 `…`** | **只有**「新建 worktree」一项 |
| worktree 行 | `+`（新会话）与 `…`（D14 全套） | 不变 |
| 非 git 工作区行 | **只有 `+`**（新会话） | **右键菜单保留**（唯一的重命名 / 删除工作区入口） |
| 未分组行 | 无 | 无 |

- **「添加工作区」（`MENU.addWorkspace`）已从菜单常量与 `handleSelect` 分支中删除**；
  入口改为**侧栏顶部搜索行右侧的独立 `+` 图标按钮**（`t('project.add')`，
  `onClick` → `actions.addWorkspace()`，行为与原先的菜单项逐字相同：`pickDirectory` →
  `workspaces.create`，失败落 `loadError`，`uiWorkspace` 缺席时静默降级）。
- 搜索框行为**不得回归**：`value` / `onChange` / `aria-label: t('search.placeholder')` 与
  「非空 `query` ⇒ `buildRows` 扁平模式」的口径全部保持。

**裁定 2：`more` 行不提供 label —— 接受。**
**T5 要求**：渲染 more 行时自行取词：
```ts
// 2026-11-14 PX 起：hiddenCount > 0 ⇒ t('sessions.expandMore', { n: nextCount })；canCollapse ⇒ 另给 t('sessions.collapse')
```

**裁定 3（2026-09-21 修订）：子代理不渲染任何行 —— 与原生对齐（撤销原「保留嵌套」裁定）。**

已核实原生 `sessionVisible` 为 `session.origin !== "subagent" && ...`（`dsh-client-ui-workspace/lib/client.js`），即原生**完全不渲染**子代理行，只在父会话行显示「N 个子代理运行中」。

**原裁定**（依 PRD D10 的「+ 子代理嵌套」）**已被用户需求变更推翻**：用户明确要求「只需要列出主 agent 的会话」。现改为与原生**逐字对齐** —— 本插件在这一点上**不再存在有意差异**。

**T4/T5 要求**
- 过滤点**单一**：`tree-model.ts` 的 `isVisibleMember` 是唯一的会话可见性谓词，逐字对齐原生 `sessionVisible`。树（`visibleMembers`）、搜索（`collectSearchCandidates`）、容器行存在性（`hasVisibleMembers`）三处全部走它，**不允许任何一处自行过滤**（独立审查曾靠这种分叉发现过缺陷）。
- `RenderRow`（§2.2）的**字段集合不变**：`subagentCount` 保留，但**取值语义修正**为「**运行中的**子代理后代数（所有层级）」，对应原生 `runningSubagentCount`（`indexSubagentDescendants`）；为 0 时不渲染胶囊。
  - 旧语义是「直接子代数（不论是否在跑）」，与胶囊文案 `a11y.subagents` = `'{n} 个子代理运行中'` **不符**（不跑的子代理被算进「运行中」）。
- **`RenderRow.running` 的取值语义修正（需求 A，2026-09-21）**：`running = 该会话自己的
  `SessionSummary.running` || subagentCount > 0`。对齐原生 `sessionStatuses`
  （`dsh-client-ui-workspace/lib/client.js`：`if (subagents !== void 0) return [subagents]`，
  即 `runningSubagentCount > 0` ⇒ 主状态点就是 ongoing）。原实现只读会话自己的 summary
  ⇒ 「主 agent 空闲 + 子代理在跑」退化成灰 idle，与原生不符。
  - **判据写在唯一构造函数 `toSessionRow` 里** ⇒ 树（`emitContainer`）与搜索
    （`buildSearchRows`）**两条路径同源**，不可能「树里改了、搜索里忘了」。
  - **不需要任何新数据源**：`subagentCount` 本来就是原生 `runningSubagentCount`，
    多层链（真实数据有 depth 3）由 `indexRunningSubagentDescendants` 一并累加到顶层可见行。
  - 字段名、类型、`subagentCount` 与 `running` 的**独立存在**都不变 ⇒ `sidebar.tsx` 的
    `StatusDot` / 计数胶囊**一行都不用改**（前者读 `row.running`，后者读 `row.subagentCount`）。
  - ⚠️ **`runningCount` 的口径刻意不变**（仍只数 `session.running`）：渲染层**无消费者**
    （`grep runningCount src/sidebar.tsx` 为空），用户裁决 Q1 明确「不改」，避免无声扩大契约。
- **`nestSubagents` 保留**并继续服务于计数：`indexRunningSubagentDescendants` 经它（`discoverChildEdges`，不动点迭代补齐深层边）解出父子关系，从而复用它的 `session-` 前缀归一化与「父必须在集合内」判定。**它不是死代码**。
- `sessionCount` / `runningCount` / `pendingCount` 的**口径不变**：仍只统计顶层会话 —— 现在「顶层」天然等于「非 subagent」，语义更强。
- 5 条截断、blank 语义、归档排除**全部不变**。当前会话**本身就是 subagent** 时同样不渲染该行（原生亦然）；⚠️ **T13**：`currentSessionId` **不再**参与截断（`truncateSessions` 的 `currentSessionId` 形参与其保底分支已删除），它在本模块里只剩「blank 会话豁免」与 `RenderRow.isCurrent` 高亮两个用途。
- **顶部区（T11，2026-09-22 用户终裁）**：`applyManualOrder` 的可选第 4 参 `pinnedKeys`
  由 `emitContainer` 组装：**首位是当前空白占位行**（`isCurrentBlankSession`，2026-10-22 DR4），
  其后是 `topZoneSessionKeys` 的产物（判据 = `running ∪ 未落表的新会话`），`context.topZone`
  由调用方传入。**纯运行时推导**，`effectiveOrder` 里 `context.topZone` 被**硬置 `undefined`**
  ⇒ 结构上杜绝持久化污染（占位行同样不写表）。⚠️ T11 删除了「当前会话置顶」（`isCurrent`）、
  「刚结束保留」与「拖动释放」三层语义，详见 §2.2「顶部区」。⚠️ 2026-10-22 DR4 只恢复
  **blank 占位行**的置顶（不是 `isCurrent` 的回退）；DR5 让该行**不可起拖**，避免「拖完弹回」。
  - **运行中的会话不可拖动**：`sidebar.tsx` 的 `dragHandlersFor` 新增 `draggable` 参数，
    调用点传 `!isTopZoneRunningSession(row, topZone)` ⇒ 运行中的行 `draggable: false`
    （仍接受落点）。判据与置顶判据**同源**，不可能分叉。
  - **运行时状态机下沉到纯函数**（`observeTopZone` / `observationsOf` / `topZoneInputOf` /
    `isTopZoneRunningSession` / `planNewSessionInserts` /
    `markNewSessionsWritten` / `insertSessionAtFront` / `placementOfSession` /
    `containerKeyOfSession`）——
    `sidebar.tsx` 是 `.tsx`、**不进 `lib/`、`node --test` 跑不到**，所以「哪些会话进顶部区」
    的**全部判定**必须可单测；`sidebar.tsx` 只负责「采集观测 + `useState` + 调纯函数」。
  - **「新会话」判定口径**：本进程内 `blank: true → 非 blank`（强证据），或首次观测到且
    `updatedAt >= 本进程基线时刻`（时间序证据）。**绝不**用「不在固化表里」——
    T4 实测有 4 条**旧**表外会话会被误插到最前。残余不确定性见 PRD US8「顶部区」段。
  - **归档语义（T6 缺陷 I3）**：`knownSessionIds` **含归档与子代理**（「存在过」的事实），
    但 `eligible` **排除**它们（不参与顶部区判定）⇒ 取消归档 + 新消息**不会**被误判为新会话。
  - **D2 落表是唯一例外**：`planNewSessionInserts` + `insertSessionAtFront` **只在
    `manual === true`** 时把新会话**幂等、去重**地插到其容器固化表最前，且写入的是
    **树里的真实 id 形态**（T6 缺陷 B1）；默认模式**不写、不建表**（不静默把用户切成手动模式）。
    落表后由 `markNewSessionsWritten` 记台账 ⇒ **编排层收敛**，用户拖动新会话不被回滚
    （T6 缺陷 B2）。⚠️ **T9 缺陷 1 补齐**：该台账还须经 `topZoneInputOf` **投影进
    `TopZoneInput.writtenNewSessionIds`** —— 已落表的新会话**不再**被渲染期提升，否则
    `buildRows` 仍会把它画回表首（真人 GUI 复验的「拖动新会话弹回原位」）。
  - **拖拽只改写持久顺序（T11/T13）**：`commitDrag` 不再有任何顶部区动作
    （`isTopZoneReleasingDrag` / `releaseTopZoneContainer` / `releasedContainerKeys`
    已随「刚结束保留」一并删除）。已结束的会话（含刚跑完的、含当前打开的）拖到哪就留在哪，
    **不回弹**，且**不被任何保底提位**（D12 保底已删除，见上「D12 保底已删除」）；
    运行中的会话**不可拖动**（上一条）。
  - **T3 次要问题同步修复**：① `currentSessionId` 非字符串时不再抛 `TypeError`
    （`topZoneSessionKeys` 已完全不读它；`truncateSessions` **已不接受** `currentSessionId`
    形参 —— T13 起该参数与其保底分支一并删除，见上「D12 保底已删除」）；② 本节
    `subagentCount > 0 蕴含 running` 的表述补「对 `RenderRow.kind === 'session'` 而言」限定语；
    ③ ~~`truncateSessions` 的保底提升分支在树路径已不可达 ⇒ 补注释说明、不删代码~~ ——
    **T13 已推翻该处置**：用户终裁**删除**该分支（它变成可达后与「拖拽顺序完全优先」冲突），
    故**删代码**而不是补注释。

**裁定 4（2026-09-21 修订）：单 worktree 的 git 项目改用 worktree 子行 —— 推翻原「取 `worktrees[0].sessions`」的平铺写法。**

`buildProjects` 的 `'worktree'` 分支把会话推入 `node.sessions`；`flatSessions` 仅用于非 git 工作区
（`'flat'` 分支）。这一点**不变**，宿主侧**无需改动**（T1 实现本来就把会话正确放进 `node.sessions`）。

**变更的是客户端容器划分**：原实现（依 D11 原文）在单 worktree 时把 `worktrees[0].sessions`
塞进 `Containers.flat`，让它平铺在 project 行下。用户 2026-09-21 推翻了 D11 的这一半
（三选一里选 C），现改为：

```ts
const hasWorktreeRows = project.isGit === true        // 旧：project.isGit && project.worktrees.length > 1
```

**连带要求**
- `Containers.flat` 只在 `!isGit` 时存在，且**不再**带 `worktree` 字段；会话直接取 `project.flatSessions`。
- `sidebar.tsx` 的 `buildTreeView` 必须对**所有** git 项目构建 `WorktreeExtra`
  （旧条件 `project.isGit !== true || project.worktrees.length <= 1` 会让单 worktree 项目的
  子行拿不到 extra，渲染成无动作按钮的空容器行）。
- `RenderRow.worktreeCount`（§2.2）语义随之变为「git 项目恒 = `worktrees.length`，非 git 恒为 0」。
- 搜索：git 项目走 worktree 子行 ⇒ `ContainerSpec.worktree` 恒非空 ⇒ 分支名可搜性**天然成立**，
  原「恰好 1 个 worktree 时给 flat 挂 worktree」的特例成为多余，已删除（PRD R9 同步改写）。
  非 git 工作区的 flat 容器**保留**（那类项目的会话仍需平铺），但它本来就没有分支名。

## 2.7 宿主契约调研后的裁定（主代理裁决，T3/T5 必须遵守）

`docs/HOST-CONTRACTS.md` 用实测推翻了契约里的若干假设。裁定如下：

### 裁定 5：`sidebar.workspaces.directoryFlow` 改为**自建新键**（覆盖 PRD D19 的实现方式，**用户可见行为不变**）

**事实**（已由主代理独立复核）：
- `SlotCore.register` 对**同键重复声明**抛错：`dsh-client-ui-slots/lib/index.js:100-103`
- 官方 `ui-workspace` 自己就声明了 `sidebar.workspaces.directoryFlow`，且它**同时提供 `uiWorkspace` 服务**，该服务是另外 5 个客户端插件的硬 `inject` 依赖 ⇒ **不能禁用它**（禁用会导致 `web boot: N entries did not activate` 硬断言 ⇒ 整页白屏）

**裁定**：采用**路线 3** —— 声明**自己的** child 键：

```ts
children: { 'sidebar.workspaces.worktreeDirectoryFlow': { kind: 'single', scope: 'root' } }
```

「添加工作区…」的交互**自实现**（用户可见结果与 D19 完全一致：按钮在侧栏、点开是系统目录选择器、选完建/归入项目）：

```ts
const uiWorkspace = ctx.get('uiWorkspace')
const path = await uiWorkspace?.pickDirectory()   // Promise<string | null>，null = 取消
if (typeof path === 'string') await ctx.workspaces.create({ path })
```

**注意**：`pickDirectory()` 在 **`uiWorkspace`** 服务上，**不在** `ctx.workspaces` 上（参考插件 `REF/src/client.tsx:2072` 写错了，别照抄）。

**裁定 5 补充（2026-10-21 Fix3：Desktop 必须优先原生桥）**：官方
`dsh-client-ui-directory-picker-native/lib/client.js:63-64` 的真实写法是

```js
const desktop = globalThis.__DSH_DIRECTORY_PICKER__
const pick = desktop === void 0 ? () => ctx.uiWorkspace.pickDirectory() : () => desktop.pick()
```

本插件 `createBridge().pickDirectory()` **必须同构**：① 优先 `globalThis.__DSH_DIRECTORY_PICKER__.pick()`；
② 回退 `uiWorkspace()?.pickDirectory()`；③ 两者都不可用**抛错**，由 `sidebar.tsx` 打开
`AddWorkspaceDialog` 兜底。**禁止** `catch { return null }` —— 那会把「选择器不可用」伪装成
「用户取消」，正是「点击 `+` 无反应」的根因（详见
`docs/worklog/2026-10-21-workspace-delete-selection-recent.md` §7）。

### 裁定 6：会话数据源以 `session.cwd` 为准，**禁止**用 `workspace.sessionIds` 做归属

**事实**：`workspace.sessionIds` 是会**实时过滤**的 getter（`dsh-workspace/lib/index.js:102-104`），cwd 不匹配的会话会被静默剔除 ⇒ 直接用它会导致 PRD D6/G4「分布不变」**丢会话**。这正是 PRD R3 那条 `filtered session from membership` 警告的来源。

**裁定**：
- 全量会话来源 = **`ctx.sessionPersistence.list()`**（`Array<{header, revision, sizeBytes?}>`，遍历磁盘，**含 cwd 已死的会话**）
- 归属判定 = `header.cwd`（T1 的 `buildProjects` 已经这么做了，**无需改动**）
- 实时状态（`running`/`blank`/`pendingInteraction`/`updatedAt`）来源 = `ctx.get('sessions').list()` 的 `SessionSummary`，**按 sessionId 左连接**到全量历史之上

**D13 加强**：`WorkspaceRow` **不再投影 `sessionIds`**（`types.ts` 无该字段，`routes.ts` 的
`toWorkspaceRow` 与 `HostWorkspaceEntity` 也都不再声明/填充它）。也就是说本裁定不再只靠
注释约束：**从类型上就拿不到 `sessionIds`**，下一个改动者无法「顺手」用它做归属判定。
宿主的 `sessionIds` getter 仍存在于宿主侧（`workspaceRegistry`），只是本包不再读取。

### 裁定 7：孤儿会话的排序字段回退

**事实**：`updatedAt` 只在 `SessionSummary` 上；`SessionHeader` 只有 `createdAt`。已死的 cwd 会话可能没有 summary。

**裁定**：`SessionRow.updatedAt` 取值顺序 = `summary.updatedAt ?? header.createdAt ?? 0`。**必须**回退，否则孤儿会话会因 `undefined` 排到末尾或触发 NaN 排序。T3 负责在组装 `SessionRow` 时完成这个回退。

### 裁定 8：`cwd` 可缺失必须处理

**事实**：`SessionHeader.cwd` 是**可选**的（宿主存在 `_no-cwd` 分支）。

**裁定**：`cwd` 缺失的会话一律进「未分组」，不参与任何项目归属判定。T1 的 `assignSession` 需保证 `cwd === undefined` 时走 `ungrouped`（若未覆盖，T3 在组装时兜底过滤）。

### 裁定 9：台账家目录改用 `dshHomePath`（覆盖 PRD D21 的实现细节）

**事实**（主代理已复核）：`defaultDshHome()` = `homedir()/.dsh`，**不读 `$DSH_HOME`**；`dshHomePath(...)` = `resolveDshHome()` + join，**会读 `$DSH_HOME`**。
本机 `DSH_HOME=/Users/dev/.dsh` 与默认值恰好相同，故当前无可见差异；但若用户日后改 `$DSH_HOME`，现实现会写错位置。

**裁定**：`createFileLedger()` 的家目录解析优先 `dshHomePath('worktree-groups.json')`，失败再退 `defaultDshHome()`，最后退 `process.env.DSH_HOME ?? ~/.dsh`。（T2 已实现最后两级回退，只需把第一级插到最前。）

### 裁定 10：`wide: false`（侧栏轨道态）必须处理

**事实**：宿主在侧栏折叠时以 `wide: false` 渲染**同一个槽位**，且 `expandSidebar` 一并传入。

**裁定**：T5 必须在 `wide === false` 时渲染紧凑 icon 列（不得抛错、不得撑破布局）。参考 `REF/src/client.tsx` 的 `compact` 分支姿势（用 `ResizeObserver` 或直接信 `wide`）。

## 3. 构建产物约束

- `lib/index.js`：由 `tsc` 从 `src/index.ts` 产出（Node ESM）。
- `lib/client.js`：由 esbuild 打包 `src/client.tsx`，形态必须是
  `window.__ModuleLoader__.load({id:"dsh-worktree-groups",factory:(require)=>{...return module.exports;}});`
- `external` 只能是：`react`、`react/jsx-runtime`、`@deepseek-ai/dsh-client-ui-primitives`。其它一切必须打进 bundle。

## 4. 测试要求（T6）

`node --test`，文件放 `test/`，从 `lib/` 导入编译产物（`npm test` 会先 build）。

| 文件 | 覆盖 |
|---|---|
| `test/projects.test.mjs` | `looksLikeWorktreeOf` 正反例；`buildProjects` 的 5 条归属规则各一例；worktree 排序；归档排除 |
| `test/ledger.test.mjs` | 空文件读取；往返写读；`update` 串行化；坏 JSON 备份并返回空台账；原子写不产生半截文件 |
| `test/tree-model.test.mjs` | `truncateSessions` 的 5 条截断（**T13 起无保底**，签名 `(sessions, limit)`）；`nestSubagents` 悬挂与兜底；`buildRows` 的展开/折叠/搜索/blank 规则；**D10 手动排序**：`applyManualOrder` 的六条纯函数语义（列表内重排 / 列表外追加 / 已消失忽略 / `undefined`·空数组原样 / 空输入 / 不改入参）、`reorderKeys` 的上下半与跨范围拒绝、`effectiveOrder` 的三层完整顺序、`buildRows` 上「手动顺序先于 5 条截断生效」与「**手动顺序完全决定**当前会话位置（T13 已删除保底）」的集成断言 |
| `test/sidebar-wiring.test.mjs` | **T13 新增、T15 扩到 10 条的源码级契约测试**（`.tsx` 不进 `lib/`，`node --test` 无法执行它）：用 TypeScript 编译器 API 解析**真实 `src/sidebar.tsx`**，断言 T11 的拖拽接线 —— `dragHandlersFor` 三形参（第 3 个 `draggable` 默认 `true`）、`draggable` 带进返回值、`onDragStart` 的 `!draggable` 守卫、全文件恰好 3 个调用点、session 行传入 `!isTopZoneRunningSession(row, topZone)`、worktree·project 行**不传**第 3 实参、判据从 `./tree-model.js` import、全 `src/` 只有**一份** `isTopZoneRunningSession` 声明。**T15 追加两条 `T13/接线[P2]`**：① `SessionRowView` / `ContainerRowView` 都必须把 `drag.draggable` 接到 DOM `draggable` prop（捕获 T14b 实测的 `draggable: true` 写死变异）；② `topZone` 实参必须**身份可追溯**到 `topZoneInputOf(...)`（或其标识符中转），不得写死 `undefined` / 换无关来源。捕获 T12 的 M7/M8 变异（`tree-model.test.mjs` 对它们 fail 0）。变异清单见 `test/mutation-t11.md`（T15 追加 §4：M-A…M-G） |

测试必须**真实断言**（不许 `assert.ok(true)` 充数），且用临时目录（`fs.mkdtemp`）做文件类测试，测完清理。
