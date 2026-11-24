/**
 * `live-merge.ts`（2026-11-14 PERF6）：把宿主 `useSessions` 实时快照叠加到 `/tree` 载荷上。
 * 需求：`docs/requirements/2026-11-14-perf-progressive-expand.md` §3.1 PERF6。
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  mergeLiveSessions,
  resolveArchivedSessionIds,
  workspacesSnapshotSignature,
} from '../lib/live-merge.js'

function row(sessionId, overrides = {}) {
  return { sessionId, updatedAt: 100, lastActivityAt: 100, running: false, blank: false, ...overrides }
}

function makeTree() {
  return {
    projects: [
      {
        key: '/repo/.git',
        isGit: true,
        title: 'repo',
        mainPath: '/repo',
        worktrees: [
          { path: '/repo', isMain: true, exists: true, title: 'repo', sessions: [row('session-a', { cwd: '/repo', title: 'A' })] },
          { path: '/repo-feat', isMain: false, exists: true, title: 'feat', sessions: [] },
          { path: '/repo-gone', isMain: false, exists: false, title: 'gone', sessions: [] },
        ],
        history: [],
        flatSessions: [],
      },
      { key: 'ws:plain', isGit: false, title: 'plain', worktrees: [], history: [], flatSessions: [] },
    ],
    ungrouped: [],
    archivedSessionIds: ['session-archived'],
    workspaceByPath: { '/repo': 'w1', '/plain': 'plain' },
  }
}

function snapshot(entries) {
  return { ids: entries.map((entry) => entry.id), byId: Object.fromEntries(entries.map((entry) => [entry.id, entry])) }
}

test('无实时快照 / 快照与树一致 ⇒ 原样返回同一引用，无待确认 id', () => {
  const tree = makeTree()
  assert.equal(mergeLiveSessions(tree, undefined).tree, tree)
  const same = mergeLiveSessions(tree, snapshot([{ id: 'session-a', cwd: '/repo', updatedAt: 100, running: false, blank: false, title: 'A' }]))
  assert.equal(same.tree, tree)
  assert.deepEqual(same.pendingIds, [])
})

test('新顶层会话按 cwd 立即落进对应 worktree（含子目录），标记为待服务端确认', () => {
  const tree = makeTree()
  const merged = mergeLiveSessions(
    tree,
    snapshot([
      { id: 'session-a', cwd: '/repo', updatedAt: 100, running: false, blank: false, title: 'A' },
      { id: 'session-new', cwd: '/repo-feat/src', updatedAt: 500, running: true, blank: false, title: 'New' },
    ]),
  )
  assert.notEqual(merged.tree, tree)
  const feat = merged.tree.projects[0].worktrees[1]
  assert.deepEqual(feat.sessions.map((s) => s.sessionId), ['session-new'])
  assert.equal(feat.sessions[0].running, true)
  assert.equal(feat.sessions[0].title, 'New')
  assert.equal(feat.sessions[0].updatedAt, 500)
  assert.equal(feat.sessions[0].lastActivityAt, 500)
  assert.deepEqual(merged.pendingIds, ['session-new'])
  assert.equal(tree.projects[0].worktrees[1].sessions.length, 0, '不修改原树')
})

test('最长前缀优先：嵌套 worktree 路径选最深的那个；不误匹配同前缀的兄弟目录', () => {
  const tree = makeTree()
  tree.projects[0].worktrees.push({ path: '/repo/nested', isMain: false, exists: true, title: 'nested', sessions: [] })
  const merged = mergeLiveSessions(
    tree,
    snapshot([
      { id: 'session-n', cwd: '/repo/nested/x', updatedAt: 1, running: false, blank: false },
      { id: 'session-sib', cwd: '/repo-featX', updatedAt: 1, running: false, blank: false },
    ]),
  )
  const nested = merged.tree.projects[0].worktrees.find((node) => node.path === '/repo/nested')
  assert.deepEqual(nested.sessions.map((s) => s.sessionId), ['session-n'])
  assert.equal(merged.tree.projects[0].worktrees[1].sessions.length, 0, '/repo-featX 不属于 /repo-feat')
  assert.deepEqual(merged.pendingIds.sort(), ['session-n', 'session-sib'])
})

test('非 git 工作区按 workspaceByPath 落进 flatSessions', () => {
  const merged = mergeLiveSessions(makeTree(), snapshot([{ id: 'session-p', cwd: '/plain', updatedAt: 9, running: false, blank: true }]))
  assert.deepEqual(merged.tree.projects[1].flatSessions.map((s) => s.sessionId), ['session-p'])
  assert.equal(merged.tree.projects[1].flatSessions[0].blank, true)
})

test('子代理 / 已归档 / 无 cwd / 已关闭 worktree 下的新会话不就地插入', () => {
  const merged = mergeLiveSessions(
    makeTree(),
    snapshot([
      { id: 'session-sub', cwd: '/repo', updatedAt: 1, running: true, blank: false, origin: 'subagent', parentId: 'session-a' },
      { id: 'session-archived', cwd: '/repo', updatedAt: 1, running: false, blank: false },
      { id: 'session-nocwd', updatedAt: 1, running: false, blank: false },
      { id: 'session-gone', cwd: '/repo-gone', updatedAt: 1, running: false, blank: false },
    ]),
  )
  const all = merged.tree.projects.flatMap((p) => [...p.worktrees.flatMap((w) => w.sessions), ...p.flatSessions, ...p.history])
  assert.deepEqual(all.map((s) => s.sessionId), ['session-a'])
  assert.deepEqual(merged.pendingIds, ['session-gone'], '只有顶层、未归档、有 cwd 的才算待确认')
})

test('已有会话：标题 / 运行态 / blank 以实时快照为准，updatedAt 只增不减', () => {
  const merged = mergeLiveSessions(
    makeTree(),
    snapshot([{ id: 'session-a', cwd: '/repo', updatedAt: 300, running: true, blank: false, title: 'Renamed' }]),
  )
  const a = merged.tree.projects[0].worktrees[0].sessions[0]
  assert.equal(a.title, 'Renamed')
  assert.equal(a.running, true)
  assert.equal(a.updatedAt, 300)
  assert.equal(a.lastActivityAt, 300)
  assert.deepEqual(merged.pendingIds, [])

  const older = mergeLiveSessions(makeTree(), snapshot([{ id: 'session-a', cwd: '/repo', updatedAt: 50, running: false, blank: false, title: 'A' }]))
  assert.equal(older.tree.projects[0].worktrees[0].sessions[0].updatedAt, 100)
})

test('树里的 id 与快照 id 前缀形态不同（session- 前缀）也能对上', () => {
  const tree = makeTree()
  tree.projects[0].worktrees[0].sessions = [row('abc', { cwd: '/repo', title: 'A' })]
  const merged = mergeLiveSessions(tree, snapshot([{ id: 'session-abc', cwd: '/repo', updatedAt: 100, running: false, blank: false, title: 'A' }]))
  assert.equal(merged.tree, tree)
  assert.deepEqual(merged.pendingIds, [])
})

test('2026-11-24/AC4 resolveArchivedSessionIds: 就绪态优先采用客户端实时归档集合，pending/缺席回退服务端', () => {
  const server = ['session-old']
  assert.deepEqual(
    resolveArchivedSessionIds(server, { phase: 'ready', archivedSessionIds: ['session-old', 'session-new'] }),
    ['session-old', 'session-new'],
    'ready 态实时反映新增归档',
  )
  assert.deepEqual(
    resolveArchivedSessionIds(server, { phase: 'ready', archivedSessionIds: [] }),
    [],
    'ready 态实时反映取消归档（清空）',
  )
  assert.deepEqual(
    resolveArchivedSessionIds(server, { archivedSessionIds: ['session-a'] }),
    ['session-a'],
    '省略 phase 的最小快照也采用实时集合',
  )
  assert.deepEqual(
    resolveArchivedSessionIds(server, { phase: 'pending', archivedSessionIds: [] }),
    server,
    'pending 态不得用空数组覆盖服务端归档集合',
  )
  assert.deepEqual(resolveArchivedSessionIds(server, undefined), server, '快照缺席回退服务端')
})

test('2026-11-24/AC5 workspacesSnapshotSignature: 归档集合增删也会改变签名（触发 reload）', () => {
  const base = {
    phase: 'ready',
    items: [{ workspaceId: 'w1', path: '/repo', title: 'Repo', updatedAt: 100 }],
    archivedSessionIds: ['session-1'],
  }
  const archivedMore = { ...base, archivedSessionIds: ['session-1', 'session-2'] }
  const reorderedSame = { ...base, archivedSessionIds: ['session-2', 'session-1'] }
  const unarchived = { ...base, archivedSessionIds: [] }

  assert.notEqual(
    workspacesSnapshotSignature(base),
    workspacesSnapshotSignature(archivedMore),
    '新增归档会话必须改变签名',
  )
  assert.notEqual(
    workspacesSnapshotSignature(base),
    workspacesSnapshotSignature(unarchived),
    '取消归档会话必须改变签名',
  )
  assert.equal(
    workspacesSnapshotSignature(archivedMore),
    workspacesSnapshotSignature(reorderedSame),
    '仅归档数组顺序变化不应误触发重取',
  )
})

test('2026-11-24/AC4 mergeLiveSessions: 传入实时 liveArchivedSessionIds 时，刚归档的实时会话不进 pendingIds', () => {
  const tree = makeTree()
  const merged = mergeLiveSessions(
    tree,
    snapshot([{ id: 'session-just-archived', cwd: '/repo', updatedAt: 200, running: false, blank: false }]),
    ['session-archived', 'session-just-archived'],
  )
  assert.equal(merged.tree, tree)
  assert.deepEqual(merged.pendingIds, [])
})
