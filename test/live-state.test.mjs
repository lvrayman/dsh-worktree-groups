/**
 * 回归测试：会话行的**客户端 live fact**（等待确认琥珀态 / 后台完成未读绿点）。
 *
 * ## 缺陷事实（2026-10-19 与「侧栏渲染失败」同轮发现）
 *
 * 插件原来从两个宿主 source 取这两个态：
 *
 * | 状态 | 旧取法 | 宿主 `0.2.1-rc.2` 的实际情况 |
 * |---|---|---|
 * | 等待确认（琥珀） | root hook `useSessionPendingInteraction` | **该 source 已不存在**（全宿主 0 处命中） |
 * | 后台完成未读（绿） | `useSessions().byId[id].completed` | **该字段已不存在**（`projectList()` 不再写 `completed`） |
 *
 * 于是 PRD US7 的这两个态**永远不亮**（不崩，`asHook` 会把缺席 source 降级成恒 `undefined`
 * 的占位）。现行唯一来源是 `useSessionStatus`：
 *
 * ```js
 * next.set(id, {
 *   running: this.running.get(id),
 *   pendingInteraction: this.pendingSnapshot.get(id),   // { kind: 'approval' | 'plan-review' | 'question' | … }
 *   completionUnread: this.completionUnread.has(id),    // boolean
 * })
 * ```
 * （`dsh-client-ui-session/lib/client.js` 的 `publishStatus()`）
 *
 * ## 修复口径（被测契约）
 *
 * 1. **新 source 优先**：`useSessionStatus` 的 `Map` 一出数据就以它为准；
 * 2. **旧取法保留为兜底**：`useSessionPendingInteraction` / `byId.completed` 仍认
 *    （宿主回退或其它组合下不至于全灭）；
 * 3. **kind 白名单不变**：只有 `approval` / `plan-review` / `question` 算「等待确认」，
 *    其余 kind、非字符串、缺字段一律 `undefined`（不能因为快照里有值就点琥珀）；
 * 4. **id 拼法兼容**：宿主有 `session-<uuid>` 与裸 `<uuid>` 两种拼法，查表要归一化；
 * 5. **绝不抛错**：任何形状不认识都降级为「没有该态」。
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  currentSessionIdOf,
  liveStateOf,
  normalizeSessionKey,
  runningSignature,
  sessionStatusOf,
  visiblePendingKind,
} from '../lib/live-state.js'

/** 造 `useSessionStatus` 的 Map 快照。 */
function statusMap(entries) {
  return new Map(Object.entries(entries))
}

// ────────────────────────────────────────────────────────────────────────────
// 新数据源（useSessionStatus）
// ────────────────────────────────────────────────────────────────────────────

test('live-state/新源: pendingInteraction.kind 为白名单内值 ⇒ 琥珀态', () => {
  const status = statusMap({
    'session-a': { running: false, pendingInteraction: { kind: 'approval' }, completionUnread: false },
    'session-b': { running: false, pendingInteraction: { kind: 'plan-review' }, completionUnread: false },
    'session-c': { running: false, pendingInteraction: { kind: 'question' }, completionUnread: false },
  })
  assert.equal(liveStateOf({ status }, 'session-a').pendingKind, 'approval')
  assert.equal(liveStateOf({ status }, 'session-b').pendingKind, 'plan-review')
  assert.equal(liveStateOf({ status }, 'session-c').pendingKind, 'question')
})

test('live-state/新源: 白名单外的 kind / 缺字段 / 非对象一律不算琥珀（不能一看有值就亮）', () => {
  const status = statusMap({
    'session-a': { running: false, pendingInteraction: { kind: 'compact' }, completionUnread: false },
    'session-b': { running: false, pendingInteraction: undefined, completionUnread: false },
    'session-c': { running: false, pendingInteraction: 'approval', completionUnread: false },
    'session-d': { running: false, pendingInteraction: {}, completionUnread: false },
  })
  for (const id of ['session-a', 'session-b', 'session-c', 'session-d']) {
    assert.equal(liveStateOf({ status }, id).pendingKind, undefined, `${id} 不该亮琥珀`)
  }
})

test('live-state/新源: completionUnread === true ⇒ 绿点；false / 缺字段 ⇒ 不亮', () => {
  const status = statusMap({
    'session-done': { running: false, completionUnread: true },
    'session-idle': { running: false, completionUnread: false },
    'session-unknown': { running: false },
  })
  assert.equal(liveStateOf({ status }, 'session-done').completionUnread, true)
  assert.equal(liveStateOf({ status }, 'session-idle').completionUnread, false)
  assert.equal(liveStateOf({ status }, 'session-unknown').completionUnread, false)
})

test('live-state/新源: 只认 === true，真值对象/字符串不算（快照是别的形状时不误亮）', () => {
  const status = statusMap({
    'session-a': { completionUnread: 'yes' },
    'session-b': { completionUnread: 1 },
    'session-c': { completionUnread: {} },
  })
  for (const id of ['session-a', 'session-b', 'session-c']) {
    assert.equal(liveStateOf({ status }, id).completionUnread, false, `${id} 不该亮绿点`)
  }
})

// ────────────────────────────────────────────────────────────────────────────
// id 拼法
// ────────────────────────────────────────────────────────────────────────────

test('live-state/id: `session-` 前缀两种拼法都能查到', () => {
  const status = statusMap({
    'session-abc': { pendingInteraction: { kind: 'approval' }, completionUnread: true },
  })
  assert.equal(liveStateOf({ status }, 'abc').pendingKind, 'approval')
  assert.equal(liveStateOf({ status }, 'abc').completionUnread, true)
  assert.equal(liveStateOf({ status }, 'session-abc').pendingKind, 'approval')

  const bare = statusMap({ abc: { pendingInteraction: { kind: 'question' }, completionUnread: false } })
  assert.equal(liveStateOf({ status: bare }, 'session-abc').pendingKind, 'question')
  assert.equal(normalizeSessionKey('session-abc'), normalizeSessionKey('abc'))
})

// ────────────────────────────────────────────────────────────────────────────
// 旧取法兜底
// ────────────────────────────────────────────────────────────────────────────

test('live-state/兜底: status 缺席时仍认旧 useSessionPendingInteraction 与 byId.completed', () => {
  const pending = new Map([['session-x', { kind: 'approval' }]])
  const sessions = { byId: { 'session-y': { completed: true } } }
  assert.equal(liveStateOf({ pending, sessions }, 'x').pendingKind, 'approval')
  assert.equal(liveStateOf({ pending, sessions }, 'y').completionUnread, true)
})

test('live-state/兜底: 新源有数据时以新源为准（不让旧字段盖住最新事实）', () => {
  const status = statusMap({ 'session-x': { pendingInteraction: { kind: 'question' }, completionUnread: true } })
  const pending = new Map([['session-x', { kind: 'approval' }]])
  const sessions = { byId: { 'session-x': { completed: false } } }
  const live = liveStateOf({ status, pending, sessions }, 'x')
  assert.equal(live.pendingKind, 'question', '新源的 kind 优先')
  assert.equal(live.completionUnread, true, '新源的 completionUnread 优先')
})

// ────────────────────────────────────────────────────────────────────────────
// 健壮性
// ────────────────────────────────────────────────────────────────────────────

test('live-state/健壮性: 任何形状都不抛错，降级为「没有该态」', () => {
  const shapes = [undefined, null, 0, '', 'x', [], {}, { get: 1 }, new Map(), new Set()]
  for (const shape of shapes) {
    const live = liveStateOf({ status: shape, pending: shape, sessions: shape }, 'session-a')
    assert.equal(live.pendingKind, undefined)
    assert.equal(live.completionUnread, false)
    assert.equal(sessionStatusOf(shape, 'session-a'), undefined)
  }
  assert.equal(visiblePendingKind(undefined), undefined)
  assert.equal(visiblePendingKind(42), undefined)
  assert.equal(visiblePendingKind('approval'), 'approval')
  assert.equal(visiblePendingKind('compact'), undefined)
})

test('live-state/健壮性: 空 sessionId 不误命中', () => {
  const status = statusMap({ '': { completionUnread: true } })
  assert.equal(liveStateOf({ status }, '').completionUnread, false)
})

// ────────────────────────────────────────────────────────────────────────────
// 运行中集合签名 `runningSignature`（2026-10-20，设计 §7.1 / B1–B8）
//
// 契约：只认 `running === true`；id 经 normalizeSessionKey 归一化去重、排序后逗号拼接；
// 空 / 非字符串 / 空条目跳过；任何异常形状返回 '' 且**不抛**；忽略 pendingInteraction /
// completionUnread。它是 `sidebar.tsx` 220ms 防抖重取的**唯一**新触发源（纯函数）。
// ────────────────────────────────────────────────────────────────────────────

test('running-signature/B1: 只含 running===true（false / undefined / 真值对象都不算）', () => {
  const status = statusMap({
    a: { running: true },
    b: { running: false },
    c: { running: undefined },
  })
  assert.equal(runningSignature(status), 'a')
})

test('running-signature/B2: id 归一化 + 去重（session-x 与 x 只算一次）', () => {
  const status = statusMap({
    'session-x': { running: true },
    x: { running: true },
  })
  assert.equal(runningSignature(status), 'x', '两种拼法归一化后同一个会话 ⇒ 签名只出现一次')
})

test('running-signature/B3: 稳定排序、逗号拼接（同一输入两次同输出）', () => {
  const status = new Map([
    ['b', { running: true }],
    ['a', { running: true }],
  ])
  assert.equal(runningSignature(status), 'a,b', '按归一化 key 升序排序，与插入顺序无关')
  assert.equal(runningSignature(status), runningSignature(status), '纯函数：同一输入两次输出一致')
})

test('running-signature/B4: 空 Map / 全部非 running ⇒ 空串', () => {
  assert.equal(runningSignature(new Map()), '')
  assert.equal(runningSignature(statusMap({ a: { running: false }, b: {} })), '')
})

test('running-signature/B5: undefined / null / 0 / "" / [] / {} / { entries: 1 } ⇒ 空串且不抛', () => {
  const shapes = [undefined, null, 0, '', [], {}, { entries: 1 }, new Set()]
  for (const shape of shapes) {
    assert.doesNotThrow(() => runningSignature(shape), `形状 ${String(shape)} 不得抛错`)
    assert.equal(runningSignature(shape), '', `形状 ${String(shape)} 必须降级为空串`)
  }
})

test('running-signature/B6: entries() 抛异常的伪 Map ⇒ 空串且不抛', () => {
  const broken = {
    entries() {
      throw new Error('boom')
    },
  }
  assert.doesNotThrow(() => runningSignature(broken))
  assert.equal(runningSignature(broken), '')
})

test('running-signature/B7: 有 pendingInteraction / completionUnread 但 running!==true ⇒ 不进签名', () => {
  const status = statusMap({
    a: { running: false, pendingInteraction: { kind: 'approval' }, completionUnread: true },
    b: { running: undefined, completionUnread: true },
  })
  assert.equal(runningSignature(status), '', '审批弹窗 / 完成未读都不是「运行中」⇒ 不得触发重取')
})

test('running-signature/B8: 非字符串 id / 空 id / 非对象条目跳过，结果无首尾逗号', () => {
  const status = new Map([
    [42, { running: true }],
    ['', { running: true }],
    [null, { running: true }],
    ['x', null],
    ['y', 'not-an-object'],
    ['ok', { running: true }],
  ])
  assert.equal(runningSignature(status), 'ok', '只保留合法 id + running===true 的条目，且不产生空元素')
})

// ────────────────────────────────────────────────────────────────────────────
// 接线：sidebar.tsx 必须真的订阅 useSessionStatus（防止改回已删除的旧 source）
// ────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SIDEBAR = path.resolve(HERE, '../src/sidebar.tsx')

test('live-state/接线: sidebar.tsx 订阅 useSessionStatus 并把快照交给 withLiveState', () => {
  const text = readFileSync(SIDEBAR, 'utf8')
  assert.match(text, /useSessionStatus/, '必须订阅 useSessionStatus（现行唯一 live-fact 来源）')
  assert.match(text, /liveStateOf|withLiveState\(/, '必须经 live-state 模块取数')
  assert.match(text, /status:\s*sessionStatus|status:\s*sources\.status/, 'withLiveState 必须收到 status 快照')
  assert.doesNotMatch(
    text,
    /const\s+pendingKind\s*=\s*row\.pendingInteraction\s*!==\s*undefined[\s\S]{0,80}pendingOf\(/,
    '不应再走已删除的 useSessionPendingInteraction 单一路径',
  )
})

// ────────────────────────────────────────────────────────────────────────────
// 当前选中会话解析 `currentSessionIdOf`（2026-10-21 WSR3 / AC2）
//
// 宿主 0.2.1-rc.2 删除了 sessions.list 的顶层 `current` 字段，改为在
// `byId[id].retainedBy.mainView > 0` 上标记主视图打开的会话（且受 `panelInfo.activePanelId`
// 约束）。本函数同时兼容新源、0.1.5 旧源 `sessions.current` 与点击时的乐观选中兜底。
// ────────────────────────────────────────────────────────────────────────────

test('current-session/AC2-1: 从 0.2.1 byId[*].retainedBy.mainView > 0 解析当前会话 id', () => {
  const sessions = {
    ids: ['session-a', 'session-b'],
    byId: {
      'session-a': { id: 'session-a', retainedBy: { mainView: 0, gateway: 1 } },
      'session-b': { id: 'session-b', retainedBy: { mainView: 1 } },
    },
  }
  assert.equal(currentSessionIdOf({ sessions }), 'session-b')
})

test('current-session/AC2-2: 条目缺 id 字段时回退用 byId 的键名', () => {
  const sessions = {
    byId: {
      'session-key-only': { retainedBy: { mainView: 2 } },
    },
  }
  assert.equal(currentSessionIdOf({ sessions }), 'session-key-only')
})

test('current-session/AC2-3: panelInfo.activePanelId 非空（其它面板占据主视图）⇒ 返回 undefined', () => {
  const sessions = {
    current: 'session-legacy',
    byId: {
      'session-b': { id: 'session-b', retainedBy: { mainView: 1 } },
    },
  }
  assert.equal(
    currentSessionIdOf({
      sessions,
      panelInfo: { activePanelId: 'settings' },
      optimisticSessionId: 'session-opt',
    }),
    undefined,
  )
  // activePanelId 为 null 或 undefined 时不抑制选中
  assert.equal(
    currentSessionIdOf({
      sessions,
      panelInfo: { activePanelId: null },
    }),
    'session-b',
  )
})

test('current-session/AC2-4: 0.1.5 旧源 sessions.current 兜底与乐观选中 optimisticSessionId 兜底', () => {
  assert.equal(
    currentSessionIdOf({
      sessions: { current: 'session-legacy', byId: {} },
      optimisticSessionId: 'session-opt',
    }),
    'session-legacy',
    '旧源 sessions.current 优先于乐观兜底',
  )
  assert.equal(
    currentSessionIdOf({
      sessions: { byId: { 'session-a': { id: 'session-a', retainedBy: {} } } },
      optimisticSessionId: 'session-orphan',
    }),
    'session-orphan',
    '宿主快照尚未标记 mainView（如刚点击历史孤儿会话）时回退 optimisticSessionId',
  )
})

test('current-session/AC2-5: 异常形状不抛错，降级为 undefined', () => {
  for (const bad of [undefined, null, 42, 'str', [], { byId: null }, { byId: 'bad' }]) {
    assert.doesNotThrow(() => currentSessionIdOf({ sessions: bad, panelInfo: bad }))
    assert.equal(currentSessionIdOf({ sessions: bad, panelInfo: null }), undefined)
  }
})

