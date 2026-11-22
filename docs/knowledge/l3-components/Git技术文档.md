---
生成时间: 2026-09-22
更新时间: 2026-09-22
git-version: 9bd94252dd934c2fa8491977285e461b703f0f3e
git-module-path: src
level: L3
---

# Git 子进程与 worktree 扫描（`runGit` / `parseWorktreeList` / `scanRepo`）

> **文件路径**: `src/git.ts`

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

`src/git.ts`（336 行）是本插件的 **git 访问底座**：它把 `git` 可执行文件封装成 Promise，把
`git worktree list --porcelain` 的文本输出解析成结构化事实，并对外提供「扫描一个仓 → 得到
仓库身份键 + 主工作树 + 全部 worktree」的唯一入口。上层（`src/routes.ts`、`src/projects.ts`）
不直接调用 `execFile`，全部经本模块。

核心特性：

1. **绝不经 shell**：所有命令一律用 `execFile(bin, args[])` 数组参数形式（`src/git.ts:80-83`），
   不做字符串拼接，从根上消除 shell 注入；调用方（`src/routes.ts:1277-1285`）另行用
   `isSafeGitArg` 挡住前导 `-` 的 git 选项注入。
2. **git 可执行文件多候选探测 + 进程级缓存**：候选序列 `git` → `/usr/bin/git` →
   `/usr/local/bin/git` → `/opt/homebrew/bin/git`（`src/git.ts:14`），裸名优先以兼容
   nvm/asdf 自管 PATH；缓存的是**探测 Promise**（`src/git.ts:22`），并发调用只探测一次，
   失败不缓存以便重试。
3. **统一的路径归一基准**：`normalizePath`（`src/git.ts:126`）是包内所有路径比较的唯一基准
   （绝对化 + 反斜杠转正斜杠 + 去尾斜杠），避免 `/a/b` 与 `/a/b/` 被当成两个 worktree。
4. **中文/非 ASCII 路径安全**：每条命令统一附加 `-c core.quotepath=false`
   （`src/git.ts:82`），否则中文路径会被 git 转义成八进制。
5. **失败分级**：`runGit` 失败即 reject（带 stderr 摘要与 cwd），`runGitSafe` 把任何失败
   折叠为 `null`（`src/git.ts:101-107`），供探测类调用免 try/catch 使用。
6. **取消可传递**：`AbortSignal` 一路透传到 `execFile` 的 `signal` 选项（`src/git.ts:83`），
   调用方取消即中断子进程。

## 构造参数与依赖

本模块**无类、无构造器**，只有模块级常量与函数。

### 导出符号（7 个）

| 符号 | 类型 | 行号 |
| --- | --- | --- |
| `runGit` | `async function` | `src/git.ts:76` |
| `runGitSafe` | `async function` | `src/git.ts:101` |
| `normalizePath` | `function` | `src/git.ts:126` |
| `parseWorktreeList` | `function` | `src/git.ts:169` |
| `resolveCommonDir` | `async function` | `src/git.ts:230` |
| `resolveToplevel` | `async function` | `src/git.ts:248` |
| `scanRepo` | `async function` | `src/git.ts:290` |

### 非导出内部符号

| 符号 | 类型 | 行号 | 说明 |
| --- | --- | --- | --- |
| `MAX_BUFFER` | `const` = `8 * 1024 * 1024` | `src/git.ts:8` | 子进程 stdout 上限 8 MiB |
| `GIT_CANDIDATES` | `const readonly tuple` | `src/git.ts:14` | git 可执行文件候选列表 |
| `gitBinPromise` | `let Promise<string> \| undefined` | `src/git.ts:22` | 模块级探测缓存 |
| `isAborted` | `function` | `src/git.ts:31` | 判断 signal 是否已取消 |
| `probeGitBin` | `function` | `src/git.ts:36` | 试跑 `<bin> --version` |
| `resolveGitBin` | `function` | `src/git.ts:50` | 解析 git 路径（带缓存） |
| `pathExists` | `async function` | `src/git.ts:110` | `fs.stat` 判定存在性 |
| `PendingWorktree` | `interface` | `src/git.ts:136` | 解析中间态条目 |

### 依赖的 node 内置模块

| 模块 | 导入符号 | 行号 | 用途 |
| --- | --- | --- | --- |
| `node:child_process` | `execFile` | `src/git.ts:1` | 执行 git 子进程 |
| `node:fs/promises` | `stat` | `src/git.ts:2` | worktree 目录存在性探测 |
| `node:path` | `resolve` | `src/git.ts:3` | 路径绝对化 |

类型依赖：`import type { RepoInfo, WorktreeEntry } from './types.js'`（`src/git.ts:5`），
定义见 `src/types.ts:9`（`WorktreeEntry`）与 `src/types.ts:25`（`RepoInfo`）。
无第三方依赖（`package.json` 的 `dependencies` 为空对象，`peerDependencies` 仅有
`@deepseek-ai/cordis`，本模块不引用）。

### 被谁调用

| 调用方 | 使用的符号 | 调用点 |
| --- | --- | --- |
| `src/routes.ts` | `normalizePath`, `runGit`, `scanRepo` | 导入于 `src/routes.ts:32`；`scanRepo` 于 `src/routes.ts:229`；`runGit` 于 `src/routes.ts:1290`、`src/routes.ts:1294`、`src/routes.ts:1600`；`normalizePath` 遍布 `src/routes.ts`（如 `:220`、`:241`、`:465`、`:1054`） |
| `src/projects.ts` | `normalizePath`（导入后原样再导出） | 导入于 `src/projects.ts:3`，再导出于 `src/projects.ts:21`；使用于 `src/projects.ts:42-43`、`:128`、`:136`、`:142`、`:147` |
| `test/git.test.mjs` | `normalizePath`, `parseWorktreeList`, `resolveToplevel`, `scanRepo` | 导入于 `test/git.test.mjs:36`（经构建产物 `../lib/git.js`） |

`runGitSafe`、`resolveCommonDir` **仅在本模块内部使用**（`src/git.ts:231`、`:301`），
虽为导出符号，但当前仓内无跨文件调用者。

## 核心方法签名

### `runGit`

```ts
export async function runGit(cwd: string, args: string[], signal?: AbortSignal): Promise<string>
```
（`src/git.ts:76`）

- `cwd`：子进程工作目录。合法取值：任意存在的目录路径；**不做校验**，路径不存在时由 git
  自身失败并经 reject 暴露。
- `args`：git 参数数组，**不含** `git` 本身，也**不含**模块自动注入的
  `-c core.quotepath=false`。合法取值：任意字符串数组；元素允许含空格、中文、`/`（数组传参
  不经 shell，无需转义）。空数组合法（等价于 `git -c core.quotepath=false`）。
- `signal`：可选 `AbortSignal`。
- 返回值：`stdout.trim()`，即已去掉首尾空白（含尾换行）的字符串。**空输出返回 `''`**，
  不返回 `null`。
- 抛错条件：
  1. `resolveGitBin()` 失败（四个候选全部探测失败，`src/git.ts:56`）；
  2. 调用时 `signal.aborted === true`，抛 `` new Error(`git ${args.join(' ')} 已取消`) ``
     （`src/git.ts:78`）；
  3. 子进程 `error !== null`（非零退出码、被 signal 中断、`maxBuffer` 溢出等），
     抛 `` new Error(`git ${args.join(' ')} 失败（cwd=${cwd}）：${reason}`) ``，
     其中 `reason = stderr.trim() === '' ? error.message : stderr.trim()`（`src/git.ts:85-88`）。

### `runGitSafe`

```ts
export async function runGitSafe(cwd: string, args: string[], signal?: AbortSignal): Promise<string | null>
```
（`src/git.ts:101`）

参数含义与 `runGit` 完全一致。返回值：成功时同 `runGit` 的 `stdout.trim()`；**任何**异常
（含 git 缺失、非 git 仓、被取消、非零退出码）一律返回 `null`（`src/git.ts:104-106`）。
不抛错。

### `normalizePath`

```ts
export function normalizePath(p: string): string
```
（`src/git.ts:126`）

- `p`：待归一化路径。合法取值：任意字符串（相对路径按 `process.cwd()` 展开）。
- 返回值：`path.resolve(p)` 后把 `\` 替换为 `/`、去掉尾部 `/` 的字符串。
  两个例外（`src/git.ts:128-129`）：长度 ≤ 1 的路径原样返回（文件系统根 `/`）；
  匹配 `/^[A-Za-z]:\/$/` 的 Windows 盘根保留其唯一斜杠。
- 抛错条件：`p` 非字符串时由 `path.resolve` 抛出 `TypeError`；其余不抛错。

### `parseWorktreeList`

```ts
export function parseWorktreeList(porcelain: string): WorktreeEntry[]
```
（`src/git.ts:169`）

- `porcelain`：`git worktree list --porcelain` 的原始 stdout。合法取值：任意字符串，
  条目之间以空行分隔；`\r\n` 行尾被逐行剥离（`src/git.ts:188`）。
- 返回值：`WorktreeEntry[]`（`src/types.ts:9`）。解析规则（`src/git.ts:197-217`）：
  `worktree <path>` 开新条目；`HEAD <sha>` ⇒ `head`；`branch refs/heads/X` ⇒ `branch: 'X'`
  （只截 `refs/heads/` 前缀，**保留分支名内部斜杠**，如 `feature/ohos`）；
  `detached` ⇒ 最终 `branch: undefined`（`src/git.ts:179`）；`bare` ⇒ `bare: true`；
  未知行（如 `locked`、`prunable`）跳过。**第一个条目 `isMain: true`**，其余 `false`
  （`src/git.ts:181`）。`exists` 一律乐观置 `true`（`src/git.ts:183`），真实存在性由
  `scanRepo` 用 `fs.stat` 覆盖。
- 抛错条件：无（纯函数，不抛错）。空字符串或全空白输入返回 `[]`。

### `resolveCommonDir`

```ts
export async function resolveCommonDir(repoPath: string, signal?: AbortSignal): Promise<string | null>
```
（`src/git.ts:230`）

执行 `git -c core.quotepath=false rev-parse --git-common-dir`。返回 `normalizePath(resolve(repoPath, raw))`
（`src/git.ts:234`）；`raw` 为 `null` 或 `''` 时返回 `null`（非 git 仓）。
关键坑：该命令对主工作树通常只回相对路径 `.git`，必须相对 `repoPath` 再 resolve 才能当
仓库身份键。不抛错。

### `resolveToplevel`

```ts
export async function resolveToplevel(repoPath: string, signal?: AbortSignal): Promise<string | null>
```
（`src/git.ts:248`）

执行 `git rev-parse --show-toplevel`，返回 `normalizePath(raw)`；失败或空输出返回 `null`。
**⚠️ 陷阱**：在 linked worktree 里执行得到的是**该 worktree 自己**的路径，不是主树
（源码注释 `src/git.ts:240-246`；回归用例 `test/git.test.mjs:122-132` 钉死了该行为）。
因此**不能**用它求主工作树路径。不抛错。

### `scanRepo`

```ts
export async function scanRepo(repoPath: string, signal?: AbortSignal): Promise<RepoInfo | null>
```
（`src/git.ts:290`）

- `repoPath`：候选仓入口路径（主树或任一 linked worktree 均可，结果一致）。
- 返回值：`RepoInfo`（`src/types.ts:25`），含 `commonDir`、`mainPath`、`worktrees`
  （保持 git 顺序，主树在首位）。
- 返回 `null` 的条件：`signal` 已取消（`src/git.ts:291`、`:305`）；非 git 仓
  （`resolveCommonDir` 为 `null`，`src/git.ts:294`）；bare 仓（`resolveToplevel` 为 `null`，
  `src/git.ts:299`，回归用例 `test/git.test.mjs:231-241`）。
- 抛错条件：**本函数自身不主动抛错**，但内部 `resolveCommonDir`/`resolveToplevel`/
  `runGitSafe` 都不抛；`pathExists` 吞掉 `fs.stat` 异常。因此实际不会抛错
  （调用方 `src/routes.ts:227-232` 仍保留了 try/catch 兜底）。
- 关键不变量：`mainPath` = 该仓**主工作树**路径，与「从哪个 worktree 扫描」无关，
  取 `parseWorktreeList` 结果里 `isMain: true` 那条的 `path`（`src/git.ts:328-329`）。

## 执行流程

### `runGit` 主流程（含子进程失败/非零退出码分支）

```
runGit(cwd, args, signal)
  │
  ├─ await resolveGitBin()
  │     │
  │     ├─ gitBinPromise 已存在 ──────────────► 直接复用（不重复探测）
  │     │
  │     └─ 未缓存：按 GIT_CANDIDATES 顺序逐个 probeGitBin(bin)
  │            execFile(bin, ['--version'], { windowsHide:true, timeout:10_000 })
  │            │
  │            ├─ error === null ──► 命中，返回该 bin，缓存 Promise
  │            └─ error !== null ──► 试下一个候选
  │                     │
  │                     └─ 四个候选全失败 ──► throw
  │                          "找不到可执行的 git（已尝试 git、/usr/bin/git、
  │                           /usr/local/bin/git、/opt/homebrew/bin/git）"
  │                          （gitBinPromise 被清空为 undefined，下次可重试）
  │
  ├─ isAborted(signal) === true ──► throw "git <args> 已取消"   【提前取消分支】
  │
  └─ new Promise: execFile(bin,
        ['-c', 'core.quotepath=false', ...args],
        { cwd, windowsHide:true, maxBuffer: 8MiB, signal },
        (error, stdout, stderr) => …)
        │
        ├─ error !== null ──► reject                     【失败分支】
        │     reason = stderr.trim() === ''
        │                ? error.message      ← 非零退出码且 stderr 为空
        │                : stderr.trim()      ← 常规非零退出码
        │     Error("git <args> 失败（cwd=<cwd>）：<reason>")
        │
        └─ error === null ──► resolve(stdout.trim())     【成功分支】
                               注意：stderr 非空但退出码为 0 时，
                               stderr 被**静默丢弃**，不进入返回值也不告警
```

### `scanRepo` 主流程（含降级分支）

```
scanRepo(repoPath, signal)
  │
  ├─ isAborted(signal) ──► return null                       【取消分支】
  │
  ├─ resolveCommonDir(repoPath, signal)
  │     git rev-parse --git-common-dir  ──失败/空──► null
  │     │
  │     └─ null ──► return null                              【非 git 仓分支】
  │
  ├─ resolveToplevel(repoPath, signal)   ← 仅作门槛，用于排除 bare 仓
  │     git rev-parse --show-toplevel   ──失败/空──► null
  │     │
  │     └─ null ──► return null                              【bare 仓分支】
  │
  ├─ runGitSafe(repoPath, ['worktree','list','--porcelain'], signal)
  │     │
  │     ├─ null（列表拿不到：元数据损坏 / 被取消）           【降级分支】
  │     │     ├─ isAborted(signal) ──► return null
  │     │     └─ 否则返回单树兜底：
  │     │          { commonDir, mainPath: fallbackMainPath,
  │     │            worktrees: [{ path: fallbackMainPath, isMain:true,
  │     │                            bare:false, exists: await pathExists(...) }] }
  │     │
  │     └─ string
  │           │
  │           ├─ parseWorktreeList(porcelain)
  │           │     │
  │           │     └─ length === 0 ──► 同上「单树兜底」返回   【空列表分支】
  │           │
  │           └─ mainEntry = parsed.find(e => e.isMain)
  │              mainPath  = mainEntry?.path ?? fallbackMainPath
  │              for (entry of parsed):
  │                  worktrees.push({ ...entry, exists: await pathExists(entry.path) })
  │                  ← 逐条 fs.stat，顺序 await（串行）
  │              return { commonDir, mainPath, worktrees }
```

## 状态机

**N/A** —— 原因：本模块是无类、无实例的纯函数集合，不持有任何具有生命周期状态字段的实体；
唯一跨调用存活的状态是模块级探测缓存 `gitBinPromise`（`src/git.ts:22`），它只有
「未探测 → 探测中 → 已缓存 / 探测失败后清空」这一条单线迁移，且已在
[执行流程](#执行流程) 与 [并发与线程模型](#并发与线程模型) 中完整描述，无需另立状态机章节。

## 并发与线程模型

- **进程模型**：Node.js 单线程事件循环 + `execFile` 子进程。每次 git 调用 fork 一个独立子
  进程，主线程在等待回调期间不阻塞。
- **子进程并发**：本模块**不做任何并发限流**。`scanRepo` 内部的 `pathExists` 是
  `for … await` 串行（`src/git.ts:332-334`），但多个 `scanRepo` 调用之间完全并发。
  真实并发度由调用方决定：`src/routes.ts:216` 的 `scanRepos` 也是 `for … await` 串行
  遍历候选路径，但同一次请求内对多个入口的扫描仍可能与其他请求并发。
- **Promise 封装**：`runGit` 用 `new Promise((resolveRun, rejectRun) => execFile(...))`
  包装回调式 API（`src/git.ts:79-93`）；`probeGitBin` 同构，但把 error 折叠为布尔
  （`src/git.ts:36-42`）。
- **探测去重**：`gitBinPromise` 缓存的是 **Promise 而非结果**（`src/git.ts:19-21` 注释），
  因此 N 个并发调用只会真正跑一轮候选探测，其余调用 await 同一个 Promise。
- **失败不缓存**：探测失败时在 `.catch` 里把 `gitBinPromise` 重置为 `undefined`
  （`src/git.ts:58-62`），避免临时故障（PATH 尚未就绪）被永久记忆。
- **超时**：
  - 探测命令 `git --version` 有硬超时 `10_000` ms（`src/git.ts:38`），四个候选全超时
    最坏耗时约 40 s（**这是首次调用的最坏路径**）。
  - 业务命令（`runGit`）**不设 timeout**，只设 `maxBuffer`（`src/git.ts:83`）。
    一条挂死的 git 命令会一直挂到调用方取消为止。
- **取消行为**：
  1. 进入 `runGit` 时若已取消 → 立即抛错，**不启动子进程**（`src/git.ts:78`）；
  2. 子进程运行期间取消 → `signal` 透传给 `execFile`，Node 会终止子进程并以错误 reject；
     `runGit` 将其包装为 `git … 失败（cwd=…）：<reason>`（`src/git.ts:85-88`）；
  3. `scanRepo` 在 `worktree list` 返回 `null` 时再查一次 `isAborted`，把「被取消」与
     「元数据损坏」区分开：前者返回 `null`，后者返回单树降级结果（`src/git.ts:302-313`）。
  - **未确认**：取消时 `error.message` 的精确文本随 Node 版本变化（`AbortError` / 
    `The operation was aborted`），且 `test/git.test.mjs` 未覆盖取消路径，故文档不写死该文本。

## 边界条件

| # | 场景 | 实际行为 | 证据位置 |
| --- | --- | --- | --- |
| 1 | git 不存在（PATH 与三个绝对路径全无） | `resolveGitBin` 抛 `找不到可执行的 git（已尝试 …）`；`runGit` 透传抛出；`runGitSafe` 返回 `null`；`scanRepo` 经 `resolveCommonDir` 返回 `null` | `src/git.ts:53-56`、`:101-107`、`:230-235` |
| 2 | 非零退出码（如非 git 仓、非法 revision） | `error !== null` → reject，消息含 stderr 摘要与 cwd；`runGitSafe` 折叠为 `null` | `src/git.ts:85-88` |
| 3 | 非零退出码且 stderr 为空 | `reason` 退回 `error.message`（如 `Command failed: …`），消息仍带 `cwd=` | `src/git.ts:86` |
| 4 | 退出码 0 但 stderr 非空（git 警告） | **成功**，stderr 被静默丢弃，返回值只有 stdout | `src/git.ts:90` |
| 5 | 超大输出（超过 `MAX_BUFFER` = 8 MiB） | Node 以 `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` 报错 → `runGit` reject（消息为 `error.message`，因 stderr 通常为空）；`runGitSafe` 返回 `null` | `src/git.ts:8`、`:83`、`:85-88` |
| 6 | 路径含空格 | 安全：`execFile` 数组传参不经 shell，无需引号；`git worktree add` 的调用方另用 `--` 分隔（`src/routes.ts:1288-1289`） | `src/git.ts:80-83`、`src/routes.ts:1287-1290` |
| 7 | 路径含中文/非 ASCII | 安全：统一附加 `-c core.quotepath=false`，git 不做八进制转义 | `src/git.ts:82`、`:73-74` 注释 |
| 8 | 路径含 `\`（Windows 风格） | `normalizePath` 统一转 `/`；根 `/` 与盘根 `C:/` 保留唯一斜杠 | `src/git.ts:127-132` |
| 9 | 路径带尾斜杠 / 相对路径 | `normalizePath` 用 `path.resolve` 绝对化并去尾斜杠，保证比较基准唯一 | `src/git.ts:126-133` |
| 10 | 路径为符号链接（如 macOS `/var` → `/private/var`） | **不解析符号链接**：`path.resolve` 只做词法归一，`git` 输出却是 realpath 拼法，两侧可能不相等；测试因此先对 `tmpdir()` 取 `realpath` | `src/git.ts:126`、`test/git.test.mjs:48-60` |
| 11 | `parseWorktreeList` 收到空串 / 全空白 | 返回 `[]`（`flush` 时 `pending === undefined` 直接丢弃） | `src/git.ts:173-176`、`:219` |
| 12 | `parseWorktreeList` 收到 `\r\n` 行尾 | 逐行剥离 `\r` 后再解析，等价于 `\n` | `src/git.ts:188` |
| 13 | porcelain 含未知行（`locked` / `prunable`） | 落入 `default` 分支跳过，前向兼容 | `src/git.ts:215-216` |
| 14 | detached HEAD 条目 | `detached` 行置 `detached: true`，flush 时 `branch` 被强制为 `undefined` | `src/git.ts:179`、`:209-211` |
| 15 | bare 仓 | `rev-parse --show-toplevel` 失败 → `scanRepo` 返回 `null`（门槛未放宽） | `src/git.ts:296-299`、`test/git.test.mjs:237-240` |
| 16 | worktree 目录已被 `rm -rf`（仍留在 git 列表里） | `parseWorktreeList` 乐观给 `exists: true`，`scanRepo` 逐条 `fs.stat` 覆盖为 `false` | `src/git.ts:164-166`、`:331-334` |
| 17 | `git worktree list` 失败但已是 git 仓 | 降级为「只有一个主树」而非整体失败，侧栏仍有工作区行 | `src/git.ts:302-313` |
| 18 | 调用时 `signal` 已取消 | `runGit` 不启动子进程直接抛 `git <args> 已取消`；`scanRepo` 返回 `null` | `src/git.ts:78`、`:291`、`:305` |
| 19 | `resolveCommonDir` 输出为空串 | 返回 `null`（与命令失败同路径处理） | `src/git.ts:232` |
| 20 | 主树 `rev-parse --git-common-dir` 只回相对 `.git` | 用 `resolve(repoPath, raw)` 展开成绝对路径，与 linked worktree 回的绝对路径归一后相等 | `src/git.ts:226-234`、`test/git.test.mjs:149-167` |

## 代码示例

以下示例中的函数名与参数均取自真实源码与真实调用点。

### 1. 直接跑一条 git 命令（真实调用点：`src/routes.ts:1290`）

```ts
import { runGit } from './git.js'

// 对应 src/routes.ts:1287-1290 的建 worktree 分支
const args = ['worktree', 'add', '-b', 'feature/ohos', '--', '/Users/a/repo-ohos']
await runGit('/Users/a/repo', args, signal)
```

### 2. 探测类调用免 try/catch（真实调用点：`src/git.ts:231`、`:249`）

```ts
import { runGitSafe } from './git.js'

const commonDir = await runGitSafe('/Users/a/repo', ['rev-parse', '--git-common-dir'])
// 非 git 仓 / git 缺失 / 被取消 → null，不会抛错
```

### 3. 解析 porcelain 文本（纯函数，可离线测试）

```ts
import { parseWorktreeList } from './git.js'

const entries = parseWorktreeList(`worktree /Users/a/repo
HEAD d6399b7bf0f5ad0854b055bba3a8e75a7feede62
branch refs/heads/develop

worktree /Users/a/repo-ohos
HEAD 914bbe2ffbfb7ebda989a779083227ae6b533d5c
branch refs/heads/feature/ohos
`)
// entries[0].isMain === true,  entries[0].branch === 'develop'
// entries[1].branch === 'feature/ohos'  ← 内部斜杠被保留，只截 refs/heads/
```

### 4. 完整扫描一个仓（真实调用点：`src/routes.ts:229`）

```ts
import { scanRepo } from './git.js'

const repo = await scanRepo('/Users/a/repo-ohos', signal)
// 从 linked worktree 入口扫描，mainPath 仍是主树 /Users/a/repo
if (repo !== null) {
  console.log(repo.commonDir)        // 仓库身份键
  console.log(repo.mainPath)         // 主工作树路径（与入口无关）
  console.log(repo.worktrees[0].isMain) // true，主树在首位
}
```

### 5. 路径归一后再比较（真实调用点：`src/routes.ts:1054`）

```ts
import { normalizePath } from './git.js'

normalizePath('/a/b/')        // '/a/b'
normalizePath('/a/b\\c')      // '/a/b/c'
normalizePath('/')            // '/'      ← 根保留唯一斜杠
```

## 已知缺陷与注意事项

1. **`normalizePath` 不解析符号链接**（`src/git.ts:126-133` 只调 `path.resolve`，是纯词法
   归一）。macOS 上 `/var` 是 `/private/var` 的符号链接，而 `git worktree list` 回的是
   realpath 拼法，两侧字符串可能不相等。测试已在 `test/git.test.mjs:48-60` 用
   `realpath(tmpdir())` 绕过该问题。**影响**：若调用方传入的是符号链接拼法的路径，
   `scanRepo` 的 `worktrees[].path` 与调用方路径可能不匹配。相关讨论见
   `src/routes.ts:541-542`（realpath 与 dsh 工作区路径两种拼法）。
2. **`parseWorktreeList` 的 `exists` 是乐观值**（`src/git.ts:183` 恒为 `true`）。设计上由
   `scanRepo` 覆盖（`src/git.ts:331-334`）；若调用方忘记覆盖，后果是「多显示一个 worktree」
   而非把活着的会话错判进 history 桶——这是刻意的失败方向选择（`src/git.ts:164-166`）。
3. **`runGit` 无超时**（`src/git.ts:83` 只设 `maxBuffer` 与 `signal`）。探测命令有 10 s 超时
   （`src/git.ts:38`），业务命令没有；一条挂死的 git 会一直挂到调用方取消。上层
   `src/routes.ts` 依赖传入的 `signal` 兜底。
4. **首次调用最坏 40 s**：git 缺失时需顺序探测 4 个候选，每个 10 s 超时
   （`src/git.ts:14`、`:38`、`:53-56`）。探测失败不缓存，因此每次都可能重付这个代价。
5. **`gitBinPromise` 是进程级全局状态**：一旦探测成功，整个进程生命周期内都复用该路径；
   git 在进程运行期间被卸载/移动不会触发重新探测。反向地，探测失败会被清空以便重试
   （`src/git.ts:58-62`）。
6. **成功时 stderr 被静默丢弃**（`src/git.ts:90` 只 resolve `stdout.trim()`）。git 的警告
   不会出现在返回值里，也没有日志出口；排障时只能从 `runGit` 的失败消息看到 stderr。
7. **空输出与 `null` 的语义差异**：`runGit` 空输出返回 `''`，`runGitSafe` 只在**抛错**时
   返回 `null`。`resolveCommonDir`/`resolveToplevel` 因此同时判 `null` 与 `''`
   （`src/git.ts:232`、`:250`）。新增调用方时若只判 `null` 会漏掉空输出。
8. **测试覆盖不均**：`test/git.test.mjs:36` 只导入 `normalizePath`、`parseWorktreeList`、
   `resolveToplevel`、`scanRepo` 四个符号。`runGit` 的失败消息格式、`runGitSafe` 的
   `null` 折叠、`resolveCommonDir`、以及**取消（AbortSignal）路径**均无直接单测覆盖；
   本文件中这些行为的描述来自源码阅读，**未通过测试执行确认**。
9. **`isAborted` 包装函数的必要性**（`src/git.ts:24-33`）：刻意不内联
   `signal?.aborted === true`，否则 TypeScript 会把 `aborted` 收窄为 `false`，导致 `await`
   之后再判断时报「无交集」假错误。重构时不要内联掉它。
10. **调用方需自行做参数安全校验**：本模块只保证「不经 shell」，不校验参数是否以 `-` 开头
    （即 git 选项注入）。该职责在上层 `src/routes.ts:1090` 的 `isSafeGitArg`，调用点见
    `src/routes.ts:1277-1285`。

## 相关文档

- [ServerHost 模块技术文档](../l2-modules/ServerHost模块技术文档.md) —— 上层模块视角
- [Projects 技术文档](../l3-components/Projects技术文档.md) —— 消费 `normalizePath` 与
  `RepoInfo` 的项目合成层
- [worktree-groups 知识库总览](../l1-architecture/worktree-groups-knowledge-base.md) ——
  分层索引与阅读顺序
