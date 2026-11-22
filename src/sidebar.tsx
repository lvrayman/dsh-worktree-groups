/**
 * 侧栏主组件（T5）：项目 → worktree → 会话 三级树。
 *
 * 契约：
 * - `docs/INTERFACES.md` §2.3（组件签名与必须遵守项）、§2.6 裁定 1–4、§2.7 裁定 5/10
 * - `docs/HOST-CONTRACTS.md` §B1（props 全表）、§B3（renderSlot）、§B5（primitives）
 * - `docs/PRD.md` D2/D3/D5/D6/D7/D8/D10/D11/D12/D14/D19/D20、US1–US7、R2
 *
 * 分工：本文件**只负责画行**。展开态、5 条截断（含 `expandedAll` 时那条用于「收起」
 * 的 more 行）、搜索扁平化、子代理深度、未分组容器全部由 `src/tree-model.ts` 的
 * `buildRows()` 推导 —— 本文件不做任何补行/补态。
 *
 * 三个刻意的工程选择：
 * 1. **不注入全局 `<style>`**，全部用内联 style。宿主基座升级会换掉 CSS 变量与类名，
 *    注入的样式一旦失配就污染整页；hover 态改由 React state 表达。
 * 2. **错误边界包在自己身上**（PRD R2）。异常若逃到宿主 `SlotErrorBoundary`，宿主会
 *    `abdicate` 掉本 entry 并投影回官方 `ui-workspace` —— 用户看到的是"树莫名其妙
 *    变回原样"，比可读报错更难排查。
 * 3. **不写 JSX 语法**：`react/jsx-runtime` 是 esbuild external，直接 import
 *    `jsx`/`jsxs`（与参考插件同姿势）。注意 `children` 放在 props 里，第三参是 `key`。
 *
 * ⚠️ `@deepseek-ai/dsh-client-ui-primitives` 无 `.d.ts` 可从本包解析（契约 §2.5 第 3 条），
 * 只 import **值**、按 `any` 收窄。
 */

import * as Primitives from '@deepseek-ai/dsh-client-ui-primitives'
import { Component, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { jsx as jsxRaw, jsxs as jsxsRaw } from 'react/jsx-runtime'

import { createSeatT, createT, zh, type Translate } from './locales.js'
import { iconSize, resolveIcon, type IconName } from './icons.js'
import {
  currentSessionIdOf,
  liveStateOf,
  runningSignature,
  visiblePendingKind,
  type LiveStateInput,
} from './live-state.js'
import {
  effectiveOrder,
  initialTopZoneState,
  isSessionDragLocked,
  markNewSessionsWritten,
  observationsOf,
  observeTopZone,
  pendingNewSessionIdsOf,
  planNewSessionInserts,
  reorderManualScope,
  buildRows,
  containerKeysUnder,
  topZoneInputOf,
  UNGROUPED_KEY,
  workspaceIdFromProjectKey,
  type ManualOrder,
  type ProjectNodeLike,
  type RenderRow,
  type SessionRowLike,
  type SidebarModelInput,
  type TopZoneState,
} from './tree-model.js'
import { mergeLiveSessions } from './live-merge.js'
import { sessionRowPropsEqual, type RowDragState } from './row-memo.js'

/** primitives 无可用类型声明（esbuild external），按契约 §2.5 收窄。 */
type Any = any

const P: Any = Primitives

/**
 * 松绑后的 `jsx` / `jsxs`。
 *
 * `react/jsx-runtime` 的类型签名对 `type` 做强推断；而本文件渲染的组件一半来自
 * `primitives`（`any`，因为该包没有可从本包解析的 `.d.ts`）。把 `any` 组件交给强类型
 * `jsx`，TS 推不出 props ⇒ 每个内联箭头函数都报 `TS7006`（隐式 any），而这些报错
 * 全部是**假阳性**：真正的契约是"props 由我显式声明"。
 *
 * 因此这里把两个运行时函数重新标注为宽松签名，把类型责任交回给调用点的显式 props
 * 定义（`interface XxxProps`）。**这不是绕过类型检查**：所有 props 对象都是本文件
 * 里具名的 interface，写错字段名照样报错。
 */
type JsxLike = (type: Any, props?: Any, key?: Any) => ReactNode

/**
 * 把 `key` 从 props 里摘出来交给 `jsx` 的第三参。
 *
 * React 19 起对"props 里带 key"发警告（`key` 必须直接传给 jsx，不能 spread）；
 * 本文件为了让 `children` 与 `key` 一处在源码里可见，历史上把两者都写在 props 里，
 * 这里统一在边界处拆开，源码写法不变、运行时形态正确。
 */
function splitKey(props: Any, key: Any): { rest: Any; key: Any } {
  if (props === null || typeof props !== 'object') return { rest: props, key }
  if (!Object.prototype.hasOwnProperty.call(props, 'key')) return { rest: props, key }
  const { key: innerKey, ...rest } = props as Record<string, unknown>
  return { rest, key: key ?? innerKey }
}

const jsx: JsxLike = ((type: Any, props?: Any, key?: Any) => {
  const split = splitKey(props, key)
  return jsxRaw(type, split.rest, split.key)
}) as Any

const jsxs: JsxLike = ((type: Any, props?: Any, key?: Any) => {
  const split = splitKey(props, key)
  return jsxsRaw(type, split.rest, split.key)
}) as Any

/**
 * 取一个宿主图标并渲染成元素（**唯一**允许的图标取用方式）。
 *
 * ⚠️ **不要**再直接写 `P.IconXxx16`（2026-10-19「侧栏渲染失败」的根因）：
 * 宿主 `@deepseek-ai/dsh-client-ui-primitives` 在 `0.2.1-rc.2` 把图标导出从
 * 「尺寸后缀」（`IconPlusOutline16`）改成了「线重后缀」（`IconPlusOutlineRegular` /
 * `Medium`，尺寸改走 `size` prop），旧名字**整套消失**。直接取用得到 `undefined`，
 * `jsx(undefined, {})` 会在渲染期抛 "Element type is invalid" ⇒ 侧栏被错误边界接管
 * （或逃到宿主 `SlotErrorBoundary`，本 entry 被 abdicate、整块侧栏静默回落到官方）。
 *
 * 解析层 `./icons.js` 同时认新旧两套命名，并在全部候选缺席时回落空图标（渲染
 * `null`）—— 宿主再改名也只是少几个图标，不会整块白掉。回归见
 * `test/icons.test.mjs`（含读真实宿主导出表的漂移哨兵）。
 *
 * @param name 逻辑图标名（`ICON_SPECS` 的键，**不是**宿主导出名）。
 * @param props 透传给宿主的 props（`size` 缺省取候选表里的默认尺寸）。
 * @returns 图标元素；该图标在当前宿主上不存在时为 `null`（合法的"不渲染"）。
 */
function icon(name: IconName, props?: Any): ReactNode {
  const resolved = resolveIcon(P, name)
  // 候选全缺席 ⇒ 不渲染（绝不把 `undefined` 交给 `jsx`）。
  if (resolved.candidate === undefined) return null
  return jsx(resolved.Component, { size: iconSize(name), ...props })
}

/*
 * 取词函数（声明 `locale` 后由宿主 locale seat 提供；缺失时退 `FALLBACK_T`）。
 *
 * 类型 `Translate` 定义在 `./locales.js`，与 `createT` / `createSeatT` 同源 —— 这里不再
 * 本地复制一份签名（2026-09-23：取词路径统一走 `createSeatT` 兜底，见
 * `SidebarBrowserInner` 的取词注释）。
 */

/**
 * `useSessions` 快照里我们需要的部分。
 *
 * 只用两处：`current`（当前会话 id）与 `byId`（旧宿主里 `completed` 的兜底来源；
 * 宿主 `0.2.1-rc.2` 已不再写该字段，现行来源是 `useSessionStatus` 的 `completionUnread`）。
 */
interface SessionsSnapshot {
  current?: string
  byId?: Record<string, { completed?: unknown } | undefined>
}

/** 槽位 props（完整来源见 `docs/HOST-CONTRACTS.md` §B1.2）。 */
export type SidebarProps = Record<string, unknown>

/**
 * `uiWorkspace.startSession` 的**第二参**（宿主 `DraftInitializationOptions` 中本插件用到的子集）。
 *
 * 宿主签名（`dsh-client-ui-workspace/lib/client.js:1499`）：
 *
 * ```js
 * startSession(workspaceId, options)   // { prompt?, clearPreviousDraft?, agentPreset? }
 * ```
 *
 * 语义（2026-10-22 DR1，见 `docs/design/2026-10-22-new-session-draft-retention.md`）：
 *
 * - **不传**（`undefined`）⇒ 宿主 `connectBlank(workspaceId, undefined)` 走
 *   `sessions.create({ workspaceId })`，**每次都铸新空白会话**；
 * - **传一个对象**（哪怕只是 `{ clearPreviousDraft: false }`）⇒ 宿主走
 *   `createInWorkspace`，按 `summary.cwd === workspace.path` 找回同目录的 blank 会话并
 *   复用它的 `sessionId` —— 草稿（`localStorage` 的 `dsh.conversation.<sessionId>`）因此保留。
 */
export interface StartSessionOptions {
  /** `false` = 复用同目录已有空白会话（保留其草稿）；`true` = 清空该草稿。**绝不能传 `true`**。 */
  clearPreviousDraft?: boolean
}

/**
 * 同位置「新建会话」的**固定入参**（2026-10-22 DR1）：所有插件自有的「新建会话」入口共用。
 *
 * 缺陷复盘：草稿按**会话 id** 存在浏览器 `localStorage`（`dsh.conversation.<sessionId>`），
 * 而插件旧实现以**单参**调用 `startSession(workspaceId)` ⇒ 宿主每次铸新空白会话 ⇒
 * 同位置那条带草稿的旧 blank 会话又被 `sessionVisible()` 的「blank 只显示当前那一条」
 * 隐藏 ⇒ 用户看到「草稿没了」。
 *
 * 传 `{ clearPreviousDraft: false }` 后宿主复用同 cwd 的 blank 会话（同一 `sessionId`），
 * 对话区按同一 id 恢复草稿。三个约束：
 *
 * 1. 必须是**同一个对象常量**（不要在调用点各写一份字面量）；
 * 2. **不得**传 `clearPreviousDraft: true`（会主动清空草稿）；
 * 3. 只对「同个位置」有意义 —— 宿主按 `cwd` 过滤，跨 worktree 不会互相复用。
 */
export const SAME_LOCATION_START_SESSION: StartSessionOptions = { clearPreviousDraft: false }

/**
 * 由 `client.tsx` 的 `apply(ctx)` 经 `inject` 工厂注入的服务门面。
 *
 * 组件**不直接碰 `ctx`**：`apply` 里已经把每个宿主服务用惰性 `ctx.get()` 包好，
 * 服务缺席时对应方法静默降级（R6）。这样组件侧永远只依赖 props。
 */
export interface SidebarBridge {
  /** `uiWorkspace.pickDirectory()`；`null` = 用户取消（§2.7 裁定 5）。 */
  pickDirectory(): Promise<string | null>
  /** `workspaces.create({ path })`。 */
  createWorkspace(path: string): Promise<void>
  renameWorkspace(workspaceId: string, title: string): Promise<void>
  deleteWorkspace(workspaceId: string): Promise<void>
  openSession(sessionId: string): void
  /** `uiWorkspace.startSession(workspaceId, options)`；`options` 必须原样转发（2026-10-22 DR1）。 */
  startSession(workspaceId: string, options?: StartSessionOptions): void
  renameSession(sessionId: string, title: string): Promise<void>
  archiveSession(sessionId: string): Promise<void>
  forkSession(sessionId: string): Promise<void>
}

/**
 * 本 entry 在 `children` 里声明的**自建**子槽位键（§2.7 裁定 5）。
 *
 * **绝不能**用官方键 `sidebar.workspaces.directoryFlow`：`SlotCore.register` 对同键
 * 重复声明直接抛错（`slot "..." is already declared`），而官方 `ui-workspace` 必须
 * 保持挂载（它同时提供 `uiWorkspace` 服务，是另外 5 个客户端插件的硬 inject 依赖）。
 */
export const DIRECTORY_FLOW_SLOT = 'sidebar.workspaces.worktreeDirectoryFlow'

/** 宿主 locale 命名空间（本插件自有）。 */
export const LOCALE_NS = 'dsh-worktree-groups'

/** 缺失宿主 `t` 时的兜底取词（直接用冻结集 {@link zh}）。 */
const FALLBACK_T: Translate = createT(zh)

/** 容器 key 前缀（与 `tree-model.ts` 的 `RenderRow.key` 约定一致）。 */
const PREFIX_WORKTREE = 'w:'
const PREFIX_UNGROUPED = `p:${UNGROUPED_KEY}`

/** localStorage 键（PRD D12）。 */
const LS_COLLAPSED = 'dsh-worktree-groups.collapsed'
/**
 * 渐进展开层级（2026-11-14 PX5）：`容器 key → 层级`（正整数）。
 * 旧键 `dsh-worktree-groups.expandedAll`（全展开布尔表）不再读取。
 */
const LS_EXPAND_LEVELS = 'dsh-worktree-groups.expandLevels'
/**
 * 手动排序键（PRD D10，2026-09-21）。命名风格与上面两个键一致。
 *
 * 内容见 {@link ManualOrder}：`{ manual, projects, worktrees, sessions }`。
 */
const LS_ORDER = 'dsh-worktree-groups.order'
/**
 * 已归档工作空间的客户端持久化键（2026-10-21 WSR1/WSR2）。
 *
 * 与服务端台账 `archivedProjects` 双写同步：即使宿主进程尚未重启，客户端点击
 * 「归档工作空间」或设置页「放出」也能立即生效并跨刷新保持。
 */
const LS_ARCHIVED_PROJECTS = 'dsh-worktree-groups.archivedProjects'

/**
 * 树数据自动刷新间隔。
 *
 * 2026-11-14 PERF7：30 s → 5 s。服务端 `/tree` 有 ETag，内容未变时回 304（无响应体、
 * 不解析、不重渲染），且会话列举 / git 扫描都有指纹缓存 ⇒ 轮询开销可忽略；页面隐藏时
 * `reload` 直接跳过，聚焦 / 重新可见时立即补拉。外部 `git worktree add` 最迟 5 s 内出现。
 */
const TREE_REFRESH_MS = 5_000

/** 宿主快照变化后的防抖（一次推送可能连发多帧）。 */
const RELOAD_DEBOUNCE_MS = 220

/** 会话 / 容器行高。 */
const ROW_HEIGHT = 28

/** 轨道态图标按钮边长（§B1.4）。 */
const RAIL_BUTTON = 36

/** 树数据路由（契约 §1.5）。 */
const ROUTE_TREE = '/dsh-worktree-groups/tree'
const ROUTE_WORKSPACE_OPEN = '/dsh-worktree-groups/workspace-open'
const ROUTE_WORKTREE_CREATE = '/dsh-worktree-groups/worktree-create'
const ROUTE_WORKTREE_REMOVE = '/dsh-worktree-groups/worktree-remove'
const ROUTE_REVEAL = '/dsh-worktree-groups/reveal'

/**
 * `POST <route>` 的 JSON 调用（2026-10-21 Fix3）。
 *
 * `actions.post` 与 `AddWorkspaceDialog` 的兜底建档路径共用同一实现 ——
 * `bridge` 缺席（无 `workspaces.create`）时靠宿主路由 `workspace-open` 建档，
 * 失败时抛错给弹窗展示，**不允许静默无反应**。
 */
async function postJson(route: string, body: Record<string, unknown>): Promise<Any> {
  const response = await fetch(route, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return (await response.json()) as Any
}

/** 菜单项 id。 */
const MENU = {
  newSession: 'new-session',
  newWorktree: 'new-worktree',
  reveal: 'reveal',
  copyPath: 'copy-path',
  renameWorkspace: 'rename-workspace',
  removeWorktree: 'remove-worktree',
  archiveWorkspace: 'archive-workspace',
  renameSession: 'rename-session',
  archiveSession: 'archive-session',
  forkSession: 'fork-session',
  /** D10：清除本地手动顺序，立即恢复默认排序（仅 `manual === true` 时出现）。 */
  resetOrder: 'reset-order',
} as const

/** 跨组件（侧栏 ↔ 设置页 ↔ 添加工作区桥接）的归档状态变更通知器。 */
const archiveListeners = new Set<() => void>()

/** 最近一次拉取到的原始项目列表（供客户端按路径自动解除归档时反查 worktree 路径）。 */
let latestKnownProjects: ProjectNodeLike[] = []

/** 通知所有订阅者（侧栏与设置页）重新拉取树与归档工作空间列表。 */
export function notifyArchiveWorkspaceChanged(): void {
  for (const listener of [...archiveListeners]) {
    try {
      listener()
    } catch {
      /* 忽略单个监听器异常 */
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 取值 / 存储 工具
// ────────────────────────────────────────────────────────────────────────────

/** 取字符串 prop；类型不符返回 undefined（不抛）。 */
function readString(source: SidebarProps, key: string): string | undefined {
  const value = source[key]
  return typeof value === 'string' ? value : undefined
}

/** 取布尔 prop（`wide` 缺省按"展开"处理）。 */
function readBoolean(source: SidebarProps, key: string): boolean | undefined {
  const value = source[key]
  return typeof value === 'boolean' ? value : undefined
}

/**
 * 取函数 prop。
 *
 * **不能**写成 `source[key] as Fn` —— props 里混着 `hostInfo` 这类值对象，
 * 盲转会把它们当函数调用并抛 TypeError。
 */
function readFunction(source: SidebarProps, key: string): ((...args: Any[]) => Any) | undefined {
  const value = source[key]
  if (typeof value !== 'function') return undefined
  return value as (...args: Any[]) => Any
}

/** localStorage 读 `Record<string, boolean>`；隐私模式会抛，全捕获。 */
function readFlagMap(key: string): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    const result: Record<string, boolean> = {}
    for (const [entryKey, entryValue] of Object.entries(parsed as Record<string, unknown>)) {
      if (entryValue === true) result[entryKey] = true
    }
    return result
  } catch {
    return {}
  }
}

/** localStorage 读 `Record<string, number>`（只保留正整数层级）；损坏即空表。 */
function readLevelMap(key: string): Record<string, number> {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    const result: Record<string, number> = {}
    for (const [entryKey, entryValue] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof entryValue === 'number' && Number.isFinite(entryValue) && entryValue >= 1) {
        result[entryKey] = Math.floor(entryValue)
      }
    }
    return result
  } catch {
    return {}
  }
}

/** localStorage 写层级表；失败静默。 */
function writeLevelMap(key: string, value: Record<string, number>): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* 隐私模式 / 配额超限 */
  }
}

/** localStorage 写 `Record<string, boolean>`；失败静默（退化为会话内存态）。 */
function writeFlagMap(key: string, value: Record<string, boolean>): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* 隐私模式 / 配额超限 */
  }
}

/** 空的手动顺序（`manual: false` ⇒ 完全走默认顺序）。 */
const EMPTY_ORDER: ManualOrder = { manual: false }

/**
 * 从 `unknown` 收窄成 `string[]`：只保留**非空字符串**，去掉重复项。
 *
 * 为什么必须清洗：`localStorage` 里的内容是用户可以手改的（也是**上一个版本**的插件写的），
 * 里面完全可能出现 `null` / 数字 / 嵌套数组。不清洗就会把 `undefined` 当成 key 传进
 * `applyManualOrder`，轻则排序错乱、重则渲染层 `keyOf` 抛错（`node.path` of undefined）。
 */
function stringListOf(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const seen = new Set<string>()
  const result: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string' || entry === '' || seen.has(entry)) continue
    seen.add(entry)
    result.push(entry)
  }
  return result
}

/** 从 `unknown` 收窄成 `Record<string, string[]>`（值为非数组 / 空数组的键被丢掉）。 */
function stringListMapOf(value: unknown): Record<string, string[]> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const result: Record<string, string[]> = {}
  let any = false
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const list = stringListOf(entry)
    if (list === undefined || list.length === 0) continue
    result[key] = list
    any = true
  }
  return any ? result : undefined
}

/**
 * localStorage 读手动顺序（D10）；隐私模式会抛，全捕获。
 *
 * **失败时退化为 {@link EMPTY_ORDER}**（= 默认顺序），绝不崩 —— 与 `readFlagMap` 同姿势。
 * 结构不合法（不是对象 / `manual` 不是 `true`）时同样退化：一个坏值不应该让侧栏白屏。
 */
function readManualOrder(): ManualOrder {
  try {
    const raw = localStorage.getItem(LS_ORDER)
    if (raw === null) return EMPTY_ORDER
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return EMPTY_ORDER
    const record = parsed as Record<string, unknown>
    if (record.manual !== true) return EMPTY_ORDER
    const order: ManualOrder = { manual: true }
    const projects = stringListOf(record.projects)
    if (projects !== undefined && projects.length > 0) order.projects = projects
    const worktrees = stringListMapOf(record.worktrees)
    if (worktrees !== undefined) order.worktrees = worktrees
    const sessions = stringListMapOf(record.sessions)
    if (sessions !== undefined) order.sessions = sessions
    return order
  } catch {
    return EMPTY_ORDER
  }
}

/** localStorage 写手动顺序；失败静默（退化为本次会话的内存态）。 */
function writeManualOrder(order: ManualOrder): void {
  try {
    localStorage.setItem(LS_ORDER, JSON.stringify(order))
  } catch {
    /* 隐私模式 / 配额超限 */
  }
}

/** 清除本地手动顺序（「恢复默认排序」菜单项）。失败静默。 */
function clearManualOrder(): void {
  try {
    localStorage.removeItem(LS_ORDER)
  } catch {
    /* 隐私模式 */
  }
}

/** 已归档工作空间条目（客户端 localStorage 与服务端 `/tree` 共用结构）。 */
export interface ArchivedWorkspaceItem {
  key: string
  title: string
  path?: string
  isGit: boolean
  archivedAt: number
}

/** 从 localStorage 读取已归档工作空间映射表。 */
function readArchivedProjectsMap(): Record<string, ArchivedWorkspaceItem> {
  try {
    const raw = localStorage.getItem(LS_ARCHIVED_PROJECTS)
    if (raw === null) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    const result: Record<string, ArchivedWorkspaceItem> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (key === '' || typeof value !== 'object' || value === null || Array.isArray(value)) continue
      const entry = value as Record<string, unknown>
      result[key] = {
        key,
        title: typeof entry.title === 'string' && entry.title !== '' ? entry.title : key,
        ...(typeof entry.path === 'string' && entry.path !== '' ? { path: entry.path } : {}),
        isGit: entry.isGit === true,
        archivedAt: typeof entry.archivedAt === 'number' && Number.isFinite(entry.archivedAt)
          ? entry.archivedAt
          : 0,
      }
    }
    return result
  } catch {
    return {}
  }
}

/** 将已归档工作空间映射表写入 localStorage。 */
function writeArchivedProjectsMap(map: Record<string, ArchivedWorkspaceItem>): void {
  try {
    localStorage.setItem(LS_ARCHIVED_PROJECTS, JSON.stringify(map))
  } catch {
    /* 隐私模式 / 配额超限 */
  }
}

/** 在客户端立即归档指定工作空间并通知侧栏重渲染。 */
function archiveWorkspaceClient(item: ArchivedWorkspaceItem): void {
  const current = readArchivedProjectsMap()
  current[item.key] = item
  writeArchivedProjectsMap(current)
  notifyArchiveWorkspaceChanged()
}

/** 在客户端立即按 key 放出指定工作空间并通知侧栏重渲染。 */
function unarchiveWorkspaceByKeyClient(projectKey: string): void {
  const current = readArchivedProjectsMap()
  if (current[projectKey] === undefined) return
  delete current[projectKey]
  writeArchivedProjectsMap(current)
  notifyArchiveWorkspaceChanged()
}

/** 在客户端按目录路径匹配并自动放出已归档工作空间（2026-10-21 WSR2）。 */
export function unarchiveWorkspaceByPathClient(path: string): void {
  const target = normalizeRepoKey(path)
  if (target === undefined) return
  const current = readArchivedProjectsMap()
  const keys = Object.keys(current)
  if (keys.length === 0) return

  let changed = false
  for (const [key, item] of Object.entries(current)) {
    if (item.path !== undefined && normalizeRepoKey(item.path) === target) {
      delete current[key]
      changed = true
      continue
    }
    const proj = latestKnownProjects.find((p) => p.key === key)
    if (proj !== undefined) {
      const hitMain = proj.mainPath !== undefined && normalizeRepoKey(proj.mainPath) === target
      const hitWt = proj.worktrees.some((wt) => normalizeRepoKey(wt.path) === target)
      const hitFlat = proj.flatSessions.some((s) => s.cwd !== undefined && normalizeRepoKey(s.cwd) === target)
      if (hitMain || hitWt || hitFlat) {
        delete current[key]
        changed = true
      }
    }
  }

  if (changed) {
    writeArchivedProjectsMap(current)
    notifyArchiveWorkspaceChanged()
  }
}

/** 复制文本：优先 primitives 的 `writeClipboard`（内含 execCommand 回退）。 */
async function copyText(text: string): Promise<void> {
  if (typeof P.writeClipboard === 'function') {
    await P.writeClipboard(text)
    return
  }
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    /* 无剪贴板权限：静默 */
  }
}

/** 目录 basename（接受 `/` 与 `\`，忽略尾分隔符）。 */
function baseName(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, '')
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return trimmed.slice(cut + 1)
}

/** 父目录（D7 默认路径预览用）。 */
function parentDirOf(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, '')
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return cut <= 0 ? '' : trimmed.slice(0, cut)
}

/** 存在性判定（`undefined` / `null` 都算缺失）。 */
function present<T>(value: T | undefined | null): value is T {
  return value !== undefined && value !== null
}

/** 缩进：depth 0 起 8px，每级 +14px。 */
function indentOf(depth: number): number {
  return 8 + depth * 14
}

// ────────────────────────────────────────────────────────────────────────────
// 状态点（D10：运行中 / 等待确认（琥珀）/ 后台完成（绿））
// ────────────────────────────────────────────────────────────────────────────

/**
 * 会话状态点。`StateDot.state` 的取值域是
 * `'done' | 'warning' | 'ongoing' | 'error' | 'idle'`（见 `StateDot.module.css`）：
 * - `warning` ⇒ 琥珀（等待确认，对齐原生 `pendingInteraction`）
 * - `ongoing` ⇒ 蓝色像素矩阵动画（运行中，对齐原生 `node.running`）
 * - `done`    ⇒ 绿色（后台完成未读，对齐原生 `node.completed`）
 * - `idle`    ⇒ 三级灰（已读空闲，最弱，视觉上后退）
 *
 * @param props.running 会话是否在跑。**已含子代理聚合**（需求 A）：`tree-model.ts` 的
 *   `toSessionRow` 把它算成 `该会话自己的 running || subagentCount > 0`，所以「主 agent 空闲
 *   但有子代理在跑」时这里收到的就是 `true`（对齐原生 `sessionStatuses`）。本组件**不做**
 *   任何聚合 —— 它只负责把 `row.running` 画出来。
 * @param props.pending 是否有待处理交互（审批 / 计划评审 / 追问）。
 * @param props.completed 是否"后台完成未读"。
 * @returns 状态点元素（自身 `aria-hidden`，可访问性靠外层 `title`）。
 */
function StatusDot(props: { running?: boolean; pending?: boolean; completed?: boolean }): ReactNode {
  const state = props.pending === true
    ? 'warning'
    : props.running === true
      ? 'ongoing'
      : props.completed === true
        ? 'done'
        : 'idle'
  return jsx(P.StateDot, { state, size: 10 })
}

// ────────────────────────────────────────────────────────────────────────────
// 客户端 live-fact 覆盖层（D2）
// ────────────────────────────────────────────────────────────────────────────

/**
 * 把客户端 live fact 覆盖到会话行上（**D2**；2026-10-19 换数据源）。
 *
 * 为什么需要这一层：宿主 `SessionSummary`（`summarizeCold` / `summaryFor` /
 * `listFields`）**没有** `pendingInteraction`、也**没有** `completed` —— 所以
 * `routes.ts` 的 `toSessionRow` 读它们恒得 `undefined`，HTTP 面永远给不出这两个态。
 * 不补这一层，「运行中」之外的两态（琥珀 / 绿点）**永远不会亮**，违反 PRD US7。
 *
 * ⚠️ **2026-10-19 数据源漂移**（见 `src/live-state.ts` 的模块注释）：
 * 宿主 `0.2.1-rc.2` **删除了** root hook `useSessionPendingInteraction`，`useSessions().byId`
 * 条目也**不再有** `completed` 字段；现行唯一来源是 `useSessionStatus` 的
 * `Map<id, { running, pendingInteraction, completionUnread }>`。取数逻辑已抽到纯逻辑
 * 模块 `./live-state.js`（新源优先、旧源兜底、kind 白名单、id 拼法归一化），
 * 由 `test/live-state.test.mjs` 覆盖 —— 那部分以前埋在 `.tsx` 里，**零单测**。
 *
 * 实现约束：`RenderRow` 是**冻结契约**（不得改形状），所以这里产出一个**浅覆盖后的
 * 新行对象**（同一联合类型），而不是往 `tree-model` 里塞字段。
 *
 * @param row `buildRows()` 产出的行。
 * @param live 三个宿主快照（`status` 优先，`pending` / `sessions` 兜底）。
 * @returns 会话行（覆盖后）或原行（非会话行）。
 */
function withLiveState(row: RenderRow, live: LiveStateInput): RenderRow {
  if (row.kind !== 'session') return row
  // HTTP 面给的值（可能来自其它宿主版本）优先；客户端 live fact 兜底/补全。
  const client = liveStateOf(live, row.sessionId)
  const pendingKind = row.pendingInteraction !== undefined
    ? visiblePendingKind(row.pendingInteraction)
    : client.pendingKind
  const completed = row.completed === true || client.completionUnread
  return {
    ...row,
    completed,
    ...(pendingKind === undefined ? {} : { pendingInteraction: pendingKind }),
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 拖拽排序（D10，2026-09-21 用户决策变更）
// ────────────────────────────────────────────────────────────────────────────

/**
 * 拖拽的三个层级。
 *
 * 每一层的**拖拽范围**都在类型上被约束死（见 {@link DragState}）：
 * - `project` —— 顶层项目之间（未分组行不参与，但它同时是静止边界）；
 * - `worktree` —— **同一项目内**的 worktree 之间（`projectKey` 必须相同）；
 * - `session` —— **同一容器内**的会话之间（`containerKey` 必须相同）。
 */
type DragKind = 'project' | 'worktree' | 'session'

/** 插入位置：拖到行的上半 ⇒ `before`（该行**上方**一条线），下半 ⇒ `after`。 */
type DropHalf = 'before' | 'after'

/**
 * 正在进行的拖拽。
 *
 * `projectKey` / `containerKey` 是**范围约束的载体**：`onDragOver` 只在
 * `over` 的归属键与拖拽源相同时才接受（并画插入线），否则整个 `onDragOver` 直接返回
 * ⇒ 不 `preventDefault` ⇒ 浏览器显示「禁止」光标、`drop` 也不触发。
 *
 * 这就是「session 不跨容器、worktree 不跨项目」的实现方式：**不是**在 drop 时拒绝，
 * 而是从一开始就不给出可落点（用户看不到插入线，拖过去就是无效的）。
 */
interface DragState {
  kind: DragKind
  /** 被拖行的 `RenderRow.key`（`p:` / `w:` / `s:` 前缀）。 */
  key: string
  /**
   * 会话拖拽：容器的 key（`RenderRow.parentKey`）。跨容器拖拽 = 改会话的 cwd/归属，
   * 宿主禁止且语义不明 ⇒ 直接不允许。
   */
  containerKey?: string
  /**
   * worktree 拖拽：所属项目的 `ProjectNode.key`。跨项目拖 = 把 worktree 移到别的仓，
   * 物理上不可能 ⇒ 直接不允许。
   */
  projectKey?: string
  /** 被拖项的稳定业务 id（项目 key / worktree 路径 / sessionId）。 */
  itemId: string
}

/** 当前悬停的落点（`over`）+ 插入线方向。 */
interface DropTarget {
  key: string
  half: DropHalf
}

/** 一行可拖拽所需的全部上下文（由 {@link buildTreeView} 预先算好，渲染层只读）。 */
interface DragHandlers {
  /** 该行是否可拖（未分组行、`wide === false` 时不可拖）。 */
  draggable: boolean
  /** 该行是否是当前被拖的行（降不透明度）。 */
  dragging: boolean
  /** 该行的插入线：`null` = 不画。 */
  marker: DropHalf | null
  onDragStart(event: Any): void
  onDragEnd(): void
  onDragOver(event: Any): void
  onDrop(event: Any): void
}

/**
 * 指针在行的上半还是下半（原生 `rowHalf` 的逐字移植）。
 *
 * `dsh-client-ui-workspace/lib/client.js`：
 * ```js
 * function rowHalf(e) {
 *   const rect = e.currentTarget.getBoundingClientRect()
 *   return e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
 * }
 * ```
 */
function rowHalf(event: Any): DropHalf {
  const rect = event?.currentTarget?.getBoundingClientRect?.()
  if (rect === undefined) return 'after'
  const top = Number(rect.top) || 0
  const height = Number(rect.height) || 0
  return (Number(event?.clientY) || 0) < top + height / 2 ? 'before' : 'after'
}

/**
 * 把「被拖项 + 落点」换算成新的顺序列表 —— 见 `tree-model.ts` 的 `reorderManualScope`
 * （2026-10-22 DR6 起：先与默认顺序对齐再 `reorderKeys`，陈旧持久表不再让拖拽失效）
 * （纯逻辑，放在那边才能被 `node --test` 覆盖；`sidebar.tsx` 是 `.tsx`，不进 `lib/`）。
 */

/** 拖拽行的插入线 / 被拖行的视觉反馈（全内联，不注入 `<style>`）。 */
function dragLineStyle(half: DropHalf, _indent: number): CSSProperties {
  return {
    position: 'absolute',
    left: 6,
    right: 6,
    height: 2,
    borderRadius: 1,
    background: 'var(--dsw-alias-brand-primary)',
    pointerEvents: 'none',
    ...(half === 'before' ? { top: -1 } : { bottom: -1 }),
  }
}

/** 拖拽中的行：降低不透明度（原生用 CSS 类，这里用内联 style）。 */
const DRAGGING_OPACITY = 0.45

// ────────────────────────────────────────────────────────────────────────────
// 样式（全内联；hover 用 state 表达，不注入全局 <style>）
// ────────────────────────────────────────────────────────────────────────────

/**
 * 行容器基础样式（2026-10-21 WSR4：选中态与普通 hover 明显区分；
 * 使用 `marginLeft` 承载树缩进，使左侧空白缩进区不显示高亮底色，右侧空白正常高亮）。
 */
function rowStyle(active: boolean, hovered: boolean, indent: number): CSSProperties {
  const leftMargin = Math.max(0, indent - 6)
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    minHeight: ROW_HEIGHT,
    boxSizing: 'border-box',
    marginLeft: leftMargin,
    padding: active ? '0 8px 0 10px' : '0 6px',
    borderRadius: 8,
    cursor: 'pointer',
    userSelect: 'none',
    color: 'var(--dsw-alias-label-primary)',
    background: active
      ? 'var(--dsw-alias-bg-selected, rgba(65, 118, 230, 0.14))'
      : hovered
        ? 'var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.12))'
        : 'transparent',
    fontWeight: active ? 600 : 400,
  }
}

/** 行内图标按钮；`visible=false` 时透明（hover 显隐，D14）。 */
function iconButtonStyle(visible: boolean): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 22,
    height: 22,
    padding: 0,
    flex: 'none',
    border: 'none',
    borderRadius: 6,
    background: 'transparent',
    color: 'var(--dsw-alias-label-tertiary, var(--dsw-alias-label-dimmed))',
    cursor: 'pointer',
    opacity: visible ? 1 : 0,
    transition: 'opacity 0.12s ease',
  }
}

/** 输入控件统一样式。 */
function fieldStyle(): CSSProperties {
  return {
    height: 34,
    boxSizing: 'border-box',
    border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.3))',
    borderRadius: 10,
    background: 'transparent',
    color: 'var(--dsw-alias-label-primary)',
    fontFamily: 'inherit',
    fontSize: 13.5,
    padding: '0 12px',
    outline: 'none',
  }
}

/** 次要文字（三级灰）。 */
function dimText(size = 12): CSSProperties {
  return { fontSize: size, color: 'var(--dsw-alias-label-tertiary, var(--dsw-alias-label-dimmed))' }
}

/** 小胶囊（`[主]` 标签、子代理计数）。 */
function pillStyle(): CSSProperties {
  return {
    flex: 'none',
    fontSize: 10,
    lineHeight: '14px',
    padding: '0 5px',
    borderRadius: 4,
    color: 'var(--dsw-alias-label-tertiary, var(--dsw-alias-label-dimmed))',
    border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.3))',
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 数据模型
// ────────────────────────────────────────────────────────────────────────────

/** 宿主 `POST /dsh-worktree-groups/tree` 的响应（契约 §1.5）。 */
interface TreeResponse {
  projects: ProjectNodeLike[]
  ungrouped: SessionRowLike[]
  archivedSessionIds: string[]
  archivedProjects?: ArchivedWorkspaceItem[]
  /** 归一化工作区路径 → workspaceId（PERF6：实时叠加层给非 git 工作区定位用）。 */
  workspaceByPath?: Record<string, string>
}

/** worktree 行的附加数据（`RenderRow.worktree` 不带这些字段，需回查原始树）。 */
interface WorktreeExtra {
  /** 该 worktree 的绝对路径（`workspace-open` / `worktree-remove` / `reveal` 的目标）。 */
  path: string
  /**
   * 该 worktree 属于哪个仓（= 其项目节点的 `mainPath`，D3 修复新增）。
   *
   * 必须由**构建侧**显式带上，不能靠渲染侧用路径前缀猜：`/Project/Workspace/` 是
   * MyProject 与 DemoApp 的公共父目录，前缀过滤会把兄弟仓的分支串进来。
   * 未注册 / 非 git 场景下与 `path` 同值或缺失，此时不做跨仓候选合并。
   */
  repoPath?: string
  /** 已注册工作区 id；`undefined` = 未注册（懒注册，D5）。 */
  workspaceId?: string
  /** 同仓其它 worktree 的分支名（新建 worktree 弹窗的起始分支候选）。 */
  baseCandidates: string[]
}

/** 项目行的附加数据。 */
interface ProjectExtra {
  /** 原始项目 key（`ProjectNode.key`，用于归档工作空间）。 */
  projectKey: string
  /** git 项目的主工作树路径（新建 worktree 的 `repoPath`）。 */
  mainPath?: string
  /** 工作空间展示路径（git 为 mainPath，非 git 为工作区路径）。 */
  path?: string
  /** 该项目下任一 worktree 的已注册工作区 id。 */
  workspaceId?: string
  /** 是否 git 项目。 */
  isGit: boolean
  /** 未分组容器：不是真实项目（§2.6 裁定 1）。 */
  isUngrouped: boolean
}

/** 一次渲染需要的行与附加数据。 */
interface TreeView {
  rows: RenderRow[]
  worktrees: Map<string, WorktreeExtra>
  projects: Map<string, ProjectExtra>
  /**
   * worktree 行的 key（`w:<path>`）→ 所属**项目**的 key（`ProjectNode.key`）。
   *
   * D10 拖拽范围约束的唯一依据：worktree **只能在同一个项目内**重排（跨项目拖 = 把
   * worktree 移到别的仓，物理上不可能）。`WorktreeExtra.repoPath` 不能拿来当这个判据 ——
   * 它是**主仓路径**，未注册 / 非 git 场景下缺失，而项目 key 是 git 的 commonDir，
   * 两者拼法不同（`/repo` vs `/repo/.git`），拿它比较必然失配。
   */
  worktreeOwner: Map<string, string>
}

/** 右键菜单 / `…` 按钮的定位目标。 */
type MenuTarget =
  | { kind: 'worktree'; x: number; y: number; title: string; extra: WorktreeExtra }
  | { kind: 'session'; x: number; y: number; title: string; sessionId: string }
  | { kind: 'project'; x: number; y: number; title: string; key: string; extra: ProjectExtra }

/** 重命名弹窗的入参。 */
interface RenameState {
  kind: 'workspace' | 'session'
  id: string
  value: string
}

/** 新建 worktree 弹窗的入参。 */
interface CreateState {
  /** 主仓路径（`worktree-create.repoPath`）。 */
  repoPath: string
  /** 分支候选（同仓其它 worktree 的分支名）。 */
  baseCandidates: string[]
  /** 弹窗标题里显示的名字。 */
  label: string
}

/** 由宿主 props / bridge 拼出来的动作面。 */
interface Actions {
  openSession(sessionId: string): void
  /**
   * 开新会话。`options` 必须原样透传给宿主（2026-10-22 DR1：`{ clearPreviousDraft: false }`
   * 才会复用同目录空白会话、保留草稿；单参会让宿主铸新会话）。
   */
  startSession(workspaceId: string, options?: StartSessionOptions): void
  renameSession(sessionId: string, title: string): Promise<void>
  archiveSession(sessionId: string): Promise<void>
  forkSession(sessionId: string): Promise<void>
  renameWorkspace(workspaceId: string, title: string): Promise<void>
  /**
   * 目录选择阶段（D19 / 2026-10-21 Fix4）：返回路径，`null` = 用户取消。
   *
   * **只负责选择**，不碰 `createWorkspace`：`bridge` 缺席或宿主选择器抛错时**抛错**，
   * 由 {@link addWorkspace} 回调单独 catch 后打开 {@link AddWorkspaceDialog}。
   * 选择成功后的建档属于另一段异常边界（失败必须落 `loadError`），两者不得混同。
   */
  pickDirectory(): Promise<string | null>
  /**
   * 按目录路径直接添加工作区（2026-10-21 Fix3）：
   * `bridge.createWorkspace(path)`；`bridge` 缺席时回退 `POST ROUTE_WORKSPACE_OPEN`。
   * 供 {@link AddWorkspaceDialog} 在原生选择器不可用 / 报错时兜底。
   */
  createWorkspace(path: string): Promise<void>
  post(route: string, body: Record<string, unknown>): Promise<Any>
}

// ────────────────────────────────────────────────────────────────────────────
// 容器行（project / worktree / history）
// ────────────────────────────────────────────────────────────────────────────

/** 容器行 props。 */
interface ContainerRowProps {
  row: Extract<RenderRow, { kind: 'project' | 'worktree' | 'history' }>
  t: Translate
  /** hover 态（由 {@link HoverContainerRow} 提升，决定动作按钮透明度）。 */
  hovered: boolean
  /** 动作按钮工厂：按当前 hover 态产出节点（D14 的 `[+]` / `[…]`）。 */
  renderActions(hovered: boolean): ReactNode[]
  onToggle(): void
  onHoverChange(hovered: boolean): void
  onContextMenu?(event: Any): void
  /** D10：拖拽接线。`undefined` = 该行不可拖也不接受落点。 */
  drag?: DragHandlers
}

/**
 * 项目 / worktree / history 三种容器行的统一渲染。
 *
 * 交互（D14）：**点行体 = 展开/折叠**；`+` / `…` 各自 `stopPropagation`；右键由调用方绑定。
 *
 * 拖拽（D10）：行体 `draggable`；插入线画在行内（`position: relative` + 绝对定位的 2px 线），
 * 不占布局。**行内的 `<button>` 必须 `draggable={false}` + `onDragStart` 阻止冒泡**，
 * 否则按住 `+` / `…` 拖动会触发整行拖拽，点按钮的手感立刻变差。
 */
function ContainerRowView(props: ContainerRowProps): ReactNode {
  const row = props.row
  const isGroup = row.kind === 'project'
  // ⚠️ 图标一律经 `icon()`（见其注释：宿主 0.2.1 改了图标导出命名，直接取会崩）。
  const chevron = row.expanded ? icon('chevronDown') : icon('chevronRight')
  const lead = row.kind === 'history'
    ? icon('clock')
    : isGroup
      ? (row.expanded ? icon('folderOpen') : icon('folderClose'))
      : icon('branch')
  const drag = props.drag
  // 运行中任务高亮（2026-10-20）：唯一判据。`history` 行没有该字段（clock 永不高亮），
  // 必须先用 `kind === 'history'` 排除；其余用 `=== true` —— 旧产物 / 宿主漂移给出
  // `undefined` 时「不认识 ⇒ 不高亮、不崩」。
  const runningHighlight = row.kind === 'history' ? false : row.hasRunningTasks === true

  const children: ReactNode[] = [
    jsx('span', {
      key: 'lead',
      ...(runningHighlight ? { title: props.t('a11y.runningTask') } : {}),
      style: {
        display: 'inline-flex', alignItems: 'center', flex: 'none', lineHeight: 0,
        ...dimText(12),
        // 高亮色必须写在 `...dimText(12)` **之后**（dimText 带 label-tertiary 的 color）。
        // ⚠️ 不能给 `icon(...)` 传 style/color：宿主图标组件只解构 size/className/strokeWidth，
        //     其余 props 被丢弃（只有外层 span 的 color 会经 currentColor 生效）。
        ...(runningHighlight
          ? {
              color: 'var(--dsw-alias-state-business-primary, #4176e6)',
              filter: 'drop-shadow(0 0 2px var(--dsw-alias-state-business-primary, #4176e6))',
            }
          : {}),
      },
      children: lead,
    }),
    jsx('span', {
      key: 'chevron',
      style: { display: 'inline-flex', alignItems: 'center', flex: 'none', lineHeight: 0, ...dimText(12) },
      children: chevron,
    }),
    jsx('span', {
      key: 'label',
      title: row.kind === 'worktree' ? row.path : row.label,
      style: {
        flex: 'none',
        maxWidth: '62%',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        fontSize: isGroup ? 13 : 12.5,
        fontWeight: isGroup ? 600 : 500,
      },
      children: row.label,
    }),
  ]

  if (row.kind === 'worktree' && row.sublabel !== undefined) {
    children.push(jsx('span', {
      key: 'sublabel',
      style: {
        flex: 1,
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        ...dimText(11),
      },
      children: row.sublabel,
    }))
  } else {
    children.push(jsx('span', { key: 'spacer', style: { flex: 1, minWidth: 0 } }))
  }

  // 主工作树标 `[主]`（D2）
  if (row.kind === 'worktree' && row.isMain) {
    children.push(jsx('span', { key: 'main', style: pillStyle(), children: props.t('worktree.main') }))
  }

  // 2026-10-21 WSR7：顶层工作区行**不再显示**其名下会话数（用户要求）。
  // `sessionCount` 仍保留在 `RenderRow` 数据层（统计口径不变），只是不在这里渲染。

  const actionNodes = props.renderActions(props.hovered)
  if (actionNodes.length > 0) {
    children.push(jsx('span', {
      key: 'actions',
      style: { display: 'inline-flex', alignItems: 'center', gap: 2, flex: 'none' },
      children: actionNodes,
    }))
  }

  // 插入线画在**行内**（绝对定位，不占布局、不推动其它行）。
  if (drag !== undefined && drag.marker !== null) {
    children.push(jsx('span', {
      key: 'drop-line',
      'aria-hidden': true,
      style: dragLineStyle(drag.marker, indentOf(row.depth)),
    }))
  }

  return jsx('div', {
    role: 'treeitem',
    'aria-expanded': row.expanded,
    'data-key': row.key,
    // 仅高亮时出现（不高亮时**没有**该属性，不是 "false"）。与 `data-key` 共存；
    // 无浏览器环境下它是断言「视觉真的接上了判据」的唯一钩子（设计 §5.3）。
    ...(runningHighlight ? { 'data-running': 'true' } : {}),
    style: {
      ...rowStyle(false, props.hovered, indentOf(row.depth)),
      position: 'relative',
      ...(drag !== undefined && drag.dragging ? { opacity: DRAGGING_OPACITY } : {}),
    },
    onMouseEnter: () => { props.onHoverChange(true) },
    onMouseLeave: () => { props.onHoverChange(false) },
    onClick: props.onToggle,
    onContextMenu: props.onContextMenu,
    draggable: drag !== undefined && drag.draggable,
    onDragStart: drag?.onDragStart,
    onDragEnd: drag?.onDragEnd,
    onDragOver: drag?.onDragOver,
    onDrop: drag?.onDrop,
    children: children.filter(present),
  })
}

/** 把 hover 态提升到本层，好让动作按钮随 hover 显隐（D14）。 */
function HoverContainerRow(props: {
  row: Extract<RenderRow, { kind: 'project' | 'worktree' | 'history' }>
  t: Translate
  renderActions(hovered: boolean): ReactNode[]
  onToggle(): void
  onContextMenu?(event: Any): void
  drag?: DragHandlers
}): ReactNode {
  const [hovered, setHovered] = useState(false)
  return jsx(ContainerRowView, {
    row: props.row,
    t: props.t,
    hovered,
    renderActions: props.renderActions,
    onToggle: props.onToggle,
    onHoverChange: setHovered,
    ...(props.onContextMenu === undefined ? {} : { onContextMenu: props.onContextMenu }),
    ...(props.drag === undefined ? {} : { drag: props.drag }),
  })
}

// ────────────────────────────────────────────────────────────────────────────
// 会话行 / more 行
// ────────────────────────────────────────────────────────────────────────────

/** 会话行的事件处理器（每次父渲染重建；经 {@link SessionHandlersRef} 间接调用）。 */
interface SessionRowHandlers {
  onOpen(): void
  onMenu(target: { x: number; y: number; title: string; sessionId: string }): void
  /** D10：拖拽接线。`undefined` = 该行不可拖也不接受落点。 */
  drag?: DragHandlers
}

/** 稳定容器：`rowKey → 最新处理器`，父组件每次渲染整体替换 `current`。 */
interface SessionHandlersRef {
  current: Map<string, SessionRowHandlers>
}

/**
 * 会话行 props（2026-11-14 行 memo 化）。
 *
 * ⚠️ **处理器不进 props**：它们每次父渲染都是新闭包，进 props 会让 memo 永远失效；
 * 又因为 memo 会跳过重绘，行内也**不能**捕获处理器（拖拽处理器闭包里有 `drag` /
 * `dropTarget` 状态，陈旧闭包会让拖拽静默失效）。因此行内事件一律在触发时经
 * `props.handlers.current.get(props.rowKey)` 取**最新**实现。
 */
interface SessionRowProps {
  row: Extract<RenderRow, { kind: 'session' }>
  t: Translate
  rowKey: string
  handlers: SessionHandlersRef
  /** 拖拽的**可见状态**（不含处理器）；`undefined` = 不可拖也不接受落点。 */
  drag?: RowDragState
}

/**
 * 一条会话行。
 *
 * 与原生一致：子代理会话**不产生行**（`tree-model.ts` 的 `isVisibleMember` 逐字对齐原生
 * `sessionVisible`），父行右侧用计数胶囊显示「N 个子代理运行中」（`subagentCount` =
 * **运行中的**子代理后代数，所有层级，原生 `runningSubagentCount`）。计数为 0 时不画胶囊。
 *
 * 拖拽（D10）：`draggable` + 插入线，接线方式与原生 `SessionNodeItem` 一致
 * （`onDragStart` 写 `dataTransfer`、`onDragOver` 只在 `drag.active` 时 `preventDefault`）。
 */
function SessionRowViewInner(props: SessionRowProps): ReactNode {
  const row = props.row
  const [hovered, setHovered] = useState(false)
  const drag = props.drag
  /** 事件触发时取最新处理器（见 {@link SessionRowProps} 的 ⚠️）。 */
  const live = (): SessionRowHandlers | undefined => props.handlers.current.get(props.rowKey)

  const children: ReactNode[] = [
    row.isCurrent
      ? jsx('span', {
          key: 'active-bar',
          'aria-hidden': true,
          style: {
            position: 'absolute',
            left: 2,
            top: 5,
            bottom: 5,
            width: 3,
            borderRadius: 2,
            background: 'var(--dsw-alias-state-business-primary, #4176e6)',
            pointerEvents: 'none',
          },
        })
      : null,
    jsx('span', {
      key: 'dot',
      style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 14, height: 14, flex: 'none' },
      children: jsx(StatusDot, {
        running: row.running,
        pending: row.pendingInteraction !== undefined,
        completed: row.completed,
      }),
    }),
    jsx('span', {
      key: 'label',
      style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13, lineHeight: '18px' },
      children: row.label,
    }),
  ]

  if (row.subagentCount > 0) {
    children.push(jsx('span', {
      key: 'subs',
      title: props.t('a11y.subagents', { n: row.subagentCount }),
      style: { ...pillStyle(), fontSize: 11, lineHeight: '16px', padding: '0 6px', borderRadius: 8 },
      children: row.subagentCount,
    }))
  }

  if (drag !== undefined && drag.marker !== null) {
    children.push(jsx('span', {
      key: 'drop-line',
      'aria-hidden': true,
      style: dragLineStyle(drag.marker, indentOf(row.depth)),
    }))
  }

  return jsx('div', {
    role: 'treeitem',
    'aria-current': row.isCurrent ? 'true' : undefined,
    ...(row.isCurrent ? { 'data-selected': 'true' } : {}),
    'data-session-id': row.sessionId,
    title: row.label,
    style: {
      ...rowStyle(row.isCurrent, hovered, indentOf(row.depth)),
      position: 'relative',
      ...(drag !== undefined && drag.dragging ? { opacity: DRAGGING_OPACITY } : {}),
    },
    onMouseEnter: () => { setHovered(true) },
    onMouseLeave: () => { setHovered(false) },
    onClick: () => { live()?.onOpen() },
    onContextMenu: (event: Any) => {
      event.preventDefault()
      event.stopPropagation()
      live()?.onMenu({
        x: Math.round(Number(event.clientX) || 0),
        y: Math.round(Number(event.clientY) || 0),
        title: row.label,
        sessionId: row.sessionId,
      })
    },
    draggable: drag !== undefined && drag.draggable,
    ...(drag === undefined
      ? {}
      : {
          onDragStart: (event: Any) => { live()?.drag?.onDragStart(event) },
          onDragEnd: () => { live()?.drag?.onDragEnd() },
          onDragOver: (event: Any) => { live()?.drag?.onDragOver(event) },
          onDrop: (event: Any) => { live()?.drag?.onDrop(event) },
        }),
    children: children.filter(present),
  })
}

/**
 * memo 化的会话行（2026-11-14）：只在可见内容变化时重绘，比较器见 `src/row-memo.ts`。
 * 高频会话快照下，一次父渲染通常只有少数行真正变化。
 */
const SessionRowView = memo(SessionRowViewInner, sessionRowPropsEqual)

/**
 * 侧栏底部「最近」分区标题行（2026-10-21 WSR5/WSR6，参考 ChatGPT App）。
 *
 * 与上方工作区列表留出明显间距（`marginTop: 18` + 顶部分隔线），支持点击整体展开/折叠。
 */
function RecentSectionHeaderView(props: {
  row: Extract<RenderRow, { kind: 'recent' }>
  onToggle(): void
}): ReactNode {
  const [hovered, setHovered] = useState(false)
  const row = props.row
  const chevron = row.expanded ? icon('chevronDown') : icon('chevronRight')
  return jsxs('div', {
    role: 'treeitem',
    'aria-expanded': row.expanded,
    'data-key': row.key,
    style: {
      ...rowStyle(false, hovered, indentOf(row.depth)),
      marginTop: 18,
      paddingTop: 6,
      borderTop: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.16))',
    },
    onMouseEnter: () => { setHovered(true) },
    onMouseLeave: () => { setHovered(false) },
    onClick: props.onToggle,
    children: [
      jsx('span', {
        key: 'lead',
        style: { display: 'inline-flex', alignItems: 'center', flex: 'none', lineHeight: 0, ...dimText(12) },
        children: icon('clock'),
      }),
      jsx('span', {
        key: 'chevron',
        style: { display: 'inline-flex', alignItems: 'center', flex: 'none', lineHeight: 0, ...dimText(12) },
        children: chevron,
      }),
      jsx('span', {
        key: 'label',
        style: {
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontSize: 12.5,
          fontWeight: 600,
          color: 'var(--dsw-alias-label-secondary, var(--dsw-alias-label-primary))',
        },
        children: row.label,
      }),
      jsx('span', {
        key: 'count',
        style: { flex: 'none', ...dimText(11) },
        children: row.sessionCount,
      }),
    ],
  })
}

/**
 * 渐进展开行（2026-11-14 PX1–PX3）。
 *
 * ⚠️ **`RenderRow` 的 `more` 不提供 `label`**（契约 §2.6 裁定 2），取词由本组件负责：
 * - 仍有剩余（`hiddenCount > 0`）⇒ 「展开更多 {n} 个」按钮（`n = nextCount`）；
 * - `canCollapse` ⇒ 同一行右侧再给「收起」按钮；
 * - 全部展开完 ⇒ 只剩「收起」。
 */
function MoreRowView(props: {
  row: Extract<RenderRow, { kind: 'more' }>
  t: Translate
  onExpand(): void
  onCollapse(): void
}): ReactNode {
  const [hovered, setHovered] = useState<'expand' | 'collapse' | null>(null)
  const { row } = props
  const button = (kind: 'expand' | 'collapse', label: string, onActivate: () => void, extra: Record<string, unknown>): ReactNode =>
    jsx('div', {
      key: kind,
      role: 'button',
      tabIndex: 0,
      'data-more-action': kind,
      style: {
        ...dimText(12),
        cursor: 'pointer',
        borderRadius: 6,
        padding: '2px 6px',
        background: hovered === kind ? 'var(--dsw-alias-fill-tertiary, rgba(127,127,127,0.12))' : 'transparent',
        ...extra,
      },
      onMouseEnter: () => { setHovered(kind) },
      onMouseLeave: () => { setHovered(null) },
      onClick: (event: Any) => {
        event?.stopPropagation?.()
        onActivate()
      },
      onKeyDown: (event: Any) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onActivate()
        }
      },
      children: label,
    })
  const children: ReactNode[] = []
  if (row.hiddenCount > 0) {
    children.push(button('expand', props.t('sessions.expandMore', { n: row.nextCount }), props.onExpand, {}))
  }
  if (row.canCollapse) {
    children.push(button('collapse', props.t('sessions.collapse'), props.onCollapse, { marginLeft: 'auto' }))
  }
  return jsxs('div', {
    style: {
      ...rowStyle(false, false, indentOf(row.depth)),
      display: 'flex',
      alignItems: 'center',
      gap: 4,
    },
    children,
  })
}

// ────────────────────────────────────────────────────────────────────────────
// 弹窗零件
// ────────────────────────────────────────────────────────────────────────────

/** 弹窗表单行（label 在上、控件在下）。 */
function FieldRow(props: { label: string; children?: ReactNode }): ReactNode {
  return jsxs('label', {
    style: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12.5 },
    children: [
      jsx('span', { key: 'label', style: dimText(12), children: props.label }),
      props.children,
    ],
  })
}

/** 单选框 + 文案。 */
function RadioOption(props: { id: string; label: string; checked: boolean; onSelect(): void }): ReactNode {
  return jsxs('label', {
    htmlFor: props.id,
    style: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' },
    children: [
      jsx('input', {
        id: props.id,
        type: 'radio',
        checked: props.checked,
        onChange: props.onSelect,
        style: { accentColor: 'var(--dsw-alias-brand-primary)', width: 14, height: 14, margin: 0, cursor: 'pointer' },
      }),
      props.label,
    ],
  })
}

/** 弹窗底部按钮行。 */
function DialogActions(props: {
  t: Translate
  busy: boolean
  confirmText: string
  disabled?: boolean
  onCancel(): void
  onConfirm(): void
}): ReactNode {
  return jsxs('div', {
    style: { display: 'flex', justifyContent: 'flex-end', gap: 8 },
    children: [
      jsx(P.Button, {
        key: 'cancel',
        variant: 'outline',
        size: 'sm',
        disabled: props.busy,
        onClick: props.onCancel,
        children: props.t('dialog.cancel'),
      }),
      jsx(P.Button, {
        key: 'confirm',
        variant: 'primary',
        size: 'sm',
        disabled: props.busy || props.disabled === true,
        onClick: props.onConfirm,
        children: props.confirmText,
      }),
    ],
  })
}

// ────────────────────────────────────────────────────────────────────────────
// 三个弹窗
// ────────────────────────────────────────────────────────────────────────────

/** 重命名弹窗（会话 / 工作区共用；D10 的"重命名"，D14 的"重命名工作区"）。 */
function RenameDialog(props: {
  state: RenameState | null
  t: Translate
  onClose(): void
  onSubmit(value: string): void
}): ReactNode {
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const state = props.state

  useEffect(() => {
    if (state === null) return
    setDraft(state.value)
    inputRef.current?.focus()
  }, [state])

  if (state === null) return null
  const title = state.kind === 'session' ? props.t('dialog.renameSession') : props.t('dialog.renameWorkspace')
  const submit = (): void => {
    const value = draft.trim()
    if (value === '') return
    props.onSubmit(value)
  }
  return jsx(P.Modal, {
    open: true,
    onClose: props.onClose,
    title,
    closeLabel: props.t('dialog.cancel'),
    children: jsxs('div', {
      style: { display: 'flex', flexDirection: 'column', gap: 10, minWidth: 320 },
      children: [
        jsx('input', {
          key: 'input',
          ref: inputRef,
          value: draft,
          'aria-label': title,
          onChange: (event: Any) => { setDraft(String(event?.target?.value ?? '')) },
          onKeyDown: (event: Any) => { if (event.key === 'Enter') submit() },
          style: { ...fieldStyle(), fontSize: 14 },
        }),
        jsx(DialogActions, {
          key: 'actions',
          t: props.t,
          busy: false,
          confirmText: props.t('dialog.confirm'),
          disabled: draft.trim() === '',
          onCancel: props.onClose,
          onConfirm: submit,
        }),
      ],
    }),
  })
}

/**
 * 「添加工作区」路径输入兜底弹窗（2026-10-21 Fix3）。
 *
 * 何时出现：`bridge.pickDirectory()` 抛错（Desktop 原生桥与 `uiWorkspace.pickDirectory()`
 * **都不可用**，例如 Web 形态 `remote.directoryPicker` 缺席）。旧实现在这种场景
 * `catch { return null }` ⇒ 与「用户取消」不可区分 ⇒ **点击 `+` 毫无反应**。
 *
 * 这里让用户直接输入目录绝对路径，确认后走同一建档路径（`bridge.createWorkspace`，
 * 缺席时 `POST ROUTE_WORKSPACE_OPEN`）；失败在弹窗内显示错误，**绝不静默**。
 */
function AddWorkspaceDialog(props: {
  open: boolean
  t: Translate
  onClose(): void
  createWorkspace(path: string): Promise<void>
  onCreated(): void
}): ReactNode {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!props.open) return
    setDraft('')
    setBusy(false)
    setError(null)
    inputRef.current?.focus()
  }, [props.open])

  if (!props.open) return null

  const title = props.t('project.add')
  const submit = (): void => {
    const path = draft.trim()
    if (path === '' || busy) return
    setBusy(true)
    setError(null)
    void (async () => {
      try {
        await props.createWorkspace(path)
        props.onCreated()
      } catch (cause: unknown) {
        setError(cause instanceof Error ? cause.message : String(cause ?? ''))
      } finally {
        setBusy(false)
      }
    })()
  }

  return jsx(P.Modal, {
    open: true,
    onClose: props.onClose,
    title,
    closeLabel: props.t('dialog.cancel'),
    children: jsxs('div', {
      style: { display: 'flex', flexDirection: 'column', gap: 10, minWidth: 360 },
      children: [
        jsx('input', {
          key: 'path',
          ref: inputRef,
          value: draft,
          'aria-label': props.t('worktree.path'),
          placeholder: '/absolute/path/to/workspace',
          onChange: (event: Any) => { setDraft(String(event?.target?.value ?? '')) },
          onKeyDown: (event: Any) => { if (event.key === 'Enter') submit() },
          style: { ...fieldStyle(), fontSize: 13.5 },
        }),
        error === null
          ? null
          : jsx('div', {
              key: 'error',
              style: {
                fontSize: 12.5,
                color: 'var(--dsw-alias-state-error-primary, #d9534f)',
                wordBreak: 'break-all',
              },
              children: error,
            }),
        jsx(DialogActions, {
          key: 'actions',
          t: props.t,
          busy,
          confirmText: props.t('dialog.confirm'),
          disabled: draft.trim() === '',
          onCancel: props.onClose,
          onConfirm: submit,
        }),
      ].filter(present),
    }),
  })
}

/**
 * 新建 worktree 弹窗（D7）：分支名 + 是否新建分支 + 起始分支 + **只读路径预览**。
 *
 * 预览路径与宿主 `worktree-create` 的默认算法同构
 * （`<主仓父目录>/<主仓名>-<分支名 sanitize>`，`/` 与空格换成 `-`）。
 */
function CreateWorktreeDialog(props: {
  state: CreateState | null
  t: Translate
  onClose(): void
  onCreated(worktreePath: string | undefined, workspaceId: string | undefined): void
  /** **D10**：`ok:true` 但注册工作区失败时的可见提示（`null` 表示清除）。 */
  onWarning(message: string | null): void
  onError(message: string): void
  onBusy(text: string | null): void
  post(route: string, body: Record<string, unknown>): Promise<Any>
}): ReactNode {
  const [branch, setBranch] = useState('')
  const [createBranch, setCreateBranch] = useState(true)
  const [baseRef, setBaseRef] = useState('')
  const [busy, setBusy] = useState(false)
  const state = props.state
  const stateKey = state === null ? '' : `${state.repoPath}\u0000${state.label}`

  useEffect(() => {
    if (state === null) return
    setBranch('')
    setCreateBranch(true)
    setBaseRef(state.baseCandidates[0] ?? '')
    setBusy(false)
    // stateKey 是 state 的身份；用它做依赖避免每次渲染都重置表单。
  }, [stateKey, state])

  if (state === null) return null

  const t = props.t
  const repoPath = state.repoPath
  const trimmed = branch.trim()
  const sanitized = trimmed.replace(/[/\\]+/g, '-').replace(/\s+/g, '-')
  const preview = `${parentDirOf(repoPath)}/${baseName(repoPath)}-${sanitized !== '' ? sanitized : '<分支名>'}`
  const canSubmit = !busy && sanitized !== ''

  return jsx(P.Modal, {
    open: true,
    onClose: props.onClose,
    title: t('worktree.createTitle', { name: state.label }),
    closeLabel: t('worktree.cancel'),
    children: jsxs('div', {
      style: { display: 'flex', flexDirection: 'column', gap: 12, minWidth: 380 },
      children: [
        jsx(FieldRow, {
          key: 'branch',
          label: t('worktree.branchName'),
          children: jsx('input', {
            value: branch,
            'aria-label': t('worktree.branchName'),
            placeholder: 'feature/demo',
            onChange: (event: Any) => { setBranch(String(event?.target?.value ?? '')) },
            style: fieldStyle(),
          }),
        }),
        jsx(FieldRow, {
          key: 'mode',
          label: t('worktree.newBranch'),
          children: jsxs('div', {
            style: { display: 'flex', gap: 14 },
            children: [
              jsx(RadioOption, {
                key: 'new',
                id: 'wtg-new-branch',
                label: t('worktree.newBranch'),
                checked: createBranch,
                onSelect: () => { setCreateBranch(true) },
              }),
              jsx(RadioOption, {
                key: 'reuse',
                id: 'wtg-use-branch',
                label: t('worktree.useExisting'),
                checked: !createBranch,
                onSelect: () => { setCreateBranch(false) },
              }),
            ],
          }),
        }),
        createBranch && state.baseCandidates.length > 0
          ? jsx(FieldRow, {
              key: 'base',
              label: t('worktree.baseBranch'),
              children: jsx('select', {
                value: baseRef,
                'aria-label': t('worktree.baseBranch'),
                onChange: (event: Any) => { setBaseRef(String(event?.target?.value ?? '')) },
                style: { ...fieldStyle(), padding: '0 8px' },
                children: state.baseCandidates.map((candidate: string) =>
                  jsx('option', { key: candidate, value: candidate, children: candidate }),
                ),
              }),
            })
          : null,
        jsx(FieldRow, {
          key: 'path',
          label: t('worktree.path'),
          children: jsx('code', {
            style: {
              display: 'block',
              padding: '6px 10px',
              borderRadius: 8,
              background: 'var(--dsw-alias-bg-multi-select, rgba(127,127,127,0.08))',
              color: 'var(--dsw-alias-label-secondary, var(--dsw-alias-label-primary))',
              fontSize: 12,
              wordBreak: 'break-all',
            },
            children: preview,
          }),
        }),
        jsx('div', { key: 'hint', style: dimText(11.5), children: t('worktree.pathHint') }),
        jsx(DialogActions, {
          key: 'actions',
          t,
          busy,
          confirmText: busy ? t('worktree.creating') : t('worktree.confirm'),
          disabled: !canSubmit,
          onCancel: props.onClose,
          onConfirm: () => {
            setBusy(true)
            props.onBusy(t('worktree.creating'))
            void (async () => {
              try {
                const body = await props.post(ROUTE_WORKTREE_CREATE, {
                  repoPath,
                  branch: trimmed,
                  createBranch,
                  ...(createBranch && baseRef !== '' ? { baseRef } : {}),
                })
                if (body?.ok !== true) {
                  throw new Error(typeof body?.message === 'string' ? body.message : t('error.load'))
                }
                props.onClose()
                // **D10**：worktree 建成了（`ok:true`），但注册工作区可能失败 ——
                // 此时没有 `workspaceId`，也就不会有自动新会话。必须让这条「部分成功」
                // 对用户可见，否则界面表现得像完全成功而用户等不到新会话。
                if (typeof body.workspaceWarning === 'string' && body.workspaceWarning !== '') {
                  props.onWarning(t('worktree.workspaceWarning', { message: body.workspaceWarning }))
                } else {
                  props.onWarning(null)
                }
                props.onCreated(
                  typeof body.worktreePath === 'string' ? body.worktreePath : undefined,
                  typeof body.workspaceId === 'string' ? body.workspaceId : undefined,
                )
              } catch (error: unknown) {
                props.onError(error instanceof Error ? error.message : t('error.load'))
              } finally {
                setBusy(false)
                props.onBusy(null)
              }
            })()
          },
        }),
      ].filter(present),
    }),
  })
}

/**
 * 移除 worktree 弹窗（D8）。
 *
 * 两段式：先普通确认（文案已含"分支会保留"）；`worktree-remove` 返回
 * `{ ok:false, needsForce:true }` 时切到第二段，明示"有未提交改动，强制删除将丢失
 * 改动"，用户显式确认后带 `force:true` 重试（PRD R5）。
 */
function RemoveWorktreeDialog(props: {
  target: { path: string; label: string } | null
  t: Translate
  onClose(): void
  onRemoved(): void
  onError(message: string): void
  onBusy(text: string | null): void
  post(route: string, body: Record<string, unknown>): Promise<Any>
}): ReactNode {
  const [needsForce, setNeedsForce] = useState(false)
  const [busy, setBusy] = useState(false)
  const target = props.target
  const targetPath = target?.path ?? ''

  useEffect(() => {
    setNeedsForce(false)
    setBusy(false)
  }, [targetPath])

  if (target === null) return null

  const t = props.t
  const run = (force: boolean): void => {
    setBusy(true)
    props.onBusy(t('worktree.removing'))
    void (async () => {
      try {
        const body = await props.post(ROUTE_WORKTREE_REMOVE, {
          path: target.path,
          ...(force ? { force: true } : {}),
        })
        if (body?.ok === true) {
          props.onClose()
          props.onRemoved()
          return
        }
        if (body?.needsForce === true) {
          setNeedsForce(true)
          return
        }
        throw new Error(typeof body?.message === 'string' ? body.message : t('error.load'))
      } catch (error: unknown) {
        props.onError(error instanceof Error ? error.message : t('error.load'))
      } finally {
        setBusy(false)
        props.onBusy(null)
      }
    })()
  }

  return jsx(P.Modal, {
    open: true,
    onClose: props.onClose,
    title: t('worktree.remove'),
    closeLabel: t('dialog.cancel'),
    children: jsxs('div', {
      style: { display: 'flex', flexDirection: 'column', gap: 10, minWidth: 340 },
      children: [
        jsx('div', {
          key: 'confirm',
          style: { fontSize: 13 },
          children: t('worktree.removeConfirm', { name: target.label }),
        }),
        jsx('div', { key: 'path', style: { ...dimText(12), wordBreak: 'break-all' }, children: target.path }),
        jsx('div', { key: 'keep', style: dimText(12), children: t('worktree.removeKeepBranch') }),
        needsForce
          ? jsxs('div', {
              key: 'force',
              style: {
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid var(--dsw-alias-state-warn-primary, #d19a2f)',
              },
              children: [
                jsx('span', {
                  key: 'dirty',
                  style: { fontSize: 12.5, color: 'var(--dsw-alias-state-warn-primary, #d19a2f)' },
                  children: t('worktree.dirty'),
                }),
                jsx('span', { key: 'loss', style: dimText(12), children: t('worktree.forceRemove') }),
              ],
            })
          : null,
        jsx(DialogActions, {
          key: 'actions',
          t,
          busy,
          confirmText: needsForce ? t('worktree.forceRemove') : t('dialog.confirm'),
          onCancel: props.onClose,
          onConfirm: () => { run(needsForce) },
        }),
      ].filter(present),
    }),
  })
}

// ────────────────────────────────────────────────────────────────────────────
// 错误边界（R2：绝不白屏）
// ────────────────────────────────────────────────────────────────────────────

/** React 错误边界必须用 class（hooks 捕获不到子组件抛错）。 */
class SidebarBoundary extends Component<{ children?: ReactNode }, { error: unknown }> {
  /** 当前捕获的错误；`null` = 正常渲染。 */
  public state: { error: unknown } = { error: null }

  /** 捕获子树异常并切到错误 UI —— 不让它逃到宿主 `SlotErrorBoundary`。 */
  public static getDerivedStateFromError(error: unknown): { error: unknown } {
    return { error }
  }

  /** 打到控制台，便于在宿主日志里定位根因。 */
  public componentDidCatch(error: unknown): void {
    console.error('[dsh-worktree-groups] sidebar render failed:', error)
  }

  /** 渲染子树，或"可读错误 + 重试"。 */
  public render(): ReactNode {
    if (this.state.error === null) return this.props.children ?? null
    const detail = this.state.error instanceof Error ? this.state.error.message : String(this.state.error)
    return jsxs('div', {
      style: { padding: 12, display: 'flex', flexDirection: 'column', gap: 8, color: 'var(--dsw-alias-label-primary)' },
      children: [
        jsx('div', { key: 'title', style: { fontSize: 13, fontWeight: 600 }, children: FALLBACK_T('error.title') }),
        jsx('div', { key: 'detail', style: { fontSize: 12, opacity: 0.8, wordBreak: 'break-all' }, children: detail }),
        jsx('button', {
          key: 'retry',
          type: 'button',
          onClick: () => { this.setState({ error: null }) },
          style: {
            alignSelf: 'flex-start',
            padding: '3px 12px',
            border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.3))',
            borderRadius: 12,
            background: 'transparent',
            color: 'inherit',
            fontFamily: 'inherit',
            fontSize: 12,
            cursor: 'pointer',
          },
          children: FALLBACK_T('error.retry'),
        }),
      ],
    })
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 主组件
// ────────────────────────────────────────────────────────────────────────────

/**
 * 侧栏主组件（契约 §2.3）：包一层错误边界后交给内部实现。
 *
 * @param props 槽位 owner / standard kit / entry inject 合并后的 props（§B1.2）。
 * @returns 侧栏三级树；`wide === false` 时为 36px 轨道入口。
 */
export function SidebarBrowser(props: SidebarProps): ReactNode {
  return jsx(SidebarBoundary, { children: jsx(SidebarBrowserInner, props) })
}

/**
 * 四个宿主快照 source 的（首渲染冻结的）函数组。
 *
 * `status` 是「等待确认 / 后台完成未读」的现行来源（`useSessionStatus`）；
 * `pending` 只是**旧宿主**（`0.1.5-rc.2`）的兜底，见 `./live-state.js`。
 */
interface SnapshotSources {
  sessions: (selector: Any) => Any
  workspaces: (selector: Any) => Any
  /** `useSessionStatus`：`Map<id, { running, pendingInteraction, completionUnread }>`。 */
  status: (selector: Any) => Any
  /** 旧源 `useSessionPendingInteraction`（0.2.1 起已不存在）。 */
  pending: (selector: Any) => Any
  /** `usePanelInfo`：用于判断是否有其它面板占据主视图（0.2.1 当前会话判定）。 */
  panelInfo: (selector: Any) => Any
}

/**
 * 把 prop 上的 source 收窄成 hook 函数；缺席时用同签名占位。
 *
 * 占位**不是** hook（它不调任何 React API），但只在宿主根本没给这个 source 时使用，
 * 且选择结果被 {@link SidebarBrowserInner} 冻结在首次渲染 —— 因此内部 hook 数量恒定。
 *
 * @param candidate `props.useXxx`（未知类型）。
 * @returns 可调用的选择器 hook。
 */
function asHook(candidate: unknown): (selector: Any) => Any {
  return typeof candidate === 'function' ? (candidate as (selector: Any) => Any) : directSource
}

/** `props.useXxx` 缺席时的同签名占位（宿主无该 source ⇒ 恒 undefined）。 */
function directSource(selector: (value: undefined) => Any): Any {
  return selector(undefined)
}

/** 恒等选择器：我们只关心"快照变了"，不做细粒度选择。 */
function identity(value: Any): Any {
  return value
}

/**
 * 内部实现（错误边界内）。
 *
 * 数据流：宿主快照变化（`useSessions` / `useWorkspaces`）⇒ 防抖重取
 * `POST /dsh-worktree-groups/tree` ⇒ `buildRows()` ⇒ `RenderRow[]` ⇒ 画。
 * 另加 30s 定时 + 窗口聚焦强刷（PRD D13）。
 */
function SidebarBrowserInner(props: SidebarProps): ReactNode {
  // 取词：seat 存在 ⇒ 包一层兜底（`createSeatT`），seat 缺席 ⇒ 内置中文表。
  //
  // ⚠️ **为什么 seat 也要兜底**（2026-09-23 用户报告「右键所有菜单都变成英文 key」）：
  // entry 声明了 `locale` ⇒ renderer 的 `standardKit` **一定**给 `t`（`localeSeat`），
  // 所以下面这个 `FALLBACK_T` 分支在真实组合里**永远走不到**。而宿主 seat 的解析规则是
  // 「本命名空间查不到 → 查 `common` → 还查不到就**返回 key 本身**」
  // （`dsh-client-locale` 的 `translate`）。词典注册一旦错过时机（见 `client.tsx` 的
  // `ctx.inject(['locale'], …)` 注释），侧栏每个取词点都会把 key 当文案渲染：
  // 菜单项 `menu.newSession`、按钮 title `worktree.menu`、搜索占位符 `search.placeholder`…
  // `createSeatT` 只认「seat 返回的就是 key」这一种未解析信号，其余一律逐字透传。
  const seat = props.t
  const t: Translate = typeof seat === 'function' ? createSeatT(seat as Translate) : FALLBACK_T
  const bridge = props.bridge as SidebarBridge | undefined

  const wide = readBoolean(props, 'wide')
  const expandSidebar = readFunction(props, 'expandSidebar')
  const renderSlot = readFunction(props, 'renderSlot')

  // ── 宿主快照订阅 ────────────────────────────────────────────────────
  // `useSessions` / `useWorkspaces` / `useSessionStatus` 是全局 root source，白送
  // （§B1.3）；它们是**真正的 React hook**，必须无条件、按同一顺序调用。
  //
  // 用 `useRef` 在**首渲染**把四个 source 冻结下来：`props.useSessions` 现在是函数、
  // 下一帧变成 undefined（或反之）会让 `useSyncExternalStore` 的内部 hook 数量变化，
  // 触发 "Rendered fewer hooks than expected" ⇒ 整棵侧栏被错误边界接管。
  // 冻结后 hook 数量在整个组件生命周期内恒定。
  //
  // ⚠️ **2026-10-19**：`useSessionStatus` 是「等待确认 / 后台完成未读」的**现行**来源
  // （宿主 `0.2.1-rc.2` 删掉了 `useSessionPendingInteraction` 与 `byId[].completed`）。
  // 它同样经 `asHook` 兜底：宿主若再改，缺席只会让这两个态不亮，**不会崩**。
  const sourcesRef = useRef<SnapshotSources | null>(null)
  if (sourcesRef.current === null) {
    sourcesRef.current = {
      sessions: asHook(props.useSessions),
      workspaces: asHook(props.useWorkspaces),
      status: asHook(props.useSessionStatus),
      pending: asHook(props.useSessionPendingInteraction),
      panelInfo: asHook(props.usePanelInfo),
    }
  }
  const sources = sourcesRef.current

  const sessionsSnapshot = sources.sessions(identity) as SessionsSnapshot | undefined
  // 订阅工作区快照：树数据本身走 HTTP，这里只为驱动"重取"。
  sources.workspaces(identity)
  // D2：两个 live-fact 快照的**返回值必须真正读出来** —— 只调用不接收会让订阅变死代码。
  // 无条件订阅（hook 调用顺序恒定），取值只在渲染会话行时用（见 `withLiveState`）。
  const sessionStatus = sources.status(identity)
  // 运行中任务高亮（2026-10-20）：第 4 条重取触发的**纯值**信号（只认 running===true）。
  // 与 `sessionStatus` 并排派生，不新增 hook、不改变 hook 调用顺序。
  const runningSignatureValue = runningSignature(sessionStatus)
  const pendingInteractions = sources.pending(identity)
  const panelInfoSnapshot = sources.panelInfo(identity)

  const [optimisticSessionId, setOptimisticSessionId] = useState<string | undefined>(undefined)

  const currentSessionId = currentSessionIdOf({
    sessions: sessionsSnapshot,
    panelInfo: panelInfoSnapshot,
    optimisticSessionId,
  })

  // ── 展开态（D12）：collapsed = 显式折叠过的 key；expandedAll = 点过「展开其余」。 ──
  const [collapsedKeys, setCollapsedKeys] = useState<Record<string, boolean>>(() => readFlagMap(LS_COLLAPSED))
  const [expandLevels, setExpandLevels] = useState<Record<string, number>>(() => readLevelMap(LS_EXPAND_LEVELS))
  const [archivedMap, setArchivedMap] = useState<Record<string, ArchivedWorkspaceItem>>(() => readArchivedProjectsMap())
  const [query, setQuery] = useState('')

  // ── 手动排序（D10）──────────────────────────────────────────────────
  // 首次渲染从 localStorage 读；`manual !== true` 时 buildRows 完全走默认顺序。
  const [manualOrder, setManualOrder] = useState<ManualOrder>(() => readManualOrder())
  /**
   * **顶部区运行时状态（T11，D3e）**：`running` 轨迹 / `新会话` / 落表台账。
   *
   * **纯内存态**：初值 {@link initialTopZoneState}，刷新页面即重置。
   * 除 D2 的「新会话插入固化表」（见下方独立 effect）外，它**不写** `localStorage`。
   *
   * ⚠️ **T11（2026-09-22 用户终裁）**：此前的「刚结束保留」（`recentlyFinishedIds`）与
   * 「已拖动容器」（`releasedContainerKeys`）两个字段已**删除** —— 用户明确「只要是结束了
   * 的会话就不再固定置顶了」，故运行时状态里不再有任何「已结束会话仍要置顶」的信息。
   */
  const [topZoneState, setTopZoneState] = useState<TopZoneState>(initialTopZoneState)
  /** 正在进行的拖拽；`null` = 没有。 */
  const [drag, setDrag] = useState<DragState | null>(null)
  /** 会话行处理器的稳定容器（2026-11-14 行 memo 化；见 `SessionRowProps` 的 ⚠️）。 */
  const sessionHandlersRef = useRef<Map<string, SessionRowHandlers>>(new Map())
  /** 当前落点（行 key + 上下半）；`null` = 不画插入线。 */
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)

  // ── 树数据 / 弹窗状态 ───────────────────────────────────────────────
  const [serverTree, setTree] = useState<TreeResponse | null>(null)
  /**
   * **PERF6（2026-11-14）**：服务端树 + 宿主实时会话快照的叠加结果。
   *
   * 新建会话、改标题、运行态变化**立即**体现在侧栏，不必等 `/tree` 往返；`pendingIds`
   * （实时快照有、服务端树还没有的顶层会话）作为防抖重取的触发信号。下游一律消费 `tree`
   * （即叠加后的树）；无变化时 `mergeLiveSessions` 返回同一引用，下游 memo 全部短路。
   */
  const merged = useMemo(
    () => (serverTree === null ? null : mergeLiveSessions(serverTree, sessionsSnapshot)),
    [serverTree, sessionsSnapshot],
  )
  const tree: TreeResponse | null = merged === null ? null : merged.tree
  const pendingLiveSignature = merged === null ? '' : merged.pendingIds.join(',')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busyText, setBusyText] = useState<string | null>(null)
  /** **D10**：非阻塞的「部分成功」提示（与 `loadError` 分开，因后者会替换整棵树）。 */
  const [notice, setNotice] = useState<string | null>(null)
  const [menuTarget, setMenuTarget] = useState<MenuTarget | null>(null)
  const [renameState, setRenameState] = useState<RenameState | null>(null)
  const [createState, setCreateState] = useState<CreateState | null>(null)
  const [removeTarget, setRemoveTarget] = useState<{ path: string; label: string } | null>(null)
  /**
   * 「添加工作区」兜底弹窗（2026-10-21 Fix3）。
   *
   * 原生目录选择器不可用或报错时打开，让用户手输目录绝对路径 ——
   * 任何情况下都不允许「点击 `+` 无反应」。
   */
  const [addWorkspaceOpen, setAddWorkspaceOpen] = useState(false)

  // ── 取树 ────────────────────────────────────────────────────────────
  // PERF5（2026-11-14）：**不再「abort 上一次再重发」**。旧实现在会话快照频繁变化时
  // 不断中止在途请求，而单次请求要 0.7 s 以上 ⇒ 活跃期内请求可能一直完不成（新会话迟迟
  // 不出现）。现在同一时刻至多一个在途请求；期间的新触发只记一个「尾随」标记，在途请求
  // 结束后立即补发一次。卸载时才 abort。
  // PERF4：带 `If-None-Match`，304 时什么都不做（不解析、不 setState、不重渲染）。
  const inflightRef = useRef<AbortController | null>(null)
  const trailingRef = useRef(false)
  const etagRef = useRef<string | null>(null)
  const reload = useCallback((): void => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    if (inflightRef.current !== null) {
      trailingRef.current = true
      return
    }
    const controller = new AbortController()
    inflightRef.current = controller
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (etagRef.current !== null) headers['if-none-match'] = etagRef.current
    const finish = (): void => {
      if (inflightRef.current !== controller) return
      inflightRef.current = null
      if (trailingRef.current && !controller.signal.aborted) {
        trailingRef.current = false
        reloadRef.current()
      }
    }
    void fetch(ROUTE_TREE, {
      method: 'POST',
      headers,
      body: '{}',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 304) return undefined
        const etag = response.headers?.get?.('etag')
        const body = (await response.json()) as Any
        if (body?.ok === true) etagRef.current = typeof etag === 'string' && etag !== '' ? etag : null
        return body
      })
      .then((body: Any) => {
        if (controller.signal.aborted) return
        if (body === undefined) {
          setLoadError(null)
          return
        }
        if (body?.ok !== true) {
          throw new Error(typeof body?.message === 'string' ? body.message : t('error.load'))
        }
        const projects = Array.isArray(body.projects) ? (body.projects as ProjectNodeLike[]) : []
        latestKnownProjects = projects
        setTree({
          projects,
          ungrouped: Array.isArray(body.ungrouped) ? (body.ungrouped as SessionRowLike[]) : [],
          archivedSessionIds: Array.isArray(body.archivedSessionIds) ? (body.archivedSessionIds as string[]) : [],
          ...(Array.isArray(body.archivedProjects)
            ? { archivedProjects: body.archivedProjects as ArchivedWorkspaceItem[] }
            : {}),
          ...(typeof body.workspaceByPath === 'object' && body.workspaceByPath !== null
            ? { workspaceByPath: body.workspaceByPath as Record<string, string> }
            : {}),
        })
        setLoadError(null)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        etagRef.current = null
        setLoadError(error instanceof Error ? error.message : t('error.load'))
      })
      .finally(finish)
  }, [t])
  /** 尾随重取走最新的 `reload`（`t` 变化会换引用）。 */
  const reloadRef = useRef(reload)
  reloadRef.current = reload

  // 结构性变化 ⇒ 防抖重取。
  // 2026-10-20：`runningSignatureValue`（运行集合签名）是触发源之一 —— 宿主
  // `useSessionStatus` 在 `agent/status` 迁移时发布快照，签名只在「运行集合」变化时变，
  // 经 220 ms 防抖合并后重取。⚠️ **不得**把它放进 `reload` 的 `useCallback` 依赖：
  // 那会在每次状态迁移时重建 `reload`，下方轮询 effect 被反复重置成「每 220 ms 一次」。
  // 2026-11-14 PERF6：不再依赖整份 `sessionsSnapshot`（它随任何会话字段变化而换引用，
  // 活跃期内几乎每帧都变）；改为 `pendingLiveSignature` —— 只有出现服务端树里还没有的
  // 顶层会话时才变。标题 / 运行态 / updatedAt 已由实时叠加层即时呈现，无需重取。
  useEffect(() => {
    const timer = setTimeout(reload, RELOAD_DEBOUNCE_MS)
    return () => { clearTimeout(timer) }
  }, [reload, pendingLiveSignature, currentSessionId, runningSignatureValue])

  // 首拉 + 5s 轮询（隐藏时跳过）+ 窗口聚焦 / 重新可见强刷（D13）+ 归档工作空间变更即时刷新。
  useEffect(() => {
    reload()
    const interval = setInterval(reload, TREE_REFRESH_MS)
    const onFocus = (): void => {
      setArchivedMap(readArchivedProjectsMap())
      reload()
    }
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') reload()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    archiveListeners.add(onFocus)
    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
      archiveListeners.delete(onFocus)
      inflightRef.current?.abort()
      inflightRef.current = null
    }
  }, [reload])

  // ── 动作面：宿主 props 优先，bridge（ctx 服务）兜底 ─────────────────
  const actions = useMemo<Actions>(() => ({
    openSession: (sessionId) => {
      const open = readFunction(props, 'open')
      if (open !== undefined) { open(sessionId); return }
      bridge?.openSession(sessionId)
    },
    // 2026-10-22 DR1：`options` 必须两条路径都原样转发 —— 宿主 props（若某个组合注入了
    // `startSession`）与 bridge 都只认「第二参非 undefined 才复用空白会话」的语义。
    startSession: (workspaceId, options) => {
      const start = readFunction(props, 'startSession')
      if (start !== undefined) { start(workspaceId, options); return }
      bridge?.startSession(workspaceId, options)
    },
    renameSession: async (sessionId, title) => {
      const rename = readFunction(props, 'renameSession')
      if (rename !== undefined) { await rename(sessionId, title); return }
      await bridge?.renameSession(sessionId, title)
    },
    archiveSession: async (sessionId) => {
      const archive = readFunction(props, 'archiveSession')
      if (archive !== undefined) { await archive(sessionId); return }
      await bridge?.archiveSession(sessionId)
    },
    forkSession: async (sessionId) => {
      const fork = readFunction(props, 'forkSession')
      if (fork !== undefined) { await fork(sessionId); return }
      await bridge?.forkSession(sessionId)
    },
    renameWorkspace: async (workspaceId, title) => {
      const rename = readFunction(props, 'renameWorkspace')
      if (rename !== undefined) { await rename(workspaceId, title); return }
      await bridge?.renameWorkspace(workspaceId, title)
    },
    pickDirectory: async () => {
      // 2026-10-21 Fix4（T-8 审查返工）：**只做目录选择**。`bridge` 缺席时显式抛错
      // （`bridge?.pickDirectory()` 返回 `undefined` 会把「不可用」伪装成「用户取消」），
      // 宿主异常也原样上抛 —— 两者都由 `addWorkspace` 回调的选择阶段 catch 转成弹窗兜底。
      if (bridge === undefined) throw new Error('directory-picker/unavailable')
      return await bridge.pickDirectory()
    },
    createWorkspace: async (path) => {
      const trimmed = path.trim()
      if (trimmed === '') throw new Error('workspace path is empty')
      if (bridge !== undefined) {
        await bridge.createWorkspace(trimmed)
        return
      }
      // bridge 缺席（无 `workspaces` 服务）⇒ 回退宿主路由。
      const body = await postJson(ROUTE_WORKSPACE_OPEN, { path: trimmed })
      if (body?.ok !== true) {
        throw new Error(typeof body?.message === 'string' ? body.message : 'workspace-open failed')
      }
    },
    post: postJson,
  }), [props, bridge])

  // ── 展开态操作 ──────────────────────────────────────────────────────
  /**
   * 清零若干容器的展开层级（PX3：折叠工作区 / worktree / 「最近」时调用）。
   * `latestKnownProjects` 是最近一次服务端树，用来推导项目下的全部容器 key。
   */
  const resetExpandLevels = useCallback((keys: readonly string[]): void => {
    setExpandLevels((previous) => {
      let next: Record<string, number> | undefined
      for (const key of keys) {
        if (previous[key] === undefined) continue
        next ??= { ...previous }
        delete next[key]
      }
      if (next === undefined) return previous
      writeLevelMap(LS_EXPAND_LEVELS, next)
      return next
    })
  }, [])

  const toggleCollapsed = useCallback((key: string): void => {
    // PX3：收起工作区 / worktree / 「最近」⇒ 其下全部容器自动折回默认 5 条。
    // 判定用渲染期的 `collapsedKeys`（不在 setState 更新器里做副作用）。
    if (collapsedKeys[key] !== true) resetExpandLevels(containerKeysUnder(latestKnownProjects, key))
    setCollapsedKeys((previous) => {
      const next = { ...previous }
      if (next[key] === true) delete next[key]
      else next[key] = true
      writeFlagMap(LS_COLLAPSED, next)
      return next
    })
  }, [collapsedKeys, resetExpandLevels])

  const expandKeys = useCallback((keys: string[]): void => {
    setCollapsedKeys((previous) => {
      const next = { ...previous }
      let changed = false
      for (const key of keys) {
        if (next[key] === true) { delete next[key]; changed = true }
      }
      if (!changed) return previous
      writeFlagMap(LS_COLLAPSED, next)
      return next
    })
  }, [])

  /** PX1：「展开更多」⇒ 该容器层级 +1。 */
  const expandMore = useCallback((key: string): void => {
    setExpandLevels((previous) => {
      const next = { ...previous, [key]: (previous[key] ?? 0) + 1 }
      writeLevelMap(LS_EXPAND_LEVELS, next)
      return next
    })
  }, [])

  /**
   * 新会话（懒注册，D5）：未注册的 worktree 先 `workspace-open` 拿 id，再 `startSession`。
   *
   * **2026-10-22 DR1**：第二参固定传 {@link SAME_LOCATION_START_SESSION} —— 该目录下已有
   * 空白会话（可能带未发送草稿）时宿主会复用它的 `sessionId`，草稿随对话区一起恢复；
   * 不传第二参则宿主每次都铸新空白会话，旧 blank 会话被 `sessionVisible()` 隐藏 ⇒ 草稿"消失"。
   */
  const newSession = useCallback((extra: WorktreeExtra): void => {
    void (async () => {
      try {
        let workspaceId = extra.workspaceId
        if (workspaceId === undefined) {
          const body = await actions.post(ROUTE_WORKSPACE_OPEN, { path: extra.path })
          if (body?.ok !== true || typeof body.workspaceId !== 'string') {
            throw new Error(typeof body?.message === 'string' ? body.message : t('error.load'))
          }
          workspaceId = body.workspaceId as string
        }
        actions.startSession(workspaceId, SAME_LOCATION_START_SESSION)
        reload()
      } catch (error: unknown) {
        setLoadError(error instanceof Error ? error.message : t('error.load'))
      }
    })()
  }, [actions, reload, t])

  /**
   * 添加工作区（D19 / 裁定 5）：顶部独立按钮的入口，逻辑与原先「菜单项」完全一致。
   *
   * 2026-10-21 Fix3：原生目录选择器**不可用或报错**时（`bridge.pickDirectory()` 抛
   * `directory-picker/unavailable` 或宿主异常）打开 {@link AddWorkspaceDialog} 让用户
   * 手输路径。旧实现在这里 `catch` 后只写 `loadError`，而 bridge 又把异常吞成 `null`
   * ⇒ 用户看到的是「点击毫无反应」。用户主动取消（`null`）仍安静返回，不弹窗。
   *
   * 2026-10-21 Fix4（T-8 审查返工）：**目录选择**与 **createWorkspace** 拆成两段
   * 独立 `try/catch` —— 选择阶段失败只弹手输路径弹窗，创建阶段失败落 `loadError` 行。
   * 旧实现把两段合在一个 `try` 里：选择成功但建档抛错时会误开空白
   * `AddWorkspaceDialog` 并吞掉真实的建档错误（违背 `docs/INTERFACES.md`
   * 「宿主 createWorkspace 失败落 loadError 行」）。
   */
  const addWorkspace = useCallback((): void => {
    void (async () => {
      // 第一段：目录选择。抛错（选择器不可用 / bridge 缺席）⇒ 弹窗手输兜底；
      // 返回空值（用户取消）⇒ 安静返回，绝不弹窗。
      let picked: string
      try {
        const selected = await actions.pickDirectory()
        if (typeof selected !== 'string' || selected === '') return
        picked = selected
      } catch {
        setAddWorkspaceOpen(true)
        return
      }
      // 第二段：建档。失败必须落 `loadError` 行（宿主 createWorkspace 的真实错误）。
      try {
        await actions.createWorkspace(picked)
        reload()
      } catch (error: unknown) {
        setLoadError(error instanceof Error ? error.message : t('error.load'))
      }
    })()
  }, [actions, reload, t])

  // ── 树模型 ──────────────────────────────────────────────────────────
  /**
   * **顶部区观测（T5）**：树数据一变，就把**全部**会话投影成观测批次喂给状态机。
   *
   * `observeTopZone` 是纯函数且**无变化时返回同一引用** ⇒ 这个 effect 不会造成
   * 无限重渲染（`setTopZoneState` 收到相同引用时 React 直接 bail out）。
   *
   * ⚠️ 依赖 `tree` 而不是 `treeInput`：观测只需要原始树（`observationsOf` 自己建
   * 子代理索引），且 `treeInput` 依赖 `topZoneState` —— 若依赖它会形成循环。
   */
  useEffect(() => {
    if (tree === null) return
    setTopZoneState((previous) =>
      observeTopZone(
        previous,
        observationsOf({
          projects: tree.projects,
          ungrouped: tree.ungrouped,
          archivedSessionIds: tree.archivedSessionIds,
        }),
        Date.now(),
      ),
    )
  }, [tree])

  /** 渲染期顶部区输入（纯运行时；`effectiveOrder` 永不消费它）。 */
  const topZone = useMemo(() => topZoneInputOf(topZoneState), [topZoneState])

  /**
   * `buildRows` / `effectiveOrder` 的**同一份**入参。
   *
   * 两处必须同源：`effectiveOrder` 的容器 key 推导与 `buildRows` 完全一致才能保证
   * 拖拽写下来的 key 在渲染时读得到。所以这里只构造一次，两个消费者共用。
   *
   * ⚠️ `topZone` **只进 `buildRows`**：`effectiveOrder` 内部把 `context.topZone` 硬置
   * `undefined`（见那里的注释），从结构上保证运行时顶部区不混进持久顺序。
   *
   * ⚠️ `currentSessionId` 仍在入参里，但它**只**服务两件事：① 行上的 `isCurrent` 高亮；
   * ② blank 会话「只显示当前那一条」。**T11 起它不再参与任何置顶判定**（「当前会话置顶」
   * 已按用户终裁删除）。
   */
  const archivedProjectKeys = useMemo<string[]>(() => {
    const keys = new Set<string>(Object.keys(archivedMap))
    for (const item of tree?.archivedProjects ?? []) {
      if (typeof item?.key === 'string' && item.key !== '') keys.add(item.key)
    }
    return [...keys]
  }, [archivedMap, tree])

  const treeInput = useMemo<SidebarModelInput>(() => ({
    projects: tree?.projects ?? [],
    ungrouped: tree?.ungrouped ?? [],
    archivedSessionIds: tree?.archivedSessionIds ?? [],
    collapsedKeys,
    expandedAllKeys: {},
    expandLevels,
    query,
    titleOf: defaultTitleOf,
    t,
    manualOrder,
    topZone,
    includeRecent: true,
    archivedProjectKeys,
    ...(currentSessionId === undefined ? {} : { currentSessionId }),
  }), [tree, collapsedKeys, expandLevels, query, t, manualOrder, topZone, archivedProjectKeys, currentSessionId])

  const view = useMemo<TreeView>(
    () => buildTreeView(tree, treeInput),
    [tree, treeInput],
  )

  /**
   * **D2 落表（T5）**：新会话出现时，把它插到其所属容器固化顺序表的**最前**。
   *
   * ## 为什么这是对「运行时置顶不写持久顺序」的一处**有意例外**
   *
   * 用户裁决 D2 明确要求「新会话总是插入其所属 worktree 容器内的最前位置，**并且要写入
   * 持久固化顺序表**」。理由：新会话是**持久结构变化**（不是运行时状态）—— 用户下次
   * 打开侧栏时它仍应在他预期的位置，而不是因为「固化表里没有它」被 `applyManualOrder`
   * 追加到末尾。
   *
   * ## 边界（判据全部由 {@link planNewSessionInserts} / {@link insertSessionAtFront} 保证，
   * 此处只负责编排）
   *
   * - **只在手动模式下写**：`manual !== true` ⇒ `planNewSessionInserts` 原样返回
   *   ⇒ 不写、**不建表**。绝不因为「新建了一个会话」就把用户静默切成手动排序模式
   *   （用户明确表示他会自己点一次「恢复默认排序」）。
   * - **幂等**：已在表首 ⇒ 不产生 `localStorage` 写入。
   * - **收敛（T6 缺陷 B2 / T9 缺陷 1）**：本 effect 的依赖含 `manualOrder` ⇒ **用户每次
   *   拖拽都会重跑**。台账 `TopZoneState.writtenNewSessionIds`（{@link markNewSessionsWritten}）
   *   记「落表意图已满足」的新会话 ⇒ 下次重跑时 `planNewSessionInserts` 跳过它
   *   ⇒ **同一个新会话的落表只发生一次**。
   *   ⚠️ 不能改为「落表后从 `newSessionIds` 移除」—— 那是 D3d 的顶部区输入，新会话在
   *   整个页面会话内都应被提升到容器顶部区。
   *
   *   ⚠️ **T9 缺陷 1（真人 GUI 复验的「拖动新会话弹回原位」）**：台账有**两个**作用，
   *   缺一不可 ——
   *   1. **不重复写持久表**（B2，上面这条）；
   *   2. **已落表的新会话不再被渲染期提升**（`topZoneInputOf` 把台账投影进
   *      {@link TopZoneInput.writtenNewSessionIds}，`topZoneSessionKeys` 据此把它排除出
   *      顶部区）。因为「新会话在容器最前」已由**持久顺序**承载（本 effect 写进去了），
   *      渲染期再提升一次会让用户随后的拖拽被**静默回滚**：用户把它拖到分组内其他位置，
   *      `buildRows` 仍按顶部区把它画回最前 —— 看起来就是「弹回原位」。
   *      ⇒ 只有第 1 条时，持久表确实没被改写，但**渲染结果**仍是回弹；两条合起来才是
   *      「用户拖到哪就留在哪」。
   * - **写入形态正确（T6 缺陷 B1）**：`planNewSessionInserts` 用 `placementOfSession` 取
   *   **树里的真实 id 形态**（宿主真实 id 恒带 `session-` 前缀）再写入，绝不写入归一化后的
   *   裸 id（那会变成永远匹配不上的死条目，并顶掉原本正确的条目）。
   * - **只写新会话**：`running` 与新会话提升本身一律**不进表**（它们是运行时推导，
   *   见 `topZoneSessionKeys`）。
   * - **容器归属与渲染同源**：用**不含 `manualOrder` 的纯默认顺序** `effectiveOrder(...)`
   *   的 `sessions` 表反查容器 key，不自己重推归属。
   * - **不修改用户数据**：只在用户**已经**处于手动模式时追加一条他自己的新会话；不碰
   *   其他容器的表、不动 `projects` / `worktrees`。
   */
  useEffect(() => {
    if (manualOrder.manual !== true) return
    // B2 收敛：待落表队列为空（全部已消费）⇒ 直接早退，连容器归属都不重算。
    // 用户拖动新会话时 `manualOrder` 变化会重跑本 effect，但队列已空 ⇒ **不改写任何东西**。
    if (pendingNewSessionIdsOf(topZoneState).length === 0) return
    if (tree === null) return
    // 容器归属：用「不含 manualOrder 的纯默认顺序」反查（容器划分与渲染同源）。
    // ⚠️ 这里只从 `tree` 构造最小输入（不依赖 `treeInput`）—— `treeInput` 每次
    // 查询串 / 折叠态变化都会换引用，而容器划分只取决于树数据本身。这样 effect
    // 只在「树变了 / 手动顺序变了 / 新会话集合变了」时重跑，不在每次敲搜索框时重跑。
    const defaults = effectiveOrder({
      projects: tree.projects,
      ungrouped: tree.ungrouped,
      archivedSessionIds: tree.archivedSessionIds,
      collapsedKeys: {},
      expandedAllKeys: {},
      query: '',
      titleOf: defaultTitleOf,
      t,
      manualOrder: undefined,
    })
    const plan = planNewSessionInserts(
      manualOrder,
      defaults.sessions,
      topZoneState.newSessionIds,
      topZoneState.writtenNewSessionIds,
    )
    // B2 收敛：无论是否真的写表，只要「落表意图已满足」（含幂等分支）就记台账，
    // 否则每次拖拽都会重新走一遍判断；记台账保证「只发生一次」。
    if (plan.consumed.length > 0) {
      const consumed = plan.consumed
      setTopZoneState((previous) => markNewSessionsWritten(previous, consumed))
    }
    if (!plan.changed) return
    // 只写 `localStorage` + state；不复用 `commitDrag`（那会把「拖拽」的语义混进来）。
    setManualOrder(plan.order)
    writeManualOrder(plan.order)
  }, [topZoneState.newSessionIds, topZoneState.writtenNewSessionIds, manualOrder, tree, t])

  // ── 拖拽排序（D10）──────────────────────────────────────────────────
  /** 写手动顺序：同时更新 state（立即重排）与 `localStorage`（跨刷新保持）。 */
  const persistOrder = useCallback((next: ManualOrder): void => {
    setManualOrder(next)
    writeManualOrder(next)
  }, [])

  /**
   * 提交一次拖拽：把「当前完整顺序 + 落点」换算成新的手动顺序并持久化。
   *
   * **首次拖拽即固化全量顺序**：这是「拖拽后新消息不再把会话顶到前面」这条承诺的实现
   * 方式 —— 只挪一项、其余仍按 `updatedAt` 排的话，下一条新消息照样会顶上来，用户会
   * 认为排序没生效。固化用的输入是 `effectiveOrder(treeInput)`，即**不带 `manualOrder`
   * 的纯默认顺序**（`manualOrder` 为假时它天然如此），所以「第一次拖拽写下来的就是
   * 用户当时看到的顺序」。
   *
   * 范围约束在**计算侧**保证：
   * - `session`：顺序表取自 `effectiveOrder.sessions.get(containerKey)` —— 容器 key 由
   *   拖拽源携带，**跨容器的会话根本不在同一个列表里**，`reorderKeys` 找不到落点 ⇒ 返回
   *   `null` ⇒ 什么都不写；
   * - `worktree`：取自 `effectiveOrder.worktrees.get(projectKey)` —— 同理，跨项目的
   *   worktree 不在同一列表；
   * - `project`：取自 `effectiveOrder.projects`，**不含未分组** ⇒ 项目拖不到未分组之后。
   *
   * ⚠️ **2026-10-22 DR6**：换算统一走 `tree-model.ts` 的 `reorderManualScope`
   * （= 先把持久表与 `effectiveOrder` 的当前默认顺序对齐，再 `reorderKeys`）。直接拿
   * 持久表换算会让「表外的新增项」既不能拖、也不能当落点 —— 表现就是拖拽静默无效。
   *
   * 这三条与 `onDragOver` 的 `accepts()` 是**双保险**：`accepts()` 让用户看不到插入线
   * （体验层），这里让「即便 drop 事件被伪造也改不动跨范围顺序」（正确性层）。
   *
   * ⚠️ **固化的是「不含运行时顶部区」的顺序（T11 终裁后语义不变）。**
   * `effectiveOrder` 刻意**不应用**任何运行时置顶（见它的 JSDoc 第三处差异），所以这里
   * 写进 `localStorage` 的永远是真实顺序 —— 用户关掉那个会话后它不会赖在最前面，
   * 持久顺序也不会被运行时状态污染。**不要**在这里改成 `buildRows` 的可见顺序。
   *
   * ⚠️ **T11（2026-09-22 用户终裁）：本函数不再有任何「顶部区释放」动作。**
   *
   * 此前的实现会在拖动会话行时调 `releaseTopZoneContainer`，把该容器标记为「已拖动过」
   * ⇒ 清除该容器的「刚结束保留」。用户终裁**删除了「刚结束保留」机制本身**
   * （「只要是结束了的会话就不再固定置顶了」），释放机制因此失去全部语义，已随之删除
   * （连同 `releasedContainerKeys` 字段与 `isTopZoneReleasingDrag` 判据）。
   *
   * ⇒ **拖拽只做一件事：把持久顺序改写为用户拖到的位置。** 已结束的会话（含刚跑完的）
   * 位置完全由持久顺序决定 ⇒ 拖到哪就留在哪，**不回弹**。运行中的会话不在此列：它们
   * 不可拖动（见下方 `dragHandlersFor` 的调用点）。
   *
   * 持久顺序仍只在**真的重排**时写（`next !== null`）：用户「原地抖一下」不该被永久切成
   * 手动模式。
   */
  const commitDrag = useCallback((active: DragState, over: DropTarget): void => {
    // 固化输入：**不含** manualOrder 的纯默认顺序（也**不含**运行时顶部区 —— 见上方 ⚠️）。
    const defaults = effectiveOrder({ ...treeInput, manualOrder: undefined })
    // 已处于手动排序时，直接以现有表为基础（它已覆盖全部项），否则用默认顺序全量固化。
    const base: ManualOrder = manualOrder.manual === true
      ? manualOrder
      : {
          manual: true,
          projects: defaults.projects,
          worktrees: Object.fromEntries(defaults.worktrees),
          sessions: Object.fromEntries(defaults.sessions),
        }

    // ⚠️ **2026-10-22 DR6**：三层都必须走 `reorderManualScope`（先与默认顺序对齐再换算），
    // **不能**直接拿持久表调 `reorderKeys`。持久表是「首次拖拽时的快照」，之后新增的
    // 工作区 / worktree / 会话都不在表里（D2 只追加新会话，且只在手动模式下写）：
    // `reorderKeys` 对「拖拽源不在表里」和「落点不在表里」都返回 null ⇒ 整次拖拽静默
    // 无效 —— 用户看到的就是「拖不动 / 松手没反应」（工作区、worktree、会话全都中招）。
    if (active.kind === 'session') {
      const containerKey = active.containerKey ?? ''
      const next = reorderManualScope(
        manualOrder.manual === true ? manualOrder.sessions?.[containerKey] : undefined,
        defaults.sessions.get(containerKey) ?? [],
        active.itemId,
        over.key.slice('s:'.length),
        over.half,
      )
      // 视觉无变化（落点等于原位）时**不写**持久顺序（与既有语义一致：不把用户
      // 「原地抖一下」变成永久切手动模式）。
      if (next === null) return
      const sessions = { ...(base.sessions ?? {}) }
      sessions[containerKey] = next
      persistOrder({ ...base, manual: true, sessions })
      return
    }

    if (active.kind === 'worktree') {
      const projectKey = active.projectKey ?? ''
      const next = reorderManualScope(
        manualOrder.manual === true ? manualOrder.worktrees?.[projectKey] : undefined,
        defaults.worktrees.get(projectKey) ?? [],
        active.itemId,
        over.key.slice('w:'.length),
        over.half,
      )
      if (next === null) return
      const worktrees = { ...(base.worktrees ?? {}) }
      worktrees[projectKey] = next
      persistOrder({ ...base, manual: true, worktrees })
      return
    }

    const next = reorderManualScope(
      manualOrder.manual === true ? manualOrder.projects : undefined,
      defaults.projects,
      active.itemId,
      over.key.slice('p:'.length),
      over.half,
    )
    if (next === null) return
    persistOrder({ ...base, manual: true, projects: next })
  }, [treeInput, manualOrder, persistOrder])

  /**
   * 造一行的拖拽接线。`scope` 决定「谁能和谁互换」：
   * - `project`：只与其它 project 行互换（且**排除未分组行**）；
   * - `worktree`：只与**同一 `projectKey`** 的 worktree 行互换；
   * - `session`：只与**同一 `containerKey`** 的会话行互换；
   * - `undefined`：该行不可拖、也不接受落点（未分组行、history 行、more 行、`wide === false`）。
   *
   * ⚠️ **T11：`draggable` 现在是独立参数。** 正在运行的会话行仍然**接受落点**
   * （`accepts` 照常工作 ⇒ 别的会话可以拖到它上方/下方），但**自己不可被拖**
   * （`draggable: false` ⇒ 浏览器不启动 dragstart、不显示拖拽光标）。
   * 「不可拖但仍可作落点」正是用户终裁要的手感：运行中的会话钉在最前，别的行围着它排。
   */
  const dragHandlersFor = (
    row: Extract<RenderRow, { kind: 'project' | 'worktree' | 'session' }>,
    scope: { kind: DragKind; itemId: string; projectKey?: string; containerKey?: string } | undefined,
    draggable = true,
  ): DragHandlers | undefined => {
    if (scope === undefined) return undefined
    const { kind, itemId, projectKey, containerKey } = scope
    const state: DragState = {
      kind,
      key: row.key,
      itemId,
      ...(projectKey === undefined ? {} : { projectKey }),
      ...(containerKey === undefined ? {} : { containerKey }),
    }
    // 「这一行能否当落点」：同层 + 同范围（worktree 同项目、session 同容器）。
    // 这条判据同时被 `onDragOver`（画不画线）与 `onDrop`（落不落）使用，不可能分叉。
    const accepts = (active: DragState): boolean => {
      if (active.kind !== kind) return false
      if (kind === 'session') return active.containerKey === containerKey
      if (kind === 'worktree') return active.projectKey === projectKey
      return true
    }
    return {
      draggable,
      dragging: drag !== null && drag.key === row.key,
      marker: drag !== null && accepts(drag) && dropTarget?.key === row.key ? dropTarget.half : null,
      onDragStart: (event: Any) => {
        // T11：不可拖的行即便收到伪造的 dragstart 也**不进入拖拽态**（双保险）。
        if (!draggable) return
        // 与原生同姿势：`effectAllowed = 'move'` + `setData('text/plain', key)`。
        // `setData` 是必需的 —— Firefox / 部分 Electron 版本不写 dataTransfer 就不启动拖拽。
        if (event?.dataTransfer !== null && event?.dataTransfer !== undefined) {
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', row.key)
        }
        setDrag(state)
        setDropTarget(null)
      },
      onDragEnd: () => {
        // **必须清理**：拖到空白处松手、按 Esc 取消时 `drop` 不会触发，只有 `dragend` 会。
        // 漏了这一步插入线会永久残留。
        setDrag(null)
        setDropTarget(null)
      },
      onDragOver: (event: Any) => {
        if (drag === null || !accepts(drag)) return
        // 只在接受时才 `preventDefault` ⇒ 跨容器 / 跨项目拖拽显示「禁止」光标且 drop 不触发。
        event.preventDefault()
        if (event?.dataTransfer !== null && event?.dataTransfer !== undefined) {
          event.dataTransfer.dropEffect = 'move'
        }
        const half = rowHalf(event)
        setDropTarget((previous) =>
          previous?.key === row.key && previous.half === half ? previous : { key: row.key, half },
        )
      },
      onDrop: (event: Any) => {
        if (drag === null || !accepts(drag)) return
        event.preventDefault()
        event.stopPropagation()
        const half = rowHalf(event)
        const active = drag
        setDrag(null)
        setDropTarget(null)
        commitDrag(active, { key: row.key, half })
      },
    }
  }

  // ── 轨道态（§2.7 裁定 10 / §B1.4）：不渲染树，只给 36px 入口 ─────────
  if (wide === false) {
    return jsx('div', {
      style: { display: 'flex', justifyContent: 'center', padding: '4px 0' },
      children: jsx('button', {
        type: 'button',
        title: t('section.workspaces'),
        'aria-label': t('section.workspaces'),
        onClick: () => { expandSidebar?.() },
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: RAIL_BUTTON,
          height: RAIL_BUTTON,
          padding: 0,
          border: 'none',
          borderRadius: 10,
          background: 'transparent',
          color: 'var(--dsw-alias-label-primary)',
          cursor: 'pointer',
        },
        children: icon('panelLeft'),
      }),
    })
  }

  // ── 菜单动作的分发入口（放在这里，供 MenuLayer 与行内按钮共用） ─────
  const openMenu = (target: MenuTarget): void => { setMenuTarget(target) }

  /** 鼠标坐标 → 菜单锚点；按钮触发时用元素 rect，右键时用事件坐标。 */
  const pointOf = (event: Any, fallback: Any): { x: number; y: number } => {
    const rect = fallback?.getBoundingClientRect?.()
    return {
      x: Math.round(Number(rect?.left ?? event?.clientX ?? 0)),
      y: Math.round(Number(rect?.bottom ?? event?.clientY ?? 0)),
    }
  }

  // ── 行渲染 ──────────────────────────────────────────────────────────
  const rowNodes: ReactNode[] = []
  // 2026-11-14 行 memo 化：本次渲染的会话行处理器表；渲染结束前整体替换到稳定容器里。
  const sessionHandlers = new Map<string, SessionRowHandlers>()
  for (const viewRow of view.rows) {
    // D2：会话行先用客户端 live fact（pending / completed）覆盖，再交给行组件。
    // 只在会话行上发生，且 `RenderRow` 的联合类型不变（浅拷贝出新对象）。
    const row = withLiveState(viewRow, { status: sessionStatus, pending: pendingInteractions, sessions: sessionsSnapshot })
    if (row.kind === 'session') {
      // D10：会话行可拖，但**只在同一容器内**（`containerKey` = `parentKey`）。
      // 跨容器拖拽在 `accepts()` 里被拒 ⇒ 不画插入线、不 `preventDefault` ⇒ drop 不触发。
      //
      // ⚠️ **T11（2026-09-22 用户终裁）：正在运行的会话不可拖动。**
      // 用户原话：「正在运行的会话固定在顶部，拖不动，只要是结束了的会话就不再固定置顶了」。
      // 运行中的会话被渲染期固定在容器最前（`topZoneSessionKeys`），若还允许拖动，用户
      // 只会看到「拖完弹回原位」——那是**预期行为**，但更好的做法是**根本不提供拖拽**
      // （不显示拖拽光标、不画插入线、dragstart 不启动），让「拖不动」在交互层就成立，
      // 而不是靠渲染期把它搬回去。
      //
      // 判据取自 {@link isSessionDragLocked}（= 运行中 ⊕ 当前空白占位行，其中「运行中」
      // 与顶部区置顶判据共用 {@link isTopZoneRunningSession} 同一实现）⇒「排在最前的那些行」
      // 与「拖不动的那些行」不可能分叉。
      // ⚠️ **已结束**的会话（含用户正在查看的旧会话、含刚跑完的会话）**照常可拖** ——
      // 位置完全由持久顺序决定，拖到哪就留在哪（本轮修复的首要缺陷）。
      // ⚠️ **当前空白会话**（「新会话」占位行）不可拖（2026-10-22 DR5）：它被渲染期
      // 钉在容器最前，允许起拖只会「拖完弹回」（宿主原生同样不给 blank 行起拖）。
      //
      // ⚠️ 运行中的行**仍然接受落点**（`dragHandlersFor` 的第三个参数只关掉 `draggable`）：
      // 别的会话可以拖到它上方/下方，插入线照常显示。只是它自己拖不动。
      const sessionDrag = dragHandlersFor(
        row,
        { kind: 'session', itemId: row.sessionId, containerKey: row.parentKey },
        !isSessionDragLocked(row, topZone),
      )
      const rowDrag = row.parentKind === 'recent' ? undefined : sessionDrag
      sessionHandlers.set(row.key, {
        onOpen: () => {
          setOptimisticSessionId(row.sessionId)
          actions.openSession(row.sessionId)
        },
        onMenu: (target: { x: number; y: number; title: string; sessionId: string }) => {
          openMenu({ kind: 'session', x: target.x, y: target.y, title: target.title, sessionId: target.sessionId })
        },
        ...(rowDrag === undefined ? {} : { drag: rowDrag }),
      })
      rowNodes.push(jsx(SessionRowView, {
        key: row.key,
        row,
        t,
        rowKey: row.key,
        handlers: sessionHandlersRef,
        ...(row.parentKind === 'recent' || sessionDrag === undefined
          ? {}
          : { drag: { draggable: sessionDrag.draggable, dragging: sessionDrag.dragging, marker: sessionDrag.marker } }),
      }))
      continue
    }

    if (row.kind === 'more') {
      rowNodes.push(jsx(MoreRowView, {
        key: row.key,
        row,
        t,
        onExpand: () => { expandMore(row.parentKey) },
        onCollapse: () => { resetExpandLevels([row.parentKey]) },
      }))
      continue
    }

    if (row.kind === 'history') {
      // history 桶没有 `+`（其下没有可开新会话的目录），只有展开/折叠。
      rowNodes.push(jsx(HoverContainerRow, {
        key: row.key,
        row,
        t,
        renderActions: () => [],
        onToggle: () => { toggleCollapsed(row.key) },
      }))
      continue
    }

    if (row.kind === 'recent') {
      rowNodes.push(jsx(RecentSectionHeaderView, {
        key: row.key,
        row,
        onToggle: () => { toggleCollapsed(row.key) },
      }))
      continue
    }

    if (row.kind === 'worktree') {
      // D10：worktree 行可拖，但**只在同一项目内**。项目归属由行 key 反查
      // `view.worktrees` 的 `repoPath` 不可靠（未注册时缺失），因此用「所属项目」显式索引。
      const owner = view.worktreeOwner.get(row.key)
      const worktreeDrag = dragHandlersFor(row, owner === undefined
        ? undefined
        : { kind: 'worktree', itemId: row.path, projectKey: owner })
      const extra = view.worktrees.get(row.key)
      if (extra === undefined) {
        rowNodes.push(jsx(HoverContainerRow, {
          key: row.key,
          row,
          t,
          renderActions: () => [],
          onToggle: () => { toggleCollapsed(row.key) },
          ...(worktreeDrag === undefined ? {} : { drag: worktreeDrag }),
        }))
        continue
      }
      const node = extra
      rowNodes.push(jsx(HoverContainerRow, {
        key: row.key,
        row,
        t,
        ...(worktreeDrag === undefined ? {} : { drag: worktreeDrag }),
        renderActions: (hovered: boolean) => [
          jsx('button', {
            key: 'new',
            type: 'button',
            title: t('menu.newSession'),
            'aria-label': t('menu.newSession'),
            style: iconButtonStyle(hovered),
            // D10：按钮**不可拖**且吞掉 dragstart —— 否则按住 `+` 拖动会拖走整行，
            // 点按钮的手感立刻变差（`draggable` 在父行上，事件会冒泡上来）。
            draggable: false,
            onDragStart: (event: Any) => { event.stopPropagation() },
            onClick: (event: Any) => { event.stopPropagation(); newSession(node) },
            children: icon('plus'),
          }),
          jsx('button', {
            key: 'more',
            type: 'button',
            title: t('worktree.menu'),
            'aria-label': t('worktree.menu'),
            style: iconButtonStyle(hovered),
            draggable: false,
            onDragStart: (event: Any) => { event.stopPropagation() },
            onClick: (event: Any) => {
              event.stopPropagation()
              const point = pointOf(event, event?.currentTarget)
              openMenu({ kind: 'worktree', x: point.x, y: point.y, title: row.label, extra: node })
            },
            children: icon('ellipsis'),
          }),
        ],
        onToggle: () => { toggleCollapsed(row.key) },
        onContextMenu: (event: Any) => {
          event.preventDefault()
          const point = pointOf(event, undefined)
          openMenu({ kind: 'worktree', x: point.x, y: point.y, title: row.label, extra: node })
        },
      }))
      continue
    }

    // project 行
    // D10：未分组行**不参与拖拽**（它不是真实项目，§2.6 裁定 1），但它同时是拖拽的
    // **静止边界** —— `commitDrag` 的项目候选列表把它剔除了，所以项目拖不到它后面。
    const projectDrag = row.key === PREFIX_UNGROUPED
      ? undefined
      : dragHandlersFor(row, { kind: 'project', itemId: row.key.slice('p:'.length) })
    const extra = view.projects.get(row.key)
    if (extra === undefined) {
      rowNodes.push(jsx(HoverContainerRow, {
        key: row.key,
        row,
        t,
        renderActions: () => [],
        onToggle: () => { toggleCollapsed(row.key) },
        ...(projectDrag === undefined ? {} : { drag: projectDrag }),
      }))
      continue
    }
    const project = extra
    rowNodes.push(jsx(HoverContainerRow, {
      key: row.key,
      row,
      t,
      ...(projectDrag === undefined ? {} : { drag: projectDrag }),
      renderActions: (hovered: boolean) => {
        // §2.6 裁定 1：未分组行不是真实项目，隐藏「新建 worktree」入口。
        if (project.isUngrouped) return []
        // git 项目：**只有** `…`。`+`（新建会话）属于 worktree 行 —— 单 worktree 的
        // git 项目现在也有 worktree 子行（D11 2026-09-21 修订），所以项目行不再需要 `+`。
        // `…` 里只有「新建 worktree」一项（见 MenuLayer）。
        //
        // 判据与 MenuLayer 的菜单项**同源**（`isGit && mainPath !== undefined`）：git 项目
        // 缺 `mainPath` 是理论退化情形（真实数据 9/9 都有），此时菜单会是空的 —— 那种情况下
        // 不画按钮，而不是画一个点开什么都没有的 `…`。会话入口不受影响（在 worktree 行上）。
        if (project.isGit) {
          if (project.mainPath === undefined) return []
          return [jsx('button', {
            key: 'more',
            type: 'button',
            title: t('worktree.menu'),
            'aria-label': t('worktree.menu'),
            style: iconButtonStyle(hovered),
            // D10：按钮不参与行拖拽（同 worktree 行的 `+` / `…`）。
            draggable: false,
            onDragStart: (event: Any) => { event.stopPropagation() },
            onClick: (event: Any) => {
              event.stopPropagation()
              const point = pointOf(event, event?.currentTarget)
              openMenu({ kind: 'project', x: point.x, y: point.y, title: row.label, key: row.key, extra: project })
            },
            children: icon('ellipsis'),
          })]
        }
        // 非 git 工作区：`+`（在该工作区开新会话）与 `…`（重命名 / 归档工作空间菜单）。
        if (project.workspaceId === undefined) return []
        const workspaceId = project.workspaceId
        return [
          jsx('button', {
            key: 'new-session',
            type: 'button',
            title: t('menu.newSession'),
            'aria-label': t('menu.newSession'),
            style: iconButtonStyle(hovered),
            draggable: false,
            onDragStart: (event: Any) => { event.stopPropagation() },
            // 2026-10-22 DR1：非 git 工作区与 worktree 同口径 —— 复用同目录空白会话、保留草稿。
            onClick: (event: Any) => {
              event.stopPropagation()
              actions.startSession(workspaceId, SAME_LOCATION_START_SESSION)
              reload()
            },
            children: icon('plus'),
          }),
          jsx('button', {
            key: 'more',
            type: 'button',
            title: t('worktree.menu'),
            'aria-label': t('worktree.menu'),
            style: iconButtonStyle(hovered),
            draggable: false,
            onDragStart: (event: Any) => { event.stopPropagation() },
            onClick: (event: Any) => {
              event.stopPropagation()
              const point = pointOf(event, event?.currentTarget)
              openMenu({ kind: 'project', x: point.x, y: point.y, title: row.label, key: row.key, extra: project })
            },
            children: icon('ellipsis'),
          }),
        ]
      },
      onToggle: () => { toggleCollapsed(row.key) },
      onContextMenu: project.isUngrouped
        ? undefined
        : (event: Any) => {
            event.preventDefault()
            const point = pointOf(event, undefined)
            openMenu({ kind: 'project', x: point.x, y: point.y, title: row.label, key: row.key, extra: project })
          },
    }))
  }
  sessionHandlersRef.current = sessionHandlers

  // ── 主体 ────────────────────────────────────────────────────────────
  const body: ReactNode[] = []

  // 顶部一行：搜索框（占满剩余宽度）+ 右侧「添加工作区」`+` 独立按钮（对齐原生
  // `sectionHeader`：区头标签 + 搜索槽 + `headerActions`）。添加工作区**不再**是
  // 二级菜单项（用户 2026-09-21 明确要求）。
  body.push(jsxs('div', {
    key: 'search',
    style: { display: 'flex', alignItems: 'center', gap: 4, padding: '2px 4px 6px' },
    children: [
      jsx('input', {
        key: 'search-input',
        value: query,
        placeholder: t('search.placeholder'),
        'aria-label': t('search.placeholder'),
        onChange: (event: Any) => { setQuery(String(event?.target?.value ?? '')) },
        style: {
          flex: 1,
          minWidth: 0,
          height: 30,
          boxSizing: 'border-box',
          border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.3))',
          borderRadius: 8,
          background: 'transparent',
          color: 'var(--dsw-alias-label-primary)',
          fontFamily: 'inherit',
          fontSize: 13,
          padding: '0 10px',
          outline: 'none',
        },
      }),
      jsx('button', {
        key: 'add-workspace',
        type: 'button',
        title: t('project.add'),
        'aria-label': t('project.add'),
        onClick: () => { void addWorkspace() },
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 28,
          height: 28,
          padding: 0,
          flex: 'none',
          border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.3))',
          borderRadius: 8,
          background: 'transparent',
          color: 'var(--dsw-alias-label-tertiary, var(--dsw-alias-label-dimmed))',
          cursor: 'pointer',
        },
        children: icon('projectAdd'),
      }),
    ],
  }))

  if (tree === null && loadError === null) {
    body.push(jsx('div', {
      key: 'loading',
      style: { padding: '10px 12px', ...dimText(12.5) },
      children: t('state.loadingTree'),
    }))
  } else if (loadError !== null) {
    body.push(jsxs('div', {
      key: 'load-error',
      style: {
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        fontSize: 12.5,
        color: 'var(--dsw-alias-state-error-primary, #d9534f)',
      },
      children: [
        jsx('div', { key: 'msg', children: t('error.load') }),
        jsx('div', { key: 'detail', style: { opacity: 0.85, wordBreak: 'break-all' }, children: loadError }),
        jsx('button', {
          key: 'retry',
          type: 'button',
          onClick: reload,
          style: {
            alignSelf: 'flex-start',
            marginTop: 2,
            padding: '2px 10px',
            border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.3))',
            borderRadius: 12,
            background: 'transparent',
            color: 'inherit',
            fontFamily: 'inherit',
            fontSize: 12,
            cursor: 'pointer',
          },
          children: t('error.retry'),
        }),
      ],
    }))
  } else if (query.trim() !== '' && rowNodes.length === 0) {
    body.push(jsx('div', {
      key: 'search-empty',
      style: { padding: '10px 12px', ...dimText(12.5) },
      children: t('search.empty'),
    }))
  } else {
    body.push(...rowNodes)
  }

  if (busyText !== null) {
    body.push(jsx('div', { key: 'busy', style: { padding: '6px 12px', ...dimText(12) }, children: busyText }))
  }

  // **D10**：非阻塞警告（如「worktree 已创建，但注册工作区失败」）。单独一行、
  // 低调配色，且**不**与 `loadError` 一样替换整棵树 —— 此时树必须继续显示，
  // 因为用户正需要看到刚建好的 worktree 行。
  if (notice !== null) {
    body.push(jsx('div', {
      key: 'notice',
      style: {
        padding: '6px 12px',
        fontSize: 12,
        wordBreak: 'break-all',
        color: 'var(--dsw-alias-state-warning-primary, #b8860b)',
      },
      children: notice,
    }))
  }

  // 自建子槽位的挂载点（`children` 里声明了它；没有占据者时 renderSlot 返回空）。
  if (renderSlot !== undefined) {
    try {
      const flow = renderSlot(DIRECTORY_FLOW_SLOT) as ReactNode
      if (present(flow)) body.push(jsx('div', { key: 'directory-flow', children: flow }))
    } catch (error: unknown) {
      console.warn('[dsh-worktree-groups] renderSlot(worktreeDirectoryFlow) failed:', error)
    }
  }

  return jsxs('div', {
    style: { display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%', color: 'var(--dsw-alias-label-primary)' },
    children: [
      jsx('div', {
        key: 'scroll',
        style: { flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: '0 4px 8px' },
        children: body,
      }),
      jsx(MenuLayer, {
        key: 'menu',
        target: menuTarget,
        t,
        actions,
        onClose: () => { setMenuTarget(null) },
        onNewSession: newSession,
        onRename: setRenameState,
        onCreateWorktree: (state: CreateState) => { setCreateState(state) },
        onRemoveWorktree: setRemoveTarget,
        reload,
        setLoadError,
        collectBaseCandidates: (repoPath: string) => collectBaseCandidates(view, repoPath),
        // D10：**仅 `manual === true` 时**显示「恢复默认排序」。判据在 MenuLayer 里
        // （`orderIsManual`），这里只给「切回默认」的动作 + 当前是否 manual 的事实。
        orderIsManual: manualOrder.manual === true,
        onResetOrder: () => {
          clearManualOrder()
          setManualOrder(EMPTY_ORDER)
          // T11（2026-09-22 用户终裁）：这里**不再需要**清任何「已拖动容器」集合 ——
          // 「拖动释放」机制连同 `releasedContainerKeys` 字段已按用户终裁整体删除
          // （「刚结束保留」已不存在，释放机制失去全部语义）。
          //
          // `newSessionIds` / `writtenNewSessionIds` 保持不动（它们是客观状态，不是排序
          // 偏好的产物）：`manual` 已变 false ⇒ D2 落表 effect 直接早退、不写任何东西；
          // 用户之后再拖一次时，首次固化会用**全量默认顺序**（此时新会话已在树里）重建表，
          // 因此台账是否清空都不影响结果。
          reload()
        },
      }),
      jsx(CreateWorktreeDialog, {
        key: 'create',
        state: createState,
        t,
        onClose: () => { setCreateState(null) },
        onBusy: setBusyText,
        // **D10**：警告用独立的 `notice` 行渲染，**不能**用 `setLoadError` ——
        // `loadError !== null` 会走错误分支而**整棵树被错误框替换**，恰好在
        // 「worktree 已建成、需要立刻显示新行」时把树藏起来。也不能用 `busyText`：
        // 提交结束的 `finally` 会立刻把它清掉。
        onWarning: setNotice,
        onError: setLoadError,
        post: actions.post,
        onCreated: (worktreePath: string | undefined, workspaceId: string | undefined) => {
          // D7：成功后展开该 worktree 行并自动开一个新会话。
          if (worktreePath !== undefined && worktreePath !== '') {
            expandKeys([`${PREFIX_WORKTREE}${worktreePath}`])
          }
          // 2026-10-22 DR1：新 worktree 目录里正常没有 blank 会话 ⇒ 行为与旧实现一致
          // （宿主找回不到就正常铸新会话）；仍传同一常量，保持「插件自有新建会话」的单一
          // 口径，避免将来出现「有的入口复用、有的入口铸新会话」的分叉。
          if (workspaceId !== undefined) actions.startSession(workspaceId, SAME_LOCATION_START_SESSION)
          reload()
        },
      }),
      jsx(RemoveWorktreeDialog, {
        key: 'remove',
        target: removeTarget,
        t,
        onClose: () => { setRemoveTarget(null) },
        onBusy: setBusyText,
        onError: setLoadError,
        post: actions.post,
        onRemoved: reload,
      }),
      jsx(RenameDialog, {
        key: 'rename',
        state: renameState,
        t,
        onClose: () => { setRenameState(null) },
        onSubmit: (value: string) => {
          const state = renameState
          setRenameState(null)
          if (state === null) return
          void (async () => {
            try {
              if (state.kind === 'session') await actions.renameSession(state.id, value)
              else await actions.renameWorkspace(state.id, value)
              reload()
            } catch (error: unknown) {
              setLoadError(error instanceof Error ? error.message : t('error.load'))
            }
          })()
        },
      }),
      jsx(AddWorkspaceDialog, {
        key: 'add-workspace',
        open: addWorkspaceOpen,
        t,
        onClose: () => { setAddWorkspaceOpen(false) },
        createWorkspace: actions.createWorkspace,
        onCreated: () => {
          setAddWorkspaceOpen(false)
          reload()
        },
      }),
    ].filter(present),
  })
}

// ────────────────────────────────────────────────────────────────────────────
// 菜单层
// ────────────────────────────────────────────────────────────────────────────

/**
 * 菜单层：worktree 菜单（D14）与项目 / 会话菜单共用同一个 `Menu`。
 *
 * 两个坑（`docs/HOST-CONTRACTS.md` §B5.2）：
 * 1. `Menu.anchor` 会被包在 `<span>` 里 ⇒ 传一个 0×0 的行内锚点，不抢布局；
 *    菜单本体用 `portal: true` + `getAnchorRect` 定位到鼠标坐标。
 * 2. `getAnchorRect` **只在 portal 模式生效**，且它在 `Menu` 的 `useLayoutEffect`
 *    依赖数组里 ⇒ 必须用 `useCallback` 稳定引用，否则每次渲染都 `setFixedPos`
 *    一个新对象，形成"渲染→定位→渲染"死循环。
 */
function MenuLayer(props: {
  target: MenuTarget | null
  t: Translate
  actions: Actions
  onClose(): void
  onNewSession(extra: WorktreeExtra): void
  onRename(state: RenameState): void
  onCreateWorktree(state: CreateState): void
  onRemoveWorktree(target: { path: string; label: string }): void
  reload(): void
  setLoadError(message: string | null): void
  collectBaseCandidates(repoPath: string): string[]
  /** D10：当前是否处于手动排序（`localStorage` 里 `manual === true`）。 */
  orderIsManual: boolean
  /** D10：「恢复默认排序」——清本地顺序 + 立即重排。 */
  onResetOrder(): void
}): ReactNode {
  const target = props.target
  const t = props.t
  const anchorX = target?.x ?? 0
  const anchorY = target?.y ?? 0
  const getAnchorRect = useCallback(
    () => ({ left: anchorX, top: anchorY, right: anchorX, bottom: anchorY, width: 0, height: 0 }),
    [anchorX, anchorY],
  )

  if (target === null) return null

  const items: Any[] = []

  // D10：「恢复默认排序」——**仅当处于手动排序时**追加。
  //
  // 选择「仅 manual 时显示」而不是「常显 no-op」的理由：选项 A 的文案是「拖拽即切换为
  // 手动排序」，在**没手动排过**的状态下这一项点了什么都不发生 —— 菜单里放一个无效项
  // 比不放更糟（用户会以为坏了）。而 `manual` 状态就在本组件的 props 上（
  // `orderIsManual`），判断成本为零，没有理由退让到常显。
  //
  // git 项目与非 git 工作区**都要有**（需求原文）：因此这一段放在 `isGit` 分支**之外**，
  // 对 `target.kind === 'project'` 且非未分组的所有情况生效。
  const pushResetOrder = (): void => {
    if (!props.orderIsManual) return
    items.push({ type: 'separator' })
    items.push({ id: MENU.resetOrder, label: t('menu.resetOrder'), icon: icon('refresh') })
  }

  if (target.kind === 'worktree') {
    const extra = target.extra
    const registered = extra.workspaceId !== undefined
    items.push({ id: MENU.newSession, label: t('menu.newSession'), icon: icon('plus') })
    items.push({ id: MENU.reveal, label: t('menu.reveal'), icon: icon('folderOpen') })
    items.push({ id: MENU.copyPath, label: t('menu.copyPath'), icon: icon('copy') })
    // 未注册的 worktree（`workspaceId === undefined`）：隐藏「重命名工作区」与
    // 「移除 worktree」—— 前者没有工作区记录可改，后者会删掉一个还没在 DSH 里
    // 露过面的目录。`+` / reveal / copy 仍可用（懒注册只需路径，D5）。
    if (registered) {
      items.push({ type: 'separator' })
      items.push({ id: MENU.renameWorkspace, label: t('dialog.renameWorkspace'), icon: icon('edit') })
      items.push({ id: MENU.removeWorktree, label: t('worktree.remove'), danger: true, icon: icon('trash') })
    }
    // worktree 行也提供入口：用户刚拖完 worktree 时，`…` 就在手边，不必绕回项目行。
    pushResetOrder()
  } else if (target.kind === 'session') {
    // D10：会话右键 = 重命名 / 归档 / 派生。
    items.push({ id: MENU.renameSession, label: t('menu.rename'), icon: icon('edit') })
    items.push({ id: MENU.archiveSession, label: t('menu.archive'), icon: icon('archive') })
    items.push({ id: MENU.forkSession, label: t('menu.fork'), icon: icon('branch') })
    pushResetOrder()
  } else {
    const extra = target.extra
    if (extra.isGit && extra.mainPath !== undefined) {
      items.push({ id: MENU.newWorktree, label: t('worktree.create'), icon: icon('plus') })
    } else if (extra.workspaceId !== undefined) {
      items.push({ id: MENU.newSession, label: t('menu.newSession'), icon: icon('newChat') })
      items.push({ id: MENU.renameWorkspace, label: t('dialog.renameWorkspace'), icon: icon('edit') })
    }
    if (!extra.isUngrouped) {
      if (items.length > 0) items.push({ type: 'separator' })
      items.push({ id: MENU.archiveWorkspace, label: t('menu.archiveWorkspace'), icon: icon('archive') })
      pushResetOrder()
    }
  }

  /** 菜单项分发：每个动作自行 try/catch，绝不把异常抛到渲染层。 */
  const handleSelect = (id: string): void => {
    props.onClose()
    void (async () => {
      try {
        // D10：「恢复默认排序」与 target 种类无关（三层都走同一个本地顺序表），
        // 因此放在最前面统一处理，不重复写三遍。
        if (id === MENU.resetOrder) { props.onResetOrder(); return }
        if (target.kind === 'worktree') {
          if (id === MENU.newSession) { props.onNewSession(target.extra); return }
          if (id === MENU.reveal) { await props.actions.post(ROUTE_REVEAL, { path: target.extra.path }); return }
          if (id === MENU.copyPath) { await copyText(target.extra.path); return }
          if (id === MENU.renameWorkspace && target.extra.workspaceId !== undefined) {
            props.onRename({ kind: 'workspace', id: target.extra.workspaceId, value: target.title })
            return
          }
          if (id === MENU.removeWorktree) {
            props.onRemoveWorktree({ path: target.extra.path, label: target.title })
          }
          return
        }
        if (target.kind === 'session') {
          if (id === MENU.renameSession) {
            props.onRename({ kind: 'session', id: target.sessionId, value: target.title })
            return
          }
          if (id === MENU.archiveSession) {
            await props.actions.archiveSession(target.sessionId)
            props.reload()
            return
          }
          if (id === MENU.forkSession) {
            await props.actions.forkSession(target.sessionId)
            props.reload()
          }
          return
        }
        // project
        if (id === MENU.newWorktree && target.extra.mainPath !== undefined) {
          props.onCreateWorktree({
            repoPath: target.extra.mainPath,
            baseCandidates: props.collectBaseCandidates(target.extra.mainPath),
            label: target.title,
          })
          return
        }
        if (id === MENU.newSession && target.extra.workspaceId !== undefined) {
          // 2026-10-22 DR1：与行内 `+` 同口径（复用同目录空白会话、保留草稿）。
          props.actions.startSession(target.extra.workspaceId, SAME_LOCATION_START_SESSION)
          props.reload()
          return
        }
        if (id === MENU.renameWorkspace && target.extra.workspaceId !== undefined) {
          props.onRename({ kind: 'workspace', id: target.extra.workspaceId, value: target.title })
          return
        }
        if (id === MENU.archiveWorkspace && !target.extra.isUngrouped) {
          const displayPath = target.extra.path ?? target.extra.mainPath
          archiveWorkspaceClient({
            key: target.extra.projectKey,
            title: target.title,
            ...(displayPath === undefined ? {} : { path: displayPath }),
            isGit: target.extra.isGit,
            archivedAt: Date.now(),
          })
          try {
            await props.actions.post(ROUTE_TREE, { archiveProjectKey: target.extra.projectKey })
          } catch {
            /* 宿主尚未重启时本地已归档生效 */
          }
          props.reload()
          return
        }
        if (id === MENU.copyPath && target.extra.mainPath !== undefined) {
          await copyText(target.extra.mainPath)
        }
      } catch (error: unknown) {
        props.setLoadError(error instanceof Error ? error.message : t('error.load'))
      }
    })()
  }

  return jsx(P.Menu, {
    open: true,
    portal: true,
    anchor: jsx('span', { style: { display: 'inline-block', width: 0, height: 0 } }),
    getAnchorRect,
    items,
    onClose: props.onClose,
    onSelect: handleSelect,
  })
}

// ────────────────────────────────────────────────────────────────────────────
// 树模型拼装
// ────────────────────────────────────────────────────────────────────────────

/**
 * 收集某主仓下所有 worktree 的分支名（新建 worktree 弹窗的"起始分支"候选）。
 *
 * **D3 修复**：判定「这个 worktree 是不是本仓的」只能用 {@link WorktreeExtra.repoPath}
 * （构建侧从 `ProjectNode.mainPath` 带下来的事实），**不能**用路径前缀。
 * 旧写法 `extra.path.startsWith(parentDirOf(repoPath))` 里 `parentDirOf(repoPath)` 是
 * **所有兄弟仓的公共父目录**（`/Users/dev/Documents/Project/Workspace/` 同时装着 MyProject
 * 与 DemoApp），于是两个仓的候选池互相串台，弹窗默认值
 * （`setBaseRef(state.baseCandidates[0])`）直接指向别仓的分支 ⇒ 用户点「创建」即得到
 * git 的 `invalid reference` 原始英文报错。
 *
 * @param view 当前树视图。
 * @param repoPath 主仓路径（`ProjectExtra.mainPath`）。
 * @returns 分支名列表（无分支的 worktree 被跳过）；**只含本仓**。
 */
function collectBaseCandidates(view: TreeView, repoPath: string): string[] {
  const target = normalizeRepoKey(repoPath)
  if (target === undefined) return []
  const seen = new Set<string>()
  for (const extra of view.worktrees.values()) {
    // 缺 `repoPath` 的行（未注册 / 非 git）**不参与**合并：宁少不错。
    if (extra.repoPath === undefined || normalizeRepoKey(extra.repoPath) !== target) continue
    for (const branch of extra.baseCandidates) seen.add(branch)
  }
  return [...seen]
}

/**
 * 仓路径的比较键（大小写与尾分隔符不敏感）。
 *
 * `mainPath` 由宿主侧 `normalizePath` 产出，两侧同源时逐字相等；但 `macOS` 的
 * `/var` → `/private/var` 与用户手输大小写都可能让同一目录出现两种拼法 —— 比较键
 * 只用来做**相等判定**（不用于拼路径），放宽到大小写不敏感不会造成跨仓误合并。
 */
function normalizeRepoKey(path: string): string | undefined {
  const trimmed = path.replace(/[/\\]+$/, '')
  return trimmed === '' ? undefined : trimmed.toLowerCase()
}

/**
 * 把 `buildRows()` 的入参拼起来，并回查行渲染需要的附加数据。
 *
 * **不做任何树推导** —— 展开态、截断（含 `expandedAll` 时那一条「收起」more 行）、
 * 搜索、子代理深度、手动顺序全部在 `buildRows` 里。
 *
 * @param tree 宿主树快照（`null` = 还没拉到）。
 * @param input `buildRows` 的入参（由调用方 `useMemo` 构造，与 `effectiveOrder` 共用）。
 * @returns 行序列 + 附加数据。
 */
function buildTreeView(tree: TreeResponse | null, input: SidebarModelInput): TreeView {
  const worktrees = new Map<string, WorktreeExtra>()
  const projects = new Map<string, ProjectExtra>()
  const worktreeOwner = new Map<string, string>()
  if (tree === null) return { rows: [], worktrees, projects, worktreeOwner }

  for (const project of tree.projects) {
    const projectKey = `p:${project.key}`
    const branchPool = project.worktrees
      .map((node) => node.branch)
      .filter((branch): branch is string => typeof branch === 'string' && branch !== '')
    // 项目行的 `workspaceId` 有两个来源，缺一不可：
    // - **非 git 工作区**：`worktrees` **恒为空数组**（`buildProjects` 的 `'flat'` 分支不建
    //   worktree 节点）⇒ 只能从 key 的 `ws:` 前缀解出（`workspaceIdFromProjectKey`）。
    //   这条不是可选项：非 git 行 hover 的 `+`（新建该工作区会话）就靠它，
    //   漏掉的话该按钮因 `workspaceId === undefined` 而根本不渲染。
    // - **git 项目**：取自首个已注册的 worktree（`ProjectNode.worktrees[*].workspaceId`）。
    const firstWorkspaceId =
      workspaceIdFromProjectKey(project.key) ??
      project.worktrees.find((node) => node.workspaceId !== undefined)?.workspaceId

    const displayPath =
      project.mainPath ??
      project.worktrees[0]?.path ??
      project.flatSessions[0]?.cwd

    projects.set(projectKey, {
      projectKey: project.key,
      isGit: project.isGit === true,
      isUngrouped: project.key === UNGROUPED_KEY,
      ...(project.mainPath === undefined ? {} : { mainPath: project.mainPath }),
      ...(displayPath === undefined ? {} : { path: displayPath }),
      ...(firstWorkspaceId === undefined ? {} : { workspaceId: firstWorkspaceId }),
    })

    // **所有** git 项目都要 per-worktree 附加数据：D11（2026-09-21 修订）后单 worktree 的
    // git 项目同样产生 worktree 子行，子行的 `+` / `…` 都需要 `WorktreeExtra`。
    // 旧条件 `worktrees.length <= 1` 会让单 worktree 项目的子行拿不到 extra ⇒ 渲染成
    // 无动作按钮的容器行（`view.worktrees.get(row.key) === undefined` 分支）。
    if (project.isGit !== true) continue

    // D3：把「本 worktree 属于哪个仓」显式带到每个 extra 上（取项目节点的 mainPath）。
    // `collectBaseCandidates` 靠它做精确匹配，不再用父目录前缀猜（兄弟仓会串台）。
    // 没有 mainPath 的项目（非 git / 退化情形）不填，候选收集侧会跳过。
    const repoPath = project.mainPath

    for (const node of project.worktrees) {
      const key = `${PREFIX_WORKTREE}${node.path}`
      // D10：记下所属项目（拖拽范围约束），键是 `ProjectNode.key`（不是 repoPath）。
      worktreeOwner.set(key, project.key)
      worktrees.set(key, {
        path: node.path,
        ...(repoPath === undefined ? {} : { repoPath }),
        baseCandidates: branchPool.filter((branch) => branch !== node.branch),
        ...(node.workspaceId === undefined ? {} : { workspaceId: node.workspaceId }),
      })
    }
  }

  const rows = buildRows(input)

  return { rows, worktrees, projects, worktreeOwner }
}

/** 宿主 title 投影缺失时的兜底（对齐原生 `displayTitleOf`：标题 → 目录 basename → id）。 */
export function defaultTitleOf(session: SessionRowLike): string {
  if (typeof session.title === 'string' && session.title !== '') return session.title
  const base = baseName(session.cwd ?? '')
  return base !== '' ? base : session.sessionId
}

/** 合并客户端 localStorage 与服务端返回的已归档工作空间列表（按 archivedAt 降序）。 */
function mergeArchivedWorkspaceItems(
  localMap: Record<string, ArchivedWorkspaceItem>,
  serverList?: readonly ArchivedWorkspaceItem[],
): ArchivedWorkspaceItem[] {
  const merged = new Map<string, ArchivedWorkspaceItem>()
  for (const [key, item] of Object.entries(localMap)) {
    merged.set(key, item)
  }
  if (Array.isArray(serverList)) {
    for (const item of serverList) {
      if (typeof item?.key === 'string' && item.key !== '' && !merged.has(item.key)) {
        merged.set(item.key, item)
      }
    }
  }
  return [...merged.values()].sort((a, b) =>
    b.archivedAt !== a.archivedAt ? b.archivedAt - a.archivedAt : a.key.localeCompare(b.key),
  )
}

/**
 * DSH「设置 → 通用」（`settings.general.item`）中挂载的「已归档的工作空间」管理卡片（2026-10-21 WSR2）。
 *
 * 支持查看全部已归档工作空间并点击「放出」恢复到侧栏。
 *
 * 标题行可点击折叠/展开，**默认折叠**（`expanded` 初值 `false`）：折叠时只显示标题、
 * 描述、已归档数量与 `chevronRight`，展开后才渲染下方列表或空态提示。
 */
export function ArchivedWorkspacesSettingItem(props: SidebarProps): ReactNode {
  const seat = props?.t
  const t: Translate = typeof seat === 'function' ? createSeatT(seat as Translate) : FALLBACK_T
  const [items, setItems] = useState<ArchivedWorkspaceItem[]>(() =>
    mergeArchivedWorkspaceItems(readArchivedProjectsMap()),
  )
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  const refresh = useCallback((): void => {
    const localMap = readArchivedProjectsMap()
    setItems(mergeArchivedWorkspaceItems(localMap))
    void fetch(ROUTE_TREE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
      .then(async (res) => await res.json())
      .then((body: Any) => {
        const latestLocal = readArchivedProjectsMap()
        const serverList = Array.isArray(body?.archivedProjects)
          ? (body.archivedProjects as ArchivedWorkspaceItem[])
          : undefined
        setItems(mergeArchivedWorkspaceItems(latestLocal, serverList))
      })
      .catch(() => {
        /* 静默降级 */
      })
  }, [])

  useEffect(() => {
    refresh()
    archiveListeners.add(refresh)
    return () => {
      archiveListeners.delete(refresh)
    }
  }, [refresh])

  const restore = (projectKey: string): void => {
    setBusyKey(projectKey)
    unarchiveWorkspaceByKeyClient(projectKey)
    void fetch(ROUTE_TREE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ unarchiveProjectKey: projectKey }),
    })
      .then(async (res) => await res.json())
      .then((body: Any) => {
        const latestLocal = readArchivedProjectsMap()
        const serverList = Array.isArray(body?.archivedProjects)
          ? (body.archivedProjects as ArchivedWorkspaceItem[])
          : undefined
        setItems(mergeArchivedWorkspaceItems(latestLocal, serverList))
        notifyArchiveWorkspaceChanged()
      })
      .catch(() => {
        /* 静默 */
      })
      .finally(() => {
        setBusyKey(null)
      })
  }

  return jsxs('div', {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      padding: '12px 0',
      color: 'var(--dsw-alias-label-primary)',
    },
    children: [
      jsxs('div', {
        key: 'header',
        role: 'button',
        tabIndex: 0,
        'aria-expanded': expanded,
        onClick: () => { setExpanded((value) => !value) },
        onKeyDown: (event: Any) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            setExpanded((value) => !value)
          }
        },
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          cursor: 'pointer',
          userSelect: 'none',
        },
        children: [
          jsxs('div', {
            key: 'labels',
            style: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 },
            children: [
              jsx('div', {
                key: 'title',
                style: { fontSize: 14, fontWeight: 500, lineHeight: '20px' },
                children: t('settings.archivedWorkspaces.title'),
              }),
              jsx('div', {
                key: 'desc',
                style: dimText(12),
                children: t('settings.archivedWorkspaces.description'),
              }),
            ],
          }),
          jsxs('div', {
            key: 'meta',
            style: { display: 'flex', alignItems: 'center', gap: 6, flex: 'none', ...dimText(12) },
            children: [
              jsx('span', {
                key: 'count',
                children: items.length,
              }),
              jsx('span', {
                key: 'chevron',
                style: { display: 'inline-flex', alignItems: 'center', lineHeight: 0, ...dimText(12) },
                children: expanded ? icon('chevronDown') : icon('chevronRight'),
              }),
            ],
          }),
        ],
      }),
      expanded
        ? items.length === 0
          ? jsx('div', {
              key: 'empty',
              style: {
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.2))',
                ...dimText(12.5),
              },
              children: t('settings.archivedWorkspaces.empty'),
            })
          : jsx('div', {
              key: 'list',
              style: {
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              },
              children: items.map((item) =>
                jsxs('div', {
                  key: item.key,
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 10,
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.25))',
                  },
                  children: [
                    jsxs('div', {
                      key: 'info',
                      style: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 },
                      children: [
                        jsx('div', {
                          key: 'name',
                          style: {
                            fontSize: 13,
                            fontWeight: 500,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          },
                          children: item.title,
                        }),
                        item.path !== undefined
                          ? jsx('div', {
                              key: 'path',
                              style: {
                                ...dimText(11.5),
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              },
                              children: item.path,
                            })
                          : null,
                      ].filter(present),
                    }),
                    jsx(P.Button, {
                      key: 'restore',
                      variant: 'outline',
                      size: 'sm',
                      disabled: busyKey === item.key,
                      onClick: () => { restore(item.key) },
                      children: t('settings.archivedWorkspaces.restore'),
                    }),
                  ],
                }),
              ),
            })
        : null,
    ],
  })
}

