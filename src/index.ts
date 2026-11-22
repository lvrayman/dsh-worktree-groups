/**
 * 宿主半边入口（契约见 `docs/INTERFACES.md` §1.6）。
 *
 * ## 依赖姿态（宿主契约 §2.5 / §C14）
 *
 * 本文件**只** `import type { Context } from '@deepseek-ai/cordis'` ——
 * 这是全包唯一允许的 `@deepseek-ai/*` 静态 import，且是 type-only（编译后消失）。
 * 理由（实测，见 `docs/HOST-CONTRACTS.md` §C14.4）：DSH 的 ESM 解析钩子会**优先命中**
 * 插件自带 `node_modules`，一旦运行时真的加载到第二份 `cordis`，`Service` 基类身份
 * 分裂，本插件注册的服务全部失效。宿主服务（`webServer` / `workspaceRegistry` /
 * `sessionPersistence` / `sessionController` / `sessions`）一律走 `ctx.get(name)` 运行时获取。
 *
 * ## 降级策略（PRD R6）
 *
 * `inject = ['webServer']` 保证路由注册发生在 webServer 就绪之后；但 `webServer`
 * 本身缺席（非 web profile）时 `apply` 也**不抛错**，只是什么都不注册 ——
 * 「缺失即降级，绝不崩」。
 */

import type { Context } from '@deepseek-ai/cordis'

import { registerRoutes } from './routes.js'

export const name = 'dsh-worktree-groups'

/**
 * 硬依赖：只有 `webServer`。
 *
 * 其余宿主服务（`workspaceRegistry` / `sessionPersistence` / `sessionController` /
 * `sessions`）都是**软依赖**，在 `routes.ts` 里用 `ctx.get()` 惰性读取并在缺失时降级
 * （返回空树而不是抛错）。把它们写进 `inject` 会让插件在它们缺席时永久 pending，
 * 而本插件没有这个必要。
 */
export const inject = ['webServer']

/** 宿主半边入口。业务实现在 `routes.ts` / `git.ts` / `projects.ts` / `ledger.ts`。 */
export function apply(ctx: Context): void {
  try {
    registerRoutes(ctx)
  } catch (error) {
    // 路由注册失败（例如同名路由已被别的插件占用）不应该让整个插件行加载失败：
    // 记录后继续，客户端侧会看到 /tree 404 并走自己的错误边界。
    const message = error instanceof Error ? error.message : String(error)
    try {
      ctx.logger?.warn?.(`dsh-worktree-groups: HTTP 路由注册失败：${message}`)
    } catch {
      // logger 不可用：静默（绝不因日志而崩）
    }
  }
}
