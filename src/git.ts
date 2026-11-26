import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { basename, resolve } from 'node:path'

import type { BranchEntry, RepoInfo, WorktreeEntry } from './types.js'

/** 子进程输出上限；8 MiB 足以容纳超大仓的 `worktree list` / `for-each-ref` 输出。 */
const MAX_BUFFER = 8 * 1024 * 1024

/**
 * git 可执行文件探测顺序：先用 PATH 上的裸名 `git`，失败再依次退到 macOS/Linux
 * 的常见绝对安装位置。裸名优先可兼容 nvm/asdf 等自管 PATH 的场景。
 */
const GIT_CANDIDATES = ['git', '/usr/bin/git', '/usr/local/bin/git', '/opt/homebrew/bin/git'] as const

/**
 * 模块级探测缓存。
 *
 * 缓存的是「探测 Promise」而不是结果，因此多个并发调用只会真正探测一次；
 * 探测失败时清空缓存，让下一次调用有机会重试（例如 git 刚被安装）。
 */
let gitBinPromise: Promise<string> | undefined

/**
 * 判断 signal 是否已取消。
 *
 * 刻意包成函数而不是内联 `signal?.aborted === true`：内联写法会让 TypeScript
 * 把 `aborted` 收窄成 `false`，导致 `await` 之后再判断时报「无交集」的假错误，
 * 而 signal 其实可以在 await 期间被取消。
 */
function isAborted(signal?: AbortSignal): boolean {
  return signal?.aborted === true
}

/** 试跑 `<bin> --version`，只关心能否成功执行。 */
function probeGitBin(bin: string): Promise<boolean> {
  return new Promise<boolean>((resolveProbe) => {
    execFile(bin, ['--version'], { windowsHide: true, timeout: 10_000 }, (error) => {
      resolveProbe(error === null)
    })
  })
}

/**
 * 解析可执行的 git 路径（模块级缓存，避免每条命令都重试一遍候选列表）。
 *
 * 候选顺序：`git` → `/usr/bin/git` → `/usr/local/bin/git` → `/opt/homebrew/bin/git`。
 * 全部失败时抛错；调用方若只做探测请改用 {@link runGitSafe}。
 */
function resolveGitBin(): Promise<string> {
  if (gitBinPromise === undefined) {
    const probing = (async (): Promise<string> => {
      for (const candidate of GIT_CANDIDATES) {
        if (await probeGitBin(candidate)) return candidate
      }
      throw new Error(`找不到可执行的 git（已尝试 ${GIT_CANDIDATES.join('、')}）`)
    })()
    gitBinPromise = probing.catch((error: unknown) => {
      // 失败不缓存：下次调用重新探测，避免临时故障（PATH 尚未就绪）被永久记忆。
      gitBinPromise = undefined
      throw error
    })
  }
  return gitBinPromise
}

/**
 * 跑一条 git 命令，返回 stdout（已 trim 掉首尾空白，含尾换行）。
 *
 * 关键约束：
 * - 一律走 `execFile` 数组参数，**绝不经 shell**（防注入）；
 * - 非零退出码时 reject，错误信息带上 stderr 摘要与 cwd，便于定位；
 * - 统一附加 `-c core.quotepath=false`，否则含中文等非 ASCII 的路径会被转义成八进制；
 * - 遵守传入的 AbortSignal（调用方取消即中断子进程）。
 */
export async function runGit(cwd: string, args: string[], signal?: AbortSignal): Promise<string> {
  const bin = await resolveGitBin()
  if (isAborted(signal)) throw new Error(`git ${args.join(' ')} 已取消`)
  return new Promise<string>((resolveRun, rejectRun) => {
    execFile(
      bin,
      ['-c', 'core.quotepath=false', ...args],
      { cwd, windowsHide: true, maxBuffer: MAX_BUFFER, signal },
      (error, stdout, stderr) => {
        if (error !== null) {
          const reason = stderr.trim() === '' ? error.message : stderr.trim()
          rejectRun(new Error(`git ${args.join(' ')} 失败（cwd=${cwd}）：${reason}`))
          return
        }
        resolveRun(stdout.trim())
      },
    )
  })
}

/**
 * 同 {@link runGit}，但任何失败（非 git 仓、命令不存在、被取消）都返回 `null`。
 *
 * 用于探测类调用（`rev-parse`、目录存在性相关的判断），调用方无需 try/catch。
 */
export async function runGitSafe(cwd: string, args: string[], signal?: AbortSignal): Promise<string | null> {
  try {
    return await runGit(cwd, args, signal)
  } catch {
    return null
  }
}

/** 判断目录/文件是否存在（`fs.stat` 判定，不跟随任何 git 输出推断）。 */
async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target)
    return true
  } catch {
    return false
  }
}

/**
 * 归一化路径：绝对化（`path.resolve`）、反斜杠转正斜杠、去掉尾斜杠。
 *
 * 例外：文件系统根（`/`）与 Windows 盘根（`C:/`）保留其唯一斜杠。
 * 本函数是本包内所有路径比较的**唯一**基准，任何路径进入比较前都必须先过它，
 * 否则 `/a/b` 与 `/a/b/` 会被当成两个不同的 worktree。
 */
export function normalizePath(p: string): string {
  const absolute = resolve(p).replace(/\\/g, '/')
  if (absolute.length <= 1) return absolute
  if (/^[A-Za-z]:\/$/.test(absolute)) return absolute
  let out = absolute
  while (out.length > 1 && out.endsWith('/')) out = out.slice(0, -1)
  return out
}

/** 解析过程中的可变条目（`isMain`/`exists` 由收尾阶段补全）。 */
interface PendingWorktree {
  path: string
  branch?: string
  head?: string
  bare: boolean
  detached: boolean
}

/**
 * 解析 `git worktree list --porcelain` 输出。
 *
 * 输出形如（条目之间以空行分隔）：
 * ```
 * worktree /Users/a/repo
 * HEAD d6399b7bf0f5ad0854b055bba3a8e75a7feede62
 * branch refs/heads/develop
 *
 * worktree /Users/a/repo-ohos
 * HEAD 914bbe2ffbfb7ebda989a779083227ae6b533d5c
 * branch refs/heads/feature/ohos
 * ```
 *
 * 关键约束：
 * - `branch refs/heads/X` ⇒ `branch: 'X'`，**分支名里的 `/` 必须保留**
 *   （`feature/ohos`、`release/6.1.20` 都只能截掉 `refs/heads/` 前缀）；
 * - `detached` 行 ⇒ `branch: undefined`；
 * - `bare` 行 ⇒ `bare: true`；
 * - **第一个条目 `isMain: true`**，其余 `false`（git 保证主工作树排在最前）；
 * - 本函数是**纯解析**：`exists` 无法从文本得知，这里乐观地置为 `true`，
 *   真实存在性由 {@link scanRepo} 用 `fs.stat` 逐条覆盖。这样即使调用方忘了探测，
 *   也只是「多显示一个 worktree」，而不会把活着的会话错判进 history 桶。
 * - 未知行（如 `locked` / `prunable`）跳过，保持前向兼容。
 */
export function parseWorktreeList(porcelain: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = []
  let current: PendingWorktree | undefined

  const flush = (): void => {
    const pending = current
    current = undefined
    if (pending === undefined || pending.path === '') return
    entries.push({
      path: normalizePath(pending.path),
      branch: pending.detached ? undefined : pending.branch,
      head: pending.head,
      isMain: entries.length === 0,
      bare: pending.bare,
      exists: true,
    })
  }

  for (const rawLine of porcelain.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    if (line === '') {
      flush()
      continue
    }
    const sep = line.indexOf(' ')
    const key = sep === -1 ? line : line.slice(0, sep)
    const value = sep === -1 ? '' : line.slice(sep + 1)

    switch (key) {
      case 'worktree':
        flush()
        current = { path: value, bare: false, detached: false }
        break
      case 'HEAD':
        if (current !== undefined) current.head = value
        break
      case 'branch':
        // 只截 refs/heads/ 前缀，保留分支名内部的斜杠。
        if (current !== undefined) current.branch = value.replace(/^refs\/heads\//, '')
        break
      case 'detached':
        if (current !== undefined) current.detached = true
        break
      case 'bare':
        if (current !== undefined) current.bare = true
        break
      default:
        break
    }
  }
  flush()
  return entries
}

/**
 * 解析仓库的 common dir（`git rev-parse --git-common-dir`），非 git 仓返回 `null`。
 *
 * **关键坑**：该命令对主工作树通常只回相对路径 `.git`，必须相对 `repoPath` 再
 * resolve 成绝对路径后才能当仓库身份键；对 linked worktree 则回绝对路径
 * （`<主仓>/.git`）——两者归一后必须相等，同一仓才能被合并成一个项目节点。
 */
export async function resolveCommonDir(repoPath: string, signal?: AbortSignal): Promise<string | null> {
  const raw = await runGitSafe(repoPath, ['rev-parse', '--git-common-dir'], signal)
  if (raw === null || raw === '') return null
  // path.resolve 对绝对路径忽略第二个参数，对相对路径（.git）按 repoPath 展开。
  return normalizePath(resolve(repoPath, raw))
}

/**
 * 解析工作树根目录（`git rev-parse --show-toplevel`），非 git 仓 / bare 仓返回 `null`。
 *
 * **⚠️ 陷阱**：在 linked worktree 里执行得到的是**该 worktree 自己**的路径，而不是主树。
 * 因此本函数**不能**用来求「仓的主工作树路径」。需要主树请用 {@link scanRepo} 的
 * `mainPath`（它取 `git worktree list --porcelain` 的第一个 / `isMain` 条目），
 * 或自行从 `parseWorktreeList` 的结果里取 `isMain: true` 那条。
 *
 * 本函数保留导出，用于「只想知道给定路径落在哪个工作树根」的场景（例如 `scanRepo`
 * 用它排除 bare 仓）。参见 {@link scanRepo} 的 JSDoc 了解完整背景。
 */
export async function resolveToplevel(repoPath: string, signal?: AbortSignal): Promise<string | null> {
  const raw = await runGitSafe(repoPath, ['rev-parse', '--show-toplevel'], signal)
  if (raw === null || raw === '') return null
  return normalizePath(raw)
}

/**
 * 完整扫描一个仓：common dir + 主树 + 全部 worktree + 逐条目录存在性。
 * 非 git 仓返回 `null`；被取消时返回 `null`（不抛错，交由调用方按「本次无数据」处理）。
 *
 * 步骤：
 *  1. `resolveCommonDir` —— 拿仓库身份键，非 git 仓直接 null；
 *  2. `resolveToplevel` —— **只作门槛**：确认 `repoPath` 落在一个真实工作树里
 *     （bare 仓会在这里被排除）。它返回的值**不**直接当 `mainPath`，原因见下；
 *  3. 在 `repoPath` 下跑 `git worktree list --porcelain` 并解析；
 *  4. **`mainPath` 取列表里 `isMain: true` 那条的 `path`** —— `parseWorktreeList` 已把
 *     第一个条目标为 `isMain: true`，而 git 保证主工作树排在最前；
 *  5. **逐条 `fs.stat`** 判定 `exists` —— 绝不能用 git 输出推断：被 `rm -rf` 掉的
 *     worktree 仍会留在 git 的列表里，只有 stat 才能识别「已关闭」；
 *  6. 返回 `{ commonDir, mainPath, worktrees }`（worktrees 保持 git 顺序，主树在首位）。
 *
 * ## `mainPath` 的语义（**本函数的关键不变量**）
 *
 * `mainPath` = **该仓的主工作树路径，与「从哪个 worktree 扫描」无关**。
 *
 * 为什么不能直接用 `resolveToplevel`：`git rev-parse --show-toplevel` 在 **linked
 * worktree** 里执行时返回的是**那个 worktree 自己**的路径，不是主工作树：
 *
 * ```
 * $ git -C <repo>        rev-parse --show-toplevel → <repo>          ✅ 主树
 * $ git -C <repo>-ohos   rev-parse --show-toplevel → <repo>-ohos     ❌ worktree 自身
 * $ git -C <repo>-ohos   rev-parse --git-common-dir → <repo>/.git    ✅ 两者一致
 * ```
 *
 * 于是「工作区注册表里先扫到哪个入口」会决定 `mainPath`，进而让
 * `buildProjects` 的 `basename(repo.mainPath)` 把项目标题算成 worktree 名
 * （真实数据里 `MyProject` 曾被显示为 `MyProject-ohos`）。改用
 * `git worktree list --porcelain` 的第一个条目后，从任何入口扫描都得到同一个主树路径。
 *
 * `resolveToplevel` 仅作为**拿不到列表时**的兜底（此时无从得知主树，只能退回当前
 * 工作树；这种降级在正常仓里不会发生）。
 */
export async function scanRepo(repoPath: string, signal?: AbortSignal): Promise<RepoInfo | null> {
  if (isAborted(signal)) return null

  // 2026-11-14 PERF3：三条只读 git 命令互不依赖 ⇒ 并行（旧实现串行，耗时相加）。
  const [commonDir, fallbackMainPath, porcelain] = await Promise.all([
    resolveCommonDir(repoPath, signal),
    // 门槛：非 git 仓 / bare 仓在这里被排除（bare 仓的 --show-toplevel 会失败）。
    // 该值只在拿不到 worktree 列表时兜底，正常情况下会被下面的 isMain 条目覆盖。
    resolveToplevel(repoPath, signal),
    runGitSafe(repoPath, ['worktree', 'list', '--porcelain'], signal),
  ])
  if (commonDir === null) return null
  if (fallbackMainPath === null) return null

  if (porcelain === null) {
    // 已是 git 仓却拿不到列表（极罕见：worktree 元数据损坏、又被取消）。
    // 降级为「只有一个主树」而不是整体失败，保证侧栏仍有工作区行。
    if (isAborted(signal)) return null
    return {
      commonDir,
      mainPath: fallbackMainPath,
      worktrees: [
        { path: fallbackMainPath, isMain: true, bare: false, exists: await pathExists(fallbackMainPath) },
      ],
    }
  }

  const parsed = parseWorktreeList(porcelain)
  if (parsed.length === 0) {
    return {
      commonDir,
      mainPath: fallbackMainPath,
      worktrees: [
        { path: fallbackMainPath, isMain: true, bare: false, exists: await pathExists(fallbackMainPath) },
      ],
    }
  }

  // 主树 = 列表里 isMain 那条（git 保证第一个条目就是主工作树，即使从 linked
  // worktree 执行也成立）。拿不到才退回 resolveToplevel 的结果。
  const mainEntry = parsed.find((entry) => entry.isMain)
  const mainPath = mainEntry?.path ?? fallbackMainPath

  const exists = await Promise.all(parsed.map((entry) => pathExists(entry.path)))
  const worktrees: WorktreeEntry[] = parsed.map((entry, index) => ({ ...entry, exists: exists[index] === true }))
  return { commonDir, mainPath, worktrees }
}

/**
 * 列出仓库的全部本地与远端分支（排除 `refs/remotes/<remote>/HEAD` 符号引用），
 * 并结合 `git worktree list --porcelain` 标出已被现有 worktree 检出的本地分支。
 *
 * 排序规则：当前分支（`HEAD === '*'`）置首 → 其余本地分支字典序 → 远端分支字典序。
 */
export async function listRepoBranches(repoPath: string, signal?: AbortSignal): Promise<BranchEntry[]> {
  if (isAborted(signal)) return []

  const [refsRaw, porcelain] = await Promise.all([
    runGit(
      repoPath,
      ['for-each-ref', '--format=%(refname:short)\t%(refname)\t%(HEAD)\t%(symref)', 'refs/heads', 'refs/remotes'],
      signal,
    ),
    runGitSafe(repoPath, ['worktree', 'list', '--porcelain'], signal),
  ])

  const checkedOutByBranch = new Map<string, string>()
  if (porcelain !== null) {
    for (const wt of parseWorktreeList(porcelain)) {
      if (wt.branch !== undefined && wt.branch !== '' && !checkedOutByBranch.has(wt.branch)) {
        checkedOutByBranch.set(wt.branch, wt.path)
      }
    }
  }

  const locals: BranchEntry[] = []
  const remotes: BranchEntry[] = []

  for (const rawLine of refsRaw.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    if (line === '') continue
    const [shortName = '', fullRef = '', headMark = '', symref = ''] = line.split('\t')
    if (shortName === '') continue

    if (fullRef.startsWith('refs/heads/')) {
      const checkedOutPath = checkedOutByBranch.get(shortName)
      const entry: BranchEntry = {
        name: shortName,
        kind: 'local',
        ...(headMark === '*' ? { isCurrent: true } : {}),
        ...(checkedOutPath !== undefined
          ? { checkedOutWorktreePath: checkedOutPath, checkedOutWorktreeName: basename(checkedOutPath) }
          : {}),
      }
      locals.push(entry)
    } else if (fullRef.startsWith('refs/remotes/')) {
      // 跳过 origin/HEAD 等符号引用，避免污染分支下拉框
      if (symref !== '' || fullRef.endsWith('/HEAD')) continue
      remotes.push({ name: shortName, kind: 'remote' })
    }
  }

  locals.sort((a, b) => {
    if (a.isCurrent === true && b.isCurrent !== true) return -1
    if (b.isCurrent === true && a.isCurrent !== true) return 1
    return a.name.localeCompare(b.name)
  })
  remotes.sort((a, b) => a.name.localeCompare(b.name))

  return [...locals, ...remotes]
}

