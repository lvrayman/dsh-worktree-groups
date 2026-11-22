/**
 * 真实渲染烟测：用**宿主真实导出表里的名字**造 primitives 替身，SSR 渲染整块侧栏。
 *
 * ## 为什么需要这一层（它补的不是单测，是「渲染期崩溃」这一类）
 *
 * 2026-10-19 的缺陷形态是：`P.IconXxx16` → `undefined` → `jsx(undefined, {})` 抛
 * "Element type is invalid"，**渲染期才炸**。纯逻辑单测（`test/icons.test.mjs`）能锁住
 * 解析层与接线，但它锁不住"整块组件在真实 React 下渲染一次"这件事本身 ——
 * 只要有人再引入一个 `undefined` 组件（任意来源，不一定是图标），单测依然全绿。
 *
 * 本文件把真实 `src/client.js` 的工厂跑起来：给 `window.__ModuleLoader__` 一个桩、
 * 用 **node 侧构造的 React 元素替身**（`react-dom/server`）渲染 `SidebarBrowser`，
 * 宿主 primitives 面按**当前安装的宿主导出表**逐个造桩组件。于是：
 *
 * - 宿主改了图标命名 ⇒ 解析层回落空图标 ⇒ 仍然渲染成功（本用例的正是这条）；
 * - 有人再直接取 `P.IconXxx16` ⇒ 渲染期抛错 ⇒ 本用例红；
 * - 侧栏整体在 React 里跑得通（hook 顺序、props 形态、错误边界包裹）。
 *
 * 注意：这是**烟测**，不替代浏览器里的视觉确认；它验证"不崩 + 产出 DOM 文本"。
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import React from 'react'
import jsxRuntime from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const HOST_PRIMITIVES = '/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai/dsh-client-ui-primitives/lib/index.js'

/**
 * 当前安装的宿主 primitives **导出名**集合。
 *
 * 读不到（未安装 Desktop / 权限受限）时返回 `undefined`，本用例 skip 并说明 ——
 * 不静默放过。
 */
function hostExportNames() {
  let text
  try {
    text = readFileSync(HOST_PRIMITIVES, 'utf8')
  } catch {
    return undefined
  }
  const match = /^export \{([\s\S]*?)\};?\s*$/m.exec(text)
  if (match === null) return undefined
  return match[1].split(',').map((entry) => entry.trim()).filter((entry) => entry !== '')
}

/** 造一个能渲染的通用桩组件（图标 / 控件都能吃）。 */
function stubComponent(tag) {
  const Stub = (props) => React.createElement(tag, {
    'data-stub': props?.['data-stub'] ?? '',
  }, props?.children ?? null)
  Stub.displayName = `Stub(${tag})`
  return Stub
}

/**
 * 按真实导出名造宿主 primitives 面。
 *
 * 图标一律造 `<svg>` 桩（含新命名的 `*Regular`/`*Medium`），其余造 `<div>` 桩；
 * 少数被本插件当作 API 使用的导出（`writeClipboard`）造函数桩。
 */
function buildPrimitivesFace() {
  const names = hostExportNames()
  assert.notEqual(names, undefined, '读不到宿主 primitives 导出表，无法构造真实命名面')
  const face = {}
  for (const name of names) {
    if (name === 'writeClipboard') {
      face[name] = async () => undefined
      continue
    }
    if (/^Icon/.test(name) || /^PermissionIcon/.test(name) || /^LinkIcon/.test(name) || /^ReferenceIcon/.test(name)) {
      face[name] = stubComponent('svg')
      continue
    }
    if (name === 'StateDot') {
      face[name] = stubComponent('span')
      continue
    }
    if (/^(use|classify|is|close|focus|observe|pointer|rank|relative|file|diff|extract|language|settings|modal|DEFAULT|CODE_|FISH_|SHIELD_|ICON_)/.test(name)) {
      face[name] = () => undefined
      continue
    }
    face[name] = stubComponent('div')
  }
  return face
}

/**
 * 把 `lib/client.js` 的工厂跑起来，并**走真实接线**拿到侧栏组件。
 *
 * 组件本身不在 bundle 导出表里（只导出 `apply` / `inject` / `name`），所以这里造一个
 * 最小 `slots` 面调用真实 `apply`，把它交出去的组件捕获下来 —— 这样烟测同时覆盖
 * 「注册时用的 children 声明 / locale / priority」这条真实路径，而不是直接 import 内部符号。
 */
function loadClientBundle() {
  const source = readFileSync(path.join(ROOT, 'lib/client.js'), 'utf8')
  const face = buildPrimitivesFace()
  let captured
  const window = {
    __ModuleLoader__: {
      load: (registration) => { captured = registration },
    },
  }
  const require = (specifier) => {
    if (specifier === 'react') return React
    if (specifier === 'react/jsx-runtime') return jsxRuntime
    if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return face
    throw new Error(`unexpected external require: ${specifier}`)
  }
  // 用例里只有这一个 bundle，用 Function 提供 window/require 作用域（不污染全局）。
  const run = new Function('window', 'require', 'module', 'exports', source)
  const module = { exports: {} }
  run(window, require, module, module.exports)
  assert.notEqual(captured, undefined, 'lib/client.js 没有调用 __ModuleLoader__.load（构建产物形态变了？）')
  const exports = captured.factory(require)
  assert.equal(typeof exports.apply, 'function', 'bundle 应导出 apply')
  // 最小 slots 面：记录 register 的 options 与组件。
  const registrations = []
  const ctx = {
    slots: {
      inject: (key, callback) => { callback(); return () => undefined },
      register: (options, component) => {
        registrations.push({ options, component })
        return () => undefined
      },
    },
    inject: () => () => undefined,
    effect: () => undefined,
    get: () => undefined,
  }
  exports.apply(ctx)
  assert.equal(registrations.length, 1, `apply 应注册恰好一个 entry，实际 ${registrations.length}`)
  return { exports, face, registration: registrations[0] }
}

/** 造一份最小的宿主 props：仅供渲染一次，不驱动真实数据流。 */
function hostProps() {
  const snapshot = { current: undefined, byId: {} }
  const source = () => snapshot
  return {
    wide: true,
    expandSidebar: () => undefined,
    renderSlot: () => null,
    useSessions: (selector) => selector(snapshot),
    useWorkspaces: (selector) => selector(snapshot),
    useSessionPendingInteraction: (selector) => selector(new Map()),
    // 现行 live-fact 来源（宿主 0.2.1）：Map<id, { running, pendingInteraction, completionUnread }>
    useSessionStatus: (selector) => selector(new Map()),
    t: (key) => key,
  }
}

test('渲染烟测：宿主采用新图标命名（0.2.1）时，整块侧栏能渲染出 DOM', (t) => {
  if (hostExportNames() === undefined) {
    t.skip(`读不到宿主 primitives（${HOST_PRIMITIVES}），跳过宿主真实导出表烟测`)
    return
  }
  const { registration } = loadClientBundle()
  assert.equal(registration.options.name, 'sidebar.workspaces')
  assert.equal(typeof registration.component, 'function', 'register 应收到可渲染组件')
  // ⚠️ 两个折叠态都要渲染：`wide: false` 是 36px 轨道分支（它单独用 panelLeft 图标），
  // 只测宽态会漏掉轨道分支里的渲染崩溃（变异验证实测会漏）。
  const wide = renderToStaticMarkup(React.createElement(registration.component, hostProps()))
  const rail = renderToStaticMarkup(React.createElement(registration.component, { ...hostProps(), wide: false }))
  for (const html of [wide, rail]) {
    assert.equal(html.includes('error.title'), false, `侧栏被错误边界接管了：${html.slice(0, 400)}`)
  }
  const html = wide
  assert.equal(typeof html, 'string')
  assert.ok(html.length > 0, '侧栏应产出非空 DOM')
  // 错误边界接管时会渲染 error.title 文案（t 桩返回 key 本身），这里反向确认没被接管。
  assert.equal(html.includes('error.title'), false, `侧栏被错误边界接管了：${html.slice(0, 400)}`)
})

test('渲染烟测：宿主导出表里**没有任何**旧图标名时也不崩（漂移免疫）', () => {
  const names = hostExportNames()
  if (names === undefined) {
    test.skip?.()
    return
  }
  // 真实宿主已经没有 Icon*16/14/20；这里断言这一点，并确认整块仍能渲染。
  const legacy = names.filter((name) => /^Icon[A-Za-z]+\d+$/.test(name))
  assert.deepEqual(legacy, [], '宿主重新引入尺寸后缀命名，候选表需要复核')
  const { registration } = loadClientBundle()
  for (const wide of [true, false]) {
    const html = renderToStaticMarkup(React.createElement(registration.component, { ...hostProps(), wide }))
    assert.equal(html.includes('error.title'), false, `侧栏(wide=${wide}) 被错误边界接管了：${html.slice(0, 400)}`)
  }
})
