import { basename, dirname, resolve } from 'node:path'

import { normalizePath } from './git.js'

import type { LedgerData } from './ledger.js'
import type {
  ProjectNode,
  RepoInfo,
  SessionRow,
  WorkspaceRow,
  WorktreeEntry,
  WorktreeNode,
} from './types.js'

/**
 * 归一化路径（复用 `git.ts` 的实现，此处再导出便于纯逻辑测试）。
 *
 * 契约要求 `projects.ts` 自带该导出，测试才能在不引入子进程依赖的前提下
 * 校验路径比较语义。实现只有一份，见 `git.ts#normalizePath`。
 */
export { normalizePath } from './git.js'

/**
 * 路径启发：`deadPath` 看起来像 `mainPath` 的 worktree 吗？
 *
 * 规则（三条同时成立）：
 *  1. **父目录相同** —— `/a/b/LogAnalyst-x` 与 `/a/b/LogAnalyst` 的父目录都是 `/a/b`；
 *  2. `basename(deadPath)` 以 `basename(mainPath)` **开头且严格更长** ——
 *     这就是「主仓名 + 后缀」的默认命名约定（`dsh-worktree-groups` 新建 worktree 时
 *     也用 `<主仓名>-<分支名 sanitize>`）；
 *  3. `deadPath` 不等于 `mainPath`（自身不算自己的 worktree）。
 *
 * 例：`/a/b/LogAnalyst-toolbar-refactor` 与 `/a/b/LogAnalyst` ⇒ true；
 *     `/a/b/Other` 与 `/a/b/LogAnalyst` ⇒ false；
 *     `/a/b/LogAnalyst` 与 `/a/b/LogAnalyst` ⇒ false；
 *     `/a/c/LogAnalyst-x` 与 `/a/b/LogAnalyst` ⇒ false（父目录不同）。
 *
 * 注意：这是**启发式**，只用于把「目录已删除」的孤儿会话接回某个项目的 history 桶；
 * 误判不会搬移任何会话文件（PRD R4）。
 */
export function looksLikeWorktreeOf(deadPath: string, mainPath: string): boolean {
  const dead = normalizePath(deadPath)
  const main = normalizePath(mainPath)
  if (dead === main) return false
  if (dead === '' || main === '') return false
  if (dirname(dead) !== dirname(main)) return false
  const deadBase = basename(dead)
  const mainBase = basename(main)
  // mainBase 为空只会出现在文件系统根（basename('/') === ''），不应匹配任何东西。
  if (mainBase === '') return false
  return deadBase.length > mainBase.length && deadBase.startsWith(mainBase)
}

/** {@link buildProjects} 的输入。全部为宿主持久状态的投影，函数本身不做 IO。 */
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
  /**
   * **已确认磁盘上存在**的工作区路径集合（归一化）。用于规则 2b 的死非 git 工作区判定。
   *
   * 缺省（`undefined`）时按「全部工作区路径都活着」处理 —— 保持向后兼容，
   * 也让纯逻辑单测不必构造这个集合。宿主侧（`routes.ts`）从 git 扫描的
   * `worktrees[*].exists` 与工作区路径的存在性共同构造它。
   */
  liveWorkspacePaths?: ReadonlySet<string>
}

/** 会话的归属判定结果（内部中间结构，不对外暴露）。 */
type Assignment =
  | { kind: 'worktree'; repoKey: string; path: string }
  | { kind: 'history'; projectKey: string }
  | { kind: 'flat'; projectKey: string }
  | { kind: 'ungrouped' }

/** 会话排序：`updatedAt` 降序；相同则 `sessionId` 升序，保证输出确定、可断言。 */
function compareSessions(a: SessionRow, b: SessionRow): number {
  if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt
  return a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0
}

/**
 * worktree 排序：主树在前，其余按 `branch` 字典序；`branch` 缺失（detached）
 * 时用路径回退。路径再作最后一级 tiebreak，确保结果与遍历顺序无关。
 */
function compareWorktrees(a: WorktreeEntry, b: WorktreeEntry): number {
  if (a.isMain !== b.isMain) return a.isMain ? -1 : 1
  const aKey = a.branch ?? a.path
  const bKey = b.branch ?? b.path
  const byBranch = aKey.localeCompare(bKey)
  if (byBranch !== 0) return byBranch
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0
}

/** 索引：由仓事实反向建出的各类路径查找表。 */
interface PathIndex {
  /** worktree 绝对路径 → 所属 commonDir 与条目。 */
  worktreeByPath: Map<string, { repoKey: string; entry: WorktreeEntry }>
  /** **存在**的 worktree 路径集合（`exists === true`）。 */
  existingWorktreePaths: Set<string>
  /** 归一化工作区路径 → 工作区行（同路径多个时取先出现的）。 */
  workspaceByPath: Map<string, WorkspaceRow>
  /** 归一化工作区路径 → commonDir。 */
  repoByWorkspacePath: Map<string, string>
  /**
   * commonDir → 归属该仓的全部工作区行（**按 `input.workspaces` 顺序**）。
   *
   * 存在的意义：一个仓可能有多个 dsh 工作区（`MyProject` + `MyProject-ohos`），
   * 也可能有一个**落在仓的子目录**的工作区（如 `.../mobile_monorepo/android/SubApp`）。
   * 后者的路径不是任何 worktree 根，若只按「worktree 路径 → workspaceId」查表，
   * 它的 `workspaceId` 与用户起的 `title` 会在整棵树里彻底消失（D-3）。
   */
  workspacesByRepo: Map<string, WorkspaceRow[]>
}

/** 建立路径索引；所有键都过 {@link normalizePath}，避免尾斜杠/分隔符造成漏匹配。 */
function buildPathIndex(input: BuildProjectsInput): PathIndex {
  const worktreeByPath = new Map<string, { repoKey: string; entry: WorktreeEntry }>()
  const existingWorktreePaths = new Set<string>()
  for (const [repoKey, repo] of Object.entries(input.repos)) {
    for (const entry of repo.worktrees) {
      const path = normalizePath(entry.path)
      if (!worktreeByPath.has(path)) worktreeByPath.set(path, { repoKey, entry })
      if (entry.exists) existingWorktreePaths.add(path)
    }
  }

  const workspaceByPath = new Map<string, WorkspaceRow>()
  for (const workspace of input.workspaces) {
    const path = normalizePath(workspace.path)
    if (!workspaceByPath.has(path)) workspaceByPath.set(path, workspace)
  }

  const repoByWorkspacePath = new Map<string, string>()
  for (const [rawPath, repoKey] of Object.entries(input.repoByWorkspacePath)) {
    repoByWorkspacePath.set(normalizePath(rawPath), repoKey)
  }

  const workspacesByRepo = new Map<string, WorkspaceRow[]>()
  for (const workspace of input.workspaces) {
    const repoKey = repoByWorkspacePath.get(normalizePath(workspace.path))
    if (repoKey === undefined) continue
    const list = workspacesByRepo.get(repoKey)
    if (list === undefined) workspacesByRepo.set(repoKey, [workspace])
    else list.push(workspace)
  }

  return { worktreeByPath, existingWorktreePaths, workspaceByPath, repoByWorkspacePath, workspacesByRepo }
}

/**
 * 判定单个会话的归属（契约 §1.3 的五条规则，外加非 git 工作区平铺）。
 *
 * 规则优先级：1 存在的 worktree → 2 已注册工作区 → 2b 非 git 工作区平铺
 * → 3 台账记录的已消失 worktree → 4 mainPath 路径启发 → 5 未分组。
 *
 * 纯函数：**不 stat 磁盘**。「目录是否存在」只能由 `repos[*].worktrees[*].exists`
 * （scanRepo 已用 fs.stat 逐条探测过）与调用方传入的 `liveWorkspacePaths` 两个已知事实推断。
 *
 * ## 关键不变量（PRD D18 / G4）
 *
 * **「已注册工作区」不等于「路径还活着」。** 外部 `rm -rf` 掉一个 worktree 之后，
 * 工作区记录可能还在注册表里（D18 清扫要等下一次 `/tree` 才发生，也可能失败）。
 * 因此规则 2 **必须**同时校验目标 worktree 的 `exists`，否则那些会话会被永久扣在
 * 一个已死的节点上（既显示不出来、也进不了 history 桶）。
 */
function assignSession(session: SessionRow, index: PathIndex, input: BuildProjectsInput): Assignment {
  const { worktreeByPath, existingWorktreePaths, workspaceByPath, repoByWorkspacePath } = index

  if (session.cwd === undefined || session.cwd === '') return { kind: 'ungrouped' }
  const cwd = normalizePath(session.cwd)

  // 规则 1：cwd 命中「存在的 worktree 路径」。
  const hit = worktreeByPath.get(cwd)
  if (hit !== undefined && hit.entry.exists) {
    return { kind: 'worktree', repoKey: hit.repoKey, path: cwd }
  }

  // 规则 2：cwd 命中「已注册工作区路径」。
  const workspace = workspaceByPath.get(cwd)
  if (workspace !== undefined) {
    const repoKey = repoByWorkspacePath.get(cwd)
    const repo = repoKey === undefined ? undefined : input.repos[repoKey]
    if (repoKey !== undefined && repo !== undefined && repo.worktrees.length > 0) {
      const exact = repo.worktrees.find((entry) => normalizePath(entry.path) === cwd)
      // 精确命中且该 worktree 活着 ⇒ 归它。
      if (exact !== undefined && exact.exists) {
        return { kind: 'worktree', repoKey, path: normalizePath(exact.path) }
      }
      // 精确命中但目录已死 ⇒ **不走规则 2**，让它掉到规则 3/4 进 history 桶。
      // （这正是「外部 rm -rf 后会话被永久扣在死节点」的根因修复。）
      // 未精确命中（子目录工作区 / 扫描降级）⇒ 回退该仓主树，保证会话留在这个项目下
      // （PRD G4：不搬移），但同样要求主树活着。
      if (exact === undefined) {
        const fallback = repo.worktrees.find((entry) => entry.isMain) ?? repo.worktrees[0]
        if (fallback !== undefined && fallback.exists) {
          return { kind: 'worktree', repoKey, path: normalizePath(fallback.path) }
        }
      }
    } else if (repoKey === undefined) {
      // 规则 2b：非 git 工作区 —— 会话平铺在项目节点下（D11 保持平铺）。
      // 但若目录本身已死，平铺会把会话挂在一个死项目上；非 git 仓没有 history 归位语义，
      // 所以退回「未分组」，由调用方在侧栏底部如实展示。
      const live = input.liveWorkspacePaths
      if (live === undefined || live.has(cwd)) {
        return { kind: 'flat', projectKey: `ws:${workspace.workspaceId}` }
      }
    }
  }

  // 「路径还活着」只看路径本身是否真的存在。
  //
  // ⚠️ 这里**绝不能**再 `|| workspace !== undefined`：工作区「已注册」不等于「路径还活着」，
  // 那样会让规则 3/4 对这批会话整体短路 —— 正是死 worktree 会话被扣住的帮凶。
  const isKnownLivePath = existingWorktreePaths.has(cwd)

  // 规则 3：cwd 命中台账记录的 worktreePath，且该路径已不存在 ⇒ 该项目 history 桶。
  const owner = input.ledger.sessions[session.sessionId]
  if (owner !== undefined && !isKnownLivePath && input.repos[owner.projectKey] !== undefined) {
    return { kind: 'history', projectKey: owner.projectKey }
  }

  // 规则 4：cwd 是不存在的目录，且能被某项目 mainPath 用 looksLikeWorktreeOf 匹配。
  if (!isKnownLivePath) {
    const repoKeys = Object.keys(input.repos).sort()
    for (const repoKey of repoKeys) {
      const repo = input.repos[repoKey]
      if (repo === undefined) continue
      if (looksLikeWorktreeOf(cwd, repo.mainPath)) {
        return { kind: 'history', projectKey: repoKey }
      }
    }
  }

  // 规则 5：其余 ⇒ 未分组（不在任何 ProjectNode 里，由调用方另行渲染）。
  return { kind: 'ungrouped' }
}

/** 项目节点的可变累加器（组装完成后再摊平成冻结的 `ProjectNode`）。 */
interface ProjectAccumulator {
  key: string
  isGit: boolean
  title: string
  mainPath?: string
  worktrees: WorktreeNode[]
  worktreeByPath: Map<string, WorktreeNode>
  history: SessionRow[]
  flatSessions: SessionRow[]
}

/**
 * 项目键的出现顺序：**保持 `workspaces` 传入顺序**（调用方传的是
 * `workspaceRegistry.list()` 的顺序，`tree-model` 依赖它），再补上扫描到、
 * 但没有对应工作区的仓（这些仓的未注册 worktree 仍需可见，见 PRD US1）。
 */
function orderProjectKeys(input: BuildProjectsInput, index: PathIndex): string[] {
  const seen = new Set<string>()
  const order: string[] = []
  const push = (key: string): void => {
    if (seen.has(key)) return
    seen.add(key)
    order.push(key)
  }

  for (const workspace of input.workspaces) {
    const path = normalizePath(workspace.path)
    const repoKey = index.repoByWorkspacePath.get(path)
    if (repoKey !== undefined && input.repos[repoKey] !== undefined) push(repoKey)
    else if (repoKey === undefined) push(`ws:${workspace.workspaceId}`)
  }
  for (const repoKey of Object.keys(input.repos).sort()) push(repoKey)

  return order
}

/**
 * 把工作区 + 仓事实 + 台账 + 会话合成侧栏树。**纯函数**：不做 IO、不读时间以外的全局状态。
 *
 * 归属规则（按优先级，契约 §1.3）：
 *  1. 会话 cwd 命中某个「存在的 worktree 路径」⇒ 归该 worktree；
 *  2. 会话 cwd 命中某个「已注册工作区路径」⇒ 归该工作区对应的 worktree
 *     （该路径不在扫描结果里时退回该仓主树）；
 *  2b. 非 git 工作区 ⇒ 会话进该项目的 `flatSessions`（D11 保持平铺）；
 *  3. 会话 cwd 命中台账 `sessions[sessionId]` 记录的 worktreePath，且该路径已不存在
 *     ⇒ 归该项目 history 桶；
 *  4. 会话 cwd 是不存在的目录，且能被某项目 mainPath 用 `looksLikeWorktreeOf` 匹配
 *     ⇒ 归该项目 history 桶；
 *  5. 其余 ⇒ 进「未分组」（不在 ProjectNode 里，由调用方另行处理）。
 *
 * 其它约束：
 * - 归档会话（`archivedSessionIds`）一律排除；
 * - 单个 worktree 的 git 项目**照常**产出满员的 `worktrees` 数组，是否渲染成子行
 *   由客户端按 `worktrees.length > 1` 决定（PRD D11），宿主不做裁剪；
 * - 未注册的 worktree（git 列表里有、但没有对应 dsh 工作区）`workspaceId: undefined`，
 *   其 `sessions` 为该路径下 cwd 的会话；
 * - 同一会话只会落进一个桶（单趟遍历 + 单一 Assignment），history 桶天然不会与
 *   worktree 重复，满足「历史桶去重」要求；
 * - `exists === false` 的 worktree 节点仍会产出（供 UI 显示为已关闭 / 供 history 归位），
 *   但它的会话按规则 3/4 走 history 桶，不会挂在它下面。
 *
 * 排序：worktree 主树在前、其余按分支名 `localeCompare`；会话按 `updatedAt` 降序，
 * 相同则 `sessionId` 升序（确定性 tiebreak）。
 */
export function buildProjects(input: BuildProjectsInput): { projects: ProjectNode[]; ungrouped: SessionRow[] } {
  const index = buildPathIndex(input)
  const archived = new Set(input.archivedSessionIds)

  const accumulators = new Map<string, ProjectAccumulator>()
  const ensureRepoAccumulator = (repoKey: string): ProjectAccumulator | undefined => {
    const cached = accumulators.get(repoKey)
    if (cached !== undefined) return cached
    const repo = input.repos[repoKey]
    if (repo === undefined) return undefined
    const repoWorkspaces = index.workspacesByRepo.get(repoKey) ?? []
    const worktrees: WorktreeNode[] = repo.worktrees
      .slice()
      .sort(compareWorktrees)
      .map((entry) => {
        const path = normalizePath(entry.path)
        return {
          path,
          branch: entry.branch,
          isMain: entry.isMain,
          exists: entry.exists,
          workspaceId: index.workspaceByPath.get(path)?.workspaceId,
          title: entry.branch ?? basename(path),
          sessions: [],
        }
      })

    // D-3：**子目录工作区**（路径不是任何 worktree 根，但落在某个 worktree 之下）。
    // 例如 `.../mobile_monorepo/android/SubApp`。若不做这一步，它的
    // `workspaceId` 与用户起的 `title` 会在整棵树里彻底消失（既没有 worktree 行、
    // 也没有 `ws:` 项目行承载它们）。
    // 归属策略：挂到**包含它的那个 worktree**（最长前缀优先），且只填空缺 ——
    // worktree 根自己的精确匹配优先，绝不覆盖。
    const exactPaths = new Set(worktrees.map((node) => node.path))
    for (const workspace of repoWorkspaces) {
      const workspacePath = normalizePath(workspace.path)
      if (exactPaths.has(workspacePath)) continue
      let best: WorktreeNode | undefined
      for (const node of worktrees) {
        if (workspacePath !== node.path && !workspacePath.startsWith(`${node.path}/`)) continue
        if (best === undefined || node.path.length > best.path.length) best = node
      }
      if (best === undefined || best.workspaceId !== undefined) continue
      best.workspaceId = workspace.workspaceId
    }

    // 项目标题：仓库有且**只有一个**工作区、且用户给它起过名字时，尊重用户的名字
    // （否则子目录工作区/单工作区仓的用户可见标题会被静默改写为仓目录名）。
    // 多个工作区时保持仓库名 —— 此时用任一工作区的名字都是武断的。
    const namedWorkspaces = repoWorkspaces.filter((row) => row.title !== '')
    const title =
      namedWorkspaces.length === 1 ? namedWorkspaces[0]!.title : basename(normalizePath(repo.mainPath))

    const accumulator: ProjectAccumulator = {
      key: repoKey,
      isGit: true,
      title,
      mainPath: normalizePath(repo.mainPath),
      worktrees,
      worktreeByPath: new Map<string, WorktreeNode>(),
      history: [],
      flatSessions: [],
    }
    for (const node of accumulator.worktrees) accumulator.worktreeByPath.set(node.path, node)
    accumulators.set(repoKey, accumulator)
    return accumulator
  }

  for (const key of orderProjectKeys(input, index)) {
    if (key.startsWith('ws:')) {
      const workspaceId = key.slice('ws:'.length)
      const workspace = input.workspaces.find((row) => row.workspaceId === workspaceId)
      if (workspace === undefined) continue
      accumulators.set(key, {
        key,
        isGit: false,
        title: workspace.title === '' ? basename(normalizePath(workspace.path)) : workspace.title,
        worktrees: [],
        worktreeByPath: new Map<string, WorktreeNode>(),
        history: [],
        flatSessions: [],
      })
      continue
    }
    ensureRepoAccumulator(key)
  }

  const ungrouped: SessionRow[] = []

  for (const session of input.sessions) {
    if (archived.has(session.sessionId)) continue
    const assignment = assignSession(session, index, input)
    switch (assignment.kind) {
      case 'worktree': {
        // 目标仓可能因为扫描降级而缺节点；此时退回未分组，绝不静默丢会话。
        const accumulator = ensureRepoAccumulator(assignment.repoKey)
        const node = accumulator?.worktreeByPath.get(assignment.path)
        if (node === undefined) {
          ungrouped.push(session)
          break
        }
        node.sessions.push(session)
        break
      }
      case 'history': {
        const accumulator = ensureRepoAccumulator(assignment.projectKey)
        if (accumulator === undefined) {
          ungrouped.push(session)
          break
        }
        accumulator.history.push(session)
        break
      }
      case 'flat': {
        const accumulator = accumulators.get(assignment.projectKey)
        if (accumulator === undefined) {
          ungrouped.push(session)
          break
        }
        accumulator.flatSessions.push(session)
        break
      }
      case 'ungrouped':
        ungrouped.push(session)
        break
    }
  }

  const projects: ProjectNode[] = []
  for (const key of accumulators.keys()) {
    const accumulator = accumulators.get(key)
    if (accumulator === undefined) continue
    for (const node of accumulator.worktrees) node.sessions.sort(compareSessions)
    accumulator.history.sort(compareSessions)
    accumulator.flatSessions.sort(compareSessions)
    projects.push({
      key: accumulator.key,
      isGit: accumulator.isGit,
      title: accumulator.title,
      mainPath: accumulator.mainPath,
      worktrees: accumulator.worktrees,
      history: accumulator.history,
      flatSessions: accumulator.flatSessions,
    })
  }

  ungrouped.sort(compareSessions)
  return { projects, ungrouped }
}

/**
 * 从全部会话中挑出既无 worktree 归属、又无项目归属的（规则 5）。
 *
 * 实现上**不依赖** `buildProjects` 内部的中间结果，而是把 `projects` 里已经出现的
 * sessionId 全收集起来做差集——这样它同时充当一次独立交叉校验：若两条路径结论不一致，
 * 调用方能在测试里立刻发现。归档会话同样排除。
 */
export function collectUngrouped(input: BuildProjectsInput, projects: ProjectNode[]): SessionRow[] {
  const placed = new Set<string>()
  for (const project of projects) {
    for (const node of project.worktrees) {
      for (const session of node.sessions) placed.add(session.sessionId)
    }
    for (const session of project.history) placed.add(session.sessionId)
    for (const session of project.flatSessions) placed.add(session.sessionId)
  }

  const archived = new Set(input.archivedSessionIds)
  const result: SessionRow[] = []
  for (const session of input.sessions) {
    if (archived.has(session.sessionId)) continue
    if (placed.has(session.sessionId)) continue
    result.push(session)
  }
  result.sort(compareSessions)
  return result
}
