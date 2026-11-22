/**
 * 客户端实时会话叠加层（2026-11-14 PERF6，纯逻辑，零宿主依赖）。
 *
 * ## 为什么需要
 *
 * 侧栏树来自 `POST /dsh-worktree-groups/tree`，服务端要列举全部会话、扫 git、组装整棵树；
 * 即使有缓存也至少是一次网络往返 + 防抖。而宿主客户端早已持有**实时**会话列表
 * （`useSessions(identity)` 快照，`byId[id] = { id, cwd, updatedAt, running, blank, title,
 * parentId, origin }`，由宿主 `ClientSessions.projectList()` 产出）。
 *
 * 本模块把这份实时快照叠加到最近一次服务端树上：
 *
 * 1. **已有会话**：标题 / 运行态 / blank 以实时快照为准；`updatedAt`（与 `lastActivityAt`）只增不减。
 * 2. **新顶层会话**（树里没有、非子代理、未归档、有 `cwd`）：按 `cwd` 最长前缀匹配到某个
 *    **存在的** worktree 节点或非 git 工作区，**立即**插入；匹配不到的不插（等服务端裁决，
 *    避免与服务端的 history / 台账归属规则冲突）。
 * 3. 返回 `pendingIds`：实时快照里有、服务端树里还没有的顶层会话 id —— 调用方据此触发
 *    一次（防抖的）服务端重取；服务端返回后它们自然消失，不会形成重取循环。
 *
 * 无任何变化时返回**同一个** `tree` 引用，便于 `useMemo` 下游零成本短路。
 */

import type { ProjectNodeLike, SessionRowLike } from './tree-model.js'

type LiveMergeSessionRow = SessionRowLike

/** 叠加层输入树（`/tree` 载荷子集）。 */
export interface LiveMergeTree {
  projects: ProjectNodeLike[]
  ungrouped: SessionRowLike[]
  archivedSessionIds: string[]
  /** 归一化工作区路径 → workspaceId（用于非 git 工作区的路径匹配）。 */
  workspaceByPath?: Record<string, string>
}

/** 宿主 `useSessions` 快照条目（只读用到的字段）。 */
interface LiveEntry {
  id?: unknown
  cwd?: unknown
  updatedAt?: unknown
  running?: unknown
  blank?: unknown
  title?: unknown
  parentId?: unknown
  origin?: unknown
}

/** 叠加结果。 */
export interface LiveMergeResult<T extends LiveMergeTree> {
  tree: T
  /** 实时快照里有、服务端树里还没有的顶层可见会话 id（已排序）。 */
  pendingIds: string[]
}

const SESSION_ID_PREFIX = 'session-'

/** 去掉宿主 `session-` 前缀（树与快照里两种拼法都可能出现）。 */
function bareId(id: string): string {
  return id.startsWith(SESSION_ID_PREFIX) && id.length > SESSION_ID_PREFIX.length ? id.slice(SESSION_ID_PREFIX.length) : id
}

/** 路径归一：反斜杠转正斜杠、去尾斜杠（根保留）。 */
function normalize(path: string): string {
  let out = path.replace(/\\/g, '/')
  while (out.length > 1 && out.endsWith('/')) out = out.slice(0, -1)
  return out
}

function isUnder(cwd: string, base: string): boolean {
  if (cwd === base) return true
  return cwd.startsWith(base.endsWith('/') ? base : `${base}/`)
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** 把一条实时条目覆盖到既有行上；无变化返回原行。 */
function patchRow(row: LiveMergeSessionRow, entry: LiveEntry): LiveMergeSessionRow {
  const title = nonEmpty(entry.title)
  const running = typeof entry.running === 'boolean' ? entry.running : row.running
  const blank = typeof entry.blank === 'boolean' ? entry.blank : row.blank
  const liveUpdated = finite(entry.updatedAt)
  const updatedAt = liveUpdated !== undefined && liveUpdated > row.updatedAt ? liveUpdated : row.updatedAt
  const priorActivity = row.lastActivityAt ?? row.updatedAt
  const lastActivityAt = updatedAt > priorActivity ? updatedAt : priorActivity
  if (
    (title === undefined || title === row.title) &&
    running === row.running &&
    blank === row.blank &&
    updatedAt === row.updatedAt &&
    lastActivityAt === (row.lastActivityAt ?? row.updatedAt)
  ) {
    return row
  }
  return {
    ...row,
    ...(title === undefined ? {} : { title }),
    running,
    blank,
    updatedAt,
    lastActivityAt,
  }
}

/** 逐行覆盖一个列表；无变化返回原数组。 */
function patchList(list: LiveMergeSessionRow[], live: Map<string, LiveEntry>): LiveMergeSessionRow[] {
  let out: LiveMergeSessionRow[] | undefined
  for (let index = 0; index < list.length; index += 1) {
    const row = list[index]!
    const entry = live.get(bareId(row.sessionId))
    if (entry === undefined) continue
    const next = patchRow(row, entry)
    if (next === row) continue
    out ??= list.slice()
    out[index] = next
  }
  return out ?? list
}

/** 快照 → `裸 id → 条目`。兼容 `byId` 对象与 `Map`。 */
function liveEntriesOf(snapshot: unknown): Map<string, LiveEntry> {
  const out = new Map<string, LiveEntry>()
  if (typeof snapshot !== 'object' || snapshot === null) return out
  const byId = (snapshot as { byId?: unknown }).byId
  const add = (key: string, value: unknown): void => {
    if (typeof value !== 'object' || value === null) return
    const entry = value as LiveEntry
    const id = nonEmpty(entry.id) ?? key
    if (id === '') return
    out.set(bareId(id), { ...entry, id })
  }
  if (byId instanceof Map) {
    for (const [key, value] of byId) add(String(key), value)
  } else if (typeof byId === 'object' && byId !== null) {
    for (const [key, value] of Object.entries(byId as Record<string, unknown>)) add(key, value)
  }
  return out
}

/**
 * 把实时会话快照叠加到服务端树上（纯函数，不修改入参）。
 *
 * @param tree 最近一次服务端树；
 * @param snapshot `useSessions(identity)` 快照（缺席 / 形状不符 ⇒ 原样返回）。
 */
export function mergeLiveSessions<T extends LiveMergeTree>(tree: T, snapshot: unknown): LiveMergeResult<T> {
  const live = liveEntriesOf(snapshot)
  if (live.size === 0) return { tree, pendingIds: [] }

  // 1) 树里已有的 id（裸 id）。
  const known = new Set<string>()
  const remember = (list: readonly LiveMergeSessionRow[]): void => {
    for (const row of list) known.add(bareId(row.sessionId))
  }
  for (const project of tree.projects) {
    for (const node of project.worktrees) remember(node.sessions)
    remember(project.history)
    remember(project.flatSessions)
  }
  remember(tree.ungrouped)
  const archived = new Set(tree.archivedSessionIds.map(bareId))

  // 2) 新的顶层可见会话。
  const pendingIds: string[] = []
  const additions: Array<{ entry: LiveEntry; cwd: string; id: string }> = []
  for (const [key, entry] of live) {
    if (known.has(key) || archived.has(key)) continue
    if (entry.origin === 'subagent' || nonEmpty(entry.parentId) !== undefined) continue
    const cwd = nonEmpty(entry.cwd)
    if (cwd === undefined) continue
    const id = nonEmpty(entry.id) ?? key
    pendingIds.push(id)
    additions.push({ entry, cwd: normalize(cwd), id })
  }
  pendingIds.sort()

  // 3) 覆盖既有行。
  let changed = false
  const projects = tree.projects.map((project) => {
    const worktrees = project.worktrees.map((node) => {
      const sessions = patchList(node.sessions, live)
      return sessions === node.sessions ? node : { ...node, sessions }
    })
    const history = patchList(project.history, live)
    const flatSessions = patchList(project.flatSessions, live)
    const worktreesChanged = worktrees.some((node, index) => node !== project.worktrees[index])
    if (!worktreesChanged && history === project.history && flatSessions === project.flatSessions) return project
    changed = true
    return { ...project, worktrees, history, flatSessions }
  })
  const ungrouped = patchList(tree.ungrouped, live)
  if (ungrouped !== tree.ungrouped) changed = true

  // 4) 新会话按 cwd 最长前缀落位。
  if (additions.length > 0) {
    type Target = { path: string; projectIndex: number; worktreeIndex: number }
    const targets: Target[] = []
    const projectIndexByKey = new Map<string, number>()
    projects.forEach((project, projectIndex) => {
      projectIndexByKey.set(project.key, projectIndex)
      if (!project.isGit) return
      project.worktrees.forEach((node, worktreeIndex) => {
        if (node.exists === false) return
        targets.push({ path: normalize(node.path), projectIndex, worktreeIndex })
      })
    })
    for (const [path, workspaceId] of Object.entries(tree.workspaceByPath ?? {})) {
      const projectIndex = projectIndexByKey.get(`ws:${workspaceId}`)
      if (projectIndex === undefined || projects[projectIndex]!.isGit) continue
      targets.push({ path: normalize(path), projectIndex, worktreeIndex: -1 })
    }

    for (const { entry, cwd, id } of additions) {
      let best: Target | undefined
      for (const target of targets) {
        if (!isUnder(cwd, target.path)) continue
        if (best === undefined || target.path.length > best.path.length) best = target
      }
      if (best === undefined) continue
      const updatedAt = finite(entry.updatedAt) ?? 0
      const title = nonEmpty(entry.title)
      const added: LiveMergeSessionRow = {
        sessionId: id,
        updatedAt,
        lastActivityAt: updatedAt,
        running: entry.running === true,
        blank: entry.blank === true,
        cwd,
        ...(title === undefined ? {} : { title }),
      }
      const project = projects[best.projectIndex]!
      if (best.worktreeIndex < 0) {
        projects[best.projectIndex] = { ...project, flatSessions: [added, ...project.flatSessions] }
      } else {
        const worktrees = project.worktrees.slice()
        const node = worktrees[best.worktreeIndex]!
        worktrees[best.worktreeIndex] = { ...node, sessions: [added, ...node.sessions] }
        projects[best.projectIndex] = { ...project, worktrees }
      }
      changed = true
    }
  }

  if (!changed) return { tree, pendingIds }
  return { tree: { ...tree, projects, ungrouped }, pendingIds }
}
