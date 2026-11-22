---
生成时间: 2026-09-22
更新时间: 2026-09-22
git-version: 9bd94252dd934c2fa8491977285e461b703f0f3e
git-module-path: src
level: L3
---

# Routes-快照组装与台账 技术文档

> **文件路径**: `src/routes.ts`
> **父文档**: [Routes技术文档.md](./Routes技术文档.md)（概览 + 子文档索引）

> ⚠️ **2026-10-29 定点修订（RAS2/RAS3）**：`registerRoutes` 在注册路由前调用
> `registerSessionActivityObserver(ctx)` 监听宿主 `session/event`（不用 `ctx.effect`，
> 路由 effect 数量仍为 5）；`buildSessionRows` 在全部行（含子代理）到齐后调用
> `attachLastActivityTimes(rows)` 写 `SessionRow.lastActivityAt`。新增模块见
> [Activity技术文档](./Activity技术文档.md)、契约 §1.7。
>
> ⚠️ **2026-11-22 定点修订（dsh remote 远程控制模式）**：当 `dshRemoteClient.status().mode === 'remote'` 且 `options.forceLocal !== true` 时，`buildTreePayload` 优先走 Tier 1 `plugin.route.call`（`route: 'dsh-worktree-groups'`）向远端主机请求树载荷；Tier 1 不可用时，`collectSnapshot` 走 Tier 2 `collectRemoteGatewaySnapshot`（经远端 `typertGateway` 的 `workspace/follow`、`session/list`、`directoryPicker/list`、`workspaceFiles/read` 还原机器 B 的 git worktree 树），并使用按 `targetKey` 隔离的内存台账（`remoteLedgerStore`）且跳过本机 D18 `sweepDeadWorkspaces`。详见 [工作记录 2026-11-22](../../worklog/2026-11-22-remote-worktree-display.md)。

本文是 `src/routes.ts` 的功能拆分文档之一，覆盖 **宿主事实收集（快照组装）、会话行投影、
D18 自动清扫、扫描缓存与台账回写**。5 个 HTTP 路由的契约见
[Routes-路由注册与契约技术文档.md](./Routes-路由注册与契约技术文档.md)，
路径校验与安全边界见
[Routes-路径校验与安全边界技术文档.md](./Routes-路径校验与安全边界技术文档.md)。

## 概述

本层是 `src/routes.ts` 的**数据组装面**：把四类互相独立、可靠性各异的宿主事实源合并成一次
请求所需的完整快照，并把本次观察回写台账（`src/routes.ts:9-23`、`src/routes.ts:642-779`）。

核心特性：

1. **双事实源左连接**：以 `sessionPersistence.list()` 的全量历史（含 cwd 已删除的孤儿）为主表，
   用 `sessionController.list()` 的实时状态补 `running` / `blank` / `updatedAt` / `title`，
   按 `sessionId` 左连接（`src/routes.ts:11-22`、`src/routes.ts:405-417`）。
2. **缺失即降级**：每个宿主服务都是惰性 + 可选，任一缺席只让对应字段为空；台账读失败退化为
   空台账，台账写失败被吞掉，均不影响响应（`src/routes.ts:640-641`、`src/routes.ts:652-656`、
   `src/routes.ts:892-896`）。
3. **扫描结果 30 秒缓存**，按 commonDir 语义去重，冷启动同一仓只跑一次 git
   （`src/routes.ts:52`、`src/routes.ts:185-249`）。
4. **D18 自动清扫**：注销「目录已死」且「有正面证据是非主工作树」的工作区记录；主仓自己被删时
   不动它，避免静默丢记录（`src/routes.ts:781-818`）。
5. **台账写串行化**：`ledger.update` 内部 Promise 链保证任一时刻只有一次「读-改-写」在飞，
   单次回调抛错不毒化后续任务（`src/ledger.ts:256-291`）。

## 目录

- [1. 构造参数与依赖](#1-构造参数与依赖)
- [2. 核心方法签名](#2-核心方法签名)
- [3. 执行流程](#3-执行流程)
- [4. 状态机](#4-状态机)
- [5. 并发与线程模型](#5-并发与线程模型)
- [6. 边界条件](#6-边界条件)
- [7. 代码示例](#7-代码示例)
- [8. 已知缺陷与注意事项](#8-已知缺陷与注意事项)
- [9. 相关文档](#9-相关文档)

---

## 1. 构造参数与依赖

本层无类、无构造参数，全部为模块级函数 + 显式注入的 `ctx` 与 `options`。

### 1.1 依赖的宿主服务

全部经 `getService<T>(ctx, name)` 运行时获取，**不静态 import 任何 `@deepseek-ai/*` 宿主包**
（`src/routes.ts:54-60`、`src/routes.ts:162-172`）。`getService` 自身包 try/catch，
`ctx.get` 缺失、抛错、返回 `null`/`undefined` 都返回 `undefined`（`src/routes.ts:162-172`）。

| 宿主服务名 | 本文件声明类型 | 使用的成员 | 声明位置 | 使用位置 |
|---|---|---|---|---|
| `webServer` | `HostWebServer` | `register({kind,path,handler}) => disposer` | `src/routes.ts:148-154` | `src/routes.ts:1365` |
| `workspaceRegistry` | `HostWorkspaceRegistry` | `list()`（**同步**）、`create(path,title?)`、`delete(id)`、`archivedSessionIds` | `src/routes.ts:78-83` | `src/routes.ts:477`、`src/routes.ts:799`、`src/routes.ts:1420`、`src/routes.ts:1506`、`src/routes.ts:1616` |
| `sessionPersistence` | `HostSessionPersistence` | `list(options?: {signal})` —— **对象形参**，宿主内部读 `options?.signal` | `src/routes.ts:104-106` | `src/routes.ts:388`、`src/routes.ts:396` |
| `sessionController` | `HostSessionController` | `list(request, signal)` —— **两个位置参数** | `src/routes.ts:143-145` | `src/routes.ts:295-298` |
| `sessions` | `HostSessions` | `list`（无参同步方法，或 observable 快照源 `{getSnapshot}`） | `src/routes.ts:132-134` | `src/routes.ts:316-370` |
| `logger` | 结构化可选调用 | `ctx.logger?.warn?.(msg)` | 无独立声明 | `src/routes.ts:868-872` |

结构性类型刻意做最小声明。`ctx.workspaceRegistry` 实体**不声明** `sessionIds` getter，
从类型层面禁止用它做归属判定（会实时过滤掉死 cwd 会话，`src/routes.ts:62-75`）。

### 1.2 依赖的本包模块

| 依赖 | 导入符号 | 位置 |
|---|---|---|
| `./git.js` | `normalizePath`、`runGit`、`scanRepo` | `src/routes.ts:32` |
| `./ledger.js` | `createFileLedger` | `src/routes.ts:33` |
| `./ledger.js` | 类型 `LedgerData`、`LedgerStore` | `src/routes.ts:36` |
| `./projects.js` | `buildProjects`、`collectUngrouped` | `src/routes.ts:34` |
| `./types.js` | 类型 `ProjectNode`、`RepoInfo`、`SessionRow`、`WorkspaceRow` | `src/routes.ts:37` |
| Node 内置 | `execFile`、`lstat`、`realpath`、`stat`、`basename`、`dirname`、`join` | `src/routes.ts:25-27` |
| 惰性动态 import | `@deepseek-ai/dsh-home-paths` 的 `dshHomePath` | `src/routes.ts:601-614` |

### 1.3 可注入依赖（`SnapshotOptions`）

`SnapshotOptions`（`src/routes.ts:568-575`）：

| 字段 | 含义 | 缺省行为 |
|---|---|---|
| `ledger?: LedgerStore` | 台账存储 | 用模块级懒构造单例 `ledgerStore()` |
| `signal?: AbortSignal` | 取消信号 | 无取消 |
| `now?: number` | 「当前时刻」注入点（缓存 TTL 判定 + 台账时间戳） | `Date.now()`（`src/routes.ts:643`、`src/routes.ts:922`） |

### 1.4 默认台账的两级回退

`ledgerStore()`（`src/routes.ts:626-635`）用 Promise 单例保证并发首调只解析一次：

```text
ledgerStore()
  |
  +-- defaultLedger 已存在? -> 直接返回
  |
  +-- defaultLedgerPromise ??= (async () => {
        home = await resolveLedgerHome()        [src/routes.ts:601-614]
          |   动态 import dshHomePath('worktree-groups.json') -> dirname(file)
          |   失败/形态变化 -> undefined
        return home === undefined ? createFileLedger() : createFileLedger(home)
      })()
  |
  +-- defaultLedger = await defaultLedgerPromise
```

`createFileLedger()` 自身**不做任何 IO**（只记住 home 目录，`src/ledger.ts:141-164`），
因此这里 await 一次模块解析不会引入磁盘访问（`src/routes.ts:616-622`）。
`home === undefined` 时走 `createFileLedger()` 自己的
`defaultDshHome()` → `$DSH_HOME` → `~/.dsh` 回退链（`src/ledger.ts:109-124`），
**两级回退都被保留**（`src/routes.ts:586-600`）。

## 2. 核心方法签名

| 函数 | 签名 | 返回 / 行为 | 位置 |
|---|---|---|---|
| `collectSnapshot` | `(ctx: Context, options?: SnapshotOptions) => Promise<TreeSnapshot>` | 收集一次请求的全部宿主事实；任何服务缺席只让对应字段为空，不抛错 | `src/routes.ts:642-779` |
| `buildTreePayload` | `(ctx, options?: SnapshotOptions, precomputed?: TreePayload) => Promise<TreePayload>` | 组装 `/tree` 完整载荷；执行 D18 清扫 + 台账回写；`precomputed` 可跳过 `buildProjects` 重算 | `src/routes.ts:835-905` |
| `sweepDeadWorkspaces` | `(ctx, snapshot: TreeSnapshot) => Promise<{removed: string[]; failed: {workspaceId,message}[]}>` | D18 清扫：只注销「磁盘已死」且「有正面证据是非主工作树」的工作区 | `src/routes.ts:795-818` |
| `buildSessionRows` | `(ctx, signal?: AbortSignal) => Promise<{rows: SessionRow[]; summaries: Map<string, SummaryLike>}>` | 以全量历史为主表，左连接实时 summary | `src/routes.ts:383-420` |
| `loadSessionSummaries` | `(ctx, signal?) => Promise<Map<string, SummaryLike>>` | 三级降级收集实时摘要；全缺失返回空 Map | `src/routes.ts:289-373` |
| `loadWorkspaces` | `(ctx) => {workspaces: WorkspaceRow[]; registry: HostWorkspaceRegistry \| undefined}` | 读工作区注册表；`list()` 抛错时返回已读到的部分 | `src/routes.ts:473-490` |
| `loadArchivedSessionIds` | `(registry?) => string[]` | 非数组返回 `[]`；过滤掉非 string 元素 | `src/routes.ts:493-497` |
| `workspaceSignature` | `(workspaces: readonly WorkspaceRow[]) => string` | 内容签名：`workspaceId\0path\0title\0updatedAt` 逐条拼接后 `sort()` | `src/routes.ts:511-516` |
| `clearScanCache` | `() => void` | 清空模块级扫描缓存 | `src/routes.ts:196-198` |
| `updateLedger` | `(snapshot, options, projects: ProjectNode[]) => Promise<void>`（**非导出**） | 把本次观察写回台账 | `src/routes.ts:916-994` |
| `scanRepos` | `(candidates: readonly string[], now: number, signal?) => Promise<{repos: Map<string,RepoInfo>; pathToCommonDir: Map<string,string>}>`（**非导出**） | 扫描候选路径，按 commonDir 去重 | `src/routes.ts:206-249` |

导出类型：`TreeSnapshot`（`src/routes.ts:523-565`）、`SnapshotOptions`（`src/routes.ts:568-575`）、
`TreePayload`（`src/routes.ts:821-827`）、`SCAN_CACHE_TTL_MS`（`src/routes.ts:52`）。

### 2.1 `TreeSnapshot` 字段含义

| 字段 | 类型 | 含义 | 位置 |
|---|---|---|---|
| `workspaces` | `WorkspaceRow[]` | 工作区注册表投影（只含 id/path/title/createdAt/updatedAt） | `src/routes.ts:524` |
| `repos` | `Record<string, RepoInfo>` | commonDir → 仓事实 | `src/routes.ts:525` |
| `repoByWorkspacePath` | `Record<string, string>` | 工作区路径 → commonDir | `src/routes.ts:526` |
| `ledger` | `LedgerData` | 台账全量数据 | `src/routes.ts:527` |
| `sessions` | `SessionRow[]` | 全量历史会话行（含孤儿） | `src/routes.ts:528` |
| `archivedSessionIds` | `string[]` | 归档会话 id（客户端再兜一层剔除） | `src/routes.ts:529` |
| `workspaceByPath` | `Record<string, string>` | 归一化路径 → workspaceId | `src/routes.ts:531` |
| `knownWorktreePaths` | `Set<string>` | 白名单：全部已知 worktree 路径 | `src/routes.ts:533` |
| `knownRepoPaths` | `Set<string>` | 白名单：全部已知 git 仓入口路径 | `src/routes.ts:535` |
| `mainPathByKnownPath` | `Map<string, string>` | 归一化路径 → 所属仓 **mainPath**；覆盖 `knownRepoPaths ∪ knownWorktreePaths` 的每个键 | `src/routes.ts:536-546` |
| `liveWorkspacePaths` | `Set<string>` | **已确认磁盘存在**的工作区路径（`fs.stat` 实测） | `src/routes.ts:547-551` |
| `nonMainWorkspacePaths` | `Set<string>` | **有正面证据**表明是「非主工作树」的工作区路径，D18 只允许删这些 | `src/routes.ts:552-564` |

`mainPathByKnownPath` 存在的理由（`src/routes.ts:539-544`）：macOS 上 `/var` 是 `/private/var`
的符号链接，`git worktree list` 回 realpath 拼法，而 dsh 工作区路径可能是另一种拼法，
二者经 `normalizePath`（只做 `resolve`，不做 `realpath`）后仍不相等。因此**白名单命中的拼法**
必须与**仓查找用的拼法**来自同一批来源，否则会出现「白名单放行、却找不到仓库」的自相矛盾。

`nonMainWorkspacePaths` 要求**正面证据**（`src/routes.ts:552-564`）：若一个仓的整个目录
（含 `.git`）都消失了，git 扫不出任何 worktree，「它是不是主树」**不可判定**；
此时当非主树删掉会在用户临时移走 / 之后重新 clone 时**静默丢掉工作区记录**。

### 2.2 会话行投影规则（裁定 7 / 裁定 8）

`toSessionRow`（`src/routes.ts:423-452`）：

```text
updatedAt        = finiteNumber(summary?.updatedAt) ?? finiteNumber(header?.createdAt) ?? 0
cwd              = nonEmptyString(summary?.cwd) ?? nonEmptyString(header?.cwd)
parentSessionId  = nonEmptyString(summary?.parentSessionId) ?? nonEmptyString(header?.parentSession)
origin           = (summary?.origin ?? header?.origin) === 'subagent' ? 'subagent' : undefined
title            = summaryTitle(summary)   // projections.values.title 优先于顶层 title
running          = summary?.running === true
blank            = summary?.blank === true
```

- **裁定 7**：`updatedAt` 必须回退到 `header.createdAt` 再回退 `0`，否则孤儿会话会得到
  `undefined`（排序 NaN / 排到末尾）（`src/routes.ts:428-429`）。
- **裁定 8**：`cwd` 可缺失，缺失时**不写该键**，由 `buildProjects` 的 `assignSession`
  归入未分组（`src/routes.ts:444-445`）。
- `finiteNumber` 保证非有限数字不污染排序（`src/routes.ts:256-258`）。

`loadSessionSummaries` 的三级降级（`src/routes.ts:275-373`）：

| 级别 | 来源 | 判据 | 位置 |
|---|---|---|---|
| 1 | `ctx.sessionController.list({}, signal)` | 取 `{items}` 或裸数组；有 `sessionId`/`id` 即收录 | `src/routes.ts:295-314` |
| 2a | `ctx.sessions.list()` 元素本身像 summary | 有 `sessionId` + 数字 `updatedAt` | `src/routes.ts:325-328` |
| 2b | `ctx.sessions.list()` 元素是活的 `Session` | 有 `.header`，从 header 推导最小摘要（`blank = seq === 0`） | `src/routes.ts:329-342` |
| 3 | `ctx.sessions.list` 是 observable 快照源 | 有 `getSnapshot`，读 `items` / `byId` | `src/routes.ts:356-370` |

级别 1 有结果（`summaries.size > 0`）即提前返回，不再降级（`src/routes.ts:314`）。
宿主 `SessionStore.list()` 是**无参同步**方法，不能传 signal、也不返回 Promise
（`src/routes.ts:349-351`）。

### 2.3 `sweepDeadWorkspaces` 与 `workspaceSignature`

`sweepDeadWorkspaces`（`src/routes.ts:795-818`）的判定顺序：

```text
for workspace of snapshot.workspaces:
    liveWorkspacePaths.has(path)?      -> continue（保留）
    !nonMainWorkspacePaths.has(path)?  -> continue（主树或不可判定，不动）
    await registry.delete(workspaceId) -> removed.push(id)
      抛错 -> failed.push({workspaceId, message: failMessage(error)})
```

`registry.delete` 对未知 id 是幂等 no-op（返回 `false`），两种情况都算「记录已不在注册表里」
（`src/routes.ts:810-811`）。安全边界：**只碰注册表，不碰磁盘、不碰会话日志**（`src/routes.ts:787-791`）。

`workspaceSignature`（`src/routes.ts:511-516`）是 D8 的判据，**不用长度**：长度是代理指标，
D18 清扫删 1 条 + 宿主同一轮新增 1 条 ⇒ 长度相等，`length !== length` 会误判「没变」，
本轮响应继续用旧表（死工作区行多渲染一轮）（`src/routes.ts:500-510`）。
签名含 `workspaceId` / `path` / `title` / `updatedAt`，且**先按排序**，因此与
`registry.list()` 的返回顺序无关。

### 2.4 `updateLedger` 的回写规则

`updateLedger`（`src/routes.ts:916-994`）在 `ledger.update(fn)` 内构造**新对象** `next`
（`src/routes.ts:926-930`）：

- `projects[commonDir].worktrees[path]`：首次见到填 `firstSeenAt = lastSeenAt = now`；
  再次见到刷新 `lastSeenAt`（并**清除** `goneAt` —— 目录又被建回来了）；
  `exists === false` 时首次设置 `goneAt`（`src/routes.ts:939-964`）。
- `projects[commonDir].mainPath` 变化时整体替换该项目的记录（`src/routes.ts:966-972`）。
- `sessions[sessionId] = { projectKey, worktreePath }`：**只记录本次确实归到某个存在的
  worktree** 的会话；history 桶里的会话保留台账原值，否则会把历史归属覆盖成空
  （`src/routes.ts:975-990`）。
- `changed === false` 时返回**原引用** `current`，命中 `ledger.update` 的「同引用 ⇒ 跳过写盘」
  优化（`src/routes.ts:992`、`src/ledger.ts:286`）。

## 3. 执行流程

### 3.1 `/tree` 组装与 D18 清扫

```text
handleTree
  |
  +-> readBody(req)                       (返回值被丢弃)
  |
  +-> buildTreePayload(ctx)                                  [src/routes.ts:835]
        |
        +-> collectSnapshot(ctx)                             [src/routes.ts:642]
        |     +-> loadWorkspaces(ctx)            同步 list()   [src/routes.ts:473]
        |     +-> loadArchivedSessionIds(reg)                  [src/routes.ts:493]
        |     +-> buildSessionRows(ctx)                        [src/routes.ts:383]
        |     |     +-> loadSessionSummaries(ctx) 三级降级      [src/routes.ts:289]
        |     |     +-> sessionPersistence.list({signal})      [src/routes.ts:396]
        |     |           异常 -> snapshots = []  (只留实时会话)
        |     +-> ledger.read()  异常 -> 空台账 {version:1,projects:{},sessions:{}}  [src/routes.ts:652-656]
        |     +-> 候选路径 = 工作区路径 ∪ 台账 mainPath          [src/routes.ts:660-665]
        |     +-> scanRepos(候选, now, signal)  TTL 30s 缓存    [src/routes.ts:667]
        |     |     单路径 scanRepo 抛错 -> 剔除该缓存项 + 跳过  [src/routes.ts:228-234]
        |     +-> 组装白名单 knownWorktreePaths / knownRepoPaths /
        |     |   mainPathByKnownPath / liveWorkspacePaths /
        |     |   nonMainWorkspacePaths                         [src/routes.ts:693-763]
        |
        +-> sweepDeadWorkspaces(ctx, snapshot)  D18 清扫        [src/routes.ts:795]
        |     for 每个 workspace:
        |       liveWorkspacePaths.has(path)?      -> 保留
        |       !nonMainWorkspacePaths.has(path)?  -> 保留（拿不到正面证据就不动）
        |       否则 registry.delete(id) -> removed[] 或 failed[]（单个失败不中断）
        |     |
        |     +-- 有 removed/failed 时:
        |           重读注册表 -> workspaceSignature 比较（不是比长度，D8）
        |           变了 -> 替换 snapshot.workspaces / archivedSessionIds
        |           removed 非空 -> 从 workspaceByPath 摘掉旧映射
        |           failed 非空  -> ctx.logger?.warn?.(...)      [src/routes.ts:866-876]
        |
        +-> buildProjects(input) + collectUngrouped(input)      [src/routes.ts:889-890]
        |
        +-> updateLedger(snapshot, options, projects)           [src/routes.ts:893]
        |     抛错 -> 吞掉，不影响响应
        |
        +-> return { ok:true, projects, ungrouped,
                     archivedSessionIds, workspaceByPath }
  |
  +-> json(200, payload)                                        [src/routes.ts:1395]
```

### 3.2 扫描缓存的读-算-写

```text
scanRepos(candidates, now, signal)
  |
  for raw of candidates:
    path = normalizePath(raw)
    cached = scanCache.get(path)
    cached 存在 且 now - cached.at < 30_000 且 now >= cached.at?
        cached.repo !== null -> accept(cached.repo, path)
        continue                       （负缓存命中：确认不是 git 仓，直接跳过）
    |
    repo = await scanRepo(path, signal)
        抛错 -> scanCache.delete(path) + continue（缓存安全失效）
    |
    scanCache.set(path, { at: now, repo })
    repo === null -> continue
    accept(repo, path)
    for entry of repo.worktrees:
        worktreePath = normalizePath(entry.path)
        worktreePath === path -> skip
        prior = scanCache.get(worktreePath)
        prior 不存在 或 prior.repo === null -> scanCache.set(worktreePath, { at: now, repo })
  |
  return { repos, pathToCommonDir }
```

缓存键是**扫描入口路径**而非 commonDir，因为要知道 commonDir 就得先跑一次 git
（`src/routes.ts:185-192`）。回填只在目标 worktree 路径「无缓存或缓存为负」时写入，
**不覆盖已有的正缓存**（`src/routes.ts:240-245`）。

## 4. 状态机

**N/A** —— 本文件覆盖的全部函数都是无状态的纯函数式流程（输入 `ctx` + `options`，输出快照 /
载荷），不维护请求间的状态迁移。模块级确有两处跨请求的缓存/单例，但它们只有
「有效 / 过期」这一对二元状态、没有事件驱动的状态迁移，已在 §5 完整描述：
`scanCache`（`src/routes.ts:193`，TTL 判定见 `src/routes.ts:222`）与
`defaultLedger` / `defaultLedgerPromise`（`src/routes.ts:578`、`src/routes.ts:623`）。

## 5. 并发与线程模型

- **执行模型**：Node.js 单线程事件循环，全部函数为 `async`，无 worker 线程、无锁、无共享内存。
- **请求级状态**：每个请求独立调用 `collectSnapshot` 生成自己的 `TreeSnapshot`，
  请求之间**不共享快照**。
- **模块级共享状态 1 —— 扫描缓存**：`const scanCache = new Map<string, ScanCacheEntry>()`
  （`src/routes.ts:193`），值含 `{at, repo}`，`repo === null` 表示负缓存
  （`src/routes.ts:178-183`）。TTL 判定 `now - cached.at < SCAN_CACHE_TTL_MS && now >= cached.at`
  （`src/routes.ts:222`）：
  - 时钟回拨（`now < cached.at`）⇒ 条件为假 ⇒ 视为过期重扫；
  - 单路径扫描抛错时 `scanCache.delete(path)` 并跳过，不影响其余路径（`src/routes.ts:228-234`）；
  - 一个路径扫出的仓会把**它全部 worktree 路径**登记为同一事实，但仅在目标
    「无缓存或缓存为负」时才写入（`src/routes.ts:240-245`）；
  - 并发多个 `/tree` 会同时读写该 Map，每个键的写入是「读-计算-写」的同步段，
    单线程下不会撕裂；代价是并发的首个请求可能各自跑一次 git（缓存尚未写入）。
- **模块级共享状态 2 —— 默认台账单例**：`defaultLedger`（`src/routes.ts:578`）与
  `defaultLedgerPromise`（`src/routes.ts:623`）。`ledgerStore()` 用 Promise 单例保证并发首调
  只解析一次 home；解析期间 `defaultLedger` 仍为 `undefined`，后续调用 await 同一个 Promise。
- **台账写串行化**：`updateLedger` 走 `ledger.update(fn)`（`src/routes.ts:924`），
  而 `createFileLedger().update` 由内部 Promise 链 `enqueue` 串行化，任一时刻只有一次
  「读-改-写」在飞，且单次回调抛错不会毒化后续任务（`src/ledger.ts:256-291`）。
  并发 `/tree` 因此不会互相覆盖台账；但**响应顺序不保证**，每个请求看到的是自己那一刻的读结果。
- **D18 清扫的并发**：`sweepDeadWorkspaces` 对同一死工作区并发调用 `registry.delete(id)`
  是幂等的（对未知 id 是 no-op 并返回 `false`），两种情况都计入 `removed`
  （`src/routes.ts:810-812`）。
- **取消行为**：`AbortSignal` 只通过 `SnapshotOptions.signal` 传入（`src/routes.ts:571-572`），
  向下传到 `controller.list({}, signal)`（`src/routes.ts:298`）、`persistence.list({signal})`
  （`src/routes.ts:396`）、`scanRepos(..., signal)` → `scanRepo(path, signal)`
  （`src/routes.ts:229`）。**HTTP 路由调用 `buildTreePayload(ctx)` / `collectSnapshot(ctx, options)`
  时均未传 signal**（`src/routes.ts:1394`、`src/routes.ts:1453`、`src/routes.ts:1548`、
  `src/routes.ts:1656`），因此**客户端断开不会取消正在跑的 git 子进程**；
  signal 目前只服务于测试与内部调用方。
- **无请求超时**：本层未设置任何超时；`readBody` 只在 `end` / `error` 事件上 resolve
  （`src/routes.ts:1011-1019`），一个既不结束也不报错的连接会让 handler 悬挂。

## 6. 边界条件

| 场景 | 实际行为 | 证据位置 |
|---|---|---|
| `sessionPersistence.list()` 抛错 | `snapshots = []`，退化为「只有实时会话」而非整棵树失败 | `src/routes.ts:397-400` |
| 孤儿会话（无 summary） | `updatedAt` 回退 `header.createdAt`，再回退 `0`，避免 NaN 排序 | `src/routes.ts:428-429` |
| 会话无 `cwd` | 不写该键，由 `buildProjects` 归入未分组（裁定 8） | `src/routes.ts:444-445` |
| `summary.updatedAt` 非有限数字 | `finiteNumber` 判为 `undefined`，回退 `header.createdAt` | `src/routes.ts:256-258`、`src/routes.ts:429` |
| `sessionController.list` 抛错 | 吞掉，降级到 `ctx.sessions`；再失败则空摘要表 | `src/routes.ts:310-312`、`src/routes.ts:372` |
| `ctx.sessions.list` 不是函数也不是对象 | 直接返回已收集的摘要（可能为空 Map） | `src/routes.ts:346-370` |
| `ctx.sessions.list` 是 observable 快照源 | 读 `getSnapshot()` 的 `items` / `byId`，异常吞掉 | `src/routes.ts:356-369` |
| 台账文件损坏 / 版本不符 | `ledger.read()` 返回空台账（`ledger.ts` 内部备份坏文件），响应不受影响 | `src/routes.ts:652-656`、`src/ledger.ts:208-227` |
| 台账写失败 | 被 `try/catch` 吞掉，不影响 `/tree` 响应（PRD R4） | `src/routes.ts:892-896` |
| `ledger.update` 回调返回同一引用 | 跳过写盘（no-op 优化）；`updateLedger` 靠返回新对象 `next` 落盘 | `src/routes.ts:992`、`src/ledger.ts:83-89` |
| 单路径 git 扫描抛错 | 剔除该路径缓存并跳过，其余路径照常 | `src/routes.ts:228-234` |
| 时钟回拨（`now < cached.at`） | 缓存判定为过期，重扫 | `src/routes.ts:222` |
| 路径已解析且确认不是 git 仓 | 写入负缓存（`repo: null`），TTL 内不再跑 git | `src/routes.ts:236-237` |
| 并发 `/tree` 写台账 | `ledger.update` 内部 Promise 链串行化，不互相覆盖 | `src/ledger.ts:256-291` |
| `ledger.update` 某次回调抛错 | `tail` 吞掉该次成败，不会让整条链永久卡死 | `src/ledger.ts:264-271` |
| 并发 D18 清扫同一工作区 | `registry.delete` 幂等，两次都计入 `removed` | `src/routes.ts:810-812` |
| 单个工作区注销失败 | 收集进 `failed[]`，不中断整体；`ctx.logger?.warn?.(...)` 上报 | `src/routes.ts:813-816`、`src/routes.ts:866-876` |
| 清扫后注册表内容未变 | `workspaceSignature` 相等 ⇒ 不替换 `snapshot.workspaces` | `src/routes.ts:853-856` |
| 清扫删 1 条 + 宿主同轮新增 1 条 | 签名不等 ⇒ 替换为新表（D8：不能用长度判断） | `src/routes.ts:849-856` |
| 清扫成功但注册表内容未变 | 仍从 `workspaceByPath` 摘掉被删 id 的映射（脏数据） | `src/routes.ts:857-865` |
| `registry.delete` 不是函数 | `sweepDeadWorkspaces` 直接返回空结果 | `src/routes.ts:802` |
| `registry.list()` 抛错（顺序损坏） | 返回已读到的部分，不抛错 | `src/routes.ts:486-488` |
| `archivedSessionIds` 非数组 | 返回 `[]`；数组内非 string 元素被过滤 | `src/routes.ts:494-496` |
| 同路径多个工作区 | `workspaceByPath` 保留先出现的（与宿主持久顺序一致） | `src/routes.ts:673-674` |
| 工作区路径不在任何已扫描仓内 | 兜底循环比对 `repo.mainPath` 与各 worktree 路径 | `src/routes.ts:680-690` |
| 已注册工作区不是 git 仓 | 补进 `knownWorktreePaths` / `knownRepoPaths`，`mainPath` 取自身 | `src/routes.ts:728-738` |
| 工作区目录已被删 | 不进 `liveWorkspacePaths`；有正面证据则被 D18 注销 | `src/routes.ts:760-763`、`src/routes.ts:804-808` |
| 整个仓目录（含 `.git`）消失 | git 扫不出 worktree ⇒ 无正面证据 ⇒ **不注销**（防静默丢记录） | `src/routes.ts:552-564`、`src/routes.ts:808` |
| 台账记录了 mainPath 但工作区已注销 | mainPath 仍进候选扫描路径，保证 history 桶有归属 | `src/routes.ts:658-665` |
| `dshHomePath` 动态 import 失败 | `resolveLedgerHome()` 返回 `undefined`，退回 `createFileLedger()` 的两级回退 | `src/routes.ts:610-613` |
| 客户端断开 / 取消 | HTTP 层未传 `AbortSignal`，**不会**取消正在跑的 git 子进程 | `src/routes.ts:1394` |
| 连接既不结束也不报错 | 无超时，handler 悬挂 | `src/routes.ts:1007-1021` |

## 7. 代码示例

### 7.1 脱离 HTTP 层直接组装载荷（单测 / 内部调用）

```js
import { createFileLedger } from '../lib/ledger.js'
import { buildTreePayload, collectSnapshot, clearScanCache } from '../lib/routes.js'

// options.ledger / options.now 注入，确保隔离且可固定时间（src/routes.ts:568-575）
const options = { ledger: createFileLedger(tmpHome), now: 1_700_000_000_000 }

const snapshot = await collectSnapshot(ctx, options)
console.log(snapshot.knownWorktreePaths, snapshot.workspaceByPath)

const payload = await buildTreePayload(ctx, options)
console.log(payload.ok, payload.projects.length, payload.ungrouped.length)

clearScanCache() // 目录变化后强制下次重扫（src/routes.ts:196）
```

### 7.2 跳过 `buildProjects` 重算

```js
// precomputed 用于「已有一份树、只想刷新台账/清扫」的场景（src/routes.ts:889）
const again = await buildTreePayload(ctx, options, payload)
```

### 7.3 通过 HTTP 触发（等价路径）

```sh
curl -sS -X POST http://127.0.0.1:43120/dsh-worktree-groups/tree \
  -H 'content-type: application/json' -d '{}' | head -c 400
```

## 8. 已知缺陷与注意事项

1. **`updateLedger` 每次 `/tree` 都刷新 `lastSeenAt`**，因此台账文件 mtime 与内容必然变化
   （`src/routes.ts:952`；`test/routes.test.mjs:41` 明确记录了这一事实对测试隔离守卫的影响）。
2. **`updateLedger` 必须返回新对象**：若原地修改并返回同一引用，会命中
   `ledger.update` 的「同引用 ⇒ 跳过写盘」优化，导致数据静默丢失；当前实现返回新对象 `next`
   （`src/routes.ts:926-930`、`src/routes.ts:992`；陷阱说明见 `src/ledger.ts:83-89`）。
3. **扫描缓存按「入口路径」而非 commonDir 建键**，靠「扫到仓后回填全部 worktree 路径」
   来近似去重（`src/routes.ts:185-192`、`src/routes.ts:240-245`）。若某 worktree 路径
   已有正缓存，回填不会覆盖它，两个入口的缓存理论上可能来自不同时刻的扫描结果。
4. **`ctx.sessions.list` 的形态靠运行时探测**：可能是同步方法、也可能是 observable 快照源，
   两种都试（`src/routes.ts:346-370`）。宿主形态变化时只会静默降级为空摘要表，不会报错 ——
   排查「会话状态不更新」时需注意这条静默路径。
5. **`pendingInteraction` / `completed` 在 HTTP 面拿不到值**：`toSessionRow` 会读
   `summary?.pendingInteraction` 与 `summary?.completed`（`src/routes.ts:435-436`），
   但宿主 `SessionSummary` 的真实字段集里**没有**这两个字段，因此生产环境恒为 `undefined`；
   琥珀态与绿勾由客户端 `src/sidebar.tsx` 的 `withLiveState` 覆盖层补齐
   （依据：`test/routes.test.mjs:13-25`）。这两行是「兼容未来宿主字段」的防御性读取。
6. **`loadWorkspaces` 会吞掉 `registry.list()` 的抛错**（宿主顺序损坏时抛
   `references missing workspace`），只返回已读到的部分（`src/routes.ts:486-488`）；
   此时 `workspaceByPath` 可能缺项，进而影响 `worktree-remove` 的 D6 判定。
7. **两级回退链的落点不一致风险**：`resolveLedgerHome()` 优先用 `dshHomePath()`
   （会读 `$DSH_HOME`），而 `ledger.ts` 只查 `defaultDshHome()`
   （= `homedir()/.dsh`，**不读** `$DSH_HOME`）（`src/routes.ts:586-600`）。
   当 `@deepseek-ai/dsh-home-paths` 不可解析时，落点会退回后者，行为不同。
   当前实现刻意保留两级回退（`src/routes.ts:594-596`），是否为期望行为**未确认**。
8. **HTTP 层无取消、无超时**：路由不传 `AbortSignal`，`readBody` 也无超时
   （`src/routes.ts:1394`、`src/routes.ts:1007-1021`）；长耗时 git 扫描只能等宿主 socket
   层面断开。

## 9. 相关文档

- [Routes技术文档.md](./Routes技术文档.md) —— 父文档：概览 + 子文档索引
- [Routes-路由注册与契约技术文档.md](./Routes-路由注册与契约技术文档.md) —— 姊妹文档：路由注册与 5 个端点契约
- [Routes-路径校验与安全边界技术文档.md](./Routes-路径校验与安全边界技术文档.md) —— 姊妹文档：路径校验、白名单与 git 参数安全
- [ServerHost 模块技术文档](../l2-modules/ServerHost模块技术文档.md) —— L2 宿主服务契约层（本文件的宿主依赖来源）
- [Ledger 技术文档](./Ledger技术文档.md) —— `src/ledger.ts` 台账持久化（`updateLedger` 的下游）
- [Projects 技术文档](./Projects技术文档.md) —— `src/projects.ts` 项目合成（`buildProjects` / `collectUngrouped`）
- [worktree-groups 知识库总览](../l1-architecture/worktree-groups-knowledge-base.md) —— L1 架构总览与分层索引
