/**
 * 宿主半边的数据结构定义（契约见 `docs/INTERFACES.md` §1.1）。
 *
 * 本文件只放类型，不含任何运行时代码与 IO：T1（git 扫描 / 项目合成）、
 * T2（台账）、T3（路由）三边共享同一套结构，避免各自私造影子类型。
 */

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

/** 一个 dsh 工作区（宿主持久记录的投影）。 */
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
   * 会话**最后更新时间**：`max(updatedAt, 宿主 session/event 记录的最大 event.time)`，
   * 恒为有限数字且 `>= updatedAt`（2026-10-29 RAS1–RAS4）。
   *
   * 由 `src/activity.ts#attachLastActivityTimes` 在 `buildSessionRows` 末尾补齐，
   * 并沿 `parentSessionId` 把子代理活动传播到祖先。**只有「最近」分区消费它排序**；
   * 工作区树的容器顺序 / 手动排序 / 顶部区仍使用 `updatedAt`。
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
  /** 非 git 工作区：会话直接挂项目下（不展开 worktree 子行）。 */
  flatSessions: SessionRow[]
}

/** 仓库的单个分支条目（供 IDEA 风格新建 worktree 弹窗的 `From branch` 下拉使用）。 */
export interface BranchEntry {
  /** 分支短名（如 `master`、`feature/ohos`、`origin/main`）。 */
  name: string
  /** `'local'`（`refs/heads/*`）或 `'remote'`（`refs/remotes/*`）。 */
  kind: 'local' | 'remote'
  /** 若该本地分支已在某个 worktree 检出，记录该 worktree 的目录名（basename）。 */
  checkedOutWorktreeName?: string
  /** 若该本地分支已在某个 worktree 检出，记录该 worktree 的归一化绝对路径。 */
  checkedOutWorktreePath?: string
  /** 是否为 `repoPath` 当前检出的分支。 */
  isCurrent?: boolean
}

/** 已归档的工作空间摘要（2026-10-21 WSR1/WSR2，供设置页展示与恢复）。 */
export interface ArchivedProjectRow {
  /** 项目键（git 为 commonDir，非 git 为 `ws:<workspaceId>`）。 */
  key: string
  /** 显示名称。 */
  title: string
  /** 主目录路径（git 为 mainPath，非 git 为工作区路径）。 */
  path?: string
  /** 是否为 git 工作空间。 */
  isGit: boolean
  /** 归档时间戳（epoch ms）。 */
  archivedAt: number
}

