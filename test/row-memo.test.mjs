/**
 * 会话行 memo 比较器（2026-11-14 后续：会话行组件 memo 化）。
 *
 * 会话快照高频变化时整棵侧栏都会重渲染；会话行用 `React.memo` + 本比较器，只在
 * **可见内容**真的变化时才重绘。事件处理器经稳定的 `handlers` 引用间接调用，
 * 因此处理器身份变化不应触发重绘，但必须始终调用到最新实现（由接线测试保证）。
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { sessionRowPropsEqual } from '../lib/row-memo.js'

const t = (key) => key
const handlers = { current: new Map() }

function row(overrides = {}) {
  return {
    kind: 'session',
    key: 's:a',
    sessionId: 'a',
    label: 'A',
    depth: 2,
    parentKey: 'w:/repo',
    parentKind: 'worktree',
    running: false,
    blank: false,
    isCurrent: false,
    subagentCount: 0,
    completed: false,
    ...overrides,
  }
}

function props(overrides = {}) {
  return { row: row(), t, rowKey: 's:a', handlers, drag: { draggable: true, dragging: false, marker: null }, ...overrides }
}

test('内容相同但行对象 / 拖拽状态对象是新引用 ⇒ 视为相等（跳过重绘）', () => {
  assert.equal(sessionRowPropsEqual(props(), props()), true)
})

test('任一可见字段变化 ⇒ 不相等', () => {
  for (const change of [{ label: 'B' }, { isCurrent: true }, { running: true }, { subagentCount: 2 }, { completed: true }, { pendingInteraction: 'approval' }, { depth: 1 }]) {
    assert.equal(sessionRowPropsEqual(props(), props({ row: row(change) })), false, JSON.stringify(change))
  }
})

test('拖拽状态变化（可拖 / 正在拖 / 插入线）⇒ 不相等；有无拖拽接线切换 ⇒ 不相等', () => {
  for (const drag of [
    { draggable: false, dragging: false, marker: null },
    { draggable: true, dragging: true, marker: null },
    { draggable: true, dragging: false, marker: 'before' },
    undefined,
  ]) {
    assert.equal(sessionRowPropsEqual(props(), props({ drag })), false, JSON.stringify(drag))
  }
  assert.equal(sessionRowPropsEqual(props({ drag: undefined }), props({ drag: undefined })), true)
})

test('取词函数 / handlers 容器 / rowKey 变化 ⇒ 不相等', () => {
  assert.equal(sessionRowPropsEqual(props(), props({ t: (key) => `x${key}` })), false)
  assert.equal(sessionRowPropsEqual(props(), props({ handlers: { current: new Map() } })), false)
  assert.equal(sessionRowPropsEqual(props(), props({ rowKey: 'rs:a' })), false)
})

test('行对象多出 / 少了字段 ⇒ 不相等', () => {
  const withExtra = row({ pendingInteraction: 'approval' })
  assert.equal(sessionRowPropsEqual(props({ row: withExtra }), props()), false)
})
