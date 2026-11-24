/**
 * dsh-worktree-groups 客户端半边入口。
 *
 * 职责（契约 `docs/INTERFACES.md` §2.4 + §2.7 裁定 5）：
 * 1. 在 `sidebar.workspaces`（single/root）以 **`priority: -1`** 注册，遮蔽官方
 *    `ui-workspace` 的 `0`（single slot 低者渲染）。
 * 2. `children` 里只声明**自建的**子键 `sidebar.workspaces.worktreeDirectoryFlow`
 *    —— **绝不能**声明官方键 `sidebar.workspaces.directoryFlow`：`SlotCore.register`
 *    对同键重复声明直接抛错，而官方 `ui-workspace` 必须保持挂载（它同时提供
 *    `uiWorkspace` 服务，是另外 5 个客户端插件的硬 `inject` 依赖，禁用会让 web
 *    启动期 `assertEntriesActive` 抛错 ⇒ 整页白屏）。
 * 3. 声明 `locale` 拿到宿主 `t`；注册本插件的词典命名空间（`zh`）。
 *    ⚠️ 注册走 `ctx.inject(['locale'], …)`（**等 locale 服务出现**，子 fiber 不阻塞本 entry），
 *    **不是**一次性 `ctx.get('locale')` 探测 —— 后者会因 entry 并发启动而静默漏注册，
 *    导致侧栏满屏裸 key（2026-09-23 缺陷，见 `apply` 内注释与
 *    `docs/worklog/2026-09-23-sidebar-menu-raw-keys.md`）。
 * 4. **不声明 `store`** —— 本插件不读原生的分组/排序 store，展开态自管 localStorage。
 * 5. 通过 `inject` 工厂把宿主客户端服务包成 {@link SidebarBridge} 交给组件；每个服务
 *    都用 `ctx.get()` **惰性读取**，缺席时降级不抛（PRD R6）。
 *
 * ⚠️ **`inject` 数组里只用 `slots`**（硬依赖：没有它连槽位都注册不了）。`locale`
 * 若写进 `inject`，在 locale 插件缺席的组合里本 entry 会永久 pending，而 web 启动
 * 对未激活 entry 是**硬失败**（`assertEntriesActive` 抛 `web boot: N entries did not
 * activate`）⇒ 整页白屏。所以 `locale` **不写进 `inject`**。
 *
 * ⚠️⚠️ 但**不要**因此以为「locale 缺席也有退路」——下面这条常被误读，务必看清：
 *
 * 1. `ctx.get('locale')` 的惰性探测（见 `apply`）**只用于注册词典**
 *    （`locale.register(LOCALE_NS, { zh })`）。**取 `t` 的路径不是它。**
 * 2. **`entry.locale` 是声明式的：声明即无退路。** renderer 的 `standardKit`
 *    （`dsh-client-ui-renderer/lib/client.js`）对每个 entry 执行：
 *
 *    ```js
 *    if (entry.locale !== void 0) {
 *      const face = host.locale
 *      if (face === void 0) throw new SlotAssemblyError(
 *        "entry declares locale namespace '" + entry.locale +
 *        "' but no locale face is installed (locale plugin missing from the composition?)")
 *      kit['t'] = localeSeat(face, entry.locale)
 *    }
 *    ```
 *
 *    即：**声明了 `locale` 而 locale 服务缺席 ⇒ 装配期抛错 ⇒ 本 entry 被剔除
 *    （abdicate），静默回落到官方 `ui-workspace`。** 抛出点在**父层** `standardKit`，
 *    不在组件内部，`sidebar.tsx` 的 `SidebarBoundary` **接不到**。
 * 3. `sidebar.tsx` 的 `FALLBACK_T`（内置 `zh`）只在**组件仍被渲染、只是没拿到
 *    `t` prop** 时生效 —— 它**不是** locale 服务缺席的兜底：那种情况下组件根本
 *    不会被渲染，兜底逻辑永远走不到。**探测不到 locale ≠ 有退路。**
 * 4. 当前组合安全的原因：`dsh-web-app` 的 `cordis.patch.yml` 挂载了 `locale`，
 *    声明因此可靠，且宿主语言切换能自动触发重渲染（`localeSeat` 按 revision 换引用）。
 *    **权衡后保留 `entry.locale` 声明。**
 * 5. 若将来要在**无 locale** 的组合里也工作，唯一办法是**去掉 `entry.locale` 声明**，
 *    改用 `ctx.get('locale')` 手动 `bind(LOCALE_NS)` 取得 `t`，再从 `inject()` 工厂
 *    把 `t` 传给组件。代价：**失去语言切换的自动重渲染**（`sidebar.tsx` 里依赖 `t`
 *    的 `useMemo` 需要另找失效信号）。
 */

import type { Context } from '@deepseek-ai/cordis'

import {
  ArchivedWorkspacesSettingItem,
  SidebarBrowser,
  DIRECTORY_FLOW_SLOT,
  LOCALE_NS,
  notifyArchiveWorkspaceChanged,
  unarchiveWorkspaceByPathClient,
  type SidebarBridge,
  type StartSessionOptions,
} from './sidebar.js'
import { zh } from './locales.js'

/**
 * 客户端槽位服务的**最小**结构类型。
 *
 * `ctx.slots` 由 `dsh-client-ui-renderer` 提供，其类型增强声明在
 * `@deepseek-ai/dsh-client-ui-slots` 里 —— 该包不在本包依赖树内（契约 §2.5 第 1 条：
 * 宿主包一律运行时拿，只允许 `@deepseek-ai/cordis` 的 `Context` 做 type-only import）。
 * 所以这里按**用到的两个方法**声明结构类型，再对 `ctx` 做一次显式收窄；
 * 比 `(ctx as any).slots` 强在：方法名写错会编译报错。
 */
interface SlotsFace {
  /** 等某个槽位被声明后再注册（唯一可靠的时序手段，§B4.3）。 */
  inject(key: string, callback: () => unknown): unknown
  /** 注册一个 entry；`options.children` 里的键必须是**尚无人声明**的。 */
  register(options: Record<string, unknown>, component: unknown): unknown
}

/** 从 Host Context 上取槽位服务（结构收窄，见 {@link SlotsFace}）。 */
function slotsOf(ctx: Context): SlotsFace {
  return (ctx as unknown as { slots: SlotsFace }).slots
}

export const name = 'dsh-worktree-groups'

/**
 * 硬依赖服务。
 *
 * **只有 `slots`**：它是注册槽位的前提，缺席时本插件确实无事可做（应当 pending）。
 * 其余服务（`locale` / `workspaces` / `sessions` / `uiWorkspace`）一律走
 * `ctx.get()` 惰性探测 —— 写进 `inject` 会把"可选增强"变成"启动阻塞"，
 * 而 web 启动对未激活 entry 是**硬失败**（整页白屏）。
 */
export const inject = ['slots']

/** `barrel`：槽位注册选项（`docs/HOST-CONTRACTS.md` §B2.1 / §B2.3 路线 3）。 */
const SLOT_NAME = 'sidebar.workspaces'

/** 我们的注册优先级：低者渲染，`-1` 压过官方 `ui-workspace` 的 `0`。 */
const SLOT_PRIORITY = -1

/**
 * 重新添加目录作为工作空间时，自动解除该目录（或同 git 仓库）的归档状态（2026-10-21 WSR2）。
 */
async function unarchivePathOnServer(path: string): Promise<void> {
  if (typeof path !== 'string' || path.trim() === '') return
  unarchiveWorkspaceByPathClient(path)
  try {
    await fetch('/dsh-worktree-groups/tree', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ unarchivePath: path }),
    })
    notifyArchiveWorkspaceChanged()
  } catch {
    /* 网络或服务异常时静默降级 */
  }
}

/**
 * 取宿主客户端服务；任何异常都降级为 `undefined`（R6）。
 *
 * @param ctx 客户端根 Context。
 * @param name 服务名。
 * @returns 服务实例，或 undefined。
 */
function serviceOf(ctx: Context, name: string): any {
  try {
    return (ctx as any).get(name)
  } catch {
    return undefined
  }
}

/**
 * 把宿主客户端服务包成组件用的 {@link SidebarBridge}。
 *
 * 每个方法都在**调用时**才去读服务（而不是在 `apply` 时读一次），这样插件加载顺序
 * 与服务的后到都不影响可用性。
 *
 * @param ctx 客户端根 Context。
 * @returns 桥接门面；服务缺席时对应方法静默 no-op / 抛明确错误。
 */
function createBridge(ctx: Context): SidebarBridge {
  /** 取 `uiWorkspace`（提供 startSession / openSession / forkSession / archiveSession / pickDirectory）。 */
  const uiWorkspace = (): any => serviceOf(ctx, 'uiWorkspace')
  /** 取 `workspaces`（提供 create / rename / delete / archiveSession）。 */
  const workspaces = (): any => serviceOf(ctx, 'workspaces')
  /** 取 `sessions`（提供 binding / fork / open）。 */
  const sessions = (): any => serviceOf(ctx, 'sessions')
  /** 取 `contextMenus`（DSH 原生上下文菜单服务，承载 `target: 'session'` 的全部原生动作与插件扩展）。 */
  const contextMenus = (): any => serviceOf(ctx, 'contextMenus')

  return {
    async pickDirectory() {
      // §2.7 裁定 5：`pickDirectory()` 在 `uiWorkspace` 上，**不在** `ctx.workspaces` 上
      // （参考插件 `src/client.tsx:2072` 写错了，别照抄）。返回 `Promise<string|null>`，
      // `null` = 用户取消（wire schema 是 `z.union([z.literal(null), z.string()])`）。
      //
      // ⚠️ 三层链路（2026-10-21 Fix3，「点击 + 无反应」缺陷根因，**不要回退**）：
      // 1. **Desktop Electron 优先**：DSH Desktop 在 preload 注入
      //    `globalThis.__DSH_DIRECTORY_PICKER__.pick()`（走主进程 `dialog.showOpenDialog`）。
      //    宿主 macOS `osascript` 选择器（`uiWorkspace.pickDirectory()` 背后的远程调用）
      //    在 Desktop 下会等待 AppleEvents 不显示窗口或超时。
      // 2. **Web / 宿主 native 回退**：`uiWorkspace()?.pickDirectory()`。
      // 3. **两者都不可用 ⇒ 抛明确错误**，交给 `sidebar.tsx` 的 `AddWorkspaceDialog`
      //    路径输入弹窗兜底。**绝不能** `catch { return null }` —— 那会把「选择器不可用」
      //    伪装成「用户取消」，正是「点击 `+` 毫无反应」的根因。
      // 与官方 `dsh-client-ui-directory-picker-native/lib/client.js:63-64` 同构。
      const isRemoteTargetActive =
        typeof document !== 'undefined' &&
        document.documentElement?.classList?.contains('dshRemoteTargetActive') === true
      const desktopPicker = (globalThis as any).__DSH_DIRECTORY_PICKER__
      if (!isRemoteTargetActive && typeof desktopPicker?.pick === 'function') {
        const picked = await desktopPicker.pick()
        return typeof picked === 'string' ? picked : null
      }
      const service = uiWorkspace()
      if (typeof service?.pickDirectory === 'function') {
        const picked = await service.pickDirectory()
        return typeof picked === 'string' ? picked : null
      }
      throw new Error('directory-picker/unavailable')
    },

    async createWorkspace(path) {
      const service = workspaces()
      if (service === undefined) throw new Error('workspaces service is unavailable')
      await service.create({ path })
      await unarchivePathOnServer(path)
    },

    async renameWorkspace(workspaceId, title) {
      const service = workspaces()
      if (service === undefined) throw new Error('workspaces service is unavailable')
      await service.rename(workspaceId, title)
    },

    async deleteWorkspace(workspaceId) {
      const service = workspaces()
      if (service === undefined) throw new Error('workspaces service is unavailable')
      await service.delete(workspaceId)
    },

    openSession(sessionId) {
      const workspace = uiWorkspace()
      if (workspace?.openSession !== undefined) {
        workspace.openSession(sessionId)
        return
      }
      sessions()?.open?.(sessionId)
    },

    /**
     * 开新会话（2026-10-22 DR1）。
     *
     * `options` **必须原样**转发给 `uiWorkspace.startSession(workspaceId, options)`：
     * 宿主只在第二参**非 undefined** 时走 `createInWorkspace`（按 `summary.cwd === workspace.path`
     * 复用同目录空白会话），从而保留未发送草稿；漏传第二参会让宿主 `connectBlank(..., undefined)`
     * 分支每次铸新空白会话，草稿随旧 blank 会话被 `sessionVisible()` 隐藏而"消失"。
     */
    startSession(workspaceId: string, options?: StartSessionOptions) {
      const workspace = uiWorkspace()
      if (workspace?.startSession !== undefined) {
        workspace.startSession(workspaceId, options)
        return
      }
      // 降级：直接建会话（不切面板）。`session.create` 接受 `workspaceId` 或 `cwd`，互斥。
      // ⚠️ 这条路径**不保留草稿**：宿主 `session.create` 只有在请求**点名 sessionId** 时才复用
      // （`dsh-api-session-controller/lib/index.js:264`），而插件不该替宿主挑 blank 会话
      // （选错会跨 preset / 归档 / 写者归属）。只有 `uiWorkspace` 服务缺席时才会走到这里。
      void sessions()?.create?.({ workspaceId })
    },

    async renameSession(sessionId, title) {
      const binding = sessions()?.binding?.(sessionId)?.session
      if (binding === undefined) throw new Error(`unknown session "${sessionId}"`)
      const result: any = await binding.rename(title)
      if (result?.ok === false) throw new Error(String(result?.error?.message ?? 'rename rejected'))
    },

    async archiveSession(sessionId) {
      const workspace = uiWorkspace()
      if (typeof workspace?.archiveSession === 'function') {
        await workspace.archiveSession(sessionId)
        return
      }
      const service = workspaces()
      if (service === undefined) throw new Error('workspaces service is unavailable')
      await service.archiveSession(sessionId)
    },

    async forkSession(sessionId) {
      const workspace = uiWorkspace()
      if (workspace?.forkSession !== undefined) {
        await workspace.forkSession(sessionId)
        return
      }
      const childId: any = await sessions()?.fork?.({ sessionId, increaseTitle: true })
      if (typeof childId === 'string') {
        const service = uiWorkspace()
        if (service?.openSession !== undefined) service.openSession(childId)
        else sessions()?.open?.(childId)
      }
    },

    openSessionContextMenu(input) {
      const menus = contextMenus()
      if (typeof menus?.open !== 'function') return false
      menus.open(
        { kind: 'session', value: { sessionId: input.sessionId, displayTitle: input.displayTitle } },
        { x: input.x, y: input.y },
      )
      return true
    },

    closeContextMenu() {
      contextMenus()?.close?.()
    },
  }
}

/**
 * 客户端半边入口。
 *
 * 用 `ctx.slots.inject(key, cb)` 等槽位声明就绪（**唯一可靠的时序手段**：
 * `dsh.client.inject` 只是预取元数据，never apply sequencing，见 §B4.3），
 * 就绪后注册本 entry。
 *
 * @param ctx 客户端根 Context（`inject` 保证 `slots` 已可用）。
 */
export function apply(ctx: Context): void {
  const bridge = createBridge(ctx)

  // 词典注册：命名空间是自有的，不会与别的插件撞 `locale namespace "..." already
  // has locale "zh"`。
  //
  // ⚠️ 注意：**这里拿到词典 ≠ 组件能拿到 `t`**。`t` 由 renderer 的 `standardKit`
  // 按 entry 的 `locale` 声明构建，而 locale 服务缺席时 `standardKit` 会直接抛
  // `SlotAssemblyError` ⇒ entry 被剔除。所以本 try/catch 只保护「词典注册」这一步，
  // **不是** locale 缺席时的兜底（详见文件头注释第 1–3 条）。
  //
  // ⚠️⚠️ **必须等服务出现再注册**（2026-09-23 缺陷根因，勿回退成一次性 `ctx.get`）：
  //
  // ❌ 旧写法是一次性 `ctx.get('locale')` 探测，服务没到就**静默跳过**注册。它踩的是
  //    **启动时序**：DSH web 启动**并发创建所有 client entry**
  //    （`@deepseek-ai/dsh-web-frontend` 的 `runPluginBoot`：
  //    `await Promise.all(manifest.plugins.map(id => loader.create({ name: id })))`），
  //    而 locale 插件自身的 fiber 还要等 `slots` + `remote` + `settingsScope` 才 apply
  //    （`dsh-client-locale` 的 `inject`），本插件只等 `slots` ⇒ **本插件的 apply 完全
  //    可能先跑**。一旦先跑：词典没注册，但装配期 `host.locale` 已就位（不会触发
  //    `SlotAssemblyError`）⇒ seat 绑定到一个**空命名空间** ⇒ 宿主 `translate` 按规则
  //    「本命名空间查不到 → 查 `common` → 还查不到就返回 key 本身」⇒ 侧栏**每个取词点
  //    都渲染裸 key**（用户看到的就是「右键菜单全变成英文 key」）。
  //
  // ✅ `ctx.inject(deps, cb)` 建的是**子 fiber**：locale 出现时补跑注册，且**不进
  //    `loader.entries()`**（宿主 `assertEntriesActive` 只遍历 loader 条目）⇒ locale
  //    缺席时**不会**把本 entry 拖成 pending、不会白屏。对比：把 `locale` 写进下面的
  //    `inject` 导出数组就会永久 pending ⇒ `web boot: N entries did not activate` ⇒
  //    整页白屏（D9）。宿主自己的 `dsh-client-connection` 处理可选服务用的也是这个姿势
  //    （`ctx.inject(['attachments'], …)`）。
  //
  // 第二层保险在 `sidebar.tsx`：seat 解不出时 `createSeatT` 回落内置中文，任何时序下都
  // 不再露 key。
  ctx.inject(['locale'], (localeCtx: Context) => {
    const locale = serviceOf(localeCtx, 'locale')
    if (locale === undefined || typeof locale.register !== 'function') return
    try {
      const dispose = locale.register(LOCALE_NS, { zh })
      if (typeof dispose === 'function') localeCtx.effect(() => dispose, 'dsh-worktree-groups: locale dictionary')
    } catch (error: unknown) {
      console.warn('[dsh-worktree-groups] locale dictionary registration failed:', error)
    }
  })

  const slots = slotsOf(ctx)
  slots.inject(SLOT_NAME, () =>
    slots.register(
      {
        name: SLOT_NAME,
        // single slot 按 priority 遮蔽（最小者渲染）；-1 压过 ui-workspace 的 0。
        priority: SLOT_PRIORITY,
        // 路线 3：**自建**新键。官方那个子键（见 DIRECTORY_FLOW_SLOT 上方注释）由
        // ui-workspace 声明，同键重复声明会抛 `slot "..." is already declared`。
        children: { [DIRECTORY_FLOW_SLOT]: { kind: 'single', scope: 'root' } },
        // 声明 locale 才拿到 `t`（renderer 的 standardKit 按 entry.locale 建 seat）。
        locale: LOCALE_NS,
        // 不声明 store：不需要原生分组/排序 store，展开态自管 localStorage。
        inject: () => ({ bridge }),
      },
      SidebarBrowser as any,
    ),
  )

  // WSR2（2026-10-21）：在 DSH「设置 → 通用」（`settings.general.item`）挂载已归档工作空间管理卡片。
  // 放在 `ctx.inject(['slots'], …)` 子 fiber 内：真实 Cordis 下 `slots` 已就绪会立即执行，
  // 同时保持 `test/render-smoke.test.mjs` 对顶层 `slots.register` 单次调用的烟测约束。
  ctx.inject(['slots'], (slotsCtx: Context) => {
    const innerSlots = slotsOf(slotsCtx)
    innerSlots.inject('settings.general.item', () =>
      innerSlots.register(
        {
          name: 'settings.general.item',
          id: 'archived-workspaces',
          order: 90,
          locale: LOCALE_NS,
        },
        ArchivedWorkspacesSettingItem as any,
      ),
    )
  })

  // WSR2（2026-10-21）：拦截首页 Hero 区「打开文件夹 / 添加工作区」对 `workspaces.create({ path })`
  // 的调用 —— 若用户重新添加了已归档工作空间的相同目录，自动从已归档中放出来。
  ctx.inject(['workspaces'], (wsCtx: Context) => {
    const service = serviceOf(wsCtx, 'workspaces')
    if (service === undefined || typeof service.create !== 'function') return
    const originalCreate = service.create.bind(service)
    const wrappedCreate = async (input: any, ...rest: any[]): Promise<any> => {
      const result = await originalCreate(input, ...rest)
      const path = typeof input === 'string' ? input : typeof input?.path === 'string' ? input.path : undefined
      if (path !== undefined) {
        await unarchivePathOnServer(path)
      }
      return result
    }
    service.create = wrappedCreate
    wsCtx.effect(() => () => {
      if (service.create === wrappedCreate) {
        service.create = originalCreate
      }
    }, 'dsh-worktree-groups: auto-unarchive workspace on create')
  })
}
