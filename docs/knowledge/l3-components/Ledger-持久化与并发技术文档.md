---
生成时间: 2026-09-22
更新时间: 2026-09-22
git-version: 9bd94252dd934c2fa8491977285e461b703f0f3e
git-module-path: src
level: L3
---

# Ledger 持久化与并发

> **文件路径**: `src/ledger.ts`　|　**上级概览**: [Ledger技术文档.md](./Ledger技术文档.md)　|　**姊妹篇**: [Ledger-数据模型与接口技术文档.md](./Ledger-数据模型与接口技术文档.md)

本子文档覆盖 `src/ledger.ts`（292 行，`git-version` 9bd9425）的**执行流程、状态机、并发模型、边界条件与已知缺陷**。签名与数据结构见姊妹篇。

## 目录

- [1. 执行流程](#1-执行流程)
- [2. 状态机](#2-状态机)
- [3. 并发与线程模型](#3-并发与线程模型)
- [4. 边界条件](#4-边界条件)
- [5. 已知缺陷与注意事项](#5-已知缺陷与注意事项)

## 1. 执行流程

### 1.1 读流程（`read()` → `readFromDisk()`）

```text
read()
  |
  v
enqueue(readFromDisk)              [src/ledger.ts:274-276, :264-271]
  |  挂到 Promise 链尾 tail，等待前序任务完成
  v
ledgerFile()                       [src/ledger.ts:158-164]
  |-- cachedFile 已缓存? --是--> 复用
  |-- 否 --> explicitHome 已给? --是--> join(home, "worktree-groups.json")
  |                        --否--> resolveDefaultHome()  [src/ledger.ts:109-124]
  |                                 |-- 动态 import dsh-home-paths OK --> defaultDshHome()
  |                                 |-- 失败 --> $DSH_HOME 非空?
  |                                 |              --是--> 用它
  |                                 |              --否--> join(homedir(), ".dsh")
  |                                 v
  |                              缓存到 cachedFile
  |  解析抛错 ----------> return emptyLedger()   [src/ledger.ts:194-198]
  v
readFile(file, "utf8")             [src/ledger.ts:202]
  |  ENOENT / 任何 fs 错误 ------> return emptyLedger()  (不备份) [src/ledger.ts:203-206]
  v
JSON.parse(raw)                    [src/ledger.ts:210]
  |  解析失败 -------------------> backupCorrupt(file) --> return emptyLedger()
  |                                [src/ledger.ts:211-215]
  v
isLedgerShape(parsed)?             [src/ledger.ts:135-139, :217]
  |  否（非普通对象 / version!==1 / projects 或 sessions 非普通对象）
  |-------------------------------> backupCorrupt(file) --> return emptyLedger()
  |                                [src/ledger.ts:217-221]
  v
组装新对象：emptyLedger() 后挂上 parsed.projects / parsed.sessions
                                   [src/ledger.ts:223-226]
  v
return 全新 LedgerData（与磁盘内容不共享引用）
```

`backupCorrupt()` 子流程（`src/ledger.ts:170-187`）：以 `Date.now()` 为戳，候选名依次为 `<file>.bad-<ts>`、`<file>.bad-<ts>-1`、…、`-99`（最多 100 次尝试，`src/ledger.ts:172`）。每次先 `access(target)` 探测名字是否被占用（占用则 `continue` 换后缀），再 `rename(file, target)`；备份失败静默忽略（`src/ledger.ts:182-184`）。

### 1.2 写流程（`write()` → `writeToDisk()`）

```text
write(data)
  |
  v
enqueue(() => writeToDisk(data))   [src/ledger.ts:278-280]
  v
ledgerFile()  --> file            [src/ledger.ts:233]
  v
mkdir(dirname(file), {recursive:true})   目录不存在则自动创建 [src/ledger.ts:236]
  v
open(`${file}.tmp`, "w", 0o600)  --> handle   [src/ledger.ts:237]
  v
handle.writeFile(JSON.stringify(data,null,2) + "\n", "utf8")  [src/ledger.ts:239]
  |
  |-- 循环引用等 --> JSON.stringify 抛 TypeError
  v
handle.sync()   <-- fsync，落盘元数据 + 数据  [src/ledger.ts:240]
  v
finally: handle.close()            [src/ledger.ts:241-243]
  v
rename(tmp, file)   同目录 rename = 原子替换  [src/ledger.ts:244]
  v
成功 return
  |
  +-- 任一环节抛错 --> catch: unlink(tmp) 尽力清理 --> rethrow  [src/ledger.ts:245-253]
```

### 1.3 更新流程（`update()`，读-改-写 + 冲突分支）

```text
update(fn)
  |
  v
enqueue(async () => { ... })       [src/ledger.ts:283]
  v
current = await readFromDisk()     [src/ledger.ts:284]
  |  注意：串行链保证此处读到的是前一次写盘后的最新状态
  v
next = fn(current)                 [src/ledger.ts:285]
  |
  |-- fn 抛错 --------------------> 原样上抛，不写盘，tail 吞掉失败
  v
next === current ?                  [src/ledger.ts:286]
  |
  |-- 是（同一引用 / no-op）------> return current（跳过写盘）
  |                                  磁盘不变，无 .tmp 产生
  v
否（新引用）
  v
await writeToDisk(next)            [src/ledger.ts:287]
  |-- 写盘失败 -------------------> 上抛；旧文件因原子写保持完好
  v
return next                        [src/ledger.ts:288]
```

**冲突分支的实质**：本模块没有乐观锁 / 版本号比较，冲突消解完全依赖 `enqueue()` 的 FIFO 串行链。5 个并发 `update()` 会依次排队，每个都读到前一个的结果，因此**不丢更新**（`test/ledger.test.mjs:173-194`）。代价是**跨进程无保护**（见 [§4](#4-边界条件)）。

## 2. 状态机

台账条目（`LedgerWorktree`）的生命周期由 `src/routes.ts:939-964` 的 `updateLedger()` 驱动。`ledger.ts` 只做持久化，不定义状态转移规则；下列转移条件均取自 `src/routes.ts` 的写入逻辑，已在源码中逐条定位。

### 2.1 ASCII 流转图

```text
                          [不存在]
                              |
                              | 首次被 git 列表看到（prior === undefined）
                              | routes.ts:942-950
                              |   firstSeenAt = lastSeenAt = now
                              |   exists === false 时同时置 goneAt = now
                              v
     +------------------> [ACTIVE] <------------------+
     |                 firstSeenAt, lastSeenAt         |
     |                 goneAt === undefined            |
     |                      |                          |
     |                      | 再次被看到且 exists===true |
     |                      | routes.ts:952-954         |
     |                      |   lastSeenAt = now        |
     |                      |   delete patched.goneAt   |
     |                      | （自环：刷新时间戳）        |
     |                      +--------------------------+
     |                      |
     |                      | 再次被看到但 exists === false
     |                      | routes.ts:955
     |                      |   patched.goneAt ??= now
     |                      v
     |                   [GONE]
     |             firstSeenAt, lastSeenAt, goneAt
     |                      |
     +----------------------+
        目录被重建，git 再次扫到该路径且 exists === true
        routes.ts:954  delete patched.goneAt
```

补充说明：**本模块没有删除分支**。`updateLedger()` 只做「新增 / 刷新 / 标记消失」，不会从 `worktrees` 表里移除条目（`src/routes.ts:939-964` 全程无 `delete worktrees[...]`），因此不存在 `[GONE] → [不存在]` 的转移。`[不存在] → [GONE]` 的直达转移存在（首次看到时目录就已消失，`src/routes.ts:947`）。

### 2.2 状态参考表

| 状态 | 含义 | 转入条件 | 转出条件 |
|---|---|---|---|
| `不存在` | `worktrees[path]` 无该键，台账不知道这个 worktree | 初始态；或 `updateLedger` 尚未见过该路径 | 首次被 git 列表扫到（`prior === undefined`）⇒ 建条目，转 `ACTIVE`（`exists === true`）或 `GONE`（`exists === false`） |
| `ACTIVE` | 最近一次 git 扫描确认该 worktree 目录存在；`goneAt === undefined` | 新建时 `entry.exists === true`（`src/routes.ts:943-948`，`goneAt` 被 `...(entry.exists ? {} : { goneAt: now })` 省略）；或从 `GONE` 因 `exists === true` 清除 `goneAt`（`src/routes.ts:954`） | 再次被看到且 `entry.exists === false` ⇒ `patched.goneAt ??= now`，转 `GONE`（`src/routes.ts:955`）；或维持 `ACTIVE` 仅刷新 `lastSeenAt`（自环，`src/routes.ts:952`） |
| `GONE` | 曾被记录且首次被发现已消失；`goneAt` 有值，且 `goneAt >= lastSeenAt` | 新建时 `entry.exists === false`（`src/routes.ts:947`）；或 `ACTIVE` 条目在 `exists === false` 时 `goneAt ??= now`（`src/routes.ts:955`） | 目录被重建、git 再次扫到且 `exists === true` ⇒ `delete patched.goneAt`，回 `ACTIVE`（`src/routes.ts:954`） |
| `终态` | N/A | N/A | N/A —— **本模块不存在终态**：`updateLedger` 从不删除 `worktrees` 条目，`GONE` 条目会一直保留在台账里 |

**写盘触发条件**（决定状态变更是否真正落到磁盘）：`changed` 标志只在下列情形置 `true`（`src/routes.ts:949`、`:962`、`:969`、`:971`、`:987`）：

- 新建了某个 worktree 条目；
- 已有条目的 `lastSeenAt` / `branch` / `goneAt` 三者任一发生变化；
- 新建了 project 记录，或其 `mainPath` 变化；
- 登记了新的 session 归属（且该 session 之前的归属与当前不同）。

`changed === false` 时 `update()` 回调返回 `current` 同一引用，命中 no-op 优化，**不写盘**（`src/routes.ts:992`）。

### 2.3 会话归属快照的状态（`LedgerSessionOwner`）

| 状态 | 含义 | 转入条件 | 转出条件 |
|---|---|---|---|
| `未登记` | `sessions[sessionId]` 无该键 | 初始态 | 会话被归到某个 `exists === true` 的 worktree 节点下 ⇒ 写入 `{ projectKey, worktreePath }`（`src/routes.ts:981-988`） |
| `已登记` | 有归属快照，可在目录消失后把会话归位 | 会话归到活 worktree（`node.exists` 为真） | **无转出**：history 桶里的会话保留台账原值（`src/routes.ts:975-976`），不会被清空或改写 |

## 3. 并发与线程模型

**运行时前提**：Node.js 单线程事件循环，`src/ledger.ts` 内**不使用任何 Worker / `worker_threads` / 多线程原语**。所谓「并发」指同一进程内多个 `Promise` 交错，而非真正的多线程；因此不存在数据竞争式的内存撕裂，只存在「异步 IO 交错导致丢更新」的风险，而该风险由 `enqueue()` 消除。

### 3.1 串行链 `enqueue()`

```ts
// src/ledger.ts:256-271
let tail: Promise<void> = Promise.resolve()

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const result = tail.then(task, task)   // 前序无论成败都继续
  tail = result.then(
    () => undefined,
    () => undefined,                     // 吞掉本次成败，链不毒化
  )
  return result
}
```

- **任一时刻只有一次任务在飞**：`read()` / `write()` / `update()` 全部经 `enqueue`，FIFO 排队（`src/ledger.ts:274-291`）。
- **返回值是本次任务自己的结果**，不复用共享变量（`src/ledger.ts:261`）。
- **失败不毒化链**：`tail` 用两个恒 resolve 的 handler 吞掉成败（`src/ledger.ts:266-269`），某次回调抛错不会让整条链永久卡死（`src/ledger.ts:262`）。已由 `test/ledger.test.mjs:207-236` 验证。
- **读也走同一条链**：5 个并发 `read()` 依次执行，结果一致（`test/ledger.test.mjs:196-205`）。这意味着**读会排在写后面**，读到的总是链上最新的已落盘状态。

### 3.2 内存缓存与磁盘一致性

| 关注点 | 事实 | 位置 |
|---|---|---|
| 数据缓存 | **没有内存数据缓存**。每次 `read()` / `update()` 都从磁盘重读全量文件 | `src/ledger.ts:192-227`（`readFromDisk` 无 memo） |
| 路径缓存 | 只有 `cachedFile`（台账文件绝对路径），缓存的是路径不是数据；首次解析后固定 | `src/ledger.ts:156`、`:159-163` |
| 一致性边界 | 一次 `update()` = 一次「读-改-写」事务；链保证事务串行，故同进程内不会出现「A 的读基于 B 写之前、A 的写覆盖 B 的结果」 | `src/ledger.ts:283-289` |
| 原子性边界 | `rename(tmp, file)` 同目录替换是原子的：读者要么看到旧全文，要么看到新全文，不会看到半截 | `src/ledger.ts:244`；`test/ledger.test.mjs:238-267` |
| 持久性边界 | `handle.sync()` 在 `rename` **之前**执行，保证 tmp 内容已 fsync 后才替换 | `src/ledger.ts:240`、`:244` |
| 跨进程一致性 | **无锁、无版本校验**。两个进程各自持有 `createFileLedger()` 实例并发 `update()` 时，后写者会覆盖先写者（丢失更新） | 见 [§4](#4-边界条件)「并发写（跨进程）」 |

### 3.3 取消行为

**N/A** —— `src/ledger.ts` 未实现任何取消机制：`LedgerStore` 接口（`src/ledger.ts:76-92`）的三个方法均不接受 `AbortSignal`，模块内不检查 `signal.aborted`，`enqueue()` 也没有「出队前检查取消」的逻辑。原因是台账读-改-写是短时、必须完整的事务，中途取消会留下未定义状态。对比：`src/routes.ts` 的 `SnapshotOptions` 提供了 `signal?: AbortSignal`（`src/routes.ts:571-572`），取消语义在**编排层**处理，不在本层。已入队但未执行的任务无法被撤回，调用方只能忽略其结果。

## 4. 边界条件

| 场景 | 触发路径 | 行为 | 是否抛错 | 证据位置 |
|---|---|---|---|---|
| 文件不存在（首次使用） | `readFile` 抛 `ENOENT` | 返回 `emptyLedger()`；**不创建任何文件**、不预建目录 | 否 | `src/ledger.ts:203-206`；`test/ledger.test.mjs:57-70` |
| homeDir 指向不存在的深层目录 | `readFile` 抛 `ENOENT` | `read()` 返回空台账且不顺手建目录；随后的 `write()` 以 `mkdir recursive` 自动建目录并成功落盘 | 否 | `src/ledger.ts:236`；`test/ledger.test.mjs:394-404` |
| JSON 损坏（半截 / 非 JSON） | `JSON.parse` 抛错 | `backupCorrupt(file)` 备份为 `<file>.bad-<ts>`，返回 `emptyLedger()`；原路径不再留坏文件 | 否 | `src/ledger.ts:208-215`；`test/ledger.test.mjs:117-137` |
| `version !== 1`（结构完整但版本不符） | `isLedgerShape` 返回 false | 备份 + 空台账，备份保留原始 `version:2` 内容 | 否 | `src/ledger.ts:137`、`:217-221`；`test/ledger.test.mjs:139-159` |
| 结构缺字段（如缺 `sessions`） | `isLedgerShape` 返回 false | 同上：备份 + 空台账 | 否 | `src/ledger.ts:138`；`test/ledger.test.mjs:161-171` |
| 顶层是数组或 `null` | `isPlainObject` 返回 false | 同上：备份 + 空台账 | 否 | `src/ledger.ts:127-129`、`:136` |
| 同一毫秒内两次损坏读 | `backupCorrupt` 候选名相同 | 第二次探测到名字被占用 ⇒ 自动加 `-1` 后缀；两份备份内容都不丢（最多尝试 100 次） | 否 | `src/ledger.ts:171-186`；`test/ledger.test.mjs:368-392` |
| 备份本身失败（权限等） | `rename` 抛错 | 静默忽略，坏文件留在原地，下次读取会再试一次（宁可丢台账也不能崩宿主） | 否 | `src/ledger.ts:180-184` |
| 并发写（同进程） | 多个 `update()` / `write()` 同时发起 | 经 `enqueue()` FIFO 串行，不丢更新；5 并发 `update` 结果全部存在 | 否 | `src/ledger.ts:264-271`；`test/ledger.test.mjs:173-194` |
| 并发写（跨进程） | 两个进程各持一个 store 实例 | **无保护**：无文件锁、无版本比较，后写者覆盖先写者，丢失更新 | 否（静默） | 未实现；`src/ledger.ts` 全文无 `flock` / 锁文件 / CAS 逻辑（**未确认**是否存在外部约定，源码内无证据） |
| 并发读（同进程） | 多个 `read()` 同时发起 | 走同一条串行链，依次执行，结果一致 | 否 | `test/ledger.test.mjs:196-205` |
| 空台账 | `emptyLedger()` 或文件缺失 | `{ version: 1, projects: {}, sessions: {} }`，是合法状态；`update()` 可正常在其上追加 | 否 | `src/ledger.ts:99-101`；`test/ledger.test.mjs:57-70`、`:326-335` |
| 路径不可写（权限不足 / 只读挂载） | `mkdir` / `open` / `rename` 抛 `EACCES` 等 | **上抛**给调用方；`catch` 中先尽力 `unlink(tmp)` 再 rethrow | 是 | `src/ledger.ts:245-253` |
| 写盘时数据含循环引用 | `JSON.stringify` 抛 `TypeError` | 上抛 `TypeError`（而非静默写坏文件）；tmp 被清理，旧台账文件完好 | 是（`TypeError`） | `src/ledger.ts:239`、`:245-253`；`test/ledger.test.mjs:238-267` |
| `update()` 回调抛错 | 回调内 `throw` | 原样上抛给调用方；不写盘；链未毒化，紧随的 `update()` 仍成功 | 是（回调的错误） | `src/ledger.ts:285`；`test/ledger.test.mjs:207-236` |
| `update()` 回调返回同一引用 | `next === current` | 跳过写盘（no-op），目录里不产生任何文件；仍返回数据 | 否 | `src/ledger.ts:286`；`test/ledger.test.mjs:326-335` |
| `update()` 回调**原地改** `data` 并返回同一引用 | 命中 no-op 分支 | **数据静默丢失**（内存看着改了，磁盘没落盘，下次 `read()` 就没了） | 否（静默） | `src/ledger.ts:85-89`；`test/ledger.test.mjs:292-312` 证明 `read()` 每次返回独立副本 |
| `update()` 回调返回 Promise（async 回调） | `next` 是 Promise 对象 | `next !== current` ⇒ 走 `writeToDisk(next)`，序列化出 `{}` 之类错误内容。**实现未做类型/运行时校验** | 否（静默写坏） | 未防护；`src/ledger.ts:285-287`（**未确认**是否有调用方这么用：`src/routes.ts:924` 的回调是同步函数） |
| 读取返回值的就地修改 | 调用方改 `read()` 的返回值 | 不影响 store，再读仍是磁盘原值 | 否 | `test/ledger.test.mjs:292-312` |
| `@deepseek-ai/dsh-home-paths` 不可解析 | 动态 import 抛错 | 静默走 `$DSH_HOME` → `~/.dsh` 回退链 | 否 | `src/ledger.ts:118-123` |
| `$DSH_HOME` 为空串 / 纯空白 | `trim().length === 0` | 跳过该级，回退 `join(homedir(), '.dsh')` | 否 | `src/ledger.ts:121-123` |
| `defaultDshHome()` 返回非字符串或空串 | 类型/长度校验不通过 | 视为不可用，继续回退链 | 否 | `src/ledger.ts:114-117` |
| 文件权限 | 新建 tmp 时 `open(tmp, 'w', 0o600)` | 最终台账文件权限为 `0o600` | 否 | `src/ledger.ts:237`；`test/ledger.test.mjs:269-281` |
| tmp 残留 | 写盘失败 | `catch` 中 `unlink(tmp)` 尽力清理；成功路径经 `rename` 后 tmp 自然消失 | 否（清理失败也忽略） | `src/ledger.ts:246-251`；`test/ledger.test.mjs:230-235`、`:261-266` |

## 5. 已知缺陷与注意事项

1. **同引用 no-op 陷阱（高优先级）**。`update()` 回调原地修改 `data` 并返回同一引用会导致**数据静默丢失**，无任何报错。源码在 `LedgerStore.update` 的 JSDoc 里用 ⚠️ 显式标注（`src/ledger.ts:85-89`），并在 `src/ledger.ts:88-89` 点名 `src/routes.ts` 的 `updateLedger` 是靠返回新引用 `next` 才落盘。**约束：所有 `update()` 调用方必须返回新对象。**
2. **跨进程无并发保护**。`enqueue()` 只覆盖单进程内。多个进程（例如两个 DSH 宿主实例）各自持有 store 并发 `update()` 时，无文件锁、无版本号比较，后写者覆盖先写者。源码中无任何缓解措施；`docs/INTERFACES.md:231-234` 的实现要求也只约束了单进程串行化。
3. **`update()` 不接受 async 回调且无运行时校验**。`const next = fn(current)`（`src/ledger.ts:285`）对返回 Promise 的回调不做检测，`next !== current` 会成立并把 Promise 当数据写盘。当前唯一生产调用方 `src/routes.ts:924` 用的是同步回调，暂无实际影响，但属于易踩的接口陷阱。
4. **`read()` 有写副作用**。损坏文件的备份是一次 `rename`（`src/ledger.ts:181`），所以「只读」的 `read()` 在坏文件场景下会改动磁盘。备份失败时坏文件留在原地（`src/ledger.ts:182-184`），下次读会再试一次，可能在目录里反复尝试。
5. **`backupCorrupt` 最多尝试 100 个名字**。`for (let attempt = 0; attempt < 100; ...)`（`src/ledger.ts:172`）耗尽后直接 `return`，坏文件留在原地且**不再备份**，调用方仍拿到空台账 —— 即坏内容会被静默忽略。
6. **`emptyLedger()` 返回的 `version` 类型被窄化为字面量 `1`**。`LedgerData.version: 1`（`src/ledger.ts:69`）是字面量类型，`src/routes.ts:655` 在 catch 分支里手写 `{ version: 1, projects: {}, sessions: {} }` 而非调用 `emptyLedger()`，两处结构重复，未来升版本时需同步修改（`src/routes.ts:655`、`src/routes.ts:927`）。
7. **home 解析存在两级实现**。`ledger.ts` 的 `resolveDefaultHome()` 只查 `defaultDshHome()`（不读 `$DSH_HOME`，见 `src/routes.ts:590-591`）；`src/routes.ts:601-614` 的 `resolveLedgerHome()` 补上了优先级更高的 `dshHomePath()`（会读 `$DSH_HOME`）。因此**实际生效的 home 取决于调用方是否传 `homeDir`**：生产路径经 `routes.ts` 组装，会先用 `dshHomePath`；直接调用 `createFileLedger()` 则走 `ledger.ts` 自己的回退链。源码注释说明这是文件所有权（§0）导致的分工，`ledger.ts` 属 T2 不得改动（`src/routes.ts:598-599`）。
8. **`LedgerWorktree.goneAt` 的 `>= lastSeenAt` 不变式由调用方维护**。`ledger.ts` 不校验该关系，只做序列化；`src/routes.ts:952-955` 在 `exists === false` 时用 `??=` 保证 `goneAt` 只在首次消失时设置。
9. **台账只增不减**。`updateLedger()` 不删除 `worktrees` 条目（`src/routes.ts:939-964`），`GONE` 记录会永久保留；`sessions` 表同样无清理路径（history 桶会话保留台账原值，`src/routes.ts:975-976`）。长期使用后文件体积只增不减。
10. **全量覆盖写**。`write()` 是整文件覆盖（`src/ledger.ts:239`），每次 `update()` 都重写整个 JSON。台账规模随项目数与会话数线性增长，写放大与之成正比。

## 相关文档

- [Ledger技术文档.md](./Ledger技术文档.md) —— 本组件概览与导航
- [Ledger-数据模型与接口技术文档.md](./Ledger-数据模型与接口技术文档.md) —— 导出符号、数据结构、方法签名、代码示例
- [ServerHost 模块技术文档](../l2-modules/ServerHost模块技术文档.md) —— L2 模块层：路由注册、宿主上下文与生命周期
- [Routes 技术文档](../l3-components/Routes技术文档.md) —— 台账的唯一生产组装入口与写入方（`src/routes.ts`）
- [worktree-groups 知识库总览](../l1-architecture/worktree-groups-knowledge-base.md) —— L1 架构层：模块划分与数据流全景

> 注：L1 / L2 / Routes 三份文档由其他任务产出，本文件仅按规定链接路径引用，未读取其内容。
