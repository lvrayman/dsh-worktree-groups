/**
 * 回归单测：`src/locales.ts` 的 **seat 取词兜底**（`createSeatT`）。
 *
 * ## 为什么有这个文件
 *
 * 2026-09-23 用户报告「右键所有菜单都变成英文 key 了，没有正确显示中文」。
 * 根因不是词条缺失，而是**词典注册依赖启动时序**：
 *
 * 1. `src/client.tsx` 用一次性 `ctx.get('locale')` 探测宿主 locale 服务，探测不到就
 *    **静默跳过** `locale.register(LOCALE_NS, { zh })`；
 * 2. DSH web 启动**并发创建所有 client entry**（`Promise.all(loader.create(...))`），
 *    而 locale 插件自身还要等 `slots` + `remote` + `settingsScope` 才 apply
 *    ⇒ 本插件的 apply **可能先跑**，注册被跳过；
 * 3. entry 声明了 `locale` 就**一定**会拿到 seat `t`（`standardKit` 用 `face.bind(ns)`），
 *    组件里的 `FALLBACK_T` 永远走不到；
 * 4. seat 在空命名空间里查不到任何词条 ⇒ 按宿主规则**返回 key 本身** ⇒ 界面露裸 key。
 *
 * 修法分两层：① `client.tsx` 改成等 `locale` 服务出现再注册（治因）；
 * ② `createSeatT` 在 seat **返回 key 本身**（未解析）或**抛错**时回落内置 `zh`（治果）。
 * 本文件覆盖 ②：它是纯逻辑，能被 `node --test` 直接执行（`.tsx` 不进 `lib/`，无法单测）。
 *
 * ## 断言口径（对应用户可见承诺）
 *
 * - seat 未解析 ⇒ **绝不**把 key 当文案渲染；
 * - seat 已解析 ⇒ **逐字透传**（不覆盖宿主 `common` 命名空间的译文 / 其它语言译文）；
 * - 占位符在兜底路径上照常替换（否则会显示「展开其余 {n} 个会话」）；
 * - 同一 seat 引用 ⇒ 同一包装引用（`sidebar.tsx` 的 `useMemo` 依赖不能每帧失效）。
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createSeatT, createT, zh } from '../lib/locales.js'

/** 造一个「什么 key 都解不出来」的 seat（模拟空命名空间）。 */
const unresolvedSeat = (key) => key

test('locales/createSeatT: seat 未解析时回落内置中文（不再渲染裸 key）', () => {
  const t = createSeatT(unresolvedSeat)
  assert.equal(t('menu.newSession'), '新建会话')
  assert.equal(t('worktree.create'), '新建 worktree…')
  assert.equal(t('menu.resetOrder'), '恢复默认排序')
  // 与内置表逐条对齐，防止兜底只覆盖部分 key
  for (const [key, value] of Object.entries(zh)) assert.equal(t(key), value, `兜底漏了 ${key}`)
})

test('locales/createSeatT: seat 已解析时逐字透传（不覆盖宿主译文）', () => {
  // 宿主 common 命名空间可能命中同名 key（如 menu.fork），或用户在别的语言下：
  // 只要 seat 返回的不是 key，就必须原样使用。
  const seat = (key) => (key === 'menu.fork' ? 'Fork session' : key)
  const t = createSeatT(seat)
  assert.equal(t('menu.fork'), 'Fork session')
  // 未解析的仍然兜底
  assert.equal(t('menu.archive'), '归档')
})

test('locales/createSeatT: 兜底路径同样替换占位符', () => {
  const t = createSeatT(unresolvedSeat)
  assert.equal(t('sessions.expand', { n: 29 }), '展开其余 29 个会话')
  assert.equal(t('a11y.subagents', { n: 3 }), '3 个子代理运行中')
  assert.equal(t('worktree.createTitle', { name: 'MyProject' }), '在 MyProject 下新建 worktree')
  // 占位符缺失时保留原样（与 createT 一致，不崩、不抛）
  assert.equal(t('sessions.expand'), '展开其余 {n} 个会话')
})

test('locales/createSeatT: seat 抛错时回落内置中文（渲染期绝不因取词崩）', () => {
  const seat = () => { throw new Error('locale face exploded') }
  const t = createSeatT(seat)
  assert.equal(t('menu.newSession'), '新建会话')
  // 内置表也没有的 key ⇒ 返回 key 本身（与 createT 同口径）
  assert.equal(t('not.exists'), 'not.exists')
})

test('locales/createSeatT: 未知 key 且 seat 未解析 ⇒ 返回 key 本身', () => {
  const t = createSeatT(unresolvedSeat)
  assert.equal(t('not.exists'), 'not.exists')
  // 原型链上的 key 不得被当成词条（与 createT 同口径）
  assert.equal(t('toString'), 'toString')
})

test('locales/createSeatT: 同一 seat 引用返回同一包装（useMemo 依赖稳定）', () => {
  const seat = unresolvedSeat
  assert.equal(createSeatT(seat), createSeatT(seat))
  assert.notEqual(createSeatT(seat), createSeatT((key) => key))
  // 不同词条表 ⇒ 不同包装（缓存键含 dict）
  assert.notEqual(createSeatT(seat), createSeatT(seat, { 'menu.newSession': 'New session' }))
})

test('locales/createSeatT: 可注入自定义词条表（便于后续加英文表）', () => {
  const t = createSeatT(unresolvedSeat, { 'menu.newSession': 'New session' })
  assert.equal(t('menu.newSession'), 'New session')
  // 自定义表里没有的 key ⇒ 返回 key（不回落内置 zh，保持表语义单一）
  assert.equal(t('menu.archive'), 'menu.archive')
})

test('locales/createT: 既有取词口径不回归', () => {
  const t = createT()
  assert.equal(t('menu.newSession'), '新建会话')
  assert.equal(t('not.exists'), 'not.exists')
  assert.equal(t('sessions.expand', { n: 2 }), '展开其余 2 个会话')
})

// ────────────────────────────────────────────────────────────────────────────
// T-7 补测（审查报告 F4 / 需求 AC9）
//
// 为什么必须单独钉：上面的 `for (const [key, value] of Object.entries(zh))` 对
// 「词典里**有没有** `a11y.runningTask`」「中文文案**对不对**」**恒真**（T-6 实测：
// 删掉词条后 `test/locales.test.mjs + test/sidebar-wiring.test.mjs` 仍 32/32 绿）。
// 而 `src/sidebar.tsx` 的 title 只锁了 key 字面量 —— 词条一旦缺失，运行时会把裸 key
// `a11y.runningTask` 当文案渲染，正是 2026-09-23「侧栏渲染裸 key」缺陷类型。
// 因此这里**直接钉 key 与中文文案**，并同时覆盖两条取词路径（`createT` / seat 兜底）。
// ────────────────────────────────────────────────────────────────────────────

test('locales: `a11y.runningTask` 词条存在且中文文案为「有任务正在运行」（AC9）', () => {
  assert.equal(
    zh['a11y.runningTask'],
    '有任务正在运行',
    '★ F4：`zh` 必须含 `a11y.runningTask` = 「有任务正在运行」（删词条 / 改文案都必须红，' +
      '否则运行中行的 title 会渲染裸 key）',
  )

  const t = createT()
  assert.equal(t('a11y.runningTask'), '有任务正在运行', '★ `createT()` 必须取到该文案（不是 key）')

  const seatT = createSeatT(unresolvedSeat)
  assert.equal(
    seatT('a11y.runningTask'),
    '有任务正在运行',
    '★ seat 未解析时 `createSeatT` 必须回落该文案（渲染期绝不露裸 key）',
  )
})

test('locales/2026-10-21: 最近分区与归档工作空间设置页词条存在且生效（AC1）', () => {
  assert.equal(zh['section.recent'], '最近')
  assert.equal(zh['menu.archiveWorkspace'], '归档工作空间')
  assert.equal(zh['settings.archivedWorkspaces.title'], '已归档的工作空间')
  assert.equal(
    zh['settings.archivedWorkspaces.description'],
    '归档后的工作空间及其会话不在侧栏显示，可在此放出恢复，或重新添加相同目录自动放出',
  )
  assert.equal(zh['settings.archivedWorkspaces.empty'], '暂无已归档的工作空间')
  assert.equal(zh['settings.archivedWorkspaces.restore'], '放出')

  const t = createT()
  assert.equal(t('section.recent'), '最近')
  assert.equal(t('menu.archiveWorkspace'), '归档工作空间')
  assert.equal(t('settings.archivedWorkspaces.restore'), '放出')

  const seatT = createSeatT(unresolvedSeat)
  assert.equal(seatT('section.recent'), '最近')
  assert.equal(seatT('menu.archiveWorkspace'), '归档工作空间')
  assert.equal(seatT('settings.archivedWorkspaces.restore'), '放出')
})


test('2026-11-14 PX1: sessions.expandMore 插值本次展开条数', async () => {
  const { createT, zh } = await import('../lib/locales.js')
  const tr = createT(zh)
  assert.equal(tr('sessions.expandMore', { n: 10 }), '展开更多 10 个')
  assert.equal(tr('sessions.collapse'), '收起')
})
