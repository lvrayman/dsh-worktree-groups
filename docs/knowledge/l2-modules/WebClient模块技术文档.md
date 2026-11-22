---
生成时间: 2026-09-22
更新时间: 2026-09-22
git-version: 9bd94252dd934c2fa8491977285e461b703f0f3e
git-module-path: src
level: L2
---

> ⚠️ **2026-10-19 定点修订**：新增 `src/icons.ts`（宿主 primitives 图标解析层），
> 作为本模块第 5 个运行时文件；`src/sidebar.tsx` 的图标取用改为**一律经 `icon()`**。
> 根因：宿主 `primitives` 升到 `0.2.1-rc.2` 后图标导出从尺寸后缀改成线重后缀，
> 原 17 处 `P.Icon*` 直接取用全部 `undefined` ⇒ 渲染期崩溃 ⇒ 侧栏整块失败。
> 详见 [Icons技术文档](../l3-components/Icons技术文档.md) 与
> `docs/worklog/2026-10-19-sidebar-render-failure-icons.md`。
> 同轮还新增 `src/live-state.ts`（会话 live-fact 取数），见
> [LiveState技术文档](../l3-components/LiveState技术文档.md)。
> 下文「4 个运行时代码文件」等统计为**修订前**口径。

# WebClient 模块技术文档

> 模块路径：`src`（浏览器端插件）
> 本文档为模块的组件目录和流程摘要，详细实现见各组件的 L3 文档。

本文覆盖 `dsh-worktree-groups` 插件的**浏览器端半边**（WebClient），即运行在 DSH 客户端
shell 渲染进程里的部分：`src/client.tsx`、`src/sidebar.tsx`、`src/tree-model.ts`、
`src/locales.ts`，外加一个只参与编译期类型检查的 `src/client-shims.d.ts`。
宿主进程侧（`index.ts` / `routes.ts` / `projects.ts` / `git.ts` / `ledger.ts` / `types.ts`）
不属于本模块，见 [ServerHost 模块技术文档](./ServerHost模块技术文档.md)。

---

## 目录

- [模块概览](#模块概览)
- [架构设计](#架构设计)
- [组件索引](#组件索引)
- [关键流程摘要](#关键流程摘要)
- [依赖关系](#依赖关系)
- [平台适配](#平台适配)
- [相关文档](#相关文档)

---

## 模块概览

**模块名称**: `dsh-worktree-groups` 浏览器端半边（WebClient）

**平台支持**: Web —— 运行在 DSH Desktop 客户端 shell 的浏览器渲染进程内，由宿主
`dsh-client-modules` 以包名 `dsh-worktree-groups` 为 entry id 加载客户端构建产物。
移动端（Android / iOS / 鸿蒙）**N/A**，原因见[平台适配](#平台适配)。
Node 仅作为**测试进程**出现：`src/tree-model.ts` 与 `src/locales.ts` 是零依赖纯逻辑，
其编译产物可被 `node --test` 直接加载做行为覆盖。

**代码统计**（统计基准：`git-version` 锚定的工作区实测）：

| 项 | 数值 | 依据 |
|---|---|---|
| 运行时代码文件数 | 4 个 TypeScript / TSX 文件 | `src/client.tsx`、`src/sidebar.tsx`、`src/tree-model.ts`、`src/locales.ts` |
| 编译期类型文件数 | 1 个声明文件（无运行时代码） | `src/client-shims.d.ts` |
| 运行时代码行数 | 5632 行 | `wc -l` 四个运行时代码文件之和 |
| 含类型 shim 行数 | 5686 行 | `wc -l src/client.tsx src/sidebar.tsx src/tree-model.ts src/locales.ts src/client-shims.d.ts` |
| 逐文件行数 | `src/sidebar.tsx` 2895、`src/tree-model.ts` 2379、`src/client.tsx` 257、`src/locales.ts` 101、`src/client-shims.d.ts` 54 | 同上 |
| 客户端构建产物 | 1 个 bundle（`lib/client.js`），由 esbuild 从 `src/client.tsx` 打出 | `scripts/build-client.mjs`；`lib/sidebar.js` **不存在**，`sidebar.tsx` 被内联进该 bundle |
| 第三方运行时依赖 | 无（`package.json` 的 `dependencies` 为空） | `package.json` |

### 模块职责

WebClient 模块负责：

1. **客户端插件装配与宿主侧栏抢占**：作为浏览器端 Cordis 插件被宿主加载，向宿主的侧栏槽位
   注册一个**比官方侧栏更低优先级**的条目以取得该槽位的渲染权，并声明一个自建的子槽位键
   供「添加工作区」流程挂载，同时注册本插件自有的词典命名空间。
2. **侧栏渲染**：把「项目 → worktree → 会话」三级树、搜索框、右键菜单、弹窗与拖拽插入线
   画成 DOM，并自带错误边界，避免异常逃逸到宿主槽位边界而导致整个条目被剔除、静默回落官方侧栏。
3. **渲染行推导（纯逻辑）**：把宿主「项目 / worktree / 会话」原始数据摊平成渲染行序列，
   承担展开折叠、截断与「更多」行、搜索扁平化、子代理聚合、未分组容器合成、三层手动排序
   与运行时顶部区推导；渲染层不参与任何推导。
4. **文案本地化**：维护中文词条表与取词函数工厂，为渲染层提供永不抛错的取词入口，
   并在宿主语言服务缺席时按组件内的兜底词条表降级。
5. **宿主客户端服务桥接与降级**：把宿主客户端服务（槽位、工作区、会话、工作区 UI 动作、
   语言）包成组件使用的桥接门面；每个服务在**调用时**才惰性读取，缺席时降级而不抛，
   避免宿主升级导致插件加载失败。
6. **交互态持久化**：把展开态与三层手动排序结果写入浏览器本地存储，跨刷新保持；
   隐私模式或存储被禁用时静默退化为本次会话的内存态。

---

## 架构设计

下图只到「哪个组件调用哪个组件」的粒度，不展开任何组件内部步骤，也不列方法名。

    +-------------------------------------------------------------------+
    | 宿主客户端 shell（DSH Web 前端组合）                               |
    |  侧栏外壳 sidebar  ·  槽位服务 slots  ·  locale  ·  工作区/会话服务 |
    +--------------------------------+----------------------------------+
                                     | 渲染 sidebar.workspaces 槽位
    +--------------------------------v----------------------------------+
    | ① 装配层   src/client.tsx                                          |
    |    插件入口 · 槽位抢占注册 · 宿主服务桥接门面 · 词典注册            |
    +--------------------------------+----------------------------------+
                                     | 注入桥接门面 / 取词 / 槽位传入的宿主入口
    +--------------------------------v----------------------------------+
    | ② 渲染层   src/sidebar.tsx                                         |
    |    主组件 · 错误边界 · 轨道态入口 · 行组件 · 菜单层 · 三个弹窗      |
    |    本地存储读写 · 拖拽接线                                         |
    +----------+--------------------------------------+-----------------+
               | 取行序列 / 顺序 / 顶部区              | 取词
    +----------v--------------------+   +-------------v-----------------+
    | ③ 推导层   src/tree-model.ts  |   | ④ 文案层   src/locales.ts     |
    |    行推导 · 三层排序 · 顶部区  |   |    中文词条表 · 取词函数工厂   |
    |    截断 · 子代理聚合 · 搜索    |   |    （零依赖纯逻辑）            |
    +-------------------------------+   +-------------------------------+
               |
               | 取数（渲染层直接发起）
    +----------v--------------------------------------------------------+
    | 宿主 HTTP 端点（由 ServerHost 模块注册，前缀统一）                  |
    |    树快照 · worktree 创建/移除 · 文件管理器定位 · 工作区登记        |
    +-------------------------------------------------------------------+

    -- 编译期支撑（不含运行时代码）--
      src/client-shims.d.ts -- react / react/jsx-runtime /
                               @deepseek-ai/dsh-client-ui-primitives 的最小类型声明

层次说明：

- **装配层**只有 `client.tsx` 一个文件：只做注册与门面构造，不含任何渲染或推导逻辑；
  它是本模块与宿主槽位服务之间的唯一接触点。
- **渲染层**只有 `sidebar.tsx` 一个文件，却是模块内体量最大的组件（2895 行）：
  它同时承担画行、交互、本地存储与拖拽接线，因此是需要按功能面阅读的组件。
- **推导层**与**文案层**是**零依赖纯逻辑**，不 import react、不 import 宿主包、不做 IO，
  只被渲染层消费；两者的编译产物可被 `node --test` 直接覆盖。
- **数据面**由渲染层直接发起：树快照经宿主 HTTP 端点获取，宿主快照订阅只用于驱动重取与
  补实时状态，不承担分组推导。
- `client-shims.d.ts` 只在编译期存在，编译后消失；它使本模块在不引入宿主类型包的前提下
  通过类型检查。

---

## 组件索引

下表与 `docs/knowledge/l3-components/` 磁盘实际文件严格对应（以 `ls` 结果为准）。
本模块共 4 份 L3 文档，覆盖 4 个运行时代码文件；`client-shims.d.ts` 为纯类型声明，
尚无独立 L3 文档，其存在理由记录在本节与[平台适配](#平台适配)。

| 组件 / 文件 | 文件路径 | 一句话职责 | L3 文档链接 |
|---|---|---|---|
| Client（客户端插件入口） | `src/client.tsx` | 向宿主侧栏槽位以更低优先级注册本插件条目，并构造宿主客户端服务的桥接门面 | [Client技术文档.md](../l3-components/Client技术文档.md) |
| Sidebar（侧栏渲染组件） | `src/sidebar.tsx` | 把推导出的行序列画成三级侧栏树，并承载搜索、菜单、弹窗、拖拽与本地存储读写 | [Sidebar技术文档.md](../l3-components/Sidebar技术文档.md) |
| TreeModel（树推导纯逻辑） | `src/tree-model.ts` | 由宿主原始数据推导渲染行序列、三层顺序、顶部区与截断，供渲染层直接消费 | [TreeModel技术文档.md](../l3-components/TreeModel技术文档.md) |
| Locales（词条表与取词） | `src/locales.ts` | 冻结中文界面文案并提供永不抛错的取词函数工厂 | [Locales技术文档.md](../l3-components/Locales技术文档.md) |
| Icons（图标解析层） | `src/icons.ts` | 把逻辑图标名解析成当前宿主真实存在的 primitives 导出，新旧命名兼容、全缺回落空图标 | [Icons技术文档.md](../l3-components/Icons技术文档.md) |
| LiveState（会话 live-fact） | `src/live-state.ts` | 从客户端快照取「等待确认 / 后台完成未读」：`useSessionStatus` 优先、旧源兜底、kind 白名单 | [LiveState技术文档.md](../l3-components/LiveState技术文档.md) |
| 客户端类型 shim | `src/client-shims.d.ts` | 为宿主注入的 react / jsx-runtime / UI 原语声明本包实际用到的最小类型面 | （暂无 L3 文档；纯类型声明，无运行时行为） |

> 说明：`src/tree-model.ts` 另有独立的模块级 L2 文档
> [TreeModel 模块技术文档](./TreeModel模块技术文档.md)，从「导出符号逐个索引」的角度组织；
> 本文档从「浏览器端半边整体」的角度索引，两者互为补充而非重复。

---

## 关键流程摘要

以下每条只给一句话描述、参与组件链与实现入口，不含任何步骤细节、签名或参数。

### 流程一 — 客户端插件装配与侧栏挂载

> 宿主加载客户端条目后，插件等目标槽位就绪，再以更低优先级注册自己的侧栏条目并声明自建
> 子槽位与词典命名空间，同时把宿主客户端服务包成桥接门面交给渲染组件。

**主要参与组件链**: `client.tsx`（注册与门面）→ 宿主槽位服务 → `sidebar.tsx`（被挂载的组件）

**详细实现见**：[Client技术文档.md](../l3-components/Client技术文档.md)

### 流程二 — 渲染与分组展示

> 渲染组件取到树快照后交给推导层摊平成行序列，再逐行画成「项目 → worktree / history /
> 未分组 → 会话」三级树，并处理搜索、截断、子代理聚合与轨道态分支。

**主要参与组件链**: `sidebar.tsx`（取数与画行）→ `tree-model.ts`（行推导）→ `locales.ts`（取词）

**详细实现见**：[Sidebar技术文档.md](../l3-components/Sidebar技术文档.md)、
[TreeModel技术文档.md](../l3-components/TreeModel技术文档.md)

### 流程三 — 拖拽排序

> 三层（项目 / worktree / 会话）均可拖拽重排：拖动与落点只在同层同范围内被接受，落点换算
> 成功后把新的手动顺序固化到本地存储，并提供「恢复默认排序」入口切回默认顺序。

**主要参与组件链**: `sidebar.tsx`（拖拽接线与范围判定）→ `tree-model.ts`（落点换算与
三层生效顺序）→ 浏览器本地存储

**详细实现见**：[Sidebar技术文档.md](../l3-components/Sidebar技术文档.md)、
[TreeModel技术文档.md](../l3-components/TreeModel技术文档.md)

### 流程四 — 文案本地化

> 插件注册自有词典命名空间并声明条目语言，渲染层从宿主取词入口拿取文案；宿主语言服务缺席时
> 组件内以兜底词条表降级，缺词条时返回词条键本身而不抛错。
>
> ⚠️ **2026-09-23 修订**：注册改为**等 locale 服务出现**再执行（`ctx.inject(['locale'], …)`），
> 不再是 apply 时的一次性探测；渲染层取词入口先过 `createSeatT` 兜底（seat 解不出就回落内置中文）。
> 原因是 entry 并发创建导致的注册竞态会让侧栏满屏裸 key —— 详见
> `docs/worklog/2026-09-23-sidebar-menu-raw-keys.md`。

**主要参与组件链**: `client.tsx`（注册词典与声明语言）→ `locales.ts`（词条表与取词工厂 + `createSeatT` 兜底）→
`sidebar.tsx`（取词并渲染）

**详细实现见**：[Locales技术文档.md](../l3-components/Locales技术文档.md)、
[Client技术文档.md](../l3-components/Client技术文档.md)

### 流程五 — 树数据取数与刷新

> 渲染层向宿主 HTTP 端点请求树快照，并按固定间隔与窗口聚焦事件强刷；宿主快照变化经防抖后
> 触发重取，重取结果同时用于驱动推导与补实时状态。

**主要参与组件链**: `sidebar.tsx`（请求与刷新编排）→ 宿主 HTTP 端点（ServerHost 模块）→
`tree-model.ts`（行推导）

**详细实现见**：[Sidebar技术文档.md](../l3-components/Sidebar技术文档.md)、
[ServerHost 模块技术文档](./ServerHost模块技术文档.md)

### 流程六 — 展开态与顶部区维护

> 展开态按容器独立记录并写入本地存储；容器内「正在运行」的会话由推导层固定在所属容器最前且
> 不可拖动，该置顶是纯运行时推导，刷新即重置、不写入持久化存储。

**主要参与组件链**: `sidebar.tsx`（展开态读写与观测推进）→ `tree-model.ts`（顶部区推导）→
浏览器本地存储

**详细实现见**：[TreeModel技术文档.md](../l3-components/TreeModel技术文档.md)、
[Sidebar技术文档.md](../l3-components/Sidebar技术文档.md)

---

## 依赖关系

**依赖的模块**（模块内与宿主侧）：

- `src/sidebar.tsx` → `src/tree-model.ts` / `src/locales.ts` —— 渲染层消费推导层与文案层，
  是模块内唯一的生产依赖边；`src/client.tsx` → `src/sidebar.tsx` / `src/locales.ts` ——
  装配层引用被挂载组件与词条表。
- 宿主客户端服务 `slots` —— **硬依赖**：没有它连槽位都注册不了，因此写入插件声明的依赖列表。
- 宿主客户端服务 `locale` / `uiWorkspace` / `workspaces` / `sessions` —— **软依赖**：
  一律在调用时惰性读取，缺席时对应能力降级或抛明确错误，绝不阻塞插件加载。
- 宿主客户端 shell 注入的 `react` / `react/jsx-runtime` /
  `@deepseek-ai/dsh-client-ui-primitives` —— 构建期外部化、运行时由宿主模块表提供。
- 宿主 HTTP 端点（`/dsh-worktree-groups/` 前缀，由 [ServerHost 模块](./ServerHost模块技术文档.md)
  注册）—— 渲染层的数据来源。

**被依赖方**（known consumers）：

- DSH 宿主 profile 的 bundle 装配 —— 通过 `cordis.patch.yml` 声明的条目加载本插件，
  由宿主 `dsh-client-modules` 按包名加载客户端 bundle。
- 宿主侧栏槽位 `sidebar.workspaces` —— 本模块是该槽位的占据者，取代官方侧栏的渲染。
- 仓库测试（`test/` 下）—— `test/tree-model.test.mjs` 直接加载推导层编译产物做行为覆盖；
  `test/sidebar-wiring.test.mjs` 以源码级契约测试锁定渲染层的接线方式。
- 知识库文档树 —— L3 组件文档与 [TreeModel 模块技术文档](./TreeModel模块技术文档.md)
  反向索引到本文档。

**关键外部库**：

- `react`、`react/jsx-runtime`、`@deepseek-ai/dsh-client-ui-primitives` —— 三者均为宿主注入的
  外部化依赖，与 `package.json` 的 `dsh.client.external` 声明一致；构建脚本中的外部化列表
  与宿主静态种子白名单保持同一集合。
- `@deepseek-ai/cordis` —— 仅为 peer 依赖，本模块唯一的静态引用是**类型级**引用（编译后消失）；
  运行时宿主服务一律经上下文运行时获取，避免 Service 基类身份分裂。
- 构建与测试工具链（非运行时依赖）：`typescript`（类型编译与声明产出）、`esbuild`
  （客户端 bundle 打包）、Node 内置 test runner（`node --test`）。

---

## 平台适配

本模块的宿主平台是**浏览器渲染进程**（DSH Desktop 的 Web 客户端 shell），不存在 Android / iOS
分支；差异主要来自浏览器环境约束与宿主客户端 API 两个方向。

| 适配面 | 浏览器环境约束与处理 |
|---|---|
| 侧栏轨道态 | 宿主在侧栏折叠时以「非展开」形态渲染该槽位，组件必须改画紧凑入口并请求展开，否则整棵树会被塞进只有单行高度的轨道而布局崩坏 |
| 样式隔离 | 刻意**不注入全局样式**，全部样式内联、hover 态由组件状态表达，避免宿主升级换掉 CSS 变量后污染整页 |
| 本地存储 | 展开态与手动排序写入浏览器本地存储；隐私模式或被禁用时读写均全捕获、静默退化为本次会话内存态；读回的数据一律先清洗再用 |
| 拖拽 | 使用浏览器原生 HTML5 拖拽事件；拖到空白处或按 Esc 取消时只有拖拽结束事件会触发，因此必须同时处理结束与放置两条路径 |
| JSX 运行时 | 组件**不写 JSX 语法**，直接使用宿主注入的运行时函数并在边界处自行摘出 key；这也是渲染层无法被 `node --test` 直接执行的原因 |
| 错误隔离 | 渲染层自带错误边界，异常不逃逸到宿主槽位边界；但错误边界接不到异步与事件回调内的异常，故动作路径各自兜错并落到可读错误态 |
| 类型检查 | 本包不引入 react 类型包，改由 `src/client-shims.d.ts` 声明实际用到的最小类型面，使类型检查在无宿主包依赖的前提下通过 |

| 适配面 | 宿主客户端 API 依赖 |
|---|---|
| 槽位与子槽位 | 依赖宿主槽位服务完成条目注册，并依赖宿主提供的子槽位渲染入口挂载「添加工作区」流程；子槽位使用**自建键**，不占用官方键 |
| 语言 | 条目声明自有词典命名空间以取得宿主取词入口；宿主语言服务缺席时条目会被装配期剔除并静默回落官方侧栏，组件内兜底词条表只在「组件已渲染但没拿到取词入口」时生效 |
| 工作区与会话动作 | 依赖宿主的工作区 UI 动作、工作区服务与会话服务完成新建/重命名/归档/派生/打开等动作；服务缺席时降级或抛明确错误 |
| 宿主快照订阅 | 依赖宿主提供的全局快照订阅入口驱动重取与补实时状态；订阅入口以函数形态从槽位属性传入，在首次渲染时冻结身份 |
| 数据端点 | 依赖 [ServerHost 模块](./ServerHost模块技术文档.md) 注册的 HTTP 端点取树与执行 worktree、定位、工作区登记等操作 |

**移动端 N/A 的原因**：本仓库是 DeepSeek Harness 的 Web 客户端插件，`package.json` 的
`dsh.client` 声明客户端平台为 `web`，不存在 Android / iOS / 鸿蒙 的构建目标或平台分支代码。
**Node 测试进程 N/A 的部分**：`src/sidebar.tsx` 与 `src/client.tsx` 是 TSX 且依赖宿主注入的
运行时，不进 `lib/` 产物，`node --test` 无法执行它们，只能以源码级契约测试间接保护；
推导层与文案层则可被测试进程直接加载。

---

## 相关文档

- [ServerHost 模块技术文档](./ServerHost模块技术文档.md) —— 同一插件的宿主侧半边（本模块的数据来源）
- [TreeModel 模块技术文档](./TreeModel模块技术文档.md) —— 推导层的导出符号逐个索引（L2）
- [Client 技术文档](../l3-components/Client技术文档.md) —— 客户端插件入口的实现细节（L3）
- [Sidebar 技术文档](../l3-components/Sidebar技术文档.md) —— 侧栏渲染组件的实现细节（L3）
- [TreeModel 技术文档](../l3-components/TreeModel技术文档.md) —— 树推导纯逻辑的实现细节（L3）
- [Locales 技术文档](../l3-components/Locales技术文档.md) —— 词条表与取词工厂的实现细节（L3）
- [接口契约](../../INTERFACES.md) §2.1–§2.7 —— 客户端半边契约与主代理裁定
- [宿主契约](../../HOST-CONTRACTS.md) §B1–§B6 —— 宿主槽位、子槽位路线、客户端服务与 bundle 形态
- [产品需求](../../PRD.md) —— D2 / D10 / D11 / D12 / D13 / D19 / R2 / R6、US1–US8

- [worktree-groups 知识库（L1 架构）](../l1-architecture/worktree-groups-knowledge-base.md) —— 本模块所在的域架构总览。
- [知识库总索引](../README.md) —— 全部 L1/L2/L3 文档的分层索引与检索入口。
