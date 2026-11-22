/**
 * 会话「最后更新时间」跟踪（2026-10-29 RAS1–RAS5）。
 *
 * ## 为什么需要这个模块
 *
 * 宿主 `SessionSummary.updatedAt = max(header.createdAt, metadata.lastPromptAt)`，而
 * `lastPromptAt` **只在用户发言时推进**（`dsh-api-session-controller/lib/types/list.js`）。
 * 助手回复、工具执行、子代理/后台任务活动都不会改变它 ⇒ 侧栏「最近」分区无法让
 * 「正在被更新」的旧会话上浮。本模块监听宿主 Cordis 事件 `session/event`，用
 * `event.time` 记录每个会话的最后活动时间，并在载荷组装时把子代理活动传播到祖先。
 *
 * ## 约束（见 `docs/design/2026-10-29-recent-any-activity-sort.md`）
 *
 * - 事件回调只做 O(1) 内存记录：不读日志、不扫盘、不抛错。
 * - 记录表是**进程内**内存态（LRU 上限 {@link SESSION_ACTIVITY_LIMIT}）；重启后回退 `updatedAt`。
 * - `lastActivityAt` 恒为有限数字且 `>= updatedAt`；只有「最近」分区消费它排序。
 */

import type { Context } from '@deepseek-ai/cordis'

/** 活动表容量上限：超过后按 LRU 淘汰最久未更新的一条（防止长进程无界增长）。 */
export const SESSION_ACTIVITY_LIMIT = 4096

/** 宿主顶层会话 id 的固定前缀（`session-<uuid>`）。 */
const SESSION_ID_PREFIX = 'session-'

/**
 * 归一化会话 id：去掉宿主顶层会话的 `session-` 前缀，首尾空白裁掉。
 *
 * 事件里的 `session.id` 与载荷里的 `sessionId` 可能一个带前缀、一个不带（子代理常见），
 * 统一到同一把键，避免「记录到了但查不到」。非字符串/空串返回 `''`。
 */
export function normalizeActivitySessionId(id: unknown): string {
  if (typeof id !== 'string') return ''
  let value = id.trim()
  if (value === '') return ''
  if (value.length > SESSION_ID_PREFIX.length && value.startsWith(SESSION_ID_PREFIX)) {
    value = value.slice(SESSION_ID_PREFIX.length)
  }
  return value
}

/** 只接受有限数字的时间戳；其余（NaN / Infinity / 字符串 / undefined）返回 undefined。 */
function finiteTime(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** 会话活动时间表。 */
export interface SessionActivityTracker {
  /** 记录一次活动；只保留最大值；非法 id/时间忽略；重复记录会把键移到 LRU 尾部。 */
  record(sessionId: unknown, time: unknown): void
  /** 取该会话已记录的最大活动时间（内部按归一化 id 查找）；没有则 `undefined`。 */
  lastActivityAt(sessionId: unknown): number | undefined
  /** 当前记录条数（测试/诊断用）。 */
  readonly size: number
}

/**
 * 造一个活动时间表。
 *
 * @param limit - 容量上限；非法或小于 1 时回退 {@link SESSION_ACTIVITY_LIMIT}。
 */
export function createSessionActivityTracker(limit: number = SESSION_ACTIVITY_LIMIT): SessionActivityTracker {
  const capacity = typeof limit === 'number' && Number.isFinite(limit) && limit >= 1
    ? Math.floor(limit)
    : SESSION_ACTIVITY_LIMIT
  const times = new Map<string, number>()

  /** 把键移到 Map 尾部（LRU 的「最近使用」端）；不存在则忽略。 */
  const touch = (key: string): void => {
    const value = times.get(key)
    if (value === undefined) return
    times.delete(key)
    times.set(key, value)
  }

  return {
    record(sessionId, time) {
      const key = normalizeActivitySessionId(sessionId)
      const at = finiteTime(time)
      if (key === '' || at === undefined) return
      const prior = times.get(key)
      if (prior !== undefined) {
        if (prior >= at) {
          // 值没变（或更旧），但仍是一次「观测」⇒ 刷新 LRU 位置。
          touch(key)
          return
        }
        times.delete(key)
      }
      times.set(key, at)
      while (times.size > capacity) {
        const oldest = times.keys().next().value
        if (oldest === undefined) break
        times.delete(oldest)
      }
    },
    lastActivityAt(sessionId) {
      const key = normalizeActivitySessionId(sessionId)
      return key === '' ? undefined : times.get(key)
    },
    get size() {
      return times.size
    },
  }
}

/**
 * 进程级单例。
 *
 * `resetSessionActivity` 直接换新实例（而不是 clear），让测试之间彻底隔离；
 * 其余导出的读写函数都通过闭包读当前实例。
 */
let singleton = createSessionActivityTracker(SESSION_ACTIVITY_LIMIT)

/**
 * 活动版本号（2026-11-14 PERF1）：每观测到一次宿主 `session/event` 就 +1。
 *
 * `routes.ts` 的会话行缓存用它判断「自上次全量列举以来是否有过任何会话活动」——
 * 没有活动 ⇒ 缓存仍可信，免去一次全量扫盘。只增不减；`resetSessionActivity` 不回退它
 * （回退会让缓存误判为「无变化」）。
 */
let activityVersion = 0

/** 当前活动版本号（只增不减）。 */
export function sessionActivityVersion(): number {
  return activityVersion
}

/** 记录一次活动（进程级单例）。 */
export function recordSessionActivity(sessionId: unknown, time: unknown): void {
  activityVersion += 1
  singleton.record(sessionId, time)
}

/** 取某会话已记录的最大活动时间（进程级单例）。 */
export function lastSessionActivityAt(sessionId: unknown): number | undefined {
  return singleton.lastActivityAt(sessionId)
}

/** 清空进程级活动表（测试用；生产环境不调用）。 */
export function resetSessionActivity(): void {
  singleton = createSessionActivityTracker(SESSION_ACTIVITY_LIMIT)
}

/** 从宿主 `Session` 实例里取 id（`session.id` 优先，退化到 `session.header.id`）。 */
function hostSessionIdOf(session: unknown): string | undefined {
  if (typeof session !== 'object' || session === null) return undefined
  const direct = (session as { id?: unknown }).id
  if (typeof direct === 'string' && direct !== '') return direct
  const header = (session as { header?: { id?: unknown } }).header
  if (typeof header?.id === 'string' && header.id !== '') return header.id
  return undefined
}

/**
 * 监听宿主 Cordis 事件 `session/event(session, event)`，把 `(session.id, event.time)`
 * 写入进程级活动表。
 *
 * 宿主上下文没有 `on`（老宿主 / 测试替身）、监听注册抛错、事件形状不符时一律**静默降级**，
 * 绝不因为活动跟踪而让插件加载失败或产生未捕获异常。监听器会随插件上下文一起释放；
 * 返回的 disposer 可提前解除（重复调用安全）。
 */
export function registerSessionActivityObserver(ctx: Context): () => void {
  const context = ctx as unknown as { on?: unknown }
  if (typeof context.on !== 'function') return () => undefined

  let disposed = false
  try {
    const disposer = context.on.call(ctx, 'session/event', (session: unknown, event: unknown) => {
      if (disposed) return
      try {
        const id = hostSessionIdOf(session)
        if (id === undefined) return
        const time = finiteTime((event as { time?: unknown } | undefined)?.time)
        if (time === undefined) return
        recordSessionActivity(id, time)
      } catch {
        // 事件回调里绝不抛：宿主虽逐监听器隔离异常，但本插件的纪律是「缺失即降级，绝不崩」。
      }
    })
    return () => {
      disposed = true
      if (typeof disposer !== 'function') return
      try {
        disposer()
      } catch {
        // 释放失败不影响插件卸载。
      }
    }
  } catch {
    return () => undefined
  }
}

/** `attachLastActivityTimes` 需要的最小行形状（`SessionRow` 结构兼容）。 */
export interface SessionActivityBearing {
  sessionId: string
  updatedAt: number
  parentSessionId?: string
  /** 输出字段：最后更新时间（有限数字，且 >= updatedAt）。 */
  lastActivityAt?: number
}

/**
 * 给一批会话行写 `lastActivityAt = max(updatedAt, 自身/后代活动时间)`。
 *
 * 纯函数（只依赖进程级活动表，不读写磁盘）。规则：
 * - 没有活动记录 ⇒ `lastActivityAt = updatedAt`（与旧行为一致）。
 * - 记录比 `updatedAt` 旧 ⇒ 仍取 `updatedAt`（不降低排序键）。
 * - 子代理活动沿 `parentSessionId` 向祖先传播；缺失父引用、自环、多节点环安全终止。
 * - 同一归一化 id 的多行写同一个值。
 */
export function attachLastActivityTimes(rows: SessionActivityBearing[]): void {
  if (rows.length === 0) return

  const keys: string[] = new Array(rows.length)
  const value = new Map<string, number>()
  const parentOf = new Map<string, string>()

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!
    const key = normalizeActivitySessionId(row.sessionId)
    keys[index] = key
    const updatedAt = finiteTime(row.updatedAt) ?? 0
    const own = key === '' ? updatedAt : Math.max(updatedAt, singleton.lastActivityAt(key) ?? 0)
    if (key !== '') {
      const prior = value.get(key)
      value.set(key, prior === undefined ? own : Math.max(prior, own))
    }
    const parentKey = normalizeActivitySessionId(row.parentSessionId)
    if (key !== '' && parentKey !== '' && parentKey !== key && !parentOf.has(key)) {
      parentOf.set(key, parentKey)
    }
  }

  // 祖先传播：每轮把子值抬到父值；值只增不减且有上界 ⇒ 必然终止。轮数再加一道保险，
  // 防止未来有人把 parentOf 改成可自增的形态后死循环。
  if (parentOf.size > 0) {
    const maxPasses = Math.min(1024, Math.max(1, rows.length + 1))
    for (let pass = 0; pass < maxPasses; pass += 1) {
      let changed = false
      for (const [key, parentKey] of parentOf) {
        const childValue = value.get(key)
        const parentValue = value.get(parentKey)
        // 父不在本批行里时不凭空造条目：只传播已存在的行。
        if (childValue === undefined || parentValue === undefined) continue
        if (childValue > parentValue) {
          value.set(parentKey, childValue)
          changed = true
        }
      }
      if (!changed) break
    }
  }

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!
    const key = keys[index]!
    const resolved = key === '' ? undefined : value.get(key)
    row.lastActivityAt = resolved ?? (finiteTime(row.updatedAt) ?? 0)
  }
}
