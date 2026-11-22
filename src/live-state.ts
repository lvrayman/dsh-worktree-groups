/**
 * 会话行的**客户端 live fact**：等待确认（琥珀）与后台完成未读（绿点）。
 *
 * ## 为什么单独成一个纯逻辑模块
 *
 * 这两个态**只能**从客户端快照取 —— 宿主 HTTP 面（`SessionSummary` 的
 * `summarizeCold` / `summaryFor` / `listFields`）根本没有这两个字段。而客户端的取法
 * 随宿主版本变化过两次，把它从 `sidebar.tsx` 抽出来，才能用 `node --test` 直接覆盖
 * （`.tsx` 不进 `lib/`，无法单测）。
 *
 * ## 宿主事实（2026-10-19 核实，Desktop 2.0.18 / `@deepseek-ai/*@0.2.1-rc.2`）
 *
 * | 状态 | `0.1.5-rc.2` 的取法 | `0.2.1-rc.2` 的取法 |
 * |---|---|---|
 * | 等待确认 | root hook `useSessionPendingInteraction` → `Map<id, interaction>` | **该 source 已删除**；改由 `useSessionStatus` 提供 |
 * | 后台完成未读 | `useSessions().byId[id].completed` | **该字段已删除**；改由 `useSessionStatus` 的 `completionUnread` |
 *
 * `useSessionStatus` 的快照形状（`dsh-client-ui-session/lib/client.js` 的
 * `publishStatus()`）：
 *
 * ```js
 * new Map<SessionId, {
 *   running: boolean,
 *   pendingInteraction: { kind: 'approval' | 'plan-review' | 'question' | <其它> } | undefined,
 *   completionUnread: boolean,
 * }>()
 * ```
 *
 * ## 契约
 *
 * 1. **新源优先**：`status` 有该会话的数据就用它，旧取法不再覆盖；
 * 2. **旧取法保留兜底**：宿主回退或其它组合下不至于两个态全灭；
 * 3. **kind 白名单**：只有 `approval` / `plan-review` / `question` 算「等待确认」
 *    （对齐原生 `visiblePendingKind`，`dsh-client-ui-workspace/lib/client.js`）；
 * 4. **id 拼法兼容**：宿主有 `session-<uuid>` 与裸 `<uuid>` 两种拼法，查表归一化；
 * 5. **绝不抛错**：任何不认识的形状都降级为「没有该态」。
 *
 * 纯逻辑：不 import react、不 import 任何 `@deepseek-ai/*`、无 IO。
 */

/** 原生 `visiblePendingKind` 的取值域（其余 kind 视为「没有待确认」）。 */
const VISIBLE_PENDING_KINDS: readonly string[] = ['approval', 'plan-review', 'question']

/**
 * 复刻原生 `visiblePendingKind()`。
 *
 * 语义：只有 `approval` / `plan-review` / `question` 三种 kind 算「等待用户确认」，
 * 其它（或非字符串）一律 `undefined` —— 客户端不能因为快照里有值就点琥珀。
 *
 * @param kind 快照里 interaction 的 `kind`（未知类型）。
 * @returns 合法 kind，或 `undefined`。
 */
export function visiblePendingKind(kind: unknown): string | undefined {
  return typeof kind === 'string' && VISIBLE_PENDING_KINDS.includes(kind) ? kind : undefined
}

/**
 * 会话 id 归一化键（宿主有 `session-<uuid>` 与裸 `<uuid>` 两种拼法）。
 *
 * **只用于查表比较**，渲染与写回仍用原 id。
 *
 * @param id 会话 id。
 * @returns 去掉 `session-` 前缀后的比较键。
 */
export function normalizeSessionKey(id: string): string {
  return id.startsWith('session-') ? id.slice('session-'.length) : id
}

/** `useSessions` 快照里我们需要的部分（旧取法兜底用）。 */
interface SessionsSnapshot {
  /** `sessionId → 条目`（宿主 client 的 `projectList()` 产出）。 */
  byId?: Record<string, { completed?: unknown } | undefined>
}

/** {@link liveStateOf} 的输入：三个可选的宿主快照。 */
export interface LiveStateInput {
  /** `useSessionStatus(identity)` 的结果（新源，优先）。 */
  status?: unknown
  /** `useSessionPendingInteraction(identity)` 的结果（旧源，兜底）。 */
  pending?: unknown
  /** `useSessions(identity)` 的结果（旧源，兜底）。 */
  sessions?: SessionsSnapshot | undefined
}

/** 一个会话行的 live fact。 */
export interface SessionLiveState {
  /** 等待确认的合法 kind；`undefined` = 没有待确认。 */
  pendingKind: string | undefined
  /** 后台完成未读（绿点）。 */
  completionUnread: boolean
}

/** 从任意形状里按 id 取条目（兼容 `Map` 与 `get()` 形态）。 */
function entryOf(face: unknown, sessionId: string): unknown {
  if (face === null || face === undefined) return undefined
  const map = face as { get?: (key: string) => unknown }
  if (typeof map.get !== 'function') return undefined
  try {
    return map.get(sessionId)
  } catch {
    return undefined
  }
}

/**
 * 从 `useSessionStatus` 的快照里取某会话的状态条目。
 *
 * 先按原 id 精确命中（宿主绝大多数情况一致），再退归一化键遍历 —— 遍历是 O(n)，
 * 只在未命中时发生。
 *
 * @param status `useSessionStatus(identity)` 的结果。
 * @param sessionId 渲染行的 `row.sessionId`。
 * @returns 状态条目，或 `undefined`。
 */
export function sessionStatusOf(status: unknown, sessionId: string): unknown {
  if (typeof sessionId !== 'string' || sessionId === '') return undefined
  const direct = entryOf(status, sessionId)
  if (direct !== undefined) return direct
  const iterable = status as { entries?: () => Iterable<[unknown, unknown]> } | null | undefined
  if (iterable === null || iterable === undefined || typeof iterable.entries !== 'function') return undefined
  const key = normalizeSessionKey(sessionId)
  if (key === '') return undefined
  try {
    for (const [id, value] of iterable.entries()) {
      if (typeof id === 'string' && normalizeSessionKey(id) === key) return value
    }
  } catch {
    return undefined
  }
  return undefined
}

/** 旧源：`useSessionPendingInteraction` 的 `Map<id, interaction>`。 */
function pendingKindFromLegacy(pending: unknown, sessionId: string): string | undefined {
  const direct = visiblePendingKind((entryOf(pending, sessionId) as { kind?: unknown } | undefined)?.kind)
  if (direct !== undefined) return direct
  const iterable = pending as { entries?: () => Iterable<[unknown, unknown]> } | null | undefined
  if (iterable === null || iterable === undefined || typeof iterable.entries !== 'function') return undefined
  const key = normalizeSessionKey(sessionId)
  if (key === '') return undefined
  try {
    for (const [id, interaction] of iterable.entries()) {
      if (typeof id !== 'string' || normalizeSessionKey(id) !== key) continue
      const kind = visiblePendingKind((interaction as { kind?: unknown } | undefined)?.kind)
      if (kind !== undefined) return kind
    }
  } catch {
    return undefined
  }
  return undefined
}

/** 旧源：`useSessions().byId[id].completed`。 */
function completedFromLegacy(sessions: SessionsSnapshot | undefined, sessionId: string): boolean {
  const byId = sessions?.byId
  if (byId === null || byId === undefined || typeof byId !== 'object') return false
  if (byId[sessionId]?.completed === true) return true
  const key = normalizeSessionKey(sessionId)
  if (key === '') return false
  for (const [id, entry] of Object.entries(byId)) {
    if (entry?.completed === true && normalizeSessionKey(id) === key) return true
  }
  return false
}

/**
 * 运行中会话集合签名：只取 `running === true` 的会话 id，归一化去重、排序、逗号拼接。
 *
 * ## 用途（2026-10-20，运行中任务高亮）
 *
 * `sidebar.tsx` 把它放进**既有 220 ms 防抖**重取 effect 的依赖。签名只在「运行集合」
 * 变化时变（宿主 `sameSessionStatus` 已先做内容去重）⇒ 不会因 `Map` 引用变化每帧重取，
 * 也不会因审批弹窗 / 完成未读触发重取。
 *
 * ## 精确语义（`test/live-state.test.mjs` 的 B1–B8 逐条锁定）
 *
 * 1. 非对象 / 无 `entries()` ⇒ `''`；
 * 2. 遍历 `entries()`：`id` 非字符串或空串 ⇒ 跳过；条目为 `null` / 非对象 ⇒ 跳过；
 *    `running !== true` ⇒ 跳过（**只认 `=== true`**，`undefined` / 真值对象都不算）；
 * 3. `normalizeSessionKey(id)` 归一化（`session-x` 与 `x` 只算一次），键为空 ⇒ 跳过；
 * 4. `[...Set].sort()` 后 `join(',')`（默认 UTF-16 码元升序，结果确定）；
 * 5. 遍历过程中任何异常 ⇒ `''`（整体 try/catch，绝不抛）。
 *
 * **忽略** `pendingInteraction` 与 `completionUnread`：审批弹窗、完成未读都不是「运行中」。
 *
 * 纯函数：不 import react / 宿主包、无 IO、不读时间与随机数。
 *
 * @param status `useSessionStatus(identity)` 的快照（未知形状，防御式读取）。
 * @returns 归一化运行中 id 的排序逗号串；空状态 / 异常形状 ⇒ `''`。
 */
export function runningSignature(status: unknown): string {
  const iterable = status as { entries?: () => Iterable<[unknown, unknown]> } | null | undefined
  if (iterable === null || iterable === undefined || typeof iterable.entries !== 'function') return ''
  try {
    const keys = new Set<string>()
    for (const [id, entry] of iterable.entries()) {
      if (typeof id !== 'string' || id === '') continue
      if (entry === null || typeof entry !== 'object') continue
      if ((entry as { running?: unknown }).running !== true) continue
      const key = normalizeSessionKey(id)
      if (key === '') continue
      keys.add(key)
    }
    return [...keys].sort().join(',')
  } catch {
    return ''
  }
}

/**
 * 取一个会话行的 live fact（新源优先，旧源兜底）。
 *
 * @param input 三个可选快照。
 * @param sessionId 渲染行的 `row.sessionId`。
 * @returns `pendingKind` 与 `completionUnread`；永不抛错。
 */
export function liveStateOf(input: LiveStateInput, sessionId: string): SessionLiveState {
  const status = sessionStatusOf(input.status, sessionId) as
    | { pendingInteraction?: unknown; completionUnread?: unknown }
    | undefined

  const pendingKind = status === undefined
    ? pendingKindFromLegacy(input.pending, sessionId)
    : visiblePendingKind((status.pendingInteraction as { kind?: unknown } | undefined)?.kind)

  const completionUnread = typeof status?.completionUnread === 'boolean'
    ? status.completionUnread === true
    : completedFromLegacy(input.sessions, sessionId)

  return { pendingKind, completionUnread }
}

/** {@link currentSessionIdOf} 的输入。 */
export interface CurrentSessionInput {
  /** `useSessions(identity)` 的快照。 */
  sessions?: unknown
  /** `usePanelInfo(identity)` 的快照（可选）。 */
  panelInfo?: unknown
  /** 用户刚点击打开会话时的乐观选中 sessionId（可选）。 */
  optimisticSessionId?: string
}

/**
 * 解析当前在主视图打开的会话 id（2026-10-21 WSR3 / AC2）。
 *
 * ## 为什么需要它
 *
 * 宿主 `@deepseek-ai/dsh-api-session-controller@0.2.1-rc.2` 删除了 `sessions.list`
 * 快照顶层的 `current` 字段（`lib/client.js:3814`），改为在 `byId[id].retainedBy.mainView`
 * 计数上标记当前主视图持有的会话（`dsh-client-ui-workspace/lib/client.js:866, 3025-3027`）。
 * 旧代码只读 `sessionsSnapshot?.current`，导致升级后 `currentSessionId` 恒为 `undefined`，
 * 打开任何对话都没有选中效果。
 *
 * ## 优先级
 *
 * 1. 若 `panelInfo` 为对象且 `activePanelId !== null && activePanelId !== undefined`
 *    （其它面板占据主视图）⇒ 返回 `undefined`；
 * 2. 新源（`0.2.1-rc.2`）：`sessions.byId` 中 `retainedBy.mainView > 0` 的条目；
 * 3. 旧源（`0.1.5-rc.2` 兜底）：`sessions.current` 非空字符串；
 * 4. 乐观选中兜底：`optimisticSessionId` 非空字符串（覆盖刚点击历史孤儿会话尚未完成
 *    `retainScope` 投影的窗口，或无 `byId` 的测试桩）。
 */
export function currentSessionIdOf(input: CurrentSessionInput): string | undefined {
  if (input === null || input === undefined || typeof input !== 'object') return undefined
  try {
    const panelInfo = input.panelInfo
    if (panelInfo !== null && panelInfo !== undefined && typeof panelInfo === 'object') {
      const activePanelId = (panelInfo as { activePanelId?: unknown }).activePanelId
      if (activePanelId !== null && activePanelId !== undefined) return undefined
    }

    const sessions = input.sessions
    if (sessions !== null && sessions !== undefined && typeof sessions === 'object') {
      const byId = (sessions as { byId?: unknown }).byId
      if (byId !== null && byId !== undefined && typeof byId === 'object' && !Array.isArray(byId)) {
        for (const [key, rawEntry] of Object.entries(byId as Record<string, unknown>)) {
          if (rawEntry === null || rawEntry === undefined || typeof rawEntry !== 'object') continue
          const entry = rawEntry as {
            id?: unknown
            sessionId?: unknown
            retainedBy?: { mainView?: unknown } | null
          }
          const mainView = entry.retainedBy?.mainView
          if (typeof mainView === 'number' && Number.isFinite(mainView) && mainView > 0) {
            if (typeof entry.id === 'string' && entry.id !== '') return entry.id
            if (typeof entry.sessionId === 'string' && entry.sessionId !== '') return entry.sessionId
            if (key !== '') return key
          }
        }
      }

      const legacyCurrent = (sessions as { current?: unknown }).current
      if (typeof legacyCurrent === 'string' && legacyCurrent !== '') return legacyCurrent
    }

    if (typeof input.optimisticSessionId === 'string' && input.optimisticSessionId !== '') {
      return input.optimisticSessionId
    }
    return undefined
  } catch {
    return undefined
  }
}

