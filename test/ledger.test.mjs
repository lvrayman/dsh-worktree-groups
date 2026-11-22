/**
 * T6 单测：`src/ledger.ts`（契约 `docs/INTERFACES.md` §1.4 / §4）。
 *
 * 全部用 `fs.mkdtemp` 造临时 home，**绝不**触碰真实 `~/.dsh/`。
 * 断言风格：`assert.equal(actual, expected, '说明')` / `assert.deepEqual`，失败时能看出期望 vs 实际。
 */

import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { createFileLedger, emptyLedger } from '../lib/ledger.js'

/** 台账文件名（与实现同源，写测试用例时直接引用以免散落魔法字符串）。 */
const LEDGER_FILE = 'worktree-groups.json'

/** 已创建的临时 home 目录，`after` 钩子统一清理。 */
const tempDirs = []

/** 造一个临时 home 目录（唯一入口，保证从不碰真实 `~/.dsh`）。 */
async function makeHome() {
  const dir = await mkdtemp(join(tmpdir(), 'wtg-ledger-'))
  tempDirs.push(dir)
  return dir
}

/** 临时 home 里的台账文件绝对路径。 */
function ledgerPath(home) {
  return join(home, LEDGER_FILE)
}

/** 一条 project + 一条 session 的样本数据。 */
function sampleData() {
  return {
    version: 1,
    projects: {
      '/repo/.git': {
        mainPath: '/repo',
        worktrees: {
          '/repo': { branch: 'main', firstSeenAt: 1, lastSeenAt: 2 },
          '/repo-feat': { branch: 'feat', firstSeenAt: 3, lastSeenAt: 4, goneAt: 5 },
        },
      },
    },
    sessions: {
      'session-a': { projectKey: '/repo/.git', worktreePath: '/repo-feat' },
    },
  }
}

after(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
})

test('ledger: 目录里没有台账文件时 read() 返回空台账且不抛错', async () => {
  const home = await makeHome()
  const store = createFileLedger(home)

  const data = await store.read()
  assert.deepEqual(
    data,
    { version: 1, projects: {}, sessions: {} },
    '首次使用（文件不存在）应为空台账 {version:1,projects:{},sessions:{}}',
  )

  const entries = await readdir(home)
  assert.deepEqual(entries, [], 'read() 不应在空目录里创建任何文件')
})

test('ledger: write() 后 read() 读回的内容与写入一致（往返）', async () => {
  const home = await makeHome()
  const store = createFileLedger(home)
  const payload = sampleData()

  await store.write(payload)
  const readBack = await store.read()

  assert.deepEqual(readBack, payload, 'write → read 应逐字段往返一致（project + session 各一条）')
  assert.deepEqual(
    Object.keys(readBack.projects),
    ['/repo/.git'],
    'project 键应保持为 commonDir 原值',
  )
  assert.deepEqual(
    readBack.sessions['session-a'],
    { projectKey: '/repo/.git', worktreePath: '/repo-feat' },
    'session 归属快照应原样读回',
  )
})

test('ledger: update() 写入 project + session 后再 read() 内容一致', async () => {
  const home = await makeHome()
  const store = createFileLedger(home)

  const returned = await store.update((data) => ({
    ...data,
    projects: { ...data.projects, '/repo/.git': { mainPath: '/repo', worktrees: {} } },
    sessions: { ...data.sessions, 'session-a': { projectKey: '/repo/.git', worktreePath: '/repo' } },
  }))

  const readBack = await store.read()
  assert.deepEqual(readBack, returned, 'update() 的返回值应与随后 read() 的内容一致')
  assert.deepEqual(
    readBack.projects['/repo/.git'],
    { mainPath: '/repo', worktrees: {} },
    'project 记录应落盘',
  )
  assert.deepEqual(
    readBack.sessions['session-a'],
    { projectKey: '/repo/.git', worktreePath: '/repo' },
    'session 记录应落盘',
  )
})

test('ledger: 坏 JSON ⇒ read() 返回空台账并生成 .bad- 备份文件', async () => {
  const home = await makeHome()
  await writeFile(ledgerPath(home), '{ not json at all', 'utf8')

  const store = createFileLedger(home)
  const data = await store.read()

  assert.deepEqual(data, { version: 1, projects: {}, sessions: {} }, '损坏 JSON 应降级为空台账')

  const backups = (await readdir(home)).filter((name) => name.includes('.bad-'))
  assert.equal(backups.length, 1, `坏 JSON 应产生恰好 1 个 .bad- 备份，实际目录内容：${(await readdir(home)).join(', ')}`)
  assert.match(backups[0], /^worktree-groups\.json\.bad-\d+/, '备份名应为 <file>.bad-<时间戳> 形态')

  const backupText = await readFile(join(home, backups[0]), 'utf8')
  assert.equal(backupText, '{ not json at all', '备份内容应是原始坏文件内容（未被改写）')
  assert.deepEqual(
    await readdir(home).then((names) => names.filter((n) => n === LEDGER_FILE)),
    [],
    '坏文件应被 rename 走（原地不再留下坏文件）',
  )
})

test('ledger: version !== 1 ⇒ 空台账 + .bad- 备份（结构完整但版本不符）', async () => {
  const home = await makeHome()
  await writeFile(
    ledgerPath(home),
    JSON.stringify({ version: 2, projects: { '/repo/.git': { mainPath: '/repo', worktrees: {} } }, sessions: {} }),
    'utf8',
  )

  const store = createFileLedger(home)
  const data = await store.read()

  assert.deepEqual(data, { version: 1, projects: {}, sessions: {} }, '版本不符应降级为空台账（不抛错）')

  const backups = (await readdir(home)).filter((name) => name.includes('.bad-'))
  assert.equal(backups.length, 1, '版本不符应产生 1 个 .bad- 备份')
  assert.deepEqual(
    JSON.parse(await readFile(join(home, backups[0]), 'utf8')),
    { version: 2, projects: { '/repo/.git': { mainPath: '/repo', worktrees: {} } }, sessions: {} },
    '备份应保留原始（version:2）内容',
  )
})

test('ledger: 结构缺字段（缺 sessions）同样按坏文件处理', async () => {
  const home = await makeHome()
  await writeFile(ledgerPath(home), JSON.stringify({ version: 1, projects: {} }), 'utf8')

  const store = createFileLedger(home)
  const data = await store.read()

  assert.deepEqual(data, { version: 1, projects: {}, sessions: {} }, '缺 sessions 字段应视为损坏')
  const backups = (await readdir(home)).filter((name) => name.includes('.bad-'))
  assert.equal(backups.length, 1, '缺字段应产生 1 个 .bad- 备份')
})

test('ledger: 并发 5 个 update 全部落盘（验证内部串行化，无丢失更新）', async () => {
  const home = await makeHome()
  const store = createFileLedger(home)

  const ids = ['s0', 's1', 's2', 's3', 's4']
  await Promise.all(
    ids.map((id, i) =>
      store.update((data) => ({
        ...data,
        sessions: { ...data.sessions, [id]: { projectKey: `p${i}`, worktreePath: `/w/${id}` } },
      })),
    ),
  )

  const data = await store.read()
  assert.deepEqual(
    Object.keys(data.sessions).sort(),
    ['s0', 's1', 's2', 's3', 's4'],
    '5 个并发 update 的结果必须全部存在（若未串行化会丢更新）',
  )
  assert.equal(data.sessions['s3'].worktreePath, '/w/s3', '每条记录的内容应属于它自己的那次 update')
})

test('ledger: 并发 5 个 read 结果一致（读也走同一条串行链）', async () => {
  const home = await makeHome()
  const store = createFileLedger(home)
  await store.write(sampleData())

  const results = await Promise.all([store.read(), store.read(), store.read(), store.read(), store.read()])
  for (const [i, result] of results.entries()) {
    assert.deepEqual(result, sampleData(), `第 ${i} 个并发 read 应返回同样的台账内容`)
  }
})

test('ledger: 抛错的 update 被 catch 后，紧随的 update 仍能成功（链未毒化）', async () => {
  const home = await makeHome()
  const store = createFileLedger(home)

  await store.update((data) => ({ ...data, sessions: { ...data.sessions, before: { projectKey: 'p', worktreePath: '/w' } } }))

  await assert.rejects(
    () => store.update(() => {
      throw new Error('boom')
    }),
    /boom/,
    '回调抛错应原样上抛给调用方',
  )

  await store.update((data) => ({ ...data, sessions: { ...data.sessions, after: { projectKey: 'p2', worktreePath: '/w2' } } }))

  const data = await store.read()
  assert.deepEqual(
    Object.keys(data.sessions).sort(),
    ['after', 'before'],
    '抛错后的 update 必须仍能成功，且此前成功写入的数据不丢',
  )

  const entries = await readdir(home)
  assert.deepEqual(
    entries.filter((name) => name.endsWith('.tmp')),
    [],
    `抛错不应留下 .tmp 残留，实际目录内容：${entries.join(', ')}`,
  )
})

test('ledger: 写盘失败（JSON.stringify 循环引用）后链仍可用且无 .tmp 残留', async () => {
  const home = await makeHome()
  const store = createFileLedger(home)
  await store.write(sampleData())

  const circular = {}
  circular.self = circular

  await assert.rejects(
    () => store.write({ version: 1, projects: {}, sessions: { bad: circular } }),
    TypeError,
    '循环引用应让 write() 抛 TypeError（而非静默写坏文件）',
  )

  await store.update((data) => ({ ...data, sessions: { ...data.sessions, ok: { projectKey: 'p', worktreePath: '/w' } } }))

  const data = await store.read()
  assert.deepEqual(
    Object.keys(data.sessions).sort(),
    ['ok', 'session-a'],
    '写盘失败后，旧数据应完好（原子写不产生半截文件），且后续 update 成功',
  )

  const entries = await readdir(home)
  assert.deepEqual(
    entries.filter((name) => name.endsWith('.tmp')),
    [],
    `写盘失败必须清理 .tmp，实际目录内容：${entries.join(', ')}`,
  )
})

test('ledger: 写盘后目录里不残留 .tmp 文件，且台账文件权限为 0o600', async () => {
  const home = await makeHome()
  const store = createFileLedger(home)

  await store.write(sampleData())
  await store.update((data) => ({ ...data, sessions: { ...data.sessions, extra: { projectKey: 'p', worktreePath: '/w' } } }))

  const entries = await readdir(home)
  assert.deepEqual(entries, [LEDGER_FILE], `原子写完成后目录应只有台账文件，实际：${entries.join(', ')}`)

  const mode = (await stat(ledgerPath(home))).mode & 0o777
  assert.equal(mode.toString(8), '600', '台账文件权限应为 0o600')
})

test('ledger: 文件内容形态为「2 空格缩进 JSON + 尾换行」', async () => {
  const home = await makeHome()
  const store = createFileLedger(home)
  await store.write(sampleData())

  const raw = await readFile(ledgerPath(home), 'utf8')
  assert.equal(raw, `${JSON.stringify(sampleData(), null, 2)}\n`, '落盘文本应为 JSON.stringify(data, null, 2) + "\\n"')
})

test('ledger: read() 返回的对象是独立副本，改动它不影响 store（再读仍是原值）', async () => {
  const home = await makeHome()
  const store = createFileLedger(home)
  const payload = sampleData()
  await store.write(payload)

  const first = await store.read()
  first.projects['/repo/.git'].mainPath = 'TAMPERED'
  first.projects['/injected/.git'] = { mainPath: '/injected', worktrees: {} }
  first.sessions['session-a'].worktreePath = 'TAMPERED'
  delete first.sessions['session-a']

  const second = await store.read()
  assert.deepEqual(second, payload, 'read() 的返回值被就地修改后，再读应仍是磁盘上的原值')
  assert.equal(second.projects['/repo/.git'].mainPath, '/repo', 'project.mainPath 不应被上一次 read 的改动污染')
  assert.equal(
    second.sessions['session-a'].worktreePath,
    '/repo-feat',
    'session.worktreePath 不应被上一次 read 的改动污染',
  )
})

test('ledger: 两次 read() 返回不同对象引用（不共享单例）', async () => {
  const home = await makeHome()
  const store = createFileLedger(home)
  await store.write(sampleData())

  const a = await store.read()
  const b = await store.read()
  assert.notEqual(a, b, '两次 read() 应是两个不同的对象')
  assert.notEqual(a.projects, b.projects, 'projects 表不应共享引用')
  assert.notEqual(a.sessions, b.sessions, 'sessions 表不应共享引用')
})

test('ledger: 回调返回同一引用 ⇒ 跳过写盘（不产生写盘痕迹），但仍返回数据', async () => {
  const home = await makeHome()
  const store = createFileLedger(home)

  const returned = await store.update((data) => data)
  assert.deepEqual(returned, { version: 1, projects: {}, sessions: {} }, 'no-op update 应返回当前（空）台账')

  const entries = await readdir(home)
  assert.deepEqual(entries, [], `回调返回同一引用时不应写盘，实际目录内容：${entries.join(', ')}`)
})

test('ledger: emptyLedger() 每次返回新对象，互不共享引用', () => {
  const a = emptyLedger()
  const b = emptyLedger()

  assert.notEqual(a, b, 'emptyLedger() 每次调用都应返回新对象')
  assert.notEqual(a.projects, b.projects, 'projects 表应是独立对象')
  assert.notEqual(a.sessions, b.sessions, 'sessions 表应是独立对象')
  assert.deepEqual(a, { version: 1, projects: {}, sessions: {} }, '空台账结构固定为 {version:1,projects:{},sessions:{}}')

  a.projects['/x/.git'] = { mainPath: '/x', worktrees: {} }
  a.sessions['s'] = { projectKey: '/x/.git', worktreePath: '/x' }
  assert.deepEqual(b, { version: 1, projects: {}, sessions: {} }, '改动 a 不应影响 b')
  assert.deepEqual(emptyLedger(), { version: 1, projects: {}, sessions: {} }, '第三次调用仍应为干净空台账')
})

test('ledger: 显式 homeDir 下的两次失败读会产生两个不同的备份名（不互相覆盖）', async () => {
  const home = await makeHome()
  const store = createFileLedger(home)

  await writeFile(ledgerPath(home), 'garbage-1', 'utf8')
  assert.deepEqual(await store.read(), { version: 1, projects: {}, sessions: {} }, '第一次坏文件读应降级')
  await new Promise((resolve) => setTimeout(resolve, 5))
  await writeFile(ledgerPath(home), 'garbage-2', 'utf8')
  assert.deepEqual(await store.read(), { version: 1, projects: {}, sessions: {} }, '第二次坏文件读应降级')

  const backups = (await readdir(home)).filter((name) => name.includes('.bad-'))
  assert.equal(backups.length, 2, `两次损坏应各留一份备份，实际：${backups.join(', ')}`)
  const contents = await Promise.all(backups.map((name) => readFile(join(home, name), 'utf8')))
  assert.deepEqual(contents.sort(), ['garbage-1', 'garbage-2'], '两份备份应分别保留各自的坏内容')
})

test('ledger: 同一毫秒内连续两次损坏读 ⇒ 备份名自动加后缀，两份都不丢', async () => {
  const home = await makeHome()
  const store = createFileLedger(home)

  // 冻结时间，让两次备份的候选名完全相同，从而确定性地走到「名字被占用 ⇒ 换后缀」分支。
  const realNow = Date.now
  Date.now = () => 1700000000000
  try {
    await writeFile(ledgerPath(home), 'same-ms-1', 'utf8')
    assert.deepEqual(await store.read(), { version: 1, projects: {}, sessions: {} }, '第一次损坏读应降级')
    await writeFile(ledgerPath(home), 'same-ms-2', 'utf8')
    assert.deepEqual(await store.read(), { version: 1, projects: {}, sessions: {} }, '第二次损坏读应降级')
  } finally {
    Date.now = realNow
  }

  const backups = (await readdir(home)).filter((name) => name.includes('.bad-')).sort()
  assert.deepEqual(
    backups,
    ['worktree-groups.json.bad-1700000000000', 'worktree-groups.json.bad-1700000000000-1'],
    `同名候选应自动加 -1 后缀，实际：${backups.join(', ')}`,
  )
  const contents = await Promise.all(backups.map((name) => readFile(join(home, name), 'utf8')))
  assert.deepEqual(contents.sort(), ['same-ms-1', 'same-ms-2'], '两份备份内容都不丢')
})

test('ledger: homeDir 指向不存在的深层目录 ⇒ read() 返回空台账且不抛错（不预建目录）', async () => {
  const home = await makeHome()
  const nested = join(home, 'a', 'b', 'c')
  const store = createFileLedger(nested)

  assert.deepEqual(await store.read(), { version: 1, projects: {}, sessions: {} }, '目录不存在 ⇒ ENOENT ⇒ 空台账')
  assert.deepEqual(await readdir(home), [], 'read() 不应顺手创建目录')

  await store.write(sampleData())
  assert.deepEqual(await store.read(), sampleData(), 'write() 应自动创建目录并成功落盘')
})
