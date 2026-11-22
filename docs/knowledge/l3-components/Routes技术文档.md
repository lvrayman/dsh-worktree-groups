---
生成时间: 2026-09-22
更新时间: 2026-09-22
git-version: 9bd94252dd934c2fa8491977285e461b703f0f3e
git-module-path: src
level: L3
---

# Routes 技术文档（概览）

> **文件路径**: `src/routes.ts`

## 概述

`src/routes.ts` 共 1679 行，是 dsh-worktree-groups 插件的宿主侧唯一入口层：把四类宿主事实
（历史会话、实时会话状态、工作区注册表、git worktree 扫描）组装成侧栏树载荷，并注册/实现全部
5 个 HTTP 路由（`src/routes.ts:1-23`）。全文超过 500 行，按 L3 分层纪律拆为本文（概览）+
3 份子文档，全部细节与逐条源码定位见子文档。核心特性：

1. **异常永不外泄**：handler 内层 + 注册层双层 try/catch，一切异常收敛成 `400` + JSON
   `{ok:false,message}`（`src/routes.ts:1377-1385`）。
2. **缺失即降级**：`getService()` 吞掉 `ctx.get` 的缺失/抛错并返回 `undefined`，绝不崩
   （`src/routes.ts:162-172`）。
3. **安全白名单只做精确相等**，绝不做前缀匹配（`src/routes.ts:1043-1059`）。
4. **git 参数注入双重防护**：`isSafeGitArg` 挡前导 `-`，命令数组再加 `--` 分隔符
   （`src/routes.ts:1090-1092`）。
5. **扫描结果 30 秒缓存**，按 commonDir 语义去重（`src/routes.ts:52`、`src/routes.ts:185-249`）。
6. **失败不回滚、部分失败可见**：worktree 建成但工作区注册失败时 `ok` 仍为 `true` 并带
   `workspaceWarning`（D10）（`src/routes.ts:1500-1532`）。

## 子文档索引

| 子文档 | 覆盖内容 |
|---|---|
| [Routes-路由注册与契约技术文档.md](./Routes-路由注册与契约技术文档.md) | 路由注册与装配、路由清单与导出符号、5 个端点的请求/响应契约与错误码、curl 示例 |
| [Routes-路径校验与安全边界技术文档.md](./Routes-路径校验与安全边界技术文档.md) | 白名单精确匹配、git 参数安全、目标路径与符号链接校验（D5 / D-N2）、执行流程、状态机、并发、边界条件、已知缺陷 |
| [Routes-快照组装与台账技术文档.md](./Routes-快照组装与台账技术文档.md) | `collectSnapshot` / `buildSessionRows` / `sweepDeadWorkspaces` / `updateLedger`、扫描缓存、并发模型、边界表 |

## 构造参数与依赖

入口为 `registerRoutes`（`src/routes.ts:1364`），由 `apply(ctx)` 调用（`src/index.ts:22`、
`src/index.ts:39`），每个路由一个独立 `ctx.effect`；无实例状态、无构造参数。

导出符号 22 个：`ROUTE_PATHS`、`SCAN_CACHE_TTL_MS`、`TreeSnapshot`、`SnapshotOptions`、
`TreePayload`、`clearScanCache`、`loadSessionSummaries`、`buildSessionRows`、`loadWorkspaces`、
`loadArchivedSessionIds`、`workspaceSignature`、`collectSnapshot`、`sweepDeadWorkspaces`、
`buildTreePayload`、`isSafeGitArg`、`sanitizeBranchForPath`、`defaultWorktreePath`、
`validateTargetPath`、`registerRoutes`、`handleWorktreeCreate`、`handleWorktreeRemove`、
`handleReveal`。

宿主服务全部经 `ctx.get(name)` 运行时获取，缺一即降级：`webServer`、`workspaceRegistry`、
`sessionPersistence`、`sessionController`、`sessions`、`logger`（`src/routes.ts:69-154`、
`src/routes.ts:868`）；本包依赖 `./git.js`、`./ledger.js`、`./projects.js`、`./types.js`
（`src/routes.ts:32-37`）。

## 相关文档

- [Routes-路由注册与契约技术文档](./Routes-路由注册与契约技术文档.md) —— 子文档：路由注册与 5 个端点契约
- [Routes-路径校验与安全边界技术文档](./Routes-路径校验与安全边界技术文档.md) —— 子文档：路径校验与安全边界
- [Routes-快照组装与台账技术文档](./Routes-快照组装与台账技术文档.md) —— 子文档：快照组装、缓存与台账
- [ServerHost 模块技术文档](../l2-modules/ServerHost模块技术文档.md) —— L2 宿主服务契约层
- [Ledger 技术文档](./Ledger技术文档.md) —— `src/ledger.ts` 台账持久化
- [Projects 技术文档](./Projects技术文档.md) —— `src/projects.ts` 项目合成
- [worktree-groups 知识库总览](../l1-architecture/worktree-groups-knowledge-base.md) —— L1 架构总览
