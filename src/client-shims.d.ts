/**
 * 客户端半边（`src/sidebar.tsx` / `src/client.tsx`）的最小类型 shim。
 *
 * 存在理由（`docs/INTERFACES.md` §2.5）：本包 `node_modules` 里**没有** `@types/react`，
 * `react` / `react/jsx-runtime` / `@deepseek-ai/dsh-client-ui-primitives` 在运行时由宿主
 * shell 注入（esbuild `external`）。契约**禁止** `import type` 宿主包，也**不**引入
 * `@types/react`（版本可能与 shell 注入的 React 不一致，且 esbuild 不做类型检查）。
 *
 * 因此这里只声明本包源码**实际用到**的成员。`ReactNode` 刻意用不透明元素类型而不是
 * `unknown`：返回值类型写错（返回对象字面量等）仍然报错，只有「元素」这个本包无法
 * 亲手构造的类型被放行。
 */
declare module 'react/jsx-runtime' {
  /** 不透明 JSX 元素：只有 `jsx` / `jsxs` 能产出（本包不手工构造）。 */
  export interface ReactElement {
    readonly $$typeof: symbol
  }
  export function jsx(type: unknown, props?: unknown, key?: unknown): ReactElement
  export function jsxs(type: unknown, props?: unknown, key?: unknown): ReactElement
}

declare module 'react' {
  import type { ReactElement } from 'react/jsx-runtime'

  export type ReactNode =
    | ReactElement
    | string
    | number
    | boolean
    | null
    | undefined
    | readonly ReactNode[]

  export type CSSProperties = Record<string, string | number | undefined>
  export type ComponentType<P = Record<string, unknown>> = (props: P) => ReactNode

  export class Component<P = Record<string, unknown>, S = Record<string, unknown>> {
    constructor(props: P)
    props: P
    state: S
    setState(state: Partial<S> | ((prev: S) => Partial<S> | null)): void
    render(): ReactNode
    static getDerivedStateFromError?(error: unknown): Partial<S> | null
    componentDidCatch?(error: unknown, info: unknown): void
  }

  export function useState<T>(initial: T | (() => T)): [T, (next: T | ((prev: T) => T)) => void]
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void
  export function useMemo<T>(factory: () => T, deps?: readonly unknown[]): T
  export function useCallback<T>(callback: T, deps?: readonly unknown[]): T
  export function useRef<T>(initial: T): { current: T }
  /** 2026-11-14：会话行 memo 化（比较器返回 true ⇒ 跳过重绘）。 */
  export function memo<P>(component: (props: P) => ReactNode, areEqual?: (prev: P, next: P) => boolean): (props: P) => ReactNode
}

declare module '@deepseek-ai/dsh-client-ui-primitives'
