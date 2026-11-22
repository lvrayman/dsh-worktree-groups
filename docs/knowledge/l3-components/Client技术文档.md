---
生成时间: 2026-09-22
更新时间: 2026-09-22
git-version: 9bd94252dd934c2fa8491977285e461b703f0f3e
git-module-path: src
level: L3
---

# client.tsx（客户端半边入口）技术文档

> **文件路径**: `src/client.tsx`

> 本文档描述 `dsh-worktree-groups` 的**客户端半边入口**：它注册并抢占宿主侧栏槽位
> `sidebar.workspaces`，把宿主客户端服务包成桥接门面交给 React 组件。
> 组件渲染细节见 [Sidebar 技术文档](./Sidebar技术文档.md)，词条表见
> [Locales 技术文档](./Locales技术文档.md)。
>
> ⚠️ **2026-09-23 局部修订**：frontmatter 的 `git-version` 仍是知识库生成时的
> `9bd9425`，但**词典注册姿势**已改（一次性 `ctx.get('locale')` → `ctx.inject(['locale'], …)`，
> 见「宿主注入的客户端服务」「执行流程」「并发与线程模型」「边界条件」「已知缺陷」各节）。
> 修订原因与证据：`docs/worklog/2026-09-23-sidebar-menu-raw-keys.md`、
> `docs/HOST-CONTRACTS.md` §B4.4。文中未标注修订的行号锚点仍对应 `9bd9425`。
>
> ⚠️ **2026-10-22 定点修订**：`bridge.startSession` 增加可选第二参
> `options?: StartSessionOptions`（`{ clearPreviousDraft?: boolean }`）并**原样转发**给
> `uiWorkspace.startSession(workspaceId, options)`；宿主只有收到第二参时才按 `cwd` 复用
> 已有空白会话，从而保留未发送草稿（缺陷：切换会话后再点「新建会话」草稿丢失）。
> 已在方法表（`startSession` 行）与「边界条件」的缺席降级行重标行号；契约见
> `docs/INTERFACES.md` §2.4，缺陷记录见 `docs/worklog/2026-10-22-new-session-draft-retention.md`。

---

## 目录

- [概述](#概述)
- [构造参数与依赖](#构造参数与依赖)
- [核心方法签名](#核心方法签名)
- [执行流程](#执行流程)
- [状态机](#状态机)
- [并发与线程模型](#并发与线程模型)
- [边界条件](#边界条件)
- [代码示例](#代码示例)
- [已知缺陷与注意事项](#已知缺陷与注意事项)
- [相关文档](#相关文档)

---

## 概述

`src/client.tsx`（257 行）是本插件在**浏览器端**的 cordis 插件入口。宿主
`dsh-client-modules` 以包名 `dsh-worktree-groups` 为 entry id 加载它的构建产物
`lib/client.js`，后者导出 `name` / `inject` / `apply` 三个符号
（`src/client.tsx:80`、`src/client.tsx:90`、`src/client.tsx:219`）。

**职责**（文件头注释 `src/client.tsx:1-52`）：

1. 在 `sidebar.workspaces` 槽位以 `priority: -1` 注册，**遮蔽**官方 `ui-workspace`
   的注册（`src/client.tsx:93-96`、`src/client.tsx:241-245`）。
2. 只声明**自建**子槽位键 `sidebar.workspaces.worktreeDirectoryFlow`，绝不碰官方键
   `sidebar.workspaces.directoryFlow`（`src/client.tsx:246-248`）。
3. 声明 `locale` 拿到宿主 `t`，并注册自有词典命名空间 `dsh-worktree-groups`
   （`src/client.tsx:229-237`、`src/client.tsx:250`）。
4. 不声明 `store`：不读原生分组/排序 store，展开态自管 `localStorage`
   （`src/client.tsx:251`）。
5. 用 `inject` 工厂把宿主客户端服务包成 `SidebarBridge`，每个服务都**惰性**读取，
   缺席时降级不抛（`src/client.tsx:122-208`、`src/client.tsx:252`）。

**核心特性**：

- **抢占式注册**：`single` 槽位按 `priority` 升序选举，首个存活的 entry 获胜；
  官方 `ui-workspace` 未声明 `priority`（等价 `0`），本插件用 `-1` 压过它
  （`src/client.tsx:96`；官方注册见
  `@deepseek-ai/dsh-client-ui-workspace/lib/client.js:2794-2803`；选举实现见
  `@deepseek-ai/dsh-client-ui-slots/lib/index.js:191-200`）。
- **唯一可靠的时序手段是 `slots.inject(key, cb)`**，不是 `dsh.client.inject`
  （后者只是预取元数据，从不决定 apply 顺序，`src/client.tsx:213-214`；
  宿主说明见 `@deepseek-ai/dsh-client-ui-workspace/lib/client.js:2704-2710`）。
- **硬依赖只有 `slots`**：`export const inject = ['slots']`，其余服务全部走
  `ctx.get()` 惰性探测，避免"可选增强"变成"启动阻塞"
  （`src/client.tsx:82-90`、`src/client.tsx:99-111`）。
- **降级不抛**：`serviceOf()` 捕获一切异常返回 `undefined`；桥接方法在服务缺席时
  要么静默 no-op、要么抛明确错误（`src/client.tsx:105-111`、`src/client.tsx:144-206`）。
- **零宿主包静态 import**：唯一的 `@deepseek-ai/*` 静态 import 是
  `import type { Context } from '@deepseek-ai/cordis'`，且是 type-only
  （`src/client.tsx:54`），编译后消失。

---

## 构造参数与依赖

### 插件导出契约

`lib/client.js` 必须导出的符号（宿主按 entry 解析）：

| 导出符号 | 行号 | 类型 | 含义 |
|---|---|---|---|
| `name` | `src/client.tsx:80` | `string`（字面量 `'dsh-worktree-groups'`） | entry 名，必须等于包名 |
| `inject` | `src/client.tsx:90` | `string[]`（`['slots']`） | cordis fiber 硬依赖服务名 |
| `apply` | `src/client.tsx:219` | `(ctx: Context) => void` | 插件装配入口 |

### 宿主注入的客户端服务

| 服务名 | 获取方式 | 硬/软 | 用途 | 缺席时行为 |
|---|---|---|---|---|
| `slots` | `slotsOf(ctx)`（`src/client.tsx:76-78`） | **硬**（在 `inject` 中） | `inject` / `register` 槽位 | 本 entry 永久 pending（宿主 `assertEntriesActive` 硬失败） |
| `locale` | `serviceOf(localeCtx, 'locale')`，**在 `ctx.inject(['locale'], …)` 回调内**（2026-09-23 修订；旧写法 `src/client.tsx:229` 的一次性探测已废弃） | 软 | `locale.register(LOCALE_NS, { zh })` 注册词典 | locale 一直缺席 ⇒ 子 fiber 永久 pending（**不影响本 entry 激活**）；注册失败 ⇒ 由 `sidebar.tsx` 的 `createSeatT` 兜底为内置中文 |
| `uiWorkspace` | `serviceOf(ctx, 'uiWorkspace')`（`src/client.tsx:124`） | 软 | `pickDirectory` / `openSession` / `startSession` / `forkSession` | 对应桥接方法降级 |
| `workspaces` | `serviceOf(ctx, 'workspaces')`（`src/client.tsx:126`） | 软 | `create` / `rename` / `delete` / `archiveSession` | 抛 `workspaces service is unavailable` |
| `sessions` | `serviceOf(ctx, 'sessions')`（`src/client.tsx:128`） | 软 | `binding` / `fork` / `open` / `create` | 部分方法静默 no-op，`renameSession` 抛错 |

> `ctx.get(name)` 语义：cordis 的 `get(name, strict = true)` 只返回**已激活**
> 提供者的实现，未提供时返回 `undefined`（`node_modules/@deepseek-ai/cordis/lib/index.js:762-771`）；
> 而**属性访问** `ctx.slots` 在未注入时会抛 `cannot get property "..." without inject`
> （同文件 `:675`）。`slotsOf` 正是基于这一点把 `ctx.slots` 收窄为结构类型
> `SlotsFace`（`src/client.tsx:59-78`）。

### 外部依赖（esbuild `external`）

`package.json:46-55` 的 `dsh.client` 声明：

```json
"client": {
  "platform": "web",
  "inject": [],
  "immediately": true,
  "external": ["react", "react/jsx-runtime", "@deepseek-ai/dsh-client-ui-primitives"]
}
```

- `platform: "web"` 必需，且 `exports["./client"]` 必须存在（`package.json:13-15`），
  否则 `dsh-client-modules` 在扫描期抛错。
- 三个 `external` 必须落在浏览器端 static seed 白名单内，且 `scripts/build-client.mjs`
  的 esbuild `external` 列表必须与之逐字一致（构建脚本 `scripts/build-client.mjs:12`）。
- `dsh.client.inject: []` 是诚实留空：它只是预取元数据，不是 apply 时序保证。
- `immediately: true` 只影响预取分层，与 apply 顺序无关。

### 源码内依赖

| 导入 | 行号 | 说明 |
|---|---|---|
| `import type { Context } from '@deepseek-ai/cordis'` | `src/client.tsx:54` | 唯一允许的宿主包静态 import（type-only） |
| `SidebarBrowser, DIRECTORY_FLOW_SLOT, LOCALE_NS, type SidebarBridge` from `./sidebar.js` | `src/client.tsx:56` | 组件 + 常量 + 桥接接口（定义见 `src/sidebar.tsx:1534`、`:130`、`:133`、`:109-121`） |
| `{ zh }` from `./locales.js` | `src/client.tsx:57` | 中文词条表（`src/locales.ts:16`） |

---

## 核心方法签名

### 导出符号

#### `apply(ctx: Context): void`

`src/client.tsx:219-257`。

- **参数** `ctx` — 客户端根 Context；`inject = ['slots']` 保证 `ctx.slots` 已可用。
- **返回值** 无。
- **副作用**：① 可能注册 locale 词典并挂载清理 effect；② 通过
  `slots.inject(SLOT_NAME, cb)` 在槽位声明就绪后调用 `slots.register(...)`
  注册本 entry（`src/client.tsx:240-256`）。
- **合法取值范围**：无额外约束；`apply` 内不做任何可能抛到宿主的操作（`locale`
  注册包 try/catch，`src/client.tsx:231-236`）。

### 内部函数

| 签名 | 行号 | 说明 |
|---|---|---|
| `slotsOf(ctx: Context): SlotsFace` | `src/client.tsx:76-78` | 把 `ctx.slots` 收窄为 `{ inject, register }` 结构类型；**不**做存在性检查（硬依赖） |
| `serviceOf(ctx: Context, name: string): any` | `src/client.tsx:105-111` | `ctx.get(name)` 的降级包装，任何异常返回 `undefined` |
| `createBridge(ctx: Context): SidebarBridge` | `src/client.tsx:122-208` | 构造桥接门面；三个取服务闭包在**调用时**才读服务 |

`SlotsFace`（`src/client.tsx:68-73`）：

```ts
interface SlotsFace {
  inject(key: string, callback: () => unknown): unknown
  register(options: Record<string, unknown>, component: unknown): unknown
}
```

### `SidebarBridge` 方法（`src/client.tsx:130-207`）

接口定义在 `src/sidebar.tsx:109-121`。

| 方法 | 行号 | 签名 | 参数合法值 | 返回值 | 副作用 / 降级 |
|---|---|---|---|---|---|
| `pickDirectory` | `131-142` | `(): Promise<string \| null>` | — | 绝对路径字符串；`null` = 用户取消 | 调 `uiWorkspace.pickDirectory()`；非字符串或抛错一律返回 `null` |
| `createWorkspace` | `144-148` | `(path: string): Promise<void>` | 目录绝对路径 | — | `workspaces.create({ path })`；服务缺席抛 `workspaces service is unavailable` |
| `renameWorkspace` | `150-154` | `(workspaceId: string, title: string): Promise<void>` | 宿主 workspace id | — | `workspaces.rename(id, title)`；服务缺席抛错 |
| `deleteWorkspace` | `156-160` | `(workspaceId: string): Promise<void>` | 宿主 workspace id | — | `workspaces.delete(id)`；服务缺席抛错 |
| `openSession` | `162-169` | `(sessionId: string): void` | 会话 id | — | 优先 `uiWorkspace.openSession(id)`；否则 `sessions.open(id)`；两者皆缺则静默 no-op |
| `startSession` | `218-237`（2026-10-22 前为 `171-179`） | `(workspaceId: string, options?: StartSessionOptions): void` | 宿主 workspace id；`options` = `{ clearPreviousDraft?: boolean }`（2026-10-22 起） | — | 优先 `uiWorkspace.startSession(workspaceId, options)`（**第二参必须原样转发**：缺省时宿主每次铸新空白会话、未发送草稿随旧 blank 会话被隐藏）；否则 `void sessions.create({ workspaceId })`（不切面板，且**不保留草稿**） |
| `renameSession` | `181-186` | `(sessionId: string, title: string): Promise<void>` | 会话 id | — | `sessions.binding(id).session.rename(title)`；`binding` 缺失抛 `unknown session "<id>"`，`result.ok === false` 抛 `result.error.message` |
| `archiveSession` | `188-192` | `(sessionId: string): Promise<void>` | 会话 id | — | `workspaces.archiveSession(id)`；服务缺席抛错 |
| `forkSession` | `194-206` | `(sessionId: string): Promise<void>` | 会话 id | — | 优先 `uiWorkspace.forkSession(id)`；否则 `sessions.fork({ sessionId, increaseTitle: true })`，若返回 `string` 再打开新会话 |

### 槽位注册选项（`src/client.tsx:241-255`）

| 字段 | 值 | 依据 |
|---|---|---|
| `name` | `'sidebar.workspaces'`（`SLOT_NAME`，`src/client.tsx:93`） | 抢占目标槽位 |
| `priority` | `-1`（`SLOT_PRIORITY`，`src/client.tsx:96`） | 小于官方 `0` ⇒ 获胜 |
| `children` | `{ 'sidebar.workspaces.worktreeDirectoryFlow': { kind: 'single', scope: 'root' } }`（`src/client.tsx:248`） | 自建键，避免同键重复声明抛错 |
| `locale` | `'dsh-worktree-groups'`（`LOCALE_NS`，`src/sidebar.tsx:133`） | 声明即拿到 `t` |
| `inject` | `() => ({ bridge })`（`src/client.tsx:252`） | 向组件注入桥接门面 |
| `store` | **不声明** | 展开态自管 `localStorage` |

---

## 执行流程

从宿主加载客户端插件到侧栏挂载：

```
宿主 dsh-client-modules / ModuleLoader
    │  加载 lib/client.js（构建产物形态见 scripts/build-client.mjs:9-19）
    ▼
window.__ModuleLoader__.load({ id: "dsh-worktree-groups", factory: require => {...} })
    │
    ▼
cordis 读取 export const inject = ['slots']            ← src/client.tsx:90
    │
    ├─ [slots 未提供] ──▶ entry 保持 pending（永不 apply）
    │
    └─ [slots 就绪]
            ▼
        apply(ctx)                                      ← src/client.tsx:219
            │
            ├─ createBridge(ctx)                        ← src/client.tsx:220 → 122
            │       └─ 只建闭包，不读服务（惰性）
            │
            ├─ ctx.inject(['locale'], cb)                ← 2026-09-23 修订（旧：src/client.tsx:229 一次性探测）
            │   ├─ [locale 迟到] ─▶ 子 fiber 挂起等待（**不阻塞本 entry**，不进 loader.entries()）
            │   └─ [locale 出现] ─▶ locale.register(LOCALE_NS, { zh })   ← 旧行号 :232
            │                  └─ 返回 disposer ─▶ localeCtx.effect(...) ← 旧行号 :233
            │
            └─ slots.inject('sidebar.workspaces', cb)   ← src/client.tsx:240
                    │
                    ├─ [槽位未声明] ──▶ 挂起等待（宿主 ui-sidebar 稍后声明）
                    │
                    └─ [槽位已声明] ──▶ cb()
                            │
                            ▼
                    slots.register({ name, priority: -1, children, locale, inject }, SidebarBrowser)
                            │                                ← src/client.tsx:241-255
                            ▼
                    SlotCore：single 槽位按 priority 选举
                            │
                            ├─ 官方 ui-workspace（priority 缺省 0）
                            └─ 本插件（priority -1）  ◀── 胜出
                            │
                            ▼
                    renderer standardKit(host, entry, ...)
                            │   ├─ entry.locale !== undefined
                            │   │      └─ host.locale 缺失 ⇒ throw SlotAssemblyError
                            │   │         （dsh-client-ui-renderer/lib/client.js:604）
                            │   └─ kit.t = localeSeat(host.locale, LOCALE_NS)   ← :605
                            │
                            ▼
                    kit → injected({ bridge }) → ownerProps({ wide, expandSidebar })
                            │   （合并顺序：kit → injected → slotInjected.props → contextual → ownerProps）
                            ▼
                    SidebarBrowser(props)                   ← src/sidebar.tsx:1534
                            │
                            └─ jsx(SidebarBoundary, { children: jsx(SidebarBrowserInner, props) })
                                    │  （错误边界，src/sidebar.tsx:1479）
                                    └─ renderSlot(DIRECTORY_FLOW_SLOT)  ← src/sidebar.tsx:2509-2517
                                            └─ 渲染自建子槽位挂载点
```

---

## 状态机

`src/client.tsx` **自身不维护任何可变状态**（无模块级可变变量、无闭包计数器）。但它的
entry 在宿主侧经历一个可核验的生命周期状态机，由 cordis fiber 与槽位 ledger 共同驱动：

```
   [未加载]
       │  ModuleLoader 执行 lib/client.js
       ▼
   [已加载 / 未激活]
       │  cordis 解析 inject = ['slots']
       ├── slots 缺席 ──▶ [pending]（永久等待，apply 不执行）
       ▼  slots 就绪
   [apply 已执行]
       │  slots.inject('sidebar.workspaces', cb)
       ├── 槽位未声明 ──▶ [waiting declaration]（挂起，可被卸载取消）
       ▼  槽位已声明
   [已注册]  ←── slots.register 成功，entry 进入 ledger
       │
       ├── 选举获胜 ──▶ [渲染中]
       ├── priority 更高者存在 ──▶ [被遮蔽]（不渲染，但仍注册）
       └── standardKit 抛 SlotAssemblyError ──▶ [abdicate 被剔除]
       ▼  fiber 卸载 / 插件 dispose
   [已释放]  ←── register 返回的 disposer 移除 entry；effect disposer 注销词典
```

**状态参考表**：

| 状态 | 含义 | 转入条件 | 转出条件 | 证据 |
|---|---|---|---|---|
| `pending` | fiber 等待硬依赖 | `inject` 中的服务未激活 | `slots` 被提供 | `src/client.tsx:90`；cordis `get` 语义 `node_modules/@deepseek-ai/cordis/lib/index.js:762-771` |
| `waiting declaration` | 已 apply，等槽位被声明 | `slots.inject` 时目标键尚无 spec | 宿主声明 `sidebar.workspaces` | `src/client.tsx:240`；`dsh-client-ui-renderer/lib/client.js:1015-1050` |
| `registered` | entry 进入 ledger | `slots.register` 返回 | disposer 被调用 | `src/client.tsx:241-255`；`dsh-client-ui-slots/lib/index.js:145-149` |
| `rendering` | 选举获胜被渲染 | `priority` 最小且未被剔除 | 更高优先级注册 / 卸载 | `dsh-client-ui-slots/lib/index.js:191-200` |
| `shadowed` | 已注册但落选 | 存在更小 `priority` 的存活 entry | 该 entry 卸载 | 同上 |
| `abdicated` | 装配期抛错被剔除 | `entry.locale` 声明但 `host.locale` 缺失 | —（不可恢复） | `dsh-client-ui-renderer/lib/client.js:604` |
| `disposed` | 已释放 | fiber 卸载 | — | `ctx.effect` 语义 `node_modules/@deepseek-ai/cordis/lib/types/fiber.d.ts:157-159` |

> 说明：以上状态是**宿主侧**状态，不是 `src/client.tsx` 的内部状态。本文件只负责在
> `apply` 时把 entry 推进到 `registered`。

---

## 并发与线程模型

- **执行环境**：浏览器主线程（渲染进程），无 Worker、无 SharedArrayBuffer、无线程池。
- **`apply` 是同步的**：`apply` 内没有 `await`，`ctx.inject(['locale'], …)`（注册子 fiber，回调稍后跑）
  与 `slots.inject` 都是同步调用（`src/client.tsx:219-257`）。
- **桥接方法是"调用时读取"而非"装配时读取"**：`uiWorkspace()` / `workspaces()` /
  `sessions()` 三个闭包每次调用都重新执行 `serviceOf`，因此插件加载顺序与服务的
  后到都不影响可用性（`src/client.tsx:113-128`）。
- **异步边界**：`pickDirectory` / `createWorkspace` / `renameWorkspace` /
  `deleteWorkspace` / `renameSession` / `archiveSession` / `forkSession` 返回
  `Promise`，宿主侧调用方（`SidebarBrowserInner` 的 actions）自行 `void`/`await`
  并把失败落到 UI 的 `loadError`（`src/sidebar.tsx:1804-1812`）。
  `openSession` / `startSession` 是同步 fire-and-forget（`startSession` 的 `options` 第二参必须原样转发，2026-10-22）。
- **清理与取消**：
  - 词典注册返回的 disposer 通过 `ctx.effect(() => dispose, 'dsh-worktree-groups: locale dictionary')`
    挂到 fiber 上，插件卸载时自动注销（`src/client.tsx:232-233`）。
  - `slots.inject` 的等待本身挂在调用者 fiber 上：插件卸载会取消待定等待并移除已生效的
    注册（`dsh-client-ui-renderer/lib/client.js:1005-1014`）。
  - `slots.register` 返回 disposer，由 `slots.inject` 的 effect 负责调用
    （`dsh-client-ui-slots/lib/index.js:145-149`）。
- **无并发竞争**：`apply` 内的两次服务读取（`locale` 经 `ctx.inject`、`slots`）互不依赖，无共享可变状态，
  因此不存在需要加锁的临界区。
  > ⚠️ **2026-09-23 修订**：entry 是**并发创建**的（`dsh-web-frontend` 的
  > `Promise.all(manifest.plugins.map(id => loader.create({ name: id })))`），而 locale 插件自己的
  > fiber 要等 `slots` + `remote` + `settingsScope` 才 apply ⇒ **本插件的 apply 可能先跑**。
  > 旧写法「一次性 `serviceOf(ctx, 'locale')` + 缺席静默跳过」在这种时序下会漏注册词典，
  > 导致侧栏满屏裸 key（用户 2026-09-23 报告的缺陷）。现改为 `ctx.inject(['locale'], cb)`：
  > 子 fiber 等 locale 出现时补跑注册，且**不进 `loader.entries()`** ⇒ 不触发 `assertEntriesActive` 白屏。
  > 证据与完整推理见 `docs/HOST-CONTRACTS.md` §B4.4 与
  > `docs/worklog/2026-09-23-sidebar-menu-raw-keys.md`。
- **React 渲染周期**：本文件不调用任何 React API；组件的 hook 顺序稳定性由
  `SidebarBrowserInner` 的 `useRef` 首渲染冻结负责（`src/sidebar.tsx:1591-1599`），
  与本文件无关。

---

## 边界条件

| 条件 | 触发点 | 行为 | 证据 |
|---|---|---|---|
| `slots` 服务缺失 | cordis 解析 `inject` | entry 永久 pending；web 启动 `assertEntriesActive` 硬失败 ⇒ 整页白屏（**刻意如此**：没有槽位服务则本插件无事可做） | `src/client.tsx:82-90` |
| `locale` 服务缺失 | `ctx.inject(['locale'], cb)` 子 fiber | 回调永不执行 ⇒ 词典不注册，**不抛、不阻塞本 entry**（子 fiber 不进 `loader.entries()`）；此时 entry 仍会因声明了 `locale` 而在 `host.locale` 缺失时被 `standardKit` 抛 `SlotAssemblyError` 剔除（abdicate），静默回落官方 `ui-workspace` | `src/client.tsx` 的 `apply` 内 `ctx.inject` 段；`dsh-client-ui-renderer/lib/client.js:604` |
| `locale` 服务**迟到**（2026-09-23 新增判据） | `ctx.inject(['locale'], cb)` 子 fiber | 服务出现时补跑注册；注册前渲染的取词由 `sidebar.tsx` 的 `createSeatT` 兜底为内置中文（**不露裸 key**） | `src/client.tsx`；`src/locales.ts` 的 `createSeatT` |
| `locale.register` 抛错（同 ns + 同 locale 重复注册） | `ctx.inject` 回调 | 被 try/catch 捕获并 `console.warn`，不影响其它装配 | `src/client.tsx:231-236`；抛错点 `dsh-client-locale/lib/client.js:1264` |
| `locale.register` 不返回函数 | `apply` | 不挂 effect（`typeof dispose === 'function'` 守卫），词典无法注销 | `src/client.tsx:233` |
| 子槽位键与官方同键 | `slots.register` | 若误用 `sidebar.workspaces.directoryFlow` 会抛 `slot "..." is already declared`；本文件用自建键 `worktreeDirectoryFlow` 规避 | `src/client.tsx:246-248`；`dsh-client-ui-slots/lib/index.js:100-103` |
| 槽位 `sidebar.workspaces` 永不被声明 | `slots.inject` | 回调永不执行，不注册、不报错（挂起等待） | `src/client.tsx:240` |
| 重复挂载（同一 entry 被 apply 两次） | `slots.inject` + `register` | 第二次 `register` 会因 `single` 槽位已有同优先级注册而抛 `single slot "sidebar.workspaces" already has a registration` | `dsh-client-ui-slots/lib/index.js:79-81` |
| 插件卸载 | fiber dispose | `slots.inject` 取消等待/移除注册；`ctx.effect` 注销词典 | `src/client.tsx:233`；`dsh-client-ui-renderer/lib/client.js:1005-1014` |
| `uiWorkspace` 服务缺失 | `pickDirectory` | 返回 `null`（等同用户取消），不抛 | `src/client.tsx:135-141` |
| `uiWorkspace.pickDirectory` 缺席或抛错 | `pickDirectory` | 返回 `null`（"目录选择器不可用"与"用户取消"不可区分） | `src/client.tsx:136-141` |
| `uiWorkspace.pickDirectory` 返回非字符串 | `pickDirectory` | `typeof picked === 'string'` 守卫 ⇒ 返回 `null` | `src/client.tsx:137` |
| `workspaces` 服务缺失 | `createWorkspace` / `renameWorkspace` / `deleteWorkspace` / `archiveSession` | 抛 `Error('workspaces service is unavailable')`，由调用方捕获落到 UI 错误行 | `src/client.tsx:144-160`、`:188-192` |
| `uiWorkspace.openSession` 缺失 | `openSession` | 降级到 `sessions.open(id)`；`sessions` 也缺失则**静默 no-op** | `src/client.tsx:162-169` |
| `uiWorkspace.startSession` 缺失 | `startSession` | 降级到 `void sessions.create({ workspaceId })`（不切面板，**不保留草稿**）；`sessions` 缺失则静默 no-op | `src/client.tsx:218-237` |
| `sessions.binding(id)` 返回 `undefined` | `renameSession` | 抛 `Error('unknown session "<id>"')` | `src/client.tsx:182-183` |
| `session.rename` 返回 `{ ok: false }` | `renameSession` | 抛 `Error(result.error.message ?? 'rename rejected')` | `src/client.tsx:185` |
| `uiWorkspace.forkSession` 缺失 | `forkSession` | 降级到 `sessions.fork({ sessionId, increaseTitle: true })`；返回非 `string` 则不打开新会话 | `src/client.tsx:194-205` |
| 任何 `ctx.get()` 抛异常 | `serviceOf` | 捕获并返回 `undefined`（对应服务视为缺席） | `src/client.tsx:105-111` |
| 宿主 HTTP 请求失败 | 不在本文件 | 由组件侧错误边界与 `loadError` 处理 | `src/sidebar.tsx:1479-1500`、`:1804-1812` |

---

## 代码示例

### 宿主侧的加载形态（构建产物契约）

`scripts/build-client.mjs:9-19` 生成的 `lib/client.js` 形态：

```js
window.__ModuleLoader__.load({id:"dsh-worktree-groups",factory:(require)=>{var module={exports:{}};var exports=module.exports;/* ...bundle... */;return module.exports;}});
```

`id` 必须等于包名，因为 boot graph 的 entry name 就是包名。

### 导出契约（本文件真实导出）

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'dsh-worktree-groups'   // src/client.tsx:80
export const inject = ['slots']             // src/client.tsx:90
export function apply(ctx: Context): void   // src/client.tsx:219
```

### 组件侧如何消费桥接（真实调用方式）

`SidebarBrowserInner` 从 props 取出 `bridge`，再经内部 `actions` 调用
（`src/sidebar.tsx:1577`、`:1804-1812`）：

```ts
const bridge = props.bridge as SidebarBridge | undefined
// 「添加工作区…」：pickDirectory 返回 null 即视为取消
const path = await bridge?.pickDirectory()
if (typeof path === 'string') await bridge.createWorkspace(path)
```

### 槽位注册的真实写法（本文件核心）

```ts
const slots = slotsOf(ctx)                       // src/client.tsx:239
slots.inject(SLOT_NAME, () =>                    // 'sidebar.workspaces'
  slots.register(
    {
      name: SLOT_NAME,
      priority: SLOT_PRIORITY,                   // -1，压过官方 ui-workspace 的 0
      children: { [DIRECTORY_FLOW_SLOT]: { kind: 'single', scope: 'root' } },
      locale: LOCALE_NS,                         // 'dsh-worktree-groups'
      inject: () => ({ bridge }),
    },
    SidebarBrowser as any,
  ),
)
```

### 本地最小驱动（仅用于理解时序，非仓库内既有代码）

```ts
// 语义等价的最小宿主桩：先提供 slots，再声明目标槽位
const registered: unknown[] = []
const ctx = {
  get: (name: string) => (name === 'locale' ? { register: () => () => {} } : undefined),
  effect: () => () => {},
  slots: {
    inject: (key: string, cb: () => unknown) => { if (key === 'sidebar.workspaces') cb() },
    register: (options: Record<string, unknown>) => { registered.push(options) },
  },
} as unknown as Context

apply(ctx)
// ⇒ registered[0].priority === -1，registered[0].children 只含
//    'sidebar.workspaces.worktreeDirectoryFlow'
```

---

## 已知缺陷与注意事项

1. **`entry.locale` 是"声明即无退路"**（文件头 `src/client.tsx:22-51` 的重点）：
   `apply` 里的 `ctx.inject(['locale'], …)` **只用于注册词典**，取 `t` 的路径是
   renderer 的 `standardKit`（`dsh-client-ui-renderer/lib/client.js:602-605`）。
   因此"探测不到 locale ⇒ 有退路"是**错误推断**：locale 缺席时组件根本不会被渲染，
   `src/sidebar.tsx:136` 的 `FALLBACK_T` 只在"组件被渲染但 props 没有 `t`"时生效。
   当前组合安全（`dsh-web-app` 的 `cordis.patch.yml` 挂载了 `locale`）；若要在无 locale
   组合下工作，唯一办法是**去掉 `entry.locale` 声明**，改用 `ctx.get('locale').bind(LOCALE_NS)`
   并失去语言切换的自动重渲染。

   > ⚠️ **2026-09-23 补充（本条第 1 点的真实后果）**：seat 存在 ≠ 词典已注册。locale 服务
   > **迟到**时，entry 照常渲染、`kit.t` 照常存在，但命名空间是空的 ⇒ 宿主 `translate`
   > 返回 key 本身 ⇒ 侧栏满屏裸 key。两层修复：`apply` 改用 `ctx.inject(['locale'], …)`
   > 等注册（`src/client.tsx`），取词入口改用 `createSeatT` 兜底（`src/sidebar.tsx` 的
   > `SidebarBrowserInner`，`src/locales.ts` 的 `createSeatT`）。
   > 回归保护：`test/sidebar-wiring.test.mjs` 的 `T16/取词`（4 条）+ `test/locales.test.mjs`（8 条）。

2. **`inject` 数组只能放 `slots`**：把 `locale` / `workspaces` / `sessions` /
   `uiWorkspace` 写进 `inject` 会把"可选增强"变成"启动阻塞"，而 web 启动对未激活
   entry 是硬失败（`assertEntriesActive`）⇒ 整页白屏（`src/client.tsx:82-90`）。

3. **`pickDirectory()` 在 `uiWorkspace` 上，不在 `ctx.workspaces` 上**：契约 §2.7 裁定 5
   指出参考插件 `REF/src/client.tsx:2072` 写错了，不要照抄
   （`src/client.tsx:132-134`）。

4. **`pickDirectory` 吞掉了"不可用"与"用户取消"的区别**：两者都返回 `null`，
   调用方无法区分（`src/client.tsx:136-141`）。当前 UI 把 `null` 统一当作取消处理。

5. **`startSession` / `openSession` 的降级是 fire-and-forget**：`void sessions()?.create?.(...)`
   的失败不会冒泡到 UI（`src/client.tsx:177-178`）；只有 `createWorkspace` 等显式
   `await` 的路径才会把错误落到 `loadError`。

6. **`SidebarBrowser as any` 的类型逃逸**：注册时组件被断言为 `any`
   （`src/client.tsx:254`），因为宿主 slot 的组件类型不在本包依赖树内。
   代价是组件签名写错不会在 `tsc` 阶段被发现。

7. **`SlotsFace` 是手工结构类型，不是宿主真实类型**：`ctx.slots` 的完整能力
   （如 `provideRoot` / `renderSlot` / `installLocale`）在本文件被收窄成两个方法
   （`src/client.tsx:59-73`）。方法名写错会编译报错，但**多余/缺失能力不会被类型系统发现**。

8. **未确认项**：`slots.register` 在 `single` 槽位重复注册时抛错的具体分支
   （`dsh-client-ui-slots/lib/index.js:79-81`）是宿主实现，本包**没有**针对该路径的测试
   覆盖；"重复 apply 一定抛错"这一结论来自宿主源码阅读，**未经本包测试验证**。

---

## 相关文档

- [WebClient 模块技术文档](../l2-modules/WebClient模块技术文档.md) —— 客户端半边所属模块的组件目录
- [Sidebar 技术文档](../l3-components/Sidebar技术文档.md) —— `SidebarBrowser` 组件实现（本文件注册的组件）
- [Locales 技术文档](../l3-components/Locales技术文档.md) —— `zh` 词条表与 `createT`（本文件注册的词典）
- [worktree-groups 知识库](../l1-architecture/worktree-groups-knowledge-base.md) —— 域级架构与跨模块流程
- `docs/INTERFACES.md` §2.4 / §2.5 / §2.7 —— 客户端入口契约与主代理裁定
- `docs/HOST-CONTRACTS.md` §B1 / §B2 / §B4 / §B6 —— 宿主槽位、子槽位路线、客户端服务、bundle 形态
