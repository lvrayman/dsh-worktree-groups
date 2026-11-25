/**
 * T13 源码级契约测试：`src/sidebar.tsx` 的 **T11 交互接线**（T12 的 N-1）。
 *
 * ## 为什么必须有这个文件
 *
 * `src/sidebar.tsx` 是 `.tsx`，**不进 `lib/`**，`node --test` 无法执行它
 * （`tsconfig.json` 只编译 `.ts`；`.tsx` 走 esbuild 打进 `lib/client.js` 的 bundle）。
 * 因此 T11 的两条核心用户可见承诺 —— ① 运行中的会话**不可拖动**、② 该判据与「置顶」
 * 判据**同源** —— 在 T12 复审时**零自动回归保护**：
 *
 * | 变异 | 做法 | T12 实测（**旧套件** `test/tree-model.test.mjs`，当时 **247** 条） |
 * |---|---|---|
 * | **M7** | 删掉 `dragHandlersFor` 调用的第 3 个实参 ⇒ 运行中的会话又变成可拖动 | **fail 0**（该旧套件 247/247 全绿 ⇒ 对这条接线**零保护**） |
 * | **M8** | 把「不可拖」判据换成 `row.running !== true`（与置顶判据**分叉**） | **fail 0**（该旧套件 247/247 全绿 ⇒ 对这条接线**零保护**） |
 *
 * > ⚠️ **上表的 `fail 0` / `247` 是「旧套件 `test/tree-model.test.mjs`」在 T12 时代（当时
 * > 247 条）的实测值，不是本文件的数字。** 本文件（`test/sidebar-wiring.test.mjs`）当时
 * > **尚不存在**；T13 引入本文件后，同样的 M7/M8 变异在本套件上各 **fail 2**（见
 * > `test/mutation-t11.md` §1）。T13 之后旧套件为 250 条（T13 时点全量 391 条；
 * > **T15 收尾后本套件 10 条、全量 393 条** —— T15 追加两条 `T13/接线[P2]`，见 §4）。
 *
 * 本文件用 **TypeScript 编译器 API 解析真实源码文本**（`src/sidebar.tsx` 本身，
 * **不是**复刻版、**不是**对 bundle 的猜测），把「接线必须长什么样」变成可自动执行的断言。
 * 因为是 AST 断言，它**对格式 / 空白 / 换行 / 注释完全免疫**（不像正则或字符串匹配那样
 * 容易误报），只在**语义接线**真的变了时才红。
 *
 * ## 断言清单（每条都对应一个具体失效模式）
 *
 * 1. `dragHandlersFor` 有**恰好 3 个**形参，第 3 个是 `draggable`（默认 `true`）；
 * 2. `dragHandlersFor` 的返回值里 `draggable` 被真正带出（否则参数只是摆设）；
 * 3. `onDragStart` 里有 `if (!draggable) return`（伪造 `dragstart` 也不进拖拽态，双保险）；
 * 4. 全文件**恰好 3 个** `dragHandlersFor(...)` 调用（session / worktree / project）；
 * 5. **session 行**的调用传入**第 3 个实参**，且它是 `!isSessionDragLocked(<row>, <topZone>)`
 *    —— 这一条同时钉死 M7（删实参）与 M8（换判据）。**2026-10-22（DR5）**起拖拽锁 =
 *    运行中 ∪ 当前空白占位行，因此判据由 `isSessionDragLocked` 承担；
 * 6. **worktree / project 行**的调用**不传**第 3 个实参（防止「顺手把容器行也改成不可拖」）；
 * 7. `isSessionDragLocked` **从 `./tree-model.js` import**（真的用共享实现），且
 *    `sidebar.tsx` **不得**绕过它直接 import `isTopZoneRunningSession`；
 * 8. 全 `src/` 里 `isSessionDragLocked` 与 `isTopZoneRunningSession` 各只有**一份声明**；
 *    `isSessionDragLocked` 内部复用 `isTopZoneRunningSession`，而后者同时服务
 *    `topZoneSessionKeys`（置顶判据）⇒ **判据同源**是结构性事实，不是注释里的承诺。
 * 9. **【P2 下游断链】** `SessionRowView`（会话行）与 `ContainerRowView`（容器行）都必须把
 *    局部 `drag` 的 `.draggable` 接到 `jsx('div', { draggable: … })` 的 **DOM prop** 上
 *    —— 否则 `dragHandlersFor` 的 `draggable: false` 被静默忽略（T14b 实测：`draggable: true`
 *    写死时两套件全绿，运行中的会话实际变成可拖）；
 * 10. **【P2 实参身份】** `!isSessionDragLocked(row, X)` 的 `X` 必须**身份可追溯**到
 *     `topZoneInputOf(...)` 的产物（真实顶部区投影），不能只是「某个非空标识符」
 *     （T14b 实测：传 `undefined` 能通过旧断言）；
 * 11. **【接线连通】** session 行 `dragHandlersFor(...)` 的结果必须真的流向
 *     `jsx(SessionRowView, …)` 的 props（防止「算了但没传」）。
 *
 * ## 稳健性取舍（如实声明）
 *
 * 第 9/10/11 条刻意**不**锁定字面写法：局部别名按 AST 解析（改名免疫）、`topZone` 允许
 * 直接调用真实投影或经「标识符中转」传播、`draggable` 的值只要求**子树里出现
 * `<drag 别名>.draggable` 的属性访问**（因此 `drag !== undefined && drag.draggable`、
 * `Boolean(drag?.draggable)` 等等价写法都通过）。
 * **代价（残余局限）**：若有人把 `drag` 再包一层 `const canDrag = drag.draggable` 后写
 * `draggable: canDrag`，本条会**误报**（保守方向：宁可误报也不漏报）—— 这类「间接但正确」
 * 的重构需人工确认。反向的残余缺口见文件末注释。
 *
 * 证据类型：**[审查真实代码]**（对真实源码做 AST 断言）+ 变异验证见
 * `test/mutation-t11.md`（§1 变异表 M7/M8）。
 */

import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC_DIR = path.resolve(HERE, '../src')
const SIDEBAR_PATH = path.join(SRC_DIR, 'sidebar.tsx')
const TREE_MODEL_PATH = path.join(SRC_DIR, 'tree-model.ts')

/**
 * 源码里的**空白规范化**：把连续空白折成单个空格。
 *
 * 用途：断言「某个判据表达式在语义上等价」时忽略换行 / 缩进 / 多余空格 ——
 * 这样**格式化（prettier 换行、行宽变化）不会误报**，只有真正换了判据才会红。
 */
const normalizeWs = (text) => text.replace(/\s+/g, ' ').trim()

/**
 * 判定一个「取反的一元表达式」是否就是 `!<callee>(a, b)` 这一判据。
 *
 * 接受任何**实参写法**（`row` / `props.row` / `this.row` 等），只要：
 * - 顶层是 `!`；
 * - 取反对象是**对共享导出的调用**（identifier 或 `ns.<callee>` 属性访问皆可）；
 * - 恰好 2 个实参（口径要求 `(session, topZone)`）。
 *
 * 2026-10-22（DR5）起默认 callee 由 `isTopZoneRunningSession` 换成
 * `isSessionDragLocked`（= 运行中 ∪ 当前空白占位行，其中「运行中」仍复用前者）。
 *
 * 不接受 `!row.running`、`!(row.running === true || …)` 这类**分叉复刻**判据。
 */
function isNegatedSharedCriteria(node, calleeName = 'isSessionDragLocked') {
  if (!ts.isPrefixUnaryExpression(node) || node.operator !== ts.SyntaxKind.ExclamationToken) return false
  const operand = node.operand
  if (!ts.isCallExpression(operand)) return false
  const callee = operand.expression
  const name = ts.isIdentifier(callee)
    ? callee.text
    : ts.isPropertyAccessExpression(callee)
      ? callee.name.text
      : undefined
  if (name !== calleeName) return false
  return operand.arguments.length === 2
}

/** 读源码并解析成 AST（`.tsx` ⇒ `ScriptKind.TSX`，`setParentNodes: true` 便于回溯）。 */
function parse(filePath) {
  const text = readFileSync(filePath, 'utf8')
  return { text, sourceFile: ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX) }
}

/** 遍历 AST（含所有子节点）。 */
function walk(node, visit) {
  visit(node)
  node.forEachChild((child) => walk(child, visit))
}

/** 收集某个文件里所有「函数声明」与「const <name> = <箭头函数|函数表达式>」。 */
function functionLikeDeclarations(sourceFile) {
  const found = new Map()
  walk(sourceFile, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name !== undefined) {
      found.set(node.name.text, { node, kind: 'function', params: node.parameters })
      return
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined) {
      const init = node.initializer
      if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
        found.set(node.name.text, { node, kind: 'variable', params: init.parameters })
      }
    }
  })
  return found
}

/** 收集某个文件里所有 `calleeName(...)` 形式的调用表达式。 */
function callExpressionsOf(sourceFile, calleeName) {
  const calls = []
  walk(sourceFile, (node) => {
    if (!ts.isCallExpression(node)) return
    const callee = node.expression
    const name = ts.isIdentifier(callee)
      ? callee.text
      : ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : undefined
    if (name === calleeName) calls.push(node)
  })
  return calls
}

/** 形参名（含默认值）。 */
const paramNames = (params) => params.map((p) => (ts.isIdentifier(p.name) ? p.name.text : p.name.getText()))

/** 对象字面量里某个属性的「值」节点（不存在 ⇒ undefined）。 */
function propertyValue(objectLiteral, name) {
  for (const prop of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(prop)) continue
    const key = ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) ? prop.name.text : undefined
    if (key === name) return prop.initializer
  }
  return undefined
}

/** 属性名列表（用于断言 shorthand `draggable,` 确实被带出）。 */
function propertyNames(objectLiteral) {
  return objectLiteral.properties.map((prop) => {
    if (ts.isShorthandPropertyAssignment(prop)) return prop.name.text
    if (ts.isPropertyAssignment(prop) && (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name))) {
      return prop.name.text
    }
    return prop.getText()
  })
}

// ── P2 辅助：把「实参身份」变成可判定事实，而不是「非空标识符」 ──────────────────

/** 函数体**直接语句**里的 `const/let/var` 声明（不递归进嵌套函数，避免抓错作用域）。 */
function directVariableDeclarations(fnNode) {
  const out = []
  const body = fnNode.body
  if (body === undefined || !ts.isBlock(body)) return out
  for (const statement of body.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) out.push(declaration)
  }
  return out
}

/**
 * 函数体内 `const <name> = props.drag` 的**局部别名**（不存在 ⇒ undefined）。
 *
 * 按 AST 解析而非字面名 ⇒ `drag` 改名成 `d` / `dragHandlers` 都仍然通过。
 */
function dragAliasIn(fnNode) {
  for (const declaration of directVariableDeclarations(fnNode)) {
    if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue
    if (normalizeWs(declaration.initializer.getText()) === 'props.drag') return declaration.name.text
  }
  return undefined
}

/**
 * 某个值节点的**子树**里是否出现 `<drag 别名>.draggable`（属性访问）。
 *
 * 宽松点：不要求整棵表达式逐字等于 `drag !== undefined && drag.draggable` ——
 * `Boolean(drag?.draggable)`、`(drag && drag.draggable) === true` 等等价写法都通过；
 * 但 `true` / `false` / `row.running` / `drag.dragging` 一律不通过。
 */
function referencesDragDraggable(valueNode, alias) {
  const accepted = new Set([alias, 'props.drag'].filter((name) => name !== undefined))
  let ok = false
  walk(valueNode, (node) => {
    if (!ts.isPropertyAccessExpression(node)) return
    if (node.name.text !== 'draggable') return
    if (accepted.has(normalizeWs(node.expression.getText()))) ok = true
  })
  return ok
}

/**
 * 收集 `jsx(<tag>, { … })` 调用里的 props 对象字面量。
 *
 * `tagText` 同时匹配**字符串字面量**标签（`jsx('div', …)`）与**标识符**标签
 * （`jsx(SessionRowView, …)`，本仓库用 `jsx` 自建运行时，不是 JSX 编译产物）。
 */
function jsxTagProps(scopeNode, tagText) {
  const found = []
  walk(scopeNode, (node) => {
    if (!ts.isCallExpression(node)) return
    const callee = node.expression
    if (!ts.isIdentifier(callee) || callee.text !== 'jsx') return
    const tag = node.arguments[0]
    const tagName =
      tag === undefined
        ? undefined
        : ts.isStringLiteral(tag)
          ? tag.text
          : ts.isIdentifier(tag)
            ? tag.text
            : undefined
    if (tagName !== tagText) return
    const props = node.arguments[1]
    if (props !== undefined && ts.isObjectLiteralExpression(props)) found.push({ call: node, props })
  })
  return found
}

/**
 * 全文件里**身份可追溯**到 `topZoneInputOf(...)` 的局部变量名集合。
 *
 * - 直接派生：`const topZone = topZoneInputOf(state)` 或
 *   `const topZone = useMemo(() => topZoneInputOf(state), […])`（子树含该调用即可）；
 * - 一层层标识符中转：`const zone = topZone` ⇒ `zone` 也算（不动点传播）。
 *
 * 因此「把第 2 实参换成 `undefined` 或某个无关标识符」会**立刻**不满足身份要求，
 * 而「改名 / 中转 / 就地调用真实投影」仍然通过。
 */
function topZoneInputAliases(sourceFile) {
  const candidates = []
  walk(sourceFile, (node) => {
    if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || node.initializer === undefined) return
    candidates.push({ name: node.name.text, init: node.initializer })
  })

  const aliases = new Set()
  for (const candidate of candidates) {
    if (callExpressionsOf(candidate.init, 'topZoneInputOf').length > 0) aliases.add(candidate.name)
  }
  let changed = true
  while (changed) {
    changed = false
    for (const candidate of candidates) {
      if (aliases.has(candidate.name)) continue
      if (ts.isIdentifier(candidate.init) && aliases.has(candidate.init.text)) {
        aliases.add(candidate.name)
        changed = true
      }
    }
  }
  return aliases
}

/** 实参身份判定：标识符 / 属性访问根标识符命中别名集合，或**就地**调用真实投影。 */
function isTopZoneInputIdentity(node, aliases) {
  if (ts.isIdentifier(node)) return aliases.has(node.text)
  if (ts.isPropertyAccessExpression(node)) {
    let root = node.expression
    while (ts.isPropertyAccessExpression(root)) root = root.expression
    return ts.isIdentifier(root) && aliases.has(root.text)
  }
  if (ts.isCallExpression(node)) {
    const callee = node.expression
    const name = ts.isIdentifier(callee)
      ? callee.text
      : ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : undefined
    return name === 'topZoneInputOf'
  }
  return false
}

/** 从某个节点向上找最近的 `const <name> = …` 声明名（用于「算了但没传」检查）。 */
function containingVariableName(node) {
  let current = node
  while (current !== undefined) {
    if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) return current.name.text
    current = current.parent
  }
  return undefined
}

/** props 对象子树里是否出现某个标识符。 */
function propsReferenceName(propsNode, name) {
  let ok = false
  walk(propsNode, (node) => {
    if (ts.isIdentifier(node) && node.text === name) ok = true
  })
  return ok
}

const sidebar = parse(SIDEBAR_PATH)
const treeModel = parse(TREE_MODEL_PATH)

// ── 1–3：`dragHandlersFor` 的签名与内部双保险 ────────────────────────────────

test('T13/接线: `dragHandlersFor` 有恰好 3 个形参，第 3 个是 `draggable`（默认 true）', () => {
  const declarations = functionLikeDeclarations(sidebar.sourceFile)
  const drag = declarations.get('dragHandlersFor')
  assert.ok(drag !== undefined, '`sidebar.tsx` 必须声明 `dragHandlersFor`（拖拽接线的唯一工厂）')

  assert.deepEqual(
    paramNames(drag.params),
    ['row', 'scope', 'draggable'],
    '★ 形参恒为 (row, scope, draggable) —— 第 3 个是 T11 新增的「本行能否被拖」开关',
  )
  const third = drag.params[2]
  assert.ok(third.initializer !== undefined, '第 3 参必须有默认值（否则 worktree/project 调用点会报错）')
  assert.equal(normalizeWs(third.initializer.getText()), 'true', '★ 默认值恒为 `true`（容器行照常可拖，零回归）')
})

test('T13/接线: `draggable` 被真正带进返回值（参数不是摆设）', () => {
  const drag = functionLikeDeclarations(sidebar.sourceFile).get('dragHandlersFor')
  const returns = []
  walk(drag.node, (node) => {
    if (ts.isReturnStatement(node) && node.expression !== undefined) returns.push(node.expression)
  })
  const handlerObject = returns.find(
    (expr) => ts.isObjectLiteralExpression(expr) && propertyNames(expr).includes('onDragStart'),
  )
  assert.ok(handlerObject !== undefined, '`dragHandlersFor` 必须返回一个含 `onDragStart` 的处理器对象')
  assert.ok(
    propertyNames(handlerObject).includes('draggable'),
    '★ 返回值必须含 `draggable` 属性 —— 否则渲染层拿不到该开关（`draggable: false` 不生效）',
  )
})

test('T13/接线: `onDragStart` 里 `if (!draggable) return`（伪造 dragstart 也不进拖拽态）', () => {
  const drag = functionLikeDeclarations(sidebar.sourceFile).get('dragHandlersFor')
  let guard = false
  walk(drag.node, (node) => {
    if (!ts.isIfStatement(node)) return
    const condition = node.expression.getText().replace(/\s+/g, '')
    const then = node.thenStatement.getText().replace(/\s+/g, '')
    if (condition === '!draggable' && then.startsWith('return')) guard = true
  })
  assert.ok(guard, '★ `onDragStart` 必须有 `if (!draggable) return` 守卫（双保险，与 T11 注释一致）')
})

// ── 4–6：三个调用点的实参形状 ──────────────────────────────────────────────

test('T13/接线: 全文件恰好 3 个 `dragHandlersFor(...)` 调用（session / worktree / project）', () => {
  const calls = callExpressionsOf(sidebar.sourceFile, 'dragHandlersFor')
  assert.equal(calls.length, 3, '★ 恰好 3 个调用点（新增/删除调用点都应被人工确认）')
})

test('T13/接线[2026-10-22 起]: **session 行**的调用传入 `!isSessionDragLocked(row, topZone)` 作为第 3 实参', () => {
  const calls = callExpressionsOf(sidebar.sourceFile, 'dragHandlersFor')
  const sessionCalls = calls.filter((call) => {
    const scope = call.arguments[1]
    if (scope === undefined || !ts.isObjectLiteralExpression(scope)) return false
    const kind = propertyValue(scope, 'kind')
    return kind !== undefined && ts.isStringLiteral(kind) && kind.text === 'session'
  })
  assert.equal(sessionCalls.length, 1, '★ 恰好一个 session 行调用（`kind: \'session\'` 的对象字面量作第 2 参）')

  const call = sessionCalls[0]
  // ★ M7 捕获点：必须**有**第 3 个实参。
  assert.equal(
    call.arguments.length,
    3,
    '★ M7：session 行调用必须传第 3 个实参（删掉它 ⇒ 运行中的会话又变成可拖动）',
  )
  const third = call.arguments[2]
  // ★ M8 捕获点：实参必须是共享的 `!isSessionDragLocked(...)`，不能是别的判据。
  // 2026-10-22（DR5）：拖拽锁 = 运行中 ∪ 当前空白占位行 ⇒ 判据改由 `isSessionDragLocked`
  // 承担（它内部仍调用唯一的 `isTopZoneRunningSession`，见下一用例）。如果这里退回成
  // 单写 `!isTopZoneRunningSession(...)`，当前空白占位行（「新会话」行）就又能起拖，
  // 而它被渲染期钉在容器最前 ⇒ 用户拖完必然弹回。
  // 判据走 AST 语义（忽略空白 / 格式化 / 实参写法），但**不接受**任何本地复刻的等价判据。
  assert.ok(
    isNegatedSharedCriteria(third),
    `★ M8：第 3 实参必须是 \`!isSessionDragLocked(<session>, <topZone>)\`（共享判据，2 实参），实际：${normalizeWs(third.getText())}`,
  )
  const operand = third.operand
  assert.equal(
    operand.arguments.length,
    2,
    '★ 该判据必须收到 (row, topZone) 两个实参（缺 topZone ⇒ 只认裸 running，聚合口径失效）',
  )
  // 第一个实参必须引用当前渲染行（允许 `row` / `props.row` 等写法，只要求它最终读的是 `row`）。
  assert.ok(
    /\brow\b/.test(normalizeWs(operand.arguments[0].getText())),
    `第一实参必须引用当前渲染行 \`row\`，实际：${normalizeWs(operand.arguments[0].getText())}`,
  )
  // ★ P2(b) 捕获点：第二个实参**必须身份可追溯**到真实顶部区投影 `topZoneInputOf(...)`。
  // 旧断言只要求「非空标识符」⇒ `!isTopZoneRunningSession(row, undefined)` 与
  // `!isTopZoneRunningSession(row, someOtherZone)` 都能通过（T14b 实测），本轮收紧。
  const topZoneAliases = topZoneInputAliases(sidebar.sourceFile)
  assert.ok(
    topZoneAliases.size >= 1,
    '★ `sidebar.tsx` 必须存在由 `topZoneInputOf(...)` 派生的顶部区输入（运行时置顶的唯一合法来源）',
  )
  const second = operand.arguments[1]
  assert.ok(
    isTopZoneInputIdentity(second, topZoneAliases),
    `★ P2(b)：第 2 实参必须是 \`topZoneInputOf(...)\` 的产物（或其标识符中转），` +
      `不得写死 \`undefined\` / 换成无关来源。实际：${normalizeWs(second.getText())}；` +
      `可追溯别名 = ${JSON.stringify([...topZoneAliases].sort())}`,
  )
})

test('T13/接线: worktree / project 行的调用**不传**第 3 实参（容器行照常可拖）', () => {
  const calls = callExpressionsOf(sidebar.sourceFile, 'dragHandlersFor')
  const nonSession = calls.filter((call) => {
    const scope = call.arguments[1]
    if (scope === undefined || !ts.isObjectLiteralExpression(scope)) return true
    const kind = propertyValue(scope, 'kind')
    return !(kind !== undefined && ts.isStringLiteral(kind) && kind.text === 'session')
  })
  assert.equal(nonSession.length, 2, '★ 除 session 外恰好 2 个调用（worktree / project）')
  for (const call of nonSession) {
    assert.equal(
      call.arguments.length,
      2,
      `★ 容器行调用必须**不传** draggable（否则容器行会被静默改成不可拖），实际：${call.getText()}`,
    )
  }
})

// ── 7–8：判据同源（结构性事实） ─────────────────────────────────────────────

test('T13/接线: `isSessionDragLocked` 从 `./tree-model.js` import（用的是共享实现）', () => {
  const imported = new Set()
  walk(sidebar.sourceFile, (node) => {
    if (!ts.isImportDeclaration(node)) return
    const specifier = node.moduleSpecifier
    if (!ts.isStringLiteral(specifier) || specifier.text !== './tree-model.js') return
    const bindings = node.importClause?.namedBindings
    if (bindings === undefined || !ts.isNamedImports(bindings)) return
    for (const element of bindings.elements) imported.add(element.name.text)
  })
  assert.ok(
    imported.has('isSessionDragLocked'),
    '★ 必须从 `./tree-model.js` import `isSessionDragLocked`（不得本地复刻一份拖拽判据）',
  )
  assert.equal(
    imported.has('isTopZoneRunningSession'),
    false,
    '★ `sidebar.tsx` 不得绕过 `isSessionDragLocked` 直接判「运行中」（那会让空白占位行恢复可拖、拖完弹回）',
  )
})

test('T13/接线[2026-10-22 起]: 拖拽锁判据只有一份声明（且在内部复用唯一的「运行中」判据）', () => {
  // ① 全 `src/` 里 `isTopZoneRunningSession` 的函数声明**恰好一处**。
  const sourceFiles = readdirSync(SRC_DIR).filter((name) => /\.tsx?$/.test(name))
  const declarations = []
  for (const name of sourceFiles) {
    const parsed = parse(path.join(SRC_DIR, name))
    for (const [declName, decl] of functionLikeDeclarations(parsed.sourceFile)) {
      if (declName === 'isTopZoneRunningSession') declarations.push({ file: name, decl })
    }
  }
  assert.deepEqual(
    declarations.map((entry) => entry.file),
    ['tree-model.ts'],
    '★ `isTopZoneRunningSession` 在 `src/` 里只能有**一份**实现（唯一判据来源）',
  )
  const shared = declarations[0].decl
  const declarationText = normalizeWs(shared.node.getText())
  assert.ok(
    /(^|\s)export(\s|\b)/.test(declarationText) || declarationText.startsWith('export'),
    '★ 该唯一实现必须**导出**（否则 `sidebar.tsx` 不可能复用同一实现）',
  )

  // ② 它被 `tree-model.ts` 的 `topZoneSessionKeys`（置顶判据）调用。
  const topZoneFn = functionLikeDeclarations(treeModel.sourceFile).get('topZoneSessionKeys')
  assert.ok(topZoneFn !== undefined, '`tree-model.ts` 必须声明 `topZoneSessionKeys`')
  assert.ok(
    callExpressionsOf(topZoneFn.node, 'isTopZoneRunningSession').length >= 1,
    '★ 置顶判据（`topZoneSessionKeys`）必须调用同一个 `isTopZoneRunningSession`',
  )

  // ③ `isSessionDragLocked`（拖拽锁）在 `src/` 里**恰好一份**声明，位于 `tree-model.ts` 且导出。
  const lockDeclarations = []
  const lockCalls = []
  for (const name of sourceFiles) {
    const parsed = parse(path.join(SRC_DIR, name))
    for (const [declName, decl] of functionLikeDeclarations(parsed.sourceFile)) {
      if (declName === 'isSessionDragLocked') lockDeclarations.push({ file: name, decl })
    }
    lockCalls.push({ file: name, count: callExpressionsOf(parsed.sourceFile, 'isSessionDragLocked').length })
  }
  assert.deepEqual(
    lockDeclarations.map((entry) => entry.file),
    ['tree-model.ts'],
    '★ `isSessionDragLocked` 在 `src/` 里只能有**一份**实现',
  )
  const lockDeclaration = normalizeWs(lockDeclarations[0].decl.node.getText())
  assert.ok(
    /(^|\s)export(\s|\b)/.test(lockDeclaration) || lockDeclaration.startsWith('export'),
    '★ 拖拽锁判据必须**导出**（否则 `sidebar.tsx` 不可能复用同一实现）',
  )
  // 它内部**必须**调用唯一的 `isTopZoneRunningSession`（而不是自己再写一遍 running 判据）。
  assert.ok(
    callExpressionsOf(lockDeclarations[0].decl.node, 'isTopZoneRunningSession').length >= 1,
    '★ 拖拽锁判据内部必须复用 `isTopZoneRunningSession`（运行中口径的唯一实现）',
  )

  // ④ `sidebar.tsx` 的 session 拖拽接线调用的是 `isSessionDragLocked`（由上面的实参断言钉死形式）。
  const sidebarLockCalls = lockCalls.find((entry) => entry.file === 'sidebar.tsx')
  assert.ok(
    sidebarLockCalls !== undefined && sidebarLockCalls.count >= 1,
    '★ 不可拖判据（session 拖拽接线）必须调用共享的 `isSessionDragLocked`',
  )
})

// ── 9–11：P2 下游接线（T14b 实测的漏网变异） ────────────────────────────────

test('T13/接线[P2]: 会话行 / 容器行都把 `drag.draggable` 接到 DOM `draggable` prop 上', () => {
  const declarations = functionLikeDeclarations(sidebar.sourceFile)

  // 2026-11-14：会话行 memo 化后，渲染体在 `SessionRowViewInner`（`SessionRowView = memo(…)`）。
  for (const viewName of ['SessionRowViewInner', 'ContainerRowView']) {
    const view = declarations.get(viewName)
    assert.ok(view !== undefined, `\`sidebar.tsx\` 必须声明 \`${viewName}\``)

    const alias = dragAliasIn(view.node)
    assert.ok(
      alias !== undefined,
      `★ \`${viewName}\` 必须有 \`const <alias> = props.drag\`（拖拽接线从 props 取）`,
    )

    const divProps = jsxTagProps(view.node, 'div')
    const withDraggable = divProps.filter((entry) => propertyValue(entry.props, 'draggable') !== undefined)
    assert.ok(
      withDraggable.length >= 1,
      `★ ${viewName}：渲染的 \`jsx('div', …)\` 必须带 \`draggable\` prop —— ` +
        '删掉它 ⇒ `dragHandlersFor` 的 `draggable: false` 被静默忽略（T14b 实测漏网变异）',
    )

    for (const entry of withDraggable) {
      const value = propertyValue(entry.props, 'draggable')
      assert.ok(
        referencesDragDraggable(value, alias),
        `★ P2(a)：${viewName} 的 \`draggable\` prop 必须源自局部 \`${alias}\` 的 \`.draggable\`，` +
          `不得写死 \`true\`/\`false\` 或换成无关表达式（T14b 实测：写死 \`true\` 时两套件全绿）。` +
          `实际：${normalizeWs(value.getText())}`,
      )
    }
  }
})

test('T13/接线[P2]: session 行 `dragHandlersFor(...)` 的结果真的流向 `jsx(SessionRowView, …)`', () => {
  const calls = callExpressionsOf(sidebar.sourceFile, 'dragHandlersFor')
  const sessionCall = calls.find((call) => {
    const scope = call.arguments[1]
    if (scope === undefined || !ts.isObjectLiteralExpression(scope)) return false
    const kind = propertyValue(scope, 'kind')
    return kind !== undefined && ts.isStringLiteral(kind) && kind.text === 'session'
  })
  assert.ok(sessionCall !== undefined, '★ 必须存在 session 行的 `dragHandlersFor(...)` 调用')

  const localName = containingVariableName(sessionCall)
  if (localName === undefined) return // 就地传参（无中转变量）⇒ 由调用点断言覆盖

  const sessionViewProps = jsxTagProps(sidebar.sourceFile, 'SessionRowView')
  assert.ok(
    sessionViewProps.some((entry) => propsReferenceName(entry.props, localName)),
    `★ 接线连通：\`${localName}\`（session 行拖拽处理器）必须被传进 \`jsx(SessionRowView, …)\` 的 props —— ` +
      '否则「算了但没传」，运行中的会话又变成可拖',
  )
})

// ────────────────────────────────────────────────────────────────────────────
// T16 源码级契约：**侧栏菜单裸 key 缺陷**（2026-09-23）
// ────────────────────────────────────────────────────────────────────────────
//
// ## 失效模式（用户可见）
//
// 用户报告「右键所有菜单都变成英文 key 了，没有正确显示中文」：菜单项显示
// `menu.newSession` / `worktree.create` 这类**裸 key**。
//
// ## 为什么本文件必须覆盖它
//
// 缺陷出在两个 `.tsx` 的**接线**上，而 `.tsx` 不进 `lib/`、`node --test` 执行不到：
//
// | 层 | 位置 | 失效模式 |
// |---|---|---|
// | 因 | `src/client.tsx` | 用一次性 `ctx.get('locale')` 探测宿主 locale 服务并**静默跳过**词典注册；而 DSH web 启动**并发创建所有 client entry**（`Promise.all(loader.create(...))`），locale 插件自身还要等 `slots`/`remote`/`settingsScope` ⇒ 本插件 apply 可能先跑 ⇒ 注册被跳过 |
// | 果 | `src/sidebar.tsx` | entry 声明了 `locale` ⇒ 组件**一定**拿到 seat `t`（`standardKit` → `localeSeat`），`FALLBACK_T` 永远走不到 ⇒ seat 在空命名空间里返回 key 本身 ⇒ 满屏裸 key |
//
// 纯逻辑那一半（seat 解不出时回落内置中文）由 `test/locales.test.mjs` 覆盖；
// 本段只钉**接线**：注册必须等 `locale` 出现、取词必须过兜底包装。

const CLIENT_PATH = path.join(SRC_DIR, 'client.tsx')

/** 读并解析 `src/client.tsx`（`.tsx` ⇒ `ScriptKind.TSX`）。 */
const client = parse(CLIENT_PATH)

/** 调用表达式的「被调用名」（identifier 或 `x.<name>` 属性访问）。 */
function calleeNameOf(expression) {
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text
  return undefined
}

/** 收集「第一个实参是 `LOCALE_NS`」的 `.register(...)` 调用（= 词典注册，非槽位注册）。 */
function dictionaryRegistrationCalls(sourceFile) {
  return callExpressionsOf(sourceFile, 'register').filter((call) => {
    const ns = call.arguments[0]
    return ns !== undefined && normalizeWs(ns.getText()) === 'LOCALE_NS'
  })
}

/** 该节点是否位于某个函数体内部（用于断言「注册写在回调里」）。 */
function isInsideFunction(node) {
  let current = node.parent
  while (current !== undefined) {
    if (ts.isFunctionLike(current)) return true
    current = current.parent
  }
  return false
}

test('T16/取词: `client.tsx` 的词典注册必须写在 `ctx.inject([… locale …], cb)` 的回调里', () => {
  const registrations = dictionaryRegistrationCalls(client.sourceFile)
  assert.ok(
    registrations.length >= 1,
    '★ `client.tsx` 必须注册词典（`locale.register(LOCALE_NS, …)`）—— 否则 seat 绑定到空命名空间，' +
      '侧栏每个取词点都渲染裸 key',
  )

  const localeInjects = callExpressionsOf(client.sourceFile, 'inject').filter((call) => {
    const deps = call.arguments[0]
    return (
      deps !== undefined &&
      ts.isArrayLiteralExpression(deps) &&
      deps.elements.some((element) => ts.isStringLiteral(element) && element.text === 'locale')
    )
  })
  assert.ok(
    localeInjects.length >= 1,
    '★ `client.tsx` 必须用 `ctx.inject([… "locale" …], cb)` **等 locale 服务出现**再注册词典。' +
      '一次性 `ctx.get(\'locale\')` 探测会因 entry 并发启动（`Promise.all(loader.create(...))`）' +
      '而静默跳过注册 —— 这正是 2026-09-23 菜单裸 key 的根因',
  )

  for (const registration of registrations) {
    const insideLocaleInject = localeInjects.some((call) => {
      const callback = call.arguments[1]
      if (callback === undefined) return false
      if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) return false
      let contained = false
      walk(callback.body, (node) => {
        if (node === registration) contained = true
      })
      return contained
    })
    assert.ok(
      insideLocaleInject,
      '★ 词典注册必须**整体**位于 `ctx.inject([… "locale" …], cb)` 的回调体内：' +
        `实际写法在回调之外（${normalizeWs(registration.getText())}）⇒ locale 后到时不会补注册`,
    )
  }

  // 反向：`serviceOf(ctx, 'locale')` 只允许出现在函数体内（inject 回调 / 工厂），
  // 不允许在 `apply` 顶层一次性探测 —— 顶层探测就是 2026-09-23 缺陷的原始写法。
  const localeProbes = callExpressionsOf(client.sourceFile, 'serviceOf').filter((call) => {
    const name = call.arguments[1]
    return name !== undefined && ts.isStringLiteral(name) && name.text === 'locale'
  })
  for (const probe of localeProbes) {
    assert.ok(
      isInsideFunction(probe),
      '★ 不允许在 `apply` 顶层一次性探测 `serviceOf(ctx, \'locale\')`（时机不可靠）：' +
        `实际：${normalizeWs(probe.getText())}`,
    )
  }
})

test('T16/取词: `client.tsx` 的 entry `inject` 数组仍不得包含 `locale`（D9 白屏保护）', () => {
  let injectElements
  walk(client.sourceFile, (node) => {
    if (!ts.isVariableStatement(node)) return
    const isExported = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) === true
    if (!isExported) return
    for (const declaration of node.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== 'inject') continue
      const initializer = declaration.initializer
      if (initializer !== undefined && ts.isArrayLiteralExpression(initializer)) injectElements = initializer.elements
    }
  })
  assert.ok(injectElements !== undefined, '★ `client.tsx` 必须导出 `inject` 数组（硬依赖服务清单）')
  const names = injectElements.map((element) => (ts.isStringLiteral(element) ? element.text : normalizeWs(element.getText())))
  assert.ok(names.includes('slots'), '★ `inject` 必须包含 `slots`（没有它连槽位都注册不了）')
  assert.ok(
    !names.includes('locale'),
    '★ `inject` 里**绝不能**写 `locale`（D9）：locale 缺席时 entry 永久 pending ⇒ ' +
      '`assertEntriesActive` 硬失败 ⇒ 整页白屏。等服务的正确姿势是 `ctx.inject([\'locale\'], …)`',
  )
})

test('T16/取词: entry 注册仍声明 `locale: LOCALE_NS`（否则拿不到 seat，语言切换也不重渲染）', () => {
  const declarations = []
  walk(client.sourceFile, (node) => {
    if (!ts.isPropertyAssignment(node)) return
    const key = ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : undefined
    if (key !== 'locale') return
    declarations.push(normalizeWs(node.initializer.getText()))
  })
  assert.ok(
    declarations.includes('LOCALE_NS'),
    `★ entry 注册对象必须带 \`locale: LOCALE_NS\`；实际：${JSON.stringify(declarations)}`,
  )
})

test('T16/取词: `sidebar.tsx` 的 seat `t` 必须过 `createSeatT` 兜底（解不出就回落内置中文）', () => {
  const importSpecifiers = []
  walk(sidebar.sourceFile, (node) => {
    if (!ts.isImportDeclaration(node)) return
    const from = node.moduleSpecifier
    if (!ts.isStringLiteral(from) || from.text !== './locales.js') return
    const bindings = node.importClause?.namedBindings
    if (bindings === undefined || !ts.isNamedImports(bindings)) return
    for (const element of bindings.elements) importSpecifiers.push(element.name.text)
  })
  assert.ok(
    importSpecifiers.includes('createSeatT'),
    `★ \`sidebar.tsx\` 必须从 \`./locales.js\` import \`createSeatT\`；实际：${JSON.stringify(importSpecifiers)}`,
  )

  const inner = functionLikeDeclarations(sidebar.sourceFile).get('SidebarBrowserInner')
  assert.ok(inner !== undefined, '★ `sidebar.tsx` 必须声明 `SidebarBrowserInner`')

  const tDeclaration = directVariableDeclarations(inner.node).find(
    (declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === 't',
  )
  assert.ok(tDeclaration?.initializer !== undefined, '★ `SidebarBrowserInner` 必须声明局部 `t`')

  const initializer = tDeclaration.initializer
  const calls = []
  walk(initializer, (node) => {
    if (ts.isCallExpression(node) && calleeNameOf(node.expression) === 'createSeatT') calls.push(node)
  })
  assert.ok(
    calls.length >= 1,
    '★ 局部 `t` 必须由 `createSeatT(…)` 产出 —— 否则 seat 在空命名空间下会把 key 当文案渲染：' +
      `实际：${normalizeWs(initializer.getText())}`,
  )

  // 实参身份：必须能追溯到宿主 seat `props.t`（允许 `const seat = props.t` 这类**局部别名**
  // —— 按 AST 追溯，改名 / 中转一层都仍然通过；不接受「随便一个取词函数」）。
  const referencesPropsT = (node) => {
    let found = false
    walk(node, (child) => {
      if (!ts.isPropertyAccessExpression(child)) return
      if (child.name.text !== 't') return
      if (ts.isIdentifier(child.expression) && child.expression.text === 'props') found = true
    })
    return found
  }
  const seatAliases = new Set(
    directVariableDeclarations(inner.node)
      .filter((declaration) => declaration.initializer !== undefined && referencesPropsT(declaration.initializer))
      .map((declaration) => normalizeWs(declaration.name.getText())),
  )

  const feedsSeat = calls.some((call) => {
    const seat = call.arguments[0]
    if (seat === undefined) return false
    if (referencesPropsT(seat)) return true
    // 剥掉 `as T` / 括号等**不改变值**的包装，再判它是不是 `props.t` 的局部别名。
    let inner = seat
    while (ts.isAsExpression(inner) || ts.isParenthesizedExpression(inner) || ts.isTypeAssertionExpression(inner)) {
      inner = inner.expression
    }
    return ts.isIdentifier(inner) && seatAliases.has(inner.text)
  })
  assert.ok(
    feedsSeat,
    '★ `createSeatT(…)` 的实参必须是宿主 seat `props.t`（允许 `const seat = props.t` 中转一层）：' +
      `实际：${calls.map((call) => normalizeWs(call.getText())).join(' | ')}`,
  )

  let keepsFallback = false
  walk(initializer, (node) => {
    if (ts.isIdentifier(node) && node.text === 'FALLBACK_T') keepsFallback = true
  })
  assert.ok(
    keepsFallback,
    '★ `props.t` 缺席时的 `FALLBACK_T`（内置中文）分支必须保留 —— 它是「连 seat 都没有」时的唯一退路',
  )
})

// ── 残余保护局限（如实声明，非断言） ────────────────────────────────────────
//
// 本文件是**结构性契约测试**（AST 级），不是行为测试。它证明「源码里写了正确的判据与
// 实参、并接到了正确的 DOM prop 上」，**不证明**「浏览器里运行中的会话真的拖不动」。
// 仍未覆盖的场景（需真人 GUI 复验）：
// 1. React 是否真的把 `draggable={false}` 落到 DOM（`jsx` 是自建运行时，非 JSX 编译产物）；
// 2. 「仍接受落点」的交互手感（`onDragOver` / `onDrop` 不读 `draggable`，仅由源码审查支持）；
// 3. `drag` 再经一层中转（`const canDrag = drag.draggable`）的等价写法会被第 9 条**误报**
//    （保守方向：宁可误报，不漏报）；
// 4. 渲染期置顶与拖拽禁用是否真的作用于**同一批行**（两者共用 `isTopZoneRunningSession`，
//    但「同一批」的最终判据仍以 `buildRows` 真实输出 + 真机拖拽为准）。

// ────────────────────────────────────────────────────────────────────────────
// 运行中任务高亮接线（2026-10-20 T-4，设计 §9.2 C1–C10）
//
// 为什么是 AST：`src/sidebar.tsx` 不进 `lib/`，`node --test` 执行不到；
// `test/render-smoke.test.mjs` 是 SSR、不跑 effect、也渲染不出容器行。
// 因此「图标着色真的接上了 `hasRunningTasks` 判据」「签名真的进了 220ms 防抖依赖」
// 这两类承诺只能对**真实源码做结构断言**。断言刻意不锁字面格式（空白 / 换行 / 引号
// 由 `normalizeWs` 与 AST 语义吸收），只锁行为接线。
// ────────────────────────────────────────────────────────────────────────────

/** 取 `ContainerRowView` 的声明（不存在 ⇒ 直接失败）。 */
function containerRowViewDecl() {
  const view = functionLikeDeclarations(sidebar.sourceFile).get('ContainerRowView')
  assert.ok(view !== undefined, '`sidebar.tsx` 必须声明 `ContainerRowView`（容器行高亮的唯一落点）')
  return view
}

/** 收集子树里所有满足谓词的节点。 */
function findAll(node, predicate) {
  const out = []
  walk(node, (child) => {
    if (predicate(child)) out.push(child)
  })
  return out
}

/** 子树里所有名为 `name` 的 `PropertyAssignment`。 */
function propertyAssignmentsNamed(node, name) {
  return findAll(
    node,
    (child) =>
      ts.isPropertyAssignment(child) &&
      (ts.isIdentifier(child.name) || ts.isStringLiteral(child.name)) &&
      child.name.text === name,
  )
}

/** 子树里是否出现某个标识符。 */
function subtreeHasIdentifier(node, name) {
  return findAll(node, (child) => ts.isIdentifier(child) && child.text === name).length > 0
}

/** 子树里是否包含指定节点（含自身）。 */
function subtreeContains(root, target) {
  let found = false
  walk(root, (child) => {
    if (child === target) found = true
  })
  return found
}

/** 文本归一化后是否等于某个判据标识符（允许 `row` / `props.row` 这类前缀）。 */
function isRunningHighlightRef(node) {
  return /(^|\.)runningHighlight$/.test(normalizeWs(node.getText()))
}

/**
 * `ContainerRowView` 的 lead 图标 span 的 props 对象。
 *
 * 识别方式：`key: 'lead'`，或 `children` 直接就是局部 `lead` 变量 ——
 * 因此改 `key` 常量的写法不影响判定。
 */
function leadSpanProps(view) {
  const spans = jsxTagProps(view.node, 'span')
  const lead = spans.find((entry) => {
    const key = propertyValue(entry.props, 'key')
    if (key !== undefined && ts.isStringLiteral(key) && key.text === 'lead') return true
    const children = propertyValue(entry.props, 'children')
    return children !== undefined && ts.isIdentifier(children) && children.text === 'lead'
  })
  assert.ok(
    lead !== undefined,
    '★ `ContainerRowView` 必须有 `jsx(\'span\', { key: \'lead\', children: lead, … })`（图标着色唯一落点）',
  )
  return lead.props
}

/** 找到 lead span 的 style 对象字面量。 */
function leadSpanStyle(view) {
  const style = propertyValue(leadSpanProps(view), 'style')
  assert.ok(style !== undefined && ts.isObjectLiteralExpression(style), '★ lead span 必须有 style 对象字面量')
  return style
}

test('运行中高亮/接线:C1 lead span 的 color = state-business-primary（fallback #4176e6）', () => {
  const style = leadSpanStyle(containerRowViewDecl())
  const colors = propertyAssignmentsNamed(style, 'color')
  assert.equal(colors.length, 1, '★ lead span style 必须恰好有一处 color（高亮色唯一）')
  const value = colors[0].initializer
  assert.ok(ts.isStringLiteral(value), `★ color 必须是字符串字面量，实际：${normalizeWs(value.getText())}`)
  assert.match(
    value.text,
    /--dsw-alias-state-business-primary/,
    `★ 必须用品牌蓝 token \`--dsw-alias-state-business-primary\`（不是 brand-primary），实际：${value.text}`,
  )
  assert.match(value.text, /#4176e6/, `★ 必须有 \`#4176e6\` 明色兜底，实际：${value.text}`)
  assert.doesNotMatch(
    value.text,
    /--dsw-alias-brand-primary/,
    '★ 不得用 `--dsw-alias-brand-primary`（它是近黑/近白中性色，不是品牌蓝）',
  )
})

test('运行中高亮/接线:C2 lead span 的 filter = drop-shadow(0 0 2px state-business-primary)', () => {
  const style = leadSpanStyle(containerRowViewDecl())
  const filters = propertyAssignmentsNamed(style, 'filter')
  assert.equal(filters.length, 1, '★ lead span style 必须恰好有一处 filter（光晕唯一）')
  const value = filters[0].initializer
  assert.ok(ts.isStringLiteral(value), `★ filter 必须是字符串字面量，实际：${normalizeWs(value.getText())}`)
  assert.equal(
    normalizeWs(value.text),
    'drop-shadow(0 0 2px var(--dsw-alias-state-business-primary, #4176e6))',
    '★ 光晕固定 `drop-shadow(0 0 2px <同色>)`（半径 2px，颜色与高亮色同源）',
  )
})

test('运行中高亮/接线:C3 判据 = `row.kind === \'history\' ? false : row.hasRunningTasks === true`', () => {
  const view = containerRowViewDecl()
  const declaration = directVariableDeclarations(view.node).find(
    (entry) => ts.isIdentifier(entry.name) && entry.name.text === 'runningHighlight',
  )
  assert.ok(declaration?.initializer !== undefined, '★ `ContainerRowView` 必须有 `const runningHighlight = …`（唯一判据）')

  const init = declaration.initializer
  assert.ok(ts.isConditionalExpression(init), '★ 判据必须是条件表达式（先排除 history）')
  assert.equal(
    normalizeWs(init.condition.getText()),
    "row.kind === 'history'",
    "★ 必须先用 `row.kind === 'history'` 排除（history 没有该字段，且 clock 永不高亮）",
  )

  const whenFalse = init.whenFalse
  assert.ok(ts.isBinaryExpression(whenFalse), '★ whenFalse 必须是 `row.hasRunningTasks === true` 比较表达式')
  assert.equal(
    whenFalse.operatorToken.kind,
    ts.SyntaxKind.EqualsEqualsEqualsToken,
    '★ 必须用 `===`（真值判断会把 undefined 误亮；旧 lib 未重启时必须是「不认识 ⇒ 不高亮」）',
  )
  assert.equal(normalizeWs(whenFalse.left.getText()), 'row.hasRunningTasks', '★ 判据必须读 `row.hasRunningTasks`')
  assert.equal(normalizeWs(whenFalse.right.getText()), 'true', '★ 必须与 `true` 严格比较')
})

test('运行中高亮/接线:C4 行根 `data-running` 由 runningHighlight 条件驱动（不是写死）', () => {
  const view = containerRowViewDecl()
  const divs = jsxTagProps(view.node, 'div')
  const root = divs.find((entry) => propertyValue(entry.props, 'data-key') !== undefined)
  assert.ok(root !== undefined, "★ 容器行根必须是 `jsx('div', { 'data-key': row.key, … })`")

  const runningProps = propertyAssignmentsNamed(root.props, 'data-running')
  assert.equal(runningProps.length, 1, '★ 行根必须恰好有一个 `data-running`（不高亮时不得出现）')
  const prop = runningProps[0]

  // 形态 A（契约 §5.3）：`...(runningHighlight ? { 'data-running': 'true' } : {})`
  let guarded = false
  let conditional
  for (let current = prop.parent; current !== undefined; current = current.parent) {
    if (ts.isConditionalExpression(current)) {
      conditional = current
      break
    }
    if (ts.isCallExpression(current)) break
  }
  if (conditional !== undefined && subtreeContains(conditional.whenTrue, prop) && isRunningHighlightRef(conditional.condition)) {
    guarded = true
  }
  // 形态 B（主代理澄清允许）：`'data-running': runningHighlight ? 'true' : undefined`
  if (!guarded && ts.isConditionalExpression(prop.initializer)) {
    const init = prop.initializer
    if (isRunningHighlightRef(init.condition) && normalizeWs(init.whenTrue.getText()) === "'true'") guarded = true
  }
  assert.ok(
    guarded,
    '★ `data-running` 必须由 runningHighlight 条件驱动（写死属性 ⇒ M1 变异会漏过；' +
      `实际：${normalizeWs(prop.getText())}）`,
  )

  const value = ts.isConditionalExpression(prop.initializer) ? prop.initializer.whenTrue : prop.initializer
  assert.equal(normalizeWs(value.getText()), "'true'", "★ 属性值必须是字符串 `'true'`（不是布尔 true / 'false'）")
})

test('运行中高亮/接线:C5 lead span 的 title 追溯 `t(\'a11y.runningTask\')` 且仅高亮时加', () => {
  const view = containerRowViewDecl()
  const titles = propertyAssignmentsNamed(leadSpanProps(view), 'title')
  assert.equal(titles.length, 1, '★ lead span 必须恰好有一处 title（可访问性文案唯一）')
  const prop = titles[0]

  const calls = findAll(
    prop,
    (node) =>
      ts.isCallExpression(node) &&
      calleeNameOf(node.expression) === 't' &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === 'a11y.runningTask',
  )
  assert.equal(calls.length, 1, '★ title 必须调用 `t(\'a11y.runningTask\')`（key 唯一，文案由 locales 提供）')

  let guard
  for (let current = prop.parent; current !== undefined; current = current.parent) {
    if (ts.isConditionalExpression(current)) {
      guard = current
      break
    }
    if (ts.isCallExpression(current)) break
  }
  if (guard === undefined && ts.isConditionalExpression(prop.initializer)) guard = prop.initializer
  assert.ok(guard !== undefined, '★ title 不得无条件出现（会污染普通行的 tooltip）')
  assert.ok(isRunningHighlightRef(guard.condition), '★ title 必须仅在 runningHighlight 为真时出现')
})

test('运行中高亮/接线:C6 `icon(...)` 调用不携带 style / color 实参（宿主会丢弃）', () => {
  const view = containerRowViewDecl()
  const iconCalls = callExpressionsOf(view.node, 'icon')
  assert.ok(iconCalls.length >= 3, '★ 容器行至少要有 folderOpen/folderClose/branch/clock 四类图标调用之一组')

  for (const call of iconCalls) {
    for (const arg of call.arguments.slice(1)) {
      const bad = findAll(
        arg,
        (node) =>
          ts.isPropertyAssignment(node) &&
          (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
          (node.name.text === 'style' || node.name.text === 'color'),
      )
      assert.equal(
        bad.length,
        0,
        `★ 禁止给 icon() 传 style/color（宿主图标组件只解构 size/className/strokeWidth，其余被丢弃）：${normalizeWs(call.getText())}`,
      )
    }
  }
})

test('运行中高亮/接线:C7 `sidebar.tsx` 从 `./live-state.js` import `runningSignature`', () => {
  let imported = false
  walk(sidebar.sourceFile, (node) => {
    if (!ts.isImportDeclaration(node)) return
    const specifier = node.moduleSpecifier
    if (!ts.isStringLiteral(specifier) || specifier.text !== './live-state.js') return
    const bindings = node.importClause?.namedBindings
    if (bindings === undefined || !ts.isNamedImports(bindings)) return
    if (bindings.elements.some((element) => element.name.text === 'runningSignature')) imported = true
  })
  assert.ok(imported, '★ 必须从 `./live-state.js` import `runningSignature`（共享纯函数，不得本地复刻）')
})

/** 220 ms 防抖重取 effect：回调体里 `setTimeout(..., RELOAD_DEBOUNCE_MS)`。 */
function debounceEffect() {
  const inner = functionLikeDeclarations(sidebar.sourceFile).get('SidebarBrowserInner')
  assert.ok(inner !== undefined, '★ `sidebar.tsx` 必须声明 `SidebarBrowserInner`')
  const effects = callExpressionsOf(inner.node, 'useEffect')
  const found = effects.find((call) => {
    const callback = call.arguments[0]
    if (callback === undefined || (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))) return false
    return findAll(
      callback.body,
      (node) =>
        ts.isCallExpression(node) &&
        calleeNameOf(node.expression) === 'setTimeout' &&
        node.arguments[1] !== undefined &&
        normalizeWs(node.arguments[1].getText()) === 'RELOAD_DEBOUNCE_MS',
    ).length > 0
  })
  assert.ok(found !== undefined, '★ 必须存在「`setTimeout(reload, RELOAD_DEBOUNCE_MS)`」的防抖重取 effect')
  return found
}

/** 由 `runningSignature(sessionStatus)` 派生的局部变量名（不存在 ⇒ undefined）。 */
function runningSignatureValueName() {
  const inner = functionLikeDeclarations(sidebar.sourceFile).get('SidebarBrowserInner')
  assert.ok(inner !== undefined, '★ `sidebar.tsx` 必须声明 `SidebarBrowserInner`')
  const declaration = directVariableDeclarations(inner.node).find(
    (entry) =>
      ts.isIdentifier(entry.name) &&
      entry.initializer !== undefined &&
      callExpressionsOf(entry.initializer, 'runningSignature').some((call) => {
        const arg = call.arguments[0]
        return arg !== undefined && normalizeWs(arg.getText()) === 'sessionStatus'
      }),
  )
  return declaration === undefined ? undefined : declaration.name.text
}

test('运行中高亮/接线:C8 220ms 防抖依赖含 `runningSignature(sessionStatus)` 派生值', () => {
  const name = runningSignatureValueName()
  assert.ok(
    name !== undefined,
    '★ 必须在 `sessionStatus` 旁派生 `const <x> = runningSignature(sessionStatus)`（普通值，不改 hook 数量）',
  )

  const deps = debounceEffect().arguments[1]
  assert.ok(deps !== undefined && ts.isArrayLiteralExpression(deps), '★ 防抖 effect 必须有依赖数组')
  const names = deps.elements.map((element) => normalizeWs(element.getText()))
  assert.ok(names.includes(name), `★ 派生签名值 \`${name}\` 必须在防抖依赖里（否则运行态变化不会快速重取），实际：${names.join(', ')}`)
})

test('运行中高亮/接线:C9 `reload` 的 useCallback 依赖不含派生签名值（30s 轮询不得被重置）', () => {
  const name = runningSignatureValueName()
  assert.ok(name !== undefined, '★ 派生签名值必须存在（本用例与 C8 同一前提）')

  const inner = functionLikeDeclarations(sidebar.sourceFile).get('SidebarBrowserInner')
  const reloadDeclaration = directVariableDeclarations(inner.node).find(
    (entry) => ts.isIdentifier(entry.name) && entry.name.text === 'reload',
  )
  assert.ok(reloadDeclaration?.initializer !== undefined, '★ `SidebarBrowserInner` 必须有局部 `reload`')

  const callback = callExpressionsOf(reloadDeclaration.initializer, 'useCallback')
  assert.equal(callback.length, 1, '★ `reload` 必须由 `useCallback(...)` 产出')
  const deps = callback[0].arguments[1]
  assert.ok(deps !== undefined && ts.isArrayLiteralExpression(deps), '★ `reload` 的 useCallback 必须有依赖数组')
  const names = deps.elements.map((element) => normalizeWs(element.getText()))
  assert.ok(
    !names.includes(name),
    `★ 签名值 \`${name}\` **不得**进 reload 依赖（否则每次状态迁移重建 reload ⇒ 30s 定时器被反复重置）`,
  )
  assert.ok(names.includes('t'), `★ reload 依赖应保持既有形态（含 \`t\`），实际：${names.join(', ')}`)
})

test('运行中高亮/接线:C10 30s 轮询与 focus 强刷仍在（兜底不回归）', () => {
  const intervals = findAll(
    sidebar.sourceFile,
    (node) =>
      ts.isCallExpression(node) &&
      calleeNameOf(node.expression) === 'setInterval' &&
      node.arguments[1] !== undefined &&
      normalizeWs(node.arguments[1].getText()) === 'TREE_REFRESH_MS',
  )
  assert.ok(intervals.length >= 1, '★ 必须保留 `setInterval(reload, TREE_REFRESH_MS)`（30s 兜底轮询）')

  const focusListeners = findAll(
    sidebar.sourceFile,
    (node) =>
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'addEventListener' &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === 'focus',
  )
  assert.ok(focusListeners.length >= 1, '★ 必须保留 `window.addEventListener(\'focus\', …)`（聚焦强刷兜底）')
})

// ────────────────────────────────────────────────────────────────────────────
// T-7 补测（审查报告 F1–F5 / 设计 §9.2 C11–C14、D 表 M8–M12）
//
// 为什么必须补：T-6 独立审查实测，以下**非删除式**回退在 T-4 的 C1–C10 下**全绿**：
//
// | 变异 | 做法 | T-4 套件实测 |
// |---|---|---|
// | F1 | 把 color/filter 移出 `runningHighlight` 条件（所有图标常亮蓝） | 24/24 绿 ⇒ 缺口 |
// | F2 | 行根 style 加 `background` + `borderLeft`（整行着色 + 左侧竖条） | 24/24 绿 ⇒ 缺口 |
// | F3 | `data-running` 改为恒出现（`'true' : 'false'`） | 24/24 绿 ⇒ 缺口 |
// | F5 | 删掉 mount effect 的首拉 `reload()` | 24/24 绿 ⇒ 缺口 |
//
// 因此新增的断言全部锁**条件性 / 禁止项 / 首拉**，而不只是锁「属性存在且值正确」。
// ────────────────────────────────────────────────────────────────────────────

/**
 * 节点是否**只在** `runningHighlight` 为真时生效（T-7 C11 / C13 共用）。
 *
 * 接受契约允许的两种形态：
 * - **条件展开**：`...(runningHighlight ? { color, filter } : {})`
 *   —— 节点是 `whenTrue` 对象字面量里的属性；
 * - **三元值**：`color: runningHighlight ? '…' : undefined`
 *   —— 节点自身的 initializer 是 `runningHighlight` 三元，且 `whenFalse` 必须为空
 *   （`undefined` / `void 0`，即「不高亮时该属性不生效」）。
 *
 * 反向要求：一旦向上遇到判断式就是 `runningHighlight` 的条件表达式，节点**必须**落在
 * `whenTrue` 内；落在 `condition` / `whenFalse` 一律不算。向上遇到 `jsx(...)` 调用即停止，
 * 避免把外层无关条件误当判据（宁可误报也不漏报）。
 */
function isGuardedByRunningHighlight(node) {
  if (ts.isPropertyAssignment(node) && ts.isConditionalExpression(node.initializer)) {
    const init = node.initializer
    if (!isRunningHighlightRef(init.condition)) return false
    return ['undefined', 'void 0'].includes(normalizeWs(init.whenFalse.getText()))
  }
  for (let current = node.parent; current !== undefined; current = current.parent) {
    if (ts.isCallExpression(current)) break
    if (ts.isConditionalExpression(current) && isRunningHighlightRef(current.condition)) {
      return subtreeContains(current.whenTrue, node)
    }
  }
  return false
}

/** 容器行根 `jsx('div', …)`（`data-key` 唯一标识），不存在 ⇒ 直接失败。 */
function containerRowRoot() {
  const view = containerRowViewDecl()
  const root = jsxTagProps(view.node, 'div').find((entry) => propertyValue(entry.props, 'data-key') !== undefined)
  assert.ok(root !== undefined, "★ 容器行根必须是 `jsx('div', { 'data-key': row.key, … })`")
  return root
}

test('运行中高亮/接线:C11 lead span 的 color / filter 只在 runningHighlight 分支内（常亮必须红）', () => {
  const style = leadSpanStyle(containerRowViewDecl())
  for (const key of ['color', 'filter']) {
    const props = propertyAssignmentsNamed(style, key)
    assert.equal(props.length, 1, `★ lead span style 必须恰好有一处 \`${key}\`（高亮值唯一）`)
    assert.ok(
      isGuardedByRunningHighlight(props[0]),
      `★ F1：\`${key}\` 必须写在 \`runningHighlight\` 条件分支内 ` +
        `（\`...(runningHighlight ? { … } : {})\` 或 \`runningHighlight ? … : undefined\`）—— ` +
        `移出条件即「所有图标常亮」且 \`data-running\` / \`title\` 仍只在高亮行出现，视觉信号矛盾。` +
        `实际：${normalizeWs(props[0].getText())}`,
    )
  }
})

test('运行中高亮/接线:C12 容器行根不得整行着色，且子树无状态点 / role=status（AC8 禁止项）', () => {
  const view = containerRowViewDecl()
  const root = containerRowRoot()

  const style = propertyValue(root.props, 'style')
  assert.ok(
    style !== undefined && ts.isObjectLiteralExpression(style),
    '★ 容器行根必须有 style 对象字面量（`...rowStyle(...)` 基线 + 拖拽态透明度）',
  )
  // 整行着色键：行根 style 的**任意层级**都不允许出现（条件展开的嵌套对象也算）。
  // R1（T-6 复核）：除背景/竖条/阴影/文字色外，`border` / `filter` / `textShadow` 语义上
  // 同属「整行描边 / 发光」，一并禁止（共 11 类）。
  for (const key of [
    'background', 'backgroundColor', 'backgroundImage',
    'borderLeft', 'borderColor', 'border',
    'boxShadow', 'textShadow', 'filter',
    'color', 'outline',
  ]) {
    assert.equal(
      propertyAssignmentsNamed(style, key).length,
      0,
      `★ F2：行根 style 不得出现 \`${key}\` —— AC8/RT3 明确「不整行着色、不加左侧竖条、不加阴影」；` +
        '竖条还会与拖拽插入线冲突（设计 §12）。行级视觉只能来自 `...rowStyle(...)` 基线',
    )
  }
  // 状态点 / 徽章：`ContainerRowView` 子树内不得调用 `StatusDot`，也不得有 `role="status"`。
  // （项目行的数字 `sessionCount` 已于 2026-10-21 WSR7 移除，由本文件末的 WSR7 用例单独锁定。）
  assert.equal(
    callExpressionsOf(view.node, 'StatusDot').length,
    0,
    '★ F2：`ContainerRowView` 内不得出现 `StatusDot` —— 用户裁决 RT3 明确「不加状态点」',
  )
  const statusRoles = propertyAssignmentsNamed(view.node, 'role').filter(
    (prop) => ts.isStringLiteral(prop.initializer) && prop.initializer.text === 'status',
  )
  assert.equal(
    statusRoles.length,
    0,
    '★ F2：`ContainerRowView` 子树内不得出现 `role="status"`（同属「状态点」类可访问性装饰，用户未批准）',
  )
})

test('运行中高亮/接线:C13 `data-running` 不高亮时必须**不出现**（`\'false\'` 形态必须红）', () => {
  const root = containerRowRoot()
  const props = propertyAssignmentsNamed(root.props, 'data-running')
  assert.equal(props.length, 1, '★ 行根必须恰好有一个 `data-running`（不得有第二个恒在属性）')
  const prop = props[0]
  const init = prop.initializer

  if (ts.isConditionalExpression(init)) {
    // 三元值形态：`'data-running': runningHighlight ? 'true' : undefined`
    assert.ok(isRunningHighlightRef(init.condition), '★ 三元判据必须是 `runningHighlight`')
    assert.equal(normalizeWs(init.whenTrue.getText()), "'true'", "★ whenTrue 必须是字符串 `'true'`")
    assert.ok(
      ['undefined', 'void 0'].includes(normalizeWs(init.whenFalse.getText())),
      '★ F3：whenFalse 必须是 `undefined` / `void 0` —— 写 `\'false\'` 会让属性**恒出现**，' +
        '`[data-running]` 选择器命中所有容器行（契约 §2.3 / AC9 要求「不高亮时不出现该属性」）。' +
        `实际：${normalizeWs(init.whenFalse.getText())}`,
    )
    return
  }

  // 条件展开形态：`...(runningHighlight ? { 'data-running': 'true' } : {})`
  let conditional
  for (let current = prop.parent; current !== undefined; current = current.parent) {
    if (ts.isCallExpression(current)) break
    if (ts.isConditionalExpression(current)) {
      conditional = current
      break
    }
  }
  assert.ok(conditional !== undefined, `★ F3：\`data-running\` 必须位于条件展开内，实际：${normalizeWs(prop.parent.getText())}`)
  assert.ok(isRunningHighlightRef(conditional.condition), '★ 条件展开的判据必须是 `runningHighlight`')
  assert.ok(subtreeContains(conditional.whenTrue, prop), '★ F3：属性必须落在 `whenTrue` 分支（不是 whenFalse）')
  assert.equal(
    normalizeWs(conditional.whenFalse.getText()),
    '{}',
    '★ F3：条件展开的 whenFalse 必须是空对象 —— 否则不高亮时仍会写入属性（如写死 `{ \'data-running\': \'false\' }`）',
  )
})

test('运行中高亮/接线:C14 mount effect 先 `reload()` 首拉，再 `setInterval(reload, TREE_REFRESH_MS)`', () => {
  const inner = functionLikeDeclarations(sidebar.sourceFile).get('SidebarBrowserInner')
  assert.ok(inner !== undefined, '★ `sidebar.tsx` 必须声明 `SidebarBrowserInner`')

  // mount effect：依赖数组**恰好**是 `[reload]`（其它 effect 的依赖更长，因此不会误选）。
  const mountEffect = callExpressionsOf(inner.node, 'useEffect').find((call) => {
    const deps = call.arguments[1]
    return (
      deps !== undefined &&
      ts.isArrayLiteralExpression(deps) &&
      deps.elements.length === 1 &&
      normalizeWs(deps.elements[0].getText()) === 'reload'
    )
  })
  assert.ok(mountEffect !== undefined, '★ 必须存在依赖为 `[reload]` 的 mount effect（首拉 + 30s 轮询 + focus 强刷）')

  const callback = mountEffect.arguments[0]
  assert.ok(
    callback !== undefined && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)),
    '★ 该 effect 的第一个实参必须是回调函数',
  )
  const body = callback.body
  assert.ok(ts.isBlock(body), '★ 该 effect 回调必须是语句块（首拉、定时器、监听器依次排列）')

  // R2（T-6 复核）：只要求「存在无参 reload() 且早于 setInterval」仍可被
  // 「删首拉 + 把 onFocus 前移」绕过（前移后 onFocus 闭包里的 reload() 又早于定时器）。
  // 因此再钉一层：effect 体的**第一条语句**必须就是无参 `reload()`。
  const firstStatement = body.statements[0]
  const firstIsReload =
    firstStatement !== undefined &&
    ts.isExpressionStatement(firstStatement) &&
    ts.isCallExpression(firstStatement.expression) &&
    ts.isIdentifier(firstStatement.expression.expression) &&
    firstStatement.expression.expression.text === 'reload' &&
    firstStatement.expression.arguments.length === 0
  assert.ok(
    firstIsReload,
    '★ F5/R2：mount effect 体的**第一条语句**必须是无参 `reload()`（首拉）—— ' +
      '否则「删首拉 + 把 onFocus / 其它 `reload()` 前移」仍可绕过下面的顺序断言。' +
      `实际第一条：${firstStatement === undefined ? '(无语句)' : normalizeWs(firstStatement.getText())}`,
  )

  const zeroArgReloadCalls = findAll(
    body,
    (node) =>
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'reload' &&
      node.arguments.length === 0,
  )
  assert.ok(
    zeroArgReloadCalls.length >= 1,
    '★ F5：mount effect 体内必须有无参 `reload()`（首拉）—— 删掉它，页面要等 220 ms 防抖才首次请求树数据',
  )

  const intervals = findAll(
    body,
    (node) =>
      ts.isCallExpression(node) &&
      calleeNameOf(node.expression) === 'setInterval' &&
      node.arguments[1] !== undefined &&
      normalizeWs(node.arguments[1].getText()) === 'TREE_REFRESH_MS',
  )
  assert.ok(intervals.length >= 1, '★ mount effect 体内必须有 `setInterval(reload, TREE_REFRESH_MS)`（30s 兜底）')

  // 首拉必须**先于**定时器注册；`onFocus` 闭包里的 `reload()` 位于定时器之后，
  // 因此「删掉首拉」时剩下的最早调用会晚于 `setInterval` ⇒ 本断言变红（不是恒真）。
  const earliestReload = Math.min(...zeroArgReloadCalls.map((call) => call.getStart()))
  const earliestInterval = Math.min(...intervals.map((call) => call.getStart()))
  assert.ok(
    earliestReload < earliestInterval,
    '★ F5：首拉 `reload()` 必须位于 `setInterval(...)` **之前**（契约「首拉 + 30s 轮询 + focus 强刷」的顺序）',
  )
})

// ────────────────────────────────────────────────────────────────────────────
// 2026-10-21（WSR1–WSR6，AC8–AC10）：归档工作空间 + 选中对话高亮 + 底部「最近」分区接线
// ────────────────────────────────────────────────────────────────────────────

test('2026-10-21/AC8: 顶层工作空间菜单含「归档工作空间」、非 git 行补齐 `…` 按钮，且 client.tsx 挂载 settings.general.item', () => {
  // 1) MENU.archiveWorkspace 与菜单项
  assert.match(
    sidebar.text,
    /archiveWorkspace:\s*'archive-workspace'/,
    'MENU 常量必须包含 archiveWorkspace',
  )
  assert.match(
    sidebar.text,
    /t\('menu\.archiveWorkspace'\)/,
    'MenuLayer 必须渲染 t("menu.archiveWorkspace") 菜单项',
  )
  assert.match(
    sidebar.text,
    /archiveProjectKey/,
    '点击归档工作空间后必须向 /tree 传递 archiveProjectKey',
  )
  // 2) client.tsx 注册 settings.general.item
  assert.match(
    client.text,
    /settings\.general\.item/,
    'client.tsx 必须在 settings.general.item 槽位注册已归档工作空间管理项',
  )
  assert.match(
    client.text,
    /ArchivedWorkspacesSettingItem/,
    'client.tsx 必须挂载 ArchivedWorkspacesSettingItem 组件',
  )
})

test('2026-10-21/AC8-collapse: 设置中「已归档的工作空间」列表默认折叠，标题行可点击展开/折叠', () => {
  const decl = functionLikeDeclarations(sidebar.sourceFile).get('ArchivedWorkspacesSettingItem')
  assert.ok(decl !== undefined, 'sidebar.tsx 必须声明 ArchivedWorkspacesSettingItem')
  const node = decl.node
  const componentText = node.getText()

  // 1) 默认折叠的 state：const [expanded, setExpanded] = useState(false)
  const expandedDecl = directVariableDeclarations(node).find(
    (d) => ts.isArrayBindingPattern(d.name) && d.name.elements.some((el) => el.name?.text === 'expanded'),
  )
  assert.ok(expandedDecl !== undefined, 'ArchivedWorkspacesSettingItem 必须声明 expanded state（默认折叠）')
  const init = expandedDecl.initializer
  assert.ok(
    init !== undefined &&
      ts.isCallExpression(init) &&
      ts.isIdentifier(init.expression) &&
      init.expression.text === 'useState' &&
      init.arguments.length >= 1 &&
      init.arguments[0].kind === ts.SyntaxKind.FalseKeyword,
    `★ 默认折叠：expanded 必须由 useState(false) 初始化，实际：${init?.getText() ?? '(无初始化)'}`,
  )

  // 2) 标题行触发器带 aria-expanded、role=button、tabIndex=0、cursor:pointer
  const ariaProps = propertyAssignmentsNamed(node, 'aria-expanded')
  assert.ok(
    ariaProps.some(
      (prop) => ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.initializer) && prop.initializer.text === 'expanded',
    ),
    '★ 标题行必须带 \'aria-expanded\': expanded（供读屏器感知折叠状态）',
  )
  const roleProps = propertyAssignmentsNamed(node, 'role')
  assert.ok(
    roleProps.some(
      (prop) => ts.isPropertyAssignment(prop) && ts.isStringLiteral(prop.initializer) && prop.initializer.text === 'button',
    ),
    '★ 标题行必须 role: "button"（语义上是可点击的折叠触发器）',
  )
  const tabIndexProps = propertyAssignmentsNamed(node, 'tabIndex')
  assert.ok(
    tabIndexProps.some(
      (prop) => ts.isPropertyAssignment(prop) && prop.initializer.kind === ts.SyntaxKind.NumericLiteral && prop.initializer.text === '0',
    ),
    '★ 标题行必须 tabIndex: 0（可键盘聚焦）',
  )
  assert.match(componentText, /cursor:\s*'pointer'/, '★ 标题行必须 cursor: "pointer" 提示可点击')

  // 3) 折叠箭头切换：expanded ? icon('chevronDown') : icon('chevronRight')
  const chevronSwitches = findAll(
    node,
    (child) =>
      ts.isConditionalExpression(child) &&
      ts.isIdentifier(child.condition) &&
      child.condition.text === 'expanded' &&
      ts.isCallExpression(child.whenTrue) &&
      ts.isIdentifier(child.whenTrue.expression) &&
      child.whenTrue.expression.text === 'icon' &&
      ts.isStringLiteral(child.whenTrue.arguments[0]) &&
      child.whenTrue.arguments[0].text === 'chevronDown' &&
      ts.isCallExpression(child.whenFalse) &&
      ts.isIdentifier(child.whenFalse.expression) &&
      child.whenFalse.expression.text === 'icon' &&
      ts.isStringLiteral(child.whenFalse.arguments[0]) &&
      child.whenFalse.arguments[0].text === 'chevronRight',
  )
  assert.ok(
    chevronSwitches.length >= 1,
    '★ 折叠箭头必须随 expanded 切换：expanded ? icon("chevronDown") : icon("chevronRight")',
  )

  // 4) 点击/键盘切换逻辑：onClick 与 onKeyDown 均调用 setExpanded
  const togglers = propertyAssignmentsNamed(node, 'onClick').filter((prop) => {
    if (!ts.isPropertyAssignment(prop)) return false
    const fn = prop.initializer
    if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) return false
    return findAll(fn, (child) => ts.isCallExpression(child) && ts.isIdentifier(child.expression) && child.expression.text === 'setExpanded').length >= 1
  })
  assert.ok(togglers.length >= 1, '★ 标题行 onClick 必须调用 setExpanded 切换折叠状态')
  const keyTogglers = propertyAssignmentsNamed(node, 'onKeyDown').filter((prop) => {
    if (!ts.isPropertyAssignment(prop)) return false
    const fn = prop.initializer
    if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) return false
    const text = normalizeWs(fn.getText())
    return /setExpanded\(/.test(text) && /'Enter'/.test(text) && /' '/.test(text)
  })
  assert.ok(keyTogglers.length >= 1, '★ 标题行 onKeyDown 必须支持 Enter/Space 切换折叠状态')

  // 5) 下方列表区域仅在 expanded 为真时渲染：expanded ? (...) : null
  const gatedBlocks = findAll(
    node,
    (child) =>
      ts.isConditionalExpression(child) &&
      ts.isIdentifier(child.condition) &&
      child.condition.text === 'expanded' &&
      child.whenFalse.kind === ts.SyntaxKind.NullKeyword &&
      /archivedWorkspaces\.empty/.test(child.whenTrue.getText()) &&
      /\.map\(/.test(child.whenTrue.getText()),
  )
  assert.ok(
    gatedBlocks.length >= 1,
    '★ 已归档列表/空态必须包在 `expanded ? (items.length === 0 ? 空态 : 列表) : null` 中（折叠时不渲染）',
  )
})

test('2026-10-21/AC9: sidebar.tsx 经 currentSessionIdOf 解析当前会话，且 SessionRowView 渲染 data-selected 与左侧选中指示条', () => {
  let imported = false
  walk(sidebar.sourceFile, (node) => {
    if (!ts.isImportDeclaration(node)) return
    const specifier = node.moduleSpecifier
    if (!ts.isStringLiteral(specifier) || specifier.text !== './live-state.js') return
    const bindings = node.importClause?.namedBindings
    if (bindings === undefined || !ts.isNamedImports(bindings)) return
    if (bindings.elements.some((el) => el.name.text === 'currentSessionIdOf')) imported = true
  })
  assert.ok(imported, 'sidebar.tsx 必须从 ./live-state.js import currentSessionIdOf')
  assert.ok(
    callExpressionsOf(sidebar.sourceFile, 'currentSessionIdOf').length >= 1,
    'sidebar.tsx 必须调用 currentSessionIdOf 解析当前打开的会话',
  )
  assert.match(sidebar.text, /usePanelInfo/, 'sidebar.tsx 必须订阅 usePanelInfo 以对齐原生面板激活抑制规则')

  // 2026-11-14：memo 化后渲染体在 `SessionRowViewInner`。
  const sessionView = functionLikeDeclarations(sidebar.sourceFile).get('SessionRowViewInner')
  assert.ok(sessionView !== undefined)
  const sessionText = sessionView.node.getText()
  assert.match(sessionText, /data-selected/, 'SessionRowView 必须标注 data-selected 属性')
  assert.match(sessionText, /active-bar/, 'SessionRowView 在选中态下必须渲染左侧品牌色竖条 active-bar')
})

test('2026-10-21/AC10: treeInput 传 includeRecent: true，渲染 row.kind === "recent" 分区头且最近分区会话不可拖拽', () => {
  assert.match(
    sidebar.text,
    /includeRecent:\s*true/,
    'treeInput 必须开启 includeRecent: true 以在侧栏底部展示「最近」分区',
  )
  assert.match(
    sidebar.text,
    /RecentSectionHeaderView/,
    'sidebar.tsx 必须使用 RecentSectionHeaderView 渲染「最近」分区头（含顶部间距）',
  )
  assert.match(
    sidebar.text,
    /row\.parentKind\s*===\s*'recent'/,
    '最近分区下的会话行必须识别 parentKind === "recent" 并禁用拖拽',
  )
})

test('2026-10-21/Fix1&Fix2: 客户端持久化归档工作空间（无需重启宿主立即隐藏）且 rowStyle 使用 marginLeft 排除左侧缩进空白高亮', () => {
  assert.match(
    sidebar.text,
    /LS_ARCHIVED_PROJECTS/,
    'sidebar.tsx 必须在 localStorage 持久化已归档工作空间，保证未重启宿主时也能立即从侧边栏消失',
  )
  assert.match(
    sidebar.text,
    /archivedProjectKeys/,
    'treeInput 必须传入 archivedProjectKeys 给 buildRows 过滤',
  )

  const rowStyleFn = functionLikeDeclarations(sidebar.sourceFile).get('rowStyle')
  assert.ok(rowStyleFn !== undefined, 'sidebar.tsx 必须声明 rowStyle')
  const rowStyleText = rowStyleFn.node.getText()
  assert.match(
    rowStyleText,
    /marginLeft/,
    'rowStyle 必须用 marginLeft 承载左侧树缩进，使左侧空白缩进区不出现选中/悬停高亮底色',
  )
})

// ── 2026-10-21 Fix3：搜索行右侧「新增工作区」按钮点击无反应 ─────────────────────
//
// 用户可见承诺：点击 `+` **绝不允许无反应**。
// - Desktop Electron：必须优先 `globalThis.__DSH_DIRECTORY_PICKER__.pick()`（宿主注入、走主进程
//   `dialog.showOpenDialog`）；宿主 macOS `osascript` 选择器在 Desktop 下不显示窗口/超时。
// - Web / 宿主 native：回退 `uiWorkspace()?.pickDirectory()`。
// - 两者都不可用：**抛错**给调用方，由 `sidebar.tsx` 打开 `AddWorkspaceDialog` 让用户手输路径；
//   旧的 `catch { return null }` 把「不可用」伪装成「用户取消」，正是本缺陷根因，必须禁止。

test('2026-10-21/Fix3: pickDirectory 优先走 __DSH_DIRECTORY_PICKER__.pick 并提供路径输入弹窗兜底', () => {
  // 1) client.tsx：`createBridge` 里恰好一个 `pickDirectory` 方法。
  const bridgeDecl = functionLikeDeclarations(client.sourceFile).get('createBridge')
  assert.ok(bridgeDecl !== undefined, 'client.tsx 必须声明 createBridge')
  const pickMethods = findAll(
    bridgeDecl.node,
    (node) =>
      ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'pickDirectory',
  )
  assert.equal(pickMethods.length, 1, 'createBridge 必须恰好声明一个 pickDirectory 方法')
  const pickMethod = pickMethods[0]
  assert.ok(pickMethod.body !== undefined, '★ pickDirectory 必须是带方法体的实现（不能只是重载签名）')

  // 2) 三条链路的**存在性 / 顺序**用 AST 节点判定，不做字符串搜索。
  //
  //    T-8 审查发现：旧断言拿 `pickMethod.getText()` 做正则 —— 而 `getText()` 会把方法体里的
  //    **注释**一并带出。本方法内注释同样写着 `__DSH_DIRECTORY_PICKER__` /
  //    `uiWorkspace()?.pickDirectory()` / `directory-picker/unavailable`，于是哪怕真实代码删光，
  //    注释也能让断言全绿（假绿）。现在改成只看**非注释 AST 节点**。
  const desktopPickerAccess = findAll(
    pickMethod,
    (node) =>
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === '__DSH_DIRECTORY_PICKER__',
  )
  assert.ok(
    desktopPickerAccess.length >= 1,
    '★ pickDirectory 必须先读取 globalThis.__DSH_DIRECTORY_PICKER__（Desktop Electron 原生目录框）',
  )
  // 该属性访问必须被收进局部变量（`const desktopPicker = …`），后面的 `.pick()` 才对得上人。
  const desktopPickerVar = findAll(
    pickMethod,
    (node) =>
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      findAll(node.initializer, (child) => desktopPickerAccess.includes(child)).length > 0,
  )[0]
  assert.ok(
    desktopPickerVar !== undefined,
    '★ __DSH_DIRECTORY_PICKER__ 必须赋给局部变量后再使用（typeof 兜底判定与后续 pick() 同源）',
  )
  const desktopPickerName = desktopPickerVar.name.text

  const desktopPickCalls = callExpressionsOf(pickMethod, 'pick')
  assert.equal(
    desktopPickCalls.length,
    1,
    '★ pickDirectory 必须恰好调用一次 Desktop 原生桥的 pick()',
  )
  const desktopPickCall = desktopPickCalls[0]
  const desktopPickCallee = normalizeWs(desktopPickCall.expression.getText())
  assert.match(
    desktopPickCallee,
    new RegExp(`^${desktopPickerName}(\\?\\.|\\.)pick$`),
    `★ pick() 必须调用在 ${desktopPickerName}（= __DSH_DIRECTORY_PICKER__）上，实际：${desktopPickCallee}`,
  )

  // `typeof <picker>?.pick === 'function'` 守卫：AST 里存在 `TypeOfExpression`，且它包裹的正是 pick 属性访问。
  const typeofGuards = findAll(pickMethod, (node) => ts.isTypeOfExpression(node))
  assert.ok(
    typeofGuards.some(
      (node) =>
        findAll(
          node,
          (child) => ts.isPropertyAccessExpression(child) && child.name.getText() === 'pick',
        ).length > 0,
    ),
    '★ 必须先用 typeof …pick === "function" 判定原生桥可用，而不是直接调用',
  )

  const servicePickCalls = callExpressionsOf(pickMethod, 'pickDirectory')
  assert.equal(
    servicePickCalls.length,
    1,
    '★ 无 Desktop 原生桥时必须回退 uiWorkspace()?.pickDirectory()（Web / 宿主 native），且只写一次',
  )
  const serviceCallee = servicePickCalls[0].expression
  assert.ok(
    ts.isPropertyAccessExpression(serviceCallee) && serviceCallee.name.text === 'pickDirectory',
    '★ 回退分支必须是属性访问 `.pickDirectory()` 调用',
  )
  // 接收者身份必须可追溯到 `uiWorkspace()`：允许 `uiWorkspace()?.pickDirectory()` 直连，
  // 也允许先 `const service = uiWorkspace()` 再 `service.pickDirectory()`（当前写法）。
  const serviceReceiver = normalizeWs(serviceCallee.expression.getText())
  assert.equal(
    callExpressionsOf(pickMethod, 'uiWorkspace').length,
    1,
    '★ 回退分支必须调用 uiWorkspace()（宿主 uiWorkspace 服务），不得换成别的服务',
  )
  const receiverFromUiWorkspace =
    serviceReceiver === 'uiWorkspace()' ||
    findAll(
      pickMethod,
      (node) =>
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === serviceReceiver &&
        node.initializer !== undefined &&
        callExpressionsOf(node.initializer, 'uiWorkspace').length === 1,
    ).length === 1
  assert.ok(
    receiverFromUiWorkspace,
    `★ .pickDirectory() 的接收者（实际：${serviceReceiver}）必须来自 uiWorkspace()`,
  )
  assert.ok(
    desktopPickCall.getStart() < servicePickCalls[0].getStart(),
    '★ Desktop 原生桥分支必须排在 uiWorkspace()?.pickDirectory() 回退之前（Desktop 优先）',
  )

  // 3) 不再静默吞错：旧实现 `catch { return null }` 必须消失，改为抛明确错误（仍是 AST 判定）。
  assert.equal(
    findAll(pickMethod, (node) => ts.isCatchClause(node)).length,
    0,
    '★ pickDirectory 不得再 catch 后 return null 静默吞错（会把「选择器不可用」伪装成「用户取消」）',
  )
  const throwTexts = findAll(pickMethod, (node) => ts.isThrowStatement(node)).map((node) =>
    normalizeWs(node.getText()),
  )
  assert.ok(
    throwTexts.some((text) => text.includes("new Error('directory-picker/unavailable')")),
    `★ 两种选择器都不可用时必须抛 directory-picker/unavailable，交给 sidebar 弹窗兜底，实际 throw：${JSON.stringify(throwTexts)}`,
  )

  // 4) sidebar.tsx：声明 AddWorkspaceDialog（路径输入弹窗）并真正渲染。
  const declarations = functionLikeDeclarations(sidebar.sourceFile)
  const dialog = declarations.get('AddWorkspaceDialog')
  assert.ok(dialog !== undefined, 'sidebar.tsx 必须声明 AddWorkspaceDialog 组件')
  const dialogText = normalizeWs(dialog.node.getText())
  assert.match(dialogText, /P\.Modal/, '★ AddWorkspaceDialog 必须复用宿主 P.Modal')
  assert.match(dialogText, /createWorkspace\(/, '★ AddWorkspaceDialog 确认后必须调用 createWorkspace(path)')
  assert.ok(
    jsxTagProps(sidebar.sourceFile, 'AddWorkspaceDialog').length >= 1,
    '★ AddWorkspaceDialog 必须被渲染（声明了但没挂载 = 兜底不存在）',
  )

  // 5) addWorkspaceOpen 状态 + 原生选择器失败时打开弹窗（绝不无反应）。
  assert.match(sidebar.text, /addWorkspaceOpen/, 'sidebar.tsx 必须有 addWorkspaceOpen 状态控制弹窗显隐')
  // `const addWorkspace = useCallback(...)` 的初始化是调用表达式，不走 functionLikeDeclarations，
  // 这里按变量名直接取声明节点（`useCallback` / 直接箭头函数两种写法都覆盖）。
  let addWorkspaceNode
  walk(sidebar.sourceFile, (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'addWorkspace'
    ) {
      addWorkspaceNode = node
    }
  })
  assert.ok(addWorkspaceNode !== undefined, 'sidebar.tsx 必须声明 addWorkspace 回调')
  const addWorkspaceText = normalizeWs(addWorkspaceNode.getText())
  assert.match(
    addWorkspaceText,
    /setAddWorkspaceOpen\(true\)/,
    '★ addWorkspace 在 pickDirectory 抛错（原生选择器不可用）时必须 setAddWorkspaceOpen(true)，不得静默 return',
  )
  assert.match(
    sidebar.text,
    /createWorkspace\(path: string\): Promise<void>/,
    '★ Actions 接口必须补充 createWorkspace(path)（弹窗确认后的真实建档入口）',
  )
  assert.match(
    sidebar.text,
    /ROUTE_WORKSPACE_OPEN/,
    '★ bridge 缺席时 createWorkspace 必须回退 POST /dsh-worktree-groups/workspace-open',
  )

  // 6) 2026-10-21 Fix4（T-8 审查返工）：**目录选择阶段**与 **createWorkspace 创建阶段**的
  //    异常边界必须分离。
  //
  // 旧实现在 `actions.addWorkspace` 内串起 `bridge.pickDirectory()` 与
  // `bridge.createWorkspace(picked)`，外层 `addWorkspace` 回调只有**一个** `try/catch`：
  // - 选择器成功选目录、但 `createWorkspace` 抛错 ⇒ 误开空白 `AddWorkspaceDialog`，
  //   并吞掉真实的 createWorkspace 错误（违背 `docs/INTERFACES.md`
  //   「宿主 createWorkspace 失败落 loadError 行」）；
  // - `bridge === undefined` 时若无显式抛错，会被当成「用户取消」而毫无兜底。
  //
  // 目标语义：目录选择抛错（含 bridge 缺席）⇒ `setAddWorkspaceOpen(true)`；
  // 用户取消 `null` ⇒ 静默返回；创建阶段抛错 ⇒ `setLoadError(...)`。
  const actionsInterface = findAll(
    sidebar.sourceFile,
    (node) => ts.isInterfaceDeclaration(node) && node.name.text === 'Actions',
  )[0]
  assert.ok(actionsInterface !== undefined, 'sidebar.tsx 必须声明 Actions 接口')
  const actionMethodNames = actionsInterface.members
    .filter((member) => ts.isMethodSignature(member))
    .map((member) => member.name.getText())
  assert.ok(
    actionMethodNames.includes('pickDirectory'),
    '★ Actions 必须暴露 pickDirectory()，使目录选择阶段的异常可被 addWorkspace 单独捕获',
  )

  const addWorkspaceCalls = findAll(
    addWorkspaceNode,
    (node) =>
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.name) &&
      (node.expression.name.text === 'pickDirectory' || node.expression.name.text === 'createWorkspace'),
  ).map((node) => node.expression.name.text)
  assert.ok(
    addWorkspaceCalls.includes('pickDirectory'),
    '★ addWorkspace 必须调用 actions.pickDirectory()（目录选择阶段独立出来）',
  )
  assert.ok(
    addWorkspaceCalls.includes('createWorkspace'),
    '★ addWorkspace 必须调用 actions.createWorkspace(picked)（创建阶段独立出来）',
  )

  const tryStatements = findAll(addWorkspaceNode, (node) => ts.isTryStatement(node))
  assert.ok(
    tryStatements.length >= 2,
    '★ addWorkspace 必须有两个独立的 try/catch（选择阶段 / 创建阶段），不得合并在一个 try 里',
  )
  const pickPhase = tryStatements.find((node) => normalizeWs(node.getText()).includes('pickDirectory'))
  const createPhase = tryStatements.find((node) => normalizeWs(node.getText()).includes('createWorkspace'))
  assert.ok(pickPhase !== undefined, '★ 必须有包围 pickDirectory 的 try 语句')
  assert.ok(createPhase !== undefined, '★ 必须有包围 createWorkspace 的 try 语句')
  assert.notStrictEqual(pickPhase, createPhase, '★ pickDirectory 与 createWorkspace 不得共用同一个 try/catch')

  assert.ok(pickPhase.catchClause !== undefined, '★ 选择阶段的 try 必须带 catch')
  const pickCatchText = normalizeWs(pickPhase.catchClause.getText())
  assert.match(
    pickCatchText,
    /setAddWorkspaceOpen\(true\)/,
    '★ 目录选择阶段抛错（选择器不可用 / bridge 缺席）必须 setAddWorkspaceOpen(true)',
  )
  assert.doesNotMatch(
    pickCatchText,
    /setLoadError/,
    '★ 目录选择阶段不得把错误写进 loadError 行（必须弹手输路径弹窗）',
  )

  assert.ok(createPhase.catchClause !== undefined, '★ 创建阶段的 try 必须带 catch')
  const createCatchText = normalizeWs(createPhase.catchClause.getText())
  assert.match(
    createCatchText,
    /setLoadError\(/,
    '★ createWorkspace 创建阶段抛错必须落 setLoadError（INTERFACES：宿主 createWorkspace 失败落 loadError 行）',
  )
  assert.doesNotMatch(
    createCatchText,
    /setAddWorkspaceOpen/,
    '★ 创建阶段失败不得误开空白 AddWorkspaceDialog（会吞掉真实的 createWorkspace 错误）',
  )
})

// ────────────────────────────────────────────────────────────────────────────
// 2026-10-21 WSR7：顶层工作区行不显示会话数
//
// 用户需求：「现在工作区会显示里面的会话数，去除这个会话数的显示」。
// `src/sidebar.tsx` 不进 `lib/`，`node --test` 执行不到；沿用本文件的源码级契约做法，
// 直接断言真实 `ContainerRowView` 子树里**没有任何** `sessionCount` 读取。
// ────────────────────────────────────────────────────────────────────────────

test('2026-10-21/WSR7 工作区行不得显示会话数：ContainerRowView 不得读取 sessionCount', () => {
  const view = containerRowViewDecl()
  const countRefs = findAll(
    view.node,
    (node) => ts.isPropertyAccessExpression(node) && node.name.text === 'sessionCount',
  )
  assert.equal(
    countRefs.length,
    0,
    '★ WSR7：顶层工作区行不得展示其名下会话数；`sessionCount` 只保留在数据层，' +
      '不得在 `ContainerRowView` 中渲染（实际仍读取 ' +
      `${countRefs.length} 处：${countRefs.map((node) => normalizeWs(node.getText())).join(', ')}）`,
  )
})

// ────────────────────────────────────────────────────────────────────────────
// 2026-10-22 DR1：同位置「新建会话」复用空白会话（保留未发送草稿）
//
// 缺陷事实：草稿按**会话 id** 存在 `localStorage`（`dsh.conversation.<sessionId>`，
// 宿主 `dsh-client-ui-conversation/lib/client.js:4426/4464`），而插件所有「新建会话」
// 入口都以**单参**调用 `uiWorkspace.startSession(workspaceId)` ⇒ 宿主
// `connectBlank(workspaceId, undefined)` 分支无条件 `sessions.create`（
// `dsh-client-ui-workspace/lib/client.js:1403`）⇒ 每次都铸新空白会话；同位置那条
// 带草稿的旧 blank 会话又因 `sessionVisible()`「blank 只显示当前那一条」（`:964`）
// 被隐藏 ⇒ 草稿在界面上不可达。
//
// 修复口径（用户 2026-10-22 经 AskHuman 确认，DR1「复用」）：所有插件自有的
// 「新建会话」入口都传第二参 `{ clearPreviousDraft: false }`，让宿主走
// `createInWorkspace`（`:1418`，按 `summary.cwd === workspace.path` 找回 blank 会话、
// 复用同一 `sessionId`），从而由对话区按同一 id 恢复草稿。
//
// 这些断言锁的是**接线**（`src/sidebar.tsx` / `src/client.tsx` 不进 `lib/`，
// `node --test` 执行不到），真正的复用行为在宿主浏览器端服务内，Node 侧无法驱动。
// ────────────────────────────────────────────────────────────────────────────

/** 宿主 `uiWorkspace` 所属包的已安装客户端产物（契约锁用；缺失时 skip）。 */
const HOST_WORKSPACE_CLIENT = path.join(
  '/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai',
  'dsh-client-ui-workspace/lib/client.js',
)

/** 去掉括号 / `as const` / `satisfies` / `Object.freeze(...)` 外壳，取对象字面量。 */
function unwrapObjectLiteral(node) {
  if (node === undefined) return undefined
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isTypeAssertionExpression(node)
  ) {
    return unwrapObjectLiteral(node.expression)
  }
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'freeze'
  ) {
    return unwrapObjectLiteral(node.arguments[0])
  }
  return ts.isObjectLiteralExpression(node) ? node : undefined
}

/** 源码里 `const <name> = <expr>` 的初始值节点（任意作用域，取第一个）。 */
function constInitializerOf(sourceFile, name) {
  let found
  walk(sourceFile, (node) => {
    if (found !== undefined) return
    if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || node.name.text !== name) return
    found = node.initializer
  })
  return found
}

/** 把「第二实参」解析成对象字面量（支持字面量、标识符常量、`as const`、`Object.freeze`）。 */
function resolveOptionsObject(sourceFile, node) {
  if (node === undefined) return undefined
  if (ts.isIdentifier(node)) return unwrapObjectLiteral(constInitializerOf(sourceFile, node.text))
  return unwrapObjectLiteral(node)
}

/** 侧栏里所有 `actions.startSession(...)` / `props.actions.startSession(...)` 调用。 */
function actionStartSessionCalls(sourceFile) {
  return callExpressionsOf(sourceFile, 'startSession').filter((call) => {
    const callee = call.expression
    if (!ts.isPropertyAccessExpression(callee)) return false
    const owner = normalizeWs(callee.expression.getText())
    return owner === 'actions' || owner === 'props.actions'
  })
}

/** 用**规范化后的 callee 文本**找调用（`bridge?.startSession(...)` 归一成 `bridge.startSession`）。 */
function callsOfCalleeText(scopeNode, calleeText) {
  return findAll(
    scopeNode,
    (node) =>
      ts.isCallExpression(node) &&
      (ts.isPropertyAccessExpression(node.expression) || ts.isIdentifier(node.expression)) &&
      normalizeWs(node.expression.getText()).replace(/\?/g, '') === calleeText,
  )
}

/** 实参是否是某个标识符（按文本比较）。 */
const isIdentifierNamed = (node, name) => node !== undefined && ts.isIdentifier(node) && node.text === name

test('2026-10-22/DR1 同位置新建会话：全部入口都以两参调用 startSession，第二参含 clearPreviousDraft: false', () => {
  const { sourceFile } = parse(SIDEBAR_PATH)
  const calls = actionStartSessionCalls(sourceFile)
  const rendered = calls.map((call) => normalizeWs(call.getText()))

  assert.equal(
    calls.length,
    4,
    '★ 期望恰好 4 个插件自有的「新建会话」入口（worktree 行 `+`、非 git 工作区行 `+`、' +
      `worktree 创建成功后的自动开、project 右键菜单）；实际 ${calls.length} 个：${rendered.join(' | ')}。` +
      '新增/删除入口必须同步本断言与 DR1 口径。',
  )

  for (const call of calls) {
    const text = normalizeWs(call.getText())
    assert.equal(
      call.arguments.length,
      2,
      `★ ${text} 必须传第二参 { clearPreviousDraft: false }：` +
        '单参会让宿主走 connectBlank(..., undefined) 分支、每次铸出新空白会话，' +
        '同位置旧 blank 会话被 sessionVisible() 隐藏 ⇒ 未发送草稿在界面上丢失（2026-10-22 缺陷）。',
    )
    const options = resolveOptionsObject(sourceFile, call.arguments[1])
    assert.notEqual(
      options,
      undefined,
      `★ ${text} 的第二参必须能追溯到对象字面量（字面量 / 同文件常量 / Object.freeze 皆可），` +
        '否则无法断言 clearPreviousDraft 的值',
    )
    const clear = propertyValue(options, 'clearPreviousDraft')
    assert.notEqual(clear, undefined, `★ ${text} 的第二参必须显式写 clearPreviousDraft`)
    assert.equal(
      normalizeWs(clear.getText()),
      'false',
      `★ ${text} 必须传 clearPreviousDraft: false（true 会清空草稿；缺省/单参会让宿主铸新会话）`,
    )
  }
})

test('2026-10-22/DR1 接线：Actions.startSession 把 options 同时透传给宿主 props 与 bridge', () => {
  const { sourceFile } = parse(SIDEBAR_PATH)
  const implementations = findAll(
    sourceFile,
    (node) =>
      ts.isPropertyAssignment(node) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
      node.name.text === 'startSession' &&
      ts.isArrowFunction(node.initializer),
  )
  assert.equal(
    implementations.length,
    1,
    `★ 期望恰好 1 个 \`startSession: (...) => …\` 的 Actions 实现，实际 ${implementations.length}`,
  )

  const implementation = implementations[0].initializer
  assert.deepEqual(
    paramNames(implementation.parameters),
    ['workspaceId', 'options'],
    '★ Actions.startSession 必须声明 (workspaceId, options)，否则 options 在动作层就被吞掉',
  )

  const propsCall = callsOfCalleeText(implementation, 'start')
  assert.equal(propsCall.length, 1, '★ Actions.startSession 里应恰好调用一次宿主 props 的 start(...)')
  assert.equal(propsCall[0].arguments.length, 2, '★ 宿主 props.startSession 必须收到第二参 options')
  assert.ok(
    isIdentifierNamed(propsCall[0].arguments[1], 'options'),
    `★ 宿主 props.startSession 的第二实参必须是 options，实际 ${normalizeWs(propsCall[0].getText())}`,
  )

  const bridgeCalls = callsOfCalleeText(implementation, 'bridge.startSession')
  assert.equal(bridgeCalls.length, 1, '★ Actions.startSession 里应恰好调用一次 bridge.startSession(...)')
  assert.equal(bridgeCalls[0].arguments.length, 2, '★ bridge.startSession 必须收到第二参 options')
  assert.ok(
    isIdentifierNamed(bridgeCalls[0].arguments[1], 'options'),
    `★ bridge.startSession 的第二实参必须是 options，实际 ${normalizeWs(bridgeCalls[0].getText())}`,
  )
})

test('2026-10-22/DR1 接线：client.tsx 的 bridge.startSession 把 options 原样转发给 uiWorkspace.startSession', () => {
  const { sourceFile } = parse(CLIENT_PATH)
  const methods = findAll(
    sourceFile,
    (node) =>
      ts.isMethodDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'startSession',
  )
  assert.equal(methods.length, 1, `★ 期望 client.tsx 里恰好 1 个 startSession 方法，实际 ${methods.length}`)

  const method = methods[0]
  assert.deepEqual(
    paramNames(method.parameters),
    ['workspaceId', 'options'],
    '★ bridge.startSession 必须声明 (workspaceId, options)',
  )

  const forwarded = callsOfCalleeText(method, 'workspace.startSession')
  assert.equal(forwarded.length, 1, '★ bridge.startSession 必须调用 uiWorkspace.startSession 一次')
  assert.equal(
    forwarded[0].arguments.length,
    2,
    '★ uiWorkspace.startSession 必须收到第二参 options：单参会让宿主铸新空白会话、草稿丢失',
  )
  assert.ok(
    isIdentifierNamed(forwarded[0].arguments[1], 'options'),
    `★ uiWorkspace.startSession 的第二实参必须是 options，实际 ${normalizeWs(forwarded[0].getText())}`,
  )
})

test('2026-10-22/DR1 宿主契约锁：安装的 ui-workspace 仍支持「按 cwd 复用 blank 会话」的 startSession options', () => {
  let hostText
  try {
    hostText = readFileSync(HOST_WORKSPACE_CLIENT, 'utf8')
  } catch {
    hostText = undefined
  }
  if (hostText === undefined) {
    test.skip?.()
    return
  }
  const host = normalizeWs(hostText)

  assert.match(
    host,
    /startSession\(workspaceId, options\)/,
    '★ 宿主 uiWorkspace.startSession 的第二参消失了：插件的 { clearPreviousDraft: false } 会变成死参数',
  )
  assert.match(
    host,
    /connectBlank\(workspaceId, reuse\)/,
    '★ 宿主的 connectBlank(workspaceId, reuse) 签名变了：复用的判定入口需要重新核实',
  )
  assert.match(
    host,
    /if \(reuse === void 0\) return this\.sessions\.create\(\{ workspaceId \}\);/,
    '★ 宿主「reuse 缺省 ⇒ 铸新会话」的分支变了：reuse 语义需要重新核实（这是本次缺陷的直接根因）',
  )
  assert.match(
    host,
    /summary\.cwd === workspace\.path/,
    '★ 宿主 createInWorkspace 不再按 cwd 过滤 blank 会话：「同个位置」的口径需要重新核实',
  )
  assert.match(
    host,
    /draftOptions\.clearPreviousDraft === true/,
    '★ 宿主不再把 clearPreviousDraft 当作「初始化草稿」开关：{ clearPreviousDraft: false } 可能变成清空草稿',
  )
})

// ────────────────────────────────────────────────────────────────────────────
// 2026-10-22 DR6：陈旧持久表让「拖拽排序」静默失效（工作区/worktree/会话全中招）
//
// 缺陷事实：`commitDrag` 旧实现直接拿 `manualOrder` 里的该层列表做 `reorderKeys`。
// 持久表是**首次拖拽时固化的快照**，之后新增的工作区 / worktree / 会话都不在表里，
// 而 `reorderKeys` 对「拖拽源不在表里」与「落点不在表里」都返回 `null` ⇒ 整次拖拽
// 什么都不写（用户：「没法拖动工作区进行排序」）。
//
// 修复口径：三层统一走 `tree-model.ts` 的 `reorderManualScope(order, defaults, …)`
// （先与 `effectiveOrder` 的当前默认顺序对齐，再 `reorderKeys`）。
// ────────────────────────────────────────────────────────────────────────────

/** 取 `const <name> = useCallback(<fn>, [...])` 里的那个函数节点（找不到 ⇒ undefined）。 */
function useCallbackFunctionOf(sourceFile, name) {
  let found
  walk(sourceFile, (node) => {
    if (found !== undefined) return
    if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || node.name.text !== name) return
    const init = node.initializer
    if (init === undefined || !ts.isCallExpression(init)) return
    const callee = init.expression
    const calleeName = ts.isIdentifier(callee)
      ? callee.text
      : ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : undefined
    if (calleeName !== 'useCallback') return
    const first = init.arguments[0]
    if (first !== undefined && (ts.isArrowFunction(first) || ts.isFunctionExpression(first))) found = first
  })
  return found
}

test('2026-10-22/DR6 接线：commitDrag 三层都走 reorderManualScope（先对齐默认顺序再换算）', () => {
  const namedImports = new Set()
  walk(sidebar.sourceFile, (node) => {
    if (!ts.isImportDeclaration(node)) return
    const specifier = node.moduleSpecifier
    if (!ts.isStringLiteral(specifier) || specifier.text !== './tree-model.js') return
    const bindings = node.importClause?.namedBindings
    if (bindings === undefined || !ts.isNamedImports(bindings)) return
    for (const element of bindings.elements) namedImports.add(element.name.text)
  })
  assert.ok(
    namedImports.has('reorderManualScope'),
    '★ 必须从 `./tree-model.js` import `reorderManualScope`（拖拽换算的唯一入口）',
  )
  assert.equal(
    namedImports.has('reorderKeys'),
    false,
    '★ `sidebar.tsx` 不得直接 import `reorderKeys`：绕开对齐就会在陈旧持久表上静默失效',
  )

  const commitDrag = useCallbackFunctionOf(sidebar.sourceFile, 'commitDrag')
  assert.ok(commitDrag !== undefined, '`sidebar.tsx` 必须声明 `commitDrag = useCallback(...)`')

  const calls = callExpressionsOf(commitDrag, 'reorderManualScope')
  assert.equal(
    calls.length,
    3,
    `★ project / worktree / session 三层都必须经 \`reorderManualScope\` 换算，实际 ${calls.length} 处`,
  )
  const secondArgs = calls.map((call) => normalizeWs(call.arguments[1]?.getText() ?? ''))
  for (const arg of secondArgs) {
    assert.match(
      arg,
      /^defaults\.(projects|sessions\.get\(|worktrees\.get\()/,
      `★ 第二实参必须是 \`effectiveOrder\` 的默认顺序（与渲染同源），实际：${arg}`,
    )
  }
  for (const call of calls) {
    const first = normalizeWs(call.arguments[0]?.getText() ?? '')
    assert.match(
      first,
      /manualOrder/,
      `★ 第一实参必须来自持久表 \`manualOrder\`（非手动模式传 undefined ⇒ 直接用默认顺序），实际：${first}`,
    )
  }
})

test('2026-11-24/AC1-AC5 接线：侧栏接入原生会话右键菜单与实时 archivedSessionIds', () => {
  const liveMergeImports = new Set()
  walk(sidebar.sourceFile, (node) => {
    if (!ts.isImportDeclaration(node)) return
    const specifier = node.moduleSpecifier
    if (!ts.isStringLiteral(specifier) || specifier.text !== './live-merge.js') return
    const bindings = node.importClause?.namedBindings
    if (bindings === undefined || !ts.isNamedImports(bindings)) return
    for (const element of bindings.elements) liveMergeImports.add(element.name.text)
  })
  assert.ok(
    liveMergeImports.has('resolveArchivedSessionIds'),
    '★ sidebar.tsx 必须从 ./live-merge.js import resolveArchivedSessionIds',
  )
  assert.ok(
    liveMergeImports.has('workspacesSnapshotSignature'),
    '★ sidebar.tsx 必须从 ./live-merge.js import workspacesSnapshotSignature',
  )
  assert.ok(
    callExpressionsOf(sidebar.sourceFile, 'resolveArchivedSessionIds').length >= 1,
    '★ sidebar.tsx 必须调用 resolveArchivedSessionIds 计算实时归档集合',
  )
  assert.ok(
    callExpressionsOf(sidebar.sourceFile, 'workspacesSnapshotSignature').length >= 1,
    '★ sidebar.tsx 必须调用 workspacesSnapshotSignature 派生 workspacesSignature',
  )
  assert.ok(
    callExpressionsOf(sidebar.sourceFile, 'openSessionContextMenu').length >= 1,
    '★ sidebar.tsx 必须通过 actions.openSessionContextMenu 委托 DSH 原生会话右键菜单',
  )
  assert.ok(
    callExpressionsOf(sidebar.sourceFile, 'closeContextMenu').length >= 1,
    '★ sidebar.tsx 打开自绘 MenuLayer 前必须调用 actions.closeContextMenu 防止双菜单重叠',
  )
})

test('2026-11-25/AC1-AC2 接线：MenuLayer 向 P.Menu 传入 CSS 锚定 anchorPoint 并保留旧版 getAnchorRect', () => {
  let menuLayerFn = null
  walk(sidebar.sourceFile, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'MenuLayer') {
      menuLayerFn = node
    }
  })
  assert.ok(menuLayerFn !== null, '★ sidebar.tsx 必须声明 MenuLayer 函数')

  const menuCalls = []
  walk(menuLayerFn, (node) => {
    if (!ts.isCallExpression(node)) return
    const callee = node.expression.getText(sidebar.sourceFile)
    if (callee !== 'jsx' && callee !== 'jsxs') return
    if (node.arguments.length < 2) return
    if (normalizeWs(node.arguments[0].getText(sidebar.sourceFile)) !== 'P.Menu') return
    menuCalls.push(node)
  })
  assert.equal(menuCalls.length, 1, '★ MenuLayer 必须恰好有一处 jsx(P.Menu, ...) 调用')

  const propsArg = menuCalls[0].arguments[1]
  assert.ok(ts.isObjectLiteralExpression(propsArg), '★ P.Menu 的第二个实参必须是 props 对象字面量')

  const propsByName = new Map()
  for (const prop of propsArg.properties) {
    if (ts.isPropertyAssignment(prop)) {
      propsByName.set(prop.name.getText(sidebar.sourceFile), normalizeWs(prop.initializer.getText(sidebar.sourceFile)))
    } else if (ts.isShorthandPropertyAssignment(prop)) {
      propsByName.set(prop.name.text, prop.name.text)
    }
  }

  assert.equal(propsByName.get('open'), 'true', '★ MenuLayer 渲染 P.Menu 必须传 open: true')
  assert.equal(propsByName.get('portal'), 'true', '★ MenuLayer 渲染 P.Menu 必须传 portal: true')
  assert.equal(propsByName.get('anchor'), 'null', '★ DSH v0.2.2+ CSS 锚定菜单应传 anchor: null（与宿主 MenuOverlay 对齐）')
  assert.ok(
    propsByName.has('anchorPoint'),
    '★ DSH v0.2.2+ 移除了 getAnchorRect，MenuLayer 必须向 P.Menu 传入 anchorPoint ({ x, y })',
  )
  assert.ok(
    propsByName.has('getAnchorRect'),
    '★ 需保留 getAnchorRect 以向后兼容 DSH < 0.2.2 宿主',
  )

  // 验证 anchorPoint 通过 useMemo 基于 anchorX / anchorY 稳定构造
  let anchorPointInit = null
  walk(menuLayerFn, (node) => {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.name.text === propsByName.get('anchorPoint')
      && node.initializer !== undefined
    ) {
      anchorPointInit = normalizeWs(node.initializer.getText(sidebar.sourceFile))
    }
  })
  assert.ok(anchorPointInit !== null, '★ anchorPoint 必须作为稳定局部绑定传给 P.Menu')
  assert.match(
    anchorPointInit,
    /^useMemo\(\s*\(\)\s*=>\s*\(\{\s*x:\s*anchorX,\s*y:\s*anchorY\s*\}\)\s*,\s*\[\s*anchorX,\s*anchorY\s*\]\s*\)$/,
    `★ anchorPoint 必须通过 useMemo(() => ({ x: anchorX, y: anchorY }), [anchorX, anchorY]) 构造，实际：${anchorPointInit}`,
  )
})

