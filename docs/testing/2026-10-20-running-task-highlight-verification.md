# 验证报告：运行中任务的文件夹 / worktree 图标高亮（T-5 独立复核）

- **文档类型**：测试 / 验证报告（独立复核，非作者自测）
- **日期**：2026-10-20
- **任务**：T-5（只读主仓库源码与测试；变异在 `/tmp` 临时副本内做；**不改主仓库业务文件**）
- **被验证对象**：T-4 的实现（[需求 AC1–AC13](../requirements/2026-10-20-running-task-highlight.md)、[设计 §3–§11](../design/2026-10-20-running-task-highlight.md)、[INTERFACES §2.1/§2.2/§2.2.1/§2.3/§2.3.2](../INTERFACES.md)）
- **结论**：**自动可验证部分全部通过**（全量 + 定向测试、代码事实、文档一致性）；**变异 M1–M7 全部按设计变红（7/7）**；**视觉 / 运行时验收未验证**（GUI 不可脚本截图，见 §8）
- **唯一写入文件**：本文件 + 检查点 `~/.local/state/ai-work-dispatcher/runs/2026-10-20-running-highlight/progress/T-5.md`

---

## 1. 结论摘要

| 项 | 结论 | 证据位置 |
|---|---|---|
| 新鲜全量复跑（`typecheck` / `build` / `test`） | **通过**：退出码全 0；`tests 456 / pass 456 / fail 0 / cancelled 0` | §3.1 |
| 定向复跑（三个测试文件） | **通过**：`263/263`、`18/18`、`24/24`，退出码全 0 | §3.2 |
| A1–A13 / B1–B8 / C1–C10 用例真实存在且通过 | **通过**：13 + 8 + 10 条全部命中并通过 | §3.3 |
| 代码事实（字段、判定、渲染、签名、接线） | **全部符合设计与契约** | §4 |
| 旧 Q1 裁决未被改写（`test/tree-model.test.mjs:1677`、`src/tree-model.ts:2261-2262`、`docs/INTERFACES.md:1316-1317`） | **通过**：测试文件与源码均为**纯新增（0 删除行）**；Q1 测试行与 `HEAD` 逐字一致 | §2.2、§7.2 |
| 单一事实源（无第二套字段名 / key / 颜色 / 签名） | **通过** | §7.1 |
| 变异判别力 M1–M7 | **7/7 有结果，且 7/7 按设计变红** | §6 |
| 视觉 / 真实像素 / 运行时时延（AC13、AC8 视觉部分、AC10 时延） | **未验证**（不可脚本化） | §8 |
| 主仓库业务文件是否被本任务改动 | **未改动**：除本任务新增的 `docs/testing/` 外，`git status --porcelain=v1` 的 24 项与验证前逐条一致 | §2.1 |

**一句话**：T-4 的实现满足**所有可自动验证**的验收标准，且测试对关键接线与数据判定具备真实判别力（7 个针对性变异全部被抓）；**唯一未覆盖**的是必须重启 DSH Desktop 后才能人工观察的视觉与交互（AC13）。

---

## 2. 验证环境与范围核对

### 2.1 工作区状态（验证前 / 验证后逐字一致）

```sh
cd /Users/dev/Documents/Project/AnyWork/dsh-worktree-groups
git status --porcelain=v1     # exit 0
git diff --stat               # exit 0
git diff --name-only          # exit 0
git rev-parse --abbrev-ref HEAD   # master；HEAD = 5d2fe51
```

验证前后**逐条比对一致**（24 项业务/文档改动零变化）；**唯一新增**是本任务报告所在目录 `?? docs/testing/`，以及被 `gitignore` 覆盖的 `lib/` 构建产物。验证前的输出：

```
 M docs/HOST-CONTRACTS.md          M src/locales.ts
 M docs/INTERFACES.md              M src/sidebar.tsx
 M docs/PRD.md                     M src/tree-model.ts
 M docs/README.md                  M test/sidebar-wiring.test.mjs
 M docs/knowledge/README.md        M test/tree-model.test.mjs
 M docs/knowledge/l2-modules/WebClient模块技术文档.md
 M docs/knowledge/l3-components/Sidebar技术文档.md
?? docs/design/                    ?? src/icons.ts
?? docs/knowledge/l3-components/Icons技术文档.md
?? docs/knowledge/l3-components/LiveState技术文档.md
?? docs/requirements/              ?? src/live-state.ts
?? docs/research/                  ?? test/icons.test.mjs
?? docs/worklog/2026-10-19-sidebar-render-failure-icons.md
?? docs/worklog/2026-10-20-running-task-highlight.md
?? test/live-state.test.mjs        ?? test/render-smoke.test.mjs
```

`git diff --stat`（验证前）：`12 files changed, 1117 insertions(+), 147 deletions(-)`。

### 2.2 范围核对（T-4 只改约定文件）

**先说明限制**：该工作区**累积了多轮任务**的未提交改动（2026-10-19 图标修复、live-state 抽取、T-3 文档、T-4 高亮），
`git diff` 无法按任务切分。因此本任务用**三层交叉证据**代替「单一 diff 隔离」：

1. **文件集合**：T-4 记录声明的 7 个文件（`src/tree-model.ts`、`src/live-state.ts`、`src/sidebar.tsx`、`src/locales.ts`、
   `test/tree-model.test.mjs`、`test/live-state.test.mjs`、`test/sidebar-wiring.test.mjs`）之外，
   非目标文件**确实未被改动**：

   ```sh
   git status --porcelain=v1 src/routes.ts src/icons.ts package.json cordis.patch.yml src/client.tsx
   # => 仅 "?? src/icons.ts"（2026-10-19 任务的产物，早于本需求；其中无 hasRunningTasks / runningSignature）
   ```

   `src/routes.ts` / `package.json` / `cordis.patch.yml` / `src/client.tsx` **零改动**（无输出）。

2. **新增行归属**：逐文件新增/删除行数（`git diff --numstat`）：

   | 文件 | + | − | 判定 |
   |---|---|---|---|
   | `src/tree-model.ts` | 49 | **0** | **纯新增** ⇒ 旧 `runningCount` JSDoc 未被改写 |
   | `src/locales.ts` | 2 | **0** | **纯新增**（1 行注释 + 1 个 key） |
   | `test/tree-model.test.mjs` | 269 | **0** | **纯新增** ⇒ Q1 用例未被改写/删除 |
   | `test/sidebar-wiring.test.mjs` | 342 | **0** | **纯新增** |
   | `src/sidebar.tsx` | 128 | 142 | 混合：2026-10-19 图标重构 + live-state 抽取 + **T-4 高亮**（见下条） |
   | `docs/INTERFACES.md` | 180 | 1 | T-3 文档：删掉的 1 行是「30s 刷新」旧句（新增第 4 触发源），**不是**旧 Q1 段落 |
   | `test/live-state.test.mjs` | 新文件 | — | untracked（B1–B8 + 接线断言） |

3. **高亮自身的改动点逐条落到约定位置**（`grep -n` 证据见 §4）：`hasRunningTasks` 只出现在 `src/tree-model.ts`
   （类型 / `ContainerResult` / `emitContainer` / 三个构造点）与三份测试；`runningSignature` 只出现在
   `src/live-state.ts`（实现）、`src/sidebar.tsx`（消费）与两份测试；`a11y.runningTask` 只出现在
   `src/locales.ts` 与 `src/sidebar.tsx`。

**旧 Q1 用例未被改写（逐字比对）**：

```sh
git show HEAD:test/tree-model.test.mjs | sed -n '1677p'
sed -n '1677p' test/tree-model.test.mjs
# 两行逐字相同：
# test('需求 A: 容器/项目行的 runningCount 口径**不变**（用户裁决 Q1：渲染层无消费者）', () => {
```

`git diff -U0 test/tree-model.test.mjs | grep -c '^-[^-]'` ⇒ `0`（该文件**没有任何删除行**）。

**旧 `runningCount` JSDoc 未被改写**：`src/tree-model.ts:2261-2262` 仍为
「`runningCount` 的口径**不变**（仍只数 `session.running`）—— 渲染层无消费者，本次不动（用户裁决 Q1）」；
`src/tree-model.ts:21` 的「**不含**子代理聚合（用户裁决 Q1：渲染层无消费者，不扩大范围）」同样原样保留。

---

## 3. 新鲜复跑（本任务实际执行，不引用 T-4 数字）

### 3.1 全量：`typecheck` → `build` → `test`

```sh
cd /Users/dev/Documents/Project/AnyWork/dsh-worktree-groups
npm run typecheck   # 退出码 0（tsc --noEmit，无输出）
npm run build       # 退出码 0（tsc + build-client + clean-jsx；[clean-jsx] removed 4 file(s) from lib/）
npm test            # 退出码 0（先 build，再 node --test 全量）
```

`npm test` 末尾计数（原始输出）：

```
ℹ tests 456
ℹ suites 0
ℹ pass 456
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 14468.158833
```

**结论**：456/456 通过，0 失败、0 取消、0 跳过。`lib/` 由本次构建重新生成（属验证的一部分，任务允许）。

### 3.2 定向复跑

| 命令 | 退出码 | tests | pass | fail |
|---|---|---|---|---|
| `node --test test/tree-model.test.mjs` | 0 | 263 | 263 | 0 |
| `node --test test/live-state.test.mjs` | 0 | 18 | 18 | 0 |
| `node --test test/sidebar-wiring.test.mjs` | 0 | 24 | 24 | 0 |

### 3.3 用例矩阵真实性（A / B / C 逐条命中）

从**新鲜全量日志**中按名字提取，全部为 `✔`：

- `运行中高亮/A1…A13` ⇒ **13/13**：`test/tree-model.test.mjs:1705,1722,1752,1772,1793,1812,1839,1859,1867,1885,1906,1926,1945`
- `running-signature/B1…B8` ⇒ **8/8**：`test/live-state.test.mjs:169,178,186,195,200,208,218,226`
- `运行中高亮/接线:C1…C10` ⇒ **10/10**：`test/sidebar-wiring.test.mjs:879,898,911,937,975,1005,1028,1078,1091,1113`

> A14（既有 Q1 回归锁）在 `test/tree-model.test.mjs:1677`，本次全量与定向运行均通过（未被修改）。

---

## 4. 代码事实核对（文件:行号）

### 4.1 worktree 判定：**截断前 heads** + 与会话行 **同源** 的 `subagentCountOf`

| 事实 | 证据（`src/tree-model.ts`） |
|---|---|
| `heads` 是截断前的可见顶层会话；`truncateSessions(heads, …)` 只影响 `selected` | `:1907`（`const truncated = truncateSessions(heads, COLLAPSED_SESSION_LIMIT)`）、`:1909-1921`（`selected` 分支） |
| `hasRunningTasks` 用 **`heads`**（不是 `selected` / `truncated.visible`） | `:1952-1956`：`heads.some((session) => session.running === true \|\| subagentCountOf(context.subagentRunningCounts, session.sessionId) > 0)` |
| 会话行 `running` 用**同一个** helper（结构性同源，非注释承诺） | `:1496`：`running: session.running === true \|\| subagentCountOf(counts, session.sessionId) > 0`；helper 定义 `:1406` |
| 只有子代理时 `hasRunningTasks === true`，而 `runningCount` 仍 **0** | `:1946`：`runningCount: heads.filter((session) => session.running === true).length`（未改口径）；A2 用例同时断言两者 |

### 4.2 project 判定：**只用 `worktreeResults`**

| 事实 | 证据 |
|---|---|
| `worktreeResults` 定义 | `src/tree-model.ts:2330-2335` |
| `allResults` 含 flat / history（**不得**用于高亮判定） | `:2337-2341` |
| project 的 `hasRunningTasks` 只用 `worktreeResults.some(...)` | `:2357` |
| 未分组行**显式** `false`（即使 `result.hasRunningTasks` 为 true） | `:2422`（注释见 `:2418-2421`） |
| `history` 行**没有**该字段 | `:2386-2396`（字段只有 `sessionCount/runningCount/pendingCount` 等，**无** `hasRunningTasks`） |
| 非 git 工作区 `worktrees` 为空 ⇒ `.some` 天然 `false` | `:2357` + `flatResult` 不参与 |

### 4.3 渲染：`runningHighlight` 唯一判据与落点

| 事实 | 证据（`src/sidebar.tsx`） |
|---|---|
| 判据唯一、先排除 history、只认 `=== true` | `:790` `const runningHighlight = row.kind === 'history' ? false : row.hasRunningTasks === true` |
| `title` 仅高亮时加，取 `t('a11y.runningTask')` | `:795` |
| 高亮色在 `...dimText(12)` **之后**设置（覆盖 label-tertiary 灰） | `dimText` 的调用在 `:798`；`color` 在 `:804`、`filter` 在 `:805`（顺序成立） |
| 颜色 / 光晕逐字符合契约 | `:804` `'var(--dsw-alias-state-business-primary, #4176e6)'`；`:805` `'drop-shadow(0 0 2px var(--dsw-alias-state-business-primary, #4176e6))'` |
| `icon()` **未**收到 `style` / `color`（宿主会丢弃） | `icon()` 定义 `:117-121`；`ContainerRowView` 内的 4 处调用 `:780,782,784,785` 全部无第二实参；C6 另有全量断言 |
| `data-running` 只在高亮时出现（条件展开，不是 `"false"`） | `:882` `...(runningHighlight ? { 'data-running': 'true' } : {})`；`grep -c data-running src/sidebar.tsx` ⇒ **1** |
| 无新增 DOM 节点 / 无行背景 / 无状态点 / 无徽章 | `children` 数组顺序未变（`lead` → `chevron` → `label` …）；`ContainerRowView` 内无 `StatusDot` |

### 4.4 签名与刷新接线

| 事实 | 证据 |
|---|---|
| 只认 `running === true`（`undefined` / 真值对象不算） | `src/live-state.ts:199` |
| 归一化去重（`normalizeSessionKey`，`session-x` 与 `x` 只算一次） | `:200-202` + `:65-67` |
| 稳定排序 + 逗号拼接 | `:204` `[...keys].sort().join(',')` |
| 异常形状 / `entries()` 抛错 ⇒ `''` 且不抛 | `:193`（`entries` 守卫）、`:205-207`（整体 try/catch） |
| `sidebar.tsx` 从 `./live-state.js` import | `src/sidebar.tsx:33` |
| 在 `sessionStatus` 旁派生（普通值，不改 hook 数量） | `:1604` `const runningSignatureValue = runningSignature(sessionStatus)` |
| **进入** 220 ms 防抖依赖 | `:1683` `}, [reload, sessionsSnapshot, currentSessionId, runningSignatureValue])`，定时器在 `:1681` `setTimeout(reload, RELOAD_DEBOUNCE_MS)`（`:199` = 220） |
| **未进入** `reload` 的 `useCallback` 依赖 | `:1673` `}, [t])`（reload 定义块 `:1646-1673`） |
| 30 s 轮询与 focus 强刷保留 | `:1688` `setInterval(reload, TREE_REFRESH_MS)`（`:196` = 30_000）；`:1691` `window.addEventListener('focus', onFocus)` |
| hook 调用顺序恒定 | `sources.sessions/workspaces/status/pending` 四处订阅均**无条件**调用（`:1596-1605`）；`sourcesRef` 首渲染冻结（`:1585-1593`），hook 数量在整个组件生命周期恒定 |
| locale key 唯一 | `src/locales.ts:73` `'a11y.runningTask': '有任务正在运行',`（紧随 `:72` 的 `a11y.subagents`） |

### 4.5 构建产物确实带新字段（宿主半边）

```sh
grep -n "hasRunningTasks" lib/tree-model.d.ts   # :133（project）、:162（worktree）
grep -n "hasRunningTasks" lib/tree-model.js     # :1393（emitContainer）、:1731（project）、:1750（worktree）、:1795（未分组 false）
grep -n "runningSignature" lib/live-state.d.ts  # :118  export declare function runningSignature(status: unknown): string;
```

---

## 5. AC1–AC13 逐条判定

| AC | 判定 | 证据 |
|---|---|---|
| **AC1** worktree 主会话 running ⇒ 该 worktree `true`，兄弟 `false` | **通过** | A1（`:1705`）+ A4（`:1772`，A true / B false） |
| **AC2** 只有子代理在跑 ⇒ `hasRunningTasks === true` 且父会话行 `running === true`（同源）；`runningCount === 0` | **通过** | A2（`:1722`，同一条用例内同时断言三者）+ A3（`:1752`，depth 3 多层累加） |
| **AC3** project 任一 worktree true ⇒ true；全空闲 ⇒ false | **通过** | A4（`:1772`）、A5（`:1793`） |
| **AC4** 不聚合 history / flat / 未分组；history 行无该字段 | **通过** | A6（`:1812`，`'hasRunningTasks' in row === false`）、A7（`:1839`）、A8（`:1859`） |
| **AC5** 折叠 / 第 7 条被截断 / 视口外仍为 true | **通过（视口外为结构证据）** | A9（`:1867`，折叠且无子行）、A10（`:1885`，运行中会话排第 7 被截断且不在渲染行里）；「视口外」不可单测——数据在 `rows` 数组里，判定与渲染无关（`:1952`） |
| **AC6** 归档 / 非当前 blank 不计入；当前 blank 计入 | **通过** | A11（`:1906`）、A12（`:1926`）、A13（`:1945`） |
| **AC7** `runningCount` 零回归 | **通过** | 既有 `test/tree-model.test.mjs:1677` 通过且 0 删除行；A2 另断言 `runningCount === 0` 而 `hasRunningTasks === true` |
| **AC8** 只 project/worktree 着色，颜色与光晕逐字正确，无整行/点/徽章 | **结构通过，像素未验证** | C1（`:879`）、C2（`:898`）、C6（`:1005`）；实现 `src/sidebar.tsx:790,804,805`。真实颜色/光晕见 §8（未验证） |
| **AC9** `data-running` 仅高亮时出现；`title === t('a11y.runningTask')`；唯一新 key | **结构通过，DOM 未验证** | C3（`:911`）、C4（`:937`）、C5（`:975`）；`src/sidebar.tsx:882,795`；`src/locales.ts:73`；`test/locales.test.mjs:44` 遍历词典逐条比对兜底 |
| **AC10** 签名只在运行集合变化时变；经 220 ms 防抖触发重取；首拉/30 s/focus 保留 | **结构通过，时延未实测** | B1–B8（`:169-235`）、C8（`:1078`）、C10（`:1113`）；`src/sidebar.tsx:1681-1695`。「约 0.3–1 s」为设计推算，无运行期测量（§8） |
| **AC11** 签名对异常形状返回 `''` 不抛；**不**进 `reload` 依赖；hook 顺序不变 | **通过** | B5（`:200`）、B6（`:208`）、C9（`:1091`）；`src/sidebar.tsx:1673` vs `:1683`；四处订阅无条件调用 + `useRef` 冻结 |
| **AC12** 非目标不越界（轨道态 / 搜索态 / 三桶聚合 / 宿主与全局配置） | **代码审查通过** | `wide === false` 在 `src/sidebar.tsx:2137` **提前 return**（只渲染一个按钮，无行可高亮）；搜索模式只产会话行（`src/tree-model.ts:2273`）；`src/routes.ts` / `package.json` / `cordis.patch.yml` / `src/client.tsx` 零改动；A6–A8 已锁三桶 |
| **AC13** 人工视觉验收（重启 DSH Desktop 后 10 项） | **未验证（不可脚本化）** | §8 复核 403 / 无 CDP / 无 playwright；已给出 10 步人工清单 |

---

## 6. 变异判别力验证（M1–M7）

### 6.1 方法与隔离

```sh
TMPBASE=$(mktemp -d /tmp/t5-mutation-XXXXXXXX)      # => /tmp/t5-mutation-BScSxq6q
rsync -a --exclude '.git' --exclude 'node_modules' --exclude 'lib' \
  /Users/dev/Documents/Project/AnyWork/dsh-worktree-groups/ "$TMPBASE/"
ln -s /Users/dev/Documents/Project/AnyWork/dsh-worktree-groups/node_modules "$TMPBASE/node_modules"
cd "$TMPBASE" && npm run build                      # 退出码 0（lib 在副本内重新生成）
```

- 副本**包含全部当前未提交改动**（rsync 工作树，而非 `git archive`）。
- **基线先跑绿**（变异前的对照，排除环境噪声）：`tree-model 263/263`、`sidebar-wiring 24/24`、`live-state 18/18`，退出码全 0。
- 每个变异：改 `src` → （逻辑变异才 `npm run build`）→ 跑对应定向测试 → 用备份**恢复副本** → 下一个。
- 全部结束后：`diff -rq` 证明副本 `src/` 与 `test/` 与主仓库**逐字一致**，重建后三份定向测试再次全绿，随后
  `rm -rf /tmp/t5-mutation-BScSxq6q`（仅删除本任务创建的 mktemp 路径）+ 删除备份文件。**主仓库未被触碰。**

### 6.2 结果表（7/7 有结果，7/7 按设计变红）

| 变异 | 施加方式（临时副本内） | 需 build | 预期红 | **实际** | 失败测试（退出码 1） | tests / pass / fail |
|---|---|---|---|---|---|---|
| **M1** `data-running` 写死 | `...(runningHighlight ? { 'data-running': 'true' } : {})` → `'data-running': 'true',` | 否（AST） | C4 | **红 ✅** | `C4 行根 data-running 由 runningHighlight 条件驱动（不是写死）` | 24 / 23 / **1** |
| **M2** 删着色分支 | 删掉 lead span style 里的 `...(runningHighlight ? { color, filter } : {})` 展开 | 否（AST） | C1/C2 | **红 ✅** | `C1 lead span 的 color = state-business-primary`、`C2 lead span 的 filter = drop-shadow(0 0 2px …)` | 24 / 22 / **2** |
| **M3** 判据改 `row.runningCount > 0` | `:790` 的 `row.hasRunningTasks === true` → `row.runningCount > 0` | 否（AST） | C3 | **红 ✅** | `C3 判据 = row.kind === 'history' ? false : row.hasRunningTasks === true` | 24 / 23 / **1** |
| **M4** 删除签名依赖 | 防抖依赖去掉 `runningSignatureValue` | 否（AST） | C8 | **红 ✅** | `C8 220ms 防抖依赖含 runningSignature(sessionStatus) 派生值` | 24 / 23 / **1** |
| **M5** 签名加进 `reload` 依赖 | `}, [t])` → `}, [t, runningSignatureValue])` | 否（AST） | C9 | **红 ✅** | `C9 reload 的 useCallback 依赖不含派生签名值` | 24 / 23 / **1** |
| **M6** project 用 `allResults` | `:2357` `worktreeResults.some(...)` → `allResults.some((entry) => entry.hasRunningTasks === true)` | 是（exit 0） | A6/A7 | **红 ✅** | `A6 history 桶在跑 ⇒ history 行无该字段、project=false`、`A7 非 git 平铺会话在跑 ⇒ project=false` | 263 / 261 / **2** |
| **M7** worktree 只读 `session.running` | `:1952-1956` 移除 `\|\| subagentCountOf(...) > 0` | 是（exit 0） | A2 | **红 ✅** | `A2 只有子代理在跑 ⇒ worktree=true 且父会话行 running=true（同源）`、`A3 depth 3 子代理链在跑 ⇒ worktree=true` | 263 / 261 / **2** |

**说明**

- M3 按设计只改**渲染判据**（sidebar 侧），因此只有 C3 变红；设计 §9.2 D 表备注的「A2/A4（逻辑，若同时改 tree-model）」未触发，
  因为 tree-model 未改——属**预期**，不是漏检。M7 已单独覆盖「逻辑侧丢弃子代理」。
- M6/M7 因测试 `import ../lib/tree-model.js`，必须先 `npm run build`；两次构建均退出码 0，排除「构建失败导致的假红」。
- 每个变异的完整原始日志保留在 `/tmp/t5-M1.log … /tmp/t5-M7.log`（含 `ℹ tests/pass/fail` 与 `✖` 测试名）。

**判别力结论**：C1–C5、C8–C9 与 A2、A3、A6、A7 都是**活的**断言（对实现回退敏感），不是「只锁字面文本」的死断言。

---

## 7. 文档一致性

### 7.1 设计 §13 的 grep 清单（逐条执行）

| # | 检查 | 结果 |
|---|---|---|
| 1 | `grep -rn "hasRunningTasks" docs/ src/ test/ \| grep -v "2026-10-20-running-task-highlight" \| wc -l` | **53**（全部落在 `src/tree-model.ts`、`lib/*`、`docs/INTERFACES.md`、`docs/PRD.md`、三份测试；无第三处实现） |
| 2 | `grep -rn "hasRunning\b\|activeRow\|isRunningTask" src/ test/` | **零命中** ⇒ 无第二套字段名 |
| 3 | `grep -rn "a11y.runningTask" src/ docs/ test/` | `src/locales.ts:73`（定义）、`src/sidebar.tsx:795`（消费）、`docs/INTERFACES.md:359,362,999`、`test/sidebar-wiring.test.mjs`（C5）⇒ **唯一 key** |
| 4 | `grep -n "runningTask" src/locales.ts` | 仅 `:73` 一条 |
| 5 | `grep -rn "state-business-primary" src/sidebar.tsx` | 仅 `:804`（color）与 `:805`（filter）⇒ **唯一颜色 + 唯一光晕** |
| 6 | `grep -rn "runningSignature" src/ test/ docs/` | `src/live-state.ts`（实现 1 处）、`src/sidebar.tsx`（4 处消费）、`test/live-state.test.mjs`、`test/sidebar-wiring.test.mjs`、docs 多处说明 ⇒ **唯一刷新信号**，无第二套签名（如 `runningKey` / `statusSignature` 零命中） |
| 7 | `grep -n "口径刻意不变" docs/INTERFACES.md` | **`:1316-1317`** 原句仍在（T-3 插入内容导致行号从 1212 偏移到 1316，**文字未改**） |
| 8 | `grep -n "容器/项目行的 runningCount 口径" test/tree-model.test.mjs` | **`:1677`** 命中，且与 `HEAD` 逐字相同 |

**旧 Q1 三处原文均未改动**：

| 位置 | 现状 |
|---|---|
| `docs/INTERFACES.md:1316-1317` | 「⚠️ **`runningCount` 的口径刻意不变**（仍只数 `session.running`）：渲染层**无消费者**…」原样保留 |
| `test/tree-model.test.mjs:1677` | 测试名原样、用例体未动（该文件 0 删除行） |
| `src/tree-model.ts:2261-2262` | 「`runningCount` 的口径**不变**（仍只数 `session.running`）—— 渲染层无消费者，本次不动（用户裁决 Q1）」原样保留 |

### 7.2 契约 / 需求 / 设计 ↔ 实现 对齐

| 事实 | 契约 | 实现 | 一致 |
|---|---|---|---|
| 字段名 `hasRunningTasks: boolean`（project / worktree 必填） | `INTERFACES.md:399-406`（project）、`:433`（worktree） | `src/tree-model.ts:143`、`:173` | ✅ |
| worktree 判据 = 自身 running 或运行中子代理（截断前 heads） | `INTERFACES.md:422-433`、§2.2.1 `:921-941` | `src/tree-model.ts:1952-1956` | ✅ 逐字一致 |
| project 只聚合 worktree 桶；未分组恒 false；history 无字段 | `INTERFACES.md:399-406`、`:935` | `:2357`、`:2422`、`:2386-2393` | ✅ |
| 颜色 / 光晕逐字 | `INTERFACES.md:991-999`、`docs/design §5.2/§6` | `src/sidebar.tsx:804-805` | ✅ 字符串完全相同 |
| `data-running="true"` 仅高亮时出现 | `INTERFACES.md:1001-1002` | `src/sidebar.tsx:882` | ✅ |
| `t('a11y.runningTask')` = 有任务正在运行 | `INTERFACES.md:359-365`、`:999` | `src/locales.ts:73` + `src/sidebar.tsx:795` | ✅ |
| `runningSignature(status: unknown): string` 六条语义 | `INTERFACES.md:1056`、`:1086-1095` | `src/live-state.ts:191-208` | ✅ 六条逐条对应（含「绝不抛」） |
| 进 220 ms 防抖、**不进** `reload` 依赖、保留 30 s/focus | `INTERFACES.md:1005-1010` | `src/sidebar.tsx:1673,1683,1688,1691` | ✅ |
| AC 与用例 ID 映射（A1–A13 / B1–B8 / C1–C10） | `docs/design §9.2` | 三份测试文件 | ✅ 全部存在且通过（§3.3） |

**一处非阻塞观察**（不影响契约）：`docs/INTERFACES.md` §2.1 的词条表把 `a11y.runningTask` 追加在表末
（`state.loading` 之后），而 `src/locales.ts` 按设计放在 `a11y.subagents` 之后（`:72-73`）。该表是**键集合**清单，
顺序不构成契约；`test/locales.test.mjs:44` 只按 key 遍历比对文案，因此无功能影响。

---

## 8. 视觉验收：**未验证**（不可脚本化）+ 人工 10 步

### 8.1 T-2 §6 结论复核（本次只读实测）

| 检查 | 命令 | 结果 |
|---|---|---|
| GUI HTTP 可达性 | `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:43120/` | **403**（`forbidden`）⇒ 抓不到 DOM / 抓不到 `/tree` 运行时返回 |
| CDP 端口 | `ps -eo command= \| grep -i "DSH Desktop" \| grep -c "remote-debugging-port\|--inspect"` | **0**（主进程无调试端口参数）；`lsof -iTCP:9222 -sTCP:LISTEN` 无监听 |
| playwright / puppeteer | `command -v playwright puppeteer` | 均**未安装** |

**结论**：`test/render-smoke.test.mjs` 是 SSR、不执行 `useEffect`，渲染不出真实容器行，**不能**作为视觉证据。
因此 AC13（以及 AC8 的「真实像素/暗色可辨」、AC10 的「约 0.3–1 s 时延」）在本报告内**明确标注为未验证**。
本任务**未尝试绕过**该限制（未改宿主、未开调试端口、未装浏览器工具）。

### 8.2 可直接交用户的人工验收步骤（重启 DSH Desktop 后执行）

**前置（必须）**：`npm run build`（含 host 产物）→ **完全退出并重启 DSH Desktop**（宿主模块 HMR 关闭，不重启则
`hasRunningTasks` 不存在，高亮永不出现）→ 刷新侧栏页面。当前 HEAD 的 `lib/` 已由本任务构建过（`hasRunningTasks` 在
`lib/tree-model.js:1393`），但**进程内加载的仍是旧模块**，重启不可省。

1. **亮起**：在另一个 worktree 的会话里发一条会跑一会儿的指令 ⇒ 该 worktree 的 branch 图标应在**约 0.3–1 s** 内变为
   主题蓝并带轻微光晕（不是等 30 s）；对应 project 文件夹图标同步变蓝。
2. **熄灭**：回合结束 ⇒ 约 1 s 内两个图标恢复灰色。
3. **折叠态**：折叠该 worktree 后再触发一次运行 ⇒ **折叠行本身**仍高亮（子行不可见也不影响）。
4. **子代理聚合（最关键）**：派生一个子代理并让父回合先结束 ⇒ worktree **保持高亮**，同时父会话行的蓝点仍亮
   （两者同源，不应出现「一个亮一个不亮」）；结束时一起熄灭。
5. **project 只聚合 worktree**：在非 git 平铺会话 / 未分组会话里跑任务 ⇒ 对应 project 文件夹**不亮**；
   history 桶里有会话在跑 ⇒ clock 图标**不亮**。
6. **颜色语义**：高亮是蓝色（`state-business-primary`），与「选中行文字 / 悬停背景」可区分，不是近黑/近白。
7. **暗色主题**：切到 dark 重复第 1、6 步，图标在 `#1b1b1c` 底上应清晰（预期 `#7aaaff`）。
8. **不误伤**：拖拽插入线仍为独立的 2 px 视觉；hover / 选中不因 `filter` 发糊；`wide=false` 轨道态与搜索态无容器行。
9. **无回归**：侧栏不出现「侧栏渲染出错」，控制台无 `React error #130`（图标名缺失的典型症状）。
10. **压力**：同时开 3–4 个任务再全部结束 ⇒ 无请求风暴、无闪烁（可在 DevTools Network 观察 `/dsh-worktree-groups/tree`
    的节奏：突发应被 220 ms 合并，稳态约 2 次/分钟轮询）。

**判定口径**：1–10 全部符合 ⇒ AC13 通过；任一项不符 ⇒ 记录现象（含明/暗主题截图）回到父代理决定是否重开实现任务。

---

## 9. 未覆盖 / 风险 / 需要父代理决定

### 9.1 未覆盖（明确未执行，不算通过）

| 项 | 状态 | 原因 |
|---|---|---|
| AC13 视觉验收（亮起/熄灭/折叠/子代理/history/flat/未分组/暗色/无错误/压力） | **未执行** | GUI 403、无 CDP、无 playwright（§8.1）；且宿主字段需**重启**才生效 |
| AC8 的「真实像素 / 光晕观感 / 暗色对比度」 | **未执行** | 同上；仅有 AST 结构证据（C1/C2/C6） |
| AC10 的「约 0.3–1 s」实际时延 | **未测量** | 无法发真实回合并观测 Network；仅验证了接线与纯函数语义 |
| AC5 的「行在视口外」 | **仅结构证据** | 无浏览器无法滚动观测；数据在 `rows` 里、判定与渲染无关是代码事实 |
| 宿主 `useSessionStatus` 的覆盖范围 | **未复测** | 属 T-2 实现事实（R2 风险已记录）；本任务未重新探测宿主内部 |

### 9.2 风险与限制

1. **无法按任务隔离 git diff**：工作区累积多轮未提交改动，范围核对改用「文件集合 + 新增/删除行统计 + 关键字唯一性」
   三层证据（§2.2）。若后续需要严格归因，必须在任务前提交或建 patch。
2. **`src/sidebar.tsx` 的 142 行删除属早期任务**（2026-10-19 图标重构、live-state 抽取）；本报告已逐条核对
   高亮相关行（§4.3），但**不能**从 git 层面证明这些删除与 T-4 无关。该结论依赖 T-4 工作记录 + 代码内容比对。
3. **变异只在副本内施加**：判别力证明的是「测试能抓住这类回退」，不等于「真实运行期不会出错」
   （设计 R8：`data-running` 只是可断言钩子）。
4. **报告未新增 `docs/README.md` 索引条目**：本任务的独占写入范围只含本文件与检查点，索引更新在范围外（见 §9.3）。

### 9.3 需要父代理决定

1. **`docs/README.md` 索引**：AGENTS.md §5 要求新文档可从总入口导航。本任务无权改 `docs/README.md`
   （写入范围限定为 `docs/testing/…`）。请指派 T-6 或文档任务补一行「验证报告」索引。
2. **`docs/testing/` 是新目录**：此前仓库没有 `tests/` 报告目录（历史验证报告散在 `docs/REVIEW-*.md`）。
   如希望统一到既有 `docs/reviews/` 或 `docs/REVIEW-*.md` 命名，可后续迁移；本次按任务指定的
   `docs/testing/2026-10-20-running-task-highlight-verification.md` 落盘。
3. **AC13 视觉验收的排期**：需要 T-6 安排「重启 DSH Desktop + 人工 10 步」。**在此之前，本需求的视觉项应视为未交付完成**，
   不能以「测试全绿」替代。
4. **是否需要补 AC10 的时延实测**：若父代理要求量化「0.3–1 s」，需要一次可观测的真实回合（人工计时或 DevTools
   Network 截图），自动化手段在当前宿主上不可得。

---

## 10. 附录：命令与证据

### 10.1 本任务实际执行的命令（均在主仓库，除变异外全部只读源码）

```sh
# 范围
git status --porcelain=v1
git diff --stat
git diff --name-only
git diff --numstat src/tree-model.ts src/locales.ts src/sidebar.tsx test/tree-model.test.mjs test/sidebar-wiring.test.mjs docs/INTERFACES.md
git show HEAD:test/tree-model.test.mjs | sed -n '1677p'   # 与工作区逐字比对

# 新鲜复跑（写 lib/，属验证的一部分）
npm run typecheck      # exit 0
npm run build          # exit 0
npm test               # exit 0，tests 456 / pass 456 / fail 0 / cancelled 0
node --test test/tree-model.test.mjs       # exit 0，263/263
node --test test/live-state.test.mjs       # exit 0，18/18
node --test test/sidebar-wiring.test.mjs   # exit 0，24/24

# 源码事实（只读）
grep -n "hasRunningTasks\|subagentCountOf\|runningCount: heads" src/tree-model.ts
grep -n "runningHighlight\|data-running\|state-business-primary\|runningSignature\|RELOAD_DEBOUNCE_MS\|TREE_REFRESH_MS\|a11y.runningTask" src/sidebar.tsx
grep -n "a11y.runningTask" src/locales.ts
grep -n "export function runningSignature" src/live-state.ts
grep -n "hasRunningTasks" lib/tree-model.d.ts lib/tree-model.js

# 文档一致性（设计 §13）
grep -rn "hasRunningTasks" docs/ src/ test/ | grep -v "2026-10-20-running-task-highlight" | wc -l   # 53
grep -rn "hasRunning\b\|activeRow\|isRunningTask" src/ test/        # 零命中
grep -rn "a11y.runningTask" src/ docs/ test/
grep -rn "state-business-primary" src/sidebar.tsx                    # :804 / :805
grep -rn "runningSignature" src/ test/ docs/
grep -n "口径刻意不变" docs/INTERFACES.md                             # :1316
grep -n "容器/项目行的 runningCount 口径" test/tree-model.test.mjs      # :1677

# 视觉限制复核（只读，未绕过）
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:43120/        # 403
ps -eo command= | grep -i "DSH Desktop" | grep -c "remote-debugging-port\|--inspect"   # 0
command -v playwright puppeteer                                       # 未安装
```

### 10.2 变异日志（保留在 `/tmp`，可复核）

`/tmp/t5-M1.log`、`/tmp/t5-M2.log`、`/tmp/t5-M3.log`、`/tmp/t5-M4.log`、`/tmp/t5-M5.log`、
`/tmp/t5-M6.log`（+ `/tmp/t5-M6-build.log`）、`/tmp/t5-M7.log`（+ `/tmp/t5-M7-build.log`）、
全量复跑日志 `/tmp/t5-full-verify.log`。

### 10.3 残留状态

- **临时副本**：`/tmp/t5-mutation-BScSxq6q` 已**删除**（`rm -rf` 前用 `diff -rq` 确认恢复一致、重建后三份定向测试全绿）；
  主仓库 `src/`、`test/` 与副本逐字一致。
- **主仓库业务文件**：零修改（验证前后 `git status` 逐字一致）。
- **构建产物**：`lib/` 由本次 `npm run build` 重新生成（验证的一部分，`gitignore` 覆盖）。
- **新增文件**：本报告 + `docs/testing/` 目录；检查点 `progress/T-5.md` 追加 3 行。

### 10.4 耗时与尝试

- 约 **10 分钟**（13:22 启动 → 13:32 完成报告）：范围核对与全量复跑约 4 分钟（含 `npm test` 14.5 s）、
  源码事实核对约 1.5 分钟、M1–M7 约 2.5 分钟、文档一致性与视觉限制复核约 1 分钟、报告撰写与行号校正约 1 分钟。
- **无返工**：M1–M7 每个变异一次施加即按设计变红；无构建失败、无超时、无阻塞。

---

## 11. 追加需求（flat 聚合）验证（2026-10-20）

> 任务：**T-9 独立验证**（只读主仓库）。目标：确认 T-8 的追加需求「project 聚合该 workspace 的
> flat/普通会话；worktree 行不变；history/未分组排除」真实落地，且 flat 会话**没有**被错误计入
> `sessionCount` / 渲染。**本节之前的正文未改**（仅追加本节）。

### 11.1 范围核对（T-8 只动该动的文件）

验证开始时（`git status --porcelain` / `git diff --stat`，工作区含 T-1～T-8 全部未提交改动）：

- 已跟踪改动 13 个文件、`+1458 / −152`；T-8 相关增量与 T-7 审查记录（`docs/reviews/…review.md`
  §「功能源码未变」）逐项对比：

| 文件 | T-7 审查记录 | 本次实测 | 判定 |
|---|---|---|---|
| `src/tree-model.ts` | `49 / 0` | `76 / 0` | T-8 增量 +27（flat 容器 + 判定），符合 |
| `test/tree-model.test.mjs` | `269 / 0` | `308 / 0` | T-8 增量 +39（A7 反转 + A15），符合 |
| `src/sidebar.tsx` | `128 / 142` | `128 / 142` | **未变** |
| `src/locales.ts` | `5 / 2` | `5 / 2` | **未变** |
| `test/sidebar-wiring.test.mjs` | `565 / 0` | `565 / 0` | **未变** |
| `test/locales.test.mjs` | `30 / 0` | `30 / 0` | **未变** |

- `src/live-state.ts`、`test/live-state.test.mjs`、`test/icons.test.mjs`、`test/render-smoke.test.mjs`
  均为未跟踪文件；mtime 仍为 `13:11:33 / 13:11:13 / …`，早于 T-8 窗口（14:23–14:29）。
- T-8 声称的 4 份文档 + worklog 的 mtime 均落在 T-8 窗口内：
  `docs/PRD.md 14:26:58`、`docs/INTERFACES.md 14:27:25`、
  `docs/design/2026-10-20-running-task-highlight.md 14:28:49`、
  `docs/worklog/2026-10-20-running-task-highlight.md 14:28:49`、
  `docs/requirements/2026-10-20-running-task-highlight.md 14:29:36`。
- 结论：**未发现 T-8 越界改 `sidebar.tsx` / `live-state.ts` / `locales.ts` / 其他测试**；
  `src/tree-model.ts 14:24:57`、`test/tree-model.test.mjs 14:24:28` 是 T-8 唯一源码/测试改动（mtime + numstat 双证）。

### 11.2 新鲜复跑（本任务独立执行，非复用 T-8 自报）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npm run typecheck` | 0 | 无类型错误（`/tmp/t9-typecheck.log`） |
| `npm test`（内含 `npm run build`） | 0 | `tests 462 / pass 462 / fail 0 / cancelled 0 / skipped 0`，`duration_ms 14463.5`（`/tmp/t9-full-test.log`） |
| `node --test test/tree-model.test.mjs` | 0 | `tests 264 / pass 264 / fail 0`（`/tmp/t9-tree-test.log`） |

定向用例逐条状态（同一日志，均 `✔`）：`运行中高亮/A1`、`A2`、`A4`、`A6`、`A7`、`A8`、`A15`，
以及旧回归锁 `需求 A: 容器/项目行的 runningCount 口径**不变**（用户裁决 Q1）`（`test/tree-model.test.mjs:1677`）。
A3/A5/A9–A13 亦全绿（无放宽、无删除）。

### 11.3 A7 / A15 语义核查（源码 : 行号）

**A7（非 git、无 worktree、flat running ⇒ project=true 且无 worktree 行）**
`test/tree-model.test.mjs:1840-1867` 构造 `isGit:false、worktrees:[]、flatSessions:[running]`，
断言 `worktreeCount===0`、无 worktree 行、`hasRunningTasks===true`。
源码路径：`containersOfProject` 对非 git 建 `containers.flat`（`src/tree-model.ts:1707`、`:1740-1747`）
⇒ `flatResult = emitContainer(containers.flat)`（`:2332`）⇒ project 判定 `:2375-2377` 取到 `true`；
`rendersFlat = containers.flat !== undefined`（`:2333`）⇒ flat 行照旧追加（`:2402`）。**符合**。

**A15（git、有 worktree 且空闲、flat running ⇒ project=true、worktree=false）**
`test/tree-model.test.mjs:1869-1896` 构造 git 项目 + 1 个空闲 worktree + `flatSessions:[running]`；
断言 worktree 行 `false`、project 行 `true`。源码路径：`containers.flat === undefined`（git）
⇒ 用 `project.flatSessions` 合成**仅供判定**的等价容器（`:2325-2331`）⇒ `flatResult` 为 true
⇒ project `true`；worktree 行仍只读 `entry.result.hasRunningTasks`（`:2396`，判定写在
`emitContainer` `:1955`，本次未改）⇒ `false`。**符合**。

**history / 未分组 / runningCount**
- A6（`test:1813`）：history 在跑 ⇒ history 行**无该字段**且 project `false`。源码：
  history 结果未进入 project 判定（判定只读 worktreeResults 与 flatResult），history 行不设字段
  （`src/tree-model.ts:2405-2419`）。**符合**。
- A8（`test:1898`）：未分组在跑 ⇒ 未分组 project 行 `false`，源码显式常量 `false`
  （`src/tree-model.ts:2437-2444`，`:2443`）。**符合**。
- Q1：`sessionCount / runningCount / pendingCount` 仍由 `allResults` 求和（`:2370-2372`），
  `runningCount` 未改为 `hasRunningTasks` 的别名；Q1 用例通过。**符合**。

### 11.4 计数回归（重点）：行为正确，但**测试有缺口**

**行为实测**（`/tmp/t9-count-check.mjs`，直接 import 新鲜 `lib/tree-model.js`，只读）：

- A15 同形输入（git 1 worktree 空闲 + `flatSessions` 2 条，其中 1 条 running）：
  `project.sessionCount = 1`、`runningCount = 0`、`pendingCount = 0`、`hasRunningTasks = true`；
  行序列仅 `project / worktree / session(idle)`，**flat 会话零渲染**。⇒ `rendersFlat` 只对非 git
  生效、`allResults` 未把 git flat 计入，**行为无回归**。
- 非 git 同形输入（flat running + history running + ungrouped running）：
  `sessionCount = 2`（flat 1 + history 1）、`hasRunningTasks = true`；history 行无字段；
  未分组行 `hasRunningTasks = false`。与既有口径一致。

**缺口（明确报告，未自行补测试）**：A15 **只断言** `project.hasRunningTasks` 与
`worktree.hasRunningTasks`，**未断言** `project.sessionCount / runningCount / pendingCount`；
既有计数用例（`test/tree-model.test.mjs:2221`）的 git 项目 `flatSessions` 为空。因此若把
git 的 flat 结果并入计数，**没有任何测试会变红**——见 §11.5 M-FLAT-2b（全量 462/462 全绿，
而实测 `sessionCount` 由 1 变 3、`runningCount` 由 0 变 1）。设计 §9.2 A15 的断言列同样只写
「project true；worktree false」，与测试一致地缺少计数断言。**建议后续任务补一条
「git 项目 flatSessions 非空时 project 计数只含 worktree」的回归**（本轮角色只读，未添加）。

### 11.5 变异验证（`/tmp/t9-mut` 临时副本；主仓库 `src/`、`test/` 零编辑）

副本由 `rsync`（排除 `.git`/`node_modules`）+ 软链 `node_modules` 生成；基线重建后
`node --test test/tree-model.test.mjs` = 264/264。

| 变异 | 施加方式 | 构建 | 定向 | 全量 | 结论 |
|---|---|---|---|---|---|
| **M-FLAT-1** | 删除 project 表达式中的 `\|\| flatResult.hasRunningTasks === true`（`src/tree-model.ts:2375-2377`） | exit 0 | 264 tests / **262 pass / 2 fail**：仅 A7、A15 | 462 tests / **460 pass / 2 fail**：仅 A7、A15 | **按预期红，无连带误红** |
| **M-FLAT-2a** | `rendersFlat = true`（git flat 强行进 allResults + 渲染） | exit 0 | 264 tests / **263 pass / 1 fail**：`实体门控: git 项目且 worktrees 为空（扫描降级）⇒ …不吞 flatSessions` | 未执行（已由定向判明） | 渲染侧有守护，但**计数差值**未被该用例断言 |
| **M-FLAT-2b** | 仅把 `allResults` 的 `...(rendersFlat ? [flatResult] : [])` 改为 `flatResult`（只污染计数、不渲染） | exit 0 | 264 / **264 pass / 0 fail** | 462 / **462 pass / 0 fail** | **缺口确认**：`sessionCount 1→3`、`runningCount 0→1` 无测试捕捉 |

副本处理：恢复 `src/tree-model.ts` 后 `diff -q` 与主仓库逐字一致，重建 + 定向 264/264 全绿，
随后 `rm -rf /tmp/t9-mut`（已确认不存在）。变异日志：`/tmp/t9-MFLAT1.log`、`/tmp/t9-MFLAT1-full.log`、
`/tmp/t9-MFLAT2-tree.log`、`/tmp/t9-MFLAT2b.log`、`/tmp/t9-MFLAT2b-full.log`。

### 11.6 文档一致性

现行 4 份契约/需求文档已同步为「worktree **OR** 本 workspace flat；history/未分组排除」，
**未发现残留的现行反向表述**：

- requirements：`:6`（状态）、`:58`（RT2）、`:78-95`（§2.2 追加裁决，含用户原话）、
  `:108-109`（AC3/AC4）、`:117-118`（AC12/AC13）、`:124-125`（非目标）——与实现一致。
- design：`:121-138`（§3.3 判定 + `flatResult` 归属 + `rendersFlat` 说明）、`:185`（§4 边界表 A15 行）、
  `:401`（§9.1 S17）、`:436`（§9.2 A15）、`:527-530`（§10.2 T-8 文件清单）、`:553`（§11 第 5 步人工项）、
  §13 同一事实表「project = worktree 桶 ∪ 本 workspace flat」——一致。
- PRD：`:691`（T-8 已落地）、`:701`（RT2 改写）、`:706`（RT7）、`:725`（非目标）——一致。
- INTERFACES：`:397-407`（§2.2 JSDoc）、`:922-952`（§2.2.1 判定表 / `flatResult` 归属 /
  「不渲染、不计入 `sessionCount`」）、`:962-963`（边界表）、`:1004`（渲染判据）、
  `:1016`（非目标）、`:1375`（宿主归属不变）——一致。
- 历史/边缘残留（**非 T-8 四文档，未要求改**）：`docs/research/2026-10-20-host-capability-verification.md:349`
  与 `:417` 仍写「文件夹只聚合 worktree 子项」，且无「已被 T-8 覆盖」标注；worklog `:54` 的 RT2 行是
  当时决策的历史记录（同文件 T-8 节已声明覆盖），可接受。research 属历史调研快照，但**读者可能误读为现行**，
  建议后续在文首加覆盖说明。
- PRD `:102`/`:503`/`:567-568` 的「flat 容器只留给非 git 工作区」是**渲染/归属**事实，与实现一致
  （git 的等价 flat 容器仅供判定、不渲染），不构成矛盾。

### 11.7 未覆盖 / 风险

1. **计数测试缺口（P2）**：见 §11.4；M-FLAT-2b 全绿。行为当前正确（实测 1 而非 3），但无回归锁。
2. **视觉仍未验证**：本任务未重启 DSH Desktop、未截图/抓 DOM。`curl http://127.0.0.1:43120/` ⇒ `403`；
   无 playwright/puppeteer；「无 worktree 的 workspace 文件夹亮」「worktree 空闲但 flat 在跑时亮」
   （设计 §11 第 5 步）仍需人工确认（AC13）。
3. **A15 是契约形状守卫**：真实宿主数据里 git 项目 `flatSessions` 恒为空
   （`src/projects.ts:289` 归属规则 2b、`:423-431`），A15 不代表真实数据会出现该组合。
4. **键复用（低风险）**：git 的合成 flat 容器复用 `containers.projectKey`（`src/tree-model.ts:2326`），
   当前 `emitContainer` 是纯函数、按 spec 计算，无按键缓存/副作用，故无碰撞；若未来给
   `emitContainer` 加按键索引/缓存，需重新评估。
5. **`rendersFlat` 同时门控渲染与计数**：语义正确但属隐式耦合，已由 design §3.3 与 INTERFACES §2.2.1
   显式记录；后续重构需保持「git flat 只判定、不计不渲」。

### 11.8 结论与残留

- **结论**：T-8 追加需求**真实落地**——A7/A15 均绿；worktree 行判定未变；history/未分组仍排除；
  git 项目的 flat 会话**没有**被计入 `sessionCount/runningCount`，也没有被渲染（实测 1 条 worktree 会话，
  flat 的 2 条被排除）；`runningCount` Q1 口径未动。**唯一实质发现是测试缺口**：A15 未锁计数，
  计数回归变异在全量套件下仍 462/462 绿（需后续补测，不在本任务权限内）。
- **范围**：主仓库业务文件零修改（验证前后 `git status --porcelain` 与 `git diff --stat` 一致：
  13 files / +1458 / −152）；只追加本节 + 检查点 `progress/T-9.md`。
- **残留**：`/tmp/t9-*` 仅日志与一次性脚本，无副本目录；`lib/` 由本次 `npm test` 重新生成（gitignore）。
- **耗时/尝试**：约 15 分钟（14:30→14:45），无返工、无超时、无阻塞；M-FLAT-1 一次即红，
  M-FLAT-2 因首次只测渲染侧、补测「仅计数」变体一次，均在 3 次上限内。

---

## 12. T-11 补锁与更正（2026-10-20）

- **任务**：T-11（补测 + 文档更正；**不改功能源码**）
- **输入**：T-10 审查 [§17](../reviews/2026-10-20-running-task-highlight-review.md)（F17-1/F17-2/F17-3/F17-5、§17.8 生效路径更正）、本报告 §11
- **范围**：`test/tree-model.test.mjs` 的 A15 **只追加** 4 条断言（不改既有断言、不删用例）；`src/` 零改动；另有文档更正
- **本节只追加**：**不修改** §1–§11 正文（T-5 / T-9 为历史记录），对 §8.2 / §11.1 / §11.4 的更正集中写在这里

### 12.1 F17-1 关闭：A15 补锁计数与不渲染

在 A15（`test/tree-model.test.mjs:1869-1908`）**既有断言之后追加** 4 条：

| 新断言 | 期望 | 锁的契约 |
|---|---|---|
| `projectRow.sessionCount` | `1` | design §3.3 / §4：git flat **不计入**计数（只数 worktree 的 1 条） |
| `projectRow.runningCount` | `0` | Q1 口径不变（flat 的 running 不进 `runningCount`） |
| `projectRow.pendingCount` | `0` | 同上 |
| `rows` 中是否存在 `kind === 'session' && sessionId === 'f-flat'` | `false` | git flat **零渲染** |

**绿色证据**：`node --test test/tree-model.test.mjs` ⇒ `tests 264 / pass 264 / fail 0`
（**test count 不变**：只增强既有 A15 的断言，没有新增用例）。

### 12.2 M13 变异：新断言有判别力（F17-1 的「变异全绿」已堵住）

`/tmp` 副本（`rsync` 排除 `.git`/`node_modules`/`lib` + 软链 `node_modules`），把 `src/tree-model.ts` 的
`...(rendersFlat ? [flatResult] : [])` 改为 `flatResult`（**只污染计数、不改渲染门控**），
`npm run build` exit 0 后：

| 项 | 干净 lib | M13 变异 lib |
|---|---|---|
| `project.sessionCount` | `1` | **`2`** |
| `project.runningCount` | `0` | **`1`** |
| `project.pendingCount` | `0` | `0` |
| flat 会话是否渲染 | `false` | `false`（渲染门控未动） |
| `node --test test/tree-model.test.mjs` | 264/264 | **263/264，fail 1**（唯一红：A15 的 `sessionCount` `2 ≠ 1`） |

计数差异由 `/tmp/t11-m13-probe.mjs`（只读 import 两份 `lib/tree-model.js`、同一 A15 形状）直接输出；
临时副本与脚本均已清理。**结论**：§11.4 / T-10 F17-1 的缺口（行为正确但无回归锁）**已关闭**。

### 12.3 更正 §11.1：`src/tree-model.ts` 是 `73/3`，不是 `76/0`

T-11 复核 `git diff --numstat src/tree-model.ts` = **`73 3`**（T-8 实际增量 **+24 / −3**；3 行删除正是
`flatResult` 三处替换），与 T-10 F17-3 独立一致 ⇒ §11.1 表的 `76 / 0` 是**误报**。此更正**不改** §11.1 正文
（T-9 为历史记录），仅在此登记。`test/tree-model.test.mjs` 在 T-11 追加断言后为 **`320/0`**（原 `308/0`，+12 行全是断言与注释）。

### 12.4 更正 §8.2：本需求**不需要**「完全退出并重启 DSH Desktop」

§8.2 的前提「`npm run build`（含 host 产物）→ 完全退出并重启 DSH Desktop」**不成立**
（依据 T-10 §17.8 的源码事实）：

- `POST /dsh-worktree-groups/tree` 只返回**原始** `{ok, projects, ungrouped, archivedSessionIds, workspaceByPath}`
  （`src/routes.ts:820-825`、`:898-903`、`:1386-1393`），**不含** `hasRunningTasks` / `rows` ⇒ 宿主不算判定；
- `buildRows` 的唯一调用点是 `src/sidebar.tsx:2887`，只经 `src/client.tsx` 打进 `lib/client.js`；
  `src/index.ts` / `src/routes.ts` **从不 import** `tree-model.ts`；
- ⇒ flat 聚合与高亮都属**客户端逻辑**：`npm run build`（或 `build:client`）重建 `lib/client.js` → **刷新页面**即生效。
- 「必须重启」只在**首次安装 / 新增 bundle**（PRD :668）与**改宿主代码**（`src/index.ts` / `routes.ts` / `projects.ts`）时成立。

**最小人工步骤（以本节为准）**：`npm run build`（或 `npm run build:client`）→ **普通刷新页面**
（无效再硬刷新）→ 按设计 [§11](../design/2026-10-20-running-task-highlight.md) 逐项确认 → 仍无效再重启兜底。
§8.2 的 10 条**观察项**仍然有效，但第 5 条口径须按 RT7 读：**任意 workspace 的 flat/普通会话在跑 ⇒ project 亮**，
history 桶与未分组仍不亮（原文「非 git 平铺 / 未分组 ⇒ 不亮」已被 T-8 覆盖）。

### 12.5 文档更正清单（T-11）

| 文档 | 更正内容 |
|---|---|
| `docs/design/2026-10-20-running-task-highlight.md` | §1 F10（生效路径）、§4 新增 F17-5 边界行（known）、§9.2 A15 断言列、§9 D 表新增 M13、§10.1 「host 字段」措辞、§11 标题+前提、§12 R1、§13 同一事实表 |
| `docs/PRD.md` | §12 状态（新增 T-11 行）、§12.4 第 1 条（改为 client bundle + 刷新）、RT7 补「project 级形状守卫」一句 |
| `docs/requirements/2026-10-20-running-task-highlight.md` | AC13、§5 运行时事实（生效路径）、§2.2 新增第 5 条（非 git 时 `project == workspace`） |
| `docs/INTERFACES.md` | §2.2.1 `flatResult` 归属补「非 git 时 `project == workspace`；git 为 project 级形状守卫」 |
| `docs/research/2026-10-20-host-capability-verification.md` | 文首加**历史快照**声明；§8 第 5 步 / §11 第 2 条加「已被 T-8 / RT7 覆盖」（正文结论不改） |
| `docs/testing/2026-10-20-running-task-highlight-verification.md` | 本节（§12）；§8.2 / §11.1 / §11.4 的更正集中在此 |
| `docs/worklog/2026-10-20-running-task-highlight.md` | 追加 T-11 节（决策、证据、残留） |

**保留不动**：PRD :539（「客户端 JS 迭代只需刷页」）与 :668（「加新 bundle 必须重启」）**本来就正确**，未改；
`docs/reviews/` 正文未改（T-10 复核会追加）。

### 12.6 未验证 / 残留

- **视觉仍未验证**（AC13）：本任务未刷新页面、未截图、未抓 DOM、未重启 DSH；「worktree 空闲但 flat 在跑时文件夹亮」
  与「无 worktree 的 workspace 亮」仍需人工按设计 §11 第 5 步确认（建议同时挑一个**非 git 工作区**和一个 **git 工作区**）。
- `src/` 与功能测试逻辑零改动；未提交、未切分支、未清理工作区；`lib/` 由 `npm test` 重新生成（gitignore）。
