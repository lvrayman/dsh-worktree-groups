/**
 * 回归测试：**宿主 `dsh-client-ui-primitives` 图标导出命名漂移**（侧栏整块渲染失败的根因）。
 *
 * ## 缺陷事实（2026-10-19 用户报告「这个插件导致侧栏渲染失败」）
 *
 * 插件 `src/sidebar.tsx` 直接以**尺寸后缀**取宿主图标：
 * `P.IconPlusOutline16`、`P.IconChevronDownOutline14`、`P.IconArchiveOutline20` …
 * 宿主 `0.1.5-rc.2` 的导出确实长这样（`docs/HOST-CONTRACTS.md` §B5 的导出快照）。
 *
 * 但宿主 `0.2.1-rc.2` 把图标导出改成了**线重后缀**：
 * `IconPlusOutlineRegular` / `IconPlusOutlineMedium`（`Regular` = 原始 1px，
 * `Medium` = 1.3px），尺寸改由 `size` prop 控制，**旧的 `Icon*16/14/20` 名字全部消失**
 * （实测：宿主 primitives 导出表里已无任何 `Icon*` + 数字后缀的名字）。
 *
 * 后果是**渲染期硬崩**，不是"图标不显示"：
 *
 * ```js
 * const LeadIcon = P.IconBranchOutline16   // undefined
 * jsx(LeadIcon, {})                        // React: Element type is invalid … got: undefined
 * ```
 *
 * 抛点在 `SidebarBoundary` 能捕获的子树内 ⇒ 侧栏被换成错误 UI，用户看到"侧栏渲染失败"；
 * 若异常发生在边界之外（例如 home/rail 分支），宿主 `SlotErrorBoundary` 会 `abdicate`
 * 本 entry，整块侧栏静默回落到官方 `ui-workspace`。
 *
 * ## 修复口径（被测契约）
 *
 * 1. **解析层**（`src/icons.ts`）：逻辑名 → 候选导出名（新命名优先、旧命名兜底），
 *    任一命中即用；
 * 2. **永不返回 `undefined`**：全部候选都缺席时回落**空图标组件**（渲染 `null`），
 *    侧栏因此照常渲染 —— 宿主再改一次命名也只是少几个图标，不会整块白掉；
 * 3. **接线层**：`src/sidebar.tsx` 不得再直接访问 `P.Icon*`（AST 断言），
 *    所有图标必须经解析层产出，否则下一个人"顺手补一个 `P.IconXxx16`"就会复发。
 *
 * 断言口径见各 `test(...)` 的注释。证据类型：**[审查真实代码]**（AST 断言真实
 * `src/sidebar.tsx`）+ **[真实宿主]**（读取已安装的宿主 primitives 导出表做漂移哨兵，
 * 宿主路径不存在时该条 skip 并说明原因）。
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'

import { ICON_NAMES, ICON_SPECS, resolveIcon, unresolvedIcons } from '../lib/icons.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC_DIR = path.resolve(HERE, '../src')
const SIDEBAR_PATH = path.join(SRC_DIR, 'sidebar.tsx')

/**
 * 已安装宿主 primitives 的 `lib/index.js`（DSH Desktop 打包位置）。
 *
 * 宿主改的是**运行时真正被 require 的那份导出表**，所以哨兵必须读安装目录而不是
 * `node_modules`（本包没有该依赖，见契约 §2.5）。
 */
const HOST_PRIMITIVES = '/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai/dsh-client-ui-primitives/lib/index.js'

/** 造一个只含新命名（`*Regular` / `*Medium`）的宿主面：每个名字一个独立函数。 */
function newNamingFace() {
  const face = {}
  for (const name of ICON_NAMES) {
    for (const candidate of ICON_SPECS[name].candidates) {
      if (candidate.endsWith('Regular') || candidate.endsWith('Medium')) {
        face[candidate] = function NewNaming() { return null }
      }
    }
  }
  return face
}

/** 造一个只含旧命名（`Icon*16` / `*14` / `*20`）的宿主面。 */
function legacyNamingFace() {
  const face = {}
  for (const name of ICON_NAMES) {
    for (const candidate of ICON_SPECS[name].candidates) {
      if (/^Icon[A-Za-z]+\d+$/.test(candidate)) {
        face[candidate] = function LegacyNaming() { return null }
      }
    }
  }
  return face
}

/** 从宿主 primitives 源码里抽出 `export { … }` 的名字集合；读不到返回 `undefined`。 */
function hostPrimitivesExportNames() {
  let text
  try {
    text = readFileSync(HOST_PRIMITIVES, 'utf8')
  } catch {
    return undefined
  }
  const match = /^export \{([\s\S]*?)\};?\s*$/m.exec(text)
  if (match === null) return undefined
  return new Set(match[1].split(',').map((entry) => entry.trim()).filter((entry) => entry !== ''))
}

// ────────────────────────────────────────────────────────────────────────────
// 解析层
// ────────────────────────────────────────────────────────────────────────────

test('icons/resolveIcon: 宿主用新命名（*Regular）时全部解析成功', () => {
  const face = newNamingFace()
  assert.deepEqual(unresolvedIcons(face), [], '新命名宿主面不应有解析不到的图标')
  for (const name of ICON_NAMES) {
    const resolved = resolveIcon(face, name)
    assert.equal(typeof resolved.Component, 'function', `${name} 应解析到新命名的组件`)
    // 命中的必须是新命名导出，而不是回落占位。
    const hit = ICON_SPECS[name].candidates.find((candidate) => face[candidate] !== undefined)
    assert.equal(resolved.Component, face[hit], `${name} 应取到候选 ${hit}`)
  }
})

test('icons/resolveIcon: 宿主仍是旧命名（Icon*16/14/20）时也能解析（向后兼容）', () => {
  const face = legacyNamingFace()
  assert.deepEqual(unresolvedIcons(face), [], '旧命名宿主面不应有解析不到的图标')
  for (const name of ICON_NAMES) {
    const resolved = resolveIcon(face, name)
    const hit = ICON_SPECS[name].candidates.find((candidate) => face[candidate] !== undefined)
    assert.equal(resolved.Component, face[hit], `${name} 应取到旧命名候选 ${hit}`)
  }
})

test('icons/resolveIcon: 候选全缺席时回落空图标，绝不返回 undefined（侧栏不得再白掉）', () => {
  const empty = {}
  for (const name of ICON_NAMES) {
    const resolved = resolveIcon(empty, name)
    assert.equal(typeof resolved.Component, 'function', `${name} 必须回落到可渲染组件，而不是 undefined`)
    assert.equal(resolved.Component({}), null, `${name} 的回落组件应渲染 null`)
  }
  assert.deepEqual([...unresolvedIcons(empty)].sort(), [...ICON_NAMES].sort())
})

test('icons/resolveIcon: 同一宿主面重复解析返回同一组件引用（渲染稳定）', () => {
  const face = newNamingFace()
  const first = resolveIcon(face, 'plus').Component
  const second = resolveIcon(face, 'plus').Component
  assert.equal(first, second)
})

test('icons/spec: 每个逻辑名都声明了候选，且首个候选是新命名（升级后优先）', () => {
  for (const name of ICON_NAMES) {
    const spec = ICON_SPECS[name]
    assert.ok(Array.isArray(spec.candidates) && spec.candidates.length > 0, `${name} 缺少候选`)
    assert.match(spec.candidates[0], /(Regular|Medium)$/, `${name} 的首个候选应是新命名（实测宿主 0.2.1 只认它）`)
  }
})

// ────────────────────────────────────────────────────────────────────────────
// 真实宿主漂移哨兵
// ────────────────────────────────────────────────────────────────────────────

test('icons/宿主导出表：当前安装的 primitives 仍提供每个图标的首选导出（漂移哨兵）', (t) => {
  const exports = hostPrimitivesExportNames()
  if (exports === undefined) {
    t.skip(`读不到宿主 primitives（${HOST_PRIMITIVES}），无法做漂移哨兵`)
    return
  }
  const missing = ICON_NAMES.filter((name) => !exports.has(ICON_SPECS[name].candidates[0]))
  assert.deepEqual(missing, [], '宿主已再次改名：请更新 ICON_SPECS 的候选表')
})

// ────────────────────────────────────────────────────────────────────────────
// 接线层：sidebar.tsx 不得再直接吃 P.Icon*
// ────────────────────────────────────────────────────────────────────────────

/** 解析 `src/sidebar.tsx` 成 AST。 */
function parseSidebar() {
  const text = readFileSync(SIDEBAR_PATH, 'utf8')
  return {
    text,
    sourceFile: ts.createSourceFile(SIDEBAR_PATH, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX),
  }
}

/** 遍历 AST（含所有子节点）。 */
function walk(node, visit) {
  visit(node)
  node.forEachChild((child) => walk(child, visit))
}

test('icons/接线：sidebar.tsx 不再直接访问 P.Icon*（图标必须经解析层）', () => {
  const { sourceFile, text } = parseSidebar()
  const offenders = []
  walk(sourceFile, (node) => {
    if (!ts.isPropertyAccessExpression(node)) return
    const owner = node.expression
    const isPrimitives = ts.isIdentifier(owner) && owner.text === 'P'
    if (!isPrimitives) return
    if (!/^Icon[A-Za-z0-9]*$/.test(node.name.text)) return
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
    offenders.push(`${node.getText(sourceFile)} @${line + 1}`)
  })
  assert.deepEqual(offenders, [], `这些位置仍在直接取宿主图标（宿主改名即崩）：\n${offenders.join('\n')}`)
  assert.match(text, /from '\.\/icons\.js'/, 'sidebar.tsx 必须从 ./icons.js 引入解析层')
})

test('icons/接线：sidebar.tsx 的图标取值经 icon(...) 助手，且该助手用 resolveIcon', () => {
  const { sourceFile } = parseSidebar()
  let usesResolver = false
  walk(sourceFile, (node) => {
    if (!ts.isCallExpression(node)) return
    const callee = node.expression
    const name = ts.isIdentifier(callee) ? callee.text : undefined
    if (name === 'resolveIcon') usesResolver = true
  })
  assert.equal(usesResolver, true, 'sidebar.tsx 内必须调用 resolveIcon（否则图标来源不可控）')
})
