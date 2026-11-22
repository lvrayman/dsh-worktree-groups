---
生成时间: 2026-09-22
更新时间: 2026-09-22
git-version: 9bd94252dd934c2fa8491977285e461b703f0f3e
git-module-path: src
level: L3
---

# Routes-路由注册与契约 技术文档

> **文件路径**: `src/routes.ts`
> **父文档**: [Routes技术文档.md](./Routes技术文档.md)（概览 + 子文档索引）

> ⚠️ **2026-11-22 定点修订（dsh remote 远程控制模式）**：
> - `registerRoutes` 在注册路由前调用 `attachRemoteHostBridge(ctx)`（不占 `ctx.effect`，路由 effect 数量仍为 5），在机器 B 的 `ctx.dshRemote.connections` 上拦截 `plugin.route.call`（`route: 'dsh-worktree-groups'`）。
> - 当机器 A 处于 `ctx.get('dshRemoteClient')?.status?.()?.mode === 'remote'` 时，5 个端点优先经 Tier 1 转发至机器 B 执行；机器 B 未升级 Tier 1 时，`/tree` 与 `/workspace-open` 自动走 Tier 2 远端 `typertGateway` 回退，`/tree` 的 ETag 计算纳入 `remoteState.targetKey`（`local` vs `remote:<deviceId>:<backend>`）以防切换串台。详见 [工作记录 2026-11-22](../../worklog/2026-11-22-remote-worktree-display.md) 与 [INTERFACES.md §1.5](../../INTERFACES.md)。

本文是 `src/routes.ts` 的功能拆分文档之一，覆盖 **路由注册与装配、路由清单与导出符号、
5 个 HTTP 端点的逐个契约（请求字段、响应结构、错误码）、代码示例**。
路径校验、白名单与 git 参数安全见
[Routes-路径校验与安全边界技术文档.md](./Routes-路径校验与安全边界技术文档.md)；
快照组装、扫描缓存与台账回写见
[Routes-快照组装与台账技术文档.md](./Routes-快照组装与台账技术文档.md)。

## 概述

本层是 `src/routes.ts` 的**对外契约面**：把 5 个 HTTP 端点注册到宿主的精确路由表，并把每个
请求的字段校验、白名单判定、git 调用与响应序列化收敛成统一形状（`src/routes.ts:1351-1431`）。

核心特性：

1. **全部 POST + `kind:'exact'` 精确匹配**，统一前缀 `/dsh-worktree-groups`，未知路由不被接管
   （`src/routes.ts:40`、`src/routes.ts:1374-1376`）。
2. **异常永不外泄**：handler 内层 + 注册层双层 try/catch，一切异常收敛成
   `400` + `{ok:false,message}`；宿主在 handler 抛错时只回 400 空体，客户端拿不到原因
   （`src/routes.ts:6-7`、`src/routes.ts:1377-1385`）。
3. **安全边界靠白名单精确相等**，绝不做前缀匹配；`worktree-create` / `worktree-remove` /
   `reveal` 三个端点各自持有独立的已知路径集合（`src/routes.ts:1043-1059`）。
4. **git 参数注入双重防护**：`isSafeGitArg` 挡前导 `-` 与控制字符，命令数组再加 `--` 分隔符
   （`src/routes.ts:1090-1092`、`src/routes.ts:1287-1290`）。
5. **失败不回滚、部分失败可见**：`git worktree add` 失败不清理已建目录；worktree 建成但工作区
   注册失败时 `ok` 仍为 `true` 并带 `workspaceWarning`（D10）
   （`src/routes.ts:1494-1498`、`src/routes.ts:1500-1532`）。

## 目录

- [1. 路由注册与装配](#1-路由注册与装配)
- [2. 路由清单与导出符号](#2-路由清单与导出符号)
- [3. 逐个路由的请求与响应契约](#3-逐个路由的请求与响应契约)
- [4. 代码示例](#4-代码示例)
- [5. 相关文档](#5-相关文档)

---

## 1. 路由注册与装配

| 项 | 值 | 位置 |
|---|---|---|
| 入口函数 | `registerRoutes(ctx: Context): void` | `src/routes.ts:1364` |
| 调用方 | `apply(ctx)` | `src/index.ts:22`、`src/index.ts:39` |
| 注册 API | `ctx.webServer.register({ kind: 'exact', path, handler })` | `src/routes.ts:1371-1389` |
| 生命周期 | 每个路由一个独立 `ctx.effect`，label = `dsh-worktree-groups: <label> route` | `src/routes.ts:1372-1388` |
| 路由前缀 | `ROUTE_PREFIX = '/dsh-worktree-groups'`（非导出常量） | `src/routes.ts:40` |
| handler 类型 | `RouteHandler = (req, res) => Promise<void>`（非导出） | `src/routes.ts:1356` |
| 响应头 | `content-type: application/json; charset=utf-8` | `src/routes.ts:1001-1004` |

`registerRoutes` **不是**类的构造函数，无实例状态、无构造参数。若
`ctx.webServer.register` 不是函数（非 web profile），函数静默 return，不抛错
（`src/routes.ts:1365-1369`）。

注册层的双层防护（`src/routes.ts:1371-1389`）：内层 `handler` 各自 try/catch，
外层 `register` 再包一层 —— 未捕获异常时 `!res.headersSent` 则回 `400` JSON，
否则 `res.end()`。原因是宿主在 handler 抛错时只回 `400` 空体，客户端拿不到原因
（`src/routes.ts:6-7`、`src/routes.ts:1381-1383`）。

## 2. 路由清单与导出符号

### 2.1 路由清单（全部 POST，`kind: 'exact'`）

| # | 方法 + 路径 | 处理器 | 注册位置 | 导出处理器 |
|---|---|---|---|---|
| 1 | `POST /dsh-worktree-groups/tree` | 内联匿名 async handler | `src/routes.ts:1391-1399` | 无（逻辑在 `buildTreePayload`） |
| 2 | `POST /dsh-worktree-groups/worktree-create` | `handleWorktreeCreate` | `src/routes.ts:1401-1404` | `src/routes.ts:1436` |
| 3 | `POST /dsh-worktree-groups/worktree-remove` | `handleWorktreeRemove` | `src/routes.ts:1406-1409` | `src/routes.ts:1538` |
| 4 | `POST /dsh-worktree-groups/reveal` | `handleReveal` | `src/routes.ts:1411-1414` | `src/routes.ts:1648` |
| 5 | `POST /dsh-worktree-groups/workspace-open` | 内联匿名 async handler | `src/routes.ts:1416-1430` | 无（内联） |

路径字面量由 `ROUTE_PATHS` 拼出，与上表逐条对应（`src/routes.ts:43-49`）：

```ts
export const ROUTE_PATHS = {
  tree: `${ROUTE_PREFIX}/tree`,
  worktreeCreate: `${ROUTE_PREFIX}/worktree-create`,
  worktreeRemove: `${ROUTE_PREFIX}/worktree-remove`,
  reveal: `${ROUTE_PREFIX}/reveal`,
  workspaceOpen: `${ROUTE_PREFIX}/workspace-open`,
} as const
```

### 2.2 本层相关的导出符号

| 符号 | 类型 / 签名 | 位置 |
|---|---|---|
| `ROUTE_PATHS` | `const` 对象（5 个路径，`as const`） | `src/routes.ts:43-49` |
| `registerRoutes` | `(ctx: Context) => void` | `src/routes.ts:1364` |
| `handleWorktreeCreate` | `(ctx, res, body, options?) => Promise<void>` | `src/routes.ts:1436` |
| `handleWorktreeRemove` | `(ctx, res, body, options?) => Promise<void>` | `src/routes.ts:1538` |
| `handleReveal` | `(ctx, res, body, options?) => Promise<void>` | `src/routes.ts:1648` |
| `isSafeGitArg` | `(value: string) => boolean` | `src/routes.ts:1090` |
| `sanitizeBranchForPath` | `(branch: string) => string` | `src/routes.ts:1097` |
| `defaultWorktreePath` | `(mainPath: string, branch: string) => string` | `src/routes.ts:1103` |
| `validateTargetPath` | `(raw, mainPath, parentReal?) => PathVerdict` | `src/routes.ts:1143` |

`PathVerdict = { ok: true; path: string } | { ok: false; message: string }`（`src/routes.ts:1041`）
与 `RouteHandler`（`src/routes.ts:1356`）是**非导出**类型别名。

### 2.3 请求字段的通用读取规则

`bodyString(body, key)`：必须是 `string`，`trim()` 后非空才算「有值」，否则视为缺失
（`src/routes.ts:1029-1034`）。布尔字段一律用**严格相等**判定（`=== false` / `=== true`），
传 `"false"`、`0`、`null` 都按默认分支处理（`src/routes.ts:1444`、`src/routes.ts:1544`）。

## 3. 逐个路由的请求与响应契约

### 3.1 `POST /dsh-worktree-groups/tree`

- **请求体**：不读取任何字段；仅 `await readBody(req)` 把请求流读干（`src/routes.ts:1392`）。
  空体、坏 JSON、数组、`null` 一律被 `readBody` 归一为 `{}`，**不影响成功路径**
  （`src/routes.ts:1007-1021`）。
- **成功**：`200` + `TreePayload`（`src/routes.ts:821-827`）：

  ```ts
  { ok: true, projects: ProjectNode[], ungrouped: SessionRow[],
    archivedSessionIds: string[], workspaceByPath: Record<string, string> }
  ```

  字段类型见 `src/types.ts:70-81`（`ProjectNode`）与 `src/types.ts:44-55`（`SessionRow`）。
- **失败**：`400` + `{ ok: false, message: string }`，message 取 `failMessage(error)`
  （`src/routes.ts:1396-1398`、`src/routes.ts:1024-1026`）。
- **抛错条件**：`buildTreePayload` 已吞掉台账写失败（`src/routes.ts:892-896`），
  真正能到达 `400` 的是 `collectSnapshot` / `buildProjects` 的意外异常。

### 3.2 `POST /dsh-worktree-groups/worktree-create`

签名：`handleWorktreeCreate(ctx: Context, res: ServerResponse, body: Record<string, unknown>,
options: SnapshotOptions = {}): Promise<void>`（`src/routes.ts:1436-1441`）。
`options` 仅用于测试隔离（注入 `createFileLedger(tmpdir)`），生产调用不传
（`src/routes.ts:1433-1435`、`src/routes.ts:1403`）。

请求字段：

| 字段 | 类型 | 必填 | 合法取值范围 | 位置 |
|---|---|---|---|---|
| `repoPath` | string | 是 | 归一化后**精确命中** `snapshot.knownRepoPaths` | `src/routes.ts:1442`、`src/routes.ts:1459` |
| `branch` | string | 是 | `isSafeGitArg` 为真：非空、不以 `-` 开头、不含 `\0 \n \r`；**允许** `/` 与 `.` | `src/routes.ts:1443`、`src/routes.ts:1090-1092` |
| `createBranch` | boolean | 否 | 仅**严格等于** `false` 表示「检出已有分支」，其余按 `true` | `src/routes.ts:1444` |
| `baseRef` | string | 否 | 同 `isSafeGitArg`；仅 `createBranch !== false` 时作为起点 ref | `src/routes.ts:1445`、`src/routes.ts:1288` |
| `targetPath` | string | 否 | 见[安全文档 §2.1](./Routes-路径校验与安全边界技术文档.md#21-目标路径四条约束) 四条约束；缺省按 `defaultWorktreePath` 推导 | `src/routes.ts:1446`、`src/routes.ts:1481` |

成功响应 `200`（`src/routes.ts:1526-1532`）：

```ts
{ ok: true, worktreePath: string, workspaceId?: string, workspaceWarning?: string }
```

`workspaceWarning` 在三种情况出现，且 **`ok` 仍为 `true`**（worktree 确实建成，D10）：
宿主未提供 `workspaceRegistry`（`src/routes.ts:1510`）、注册未返回 id
（`src/routes.ts:1516`）、注册抛错（`src/routes.ts:1519`）。

错误码与抛错条件（全部 `400` + `{ok:false,message}`）：

| 条件 | message | 位置 |
|---|---|---|
| `repoPath` 缺失 | `缺少 repoPath` | `src/routes.ts:1448` |
| `branch` 缺失 | `缺少 branch` | `src/routes.ts:1449` |
| `collectSnapshot` 抛错 | `failMessage(error)` | `src/routes.ts:1452-1456` |
| `repoPath` 非 string / trim 为空 | `缺少 repoPath` | `src/routes.ts:1051-1053` |
| `repoPath` 不在白名单 | `repoPath 不在已知集合内，拒绝访问：<path>` | `src/routes.ts:1459-1460`、`src/routes.ts:1055-1057` |
| `repoPath` 磁盘不存在 | `repoPath 不存在：<path>` | `src/routes.ts:1463-1465` |
| `targetPath` 自身是符号链接 | `targetPath 已存在且是符号链接，拒绝：<target>` | `src/routes.ts:1211` |
| `targetPath` 父目录不可用 | `targetPath 的父目录不可用（不存在或无权访问），拒绝：…` | `src/routes.ts:1222-1225` |
| 主仓父目录不可解析 | `主仓父目录不可解析，拒绝：…` | `src/routes.ts:1234-1238` |
| 两侧真身父目录不等 | `targetPath 的父目录经符号链接解析后不是主仓父目录（…），拒绝：…` | `src/routes.ts:1244-1249` |
| 等于主仓路径 | `targetPath 不能等于主仓路径：…` | `src/routes.ts:1160-1162` |
| 不是主仓父目录的直接子目录 | `targetPath 必须是主仓父目录的直接子目录（…），拒绝：…` | `src/routes.ts:1163-1168` |
| 目录名为空或以 `.` 开头 | `targetPath 的目录名非法（不得为空或以 . 开头）：…` | `src/routes.ts:1170-1172` |
| 目录名不以主仓名开头 | `targetPath 的目录名必须以主仓名开头（…），拒绝：…` | `src/routes.ts:1173-1178` |
| `branch` / `targetPath` / `baseRef` 未过 `isSafeGitArg` | `branch 非法（不得为空或以 - 开头，且不得含控制字符）：<JSON>` 等三条 | `src/routes.ts:1277-1285` |
| `git worktree add` 失败 | `failMessage(error)`（**不回滚已建目录**） | `src/routes.ts:1494-1498` |

### 3.3 `POST /dsh-worktree-groups/worktree-remove`

签名：`handleWorktreeRemove(ctx, res, body, options: SnapshotOptions = {}): Promise<void>`
（`src/routes.ts:1538-1543`）。

| 字段 | 类型 | 必填 | 合法取值范围 | 位置 |
|---|---|---|---|---|
| `path` | string | 是 | 归一化后**精确命中** `snapshot.knownWorktreePaths`，且必须已在 `snapshot.workspaceByPath` 有映射（D6） | `src/routes.ts:1554`、`src/routes.ts:1569` |
| `force` | boolean | 否 | 仅**严格等于** `true` 时给 git 传 `--force` | `src/routes.ts:1544`、`src/routes.ts:1599` |

成功 `200` + `{ ok: true }`（`src/routes.ts:1626`）。成功后调 `registry.delete(workspaceId)`
注销工作区，**不删分支**；注销失败被吞掉，不阻塞成功结论（`src/routes.ts:1614-1623`）。

失败响应（全部 `400`）：

| 条件 | 响应体 | 位置 |
|---|---|---|
| `collectSnapshot` 抛错 | `{ok:false,message}` | `src/routes.ts:1549-1551` |
| `path` 缺失 | `{ok:false,message:'缺少 path'}` | `src/routes.ts:1554`、`src/routes.ts:1051-1053` |
| `path` 不在白名单 | `{ok:false,message:'path 不在已知集合内，拒绝访问：…'}` | `src/routes.ts:1055-1057` |
| 未注册为 dsh 工作区 | `{ok:false,message:'该 worktree 尚未注册为工作区，拒绝移除：…（请在侧栏点 + 新建会话后再操作）'}` | `src/routes.ts:1569-1574` |
| 找不到可用仓库入口（或入口不存在） | `{ok:false,message:'找不到可用的仓库入口来移除该 worktree：…'}` | `src/routes.ts:1590-1595` |
| `git worktree remove` 失败且**未强制** | `{ok:false, needsForce:true, message}` | `src/routes.ts:1605-1610` |
| `git worktree remove` 失败且**已强制** | `{ok:false, message}`（**无** `needsForce`） | `src/routes.ts:1611` |

### 3.4 `POST /dsh-worktree-groups/reveal`

签名：`handleReveal(ctx, res, body, options: SnapshotOptions = {}): Promise<void>`
（`src/routes.ts:1648-1653`）。

| 字段 | 类型 | 必填 | 合法取值范围 | 位置 |
|---|---|---|---|---|
| `path` | string | 是 | 归一化后精确命中 `knownWorktreePaths ∪ knownRepoPaths`（D11） | `src/routes.ts:1669-1671` |

成功 `200` + `{ ok: true }`（`src/routes.ts:1678`）。失败 `400`：白名单未命中
（`src/routes.ts:1670-1671`）、路径不存在 `路径不存在：<path>`（`src/routes.ts:1674-1676`）。

平台分支（`src/routes.ts:1322-1339`，平台由 `currentPlatform()` 提供，`src/routes.ts:1312-1314`）：

| 平台 | 命令 | 语义 |
|---|---|---|
| `darwin` | `open -R <path>` | 在 Finder 中选中 |
| `win32` | `explorer /select,<path>` | 在资源管理器中选中 |
| 其余 | `xdg-open <target>` | 目标是文件时降级为打开其所在目录（`src/routes.ts:1331-1338`） |

全部走 `execFile` 数组参数，**不经 shell**（`src/routes.ts:1342-1349`）。命令失败 reject，
最终由注册层兜成 `400` JSON（`src/routes.ts:1377-1385`）。

### 3.5 `POST /dsh-worktree-groups/workspace-open`

内联处理器（`src/routes.ts:1416-1430`），**无独立导出函数**。

| 字段 | 类型 | 必填 | 合法取值范围 | 位置 |
|---|---|---|---|---|
| `path` | string | 是 | 任意非空字符串（`normalizePath` 后直接交给宿主，**不做白名单校验**） | `src/routes.ts:1418`、`src/routes.ts:1424` |

成功 `200` + `{ ok: true, workspaceId: string }`（`src/routes.ts:1429`）。失败 `400`：
`缺少 path`（`src/routes.ts:1419`）、`宿主未提供 workspaceRegistry，无法注册工作区`
（`src/routes.ts:1422`）、`工作区注册未返回 id`（`src/routes.ts:1427`）。
`registry.create` 抛错时本处理器**未捕获**，由注册层兜成 `400` JSON（`src/routes.ts:1377-1385`）。

## 4. 代码示例

路径与字段名均取自源码（`ROUTE_PATHS` 见 `src/routes.ts:43-49`）。端口以宿主实际 web 服务为准，
示例用本会话 GUI 的 `127.0.0.1:43120`。

### 4.1 拉取侧栏树

```sh
curl -sS -X POST http://127.0.0.1:43120/dsh-worktree-groups/tree \
  -H 'content-type: application/json' -d '{}'
```

```json
{
  "ok": true,
  "projects": [
    {
      "key": "/Users/me/proj/demo-repo/.git",
      "isGit": true,
      "title": "demo-repo",
      "mainPath": "/Users/me/proj/demo-repo",
      "worktrees": [
        { "path": "/Users/me/proj/demo-repo", "branch": "main", "isMain": true,
          "exists": true, "workspaceId": "ws-main", "title": "", "sessions": [] }
      ],
      "history": [],
      "flatSessions": []
    }
  ],
  "ungrouped": [],
  "archivedSessionIds": [],
  "workspaceByPath": { "/Users/me/proj/demo-repo": "ws-main" }
}
```

### 4.2 创建 worktree（成功）

```sh
curl -sS -X POST http://127.0.0.1:43120/dsh-worktree-groups/worktree-create \
  -H 'content-type: application/json' \
  -d '{"repoPath":"/Users/me/proj/demo-repo","branch":"feature/ohos","createBranch":true,"baseRef":"HEAD"}'
```

```json
{ "ok": true, "worktreePath": "/Users/me/proj/demo-repo-feature-ohos", "workspaceId": "ws-new" }
```

省略 `targetPath` 时落点由 `defaultWorktreePath` 推导为
`<主仓父目录>/<主仓名>-<分支名净化>`，即 `/Users/me/proj/demo-repo-feature-ohos`
（`src/routes.ts:1103-1106`）。

### 4.3 创建 worktree（被白名单拒绝）

```sh
curl -sS -o - -w '\n%{http_code}\n' -X POST http://127.0.0.1:43120/dsh-worktree-groups/worktree-create \
  -H 'content-type: application/json' \
  -d '{"repoPath":"/etc","branch":"x"}'
```

```text
{"ok":false,"message":"repoPath 不在已知集合内，拒绝访问：/etc"}
400
```

### 4.4 移除 worktree（先失败拿 needsForce，再强制）

```sh
curl -sS -X POST http://127.0.0.1:43120/dsh-worktree-groups/worktree-remove \
  -H 'content-type: application/json' \
  -d '{"path":"/Users/me/proj/demo-repo-feature-ohos","force":false}'
```

```json
{ "ok": false, "needsForce": true, "message": "git worktree remove ... 失败（cwd=...）：..." }
```

```sh
curl -sS -X POST http://127.0.0.1:43120/dsh-worktree-groups/worktree-remove \
  -H 'content-type: application/json' \
  -d '{"path":"/Users/me/proj/demo-repo-feature-ohos","force":true}'
```

```json
{ "ok": true }
```

### 4.5 在文件管理器中定位

```sh
curl -sS -X POST http://127.0.0.1:43120/dsh-worktree-groups/reveal \
  -H 'content-type: application/json' \
  -d '{"path":"/Users/me/proj/demo-repo-feature-ohos"}'
```

```json
{ "ok": true }
```

### 4.6 注册一个工作区

```sh
curl -sS -X POST http://127.0.0.1:43120/dsh-worktree-groups/workspace-open \
  -H 'content-type: application/json' -d '{"path":"/Users/me/proj/demo-repo"}'
```

```json
{ "ok": true, "workspaceId": "ws-main" }
```

### 4.7 直接调用导出处理器（单测隔离方式）

```js
import { createFileLedger } from '../lib/ledger.js'
import { handleWorktreeCreate } from '../lib/routes.js'

// options.ledger 注入临时台账，确保不写真实 ~/.dsh（src/routes.ts:1433-1435）
await handleWorktreeCreate(ctx, res, { repoPath, branch: 'feature/x' }, { ledger: createFileLedger(tmpHome) })
```

## 5. 相关文档

- [Routes技术文档.md](./Routes技术文档.md) —— 父文档：概览 + 子文档索引
- [Routes-路径校验与安全边界技术文档.md](./Routes-路径校验与安全边界技术文档.md) —— 姊妹文档：路径校验、白名单与 git 参数安全
- [Routes-快照组装与台账技术文档.md](./Routes-快照组装与台账技术文档.md) —— 姊妹文档：快照组装、扫描缓存与台账
- [ServerHost 模块技术文档](../l2-modules/ServerHost模块技术文档.md) —— L2 宿主服务契约层（本文件的宿主依赖来源）
- [Ledger 技术文档](./Ledger技术文档.md) —— `src/ledger.ts` 台账持久化
- [Projects 技术文档](./Projects技术文档.md) —— `src/projects.ts` 项目合成
- [worktree-groups 知识库总览](../l1-architecture/worktree-groups-knowledge-base.md) —— L1 架构总览与分层索引
