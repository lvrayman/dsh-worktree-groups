/**
 * 2026-11-14 性能优化（PERF1–PERF4）的行为测试。
 *
 * 需求：`docs/requirements/2026-11-14-perf-progressive-expand.md` §3.1。
 * 只断言公开行为：`/tree` 载荷内容、宿主服务被调用的次数、台账文件是否被重写、HTTP 头。
 * 全部夹具都在临时目录；`$DSH_HOME` 在顶层重定向，绝不写真实 `~/.dsh`。
 */

import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { after, test } from 'node:test'
import { promisify } from 'node:util'

import { createFileLedger } from '../lib/ledger.js'
import { ROUTE_PATHS, buildTreePayload, clearScanCache, registerRoutes } from '../lib/routes.js'

const pexec = promisify(execFile)
const tempRoots = []
const DSH_TMP_HOME = await mkdtemp(join(await realpath(tmpdir()), 'wtg-perf-home-'))
process.env.DSH_HOME = DSH_TMP_HOME
tempRoots.push(DSH_TMP_HOME)

after(async () => {
  for (const dir of tempRoots) await rm(dir, { recursive: true, force: true })
})

async function makeRoot(prefix) {
  const dir = await mkdtemp(join(await realpath(tmpdir()), `${prefix}-`))
  tempRoots.push(dir)
  return dir
}

async function makeGitFixture(prefix) {
  const root = await makeRoot(prefix)
  const repo = join(root, 'demo-repo')
  await mkdir(repo, { recursive: true })
  const git = async (args, cwd = repo) => (await pexec('git', args, { cwd })).stdout
  await git(['init', '-q', '-b', 'main'])
  await git(['config', 'user.email', 'test@example.invalid'])
  await git(['config', 'user.name', 'perf test'])
  await writeFile(join(repo, 'README.md'), 'fixture\n', 'utf8')
  await git(['add', '.'])
  await git(['commit', '-q', '-m', 'init'])
  return { root, repo, git }
}

function makeCtx(map, extra = {}) {
  return {
    get: (name) => map[name],
    logger: { warn() {} },
    effect(fn) {
      return fn()
    },
    ...extra,
  }
}

function registryOf(paths) {
  return {
    list: () => paths.map((path, index) => ({ id: `ws-${index}`, path, title: '', createdAt: '', updatedAt: '' })),
    archivedSessionIds: [],
  }
}

function worktreePathsOf(payload) {
  return payload.projects.flatMap((project) => project.worktrees.map((node) => ({ path: node.path, exists: node.exists })))
}

function makeResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: undefined,
    headersSent: false,
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value
    },
    writeHead(code, headers) {
      this.statusCode = code
      for (const [name, value] of Object.entries(headers ?? {})) this.headers[name.toLowerCase()] = value
      this.headersSent = true
      return this
    },
    end(payload) {
      this.headersSent = true
      this.raw = payload
      if (typeof payload === 'string' && payload !== '') this.body = JSON.parse(payload)
    },
  }
}

function makeRequest(body, headers = {}) {
  const req = Readable.from([Buffer.from(JSON.stringify(body ?? {}), 'utf8')])
  req.headers = headers
  return req
}

/** 注册真实路由，返回 `/tree` handler 与 `session/event` 监听器。 */
function registerTree(map) {
  const routes = new Map()
  const listeners = new Map()
  const ctx = makeCtx(
    {
      ...map,
      webServer: {
        register(route) {
          routes.set(route.path, route)
          return () => routes.delete(route.path)
        },
      },
    },
    {
      on(name, listener) {
        listeners.set(name, listener)
        return () => listeners.delete(name)
      },
    },
  )
  clearScanCache()
  registerRoutes(ctx)
  const handler = routes.get(ROUTE_PATHS.tree)?.handler
  assert.equal(typeof handler, 'function', '前置条件：/tree 已注册')
  return {
    async call(headers = {}) {
      const res = makeResponse()
      await handler(makeRequest({}, headers), res)
      return res
    },
    emit(sessionId, time) {
      listeners.get('session/event')?.({ id: sessionId }, { time })
    },
  }
}

function persistenceOf(headers, counter) {
  return {
    async list() {
      counter.persistence += 1
      return headers.map((header) => ({ header, revision: 'r1' }))
    },
  }
}

function controllerOf(summaries, counter, delayMs = 0) {
  return {
    async list() {
      counter.controller += 1
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
      return { items: summaries() }
    },
  }
}

/* ---------------- PERF3：git 扫描缓存按指纹失效 ---------------- */

test('PERF3: git worktree add 后下一次 /tree 立即出现新 worktree（不等 30 s 缓存）', async () => {
  const { root, repo, git } = await makeGitFixture('perf-wt-add')
  const ledger = createFileLedger(join(root, 'ledger-home'))
  const ctx = makeCtx({ workspaceRegistry: registryOf([repo]) })
  clearScanCache()

  const first = await buildTreePayload(ctx, { ledger })
  assert.deepEqual(worktreePathsOf(first).map((entry) => entry.path), [repo])

  const added = join(root, 'demo-feature')
  await git(['worktree', 'add', '-q', '-b', 'feature/x', added])
  const second = await buildTreePayload(ctx, { ledger })
  assert.deepEqual(
    worktreePathsOf(second).map((entry) => entry.path).sort(),
    [added, repo].sort(),
    '新 worktree 必须在下一次请求中出现',
  )
})

test('PERF3: worktree 目录被删除后下一次 /tree 立即标记为不存在', async () => {
  const { root, repo, git } = await makeGitFixture('perf-wt-rm')
  const added = join(root, 'demo-gone')
  await git(['worktree', 'add', '-q', '-b', 'gone', added])
  const ledger = createFileLedger(join(root, 'ledger-home'))
  const ctx = makeCtx({ workspaceRegistry: registryOf([repo]) })
  clearScanCache()

  const first = await buildTreePayload(ctx, { ledger })
  assert.equal(worktreePathsOf(first).find((entry) => entry.path === added)?.exists, true)

  await rm(added, { recursive: true, force: true })
  const second = await buildTreePayload(ctx, { ledger })
  assert.equal(worktreePathsOf(second).find((entry) => entry.path === added)?.exists, false)
})

test('PERF3: 主树切换分支后下一次 /tree 立即反映新分支名', async () => {
  const { root, repo, git } = await makeGitFixture('perf-branch')
  const ledger = createFileLedger(join(root, 'ledger-home'))
  const ctx = makeCtx({ workspaceRegistry: registryOf([repo]) })
  clearScanCache()

  const first = await buildTreePayload(ctx, { ledger })
  assert.equal(first.projects[0]?.worktrees[0]?.branch, 'main')
  await git(['checkout', '-q', '-b', 'develop'])
  const second = await buildTreePayload(ctx, { ledger })
  assert.equal(second.projects[0]?.worktrees[0]?.branch, 'develop')
})

/* ---------------- PERF2：台账只在实质变化时写盘 ---------------- */

test('PERF2: 事实未变时 1 小时内的重复 /tree 不重写台账；超过 1 小时才刷新 lastSeenAt', async () => {
  const { root, repo } = await makeGitFixture('perf-ledger')
  const home = join(root, 'ledger-home')
  const ledger = createFileLedger(home)
  const ctx = makeCtx({ workspaceRegistry: registryOf([repo]) })
  clearScanCache()
  const file = join(home, 'worktree-groups.json')
  const t0 = 1_800_000_000_000

  await buildTreePayload(ctx, { ledger, now: t0 })
  const firstText = await readFile(file, 'utf8')
  const firstStat = await stat(file)

  await buildTreePayload(ctx, { ledger, now: t0 + 10 * 60_000 })
  assert.equal(await readFile(file, 'utf8'), firstText, '10 分钟后事实未变 ⇒ 台账内容不变')
  assert.equal((await stat(file)).mtimeMs, firstStat.mtimeMs, '10 分钟后事实未变 ⇒ 不写盘')

  await buildTreePayload(ctx, { ledger, now: t0 + 2 * 60 * 60_000 })
  const refreshed = JSON.parse(await readFile(file, 'utf8'))
  const entry = Object.values(refreshed.projects)[0]?.worktrees?.[repo]
  assert.equal(entry?.lastSeenAt, t0 + 2 * 60 * 60_000, '超过 1 小时 ⇒ lastSeenAt 刷新')
  assert.equal(entry?.firstSeenAt, t0)
})

test('PERF2: 台账读缓存能感知外部改写', async () => {
  const root = await makeRoot('perf-ledger-ext')
  const home = join(root, 'ledger-home')
  const ledger = createFileLedger(home)
  await ledger.write({ version: 1, projects: {}, sessions: { a: { projectKey: 'p', worktreePath: '/x' } } })
  assert.deepEqual(Object.keys((await ledger.read()).sessions), ['a'])
  await new Promise((resolve) => setTimeout(resolve, 20))
  await writeFile(
    join(home, 'worktree-groups.json'),
    JSON.stringify({ version: 1, projects: {}, sessions: { b: { projectKey: 'p', worktreePath: '/y' } } }),
    'utf8',
  )
  assert.deepEqual(Object.keys((await ledger.read()).sessions), ['b'])
})

/* ---------------- PERF1：会话列举缓存 + single-flight ---------------- */

test('PERF1: 并发的 /tree 请求合并计算，不会各自全量列举会话', async () => {
  const counter = { controller: 0, persistence: 0 }
  const header = { id: 'session-a', cwd: '/tmp/none', createdAt: 1 }
  const tree = registerTree({
    sessionController: controllerOf(() => [{ sessionId: 'session-a', updatedAt: 5, running: false, blank: false, cwd: '/tmp/none' }], counter, 40),
    sessionPersistence: persistenceOf([header], counter),
    workspaceRegistry: registryOf([]),
  })
  const results = await Promise.all([tree.call(), tree.call(), tree.call(), tree.call(), tree.call()])
  for (const res of results) assert.equal(res.statusCode, 200)
  assert.ok(counter.controller <= 2, `5 个并发请求最多触发 2 次列举（实际 ${counter.controller}）`)
})

test('PERF1: 无会话活动时复用会话列举；session/event 或新的活会话使缓存失效', async () => {
  const counter = { controller: 0, persistence: 0 }
  const live = [{ id: 'session-a', header: { id: 'session-a', cwd: '/tmp/none', createdAt: 1 } }]
  let summaries = [{ sessionId: 'session-a', updatedAt: 5, running: false, blank: false, cwd: '/tmp/none' }]
  const tree = registerTree({
    sessionController: controllerOf(() => summaries, counter),
    sessionPersistence: persistenceOf([{ id: 'session-a', cwd: '/tmp/none', createdAt: 1 }], counter),
    sessions: { list: () => live },
    workspaceRegistry: registryOf([]),
  })

  await tree.call()
  await tree.call()
  assert.equal(counter.persistence, 1, '无活动的第二次请求不再扫盘')

  tree.emit('session-a', 10)
  const third = await tree.call()
  assert.equal(counter.persistence, 2, 'session/event 之后重新列举')
  assert.equal(third.body.ungrouped.find((row) => row.sessionId === 'session-a')?.lastActivityAt, 10)

  live.push({ id: 'session-b', header: { id: 'session-b', cwd: '/tmp/none', createdAt: 2 } })
  summaries = [...summaries, { sessionId: 'session-b', updatedAt: 6, running: false, blank: false, cwd: '/tmp/none' }]
  const fourth = await tree.call()
  assert.equal(counter.persistence, 3, '出现新的活会话 ⇒ 重新列举')
  assert.ok(fourth.body.ungrouped.some((row) => row.sessionId === 'session-b'), '新会话出现在载荷里')
})

/* ---------------- PERF4：ETag / 304 ---------------- */

test('PERF4: /tree 带 ETag；If-None-Match 命中时返回 304 且无响应体', async () => {
  const counter = { controller: 0, persistence: 0 }
  const tree = registerTree({
    sessionController: controllerOf(() => [], counter),
    workspaceRegistry: registryOf([]),
  })
  const first = await tree.call()
  assert.equal(first.statusCode, 200)
  const etag = first.headers.etag
  assert.equal(typeof etag, 'string')
  assert.ok(etag.length > 0)

  const second = await tree.call({ 'if-none-match': etag })
  assert.equal(second.statusCode, 304)
  assert.equal(second.body, undefined)

  const third = await tree.call({ 'if-none-match': '"stale"' })
  assert.equal(third.statusCode, 200)
  assert.equal(third.headers.etag, etag)
})
