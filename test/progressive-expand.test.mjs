/**
 * 2026-11-14 渐进式展开（PX1–PX5）。
 * 需求：`docs/requirements/2026-11-14-perf-progressive-expand.md` §3.2 PX-AC1–AC6。
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildRows,
  containerKeysUnder,
  nextExpandCount,
  RECENT_KEY,
  visibleSessionLimit,
} from '../lib/tree-model.js'

const t = (key, vars) => (vars === undefined ? key : `${key}${JSON.stringify(vars)}`)

function list(n, prefix = 's') {
  return Array.from({ length: n }, (_, i) => ({
    sessionId: `${prefix}${i}`,
    updatedAt: 1000 + i,
    running: false,
    blank: false,
    title: `${prefix}${i}`,
  }))
}

function repo(sessions, extra = {}) {
  return {
    key: '/repo/.git',
    isGit: true,
    title: 'Repo',
    mainPath: '/repo',
    worktrees: [
      { path: '/repo', branch: 'main', isMain: true, exists: true, title: 'repo', sessions },
      { path: '/repo-feat', branch: 'feat', isMain: false, exists: true, title: 'feat', sessions: [] },
    ],
    history: [],
    flatSessions: [],
    ...extra,
  }
}

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

const W = 'w:/repo'
const R = `r:${RECENT_KEY}`

function containerView(rows, parentKey) {
  return {
    sessions: rows.filter((row) => row.kind === 'session' && row.parentKey === parentKey).length,
    more: rows.filter((row) => row.kind === 'more' && row.parentKey === parentKey),
  }
}

test('PX: visibleSessionLimit = 5 + 5·L(L+1)/2；nextExpandCount = min(5·(L+1), 剩余)', () => {
  assert.deepEqual([0, 1, 2, 3, 4].map(visibleSessionLimit), [5, 10, 20, 35, 55])
  assert.equal(visibleSessionLimit(-1), 5, '非法层级按 0')
  assert.equal(visibleSessionLimit(Number.NaN), 5)
  assert.equal(nextExpandCount(0, 100), 5)
  assert.equal(nextExpandCount(1, 100), 10)
  assert.equal(nextExpandCount(2, 100), 15)
  assert.equal(nextExpandCount(2, 3), 3, '不超过剩余')
  assert.equal(nextExpandCount(0, 0), 0)
})

test('PX-AC2/AC3: 30 条会话按层级 0→1→2→3 依次显示 5/10/20/30 条，more 行字段随之变化', () => {
  const expected = [
    { level: 0, shown: 5, hidden: 25, next: 5, canCollapse: false },
    { level: 1, shown: 10, hidden: 20, next: 10, canCollapse: true },
    { level: 2, shown: 20, hidden: 10, next: 10, canCollapse: true },
    { level: 3, shown: 30, hidden: 0, next: 0, canCollapse: true },
  ]
  for (const step of expected) {
    const rows = buildRows(input({ projects: [repo(list(30))], expandLevels: step.level === 0 ? {} : { [W]: step.level } }))
    const view = containerView(rows, W)
    assert.equal(view.sessions, step.shown, `L=${step.level} 可见条数`)
    assert.equal(view.more.length, 1, `L=${step.level} 恰好 1 条 more 行`)
    assert.equal(view.more[0].hiddenCount, step.hidden, `L=${step.level} hiddenCount`)
    assert.equal(view.more[0].nextCount, step.next, `L=${step.level} nextCount`)
    assert.equal(view.more[0].canCollapse, step.canCollapse, `L=${step.level} canCollapse`)
  }
})

test('PX-AC1: 顶层会话 ≤ 5 条时无论层级都没有 more 行', () => {
  for (const level of [0, 3]) {
    const rows = buildRows(input({ projects: [repo(list(5))], expandLevels: { [W]: level } }))
    assert.equal(containerView(rows, W).more.length, 0)
    assert.equal(containerView(rows, W).sessions, 5)
  }
})

test('PX-AC3: 6 条 ⇒ L0 展开更多 1 个；L1 全部可见只剩收起', () => {
  const l0 = containerView(buildRows(input({ projects: [repo(list(6))] })), W)
  assert.equal(l0.sessions, 5)
  assert.deepEqual([l0.more[0].hiddenCount, l0.more[0].nextCount, l0.more[0].canCollapse], [1, 1, false])
  const l1 = containerView(buildRows(input({ projects: [repo(list(6))], expandLevels: { [W]: 1 } })), W)
  assert.equal(l1.sessions, 6)
  assert.deepEqual([l1.more[0].hiddenCount, l1.more[0].nextCount, l1.more[0].canCollapse], [0, 0, true])
})

test('PX-AC5: 「最近」默认 5 条、渐进展开、不再截断到 100 条', () => {
  const ungrouped = list(130, 'u')
  const base = { ungrouped, includeRecent: true }
  const rows0 = buildRows(input(base))
  const header = rows0.find((row) => row.kind === 'recent')
  assert.equal(header.sessionCount, 130, '分区头计数为全部可见会话')
  const recent0 = containerView(rows0, R)
  assert.equal(recent0.sessions, 5)
  assert.equal(recent0.more.length, 1)
  assert.equal(recent0.more[0].key, `m:${R}`)
  assert.equal(recent0.more[0].parentKind, 'recent')
  assert.deepEqual([recent0.more[0].hiddenCount, recent0.more[0].nextCount, recent0.more[0].canCollapse], [125, 5, false])

  const recentAll = containerView(buildRows(input({ ...base, expandLevels: { [R]: 6 } })), R)
  assert.equal(recentAll.sessions, 110, 'L=6 可见上限 110，超过旧的 100 条上限')
  assert.deepEqual([recentAll.more[0].hiddenCount, recentAll.more[0].nextCount], [20, 20])
  const recentFull = containerView(buildRows(input({ ...base, expandLevels: { [R]: 7 } })), R)
  assert.equal(recentFull.sessions, 130)
  assert.deepEqual([recentFull.more[0].hiddenCount, recentFull.more[0].canCollapse], [0, true])

  const collapsed = buildRows(input({ ...base, collapsedKeys: { [R]: true }, expandLevels: { [R]: 3 } }))
  assert.equal(containerView(collapsed, R).sessions, 0)
  assert.equal(containerView(collapsed, R).more.length, 0, '折叠的「最近」不产出 more 行')
})

test('PX-AC4: containerKeysUnder —— 项目行覆盖其全部容器；worktree / 最近只覆盖自身', () => {
  const projects = [repo(list(1), { history: list(1, 'h') }), { key: 'ws:plain', isGit: false, title: 'P', worktrees: [], history: [], flatSessions: list(2, 'f') }]
  assert.deepEqual(
    containerKeysUnder(projects, 'p:/repo/.git').sort(),
    ['h:/repo/.git', 'p:/repo/.git', 'w:/repo', 'w:/repo-feat'].sort(),
  )
  assert.deepEqual(containerKeysUnder(projects, 'p:ws:plain').sort(), ['h:ws:plain', 'p:ws:plain'].sort())
  assert.deepEqual(containerKeysUnder(projects, 'w:/repo-feat'), ['w:/repo-feat'])
  assert.deepEqual(containerKeysUnder(projects, R), [R])
})
