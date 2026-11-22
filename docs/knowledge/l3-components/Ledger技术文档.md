---
生成时间: 2026-09-22
更新时间: 2026-09-22
git-version: 9bd94252dd934c2fa8491977285e461b703f0f3e
git-module-path: src
level: L3
---

# Ledger（台账持久化）

> **文件路径**: `src/ledger.ts`　|　**级别**: L3（地面细节层）　|　**规模**: 292 行

本文是 `src/ledger.ts` 的 L3 组件文档**概览与导航**。因成文超过 500 行，按拆分规则拆为本文（概览）+ 两份子文档；11 个正文小节全部落在子文档中。

## 目录

1. [概述](#1-概述)｜2. [构造参数与依赖](#2-构造参数与依赖)｜3. [核心方法签名](#3-核心方法签名)｜4. [执行流程](#4-执行流程)｜5. [状态机](#5-状态机)｜6. [并发与线程模型](#6-并发与线程模型)｜7. [边界条件](#7-边界条件)｜8. [代码示例](#8-代码示例)｜9. [已知缺陷与注意事项](#9-已知缺陷与注意事项)｜10. [相关文档](#10-相关文档)

## 1. 概述

`src/ledger.ts` 是 **T2 台账持久化**模块（`src/ledger.ts:2`）。它解决：`SessionHeader` 只带 `cwd`、没有仓库指针，worktree 目录被 `rm -rf` 后其中的会话无从知道原属哪个项目（`src/ledger.ts:4-5`）。台账用 `<homeDir>/worktree-groups.json` 补上这份信息。

核心特性：① 单一 JSON 介质，`version` 固定 `1`（`src/ledger.ts:25`、`:28`）；② 原子写 tmp + `fsync` + `rename`，权限 `0o600`（`src/ledger.ts:232-254`）；③ 容错读永不抛错，坏文件备份为 `.bad-<ts>`（`src/ledger.ts:192-227`）；④ `read`/`write`/`update` 全经 Promise 链串行化（`src/ledger.ts:256-271`）；⑤ 工厂 `createFileLedger()` 不做任何 IO（`src/ledger.ts:147-152`）。

**详见** → [数据模型与接口](./Ledger-数据模型与接口技术文档.md) §1、[持久化与并发](./Ledger-持久化与并发技术文档.md)
## 2. 构造参数与依赖

导出 7 个符号：`LedgerWorktree`（`src/ledger.ts:40-49`）、`LedgerProject`（`:52-57`）、`LedgerSessionOwner`（`:60-65`）、`LedgerData`（`:68-73`）、`LedgerStore`（`:76-92`）、`emptyLedger()`（`:99-101`）、`createFileLedger(homeDir?)`（`:153-292`）。运行时依赖 `node:fs/promises`、`node:os`、`node:path`，以及**惰性动态 import** 的 `@deepseek-ai/dsh-home-paths`（`:37`、`:111-112`）；回退链 `defaultDshHome()` → `$DSH_HOME` → `~/.dsh`（`:121-123`）。唯一生产装配方是 `src/routes.ts`（`:33`、`:626-635`）。

**详见** → [数据模型与接口](./Ledger-数据模型与接口技术文档.md) §1–§4
## 3. 核心方法签名

- `export function emptyLedger(): LedgerData`（`src/ledger.ts:99-101`）—— 无参数、不抛错、每次返回新对象。
- `export function createFileLedger(homeDir?: string): LedgerStore`（`:153`）—— 同步返回，**不做 IO、不 await 模块解析**。
- `read(): Promise<LedgerData>`（声明 `:78`／实现 `:274-276`）—— 永不抛错；损坏时备份坏文件。
- `write(data: LedgerData): Promise<void>`（声明 `:80`／实现 `:278-280`）—— 全量覆盖写盘；**会抛错**（循环引用 ⇒ `TypeError`、`EACCES` 等）。
- `update(fn: (data: LedgerData) => LedgerData): Promise<LedgerData>`（声明 `:81-91`／实现 `:282-290`）—— 同步回调；回调抛错原样上抛；`next === current` 时跳过写盘。

**详见**（签名原文 + 参数取值范围 + 抛错条件逐条展开）→ [数据模型与接口](./Ledger-数据模型与接口技术文档.md) §5
## 4. 执行流程

三条 ASCII 流程图：**读**（`read` → `enqueue` → `ledgerFile` → `readFile` → `JSON.parse` → `isLedgerShape`，含 ENOENT / 解析失败 / 结构不符三个降级分支）、**写**（`mkdir` → `open(tmp,0o600)` → `writeFile` → `sync` → `close` → `rename`，失败 `unlink(tmp)` 后 rethrow）、**读-改-写**（`readFromDisk` → `fn(current)` → 同引用判定 → `writeToDisk`）。

**详见** → [持久化与并发](./Ledger-持久化与并发技术文档.md) §1
## 5. 状态机

台账条目 `LedgerWorktree` 的状态为 `不存在` → `ACTIVE` ⇄ `GONE`，**无终态**（`updateLedger` 从不删除条目，`src/routes.ts:939-964`）。含 ASCII 流转图 + 状态参考表（状态／含义／转入条件／转出条件），另附会话归属快照 `LedgerSessionOwner` 的状态表（`未登记` → `已登记`，无转出）。

**详见** → [持久化与并发](./Ledger-持久化与并发技术文档.md) §2
## 6. 并发与线程模型

Node 单线程事件循环，**不使用 Worker / `worker_threads`**。`enqueue()`（`src/ledger.ts:256-271`）以 `tail.then(task, task)` 保证任一时刻只有一次任务在飞，并用两个恒 resolve 的 handler 吞掉成败使链不毒化。**无内存数据缓存**（每次从磁盘重读），仅缓存文件路径 `cachedFile`（`:156`）；一致性边界是「一次 `update()` = 一次串行事务」，原子性边界是同目录 `rename`。**取消行为：N/A** —— 三个方法均不接受 `AbortSignal`，取消语义在编排层 `src/routes.ts:571-572` 处理。

**详见** → [持久化与并发](./Ledger-持久化与并发技术文档.md) §3
## 7. 边界条件

含 24 行边界条件表格（场景／触发路径／行为／是否抛错／证据位置），覆盖：文件不存在、`homeDir` 为不存在的深层目录、JSON 损坏、`version !== 1`、结构缺字段、顶层为数组或 `null`、同一毫秒两次损坏读、备份本身失败、同进程并发读写、**跨进程并发写（无保护）**、空台账、路径不可写、循环引用、回调抛错、同引用 no-op、**原地改 + 同引用 ⇒ 静默丢数据**、`async` 回调未防护、`$DSH_HOME` 为空、文件权限、`.tmp` 残留等。

**详见** → [持久化与并发](./Ledger-持久化与并发技术文档.md) §4
## 8. 代码示例

6 个示例，全部使用真实函数名与真实数据结构：最小读写往返、追加 worktree 记录（返回新对象）、标记 `goneAt`、no-op 不写盘、**反例：原地修改 + 同引用导致静默丢数据**、生产组装（等价于 `src/routes.ts:626-635`）。

**详见** → [数据模型与接口](./Ledger-数据模型与接口技术文档.md) §6
## 9. 已知缺陷与注意事项

10 条，含 3 条高优先级：① **同引用 no-op 陷阱**（原地改 + 返回同一引用 ⇒ 数据静默丢失，`src/ledger.ts:85-89`）；② **跨进程无并发保护**（无文件锁、无版本比较，后写者覆盖先写者）；③ **`update()` 不接受 async 回调且无运行时校验**（`:285-287`）。其余：`read()` 有写副作用、`backupCorrupt` 最多 100 次尝试后静默放弃、`emptyLedger` 结构在 `routes.ts` 重复手写、home 解析两级实现、`goneAt >= lastSeenAt` 不变式靠调用方维护、台账只增不减、全量覆盖写。

**详见** → [持久化与并发](./Ledger-持久化与并发技术文档.md) §5
## 10. 相关文档

- [Ledger-数据模型与接口技术文档.md](./Ledger-数据模型与接口技术文档.md) —— 子文档：导出符号、数据结构与磁盘格式、依赖、装配、方法签名、代码示例
- [Ledger-持久化与并发技术文档.md](./Ledger-持久化与并发技术文档.md) —— 子文档：执行流程、状态机、并发与线程模型、边界条件、已知缺陷
- [ServerHost 模块技术文档](../l2-modules/ServerHost模块技术文档.md) —— L2 模块层：路由注册、宿主上下文与生命周期
- [Routes 技术文档](../l3-components/Routes技术文档.md) —— 台账的唯一生产组装入口与写入方（`src/routes.ts`）
- [worktree-groups 知识库总览](../l1-architecture/worktree-groups-knowledge-base.md) —— L1 架构层：模块划分与数据流全景

> 注：以上 L1 / L2 / Routes 三份文档由其他任务产出，本文件仅按规定链接路径引用，未读取其内容。
