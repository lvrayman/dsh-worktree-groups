---
生成时间: 2026-09-22
更新时间: 2026-09-22
git-version: 9bd94252dd934c2fa8491977285e461b703f0f3e
git-module-path: src
level: L3
---

# Routes-路径校验与安全边界 技术文档

> **文件路径**: `src/routes.ts`
> **父文档**: [Routes技术文档.md](./Routes技术文档.md)（概览 + 子文档索引）

本文是 `src/routes.ts` 的功能拆分文档之一，覆盖 **白名单精确匹配、git 参数注入防护、
目标路径与符号链接校验（D5 / D-N2）、执行流程与校验失败分支、状态机、并发模型、
边界条件与已知缺陷**。5 个端点的请求/响应契约与代码示例见
[Routes-路由注册与契约技术文档.md](./Routes-路由注册与契约技术文档.md)；
快照组装、扫描缓存与台账回写见
[Routes-快照组装与台账技术文档.md](./Routes-快照组装与台账技术文档.md)。

## 概述

本层是 `src/routes.ts` 的**安全边界面**：任何一条 POST 都不允许读写白名单外的路径，也不允许
把请求字段拼进 git 命令行。核心特性：

1. **白名单只做精确相等**：`assertKnown` 归一化后查集合，绝不做前缀匹配
   （`src/routes.ts:1043-1059`）。
2. **git 参数双重防护**：`isSafeGitArg` 挡前导 `-` 与控制字符，命令数组再加 `--` 分隔符
   （`src/routes.ts:1090-1092`、`src/routes.ts:1287-1290`）。
3. **目标路径四重词法约束 + realpath 真身比较**：D5 挡越狱，D-N2 挡「父目录是指向仓外的
   符号链接」（`src/routes.ts:1143-1180`、`src/routes.ts:1198-1252`）。
4. **校验失败零副作用**：任一校验不通过时**什么都不建、什么都不删**，只回 `400`
   （`src/routes.ts:1478-1489`）。
5. **失败不回滚**：`git worktree add` 失败不清理已建目录；worktree 建成但注册失败时 `ok` 仍为
   `true` 并带 `workspaceWarning`（D10）（`src/routes.ts:1494-1532`）。

## 目录

- [1. 白名单与 git 参数安全](#1-白名单与-git-参数安全)
- [2. 目标路径与符号链接校验（D5 / D-N2）](#2-目标路径与符号链接校验d5--d-n2)
- [3. 执行流程（含校验失败分支）](#3-执行流程含校验失败分支)
- [4. 状态机](#4-状态机)
- [5. 并发与线程模型](#5-并发与线程模型)
- [6. 边界条件](#6-边界条件)
- [7. 已知缺陷与注意事项](#7-已知缺陷与注意事项)
- [8. 相关文档](#8-相关文档)

---

## 1. 白名单与 git 参数安全

### 1.1 `assertKnown`：白名单精确匹配

`assertKnown(rawPath, allowed, label)`（`src/routes.ts:1050-1059`）：非 string 或 trim 为空
回 `缺少 <label>`；`normalizePath` 后不在集合回 `<label> 不在已知集合内，拒绝访问：<path>`。
**只做精确相等，绝不做前缀匹配**（`src/routes.ts:1043-1049`）—— 前缀匹配正是越权漏洞的
常见来源：`/a/b` 通过不代表 `/a/b/../..` 或 `/a/bc` 通过。归一化用 `normalizePath`
（绝对化 + POSIX + 去尾斜杠），这也是本包内所有路径比较的唯一基准。

三个写端点各自的白名单来源：

| 端点 | 白名单集合 | 位置 |
|---|---|---|
| `worktree-create` | `snapshot.knownRepoPaths` | `src/routes.ts:1459` |
| `worktree-remove` | `snapshot.knownWorktreePaths`（另加 D6「必须已注册」判据） | `src/routes.ts:1554`、`src/routes.ts:1569` |
| `reveal` | `knownWorktreePaths ∪ knownRepoPaths`（D11） | `src/routes.ts:1669` |

### 1.2 `isSafeGitArg`：git 参数注入防护

`isSafeGitArg(value)`：`value.length > 0 && !value.startsWith('-') && !/[\0\n\r]/.test(value)`
（`src/routes.ts:1090-1092`）。规则刻意宽松，放行含 `/`（`feature/ohos`）与 `.`
（`release/6.1.20`）的合法分支名（`src/routes.ts:1084-1085`）。
`src/panel-git.ts` 里移植过来的 `isSafeRef` **不在本包内**（`src/` 下只有 `git.ts`），
故此处落地一个最小实现（`src/routes.ts:1084-1088`）。

命令数组层面再加第二重防护：`git worktree add` 的 argv 里 `--` 分隔符把路径与 ref 同
选项隔开（`src/routes.ts:1287-1290`）。

### 1.3 `sanitizeBranchForPath` 与 `defaultWorktreePath`

`sanitizeBranchForPath(branch)`：非 `[A-Za-z0-9._-]` 一律换成 `-`，去掉首尾 `-`，
结果为空回退 `'worktree'`（`src/routes.ts:1097-1100`）。
`defaultWorktreePath(mainPath, branch)`：`join(dirname(main), basename(main) + '-' + sanitizeBranchForPath(branch))`
（`src/routes.ts:1103-1106`）。净化只影响**默认落点目录名**，不改变分支名本身。

## 2. 目标路径与符号链接校验（D5 / D-N2）

### 2.1 目标路径四条约束

`validateTargetPath(raw, mainPath, parentReal?)`（`src/routes.ts:1143-1180`）四条约束：

1. `effectiveTarget !== main`（不得等于主仓路径，`src/routes.ts:1160-1162`）；
2. `dirname(effectiveTarget) === effectiveParent`（必须是主仓父目录的直接子目录，
   同时挡住 `/tmp/...`、仓内子路径与 `..` 越狱，`src/routes.ts:1163-1168`）；
3. `basename` 非空且不以 `.` 开头（挡住 `.git`、`.ssh`，`src/routes.ts:1170-1172`）；
4. `basename` 必须以 `basename(mainPath)` 开头（`src/routes.ts:1173-1178`）。

`parentReal` 是可选第三参（D-N2）：传入时判据落在 **realpath 空间**
（`effectiveParent = normalizePath(parentReal)`，目标取 `join(effectiveParent, basename(target))`），
缺省时退回原词法行为（`src/routes.ts:1156-1158`）。目标也归一到**真身拼法**（父目录取真身、
叶子名原样保留），因此返回的 `path` 可直接交给 git，且与 `git worktree list` 回的 realpath
拼法一致（回填更稳）。

### 2.2 `resolveRealTargetParents`：realpath 真身解析

生产路径始终先跑 `resolveRealTargetParents`（`src/routes.ts:1198-1252`），任一失败直接拒绝，
**绝不静默放行**（`src/routes.ts:1478-1489`）。四步判定：

| 步骤 | 判据 | 失败 message | 位置 |
|---|---|---|---|
| (1) | 目标已存在且是符号链接 ⇒ 拒绝（用 `lstat`；`stat` 会跟随链接而看不出） | `targetPath 已存在且是符号链接，拒绝：<target>` | `src/routes.ts:1207-1212` |
| (2) | 目标父目录 `realpath` 必须成功（ENOENT / 权限 ⇒ 拒绝） | `targetPath 的父目录不可用（不存在或无权访问），拒绝：…` | `src/routes.ts:1217-1226` |
| (3) | 主仓父目录 `realpath` 必须成功，它是「允许落点」的真身基准 | `主仓父目录不可解析，拒绝：…` | `src/routes.ts:1229-1238` |
| (4) | 两个真身父目录必须相等 —— 这一步才挡住符号链接 | `targetPath 的父目录经符号链接解析后不是主仓父目录（…），拒绝：…` | `src/routes.ts:1241-1249` |

第 (4) 步的攻击面：攻击者在主仓父目录下建一个 `demo-repo-evil-link -> /仓外目录`，
词法上完全合法（同父目录 + 主仓名前缀）⇒ 词法校验通过 ⇒ git 把整个 worktree 铺到链接真身，
D-5 被绕过。realpath 比较正是 D-N2 的修复点（`src/routes.ts:1148-1155`）。

### 2.3 `gitWorktreeAdd`：双重防护与路径回填

`gitWorktreeAdd(repoPath, branch, createBranch, targetPath, baseRef, signal)`（`src/routes.ts:1269-1305`）
在执行前对 `branch` / `targetPath` / `baseRef` 三个字段**再各查一次** `isSafeGitArg`，不通过即
`throw`，由调用方转成 `400`（`src/routes.ts:1277-1285`）。随后拼 argv：

- `createBranch === true`：`['worktree', 'add', '-b', branch, '--', targetPath, ...(baseRef ? [baseRef] : [])]`
- 否则：`['worktree', 'add', '--', targetPath, branch]`

（`src/routes.ts:1287-1290`）。成功后读 `git worktree list --porcelain` 回填 git 实际落盘路径
（git 会规范化符号链接 / 大小写 / 相对化）；读不到时退回 `normalizePath(targetPath)`
（`src/routes.ts:1293-1304`）。

## 3. 执行流程（含校验失败分支）

### 3.1 通用请求入口

```text
POST /dsh-worktree-groups/<route>
        |
        v
webServer 精确匹配 path -> handler(req, res)          [src/routes.ts:1371-1389]
        |
        v
+-----------------------------------------------+
| register 包裹层 try/catch                      |
|   await handler(req, res)                      |
|   抛错:                                        |
|     if (!res.headersSent) json(400,{ok:false}) |
|     else res.end()                             |
+-----------------------------------------------+
        |
        v
readBody(req)  -- 解析失败/流错误 -> resolve({})     [src/routes.ts:1007-1021]
        |
        v
路由各自的处理器（tree / create / remove / reveal / workspace-open）
```

### 3.2 `/worktree-create` 校验失败分支

```text
handleWorktreeCreate(ctx, res, body)
  |
  +-- repoPath 缺失? --------------------> 400 {ok:false,message:'缺少 repoPath'}   [1448]
  +-- branch 缺失? ----------------------> 400 {ok:false,message:'缺少 branch'}     [1449]
  |
  +-- collectSnapshot 抛错? -------------> 400 {ok:false,message:failMessage(err)}  [1452-1456]
  |
  +-- assertKnown(repoPath, knownRepoPaths)                           [1459]
  |     非 string / trim 为空 -> 400 '缺少 repoPath'
  |     normalizePath 后不在集合 -> 400 'repoPath 不在已知集合内，拒绝访问：<p>'
  |
  +-- !pathExists(repoPath)? ------------> 400 'repoPath 不存在：<p>'              [1463-1465]
  |
  +-- mainPath = mainPathByKnownPath.get(repoPath) ?? repoPath        [1469]
  |
  +-- candidate = targetPath ?? defaultWorktreePath(mainPath, branch) [1481]
  |
  +-- resolveRealTargetParents(candidate, mainPath)                   [1198]
  |     目标已存在且是符号链接 --------> 拒绝                             [1211]
  |     目标父目录 realpath 失败 ------> 拒绝                             [1222]
  |     主仓父目录 realpath 失败 ------> 拒绝                             [1234]
  |     两个真身父目录不相等 ----------> 拒绝                             [1244]
  |     任一拒绝 ----------------------> 400 {ok:false,message}            [1483]
  |
  +-- validateTargetPath(candidate, mainPathReal, parentReal)         [1484]
  |     等于主仓 / 非直接子目录 / 名字非法 / 不以主仓名开头
  |       -> 400 {ok:false,message}                                       [1485]
  |
  +-- gitWorktreeAdd(repoPath, branch, createBranch, targetPath, baseRef, undefined)
  |     isSafeGitArg 不通过 -> throw -> 400                               [1277-1285]
  |     runGit 失败         -> 400，**不回滚已建目录**                     [1494-1498]
  |     成功: 读 `worktree list --porcelain` 回填真实路径，
  |           读不到则退回 normalizePath(targetPath)                      [1293-1304]
  |
  +-- registry.create(worktreePath)                                    [1506-1521]
  |     未提供 create / 未返回 id / 抛错 -> workspaceWarning（ok 仍为 true）
  |
  +-- clearScanCache()                                                 [1524]
  |
  +-- json(200, { ok:true, worktreePath, workspaceId?, workspaceWarning? })
```

### 3.3 `/worktree-remove` 校验失败分支

```text
handleWorktreeRemove(ctx, res, body)
  |
  +-- collectSnapshot 抛错? ------------> 400 {ok:false,message}                [1549-1551]
  +-- assertKnown(path, knownWorktreePaths, 'path') 失败 -> 400                  [1554-1555]
  +-- workspaceByPath[path] === undefined? -> 400 '该 worktree 尚未注册…'         [1569-1574]
  +-- 解析 repoPath: mainPathByKnownPath.get(path)
  |     缺失 -> 退台账 projects[*].worktrees[path] 命中项的 mainPath              [1579-1589]
  +-- repoPath 缺失 或 !pathExists -> 400 '找不到可用的仓库入口…'                 [1590-1595]
  +-- runGit('worktree','remove',[--force],path)                                 [1598-1604]
  |     失败且 !force -> 400 {ok:false, needsForce:true, message}                [1605-1610]
  |     失败且 force  -> 400 {ok:false, message}                                 [1611]
  +-- registry.delete(workspaceId) 失败 -> 吞掉，不影响 200                       [1617-1623]
  +-- clearScanCache() -> json(200,{ok:true})                                    [1625-1626]
```

## 4. 状态机

**N/A** —— 本文件覆盖的 5 个 handler 与全部导出函数都是**无状态**的：不持有实例字段，
不维护请求间的状态迁移；`registerRoutes` 只做一次性同步注册并返回 `void`
（`src/routes.ts:1364-1431`）。路由层唯一的跨请求状态是模块级 `scanCache`
（`src/routes.ts:193`），它只有「有效 / 过期」二元状态，已在 §5 描述。

## 5. 并发与线程模型

- **执行模型**：Node.js 单线程事件循环，所有 handler 均为 `async`，`RouteHandler` 即
  `Promise<void>`（`src/routes.ts:1356`）。无 worker 线程、无锁、无共享内存。
- **请求级状态**：每个请求独立调用 `collectSnapshot` 生成自己的 `TreeSnapshot`，请求之间
  **不共享快照**。三个写端点的 `options` 只用于测试注入 `ledger` / `now`
  （`src/routes.ts:567-575`、`src/routes.ts:1435`）。
- **共享状态**：`scanCache`（`src/routes.ts:193`）被 `/tree`、`/worktree-create`、
  `/worktree-remove`、`/reveal` 共同读写；`worktree-create` / `worktree-remove` 成功后调
  `clearScanCache()` 强制下次重扫（`src/routes.ts:1524`、`src/routes.ts:1625`）。
  并发请求下并发的首个请求可能各自跑一次 git（缓存尚未写入）。
- **git 操作串行性**：`handleWorktreeCreate` / `handleWorktreeRemove` 对**同一仓**的并发调用
  由 git 自身的锁（`index.lock` / worktree 元数据）串行化，本文件**不加应用层锁**；
  并发对同一路径的 remove 会出现一方成功、另一方报错的竞争结果。
- **取消行为**：`AbortSignal` 只经 `SnapshotOptions.signal` 传入，HTTP 路由调用
  `collectSnapshot(ctx, options)` / `buildTreePayload(ctx)` 时**均未传 signal**
  （`src/routes.ts:1394`、`src/routes.ts:1453`、`src/routes.ts:1548`、`src/routes.ts:1656`），
  `gitWorktreeAdd` 与 `runRemove` 调 `runGit` 时也传 `undefined`
  （`src/routes.ts:1290`、`src/routes.ts:1600`）。因此**客户端断开不会取消正在跑的 git 子进程**；
  signal 目前只服务于测试与内部调用方。
- **无请求超时**：`readBody` 只在 `end` / `error` 事件上 resolve（`src/routes.ts:1011-1019`），
  本文件未设置任何超时；一个既不结束也不报错的连接会让 handler 悬挂。

## 6. 边界条件

| 场景 | 实际行为 | 证据位置 |
|---|---|---|
| 缺失必填参数（`repoPath` / `branch` / `path`） | `400` + `{ok:false,message:'缺少 <字段>'}`；`assertKnown` 对非 string 或 trim 为空回同一句 | `src/routes.ts:1448-1449`、`src/routes.ts:1051-1053` |
| 空 body / 无 body / 坏 JSON / `[1,2,3]` / `null` | `readBody` 一律 resolve `{}`；`/tree` 仍回 `200 ok:true`；其它路由进入各自的「缺少字段」分支 | `src/routes.ts:1013-1019`（测试 `test/routes.test.mjs:1953-1973`） |
| `readBody` 读流出错 | `req.on('error')` resolve `{}`，**绝不 reject**，请求不悬挂 | `src/routes.ts:1019` |
| 连接既不结束也不报错 | 无超时，handler 悬挂 | `src/routes.ts:1007-1021` |
| 白名单外路径（如 `/etc`） | `400` + `'path 不在已知集合内，拒绝访问：<p>'`，**零副作用** | `src/routes.ts:1055-1057`（测试 `test/routes.test.mjs:996`） |
| 前缀匹配企图（`/a/b/../..`、`/a/bc`） | 归一化后精确比较，一律拒绝 | `src/routes.ts:1043-1058` |
| 不存在的 `repoPath` | `400` + `'repoPath 不存在：<p>'` | `src/routes.ts:1463-1465` |
| 未注册为工作区的 worktree 走 remove | `400` + 明确提示先去侧栏新建会话（D6） | `src/routes.ts:1569-1574` |
| 脏 worktree 走 remove 且 `force !== true` | `400` + `{ok:false,needsForce:true,message}`，客户端据此二次确认 | `src/routes.ts:1605-1610` |
| `force === true` 且仍失败 | `400` + `{ok:false,message}`，**无** `needsForce` | `src/routes.ts:1611` |
| 找不到可用仓库入口 | `400` + `'找不到可用的仓库入口来移除该 worktree：<p>'` | `src/routes.ts:1590-1595` |
| `targetPath` 指向仓外 / `/tmp/evil` | 词法校验拒绝（非主仓父目录直接子目录） | `src/routes.ts:1163-1168` |
| `targetPath` 父目录是指向仓外的符号链接 | realpath 空间比较拒绝（D-N2 修复点） | `src/routes.ts:1244-1249` |
| `targetPath` 自身已存在且是符号链接 | `lstat` 判定后拒绝（`stat` 会跟随链接而看不出） | `src/routes.ts:1207-1212` |
| `targetPath` 的父目录尚不存在 | `realpath` 抛 ENOENT ⇒ 拒绝（不静默放行） | `src/routes.ts:1217-1226` |
| `branch` / `baseRef` 以 `-` 开头（git 选项注入） | `isSafeGitArg` 拒绝；命令数组再加 `--`，仍以 `-` 开头的值会被 git 当 ref 报错且**不创建目录** | `src/routes.ts:1090-1092`、`src/routes.ts:1287-1290` |
| `branch` 含 `/` 或 `.`（`feature/ohos`、`release/6.1.20`） | 合法放行 | `src/routes.ts:1084-1085`（测试 `test/routes.test.mjs:1443-1449`） |
| 分支名净化后为空（`///`、`''`） | `sanitizeBranchForPath` 回退 `'worktree'` | `src/routes.ts:1099` |
| `createBranch` 传字符串 `"false"` / `0` / `null` | 只有**严格** `false` 才走「检出已有分支」，其余按 `true` | `src/routes.ts:1444` |
| `force` 传字符串 `"true"` / `1` | 只有**严格** `true` 才加 `--force` | `src/routes.ts:1544` |
| worktree 已建成但 `registry.create` 失败 | `200 ok:true` + `workspaceWarning`，**不回滚** worktree（D10） | `src/routes.ts:1500-1532` |
| `git worktree add` 失败 | `400`，**不回滚**任何已建目录 | `src/routes.ts:1494-1498` |
| remove 成功但 `registry.delete` 抛错 | 吞掉，仍回 `200 ok:true`；死工作区行由下次 `/tree` 的 D18 清扫处理 | `src/routes.ts:1617-1623` |
| `workspaceRegistry` 缺席 | `workspace-open` 明确 `400`；`worktree-create` 回 `workspaceWarning` | `src/routes.ts:1421-1423`、`src/routes.ts:1509-1510` |
| `webServer` 缺席（非 web profile） | `registerRoutes` 静默 return，不抛错 | `src/routes.ts:1365-1369` |
| `reveal` 的平台命令失败（如无 `xdg-open`） | `execFile` reject → 注册层兜成 `400` JSON | `src/routes.ts:1342-1349`、`src/routes.ts:1377-1385` |
| `reveal` 的 Linux 目标是文件 | 降级为打开其所在目录 | `src/routes.ts:1331-1338` |
| 未知路由 | 不属于本插件命名空间，不被接管（`kind:'exact'`） | `src/routes.ts:1374-1376`（测试 `test/routes.test.mjs:2093`） |

## 7. 已知缺陷与注意事项

1. **失败一律 `400`，没有 `404` / `500` 区分**。校验失败、宿主服务缺失、git 执行失败、
   未捕获异常全部落到 `400`（`src/routes.ts:1377-1385`、`src/routes.ts:1396-1398` 等）。
   客户端只能靠 `message` 文本区分原因，不能靠状态码。
2. **`workspace-open` 不做路径白名单校验**：`path` 经 `normalizePath` 后直接交给
   `registry.create`（`src/routes.ts:1418-1424`），与 `worktree-create` / `worktree-remove` /
   `reveal` 三个端点的安全姿态不同。是否有意为「允许注册任意路径」**未确认** ——
   源码注释未说明，`docs/INTERFACES.md` 中未检索到对应裁定。
3. **`targetPath` 的父目录必须已存在**：`resolveRealTargetParents` 对目标父目录做
   `realpath`，ENOENT 即拒绝（`src/routes.ts:1217-1226`）。因此「在一个尚未创建的父目录下建
   worktree」会被拒绝。这是符号链接安全（D-N2）的直接后果，是否为期望行为**未确认**。
4. **失败不回滚**：`git worktree add` 失败时不清理已建目录
   （`src/routes.ts:1494-1498` 的注释即为契约 §1.5）。若 `add` 成功而随后的
   `worktree list` 读取失败，会退回 `normalizePath(targetPath)` 作为 `worktreePath`
   （`src/routes.ts:1301-1304`），与实际落点可能存在拼法差异。
5. **HTTP 层无取消、无超时**：路由不传 `AbortSignal`，`readBody` 也无超时
   （`src/routes.ts:1394`、`src/routes.ts:1007-1021`）；长耗时 git 命令只能等宿主 socket 层面断开。
6. **`validateTargetPath` 的第三参是可选**：缺省时只做词法校验，符号链接可绕过 D-5
   （`src/routes.ts:1123-1133`）。生产路径已始终传入 `parentReal`，但任何新增调用点若省略
   该参就会退化到不安全行为。
7. **`ROUTE_PATHS` 是 `as const` 冻结字面量**（`src/routes.ts:43-49`），客户端与测试都从它
   取值；新增路由必须同时改这里，否则 `register` 与调用方会不一致。
8. **`loadWorkspaces` 会吞掉 `registry.list()` 的抛错**（宿主顺序损坏时抛
   `references missing workspace`），只返回已读到的部分（`src/routes.ts:486-488`）；
   此时 `workspaceByPath` 可能缺项，进而影响 `worktree-remove` 的 D6 判定。

## 8. 相关文档

- [Routes技术文档.md](./Routes技术文档.md) —— 父文档：概览 + 子文档索引
- [Routes-路由注册与契约技术文档.md](./Routes-路由注册与契约技术文档.md) —— 姊妹文档：路由注册、端点契约与代码示例
- [Routes-快照组装与台账技术文档.md](./Routes-快照组装与台账技术文档.md) —— 姊妹文档：快照组装、扫描缓存与台账
- [ServerHost 模块技术文档](../l2-modules/ServerHost模块技术文档.md) —— L2 宿主服务契约层（本文件的宿主依赖来源）
- [Ledger 技术文档](./Ledger技术文档.md) —— `src/ledger.ts` 台账持久化
- [Projects 技术文档](./Projects技术文档.md) —— `src/projects.ts` 项目合成
- [worktree-groups 知识库总览](../l1-architecture/worktree-groups-knowledge-base.md) —— L1 架构总览与分层索引
