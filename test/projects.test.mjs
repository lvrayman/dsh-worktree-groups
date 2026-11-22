/**
 * T6 单测：`src/projects.ts`（契约 `docs/INTERFACES.md` §1.3 / §4）。
 *
 * 纯逻辑，无 IO / 无子进程。覆盖 `looksLikeWorktreeOf`、`buildProjects` 的五条归属
 * 规则、D-2 死 worktree 回归、排序、归档排除、非 git 平铺，以及「无丢失 / 无重复」不变量。
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildProjects, collectUngrouped, looksLikeWorktreeOf } from '../lib/projects.js'

/** 该仓的 commonDir（仓库身份键）。 */
const REPO_KEY = '/a/b/LogAnalyst/.git'
const MAIN_PATH = '/a/b/LogAnalyst'

/** 造一份空台账。 */
function emptyLedger() {
  return { version: 1, projects: {}, sessions: {} }
}

/** 造一条会话行。 */
function session(sessionId, cwd, overrides = {}) {
  return {
    sessionId,
    updatedAt: 100,
    running: false,
    blank: false,
    ...(cwd === undefined ? {} : { cwd }),
    ...overrides,
  }
}

/** 造一条 worktree 条目。 */
function worktree(path, { branch, isMain = false, exists = true } = {}) {
  return {
    path,
    isMain,
    bare: false,
    exists,
    ...(branch === undefined ? {} : { branch }),
  }
}

/** 造一个 `RepoInfo`。 */
function repo(worktrees, mainPath = MAIN_PATH, commonDir = REPO_KEY) {
  return { commonDir, mainPath, worktrees }
}

/** 造一个工作区行。 */
function workspace(workspaceId, path, title = '') {
  return { workspaceId, path, title, sessionIds: [], createdAt: '', updatedAt: '' }
}

/** `buildProjects` 入参默认值 + 覆盖。 */
function input(overrides = {}) {
  return {
    workspaces: [],
    repos: {},
    repoByWorkspacePath: {},
    ledger: emptyLedger(),
    sessions: [],
    archivedSessionIds: [],
    ...overrides,
  }
}

/** 把某个项目节点的全部会话行摊平。 */
function sessionsOf(projectNode) {
  return [
    ...projectNode.worktrees.flatMap((node) => node.sessions),
    ...projectNode.history,
    ...projectNode.flatSessions,
  ]
}

/** 一个「主树 + 一个 feature worktree」的单仓环境。 */
function twoWorktreeRepo({ featureExists = true } = {}) {
  return {
    [REPO_KEY]: repo([
      worktree(MAIN_PATH, { isMain: true, branch: 'main' }),
      worktree(`${MAIN_PATH}-feat`, { branch: 'feat', exists: featureExists }),
    ]),
  }
}

// ---------------------------------------------------------------------------
// looksLikeWorktreeOf
// ---------------------------------------------------------------------------

test('looksLikeWorktreeOf: 正例 —— <主仓名>-<后缀> 同父目录 ⇒ true', () => {
  assert.equal(
    looksLikeWorktreeOf('/a/b/LogAnalyst-toolbar-refactor', '/a/b/LogAnalyst'),
    true,
    '契约正例：同父目录 + basename 以主仓名开头且更长',
  )
  assert.equal(
    looksLikeWorktreeOf('/a/b/LogAnalyst-feature-ohos', '/a/b/LogAnalyst'),
    true,
    '多级后缀同样成立',
  )
  assert.equal(
    looksLikeWorktreeOf('/a/b/LogAnalyst/', '/a/b/LogAnalyst'),
    false,
    '尾斜杠归一后等于自身 ⇒ false（自身不算自己的 worktree）',
  )
})

test('looksLikeWorktreeOf: 反例 —— 主仓名开头不成立 / 父目录不同 / 更短', () => {
  assert.equal(looksLikeWorktreeOf('/a/b/Other', '/a/b/LogAnalyst'), false, '契约反例：名字不以主仓名开头')
  assert.equal(looksLikeWorktreeOf('/a/b/LogAnalyst', '/a/b/LogAnalyst'), false, '契约反例：自身')
  assert.equal(looksLikeWorktreeOf('/a/c/LogAnalyst-x', '/a/b/LogAnalyst'), false, '父目录不同 ⇒ false')
  assert.equal(looksLikeWorktreeOf('/a/b/Log', '/a/b/LogAnalyst'), false, 'basename 更短 ⇒ false')
  assert.equal(
    looksLikeWorktreeOf('/a/b/LogAnalyst', '/a/b/Log'),
    true,
    '同名约定是「basename 以主仓名开头且更长」，故主仓名是死路径前缀时成立（双向不是对称的）',
  )
})

test('looksLikeWorktreeOf: 混合分隔符 / 尾斜杠也做归一化比较', () => {
  assert.equal(
    looksLikeWorktreeOf('/a/b/LogAnalyst-feat/', '/a/b/LogAnalyst/'),
    true,
    '两侧尾斜杠归一后仍应匹配',
  )
})

test('normalizePath: 再导出可用且行为符合契约（POSIX、去尾斜杠、绝对化）', async () => {
  const { normalizePath } = await import('../lib/projects.js')

  assert.equal(normalizePath('/a/b/c/'), '/a/b/c', '去掉尾斜杠')
  assert.equal(normalizePath('/a/b/c'), '/a/b/c', '已归一化路径保持不变')
  assert.equal(normalizePath('/a/b/c///'), '/a/b/c', '多个尾斜杠一并去掉')
  assert.equal(normalizePath('/'), '/', '根路径保留（不变成空串）')
  assert.equal(normalizePath('/a/b/../c'), '/a/c', '解析 .. 段')
  assert.equal(normalizePath('a/b'), `${process.cwd()}/a/b`, '相对路径按契约绝对化（resolve 语义）')
  assert.equal(normalizePath(''), process.cwd(), '空串按 resolve 语义解析为当前工作目录（不崩）')
})

// ---------------------------------------------------------------------------
// buildProjects —— 规则 1..5
// ---------------------------------------------------------------------------

test('规则 1: cwd 命中存在的 worktree ⇒ 归该 worktree（未注册也可）', () => {
  const out = buildProjects(
    input({
      repos: twoWorktreeRepo(),
      sessions: [session('s-feat', `${MAIN_PATH}-feat`), session('s-main', MAIN_PATH)],
    }),
  )

  const [projectNode] = out.projects
  assert.equal(out.projects.length, 1, '两个 worktree 应合成 1 个项目节点')
  assert.deepEqual(
    projectNode.worktrees.map((node) => [node.path, node.sessions.map((s) => s.sessionId)]),
    [
      [MAIN_PATH, ['s-main']],
      [`${MAIN_PATH}-feat`, ['s-feat']],
    ],
    '按 cwd 精确归位到各自 worktree',
  )
  assert.deepEqual(out.ungrouped, [], '规则 1 命中的会话不应进未分组')
  assert.deepEqual(projectNode.history, [], '规则 1 命中的会话不应进 history 桶')
  assert.equal(
    projectNode.worktrees[1].workspaceId,
    undefined,
    '未注册 worktree 的 workspaceId 为 undefined（懒注册）',
  )
})

test('规则 1: cwd 命中台账里「已消失」的 worktree 路径 ⇒ 不归它（走规则 3/4）', () => {
  const out = buildProjects(
    input({
      repos: twoWorktreeRepo({ featureExists: false }),
      sessions: [session('s-feat', `${MAIN_PATH}-feat`)],
    }),
  )

  const [projectNode] = out.projects
  assert.equal(
    projectNode.worktrees.find((node) => node.path === `${MAIN_PATH}-feat`).sessions.length,
    0,
    'exists:false 的 worktree 不得挂会话',
  )
  assert.deepEqual(
    projectNode.history.map((s) => s.sessionId),
    ['s-feat'],
    '死 worktree 的会话应经规则 4（路径启发）进 history 桶',
  )
})

test('规则 2: cwd 命中已注册工作区（子目录工作区，非任何 worktree 根）⇒ 回退该仓主树', () => {
  const subdir = `${MAIN_PATH}/android/BatteryCam`
  const out = buildProjects(
    input({
      workspaces: [workspace('W-sub', subdir, 'BatteryCam')],
      repos: twoWorktreeRepo(),
      repoByWorkspacePath: { [subdir]: REPO_KEY },
      sessions: [session('s-sub', subdir)],
    }),
  )

  const [projectNode] = out.projects
  assert.deepEqual(
    projectNode.worktrees.map((node) => [node.path, node.sessions.map((s) => s.sessionId)]),
    [
      [MAIN_PATH, ['s-sub']],
      [`${MAIN_PATH}-feat`, []],
    ],
    '规则 2（未精确命中）应回退主树，保证会话留在这个项目下（PRD G4 不搬移）',
  )
  assert.equal(
    projectNode.worktrees[0].workspaceId,
    'W-sub',
    'D-3：子目录工作区的 workspaceId 应挂到包含它的那个 worktree 上（否则用户起的名字整棵树都看不到）',
  )
  assert.deepEqual(out.ungrouped, [], '不应进未分组')
})

test('规则 2: cwd 命中已注册工作区且就是主树 ⇒ 归该工作区对应 worktree', () => {
  const out = buildProjects(
    input({
      workspaces: [workspace('W-main', MAIN_PATH, 'LogAnalyst')],
      repos: twoWorktreeRepo(),
      repoByWorkspacePath: { [MAIN_PATH]: REPO_KEY },
      sessions: [session('s-main', MAIN_PATH)],
    }),
  )

  const [projectNode] = out.projects
  assert.equal(projectNode.key, REPO_KEY, '项目键为 commonDir')
  assert.equal(projectNode.title, 'LogAnalyst', '只有一个命名工作区 ⇒ 尊重用户起的项目标题')
  assert.deepEqual(
    projectNode.worktrees[0].sessions.map((s) => s.sessionId),
    ['s-main'],
    '会话归到主树 worktree',
  )
  assert.equal(projectNode.worktrees[0].workspaceId, 'W-main', '主树 worktree 带注册的工作区 id')
})

test('规则 3: cwd 命中台账记录且该路径已不存在 ⇒ 归该项目 history 桶', () => {
  const gonePath = `${MAIN_PATH}-removed`
  const ledger = emptyLedger()
  ledger.projects[REPO_KEY] = { mainPath: MAIN_PATH, worktrees: {} }
  ledger.sessions['s-gone'] = { projectKey: REPO_KEY, worktreePath: gonePath }

  const out = buildProjects(
    input({
      // 关键：该路径既不在 git 扫描结果里（目录已 rm -rf），也不匹配路径启发。
      repos: { [REPO_KEY]: repo([worktree(MAIN_PATH, { isMain: true, branch: 'main' })]) },
      ledger,
      sessions: [session('s-gone', '/completely/elsewhere')],
    }),
  )

  const [projectNode] = out.projects
  assert.deepEqual(
    projectNode.history.map((s) => s.sessionId),
    ['s-gone'],
    '规则 3 应凭台账把会话接回 history 桶（cwd 与 worktreePath 不一致也认台账）',
  )
  assert.deepEqual(out.ungrouped, [], '规则 3 命中的会话不进未分组')
})

test('规则 3: 台账记录的 projectKey 不在 repos 里 ⇒ 不误归（降级为未分组）', () => {
  const ledger = emptyLedger()
  ledger.sessions['s-orphan'] = { projectKey: '/unknown/.git', worktreePath: '/unknown-wt' }

  const out = buildProjects(
    input({ repos: twoWorktreeRepo(), ledger, sessions: [session('s-orphan', '/unknown-wt')] }),
  )

  assert.deepEqual(out.ungrouped.map((s) => s.sessionId), ['s-orphan'], '未知项目的台账记录不应被信任')
  assert.deepEqual(
    out.projects.flatMap((p) => p.history),
    [],
    '不应把会话塞进任何项目的 history 桶',
  )
})

test('规则 4: cwd 是不存在的目录且能被 mainPath 路径启发匹配 ⇒ 归 history 桶', () => {
  const out = buildProjects(
    input({
      repos: { [REPO_KEY]: repo([worktree(MAIN_PATH, { isMain: true, branch: 'main' })]) },
      ledger: emptyLedger(),
      sessions: [session('s-orphan', `${MAIN_PATH}-toolbar-refactor`)],
    }),
  )

  const [projectNode] = out.projects
  assert.deepEqual(
    projectNode.history.map((s) => s.sessionId),
    ['s-orphan'],
    'PRD US3 存量孤儿会话（LogAnalyst-toolbar-refactor）应被路径启发接回 history 桶',
  )
  assert.deepEqual(out.ungrouped, [], '规则 4 命中的会话不进未分组')
})

test('规则 4: 目录不存在但无法匹配任何项目 ⇒ 未分组', () => {
  const out = buildProjects(
    input({
      repos: twoWorktreeRepo(),
      sessions: [session('s-other', '/zzz/unrelated-dir')],
    }),
  )

  assert.deepEqual(out.ungrouped.map((s) => s.sessionId), ['s-other'], '规则 5：无归属 ⇒ 未分组')
  assert.deepEqual(
    out.projects.flatMap((p) => p.history),
    [],
    '未分组会话不进任何 history 桶',
  )
})

test('规则 5: 无 cwd 的会话（undefined / ""）一律进未分组，不崩', () => {
  const out = buildProjects(
    input({
      repos: twoWorktreeRepo(),
      sessions: [
        session('no-cwd-undefined', undefined),
        session('no-cwd-empty', ''),
        // 有 cwd 且命中的对照组，证明不是「全部进未分组」的假通过。
        session('with-cwd', MAIN_PATH),
      ],
    }),
  )

  assert.deepEqual(
    out.ungrouped.map((s) => s.sessionId).sort(),
    ['no-cwd-empty', 'no-cwd-undefined'],
    '裁定 8：cwd 缺失/空串 ⇒ 未分组',
  )
  assert.deepEqual(
    out.projects[0].worktrees[0].sessions.map((s) => s.sessionId),
    ['with-cwd'],
    '有 cwd 的会话正常归位',
  )
})

test('规则 5: collectUngrouped 与 buildProjects().ungrouped 结论一致', () => {
  const inp = input({
    workspaces: [workspace('W-main', MAIN_PATH, 'LogAnalyst')],
    repos: twoWorktreeRepo(),
    repoByWorkspacePath: { [MAIN_PATH]: REPO_KEY },
    sessions: [
      session('a', MAIN_PATH),
      session('b', `${MAIN_PATH}-feat`),
      session('c', `${MAIN_PATH}-toolbar-refactor`),
      session('d', '/zzz/unknown'),
      session('e', undefined),
    ],
  })

  const out = buildProjects(inp)
  const fromHelper = collectUngrouped(inp, out.projects)

  assert.deepEqual(
    fromHelper.map((s) => s.sessionId).sort(),
    out.ungrouped.map((s) => s.sessionId).sort(),
    'collectUngrouped（差集实现）应与 buildProjects 内部结论一致（独立交叉校验）',
  )
  assert.deepEqual(fromHelper.map((s) => s.sessionId).sort(), ['d', 'e'], '真正未分组的只有 d 与 e')
})

// ---------------------------------------------------------------------------
// D-2 回归
// ---------------------------------------------------------------------------

test('D-2 回归: worktree 已删（exists:false）但工作区仍注册 ⇒ 会话进 history，且该节点 sessions 为空', () => {
  const featPath = `${MAIN_PATH}-feat`
  const out = buildProjects(
    input({
      // 工作区注册记录还在（D18 清扫要等下一次 /tree，也可能失败）—— 这正是 bug 的触发条件。
      workspaces: [workspace('W-feat', featPath, 'feat')],
      repos: twoWorktreeRepo({ featureExists: false }),
      repoByWorkspacePath: { [featPath]: REPO_KEY },
      sessions: [session('s-stuck', featPath)],
    }),
  )

  const [projectNode] = out.projects
  const featNode = projectNode.worktrees.find((node) => node.path === featPath)

  assert.equal(featNode.exists, false, '前置条件：该 worktree 节点应标记为已删除')
  assert.deepEqual(
    featNode.sessions,
    [],
    'D-2 核心不变量：已删 worktree 节点的 sessions 必须为空（不得被永久扣在死节点上）',
  )
  assert.deepEqual(
    projectNode.history.map((s) => s.sessionId),
    ['s-stuck'],
    'D-2 核心不变量：会话必须进入该项目的 history 桶（T1 自述的不变量）',
  )
  assert.deepEqual(out.ungrouped, [], '既不该扣在死节点，也不该掉进未分组')
})

test('D-2 回归: 「工作区已注册」不等于「路径还活着」—— 传了 liveWorkspacePaths 也不改变结论', () => {
  const featPath = `${MAIN_PATH}-feat`
  const inp = input({
    workspaces: [workspace('W-feat', featPath, 'feat')],
    repos: twoWorktreeRepo({ featureExists: false }),
    repoByWorkspacePath: { [featPath]: REPO_KEY },
    sessions: [session('s-stuck', featPath)],
    liveWorkspacePaths: new Set([MAIN_PATH]), // 明确告知：featPath 已死
  })

  const out = buildProjects(inp)
  const [projectNode] = out.projects
  assert.equal(
    projectNode.worktrees.find((node) => node.path === featPath).sessions.length,
    0,
    'liveWorkspacePaths 下死 worktree 仍不得挂会话',
  )
  assert.deepEqual(projectNode.history.map((s) => s.sessionId), ['s-stuck'], '仍应进 history 桶')
})

test('D-2 回归: 已删的非 git 工作区（liveWorkspacePaths 不含它）⇒ 会话降级为未分组而非挂在死项目上', () => {
  const deadDir = '/Users/x/Documents'
  const inp = input({
    workspaces: [workspace('W-docs', deadDir, 'Documents')],
    repos: {},
    repoByWorkspacePath: {},
    sessions: [session('s-dead', deadDir)],
    liveWorkspacePaths: new Set(),
  })

  const out = buildProjects(inp)
  assert.equal(out.projects.length, 1, '项目节点仍产出（供 UI 显示）')
  assert.deepEqual(out.projects[0].flatSessions, [], '已死的非 git 工作区不应再平铺会话')
  assert.deepEqual(out.ungrouped.map((s) => s.sessionId), ['s-dead'], '应降级为未分组，由侧栏底部如实展示')
})

// ---------------------------------------------------------------------------
// 归档 / 排序 / 非 git
// ---------------------------------------------------------------------------

test('归档会话被排除：不进任何容器、也不进未分组', () => {
  const out = buildProjects(
    input({
      repos: twoWorktreeRepo(),
      sessions: [
        session('keep', MAIN_PATH),
        session('archived', MAIN_PATH),
        session('archived-orphan', '/zzz/unknown'),
      ],
      archivedSessionIds: ['archived', 'archived-orphan'],
    }),
  )

  const placed = out.projects.flatMap(sessionsOf).map((s) => s.sessionId)
  assert.deepEqual(placed, ['keep'], '归档会话不应出现在任何容器里')
  assert.deepEqual(out.ungrouped, [], '归档会话也不应进未分组')
})

test('worktree 排序：主树在前，其余按 branch 字典序', () => {
  const out = buildProjects(
    input({
      repos: {
        [REPO_KEY]: repo([
          worktree(`${MAIN_PATH}-zeta`, { branch: 'zeta' }),
          worktree(MAIN_PATH, { isMain: true, branch: 'main' }),
          worktree(`${MAIN_PATH}-alpha`, { branch: 'alpha' }),
          worktree(`${MAIN_PATH}-mid`, { branch: 'feature/ohos' }),
        ]),
      },
    }),
  )

  assert.deepEqual(
    out.projects[0].worktrees.map((node) => node.branch),
    ['main', 'alpha', 'feature/ohos', 'zeta'],
    '主树强制第一（即使分支名字典序不在最前），其余按 branch localeCompare',
  )
})

test('worktree 排序：branch 缺失（detached）时用路径回退，结果仍确定', () => {
  const out = buildProjects(
    input({
      repos: {
        [REPO_KEY]: repo([
          worktree(`${MAIN_PATH}-b`, {}),
          worktree(MAIN_PATH, { isMain: true, branch: 'main' }),
          worktree(`${MAIN_PATH}-a`, {}),
        ]),
      },
    }),
  )

  assert.deepEqual(
    out.projects[0].worktrees.map((node) => node.path),
    [MAIN_PATH, `${MAIN_PATH}-a`, `${MAIN_PATH}-b`],
    'detached 条目按路径升序回退，保证输出与遍历顺序无关',
  )
})

test('会话排序：updatedAt 降序 + sessionId 升序 tiebreak', () => {
  const out = buildProjects(
    input({
      repos: twoWorktreeRepo(),
      sessions: [
        session('b-old', MAIN_PATH, { updatedAt: 10 }),
        session('z-new', MAIN_PATH, { updatedAt: 30 }),
        session('a-new', MAIN_PATH, { updatedAt: 30 }),
        session('m-tie', MAIN_PATH, { updatedAt: 10 }),
      ],
    }),
  )

  assert.deepEqual(
    out.projects[0].worktrees[0].sessions.map((s) => s.sessionId),
    ['a-new', 'z-new', 'b-old', 'm-tie'],
    'updatedAt 30 的两条按 sessionId 升序（a < z）；updatedAt 10 的两条同理（b < m）',
  )
})

test('会话排序：history 与 flatSessions 使用同一套排序规则', () => {
  const out = buildProjects(
    input({
      repos: twoWorktreeRepo(),
      sessions: [
        session('h-b', `${MAIN_PATH}-toolbar-refactor`, { updatedAt: 5 }),
        session('h-a', `${MAIN_PATH}-other-refactor`, { updatedAt: 5 }),
      ],
    }),
  )

  assert.deepEqual(
    out.projects[0].history.map((s) => s.sessionId),
    ['h-a', 'h-b'],
    'history 桶同样按 updatedAt 降序 + sessionId 升序',
  )
})

test('非 git 工作区：会话进 flatSessions，worktrees 为空数组', () => {
  const out = buildProjects(
    input({
      workspaces: [workspace('W-docs', '/Users/x/Documents', 'Documents')],
      repos: {},
      repoByWorkspacePath: {},
      sessions: [
        session('d2', '/Users/x/Documents', { updatedAt: 20 }),
        session('d1', '/Users/x/Documents', { updatedAt: 10 }),
      ],
    }),
  )

  assert.equal(out.projects.length, 1, '非 git 工作区产出 1 个项目节点')
  const [projectNode] = out.projects
  assert.equal(projectNode.key, 'ws:W-docs', '非 git 项目键为 ws:<workspaceId>')
  assert.equal(projectNode.isGit, false, 'isGit 应为 false')
  assert.equal(projectNode.title, 'Documents', '尊重工作区标题')
  assert.deepEqual(projectNode.worktrees, [], '非 git 工作区 worktrees 必须是空数组（不是 undefined）')
  assert.deepEqual(projectNode.history, [], '非 git 工作区没有 history 归位语义')
  assert.deepEqual(
    projectNode.flatSessions.map((s) => s.sessionId),
    ['d2', 'd1'],
    '会话按 updatedAt 降序平铺在 flatSessions',
  )
  assert.deepEqual(out.ungrouped, [], '不应进未分组')
})

test('非 git 工作区：未命名时项目标题回退目录 basename', () => {
  const out = buildProjects(
    input({
      workspaces: [workspace('W-docs', '/Users/x/Documents', '')],
      sessions: [session('d1', '/Users/x/Documents')],
    }),
  )

  assert.equal(out.projects[0].title, 'Documents', 'title 为空串 ⇒ 回退 basename(workspace.path)')
})

test('项目顺序：保持 workspaces 传入顺序，再补上扫描到但无工作区的仓', () => {
  const otherKey = '/x/y/Other/.git'
  const out = buildProjects(
    input({
      workspaces: [
        workspace('W-docs', '/Users/x/Documents', 'Documents'),
        workspace('W-main', MAIN_PATH, 'LogAnalyst'),
      ],
      repos: {
        [otherKey]: repo([worktree('/x/y/Other', { isMain: true, branch: 'main' })], '/x/y/Other', otherKey),
        ...twoWorktreeRepo(),
      },
      repoByWorkspacePath: { [MAIN_PATH]: REPO_KEY },
      sessions: [session('s', MAIN_PATH)],
    }),
  )

  assert.deepEqual(
    out.projects.map((projectNode) => projectNode.key),
    ['ws:W-docs', REPO_KEY, otherKey],
    '前两个按 workspaces 顺序；未注册工作区的仓按 commonDir 排序补在最后',
  )
})

test('项目标题：仓有多个工作区时不去猜，回退仓目录名', () => {
  const out = buildProjects(
    input({
      workspaces: [
        workspace('W-main', MAIN_PATH, 'LogAnalyst'),
        workspace('W-feat', `${MAIN_PATH}-feat`, 'My Feature'),
      ],
      repos: twoWorktreeRepo(),
      repoByWorkspacePath: { [MAIN_PATH]: REPO_KEY, [`${MAIN_PATH}-feat`]: REPO_KEY },
      sessions: [session('s', MAIN_PATH)],
    }),
  )

  assert.equal(out.projects[0].title, 'LogAnalyst', '多个命名工作区 ⇒ 用 basename(mainPath)，避免武断取其一')
})

// ---------------------------------------------------------------------------
// 不变量：无丢失 / 无重复
// ---------------------------------------------------------------------------

test('不变量「无丢失」: 去归档后的输入会话数 === 各容器之和（worktrees + history + flat + ungrouped）', () => {
  const inp = input({
    workspaces: [
      workspace('W-main', MAIN_PATH, 'LogAnalyst'),
      workspace('W-docs', '/Users/x/Documents', 'Documents'),
    ],
    repos: twoWorktreeRepo(),
    repoByWorkspacePath: { [MAIN_PATH]: REPO_KEY },
    sessions: [
      session('a', MAIN_PATH),
      session('b', `${MAIN_PATH}-feat`),
      session('c', `${MAIN_PATH}-toolbar-refactor`), // 规则 4 → history
      session('d', '/Users/x/Documents'), // 非 git 平铺
      session('e', '/zzz/unknown'), // 规则 5 → 未分组
      session('f', undefined), // 无 cwd → 未分组
      session('g', MAIN_PATH, { updatedAt: 999 }),
      session('archived', MAIN_PATH), // 归档，不参与统计
    ],
    archivedSessionIds: ['archived'],
  })

  const out = buildProjects(inp)
  const placed = out.projects.flatMap(sessionsOf)
  const inputCount = inp.sessions.length - inp.archivedSessionIds.length

  assert.equal(
    placed.length + out.ungrouped.length,
    inputCount,
    `无丢失：输入 ${inputCount} 条（去归档）应等于容器总数，实际容器 ${placed.length} + 未分组 ${out.ungrouped.length}`,
  )
  assert.deepEqual(
    [...placed, ...out.ungrouped].map((s) => s.sessionId).sort(),
    ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
    '全部非归档会话都应出现在某个容器里',
  )
})

test('不变量「无重复」: 同一 sessionId 不会出现在两个容器', () => {
  const inp = input({
    workspaces: [workspace('W-main', MAIN_PATH, 'LogAnalyst')],
    repos: twoWorktreeRepo(),
    repoByWorkspacePath: { [MAIN_PATH]: REPO_KEY },
    sessions: [
      session('a', MAIN_PATH),
      session('b', `${MAIN_PATH}-feat`),
      session('c', `${MAIN_PATH}-toolbar-refactor`),
      session('d', '/zzz/unknown'),
      session('e', undefined),
    ],
  })

  const out = buildProjects(inp)
  const buckets = [
    ...out.projects.flatMap((projectNode) =>
      projectNode.worktrees.map((node) => [`wt:${node.path}`, node.sessions.map((s) => s.sessionId)]),
    ),
    ...out.projects.map((projectNode) => [`history:${projectNode.key}`, projectNode.history.map((s) => s.sessionId)]),
    ...out.projects.map((projectNode) => [`flat:${projectNode.key}`, projectNode.flatSessions.map((s) => s.sessionId)]),
    ['ungrouped', out.ungrouped.map((s) => s.sessionId)],
  ]

  const owners = new Map()
  const duplicates = []
  for (const [bucket, ids] of buckets) {
    for (const id of ids) {
      if (owners.has(id)) duplicates.push(`${id} 同时出现在 ${owners.get(id)} 与 ${bucket}`)
      else owners.set(id, bucket)
    }
  }

  assert.deepEqual(duplicates, [], '同一 sessionId 不得出现在两个容器')
  assert.equal(owners.size, 5, '5 条非归档会话应各有恰好一个归属')
})

test('不变量: 多 worktree 项目也照常产出满员 worktrees 数组（宿主不做 D11 裁剪）', () => {
  const out = buildProjects(
    input({
      repos: {
        [REPO_KEY]: repo([
          worktree(MAIN_PATH, { isMain: true, branch: 'main' }),
          worktree(`${MAIN_PATH}-feat`, { branch: 'feat' }),
          worktree(`${MAIN_PATH}-empty`, { branch: 'empty' }),
        ]),
      },
      sessions: [session('s', MAIN_PATH)],
    }),
  )

  assert.equal(
    out.projects[0].worktrees.length,
    3,
    '宿主不过滤 worktree（含零会话的），是否渲染子行由客户端按 worktrees.length > 1 决定',
  )
})

test('不变量: 单 worktree 的 git 项目仍产出 worktrees[1]（会话挂在其下，非 flatSessions）', () => {
  const out = buildProjects(
    input({
      repos: { [REPO_KEY]: repo([worktree(MAIN_PATH, { isMain: true, branch: 'main' })]) },
      sessions: [session('s', MAIN_PATH)],
    }),
  )

  const [projectNode] = out.projects
  assert.equal(projectNode.worktrees.length, 1, '单 worktree 项目仍有 1 个 worktree 节点')
  assert.deepEqual(projectNode.worktrees[0].sessions.map((s) => s.sessionId), ['s'], '会话挂在 worktree 下')
  assert.deepEqual(projectNode.flatSessions, [], 'git 项目不使用 flatSessions（契约 §2.6 裁定 4）')
})

test('不变量: 子目录工作区的 workspaceId 不覆盖 worktree 根自己的精确匹配', () => {
  const subdir = `${MAIN_PATH}/android/BatteryCam`
  const out = buildProjects(
    input({
      workspaces: [
        workspace('W-sub', subdir, 'BatteryCam'),
        workspace('W-main', MAIN_PATH, 'LogAnalyst'),
      ],
      repos: twoWorktreeRepo(),
      repoByWorkspacePath: { [subdir]: REPO_KEY, [MAIN_PATH]: REPO_KEY },
      sessions: [session('s', MAIN_PATH)],
    }),
  )

  assert.equal(
    out.projects[0].worktrees[0].workspaceId,
    'W-main',
    'worktree 根的精确匹配优先于子目录工作区的“只填空缺”策略',
  )
})

test('不变量: 同一份输入两次调用结果一致（确定性与无隐藏状态）', () => {
  const build = () =>
    input({
      workspaces: [workspace('W-main', MAIN_PATH, 'LogAnalyst')],
      repos: twoWorktreeRepo(),
      repoByWorkspacePath: { [MAIN_PATH]: REPO_KEY },
      sessions: [
        session('a', MAIN_PATH, { updatedAt: 5 }),
        session('b', MAIN_PATH, { updatedAt: 5 }),
        session('c', `${MAIN_PATH}-toolbar-refactor`),
      ],
    })

  assert.deepEqual(buildProjects(build()), buildProjects(build()), '两次调用必须逐字段相同')
})

test('不变量: buildProjects 不修改入参数组（纯函数）', () => {
  const sessions = [
    session('b', MAIN_PATH, { updatedAt: 5 }),
    session('a', MAIN_PATH, { updatedAt: 5 }),
    session('c', '/zzz/unknown'),
  ]
  const worktrees = [
    worktree(`${MAIN_PATH}-feat`, { branch: 'feat' }),
    worktree(MAIN_PATH, { isMain: true, branch: 'main' }),
  ]
  const inp = input({
    repos: { [REPO_KEY]: repo(worktrees) },
    sessions,
    archivedSessionIds: ['nonexistent'],
  })
  const snapshots = {
    sessions: JSON.stringify(sessions),
    worktrees: JSON.stringify(worktrees),
    archived: JSON.stringify(inp.archivedSessionIds),
  }

  buildProjects(inp)
  collectUngrouped(inp, [])

  assert.equal(JSON.stringify(sessions), snapshots.sessions, 'sessions 数组不应被就地排序/改动')
  assert.equal(JSON.stringify(worktrees), snapshots.worktrees, 'repos 里的 worktrees 数组不应被就地排序')
  assert.equal(JSON.stringify(inp.archivedSessionIds), snapshots.archived, 'archivedSessionIds 不应被改动')
  assert.deepEqual(
    Object.keys(inp.repos),
    [REPO_KEY],
    'repos 表本身不应被增删键',
  )
})

test('边界: 空输入 ⇒ 两个空结果，不抛错', () => {
  const out = buildProjects(input())

  assert.deepEqual(out.projects, [], '无工作区、无仓 ⇒ 无项目节点')
  assert.deepEqual(out.ungrouped, [], '无会话 ⇒ 无未分组')
})
