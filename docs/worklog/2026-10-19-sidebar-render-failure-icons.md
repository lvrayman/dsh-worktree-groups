# 启用插件后侧栏整块渲染失败（宿主图标导出改名）+ 会话 live-fact 数据源漂移修复

- 日期：2026-10-19
- 状态：已完成（代码与测试全绿；真实 GUI 复验受「需重启 Host」限制，见 §验证证据）
- 需求来源：用户报告「@dsh-worktree-groups/ 这个插件导致侧边渲染失败，修它」（2026-10-19，DSH Desktop 2.0.18 / `@deepseek-ai/*@0.2.1-rc.2`）。
- 相关契约：[INTERFACES §2.3.0](../INTERFACES.md)、[HOST-CONTRACTS §B5.1 与硬约束 25](../HOST-CONTRACTS.md)、[Icons 技术文档](../knowledge/l3-components/Icons技术文档.md)

## 目标与范围

**目标**：插件在宿主 `primitives@0.2.1-rc.2` 下能正常渲染侧栏三级树，不再整块失败；且宿主下次改图标命名时不再整块白掉。

**范围内**

- `src/icons.ts`（新增）：宿主 primitives 图标解析层。
- `src/sidebar.tsx`：17 处 `P.Icon*` 直接取用改为经 `icon()`。
- 新增 `test/icons.test.mjs`（8 条）、`test/render-smoke.test.mjs`（2 条）。
- 文档：`INTERFACES` §2.3.0、`HOST-CONTRACTS` §B5.1 漂移说明 + 硬约束 25、知识库新增 1 篇 + 定点修订 2 篇、索引。

**同轮追加范围（用户 2026-10-19 选择「现在就修」）**

- `src/live-state.ts`（新增）：会话行 live-fact（等待确认 / 后台完成未读）纯逻辑取数层。
- `src/sidebar.tsx`：新增 `useSessionStatus` 订阅，`withLiveState` 改接新模块。
- 新增 `test/live-state.test.mjs`（10 条）。

**非目标**

- 不改宿主（`/Applications/DSH Desktop.app/`）任何文件。
- 不引入宿主包静态依赖：解析层只接收调用方传入的 `face`（契约 §2.5 规则不变）。
- 不改侧栏行为（行集合、排序、拖拽、菜单项、弹窗）。
- 不处理同一轮发现的**第二处宿主漂移**（`useSessionPendingInteraction` 源已不存在），见 §后续。

## 验收标准

1. 宿主用新命名（`Icon*Regular`/`Medium`）时 16 个逻辑图标全部解析成功。
2. 宿主仍是旧命名（`Icon*16/14/20`）时同样解析成功（向后兼容）。
3. 候选全缺时回落空图标（渲染 `null`），**绝不返回 `undefined`**；侧栏照常渲染。
4. `src/sidebar.tsx` 不再出现任何 `P.Icon*` 属性访问（AST 断言）。
5. 按真实宿主导出表构造 primitives 面，SSR 渲染 `wide` 与 `wide: false` **两个**分支均不被错误边界接管。
6. `npm run typecheck`、`npm run build`、`npm test` 全绿。

## 根因分析（证据）

**现象**：启用插件后侧栏整块「渲染失败」。

**根因**：宿主 `@deepseek-ai/dsh-client-ui-primitives` 的图标导出命名随版本变更，插件直接按**旧命名**取用。

| 宿主版本 | 图标导出命名 | 尺寸 |
|---|---|---|
| `0.1.5-rc.2`（`HOST-CONTRACTS` §B5.1 快照） | `IconPlusOutline16` / `IconChevronDownOutline14` / `IconArchiveOutline20` | 名字自带 |
| `0.2.1-rc.2`（当前安装） | `IconPlusOutlineRegular`（1px）/ `IconPlusOutlineMedium`（1.3px） | `size` prop |

**证据链**（本次实测，只读）：

1. 当前宿主 `primitives/lib/index.js` 的 `export { … }` 表里**没有任何** `Icon*` + 数字后缀的名字；实测脚本按 21 个 `P.*` 使用点逐个核对，17 个 `Icon*` 全部 `MISS`。
2. `P.IconBranchOutline16` ⇒ `undefined`；`jsx(undefined, {})` ⇒ React 抛
   `Element type is invalid: expected a string … but got: undefined`。
3. 抛点在 `SidebarBrowser` 的 `SidebarBoundary` 子树内 ⇒ 显示「侧栏渲染出错」；
   若在边界之外，宿主 `SlotErrorBoundary` 会 `recordEntryError({ abdicate: true })`，
   outlet 投影到下一个存活者（官方 `ui-workspace`）⇒ 用户的树形视图静默消失。
4. **为什么单测没拦住**：崩溃是渲染期形态（`undefined` 当组件类型），而当时没有任何用例真正渲染过整块组件；纯逻辑单测与构建全绿。

## 计划与决策

1. 先建 **Red**：`test/icons.test.mjs` 的接线断言（禁止 `P.Icon*`、必须调 `resolveIcon`）在改代码前实测失败 2 条。
2. **Green**：新增 `src/icons.ts` 解析层（候选表 + 缺席回落 + 引用缓存），`sidebar.tsx` 改接 `icon()`。
3. 补 `test/render-smoke.test.mjs`：按真实宿主导出表构造 primitives 面，SSR 真渲染。
4. 变异验证烟测判别力；补齐 `wide: false` 分支。
5. 全量回归 + 构建 + 类型检查；文档与索引同步。

**关键取舍**

- **候选表 vs. 版本探测**：不去读宿主版本号做分支（脆弱、且宿主包不在本包依赖树内）。
  改为「逻辑名 → 新命名优先、旧命名兜底」的候选序列，对两个版本同时成立。
- **回落空图标 vs. 抛错**：选择回落（渲染 `null`）。理由：图标缺失是**装饰性降级**，
  而整块侧栏白掉是**功能性故障**；宁可少几个图标。
- **调用点返回元素 vs. 返回组件**：`icon()` 返回元素，从形态上消灭 `jsx(undefined, …)`。

## 执行与产物

| 文件 | 变更 |
|---|---|
| `src/icons.ts` | 新增。`ICON_SPECS`/`ICON_NAMES`/`resolveIcon`/`unresolvedIcons`/`iconSize`；16 个逻辑图标；`WeakMap` 按 `(face,name)` 缓存引用 |
| `src/sidebar.tsx` | 新增 `icon(name, props?)` 助手；17 处 `P.Icon*` 全部改为 `icon('…')`（含 `ContainerRowView` 的 `Chevron`/`LeadIcon` 局部变量、顶部 `+`、`…`、轨道态、菜单项图标） |
| `test/icons.test.mjs` | 新增 8 条：新命名解析、旧命名兼容、全缺回落、引用稳定、候选表首个为新命名、真实宿主导出表漂移哨兵、`P.Icon*` AST 禁止、`resolveIcon` 接线 |
| `test/render-smoke.test.mjs` | 新增 2 条：按真实宿主导出表造 primitives 面，走真实 `apply` 捕获注册组件，SSR 渲染 `wide` 与 `wide: false` |
| `docs/INTERFACES.md` | 新增 §2.3.0（`src/icons.ts` 契约与必须遵守项） |
| `docs/HOST-CONTRACTS.md` | §B5.1 顶部加「清单已过期 / 命名漂移」说明；硬约束新增第 25 条 |
| `docs/knowledge/l3-components/Icons技术文档.md` | 新增（L3） |
| `docs/knowledge/l3-components/Sidebar技术文档.md` | 顶部修订声明 + 轨道态图标行改口径 |
| `docs/knowledge/l2-modules/WebClient模块技术文档.md` | 顶部修订声明 + 组件索引新增 Icons 行 |
| `docs/knowledge/README.md` | 文档总数 19→20、L3 15→16、新增 Icons 行与修订声明 |
| `docs/README.md` | 工作记录索引新增本记录 |
| `src/live-state.ts` | 新增（第 2 处漂移）。`visiblePendingKind`/`normalizeSessionKey`/`sessionStatusOf`/`liveStateOf`；新源优先、旧源兜底 |
| `src/sidebar.tsx`（第 2 处） | 新增 `useSessionStatus` 订阅（`SnapshotSources.status`）；删除本地 `pendingOf`/`completedOf`/`sessionKeyOf`/`VISIBLE_PENDING_KINDS`，改接 `live-state` |
| `test/live-state.test.mjs` | 新增 10 条（见 §验证证据） |
| `docs/INTERFACES.md` | 新增 §2.3.2（`src/live-state.ts` 契约） |
| `docs/HOST-CONTRACTS.md` | 硬约束新增第 26 条（root source 增删与降级规则） |
| `docs/knowledge/l3-components/LiveState技术文档.md` | 新增（L3） |
| `docs/knowledge/l3-components/Sidebar技术文档.md` | 修订声明补第 2 处 |
| `docs/knowledge/l2-modules/WebClient模块技术文档.md` | 组件索引新增 LiveState 行 |
| `docs/knowledge/README.md` | 文档总数 20→21、L3 16→17、新增 LiveState 行与声明 |

## 验证证据

**Red（改代码前）**

```sh
$ node --test test/icons.test.mjs
✖ icons/接线：sidebar.tsx 不再直接访问 P.Icon*（图标必须经解析层）
  actual: [ 'P.IconChevronDownOutline14 @834', … 'P.IconNewChatOutline16 @2719' ]  // 23 处
✖ icons/接线：sidebar.tsx 的图标取值经 icon(...) 助手，且该助手用 resolveIcon
  false !== true
ℹ tests 8  pass 6  fail 2
```

**Green**

```sh
$ npm run build && node --test test/icons.test.mjs
✔ 8/8

$ npm run build && node --test test/render-smoke.test.mjs
✔ 渲染烟测：宿主采用新图标命名（0.2.1）时，整块侧栏能渲染出 DOM
✔ 渲染烟测：宿主导出表里**没有任何**旧图标名时也不崩（漂移免疫）
ℹ tests 2  pass 2

$ npm test
ℹ tests 415  pass 415  fail 0
```

**变异验证（判别力证据）**

- 变异 M1：把 `children: icon('panelLeft')` 改回 `jsx(P.IconPanelLeftOutline16, {})`，重建：
  - `test/icons.test.mjs` ⇒ **fail 2**（AST 接线断言命中）。
  - `test/render-smoke.test.mjs` ⇒ **fail 0**（未捕获）。
  - 原因：`panelLeft` 只在 `wide === false` 轨道分支渲染，而烟测当时只渲了宽态。
- 补救后重跑 M1：两条烟测 ⇒ **fail 2**（`wide=true` 与 `wide=false` 都被覆盖）。
  ⇒ 记录该局限：**只渲染宽态会漏掉轨道分支的整类渲染期崩溃**，已写进硬约束 25。

**未执行 / 受限**

- **真实 GUI 复验未完成**：插件在此前已被用户禁用（profile patch `disabled: true` +
  `dshmarket` 的 `.dsh-market/state.json` disabled 列表），本轮已两处解除、并已加入
  `dsh.profile.bundles`（`plugin_manager.set_bundle` 返回 `application: applied`），
  但**运行中的 Host 只在启动时装配 bundle 层**（硬约束 23），插件行当前仍为
  `status: inactive / enabled: false`，需**重启 DSH Desktop** 才生效。
  重启会终结当前会话（PRD R1），因此本轮不自行重启，交由用户在方便时重启后确认。
- 未在真实浏览器里做视觉核对（图标线重 14/20 的观感、菜单弹层定位）。

## 结果与后续

**完成**：根因已修并被 10 条新用例锁定（含 1 条读真实宿主导出表的漂移哨兵、1 条真渲染烟测）。

**已知风险**

1. 宿主若引入**第三种**图标命名，解析层不会自动适配；漂移哨兵会指名缺失项，需人工更新 `ICON_SPECS`。
2. 解析层候选表只覆盖当前 16 个逻辑图标；新增图标必须同步改候选表与契约 §2.3.0。
3. `docs/knowledge` 的 git-version 锚点仍是 `9bd9425`（本次为定点修订，未重新锚定全库）。

## 附：第 2 处漂移（同轮修复：会话 live-fact 数据源）

**缺陷**：宿主 `0.2.1-rc.2` **删除了** root hook `useSessionPendingInteraction`
（全宿主 0 处命中），`useSessions().byId` 条目也**不再有 `completed` 字段**
（`projectList()` 只写 `running` / `blank` / `retainedBy` / …）。于是 PRD US7 的
「等待确认（琥珀）」与「后台完成未读（绿点）」两个态**永远不亮** —— 不崩（`asHook`
把缺席 source 降级为恒 `undefined`），但功能静默消失。
现行唯一来源是 `dsh-client-ui-session/lib/client.js` 的 `publishStatus()`：
`Map<SessionId, { running, pendingInteraction: { kind }, completionUnread }>`。

**修法**：把这段取数从 `sidebar.tsx` 抽成纯逻辑模块 `src/live-state.ts`（**以前埋在
`.tsx` 里，`node --test` 无法执行 ⇒ 零单测**，这正是它跨两个宿主版本失效都没被发现的原因），
改为「`useSessionStatus` 优先 + 旧源兜底」。

**Red / Green**

```sh
$ node --test test/live-state.test.mjs        # 模块尚不存在
✖ test/live-state.test.mjs  (ERR_MODULE_NOT_FOUND lib/live-state.js)

$ npm run build && node --test test/live-state.test.mjs
✔ 9/9   （追加接线断言后 10/10）

$ npm test
ℹ tests 425  pass 425  fail 0
```

**关键取舍**

- **不删旧路径**：`useSessionPendingInteraction` / `byId.completed` 保留为兜底，
  宿主回退或其它 profile 组合下两态不至于全灭。
- **kind 白名单照旧**：`approval` / `plan-review` / `question`，其余一律不亮 ——
  宿主快照里"有值"不等于"用户要确认"。
- **`completionUnread` 只认 `=== true`**：快照形状漂移时宁可少亮也不误亮。
- **id 拼法归一化**：`session-<uuid>` 与裸 `<uuid>` 双向可查。

**未执行**：真实 GUI 里琥珀 / 绿点的视觉确认同样依赖 Host 重启（见上节限制）。
旧源兜底路径**无法在当前宿主验证**（source 与字段都不存在），只由合成快照覆盖。
