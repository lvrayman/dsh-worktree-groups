/**
 * 台账持久化（T2）。
 *
 * 背景：`SessionHeader` 只带 `cwd`，没有仓库指针。当某个 worktree 目录被 `rm -rf` 之后，
 * 它里面的会话就无从知道原本属于哪个项目。本模块用一个 JSON 台账补上这份信息：
 *
 * - `projects[commonDir].worktrees[worktreePath]` —— 插件**见过的**每个 worktree
 *   （首次见到时间 / 最近见到时间 / 消失时间）；
 * - `sessions[sessionId] = { projectKey, worktreePath }` —— 会话归属快照，
 *   用于目录消失后把会话归位到对应项目的 history 桶。
 *
 * 设计约束（见 `docs/INTERFACES.md` §1.4）：
 * - **原子写**：同目录 `<file>.tmp` → `fsync` → `rename`，权限 `0o600`，失败清理 tmp；
 * - **容错读**：文件不存在 / JSON 损坏 / `version` 不符 ⇒ 备份坏文件并返回空台账，**永不抛错**；
 * - **串行化**：`update()` 走内部 Promise 链，任一时刻只有一次「读-改-写」在飞；
 * - **工厂不碰 IO**：`createFileLedger()` 只在 `read()` / `write()` / `update()` 内做 IO
 *   （宿主启动期会同步调用该工厂）。
 */

import { access, mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** 台账文件版本；不匹配即视为坏文件（备份 + 空台账）。 */
const LEDGER_VERSION = 1

/** 台账文件名（介质：`<homeDir>/worktree-groups.json`）。 */
const LEDGER_FILE_NAME = 'worktree-groups.json'

/**
 * `defaultDshHome` 所在的包名。
 *
 * 该包只在 DSH 宿主进程的 node_modules 里可解析，本包自身 **不可静态 import**
 * （`tsc` 会报 TS2307）。因此这里用**惰性动态 import**（变量说明符，避免 tsc 解析），
 * 解析失败时回退 `$DSH_HOME ?? ~/.dsh`。
 */
const DSH_HOME_PATHS_MODULE = '@deepseek-ai/dsh-home-paths'

/** 一个 worktree 的台账记录。 */
export interface LedgerWorktree {
  /** 最近一次见到的检出分支短名；detached 或未知时 undefined。 */
  branch?: string
  /** 首次见到该 worktree 的时刻（epoch ms）。 */
  firstSeenAt: number
  /** 最近一次被 git 列表看到的时刻（epoch ms）。 */
  lastSeenAt: number
  /** 首次被发现已消失的时刻（epoch ms，>= lastSeenAt）。 */
  goneAt?: number
}

/** 一个项目（git common dir）的台账记录。 */
export interface LedgerProject {
  /** 主工作树路径（便于 commonDir 变化时兜底）。 */
  mainPath: string
  /** worktree 路径（归一化）→ 记录。 */
  worktrees: Record<string, LedgerWorktree>
}

/** 一条会话归属快照。 */
export interface LedgerSessionOwner {
  /** 项目键（commonDir）。 */
  projectKey: string
  /** 会话所属 worktree 路径（归一化）。 */
  worktreePath: string
}

/** 已归档工作空间的台账记录（2026-10-21 WSR1/WSR2）。 */
export interface LedgerArchivedProject {
  title: string
  path?: string
  isGit: boolean
  archivedAt: number
}

/** 台账全量数据（文件顶层结构）。 */
export interface LedgerData {
  version: 1
  projects: Record<string, LedgerProject>
  /** sessionId → 归属快照（用于目录消失后的归位）。 */
  sessions: Record<string, LedgerSessionOwner>
  /** projectKey → 已归档工作空间记录（可选，缺省表示无归档工作空间）。 */
  archivedProjects?: Record<string, LedgerArchivedProject>
}

/** 台账存储：读写 + 串行化的读-改-写。 */
export interface LedgerStore {
  /** 从介质读取一份**全新**的台账数据（文件缺失/损坏时返回空台账，不抛错）。 */
  read(): Promise<LedgerData>
  /** 全量覆盖写盘（原子写：tmp + fsync + rename）。 */
  write(data: LedgerData): Promise<void>
  /**
   * 读-改-写，串行化（内部 Promise 链，任一时刻只有一次在飞）。
   * 回调返回**同一引用**（`=== data`）时跳过写盘（no-op 优化），但仍返回数据。
   *
   * ⚠️ **陷阱**：回调若**原地修改** `data` 并返回**同一引用**，会命中「同引用 ⇒ 跳过写盘」
   * 的 no-op 优化，导致**数据静默丢失**（内存里看着改了，磁盘上没落盘，下次 `read()` 就没了）。
   * 正确用法是构造并返回**新对象**（例如
   * `{ ...current, sessions: { ...current.sessions, [id]: v } }`）。
   * `src/routes.ts` 的 `updateLedger` 正是靠返回新引用（`next`）才落盘。
   */
  update(fn: (data: LedgerData) => LedgerData): Promise<LedgerData>
}

/**
 * 构造一份空台账。
 *
 * 每次调用都返回**新对象**（不共享单例），调用方随意修改不会污染其它调用者。
 */
export function emptyLedger(): LedgerData {
  return { version: LEDGER_VERSION, projects: {}, sessions: {} }
}

/**
 * 解析默认 harness home：优先动态 import `@deepseek-ai/dsh-home-paths` 的 `defaultDshHome()`；
 * 该包不可解析（例如脱离宿主进程跑单测）时回退 `$DSH_HOME`，再回退 `~/.dsh`。
 *
 * 关键约束：**惰性**执行 —— 工厂函数本身不能触发 IO / 模块解析。
 */
async function resolveDefaultHome(): Promise<string> {
  try {
    const specifier: string = DSH_HOME_PATHS_MODULE
    const mod = (await import(specifier)) as unknown as { defaultDshHome?: () => unknown }
    const fn = mod.defaultDshHome
    if (typeof fn === 'function') {
      const resolved = fn()
      if (typeof resolved === 'string' && resolved.length > 0) return resolved
    }
  } catch {
    // 模块不可解析 / 导出形态变化 ⇒ 走下面的环境变量回退，绝不上抛
  }
  const fromEnv = process.env['DSH_HOME']
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) return fromEnv
  return join(homedir(), '.dsh')
}

/** 该值是否为「普通对象」（非 null、非数组）。 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 判断解析出来的 JSON 是否是本版本可用的台账结构。
 * 结构不完整（缺 version / projects / sessions）一律视为损坏 —— 交给调用方备份。
 */
function isLedgerShape(value: unknown): value is LedgerData {
  if (!isPlainObject(value)) return false
  if (value['version'] !== LEDGER_VERSION) return false
  return isPlainObject(value['projects']) && isPlainObject(value['sessions'])
}

/**
 * 创建文件介质台账：`<homeDir>/worktree-groups.json`，临时文件 + rename 原子写。
 *
 * @param homeDir harness home 目录；缺省时**惰性**取 `defaultDshHome()`（不可解析则回退
 *   `$DSH_HOME ?? ~/.dsh`）。显式传入时完全不解析该包。
 *
 * 关键约束：
 * - 本函数**不同步做任何 IO**，也**不 await 任何模块解析**（宿主启动期同步调用它）；
 *   目录创建、文件读写、home 解析全部推迟到 `read()` / `write()` / `update()` 内；
 * - 读失败（文件不存在 / JSON 损坏 / 版本不符 / 任何 fs 错误）一律返回空台账，**绝不抛错**；
 * - `update()` 串行化，且某次回调抛错不会卡死后续调用。
 */
export function createFileLedger(homeDir?: string): LedgerStore {
  const explicitHome = homeDir
  /** 惰性解析并缓存的台账文件绝对路径。 */
  let cachedFile: string | undefined

  async function ledgerFile(): Promise<string> {
    if (cachedFile !== undefined) return cachedFile
    const home = explicitHome !== undefined ? explicitHome : await resolveDefaultHome()
    const file = join(home, LEDGER_FILE_NAME)
    cachedFile = file
    return file
  }

  /**
   * 把坏文件挪到 `<file>.bad-<ts>` 备份。
   * 备份失败（权限等）静默忽略 —— 宁可丢台账也不能崩宿主。
   */
  async function backupCorrupt(file: string): Promise<void> {
    const stamp = Date.now()
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const target = attempt === 0 ? `${file}.bad-${stamp}` : `${file}.bad-${stamp}-${attempt}`
      try {
        await access(target)
        continue // 该备份名已被占用，换一个后缀
      } catch {
        // 名字可用
      }
      try {
        await rename(file, target)
      } catch {
        // 备份失败：坏文件留在原地，下次读取会再试一次
      }
      return
    }
  }

  /**
   * 从磁盘读一份全新台账。所有失败路径都返回 `emptyLedger()`，不抛错。
   */
  /**
   * 内存读缓存（2026-11-14 PERF2）：以文件 `mtimeMs` + `size` 校验，一致则直接返回上次解析结果，
   * 免去每个 `/tree` 请求两次读盘 + `JSON.parse`（实测 352 KB）。外部改写会改变 mtime ⇒ 自动失效。
   * ⚠️ 缓存对象只在内部共享给 `update` 回调（它一律构造新对象、不原地修改）；公开 `read()` 返回副本。
   */
  let cached: { mtimeMs: number; size: number; data: LedgerData } | undefined

  async function fileIdentity(file: string): Promise<{ mtimeMs: number; size: number } | undefined> {
    try {
      const info = await stat(file)
      return { mtimeMs: info.mtimeMs, size: info.size }
    } catch {
      return undefined
    }
  }

  async function readFromDisk(): Promise<LedgerData> {
    let file: string
    try {
      file = await ledgerFile()
    } catch {
      return emptyLedger()
    }

    const identity = await fileIdentity(file)
    if (identity === undefined) {
      cached = undefined
      return emptyLedger()
    }
    if (cached !== undefined && cached.mtimeMs === identity.mtimeMs && cached.size === identity.size) {
      return cached.data
    }
    cached = undefined

    let raw: string
    try {
      raw = await readFile(file, 'utf8')
    } catch {
      // ENOENT（首次使用）以及任何其它 fs 错误：空台账即合法状态
      return emptyLedger()
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw) as unknown
    } catch {
      // 半截 / 损坏文件：备份后按空台账处理
      await backupCorrupt(file)
      return emptyLedger()
    }

    if (!isLedgerShape(parsed)) {
      // 缺 version / 版本不符 / 结构不完整：备份后按空台账处理
      await backupCorrupt(file)
      return emptyLedger()
    }

    const result = emptyLedger()
    result.projects = parsed.projects
    result.sessions = parsed.sessions
    const rawArchived = (parsed as unknown as Record<string, unknown>)['archivedProjects']
    if (isPlainObject(rawArchived)) {
      const archivedProjects: Record<string, LedgerArchivedProject> = {}
      for (const [key, entry] of Object.entries(rawArchived)) {
        if (!isPlainObject(entry)) continue
        archivedProjects[key] = {
          title: typeof entry['title'] === 'string' ? entry['title'] : key,
          ...(typeof entry['path'] === 'string' && entry['path'] !== '' ? { path: entry['path'] } : {}),
          isGit: entry['isGit'] === true,
          archivedAt: typeof entry['archivedAt'] === 'number' && Number.isFinite(entry['archivedAt'])
            ? entry['archivedAt']
            : 0,
        }
      }
      if (Object.keys(archivedProjects).length > 0) {
        result.archivedProjects = archivedProjects
      }
    }
    cached = { ...identity, data: result }
    return result
  }

  /**
   * 原子写盘：目录 → `<file>.tmp`（0o600）→ fsync → rename。失败清理 tmp。
   */
  async function writeToDisk(data: LedgerData): Promise<void> {
    const file = await ledgerFile()
    const tmp = `${file}.tmp`
    try {
      await mkdir(dirname(file), { recursive: true })
      const handle = await open(tmp, 'w', 0o600)
      try {
        await handle.writeFile(`${JSON.stringify(data, null, 2)}\n`, 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }
      await rename(tmp, file)
      const identity = await fileIdentity(file)
      cached = identity === undefined ? undefined : { ...identity, data }
    } catch (error) {
      cached = undefined
      // 清理半截 tmp，避免目录里残留垃圾
      try {
        await unlink(tmp)
      } catch {
        // tmp 可能压根没建起来
      }
      throw error
    }
  }

  /** Promise 链尾：保证任一时刻只有一次任务在飞，且失败不会毒化后续任务。 */
  let tail: Promise<void> = Promise.resolve()

  /**
   * 把任务追加到串行链尾。
   * - 返回值是**本次任务自己的**结果（不复用共享变量）；
   * - `tail` 吞掉本次的成败，所以某次抛错不会让整条链永久卡死。
   */
  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = tail.then(task, task)
    tail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  return {
    read(): Promise<LedgerData> {
      // 公开 read() 契约：返回独立副本（调用方改动不影响缓存 / 下一次读取）。
      return enqueue(async () => structuredClone(await readFromDisk()))
    },

    write(data: LedgerData): Promise<void> {
      return enqueue(() => writeToDisk(data))
    },

    update(fn: (data: LedgerData) => LedgerData): Promise<LedgerData> {
      return enqueue(async () => {
        const current = await readFromDisk()
        const next = fn(current)
        if (next === current) return current // 同一引用 ⇒ 无变化，跳过写盘（陷阱见 LedgerStore.update 的 JSDoc）
        await writeToDisk(next)
        return next
      })
    },
  }
}
