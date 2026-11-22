---
生成时间: 2026-09-22
更新时间: 2026-09-22
git-version: 9bd94252dd934c2fa8491977285e461b703f0f3e
git-module-path: src
level: L3
---

# Types 技术文档（宿主半边共享数据结构）

> **文件路径**: `src/types.ts`

> ⚠️ **2026-10-29 定点修订**：`SessionRow` 新增必填字段 `lastActivityAt`（最后更新时间，
> `max(updatedAt, 宿主 session/event 最大活动时间)`，沿 `parentSessionId` 从子代理传播到祖先；
> 只有「最近」分区用它排序）。新增模块与契约见
> [Activity技术文档](./Activity技术文档.md)、`docs/INTERFACES.md` §1.1 / §1.7 / §2.3.3。
> 本文档其余行号锚点仍对应 `9bd9425`，未逐行重锚。

本文档描述 `src/types.ts`（全文 81 行）的 6 个导出接口。该文件是**纯类型声明文件**，
不含任何运行时代码、IO 或副作用。

## 目录

- [概述](#概述)
- [构造参数与依赖](#构造参数与依赖)
- [核心方法签名（类型字段定义）](#核心方法签名类型字段定义)
- [执行流程](#执行流程)
- [状态机](#状态机)
- [并发与线程模型](#并发与线程模型)
- [边界条件](#边界条件)
- [代码示例](#代码示例)
- [已知缺陷与注意事项](#已知缺陷与注意事项)
- [相关文档](#相关文档)

## 概述

`src/types.ts` 是 DSH worktree-groups 插件**宿主半边**（server side）的共享数据结构
定义文件。其职责是把「git 仓 / worktree / dsh 工作区 / 会话 / 侧栏树节点」这五类事实
固化成一套单一真源的类型，供三个并行开发的分工（T1 git 扫描与项目合成、T2 台账、
T3 路由）共同引用，避免各自私造影子类型（`src/types.ts:1-6` 文件头注释明示）。

核心特性：

1. **只有类型，没有运行时逻辑**。文件内全部为 `export interface` 声明，无函数、无常量、
   无 import（`src/types.ts` 全文 81 行，grep 无任何 `import`/`export const`/`export function`）。
   因此它可以被 `import type` 引入而在编译后被完全擦除，不产生任何运行时代价。
2. **是跨半边契约的「宿主侧一半」**。契约真源是 `docs/INTERFACES.md` §1.1
   （`docs/INTERFACES.md:24-105`），本文件是其 TypeScript 落地。客户端半边刻意
   **不** import 本文件，而是在 `src/tree-model.ts:68-105` 重新声明结构兼容的
   `SessionRowLike` / `WorktreeNodeLike` / `ProjectNodeLike`（`docs/INTERFACES.md:1049`
   规定「数据结构的类型自己定义在 `src/types.ts`，不 import 宿主类型」）。
3. **类型即约束**。`WorkspaceRow` 刻意**不含** `sessionIds` 字段，把「禁止用宿主
   `sessionIds` getter 做会话归属判定」这条裁定（`docs/INTERFACES.md:1207-1213`，
   D13 加强）从「靠注释约束」升级为「靠类型约束」——下一个改动者从类型上就拿不到它。
4. **承载会话状态标记**。`SessionRow` 携带 `running` / `blank` / `pendingInteraction` /
   `completed` 四个状态字段，是侧栏状态点（StatusDot）与「新会话」判定的数据源头。

## 构造参数与依赖

### 本文件的依赖

| 方向 | 内容 | 证据 |
|---|---|---|
| import | **无**。文件不 import 任何模块 | `src/types.ts` 全文无 `import` 语句 |
| 运行时依赖 | **无**。纯 `interface` 声明，编译期擦除 | `src/types.ts:9/25/35/44/58/70` 均为 `export interface` |
| 外部契约 | `docs/INTERFACES.md` §1.1 是本文件的规范来源 | `docs/INTERFACES.md:24-105` |

### 导出类型清单（共 6 个，与源码逐字一致）

| # | 类型名 | 行号 | 定位 |
|---|---|---|---|
| 1 | `WorktreeEntry` | `src/types.ts:9` | 一条 git worktree 记录 |
| 2 | `RepoInfo` | `src/types.ts:25` | 一个 git 仓的事实 |
| 3 | `WorkspaceRow` | `src/types.ts:35` | 一个 dsh 工作区投影 |
| 4 | `SessionRow` | `src/types.ts:44` | 一条会话行投影 |
| 5 | `WorktreeNode` | `src/types.ts:58` | 侧栏树 worktree 节点 |
| 6 | `ProjectNode` | `src/types.ts:70` | 侧栏树项目节点 |

> 本文件**没有**默认导出，也**没有**任何非接口导出。6 个均为 `export interface`。

### 被谁消费（真实引用点）

| 消费方 | 引入的类型 | 证据 |
|---|---|---|
| `src/git.ts` | `RepoInfo`、`WorktreeEntry` | `src/git.ts:5` |
| `src/projects.ts` | `ProjectNode`、`RepoInfo`、`SessionRow`、`WorkspaceRow`、`WorktreeEntry`、`WorktreeNode`（全部 6 个） | `src/projects.ts:6-13` |
| `src/routes.ts` | `ProjectNode`、`RepoInfo`、`SessionRow`、`WorkspaceRow` | `src/routes.ts:37` |
| `src/ledger.ts` | **不引用**（`src/ledger.ts` 的 import 只有 `node:fs/promises`、`node:os`、`node:path`，见 `src/ledger.ts:20-22`） | 全量 grep 无命中 |
| `src/tree-model.ts` | **不 import**，而是重新声明结构兼容的 `*Like` 类型 | `src/tree-model.ts:68-105` |
| `src/sidebar.tsx` | **不 import**，消费 `tree-model` 的 `*Like` 投影 | `src/sidebar.tsx` 无 `types.js` 引用 |

依赖方向为单向：`types.ts` ← `git.ts` / `projects.ts` / `routes.ts`。
`types.ts` 不依赖任何同包模块，因此处于依赖图最底层（L3）。

## 核心方法签名（类型字段定义）

本文件无方法。以下按源码逐字列出每个接口的**完整字段定义**、含义、可选性与取值范围。

### 1. `WorktreeEntry`（`src/types.ts:9-22`）

一条 git worktree 记录，来源为 `git worktree list --porcelain`。

| 字段 | 类型 | 可选 | 含义 | 取值范围 |
|---|---|---|---|---|
| `path` | `string` | 否 | 绝对路径，已归一为 POSIX 分隔符、无尾斜杠 | 非空绝对路径 |
| `branch` | `string` | 是 | 检出的分支短名（如 `"feature/ohos"`）；detached 时为 `undefined` | 已剥离 `refs/heads/` 前缀（`src/git.ts:203-205`） |
| `head` | `string` | 是 | HEAD commit sha | 40 位十六进制串（由 git 输出，未校验） |
| `isMain` | `boolean` | 否 | 是否为主工作树（origin repo 本身） | `true` / `false` |
| `bare` | `boolean` | 否 | bare 仓条目 | `true` / `false` |
| `exists` | `boolean` | 否 | 扫描时目录是否存在（`false` ⇒ 已关闭 ⇒ 会话进 history 桶） | `true` / `false` |

字段语义证据：`isMain` 由「是否首个条目」决定（`src/git.ts:181`
`isMain: entries.length === 0`）；`exists` 在纯解析阶段乐观置 `true`
（`src/git.ts:183`），再由 `scanRepo` 用 `fs.stat` 逐条覆盖（`src/git.ts:333`
`worktrees.push({ ...entry, exists: await pathExists(entry.path) })`）。

### 2. `RepoInfo`（`src/types.ts:25-32`）

一个 git 仓的事实（按 common dir 去重后）。

| 字段 | 类型 | 可选 | 含义 | 取值范围 |
|---|---|---|---|---|
| `commonDir` | `string` | 否 | 共享 `.git` 目录的绝对路径 —— **仓库身份键** | 绝对路径，非 git 仓不存在此结构（`scanRepo` 返回 `null`，`src/git.ts:290-293`） |
| `mainPath` | `string` | 否 | 主工作树绝对路径 | 绝对路径；取自 `isMain` 条目，拿不到时回退 `resolveToplevel`（`src/git.ts:326-327`） |
| `worktrees` | `WorktreeEntry[]` | 否 | 全部 worktree，主树在首位 | 非空数组（两条降级分支均至少造一条，`src/git.ts:308-323`） |

`commonDir` 作为身份键的原因：主工作树执行 `git rev-parse --git-common-dir` 只回相对
路径 `.git`，linked worktree 回绝对路径，两者归一后必须相等，同一仓才能合并为一个项目节点
（`src/git.ts:237-247` 注释）。

### 3. `WorkspaceRow`（`src/types.ts:35-41`）

一个 dsh 工作区（宿主持久记录的投影）。

| 字段 | 类型 | 可选 | 含义 | 取值范围 |
|---|---|---|---|---|
| `workspaceId` | `string` | 否 | 宿主工作区 id | 非空字符串（空则整行被丢弃，`src/routes.ts:460-462`） |
| `path` | `string` | 否 | 工作区路径 | 归一化后的非空路径（`src/routes.ts:467`） |
| `title` | `string` | 否 | 用户起的标题 | 可为空串（缺省填 `''`，`src/routes.ts:468`） |
| `createdAt` | `string` | 否 | 创建时间 | 宿主原样字符串，缺省填 `''`（`src/routes.ts:469`） |
| `updatedAt` | `string` | 否 | 更新时间 | 宿主原样字符串，缺省填 `''`（`src/routes.ts:470`） |

**注意**：本接口**没有** `sessionIds` 字段，这是刻意的类型级约束（见
[已知缺陷与注意事项](#已知缺陷与注意事项) 第 1 条）。

### 4. `SessionRow`（`src/types.ts:44-55`）

一条会话行（宿主 sessions 快照的投影）。字段最多，是本文件的核心结构。

| 字段 | 类型 | 可选 | 含义 | 取值范围 |
|---|---|---|---|---|
| `sessionId` | `string` | 否 | 会话 id | 宿主形如 `session-<uuid>`（`src/tree-model.ts:65` 记录该前缀） |
| `updatedAt` | `number` | 否 | 更新时间戳 | **有限数字**；取值顺序 `summary.updatedAt ?? header.createdAt ?? 0`（`src/routes.ts:432`） |
| `running` | `boolean` | 否 | 该会话自身是否在跑 | 严格 `summary?.running === true`，缺失即 `false`（`src/routes.ts:441`） |
| `blank` | `boolean` | 否 | 是否为「空白新会话」 | 严格 `summary?.blank === true`（`src/routes.ts:442`） |
| `cwd` | `string` | 是 | 会话工作目录 | 非空字符串；缺失时**不写该键**（`src/routes.ts:444-445`） |
| `parentSessionId` | `string` | 是 | 父会话 id（子代理场景） | 非空字符串；缺失不写键（`src/routes.ts:446-447`） |
| `origin` | `'subagent'` | 是 | 会话来源 | **字面量联合，仅 `'subagent'` 一个取值**（`src/types.ts:51`） |
| `pendingInteraction` | `string` | 是 | 待确认交互的 kind | 非空字符串；缺失不写键（`src/routes.ts:448-449`） |
| `completed` | `boolean` | 是 | 是否已完成 | `true` / `false`；宿主非布尔时不写键（`src/routes.ts:450`） |
| `title` | `string` | 是 | 会话标题 | 仅 summary 存在时才计算（`src/routes.ts:444`） |

### 5. `WorktreeNode`（`src/types.ts:58-67`）

侧栏树的一个 worktree 节点。

| 字段 | 类型 | 可选 | 含义 | 取值范围 |
|---|---|---|---|---|
| `path` | `string` | 否 | worktree 绝对路径（树内唯一键） | 归一化路径（`src/projects.ts:326`） |
| `branch` | `string` | 是 | 分支短名 | 直传 `WorktreeEntry.branch`，detached 时为 `undefined`（`src/projects.ts:328`） |
| `isMain` | `boolean` | 否 | 是否主工作树 | 直传（`src/projects.ts:329`） |
| `exists` | `boolean` | 否 | 目录是否存活 | 直传（`src/projects.ts:330`） |
| `workspaceId` | `string` | 是 | 已注册的 dsh 工作区 id；未注册为 `undefined`（懒注册） | 来自 `workspaceByPath`（`src/projects.ts:331`），或子目录工作区回填（`src/projects.ts:355`） |
| `title` | `string` | 否 | 显示标题 | `entry.branch ?? basename(path)`（`src/projects.ts:332`） |
| `sessions` | `SessionRow[]` | 否 | 挂在该 worktree 下的会话 | 初始为 `[]`，由归属判定填充（`src/projects.ts:333`） |

### 6. `ProjectNode`（`src/types.ts:70-81`）

侧栏树的一个项目节点 = 一个 git common dir（或一个非 git 工作区）。

| 字段 | 类型 | 可选 | 含义 | 取值范围 |
|---|---|---|---|---|
| `key` | `string` | 否 | 项目键；非 git 工作区用 `ws:<workspaceId>` | git 项目为 `commonDir`（`src/types.ts:71-72`、`src/projects.ts:377`） |
| `isGit` | `boolean` | 否 | 是否 git 项目 | `true`（`src/projects.ts:374`）/ `false`（`src/projects.ts:394`） |
| `title` | `string` | 否 | 项目标题 | 单一具名工作区时用其标题，否则 `basename(mainPath)`（`src/projects.ts:361-363`） |
| `mainPath` | `string` | 是 | 主工作树路径 | 仅 git 项目有；非 git 项目不设置（`src/projects.ts:387-395` 未含该键） |
| `worktrees` | `WorktreeNode[]` | 否 | 全部 worktree 节点 | git 项目非空；非 git 项目为 `[]`（`src/projects.ts:392`） |
| `history` | `SessionRow[]` | 否 | 已关闭 worktree 的会话（history-worktree-session 桶） | 初始 `[]`（`src/projects.ts:378`） |
| `flatSessions` | `SessionRow[]` | 否 | 非 git 工作区：会话直接挂项目下 | 初始 `[]`（`src/projects.ts:379`） |

### interface 与 type 的选用理由

本文件 6 个导出**全部使用 `interface`**，未使用 `type` 别名。可核实的理由：

1. **全部是对象结构**，语义上就是「具名对象形状」，`interface` 是其自然表达；
   文件中没有联合类型、交叉类型或原语别名等必须用 `type` 的场景
   （全文件唯一的联合类型是字段级的 `origin?: 'subagent'`，位于 `src/types.ts:51`）。
2. **可被 declaration merging 与 `extends` 扩展**，便于宿主侧与客户端 `*Like`
   镜像结构各自演进而不互相 import（`src/tree-model.ts:68-105` 采用同构而非继承，
   见 `docs/INTERFACES.md:496-498`「纯数据结构，与宿主 types.ts 的 ProjectNode
   结构兼容（避免跨半边 import）」）。
3. `docs/INTERFACES.md` §1.1 的契约代码块本身即以 `export interface` 书写
   （`docs/INTERFACES.md:26/42/58/67/81/93`），实现与契约逐字对齐。

> 说明：仓库未记录「为何不用 `type`」的显式决策文档，上述 1、3 条可由源码与契约直接
> 定位；第 2 条为依据 `tree-model.ts` 的实际做法归纳，属**推断**，非明文裁定。

## 执行流程

**N/A**。原因：`src/types.ts` 是纯类型声明文件，只有 `export interface`，
没有任何语句、函数体或副作用，编译后类型被完全擦除，不存在可描述的运行时执行流程
（证据：`src/types.ts` 全文 81 行，无 `import`/函数/常量；`git log -- src/types.ts`
仅一条提交 `3328325`，为一次性引入）。

真正的运行时流程发生在消费方：
`src/git.ts:290 scanRepo` → `src/routes.ts:210` 组装 → `src/projects.ts:310 buildProjects`
→ `src/routes.ts:824 TreePayload`。这些流程属于各自模块文档的职责范围。

## 状态机

本文件本身不是状态机，但 `SessionRow` 承载了会话的**状态标记**，构成一个可辨识的
状态组合。以下 ASCII 图描述宿主侧对一条会话的观测状态迁移（依据
`src/tree-model.ts:665-670` 记录的宿主语义与 `src/sidebar.tsx:512-513` 的消费方式）。

```text
                    (宿主新建会话)
                          |
                          v
              +-----------------------+
              |  blank = true         |   "空白新会话"
              |  running = false      |
              +-----------------------+
                          |
                  (发出首条 user/message)
                          |
                          v
              +-----------------------+   agent 开始工作
              |  blank = false        | ----------------------+
              |  running = true       |                        |
              +-----------------------+                        |
                          |                                  |
                   (等待人工确认)                             |
                          v                                  |
              +-----------------------+                        |
              | pendingInteraction    |                        |
              |   = <kind>            |                        |
              +-----------------------+                        |
                          |                                  |
                   (确认完成 / 完成)                           |
                          v                                  v
              +-----------------------+
              |  completed = true     |
              |  running = false      |
              +-----------------------+
```

状态参考表：

| 状态标记 | 字段 | 判定来源（源码定位） | 侧栏语义 |
|---|---|---|---|
| 空白新会话 | `blank === true` | `src/routes.ts:442` | 折叠时只显示当前一条（`src/tree-model.ts:12`） |
| 运行中 | `running === true` | `src/routes.ts:441` | 状态点绿/活动（`src/sidebar.tsx:366-374` 附近注释） |
| 等待确认 | `pendingInteraction !== undefined` | `src/routes.ts:448-449` | 状态点琥珀（`src/sidebar.tsx:365`、`src/sidebar.tsx:512-513`） |
| 已完成 | `completed === true` | `src/routes.ts:450` | 由 `withLiveState` 实时覆盖（`src/sidebar.tsx:499-514`） |
| 子代理 | `origin === 'subagent'` | `src/routes.ts:451` | 参与 subagent 计数，不参与顶部区判定（`src/tree-model.ts:698`） |

> 该图是**观测状态**的归纳，不是 `types.ts` 内部实现的迁移函数——`types.ts` 不含
> 任何迁移逻辑。`blank: true → false` 的转换是宿主行为，本包只做观测
> （`src/tree-model.ts:666-667` 明文记录）。

## 并发与线程模型

**N/A**。原因：`src/types.ts` 无任何可变状态与执行体，仅声明数据结构形状，
不存在并发访问面。文件内也没有 `let`/`const`/函数可供并发调用。

补充事实（供上层模块参考，非本文件职责）：这些结构在**构造期**是可变累加器，
`buildProjects` 用 `ProjectAccumulator`（`src/projects.ts:245-256`）逐步填充，
组装完成后再摊平成 `ProjectNode`（`src/projects.ts:294` 注释：「组装完成后再摊平成
冻结的 `ProjectNode`」）。Node.js 单线程事件循环模型下，`buildProjects` 是同步纯函数
（`src/projects.ts:52` 注释：「函数本身不做 IO」），不涉及跨线程共享。

## 边界条件

| 边界场景 | 涉及类型/字段 | 处理方式 | 源码证据 |
|---|---|---|---|
| 可选字段缺失（detached HEAD） | `WorktreeEntry.branch` | 置 `undefined`，不写值；排序时用 `path` 回退 | `src/git.ts:180`、`src/projects.ts:92-99` |
| 可选字段缺失（无 HEAD） | `WorktreeEntry.head` | 保持 `undefined`（`PendingWorktree.head` 未赋值） | `src/git.ts:181` 未含 `head` 键来源校验 |
| 可选字段缺失（会话无 cwd） | `SessionRow.cwd` | **不写该键**；`assignSession` 首行即判 `cwd === undefined` ⇒ 未分组 | `src/routes.ts:445`、`src/projects.ts:176` |
| 可选字段缺失（无父会话） | `SessionRow.parentSessionId` | 不写键 | `src/routes.ts:447` |
| 可选字段缺失（未注册工作区） | `WorktreeNode.workspaceId` | 保持 `undefined`（懒注册语义） | `src/types.ts:63-64`、`src/projects.ts:331` |
| 可选字段缺失（非 git 项目） | `ProjectNode.mainPath` | 该键不设置 | `src/projects.ts:387-395` |
| 联合类型穷尽性 | `SessionRow.origin` | 联合只有 `'subagent'` 一个成员；投影侧显式判 `originValue === 'subagent'` 才写值，其他取值一律丢弃 | `src/types.ts:51`、`src/routes.ts:451` |
| `null` / `undefined` 语义 | `SessionRow.updatedAt` | **必须回退**为有限数字，顺序 `summary.updatedAt ?? header.createdAt ?? 0`，否则 NaN 排序 | `src/routes.ts:432`、`docs/INTERFACES.md:1216` |
| `null` / `undefined` 语义 | `SessionRow.running` / `blank` | 缺失不等于 `undefined`，而是**强转 `false`**（严格 `=== true`） | `src/routes.ts:441-442` |
| `null` / `undefined` 语义 | `SessionRow.completed` | 与上两者不同：宿主非布尔时**不写键**，保留 `undefined` 三态 | `src/routes.ts:450` |
| 空字符串 vs 缺失 | `WorkspaceRow.title/createdAt/updatedAt` | 缺失统一填 `''`（非可选字段，不允许 `undefined`） | `src/routes.ts:468-470` |
| 跨模块传参不匹配 | `RepoInfo.worktrees` 空数组 | `assignSession` 显式判 `repo.worktrees.length > 0` 才走规则 2 | `src/projects.ts:186` |
| 跨模块传参不匹配 | `WorktreeEntry.exists` 为 `false` | 规则 2 **必须**同时校验 `exists`，否则死 worktree 会话被永久扣住 | `src/projects.ts:181`、`src/projects.ts:169-171` |
| 跨半边结构漂移 | `SessionRow` ↔ `SessionRowLike` | 两处独立声明、结构兼容但无编译期约束，靠契约与注释维持一致 | `src/types.ts:44`、`src/tree-model.ts:68` |
| 降级路径 | `RepoInfo.worktrees` 至少一条 | 拿不到 porcelain 或解析为空时，造一条 `isMain: true` 的兜底条目 | `src/git.ts:308-323` |

## 代码示例

以下示例使用真实类型名与真实字段，构造侧对应 `src/git.ts:308-323` 的实际写法，
消费侧对应 `src/projects.ts:92-99` 的排序用法。

### 构造一个 `RepoInfo`

```ts
import type { RepoInfo, WorktreeEntry } from './types.js'

// 降级兜底分支的真实写法（src/git.ts:308-323 同构）
const mainEntry: WorktreeEntry = {
  path: '/Users/me/repo',
  isMain: true,
  bare: false,
  exists: true,
  // branch / head 可选，此处省略
}

const repo: RepoInfo = {
  commonDir: '/Users/me/repo/.git',
  mainPath: '/Users/me/repo',
  worktrees: [mainEntry],
}
```

### 构造一条 `SessionRow`

```ts
import type { SessionRow } from './types.js'

// 对应 src/routes.ts:438-455 toSessionRow 的输出形状
const row: SessionRow = {
  sessionId: 'session-1f2e3d',
  updatedAt: 1758500000000,   // 必须是有限数字（裁定 7 回退后的结果）
  running: true,
  blank: false,
  cwd: '/Users/me/repo-worktrees/feature-ohos',
  origin: 'subagent',         // 字面量联合，仅此一个取值
  completed: false,
  // parentSessionId / pendingInteraction / title 可选，此处省略
}
```

### 消费：按 `branch` 排序 worktree（含 detached 回退）

```ts
// 对应 src/projects.ts:92-99 compareWorktrees 的真实逻辑
import type { WorktreeEntry } from './types.js'

function compareWorktrees(a: WorktreeEntry, b: WorktreeEntry): number {
  if (a.isMain !== b.isMain) return a.isMain ? -1 : 1
  const aKey = a.branch ?? a.path   // branch 缺失（detached）时用路径回退
  const bKey = b.branch ?? b.path
  const byBranch = aKey.localeCompare(bKey)
  if (byBranch !== 0) return byBranch
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0
}
```

### 消费：按项目键取回 worktree 节点

```ts
import type { ProjectNode, WorktreeNode } from './types.js'

function worktreePaths(project: ProjectNode): string[] {
  // 键 = ProjectNode.key（git 项目为 commonDir，非 git 为 `ws:<id>`）
  return project.worktrees.map((node: WorktreeNode) => node.path)
}
```

## 已知缺陷与注意事项

1. **`WorkspaceRow` 无 `sessionIds` 是刻意设计，不要「补全」它**。
   宿主 `workspace.sessionIds` 是会实时过滤的 getter，cwd 不匹配的会话会被静默剔除，
   直接用它做归属判定会导致 PRD D6/G4「分布不变」丢会话
   （`docs/INTERFACES.md:1202-1213`，裁定 6 与 D13 加强）。补回该字段等于撤销这条类型级保护。
2. **`running` / `blank` 的 `false` 与 `completed` 的 `undefined` 语义不对称**。
   前两者缺失即强转 `false`（`src/routes.ts:441-442`），后者缺失保留 `undefined`
   （`src/routes.ts:450`）。消费方若统一按 `?? false` 处理 `completed`，会丢失三态语义。
3. **跨半边类型无编译期约束**。`SessionRow`（`src/types.ts:44`）与
   `SessionRowLike`（`src/tree-model.ts:68`）、`WorktreeNode`/`ProjectNode` 与对应
   `*Like` 是两份独立声明，结构漂移不会被 `tsc` 捕获。修改本文件任一字段时**必须**
   同步检查 `src/tree-model.ts:68-105`。
4. **`origin` 是单成员字面量联合**。宿主若有新 origin 取值，投影侧
   `src/routes.ts:451` 会静默丢弃，类型上也不会报错——这是一个静默降级点。
5. **`RepoInfo.worktrees` 的「主树在首位」是约定而非类型保证**。
   类型只声明 `WorktreeEntry[]`，顺序由 `compareWorktrees`（`src/projects.ts:92`）
   与 `parseWorktreeList`（`src/git.ts:181`）共同维持；直接消费未排序数组时不应假设首位是主树。
6. **`WorktreeEntry.head` 未做格式校验**。类型为 `string | undefined`，实际由 git
   输出决定，非 git 来源的构造可能塞入任意字符串。
7. **文档未覆盖项**：`git log -- src/types.ts` 仅一条提交 `3328325`，
   无法从历史中核实字段演进过程；`origin` 为何限定为单成员联合**未确认**
   （源码与 `docs/INTERFACES.md` 均未给出该约束的显式理由）。

## 相关文档

- [TreeModel 模块技术文档](../l2-modules/TreeModel模块技术文档.md) —— 客户端半边的 `*Like` 镜像类型与树构建
- [ServerHost 模块技术文档](../l2-modules/ServerHost模块技术文档.md) —— `git.ts` / `projects.ts` / `routes.ts` 对本文类型的生产与消费
- [worktree-groups 知识库架构总览](../l1-architecture/worktree-groups-knowledge-base.md) —— 分层索引与阅读顺序
