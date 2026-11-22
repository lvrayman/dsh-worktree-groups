/**
 * 回归单测：`src/git.ts`（`scanRepo` 的 `mainPath` 语义）。
 *
 * ## 为什么有这个文件
 *
 * 在本次缺陷之前，`test/` 下没有任何一个文件导入 `../lib/git.js` —— 整个 git 扫描层
 * （`runGit` / `parseWorktreeList` / `resolveCommonDir` / `resolveToplevel` / `scanRepo`）
 * 零覆盖。于是下面这个真实缺陷逃过了全部 176 条用例：
 *
 * ```
 * ▾ MyProject-ohos      ← 错！这是 worktree 名，不是仓名
 *    ▾ develop [主]
 * ```
 *
 * 根因：`git rev-parse --show-toplevel` 在 **linked worktree** 里返回的是**该 worktree
 * 自己**的路径，不是主工作树。`scanRepo` 曾直接用它当 `mainPath`，于是「工作区注册表里
 * 先扫到哪个入口」决定了项目标题（`buildProjects` 用 `basename(repo.mainPath)` 当标题）。
 *
 * 修复后 `mainPath` 改取 `git worktree list --porcelain` 里 `isMain: true` 那条。
 *
 * ## 隔离纪律
 *
 * - 所有 fixture 仓一律在 `fs.mkdtemp(tmpdir())` 下自建，**绝不**碰任何真实 worktree；
 * - 对 fixture 仓只做 `git init` / `commit` / `worktree add`；
 * - 对**真实**仓**零**访问（本文件不引用任何 `/Users/...` 路径）。
 */

import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { after, test } from 'node:test'
import { promisify } from 'node:util'

import { normalizePath, parseWorktreeList, resolveToplevel, scanRepo } from '../lib/git.js'
import { buildProjects } from '../lib/projects.js'

const pexec = promisify(execFile)

/** 已创建的临时根目录，`after` 钩子统一清理。 */
const tempRoots = []

after(async () => {
  await Promise.all(tempRoots.map((dir) => rm(dir, { recursive: true, force: true })))
})

/**
 * 造一个临时根目录。
 *
 * 先对 `tmpdir()` 取 `realpath`：macOS 上 `/var` 是 `/private/var` 的符号链接，而
 * `git worktree list` 回的是 realpath 拼法。若不先归一，`normalizePath`（只做 resolve）
 * 会让「git 输出的路径」与「我们拼出来的路径」不相等，用例会莫名失败。
 */
async function makeRoot(prefix) {
  const base = await realpath(tmpdir())
  const dir = await mkdtemp(join(base, `${prefix}-`))
  tempRoots.push(dir)
  return dir
}

/**
 * 造一个「主仓 + N 个 linked worktree」的 fixture 仓。
 *
 * @param {string} prefix 临时目录前缀
 * @param {Array<{dir: string, branch: string}>} worktrees 要建的 linked worktree
 * @returns `{ root, mainRepo, linked: { [branch]: path } }`
 */
async function makeGitFixture(prefix, worktrees = []) {
  const root = await makeRoot(prefix)
  const mainRepo = join(root, 'fixture-repo')
  await mkdir(mainRepo, { recursive: true })

  const git = async (args, cwd = mainRepo) => (await pexec('git', args, { cwd })).stdout
  await git(['init', '-q', '-b', 'main'])
  await git(['config', 'user.email', 'test@example.invalid'])
  await git(['config', 'user.name', 'dsh-worktree-groups test'])
  await writeFile(join(mainRepo, 'README.md'), 'fixture\n', 'utf8')
  await git(['add', '.'])
  await git(['commit', '-q', '-m', 'init'])

  const linked = {}
  for (const spec of worktrees) {
    const path = join(root, spec.dir)
    await git(['worktree', 'add', '-q', '-b', spec.branch, path])
    linked[spec.branch] = path
  }
  return { root, mainRepo, linked, git }
}

/* ------------------------------------------------------------------ *
 * 修 1 回归：scanRepo 的 mainPath 与「从哪个 worktree 扫描」无关
 * ------------------------------------------------------------------ */

test('修1 回归: scanRepo 从「主仓」与「linked worktree」调用，mainPath 都必须是主仓路径', async () => {
  const fixture = await makeGitFixture('wtg-git-mainpath', [
    { dir: 'fixture-repo-ohos', branch: 'feature/ohos' },
  ])
  const { mainRepo, linked } = fixture
  const ohos = linked['feature/ohos']
  assert.ok(ohos !== undefined, 'fixture 应建出 linked worktree')

  const fromMain = await scanRepo(mainRepo)
  const fromLinked = await scanRepo(ohos)

  assert.ok(fromMain !== null, 'scanRepo(主仓) 不应返回 null')
  assert.ok(fromLinked !== null, 'scanRepo(linked worktree) 不应返回 null')

  // 缺陷本体：修复前 fromLinked.mainPath 会等于 linked worktree 自己的路径。
  assert.equal(
    normalizePath(fromLinked.mainPath),
    normalizePath(mainRepo),
    '修1：从 linked worktree 扫描时 mainPath 必须是**主仓**路径（旧实现会回 worktree 自身）',
  )
  assert.equal(
    normalizePath(fromMain.mainPath),
    normalizePath(mainRepo),
    '修1：从主仓扫描时 mainPath 是主仓路径',
  )
  assert.equal(fromMain.mainPath, fromLinked.mainPath, '修1：两个入口必须给出**同一个** mainPath')

  // 反面对照：resolveToplevel 的真实行为就是缺陷来源，把它钉死成文档。
  assert.equal(
    normalizePath((await resolveToplevel(ohos)) ?? ''),
    normalizePath(ohos),
    '文档化：resolveToplevel 在 linked worktree 里返回的是**该 worktree 自己**（这正是不能拿它当 mainPath 的原因）',
  )
  assert.notEqual(
    normalizePath((await resolveToplevel(ohos)) ?? ''),
    normalizePath(mainRepo),
    '文档化：resolveToplevel(linked) 不等于主仓路径',
  )

  // 判据等价性：mainPath 必须等于列表里 isMain 那条的 path。
  const mainEntry = fromLinked.worktrees.find((entry) => entry.isMain)
  assert.ok(mainEntry !== undefined, 'worktree 列表必须有 isMain 条目')
  assert.equal(
    normalizePath(mainEntry.path),
    normalizePath(fromLinked.mainPath),
    '修1：mainPath 必须等于 isMain 条目的 path',
  )
  assert.equal(
    normalizePath(fromLinked.worktrees[0].path),
    normalizePath(mainRepo),
    'git 保证主工作树排在列表首位',
  )
})

test('修1 回归: 两个入口的 commonDir 必须相同（合并成同一个项目节点的前提）', async () => {
  const fixture = await makeGitFixture('wtg-git-commondir', [
    { dir: 'fixture-repo-a', branch: 'feature/a' },
    { dir: 'fixture-repo-b', branch: 'feature/b' },
  ])
  const fromMain = await scanRepo(fixture.mainRepo)
  const fromA = await scanRepo(fixture.linked['feature/a'])
  const fromB = await scanRepo(fixture.linked['feature/b'])

  assert.ok(fromMain !== null && fromA !== null && fromB !== null, '三个入口都应扫出仓')

  assert.equal(fromA.commonDir, fromMain.commonDir, 'linked worktree 的 commonDir 必须与主仓一致')
  assert.equal(fromB.commonDir, fromMain.commonDir, '另一个 linked worktree 的 commonDir 也必须一致')
  assert.equal(
    normalizePath(fromMain.commonDir),
    normalizePath(join(fixture.mainRepo, '.git')),
    'commonDir 应是主仓的 .git 目录',
  )
})

test('修1 回归: 两个入口的完整 RepoInfo 逐字段相同（修 2「先到先得」因此无需加固）', async () => {
  const fixture = await makeGitFixture('wtg-git-identical', [
    { dir: 'fixture-repo-x', branch: 'feature/x' },
    { dir: 'fixture-repo-y', branch: 'release/1.2.3' },
  ])
  const fromMain = await scanRepo(fixture.mainRepo)
  const fromLinked = await scanRepo(fixture.linked['feature/x'])
  assert.ok(fromMain !== null && fromLinked !== null, '两个入口都应扫出仓')

  // 这是「修 2 是否有必要」的判据：只要两份 RepoInfo 完全相同，
  // scanRepos 的 accept() 无论保留先到的还是后到的，结果都一样。
  assert.deepEqual(
    fromLinked,
    fromMain,
    '修1 之后：两个入口的 RepoInfo 必须**完全一致**，accept() 的先到先得不再有影响',
  )
  assert.equal(JSON.stringify(fromLinked), JSON.stringify(fromMain), '序列化后也应逐字节相同')

  // 分支名里的 `/` 必须保留（`feature/x`、`release/1.2.3`）。
  const branches = fromLinked.worktrees.map((entry) => entry.branch).sort()
  assert.deepEqual(
    branches,
    ['feature/x', 'main', 'release/1.2.3'],
    '分支名内部斜杠必须保留，只截 refs/heads/ 前缀',
  )
  assert.ok(
    branches.includes('release/1.2.3'),
    'release/1.2.3 这类多级分支名不得被截成 1.2.3',
  )
})

test('修1 回归: mainPath 与裸 git 输出对齐（git worktree list 的第一个条目）', async () => {
  const fixture = await makeGitFixture('wtg-git-bare-git', [
    { dir: 'fixture-repo-z', branch: 'feature/z' },
  ])
  // 直接跑裸 git，证明 mainPath 就是 git 自己认的第一个条目（不靠我们猜）。
  const porcelain = (
    await pexec('git', ['worktree', 'list', '--porcelain'], { cwd: fixture.linked['feature/z'] })
  ).stdout
  const parsed = parseWorktreeList(porcelain)
  assert.equal(parsed.length, 2, 'fixture 应有 2 个 worktree')
  assert.equal(parsed[0].isMain, true, '第一个条目 isMain: true')
  assert.equal(parsed[1].isMain, false, '第二个条目 isMain: false')

  const scanned = await scanRepo(fixture.linked['feature/z'])
  assert.ok(scanned !== null, '应扫出仓')
  assert.equal(
    normalizePath(scanned.mainPath),
    parsed[0].path,
    'mainPath 必须等于裸 git 输出的第一个条目路径',
  )
})

test('修1 边界: 无 linked worktree 的单树仓，mainPath 仍是自己的路径', async () => {
  const fixture = await makeGitFixture('wtg-git-single')
  const scanned = await scanRepo(fixture.mainRepo)
  assert.ok(scanned !== null, '单树仓应扫出仓')
  assert.equal(normalizePath(scanned.mainPath), normalizePath(fixture.mainRepo), '单树仓 mainPath = 自身')
  assert.equal(scanned.worktrees.length, 1, '只有一条 worktree')
  assert.equal(scanned.worktrees[0].isMain, true, '唯一那条是主树')
})

test('修1 边界: 非 git 目录与 bare 仓都返回 null（门槛未被放宽）', async () => {
  const root = await makeRoot('wtg-git-nonrepo')
  const plain = join(root, 'not-a-repo')
  await mkdir(plain, { recursive: true })
  assert.equal(await scanRepo(plain), null, '非 git 目录应返回 null')

  const bare = join(root, 'bare.git')
  await mkdir(bare, { recursive: true })
  await pexec('git', ['init', '-q', '--bare'], { cwd: bare })
  assert.equal(await scanRepo(bare), null, 'bare 仓应返回 null（resolveToplevel 门槛仍生效）')
})

/* ------------------------------------------------------------------ *
 * 修 1 的端到端后果：项目标题必须是主仓 basename
 * ------------------------------------------------------------------ */

/** 造一个 `RepoInfo`（不跑 git，直接构造）。 */
function repoInfo(mainPath, commonDir, worktrees) {
  return { commonDir, mainPath, worktrees }
}

/** 造一条 worktree 条目。 */
function worktreeEntry(path, { branch, isMain = false } = {}) {
  return { path, isMain, bare: false, exists: true, ...(branch === undefined ? {} : { branch }) }
}

/** `buildProjects` 入参默认值 + 覆盖。 */
function projectsInput(overrides = {}) {
  return {
    workspaces: [],
    repos: {},
    repoByWorkspacePath: {},
    ledger: { version: 1, projects: {}, sessions: {} },
    sessions: [],
    archivedSessionIds: [],
    ...overrides,
  }
}

test('修1 回归: 工作区顺序「linked worktree 在前、主仓在后」时，项目标题仍是主仓 basename', async () => {
  // 真跑一次 git，拿到真实的 mainPath / commonDir 组合，避免手写常量掩盖缺陷。
  const fixture = await makeGitFixture('wtg-git-title', [
    { dir: 'MyProject-ohos', branch: 'feature/ohos' },
  ])
  const mainRepo = fixture.mainRepo // basename 由 mkdtemp 决定 → 用 basename() 取
  const linkedPath = fixture.linked['feature/ohos']
  const fromLinked = await scanRepo(linkedPath)
  assert.ok(fromLinked !== null, '应扫出仓')

  const MAIN_NAME = basename(normalizePath(mainRepo))
  const LINKED_NAME = basename(normalizePath(linkedPath))
  assert.notEqual(MAIN_NAME, LINKED_NAME, 'fixture 的主树名与 worktree 名必须不同（否则用例无意义）')

  // 复刻真实数据的宿主持久顺序：**linked worktree 先注册、主仓后注册**。
  // 这正是 scanRepos 的 accept() 会「先到先得」保留 linked worktree 那份的场景。
  const input = projectsInput({
    workspaces: [
      {
        workspaceId: 'ws-linked',
        path: normalizePath(linkedPath),
        title: '', // 空标题 ⇒ 触发 basename(repo.mainPath) 分支
        createdAt: '',
        updatedAt: '',
      },
      {
        workspaceId: 'ws-main',
        path: normalizePath(mainRepo),
        title: '',
        createdAt: '',
        updatedAt: '',
      },
    ],
    repos: { [fromLinked.commonDir]: fromLinked },
    repoByWorkspacePath: {
      [normalizePath(linkedPath)]: fromLinked.commonDir,
      [normalizePath(mainRepo)]: fromLinked.commonDir,
    },
  })

  const built = buildProjects(input)
  assert.equal(built.projects.length, 1, '两个工作区属于同一 commonDir ⇒ 只应有一个项目节点')
  const project = built.projects[0]

  assert.equal(
    project.title,
    MAIN_NAME,
    `修1：项目标题必须是**主仓 basename**（${MAIN_NAME}），不得是 worktree 名（${LINKED_NAME}）`,
  )
  assert.notEqual(project.title, LINKED_NAME, '修1：标题不得回退成 linked worktree 名')
  assert.equal(
    normalizePath(project.mainPath),
    normalizePath(mainRepo),
    '修1：项目的 mainPath 必须是主仓路径',
  )
  assert.equal(project.key, fromLinked.commonDir, '项目 key 是 commonDir')
  assert.equal(project.isGit, true, 'git 项目')
  assert.equal(project.worktrees.length, 2, '两个 worktree 都应出现')
  assert.equal(project.worktrees[0].isMain, true, '主树排在首位')
})

test('修1 反证: 若 mainPath 被污染成 linked worktree，标题就会错（钉死缺陷机理）', async () => {
  // 这条用例**故意**注入被污染的 mainPath，证明「标题错误的唯一来源就是 mainPath」，
  // 即 projects.ts 的 basename(repo.mainPath) 用法本身没错（故本次不改 projects.ts）。
  const fixture = await makeGitFixture('wtg-git-poisoned', [
    { dir: 'MyProject-ohos', branch: 'feature/ohos' },
  ])
  const linkedPath = fixture.linked['feature/ohos']
  const fromLinked = await scanRepo(linkedPath)
  assert.ok(fromLinked !== null, '应扫出仓')

  const MAIN_NAME = basename(normalizePath(fixture.mainRepo))
  const LINKED_NAME = basename(normalizePath(linkedPath))

  const poisoned = repoInfo(normalizePath(linkedPath), fromLinked.commonDir, fromLinked.worktrees)
  const built = buildProjects(
    projectsInput({
      workspaces: [
        { workspaceId: 'ws', path: normalizePath(linkedPath), title: '', createdAt: '', updatedAt: '' },
      ],
      repos: { [poisoned.commonDir]: poisoned },
      repoByWorkspacePath: { [normalizePath(linkedPath)]: poisoned.commonDir },
    }),
  )

  assert.equal(
    built.projects[0].title,
    LINKED_NAME,
    '文档化：mainPath 被污染成 linked worktree 时，标题必然变成 worktree 名（正是缺陷现象）',
  )
  assert.notEqual(built.projects[0].title, MAIN_NAME, '文档化：污染状态下拿不到主仓名')
})
