---
生成时间: 2026-09-22
更新时间: 2026-09-22
git-version: 9bd94252dd934c2fa8491977285e461b703f0f3e
git-module-path: src
level: L3
---

# Ledger 数据模型与接口

> **文件路径**: `src/ledger.ts`　|　**上级概览**: [Ledger技术文档.md](./Ledger技术文档.md)　|　**姊妹篇**: [Ledger-持久化与并发技术文档.md](./Ledger-持久化与并发技术文档.md)

本子文档是 `src/ledger.ts`（292 行，`git-version` 9bd9425）的 **L3 地面细节层**文档，覆盖导出符号、数据结构、磁盘格式与方法签名。L3 是最底层，签名与持久化格式均写在本层，不再下钻。

## 目录

- [1. 导出符号清单](#1-导出符号清单)
- [2. 数据结构与磁盘格式](#2-数据结构与磁盘格式)
- [3. 运行时依赖](#3-运行时依赖)
- [4. 被谁装配](#4-被谁装配)
- [5. 核心方法签名](#5-核心方法签名)
- [6. 代码示例](#6-代码示例)

## 1. 导出符号清单

| 符号 | 类型 | 位置 | 说明 |
|---|---|---|---|
| `LedgerWorktree` | `interface` | `src/ledger.ts:40-49` | 一个 worktree 的台账记录 |
| `LedgerProject` | `interface` | `src/ledger.ts:52-57` | 一个项目（git common dir）的台账记录 |
| `LedgerSessionOwner` | `interface` | `src/ledger.ts:60-65` | 一条会话归属快照 |
| `LedgerData` | `interface` | `src/ledger.ts:68-73` | 台账全量数据（文件顶层结构） |
| `LedgerStore` | `interface` | `src/ledger.ts:76-92` | 台账存储：读写 + 串行化读-改-写 |
| `emptyLedger` | `function` | `src/ledger.ts:99-101` | 构造一份空台账 |
| `createFileLedger` | `function` | `src/ledger.ts:153-292` | 创建文件介质台账 |

模块级非导出常量：`LEDGER_VERSION = 1`（`src/ledger.ts:25`）、`LEDGER_FILE_NAME = 'worktree-groups.json'`（`src/ledger.ts:28`）、`DSH_HOME_PATHS_MODULE = '@deepseek-ai/dsh-home-paths'`（`src/ledger.ts:37`）。

模块级非导出函数：`resolveDefaultHome()`（`src/ledger.ts:109-124`）、`isPlainObject()`（`src/ledger.ts:127-129`）、`isLedgerShape()`（`src/ledger.ts:135-139`）。

## 2. 数据结构与磁盘格式

**介质**：`<homeDir>/worktree-groups.json`，文件名取自常量 `LEDGER_FILE_NAME`（`src/ledger.ts:28`）。落盘文本为 `JSON.stringify(data, null, 2) + "\n"`（`src/ledger.ts:239`），即 **2 空格缩进 + 尾换行**，由 `test/ledger.test.mjs:283-290` 逐字校验。

```ts
// src/ledger.ts:68-73
export interface LedgerData {
  version: 1
  projects: Record<string, LedgerProject>      // 键 = git commonDir（原值，不归一化）
  sessions: Record<string, LedgerSessionOwner> // 键 = sessionId
}
```

```ts
// src/ledger.ts:52-57
export interface LedgerProject {
  mainPath: string                          // 主工作树路径（便于 commonDir 变化时兜底）
  worktrees: Record<string, LedgerWorktree> // 键 = worktree 路径（归一化）
}
```

```ts
// src/ledger.ts:40-49
export interface LedgerWorktree {
  branch?: string      // 最近一次见到的检出分支短名；detached 或未知时 undefined
  firstSeenAt: number  // 首次见到该 worktree 的时刻（epoch ms）
  lastSeenAt: number   // 最近一次被 git 列表看到的时刻（epoch ms）
  goneAt?: number      // 首次被发现已消失的时刻（epoch ms，>= lastSeenAt）
}
```

```ts
// src/ledger.ts:60-65
export interface LedgerSessionOwner {
  projectKey: string    // 项目键（commonDir）
  worktreePath: string  // 会话所属 worktree 路径（归一化）
}
```

**键的归一化责任在调用方**：`ledger.ts` 自身不做任何路径归一化，只按调用方给的键存取。`src/routes.ts:940` 与 `:966` 在写入前调用 `normalizePath(...)`，`src/routes.ts:986` 写入 `node.path`。`projects` 的键保持 `commonDir` 原值（`test/ledger.test.mjs:81-85` 断言）。

**版本门禁**：`version` 是字面量类型 `1`（`src/ledger.ts:69`）；`isLedgerShape()` 要求 `value['version'] === LEDGER_VERSION` 且 `projects` / `sessions` 都是普通对象（非 `null`、非数组），否则整份文件被当作损坏（`src/ledger.ts:135-139`）。

## 3. 运行时依赖

| 依赖 | 来源 | 用途 |
|---|---|---|
| `access, mkdir, open, readFile, rename, unlink` | `node:fs/promises`（`src/ledger.ts:20`） | 全部磁盘操作 |
| `homedir` | `node:os`（`src/ledger.ts:21`） | 回退 home `~/.dsh`（`src/ledger.ts:123`） |
| `dirname, join` | `node:path`（`src/ledger.ts:22`） | 拼路径、取目录 |
| `@deepseek-ai/dsh-home-paths` | **惰性动态 import**（`src/ledger.ts:37`、`:111-112`） | 解析 `defaultDshHome()` |
| `process.env['DSH_HOME']` | 进程环境（`src/ledger.ts:121-122`） | 第二级 home 回退 |

`@deepseek-ai/dsh-home-paths` **不可静态 import**（`tsc` 会报 TS2307，`src/ledger.ts:33-34`），因此用变量说明符 `const specifier: string = DSH_HOME_PATHS_MODULE` 做动态 import，避免 `tsc` 解析；解析失败只走回退链，**绝不上抛**（`src/ledger.ts:118-120`）。

## 4. 被谁装配

| 装配方 | 位置 | 方式 |
|---|---|---|
| `src/routes.ts` | `src/routes.ts:33`（`import { createFileLedger } from './ledger.js'`） | 唯一生产组装入口 |
| `src/routes.ts` | `src/routes.ts:626-635`（`ledgerStore()`） | 模块级单例 `defaultLedger` + `defaultLedgerPromise`，惰性构造 |
| `src/routes.ts` | `src/routes.ts:601-614`（`resolveLedgerHome()`） | 先用 `dshHomePath('worktree-groups.json')` 取目录，失败返回 `undefined` 交回 `createFileLedger()` 的两级回退 |
| `src/routes.ts` | `src/routes.ts:645`、`:921` | `options.ledger ?? (await ledgerStore())`，测试可注入 `createFileLedger(tmpdir)` |
| `test/ledger.test.mjs` | `test/ledger.test.mjs:14`、`:59` 等 | `createFileLedger(home)` 注入临时 home，绝不触碰真实 `~/.dsh` |

调用关系：

- `collectSnapshot()` 读台账：`src/routes.ts:651-656`，并额外用 `try/catch` 兜底（`ledger.read()` 本身已不抛错，此处为冗余防御）。
- `updateLedger()` 写台账：`src/routes.ts:916-994`，内部 `await ledger.update((current) => ...)`，并在 `src/routes.ts:992` 以 `return changed ? next : current` 命中同引用 no-op 优化。
- 台账数据被投影进 `TreeSnapshot.ledger`（`src/routes.ts:527`），并在 `src/routes.ts:662`、`:718`、`:751`、`:1582` 等处被遍历消费。

## 5. 核心方法签名

### 5.0 接口与函数签名原文（逐字摘自源码）

```ts
// src/ledger.ts:76-92
export interface LedgerStore {
  /** 从介质读取一份**全新**的台账数据（文件缺失/损坏时返回空台账，不抛错）。 */
  read(): Promise<LedgerData>
  /** 全量覆盖写盘（原子写：tmp + fsync + rename）。 */
  write(data: LedgerData): Promise<void>
  update(fn: (data: LedgerData) => LedgerData): Promise<LedgerData>
}
```

```ts
// src/ledger.ts:99
export function emptyLedger(): LedgerData
```

```ts
// src/ledger.ts:153
export function createFileLedger(homeDir?: string): LedgerStore
```

（`LedgerStore.update` 的完整 JSDoc 含 ⚠️ 陷阱说明，见 `src/ledger.ts:81-91`；`LedgerStore.read` / `write` 的实现体为 `src/ledger.ts:274-280`。）

### 5.1 `emptyLedger(): LedgerData`

- **位置**：`src/ledger.ts:99-101`
- **签名**：`export function emptyLedger(): LedgerData`
- **参数**：无
- **返回值**：`{ version: 1, projects: {}, sessions: {} }`
- **抛错条件**：无。纯内存构造，不触 IO。
- **关键语义**：每次调用返回**新对象**（不共享单例），调用方随意修改不会污染其它调用者（`src/ledger.ts:97`）；`test/ledger.test.mjs:337-350` 验证三次调用互不共享引用。

### 5.2 `createFileLedger(homeDir?: string): LedgerStore`

- **位置**：`src/ledger.ts:153`
- **签名**：`export function createFileLedger(homeDir?: string): LedgerStore`
- **参数**：
  - `homeDir?: string` —— harness home 目录。合法取值：任意非空路径字符串。**显式传入时完全不解析 `@deepseek-ai/dsh-home-paths` 包**（`src/ledger.ts:145`、`:160`）；缺省（`undefined`）时**惰性**取 `defaultDshHome()`，不可解析则回退 `$DSH_HOME`，再回退 `join(homedir(), '.dsh')`（`src/ledger.ts:121-123`）。
  - 该参数不校验是否存在、不 `mkdir`；目录在 `write()` 时才以 `recursive: true` 创建（`src/ledger.ts:236`）。
- **返回值**：`LedgerStore` 对象，含 `read` / `write` / `update` 三个方法（`src/ledger.ts:273-291`）。
- **抛错条件**：本函数本身**不抛错、不做任何 IO、不 await 任何模块解析**（`src/ledger.ts:147-149`）；home 解析被推入 `ledgerFile()`（`src/ledger.ts:158-164`）且其调用点在 `readFromDisk()` 内被 `try/catch` 包裹（`src/ledger.ts:194-198`），解析异常也降级为空台账。
- **闭包状态**：`explicitHome`（`src/ledger.ts:154`）、`cachedFile`（`src/ledger.ts:156`，首次解析后缓存绝对路径）、`tail`（`src/ledger.ts:257`，Promise 链尾）。

### 5.3 `LedgerStore.read(): Promise<LedgerData>`

- **位置**：接口声明 `src/ledger.ts:78`；实现 `src/ledger.ts:274-276`
- **签名**：`read(): Promise<LedgerData>`
- **参数**：无
- **返回值**：从介质读取的一份**全新**台账数据。返回值是独立副本，就地修改它不影响 store（`test/ledger.test.mjs:292-312`），两次 `read()` 返回不同对象引用（`test/ledger.test.mjs:314-324`）。
- **抛错条件**：**正常路径不抛错**（`src/ledger.ts:77`、`:150`）。所有失败路径（home 解析失败、`ENOENT`、任何 `fs` 错误、JSON 损坏、结构不符）都返回 `emptyLedger()`。
- **副作用**：JSON 损坏或结构不符时，会把坏文件 `rename` 成 `<file>.bad-<ts>`（`src/ledger.ts:213`、`:219`）。空目录读取**不会创建任何文件**（`test/ledger.test.mjs:57-70`、`:394-400`）。

### 5.4 `LedgerStore.write(data: LedgerData): Promise<void>`

- **位置**：接口声明 `src/ledger.ts:80`；实现 `src/ledger.ts:278-280`
- **签名**：`write(data: LedgerData): Promise<void>`
- **参数**：`data` —— 全量台账数据，**全量覆盖写盘**（不做合并）。合法取值：任何可被 `JSON.stringify` 序列化的 `LedgerData`；含循环引用时非法（见下）。
- **返回值**：`Promise<void>`。成功时 resolve `undefined`。
- **抛错条件**：**会抛错**。`writeToDisk()` 在 `catch` 中清理 tmp 后原样 `throw error`（`src/ledger.ts:245-253`）。典型触发：数据含循环引用 ⇒ `JSON.stringify` 抛 `TypeError`（`test/ledger.test.mjs:238-250`）；路径不可写 / 权限不足 ⇒ `mkdir` / `open` / `rename` 的 `fs` 错误上抛。写盘失败**不产生半截台账文件**（原子写语义，`test/ledger.test.mjs:254-259`）。

### 5.5 `LedgerStore.update(fn: (data: LedgerData) => LedgerData): Promise<LedgerData>`

- **位置**：接口声明 `src/ledger.ts:81-91`；实现 `src/ledger.ts:282-290`
- **签名**：`update(fn: (data: LedgerData) => LedgerData): Promise<LedgerData>`
- **参数**：`fn` —— 同步纯函数式回调，入参是刚从磁盘读到的 `current`。合法取值：任何**同步**返回 `LedgerData` 的函数；**不支持 async 回调**（实现直接 `const next = fn(current)` 并立即比较引用，`src/ledger.ts:285-286`，返回 Promise 会被当成数据对象写盘）。
- **返回值**：`Promise<LedgerData>` —— 回调的返回值 `next`（落盘成功时）或 `current`（同引用 no-op 时）。`test/ledger.test.mjs:93-115` 验证返回值与随后 `read()` 内容一致。
- **抛错条件**：回调抛错 ⇒ 原样上抛给调用方（`test/ledger.test.mjs:213-219` 断言 `/boom/`）；写盘失败 ⇒ 同 `write()` 上抛。两种情况都**不毒化 Promise 链**，后续 `update()` 仍能成功（`test/ledger.test.mjs:207-236`）。
- **no-op 优化**：`if (next === current) return current`（`src/ledger.ts:286`）。同引用时跳过写盘，磁盘上不留任何痕迹（`test/ledger.test.mjs:326-335`）。
```ts
// src/ledger.ts:282-290
update(fn: (data: LedgerData) => LedgerData): Promise<LedgerData> {
  return enqueue(async () => {
    const current = await readFromDisk()
    const next = fn(current)
    if (next === current) return current // 同一引用 ⇒ 无变化，跳过写盘
    await writeToDisk(next)
    return next
  })
}
```

**⚠️ 陷阱**：回调若**原地修改** `data` 并返回**同一引用**，会命中 no-op 优化导致**数据静默丢失**（`src/ledger.ts:85-89`）。正确用法是构造并返回**新对象**。`src/routes.ts:926-930` 的 `updateLedger` 正是靠构造 `next` 新对象才落盘。

## 6. 代码示例

以下示例使用**真实函数名与真实数据结构**。

### 6.1 最小读写往返

```ts
import { createFileLedger, emptyLedger } from './ledger.js'

// 显式传 homeDir：测试隔离，绝不写真实 ~/.dsh
const store = createFileLedger('/tmp/wtg-home')

const data = emptyLedger()          // { version: 1, projects: {}, sessions: {} }
await store.write(data)
const readBack = await store.read()
// readBack 与 data 深度相等，但是两个不同的对象引用
```

### 6.2 追加一条 worktree 记录（正确姿势：返回新对象）

```ts
import { createFileLedger } from './ledger.js'
import type { LedgerData } from './ledger.js'

const store = createFileLedger('/tmp/wtg-home')
const now = Date.now()

const next = await store.update((current: LedgerData): LedgerData => ({
  version: 1,
  projects: {
    ...current.projects,
    '/repo/.git': {
      mainPath: '/repo',
      worktrees: {
        ...(current.projects['/repo/.git']?.worktrees ?? {}),
        '/repo-feat': { branch: 'feat', firstSeenAt: now, lastSeenAt: now },
      },
    },
  },
  sessions: {
    ...current.sessions,
    'session-a': { projectKey: '/repo/.git', worktreePath: '/repo-feat' },
  },
}))
// next 是新引用 ⇒ 已落盘
```

### 6.3 标记 worktree 消失（`goneAt`）

```ts
await store.update((current) => {
  const project = current.projects['/repo/.git']
  const prior = project.worktrees['/repo-feat']
  return {
    ...current,
    projects: {
      ...current.projects,
      '/repo/.git': {
        ...project,
        worktrees: {
          ...project.worktrees,
          '/repo-feat': { ...prior, lastSeenAt: Date.now(), goneAt: prior.goneAt ?? Date.now() },
        },
      },
    },
  }
})
```

### 6.4 no-op：无变化时不写盘

```ts
// 回调返回同一引用 ⇒ 跳过写盘，目录里不会多出任何文件
const same = await store.update((current) => current)
// same 深度等于空台账（或当前台账内容）
```

### 6.5 ⚠️ 反例：原地修改 + 同引用 ⇒ 静默丢数据

```ts
// 错误写法：磁盘上不会有任何变化，下次 read() 读到的还是旧值
await store.update((current) => {
  current.sessions['session-x'] = { projectKey: 'p', worktreePath: '/w' } // 原地改
  return current                                                          // 同一引用 ⇒ no-op
})

// 正确写法：构造新对象
await store.update((current) => ({
  ...current,
  sessions: { ...current.sessions, 'session-x': { projectKey: 'p', worktreePath: '/w' } },
}))
```

### 6.6 生产组装（`src/routes.ts:626-635` 的等价写法）

```ts
import { createFileLedger } from './ledger.js'
import type { LedgerStore } from './ledger.js'

let defaultLedger: LedgerStore | undefined

async function ledgerStore(): Promise<LedgerStore> {
  defaultLedger ??= createFileLedger() // 缺省 home：defaultDshHome() → $DSH_HOME → ~/.dsh
  return defaultLedger
}
```

## 相关文档

- [Ledger技术文档.md](./Ledger技术文档.md) —— 本组件概览与导航
- [Ledger-持久化与并发技术文档.md](./Ledger-持久化与并发技术文档.md) —— 执行流程、状态机、并发模型、边界条件、已知缺陷
- [ServerHost 模块技术文档](../l2-modules/ServerHost模块技术文档.md) —— L2 模块层：路由注册、宿主上下文与生命周期
- [Routes 技术文档](../l3-components/Routes技术文档.md) —— 台账的唯一生产组装入口与写入方（`src/routes.ts`）
- [worktree-groups 知识库总览](../l1-architecture/worktree-groups-knowledge-base.md) —— L1 架构层：模块划分与数据流全景

> 注：L1 / L2 / Routes 三份文档由其他任务产出，本文件仅按规定链接路径引用，未读取其内容。
