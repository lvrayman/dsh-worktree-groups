/**
 * 侧栏树推导（客户端纯逻辑）。
 *
 * 本文件是**纯逻辑**：不 import react、不 import 任何 `@deepseek-ai/*` 包、不做 IO，
 * 因此可以被 `node --test` 直接覆盖。组件（`src/sidebar.tsx`）只负责把
 * {@link RenderRow} 画出来，不做任何推导。
 *
 * 与原生侧栏（`@deepseek-ai/dsh-client-ui-workspace`）的一致性：
 * - 5 条截断：`COLLAPSED_SESSION_LIMIT = 5`，只对「非 blank 会话」计名额，
 *   `hiddenCount = 总数 - 可见数`（原生 `collapsedSessionRows` 语义）。
 * - 展开态缺省视为展开（原生默认全展开）。
 * - `blank === true` 的会话只显示当前那一条（原生 `sessionVisible` 语义）。
 * - 归档会话哪里都不出现（原生 `sessionVisible` 语义）。
 * - **子代理会话（`origin === 'subagent'`）不产生任何会话行**（原生 `sessionVisible`
 *   的第一项就是 `session.origin !== "subagent"`）；父行只保留「N 个子代理运行中」
 *   计数胶囊，其 n 是**运行中的子代理后代数（所有层级）**（原生 `runningSubagentCount`）。
 *   且 **n > 0 时父行状态点也是「运行中」**（需求 A，2026-09-21）—— 对齐原生
 *   `sessionStatuses`：只有子代理在跑时主状态点同样是 ongoing，而不是灰 idle。
 * - `sessionCount` / `runningCount` / `pendingCount` 只统计顶层会话（= 非子代理），
 *   子代理不计入（原生 `sessionCount` 指顶层会话数）。⚠️ `runningCount` 的取值口径
 *   **不含**子代理聚合（用户裁决 Q1：渲染层无消费者，不扩大范围）—— 它与 `session.running`
 *   一致，而**行上的 `running` 字段**才含聚合。
 * - 排序：`updatedAt` 降序，`updatedAt` 相同按 `sessionId` 升序（原生 `byRecency`），
 *   保证同样的输入永远推出同样的行序列。
 * - **顶部区（T11，2026-09-22 用户终裁；取代 T5/T9 的 D3a/D3c/D4 全部安排）**：每个容器内，
 *   **只有「正在运行」的会话**（自身 `running` **或** 任意层级有运行中的子代理，即既有聚合
 *   `running` 口径）进入**顶部区** —— 它们固定在所属容器**最前**、位于 5 条截断**之前**，
 *   并且**不可拖动**（拖它们无效果；回弹到顶部是预期行为）。顶部区内部按 `updatedAt` 降序。
 *   此外，**尚未落表的新会话**仍由渲染期提升（D2 的唯一例外），见 {@link topZoneSessionKeys}。
 *   ⚠️ **已结束的会话一律不再固定置顶**：「刚结束保留」（`recentlyFinished`）与「当前打开的
 *   会话置顶」（`isCurrent`）两个机制已按用户终裁**删除**。已结束会话（含用户正在查看的
 *   旧会话、含刚刚跑完的会话）位置**完全由持久拖拽顺序决定**，并且**必须可以正常拖动**
 *   （拖到哪就留在哪，不回弹）。顶部区**不写** `localStorage`（唯一写入例外是 D2 的新会话
 *   插入固化表，见 {@link effectiveOrder} 与 {@link planNewSessionInserts}）。
 * - **手动排序（D10，2026-09-21 用户决策变更）**：三层（项目 / worktree / 会话）都可在
 *   浏览器里拖拽排序，结果存 `localStorage` 并以 {@link ManualOrder} 叠加在默认顺序之上；
 *   `manual !== true` 时**完全不生效**（零回归）。见 {@link applyManualOrder}。
 *
 * 契约见 `docs/INTERFACES.md` §2.2。
 */

/**
 * 每个「会话容器」（worktree / history / project / 未分组）折叠时可见的**非 blank**
 * 会话上限。
 *
 * ⚠️ **T13（2026-09-22 用户终裁）：本插件**没有**「当前会话保底进前 limit 条」这条规则了。**
 * 原生 `collapsedSessionRows` 把「当前会话看不见」交给「自动全部展开」处理；本插件曾以
 * `truncateSessions` 的 `promote` 分支实现「保底」，但它在 T11 删除 `isCurrent` 置顶后
 * 变成**可达**，并让「把当前会话往下拖」出现**视觉零位移**（与用户投诉的首要缺陷同形）。
 * 用户裁决**删除**该保底：**拖拽顺序完全优先**，当前会话若被截断到不可见，就是看不见。
 * 因此 `truncateSessions` 不再有 `currentSessionId` 参数（见那里的 JSDoc）。
 */
export const COLLAPSED_SESSION_LIMIT = 5

/**
 * 「最近」分区旧的展示上限（2026-10-21 WSR6 / AC5）。
 *
 * ⚠️ **2026-11-14 PX4 起不再参与截断**：「最近」默认 {@link COLLAPSED_SESSION_LIMIT} 条，按
 * {@link visibleSessionLimit} 渐进展开、无上限。常量仅为兼容既有导出保留。
 */
export const RECENT_SESSION_LIMIT = 100

/**
 * 展开层级 L 对应的可见上限（2026-11-14 PX1/PX-AC2）：`5 + 5·L(L+1)/2` ⇒ 5、10、20、35、55…
 * （第 k 次点击多展开 `5·k` 条）。非法 / 负层级按 0。
 */
export function visibleSessionLimit(level: number): number {
  const l = Number.isFinite(level) && level > 0 ? Math.floor(level) : 0
  return COLLAPSED_SESSION_LIMIT + (COLLAPSED_SESSION_LIMIT * l * (l + 1)) / 2
}

/** 下一次点击「展开更多」会多显示的条数：`min(5·(L+1), 剩余)`（PX-AC3）。 */
export function nextExpandCount(level: number, remaining: number): number {
  const l = Number.isFinite(level) && level > 0 ? Math.floor(level) : 0
  const left = Number.isFinite(remaining) && remaining > 0 ? Math.floor(remaining) : 0
  return Math.min(COLLAPSED_SESSION_LIMIT * (l + 1), left)
}

/** 读取某容器的展开层级（缺失 / 非法 ⇒ 0）。 */
function expandLevelOf(levels: Record<string, number> | undefined, key: string): number {
  const value = levels?.[key]
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

/**
 * 折叠某一行时需要清零展开层级的会话容器 key（2026-11-14 PX3/PX-AC4）。
 *
 * - 项目行 `p:<projectKey>` ⇒ 自身（非 git 平铺 / 未分组容器与行同 key）+ `h:<projectKey>` +
 *   其全部 worktree 容器 `w:<path>`；
 * - 其余（worktree 行 `w:<path>`、history 行 `h:…`、「最近」`r:__recent__`）⇒ 仅自身
 *   （这些行的 key 与其会话容器 key 同源，见 `containersOfProject`）。
 */
export function containerKeysUnder(projects: readonly ProjectNodeLike[], rowKey: string): string[] {
  if (!rowKey.startsWith('p:')) return [rowKey]
  const projectKey = rowKey.slice('p:'.length)
  const keys = new Set<string>([rowKey, `h:${projectKey}`])
  const project = projects.find((candidate) => candidate.key === projectKey)
  for (const node of project?.worktrees ?? []) keys.add(`w:${node.path}`)
  return [...keys]
}

/**
 * 「最近」分区的合成键（对应行 `key = 'r:' + RECENT_KEY`）。
 */
export const RECENT_KEY = '__recent__'

/**
 * 「未分组」容器的合成项目键。
 *
 * 冻结的 {@link RenderRow} 联合类型里没有 `ungrouped` 行种类，所以未分组容器复用
 * `project` 行表达（`key = 'p:' + UNGROUPED_KEY`，`isGit: false`）。渲染层可用它把
 * 未分组行与真实项目行区分开。
 */
export const UNGROUPED_KEY = '__ungrouped__'

/** 会话 id 的宿主前缀（`session-<uuid>`）。仅用于**比较**父 id，输出仍用原 id。 */
const SESSION_ID_PREFIX = 'session-'

/** 一条会话行（与宿主 `SessionRow` 结构兼容，不跨半边 import）。 */
export interface SessionRowLike {
  sessionId: string
  updatedAt: number
  /**
   * 会话**最后更新时间**（2026-10-29 RAS1–RAS5）：宿主载荷自带的
   * `max(updatedAt, 任意 session/event 活动时间)`。**只有「最近」分区消费它排序**；
   * 工作区树 / 手动顺序 / 顶部区仍使用 `updatedAt`。旧载荷缺失时按 `updatedAt` 处理。
   */
  lastActivityAt?: number
  running: boolean
  blank: boolean
  cwd?: string
  parentSessionId?: string
  /** 与宿主 `SessionRow.origin` 同宽（宿主只会给 'subagent'）。 */
  origin?: 'subagent'
  pendingInteraction?: string
  completed?: boolean
  title?: string
}

/** 侧栏树的一个 worktree 节点（与宿主 `WorktreeNode` 结构兼容）。 */
export interface WorktreeNodeLike {
  path: string
  branch?: string
  isMain: boolean
  exists: boolean
  /** 已注册的 dsh 工作区 id；未注册为 undefined（懒注册）。 */
  workspaceId?: string
  title: string
  sessions: SessionRowLike[]
}

/** 侧栏树的一个项目节点（与宿主 `ProjectNode` 结构兼容）。 */
export interface ProjectNodeLike {
  /** commonDir；非 git 工作区用 `ws:<workspaceId>`。 */
  key: string
  isGit: boolean
  title: string
  mainPath?: string
  worktrees: WorktreeNodeLike[]
  /** 已关闭 worktree 的会话（history-worktree-session 桶）。 */
  history: SessionRowLike[]
  /** 非 git 工作区：会话直接挂项目下（不展开 worktree 子行）。 */
  flatSessions: SessionRowLike[]
}

/**
 * 冻结的渲染行类型（与 `docs/INTERFACES.md` §2.2 逐字对齐）。
 * 组件只负责把行画出来，不做任何推导。
 */
export type RenderRow =
  | {
      kind: 'recent'
      /** `r:${RECENT_KEY}` */
      key: string
      /** locales: section.recent */
      label: string
      depth: 0
      expanded: boolean
      sessionCount: number
    }
  | {
      kind: 'project'
      /** `p:<projectKey>`（未分组为 `p:${UNGROUPED_KEY}`）。 */
      key: string
      label: string
      depth: 0
      expanded: boolean
      isGit: boolean
      /** 非 git 工作区时有值。 */
      path?: string
      workspaceId?: string
      /**
       * worktree 子行数：**git 项目恒为 `worktrees.length`**（含单 worktree 的 git 项目，
       * D11 2026-09-21 修订）；非 git 工作区恒为 0（它不产生 worktree 子行，会话平铺）。
       */
      worktreeCount: number
      sessionCount: number
      runningCount: number
      pendingCount: number
      /**
       * **该行是否有任务正在运行（含运行中的子代理）**（2026-10-20 additive 修订）。
       *
       * 判定 = `worktreeResults.some(entry => entry.result.hasRunningTasks === true) ||
       * flatResult.hasRunningTasks === true` —— worktree 子项**或**该 workspace 的
       * flat/普通会话（2026-10-20 追加裁决：所有 workspace 都统计 flat 会话）；
       * history 桶 / 未分组**不参与**（RT2）。
       *
       * ⚠️ 它**不是** `runningCount > 0` 的别名：`runningCount` 仍只数主会话自身
       * `running === true`（用户裁决 Q1 的口径**不变**），因此允许出现
       * 「`runningCount === 0` 但 `hasRunningTasks === true`」（只有子代理在跑）。
       * 消费者仅 `sidebar.tsx` 的 `ContainerRowView`（图标高亮）。
       */
      hasRunningTasks: boolean
    }
  | {
      kind: 'worktree'
      /** `w:<path>` */
      key: string
      /** 分支名，无分支时用目录 basename。 */
      label: string
      /** 目录 basename（与 label 不同才给）。 */
      sublabel?: string
      depth: 1
      expanded: boolean
      path: string
      isMain: boolean
      exists: boolean
      workspaceId?: string
      sessionCount: number
      runningCount: number
      pendingCount: number
      /**
       * **该容器内是否有任务正在运行（含运行中的子代理）**（2026-10-20 additive 修订）。
       *
       * 判定写在 {@link emitContainer}：用**截断前**的可见顶层会话 `heads`，
       * 逐条判 `running === true || subagentCountOf(...) > 0` —— 与 `toSessionRow` 的
       * `running` **逐字同源**（同一 `subagentRunningCounts` 索引），不可能出现
       * 「会话行蓝点亮、容器行不亮」的分叉。
       *
       * ⚠️ 与 `runningCount` 口径不同是有意为之：`runningCount` 仍只数主会话自身
       * `running`（Q1 裁决不变），本字段才含子代理聚合（RT1）。
       */
      hasRunningTasks: boolean
    }
  | {
      kind: 'history'
      /** `h:<projectKey>` */
      key: string
      /** locales: history.label */
      label: string
      depth: 1
      expanded: boolean
      sessionCount: number
      runningCount: number
      pendingCount: number
    }
  | {
      kind: 'session'
      /** `s:<sessionId>` */
      key: string
      sessionId: string
      label: string
      /** 容器的会话深度：1（平铺项目 / 未分组下）或 2（worktree / history 下）。 */
      depth: number
      updatedAt: number
      running: boolean
      completed: boolean
      blank: boolean
      pendingInteraction?: string
      /**
       * **运行中的子代理后代数**（所有层级；无则在渲染层不画胶囊）。
       *
       * 语义对齐原生 `runningSubagentCount`（`indexSubagentDescendants`）—— 不是
       * 「直接子代数」，也不是「子代理总数」：不跑的子代理**不**计入，与胶囊文案
       * `a11y.subagents` = 「{n} 个子代理运行中」一致。
       */
      subagentCount: number
      isCurrent: boolean
      /** 所属父节点 key（用于「移出 history」等动作定位；最近分区为 `r:${RECENT_KEY}`）。 */
      parentKey: string
      parentKind: 'worktree' | 'history' | 'project' | 'recent'
    }
  | {
      kind: 'more'
      /** `m:<parentKey>` */
      key: string
      parentKey: string
      /** 2026-11-14 PX4：「最近」分区也产出 more 行（`parentKind: 'recent'`）。 */
      parentKind: 'worktree' | 'history' | 'project' | 'recent'
      /** 当前**仍未显示**的顶层会话数（2026-11-14 PX 起；全部展开后为 0）。 */
      hiddenCount: number
      /** 下一次点击「展开更多」会多显示的条数（{@link nextExpandCount}）；无剩余为 0。 */
      nextCount: number
      /** 是否提供「收起」（展开层级 > 0 或旧式全展开）。 */
      canCollapse: boolean
      depth: number
    }

/** {@link SidebarModelInput.t} 的取词函数签名。 */
type Translate = (key: string, vars?: Record<string, string | number>) => string

/**
 * 浏览器本地的手动排序（PRD D10，2026-09-21 用户决策变更）。
 *
 * ## 为什么是浏览器本地顺序，而不是宿主 API
 *
 * 宿主提供 `workspaces.insertBefore` / `workspaces.insertSessionBefore` 两个排序 API，
 * 但**都用不了**：
 * 1. `insertSessionBefore(workspaceId, sessionId, beforeSessionId)` 要求被拖会话与锚点
 *    **同属一个 workspace**（否则抛 `WorkspaceMoveInvalidError`）。真实数据里 MyProject 的
 *    6 个 worktree **只有 2 个已注册**，其余 4 个的会话不在任何 workspace 里；history 桶、
 *    未分组的会话同理 —— 无法统一覆盖。
 * 2. `insertBefore(workspaceId, beforeWorkspaceId)` 只能排 dsh 工作区，而树里**未注册的
 *    worktree 没有 workspaceId**，项目节点还可能对应多个工作区 —— 同样无法统一。
 *
 * 因此统一用**浏览器本地顺序**：对未注册 worktree、history 桶、未分组**全部适用**，语义
 * 一致；且这是**视图偏好**而非宿主数据，不该污染宿主注册表。（原生也是双轨：workspace
 * 顺序走宿主、session 顺序走浏览器本地 store。）
 *
 * ## 结构
 *
 * ```json
 * {
 *   "manual": true,
 *   "projects": ["<projectKey>", "..."],
 *   "worktrees": { "<projectKey>": ["<worktreePath>", "..."] },
 *   "sessions": { "<containerKey>": ["<sessionId>", "..."] }
 * }
 * ```
 *
 * - `projects` 的键是 `ProjectNode.key`（git 项目为 commonDir，非 git 为 `ws:<id>`），
 *   **不含** `UNGROUPED_KEY`（未分组行不参与拖拽）。
 * - `worktrees` 的键是 `ProjectNode.key`，值是 **worktree 绝对路径**（`WorktreeNode.path`）。
 * - `sessions` 的键是**容器 key**（`w:<path>` / `h:<projectKey>` / `p:<projectKey>`，
 *   与 `RenderRow.parentKey` 同源），值是 sessionId。
 *
 * ## 叠加算法（见 {@link applyManualOrder}）
 *
 * 列表内的项按索引重排；列表外的项（新建的会话 / worktree / 项目）按各自的**默认顺序**
 * 追加到**末尾**；列表里已不存在的项（被删 / 归档）**忽略**。纯函数，不改入参。
 */
export interface ManualOrder {
  /** 用户是否手动排过序。`false` / 缺省 ⇒ 完全走默认顺序（零回归）。 */
  manual: boolean
  /** 顶层项目顺序（`ProjectNode.key`）。 */
  projects?: string[]
  /** 项目 key → 该项目内 worktree 路径顺序。 */
  worktrees?: Record<string, string[]>
  /** 容器 key → 该容器内 sessionId 顺序。 */
  sessions?: Record<string, string[]>
}

/**
 * 按手动顺序**稳定重排**：置顶项最前，然后列表内的项按索引，列表外的项按默认顺序追加到末尾。
 *
 * 语义（四条，对应 PRD D10 的验收）：
 * 1. **置顶**（可选第 4 参）：`pinnedKeys` 里出现的项按该数组顺序排在最**前** —— 且是
 *    「先摘出来再拼」，因此它**不受 `order` 影响**（哪怕它在 `order` 里排在最后）；
 * 2. **列表内**：`order` 里出现的项，按 `order` 的索引升序排在其后；
 * 3. **列表外**：`items` 里没出现在 `order` 的项（新建的会话 / worktree / 项目）保持
 *    它们**传入时的相对顺序**，整体追加在列表内项之后 —— 因此「默认顺序」由调用方在
 *    传入前排好（会话走 `updatedAt` 降序、worktree 走宿主顺序、项目走宿主顺序）；
 * 4. **已消失的项**：`order` / `pinnedKeys` 里在 `items` 中找不到的 id **直接忽略** ——
 *    不产生空洞、不产生 `undefined`，输出长度恒等于输入长度。
 *
 * 纯函数：**不修改入参数组**（返回新数组；元素引用不变）。
 *
 * `order` 为 `undefined` / 空数组**且** `pinnedKeys` 为空时，原样返回输入的一份浅拷贝
 * （顺序完全不变）—— 这是既有调用方（`effectiveOrder`、项目层、worktree 层）零回归的保证。
 *
 * @param items 默认顺序的项（**不被修改**）。
 * @param order 手动顺序的 key 列表；`undefined` / 空 ⇒ 不按它重排。
 * @param keyOf 取项的比较键。
 * @param pinnedKeys 需要**置顶**的 key（按数组顺序排在最前）。缺省 / 空 ⇒ 与不传逐字一致。
 *   调用方只应在**渲染路径**上传它：置顶是纯运行时推导，**绝不写进持久顺序**（见
 *   {@link effectiveOrder} 刻意不传）。T11 后**唯一**的置顶来源是
 *   {@link topZoneSessionKeys}（正在运行 / 尚未落表的新会话）。
 * @returns 重排后的新数组。
 *
 * @example
 * applyManualOrder([a, b, c], ['c', 'a'], (x) => x.id)
 * // ⇒ [c, a, b]   （b 不在 order 里 ⇒ 保持默认顺序追加到末尾）
 *
 * @example
 * applyManualOrder([a, b], ['gone', 'b'], (x) => x.id)
 * // ⇒ [b, a]      （'gone' 在 items 里不存在 ⇒ 忽略，不产生空洞）
 *
 * @example
 * applyManualOrder([a, b, c], ['a', 'b'], (x) => x.id, ['c'])
 * // ⇒ [c, a, b]   （c 置顶，其余仍按 order；a/b 的 index 已在置顶阶段被占，不会重复搬运）
 */
export function applyManualOrder<T>(
  items: T[],
  order: string[] | undefined,
  keyOf: (item: T) => string,
  pinnedKeys?: readonly string[],
): T[] {
  const copy = [...items]
  const pinned = pinnedKeys === undefined ? [] : pinnedKeys
  if (pinned.length === 0 && (order === undefined || order.length === 0)) return copy

  // 索引表：key → items 里的下标。**同一个 key 出现多次时只认第一个**（与
  // `reconciledSessionOrder` 的去重口径一致），避免一个 key 被搬两次。
  const indexOf = new Map<string, number>()
  for (let i = 0; i < copy.length; i += 1) {
    const key = keyOf(copy[i])
    if (!indexOf.has(key)) indexOf.set(key, i)
  }

  const ordered: T[] = []
  const taken = new Set<number>()
  // 置顶项**先于**手动顺序取出：`taken` 共用 ⇒ 同一个 key 不会被搬两次。
  // 不在 `items` 里的置顶 key（不可见的当前会话：子代理 / 归档）自然被忽略。
  for (const key of pinned) {
    const index = indexOf.get(key)
    if (index === undefined || taken.has(index)) continue
    taken.add(index)
    ordered.push(copy[index])
  }
  for (const key of order ?? []) {
    const index = indexOf.get(key)
    // 已消失的项（index === undefined）与重复 key（taken 里已有）都跳过。
    if (index === undefined || taken.has(index)) continue
    taken.add(index)
    ordered.push(copy[index])
  }
  // 列表外的项：保持传入时的相对顺序，追加到末尾。
  for (let i = 0; i < copy.length; i += 1) {
    if (!taken.has(i)) ordered.push(copy[i])
  }
  return ordered
}

/**
 * 取某个项目下的 worktree 手动顺序（`manual` 为假时恒 `undefined`）。
 *
 * 抽出来是为了让 `buildRows` 的三个排序点读同一份判定，不可能出现「项目层应用了、
 * worktree 层忘了」这类分叉。
 */
function worktreeOrderOf(order: ManualOrder | undefined, projectKey: string): string[] | undefined {
  if (order === undefined || order.manual !== true) return undefined
  return order.worktrees?.[projectKey]
}

/** 取某个容器下的会话手动顺序（`manual` 为假时恒 `undefined`）。 */
function sessionOrderOf(order: ManualOrder | undefined, containerKey: string): string[] | undefined {
  if (order === undefined || order.manual !== true) return undefined
  return order.sessions?.[containerKey]
}

/**
 * 顶部区的运行时输入（T11，2026-09-22 用户终裁）。
 *
 * 顶部区是**运行时内存状态**：刷新页面即重置，除 D2 的「新会话插入固化表」外
 * **不写** `localStorage`（见 {@link effectiveOrder} 的不变式）。
 *
 * 本对象由 `src/sidebar.tsx`（唯一拥有跨渲染内存的地方）采集后传入；
 * `tree-model.ts` 只做纯推导 ⇒ 判据、排序、截断交互全部可被 `node --test` 覆盖。
 */
export interface TopZoneInput {
  /**
   * **正在运行**的会话 id（判据 = 该会话自己的 `running === true` **或** 它有
   * 任意层级的运行中子代理后代，即需求 A 的 `running` 口径）。
   *
   * ⚠️ 与 `SessionRowLike.running`（**裸**字段，不含子代理聚合）不同：那个字段是
   * 宿主 `SessionSummary.running` 的透传。调用方要么传已聚合的 id 集合，要么不传。
   *
   * 这是顶部区**唯一**的常规成员类别（T11 终裁）：它们固定在所属容器最前，且
   * **不可拖动**（`sidebar.tsx` 不给这些行装拖拽接线）。
   */
  runningSessionIds?: readonly string[]
  /**
   * **新会话**的会话 id（D2/D3d，T11 终裁后**唯一**的非 running 顶部区成员）。
   *
   * ⚠️ 判定口径由调用方负责（见 {@link topZoneSessionKeys} 的 JSDoc）：**不是**
   * 「所有不在固化表里的会话」—— T4 实测真实数据里有 6 条表外会话，其中 4 条是
   * **旧会话**（早于固化水位），把它们一律插到最前是错的。
   */
  newSessionIds?: readonly string[]
  /**
   * **D2 落表台账**（{@link TopZoneState.writtenNewSessionIds} 的渲染期投影）：
   * 「落表意图已满足」的新会话 id（归一化）。
   *
   * 用途（T9 缺陷 1 的修复点）：**已落表**的新会话在渲染期**不再**被提升到容器顶部区 ——
   * 它的「在容器最前」已由持久顺序承载，渲染期再提升一次会让用户随后的拖拽被静默回滚。
   *
   * ⚠️ **缺省（不传）⇒ 与旧行为逐字一致**（`newSessionIds` 全部参与提升），保证零回归：
   * 既有调用方（不传台账）行为不变。
   */
  writtenNewSessionIds?: readonly string[]
}

/**
 * 顶部区内部多个会话的相对顺序：**`updatedAt` 降序**。
 *
 * ## 选择理由
 *
 * 1. **确定性**：`updatedAt` 是唯一的稳定时间维度，且 `byRecency` 已有 `sessionId`
 *    升序 tiebreak ⇒ 同样输入永远推出同样行序（与全模块「同样输入同样输出」一致）。
 * 2. **与既有语义同向**：容器内默认排序、搜索排序都用它；顶部区若另立维度会让
 *    「同一批会话」在顶部区内外的相对顺序规则不一致，用户拖拽后的预期更难建立。
 * 3. **对「正在运行的会话」仍不理想，但已被「先于截断」兜住**：T4 已确证 `updatedAt`
 *    **不随 agent / subagent 活动推进**（宿主 `lastPromptAt` 只在 `user/message` 推进），
 *    所以一个「长期无 prompt、只有 subagent 在跑」的会话 `updatedAt` 可能很旧 ——
 *    它仍会**进入顶部区**（保证可见），只是在顶部区内部排得靠后。这是可接受的：
 *    顶部区的**首要语义是「不被 5 条截断吞掉」**，区内精排是次要诉求。
 *
 * @param sessions 候选会话（**不被修改**）。
 * @returns 按 `updatedAt` 降序（`sessionId` 升序 tiebreak）排列的**新数组**。
 */
function sortTopZone(sessions: SessionRowLike[]): SessionRowLike[] {
  return sortedByRecency(sessions)
}

/**
 * **「正在运行」判据的唯一来源**：这条会话是否在跑（⇒ 属于顶部区、且**不可拖动**）。
 *
 * ⚠️ 2026-10-22 起「不可拖动」的**唯一**判据是 {@link isSessionDragLocked}（= 本函数 ∪
 * 当前空白会话占位行）；本函数仍是其中「运行中」这一半的唯一实现，`topZoneSessionKeys`
 * 与 `isSessionDragLocked` 都调它，不得各写一份。
 *
 * ## 为什么必须导出成共享函数
 *
 * 用户终裁「正在运行的会话固定在顶部，**拖不动**」把两件事绑在一起：
 * ① 渲染层把它排到容器最前（{@link topZoneSessionKeys}）；② 渲染层**不给它装拖拽接线**
 * （`sidebar.tsx` 的 `dragHandlersFor` 调用点）。这两处若各写一遍判据，迟早分叉 ——
 * 例如「行显示运行中圆点但判据只认裸 `running`」⇒ 用户看到运行中的行却能拖走它。
 * 因此判据只有这一处实现，两侧都调它。
 *
 * ## 口径（与既有聚合 `running` 一致）
 *
 * 满足**任一**即算运行中：
 * - `session.running === true` —— 渲染行的 `running` 是**聚合**口径
 *   （`session.running || runningSubagentCount > 0`，见 {@link toSessionRow}），因此它
 *   本身就覆盖了「自身在跑」与「只有子代理在跑」两种情形；
 * - id ∈ `topZone.runningSessionIds` —— 调用方（`sidebar.tsx`）从状态机投影的**显式**
 *   聚合清单。它覆盖「状态机已知道在跑、但当前这次渲染的行数据还没反映出来」的窄窗口。
 *
 * ⚠️ **新会话不算「运行中」**：`newSessionIds` 命中的会话仍可拖动。它「在容器最前」由
 * D2 的落表（持久顺序）承载，用户把它拖走后不会被渲染期搬回（见
 * {@link TopZoneInput.writtenNewSessionIds}）。用户终裁只说了「正在运行的」拖不动。
 *
 * @param session 会话（渲染行或 `SessionRowLike` 皆可，只要有 id 与 running）。
 * @param topZone 运行时顶部区输入；缺省 ⇒ 只认 `session.running`。
 * @returns 是否属于「运行中、不可拖动」这一类。
 */
export function isTopZoneRunningSession(
  session: { sessionId: string; running?: boolean },
  topZone?: TopZoneInput,
): boolean {
  if (session.running === true) return true
  if (topZone === undefined || topZone === null || typeof topZone !== 'object') return false
  if (typeof session.sessionId !== 'string' || session.sessionId === '') return false
  const ids = topZone.runningSessionIds
  if (!Array.isArray(ids)) return false
  const key = normalizeSessionId(session.sessionId)
  for (const id of ids) {
    if (typeof id === 'string' && normalizeSessionId(id) === key) return true
  }
  return false
}

/**
 * 是否是**当前打开的空白会话**（侧栏里的「新会话」占位行）。
 *
 * 宿主原生把这条行当占位符：**恒在本组最前**且**不可起拖**：
 * - `dsh-client-ui-workspace/lib/client.js:983`：`sectionMembers` 先把所有 `blank` 成员挑出来放最前；
 * - `:952`：`pinCurrentBlank` 再把**当前** blank 提到该账户首位；
 * - `:2261`：`draggable = drag !== void 0 && !row.blank && !row.archived`。
 *
 * 本插件为什么需要它（2026-10-22 DR4，缺陷：复用空白会话后「新会话」掉到最下面）：
 * 同位置「新建会话」复用同目录的空白会话（保留草稿）之后，它不再满足
 * {@link observeTopZone} 的「新会话」判据（进程内首次观测且晚于启动水位 / blank→非 blank），
 * 渲染时只能按 `updatedAt`（很旧）或手动顺序表（表外 ⇒ 追加末尾）落到容器最后。
 *
 * ⚠️ 与 T11 终裁不冲突：终裁删除的是「**普通**当前会话置顶」（`isCurrent` 不参与顶部区），
 * 本判据只认 `blank === true` 的占位行。
 *
 * @param session 会话（渲染行或 `SessionRowLike` 皆可，只要有 id / blank）。
 * @param currentSessionId 当前会话 id（`isCurrent` 字段缺席时的第二来源；两者都做前缀归一化）。
 * @returns 是否属于「当前空白会话」。
 */
export function isCurrentBlankSession(
  session: { sessionId: string; blank?: boolean; isCurrent?: boolean },
  currentSessionId?: string,
): boolean {
  if (session.blank !== true) return false
  if (session.isCurrent === true) return true
  if (typeof currentSessionId !== 'string' || currentSessionId === '') return false
  return isCurrentSession(session.sessionId, currentSessionId)
}

/**
 * 会话行**是否禁止拖拽**的唯一判据（T11 + 2026-10-22 DR5）。
 *
 * = ① 当前空白会话占位行（{@link isCurrentBlankSession}）∪ ② 正在运行
 * （{@link isTopZoneRunningSession}，含任意层级运行中的子代理）。
 *
 * 为什么占位行必须锁拖：它被渲染期固定在容器最前（见 `emitContainer`），若还允许起拖，
 * 用户拖完只会看到弹回 —— 与 T9 缺陷 1 同一类「渲染期回滚用户操作」；宿主原生同样不给
 * blank 行起拖（`dsh-client-ui-workspace/lib/client.js:2261`）。占位行**仍接受落点**：
 * `dragHandlersFor` 的第三参只关掉「自己起拖」，别的会话照样能拖到它上方/下方。
 *
 * ⚠️ **尚未落表的新会话（`newSessionIds`）不在此列**：它由 D2 落表承载持久顺序，用户
 * 拖走后不得被渲染期搬回（见 {@link TopZoneInput.writtenNewSessionIds}）。
 *
 * @param session 会话行（`RenderRow` 或 `SessionRowLike` 皆可）。
 * @param topZone 运行时顶部区输入；缺省 ⇒ 只认裸 `running` 与占位行。
 * @returns 是否禁止起拖。
 */
export function isSessionDragLocked(
  session: { sessionId: string; running?: boolean; blank?: boolean; isCurrent?: boolean },
  topZone?: TopZoneInput,
): boolean {
  if (isCurrentBlankSession(session)) return true
  return isTopZoneRunningSession(session, topZone)
}

/**
 * 顶部区判据（T11，2026-09-22 用户终裁）—— 计算某容器内应置顶的会话 key。
 *
 * ## 判据（两类）
 *
 * | # | 类别 | 判据 | 持久化 |
 * |---|---|---|---|
 * | a | **正在运行** | id ∈ `runningSessionIds`（口径含任意层级运行中的子代理），或该会话裸 `running === true` | 否（运行时） |
 * | b | **新会话** | id ∈ `newSessionIds` **且** 不在 `writtenNewSessionIds` 台账里（已落表 ⇒ 持久顺序已把它放在最前 ⇒ 无需再提升） | 由调用方单独落表（D2） |
 *
 * ## 用户终裁（2026-09-22，第二轮真人 GUI 复验）—— 本函数相对 T5/T9 的**语义收窄**
 *
 * 用户观察到侧栏三段：`刚结束运行的会话 / 当前正在运行的会话 / 其余会话`，前两段**拖不动、
 * 会回弹**，据此终裁：
 *
 * > **正在运行的会话固定在顶部，拖不动，只要是结束了的会话就不再固定置顶了。**
 *
 * 因此本函数**删除**了此前的两类成员：
 * - **「刚结束保留」（`recentlyFinishedSessionIds`）**：已删除。已结束的会话不再固定置顶，
 *   位置完全由持久拖拽顺序决定 ⇒ 它必须可正常拖动（不再被渲染期搬回顶部）。
 * - **「当前打开的会话置顶」（`isCurrent`）**：已删除。用户明确选择**不保留置顶例外** ——
 *   当前会话若不处于运行中，就不置顶，留在其持久顺序位置。
 *
 * 同时删除的还有「拖动释放」机制（`releasedContainerKeys` / `releaseTopZoneContainer` /
 * `isTopZoneReleasingDrag`）：它存在的唯一目的是「拖动容器 ⇒ 清除该容器的刚结束保留」，
 * 而「刚结束保留」本身已删除 ⇒ 释放机制失去全部语义，属死代码。
 *
 * ## 为什么「新会话」不能靠「不在固化表里」判定
 *
 * T4 实测（`docs/RESEARCH-session-drop-to-bottom.md` §3.2）：真实 localStorage 表里
 * AnyWork 容器只固化了 16 条，而有 **6 条可见顶层会话不在表里**，其中**只有 2 条**
 * 晚于固化水位（`2026-09-21T09:01:43Z`），另外 **4 条是旧会话**（水位之前就存在，
 * 只是固化快照本身不完整）。
 *
 * ⇒ 若把「表外会话」一律当新会话置顶，这 4 条旧会话会**错误地跳到最前**。
 * 因此本函数的 `newSessionIds` **由调用方按可靠判据给出**，本函数不做表外推断。
 * 推荐的可靠判据（`sidebar.tsx` 采用）：**本进程内观测到该会话 `blank: true → false`
 * 的转换**（= 用户真的给它发了第一条消息），或**本进程内首次观察到该 id 且它晚于
 * 本进程启动时的固化水位**。两者都要求「时间序」证据，而不是「表里有没有」。
 *
 * ## 排序与去重
 *
 * - 顶部区成员按 {@link sortTopZone}（`updatedAt` 降序）；
 * - 一个会话**最多出现一次**（`Set` 去重），因此「同一会话不得同时出现在多个容器的
 *   顶部区」由「顶部区范围 = 本容器的 `visible` 成员」天然保证（`applyManualOrder`
 *   只会在 `items` 里找到本容器的项）；
 * - 不在本容器 `sessions` 里的 id（归档 / 子代理 / 别的容器）**自然被忽略**。
 *
 * @param sessions 该容器内**已过滤**的可见会话（与 `applyManualOrder` 的 `items` 同一批）。
 * @param currentSessionId 当前打开的会话 id。
 *   ⚠️ **T11 起不再参与任何置顶判定**，仅为**向后兼容**保留签名位置（既有调用方与
 *   `docs/INTERFACES.md` §2.2 的冻结签名）；传入任何值都不改变结果。
 *   ⚠️ 2026-10-22：**当前空白会话**（「新会话」占位行）也**不**在这里置顶 —— 它由
 *   `emitContainer` 用 {@link isCurrentBlankSession} 单独排到最前（与宿主
 *   `sectionMembers` / `pinCurrentBlank` 同语义），本函数仍只负责「运行中 / 未落表新会话」。
 * @param containerKey 本容器的 key。
 *   ⚠️ **T11 起不再被读取**（释放机制已删除），同样仅为签名兼容保留。
 * @param topZone 运行时顶部区输入；缺省 ⇒ **无任何置顶项**（零回归分支）。
 * @returns 置顶 key 数组；无置顶项时返回 `undefined`
 *   （让 `applyManualOrder` 走零回归分支）。
 */
export function topZoneSessionKeys(
  sessions: SessionRowLike[],
  currentSessionId: string | undefined,
  containerKey: string,
  topZone?: TopZoneInput,
): string[] | undefined {
  // T11：`currentSessionId` / `containerKey` 已无语义。显式 `void` 掉，既让 `strict`
  // 下的「未使用参数」意图明确，也留下「这是**有意**保留的兼容位」的痕迹。
  void currentSessionId
  void containerKey

  const keys: string[] = []
  const seen = new Set<string>()
  const push = (key: string | undefined): void => {
    if (key === undefined || seen.has(key)) return
    seen.add(key)
    keys.push(key)
  }

  if (topZone === undefined) return keys.length === 0 ? undefined : keys

  // S2（T6 次要项）：`topZone` 的契约类型是 `TopZoneInput | undefined`（不含 `null`），
  // 但契约外输入（`null` / 字段是数字）会一路走到 `for…of` 抛 `TypeError`。与同函数内
  // 对 id 元素的 `typeof` 守卫风格一致：**静默降级为不置顶**。
  // 真实链路 `sidebar.tsx` 只传 `topZoneInputOf(...)` 的产物，故不可达。
  // （先赋给放宽类型的局部变量，让 `=== null` 这层「契约外输入」检查能通过 `strict`。）
  const zone: TopZoneInput | null = topZone
  if (zone === null || typeof zone !== 'object') return keys.length === 0 ? undefined : keys

  // a）正在运行（含任意层级有运行中的子代理 —— 由调用方按需求 A 的聚合口径给出）。
  // ⚠️ S2：id 列表用 `Array.isArray` 收窄（契约外输入 `42` / `null` 不得抛 `TypeError`），
  // 与「id 元素非字符串则跳过」的守卫同一风格。判据本体在
  // {@link isTopZoneRunningSession} 里（与「不可拖动」共用同一实现）。
  // b）新会话（D2/D3d）。**已落表**的新会话（在 `writtenNewSessionIds` 台账里）**不再**在
  // 渲染期被提升：它的「在容器最前」已由持久顺序承载（D2 落表），渲染期再提升一次会让
  // 用户随后的拖拽被静默回滚（真人 GUI 复验的「拖动新会话弹回原位」缺陷，T9 缺陷 1）。
  // 台账缺省（不传）⇒ 与旧行为逐字一致（仍然提升），保证零回归。
  const done = new Set<string>()
  for (const id of Array.isArray(zone.writtenNewSessionIds) ? zone.writtenNewSessionIds : []) {
    if (typeof id === 'string') done.add(normalizeSessionId(id))
  }
  const fresh = new Set<string>()
  for (const id of Array.isArray(zone.newSessionIds) ? zone.newSessionIds : []) {
    if (typeof id === 'string') fresh.add(normalizeSessionId(id))
  }

  const rest: SessionRowLike[] = []
  for (const session of sessions) {
    const key = normalizeSessionId(session.sessionId)
    // 需求 A 口径：`SessionRowLike.running` 是宿主 `SessionSummary.running` 的**裸**透传
    // （不含子代理聚合），而调用方传的 `runningSessionIds` 是**已聚合**的口径。
    // 两者取并集 ⇒ 「只有 subagent 在跑」的会话也进顶部区。
    // ⚠️ 判据与「不可拖动」共用 {@link isTopZoneRunningSession}（唯一实现，不可能分叉）。
    const isRunning = isTopZoneRunningSession(session, zone)
    // ⚠️ `fresh.has(key) && !done.has(key)`：已落表的新会话不再渲染期提升（见上方台账注释）。
    const isFresh = fresh.has(key) && !done.has(key)
    if (!isRunning && !isFresh) continue
    rest.push(session)
  }
  for (const session of sortTopZone(rest)) push(session.sessionId)

  return keys.length === 0 ? undefined : keys
}

// ────────────────────────────────────────────────────────────────────────────
// 顶部区运行时状态机（T11）—— 纯函数，`sidebar.tsx` 只负责采集与传参
// ────────────────────────────────────────────────────────────────────────────

/**
 * 一次观测里的**单条会话**（顶部区状态机的输入单元）。
 *
 * 由 `src/sidebar.tsx` 从 HTTP 树的**全部**会话（含 blank / 子代理 / 归档）投影出来 ——
 * 必须含 blank 与聚合后的 running：前者用于判定「新会话」（`blank: true → 非 blank` 的
 * 转换），后者用于投影 {@link TopZoneInput.runningSessionIds}（「现在谁在跑」）。
 */
export interface TopZoneObservation {
  sessionId: string
  /**
   * `updatedAt`（宿主 `max(createdAt, lastPromptAt)`）。
   * 用于「首次观测到的会话是否晚于本进程启动」这条**时间序**判据。
   */
  updatedAt: number
  /** 该会话是否仍是空白（还没发过第一条消息）。 */
  blank: boolean
  /** **已聚合**的 running 口径（= `RenderRow.running`：自身 running 或任意层级有运行中子代理）。 */
  running: boolean
  /** 是否子代理（`origin === 'subagent'`）—— 子代理不参与任何顶部区判定。 */
  subagent: boolean
  /** 是否已归档 —— 归档会话不参与任何顶部区判定。 */
  archived: boolean
}

/**
 * 顶部区的**运行时内存状态**（T5）。
 *
 * 生命周期 = 一次页面会话：**刷新即重置**（用户裁决 D3e）。除 D2 的「新会话插入固化表」
 * （那是 `sidebar.tsx` 的写入动作，状态机本身不碰 `localStorage`）外，本状态
 * **绝不写** `localStorage`。
 */
export interface TopZoneState {
  /** 是否已建立基线（本进程首次观测到树数据）。基线之前不产生任何「新会话」。 */
  baselined: boolean
  /** 基线时刻（`Date.now()`）。用于「首次观测到的会话是否晚于本进程启动」。 */
  startedAtMs: number
  /** 本进程**已观测过**的会话 id（归一化）。基线里出现过的旧会话永远不会被判为新会话。 */
  knownSessionIds: readonly string[]
  /** 归一化 id → 上次观测到的 `blank`（仅非子代理、非归档会话）。 */
  blankOf: Readonly<Record<string, boolean>>
  /** 归一化 id → 上次观测到的**聚合** `running`（仅非子代理、非归档会话）。 */
  runningOf: Readonly<Record<string, boolean>>
  /** 「新会话」id（归一化）。D2：它们会被插入固化表（由 `sidebar.tsx` 执行）。 */
  newSessionIds: readonly string[]
  /**
   * **D2 落表台账**：本进程内「落表意图已满足」（已写进固化表，或表首本来就已经是它）的
   * 新会话 id（**归一化**）。由 `sidebar.tsx` 在落表后调 {@link markNewSessionsWritten} 记入。
   *
   * ⚠️ **与 `newSessionIds` 是两个不同的事实**，刻意不合并：
   * - `newSessionIds` 是 **D3d 的顶部区输入** —— 「新会话」这一类要在**渲染期**被提升到容器
   *   顶部区。它在本进程内**不因落表而减少**，否则「用户随后拖走别的会话」时新会话就不再被
   *   提升，D3d 语义被悄悄改掉；
   * - 本字段只回答「D2 这条落表动作还要不要再做一次」。落表后记入 ⇒ 用户随后拖动该新会话
   *   （`manualOrder` 变化 ⇒ 落表 effect 重跑）时 effect **不再改写**持久顺序
   *   （T6 缺陷 B2：落表 effect 在编排层必须**收敛**）。
   */
  writtenNewSessionIds: readonly string[]
}

/** 空状态（首次渲染的初值）。 */
export function initialTopZoneState(): TopZoneState {
  return {
    baselined: false,
    startedAtMs: 0,
    knownSessionIds: [],
    blankOf: {},
    runningOf: {},
    newSessionIds: [],
    writtenNewSessionIds: [],
  }
}

/**
 * 观测一批会话，推进顶部区状态机（**纯函数**；无变化时返回**同一个引用**，
 * 以便 `sidebar.tsx` 直接用于 `useState` 而不触发无限重渲染）。
 *
 * ## 「新会话」判定口径（关键，D2 的边界要求）
 *
 * 满足**任一**条件即判定为新会话（且必须：非子代理、非归档、基线之后）：
 *
 * 1. **强证据 —— 本进程内观测到 `blank: true → false` 的转换**。
 *    宿主语义（`dsh-api-session-controller/.../manager.js`）：新建会话 `blank: true`，
 *    发出第一条 `user/message` 后翻成 `false`。所以「先见 blank、后见非 blank」只能
 *    是「这个会话在本进程观测期间发出了第一条消息」—— 时间序证据，不依赖顺序表。
 * 2. **时间序证据 —— 首次观测到的会话且 `updatedAt >= 本进程基线时刻`**。
 *    覆盖「新建 + 发首条消息发生在两次轮询之间、没观测到 blank 态」的窄窗口。
 *    `updatedAt = max(createdAt, lastPromptAt)` ⇒ 晚于本进程启动的 `updatedAt`
 *    只可能来自「本进程启动后创建 / 本进程启动后发出消息」的会话。
 *
 * ## 为什么**不**用「不在固化顺序表里」
 *
 * T4 实测（`docs/RESEARCH-session-drop-to-bottom.md` §3.2）：真实表里有 **6 条可见顶层
 * 会话不在表里**，其中**只有 2 条**晚于固化水位，另外 **4 条是旧会话**（水位之前就存在，
 * 只是固化快照本身不完整）。若按「表外即新」判定，这 4 条旧会话会被错误地插到最前。
 * 本实现用「基线 + 时间序」双重证据，**基线里出现过的旧会话永远不会被判为新会话**。
 *
 * ## 残余不确定性（如实披露）
 *
 * - 若「创建会话 + 发首条消息」全部发生在**首次树数据到达之前**（页面刚加载的
 *   ~100ms 窗口内），该会话会进入基线 ⇒ 不会被判为新会话（**漏报**）。此时它在
 *   manual 模式下仍会落末尾 —— 但用户重开一次页面后，它已在基线里，属可接受降级。
 * - 若宿主时钟与渲染进程时钟严重不一致（同机场景不可能），时间序判据可能误判。
 * - 若**旧**会话的 `updatedAt` 因故晚于本进程基线（宿主时钟偏差 / `lastPromptAt` 被历史
 *   事件推进），且它在本进程内**首次**出现，则会被判为新会话（**误报**）。同机场景不可能；
 *   已在 `docs/PRD.md`「顶部区」段如实披露（T6 次要项 S3）。
 *
 * ## 归档语义（T6 缺陷 I3，2026-09-21 修正）
 *
 * 「谁算旧会话」与「谁参与顶部区判定」是**两个不同的事实**，本函数刻意分开：
 *
 * - `knownSessionIds`（= `seen`，**含归档与子代理会话**）只回答「这个 id 本进程见过没有」。
 *   归档会话进 `known` ⇒ 即便它之后被取消归档、`updatedAt` 又被推进到基线之后，也**不会**
 *   被判成新会话（否则会把一条**旧**会话插到固化表表首，违反 D5）。
 * - `eligible`（**排除归档与子代理**）只回答「谁参与 blank / running 轨迹与顶部区判定」。
 *   归档会话**不**产生 `blankOf` / `runningOf` 轨迹，**不**进 `newSessionIds`，也不置顶。
 *
 * ⚠️ 宿主**当前没有** unarchive API（`@deepseek-ai/dsh-api-workspace-controller` 只有
 * `archiveSession`），所以「取消归档」这条路径当前不可达；这里仍按正确语义实现，因为
 * 用户手改 `~/.dsh/storages/workspace.json` 或宿主将来提供 API 都会让它可达。
 *
 * ## 其它转换
 *
 * - `running` 轨迹（`runningOf`）逐观测更新，供 {@link topZoneInputOf} 投影
 *   `runningSessionIds` —— 它是顶部区**唯一**的常规成员类别（T11 终裁）。
 * - ⚠️ **T11 已删除**：旧实现在 `running: true → false` 的下降沿写入
 *   `recentlyFinishedIds`（「刚结束保留」），并在出现新会话时清空它。用户终裁
 *   「只要是结束了的会话就不再固定置顶了」⇒ 该机制连同其状态字段一并删除，
 *   `runningOf` 只用于回答「现在谁在跑」。
 *
 * @param state 上一状态。
 * @param observations 本次观测到的全部会话（含 blank / 子代理 / 归档）。
 * @param nowMs 本次观测的时刻（`Date.now()`）；由调用方注入以便单测确定化。
 * @returns 新状态；**无任何变化时返回入参 `state` 本身**。
 */
export function observeTopZone(
  state: TopZoneState,
  observations: readonly TopZoneObservation[],
  nowMs: number,
): TopZoneState {
  const eligible: TopZoneObservation[] = []
  // 「本进程已观测过」的**全部**会话 id（含归档与子代理）—— 与 `eligible` 刻意分开：
  // `eligible` 决定「谁参与顶部区判定」，`seen` 只决定「谁算旧会话」。
  // ⚠️ 归档会话**必须**进 `seen`（T6 缺陷 I3）：否则「基线时已归档、之后取消归档并收到
  // 新消息」的旧会话会被 `firstSeenAfterStart` 判成新会话并写进固化表表首 ⇒ 违反 D5。
  // 归档会话不参与任何**顶部区**判定，但「它存在过」这一事实必须记住。
  const seen = new Set<string>()
  for (const observation of observations) {
    if (typeof observation.sessionId !== 'string' || observation.sessionId === '') continue
    const id = normalizeSessionId(observation.sessionId)
    seen.add(id)
    if (observation.subagent || observation.archived) continue
    eligible.push(observation)
  }

  // ── 基线：本进程首次拿到树数据。把当时已知的全部会话记为「已知」，不产生新会话。
  if (!state.baselined) {
    const known = new Set<string>(seen)
    const blankOf: Record<string, boolean> = {}
    const runningOf: Record<string, boolean> = {}
    for (const observation of eligible) {
      const id = normalizeSessionId(observation.sessionId)
      blankOf[id] = observation.blank === true
      runningOf[id] = observation.running === true
    }
    return {
      baselined: true,
      startedAtMs: nowMs,
      knownSessionIds: [...known],
      blankOf,
      runningOf,
      newSessionIds: [],
      writtenNewSessionIds: state.writtenNewSessionIds,
    }
  }

  const known = new Set(state.knownSessionIds)
  const blankOf: Record<string, boolean> = { ...state.blankOf }
  const runningOf: Record<string, boolean> = { ...state.runningOf }
  const fresh = new Set(state.newSessionIds)

  // 第一遍：判定「新会话」（用**旧**的 blank/known 状态，避免同批次自证）。
  const detectedNew: string[] = []
  for (const observation of eligible) {
    const id = normalizeSessionId(observation.sessionId)
    const previousBlank = blankOf[id]
    const blankedToVisible = previousBlank === true && observation.blank !== true
    const firstSeenAfterStart =
      !known.has(id) && Number.isFinite(observation.updatedAt) && observation.updatedAt >= state.startedAtMs
    if (!blankedToVisible && !firstSeenAfterStart) continue
    if (!fresh.has(id)) detectedNew.push(id)
  }

  // 第二遍：更新 blank / running 轨迹。
  // ⚠️ T11：这里**不再**记录 running 下降沿（「刚结束保留」机制已按用户终裁删除）。
  for (const observation of eligible) {
    const id = normalizeSessionId(observation.sessionId)
    blankOf[id] = observation.blank === true
    runningOf[id] = observation.running === true
    known.add(id)
  }
  for (const id of detectedNew) fresh.add(id)
  // I3：归档 / 子代理会话也记入 `known`（「存在过」这一事实必须记住），但它们
  // 不产生 blank / running 轨迹，也不参与任何顶部区判定。
  for (const id of seen) known.add(id)

  // 无变化 ⇒ 返回同一引用（`useState` 幂等，不触发无限重渲染）。
  //
  // ⚠️ 这里**不能**用 `known.size === state.knownSessionIds.length` 当判据：`known` 只增
  // 不减，但 `state.knownSessionIds` 是数组；用长度比较会在「已知集合不变」时恒等，
  // 看起来没问题 —— 真正的问题是**顺序**：`[...known]` 的插入顺序与旧数组可能不同，
  // 却仍返回旧引用。这里改为逐项比较，保证「引用相同 ⟺ 内容逐字相同」。
  const nextFresh = [...fresh]
  const sameIds = (a: readonly string[], b: readonly string[]): boolean =>
    a.length === b.length && a.every((id, index) => id === b[index])
  const sameRecord = (a: Readonly<Record<string, boolean>>, b: Readonly<Record<string, boolean>>): boolean => {
    const aKeys = Object.keys(a)
    if (aKeys.length !== Object.keys(b).length) return false
    return aKeys.every((key) => b[key] === a[key])
  }
  const unchanged =
    detectedNew.length === 0 &&
    sameIds(nextFresh, state.newSessionIds) &&
    sameIds([...known], state.knownSessionIds) &&
    sameRecord(blankOf, state.blankOf) &&
    sameRecord(runningOf, state.runningOf)
  if (unchanged) return state

  return {
    baselined: true,
    startedAtMs: state.startedAtMs,
    knownSessionIds: [...known],
    blankOf,
    runningOf,
    newSessionIds: nextFresh,
    writtenNewSessionIds: state.writtenNewSessionIds,
  }
}

/**
 * 从 `effectiveOrder` 的会话表里找出某个会话所属的**容器 key**。
 *
 * D2 的写入需要知道「新会话插到哪张表里」。用 `effectiveOrder`（而不是自己重推容器归属）
 * 保证与渲染/固化路径**同源** —— 容器 key 的推导规则全模块只有一处实现。
 *
 * 比较时两侧都做 `session-` 前缀归一化。同一 id 出现在多个容器时取**第一个**
 * （真实链路 `buildProjects` 每个会话只 push 一次，故不可达；此处只为确定性）。
 *
 * @param sessions `effectiveOrder(...).sessions`。
 * @param sessionId 目标会话 id。
 * @returns 容器 key；找不到时 `undefined`。
 */
export function containerKeyOfSession(
  sessions: ReadonlyMap<string, readonly string[]>,
  sessionId: string,
): string | undefined {
  return placementOfSession(sessions, sessionId)?.containerKey
}

/**
 * 某个会话在**树/固化表里的落点**：容器 key + **该会话在表里的真实 id 形态**。
 *
 * ## 为什么必须把「真实形态」也带出来（T6 缺陷 B1 的根因）
 *
 * `observeTopZone` 内部一律用 `normalizeSessionId`（去掉 `session-` 前缀）做比较，所以
 * `TopZoneState.newSessionIds` 里存的是**裸 id**；而宿主真实会话 id 恒带 `session-` 前缀
 * （实测 `~/.dsh/sessions/**` 的会话头 `id = 'session-<uuid>'`，用户真实固化表 54 个条目
 * **全部**带前缀）。`applyManualOrder` 用 `keyOf(item)`（= 树里的真实 id）去 `indexOf`，
 * 于是「把裸 id 写进表」会产生**永远匹配不上的死条目**，并顶掉原本正确的条目。
 *
 * 所以 D2 落表**不能**直接把归一化 id 写进表：必须先用本函数把它还原成**树里的原形态**。
 * 「比较用归一化、写入用原形态」与 {@link normalizeSessionId} 的契约（`仅用于比较，
 * 输出仍用原 id`）逐字一致。
 *
 * @param sessions `effectiveOrder(...).sessions`。
 * @param sessionId 目标会话 id（裸 id / 带前缀 id 都可）。
 * @returns `{ containerKey, sessionId }`；找不到时 `undefined`。
 */
export function placementOfSession(
  sessions: ReadonlyMap<string, readonly string[]>,
  sessionId: string,
): { containerKey: string; sessionId: string } | undefined {
  if (typeof sessionId !== 'string' || sessionId === '') return undefined
  const target = normalizeSessionId(sessionId)
  for (const [containerKey, list] of sessions) {
    for (const id of list) {
      if (normalizeSessionId(id) === target) return { containerKey, sessionId: id }
    }
  }
  return undefined
}

/**
 * D2：把**新会话**插到其所属容器固化顺序表的**最前**（幂等）。
 *
 * 语义与边界（用户裁决 D2 + 任务书的边界要求）：
 * - **只在 `manual === true` 时写入**。默认模式（`manual !== true`）下新会话本来就排最前，
 *   而且**凭空建表会把用户静默切成手动模式** —— 用户明确要自己点一次「恢复默认排序」，
 *   我们绝不代他改这个开关。所以默认模式**返回 `undefined`**（不写、不建表）。
 * - **幂等**：目标会话已在表首 ⇒ 返回 `undefined`（不产生无谓的 `localStorage` 写入）。
 * - **去重**：先把该 id 从列表里全部剔除再插到首位 ⇒ 不产生重复条目。
 * - **不写运行时置顶**：只写这一个新会话，`running` / 新会话提升本身一律**不进表**
 *   （`running` 由 {@link topZoneSessionKeys} 在渲染期推导）。
 * - **不修改入参**：返回新的 {@link ManualOrder} 对象（浅拷贝 + 新数组）。
 * - **写入形态（T6 缺陷 B1）**：写入的字符串必须能被 `applyManualOrder` 的 `keyOf`
 *   （= 树里的真实 id）匹配上。规则（按可信度）：① 表里已有该会话 ⇒ 复用它的原形态
 *   （用户数据是真相）；② 否则 `fullOrder`（= `effectiveOrder` 的产物 = 树里的真实 id）
 *   里有 ⇒ 用树里的形态；③ 都没有 ⇒ 用调用方给的 `sessionId`。绝不写入与树/表形态
 *   不一致的「死条目」。
 *
 * @param order 当前的手动顺序。
 * @param containerKey 目标容器 key（由 {@link containerKeyOfSession} 求得）。
 * @param sessionId 新会话 id（**树里的真实形态**；裸 id 亦可，但表里没有该会话时会按原样写入）。
 * @param fullOrder 该容器的**完整生效顺序**（`effectiveOrder(...).sessions.get(containerKey)`）——
 *   仅当表里还没有这个容器（或表项是**空数组**）时用作基底，避免「只写一条、其余丢失」。
 * @returns 新的 {@link ManualOrder}；**无需写入时返回 `undefined`**。
 */
export function insertSessionAtFront(
  order: ManualOrder,
  containerKey: string,
  sessionId: string,
  fullOrder?: readonly string[],
): ManualOrder | undefined {
  if (order.manual !== true) return undefined
  if (typeof containerKey !== 'string' || containerKey === '') return undefined
  if (typeof sessionId !== 'string' || sessionId === '') return undefined

  // S1（T6 次要项）：表项为**空数组**时 `??` 不触发 ⇒ 会把 `fullOrder` 里的会话全丢掉。
  // 空数组只可能是用户手改 / 旧版本写坏的退化数据（`stringListMapOf` 会丢弃空数组键），
  // 此时按「表里没有这个容器」处理，用 `fullOrder` 作基底 ⇒ 不丢会话。
  const stored = order.sessions?.[containerKey]
  const base = stored !== undefined && stored.length > 0 ? stored : (fullOrder ?? stored ?? [])

  const target = normalizeSessionId(sessionId)
  // B1（T6 缺陷）：写入的字符串必须能被 `applyManualOrder` 的 `keyOf`（= **树里的真实 id**）
  // 匹配上，否则就是一条**永远匹配不上的死条目**，还会顶掉原本正确的条目。三处证据按
  // 可信度排序取「原形态」：① 表里已有该会话（用户数据是真相）→ 用它的写法；
  // ② `fullOrder`（= `effectiveOrder` 的产物 = 树里的真实 id）里有 → 用树里的写法；
  // ③ 都没有（该会话当前不可见）→ 回落到调用方给的 `sessionId`。
  const writtenId =
    base.find((id) => typeof id === 'string' && normalizeSessionId(id) === target) ??
    fullOrder?.find((id) => typeof id === 'string' && normalizeSessionId(id) === target) ??
    sessionId
  const rest = base.filter((id) => typeof id === 'string' && normalizeSessionId(id) !== target)
  const next = [writtenId, ...rest]

  // 幂等：已经在表首且无重复 ⇒ 不写。
  const current = order.sessions?.[containerKey]
  if (
    current !== undefined &&
    current.length === next.length &&
    current.every((id, index) => id === next[index])
  ) {
    return undefined
  }
  return { ...order, manual: true, sessions: { ...(order.sessions ?? {}), [containerKey]: next } }
}

/** {@link planNewSessionInserts} 的产物。 */
export interface NewSessionInsertPlan {
  /** 应用全部可落表插入后的手动顺序（无变化时与入参 `order` **同一引用**）。 */
  order: ManualOrder
  /**
   * 本次「已消费」的新会话 id（**归一化**）—— 调用方应把它们并进
   * {@link TopZoneState.writtenNewSessionIds}。
   *
   * 判据是「落表意图已满足」：写进去了，**或**它本来就在表首（幂等分支）。
   */
  consumed: string[]
  /** 是否真的改动了顺序 ⇒ 调用方需要写 `localStorage`。 */
  changed: boolean
}

/**
 * **D2 落表编排（纯函数）**：把 {@link TopZoneState.newSessionIds} 里尚未消费的新会话
 * 逐个插到其容器固化表最前，并回答「哪些 id 就此消费掉」。
 *
 * ## 为什么需要它（T6 缺陷 B2：编排层必须收敛）
 *
 * `observeTopZone` 的 `newSessionIds` 在本进程内**只增不减**（它是 D3d 的顶部区输入，
 * 不能因为落表就移除）。若 `sidebar.tsx` 每次 effect 重跑都无条件调
 * `insertSessionAtFront`，那么用户**拖动刚建的新会话**（`manualOrder` 变化 ⇒ effect
 * 重跑）时会被**静默搬回表首** —— 用户拖动被回滚、持久顺序被改写。
 *
 * 收敛机制：调用方把本函数返回的 `consumed` 记进
 * {@link TopZoneState.writtenNewSessionIds}，下次 effect 重跑时 `alreadyWritten` 里已有
 * 这些 id ⇒ **不再重放**。于是「同一个新会话的落表只发生一次」；用户随后把它拖到任何
 * 位置都不会被 effect 改写。
 *
 * ## 与 `newSessionIds` 的关系
 *
 * 本函数**不**修改 `newSessionIds`（那是 D3d 的顶部区输入，新会话在整个页面会话内
 * 都应被提升到顶部区）。「落表」与「顶部区提升」是两件事，台账分开记。
 *
 * ## 边界
 *
 * - `order.manual !== true` ⇒ 原样返回、**不消费**（默认模式不写、不建表；D2 原文）。
 * - `alreadyWritten` 里的 id ⇒ 跳过（B2 的收敛点）。
 * - 在 `sessions`（树/生效顺序）里找不到的 id ⇒ **不消费**（它当前不可见，例如仍是
 *   blank 被过滤掉）；等它出现时再落表，不会永久丢失这次 D2 意图。
 * - 落表用 {@link placementOfSession} 得到的**树里真实 id 形态** ⇒ 不会产生死条目（B1）。
 *
 * @param order 当前的手动顺序。
 * @param sessions `effectiveOrder({... , manualOrder: undefined}).sessions`（**纯默认顺序**
 *   的容器划分，与渲染同源）。
 * @param newSessionIds 待落表的新会话 id（`TopZoneState.newSessionIds`，归一化）。
 * @param alreadyWritten 已消费的新会话 id（`TopZoneState.writtenNewSessionIds`，归一化）。
 * @returns 新顺序 + 本次消费的 id + 是否改动。
 */
export function planNewSessionInserts(
  order: ManualOrder,
  sessions: ReadonlyMap<string, readonly string[]>,
  newSessionIds: readonly string[],
  alreadyWritten: readonly string[],
): NewSessionInsertPlan {
  if (order.manual !== true) return { order, consumed: [], changed: false }

  const done = new Set<string>()
  for (const id of alreadyWritten) {
    if (typeof id === 'string' && id !== '') done.add(normalizeSessionId(id))
  }

  const consumed: string[] = []
  let next = order
  let changed = false
  for (const raw of newSessionIds) {
    if (typeof raw !== 'string' || raw === '') continue
    const id = normalizeSessionId(raw)
    // B2：已消费 ⇒ 永不重放（用户拖动该新会话不会被回滚）。
    if (done.has(id)) continue
    const placement = placementOfSession(sessions, id)
    // 不在树里（不可见：仍是 blank / 已归档 / 别的容器）⇒ 本次不消费，等它可见。
    if (placement === undefined) continue
    const inserted = insertSessionAtFront(
      next,
      placement.containerKey,
      placement.sessionId,
      sessions.get(placement.containerKey),
    )
    consumed.push(id)
    if (inserted === undefined) continue
    next = inserted
    changed = true
  }
  return { order: next, consumed, changed }
}

/**
 * **D2 落表台账**：把「落表意图已满足」的新会话 id 记入 {@link TopZoneState.writtenNewSessionIds}。
 *
 * 幂等：全部 id 都已在台账里时返回**同一引用**（不触发无谓重渲染）。
 *
 * ⚠️ 只动 `writtenNewSessionIds`，**不动** `newSessionIds` —— 后者是 D3d 的顶部区输入，
 * 新会话在整个页面会话内都应被提升到容器顶部区。
 *
 * @param state 上一状态。
 * @param sessionIds 本次消费的 id（{@link planNewSessionInserts} 的 `consumed`）。
 * @returns 新状态；无变化时返回入参 `state`。
 */
export function markNewSessionsWritten(state: TopZoneState, sessionIds: readonly string[]): TopZoneState {
  const seen = new Set(state.writtenNewSessionIds)
  const next = [...state.writtenNewSessionIds]
  let changed = false
  for (const id of sessionIds) {
    if (typeof id !== 'string' || id === '') continue
    const key = normalizeSessionId(id)
    if (seen.has(key)) continue
    seen.add(key)
    next.push(key)
    changed = true
  }
  return changed ? { ...state, writtenNewSessionIds: next } : state
}

/**
 * 尚未消费（还没落表 / 还没确认已在表首）的新会话 id（归一化）—— `sidebar.tsx` 的 D2
 * effect 用它决定「这次要不要跑落表」。
 *
 * @param state 顶部区状态。
 * @returns 待落表的 id（顺序 = `newSessionIds` 的顺序）。
 */
export function pendingNewSessionIdsOf(state: TopZoneState): string[] {
  const done = new Set(state.writtenNewSessionIds)
  return state.newSessionIds.filter((id) => typeof id === 'string' && id !== '' && !done.has(normalizeSessionId(id)))
}

/** {@link buildRows} 的入参（与 `docs/INTERFACES.md` §2.2 对齐）。 */
export interface SidebarModelInput {
  /** 项目顺序即宿主 `workspaceRegistry.list()` 的顺序（调用方已排好）。 */
  projects: ProjectNodeLike[]
  ungrouped: SessionRowLike[]
  archivedSessionIds: string[]
  currentSessionId?: string
  /** 节点 key → 是否展开；缺省视为展开。 */
  collapsedKeys: Record<string, boolean>
  /**
   * 旧式「已全部展开」的节点 key 集合（兼容输入：为真 ⇒ 视为无限层级）。
   * 2026-11-14 起 `sidebar.tsx` 恒传 `{}`，改用 {@link SidebarModelInput.expandLevels}。
   */
  expandedAllKeys: Record<string, boolean>
  /** 会话容器 key → 渐进展开层级（2026-11-14 PX1；缺省 / 非法 ⇒ 0）。 */
  expandLevels?: Record<string, number>
  /** 本地过滤查询串（空串 = 不过滤）。 */
  query: string
  /**
   * 浏览器本地的手动排序（D10，2026-09-21）。
   *
   * **可选**（向后兼容：既有调用方不传 ⇒ 行为与改动前逐字一致）。
   * `manual !== true` ⇒ 完全走默认顺序；搜索模式**不应用**手动顺序
   * （见 {@link buildSearchRows}）。
   */
  manualOrder?: ManualOrder
  /**
   * **顶部区**运行时输入（T11，2026-09-22 用户终裁）。
   *
   * **可选**（向后兼容：既有调用方不传 ⇒ 无任何置顶项，逐字零回归）。
   *
   * 由 `src/sidebar.tsx` 从 {@link TopZoneState} 投影而来（`running` 口径必须含
   * 子代理聚合）。⚠️ 它是**纯运行时**输入，**绝不**参与 `effectiveOrder` 的产物
   * （见那里的不变式）—— 只有 D2 的「新会话插入固化表」是单独的写入动作。
   */
  topZone?: TopZoneInput
  /**
   * 是否在末尾追加「最近」分区（2026-10-21 WSR5/WSR6）。
   *
   * **可选**（缺省 / `false` ⇒ 不追加，保证既有针对工作区树行数的单测逐字零回归；
   * `src/sidebar.tsx` 恒传 `true`）。
   */
  includeRecent?: boolean
  /**
   * 已归档工作空间的 `ProjectNode.key` 列表（2026-10-21 WSR1/WSR2 客户端即时过滤）。
   *
   * 传入后，`buildRows` / `effectiveOrder` / `buildRecentRows` / 搜索都会排除这些工作空间
   * 及其下属会话 —— 即使宿主进程尚未重启，前端点击「归档工作空间」也能立即从侧栏消失。
   */
  archivedProjectKeys?: readonly string[]
  /** 会话标题解析（宿主 title 投影缺失时兜底）。 */
  titleOf: (s: SessionRowLike) => string
  t: Translate
}

/** 一个「会话容器」：worktree / history / 平铺项目 / 未分组 / 最近。 */
interface ContainerSpec {
  /** 容器自身的 key，也是其会话行的 `parentKey`。 */
  key: string
  kind: 'worktree' | 'history' | 'project' | 'recent'
  /** 容器内会话行的基础深度（平铺项目为 1，worktree / history 为 2）。 */
  depth: number
  sessions: SessionRowLike[]
  /** 所属项目（未分组为 undefined）。 */
  project?: ProjectNodeLike
  /** 所属 worktree（history / 平铺项目 / 未分组为 undefined）。 */
  worktree?: WorktreeNodeLike
}

/** 一个项目的容器划分。 */
interface ProjectContainers {
  project: ProjectNodeLike
  /** 项目行的 key：`p:<projectKey>`。 */
  projectKey: string
  /** 是否产生 worktree 子行（**所有 git 项目**，含单 worktree；D11 2026-09-21 修订）。 */
  hasWorktreeRows: boolean
  /** worktree 容器（保持宿主传入顺序；仅 hasWorktreeRows 时非空）。 */
  worktrees: Array<{ node: WorktreeNodeLike; spec: ContainerSpec }>
  /** 平铺项目自身的会话容器（**仅非 git 工作区**；git 项目一律走 worktree 子行）。 */
  flat?: ContainerSpec
  /**
   * history 容器（**有可见成员**时存在，判据与 `emitContainer` 同源；见
   * {@link isVisibleMember}）。仅 `history.length > 0` 不够：那样会在
   * 「history 全是 blank 且非当前 / 全归档」时建出一个空容器行。
   */
  history?: ContainerSpec
}

/** {@link emitContainer} 需要的共享上下文。 */
interface EmitContext {
  archived: ReadonlySet<string>
  collapsedKeys: Record<string, boolean> | undefined
  expandedAllKeys: Record<string, boolean> | undefined
  expandLevels: Record<string, number> | undefined
  currentSessionId: string | undefined
  titleOf: (s: SessionRowLike) => string
  t: Translate
  /** 运行中的子代理后代数索引（原生 `runningSubagentCount`；见 {@link indexRunningSubagentDescendants}）。 */
  subagentRunningCounts: SubagentRunningCounts
  /**
   * 浏览器本地的手动排序（D10）。`undefined` / `manual !== true` ⇒ 完全走默认顺序。
   *
   * ⚠️ **搜索模式不读它**（见 {@link buildSearchRows}）—— 这里只服务树。
   */
  manualOrder: ManualOrder | undefined
  /**
   * 顶部区运行时输入（T11）。`undefined` ⇒ **无任何置顶项**（零回归）。
   *
   * ⚠️ **搜索模式不读它**（与「搜索不应用手动顺序」一致；见 {@link buildSearchRows}）。
   */
  topZone: TopZoneInput | undefined
}

/** 一个容器的推导结果：行序列 + 顶层会话计数。 */
interface ContainerResult {
  rows: RenderRow[]
  sessionCount: number
  runningCount: number
  pendingCount: number
  /**
   * **该容器内是否有任务正在运行（含运行中的子代理）**（2026-10-20）。
   *
   * 用**截断前**的 `heads` 计算（折叠 / 5 条截断 / 视口外都不影响），且与会话行的
   * `running` 同源（同一 `subagentRunningCounts` 索引 + 同一 `subagentCountOf` 查询）。
   * `history` 桶也会算，但按 RT2 **不消费**（history 行不设该字段）。
   * `flat`（普通会话）容器会被 project 行消费（2026-10-20 追加裁决）。
   */
  hasRunningTasks: boolean
  /**
   * 若折叠会隐藏的顶层会话数（= `truncateSessions(heads, …).hiddenCount`）。
   * `0` ⟺ 没有 more 行（容器不超过 `COLLAPSED_SESSION_LIMIT` 条顶层会话）；
   * `expandedAll === true` 时它仍是真实值（此时行没被隐藏，但 more 行照常产出）。
   */
  hiddenCount: number
}

/**
 * 归一化会话 id：去掉宿主可能带的 `session-` 前缀。
 *
 * 宿主持久层存在 `session-<uuid>` 与裸 `<uuid>` 两种写法，比较父 id 前必须归一化，
 * 否则子代理会误判为「父不在组内」。**仅用于比较**，输出仍用原 id。
 */
function normalizeSessionId(id: string): string {
  return id.startsWith(SESSION_ID_PREFIX) ? id.slice(SESSION_ID_PREFIX.length) : id
}

/** `blank === true` 判定；用 `unknown` 入参以便对 `T extends { sessionId: string }` 生效。 */
function isBlank(row: unknown): boolean {
  return typeof row === 'object' && row !== null && (row as { blank?: unknown }).blank === true
}

/**
 * 是否是子代理会话（`origin === 'subagent'`）。
 *
 * 对齐原生 `sessionVisible` 的第一项 `session.origin !== "subagent"`。注意判据是 `origin`
 * 而**不是** `parentSessionId`：「派生会话」（fork）也会写 `parentSession`
 * （`dsh-session` 的 `SessionStore.fork`），但它不是子代理，原生照常渲染成顶层行。
 *
 * 本函数只回答「是不是子代理」；**唯一的会话可见性谓词**是 {@link isVisibleMember}，
 * 它把本判定与归档 / blank 规则合在一起，树与搜索都只走它。
 */
function isSubagentSession(session: { origin?: string }): boolean {
  return session.origin === 'subagent'
}

/**
 * 「运行中的子代理后代」计数索引：会话 id（已归一化）→ 运行中的子代理后代数（所有层级）。
 *
 * 语义与原生 `runningSubagentCount`（`dsh-client-ui-workspace/lib/client.js` 的
 * `indexSubagentDescendants`，`:285-306`）一致：
 * `counts.get(P)` = 满足「从 P 出发、中间节点全是子代理」的路径上 `running` 的子代理个数。
 *
 * 等价形式（原生的逐层向上累加）：对每个 `running` 的子代理，沿 `parentSessionId` 一路
 * 向上走到**第一个非子代理祖先**为止，每经过一个祖先就 +1。
 *
 * 索引是**全局**的（跨容器），与原生的 `list.byId` 一致：子代理会继承父会话的 cwd，正常
 * 情况下两者同容器；即便漂移到别的容器，父行的计数仍与原生相同。
 */
export type SubagentRunningCounts = ReadonlyMap<string, number>

/** {@link indexRunningSubagentDescendants} 需要的最小字段集。 */
interface Lineage {
  sessionId: string
  parentSessionId?: string
  origin?: string
  running?: boolean
}

/**
 * 用 `nestSubagents` 解出「父 → 子代」边（**不动点迭代**）。
 *
 * 为什么需要迭代：`nestSubagents` 的契约只展开**一层** —— 深度 ≥2 的后代会被展平为
 * `depth: 0`（见它的单测「父自己是子代理 ⇒ 孙平铺为 depth 0」）。而本次要修的正是
 * 「计数只数直接子代」这个错，所以深层边必须补齐：把「本轮识别出的子代」与「本轮仍是
 * 根、但父在集合内且尚未归属」的会话放进下一轮，直到某一轮不再产生新边为止。
 *
 * 终止性：边按 `(父, 子)` 去重且最多 `n²` 条，配合「本轮无新边即停」必然收敛。
 *
 * 顺带复用 `nestSubagents` 的 id 归一化（`session-` 前缀）与「父必须在集合内」判定，
 * 使父子关系的解析规则全模块只有一处实现。
 */
function discoverChildEdges<T extends Lineage>(sessions: T[]): Map<string, T[]> {
  const inSet = new Set<string>()
  for (const session of sessions) inSet.add(normalizeSessionId(session.sessionId))

  const edges = new Map<string, T[]>()
  const edgeKeys = new Set<string>()
  const attributed = new Set<string>()

  let frontier = sessions
  while (frontier.length > 0) {
    const nested = nestSubagents(frontier)
    const next: T[] = []
    const roots: T[] = []
    let added = false
    let head: T | undefined
    for (const entry of nested) {
      if (entry.depth === 0) {
        head = entry.session
        roots.push(entry.session)
        continue
      }
      const parent = head
      if (parent === undefined) continue
      const parentKey = normalizeSessionId(parent.sessionId)
      const childKey = normalizeSessionId(entry.session.sessionId)
      const edgeKey = `${parentKey}\u0000${childKey}`
      if (!edgeKeys.has(edgeKey)) {
        edgeKeys.add(edgeKey)
        attributed.add(childKey)
        added = true
        const bucket = edges.get(parentKey)
        if (bucket === undefined) edges.set(parentKey, [entry.session])
        else bucket.push(entry.session)
      }
      next.push(entry.session)
    }
    // 被展平的更深后代：本轮是根，但父在集合内 ⇒ 下一轮它才可能被正确挂上。
    for (const root of roots) {
      const parentId = root.parentSessionId
      if (parentId === undefined) continue
      const rootKey = normalizeSessionId(root.sessionId)
      if (attributed.has(rootKey)) continue
      if (!inSet.has(normalizeSessionId(parentId))) continue
      next.push(root)
    }
    if (!added) break
    frontier = next
  }

  // 兜底：`nestSubagents` 对**环 / 自指**（脏数据）选择软失败 —— 环上成员都留在根集合里，
  // 于是上面拿不到边。真实数据不可能出现（会话只能由已存在的父会话创建，父子关系构成森林），
  // 但这里仍把这类关系补成边，好让下面的累加与原生 `indexSubagentDescendants` 逐例一致
  // （原生直接读 `parentId`，不看嵌套结果）。
  for (const session of sessions) {
    const childKey = normalizeSessionId(session.sessionId)
    const parentId = session.parentSessionId
    if (parentId === undefined) continue
    const parentKey = normalizeSessionId(parentId)
    if (!inSet.has(parentKey)) continue
    const edgeKey = `${parentKey}\u0000${childKey}`
    if (edgeKeys.has(edgeKey)) continue
    edgeKeys.add(edgeKey)
    const bucket = edges.get(parentKey)
    if (bucket === undefined) edges.set(parentKey, [session])
    else bucket.push(session)
  }
  return edges
}

/**
 * 建「运行中的子代理后代数」索引（所有层级），见 {@link SubagentRunningCounts}。
 *
 * 累加过程是原生 `indexSubagentDescendants`（`dsh-client-ui-workspace/lib/client.js:285-306`）
 * 的**逐字移植** —— 对每个**子代理**会话，沿父链一路向上、每经过一个父节点就 +1，直到
 * 当前节点不再是子代理 / 没有父 / 遇到已访问节点（`seen` 环保护）为止：
 *
 * ```js
 * let current = descendant
 * while (current?.origin === "subagent" && current.parentId !== undefined && !seen.has(current.id)) {
 *   seen.add(current.id)
 *   indexed[current.parentId].runningCount += 1   // 仅在 descendant.running 时
 *   current = summaries[current.parentId]
 * }
 * ```
 *
 * 父子关系来自 {@link discoverChildEdges}（内部走 `nestSubagents`），因此 id 前缀归一化与
 * 全模块同源。
 *
 * @param sessions 参与索引的全部会话（跨容器；重复 id 会被去重）。
 * @returns 归一化会话 id → 运行中的子代理后代数。**每个入参会话都有键**（没有运行中的
 *   子代理后代时为 `0`）。⚠️ 键是**归一化**后的 id（`session-` 前缀已去掉）——
 *   查询请一律走 {@link subagentCountOf}（它内部归一化），不要直接 `get(原始 id)`。
 */
export function indexRunningSubagentDescendants<T extends Lineage>(
  sessions: T[],
): Map<string, number> {
  const edges = discoverChildEdges(sessions)
  const parentOf = new Map<string, string>()
  const byKey = new Map<string, T>()
  const counts = new Map<string, number>()
  for (const session of sessions) {
    const key = normalizeSessionId(session.sessionId)
    if (!byKey.has(key)) byKey.set(key, session)
    // 预置 0：所有入参会话都有键（见 JSDoc 的返回契约）。
    if (!counts.has(key)) counts.set(key, 0)
  }
  for (const [parentKey, children] of edges) {
    for (const child of children) {
      const childKey = normalizeSessionId(child.sessionId)
      if (!parentOf.has(childKey)) parentOf.set(childKey, parentKey)
    }
  }

  // 按**去重后**的会话遍历（原生的 `byId` 是 Map ⇒ 同 id 只累加一次）。
  for (const session of byKey.values()) {
    if (!isSubagentSession(session)) continue
    const seen = new Set<string>()
    let currentKey = normalizeSessionId(session.sessionId)
    let current: T | undefined = byKey.get(currentKey)
    while (current !== undefined && isSubagentSession(current) && !seen.has(currentKey)) {
      const parentKey = parentOf.get(currentKey)
      if (parentKey === undefined) break
      seen.add(currentKey)
      if (session.running === true) counts.set(parentKey, (counts.get(parentKey) ?? 0) + 1)
      currentKey = parentKey
      current = byKey.get(parentKey)
    }
  }
  return counts
}

/** 查索引（缺键视为 0）。 */
function subagentCountOf(counts: SubagentRunningCounts, sessionId: string): number {
  return counts.get(normalizeSessionId(sessionId)) ?? 0
}

/**
 * 入参里出现过的**全部**会话（含归档、blank、子代理；跨所有容器），用于 {@link
 * indexRunningSubagentDescendants}。
 *
 * 口径与原生 `indexSubagentDescendants(list.byId)` 相同 —— 那是一个**未过滤**的扁平表。
 * 若只用可见成员建索引，父会话被归档（或子代理漂到另一个容器）时父行的计数会少算，
 * 与原生不一致。
 */
/**
 * 「全部会话」的最小来源（{@link allSessionsOf} 只需要这三项）。
 *
 * 抽成结构类型是为了让 {@link observationsOf} 也能吃**原始树数据**
 * （`src/sidebar.tsx` 的 `TreeResponse`）—— 顶部区观测只需要树，不需要
 * `collapsedKeys` / `query` / `t` 这些渲染期入参。
 */
export interface TopZoneObservationSource {
  projects: ProjectNodeLike[]
  ungrouped: SessionRowLike[]
  archivedSessionIds: string[]
}

function allSessionsOf(source: TopZoneObservationSource): SessionRowLike[] {
  const all: SessionRowLike[] = []
  for (const project of source.projects) {
    for (const node of project.worktrees) all.push(...node.sessions)
    all.push(...project.history)
    all.push(...project.flatSessions)
  }
  all.push(...source.ungrouped)
  return all
}

/**
 * 把 {@link SidebarModelInput} 投影成顶部区状态机的观测批次（T5，**纯函数**）。
 *
 * 为什么要这一层：顶部区状态机需要**每条会话**的 `blank` / **聚合** `running` /
 * `subagent` / `archived`，而 `sidebar.tsx` 只有原始树数据。把投影放在这里（而不是
 * `.tsx` 里手写循环）⇒ 投影口径可被 `node --test` 覆盖，`sidebar.tsx` 的改动退化为
 * 「调用一个纯函数 + `useState`」。
 *
 * ⚠️ **`running` 用聚合口径**（= `RenderRow.running`，含任意层级运行中的子代理后代）：
 * D3a 明确要求「任意层级有 running subagent」也算运行中。裸的 `session.running` 会让
 * 「只有 subagent 在跑」的会话漏出顶部区 —— 这正是 T4 §4.4 指出的缺口。
 *
 * ⚠️ 观测批次必须**含归档与子代理会话**：状态机要靠「某 id 一直是子代理 / 一直归档」
 * 把它们排除，且它们的 `running` 要参与子代理聚合索引（`indexRunningSubagentDescendants`
 * 本身就是未过滤口径）。
 *
 * ## N1/I3 真实链路修复（T9，2026-09-22）
 *
 * **缺陷**：`buildProjects`（`src/projects.ts` 的 `:400` / `collectUngrouped` 的 `:480`）
 * 已经把**归档会话从树里剔除**，所以树数据里根本没有归档会话 —— 而本函数此前只从树
 * （`allSessionsOf`）取会话 ⇒ 归档会话**从未进过观测批次** ⇒ `observeTopZone` 的
 * `seen` 里没有它们 ⇒ 「基线时已归档、之后取消归档并收到新消息」的**旧**会话会被
 * `firstSeenAfterStart` 判成新会话并写进固化表表首（违反 D5）。
 * T7 的单测 fixture 把归档会话**同时**放进树和 `archivedSessionIds`，与真实链路**不同构**
 * ⇒ 那条用例是**恒真测试**（T8 实测真实链路下 `newSessionIds = ['oldarch']`）。
 *
 * **修复**：把 `source.archivedSessionIds` **单独投影**成 `archived: true` 的观测
 * （见下方 `archivedIds` 循环），使 `seen` 覆盖归档会话。这些观测：
 * - **进 `known`**（「存在过」的事实必须记住 ⇒ 取消归档后不误判新会话）；
 * - **不产生** `blankOf` / `runningOf` 轨迹，**不参与**顶部区判定（`observeTopZone`
 *   里 `observation.archived` 被跳过）。
 *
 * `updatedAt` 对归档 id 未知（归档会话不在树里，没有宿主摘要）⇒ 填 `0`（有限值，
 * 不会因此被时间序判据选中；且 `archived` 为真时本就不会进入新会话判定）。
 *
 * @param input 与 `buildRows` 同一份入参。
 * @returns 每条输入会话一条观测（顺序 = `allSessionsOf` 的顺序），**后接**归档 id 观测。
 */
export function observationsOf(source: TopZoneObservationSource): TopZoneObservation[] {
  const archived = new Set(source.archivedSessionIds)
  const counts = indexRunningSubagentDescendants(allSessionsOf(source))
  const observations: TopZoneObservation[] = []
  const seen = new Set<string>()
  for (const session of allSessionsOf(source)) {
    if (typeof session.sessionId !== 'string' || session.sessionId === '') continue
    const key = normalizeSessionId(session.sessionId)
    // 同一 id 只产出一条观测（真实链路不会重复；这里保证确定性）。
    if (seen.has(key)) continue
    seen.add(key)
    observations.push({
      sessionId: session.sessionId,
      updatedAt: Number.isFinite(session.updatedAt) ? session.updatedAt : 0,
      blank: isBlank(session),
      // 与 `toSessionRow` 的 `running` 同式 ⇒ 「只有 subagent 在跑」也算运行中（D3a）。
      running: session.running === true || subagentCountOf(counts, session.sessionId) > 0,
      subagent: isSubagentSession(session),
      archived: archived.has(session.sessionId),
    })
  }
  // ── N1/I3：归档会话**不在树里**（`buildProjects` 已剔除）⇒ 必须从独立通道补投影 ──
  // 真实链路形态：`archivedSessionIds` 来自 `~/.dsh/storages/workspace.json` 的
  // `global.archivedSessionIds`（实测 173 条，全部带 `session-` 前缀），树里**不含**它们。
  // 补投影后 `observeTopZone` 的 `seen` 才真正覆盖归档会话（I3 的修复点）。
  for (const raw of source.archivedSessionIds) {
    if (typeof raw !== 'string' || raw === '') continue
    const key = normalizeSessionId(raw)
    if (seen.has(key)) continue
    seen.add(key)
    observations.push({
      sessionId: raw,
      updatedAt: 0,
      blank: false,
      running: false,
      subagent: false,
      archived: true,
    })
  }
  return observations
}

/**
 * 把 {@link TopZoneState} 投影成渲染期用的 {@link TopZoneInput}（T5，**纯函数**）。
 *
 * `runningSessionIds` 直接从观测轨迹（`runningOf`）里取 —— 它就是**聚合后**的口径
 * （见 {@link observationsOf}），与 `RenderRow.running` 同源。
 *
 * @param state 顶部区状态机状态。
 * @returns 渲染期输入（全部为归一化 id）。
 */
export function topZoneInputOf(state: TopZoneState): TopZoneInput {
  const runningSessionIds: string[] = []
  for (const [id, running] of Object.entries(state.runningOf)) {
    if (running === true) runningSessionIds.push(id)
  }
  return {
    runningSessionIds,
    newSessionIds: state.newSessionIds,
    // T9 缺陷 1：把落表台账一并投影进渲染期输入 —— 已落表的新会话不再被渲染期提升，
    // 否则用户把它拖到分组内其他位置后会被搬回原位（真人 GUI 复验的「弹回」缺陷）。
    writtenNewSessionIds: state.writtenNewSessionIds,
  }
}

/** 是否被折叠（`true` 才算；缺省 / 无表都视为展开，与原生一致）。 */
function isCollapsed(keys: Record<string, boolean> | undefined, key: string): boolean {
  return keys !== undefined && keys[key] === true
}

/** 会话排序：`updatedAt` 降序，同值按 `sessionId` 升序（确定性 tiebreak）。 */
function byRecency<T extends { sessionId: string; updatedAt: number }>(a: T, b: T): number {
  if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt
  if (a.sessionId === b.sessionId) return 0
  return a.sessionId < b.sessionId ? -1 : 1
}

/** 拷贝后排序（不改入参）。 */
function sortedByRecency<T extends { sessionId: string; updatedAt: number }>(sessions: T[]): T[] {
  return [...sessions].sort(byRecency)
}

/**
 * 「最近」分区的排序键：`max(updatedAt, 有限的 lastActivityAt)`（2026-10-29 RAS1/RAS4）。
 *
 * - `lastActivityAt` 缺失 / 非有限数字 ⇒ 回退 `updatedAt`（与 WSR6 旧行为逐字一致）。
 * - `lastActivityAt` 比 `updatedAt` 旧 ⇒ 仍取 `updatedAt`（不降低排序键）。
 * - `updatedAt` 本身非法 ⇒ 该边按 `0` 处理，保证结果恒为有限数字。
 *
 * ⚠️ **只有**「最近」分区使用本函数；工作区树 / 顶部区 / 手动顺序不得消费它。
 */
export function recentActivityOf(session: { updatedAt: number; lastActivityAt?: number }): number {
  const updatedAt = Number.isFinite(session.updatedAt) ? session.updatedAt : 0
  const lastActivityAt =
    typeof session.lastActivityAt === 'number' && Number.isFinite(session.lastActivityAt)
      ? session.lastActivityAt
      : 0
  return Math.max(updatedAt, lastActivityAt)
}

/** 「最近」分区排序：最后更新时间降序，同值按 `sessionId` 升序（确定性 tiebreak）。 */
function byRecentActivity<T extends { sessionId: string; updatedAt: number; lastActivityAt?: number }>(
  a: T,
  b: T,
): number {
  const delta = recentActivityOf(b) - recentActivityOf(a)
  if (delta !== 0) return delta
  if (a.sessionId === b.sessionId) return 0
  return a.sessionId < b.sessionId ? -1 : 1
}

/** 路径 basename（同时接受 `/` 与 `\`，忽略尾分隔符）。 */
function basenameOf(path: string | undefined): string {
  if (path === undefined) return ''
  const trimmed = path.replace(/[/\\]+$/, '')
  const separator = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return trimmed.slice(separator + 1)
}

/** 会话显示标题：blank 与空标题都退化为 `session.new`（原生 `displayTitle` 语义）。 */
function sessionLabelOf(
  session: SessionRowLike,
  titleOf: (s: SessionRowLike) => string,
  t: Translate,
): string {
  if (isBlank(session)) return t('session.new')
  // `titleOf` 的**契约签名**是 `=> string`，但运行时会返回 `undefined` / `null`
  // （`SessionRowLike.title` 本身可选，最自然的实现就是 `(s) => s.title`），
  // 因此按 `unknown` 收窄：非字符串（含 undefined / null / 数字）一律回退，
  // 纯空白标题也回退。返回值**保证**是 string（§2.2 冻结的 `RenderRow.label: string`）。
  const raw: unknown = titleOf(session)
  return typeof raw === 'string' && raw.trim() !== '' ? raw : t('session.new')
}

/**
 * 单节点截断：保留**输入顺序**里的前 `limit` 条非 blank 会话（逐字对齐原生
 * `collapsedSessionRows` 的「前 N 条」部分）。
 *
 * 行为：
 * - `blank === true` 的会话始终保留且**不占**名额（原生：`if (session.blank) return true`）；
 * - 其余会话按输入顺序保留前 `limit` 条（原生：`ordinaryCount >= limit ⇒ false`）；
 * - `limit <= 0` 按 0 处理（只留 blank 的）；
 * - `hiddenCount = sessions.length - visible.length`（原生同式）。
 *
 * ⚠️ **T13（2026-09-22 用户终裁）：本函数不再接受 `currentSessionId`。**
 * 曾经存在的「当前会话保底进前 limit 条」（`promote` 分支）已**整体删除**：它在 T11
 * 删除 `isCurrent` 置顶后变成**可达**，使「把当前会话拖到第 6 位之后」出现**视觉零位移**
 * （持久表已变、渲染未变 —— 与用户投诉的首要缺陷同形）。用户裁决「**拖拽顺序完全优先**」，
 * 并明确接受副作用（当前会话若被截断到不可见，就是看不见）。
 *
 * 调用方（{@link emitContainer}）因此**只**按顺序截断，不再传任何「当前会话」线索 ——
 * 渲染层对已结束会话的位置**完全**由持久拖拽顺序决定。调用方若还想让某条会话必进可见区，
 * 唯一正当途径是**渲染期置顶**（{@link topZoneSessionKeys} → `applyManualOrder` 的
 * `pinnedKeys`，运行中 / 尚未落表的新会话），那是**先于**截断生效的另一机制。
 *
 * @param sessions 输入会话（**不被修改**，返回的是同一批引用）。
 * @param limit 每个容器的非 blank 可见上限；非有限值按 0 处理。
 * @returns 可见会话（保持输入顺序）与被隐藏条数。
 */
export function truncateSessions<T extends { sessionId: string }>(
  sessions: T[],
  limit: number,
): { visible: T[]; hiddenCount: number } {
  const quota = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0

  const visible: T[] = []
  let ordinary = 0
  for (let i = 0; i < sessions.length; i += 1) {
    const session = sessions[i]
    if (isBlank(session)) {
      visible.push(session)
      continue
    }
    if (ordinary < quota) {
      visible.push(session)
      ordinary += 1
    }
  }

  return { visible, hiddenCount: sessions.length - visible.length }
}

/**
 * 子代理折叠：`parentSessionId` 指向**同组内**存在的父会话时挂为子行（深度 +1）。
 *
 * 规则：
 * - 顶层会话 `depth: 0`，直接子代理 `depth: 1`；不支持更深嵌套；
 * - 兜底：父会话不在本组内、父会话就是自己、或父会话**自己也是子代理**时，该会话
 *   平铺为 `depth: 0`（不凭空多缩进，也不丢）；
 * - 父 id 与候选父 id 都先做 `session-` 前缀归一化后再比较（输出仍是原对象）；
 * - 输出顺序：每个顶层会话后面紧跟它的子代理，子代理之间保持输入顺序；
 * - 环（A→B→A）软失败：环上成员按顶层处理，不抛错、不丢行（同原生 `flattenLineage`）。
 *
 * @param sessions 同一容器内的会话（**不被修改**）。
 * @returns 从容器根部展平的 `{ session, depth }` 序列。
 */
export function nestSubagents<
  T extends { sessionId: string; parentSessionId?: string; origin?: string },
>(sessions: T[]): Array<{ session: T; depth: number }> {
  const byNormalizedId = new Map<string, T>()
  for (const session of sessions) {
    const key = normalizeSessionId(session.sessionId)
    if (!byNormalizedId.has(key)) byNormalizedId.set(key, session)
  }

  const childMemo = new Map<T, boolean>()
  const visiting = new Set<T>()

  /** 该会话是否是「挂在某个 depth 0 父会话下的子代」。 */
  const isChild = (session: T): boolean => {
    const cached = childMemo.get(session)
    if (cached !== undefined) return cached
    if (visiting.has(session)) return false
    const parentId = session.parentSessionId
    if (parentId === undefined) return false
    const parent = byNormalizedId.get(normalizeSessionId(parentId))
    if (parent === undefined || parent === session) return false
    visiting.add(session)
    const parentIsChild = isChild(parent)
    visiting.delete(session)
    const result = !parentIsChild
    childMemo.set(session, result)
    return result
  }

  const childrenOf = new Map<T, T[]>()
  const roots: T[] = []
  for (const session of sessions) {
    if (isChild(session)) {
      const parent = byNormalizedId.get(normalizeSessionId(session.parentSessionId ?? ''))
      if (parent === undefined) {
        roots.push(session)
        continue
      }
      const siblings = childrenOf.get(parent)
      if (siblings === undefined) childrenOf.set(parent, [session])
      else siblings.push(session)
    } else {
      roots.push(session)
    }
  }

  const flattened: Array<{ session: T; depth: number }> = []
  for (const root of roots) {
    flattened.push({ session: root, depth: 0 })
    const children = childrenOf.get(root)
    if (children === undefined) continue
    for (const child of children) flattened.push({ session: child, depth: 1 })
  }
  return flattened
}

/** 把项目节点划分成若干会话容器（顺序即渲染顺序，不含展开态判断）。 */
function containersOfProject(project: ProjectNodeLike, context: EmitContext): ProjectContainers {
  const projectKey = `p:${project.key}`
  // D11（2026-09-21 用户决策变更）：**git 项目一律产生 worktree 子行**，单 worktree 也
  // 不再平铺 —— `+`（新建会话）必须落在 worktree 行上，项目行只留 `…`。
  // `flat` 容器因此**只留给非 git 工作区**（它的会话直接挂项目行下）。
  const hasWorktreeRows = project.isGit === true

  const worktrees: Array<{ node: WorktreeNodeLike; spec: ContainerSpec }> = []
  if (hasWorktreeRows) {
    for (const node of project.worktrees) {
      worktrees.push({
        node,
        spec: {
          key: `w:${node.path}`,
          kind: 'worktree',
          depth: 2,
          sessions: node.sessions,
          project,
          worktree: node,
        },
      })
    }
  }

  const result: ProjectContainers = {
    project,
    projectKey,
    hasWorktreeRows,
    worktrees,
  }
  if (!hasWorktreeRows) {
    // 非 git 工作区：会话平铺在项目行下（`flatSessions`）。此容器**不带** `worktree`：
    // 非 git 工作区没有 worktree，也就没有分支名可搜（搜索 haystack 自然为空）。
    result.flat = {
      key: projectKey,
      kind: 'project',
      depth: 1,
      sessions: project.flatSessions,
      project,
    }
  }
  // history 容器行的**存在性必须与子行同源**：只用 `project.history.length > 0`
  // 会在「history 里全是 blank 且非当前」时建出一个 `sessionCount = 0` 的空容器行。
  // 所以先过一遍与 `emitContainer` 完全相同的可见性判定（同一个 `isVisibleMember`）。
  if (hasVisibleMembers(project.history, context)) {
    result.history = {
      key: `h:${project.key}`,
      kind: 'history',
      depth: 2,
      sessions: project.history,
      project,
    }
  }
  return result
}

/** 未分组容器（复用 project 行表达；见 {@link UNGROUPED_KEY}）。 */
function ungroupedContainer(input: SidebarModelInput): ContainerSpec {
  return {
    key: `p:${UNGROUPED_KEY}`,
    kind: 'project',
    depth: 1,
    sessions: input.ungrouped,
  }
}

/**
 * 单条会话是否在容器里可见 —— **唯一的会话可见性谓词**，逐字对齐原生 `sessionVisible`：
 *
 * ```js
 * session.origin !== "subagent" && !archived.has(session.id) && (!session.blank || session.id === current)
 * ```
 *
 * 三处调用者全部走它，因此不可能再出现「树里滤了、搜索里忘了」这类分叉：
 * - `containersOfProject` —— 判断 history 容器该不该建；
 * - `visibleMembers` —— 树上真正的会话行；
 * - `collectSearchCandidates` —— 搜索候选。
 *
 * 注意 `isCurrent` **不**因此豁免：当前会话若本身是子代理，它同样不渲染（原生亦然）。
 * ⚠️ **T13**：`currentSessionId` 在本文件里**只**服务四件事 —— ① 本谓词的「blank 会话豁免」；
 * ② {@link toSessionRow} 的 `isCurrent` 行高亮；③ {@link topZoneSessionKeys} 的**兼容形参位**
 * （函数体已 `void` 掉，行为中性）；④ **2026-10-22 DR4**：{@link isCurrentBlankSession}
 * 用它把「新会话」占位行排到容器最前、并由 {@link isSessionDragLocked} 锁住拖拽。
 * 它**不**影响截断（`truncateSessions` 已无该参数，D12 保底已删除），也**不**参与
 * 「普通会话」的置顶判定。
 *
 * 本谓词**不**参与需求 A 的 `running` 聚合：子代理行被过滤掉之后，其 `running` 已经
 * 通过 {@link indexRunningSubagentDescendants} 汇总进父行的 `subagentCount`
 * （见 {@link toSessionRow}）。
 */
/**
 * 判断某会话是否是当前打开的会话（`session-` 前缀归一化比较，2026-10-21 WSR3 / AC3）。
 */
function isCurrentSession(sessionId: string, currentSessionId: unknown): boolean {
  if (typeof sessionId !== 'string' || sessionId === '') return false
  if (typeof currentSessionId !== 'string' || currentSessionId === '') return false
  const a = normalizeSessionId(sessionId)
  const b = normalizeSessionId(currentSessionId)
  return a !== '' && a === b
}

function isVisibleMember(session: SessionRowLike, context: EmitContext): boolean {
  return (
    !isSubagentSession(session) &&
    !context.archived.has(session.sessionId) &&
    (!isBlank(session) || isCurrentSession(session.sessionId, context.currentSessionId))
  )
}

/** 容器的显示过滤（谓词见 {@link isVisibleMember}）。 */
function visibleMembers(spec: ContainerSpec, context: EmitContext): SessionRowLike[] {
  return spec.sessions.filter((session) => isVisibleMember(session, context))
}

/**
 * 容器是否**有可见成员**（=「该不该建容器行」的唯一判据）。
 *
 * 不变式：`hasVisibleMembers(x, ctx)` 为真 ⟺ `emitContainer` 会产出至少一条子行
 * （`sessionCount > 0` 或至少一条 `more` 行，因为 `hiddenCount > 0` 也蕴含可见成员非空）。
 */
function hasVisibleMembers(sessions: SessionRowLike[], context: EmitContext): boolean {
  return sessions.some((session) => isVisibleMember(session, context))
}

/** 造一个 `session` 行。 */
function toSessionRow(
  session: SessionRowLike,
  depth: number,
  subagentCount: number,
  spec: ContainerSpec,
  context: EmitContext,
): RenderRow {
  const keyPrefix = spec.kind === 'recent' ? 'rs:' : 's:'
  const base = {
    kind: 'session' as const,
    key: `${keyPrefix}${session.sessionId}`,
    sessionId: session.sessionId,
    label: sessionLabelOf(session, context.titleOf, context.t),
    depth,
    updatedAt: session.updatedAt,
    // 需求 A（2026-09-21）：主 agent 空闲、但有**运行中的子代理后代**时，父行状态点同样
    // 是「运行中」—— 对齐原生 `sessionStatuses`（`dsh-client-ui-workspace/lib/client.js`
    // 的 `if (subagents !== void 0) return [subagents]`：`runningSubagentCount > 0` ⇒
    // 主状态点就是 ongoing）。原实现只读会话自己的 summary ⇒ 此场景退化成灰色 idle。
    //
    // `subagentCount` 就是原生 `runningSubagentCount`（所有层级的**运行中**子代理后代数，
    // 见 {@link indexRunningSubagentDescendants}），所以这里不需要任何新数据源。
    // 放在本函数（而不是各调用点）⇒ 树（`emitContainer`）与搜索（`buildSearchRows`）
    // 两条路径自动同源，不可能「树里改了、搜索里忘了」。
    running: session.running === true || subagentCount > 0,
    completed: session.completed === true,
    blank: isBlank(session),
    subagentCount,
    isCurrent: isCurrentSession(session.sessionId, context.currentSessionId),
    parentKey: spec.key,
    parentKind: spec.kind,
  }
  return session.pendingInteraction === undefined
    ? base
    : { ...base, pendingInteraction: session.pendingInteraction }
}

/**
 * 渐进式截断（2026-11-14 PX1–PX3）：顶层会话 ≤ 5 ⇒ 全部可见、无 more 行；否则按展开层级
 * 显示前 {@link visibleSessionLimit} 条（blank 不计名额，同 {@link truncateSessions}），
 * 层级 > 0 或仍有剩余时产出一条 more 行。旧式 `expandedAllKeys[key] === true` 视为无限层级。
 */
function truncateByLevel(
  heads: SessionRowLike[],
  key: string,
  context: EmitContext,
  parentKind: 'worktree' | 'history' | 'project' | 'recent' = 'project',
  depth = 1,
): { selected: SessionRowLike[]; hiddenCount: number; more?: RenderRow } {
  if (heads.length <= COLLAPSED_SESSION_LIMIT) return { selected: heads, hiddenCount: 0 }
  const legacyAll = context.expandedAllKeys?.[key] === true
  const level = expandLevelOf(context.expandLevels, key)
  const truncated = legacyAll
    ? { visible: heads, hiddenCount: 0 }
    : truncateSessions(heads, visibleSessionLimit(level))
  const canCollapse = legacyAll || level > 0
  if (truncated.hiddenCount === 0 && !canCollapse) return { selected: truncated.visible, hiddenCount: 0 }
  return {
    selected: truncated.visible,
    hiddenCount: truncated.hiddenCount,
    more: {
      kind: 'more',
      key: `m:${key}`,
      parentKey: key,
      parentKind,
      hiddenCount: truncated.hiddenCount,
      nextCount: nextExpandCount(level, truncated.hiddenCount),
      canCollapse,
      depth,
    },
  }
}

/**
 * 推导一个容器的行：过滤 → 排序 → 5 条截断 → more 行。
 *
 * 计数只统计**顶层会话**（= 已过滤掉子代理后的可见会话），且**不**受截断影响
 * （原生 `sessionCount: g.sessions.length` 在截断之前）。
 *
 * more 行的存在性只取决于「容器是否真的超过 `COLLAPSED_SESSION_LIMIT` 条**顶层**会话」：
 * 超过 ⇒ 一定有 more 行（`expandedAll` 时也有，用于「收起」）；不超过 ⇒ 一定没有。
 * `hiddenCount` 恒为 `truncateSessions(heads, …).hiddenCount`（折叠时隐藏的条数），
 * 与当前是否 `expandedAll` 无关 —— 它是渲染层「展开其余 {n} 个」的 n 的来源。
 */
function emitContainer(spec: ContainerSpec, context: EmitContext): ContainerResult {
  // 过滤已排除 `origin === 'subagent'`（`isVisibleMember`）⇒ 这里全部是顶层会话，
  // 不再需要 `nestSubagents` 折叠子行。子代理只以 `subagentCount` 胶囊的形式出现在父行上。
  //
  // 顺序：**先默认排序（updatedAt 降序），再叠加手动顺序**（D10）。次序不能颠倒 ——
  // `applyManualOrder` 把「不在手动列表里的会话」按**传入顺序**追加到末尾，所以传入的
  // 必须是已按 `updatedAt` 排好的序列，新会话才会落在末尾而不是乱序。
  //
  // ── 顶部区（T11，2026-09-22 用户终裁）────────────────────────────────────
  // 每个容器内，**正在运行**的会话（自身 running 或任意层级有运行中的子代理）被提到
  // **本容器最前**，且**先于**下面的 5 条截断生效。⚠️ 措辞准确化（T13 的 N-6）：
  // 「先于截断生效」**不**等于「一定可见」—— 顶部区成员超过 `COLLAPSED_SESSION_LIMIT`
  // 条时（例如 6 条并发运行中的会话），超出的部分**仍会被截断**（有意行为，由
  // `T5/截断: 顶部区成员数 > 5 时，只有前 5 条可见` 锁定）。
  //
  // ⚠️ 用户终裁删除了此前的两类成员：「刚结束保留」与「当前会话置顶」。
  // 已结束的会话（含用户正在查看的旧会话、含刚跑完的会话）**不再固定置顶** —— 位置完全
  // 由持久拖拽顺序（`manualOrder`）决定，因此它们**必须可正常拖动**。
  // 唯一保留的额外成员是「尚未落表的新会话」（D2/D3d），判据与排序全在
  // {@link topZoneSessionKeys} 里，本函数不再自己判断。
  //
  // ── 占位行（2026-10-22 DR4，用户复验「复用空白会话」后的追加缺陷）──────────────
  // **当前打开的空白会话**（=「新会话」占位行）恒在本容器**最前**，且先于顶部区与截断：
  // 用户点 `+` 之后第一眼必须看到自己正在写的那条。判据在
  // {@link isCurrentBlankSession}，与宿主 `sectionMembers` / `pinCurrentBlank` 同语义。
  // 该行**不起拖**（{@link isSessionDragLocked}），因此「固定最前」不会出现「拖完弹回」。
  //
  // ⚠️ 顶部区 / 占位行都**不写 localStorage**（`effectiveOrder` 刻意不传任何置顶）；只有
  // D2 的「新会话插入固化表」是 `sidebar.tsx` 的独立写入动作。
  const visible = visibleMembers(spec, context)
  const placeholder = visible.find((session) => isCurrentBlankSession(session, context.currentSessionId))
  const pinnedKeys = [
    ...(placeholder === undefined ? [] : [placeholder.sessionId]),
    ...(topZoneSessionKeys(visible, context.currentSessionId, spec.key, context.topZone) ?? []),
  ]
  const heads = applyManualOrder(
    sortedByRecency(visible),
    sessionOrderOf(context.manualOrder, spec.key),
    (session) => session.sessionId,
    pinnedKeys,
  )
  // 截断在手动顺序**之后**：手动排到前面的会话必须能进前 `COLLAPSED_SESSION_LIMIT` 条，
  // 否则用户拖了却看不见（PRD D10 验收）。
  const truncation = truncateByLevel(heads, spec.key, context, spec.kind, spec.depth)
  const selected = truncation.selected
  const hiddenCount = truncation.hiddenCount

  const rows: RenderRow[] = selected.map((session) =>
    toSessionRow(
      session,
      spec.depth,
      subagentCountOf(context.subagentRunningCounts, session.sessionId),
      spec,
      context,
    ),
  )
  if (truncation.more !== undefined) rows.push(truncation.more)

  return {
    rows,
    sessionCount: heads.length,
    runningCount: heads.filter((session) => session.running === true).length,
    pendingCount: heads.filter((session) => session.pendingInteraction !== undefined).length,
    // 2026-10-20 运行中任务高亮（RT1）：**截断前**的 `heads`，聚合口径与
    // `toSessionRow` 的 `running` **逐字同源**（同一索引、同一 helper）。
    // 只有子代理在跑时 `runningCount` 仍为 0，但这里为 true —— 有意为之，见
    // `RenderRow` 的 JSDoc 与 `docs/INTERFACES.md` §2.2.1。
    hasRunningTasks: heads.some(
      (session) =>
        session.running === true ||
        subagentCountOf(context.subagentRunningCounts, session.sessionId) > 0,
    ),
    hiddenCount,
  }
}

/** worktree 行的 label / sublabel（分支名优先，无分支用目录 basename）。 */
function worktreeLabels(node: WorktreeNodeLike, t: Translate): { label: string; sublabel?: string } {
  const base = basenameOf(node.path)
  const label = node.branch !== undefined && node.branch !== '' ? node.branch : base
  return label === base ? { label } : { label, sublabel: base }
}

/**
 * 从项目 `key` 解出 workspaceId —— **仅非 git 工作区**（key 形态为 `ws:<workspaceId>`）。
 *
 * 存在的理由：**非 git 工作区的 `worktrees` 恒为空数组**（`buildProjects` 的 `'flat'` 分支
 * 不建 worktree 节点），所以它的工作区 id 既不在任何 worktree 节点上，也只能从 key 解出。
 * 这是渲染层「在该工作区新建会话」（非 git 行 hover 的 `+`）**唯一**的 id 来源 ——
 * 漏掉它，那一行的 `+` 会因为 `workspaceId === undefined` 而根本不渲染。
 *
 * git 项目的 key 是 commonDir，本函数恒返回 `undefined`（它的 id 要从 worktree 节点取）。
 *
 * 导出以便单测覆盖（`src/sidebar.tsx` 是 `.tsx`，不进 `lib/`，逻辑无法被 `node --test` 直接测）。
 */
export function workspaceIdFromProjectKey(key: string): string | undefined {
  return key.startsWith('ws:') ? key.slice('ws:'.length) : undefined
}

/** project 行的 path / workspaceId（非 git 工作区才有 path）。 */
function projectIdentity(project: ProjectNodeLike): { path?: string; workspaceId?: string } {
  const identity: { path?: string; workspaceId?: string } = {}
  const workspaceId = workspaceIdFromProjectKey(project.key)
  if (workspaceId !== undefined) identity.workspaceId = workspaceId
  if (project.isGit !== true) {
    const path = project.mainPath ?? project.flatSessions[0]?.cwd
    if (path !== undefined) identity.path = path
  }
  return identity
}

/** 搜索模式下的一条候选会话。 */
interface SearchCandidate {
  session: SessionRowLike
  spec: ContainerSpec
  /** 运行中的子代理后代数（用于 `subagentCount`，原生 `runningSubagentCount`）。 */
  subagentCount: number
}

/**
 * 收集搜索候选：所有容器里的**所有**可见会话（不过滤展开态、不截断）。
 *
 * 可见性走与树**同一个** {@link isVisibleMember} ⇒ 子代理（`origin === 'subagent'`）
 * 与归档会话一样搜不到，不存在「树里滤了、搜索里忘了」的分叉。
 *
 * 匹配源（大小写不敏感子串）：会话标题（blank 用 `session.new`）、所属项目名、
 * 所属 worktree 的分支名 / 路径 basename / worktree 标题（即工作区名，PRD D20）、
 * 会话 cwd 的 basename（未分组会话的主要上下文）。
 */
/** 过滤掉被客户端或服务端标记为已归档的工作空间。 */
function activeProjectsOf(input: SidebarModelInput): ProjectNodeLike[] {
  const keys = input.archivedProjectKeys
  if (!Array.isArray(keys) || keys.length === 0) return input.projects
  const archived = new Set<string>()
  for (const key of keys) {
    if (typeof key === 'string' && key !== '') {
      archived.add(key)
      if (key.startsWith('p:')) archived.add(key.slice(2))
    }
  }
  if (archived.size === 0) return input.projects
  return input.projects.filter((project) => !archived.has(project.key))
}

function collectSearchCandidates(
  input: SidebarModelInput,
  query: string,
  context: EmitContext,
): SearchCandidate[] {
  const specs: ContainerSpec[] = []
  for (const project of activeProjectsOf(input)) {
    const containers = containersOfProject(project, context)
    for (const entry of containers.worktrees) specs.push(entry.spec)
    if (containers.flat !== undefined) specs.push(containers.flat)
    if (containers.history !== undefined) specs.push(containers.history)
  }
  if (hasVisibleMembers(input.ungrouped, context)) specs.push(ungroupedContainer(input))

  const candidates: SearchCandidate[] = []
  const seen = new Set<string>()
  for (const spec of specs) {
    const members = visibleMembers(spec, context)
    const projectName = spec.project?.title ?? ''
    const worktreeHaystacks =
      spec.worktree === undefined
        ? []
        : [spec.worktree.branch ?? '', basenameOf(spec.worktree.path), spec.worktree.title ?? '']
    for (const session of members) {
      if (seen.has(session.sessionId)) continue
      const haystacks = [
        sessionLabelOf(session, input.titleOf, input.t),
        projectName,
        basenameOf(session.cwd),
        ...worktreeHaystacks,
      ]
      const hit = haystacks.some((text) => text.toLowerCase().includes(query))
      if (!hit) continue
      seen.add(session.sessionId)
      candidates.push({
        session,
        spec,
        subagentCount: subagentCountOf(context.subagentRunningCounts, session.sessionId),
      })
    }
  }
  return candidates
}

/** 搜索模式：扁平输出匹配到的会话行（`depth: 0`，保留真实归属），按最近更新排序。 */
function buildSearchRows(
  input: SidebarModelInput,
  context: EmitContext,
  query: string,
): RenderRow[] {
  const candidates = collectSearchCandidates(input, query, context)
  // **搜索模式刻意不应用手动顺序**（D10）：搜索结果按 `updatedAt` 降序更自然 ——
  // 用户搜一个词是为了找最近用过的那个，而不是找回自己上个月拖出来的位置；
  // 且手动顺序是**容器内**的相对顺序，跨容器的扁平结果里没有它成立的前提。
  // 这条与「树模式应用手动顺序」的差异是有意为之，已写入 `docs/INTERFACES.md` §2.3。
  candidates.sort((a, b) => byRecency(a.session, b.session))
  return candidates.map((candidate) =>
    toSessionRow(candidate.session, 0, candidate.subagentCount, candidate.spec, context),
  )
}

/**
 * 一次「重新排序」的结果：三层各自的**完整**顺序（不截断、不折叠）。
 *
 * 渲染层拖拽落点时用它：把「当前完整顺序 + 落点」交给 {@link reorderKeys} 得到新顺序，
 * 再写进 {@link ManualOrder}。**必须用完整顺序而不是渲染行** —— 容器折叠时它的会话行
 * 根本不存在，5 条截断还会砍掉尾部；用渲染行算会让「第 6 条之后」的顺序在每次拖拽时
 * 被截断成只剩可见的那几条。
 */
export interface EffectiveOrder {
  /** 顶层项目顺序（`ProjectNode.key`，**不含**未分组）。 */
  projects: string[]
  /** 项目 key → 该项目内 worktree 路径顺序（`WorktreeNode.path`）。 */
  worktrees: Map<string, string[]>
  /** 容器 key → 该容器内**可见**会话的 sessionId 顺序（未截断）。 */
  sessions: Map<string, string[]>
}

/**
 * 取三层各自的**完整生效顺序**（默认顺序 + 已应用的手动顺序）。
 *
 * 与 {@link buildRows} 走**同一批**内部函数（`containersOfProject` / `visibleMembers` /
 * {@link sortedByRecency} / {@link applyManualOrder}），因此不可能与树里看到的顺序分叉 ——
 * 这是本函数存在的全部理由（容器 key 的推导规则只有一处实现）。
 *
 * 与 `buildRows` 的两处**有意**差异：
 * - **不应用折叠与 5 条截断**：返回的是每个容器的全部可见成员（见 {@link EffectiveOrder}）；
 * - **不产出未分组行**：`projects` 里没有 `UNGROUPED_KEY`（它不是真实项目，§2.6 裁定 1），
 *   但未分组的**会话**照常进 `sessions`（键 = `p:${UNGROUPED_KEY}`）。
 *
 * ⚠️ **第三处有意差异（T11，2026-09-22 用户终裁）**：本函数**不应用任何运行时顶部区**。
 * 顶部区是**纯运行时推导**（由会话此刻是否在跑、以及新会话是否已落表决定），而本函数的输出
 * 正是 `commitDrag` 首次拖拽时**全量固化进 `localStorage`** 的那份顺序
 * （`src/sidebar.tsx` 的 `commitDrag`：`effectiveOrder({ ...treeInput, manualOrder: undefined })`）。
 * 若这里也应用顶部区，就会把「运行时置顶」变成「持久化钉在第 1 位」—— 用户关掉那个会话后
 * 它仍赖在最前面，且持久顺序被污染。所以本函数把 `context.topZone` **硬置 `undefined`**，
 * 返回的永远是「不含任何运行时置顶的真实顺序」。**这是被测试锁定的不变式**
 * （见 `test/tree-model.test.mjs` 的 `effectiveOrder` 持久化用例）。
 *
 * `input.manualOrder` 缺省或 `manual !== true` 时，返回的就是**纯默认顺序** ——
 * 这正是「首次拖拽时固化全量顺序」所需要的输入。
 *
 * @param input 与 `buildRows` 同一份入参。
 * @returns 三层的完整生效顺序。
 */
export function effectiveOrder(input: SidebarModelInput): EffectiveOrder {
  const context: EmitContext = {
    archived: new Set(input.archivedSessionIds),
    collapsedKeys: input.collapsedKeys,
    expandedAllKeys: input.expandedAllKeys,
    expandLevels: input.expandLevels,
    currentSessionId: input.currentSessionId,
    titleOf: input.titleOf,
    t: input.t,
    subagentRunningCounts: new Map(),
    manualOrder: input.manualOrder,
    // ⚠️ T5/T11：`effectiveOrder` **刻意不传 `topZone`** —— 与「不把运行时状态写进持久
    // 顺序」同一不变式，且这里连 `context.topZone` 都置 `undefined`，从结构上杜绝
    // 「运行时顶部区混进持久顺序」。
    topZone: undefined,
  }

  const order = (
    members: SessionRowLike[],
    containerKey: string,
  ): string[] =>
    // ⚠️ T11：这里**刻意不传**任何置顶 key —— 本函数的产物是首次拖拽时固化进
    // `localStorage` 的顺序，运行时顶部区绝不能进持久化（见函数 JSDoc 的第三处差异）。
    applyManualOrder(
      sortedByRecency(visibleMembers({ key: containerKey, kind: 'worktree', depth: 0, sessions: members }, context)),
      sessionOrderOf(input.manualOrder, containerKey),
      (session) => session.sessionId,
    ).map((session) => session.sessionId)

  const activeProjects = activeProjectsOf(input)
  const manualProjects = input.manualOrder?.manual === true ? input.manualOrder.projects : undefined
  const projects = applyManualOrder(activeProjects, manualProjects, (project) => project.key).map(
    (project) => project.key,
  )

  const worktrees = new Map<string, string[]>()
  const sessions = new Map<string, string[]>()
  for (const project of activeProjects) {
    const containers = containersOfProject(project, context)
    const paths = applyManualOrder(
      containers.worktrees,
      worktreeOrderOf(input.manualOrder, project.key),
      (entry) => entry.node.path,
    ).map((entry) => entry.node.path)
    if (paths.length > 0) worktrees.set(project.key, paths)
    for (const entry of containers.worktrees) {
      sessions.set(entry.spec.key, order(entry.spec.sessions, entry.spec.key))
    }
    if (containers.flat !== undefined) {
      sessions.set(containers.flat.key, order(containers.flat.sessions, containers.flat.key))
    }
    if (containers.history !== undefined) {
      sessions.set(containers.history.key, order(containers.history.sessions, containers.history.key))
    }
  }
  if (hasVisibleMembers(input.ungrouped, context)) {
    const spec = ungroupedContainer(input)
    sessions.set(spec.key, order(spec.sessions, spec.key))
  }

  return { projects, worktrees, sessions }
}

/**
 * 把「被拖项 + 落点」换算成新的顺序列表（**纯函数**）。
 *
 * 语义与原生 `commitSessionDrag` 的可见项算法一致：
 * 1. 从当前列表里**摘掉**被拖项；
 * 2. 找到落点项在「摘掉之后」的下标；
 * 3. `before` ⇒ 插在它前面；`after` ⇒ 插在它后面。
 *
 * @param keys 当前**完整**顺序（默认顺序 + 已应用的手动顺序）。
 * @param draggedId 被拖项的 id。
 * @param overId 落点项的 id。
 * @param half 落点在行的上半（`before`）还是下半（`after`）。
 * @returns 新顺序；**无需改动**时返回 `null`（落点就是自己 / 已在原位 / 落点不在列表里）。
 *   返回 `null` 而不是原数组，是为了让调用方区分「拖了但没变化」与「真的重排了」——
 *   前者不该把 `manual` 置 true（否则用户只是原地抖一下鼠标就永久切到手动排序了）。
 */
export function reorderKeys(
  keys: string[],
  draggedId: string,
  overId: string,
  half: 'before' | 'after',
): string[] | null {
  if (draggedId === overId) return null
  const sourceIndex = keys.indexOf(draggedId)
  if (sourceIndex === -1) return null
  const withoutSource = keys.filter((key) => key !== draggedId)
  const overIndex = withoutSource.indexOf(overId)
  // 落点不在列表里（理论上不会发生：`over` 来自已渲染的行）⇒ 不动。
  if (overIndex === -1) return null
  const insertAt = half === 'before' ? overIndex : overIndex + 1
  // 已在原位 ⇒ 不产生「看似变化其实没变」的写入。
  if (insertAt === sourceIndex) return null
  const next = [...withoutSource]
  next.splice(insertAt, 0, draggedId)
  return next
}

/**
 * 把**持久手动顺序表**与「当前默认顺序」对齐（2026-10-22 DR6）。
 *
 * 规则（与渲染期 `applyManualOrder` 的表外项语义**逐字一致**）：
 * 1. 表内项保持原相对顺序（含**当前不可见**的项 —— 归档会话/归档工作区的槽位因此不丢，
 *    取消归档后回到原位）；
 * 2. 表外项按 `defaults` 的顺序**追加到末尾**（渲染期正是这样画的）；
 * 3. 去重（同一 key 只认第一次出现）、忽略非字符串/空串；
 * 4. 纯函数：不修改入参，返回新数组。
 *
 * 为什么需要它（缺陷背景）：`manualOrder` 是**首次拖拽时固化的快照**，之后新增的工作区 /
 * worktree / 会话都不在表里。`commitDrag` 旧实现直接拿持久表做 `reorderKeys`，而
 * `reorderKeys` 对「拖拽源不在表里」与「落点不在表里」都返回 `null` ⇒ **整次拖拽静默无效**
 * （用户看到的「拖不动 / 松手没反应」）。先对齐再换算，就能让新增项照常参与排序。
 *
 * @param order 持久表里的该层顺序（可能缺项 / 为空 / undefined）。
 * @param defaults 当前默认顺序（`effectiveOrder` 的产物，与渲染同源）。
 * @returns 对齐后的完整顺序（新数组）。
 */
export function reconcileManualOrder(
  order: readonly string[] | undefined,
  defaults: readonly string[],
): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of order ?? []) {
    if (typeof raw !== 'string' || raw === '' || seen.has(raw)) continue
    seen.add(raw)
    out.push(raw)
  }
  for (const key of defaults) {
    if (typeof key !== 'string' || key === '' || seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }
  return out
}

/**
 * **拖拽换算的唯一入口**（2026-10-22 DR6，替代 `commitDrag` 里直接调 `reorderKeys`）。
 *
 * = `reorderKeys(reconcileManualOrder(order, defaults), draggedId, overId, half)`：
 * 先把持久表与当前默认顺序对齐（补齐表外的新增项），再计算新顺序。
 *
 * 语义与 `reorderKeys` 逐字一致：拖到自己身上、已在原位、找不到落点 ⇒ `null`（不写表，
 * 不把用户「原地抖一下」误变成持久改动）。
 *
 * @param order 持久表里的该层顺序（手动模式）；`undefined` = 非手动 ⇒ 直接用默认顺序。
 * @param defaults 该层当前默认顺序（`effectiveOrder` 的产物）。
 * @param draggedId 拖拽源 id（树里的真实形态，不带容器前缀）。
 * @param overId 落点 id（同上）。
 * @param half 落点在目标之前 / 之后。
 * @returns 新的顺序；无需改动 ⇒ `null`。
 */
export function reorderManualScope(
  order: readonly string[] | undefined,
  defaults: readonly string[],
  draggedId: string,
  overId: string,
  half: 'before' | 'after',
): string[] | null {
  return reorderKeys(reconcileManualOrder(order, defaults), draggedId, overId, half)
}

/**
 * 把树模型摊平成渲染行序列（已应用展开态、5 条截断、搜索过滤）。纯函数。
 *
 * 渲染顺序：
 * ```
 * [project 行]
 *   [worktree 行]        ← git 项目逐个（含单 worktree；保持宿主顺序）
 *     [session 行] …     ← depth 2
 *     [more 行]          ← 仅当被截断
 *   [history 行]         ← 仅当 project.history 有**可见成员**（非空且过滤后非空）
 *     [session 行] …     ← depth 2
 *     [more 行]
 * [下一个 project 行]
 * …
 * [未分组行]              ← 仅当 ungrouped 有**可见成员**时（project 行形态，key = `p:${UNGROUPED_KEY}`）
 *   [session 行] …       ← depth 1
 *   [more 行]
 * ```
 *
 * **没有会话行是子代理**：`origin === 'subagent'` 的会话在任何容器里都不产生行
 * （原生 `sessionVisible`），它们只通过父行的 `subagentCount` 胶囊体现。
 *
 * 关键约束：
 * - D11（2026-09-21 修订）：**git 项目**（`isGit === true`）恒产生 worktree 子行，
 *   会话挂 worktree 行下（`parentKind: 'worktree'`、`depth: 2`）；只有**非 git 工作区**
 *   才平铺，会话直接挂 project 行下（`parentKind: 'project'`、`depth: 1`）；
 * - 展开态：`collapsedKeys[key] === true` 才折叠（缺省展开）；
 * - 每个会话容器各自独立应用 `truncateSessions(…, COLLAPSED_SESSION_LIMIT)`；
 *   容器内顶层会话数 `<= COLLAPSED_SESSION_LIMIT` ⇒ **不产生** more 行（没东西可折叠）；
 *   ⚠️ **T13**：截断**只**按传入顺序取前 N 条，**不再**为「当前会话」做任何保底 ——
 *   已结束会话的位置完全由持久拖拽顺序决定（见 {@link truncateSessions} 的 JSDoc）；
 * - `expandedAllKeys[容器key] === true` 且容器**确实超过** `COLLAPSED_SESSION_LIMIT` 条时：
 *   全量输出该容器会话，**仍产出恰好一条** more 行，且其 `hiddenCount` 保留真实值
 *   （=「若折叠会隐藏多少条」，即 `truncateSessions(...).hiddenCount`）—— 这条 more 行是
 *   用户回到折叠态的**唯一入口**（PRD US4「点击后全部展开，变为收起」）。渲染层按
 *   `expandedAllKeys[parentKey] === true` 取 `sessions.collapse`，否则取
 *   `sessions.expand`（契约 §2.6 裁定 2：more 行**无** label，取词在渲染层）；
 * - `expandedAllKeys[容器key] !== true` 且被截断 ⇒ 前 `COLLAPSED_SESSION_LIMIT` 条 + 一条
 *   more 行，`hiddenCount` = 隐藏条数（`truncateSessions` 的真实结果）；
 * - 子代理在任何容器里都不出现；归档会话也不出现；blank 会话只显示当前那一条且不占名额；
 * - **父行状态点含子代理（需求 A，2026-09-21）**：`row.running = 该会话自己的 running ||
 *   subagentCount > 0`（对齐原生 `sessionStatuses` 的 `runningSubagentCount > 0 ⇒ ongoing`）。
 *   多层链（depth 3）由 {@link indexRunningSubagentDescendants} 一并累加到顶层可见行；
 *   子代理全不跑且自身空闲 ⇒ 仍是 `idle`（`running: false`）。**树与搜索两条路径同源**
 *   （判据写在 {@link toSessionRow} 里）。`runningCount` 的口径**不变**（仍只数
 *   `session.running`）—— 渲染层无消费者，本次不动（用户裁决 Q1）；
 * - **顶部区（T11，2026-09-22 用户终裁）**：每个容器内，**正在运行**的会话（自身
 *   `running` **或** 任意层级有运行中的子代理）排在本容器**最前**（先于 5 条截断生效，
 *   但**顶部区成员超过 `COLLAPSED_SESSION_LIMIT` 条时，超出的仍会被截断** —— 见
 *   `T5/截断: 顶部区成员数 > 5 时，只有前 5 条可见`），并按 `updatedAt` 降序排列；
 *   它们**不可拖动**（拖拽接线在 `sidebar.tsx` 层不给这些行安装）。
 *   **尚未落表的新会话**同样进入顶部区（D2/D3d）。
 *   ⚠️ 已结束的会话（含用户正在查看的旧会话、含刚跑完的会话）**不再固定置顶** ——
 *   位置完全由持久拖拽顺序决定，且**必须可正常拖动**。「刚结束保留」与「当前会话置顶」
 *   两个机制已按用户终裁**删除**（见 {@link topZoneSessionKeys}）。
 *   顶部区是**纯运行时推导**，**不写进 `localStorage`**（{@link effectiveOrder} 刻意不应用）；
 * - `query.trim()` 非空 ⇒ 扁平模式：只输出会话行（`depth: 0`），不应用展开态、截断与顶部区
 *   （搜索结果跨容器，容器内相对顺序无意义）；
 * - **手动顺序（D10，2026-09-21）**：`input.manualOrder` 且 `manual === true` 时，三层
 *   各自在**默认排序之后、截断之前**叠加手动顺序（{@link applyManualOrder}）：
 *   项目按 `projects`（键 = `ProjectNode.key`）、worktree 按 `worktrees[projectKey]`
 *   （键 = `WorktreeNode.path`，**只在同一项目内**）、会话按 `sessions[容器key]`
 *   （键 = `sessionId`，**只在同一容器内**）。列表外的新项按默认顺序追加到末尾；
 *   已消失的项被忽略。**搜索模式不应用**（见 {@link buildSearchRows}）。
 *   `manualOrder` 缺省或 `manual !== true` ⇒ 与不传逐字一致（零回归）；
 * - 纯函数：不修改任何入参（排序前先拷贝）。
 *
 * @param input 侧栏模型入参（见 {@link SidebarModelInput}）。
 * @returns 渲染行序列；搜索无匹配时返回空数组（渲染层据此显示 `search.empty`）。
 */
export function buildRows(input: SidebarModelInput): RenderRow[] {
  const archived = new Set(input.archivedSessionIds)
  const context: EmitContext = {
    archived,
    collapsedKeys: input.collapsedKeys,
    expandedAllKeys: input.expandedAllKeys,
    expandLevels: input.expandLevels,
    currentSessionId: input.currentSessionId,
    titleOf: input.titleOf,
    t: input.t,
    // 索引建立在**全部**输入会话上（含归档与 blank），与原生的 `list.byId` 同口径 ——
    // 子代理被隐藏后，父行仍要如实显示「有几个子代理在跑」，不因父/子归档状态而漏计。
    subagentRunningCounts: indexRunningSubagentDescendants(allSessionsOf(input)),
    manualOrder: input.manualOrder,
    topZone: input.topZone,
  }
  const query = (typeof input.query === 'string' ? input.query : '').trim().toLowerCase()
  if (query !== '') return buildSearchRows(input, context, query)

  // ── 项目层手动顺序（D10）────────────────────────────────────────────
  // `applyManualOrder` 的「列表外项保持传入顺序追加到末尾」正是这里要的语义：
  // `input.projects` 已是宿主 `workspaceRegistry.list()` 的顺序，新项目自然落到末尾。
  const activeProjects = activeProjectsOf(input)
  const manualProjects = input.manualOrder?.manual === true ? input.manualOrder.projects : undefined
  const orderedProjects = applyManualOrder(activeProjects, manualProjects, (project) => project.key)

  const rows: RenderRow[] = []
  for (const project of orderedProjects) {
    const containers = containersOfProject(project, context)
    const projectCollapsed = isCollapsed(context.collapsedKeys, containers.projectKey)

    // 计数与行内容都要算（折叠时仍要显示计数）。
    // flat / 普通会话容器：**所有项目**都构建，供 project 行聚合高亮（2026-10-20 追加裁决：
    // 所有 workspace 都统计普通/flat 会话）。`containers.flat` 只对非 git 工作区存在
    // （D11：git 项目的会话挂 worktree 子行），故 git 项目在这里用 `project.flatSessions`
    // 构造一个**仅供判定**的等价容器；它的 rows / 计数不参与渲染与 sessionCount
    // （真实宿主数据里 `flatSessions` 对 git 项目恒为空，见 `projects.ts` 归属规则 2b）。
    const flatContainer: ContainerSpec = containers.flat ?? {
      key: containers.projectKey,
      kind: 'project',
      depth: 1,
      sessions: project.flatSessions,
      project,
    }
    const flatResult = emitContainer(flatContainer, context)
    const rendersFlat = containers.flat !== undefined
    const historyResult =
      containers.history === undefined ? undefined : emitContainer(containers.history, context)

    // ── worktree 层手动顺序（D10）──────────────────────────────────────
    // 约束：**只能在同一个项目内重排**。`order.worktrees` 以 `project.key` 分桶，
    // 所以跨项目的拖拽在本函数里根本无从表达（键不同），渲染层也据此禁止跨项目拖拽。
    const orderedWorktrees = applyManualOrder(
      containers.worktrees,
      worktreeOrderOf(context.manualOrder, project.key),
      (entry) => entry.node.path,
    )
    const worktreeResults = orderedWorktrees.map((entry) => ({
      node: entry.node,
      spec: entry.spec,
      result: emitContainer(entry.spec, context),
    }))

    const allResults: ContainerResult[] = [
      ...worktreeResults.map((entry) => entry.result),
      // flat 只对非 git 工作区计入 sessionCount / runningCount（D11 语义不变）；
      // git 项目的 flat 容器仅用于上面的高亮判定。
      ...(rendersFlat ? [flatResult] : []),
      ...(historyResult === undefined ? [] : [historyResult]),
    ]
    const identity = projectIdentity(project)

    rows.push({
      kind: 'project',
      key: containers.projectKey,
      label: project.title,
      depth: 0,
      expanded: !projectCollapsed,
      isGit: project.isGit === true,
      // D11（2026-09-21 修订）：git 项目恒有 worktree 子行 ⇒ worktreeCount 恒等于
      // `worktrees.length`（含单 worktree 的 git 项目）；非 git 工作区为 0。
      worktreeCount: containers.hasWorktreeRows ? project.worktrees.length : 0,
      sessionCount: allResults.reduce((sum, result) => sum + result.sessionCount, 0),
      runningCount: allResults.reduce((sum, result) => sum + result.runningCount, 0),
      pendingCount: allResults.reduce((sum, result) => sum + result.pendingCount, 0),
      // RT2（2026-10-20，含追加裁决）：**worktree 子项 OR 本 workspace 的 flat/普通会话**。
      // `allResults` 同时含 history，绝不能整体用于此判定；history 桶与未分组仍显式排除。
      hasRunningTasks:
        worktreeResults.some((entry) => entry.result.hasRunningTasks === true) ||
        flatResult.hasRunningTasks === true,
      ...identity,
    })
    if (projectCollapsed) continue

    for (const entry of worktreeResults) {
      const labels = worktreeLabels(entry.node, context.t)
      rows.push({
        kind: 'worktree',
        key: entry.spec.key,
        label: labels.label,
        depth: 1,
        expanded: !isCollapsed(context.collapsedKeys, entry.spec.key),
        path: entry.node.path,
        isMain: entry.node.isMain === true,
        exists: entry.node.exists === true,
        sessionCount: entry.result.sessionCount,
        runningCount: entry.result.runningCount,
        pendingCount: entry.result.pendingCount,
        hasRunningTasks: entry.result.hasRunningTasks,
        ...(labels.sublabel === undefined ? {} : { sublabel: labels.sublabel }),
        ...(entry.node.workspaceId === undefined ? {} : { workspaceId: entry.node.workspaceId }),
      })
      if (isCollapsed(context.collapsedKeys, entry.spec.key)) continue
      rows.push(...entry.result.rows)
    }

    if (rendersFlat) rows.push(...flatResult.rows)

    if (containers.history !== undefined && historyResult !== undefined) {
      rows.push({
        kind: 'history',
        key: containers.history.key,
        label: context.t('history.label'),
        depth: 1,
        expanded: !isCollapsed(context.collapsedKeys, containers.history.key),
        sessionCount: historyResult.sessionCount,
        runningCount: historyResult.runningCount,
        pendingCount: historyResult.pendingCount,
      })
      if (!isCollapsed(context.collapsedKeys, containers.history.key)) {
        rows.push(...historyResult.rows)
      }
    }
  }

  // 未分组行同理：`ungrouped` 非空 ≠ 有可见成员（可能全是归档 / 非当前的 blank）。
  if (hasVisibleMembers(input.ungrouped, context)) {
    const spec = ungroupedContainer(input)
    const result = emitContainer(spec, context)
    const collapsed = isCollapsed(context.collapsedKeys, spec.key)
    rows.push({
      kind: 'project',
      key: spec.key,
      label: context.t('section.ungrouped'),
      depth: 0,
      expanded: !collapsed,
      isGit: false,
      worktreeCount: 0,
      sessionCount: result.sessionCount,
      runningCount: result.runningCount,
      pendingCount: result.pendingCount,
      // RT2（用户裁决）：未分组行虽然是 `project` 形态，但**显式**为 false ——
      // 即使 `result.hasRunningTasks` 为 true（未分组容器内有会话在跑）也不许用：
      // 「project 文件夹高亮」只代表「该 workspace 的 worktree 子项或 flat 会话有任务在跑」，
      // 未分组不属于任何 workspace（2026-10-20 追加裁决后仍然排除）。
      hasRunningTasks: false,
    })
    if (!collapsed) rows.push(...result.rows)
  }

  if (input.includeRecent === true) {
    rows.push(...emitRecentSection(input, context))
  }

  return rows
}

/**
 * 推导侧栏底部「最近」分区行序列（2026-10-21 WSR5/WSR6，AC4–AC6；2026-10-29 RAS1/RAS3 改排序键）。
 *
 * - 汇总全局所有可见顶层会话（跨所有 project 的 worktree / flat / history 及 ungrouped，
 *   统一走 {@link isVisibleMember} 排除子代理、归档与非当前 blank），按归一化 `sessionId` 去重；
 * - 固定按**最后更新时间**（{@link recentActivityOf} = `max(updatedAt, lastActivityAt)`）降序
 *   （`sessionId` 升序 tiebreak）排列，最多保留 {@link RECENT_SESSION_LIMIT}（100）条；
 *   ⚠️ `lastActivityAt` 只在本分区消费 —— 工作区树/顶部区仍按 `updatedAt`；
 * - 产出 `kind: 'recent'` 分区头（`key: 'r:__recent__'`），支持 `collapsedKeys['r:__recent__']` 折叠，
 *   展开时直接平铺全部（最多 100 条）`rs:<sessionId>` 会话行，**不产生 `more` 行**；
 * - 搜索模式（`query` 非空）或无可见会话时返回 `[]`。
 */
export function buildRecentRows(input: SidebarModelInput): RenderRow[] {
  const query = (typeof input.query === 'string' ? input.query : '').trim()
  if (query !== '') return []
  const context: EmitContext = {
    archived: new Set(input.archivedSessionIds),
    collapsedKeys: input.collapsedKeys,
    expandedAllKeys: input.expandedAllKeys,
    expandLevels: input.expandLevels,
    currentSessionId: input.currentSessionId,
    titleOf: input.titleOf,
    t: input.t,
    subagentRunningCounts: indexRunningSubagentDescendants(allSessionsOf(input)),
    manualOrder: input.manualOrder,
    topZone: input.topZone,
  }
  return emitRecentSection(input, context)
}

function emitRecentSection(input: SidebarModelInput, context: EmitContext): RenderRow[] {
  const specs: ContainerSpec[] = []
  for (const project of activeProjectsOf(input)) {
    const containers = containersOfProject(project, context)
    for (const entry of containers.worktrees) specs.push(entry.spec)
    if (containers.flat !== undefined) specs.push(containers.flat)
    if (containers.history !== undefined) specs.push(containers.history)
  }
  if (hasVisibleMembers(input.ungrouped, context)) {
    specs.push(ungroupedContainer(input))
  }

  const byKey = new Map<string, SessionRowLike>()
  for (const spec of specs) {
    for (const session of visibleMembers(spec, context)) {
      const key = normalizeSessionId(session.sessionId)
      if (key === '') continue
      const prior = byKey.get(key)
      if (prior === undefined || byRecentActivity(session, prior) < 0) {
        byKey.set(key, session)
      }
    }
  }

  if (byKey.size === 0) return []

  // 2026-11-14 PX4：取消 100 条上限，改为与工作区容器一致的渐进式展开。
  const ordered = [...byKey.values()].sort(byRecentActivity)
  const recentKey = `r:${RECENT_KEY}`
  const collapsed = isCollapsed(context.collapsedKeys, recentKey)
  const recentSpec: ContainerSpec = {
    key: recentKey,
    kind: 'recent',
    depth: 1,
    sessions: ordered,
  }

  const rows: RenderRow[] = [
    {
      kind: 'recent',
      key: recentKey,
      label: context.t('section.recent'),
      depth: 0,
      expanded: !collapsed,
      sessionCount: ordered.length,
    },
  ]

  if (!collapsed) {
    const truncation = truncateByLevel(ordered, recentKey, context, 'recent', recentSpec.depth)
    for (const session of truncation.selected) {
      rows.push(
        toSessionRow(
          session,
          recentSpec.depth,
          subagentCountOf(context.subagentRunningCounts, session.sessionId),
          recentSpec,
          context,
        ),
      )
    }
    if (truncation.more !== undefined) rows.push(truncation.more)
  }

  return rows
}

