/**
 * 宿主 HTTP 路由（契约见 `docs/INTERFACES.md` §1.5）。
 *
 * 五个路由全部挂在 `/dsh-worktree-groups/` 前缀下，用 `ctx.effect` +
 * `ctx.webServer.register({ kind: 'exact', path, handler })` 注册（宿主契约
 * 见 `docs/HOST-CONTRACTS.md` §A3）。全部 handler 都把异常收敛成 JSON，
 * **永不**抛到 HTTP 层（宿主在 handler 抛错时只回 400 空体，客户端拿不到原因）。
 *
 * ## 数据组装（本文件的重头）
 *
 * 侧栏树的数据必须同时覆盖两个事实源，见 `docs/INTERFACES.md` §2.7 裁定 6：
 *
 * | 事实 | 来源 | 为什么不能用另一个 |
 * |---|---|---|
 * | 全量历史会话（含 cwd 已删除的孤儿） | `ctx.sessionPersistence.list()` | `sessions` 只有进程内活着的实例 |
 * | 实时状态（running/blank/updatedAt/title） | `ctx.sessionController.list()` | `sessionPersistence` 只有 `createdAt`、没有 `updatedAt` |
 * | 工作区（id/path/title） | `ctx.workspaceRegistry.list()` | `sessionIds` getter 会实时过滤掉死 cwd 会话（§A4.5） |
 * | worktree 事实 | `scanRepo()`（按 commonDir 去重 + 30s 缓存） | — |
 *
 * 两侧按 `sessionId` **左连接**到全量历史之上：以全量历史为主表，实时状态只补字段。
 * 孤儿会话没有 summary ⇒ `updatedAt` 必须按裁定 7 回退到 `header.createdAt`，
 * 否则会得到 `undefined`（排序 NaN / 排到末尾）。
 */

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, readdir, realpath, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'

import { normalizePath, runGit, scanRepo } from './git.js'
import { attachLastActivityTimes, registerSessionActivityObserver, sessionActivityVersion } from './activity.js'
import { createFileLedger } from './ledger.js'
import { buildProjects, collectUngrouped } from './projects.js'

import type { LedgerArchivedProject, LedgerData, LedgerStore } from './ledger.js'
import type { ArchivedProjectRow, ProjectNode, RepoInfo, SessionRow, WorkspaceRow, WorktreeEntry } from './types.js'

/** 全部路由的统一前缀（路由表是全局的，必须带自己的命名空间，宿主契约硬约束 17）。 */
const ROUTE_PREFIX = '/dsh-worktree-groups'

/** 本插件注册的全部路由路径（导出便于测试与客户端对齐）。 */
export const ROUTE_PATHS = {
  tree: `${ROUTE_PREFIX}/tree`,
  worktreeCreate: `${ROUTE_PREFIX}/worktree-create`,
  worktreeRemove: `${ROUTE_PREFIX}/worktree-remove`,
  reveal: `${ROUTE_PREFIX}/reveal`,
  workspaceOpen: `${ROUTE_PREFIX}/workspace-open`,
} as const

/**
 * git 扫描结果缓存时长（PRD D13：30 秒）。
 *
 * ⚠️ 2026-11-14 PERF3 起，正向缓存改由仓指纹校验 + {@link SCAN_CACHE_MAX_AGE_MS} 兜底，
 * 本常量仅为兼容既有导出保留，不再参与判定。
 */
export const SCAN_CACHE_TTL_MS = 30_000

/* ------------------------------------------------------------------ *
 * 宿主服务的结构性类型
 *
 * 按契约 §2.5，本包**不能** `import type` 任何 `@deepseek-ai/*` 宿主包，
 * 因此这里只按实测到的运行时形状声明最小结构，全部经由 `ctx.get(name)`
 * 运行时获取（`ctx.get(string)` 的返回类型是 `any`，不需要 inject 声明）。
 * ------------------------------------------------------------------ */

/**
 * `ctx.workspaceRegistry` 的工作区实体（宿主契约 §A4.5 的字段子集）。
 *
 * **刻意不声明 `sessionIds`**：它是会实时过滤的 getter，裁定 6 明文禁止用它做归属
 * 判定（会丢会话）。此前把它投影进 `WorkspaceRow` 纯属冗余，且是给下一个改动者
 * 埋雷 —— 现在从类型层面就取不到它（「靠类型约束」取代「靠注释约束」）。
 */
interface HostWorkspaceEntity {
  id?: unknown
  path?: unknown
  title?: unknown
  createdAt?: unknown
  updatedAt?: unknown
}

/** `ctx.workspaceRegistry`（宿主契约 §A4）。`list()` 是**同步**的。 */
interface HostWorkspaceRegistry {
  list?: () => HostWorkspaceEntity[]
  create?: (path: string, title?: string) => Promise<HostWorkspaceEntity | undefined>
  delete?: (id: string) => Promise<boolean>
  archivedSessionIds?: unknown
}

/** `ctx.sessionPersistence.list()` 的单项（宿主契约 §A1.2）。 */
interface PersistenceSnapshot {
  header?: {
    id?: unknown
    createdAt?: unknown
    cwd?: unknown
    parentSession?: unknown
    origin?: unknown
  }
}

/**
 * `ctx.sessionPersistence`（宿主契约 §A1）。
 *
 * **签名以宿主源码为准**（`dsh-session-persistence-jsonl/lib/index.js:2454-2455`）：
 * 宿主是 `async list(options)` 且内部读 `options?.signal`，**不是** `list(signal)`。
 * `docs/HOST-CONTRACTS.md` §A1.2 抄录的宿主源码就是这一份，但该节的结论行
 * 「`options.signal` 可选（`AbortSignal`）」容易被读成裸参形态，故这里显式写成对象。
 */
interface HostSessionPersistence {
  list?: (options?: { signal?: AbortSignal }) => Promise<readonly PersistenceSnapshot[]>
}

/** `SessionSummary` 的宽松投影（宿主契约 §A2.2；字段全部按需校验）。 */
interface SummaryLike {
  sessionId?: unknown
  id?: unknown
  updatedAt?: unknown
  running?: unknown
  blank?: unknown
  parentSessionId?: unknown
  parentSession?: unknown
  origin?: unknown
  cwd?: unknown
  title?: unknown
  pendingInteraction?: unknown
  completed?: unknown
  projections?: { values?: { title?: unknown } }
}

/**
 * 宿主 `ctx.sessions`（SessionStore）。`list()` 返回**活着的 Session 实例**，不是 summary。
 *
 * 刻意标成 `unknown`：实测宿主的 `SessionStore.list` 是原型方法（函数），但契约 §A2.2
 * 也描述了「observable 快照源」形态，两种都必须在运行时探测。
 * 该方法是**无参同步**的（`dsh-session/lib/index.js:1562`），故不在此声明任何形参。
 */
interface HostSessions {
  list?: unknown
}

/**
 * 宿主 `ctx.sessionController`（提供 `list(request, signal)` → `{ items }`）。
 *
 * 签名核实（D7 顺带）：宿主 `dsh-api-session-controller/lib/index.js:2825`
 * `async list(_request, signal)` —— **两个位置参数**，signal 是第二参而不是
 * `{signal}`。调用点 `controller.list({}, signal)` 正确，勿改。
 */
interface HostSessionController {
  list?: (request: unknown, signal?: AbortSignal) => Promise<unknown>
}

/** `ctx.webServer`（宿主契约 §A3.1）。`register` 返回 disposer。 */
interface HostWebServer {
  register?: (route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }) => () => void
}

/** `ds-harness-remote` 远端插件路由桥通道名（Tier 1）。 */
const REMOTE_PLUGIN_ROUTE = 'dsh-worktree-groups'

interface RemotePluginRouteBridgeLike {
  call?: (input: unknown, transferred?: boolean) => Promise<{ status: number; json: unknown }>
}

interface RemoteHostRouterLike {
  pluginRoute?: RemotePluginRouteBridgeLike
  handle?: (message: unknown) => Promise<unknown>
}

interface RemoteHostConnectionsLike {
  active?: Map<string, { channel?: unknown; router?: RemoteHostRouterLike; unsubscribe?: () => void }>
  createRouter?: (context: unknown, send: unknown) => RemoteHostRouterLike
}

/** 机器 B 上的 `ctx.dshRemote`（`HostPluginRuntime`）。 */
interface HostDshRemote {
  connections?: RemoteHostConnectionsLike
  /** 可选：同进程模拟双端时为机器 B 指定独立台账（避免与机器 A 共享默认磁盘台账）。 */
  ledger?: LedgerStore
}

interface RemoteClientStatusLike {
  mode?: unknown
  connected?: unknown
  backend?: unknown
  target?: { deviceId?: unknown; name?: unknown }
  connectedTargetDeviceId?: unknown
}

interface RemoteActiveConnectionLike {
  target?: { deviceId?: unknown; name?: unknown }
  features?: { pluginRoute?: unknown }
  client?: {
    rpc?: (method: string, params: unknown, signal?: AbortSignal) => Promise<unknown>
  }
}

/** 机器 A 上的 `ctx.dshRemoteClient`（`ClientModeRuntime`）。 */
interface HostDshRemoteClient {
  status?: () => RemoteClientStatusLike | undefined
  activeRemote?: () => RemoteActiveConnectionLike | undefined
  connected?: RemoteActiveConnectionLike
  pluginRoute?: (
    route: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<{ status?: unknown; json?: unknown }>
}

/** `ctx.typertGateway`（`ds-harness-remote` 在 remote 模式下将其切换至远端机器 B）。 */
interface HostTypertGateway {
  invoke?: (request: {
    namespace: string
    method: string
    args: Record<string, unknown>
    signal?: AbortSignal
  }) => Promise<unknown>
  stream?: (request: {
    namespace: string
    method: string
    args: Record<string, unknown>
    signal?: AbortSignal
  }) => Promise<AsyncIterable<unknown>>
  dispatchRpc?: (
    endpoint: string,
    payload: { args: Record<string, unknown> },
    signal?: AbortSignal,
  ) => Promise<{ ok?: unknown; value?: unknown; error?: { code?: unknown; message?: unknown } }>
  openWireStream?: (...args: unknown[]) => Promise<AsyncIterable<unknown>>
}

/**
 * 从 ctx 惰性取宿主服务。
 *
 * `ctx.get()` 本身也可能抛（Cordis 在极端情况下会抛诊断错误），因此统一包
 * try/catch —— 本插件的总原则是**缺失即降级，绝不崩**（PRD R6）。
 */
function getService<T>(ctx: Context, name: string): T | undefined {
  try {
    const value = (ctx as unknown as { get?: (key: string) => unknown }).get
    if (typeof value !== 'function') return undefined
    const service = value.call(ctx, name) as T | undefined
    if (service === undefined || service === null) return undefined
    return service
  } catch {
    return undefined
  }
}

/**
 * 读取可选协同服务（如 `dshRemoteClient` / `dshRemote` / `typertGateway`）。
 *
 * 在真实 Cordis 下，提供方 fiber 若尚处于异步启动阶段（`fiber.state === 1`），
 * `ctx.get(name)`（默认 `strict = true`）会返回 `undefined`，此时用 `ctx.get(name, false)` 兜底；
 * 测试替身的 `get(name)` 通常只有 1 个形参，仅在 `get.length >= 2` 时才补调 `strict = false`。
 */
function getOptionalService<T>(ctx: Context, name: string): T | undefined {
  const direct = getService<T>(ctx, name)
  if (direct !== undefined) return direct
  try {
    const getter = (ctx as unknown as { get?: (key: string, strict?: boolean) => unknown }).get
    if (typeof getter === 'function' && getter.length >= 2) {
      const nonStrict = getter.call(ctx, name, false) as T | undefined
      if (nonStrict !== undefined && nonStrict !== null) return nonStrict
    }
    const root = (ctx as unknown as { root?: Context }).root
    if (root !== undefined && root !== ctx) {
      return getService<T>(root, name)
    }
  } catch {
    // 忽略
  }
  return undefined
}

/* ------------------------------------------------------------------ *
 * 扫描缓存
 * ------------------------------------------------------------------ */

interface ScanCacheEntry {
  /** 写入时刻（epoch ms）。 */
  at: number
  /** 该路径的仓事实；`null` = 已解析且确认不是 git 仓（负缓存）。 */
  repo: RepoInfo | null
  /**
   * 写入时的仓指纹（见 {@link repoFingerprint}）；负缓存为「`<path>/.git` 是否存在」。
   * 复用前重新计算并比对，不一致立即重扫（2026-11-14 PERF3）。
   */
  fingerprint: string
}

/**
 * 模块级扫描缓存：键是「扫描入口路径」，值附带**仓指纹**。
 *
 * ## 2026-11-14 PERF3：TTL → 指纹校验
 *
 * 旧实现只靠 30 s TTL：`git worktree add/remove`、`git checkout` 之后最长 30 s（叠加客户端
 * 轮询约 60 s）侧栏才更新；而且主路径的旧条目会被优先采纳，新 worktree 入口的新鲜扫描被丢弃。
 * 现在复用缓存前先算一次廉价指纹（几个 `stat`，不起 git 进程）：
 *
 * - `<commonDir>/HEAD` 的 mtime —— 主树切分支（git 以 lock + rename 写 HEAD）；
 * - `<commonDir>/worktrees/` 目录项及每项 `HEAD` / `gitdir` 的 mtime —— worktree 增删、切分支、移动；
 * - 每个 worktree 目录是否存在 —— 被外部 `rm -rf` 后立即显示为已关闭。
 *
 * 指纹一致且未超过 {@link SCAN_CACHE_MAX_AGE_MS} ⇒ 复用；否则重扫。负缓存（非 git 目录）
 * 的指纹是「`<path>/.git` 是否存在」，`git init` 后立即失效。
 */
const scanCache = new Map<string, ScanCacheEntry>()

/** 指纹一致时缓存的最长复用时间（兜底：指纹覆盖不到的罕见变化，最迟 5 分钟收敛）。 */
export const SCAN_CACHE_MAX_AGE_MS = 5 * 60_000

/** 并行扫描的并发上限（每个扫描最多 3 个 git 子进程）。 */
const SCAN_CONCURRENCY = 6

/** 按远端目标身份（`remote:<deviceId>:<backend>`）隔离的内存台账（避免污染本机台账）。 */
const remoteLedgers = new Map<string, LedgerStore>()

/** Tier 1 远端插件路由不支持时的负缓存（`targetKey` → 探测时间戳），避免每次轮询重复发起必败 RPC。 */
const remoteTier1UnsupportedAt = new Map<string, number>()

/** Tier 1 负缓存有效期（60 s）。 */
const REMOTE_TIER1_NEG_CACHE_TTL_MS = 60_000

/** Tier 2 远端网关 git 仓扫描缓存条目。 */
interface RemoteRepoScanCacheEntry {
  at: number
  workspaceSig: string
  repos: Map<string, RepoInfo>
  pathToCommonDir: Map<string, string>
  liveWorkspacePaths: Set<string>
}

/** 按 `targetKey` 隔离的 Tier 2 远端 git 仓扫描缓存。 */
const remoteRepoScanCache = new Map<string, RemoteRepoScanCacheEntry>()

/** Tier 2 远端 git 仓扫描缓存有效期（30 s；工作区列表签名变化时立即失效）。 */
const REMOTE_REPO_SCAN_CACHE_TTL_MS = 30_000

/** 远端网关单次 RPC / 首帧超时（防止远端流或目录探测未就绪时永久挂起 `/tree`）。 */
const REMOTE_RPC_TIMEOUT_MS = 3_500

/** 清空全部进程内缓存（git 扫描 + 会话列举 + `/tree` 载荷 + 远端内存台账与远端探测缓存）。测试用；也用于故障后强制重扫。 */
export function clearScanCache(): void {
  scanCache.clear()
  remoteLedgers.clear()
  remoteTier1UnsupportedAt.clear()
  remoteRepoScanCache.clear()
  clearSessionRowsCache()
}

/** `stat` 的 mtime（毫秒）；不存在 / 失败返回 `-1`。 */
async function mtimeOf(target: string): Promise<number> {
  try {
    return (await stat(target)).mtimeMs
  } catch {
    return -1
  }
}

/**
 * 仓指纹：只用 `stat` / `readdir`，不起 git 进程（单仓典型 < 1 ms）。
 * 任何 IO 失败都折算成可比较的哨兵值，绝不抛错。
 */
async function repoFingerprint(repo: RepoInfo): Promise<string> {
  const commonDir = repo.commonDir
  const parts: string[] = [String(await mtimeOf(join(commonDir, 'HEAD')))]
  let names: string[] = []
  try {
    names = (await readdir(join(commonDir, 'worktrees'))).sort()
  } catch {
    names = []
  }
  const linked = await Promise.all(
    names.map(async (name) => {
      const dir = join(commonDir, 'worktrees', name)
      return `${name}:${await mtimeOf(join(dir, 'HEAD'))}:${await mtimeOf(join(dir, 'gitdir'))}`
    }),
  )
  parts.push(linked.join(','))
  const exists = await Promise.all(repo.worktrees.map(async (entry) => ((await mtimeOf(entry.path)) >= 0 ? '1' : '0')))
  parts.push(exists.join(''))
  return parts.join('|')
}

/** 负缓存指纹：`<path>/.git` 是否存在（`git init` / clone 后立即失效）。 */
async function negativeFingerprint(path: string): Promise<string> {
  return (await mtimeOf(join(path, '.git'))) >= 0 ? 'git' : 'none'
}

/** 缓存条目仍可信？（指纹一致且未超过最长复用时间） */
async function cacheStillValid(entry: ScanCacheEntry, path: string, now: number): Promise<boolean> {
  if (now < entry.at || now - entry.at >= SCAN_CACHE_MAX_AGE_MS) return false
  const current = entry.repo === null ? await negativeFingerprint(path) : await repoFingerprint(entry.repo)
  return current === entry.fingerprint
}

/**
 * 扫描候选路径，按 commonDir 去重。
 *
 * - 先校验缓存（同一 commonDir 的指纹只算一次），失效的路径以 {@link SCAN_CONCURRENCY}
 *   并发重扫；同一仓已被本轮扫到的其它入口直接共享结果，不重复跑 git；
 * - 输出顺序与候选顺序一致（与并发完成顺序无关）；同一仓取本轮最新的事实；
 * - 任何单路径的扫描异常都被吞掉并从缓存里剔除，不影响其余路径。
 */
async function scanRepos(
  candidates: readonly string[],
  now: number,
  signal?: AbortSignal,
): Promise<{ repos: Map<string, RepoInfo>; pathToCommonDir: Map<string, string> }> {
  const paths = [...new Set(candidates.map((raw) => normalizePath(raw)))]
  const resolved = new Map<string, RepoInfo | null>()
  /** commonDir → 本轮已确认新鲜的仓事实（校验通过或刚扫完）。 */
  const freshByCommonDir = new Map<string, RepoInfo>()
  const validity = new Map<string, Promise<boolean>>()

  const validate = (path: string, entry: ScanCacheEntry): Promise<boolean> => {
    if (entry.repo === null) return cacheStillValid(entry, path, now)
    const key = `${entry.repo.commonDir}\u0000${entry.at}\u0000${entry.fingerprint}`
    let pending = validity.get(key)
    if (pending === undefined) {
      pending = cacheStillValid(entry, path, now)
      validity.set(key, pending)
    }
    return pending
  }

  const stale: string[] = []
  await Promise.all(
    paths.map(async (path) => {
      const cached = scanCache.get(path)
      if (cached !== undefined && (await validate(path, cached))) {
        resolved.set(path, cached.repo)
        if (cached.repo !== null && !freshByCommonDir.has(cached.repo.commonDir)) {
          freshByCommonDir.set(cached.repo.commonDir, cached.repo)
        }
        return
      }
      stale.push(path)
    }),
  )
  stale.sort((a, b) => paths.indexOf(a) - paths.indexOf(b))

  const coveredBy = (path: string): RepoInfo | undefined => {
    for (const repo of freshByCommonDir.values()) {
      if (normalizePath(repo.mainPath) === path) return repo
      if (repo.worktrees.some((entry) => normalizePath(entry.path) === path)) return repo
    }
    return undefined
  }

  let cursor = 0
  const worker = async (): Promise<void> => {
    while (cursor < stale.length) {
      const path = stale[cursor]!
      cursor += 1
      const shared = coveredBy(path)
      if (shared !== undefined) {
        resolved.set(path, shared)
        continue
      }
      let repo: RepoInfo | null
      try {
        repo = await scanRepo(path, signal)
      } catch {
        // 扫描抛错（git 缺失、权限、被取消）：剔除陈旧缓存，本次跳过该路径。
        scanCache.delete(path)
        continue
      }
      resolved.set(path, repo)
      if (repo === null) {
        scanCache.set(path, { at: now, repo: null, fingerprint: await negativeFingerprint(path) })
        continue
      }
      freshByCommonDir.set(repo.commonDir, repo)
      const entry: ScanCacheEntry = { at: now, repo, fingerprint: await repoFingerprint(repo) }
      scanCache.set(path, entry)
      // 同一仓的其它 worktree 入口共享这份**最新**事实（覆盖旧条目，避免旧事实被优先采纳）。
      for (const worktree of repo.worktrees) scanCache.set(normalizePath(worktree.path), entry)
      scanCache.set(normalizePath(repo.mainPath), entry)
    }
  }
  await Promise.all(Array.from({ length: Math.min(SCAN_CONCURRENCY, stale.length) }, () => worker()))

  const repos = new Map<string, RepoInfo>()
  const pathToCommonDir = new Map<string, string>()
  for (const path of paths) {
    const repo = resolved.get(path)
    if (repo === undefined || repo === null) continue
    pathToCommonDir.set(path, repo.commonDir)
    if (!repos.has(repo.commonDir)) repos.set(repo.commonDir, freshByCommonDir.get(repo.commonDir) ?? repo)
  }
  return { repos, pathToCommonDir }
}

/* ------------------------------------------------------------------ *
 * 会话 / 工作区 / 台账
 * ------------------------------------------------------------------ */

/** 取有限数字，否则 undefined（防止 NaN 污染排序）。 */
function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** 取非空字符串，否则 undefined。 */
function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** 从任意 summary 形状里取 sessionId。 */
function summaryId(summary: SummaryLike): string | undefined {
  return nonEmptyString(summary.sessionId) ?? nonEmptyString(summary.id)
}

/** 从任意 summary 形状里取标题投影（`projections.values.title` 优先于顶层 `title`）。 */
function summaryTitle(summary: SummaryLike): string | undefined {
  return nonEmptyString(summary.projections?.values?.title) ?? nonEmptyString(summary.title)
}

/**
 * 收集实时会话摘要，按 `sessionId` 索引。
 *
 * 三级来源，逐级降级（宿主契约 §A2.2 已核实：宿主 `ctx.sessions` 是 SessionStore，
 * 它的 `list()` 返回活着的 `Session` 实例，**不是** `{items, byId}` 快照；
 * 真正的 `SessionSummary` 生产者是 `ctx.sessionController`）：
 *
 *  1. `ctx.sessionController.list({})` → `{ items: SessionSummary[] }`（权威、含孤儿）
 *  2. `ctx.sessions.list()`：若元素本身长得像 summary（有 `sessionId` + 数字 `updatedAt`）直接用；
 *     若元素是活的 `Session`（有 `.header`）则从 header 推导最小摘要；
 *  3. `ctx.sessions.list` 若是 observable 快照源（有 `getSnapshot`）则读 `items` / `byId`。
 *
 * 全部缺失时返回空 Map —— 组装侧仍会为每个会话回退到 `header.createdAt`。
 */
export async function loadSessionSummaries(
  ctx: Context,
  signal?: AbortSignal,
): Promise<Map<string, SummaryLike>> {
  const summaries = new Map<string, SummaryLike>()

  const controller = getService<HostSessionController>(ctx, 'sessionController')
  if (typeof controller?.list === 'function') {
    try {
      const value = await controller.list({}, signal)
      const items = Array.isArray(value)
        ? value
        : Array.isArray((value as { items?: unknown } | undefined)?.items)
          ? ((value as { items: unknown[] }).items)
          : []
      for (const item of items) {
        if (typeof item !== 'object' || item === null) continue
        const summary = item as SummaryLike
        const id = summaryId(summary)
        if (id !== undefined && !summaries.has(id)) summaries.set(id, summary)
      }
    } catch {
      // 快照不可用（sessions/agents 尚未就绪）：降级到下一来源
    }
  }
  if (summaries.size > 0) return summaries

  const sessions = getService<HostSessions>(ctx, 'sessions')
  if (sessions === undefined) return summaries

  const absorbList = (list: unknown): void => {
    if (!Array.isArray(list)) return
    for (const entry of list) {
      if (typeof entry !== 'object' || entry === null) continue
      const candidate = entry as SummaryLike
      const id = summaryId(candidate)
      if (id !== undefined && finiteNumber(candidate.updatedAt) !== undefined) {
        if (!summaries.has(id)) summaries.set(id, candidate)
        continue
      }
      // 活的 Session 实例：用它的 header 推导一份最小摘要。
      const header = (entry as { header?: PersistenceSnapshot['header']; seq?: unknown }).header
      const headerId = nonEmptyString(header?.id)
      if (headerId !== undefined && !summaries.has(headerId)) {
        summaries.set(headerId, {
          sessionId: headerId,
          updatedAt: finiteNumber(header?.createdAt),
          running: false,
          blank: (entry as { seq?: unknown }).seq === 0,
          cwd: nonEmptyString(header?.cwd),
          parentSessionId: nonEmptyString(header?.parentSession),
          origin: header?.origin === 'subagent' ? 'subagent' : undefined,
        })
      }
    }
  }

  const rawList = sessions.list
  if (typeof rawList === 'function') {
    try {
      // 宿主 `SessionStore.list()` 是**无参同步**方法（`dsh-session/lib/index.js:1562`
      // `list() { return [...this.store.values()].map(...) }`）—— 不能传 signal，
      // 也不返回 Promise。`absorbList` 对非数组入参是 no-op，形状不符时自然降级。
      absorbList(rawList.call(sessions))
    } catch {
      // 忽略：降级到空摘要表
    }
  } else if (typeof rawList === 'object' && rawList !== null) {
    // observable 快照源（`{ getSnapshot, subscribe }`）
    const source = rawList as { getSnapshot?: () => unknown }
    if (typeof source.getSnapshot === 'function') {
      try {
        const snapshot = source.getSnapshot() as { items?: unknown; byId?: unknown } | undefined
        absorbList(snapshot?.items)
        if (snapshot?.byId !== undefined && typeof snapshot.byId === 'object' && snapshot.byId !== null) {
          absorbList(Object.values(snapshot.byId as Record<string, unknown>))
        }
      } catch {
        // 忽略
      }
    }
  }

  return summaries
}

/**
 * 读取全量历史会话（**含 cwd 已死**的孤儿），组装成 `SessionRow[]`。
 *
 * 组装规则（`docs/INTERFACES.md` §2.7 裁定 7）：
 * `updatedAt = summary.updatedAt ?? header.createdAt ?? 0`，且必须是**有限数字**。
 *
 * 返回 `{ rows, summaries }`：`summaries` 供调用方复用作 summary 存在性判断。
 */
export async function buildSessionRows(
  ctx: Context,
  signal?: AbortSignal,
): Promise<{ rows: SessionRow[]; summaries: Map<string, SummaryLike> }> {
  const persistence = getService<HostSessionPersistence>(ctx, 'sessionPersistence')
  // 2026-11-14 PERF1：两路列举互不依赖 ⇒ 并行发起（旧实现串行，耗时相加）。
  // 宿主签名是 `list(options)`（`options?.signal`），必须传对象而不是裸 signal，
  // 否则取消信号在入口丢失（`docs/HOST-CONTRACTS.md` §A1.2 的宿主源码为证）。
  const listPersisted = persistence?.list
  const persisted: Promise<readonly PersistenceSnapshot[]> | undefined =
    typeof listPersisted === 'function'
      ? (async () => {
          try {
            return (await listPersisted.call(persistence, { signal })) ?? []
          } catch {
            // 存储故障：退化为「只有实时会话」而不是整棵树失败。
            return []
          }
        })()
      : undefined
  const summaries = await loadSessionSummaries(ctx, signal)

  const rows: SessionRow[] = []
  if (persisted !== undefined) {
    const snapshots = await persisted
    for (const snapshot of snapshots) {
      const header = snapshot?.header
      const sessionId = nonEmptyString(header?.id)
      if (sessionId === undefined) continue
      rows.push(toSessionRow(sessionId, header, summaries.get(sessionId)))
    }
  }

  // 实时摘要里存在、但全量历史里没有的会话（极端时序：刚创建还没落盘）。
  // 必须补进来，否则「新会话」在侧栏短暂消失。
  if (rows.length > 0 || summaries.size > 0) {
    const seen = new Set(rows.map((row) => row.sessionId))
    for (const [sessionId, summary] of summaries) {
      if (seen.has(sessionId)) continue
      rows.push(toSessionRow(sessionId, undefined, summary))
    }
  }

  // 2026-10-29 RAS2/RAS3：补「最后更新时间」。必须在全部行（含子代理）都到齐之后做，
  // 才能把子代理活动沿 parentSessionId 传播到祖先主会话。
  attachLastActivityTimes(rows)

  return { rows, summaries }
}

/** 单条会话的投影（左连接 summary 到 header 之上）。 */
function toSessionRow(
  sessionId: string,
  header: PersistenceSnapshot['header'] | undefined,
  summary: SummaryLike | undefined,
): SessionRow {
  // 裁定 7：summary.updatedAt → header.createdAt → 0，且必须是有限数字。
  const updatedAt = finiteNumber(summary?.updatedAt) ?? finiteNumber(header?.createdAt) ?? 0
  const cwd = nonEmptyString(summary?.cwd) ?? nonEmptyString(header?.cwd)
  const parentSessionId =
    nonEmptyString(summary?.parentSessionId) ?? nonEmptyString(header?.parentSession)
  const originValue = summary?.origin ?? header?.origin
  const title = summary === undefined ? undefined : summaryTitle(summary)
  const pendingInteraction = nonEmptyString(summary?.pendingInteraction)
  const completed = typeof summary?.completed === 'boolean' ? summary.completed : undefined

  const row: SessionRow = {
    sessionId,
    updatedAt,
    // 2026-10-29 RAS4：先回退到 updatedAt；buildSessionRows 末尾再由活动表补
    // max(updatedAt, 自身/后代活动时间)。保持「恒为有限数字」的既有契约。
    lastActivityAt: updatedAt,
    running: summary?.running === true,
    blank: summary?.blank === true,
  }
  // 裁定 8：cwd 可缺失。缺失时不写该键，由 buildProjects 的 assignSession 归入未分组。
  if (cwd !== undefined) row.cwd = cwd
  if (parentSessionId !== undefined) row.parentSessionId = parentSessionId
  if (originValue === 'subagent') row.origin = 'subagent'
  if (pendingInteraction !== undefined) row.pendingInteraction = pendingInteraction
  if (completed !== undefined) row.completed = completed
  if (title !== undefined) row.title = title
  return row
}

/** 把宿主工作区实体投影成 `WorkspaceRow`。
 *
 * **只投影 id/path/title/createdAt/updatedAt**。刻意**不**投影宿主的 `sessionIds`
 * getter：裁定 6 禁止用它做归属判定（实时过滤 ⇒ 会丢会话），而本包没有任何消费者
 * 需要它。删掉该字段后，裁定 6 从「靠注释约束」升级为「靠类型约束」。 */
function toWorkspaceRow(entity: HostWorkspaceEntity): WorkspaceRow | undefined {
  const workspaceId = nonEmptyString(entity.id)
  const path = nonEmptyString(entity.path)
  if (workspaceId === undefined || path === undefined) return undefined
  return {
    workspaceId,
    path: normalizePath(path),
    title: nonEmptyString(entity.title) ?? '',
    createdAt: typeof entity.createdAt === 'string' ? entity.createdAt : '',
    updatedAt: typeof entity.updatedAt === 'string' ? entity.updatedAt : '',
  }
}

/** 读取工作区注册表（缺失时返回空表 —— 降级不崩）。 */
export function loadWorkspaces(ctx: Context): {
  workspaces: WorkspaceRow[]
  registry: HostWorkspaceRegistry | undefined
} {
  const registry = getService<HostWorkspaceRegistry>(ctx, 'workspaceRegistry')
  const workspaces: WorkspaceRow[] = []
  if (typeof registry?.list !== 'function') return { workspaces, registry }
  try {
    for (const entity of registry.list() ?? []) {
      if (typeof entity !== 'object' || entity === null) continue
      const row = toWorkspaceRow(entity)
      if (row !== undefined) workspaces.push(row)
    }
  } catch {
    // 注册表顺序损坏（宿主会抛 "references missing workspace"）：返回已读到的部分。
  }
  return { workspaces, registry }
}

/** 归档会话集合（用于从全量历史里剔除，客户端再兜一层）。 */
export function loadArchivedSessionIds(registry: HostWorkspaceRegistry | undefined): string[] {
  const raw = registry?.archivedSessionIds
  if (!Array.isArray(raw)) return []
  return raw.filter((id): id is string => typeof id === 'string')
}

/**
 * **D8**：工作区表的内容签名（用于判断「注册表是否真的变了」）。
 *
 * 为什么不用长度：长度是代理指标。D18 清扫删 1 条 + 宿主同一轮新增 1 条 ⇒ 长度相等，
 * `length !== length` 会误判为「没变」，本轮响应继续用旧表（死工作区行多渲染一轮）。
 *
 * 为什么不用 `updatedAt` 单个字段：宿主对 `title` 重命名与 `delete` 都会动 `updatedAt`，
 * 但**成员增删**必须被检出，所以两者都纳入。签名先按 `workspaceId` 排序，因此与
 * `registry.list()` 的返回顺序无关（顺序变化不应被当成内容变化）。
 *
 * 导出以便单测直接对「同长度不同成员」构造用例断言。
 */
export function workspaceSignature(workspaces: readonly WorkspaceRow[]): string {
  return workspaces
    .map((row) => `${row.workspaceId}\u0000${row.path}\u0000${row.title}\u0000${row.updatedAt}`)
    .sort()
    .join('\u0001')
}

/* ------------------------------------------------------------------ *
 * 快照组装
 * ------------------------------------------------------------------ */

/** 一次请求要用的全量宿主事实。 */
export interface TreeSnapshot {
  workspaces: WorkspaceRow[]
  repos: Record<string, RepoInfo>
  repoByWorkspacePath: Record<string, string>
  ledger: LedgerData
  sessions: SessionRow[]
  archivedSessionIds: string[]
  /** 归一化工作区路径 → workspaceId。 */
  workspaceByPath: Record<string, string>
  /** 白名单：全部已知 worktree 路径（归一化）。 */
  knownWorktreePaths: Set<string>
  /** 白名单：全部已知 git 仓入口路径（归一化，含 commonDir / mainPath / 全部 worktree）。 */
  knownRepoPaths: Set<string>
  /**
   * 归一化路径 → 所属仓的 **mainPath**（归一化）。
   *
   * 覆盖 `knownRepoPaths ∪ knownWorktreePaths` 的每一个键。这个表存在的理由是一个
   * 真实的坑：macOS 上 `/var` 是 `/private/var` 的符号链接，`git worktree list`
   * 回的是 realpath 拼法，而 dsh 工作区路径可能是另一种拼法。二者经 `normalizePath`
   * （只做 `resolve`，不做 `realpath`）后仍不相等。因此**白名单命中的拼法**必须与
   * **仓查找用的拼法**来自同一批来源，否则会出现「白名单放行、却找不到仓库」的
   * 自相矛盾状态。本表正是用与白名单完全相同的来源填充的，保证二者一致。
   */
  mainPathByKnownPath: Map<string, string>
  /**
   * **已确认磁盘上存在**的工作区路径集合（归一化），喂给 `buildProjects` 的
   * `liveWorkspacePaths`。用于判定「已注册但目录已死」的非 git 工作区。
   */
  liveWorkspacePaths: Set<string>
  /**
   * **有正面证据表明是「非主工作树」**的工作区路径集合（归一化）。D18 清扫只允许删这些。
   *
   * 「正面证据」= 该路径出现在 git 扫描的非主 worktree 列表里，或出现在台账
   * `projects[*].worktrees` 里且**不等于该项目记录的 `mainPath`**。
   *
   * 为什么不写成「不是主树就删」：如果一个仓的**整个目录**（含 `.git`）都消失了，
   * git 就扫不出任何 worktree，此时「它是不是主树」**不可判定**。把它当非主树删掉，
   * 会在用户只是临时移走 / 之后重新 clone 时**静默丢掉工作区记录**。
   * D18 的明文禁止项（「主仓自己被删的情况不要自动删记录」）正是这种情形，
   * 因此这里要求**正面证据**，拿不到证据就不动。
   */
  nonMainWorkspacePaths: Set<string>
}

/** {@link collectSnapshot} 的可注入依赖（测试用；生产走默认实现）。 */
export interface SnapshotOptions {
  /** 台账存储；缺省时用 `createFileLedger()`（`<DSH home>/worktree-groups.json`）。 */
  ledger?: LedgerStore
  /** 取消信号。 */
  signal?: AbortSignal
  /** 「当前时刻」注入点（缓存 TTL 判定 + 台账时间戳），测试可固定。 */
  now?: number
  /**
   * 复用进程内会话列举缓存（2026-11-14 PERF1，见 {@link cachedSessionRows}）。
   * 只有 `/tree` 路由开启；直接调用导出函数时缺省关闭，保持「每次都读宿主」的旧语义。
   */
  reuseSessions?: boolean
  /** 内部标记：强制按本机模式执行（机器 B 作为远端 Host 响应 Tier 1 转发时防止递归）。 */
  forceLocal?: boolean
}

/* ------------------------------------------------------------------ *
 * 会话列举缓存（2026-11-14 PERF1）
 * ------------------------------------------------------------------ */

/** 会话列举缓存的最长复用时间（兜底：没有任何活动信号时也最迟 30 s 重列一次）。 */
export const SESSION_ROWS_MAX_AGE_MS = 30_000

interface SessionRowsCacheEntry {
  builtAt: number
  /** 构建**开始前**读到的活动版本号（构建期间的活动会让下一次请求重列）。 */
  activityVersion: number
  /** 构建开始前的活会话 id 集合签名。 */
  liveSignature: string
  rows: SessionRow[]
}

/** 按宿主上下文隔离的会话列举缓存（测试里每个替身 ctx 互不干扰）。 */
let sessionRowsCache = new WeakMap<object, SessionRowsCacheEntry>()

/** 清空会话列举缓存与 `/tree` 载荷合并器（由 {@link clearScanCache} 一并调用）。 */
function clearSessionRowsCache(): void {
  sessionRowsCache = new WeakMap()
  treeFlightEpoch += 1
}

/**
 * 活会话 id 集合签名：`ctx.sessions.list()` 是纯内存操作（宿主 SessionStore），
 * 新建 / 关闭会话会立即改变它 —— 用它作为「会话集合变了」的廉价信号。
 */
function liveSessionSignature(ctx: Context): string {
  const sessions = getService<HostSessions>(ctx, 'sessions')
  if (typeof sessions?.list !== 'function') return ''
  try {
    const list = (sessions.list as () => unknown).call(sessions)
    if (!Array.isArray(list)) return ''
    const ids: string[] = []
    for (const entry of list) {
      if (typeof entry !== 'object' || entry === null) continue
      const id = nonEmptyString((entry as { id?: unknown }).id)
        ?? nonEmptyString((entry as { header?: { id?: unknown } }).header?.id)
        ?? nonEmptyString((entry as { sessionId?: unknown }).sessionId)
      if (id !== undefined) ids.push(id)
    }
    return ids.sort().join('\u0000')
  } catch {
    return ''
  }
}

/** 用宿主 `agents` 服务（纯内存）刷新缓存行的运行态；服务缺席时保持原值。 */
function refreshRunning(ctx: Context, rows: SessionRow[]): void {
  const agents = getService<{ get?: (id: string) => { status?: unknown } | undefined }>(ctx, 'agents')
  if (typeof agents?.get !== 'function') return
  for (const row of rows) {
    try {
      row.running = agents.get(row.sessionId)?.status === 'running'
    } catch {
      // 单条失败保持原值
    }
  }
}

/**
 * 带缓存的 {@link buildSessionRows}。
 *
 * 根因（实测）：`sessionController.list()` 与 `sessionPersistence.list()` 各自全量扫一遍
 * 会话目录（读每个文件首行 + stat），3753 个会话时单次 `/tree` 约 0.7–1.4 s。
 * 复用条件（全部满足）：
 * - 自上次列举以来**没有**任何宿主 `session/event`（{@link sessionActivityVersion} 未变）；
 * - 活会话 id 集合未变（新建 / 关闭会话立即失效）；
 * - 未超过 {@link SESSION_ROWS_MAX_AGE_MS}。
 * 复用时仍重算 `lastActivityAt` 与运行态（都只读内存）。
 */
async function cachedSessionRows(ctx: Context, now: number, signal?: AbortSignal): Promise<SessionRow[]> {
  const version = sessionActivityVersion()
  const live = liveSessionSignature(ctx)
  const entry = sessionRowsCache.get(ctx as object)
  if (
    entry !== undefined &&
    entry.activityVersion === version &&
    entry.liveSignature === live &&
    now >= entry.builtAt &&
    now - entry.builtAt < SESSION_ROWS_MAX_AGE_MS
  ) {
    refreshRunning(ctx, entry.rows)
    attachLastActivityTimes(entry.rows)
    return entry.rows
  }
  const { rows } = await buildSessionRows(ctx, signal)
  sessionRowsCache.set(ctx as object, { builtAt: now, activityVersion: version, liveSignature: live, rows })
  return rows
}

/** 默认台账存储（模块级单例；`createFileLedger()` 构造期不做任何 IO）。 */
let defaultLedger: LedgerStore | undefined

/** `dshHomePath` 所在的包名（宿主包，**不可静态 import**；见 §2.5 / §C14）。 */
const DSH_HOME_PATHS_MODULE = '@deepseek-ai/dsh-home-paths'

/** 台账文件名（与 `ledger.ts` 保持一致）。 */
const LEDGER_FILE_NAME = 'worktree-groups.json'

/**
 * 解析台账家目录，**优先 `dshHomePath('worktree-groups.json')`**（§2.7 裁定 9）。
 *
 * 背景（宿主契约 §A5.1 实测）：
 * - `defaultDshHome()` = `homedir()/.dsh`，**不读 `$DSH_HOME`**；
 * - `dshHomePath(...)` = `resolveDshHome()` + join，**会读 `$DSH_HOME``。
 *
 * `ledger.ts`（T2 所有，本任务不改）只查了 `defaultDshHome()`。本该由 T2 补的第一级
 * 回退在这里补上：惰性动态 import（变量说明符，避免 tsc 解析），拿到 `dshHomePath`
 * 就取它的目录。失败时返回 `undefined`，让 `createFileLedger()` 走它自己的
 * `defaultDshHome()` → `$DSH_HOME` → `~/.dsh` 回退链 —— **两级回退都被保留**。
 *
 * 之所以放在这里而不是 `ledger.ts`：文件所有权（§0）规定 `ledger.ts` 属 T2，
 * 本任务不得改动；`routes.ts` 是台账的**唯一组装入口**，在这里注入等价且没有写者冲突。
 */
async function resolveLedgerHome(): Promise<string | undefined> {
  try {
    const specifier: string = DSH_HOME_PATHS_MODULE
    const mod = (await import(specifier)) as unknown as { dshHomePath?: (...segments: string[]) => unknown }
    const fn = mod.dshHomePath
    if (typeof fn !== 'function') return undefined
    const file = fn(LEDGER_FILE_NAME)
    if (typeof file !== 'string' || file === '') return undefined
    return dirname(file)
  } catch {
    // 包不可解析 / 导出形态变化 ⇒ 返回 undefined，交给 createFileLedger() 的两级回退
    return undefined
  }
}

/**
 * 取默认台账存储（懒构造）。
 *
 * 构造期已 await（动态 import 是异步的），所以把它包成一个 Promise 单例：
 * `createFileLedger()` 本身**不做任何 IO**，只是记住 home 目录，因此这里 await
 * 一次模块解析不会引入任何磁盘访问。
 */
let defaultLedgerPromise: Promise<LedgerStore> | undefined

/** 取默认台账存储（惰性；首次调用解析 home，之后复用同一实例）。 */
async function ledgerStore(): Promise<LedgerStore> {
  defaultLedger ??= undefined
  if (defaultLedger !== undefined) return defaultLedger
  defaultLedgerPromise ??= (async (): Promise<LedgerStore> => {
    const home = await resolveLedgerHome()
    return home === undefined ? createFileLedger() : createFileLedger(home)
  })()
  defaultLedger = await defaultLedgerPromise
  return defaultLedger
}

/** 取指定远端目标的内存台账（与本机磁盘台账完全隔离）。 */
function remoteLedgerStore(targetKey: string): LedgerStore {
  const existing = remoteLedgers.get(targetKey)
  if (existing !== undefined) return existing
  let data: LedgerData = { version: 1, projects: {}, sessions: {} }
  const store: LedgerStore = {
    async read(): Promise<LedgerData> {
      return data
    },
    async write(next: LedgerData): Promise<void> {
      data = next
    },
    async update(mutator: (current: LedgerData) => LedgerData): Promise<LedgerData> {
      data = mutator(data)
      return data
    },
  }
  remoteLedgers.set(targetKey, store)
  return store
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 读取 `ds-harness-remote` 客户端控制态（2026-11-22）。
 *
 * 当机器 A 通过 `dsh remote` 控制远端机器 B 时，`ctx.get('dshRemoteClient').status().mode === 'remote'`。
 */
function readRemoteClientState(ctx: Context): {
  isRemote: boolean
  targetKey: string
  deviceId: string
  backend: string
  client?: HostDshRemoteClient
} {
  const client = getOptionalService<HostDshRemoteClient>(ctx, 'dshRemoteClient')
  if (client === undefined || typeof client.status !== 'function') {
    return { isRemote: false, targetKey: 'local', deviceId: '', backend: 'harness' }
  }
  try {
    const status = client.status()
    if (status?.mode !== 'remote') {
      return { isRemote: false, targetKey: 'local', deviceId: '', backend: 'harness', client }
    }
    const active = typeof client.activeRemote === 'function' ? client.activeRemote() : client.connected
    const deviceId =
      nonEmptyString(status.target?.deviceId) ??
      nonEmptyString(active?.target?.deviceId) ??
      nonEmptyString(status.connectedTargetDeviceId) ??
      'remote'
    const backend = nonEmptyString(status.backend) ?? 'harness'
    return {
      isRemote: true,
      targetKey: `remote:${deviceId}:${backend}`,
      deviceId,
      backend,
      client,
    }
  } catch {
    return { isRemote: false, targetKey: 'local', deviceId: '', backend: 'harness' }
  }
}

/** 判断 Tier 1 调用失败是否属于「远端机器 B 尚未加载支持 Tier 1 的插件路由」。 */
function isTier1UnsupportedError(error: unknown): boolean {
  if (!isPlainRecord(error)) return false
  const code = nonEmptyString(error['code']) ?? nonEmptyString((error['details'] as Record<string, unknown> | undefined)?.['remoteCode'])
  if (
    code === 'INVALID_MESSAGE' ||
    code === 'METHOD_NOT_FOUND' ||
    code === 'FEATURE_NOT_SUPPORTED' ||
    code === 'CAPABILITY_NOT_SUPPORTED'
  ) {
    return true
  }
  const message = nonEmptyString(error['message']) ?? ''
  return /invalid for the remote channel|cannot forward.*plugin routes|does not exist/i.test(message)
}

/** 构造带超时保护的 AbortSignal（同时关联外部 `signal`）。 */
function withRemoteTimeoutSignal(signal: AbortSignal | undefined, timeoutMs = REMOTE_RPC_TIMEOUT_MS): {
  signal: AbortSignal
  cleanup: () => void
} {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort(new Error(`remote gateway operation timed out after ${timeoutMs}ms`))
  }, timeoutMs)
  if (typeof (timer as { unref?: () => void }).unref === 'function') {
    ;(timer as { unref: () => void }).unref()
  }
  const combined = signal === undefined ? controller.signal : AbortSignal.any([signal, controller.signal])
  return {
    signal: combined,
    cleanup: () => {
      clearTimeout(timer)
    },
  }
}

/**
 * 尝试通过 Tier 1（`ds-harness-remote` 的 `plugin.route.call`）将请求直接转发到远端机器 B 的 `dsh-worktree-groups`。
 */
async function tryCallRemotePluginRoute(
  ctx: Context,
  endpoint: 'tree' | 'worktree-create' | 'worktree-remove' | 'reveal' | 'workspace-open',
  payload: Record<string, unknown>,
  signal?: AbortSignal,
  now = Date.now(),
): Promise<{ supported: false } | { supported: true; status: number; payload: Record<string, unknown> }> {
  const state = readRemoteClientState(ctx)
  if (!state.isRemote || state.backend !== 'harness' || state.client === undefined) {
    return { supported: false }
  }
  const unsupportedAt = remoteTier1UnsupportedAt.get(state.targetKey)
  if (
    unsupportedAt !== undefined &&
    now >= unsupportedAt &&
    now - unsupportedAt < REMOTE_TIER1_NEG_CACHE_TTL_MS
  ) {
    return { supported: false }
  }
  const body = { endpoint, payload }
  const timed = withRemoteTimeoutSignal(signal)
  try {
    let raw: unknown
    if (typeof state.client.pluginRoute === 'function') {
      raw = await state.client.pluginRoute(REMOTE_PLUGIN_ROUTE, body, timed.signal)
    } else {
      const active = typeof state.client.activeRemote === 'function' ? state.client.activeRemote() : state.client.connected
      if (typeof active?.client?.rpc !== 'function') return { supported: false }
      raw = await active.client.rpc('plugin.route.call', { route: REMOTE_PLUGIN_ROUTE, body }, timed.signal)
    }
    if (!isPlainRecord(raw)) return { supported: false }
    const status = typeof raw['status'] === 'number' ? raw['status'] : 200
    const jsonPayload = isPlainRecord(raw['json']) ? raw['json'] : undefined
    if (status === 404 || status === 503 || jsonPayload === undefined) {
      return { supported: false }
    }
    if (jsonPayload['ok'] === false && isTier1UnsupportedError(jsonPayload['error'])) {
      remoteTier1UnsupportedAt.set(state.targetKey, now)
      return { supported: false }
    }
    remoteTier1UnsupportedAt.delete(state.targetKey)
    return { supported: true, status, payload: jsonPayload }
  } catch (error) {
    if (isTier1UnsupportedError(error)) {
      remoteTier1UnsupportedAt.set(state.targetKey, now)
      return { supported: false }
    }
    // 若存在远端 typertGateway 可回退（如 tree / workspace-open），交由 Tier 2 兜底
    if (
      (endpoint === 'tree' || endpoint === 'workspace-open') &&
      getOptionalService<HostTypertGateway>(ctx, 'typertGateway') !== undefined
    ) {
      return { supported: false }
    }
    return {
      supported: true,
      status: 400,
      payload: { ok: false, message: failMessage(error) },
    }
  } finally {
    timed.cleanup()
  }
}

/** 调用远端 `ctx.typertGateway` 的 unary 方法（兼容 `invoke` 与 `dispatchRpc`，自带超时保护）。 */
async function invokeRemoteGateway(
  gateway: HostTypertGateway,
  namespace: string,
  method: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<unknown> {
  const timed = withRemoteTimeoutSignal(signal)
  try {
    if (typeof gateway.invoke === 'function') {
      return await gateway.invoke({
        namespace,
        method,
        args,
        signal: timed.signal,
      })
    }
    if (typeof gateway.dispatchRpc === 'function') {
      const res = await gateway.dispatchRpc(`${namespace}/${method}`, { args }, timed.signal)
      if (res?.ok === true) return res.value
      throw new Error(nonEmptyString(res?.error?.message) ?? `remote gateway ${namespace}/${method} failed`)
    }
    throw new Error('typertGateway does not support unary invocation')
  } finally {
    timed.cleanup()
  }
}

/** 打开远端 `ctx.typertGateway` 的流（兼容 `stream` 与 3/5 参 `openWireStream`）。 */
async function openRemoteGatewayStream(
  gateway: HostTypertGateway,
  namespace: string,
  method: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<AsyncIterable<unknown>> {
  if (typeof gateway.stream === 'function') {
    return await gateway.stream({
      namespace,
      method,
      args,
      ...(signal === undefined ? {} : { signal }),
    })
  }
  if (typeof gateway.openWireStream === 'function') {
    const endpoint = `${namespace}/${method}`
    const activeSignal = signal ?? new AbortController().signal
    if (gateway.openWireStream.length >= 5) {
      const endedUplink = {
        [Symbol.asyncIterator]() {
          return { next: () => Promise.resolve({ done: true as const, value: undefined }) }
        },
      }
      return await gateway.openWireStream(endpoint, { args }, endedUplink, undefined, activeSignal)
    }
    return await gateway.openWireStream(endpoint, { args }, activeSignal)
  }
  throw new Error('typertGateway does not support stream opening')
}

/** Tier 2：从远端 `workspace/follow` 首帧 baseline 读取工作区列表与归档会话集合（带超时防挂起）。 */
async function readRemoteGatewayWorkspaces(
  gateway: HostTypertGateway,
  signal?: AbortSignal,
): Promise<{ workspaces: WorkspaceRow[]; archivedSessionIds: string[] }> {
  const lifetime = new AbortController()
  const timed = withRemoteTimeoutSignal(signal)
  const activeSignal = AbortSignal.any([timed.signal, lifetime.signal])
  try {
    const stream = await openRemoteGatewayStream(gateway, 'workspace', 'follow', {}, activeSignal)
    const iterator = stream[Symbol.asyncIterator]()
    try {
      const first = await new Promise<IteratorResult<unknown>>((resolve, reject) => {
        const onAbort = (): void => {
          reject(activeSignal.reason ?? new Error('workspace/follow timed out'))
        }
        if (activeSignal.aborted) {
          onAbort()
          return
        }
        activeSignal.addEventListener('abort', onAbort, { once: true })
        iterator.next().then(
          (res) => {
            activeSignal.removeEventListener('abort', onAbort)
            resolve(res)
          },
          (err) => {
            activeSignal.removeEventListener('abort', onAbort)
            reject(err)
          },
        )
      })
      const frame = isPlainRecord(first.value) ? first.value : undefined
      const baseline = frame?.['type'] === 'baseline' && isPlainRecord(frame['value']) ? frame['value'] : frame
      const rawItems = Array.isArray(baseline?.['items']) ? baseline['items'] : []
      const workspaces: WorkspaceRow[] = []
      for (const raw of rawItems) {
        if (!isPlainRecord(raw)) continue
        const workspaceId = nonEmptyString(raw['workspaceId']) ?? nonEmptyString(raw['id'])
        const path = nonEmptyString(raw['path'])
        if (workspaceId === undefined || path === undefined) continue
        workspaces.push({
          workspaceId,
          path,
          title: typeof raw['title'] === 'string' ? raw['title'] : '',
          createdAt: typeof raw['createdAt'] === 'string' ? raw['createdAt'] : '',
          updatedAt: typeof raw['updatedAt'] === 'string' ? raw['updatedAt'] : '',
        })
      }
      const rawArchived = baseline?.['archivedSessionIds']
      const archivedSessionIds: string[] = []
      if (Array.isArray(rawArchived)) {
        for (const id of rawArchived) {
          const s = nonEmptyString(id)
          if (s !== undefined) archivedSessionIds.push(s)
        }
      }
      return { workspaces, archivedSessionIds }
    } finally {
      lifetime.abort()
      await iterator.return?.().catch(() => undefined)
    }
  } catch {
    return { workspaces: [], archivedSessionIds: [] }
  } finally {
    timed.cleanup()
  }
}

/** Tier 2：从远端 `session/list` 读取全部会话并组装为 `SessionRow[]`。 */
async function readRemoteGatewaySessions(
  gateway: HostTypertGateway,
  signal?: AbortSignal,
): Promise<SessionRow[]> {
  let rawResult: unknown
  try {
    rawResult = await invokeRemoteGateway(gateway, 'session', 'list', { _request: {} }, signal)
  } catch {
    try {
      rawResult = await invokeRemoteGateway(gateway, 'session', 'list', { request: {} }, signal)
    } catch {
      return []
    }
  }
  const items = Array.isArray(rawResult)
    ? rawResult
    : isPlainRecord(rawResult) && Array.isArray(rawResult['items'])
      ? rawResult['items']
      : []
  const rows: SessionRow[] = []
  const seen = new Set<string>()
  for (const item of items) {
    if (!isPlainRecord(item)) continue
    const summaryCandidate = item as SummaryLike
    const id = summaryId(summaryCandidate)
    if (id !== undefined) {
      if (seen.has(id)) continue
      seen.add(id)
      rows.push(toSessionRow(id, undefined, summaryCandidate))
      continue
    }
    const header = isPlainRecord(item['header']) ? (item['header'] as PersistenceSnapshot['header']) : undefined
    const headerId = nonEmptyString(header?.id)
    if (headerId === undefined || seen.has(headerId)) continue
    seen.add(headerId)
    rows.push(toSessionRow(headerId, header, undefined))
  }
  attachLastActivityTimes(rows)
  return rows
}

/** 解析 `.git/HEAD` 或 `.git/worktrees/<name>/HEAD` 的检出分支短名。 */
function parseGitHeadBranch(text: string | undefined): string | undefined {
  if (typeof text !== 'string') return undefined
  const line = text.split(/\r?\n/, 1)[0]?.trim() ?? ''
  if (line.startsWith('ref: refs/heads/')) {
    const branch = line.slice('ref: refs/heads/'.length).trim()
    return branch === '' ? undefined : branch
  }
  return undefined
}

/** 从关联 worktree 目录名或管理目录名推断分支名（无会话可读 `.git/worktrees/<name>/HEAD` 时的启发式兜底）。 */
function inferRemoteWorktreeBranch(mainPath: string, wtPath: string, wtAdminName?: string): string | undefined {
  const mainBase = basename(mainPath)
  const wtBase = basename(wtPath)
  if (mainBase !== '' && wtBase.startsWith(`${mainBase}-`) && wtBase.length > mainBase.length + 1) {
    return wtBase.slice(mainBase.length + 1)
  }
  if (wtAdminName !== undefined && wtAdminName !== '') {
    if (mainBase !== '' && wtAdminName.startsWith(`${mainBase}-`) && wtAdminName.length > mainBase.length + 1) {
      return wtAdminName.slice(mainBase.length + 1)
    }
    return wtAdminName
  }
  return undefined
}

/**
 * Tier 2：利用远端网关的 `directoryPicker/list` 与 `workspaceFiles/read` 探测机器 B 上的 git 仓库与 worktrees。
 *
 * 性能与防阻塞设计：
 * - **只探测已注册工作区路径（`workspaces[*].path`）** 以及由关联 worktree `.git` 文件反推的主仓路径，**绝不**遍历全量历史会话的 `cwd`；
 * - **支持 `<MainRepo>-<branch>` 命名启发式匹配**：当主仓或关联 worktree 下没有会话可供 `workspaceFiles/read` 读取 `gitdir`/`HEAD` 时，结合 `.git/worktrees/<wtName>` 与已注册工作区集合的命名约定（同父目录兄弟 `<MainRepo>-<branch>` 或 `worktrees/<MainRepo>-<branch>`）自动归并关联 worktree 并推断分支名；
 * - **按 `(targetKey, workspaceSignature)` 进程内缓存**（TTL 30 s），工作区列表不变时零重复跨网目录探测。
 */
async function scanRemoteGatewayRepos(
  gateway: HostTypertGateway,
  targetKey: string,
  workspaces: readonly WorkspaceRow[],
  sessions: readonly SessionRow[],
  now = Date.now(),
  signal?: AbortSignal,
): Promise<{
  repos: Map<string, RepoInfo>
  pathToCommonDir: Map<string, string>
  liveWorkspacePaths: Set<string>
}> {
  const wsSig = workspaceSignature(workspaces)
  const cachedScan = remoteRepoScanCache.get(targetKey)
  if (
    cachedScan !== undefined &&
    cachedScan.workspaceSig === wsSig &&
    now >= cachedScan.at &&
    now - cachedScan.at < REMOTE_REPO_SCAN_CACHE_TTL_MS
  ) {
    return {
      repos: new Map(cachedScan.repos),
      pathToCommonDir: new Map(cachedScan.pathToCommonDir),
      liveWorkspacePaths: new Set(cachedScan.liveWorkspacePaths),
    }
  }

  const repos = new Map<string, RepoInfo>()
  const pathToCommonDir = new Map<string, string>()
  const liveWorkspacePaths = new Set<string>()

  // 建立 归一化目录 → 可作 workspaceFileScopeId 的 sessionId 索引
  const sessionByDir = new Map<string, { sessionId: string; cwd: string }>()
  for (const session of sessions) {
    const rawCwd = nonEmptyString(session.cwd)
    if (rawCwd === undefined) continue
    const normCwd = normalizePath(rawCwd)
    if (!sessionByDir.has(normCwd)) {
      sessionByDir.set(normCwd, { sessionId: session.sessionId, cwd: normCwd })
    }
  }

  const dirCache = new Map<string, Promise<{ exists: boolean; entries: Array<{ name: string; path: string }> }>>()
  const listRemoteDir = (
    rawPath: string,
  ): Promise<{ exists: boolean; entries: Array<{ name: string; path: string }> }> => {
    const norm = normalizePath(rawPath)
    const existing = dirCache.get(norm)
    if (existing !== undefined) return existing
    const pending = (async (): Promise<{ exists: boolean; entries: Array<{ name: string; path: string }> }> => {
      try {
        const res = await invokeRemoteGateway(gateway, 'directoryPicker', 'list', { path: norm }, signal)
        const rawEntries = isPlainRecord(res) && Array.isArray(res['entries']) ? res['entries'] : []
        const entries: Array<{ name: string; path: string }> = []
        for (const item of rawEntries) {
          if (!isPlainRecord(item)) continue
          const name = nonEmptyString(item['name'])
          const itemPath = nonEmptyString(item['path']) ?? (name !== undefined ? join(norm, name) : undefined)
          if (name !== undefined && itemPath !== undefined) {
            entries.push({ name, path: normalizePath(itemPath) })
          }
        }
        return { exists: true, entries }
      } catch {
        return { exists: false, entries: [] }
      }
    })()
    dirCache.set(norm, pending)
    return pending
  }

  const readRemoteFile = async (dirPath: string, relPath: string): Promise<string | undefined> => {
    const normDir = normalizePath(dirPath)
    const directScope = sessionByDir.get(normDir)
    if (directScope === undefined) return undefined
    try {
      const res = await invokeRemoteGateway(
        gateway,
        'workspaceFiles',
        'read',
        {
          workspaceFileScopeId: directScope.sessionId,
          path: relPath,
          range: { offset: 1, limit: 20 },
        },
        signal,
      )
      if (isPlainRecord(res) && typeof res['text'] === 'string') {
        return res['text'].trim()
      }
    } catch {
      // 忽略：回退 undefined
    }
    return undefined
  }

  // 仅以已注册工作区路径作为探测候选（绝不加入全部历史会话的 cwd）
  const workspacePaths = [...new Set(workspaces.map((ws) => normalizePath(ws.path)))]
  // 会话中有 `.git` 文件可读的目录，仅在主树匹配 `.git/worktrees/<wtName>` 时按需查阅
  const sessionDirsWithScope = [...sessionByDir.keys()]

  const scanMainRepoAt = async (mainPathRaw: string): Promise<RepoInfo | null> => {
    const mainPath = normalizePath(mainPathRaw)
    const commonDir = normalizePath(join(mainPath, '.git'))
    const existing = repos.get(commonDir)
    if (existing !== undefined) return existing

    const mainDirListing = await listRemoteDir(mainPath)
    if (!mainDirListing.exists || !mainDirListing.entries.some((e) => e.name === '.git')) {
      return null
    }
    const mainHeadText = await readRemoteFile(mainPath, '.git/HEAD')
    const mainBranch = parseGitHeadBranch(mainHeadText)
    const worktrees: WorktreeEntry[] = [
      {
        path: mainPath,
        ...(mainBranch === undefined ? {} : { branch: mainBranch }),
        isMain: true,
        bare: false,
        exists: true,
      },
    ]
    const seenWorktreePaths = new Set<string>([mainPath])

    const wtListing = await listRemoteDir(join(commonDir, 'worktrees'))
    if (wtListing.exists && wtListing.entries.length > 0) {
      for (const wtAdmin of wtListing.entries) {
        const wtName = wtAdmin.name
        const [gitdirText, headText] = await Promise.all([
          readRemoteFile(mainPath, `.git/worktrees/${wtName}/gitdir`),
          readRemoteFile(mainPath, `.git/worktrees/${wtName}/HEAD`),
        ])
        let wtPath: string | undefined
        if (gitdirText !== undefined && gitdirText !== '') {
          const line = gitdirText.split(/\r?\n/, 1)[0]?.trim() ?? ''
          if (line !== '') {
            wtPath = normalizePath(line.replace(/[/\\]\.git[/\\]?$/, ''))
          }
        }
        // 回退 1：优先在已注册工作区路径中按目录名精确匹配 wtName 或 <MainRepo>-<wtName>
        if (wtPath === undefined) {
          const mainBase = basename(mainPath)
          const hitWs = workspacePaths.find((cand) => {
            if (cand === mainPath || seenWorktreePaths.has(cand)) return false
            const candBase = basename(cand)
            return candBase === wtName || (mainBase !== '' && candBase === `${mainBase}-${wtName}`)
          })
          if (hitWs !== undefined) wtPath = hitWs
        }
        // 回退 2：在拥有活跃会话 scope 的目录中尝试读 `.git` 文件反查
        if (wtPath === undefined) {
          const expectedSuffix = `/.git/worktrees/${wtName}`
          for (const cand of sessionDirsWithScope) {
            if (cand === mainPath || seenWorktreePaths.has(cand)) continue
            const dotGit = await readRemoteFile(cand, '.git')
            if (dotGit !== undefined && normalizePath(dotGit.replace(/^gitdir:\s*/i, '')).endsWith(expectedSuffix)) {
              wtPath = cand
              break
            }
          }
        }
        // 回退 3：同父目录兄弟目录查找
        if (wtPath === undefined) {
          const parentListing = await listRemoteDir(dirname(mainPath))
          const hit = parentListing.entries.find(
            (e) => e.name === wtName || e.name === `${basename(mainPath)}-${wtName}`,
          )
          if (hit !== undefined) wtPath = hit.path
        }
        if (wtPath === undefined || seenWorktreePaths.has(wtPath)) continue
        seenWorktreePaths.add(wtPath)
        const wtDirListing = await listRemoteDir(wtPath)
        const branch = parseGitHeadBranch(headText) ?? inferRemoteWorktreeBranch(mainPath, wtPath, wtName)
        worktrees.push({
          path: wtPath,
          ...(branch === undefined ? {} : { branch }),
          isMain: false,
          bare: false,
          exists: wtDirListing.exists,
        })
      }
    }

    const repo: RepoInfo = { commonDir, mainPath, worktrees }
    repos.set(commonDir, repo)
    pathToCommonDir.set(mainPath, commonDir)
    pathToCommonDir.set(commonDir, commonDir)
    for (const wt of worktrees) {
      pathToCommonDir.set(normalizePath(wt.path), commonDir)
    }
    return repo
  }

  // 第一轮：并行预热全部已注册工作区目录列表，并识别所有包含 `.git` 子目录的主工作树
  const wsListings = await Promise.all(
    workspacePaths.map(async (norm) => ({ norm, listing: await listRemoteDir(norm) })),
  )
  for (const { norm, listing } of wsListings) {
    if (listing.exists) liveWorkspacePaths.add(norm)
    if (listing.exists && listing.entries.some((e) => e.name === '.git')) {
      await scanMainRepoAt(norm)
    }
  }

  // 第二轮：对尚未归入任何 git 仓的已注册工作区，检查其 `.git` 文件或命名启发式（`<MainRepo>-<branch>`）
  for (const { norm: cand, listing } of wsListings) {
    if (pathToCommonDir.has(cand) || !listing.exists) continue
    const dotGit = await readRemoteFile(cand, '.git')
    if (dotGit !== undefined && /^gitdir:/i.test(dotGit)) {
      const rawTarget = dotGit.replace(/^gitdir:\s*/i, '').split(/\r?\n/, 1)[0]?.trim() ?? ''
      const normTarget = normalizePath(rawTarget.startsWith('/') ? rawTarget : join(cand, rawTarget))
      const match = /^(.*\/\.git)\/worktrees\/([^/]+)\/?$/.exec(normTarget)
      if (match !== null) {
        const commonDir = normalizePath(match[1])
        const mainPath = normalizePath(dirname(commonDir))
        const scanned = await scanMainRepoAt(mainPath)
        if (scanned !== null) {
          pathToCommonDir.set(cand, scanned.commonDir)
          continue
        }
      }
    }
    // 命名启发式兜底：若已识别的主仓 `mainPath` 满足 `<MainRepo>-<branch>`（同父目录或位于同级/子级 `worktrees/` 目录）
    for (const [commonDir, repo] of repos) {
      const mainPath = normalizePath(repo.mainPath)
      const mainBase = basename(mainPath)
      const candBase = basename(cand)
      if (mainBase === '' || !candBase.startsWith(`${mainBase}-`) || candBase.length <= mainBase.length + 1) {
        continue
      }
      const sameParent = dirname(cand) === dirname(mainPath)
      const inWorktreesDir =
        basename(dirname(cand)).toLowerCase().includes('worktree') &&
        (dirname(dirname(cand)) === dirname(mainPath) || dirname(dirname(cand)) === mainPath)
      if (!sameParent && !inWorktreesDir) continue
      if (!repo.worktrees.some((w) => normalizePath(w.path) === cand)) {
        const inferredBranch = inferRemoteWorktreeBranch(mainPath, cand)
        repo.worktrees.push({
          path: cand,
          ...(inferredBranch === undefined ? {} : { branch: inferredBranch }),
          isMain: false,
          bare: false,
          exists: true,
        })
      }
      pathToCommonDir.set(cand, commonDir)
      break
    }
  }

  remoteRepoScanCache.set(targetKey, {
    at: now,
    workspaceSig: wsSig,
    repos: new Map(repos),
    pathToCommonDir: new Map(pathToCommonDir),
    liveWorkspacePaths: new Set(liveWorkspacePaths),
  })

  return { repos, pathToCommonDir, liveWorkspacePaths }
}

/**
 * Tier 2：通过远端 `ctx.typertGateway` 收集远端机器 B 的完整树快照。
 */
async function collectRemoteGatewaySnapshot(
  ctx: Context,
  targetKey: string,
  options: SnapshotOptions = {},
): Promise<TreeSnapshot> {
  const signal = options.signal
  const ledger = remoteLedgerStore(targetKey)
  const ledgerData = await ledger.read()
  const gateway = getOptionalService<HostTypertGateway>(ctx, 'typertGateway')

  if (gateway === undefined) {
    return {
      workspaces: [],
      sessions: [],
      archivedSessionIds: [],
      repos: {},
      repoByWorkspacePath: {},
      workspaceByPath: {},
      ledger: ledgerData,
      knownWorktreePaths: new Set(),
      knownRepoPaths: new Set(),
      mainPathByKnownPath: new Map(),
      liveWorkspacePaths: new Set(),
      nonMainWorkspacePaths: new Set(),
    }
  }

  const [{ workspaces, archivedSessionIds }, sessions] = await Promise.all([
    readRemoteGatewayWorkspaces(gateway, signal),
    readRemoteGatewaySessions(gateway, signal),
  ])

  const { repos, pathToCommonDir, liveWorkspacePaths } = await scanRemoteGatewayRepos(
    gateway,
    targetKey,
    workspaces,
    sessions,
    options.now ?? Date.now(),
    signal,
  )

  const repoByWorkspacePath: Record<string, string> = {}
  const workspaceByPath: Record<string, string> = {}
  for (const workspace of workspaces) {
    const path = normalizePath(workspace.path)
    if (workspaceByPath[path] === undefined) workspaceByPath[path] = workspace.workspaceId
    const direct = pathToCommonDir.get(path)
    if (direct !== undefined) {
      repoByWorkspacePath[path] = direct
      continue
    }
    for (const [commonDir, repo] of repos) {
      if (normalizePath(repo.mainPath) === path || repo.worktrees.some((e) => normalizePath(e.path) === path)) {
        repoByWorkspacePath[path] = commonDir
        break
      }
    }
  }

  const knownWorktreePaths = new Set<string>()
  const knownRepoPaths = new Set<string>()
  const mainPathByKnownPath = new Map<string, string>()
  for (const [commonDir, repo] of repos) {
    const mainPath = normalizePath(repo.mainPath)
    knownRepoPaths.add(normalizePath(commonDir))
    knownRepoPaths.add(mainPath)
    mainPathByKnownPath.set(normalizePath(commonDir), mainPath)
    mainPathByKnownPath.set(mainPath, mainPath)
    for (const entry of repo.worktrees) {
      const wtPath = normalizePath(entry.path)
      knownWorktreePaths.add(wtPath)
      knownRepoPaths.add(wtPath)
      if (!mainPathByKnownPath.has(wtPath)) mainPathByKnownPath.set(wtPath, mainPath)
    }
  }
  for (const ws of workspaces) {
    const p = normalizePath(ws.path)
    knownWorktreePaths.add(p)
    knownRepoPaths.add(p)
  }

  const repoRecord: Record<string, RepoInfo> = {}
  for (const [commonDir, repo] of repos) repoRecord[commonDir] = repo

  return {
    workspaces,
    sessions,
    archivedSessionIds,
    repos: repoRecord,
    repoByWorkspacePath,
    workspaceByPath,
    ledger: ledgerData,
    knownWorktreePaths,
    knownRepoPaths,
    mainPathByKnownPath,
    liveWorkspacePaths,
    nonMainWorkspacePaths: new Set(),
  }
}

/**
 * Tier 2：在远端网关上打开或创建工作区（`POST /workspace-open` 回退）。
 */
async function openRemoteGatewayWorkspace(
  ctx: Context,
  rawPath: string,
  signal?: AbortSignal,
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const gateway = getOptionalService<HostTypertGateway>(ctx, 'typertGateway')
  if (gateway === undefined) {
    return { status: 400, payload: { ok: false, message: '远端网关未就绪，无法注册工作区' } }
  }
  const norm = normalizePath(rawPath)
  try {
    const { workspaces } = await readRemoteGatewayWorkspaces(gateway, signal)
    const existing = workspaces.find((w) => normalizePath(w.path) === norm)
    if (existing !== undefined) {
      return { status: 200, payload: { ok: true, workspaceId: existing.workspaceId } }
    }
    const created = await invokeRemoteGateway(gateway, 'workspace', 'create', { request: { path: norm } }, signal)
    const record = isPlainRecord(created)
      ? isPlainRecord(created['workspace'])
        ? created['workspace']
        : created
      : undefined
    const workspaceId = nonEmptyString(record?.['workspaceId']) ?? nonEmptyString(record?.['id'])
    if (workspaceId === undefined) {
      return { status: 400, payload: { ok: false, message: '远端工作区注册未返回 id' } }
    }
    return { status: 200, payload: { ok: true, workspaceId } }
  } catch (error) {
    return { status: 400, payload: { ok: false, message: failMessage(error) } }
  }
}

/**
 * 在本机 `ctx` 上执行单个 `dsh-worktree-groups` 路由请求（供机器 B 作为 Host 响应 Tier 1 转发使用）。
 */
async function dispatchLocalWorktreePluginCall(
  ctx: Context,
  rawBody: unknown,
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const envelope = isPlainRecord(rawBody) ? rawBody : {}
  const endpoint = nonEmptyString(envelope['endpoint']) ?? 'tree'
  const body = isPlainRecord(envelope['payload']) ? envelope['payload'] : {}
  const hostLedger = getOptionalService<HostDshRemote>(ctx, 'dshRemote')?.ledger
  const localOpts: SnapshotOptions =
    hostLedger === undefined ? { forceLocal: true } : { forceLocal: true, ledger: hostLedger }

  const collectResponse = async (
    runner: (res: ServerResponse) => Promise<void>,
  ): Promise<{ status: number; payload: Record<string, unknown> }> => {
    let capturedStatus = 200
    let capturedText = '{}'
    const fakeResObj = {
      headersSent: false,
      writeHead(status: number) {
        capturedStatus = status
        fakeResObj.headersSent = true
        return fakeResObj
      },
      end(chunk?: unknown) {
        if (typeof chunk === 'string') capturedText = chunk
        fakeResObj.headersSent = true
        return fakeResObj
      },
    }
    const fakeRes = fakeResObj as unknown as ServerResponse
    await runner(fakeRes)
    try {
      const parsed: unknown = JSON.parse(capturedText)
      return {
        status: capturedStatus,
        payload: isPlainRecord(parsed) ? parsed : { ok: false, message: capturedText },
      }
    } catch {
      return { status: capturedStatus, payload: { ok: false, message: capturedText } }
    }
  }

  try {
    if (endpoint === 'tree') {
      const archiveProjectKey = bodyString(body, 'archiveProjectKey')
      const unarchiveProjectKey = bodyString(body, 'unarchiveProjectKey')
      const unarchivePath = bodyString(body, 'unarchivePath')
      if (archiveProjectKey !== undefined) {
        await archiveWorkspaceProject(ctx, archiveProjectKey, localOpts)
      }
      if (unarchiveProjectKey !== undefined || unarchivePath !== undefined) {
        await unarchiveWorkspaceProject(
          ctx,
          {
            ...(unarchiveProjectKey === undefined ? {} : { projectKey: unarchiveProjectKey }),
            ...(unarchivePath === undefined ? {} : { path: unarchivePath }),
          },
          localOpts,
        )
      }
      const payload = await buildTreePayload(ctx, { ...localOpts, reuseSessions: true })
      return { status: 200, payload: payload as unknown as Record<string, unknown> }
    }
    if (endpoint === 'worktree-create') {
      return await collectResponse((res) => handleWorktreeCreate(ctx, res, body, localOpts))
    }
    if (endpoint === 'worktree-remove') {
      return await collectResponse((res) => handleWorktreeRemove(ctx, res, body, localOpts))
    }
    if (endpoint === 'reveal') {
      return await collectResponse((res) => handleReveal(ctx, res, body, localOpts))
    }
    if (endpoint === 'workspace-open') {
      const path = bodyString(body, 'path')
      if (path === undefined) return { status: 400, payload: { ok: false, message: '缺少 path' } }
      const registry = getService<HostWorkspaceRegistry>(ctx, 'workspaceRegistry')
      if (typeof registry?.create !== 'function') {
        return { status: 400, payload: { ok: false, message: '宿主未提供 workspaceRegistry，无法注册工作区' } }
      }
      const created = await registry.create(normalizePath(path))
      const workspaceId = nonEmptyString(created?.id)
      if (workspaceId === undefined) {
        return { status: 400, payload: { ok: false, message: '工作区注册未返回 id' } }
      }
      try {
        await unarchiveWorkspaceProject(ctx, { path }, localOpts)
      } catch {
        // 忽略
      }
      return { status: 200, payload: { ok: true, workspaceId } }
    }
    return { status: 400, payload: { ok: false, message: `未知 endpoint: ${endpoint}` } }
  } catch (error) {
    return { status: 400, payload: { ok: false, message: failMessage(error) } }
  }
}

/** 已挂载过 Tier 1 远端桥的路由器 / 连接控制器（绑定到最新 `Context`）。 */
const routerOwnerCtx = new WeakMap<object, Context>()
const connectionsOwnerCtx = new WeakMap<object, Context>()

function wrapRemoteHostRouter(router: RemoteHostRouterLike | undefined, ctx: Context): void {
  if (router === undefined || typeof router !== 'object' || router === null) return
  const alreadyWrapped = routerOwnerCtx.has(router)
  routerOwnerCtx.set(router, ctx)
  if (alreadyWrapped) return

  const pluginRoute = router.pluginRoute
  if (pluginRoute !== undefined && typeof pluginRoute === 'object' && typeof pluginRoute.call === 'function') {
    const originalCall = pluginRoute.call.bind(pluginRoute)
    pluginRoute.call = async (input: unknown, transferred?: boolean): Promise<{ status: number; json: unknown }> => {
      if (isPlainRecord(input) && input['route'] === REMOTE_PLUGIN_ROUTE) {
        const currentCtx = routerOwnerCtx.get(router) ?? ctx
        const result = await dispatchLocalWorktreePluginCall(currentCtx, input['body'])
        return { status: result.status, json: result.payload }
      }
      return await originalCall(input, transferred)
    }
  }

  if (typeof router.handle === 'function') {
    const originalHandle = router.handle.bind(router)
    router.handle = async (message: unknown): Promise<unknown> => {
      if (
        router.pluginRoute === undefined &&
        isPlainRecord(message) &&
        message['type'] === 'rpc.request' &&
        isPlainRecord(message['payload']) &&
        message['payload']['method'] === 'plugin.route.call' &&
        isPlainRecord(message['payload']['params']) &&
        message['payload']['params']['route'] === REMOTE_PLUGIN_ROUTE
      ) {
        const currentCtx = routerOwnerCtx.get(router) ?? ctx
        const result = await dispatchLocalWorktreePluginCall(currentCtx, message['payload']['params']['body'])
        const reqId = message['id']
        return {
          id: reqId,
          type: 'rpc.response',
          timestamp: Date.now(),
          payload: {
            requestId: reqId,
            result: { status: result.status, json: result.payload },
          },
        }
      }
      return await originalHandle(message)
    }
  }
}

/**
 * 在机器 B 的 `ctx.dshRemote`（`HostPluginRuntime`）上挂载 Tier 1 路由处理器。
 *
 * 刻意不调用 `ctx.effect`（保持 `registerRoutes` 的 5 个路由 effect 契约不变）。
 */
function attachRemoteHostBridge(ctx: Context): void {
  const tryHook = (): void => {
    const dshRemote = getOptionalService<HostDshRemote>(ctx, 'dshRemote')
    const connections = dshRemote?.connections
    if (connections === undefined || typeof connections !== 'object' || connections === null) return

    if (connections.active instanceof Map) {
      for (const entry of connections.active.values()) {
        wrapRemoteHostRouter(entry?.router, ctx)
      }
    }

    const alreadyHooked = connectionsOwnerCtx.has(connections)
    connectionsOwnerCtx.set(connections, ctx)
    if (!alreadyHooked && typeof connections.createRouter === 'function') {
      const originalCreateRouter = connections.createRouter.bind(connections)
      connections.createRouter = (connCtx: unknown, send: unknown): RemoteHostRouterLike => {
        const router = originalCreateRouter(connCtx, send)
        const currentCtx = connectionsOwnerCtx.get(connections) ?? ctx
        wrapRemoteHostRouter(router, currentCtx)
        return router
      }
    }
  }

  tryHook()
  try {
    const on = (ctx as unknown as { on?: (event: string, listener: (...args: unknown[]) => void) => unknown }).on
    if (typeof on === 'function') {
      on.call(ctx, 'internal/service', (name: unknown) => {
        if (name === 'dshRemote') tryHook()
      })
    }
  } catch {
    // 忽略
  }
}

/**
 * 收集一次请求需要的全部宿主事实。
 *
 * 全部服务都是**惰性 + 可选**：任何一个缺席都只让对应部分为空，不抛错。
 */
export async function collectSnapshot(ctx: Context, options: SnapshotOptions = {}): Promise<TreeSnapshot> {
  if (options.forceLocal !== true) {
    const remote = readRemoteClientState(ctx)
    if (remote.isRemote) {
      return await collectRemoteGatewaySnapshot(ctx, remote.targetKey, options)
    }
  }

  const now = options.now ?? Date.now()
  const signal = options.signal
  const ledger = options.ledger ?? (await ledgerStore())

  const { workspaces, registry } = loadWorkspaces(ctx)
  const archivedSessionIds = loadArchivedSessionIds(registry)
  const sessions = options.reuseSessions === true
    ? await cachedSessionRows(ctx, now, signal)
    : (await buildSessionRows(ctx, signal)).rows

  let ledgerData: LedgerData
  try {
    ledgerData = await ledger.read()
  } catch {
    ledgerData = { version: 1, projects: {}, sessions: {} }
  }

  // 候选扫描路径：全部工作区路径 + 台账里记录过的主树路径
  // （后者用于「项目还在、但它的工作区已被注销」的场景，保证 history 桶仍有归属）。
  const candidateSet = new Set<string>()
  for (const workspace of workspaces) candidateSet.add(normalizePath(workspace.path))
  for (const project of Object.values(ledgerData.projects)) {
    const mainPath = nonEmptyString(project?.mainPath)
    if (mainPath !== undefined) candidateSet.add(normalizePath(mainPath))
  }

  const { repos, pathToCommonDir } = await scanRepos([...candidateSet], now, signal)

  const repoByWorkspacePath: Record<string, string> = {}
  const workspaceByPath: Record<string, string> = {}
  for (const workspace of workspaces) {
    const path = normalizePath(workspace.path)
    // 同路径多个工作区时保留先出现的（与 tree-model 的「顺序即宿主持久顺序」一致）。
    if (workspaceByPath[path] === undefined) workspaceByPath[path] = workspace.workspaceId
    const direct = pathToCommonDir.get(path)
    if (direct !== undefined) {
      repoByWorkspacePath[path] = direct
      continue
    }
    // 兜底：工作区落在某个已扫描仓的 worktree 里（或在主树路径上）。
    for (const [commonDir, repo] of repos) {
      if (normalizePath(repo.mainPath) === path) {
        repoByWorkspacePath[path] = commonDir
        break
      }
      if (repo.worktrees.some((entry) => normalizePath(entry.path) === path)) {
        repoByWorkspacePath[path] = commonDir
        break
      }
    }
  }

  const knownWorktreePaths = new Set<string>()
  const knownRepoPaths = new Set<string>()
  const mainPathByKnownPath = new Map<string, string>()
  const remember = (path: string, mainPath: string, isRepoEntry: boolean): void => {
    if (isRepoEntry) knownRepoPaths.add(path)
    else {
      knownWorktreePaths.add(path)
      knownRepoPaths.add(path)
    }
    if (!mainPathByKnownPath.has(path)) mainPathByKnownPath.set(path, mainPath)
  }

  for (const [commonDir, repo] of repos) {
    const mainPath = normalizePath(repo.mainPath)
    knownRepoPaths.add(normalizePath(commonDir))
    knownRepoPaths.add(mainPath)
    mainPathByKnownPath.set(normalizePath(commonDir), mainPath)
    mainPathByKnownPath.set(mainPath, mainPath)
    for (const entry of repo.worktrees) remember(normalizePath(entry.path), mainPath, false)
    // git 扫描的**入口路径**也要能反查到主树：macOS 的 /var → /private/var 符号链接
    // 会让入口拼法与 `worktree list` 的拼法不同，二者都必须可用。
    for (const [entryPath, common] of pathToCommonDir) {
      if (common === commonDir) remember(entryPath, mainPath, false)
    }
  }
  for (const project of Object.values(ledgerData.projects)) {
    const rawMainPath = nonEmptyString(project?.mainPath)
    if (rawMainPath === undefined) continue
    const mainPath = normalizePath(rawMainPath)
    knownRepoPaths.add(mainPath)
    if (!mainPathByKnownPath.has(mainPath)) mainPathByKnownPath.set(mainPath, mainPath)
    for (const worktreePath of Object.keys(project?.worktrees ?? {})) {
      remember(normalizePath(worktreePath), mainPath, false)
    }
  }
  for (const workspace of workspaces) {
    const path = normalizePath(workspace.path)
    if (!knownWorktreePaths.has(path) && !knownRepoPaths.has(path)) {
      knownWorktreePaths.add(path)
      knownRepoPaths.add(path)
    }
    const repoKey = repoByWorkspacePath[path]
    const repo = repoKey === undefined ? undefined : repos.get(repoKey)
    const mainPath = repo === undefined ? path : normalizePath(repo.mainPath)
    if (!mainPathByKnownPath.has(path)) mainPathByKnownPath.set(path, mainPath)
  }

  // 工作区路径的磁盘存在性：**用 fs.stat 实测**，不靠推断。
  // 这是 D18 清扫与规则 2b 共同依赖的事实（扫描结果里只有 worktree 根，子目录工作区不在其中）。
  const liveWorkspacePaths = new Set<string>()
  const nonMainWorkspacePaths = new Set<string>()
  // 正面证据（1）：git 扫描里的**非主** worktree 路径。
  for (const repo of repos.values()) {
    for (const entry of repo.worktrees) {
      if (!entry.isMain) nonMainWorkspacePaths.add(normalizePath(entry.path))
    }
  }
  // 正面证据（2）：台账记过的 worktree 路径，且不等于该项目记录的 mainPath。
  for (const project of Object.values(ledgerData.projects)) {
    const rawMain = nonEmptyString(project?.mainPath)
    const mainPath = rawMain === undefined ? undefined : normalizePath(rawMain)
    for (const worktreePath of Object.keys(project?.worktrees ?? {})) {
      const path = normalizePath(worktreePath)
      if (mainPath !== undefined && path === mainPath) continue
      nonMainWorkspacePaths.add(path)
    }
  }
  // PERF：并行 stat（旧实现逐个 await）。
  const workspacePaths = [...new Set(workspaces.map((workspace) => normalizePath(workspace.path)))]
  const alive = await Promise.all(workspacePaths.map((path) => pathExists(path)))
  workspacePaths.forEach((path, index) => {
    if (alive[index] === true) liveWorkspacePaths.add(path)
  })

  return {
    workspaces,
    repos: Object.fromEntries(repos),
    repoByWorkspacePath,
    ledger: ledgerData,
    sessions,
    archivedSessionIds,
    workspaceByPath,
    knownWorktreePaths,
    knownRepoPaths,
    mainPathByKnownPath,
    liveWorkspacePaths,
    nonMainWorkspacePaths,
  }
}

/**
 * **D18 自动清扫**：注销「目录已死」且「不是其仓主工作树」的 dsh 工作区记录。
 *
 * PRD D18（用户拍板）：worktree 被外部 `rm -rf` 后，不应在侧栏留下一行死工作区；
 * 其会话应由 `buildProjects` 的规则 3/4 归入该项目的 history 桶。
 *
 * 安全边界（与 D18 原文一致）：
 * - **只碰注册表，不碰磁盘、不碰会话日志**（`registry.delete` 只删一条记录）；
 * - **主仓自己的目录被删时不动它** —— 那多半是临时不可达或用户会重建，
 *   自动注销会造成「重启后工作区莫名消失」；
 * - 单个失败不中断整体（收集后返回，由调用方决定是否报告）。
 *
 * 返回**被成功注销**的 workspaceId 列表，便于调用方/测试断言。
 */
export async function sweepDeadWorkspaces(
  ctx: Context,
  snapshot: TreeSnapshot,
): Promise<{ removed: string[]; failed: Array<{ workspaceId: string; message: string }> }> {
  const registry = getService<HostWorkspaceRegistry>(ctx, 'workspaceRegistry')
  const removed: string[] = []
  const failed: Array<{ workspaceId: string; message: string }> = []
  if (typeof registry?.delete !== 'function') return { removed, failed }

  for (const workspace of snapshot.workspaces) {
    const path = normalizePath(workspace.path)
    if (snapshot.liveWorkspacePaths.has(path)) continue
    // 主工作树（或无法判定为非主树的路径）不自动注销。
    if (!snapshot.nonMainWorkspacePaths.has(path)) continue
    try {
      // `delete` 对未知 id 是幂等 no-op（返回 false）；两种情况都算「记录已不在注册表里」。
      await registry.delete(workspace.workspaceId)
      removed.push(workspace.workspaceId)
    } catch (error) {
      failed.push({ workspaceId: workspace.workspaceId, message: failMessage(error) })
    }
  }
  return { removed, failed }
}

/** `POST /dsh-worktree-groups/tree` 的响应体。 */
export interface TreePayload {
  ok: true
  projects: ProjectNode[]
  ungrouped: SessionRow[]
  archivedSessionIds: string[]
  workspaceByPath: Record<string, string>
  archivedProjects: ArchivedProjectRow[]
}

/**
 * 组装 `POST /tree` 的完整载荷（导出以便脱离 HTTP 层做端到端验证）。
 *
 * 顺带把本次观察到的事实写回台账（首次/最近见到 worktree、已消失时刻、会话归属）。
 * 台账写失败**不影响**响应（PRD R4：台账只是辅助归属信息）。
 */
export async function buildTreePayload(
  ctx: Context,
  options: SnapshotOptions = {},
  precomputed?: TreePayload,
): Promise<TreePayload> {
  const remoteState = options.forceLocal === true ? { isRemote: false, targetKey: 'local' } : readRemoteClientState(ctx)
  if (remoteState.isRemote && precomputed === undefined) {
    const tier1 = await tryCallRemotePluginRoute(ctx, 'tree', {}, options.signal, options.now ?? Date.now())
    if (tier1.supported && tier1.payload['ok'] === true && Array.isArray(tier1.payload['projects'])) {
      return tier1.payload as unknown as TreePayload
    }
  }

  const effectiveOptions: SnapshotOptions = remoteState.isRemote
    ? { ...options, ledger: remoteLedgerStore(remoteState.targetKey) }
    : options
  const snapshot = await collectSnapshot(ctx, effectiveOptions)

  // D18：先清扫「目录已死且非主工作树」的工作区记录，**再**合成树。
  // 这样死工作区不会出现在本轮响应里，其会话随即由规则 3/4 落进 history 桶。
  // 清扫失败不影响本轮渲染（规则 2 的 exists 校验已保证会话不会被扣在死节点上）。
  // ⚠️ 远端模式下禁止对本机 workspaceRegistry 执行清扫（AC3）。
  const swept = remoteState.isRemote
    ? { removed: [] as string[], failed: [] as Array<{ workspaceId: string; path: string; message: string }> }
    : await sweepDeadWorkspaces(ctx, snapshot)
  if (swept.removed.length > 0 || swept.failed.length > 0) {
    // 重新读一次注册表，让本轮响应反映清扫结果。
    const refreshed = loadWorkspaces(ctx)
    // **D8**：用「内容签名」判断是否真的变了，**不用长度**。
    // 长度是代理指标：清扫删 1 个 + 宿主同轮新增 1 个 ⇒ 长度相等，旧写法会误判
    // 「没变」而拿旧表渲染一轮（死工作区行多显示一次）。签名含 id/path/updatedAt，
    // 成员增删、路径改写、重命名都能检出，且排序后与 `list()` 顺序无关。
    if (workspaceSignature(refreshed.workspaces) !== workspaceSignature(snapshot.workspaces)) {
      snapshot.workspaces = refreshed.workspaces
      snapshot.archivedSessionIds = loadArchivedSessionIds(refreshed.registry)
    }
    // 被注销的 workspaceId 必须从路径索引里摘掉 —— 这一步与「注册表内容是否变」
    // 无关：`registry.delete()` 已成功，索引里的旧映射就是脏数据。
    if (swept.removed.length > 0) {
      for (const id of swept.removed) {
        for (const [path, workspaceId] of Object.entries(snapshot.workspaceByPath)) {
          if (workspaceId === id) delete snapshot.workspaceByPath[path]
        }
      }
    }
    if (swept.failed.length > 0) {
      try {
        ctx.logger?.warn?.(
          `dsh-worktree-groups: D18 清扫有 ${swept.failed.length} 个工作区注销失败：${swept.failed
            .map((item) => `${item.workspaceId}(${item.message})`)
            .join('; ')}`,
        )
      } catch {
        // logger 不可用：忽略
      }
    }
  }

  const input = {
    workspaces: snapshot.workspaces,
    repos: snapshot.repos,
    repoByWorkspacePath: snapshot.repoByWorkspacePath,
    ledger: snapshot.ledger,
    sessions: snapshot.sessions,
    archivedSessionIds: snapshot.archivedSessionIds,
    liveWorkspacePaths: snapshot.liveWorkspacePaths,
  }

  const built = precomputed ?? buildProjects(input)
  // ⚠️ WSR2：必须在过滤掉已归档工作空间**之前**用全量 `built.projects` 计算 `ungrouped`，
  // 这样归属到已归档工作空间的会话已被该工作空间认领，绝不会漏进「未分组」。
  const ungrouped = collectUngrouped(input, built.projects)

  try {
    await updateLedger(snapshot, effectiveOptions, built.projects)
  } catch {
    // 台账写失败不阻塞渲染。
  }

  const archivedMap = snapshot.ledger.archivedProjects ?? {}
  const activeProjects: ProjectNode[] = []
  const archivedRows: ArchivedProjectRow[] = []
  const seenArchivedKeys = new Set<string>()

  for (const project of built.projects) {
    const entry = archivedMap[project.key]
    if (entry === undefined) {
      activeProjects.push(project)
      continue
    }
    seenArchivedKeys.add(project.key)
    const fallbackPath =
      project.mainPath ??
      project.worktrees[0]?.path ??
      (project.key.startsWith('ws:')
        ? snapshot.workspaces.find((w) => `ws:${w.workspaceId}` === project.key)?.path
        : undefined)
    const resolvedPath = entry.path ?? fallbackPath
    archivedRows.push({
      key: project.key,
      title: project.title !== '' ? project.title : entry.title,
      ...(resolvedPath === undefined ? {} : { path: resolvedPath }),
      isGit: project.isGit,
      archivedAt: entry.archivedAt,
    })
  }

  for (const [key, entry] of Object.entries(archivedMap)) {
    if (seenArchivedKeys.has(key)) continue
    archivedRows.push({
      key,
      title: entry.title,
      ...(entry.path === undefined ? {} : { path: entry.path }),
      isGit: entry.isGit,
      archivedAt: entry.archivedAt,
    })
  }

  archivedRows.sort((a, b) => (b.archivedAt !== a.archivedAt ? b.archivedAt - a.archivedAt : a.key.localeCompare(b.key)))

  return {
    ok: true,
    projects: activeProjects,
    ungrouped,
    archivedSessionIds: snapshot.archivedSessionIds,
    workspaceByPath: snapshot.workspaceByPath,
    archivedProjects: archivedRows,
  }
}

/**
 * 归档一个工作空间（2026-10-21 WSR1/WSR2，AC7）。
 *
 * 将 `projectKey` 记入台账 `archivedProjects`；保留宿主 `workspaceRegistry` 记录不销毁，
 * 使恢复（设置页放出或重新添加同目录）后标题、worktree 与会话原样归位。
 */
export async function archiveWorkspaceProject(
  ctx: Context,
  projectKey: string,
  options: SnapshotOptions = {},
): Promise<{ ok: boolean; archivedProjects: Record<string, LedgerArchivedProject> }> {
  const key = projectKey.trim()
  if (key === '') return { ok: false, archivedProjects: {} }

  const remoteState = options.forceLocal === true ? { isRemote: false, targetKey: 'local' } : readRemoteClientState(ctx)
  const now = options.now ?? Date.now()
  const ledger = remoteState.isRemote
    ? remoteLedgerStore(remoteState.targetKey)
    : (options.ledger ?? (await ledgerStore()))
  const snapshot = await collectSnapshot(ctx, { ...options, ledger })
  const built = buildProjects({
    workspaces: snapshot.workspaces,
    repos: snapshot.repos,
    repoByWorkspacePath: snapshot.repoByWorkspacePath,
    ledger: snapshot.ledger,
    sessions: snapshot.sessions,
    archivedSessionIds: snapshot.archivedSessionIds,
    liveWorkspacePaths: snapshot.liveWorkspacePaths,
  })
  const matched = built.projects.find((p) => p.key === key)
  const wsPath = key.startsWith('ws:')
    ? snapshot.workspaces.find((w) => `ws:${w.workspaceId}` === key)?.path
    : undefined
  const path = matched?.mainPath ?? matched?.worktrees[0]?.path ?? wsPath
  const title = matched?.title ?? (path !== undefined ? basename(path) : key)
  const isGit = matched?.isGit ?? !key.startsWith('ws:')

  const updated = await ledger.update((current) => {
    const nextArchived: Record<string, LedgerArchivedProject> = {
      ...(current.archivedProjects ?? {}),
      [key]: {
        title,
        ...(path === undefined ? {} : { path }),
        isGit,
        archivedAt: now,
      },
    }
    return {
      ...current,
      archivedProjects: nextArchived,
    }
  })

  return { ok: true, archivedProjects: updated.archivedProjects ?? {} }
}

/**
 * 放出（取消归档）工作空间（2026-10-21 WSR2，AC7）。
 *
 * 支持两种匹配方式：
 * 1. `target.projectKey`：设置页点击「放出」时直接按项目键解除归档；
 * 2. `target.path`：用户在首页或侧栏重新添加相同目录（或同 git 仓库下的任意 worktree 目录）
 *    作为工作空间时，自动识别并解除该项目的归档状态。
 */
export async function unarchiveWorkspaceProject(
  ctx: Context,
  target: { projectKey?: string; path?: string },
  options: SnapshotOptions = {},
): Promise<{ ok: boolean; unarchivedKeys: string[] }> {
  const remoteState = options.forceLocal === true ? { isRemote: false, targetKey: 'local' } : readRemoteClientState(ctx)
  const ledger = remoteState.isRemote
    ? remoteLedgerStore(remoteState.targetKey)
    : (options.ledger ?? (await ledgerStore()))
  const currentLedger = await ledger.read()
  const archivedMap = currentLedger.archivedProjects ?? {}
  if (Object.keys(archivedMap).length === 0) {
    return { ok: true, unarchivedKeys: [] }
  }

  const keysToRemove = new Set<string>()
  if (typeof target.projectKey === 'string' && target.projectKey.trim() !== '') {
    const directKey = target.projectKey.trim()
    if (archivedMap[directKey] !== undefined) keysToRemove.add(directKey)
  }

  if (typeof target.path === 'string' && target.path.trim() !== '') {
    const normPath = normalizePath(target.path.trim())
    const realNormPath = remoteState.isRemote
      ? normPath
      : await realpath(normPath)
          .then((resolved) => normalizePath(resolved))
          .catch(() => normPath)
    const candidatePaths = new Set<string>([normPath, realNormPath])
    const snapshot = await collectSnapshot(ctx, { ...options, ledger })
    // 1. 直接匹配已归档条目的 path
    for (const [key, entry] of Object.entries(archivedMap)) {
      if (entry.path !== undefined && candidatePaths.has(normalizePath(entry.path))) {
        keysToRemove.add(key)
      }
    }
    // 2. 匹配已注册工作区路径对应的 ws:<id> 或 commonDir
    for (const ws of snapshot.workspaces) {
      const wsNorm = normalizePath(ws.path)
      if (candidatePaths.has(wsNorm)) {
        const wsKey = `ws:${ws.workspaceId}`
        if (archivedMap[wsKey] !== undefined) keysToRemove.add(wsKey)
        const repoKey = snapshot.repoByWorkspacePath[wsNorm]
        if (repoKey !== undefined && archivedMap[repoKey] !== undefined) keysToRemove.add(repoKey)
      }
    }
    // 3. 匹配已知 git 仓库的 mainPath 或任一 worktree 路径
    for (const [commonDir, repo] of Object.entries(snapshot.repos)) {
      if (archivedMap[commonDir] === undefined) continue
      if (
        candidatePaths.has(normalizePath(repo.mainPath)) ||
        repo.worktrees.some((wt) => candidatePaths.has(normalizePath(wt.path)))
      ) {
        keysToRemove.add(commonDir)
      }
    }
    // 4. 若该路径是尚未注册的新 worktree 目录，尝试直接跑一次 scanRepo 反查 commonDir
    if (keysToRemove.size === 0 && !remoteState.isRemote) {
      try {
        const scanned = await scanRepo(normPath, options.signal)
        if (scanned !== null && archivedMap[scanned.commonDir] !== undefined) {
          keysToRemove.add(scanned.commonDir)
        }
      } catch {
        // 忽略扫描异常
      }
    }
  }

  if (keysToRemove.size === 0) {
    return { ok: true, unarchivedKeys: [] }
  }

  await ledger.update((current) => {
    const prior = current.archivedProjects
    if (prior === undefined) return current
    const nextArchived: Record<string, LedgerArchivedProject> = {}
    let removed = false
    for (const [k, v] of Object.entries(prior)) {
      if (keysToRemove.has(k)) {
        removed = true
        continue
      }
      nextArchived[k] = v
    }
    if (!removed) return current
    const next: LedgerData = {
      version: 1,
      projects: current.projects,
      sessions: current.sessions,
    }
    if (Object.keys(nextArchived).length > 0) {
      next.archivedProjects = nextArchived
    }
    return next
  })

  return { ok: true, unarchivedKeys: [...keysToRemove] }
}

/**
 * 把本次观察写回台账。
 *
 * - `projects[commonDir].worktrees[path]`：首次见到填 `firstSeenAt = lastSeenAt = now`；
 *   再次见到刷新 `lastSeenAt`（并清除 `goneAt` —— 目录又被建回来了）；
 *   `exists === false` 时首次设置 `goneAt`。
 * - `sessions[sessionId] = { projectKey, worktreePath }`：只记录**本次确实归到某个
 *   活 worktree** 的会话；history 桶里的会话保留台账原值（否则会把历史归属覆盖成空）。
 */
/** 台账 `lastSeenAt` 的刷新粒度（2026-11-14 PERF2）：同一 worktree 至多每小时写一次。 */
export const LEDGER_LAST_SEEN_REFRESH_MS = 60 * 60_000

async function updateLedger(
  snapshot: TreeSnapshot,
  options: SnapshotOptions,
  projects: ProjectNode[],
): Promise<void> {
  const ledger = options.ledger ?? (await ledgerStore())
  const now = options.now ?? Date.now()

  await ledger.update((current) => {
    let changed = false
    const next: LedgerData = {
      version: 1,
      projects: { ...current.projects },
      sessions: { ...current.sessions },
      ...(current.archivedProjects === undefined
        ? {}
        : { archivedProjects: { ...current.archivedProjects } }),
    }

    for (const [commonDir, repo] of Object.entries(snapshot.repos)) {
      const existing = next.projects[commonDir]
      const worktrees: Record<
        string,
        { branch?: string; firstSeenAt: number; lastSeenAt: number; goneAt?: number }
      > = { ...(existing?.worktrees ?? {}) }

      for (const entry of repo.worktrees) {
        const path = normalizePath(entry.path)
        const prior = worktrees[path]
        if (prior === undefined) {
          worktrees[path] = {
            ...(entry.branch === undefined ? {} : { branch: entry.branch }),
            firstSeenAt: now,
            lastSeenAt: now,
            ...(entry.exists ? {} : { goneAt: now }),
          }
          changed = true
          continue
        }
        // PERF2：`lastSeenAt` 节流到 {@link LEDGER_LAST_SEEN_REFRESH_MS} —— 旧实现每个请求都刷成
        // `now` ⇒ `changed` 恒真 ⇒ 每次 `/tree` 都 fsync 重写整份台账（实测 352 KB）。
        const lastSeenAt =
          now < prior.lastSeenAt || now - prior.lastSeenAt >= LEDGER_LAST_SEEN_REFRESH_MS ? now : prior.lastSeenAt
        const patched: (typeof worktrees)[string] = { ...prior, lastSeenAt }
        if (entry.branch !== undefined) patched.branch = entry.branch
        if (entry.exists) delete patched.goneAt
        else patched.goneAt ??= now
        if (
          patched.lastSeenAt !== prior.lastSeenAt ||
          patched.branch !== prior.branch ||
          patched.goneAt !== prior.goneAt
        ) {
          worktrees[path] = patched
          changed = true
        }
      }

      const mainPath = normalizePath(repo.mainPath)
      if (existing === undefined || existing.mainPath !== mainPath) {
        next.projects[commonDir] = { mainPath, worktrees }
        changed = true
      } else if (changed) {
        next.projects[commonDir] = { mainPath, worktrees }
      }
    }

    // 会话归属：只登记**本次确实归到某个存在的 worktree** 的会话。
    // history 桶 / 未分组的会话保留台账原值 —— 否则会把历史归属覆盖掉。
    for (const project of projects) {
      if (!project.isGit) continue
      for (const node of project.worktrees) {
        if (!node.exists) continue
        for (const session of node.sessions) {
          const prior = next.sessions[session.sessionId]
          if (prior !== undefined && prior.projectKey === project.key && prior.worktreePath === node.path) {
            continue
          }
          next.sessions[session.sessionId] = { projectKey: project.key, worktreePath: node.path }
          changed = true
        }
      }
    }

    return changed ? next : current
  })
}

/* ------------------------------------------------------------------ *
 * HTTP helpers（照抄宿主契约 §A3.3 / 参考项目 panel-routes.ts 的私有 helper）
 * ------------------------------------------------------------------ */

/** 写 JSON 响应。 */
function json(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload))
}

/** 读请求体 JSON；解析失败或读流出错都 resolve 空对象（绝不 reject，否则请求悬挂）。 */
function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      try {
        const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
        resolve(typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {})
      } catch {
        resolve({})
      }
    })
    req.on('error', () => resolve({}))
  })
}

/** 把任意异常收敛成响应体。 */
function failMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 取请求体里的字符串字段（trim 后非空才算有值）。 */
function bodyString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key]
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/* ------------------------------------------------------------------ *
 * 路径校验
 * ------------------------------------------------------------------ */

/** 白名单判定的结果：要么给回归一化路径，要么给拒绝原因。 */
type PathVerdict = { ok: true; path: string } | { ok: false; message: string }

/**
 * 白名单精确匹配（合同 §1.5 硬要求）。
 *
 * **只做精确相等**，绝不做前缀匹配：`/a/b` 通过不代表 `/a/b/../..` 或 `/a/bc` 通过
 * （前缀匹配正是越权漏洞的常见来源）。归一化用 `normalizePath`（绝对化 + POSIX + 去尾斜杠），
 * 这也是本包内所有路径比较的唯一基准。
 */
function assertKnown(rawPath: unknown, allowed: ReadonlySet<string>, label: string): PathVerdict {
  if (typeof rawPath !== 'string' || rawPath.trim() === '') {
    return { ok: false, message: `缺少 ${label}` }
  }
  const path = normalizePath(rawPath)
  if (!allowed.has(path)) {
    return { ok: false, message: `${label} 不在已知集合内，拒绝访问：${path}` }
  }
  return { ok: true, path }
}

/** 目录是否存在（`fs.stat`）。 */
async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target)
    return true
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------ *
 * worktree-create / worktree-remove 的 git 层
 * ------------------------------------------------------------------ */

/**
 * **D-N1**：传给 git 的位置参数（分支名 / ref / 路径）的安全校验。
 *
 * 为什么需要它：这些值由调用方指定，并直接拼进 `git worktree add` 的**参数数组**。
 * 数组形式本身挡住了 shell 注入，但**挡不住 git 自己的选项解析** —— 以 `-` 开头的值
 * 会被 git 当成选项执行。实测（git 2.54.0）：`baseRef: "--no-checkout"` 会让
 * `git worktree add -b noc <target> --no-checkout` **成功返回**，但 worktree 里只有
 * `.git`、没有任何检出文件，而接口仍返回 `200 {ok:true}` 并自动注册成工作区。
 *
 * 规则刻意宽松：只挡**前导 `-`** 与 NUL / 换行。分支名合法地含有 `/`（`feature/ohos`）
 * 与 `.`（`release/6.1.20`），用「只允许字母数字」之类的白名单会砍掉正常用法。
 *
 * `src/panel-git.ts` 里移植过来的 `isSafeRef` **不在本包内**（已确认：`src/` 下只有
 * `git.ts`，无 `panel-git.ts`），故此处落地一个最小实现。
 */
export function isSafeGitArg(value: string): boolean {
  return value.length > 0 && !value.startsWith('-') && !/[\0\n\r]/.test(value)
}

/**
 * 把分支名净化为可做目录名的片段（PRD D7：`<主仓名>-<分支名 sanitize>`）。
 */
export function sanitizeBranchForPath(branch: string): string {
  const sanitized = branch.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return sanitized === '' ? 'worktree' : sanitized
}

/** 默认目标路径：`<主仓父目录>/<主仓名>-<分支名 sanitize>`。 */
export function defaultWorktreePath(mainPath: string, branch: string): string {
  const normalized = normalizePath(mainPath)
  return join(dirname(normalized), `${basename(normalized)}-${sanitizeBranchForPath(branch)}`)
}

/**
 * **D5**：调用方显式传入的 `targetPath` 的安全校验。
 *
 * 为什么需要它：`repoPath` 走严格白名单，而**同样由调用方指定、后果更重**的
 * `targetPath`（git 会在那里铺开整个文件树，且成功后会被 `registry.create()` 自动
 * 注册成 dsh 工作区）此前零校验 —— 一条 POST 就能把 worktree 建到 `/tmp/evil/...`
 * 或仓外任意位置。客户端当前不传该参数（纯 API 面缺口），但后端必须同源收紧。
 *
 * 约束（与 {@link defaultWorktreePath} 的落点算法同构）：
 *  1. 必须是**主仓父目录的直接子目录** —— `dirname(targetPath) === dirname(mainPath)`。
 *     这同时挡住 `/tmp/...`、仓内子路径、`..` 越狱（`normalizePath` 已解析过 `..`）。
 *  2. `basename(targetPath)` 必须先以 `basename(mainPath)` 开头（与默认推导的
 *     `<主仓名>-<后缀>` 形态一致），避免在用户的项目目录里凭空多出一个无关名字。
 *  3. 不得以 `.` 开头（挡住 `.git`、`.ssh` 之类隐藏目录）。
 *
 * **D-N2**：以上三条都基于 `normalizePath`（`path.resolve`，**只做词法归一、不解析
 * 符号链接**），因此「攻击者先在主仓父目录下建一个指向仓外的符号链接
 * `demo-repo-evil-link -> /仓外目录`」这条路径词法上完全合法 ⇒ 校验通过 ⇒ git 把整个
 * worktree 铺到**链接真身**（仓外），D-5 被绕过。修复方式是让调用方把**已 realpath
 * 解析的主仓父目录**通过 `parentReal` 传进来（见 {@link resolveParentReal}），并以它为准
 * 做第 1 条比较。这样：
 *  - 父目录是符号链接 ⇒ 解析后的真实父目录 ≠ 主仓真实父目录 ⇒ 拒绝；
 *  - 父目录不存在 / `realpath` 抛错 ⇒ 由调用方拒绝，绝不静默放行。
 *
 * `parentReal` 是**可选第三参**：缺省时退回原词法行为，既有单测的「9 类拒绝 + 放行」
 * 用例无需改签名即可继续通过。
 *
 * 不要求 `targetPath` **等于**默认推导路径：那会砍掉「同名不同后缀」的合法用法，
 * 超出本缺陷的修复范围。
 *
 * @param raw 调用方给的原始 `targetPath`（已由 `bodyString` 取成非空字符串）。
 * @param mainPath 已解析出的主工作树路径。
 * @param parentReal 可选的**已 realpath 解析**的主仓父目录（见 D-N2）。
 * @returns 归一化后的路径，或拒绝原因。
 */
export function validateTargetPath(raw: string, mainPath: string, parentReal?: string): PathVerdict {
  const main = normalizePath(mainPath)
  const parent = dirname(main)
  const target = normalizePath(raw)
  const label = 'targetPath'

  // **D-N2**：调用方解析过符号链接时（`parentReal` 给的是**真身**父目录），判据必须落在
  // realpath 空间 —— 词法比较挡不住「父目录是指向仓外的符号链接」：攻击者在主仓父目录下
  // 建一个 `demo-repo-evil-link -> /仓外目录`，词法上完全合法（同父目录 + 主仓名前缀）
  // ⇒ 校验通过 ⇒ git 把整个 worktree 铺到链接真身，D-5 被绕过。
  //
  // 目标也归一到**真身拼法**（父目录取真身、叶子名原样保留），因此返回的 `path` 可直接
  // 交给 git，且与 `git worktree list` 回的 realpath 拼法一致（回填更稳）。
  const effectiveParent = parentReal === undefined ? parent : normalizePath(parentReal)
  const effectiveTarget =
    parentReal === undefined ? target : join(effectiveParent, basename(target))

  if (effectiveTarget === main) {
    return { ok: false, message: `${label} 不能等于主仓路径：${effectiveTarget}` }
  }
  if (dirname(effectiveTarget) !== effectiveParent) {
    return {
      ok: false,
      message: `${label} 必须是主仓父目录的直接子目录（${effectiveParent}），拒绝：${effectiveTarget}`,
    }
  }
  const name = basename(effectiveTarget)
  if (name === '' || name.startsWith('.')) {
    return { ok: false, message: `${label} 的目录名非法（不得为空或以 . 开头）：${effectiveTarget}` }
  }
  if (!name.startsWith(basename(main))) {
    return {
      ok: false,
      message: `${label} 的目录名必须以主仓名开头（${basename(main)}），拒绝：${effectiveTarget}`,
    }
  }
  return { ok: true, path: effectiveTarget }
}

/**
 * **D-N2**：解析「`targetPath` 的父目录」与「主仓路径」的**真实路径**（`realpath`），
 * 供 {@link validateTargetPath} 的第三参做符号链接安全的比较。
 *
 * 为什么解析**父目录**而不是目标本身：目标目录**还不存在**，`realpath(target)` 必然 ENOENT。
 *
 * 全部失败路径都返回 `{ ok: false }`，**绝不**退化成放行：
 *  - 目标路径本身已存在且是**符号链接** ⇒ 拒绝（必须用 `lstat`：`stat` 会跟随链接，
 *    看不出它是链接）；
 *  - 目标父目录不存在 / 无权限 / `realpath` 抛错 ⇒ 拒绝；
 *  - 主仓父目录 `realpath` 失败 ⇒ 拒绝；
 *  - 解析后两个**真实**父目录不相等（父目录是符号链接，或路径中某一级指向别处）⇒ 拒绝。
 *
 * 通过时返回真身空间的 `mainPathReal` / `parentReal`：前者保证「等于主仓自身」这条判据
 * 也在 realpath 空间成立，后者就是允许落点。
 */
async function resolveRealTargetParents(
  rawTarget: string,
  mainPath: string,
): Promise<
  { ok: true; mainPathReal: string; parentReal: string } | { ok: false; message: string }
> {
  const target = normalizePath(rawTarget)
  const targetParent = dirname(target)

  // (1) 目标本身已存在且是符号链接 ⇒ 拒绝（`lstat`；`stat` 会跟随链接而看不出）。
  try {
    const info = await lstat(target)
    if (info.isSymbolicLink()) {
      return { ok: false, message: `targetPath 已存在且是符号链接，拒绝：${target}` }
    }
  } catch {
    // ENOENT：目标还不存在 —— 这是唯一合法的常态，继续校验它的父目录。
  }

  // (2) 父目录必须存在且可解析；`realpath` 抛错（ENOENT / 权限）⇒ 拒绝。
  let targetParentReal: string
  try {
    targetParentReal = await realpath(targetParent)
  } catch (error) {
    return {
      ok: false,
      message: `targetPath 的父目录不可用（不存在或无权访问），拒绝：${targetParent}（${failMessage(error)}）`,
    }
  }

  // (3) 主仓父目录同理；它就是「允许落点」的真身基准。
  const main = normalizePath(mainPath)
  const mainParent = dirname(main)
  let mainParentReal: string
  try {
    mainParentReal = await realpath(mainParent)
  } catch (error) {
    return {
      ok: false,
      message: `主仓父目录不可解析，拒绝：${mainParent}（${failMessage(error)}）`,
    }
  }

  // (4) 两边都解析到真身后再比较 —— 这一步才是挡住符号链接的地方。
  const parentReal = normalizePath(targetParentReal)
  const resolvedMainParent = normalizePath(mainParentReal)
  if (parentReal !== resolvedMainParent) {
    return {
      ok: false,
      message: `targetPath 的父目录经符号链接解析后不是主仓父目录（${resolvedMainParent}），拒绝：${target}`,
    }
  }

  return { ok: true, mainPathReal: join(parentReal, basename(main)), parentReal }
}

/**
 * 在 `repoPath` 下建 worktree，并返回 git 实际落盘的路径。
 *
 * `createBranch !== false` ⇒ `-b <branch>`（可选 `baseRef` 作起点）；否则检出**已有**分支。
 *
 * **D-N1**：`branch` / `baseRef` / `targetPath` 都是调用方指定的值，写进数组前一律过
 * {@link isSafeGitArg}（挡住前导 `-`，即 git 选项注入）；并在 revision 与 pathspec 之间
 * 加 `--` 分隔符，让任何仍以 `-` 开头的值被 git 当作**ref** 报 `invalid reference`，
 * 而不是当成选项执行。
 *
 * `--` 的兼容性已在 fixture 上实测（git 2.54.0）：`worktree add -b <b> -- <path> [<ref>]`
 * 与 `worktree add -- <path> <branch>` 两种形态对 `HEAD` / 合法分支名（含 `/`）/ 合法 tag
 * 起点**全部正常**；而 `<path>` 之后的值不再被解析成选项
 * （`--no-checkout` ⇒ `fatal: invalid reference`，且**不创建目录**）。
 */
async function gitWorktreeAdd(
  repoPath: string,
  branch: string,
  createBranch: boolean,
  targetPath: string,
  baseRef: string | undefined,
  signal: AbortSignal | undefined,
): Promise<string> {
  if (!isSafeGitArg(branch)) {
    throw new Error(`branch 非法（不得为空或以 - 开头，且不得含控制字符）：${JSON.stringify(branch)}`)
  }
  if (!isSafeGitArg(targetPath)) {
    throw new Error(`targetPath 非法（不得为空或以 - 开头，且不得含控制字符）：${JSON.stringify(targetPath)}`)
  }
  if (baseRef !== undefined && !isSafeGitArg(baseRef)) {
    throw new Error(`baseRef 非法（不得为空或以 - 开头，且不得含控制字符）：${JSON.stringify(baseRef)}`)
  }

  const args = createBranch
    ? ['worktree', 'add', '-b', branch, '--', targetPath, ...(baseRef === undefined ? [] : [baseRef])]
    : ['worktree', 'add', '--', targetPath, branch]
  await runGit(repoPath, args, signal)

  // git 会规范化路径（符号链接 / 大小写 / 相对化），以它的列表为准回填真实路径。
  try {
    const listing = await runGit(repoPath, ['worktree', 'list', '--porcelain'], signal)
    const wanted = normalizePath(targetPath)
    for (const line of listing.split('\n')) {
      if (!line.startsWith('worktree ')) continue
      const candidate = normalizePath(line.slice('worktree '.length))
      if (candidate === wanted) return candidate
    }
  } catch {
    // 列表读不到：退回归一化后的目标路径（worktree 已建成，不该因此报失败）。
  }
  return normalizePath(targetPath)
}

/* ------------------------------------------------------------------ *
 * reveal
 * ------------------------------------------------------------------ */

/** 当前平台标识（注入点便于测试）。 */
function currentPlatform(): string {
  return process.platform
}

/**
 * 在文件管理器中定位路径（macOS `open -R`；Windows `explorer /select,`；其余 `xdg-open`）。
 *
 * 全部走 `execFile` 数组参数，**不经 shell**。Linux 的 `xdg-open` 没有「选中」语义，
 * 按契约降级为打开**所在目录**（目标是文件时）。
 */
async function revealPath(path: string, platform: string): Promise<void> {
  if (platform === 'darwin') {
    await execFileAsync('open', ['-R', path])
    return
  }
  if (platform === 'win32') {
    await execFileAsync('explorer', [`/select,${path}`])
    return
  }
  let target = path
  try {
    const info = await stat(path)
    if (!info.isDirectory()) target = dirname(path)
  } catch {
    target = dirname(path)
  }
  await execFileAsync('xdg-open', [target])
}

/** `execFile` 的 Promise 化（数组参数，无 shell）。 */
function execFileAsync(file: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(file, [...args], { windowsHide: true }, (error) => {
      if (error !== null) reject(error)
      else resolve()
    })
  })
}

/* ------------------------------------------------------------------ *
 * 路由注册
 * ------------------------------------------------------------------ */

/** 单个路由的注册描述。 */
type RouteHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>

/** 递增即让既有合并器丢弃在途 / 排队的旧计算（测试用 {@link clearScanCache} 触发）。 */
let treeFlightEpoch = 0

/**
 * 「加入下一次」式合并器：空闲时立即开始；忙时所有新调用共享**一个**排队计算，
 * 它在当前计算结束后才开始 ⇒ 结果一定反映调用方到达之前的状态，且不会堆积。
 */
function createTreeFlight<T>(task: () => Promise<T>): () => Promise<T> {
  let running: Promise<T> | undefined
  let queued: Promise<T> | undefined
  let epoch = treeFlightEpoch
  const start = (): Promise<T> => {
    const current = task()
    running = current
    const settle = (): void => {
      if (running === current) running = undefined
    }
    current.then(settle, settle)
    return current
  }
  return () => {
    if (epoch !== treeFlightEpoch) {
      epoch = treeFlightEpoch
      running = undefined
      queued = undefined
    }
    if (running === undefined) return start()
    if (queued === undefined) {
      const next = running.then(
        () => undefined,
        () => undefined,
      ).then(() => {
        if (queued === next) queued = undefined
        return start()
      })
      queued = next
    }
    return queued
  }
}

/** 取请求的 `If-None-Match`（缺失返回 `undefined`）。 */
function ifNoneMatch(req: IncomingMessage): string | undefined {
  const value = (req as { headers?: Record<string, unknown> }).headers?.['if-none-match']
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * 注册全部 HTTP 路由。前缀统一 `/dsh-worktree-groups/`（契约 §1.5）。
 *
 * 每个路由用独立的 `ctx.effect` 包裹，插件卸载时路由一并撤销（宿主契约硬约束 15）。
 * 每个 handler 内部再包一层 try/catch —— 双保险，保证任何异常都变成 JSON。
 */
export function registerRoutes(ctx: Context): void {
  const webServer = getService<HostWebServer>(ctx, 'webServer')
  if (typeof webServer?.register !== 'function') {
    // webServer 缺席（非 web profile）：静默降级，不抛错（PRD R6）。
    return
  }

  // 2026-10-29 RAS2：监听宿主 `session/event` 记录每个会话的最后活动时间。
  // 刻意**不**用 `ctx.effect`：监听器的生命周期由 Cordis 上下文负责，返回的 disposer
  // 已足够；路由注册的 effect 数量因此仍是 5（§7 的注册契约测试逐字断言）。
  registerSessionActivityObserver(ctx)
  attachRemoteHostBridge(ctx)

  const register = (path: string, label: string, handler: RouteHandler): void => {
    ctx.effect(
      () =>
        webServer.register?.({
          kind: 'exact',
          path,
          handler: async (req, res) => {
            try {
              await handler(req, res)
            } catch (error) {
              // 最后一道防线：handler 抛错时宿主只回 400 空体，客户端拿不到原因。
              if (!res.headersSent) json(res, 400, { ok: false, message: failMessage(error) })
              else res.end()
            }
          },
        }) ?? (() => undefined),
      `dsh-worktree-groups: ${label} route`,
    )
  }

  // PERF1：`/tree` 计算合并器 —— 在途计算期间到达的请求共享**下一次**计算（保证看到
  // 自己到达之前的全部变更），同一时刻至多一个在途 + 一个排队。
  const treeFlight = createTreeFlight(async () => {
    const remoteState = readRemoteClientState(ctx)
    const payload = await buildTreePayload(ctx, { reuseSessions: true })
    const body = JSON.stringify(payload)
    const etag = `"${createHash('sha1').update(`${remoteState.targetKey}\u0000${body}`).digest('base64url')}"`
    return { body, etag }
  })

  register(ROUTE_PATHS.tree, 'tree', async (req, res) => {
    const body = await readBody(req)
    try {
      const archiveProjectKey = bodyString(body, 'archiveProjectKey')
      const unarchiveProjectKey = bodyString(body, 'unarchiveProjectKey')
      const unarchivePath = bodyString(body, 'unarchivePath')
      const hasMutation =
        archiveProjectKey !== undefined || unarchiveProjectKey !== undefined || unarchivePath !== undefined

      const remoteState = readRemoteClientState(ctx)
      if (remoteState.isRemote && hasMutation) {
        const tier1 = await tryCallRemotePluginRoute(ctx, 'tree', body)
        if (tier1.supported && tier1.payload['ok'] === true && Array.isArray(tier1.payload['projects'])) {
          const text = JSON.stringify(tier1.payload)
          const etag = `"${createHash('sha1').update(`${remoteState.targetKey}\u0000${text}`).digest('base64url')}"`
          res.writeHead(200, {
            'content-type': 'application/json; charset=utf-8',
            etag,
            'cache-control': 'no-cache',
          })
          res.end(text)
          return
        }
      }

      if (archiveProjectKey !== undefined) {
        await archiveWorkspaceProject(ctx, archiveProjectKey)
      }
      if (unarchiveProjectKey !== undefined || unarchivePath !== undefined) {
        await unarchiveWorkspaceProject(ctx, {
          ...(unarchiveProjectKey === undefined ? {} : { projectKey: unarchiveProjectKey }),
          ...(unarchivePath === undefined ? {} : { path: unarchivePath }),
        })
      }
      const { body: text, etag } = await treeFlight()
      // PERF4：内容未变 ⇒ 304（客户端不重解析、不重渲染）。
      if (ifNoneMatch(req) === etag) {
        res.writeHead(304, { etag, 'cache-control': 'no-cache' })
        res.end()
        return
      }
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        etag,
        'cache-control': 'no-cache',
      })
      res.end(text)
    } catch (error) {
      json(res, 400, { ok: false, message: failMessage(error) })
    }
  })

  register(ROUTE_PATHS.worktreeCreate, 'worktree-create', async (req, res) => {
    const body = await readBody(req)
    await handleWorktreeCreate(ctx, res, body)
  })

  register(ROUTE_PATHS.worktreeRemove, 'worktree-remove', async (req, res) => {
    const body = await readBody(req)
    await handleWorktreeRemove(ctx, res, body)
  })

  register(ROUTE_PATHS.reveal, 'reveal', async (req, res) => {
    const body = await readBody(req)
    await handleReveal(ctx, res, body)
  })

  register(ROUTE_PATHS.workspaceOpen, 'workspace-open', async (req, res) => {
    const body = await readBody(req)
    const path = bodyString(body, 'path')
    if (path === undefined) return json(res, 400, { ok: false, message: '缺少 path' })
    const remoteState = readRemoteClientState(ctx)
    if (remoteState.isRemote) {
      const tier1 = await tryCallRemotePluginRoute(ctx, 'workspace-open', body)
      if (tier1.supported) {
        return json(res, tier1.status, tier1.payload)
      }
      const tier2 = await openRemoteGatewayWorkspace(ctx, path)
      try {
        await unarchiveWorkspaceProject(ctx, { path })
      } catch {
        // 自动解除归档失败不阻塞打开工作区
      }
      return json(res, tier2.status, tier2.payload)
    }
    const registry = getService<HostWorkspaceRegistry>(ctx, 'workspaceRegistry')
    if (typeof registry?.create !== 'function') {
      return json(res, 400, { ok: false, message: '宿主未提供 workspaceRegistry，无法注册工作区' })
    }
    const created = await registry.create(normalizePath(path))
    const workspaceId = nonEmptyString(created?.id)
    if (workspaceId === undefined) {
      return json(res, 400, { ok: false, message: '工作区注册未返回 id' })
    }
    try {
      await unarchiveWorkspaceProject(ctx, { path })
    } catch {
      // 自动解除归档失败不阻塞打开工作区
    }
    json(res, 200, { ok: true, workspaceId })
  })
}

/** `POST /worktree-create` 的处理器（导出以便直接单测入参校验）。
 *
 * `options` 用于**测试隔离**：传入 `createFileLedger(tmpdir)` 可确保不会写真实 `~/.dsh`。 */
export async function handleWorktreeCreate(
  ctx: Context,
  res: ServerResponse,
  body: Record<string, unknown>,
  options: SnapshotOptions = {},
): Promise<void> {
  if (options.forceLocal !== true && readRemoteClientState(ctx).isRemote) {
    const tier1 = await tryCallRemotePluginRoute(ctx, 'worktree-create', body, options.signal)
    if (tier1.supported) {
      return json(res, tier1.status, tier1.payload)
    }
    return json(res, 400, {
      ok: false,
      message: '远端主机上的 dsh-worktree-groups 插件尚未升级支持远程创建 worktree',
    })
  }

  const repoPathRaw = bodyString(body, 'repoPath')
  const branch = bodyString(body, 'branch')
  const createBranch = body['createBranch'] !== false
  const baseRef = bodyString(body, 'baseRef')
  const targetPathRaw = bodyString(body, 'targetPath')

  if (repoPathRaw === undefined) return json(res, 400, { ok: false, message: '缺少 repoPath' })
  if (branch === undefined) return json(res, 400, { ok: false, message: '缺少 branch' })

  let snapshot: TreeSnapshot
  try {
    snapshot = await collectSnapshot(ctx, options)
  } catch (error) {
    return json(res, 400, { ok: false, message: failMessage(error) })
  }

  // 安全边界：repoPath 必须是「已注册工作区路径」或「已扫描出的 git 仓路径」的精确匹配。
  const verdict = assertKnown(repoPathRaw, snapshot.knownRepoPaths, 'repoPath')
  if (!verdict.ok) return json(res, 400, { ok: false, message: verdict.message })
  const repoPath = verdict.path

  if (!(await pathExists(repoPath))) {
    return json(res, 400, { ok: false, message: `repoPath 不存在：${repoPath}` })
  }

  // 用与白名单同一个来源解析主树（避免拼法不一致 ⇒ 默认目标路径算错）。
  // 命中 commonDir / worktree 时 `mainPathByKnownPath` 已给出主树；直接命中的就是主树本身。
  const mainPath = snapshot.mainPathByKnownPath.get(repoPath) ?? repoPath

  // D5：显式传入的 targetPath 必须落在主仓父目录下（否则一条 POST 就能让 git 在
  // 任意路径铺开文件树，并自动注册成工作区）。校验失败时**什么都不建**。
  // 不传 targetPath 时仍走既有默认推导，行为不变。
  //
  // D-N2：词法校验必须叠加**符号链接解析**，否则「主仓父目录下指向仓外的符号链接」
  // 会以合法拼法绕过 D-5。这里先把两边的父目录（以及目标自身是否为符号链接）解析成
  // 真身，任一失败都直接拒绝（`resolveRealTargetParents` 绝不静默放行）。
  let targetPath: string
  try {
    // 不传 targetPath 时按既有规则推导默认落点（行为不变），再走同一套安全校验。
    const candidate = targetPathRaw ?? defaultWorktreePath(mainPath, branch)
    const parents = await resolveRealTargetParents(candidate, mainPath)
    if (!parents.ok) return json(res, 400, { ok: false, message: parents.message })
    const targetVerdict = validateTargetPath(candidate, parents.mainPathReal, parents.parentReal)
    if (!targetVerdict.ok) return json(res, 400, { ok: false, message: targetVerdict.message })
    targetPath = targetVerdict.path
  } catch (error) {
    return json(res, 400, { ok: false, message: failMessage(error) })
  }

  let worktreePath: string
  try {
    worktreePath = await gitWorktreeAdd(repoPath, branch, createBranch, targetPath, baseRef, undefined)
  } catch (error) {
    // 契约：**失败时不回滚已建的 worktree**（可能是 `git worktree add` 成功但列表读取失败，
    // 也可能是 add 之前就失败）。如实报告错误，让用户自行处置。
    return json(res, 400, { ok: false, message: failMessage(error) })
  }

  // 成功后注册 dsh 工作区；注册失败**不视为创建失败**（目录已在，cwd 归属仍可用）。
  //
  // **D10**：注册失败必须**对用户可见**。旧实现是裸 `catch {}`，于是「worktree 建好了
  // 但没注册工作区」⇒ 响应缺 `workspaceId` ⇒ 客户端不 `startSession` ⇒ 用户看到的是
  // 「创建成功」却**没有自动新会话，且界面上零提示**，直接违反 D7/US6 的预期。
  // 现在把失败原因带回响应（`ok` 仍为 `true`：worktree 确实建成了）。
  const registry = getService<HostWorkspaceRegistry>(ctx, 'workspaceRegistry')
  let workspaceId: string | undefined
  let workspaceWarning: string | undefined
  if (typeof registry?.create !== 'function') {
    workspaceWarning = '宿主未提供 workspaceRegistry，worktree 已创建但未注册为工作区'
  } else {
    try {
      const created = await registry.create(worktreePath)
      workspaceId = nonEmptyString(created?.id)
      if (workspaceId === undefined) {
        workspaceWarning = '工作区注册未返回 id，worktree 已创建但未注册为工作区'
      }
    } catch (error) {
      workspaceWarning = failMessage(error)
    }
  }

  // 目录已变，让下一次 /tree 立刻看到新 worktree。
  clearScanCache()

  const payload: { ok: true; worktreePath: string; workspaceId?: string; workspaceWarning?: string } = {
    ok: true,
    worktreePath,
  }
  if (workspaceId !== undefined) payload.workspaceId = workspaceId
  if (workspaceWarning !== undefined) payload.workspaceWarning = workspaceWarning
  json(res, 200, payload)
}

/** `POST /worktree-remove` 的处理器（导出以便直接单测入参校验）。
 *
 * `options` 用于**测试隔离**：传入 `createFileLedger(tmpdir)` 可确保不会写真实 `~/.dsh`。 */
export async function handleWorktreeRemove(
  ctx: Context,
  res: ServerResponse,
  body: Record<string, unknown>,
  options: SnapshotOptions = {},
): Promise<void> {
  if (options.forceLocal !== true && readRemoteClientState(ctx).isRemote) {
    const tier1 = await tryCallRemotePluginRoute(ctx, 'worktree-remove', body, options.signal)
    if (tier1.supported) {
      return json(res, tier1.status, tier1.payload)
    }
    return json(res, 400, {
      ok: false,
      message: '远端主机上的 dsh-worktree-groups 插件尚未升级支持远程移除 worktree',
    })
  }

  const force = body['force'] === true

  let snapshot: TreeSnapshot
  try {
    snapshot = await collectSnapshot(ctx, options)
  } catch (error) {
    return json(res, 400, { ok: false, message: failMessage(error) })
  }

  // 安全边界：path 必须命中「已知 worktree 集合」= git 扫描结果 ∪ 台账 ∪ 工作区路径。
  const verdict = assertKnown(body['path'], snapshot.knownWorktreePaths, 'path')
  if (!verdict.ok) return json(res, 400, { ok: false, message: verdict.message })
  const path = verdict.path

  // **D6**：再加一层「必须**已注册**为 dsh 工作区」的判据。
  //
  // 白名单 `knownWorktreePaths` 刻意包含 git 扫描到的**全部** worktree（这是 US3 必需
  // 的：未注册 worktree 上的会话也要能正确归属）。但移除是**不可撤销**的目录删除，
  // 而 UI（D14）只为已注册行渲染「移除 worktree」入口 —— 后端此前没有同源收紧，
  // 形成「前端校验当后端校验用」：一条 POST 就能删掉用户手工 `git worktree add`
  // 出来、从未在 DSH 里露过面的目录。
  //
  // 裁定：**拒绝**。D8 的语义是「移除我用过的 worktree」；未注册 ⇒ 用户没在 DSH 里
  // 用过它，误删风险高于收益。（外部 `rm -rf` 后的残留由 D18 `sweepDeadWorkspaces`
  // 自动注销，不依赖本路由。）
  if (snapshot.workspaceByPath[path] === undefined) {
    return json(res, 400, {
      ok: false,
      message: `该 worktree 尚未注册为工作区，拒绝移除：${path}（请在侧栏点 + 新建会话后再操作）`,
    })
  }

  // 找一个能跑 git 的仓库入口。
  // 直接查 `mainPathByKnownPath`，不用 `repos[].worktrees[]` 反查 ——
  // 后者用的是 git 输出的拼法，与白名单命中的拼法可能不同（见该字段的注释）。
  let resolvedRepoPath = snapshot.mainPathByKnownPath.get(path)
  if (resolvedRepoPath === undefined) {
    // 工作区路径不是任何 worktree：退台账记过的项目主树。
    for (const project of Object.values(snapshot.ledger.projects)) {
      const mainPath = nonEmptyString(project?.mainPath)
      if (mainPath === undefined) continue
      if (project.worktrees?.[path] === undefined) continue
      resolvedRepoPath = normalizePath(mainPath)
      break
    }
  }
  if (resolvedRepoPath === undefined || !(await pathExists(resolvedRepoPath))) {
    return json(res, 400, {
      ok: false,
      message: `找不到可用的仓库入口来移除该 worktree：${path}`,
    })
  }
  const repoPath: string = resolvedRepoPath

  const runRemove = async (useForce: boolean): Promise<void> => {
    const args = ['worktree', 'remove', ...(useForce ? ['--force'] : []), path]
    await runGit(repoPath, args, undefined)
  }

  try {
    await runRemove(force)
  } catch (error) {
    const message = failMessage(error)
    if (!force) {
      // 契约：脏 worktree（或任何失败）且未强制 ⇒ 明确告知需要 force 重试。
      return json(res, 400, { ok: false, needsForce: true, message })
    }
    return json(res, 400, { ok: false, message })
  }

  // 注销对应的 dsh 工作区。**分支不删**（契约 §1.5）。
  const workspaceId = snapshot.workspaceByPath[path]
  const registry = getService<HostWorkspaceRegistry>(ctx, 'workspaceRegistry')
  if (workspaceId !== undefined && typeof registry?.delete === 'function') {
    try {
      await registry.delete(workspaceId)
    } catch {
      // 目录已删、注册注销失败：不阻塞「移除成功」的结论，客户端下次刷新会看到死工作区。
    }
  }

  clearScanCache()
  json(res, 200, { ok: true })
}

/** `POST /reveal` 的处理器（导出以便直接单测入参校验与白名单）。
 *
 * **D11**：`path` 必须命中「已知集合」= `knownWorktreePaths ∪ knownRepoPaths`，
 * 与 `worktree-remove` 同级。该并集已覆盖全部四类已知路径：
 *   - 全部 git 扫描出的 worktree（含**未注册**的）；
 *   - 仓入口 / `mainPath` / `commonDir`；
 *   - 台账记过的 worktree 路径；
 *   - 全部**已注册 dsh 工作区**路径（`collectSnapshot` 会把它们补进 `knownWorktreePaths`）。
 *
 * 为什么收紧：本端点会执行 `open -R` / `explorer /select,` / `xdg-open`，与
 * `worktree-remove` / `worktree-create` 承担同级的「把本机路径交给外部进程」的风险。
 * 旧实现只校验「路径存在」，等价于一个「任意路径存在性探针 + 文件管理器打开器」，
 * 与另两个端点的安全姿态不一致。
 *
 * 客户端只有一个调用点（`sidebar.tsx` 的 `MENU.reveal`，worktree 行），路径直接来自
 * 同一棵树的节点数据，必定落在白名单内，因此本收紧不破坏正常功能。
 *
 * `options` 用于**测试隔离**：传入 `createFileLedger(tmpdir)` 可确保不会写真实 `~/.dsh`。
 */
export async function handleReveal(
  ctx: Context,
  res: ServerResponse,
  body: Record<string, unknown>,
  options: SnapshotOptions = {},
): Promise<void> {
  if (options.forceLocal !== true && readRemoteClientState(ctx).isRemote) {
    const tier1 = await tryCallRemotePluginRoute(ctx, 'reveal', body, options.signal)
    if (tier1.supported) {
      return json(res, tier1.status, tier1.payload)
    }
    return json(res, 400, {
      ok: false,
      message: '远端主机上的 dsh-worktree-groups 插件尚未升级支持远程打开目录',
    })
  }

  let snapshot: TreeSnapshot
  try {
    snapshot = await collectSnapshot(ctx, options)
  } catch (error) {
    return json(res, 400, { ok: false, message: failMessage(error) })
  }

  // 安全边界：与 `worktree-remove` 同级的白名单**精确匹配**（绝不前缀匹配）。
  //
  // 已知集合 = `knownWorktreePaths ∪ knownRepoPaths`，它已经覆盖：
  //   - 全部 git 扫描出的 worktree（含**未注册**的）；
  //   - 仓入口 / `mainPath` / `commonDir`；
  //   - 台账记过的 worktree 路径；
  //   - 全部**已注册 dsh 工作区**路径（`collectSnapshot` 的工作区循环会把它们
  //     补进 `knownWorktreePaths`，故 `workspaceByPath` 的键必然在此并集内）。
  const allowed = new Set<string>([...snapshot.knownWorktreePaths, ...snapshot.knownRepoPaths])
  const verdict = assertKnown(body['path'], allowed, 'path')
  if (!verdict.ok) return json(res, 400, { ok: false, message: verdict.message })
  const resolved = verdict.path

  if (!(await pathExists(resolved))) {
    return json(res, 400, { ok: false, message: `路径不存在：${resolved}` })
  }
  await revealPath(resolved, currentPlatform())
  json(res, 200, { ok: true })
}
