/**
 * IDEA 风格新建 worktree 弹窗的纯表单状态与校验逻辑。
 *
 * 零 React / 零 Node / 零宿主依赖，供 `sidebar.tsx` 与 `node --test` 共用。
 */

/** 分支下拉项（与宿主 `BranchEntry` 同构）。 */
export interface WorktreeFormBranch {
  name: string
  kind: 'local' | 'remote'
  checkedOutWorktreeName?: string
  checkedOutWorktreePath?: string
  isCurrent?: boolean
}

/** 弹窗表单受控状态。 */
export interface WorktreeFormState {
  fromBranch: string
  newBranchChecked: boolean
  newBranch: string
  projectName: string
  projectNameTouched: boolean
  location: string
}

/** 提交到 `POST /dsh-worktree-groups/worktree-create` 的请求体。 */
export interface WorktreeCreatePayload {
  repoPath: string
  branch: string
  createBranch: boolean
  baseRef?: string
  targetPath: string
}

/** 表单内联提示（用于解释为何禁用提交按钮，对齐 IDEA）。 */
export type WorktreeFormHint =
  | { code: 'branchCheckedOut'; branch: string; worktreeName: string }
  | { code: 'branchExists'; branch: string }
  | { code: 'newBranchRequired' }
  | { code: 'invalidProjectName' }
  | { code: 'invalidLocation' }
  | { code: 'sameAsMainRepo' }

export interface WorktreeFormEvaluation {
  targetPath: string
  canSubmit: boolean
  hint: WorktreeFormHint | null
  payload: WorktreeCreatePayload | null
}

/** 去掉尾部斜杠（保留 `/` 与 Windows 盘根 `C:/`）。 */
function trimTrailingSlashes(path: string): string {
  const posix = path.replace(/\\/g, '/')
  if (posix.length <= 1) return posix
  if (/^[A-Za-z]:\/$/.test(posix)) return posix
  return posix.replace(/\/+$/, '')
}

/** 取路径的最后一段（basename）。 */
function baseNameOf(path: string): string {
  const clean = trimTrailingSlashes(path)
  const index = clean.lastIndexOf('/')
  return index === -1 ? clean : clean.slice(index + 1)
}

/** 取路径的父目录。 */
function parentDirOf(path: string): string {
  const clean = trimTrailingSlashes(path)
  const index = clean.lastIndexOf('/')
  if (index <= 0) return clean.startsWith('/') ? '/' : ''
  return clean.slice(0, index)
}

/** 判断是否为绝对路径（POSIX `/` 或 Windows `C:/` / `C:\`）。 */
function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)
}

/** 拼接 `<location>/<projectName>`（POSIX 归一）。 */
export function joinWorktreePath(location: string, projectName: string): string {
  const loc = trimTrailingSlashes(location.trim())
  const name = projectName.trim()
  if (loc === '') return name
  if (name === '') return loc
  return loc.endsWith('/') ? `${loc}${name}` : `${loc}/${name}`
}

/**
 * 分支目录段净化：若分支名包含 `/`（如 `feature/ios-media-nps`），只取最后一段（`ios-media-nps`），
 * 再做非法字符净化，避免目录名带上冗余的 `feature-` 等前缀。
 */
export function sanitizeWorktreeDirSegment(branch: string): string {
  const withoutTrailingSlash = branch.trim().replace(/[/\\]+$/g, '')
  const lastSlash = Math.max(withoutTrailingSlash.lastIndexOf('/'), withoutTrailingSlash.lastIndexOf('\\'))
  const leaf = lastSlash >= 0 ? withoutTrailingSlash.slice(lastSlash + 1) : withoutTrailingSlash
  const sanitized = leaf.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return sanitized === '' ? 'worktree' : sanitized
}

/** 把远端分支名（如 `origin/feature/a`）转成默认本地跟踪分支名（`feature/a`）。 */
export function remoteBranchToLocalName(remoteBranch: string): string {
  const slash = remoteBranch.indexOf('/')
  if (slash <= 0 || slash === remoteBranch.length - 1) return remoteBranch
  return remoteBranch.slice(slash + 1)
}

/** 计算用于自动生成目录名的有效分支段。 */
function effectiveBranchForDir(
  form: Pick<WorktreeFormState, 'fromBranch' | 'newBranchChecked' | 'newBranch'>,
  branches: readonly WorktreeFormBranch[],
): string {
  if (form.newBranchChecked) {
    const trimmed = form.newBranch.trim()
    if (trimmed !== '') return trimmed
  }
  const selected = branches.find((b) => b.name === form.fromBranch)
  if (selected?.kind === 'remote') {
    return remoteBranchToLocalName(selected.name)
  }
  return form.fromBranch.trim()
}

/** 推导默认目录名：`<主仓名>-<有效分支 sanitize>`。 */
export function defaultProjectNameFor(
  repoPath: string,
  form: Pick<WorktreeFormState, 'fromBranch' | 'newBranchChecked' | 'newBranch'>,
  branches: readonly WorktreeFormBranch[],
): string {
  const repoName = baseNameOf(repoPath)
  const branch = effectiveBranchForDir(form, branches)
  if (branch === '') return repoName
  return `${repoName}-${sanitizeWorktreeDirSegment(branch)}`
}

/** 构造打开弹窗时的初始表单状态（对齐 IDEA：默认选当前分支、不勾选新建分支）。 */
export function createInitialWorktreeForm(
  repoPath: string,
  branches: readonly WorktreeFormBranch[],
): WorktreeFormState {
  const defaultBranch = branches.find((b) => b.isCurrent)?.name ?? branches[0]?.name ?? ''
  const base: WorktreeFormState = {
    fromBranch: defaultBranch,
    newBranchChecked: false,
    newBranch: '',
    projectName: '',
    projectNameTouched: false,
    location: parentDirOf(repoPath),
  }
  return {
    ...base,
    projectName: defaultProjectNameFor(repoPath, base, branches),
  }
}

/** 应用一次字段变更；未手动修改过目录名时自动联动更新 `projectName`。 */
export function applyWorktreeFormChange(
  prev: WorktreeFormState,
  patch: Partial<WorktreeFormState>,
  repoPath: string,
  branches: readonly WorktreeFormBranch[],
): WorktreeFormState {
  const next: WorktreeFormState = { ...prev, ...patch }
  // IDEA 交互：未勾选「新建分支」时直接输入非空分支名，自动勾选「新建分支」。
  if (
    patch.newBranch !== undefined &&
    patch.newBranchChecked === undefined &&
    patch.newBranch.trim() !== '' &&
    !prev.newBranchChecked
  ) {
    next.newBranchChecked = true
  }
  if (patch.projectName !== undefined && patch.projectNameTouched === undefined) {
    next.projectNameTouched = true
  }
  if (
    !next.projectNameTouched &&
    (patch.fromBranch !== undefined || patch.newBranchChecked !== undefined || patch.newBranch !== undefined)
  ) {
    next.projectName = defaultProjectNameFor(repoPath, next, branches)
  }
  return next
}

/** 校验表单并推导最终 `targetPath`、提交可用性与后端 payload。 */
export function evaluateWorktreeForm(
  form: WorktreeFormState,
  repoPath: string,
  branches: readonly WorktreeFormBranch[],
): WorktreeFormEvaluation {
  const location = form.location.trim()
  const projectName = form.projectName.trim()
  const targetPath = joinWorktreePath(location, projectName)

  const fail = (hint: WorktreeFormHint): WorktreeFormEvaluation => ({
    targetPath,
    canSubmit: false,
    hint,
    payload: null,
  })

  // 1. 分支校验
  const fromBranch = form.fromBranch.trim()
  let branchToSubmit = ''
  let createBranch = false
  let baseRef: string | undefined

  if (form.newBranchChecked) {
    const newBranch = form.newBranch.trim()
    if (newBranch === '') return fail({ code: 'newBranchRequired' })
    const existingLocal = branches.find((b) => b.kind === 'local' && b.name === newBranch)
    if (existingLocal !== undefined) {
      return fail({ code: 'branchExists', branch: newBranch })
    }
    branchToSubmit = newBranch
    createBranch = true
    baseRef = fromBranch !== '' ? fromBranch : undefined
  } else {
    if (fromBranch === '') return fail({ code: 'newBranchRequired' })
    const selected = branches.find((b) => b.name === fromBranch)
    if (selected?.kind === 'remote') {
      const localName = remoteBranchToLocalName(selected.name)
      const existingLocal = branches.find((b) => b.kind === 'local' && b.name === localName)
      if (existingLocal !== undefined) {
        if (existingLocal.checkedOutWorktreeName !== undefined) {
          return fail({
            code: 'branchCheckedOut',
            branch: existingLocal.name,
            worktreeName: existingLocal.checkedOutWorktreeName,
          })
        }
        branchToSubmit = existingLocal.name
        createBranch = false
      } else {
        branchToSubmit = localName
        createBranch = true
        baseRef = selected.name
      }
    } else {
      if (selected?.checkedOutWorktreeName !== undefined) {
        return fail({
          code: 'branchCheckedOut',
          branch: selected.name,
          worktreeName: selected.checkedOutWorktreeName,
        })
      }
      branchToSubmit = fromBranch
      createBranch = false
    }
  }

  // 2. 目录名与位置校验
  if (
    projectName === '' ||
    projectName === '.' ||
    projectName === '..' ||
    projectName.startsWith('.') ||
    projectName.includes('/') ||
    projectName.includes('\\')
  ) {
    return fail({ code: 'invalidProjectName' })
  }

  if (location === '' || !isAbsolutePath(location)) {
    return fail({ code: 'invalidLocation' })
  }

  if (trimTrailingSlashes(targetPath) === trimTrailingSlashes(repoPath)) {
    return fail({ code: 'sameAsMainRepo' })
  }

  const payload: WorktreeCreatePayload = {
    repoPath,
    branch: branchToSubmit,
    createBranch,
    ...(baseRef !== undefined ? { baseRef } : {}),
    targetPath,
  }

  return {
    targetPath,
    canSubmit: true,
    hint: null,
    payload,
  }
}
