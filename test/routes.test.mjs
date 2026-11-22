/**
 * T7 单测：`src/routes.ts`（宿主组装层 + 全部 HTTP 路由 + 安全白名单）。
 *
 * ## 为什么有这个文件（D-23：测试虚假信心）
 *
 * 在本文件之前，`test/` 下的用例只导入 `../lib/ledger.js` / `../lib/projects.js` /
 * `../lib/tree-model.js` / `../lib/git.js` —— **没有任何一个测试导入 `../lib/routes.js`**。
 * 于是 `routes.ts`（宿主契约的组装层、5 个 HTTP 路由、全部路径白名单）零覆盖，而独立审查
 * 的 7 个缺陷（D-2 / D-5 / D-6 / D-7 / D-8 / D-10 / D-11）**全部**落在那里。
 * 更糟的是 `test/tree-model.test.mjs` 里有一条用「宿主永远给不出的值」断言「透传正确」，
 * 制造了**虚假信心**，恰好掩盖了 D-2。本文件把宿主链路的输入端补上。
 *
 * ## ⚠️ 会话行两个状态的来源（本文件 §1 锁定的能力边界，勿删）
 *
 * 会话行的「等待确认」琥珀态与「后台完成未读」绿勾**不来自**本插件的 HTTP 响应：
 * 宿主 `SessionSummary` 的真实字段集只有
 * `sessionId / updatedAt / running / blank / parentSessionId / origin / cwd / projections`
 * （契约 `docs/HOST-CONTRACTS.md` §A2.2 的权威声明），**既没有 `pendingInteraction`、
 * 也没有 `completed`**。这两个值由**客户端侧的状态覆盖层**（`src/sidebar.tsx` 的
 * `withLiveState`）从 `useSessionPendingInteraction`（琥珀）与
 * `useSessions().byId[sid].completed`（绿勾）补齐 —— 它们是客户端 live fact，不是宿主事实。
 *
 * 因此本文件 §1 的断言**不是**「当前实现有 bug」，而是把「HTTP 面能力边界」**显式钉死**：
 * 将来若有人误以为 HTTP 面能给这两个值（或误删客户端的 live-fact 覆盖层），这些用例会
 * 立刻失败并指出「你破坏了 D-2 的修复前提」。
 *
 * ## 隔离纪律
 *
 * - 所有文件 / 台账操作都在 `fs.mkdtemp` 临时目录里；
 * - 直接调用导出 handler 的用例**一律**通过 `SnapshotOptions.ledger` 注入
 *   `createFileLedger(tmpHome)`；
 * - 走真实注册 handler 的用例无法注入 `ledger`，因此本文件在**顶层**把 `$DSH_HOME`
 *   重定向到临时目录（`routes.ts` 的默认 home 两级解析都尊重 `$DSH_HOME`，见下方注释）；
 * - 所有 git 操作都在 `/tmp` 自建 fixture 仓里，**绝不**碰任何真实 worktree；
 * - `after()` 里证明本测试**没有绕过隔离往真实 `~/.dsh/worktree-groups.json` 写**。
 *
 * ## ⚠️ 隔离守卫为什么不能断言「真实台账不存在」
 *
 * 断言的**意图**是「**本测试**没有往真实路径写」，但「该文件不存在」是它的一个**无效**替身：
 * 用户把本插件装进 web profile 后，插件在真实运行期间会**持续**写这个文件
 * （`updateLedger` 每次 `/tree` 都刷新 `lastSeenAt`）。两种启动状态实测都会误报：
 *
 * - **启动时文件已存在（插件在运行）**：文件存在是**应用在正常工作**的证据，而不是隔离
 *   失效的证据；
 * - **启动时文件不存在（把真实台账 `mv` 开，模拟「插件没在运行」）**：插件会在**测试运行
 *   期间**（实测约 2 秒内）把文件**重新创建**出来，「结束后仍不存在」照样误报 ——
 *   重现出来的文件里没有任何临时路径，只有用户自己的真实项目。
 *
 * 因此「启动时是否存在」无法区分「插件没在运行」，存在性判据一律不可用；mtime / 内容哈希
 * 同样不可用（应用在持续写，它们**必然**变化，比存在性更 flaky）。
 *
 * 守卫改为针对「泄漏」这个事实的**直接**判据，在两种启动状态下都成立、都有判别力：
 * **真实台账里不得出现任何本测试的临时路径**（本测试的一切夹具都在 `mkdtemp` 出来的临时
 * 目录下，真泄漏必然把它们写进真实台账）。辅以「`$DSH_HOME` 仍钉在临时目录」。
 * 无论走哪条分支都会打印 `[isolation]` 状态行，一眼可见守卫在做什么。
 */

import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { after, test } from 'node:test'
import { promisify } from 'node:util'

import { apply } from '../lib/index.js'
import { createFileLedger } from '../lib/ledger.js'
import {
  ROUTE_PATHS,
  archiveWorkspaceProject,
  buildSessionRows,
  buildTreePayload,
  clearScanCache,
  collectSnapshot,
  defaultWorktreePath,
  handleReveal,
  handleWorktreeCreate,
  handleWorktreeRemove,
  isSafeGitArg,
  loadArchivedSessionIds,
  loadSessionSummaries,
  loadWorkspaces,
  registerRoutes,
  sanitizeBranchForPath,
  sweepDeadWorkspaces,
  unarchiveWorkspaceProject,
  validateTargetPath,
  workspaceSignature,
} from '../lib/routes.js'
import { resetSessionActivity } from '../lib/activity.js'

const pexec = promisify(execFile)

/** 真实 `~/.dsh` 的台账文件（本测试必须证明它从未被**本测试**写入）。 */
const REAL_LEDGER = join(process.env.HOME ?? '', '.dsh', 'worktree-groups.json')

/**
 * 真实台账在**本测试启动时**是否存在 —— **仅供 `[isolation]` 状态行说明**，
 * 不用来选择判据（存在性在任何启动状态下都无判别力，见文件头「隔离守卫」注释）。
 *
 * 必须在模块顶层（用例执行之前）取：这样它才真的描述「测试开始前」的状态，
 * 而不是「本测试自己把它写出来了」。
 */
const REAL_LEDGER_EXISTED_AT_START = existsSync(REAL_LEDGER)

/** 已创建的临时根目录，`after` 钩子统一清理。 */
const tempRoots = []

/**
 * 把 `$DSH_HOME` 重定向到临时目录（**在任何用例执行之前**）。
 *
 * 为什么必须在顶层做：§8 的 HTTP 用例走的是 `registerRoutes` 的真实 handler，而它
 * 内部调 `buildTreePayload(ctx)` —— **不能注入 `ledger`**（那条参数只存在于导出函数上）。
 * 于是台账会落到「默认 home」。`routes.ts` 的默认 home 解析顺序是
 * `dshHomePath()`（读 `$DSH_HOME`）→ `defaultDshHome()` → `createFileLedger()` 的
 * `$DSH_HOME` → `~/.dsh`。两条路径都尊重 `$DSH_HOME`，因此这里改写它是**充分**的隔离手段。
 * 并且必须在顶层（而不是某个用例内）做：`routes.ts` 的默认台账是**模块级单例**，
 * 首个用例解析出的 home 会被后续所有用例复用。
 *
 * `node --test` 默认每个测试文件一个独立子进程，因此改写 `process.env` 不会外溢。
 */
const DSH_TMP_HOME = await mkdtemp(join(await realpath(tmpdir()), 'wtg-dsh-home-'))
process.env.DSH_HOME = DSH_TMP_HOME

/**
 * 递归收集一个 JSON 值里出现的**全部字符串**（用于「真实台账里不得出现临时路径」的判据）。
 *
 * 逐个 leaf 收集而不是 `JSON.stringify` 整个台账：真实台账可达数十 KB，且我们只关心
 * 「有没有临时路径」这一个布尔事实，不需要把整份数据留在内存里比对。
 */
function collectStrings(value, found = []) {
  if (typeof value === 'string') {
    found.push(value)
    return found
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, found)
    return found
  }
  if (typeof value === 'object' && value !== null) {
    for (const item of Object.values(value)) collectStrings(item, found)
  }
  return found
}

/**
 * 隔离守卫：证明**本测试**没有绕过 `$DSH_HOME` 隔离去写真实台账。
 *
 * ## 判据的选择（为什么主判据是「泄漏」而不是「存在性」）
 *
 * 主判据 (b)：**真实台账里不得出现任何本测试的临时路径**。这是针对「泄漏」这个事实的
 * 直接判据，且在**两种启动状态下都成立、都有判别力**：本测试的一切夹具都在
 * `mkdtemp` 出来的临时目录里（临时 home 或 `tempRoots`），一旦有代码路径绕过
 * `$DSH_HOME` 写到真实路径，写进去的 project key / worktree path / session 归属
 * 必然以这些临时路径开头，一定会被抓住。
 *
 * ⚠️ 为什么**不**用「启动时不存在 ⇒ 结束后仍不存在」做判据 —— 它在本插件真实运行时
 * **必然误报**，两种情况都实测过：
 * 1. 启动时存在（插件正在运行）：文件存在是**应用在正常工作**的证据，
 *    `updateLedger` 每次 `/tree` 都刷新 `lastSeenAt`，mtime 与内容必然变化 ——
 *    比存在性更 flaky，所以 mtime / 内容哈希同样不可用；
 * 2. 启动时不存在（把真实台账 `mv` 开，模拟「插件没在运行」）：插件会在**测试运行期间**
 *    用约 2 秒把文件**重新创建**出来，于是「结束后仍不存在」照样误报 ——
 *    实测重现出的文件里**没有任何临时路径**、只有用户自己的 9 个真实项目，
 *    即它来自应用而不是本测试。
 * 因此「启动时是否存在」并**不能**区分「插件没在运行」，存在性判据在两种情况下都不成立，
 * 一律改用主判据 (b)。
 *
 * 辅判据 (a)：`process.env.DSH_HOME` 在测试期间必须仍被钉在临时目录（隔离机制没有被
 * 后来的代码改掉），且临时 home 下的台账若存在必须在临时目录内。
 */
after(async () => {
  // 必须**先**检查临时 home（下面会把它整个删掉；顺序反了这条判据就成了死代码）。
  const tmpLedger = join(DSH_TMP_HOME, 'worktree-groups.json')
  const tmpLedgerExists = existsSync(tmpLedger)

  await Promise.all(tempRoots.map((dir) => rm(dir, { recursive: true, force: true })))
  await rm(DSH_TMP_HOME, { recursive: true, force: true })

  // ── 辅判据 (a)：隔离机制本身必须仍然生效 ──
  assert.equal(
    process.env.DSH_HOME,
    DSH_TMP_HOME,
    `[isolation] 隔离机制被破坏：测试运行期间 process.env.DSH_HOME 必须仍指向临时目录。` +
      `期望 ${DSH_TMP_HOME}，实际 ${String(process.env.DSH_HOME)}`,
  )
  if (tmpLedgerExists) {
    assert.equal(
      tmpLedger.startsWith(DSH_TMP_HOME),
      true,
      `[isolation] 临时 home 下的台账必须位于临时目录内：${tmpLedger}`,
    )
    console.log(`[isolation] 临时 home 台账位于临时目录内 ✓ (${tmpLedger})`)
  } else {
    console.log(`[isolation] 临时 home 下无台账（本测试未走默认 home 的台账路径）`)
  }

  // ── 主判据 (b)：真实台账内不得出现本测试的临时路径 ──
  if (!existsSync(REAL_LEDGER)) {
    if (REAL_LEDGER_EXISTED_AT_START) {
      // 启动时存在、现在没了：本测试只删自己的临时目录，不可能删到真实路径。
      // 无法归因于本测试 ⇒ 只告警不失败（应用自身只 rename 备份损坏文件）。
      console.log(
        `[isolation] ⚠️ 真实台账启动时存在、现在不存在（非本测试所为，本测试只删临时目录）：${REAL_LEDGER}`,
      )
    } else {
      console.log(`[isolation] 真实台账启动时不存在、结束后仍不存在 ✓ (${REAL_LEDGER})`)
    }
    console.log(`[isolation] 真实台账内未出现任何测试临时路径 ✓（无文件可写）`)
    return
  }

  console.log(
    `[isolation] 真实台账${REAL_LEDGER_EXISTED_AT_START ? '启动时已存在（插件在运行）' : '启动时不存在、运行期间由插件创建'}` +
      `⇒ 使用泄漏判据（真实台账内不得出现本测试临时路径） (${REAL_LEDGER})`,
  )

  // 台账用「临时文件 + rename」原子写，正常读到的永远是完整版本；但运行中的插件可能
  // 恰好在 rename 的瞬间重建，因此给有限次重试，**失败后仍然明确 fail**。
  let parsed
  let lastError
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      parsed = JSON.parse(readFileSync(REAL_LEDGER, 'utf8'))
      lastError = undefined
      break
    } catch (error) {
      lastError = error
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
  if (lastError !== undefined) {
    // **拒绝静默跳过**：读不到就无法执行泄漏判据，必须明确暴露，而不是假装守卫通过。
    assert.fail(
      `[isolation] 无法读取 / 解析真实台账来执行泄漏判据（已重试 3 次）：${REAL_LEDGER}` +
        `\n原因：${lastError?.code ?? ''} ${lastError?.message ?? String(lastError)}` +
        `\n真实台账可能正被运行中的插件并发写入（临时文件 + rename）。` +
        `本守卫拒绝静默跳过 —— 若这是瞬时竞态请重跑；若稳定复现，说明守卫需要适配原子写。`,
    )
  }

  const leaked = collectStrings(parsed).filter(
    (text) => text.startsWith(DSH_TMP_HOME) || tempRoots.some((dir) => text.startsWith(dir)),
  )
  assert.deepEqual(
    leaked,
    [],
    `[isolation] 测试泄漏：真实台账 ${REAL_LEDGER} 里出现了本测试的临时路径 ` +
      `${JSON.stringify(leaked)}（临时 home = ${DSH_TMP_HOME}；临时根 = ${JSON.stringify(tempRoots)}）。` +
      `\n这说明有代码路径绕过了 $DSH_HOME 隔离、把测试夹具写进了真实台账 —— 本测试必须修好隔离，` +
      `而不是删掉这条守卫。`,
  )

  console.log(`[isolation] 真实台账内未出现任何测试临时路径 ✓`)
})

/* ------------------------------------------------------------------ *
 * 通用夹具
 * ------------------------------------------------------------------ */

/**
 * 造一个临时根目录。
 *
 * 先对 `tmpdir()` 取 `realpath`：macOS 上 `/var` 是 `/private/var` 的符号链接，而
 * `git worktree list` 回的是 realpath 拼法。若不先归一，`normalizePath`（只做 resolve）
 * 会让「git 输出的路径」与「我们拼出来的路径」不相等，用例会莫名其妙地失败。
 */
async function makeRoot(prefix) {
  const base = await realpath(tmpdir())
  const dir = await mkdtemp(join(base, `${prefix}-`))
  tempRoots.push(dir)
  return dir
}

/** 注入式台账：**任何**用例都必须用它，绝不落到真实 `~/.dsh`。 */
function ledgerAt(root) {
  return createFileLedger(join(root, 'ledger-home'))
}

/** 造一个可断言的 `ServerResponse` 替身。 */
function makeResponse() {
  return {
    statusCode: 0,
    body: undefined,
    headersSent: false,
    writeHead(code, headers) {
      this.statusCode = code
      this.writeHeadHeaders = headers
      this.headersSent = true
      return this
    },
    end(payload) {
      this.headersSent = true
      if (typeof payload === 'string' && payload !== '') {
        this.raw = payload
        try {
          this.body = JSON.parse(payload)
        } catch {
          this.body = payload
        }
      }
    },
  }
}

/** 造一个最小 `IncomingMessage` 替身（`readBody` 只用到 `on('data'|'end'|'error')`）。 */
function makeRequest(body) {
  const text = body === undefined ? '' : JSON.stringify(body)
  return Readable.from([Buffer.from(text, 'utf8')])
}

/** 由「按名取服务」的函数造一个最小 `Context`（含 logger / effect）。 */
function makeCtx(get, extra = {}) {
  return {
    get,
    logger: { warn() {} },
    effect(fn) {
      return fn()
    },
    ...extra,
  }
}

/** 便捷：把 `{服务名: 实例}` 变成 `get` 函数（未列出的服务返回 `undefined`）。 */
function services(map) {
  return (name) => map[name]
}

/**
 * 造一个自建 git fixture 仓（**只在 `/tmp` 下**）：
 * 主仓 `demo-repo` + 一次 commit；可选预建若干 `git worktree`。
 *
 * @returns `{ root, repo, git, worktreePath }`
 */
async function makeGitFixture(prefix, worktrees = []) {
  const root = await makeRoot(prefix)
  const repo = join(root, 'demo-repo')
  await mkdir(repo, { recursive: true })
  const git = async (args, cwd = repo) => (await pexec('git', args, { cwd })).stdout
  await git(['init', '-q', '-b', 'main'])
  await git(['config', 'user.email', 'test@example.invalid'])
  await git(['config', 'user.name', 'dsh-worktree-groups test'])
  await writeFile(join(repo, 'README.md'), 'fixture\n', 'utf8')
  await git(['add', '.'])
  await git(['commit', '-q', '-m', 'init'])

  const created = {}
  for (const spec of worktrees) {
    const path = join(root, spec.dir)
    await git(['worktree', 'add', ...(spec.branch === undefined ? [] : ['-b', spec.branch]), path])
    created[spec.name ?? spec.dir] = path
  }
  if (worktrees.length > 0) clearScanCache()
  return { root, repo, git, worktreePath: created }
}

/** `git worktree list --porcelain` 的路径集合（用于「拒绝时什么都没建」的对照）。 */
async function worktreePaths(git) {
  const out = await git(['worktree', 'list', '--porcelain'])
  return out
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length))
    .sort()
}

/* ------------------------------------------------------------------ *
 * §1【最关键】HTTP 面给不出 pendingInteraction / completed（D-2 / D-23 根因测试）
 * ------------------------------------------------------------------ */

/**
 * 宿主 `SessionSummary` 的**真实字段集**（契约 `docs/HOST-CONTRACTS.md` §A2.2）：
 * 就这 8 个，**一个不多**。刻意不含 `pendingInteraction`、不含 `completed`。
 */
const HOST_SUMMARY_FIELDS = [
  'sessionId',
  'updatedAt',
  'running',
  'blank',
  'parentSessionId',
  'origin',
  'cwd',
  'projections',
]

/**
 * 造一条**宿主真实形状**的 `SessionSummary`。
 *
 * 8 个键**全部存在**（可选键显式置 `undefined`），这样 `Object.keys()` 就能当作
 * 「宿主 wire 字段集」的精确断言 —— 任何多出来的键都会让 §1 的守卫用例失败。
 */
function hostSummary(sessionId, overrides = {}) {
  return {
    sessionId,
    updatedAt: 1_700_000_000_000,
    running: false,
    blank: false,
    parentSessionId: undefined,
    origin: undefined,
    cwd: '/tmp/fixture-cwd',
    projections: { asOfSeq: 3, values: { title: `title-${sessionId}` } },
    ...overrides,
  }
}

/** 造一条 `sessionPersistence.list()` 的返回项（契约 §A1.2：`{header, revision, sizeBytes?}`）。 */
function persistenceSnapshot(id, header = {}) {
  return { header: { id, createdAt: 1_600_000_000_000, ...header }, revision: `rev-${id}` }
}

test('§1 守卫：HOST_SUMMARY_FIELDS 描述的正是宿主真实字段集（8 个，一个不多）', () => {
  const keys = Object.keys(hostSummary('s-guard')).sort()
  assert.deepEqual(
    keys,
    [...HOST_SUMMARY_FIELDS].sort(),
    '宿主 SessionSummary 的字段集应与 docs/HOST-CONTRACTS.md §A2.2 逐字一致；' +
      `若你新增了字段，请先更新契约再改这里。实际：${keys.join(', ')}`,
  )
  assert.equal(
    keys.includes('pendingInteraction'),
    false,
    '宿主的 SessionSummary **没有** pendingInteraction —— 它是客户端 live fact',
  )
  assert.equal(
    keys.includes('completed'),
    false,
    '宿主的 SessionSummary **没有** completed —— 它是客户端 live fact',
  )
})

test('§1 D-2：宿主真实字段集 ⇒ SessionRow.pendingInteraction 恒为 undefined', async () => {
  const root = await makeRoot('wtg-d2-pending')
  const summaries = [
    hostSummary('s-idle'),
    hostSummary('s-running', { running: true }),
    hostSummary('s-blank', { blank: true }),
    hostSummary('s-sub', { origin: 'subagent', parentSessionId: 's-idle' }),
  ]
  const ctx = makeCtx(
    services({
      sessionController: { list: async () => ({ items: summaries }) },
      sessionPersistence: {
        list: async () => summaries.map((s) => persistenceSnapshot(s.sessionId, { cwd: s.cwd })),
      },
    }),
  )

  const { rows } = await buildSessionRows(ctx)
  assert.equal(rows.length, 4, `4 条宿主会话都应成为 SessionRow，实际 ${rows.length}`)

  for (const row of rows) {
    assert.equal(
      row.pendingInteraction,
      undefined,
      `会话 ${row.sessionId}：宿主给不出 pendingInteraction，` +
        `HTTP 面必须保持 undefined（琥珀态由客户端 useSessionPendingInteraction 补齐）。` +
        `实际 ${JSON.stringify(row.pendingInteraction)}`,
    )
    assert.equal(
      Object.hasOwn(row, 'pendingInteraction'),
      false,
      `会话 ${row.sessionId}：不应出现 pendingInteraction 键（toSessionRow 只在有值时写键）`,
    )
  }
  assert.ok(root.length > 0, '夹具目录已创建')
})

test('§1 D-2：宿主真实字段集 ⇒ SessionRow.completed 恒为 undefined（非 true）', async () => {
  const root = await makeRoot('wtg-d2-completed')
  const summaries = [
    hostSummary('s-a'),
    hostSummary('s-b', { running: true }),
    hostSummary('s-c', { blank: true }),
  ]
  const ctx = makeCtx(
    services({
      sessionController: { list: async () => ({ items: summaries }) },
      sessionPersistence: {
        list: async () => summaries.map((s) => persistenceSnapshot(s.sessionId, { cwd: s.cwd })),
      },
    }),
  )

  const { rows } = await buildSessionRows(ctx)
  assert.equal(rows.length, 3, '3 条宿主会话都应成为 SessionRow')

  for (const row of rows) {
    assert.equal(
      row.completed,
      undefined,
      `会话 ${row.sessionId}：宿主给不出 completed，HTTP 面必须保持 undefined` +
        `（绿勾由客户端 useSessions().byId[sid].completed 补齐）。` +
        `实际 ${JSON.stringify(row.completed)}`,
    )
    assert.notEqual(row.completed, true, `会话 ${row.sessionId}：completed 不得为 true`)
    assert.equal(
      Object.hasOwn(row, 'completed'),
      false,
      `会话 ${row.sessionId}：不应出现 completed 键（toSessionRow 只在有值时写键）`,
    )
  }
  assert.ok(root.length > 0, '夹具目录已创建')
})

test('§1 D-2：故意喂给宿主「给不出的」字段 ⇒ 会被透传（证明差异来自宿主，不是组装层丢字段）', async () => {
  // 这条用例的作用是**反向证明**：组装层本身并不丢弃这两个字段，
  // 所以 §1 前两条断言失败只可能有一个原因 —— 宿主 wire 里根本没有它们。
  // 若有人给 SessionSummary 加上了 pendingInteraction / completed（宿主侧补齐 D-2），
  // 这条用例会照旧通过，而前两条用例会失败并提醒「HTTP 面能力边界变了，请同步契约与客户端覆盖层」。
  const ctx = makeCtx(
    services({
      sessionController: {
        list: async () => ({
          items: [hostSummary('s-x', { pendingInteraction: 'approval', completed: true })],
        }),
      },
      sessionPersistence: { list: async () => [] },
    }),
  )
  const { rows } = await buildSessionRows(ctx)
  assert.equal(rows[0].pendingInteraction, 'approval', '组装层不丢字段（有值时透传）')
  assert.equal(rows[0].completed, true, '组装层不丢字段（有值时透传）')
})

test('§1 D-2：整棵树的每一个 SessionRow 都不含 pendingInteraction / completed（buildTreePayload 端到端）', async () => {
  const fixture = await makeGitFixture('wtg-d2-tree', [
    { name: 'one', dir: 'demo-repo-one', branch: 'feature/one' },
  ])
  const { root, repo, worktreePath } = fixture
  const onePath = worktreePath.one

  const summaries = [
    hostSummary('s-main', { cwd: repo, running: true }),
    hostSummary('s-one', { cwd: onePath }),
    hostSummary('s-dead', { cwd: join(root, 'demo-repo-dead'), updatedAt: undefined }),
  ]
  const ctx = makeCtx(
    services({
      sessionController: { list: async () => ({ items: summaries }) },
      sessionPersistence: {
        list: async () =>
          summaries.map((s) => persistenceSnapshot(s.sessionId, { createdAt: 42, cwd: s.cwd })),
      },
      workspaceRegistry: {
        list: () => [
          { id: 'ws-main', path: repo, title: 'main', createdAt: '', updatedAt: '' },
          { id: 'ws-one', path: onePath, title: 'one', createdAt: '', updatedAt: '' },
        ],
      },
    }),
  )

  clearScanCache()
  const payload = await buildTreePayload(ctx, { ledger: ledgerAt(root), now: 1_700_000_000_000 })

  const allRows = [
    ...payload.projects.flatMap((project) => [
      ...project.worktrees.flatMap((node) => node.sessions),
      ...project.history,
      ...project.flatSessions,
    ]),
    ...payload.ungrouped,
  ]
  assert.ok(allRows.length >= 3, `至少应组装出 3 条会话行，实际 ${allRows.length}`)

  for (const row of allRows) {
    assert.equal(row.pendingInteraction, undefined, `会话 ${row.sessionId}：pendingInteraction 必须 undefined`)
    assert.equal(row.completed, undefined, `会话 ${row.sessionId}：completed 必须 undefined`)
    assert.equal(Object.hasOwn(row, 'pendingInteraction'), false, `会话 ${row.sessionId}：不应有该键`)
    assert.equal(Object.hasOwn(row, 'completed'), false, `会话 ${row.sessionId}：不应有该键`)
  }
})

test('§1 D-2：真实 HTTP /tree 响应里也拿不到这两个字段（HTTP 面能力边界）', async () => {
  const fixture = await makeGitFixture('wtg-d2-http')
  const { root, repo } = fixture

  const server = await startRouteServer({
    sessionController: {
      list: async () => ({ items: [hostSummary('s-1', { cwd: repo, running: true })] }),
    },
    sessionPersistence: {
      list: async () => [persistenceSnapshot('s-1', { cwd: repo })],
    },
    workspaceRegistry: {
      list: () => [mainWorkspace(repo, 'ws-1')],
    },
  })
  try {
    const res = await server.post(ROUTE_PATHS.tree, {})
    assert.equal(res.status, 200, 'HTTP /tree 应正常返回')
    const rows = collectResponseRows(res.body)
    assert.ok(rows.length >= 1, `响应里应有会话行，实际 ${rows.length}`)
    for (const row of rows) {
      assert.equal(row.pendingInteraction, undefined, `HTTP 响应里的行不得带 pendingInteraction：${JSON.stringify(row)}`)
      assert.equal(row.completed, undefined, `HTTP 响应里的行不得带 completed：${JSON.stringify(row)}`)
    }
    const text = JSON.stringify(res.body)
    assert.equal(text.includes('"pendingInteraction"'), false, '响应 JSON 文本里不应出现 pendingInteraction 键')
    assert.equal(text.includes('"completed"'), false, '响应 JSON 文本里不应出现 completed 键')
  } finally {
    await server.close()
  }
})

/** 从 `/tree` 响应体里递归收集所有「像会话行」的对象（有 sessionId + 数字 updatedAt）。 */
function collectResponseRows(value, found = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectResponseRows(item, found)
    return found
  }
  if (typeof value !== 'object' || value === null) return found
  if (typeof value.sessionId === 'string' && typeof value.updatedAt === 'number') found.push(value)
  for (const item of Object.values(value)) collectResponseRows(item, found)
  return found
}

/* ------------------------------------------------------------------ *
 * §2 `updatedAt` 回退（裁定 7）
 * ------------------------------------------------------------------ */

test('§2 updatedAt 回退：有 summary ⇒ 取 summary.updatedAt', async () => {
  const ctx = makeCtx(
    services({
      sessionController: { list: async () => ({ items: [hostSummary('s-1', { updatedAt: 1_234_567 })] }) },
      sessionPersistence: {
        list: async () => [persistenceSnapshot('s-1', { createdAt: 111 })],
      },
    }),
  )
  const { rows } = await buildSessionRows(ctx)
  assert.equal(rows.length, 1, '应有一条会话行')
  assert.equal(rows[0].updatedAt, 1_234_567, 'summary.updatedAt 优先于 header.createdAt')
})

test('§2 updatedAt 回退：无 summary（孤儿会话）⇒ 取 header.createdAt', async () => {
  const ctx = makeCtx(
    services({
      sessionController: { list: async () => ({ items: [] }) },
      sessionPersistence: {
        list: async () => [persistenceSnapshot('s-orphan', { createdAt: 987_654 })],
      },
    }),
  )
  const { rows } = await buildSessionRows(ctx)
  assert.equal(rows.length, 1, '孤儿会话也必须出行（不能因没有 summary 而消失）')
  assert.equal(rows[0].sessionId, 's-orphan', '孤儿会话 id 应保持')
  assert.equal(rows[0].updatedAt, 987_654, '无 summary 时必须回退到 header.createdAt（否则排序会 NaN）')
})

test('§2 updatedAt 回退：两者都缺 ⇒ 0（不是 undefined / 不是 NaN）', async () => {
  const ctx = makeCtx(
    services({
      sessionController: { list: async () => ({ items: [hostSummary('s-1', { updatedAt: undefined })] }) },
      sessionPersistence: { list: async () => [persistenceSnapshot('s-1', { createdAt: undefined })] },
    }),
  )
  const { rows } = await buildSessionRows(ctx)
  assert.equal(rows[0].updatedAt, 0, 'summary 与 header 都拿不到时间时应回退 0')
})

test('§2 updatedAt 回退：所有 updatedAt 都是有限数字（不允许 NaN / undefined）', async () => {
  const summaries = [
    hostSummary('s-1', { updatedAt: 5 }),
    hostSummary('s-2', { updatedAt: Number.NaN }),
    hostSummary('s-3', { updatedAt: Number.POSITIVE_INFINITY }),
    hostSummary('s-4', { updatedAt: '1700000000000' }),
    hostSummary('s-5', { updatedAt: undefined }),
  ]
  const ctx = makeCtx(
    services({
      sessionController: { list: async () => ({ items: summaries }) },
      sessionPersistence: {
        list: async () => [
          persistenceSnapshot('s-1', { createdAt: 1 }),
          persistenceSnapshot('s-2', { createdAt: 2 }),
          persistenceSnapshot('s-3', { createdAt: 3 }),
          persistenceSnapshot('s-4', { createdAt: 4 }),
          persistenceSnapshot('s-5', { createdAt: undefined }),
          persistenceSnapshot('s-6', { createdAt: Number.NaN }),
          persistenceSnapshot('s-7', { createdAt: 'nope' }),
        ],
      },
    }),
  )
  const { rows } = await buildSessionRows(ctx)
  assert.equal(rows.length, 7, `7 条会话都应出行，实际 ${rows.length}`)
  for (const row of rows) {
    assert.equal(
      Number.isFinite(row.updatedAt),
      true,
      `会话 ${row.sessionId} 的 updatedAt 必须是有限数字（NaN / undefined 会让排序出 NaN）。` +
        `实际 ${String(row.updatedAt)}（typeof ${typeof row.updatedAt}）`,
    )
  }
  const byId = new Map(rows.map((row) => [row.sessionId, row]))
  assert.equal(byId.get('s-2').updatedAt, 2, 'NaN 必须被 finiteNumber 挡掉并回退到 header.createdAt')
  assert.equal(byId.get('s-3').updatedAt, 3, 'Infinity 必须被挡掉并回退')
  assert.equal(byId.get('s-4').updatedAt, 4, '字符串时间戳必须被挡掉并回退')
  assert.equal(byId.get('s-5').updatedAt, 0, '两者都缺 ⇒ 0')
  assert.equal(byId.get('s-6').updatedAt, 0, 'header.createdAt 为 NaN ⇒ 0')
  assert.equal(byId.get('s-7').updatedAt, 0, 'header.createdAt 为字符串 ⇒ 0')
})

test('§2：实时摘要比全量历史多出的会话（刚创建还没落盘）也要补进来', async () => {
  const ctx = makeCtx(
    services({
      sessionController: { list: async () => ({ items: [hostSummary('s-new', { updatedAt: 9 })] }) },
      sessionPersistence: { list: async () => [] },
    }),
  )
  const { rows } = await buildSessionRows(ctx)
  assert.deepEqual(rows.map((row) => row.sessionId), ['s-new'], '只有实时摘要有该会话时仍必须出行')
  assert.equal(rows[0].updatedAt, 9, '应取 summary.updatedAt')
})

/* ------------------------------------------------------------------ *
 * §3 `cwd` 缺失（裁定 8）
 * ------------------------------------------------------------------ */

test('§3 cwd 缺失：header.cwd === undefined ⇒ 不崩、不写 cwd 键', async () => {
  const ctx = makeCtx(
    services({
      sessionController: { list: async () => ({ items: [] }) },
      sessionPersistence: { list: async () => [persistenceSnapshot('s-nocwd', { createdAt: 7 })] },
    }),
  )
  const { rows } = await buildSessionRows(ctx)
  assert.equal(rows.length, 1, '无 cwd 的会话仍应出行（不能崩、不能丢）')
  assert.equal(rows[0].cwd, undefined, 'cwd 缺失时应为 undefined')
  assert.equal(Object.hasOwn(rows[0], 'cwd'), false, '裁定 8：cwd 缺失时不写该键')
  assert.equal(rows[0].updatedAt, 7, 'updatedAt 仍应正常回退')
})

test('§3 cwd 缺失：summary.cwd 与 header.cwd 都缺 ⇒ 归入未分组而不是崩溃', async () => {
  const root = await makeRoot('wtg-nocwd')
  const ctx = makeCtx(
    services({
      sessionController: {
        list: async () => ({ items: [hostSummary('s-nocwd', { cwd: undefined })] }),
      },
      sessionPersistence: {
        list: async () => [persistenceSnapshot('s-nocwd', { createdAt: 5, cwd: undefined })],
      },
      workspaceRegistry: { list: () => [] },
    }),
  )
  clearScanCache()
  const payload = await buildTreePayload(ctx, { ledger: ledgerAt(root), now: 1 })
  assert.equal(payload.projects.length, 0, '没有工作区时不应有项目节点')
  assert.deepEqual(
    payload.ungrouped.map((row) => row.sessionId),
    ['s-nocwd'],
    '无 cwd 的会话应进未分组（projects.ts 的 assignSession 规则 5）',
  )
  assert.equal(payload.ungrouped[0].cwd, undefined, '未分组行仍不应带 cwd')
})

test('§3 cwd 缺失：空字符串 cwd 也归未分组（不被当成路径 ""）', async () => {
  const root = await makeRoot('wtg-emptycwd')
  const ctx = makeCtx(
    services({
      sessionController: { list: async () => ({ items: [hostSummary('s-empty-cwd', { cwd: '' })] }) },
      sessionPersistence: {
        list: async () => [persistenceSnapshot('s-empty-cwd', { createdAt: 1, cwd: '' })],
      },
      workspaceRegistry: { list: () => [] },
    }),
  )
  clearScanCache()
  const payload = await buildTreePayload(ctx, { ledger: ledgerAt(root), now: 1 })
  assert.deepEqual(
    payload.ungrouped.map((row) => row.sessionId),
    ['s-empty-cwd'],
    '空串 cwd 应被 assignSession 视作「无 cwd」⇒ 未分组',
  )
})

/* ------------------------------------------------------------------ *
 * §4 安全白名单（D-5 / D-6 / D-11）—— 真实验证拒绝，不只看返回值
 * ------------------------------------------------------------------ */

test('§4 D-5 validateTargetPath：拒绝仓外 / 穿越 / .git / 非主仓名前缀 / 等于主仓 / 空串', async () => {
  const fixture = await makeGitFixture('wtg-d5-validate')
  const { root, repo } = fixture
  const cases = [
    ['仓外绝对路径', '/tmp/wtg-evil-should-not-exist/deep'],
    ['仓外路径（不存在的同级目录）', join(root, '..', 'wtg-evil-sibling')],
    ['`..` 越狱到仓外', join(repo, '..', 'escape')],
    ['仓内 .git 子目录', join(repo, '.git')],
    ['仓内 .git 下的子路径', join(repo, '.git', 'evil')],
    ['basename 不以主仓名开头', join(root, 'othername')],
    ['等于主仓自身', repo],
    ['空串', ''],
    ['隐藏目录（以 . 开头）', join(root, '.hidden-worktree')],
  ]
  for (const [label, target] of cases) {
    const verdict = validateTargetPath(target, repo)
    assert.equal(verdict.ok, false, `应拒绝（${label}）：${target}`)
    assert.equal(typeof verdict.message, 'string', `拒绝时必须给出原因（${label}）`)
    assert.ok(verdict.message.length > 0, `拒绝原因不得为空（${label}）`)
  }
})

test('§4 D-5 validateTargetPath：放行「同父目录 + 主仓名前缀」，并回填归一化路径', async () => {
  const fixture = await makeGitFixture('wtg-d5-pass')
  const { root, repo } = fixture
  const okTarget = join(root, 'demo-repo-feature-x')
  const verdict = validateTargetPath(okTarget, repo)
  assert.equal(verdict.ok, true, `应放行同父目录 + 主仓名前缀：${okTarget}`)
  assert.equal(verdict.path, okTarget, '放行时应返回归一化路径')

  const trailing = validateTargetPath(`${okTarget}///`, repo)
  assert.equal(trailing.ok, true, '尾斜杠应被 normalizePath 归一后放行')
  assert.equal(trailing.path, okTarget, '尾斜杠必须被去掉（同一个目录不能有两种拼法）')
})

test('§4 D-5 handler：拒绝的 targetPath 不得创建任何目录，也不得新建 worktree', async () => {
  const fixture = await makeGitFixture('wtg-d5-handler')
  const { root, repo, git } = fixture
  const opts = { ledger: ledgerAt(root), now: 1_700_000 }

  const rejections = [
    ['仓外（/tmp/...）', '/tmp/wtg-evil-deep/should-not-exist'],
    ['`..` 越狱到仓外且 basename 不以主仓名开头', join(repo, '..', 'escaped')],
    ['仓内 .git 子路径', join(repo, '.git', 'evil')],
    ['不以主仓名开头的 basename', join(root, 'attacker-chosen')],
    ['等于主仓自身', repo],
  ]

  const before = await worktreePaths(git)
  for (const [label, target] of rejections) {
    // 「什么都没建」的正确判据是**前后不变**，而不是「不存在」：
    // 「等于主仓自身」这一条的 target 本来就存在，但它不该被改动。
    const existedBefore = existsSync(target)
    const statBefore = existedBefore ? await stat(target) : undefined

    clearScanCache()
    const res = makeResponse()
    await handleWorktreeCreate(
      makeCtx(services({ workspaceRegistry: fakeRegistry([mainWorkspace(repo)]) })),
      res,
      { repoPath: repo, branch: 'evil-branch', targetPath: target },
      opts,
    )
    assert.equal(res.statusCode, 400, `应拒绝（${label}）：${JSON.stringify(res.body)}`)
    assert.equal(res.body?.ok, false, `拒绝时 ok 必须为 false（${label}）`)
    assert.equal(
      existsSync(target),
      existedBefore,
      `拒绝时**不得**触碰磁盘（${label}）：${target} 的存在性变了`,
    )
    if (statBefore !== undefined) {
      const statAfter = await stat(target)
      assert.equal(
        statAfter.mtimeMs,
        statBefore.mtimeMs,
        `拒绝时不得改动既有目录（${label}）：mtime 变了`,
      )
    }
  }
  assert.deepEqual(await worktreePaths(git), before, '全部拒绝路径都不得改动 git worktree 列表')
})

test('§4 D-5 handler：放行「同父目录 + 主仓名前缀」的 targetPath，并注册为工作区', async () => {
  const fixture = await makeGitFixture('wtg-d5-ok')
  const { root, repo, git } = fixture
  const target = join(root, 'demo-repo-feature-x')
  const created = []
  const registry = {
    list: () => [mainWorkspace(repo)],
    create: async (path) => {
      created.push(path)
      return { id: `ws-${created.length}`, path }
    },
    delete: async () => true,
  }
  clearScanCache()
  const res = makeResponse()
  await handleWorktreeCreate(
    makeCtx(services({ workspaceRegistry: registry })),
    res,
    { repoPath: repo, branch: 'feature-x', targetPath: target },
    { ledger: ledgerAt(root), now: 1_700_000 },
  )
  assert.equal(res.statusCode, 200, `合法 targetPath 应成功：${JSON.stringify(res.body)}`)
  assert.equal(res.body.ok, true, '成功时 ok 为 true')
  assert.equal(res.body.worktreePath, target, 'worktreePath 应为归一化后的目标路径')
  assert.equal(res.body.workspaceId, 'ws-1', '成功后应返回自动注册的 workspaceId')
  assert.equal(existsSync(target), true, '合法 targetPath 应真的在磁盘上建出来')
  assert.equal(created[0], target, 'registry.create 应收到该 worktree 路径')
  assert.ok((await worktreePaths(git)).includes(target), 'git worktree 列表里应出现该路径')
})

test('§4 D-5 handler：不传 targetPath 时走默认推导（<父目录>/<主仓名>-<分支 sanitize>）', async () => {
  const fixture = await makeGitFixture('wtg-d5-default')
  const { root, repo } = fixture
  const expected = defaultWorktreePath(repo, 'feature/two')
  assert.equal(
    expected,
    join(root, 'demo-repo-feature-two'),
    'PRD D7：默认路径应为 <主仓父目录>/<主仓名>-<分支名 sanitize>',
  )
  clearScanCache()
  const res = makeResponse()
  await handleWorktreeCreate(
    makeCtx(services({ workspaceRegistry: fakeRegistry([mainWorkspace(repo)]) })),
    res,
    { repoPath: repo, branch: 'feature/two' },
    { ledger: ledgerAt(root), now: 1_700_000 },
  )
  assert.equal(res.statusCode, 200, `默认 targetPath 应成功：${JSON.stringify(res.body)}`)
  assert.equal(res.body.worktreePath, expected, '落盘路径应与 defaultWorktreePath 一致')
  assert.equal(existsSync(expected), true, '默认路径应真的被创建')
})

test('§4 D-5 handler：repoPath 必须命中白名单（不在白名单 ⇒ 400 且无副作用）', async () => {
  const fixture = await makeGitFixture('wtg-d5-repo')
  const { root, repo } = fixture
  clearScanCache()
  for (const bad of ['/etc', '/tmp', join(root, 'not-a-repo'), '', undefined, 123]) {
    const res = makeResponse()
    await handleWorktreeCreate(
      makeCtx(services({ workspaceRegistry: fakeRegistry([mainWorkspace(repo)]) })),
      res,
      { repoPath: bad, branch: 'b' },
      { ledger: ledgerAt(root), now: 1 },
    )
    assert.equal(res.statusCode, 400, `repoPath=${JSON.stringify(bad)} 应被拒绝`)
    assert.equal(res.body.ok, false, `repoPath=${JSON.stringify(bad)} 拒绝时 ok 应为 false`)
  }
  assert.equal(existsSync(join(root, 'not-a-repo')), false, '被拒绝的 repoPath 不得被创建')
})

test('§4 D-6 worktree-remove：未注册的 worktree 被拒绝，目录仍在', async () => {
  const fixture = await makeGitFixture('wtg-d6-unregistered', [
    { name: 'registered', dir: 'demo-repo-reg', branch: 'reg' },
    { name: 'unregistered', dir: 'demo-repo-unreg', branch: 'unreg' },
  ])
  const { root, repo, worktreePath } = fixture
  const unregistered = worktreePath.unregistered
  assert.equal(existsSync(unregistered), true, '夹具：未注册 worktree 目录应存在')

  const registry = fakeRegistry([
    { id: 'ws-main', path: repo, title: 'main', createdAt: '', updatedAt: '' },
    { id: 'ws-reg', path: worktreePath.registered, title: 'reg', createdAt: '', updatedAt: '' },
  ])
  clearScanCache()
  const res = makeResponse()
  await handleWorktreeRemove(
    makeCtx(services({ workspaceRegistry: registry })),
    res,
    { path: unregistered },
    { ledger: ledgerAt(root), now: 1 },
  )

  assert.equal(res.statusCode, 400, `未注册 worktree 不得被移除：${JSON.stringify(res.body)}`)
  assert.equal(res.body.ok, false, '拒绝时 ok 必须为 false')
  assert.equal(
    existsSync(unregistered),
    true,
    '⚠️ D-6：拒绝时目录必须**仍然存在**（否则「拒绝」只是返回值的假象，目录已被删掉）',
  )
})

test('§4 D-6 worktree-remove：已注册的 worktree 正常移除（正向不误伤）', async () => {
  const fixture = await makeGitFixture('wtg-d6-registered', [
    { name: 'registered', dir: 'demo-repo-reg', branch: 'reg' },
  ])
  const { root, repo, worktreePath } = fixture
  const registered = worktreePath.registered
  const deleted = []
  const registry = fakeRegistry(
    [
      { id: 'ws-main', path: repo, title: 'main', createdAt: '', updatedAt: '' },
      { id: 'ws-reg', path: registered, title: 'reg', createdAt: '', updatedAt: '' },
    ],
    { onDelete: (id) => deleted.push(id) },
  )

  clearScanCache()
  const res = makeResponse()
  await handleWorktreeRemove(
    makeCtx(services({ workspaceRegistry: registry })),
    res,
    { path: registered },
    { ledger: ledgerAt(root), now: 1 },
  )

  assert.equal(res.statusCode, 200, `已注册 worktree 应能移除：${JSON.stringify(res.body)}`)
  assert.deepEqual(res.body, { ok: true }, '成功响应应为 {ok:true}')
  assert.equal(existsSync(registered), false, '已注册 worktree 的目录应被真的删掉')
  assert.deepEqual(deleted, ['ws-reg'], '移除成功后应注销对应的 dsh 工作区记录')
})

test('§4 D-6 worktree-remove：白名单外路径（/etc）被拒绝且无副作用', async () => {
  const fixture = await makeGitFixture('wtg-d6-outside')
  const { root, repo } = fixture
  clearScanCache()
  for (const bad of ['/etc', '/etc/passwd', join(repo, '..', '..', 'etc'), '', undefined, null]) {
    const res = makeResponse()
    await handleWorktreeRemove(
      makeCtx(services({ workspaceRegistry: fakeRegistry([{ id: 'ws', path: repo, title: '', createdAt: '', updatedAt: '' }]) })),
      res,
      { path: bad },
      { ledger: ledgerAt(root), now: 1 },
    )
    assert.equal(res.statusCode, 400, `path=${JSON.stringify(bad)} 应被拒绝`)
    assert.equal(res.body.ok, false, `path=${JSON.stringify(bad)} 拒绝时 ok 应为 false`)
  }
  assert.equal(existsSync('/etc'), true, '/etc 必须毫发无损')
})

test('§4 D-11 reveal：白名单外的绝对路径被拒绝（/etc/passwd、/tmp/xxx）', async () => {
  const fixture = await makeGitFixture('wtg-d11-reject')
  const { root, repo } = fixture
  const outside = join(root, 'not-known-dir')
  await mkdir(outside, { recursive: true })
  assert.equal(existsSync(outside), true, '夹具：白名单外但**存在**的目录（旧实现只校验存在性）')

  const opts = { ledger: ledgerAt(root), now: 1 }
  const ctx = makeCtx(services({ workspaceRegistry: fakeRegistry([{ id: 'ws', path: repo, title: '', createdAt: '', updatedAt: '' }]) }))
  for (const bad of ['/etc/passwd', '/etc', '/tmp/wtg-xxx-not-in-whitelist', outside]) {
    clearScanCache()
    const res = makeResponse()
    await handleReveal(ctx, res, { path: bad }, opts)
    assert.equal(
      res.statusCode,
      400,
      `白名单外路径必须拒绝（${bad}）：${JSON.stringify(res.body)} —— 这是 D-11`,
    )
    assert.equal(res.body.ok, false, `拒绝时 ok 必须为 false（${bad}）`)
  }
})

test('§4 D-11 reveal：路径穿越被拒绝（归一化后不在白名单）', async () => {
  const fixture = await makeGitFixture('wtg-d11-traversal')
  const { root, repo } = fixture
  const opts = { ledger: ledgerAt(root), now: 1 }
  const ctx = makeCtx(services({ workspaceRegistry: fakeRegistry([{ id: 'ws', path: repo, title: '', createdAt: '', updatedAt: '' }]) }))
  const traversals = [
    join(repo, '..', '..', '..', '..', 'etc', 'passwd'),
    `${repo}/../../../../etc/passwd`,
    join(repo, '..', '..', 'etc'),
    '/etc/../etc/passwd',
  ]
  for (const bad of traversals) {
    clearScanCache()
    const res = makeResponse()
    await handleReveal(ctx, res, { path: bad }, opts)
    assert.equal(res.statusCode, 400, `穿越路径必须拒绝（${bad}）：${JSON.stringify(res.body)}`)
  }
})

test('§4 D-11 reveal：前缀伪装不得匹配 —— 存在但不是 worktree 的 wt1 兄弟路径必须拒绝', async () => {
  const fixture = await makeGitFixture('wtg-d11-prefix', [
    { name: 'wt1', dir: 'demo-repo-wt1', branch: 'wt1' },
    { name: 'wt1x', dir: 'demo-repo-wt1x', branch: 'wt1x' },
  ])
  const { root, repo, worktreePath } = fixture
  // 前缀伪装目标：**确实存在于磁盘**，但不是任何 worktree、也不是已注册工作区。
  // 关键点：它存在 ⇒ 旧实现（只校验 `pathExists`）会放行；新实现（白名单精确匹配）必须拒绝。
  // 若白名单退化成 `startsWith(wt1)`，这条会被错误放行。
  const spoof = `${worktreePath.wt1}extra`
  await mkdir(spoof, { recursive: true })
  assert.equal(existsSync(spoof), true, '夹具：前缀伪装目录**存在**（这样拒绝只能来自白名单）')

  const ctx = makeCtx(
    services({
      workspaceRegistry: fakeRegistry([
        mainWorkspace(repo),
        { ...mainWorkspace(worktreePath.wt1, 'ws-wt1') },
      ]),
    }),
  )
  const opts = { ledger: ledgerAt(root), now: 1 }

  // 放行：白名单内的 wt1（已注册）
  clearScanCache()
  let res = makeResponse()
  await handleReveal(ctx, res, { path: worktreePath.wt1 }, opts)
  assert.equal(res.statusCode, 200, `白名单内的已注册 worktree 应放行：${JSON.stringify(res.body)}`)

  // 拒绝：纯前缀伪装（存在但不在白名单）
  clearScanCache()
  res = makeResponse()
  await handleReveal(ctx, res, { path: spoof }, opts)
  assert.equal(
    res.statusCode,
    400,
    `前缀伪装路径必须拒绝（它存在但不是 worktree）：${JSON.stringify(res.body)} —— 前缀匹配会错误放行`,
  )
  assert.equal(res.body.ok, false, '拒绝时 ok 应为 false')

  // 对照：wt1x 是**真实 worktree**（git 扫描到了），按 D-11 的白名单语义应放行 ——
  // 这证明上面的拒绝来自「精确匹配」而不是「凡是以 wt1 开头就拒」。
  clearScanCache()
  res = makeResponse()
  await handleReveal(ctx, res, { path: worktreePath.wt1x }, opts)
  assert.equal(
    res.statusCode,
    200,
    `wt1x 是 git 扫描到的真实 worktree，白名单（含未注册 worktree）应放行：${JSON.stringify(res.body)}`,
  )
})

test('§4 D-11 reveal：白名单内的路径放行，且真的调起了打开器（不弹窗）', async () => {
  const fixture = await makeGitFixture('wtg-d11-open', [
    { name: 'wt1', dir: 'demo-repo-wt1', branch: 'wt1' },
  ])
  const { root, repo, worktreePath } = fixture
  const target = worktreePath.wt1

  const ctx = makeCtx(services({ workspaceRegistry: fakeRegistry([mainWorkspace(repo)]) }))
  const opener = await installFakeOpeners(root)
  try {
    const res = makeResponse()
    await handleReveal(ctx, res, { path: target }, { ledger: ledgerAt(root), now: 1 })
    assert.equal(res.statusCode, 200, `白名单内路径应放行：${JSON.stringify(res.body)}`)
    assert.deepEqual(res.body, { ok: true }, '成功响应应为 {ok:true}')
    const calls = opener.calls()
    assert.ok(calls.length >= 1, '应真的调用打开器（证明 revealPath 被走到，而不仅是校验通过）')
    assert.ok(
      calls.some((line) => line.includes(target)),
      `打开器应收到目标路径，实际调用：${JSON.stringify(calls)}`,
    )
  } finally {
    opener.restore()
  }
})

test('§4 D-11 reveal：打开器失败时仍回 JSON 400，绝不把异常抛到 HTTP 层', async () => {
  const fixture = await makeGitFixture('wtg-d11-open-fail', [
    { name: 'wt1', dir: 'demo-repo-wt1', branch: 'wt1' },
  ])
  const { root, repo, worktreePath } = fixture
  const opener = await installFakeOpeners(root, { script: '#!/bin/sh\nexit 3\n' })
  const registry = fakeRegistry([mainWorkspace(repo)])

  // ⚠️ 注意测的是哪一层：`handleReveal` **本身**会把打开器的异常上抛（它只负责
  // 校验 + 调起外部进程），收敛成 JSON 的是 `registerRoutes` 包在外面的那一层
  // （`routes.ts:1240-1248`，注释写明「最后一道防线」）。因此这里必须走**真实注册的
  // handler**，否则测的是一个不存在的承诺。
  const server = await startRouteServer({ workspaceRegistry: registry })
  try {
    const res = await server.post(ROUTE_PATHS.reveal, { path: worktreePath.wt1 })
    assert.equal(res.status, 400, `打开器失败应被收敛成 400 JSON：${JSON.stringify(res.body)}`)
    assert.equal(res.body.ok, false, '失败时 ok 应为 false')
    assert.equal(typeof res.body.message, 'string', '失败时应给出可读原因（客户端拿得到）')
    assert.equal(
      String(res.contentType).startsWith('application/json'),
      true,
      '必须是 JSON 而不是宿主的空体 400（宿主在 handler 抛错时只回 400 空体）',
    )
    const calls = opener.calls()
    assert.deepEqual(calls, [], '退出码 3 的假打开器不写日志，因此日志应为空（仍不影响上面的结论）')
  } finally {
    await server.close()
    opener.restore()
  }
})

test('§4 D-11 reveal：路径存在但不在白名单 ⇒ 不得触达打开器', async () => {
  const fixture = await makeGitFixture('wtg-d11-noopen')
  const { root, repo } = fixture
  const outside = join(root, 'exists-but-unknown')
  await mkdir(outside, { recursive: true })
  const opener = await installFakeOpeners(root)
  const ctx = makeCtx(services({ workspaceRegistry: fakeRegistry([{ id: 'ws', path: repo, title: '', createdAt: '', updatedAt: '' }]) }))
  try {
    clearScanCache()
    const res = makeResponse()
    await handleReveal(ctx, res, { path: outside }, { ledger: ledgerAt(root), now: 1 })
    assert.equal(res.statusCode, 400, '白名单外路径应拒绝')
    assert.deepEqual(opener.calls(), [], '拒绝路径**绝不允许**触达打开器（这是 D-11 的核心风险）')
  } finally {
    opener.restore()
  }
})

test('§4 assertKnown：缺 path / 非字符串 path 一律拒绝（handler 层面）', async () => {
  const fixture = await makeGitFixture('wtg-assertknown')
  const { root, repo } = fixture
  const ctx = makeCtx(services({ workspaceRegistry: fakeRegistry([{ id: 'ws', path: repo, title: '', createdAt: '', updatedAt: '' }]) }))
  for (const bad of [undefined, null, '', '   ', 0, 42, true, {}, []]) {
    const res = makeResponse()
    await handleReveal(ctx, res, { path: bad }, { ledger: ledgerAt(root), now: 1 })
    assert.equal(res.statusCode, 400, `path=${JSON.stringify(bad)} 应被拒绝`)
  }
})

test('§4 【D-N1 修复】baseRef 以 `-` 开头 ⇒ 400 拒绝，且**没有任何 worktree 被创建**', async () => {
  // 缺陷原文：baseRef 直接拼进 `git worktree add -b <branch> <target> [baseRef]` 的末尾，
  // 没有 `--` 分隔符、也没有「不得以 - 开头」的校验。于是 `--no-checkout` 这类**选项**会被
  // git 当作选项执行（而非当 ref 报 `invalid reference`）：worktree 目录里只有 `.git`、
  // 没有任何检出文件，接口却返回 `200 {ok:true}` 并自动注册成工作区。与 D-5 同族的入参缺口。
  //
  // 修复：①`isSafeGitArg` 挡住前导 `-`；②加 `--` 分隔符让 pathspec 之后的值只能被当作 ref。
  const fixture = await makeGitFixture('wtg-n1-reject')
  const { root, repo, git } = fixture
  const before = await worktreePaths(git)

  for (const bad of ['--no-checkout', '--detach', '-b', '-f', '--orphan']) {
    clearScanCache()
    const res = makeResponse()
    await handleWorktreeCreate(
      makeCtx(services({ workspaceRegistry: fakeRegistry([mainWorkspace(repo)]) })),
      res,
      { repoPath: repo, branch: 'noc', baseRef: bad },
      { ledger: ledgerAt(root), now: 1_700_000 },
    )
    assert.equal(res.statusCode, 400, `baseRef=${bad} 应被拒绝：${JSON.stringify(res.body)}`)
    assert.equal(res.body.ok, false, `baseRef=${bad} 拒绝时 ok 必须为 false`)
  }

  // 「什么都没建」的正确判据是**前后不变**，而不是「不存在」。
  assert.deepEqual(await worktreePaths(git), before, '拒绝时不得改动 git worktree 列表')
  assert.equal(
    existsSync(defaultWorktreePath(repo, 'noc')),
    false,
    '被拒绝的 baseRef 不得留下默认落点目录（`--no-checkout` 曾真的建出只有 .git 的目录）',
  )
})

test('§4 【D-N1 修复】branch 以 `-` 开头同样被拒绝（选项注入的第二条入口）', async () => {
  const fixture = await makeGitFixture('wtg-n1-branch')
  const { root, repo, git } = fixture
  const before = await worktreePaths(git)
  clearScanCache()
  const res = makeResponse()
  await handleWorktreeCreate(
    makeCtx(services({ workspaceRegistry: fakeRegistry([mainWorkspace(repo)]) })),
    res,
    { repoPath: repo, branch: '--detach' },
    { ledger: ledgerAt(root), now: 1_700_000 },
  )
  assert.equal(res.statusCode, 400, `branch=--detach 应被拒绝：${JSON.stringify(res.body)}`)
  assert.equal(res.body.ok, false, '拒绝时 ok 必须为 false')
  assert.deepEqual(await worktreePaths(git), before, '拒绝时不得创建 worktree')
})

test('§4 【D-N1 修复】正向不回归：合法 baseRef（HEAD / 分支名 / tag）与 createBranch:false 仍成功', async () => {
  // `--` 分隔符必须**不破坏正常用法**。实测（git 2.54.0）：
  //   git worktree add -b <b> -- <path> [<ref>]  与  git worktree add -- <path> <branch>
  // 对 HEAD / 含 `/` 的分支名 / tag 起点全部正常。
  const fixture = await makeGitFixture('wtg-n1-ok')
  const { root, repo, git } = fixture
  await git(['branch', 'feature/ohos']) // 合法的含 `/` 分支名（不得被过严白名单砍掉）
  await git(['tag', 'v1.0.0'])

  const cases = [
    ['baseRef=HEAD', { branch: 'from-head', baseRef: 'HEAD' }],
    ['baseRef=feature/ohos（含 / 的合法分支）', { branch: 'from-slash', baseRef: 'feature/ohos' }],
    ['baseRef=v1.0.0（合法 tag）', { branch: 'from-tag', baseRef: 'v1.0.0' }],
    ['createBranch:false 检出已有分支', { branch: 'feature/ohos', createBranch: false }],
  ]

  for (const [label, body] of cases) {
    const expected = defaultWorktreePath(repo, body.branch)
    clearScanCache()
    const res = makeResponse()
    await handleWorktreeCreate(
      makeCtx(services({ workspaceRegistry: fakeRegistry([mainWorkspace(repo)]) })),
      res,
      { repoPath: repo, ...body },
      { ledger: ledgerAt(root), now: 1_700_000 },
    )
    assert.equal(res.statusCode, 200, `应成功（${label}）：${JSON.stringify(res.body)}`)
    assert.equal(res.body.ok, true, `成功时 ok 为 true（${label}）`)
    assert.equal(res.body.worktreePath, expected, `落盘路径应与默认推导一致（${label}）`)
    // 关键：不是「建了个空壳」—— 文件必须真的被检出（这正是 `--no-checkout` 攻击的反面）。
    assert.equal(
      existsSync(join(expected, 'README.md')),
      true,
      `worktree 里必须真的检出主仓文件（${label}）：${expected}`,
    )
  }
})

test('§4 【D-N1 修复】`--` 不改变语义：baseRef 指定的 revision 必须真的生效（而非被忽略回退到 HEAD）', async () => {
  // 只断言「命令成功」不足以证明 `--` 没破坏功能 —— git 完全可能**忽略** position 3 的 ref
  // 而回退到 HEAD。这里让 `feature/ohos` 与 HEAD 指向**不同 commit**，用检出内容区分。
  const fixture = await makeGitFixture('wtg-n1-refsem')
  const { root, repo, git } = fixture
  await git(['branch', 'feature/ohos']) // 指向 init：只有 README.md
  await writeFile(join(repo, 'SECOND.md'), 'second\n', 'utf8')
  await git(['add', '.'])
  await git(['commit', '-q', '-m', 'second']) // main/HEAD 前进：README.md + SECOND.md
  await git(['tag', 'v1.0.0']) // tag 落在第二个 commit 上

  const run = async (label, body, expectSecond) => {
    const expected = defaultWorktreePath(repo, body.branch)
    clearScanCache()
    const res = makeResponse()
    await handleWorktreeCreate(
      makeCtx(services({ workspaceRegistry: fakeRegistry([mainWorkspace(repo)]) })),
      res,
      { repoPath: repo, ...body },
      { ledger: ledgerAt(root), now: 1_700_000 },
    )
    assert.equal(res.statusCode, 200, `应成功（${label}）：${JSON.stringify(res.body)}`)
    assert.equal(existsSync(join(expected, 'README.md')), true, `README.md 必须被检出（${label}）`)
    assert.equal(
      existsSync(join(expected, 'SECOND.md')),
      expectSecond,
      expectSecond
        ? `baseRef=${body.baseRef} 应指向含 SECOND.md 的 commit（${label}）`
        : `baseRef=${body.baseRef} 应停在**不含** SECOND.md 的旧 commit —— 否则说明 ref 被忽略、回退到了 HEAD（${label}）`,
    )
  }

  await run('baseRef=feature/ohos（停在 init）', { branch: 'sem-slash', baseRef: 'feature/ohos' }, false)
  await run('baseRef=HEAD（含 SECOND.md）', { branch: 'sem-head', baseRef: 'HEAD' }, true)
  await run('baseRef=v1.0.0（含 SECOND.md）', { branch: 'sem-tag', baseRef: 'v1.0.0' }, true)
  await run('createBranch:false 检出 feature/ohos（停在 init）', { branch: 'feature/ohos', createBranch: false }, false)
})

test('§4 【D-N2 修复】targetPath 是符号链接 ⇒ 拒绝，且仓外真身里不出现主仓文件', async () => {
  // 缺陷原文：validateTargetPath 只做 `normalizePath`（resolve，**不解析符号链接**），
  // 因此 `/parent/<主仓名>-evil-link` 这种**词法上完全合法**的路径，只要它是指向仓外的
  // 符号链接，就会通过校验；git 随后把整个 worktree 铺到链接的**真身**目录里，D-5 被绕过。
  const fixture = await makeGitFixture('wtg-n2-symlink')
  const { root, repo, git } = fixture
  const outside = await makeRoot('wtg-attacker-outside')
  const link = join(root, 'demo-repo-evil-link')
  await symlink(outside, link)

  const before = await worktreePaths(git)
  clearScanCache()
  const res = makeResponse()
  await handleWorktreeCreate(
    makeCtx(services({ workspaceRegistry: fakeRegistry([mainWorkspace(repo)]) })),
    res,
    { repoPath: repo, branch: 'evil', targetPath: link },
    { ledger: ledgerAt(root), now: 1_700_000 },
  )

  assert.equal(res.statusCode, 400, `符号链接 targetPath 应被拒绝：${JSON.stringify(res.body)}`)
  assert.equal(res.body.ok, false, '拒绝时 ok 必须为 false')
  assert.deepEqual(await readdir(outside), [], '仓外真身目录里**不得**出现任何文件（worktree 未被铺到仓外）')
  assert.deepEqual(await worktreePaths(git), before, '拒绝时不得改动 git worktree 列表')
})

test('§4 【D-N2 修复】targetPath 父目录不可解析（悬空符号链接）⇒ 拒绝，不退化成放行', async () => {
  const fixture = await makeGitFixture('wtg-n2-dangling')
  const { root, repo, git } = fixture
  const danglingParent = join(root, 'demo-repo-dangling-parent')
  await symlink(join(root, 'no-such-dir-anywhere'), danglingParent)
  const target = join(danglingParent, 'demo-repo-x')

  const before = await worktreePaths(git)
  clearScanCache()
  const res = makeResponse()
  await handleWorktreeCreate(
    makeCtx(services({ workspaceRegistry: fakeRegistry([mainWorkspace(repo)]) })),
    res,
    { repoPath: repo, branch: 'dangle', targetPath: target },
    { ledger: ledgerAt(root), now: 1_700_000 },
  )
  assert.equal(res.statusCode, 400, `父目录不可解析应被拒绝：${JSON.stringify(res.body)}`)
  assert.equal(res.body.ok, false, '拒绝时 ok 必须为 false')
  assert.deepEqual(await worktreePaths(git), before, '拒绝时不得创建 worktree')
})

test('§4 【D-N2 修复】targetPath 已是**悬空符号链接** ⇒ 拒绝（lstat 而非 stat）', async () => {
  const fixture = await makeGitFixture('wtg-n2-selflink')
  const { root, repo, git } = fixture
  const link = join(root, 'demo-repo-self-link')
  await symlink(join(root, 'no-such-dir-anywhere'), link) // 悬空：跟随会 ENOENT，只有 lstat 能看出它是链接

  const before = await worktreePaths(git)
  clearScanCache()
  const res = makeResponse()
  await handleWorktreeCreate(
    makeCtx(services({ workspaceRegistry: fakeRegistry([mainWorkspace(repo)]) })),
    res,
    { repoPath: repo, branch: 'selflink', targetPath: link },
    { ledger: ledgerAt(root), now: 1_700_000 },
  )
  assert.equal(res.statusCode, 400, `悬空符号链接 targetPath 应被拒绝：${JSON.stringify(res.body)}`)
  assert.equal(res.body.ok, false, '拒绝时 ok 必须为 false')
  assert.deepEqual(await worktreePaths(git), before, '拒绝时不得创建 worktree')
})


test('§4 【D-N2 修复】targetPath 父目录**不存在** ⇒ 拒绝（realpath 失败不得退化成放行）', async () => {
  const fixture = await makeGitFixture('wtg-n2-noparent')
  const { root, repo, git } = fixture
  // 词法上仍在主仓父目录之下，但中间一级 `demo-repo-missing` 不存在 ⇒ realpath 必然 ENOENT。
  const target = join(root, 'demo-repo-missing', 'demo-repo-nested')

  const before = await worktreePaths(git)
  clearScanCache()
  const res = makeResponse()
  await handleWorktreeCreate(
    makeCtx(services({ workspaceRegistry: fakeRegistry([mainWorkspace(repo)]) })),
    res,
    { repoPath: repo, branch: 'nested', targetPath: target },
    { ledger: ledgerAt(root), now: 1_700_000 },
  )
  assert.equal(res.statusCode, 400, `父目录不存在应被拒绝：${JSON.stringify(res.body)}`)
  assert.equal(res.body.ok, false, '拒绝时 ok 必须为 false')
  assert.equal(existsSync(join(root, 'demo-repo-missing')), false, '拒绝时不得把缺失的父目录建出来')
  assert.deepEqual(await worktreePaths(git), before, '拒绝时不得创建 worktree')
})

test('§4 【D-N2 修复】validateTargetPath 第三参（realpath 父目录）生效，且缺省时保持原词法行为', async () => {
  const fixture = await makeGitFixture('wtg-n2-unit')
  const { root, repo } = fixture
  const outside = await makeRoot('wtg-n2-unit-outside')
  const link = join(root, 'demo-repo-unit-link')
  await symlink(outside, link)

  // 缺省第三参：保持原词法行为（既有 9 类拒绝 + 放行用例的前提）。
  assert.equal(
    validateTargetPath(link, repo).ok,
    true,
    '第三参缺省时必须保持原词法行为（既有 9 类拒绝 + 放行用例的前提）',
  )

  // 分工说明（避免了两种常见误解）：
  //  - 「targetPath 本身是符号链接」由 `resolveRealTargetParents` 的 `lstat` 判定，
  //    不在本函数里（本函数是纯函数、不做 IO）；
  //  - 「父目录真身（realpath）是否等于主仓父目录」也在 `resolveRealTargetParents` 里判完，
  //    本函数拿到的 `parentReal` 已是**校验通过的真身**，因此它的第 1 条判据恒成立。
  // 本函数在拿到 `parentReal` 后的实际职责是：把命中判据与返回路径都搬进 **realpath 空间**。
  const parentReal = await realpath(dirname(repo))
  const mainReal = await realpath(repo)

  // 因为判据在 realpath 空间，「等于主仓自身」这一条对**不同词法拼法**也成立：
  // 原始值取自仓外的 `outside`，归一后落回主仓真身 ⇒ 必须被拒。
  const equalish = validateTargetPath(join(outside, 'demo-repo'), mainReal, parentReal)
  assert.equal(equalish.ok, false, `realpath 空间下等于主仓自身必须拒绝：${JSON.stringify(equalish)}`)
  assert.equal(equalish.message.length > 0, true, '拒绝必须给出原因')

  // 正常路径在传了真身父目录后仍放行，且返回 realpath 空间的路径（可直接交给 git）。
  const okTarget = join(root, 'demo-repo-unit-ok')
  const okVerdict = validateTargetPath(okTarget, mainReal, parentReal)
  assert.equal(okVerdict.ok, true, `正常路径应放行：${JSON.stringify(okVerdict)}`)
  assert.equal(okVerdict.path, join(parentReal, 'demo-repo-unit-ok'), '放行时应返回 realpath 空间的路径')
})

test('§4 【D-N1】isSafeGitArg：挡前导 `-` 与控制字符，但放行含 `/` `.` 的合法分支名', () => {
  for (const bad of ['', '-', '--no-checkout', '-b', '\0', 'a\nb', 'a\rb']) {
    assert.equal(isSafeGitArg(bad), false, `必须拒绝：${JSON.stringify(bad)}`)
  }
  // PRD 的真实分支名形态必须放行 —— 用「只允许字母数字」的过严白名单会砍掉它们。
  for (const good of ['feature/ohos', 'release/6.1.20', 'main', 'HEAD', 'v1.0.0']) {
    assert.equal(isSafeGitArg(good), true, `必须放行：${JSON.stringify(good)}`)
  }
})

/* ------------------------------------------------------------------ *
 * §5 `workspaceSignature`（D-8）
 * ------------------------------------------------------------------ */

/** 造一条 `WorkspaceRow`。 */
function wsRow(workspaceId, path = '/repo', updatedAt = 'u') {
  return { workspaceId, path, title: `title-${workspaceId}`, createdAt: '', updatedAt }
}

test('§5 workspaceSignature：同长度但成员不同 ⇒ 签名不同（旧 length 比较检不出）', () => {
  const before = [wsRow('a'), wsRow('b')]
  const after = [wsRow('a'), wsRow('c')]
  assert.equal(before.length, after.length, '前提：两组长度相同（这正是不该用长度的理由）')
  assert.notEqual(
    workspaceSignature(before),
    workspaceSignature(after),
    'D-8：清扫删 1 条 + 宿主同轮新增 1 条时长度相等，签名必须能检出成员变化',
  )
})

test('§5 workspaceSignature：同成员、顺序不同 ⇒ 签名相同', () => {
  const a = [wsRow('a'), wsRow('b'), wsRow('c')]
  const b = [wsRow('c'), wsRow('a'), wsRow('b')]
  assert.equal(
    workspaceSignature(a),
    workspaceSignature(b),
    '排序后比较 ⇒ 与 registry.list() 的返回顺序无关（顺序变化不应被当成内容变化）',
  )
})

test('§5 workspaceSignature：同 id 不同 path ⇒ 检出', () => {
  assert.notEqual(
    workspaceSignature([wsRow('a', '/repo-one')]),
    workspaceSignature([wsRow('a', '/repo-two')]),
    '路径改写必须被检出',
  )
})

test('§5 workspaceSignature：同 id + 同 path 不同 updatedAt ⇒ 检出', () => {
  assert.notEqual(
    workspaceSignature([wsRow('a', '/repo', 'u1')]),
    workspaceSignature([wsRow('a', '/repo', 'u2')]),
    '宿主对 title 重命名 / delete 都会动 updatedAt，必须纳入签名',
  )
})

test('§5 workspaceSignature：空表与单条的边界（空表签名是空串，且与任何非空表不同）', () => {
  assert.equal(workspaceSignature([]), '', '空表签名应为空串')
  assert.notEqual(workspaceSignature([]), workspaceSignature([wsRow('a')]), '空表与非空表必须不同')
})

test('§5 D-8 集成：清扫删 1 条 + 宿主同轮新增 1 条 ⇒ 本轮响应反映清扫结果', async () => {
  // 复刻 D-8 的时序：snapshot 读到 [main, dead]，清扫删掉 dead，
  // 紧接着重新读注册表得到 [main, new] —— **长度相同**。
  const fixture = await makeGitFixture('wtg-d8')
  const { root, repo, git } = fixture
  const dead = join(root, 'demo-repo-dead')
  await git(['worktree', 'add', '-b', 'dead', dead])
  await rm(dead, { recursive: true, force: true }) // 模拟外部 rm -rf（D18 的触发条件）
  const plain = join(root, 'plain-dir')
  await mkdir(plain, { recursive: true })

  const rounds = [
    [
      { id: 'ws-main', path: repo, title: 'main', createdAt: '', updatedAt: '' },
      { id: 'ws-dead', path: dead, title: 'dead', createdAt: '', updatedAt: '' },
    ],
    [
      { id: 'ws-main', path: repo, title: 'main', createdAt: '', updatedAt: '' },
      { id: 'ws-new', path: plain, title: 'new', createdAt: '', updatedAt: '' },
    ],
  ]
  let listCalls = 0
  const registry = {
    list() {
      const round = rounds[Math.min(listCalls, rounds.length - 1)]
      listCalls += 1
      return round
    },
    create: async (path) => ({ id: 'ws-x', path }),
    delete: async () => true,
  }

  clearScanCache()
  const payload = await buildTreePayload(
    makeCtx(services({ workspaceRegistry: registry })),
    { ledger: ledgerAt(root), now: 1_700_000 },
  )

  assert.ok(listCalls >= 2, `清扫后必须重新读一次注册表（实际只读了 ${listCalls} 次）`)
  // 说明：下面第一条断言在**修好前后都成立**（死工作区无论如何都会从 workspaceByPath
  // 里被摘掉），因此它只是不变量；**真正能区分新旧实现的是第二条**（ws-new）。
  assert.equal(
    payload.projects.some((project) => project.key === 'ws:ws-dead'),
    false,
    '不变量：死工作区不得留在本轮响应里',
  )
  assert.equal(
    Object.keys(payload.workspaceByPath).some((path) => path.endsWith('demo-repo-dead')),
    false,
    '不变量：被注销的工作区路径必须从 workspaceByPath 索引里摘掉',
  )
  assert.equal(
    payload.projects.some((project) => project.key === 'ws:ws-new'),
    true,
    'D-8 判别性断言：长度相等时也必须用刷新后的注册表（旧实现退回旧表 ⇒ 这里会是 false）',
  )
})

test('§5 sanitizeBranchForPath / defaultWorktreePath：分支名净化与路径拼接', () => {
  assert.equal(sanitizeBranchForPath('feature/ohos'), 'feature-ohos', '斜杠应被换成连字符')
  assert.equal(sanitizeBranchForPath('release/6.1.20'), 'release-6.1.20', '点号应保留')
  assert.equal(sanitizeBranchForPath('///'), 'worktree', '全部被净化掉时应回退 worktree')
  assert.equal(sanitizeBranchForPath(''), 'worktree', '空分支名应回退 worktree')
  assert.equal(defaultWorktreePath('/a/b/repo', 'feat/x'), '/a/b/repo-feat-x', '默认路径拼接')
  assert.equal(defaultWorktreePath('/a/b/repo/', 'feat'), '/a/b/repo-feat', '主仓尾斜杠应被归一')
})

/* ------------------------------------------------------------------ *
 * §6 降级不崩（PRD R6）
 * ------------------------------------------------------------------ */

test('§6 降级：ctx.get("webServer") 返回 undefined ⇒ registerRoutes / apply 都不抛错', () => {
  const ctx = makeCtx(() => undefined, {
    effect() {
      throw new Error('webServer 缺席时不应注册任何 effect')
    },
  })
  assert.doesNotThrow(() => registerRoutes(ctx), 'webServer 缺席时 registerRoutes 必须静默降级')
  assert.doesNotThrow(() => apply(ctx), 'webServer 缺席时 apply 必须静默降级（PRD R6）')
})

test('§6 降级：ctx.get 本身抛错 ⇒ 被 getService 吞掉，不崩', async () => {
  const ctx = makeCtx(() => {
    throw new Error('cordis 诊断错误')
  })
  assert.doesNotThrow(() => registerRoutes(ctx), 'ctx.get 抛错时 registerRoutes 不应崩')
  const { rows, summaries } = await buildSessionRows(ctx)
  assert.deepEqual(rows, [], '所有服务都拿不到时不应有会话行')
  assert.equal(summaries.size, 0, '摘要表应为空')
  const payload = await buildTreePayload(ctx, { ledger: ledgerAt(await makeRoot('wtg-getthrow')), now: 1 })
  assert.deepEqual(payload.projects, [], '拿不到服务时项目表应为空')
  assert.equal(payload.ok, true, '降级路径仍应返回 ok:true 的空树')
})

test('§6 降级：sessionPersistence 缺席 ⇒ 只有实时摘要，不崩', async () => {
  const ctx = makeCtx(
    services({
      sessionController: { list: async () => ({ items: [hostSummary('s-live', { updatedAt: 3 })] }) },
    }),
  )
  const { rows } = await buildSessionRows(ctx)
  assert.deepEqual(rows.map((row) => row.sessionId), ['s-live'], 'sessionPersistence 缺席时退化为「只有实时会话」')
})

test('§6 降级：sessionPersistence.list 抛错 ⇒ 退化为「只有实时会话」而不是整棵树失败', async () => {
  const ctx = makeCtx(
    services({
      sessionController: { list: async () => ({ items: [hostSummary('s-live', { updatedAt: 3 })] }) },
      sessionPersistence: {
        list: async () => {
          throw new Error('磁盘读失败')
        },
      },
    }),
  )
  const { rows } = await buildSessionRows(ctx)
  assert.deepEqual(rows.map((row) => row.sessionId), ['s-live'], '存储故障不应让整棵树失败')
})

test('§6 降级：sessionController 缺席 ⇒ 回退到 ctx.sessions.list()（活 Session / observable 两种形态）', async () => {
  // 形态 1：活 Session 实例（有 .header）—— 契约 §A2.2
  const liveCtx = makeCtx(
    services({
      sessions: {
        list: () => [{ header: { id: 's-live', createdAt: 55, cwd: '/tmp/x' }, seq: 0 }],
      },
    }),
  )
  const live = await loadSessionSummaries(liveCtx)
  assert.equal(live.size, 1, '应能从活 Session 的 header 推导最小摘要')
  assert.equal(live.get('s-live').updatedAt, 55, 'updatedAt 应取 header.createdAt')
  assert.equal(live.get('s-live').running, false, '活 Session 推导的摘要 running 为 false（无从得知）')
  assert.equal(live.get('s-live').blank, true, 'seq === 0 ⇒ blank 为 true')

  // 形态 2：observable 快照源（{ getSnapshot }）
  const obsCtx = makeCtx(
    services({
      sessions: {
        list: {
          getSnapshot: () => ({ items: [hostSummary('s-snap', { updatedAt: 77 })], byId: {} }),
        },
      },
    }),
  )
  const snap = await loadSessionSummaries(obsCtx)
  assert.equal(snap.size, 1, '应能从 observable 快照的 items 读出摘要')
  assert.equal(snap.get('s-snap').updatedAt, 77, '应保留快照里的 updatedAt')

  // 形态 3：两者都缺席
  const emptyCtx = makeCtx(() => undefined)
  assert.equal((await loadSessionSummaries(emptyCtx)).size, 0, '两者都缺席 ⇒ 空摘要表，不崩')
})

test('§6 降级：workspaceRegistry 缺席 ⇒ 空工作区表、空树，不崩', async () => {
  const root = await makeRoot('wtg-no-registry')
  const ctx = makeCtx(() => undefined)
  const loaded = loadWorkspaces(ctx)
  assert.deepEqual(loaded.workspaces, [], '注册表缺席 ⇒ 空工作区表')
  assert.equal(loaded.registry, undefined, 'registry 应为 undefined')
  assert.deepEqual(loadArchivedSessionIds(undefined), [], 'archivedSessionIds 缺席 ⇒ 空数组')

  clearScanCache()
  const payload = await buildTreePayload(ctx, { ledger: ledgerAt(root), now: 1 })
  assert.equal(payload.ok, true, '注册表缺席仍应返回 ok:true')
  assert.deepEqual(payload.projects, [], '注册表缺席 ⇒ 无项目节点')
})

test('§6 降级：registry.list() 抛错 ⇒ 返回已读到的部分（不崩）', () => {
  let calls = 0
  const ctx = makeCtx(
    services({
      workspaceRegistry: {
        list() {
          calls += 1
          throw new Error('references missing workspace')
        },
      },
    }),
  )
  const loaded = loadWorkspaces(ctx)
  assert.deepEqual(loaded.workspaces, [], 'list() 抛错时应返回空表而不是上抛')
  assert.ok(calls >= 1, '应确实调用过 list()')
})

test('§6 降级：registry.list() 返回含非法项 ⇒ 逐条跳过（缺 id / 缺 path / null）', () => {
  const ctx = makeCtx(
    services({
      workspaceRegistry: {
        list: () => [
          { id: 'ws-ok', path: '/repo-ok', title: 'ok', createdAt: 'c', updatedAt: 'u' },
          { id: undefined, path: '/no-id' },
          { id: 'ws-no-path', path: undefined },
          null,
          42,
          { id: '', path: '/empty-id' },
        ],
      },
    }),
  )
  const loaded = loadWorkspaces(ctx)
  assert.deepEqual(
    loaded.workspaces.map((row) => row.workspaceId),
    ['ws-ok'],
    '只有同时具备非空 id 与非空 path 的实体才应被投影',
  )
})

test('§6 降级：registerRoute 的 webServer.register 返回 undefined ⇒ 用 no-op disposer 兜底', () => {
  const registered = []
  const ctx = makeCtx(
    services({
      webServer: {
        register(route) {
          registered.push(route)
          return undefined // 宿主未返回 disposer
        },
      },
    }),
    {
      effect(fn) {
        const disposer = fn()
        assert.equal(typeof disposer, 'function', 'effect 必须拿到一个可调用的 disposer')
        return disposer
      },
    },
  )
  assert.doesNotThrow(() => registerRoutes(ctx), 'register 不返回 disposer 时不应崩')
  assert.equal(registered.length, 5, '仍应注册全部 5 个路由')
})

test('§6 降级：ledger.read() 抛错 ⇒ collectSnapshot 用空台账，不崩', async () => {
  const root = await makeRoot('wtg-bad-ledger')
  const ctx = makeCtx(services({ workspaceRegistry: { list: () => [] } }))
  const badLedger = {
    read: async () => {
      throw new Error('boom-read')
    },
    write: async () => {},
    update: async () => {
      throw new Error('boom-update')
    },
  }
  clearScanCache()
  const snapshot = await collectSnapshot(ctx, { ledger: badLedger, now: 1 })
  assert.deepEqual(snapshot.ledger, { version: 1, projects: {}, sessions: {} }, '读台账失败 ⇒ 退化为空台账')

  // 台账更新失败也不影响 /tree 的响应（PRD R4：台账只是辅助归属信息）。
  clearScanCache()
  const payload = await buildTreePayload(ctx, { ledger: badLedger, now: 1 })
  assert.equal(payload.ok, true, '台账写失败不应让 /tree 失败')
})

test('§6 降级：D18 清扫在 registry.delete 抛错时收集失败项而不是中断', async () => {
  const root = await makeRoot('wtg-sweep-fail')
  const deadA = join(root, 'demo-repo-a')
  const deadB = join(root, 'demo-repo-b')
  const ctx = makeCtx(
    services({
      workspaceRegistry: {
        list: () => [],
        delete: async (id) => {
          if (id === 'ws-a') throw new Error('删除失败')
          return true
        },
      },
    }),
  )
  const snapshot = {
    workspaces: [
      { workspaceId: 'ws-a', path: deadA, title: '', createdAt: '', updatedAt: '' },
      { workspaceId: 'ws-b', path: deadB, title: '', createdAt: '', updatedAt: '' },
    ],
    liveWorkspacePaths: new Set(),
    nonMainWorkspacePaths: new Set([deadA, deadB]),
  }
  const swept = await sweepDeadWorkspaces(ctx, snapshot)
  assert.deepEqual(swept.removed, ['ws-b'], '成功的注销应被记录（单个失败不中断整体）')
  assert.equal(swept.failed.length, 1, '失败的注销应被收集')
  assert.equal(swept.failed[0].workspaceId, 'ws-a', '失败项应带上 workspaceId')
  assert.equal(typeof swept.failed[0].message, 'string', '失败项应带上可读原因')
})

test('§6 降级：D18 不清扫「目录已死但无法判定为非主树」的工作区（正面证据原则）', async () => {
  const root = await makeRoot('wtg-sweep-evidence')
  const deleted = []
  const ctx = makeCtx(
    services({
      workspaceRegistry: {
        list: () => [],
        delete: async (id) => {
          deleted.push(id)
          return true
        },
      },
    }),
  )
  const snapshot = {
    workspaces: [
      { workspaceId: 'ws-main', path: join(root, 'main-gone'), title: '', createdAt: '', updatedAt: '' },
      { workspaceId: 'ws-live', path: join(root, 'live'), title: '', createdAt: '', updatedAt: '' },
      { workspaceId: 'ws-dead-nonmain', path: join(root, 'dead-nonmain'), title: '', createdAt: '', updatedAt: '' },
    ],
    // ws-main 不在 nonMainWorkspacePaths 里（拿不到「非主树」的正面证据）⇒ 不许动
    liveWorkspacePaths: new Set([join(root, 'live')]),
    nonMainWorkspacePaths: new Set([join(root, 'dead-nonmain')]),
  }
  const swept = await sweepDeadWorkspaces(ctx, snapshot)
  assert.deepEqual(swept.removed, ['ws-dead-nonmain'], '只应注销「目录已死 + 有非主树正面证据」的那一条')
  assert.deepEqual(deleted, ['ws-dead-nonmain'], '主树目录消失时**不得**自动注销记录（D18 明文禁止项）')
})

test('§6 降级：workspaceRegistry 缺 delete ⇒ 清扫是 no-op', async () => {
  const ctx = makeCtx(services({ workspaceRegistry: { list: () => [] } }))
  const swept = await sweepDeadWorkspaces(ctx, {
    workspaces: [{ workspaceId: 'ws-a', path: '/gone', title: '', createdAt: '', updatedAt: '' }],
    liveWorkspacePaths: new Set(),
    nonMainWorkspacePaths: new Set(['/gone']),
  })
  assert.deepEqual(swept, { removed: [], failed: [] }, '缺 delete 时清扫应是安静的 no-op')
})

/* ------------------------------------------------------------------ *
 * 2026-10-29（RAS2/RAS3）：宿主 session/event → lastActivityAt → /tree 载荷
 * ------------------------------------------------------------------ */

test('2026-10-29/RAS2/RAS3: /tree 载荷带 lastActivityAt，session/event 活动（含子代理）实时传播', async () => {
  resetSessionActivity()
  const fake = fakeWebServer()
  const listeners = new Map()
  const ctx = makeCtx(
    services({
      webServer: fake.server,
      sessionController: {
        list: async () => ({
          items: [
            hostSummary('session-parent', { updatedAt: 100, cwd: '/repo' }),
            hostSummary('child-1', {
              updatedAt: 90,
              cwd: '/repo',
              parentSessionId: 'session-parent',
              origin: 'subagent',
            }),
            hostSummary('grandchild-1', {
              updatedAt: 80,
              cwd: '/repo',
              parentSessionId: 'child-1',
              origin: 'subagent',
            }),
          ],
        }),
      },
      sessionPersistence: {
        list: async () => [
          persistenceSnapshot('session-parent', { createdAt: 50, cwd: '/repo' }),
          persistenceSnapshot('child-1', {
            createdAt: 40,
            cwd: '/repo',
            parentSession: 'session-parent',
            origin: 'subagent',
          }),
          persistenceSnapshot('grandchild-1', {
            createdAt: 30,
            cwd: '/repo',
            parentSession: 'child-1',
            origin: 'subagent',
          }),
        ],
      },
      workspaceRegistry: { list: () => [] },
    }),
    {
      on(name, listener) {
        listeners.set(name, listener)
        return () => listeners.delete(name)
      },
    },
  )
  clearScanCache()
  registerRoutes(ctx)

  assert.equal(typeof listeners.get('session/event'), 'function', 'registerRoutes 必须监听宿主 session/event')

  const route = fake.routes.get(ROUTE_PATHS.tree)
  assert.equal(typeof route?.handler, 'function', '前置条件：/tree 路由已注册')
  const fetchRows = async () => {
    const res = makeResponse()
    await route.handler(makeRequest({}), res)
    assert.equal(res.statusCode, 200, `查询 /tree 应成功：${JSON.stringify(res.body)}`)
    return collectResponseRows(res.body)
  }

  // 1) 没有任何活动事件 ⇒ lastActivityAt 回退 updatedAt。
  let rows = await fetchRows()
  let byId = new Map(rows.map((row) => [row.sessionId, row]))
  assert.equal(byId.get('session-parent')?.lastActivityAt, 100, '无活动时回退 updatedAt')
  assert.equal(byId.get('child-1')?.lastActivityAt, 90, '子代理行同样回退 updatedAt')
  for (const row of rows) {
    assert.equal(
      Number.isFinite(row.lastActivityAt),
      true,
      `会话 ${row.sessionId} 的 lastActivityAt 必须是有限数字（实际 ${String(row.lastActivityAt)}）`,
    )
    assert.equal(
      row.lastActivityAt >= row.updatedAt,
      true,
      `会话 ${row.sessionId} 的 lastActivityAt 不得小于 updatedAt`,
    )
  }

  // 2) 孙代理产生活动 ⇒ 祖先主会话也拿到该时间（RAS3 传播）。
  listeners.get('session/event')(
    { id: 'session-grandchild-1' },
    { type: 'assistant/message', time: 900 },
  )
  rows = await fetchRows()
  byId = new Map(rows.map((row) => [row.sessionId, row]))
  assert.equal(byId.get('grandchild-1')?.lastActivityAt, 900, '后代自身拿到活动时间')
  assert.equal(byId.get('child-1')?.lastActivityAt, 900, '中间层收到传播')
  assert.equal(byId.get('session-parent')?.lastActivityAt, 900, '祖先主会话必须收到传播（最近分区据此上浮）')

  // 3) 更旧的事件不得回退最大值。
  listeners.get('session/event')({ id: 'session-parent' }, { type: 'user/message', time: 300 })
  rows = await fetchRows()
  byId = new Map(rows.map((row) => [row.sessionId, row]))
  assert.equal(byId.get('session-parent')?.lastActivityAt, 900, '更旧事件不得降低 lastActivityAt')

  // 4) 畸形事件静默忽略（绝不抛）。
  assert.doesNotThrow(() => listeners.get('session/event')({}, {}))
  assert.doesNotThrow(() => listeners.get('session/event')({ id: 'session-parent' }, { time: Number.NaN }))

  resetSessionActivity()
})

/* ------------------------------------------------------------------ *
 * §7 路由注册 / 释放
 * ------------------------------------------------------------------ */

/** 造一个记录注册项的假 webServer。 */
function fakeWebServer() {
  const routes = new Map()
  const disposed = []
  return {
    routes,
    disposed,
    server: {
      register(route) {
        routes.set(route.path, route)
        const disposer = () => {
          routes.delete(route.path)
          disposed.push(route.path)
        }
        return disposer
      },
    },
  }
}

test('§7 注册：registerRoutes 注册 ROUTE_PATHS 里的全部 5 个路由，且 kind 都是 exact', () => {
  const fake = fakeWebServer()
  const disposers = []
  const ctx = makeCtx(services({ webServer: fake.server }), {
    effect(fn) {
      const disposer = fn()
      disposers.push(disposer)
      return disposer
    },
  })

  registerRoutes(ctx)

  const expected = Object.values(ROUTE_PATHS).sort()
  assert.deepEqual([...fake.routes.keys()].sort(), expected, '注册的路由路径应与 ROUTE_PATHS 完全一致')
  assert.equal(fake.routes.size, 5, `应注册 5 个路由，实际 ${fake.routes.size}`)
  assert.equal(disposers.length, 5, '每个路由一个 ctx.effect（宿主契约硬约束 15）')
  for (const [path, route] of fake.routes) {
    assert.equal(route.kind, 'exact', `${path} 必须用 exact 注册（前缀匹配会抢别的插件路由）`)
    assert.equal(typeof route.handler, 'function', `${path} 的 handler 应是函数`)
  }
  assert.ok(ROUTE_PATHS.tree.startsWith('/dsh-worktree-groups/'), '路由必须带本插件命名空间前缀')
})

test('§7 释放：disposer 调用后 handlers 归零（每个 effect 一个路由）', () => {
  const fake = fakeWebServer()
  const disposers = []
  const ctx = makeCtx(services({ webServer: fake.server }), {
    effect(fn) {
      const disposer = fn()
      disposers.push(disposer)
      return disposer
    },
  })

  registerRoutes(ctx)
  assert.equal(fake.routes.size, 5, '前置条件：注册了 5 个路由')

  for (const dispose of disposers) dispose()

  assert.equal(fake.routes.size, 0, '全部 disposer 调用后 handlers 应归零')
  assert.deepEqual(fake.disposed.sort(), Object.values(ROUTE_PATHS).sort(), '每个路由的 disposer 都应被调用')
})

test('§7 注册：apply(ctx) 走的是同一条注册路径（5 个路由）', () => {
  const fake = fakeWebServer()
  const ctx = makeCtx(services({ webServer: fake.server }))
  apply(ctx)
  assert.equal(fake.routes.size, 5, 'apply 应注册全部 5 个路由')
})

test('§7 注册：registerRoutes 在 webServer.register 抛错时不吞掉（由 apply 兜住）', () => {
  const ctx = makeCtx(
    services({
      webServer: {
        register() {
          throw new Error('同名路由已被占用')
        },
      },
    }),
  )
  assert.throws(() => registerRoutes(ctx), /同名路由已被占用/, 'registerRoutes 本身如实上抛')
  assert.doesNotThrow(() => apply(ctx), 'apply 必须把注册失败收敛成 warn，不能让插件行加载失败')
})

/* ------------------------------------------------------------------ *
 * §8 路由行为（真实 HTTP 端到端；含 D-7 传参形态）
 * ------------------------------------------------------------------ */

test('§8 宿主契约 D-7：sessionPersistence.list 收到 { signal } 对象，controller.list 收到第二位置参数', async () => {
  const seenPersistence = []
  const seenController = []
  const controller = new AbortController()
  const ctx = makeCtx(
    services({
      sessionController: {
        list: async (...args) => {
          seenController.push(args)
          return { items: [] }
        },
      },
      sessionPersistence: {
        list: async (options) => {
          seenPersistence.push(options)
          return []
        },
      },
    }),
  )

  await buildSessionRows(ctx, controller.signal)

  assert.equal(seenPersistence.length, 1, 'sessionPersistence.list 应被调用一次')
  const options = seenPersistence[0]
  assert.equal(typeof options, 'object', 'D-7：必须传对象，不能传裸 AbortSignal（宿主读的是 options?.signal）')
  assert.notEqual(options, controller.signal, 'D-7：裸 AbortSignal 会让取消信号在宿主入口丢失')
  assert.equal(options.signal, controller.signal, 'D-7：signal 应挂在 options.signal 上')
  assert.equal(options.signal instanceof AbortSignal, true, 'options.signal 应是 AbortSignal 实例')

  assert.equal(seenController.length, 1, 'sessionController.list 应被调用一次')
  assert.equal(seenController[0].length, 2, '宿主 sessionController.list 是 (request, signal) 两参')
  assert.equal(seenController[0][1], controller.signal, 'D-7：signal 应是**第二位置参数**而不是对象')
})

test('§8 HTTP：/tree 无请求体 / 空体 / 坏 JSON 都不悬挂，且永远回 JSON', async () => {
  const server = await startRouteServer({})
  try {
    for (const [label, raw] of [
      ['无请求体', undefined],
      ['空字符串体', ''],
      ['坏 JSON', '{not json'],
      ['数组 JSON', '[1,2,3]'],
      ['null JSON', 'null'],
      ['合法空对象', '{}'],
    ]) {
      const res = await server.postRaw(ROUTE_PATHS.tree, raw)
      assert.equal(res.status, 200, `/tree（${label}）应返回 200 而不是悬挂/500`)
      assert.equal(res.body.ok, true, `/tree（${label}）应返回 ok:true`)
      assert.equal(
        String(res.contentType).startsWith('application/json'),
        true,
        `/tree（${label}）应回 JSON（客户端要能解析）`,
      )
    }
  } finally {
    await server.close()
  }
})

test('§8 HTTP：五个路由的入参缺失都回 400 JSON + 可读原因（绝不回宿主空体）', async () => {
  const fixture = await makeGitFixture('wtg-http-invalid')
  const { root, repo } = fixture
  const server = await startRouteServer({
    workspaceRegistry: fakeRegistry([mainWorkspace(repo, 'ws')]),
  })
  try {
    const cases = [
      [ROUTE_PATHS.worktreeCreate, {}, '缺少 repoPath'],
      [ROUTE_PATHS.worktreeCreate, { repoPath: repo }, '缺少 branch'],
      [ROUTE_PATHS.worktreeRemove, {}, '缺少 path'],
      [ROUTE_PATHS.reveal, {}, '缺少 path'],
      [ROUTE_PATHS.workspaceOpen, {}, '缺少 path'],
    ]
    for (const [path, body, expected] of cases) {
      const res = await server.post(path, body)
      assert.equal(res.status, 400, `${path} ${JSON.stringify(body)} 应回 400`)
      assert.equal(res.body.ok, false, `${path} 失败时 ok 应为 false`)
      assert.ok(
        String(res.body.message).includes(expected),
        `${path} 的失败原因应包含「${expected}」，实际：${JSON.stringify(res.body.message)}`,
      )
    }
  } finally {
    await server.close()
  }
})

test('§8 HTTP：workspace-open 成功回 workspaceId，注册失败回 400 JSON', async () => {
  const fixture = await makeGitFixture('wtg-http-open')
  const { root, repo } = fixture

  let createCalls = 0
  const server = await startRouteServer({
    workspaceRegistry: {
      list: () => [],
      create: async (path) => {
        createCalls += 1
        if (createCalls === 1) return { id: 'ws-opened', path }
        return undefined // 第二次：注册未返回实体
      },
      delete: async () => true,
    },
  })
  try {
    const ok = await server.post(ROUTE_PATHS.workspaceOpen, { path: repo })
    assert.equal(ok.status, 200, `workspace-open 成功应回 200：${JSON.stringify(ok.body)}`)
    assert.deepEqual(ok.body, { ok: true, workspaceId: 'ws-opened' }, '应回注册到的 workspaceId')

    const missingId = await server.post(ROUTE_PATHS.workspaceOpen, { path: repo })
    assert.equal(missingId.status, 400, '注册未返回 id 时应回 400 而不是假装成功')
    assert.equal(missingId.body.ok, false, '失败时 ok 应为 false')
  } finally {
    await server.close()
  }
})

test('§8 HTTP：workspaceRegistry 缺席 ⇒ workspace-open 明确回 400（不是静默成功）', async () => {
  const root = await makeRoot('wtg-http-no-registry')
  const server = await startRouteServer({})
  try {
    const res = await server.post(ROUTE_PATHS.workspaceOpen, { path: '/tmp/whatever' })
    assert.equal(res.status, 400, '注册表缺席时应明确报错')
    assert.ok(
      String(res.body.message).includes('workspaceRegistry'),
      `错误信息应指出缺的是 workspaceRegistry，实际：${JSON.stringify(res.body.message)}`,
    )
  } finally {
    await server.close()
  }
})

test('§8 HTTP：/tree 端到端载荷形状（projects / ungrouped / workspaceByPath / archivedSessionIds）', async () => {
  const fixture = await makeGitFixture('wtg-http-payload', [
    { name: 'one', dir: 'demo-repo-one', branch: 'feature/one' },
  ])
  const { root, repo, worktreePath } = fixture

  const server = await startRouteServer({
    sessionController: {
      list: async () => ({
        items: [hostSummary('s-one', { cwd: worktreePath.one, updatedAt: 2_000 })],
      }),
    },
    sessionPersistence: {
      list: async () => [persistenceSnapshot('s-one', { createdAt: 1, cwd: worktreePath.one })],
    },
    workspaceRegistry: {
      list: () => [mainWorkspace(repo), { ...mainWorkspace(worktreePath.one, 'ws-one'), title: 'one' }],
      archivedSessionIds: ['s-archived', 42],
    },
  })
  try {
    const res = await server.post(ROUTE_PATHS.tree, {})
    assert.equal(res.status, 200, `/tree 应回 200：${JSON.stringify(res.body)}`)
    const payload = res.body
    assert.equal(payload.ok, true, 'ok 应为 true')
    assert.equal(Array.isArray(payload.projects), true, 'projects 应是数组')
    assert.equal(Array.isArray(payload.ungrouped), true, 'ungrouped 应是数组')
    assert.deepEqual(payload.archivedSessionIds, ['s-archived'], 'archivedSessionIds 应过滤掉非字符串')

    const project = payload.projects.find((item) => item.isGit === true)
    assert.ok(project !== undefined, '应有一个 git 项目节点')
    assert.equal(project.key.endsWith('/.git'), true, `git 项目的 key 应是 commonDir，实际 ${project.key}`)
    const one = project.worktrees.find((node) => node.branch === 'feature/one')
    assert.ok(one !== undefined, '应有一条 feature/one 的 worktree 行')
    assert.equal(one.exists, true, '该 worktree 目录存在')
    assert.equal(one.workspaceId, 'ws-one', '已注册的 worktree 行应带 workspaceId')
    assert.deepEqual(one.sessions.map((row) => row.sessionId), ['s-one'], '会话应归入该 worktree')
    assert.equal(one.sessions[0].updatedAt, 2_000, 'updatedAt 应取 summary 的值')

    assert.equal(
      payload.workspaceByPath[worktreePath.one],
      'ws-one',
      'workspaceByPath 应把归一化路径映射到 workspaceId',
    )
  } finally {
    await server.close()
  }
})

test('§8 HTTP：未知路由不被本插件接管（命名空间隔离）', async () => {
  const root = await makeRoot('wtg-http-unknown')
  const server = await startRouteServer({})
  try {
    const res = await server.post('/dsh-worktree-groups/nope', {})
    assert.equal(res.status, 404, '未注册的路径不应被本插件接管')
  } finally {
    await server.close()
  }
})

/* ------------------------------------------------------------------ *
 * 工具：真实 HTTP 服务器 / 假打开器 / 假注册表
 * ------------------------------------------------------------------ */

/**
 * 起一个**真实** HTTP 服务器，把 `registerRoutes` 注册的 handler 挂上去。
 *
 * 为什么不用 handler 替身：本文件的重点之一是「HTTP 面到底给出什么」，只有真实
 * `http` 请求/响应才能证明 `readBody` / `json` / `res.headersSent` 那套收敛逻辑是对的。
 */
async function startRouteServer(serviceMap) {
  const handlers = new Map()
  const disposers = []
  const map = {
    ...serviceMap,
    webServer: {
      register(route) {
        handlers.set(route.path, route.handler)
        return () => handlers.delete(route.path)
      },
    },
  }
  const ctx = makeCtx(services(map), {
    effect(fn) {
      const disposer = fn()
      disposers.push(disposer)
      return disposer
    },
  })
  registerRoutes(ctx)

  const server = createServer((req, res) => {
    const handler = handlers.get(req.url)
    if (handler === undefined) {
      res.writeHead(404)
      res.end('')
      return
    }
    Promise.resolve(handler(req, res)).catch((error) => {
      if (!res.headersSent) {
        res.writeHead(500)
        res.end(String(error))
      }
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port

  const postRaw = async (path, raw) => {
    const init = { method: 'POST' }
    if (raw !== undefined) {
      init.body = raw
      init.headers = { 'content-type': 'application/json' }
    }
    const res = await fetch(`http://127.0.0.1:${port}${path}`, init)
    const text = await res.text()
    let body
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
    return { status: res.status, body, contentType: res.headers.get('content-type') }
  }

  return {
    port,
    postRaw,
    post: (path, body) => postRaw(path, JSON.stringify(body ?? {})),
    async close() {
      for (const dispose of disposers) dispose()
      await new Promise((resolve) => server.close(resolve))
    },
    handlerCount: () => handlers.size,
  }
}

/**
 * 装一套**假打开器**：把 `PATH` 换成只有假 `open` / `explorer` / `xdg-open` 的目录。
 *
 * 这样做的两个目的：
 *  1. **绝不弹窗、绝不打开 Finder**（PATH 上没有真实打开器）；
 *  2. 通过日志证明 `revealPath` **确实**被走到（而不是只通过了校验）。
 *
 * 注意：`PATH` 被整体替换后，`git` 只能靠 `git.ts` 的绝对路径候选回退，因此本函数
 * 必须在 fixture 已经跑过 git 之后调用（fixture 已缓存探测结果），且用完立即 restore。
 */
async function installFakeOpeners(root, { script } = {}) {
  const binDir = join(root, 'fake-opener-bin')
  await mkdir(binDir, { recursive: true })
  const log = join(root, 'opener-calls.log')
  const body = script ?? `#!/bin/sh\nprintf '%s\\n' "$@" >> ${JSON.stringify(log)}\n`
  for (const name of ['open', 'explorer', 'xdg-open']) {
    const file = join(binDir, name)
    await writeFile(file, body, 'utf8')
    await chmod(file, 0o755)
  }
  const savedPath = process.env.PATH
  // **前置**而不是整体替换：假打开器必须赢过真实打开器（保证不弹窗），
  // 但 git 仍必须可用 —— `handleReveal` 内部要跑一次 `scanRepo` 才能算出白名单。
  const delimiter = process.platform === 'win32' ? ';' : ':'
  process.env.PATH = savedPath === undefined ? binDir : `${binDir}${delimiter}${savedPath}`
  return {
    binDir,
    log,
    calls() {
      if (!existsSync(log)) return []
      return readFileSync(log, 'utf8').split('\n').filter((line) => line !== '')
    },
    restore() {
      if (savedPath === undefined) delete process.env.PATH
      else process.env.PATH = savedPath
    },
  }
}

/** 造一个 `WorkspaceRow` 形状的已注册工作区（主仓）。 */
function mainWorkspace(path, id = 'ws-main') {
  return { id, path, title: 'main', createdAt: '', updatedAt: '' }
}

/** 造一个记录调用的假 `workspaceRegistry`。 */
function fakeRegistry(initial, { onDelete } = {}) {
  const rows = [...initial]
  const created = []
  return {
    created,
    list: () => rows,
    create: async (path) => {
      created.push(path)
      const entity = { id: `ws-created-${created.length}`, path, title: '', createdAt: '', updatedAt: '' }
      rows.push(entity)
      return entity
    },
    delete: async (id) => {
      onDelete?.(id)
      return true
    },
  }
}

/** 确认夹具辅助函数确实被用到（避免 lint 视角的死代码，也顺手断言 fs/promises 的 stat 可用）。 */
test('夹具自检：临时目录、stat、execFile 替身都可用', async () => {
  const root = await makeRoot('wtg-selftest')
  const info = await stat(root)
  assert.equal(info.isDirectory(), true, 'makeRoot 应造出目录')
  assert.ok(root.startsWith(await realpath(tmpdir())), '临时根必须位于 realpath(tmpdir()) 之下')
  const out = await pexec('git', ['--version'])
  assert.ok(out.stdout.startsWith('git version'), 'fixture 依赖可执行的 git')
})

/* ------------------------------------------------------------------ *
 * §10 归档工作空间与恢复（2026-10-21 WSR1/WSR2，AC7）
 * ------------------------------------------------------------------ */

test('§10 WSR1/WSR2：归档 git 与非 git 工作空间 ⇒ 从 projects 隐藏、会话不掉入 ungrouped，并进入 archivedProjects；放出后完整恢复', async () => {
  const fixture = await makeGitFixture('wtg-archive-ws')
  const { root, repo } = fixture
  const nonGitDir = join(root, 'plain-docs')
  await mkdir(nonGitDir, { recursive: true })

  const registry = fakeRegistry([
    { id: 'ws-git', path: repo, title: 'MyGitRepo', createdAt: '', updatedAt: '' },
    { id: 'ws-plain', path: nonGitDir, title: 'PlainDocs', createdAt: '', updatedAt: '' },
  ])
  const persistence = {
    list: async () => [
      { header: { id: 'session-git-1', createdAt: 100, cwd: repo } },
      { header: { id: 'session-plain-1', createdAt: 200, cwd: nonGitDir } },
      { header: { id: 'session-ungrouped-1', createdAt: 300, cwd: join(root, 'stray') } },
    ],
  }
  const ctx = makeCtx(services({ workspaceRegistry: registry, sessionPersistence: persistence }))
  const ledger = ledgerAt(root)

  clearScanCache()
  const before = await buildTreePayload(ctx, { ledger, now: 1000 })
  assert.equal(before.projects.length, 2, '归档前应有 2 个工作空间')
  assert.deepEqual(before.archivedProjects, [], '归档前 archivedProjects 为空')
  assert.deepEqual(
    before.ungrouped.map((s) => s.sessionId),
    ['session-ungrouped-1'],
    '归档前只有 stray 会话在 ungrouped',
  )

  const gitProjectKey = before.projects.find((p) => p.isGit).key
  const plainProjectKey = before.projects.find((p) => !p.isGit).key

  // 1) 归档 git 工作空间
  await archiveWorkspaceProject(ctx, gitProjectKey, { ledger, now: 2000 })
  const afterArchiveGit = await buildTreePayload(ctx, { ledger, now: 2001 })
  assert.deepEqual(
    afterArchiveGit.projects.map((p) => p.key),
    [plainProjectKey],
    'git 工作空间归档后从 projects 中隐藏',
  )
  assert.deepEqual(
    afterArchiveGit.ungrouped.map((s) => s.sessionId),
    ['session-ungrouped-1'],
    '★ 已归档工作空间的会话一并隐藏，不得掉进 ungrouped（未分组）',
  )
  assert.equal(afterArchiveGit.archivedProjects.length, 1)
  assert.equal(afterArchiveGit.archivedProjects[0].key, gitProjectKey)
  assert.equal(afterArchiveGit.archivedProjects[0].title, 'MyGitRepo')
  assert.equal(afterArchiveGit.archivedProjects[0].isGit, true)

  // 2) 从设置页按 projectKey 放出
  await unarchiveWorkspaceProject(ctx, { projectKey: gitProjectKey }, { ledger, now: 3000 })
  const afterRestore = await buildTreePayload(ctx, { ledger, now: 3001 })
  assert.equal(afterRestore.projects.length, 2, '放出后两个工作空间全部恢复')
  assert.deepEqual(afterRestore.archivedProjects, [], '放出后 archivedProjects 清空')
  const restoredGit = afterRestore.projects.find((p) => p.key === gitProjectKey)
  assert.deepEqual(
    restoredGit.worktrees[0].sessions.map((s) => s.sessionId),
    ['session-git-1'],
    '放出后原会话完整恢复在该工作空间下',
  )
})

test('§10 WSR2：重新添加相同目录作为工作空间 ⇒ 自动从已归档中放出来（路径匹配 & registry.create 钩子）', async () => {
  const fixture = await makeGitFixture('wtg-readd-unarchive', [
    { name: 'wt', dir: 'demo-repo-wt', branch: 'feat-wt' },
  ])
  const { root, repo, worktreePath } = fixture
  const nonGitDir = join(root, 'plain-notes')
  await mkdir(nonGitDir, { recursive: true })

  const registry = fakeRegistry([
    { id: 'ws-git', path: repo, title: 'MyGitRepo', createdAt: '', updatedAt: '' },
    { id: 'ws-plain', path: nonGitDir, title: 'PlainNotes', createdAt: '', updatedAt: '' },
  ])
  const ctx = makeCtx(services({ workspaceRegistry: registry }))
  const ledger = ledgerAt(root)

  clearScanCache()
  const initial = await buildTreePayload(ctx, { ledger, now: 1000 })
  const gitKey = initial.projects.find((p) => p.isGit).key
  const plainKey = initial.projects.find((p) => !p.isGit).key

  // 将两个工作空间都归档
  await archiveWorkspaceProject(ctx, gitKey, { ledger, now: 2000 })
  await archiveWorkspaceProject(ctx, plainKey, { ledger, now: 2001 })
  const bothArchived = await buildTreePayload(ctx, { ledger, now: 2002 })
  assert.equal(bothArchived.projects.length, 0)
  assert.equal(bothArchived.archivedProjects.length, 2)

  // 场景 A：按相同目录路径（或同 git 仓的 worktree 路径）触发 unarchiveWorkspaceProject
  const resGit = await unarchiveWorkspaceProject(
    ctx,
    { path: worktreePath.wt },
    { ledger, now: 3000 },
  )
  assert.deepEqual(resGit.unarchivedKeys, [gitKey], '添加同 git 仓的 worktree 目录也能自动识别并放出该 git 工作空间')

  // 场景 B：按非 git 工作空间相同目录路径触发放出
  const resPlain = await unarchiveWorkspaceProject(
    ctx,
    { path: nonGitDir },
    { ledger, now: 3001 },
  )
  assert.deepEqual(resPlain.unarchivedKeys, [plainKey], '重新添加相同非 git 目录自动放出该工作空间')

  const finalPayload = await buildTreePayload(ctx, { ledger, now: 3002 })
  assert.equal(finalPayload.projects.length, 2, '两个工作空间均已自动放出')
  assert.deepEqual(finalPayload.archivedProjects, [])
})

/* ------------------------------------------------------------------ *
 * §11 远程控制模式（2026-11-22，dsh remote 控制远端机器 B）
 * ------------------------------------------------------------------ */

test('§11 AC1（Tier 1 远端插件直连）：remote 控制机器 B 且机器 B 已加载本插件 ⇒ /tree 与工作区/worktree 操作全部转发至机器 B，切回 local 立即恢复且 ETag 不串台', async () => {
  const fixtureA = await makeGitFixture('wtg-remote-tier1-a')
  const fixtureB = await makeGitFixture('wtg-remote-tier1-b', [
    { name: 'wtB', dir: 'demo-repo-wt-b', branch: 'feat-b' },
  ])

  // 机器 B：有自己的 workspaceRegistry、sessionPersistence 与 dshRemote (HostPluginRuntime)
  const registryB = fakeRegistry([
    { id: 'ws-b-main', path: fixtureB.repo, title: 'RepoB', createdAt: '', updatedAt: '' },
  ])
  const persistenceB = {
    list: async () => [
      { header: { id: 'sess-b-main', createdAt: 1000, cwd: fixtureB.repo } },
      { header: { id: 'sess-b-wt', createdAt: 2000, cwd: fixtureB.worktreePath.wtB } },
    ],
  }
  const baseRouterB = {
    pluginRoute: {
      call: async () => {
        const err = new Error('The plugin route call is invalid for the remote channel.')
        err.code = 'INVALID_MESSAGE'
        throw err
      },
    },
    handle: async (msg) => ({
      id: msg.id,
      type: 'rpc.response',
      payload: { requestId: msg.id, result: await baseRouterB.pluginRoute.call(msg.payload?.params) },
    }),
  }
  const dshRemoteB = {
    ledger: ledgerAt(fixtureB.root),
    connections: {
      active: new Map([['conn-1', { channel: {}, router: baseRouterB, unsubscribe: () => undefined }]]),
      createRouter: () => baseRouterB,
    },
  }
  const webServerB = {
    register: () => () => undefined,
  }
  const ctxB = makeCtx(
    services({
      webServer: webServerB,
      workspaceRegistry: registryB,
      sessionPersistence: persistenceB,
      dshRemote: dshRemoteB,
    }),
  )
  registerRoutes(ctxB)

  // 机器 A：有本地工作区 repoA，同时通过 dshRemoteClient 控制机器 B
  const registryA = fakeRegistry([
    { id: 'ws-a-main', path: fixtureA.repo, title: 'RepoA', createdAt: '', updatedAt: '' },
  ])
  const persistenceA = {
    list: async () => [{ header: { id: 'sess-a-main', createdAt: 500, cwd: fixtureA.repo } }],
  }
  let mode = 'remote'
  const remoteClientA = {
    status: () =>
      mode === 'remote'
        ? { mode: 'remote', connected: true, backend: 'harness', target: { deviceId: 'device-b', name: 'Machine B' } }
        : { mode: 'local', connected: false, backend: 'harness' },
    activeRemote: () =>
      mode === 'remote'
        ? {
            target: { deviceId: 'device-b', name: 'Machine B' },
            features: { pluginRoute: true },
            client: {
              rpc: async (method, params) => {
                assert.equal(method, 'plugin.route.call')
                return await baseRouterB.pluginRoute.call(params)
              },
            },
          }
        : undefined,
    pluginRoute: async (route, body) => await baseRouterB.pluginRoute.call({ route, body }),
  }

  const serverA = await startRouteServer({
    workspaceRegistry: registryA,
    sessionPersistence: persistenceA,
    dshRemoteClient: remoteClientA,
  })

  clearScanCache()
  try {
    // 1) remote 模式下 /tree 返回机器 B 的项目与两个 worktree（主树 + wtB），绝不返回机器 A 的 repoA
    const remoteHttpRes = await fetch(`http://127.0.0.1:${serverA.port}${ROUTE_PATHS.tree}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    assert.equal(remoteHttpRes.status, 200)
    const remoteEtag = remoteHttpRes.headers.get('etag')
    assert.ok(typeof remoteEtag === 'string' && remoteEtag.length > 0)
    const remoteTree = await remoteHttpRes.json()
    assert.equal(remoteTree.ok, true)
    assert.equal(remoteTree.projects.length, 1, '应只展示机器 B 的 1 个 git 项目')
    const projB = remoteTree.projects[0]
    assert.equal(projB.isGit, true)
    assert.equal(projB.mainPath, fixtureB.repo)
    assert.deepEqual(
      projB.worktrees.map((w) => ({ path: w.path, branch: w.branch, isMain: w.isMain })),
      [
        { path: fixtureB.repo, branch: 'main', isMain: true },
        { path: fixtureB.worktreePath.wtB, branch: 'feat-b', isMain: false },
      ],
      '★ 必须以 worktree 树展示机器 B 的主仓与关联 worktree',
    )
    assert.deepEqual(
      projB.worktrees[0].sessions.map((s) => s.sessionId),
      ['sess-b-main'],
    )
    assert.deepEqual(
      projB.worktrees[1].sessions.map((s) => s.sessionId),
      ['sess-b-wt'],
    )

    // 2) remote 模式下 workspace-open 在机器 B 上注册工作区，不碰机器 A 的 registryA
    const openRes = await serverA.post(ROUTE_PATHS.workspaceOpen, { path: fixtureB.worktreePath.wtB })
    assert.equal(openRes.status, 200)
    assert.equal(openRes.body.ok, true)
    assert.equal(registryA.created.length, 0, '不得在机器 A 本地创建工作区')
    assert.deepEqual(registryB.created, [fixtureB.worktreePath.wtB], '必须在机器 B 上创建工作区')

    // 3) 切回 local 模式：即使携带刚才的 remoteEtag，也绝不能误回 304，必须返回机器 A 的本地树
    mode = 'local'
    const localHttpRes = await fetch(`http://127.0.0.1:${serverA.port}${ROUTE_PATHS.tree}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'if-none-match': remoteEtag },
      body: '{}',
    })
    assert.equal(localHttpRes.status, 200, '★ 从 remote 切回 local 时不得误命中 304')
    const localBody = await localHttpRes.json()
    assert.equal(localBody.ok, true)
    const projA = localBody.projects.find((p) => p.mainPath === fixtureA.repo)
    assert.ok(projA !== undefined, '切回 local 后应展示机器 A 的项目')
    assert.equal(
      localBody.projects.some((p) => p.mainPath === fixtureB.repo),
      false,
      '切回 local 后不得残留机器 B 的项目',
    )
  } finally {
    await serverA.close()
  }
})

test('§11 AC2/AC3（Tier 2 远端网关回退 + 状态隔离）：机器 B 未升级 Tier 1 钩子时，经远端 typertGateway 还原机器 B 的 git worktree 树，且不污染机器 A 台账、不触发机器 A 的 D18 清扫', async () => {
  const fixtureA = await makeGitFixture('wtg-remote-tier2-a')
  const fixtureB = await makeGitFixture('wtg-remote-tier2-b', [
    { name: 'wtB', dir: 'demo-repo-wt-b2', branch: 'feat-b2' },
  ])
  const { readdir: fsReaddir, readFile: fsReadFile, stat: fsStat } = await import('node:fs/promises')

  // 机器 A 本地有一个指向已消失路径的死工作区：验证 remote 模式下不会误删机器 A 的本地工作区
  const deletedLocalA = []
  const deadPathA = join(fixtureA.root, 'dead-local-worktree')
  const registryA = fakeRegistry(
    [
      { id: 'ws-a-live', path: fixtureA.repo, title: 'RepoA', createdAt: '', updatedAt: '' },
      { id: 'ws-a-dead', path: deadPathA, title: 'DeadA', createdAt: '', updatedAt: '' },
    ],
    (id) => deletedLocalA.push(id),
  )
  const persistenceA = {
    list: async () => [{ header: { id: 'sess-a-1', createdAt: 100, cwd: fixtureA.repo } }],
  }

  // 机器 B 的远端网关模拟（仅暴露 ds-harness-remote 标准允许的 workspace/follow、session/list、directoryPicker/list、workspaceFiles/read、workspace/create）
  const remoteWorkspacesB = [
    {
      workspaceId: 'ws-b-main',
      path: fixtureB.repo,
      title: 'RemoteRepoB',
      createdAt: '2026-11-22T00:00:00Z',
      updatedAt: '2026-11-22T00:00:00Z',
    },
  ]
  const remoteSessionsB = [
    {
      sessionId: 'sess-b-main',
      cwd: fixtureB.repo,
      updatedAt: 5000,
      running: false,
      blank: false,
      title: 'Main session on B',
    },
    {
      sessionId: 'sess-b-wt',
      cwd: fixtureB.worktreePath.wtB,
      updatedAt: 6000,
      running: true,
      blank: false,
      title: 'Worktree session on B',
    },
  ]
  const remoteCreatedB = []

  const handleGatewayCall = async (endpoint, args) => {
    if (endpoint === 'session/list') {
      return { items: remoteSessionsB }
    }
    if (endpoint === 'directoryPicker/list') {
      const target = args?.path
      const rows = await fsReaddir(target, { withFileTypes: true })
      const entries = []
      for (const row of rows) {
        const child = join(target, row.name)
        const isDir = row.isDirectory() || (row.isSymbolicLink() && (await fsStat(child).then((s) => s.isDirectory()).catch(() => false)))
        if (isDir) entries.push({ name: row.name, path: child, hidden: row.name.startsWith('.') })
      }
      return { path: target, home: fixtureB.root, crumbs: [], entries, truncated: false }
    }
    if (endpoint === 'workspaceFiles/read' || endpoint === 'workspaceFiles/readAll') {
      const scopeId = args?.workspaceFileScopeId
      const sess = remoteSessionsB.find((s) => s.sessionId === scopeId)
      if (!sess) throw new Error('session not found')
      const filePath = join(sess.cwd, args.path)
      const info = await fsStat(filePath)
      if (!info.isFile()) throw new Error('not a regular file')
      const text = await fsReadFile(filePath, 'utf8')
      return { absolutePath: filePath, version: '1', offset: 1, text, lines: text.split('\n').length, eof: true }
    }
    if (endpoint === 'workspace/create') {
      const p = args?.request?.path ?? args?.path
      remoteCreatedB.push(p)
      const created = {
        workspaceId: `ws-b-new-${remoteCreatedB.length}`,
        path: p,
        title: 'NewRemoteWS',
        createdAt: '',
        updatedAt: '',
      }
      remoteWorkspacesB.push(created)
      return { workspace: created }
    }
    throw new Error(`unexpected endpoint: ${endpoint}`)
  }

  const typertGatewayA = {
    invoke: async (req) => await handleGatewayCall(`${req.namespace}/${req.method}`, req.args),
    stream: async (req) => {
      assert.equal(`${req.namespace}/${req.method}`, 'workspace/follow')
      return (async function* () {
        yield {
          type: 'baseline',
          value: {
            items: remoteWorkspacesB,
            archivedSessionIds: [],
            pinnedSessionIds: [],
          },
        }
      })()
    },
  }

  const remoteClientA = {
    status: () => ({
      mode: 'remote',
      connected: true,
      backend: 'harness',
      target: { deviceId: 'device-b-unupgraded', name: 'Machine B (Old Plugin)' },
    }),
    activeRemote: () => ({
      target: { deviceId: 'device-b-unupgraded', name: 'Machine B (Old Plugin)' },
      features: { pluginRoute: true },
      client: {
        rpc: async (method) => {
          if (method === 'plugin.route.call') {
            const err = new Error('The plugin route call is invalid for the remote channel.')
            err.code = 'INVALID_MESSAGE'
            throw err
          }
          throw new Error(`unexpected rpc: ${method}`)
        },
      },
    }),
    pluginRoute: async () => {
      const err = new Error('The plugin route call is invalid for the remote channel.')
      err.code = 'INVALID_MESSAGE'
      throw err
    },
  }

  const ledgerA = ledgerAt(fixtureA.root)
  const ctxA = makeCtx(
    services({
      workspaceRegistry: registryA,
      sessionPersistence: persistenceA,
      typertGateway: typertGatewayA,
      dshRemoteClient: remoteClientA,
    }),
  )

  clearScanCache()
  const payload = await buildTreePayload(ctxA, { ledger: ledgerA, now: 10_000 })
  assert.equal(payload.ok, true)
  assert.equal(payload.projects.length, 1, 'Tier 2 回退应展示机器 B 的 1 个 git 项目')
  const projB = payload.projects[0]
  assert.equal(projB.isGit, true, '应识别出机器 B 的工作区为 git 仓')
  assert.equal(projB.mainPath, fixtureB.repo)
  assert.deepEqual(
    projB.worktrees.map((w) => ({ path: w.path, branch: w.branch, isMain: w.isMain, exists: w.exists })),
    [
      { path: fixtureB.repo, branch: 'main', isMain: true, exists: true },
      { path: fixtureB.worktreePath.wtB, branch: 'feat-b2', isMain: false, exists: true },
    ],
    '★ Tier 2 回退也必须通过远端 .git/worktrees 元数据还原出机器 B 的全部 worktree 及分支名',
  )
  assert.deepEqual(
    projB.worktrees[0].sessions.map((s) => s.sessionId),
    ['sess-b-main'],
  )
  assert.deepEqual(
    projB.worktrees[1].sessions.map((s) => s.sessionId),
    ['sess-b-wt'],
  )

  // 状态隔离校验：机器 A 的本地死工作区未被 D18 误删，机器 A 的本地台账未被机器 B 污染
  assert.deepEqual(deletedLocalA, [], '★ remote 模式下不得清扫删除机器 A 的本地工作区')
  const ledgerDataA = await ledgerA.read()
  assert.deepEqual(Object.keys(ledgerDataA.projects), [], '★ remote 模式下不得向机器 A 本地台账写入机器 B 的项目')
  assert.deepEqual(Object.keys(ledgerDataA.sessions), [], '★ remote 模式下不得向机器 A 本地台账写入机器 B 的会话')

  // Tier 2 下 workspace-open 走远端 workspace/create
  const serverA = await startRouteServer({
    workspaceRegistry: registryA,
    sessionPersistence: persistenceA,
    typertGateway: typertGatewayA,
    dshRemoteClient: remoteClientA,
  })
  try {
    const res = await serverA.post(ROUTE_PATHS.workspaceOpen, { path: fixtureB.worktreePath.wtB })
    assert.equal(res.status, 200)
    assert.equal(res.body.ok, true)
    assert.equal(res.body.workspaceId, 'ws-b-new-1')
    assert.deepEqual(remoteCreatedB, [fixtureB.worktreePath.wtB])
    assert.deepEqual(registryA.created, [])
  } finally {
    await serverA.close()
  }
})

test('§11 AC2-perf：Tier 2 远程回退在大量历史会话与无会话 worktree 下不遍历无关会话 cwd、支持命名启发式归并、带扫描缓存与 Tier 1 负缓存', async (t) => {
  const remoteMainRepo = '/Users/machineB/Documents/Project/AppRepo'
  const remoteLinkedSib = '/Users/machineB/Documents/Project/AppRepo-feat-login'
  const remoteLinkedNested = '/Users/machineB/Documents/Project/worktrees/AppRepo-fix-header'
  const remotePlainWs = '/Users/machineB/Documents/Notes'

  const remoteWorkspacesB = [
    { workspaceId: 'ws-b-1', path: remoteMainRepo, title: 'AppRepo', createdAt: '', updatedAt: '' },
    { workspaceId: 'ws-b-2', path: remoteLinkedSib, title: 'AppRepo-feat-login', createdAt: '', updatedAt: '' },
    { workspaceId: 'ws-b-3', path: remoteLinkedNested, title: 'AppRepo-fix-header', createdAt: '', updatedAt: '' },
    { workspaceId: 'ws-b-4', path: remotePlainWs, title: 'Notes', createdAt: '', updatedAt: '' },
  ]

  // 构造 200 个散落在不相关历史目录的会话（且主仓与关联 worktree 没有任何会话可用于 workspaceFiles/read）
  const remoteSessionsB = Array.from({ length: 200 }, (_, i) => ({
    id: `sess-unrelated-${i}`,
    title: `Old Session ${i}`,
    cwd: `/Users/machineB/Old Scratch/dir-${i}`,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:01:00.000Z',
    running: false,
  }))

  const dirPickerCalls = []
  let tier1PluginRouteCalls = 0

  const typertGatewayA = {
    invoke: async (req) => {
      const endpoint = `${req.namespace}/${req.method}`
      if (endpoint === 'session/list') {
        return { items: remoteSessionsB }
      }
      if (endpoint === 'directoryPicker/list') {
        const dirPath = req.args?.path
        dirPickerCalls.push(dirPath)
        if (dirPath === remoteMainRepo) {
          return {
            path: dirPath,
            entries: [
              { name: '.git', path: `${remoteMainRepo}/.git` },
              { name: 'src', path: `${remoteMainRepo}/src` },
            ],
          }
        }
        if (dirPath === `${remoteMainRepo}/.git/worktrees`) {
          return {
            path: dirPath,
            entries: [
              { name: 'AppRepo-feat-login', path: `${remoteMainRepo}/.git/worktrees/AppRepo-feat-login` },
              { name: 'AppRepo-fix-header', path: `${remoteMainRepo}/.git/worktrees/AppRepo-fix-header` },
            ],
          }
        }
        if (dirPath === remoteLinkedSib || dirPath === remoteLinkedNested || dirPath === remotePlainWs) {
          return {
            path: dirPath,
            entries: [{ name: 'README.md', path: `${dirPath}/README.md` }],
          }
        }
        throw new Error(`directory not found: ${dirPath}`)
      }
      if (endpoint === 'workspaceFiles/read') {
        throw new Error('no session available in repo for workspaceFiles/read')
      }
      throw new Error(`unexpected endpoint: ${endpoint}`)
    },
    stream: async () =>
      (async function* () {
        yield {
          type: 'baseline',
          value: {
            items: remoteWorkspacesB,
            archivedSessionIds: [],
          },
        }
      })(),
  }

  const remoteClientA = {
    status: () => ({
      mode: 'remote',
      connected: true,
      backend: 'harness',
      target: { deviceId: 'device-b-many-sessions', name: 'Machine B' },
    }),
    pluginRoute: async () => {
      tier1PluginRouteCalls += 1
      const err = new Error('The plugin route call is invalid for the remote channel.')
      err.code = 'INVALID_MESSAGE'
      throw err
    },
  }

  const ctxA = makeCtx(
    services({
      workspaceRegistry: fakeRegistry([]),
      sessionPersistence: { list: async () => [] },
      typertGateway: typertGatewayA,
      dshRemoteClient: remoteClientA,
    }),
  )

  clearScanCache()
  const payload1 = await buildTreePayload(ctxA, { now: 20_000 })
  assert.equal(payload1.ok, true)

  // 1) 绝不遍历 200 个无关历史会话的 cwd
  const unrelatedProbes = dirPickerCalls.filter((p) => String(p).includes('Old Scratch'))
  assert.deepEqual(unrelatedProbes, [], '★ Tier 2 不得对无关历史会话的 cwd 逐个调用 directoryPicker/list')
  assert.equal(
    dirPickerCalls.length <= 12,
    true,
    `★ Tier 2 首次探测目录 RPC 次数必须受控（实际 ${dirPickerCalls.length} 次）`,
  )

  // 2) 即使没有任何会话可供 workspaceFiles/read，也能通过 .git/worktrees/<name> + 命名启发式把关联 worktree 归并到主树下
  assert.equal(payload1.projects.length, 2, '应合并为 1 个 git 项目（含 3 个 worktree）+ 1 个普通工作区 Notes')
  const gitProj = payload1.projects.find((p) => p.mainPath === remoteMainRepo)
  assert.ok(gitProj, '应识别出 AppRepo 主工作树项目')
  assert.equal(gitProj.isGit, true)
  assert.deepEqual(
    gitProj.worktrees.map((w) => ({ path: w.path, branch: w.branch, isMain: w.isMain })),
    [
      { path: remoteMainRepo, branch: undefined, isMain: true },
      { path: remoteLinkedSib, branch: 'feat-login', isMain: false },
      { path: remoteLinkedNested, branch: 'fix-header', isMain: false },
    ],
    '★ 无会话可读 gitdir/HEAD 时，应通过 .git/worktrees 目录名与 <MainRepo>-<branch> 命名启发式归并关联 worktree 并提取分支名',
  )

  // 3) 第二次轮询应命中 Tier 1 负缓存与 Tier 2 仓库扫描缓存（0 次新的 directoryPicker/list 与 pluginRoute 调用）
  const callsAfterFirst = dirPickerCalls.length
  assert.equal(tier1PluginRouteCalls, 1)
  const payload2 = await buildTreePayload(ctxA, { now: 25_000 })
  assert.equal(payload2.ok, true)
  assert.equal(tier1PluginRouteCalls, 1, '★ Tier 1 负缓存期内不应重复发起必败的 plugin.route.call')
  assert.equal(dirPickerCalls.length, callsAfterFirst, '★ Tier 2 扫描缓存命中时不应重复调用远端 directoryPicker/list')
})



