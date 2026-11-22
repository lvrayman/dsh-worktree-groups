# 工作记录：运行中任务的文件夹 / worktree 图标高亮（文档/契约定稿）

- **日期**：2026-10-20
- **主题**：运行中任务驱动的 workspace 文件夹 / worktree 图标高亮 —— 需求、设计、契约、索引（文档驱动开发，先于实现）
- **状态**：**已完成**（文档齐备；**未执行**构建/测试，理由见 §5；实现与视觉验收在 T-4 及之后）
- **任务**：T-3（只写文档；写入范围见 §2）
- **阶段**：T-1 调研 → T-2 宿主核实 → **T-3 文档/契约** → T-4 TDD 实现 → T-5 审查/复核 → T-6 交付验收
- **相关文档**：
  - [需求：运行中任务的文件夹 / worktree 图标高亮](../requirements/2026-10-20-running-task-highlight.md)（AC1–AC13）
  - [设计：运行中任务的文件夹 / worktree 图标高亮](../design/2026-10-20-running-task-highlight.md)
  - [PRD §12](../PRD.md)（需求汇总 + 决策表 + 旧 Q1 保留说明）
  - [INTERFACES §2.1 / §2.2 / §2.2.1 / §2.3 / §2.3.2](../INTERFACES.md)（字段、渲染接线、刷新信号、locale key）
  - 上游证据：[T-1 调研](../research/2026-10-20-running-task-highlight-research.md)、[T-2 宿主核实](../research/2026-10-20-host-capability-verification.md)

## 1. 目标与范围

**目标**：把已确认需求、设计决策、接口契约、验收/测试边界写入 `docs/`，让 T-4 只按文档实现，不再二次拍板。

**验收标准（本任务自身）**

1. 三份新文档齐全（requirements / design / worklog），章节目录可用。
2. `PRD.md` / `INTERFACES.md` / `README.md` 已更新，链接可用。
3. 字段名、判定口径、颜色、locale key、刷新方案**各只有一套**，且与主代理定稿逐字一致。
4. 明确「host 侧改动需重启 DSH Desktop」「当前 GUI 无法脚本截图 ⇒ 视觉人工验收」。
5. **未改** `src/` / `test/` / `package.json` / `lib/` / `cordis.patch.yml` / 两份 research 报告。

**范围内（唯一允许的写文件）**

- 新建 `docs/requirements/2026-10-20-running-task-highlight.md`
- 新建 `docs/design/2026-10-20-running-task-highlight.md`
- 新建 `docs/worklog/2026-10-20-running-task-highlight.md`（本文件）
- 更新 `docs/PRD.md`（§12 追加）
- 更新 `docs/INTERFACES.md`（§2.1 / §2.2 / §2.2.1 / §2.3 / §2.3.2）
- 更新 `docs/README.md`（索引）
- 进度记录：`~/.local/state/ai-work-dispatcher/runs/2026-10-20-running-highlight/progress/T-3.md`

**非目标**：不改源码与测试、不构建、不跑测试、不提交、不切分支、不清理工作区、不改宿主或全局配置。

## 2. 计划与决策

**执行步骤**

1. 读 `AGENTS.md`、`docs/README.md`、`PRD`、`INTERFACES`、`HOST-CONTRACTS` 相关章节 + 两份 research（T-1/T-2）。
2. 用只读 `grep` / `sed` 核对落点行号与既有语义（`tree-model.ts` 的 `emitContainer` / project 构造、`sidebar.tsx` 的
   `ContainerRowView` / 重取 effect、`live-state.ts`、`locales.ts`、`test/tree-model.test.mjs` 的 Q1 回归锁）。
3. 先写需求（口径与验收）→ 再写设计（数据流、边界、渲染、刷新、测试矩阵）→ 再改契约（PRD/INTERFACES）→ 最后索引与工作记录。
4. 自检：`grep` 字段名 / key / 颜色 / 签名各只有一处定义；链接目标文件存在。

**关键决策（本轮拍板，均已入库）**

| 编号 | 决策 | 来源 |
|---|---|---|
| RT1 | 「正在运行的任务」**含子代理**（会话自身 running 或该会话有运行中子代理） | 用户 2026-10-20 拍板 |
| RT2 | 文件夹（project）**只聚合 worktree 子项**；不含未分组/flat、不含 history | 用户拍板 |
| RT3 | 视觉**只高亮** workspace 文件夹图标与 worktree 行首图标；不整行、不加状态点；主题强调色 + 轻微光晕 | 用户拍板 |
| RT4 | 接入宿主会话运行状态做**防抖快速刷新**（约 0.3–1 s）；保留 30 s 轮询与 focus 强刷 | 用户拍板 |
| RT5 | `RenderRow` 的 project/worktree 行新增**必填** `hasRunningTasks: boolean`（**additive**）；`runningCount` 语义不变 | 主代理定稿（T-1 方案 B 的落地形态） |
| RT6 | locale key `a11y.runningTask` = 「有任务正在运行」；高亮行根 `data-running="true"`；颜色 `var(--dsw-alias-state-business-primary, #4176e6)` + `drop-shadow(0 0 2px 同色)`；刷新信号 `runningSignature` 进 220 ms 防抖、**不进** `reload` 依赖 | 主代理定稿（依据 T-2 的图标 `style` 不透传、主题变量与频率结论） |

**为什么是 additive（RT5）而不是改 `runningCount`**

- `runningCount` 有**被钉死的既有裁决与回归测试**（`docs/INTERFACES.md:1212-1213`、`test/tree-model.test.mjs:1677`，用户裁决 Q1）。
  改其口径等于推翻裁决 + 反转测试，风险最高且会污染「数字」语义。
- 新增布尔字段让「数」与「是否活动」分离：T-4 是**新增**断言，不是反转断言；旧 Q1 原文原样保留。
- 代价是「两个口径并存」，因此在设计文档 §3.4 / INTERFACES §2.2.1 里写清二者关系与差异，避免误解。

**为什么聚合含子代理（RT1）**

- 宿主 `subagent` 工具启动后**立即返回**，父会话回合结束后即为 idle（T-2 §1.4）⇒「子代理在跑、父会话不 running」
  真实存在；只数 `session.running` 会漏，并且与父会话行蓝点（含聚合）形成矛盾。
- 采用与会话行 `running` **同一个** `subagentCountOf` 索引 ⇒ 二者同源，不会分叉。

**为什么刷新用签名而不是事件/状态对象（RT4）**

- `useSessionStatus` 只在 `agent/status` 迁移时发布并做内容去重（T-2 §1.3）⇒ 噪声低；
  但每次发布都是新 `Map` 引用，直接进依赖会每帧重取。
- 签名是稳定字符串，只随「`running === true` 集合」变化；沿用既有 220 ms 防抖 ⇒ 突发合并，
  量级 ≤ 每回合 2 次 `/tree`（T-2 §7.3）。

## 3. 执行与产物

### 3.1 新建

| 文件 | 内容 |
|---|---|
| `docs/requirements/2026-10-20-running-task-highlight.md` | 背景与问题、用户已确认口径（RT1–RT6）、验收标准 AC1–AC13（标注纯逻辑/AST/人工）、非目标 9 条、约束与运行时事实、相关文档 |
| `docs/design/2026-10-20-running-task-highlight.md` | 事实基线 F1–F10、数据流图、字段语义（worktree/project 判定伪代码 + 构造点清单）、边界表（折叠/截断/空白/归档/搜索/轨道态/flat/history/未分组）、渲染落点（`runningHighlight` / lead span / `data-running`）、颜色与光晕与可访问性、`runningSignature` 精确语义 + 接线 + 频率、性能量级、Red→Green 16 步 + 用例矩阵 A1–A14/B1–B8/C1–C10 + 变异 M1–M7、T-4 文件清单、人工验收 10 步、风险 R1–R10、一致性检查 grep |
| `docs/worklog/2026-10-20-running-task-highlight.md` | 本文件 |

### 3.2 更新

| 文件 | 改动 |
|---|---|
| `docs/PRD.md` | 追加 **§12**：需求原文、文档链接、决策表 RT1–RT6、**旧 Q1 裁决原样保留**（`runningCount` 不改、新消费者改用新字段、回归锁不得反转）、非目标、验收方式（重启 + 人工）；既有 §5 的 21 项决策与 §10 缺陷表**未改** |
| `docs/INTERFACES.md` | §2.1 冻结词条集新增 `a11y.runningTask 有任务正在运行` + additive 说明；§2.2 `RenderRow` 的 project/worktree 变体新增 `hasRunningTasks: boolean`（含口径 JSDoc）；**新增 §2.2.1** 口径与边界表、与 `runningCount` 的关系；§2.3 重取触发补第 4 条 + 新增「运行中任务高亮」段（渲染落点、颜色、`data-running`、`title`、刷新、禁止项）；§2.3.2 导出新增 `runningSignature` + 契约 6 条 |
| `docs/README.md` | 历史调研表补 T-1/T-2 两行；新增「本次需求（2026-10-20）」小节（需求 / 设计 / 工作记录链接）；工作记录表补一行 |

### 3.3 未改动（保护工作区）

`git status --porcelain` 中既有的未提交改动（`src/sidebar.tsx`、新增 `src/icons.ts` / `src/live-state.ts` /
`test/*.mjs`、`docs/knowledge/*` 等）**全部原样保留**，本任务未回滚、未覆盖、未格式化任何非目标文件；
未新增 `src/`、`test/`、`lib/` 的任何变更。

## 4. 原文引用：被保留的旧裁决位置

| 位置 | 原文（逐字） |
|---|---|
| `docs/INTERFACES.md` §2.6 裁定 3（改动前 `:1212-1213`） | 「⚠️ **`runningCount` 的口径刻意不变**（仍只数 `session.running`）：渲染层**无消费者**（`grep runningCount src/sidebar.tsx` 为空），用户裁决 Q1 明确「不改」，避免无声扩大契约。」 |
| `docs/PRD.md` §10 缺陷表需求 A 行（改动前 `:577`） | 「`runningCount` 口径**不变**（渲染层无消费者，不扩大范围）」 |
| `test/tree-model.test.mjs`（改动前 `:1677`，测试名） | 「需求 A: 容器/项目行的 runningCount 口径**不变**（用户裁决 Q1：渲染层无消费者）」 |
| `src/tree-model.ts` `buildRows` JSDoc（改动前 `:2220-2221`） | 「`runningCount` 的口径**不变**（仍只数 `session.running`）—— 渲染层无消费者，本次不动（用户裁决 Q1）」 |

上述四处均**未改动**；本轮只新增字段与新消费者，Q1 的适用对象（`runningCount`）与结论都不变。

## 5. 验证证据

### 5.1 已执行的只读核对（命令均为只读，退出码 0）

| # | 命令 | 结果摘要 |
|---|---|---|
| 1 | `git status --porcelain` | 改动前 21 项未提交内容（14 项 + 新增目录），本任务只新增/修改 §2 列出的文档 |
| 2 | `grep -n '^#\{1,3\} ' docs/PRD.md` / `docs/INTERFACES.md` | 确认插入锚点（PRD 止于 §11；INTERFACES §2.2 止于 `### 2.3` 前、§2.3.2 在 `### 2.3.1` 前） |
| 3 | `sed -n '1140,1185p' src/tree-model.ts`、`:1831-1890p`、`:2280-2379p` | 核对 `EmitContext.subagentRunningCounts`、`ContainerResult`、`emitContainer` 的 `heads`/`truncated`、project/worktree/history/未分组四个构造点与行号 |
| 4 | `sed -n '776-905p' src/sidebar.tsx`、`:1560-1670p` | 核对 `ContainerRowView` 的 `lead` / lead span / 行根 `jsx('div')`、`sessionStatus` 与 220 ms 防抖 / 30 s / focus 三处 effect、`reload` 的 `[t]` 依赖 |
| 5 | `grep -n "runningCount\|subagentRunningCounts\|isVisibleMember" src/tree-model.ts` | 确认 `runningCount` 计算点 `:1914`、project 求和 `:2312`、可见性 `:1760-1766`、聚合索引 `:1219`/`:1374-1376` |
| 6 | `sed -n '1,80p' src/locales.ts` + `grep -n "a11y" src/locales.ts` | 确认新 key 应放在 `a11y.subagents`（`:71`）之后；`test/locales.test.mjs` 遍历词典，无需改测试即覆盖新词条 |
| 7 | `sed -n '1,80p' test/sidebar-wiring.test.mjs` + `grep -n "test(" test/*.mjs` | 确认 `.tsx` 只能走 AST 接线断言、`render-smoke` 不渲染真实行、`test/tree-model.test.mjs:1677` 是 Q1 回归锁 |
| 8 | `sed -n '1105,1115p'`、`:1815,1826p`、`grep -n "重启\|hmr" docs/HOST-CONTRACTS.md` | 核对宿主变量建议、`useSessionStatus` 形状与「host 改动需重启」的既有记载（T-2 进一步用源码实证） |
| 9 | 文档链接自检（`test -f` 循环，见 §5.3） | 所有新增相对链接的目标文件存在 |

### 5.2 **未执行**的检查及原因（如实声明，不算通过）

| 检查 | 状态 | 原因 |
|---|---|---|
| `npm run typecheck` | **未执行** | 本任务只改 `docs/`，无 TS 变更 ⇒ 不提供关于本轮产物的证据；T-1 已在同代源码上跑过（通过），T-4 会重跑 |
| `npm run build` | **未执行** | 会重写 `lib/`（任务明令禁止「运行会写 `lib/` 的构建」） |
| `npm test` | **未执行** | 同上（`pretest` = `npm run build`，且测试 import `lib/*.js`） |
| `npm run build:client` | **未执行** | 本任务不改 client 源码；构建属于 T-4 |
| 真实 GUI 视觉验收 | **未执行（不可脚本化）** | 当前 GUI HTTP 403、无 CDP 端口、无 playwright（T-2 §6）；且 host 字段尚未实现/重启。**视觉正确性只能人工验收**，清单见设计文档 §11 |
| 变异验证（M1–M7） | **未执行** | 需要 T-4 的实现与测试先存在；留给 T-4 自测与 T-5 复核 |
| Red/Green 测试证据 | **不适用（本任务）** | 纯文档任务，无可执行行为变更（AGENTS.md §4 允许，并要求说明原因）；测试设计已写入设计文档 §9 |

### 5.3 文档自检（本任务实际执行）

```sh
# 三份新文档存在
test -f docs/requirements/2026-10-20-running-task-highlight.md
test -f docs/design/2026-10-20-running-task-highlight.md
test -f docs/worklog/2026-10-20-running-task-highlight.md

# 关键口径唯一（每个关键字都应命中预期位置）
grep -c "hasRunningTasks" docs/PRD.md docs/INTERFACES.md docs/requirements/*.md docs/design/*.md
grep -n "a11y.runningTask" docs/INTERFACES.md docs/PRD.md
grep -n "state-business-primary" docs/INTERFACES.md docs/design/*.md
grep -n "runningSignature" docs/INTERFACES.md docs/design/*.md docs/PRD.md
grep -n "runningCount 的口径刻意不变" docs/INTERFACES.md
```

> 说明：以上为**只读**检查；结果见 §5.1 第 9 条与任务交付说明。任何**未跑**的构建/测试都没有被宣称为通过。

## 6. 结果与后续

**完成情况**：需求、设计、契约、索引与工作记录全部落地；字段名 / 判定 / 颜色 / locale key / 刷新方案各只有一套，
且与主代理定稿一致。源码与测试**零改动**。

**已知风险 / 遗留**

1. **必须重启 DSH Desktop** 才能看到宿主字段驱动的效果（`hasRunningTasks` 由 `lib/tree-model.js` 产出）；
   只 build client 时高亮**不会出现**（`=== true` 保护 ⇒ 不崩）。
2. **视觉只能人工验收**：无法脚本截图 / 抓 DOM；`render-smoke` 是 SSR、渲染不出容器行，不能代替肉眼。
3. 设计文档中的 `src/` 行号以 T-4 改动前为基线，实现后会偏移；T-5 复核时按符号名校正。
4. 高亮以颜色为主通道（用户明确不加状态点），色盲用户仅靠 `title` tooltip 获得语义（设计 §6.3 已记录）。

**后续任务**

| 任务 | 内容 | 入口 |
|---|---|---|
| **T-4** | 按设计文档 §10 做 TDD 实现：`tree-model.ts`（字段+判定）、`live-state.ts`（`runningSignature`）、`sidebar.tsx`（渲染+刷新）、`locales.ts`（词条）、三份测试新增用例；跑 `typecheck` / `build` / `test` | [设计 §9–§10](../design/2026-10-20-running-task-highlight.md) |
| **T-5** | 审查/复核：文档与实现逐字一致（设计 §13 的 grep 清单）、变异验证 M1–M7、旧 Q1 回归锁未被反转、行号校正 | 本文 §4 + 设计 §13 |
| **T-6** | **独立审查**（只读，禁止重启/改代码）：F1–F13 发现、AC 覆盖矩阵、对 T-5 证据链的复核意见、变异复现 | [审查报告](../reviews/2026-10-20-running-task-highlight-review.md) |
| **T-7** | **补测 / 文档收尾 / 变异复核**：C11–C14 + locale 词条用例（F1–F5）、M8–M12 实测、README/PRD/locales 注释/设计 §9.2/工作记录/审查 §14 收尾；**不改功能行为** | 本文「T-7 补测与审查闭环」+ [审查报告 §14](../reviews/2026-10-20-running-task-highlight-review.md#14-t-7-处理结果) |

**耗时与尝试**：约 30 分钟（时间盒 25 分钟 / 硬上限 50 分钟内）；关键问题（字段口径、图标着色落点、刷新触发）各 1 次定向查证即确认，**无返工尝试**。

---

## T-4 实现记录（2026-10-20）

- **状态**：已完成（代码、测试、typecheck、build、全量 test 全绿；视觉验收待 T-6 重启后人工执行）
- **任务**：按 [设计文档](../design/2026-10-20-running-task-highlight.md) 做自测先行的实现，验收标准 AC1–AC13；**只**改设计 §10 列出的 7 个文件（含本文追加）
- **非目标（未越界）**：未改 `src/routes.ts` / `src/icons.ts` / `src/client.tsx` / `package.json` / `cordis.patch.yml` / `lib/` 源码 / 其它 docs；未提交、未切分支、未清理既有未提交改动

### 1. 改动文件与关键位置

| 文件 | 改动 |
|---|---|
| `src/tree-model.ts` | `RenderRow.project/worktree` 各新增必填 `hasRunningTasks`（含 JSDoc，L129–144 / L159–174）；`ContainerResult.hasRunningTasks`（L1190–1200）；`emitContainer` 用**截断前** `heads` 计算（L1948–1956，复用 `subagentCountOf`）；project 只聚合 `worktreeResults`（L2357）；worktree 透传（L2376）；未分组显式 `false`（L2422） |
| `src/live-state.ts` | 新增导出 `runningSignature(status: unknown): string`（L191），纯函数、`=== true`、`normalizeSessionKey` 去重排序、异常返回 `''` |
| `src/sidebar.tsx` | 从 `./live-state.js` import `runningSignature`（L33）；`ContainerRowView` 的 `runningHighlight` 判据（L790）、lead span `title`/`color`/`filter`（L795–810，着色在 `...dimText(12)` 之后）、行根条件 `data-running`（L882）；`runningSignatureValue` 派生（L1604）与 220ms 防抖依赖（L1683） |
| `src/locales.ts` | 新增唯一 key `a11y.runningTask` = `有任务正在运行`（L73，紧随 `a11y.subagents`） |
| `test/tree-model.test.mjs` | 新增 A1–A13（L1705–1960）；既有 A14/Q1 用例（L1677）原样保留 |
| `test/live-state.test.mjs` | 新增 B1–B8（L169–235） |
| `test/sidebar-wiring.test.mjs` | 新增 C1–C10（L879–1134），真实 `src/sidebar.tsx` 的 TypeScript AST 断言 |

**`data-running` 写法选择（主代理澄清项）**：采用契约 §5.3 的条件展开
`...(runningHighlight ? { 'data-running': 'true' } : {})`；C4 断言该属性只在 `runningHighlight`
条件分支内出现、值恒为字符串 `'true'`，写死属性会使 C4 变红。

### 2. Red → Green 证据（三组，均为行为缺失导致的失败）

**第一组：数据（`RenderRow` / 容器判定）**

- Red 命令：`npm run build && node --test test/tree-model.test.mjs`
- Red 结果：退出码 1，`tests 263 / pass 250 / fail 13`；A1–A13 全红，`actual: undefined`，
  原因 = `hasRunningTasks` 字段不存在（行为缺失，非语法/环境错误）。
- Green 实现：`RenderRow` 两字段 + `ContainerResult` + `emitContainer`（截断前 `heads`）+
  三个构造点填值 + 未分组显式 `false`。
- Green 结果：`node --test test/tree-model.test.mjs` ⇒ 退出码 0，`tests 263 / pass 263 / fail 0`
  （A14/Q1 既有用例保持通过）。
- 备注：首轮 Green 时 A8 因测试自身把未分组 key 写成 `UNGROUPED_KEY`（实际为
  `p:${UNGROUPED_KEY}`）而红 1 条；修正测试断言后全绿。**不是实现返工**。

**第二组：签名（`runningSignature`）**

- Red 阶段 1（API 不存在）：新增 B1–B8 后 `npm run build && node --test test/live-state.test.mjs`
  ⇒ 退出码 1，`SyntaxError: … does not provide an export named 'runningSignature'`
  （设计 §9.1 S8 预期的「函数不存在」）。
- Red 阶段 2（骨架行为红，排除环境因素）：加 `return ''` 骨架 → build → 定向运行
  ⇒ 退出码 1，`tests 18 / pass 14 / fail 4`，B1/B2/B3/B8 红（期望值 vs `''`）。
- Green 实现：按设计 §7.1 完整语义（`entries()` 守卫、`running === true`、归一化去重、
  `sort().join(',')`、整体 try/catch）。
- Green 结果：`node --test test/live-state.test.mjs` ⇒ 退出码 0，`tests 18 / pass 18 / fail 0`。

**第三组：渲染 + 刷新接线（AST）**

- Red 命令：`node --test test/sidebar-wiring.test.mjs`（解析真实 `src/sidebar.tsx`，无需 build）
- Red 结果：退出码 1，`tests 24 / pass 16 / fail 8`；C1–C5、C7–C9 红（无 `runningHighlight` /
  无着色 / 无 `data-running` / 无 title / 无 import / 无签名派生）。C6、C10 为既有行为的回归守卫，
  红阶段即通过属预期。
- Green 实现：`sidebar.tsx` 渲染与刷新接线 + `locales.ts` 词条。
- Green 结果：`node --test test/sidebar-wiring.test.mjs` ⇒ 退出码 0，`tests 24 / pass 24 / fail 0`。

### 3. 最终验证（实际执行）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npm run typecheck` | 0 | 无类型错误 |
| `npm run build` | 0 | `tsc` + client bundle + `clean-jsx` 全部成功（会写 `lib/`，T-4 允许） |
| `npm test`（先 build 再全量 `node --test`） | 0 | `tests 456 / pass 456 / fail 0 / cancelled 0` |

单一事实源自检（设计 §13）：`hasRunningTasks` 仅出现在 `src/tree-model.ts` 与三份测试；
`hasRunning\b` / `activeRow` / `isRunningTask` 零命中；`a11y.runningTask` 仅 `src/locales.ts`
（定义）与 `src/sidebar.tsx`（消费）+ C5；`state-business-primary` 仅在 `src/sidebar.tsx`
（color + filter 各一处）；`runningSignature` 仅 `src/live-state.ts`（实现）、`src/sidebar.tsx`
（消费）与两份测试。旧 Q1 文本与 `test/tree-model.test.mjs:1677` 用例未被改写。

### 4. 遗留 / 未验证

1. **视觉与真实交互未验证**（AC13）：当前 GUI 无法脚本截图 / 抓 DOM；需 T-6 `npm run build` →
   **重启 DSH Desktop** → 刷新页面 → 按设计 §11 的 10 步人工确认（亮起 ≤1s、熄灭、折叠态、
   子代理一致、history/flat/未分组不误亮、暗色可辨、无渲染错误）。
2. **变异验证 M1–M7 未执行**：属 T-5 复核范围；本轮的 C1–C10 断言已按设计预留判别力，
   但尚未实测「变异 ⇒ 变红」。
3. `data-running` 与 lead span style 仅为**结构**证据，不代表真实像素（设计 R8 已声明）。
4. 宿主 `useSessionStatus` 的覆盖范围是 T-2 的实现事实；保留 30s 轮询与 focus 强刷兜底。


---

## T-7 补测与审查闭环（2026-10-20）

- **状态**：已完成（测试锁 + 文档收尾；功能行为零改动；视觉仍待人工验收）
- **任务**：关闭 [T-6 独立审查](../reviews/2026-10-20-running-task-highlight-review.md) 的 **F1–F9**
  （测试判别力缺口 + 文档过期/索引缺失），让全量测试重新成为可信信号；**F10–F13** 记录为已知/不改。
- **非目标（未越界）**：未改 `src/sidebar.tsx` / `src/tree-model.ts` / `src/live-state.ts` 的功能行为；
  `src/locales.ts` **只改文件头注释**（词条值与顺序未动）；未改 `docs/testing` 的 T-5 报告正文；
  未动 `package.json` / `cordis.patch.yml` / 配置 / 路由；未提交、未切分支、未重启 DSH、未清理工作区。

### 1. F1–F9 处理结果

| 发现 | 级别 | 结论 | 落地证据（文件:行号） | 对应变异 |
|---|---|---|---|---|
| **F1** lead 图标 color/filter 不锁条件性（常亮全绿） | P2 | **closed** | `test/sidebar-wiring.test.mjs:1189`（C11：`isGuardedByRunningHighlight` 父链追溯，条件展开或三元值均可，`whenFalse` 必须为空） | **M8** |
| **F2** 整行着色 / 左侧竖条 / 状态点零测试锁 | P2 | **closed** | `test/sidebar-wiring.test.mjs:1204`（C12：行根 style 无 8 类整行着色键；`ContainerRowView` 子树无 `StatusDot` / `role="status"`） | **M9** |
| **F3** `data-running`「不高亮时不出现」未被真正锁住 | P2 | **closed** | `test/sidebar-wiring.test.mjs:1239`（C13：三元 `whenFalse` 必须 `undefined`/`void 0`；展开形态 `whenFalse` 必须 `{}`；且只允许一个 `data-running`） | **M10** |
| **F4** `a11y.runningTask` 词条存在性与中文文案零测试 | P2 | **closed** | `test/locales.test.mjs:114`（直接钉 `zh['a11y.runningTask'] === '有任务正在运行'`，并覆盖 `createT()` / `createSeatT(unresolvedSeat)` 两条取词路径） | **M11** |
| **F5** AC10「首拉」无断言 | P2（影响小） | **closed** | `test/sidebar-wiring.test.mjs:1278`（C14：`[reload]` effect 体内无参 `reload()` 且位置先于 `setInterval(reload, TREE_REFRESH_MS)`；`onFocus` 内调用在定时器之后，不构成恒真） | **M12** |
| **F6** `docs/README.md` 未索引 testing/reviews | P2（文档） | **closed** | `docs/README.md:38-39`（「本次需求」表新增验证报告 + 独立审查两行，总入口可导航） | — |
| **F7** PRD §12 状态过期 | P2（文档） | **closed** | `docs/PRD.md:688-692`（改为「T-4 已实现 / T-5 自动项通过 / T-6 有条件通过 / T-7 已补测试锁 / AC13 视觉待人工验收」） | — |
| **F8** `src/locales.ts` 头注释与内容漂移 | nit | **closed** | `src/locales.ts:10-13`（「尾部 4 条」→「尾部 5 条」并列入 `a11y.runningTask`；**仅注释**） | — |
| **F9** 工作记录 T-6 描述与实际派工不一致 | nit（文档） | **closed** | `docs/worklog/2026-10-20-running-task-highlight.md:180-181`（T-6 改为「独立审查」，新增 T-7「补测/文档收尾/变异复核」行） | — |

**F10–F13**：**accepted / known，本任务不改**（与审查报告结论一致，理由见审查报告 §14）：

- **F10**（history/flat 容器也计算 `hasRunningTasks`，无人消费）：保持行为不变，属 `O(可见会话数)` 的无用计算；
  改短路需动 `tree-model.ts` 行为，超出本任务「不改功能行为」范围。
- **F11**（签名含树里不可见的会话）：轻微多余 `/tree` 触发，无正确性影响；收敛需重新定义契约层「运行集合」。
- **F12**（`title`-only，读屏/键盘不可达）：加 `aria-label` 属产品边界决策（是否算「状态点」），需用户拍板。
- **F13**（`drop-shadow` 2px 在 16px 上的糊边风险）：只能人工看，已并入设计 §11 第 1/8 步验收。

### 2. 新增测试与断言摘要（+5 条，均为 AST / 词条级，不改实现）

| 测试名 | 断言摘要 | 判别对象 |
|---|---|---|
| `运行中高亮/接线:C11 lead span 的 color / filter 只在 runningHighlight 分支内（常亮必须红）` | style 子树里恰好各一处 `color` / `filter`，且父链命中的 `runningHighlight` 条件必须是 `whenTrue`（或三元值 + 空 `whenFalse`） | 着色条件性（F1） |
| `运行中高亮/接线:C12 容器行根不得整行着色，且子树无状态点 / role=status（AC8 禁止项）` | 行根 style 子树无 `background`/`backgroundColor`/`backgroundImage`/`borderLeft`/`borderColor`/`boxShadow`/`color`/`outline`；`ContainerRowView` 内无 `StatusDot` 调用、无 `role="status"` | AC8 三条禁止项（F2） |
| `运行中高亮/接线:C13 data-running 不高亮时必须**不出现**（'false' 形态必须红）` | 恰好一个 `data-running`；三元形态 `whenFalse ∈ {undefined, void 0}`；展开形态属性在 `whenTrue` 且 `whenFalse === {}` | 属性条件性（F3） |
| `locales: a11y.runningTask 词条存在且中文文案为「有任务正在运行」（AC9）` | `zh['a11y.runningTask']` 精确等于中文文案；`createT()` 与 `createSeatT(unresolvedSeat)` 对该 key 返回该文案 | 词条存在性 / 裸 key 风险（F4） |
| `运行中高亮/接线:C14 mount effect 先 reload() 首拉，再 setInterval(reload, TREE_REFRESH_MS)` | 依赖数组恰为 `[reload]` 的 effect 体内存在无参 `reload()`，且其位置 < `setInterval` 位置 | 首拉顺序（F5） |

新增 helper（同文件内，仅测试侧）：`isGuardedByRunningHighlight(node)`、`containerRowRoot()`；
复用既有 `isRunningHighlightRef` / `subtreeContains` / `propertyAssignmentsNamed` / `findAll`，
沿用 `运行中高亮/接线:C…` 命名与 `normalizeWs` 的「不锁字面格式」风格。

### 3. 变异复核（`/tmp` 副本，主仓库只读）

```sh
TMP=$(mktemp -d /tmp/t7-mut-XXXXXXXX)            # /tmp/t7-mut-uUU3Mkwu
rsync -a --exclude '.git' --exclude 'node_modules' --exclude 'lib' ./ "$TMP/"
ln -s "$PWD/node_modules" "$TMP/node_modules"
cd "$TMP" && npm run build && node --test test/sidebar-wiring.test.mjs test/locales.test.mjs
# 基线：tests 37 / pass 37 / fail 0
# 每个变异：改副本 src → 跑定向 → 恢复备份 → 下一个；全部结束后 rm -rf 副本
```

| 变异 | 做法 | 预期红 | 实际红 | fail 数 |
|---|---|---|---|---|
| **M8**（F1） | 把 `color`/`filter` 从 `...(runningHighlight ? {…} : {})` 移到 style 顶层（常亮） | C11 | **C11** | **1**（37/36） |
| **M9**（F2） | 行根 style 顶层加 `background` + `borderLeft`（整行着色 + 竖条） | C12 | **C12** | **1**（37/36） |
| **M10**（F3） | `...(runningHighlight ? { 'data-running': 'true' } : {})` → `'data-running': runningHighlight ? 'true' : 'false'` | C13 | **C13** | **1**（37/36） |
| **M11**（F4） | 删除 `a11y.runningTask` 词条（`npx tsc` 仍 exit 0） | locale 新用例 | **`locales: a11y.runningTask …`** | **1**（37/36） |
| **M12**（F5） | 删除 mount effect 第一行 `reload()` | C14 | **C14** | **1**（37/36） |

- 每个变异**只有**对应新用例变红（无连带误报），符合「一个变异至少 1 条用例变红且归因清晰」的仓库惯例。
- 副本已 `rm -rf /tmp/t7-mut-uUU3Mkwu`；`/tmp` 无残留副本。主仓库 `src/sidebar.tsx` mtime 仍为 13:12、
  `src/tree-model.ts` / `src/live-state.ts` 未被写入；`git status` 仅新增本任务声明的测试/文档改动。

### 4. 验证证据（主仓库实跑）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npm run typecheck` | 0 | 无类型错误 |
| `npm run build` | 0 | `tsc` + client bundle + `clean-jsx` 全部成功（写 `lib/`，本任务允许） |
| `node --test test/sidebar-wiring.test.mjs test/locales.test.mjs` | 0 | `tests 37 / pass 37 / fail 0 / cancelled 0`（原 32） |
| `npm test`（先 build 再全量 `node --test`） | 0 | `tests 461 / pass 461 / fail 0 / cancelled 0`（原 456） |

**测试数变化**：`test/sidebar-wiring.test.mjs` 24 → 28（C11–C14），`test/locales.test.mjs` 8 → 9（F4 词条用例），
全量 456 → **461**（+5）。既有 A1–A14 / B1–B8 / C1–C10 与旧 Q1 回归锁均未修改、未删除、未放宽。

### 5. 文档改动清单（本任务）

| 文件 | 改动 |
|---|---|
| `test/sidebar-wiring.test.mjs` | +C11–C14 与两个 helper；文件内新增 T-7 段注释（变异缺口说明） |
| `test/locales.test.mjs` | +1 条 `a11y.runningTask` 词条/文案用例 |
| `src/locales.ts` | **仅文件头注释**：「尾部 4 条」→「尾部 5 条」并列入 `a11y.runningTask`（词条值未动） |
| `docs/README.md` | 「本次需求」表 +验证报告（T-5）、+独立审查（T-6/§14）两行 |
| `docs/PRD.md` | §12 状态更新为 T-4/T-5/T-6/T-7 + AC13 待人工验收 |
| `docs/design/…-highlight.md` | §9.2 C 表 +C11–C14；D 表 +M8–M12 并注明 T-7 补测；§11 人工验收清单未改 |
| `docs/worklog/…-highlight.md` | T-6 改为「独立审查」、+T-7 行；末尾 +本节 |
| `docs/reviews/…-review.md` | 末尾 +§14「T-7 处理结果」（逐条 F1–F9 closed / F10–F13 accepted，不改原结论） |

### 6. 未改行为声明与未验证项

- **零功能行为改动**：`src/sidebar.tsx`、`src/tree-model.ts`、`src/live-state.ts` 未编辑；
  `src/locales.ts` 只改注释；所有实现文件由 `npm run build` 重新产出的 `lib/` 与源码一致。
- **仍未验证（不算通过）**：**AC13 全部视觉项**（亮起/熄灭/折叠/暗色/无 `React error #130`/压力）、
  AC10 的 0.3–1 s 端到端时延、`drop-shadow` 观感，以及「重启 DSH Desktop 后真实 GUI 生效」——
  需按设计 §11 十步人工验收；本任务未重启、未截图、未抓 DOM。
- **测试能力边界**：C11–C14 是**对真实 `src/sidebar.tsx` 的 AST 结构断言**，证明「源码结构上条件性/禁止项/顺序成立」，
  **不证明**浏览器里的实际像素与交互；`test/locales.test.mjs` 是纯逻辑词条断言，能防裸 key 但不等价于真实 locale 服务渲染。

### 7. R1 / R2 复核补记（T-6 复核后加固，2026-10-20）

T-6 复核提出两个**非阻塞 nit**（不改变 F1–F9 结论），T-7 按建议补锁，**未改功能源码**：

- **R1（C12 禁止键集合）**：原 C12 只禁 8 类整行着色键，语义上仍漏「整行描边 / 发光」。
  现扩为 **11 类**：新增 `border` / `filter` / `textShadow`（原 8 类：`background` / `backgroundColor` /
  `backgroundImage` / `borderLeft` / `borderColor` / `boxShadow` / `color` / `outline`）。
  测试位置 `test/sidebar-wiring.test.mjs:1204`（C12），设计 §9.2 C12 描述已同步。
- **R2（C14 首拉断言强度）**：原 C14 只要求「无参 `reload()` 早于 `setInterval`」，可被
  「删首拉 + 把 `onFocus` 前移」绕过（前移后 `onFocus` 闭包里的 `reload()` 又早于定时器）。
  现追加断言：**effect 体的第一条语句必须是无参 `reload()`**，并**保留**原顺序断言。
  测试位置 `test/sidebar-wiring.test.mjs:1278`（C14），设计 §9.2 C14 描述已同步。

**补锁后实测**（主仓库）：

| 命令 / 变异 | 结果 |
|---|---|
| `node --test test/sidebar-wiring.test.mjs` | `tests 28 / pass 28 / fail 0` |
| `npm test`（先 build 再全量） | `tests 461 / pass 461 / fail 0 / cancelled 0` |
| `/tmp` 副本：行根 style 加 `border: runningHighlight ? … : undefined` | **C12 红，fail 1**（28/27） |
| `/tmp` 副本：删首拉 + 把 `onFocus` 前移到 `setInterval` 之前 | **C14 红，fail 1**（28/27） |

- 两个绕过变异都各自只红对应用例（无连带误报）；副本 `/tmp/t7-r1r2-KH5lvtLI` 已 `rm -rf`，主仓库
  `src/sidebar.tsx` / `src/tree-model.ts` / `src/live-state.ts` 未被编辑（mtime 仍为 13:12 / 13:10 / 13:11）。
- 本节新增的 R1/R2 是**测试断言收紧**，不改变任何运行时行为；设计 D 表 M1–M12 编号与结论不变
  （R1/R2 属 C12/C14 的同一变异族，不再单列编号）。

---

## T-8 追加需求：workspace flat 会话聚合（2026-10-20）

- **状态**：已完成（实现 + 测试 + 文档同步；全量 462/462、typecheck / build 全绿；视觉仍待人工）
- **需求来源**：用户 2026-10-20 追加拍板（经主代理追问后确认），覆盖 T-3 定稿的 RT2 聚合范围
- **范围**：只改 `src/tree-model.ts` 的 project 判定、`test/tree-model.test.mjs` 的 A7 + 新增 A15、
  以及与实现逐字对齐的 5 份文档；**未**改 `sidebar.tsx` / `live-state.ts` / `locales.ts` / 路由 / 配置，
  **未**重启 DSH、未提交、未清理工作区

### 1. 用户新裁决（原样记录）

1. 「无 worktree 的工作区，如果有任务在进行，文件夹 icon 也要高亮。」
2. 追问后用户明确选：**所有 workspace 都统计普通会话** —— worktree 都空闲、但有 flat 会话在跑时，
   project 文件夹也要亮；**不局限于完全没有 worktree 的 workspace**。
3. 统计范围：只统计**该 workspace 的**普通/flat 会话；**不含 history 桶，不含未分组**（沿用既有排除裁决）。

**落地**：project `hasRunningTasks` = worktree 子项 `true` **OR** 该 workspace 的 flat 容器 `true`；
worktree 行判定不变；未分组行仍显式 `false`；history 行仍无该字段。

### 2. `flatResult` 归属核实与实现取舍

- 核实：`flatResult` 在 `buildRows` 内由 `containers.flat` 派生（`src/tree-model.ts:2317` 旧行），
  而 `containersOfProject` **只在 `!hasWorktreeRows`（即非 git 工作区）时**建 `flat`
  （`src/tree-model.ts:1736-1747`）；`project.flatSessions` 对 git 项目在真实宿主数据里恒为空
  （`src/projects.ts:289` 归属规则 2b、`:423-431`）。
- 因此若直接写 `flatResult.hasRunningTasks`，A15（git workspace 有 worktree + flat 在跑）会因
  `flatResult === undefined` 而无法表示。按派工「按真实代码调整」的要求，实现为：
  **所有项目**都用 `project.flatSessions` 构建 flat 容器（非 git 直接用 `containers.flat`；git 项目
  构造仅供判定的等价容器），`rendersFlat` 保证 git 项目的 flat **不渲染、不计入 `sessionCount`**
  （D11 与既有 `实体门控: git 项目…不吞 flatSessions` 用例均不回归）。
- 最终 project 表达式（`src/tree-model.ts:2375-2377`）：

  ```ts
  hasRunningTasks:
    worktreeResults.some((entry) => entry.result.hasRunningTasks === true) ||
    flatResult.hasRunningTasks === true,
  ```

  `allResults` 仍**不得**整体并入（它含 history 桶）；flat 为空/无会话 ⇒ `emitContainer` 的
  `heads` 为空 ⇒ `false`。

### 3. TDD 证据

**Red（先改测试、实现未动）**

```sh
npm run build          # exit 0（只验证基线可构建，避免把环境错误当预期失败）
node --test test/tree-model.test.mjs
# tests 264 / pass 262 / fail 2
```

失败用例与原因（均为**行为缺失**，不是语法/环境错误）：

- `运行中高亮/A7: 非 git 平铺会话在跑 ⇒ project=true（追加裁决：聚合 flat）`
  —— 断言 `hasRunningTasks === true`，实际 `false`；
- `运行中高亮/A15: git workspace 的 worktree 空闲、但 flat 会话在跑 ⇒ project=true、worktree=false`
  —— 断言 project `true`，实际 `false`（worktree 行已按预期 `false`）。

**Green（最小改 project 判定 + 注释）**

```sh
npm run build          # exit 0
node --test test/tree-model.test.mjs
# tests 264 / pass 264 / fail 0
```

**全量验证（主仓库实跑，最后一遍）**

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npm run typecheck` | 0 | 无类型错误 |
| `npm run build` | 0 | `tsc` + client bundle + `clean-jsx` 全部成功 |
| `npm test`（先 build 再全量 `node --test`） | 0 | `tests 462 / pass 462 / fail 0 / cancelled 0`（T-7 后 461，+A15 = 462） |

既有 A1/A2/A4/A6/A8 与旧 Q1 回归锁（`runningCount` 口径不变）均未修改、未删除、未放宽；
A7 由 `false` 反转为 `true` 是本次用户裁决的直接结果，属**有意**的期望值更新。

### 4. 改动文件与关键位置

| 文件 | 改动 |
|---|---|
| `src/tree-model.ts` | `buildRows` 为所有项目构建 flat 容器（`:2317-2335` 附近）、`allResults` 用 `rendersFlat` 门控、project 判定加 `\|\| flatResult.hasRunningTasks === true`（`:2373-2377`）、`RenderRow.project` / `ContainerResult` / 未分组行注释 |
| `test/tree-model.test.mjs` | A7 反转（`:1840-1867`）、新增 A15（`:1869-1896`）、段头注释更新 |
| `docs/requirements/2026-10-20-running-task-highlight.md` | RT2、AC4、AC12、AC13、非目标 3；新增 §2.2 追加裁决（含用户原话） |
| `docs/design/2026-10-20-running-task-highlight.md` | §3.3 判定与边界、§3.5 构造点、§4 边界表（+A15 行）、§9.1 S4/S17、§9.2 A7/A15、§10.2 T-8 文件清单、§11 第 5 步、§13 同一事实表、M6 说明 |
| `docs/PRD.md` | §12 状态 + RT2 覆盖说明 + 新增 RT7；§12.3 非目标修正 |
| `docs/INTERFACES.md` | §2.2 project JSDoc；§2.2.1 判定表 / flatResult 归属 / 边界表；§2.3 非目标修正 |
| `docs/worklog/2026-10-20-running-task-highlight.md` | 仅追加本节 |

**旧表述修正（避免自相矛盾）**：requirements 的「只聚合 worktree / flat 不参与」、design §3.3/§4/§9/§11/§13、
PRD RT2/§12.3、INTERFACES §2.2/§2.2.1/§2.3 中「flat 不参与」的说法全部改为
「worktree **OR** 本 workspace flat；history/未分组排除」；历史 `docs/testing` / `docs/reviews` 正文未改。

### 5. 未验证 / 风险

- **视觉仍未人工验收**：本次未重启 DSH Desktop、未截图、未抓 DOM；「无 worktree 的 workspace 文件夹亮」
  与「worktree 空闲但有 flat 在跑时文件夹亮」需按设计 §11 第 5 步人工确认。
- **git workspace 的 flat 在真实数据中恒空**（`projects.ts` 归属规则 2b）⇒ A15 是**契约形状守卫**，
  不代表真实数据会出现「git worktree 空闲 + flat 在跑」；但它保证「所有 workspace 都统计 flat」的口径
  不会因未来数据模型变化而静默失效。
- **history/未分组仍排除**：A6/A8 持续守护；未分组行不因容器内有运行中会话而亮。
- `runningCount` 语义保持旧 Q1 裁决不变（仍只数 `session.running`），本次未触碰。

---

## T-11 A15 计数补锁与生效路径更正（2026-10-20）

- **任务**：T-11（补测 + 文档更正；**不改功能源码**）
- **状态**：已完成（视觉项仍待人工，见 §6）
- **输入**：T-10 审查 [§17](../reviews/2026-10-20-running-task-highlight-review.md)（F17-1 / F17-2 / F17-3 / F17-5、§17.8 生效路径更正）、T-9 [验证 §11](../testing/2026-10-20-running-task-highlight-verification.md)
- **写入范围（且仅这些）**：`test/tree-model.test.mjs`（**仅 A15 追加断言**）、design / PRD / requirements / INTERFACES / testing（仅追加 §12）、两份 research 的覆盖标注、本节；`src/` 零改动
- **验收**：A15 补锁计数与不渲染 + M13 变异必须红；typecheck / build / 定向 / 全量全绿；文档去掉「必须重启 host」旧说

### 1. F17-1 处理：A15 补锁「不计数 / 不渲染」（P2 已关闭）

A15（`test/tree-model.test.mjs:1869-1908`）在既有断言**之后追加** 4 条（不改既有断言、不删用例）：

```js
assert.equal(projectRow.sessionCount, 1, 'git flat 不计入 project.sessionCount（只数 worktree 的 1 条）')
assert.equal(projectRow.runningCount, 0, 'git flat 不计入 runningCount（Q1 口径不变）')
assert.equal(projectRow.pendingCount, 0, 'git flat 不计入 pendingCount')
assert.equal(
  rows.some((row) => row.kind === 'session' && row.sessionId === 'f-flat'),
  false,
  'git flat 不渲染：flat 会话不进 rows',
)
```

**为什么必须补**：T-9 §11.4 已报「行为正确但无测试锁」；T-10 §17.3 用独立变异（M-FLAT-2b）复现
「计数被污染但 264/264 全绿」。补锁后该变异**必然变红**（M13，见 §2）。

### 2. M13 变异（新断言的判别力证据）

`/tmp/t11-mut-m13` 副本（`rsync` 排除 `.git`/`node_modules`/`lib` + 软链 `node_modules`），
把 `src/tree-model.ts` 的 `...(rendersFlat ? [flatResult] : [])` 改为 `flatResult`（只污染计数、不改渲染门控）：

| 项 | 干净 lib | M13 变异 lib |
|---|---|---|
| `project.sessionCount` | `1` | **`2`** |
| `project.runningCount` | `0` | **`1`** |
| flat 会话是否渲染 | `false` | `false`（渲染门控未动） |
| `node --test test/tree-model.test.mjs` | 264/264 | **263/264，fail 1**（A15 的 `sessionCount 2 ≠ 1`） |

计数差异由 `/tmp/t11-m13-probe.mjs` 只读 import 两份 `lib/tree-model.js` 直接打印；副本与脚本已清理。
M13 已登记进 design §9 的 D 表。

### 3. F17-2 处理：历史调研的反向表述加「已被 T-8 / RT7 覆盖」标注

- `docs/research/2026-10-20-host-capability-verification.md`：**文首**加历史快照声明（含「非 git flat 与
  ungrouped 被混同、方向相反」与「client bundle 生效路径」两条补注）；§8 第 5 步、§11 第 2 条各加一行覆盖标注。
  **正文原结论一字未改**（历史快照保留）。
- `docs/research/2026-10-20-running-task-highlight-research.md`：T-1 的 Q3「A. 只算 worktree 子行 —— *推荐*」
  是当时的反向表述，补一行「已被 T-8 / RT7 覆盖」标注（其余正文不改）。

### 4. 架构更正：「必须重启 host」不准确（依据 T-10 §17.8）

- `POST /dsh-worktree-groups/tree` 只返回**原始** `{ok, projects, ungrouped, archivedSessionIds, workspaceByPath}`
  （`src/routes.ts:820-825`、`:898-903`、`:1386-1393`），**不含** `hasRunningTasks`；
- `buildRows` 唯一调用点 `src/sidebar.tsx:2887`，只经 `src/client.tsx` 打进 `lib/client.js`；
  `src/index.ts` / `src/routes.ts` 从不 import `tree-model.ts`；
- ⇒ T-8 改的是**客户端 bundle**。最小生效步骤：`npm run build`（或 `build:client`）→ **刷新页面**
  （必要时硬刷新）→ 设计 §11。**仅**「首次安装 / 新增 bundle」（PRD :668）或改宿主代码时才**必须**重启。
- 已更正的现行文档：PRD §12 状态 / §12.4 第 1 条；requirements AC13 / §5；design §1 F10 / §11 标题+前提 /
  §12 R1 / §13 表；testing §12.4（并声明 §8.2 正文不改）。PRD :539 与 :668 的既有正确说法**保留**。

### 5. 验证证据（主仓库实跑，2026-10-20 14:53–15:10）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npm run typecheck` | 0 | 无类型错误 |
| `npm run build` | 0 | `tsc` + `build-client` + `clean-jsx` 均完成 |
| `node --test test/tree-model.test.mjs` | 0 | `tests 264 / pass 264 / fail 0`（**test count 不变**） |
| `npm test` | 0 | `tests 462 / pass 462 / fail 0 / cancelled 0` |
| M13（`/tmp` 副本） | 1（预期红） | `263/264`，fail 1：A15 `sessionCount` 2≠1 |
| `grep -c hasRunningTasks lib/client.js` | 0 | 6 处（含 flat 聚合表达式）——client bundle 生效路径证据 |

**F17-3 登记**：`git diff --numstat src/tree-model.ts` = **`73/3`**（不是 T-9 §11.1 的 `76/0`），
已在 testing §12.3 更正说明；T-9 正文不改。`test/tree-model.test.mjs` 现为 `320/0`（T-9 时 `308/0`）。

### 6. 未验证 / 风险

- **视觉仍未人工验收**（AC13）：本任务未刷新页面、未截图、未抓 DOM、未重启 DSH；「worktree 空闲但 flat 在跑
  时文件夹亮」「无 worktree 的 workspace 文件夹亮」仍需按设计 §11 第 5 步人工确认（建议同时挑一个非 git 与一个 git 工作区）。
- **F17-5 幽灵高亮**按 known 处理：仅在 design §4 记一行「真实数据不可达、只判定不渲染不计数」，**不改行为**。
- **F17-4（project 级 flatSessions）** 以术语说明收口（非 git 时 `project == workspace`；git 为 project 级形状守卫），无行为影响。
- `docs/reviews/` 正文未改（T-10 复核会追加）；未提交、未切分支、未清理工作区；`lib/` 由 `npm test` 重新生成（gitignore）。
