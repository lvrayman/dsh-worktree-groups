/**
 * 2026-11-14 性能优化 + 渐进展开在 `src/sidebar.tsx` 上的接线契约（源码级）。
 *
 * 需求：`docs/requirements/2026-11-14-perf-progressive-expand.md`（PERF5–PERF7、PX1–PX5）。
 * `.tsx` 无法在 node 里直接渲染（宿主 primitives 只在浏览器里注入），因此按既有
 * `sidebar-wiring.test.mjs` 的做法锁定源码结构。
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = readFileSync(new URL('../src/sidebar.tsx', import.meta.url), 'utf8')

/** 截取 `const <name> = useCallback(` 起到下一个顶层 `const ` 声明之间的源码。 */
function callbackBody(name) {
  const start = source.indexOf(`const ${name} = useCallback(`)
  assert.ok(start >= 0, `必须存在 useCallback \`${name}\``)
  const end = source.indexOf('\n  const ', start + 10)
  return source.slice(start, end === -1 ? undefined : end)
}

function functionBody(name) {
  const start = source.indexOf(`function ${name}(`)
  assert.ok(start >= 0, `必须存在函数 \`${name}\``)
  const end = source.indexOf('\nfunction ', start + 10)
  return source.slice(start, end === -1 ? undefined : end)
}

test('PERF5: reload 不再「先 abort 在途请求再重发」，而是单在途 + 尾随', () => {
  const body = callbackBody('reload')
  assert.equal(/inflightRef\.current\?\.abort\(\)/.test(body), false, 'reload 体内不得 abort 在途请求')
  assert.match(body, /trailingRef\.current = true/, '忙时只记尾随标记')
  assert.match(body, /if-none-match/, 'PERF4：带 If-None-Match')
  assert.match(body, /response\.status === 304/, 'PERF4：304 直接返回')
  assert.match(body, /visibilityState === 'hidden'/, 'PERF7：页面隐藏时跳过')
})

test('PERF6: 下游树 = mergeLiveSessions(serverTree, sessionsSnapshot, ...)；防抖不再依赖整份 sessionsSnapshot', () => {
  assert.match(source, /mergeLiveSessions\(serverTree, sessionsSnapshot(?:, [^)]+)?\)/)
  const effect = source.slice(source.indexOf('setTimeout(reload, RELOAD_DEBOUNCE_MS)'))
  const deps = effect.slice(effect.indexOf('}, ['), effect.indexOf(']', effect.indexOf('}, [')) + 1)
  assert.equal(deps.includes('sessionsSnapshot'), false, `防抖依赖不得含 sessionsSnapshot：${deps}`)
  assert.ok(deps.includes('pendingLiveSignature'), `防抖依赖应含 pendingLiveSignature：${deps}`)
})

test('PERF7: 轮询 5 s，且监听 visibilitychange', () => {
  assert.match(source, /const TREE_REFRESH_MS = 5_000/)
  assert.match(source, /addEventListener\('visibilitychange', onVisibility\)/)
  assert.match(source, /removeEventListener\('visibilitychange', onVisibility\)/)
})

test('PX5: 展开层级持久化到 dsh-worktree-groups.expandLevels，不再读写 expandedAll', () => {
  assert.match(source, /const LS_EXPAND_LEVELS = 'dsh-worktree-groups\.expandLevels'/)
  assert.equal(source.includes("'dsh-worktree-groups.expandedAll'"), false)
  assert.match(source, /readLevelMap\(LS_EXPAND_LEVELS\)/)
  assert.match(source, /expandLevels,\n/, 'treeInput 必须传 expandLevels')
})

test('PX3: 折叠时用 containerKeysUnder 清零其下全部容器层级', () => {
  const body = callbackBody('toggleCollapsed')
  assert.match(body, /resetExpandLevels\(containerKeysUnder\(latestKnownProjects, key\)\)/)
  assert.match(body, /collapsedKeys\[key\] !== true/, '只在「展开 → 折叠」方向清零')
})

test('PX1/PX2: more 行 —— 有剩余给「展开更多 n」，canCollapse 给「收起」；点击分别 +1 / 清零', () => {
  const body = functionBody('MoreRowView')
  assert.match(body, /row\.hiddenCount > 0/)
  assert.match(body, /'sessions\.expandMore', \{ n: row\.nextCount \}/)
  assert.match(body, /row\.canCollapse/)
  assert.match(body, /'sessions\.collapse'/)
  assert.match(source, /onExpand: \(\) => \{ expandMore\(row\.parentKey\) \}/)
  assert.match(source, /onCollapse: \(\) => \{ resetExpandLevels\(\[row\.parentKey\]\) \}/)
  const expand = callbackBody('expandMore')
  assert.match(expand, /\(previous\[key\] \?\? 0\) \+ 1/)
})

test('ROW-MEMO: 会话行用 memo(SessionRowViewInner, sessionRowPropsEqual) 包装', () => {
  assert.match(source, /const SessionRowView = memo\(SessionRowViewInner, sessionRowPropsEqual\)/)
  assert.match(source, /from '\.\/row-memo\.js'/)
})

test('ROW-MEMO: 行内事件经稳定 handlers 容器取最新实现，props 里不再直接带处理器闭包', () => {
  const body = functionBody('SessionRowViewInner')
  assert.match(body, /props\.handlers\.current\.get\(props\.rowKey\)/)
  assert.equal(/props\.onOpen|props\.onMenu|:\s*drag\??\.on/.test(body), false, '行组件不得直接读处理器 props')
  for (const handler of ['onDragStart', 'onDragEnd', 'onDragOver', 'onDrop']) {
    assert.match(body, new RegExp(`live\\(\\)\\?\\.drag\\?\\.${handler}\\(`), `${handler} 必须经 live() 取最新实现`)
  }
  const start = source.indexOf('rowNodes.push(jsx(SessionRowView, {')
  const call = source.slice(start, source.indexOf('}))', start))
  assert.match(call, /handlers: sessionHandlersRef/)
  assert.match(call, /rowKey: row\.key/)
  assert.equal(/onOpen:|onMenu:/.test(call), false, '处理器不进 props（否则每次渲染都破坏 memo）')
  assert.match(source, /sessionHandlersRef\.current = sessionHandlers/, '父组件每次渲染刷新处理器表')
})

test('REMOTE-AC4: sources.workspaces(identity) 派生 workspacesSignature 驱动防抖重取，且 client.tsx 在 dshRemoteTargetActive 下跳过本机 desktopPicker', () => {
  assert.match(source, /const workspacesSnapshot = sources\.workspaces\(identity\)/)
  assert.match(source, /const workspacesSignature =/)
  const effect = source.slice(source.indexOf('setTimeout(reload, RELOAD_DEBOUNCE_MS)'))
  const deps = effect.slice(effect.indexOf('}, ['), effect.indexOf(']', effect.indexOf('}, [')) + 1)
  assert.ok(deps.includes('workspacesSignature'), `防抖重取依赖应含 workspacesSignature（远端工作区基线到达或切换时触发 reload）：${deps}`)

  const clientSource = readFileSync(new URL('../src/client.tsx', import.meta.url), 'utf8')
  assert.match(
    clientSource,
    /dshRemoteTargetActive/,
    'client.tsx 的 pickDirectory 在远端控制激活时应跳过本机 __DSH_DIRECTORY_PICKER__',
  )
})

