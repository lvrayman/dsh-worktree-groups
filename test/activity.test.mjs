/**
 * 2026-10-29 单测：`src/activity.ts`（「最近」最后更新时间的数据层）。
 *
 * 覆盖：id 归一化、最大值记录、非法入参、LRU 上限、祖先传播（多层 / 缺失父 / 环）、
 * 进程级单例的写入/读取/重置，以及 `attachLastActivityTimes` 的纯函数语义。
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  attachLastActivityTimes,
  createSessionActivityTracker,
  lastSessionActivityAt,
  normalizeActivitySessionId,
  recordSessionActivity,
  registerSessionActivityObserver,
  resetSessionActivity,
  SESSION_ACTIVITY_LIMIT,
} from '../lib/activity.js'

test('2026-10-29/RAS2: normalizeActivitySessionId 去掉 session- 前缀并拒绝非法值', () => {
  assert.equal(normalizeActivitySessionId('session-abc'), 'abc')
  assert.equal(normalizeActivitySessionId('abc'), 'abc')
  assert.equal(normalizeActivitySessionId(' session-abc '), 'abc', '首尾空白应被裁掉')
  assert.equal(normalizeActivitySessionId(''), '')
  assert.equal(normalizeActivitySessionId('   '), '')
  assert.equal(normalizeActivitySessionId(undefined), '')
  assert.equal(normalizeActivitySessionId(null), '')
  assert.equal(normalizeActivitySessionId(42), '')
  assert.equal(normalizeActivitySessionId({}), '')
})

test('2026-10-29/RAS2: tracker 只保留最大活动时间，并忽略非法 id / 时间', () => {
  const tracker = createSessionActivityTracker(10)
  tracker.record('session-a', 100)
  assert.equal(tracker.lastActivityAt('a'), 100, '带前缀写入、裸 id 读取')
  assert.equal(tracker.lastActivityAt('session-a'), 100, '带前缀读取同样命中')

  tracker.record('a', 50)
  assert.equal(tracker.lastActivityAt('a'), 100, '更旧的时间不得回退最大值')

  tracker.record('a', 300)
  assert.equal(tracker.lastActivityAt('a'), 300, '更新的时间应替换')

  tracker.record('', 999)
  tracker.record(undefined, 999)
  tracker.record('b', Number.NaN)
  tracker.record('b', Number.POSITIVE_INFINITY)
  tracker.record('b', '123')
  assert.equal(tracker.size, 1, '非法 id / 时间不得写入')
  assert.equal(tracker.lastActivityAt('b'), undefined)
})

test('2026-10-29/RAS2: tracker 超过容量上限时按 LRU 淘汰最久未更新的一条', () => {
  assert.equal(SESSION_ACTIVITY_LIMIT > 0, true, '默认上限必须是正数')
  const tracker = createSessionActivityTracker(3)
  tracker.record('a', 1)
  tracker.record('b', 2)
  tracker.record('c', 3)
  tracker.record('a', 4) // 刷新 a ⇒ b 成为最久未更新
  tracker.record('d', 5)

  assert.equal(tracker.size, 3, '容量不应超过上限')
  assert.equal(tracker.lastActivityAt('a'), 4, '刚刚刷新的 a 必须保留')
  assert.equal(tracker.lastActivityAt('d'), 5, '新写入的 d 必须保留')
  assert.equal(tracker.lastActivityAt('b'), undefined, '最久未更新的 b 被淘汰')
})

test('2026-10-29/RAS2: 进程级单例可写入 / 读取 / 重置', () => {
  resetSessionActivity()
  assert.equal(lastSessionActivityAt('any'), undefined)
  recordSessionActivity('session-x', 1234)
  assert.equal(lastSessionActivityAt('x'), 1234)
  resetSessionActivity()
  assert.equal(lastSessionActivityAt('x'), undefined)
})

/** 造一条可参与传播的会话行。 */
function row(sessionId, updatedAt, overrides = {}) {
  return { sessionId, updatedAt, ...overrides }
}

test('2026-10-29/RAS3: attachLastActivityTimes 无活动记录时回退 updatedAt（恒为有限数字）', () => {
  resetSessionActivity()
  const rows = [row('a', 100), row('b', 0), row('c', 500)]
  attachLastActivityTimes(rows)
  assert.deepEqual(
    rows.map((item) => item.lastActivityAt),
    [100, 0, 500],
    '无活动时 lastActivityAt === updatedAt',
  )
})

test('2026-10-29/RAS3: 活动时间取 max(updatedAt, 记录)，且从不低于 updatedAt', () => {
  resetSessionActivity()
  recordSessionActivity('a', 900)
  recordSessionActivity('b', 50) // 比 updatedAt 旧 ⇒ 不得回退
  const rows = [row('session-a', 100), row('b', 400)]
  attachLastActivityTimes(rows)
  assert.equal(rows[0].lastActivityAt, 900, '活动时间更新时采用活动时间（前缀/裸 id 归一化）')
  assert.equal(rows[1].lastActivityAt, 400, '活动时间更旧时保持 updatedAt')
})

test('2026-10-29/RAS3: 子代理活动沿 parentSessionId 传播到祖先（多层）', () => {
  resetSessionActivity()
  recordSessionActivity('grandchild', 900)
  recordSessionActivity('parent', 300)
  const rows = [
    row('parent', 100),
    row('child', 200, { parentSessionId: 'parent' }),
    row('grandchild', 50, { parentSessionId: 'child' }),
  ]
  attachLastActivityTimes(rows)
  assert.equal(rows[0].lastActivityAt, 900, '祖先必须拿到后代的最大活动时间')
  assert.equal(rows[1].lastActivityAt, 900, '中间层同步传播')
  assert.equal(rows[2].lastActivityAt, 900, '后代自身保留自己的活动时间')
})

test('2026-10-29/RAS3: 缺失父引用 / 自环 / 多节点环都不会死循环或抛错', () => {
  resetSessionActivity()
  recordSessionActivity('orphan', 800)
  recordSessionActivity('self', 700)
  recordSessionActivity('ring-a', 600)
  const rows = [
    row('orphan', 10, { parentSessionId: 'does-not-exist' }),
    row('self', 10, { parentSessionId: 'self' }),
    row('ring-a', 10, { parentSessionId: 'ring-b' }),
    row('ring-b', 10, { parentSessionId: 'ring-a' }),
  ]
  assert.doesNotThrow(() => attachLastActivityTimes(rows))
  assert.equal(rows[0].lastActivityAt, 800, '缺失父引用只影响传播，不影响自身')
  assert.equal(rows[1].lastActivityAt, 700, '自环安全终止')
  assert.equal(rows[2].lastActivityAt, 600, '环上的节点保留自身活动时间')
  assert.equal(rows[3].lastActivityAt, 600, '环上的另一节点同样拿到环内最大值')
})

test('2026-10-29/RAS3: 同一会话在不同容器重复出现时每行都写同一个活动时间', () => {
  resetSessionActivity()
  recordSessionActivity('dup', 555)
  const rows = [row('session-dup', 10), row('dup', 20)]
  attachLastActivityTimes(rows)
  assert.deepEqual(
    rows.map((item) => item.lastActivityAt),
    [555, 555],
    '同一会话无论出现在哪个容器，活动时间必须一致',
  )
})

test('2026-10-29/RAS2: registerSessionActivityObserver 在缺失 on / 注册抛错时静默降级', async () => {
  resetSessionActivity()

  // 1) 老宿主 / 测试替身没有 on ⇒ 返回 no-op disposer，不抛。
  assert.doesNotThrow(() => registerSessionActivityObserver({}))
  const disposeMissing = registerSessionActivityObserver({})
  assert.equal(typeof disposeMissing, 'function', '缺失 on 时也必须返回可调用的 disposer')
  assert.doesNotThrow(() => disposeMissing())

  // 2) on 抛错 ⇒ 静默降级。
  assert.doesNotThrow(() =>
    registerSessionActivityObserver({
      on() {
        throw new Error('host on exploded')
      },
    }),
  )

  // 3) 正常注册后：合法事件写入单例，畸形事件忽略，disposer 解除后不再写入。
  let listener
  const ctx = {
    on(name, handler) {
      assert.equal(name, 'session/event')
      listener = handler
      return () => {
        listener = undefined
      }
    },
  }
  const dispose = registerSessionActivityObserver(ctx)
  assert.equal(typeof listener, 'function', '正常上下文必须真的注册监听器')

  listener({ id: 'session-ok' }, { time: 500 })
  assert.equal(lastSessionActivityAt('ok'), 500)
  listener({}, { time: 600 })
  listener({ id: 'ok' }, {})
  assert.equal(lastSessionActivityAt('ok'), 500, '畸形事件不得写入')
  assert.doesNotThrow(() => listener({ header: { id: 'via-header' } }, { time: 700 }))
  assert.equal(lastSessionActivityAt('via-header'), 700, 'session.header.id 必须作为兜底 id 来源')

  dispose()
  assert.equal(listener, undefined, 'disposer 必须解除监听')
  resetSessionActivity()
})
