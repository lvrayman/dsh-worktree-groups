/**
 * T6 单测：`src/tree-model.ts`（契约 `docs/INTERFACES.md` §2.2 / §2.6 / §4）。
 *
 * 纯逻辑，无 IO。覆盖 `truncateSessions` / `nestSubagents` /
 * `indexRunningSubagentDescendants` / `buildRows` 的截断（**T13 起无「当前会话保底」**）、
 * blank 语义、**子代理不渲染 + 运行中计数**、`expandedAll` 三态、折叠、搜索、归档、实体门控
 * （零会话 worktree）、D-1/D-4 回归与纯函数性。
 *
 * 另覆盖 **D10 手动排序（2026-09-21 用户决策变更）**：`applyManualOrder` 的纯函数语义、
 * `reorderKeys` 的上下半插入、`effectiveOrder` 的三层完整顺序、以及 `buildRows` 上
 * 「手动顺序先于 5 条截断生效」的集成断言。
 *
 * ⚠️ **`.tsx` 接线不在本文件覆盖范围**：`src/sidebar.tsx` 不进 `lib/`，`node --test`
 * 无法执行它 ⇒ 其 T11 拖拽接线由 **`test/sidebar-wiring.test.mjs`**（源码级契约测试，
 * T13 新增）锁定。本文件里的「接线同源」用例只覆盖**纯函数层**的同源性。
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  applyManualOrder,
  buildRecentRows,
  buildRows,
  COLLAPSED_SESSION_LIMIT,
  containerKeyOfSession,
  effectiveOrder,
  indexRunningSubagentDescendants,
  initialTopZoneState,
  insertSessionAtFront,
  isCurrentBlankSession,
  isSessionDragLocked,
  isTopZoneRunningSession,
  markNewSessionsWritten,
  nestSubagents,
  observationsOf,
  observeTopZone,
  pendingNewSessionIdsOf,
  placementOfSession,
  planNewSessionInserts,
  RECENT_KEY,
  RECENT_SESSION_LIMIT,
  recentActivityOf,
  reconcileManualOrder,
  reorderManualScope,
  reorderKeys,
  topZoneInputOf,
  topZoneSessionKeys,
  truncateSessions,
  UNGROUPED_KEY,
  workspaceIdFromProjectKey,
} from '../lib/tree-model.js'

/** 极简取词：返回 key（带 vars 时拼上，便于断言取词入参）。 */
const t = (key, vars) => (vars === undefined ? key : `${key}${JSON.stringify(vars)}`)

/** 造一条会话行。 */
function session(id, overrides = {}) {
  return { sessionId: id, updatedAt: 1000, running: false, blank: false, ...overrides }
}

/** 造 n 条普通会话，标题/更新时间递增。 */
function sessions(n, idPrefix = 's') {
  return Array.from({ length: n }, (_, i) =>
    session(`${idPrefix}${i}`, { updatedAt: 1000 + i, title: `T${i}` }),
  )
}

/** 造一个 worktree 节点。 */
function worktree(path, { branch, isMain = false, exists = true, sessions: list = [], workspaceId } = {}) {
  const node = {
    path,
    branch: branch ?? path,
    isMain,
    exists,
    title: branch ?? path,
    sessions: list,
  }
  return workspaceId === undefined ? node : { ...node, workspaceId }
}

/** 造一个项目节点。 */
function project(overrides = {}) {
  return {
    key: overrides.key ?? '/repo/.git',
    isGit: overrides.isGit ?? true,
    title: overrides.title ?? 'Repo',
    mainPath: overrides.mainPath ?? '/repo',
    worktrees: overrides.worktrees ?? [],
    history: overrides.history ?? [],
    flatSessions: overrides.flatSessions ?? [],
  }
}

/** `buildRows` 入参默认值 + 覆盖。 */
function input(overrides = {}) {
  return {
    projects: [],
    ungrouped: [],
    archivedSessionIds: [],
    collapsedKeys: {},
    expandedAllKeys: {},
    query: '',
    titleOf: (s) => s.title,
    t,
    ...overrides,
  }
}

/** 行序列摘要，便于断言失败时一眼看出期望 vs 实际。 */
const shape = (rows) => rows.map((row) => `${row.kind}:${row.key}`)

// ---------------------------------------------------------------------------
// truncateSessions
// ---------------------------------------------------------------------------

test('truncateSessions: 8 条普通会话 ⇒ visible 5 条、hiddenCount 3', () => {
  const list = sessions(8)
  const { visible, hiddenCount } = truncateSessions(list, COLLAPSED_SESSION_LIMIT)

  assert.equal(visible.length, 5, '普通会话上限 5 条')
  assert.equal(hiddenCount, 3, '8 条里隐藏 3 条')
  assert.deepEqual(
    visible.map((s) => s.sessionId),
    ['s0', 's1', 's2', 's3', 's4'],
    '不传 currentSessionId 时保留输入顺序的前 5 条',
  )
})

test('truncateSessions: 8 条普通会话 ⇒ 第 3 参**不再存在**（T13 已删除保底参数）', () => {
  // T13（2026-09-22 用户终裁）：`promote`（当前会话保底进前 limit 条）已**整体删除**，
  // 函数签名同步收窄为 `(sessions, limit)`。本用例锁定该契约收窄 —— 任何人把第 3 个
  // 「当前会话」参数加回来（无论是否实现保底）都会立刻红。
  assert.equal(truncateSessions.length, 2, '★ 形参个数恒为 2（无 currentSessionId 兼容位）')
  const list = sessions(8)
  const { visible, hiddenCount } = truncateSessions(list, COLLAPSED_SESSION_LIMIT)

  assert.equal(visible.length, 5, '可见仍为 5 条')
  assert.deepEqual(
    visible.map((s) => s.sessionId),
    ['s0', 's1', 's2', 's3', 's4'],
    '★ 逐字取输入顺序前 5 条（没有任何「当前会话」保底）',
  )
  assert.equal(hiddenCount, 3, '可见仍为 5 条 ⇒ 隐藏 3 条')
})

test('truncateSessions: 当前会话的 id 出现在输入里也不改变任何顺序（T13 无保底）', () => {
  // 旧实现里「当前会话在输入里且排在 5 条之外」会触发 `promote` ⇒ 挤掉第 5 位。
  // T13 删除该规则 ⇒ 无论当前会话排在哪，输出**逐字**是输入顺序的前 5 条。
  const list = [...sessions(8), session('cur', { updatedAt: 1 })]
  const { visible } = truncateSessions(list, COLLAPSED_SESSION_LIMIT)

  assert.deepEqual(
    visible.map((s) => s.sessionId),
    ['s0', 's1', 's2', 's3', 's4'],
    '★ 当前会话（第 9 位）**不**被拉进可见区',
  )
})

test('truncateSessions: 当前会话本就在前 5 条内 ⇒ 顺序不变（T13 下与普通输入逐字一致）', () => {
  const list = sessions(8)
  const { visible } = truncateSessions(list, COLLAPSED_SESSION_LIMIT)

  assert.deepEqual(
    visible.map((s) => s.sessionId),
    ['s0', 's1', 's2', 's3', 's4'],
    '当前会话已在可见集里 ⇒ 保持原生前 5 条',
  )
})

test('truncateSessions: blank 不占名额（3 blank + 8 普通 ⇒ 普通恰好 5 条）', () => {
  const list = [
    ...Array.from({ length: 3 }, (_, i) => session(`b${i}`, { blank: true })),
    ...sessions(8),
  ]
  const { visible, hiddenCount } = truncateSessions(list, COLLAPSED_SESSION_LIMIT)

  assert.equal(visible.filter((s) => s.blank).length, 3, 'blank 会话全部保留')
  assert.equal(visible.filter((s) => !s.blank).length, 5, '普通会话恰好 5 条（blank 不吃名额）')
  assert.equal(visible.length, 8, '3 blank + 5 普通 = 8 条可见')
  assert.equal(hiddenCount, 3, '12 条输入里隐藏 3 条普通会话')
})

test('truncateSessions: limit <= 0 的边界行为（只留 blank）', () => {
  const list = [
    ...Array.from({ length: 2 }, (_, i) => session(`b${i}`, { blank: true })),
    ...sessions(8),
  ]

  const zero = truncateSessions(list, 0)
  assert.deepEqual(zero.visible.map((s) => s.sessionId), ['b0', 'b1'], 'limit=0 ⇒ 只剩 blank 会话')
  assert.equal(zero.hiddenCount, 8, 'limit=0 时 8 条普通会话全部隐藏')

  const negative = truncateSessions(list, -3)
  assert.deepEqual(negative.visible.map((s) => s.sessionId), ['b0', 'b1'], 'limit<0 按 0 处理')
  assert.equal(negative.hiddenCount, 8, 'limit<0 的 hiddenCount 与 limit=0 一致')

  const nan = truncateSessions(list, Number.NaN)
  assert.deepEqual(nan.visible.map((s) => s.sessionId), ['b0', 'b1'], '非有限 limit 按 0 处理')
})

test('truncateSessions: blank 会话始终保留，且不改变普通会话配额（T13 无 currentSessionId）', () => {
  const list = [
    ...Array.from({ length: 2 }, (_, i) => session(`b${i}`, { blank: true })),
    ...sessions(8),
  ]
  const { visible } = truncateSessions(list, 3)

  assert.deepEqual(
    visible.map((s) => s.sessionId),
    ['b0', 'b1', 's0', 's1', 's2'],
    'blank 不受 limit 约束；普通会话取前 3 条',
  )
})

test('truncateSessions: 不修改入参数组（纯函数）', () => {
  const list = sessions(8)
  const snapshot = list.map((s) => s.sessionId)

  truncateSessions(list, COLLAPSED_SESSION_LIMIT)

  assert.deepEqual(list.map((s) => s.sessionId), snapshot, '输入顺序不应被就地改动')
  assert.equal(list.length, 8, '输入数组长度不应变化')
})

// ---------------------------------------------------------------------------
// nestSubagents
// ---------------------------------------------------------------------------

test('nestSubagents: 父在组内 ⇒ 子 depth 1', () => {
  const list = [session('parent'), session('child', { parentSessionId: 'parent', origin: 'subagent' })]
  const nested = nestSubagents(list)

  assert.deepEqual(
    nested.map((e) => [e.session.sessionId, e.depth]),
    [['parent', 0], ['child', 1]],
    '父 depth 0、直接子代理 depth 1',
  )
})

test('nestSubagents: 父不在组内 ⇒ 子平铺 depth 0', () => {
  const list = [session('orphan', { parentSessionId: 'not-in-group', origin: 'subagent' })]
  const nested = nestSubagents(list)

  assert.deepEqual(
    nested.map((e) => [e.session.sessionId, e.depth]),
    [['orphan', 0]],
    '悬挂子代理应平铺为顶层（不丢行）',
  )
})

test('nestSubagents: session- 前缀双向匹配（父带前缀 / 子带前缀都成立）', () => {
  const childHasPrefix = nestSubagents([
    session('parent'),
    session('session-child', { parentSessionId: 'parent', origin: 'subagent' }),
  ])
  assert.deepEqual(
    childHasPrefix.map((e) => [e.session.sessionId, e.depth]),
    [['parent', 0], ['session-child', 1]],
    '子 id 带 session- 前缀、父 id 不带 ⇒ 仍应匹配',
  )

  const parentHasPrefix = nestSubagents([
    session('session-parent'),
    session('child', { parentSessionId: 'parent', origin: 'subagent' }),
  ])
  assert.deepEqual(
    parentHasPrefix.map((e) => [e.session.sessionId, e.depth]),
    [['session-parent', 0], ['child', 1]],
    '父 id 带 session- 前缀、子 id 不带 ⇒ 仍应匹配',
  )

  const bothHavePrefix = nestSubagents([
    session('session-parent'),
    session('session-child', { parentSessionId: 'session-parent', origin: 'subagent' }),
  ])
  assert.deepEqual(
    bothHavePrefix.map((e) => [e.session.sessionId, e.depth]),
    [['session-parent', 0], ['session-child', 1]],
    '两侧都带前缀 ⇒ 匹配',
  )
})

test('nestSubagents: 父自己是子代理 ⇒ 孙平铺为 depth 0', () => {
  const list = [
    session('a'),
    session('b', { parentSessionId: 'a', origin: 'subagent' }),
    session('c', { parentSessionId: 'b', origin: 'subagent' }),
  ]
  const nested = nestSubagents(list)

  assert.deepEqual(
    nested.map((e) => [e.session.sessionId, e.depth]),
    [['a', 0], ['b', 1], ['c', 0]],
    '只支持一层嵌套：祖父 c 平铺（契约「父子代理 ⇒ 孙平铺」）',
  )
})

test('nestSubagents: 自指 / 环不抛错、不丢行', () => {
  const selfRef = nestSubagents([session('x', { parentSessionId: 'x', origin: 'subagent' })])
  assert.deepEqual(selfRef.map((e) => [e.session.sessionId, e.depth]), [['x', 0]], '自指应平铺')

  const cycle = nestSubagents([
    session('a', { parentSessionId: 'b', origin: 'subagent' }),
    session('b', { parentSessionId: 'a', origin: 'subagent' }),
  ])
  assert.deepEqual(
    cycle.map((e) => e.session.sessionId).sort(),
    ['a', 'b'],
    '环上成员全部保留（软失败，不丢行）',
  )
  assert.ok(
    cycle.every((e) => e.depth === 0 || e.depth === 1),
    `环上成员深度只能是 0/1，实际：${cycle.map((e) => e.depth).join(',')}`,
  )
})

test('nestSubagents: 子代理紧跟父之后，子代理之间保持输入顺序', () => {
  const list = [
    session('p1'),
    session('c1', { parentSessionId: 'p1' }),
    session('c2', { parentSessionId: 'p1' }),
    session('p2'),
    session('c3', { parentSessionId: 'p2' }),
  ]
  const nested = nestSubagents(list)

  assert.deepEqual(
    nested.map((e) => e.session.sessionId),
    ['p1', 'c1', 'c2', 'p2', 'c3'],
    '输出顺序：父后紧跟其子，子之间保持输入顺序',
  )
})

test('nestSubagents: 不修改入参数组', () => {
  const list = [session('b'), session('a', { parentSessionId: 'b' })]
  const snapshot = JSON.stringify(list)

  nestSubagents(list)

  assert.equal(JSON.stringify(list), snapshot, '输入数组不应被就地改动')
})

// ---------------------------------------------------------------------------
// buildRows —— expandedAll 三态（核心回归）
// ---------------------------------------------------------------------------

/**
 * 单 worktree 的 git 项目（D11 2026-09-21 修订后**也产生 worktree 子行**；
 * 会话挂在 `w:/repo` 容器下，depth 2，`parentKind: 'worktree'`）。
 */
function singleWorktreeProject(list, overrides = {}) {
  return project({
    worktrees: [worktree('/repo', { branch: 'main', isMain: true, sessions: list })],
    ...overrides,
  })
}

const PROJECT_KEY = 'p:/repo/.git'
/** 单 worktree 项目的 worktree 容器 key（会话的 parentKey）。 */
const WORKTREE_KEY = 'w:/repo'

test('buildRows/expandedAll: 12 条会话 + expandedAllKeys 空 ⇒ 5 条 session 行 + 1 more 行，hiddenCount 7', () => {
  const rows = buildRows(input({ projects: [singleWorktreeProject(sessions(12))] }))

  const sessionRows = rows.filter((row) => row.kind === 'session')
  const moreRows = rows.filter((row) => row.kind === 'more')

  assert.equal(sessionRows.length, 5, `折叠态应只渲染 5 条会话行，实际：${shape(rows).join(' | ')}`)
  assert.equal(moreRows.length, 1, '折叠态应恰好 1 条 more 行')
  assert.equal(moreRows[0].hiddenCount, 7, '12 - 5 = 7 条被隐藏')
  assert.equal(moreRows[0].parentKey, WORKTREE_KEY, 'more 行应挂在所属容器 key 上')
  assert.equal(
    moreRows[0].parentKind,
    'worktree',
    'D11 修订：单 worktree 的 git 项目也走 worktree 容器（kind 为 worktree，不再是 project）',
  )
  assert.deepEqual(
    sessionRows.map((row) => row.sessionId),
    ['s11', 's10', 's9', 's8', 's7'],
    '会话按 updatedAt 降序取前 5 条',
  )
})

test('buildRows/expandedAll: 12 条会话 + 旧式 expandedAllKeys[容器 key]=true ⇒ 12 条 session 行 + 1 条只剩「收起」的 more 行', () => {
  const rows = buildRows(
    input({ projects: [singleWorktreeProject(sessions(12))], expandedAllKeys: { [WORKTREE_KEY]: true } }),
  )

  const sessionRows = rows.filter((row) => row.kind === 'session')
  const moreRows = rows.filter((row) => row.kind === 'more')

  assert.equal(sessionRows.length, 12, `全展开应渲染全部 12 条会话行，实际：${shape(rows).join(' | ')}`)
  assert.equal(moreRows.length, 1, '全展开时仍须产出恰好 1 条 more 行（它是「收起」的唯一入口，PRD US4）')
  // 2026-11-14 PX：hiddenCount 改为「当前仍未显示」的条数；旧式全展开 ⇒ 0、只剩收起。
  assert.equal(moreRows[0].hiddenCount, 0, '全部可见 ⇒ hiddenCount 为 0')
  assert.equal(moreRows[0].nextCount, 0)
  assert.equal(moreRows[0].canCollapse, true, '全部展开时 more 行只提供「收起」')
  assert.equal(moreRows[0].parentKey, WORKTREE_KEY, 'more 行 key 与容器同源')
  assert.equal(sessionRows[0].sessionId, 's11', '全展开同样按 updatedAt 降序')
  assert.equal(sessionRows[11].sessionId, 's0', '全展开应包含最旧的一条')
})

test('buildRows/expandedAll: 恰好 5 条 + expandedAllKeys=true ⇒ 不产生 more 行', () => {
  const rows = buildRows(
    input({ projects: [singleWorktreeProject(sessions(5))], expandedAllKeys: { [WORKTREE_KEY]: true } }),
  )

  assert.equal(rows.filter((row) => row.kind === 'session').length, 5, '5 条会话全部渲染')
  assert.equal(
    rows.filter((row) => row.kind === 'more').length,
    0,
    '恰好等于上限 ⇒ 没东西可折叠，即使 expandedAll=true 也不产生 more 行',
  )
})

test('buildRows/expandedAll: 3 条 + expandedAllKeys=true ⇒ 不产生 more 行', () => {
  const rows = buildRows(
    input({ projects: [singleWorktreeProject(sessions(3))], expandedAllKeys: { [WORKTREE_KEY]: true } }),
  )

  assert.equal(rows.filter((row) => row.kind === 'session').length, 3, '3 条会话全部渲染')
  assert.equal(rows.filter((row) => row.kind === 'more').length, 0, '少于上限 ⇒ 无 more 行')
})

test('buildRows/expandedAll: 4 条 / 5 条 / 6 条的上限边界（阈值正好是 COLLAPSED_SESSION_LIMIT）', () => {
  for (const count of [4, 5]) {
    const rows = buildRows(input({ projects: [singleWorktreeProject(sessions(count))] }))
    assert.equal(rows.filter((row) => row.kind === 'more').length, 0, `${count} 条 <= 上限 ⇒ 无 more 行`)
  }

  const six = buildRows(input({ projects: [singleWorktreeProject(sessions(6))] }))
  assert.equal(six.filter((row) => row.kind === 'session').length, 5, '6 条 ⇒ 折叠显示 5 条')
  const moreRows = six.filter((row) => row.kind === 'more')
  assert.equal(moreRows.length, 1, '6 条 > 上限 ⇒ 产生 1 条 more 行')
  assert.equal(moreRows[0].hiddenCount, 1, '6 - 5 = 1 条被隐藏')
})

test('buildRows/expandedAll: 多 worktree 项目的容器 key 是 w:<path>，展开互不串台', () => {
  const build = (expanded) =>
    project({
      worktrees: [
        worktree('/repo', { branch: 'main', isMain: true, sessions: sessions(12, 'a') }),
        worktree('/repo-feat', { branch: 'feat', sessions: sessions(12, 'b') }),
      ],
    })

  const collapsed = buildRows(input({ projects: [build()] }))
  assert.equal(collapsed.filter((row) => row.kind === 'session').length, 10, '两个容器各 5 条 ⇒ 共 10 条')

  const onlyFirst = buildRows(input({ projects: [build()], expandedAllKeys: { 'w:/repo': true } }))
  const firstSessions = onlyFirst.filter((row) => row.kind === 'session' && row.parentKey === 'w:/repo')
  const secondSessions = onlyFirst.filter((row) => row.kind === 'session' && row.parentKey === 'w:/repo-feat')
  assert.equal(firstSessions.length, 12, 'w:/repo 展开 ⇒ 该容器 12 条')
  assert.equal(secondSessions.length, 5, 'w:/repo-feat 未展开 ⇒ 仍 5 条')
  assert.deepEqual(
    onlyFirst.filter((row) => row.kind === 'more').map((row) => row.key),
    ['m:w:/repo', 'm:w:/repo-feat'],
    '两个容器各有一条 more 行（展开的那个是「收起」入口）',
  )
})

test('buildRows: more 行没有 label 字段（契约 §2.6 裁定 2，取词在渲染层）', () => {
  const rows = buildRows(input({ projects: [singleWorktreeProject(sessions(12))] }))
  const moreRow = rows.find((row) => row.kind === 'more')

  assert.equal(moreRow.hiddenCount, 7, '前置条件：确实是被截断的容器')
  assert.equal('label' in moreRow, false, 'more 行不得带 label 字段')
  assert.deepEqual(
    Object.keys(moreRow).sort(),
    ['canCollapse', 'depth', 'hiddenCount', 'key', 'kind', 'nextCount', 'parentKey', 'parentKind'],
    'more 行字段集应恰为契约的 8 个（2026-11-14 PX 新增 nextCount / canCollapse）',
  )
})

// ---------------------------------------------------------------------------
// D-1 回归：label 永远是 string
// ---------------------------------------------------------------------------

test('D-1 回归: titleOf 返回 undefined / null / "" / "   " 时，所有行的 label 都是 string', () => {
  for (const value of [undefined, null, '', '   ']) {
    const rows = buildRows(
      input({
        projects: [
          singleWorktreeProject(sessions(2), {
            history: [session('h1'), session('h2', { blank: true })],
            worktrees: [
              worktree('/repo', { branch: 'main', isMain: true, sessions: sessions(2) }),
              worktree('/repo-feat', { branch: 'feat', sessions: [session('w1')] }),
            ],
          }),
        ],
        ungrouped: [session('u1')],
        titleOf: () => value,
      }),
    )

    const labeled = rows.filter((row) => row.kind !== 'more')
    assert.ok(labeled.length > 0, '前置条件：应产出行（含 project / worktree / session）')

    for (const row of labeled) {
      assert.equal(
        typeof row.label,
        'string',
        `titleOf 返回 ${JSON.stringify(value)} 时，${row.kind} 行 label 应为 string，实际 ${typeof row.label}`,
      )
      assert.notEqual(row.label, '', `titleOf 返回 ${JSON.stringify(value)} 时 label 不应为空串`)
    }

    const sessionLabels = rows.filter((row) => row.kind === 'session').map((row) => row.label)
    assert.ok(
      sessionLabels.every((label) => label === 'session.new'),
      `titleOf 返回 ${JSON.stringify(value)} 时会话标题应回退 session.new，实际 ${JSON.stringify(sessionLabels)}`,
    )
  }
})

test('D-1 回归: titleOf 抛错以外的正常字符串（含前后空格）原样保留', () => {
  const rows = buildRows(
    input({
      projects: [singleWorktreeProject([session('a', { title: '  保留我  ' })])],
      titleOf: (s) => s.title,
    }),
  )
  const sessionRows = rows.filter((row) => row.kind === 'session')

  assert.equal(sessionRows.length, 1, '前置条件：1 条会话行')
  assert.equal(sessionRows[0].label, '  保留我  ', '非纯空白的字符串标题应原样保留（不 trim）')
})

// ---------------------------------------------------------------------------
// D-4 回归：history 容器门控
// ---------------------------------------------------------------------------

test('D-4 回归: history 只有 blank 且非当前会话 ⇒ 不产生 history 行', () => {
  const rows = buildRows(
    input({
      projects: [singleWorktreeProject(sessions(1), { history: [session('hb', { blank: true })] })],
    }),
  )

  assert.equal(
    rows.filter((row) => row.kind === 'history').length,
    0,
    `全是非当前 blank 的 history 不应建容器行，实际：${shape(rows).join(' | ')}`,
  )
  assert.equal(rows.filter((row) => row.kind === 'session').length, 1, '只应有 worktree 里那 1 条会话')
})

test('D-4 回归: history 只有 blank 但它是当前会话 ⇒ 产生 history 行', () => {
  const rows = buildRows(
    input({
      projects: [singleWorktreeProject(sessions(1), { history: [session('hb', { blank: true })] })],
      currentSessionId: 'hb',
    }),
  )

  const historyRows = rows.filter((row) => row.kind === 'history')
  assert.equal(historyRows.length, 1, '当前 blank 会话可见 ⇒ history 容器应存在')
  assert.equal(historyRows[0].sessionCount, 1, 'history 行 sessionCount = 1')
  assert.equal(historyRows[0].label, 'history.label', 'history 行 label 取词 history.label')
})

test('D-4 回归: history 1 普通 + 1 blank ⇒ 产生 history 行且 sessionCount === 1', () => {
  const rows = buildRows(
    input({
      projects: [
        singleWorktreeProject(sessions(1), {
          history: [session('h1', { updatedAt: 5 }), session('hb', { blank: true, updatedAt: 9 })],
        }),
      ],
    }),
  )

  const historyRows = rows.filter((row) => row.kind === 'history')
  assert.equal(historyRows.length, 1, '有 1 条可见普通会话 ⇒ history 容器存在')
  assert.equal(historyRows[0].sessionCount, 1, 'blank（非当前）不计入 sessionCount')

  const historySessions = rows.filter((row) => row.kind === 'session' && row.parentKind === 'history')
  assert.deepEqual(
    historySessions.map((row) => row.sessionId),
    ['h1'],
    'history 容器下只渲染那 1 条普通会话（blank 非当前不可见）',
  )
})

test('D-4 回归: history 全归档 ⇒ 不产生 history 行', () => {
  const rows = buildRows(
    input({
      projects: [singleWorktreeProject(sessions(1), { history: [session('h1'), session('h2')] })],
      archivedSessionIds: ['h1', 'h2'],
    }),
  )

  assert.equal(rows.filter((row) => row.kind === 'history').length, 0, '归档后 history 无可见成员 ⇒ 无容器行')
})

// ---------------------------------------------------------------------------
// 未分组容器
// ---------------------------------------------------------------------------

test('未分组同源: 未分组只有 blank 且非当前 ⇒ 不产生未分组行', () => {
  const rows = buildRows(input({ ungrouped: [session('ub', { blank: true })] }))

  assert.deepEqual(rows, [], '未分组只有非当前 blank ⇒ 一行都不该产生')
})

test('未分组同源: 未分组 1 普通 + 1 blank ⇒ 产生未分组行，sessionCount === 1', () => {
  const rows = buildRows(input({ ungrouped: [session('u1'), session('ub', { blank: true })] }))

  assert.deepEqual(shape(rows), [`project:p:${UNGROUPED_KEY}`, 'session:s:u1'], '未分组复用 project 行 + 1 条会话行')
  assert.equal(rows[0].sessionCount, 1, 'blank 不计入 sessionCount')
  assert.equal(rows[0].label, 'section.ungrouped', '未分组行 label 取词 section.ungrouped')
  assert.equal(rows[0].isGit, false, '未分组行不是 git 项目')
  assert.equal(rows[0].worktreeCount, 0, '未分组行没有 worktree 子行')
})

test('未分组同源: 未分组全部归档 ⇒ 不产生未分组行', () => {
  const rows = buildRows(input({ ungrouped: [session('u1')], archivedSessionIds: ['u1'] }))
  assert.deepEqual(rows, [], '归档后未分组无可见成员 ⇒ 无容器行')
})

// ---------------------------------------------------------------------------
// 实体门控（PRD US1）
// ---------------------------------------------------------------------------

test('实体门控: 零会话的 worktree ⇒ 仍然产生 worktree 行（PRD US1「未注册 worktree 也可见」）', () => {
  const rows = buildRows(
    input({
      projects: [
        project({
          worktrees: [
            worktree('/repo', { branch: 'main', isMain: true, sessions: [session('a')] }),
            worktree('/repo-empty', { branch: 'feature/empty', sessions: [] }),
          ],
        }),
      ],
    }),
  )

  const worktreeRows = rows.filter((row) => row.kind === 'worktree')
  assert.deepEqual(
    worktreeRows.map((row) => [row.path, row.sessionCount]),
    [['/repo', 1], ['/repo-empty', 0]],
    '零会话 worktree 仍须有行，且 sessionCount 为 0（实体门控不受会话数影响）',
  )
  assert.equal(worktreeRows[1].label, 'feature/empty', 'worktree 行 label 为分支名')
})

test('实体门控: 零会话 worktree 折叠态下也保留行，且不产生 more 行', () => {
  const rows = buildRows(
    input({
      projects: [
        project({
          worktrees: [
            worktree('/repo', { branch: 'main', isMain: true, sessions: [] }),
            worktree('/repo-empty', { branch: 'b', sessions: [] }),
          ],
        }),
      ],
    }),
  )

  assert.equal(rows.filter((row) => row.kind === 'worktree').length, 2, '两个空 worktree 都应有行')
  assert.equal(rows.filter((row) => row.kind === 'session').length, 0, '没有会话行')
  assert.equal(rows.filter((row) => row.kind === 'more').length, 0, '空容器不产生 more 行')
})

test('实体门控: 单 worktree 的 git 项目 ⇒ **产生** worktree 子行，会话挂 worktree 下 depth 2（D11 2026-09-21 修订）', () => {
  const rows = buildRows(input({ projects: [singleWorktreeProject(sessions(2))] }))

  assert.deepEqual(
    shape(rows),
    ['project:p:/repo/.git', 'worktree:w:/repo', 'session:s:s1', 'session:s:s0'],
    'D11 修订：单 worktree 的 git 项目也产生 1 条 worktree 子行（不再平铺）',
  )
  assert.equal(rows.filter((row) => row.kind === 'worktree').length, 1, '恰好 1 条 worktree 子行')
  assert.equal(rows[0].kind, 'project', '首行是 project 行')
  assert.equal(rows[0].worktreeCount, 1, 'worktreeCount = worktrees.length（单 worktree 也为 1）')
  assert.equal(rows[0].sessionCount, 2, 'project 行聚合该 worktree 的会话')

  const sessionRows = rows.filter((row) => row.kind === 'session')
  assert.deepEqual(
    sessionRows.map((row) => [row.depth, row.parentKind]),
    [[2, 'worktree'], [2, 'worktree']],
    '会话挂 worktree 行下，depth 2（与多 worktree 项目一致）',
  )
})

test('实体门控: 非 git 工作区 ⇒ 无 worktree 行，会话取 flatSessions', () => {
  const rows = buildRows(
    input({
      projects: [
        project({
          key: 'ws:W1',
          isGit: false,
          title: 'Docs',
          mainPath: undefined,
          worktrees: [],
          flatSessions: [session('d1'), session('d2')],
        }),
      ],
    }),
  )

  assert.equal(rows.filter((row) => row.kind === 'worktree').length, 0, '非 git 项目无 worktree 子行')
  assert.equal(rows[0].sessionCount, 2, 'sessionCount 来自 flatSessions')
  assert.equal(rows[0].worktreeCount, 0, '非 git 工作区 worktreeCount 恒为 0（flat 容器只留给它）')
  assert.deepEqual(
    rows.filter((row) => row.kind === 'session').map((row) => row.sessionId),
    ['d1', 'd2'],
    'flatSessions 渲染顺序（updatedAt 同值时按 sessionId 升序；引用顺序无关）',
  )
})

test('实体门控: 单 worktree 的 git 项目 ⇒ worktree 行带 label/isMain，子行结构对齐多 worktree 项目', () => {
  const rows = buildRows(input({ projects: [singleWorktreeProject(sessions(1))] }))
  const worktreeRow = rows.find((row) => row.kind === 'worktree')

  assert.equal(worktreeRow.key, 'w:/repo', 'worktree 行 key 为 `w:<path>`')
  assert.equal(worktreeRow.label, 'main', 'label 为分支名')
  assert.equal(worktreeRow.sublabel, 'repo', '目录 basename 与 label 不同 ⇒ 给 sublabel')
  assert.equal(worktreeRow.isMain, true, '主树 isMain=true 透传')
  assert.equal(worktreeRow.depth, 1, 'worktree 行 depth 1')
  assert.equal(worktreeRow.sessionCount, 1, 'worktree 行统计其名下会话数')
})

test('实体门控: git 项目且 worktrees 为空（扫描降级）⇒ 不崩、无子行，flat 不接管（不吞 flatSessions）', () => {
  // 真实数据里 git 项目的 `worktrees` 不会为空（`scanRepo` 在拿不到列表时也会兜底出一条
  // 主树）。但契约上 `worktrees.length === 0` 是合法形状，必须不崩且不产生子行。
  const rows = buildRows(
    input({
      projects: [
        project({
          key: '/degraded/.git',
          isGit: true,
          title: 'Degraded',
          mainPath: '/degraded',
          worktrees: [],
          flatSessions: [session('x')],
        }),
      ],
    }),
  )

  assert.equal(rows.filter((row) => row.kind === 'worktree').length, 0, '没有 worktree 节点 ⇒ 没有子行')
  assert.equal(rows[0].worktreeCount, 0, 'worktreeCount = worktrees.length = 0')
  assert.equal(
    rows.filter((row) => row.kind === 'session').length,
    0,
    'git 项目不建 flat 容器 ⇒ 其 flatSessions 不渲染（真实数据里该字段对 git 项目恒为空）',
  )
})

// ---------------------------------------------------------------------------
// 折叠
// ---------------------------------------------------------------------------

test('折叠: collapsedKeys[worktree key]=true ⇒ 子行与 more 行消失，worktree 行仍在', () => {
  const rows = buildRows(
    input({
      projects: [
        project({
          worktrees: [
            worktree('/repo', { branch: 'main', isMain: true, sessions: [session('a1'), session('a2')] }),
            worktree('/repo-feat', { branch: 'feat', sessions: [session('b1'), session('b2')] }),
          ],
        }),
      ],
      collapsedKeys: { 'w:/repo': true },
    }),
  )

  assert.deepEqual(
    shape(rows),
    ['project:p:/repo/.git', 'worktree:w:/repo', 'worktree:w:/repo-feat', 'session:s:b1', 'session:s:b2'],
    '折叠的 worktree 只剩自身行，另一个 worktree 的会话照常渲染',
  )
  assert.equal(
    rows.filter((row) => row.kind === 'session' && row.parentKey === 'w:/repo').length,
    0,
    '被折叠的 worktree 不应有会话子行',
  )
  assert.equal(rows[1].expanded, false, '被折叠的 worktree 行 expanded 应为 false')
  assert.equal(rows[2].expanded, true, '未折叠的 worktree 行 expanded 应为 true')
  assert.equal(rows[1].sessionCount, 2, '折叠后计数仍是完整值（供渲染层显示）')
  assert.equal(rows[2].sessionCount, 2, '未折叠容器的计数同样正确')
})

test('折叠: collapsedKeys[project key]=true ⇒ 项目下所有子行消失，仅剩 project 行', () => {
  const rows = buildRows(
    input({
      projects: [
        project({
          worktrees: [
            worktree('/repo', { branch: 'main', isMain: true, sessions: [session('a')] }),
            worktree('/repo-feat', { branch: 'feat', sessions: [session('b')] }),
          ],
          history: [session('h')],
        }),
      ],
      collapsedKeys: { 'p:/repo/.git': true },
    }),
  )

  assert.deepEqual(shape(rows), ['project:p:/repo/.git'], '整棵项目树收起 ⇒ 只有 project 行')
  assert.equal(rows[0].expanded, false, 'project 行 expanded 为 false')
  assert.equal(rows[0].sessionCount, 3, '收起态仍显示 3 条顶层会话计数（2 worktree + 1 history）')
})

test('折叠: collapsedKeys[history key]=true ⇒ history 行在、子行消失', () => {
  const rows = buildRows(
    input({
      projects: [singleWorktreeProject(sessions(1), { history: [session('h1'), session('h2')] })],
      collapsedKeys: { 'h:/repo/.git': true },
    }),
  )

  const historyRows = rows.filter((row) => row.kind === 'history')
  assert.equal(historyRows.length, 1, '折叠的 history 行仍在')
  assert.equal(historyRows[0].expanded, false, 'history 行 expanded 为 false')
  assert.equal(historyRows[0].sessionCount, 2, '计数不受折叠影响')
  assert.deepEqual(
    rows.filter((row) => row.kind === 'session' && row.parentKind === 'history'),
    [],
    'history 折叠后其会话行应消失',
  )
})

// ---------------------------------------------------------------------------
// 搜索
// ---------------------------------------------------------------------------

test('搜索: query 非空 ⇒ 只返回 session 行、depth 0，且绕过折叠与截断', () => {
  const rows = buildRows(
    input({
      projects: [
        project({
          worktrees: [
            worktree('/repo', { branch: 'main', isMain: true, sessions: sessions(12, 'a') }),
            worktree('/repo-feat', { branch: 'feat', sessions: [session('needle', { title: 'needle-会话' })] }),
          ],
        }),
      ],
      collapsedKeys: { 'p:/repo/.git': true, 'w:/repo': true, 'w:/repo-feat': true },
      query: 'needle',
    }),
  )

  assert.deepEqual(
    rows.map((row) => [row.kind, row.sessionId, row.depth]),
    [['session', 'needle', 0]],
    '搜索输出应是扁平的会话行（depth 0），且无视 all-collapsed',
  )
  assert.equal(rows[0].parentKind, 'worktree', '仍保留真实归属（parentKind）供菜单定位')
  assert.equal(rows[0].parentKey, 'w:/repo-feat', '仍保留真实 parentKey')
})

test('搜索: 空串 / 纯空格 query 不走搜索路径（仍输出树）', () => {
  for (const query of ['', '   ']) {
    const rows = buildRows(input({ projects: [singleWorktreeProject(sessions(2))], query }))
    assert.deepEqual(
      shape(rows),
      ['project:p:/repo/.git', 'worktree:w:/repo', 'session:s:s1', 'session:s:s0'],
      `query=${JSON.stringify(query)} 应视为不过滤，输出完整树（单 worktree 项目也有 worktree 行）`,
    )
  }
})

test('搜索: 大小写不敏感，且命中 worktree 分支名 / 项目名 / cwd basename', () => {
  const proj = project({
    title: 'LogAnalyst',
    worktrees: [
      worktree('/repo', { branch: 'main', isMain: true, sessions: [session('a', { title: 'Alpha' })] }),
      worktree('/repo-ohos', { branch: 'feature/OHOS', sessions: [session('b', { title: 'BB' })] }),
    ],
  })

  const byBranch = buildRows(input({ projects: [proj], query: 'ohos' }))
  assert.deepEqual(byBranch.map((row) => row.sessionId), ['b'], '小写 query 应命中大写分支名（大小写不敏感）')

  const byProject = buildRows(input({ projects: [proj], query: 'loganalyst' }))
  assert.deepEqual(byProject.map((row) => row.sessionId).sort(), ['a', 'b'], '项目名命中 ⇒ 该项目下所有会话')

  const ungroupedHit = buildRows(input({ ungrouped: [session('u', { cwd: '/Users/x/MyProject' })], query: 'myproject' }))
  assert.deepEqual(ungroupedHit.map((row) => row.sessionId), ['u'], '未分组会话按 cwd basename 匹配')
})

test('搜索: 单 worktree 的 git 项目 —— 分支名 / 路径 basename / 项目名都可搜（D20；D11 修订后走 worktree 容器）', () => {
  // PRD D20 的搜索源包含「分支名」。**D11 2026-09-21 修订前**单 worktree 的 git 项目平铺
  // （会话落在 containers.flat 上），当时靠给 flat 容器挂 `worktree` 字段才让分支名可搜。
  // 修订后单 worktree 的 git 项目也走 worktree 子行（`container.worktree` 天然非空），
  // worktreeHaystacks 照常生效 —— 本用例锁定「分支名搜索不因这次改动回归」。
  // 三个 haystack 刻意取不同字面量，以分别证明 branch / path basename / project title 各自生效。
  const singleWt = project({
    key: '/repo/.git',
    title: 'LogAnalyst',
    worktrees: [
      {
        path: '/Users/dev/code/demo-box',
        branch: 'develop',
        isMain: true,
        exists: true,
        title: 'DemoBox 主工作区',
        sessions: [session('s1', { title: '修复登录' })],
      },
    ],
  })

  // 1) 分支名（偏差 A 的核心回归点）
  assert.deepEqual(
    buildRows(input({ projects: [singleWt], query: 'develop' })).map((row) => row.sessionId),
    ['s1'],
    '单 worktree 项目的分支名必须可搜（D20）',
  )

  // 2) 项目名 —— 不回归
  assert.deepEqual(
    buildRows(input({ projects: [singleWt], query: 'loganalyst' })).map((row) => row.sessionId),
    ['s1'],
    '项目名仍可搜（不回归）',
  )

  // 3) worktree 路径的 basename（'demo-box' 不出现在 branch/title/项目名里）
  assert.deepEqual(
    buildRows(input({ projects: [singleWt], query: 'demo-box' })).map((row) => row.sessionId),
    ['s1'],
    'worktree 路径 basename 可搜（不回归）',
  )

  // 4) 大小写不敏感
  assert.deepEqual(
    buildRows(input({ projects: [singleWt], query: 'DEVELOP' })).map((row) => row.sessionId),
    ['s1'],
    '大小写不敏感',
  )

  // 5) 会话标题 —— 不回归
  assert.deepEqual(
    buildRows(input({ projects: [singleWt], query: '修复' })).map((row) => row.sessionId),
    ['s1'],
    '会话标题仍可搜到',
  )

  // 6) 多 worktree 项目同一分支名仍可搜（不回归；该路径走 worktree 子行，本来就有 worktree）
  const multiWt = project({
    ...singleWt,
    worktrees: [
      ...singleWt.worktrees,
      worktree('/repo-ohos', { branch: 'feature/ohos', sessions: [session('s2')] }),
    ],
  })
  assert.deepEqual(
    buildRows(input({ projects: [multiWt], query: 'develop' })).map((row) => row.sessionId),
    ['s1'],
    '多 worktree 项目的分支名仍可搜到（不回归）',
  )
})

test('搜索: 非 git 工作区（0 个 worktree）不崩，且 worktree 为 undefined 的路径安全', () => {
  // 非 git 工作区**唯一**走 flat 容器（`Containers.flat`），该容器不带 `worktree` 字段
  // （非 git 工作区没有 worktree，也就没有分支名）。这里同时验证「不崩」与
  // 「项目名 / 会话标题照常可搜」。D11 2026-09-21 修订后 flat 容器**只**服务这一类项目。
  const nonGit = project({
    key: '/plain/.git',
    isGit: false,
    title: 'PlainRepo',
    worktrees: [],
    flatSessions: [session('f1', { title: 'plain 任务' })],
  })

  assert.deepEqual(
    buildRows(input({ projects: [nonGit], query: 'plainrepo' })).map((row) => row.sessionId),
    ['f1'],
    '非 git 工作区按项目名可搜（worktree 为 undefined 不崩）',
  )
  assert.deepEqual(
    buildRows(input({ projects: [nonGit], query: 'plain 任务' })).map((row) => row.sessionId),
    ['f1'],
    '非 git 工作区按会话标题可搜',
  )
  assert.deepEqual(
    buildRows(input({ projects: [nonGit], query: 'develop' })),
    [],
    '非 git 工作区没有分支名 ⇒ 搜分支名无结果，且不抛错',
  )

  // 非搜索路径同样不崩（flat 容器不带 worktree 时的渲染基准）
  assert.deepEqual(
    shape(buildRows(input({ projects: [nonGit] }))),
    ['project:p:/plain/.git', 'session:s:f1'],
    '非 git 项目渲染为 project 行 + 会话行',
  )
})

test('搜索: 三种项目形态（多 worktree / 单 worktree / 非 git）的分支名搜索逐一对齐', () => {
  // D11 2026-09-21 修订的连带校验：单 worktree 的 git 项目从 flat 转为 worktree 子行后，
  // 分支名搜索必须与另外两种形态行为一致（都只命中自己的会话、都不串台）。
  const multi = project({
    key: '/multi/.git',
    title: 'MultiRepo',
    worktrees: [
      worktree('/multi', { branch: 'main', isMain: true, sessions: [session('m-main')] }),
      worktree('/multi-feat', { branch: 'feature/needle', sessions: [session('m-needle')] }),
    ],
  })
  const single = project({
    key: '/single/.git',
    title: 'SingleRepo',
    worktrees: [
      worktree('/single', { branch: 'feature/needle', isMain: true, sessions: [session('s-needle')] }),
    ],
  })
  const nonGit = project({
    key: 'ws:W9',
    isGit: false,
    title: 'PlainRepo',
    worktrees: [],
    flatSessions: [session('n-plain', { cwd: '/Users/x/feature-needle' })],
  })

  assert.deepEqual(
    buildRows(input({ projects: [multi], query: 'needle' })).map((row) => row.sessionId),
    ['m-needle'],
    '多 worktree：只有命中分支的那个 worktree 下的会话',
  )
  assert.deepEqual(
    buildRows(input({ projects: [single], query: 'needle' })).map((row) => row.sessionId),
    ['s-needle'],
    '单 worktree：分支名同样可搜（修订后仍走 worktreeHaystacks）',
  )
  assert.deepEqual(
    buildRows(input({ projects: [nonGit], query: 'needle' })).map((row) => row.sessionId),
    ['n-plain'],
    '非 git 工作区：没有分支名，但 cwd basename 命中 ⇒ 仍搜得到（另一条 haystack）',
  )

  // 搜索结果里不出现任何项目行 / worktree 行（扁平模式不变）
  assert.equal(
    buildRows(input({ projects: [multi, single, nonGit], query: 'needle' }))
      .every((row) => row.kind === 'session' && row.depth === 0),
    true,
    '搜索输出恒为 depth 0 的会话行',
  )
})

test('搜索: 归档会话不出现在搜索结果里，blank（非当前）也不出现', () => {
  const rows = buildRows(
    input({
      projects: [
        singleWorktreeProject([
          session('hit', { title: 'needle' }),
          session('arc', { title: 'needle-archived' }),
          session('blankNeedle', { title: 'needle-blank', blank: true }),
        ]),
      ],
      archivedSessionIds: ['arc'],
      query: 'needle',
    }),
  )

  assert.deepEqual(
    rows.map((row) => row.sessionId),
    ['hit'],
    '归档与 blank（非当前）都不应出现在搜索结果里',
  )
})

test('搜索: 无匹配 ⇒ 返回空数组（渲染层据此显示 search.empty）', () => {
  const rows = buildRows(input({ projects: [singleWorktreeProject(sessions(3))], query: '绝不匹配的词' }))
  assert.deepEqual(rows, [], '无匹配应返回空数组')
})

test('搜索: 同一会话不会因出现在多个容器而重复输出', () => {
  const duplicated = session('dup', { title: 'needle' })
  const rows = buildRows(
    input({
      projects: [
        project({
          worktrees: [
            worktree('/repo', { branch: 'main', isMain: true, sessions: [duplicated] }),
            worktree('/repo-feat', { branch: 'feat', sessions: [duplicated] }),
          ],
        }),
      ],
      query: 'needle',
    }),
  )

  assert.deepEqual(rows.map((row) => row.sessionId), ['dup'], '同一 sessionId 只输出一次（seen 去重）')
})

// ---------------------------------------------------------------------------
// 归档
// ---------------------------------------------------------------------------

test('归档: archivedSessionIds 里的会话在任何容器与搜索结果里都不出现', () => {
  const rows = buildRows(
    input({
      projects: [
        singleWorktreeProject(
          [session('keep'), session('gone')],
          { history: [session('goneHistory'), session('keepHistory')] },
        ),
        project({
          key: 'ws:W1',
          isGit: false,
          title: 'Docs',
          worktrees: [],
          flatSessions: [session('goneFlat'), session('keepFlat')],
        }),
      ],
      ungrouped: [session('goneUngrouped'), session('keepUngrouped')],
      archivedSessionIds: ['gone', 'goneHistory', 'goneFlat', 'goneUngrouped'],
    }),
  )

  assert.deepEqual(
    rows.filter((row) => row.kind === 'session').map((row) => row.sessionId).sort(),
    ['keep', 'keepFlat', 'keepHistory', 'keepUngrouped'],
    '归档会话应被所有容器排除',
  )

  const searched = buildRows(
    input({
      projects: [singleWorktreeProject([session('gone'), session('keep')])],
      archivedSessionIds: ['gone'],
      query: 's',
    }),
  )
  assert.deepEqual(searched.map((row) => row.sessionId), ['keep'], '搜索结果同样排除归档会话')
})

// ---------------------------------------------------------------------------
// 纯函数性 / 确定性
// ---------------------------------------------------------------------------

test('纯函数: buildRows 不就地排序入参数组（调用前后 deep-equal）', () => {
  const worktreeSessions = [session('w-b', { updatedAt: 1 }), session('w-a', { updatedAt: 9 })]
  const historySessions = [session('h-b', { updatedAt: 1 }), session('h-a', { updatedAt: 9 })]
  const flatSessions = [session('f-b', { updatedAt: 1 }), session('f-a', { updatedAt: 9 })]
  const ungrouped = [session('u-b', { updatedAt: 1 }), session('u-a', { updatedAt: 9 })]
  const worktrees = [
    worktree('/repo', { branch: 'main', isMain: true, sessions: worktreeSessions }),
    worktree('/repo-feat', { branch: 'feat', sessions: [session('x')] }),
  ]

  const projects = [
    project({ worktrees, history: historySessions }),
    project({ key: 'ws:W1', isGit: false, title: 'Docs', worktrees: [], flatSessions }),
  ]
  const snapshot = JSON.stringify({ projects, ungrouped })

  buildRows(input({ projects, ungrouped }))

  assert.equal(JSON.stringify({ projects, ungrouped }), snapshot, 'buildRows 必须纯函数：入参数组顺序/内容均不得变化')
  assert.deepEqual(
    worktreeSessions.map((s) => s.sessionId),
    ['w-b', 'w-a'],
    'worktree 会话数组本身未被排序',
  )
  assert.deepEqual(historySessions.map((s) => s.sessionId), ['h-b', 'h-a'], 'history 数组本身未被排序')
  assert.deepEqual(flatSessions.map((s) => s.sessionId), ['f-b', 'f-a'], 'flatSessions 数组本身未被排序')
  assert.deepEqual(ungrouped.map((s) => s.sessionId), ['u-b', 'u-a'], 'ungrouped 数组本身未被排序')
})

test('纯函数: truncateSessions / nestSubagents 也不就地修改入参', () => {
  const list = [session('z', { updatedAt: 1 }), session('a', { updatedAt: 2 }), session('m', { updatedAt: 3 })]
  const snapshot = JSON.stringify(list)

  truncateSessions(list, 2)
  nestSubagents(list)

  assert.equal(JSON.stringify(list), snapshot, '两个纯函数都不得原地修改入参')
})

test('排序确定性: 两次调用结果完全一致', () => {
  const build = () =>
    project({
      worktrees: [
        worktree('/repo', { branch: 'zeta', sessions: [session('a', { updatedAt: 5 }), session('b', { updatedAt: 5 })] }),
        worktree('/repo-main', { branch: 'main', isMain: true, sessions: [session('c'), session('d')] }),
        worktree('/repo-alpha', { branch: 'alpha', sessions: [session('e')] }),
      ],
      history: [session('h1', { updatedAt: 7 }), session('h2', { updatedAt: 7 })],
    })

  const first = buildRows(input({ projects: [build()], expandedAllKeys: { 'w:/repo': true } }))
  const second = buildRows(input({ projects: [build()], expandedAllKeys: { 'w:/repo': true } }))

  assert.deepEqual(first, second, '同样的输入两次调用必须产出逐字段相同的行序列')
})

test('排序确定性: updatedAt 相同 ⇒ 按 sessionId 升序', () => {
  const rows = buildRows(
    input({
      projects: [
        singleWorktreeProject([
          session('m', { updatedAt: 42 }),
          session('a', { updatedAt: 42 }),
          session('z', { updatedAt: 42 }),
          session('newest', { updatedAt: 99 }),
        ]),
      ],
    }),
  )

  assert.deepEqual(
    rows.filter((row) => row.kind === 'session').map((row) => row.sessionId),
    ['newest', 'a', 'm', 'z'],
    'updatedAt 降序优先；同值按 sessionId 升序 tiebreak',
  )
})

test('排序确定性: 未分组会话同样按 updatedAt 降序 + sessionId 升序', () => {
  const rows = buildRows(
    input({
      ungrouped: [
        session('b', { updatedAt: 5 }),
        session('a', { updatedAt: 5 }),
        session('c', { updatedAt: 8 }),
      ],
    }),
  )

  assert.deepEqual(
    rows.filter((row) => row.kind === 'session').map((row) => row.sessionId),
    ['c', 'a', 'b'],
    '未分组容器使用同一套排序规则',
  )
})

test('排序: 项目顺序 = 入参顺序（宿主 workspaceRegistry.list() 的顺序）', () => {
  const rows = buildRows(
    input({
      projects: [
        project({ key: '/second/.git', title: 'Second', worktrees: [worktree('/second', { isMain: true, branch: 'main' })] }),
        project({ key: '/first/.git', title: 'First', worktrees: [worktree('/first', { isMain: true, branch: 'main' })] }),
      ],
    }),
  )

  assert.deepEqual(
    rows.filter((row) => row.kind === 'project').map((row) => row.label),
    ['Second', 'First'],
    '项目行必须保持入参顺序（不得按字母重排）',
  )
})

// ---------------------------------------------------------------------------
// 子代理（需求变更）：**不渲染子代理行**，只保留父行的「运行中子代理」计数胶囊
// 对齐原生 `sessionVisible` / `runningSubagentCount`（见 docs/INTERFACES.md §2.6 裁定 3）
// ---------------------------------------------------------------------------

/** 造一条子代理会话。 */
function subagent(id, parentSessionId, overrides = {}) {
  return session(id, { parentSessionId, origin: 'subagent', ...overrides })
}

test('子代理: 父 + 2 个子代理 ⇒ 只渲染父行，没有任何 origin:subagent 的行', () => {
  const parent = session('parent', { updatedAt: 10, title: '父会话' })
  const rows = buildRows(
    input({
      projects: [
        singleWorktreeProject([
          parent,
          subagent('c1', 'parent', { updatedAt: 9 }),
          subagent('c2', 'parent', { updatedAt: 8 }),
        ]),
      ],
    }),
  )

  assert.deepEqual(
    rows.filter((row) => row.kind === 'session').map((row) => row.sessionId),
    ['parent'],
    `渲染行里只应有父会话，实际：${shape(rows).join(' | ')}`,
  )
  // 逐条对照入参里确实存在 2 个 subagent，证明是「被过滤」而不是「根本没进来」。
  const sessionIds = new Set(rows.filter((row) => row.kind === 'session').map((row) => row.sessionId))
  assert.equal(sessionIds.has('c1'), false, '子代理 c1 不得出现在任何渲染行里')
  assert.equal(sessionIds.has('c2'), false, '子代理 c2 不得出现在任何渲染行里')
  assert.equal(rows[0].sessionCount, 1, 'sessionCount 只数顶层（= 非子代理）会话')
})

test('子代理: subagentCount = 运行中的子代理数；全不 running ⇒ 0（与「个」文案一致）', () => {
  const runningParent = buildRows(
    input({
      projects: [
        singleWorktreeProject([
          session('parent', { updatedAt: 10 }),
          subagent('c1', 'parent', { updatedAt: 9, running: true }),
          subagent('c2', 'parent', { updatedAt: 8, running: false }),
        ]),
      ],
    }),
  )
  assert.equal(
    runningParent.find((row) => row.sessionId === 'parent').subagentCount,
    1,
    '2 个子代理里只有 1 个 running ⇒ 计数为 1（不是 2）',
  )
  // 需求 A：同一次调用里，父行状态点也必须因为「有子代理在跑」而变成运行中。
  assert.equal(
    runningParent.find((row) => row.sessionId === 'parent').running,
    true,
    '父会话自己 idle 但 1 个子代理在跑 ⇒ 父行 running=true（需求 A）',
  )

  const idleAll = buildRows(
    input({
      projects: [
        singleWorktreeProject([
          session('parent', { updatedAt: 10 }),
          subagent('c1', 'parent', { updatedAt: 9, running: false }),
          subagent('c2', 'parent', { updatedAt: 8, running: false }),
        ]),
      ],
    }),
  )
  assert.equal(
    idleAll.find((row) => row.sessionId === 'parent').subagentCount,
    0,
    '子代理都不 running ⇒ 计数 0（渲染层据此不画胶囊）',
  )
  assert.equal(
    idleAll.find((row) => row.sessionId === 'parent').running,
    false,
    '子代理都不 running 且父自己 idle ⇒ 父行仍是 idle（需求 A 的反例）',
  )
})

test('子代理: 计数覆盖所有层级（孙也在内），对齐原生 indexSubagentDescendants', () => {
  const rows = buildRows(
    input({
      projects: [
        singleWorktreeProject([
          session('p', { updatedAt: 10 }),
          subagent('c', 'p', { updatedAt: 9, running: true }),
          subagent('g', 'c', { updatedAt: 8, running: true }),
        ]),
      ],
    }),
  )

  const row = rows.find((r) => r.sessionId === 'p')
  assert.equal(row.subagentCount, 2, '父行计数含孙（两层都在跑 ⇒ 2），不只是直接子代')
  assert.equal(rows.filter((r) => r.kind === 'session').length, 1, '孙同样不渲染成行')
})

test('子代理: 悬挂子代理（父不在本组）⇒ 完全不出现（此前是平铺为 depth 0）', () => {
  const rows = buildRows(
    input({
      projects: [
        singleWorktreeProject([
          session('normal'),
          subagent('orphan', 'not-in-group', { title: '悬挂子代理' }),
        ]),
      ],
    }),
  )

  assert.deepEqual(
    rows.filter((row) => row.kind === 'session').map((row) => row.sessionId),
    ['normal'],
    `悬挂子代理既不应嵌套也不应平铺，实际：${shape(rows).join(' | ')}`,
  )
})

test('子代理: 当前会话就是子代理时也不渲染该行（原生同样如此）', () => {
  const rows = buildRows(
    input({
      projects: [
        singleWorktreeProject([
          session('parent', { updatedAt: 10 }),
          subagent('c1', 'parent', { updatedAt: 9, running: true }),
        ]),
      ],
      currentSessionId: 'c1',
    }),
  )

  assert.deepEqual(
    rows.filter((row) => row.kind === 'session').map((row) => row.sessionId),
    ['parent'],
    '当前会话落在子代理上时不显示该行',
  )
  assert.equal(
    rows.filter((row) => row.isCurrent).length,
    0,
    'isCurrent 不因过滤而错落到父行（父行确实不是当前会话）',
  )
  assert.equal(
    rows.find((row) => row.sessionId === 'parent').subagentCount,
    1,
    '父行的计数胶囊不受 currentSessionId 影响',
  )
})

test('子代理: 当前会话落在子代理上时，主会话的 5 条截断不受影响（T13 无保底）', () => {
  // 12 条顶层 + 若干子代理；current 是子代理（被隐藏）⇒ 主会话仍按原生前 5 条渲染。
  const rows = buildRows(
    input({
      projects: [
        singleWorktreeProject([
          ...sessions(12),
          subagent('c1', 's11', { updatedAt: 900, running: true }),
        ]),
      ],
      currentSessionId: 'c1',
    }),
  )

  assert.deepEqual(
    rows.filter((row) => row.kind === 'session').map((row) => row.sessionId),
    ['s11', 's10', 's9', 's8', 's7'],
    'current 是子代理时，顶层会话仍逐字取前 5 条（T13 起无任何保底提升）',
  )
  assert.equal(rows.filter((row) => row.kind === 'more').length, 1, '12 条顶层 ⇒ 1 条 more 行')
  assert.equal(rows.filter((row) => row.kind === 'more')[0].hiddenCount, 7, 'hiddenCount 仍只数顶层会话')
  assert.equal(
    rows.find((row) => row.sessionId === 's11').subagentCount,
    1,
    '被隐藏的 current 子代理仍计入父行胶囊',
  )
})

test('子代理: 不吃 5 条截断名额，也不进入 hiddenCount（口径不变）', () => {
  const children = Array.from({ length: 5 }, (_, i) =>
    subagent(`child${i}`, 's11', { updatedAt: 900 + i }),
  )
  const rows = buildRows(
    input({ projects: [singleWorktreeProject([...sessions(12), ...children])] }),
  )

  assert.equal(
    rows.filter((row) => row.kind === 'session').length,
    5,
    '顶层会话按 5 条截断，5 个子代理完全不出行',
  )
  assert.equal(rows[0].sessionCount, 12, 'sessionCount 为顶层会话总数')
  assert.equal(rows.filter((row) => row.kind === 'more')[0].hiddenCount, 7, 'hiddenCount 只数顶层会话（12 - 5）')
})

test('子代理: 归档的子代理不影响父行计数（索引建在全量输入上，与原生 list.byId 同口径）', () => {
  const rows = buildRows(
    input({
      projects: [
        singleWorktreeProject([
          session('parent', { updatedAt: 10 }),
          subagent('c1', 'parent', { updatedAt: 9, running: true }),
        ]),
      ],
      archivedSessionIds: ['c1'],
    }),
  )

  assert.deepEqual(rows.filter((row) => row.kind === 'session').map((row) => row.sessionId), ['parent'])
  assert.equal(
    rows.find((row) => row.sessionId === 'parent').subagentCount,
    1,
    '归档的子代理仍计入父行「运行中」计数（原生用未过滤的 byId 建索引）',
  )
})

test('子代理: 搜索命中子代理标题 ⇒ 返回空；命中父会话标题 ⇒ 正常返回', () => {
  const list = [
    session('parent', { title: 'needle-parent' }),
    subagent('c1', 'parent', { title: 'needle-child' }),
  ]

  const childHit = buildRows(input({ projects: [singleWorktreeProject(list)], query: 'needle-child' }))
  assert.deepEqual(childHit, [], '搜索不该搜到子代理（与树同一个可见性谓词）')

  const parentHit = buildRows(input({ projects: [singleWorktreeProject(list)], query: 'needle-parent' }))
  assert.deepEqual(parentHit.map((row) => row.sessionId), ['parent'], '父会话标题命中仍应正常返回')
})

test('子代理: 搜索行不带子代理，但父行仍带运行中计数胶囊', () => {
  const rows = buildRows(
    input({
      projects: [
        singleWorktreeProject([
          session('parent', { title: 'needle-parent' }),
          subagent('c1', 'parent', { title: 'needle-child', running: true }),
          subagent('c2', 'parent', { title: 'needle-child-2', running: false }),
        ]),
      ],
      query: 'needle',
    }),
  )

  assert.deepEqual(rows.map((row) => row.sessionId), ['parent'], '搜索结果里只有父会话')
  assert.equal(rows[0].depth, 0, '搜索行 depth 恒为 0')
  assert.equal(rows[0].subagentCount, 1, '父行 subagentCount = 运行中的子代理数')
})

test('子代理: 各容器（worktree / history / 平铺项目 / 未分组）都过滤，且不影响容器行存在性', () => {
  const rows = buildRows(
    input({
      projects: [
        project({
          worktrees: [
            worktree('/repo', {
              branch: 'main',
              isMain: true,
              sessions: [session('w'), subagent('wSub', 'w')],
            }),
            worktree('/repo-feat', {
              branch: 'feat',
              sessions: [subagent('fSub', 'outside')],
            }),
          ],
          history: [session('h'), subagent('hSub', 'h')],
        }),
        project({
          key: 'ws:W1',
          isGit: false,
          title: 'Docs',
          worktrees: [],
          flatSessions: [session('d'), subagent('dSub', 'd')],
        }),
      ],
      ungrouped: [session('u'), subagent('uSub', 'u')],
    }),
  )

  assert.deepEqual(
    rows.filter((row) => row.kind === 'session').map((row) => row.sessionId).sort(),
    ['d', 'h', 'u', 'w'],
    '四个容器各自过滤掉子代理，只剩顶层会话',
  )
  assert.equal(rows.filter((row) => row.kind === 'session').every((row) => row.depth <= 2), true, '没有 depth 3 的子代理行')
})

test('子代理: 容器只有子代理（无顶层会话）⇒ 不产生该容器行（存在性判据同源）', () => {
  const rows = buildRows(
    input({
      projects: [
        singleWorktreeProject([session('keep')], {
          history: [subagent('hSub', 'outside')],
        }),
      ],
    }),
  )

  assert.equal(
    rows.filter((row) => row.kind === 'history').length,
    0,
    'history 里只有（父不在组内的）子代理 ⇒ 不该建出空的 history 容器行',
  )
})

test('子代理: 未分组容器只剩子代理时整行消失', () => {
  const rows = buildRows(input({ ungrouped: [subagent('uSub', 'outside')] }))
  assert.deepEqual(rows, [], '未分组里全是子代理 ⇒ 连未分组行都不出现')
})

test('兜底: buildRows 里没有子代理时行为与从前完全一致（防空过滤回归）', () => {
  const rows = buildRows(input({ projects: [singleWorktreeProject(sessions(3))] }))

  assert.deepEqual(
    rows.filter((row) => row.kind === 'session').map((row) => row.sessionId),
    ['s2', 's1', 's0'],
    '无子代理时排序/截断不变',
  )
  assert.equal(rows.filter((row) => row.kind === 'session').every((row) => row.subagentCount === 0), true, '无子代理 ⇒ 计数全 0')
  assert.equal(rows.filter((row) => row.kind === 'more').length, 0, '3 条不超过上限 ⇒ 无 more 行')
})

test('兜底: 派生会话（有 parentSessionId 但 origin 不是 subagent）仍渲染为顶层行', () => {
  // `SessionStore.fork` 也会写 `parentSession`，但 fork 出的会话不是子代理，
  // 原生照常渲染（sessionVisible 只看 origin）⇒ 本插件必须同样渲染。
  const forked = session('forked', { parentSessionId: 'parent', title: '派生会话' })
  const rows = buildRows(
    input({ projects: [singleWorktreeProject([session('parent', { updatedAt: 10 }), forked])] }),
  )

  assert.deepEqual(
    rows.filter((row) => row.kind === 'session').map((row) => row.sessionId).sort(),
    ['forked', 'parent'],
    'fork 会话（无 origin:subagent）不得被当成子代理过滤掉',
  )
  assert.equal(
    rows.find((row) => row.sessionId === 'parent').subagentCount,
    0,
    'fork 不是子代理 ⇒ 不给父行计数胶囊',
  )
})

// ---------------------------------------------------------------------------
// 需求 A（2026-09-21）：**有任意层级 subagent 在跑 ⇒ 父会话行状态点也是「运行中」**
//
// 对齐原生 `sessionStatuses`（`dsh-client-ui-workspace/lib/client.js`）：
//   if (subagents !== void 0) return [subagents]      // runningSubagentCount > 0 ⇒ ongoing
// 原实现只读会话自己的 `SessionSummary.running` ⇒ 此场景退化成灰 idle。
// 判据写在 `toSessionRow` 里，因此**树与搜索两条路径同源**。
// ---------------------------------------------------------------------------

test('需求 A: 父自己 idle + 运行中的直接子代理 ⇒ 父行 running=true（状态点变蓝）', () => {
  const rows = buildRows(
    input({
      projects: [
        singleWorktreeProject([
          session('p', { updatedAt: 10, running: false }),
          subagent('c', 'p', { updatedAt: 9, running: true }),
        ]),
      ],
    }),
  )

  const parent = rows.find((row) => row.sessionId === 'p')
  assert.equal(parent.running, true, '主 agent 空闲、子代理在跑 ⇒ 父行 running=true（这是需求 A 的核心）')
  assert.equal(parent.subagentCount, 1, '计数胶囊仍为 1（两条通道语义不同但同源）')
})

test('需求 A: 只有**深层**后代在跑（depth 3 链）⇒ 顶层可见行 running=true', () => {
  // 真实数据里有 delegationDepth 3 的链、33 个不同的顶层祖先（见调研报告 §7.1），
  // 所以必须验证「最深一层在跑」也能聚合到顶层那一行。
  const rows = buildRows(
    input({
      projects: [
        singleWorktreeProject([
          session('p', { updatedAt: 10, running: false }),
          subagent('a', 'p', { updatedAt: 9, running: false }),
          subagent('b', 'a', { updatedAt: 8, running: false }),
          subagent('c', 'b', { updatedAt: 7, running: true }),
        ]),
      ],
    }),
  )

  assert.deepEqual(
    rows.filter((row) => row.kind === 'session').map((row) => row.sessionId),
    ['p'],
    '四层链只渲染顶层一行（中间层全是子代理）',
  )
  const parent = rows.find((row) => row.sessionId === 'p')
  assert.equal(parent.running, true, 'depth 3 的孙在跑 ⇒ 顶层 p 的 running=true（所有层级聚合）')
  assert.equal(parent.subagentCount, 1, '只有最深那一个在跑 ⇒ 计数 1')
})

test('需求 A: 子代理全 idle 且父自身 idle ⇒ 父行仍是 idle（不误报）', () => {
  const rows = buildRows(
    input({
      projects: [
        singleWorktreeProject([
          session('p', { updatedAt: 10, running: false }),
          subagent('c', 'p', { updatedAt: 9, running: false }),
        ]),
      ],
    }),
  )

  const parent = rows.find((row) => row.sessionId === 'p')
  assert.equal(parent.running, false, '没有任何东西在跑 ⇒ 必须保持 idle（反例守卫）')
  assert.equal(parent.subagentCount, 0, '计数同样为 0')
})

test('需求 A: 父自身 running（无子代理）⇒ 行为不变', () => {
  const rows = buildRows(
    input({ projects: [singleWorktreeProject([session('p', { updatedAt: 10, running: true })])] }),
  )

  const parent = rows.find((row) => row.sessionId === 'p')
  assert.equal(parent.running, true, '自身 running 照旧为 true（需求 A 不得回归这一档）')
  assert.equal(parent.subagentCount, 0, '无子代理 ⇒ 不画胶囊')
})

test('需求 A: 搜索路径同样聚合（树与搜索同源于 toSessionRow）', () => {
  const rows = buildRows(
    input({
      projects: [
        singleWorktreeProject([
          session('p', { updatedAt: 10, title: 'needle-parent', running: false }),
          subagent('c', 'p', { updatedAt: 9, title: 'needle-child', running: true }),
        ]),
      ],
      query: 'needle',
    }),
  )

  assert.deepEqual(rows.map((row) => row.sessionId), ['p'], '搜索里仍然只有父会话一行')
  assert.equal(rows[0].running, true, '搜索行的 running 也必须含子代理聚合（两条路径同一个构造函数）')
  assert.equal(rows[0].subagentCount, 1, '搜索行同样带计数胶囊')
})

test('需求 A: 容器/项目行的 runningCount 口径**不变**（用户裁决 Q1：渲染层无消费者）', () => {
  const rows = buildRows(
    input({
      projects: [
        singleWorktreeProject([
          session('p', { updatedAt: 10, running: false }),
          subagent('c', 'p', { updatedAt: 9, running: true }),
        ]),
      ],
    }),
  )

  // 会话行含聚合（需求 A），但容器/项目行的 runningCount 仍只数「会话自己的 running」。
  // 这条断言把「不扩大范围」钉死，防止将来有人顺手改 runningCount 而无声改变契约。
  assert.equal(rows.find((row) => row.kind === 'worktree').runningCount, 0, 'worktree 行 runningCount 不含子代理')
  assert.equal(rows.find((row) => row.kind === 'project').runningCount, 0, 'project 行 runningCount 不含子代理')
  assert.equal(rows.find((row) => row.sessionId === 'p').running, true, '而会话行的 running 含聚合 —— 两者口径有意不同')
})

// ---------------------------------------------------------------------------
// 运行中任务高亮（2026-10-20，设计 §9.2 A1–A15）
//
// 契约：`RenderRow` 的 `project` / `worktree` 变体新增**必填** `hasRunningTasks`，
// 语义 =「该行是否有任务正在运行（含运行中的子代理）」，**不是** `runningCount > 0` 的别名。
// 判定唯一实现点：`emitContainer`（用**截断前**的 `heads`）+ `buildRows` 的 project 分支。
// project 判定 = worktree 子项 **或** 该 workspace 的 flat/普通会话（2026-10-20 追加裁决，
// A7/A15）；history 桶与未分组仍显式排除。A14（上面的 runningCount 用例）保持原样。
// ---------------------------------------------------------------------------

test('运行中高亮/A1: worktree 主会话在跑 ⇒ worktree 与 project 行 hasRunningTasks=true', () => {
  const rows = buildRows(
    input({ projects: [singleWorktreeProject([session('p', { updatedAt: 10, running: true })])] }),
  )

  assert.equal(
    rows.find((row) => row.kind === 'worktree').hasRunningTasks,
    true,
    'worktree 内有自身 running===true 的主会话 ⇒ 该 worktree 行必须高亮',
  )
  assert.equal(
    rows.find((row) => row.kind === 'project').hasRunningTasks,
    true,
    'project 行只聚合 worktree 桶 ⇒ 唯一 worktree 在跑 ⇒ project=true',
  )
})

test('运行中高亮/A2: 只有子代理在跑 ⇒ worktree=true 且父会话行 running=true（同源）', () => {
  const rows = buildRows(
    input({
      projects: [
        singleWorktreeProject([
          session('p', { updatedAt: 10, running: false }),
          subagent('c', 'p', { updatedAt: 9, running: true }),
        ]),
      ],
    }),
  )

  assert.equal(
    rows.find((row) => row.kind === 'worktree').hasRunningTasks,
    true,
    'RT1：父自身 idle、但有运行中子代理 ⇒ worktree 仍高亮（聚合口径）',
  )
  assert.equal(
    rows.find((row) => row.sessionId === 'p').running,
    true,
    '同一份输入里父会话行的 running 已是聚合口径 ⇒ 必须与容器高亮一致（不得分叉）',
  )
  assert.equal(
    rows.find((row) => row.kind === 'worktree').runningCount,
    0,
    'runningCount 口径不变（只数主会话自身 running）⇒ 这里必须是 0（允许与 hasRunningTasks 不同）',
  )
  assert.equal(rows.find((row) => row.kind === 'project').hasRunningTasks, true, 'project 跟随 worktree')
})

test('运行中高亮/A3: depth 3 子代理链在跑 ⇒ worktree=true（多层累加）', () => {
  const rows = buildRows(
    input({
      projects: [
        singleWorktreeProject([
          session('p', { updatedAt: 10, running: false }),
          subagent('c', 'p', { updatedAt: 9, running: false }),
          subagent('g', 'c', { updatedAt: 8, running: true }),
        ]),
      ],
    }),
  )

  assert.equal(
    rows.find((row) => row.kind === 'worktree').hasRunningTasks,
    true,
    'depth 3 的孙在跑 ⇒ 通过父链聚合到顶层可见会话 ⇒ worktree 高亮',
  )
})

test('运行中高亮/A4: 两个 worktree 仅 A 在跑 ⇒ A=true、B=false、project=true', () => {
  const rows = buildRows(
    input({
      projects: [
        project({
          worktrees: [
            worktree('/repo', { branch: 'main', isMain: true, sessions: [session('a', { running: true })] }),
            worktree('/repo-feat', { branch: 'feat', sessions: [session('b', { running: false })] }),
          ],
        }),
      ],
    }),
  )

  const worktrees = rows.filter((row) => row.kind === 'worktree')
  assert.equal(worktrees.length, 2, '两个 worktree 各产一行')
  assert.equal(worktrees[0].hasRunningTasks, true, 'A（/repo）在跑 ⇒ true')
  assert.equal(worktrees[1].hasRunningTasks, false, 'B（/repo-feat）空闲 ⇒ false（不得被 A 污染）')
  assert.equal(rows.find((row) => row.kind === 'project').hasRunningTasks, true, '任一 worktree 在跑 ⇒ project=true')
})

test('运行中高亮/A5: 全部空闲 ⇒ 所有容器行 hasRunningTasks=false', () => {
  const rows = buildRows(
    input({
      projects: [
        project({
          worktrees: [
            worktree('/repo', { branch: 'main', isMain: true, sessions: [session('a')] }),
            worktree('/repo-feat', { branch: 'feat', sessions: [session('b')] }),
          ],
        }),
      ],
    }),
  )

  for (const row of rows.filter((entry) => entry.kind === 'project' || entry.kind === 'worktree')) {
    assert.equal(row.hasRunningTasks, false, `${row.kind}:${row.key} 无运行中任务 ⇒ 必须为 false`)
  }
})

test('运行中高亮/A6: history 桶在跑 ⇒ history 行无该字段、project=false', () => {
  const rows = buildRows(
    input({
      projects: [
        project({
          worktrees: [worktree('/repo', { branch: 'main', isMain: true, sessions: [session('idle')] })],
          history: [session('h', { updatedAt: 20, running: true })],
        }),
      ],
    }),
  )

  const historyRow = rows.find((row) => row.kind === 'history')
  assert.ok(historyRow !== undefined, '有可见 history 会话 ⇒ 必须产 history 行')
  assert.equal(
    'hasRunningTasks' in historyRow,
    false,
    'RT2：history 变体**不加**该字段（clock 图标永不高亮）',
  )
  assert.equal(rows.find((row) => row.kind === 'worktree').hasRunningTasks, false, 'worktree 空闲 ⇒ false')
  assert.equal(
    rows.find((row) => row.kind === 'project').hasRunningTasks,
    false,
    'RT2：project **不聚合** history 桶 ⇒ history 在跑也必须 false',
  )
})

test('运行中高亮/A7: 非 git 平铺会话在跑 ⇒ project=true（追加裁决：聚合 flat）', () => {
  const rows = buildRows(
    input({
      projects: [
        project({
          key: 'ws:abc',
          isGit: false,
          mainPath: undefined,
          worktrees: [],
          flatSessions: [session('f', { running: true })],
        }),
      ],
    }),
  )

  const projectRow = rows.find((row) => row.kind === 'project')
  assert.equal(projectRow.worktreeCount, 0, '非 git 工作区无 worktree 子行（前置条件）')
  assert.equal(
    rows.some((row) => row.kind === 'worktree'),
    false,
    '前置条件：没有 worktree 子行 ⇒ 高亮只能来自 flat 聚合',
  )
  assert.equal(
    projectRow.hasRunningTasks,
    true,
    '2026-10-20 追加裁决：该 workspace 的普通/flat 会话在跑 ⇒ project 文件夹高亮',
  )
})

test('运行中高亮/A15: git workspace 的 worktree 空闲、但 flat 会话在跑 ⇒ project=true、worktree=false', () => {
  const rows = buildRows(
    input({
      projects: [
        project({
          key: '/repo/.git',
          isGit: true,
          worktrees: [
            worktree('/repo', { branch: 'main', isMain: true, sessions: [session('idle')] }),
          ],
          // 真实宿主数据里 git 项目的 flatSessions 恒为空（projects.ts 归属规则 2b），
          // 但契约形状允许该字段有值 ⇒ 这里锁住「所有 workspace 都聚合 flat」的口径。
          flatSessions: [session('f-flat', { running: true })],
        }),
      ],
    }),
  )

  const worktreeRow = rows.find((row) => row.kind === 'worktree')
  const projectRow = rows.find((row) => row.kind === 'project')
  assert.ok(worktreeRow !== undefined, '前置条件：git workspace 有 worktree 子行')
  assert.equal(worktreeRow.hasRunningTasks, false, 'worktree 行判定不变：仍只读自己的 entry.result')
  assert.equal(
    projectRow.hasRunningTasks,
    true,
    '2026-10-20 追加裁决：worktree 全空闲但该 workspace 的 flat 会话在跑 ⇒ project 文件夹也亮',
  )

  // 【T-11 补锁，审查 F17-1】上面只锁了「亮」，这里补锁契约的另一半：
  // git 项目的 flat 容器**仅供判定**，不渲染、不计入 sessionCount / runningCount / pendingCount
  // （design §3.3 / §4、INTERFACES §2.2.1）。缺这几条时，把门控改成 `flatResult` 的变异全绿。
  assert.equal(projectRow.sessionCount, 1, 'git flat 不计入 project.sessionCount（只数 worktree 的 1 条）')
  assert.equal(projectRow.runningCount, 0, 'git flat 不计入 runningCount（Q1 口径不变）')
  assert.equal(projectRow.pendingCount, 0, 'git flat 不计入 pendingCount')
  assert.equal(
    rows.some((row) => row.kind === 'session' && row.sessionId === 'f-flat'),
    false,
    'git flat 不渲染：flat 会话不进 rows',
  )
})

test('运行中高亮/A8: 未分组会话在跑 ⇒ 未分组 project 行=false（显式不聚合）', () => {
  const rows = buildRows(input({ ungrouped: [session('u', { running: true })] }))

  const row = rows.find((entry) => entry.kind === 'project' && entry.key === `p:${UNGROUPED_KEY}`)
  assert.ok(row !== undefined, '未分组有可见会话 ⇒ 必须产未分组行')
  assert.equal(row.hasRunningTasks, false, 'RT2：未分组行显式 false（不读容器的聚合结果）')
})

test('运行中高亮/A9: worktree 折叠 + 有运行中会话 ⇒ 仍为 true', () => {
  const rows = buildRows(
    input({
      projects: [singleWorktreeProject([session('p', { updatedAt: 10, running: true })])],
      collapsedKeys: { [WORKTREE_KEY]: true },
    }),
  )

  const worktreeRow = rows.find((row) => row.kind === 'worktree')
  assert.equal(worktreeRow.expanded, false, '折叠态前置条件')
  assert.equal(worktreeRow.hasRunningTasks, true, '判定在 emitContainer 内、与渲染无关 ⇒ 折叠不影响')
  assert.equal(
    rows.some((row) => row.kind === 'session'),
    false,
    '折叠时子行不渲染（证明高亮不是靠子行存在性推出来的）',
  )
})

test('运行中高亮/A10: 运行中的会话排第 7 被截断 ⇒ 仍为 true（用截断前 heads）', () => {
  const list = [
    session('running-old', { updatedAt: 1000, running: true }),
    ...Array.from({ length: 6 }, (_, i) => session(`idle${i}`, { updatedAt: 1001 + i })),
  ]
  const rows = buildRows(input({ projects: [singleWorktreeProject(list)] }))

  const worktreeRow = rows.find((row) => row.kind === 'worktree')
  assert.equal(worktreeRow.hasRunningTasks, true, '运行中的会话排第 7（被 5 条截断）⇒ 仍必须高亮')
  assert.equal(
    rows.filter((row) => row.kind === 'session').length,
    COLLAPSED_SESSION_LIMIT,
    '前置条件：只渲染前 5 条会话',
  )
  assert.equal(
    rows.some((row) => row.sessionId === 'running-old'),
    false,
    '前置条件：运行中的会话确实被截断、不在渲染行里（高亮仍由截断前 heads 推出）',
  )
})

test('运行中高亮/A11: 归档会话 running=true ⇒ 不计入（worktree=false）', () => {
  const rows = buildRows(
    input({
      projects: [
        singleWorktreeProject([
          session('archived', { updatedAt: 10, running: true }),
          session('idle', { updatedAt: 9 }),
        ]),
      ],
      archivedSessionIds: ['archived'],
    }),
  )

  assert.equal(
    rows.find((row) => row.kind === 'worktree').hasRunningTasks,
    false,
    '沿用 isVisibleMember：归档会话即使 running 也不计入',
  )
})

test('运行中高亮/A12: 非当前 blank 会话 running=true ⇒ 不计入（worktree=false）', () => {
  const rows = buildRows(
    input({
      projects: [
        singleWorktreeProject([
          session('blank', { updatedAt: 10, running: true, blank: true }),
          session('idle', { updatedAt: 9 }),
        ]),
      ],
    }),
  )

  assert.equal(
    rows.find((row) => row.kind === 'worktree').hasRunningTasks,
    false,
    '沿用 isVisibleMember：非当前 blank 会话不可见 ⇒ 不计入',
  )
})

test('运行中高亮/A13: 当前 blank 会话 running=true ⇒ 计入（worktree=true）', () => {
  const rows = buildRows(
    input({
      projects: [
        singleWorktreeProject([
          session('blank', { updatedAt: 10, running: true, blank: true }),
          session('idle', { updatedAt: 9 }),
        ]),
      ],
      currentSessionId: 'blank',
    }),
  )

  assert.equal(
    rows.find((row) => row.kind === 'worktree').hasRunningTasks,
    true,
    '当前会话豁免 blank 过滤（与 runningCount 一致）⇒ 计入高亮',
  )
})

test('需求 A: 索引纯函数性不变（buildRows 不改入参）', () => {
  const parent = session('p', { updatedAt: 10 })
  const child = subagent('c', 'p', { updatedAt: 9, running: true })
  const snapshot = JSON.stringify([parent, child])

  buildRows(input({ projects: [singleWorktreeProject([parent, child])] }))

  assert.equal(JSON.stringify([parent, child]), snapshot, '需求 A 的聚合不得就地修改任何会话对象')
})

// ---------------------------------------------------------------------------
// indexRunningSubagentDescendants（计数索引本身）
// ---------------------------------------------------------------------------

test('indexRunningSubagentDescendants: 只计运行中的子代理，且覆盖所有层级', () => {
  const counts = indexRunningSubagentDescendants([
    session('p'),
    subagent('c1', 'p', { running: true }),
    subagent('c2', 'p', { running: false }),
    subagent('g', 'c1', { running: true }),
  ])

  assert.equal(counts.get('p'), 2, 'p 的运行中子代理后代 = c1 + g = 2')
  assert.equal(counts.get('c1'), 1, 'c1 的运行中子代理后代 = g = 1')
  assert.equal(counts.get('c2'), 0, 'c2 没有子代 ⇒ 0')
  assert.equal(counts.get('g'), 0, 'g 没有子代 ⇒ 0')
})

test('indexRunningSubagentDescendants: 非子代理的中间节点阻断穿透（与原生父链遍历一致）', () => {
  // p → fork(非子代理) → s(子代理)：原生 while 在 fork 处停下 ⇒ p 不计 s。
  const counts = indexRunningSubagentDescendants([
    session('p'),
    session('fork', { parentSessionId: 'p' }),
    subagent('s', 'fork', { running: true }),
  ])

  assert.equal(counts.get('p'), 0, '中间是 fork（非子代理）⇒ 不穿透，p 计数 0')
  assert.equal(counts.get('fork'), 1, 's 直接挂在 fork 下 ⇒ fork 计数 1')
})

test('indexRunningSubagentDescendants: session- 前缀双向归一化', () => {
  const counts = indexRunningSubagentDescendants([
    session('session-parent'),
    subagent('child', 'parent', { running: true }),
  ])

  assert.equal(
    counts.get('parent'),
    1,
    '子引用裸 id `parent`、父 id 为 `session-parent` ⇒ 归一化后仍能匹配',
  )
  assert.deepEqual(
    [...counts.keys()].sort(),
    ['child', 'parent'],
    '键为归一化后的 id（与全模块的父 id 比较口径一致）',
  )
})

test('indexRunningSubagentDescendants: 子 id 带前缀时同样归一化', () => {
  const counts = indexRunningSubagentDescendants([
    session('parent'),
    subagent('session-child', 'parent', { running: true }),
  ])

  assert.equal(counts.get('parent'), 1, '子 id 带 session- 前缀 ⇒ 仍能挂到父上')
})

test('indexRunningSubagentDescendants: 自指 / 环不抛错也不无限递归（与原生 seen 环保护同口径）', () => {
  // 原生 `indexSubagentDescendants` 在 `seen.has(current.id)` 时才停，因此自指会先自增一次。
  const selfRef = indexRunningSubagentDescendants([subagent('x', 'x', { running: true })])
  assert.equal(selfRef.get('x'), 1, '自指：先对 x 自增一次再被 seen 拦住（与原生逐例一致）')

  const cycle = indexRunningSubagentDescendants([
    subagent('a', 'b', { running: true }),
    subagent('b', 'a', { running: true }),
  ])
  assert.equal(cycle.get('a'), 2, '环上成员互为父子：a 收到 b 与 a 各一次（与原生累加同口径）')
  assert.equal(cycle.get('b'), 2, 'b 同理')
})

test('indexRunningSubagentDescendants: 同一会话重复出现不重复计数', () => {
  const child = subagent('c', 'p', { running: true })
  const counts = indexRunningSubagentDescendants([session('p'), child, child])

  assert.equal(counts.get('p'), 1, '重复入参只计一次（原生是 Map/对象，天然去重）')
})

test('indexRunningSubagentDescendants: 不修改入参', () => {
  const list = [session('p'), subagent('c', 'p', { running: true })]
  const snapshot = JSON.stringify(list)

  indexRunningSubagentDescendants(list)

  assert.equal(JSON.stringify(list), snapshot, '索引构建必须纯函数')
})

// ---------------------------------------------------------------------------
// 其它行字段
// ---------------------------------------------------------------------------

test('行字段: 当前会话被截断到不可见时，`isCurrent` 标记随之**不在任何渲染行上**（T13）', () => {
  // T13 用户终裁：删除 D12 保底 ⇒ 当前会话的位置**完全**由持久顺序决定，
  // 「被截断到不可见」就是**看不见**（用户明确接受该副作用）。
  // 旧实现会把 s0 保底提到可见区第 5 位 ⇒ 渲染行里能查到 isCurrent=true 的行。
  const rows = buildRows(
    input({ projects: [singleWorktreeProject(sessions(12))], currentSessionId: 's0' }),
  )

  const sessionRows = rows.filter((row) => row.kind === 'session')
  assert.equal(sessionRows.length, 5, '截断上限仍为 5 条')
  assert.deepEqual(
    sessionRows.map((row) => row.sessionId),
    ['s11', 's10', 's9', 's8', 's7'],
    '★ 逐字取默认顺序前 5 条（s0 排最旧 ⇒ 落在被截断区）',
  )
  assert.equal(
    sessionRows.filter((row) => row.isCurrent).length,
    0,
    '★ 当前会话 s0 不在可见区 ⇒ 渲染行里**没有** isCurrent=true 的行（无保底）',
  )
  assert.equal(rows.find((row) => row.kind === 'more').hiddenCount, 7, '12 - 5 = 7 条被隐藏')
})

test('行字段: 当前会话本就在可见区时 `isCurrent` 标记照常（仅高亮，不置顶）', () => {
  const rows = buildRows(
    input({ projects: [singleWorktreeProject(sessions(12))], currentSessionId: 's11' }),
  )

  const current = rows.filter((row) => row.isCurrent)
  assert.equal(current.length, 1, '恰好一行 isCurrent=true')
  assert.equal(current[0].sessionId, 's11', '当前会话是默认顺序第一条')
  assert.equal(current[0].depth, 2, 'depth 仍是容器下的 2（单 worktree 的 git 项目走 worktree 容器）')
  assert.equal(rows.filter((row) => row.kind === 'session').length, 5, '不影响 5 条上限')
})

test('行字段: worktree 行 label/sublabel 与 workspaceId 传递正确', () => {
  const rows = buildRows(
    input({
      projects: [
        project({
          worktrees: [
            worktree('/repo', { branch: 'main', isMain: true, sessions: [] }),
            worktree('/repo-feat', { branch: 'feat', sessions: [], workspaceId: 'W-feat' }),
          ],
        }),
      ],
    }),
  )

  const [main, feat] = rows.filter((row) => row.kind === 'worktree')
  assert.equal(main.label, 'main', '有分支名 ⇒ label 为分支名')
  assert.equal(main.sublabel, 'repo', '目录 basename 与 label 不同 ⇒ 给 sublabel')
  assert.equal('workspaceId' in main, false, '未注册 worktree 不应带 workspaceId 字段')
  assert.equal(feat.workspaceId, 'W-feat', '已注册 worktree 的 workspaceId 应透传')
  assert.equal(main.isMain, true, '主树 isMain=true')
  assert.equal(feat.isMain, false, '非主树 isMain=false')
})

test('行字段: worktree 无分支（detached）时 label 回退为目录 basename，且不给 sublabel', () => {
  const rows = buildRows(
    input({
      projects: [
        project({
          worktrees: [
            worktree('/repo', { isMain: true, sessions: [] }),
            { path: '/repo-detached', branch: undefined, isMain: false, exists: true, title: '', sessions: [] },
          ],
        }),
      ],
    }),
  )

  const detached = rows.filter((row) => row.kind === 'worktree')[1]
  assert.equal(detached.label, 'repo-detached', '无分支 ⇒ label 用目录 basename')
  assert.equal('sublabel' in detached, false, 'label === basename ⇒ 不给 sublabel')
})

test('行字段: worktree 存在性透传（exists:false 仍出行）', () => {
  const rows = buildRows(
    input({
      projects: [
        project({
          worktrees: [
            worktree('/repo', { branch: 'main', isMain: true, sessions: [] }),
            worktree('/repo-gone', { branch: 'gone', exists: false, sessions: [] }),
          ],
        }),
      ],
    }),
  )

  const gone = rows.filter((row) => row.kind === 'worktree')[1]
  assert.equal(gone.exists, false, '已删除 worktree 的 exists 应如实透传')
  assert.equal(gone.label, 'gone', '已删除 worktree 仍应有行')
})

test('行字段: pendingInteraction 只在有值时出现，running/completed 归一为布尔', () => {
  const rows = buildRows(
    input({
      projects: [
        singleWorktreeProject([
          session('p', { pendingInteraction: 'approval', running: true, completed: false }),
          session('q', {}),
        ]),
      ],
    }),
  )

  const pending = rows.find((row) => row.sessionId === 'p')
  const plain = rows.find((row) => row.sessionId === 'q')
  assert.equal(pending.pendingInteraction, 'approval', '有 pendingInteraction 时应透传')
  assert.equal('pendingInteraction' in plain, false, '无 pendingInteraction 时不应带该字段')
  assert.equal(pending.running, true, 'running 透传')
  assert.equal(pending.completed, false, 'completed 归一为布尔 false')
  assert.equal(plain.running, false, 'running 归一为布尔 false')
})

test('行字段: project 行统计 sessionCount / runningCount / pendingCount', () => {
  const rows = buildRows(
    input({
      projects: [
        project({
          worktrees: [
            worktree('/repo', {
              branch: 'main',
              isMain: true,
              sessions: [session('a', { running: true }), session('b', { pendingInteraction: 'x' })],
            }),
            worktree('/repo-feat', { branch: 'feat', sessions: [session('c', { running: true })] }),
          ],
        }),
      ],
    }),
  )

  const projectRow = rows.find((row) => row.kind === 'project')
  assert.equal(projectRow.sessionCount, 3, 'project 行聚合两个 worktree 的顶层会话数')
  assert.equal(projectRow.runningCount, 2, 'project 行聚合 running 数')
  assert.equal(projectRow.pendingCount, 1, 'project 行聚合 pendingInteraction 数')
  assert.equal(projectRow.worktreeCount, 2, '多 worktree 时 worktreeCount = worktrees.length')
})

test('行字段: 非 git 项目的 project 行带 workspaceId 与 path（无 mainPath 时回退 flatSessions[0].cwd）', () => {
  const rows = buildRows(
    input({
      projects: [
        // 显式构造：mainPath 必须真的缺失，才能触发 flatSessions[0].cwd 回退。
        {
          key: 'ws:W1',
          isGit: false,
          title: 'Docs',
          worktrees: [],
          history: [],
          flatSessions: [session('d1', { cwd: '/Users/x/Docs' })],
        },
      ],
    }),
  )

  assert.equal(rows[0].workspaceId, 'W1', 'ws: 前缀应解析出 workspaceId')
  assert.equal(rows[0].path, '/Users/x/Docs', '非 git 项目 path 回退到首条会话 cwd')
})

// ---------------------------------------------------------------------------
// workspaceIdFromProjectKey（渲染层「非 git 行 + 按钮」的 id 来源）
// ---------------------------------------------------------------------------

test('workspaceIdFromProjectKey: `ws:<id>` ⇒ id；git 项目的 commonDir key ⇒ undefined', () => {
  // 这条判据是**非 git 工作区行 hover 的 `+`** 能否渲染的唯一依据：
  // 非 git 项目的 `worktrees` 恒为空数组，所以它的 workspaceId 既不在任何 worktree 节点上，
  // 也只能从 key 解出。`src/sidebar.tsx` 的 `buildTreeView` 就调它填 `ProjectExtra.workspaceId`。
  assert.equal(
    workspaceIdFromProjectKey('ws:fb0333d3-73a4-4fe6-9741-017eb9fd804c'),
    'fb0333d3-73a4-4fe6-9741-017eb9fd804c',
    'ws: 前缀 ⇒ 取其后全部（含连字符，不做任何切分）',
  )
  assert.equal(workspaceIdFromProjectKey('ws:'), '', '空前缀也如实返回空串（由调用方判空）')
  assert.equal(
    workspaceIdFromProjectKey('/Users/dev/Documents/Project/Workspace/MyProject/.git'),
    undefined,
    'git 项目的 key 是 commonDir ⇒ 恒 undefined（它的 id 从 worktree 节点取）',
  )
  assert.equal(workspaceIdFromProjectKey(UNGROUPED_KEY), undefined, '未分组不是工作区')
  assert.equal(
    workspaceIdFromProjectKey('ws-wrong-prefix:abc'),
    undefined,
    '只认严格的 `ws:` 前缀，不做模糊匹配',
  )
})

test('workspaceIdFromProjectKey: 与 buildRows 的 project 行 workspaceId 同源（非 git 项目）', () => {
  const rows = buildRows(
    input({
      projects: [
        project({ key: 'ws:W1', isGit: false, title: 'Docs', worktrees: [], flatSessions: [session('d1')] }),
        project({
          key: '/repo/.git',
          title: 'Repo',
          worktrees: [worktree('/repo', { branch: 'main', isMain: true, sessions: [], workspaceId: 'W-git' })],
        }),
      ],
    }),
  )

  const nonGitRow = rows.find((row) => row.label === 'Docs')
  const gitRow = rows.find((row) => row.label === 'Repo')
  assert.equal(nonGitRow.workspaceId, workspaceIdFromProjectKey('ws:W1'), '非 git 行 id 与 key 解析同源')
  assert.equal(gitRow.workspaceId, undefined, 'git 行不带 workspaceId（projectIdentity 只对 ws: key 填）')
})

// ---------------------------------------------------------------------------
// D10 手动排序（2026-09-21 用户决策变更）：applyManualOrder 纯函数语义
// ---------------------------------------------------------------------------

/** 造一组「有 id 的项」，便于断言重排结果。 */
const items = (...ids) => ids.map((id) => ({ id }))
const idsOf = (list) => list.map((item) => item.id)

test('applyManualOrder: 列表内项按 order 的索引重排', () => {
  const input = items('a', 'b', 'c', 'd')
  const out = applyManualOrder(input, ['c', 'a', 'd', 'b'], (x) => x.id)
  assert.deepEqual(idsOf(out), ['c', 'a', 'd', 'b'], '全部在列表内 ⇒ 完全按 order')
})

test('applyManualOrder: 只重排部分项，其余按默认顺序追加到末尾', () => {
  const input = items('a', 'b', 'c', 'd')
  const out = applyManualOrder(input, ['c'], (x) => x.id)
  assert.deepEqual(
    idsOf(out),
    ['c', 'a', 'b', 'd'],
    'c 提前；a/b/d 不在 order 里 ⇒ 保持**默认相对顺序**追加（a,b,d 而不是随机）',
  )
})

test('applyManualOrder: 列表外的**新项**追加到末尾（新建会话的落点）', () => {
  // 场景：用户手动排过 [b, a]，之后又新建了会话 n1 / n2。
  const input = items('b', 'a', 'n1', 'n2')
  const out = applyManualOrder(input, ['b', 'a'], (x) => x.id)
  assert.deepEqual(idsOf(out), ['b', 'a', 'n1', 'n2'], '新项在末尾，且保持它们自己的默认顺序')
})

test('applyManualOrder: 列表里含已不存在的 id ⇒ 忽略，不产生空洞 / undefined', () => {
  const input = items('a', 'b')
  const out = applyManualOrder(input, ['gone', 'b', 'also-gone', 'a'], (x) => x.id)
  assert.deepEqual(idsOf(out), ['b', 'a'], '已消失的 id 直接跳过')
  assert.equal(out.length, input.length, '输出长度恒等于输入长度（无空洞、无重复）')
  assert.ok(out.every((item) => item !== undefined), '不含 undefined')
})

test('applyManualOrder: order 里的重复 id 只生效一次（不把同一项搬两次）', () => {
  const input = items('a', 'b')
  const out = applyManualOrder(input, ['b', 'b', 'a'], (x) => x.id)
  assert.deepEqual(idsOf(out), ['b', 'a'], '重复 key 去重，输出长度不变')
})

test('applyManualOrder: order 为 undefined / 空数组 ⇒ 原样返回默认顺序（零回归）', () => {
  const input = items('a', 'b', 'c')
  assert.deepEqual(idsOf(applyManualOrder(input, undefined, (x) => x.id)), ['a', 'b', 'c'], 'undefined')
  assert.deepEqual(idsOf(applyManualOrder(input, [], (x) => x.id)), ['a', 'b', 'c'], '空数组')
})

test('applyManualOrder: 空输入 ⇒ 空输出', () => {
  assert.deepEqual(applyManualOrder([], ['a', 'b'], (x) => x.id), [], '空 items + 非空 order')
  assert.deepEqual(applyManualOrder([], undefined, (x) => x.id), [], '空 items + 空 order')
})

// ── `pinnedKeys`（置顶）的**纯函数**语义 ────────────────────────────────────
// `applyManualOrder` 的第 4 参是通用机制；T11 之后**唯一**的置顶来源是
// `topZoneSessionKeys`（正在运行 / 尚未落表的新会话）。本组用例只锁 `applyManualOrder`
// 自己的契约（与谁调用它无关）。
// 置顶项**先摘出来拼在最前**，因此它不受 `order` 影响；`taken` 共用 ⇒ 不会重复搬运。
// 缺省 / 空 ⇒ 与不传逐字一致（既有调用方的零回归保证）。

test('applyManualOrder: pinnedKeys ⇒ 置顶项排最前，其余仍按 order', () => {
  const input = items('a', 'b', 'c', 'd')
  const out = applyManualOrder(input, ['b', 'a'], (x) => x.id, ['d'])
  assert.deepEqual(idsOf(out), ['d', 'b', 'a', 'c'], 'd 置顶；b/a 按 order；c 追加到末尾')
})

test('applyManualOrder: pinnedKeys 优先级**高于** order（哪怕它在 order 里排最后）', () => {
  const input = items('a', 'b', 'c')
  // c 在 order 里被排在最后，但它是置顶项 ⇒ 必须最前。
  const out = applyManualOrder(input, ['a', 'b', 'c'], (x) => x.id, ['c'])
  assert.deepEqual(idsOf(out), ['c', 'a', 'b'], '置顶压过 order 的索引')
})

test('applyManualOrder: pinnedKeys 与 order 重复时同一项只被搬一次（无重复、长度不变）', () => {
  const input = items('a', 'b', 'c')
  const out = applyManualOrder(input, ['a', 'b'], (x) => x.id, ['a'])
  assert.deepEqual(idsOf(out), ['a', 'b', 'c'], 'a 既是置顶又在 order 里 ⇒ 只出现一次')
  assert.equal(out.length, input.length, '输出长度恒等于输入长度')
})

test('applyManualOrder: pinnedKeys 里不在 items 的 key 被忽略（当前会话不可见时的降级）', () => {
  const input = items('a', 'b')
  const out = applyManualOrder(input, ['a'], (x) => x.id, ['gone'])
  assert.deepEqual(idsOf(out), ['a', 'b'], '不存在的置顶 key 直接忽略，不产生空洞')
  assert.equal(out.length, 2, '长度不变')
})

test('applyManualOrder: order 为空但 pinnedKeys 非空 ⇒ 仍置顶（默认模式下也生效）', () => {
  const input = items('a', 'b', 'c')
  assert.deepEqual(
    idsOf(applyManualOrder(input, undefined, (x) => x.id, ['c'])),
    ['c', 'a', 'b'],
    'manual 模式关掉时，置顶仍必须生效（默认模式下运行中的会话也要在最前）',
  )
})

test('applyManualOrder: pinnedKeys 缺省 / 空数组 ⇒ 与改动前逐字一致（零回归）', () => {
  const input = items('a', 'b', 'c')
  assert.deepEqual(idsOf(applyManualOrder(input, ['c'], (x) => x.id)), ['c', 'a', 'b'], '缺省第 4 参')
  assert.deepEqual(idsOf(applyManualOrder(input, ['c'], (x) => x.id, [])), ['c', 'a', 'b'], '空 pinnedKeys')
  assert.deepEqual(
    idsOf(applyManualOrder(input, undefined, (x) => x.id, [])),
    ['a', 'b', 'c'],
    'order 与 pinnedKeys 都空 ⇒ 原样返回',
  )
})

test('applyManualOrder: pinnedKeys 为多个时按数组顺序排在最前', () => {
  const input = items('a', 'b', 'c', 'd')
  const out = applyManualOrder(input, ['a'], (x) => x.id, ['d', 'b'])
  assert.deepEqual(idsOf(out), ['d', 'b', 'a', 'c'], '置顶组内部顺序 = pinnedKeys 的顺序')
})

test('applyManualOrder: pinnedKeys 不修改入参（纯函数）', () => {
  const input = items('a', 'b', 'c')
  const order = ['a']
  const pinned = ['c']
  const inputSnapshot = idsOf(input)
  const out = applyManualOrder(input, order, (x) => x.id, pinned)

  assert.deepEqual(idsOf(out), ['c', 'a', 'b'], '结果正确')
  assert.deepEqual(idsOf(input), inputSnapshot, 'items 未被就地排序')
  assert.deepEqual(order, ['a'], 'order 未被修改')
  assert.deepEqual(pinned, ['c'], 'pinnedKeys 未被修改')
})

test('applyManualOrder: 不修改入参数组（纯函数）', () => {
  const input = items('a', 'b', 'c')
  const order = ['c', 'a']
  const snapshot = idsOf(input)
  const orderSnapshot = [...order]
  const out = applyManualOrder(input, order, (x) => x.id)

  assert.deepEqual(idsOf(input), snapshot, 'items 未被就地排序')
  assert.deepEqual(order, orderSnapshot, 'order 未被修改')
  assert.notEqual(out, input, '返回的是新数组')
  assert.deepEqual(idsOf(out), ['c', 'a', 'b'], '结果正确')
})

// ---------------------------------------------------------------------------
// D10：reorderKeys（拖拽落点 → 新顺序）
// ---------------------------------------------------------------------------

test('reorderKeys: before 插到落点前、after 插到落点后', () => {
  assert.deepEqual(
    reorderKeys(['a', 'b', 'c', 'd'], 'd', 'b', 'before'),
    ['a', 'd', 'b', 'c'],
    'd 拖到 b 的上半 ⇒ 插在 b 之前',
  )
  assert.deepEqual(
    reorderKeys(['a', 'b', 'c', 'd'], 'a', 'c', 'after'),
    ['b', 'c', 'a', 'd'],
    'a 拖到 c 的下半 ⇒ 插在 c 之后',
  )
})

test('reorderKeys: 无需改动时返回 null（不产生「拖了但没变」的写入）', () => {
  assert.equal(reorderKeys(['a', 'b', 'c'], 'b', 'b', 'before'), null, '落点是自己')
  assert.equal(
    reorderKeys(['a', 'b', 'c'], 'a', 'b', 'before'),
    null,
    'a 已在 b 之前 ⇒ 拖到 b 的上半等于原位，不该置 manual',
  )
  assert.equal(
    reorderKeys(['a', 'b', 'c'], 'b', 'a', 'after'),
    null,
    'b 已在 a 之后 ⇒ 拖到 a 的下半等于原位',
  )
  assert.equal(reorderKeys(['a', 'b'], 'a', 'not-there', 'before'), null, '落点不在列表里')
  assert.equal(reorderKeys(['a', 'b'], 'not-there', 'a', 'before'), null, '被拖项不在列表里')
})

test('reorderKeys: 跨范围（落点不在本列表）⇒ null，绝不产生跨容器 / 跨项目顺序', () => {
  // 这是「session 只能在同一容器内拖」的**计算侧**保证：容器 A 的顺序表里没有容器 B 的
  // 会话，所以即便 drop 事件被伪造也拼不出跨容器的顺序。
  const containerA = ['a1', 'a2']
  assert.equal(reorderKeys(containerA, 'a1', 'b1', 'before'), null, '落点是另一个容器的会话 ⇒ 拒绝')
  const projectX = ['/x/wt1', '/x/wt2']
  assert.equal(reorderKeys(projectX, '/x/wt1', '/y/wt1', 'after'), null, '落点是另一个项目的 worktree ⇒ 拒绝')
})

// ---------------------------------------------------------------------------
// D10：effectiveOrder（三层完整顺序，与 buildRows 同源）
// ---------------------------------------------------------------------------

test('effectiveOrder: 默认顺序（无 manualOrder）—— 项目保持传入序、worktree 保持宿主序、会话按 updatedAt 降序', () => {
  const rows = buildRows(
    input({
      projects: [
        project({
          key: '/repo/.git',
          title: 'Repo',
          worktrees: [
            worktree('/repo', { branch: 'main', isMain: true, sessions: [session('old', { updatedAt: 1 }), session('new', { updatedAt: 9 })] }),
            worktree('/repo-wt', { branch: 'feature/x', sessions: [session('w1', { updatedAt: 5 })] }),
          ],
        }),
      ],
    }),
  )
  // 注意：这里用 `effectiveOrder` 而不是 `buildRows` 的输出 —— 它不截断、不折叠。
  const order = effectiveOrder(input({
    projects: [
      project({
        key: '/repo/.git',
        title: 'Repo',
        worktrees: [
          worktree('/repo', { branch: 'main', isMain: true, sessions: [session('old', { updatedAt: 1 }), session('new', { updatedAt: 9 })] }),
          worktree('/repo-wt', { branch: 'feature/x', sessions: [session('w1', { updatedAt: 5 })] }),
        ],
      }),
    ],
  }))

  assert.deepEqual(order.projects, ['/repo/.git'], '项目 key = ProjectNode.key')
  assert.deepEqual(order.worktrees.get('/repo/.git'), ['/repo', '/repo-wt'], 'worktree 路径顺序')
  assert.deepEqual(
    order.sessions.get('w:/repo'),
    ['new', 'old'],
    '容器内的会话按 updatedAt 降序（与 buildRows 的默认排序同源）',
  )
  assert.deepEqual(order.sessions.get('w:/repo-wt'), ['w1'])
  assert.ok(rows.length > 0, '（buildRows 仍正常工作，二者不冲突）')
})

test('effectiveOrder: 应用 manualOrder 后三层都生效，且**不截断**（这是它相对 buildRows 的关键差异）', () => {
  const many = sessions(8, 's')  // 8 条 ⇒ buildRows 会截到 5 条
  const order = effectiveOrder(input({
    projects: [
      project({
        key: '/repo/.git',
        worktrees: [
          worktree('/repo', { branch: 'main', isMain: true, sessions: many }),
          worktree('/repo-wt', { branch: 'feature/x', sessions: [] }),
        ],
      }),
    ],
    manualOrder: {
      manual: true,
      worktrees: { '/repo/.git': ['/repo-wt', '/repo'] },
      sessions: { 'w:/repo': ['s7', 's0'] },
    },
  }))

  assert.deepEqual(order.worktrees.get('/repo/.git'), ['/repo-wt', '/repo'], 'worktree 手动顺序生效')
  assert.equal(order.sessions.get('w:/repo').length, 8, '**不截断**：8 条全在（buildRows 只会给 5 条）')
  assert.deepEqual(
    order.sessions.get('w:/repo').slice(0, 2),
    ['s7', 's0'],
    '手动排到前面的两项在最前，其余按默认（updatedAt 降序）追加',
  )
})

test('effectiveOrder: 未分组行不进 projects，但未分组的**会话**进 sessions（键 = p:__ungrouped__）', () => {
  const order = effectiveOrder(input({
    projects: [project({ key: '/repo/.git', worktrees: [worktree('/repo', { isMain: true, sessions: [] })] })],
    ungrouped: [session('u1'), session('u2')],
  }))

  assert.deepEqual(order.projects, ['/repo/.git'], '未分组不是真实项目 ⇒ 不进 projects')
  assert.deepEqual(
    order.sessions.get(`p:${UNGROUPED_KEY}`),
    ['u1', 'u2'],
    '未分组的会话照常进 sessions（它仍是可拖拽的容器）',
  )
})

test('effectiveOrder: 未分组**没有可见成员**时不建容器（与 buildRows 的存在性判据同源）', () => {
  const order = effectiveOrder(input({
    projects: [],
    ungrouped: [session('blank', { blank: true })],  // blank 且非当前 ⇒ 不可见
  }))
  assert.equal(
    order.sessions.has(`p:${UNGROUPED_KEY}`),
    false,
    '只有 blank（且非当前）⇒ 未分组容器不存在，也就不该有条目',
  )
})

test('effectiveOrder: 非 git 工作区的 flat 容器 key 就是项目行 key（p:<projectKey>）', () => {
  const order = effectiveOrder(input({
    projects: [
      project({
        key: 'ws:W1',
        isGit: false,
        title: 'Docs',
        worktrees: [],
        flatSessions: [session('d1', { updatedAt: 1 }), session('d2', { updatedAt: 2 })],
      }),
    ],
  }))
  assert.deepEqual(order.sessions.get('p:ws:W1'), ['d2', 'd1'], '平铺项目的容器 key = p:<projectKey>')
  assert.equal(order.worktrees.has('ws:W1'), false, '非 git 工作区没有 worktree 容器')
})

test('effectiveOrder: history 容器的会话也进 sessions（键 = h:<projectKey>）', () => {
  const order = effectiveOrder(input({
    projects: [
      project({
        key: '/repo/.git',
        worktrees: [worktree('/repo', { isMain: true, sessions: [] })],
        history: [session('h1', { updatedAt: 3 }), session('h2', { updatedAt: 7 })],
      }),
    ],
  }))
  assert.deepEqual(order.sessions.get('h:/repo/.git'), ['h2', 'h1'], 'history 桶按 updatedAt 降序')
})

// ---------------------------------------------------------------------------
// D10：buildRows 集成（手动顺序在树里生效）
// ---------------------------------------------------------------------------

test('buildRows: manualOrder.sessions ⇒ 该容器内的会话按手动顺序输出', () => {
  const rows = buildRows(
    input({
      projects: [
        project({
          key: '/repo/.git',
          title: 'Repo',
          worktrees: [worktree('/repo', { branch: 'main', isMain: true, sessions: sessions(3, 's') })],
        }),
      ],
      // 默认：s2, s1, s0（updatedAt 降序）
      manualOrder: { manual: true, sessions: { 'w:/repo': ['s0', 's2', 's1'] } },
    }),
  )

  const sessionRows = rows.filter((row) => row.kind === 'session')
  assert.deepEqual(
    sessionRows.map((row) => row.sessionId),
    ['s0', 's2', 's1'],
    '手动顺序生效（不再是 updatedAt 降序）',
  )
})

test('buildRows: 手动顺序**先于 5 条截断生效**（手动排到前面的项必须出现在前 5 条内）', () => {
  // 8 条会话，默认 updatedAt 升序 ⇒ s7 最新。把 s0（最旧）手动排到最前。
  const rows = buildRows(
    input({
      projects: [
        project({
          key: '/repo/.git',
          title: 'Repo',
          worktrees: [worktree('/repo', { branch: 'main', isMain: true, sessions: sessions(8, 's') })],
        }),
      ],
      manualOrder: { manual: true, sessions: { 'w:/repo': ['s0'] } },
    }),
  )

  const sessionRows = rows.filter((row) => row.kind === 'session')
  assert.equal(sessionRows.length, COLLAPSED_SESSION_LIMIT, '仍是 5 条截断')
  assert.equal(sessionRows[0].sessionId, 's0', '手动排到最前的 s0 出现在**第一条**（截断之后生效就会丢掉它）')
  assert.deepEqual(
    sessionRows.slice(1).map((row) => row.sessionId),
    ['s7', 's6', 's5', 's4'],
    '其余按默认 updatedAt 降序补齐到 5 条',
  )
  const more = rows.find((row) => row.kind === 'more')
  assert.equal(more.hiddenCount, 3, '8 - 5 = 3 条被隐藏')
})

test('buildRows: 手动顺序**完全决定**当前会话的位置（T13 已删除保底）', () => {
  // T13 用户终裁：拖拽顺序完全优先。当前会话 s0 被手动排在最后 ⇒ 它**就是**被截断
  // 到不可见（旧实现会把它保底提到前 5）。这是**有意行为**，不是缺陷。
  const rows = buildRows(
    input({
      projects: [
        project({
          key: '/repo/.git',
          title: 'Repo',
          worktrees: [worktree('/repo', { branch: 'main', isMain: true, sessions: sessions(8, 's') })],
        }),
      ],
      currentSessionId: 's0',
      manualOrder: { manual: true, sessions: { 'w:/repo': ['s7', 's6', 's5', 's4', 's3', 's2', 's1', 's0'] } },
    }),
  )

  const sessionRows = rows.filter((row) => row.kind === 'session')
  assert.equal(sessionRows.length, COLLAPSED_SESSION_LIMIT, '5 条')
  assert.deepEqual(
    sessionRows.map((row) => row.sessionId),
    ['s7', 's6', 's5', 's4', 's3'],
    '★ 逐字等于手动顺序前 5 条（s0 在第 8 位 ⇒ 不可见，无保底）',
  )
  assert.equal(
    sessionRows.some((row) => row.sessionId === 's0'),
    false,
    '★ 当前会话 s0 被手动排到末尾 ⇒ 不出现在渲染行里（用户已接受该副作用）',
  )
  assert.equal(rows.find((row) => row.kind === 'more').hiddenCount, 3, '8 - 5 = 3 条被隐藏')
})

test('buildRows: manualOrder.worktrees ⇒ 同一项目内的 worktree 按手动顺序输出', () => {
  const rows = buildRows(
    input({
      projects: [
        project({
          key: '/repo/.git',
          title: 'Repo',
          worktrees: [
            worktree('/repo', { branch: 'main', isMain: true, sessions: [session('m1')] }),
            worktree('/repo-a', { branch: 'feature/a', sessions: [session('a1')] }),
            worktree('/repo-b', { branch: 'feature/b', sessions: [session('b1')] }),
          ],
        }),
      ],
      manualOrder: { manual: true, worktrees: { '/repo/.git': ['/repo-b', '/repo', '/repo-a'] } },
    }),
  )

  assert.deepEqual(
    rows.filter((row) => row.kind === 'worktree').map((row) => row.path),
    ['/repo-b', '/repo', '/repo-a'],
    'worktree 手动顺序生效（不再是「主树在前 + 分支字典序」）',
  )
})

test('buildRows: manualOrder.projects ⇒ 顶层项目按手动顺序输出，新项目追加到末尾', () => {
  const rows = buildRows(
    input({
      projects: [
        project({ key: '/a/.git', title: 'A', worktrees: [worktree('/a', { isMain: true, sessions: [session('a1')] })] }),
        project({ key: '/b/.git', title: 'B', worktrees: [worktree('/b', { isMain: true, sessions: [session('b1')] })] }),
        project({ key: '/c/.git', title: 'C', worktrees: [worktree('/c', { isMain: true, sessions: [session('c1')] })] }),
      ],
      // 只手动排了 A 与 B；C 是「新项目」⇒ 追加到末尾。
      manualOrder: { manual: true, projects: ['/b/.git', '/a/.git'] },
    }),
  )

  assert.deepEqual(
    rows.filter((row) => row.kind === 'project').map((row) => row.label),
    ['B', 'A', 'C'],
    'B/A 按手动顺序，C（不在列表里）追加到末尾',
  )
})

test('buildRows: 未分组行永远在最后，且**不受** projects 手动顺序影响（它是静止边界）', () => {
  const rows = buildRows(
    input({
      projects: [
        project({ key: '/a/.git', title: 'A', worktrees: [worktree('/a', { isMain: true, sessions: [session('a1')] })] }),
      ],
      ungrouped: [session('u1')],
      // 即便有人把未分组的 key 塞进 projects，它也不是真实项目、不该被搬动。
      manualOrder: { manual: true, projects: [`${UNGROUPED_KEY}`, '/a/.git'] },
    }),
  )

  const labels = rows.filter((row) => row.kind === 'project').map((row) => row.label)
  assert.deepEqual(labels, ['A', 'section.ungrouped'], '未分组行仍排在最后')
})

test('buildRows: manual:false / 不传 manualOrder ⇒ 与改动前逐字一致（零回归）', () => {
  const build = (extra) => buildRows(
    input({
      projects: [
        project({
          key: '/repo/.git',
          title: 'Repo',
          worktrees: [
            worktree('/repo', { branch: 'main', isMain: true, sessions: sessions(3, 's') }),
            worktree('/repo-wt', { branch: 'feature/x', sessions: sessions(2, 'w') }),
          ],
          history: [session('h1')],
        }),
      ],
      ungrouped: [session('u1')],
      ...extra,
    }),
  )

  const withoutField = build({})
  const withUndefined = build({ manualOrder: undefined })
  const withManualFalse = build({
    // 结构合法但 manual:false —— 这是「用户没手动排过」的正常状态。
    manualOrder: {
      manual: false,
      projects: ['/repo/.git'],
      worktrees: { '/repo/.git': ['/repo-wt', '/repo'] },
      sessions: { 'w:/repo': ['s0', 's1', 's2'] },
    },
  })

  const summary = (rows) => rows.map((row) => `${row.kind}:${row.key}`)
  assert.deepEqual(summary(withUndefined), summary(withoutField), 'manualOrder: undefined ⇒ 零影响')
  assert.deepEqual(
    summary(withManualFalse),
    summary(withoutField),
    '**manual:false ⇒ 完全走默认顺序**（里面的顺序表一律被忽略，这是零回归的核心保证）',
  )
})

test('buildRows: 手动顺序里的会话被归档 / 删除 ⇒ 忽略，其余仍按手动顺序', () => {
  const rows = buildRows(
    input({
      projects: [
        project({
          key: '/repo/.git',
          title: 'Repo',
          worktrees: [worktree('/repo', { branch: 'main', isMain: true, sessions: sessions(3, 's') })],
        }),
      ],
      archivedSessionIds: ['s2'],
      manualOrder: { manual: true, sessions: { 'w:/repo': ['s2', 's0', 'gone', 's1'] } },
    }),
  )

  assert.deepEqual(
    rows.filter((row) => row.kind === 'session').map((row) => row.sessionId),
    ['s0', 's1'],
    's2 已归档（被过滤）、gone 已消失 ⇒ 都忽略；s0/s1 仍按手动顺序，无空洞',
  )
})

test('buildRows: 搜索模式**不应用**手动顺序（搜索结果按 updatedAt 降序更自然）', () => {
  const rows = buildRows(
    input({
      projects: [
        project({
          key: '/repo/.git',
          title: 'Repo',
          worktrees: [worktree('/repo', { branch: 'main', isMain: true, sessions: sessions(3, 's') })],
        }),
      ],
      query: 'T',
      manualOrder: { manual: true, sessions: { 'w:/repo': ['s0', 's1', 's2'] } },
    }),
  )

  assert.deepEqual(
    rows.map((row) => row.sessionId),
    ['s2', 's1', 's0'],
    '搜索模式仍按 updatedAt 降序（手动顺序只作用于树）',
  )
})

test('buildRows: 不修改入参（含 manualOrder 对象本身）', () => {
  const manualOrder = { manual: true, sessions: { 'w:/repo': ['s0', 's2', 's1'] } }
  const snapshot = JSON.stringify(manualOrder)
  const projects = [
    project({
      key: '/repo/.git',
      title: 'Repo',
      worktrees: [worktree('/repo', { branch: 'main', isMain: true, sessions: sessions(3, 's') })],
    }),
  ]
  const projectsSnapshot = projects[0].worktrees[0].sessions.map((s) => s.sessionId)

  buildRows(input({ projects, manualOrder }))

  assert.equal(JSON.stringify(manualOrder), snapshot, 'manualOrder 未被就地修改')
  assert.deepEqual(
    projects[0].worktrees[0].sessions.map((s) => s.sessionId),
    projectsSnapshot,
    '树数据里的 sessions 数组未被就地排序',
  )
})

// ---------------------------------------------------------------------------
// D10：「首次拖拽即固化全量顺序」—— 选项 A 的核心承诺
// ---------------------------------------------------------------------------

/**
 * 模拟渲染层 `commitDrag` 的**纯逻辑部分**（`sidebar.tsx` 是 `.tsx`，不进 `lib/`）：
 * 固化 → 重排 → 得到新的 ManualOrder。与 `sidebar.tsx` 的 `commitDrag` 逐行同构。
 */
function simulateDrag(input, active, over) {
  const defaults = effectiveOrder({ ...input, manualOrder: undefined })
  const existing = input.manualOrder
  const base = existing?.manual === true
    ? existing
    : {
        manual: true,
        projects: defaults.projects,
        worktrees: Object.fromEntries(defaults.worktrees),
        sessions: Object.fromEntries(defaults.sessions),
      }
  if (active.kind === 'session') {
    const key = active.containerKey
    const current = existing?.manual === true
      ? (existing.sessions?.[key] ?? defaults.sessions.get(key) ?? [])
      : (defaults.sessions.get(key) ?? [])
    const next = reorderKeys(current, active.itemId, over.key.slice(2), over.half)
    if (next === null) return null
    const sessions = { ...(base.sessions ?? {}) }
    sessions[key] = next
    return { ...base, manual: true, sessions }
  }
  if (active.kind === 'worktree') {
    const key = active.projectKey
    const current = existing?.manual === true
      ? (existing.worktrees?.[key] ?? defaults.worktrees.get(key) ?? [])
      : (defaults.worktrees.get(key) ?? [])
    const next = reorderKeys(current, active.itemId, over.key.slice(2), over.half)
    if (next === null) return null
    const worktrees = { ...(base.worktrees ?? {}) }
    worktrees[key] = next
    return { ...base, manual: true, worktrees }
  }
  const current = existing?.manual === true ? (existing.projects ?? defaults.projects) : defaults.projects
  const next = reorderKeys(current, active.itemId, over.key.slice(2), over.half)
  if (next === null) return null
  return { ...base, manual: true, projects: next }
}

/** 造一个「两个项目、各有会话」的树，用于固化测试。 */
function freezeFixture() {
  return input({
    projects: [
      project({
        key: '/a/.git',
        title: 'A',
        worktrees: [
          worktree('/a', { branch: 'main', isMain: true, sessions: [session('a-old', { updatedAt: 1 }), session('a-new', { updatedAt: 9 })] }),
          worktree('/a-wt', { branch: 'feature/x', sessions: [session('a-wt1', { updatedAt: 5 })] }),
        ],
      }),
      project({
        key: '/b/.git',
        title: 'B',
        worktrees: [worktree('/b', { branch: 'main', isMain: true, sessions: [session('b1', { updatedAt: 3 })] })],
      }),
    ],
    ungrouped: [session('u1', { updatedAt: 2 })],
  })
}

test('D10 固化: 第一次拖拽把**全部三层**顺序写进 manualOrder（不只是被拖那一项）', () => {
  const input0 = freezeFixture()
  const next = simulateDrag(input0, { kind: 'session', containerKey: 'w:/a', itemId: 'a-old' }, { key: 's:a-new', half: 'before' })

  assert.equal(next.manual, true, '首次拖拽置 manual:true')
  assert.deepEqual(next.projects, ['/a/.git', '/b/.git'], '项目顺序被固化（**不含**未分组）')
  assert.deepEqual(next.worktrees['/a/.git'], ['/a', '/a-wt'], 'worktree 顺序被固化')
  assert.deepEqual(next.worktrees['/b/.git'], ['/b'], '另一个项目的 worktree 也被固化')
  assert.deepEqual(next.sessions['w:/a'], ['a-old', 'a-new'], '被拖容器的新顺序')
  assert.deepEqual(next.sessions['w:/a-wt'], ['a-wt1'], '**其它容器**的顺序同样被固化（这是关键）')
  assert.deepEqual(next.sessions['w:/b'], ['b1'], '跨项目容器也被固化')
  assert.deepEqual(next.sessions[`p:${UNGROUPED_KEY}`], ['u1'], '未分组的会话也被固化')
})

test('D10 固化: 固化后新消息**不再**把会话顶到前面（选项 A 的核心承诺）', () => {
  const input0 = freezeFixture()
  const order = simulateDrag(input0, { kind: 'session', containerKey: 'w:/a', itemId: 'a-old' }, { key: 's:a-new', half: 'before' })
  assert.deepEqual(order.sessions['w:/a'], ['a-old', 'a-new'], '拖后：a-old 在前')

  // 之后 a-new 收到一条新消息（updatedAt 变成最大），但顺序**不该变**。
  const later = input({
    projects: [
      project({
        key: '/a/.git',
        title: 'A',
        worktrees: [
          worktree('/a', {
            branch: 'main',
            isMain: true,
            sessions: [session('a-old', { updatedAt: 1 }), session('a-new', { updatedAt: 9999 })],
          }),
          worktree('/a-wt', { branch: 'feature/x', sessions: [session('a-wt1', { updatedAt: 5 })] }),
        ],
      }),
      project({
        key: '/b/.git',
        title: 'B',
        worktrees: [worktree('/b', { branch: 'main', isMain: true, sessions: [session('b1', { updatedAt: 3 })] })],
      }),
    ],
    ungrouped: [session('u1', { updatedAt: 2 })],
    manualOrder: order,
  })

  const rows = buildRows(later)
  const containerRows = rows.filter((r) => r.kind === 'session' && r.parentKey === 'w:/a').map((r) => r.sessionId)
  assert.deepEqual(
    containerRows,
    ['a-old', 'a-new'],
    'a-new 的 updatedAt 变成最大，但**手动顺序仍然生效**（新消息不再把它顶到前面）—— 这就是选项 A 的承诺',
  )

  // 对照：没有 manualOrder 时，新消息确实会把它顶到最前（证明这个断言有意义）。
  const withoutOrder = buildRows(input({ ...later, manualOrder: undefined }))
  const defaultRows = withoutOrder.filter((r) => r.kind === 'session' && r.parentKey === 'w:/a').map((r) => r.sessionId)
  assert.deepEqual(defaultRows, ['a-new', 'a-old'], '默认模式下新消息确实顶到最前（对照组）')
})

test('D10 固化: 固化之后**新建的会话**落在容器末尾（顺序表里没有它）', () => {
  const input0 = freezeFixture()
  const order = simulateDrag(input0, { kind: 'session', containerKey: 'w:/a', itemId: 'a-old' }, { key: 's:a-new', half: 'before' })

  const later = input({
    ...freezeFixture(),
    manualOrder: order,
  })
  // 在 w:/a 里追加一条新会话（updatedAt 最大）。
  later.projects[0].worktrees[0].sessions.push(session('a-fresh', { updatedAt: 99999 }))

  const rows = buildRows(later)
  assert.deepEqual(
    rows.filter((r) => r.kind === 'session' && r.parentKey === 'w:/a').map((r) => r.sessionId),
    ['a-old', 'a-new', 'a-fresh'],
    '新会话追加到末尾（不是顶到最前）',
  )
})

test('D10 固化: 固化之后**新建的 worktree / 项目**同样落在末尾', () => {
  const input0 = freezeFixture()
  const order = simulateDrag(input0, { kind: 'project', itemId: '/b/.git' }, { key: 'p:/a/.git', half: 'before' })
  assert.deepEqual(order.projects, ['/b/.git', '/a/.git'], 'B 拖到 A 之前')

  const later = input({
    ...freezeFixture(),
    manualOrder: order,
  })
  // 新增一个项目 C 与 A 下的一个 worktree。
  later.projects.push(project({ key: '/c/.git', title: 'C', worktrees: [worktree('/c', { isMain: true, sessions: [session('c1')] })] }))
  // 按 key 找 A（`order.projects` 把 B 排到了前面，但 `later.projects` 的**数组顺序**没变）。
  const projectA = later.projects.find((p) => p.key === '/a/.git')
  projectA.worktrees.push(worktree('/a-wt2', { branch: 'feature/y', sessions: [session('a-wt2-1')] }))

  const rows = buildRows(later)
  assert.deepEqual(
    rows.filter((r) => r.kind === 'project').map((r) => r.label),
    ['B', 'A', 'C', 'section.ungrouped'],
    '新项目 C 追加到末尾；未分组仍在最后',
  )
  assert.deepEqual(
    rows.filter((r) => r.kind === 'worktree' && r.path.startsWith('/a')).map((r) => r.path),
    ['/a', '/a-wt', '/a-wt2'],
    '新 worktree 追加到该项目末尾',
  )
})

test('D10 固化: 「拖了但没变化」⇒ 不固化、不置 manual（原地抖一下鼠标不该切手动模式）', () => {
  const input0 = freezeFixture()
  // 默认顺序是 updatedAt 降序 ⇒ w:/a 里 a-new(9) 在前、a-old(1) 在后。
  // 把 a-new 拖到 a-old 的**上半** = 它本来就在那儿 ⇒ 无变化。
  const noop = simulateDrag(input0, { kind: 'session', containerKey: 'w:/a', itemId: 'a-new' }, { key: 's:a-old', half: 'before' })
  assert.equal(noop, null, '无变化 ⇒ 返回 null ⇒ 调用方不写 localStorage、不置 manual')

  // 对照：a-old 拖到 a-new 的**上半**是**真变化**（会把 a-old 提到最前），必须固化。
  const real = simulateDrag(input0, { kind: 'session', containerKey: 'w:/a', itemId: 'a-old' }, { key: 's:a-new', half: 'before' })
  assert.notEqual(real, null, '真变化 ⇒ 返回新顺序')
  assert.deepEqual(real.sessions['w:/a'], ['a-old', 'a-new'], 'a-old 被提到最前')
})

test('D10 固化: 跨容器拖拽在计算侧被拒（即便 drop 事件被伪造也拼不出跨容器顺序）', () => {
  const input0 = freezeFixture()
  // w:/a 的会话拖到 w:/a-wt 的会话上 —— 但 effectiveOrder 的 w:/a 列表里没有 a-wt1。
  const next = simulateDrag(input0, { kind: 'session', containerKey: 'w:/a', itemId: 'a-old' }, { key: 's:a-wt1', half: 'before' })
  assert.equal(next, null, '落点不在本容器的顺序表里 ⇒ 拒绝（计算侧硬约束）')
})

test('D10 固化: 跨项目拖拽 worktree 同样在计算侧被拒', () => {
  const input0 = freezeFixture()
  const next = simulateDrag(input0, { kind: 'worktree', projectKey: '/a/.git', itemId: '/a' }, { key: 'w:/b', half: 'before' })
  assert.equal(next, null, '落点不在本项目的 worktree 列表里 ⇒ 拒绝')
})

// ---------------------------------------------------------------------------
// 需求 B（2026-09-21 用户裁决）→ **T11（2026-09-22 用户终裁）删除「当前会话置顶」**
//
// ⚠️ 用户终裁原话：「正在运行的会话固定在顶部，拖不动，只要是结束了的会话就不再固定置顶了」，
// 并明确**不保留**「当前打开的会话」置顶例外。⇒ 本节的旧用例（isCurrent 置顶）已按终裁
// **删除**，替换为「已结束会话不置顶 / 拖到哪就留在哪」的回归锁。
//
// 仍然保留的不变式（与 `11b1144` 的承诺一致，**非当前**会话顺序逐字不变）：
// - **非当前、非运行中、非新会话**的已有会话收到新消息 ⇒ 顺序仍冻结；
// - 新会话仍落末尾（除非它是运行中的 / 未落表的）；
// - 置顶（现在只剩「运行中」与「未落表新会话」）**不写** `localStorage`。
// ---------------------------------------------------------------------------

/** 取某个容器（默认 `w:/repo`）的会话行 id。 */
function containerIds(rows, containerKey = 'w:/repo') {
  return rows.filter((row) => row.kind === 'session' && row.parentKey === containerKey).map((row) => row.sessionId)
}

test('T11: 已结束的当前会话**不再**置顶 —— 用户明确不保留该例外', () => {
  const rows = buildRows(
    input({
      projects: [
        project({
          key: '/repo/.git',
          title: 'Repo',
          worktrees: [worktree('/repo', { branch: 'main', isMain: true, sessions: sessions(8) })],
        }),
      ],
      currentSessionId: 's0',
      // 手动顺序把「当前会话」s0 明确排在**最后**。
      manualOrder: { manual: true, sessions: { 'w:/repo': ['s7', 's6', 's5', 's4', 's3', 's2', 's1', 's0'] } },
      // ⚠️ 显式展开：把 5 条截断**排除在断言之外**，单独观察「顶部区」语义。
      // 截断与持久顺序的交互由下方「T13/截断」用例单独锁定（T13 起无保底）。
      expandedAllKeys: { 'w:/repo': true },
    }),
  )

  assert.deepEqual(
    containerIds(rows),
    ['s7', 's6', 's5', 's4', 's3', 's2', 's1', 's0'],
    '★ 当前会话 s0 **不再**被提到第一位（旧实现为 [s0, s7, …]）；顺序 = 持久顺序逐字一致',
  )
})

test('T11: 当前会话**正在运行**时仍被置顶（判据是 running，不是 isCurrent）', () => {
  const list = sessions(8)
  list[0] = session('s0', { updatedAt: 1000, running: true, title: 'T0' })
  const rows = buildRows(
    input({
      projects: [
        project({
          key: '/repo/.git',
          title: 'Repo',
          worktrees: [worktree('/repo', { branch: 'main', isMain: true, sessions: list })],
        }),
      ],
      currentSessionId: 's0',
      manualOrder: { manual: true, sessions: { 'w:/repo': ['s7', 's6', 's5', 's4', 's3', 's2', 's1', 's0'] } },
      topZone: topZoneOf({ runningSessionIds: ['s0'] }),
    }),
  )

  const ids = containerIds(rows)
  assert.equal(ids[0], 's0', '★ 运行中的当前会话置顶（这条来自 running 判据，与 isCurrent 无关）')
  assert.equal(ids.length, COLLAPSED_SESSION_LIMIT, '仍是 5 条截断')
})

test('T11: 非 blank 的当前会话同样**不**置顶（旧「正在对话的会话」例外已删除）', () => {
  const rows = buildRows(
    input({
      projects: [
        project({
          key: '/repo/.git',
          title: 'Repo',
          worktrees: [worktree('/repo', { branch: 'main', isMain: true, sessions: sessions(8) })],
        }),
      ],
      currentSessionId: 's0', // 非 blank、updatedAt 最小
      manualOrder: { manual: true, sessions: { 'w:/repo': ['s7', 's6', 's5', 's4', 's3', 's2', 's1', 's0'] } },
      expandedAllKeys: { 'w:/repo': true },
    }),
  )

  const current = rows.find((row) => row.sessionId === 's0')
  assert.equal(current.blank, false, '该会话不是 blank')
  assert.equal(containerIds(rows)[0], 's7', '★ 第一位是持久顺序的第一条，不是当前会话（isCurrent 例外已删除）')
  assert.equal(containerIds(rows).at(-1), 's0', '★ 当前会话留在其持久顺序位置（最后一位）')
})

test('D5 回归: 非当前、非运行中的新会话仍落在末尾（11b1144 的承诺保持不变）', () => {
  const later = input({
    projects: [
      project({
        key: '/repo/.git',
        title: 'Repo',
        worktrees: [worktree('/repo', { branch: 'main', isMain: true, sessions: sessions(3) })],
      }),
    ],
    currentSessionId: 's0',
    manualOrder: { manual: true, sessions: { 'w:/repo': ['s0', 's1', 's2'] } },
  })
  // 新会话（updatedAt 最大）加进来，但它**不是**当前会话。
  later.projects[0].worktrees[0].sessions.push(session('fresh', { updatedAt: 99999 }))

  const rows = buildRows(later)
  assert.deepEqual(
    containerIds(rows),
    ['s0', 's1', 's2', 'fresh'],
    '非当前的新会话仍追加到末尾 —— 只有 isCurrent 会被提升',
  )
})

test('D5 回归: 已持久化的非当前会话收到新消息 ⇒ 顺序仍冻结（11b1144 核心承诺）', () => {
  const order = { manual: true, sessions: { 'w:/repo': ['s0', 's1', 's2'] } }
  const rows = buildRows(
    input({
      projects: [
        project({
          key: '/repo/.git',
          title: 'Repo',
          worktrees: [
            worktree('/repo', {
              branch: 'main',
              isMain: true,
              // s2 收到新消息（updatedAt 变成最大），但它是**非当前**会话。
              sessions: [session('s0', { updatedAt: 10 }), session('s1', { updatedAt: 20 }), session('s2', { updatedAt: 9999 })],
            }),
          ],
        }),
      ],
      currentSessionId: 's0',
      manualOrder: order,
    }),
  )

  assert.deepEqual(
    containerIds(rows),
    ['s0', 's1', 's2'],
    's2 的 updatedAt 最大，但手动顺序仍生效（只有 s0 因 isCurrent 置顶，它本来就在第一位）',
  )
})

test('T11: 置顶项已在第一位时顺序逐字不变（不产生无谓搬运）', () => {
  const order = { manual: true, sessions: { 'w:/repo': ['s1', 's0', 's2'] } }
  const rows = buildRows(
    input({
      projects: [
        project({
          key: '/repo/.git',
          title: 'Repo',
          worktrees: [worktree('/repo', { branch: 'main', isMain: true, sessions: sessions(3) })],
        }),
      ],
      currentSessionId: 's1',
      manualOrder: order,
    }),
  )

  assert.deepEqual(containerIds(rows), ['s1', 's0', 's2'], 's1 本来就是手动顺序第一位 ⇒ 结果不变')
})

test('T11: 运行中的会话**只在其所属容器**内置顶（不跨容器）', () => {
  const rows = buildRows(
    input({
      projects: [
        project({
          key: '/a/.git',
          title: 'A',
          worktrees: [
            worktree('/a', { branch: 'main', isMain: true, sessions: sessions(3, 'a') }),
            worktree('/a-wt', { branch: 'feature/x', sessions: sessions(3, 'b') }),
          ],
        }),
      ],
      currentSessionId: 'b0',
      manualOrder: {
        manual: true,
        sessions: {
          'w:/a': ['a2', 'a1', 'a0'],
          'w:/a-wt': ['b2', 'b1', 'b0'],
        },
      },
      // b0 在跑 ⇒ 只在 w:/a-wt 内置顶。
      topZone: topZoneOf({ runningSessionIds: ['b0'] }),
    }),
  )

  assert.deepEqual(containerIds(rows, 'w:/a-wt'), ['b0', 'b2', 'b1'], '运行中的 b0 在其容器内置顶')
  assert.deepEqual(containerIds(rows, 'w:/a'), ['a2', 'a1', 'a0'], '另一个容器完全不受影响（置顶不跨容器）')
})

test('T11: 当前会话是子代理（不在可见集里）⇒ 无任何置顶，不崩', () => {
  const rows = buildRows(
    input({
      projects: [
        project({
          key: '/repo/.git',
          title: 'Repo',
          worktrees: [
            worktree('/repo', {
              branch: 'main',
              isMain: true,
              sessions: [...sessions(3), subagent('sub-current', 's0', { running: true })],
            }),
          ],
        }),
      ],
      // 当前会话是子代理 ⇒ 它自己不渲染。T11 起 isCurrent 本来就不参与置顶 ⇒ 顺序纯按持久表。
      currentSessionId: 'sub-current',
      manualOrder: { manual: true, sessions: { 'w:/repo': ['s2', 's1', 's0'] } },
    }),
  )

  assert.deepEqual(containerIds(rows), ['s2', 's1', 's0'], '顺序完全按手动顺序（isCurrent 已不参与置顶）')
})

test('T11: 未分组容器同样适用顶部区（容器内语义，无需特判）', () => {
  const rows = buildRows(
    input({
      ungrouped: [...sessions(3, 'u')],
      currentSessionId: 'u0',
      manualOrder: { manual: true, sessions: { [`p:${UNGROUPED_KEY}`]: ['u2', 'u1', 'u0'] } },
      topZone: topZoneOf({ runningSessionIds: ['u0'] }),
    }),
  )

  assert.deepEqual(
    containerIds(rows, `p:${UNGROUPED_KEY}`),
    ['u0', 'u2', 'u1'],
    '未分组容器的运行中会话同样置顶（容器内语义）',
  )
})

test('T11: 顶部区不改变 project / worktree 容器行自身的顺序', () => {
  const rows = buildRows(
    input({
      projects: [
        project({
          key: '/a/.git',
          title: 'A',
          worktrees: [
            worktree('/a', { branch: 'main', isMain: true, sessions: [session('a-cur', { updatedAt: 1 })] }),
            worktree('/a-wt', { branch: 'feature/x', sessions: [session('a-wt1', { updatedAt: 9 })] }),
          ],
        }),
        project({ key: '/b/.git', title: 'B', worktrees: [worktree('/b', { branch: 'main', isMain: true, sessions: [session('b1')] })] }),
      ],
      currentSessionId: 'a-cur',
      manualOrder: { manual: true, projects: ['/b/.git', '/a/.git'], worktrees: { '/a/.git': ['/a-wt', '/a'] } },
    }),
  )

  assert.deepEqual(
    rows.filter((row) => row.kind === 'project').map((row) => row.label),
    ['B', 'A'],
    '项目行顺序完全按手动顺序（置顶不作用于容器行）',
  )
  assert.deepEqual(
    rows.filter((row) => row.kind === 'worktree').map((row) => row.path),
    ['/b', '/a-wt', '/a'],
    'worktree 行顺序同样不受置顶影响（B 项目下的 /b 与 A 项目下的两个 worktree 都按各自容器顺序输出）',
  )
})

test('T11: 搜索模式不应用顶部区（与「不应用手动顺序」保持一致）', () => {
  const rows = buildRows(
    input({
      projects: [
        project({
          key: '/repo/.git',
          title: 'Repo',
          worktrees: [
            worktree('/repo', {
              branch: 'main',
              isMain: true,
              sessions: [session('old', { updatedAt: 1, title: 'needle-old' }), session('new', { updatedAt: 9, title: 'needle-new' })],
            }),
          ],
        }),
      ],
      currentSessionId: 'old',
      query: 'needle',
    }),
  )

  assert.deepEqual(
    rows.map((row) => row.sessionId),
    ['new', 'old'],
    '搜索恒按 updatedAt 降序（跨容器扁平结果里「容器内第一」没有意义）',
  )
})

test('T11: `effectiveOrder` **不**应用运行时顶部区 —— 固化进 localStorage 的顺序不含置顶', () => {
  const list = [...sessions(8)]
  list[0] = session('s0', { updatedAt: 1000, running: true, title: 'T0' }) // 运行中、updatedAt 最旧
  const base = input({
    projects: [
      project({
        key: '/repo/.git',
        title: 'Repo',
        worktrees: [worktree('/repo', { branch: 'main', isMain: true, sessions: list })],
      }),
    ],
    currentSessionId: 's0',
    // 运行时顶部区：s0 在跑（这是 T11 唯一剩下的置顶类别之一）。
    topZone: topZoneOf({ runningSessionIds: ['s0'] }),
  })

  // ① 默认模式下：effectiveOrder 返回的是**纯 updatedAt 降序**，s0 在**最后**。
  const defaultOrder = effectiveOrder({ ...base, manualOrder: undefined })
  assert.deepEqual(
    defaultOrder.sessions.get('w:/repo'),
    ['s7', 's6', 's5', 's4', 's3', 's2', 's1', 's0'],
    'effectiveOrder 不含任何运行时置顶（否则「运行中置顶」会被固化进 localStorage）',
  )

  // ② 手动模式下：完全按顺序表，s0 仍在最后。
  const manual = { manual: true, sessions: { 'w:/repo': ['s7', 's6', 's5', 's4', 's3', 's2', 's1', 's0'] } }
  const manualOrder = effectiveOrder({ ...base, manualOrder: manual })
  assert.deepEqual(
    manualOrder.sessions.get('w:/repo'),
    ['s7', 's6', 's5', 's4', 's3', 's2', 's1', 's0'],
    '手动模式下 effectiveOrder 同样不含置顶',
  )

  // ③ 对照：同一个入参走 buildRows（渲染路径）时 s0 确实被置顶 ⇒ 两条路径**有意不同**。
  const rendered = buildRows({ ...base, manualOrder: manual })
  assert.equal(containerIds(rendered)[0], 's0', '渲染路径置顶（运行中）；固化路径不置顶 —— 关键设计点')
})

test('T11: 首次拖拽固化的顺序**不含**置顶（simulateDrag 与 sidebar.commitDrag 同构）', () => {
  const input0 = input({
    projects: [
      project({
        key: '/a/.git',
        title: 'A',
        worktrees: [
          worktree('/a', {
            branch: 'main',
            isMain: true,
            sessions: [session('a-old', { updatedAt: 1 }), session('a-mid', { updatedAt: 5 }), session('a-new', { updatedAt: 9 })],
          }),
        ],
      }),
    ],
    currentSessionId: 'a-mid', // 当前会话是中间那条
    // 运行时顶部区：a-mid 正在跑 ⇒ 渲染期会被置顶。固化路径必须忽略它。
    topZone: topZoneOf({ runningSessionIds: ['a-mid'] }),
  })

  const order = simulateDrag(input0, { kind: 'session', containerKey: 'w:/a', itemId: 'a-old' }, { key: 's:a-new', half: 'before' })
  assert.notEqual(order, null, '这是一次真变化（a-old 从最后被拖到最前）')
  // 固化用的是 `effectiveOrder`（**不含**任何运行时置顶）⇒ 结果纯粹反映拖拽本身。
  // 若固化路径也置顶，运行中的 a-mid 会被钉在第 1 位并写进 localStorage（这正是要避免的）。
  assert.deepEqual(
    order.sessions['w:/a'],
    ['a-old', 'a-new', 'a-mid'],
    '固化结果不含运行时置顶 —— 当时正在跑的 a-mid 不会被打死在第一位',
  )
  assert.notEqual(order.sessions['w:/a'][0], 'a-mid', '第 1 位是拖过去的 a-old，不是运行中的 a-mid')

  // 对照：同一个入参走**渲染**路径时，a-mid 确实被置顶 ⇒ 两条路径有意不同。
  const rendered = buildRows({ ...input0, manualOrder: order })
  assert.equal(containerIds(rendered, 'w:/a')[0], 'a-mid', '渲染路径置顶（a-mid 在跑），但持久顺序里没有它')
})

test('T11: `JSON.stringify(order)` 的持久化载荷里**没有**置顶痕迹（localStorage 写入值）', () => {
  // `sidebar.tsx` 的 `writeManualOrder` 写的就是 `JSON.stringify(order)`，所以直接断言它
  // 就能证明「置顶不写进 localStorage」—— 无需 DOM / localStorage 打桩。
  const input0 = input({
    projects: [
      project({
        key: '/a/.git',
        title: 'A',
        worktrees: [
          worktree('/a', {
            branch: 'main',
            isMain: true,
            sessions: [session('a-old', { updatedAt: 1 }), session('a-mid', { updatedAt: 5 }), session('a-new', { updatedAt: 9 })],
          }),
        ],
      }),
    ],
    currentSessionId: 'a-mid',
  })

  const order = simulateDrag(input0, { kind: 'session', containerKey: 'w:/a', itemId: 'a-old' }, { key: 's:a-new', half: 'before' })
  const payload = JSON.parse(JSON.stringify(order))

  // ① 载荷里没有「置顶」这类字段（结构仍是冻结的 `ManualOrder`）。
  assert.deepEqual(Object.keys(payload).sort(), ['manual', 'projects', 'sessions', 'worktrees'], '载荷字段集合不变')
  assert.equal('pinned' in payload, false, '不新增 pinned 字段')
  // ② 顺序表内容就是 effectiveOrder 的产物，第一项不是当前会话。
  assert.deepEqual(payload.sessions['w:/a'], ['a-old', 'a-new', 'a-mid'], '写入值不含置顶')
  // ③ 关掉当前会话（换一个 currentSessionId）后，渲染顺序必须与载荷一致 ⇒ 证明置顶没被固化。
  const afterClose = buildRows({ ...input0, currentSessionId: 'a-old', manualOrder: payload })
  assert.deepEqual(
    containerIds(afterClose, 'w:/a'),
    payload.sessions['w:/a'],
    '换一个当前会话后，渲染顺序回到持久顺序本身（置顶随 currentSessionId 消失）',
  )
})


// ---------------------------------------------------------------------------
// T5（2026-09-21 用户裁决）→ **T11（2026-09-22 用户终裁）收窄**：顶部区 + 新会话插入固化表
//
// ⚠️ T11 终裁后，本节只保留仍然成立的语义：
// 判据（T11）= `running`（含任意层级运行中的子代理）∪ `新会话`。
// 「刚结束保留」「当前会话置顶」「拖动释放」三类**已删除**（见文件末尾的 T11 段）。
//
// 背景：用户报告「新会话 / 刚结束的会话掉到侧栏最下面」。T4 调研确证根因是
// **手动排序模式**下 `applyManualOrder` 把「不在持久顺序表里」的会话一律追加到末尾
// （`docs/RESEARCH-session-drop-to-bottom.md` §3）。本组测试锁定修复。
//
// 判据（T11）：`running`（含任意层级运行中的子代理）∪ `新会话`。
// 时机：**5 条截断之前**生效（⚠️ 措辞准确化，T13 的 N-6：这**不**等于「一定可见」——
// 顶部区成员超过 5 条时超出的部分仍会被截断，见 `T5/截断: 顶部区成员数 > 5 时…`）。
// 持久化：运行时置顶**不写** `localStorage`；**只有 D2 的新会话插入**允许落表。
// ---------------------------------------------------------------------------

/** 造一个「单 worktree 项目 + 指定会话列表」的树。 */
function topZoneFixture(list, overrides = {}) {
  return input({
    projects: [
      project({
        key: '/repo/.git',
        title: 'Repo',
        worktrees: [worktree('/repo', { branch: 'main', isMain: true, sessions: list })],
      }),
    ],
    ...overrides,
  })
}

/** `tree-model.ts` 的 `normalizeSessionId` 在测试侧的同式复刻（仅用于断言轨迹表的键）。 */
const normalize = (id) => (id.startsWith('session-') ? id.slice('session-'.length) : id)

/** 取顶部区输入的便捷构造（模拟 `sidebar.tsx` 从状态机投影）。 */
const topZoneOf = (overrides = {}) => ({
  runningSessionIds: [],
  newSessionIds: [],
  ...overrides,
})

// ── D3a：正在运行的会话（含仅 subagent 在跑）位于顶部区 ─────────────────────

test('T5/D3a: 自身 running 的会话进顶部区（手动模式下不再掉底）', () => {
  const list = [session('o0', { updatedAt: 50 }), session('o1', { updatedAt: 40 }), session('run', { updatedAt: 1, running: true })]
  const rows = buildRows(
    topZoneFixture(list, {
      manualOrder: { manual: true, sessions: { 'w:/repo': ['o0', 'o1', 'run'] } },
      topZone: topZoneOf({ runningSessionIds: ['run'] }),
    }),
  )

  assert.deepEqual(containerIds(rows), ['run', 'o0', 'o1'], 'running 的会话被提到顶部区第一位（它 updatedAt 最旧）')
})

test('T5/D3a: **仅 subagent 在跑**（父自身 idle）⇒ 父会话进顶部区（T4 §4.4 的缺口）', () => {
  // T4 已确证 `updatedAt` 不随 subagent 活动推进 ⇒ 只靠排序键无法浮起。顶部区必须覆盖它。
  const list = [
    session('o0', { updatedAt: 50 }),
    session('p', { updatedAt: 1, running: false }),
    subagent('c', 'p', { updatedAt: 2, running: true }),
  ]
  const rows = buildRows(
    topZoneFixture(list, {
      manualOrder: { manual: true, sessions: { 'w:/repo': ['o0', 'p'] } },
      topZone: topZoneOf({ runningSessionIds: ['p'] }),
    }),
  )

  const parent = rows.find((row) => row.sessionId === 'p')
  assert.equal(parent.running, true, '需求 A：父行 running 为 true（子代理聚合）')
  assert.equal(parent.subagentCount, 1, '计数胶囊仍为 1')
  assert.deepEqual(containerIds(rows), ['p', 'o0'], '仅 subagent 在跑的父会话也进顶部区')
})

test('T5/D3a: `observationsOf` 的 running 是**聚合**口径（只有 subagent 在跑也算）', () => {
  const observations = observationsOf(
    topZoneFixture([
      session('p', { updatedAt: 1, running: false }),
      subagent('c', 'p', { updatedAt: 2, running: true }),
    ]),
  )
  const parent = observations.find((o) => o.sessionId === 'p')
  assert.equal(parent.running, true, 'observationsOf 用与 toSessionRow 同式的聚合口径')
  assert.equal(parent.subagent, false, '父会话不是子代理')
  assert.equal(observations.find((o) => o.sessionId === 'c').subagent, true, '子代理被标记')
})

test('T5/D3a: 顶部区**先于** 5 条截断生效 ⇒ 运行中的会话必进前 5（顶部区成员未超限时）', () => {
  // ⚠️ N-6 措辞准确化：本用例的**前提**是「顶部区成员数 ≤ 5」。若顶部区成员 > 5，
  // 超出的部分仍会被截断（见 `T5/截断: 顶部区成员数 > 5 时，只有前 5 条可见`）。
  const list = [...sessions(8, 'o'), session('run', { updatedAt: 1, running: true })]
  const rows = buildRows(
    topZoneFixture(list, {
      manualOrder: { manual: true, sessions: { 'w:/repo': [...sessions(8, 'o').map((s) => s.sessionId), 'run'] } },
      topZone: topZoneOf({ runningSessionIds: ['run'] }),
    }),
  )

  const ids = containerIds(rows)
  assert.equal(ids.length, COLLAPSED_SESSION_LIMIT, '仍是 5 条截断')
  assert.equal(ids[0], 'run', '运行中的会话必进前 5 且在第 1 位')
  assert.equal(rows.find((row) => row.kind === 'more').hiddenCount, 4, '9 - 5 = 4 条被隐藏')
})

test('T5/D3a: 正在运行的会话**不在**本容器 ⇒ 不误置顶到别的容器', () => {
  const rows = buildRows(
    input({
      projects: [
        project({
          key: '/repo/.git',
          title: 'Repo',
          worktrees: [
            worktree('/repo', { branch: 'main', isMain: true, sessions: [session('a1', { updatedAt: 5 }), session('a2', { updatedAt: 1 })] }),
            worktree('/repo-wt', { branch: 'feat', sessions: [session('b1', { updatedAt: 9 }), session('b2', { updatedAt: 2 })] }),
          ],
        }),
      ],
      manualOrder: {
        manual: true,
        sessions: { 'w:/repo': ['a1', 'a2'], 'w:/repo-wt': ['b1', 'b2'] },
      },
      // `b2` 在跑 ⇒ 只应影响 `w:/repo-wt`。
      topZone: topZoneOf({ runningSessionIds: ['b2'] }),
    }),
  )

  assert.deepEqual(containerIds(rows, 'w:/repo'), ['a1', 'a2'], '另一个容器完全不受影响')
  assert.deepEqual(containerIds(rows, 'w:/repo-wt'), ['b2', 'b1'], '运行中的会话在其**自己的**容器内置顶')
})

// ── T11：已结束的会话**不再固定置顶**（「刚结束保留」与「当前会话置顶」已删除）─────
//
// 用户终裁（2026-09-22，第二轮真人 GUI 复验）：
// > 正在运行的会话固定在顶部，拖不动，只要是结束了的会话就不再固定置顶了。
//
// ⇒ 下列机制已按终裁**整体删除**（不是收窄）：
// ① 「刚结束保留」（`recentlyFinishedIds` / `recentlyFinishedSessionIds`）；
// ② 「当前打开的会话置顶」（`isCurrent` 置顶）；
// ③ 「拖动释放」（`releasedContainerKeys` / `releaseTopZoneContainer` /
//    `isTopZoneReleasingDrag`）—— 它的唯一目的是清除 ①，① 删除后它失去全部语义。
// 本节的用例把这三条**锁定为不存在**（字段缺失 + 行为断言），防止悄悄回退。

test('T11: 状态机里**没有** `recentlyFinishedIds` 字段（「刚结束保留」已删除）', () => {
  const state = initialTopZoneState()
  assert.equal('recentlyFinishedIds' in state, false, '★ 初值不含该字段')
  assert.deepEqual(
    Object.keys(state).sort(),
    ['baselined', 'blankOf', 'knownSessionIds', 'newSessionIds', 'runningOf', 'startedAtMs', 'writtenNewSessionIds'],
    '★ 状态字段集合 = 终裁后的最小集（D2 台账保留，其余运行时保留字段已删）',
  )

  // 观测一次 running 下降沿 ⇒ 旧实现会写 recentlyFinishedIds，现在必须什么都不产生。
  let s = observeTopZone(initialTopZoneState(), observationsOf(topZoneFixture([session('done1', { updatedAt: 1, running: true })])), 1000)
  s = observeTopZone(s, observationsOf(topZoneFixture([session('done1', { updatedAt: 1, running: false })])), 2000)
  assert.equal('recentlyFinishedIds' in s, false, '★ 下降沿后仍无该字段')
  assert.equal(s.runningOf.done1, false, '运行轨迹如实记录「现在不跑了」')
})

test('T11: 运行结束的会话**掉出顶部区**，回到它的持久顺序位置（不再固定置顶）', () => {
  let state = initialTopZoneState()
  state = observeTopZone(state, observationsOf(topZoneFixture([session('o0', { updatedAt: 50 }), session('done1', { updatedAt: 1, running: true })])), 1000)
  state = observeTopZone(state, observationsOf(topZoneFixture([session('o0', { updatedAt: 50 }), session('done1', { updatedAt: 1, running: false })])), 2000)

  const rows = buildRows(
    topZoneFixture([session('o0', { updatedAt: 50 }), session('done1', { updatedAt: 1 })], {
      manualOrder: { manual: true, sessions: { 'w:/repo': ['o0', 'done1'] } },
      topZone: topZoneInputOf(state),
    }),
  )
  assert.deepEqual(
    containerIds(rows),
    ['o0', 'done1'],
    '★ 已结束的 done1 **不再**被提到顶部区（旧实现为 [done1, o0]）—— 位置 = 持久顺序',
  )
})

test('T11: **当前会话不再置顶** —— 用户明确选择不保留该例外', () => {
  // `cur` 既不是运行中、也不在 newSessionIds 里 ⇒ 必须留在它自己的持久顺序位置。
  const list = [session('o0', { updatedAt: 10 }), session('run', { updatedAt: 5, running: true }), session('cur', { updatedAt: 1 })]
  const rows = buildRows(
    topZoneFixture(list, {
      currentSessionId: 'cur',
      manualOrder: { manual: true, sessions: { 'w:/repo': ['o0', 'run', 'cur'] } },
      topZone: topZoneOf({ runningSessionIds: ['run'] }),
    }),
  )

  const ids = containerIds(rows)
  assert.equal(ids[0], 'run', '★ 顶部区第一位是**运行中**的会话（不再是当前会话）')
  assert.deepEqual(ids, ['run', 'o0', 'cur'], '★ 当前会话 cur 留在持久顺序末位（旧实现把它置顶到第一位）')
})

test('T11: 当前会话**正在运行**时照常置顶（那是 running 判据，不是 isCurrent 例外）', () => {
  const list = [session('o0', { updatedAt: 10 }), session('cur', { updatedAt: 1, running: true })]
  const rows = buildRows(
    topZoneFixture(list, {
      currentSessionId: 'cur',
      manualOrder: { manual: true, sessions: { 'w:/repo': ['o0', 'cur'] } },
      topZone: topZoneOf({ runningSessionIds: ['cur'] }),
    }),
  )
  assert.deepEqual(containerIds(rows), ['cur', 'o0'], '运行中的当前会话置顶（判据是 running，与 isCurrent 无关）')
})

test('T11: 未传 `topZone` ⇒ **完全无置顶**（零回归分支：不再有任何 isCurrent 置顶）', () => {
  const list = [session('o0', { updatedAt: 10 }), session('cur', { updatedAt: 1 })]
  const manualOrder = { manual: true, sessions: { 'w:/repo': ['o0', 'cur'] } }
  const rows = buildRows(topZoneFixture(list, { currentSessionId: 'cur', manualOrder }))

  assert.deepEqual(
    containerIds(rows),
    ['o0', 'cur'],
    '★ 不传 topZone ⇒ 逐字按持久顺序（T2 的 isCurrent 置顶已随终裁删除）',
  )
})

// ── 顶部区内部按 updatedAt 降序（确定性） ───────────────────────────────────

test('T11: 顶部区内多个运行中会话按 `updatedAt` 降序（sessionId 升序 tiebreak）', () => {
  const list = [
    session('runOld', { updatedAt: 10, running: true }),
    session('runNew', { updatedAt: 30, running: true }),
    session('o', { updatedAt: 999 }),
  ]
  const rows = buildRows(
    topZoneFixture(list, {
      manualOrder: { manual: true, sessions: { 'w:/repo': ['o', 'runOld', 'runNew'] } },
      topZone: topZoneOf({ runningSessionIds: ['runOld', 'runNew'] }),
    }),
  )

  assert.deepEqual(
    containerIds(rows),
    ['runNew', 'runOld', 'o'],
    '顶部区内部按 updatedAt 降序（30 → 10），非顶部区项按手动顺序跟随',
  )
})

test('T11: 顶部区内 updatedAt 相同时按 sessionId 升序（与 byRecency 同源、确定性）', () => {
  const list = [session('b', { updatedAt: 7, running: true }), session('a', { updatedAt: 7, running: true })]
  const rows = buildRows(
    topZoneFixture(list, {
      manualOrder: { manual: true, sessions: { 'w:/repo': ['b', 'a'] } },
      topZone: topZoneOf({ runningSessionIds: ['a', 'b'] }),
    }),
  )

  assert.deepEqual(containerIds(rows), ['a', 'b'], '同 updatedAt ⇒ sessionId 升序 tiebreak')
})

// ── T11：拖拽释放机制已删除（无 `releasedContainerKeys` 消费者）───────────────

test('T11: `topZoneSessionKeys` 不再读 `releasedContainerKeys`（该字段已从契约删除）', () => {
  const list = [session('run', { updatedAt: 5, running: true }), session('done1', { updatedAt: 1 })]
  // 即便契约外传入这个**已废弃**的字段，也不得改变任何结果（旧实现会因它清掉「刚结束保留」）。
  const withStaleField = topZoneSessionKeys(list, undefined, 'w:/repo', {
    runningSessionIds: ['run'],
    releasedContainerKeys: ['w:/repo'],
  })
  const withoutField = topZoneSessionKeys(list, undefined, 'w:/repo', { runningSessionIds: ['run'] })

  assert.deepEqual(withStaleField, ['run'], '只有运行中的会话被置顶')
  assert.deepEqual(withStaleField, withoutField, '★ 已废弃字段不再有任何效果')
})

test('T11: 已结束的会话**不在顶部区**，因此拖拽判据不可能把它搬回去', () => {
  // 这是本轮**首要缺陷**在纯函数层的根因锁定：旧实现里 `recentlyFinishedSessionIds`
  // 把已结束的会话钉在顶部区 ⇒ `buildRows` 无论持久顺序怎么写都把它画回最前。
  const list = [session('o0', { updatedAt: 10 }), session('done1', { updatedAt: 1 })]
  const manualOrder = { manual: true, sessions: { 'w:/repo': ['done1', 'o0'] } }
  const rows = buildRows(
    topZoneFixture(list, { manualOrder, topZone: topZoneOf({ runningSessionIds: [] }) }),
  )
  assert.deepEqual(
    containerIds(rows),
    ['done1', 'o0'],
    '★ 已结束的会话位置 100% 由持久顺序决定（用户拖到最前就是最前）',
  )
})


// ── D2：新会话判定口径 + 插入固化表 ────────────────────────────────────────

test('T5/D2: 「新会话」判据 = 本进程内观测到 blank: true → 非 blank（时间序证据）', () => {
  let state = initialTopZoneState()
  // 基线：`new1` 此刻还是 blank。
  state = observeTopZone(state, observationsOf(topZoneFixture([session('old', { updatedAt: 5 }), session('new1', { updatedAt: 9000, blank: true })])), 1000)
  assert.deepEqual(state.newSessionIds, [], '基线里已知的会话一律不判为新会话（哪怕它是 blank）')

  // 用户发了第一条消息 ⇒ blank 翻 false。
  state = observeTopZone(state, observationsOf(topZoneFixture([session('old', { updatedAt: 5 }), session('new1', { updatedAt: 9000, blank: false })])), 2000)
  assert.deepEqual(state.newSessionIds, ['new1'], 'blank → 非 blank ⇒ 判为新会话')
})

test('T5/D2: **旧的表外会话绝不被判为新会话**（T4 §3.2 的 4 条旧会话回归）', () => {
  // T4 实测：真实表里 6 条可见顶层会话不在固化表中，其中 4 条**早于固化水位**。
  // 本测试复现「表外旧会话」：它们从基线起就存在、非 blank、从不 running。
  let state = initialTopZoneState()
  const outsider = ['acaf03fd', 'af89d75c', '6173f64c', '401e6633']
  const list = [session('o0', { updatedAt: 50 }), ...outsider.map((id) => session(id, { updatedAt: 1 }))]

  state = observeTopZone(state, observationsOf(topZoneFixture(list)), 1000)
  // 多次观测（模拟轮询），它们始终不变。
  for (let i = 0; i < 3; i += 1) {
    state = observeTopZone(state, observationsOf(topZoneFixture(list)), 2000 + i * 1000)
  }

  assert.deepEqual(state.newSessionIds, [], '★ 旧表外会话绝不被判为新会话（时间序证据不足）')

  // 关键断言：它们**不会**跳到最前 —— 仍按手动顺序排在末尾。
  const rows = buildRows(
    topZoneFixture(list, {
      manualOrder: { manual: true, sessions: { 'w:/repo': ['o0'] } },
      topZone: topZoneInputOf(state),
    }),
  )
  const ids = containerIds(rows)
  assert.equal(ids[0], 'o0', '★ 第一位仍是手动顺序里的 o0，旧表外会话没有跳上来')
  assert.deepEqual(ids.slice(1).sort(), [...outsider].sort(), '旧表外会话仍在后面（按默认顺序追加）')
})

test('T5/D2: 首次观测到的会话若 `updatedAt < 基线时刻` ⇒ 不判为新会话（旧会话保护）', () => {
  let state = initialTopZoneState()
  state = observeTopZone(state, observationsOf(topZoneFixture([session('o0', { updatedAt: 50 })])), 10_000)
  // 一条「首次出现但时间戳很旧」的会话（例如固化表不完整导致它此前没进过树）。
  state = observeTopZone(
    state,
    observationsOf(topZoneFixture([session('o0', { updatedAt: 50 }), session('stale', { updatedAt: 100 })])),
    11_000,
  )
  assert.deepEqual(state.newSessionIds, [], 'updatedAt(100) < 基线(10000) ⇒ 旧会话，不判新')
})

test('T5/D2: 首次观测到的会话若 `updatedAt >= 基线时刻` ⇒ 判为新会话（轮询间隙的窄窗口兜底）', () => {
  let state = initialTopZoneState()
  state = observeTopZone(state, observationsOf(topZoneFixture([session('o0', { updatedAt: 50 })])), 10_000)
  // 新建 + 发首条消息都发生在两次轮询之间 ⇒ 从未观测到它的 blank 态。
  state = observeTopZone(
    state,
    observationsOf(topZoneFixture([session('o0', { updatedAt: 50 }), session('fresh', { updatedAt: 10_500 })])),
    11_000,
  )
  assert.deepEqual(state.newSessionIds, ['fresh'], 'updatedAt 晚于本进程基线 ⇒ 本进程启动后创建 / 发消息')
})

test('T5/D2: 新会话在**手动模式**下插到其容器**第一位**且不被 5 条截断吞掉', () => {
  const list = [...sessions(8, 'o'), session('new1', { updatedAt: 99999 })]
  let state = initialTopZoneState()
  state = observeTopZone(state, observationsOf(topZoneFixture([...sessions(8, 'o'), session('new1', { updatedAt: 99999, blank: true })])), 1000)
  state = observeTopZone(state, observationsOf(topZoneFixture(list)), 2000)

  const rows = buildRows(
    topZoneFixture(list, {
      manualOrder: { manual: true, sessions: { 'w:/repo': sessions(8, 'o').map((s) => s.sessionId) } },
      topZone: topZoneInputOf(state),
    }),
  )

  const ids = containerIds(rows)
  assert.equal(ids[0], 'new1', '★ 新会话在容器第一位')
  assert.equal(ids.length, COLLAPSED_SESSION_LIMIT, '5 条截断不变')
  assert.ok(ids.includes('new1'), '★ 先于截断生效 ⇒ 不被吞掉')
})

test('T5/D2: 默认模式（manual !== true）下**不写表、不建表**（绝不静默切手动模式）', () => {
  const manualOrder = { manual: false }
  const inserted = insertSessionAtFront(manualOrder, 'w:/repo', 'new1', ['o0', 'o1'])
  assert.equal(inserted, undefined, '★ 默认模式返回 undefined ⇒ 调用方不写 localStorage、不建表')
  assert.deepEqual(manualOrder, { manual: false }, '入参未被修改')

  // 对照：默认模式下新会话本来就排最前（靠 updatedAt），无需任何插入。
  const rows = buildRows(
    topZoneFixture([session('o0', { updatedAt: 1 }), session('new1', { updatedAt: 99999 })], {
      manualOrder,
      topZone: topZoneOf(),
    }),
  )
  assert.equal(containerIds(rows)[0], 'new1', '默认模式新会话天然最前')
})

test('T5/D2: `insertSessionAtFront` 把新会话插到表首，**不产生重复条目**', () => {
  const order = { manual: true, sessions: { 'w:/repo': ['o0', 'o1', 'o2'] } }
  const next = insertSessionAtFront(order, 'w:/repo', 'new1', ['o0', 'o1', 'o2'])
  assert.deepEqual(next.sessions['w:/repo'], ['new1', 'o0', 'o1', 'o2'], '插到表首')
  assert.deepEqual(order.sessions['w:/repo'], ['o0', 'o1', 'o2'], '入参未被修改（纯函数）')

  // 重复 id：先把已有的一律剔除，再插到首位。
  const dup = { manual: true, sessions: { 'w:/repo': ['o0', 'new1', 'o1', 'new1'] } }
  const deduped = insertSessionAtFront(dup, 'w:/repo', 'new1')
  assert.deepEqual(deduped.sessions['w:/repo'], ['new1', 'o0', 'o1'], '★ 重复 id 被去重（无重复条目）')
})

test('T5/D2: `insertSessionAtFront` **幂等** —— 已在表首 ⇒ 返回 undefined（不反复写 localStorage）', () => {
  const order = { manual: true, sessions: { 'w:/repo': ['new1', 'o0', 'o1'] } }
  assert.equal(insertSessionAtFront(order, 'w:/repo', 'new1'), undefined, '★ 已在表首 ⇒ 无写入（幂等）')

  const once = insertSessionAtFront({ manual: true, sessions: { 'w:/repo': ['o0'] } }, 'w:/repo', 'new1')
  assert.deepEqual(once.sessions['w:/repo'], ['new1', 'o0'], '首次写入')
  assert.equal(insertSessionAtFront(once, 'w:/repo', 'new1'), undefined, '第二次 ⇒ 幂等，不再写')
})

test('T5/D2: `insertSessionAtFront` 的表里没有该容器时用**完整顺序**兜底（不丢其余会话）', () => {
  const order = { manual: true, sessions: { 'w:/other': ['x'] } }
  const next = insertSessionAtFront(order, 'w:/repo', 'new1', ['o0', 'o1'])
  assert.deepEqual(next.sessions['w:/repo'], ['new1', 'o0', 'o1'], '用 fullOrder 作基底 ⇒ 其余会话不丢')
  assert.deepEqual(next.sessions['w:/other'], ['x'], '其它容器不受影响')
})

test('T5/D2: `insertSessionAtFront` 的非法入参静默降级（不抛、不写）', () => {
  const order = { manual: true, sessions: { 'w:/repo': ['o0'] } }
  assert.equal(insertSessionAtFront(order, '', 'new1'), undefined, '空容器 key ⇒ 不写')
  assert.equal(insertSessionAtFront(order, 'w:/repo', ''), undefined, '空 sessionId ⇒ 不写')
  assert.doesNotThrow(() => insertSessionAtFront(order, 'w:/repo', 'new1', undefined), 'fullOrder 缺省不抛')
  // 容器尚无表且 `fullOrder` 为空 ⇒ 建出只含新会话的表（该容器本来就没有别的可见会话，不丢东西）。
  assert.deepEqual(
    insertSessionAtFront({ manual: true }, 'w:/repo', 'new1', []).sessions['w:/repo'],
    ['new1'],
    '空表 + 空基底 ⇒ 建出只含新会话的表',
  )
})

test('T5/D2: `containerKeyOfSession` 反查容器（含 `session-` 前缀混拼），与渲染同源', () => {
  const sessions = new Map([
    ['w:/a', ['a1', 'a2']],
    ['w:/b', ['session-b1']],
  ])
  assert.equal(containerKeyOfSession(sessions, 'a2'), 'w:/a', '精确命中')
  assert.equal(containerKeyOfSession(sessions, 'b1'), 'w:/b', '裸 id 命中带前缀的项（归一化）')
  assert.equal(containerKeyOfSession(sessions, 'session-a1'), 'w:/a', '带前缀 id 命中裸项（归一化）')
  assert.equal(containerKeyOfSession(sessions, 'nope'), undefined, '找不到 ⇒ undefined')
  assert.equal(containerKeyOfSession(sessions, ''), undefined, '空 id ⇒ undefined')
})

// ── 边界：归档 / 子代理 / 跨容器 / 非法输入 ────────────────────────────────

test('T5/边界: 归档会话不进顶部区（即便它 running / 在 newSessionIds 里）', () => {
  const rows = buildRows(
    topZoneFixture([session('o0', { updatedAt: 5 }), session('gone', { updatedAt: 1, running: true })], {
      archivedSessionIds: ['gone'],
      manualOrder: { manual: true, sessions: { 'w:/repo': ['o0'] } },
      topZone: topZoneOf({ runningSessionIds: ['gone'], newSessionIds: ['gone'] }),
    }),
  )

  assert.deepEqual(containerIds(rows), ['o0'], '归档会话不渲染 ⇒ 顶部区 key 找不到 ⇒ 静默降级')
})

test('T5/边界: 子代理会话不进顶部区（它不产生任何行）', () => {
  const rows = buildRows(
    topZoneFixture([session('p', { updatedAt: 5 }), subagent('c', 'p', { updatedAt: 1, running: true })], {
      manualOrder: { manual: true, sessions: { 'w:/repo': ['p'] } },
      topZone: topZoneOf({ runningSessionIds: ['c'], newSessionIds: ['c'] }),
    }),
  )

  assert.deepEqual(containerIds(rows), ['p'], '只有父行，且父行未被误置顶（子代理 id 不在可见集里）')
})

test('T5/边界: `topZone` 里的 id 非字符串 / 空串 ⇒ 不抛错、不误置顶', () => {
  const list = [session('o0', { updatedAt: 5 }), session('o1', { updatedAt: 1 })]
  const rows = buildRows(
    topZoneFixture(list, {
      manualOrder: { manual: true, sessions: { 'w:/repo': ['o0', 'o1'] } },
      topZone: topZoneOf({
        runningSessionIds: [42, null, undefined, '', 'o1'],
        newSessionIds: [undefined, 7],
      }),
    }),
  )

  assert.deepEqual(containerIds(rows), ['o1', 'o0'], '只有合法字符串 o1 生效；其余静默忽略，不抛错')
})

test('T5/边界: `topZone` 里的 id 指向**别的容器**的会话 ⇒ 本容器不误置顶', () => {
  const rows = buildRows(
    input({
      projects: [
        project({
          key: '/a/.git',
          title: 'A',
          worktrees: [
            worktree('/a', { isMain: true, branch: 'main', sessions: [session('a1', { updatedAt: 9 }), session('a2', { updatedAt: 1 })] }),
            worktree('/a-wt', { branch: 'feat', sessions: [session('b1', { updatedAt: 9 })] }),
          ],
        }),
      ],
      manualOrder: { manual: true, sessions: { 'w:/a': ['a1', 'a2'], 'w:/a-wt': ['b1'] } },
      // b1 是别的容器的 id。
      topZone: topZoneOf({ runningSessionIds: ['b1'], newSessionIds: ['b1'] }),
    }),
  )

  assert.deepEqual(containerIds(rows, 'w:/a'), ['a1', 'a2'], '跨容器 id 不影响本容器（applyManualOrder 只在 items 里找）')
})

test('T5/边界: 同一会话不会同时出现在**多个容器的顶部区**（脏数据构造）', () => {
  // 真实链路 `buildProjects` 每个会话只 push 一次，这里人为构造重复 id。
  const rows = buildRows(
    input({
      projects: [
        project({
          key: '/a/.git',
          title: 'A',
          worktrees: [
            worktree('/a', { isMain: true, branch: 'main', sessions: [session('dup', { updatedAt: 1, running: true }), session('a2', { updatedAt: 9 })] }),
            worktree('/a-wt', { branch: 'feat', sessions: [session('dup', { updatedAt: 1, running: true }), session('b2', { updatedAt: 9 })] }),
          ],
        }),
      ],
      manualOrder: { manual: true, sessions: { 'w:/a': ['a2', 'dup'], 'w:/a-wt': ['b2', 'dup'] } },
      topZone: topZoneOf({ runningSessionIds: ['dup'] }),
    }),
  )

  // 每个容器**内部**各自置顶（与「容器内语义」一致），但每个容器只出现一次。
  assert.deepEqual(containerIds(rows, 'w:/a'), ['dup', 'a2'], '本容器内置顶')
  assert.deepEqual(containerIds(rows, 'w:/a-wt'), ['dup', 'b2'], '另一个容器也内置顶')
  assert.equal(
    rows.filter((row) => row.kind === 'session' && row.sessionId === 'dup').length,
    2,
    '每个容器各一行，不产生额外重复行',
  )
})

test('T5/边界: 未分组容器同样适用顶部区（容器内语义，无需特判）', () => {
  const rows = buildRows(
    input({
      ungrouped: [session('u0', { updatedAt: 9 }), session('u1', { updatedAt: 1, running: true })],
      manualOrder: { manual: true, sessions: { [`p:${UNGROUPED_KEY}`]: ['u0', 'u1'] } },
      topZone: topZoneOf({ runningSessionIds: ['u1'] }),
    }),
  )

  assert.deepEqual(
    rows.filter((row) => row.kind === 'session').map((row) => row.sessionId),
    ['u1', 'u0'],
    '未分组容器的运行中会话同样置顶',
  )
})

// ── 持久化不变式：运行时置顶**不写** localStorage ──────────────────────────

test('T5/持久化: 运行时顶部区**不写**持久顺序 —— 载荷与 `topZone` 完全无关', () => {
  const list = [session('o0', { updatedAt: 5 }), session('run', { updatedAt: 1, running: true }), session('done1', { updatedAt: 2 })]
  const manualOrder = { manual: true, sessions: { 'w:/repo': ['o0', 'run', 'done1'] } }

  const payloadOf = (topZone) => {
    const input0 = topZoneFixture(list, { manualOrder, topZone })
    // `effectiveOrder` 是 `commitDrag` 固化进 localStorage 的那份顺序。
    const order = effectiveOrder(input0)
    return JSON.stringify({ manual: true, sessions: Object.fromEntries(order.sessions) })
  }

  const a = payloadOf(topZoneOf())
  const b = payloadOf(topZoneOf({ runningSessionIds: ['run'], newSessionIds: ['x'] }))
  assert.equal(a, b, '★ 换任何 topZone 输入 ⇒ 固化载荷逐字一致（运行时置顶绝不进 localStorage）')

  // 对照：渲染顺序**确实**随 topZone 变化 ⇒ 证明上面不是恒真。
  const rendered = containerIds(buildRows(topZoneFixture(list, { manualOrder, topZone: topZoneOf({ runningSessionIds: ['run'] }) })))
  assert.deepEqual(rendered, ['run', 'o0', 'done1'], '渲染顺序确实被 topZone 改变（对照组）')
  assert.notEqual(JSON.parse(b).sessions['w:/repo'].join(','), rendered.join(','), '载荷 ≠ 渲染顺序 ⇒ 置顶未被固化')
})

test('T5/持久化: `effectiveOrder` 的 JSDoc 不变式 —— `topZone` 被结构性地硬置 undefined', () => {
  // 即便调用方传了 topZone，`effectiveOrder` 也必须完全忽略它。
  const list = [session('o0', { updatedAt: 5 }), session('run', { updatedAt: 1, running: true })]
  const withTopZone = effectiveOrder(
    topZoneFixture(list, {
      manualOrder: { manual: true, sessions: { 'w:/repo': ['o0', 'run'] } },
      topZone: topZoneOf({ runningSessionIds: ['run'], newSessionIds: ['run'] }),
    }),
  )
  const without = effectiveOrder(
    topZoneFixture(list, { manualOrder: { manual: true, sessions: { 'w:/repo': ['o0', 'run'] } } }),
  )

  assert.deepEqual([...withTopZone.sessions], [...without.sessions], '★ 传与不传 topZone ⇒ 产物逐字一致')
})

test('T5/持久化: 只有**新会话**允许落表 —— 运行中 / 当前会话都不写', () => {
  const manualOrder = { manual: true, sessions: { 'w:/repo': ['o0', 'o1'] } }
  // 运行时置顶的三类 id 都不是「新会话」⇒ `insertSessionAtFront` 不该被调用；
  // 这里直接断言「落表动作只接受调用方显式给出的新会话 id」这一契约。
  const runtimeOnly = insertSessionAtFront(manualOrder, 'w:/repo', 'run', ['o0', 'o1'])
  assert.deepEqual(runtimeOnly.sessions['w:/repo'], ['run', 'o0', 'o1'], 'insertSessionAtFront 只插调用方给的那一个 id')
  assert.deepEqual(manualOrder.sessions['w:/repo'], ['o0', 'o1'], '★ 除该 id 外，没有任何运行时置顶信息被写入')
  // `run` / `done1` / `cur` 若不在 newSessionIds 里，就不会走到落表 —— 判据在调用方。
  assert.equal(
    JSON.stringify(runtimeOnly).includes('recentlyFinished') || JSON.stringify(runtimeOnly).includes('running'),
    false,
    '★ 载荷里没有 running / recentlyFinished 这类运行时字段（结构仍是冻结的 ManualOrder）',
  )
})

// ── 状态机：纯函数性 / 引用稳定性 / 基线语义 ───────────────────────────────

test('T5/状态机: `observeTopZone` 无变化时返回**同一引用**（`useState` 幂等，不无限重渲染）', () => {
  let state = initialTopZoneState()
  state = observeTopZone(state, observationsOf(topZoneFixture([session('o0', { updatedAt: 5 })])), 1000)
  const same = observeTopZone(state, observationsOf(topZoneFixture([session('o0', { updatedAt: 5 })])), 2000)
  assert.equal(same, state, '★ 输入不变 ⇒ 返回同一引用')
})

test('T5/状态机: 首次观测建立基线，**不产生任何新会话 / 保留态**（刷新即重置的起点）', () => {
  const state = observeTopZone(
    initialTopZoneState(),
    observationsOf(topZoneFixture([session('o0', { running: true, updatedAt: 5 }), session('b', { blank: true })])),
    1234,
  )

  assert.equal(state.baselined, true, '建立基线')
  assert.equal(state.startedAtMs, 1234, '基线时刻被记录')
  assert.deepEqual(state.newSessionIds, [], '★ 基线里已有的会话（含 blank）不判新会话')
  assert.equal('recentlyFinishedIds' in state, false, '★ T11：「刚结束保留」字段已删除（基线里 running 的会话不产生任何保留态）')
  assert.equal(state.runningOf[normalize('o0')], true, '基线记录 running 轨迹')
})

test('T5/状态机: 不修改入参（纯函数）', () => {
  const state = initialTopZoneState()
  const observations = observationsOf(topZoneFixture([session('o0', { running: true })]))
  const snapshot = JSON.stringify(state)
  observeTopZone(state, observations, 1000)
  assert.equal(JSON.stringify(state), snapshot, '入参 state 未被就地修改')
})

test('T5/状态机: 归档 / 子代理会话不进轨迹（不参与任何顶部区判定）', () => {
  const state = observeTopZone(
    initialTopZoneState(),
    observationsOf(
      topZoneFixture([session('o0', { updatedAt: 5 }), subagent('c', 'o0', { running: true }), session('gone', { running: true })], {
        archivedSessionIds: ['gone'],
      }),
    ),
    1000,
  )

  assert.equal(state.runningOf[normalize('c')], undefined, '★ 子代理不进轨迹')
  assert.equal(state.runningOf[normalize('gone')], undefined, '★ 归档会话不进轨迹')
  assert.equal(state.runningOf[normalize('o0')], true, '父会话因聚合口径进轨迹（它只有 subagent 在跑）')
})

test('T5/状态机: `observationsOf` 对重复 id 去重（每条会话只产出一条观测）', () => {
  const observations = observationsOf(
    topZoneFixture([session('dup', { updatedAt: 1 }), session('dup', { updatedAt: 2 })]),
  )
  assert.equal(observations.filter((o) => o.sessionId === 'dup').length, 1, '★ 重复 id 只产出一条观测')
})

test('T5/状态机: `observationsOf` 对 `updatedAt` 非有限值归一为 0（不产生 NaN 排序）', () => {
  const observations = observationsOf(topZoneFixture([session('x', { updatedAt: NaN }), session('y', { updatedAt: undefined })]))
  assert.equal(observations.find((o) => o.sessionId === 'x').updatedAt, 0, 'NaN ⇒ 0')
  assert.equal(observations.find((o) => o.sessionId === 'y').updatedAt, 0, 'undefined ⇒ 0')
})

test('T5/状态机: `topZoneInputOf` 只把 running 为真的会话放进 `runningSessionIds`', () => {
  let state = initialTopZoneState()
  state = observeTopZone(
    state,
    observationsOf(topZoneFixture([session('r', { running: true }), session('i', { running: false })])),
    1000,
  )
  const topZone = topZoneInputOf(state)
  assert.deepEqual(topZone.runningSessionIds, ['r'], '只有 running 的进列表')
  assert.deepEqual(topZone.newSessionIds, [], '新会话为空')
  assert.equal('recentlyFinishedSessionIds' in topZone, false, 'T11：投影里已无「刚结束保留」字段')
})

test('T5/状态机: `session-` 前缀混拼时，顶部区判据与 items 同源（归一化回读）', () => {
  const rows = buildRows(
    topZoneFixture([session('session-x', { updatedAt: 1, running: true }), session('y', { updatedAt: 9 })], {
      manualOrder: { manual: true, sessions: { 'w:/repo': ['y', 'session-x'] } },
      topZone: topZoneOf({ runningSessionIds: ['x'] }),
    }),
  )

  assert.deepEqual(containerIds(rows), ['session-x', 'y'], '★ 裸 id `x` 能命中 `session-x`（归一化）')
})

// ── 回归守卫：默认缺省路径逐字不变 ────────────────────────────────────────

test('T11/回归: 不传 `topZone` ⇒ **无任何置顶**，逐字按持久顺序', () => {
  const list = [session('o0', { updatedAt: 9 }), session('run', { updatedAt: 1, running: true })]
  const manualOrder = { manual: true, sessions: { 'w:/repo': ['o0', 'run'] } }

  const withoutTopZone = buildRows(topZoneFixture(list, { manualOrder }))
  assert.deepEqual(containerIds(withoutTopZone), ['o0', 'run'], '★ 不传 topZone ⇒ running 不置顶（零回归）')

  // 对照：传了 topZone 才置顶 ⇒ 证明上面不是恒真。
  const withTopZone = buildRows(topZoneFixture(list, { manualOrder, topZone: topZoneOf({ runningSessionIds: ['run'] }) }))
  assert.deepEqual(containerIds(withTopZone), ['run', 'o0'], '传了 topZone ⇒ 置顶生效（对照组）')
})

test('T11/回归: **缺省** `topZone` ⇒ **无任何置顶**，逐字按持久顺序', () => {
  const list = [...sessions(6, 'o'), session('run', { updatedAt: 1, running: true })]
  const manualOrder = { manual: true, sessions: { 'w:/repo': [...sessions(6, 'o').map((s) => s.sessionId), 'run'] } }

  assert.deepEqual(
    containerIds(buildRows(topZoneFixture(list, { manualOrder }))),
    ['o0', 'o1', 'o2', 'o3', 'o4'],
    '★ 缺省 topZone ⇒ running 不置顶、顺序完全按手动顺序（零回归；run 被截断隐藏）',
  )
})

test('T5/D3a: 传了 `topZone`（哪怕空对象）⇒ 顶部区语义开启，裸 `running` 字段也进顶部区', () => {
  // D3a 的判据是「自身 running **或** 任意层级有 running subagent」。`SessionRowLike.running`
  // 是宿主 summary 的裸透传，属于「自身 running」这一半 —— 所以它在顶部区语义下**必须**生效，
  // 即便调用方忘了把它写进 `runningSessionIds`。这是**防御性**的（少一层漏判）。
  const list = [...sessions(6, 'o'), session('run', { updatedAt: 1, running: true })]
  const manualOrder = { manual: true, sessions: { 'w:/repo': [...sessions(6, 'o').map((s) => s.sessionId), 'run'] } }

  assert.deepEqual(
    containerIds(buildRows(topZoneFixture(list, { manualOrder, topZone: {} }))),
    ['run', 'o0', 'o1', 'o2', 'o3'],
    '★ 空 topZone ⇒ 语义开启：裸 running 的 run 进顶部区第一位（D3a 的「自身 running」一半）',
  )
})

test('T5/回归: 11b1144 承诺 —— **非当前、非运行中的已有会话收到新消息不顶到前面**', () => {
  const manualOrder = { manual: true, sessions: { 'w:/repo': ['old1', 'old2', 'old3'] } }
  // old3 收到新消息（updatedAt 变成最大），但它既非当前、也非运行中、也不是新会话。
  const rows = buildRows(
    topZoneFixture(
      [session('old1', { updatedAt: 1 }), session('old2', { updatedAt: 2 }), session('old3', { updatedAt: 99999 })],
      { manualOrder, topZone: topZoneOf({ runningSessionIds: [], newSessionIds: [] }) },
    ),
  )

  assert.deepEqual(
    containerIds(rows),
    ['old1', 'old2', 'old3'],
    '★ 顺序仍冻结（11b1144 的核心承诺：T11 后只有运行中 / 新会话会被提升）',
  )
})

// ── T3 次要问题 1：`currentSessionId` 非字符串不再抛错 ─────────────────────

test('T3/次要-1: `currentSessionId` 传 42 / null ⇒ 不抛 TypeError（防御性守卫）', () => {
  const list = [session('o0', { updatedAt: 9 }), session('o1', { updatedAt: 1 })]

  assert.doesNotThrow(() => buildRows(topZoneFixture(list, { currentSessionId: 42 })), '数字不再抛（T3 实测过 TypeError）')
  assert.doesNotThrow(() => buildRows(topZoneFixture(list, { currentSessionId: null })), 'null 不再抛')
  assert.doesNotThrow(
    () => buildRows(topZoneFixture(list, { currentSessionId: 42, topZone: topZoneOf({ runningSessionIds: ['o1'] }) })),
    '带 topZone 时同样不抛',
  )
  assert.deepEqual(containerIds(buildRows(topZoneFixture(list, { currentSessionId: 42 }))), ['o0', 'o1'], '静默降级为「不置顶」')
})

test('T3/次要-1: `currentSessionId` 为空串 ⇒ 不置顶、不抛错（既有行为保持）', () => {
  const list = [session('o0', { updatedAt: 9 }), session('o1', { updatedAt: 1 })]
  assert.doesNotThrow(() => buildRows(topZoneFixture(list, { currentSessionId: '' })))
  assert.deepEqual(containerIds(buildRows(topZoneFixture(list, { currentSessionId: '' }))), ['o0', 'o1'], '空串不匹配任何 id')
})

// ── 截断交互：顶部区 / 持久顺序与 5 条截断的关系（T13 后无保底）────────────

test('T13/截断: 运行中的当前会话被置顶到下标 0 ⇒ 无重复搬运，仍是 5 条', () => {
  const list = [...sessions(8, 'o'), session('cur', { updatedAt: 1, running: true })]
  const rows = buildRows(
    topZoneFixture(list, {
      currentSessionId: 'cur',
      manualOrder: { manual: true, sessions: { 'w:/repo': [...sessions(8, 'o').map((s) => s.sessionId), 'cur'] } },
      topZone: topZoneOf({ runningSessionIds: ['cur'] }),
    }),
  )

  const ids = containerIds(rows)
  assert.equal(ids[0], 'cur', '运行中的当前会话在第一位')
  assert.equal(new Set(ids).size, ids.length, '★ 没有重复行')
  assert.equal(ids.length, COLLAPSED_SESSION_LIMIT, '仍是 5 条')
  assert.deepEqual(ids, ['cur', 'o0', 'o1', 'o2', 'o3'], '★ 渲染 = 运行中置顶 + 其余逐字持久表前 4 条')
})

test('T13/截断: 已结束的当前会话拖到第 8 位 ⇒ 渲染 = 持久顺序前 5 条（**无**保底，用户终裁接受）', () => {
  // T13（2026-09-22 用户终裁）**删除** D12 的「当前会话保底进前 5」。
  // 修复前（T11 状态）本场景渲染 `[o0,o1,o2,o3,cur]` —— cur 被保底到可见区第 5 位，
  // 于是「把 cur 从第 5 位拖到第 7 位」出现**视觉零位移**（与用户投诉的首要缺陷同形）。
  // 修复后：**拖拽顺序完全优先**，cur 排第 9 位 ⇒ 就是看不见。
  const list = [...sessions(8, 'o'), session('cur', { updatedAt: 1 })]
  const manualOrder = { manual: true, sessions: { 'w:/repo': [...sessions(8, 'o').map((s) => s.sessionId), 'cur'] } }
  const rows = buildRows(topZoneFixture(list, { currentSessionId: 'cur', manualOrder, topZone: topZoneOf() }))

  const ids = containerIds(rows)
  assert.equal(ids.length, COLLAPSED_SESSION_LIMIT, '仍是 5 条截断')
  assert.deepEqual(ids, ['o0', 'o1', 'o2', 'o3', 'o4'], '★ 逐字 = 持久顺序前 5 条（cur 不在其中）')
  assert.equal(ids.includes('cur'), false, '★ 当前会话排第 9 位 ⇒ 被截断到不可见（无保底）')
  assert.equal(new Set(ids).size, ids.length, '不产生重复行')
  assert.equal(rows.find((row) => row.kind === 'more').hiddenCount, 4, '9 - 5 = 4 条被隐藏')

  // 展开后 ⇒ 渲染顺序**逐字等于**持久顺序（顶部区为空，无任何运行时搬运）。
  const expanded = buildRows(
    topZoneFixture(list, { currentSessionId: 'cur', manualOrder, topZone: topZoneOf(), expandedAllKeys: { 'w:/repo': true } }),
  )
  assert.deepEqual(
    containerIds(expanded),
    manualOrder.sessions['w:/repo'],
    '★ 展开后渲染顺序 = 持久顺序（当前会话留在第 9 位）',
  )
})

test('T13/截断: 当前会话拖到容器内**任意位置** ⇒ 渲染 === 运行中置顶 + 其余逐字持久表（逐落点枚举）', () => {
  // 这是任务 1 的**核心渲染层契约**：对**每一个**落点（含被截断区、含 >5 条会话的容器），
  // `buildRows` 的会话行序列都必须逐字等于「运行中置顶 + 持久表顺序」。
  // 断言打在 `buildRows` 的**输出行**上（不是持久表内容）。
  const RUN = 'session-run'
  const CUR = 'session-cur'
  const others = ['session-o0', 'session-o1', 'session-o2', 'session-o3', 'session-o4', 'session-o5', 'session-o6']
  const list = [
    ...others.map((id, i) => session(id, { updatedAt: 1000 + i })),
    session(CUR, { updatedAt: 1500 }),
    session(RUN, { updatedAt: 2000, running: true }),
  ]
  const zone = topZoneOf({ runningSessionIds: [RUN] })

  // 起点：持久表 = [o0..o6, CUR, RUN]（CUR 已在第 8 位 = 被截断区）。
  const start = [...others, CUR, RUN]
  // 落点：把 CUR 拖到**每一个**锚点 × 上下半（含它自己的原位 ⇒ `reorderKeys` 返回 null）。
  const targets = [...others, RUN]
  let checked = 0
  for (const overId of targets) {
    for (const half of ['before', 'after']) {
      const next = reorderKeys(start, CUR, overId, half)
      if (next === null) continue
      const manualOrder = { manual: true, sessions: { 'w:/repo': next } }
      const rows = buildRows(
        topZoneFixture(list, { currentSessionId: CUR, manualOrder, topZone: zone }),
      )
      const ids = containerIds(rows)
      // ★ 期望值 = 运行中置顶 + 其余逐字持久表，再取前 5 条（= 渲染层真实截断口径）。
      const expected = [RUN, ...next.filter((id) => id !== RUN)].slice(0, COLLAPSED_SESSION_LIMIT)
      assert.deepEqual(
        ids,
        expected,
        `★ CUR 拖到 ${overId} ${half}（持久表第 ${next.indexOf(CUR) + 1} 位）⇒ 渲染必须逐字等于「运行中置顶 + 持久表前 5」`,
      )
      // 对照：非当前会话（o0）在同样落点下**可见变化**（证明该断言不是恒真）。
      checked += 1
    }
  }
  assert.ok(checked >= 12, `落点枚举覆盖足够（实测 ${checked} 个有效落点）`)

  // 对照组（排除恒真）：把**非当前**会话 o0 拖到第 7 位 ⇒ 它确实从可见区消失（可见变化）。
  const moved = reorderKeys(start, 'session-o0', 'session-o6', 'after')
  const movedRows = buildRows(
    topZoneFixture(list, { currentSessionId: CUR, manualOrder: { manual: true, sessions: { 'w:/repo': moved } }, topZone: zone }),
  )
  assert.deepEqual(
    containerIds(movedRows),
    [RUN, 'session-o1', 'session-o2', 'session-o3', 'session-o4'],
    '★ 对照组：非当前会话拖到第 8 位 ⇒ 渲染可见变化（证明上面的逐字断言有判别力）',
  )
})

test('T13/截断: 修复前形态（保底提位）会**立刻**违反上面的渲染契约（判别力证据）', () => {
  // 本用例是**等价复现**：把 T13 之前 `truncateSessions` 的 `promote` 语义在测试侧显式
  // 重放一遍，证明「保底提位」与「渲染 = 持久顺序」**互斥** —— 即上面的逐落点断言
  // 在修复前必然失败（而不是恒真）。
  const CUR = 'cur'
  const start = ['o0', 'o1', 'o2', 'o3', 'o4', 'o5', 'o6', CUR]
  const quota = COLLAPSED_SESSION_LIMIT
  // T11 的 promote 语义：cur 在下标 7 ⇒ ordinaryBefore = 7 >= 5 ⇒ promote = true
  // ⇒ 可见 = 前 4 条普通 + cur（插到第 5 位）。
  const currentIndex = start.indexOf(CUR)
  const ordinaryBefore = start.slice(0, currentIndex).length
  assert.ok(ordinaryBefore >= quota, '前置：cur 在 5 条之外 ⇒ 旧实现 promote = true')
  const legacyVisible = [...start.slice(0, quota - 1), CUR]
  assert.deepEqual(legacyVisible, ['o0', 'o1', 'o2', 'o3', CUR], '旧实现渲染：cur 被保底提到第 5 位')

  // T13 实现（真实导出）渲染：
  const list = start.map((id) => session(id, { updatedAt: id === CUR ? 1 : 1000 }))
  const rows = buildRows(
    topZoneFixture(list, {
      currentSessionId: CUR,
      manualOrder: { manual: true, sessions: { 'w:/repo': start } },
      topZone: topZoneOf(),
    }),
  )
  assert.deepEqual(
    containerIds(rows),
    ['o0', 'o1', 'o2', 'o3', 'o4'],
    '★ T13 渲染：逐字持久顺序前 5（与旧实现的 `[...旧, CUR]` **不同** ⇒ 断言有判别力）',
  )
  assert.notDeepEqual(containerIds(rows), legacyVisible, '★ 两者互斥 ⇒ 修复前的形态必然让本契约红')
})

test('T5/截断: 顶部区成员数 > 5 时，只有前 5 条可见（截断仍生效，不突破上限）', () => {
  const running = Array.from({ length: 8 }, (_, i) => session(`r${i}`, { updatedAt: 1000 + i, running: true }))
  const rows = buildRows(
    topZoneFixture(running, {
      manualOrder: { manual: true, sessions: { 'w:/repo': running.map((s) => s.sessionId) } },
      topZone: topZoneOf({ runningSessionIds: running.map((s) => s.sessionId) }),
    }),
  )

  assert.equal(containerIds(rows).length, COLLAPSED_SESSION_LIMIT, '8 条全在顶部区 ⇒ 仍只显示 5 条')
  assert.equal(rows.find((row) => row.kind === 'more').hiddenCount, 3, '隐藏 3 条')
})

test('T5/截断: `expandedAll` 时顶部区顺序不变，只是不再隐藏', () => {
  const list = [...sessions(3, 'o'), session('run', { updatedAt: 1, running: true })]
  const manualOrder = { manual: true, sessions: { 'w:/repo': [...sessions(3, 'o').map((s) => s.sessionId), 'run'] } }
  const rows = buildRows(
    topZoneFixture(list, {
      manualOrder,
      expandedAllKeys: { 'w:/repo': true },
      topZone: topZoneOf({ runningSessionIds: ['run'] }),
    }),
  )

  assert.deepEqual(containerIds(rows), ['run', 'o0', 'o1', 'o2'], '展开后顺序不变（顶部区仍在最前）')
})

// ── 搜索模式：与「不应用手动顺序」保持一致，顶部区也不应用 ─────────────────

test('T5/搜索: 搜索模式**不应用**顶部区（与「不应用手动顺序」保持一致）', () => {
  const list = [session('run', { updatedAt: 1, running: true, title: 'needle' }), session('old', { updatedAt: 9, title: 'needle2' })]
  const rows = buildRows(
    topZoneFixture(list, {
      query: 'needle',
      manualOrder: { manual: true, sessions: { 'w:/repo': ['old', 'run'] } },
      topZone: topZoneOf({ runningSessionIds: ['run'] }),
    }),
  )

  assert.deepEqual(
    rows.filter((row) => row.kind === 'session').map((row) => row.sessionId),
    ['old', 'run'],
    '★ 搜索结果恒按 updatedAt 降序（顶部区不应用）',
  )
})

test('T5/D2 端到端: 写入固化表后「刷新页面」（无 topZone）⇒ 新会话仍在第一位', () => {
  // 这是 D2 的**核心验收**：插入固化表的意义就是「刷新后仍在用户预期的位置」。
  // 模拟 `sidebar.tsx` 的 D2 effect：观测到新会话 → 反查容器 → 插到表首。
  //
  // ⚠️ **N2（T9）**：本用例原用**裸 id** fixture（`o0` / `new1`），而宿主真实会话 id 恒带
  // `session-` 前缀 ⇒ 它对 B1 类形态缺陷**恒真**（T6 的 I1 就是同一问题，T7 已修同组的
  // 另一条用例）。这里改用**真实 `session-<uuid>` 形态**，与 `REAL_IDS` 同一批值。
  const old5 = [REAL_IDS.o0, REAL_IDS.o1, REAL_IDS.o2, REAL_IDS.o3, REAL_IDS.o4]
    .map((id, i) => session(id, { updatedAt: 100 + i }))
  const list = [...old5, session(REAL_IDS.new, { updatedAt: 99_999 })]

  let state = initialTopZoneState()
  state = observeTopZone(state, observationsOf(topZoneFixture([...old5, session(REAL_IDS.new, { blank: true, updatedAt: 99_999 })])), 1000)
  state = observeTopZone(state, observationsOf(topZoneFixture(list)), 2000)
  assert.deepEqual(state.newSessionIds, [normalize(REAL_IDS.new)], '先确认它被判为新会话（状态机内是归一化裸 id）')

  // D2 落表（与 `sidebar.tsx` 的 effect 同构）。
  const defaults = effectiveOrder({ ...topZoneFixture(list), manualOrder: undefined })
  const containerKey = containerKeyOfSession(defaults.sessions, normalize(REAL_IDS.new))
  assert.equal(containerKey, 'w:/repo', '容器归属与渲染同源')
  const written = insertSessionAtFront(
    { manual: true, sessions: { 'w:/repo': old5.map((s) => s.sessionId) } },
    containerKey,
    normalize(REAL_IDS.new),
    defaults.sessions.get(containerKey),
  )
  assert.deepEqual(
    written.sessions['w:/repo'],
    [REAL_IDS.new, REAL_IDS.o0, REAL_IDS.o1, REAL_IDS.o2, REAL_IDS.o3, REAL_IDS.o4],
    '★ 载荷内容：新会话在表首，且写入形态 = **树里的真实 id**（B1 逐字一致，非裸 id）',
  )
  assert.ok(
    written.sessions['w:/repo'].every((id) => id.startsWith('session-')),
    '★ 载荷里**没有裸 id**（死条目回归锁）',
  )

  // 「刷新页面」= 运行时顶部区重置（不传 topZone），只剩持久顺序。
  const refreshed = buildRows(topZoneFixture(list, { manualOrder: written }))
  assert.equal(containerIds(refreshed)[0], REAL_IDS.new, '★ 刷新后新会话仍在第一位（D2 的全部意义）')
  assert.equal(containerIds(refreshed).length, COLLAPSED_SESSION_LIMIT, '仍是 5 条截断')
})

test('T5/状态机: 多轮轮询（无变化）⇒ 状态引用恒定，不产生无谓重渲染', () => {
  let state = initialTopZoneState()
  const list = [session('o0', { updatedAt: 5 }), session('o1', { updatedAt: 1, running: true })]
  state = observeTopZone(state, observationsOf(topZoneFixture(list)), 1000)
  const baseline = state
  // 模拟 30s 轮询 5 次，树内容完全一致。
  for (let i = 0; i < 5; i += 1) {
    state = observeTopZone(state, observationsOf(topZoneFixture(list)), 2000 + i * 30_000)
    assert.equal(state, baseline, `第 ${i + 1} 轮无变化 ⇒ 必须返回同一引用`)
  }
})

// ---------------------------------------------------------------------------
// T7（2026-09-21）：T6 独立审查阻塞/重要/次要缺陷的回归锁定
//
// 审查报告：`docs/REVIEW-top-zone.md`（只读产物）。
// - B1：D2 落表的 id 形态与树/表不一致 ⇒ 死条目 + 「刷新后仍第一位」不成立；
// - B2：`newSessionIds` 只增不减 ⇒ 用户拖动新会话被落表 effect 静默回滚；
// - I1：既有 D2 端到端用例**全用裸 id** ⇒ 对 B1 恒真（本节全部用真实 `session-<uuid>`）；
// - I2（T11 已随释放机制一并删除，见下方 T11 段）；
// - I3：归档会话不进 `known` ⇒ 取消归档 + 新消息会误判新会话；
// - S1/S2：空数组表项丢会话 / 契约外 `topZone` 输入抛 `TypeError`。
//
// ⚠️ **fixture 形态**：宿主真实会话 id 恒带 `session-` 前缀（实测 `~/.dsh/sessions/**`
// 的会话头 `id = 'session-<uuid>'`；`@deepseek-ai/dsh-api-session-controller` 的
// `brandString(\`session-${randomUUID()}\`)`；用户真实固化表 54 个条目**全部**带前缀）。
// B1 正是因为 fixture 用裸 id 才漏网 —— 本节一律用真实形态。
// ---------------------------------------------------------------------------

/** 真实宿主会话 id（`session-<uuid>` 形态；用 T6 实测的真实值做确定性 fixture）。 */
const REAL_IDS = {
  new: 'session-0a1fd499-65d5-46fd-bce8-5ff0a1f4c67a',
  o0: 'session-5cad7dab-f021-4105-9175-870de978e34a',
  o1: 'session-0466f987-6ed6-4f3c-b59c-8e54a5cce652',
  o2: 'session-8f3b2c14-7a5d-4e6f-9b01-2c3d4e5f6a7b',
  o3: 'session-1d2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4e5f',
  o4: 'session-9a8b7c60-1d2e-4f3a-b4c5-d6e7f8091a2b',
}

/** 带 `session-` 前缀的真实形态会话列表（updatedAt 递增）。 */
function realSessions() {
  return Object.entries(REAL_IDS)
    .filter(([key]) => key !== 'new')
    .map(([, id], index) => session(id, { updatedAt: 1000 + index }))
}

// ── B1：真实 id 形态下端到端（插入 → 写表 → 刷新后仍第一位）─────────────────

test('T7/B1 端到端: 真实 `session-<uuid>` 形态下 D2 落表 → 刷新后新会话仍在第一位', () => {
  // 这是 D2 的**核心验收**，也是 T6 缺陷 B1 的回归锁：T6 实测原实现把
  // `observeTopZone` 归一化后的**裸 id** 原样写进固化表 ⇒ `applyManualOrder` 永远
  // 匹配不上 ⇒ 刷新后新会话**不在**第一位（且产生死条目、顶掉原本正确的条目）。
  const old5 = realSessions()
  const list = [...old5, session(REAL_IDS.new, { updatedAt: 99_999 })]

  let state = initialTopZoneState()
  state = observeTopZone(
    state,
    observationsOf(topZoneFixture([...old5, session(REAL_IDS.new, { blank: true, updatedAt: 99_999 })])),
    1000,
  )
  state = observeTopZone(state, observationsOf(topZoneFixture(list)), 2000)

  // 状态机内部用归一化 id（**裸 id**）—— 这正是 B1 的形态来源。
  assert.deepEqual(state.newSessionIds, [normalize(REAL_IDS.new)], '★ 状态机内是归一化后的裸 id（B1 的形态来源）')

  // D2 落表：与 `sidebar.tsx` 的 effect 逐行同构（`planNewSessionInserts` 编排）。
  const defaults = effectiveOrder({ ...topZoneFixture(list), manualOrder: undefined })
  const plan = planNewSessionInserts(
    { manual: true, sessions: { 'w:/repo': old5.map((s) => s.sessionId) } },
    defaults.sessions,
    state.newSessionIds,
    state.writtenNewSessionIds,
  )

  assert.deepEqual(
    plan.order.sessions['w:/repo'],
    [REAL_IDS.new, ...old5.map((s) => s.sessionId)],
    '★ 载荷内容：新会话在表首',
  )
  assert.equal(plan.order.sessions['w:/repo'][0], REAL_IDS.new, '★ 表首项 === 树的**真实 id**（B1 的判据）')
  assert.ok(
    plan.order.sessions['w:/repo'].every((id) => list.some((s) => s.sessionId === id)),
    '★ 无死条目：表内每一项都能在树里匹配（原实现在此产生裸 id 死条目）',
  )
  assert.deepEqual(plan.consumed, [normalize(REAL_IDS.new)], '★ 落表意图已满足 ⇒ 消费该 id')
  assert.equal(plan.changed, true, '★ 真的改动了顺序 ⇒ 需要写 localStorage')

  // 「刷新页面」= 运行时顶部区重置（不传 topZone），只剩持久顺序。
  const refreshed = buildRows(topZoneFixture(list, { manualOrder: plan.order }))
  assert.equal(containerIds(refreshed)[0], REAL_IDS.new, '★ 刷新后新会话仍在第一位（D2 的全部意义）')
  assert.equal(containerIds(refreshed).length, COLLAPSED_SESSION_LIMIT, '仍是 5 条截断')

  // 不顶掉既有正确条目：其余 4 条仍在（5 条截断下第 5 条被截，但表里必须有全部 5 条）。
  assert.deepEqual(
    plan.order.sessions['w:/repo'].slice(1),
    old5.map((s) => s.sessionId),
    '★ 原有带前缀条目全部保留、顺序不变（原实现会把它们中的首项顶掉）',
  )
})

test('T7/B1: `insertSessionAtFront` 写入形态 = 表内/树内原形态（绝不写归一化裸 id）', () => {
  const prefixed = 'session-5cad7dab-f021-4105-9175-870de978e34a'
  // ① 表里已有该会话（带前缀）⇒ 即便调用方传裸 id，也写入**表里的原形态**。
  const inTable = insertSessionAtFront(
    { manual: true, sessions: { 'w:/repo': ['session-x', prefixed] } },
    'w:/repo',
    normalize(prefixed),
  )
  assert.equal(inTable.sessions['w:/repo'][0], prefixed, '★ 复用表内原形态（不是裸 id）')

  // ② 表里没有，但 `fullOrder`（= effectiveOrder 的产物 = 树里的真实 id）里有 ⇒ 用树里的形态。
  const inTree = insertSessionAtFront({ manual: true }, 'w:/repo', normalize(prefixed), [prefixed, 'session-y'])
  assert.equal(inTree.sessions['w:/repo'][0], prefixed, '★ 复用树内原形态（不是裸 id）')

  // ③ 都没有（会话当前不可见）⇒ 回落调用方给的形态。
  const fallback = insertSessionAtFront({ manual: true }, 'w:/repo', 'session-fresh')
  assert.equal(fallback.sessions['w:/repo'][0], 'session-fresh', '回落调用方形态')
})

test('T7/B1: `placementOfSession` 返回树里的**真实 id 形态**（B1 修复的取形态入口）', () => {
  const sessions = new Map([['w:/repo', ['session-aaa', 'session-bbb']]])
  assert.deepEqual(
    placementOfSession(sessions, 'aaa'),
    { containerKey: 'w:/repo', sessionId: 'session-aaa' },
    '★ 裸 id 查询 ⇒ 返回带前缀的真实形态',
  )
  assert.deepEqual(placementOfSession(sessions, 'session-bbb'), { containerKey: 'w:/repo', sessionId: 'session-bbb' })
  assert.equal(placementOfSession(sessions, 'nope'), undefined, '找不到 ⇒ undefined')
  assert.equal(placementOfSession(sessions, ''), undefined, '空 id ⇒ undefined')
  // `containerKeyOfSession` 与它同源（前者只是取 `.containerKey`）。
  assert.equal(containerKeyOfSession(sessions, 'aaa'), 'w:/repo', '两函数同源')
})

// ── B2：落表 effect 收敛（用户拖动新会话不被回滚）───────────────────────────

/** 与 `sidebar.tsx` 的 D2 落表 effect **逐行同构**的纯函数复刻（含台账消费）。 */
function runD2Effect(manualOrder, sessions, state) {
  if (manualOrder.manual !== true) return { order: manualOrder, state, changed: false }
  if (state.newSessionIds.length === 0) return { order: manualOrder, state, changed: false }
  const plan = planNewSessionInserts(manualOrder, sessions, state.newSessionIds, state.writtenNewSessionIds)
  const nextState = plan.consumed.length > 0 ? markNewSessionsWritten(state, plan.consumed) : state
  if (!plan.changed) return { order: manualOrder, state: nextState, changed: false }
  return { order: plan.order, state: nextState, changed: true }
}

test('T7/B2: 落表只发生一次；用户把新会话拖到任意位置后 effect 重跑**不再改写**持久顺序', () => {
  const old5 = realSessions()
  const list = [...old5, session(REAL_IDS.new, { updatedAt: 99_999 })]

  let state = initialTopZoneState()
  state = observeTopZone(
    state,
    observationsOf(topZoneFixture([...old5, session(REAL_IDS.new, { blank: true, updatedAt: 99_999 })])),
    1000,
  )
  state = observeTopZone(state, observationsOf(topZoneFixture(list)), 2000)
  const defaults = effectiveOrder({ ...topZoneFixture(list), manualOrder: undefined })

  // 第 1 次 effect：新会话落表首。
  const first = runD2Effect(
    { manual: true, sessions: { 'w:/repo': old5.map((s) => s.sessionId) } },
    defaults.sessions,
    state,
  )
  assert.equal(first.changed, true, '首次 ⇒ 落表')
  assert.equal(first.order.sessions['w:/repo'][0], REAL_IDS.new, '新会话在表首')
  assert.deepEqual(first.state.writtenNewSessionIds, [normalize(REAL_IDS.new)], '★ 台账记入（B2 的收敛点）')

  // 第 2 次 effect（同一状态、同一新会话）：幂等 ⇒ 不再写。
  const second = runD2Effect(first.order, defaults.sessions, first.state)
  assert.equal(second.changed, false, '★ 幂等：第二次 effect 不写')
  assert.deepEqual(second.order.sessions['w:/repo'], first.order.sessions['w:/repo'], '表逐字不变')

  // ★ 用户把新会话**拖到末尾**（`manualOrder` 变化 ⇒ effect 依赖变化**必然重跑**）。
  const dragged = reorderKeys(first.order.sessions['w:/repo'], REAL_IDS.new, REAL_IDS.o4, 'after')
  assert.notEqual(dragged, null, '这是一次真实重排')
  assert.equal(dragged[dragged.length - 1], REAL_IDS.new, '拖动后新会话在末尾')
  const afterDrag = runD2Effect({ manual: true, sessions: { 'w:/repo': dragged } }, defaults.sessions, second.state)

  assert.equal(afterDrag.changed, false, '★ 拖动后 effect 重跑 ⇒ **不改写**持久顺序（原实现会回滚，T6 B2）')
  assert.deepEqual(afterDrag.order.sessions['w:/repo'], dragged, '★ 用户的拖动结果被完整保留（新会话仍在末尾）')
  assert.equal(afterDrag.order.sessions['w:/repo'][0], REAL_IDS.o0, '★ 新会话**没有**被搬回表首')

  // ★ 反向拖动（拖回最前）同样不被 effect 干扰，且台账已消费 ⇒ 不产生重复条目。
  const draggedBack = reorderKeys(afterDrag.order.sessions['w:/repo'], REAL_IDS.new, REAL_IDS.o0, 'before')
  const afterBack = runD2Effect({ manual: true, sessions: { 'w:/repo': draggedBack } }, defaults.sessions, afterDrag.state)
  assert.equal(afterBack.changed, false, '拖回最前也不改写')
  assert.deepEqual(afterBack.order.sessions['w:/repo'], draggedBack, '结果被保留')
  assert.equal(
    afterBack.order.sessions['w:/repo'].filter((id) => id === REAL_IDS.new).length,
    1,
    '★ 不产生重复条目',
  )
})

test('T7/B2 + T9: 收敛**不削弱 D3d** —— 落表后 `newSessionIds` 仍含新会话；台账只停止**重复落表**与**渲染期重复提升**', () => {
  // B2 的收敛**绝不能**靠「落表后从 `newSessionIds` 移除」实现 —— 那是 D3d 的顶部区输入，
  // 新会话在整个页面会话内都应被「视为新会话」。台账（`writtenNewSessionIds`）与之分开：
  // 它只回答两件事 —— ① D2 落表还要不要再做一次；② 渲染期还要不要再提升一次（T9 缺陷 1）。
  const old5 = realSessions()
  const list = [...old5, session(REAL_IDS.new, { updatedAt: 99_999 })]
  let state = initialTopZoneState()
  state = observeTopZone(
    state,
    observationsOf(topZoneFixture([...old5, session(REAL_IDS.new, { blank: true, updatedAt: 99_999 })])),
    1000,
  )
  state = observeTopZone(state, observationsOf(topZoneFixture(list)), 2000)
  const defaults = effectiveOrder({ ...topZoneFixture(list), manualOrder: undefined })
  const first = runD2Effect(
    { manual: true, sessions: { 'w:/repo': old5.map((s) => s.sessionId) } },
    defaults.sessions,
    state,
  )

  assert.deepEqual(first.state.newSessionIds, [normalize(REAL_IDS.new)], '★ D3d 输入不变（仍判为新会话）')
  assert.deepEqual(pendingNewSessionIdsOf(first.state), [], '★ 待落表队列已清空（B2 收敛）')

  // ⚠️ T9：落表后**渲染期不再提升**该新会话（否则用户拖动它会被静默回滚）。
  // 它此时位于持久表表首 ⇒ 渲染结果**仍是第一位**（D3d 的可见结果不变，只是来源变成持久顺序）。
  const rendered = buildRows(
    topZoneFixture(list, {
      manualOrder: first.order,
      topZone: topZoneInputOf(first.state),
    }),
  )
  assert.equal(containerIds(rendered)[0], REAL_IDS.new, '★ 落表后仍渲染在第一位（由持久顺序承载）')
  assert.deepEqual(
    topZoneSessionKeys(list, undefined, 'w:/repo', topZoneInputOf(first.state)),
    undefined,
    '★ 台账里的新会话**不再**被渲染期提升（T9 缺陷 1 的收敛点：提升权交给持久顺序）',
  )

  // 用户随后把新会话拖到末尾 ⇒ 渲染**跟随**用户的拖动（不回弹），且持久表逐字保留。
  const dragged = reorderKeys(first.order.sessions['w:/repo'], REAL_IDS.new, REAL_IDS.o4, 'after')
  const afterDragRows = buildRows(
    topZoneFixture(list, {
      manualOrder: { manual: true, sessions: { 'w:/repo': dragged } },
      topZone: topZoneInputOf(first.state),
      // 展开容器 ⇒ 绕过 5 条截断，让「渲染 = 用户拖动结果」这条断言不被截断掩盖。
      expandedAllKeys: { 'w:/repo': true },
    }),
  )
  assert.deepEqual(
    containerIds(afterDragRows),
    dragged,
    '★ 拖动结果被完整渲染（新会话在末尾、不回弹）—— 这正是真人 GUI 复验的缺陷 1',
  )

  // 对照（断言非恒真）：**未落表**的新会话仍会被渲染期提升（D3d 语义未被整体削弱）。
  const notWritten = { ...first.state, writtenNewSessionIds: [] }
  assert.equal(
    containerIds(
      buildRows(
        topZoneFixture(list, {
          manualOrder: { manual: true, sessions: { 'w:/repo': dragged } },
          topZone: topZoneInputOf(notWritten),
        }),
      ),
    )[0],
    REAL_IDS.new,
    '★ 对照组：未落表 ⇒ 仍在渲染期被提升到第一位',
  )
})

test('T7/B2: `planNewSessionInserts` 只消费「落表意图已满足」的 id（不可见的新会话不消费）', () => {
  const sessions = new Map([['w:/repo', ['session-a']]])
  // `session-ghost` 不在树里（仍是 blank 被过滤 / 已归档 / 别的容器）⇒ 本次**不消费**，
  // 等它可见时再落表，不永久丢失这次 D2 意图。
  const plan = planNewSessionInserts({ manual: true }, sessions, ['a', 'ghost'], [])
  assert.deepEqual(plan.consumed, ['a'], '★ 只消费可见的那个')
  assert.deepEqual(plan.order.sessions['w:/repo'], ['session-a'], '不可见的不写表')

  // 已消费的 id ⇒ 跳过（幂等，不重放）；仍不可见的 `ghost` 继续不消费（不误记台账）。
  const again = planNewSessionInserts({ manual: true }, sessions, ['a', 'ghost'], ['a'])
  assert.deepEqual(again.consumed, [], '★ 台账里的 id 不再重放，不可见的仍不消费')
  assert.equal(again.changed, false, '无可写项 ⇒ 无改动')

  // `ghost` 变可见（用户给它发了首条消息 ⇒ 不再 blank）⇒ 这一次才落表 + 消费。
  const visible = new Map([['w:/repo', ['session-a', 'session-ghost']]])
  const later = planNewSessionInserts({ manual: true }, visible, ['a', 'ghost'], ['a'])
  assert.deepEqual(later.consumed, ['ghost'], '★ 可见后落表并消费（D2 意图不丢失）')
  assert.deepEqual(later.order.sessions['w:/repo'], ['session-ghost', 'session-a'], '★ 插到表首、写入树里的真实形态')
  assert.equal(later.changed, true, '真的改动了顺序')

  // 默认模式 ⇒ 原样返回、**不消费**（D2：不写、不建表）。
  const off = planNewSessionInserts({ manual: false }, sessions, ['a'], [])
  assert.deepEqual(off, { order: { manual: false }, consumed: [], changed: false }, '★ 默认模式不消费、不改动')

  // 空入参不抛。
  assert.doesNotThrow(() => planNewSessionInserts({ manual: true }, sessions, [], []), '空列表不抛')
  assert.doesNotThrow(() => planNewSessionInserts({ manual: true }, sessions, [undefined, 7, ''], []), '契约外元素不抛')
})

test('T7/B2: `markNewSessionsWritten` 幂等 + 无变化返回同一引用（不触发无谓重渲染）', () => {
  const state = initialTopZoneState()
  const once = markNewSessionsWritten(state, ['a', 'session-b'])
  assert.deepEqual(once.writtenNewSessionIds, ['a', 'b'], '★ 记入时归一化')
  assert.equal(markNewSessionsWritten(once, ['b', 'a']), once, '★ 已全部记入 ⇒ 返回同一引用（幂等）')
  assert.equal(markNewSessionsWritten(state, []), state, '空列表 ⇒ 同一引用')
  assert.equal(markNewSessionsWritten(state, [undefined, 7, '']), state, '契约外元素 ⇒ 同一引用')
  assert.deepEqual(state.writtenNewSessionIds, [], '入参未被修改（纯函数）')
})

// ── T11：拖拽只改写持久顺序（释放机制已删除，见上方 T11 段）────────────────────

test('T11: 拖动**已结束**的会话 ⇒ 只改持久顺序，不产生任何运行时状态变化', () => {
  // 本轮首要缺陷的**纯函数层**回归锁。
  //
  // 旧实现（T5→T9）：拖拽会调 `releaseTopZoneContainer` 把容器标记为「已拖动过」，
  // 而「刚结束保留」让 `topZoneSessionKeys` 把已结束的会话钉在顶部区 ⇒ `buildRows`
  // 无论持久顺序怎么写都把它画回最前（= 用户看到的「拖不动 / 回弹」）。
  //
  // 新语义（T11 终裁）：「刚结束保留」整体删除 ⇒ 已结束的会话不在顶部区 ⇒
  // **渲染顺序 = 持久顺序**，拖到哪就留在哪。
  const list = [
    session('session-o0', { updatedAt: 1000 }),
    session('session-done', { updatedAt: 900 }),   // 刚跑完（已结束）
    session('session-run', { updatedAt: 800, running: true }),
  ]
  const state = { ...initialTopZoneState(), baselined: true, runningOf: { 'session-run': true } }
  const zone = topZoneInputOf(state)
  assert.deepEqual(zone.runningSessionIds, ['session-run'], '前置：只有 run 在跑')

  // 用户把已结束的 done 拖到最前（渲染层给它的持久顺序表写成 [done, o0, run]）。
  const manualOrder = { manual: true, sessions: { 'w:/repo': ['session-done', 'session-o0', 'session-run'] } }
  const rows = buildRows(topZoneFixture(list, { manualOrder, topZone: zone }))
  assert.deepEqual(
    containerIds(rows),
    ['session-run', 'session-done', 'session-o0'],
    '★ 渲染 = 运行中置顶 + 其余严格按持久顺序（done 被拖到 o0 之前 ⇒ 渲染里也在 o0 之前）',
  )

  // 对照：把 done 拖到**最后** ⇒ 渲染里它也在最后（证明位置真的由持久顺序决定）。
  const manualOrder2 = { manual: true, sessions: { 'w:/repo': ['session-o0', 'session-run', 'session-done'] } }
  const rows2 = buildRows(topZoneFixture(list, { manualOrder: manualOrder2, topZone: zone }))
  assert.deepEqual(
    containerIds(rows2),
    ['session-run', 'session-o0', 'session-done'],
    '★ 拖到哪就留在哪（不回弹）—— 与旧实现「恒被画回顶部区」形成对照',
  )
})

test('T11: 运行时状态**不含**任何「已拖动容器」信息（拖拽不产生 state 变更）', () => {
  const state = initialTopZoneState()
  assert.equal('releasedContainerKeys' in state, false, '★ `releasedContainerKeys` 字段已删除')
  assert.equal('releasedContainerKeys' in topZoneInputOf(state), false, '★ 渲染期投影里也没有它')
})

// ── I3：归档语义（「谁算旧会话」与「谁参与顶部区判定」分开）──────────────────

test('T7/I3: 归档会话进 `known` ⇒ 取消归档 + 新消息**不再**误判为新会话', () => {
  // T6 缺陷 I3：原实现 `eligible` 过滤掉归档会话 ⇒ `known` 不含它 ⇒ 取消归档后
  // `firstSeenAfterStart` 会把它判成新会话并写进固化表表首（违反 D5）。
  const T0 = 1_000_000_000_000
  const base = [session('session-s1', { updatedAt: T0 - 1000 }), session('session-oldarch', { updatedAt: T0 - 500 })]
  let state = observeTopZone(
    initialTopZoneState(),
    observationsOf(topZoneFixture(base, { archivedSessionIds: ['session-oldarch'] })),
    T0,
  )
  assert.ok(state.knownSessionIds.includes('oldarch'), '★ 归档会话进 `known`（I3 修复点）')
  assert.equal(state.runningOf['oldarch'], undefined, '★ 但**不进轨迹**（不参与任何顶部区判定）')

  // 取消归档 + 收到新消息（updatedAt 推进到基线之后）⇒ 不判新会话。
  state = observeTopZone(
    state,
    observationsOf(
      topZoneFixture([session('session-s1', { updatedAt: T0 - 1000 }), session('session-oldarch', { updatedAt: T0 + 600_000 })]),
    ),
    T0 + 600_000,
  )
  assert.deepEqual(state.newSessionIds, [], '★ 不判新会话（原实现在此为 ["oldarch"]）')

  // 对照（断言非恒真）：同一时序下，一条**从未见过**且晚于基线的会话仍会被判为新会话。
  state = observeTopZone(
    state,
    observationsOf(
      topZoneFixture([
        session('session-s1', { updatedAt: T0 - 1000 }),
        session('session-oldarch', { updatedAt: T0 + 600_000 }),
        session('session-really-new', { updatedAt: T0 + 700_000 }),
      ]),
    ),
    T0 + 700_000,
  )
  assert.deepEqual(state.newSessionIds, ['really-new'], '★ 对照组：真正的新会话仍被正确判出')
})

test('T7/I3: **基线之后**才首次出现（且当场归档）的会话 ⇒ 也进 `known`（两条路径都覆盖）', () => {
  // 上面那条覆盖「基线时就已归档」。这条覆盖**另一条**路径：会话在基线之后才第一次出现，
  // 出现时**当场就是归档态**（`seen` 收集在归档过滤**之前**，所以它仍进 `known`）。
  const T0 = 1_000_000_000_000
  let state = observeTopZone(
    initialTopZoneState(),
    observationsOf(topZoneFixture([session('session-s1', { updatedAt: T0 - 1000 })])),
    T0,
  )
  // 基线之后首次出现，但已是归档态（updatedAt 晚于基线 —— 若不记 known 就会被判新会话）。
  state = observeTopZone(
    state,
    observationsOf(
      topZoneFixture(
        [session('session-s1', { updatedAt: T0 - 1000 }), session('session-late-arch', { updatedAt: T0 + 1000 })],
        { archivedSessionIds: ['session-late-arch'] },
      ),
    ),
    T0 + 2000,
  )
  assert.deepEqual(state.newSessionIds, [], '★ 归档态不判新会话（连「刚出现就归档」也不误插）')
  assert.ok(state.knownSessionIds.includes('late-arch'), '★ 进 `known`（存在过的事实被记住）')

  // 随后取消归档 + 新消息 ⇒ 仍不判新会话。
  state = observeTopZone(
    state,
    observationsOf(
      topZoneFixture([
        session('session-s1', { updatedAt: T0 - 1000 }),
        session('session-late-arch', { updatedAt: T0 + 5000 }),
      ]),
    ),
    T0 + 5000,
  )
  assert.deepEqual(state.newSessionIds, [], '★ 取消归档后仍不判新会话')
})

test('T7/I3: 归档会话仍不进顶部区（I3 修复未放宽归档排除）', () => {
  const rows = buildRows(
    topZoneFixture([session('session-o0', { updatedAt: 5 }), session('session-gone', { updatedAt: 1, running: true })], {
      archivedSessionIds: ['session-gone'],
      manualOrder: { manual: true, sessions: { 'w:/repo': ['session-o0'] } },
      topZone: topZoneOf({ runningSessionIds: ['session-gone'], newSessionIds: ['session-gone'] }),
    }),
  )
  assert.deepEqual(containerIds(rows), ['session-o0'], '归档会话不渲染 ⇒ 顶部区 key 找不到 ⇒ 静默降级')
})

// ── S1 / S2：次要项的防御性修复 ─────────────────────────────────────────────

test('T7/S1: `insertSessionAtFront` 遇**空数组**表项 ⇒ 用 `fullOrder` 兜底（不丢会话）', () => {
  const next = insertSessionAtFront(
    { manual: true, sessions: { 'w:/repo': [] } },
    'w:/repo',
    'session-NEW',
    ['session-a', 'session-b', 'session-c'],
  )
  assert.deepEqual(
    next.sessions['w:/repo'],
    ['session-NEW', 'session-a', 'session-b', 'session-c'],
    '★ 空数组表项按「表里没有这个容器」处理 ⇒ 不丢 a/b/c（原实现结果为 ["session-NEW"]）',
  )
  // 对照：表项缺失（原实现已正确）行为不变。
  assert.deepEqual(
    insertSessionAtFront({ manual: true, sessions: {} }, 'w:/repo', 'session-NEW', ['session-a']).sessions['w:/repo'],
    ['session-NEW', 'session-a'],
    '对照：表项缺失行为不变',
  )
  // 对照：非空表项仍以**表**为基底（不被 `fullOrder` 覆盖）。
  assert.deepEqual(
    insertSessionAtFront({ manual: true, sessions: { 'w:/repo': ['session-x'] } }, 'w:/repo', 'session-NEW', ['session-a']).sessions['w:/repo'],
    ['session-NEW', 'session-x'],
    '对照：非空表项以表为基底',
  )
})

test('T7/S2: 契约外 `topZone` 输入（null / 数字字段）⇒ 不抛 TypeError（静默降级）', () => {
  const list = [session('session-a', { updatedAt: 1 })]
  const bad = [null, 42, 'x', { runningSessionIds: 42 }, { newSessionIds: 42 }, { writtenNewSessionIds: 42 }]
  for (const zone of bad) {
    assert.doesNotThrow(
      () => topZoneSessionKeys(list, undefined, 'w:/repo', zone),
      `契约外 topZone ${JSON.stringify(zone)} 不得抛 TypeError`,
    )
  }
  // 对照（断言非恒真）：合法输入仍生效。
  assert.deepEqual(
    topZoneSessionKeys(list, undefined, 'w:/repo', { runningSessionIds: ['session-a'] }),
    ['session-a'],
    '★ 对照组：合法 topZone 仍置顶',
  )
  // 经 `buildRows` 的完整路径也不抛。
  assert.doesNotThrow(
    () => buildRows(topZoneFixture(list, { topZone: null })),
    'buildRows 传 null topZone 不抛',
  )
})

// ---------------------------------------------------------------------------
// T9（2026-09-22）：**真人 GUI 复验**发现的真实运行时缺陷的回归锁定
//
// 背景：T7 修复 + T8 复审都判「B2 已修、建议验收」，但**真人 GUI 复验当场复现了缺陷**。
// 根因是 T7/T8 的验证方式把 `sidebar.tsx` 的 effect 逻辑**在 JS 里逐行重写一遍**（同构
// 复刻）再跑，而重写版里台账状态是长期存活的；真实 React 运行时里该状态会被 memo/state
// 重算重置 —— 所以复刻版测不出问题。
//
// ⚠️ 本节**刻意不复刻 effect**：所有断言都打在**真实纯函数链路**上，并按**真实 React
// 生命周期**组织调用序列（`observeTopZone` → `topZoneInputOf` → `buildRows` /
// `planNewSessionInserts` → 用户拖拽 → 再用**新构造的 state** 重跑编排）。
// 「从树数据重新构造 state 后再编排」这条序列正是复刻版**做不到**的那一步。
//
// 两个缺陷（用户权威报告，手动模式 `manual: true`）：
// - **缺陷 1**：拖动新会话到分组内另一位置 ⇒ 它**弹回原位**；且同分组另一个**正在运行**
//   的会话**掉到最下面**；
// - **缺陷 2（D4 语义收窄）**：运行中的会话**始终**留在顶部区（D3a 优先），拖拽**只清除
//   该容器的「刚结束保留」**。
//
// 真实数据来源（只读核对，未改动）：
// - 用户真实固化表：`Local Storage/leveldb` 解出 `dsh-worktree-groups.order`
//   = `manual:true`、**55 条 id、全部带 `session-` 前缀、裸 id = 0**、10 个容器；
// - 用户真实会话：`~/.dsh/sessions/**` 会话头 `id = 'session-<uuid>'`；
// - 归档通道：`~/.dsh/storages/workspace.json` 的 `global.archivedSessionIds`
//   = **173 条、全部带前缀**，且**树里不含它们**（`buildProjects` 已剔除）。
// ---------------------------------------------------------------------------

/**
 * **真实生命周期驱动器**：把 `sidebar.tsx` 里的**真实调用序列**组织成可被测试直接调用的
 * 纯函数 —— 它**不重写**任何 effect 逻辑，只按顺序调用 `tree-model.ts` 的**真实导出**。
 *
 * 与 T7 的 `runD2Effect` 的关键差别：本函数接受 `state` 作为**入参**（调用方可以在两次
 * 编排之间**从树数据重新构造 state**），因此能验证「台账跨 memo/state 重算存活」这一
 * 真实运行时性质；复刻版把 state 闭包在函数里，永远测不出这一点。
 */
function t9Pipeline({ list, manualOrder, state, currentSessionId, archivedSessionIds = [], nowMs = 2000 }) {
  // ① `sidebar.tsx:1822-1835` 的观测 effect：树变了 ⇒ observeTopZone。
  const observed = observeTopZone(
    state,
    observationsOf({ projects: topZoneFixture(list).projects, ungrouped: [], archivedSessionIds }),
    nowMs,
  )
  // ② `sidebar.tsx:1838` 的 memo：state → 渲染期输入。
  const zone = topZoneInputOf(observed)
  // ③ `sidebar.tsx:1911-1921` 的容器归属：**不含 manualOrder** 的纯默认顺序。
  const defaults = effectiveOrder({ ...topZoneFixture(list), manualOrder: undefined })
  // ④ `sidebar.tsx:1922-1937` 的 D2 落表 effect（真实编排函数，非复刻）。
  let order = manualOrder
  let nextState = observed
  if (manualOrder.manual === true && pendingNewSessionIdsOf(observed).length > 0) {
    const plan = planNewSessionInserts(
      manualOrder,
      defaults.sessions,
      observed.newSessionIds,
      observed.writtenNewSessionIds,
    )
    if (plan.consumed.length > 0) nextState = markNewSessionsWritten(observed, plan.consumed)
    if (plan.changed) order = plan.order
  }
  // ⑤ `sidebar.tsx:2155-2158` 的渲染：buildRows（含**新构造的** zone）。
  // ⚠️ 容器**显式展开**（`expandedAllKeys`）⇒ 绕过 5 条截断，使「渲染顺序 = 持久顺序」
  // 这条断言不被截断掩盖（截断本身由既有 T5/截断 用例覆盖）。
  const rows = buildRows(
    topZoneFixture(list, {
      manualOrder: order,
      topZone: topZoneInputOf(nextState),
      expandedAllKeys: { 'w:/repo': true },
      ...(currentSessionId === undefined ? {} : { currentSessionId }),
    }),
  )
  return { state: nextState, order, rows, ids: containerIds(rows) }
}

/**
 * `sidebar.tsx` 的 `commitDrag` 的**语义**（不重写判据，直接调真实导出）。
 *
 * ⚠️ **T11（2026-09-22 用户终裁）**：此处的「拖动 ⇒ 调 `releaseTopZoneContainer` 释放该容器」
 * 一步已**删除**（连同 `isTopZoneReleasingDrag`）—— 释放机制的唯一目的是清除「刚结束保留」，
 * 而后者已按用户终裁整体删除。⇒ **拖拽现在只做一件事：改写持久顺序。**
 * 因此本驱动器的状态**原样透传**，不再有 `nextState` 的分支。
 */
function t9Drag({ list, manualOrder, state, activeId, overId, half, currentSessionId }) {
  const active = { kind: 'session', key: `s:${activeId}`, itemId: activeId, containerKey: 'w:/repo' }
  const over = { key: `s:${overId}`, half }
  const next = reorderKeys(manualOrder.sessions['w:/repo'], active.itemId, over.key.slice('s:'.length), over.half)
  const order = next === null ? manualOrder : { ...manualOrder, manual: true, sessions: { 'w:/repo': next } }
  // 拖动后 D2 落表 effect **必然重跑**（`manualOrder` 是它的依赖）—— 这里如实模拟这次重跑。
  // ⚠️ state 原样传入（T11：拖拽不再产生任何运行时状态变化）。
  return { state, order, rerun: t9Pipeline({ list, manualOrder: order, state, currentSessionId }) }
}

test('T9/缺陷1 真实生命周期: **从树数据重新构造 state** 后再编排 ⇒ 新会话**不重复插入**，且用户拖到哪就留在哪', () => {
  // 这是缺陷 1 的**核心验收**，也是 T7/T8 漏检的那一步：它们把 state 闭包在复刻函数里，
  // 而真实 React 运行时里 `topZoneState` 会被重算/重置。本用例**显式**用新构造的 state 重跑。
  const old4 = realSessions()
  const list = [...old4, session(REAL_IDS.new, { updatedAt: 99_999 })]

  // 第 1 步：新会话还是 blank（宿主刚建）。
  let state = observeTopZone(
    initialTopZoneState(),
    observationsOf(topZoneFixture([...old4, session(REAL_IDS.new, { blank: true, updatedAt: 99_999 })])),
    1000,
  )
  // 第 2 步：发第一条消息 ⇒ 不再 blank。
  const first = t9Pipeline({
    list,
    manualOrder: { manual: true, sessions: { 'w:/repo': old4.map((s) => s.sessionId) } },
    state,
    nowMs: 2000,
  })
  assert.deepEqual(first.state.writtenNewSessionIds, [normalize(REAL_IDS.new)], '★ 台账记入（D2 落表已完成）')
  assert.equal(first.order.sessions['w:/repo'][0], REAL_IDS.new, '★ 新会话落在固化表表首（B1 形态逐字一致）')
  assert.equal(first.ids[0], REAL_IDS.new, '★ 渲染第一位')

  // 第 3 步（★ 真实生命周期）：**从树数据重新构造 state** —— 模拟 memo/state 重算。
  // 复刻版（T7/T8）在这一步会把台账丢掉；本实现必须让台账**跨重算存活**。
  const rebuilt = observeTopZone(
    initialTopZoneState(), // ← 只有 baselined=false 的初值才会丢台账；真实链路传的是上一步 state
    observationsOf(topZoneFixture(list)),
    3000,
  )
  assert.deepEqual(rebuilt.writtenNewSessionIds, [], '（说明）**只有**把 state 重置成初值才会丢台账 —— 真实链路传的是上一状态')

  // 真实链路：state 是 React 的**持久 state**（`sidebar.tsx:1626` 的 `useState`），
  // 观测 effect 用**函数式更新** `previous => observeTopZone(previous, …)`（`:1824`）
  // ⇒ 台账被**显式透传**（`observeTopZone` 的两个返回分支都带 `writtenNewSessionIds`）。
  const carried = t9Pipeline({ list, manualOrder: first.order, state: first.state, nowMs: 3000 })
  assert.deepEqual(
    carried.state.writtenNewSessionIds,
    [normalize(REAL_IDS.new)],
    '★ 台账跨观测重算**存活**（`observeTopZone` 两个返回分支都透传它）',
  )

  // 第 4 步（用户报告的动作）：把新会话拖到分组内**另一个位置**（OLD[1] 之后）。
  const drag = t9Drag({
    list,
    manualOrder: carried.order,
    state: carried.state,
    activeId: REAL_IDS.new,
    overId: REAL_IDS.o1,
    half: 'after',
  })
  assert.deepEqual(
    drag.order.sessions['w:/repo'].indexOf(REAL_IDS.new),
    2,
    '★ 持久表里新会话被移到第 3 位（用户拖动被持久化）',
  )
  assert.deepEqual(
    drag.rerun.ids,
    drag.order.sessions['w:/repo'],
    '★ **渲染跟随用户的拖动**（不回弹）—— 缺陷 1 的修复点（旧实现在此为原顺序）',
  )
  assert.equal(drag.rerun.ids[0], REAL_IDS.o0, '★ 新会话**没有**被渲染期提升搬回表首')
  assert.deepEqual(
    drag.rerun.state.writtenNewSessionIds,
    [normalize(REAL_IDS.new)],
    '★ 台账仍只记一次（不因拖动而重复插入）',
  )

  // 第 5 步：**再次**从树数据重新构造 state 并重跑编排 ⇒ 仍不重复插入（幂等）。
  const again = t9Pipeline({ list, manualOrder: drag.rerun.order, state: drag.rerun.state, nowMs: 4000 })
  assert.deepEqual(
    again.order.sessions['w:/repo'],
    drag.rerun.order.sessions['w:/repo'],
    '★ 重复编排**逐字不改**持久顺序（同一新会话只落表一次）',
  )
  assert.equal(
    again.order.sessions['w:/repo'].filter((id) => id === REAL_IDS.new).length,
    1,
    '★ 不产生重复条目',
  )

  // 第 6 步：**刷新页面**（运行时状态全丢，只剩持久顺序）⇒ 新会话仍在用户拖到的位置。
  const refreshed = buildRows(
    topZoneFixture(list, { manualOrder: again.order, expandedAllKeys: { 'w:/repo': true } }),
  )
  assert.deepEqual(
    containerIds(refreshed),
    again.order.sessions['w:/repo'],
    '★ 刷新后顺序 = 用户拖出来的顺序（D2 落表 + 不回弹的持久结果）',
  )
})

test('T9/缺陷1 对照（变异验证）: 台账被重置/丢弃 ⇒ 用户拖动**回弹**（旧实现的可复现反例）', () => {
  // 判别力证据：把「台账跨重算存活」这一条去掉（等价于 T7/T8 复刻版的失效模式），
  // 同一个用户动作立刻复现「弹回原位」。这证明上面的用例**不是恒真测试**。
  const old4 = realSessions()
  const list = [...old4, session(REAL_IDS.new, { updatedAt: 99_999 })]
  let state = observeTopZone(
    initialTopZoneState(),
    observationsOf(topZoneFixture([...old4, session(REAL_IDS.new, { blank: true, updatedAt: 99_999 })])),
    1000,
  )
  const first = t9Pipeline({
    list,
    manualOrder: { manual: true, sessions: { 'w:/repo': old4.map((s) => s.sessionId) } },
    state,
    nowMs: 2000,
  })
  const drag = t9Drag({
    list,
    manualOrder: first.order,
    state: first.state,
    activeId: REAL_IDS.new,
    overId: REAL_IDS.o1,
    half: 'after',
  })

  // ⚠️ 变异：模拟「台账在 state 重算后丢失」（= 旧实现 / T7 复刻版测不到的那种运行时）。
  const mutatedZone = { ...topZoneInputOf(drag.rerun.state), writtenNewSessionIds: [] }
  const mutated = buildRows(
    topZoneFixture(list, { manualOrder: drag.rerun.order, topZone: mutatedZone }),
  )
  assert.equal(
    containerIds(mutated)[0],
    REAL_IDS.new,
    '★ 变异后：新会话被渲染期提升搬回表首 ⇒ **复现「弹回原位」**（证明本组用例有判别力）',
  )
  assert.notDeepEqual(
    containerIds(mutated),
    drag.rerun.ids,
    '★ 变异前后渲染顺序**确实不同**（对照非恒真）',
  )
})

test('T9→T11/缺陷2 真实生命周期: 拖拽后**运行中的会话仍在顶部区**、已结束的会话**回到持久顺序**、新会话不回弹', () => {
  // 用户报告的第二个现象：拖动新会话时，**同一分组里另一个正在运行的会话掉到了最下面**。
  //
  // ⚠️ T11 语义更新（2026-09-22 用户终裁）：旧断言「刚结束保留被清除」是在**保留机制存在**
  // 的前提下写的。终裁把「刚结束保留」整体删除 ⇒ 已结束的会话**从一开始就不在顶部区**，
  // 根本不存在「被清除」这一步。本用例改为断言终裁后的正确行为。
  const NEW = REAL_IDS.new
  const RUN = REAL_IDS.o1
  const DONE = REAL_IDS.o2
  // `RUN` 正在跑；`DONE` 已跑完（终裁后它**不再**进顶部区）；其余空闲。
  const list = [
    session(REAL_IDS.o0, { updatedAt: 1000 }),
    session(RUN, { updatedAt: 1001, running: true }),
    session(DONE, { updatedAt: 1002 }),
    session(REAL_IDS.o3, { updatedAt: 1003 }),
    session(NEW, { updatedAt: 99_999 }),
  ]
  // 真实生命周期：基线里 DONE 在跑 ⇒ 之后观测到它停了。
  let state = observeTopZone(
    initialTopZoneState(),
    observationsOf(topZoneFixture([
      session(REAL_IDS.o0, { updatedAt: 1000 }),
      session(RUN, { updatedAt: 1001, running: true }),
      session(DONE, { updatedAt: 1002, running: true }),
      session(REAL_IDS.o3, { updatedAt: 1003 }),
      session(NEW, { blank: true, updatedAt: 99_999 }),
    ])),
    1000,
  )
  state = observeTopZone(state, observationsOf(topZoneFixture([...list.slice(0, 4), session(NEW, { blank: true, updatedAt: 99_999 })])), 2000)
  assert.equal('recentlyFinishedIds' in state, false, '★ T11：状态机里已无「刚结束保留」字段')

  const base = t9Pipeline({
    list,
    manualOrder: { manual: true, sessions: { 'w:/repo': list.map((s) => s.sessionId) } },
    state,
    nowMs: 2000,
  })
  // 顶部区只有「运行中（RUN）」与「尚未落表的新会话（NEW）」。
  assert.equal(base.ids[0], RUN, '★ 运行中的会话固定在容器最前')
  assert.ok(base.ids.includes(NEW), '新会话仍在（尚未落表 ⇒ 渲染期提升）')
  assert.equal(base.ids.indexOf(DONE) > 1, true, '★ 已结束的 DONE **不在**顶部区（T11 终裁）')

  // 用户拖动（把新会话拖到 OLD[3] 之后）。
  const drag = t9Drag({
    list,
    manualOrder: base.order,
    state: base.state,
    activeId: NEW,
    overId: REAL_IDS.o3,
    half: 'after',
  })
  // ⚠️ 注意：`t9Drag` 内部会重跑 D2 落表 effect（`manualOrder` 变化是它的依赖），
  // 因此 `drag.state` 可能因**观测推进**（新会话 blank→非 blank）而与入参不同 —— 那与拖拽无关。
  // 这里断言的是「拖拽**本身**不再产生释放类状态」：T11 后运行时状态里已无任何释放痕迹。
  assert.equal('releasedContainerKeys' in drag.state, false, '★ T11：拖拽不产生任何「释放」状态（字段已删除）')
  assert.deepEqual(
    Object.keys(drag.state).sort(),
    Object.keys(state).sort(),
    '★ 拖拽前后状态**字段集合一致**（拖拽不再引入新的运行时状态类别）',
  )

  const ids = drag.rerun.ids
  // ★ 核心断言 1：运行中的会话**仍在顶部区第一位**（旧实现把它沉到最下面）。
  assert.equal(ids.indexOf(RUN), 0, '★ 拖拽后：**运行中的会话仍在顶部区第一位**（旧实现沉底）')
  // ★ 核心断言 2：已结束的 DONE 位置完全由持久顺序决定。
  assert.deepEqual(
    ids.filter((id) => id !== RUN && id !== NEW),
    drag.order.sessions['w:/repo'].filter((id) => id !== RUN && id !== NEW),
    '★ 已结束的会话严格跟随持久顺序（T11：不再被任何运行时保留态干扰）',
  )
  // ★ 核心断言 3：新会话也不回弹 —— 渲染顺序 = 「顶部区成员（RUN）在前 + 其余按用户拖出来的
  // 持久顺序」。即把 RUN 摘掉后，剩余部分与持久顺序**逐字一致**。
  assert.deepEqual(
    ids.filter((id) => id !== RUN),
    drag.order.sessions['w:/repo'].filter((id) => id !== RUN),
    '★ 摘掉顶部区成员后，渲染顺序 = 用户拖出来的持久顺序（新会话不回弹）',
  )
  assert.equal(ids[ids.length - 1], NEW, '★ 新会话仍停在用户拖到的末尾位置（未回弹）')
})

test('T11: 当前会话在**已结束**时留在持久顺序位置（isCurrent 置顶已按终裁删除）', () => {
  const list = [
    session('session-o0', { updatedAt: 1000 }),
    session('session-run', { updatedAt: 1001, running: true }),
    session('session-cur', { updatedAt: 1002 }),
  ]
  const manualOrder = { manual: true, sessions: { 'w:/repo': list.map((s) => s.sessionId) } }
  const state = { ...initialTopZoneState(), baselined: true, startedAtMs: 0, runningOf: { 'session-run': true } }
  const rows = buildRows(
    topZoneFixture(list, { manualOrder, topZone: topZoneInputOf(state), currentSessionId: 'session-cur' }),
  )
  assert.deepEqual(
    containerIds(rows),
    ['session-run', 'session-o0', 'session-cur'],
    '★ 运行中置顶（D3a 保留）；当前会话 cur **不**置顶（用户明确不保留该例外），留在持久顺序末位',
  )
})

test('T9/缺陷1 真实生命周期: 台账**跨「内容有变化」的观测存活**（真实链路的每 30s 轮询都会重算）', () => {
  // ⚠️ 这条覆盖一个**只有真实运行时才会发生**的情形：`observeTopZone` 在「观测内容有变化」
  // 时会走**非基线返回分支**（`src/tree-model.ts` 的两个 `return` 分支都必须透传
  // `writtenNewSessionIds`）。若该分支漏传，台账就在下一次轮询（30s / 快照变化 / 窗口聚焦）
  // 时丢失 ⇒ 已落表的新会话重新进入 D2 落表 + 渲染期提升 ⇒ **用户已经拖走的会话被搬回表首**。
  //
  // 关键：轮询必须发生在**用户拖动之后**。拖动前轮询时新会话本来就在表首 ⇒ 台账丢失看不出
  // 差别（这也是 M5 变异在「先轮询后拖动」的顺序下**测不出**的原因）。
  const old4 = realSessions()
  const list = [...old4, session(REAL_IDS.new, { updatedAt: 99_999 })]
  let state = observeTopZone(
    initialTopZoneState(),
    observationsOf(topZoneFixture([...old4, session(REAL_IDS.new, { blank: true, updatedAt: 99_999 })])),
    1000,
  )
  const first = t9Pipeline({
    list,
    manualOrder: { manual: true, sessions: { 'w:/repo': old4.map((s) => s.sessionId) } },
    state,
    nowMs: 2000,
  })
  assert.deepEqual(first.state.writtenNewSessionIds, [normalize(REAL_IDS.new)], '前置：台账已记入')

  // 用户先把新会话拖到第 3 位（此刻持久表里它**不在**表首）。
  const drag = t9Drag({
    list,
    manualOrder: first.order,
    state: first.state,
    activeId: REAL_IDS.new,
    overId: REAL_IDS.o1,
    half: 'after',
  })
  assert.equal(drag.order.sessions['w:/repo'].indexOf(REAL_IDS.new), 2, '前置：新会话被拖到第 3 位')

  // ★ 现在来一次**内容有变化**的观测（别的会话开始跑）⇒ 走非基线返回分支。
  const bumped = [...old4.map((s, i) => (i === 0 ? { ...s, running: true } : s)), session(REAL_IDS.new, { updatedAt: 99_999 })]
  const afterPoll = t9Pipeline({ list: bumped, manualOrder: drag.rerun.order, state: drag.rerun.state, nowMs: 60_000 })
  assert.notEqual(afterPoll.state, drag.rerun.state, '前置：这次观测**确实有变化**（走了非基线返回分支）')
  assert.deepEqual(
    afterPoll.state.writtenNewSessionIds,
    [normalize(REAL_IDS.new)],
    '★ 台账跨「有变化的观测」存活（`observeTopZone` 的非基线分支必须透传它）',
  )
  assert.deepEqual(pendingNewSessionIdsOf(afterPoll.state), [], '★ 不因轮询而重新进入待落表队列')
  assert.deepEqual(
    afterPoll.order.sessions['w:/repo'],
    drag.rerun.order.sessions['w:/repo'],
    '★ 轮询**不改写**持久顺序（新会话仍在用户拖到的第 3 位）',
  )
  assert.deepEqual(
    afterPoll.ids.filter((id) => id !== REAL_IDS.o0),
    afterPoll.order.sessions['w:/repo'].filter((id) => id !== REAL_IDS.o0),
    '★ 轮询后渲染（摘掉顶部区成员 o0）= 用户拖出来的持久顺序（新会话仍在第 3 位、不回弹）',
  )

  // 对照组（断言非恒真）：同一序列下把台账清空 ⇒ 立刻回弹（这正是 M5 变异的表现）。
  const cleared = { ...afterPoll.state, writtenNewSessionIds: [] }
  const bounced = t9Pipeline({ list: bumped, manualOrder: afterPoll.order, state: cleared, nowMs: 61_000 })
  assert.notDeepEqual(bounced.ids, afterPoll.ids, '★ 对照前后渲染顺序确实不同')
  assert.equal(
    bounced.order.sessions['w:/repo'][0],
    REAL_IDS.new,
    '★ 对照组：台账丢失 ⇒ D2 落表重放，新会话被搬回表首',
  )
})

// ── N1/I3：**真实链路形态**下归档会话不被误判为新会话 ───────────────────────

test('T9/缺陷1 真实生命周期: 落表 effect **收敛**（写表 → 重渲染 → 再写 的循环不成立）', () => {
  // 验收要求 ③：不得产生「写表 → 重渲染 → 再写」循环。
  // 真实链路：`sidebar.tsx:1901-1938` 的 effect 依赖含 `topZoneState.writtenNewSessionIds`
  // ⇒ `markNewSessionsWritten` 改变 state 会让 effect 重跑一次，但那时
  // `pendingNewSessionIdsOf` 已为空 ⇒ 早退。这里如实模拟连续多轮（含每次 effect 后的重渲染）。
  const old4 = realSessions()
  const list = [...old4, session(REAL_IDS.new, { updatedAt: 99_999 })]
  let state = observeTopZone(
    initialTopZoneState(),
    observationsOf(topZoneFixture([...old4, session(REAL_IDS.new, { blank: true, updatedAt: 99_999 })])),
    1000,
  )
  let order = { manual: true, sessions: { 'w:/repo': old4.map((s) => s.sessionId) } }
  const writes = []
  const rendered = []
  for (let round = 0; round < 20; round += 1) {
    const step = t9Pipeline({ list, manualOrder: order, state, nowMs: 2000 + round })
    if (step.order !== order) writes.push(round)
    order = step.order
    state = step.state
    rendered.push(step.ids.join('|'))
  }

  assert.equal(writes.length, 1, `★ 20 轮重渲染里**只写 1 次**持久表（实际：${JSON.stringify(writes)}）`)
  assert.equal(writes[0], 0, '★ 唯一一次写入发生在第 1 轮（首次落表）')
  assert.equal(new Set(rendered).size, 1, '★ 20 轮渲染结果恒定（无抖动、无循环）')
  assert.equal(order.sessions['w:/repo'][0], REAL_IDS.new, '★ 新会话稳定在表首')
  assert.equal(
    order.sessions['w:/repo'].filter((id) => id === REAL_IDS.new).length,
    1,
    '★ 不产生重复条目',
  )
})

test('T9/缺陷1 真实生命周期: 「刷新页面」后**不重复插入**（持久表已含它 ⇒ 幂等）', () => {
  // 验收要求 ④：刷新页面后不重复插入。
  const old4 = realSessions()
  const list = [...old4, session(REAL_IDS.new, { updatedAt: 99_999 })]
  let state = observeTopZone(
    initialTopZoneState(),
    observationsOf(topZoneFixture([...old4, session(REAL_IDS.new, { blank: true, updatedAt: 99_999 })])),
    1000,
  )
  const first = t9Pipeline({
    list,
    manualOrder: { manual: true, sessions: { 'w:/repo': old4.map((s) => s.sessionId) } },
    state,
    nowMs: 2000,
  })

  // 「刷新」= 运行时状态归零（台账也归零），但**持久表**里已有该新会话（且已在表首）。
  const afterRefresh = t9Pipeline({
    list,
    manualOrder: first.order, // ← 持久表（含新会话，来自 localStorage）
    state: initialTopZoneState(), // ← 运行时状态重置
    nowMs: 10_000,
  })
  assert.deepEqual(
    afterRefresh.order.sessions['w:/repo'],
    first.order.sessions['w:/repo'],
    '★ 刷新后持久表**逐字不变**（幂等分支：它本来就在表首 ⇒ 不写）',
  )
  assert.equal(
    afterRefresh.order.sessions['w:/repo'].filter((id) => id === REAL_IDS.new).length,
    1,
    '★ 刷新后**不产生重复条目**',
  )
  assert.equal(afterRefresh.ids[0], REAL_IDS.new, '★ 刷新后仍渲染在第一位')

  // 第二次刷新（再来一轮）同样幂等。
  const twice = t9Pipeline({
    list,
    manualOrder: afterRefresh.order,
    state: initialTopZoneState(),
    nowMs: 20_000,
  })
  assert.deepEqual(twice.order.sessions['w:/repo'], afterRefresh.order.sessions['w:/repo'], '★ 反复刷新恒定')
})

// ── N1/I3：**真实链路形态**下归档会话不被误判为新会话 ───────────────────────

test('T9/N1 真实链路: 归档会话**不在树里**（真实形态）⇒ 仍进 `known`、**不**误判为新会话', () => {
  // T8 实测：`buildProjects`（`src/projects.ts:400` / `:480`）已把归档会话从树里剔除
  // ⇒ T7 的单测 fixture（归档会话**同时**在树里和 archivedSessionIds 里）与真实链路
  // **不同构**，那条用例对真实链路**恒真**。本用例用**真实链路形态**：树里**没有**归档
  // 会话，归档 id 只来自独立的 `archivedSessionIds` 通道。
  const T0 = 1_000_000_000_000
  const treeList = [session('session-s1', { updatedAt: T0 - 1000 })] // ← 树里**不含**归档会话
  const archivedIds = ['session-oldarch'] // ← 独立通道（真实值：173 条，全带前缀）

  let state = observeTopZone(
    initialTopZoneState(),
    observationsOf({ projects: topZoneFixture(treeList).projects, ungrouped: [], archivedSessionIds: archivedIds }),
    T0,
  )
  assert.ok(state.knownSessionIds.includes('oldarch'), '★ 真实链路形态下归档会话**进 `known`**（N1 修复点）')
  assert.equal(state.runningOf['oldarch'], undefined, '★ 但不进轨迹（不参与任何顶部区判定）')
  assert.equal(state.blankOf['oldarch'], undefined, '★ 也不进 blank 轨迹')

  // 取消归档 + 收到新消息（updatedAt 推进到基线之后）：树里**仍然**没有它之前，先看树里出现它。
  state = observeTopZone(
    state,
    observationsOf({
      projects: topZoneFixture([...treeList, session('session-oldarch', { updatedAt: T0 + 600_000 })]).projects,
      ungrouped: [],
      archivedSessionIds: [],
    }),
    T0 + 600_000,
  )
  assert.deepEqual(state.newSessionIds, [], '★ 真实链路形态下**不误判**为新会话（T8 实测旧实现为 ["oldarch"]）')

  // 对照（断言非恒真）：同一时序下，一条**从未见过**且晚于基线的会话仍被判为新会话。
  state = observeTopZone(
    state,
    observationsOf({
      projects: topZoneFixture([
        ...treeList,
        session('session-oldarch', { updatedAt: T0 + 600_000 }),
        session('session-really-new', { updatedAt: T0 + 700_000 }),
      ]).projects,
      ungrouped: [],
      archivedSessionIds: [],
    }),
    T0 + 700_000,
  )
  assert.deepEqual(state.newSessionIds, ['really-new'], '★ 对照组：真正的新会话仍被正确判出')
})

test('T9/N1 真实链路: 归档会话 id **不在树里**也参与「同一 id 只产出一条观测」的去重', () => {
  // 真实链路下归档 id 与树 id 不会重叠；但契约外输入（同一个 id 同时出现在两处）必须确定性。
  const obs = observationsOf({
    projects: topZoneFixture([session('session-dup', { updatedAt: 5 })]).projects,
    ungrouped: [],
    archivedSessionIds: ['session-dup', 'session-gone'],
  })
  const dupCount = obs.filter((o) => normalize(o.sessionId) === 'dup').length
  assert.equal(dupCount, 1, '★ 同一 id 只产出一条观测（树优先 ⇒ 不被补投影重复一遍）')
  assert.equal(
    obs.find((o) => normalize(o.sessionId) === 'dup').archived,
    true,
    '★ 树里的那条仍按**归档集合**判定（它确实在 archivedSessionIds 里）',
  )
  assert.ok(obs.some((o) => normalize(o.sessionId) === 'gone' && o.archived === true), '★ 只在归档通道里的 id 补出 archived 观测')

  // 契约外输入不抛。
  assert.doesNotThrow(
    () => observationsOf({ projects: [], ungrouped: [], archivedSessionIds: [undefined, 42, '', null] }),
    '契约外归档 id 不抛',
  )
})

test('T9/N1 变异验证: 去掉归档 id 的补投影 ⇒ 真实链路形态下**立刻误判**为新会话', () => {
  // 判别力证据：把「归档 id 补投影」这一条去掉（= 旧实现），真实链路形态下立刻复现误判。
  const T0 = 1_000_000_000_000
  const treeList = [session('session-s1', { updatedAt: T0 - 1000 })]
  const archivedIds = ['session-oldarch']

  // 变异：**只**投影树里的会话（旧 `observationsOf` 的行为）。
  const mutatedObservations = observationsOf({ projects: topZoneFixture(treeList).projects, ungrouped: [], archivedSessionIds: [] })
  assert.equal(
    mutatedObservations.some((o) => normalize(o.sessionId) === 'oldarch'),
    false,
    '（变异）归档会话确实不在观测批次里',
  )
  let state = observeTopZone(initialTopZoneState(), mutatedObservations, T0)
  assert.equal(state.knownSessionIds.includes('oldarch'), false, '（变异）`known` 不含归档会话')
  state = observeTopZone(
    state,
    observationsOf({
      projects: topZoneFixture([...treeList, session('session-oldarch', { updatedAt: T0 + 600_000 })]).projects,
      ungrouped: [],
      archivedSessionIds: [],
    }),
    T0 + 600_000,
  )
  assert.deepEqual(
    state.newSessionIds,
    ['oldarch'],
    '★ 变异后：旧会话被误判为新会话（T8 实测的真实链路缺陷）⇒ 证明上面的用例有判别力',
  )
  // 修复后的同一序列（对照）。
  let fixed = observeTopZone(
    initialTopZoneState(),
    observationsOf({ projects: topZoneFixture(treeList).projects, ungrouped: [], archivedSessionIds: archivedIds }),
    T0,
  )
  fixed = observeTopZone(
    fixed,
    observationsOf({
      projects: topZoneFixture([...treeList, session('session-oldarch', { updatedAt: T0 + 600_000 })]).projects,
      ungrouped: [],
      archivedSessionIds: [],
    }),
    T0 + 600_000,
  )
  assert.deepEqual(fixed.newSessionIds, [], '★ 修复后：同一序列 `newSessionIds = []`（对照非恒真）')
})

// ═══════════════════════════════════════════════════════════════════════════
// T11（2026-09-22 用户终裁）：顶部区 = 只有「正在运行」的会话；已结束会话完全由持久顺序决定
//
// ## 为什么单开一节（两轮真人 GUI 复验的教训）
//
// 教训一：T7/T8 的验证是「把 `sidebar.tsx` 的 effect 逻辑在 JS 里**逐行重写一遍**」再跑
// （同构复刻）⇒ 漏检。**本节不复刻任何 effect**：`t11Pipeline` 只按 `sidebar.tsx` 的
// **真实调用顺序**调用 `tree-model.ts` 的**真实导出**，且 `state` 一律作为**入参**传入
// （因此能验证「状态跨渲染重算存活」这一真实运行时性质）。
//
// 教训二：断言只检查**持久表内容**、不检查**渲染层结果**（`buildRows` 的输出顺序）会漏检
// 弹回类缺陷。**本节每一条断言都打在 `containerIds(rows)`（= `buildRows` 的会话行顺序）
// 上**，持久表只作为对照。
//
// ## 用户终裁（本节全部断言的语义基准）
//
// > 正在运行的会话固定在顶部，拖不动，只要是结束了的会话就不再固定置顶了。
//
// ⇒ ① 顶部区 = 只有「正在运行」（自身 running 或任意层级有 running subagent）；
//    ② 已结束的会话（含刚跑完的、含用户正在查看的旧会话）位置**完全由持久拖拽顺序决定**，
//       且**必须可正常拖动**（拖到哪就留在哪，不回弹）；
//    ③ 「刚结束保留」与「当前会话置顶」两个机制**已删除**；
//    ④ 「拖动释放」机制随之删除（它唯一的目的就是清 ③ 的第一项）。
// ═══════════════════════════════════════════════════════════════════════════

/**
 * **真实链路驱动器**：按 `sidebar.tsx` 的**真实调用顺序**调用真实导出，**不重写任何 effect**。
 *
 * 对应关系（行号为 T11 改动后的 `src/sidebar.tsx`）：
 * - ① 观测 effect（`tree` 变 ⇒ `observeTopZone`，函数式更新）；
 * - ② `topZone` memo（`topZoneInputOf`）；
 * - ③ D2 落表 effect 的容器归属（**不含 manualOrder** 的纯默认顺序 `effectiveOrder`）；
 * - ④ D2 落表 effect 本体（`pendingNewSessionIdsOf` → `planNewSessionInserts` →
 *      `markNewSessionsWritten`）；
 * - ⑤ 渲染（`buildRows`，含 `topZone` 与 `manualOrder`）。
 *
 * ⚠️ `state` 是**入参**：调用方可以在两次编排之间从树数据重新构造 state（复刻版做不到）。
 * ⚠️ 返回 `ids` = `buildRows` 的**会话行顺序**（渲染层结果），本节的断言全部打在它上面。
 */
function t11Pipeline({ list, manualOrder, state, currentSessionId, archivedSessionIds = [], nowMs = 2000, expand = true }) {
  // ① 观测 effect
  const observed = observeTopZone(
    state,
    observationsOf({ projects: topZoneFixture(list).projects, ungrouped: [], archivedSessionIds }),
    nowMs,
  )
  // ② topZone memo
  const zone = topZoneInputOf(observed)
  // ③④ D2 落表 effect（真实编排函数）
  let order = manualOrder
  let nextState = observed
  if (manualOrder.manual === true && pendingNewSessionIdsOf(observed).length > 0) {
    const defaults = effectiveOrder({ ...topZoneFixture(list), manualOrder: undefined })
    const plan = planNewSessionInserts(manualOrder, defaults.sessions, observed.newSessionIds, observed.writtenNewSessionIds)
    if (plan.consumed.length > 0) nextState = markNewSessionsWritten(observed, plan.consumed)
    if (plan.changed) order = plan.order
  }
  // ⑤ 渲染：**显式展开**容器 ⇒ 绕过 5 条截断，让「渲染顺序 vs 持久顺序」的断言不被截断掩盖
  //（截断本身由既有 T5/T11 截断用例覆盖）。
  const rows = buildRows(
    topZoneFixture(list, {
      manualOrder: order,
      topZone: topZoneInputOf(nextState),
      ...(expand ? { expandedAllKeys: { 'w:/repo': true } } : {}),
      ...(currentSessionId === undefined ? {} : { currentSessionId }),
    }),
  )
  return { state: nextState, order, zone: topZoneInputOf(nextState), rows, ids: containerIds(rows) }
}

/**
 * `sidebar.tsx` 的 `commitDrag` 的**语义**（直接调真实导出，不重写判据）。
 *
 * T11：拖拽**只**改写持久顺序（`reorderKeys`）；不再有任何运行时释放动作。
 * 另外如实模拟「拖动后 D2 落表 effect 必然重跑」（`manualOrder` 是它的依赖）。
 */
function t11Drag({ list, manualOrder, state, activeId, overId, half, currentSessionId, expand = true }) {
  const next = reorderKeys(manualOrder.sessions['w:/repo'], activeId, overId, half)
  const order = next === null ? manualOrder : { ...manualOrder, manual: true, sessions: { 'w:/repo': next } }
  return {
    order,
    changed: next !== null,
    rerun: t11Pipeline({ list, manualOrder: order, state, currentSessionId, expand }),
  }
}

/** 把一批「已结束」的会话观测两轮，制造真实的 running 下降沿（旧实现会进「刚结束保留」）。 */
function t11ObserveRunningThenStopped(runIds, list, nowMs = 2000) {
  const runningList = list.map((s) => (runIds.includes(s.sessionId) ? { ...s, running: true } : s))
  let state = observeTopZone(initialTopZoneState(), observationsOf(topZoneFixture(runningList)), 1000)
  state = observeTopZone(state, observationsOf(topZoneFixture(list)), nowMs)
  return state
}

// ── ① 首要缺陷：已结束的会话拖到分组内任意位置 ⇒ 渲染顺序 === 持久表顺序（不回弹）────

test('T11/① 首要缺陷: 已结束的会话拖到容器**任意位置** ⇒ 渲染顺序 === 持久表顺序（逐落点枚举）', () => {
  // 这是本轮**首要缺陷**的回归锁：用户报告「刚结束运行的会话拖不动、会回弹」。
  // 根因（诊断确证）：旧实现把 running 下降沿记入 `recentlyFinishedIds` ⇒ 该会话被
  // `topZoneSessionKeys` 钉在顶部区 ⇒ `buildRows` 无论持久顺序怎么写都把它画回最前。
  const DONE = 'session-done'
  const others = ['session-o0', 'session-o1', 'session-o2', 'session-o3']
  const RUN = 'session-run'
  // `DONE` 与 `RUN` 都曾在跑；之后只有 RUN 仍在跑 ⇒ DONE 是「刚结束」。
  const list = [
    ...others.map((id, i) => session(id, { updatedAt: 1000 + i })),
    session(DONE, { updatedAt: 1500 }),
    session(RUN, { updatedAt: 2000, running: true }),
  ]
  const state = t11ObserveRunningThenStopped([DONE, RUN], list)
  assert.equal('recentlyFinishedIds' in state, false, '前置：T11 状态机里已无「刚结束保留」')

  const order0 = { manual: true, sessions: { 'w:/repo': [...others, RUN, DONE] } }
  const before = t11Pipeline({ list, manualOrder: order0, state })

  // 枚举**每一个**落点 × 上下半（用户可能把 DONE 拖到任何位置）。
  const targets = [...others, RUN]
  let checked = 0
  let movedInRender = 0
  for (const overId of targets) {
    for (const half of ['before', 'after']) {
      const drag = t11Drag({ list, manualOrder: order0, state, activeId: DONE, overId, half })
      if (!drag.changed) continue
      checked += 1
      if (drag.rerun.ids.indexOf(DONE) !== before.ids.indexOf(DONE)) movedInRender += 1
      // ★★ 核心断言：**渲染顺序 = 「运行中的 RUN 固定在容器最前」+ 其余逐字按持久表顺序**。
      // 这正是用户终裁的语义（运行中固定置顶、已结束完全由持久顺序决定）。
      assert.deepEqual(
        drag.rerun.ids,
        [RUN, ...drag.order.sessions['w:/repo'].filter((id) => id !== RUN)],
        `★ 拖 DONE 到 ${overId} ${half}：渲染顺序必须 = 运行中置顶 + 其余逐字按持久表（不回弹）`,
      )
      // ★ 等价地：把运行中的 RUN 摘掉后，渲染顺序**逐字等于**持久表顺序。
      assert.deepEqual(
        drag.rerun.ids.filter((id) => id !== RUN),
        drag.order.sessions['w:/repo'].filter((id) => id !== RUN),
        `★ 拖 DONE 到 ${overId} ${half}：摘掉顶部区成员后渲染顺序 === 持久表顺序`,
      )
    }
  }
  assert.equal(checked, 9, '★ 枚举了 9 个**有效**落点（5 个目标 × 上下半 = 10，其中 1 个是等价落点 ⇒ `reorderKeys` 返回 null）')
  assert.equal(
    movedInRender,
    7,
    '★ 9 个有效落点里 7 个让 DONE 在渲染层真的移动；另 2 个是**等价落点**' +
      '（都把 DONE 放到持久表末位，而它渲染前本来就在末位）⇒ 位置不变属预期',
  )
  // ★ 判别力证据：绝大多数落点在**渲染层确实移动了**（只有「拖到持久顺序里紧邻的下一行之后」
  // 这类等价落点例外 —— 那时 DONE 在持久表里的相对位置本来就没变，属预期）。
  assert.equal(movedInRender, 7, '★ 9 个有效落点里 7 个让 DONE 在渲染层真的移动（用例非恒真）')
})

test('T11/① 首要缺陷: 拖动**刚结束**的会话后，刷新页面仍是用户拖到的位置（持久结果）', () => {
  const DONE = 'session-done'
  const list = [
    session('session-o0', { updatedAt: 1000 }),
    session('session-o1', { updatedAt: 1001 }),
    session(DONE, { updatedAt: 1002 }),
  ]
  const state = t11ObserveRunningThenStopped([DONE], list)
  const order0 = { manual: true, sessions: { 'w:/repo': ['session-o0', 'session-o1', DONE] } }

  const drag = t11Drag({ list, manualOrder: order0, state, activeId: DONE, overId: 'session-o0', half: 'before' })
  assert.deepEqual(drag.order.sessions['w:/repo'], [DONE, 'session-o0', 'session-o1'], 'DONE 被拖到最前并落表')
  assert.deepEqual(drag.rerun.ids, [DONE, 'session-o0', 'session-o1'], '★ 渲染跟随（不回弹）')

  // 「刷新页面」：运行时状态全丢，只剩持久顺序。
  const refreshed = buildRows(
    topZoneFixture(list, { manualOrder: drag.rerun.order, expandedAllKeys: { 'w:/repo': true } }),
  )
  assert.deepEqual(containerIds(refreshed), [DONE, 'session-o0', 'session-o1'], '★ 刷新后仍是用户拖到的顺序')
})

// ── ② 运行中的会话固定在容器最前、拖拽不使其移动 ─────────────────────────────

test('T11/② 运行中的会话固定在容器最前（无论持久顺序把它放在哪）', () => {
  const RUN = 'session-run'
  const list = [
    session('session-o0', { updatedAt: 1000 }),
    session('session-o1', { updatedAt: 1001 }),
    session(RUN, { updatedAt: 1002, running: true }),
  ]
  const state = t11ObserveRunningThenStopped([RUN], list)
  // 持久顺序把 RUN 放在**最后** ⇒ 渲染仍必须把它提到最前。
  const order0 = { manual: true, sessions: { 'w:/repo': ['session-o0', 'session-o1', RUN] } }
  const view = t11Pipeline({ list, manualOrder: order0, state })

  assert.deepEqual(view.ids, [RUN, 'session-o0', 'session-o1'], '★ 运行中的会话固定在容器最前')
  assert.deepEqual(view.zone.runningSessionIds, [normalize(RUN)], '前置：状态机把 RUN 投影进 runningSessionIds（归一化 id）')
})

test('T11/② 运行中的会话**不可拖动**：`sidebar.tsx` 的判据对它是 `false`（且与置顶判据同源）', () => {
  // ⚠️ 证据类型说明：`sidebar.tsx` 是 `.tsx`、**不进 `lib/`**，`node --test` 跑不到它的
  // 拖拽接线。但「哪些行不可拖」的**判据**是纯函数 `isTopZoneRunningSession`，本节直接驱动它
  // —— 接线处（`dragHandlersFor(row, scope, !isTopZoneRunningSession(row, topZone))`）用的是
  // **同一个函数**，因此判据分叉不可能发生（这也是把它抽成导出函数的全部理由）。
  const RUN = 'session-run'
  const DONE = 'session-done'
  const list = [
    session('session-o0', { updatedAt: 1000 }),
    session(DONE, { updatedAt: 1001 }),
    session(RUN, { updatedAt: 1002, running: true }),
  ]
  const state = t11ObserveRunningThenStopped([RUN], list)
  const zone = topZoneInputOf(state)
  const rowOf = (id) => t11Pipeline({ list, manualOrder: { manual: true, sessions: { 'w:/repo': list.map((s) => s.sessionId) } }, state })
    .rows.find((r) => r.kind === 'session' && r.sessionId === id)

  assert.equal(isTopZoneRunningSession(rowOf(RUN), zone), true, '★ 运行中 ⇒ 不可拖动')
  assert.equal(isTopZoneRunningSession(rowOf(DONE), zone), false, '★ 已结束 ⇒ 可拖动（本轮首要缺陷的修复点）')
  assert.equal(isTopZoneRunningSession(rowOf('session-o0'), zone), false, '普通已结束会话可拖动')

  // ★ 同源保证：`isTopZoneRunningSession` 为 true ⟺ 该会话在渲染层被置顶（同一判据两处使用）。
  const view = t11Pipeline({ list, manualOrder: { manual: true, sessions: { 'w:/repo': ['session-o0', DONE, RUN] } }, state })
  assert.equal(view.ids[0], RUN, '被判定为「不可拖」的会话正是被置顶的那一个（判据同源）')
})

test('T11/② 「仅 subagent 在跑」的会话同样不可拖动（聚合口径）', () => {
  const list = [
    session('session-p', { updatedAt: 1000, running: false }),
    subagent('sub-c', 'session-p', { updatedAt: 1001, running: true }),
  ]
  const state = observeTopZone(initialTopZoneState(), observationsOf(topZoneFixture(list)), 1000)
  const zone = topZoneInputOf(state)
  const view = t11Pipeline({ list, manualOrder: { manual: true, sessions: { 'w:/repo': ['session-p'] } }, state })

  assert.equal(zone.runningSessionIds.includes('p'), true, '前置：聚合口径把父会话投影为运行中')
  const parentRow = view.rows.find((r) => r.kind === 'session' && r.sessionId === 'session-p')
  assert.equal(isTopZoneRunningSession(parentRow, zone), true, '★ 只有 subagent 在跑的父会话同样不可拖动')
})

test('T11/② 运行中的会话拖不动：即便伪造 drop 也不改变其渲染位置', () => {
  // 交互层不给运行中的行装 `draggable`（上一条用例），这里再锁**计算层**：
  // 即便 drop 事件被伪造、`commitDrag` 真的跑了，运行中的会话在**渲染层**位置也不变。
  const RUN = 'session-run'
  const list = [
    session('session-o0', { updatedAt: 1000 }),
    session('session-o1', { updatedAt: 1001 }),
    session(RUN, { updatedAt: 1002, running: true }),
  ]
  const state = t11ObserveRunningThenStopped([RUN], list)
  const order0 = { manual: true, sessions: { 'w:/repo': [RUN, 'session-o0', 'session-o1'] } }
  const before = t11Pipeline({ list, manualOrder: order0, state })

  for (const overId of ['session-o0', 'session-o1']) {
    for (const half of ['before', 'after']) {
      const drag = t11Drag({ list, manualOrder: order0, state, activeId: RUN, overId, half })
      assert.equal(drag.rerun.ids.indexOf(RUN), 0, `★ 伪造把 RUN 拖到 ${overId} ${half}：渲染层位置**不变**（仍在最前）`)
    }
  }
  assert.deepEqual(before.ids, [RUN, 'session-o0', 'session-o1'], '对照：拖动前也在最前')
})

// ── ③ 拖动「刚结束」的会话不再回弹（首要缺陷的**定点**回归锁）──────────────────

test('T11/③ 定点回归: 「刚结束保留」已从判据里**彻底不可达**（字段传了也无效果）', () => {
  // 本轮首要缺陷的**根因**是「刚结束保留」这一条判据。T11 已把它从 `topZoneSessionKeys`
  // 的读取路径里**整体删除** ⇒ 即便有人（或旧版本的持久化 / 契约外输入）把该字段塞回
  // `topZone`，也**不可能**再让已结束的会话回到顶部区。
  //
  // ⚠️ 「恢复该判据 ⇒ 立刻复现回弹」的**变异验证**必须改真实实现才成立，因此不在本用例里
  // 做数据级变异 —— 它由 **`test/mutation-t11.md`**（T13 补写，N-5）记录的 lib 级变异实验
  // 证明（M1 ⇒ `tree-model.test.mjs` fail 1；M10 完整状态机 ⇒ fail 7；补丁要点与可执行脚本
  // 都在该文件里）。本用例锁定的是**等价物不可达**这一层。
  const DONE = 'session-done'
  const list = [
    session('session-o0', { updatedAt: 1000 }),
    session('session-o1', { updatedAt: 1001 }),
    session(DONE, { updatedAt: 1002 }),
  ]
  const state = t11ObserveRunningThenStopped([DONE], list)
  const order0 = { manual: true, sessions: { 'w:/repo': [DONE, 'session-o0', 'session-o1'] } }
  const drag = t11Drag({ list, manualOrder: order0, state, activeId: DONE, overId: 'session-o1', half: 'after' })
  assert.deepEqual(drag.rerun.ids, ['session-o0', 'session-o1', DONE], '★ 修复后：渲染跟随拖动（DONE 到了最后）')

  // ★ 塞回旧字段（模拟「旧版本持久化残留 / 契约外输入」）⇒ 结果**逐字不变**。
  const withStale = { ...drag.rerun.zone, recentlyFinishedSessionIds: [DONE] }
  const stale = containerIds(buildRows(
    topZoneFixture(list, { manualOrder: drag.rerun.order, topZone: withStale, expandedAllKeys: { 'w:/repo': true } }),
  ))
  assert.deepEqual(stale, drag.rerun.ids, '★ 旧字段已不可达：塞回去也**不再**把 DONE 搬回顶部区')
})

// ── ④ 新会话发首条消息后在容器最前、刷新后仍在最前（D2 不回退）────────────────

test('T11/④ D2 不回退: 新会话发首条消息 ⇒ 渲染最前 + 落表形态正确（带 `session-` 前缀）', () => {
  const old4 = realSessions()
  const NEW = REAL_IDS.new
  const list = [...old4, session(NEW, { updatedAt: 99_999 })]
  // 第 1 步：新会话仍是 blank。
  const blankState = observeTopZone(
    initialTopZoneState(),
    observationsOf(topZoneFixture([...old4, session(NEW, { blank: true, updatedAt: 99_999 })])),
    1000,
  )
  // 第 2 步：发第一条消息（blank → 非 blank）。
  const view = t11Pipeline({
    list,
    manualOrder: { manual: true, sessions: { 'w:/repo': old4.map((s) => s.sessionId) } },
    state: blankState,
    nowMs: 2000,
  })

  assert.deepEqual(view.state.newSessionIds, [normalize(NEW)], '前置：判为新会话')
  assert.equal(view.ids[0], NEW, '★ 渲染层：新会话在容器最前')
  assert.equal(view.order.sessions['w:/repo'][0], NEW, '★ 持久表：新会话在表首')
  assert.equal(view.order.sessions['w:/repo'].filter((id) => id === NEW).length, 1, '★ 幂等：不产生重复条目')
  assert.equal(
    view.order.sessions['w:/repo'][0],
    REAL_IDS.new,
    '★ 写入形态 = 树里的真实 id（逐字带 `session-` 前缀，绝不写归一化裸 id）',
  )
})

test('T11/④ D2 不回退: 「刷新页面」后新会话仍在最前（持久顺序承载，无运行时状态）', () => {
  const old4 = realSessions()
  const NEW = REAL_IDS.new
  const list = [...old4, session(NEW, { updatedAt: 99_999 })]
  const blankState = observeTopZone(
    initialTopZoneState(),
    observationsOf(topZoneFixture([...old4, session(NEW, { blank: true, updatedAt: 99_999 })])),
    1000,
  )
  const view = t11Pipeline({
    list,
    manualOrder: { manual: true, sessions: { 'w:/repo': old4.map((s) => s.sessionId) } },
    state: blankState,
    nowMs: 2000,
  })

  // 刷新：**不传 topZone**（运行时状态全丢）。
  const refreshed = buildRows(topZoneFixture(list, { manualOrder: view.order, expandedAllKeys: { 'w:/repo': true } }))
  assert.equal(containerIds(refreshed)[0], NEW, '★ 刷新后新会话仍在第一位（D2 的核心承诺）')
  assert.deepEqual(containerIds(refreshed), view.order.sessions['w:/repo'], '★ 刷新后顺序逐字 = 持久顺序')
})

// ── ⑤ 已落表的新会话被拖动后不回弹（T9 机制不回退）────────────────────────────

test('T11/⑤ T9 机制不回退: 已落表的新会话被拖到任意位置 ⇒ 渲染跟随（不回弹）', () => {
  const old4 = realSessions()
  const NEW = REAL_IDS.new
  const list = [...old4, session(NEW, { updatedAt: 99_999 })]
  const blankState = observeTopZone(
    initialTopZoneState(),
    observationsOf(topZoneFixture([...old4, session(NEW, { blank: true, updatedAt: 99_999 })])),
    1000,
  )
  const first = t11Pipeline({
    list,
    manualOrder: { manual: true, sessions: { 'w:/repo': old4.map((s) => s.sessionId) } },
    state: blankState,
    nowMs: 2000,
  })
  assert.deepEqual(first.state.writtenNewSessionIds, [normalize(NEW)], '前置：台账记入（已落表）')

  // 用户把新会话拖到每一个可能的位置。
  const all = first.order.sessions['w:/repo']
  for (const overId of all.filter((id) => id !== NEW)) {
    for (const half of ['before', 'after']) {
      const drag = t11Drag({ list, manualOrder: first.order, state: first.state, activeId: NEW, overId, half })
      if (!drag.changed) continue
      assert.deepEqual(
        drag.rerun.ids,
        drag.order.sessions['w:/repo'],
        `★ 已落表的新会话拖到 ${overId} ${half}：渲染 = 持久顺序（不回弹）`,
      )
      assert.deepEqual(
        drag.rerun.state.writtenNewSessionIds,
        [normalize(NEW)],
        '★ 台账仍只记一次（拖拽不重复落表）',
      )
    }
  }
})

test('T11/⑤ 定点回归: 去掉台账投影（T9 修复点）⇒ 新会话被拖走后**回弹**（判别力证据）', () => {
  const old4 = realSessions()
  const NEW = REAL_IDS.new
  const list = [...old4, session(NEW, { updatedAt: 99_999 })]
  const blankState = observeTopZone(
    initialTopZoneState(),
    observationsOf(topZoneFixture([...old4, session(NEW, { blank: true, updatedAt: 99_999 })])),
    1000,
  )
  const first = t11Pipeline({
    list,
    manualOrder: { manual: true, sessions: { 'w:/repo': old4.map((s) => s.sessionId) } },
    state: blankState,
    nowMs: 2000,
  })
  const drag = t11Drag({ list, manualOrder: first.order, state: first.state, activeId: NEW, overId: REAL_IDS.o1, half: 'after' })
  const fixed = drag.rerun.ids
  assert.notEqual(fixed[0], NEW, '修复后：新会话不在第一位（用户把它拖走了）')

  // ★ 变异：把台账投影清空（= 旧实现 / 未做 T9 修复）。
  const mutatedZone = { ...drag.rerun.zone, writtenNewSessionIds: [] }
  const mutated = containerIds(buildRows(
    topZoneFixture(list, { manualOrder: drag.rerun.order, topZone: mutatedZone, expandedAllKeys: { 'w:/repo': true } }),
  ))
  assert.equal(mutated[0], NEW, '★ 变异后：新会话被渲染期提升搬回表首 ⇒ **复现「弹回原位」**')
  assert.notDeepEqual(mutated, fixed, '★ 变异前后确实不同（对照非恒真）')
})

// ── ⑥ 已有会话收到新消息不顶到前面（D5，顺序冻结承诺 11b1144）─────────────────

test('T11/⑥ D5 不回退: 已有会话收到新消息 ⇒ 渲染顺序不变（顺序冻结）', () => {
  const list0 = [
    session('session-a', { updatedAt: 1000 }),
    session('session-b', { updatedAt: 1001 }),
    session('session-c', { updatedAt: 1002 }),
  ]
  const manualOrder = { manual: true, sessions: { 'w:/repo': ['session-c', 'session-b', 'session-a'] } }
  const state0 = observeTopZone(initialTopZoneState(), observationsOf(topZoneFixture(list0)), 1000)
  const before = t11Pipeline({ list: list0, manualOrder, state: state0, nowMs: 1000 })

  // `session-a` 收到新消息：`updatedAt` 被推进到最大（宿主行为）——但它**不**该被顶到前面。
  const list1 = [
    session('session-a', { updatedAt: 9_999_999 }),
    session('session-b', { updatedAt: 1001 }),
    session('session-c', { updatedAt: 1002 }),
  ]
  const after = t11Pipeline({ list: list1, manualOrder, state: state0, nowMs: 2000 })

  assert.deepEqual(after.ids, before.ids, '★ 收到新消息的已有会话**不**被顶到前面（顺序冻结）')
  assert.deepEqual(after.ids, ['session-c', 'session-b', 'session-a'], '★ 渲染顺序 = 持久顺序')
})

// ── ⑦ 默认模式与手动模式都正确（D1）─────────────────────────────────────────

test('T11/⑦ D1 默认模式: 无持久表 ⇒ 按 updatedAt 降序，运行中的仍在最前', () => {
  const RUN = 'session-run'
  const list = [
    session('session-o0', { updatedAt: 1000 }),
    session(RUN, { updatedAt: 1001, running: true }),
    session('session-o1', { updatedAt: 1002 }),
  ]
  const state = t11ObserveRunningThenStopped([RUN], list)
  const view = t11Pipeline({ list, manualOrder: { manual: false }, state })

  assert.deepEqual(view.ids, [RUN, 'session-o1', 'session-o0'], '★ 默认模式：运行中置顶 + 其余 updatedAt 降序')
  assert.equal(view.order.manual, false, '★ 默认模式**绝不**静默切成手动模式（D1）')
  assert.equal(view.order.sessions, undefined, '★ 默认模式**不建表**（不写、不凭空建 sessions）')
  // 对照：默认顺序（`effectiveOrder` 的产物）确实是 updatedAt 降序，运行时顶部区不进它。
  const defaults = effectiveOrder({ ...topZoneFixture(list), manualOrder: undefined })
  assert.deepEqual(defaults.sessions.get('w:/repo'), ['session-o1', RUN, 'session-o0'], '默认顺序 = updatedAt 降序')
})

test('T11/⑦ D1 手动模式: 持久表完全生效，运行中置顶叠加在其上', () => {
  const RUN = 'session-run'
  const list = [
    session('session-o0', { updatedAt: 1000 }),
    session(RUN, { updatedAt: 1001, running: true }),
    session('session-o1', { updatedAt: 1002 }),
  ]
  const state = t11ObserveRunningThenStopped([RUN], list)
  // 手动顺序与 updatedAt 降序**刻意不同**。
  const manualOrder = { manual: true, sessions: { 'w:/repo': ['session-o0', 'session-o1', RUN] } }
  const view = t11Pipeline({ list, manualOrder, state })

  assert.deepEqual(view.ids, [RUN, 'session-o0', 'session-o1'], '★ 手动顺序生效（o0 在 o1 前）+ 运行中置顶')
})

// ── ⑧ 归档会话不被误判为新会话（N1/I3）───────────────────────────────────────

test('T11/⑧ N1 不回退: 真实链路形态下归档会话**不在树里** ⇒ 不被误判为新会话、不进顶部区', () => {
  const list = [session('session-old', { updatedAt: 1000 })]
  const archivedId = 'session-archived-1'
  // 真实形态：`buildProjects` 已把归档会话从树里剔除 ⇒ 树里没有它，只有 archivedSessionIds 有。
  const state = observeTopZone(
    initialTopZoneState(),
    observationsOf({ projects: topZoneFixture(list).projects, ungrouped: [], archivedSessionIds: [archivedId] }),
    1000,
  )
  assert.ok(state.knownSessionIds.includes('archived-1'), '★ 归档 id 进 `known`（N1 修复点）')

  // 之后取消归档 + 收到新消息（updatedAt 晚于基线）⇒ 仍**不**判为新会话。
  const revived = observeTopZone(
    state,
    observationsOf({
      projects: topZoneFixture([...list, session(archivedId, { updatedAt: 9_999_999 })]).projects,
      ungrouped: [],
      archivedSessionIds: [],
    }),
    2000,
  )
  assert.deepEqual(revived.newSessionIds, [], '★ 归档过的旧会话不被误判为新会话（T8 实测旧实现为 [archived-1]）')
  const view = t11Pipeline({
    list: [...list, session(archivedId, { updatedAt: 9_999_999 })],
    manualOrder: { manual: true, sessions: { 'w:/repo': ['session-old', archivedId] } },
    state: revived,
  })
  assert.deepEqual(view.ids, ['session-old', archivedId], '★ 它留在持久顺序位置，不被渲染期提升到最前')
})

test('T11/⑧ N1 变异验证: 去掉归档 id 补投影 ⇒ 立刻误判为新会话（判别力证据）', () => {
  const list = [session('session-old', { updatedAt: 1000 })]
  const archivedId = 'session-archived-1'
  // ★ 变异：`archivedSessionIds` 传空（= 旧实现的观测批次，归档会话从未进过 `seen`）。
  const base = observeTopZone(
    initialTopZoneState(),
    observationsOf({ projects: topZoneFixture(list).projects, ungrouped: [], archivedSessionIds: [] }),
    1000,
  )
  const mutated = observeTopZone(
    base,
    observationsOf({
      projects: topZoneFixture([...list, session(archivedId, { updatedAt: 9_999_999 })]).projects,
      ungrouped: [],
      archivedSessionIds: [],
    }),
    2000,
  )
  assert.deepEqual(mutated.newSessionIds, ['archived-1'], '★ 变异后：旧会话被误判为新会话 ⇒ 证明 ⑧ 有判别力')
})

// ── 接线审查锁：`sidebar.tsx` 的关键判据都是纯函数、可被本节驱动 ────────────────

test('T11/接线: 渲染层「不可拖动」判据与「置顶」判据**同源**（同一导出函数）', () => {
  // `sidebar.tsx` 的接线是：
  //   置顶：`applyManualOrder(…, <占位行 + topZoneSessionKeys(visible, currentSessionId, spec.key, context.topZone)>)`
  //   不可拖：`dragHandlersFor(row, scope, !isSessionDragLocked(row, topZone))`
  // 两处都走 `isTopZoneRunningSession`（拖拽锁内部复用）⇒ 本用例的夹具（无当前 blank 占位行）
  // 下「排在最前的行」与「拖不动的行」必然一致。
  // ⚠️ 2026-10-22（DR4/DR5）：拖拽锁额外包含**当前空白占位行**（「新会话」行），它被
  // `emitContainer` 单独钉在最前、**不**进 `topZoneSessionKeys` —— 见本文件末尾的
  // 「2026-10-22/DR4」「2026-10-22/DR5」用例。
  const list = [
    session('session-o0', { updatedAt: 1000 }),
    session('session-run1', { updatedAt: 1001, running: true }),
    session('session-o1', { updatedAt: 1002 }),
    session('session-run2', { updatedAt: 1003, running: true }),
  ]
  const state = t11ObserveRunningThenStopped(['session-run1', 'session-run2'], list)
  const zone = topZoneInputOf(state)
  const pinned = topZoneSessionKeys(list, undefined, 'w:/repo', zone)
  const notDraggable = list.filter((s) => isTopZoneRunningSession(s, zone)).map((s) => s.sessionId)

  assert.deepEqual(
    pinned.slice().sort(),
    notDraggable.slice().sort(),
    '★ 置顶集合 === 不可拖动集合（判据同源，不可能分叉）',
  )
  assert.deepEqual(pinned, ['session-run2', 'session-run1'], '顶部区内部按 updatedAt 降序')
})

test('T11/接线: `currentSessionId` / `containerKey` 已不参与置顶（终裁后签名仅向后兼容）', () => {
  const list = [session('session-o0', { updatedAt: 1000 }), session('session-cur', { updatedAt: 1001 })]
  const zone = topZoneOf()
  assert.deepEqual(
    topZoneSessionKeys(list, 'session-cur', 'w:/repo', zone),
    topZoneSessionKeys(list, 'session-other', 'w:/other', zone),
    '★ 换 currentSessionId / containerKey ⇒ 结果逐字一致（已无 isCurrent 置顶、无释放机制）',
  )
  assert.equal(topZoneSessionKeys(list, 'session-cur', 'w:/repo', zone), undefined, '无运行中/新会话 ⇒ 无置顶')
})

// ---------------------------------------------------------------------------
// 2026-10-21（WSR3/WSR5/WSR6，AC3–AC6）：当前会话前缀归一化 + 底部「最近」分区
// ---------------------------------------------------------------------------

test('2026-10-21/AC3: currentSessionId 与 session.sessionId 的 session- 前缀不一致时 isCurrent 与 blank 豁免均生效', () => {
  const list = [
    session('session-a', { updatedAt: 100 }),
    session('b-bare', { updatedAt: 90, blank: true }),
  ]
  // 1) 树里是带前缀 `session-a`，传入裸 `a` ⇒ isCurrent 仍为 true
  const rows1 = buildRows(
    input({
      projects: [singleWorktreeProject(list)],
      currentSessionId: 'a',
      includeRecent: true,
    }),
  )
  const treeA = rows1.find((r) => r.kind === 'session' && r.key === 's:session-a')
  const recentA = rows1.find((r) => r.kind === 'session' && r.key === 'rs:session-a')
  assert.equal(treeA?.isCurrent, true, '工作区树行对裸 currentSessionId 归一化命中')
  assert.equal(recentA?.isCurrent, true, '最近分区行与工作区树行同步选中高亮')

  // 2) 树里是裸 `b-bare`（blank），传入带前缀 `session-b-bare` ⇒ blank 豁免可见且 isCurrent 为 true
  const rows2 = buildRows(
    input({
      projects: [singleWorktreeProject(list)],
      currentSessionId: 'session-b-bare',
      includeRecent: true,
    }),
  )
  const treeB = rows2.find((r) => r.kind === 'session' && r.key === 's:b-bare')
  const recentB = rows2.find((r) => r.kind === 'session' && r.key === 'rs:b-bare')
  assert.equal(treeB?.isCurrent, true, 'blank 当前会话经前缀归一化豁免可见并选中')
  assert.equal(recentB?.isCurrent, true, 'blank 当前会话在最近分区同样可见并选中')
})

test('2026-10-21/AC4: includeRecent=true 在末尾（未分组之后）输出 recent 分区头与按 updatedAt 降序的会话行', () => {
  assert.equal(RECENT_SESSION_LIMIT, 100)
  assert.equal(RECENT_KEY, '__recent__')

  const proj = project({
    key: '/repo/.git',
    title: 'Repo',
    worktrees: [
      worktree('/repo', {
        branch: 'main',
        isMain: true,
        sessions: [session('w1', { updatedAt: 10 }), session('w2', { updatedAt: 40 })],
      }),
    ],
    history: [session('h1', { updatedAt: 30 })],
  })
  const nonGit = project({
    key: 'ws:ng',
    isGit: false,
    title: 'Docs',
    mainPath: '/docs',
    flatSessions: [session('f1', { updatedAt: 20 })],
  })
  const rows = buildRows(
    input({
      projects: [proj, nonGit],
      ungrouped: [session('u1', { updatedAt: 50 })],
      includeRecent: true,
    }),
  )

  const ungroupedIdx = rows.findIndex((r) => r.kind === 'project' && r.key === `p:${UNGROUPED_KEY}`)
  const recentIdx = rows.findIndex((r) => r.kind === 'recent')
  assert.ok(ungroupedIdx >= 0, '未分组行仍保留')
  assert.ok(recentIdx > ungroupedIdx, 'recent 分区头位于未分组之后')

  const recentHeader = rows[recentIdx]
  assert.deepEqual(recentHeader, {
    kind: 'recent',
    key: `r:${RECENT_KEY}`,
    label: 'section.recent',
    depth: 0,
    expanded: true,
    sessionCount: 5,
  })

  const recentSessions = rows.slice(recentIdx + 1)
  assert.deepEqual(
    recentSessions.map((r) => r.key),
    ['rs:u1', 'rs:w2', 'rs:h1', 'rs:f1', 'rs:w1'],
    '跨 worktree / history / flat / ungrouped 全局按 updatedAt 降序排列，key 前缀为 rs:',
  )
  for (const row of recentSessions) {
    assert.equal(row.kind, 'session')
    assert.equal(row.parentKey, `r:${RECENT_KEY}`)
    assert.equal(row.parentKind, 'recent')
    assert.equal(row.depth, 1)
  }
})

test('2026-10-21/AC5（2026-11-14 PX4 修订）: 最近分区不设 100 上限、默认 5 条渐进展开、排除子代理/归档/非当前 blank 且去重', () => {
  const many = Array.from({ length: 120 }, (_, i) =>
    session(`s-${String(i).padStart(3, '0')}`, { updatedAt: 1000 + i }),
  )
  const extra = [
    subagent('sub-1', 's-119', { updatedAt: 9999, running: true }),
    session('arch-1', { updatedAt: 9998 }),
    session('blank-1', { updatedAt: 9997, blank: true }),
    // 重复会话（带前缀同 id）
    session('session-s-119', { updatedAt: 500 }),
  ]

  const recentRows = buildRecentRows(
    input({
      projects: [singleWorktreeProject([...many, ...extra])],
      archivedSessionIds: ['arch-1'],
    }),
  )

  assert.equal(recentRows[0].kind, 'recent')
  assert.equal(recentRows[0].sessionCount, 120, 'PX4：不再截断到 100 条（120 条去重后可见会话）')
  const collapsedRows = recentRows.slice(1).filter((r) => r.kind === 'session')
  assert.equal(collapsedRows.length, 5, 'PX4：默认 5 条')
  const more = recentRows.find((r) => r.kind === 'more')
  assert.equal(more?.hiddenCount, 115, '默认层级下剩余 115 条')

  const expanded = buildRecentRows(
    input({
      projects: [singleWorktreeProject([...many, ...extra])],
      archivedSessionIds: ['arch-1'],
      expandLevels: { [`r:${RECENT_KEY}`]: 7 },
    }),
  )
  const sessionRows = expanded.filter((r) => r.kind === 'session')
  assert.equal(sessionRows.length, 120, 'L=7（上限 145）⇒ 120 条全部可见，超过旧的 100 条')
  assert.equal(sessionRows[0].sessionId, 's-119', '最新一条排第一')
  assert.equal(sessionRows[0].running, true, '子代理运行态聚合在最近分区会话行同样生效')
  assert.equal(sessionRows[0].subagentCount, 1, '子代理计数胶囊在最近分区同样生效')
  assert.equal(sessionRows[119].sessionId, 's-000', '最旧的 s-000 也可见（不再截掉）')
})

test('2026-10-21/AC6: 最近分区支持折叠、无可见会话时不渲染、搜索模式不渲染', () => {
  const list = [session('s1', { updatedAt: 10 }), session('s2', { updatedAt: 20 })]

  // 1) 折叠 r:__recent__
  const collapsed = buildRows(
    input({
      projects: [singleWorktreeProject(list)],
      collapsedKeys: { [`r:${RECENT_KEY}`]: true },
      includeRecent: true,
    }),
  )
  const header = collapsed.find((r) => r.kind === 'recent')
  assert.equal(header?.expanded, false, '折叠时 expanded 为 false')
  assert.equal(header?.sessionCount, 2, '折叠时仍保留真实 sessionCount')
  assert.equal(
    collapsed.some((r) => r.kind === 'session' && r.parentKind === 'recent'),
    false,
    '折叠时不输出 rs:* 子行',
  )

  // 2) 无可见会话 ⇒ 不输出 recent 头
  const empty = buildRows(
    input({
      ungrouped: [session('b', { blank: true })],
      includeRecent: true,
    }),
  )
  assert.deepEqual(empty, [])

  // 3) 搜索模式 ⇒ 不输出 recent 头
  const searched = buildRows(
    input({
      projects: [singleWorktreeProject(list)],
      query: 'T',
      includeRecent: true,
    }),
  )
  assert.equal(
    searched.some((r) => r.kind === 'recent' || r.parentKind === 'recent'),
    false,
    '搜索模式只输出搜索匹配行，不追加 recent 分区',
  )
})

// ---------------------------------------------------------------------------
// 2026-10-29（RAS1–RAS5）：最近分区按「最后更新时间（任意活动）」倒序
// ---------------------------------------------------------------------------

const recentIds = (rows) => rows.filter((row) => row.parentKind === 'recent').map((row) => row.sessionId)

test('2026-10-29/RAS1: recentActivityOf = max(updatedAt, 有限 lastActivityAt)；非法值回退 updatedAt', () => {
  assert.equal(recentActivityOf({ updatedAt: 100, lastActivityAt: 900 }), 900)
  assert.equal(recentActivityOf({ updatedAt: 100, lastActivityAt: 50 }), 100, '更旧的活动时间不得降低排序键')
  assert.equal(recentActivityOf({ updatedAt: 100, lastActivityAt: Number.NaN }), 100)
  assert.equal(recentActivityOf({ updatedAt: 100, lastActivityAt: undefined }), 100)
  assert.equal(recentActivityOf({ updatedAt: Number.NaN, lastActivityAt: 700 }), 700, 'updatedAt 非法时仍取活动时间')
})

test('2026-10-29/RAS1: 最近分区按 lastActivityAt 降序 —— 只有助手/任务活动的旧会话会上浮', () => {
  const list = [
    session('old-active', { updatedAt: 100, lastActivityAt: 900 }),
    session('newer-prompt', { updatedAt: 500, lastActivityAt: 500 }),
    session('newest-prompt', { updatedAt: 700 }),
  ]
  const rows = buildRows(
    input({
      projects: [singleWorktreeProject(list)],
      includeRecent: true,
    }),
  )

  assert.deepEqual(
    recentIds(rows),
    ['old-active', 'newest-prompt', 'newer-prompt'],
    '最近分区必须按最后更新时间（含助手/任务活动）倒序，而不是只按最后一次用户发言',
  )

  // 反向约束（RAS5）：上方工作区树的容器顺序仍按 updatedAt，不被 lastActivityAt 影响。
  const tree = rows
    .filter((row) => row.kind === 'session' && row.parentKey === WORKTREE_KEY)
    .map((row) => row.sessionId)
  assert.deepEqual(
    tree,
    ['newest-prompt', 'newer-prompt', 'old-active'],
    '工作区树容器内顺序必须保持 updatedAt 降序（本次只改最近分区）',
  )
})

test('2026-10-29/RAS4: lastActivityAt 缺失/NaN/更旧时回退 updatedAt，排序仍确定', () => {
  const list = [
    session('a', { updatedAt: 400, lastActivityAt: Number.NaN }),
    session('b', { updatedAt: 300, lastActivityAt: 900 }),
    session('c', { updatedAt: 600 }),
    session('d', { updatedAt: 500, lastActivityAt: 200 }),
  ]
  const rows = buildRows(
    input({
      projects: [singleWorktreeProject(list)],
      includeRecent: true,
    }),
  )
  assert.deepEqual(
    recentIds(rows),
    ['b', 'c', 'd', 'a'],
    '非法/更旧的活动时间回退 updatedAt；无活动字段与旧行为一致',
  )
})

test('2026-10-29/RAS3: 同一会话在多个容器出现时，最近分区去重并取活动时间更晚的一条', () => {
  const proj = project({
    key: '/repo/.git',
    title: 'Repo',
    worktrees: [
      worktree('/repo', {
        branch: 'main',
        isMain: true,
        sessions: [session('session-dup', { updatedAt: 10, lastActivityAt: 10 })],
      }),
    ],
    history: [session('dup', { updatedAt: 20, lastActivityAt: 800 })],
  })
  const rows = buildRows(input({ projects: [proj], includeRecent: true }))
  assert.equal(rows.filter((row) => row.kind === 'recent')[0]?.sessionCount, 1, '同一会话在最近分区只出现一次')
  assert.deepEqual(recentIds(rows), ['dup'], '去重后保留活动时间更晚的那条（session- 前缀归一化后同一 id）')
})

test('2026-10-29/RAS5: lastActivityAt 使旧会话上浮，工作区树顺序不变（2026-11-14 起无 100 上限）', () => {
  const many = Array.from({ length: 120 }, (_, i) =>
    session(`s-${String(i).padStart(3, '0')}`, {
      updatedAt: 1000 + i,
      // 故意让「越旧」的会话拥有越新的活动时间：最近分区应完全按活动时间排。
      lastActivityAt: 10_000 + (119 - i),
    }),
  )
  const rows = buildRows(
    input({
      projects: [singleWorktreeProject(many)],
      expandedAllKeys: { [WORKTREE_KEY]: true },
      expandLevels: { [`r:${RECENT_KEY}`]: 7 },
      includeRecent: true,
    }),
  )

  const recent = rows.filter((row) => row.kind === 'session' && row.parentKind === 'recent')
  assert.equal(recent.length, 120, '展开到足够层级后 120 条全部可见（无 100 上限）')
  assert.equal(recent[0].sessionId, 's-000', '活动时间最新的 s-000 上浮到第一')
  assert.equal(recent[119].sessionId, 's-119', '按活动时间排序，活动最旧的 s-119 在最后')

  const tree = rows
    .filter((row) => row.kind === 'session' && row.parentKey === WORKTREE_KEY)
    .map((row) => row.sessionId)
  assert.deepEqual(tree, [...tree].sort().reverse(), '工作区树仍按 updatedAt 降序（s-119 在最前）')
})

test('2026-10-21/AC7-client: archivedProjectKeys 在客户端树模型层直接过滤已归档工作空间及其会话（无需重启宿主即生效）', () => {
  const projA = project({
    key: '/repo-a/.git',
    title: 'RepoA',
    worktrees: [
      worktree('/repo-a', {
        branch: 'main',
        isMain: true,
        sessions: [session('sa-1', { updatedAt: 500, title: 'NeedleA' })],
      }),
    ],
  })
  const projB = project({
    key: '/repo-b/.git',
    title: 'RepoB',
    worktrees: [
      worktree('/repo-b', {
        branch: 'main',
        isMain: true,
        sessions: [session('sb-1', { updatedAt: 400, title: 'NeedleB' })],
      }),
    ],
  })

  const rows = buildRows(
    input({
      projects: [projA, projB],
      archivedProjectKeys: ['/repo-a/.git'],
      includeRecent: true,
    }),
  )

  assert.equal(
    rows.some((r) => r.key === 'p:/repo-a/.git' || r.key === 'w:/repo-a' || r.key === 's:sa-1' || r.key === 'rs:sa-1'),
    false,
    '已归档工作空间的行及其在「最近」分区的会话行必须全部从侧栏消失',
  )
  assert.equal(rows.some((r) => r.key === 'p:/repo-b/.git'), true, '未归档工作空间保留')
  assert.equal(rows.some((r) => r.key === 'rs:sb-1'), true, '未归档工作空间的会话仍在最近分区')

  // 搜索模式下同样排除已归档工作空间的会话
  const searched = buildRows(
    input({
      projects: [projA, projB],
      archivedProjectKeys: ['/repo-a/.git'],
      query: 'needle',
    }),
  )
  assert.deepEqual(
    searched.map((r) => r.sessionId),
    ['sb-1'],
    '搜索结果同样排除已归档工作空间的会话',
  )
})



// ---------------------------------------------------------------------------
// 2026-10-22（DR4/DR5）：当前空白会话（「新会话」占位行）固定在本容器最前、且不可拖动
//
// 缺陷事实（用户 2026-10-22 复验上一轮「草稿保留」修复时报告）：
// 「草稿有了，但新会话没有出现在最上面，而是出现在了最下面」。
//
// 根因：草稿保留后插件**复用**了同目录的空白会话（同一个 sessionId），于是它不再是
// `observeTopZone` 眼里的「新会话」（进程内首次观测且晚于启动水位 / blank→非 blank），
// 也就进不了 `topZoneSessionKeys` 的顶部区；渲染时它按 `updatedAt`（很旧）或手动顺序表
// （表外 ⇒ 追加末尾）落到容器最后。
//
// 期望（DR4）：当前打开的空白会话 = 「新会话」占位行，**恒在本容器最前**（先于手动顺序、
// 先于 5 条截断），这与宿主原生一致：
//   - `dsh-client-ui-workspace/lib/client.js:983` `sectionMembers` 把 blank 放最前；
//   - `:952` `pinCurrentBlank` 把当前 blank 提到该账户首位。
// 并（DR5）该行**不可拖动**：原生 `:2261` `draggable = drag !== void 0 && !row.blank && !row.archived`；
// 占位行固定在最前，若还允许起拖，用户只会看到「拖完弹回」（T9 缺陷 1 同类）。
// ---------------------------------------------------------------------------

test('2026-10-22/DR4 当前空白会话固定在容器最前：手动顺序把它排到最后也无效', () => {
  const list = [
    session('session-o0', { updatedAt: 1000 }),
    session('session-o1', { updatedAt: 1001 }),
    session('session-draft', { updatedAt: 900, blank: true }),
  ]
  const manualOrder = { manual: true, sessions: { 'w:/repo': ['session-o1', 'session-o0', 'session-draft'] } }
  const rows = buildRows(topZoneFixture(list, { manualOrder, currentSessionId: 'session-draft', topZone: topZoneOf() }))
  assert.deepEqual(
    containerIds(rows),
    ['session-draft', 'session-o1', 'session-o0'],
    '★ 当前空白会话必须恒在最前（与手动顺序无关）；其余仍按手动顺序',
  )
})

test('2026-10-22/DR4 默认（非手动）模式：当前空白会话同样最先，且先于按 updatedAt 的旧会话', () => {
  const list = [
    session('session-o0', { updatedAt: 1000 }),
    session('session-o1', { updatedAt: 1001 }),
    session('session-draft', { updatedAt: 900, blank: true }),
  ]
  // 刻意**不传** topZone：渲染路径在顶部区状态未就绪时也必须把占位行放最前。
  const rows = buildRows(topZoneFixture(list, { currentSessionId: 'session-draft' }))
  assert.deepEqual(containerIds(rows), ['session-draft', 'session-o1', 'session-o0'])
})

test('2026-10-22/DR4 占位行最先、运行中的会话紧随其后（顶部区内部规则不变）', () => {
  const list = [
    session('session-old', { updatedAt: 1000 }),
    session('session-run', { updatedAt: 1001, running: true }),
    session('session-draft', { updatedAt: 900, blank: true }),
  ]
  const rows = buildRows(
    topZoneFixture(list, {
      currentSessionId: 'session-draft',
      topZone: topZoneOf({ runningSessionIds: ['session-run'] }),
    }),
  )
  assert.deepEqual(
    containerIds(rows),
    ['session-draft', 'session-run', 'session-old'],
    '★ 占位行最前，运行中其次，其余按 updatedAt 降序',
  )
})

test('2026-10-22/DR4 反向约束：当前会话**非 blank** 时不得被置顶（T11 终裁不回退）', () => {
  const list = [
    session('session-o0', { updatedAt: 1000 }),
    session('session-cur', { updatedAt: 1001 }),
    session('session-o2', { updatedAt: 1002 }),
  ]
  const rows = buildRows(topZoneFixture(list, { currentSessionId: 'session-cur', topZone: topZoneOf() }))
  assert.deepEqual(
    containerIds(rows),
    ['session-o2', 'session-cur', 'session-o0'],
    '★ 已结束/正在查看的普通会话仍留在其持久顺序位置（唯一被置顶的是 blank 占位行）',
  )
})

test('2026-10-22/DR4 只有「当前」blank 才置顶：非当前 blank 本就不渲染（不占名额）', () => {
  const list = [
    session('session-o0', { updatedAt: 1000 }),
    session('session-other-blank', { updatedAt: 1001, blank: true }),
  ]
  const rows = buildRows(topZoneFixture(list, { currentSessionId: 'session-o0', topZone: topZoneOf() }))
  assert.deepEqual(containerIds(rows), ['session-o0'], '非当前 blank 不可见（原生 sessionVisible）')
})

test('2026-10-22/DR4 `isCurrentBlankSession`：只认 blank 且当前（isCurrent 或 currentSessionId 两种来源）', () => {
  assert.equal(isCurrentBlankSession({ sessionId: 'session-a', blank: true, isCurrent: true }), true)
  assert.equal(isCurrentBlankSession({ sessionId: 'session-a', blank: true }, 'session-a'), true)
  assert.equal(isCurrentBlankSession({ sessionId: 'a', blank: true }, 'session-a'), true, '前缀归一化')
  assert.equal(isCurrentBlankSession({ sessionId: 'session-a', blank: true }, 'session-b'), false)
  assert.equal(isCurrentBlankSession({ sessionId: 'session-a', blank: false, isCurrent: true }), false, '非 blank 永不置顶')
  assert.equal(isCurrentBlankSession({ sessionId: 'session-a', blank: true }, ''), false)
  assert.equal(isCurrentBlankSession({ sessionId: 'session-a', blank: true }, undefined), false)
})

test('2026-10-22/DR5 `isSessionDragLocked`：运行中 ∪ 当前占位行不可拖动，其余可拖', () => {
  const zone = topZoneOf({ runningSessionIds: ['session-run'] })
  assert.equal(isSessionDragLocked({ sessionId: 'session-draft', blank: true, isCurrent: true }), true, '当前占位行不可拖（原生 !row.blank）')
  assert.equal(isSessionDragLocked({ sessionId: 'session-draft', blank: true, isCurrent: false }), false, '非当前 blank 不在树里，判据不误锁')
  assert.equal(isSessionDragLocked({ sessionId: 'session-cur', blank: false, isCurrent: true }), false, '普通当前会话照常可拖（T11 终裁）')
  assert.equal(isSessionDragLocked({ sessionId: 'session-run', running: true }), true, '裸 running 不可拖')
  assert.equal(isSessionDragLocked({ sessionId: 'session-run' }, zone), true, '聚合 running 口径不可拖')
  assert.equal(isSessionDragLocked({ sessionId: 'session-run' }, topZoneOf()), false, '不在运行集合里 ⇒ 可拖')
  assert.equal(isSessionDragLocked({ sessionId: 'session-new' }, topZoneOf({ newSessionIds: ['session-new'] })), false, '尚未落表的新会话可拖（D2 落表后靠持久顺序）')
})

// ---------------------------------------------------------------------------
// 2026-10-22（DR6）：手动顺序表陈旧 ⇒ 「拖动工作区/会话排序」静默失效
//
// 缺陷事实（用户报告：「现在没法拖动工作区进行排序」）：
// 手动模式（`manualOrder.manual === true`）下，`commitDrag` 直接用**持久表**里的
// 该层列表做 `reorderKeys(current, draggedId, overId, half)`。持久表是**首次拖拽时固化
// 的快照**，此后新增的工作区 / worktree / 会话都不在表里 ⇒ `reorderKeys` 的
// `keys.indexOf(draggedId) === -1` 分支直接返回 `null` ⇒ **整次拖拽什么都不写**：
//   - 拖「新增的工作区」到任何位置：拖拽源不在表里 ⇒ 无效；
//   - 把任何工作区拖到「新增的工作区」上下：落点不在表里 ⇒ 同样无效。
// 渲染期 `applyManualOrder` 对表外项本来就是「按默认顺序追加到末尾」，所以用户看到的
// 顺序是完整的，只有**换算**这一步因为表缺项而失败 —— 表现就是「拖不动 / 松手没反应」。
//
// 修复口径（DR6）：换算前先把「持久表」与「当前默认顺序」对齐（`reconcileManualOrder`），
// 再走 `reorderKeys`（`reorderManualScope`）。对齐语义必须与渲染期逐字一致：
//   - 表内项保持原相对位置（含当前不可见的归档项 —— 取消归档时位置不丢）；
//   - 表外项按默认顺序追加到末尾；
//   - 去重、忽略非字符串、不修改入参。
// ---------------------------------------------------------------------------

test('2026-10-22/DR6 reconcileManualOrder: 表外项按默认顺序追加到末尾（与渲染期同语义）', () => {
  assert.deepEqual(
    reconcileManualOrder(['b', 'a'], ['a', 'b', 'c', 'd']),
    ['b', 'a', 'c', 'd'],
    '★ 表内顺序保留，表外项按默认顺序追加',
  )
  assert.deepEqual(reconcileManualOrder(undefined, ['a', 'b']), ['a', 'b'], '无表 ⇒ 默认顺序')
  assert.deepEqual(reconcileManualOrder([], ['a', 'b']), ['a', 'b'], '空表 ⇒ 默认顺序')
})

test('2026-10-22/DR6 reconcileManualOrder: 保留表内但当前不可见的 id（归档项位置不丢）', () => {
  assert.deepEqual(
    reconcileManualOrder(['archived-1', 'a'], ['a', 'b']),
    ['archived-1', 'a', 'b'],
    '★ 归档会话的槽位必须保留（取消归档后回到原位）',
  )
})

test('2026-10-22/DR6 reconcileManualOrder: 去重 / 忽略非法项 / 不修改入参', () => {
  const order = ['a', 'a', '', 'b']
  const defaults = ['b', 'c', 'c']
  const out = reconcileManualOrder(order, defaults)
  assert.deepEqual(out, ['a', 'b', 'c'], '去重且忽略空串')
  assert.deepEqual(order, ['a', 'a', '', 'b'], '★ 不修改入参')
  assert.deepEqual(defaults, ['b', 'c', 'c'], '★ 不修改入参')
  assert.notStrictEqual(out, defaults, '返回新数组')
})

test('2026-10-22/DR6 reorderManualScope: 拖拽源不在陈旧表里 ⇒ 仍然生效（修复点）', () => {
  const next = reorderManualScope(['a', 'b'], ['a', 'b', 'c'], 'c', 'a', 'before')
  assert.deepEqual(next, ['c', 'a', 'b'], '★ 新增项（表外）也能被拖到最前')
})

test('2026-10-22/DR6 reorderManualScope: 落点不在陈旧表里 ⇒ 仍然生效（修复点）', () => {
  const next = reorderManualScope(['a', 'b'], ['a', 'b', 'c'], 'a', 'c', 'after')
  assert.deepEqual(next, ['b', 'c', 'a'], '★ 新增项（表外）也能当落点')
})

test('2026-10-22/DR6 reorderManualScope: 自身 / 原地拖拽返回 null（不写表）', () => {
  assert.equal(reorderManualScope(['a', 'b'], ['a', 'b'], 'a', 'a', 'before'), null, '自身 ⇒ null')
  assert.equal(reorderManualScope(['a', 'b'], ['a', 'b'], 'a', 'b', 'before'), null, '已在目标前 ⇒ null')
  assert.deepEqual(reorderManualScope(['a', 'b'], ['a', 'b'], 'a', 'b', 'after'), ['b', 'a'], '拖到 b 之后 ⇒ 真的变化')
})

test('2026-10-22/DR6 真实场景：新增工作区不在 manual.projects 里 ⇒ 拖到最前必须生效并可渲染', () => {
  const projects = [
    project({ key: '/repo-a/.git', title: 'A' }),
    project({ key: '/repo-b/.git', title: 'B' }),
    project({ key: '/repo-c/.git', title: 'C' }),
  ]
  // 持久表是「首次拖拽时的快照」：`/repo-c` 是之后才新增的工作区，不在表里。
  const stale = { manual: true, projects: ['/repo-a/.git', '/repo-b/.git'], worktrees: {}, sessions: {} }
  const base = input({ projects })
  const defaults = effectiveOrder({ ...base, manualOrder: undefined })

  // 旧实现：直接拿 stale 表换算 ⇒ null（用户看到的「拖不动」）。
  assert.equal(
    reorderKeys(stale.projects, '/repo-c/.git', '/repo-a/.git', 'before'),
    null,
    '★ 缺陷复现：陈旧表下 reorderKeys 直接放弃',
  )
  const next = reorderManualScope(stale.projects, defaults.projects, '/repo-c/.git', '/repo-a/.git', 'before')
  assert.deepEqual(next, ['/repo-c/.git', '/repo-a/.git', '/repo-b/.git'], '★ 修复后：新增工作区可被拖到最前')

  const rows = buildRows({ ...base, manualOrder: { ...stale, projects: next } })
  assert.deepEqual(
    rows.filter((row) => row.kind === 'project').map((row) => row.key),
    ['p:/repo-c/.git', 'p:/repo-a/.git', 'p:/repo-b/.git'],
    '★ 渲染顺序跟随新的手动顺序',
  )
})

test('2026-11-24/AC6 archivedSessionIds 与 sessionId 的 session- 前缀不一致时仍过滤（树 / 未分组 / 最近 / observationsOf）', () => {
  const modelInput = input({
    projects: [
      project({
        key: '/repo/.git',
        title: 'Repo',
        worktrees: [
          worktree('/repo', {
            branch: 'main',
            isMain: true,
            sessions: [
              session('session-keep', { updatedAt: 300 }),
              session('session-arch1', { updatedAt: 400 }),
              session('arch2', { updatedAt: 500 }),
            ],
          }),
        ],
      }),
    ],
    ungrouped: [
      session('session-u-arch', { updatedAt: 600 }),
      session('session-u-keep', { updatedAt: 200 }),
    ],
    // 刻意与上面的 sessionId 错开 session- 前缀形态
    archivedSessionIds: ['arch1', 'session-arch2', 'u-arch'],
    includeRecent: true,
  })

  const rows = buildRows(modelInput)
  const visibleSessionIds = rows.filter((r) => r.kind === 'session').map((r) => r.sessionId)
  assert.deepEqual(
    visibleSessionIds,
    ['session-keep', 'session-u-keep', 'session-keep', 'session-u-keep'],
    'worktree、未分组与最近分区都必须过滤掉前缀形态不同的归档会话',
  )

  const order = effectiveOrder(modelInput)
  assert.deepEqual(order.sessions.get('w:/repo'), ['session-keep'])

  const obs = observationsOf({
    projects: modelInput.projects,
    ungrouped: modelInput.ungrouped,
    archivedSessionIds: modelInput.archivedSessionIds,
  })
  const byId = new Map(obs.map((o) => [o.sessionId, o]))
  assert.equal(byId.get('session-arch1')?.archived, true, 'observationsOf 必须识别前缀不同的归档会话')
  assert.equal(byId.get('arch2')?.archived, true)
  assert.equal(byId.get('session-u-arch')?.archived, true)
  assert.equal(byId.get('session-keep')?.archived, false)
})
