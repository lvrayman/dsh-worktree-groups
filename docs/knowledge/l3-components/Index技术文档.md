---
生成时间: 2026-09-22
更新时间: 2026-09-22
git-version: 9bd94252dd934c2fa8491977285e461b703f0f3e
git-module-path: src
level: L3
---

# dsh-worktree-groups 宿主入口（`apply` / `name` / `inject`）

> **文件路径**: `src/index.ts`

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

## 概述

`src/index.ts` 是 `dsh-worktree-groups` 的**宿主半边（server-side）入口**，也是全包 50 行、唯一被 Cordis 宿主按包名加载的装配点。它本身不含任何业务逻辑，只做三件事：声明插件标识、声明硬依赖、把装配工作转交给 `registerRoutes`（`src/index.ts:37-49`）。

核心特性：

1. **纯声明式装配**：只导出 `name` / `inject` / `apply` 三个符号（`src/index.ts:24`、`src/index.ts:34`、`src/index.ts:37`），业务实现全部位于 `routes.ts` / `git.ts` / `projects.ts` / `ledger.ts`（`src/index.ts:36` 注释）。
2. **type-only 依赖姿态**：全文件唯一的 `@deepseek-ai/*` 静态 import 是 `import type { Context } from '@deepseek-ai/cordis'`（`src/index.ts:20`），编译后消失，从而避免运行时加载第二份 `cordis` 导致 `Service` 基类身份分裂（`src/index.ts:6-11`，佐证见 `docs/HOST-CONTRACTS.md` §C14.4）。
3. **最小硬依赖 + 软依赖惰性读取**：`inject` 只声明 `webServer`（`src/index.ts:34`）；`workspaceRegistry` / `sessionPersistence` / `sessionController` / `sessions` 均为软依赖，由 `routes.ts` 经 `ctx.get()` 惰性获取（`src/index.ts:29-32`）。
4. **缺失即降级，绝不崩**：`webServer` 缺席时 `apply` 不抛错、什么都不注册（PRD R6，`src/index.ts:15-17`）；路由注册失败时只记一条 warn 后继续，不让插件行加载失败（`src/index.ts:40-48`）。
5. **卸载可撤销**：路由注册被 `ctx.effect` 包裹（`src/routes.ts:1372-1388`），插件卸载时宿主自动回收全部路由。

## 构造参数与依赖

### 插件导出契约（Cordis 消费面）

| 导出符号 | 位置 | 类型 | 作用 |
|---|---|---|---|
| `name` | `src/index.ts:24` | `string`（`'dsh-worktree-groups'`） | 插件标识，必须与 `cordis.patch.yml` 的 `insert.id` / `insert.name` 一致 |
| `inject` | `src/index.ts:34` | `string[]`（`['webServer']`） | 硬依赖声明；Cordis 等到 `webServer` 就绪后才调用 `apply` |
| `apply` | `src/index.ts:37` | `(ctx: Context) => void` | 装配入口，同步返回，内部转交 `registerRoutes` |

### 宿主注入的服务

| 服务名 | 获取方式 | 依赖等级 | 缺失行为 | 来源位置 |
|---|---|---|---|---|
| `webServer` | `ctx.get('webServer')` | 硬（写在 `inject`） | `apply` 不执行注册；`registerRoutes` 静默 return | `src/index.ts:34`、`src/routes.ts:1365-1369` |
| `workspaceRegistry` | `ctx.get('workspaceRegistry')` | 软 | 返回空树 / 无工作区，不抛错 | `src/routes.ts:477`、`src/routes.ts:799`、`src/routes.ts:1420` 等 |
| `sessionPersistence` | `ctx.get('sessionPersistence')` | 软 | 无全量历史，仅实时摘要 | `src/routes.ts:57` 注释、`docs/HOST-CONTRACTS.md` §A4 |
| `sessionController` | `ctx.get('sessionController')` | 软 | 无 running/blank/updatedAt 实时字段 | `src/routes.ts:57` 注释 |
| `sessions` | `ctx.get('sessions')` | 软 | 无进程内实例快照 | `src/index.ts:30-31` |

服务统一经 `getService<T>()` 获取，该函数把 `ctx.get` 自身可能抛出的 Cordis 诊断错误吞掉并返回 `undefined`（`src/routes.ts:162-172`）。

### 被谁加载

- `package.json:42-45` 声明 `dsh.bundle.patch = "./cordis.patch.yml"`，由 DSH profile 的 bundle 层解析。
- `cordis.patch.yml:15-17` 以 `insert` 形式插入插件行 `id: dsh-worktree-groups` / `name: dsh-worktree-groups`，与 `src/index.ts:24` 的 `name` 对应。
- 包入口为 `lib/index.js`（`package.json:6`），`exports["."]` 同时给出 `types` / `default`（`package.json:8-12`）。
- `@deepseek-ai/cordis` 只声明在 `peerDependencies` 与 `devDependencies`（`package.json:57-59`、`package.json:61-62`），`dependencies` 为空（`package.json:60`），符合 C14.4 的实例唯一性要求。

## 核心方法签名

### `apply(ctx: Context): void`（`src/index.ts:37`）

```ts
export function apply(ctx: Context): void
```

| 项 | 说明 |
|---|---|
| 参数 `ctx` | Cordis 的 `Context` 实例，由宿主在 `inject` 满足后注入；文件内仅作为不透明句柄透传给 `registerRoutes`（`src/index.ts:39`） |
| 合法取值范围 | 无自定义校验；`ctx` 只需提供 `get`（服务获取）与 `effect` / `logger`（下游使用）。`ctx.logger` 为可选链访问，缺失不报错（`src/index.ts:45`） |
| 返回值 | `void`（同步） |
| 副作用 | 注册 5 条 HTTP 路由（经 `registerRoutes`，`src/routes.ts:1391` 起）；注册过程通过 `ctx.effect` 挂载 disposer；失败时写一条 warn 日志 |
| 抛错契约 | **自身永不抛错**：`registerRoutes` 的异常被 `try/catch` 吞掉（`src/index.ts:38-48`）；日志写入失败也被内层 `try/catch` 静默（`src/index.ts:44-48`） |

### `registerRoutes(ctx: Context): void`（`src/routes.ts:1364`，下游被调用方）

```ts
export function registerRoutes(ctx: Context): void
```

| 项 | 说明 |
|---|---|
| 参数 `ctx` | 同 `apply`；服务全部经 `getService(ctx, name)` 惰性读取 |
| 返回值 | `void` |
| 副作用 | 经 `webServer.register({ kind: 'exact', path, handler })` 注册 5 条精确路由（`src/routes.ts:1374-1385`），路径表见 `ROUTE_PATHS`（`src/routes.ts:43-49`） |
| 抛错契约 | **会如实上抛**（如 `webServer.register` 抛「duplicate route」）；由 `apply` 兜住。测试 `test/routes.test.mjs:1899-1908` 明确断言了这一分工 |
| 降级 | `webServer` 缺失或 `register` 非函数时直接 `return`，不注册任何 `ctx.effect`（`src/routes.ts:1365-1369`） |

### 常量符号

| 符号 | 位置 | 值 / 类型 | 说明 |
|---|---|---|---|
| `name` | `src/index.ts:24` | `'dsh-worktree-groups'` | 插件名 |
| `inject` | `src/index.ts:34` | `['webServer']` | 硬依赖数组 |
| `ROUTE_PATHS` | `src/routes.ts:43-49` | `{ tree, worktreeCreate, worktreeRemove, reveal, workspaceOpen }` | 统一前缀 `/dsh-worktree-groups` |
| `SCAN_CACHE_TTL_MS` | `src/routes.ts:52` | `30_000` | git 扫描缓存 TTL（PRD D13） |

## 执行流程

```text
        DSH Desktop / profile 启动
                  |
                  v
  +-----------------------------------+
  | 解析 dsh.profile.bundles           |
  |   -> package.json dsh.bundle.patch |
  |   -> cordis.patch.yml:15-17 insert |
  +-----------------------------------+
                  |
                  v
  +-----------------------------------+
  | Cordis 装载插件行                  |
  |   id/name = dsh-worktree-groups    |
  |   入口 = lib/index.js              |
  +-----------------------------------+
                  |
                  v
  +-----------------------------------+
  | 解析 inject = ['webServer']        |  (src/index.ts:34)
  |   未就绪 -> 插件行 pending，等待    |
  +-----------------------------------+
                  |
        webServer 就绪
                  |
                  v
  +-----------------------------------+
  | apply(ctx)                         |  (src/index.ts:37)
  +-----------------------------------+
                  |
                  v
  +-----------------------------------+
  | registerRoutes(ctx)                |  (src/routes.ts:1364)
  +-----------------------------------+
                  |
        +---------+---------+
        |                   |
   webServer 缺席      webServer 就绪
        |                   |
        v                   v
  +-----------+   +------------------------------------+
  | 静默 return|   | ctx.effect(() =>                   |
  | 不注册任何 |   |   webServer.register({             |
  | effect    |   |     kind:'exact', path, handler }))|  x5
  +-----------+   |   label: 'dsh-worktree-groups: ...' |
                  +------------------------------------+
                            |
                 +----------+----------+
                 |                     |
            注册成功               注册抛错
                 |                     |
                 v                     v
        +----------------+   +--------------------------+
        | 5 条路由就绪    |   | 异常冒泡到 apply 的      |
        | /tree 等可访问  |   | try/catch -> logger.warn |
        +----------------+   +--------------------------+
                 |                     |
                 +----------+----------+
                            |
                            v
                  +---------------------------+
                  | 插件行装载完成（就绪）     |
                  | 客户端侧通过 HTTP 消费     |
                  +---------------------------+
```

要点：`apply` 是**同步**函数，路由注册在宿主调用栈内完成；`ctx.effect` 只是把 disposer 登记到 Cordis 的生命周期，不改变同步语义（`src/routes.ts:1372-1388`）。

## 状态机

`src/index.ts` 自身不维护任何显式状态变量；它的「状态」完全由 Cordis 插件行的生命周期决定。因此下图为**插件行生命周期状态机**（隐含状态，非本文件的变量）。

```text
                    bundle 被 profile 解析
   [未加载]  ------------------------------>  [等待依赖]
      ^                                            |
      |                                            | inject 中 webServer 未就绪
      |                                            | （保持 pending，不调用 apply）
      |                                            |
      |                          webServer 就绪      |
      |                                            v
      |                                       [装配中 apply]
      |                                       /            \
      |                    注册成功            /              \  注册抛错
      |                                     v                v
      |                              [已就绪 running]   [降级运行 degraded]
      |                                     |                |
      |                                     |                | 无路由，仅 warn
      |              Cordis dispose / 插件卸载 |                |
      +-------------------------------------+----------------+
                     ctx.effect 回收 5 条路由
```

### 状态参考表

| 状态 | 含义 | 转入条件 | 转出条件 |
|---|---|---|---|
| 未加载 | 插件行尚未被 bundle/profile 解析 | 初始态 | `package.json:42-45` 的 `dsh.bundle.patch` 被解析并插入 `cordis.patch.yml:15-17` 的插件行 |
| 等待依赖 | Cordis 已装载插件行，但 `inject` 未满足，`apply` 未被调用 | `inject = ['webServer']`（`src/index.ts:34`）中的 `webServer` 尚未就绪 | `webServer` 服务就绪，Cordis 调用 `apply` |
| 装配中 | `apply(ctx)` 正在执行，`registerRoutes` 尚未返回 | Cordis 调用 `apply`（`src/index.ts:37`） | `registerRoutes` 正常返回或抛错 |
| 已就绪（running） | 5 条路由已注册，`ctx.effect` 已登记 disposer | `registerRoutes` 正常返回（`src/routes.ts:1364`） | 插件卸载 / `ctx.effect` 被 dispose，回收全部路由 |
| 降级运行（degraded） | 插件行加载成功但未注册任何路由 | `webServer` 缺失（`src/routes.ts:1366-1369` 静默 return）**或**注册抛错被 `apply` 捕获（`src/index.ts:40-48`） | 插件卸载；无路由可回收。**该状态不会自动恢复**（见「已知缺陷」） |

> 说明：`webServer` 缺席时 `apply` 仍会被调用（因为 `inject` 只保证「就绪后调用」，不保证「缺席时不调用」——宿主在依赖缺失时也可能直接以缺失态调用；实测 `test/routes.test.mjs:1574-1583` 断言 `apply` 在 `webServer` 缺席时不抛错）。因此「等待依赖」与「降级运行」是两条独立路径。

## 并发与线程模型

| 维度 | 事实 | 依据 |
|---|---|---|
| 装配阶段 | **同步**：`apply` 返回 `void`，`registerRoutes` 也是同步函数，路由注册在宿主调用栈内一次完成 | `src/index.ts:37`、`src/routes.ts:1364` |
| 装配并发 | 无并发保护；Cordis 对同一插件行只调用一次 `apply`，`src/index.ts` 不做幂等判断（重复 `apply` 会重复注册，第二次由 `webServer.register` 的 duplicate 检查抛错） | `src/index.ts:37-49`、`docs/HOST-CONTRACTS.md` §A3.1 |
| 运行期并发 | 本文件无运行期逻辑；并发压力全部落在 `routes.ts` 的 handler（Node 单线程事件循环 + 异步 IO）。`routes.ts` 内的模块级扫描缓存 `SCAN_CACHE_TTL_MS`（`src/routes.ts:52`）是跨请求共享的可变状态 | `src/routes.ts:52`、`src/routes.ts:178-196` |
| 取消 / 卸载 | 每条路由经 `ctx.effect(() => webServer.register(...) ?? (() => undefined), label)` 注册（`src/routes.ts:1372-1388`），Cordis dispose 插件时调用 `webServer.register` 返回的 disposer，从路由表中删除该路径；`test/routes.test.mjs:1885-1890` 断言 5 个 disposer 调用后路由归零 | `src/routes.ts:1372-1388`、`docs/HOST-CONTRACTS.md` §A3.1 |
| 卸载时的异常 | `apply` 自身的 `try/catch` 只覆盖注册阶段；卸载阶段的 disposer 由 Cordis 直接调用，本文件不介入 | `src/index.ts:38-48` |

## 边界条件

| 场景 | 触发条件 | 实际行为 | 依据位置 |
|---|---|---|---|
| 宿主服务缺失：`webServer` | `ctx.get('webServer')` 返回 `undefined` 或 `register` 非函数 | `registerRoutes` 静默 `return`，不注册任何 `ctx.effect`；`apply` 不抛错（PRD R6） | `src/routes.ts:1365-1369`；测试 `test/routes.test.mjs:1574-1583` |
| 宿主服务缺失：`ctx.get` 本身抛错 | Cordis 抛诊断错误 | `getService` 的 `try/catch` 吞掉并返回 `undefined`，等价于服务缺失 | `src/routes.ts:162-172`；测试 `test/routes.test.mjs:1585-1597` |
| 宿主服务缺失：软依赖 | `workspaceRegistry` / `sessionPersistence` / `sessionController` / `sessions` 任一缺席 | 不抛错，降级为空树 / 空会话行；仍返回 `ok: true` | `src/index.ts:29-32`、`src/routes.ts:57` 注释；测试 `test/routes.test.mjs:1599` 起 |
| 重复加载 / 重复 `apply` | 同一 `ctx` 上再次调用 `apply`，或同名路由已被别的插件占用 | `webServer.register` 抛 `duplicate exact route`；`registerRoutes` 如实上抛，`apply` 捕获后 `logger.warn` 并继续，插件行不失败 | `docs/HOST-CONTRACTS.md` §A3.1；`src/index.ts:40-48`；测试 `test/routes.test.mjs:1899-1908` |
| 装配失败：`ctx.logger` 不可用 | `ctx.logger` 为 `undefined` 或 `warn` 非函数或 `warn` 本身抛错 | 可选链 + 内层 `try/catch` 双重保护，静默继续，绝不因日志而崩 | `src/index.ts:44-48` |
| 卸载 | 插件被 Cordis dispose | `ctx.effect` 登记的 disposer 被调用，5 条路由从路由表移除 | `src/routes.ts:1372-1388`；测试 `test/routes.test.mjs:1885-1890` |
| handler 运行期抛错 | 任一路由 handler 内部异常 | 该异常**不经过本文件**：`routes.ts` 的包装器把异常收敛成 HTTP 400 JSON；若响应头已发送则 `res.end()` | `src/routes.ts:1377-1385` |
| 非 web profile | profile 无 `webServer`（如纯 CLI profile） | 与「`webServer` 缺失」同路径：插件行加载成功、零路由、零副作用 | `src/index.ts:15-17`、`src/routes.ts:1366-1369` |
| 运行时加载到第二份 `cordis` | 插件自带 `node_modules` 命中 `@deepseek-ai/cordis` | 本文件因 **type-only import** 不引入该风险；`lib/index.js` 中无任何 `@deepseek-ai/*` 运行时 import | `src/index.ts:20`、`docs/HOST-CONTRACTS.md` §C14.4 |

## 代码示例

以下示例使用真实导出名与真实装配方式。

### 1. 宿主侧最小装配（与 Cordis 契约一致）

```ts
import type { Context } from '@deepseek-ai/cordis'
import { apply, inject, name } from 'dsh-worktree-groups'

// name === 'dsh-worktree-groups'   (src/index.ts:24)
// inject === ['webServer']          (src/index.ts:34)
declare const ctx: Context
apply(ctx)                            // 同步注册 5 条 /dsh-worktree-groups/* 路由
```

### 2. bundle 层声明（`cordis.patch.yml`，真实内容）

```yaml
# cordis.patch.yml:15-17
- insert:
    - id: dsh-worktree-groups
      name: dsh-worktree-groups
```

配合 `package.json:42-45`：

```json
"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
```

### 3. 直接调用下游注册函数（测试 / 嵌入式用法）

```ts
import type { Context } from '@deepseek-ai/cordis'
import { registerRoutes, ROUTE_PATHS } from './routes.js'

declare const ctx: Context
registerRoutes(ctx)                   // 会如实上抛注册错误；需要兜底时用 apply
// ROUTE_PATHS.tree === '/dsh-worktree-groups/tree'   (src/routes.ts:43-49)
```

### 4. 复刻 `apply` 的降级语义（宿主服务全缺失）

```ts
const ctxWithoutWebServer = {
  get: () => undefined,
  effect: () => { throw new Error('不应被调用') },
} as unknown as Context

apply(ctxWithoutWebServer)            // 不抛错、不注册（src/index.ts:38-48 + src/routes.ts:1366-1369）
```

## 已知缺陷与注意事项

1. **降级状态不可自动恢复**：若 `webServer` 在 `apply` 调用之后才注册，本插件不会重试，路由永久缺失。`inject` 只能保证「就绪后调用」，无法覆盖「已调用后服务才出现」的时序。依据：`src/index.ts:34`、`src/routes.ts:1366-1369`。当前实现对 DSH 的启动顺序是安全的（profile 先装 host 服务再装插件），但**未确认**是否存在宿主热重载导致 `webServer` 后置的场景。
2. **`apply` 非幂等**：同一 `ctx` 上重复 `apply` 会走到 `webServer.register` 的 duplicate 检查并抛错，最终被吞成一条 warn，表现为「第二次 `apply` 静默无效」。依据：`src/index.ts:37-49`、`docs/HOST-CONTRACTS.md` §A3.1。
3. **注册失败只留日志、不留可观测状态**：`apply` 捕获异常后仅 `logger.warn`，没有计数器或可查询标志；运维侧只能从日志或「`/tree` 返回 404」推断。依据：`src/index.ts:40-48`。
4. **`inject` 与 `routes.ts` 的 `ctx.get` 姿态必须保持一致**：若未来把 `workspaceRegistry` 等软依赖写进 `inject`，插件会在这些服务缺席时永久 pending，破坏「缺失即降级」；反之若把 `webServer` 从 `inject` 移除，则失去「就绪后注册」的保证。依据：`src/index.ts:26-34` 注释。
5. **禁止在本文件新增 `@deepseek-ai/*` 运行时 import**：唯一允许的是 `import type`。一旦出现 `import { Service } from '@deepseek-ai/cordis'` 之类的运行时导入，且插件自带 `node_modules` 命中该包，就会造成 `Service` 基类身份分裂、服务注册失效。依据：`src/index.ts:6-11`、`docs/HOST-CONTRACTS.md` §C14.4。
6. **`ctx.logger?.warn?.()` 的可用性未强约束**：本文件按可选链处理，未确认 DSH 各 profile 下 `ctx.logger` 是否恒存在；缺失时注册失败将完全静默。依据：`src/index.ts:45`。
7. **文件头注释中的行号锚点会随重构漂移**：`src/index.ts:36` 注释引用的 `routes.ts` / `git.ts` / `projects.ts` / `ledger.ts` 为模块名而非行号，本身稳定；但本知识库文档中的行号锚定 `git-version: 9bd9425`，代码变更后需按 frontmatter 重新锚定。

## 相关文档

- [ServerHost 模块技术文档](../l2-modules/ServerHost模块技术文档.md)
- [Routes 技术文档](../l3-components/Routes技术文档.md)
- [Projects 技术文档](../l3-components/Projects技术文档.md)
- [Ledger 技术文档](../l3-components/Ledger技术文档.md)
- [worktree-groups 知识库总览](../l1-architecture/worktree-groups-knowledge-base.md)
