/**
 * 宿主图标解析层：把「逻辑图标名」映射到**当前宿主**真实存在的 primitives 导出。
 *
 * ## 为什么需要这一层（2026-10-19 侧栏整块渲染失败）
 *
 * `src/sidebar.tsx` 原来直接以**尺寸后缀**取宿主图标（`P.IconPlusOutline16`、
 * `P.IconChevronDownOutline14`、`P.IconArchiveOutline20` …），这在宿主
 * `@deepseek-ai/dsh-client-ui-primitives@0.1.5-rc.2` 上成立（导出快照见
 * `docs/HOST-CONTRACTS.md` §B5）。
 *
 * 宿主 `0.2.1-rc.2` 把图标导出改成了**线重后缀**：`IconPlusOutlineRegular`
 * （1px）/ `IconPlusOutlineMedium`（1.3px），尺寸改由 `size` prop 控制，
 * **`Icon*16` / `*14` / `*20` 这整套名字都不再存在**（实测导出表里没有任何
 * `Icon*` + 数字后缀的名字）。
 *
 * 直接取用因此不是"图标不显示"，而是**渲染期硬崩**：
 *
 * ```js
 * const LeadIcon = P.IconBranchOutline16   // undefined
 * jsx(LeadIcon, {})                        // Element type is invalid … got: undefined
 * ```
 *
 * 抛点在 `SidebarBoundary` 的子树内 ⇒ 侧栏被换成「侧栏渲染出错」；若发生在边界之外，
 * 宿主 `SlotErrorBoundary` 会 `abdicate` 本 entry，整块侧栏静默回落到官方
 * `ui-workspace`。用户看到的现象就是"这个插件导致侧栏渲染失败"。
 *
 * ## 契约
 *
 * 1. **候选表**：每个逻辑名给出「新命名优先、旧命名兜底」的候选序列，任一命中即用 ⇒
 *    插件对两个宿主版本同时成立，不需要跟宿主版本硬绑定。
 * 2. **绝不返回 `undefined`**：全部候选都缺席时回落**空图标组件**（渲染 `null`）。
 *    宿主再改一次命名，代价是少几个图标，而不是整块侧栏白掉。
 * 3. **纯逻辑**：本文件不 import react、不 import 任何 `@deepseek-ai/*` 包，
 *    宿主图标面由调用方以 `face` 传入（`sidebar.tsx` 传 esbuild external 的
 *    `Primitives`），因此可被 `node --test` 直接覆盖。
 *
 * 尺寸：宿主新组件的 `size` prop 默认 16；`ArchiveOutline20` 这类旧名字自带 20 的
 * 画板，因此候选表里同时记录**默认尺寸**，渲染时与宿主给的同名 prop 合并
 * （调用方显式传入的 `size` 优先）。
 */

/** 一个逻辑图标：候选导出名（新命名在前）+ 默认尺寸。 */
export interface IconSpec {
  /** 候选导出名，按优先级排列（新命名在前）。 */
  readonly candidates: readonly string[]
  /** 宿主未收到 `size` 时使用的尺寸。 */
  readonly size: number
}

/**
 * 逻辑名 → 候选导出名。
 *
 * 新命名（`*Regular` / `*Medium`）必须排在首位：宿主 `0.2.1` 只认它；
 * 旧命名（`Icon*16/14/20`）保留在后，让 `0.1.5` 组合继续可用。
 */
export const ICON_SPECS = {
  chevronDown: { candidates: ['IconChevronDownOutlineRegular', 'IconChevronDownOutline14'], size: 14 },
  chevronRight: { candidates: ['IconChevronRightOutlineRegular', 'IconChevronRightOutline14'], size: 14 },
  clock: { candidates: ['IconClockOutlineRegular', 'IconClockOutline16'], size: 16 },
  folderOpen: { candidates: ['IconFolderOpenOutlineRegular', 'IconFolderOpenOutline16'], size: 16 },
  folderClose: { candidates: ['IconFolderCloseRegular', 'IconFolderClose16'], size: 16 },
  branch: { candidates: ['IconBranchOutlineRegular', 'IconBranchOutline16'], size: 16 },
  panelLeft: { candidates: ['IconPanelLeftOutlineRegular', 'IconPanelLeftOutline16'], size: 16 },
  plus: { candidates: ['IconPlusOutlineRegular', 'IconPlusOutline16'], size: 16 },
  ellipsis: { candidates: ['IconEllipsisOutlineRegular', 'IconEllipsisOutline16'], size: 16 },
  projectAdd: { candidates: ['IconProjectAddOutlineRegular', 'IconProjectAddOutline16'], size: 16 },
  refresh: { candidates: ['IconRefreshOutlineRegular', 'IconRefreshOutline16'], size: 14 },
  copy: { candidates: ['IconCopyOutlineRegular', 'IconCopyOutline16'], size: 16 },
  edit: { candidates: ['IconEditOutlineRegular', 'IconEditOutline16'], size: 16 },
  trash: { candidates: ['IconTrashOutlineRegular', 'IconTrashOutline16'], size: 16 },
  archive: { candidates: ['IconArchiveOutlineRegular', 'IconArchiveOutline20'], size: 20 },
  newChat: { candidates: ['IconNewChatOutlineRegular', 'IconNewChatOutline16'], size: 16 },
} as const satisfies Record<string, IconSpec>

/** 逻辑图标名（`ICON_SPECS` 的键）。 */
export type IconName = keyof typeof ICON_SPECS

/** 全部逻辑图标名，顺序稳定（`ICON_SPECS` 的声明顺序）。 */
export const ICON_NAMES = Object.keys(ICON_SPECS) as readonly IconName[]

/** 解析结果：可渲染组件 + 命中的宿主导出名（回落时为 `undefined`）。 */
export interface ResolvedIcon {
  /** 组件：命中的宿主导出，或回落用的空图标（永不 `undefined`）。 */
  readonly Component: (props?: Record<string, unknown>) => unknown
  /** 命中的宿主导出名；回落时为 `undefined`。 */
  readonly candidate: string | undefined
}

/**
 * 空图标：候选全部缺席时的回落组件。
 *
 * 渲染 `null`（不是抛错、也不是 `undefined`）—— React 收到 `null` 是合法的
 * "不渲染任何东西"，侧栏其余部分照常工作。
 */
function NullIcon(): unknown {
  return null
}

/** 读宿主图标面的一个名字；非函数一律视为缺席（导出了同名的非组件值也不算命中）。 */
function iconAt(face: unknown, name: string): ((props?: Record<string, unknown>) => unknown) | undefined {
  if (face === null || face === undefined) return undefined
  const value = (face as Record<string, unknown>)[name]
  return typeof value === 'function' ? (value as (props?: Record<string, unknown>) => unknown) : undefined
}

/**
 * 解析一个逻辑图标。
 *
 * 结果按 `(face, name)` 缓存：同一宿主面重复解析必须返回**同一组件引用**，
 * 否则 `sidebar.tsx` 里以图标为局部变量的渲染会每次拿到新组件类型，让 React
 * 把整行当新组件卸载重建（拖拽与 hover 态都会被打断）。
 *
 * @param face 宿主 primitives 面（缺省/缺席都安全）。
 * @param name 逻辑图标名。
 * @returns 可渲染组件与命中的导出名；永不抛错。
 */
const resolvedCache = new WeakMap<object, Map<string, ResolvedIcon>>()
const fallbackCache = new Map<string, ResolvedIcon>()

export function resolveIcon(face: unknown, name: IconName): ResolvedIcon {
  const spec = ICON_SPECS[name]
  const hit = spec.candidates.find((candidate) => iconAt(face, candidate) !== undefined)
  if (hit === undefined) {
    // 缺席时也按名字缓存，保证同一逻辑名恒得同一引用。
    const cached = fallbackCache.get(name)
    if (cached !== undefined) return cached
    const fallback: ResolvedIcon = { Component: NullIcon, candidate: undefined }
    fallbackCache.set(name, fallback)
    return fallback
  }
  const key = face as object
  let perFace = resolvedCache.get(key)
  if (perFace === undefined) {
    perFace = new Map<string, ResolvedIcon>()
    resolvedCache.set(key, perFace)
  }
  const cached = perFace.get(name)
  if (cached !== undefined && cached.candidate === hit) return cached
  const resolved: ResolvedIcon = {
    Component: iconAt(face, hit) as (props?: Record<string, unknown>) => unknown,
    candidate: hit,
  }
  perFace.set(name, resolved)
  return resolved
}

/**
 * 列出该宿主面下**一个候选都不存在**的逻辑图标（漂移诊断用）。
 *
 * @param face 宿主 primitives 面。
 * @returns 解析不到的图标名（顺序同 {@link ICON_NAMES}）。
 */
export function unresolvedIcons(face: unknown): IconName[] {
  return ICON_NAMES.filter((name) => resolveIcon(face, name).candidate === undefined)
}

/**
 * 图标默认尺寸（宿主新组件默认 16，`ArchiveOutline` 原画板 20）。
 *
 * 渲染层在 `jsx(Component, { size })` 时用它做默认值，调用方显式传入的 `size` 优先。
 *
 * @param name 逻辑图标名。
 * @returns 该图标的默认尺寸。
 */
export function iconSize(name: IconName): number {
  return ICON_SPECS[name].size
}

