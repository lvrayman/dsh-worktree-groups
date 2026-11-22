---
生成时间: 2026-09-22
更新时间: 2026-09-22
git-version: 9bd94252dd934c2fa8491977285e461b703f0f3e
git-module-path: src
level: L2
---

# ServerHost 模块技术文档

> 模块路径：`src`（宿主侧服务端）
> 本文档为模块的组件目录和流程摘要，详细实现见各组件的 L3 文档。

本文覆盖 `dsh-worktree-groups` 插件的**宿主半边**（运行在 DSH 宿主进程内的服务端部分），
即 `src/index.ts`、`src/routes.ts`、`src/projects.ts`、`src/git.ts`、`src/ledger.ts`、
`src/types.ts` 六个文件。客户端半边（`client.tsx` / `sidebar.tsx` / `tree-model.ts` /
`locales.ts`）不属于本模块，其 L3 文档由 L1 层另行索引。

---

## 目录

- [模块概览](#模块概览)
- [架构设计](#架构设计)
- [组件索引](#组件索引)
- [关键流程摘要](#关键流程摘要)
- [依赖关系](#依赖关系)
- [平台适配](#平台适配)

---

## 模块概览

**模块名称**: `dsh-worktree-groups` 宿主半边（ServerHost）

**平台支持**: Node.js `>= 22`（`package.json` 的 `engines` 声明）。宿主为 DSH Desktop
（Electron 主进程侧的 Cordis 插件运行时），因此模块在 macOS / Windows / Linux 三种宿主桌面上
均需可用；宿主环境差异见[平台适配](#平台适配)。

**代码统计**（`git-version` 9bd9425 实测）：

- 文件数：6 个 TypeScript 文件
- 总行数：2924 行
- 逐文件行数：`src/routes.ts` 1679、`src/projects.ts` 486、`src/git.ts` 336、
  `src/ledger.ts` 292、`src/types.ts` 81、`src/index.ts` 50
- 运行时依赖：无第三方 `dependencies`（`package.json` 的 `dependencies` 为空对象）；
  `@deepseek-ai/cordis` 仅为 `peerDependencies`，且全包无运行时静态 import：3 处
  `import type { Context }` 均为 type-only（`src/index.ts:20`、`src/routes.ts:29`、
  `src/client.tsx:54`），编译后消失

### 模块职责

ServerHost 模块负责：

1. **插件装配与 HTTP 路由注册**：作为 Cordis 插件被宿主加载，声明对宿主 `webServer` 的硬依赖，
   并把全部 5 个 HTTP 端点注册到 `/dsh-worktree-groups/` 命名空间下；宿主服务缺失时静默降级，
   绝不让插件加载失败。
2. **侧栏树快照组装**：把四类宿主事实（全量历史会话、实时会话状态、工作区注册表、git worktree
   扫描）合并成一份树载荷，并按归属规则把每个会话分配到项目 / worktree / history 桶 / 未分组。
3. **worktree 生命周期管理**：响应创建与删除请求，调用 git 完成 worktree 的落地与移除，并同步
   在宿主工作区注册表中登记或注销对应工作区。
4. **台账持久化与死工作区清扫**：把「插件见过的 worktree」与「会话归属快照」写入本地 JSON 台账，
   使目录被外部删除后会话仍能归位；同时自动注销「目录已死且确证为非主工作树」的工作区记录。
5. **安全边界守护**：对全部接受本机路径的端点实施白名单精确匹配、git 位置参数注入防护，以及
   目标路径的符号链接解析校验，确保调用方无法借端点在本机任意位置落盘或删除目录。

---

## 架构设计

下图只到「哪个组件调用哪个组件」的粒度，不展开任何组件内部步骤。

    +-----------------------------------------------------------+
    | 插件装配层                                                 |
    |   index.ts -- 插件入口（name / inject / apply）            |
    +----------------------------+------------------------------+
                                 | 装配期调用
    +----------------------------v------------------------------+
    | 路由与组装层                                               |
    |   routes.ts                                               |
    |     |- 路由注册（5 个 exact 路由，逐个独立 effect）         |
    |     |- 快照组装（宿主事实合并 + 会话归属）                  |
    |     |- 安全校验（白名单 / git 参数 / 目标路径与符号链接）    |
    |     +- 台账回写 + 死工作区清扫                              |
    +------+--------------+--------------+----------------------+
           |              |              |
    +------v-----+  +-----v------+  +----v-------+
    | git.ts     |  | projects.ts|  | ledger.ts  |
    | 子进程与    |  | 项目与      |  | 台账读写与  |
    | worktree   |  | worktree   |  | 串行化      |
    | 扫描        |  | 合成        |  |            |
    +------+-----+  +-----+------+  +----+-------+
           |              |              |
           +--------------+--------------+
                          | 共享结构定义
                 +--------v---------+
                 | types.ts（纯类型）|
                 +------------------+

    -- 宿主侧依赖（全部经 ctx.get 运行时获取，缺失即降级）--
      webServer / workspaceRegistry / sessionPersistence /
      sessionController / sessions / logger

层次说明：

- **插件装配层**只有 `index.ts` 一个文件，不承载任何业务逻辑，只负责声明依赖姿态与调用下游。
- **路由与组装层**只有 `routes.ts` 一个文件，但它同时承担路由注册、宿主事实收集、安全校验与
  台账回写四件事，是模块内体量最大（1679 行）也最需要按功能面阅读的组件。
- **能力组件层**是三个互不依赖的独立能力：`git.ts`（进程与扫描）、`projects.ts`（纯逻辑合成）、
  `ledger.ts`（持久化）。三者只依赖 `types.ts`，彼此之间不存在循环调用。
- `types.ts` 是纯类型声明文件，不含运行时代码与 IO，被宿主半边三个能力组件共享。

---

## 组件索引

下表与 `docs/knowledge/l3-components/` 磁盘实际文件严格对应。本模块共 11 份 L3 文档，
覆盖 6 个源文件；其中 `routes.ts`（1679 行）与 `ledger.ts`（292 行）按 500 行拆分规则
拆为「概览 + 子文档」形态，故 `Routes` 占 4 份、`Ledger` 占 3 份。

| 组件 / 文件 | 文件路径 | 一句话职责 | L3 文档链接 |
|---|---|---|---|
| Index（插件入口） | `src/index.ts` | 声明插件名与硬依赖，装配期调用路由注册并对失败降级 | [Index技术文档.md](../l3-components/Index技术文档.md) |
| Routes（概览） | `src/routes.ts` | 宿主侧唯一入口层的总览与三份子文档的导航索引 | [Routes技术文档.md](../l3-components/Routes技术文档.md) |
| Routes-路由注册与契约 | `src/routes.ts` | 路由注册装配方式、5 个端点的请求响应契约与调用示例 | [Routes-路由注册与契约技术文档.md](../l3-components/Routes-路由注册与契约技术文档.md) |
| Routes-路径校验与安全边界 | `src/routes.ts` | 白名单精确匹配、git 参数注入防护、目标路径与符号链接校验 | [Routes-路径校验与安全边界技术文档.md](../l3-components/Routes-路径校验与安全边界技术文档.md) |
| Routes-快照组装与台账 | `src/routes.ts` | 宿主事实收集、会话行投影、扫描缓存、死工作区清扫与台账回写 | [Routes-快照组装与台账技术文档.md](../l3-components/Routes-快照组装与台账技术文档.md) |
| Projects（项目与 worktree 合成） | `src/projects.ts` | 把工作区、仓事实、台账与会话合成侧栏树并判定会话归属 | [Projects技术文档.md](../l3-components/Projects技术文档.md) |
| Git（子进程与扫描） | `src/git.ts` | 执行 git 命令、解析 worktree 列表、探测目录存在性与路径归一化 | [Git技术文档.md](../l3-components/Git技术文档.md) |
| Ledger（概览） | `src/ledger.ts` | 台账持久化的总览与两份子文档的导航索引 | [Ledger技术文档.md](../l3-components/Ledger技术文档.md) |
| Ledger-数据模型与接口 | `src/ledger.ts` | 台账的导出符号、磁盘格式与方法签名 | [Ledger-数据模型与接口技术文档.md](../l3-components/Ledger-数据模型与接口技术文档.md) |
| Ledger-持久化与并发 | `src/ledger.ts` | 台账的读写流程、串行化并发模型与边界条件 | [Ledger-持久化与并发技术文档.md](../l3-components/Ledger-持久化与并发技术文档.md) |
| Types（共享结构定义） | `src/types.ts` | 宿主半边三边共享的数据结构声明，纯类型无运行时代码 | [Types技术文档.md](../l3-components/Types技术文档.md) |

> 说明：`docs/knowledge/l3-components/` 下另有 `Client技术文档.md`、`Locales技术文档.md`、
> `Sidebar技术文档.md`、`TreeModel技术文档.md` 四份文档，对应 `src/client.tsx`、
> `src/locales.ts`、`src/sidebar.tsx`、`src/tree-model.ts`，属于**客户端半边**，
> 不在本模块范围内，故未列入上表。

---

## 关键流程摘要

以下流程只给名称、参与组件链与一句话描述；每一步的实现细节见对应的 L3 文档。

### 流程一 — 插件装配与路由注册

> 宿主加载插件后声明依赖姿态，再由路由注册组件把 5 个 HTTP 端点挂到宿主 webServer 上；
> 宿主服务缺席时整体降级为「什么都不注册」而不抛错。

**主要参与组件链**: `index.ts`（插件入口）→ `routes.ts`（路由注册面）→ 宿主 `webServer`

**详细实现见**：[Index技术文档.md](../l3-components/Index技术文档.md)、
[Routes-路由注册与契约技术文档.md](../l3-components/Routes-路由注册与契约技术文档.md)

### 流程二 — 快照组装（侧栏树载荷）

> 一次 `/tree` 请求内，先收集四类宿主事实与台账数据，再扫描 git 仓、构建路径白名单索引、
> 合成项目与 worktree 节点并完成会话归属判定，最后把本次观察回写台账。

**主要参与组件链**: `routes.ts`（快照组装与台账面）→ `ledger.ts`（读台账）→
`git.ts`（仓扫描）→ `projects.ts`（树合成与归属判定）→ `routes.ts`（回写台账）

**详细实现见**：[Routes-快照组装与台账技术文档.md](../l3-components/Routes-快照组装与台账技术文档.md)、
[Projects技术文档.md](../l3-components/Projects技术文档.md)

### 流程三 — worktree 创建

> 请求经「已知仓路径」白名单与目标路径双重校验后调用 git 建出 worktree，成功后把它注册为
> dsh 工作区；注册失败不影响创建结论，但必须以警告字段对用户可见。

**主要参与组件链**: `routes.ts`（worktree-create 处理器）→ `routes.ts`（安全校验面）→
`git.ts`（子进程执行）→ 宿主 `workspaceRegistry`

**详细实现见**：[Routes-路由注册与契约技术文档.md](../l3-components/Routes-路由注册与契约技术文档.md)、
[Routes-路径校验与安全边界技术文档.md](../l3-components/Routes-路径校验与安全边界技术文档.md)

### 流程四 — worktree 删除

> 请求须命中「已知 worktree 路径」且该路径**已注册为工作区**才被接受；git 移除失败且未带强制
> 标志时回传需要强制的信号，成功后注销对应工作区记录，但不删除分支。

**主要参与组件链**: `routes.ts`（worktree-remove 处理器）→ `routes.ts`（安全校验面）→
`git.ts`（子进程执行）→ 宿主 `workspaceRegistry`

**详细实现见**：[Routes-路由注册与契约技术文档.md](../l3-components/Routes-路由注册与契约技术文档.md)、
[Routes-路径校验与安全边界技术文档.md](../l3-components/Routes-路径校验与安全边界技术文档.md)

### 流程五 — 台账读写

> 台账以本地 JSON 文件为介质：读取失败一律降级为空台账，写入走原子替换，读-改-写经内部串行链
> 保证任一时刻只有一次在飞。

**主要参与组件链**: `routes.ts`（台账回写面）→ `ledger.ts`（读写与串行化）→ 本地文件系统

**详细实现见**：[Ledger-数据模型与接口技术文档.md](../l3-components/Ledger-数据模型与接口技术文档.md)、
[Ledger-持久化与并发技术文档.md](../l3-components/Ledger-持久化与并发技术文档.md)

### 流程六 — 死工作区自动清扫

> 在合成树之前，先把「目录已死、且有正面证据表明是非主工作树」的工作区记录从宿主注册表注销，
> 使其会话当轮即落入 history 桶；注销失败只记日志，不阻塞渲染。

**主要参与组件链**: `routes.ts`（快照组装与台账面）→ 宿主 `workspaceRegistry` →
`projects.ts`（history 桶归属）

**详细实现见**：[Routes-快照组装与台账技术文档.md](../l3-components/Routes-快照组装与台账技术文档.md)

### 流程七 — 目录已死会话的归位

> 当某 worktree 目录被外部删除后，先用台账记录把会话接回所属项目，台账缺失时再用路径命名启发
> 兜底；两条路径都不命中则进未分组，绝不静默丢会话。

**主要参与组件链**: `projects.ts`（归属判定）→ `ledger.ts`（归属快照）→ `routes.ts`（未分组兜底）

**详细实现见**：[Projects技术文档.md](../l3-components/Projects技术文档.md)

---

## 依赖关系

**依赖的模块**（本模块内部与宿主侧）：

- 宿主服务 `webServer` —— 路由注册的硬依赖（写入插件 `inject`），缺席即不注册任何路由
- 宿主服务 `workspaceRegistry` / `sessionPersistence` / `sessionController` / `sessions` ——
  软依赖，经运行时获取，缺席时对应数据源为空并降级
- 宿主服务 `logger` —— 可选，用于告警输出，不可用时静默
- 本包客户端半边（`client.tsx` 等）—— **不被本模块依赖**；方向相反，客户端通过本模块注册的
  HTTP 端点取数

**被依赖方**（known consumers）：

- `src/client.tsx` 及其下游 `sidebar.tsx` —— 客户端半边调用本模块注册的 `/tree`、
  `/worktree-create`、`/worktree-remove`、`/reveal`、`/workspace-open` 五个端点
- DSH 宿主 profile 的 bundle 装配 —— 通过 `cordis.patch.yml` 声明的 insert 条目加载本插件
- 仓库测试（`test/` 下）—— 直接调用本模块导出的处理器与组装函数做隔离验证

**关键外部库**：

- 无运行时第三方依赖（`package.json` 的 `dependencies` 为空）
- `@deepseek-ai/cordis` —— 仅 peer 依赖，全包 3 处静态引入（`src/index.ts:20`、
  `src/routes.ts:29`、`src/client.tsx:54`）全部是 type-only，编译后消失；
  运行时宿主服务一律经 `ctx.get(name)` 获取，避免 Service 基类身份分裂
- Node.js 内置模块 —— 子进程执行、文件系统读写、路径处理、os 家目录解析
- git 可执行文件 —— 外部命令依赖，按候选顺序探测，全部失败时报错

---

## 平台适配

本模块是宿主进程侧代码，不存在 Android / iOS 之分，但**宿主桌面平台差异**确实存在：

| 功能面 | 平台差异与处理 |
|---|---|
| 文件管理器定位（reveal） | macOS 走 `open -R`；Windows 走 `explorer /select,`；其余平台退化为 `xdg-open` 打开所在目录（Linux 无「选中」语义）。命令一律用数组参数，不经 shell |
| 路径分隔符与尾斜杠 | 全模块统一以 `git.ts` 的路径归一化作为唯一比较基准：绝对化、反斜杠转正斜杠、去尾斜杠；文件系统根与 Windows 盘根保留唯一斜杠 |
| 符号链接 | macOS 上 `/var` 与 `/private/var` 等拼法差异会导致同一路径出现两种写法，快照组装为白名单与仓查找维护同源路径表以保持一致；目标路径校验另做真实路径解析以防符号链接绕过 |
| git 可执行文件位置 | 候选顺序为 PATH 裸名 `git`，再退到 macOS/Linux 常见绝对安装位置；裸名优先以兼容 nvm/asdf 等自管 PATH 场景 |
| 非 ASCII 路径 | git 命令统一附加禁用路径转义的配置，避免中文等路径被转义成八进制 |
| 宿主 profile 差异 | 非 web profile 下 `webServer` 缺席，插件静默降级为不注册路由，不抛错 |

**N/A 说明**：移动端平台适配（Android / iOS / 鸿蒙）对本模块**不适用**——本模块只运行在
Node.js 宿主进程中，与移动端无关。

---

## 相关文档

- [worktree-groups 知识库（L1 架构）](../l1-architecture/worktree-groups-knowledge-base.md) —— 本模块所在的域架构总览
- [Routes 技术文档（概览）](../l3-components/Routes技术文档.md) —— 本模块体量最大组件的入口
- [Ledger 技术文档（概览）](../l3-components/Ledger技术文档.md) —— 台账组件的入口
- [Types 技术文档](../l3-components/Types技术文档.md) —— 模块内共享数据结构清单
