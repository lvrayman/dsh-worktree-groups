/**
 * 会话行 memo 化的比较器（纯逻辑，零宿主 / React 依赖）。
 *
 * ## 为什么需要
 *
 * 侧栏订阅了宿主多个高频快照（`useSessions` / `useSessionStatus` …），任何一个变化都会
 * 让 `SidebarBrowserInner` 整体重渲染；行数据经 `withLiveState` 浅拷贝，事件处理器也是
 * 每次新建的闭包 ⇒ 不做 memo 时每次都要重绘全部会话行。
 *
 * `SessionRowView` 用 `React.memo(…, sessionRowPropsEqual)` 包装后：
 * - **行可见字段**逐个 `Object.is` 比较（行对象是不是新引用无所谓）；
 * - **拖拽状态**只比 `draggable / dragging / marker` 三个可见字段；
 * - 事件处理器**不进 props**：子组件经稳定的 `handlers` 容器（`{ current: Map<rowKey, …> }`，
 *   父组件每次渲染都整体刷新）在事件发生时取**最新**实现 ⇒ 跳过重绘也不会调用到陈旧闭包。
 */

/** 拖拽的可见状态（不含处理器）。 */
export interface RowDragState {
  draggable: boolean
  dragging: boolean
  marker: 'before' | 'after' | null
}

/** memo 化会话行的 props（比较器只读这些字段）。 */
export interface MemoSessionRowProps {
  row: object
  t: unknown
  rowKey: string
  handlers: unknown
  drag?: RowDragState | undefined
}

/** 两个普通对象的浅相等（键集合相同且每个值 `Object.is`）。 */
export function shallowEqualRecord(a: object, b: object): boolean {
  if (a === b) return true
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = Object.keys(left)
  if (keys.length !== Object.keys(right).length) return false
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(right, key)) return false
    if (!Object.is(left[key], right[key])) return false
  }
  return true
}

function dragStateEqual(a: RowDragState | undefined, b: RowDragState | undefined): boolean {
  if (a === undefined || b === undefined) return a === b
  return a.draggable === b.draggable && a.dragging === b.dragging && a.marker === b.marker
}

/** `React.memo` 比较器：返回 `true` ⇒ 跳过重绘。 */
export function sessionRowPropsEqual(prev: MemoSessionRowProps, next: MemoSessionRowProps): boolean {
  return (
    prev.t === next.t &&
    prev.handlers === next.handlers &&
    prev.rowKey === next.rowKey &&
    dragStateEqual(prev.drag, next.drag) &&
    shallowEqualRecord(prev.row, next.row)
  )
}
