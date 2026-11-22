---
生成时间: 2026-09-22
更新时间: 2026-09-22
git-version: 9bd94252dd934c2fa8491977285e461b703f0f3e
git-module-path: src
level: L3
---

# buildProjects —— 项目 / worktree 发现与路径归一化

> **文件路径**: `src/projects.ts`

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

`src/projects.ts`（486 行）是插件宿主半边的**纯逻辑合成层**：把「dsh 工作区注册表投影 + git 仓事实 + 归属台账 + 会话快照」四份数据，合成侧栏三级树（项目 → worktree → 会话）。它**不做任何 IO**（`src/projects.ts:283`），磁盘事实全部由上游 `src/git.ts#scanRepo` 与 `src/routes.ts#collectSnapshot` 探测后作为入参传入。

核心特性：

1. **五级归属规则 + 一条平铺规则**：`assignSession` 按固定优先级把每个会话判定到 `worktree` / `history` / `flat` / `ungrouped` 四个桶之一（`src/projects.ts:173-243`）。
2. **「已注册」≠「路径还活着」的显式区分**：规则 2 必须同时校验 `entry.exists`，否则被外部 `rm -rf` 的 worktree 会把会话永久扣在死节点上（`src/projects.ts:166-172`、`src/projects.ts:196-197`）。
3. **路径归一化唯一基准**：模块内所有路径比较前一律过 `normalizePath`，并把它再导出供纯逻辑单测使用（`src/projects.ts:21`、`src/projects.ts:122`）。
4. **确定性输出**：worktree 与会话都有显式 tiebreak 排序，同一输入两次调用结果逐字节一致（`src/projects.ts:83-99`）。
5. **子目录工作区兜底（D-3）**：路径不是任何 worktree 根、但落在某个 worktree 之下时，按最长前缀把 `workspaceId`/`title` 挂到该 worktree，且只填空缺（`src/projects.ts:337-354`）。
6. **纯函数、不改入参**：`buildProjects` 只 `slice()` 后排序，不修改 `input.repos[*].worktrees` 等数组（`src/projects.ts:322`）。

## 构造参数与依赖

本文件无类、无构造函数、无模块级可变状态；「构造参数」即 `buildProjects` / `collectUngrouped` 的入参对象。

### 导出符号

| 符号 | 类型 | 位置 |
| --- | --- | --- |
| `normalizePath` | 再导出的函数 | `src/projects.ts:21`（实现 `src/git.ts:126`） |
| `looksLikeWorktreeOf` | 函数 | `src/projects.ts:41` |
| `BuildProjectsInput` | 接口 | `src/projects.ts:55` |
| `buildProjects` | 函数 | `src/projects.ts:310` |
| `collectUngrouped` | 函数 | `src/projects.ts:467` |

### 内部（不导出）符号

| 符号 | 位置 | 作用 |
| --- | --- | --- |
| `Assignment`（联合类型） | `src/projects.ts:76-80` | 会话归属的中间结论 |
| `compareSessions` | `src/projects.ts:83` | 会话排序比较器 |
| `compareWorktrees` | `src/projects.ts:92` | worktree 排序比较器 |
| `PathIndex` | `src/projects.ts:102-120` | 路径查找表集合 |
| `buildPathIndex` | `src/projects.ts:123` | 建立索引 |
| `assignSession` | `src/projects.ts:173` | 单会话归属判定 |
| `ProjectAccumulator` | `src/projects.ts:246-255` | 项目节点可变累加器 |
| `orderProjectKeys` | `src/projects.ts:262` | 项目键顺序 |

### 依赖

- **`node:path`**：`basename`、`dirname`、`resolve`（`src/projects.ts:1`）。
- **`src/git.ts#normalizePath`**：路径归一化的唯一实现（`src/projects.ts:3`）。其语义为 `path.resolve` 绝对化 + 反斜杠转正斜杠 + 去尾斜杠，文件系统根保留单斜杠（`src/git.ts:126-133`）。
- **类型依赖**：`LedgerData`（`src/ledger.ts:76-81`）、`ProjectNode` / `RepoInfo` / `SessionRow` / `WorkspaceRow` / `WorktreeEntry` / `WorktreeNode`（`src/types.ts:9-81`）。
- **宿主服务依赖：无**。本模块不接触 cordis `Context`、不读配置文件、不发子进程。

### 被谁装配

唯一生产调用点在 `src/routes.ts`：

- `import { buildProjects, collectUngrouped } from './projects.js'`（`src/routes.ts:34`）；
- `buildTreePayload` 内组装 `input` 后调用（`src/routes.ts:880-890`），入参 `liveWorkspacePaths` 来自 `collectSnapshot` 的 `fs.stat` 实测结果（`src/routes.ts:742-763`）；
- 宿主入口 `apply` 位于 `src/index.ts:37`，业务链路为 `index.ts → routes.ts → projects.ts`。

## 核心方法签名

### `normalizePath`

```ts
export { normalizePath } from './git.js'
```

（`src/projects.ts:21`；实现 `export function normalizePath(p: string): string`，`src/git.ts:126`）

- **参数**：`p` —— 任意路径字符串，可含 `..`、反斜杠、尾斜杠。
- **返回值**：绝对化并归一后的 POSIX 风格路径；`/` 与 `C:/` 保留唯一斜杠。
- **抛错**：不抛错；非字符串输入属于类型错误（TS 编译期拦截）。

### `looksLikeWorktreeOf`

```ts
export function looksLikeWorktreeOf(deadPath: string, mainPath: string): boolean
```

（`src/projects.ts:41`）

- **参数**：`deadPath` —— 疑似 worktree 的路径；`mainPath` —— 某仓主工作树路径。
- **返回值**：三条同时成立时为 `true` —— ① `dirname` 相同；② `basename(deadPath)` 以 `basename(mainPath)` 开头且**严格更长**；③ 两者归一化后不相等。任一为空串、或 `basename(mainPath) === ''` 时返回 `false`（`src/projects.ts:44-51`）。
- **抛错**：不抛错。
- **定位**：**启发式**，仅用于把目录已删除的孤儿会话接回某项目的 history 桶；误判不会搬移任何会话文件（`src/projects.ts:38-39`）。

### `BuildProjectsInput`

```ts
export interface BuildProjectsInput {
  workspaces: WorkspaceRow[]
  /** 按 commonDir 索引的仓事实。 */
  repos: Record<string, RepoInfo>
  /** 工作区路径 → commonDir（非 git 工作区不在表里）。 */
  repoByWorkspacePath: Record<string, string>
  ledger: import('./ledger.js').LedgerData
  /** 全部会话（含 cwd 已死的）。 */
  sessions: SessionRow[]
  archivedSessionIds: string[]
  liveWorkspacePaths?: ReadonlySet<string>
}
```

（`src/projects.ts:55-73`）

| 字段 | 含义与合法取值 |
| --- | --- |
| `workspaces` | dsh 工作区注册表投影；**顺序即项目节点顺序**（`src/projects.ts:257-260`）。 |
| `repos` | 键为 `commonDir`（仓库身份键），值为 `RepoInfo`；`worktrees` 主树在首位（`src/types.ts:25-32`）。 |
| `repoByWorkspacePath` | 键为工作区路径（未归一化，函数内部归一）；非 git 工作区**不得**出现在此表。 |
| `ledger` | 台账快照；`sessions[sessionId] = { projectKey, worktreePath }`（`src/ledger.ts:68-74`）。 |
| `sessions` | 全部会话，含 `cwd` 已死的；`cwd` 可为 `undefined`。 |
| `archivedSessionIds` | 归档会话 id，一律排除。 |
| `liveWorkspacePaths` | **可选**。已确认磁盘存在的工作区路径集合（归一化）。`undefined` 时按「全部工作区都活着」处理（向后兼容，`src/projects.ts:65-72`）。 |

### `buildProjects`

```ts
export function buildProjects(input: BuildProjectsInput): { projects: ProjectNode[]; ungrouped: SessionRow[] }
```

（`src/projects.ts:310`）

- **参数**：`input`，见上表。
- **返回值**：`projects` —— 项目节点数组，顺序由 `orderProjectKeys` 决定；`ungrouped` —— 无归属会话，已按 `compareSessions` 排序。
- **抛错**：正常路径下不抛错；`input.repos` 中不存在的键只导致该节点被跳过（`src/projects.ts:319`）。唯一可抛点是 `input` 为 `null`/`undefined`（属性访问）。
- **不变量**：不做 IO、不改入参、同一输入结果确定（`src/projects.ts:283`、`test/projects.test.mjs:749-798` 对应单测）。

### `collectUngrouped`

```ts
export function collectUngrouped(input: BuildProjectsInput, projects: ProjectNode[]): SessionRow[]
```

（`src/projects.ts:467`）

- **参数**：`input` 同 `buildProjects`；`projects` 为**已经合成好**的项目节点数组。
- **返回值**：`input.sessions` 中排除归档、且 `sessionId` 未出现在任何 `worktrees[*].sessions` / `history` / `flatSessions` 的会话，按 `compareSessions` 排序。
- **抛错**：不抛错。
- **设计意图**：不依赖 `buildProjects` 内部中间结果，而是做差集，因此它同时是一次独立交叉校验（`src/projects.ts:460-466`）。

### 内部签名（供定位，非公共契约）

```ts
function compareSessions(a: SessionRow, b: SessionRow): number            // src/projects.ts:83
function compareWorktrees(a: WorktreeEntry, b: WorktreeEntry): number     // src/projects.ts:92
function buildPathIndex(input: BuildProjectsInput): PathIndex             // src/projects.ts:123
function assignSession(session: SessionRow, index: PathIndex, input: BuildProjectsInput): Assignment  // src/projects.ts:173
function orderProjectKeys(input: BuildProjectsInput, index: PathIndex): string[]  // src/projects.ts:262
```

## 执行流程

```text
buildProjects(input)
  |
  +-- buildPathIndex(input)                                  [projects.ts:123]
  |     +-- 遍历 repos[*].worktrees
  |     |     +-- key = normalizePath(entry.path)
  |     |     +-- worktreeByPath 首次出现者胜（重复路径不覆盖）  [projects.ts:129]
  |     |     +-- entry.exists === true -> existingWorktreePaths.add(key)
  |     +-- 遍历 workspaces -> workspaceByPath（首次出现者胜）   [projects.ts:137]
  |     +-- repoByWorkspacePath：键统一过 normalizePath        [projects.ts:141-143]
  |     +-- workspacesByRepo：按 repoKey 分组，保持输入顺序     [projects.ts:145-152]
  |
  +-- archived = new Set(input.archivedSessionIds)            [projects.ts:312]
  |
  +-- 阶段 A：按 orderProjectKeys 建累加器（memo 缓存分支）
  |     orderProjectKeys = workspaces 顺序 -> 再补 repos 排序键  [projects.ts:262-280]
  |     for key of order:
  |       +-- key 以 "ws:" 开头 ?
  |       |     +-- 是 -> 建非 git 累加器（isGit:false, worktrees:[]）  [projects.ts:379-392]
  |       |     |        title = workspace.title || basename(path)
  |       |     +-- 否 -> ensureRepoAccumulator(key)
  |       |              +-- accumulators 命中 ? -> 直接返回（缓存命中分支）[projects.ts:316-317]
  |       |              +-- repos[key] 不存在 ? -> undefined（跳过，不建节点）[projects.ts:319]
  |       |              +-- 未命中：
  |       |                    worktrees = repo.worktrees.slice().sort(compareWorktrees)
  |       |                                 .map(-> WorktreeNode, sessions: [])
  |       |                    workspaceId = workspaceByPath.get(path)?.workspaceId
  |       |                    title = branch ?? basename(path)
  |       |                    子目录工作区回填：最长前缀优先 + 只填空缺  [projects.ts:343-354]
  |       |                    title = 唯一具名工作区名 ?? basename(mainPath)
  |       |                    建 worktreeByPath 反向表 -> accumulators.set(key)
  |
  +-- 阶段 B：单趟遍历会话，逐条归属                     [projects.ts:399-436]
  |     for session of input.sessions:
  |       +-- 归档 ? -> 跳过
  |       +-- assignSession(session, index, input)          [projects.ts:173]
  |       |     +-- cwd 为空/缺失 -> ungrouped
  |       |     +-- 规则 1: worktreeByPath[cwd] 且 entry.exists -> worktree
  |       |     +-- 规则 2: workspaceByPath[cwd] 命中
  |       |     |     +-- 精确 worktree 命中且 exists -> worktree
  |       |     |     +-- 精确命中但 exists:false -> 不返回，落到规则 3/4
  |       |     |     +-- 未精确命中 -> 回退主树（要求主树 exists）
  |       |     |     +-- 无 repoKey -> 规则 2b: liveWorkspacePaths 判定 -> flat
  |       |     +-- 规则 3: ledger.sessions[id] 存在 且 路径非 live 且 repos 有该键 -> history
  |       |     +-- 规则 4: 路径非 live 且 looksLikeWorktreeOf(cwd, repo.mainPath) -> history
  |       |     +-- 规则 5: ungrouped
  |       +-- switch(kind):
  |             worktree -> ensureRepoAccumulator(repoKey).worktreeByPath[path]
  |                        节点缺失 -> ungrouped（绝不静默丢会话）[projects.ts:404-410]
  |             history  -> accumulator.history.push
  |             flat     -> accumulator.flatSessions.push
  |             ungrouped-> ungrouped.push
  |
  +-- 阶段 C：摊平 + 排序                                  [projects.ts:438-457]
        for accumulator of accumulators.values():
          worktrees[*].sessions.sort(compareSessions)
          history.sort(compareSessions); flatSessions.sort(compareSessions)
          -> push ProjectNode
        ungrouped.sort(compareSessions)
        return { projects, ungrouped }
```

**关于「缓存分支」**：`src/projects.ts` 自身**没有**任何跨调用缓存或 IO 缓存（它是纯函数）。图中出现的缓存分支只有两处进程内 memo：

1. `accumulators` Map + `ensureRepoAccumulator` 的命中短路（`src/projects.ts:315-317`）——保证同一 `repoKey` 只建一次节点，且**幂等**；
2. `worktreeByPath` 反向表（`src/projects.ts:373`）——会话落桶时的 O(1) 查找。

模块级的 git 可执行文件探测缓存位于 `src/git.ts:22`（`gitBinPromise`，失败时清空不缓存），属于 Git 组件范围。

## 状态机

**N/A（不适用）**。原因：`src/projects.ts` 是无类、无模块级可变状态的纯函数模块（`src/projects.ts:283`），每次调用从入参重新构建 `accumulators` / `PathIndex`，调用之间不保留任何状态，因此不存在需要刻画的状态迁移。

若把单会话的归属判定视为「状态」，它是**一次性、无回边**的优先级判定链（规则 1 → 2 → 2b → 3 → 4 → 5，`src/projects.ts:179-242`），首个命中的分支即返回，不存在回退到已判定分支的迁移；该结构已在「执行流程」图中展开。

## 并发与线程模型

- **同步纯函数**：`buildProjects`、`collectUngrouped`、`looksLikeWorktreeOf` 全部为同步函数，签名中**没有** `Promise`、`async`、`AbortSignal`（对比 `src/git.ts:76` 的 `runGit(cwd, args, signal?)` 是异步的）。调用方在 `src/routes.ts:889-890` 中直接同步调用，无需 `await`。
- **无线程/Worker**：不创建 worker、不使用 `SharedArrayBuffer`，运行在 Node.js 单线程事件循环中。
- **无共享可变状态**：不存在模块级 `let`/缓存对象，故天然无数据竞争；并发调用（同一 tick 内多次调用）互不影响，其结果只依赖各自入参。
- **入参不可变约定**：函数不修改入参（`src/projects.ts:322` 用 `slice()` 复制后排序；`test/projects.test.mjs:765-798` 有对应单测）。但**调用方仍不得在 `buildProjects` 执行期间并发改写 `input` 指向的对象**——该约定由调用方保证，函数内部不做防御性深拷贝。
- **取消行为**：本模块**不支持取消**，也不感知 `AbortSignal`。取消发生在更上游：`src/git.ts#scanRepo` 被取消时返回 `null`（`src/git.ts:291`、`src/git.ts:305`），`routes.ts` 据此产出一份「无该仓数据」的快照再交给 `buildProjects`。因此本层的「取消」表现为**输入集合变小**（`repos` 缺项 → 节点跳过；`worktree` 缺失 → 会话退化为 `ungrouped`），而不是抛错或中断。
- **重入**：`buildProjects` 可重入且幂等；`collectUngrouped` 依赖传入的 `projects`，若与 `buildProjects` 的入参不同源则结果无意义（约定见 `src/routes.ts:889-890`，两者共用同一 `input`）。

## 边界条件

| 场景 | 输入特征 | 实际行为 | 源码位置 |
| --- | --- | --- | --- |
| 非 git 工作区 | `repoByWorkspacePath` 无该路径 | 建 `isGit:false` 节点，`worktrees:[]`；会话走规则 2b 进 `flatSessions` | `src/projects.ts:206-214`、`src/projects.ts:379-392` |
| 非 git 工作区目录已死 | 同上且 `liveWorkspacePaths` 不含该路径 | **不**平铺，退回 `ungrouped`（非 git 仓没有 history 归位语义） | `src/projects.ts:207-213` |
| `liveWorkspacePaths` 未传 | `undefined` | 按「全部工作区都活着」处理，规则 2b 直接平铺（向后兼容） | `src/projects.ts:210-212` |
| detached HEAD | `WorktreeEntry.branch === undefined` | 节点 `title = basename(path)`；排序用 `path` 作 key 回退 | `src/projects.ts:94-95`、`src/projects.ts:332` |
| worktree 被 `rm -rf` | `entry.exists === false` | 节点**仍产出**（供 UI 显示已关闭），但其 `sessions` 恒为空；会话由规则 3/4 进 `history` | `src/projects.ts:196-197`、`src/projects.ts:304-305` |
| 工作区已注册但目录已死 | 路径在 `workspaceByPath` 中，`exists === false` | 规则 2 **不**返回；注释明确禁止 `\|\| workspace !== undefined` 的短路写法 | `src/projects.ts:217-221` |
| 子目录工作区 | 路径落在某 worktree 之下但非其根 | 按最长前缀挂到该 worktree，且不覆盖已有的精确匹配 `workspaceId` | `src/projects.ts:343-354` |
| 路径含空格 | 如 `/a/b/my repo-feat` | `normalizePath` 不特殊处理空格（原样保留）；git 调用走 `execFile` 数组参数、不经 shell，无分词风险 | `src/git.ts:80-83` |
| 路径含中文 / 非 ASCII | 如 `/a/b/仓-feat` | `git.ts` 统一附加 `-c core.quotepath=false`，避免八进制转义 | `src/git.ts:82` |
| 尾斜杠 / 反斜杠混用 | `/a/b/repo/` 与 `/a/b/repo` | `normalizePath` 归一后视为同一路径 | `src/git.ts:126-133` |
| macOS `/var` 符号链接 | 工作区拼法为 `/var/...`，git 回 `private/var/...` | `normalizePath` **只做 `resolve`、不做 `realpath`**，两种拼法仍不相等 → 可能漏匹配 | `src/routes.ts:541-547` |
| `session.cwd` 缺失或空串 | `undefined` / `''` | 直接 `ungrouped`，不抛错 | `src/projects.ts:176` |
| 归档会话 | `archivedSessionIds` 含该 id | 不进任何容器，也不进 `ungrouped` | `src/projects.ts:312`、`src/projects.ts:400`、`src/projects.ts:480` |
| 空输入 | `workspaces/repos/sessions` 全空 | 返回 `{ projects: [], ungrouped: [] }`，不抛错 | `src/projects.ts:310`、`test/projects.test.mjs:799` |
| 同一路径多个工作区 | `workspaces` 两条同 path | `workspaceByPath` **先出现者胜** | `src/projects.ts:137` |
| 跨仓重复 worktree 路径 | 两个 `repoKey` 含同一路径 | `worktreeByPath` **先出现者胜**（按 `Object.entries` 顺序） | `src/projects.ts:129` |
| 台账 `projectKey` 不在 `repos` | 仓已被移除 | 规则 3 不命中（要求 `input.repos[owner.projectKey] !== undefined`），降级为规则 4/5 | `src/projects.ts:225` |
| 扫描降级：仓节点缺失 | `repos` 无该 `repoKey` | `ensureRepoAccumulator` 返回 `undefined`，会话退回 `ungrouped`，**绝不静默丢弃** | `src/projects.ts:404-410`、`src/projects.ts:414-419` |
| 文件系统根 | `mainPath === '/'` | `basename('/') === ''` → `looksLikeWorktreeOf` 恒 `false` | `src/projects.ts:49-50` |
| 缓存过期 | —— | 本模块无缓存，不存在过期问题；`git.ts` 的 `gitBinPromise` 仅缓存 git 二进制路径且失败不缓存 | `src/projects.ts:283`、`src/git.ts:22`、`src/git.ts:58-62` |

## 代码示例

以下示例全部使用真实导出函数名与真实字段名，数据形态与 `test/projects.test.mjs:16-80` 的构造器一致。

**示例 1：`looksLikeWorktreeOf` 的正反例**（对照 `src/projects.ts:33-36` 的 JSDoc）

```ts
import { looksLikeWorktreeOf } from './projects.js'

looksLikeWorktreeOf('/a/b/LogAnalyst-toolbar-refactor', '/a/b/LogAnalyst') // true
looksLikeWorktreeOf('/a/b/Other', '/a/b/LogAnalyst')                      // false
looksLikeWorktreeOf('/a/b/LogAnalyst', '/a/b/LogAnalyst')                 // false（自身不算）
looksLikeWorktreeOf('/a/c/LogAnalyst-x', '/a/b/LogAnalyst')               // false（父目录不同）
```

**示例 2：主树 + 一个 feature worktree 的最小合成**

```ts
import { buildProjects, collectUngrouped, type BuildProjectsInput } from './projects.js'

const REPO_KEY = '/a/b/LogAnalyst/.git'

const input: BuildProjectsInput = {
  workspaces: [
    { workspaceId: 'ws-1', path: '/a/b/LogAnalyst', title: '', createdAt: '', updatedAt: '' },
  ],
  repos: {
    [REPO_KEY]: {
      commonDir: REPO_KEY,
      mainPath: '/a/b/LogAnalyst',
      worktrees: [
        { path: '/a/b/LogAnalyst',     branch: 'main', isMain: true,  bare: false, exists: true },
        { path: '/a/b/LogAnalyst-feat', branch: 'feat', isMain: false, bare: false, exists: true },
      ],
    },
  },
  repoByWorkspacePath: { '/a/b/LogAnalyst': REPO_KEY },
  ledger: { version: 1, projects: {}, sessions: {} },
  sessions: [
    { sessionId: 's-1', updatedAt: 100, running: false, blank: false, cwd: '/a/b/LogAnalyst-feat' },
  ],
  archivedSessionIds: [],
  liveWorkspacePaths: new Set(['/a/b/LogAnalyst']),
}

const { projects, ungrouped } = buildProjects(input)
// projects[0].key === REPO_KEY，isGit === true
// projects[0].worktrees[0].isMain === true（主树在前，src/projects.ts:93）
// projects[0].worktrees[1].sessions[0].sessionId === 's-1'
collectUngrouped(input, projects) // []，与 ungrouped 一致（src/projects.ts:341 对应单测）
```

**示例 3：死 worktree 的会话归位（规则 3）**

```ts
const deadInput: BuildProjectsInput = {
  ...input,
  repos: {
    [REPO_KEY]: {
      commonDir: REPO_KEY,
      mainPath: '/a/b/LogAnalyst',
      worktrees: [
        { path: '/a/b/LogAnalyst',      branch: 'main', isMain: true,  bare: false, exists: true },
        { path: '/a/b/LogAnalyst-feat', branch: 'feat', isMain: false, bare: false, exists: false },
      ],
    },
  },
  ledger: {
    version: 1,
    projects: {},
    sessions: { 's-1': { projectKey: REPO_KEY, worktreePath: '/a/b/LogAnalyst-feat' } },
  },
  liveWorkspacePaths: new Set(['/a/b/LogAnalyst', '/a/b/LogAnalyst-feat']),
}

const built = buildProjects(deadInput)
// built.projects[0].worktrees[1].exists === false 且 sessions === []
// built.projects[0].history[0].sessionId === 's-1'
```

**示例 4：非 git 工作区平铺（规则 2b）**

```ts
const flatInput: BuildProjectsInput = {
  ...input,
  repos: {},
  repoByWorkspacePath: {},
  sessions: [{ sessionId: 's-2', updatedAt: 200, running: false, blank: false, cwd: '/a/b/LogAnalyst' }],
  liveWorkspacePaths: new Set(['/a/b/LogAnalyst']),
}

const flat = buildProjects(flatInput)
// flat.projects[0].key === 'ws:ws-1'，isGit === false，worktrees === []
// flat.projects[0].flatSessions[0].sessionId === 's-2'
```

**示例 5：`normalizePath` 再导出**

```ts
import { normalizePath } from './projects.js'

normalizePath('/a/b/repo/')      // '/a/b/repo'
normalizePath('/a/b/../b/repo')  // '/a/b/repo'
```

## 已知缺陷与注意事项

1. **`import { resolve } from 'node:path'` 未被使用**（`src/projects.ts:1`）。`basename`、`dirname` 均在用（`src/projects.ts:46-48`、`src/projects.ts:332`），但 `resolve` 在本文件中没有引用点。当前 `tsconfig.json` 未开启 `noUnusedLocals`，故不影响构建；属于可清理的死导入。
2. **规则 4 是启发式，可能误判**：`looksLikeWorktreeOf` 只比较父目录与名称前缀。例如 `/a/b/LogAnalyst-old-backup`（与仓库无关的普通目录）会被判定为 `/a/b/LogAnalyst` 的 worktree，从而把该目录下的会话放进该项目的 `history` 桶。代码注释已声明误判不会搬移会话文件（`src/projects.ts:38-39`），但**UI 归属会不准确**。
3. **`normalizePath` 不做 `realpath`**：符号链接拼法差异（macOS `/var` ↔ `/private/var`）会导致工作区路径与 git 扫描结果无法匹配。该坑在 `src/routes.ts:541-547` 有记载，缓解手段是让白名单与仓查找共用同一批来源；`src/projects.ts` 自身无法解决。
4. **规则 2 的死节点短路是刻意设计，改动易回归**：`src/projects.ts:217-221` 的注释明确禁止把 `workspace !== undefined` 加回 `isKnownLivePath` 的计算，否则会让规则 3/4 对这批会话整体短路，重现「死 worktree 会话被永久扣住」的缺陷（对应回归单测 `test/projects.test.mjs:370-437`）。
5. **子目录工作区回填「只填空缺」**：若某 worktree 根已有精确匹配的 `workspaceId`，子目录工作区的 `title` 会被**丢弃**（`src/projects.ts:352`）。这是有意的优先级策略，但意味着一个仓内多个工作区共用同一 worktree 行时，只有一个 `workspaceId` 可见。
6. **项目标题在多工作区时不可控**：`namedWorkspaces.length === 1` 才采用用户命名，否则回退 `basename(mainPath)`（`src/projects.ts:359-361`）。用户对第二个工作区的命名不会体现在项目标题上。
7. **`repos` 的键顺序影响去重结果**：`buildPathIndex` 对重复 worktree 路径与重复工作区路径都是「先出现者胜」（`src/projects.ts:129`、`src/projects.ts:137`），而 `Object.entries` 的顺序依赖上游构造方式。`normalizePath` 只做词法归一，因此同一物理路径的两种拼法**不会**被合并。
8. **`collectUngrouped` 与 `buildProjects` 必须共用同一 `input`**：该函数通过差集推导未分组会话，若传入的 `projects` 来自另一份 `input`，结论无意义（`src/projects.ts:460-466`；调用方 `src/routes.ts:889-890` 保证了这一点）。
9. **无防御性深拷贝**：函数假设调用方在调用期间不修改 `input`（见「并发与线程模型」）。这是未在类型层面强制的约定。
10. **未确认项**：`docs/INTERFACES.md` §1.3（`docs/INTERFACES.md:137-181`）的契约片段中，`BuildProjectsInput` **未**列出 `liveWorkspacePaths` 字段，而源码已包含（`src/projects.ts:72`）。本文件按**源码**描述；该差异属于文档滞后，是否需同步 `INTERFACES.md` **未确认**（不在本任务写入范围内）。

## 相关文档

- [ServerHost 模块技术文档](../l2-modules/ServerHost模块技术文档.md) —— 上层装配与 `Context` 注入
- [Git 技术文档](../l3-components/Git技术文档.md) —— `normalizePath` / `scanRepo` / `WorktreeEntry.exists` 的事实来源
- [Routes 技术文档](../l3-components/Routes技术文档.md) —— `buildTreePayload` 如何组装 `BuildProjectsInput`
- [worktree-groups 知识库总览](../l1-architecture/worktree-groups-knowledge-base.md) —— 分层索引与阅读顺序
