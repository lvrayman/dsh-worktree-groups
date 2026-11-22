---
更新时间: 2026-09-22
git-version: 9bd94252dd934c2fa8491977285e461b703f0f3e
git-module-path: src
level: index
---

# worktree-groups 知识库总索引

> 更新时间: 2026-09-22
> 文档总数: **22 篇**（不含本索引自身；L1 架构 1 篇 + L2 模块 3 篇 + L3 组件 18 篇）
> 覆盖域: `src/`，git-version `9bd9425`
> 本文件只做**分层索引与检索导航**，不承载实现细节；正文一律落在被链接的文档中。

> ⚠️ **2026-09-23 局部修订声明**：本次修复「侧栏右键菜单渲染裸 key」缺陷时，对以下 4 篇文档做了
> **定点修订**（`git-version` 锚点仍为 `9bd9425`，未标注修订的行号锚点均对应该版本；当前 `src/` 已
> 领先于该锚点）：
> [Client技术文档](./l3-components/Client技术文档.md)（词典注册姿势）、
> [Locales技术文档](./l3-components/Locales技术文档.md)（新增 `createSeatT` / `Translate`）、
> [Sidebar技术文档](./l3-components/Sidebar技术文档.md)（取词入口兜底）、
> [WebClient模块技术文档](./l2-modules/WebClient模块技术文档.md)（流程四：文案本地化）。
> 变更记录与证据：`docs/worklog/2026-09-23-sidebar-menu-raw-keys.md`、`docs/HOST-CONTRACTS.md` §B4.4。

> ⚠️ **2026-10-19 新增声明**：本次修复「启用插件后侧栏整块渲染失败」缺陷时**新增 1 篇**
> [Icons技术文档](./l3-components/Icons技术文档.md)（`src/icons.ts`：宿主 primitives 图标解析层），
> 并把 [Sidebar技术文档](./l3-components/Sidebar技术文档.md) 的图标取用口径改为「一律经 `icon()`」。
> 根因是宿主 `primitives` 从 `0.1.5-rc.2` 升到 `0.2.1-rc.2` 时把图标导出从尺寸后缀
> （`IconPlusOutline16`）改成线重后缀（`IconPlusOutlineRegular`/`Medium`），插件里 17 个
> `P.Icon*` 全部变成 `undefined` ⇒ 渲染期 `Element type is invalid`。
> 变更记录与证据：`docs/worklog/2026-10-19-sidebar-render-failure-icons.md`、
> `docs/HOST-CONTRACTS.md` §B5.1 顶部漂移说明与硬约束第 25 条、`docs/INTERFACES.md` §2.3.0。

> ⚠️ **2026-10-19 同轮第 2 处漂移**：新增
> [LiveState技术文档](./l3-components/LiveState技术文档.md)（`src/live-state.ts`）。
> 宿主 `0.2.1-rc.2` **删除了** root hook `useSessionPendingInteraction`，`useSessions().byId`
> 条目也**不再有 `completed` 字段** ⇒ 侧栏「等待确认琥珀态」与「后台完成未读绿点」拿不到数据
> （不崩但永远不亮）。取数逻辑已从 `sidebar.tsx` 抽成纯逻辑模块（以前埋在 `.tsx` 里，零单测），
> 改为 `useSessionStatus` 优先、旧源兜底。
> 证据：同份工作记录、`docs/HOST-CONTRACTS.md` 硬约束第 26 条、`docs/INTERFACES.md` §2.3.2。

> ⚠️ **2026-10-29 新增**：[Activity技术文档](./l3-components/Activity技术文档.md)
> （`src/activity.ts`）。宿主 `updatedAt` 只随用户发言推进（`updatedAt = max(createdAt, lastPromptAt)`），
> 助手回复/工具/子代理活动不改变它 ⇒ 「最近」分区无法让持续更新的会话上浮。新增宿主 `session/event`
> 活动表，载荷给每条 `SessionRow` 补 `lastActivityAt`（沿 `parentSessionId` 传播祖先），
> 「最近」分区改按它排序（工作区树顺序不变）。证据：
> [工作记录](../worklog/2026-10-29-recent-any-activity-sort.md)、`docs/INTERFACES.md` §1.7 / §2.3.3。

---

## 1. L1 架构（1 篇）

| 文档链接 | 模块或类 | 核心内容摘要 |
|---|---|---|
| [worktree-groups 知识库](./l1-architecture/worktree-groups-knowledge-base.md) | 全域架构（`src/`） | 域概述、四层架构分层、模块索引、跨模块流程与设计约定，是全库的顶层入口。 |

---

## 2. L2 模块（3 篇）

| 文档链接 | 模块或类 | 核心内容摘要 |
|---|---|---|
| [ServerHost 模块技术文档](./l2-modules/ServerHost模块技术文档.md) | 宿主半边（`src/index.ts` 等 6 个源文件） | 宿主侧插件装配、HTTP 端点、快照组装、worktree 生命周期与台账持久化的模块级概览。 |
| [WebClient 模块技术文档](./l2-modules/WebClient模块技术文档.md) | 浏览器端半边（`src/client.tsx` 等 5 个源文件） | 侧栏槽位抢占、渲染层、树推导与文案层的模块级概览及数据来源链路。 |
| [TreeModel 模块技术文档](./l2-modules/TreeModel模块技术文档.md) | 树推导纯逻辑（`src/tree-model.ts`） | 渲染行推导、三层手动顺序、运行时顶部区与截断逻辑的导出符号逐个索引。 |

---

## 3. L3 组件（18 篇）

| 文档链接 | 模块或类 | 核心内容摘要 |
|---|---|---|
| [Index 技术文档](./l3-components/Index技术文档.md) | 宿主入口（`src/index.ts`） | 插件的声明式装配点：标识、硬依赖与把装配转交路由注册，缺失即降级。 |
| [Routes 技术文档（概览）](./l3-components/Routes技术文档.md) | 路由层（`src/routes.ts`） | 路由层拆分后的概览与子文档索引，给出全局特性与依赖全貌。 |
| [Routes-路由注册与契约技术文档](./l3-components/Routes-路由注册与契约技术文档.md) | 路由层（`src/routes.ts`） | 路由注册与装配、路由清单、各端点的请求响应契约与错误码。 |
| [Routes-路径校验与安全边界技术文档](./l3-components/Routes-路径校验与安全边界技术文档.md) | 路由层（`src/routes.ts`） | 白名单精确匹配、git 参数注入防护、目标路径与符号链接校验及其失败分支。 |
| [Routes-快照组装与台账技术文档](./l3-components/Routes-快照组装与台账技术文档.md) | 路由层（`src/routes.ts`） | 宿主事实收集与快照组装、会话行投影、失效工作区清扫与台账更新、扫描缓存。 |
| [Projects 技术文档](./l3-components/Projects技术文档.md) | 项目合成（`src/projects.ts`） | 把工作区注册表、git 事实、台账与会话快照合成为三级树，含归属规则与路径归一化。 |
| [Git 技术文档](./l3-components/Git技术文档.md) | git 访问底座（`src/git.ts`） | git 子进程封装、worktree 列表解析、可执行文件探测与失败分级容错。 |
| [Ledger 技术文档（概览）](./l3-components/Ledger技术文档.md) | 台账持久化（`src/ledger.ts`） | 台账拆分后的概览与导航，汇总持久化策略、并发模型与边界要点。 |
| [Ledger-数据模型与接口技术文档](./l3-components/Ledger-数据模型与接口技术文档.md) | 台账持久化（`src/ledger.ts`） | 导出符号清单、磁盘格式、运行时依赖、被谁装配与接口签名。 |
| [Ledger-持久化与并发技术文档](./l3-components/Ledger-持久化与并发技术文档.md) | 台账持久化（`src/ledger.ts`） | 读写执行流程、状态机、串行化并发模型、边界条件与已知缺陷。 |
| [Client 技术文档](./l3-components/Client技术文档.md) | 客户端入口（`src/client.tsx`） | 客户端半边插件入口：抢占侧栏槽位、声明子槽位与词典、桥接宿主客户端服务。 |
| [Activity 技术文档](./l3-components/Activity技术文档.md) | 会话最后更新时间（`src/activity.ts`） | 宿主 `session/event` 活动表（LRU 4096）、id 归一化、祖先传播、`lastActivityAt` 回退与降级。 |
| [LiveState 技术文档](./l3-components/LiveState技术文档.md) | live-fact 取数（`src/live-state.ts`） | 会话行「等待确认 / 后台完成未读」的数据源漂移史、新源优先与旧源兜底、kind 白名单、id 拼法归一化。 |
| [Icons 技术文档](./l3-components/Icons技术文档.md) | 图标解析（`src/icons.ts`） | 宿主 primitives 图标解析层：命名漂移史、候选表（新旧命名兼容）、缺席回落空图标、引用稳定与漂移哨兵。 |
| [Sidebar 技术文档](./l3-components/Sidebar技术文档.md) | 侧栏渲染（`src/sidebar.tsx`） | 三级树的 DOM 渲染、搜索、展开态持久化、三层拖拽排序、右键菜单与弹窗。 |
| [TreeModel 技术文档](./l3-components/TreeModel技术文档.md) | 树推导（`src/tree-model.ts`） | 零依赖纯逻辑：可见性判定、行序列推导、三层手动排序与运行时顶部区状态机。 |
| [Locales 技术文档](./l3-components/Locales技术文档.md) | 文案层（`src/locales.ts`） | 中文词条表与取词函数工厂：占位符替换、缺 key 回退与原型链安全。 |
| [Types 技术文档](./l3-components/Types技术文档.md) | 共享类型（`src/types.ts`） | 宿主半边共享数据结构的类型定义清单，作为跨半边契约的宿主侧一半。 |

---

## 4. 快速检索：按问题类型

| 问题类型 | 建议阅读顺序 |
|---|---|
| 插件如何装配与注册路由 | [Index 技术文档](./l3-components/Index技术文档.md) → [Routes 技术文档（概览）](./l3-components/Routes技术文档.md) → [Routes-路由注册与契约技术文档](./l3-components/Routes-路由注册与契约技术文档.md) |
| 有哪些 HTTP 路由与参数校验规则 | [Routes-路由注册与契约技术文档](./l3-components/Routes-路由注册与契约技术文档.md) → [Routes-路径校验与安全边界技术文档](./l3-components/Routes-路径校验与安全边界技术文档.md) |
| 会话如何分组到 worktree | [Projects 技术文档](./l3-components/Projects技术文档.md) → [TreeModel 技术文档](./l3-components/TreeModel技术文档.md) |
| 拖拽排序如何落库 | [Sidebar 技术文档](./l3-components/Sidebar技术文档.md) → [TreeModel 技术文档](./l3-components/TreeModel技术文档.md) → [Ledger 技术文档（概览）](./l3-components/Ledger技术文档.md) |
| 运行态顶部区如何聚合 | [TreeModel 技术文档](./l3-components/TreeModel技术文档.md) → [Sidebar 技术文档](./l3-components/Sidebar技术文档.md) |
| 台账如何持久化与并发 | [Ledger 技术文档（概览）](./l3-components/Ledger技术文档.md) → [Ledger-持久化与并发技术文档](./l3-components/Ledger-持久化与并发技术文档.md) |
| 文案如何本地化与新增 key | [Locales 技术文档](./l3-components/Locales技术文档.md) → [Client 技术文档](./l3-components/Client技术文档.md) |
| git 命令如何封装与容错 | [Git 技术文档](./l3-components/Git技术文档.md) → [Routes-快照组装与台账技术文档](./l3-components/Routes-快照组装与台账技术文档.md) |
| 类型契约有哪些 | [Types 技术文档](./l3-components/Types技术文档.md) → [Ledger-数据模型与接口技术文档](./l3-components/Ledger-数据模型与接口技术文档.md) |
| 客户端如何抢占侧栏槽位并渲染 | [Client 技术文档](./l3-components/Client技术文档.md) → [Sidebar 技术文档](./l3-components/Sidebar技术文档.md) → [WebClient 模块技术文档](./l2-modules/WebClient模块技术文档.md) |
| 宿主事实如何组装成树快照 | [Routes-快照组装与台账技术文档](./l3-components/Routes-快照组装与台账技术文档.md) → [Projects 技术文档](./l3-components/Projects技术文档.md) |
| 模块整体职责与边界 | [worktree-groups 知识库](./l1-architecture/worktree-groups-knowledge-base.md) → [ServerHost 模块技术文档](./l2-modules/ServerHost模块技术文档.md) / [WebClient 模块技术文档](./l2-modules/WebClient模块技术文档.md) / [TreeModel 模块技术文档](./l2-modules/TreeModel模块技术文档.md) |

---

## 5. 目录树与篇数

- `docs/knowledge/` — 共 **22 篇**（不含本索引）
  - `l1-architecture/` — **1 篇**
    - [worktree-groups-knowledge-base.md](./l1-architecture/worktree-groups-knowledge-base.md)
  - `l2-modules/` — **3 篇**
    - [ServerHost模块技术文档.md](./l2-modules/ServerHost模块技术文档.md)
    - [WebClient模块技术文档.md](./l2-modules/WebClient模块技术文档.md)
    - [TreeModel模块技术文档.md](./l2-modules/TreeModel模块技术文档.md)
  - `l3-components/` — **18 篇**
    - [Activity技术文档.md](./l3-components/Activity技术文档.md)
    - [Client技术文档.md](./l3-components/Client技术文档.md)
    - [Git技术文档.md](./l3-components/Git技术文档.md)
    - [Index技术文档.md](./l3-components/Index技术文档.md)
    - [Ledger技术文档.md](./l3-components/Ledger技术文档.md)（概览）
    - [Ledger-数据模型与接口技术文档.md](./l3-components/Ledger-数据模型与接口技术文档.md)
    - [Ledger-持久化与并发技术文档.md](./l3-components/Ledger-持久化与并发技术文档.md)
    - [Locales技术文档.md](./l3-components/Locales技术文档.md)
    - [Projects技术文档.md](./l3-components/Projects技术文档.md)
    - [Routes技术文档.md](./l3-components/Routes技术文档.md)（概览）
    - [Routes-路由注册与契约技术文档.md](./l3-components/Routes-路由注册与契约技术文档.md)
    - [Routes-路径校验与安全边界技术文档.md](./l3-components/Routes-路径校验与安全边界技术文档.md)
    - [Routes-快照组装与台账技术文档.md](./l3-components/Routes-快照组装与台账技术文档.md)
    - [Sidebar技术文档.md](./l3-components/Sidebar技术文档.md)
    - [TreeModel技术文档.md](./l3-components/TreeModel技术文档.md)
    - [Types技术文档.md](./l3-components/Types技术文档.md)

**合计**：1（L1）+ 3（L2）+ 18（L3）= **22 篇**，本索引不计入。

---

## 6. 相关文档（知识库之外）

- [文档总索引](../README.md)
- [需求主文档 PRD](../PRD.md)
- [接口契约](../INTERFACES.md)
- [宿主契约核实报告](../HOST-CONTRACTS.md)
