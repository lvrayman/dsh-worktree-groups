# 侧栏右键菜单渲染裸 key（中文不显示）缺陷修复

- 日期：2026-09-23
- 状态：已完成（用户 GUI 复验通过）
- 需求来源：用户报告「右键所有菜单都变成英文 key 了，没有正确显示中文」（2026-09-23，DSH Desktop 2.0.10 运行中的 web GUI）。

## 目标与范围

**目标**：本插件渲染的侧栏右键菜单（会话行 / worktree 行 / 项目行）与其它取词点在任何启动时序、任何宿主语言下都**不再出现裸 key**（如 `menu.newSession`、`worktree.create`），恢复中文文案。

**范围内**

- `src/client.tsx`：词典注册与 `locale` 服务的获取姿势。
- `src/locales.ts`：取词兜底（纯逻辑，可 `node --test` 覆盖）。
- `src/sidebar.tsx`：取词入口接线。
- 契约与宿主事实文档同步（`docs/INTERFACES.md`、`docs/HOST-CONTRACTS.md`）。

**非目标**

- 不新增英文（`en`）词条表：本插件的词条表按契约只有 `zh`，本次只保证「seat 解不出时回落内置中文」。
- 不改宿主（`/Applications/DSH Desktop.app/`）任何文件；不引入宿主包静态依赖（§2.5 规则不变）。
- 不改菜单项集合、排序、动作分发等行为。

## 验收标准

1. `createSeatT(seat)`（新导出）在 seat 返回 key 本身（未解析）时回落到内置 `zh`，且占位符照常替换；seat 抛错时同样回落；seat 正常返回译文时**逐字透传**（不覆盖宿主 `common` 命名空间或其它语言的译文）。
2. 同一 seat 引用重复调用返回**同一包装函数引用**（避免 `useMemo` 依赖每帧失效引发的重渲染风险）。
3. `src/client.tsx` 的词典注册不再依赖 apply 时的一次性 `ctx.get('locale')`，而是在 `locale` 服务**出现时**注册（`ctx.inject(['locale'], ...)`）；`locale` **仍不进 entry 的 `inject` 数组**（D9：会让 entry 永久 pending ⇒ `assertEntriesActive` 硬失败 ⇒ 整页白屏）。
4. `src/sidebar.tsx` 的取词入口把 seat `t` 交给兜底包装；`props.t` 缺席时仍走内置 `FALLBACK_T`。
5. `npm run typecheck`、`npm run build`、`npm test` 全绿。

## 根因分析（证据）

**现象**：侧栏右键菜单项显示 `menu.newSession` / `worktree.create` 这类裸 key。

**证据链**（全部为宿主真实代码，只读核实）：

1. 宿主 `Menu` 原语**原样渲染** `items[].label`，内部不做 i18n
   （`@deepseek-ai/dsh-client-ui-primitives/lib/index.js`：`children: entry.label`）。
   ⇒ 出现裸 key 只可能是**调用点的 `t` 返回了 key 本身**。
2. 本插件菜单标签全部来自 seat `t`（`src/sidebar.tsx` 的 `MenuLayer`：`label: t('menu.newSession')` …）。
3. seat `t` 的解析规则（`@deepseek-ai/dsh-client-locale/lib/client.js` `translate/lookup`）：
   先按**当前语言**的 fallback 链在**本 entry 命名空间**查表，再查 `common` 命名空间，
   都查不到就**返回 key 本身**。本插件只注册了 `zh` 词典（`locale.register(LOCALE_NS, { zh })`）。
4. `@deepseek-ai/dsh-client-ui-renderer/lib/client.js` `localeSeat`：entry 声明了 `locale` 即
   `kit.t = face.bind(entry.locale)` —— **声明即无退路**，seat 一定存在，组件里的
   `FALLBACK_T`（内置 `zh`）**不会被用到**（它只在 `props.t` 缺席时生效，而 kit 永远给 `t`）。
5. **触发点**：`src/client.tsx` 用一次性 `ctx.get('locale')` 探测服务，探测不到就
   **静默跳过注册**（`if (locale !== undefined && ...)`，没有 else、没有日志）。
   而 DSH web 启动**并发创建所有 client entry**
   （`@deepseek-ai/dsh-web-frontend/dist/assets/index-*.js`：`await Promise.all(s.map(async a => i.create({ name: a })))`），
   `locale` 插件自身的 fiber 还要等 `slots` + `remote` + `settingsScope` 三个服务
   （`dsh-client-locale` 的 `inject`）才 apply；本插件只等 `slots` ⇒ **本插件的 apply 完全可能先跑**。
   一旦先跑：词典没注册，但装配期 `host.locale` 已经就位（不会触发 `SlotAssemblyError`）⇒
   seat 绑定到一个**空命名空间** ⇒ 每个词条都返回 key ⇒ 菜单显示裸 key。

**结论**：这是「词典注册依赖启动时序」的竞态缺陷；只要注册晚于 seat 的第一次解析，侧栏所有取词点都会显示裸 key。修复必须同时做两件事：**注册改成等服务出现**（治因）+ **取词兜底**（治果，任何时序/语言下都不再露 key）。

## 计划与关键取舍

1. 先补工作记录（本文件），再按 TDD 逐行为 Red → Green。
2. **取舍 A：用 `ctx.inject(['locale'], cb)` 而不是把 `locale` 写进 entry 的 `inject` 数组。**
   `ctx.inject` 建的是**子 fiber**，不进 `loader.entries()`（宿主 `assertEntriesActive` 只遍历
   loader 条目），因此 locale 缺席时**不会**把本 entry 拖成 pending ⇒ 不触发 D9 的整页白屏。
   宿主自己的 `dsh-client-connection` 也正是在 `apply` 里用 `ctx.inject(['attachments'], …)`
   处理同类可选服务。
3. **取舍 B：兜底放在 `locales.ts` 的纯函数里，而不是在 `sidebar.tsx` 里写 if。**
   纯函数能被 `node --test` 直接覆盖（`.tsx` 不进 `lib/`，无法单测），符合仓库既有分层。
4. **取舍 C：兜底只认「seat 返回的就是 key」这一种未解析信号**，不覆盖 seat 的正常译文
   （否则会顶掉宿主 `common` 命名空间的译文与其它语言）。seat 抛错时也回落（渲染期绝不因取词崩）。
5. **取舍 D：包装函数按 seat 引用缓存（`WeakMap`）。**
   seat 是宿主按 (face, ns, revision) 缓存的稳定引用；若我们每次渲染新建包装函数，
   `sidebar.tsx` 里以 `t` 为依赖的 `useMemo` 会每帧失效（性能与潜在重渲染风险）。
6. 接线用**源码级 AST 断言**保护（仓库既有 `test/sidebar-wiring.test.mjs` 模式）：
   `.tsx` 不进 `lib/`，没有别的自动回归手段。

## 执行记录

**产物（4 个代码/测试文件 + 6 个文档文件）**

| 文件 | 改动 |
|---|---|
| `src/locales.ts` | 新增导出 `Translate`（类型）与 `createSeatT(seat, dict?)`；把占位符替换抽成内部 `format()` 供 `createT` / `createSeatT` 共用（`createT` 行为逐字不变） |
| `src/sidebar.tsx` | 取词入口 `SidebarBrowserInner`：`props.t` 先过 `createSeatT`；`props.t` 缺席仍走 `FALLBACK_T`；本地 `Translate` 别名改为从 `./locales.js` import（单一来源） |
| `src/client.tsx` | 词典注册由「apply 时一次性 `ctx.get('locale')` 探测 + 缺席静默跳过」改为 `ctx.inject(['locale'], cb)`（等 locale 出现再注册，子 fiber 不阻塞本 entry）；文件头注释同步 |
| `test/locales.test.mjs`（新） | 8 条纯逻辑用例：兜底、透传、占位符、seat 抛错、未知 key、包装引用稳定、可注入词典表、`createT` 不回归 |
| `test/sidebar-wiring.test.mjs` | 追加 `T16/取词` 4 条源码级 AST 断言（见下） |
| `docs/INTERFACES.md` | §2.1 增补 `Translate` / `createSeatT` 语义表与缺陷记录；§2.3 增补「取词入口必须过 `createSeatT`」；§2.4 新增 **D15**（注册必须走 `ctx.inject`） |
| `docs/HOST-CONTRACTS.md` | 新增 §B4.4（entry 并发创建 + `assertEntriesActive` 只认 loader 条目 + `ctx.inject` 子 fiber 语义，含宿主源码证据）；硬约束新增第 24 条 |
| `docs/knowledge/`（4 篇） | Client / Locales / Sidebar / WebClient 定点修订（注册姿势、新导出、取词入口、文案本地化流程），并在知识库总索引加修订声明 |
| `docs/README.md` | 工作记录索引 + 知识库修订说明 |

**T16 的 4 条接线断言（每条对应一个具体失效模式）**

1. 词典注册必须**整体位于** `ctx.inject([… 'locale' …], cb)` 的回调体内；且不允许在 `apply` 顶层
   出现 `serviceOf(ctx, 'locale')` 一次性探测（正是本次缺陷的原始写法）。
2. 导出的 `inject` 数组**不得包含** `locale`（D9：会把 entry 拖成永久 pending ⇒ 整页白屏），
   且必须包含 `slots`。
3. entry 注册对象仍须声明 `locale: LOCALE_NS`（否则拿不到 seat、语言切换也不重渲染）。
4. `sidebar.tsx` 必须 import `createSeatT`，且局部 `t` 由 `createSeatT(props.t)` 产出
   （允许 `const seat = props.t` 中转一层，按 AST 追溯实参身份），并保留 `FALLBACK_T` 分支。

## 验证证据

| 检查 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `npm run typecheck` | exit 0（无输出） |
| 构建 | `npm run build` | exit 0；`lib/client.js` 内含 `inject(["locale"], (localeCtx) => {` 与 `createSeatT(seat)` |
| 全量测试 | `npm test` | **405 / 405 通过，0 失败**（原 393 + 新增 8 条 locales + 4 条 T16 接线） |
| 定向 Green | `node --test test/locales.test.mjs` | 8 / 8 通过 |
| 定向 Green | `node --test test/sidebar-wiring.test.mjs` | 14 / 14 通过（含原 10 条 T13） |
| **Red（最终测试集 vs 修复前源码）** | `git stash push -- src/client.tsx src/sidebar.tsx src/locales.ts` → `npm run build` → `node --test test/locales.test.mjs test/sidebar-wiring.test.mjs` → `git stash pop` | **fail 3**：`test/locales.test.mjs`（`createSeatT` 不存在）+ `T16/取词: client.tsx 的词典注册…` + `T16/取词: sidebar.tsx 的 seat t…`；恢复后重建再跑全绿（工作区已还原，`git status` 核对） |
| 构建产物 | `grep -c createSeatT lib/client.js` / `ls -la lib/` | 2 处命中；`lib/` 无 `.jsx` 残留 |
| **真人 GUI 复验** | 用户在运行中的 DSH Desktop（2.0.10，`http://127.0.0.1:43120`）刷新页面后右键侧栏会话 / 项目 / worktree 行 | ✅ **菜单已恢复中文**（用户确认）；同时确认**界面其余部分是中文** |

**GUI 复验的额外信息量（根因交叉验证）**

用户确认「界面其余部分是中文」⇒ 宿主当前语言 = `zh` ⇒ 本插件的 `zh` 词典**本该命中**却全部落空
⇒ 只可能是**词典注册确实被跳过**（而不是「语言不是 zh」这条备选假设）。这独立佐证了
「entry 并发创建 ⇒ `apply` 先跑 ⇒ 一次性 `ctx.get('locale')` 探测为空 ⇒ 静默漏注册」的根因判断。

**未执行 / 无法自动化的部分（如实声明）**

- **`ctx.inject` 子 fiber 不进 `loader.entries()`** 这一前提来自 `cordis-plugin-loader` 源码阅读
  （`EntryTree.entries()` 只遍历 `store`，而 `store` 仅由 `loader.create()` 写入），未构造
  最小宿主环境实测；运行侧的反证是「修复后页面正常渲染、未出现
  `web boot: N entries did not activate` 白屏」。
- **宿主日志无法取证**：宿主 `logs/host/dsh-2026-09-23.log` 未记录渲染进程 console，
  无法从日志侧直接看到「注册被跳过」那一行；根因结论来自宿主源码阅读 + GUI 复验交叉验证。

## 结果与后续

**完成情况**：两层修复均已落地并全绿 —— ① 注册改为等 `locale` 服务出现（治因）；
② 取词入口 `createSeatT` 兜底（治果，任何时序/语言下都不再露裸 key）。
文档（契约、宿主契约、知识库 4 篇、索引、本记录）已同步；**用户 GUI 复验通过**。

**已知风险 / 遗留**

1. 本插件**仍只有 `zh` 词条表**。若宿主语言切到非 `zh`（如 `en`），本插件的菜单会显示**中文**
   （兜底路径），而不是英文 —— 这是「宁可中文，也不露 key」的有意取舍；要真正支持英文需按契约
   §2.1 新增 `en` 表并同步冻结集。
2. `docs/knowledge/` 仅定点修订了 4 篇，其余 15 篇的 `git-version` 锚点（`9bd9425`）与行号
   未复核；后续如需全量一致，应按各文档 `git-module-path` 逐份重新锚定。
3. 竞态的**触发条件未量化**（是「谁先 apply」的时序竞争，不是必现）。修复对两种时序都成立
   （先跑则兜底、后跑则正常注册），因此不影响交付；但同类问题可能出现在**其它**客户端插件上
   （任何「一次性 `ctx.get` 探测 + 静默跳过」的写法），已在 `docs/HOST-CONTRACTS.md` 硬约束第 24 条
   记录为通用禁令。

**后续任务（如需）**：给本插件补 `en` 词条表并在设置里跟随宿主语言；把 `T16` 的断言扩展为
「`src/` 里任何 `locale.register` 都必须在 `ctx.inject` 回调内」的全仓扫描；排查本机其它
客户端插件是否有同样的「一次性探测」写法。
