/**
 * 2026-11-24：客户端桥接（`lib/client.js`）行为测试 —— DSH 原生会话右键菜单与单会话归档。
 *
 * 直接运行编译产物 `lib/client.js` 的 `apply(ctx)`，捕获注入给 `SidebarBrowser` 的
 * `bridge`，验证：
 * - AC1：`openSessionContextMenu` 委托 `ctx.get('contextMenus').open({ kind: 'session', value: { sessionId, displayTitle } }, { x, y })` 并返回 `true`；
 * - AC3：`contextMenus` 缺席时返回 `false`（允许降级自绘 `MenuLayer`）；`closeContextMenu` 调用 `contextMenus.close()` 且缺席时不抛错；
 * - AC3：`archiveSession` 优先走 `uiWorkspace.archiveSession`，缺席再回退 `workspaces.archiveSession`。
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import React from 'react'
import jsxRuntime from 'react/jsx-runtime'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')

function stubComponent(tag) {
  const Stub = (props) => React.createElement(tag, null, props?.children ?? null)
  return Stub
}

const PRIMITIVES_PROXY = new Proxy(
  { writeClipboard: async () => undefined },
  {
    get(target, prop) {
      if (prop in target) return target[prop]
      if (typeof prop === 'string' && /^(use|classify|is|close|focus|observe|pointer|rank|relative)/.test(prop)) {
        return () => undefined
      }
      return stubComponent('div')
    },
  },
)

function mountClientBridge(services) {
  const source = readFileSync(path.join(ROOT, 'lib/client.js'), 'utf8')
  let capturedRegistration
  const window = {
    __ModuleLoader__: {
      load: (registration) => { capturedRegistration = registration },
    },
  }
  const require = (specifier) => {
    if (specifier === 'react') return React
    if (specifier === 'react/jsx-runtime') return jsxRuntime
    if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return PRIMITIVES_PROXY
    throw new Error(`unexpected external require: ${specifier}`)
  }
  const run = new Function('window', 'require', 'module', 'exports', source)
  const module = { exports: {} }
  run(window, require, module, module.exports)
  assert.notEqual(capturedRegistration, undefined, 'lib/client.js 必须通过 __ModuleLoader__.load 注册工厂')
  const bundleExports = capturedRegistration.factory(require)
  assert.equal(typeof bundleExports?.apply, 'function', 'bundle 必须导出 apply')

  let injectedBridge
  const slots = {
    inject: (_slot, cb) => cb(),
    register: (entry) => {
      if (entry.name === 'sidebar.workspaces' && typeof entry.inject === 'function') {
        injectedBridge = entry.inject().bridge
      }
      return () => {}
    },
  }
  const ctx = {
    slots,
    get: (name) => (name === 'slots' ? slots : services[name]),
    inject: () => {},
    effect: () => {},
  }
  bundleExports.apply(ctx)
  assert.ok(injectedBridge, '必须向 sidebar.workspaces 注入 bridge')
  return injectedBridge
}

test('2026-11-24/AC1 bridge.openSessionContextMenu: 委托 DSH 原生 contextMenus.open 并返回 true', () => {
  const calls = []
  const bridge = mountClientBridge({
    contextMenus: {
      open: (target, point) => { calls.push({ target, point }) },
      close: () => {},
    },
  })

  assert.equal(typeof bridge.openSessionContextMenu, 'function', 'bridge 必须暴露 openSessionContextMenu')
  const opened = bridge.openSessionContextMenu({
    sessionId: 'session-42',
    displayTitle: '调试会话',
    x: 120,
    y: 260,
  })
  assert.equal(opened, true)
  assert.deepEqual(calls, [
    {
      target: { kind: 'session', value: { sessionId: 'session-42', displayTitle: '调试会话' } },
      point: { x: 120, y: 260 },
    },
  ])
})

test('2026-11-24/AC3 bridge.openSessionContextMenu & closeContextMenu: contextMenus 缺席时优雅降级不抛错', () => {
  const bridge = mountClientBridge({})
  assert.equal(
    bridge.openSessionContextMenu({ sessionId: 'session-1', displayTitle: 'A', x: 10, y: 20 }),
    false,
    '缺少 contextMenus 服务时必须返回 false 以允许回落自绘 MenuLayer',
  )
  assert.doesNotThrow(() => bridge.closeContextMenu(), '缺少 contextMenus 服务时 closeContextMenu 不得抛错')

  let closed = 0
  const withMenus = mountClientBridge({
    contextMenus: { open: () => {}, close: () => { closed += 1 } },
  })
  withMenus.closeContextMenu()
  assert.equal(closed, 1, '存在 contextMenus 服务时 closeContextMenu 必须调用 contextMenus.close()')
})

test('2026-11-24/AC3 bridge.archiveSession: 优先走 uiWorkspace.archiveSession，缺席回退 workspaces.archiveSession', async () => {
  const uiCalls = []
  const wsCalls = []
  const bridgeWithUi = mountClientBridge({
    uiWorkspace: { archiveSession: async (id) => { uiCalls.push(id) } },
    workspaces: { archiveSession: async (id) => { wsCalls.push(id) } },
  })
  await bridgeWithUi.archiveSession('session-9')
  assert.deepEqual(uiCalls, ['session-9'], '优先调用 uiWorkspace.archiveSession（会清主区选中）')
  assert.deepEqual(wsCalls, [], 'uiWorkspace 可用时不重复调用 workspaces.archiveSession')

  const fallbackCalls = []
  const bridgeFallback = mountClientBridge({
    workspaces: { archiveSession: async (id) => { fallbackCalls.push(id) } },
  })
  await bridgeFallback.archiveSession('session-10')
  assert.deepEqual(fallbackCalls, ['session-10'], 'uiWorkspace 缺席时回退 workspaces.archiveSession')
})
