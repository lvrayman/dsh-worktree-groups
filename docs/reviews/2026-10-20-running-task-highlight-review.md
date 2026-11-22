# 审查报告：运行中任务的文件夹 / worktree 图标高亮（T-6 独立审查）

- **文档类型**：审查报告（独立、只读；非作者自测）
- **日期**：2026-10-20
- **任务**：T-6（审查 T-4 实现 + T-5 验证；**只出报告，不修代码**）
- **被审对象**：
  - 实现：`src/tree-model.ts`、`src/live-state.ts`、`src/sidebar.tsx`、`src/locales.ts`
  - 测试：`test/tree-model.test.mjs`、`test/live-state.test.mjs`、`test/sidebar-wiring.test.mjs`
  - 前置文档：[需求 AC1–AC13](../requirements/2026-10-20-running-task-highlight.md)、[设计 §3–§11](../design/2026-10-20-running-task-highlight.md)、[INTERFACES §2.1/§2.2/§2.2.1/§2.3/§2.3.2](../INTERFACES.md)、[T-5 验证报告](../testing/2026-10-20-running-task-highlight-verification.md)、[T-2 宿主核实](../research/2026-10-20-host-capability-verification.md)
- **审查结论**：**有条件通过**
  - 无 **P0**、无 **P1**；**P2 × 7**、**nit × 6**（其中 4 个 P2 是**可复现的测试判别力缺口**，不是当前功能缺陷）
  - 条件见 §11：① AC13 视觉人工验收未做，视觉项不得视为交付；② 建议补 4 条测试锁（F1–F4）把「测试全绿」重新变成可信信号；③ 文档索引与 PRD 状态需同步
- **唯一写入**：本文件 + 检查点 `~/.local/state/ai-work-dispatcher/runs/2026-10-20-running-highlight/progress/T-6.md`
- **视觉 / 真实像素 / 端到端时延**：**未验证**（见 §12）

---

## 1. 结论摘要

| 维度 | 结论 | 依据 |
|---|---|---|
| 需求覆盖 AC1–AC12（自动可验证部分） | **通过** | §3 矩阵；A1–A13 / B1–B8 / C1–C10 我均实跑通过 |
| AC13（视觉 / 重启后人工 10 步） | **未验证** | §12；GUI 403 / 无 CDP / 无 playwright（T-2 §6，T-5 §8.1 复核） |
| 数据口径（含子代理 / 只聚合 worktree / history 无字段 / 未分组显式 false） | **未发现缺陷** | §4「无问题项」、§10 反例表 |
| 旧 Q1 回归锁（`runningCount` 口径不变） | **未发现缺陷** | `test/tree-model.test.mjs:1677` 原样；`git diff --numstat` = `269 0`（纯新增） |
| 刷新链路（签名 / 防抖 / 不重置 30 s / 宿主形状） | **未发现缺陷**（形状假设为宿实现事实，已抽验） | §4.4、§5.2 |
| 测试有效性 | **有 4 处可复现缺口**（F1–F4）+ 1 处低影响缺口（F5） | §4 P2、§7 |
| 文档与工程一致性 | **2 处 P2 + 2 处 nit**（索引缺失、PRD 状态过期、注释漂移、工作记录 T-6 范围漂移） | §9 |
| 越界改动 / 未提交改动被覆盖 | **未发现** | `git status` 25 项审查前后一致；无删除行落在旧裁决上 |

**一句话**：实现本身在我的独立复跑与反例推演中**没有发现功能性缺陷**；问题集中在「测试锁不住 4 类真实回退」与「文档索引/状态未收尾」，加上 T-5 已声明的视觉未验证。

---

## 2. 审查方法、只读保证与未执行项

### 2.1 我实际执行的检查（全部只读）

```sh
cd /Users/dev/Documents/Project/AnyWork/dsh-worktree-groups

# 1) 独立复跑（不 build；直接对现有 lib/ 跑，lib/ 已由 T-5 构建）
npm run typecheck                          # exit 0（tsc --noEmit，不写文件）
node --test                                # tests 456 / pass 456 / fail 0
node --test test/tree-model.test.mjs test/live-state.test.mjs test/sidebar-wiring.test.mjs
                                           # tests 305 / pass 305 / fail 0

# 2) 改动归属与「纯新增」核对
git diff --numstat src/ test/ docs/INTERFACES.md docs/PRD.md docs/README.md
# src/tree-model.ts 49/0 · src/locales.ts 2/0 · src/sidebar.tsx 128/142
# test/tree-model.test.mjs 269/0 · test/sidebar-wiring.test.mjs 342/0
# docs/INTERFACES.md 180/1 · docs/PRD.md 50/0 · docs/README.md 15/1

# 3) 单一事实源（设计 §13 清单抽查）
grep -rn "hasRunningTasks" docs/ src/ test/ | grep -v "2026-10-20-running-task-highlight" | wc -l   # 53
grep -rn "hasRunning\b\|activeRow\|isRunningTask" src/ test/                                     # 零命中
grep -n "runningCount" src/sidebar.tsx                                                            # 零命中（Q1 前提仍成立）

# 4) 构建产物新鲜度（未重建，用 mtime + 关键字代替）
stat -f '%Sm %N' src/tree-model.ts src/sidebar.tsx lib/tree-model.js lib/client.js
# src 最大 mtime 13:12 < lib 13:22 ⇒ 产物不早于源码
grep -c hasRunningTasks lib/tree-model.js        # 5
grep -c data-running lib/client.js               # 1
grep -c runningSignature lib/client.js           # 3

# 5) 宿主形状抽验（只读宿主 checkout，不重启、不改配置）
sed -n '976,992p'  …/dsh-client-ui-session/lib/client.js        # publishStatus 组装真 Map
sed -n '1119,1128p' …/dsh-client-ui-session/lib/client.js       # sameSessionStatus 内容去重
sed -n '4146,4205p' …/dsh-api-session-controller/lib/client.js  # byId 补 subagent（origin:'subagent'）
```

### 2.2 变异实验（在 `/tmp` 副本内做，主仓库零触碰）

```sh
TMP=$(mktemp -d /tmp/t6-mut-XXXXXXXX)
rsync -a --exclude '.git' --exclude 'node_modules' --exclude 'lib' ./ "$TMP/"
ln -s "$PWD/node_modules" "$TMP/node_modules"
cd "$TMP" && node --test test/sidebar-wiring.test.mjs     # 基线 24/24 绿
# 每个变异：改副本 src → 跑定向测试 → 恢复 → 下一个；全部结束后 rm -rf 副本
```

结果见 §4（F1–F5）与 §7。**所有副本目录已删除**；主仓库 `src/`、`test/`、`lib/` 均未被写入。

### 2.3 明确未执行（不算通过）

| 未执行项 | 原因 |
|---|---|
| `npm run build` / `npm test`（含 build） | 会写 `lib/`，属本任务**禁止修改**范围；改用「mtime + 关键字 + 现有产物上跑测试」替代，产物新鲜度见 §2.1 第 4 条 |
| 重启 DSH Desktop / 打开真实 GUI | 任务明令禁止重启；且 GUI 不可脚本化（T-2 §6） |
| AC13 全部视觉项、AC10 端到端时延 | 同上；本报告**不**声称任何像素级结论 |
| 宿主 `useSessionStatus` 的运行期实测（抓 Map 内容 / 通知次数） | 403 + 无 CDP；只做了源码抽验（§2.1 第 5 条） |

---

## 3. 需求覆盖矩阵（AC1–AC13）

> 「证据」列的行号是我在**当前磁盘源码**上取的行号（与 T-5 报告一致或已校正）。

| AC | 判定 | 证据（文件:行号） | 备注 |
|---|---|---|---|
| **AC1** worktree 主会话在跑 ⇒ 该 worktree `true`，其它 `false` | **通过** | `test/tree-model.test.mjs:1705`（A1）、`:1772`（A4：A=true / B=false）；判定 `src/tree-model.ts:1952-1956` | 单 worktree 的 project 亦覆盖（A1） |
| **AC2** 只有子代理在跑 ⇒ `true`；父会话行 `running===true`（同源） | **通过** | `test/tree-model.test.mjs:1722`（A2，同一用例同时断言 worktree / 父行 / `runningCount`）、`:1752`（A3，depth 3）；同源 = 同一 helper `src/tree-model.ts:1406` 被 `:1496`（会话行）与 `:1952-1956`（容器行）共用 | 结构性同源，非注释承诺 |
| **AC3** project 任一 worktree `true` ⇒ `true`；全空闲 ⇒ `false` | **通过** | A4 `:1772`、A5 `:1793`；判定 `src/tree-model.ts:2357` | — |
| **AC4** 不聚合 history / flat / 未分组；history 行无字段 | **通过** | A6 `:1812`（含 `'hasRunningTasks' in row === false`）、A7 `:1839`、A8 `:1859`；history 构造点 `src/tree-model.ts:2386-2396` 无字段；未分组显式 `false` `:2422` | 三桶分开断言，未合并成一条 |
| **AC5** 折叠 / 第 7 条被截断 / 视口外仍 `true` | **通过（视口外为结构推论）** | A9 `:1867`（折叠后无子行仍 `true`）、A10 `:1885`（运行中会话不在渲染行里仍 `true`）；`heads` 用于判定 `src/tree-model.ts:1952-1956` | 「视口外」无浏览器可测；数据在 `rows` 数组，与渲染无关 |
| **AC6** 归档 / 非当前 blank 不计入；当前 blank 计入 | **通过** | A11 `:1906`、A12 `:1926`、A13 `:1945`；谓词 `src/tree-model.ts:1792-1799` | — |
| **AC7** `runningCount` 零回归 | **通过** | 既有用例 `test/tree-model.test.mjs:1677` 未改且通过；`git diff --numstat test/tree-model.test.mjs` = `269 0`；A2 另断言 `runningCount === 0` 而 `hasRunningTasks === true` | Q1 原文未被改写（`src/tree-model.ts:2261-2262`、`docs/INTERFACES.md` 保留） |
| **AC8** 只对 project/worktree 的 lead 图标着色；history 永不高亮；不整行/无点/无徽章 | **部分通过** | C1 `test/sidebar-wiring.test.mjs:879`、C2 `:898`、C6 `:1005`；实现 `src/sidebar.tsx:802-806`（`color` `:804` / `filter` `:805`，在 `...dimText(12)` `:798` 之后） | 「不整行着色 / 无状态点 / 无徽章」**零测试锁**（F2）；「着色仅在高亮时」**零测试锁**（F1）；真实像素未验证 |
| **AC9** `data-running="true"` 仅高亮时出现；`title === t('a11y.runningTask')`；唯一新 key | **部分通过** | C3 `:911`、C4 `:937`、C5 `:975`；实现 `src/sidebar.tsx:882` / `:795`、`src/locales.ts:73` | 「不高亮时不出现」未锁（F3：`'… ? "true" : "false"'` 仍全绿）；中文文案与词条存在性未锁（F4：删词条全绿） |
| **AC10** 签名只随运行集合变；经 220 ms 防抖触发；首拉/30 s/focus 保留 | **通过（首拉未锁，时延未测）** | B1–B8 `test/live-state.test.mjs:169-235`、C8 `:1078`、C10 `:1113`；接线 `src/sidebar.tsx:1604`、`:1683`、`:1688`、`:1691` | 「首拉」无断言（F5，影响小：220 ms 防抖 effect 仍会首取）；0.3–1 s 未实测 |
| **AC11** 异常形状返回 `''` 不抛；签名不进 `reload` 依赖；hook 顺序不变 | **通过** | B5 `test/live-state.test.mjs:200`、B6 `:208`、C9 `test/sidebar-wiring.test.mjs:1091`；`src/sidebar.tsx:1673`（`[t]`）vs `:1683` | hook 顺序：新增只是普通函数派生（`:1604`），无新 hook |
| **AC12** 非目标不越界（轨道态 / 搜索态 / 三桶 / 宿主配置） | **通过（代码审查）** | `wide === false` 提前 return `src/sidebar.tsx:2137`；搜索只产 session 行 `src/tree-model.ts:2059-2073`；`src/routes.ts`/`package.json`/`cordis.patch.yml`/`src/client.tsx` 无改动（`git status`） | 未跑宿主/配置相关命令 |
| **AC13** 重启后人工 10 步 | **未验证** | — | §12 明确声明 |

---

## 4. 发现清单

### P0（阻断）：**无**

未发现会导致错误高亮、崩溃、数据破坏或安全问题的缺陷。

### P1（高）：**无**

未发现「需求语义被实现反着做」或「旧契约被无声扩大」的缺陷。旧 Q1 裁决、`runningCount` 口径、`history` 排除、`flat` 排除、`未分组` 排除均核对为**未发现缺陷**。

### P2（中）：7 项

#### F1（P2）lead 图标的 color/filter **不锁条件性**：常亮蓝也能全绿

- **位置**：`src/sidebar.tsx:802-806`（`...(runningHighlight ? { color, filter } : {})`）；测试 `test/sidebar-wiring.test.mjs:879-909`（C1/C2）
- **现象**：C1/C2 只断言「lead span 的 style 里存在且恰好一个 `color` / `filter`，且字面值正确」，**没有**断言它位于 `runningHighlight` 条件分支内。
- **影响**：若将来有人把着色移出条件（所有项目/ worktree 图标**常亮**蓝、带光晕），`data-running` 与 `title` 仍只在运行行出现 ⇒ 视觉信号自相矛盾，而**整套测试不报警**。这是「用户看到的错误高亮」类回归，不是理论问题。
- **复现（我在 `/tmp` 副本实测）**：

  ```diff
  -        ...(runningHighlight
  -          ? { color: '…state-business-primary, #4176e6)', filter: 'drop-shadow(0 0 2px …)' }
  -          : {}),
  +        color: 'var(--dsw-alias-state-business-primary, #4176e6)',
  +        filter: 'drop-shadow(0 0 2px var(--dsw-alias-state-business-primary, #4176e6))',
  ```

  ```text
  node --test test/sidebar-wiring.test.mjs
  ℹ tests 24 / pass 24 / fail 0        ← 缺口：零红
  ```

- **建议**：给 C1/C2 加「属性祖先链必须是 `runningHighlight` 条件表达式」的断言（直接复用 C4/C5 已有的 `isRunningHighlightRef` + 父链追溯工具），或新增 C11 统一锁「除 `data-running` / `title` 外，`color`/`filter` 也只在同一判据下出现」。补测后可登记为设计 §9.2 D 表的新变异（建议 **M8**）。

#### F2（P2）「不整行着色 / 无左侧竖条 / 无状态点」**零测试锁**

- **位置**：行根 `src/sidebar.tsx:876-890`（style 在 `:883-887`）；契约 AC8 / RT3 / `docs/INTERFACES.md` §2.3「不做」列表
- **现象**：C1/C2 只查 lead span；**没有任何断言**检查行根 style 不含 `color`/`background`/`borderLeft`，也没有断言 `ContainerRowView` 内不出现 `StatusDot` 或数字徽章。
- **影响**：AC8 的三条禁止项（整行着色、左侧竖条、状态点/徽章）在当前测试下可以随意违反而不变红；而「左侧竖条与拖拽插入线冲突」是设计 §12 明确记录的视觉风险。
- **复现（副本实测）**：给行根 style 加

  ```diff
  +      background: runningHighlight ? 'rgba(65, 118, 230, 0.12)' : undefined,
  +      borderLeft: runningHighlight ? '2px solid #4176e6' : undefined,
  ```

  ```text
  node --test test/sidebar-wiring.test.mjs
  ℹ tests 24 / pass 24 / fail 0        ← 缺口：整行着色 + 竖条零红
  ```

- **建议**：新增一条 AST 断言：`jsx('div', { 'data-key': … })` 的 style 对象顶层键集合 ⊆ {`...rowStyle`、`position`、`opacity`}，且 `ContainerRowView` 子树内无 `StatusDot` / `role="status"` / 纯数字胶囊。建议登记为 **M9**。

#### F3（P2）`data-running`「不高亮时**不出现**」未被真正锁住

- **位置**：`src/sidebar.tsx:882`；测试 `test/sidebar-wiring.test.mjs:960-973`（C4 的「形态 B」）
- **现象**：C4 的形态 B 接受 `'data-running': runningHighlight ? 'true' : undefined`，但只校验 `whenTrue === "'true'"`，**不校验 `whenFalse` 必须是 `undefined`**。于是 `'data-running': runningHighlight ? 'true' : 'false'` 也过。
- **影响**：契约与 AC9 明确要求「不高亮时不出现该属性（不是 `"false"`）」。当前测试放行了「恒出现」的实现；DOM 钩子语义被稀释（`[data-running]` 选择器会命中所有容器行）。
- **复现（副本实测）**：

  ```diff
  -    ...(runningHighlight ? { 'data-running': 'true' } : {}),
  +    'data-running': runningHighlight ? 'true' : 'false',
  ```

  ```text
  node --test test/sidebar-wiring.test.mjs
  ℹ tests 24 / pass 24 / fail 0        ← 缺口：属性恒在，零红
  ```

- **建议**：形态 B 追加 `assert.equal(normalizeWs(init.whenFalse.getText()), 'undefined')`（或允许 `void 0`）；形态 A 已足够严格。

#### F4（P2）`a11y.runningTask` 的**词条存在性与中文文案**零测试；删掉词条仍全绿

- **位置**：`src/locales.ts:73`；测试缺口在 `test/locales.test.mjs:38-45` 与 `test/sidebar-wiring.test.mjs:975-1003`（C5）
- **现象**：C5 只断言 title 的实参**字面量**是 `'a11y.runningTask'`；`test/locales.test.mjs` 的 `for (const [key, value] of Object.entries(zh)) assert.equal(t(key), value)` **只验证兜底函数覆盖表内所有 key**，对「表里有没有这个 key」「文案对不对」恒真。`grep -rn "有任务正在运行" test/` **零命中**。
- **影响**：删除该词条或改错文案，全套测试仍绿；运行时 `title` 会渲染**裸 key**（`a11y.runningTask`）—— 这正是 2026-09-23 用户报告的「侧栏渲染裸 key」缺陷类型（`docs/INTERFACES.md` §2.1 有历史记录）。AC9 的「中文渲染为『有任务正在运行』」目前**没有自动证据**。
- **复现（副本实测）**：删掉 `src/locales.ts` 的该 key + 注释行 → `npx tsc -p tsconfig.json`（exit 0）→

  ```text
  node --test test/locales.test.mjs test/sidebar-wiring.test.mjs
  ℹ tests 32 / pass 32 / fail 0        ← 缺口：裸 key 风险零红
  ```

- **建议**：在 `test/locales.test.mjs` 增加 `assert.equal(zh['a11y.runningTask'], '有任务正在运行')`（与本仓库既有的「词条最小集」约定一致），并可选加「sidebar 里所有 `t('…')` 字面量都在 `zh` 中存在」的集合断言。**T-5 §5 把 `test/locales.test.mjs:44` 当作 AC9 证据是不充分的**（见 §6）。

#### F5（P2，影响小）AC10 的「首拉」没有任何测试

- **位置**：`src/sidebar.tsx:1685-1695`（`useEffect(() => { reload(); … }, [reload])`）；测试 `test/sidebar-wiring.test.mjs:1113-1134`（C10）
- **现象**：C10 只查 `setInterval(reload, TREE_REFRESH_MS)` 与 `window.addEventListener('focus', …)`，**不查 mount effect 里的 `reload()`**。
- **影响（如实降级）**：删掉首拉后，页面仍会在 220 ms 后由防抖 effect 首取，用户几乎无感；因此这是**契约句未被锁**，不是可用性缺陷。
- **复现（副本实测）**：删掉 mount effect 第一行 `reload()` →

  ```text
  node --test test/sidebar-wiring.test.mjs
  ℹ tests 24 / pass 24 / fail 0        ← 缺口：零红
  ```

- **建议**：C10 追加「`[reload]` effect 体内存在无参 `reload()` 调用（且在 `setInterval` 之前）」断言；或把 AC10 的「首拉」降级为可人工项并在 T-5/本报告中标注未锁。

#### F6（P2，文档）`docs/README.md` 未索引 `docs/testing/` 与本审查文件

- **位置**：`docs/README.md:31-39`（「本次需求」表只有需求/设计/工作记录/PRD/契约）、`:41-58`（审查表只列两篇知识库审查）、`:60-68`（工作记录表）
- **现象**：新目录 `docs/testing/` 下的验证报告**无法从总入口沿链接找到**；`docs/reviews/2026-10-20-running-task-highlight-review.md`（本文件）同理。
- **影响**：违反 `AGENTS.md` §5「新增、移动、归档文档时，同步更新总索引……确保每份文档都能从总入口沿链接找到」。T-5 §9.3 已主动声明在其写入范围外，但缺口仍然存在。
- **建议**：父代理指派一次文档任务补两行索引（或在放开写入范围后由 T-6 后续任务补）。

#### F7（P2，文档）`docs/PRD.md` 的 §12 状态已过期

- **位置**：`docs/PRD.md:688`：「**状态**：设计已定稿，**等待 T-4 实现**」
- **现象**：T-4 / T-5 均已完成，PRD §12 仍写「等待 T-4 实现」。
- **影响**：与工作记录、验证报告、契约三方状态不一致；读者会误判需求尚未落地。T-5 §7 的一致性表**没有覆盖这一行**。
- **建议**：改为「T-4 已实现、T-5 已复核（自动项通过）、视觉待人工验收（AC13）」。

### nit：6 项

#### F8（nit）`src/locales.ts` 文件头注释与内容漂移

- **位置**：`src/locales.ts:10-13`
- **现象**：注释写「尾部 4 条（`worktree.menu` / `a11y.subagents` / `state.loadingTree` / `worktree.createTitle`）」，但 `a11y.runningTask`（`:73`）被插进了这个「尾部」块中间，实际该块 5 条；注释未同步，且「尾部」语义被打断。
- **建议**：注释改为 5 条并把 `a11y.runningTask` 列进去，或把新 key 移到块尾（需同步契约表顺序说明，见 §6 的非阻塞观察）。

#### F9（nit，文档）工作记录的 T-6 描述与实际派工不一致

- **位置**：`docs/worklog/2026-10-20-running-task-highlight.md:180`
- **现象**：T-6 被描述为「交付验收：`npm run build` → 重启 DSH Desktop → 重载 → 人工 10 步 → 记录截图」；实际 T-6 是**独立审查**（禁止重启、只写审查报告），人工验收尚未排期。
- **影响**：仅文档口径问题，但会让后来者以为 T-6 已完成视觉验收。
- **建议**：把 T-6 改为「独立审查」并新增 T-7 承载「重启 + 人工验收」。

#### F10（nit）`history` / `flat` 容器也会计算 `hasRunningTasks`，但无人消费

- **位置**：`src/tree-model.ts:1948-1956`（`emitContainer` 对所有 `ContainerSpec` 计算）；消费方只有 `:2357`（project，读 worktree 结果）与 `:2376`（worktree 行）
- **现象**：`historyResult.hasRunningTasks` 与 `flatResult.hasRunningTasks` 计算后从不读取（设计 §3.3 明确允许）。
- **影响**：O(容器内可见会话数) 的无用计算；更重要的是给读者「history 也参与聚合」的错觉（实际没有）。
- **建议**：保持行为不变，加一行注释或按 `spec.kind` 短路（若短路，注意 `ContainerResult` 字段仍必填）。

#### F11（nit / 风险）签名包含树里不可见的会话

- **位置**：`src/live-state.ts:191-208`（对 `useSessionStatus` 全量遍历）；`src/sidebar.tsx:1604`
- **现象**：归档会话、非当前 blank 会话、不在任何容器里的会话，其 `running` 变化仍会改变签名 ⇒ 触发一次 `/tree` 重取（被 220 ms 合并）。
- **影响**：轻微多余请求（每回合个位数以内），无正确性影响；与 AC11「签名只随运行集合变化」不冲突。
- **建议**：本轮不改（过滤会让签名与可见性耦合）。若将来要收敛，需在契约层重新定义「运行集合」。

#### F12（nit，可访问性）高亮语义对键盘 / 读屏用户不可达

- **位置**：`src/sidebar.tsx:795`（仅 `title`）
- **现象**：`title` 只在鼠标悬停时呈现；`role="treeitem"` 的行没有 `aria-describedby` / 隐藏文本，读屏用户得不到「有任务正在运行」。设计 §6.3 已声明这是 RT3「不加状态点」的直接结果，并承认「不悬停时只能靠颜色」。
- **建议（不本轮改）**：可考虑给 lead span 加 `aria-label`（或 `role="img"` + label）而不增加任何视觉元素 —— 用户裁决禁的是**视觉**状态点/徽章，未见禁止无障碍文本；若要动，需父代理回用户确认边界。

#### F13（nit，视觉）`drop-shadow(0 0 2px)` 在 16 px 图标上的糊边风险已在设计 R5 记录，但仍未验证

- **位置**：`src/sidebar.tsx:805`；设计 §12 R5
- **建议**：人工验收第 1/8 步时对比「有/无 filter」的观感；若发糊，退回纯 `color` 即可（不改契约，属视觉微调）。

---

## 5. 回归 / 风险 / 漏测

### 5.1 回归面（未发现缺陷）

| 回归点 | 证据 | 结论 |
|---|---|---|
| `runningCount` 口径 | `src/tree-model.ts:1946` 仍是 `heads.filter(s => s.running === true).length`；`git diff` 该文件 `49 0`（无删除行） | 未发现缺陷 |
| 旧 Q1 回归锁 | `test/tree-model.test.mjs:1677` 与 HEAD 一致；整文件 `269 0` | 未发现缺陷 |
| 旧 Q1 契约文本 | `docs/INTERFACES.md`「`runningCount` 的口径刻意不变」原句仍在（T-5 记 :1316-1317）；`src/tree-model.ts:2261-2262` 原样 | 未发现缺陷 |
| 既有功能 | 我实跑 `node --test`：456/456 通过 | 未发现缺陷 |
| `runningCount` 的渲染层消费者 | `grep -n runningCount src/sidebar.tsx` 零命中（Q1 前提仍成立） | 未发现缺陷 |
| 会话行蓝点 / `StatusDot` | `ContainerRowView` 未引入 `StatusDot`；会话行代码未改（`git diff` 中相关段落属 2026-10-19/08 任务，T-5 已声明无法按任务切分） | 未发现缺陷（但无法用 git 归因，见 §5.3） |

### 5.2 风险

1. **宿主形状假设（设计 R2，P2 级风险）**：`runningSignature` 依赖 `status.entries()`。我抽验宿主 `0.2.1-rc.2`：`publishStatus()` 确实组装 `new Map()`（`dsh-client-ui-session/lib/client.js:976-992`），`sameSessionStatus` 做内容去重（`:1119-1128`），`projectList()` 会把子代理补进 `byId`（`origin: "subagent"`，`dsh-api-session-controller/lib/client.js:4166-4205`）⇒ **子代理启停会改变签名**，AC2 的「子代理场景也能 ≤1 s 亮起」在链路层成立。但这是**实现事实**：若宿主改成普通对象，签名恒 `''` ⇒ **静默失去快速刷新**（不抛、不亮错误），只剩 30 s 轮询兜底。行为符合 AC11，但值得在宿主升级清单里跟踪。
2. **请求量**：每个子代理启停各 1 次状态迁移 ⇒ 可能额外 1–2 次 `/tree`（220 ms 合并后），与设计 §7.4 一致；我没有实测请求数。
3. **签名含不可见会话**（F11）：轻微多余触发，无正确性问题。
4. **`drop-shadow` 视觉**（F13 / R5）：未验证。
5. **构建时序**（R1）：`hasRunningTasks` 由宿主 `lib/tree-model.js` 产出，**必须重启**才生效；`=== true` 保证「旧产物 ⇒ 不亮、不崩」。我确认 `lib/tree-model.js` 含该字段、`lib/client.js` 含 `data-running`，且 `lib` mtime（13:22）晚于全部 `src` mtime（≤13:12）⇒ 产物与源码同步；但**未重建验证**。

### 5.3 漏测清单（按影响排序）

| # | 漏测 | 严重度 | 备注 |
|---|---|---|---|
| 1 | 着色「仅在高亮时」（F1） | P2 | 实测常亮全绿 |
| 2 | 整行着色 / 竖条 / 状态点 / 徽章（F2） | P2 | 实测整行着色全绿 |
| 3 | `data-running` 不高亮时缺失（F3） | P2 | 实测 `'false'` 全绿 |
| 4 | locale 词条存在性与中文文案（F4） | P2 | 实测删词条全绿 |
| 5 | 首拉 `reload()`（F5） | nit | 实测删除全绿；影响小 |
| 6 | **project 折叠 + worktree 在跑** | nit | 代码上成立（`worktreeResults` 在 `if (projectCollapsed) continue` 之前计算，`src/tree-model.ts:2330-2358`），但无用例；A9 只覆盖 worktree 折叠 |
| 7 | `expandedAll`（展开其余）与运行中会话并存 | nit | `hasRunningTasks` 用 `heads`，与 `expandedAll` 无关；无专门用例 |
| 8 | 运行中会话数 > 5（顶部区自身被截断） | nit | A10 的夹具未传 `topZone`（`test/tree-model.test.mjs:88-100`），而真实 `sidebar.tsx:1868` 会传 `topZone` ⇒ 生产中运行中会话通常被前置，A10 的「排第 7」主要出现在运行中会话 > 5 时；**A10 仍能判别 `heads` vs `selected`**（§7 我实测） |

---

## 6. 对 T-5 报告的独立复核意见

### 6.1 我接受（并做了独立核对）

| T-5 结论 | 我的核对方式 | 意见 |
|---|---|---|
| 全量 456 / 定向 263·18·24 全绿 | 我在**不构建**的前提下实跑 `node --test`（456/456）与三份定向（305/305） | **接受** |
| 代码事实行号（判定、渲染、接线、签名） | 逐条 `sed/grep` 复核，行号一致（`tree-model.ts:1946/1952-1956/2357/2422`、`sidebar.tsx:790/795/804-805/882/1604/1683/1688/1691`、`live-state.ts:191-208`） | **接受** |
| 旧 Q1 未被改写（0 删除行） | `git diff --numstat` 独立复跑：`src/tree-model.ts 49 0`、`test/tree-model.test.mjs 269 0`、`src/locales.ts 2 0` | **接受** |
| M2 / M4 变红 | 我在副本内复现：删着色 → `22/24 fail 2 (C1,C2)`；删 deps → `23/24 fail 1 (C8)` | **接受（可复现）** |
| M1/M3/M5/M6/M7 结论 | 未逐条重跑（时间盒），但断言机制与我的复现同类；视为**可信但未独立复跑** | 接受（标注未复跑） |
| 视觉不可脚本化（403 / 无 CDP / 无 playwright） | 未重测（同环境），与 T-2 §6 一致 | **接受** |
| 宿主形状 / 频率 / 子代理覆盖 | 我抽验宿主源码三处（`publishStatus` Map、`sameSessionStatus`、`projectList` 补 subagent） | **接受（源码级）** |
| 不越界、审核前后 `git status` 一致 | 我复核当前 `git status` 25 项与审查开始一致；`lib/` 属 gitignore | **接受** |

### 6.2 我认为不充分 / 需要修正

1. **AC9 的证据链**：T-5 §5 用「`test/locales.test.mjs:44` 遍历词典逐条比对兜底」支撑 AC9，但那条断言对「`zh` 里有没有 `a11y.runningTask`」「文案是否为『有任务正在运行』」**恒真**（我实测删词条 32/32 绿）。AC9 目前只有「key 字面量出现在 sidebar」这一半证据。
2. **AC8 的「不整行 / 无点 / 无徽章」与「着色条件性」**：T-5 写「结构通过」，但结构证据只覆盖「存在正确的 color/filter」；我实测「常亮」与「整行着色 + 竖条」都全绿。T-5 §6 的 M1–M7 没有覆盖这两类回退。
3. **AC10 的「首拉」**：T-5 未指出 C10 不覆盖 mount 首拉（F5）。
4. **文档一致性**：T-5 §7 的一致性表漏了 `docs/PRD.md:688` 的过期状态（F7）与总索引缺口（F6，T-5 §9.3 已自述但未列为发现）。
5. **「判别力结论」的措辞**：T-5 说「C1–C5、C8–C9 都是活的断言」——对**删除式**回退成立，对**常亮式**回退不成立（F1）。建议把结论限定为「对删除/替换判据类回退敏感」。

### 6.3 我对 T-5 的总体意见

T-5 的复跑、归因方法（文件集合 + numstat + 关键字唯一性）、变异隔离（`/tmp` 副本 + 恢复 + 删除）与「视觉未验证」的诚实声明都**符合独立复核标准**，可以采信其**通过项**；但它把「测试存在」近似成「契约被锁」，对 4 类**非删除式**回退缺乏判别力证据 —— 这是本审查的主要增量。

---

## 7. 「如果实现回退，哪条测试会红」——独立判断

> 前提：L1/L2 测试 `import ../lib/*.js`，因此「回退即红」只在**先构建**的前提下成立；若只改 `src/` 不构建，测试读到旧 `lib/` 仍会绿（仓库约定 `npm test` 先 build，`AGENTS.md` §4）。这是全仓库既有性质，不是本需求的缺陷。

| 回退方式 | 会红的测试 | 证据来源 |
|---|---|---|
| `emitContainer` 判定改用**截断后** `selected` | **仅 A10**（`262/263, fail 1`） | **我实测**（副本 + `tsc`） |
| 删除 lead 图标的 color/filter 着色分支 | **C1 + C2**（`22/24, fail 2`） | **我实测** |
| 从 220 ms 防抖依赖移除签名 | **C8**（`23/24, fail 1`） | **我实测** |
| 把 color/filter 移出条件（常亮） | **零红**（`24/24`）→ **缺口 F1** | **我实测** |
| 行根加 `background` / `borderLeft`（整行着色） | **零红**（`24/24`）→ **缺口 F2** | **我实测** |
| `data-running` 改为恒出现（`'true'/'false'`） | **零红**（`24/24`）→ **缺口 F3** | **我实测** |
| 删除 `a11y.runningTask` 词条 | **零红**（`32/32`）→ **缺口 F4** | **我实测** |
| 删除 mount effect 的首拉 `reload()` | **零红**（`24/24`）→ **缺口 F5** | **我实测** |
| worktree 判定丢弃子代理聚合（M7） | A2 + A3 | 引用 T-5 实测（`263/261`），我未复跑 |
| project 判定改用 `allResults`（M6） | A6 + A7 | 引用 T-5 实测（`263/261`），我未复跑 |
| 判据改 `row.runningCount > 0`（M3） | C3 | 引用 T-5 实测（`24/23`） |

**结论**：**数据侧与刷新侧**的回归有真实判别力（A10/C1/C2/C8 我亲测变红）；**渲染条件性 / 禁止项 / 词条 / 首拉**四类回退目前**无判别力**，建议按 F1–F5 补锁后把对应变异补进设计 §9.2 D 表（M8–M11）。

---

## 8. 可访问性与视觉（仅建议，本任务不改）

| 项 | 观察 | 建议 |
|---|---|---|
| `title`-only | 只覆盖鼠标悬停；读屏 / 键盘无感知（F12）。与仓库既有 `a11y.subagents` 胶囊 title 同通道，风格一致 | 若父代理愿意回用户确认，可加 `aria-label`（无视觉变化）；否则接受并写入已知限制 |
| `aria` 冲突 | lead span 加 `title` 与行根 `role="treeitem"` / `aria-expanded` 无冲突；同一行内已有 label span 的 `title`（worktree 路径），两个 tooltip 区域不同，不会互相覆盖 | 无需改 |
| `drop-shadow` 2 px @16 px | 设计 R5 已列为风险；光晕是装饰，不是信息通道 | 人工验收时对比有/无 filter；发糊则退回纯 `color` |
| 颜色对比度 | 明色 `#4176e6` on `#f9fafb` ≈ 4.05:1，暗色 `#7aaaff` on `#1b1b1c` ≈ 7.39:1（设计 §6.1，来自 T-2 node 计算，**非截图实测**） | 满足非文本 3:1；暗色需人工确认 |
| 单通道风险 | 不悬停时只有颜色可辨（WCAG 1.4.1 的最低要求靠 title 补足） | 用户 ET3/RT3 的既定代价；若要强化须重新拍板（不建议本轮改） |

---

## 9. 文档与工程一致性

| 检查 | 结果 |
|---|---|
| 字段名唯一（`hasRunningTasks`，无 `hasRunning` / `activeRow` / `isRunningTask`） | **通过**（53 处命中均属实现/契约/测试；第二套命名零命中） |
| locale key 唯一（`a11y.runningTask`） | **通过**（`src/locales.ts:73` 定义、`src/sidebar.tsx:795` 消费、契约 §2.1/§2.3 登记） |
| 颜色 / 光晕唯一 | **通过**（`state-business-primary` 仅在 `src/sidebar.tsx:804-805`；未用 `brand-primary`） |
| 刷新信号唯一 | **通过**（`runningSignature` 仅 `src/live-state.ts` 实现 + `src/sidebar.tsx` 消费） |
| PRD ↔ 需求 ↔ 设计 ↔ 契约 ↔ 实现 | **基本一致**；PRD 状态过期（F7）；T-5 记录的「§2.1 表顺序 vs locales 顺序」差异不构成契约冲突（该表是键集合） |
| `docs/README.md` 索引 | **缺 2 项**（`testing/` 验证报告、本审查文件）（F6） |
| `src/locales.ts` 头注释 | 漂移（F8） |
| 工作记录 T-6 范围 | 漂移（F9） |
| 越界改动 / 未提交工作被覆盖 | **未发现**：`src/routes.ts`、`package.json`、`cordis.patch.yml`、`src/client.tsx` 零改动；`git status` 25 项审查前后一致；无删除行落在既有用例/旧裁决上 |
| 构建产物 vs 源码 | `lib/tree-model.js` 含 `hasRunningTasks`（5 处）、`lib/client.js` 含 `data-running`；`lib` mtime 13:22 > `src` 最新 13:12 ⇒ **同步**（未重建验证） |

---

## 10. 对抗式场景核对（不只是复述 T-5）

| # | 反例场景 | 期望 | 当前实现 / 测试给出的结果 | 结论 |
|---|---|---|---|---|
| 1 | project 只有 **flat / history** 在跑，worktree 全空闲 | project 不亮、history clock 不亮 | `worktreeResults.some(...)` 为 false（`:2357`）；A6/A7 锁住 | **未发现缺陷** |
| 2 | worktree 内**只有子代理**在跑（父 `running:false`） | worktree 亮且父会话行蓝点亮 | `:1952-1956` 与 `:1496` 共用 `subagentCountOf`；A2 同用例双断言 | **未发现缺陷** |
| 3 | **折叠 + 截断同时发生**（worktree 折叠、>5 会话、运行中会话被挤到截断区） | 仍亮 | 判定在 `emitContainer` 内、用 `heads`；折叠只影响 `selected`/`rows`；A9/A10 分别覆盖 | **未发现缺陷**（无组合用例，见 §5.3 #6/#8） |
| 4 | **父会话重启后旧 `lib/` 无字段**（宿主未重启） | 不亮、不崩 | `row.kind === 'history' ? false : row.hasRunningTasks === true`（`sidebar.tsx:790`）⇒ `undefined === true` 为 false | **未发现缺陷** |
| 5 | **`status` 是普通对象**（Map 形状漂移） | 不抛；最坏退化为 30 s 刷新 | `runningSignature` 无 `entries` ⇒ `''`（`live-state.ts:193`）；B5 覆盖 `{}` / `[]` / `0` | **未发现缺陷**（静默退化属已知 R2） |
| 6 | **`session-x` 与 `x` 同时存在**且都 running | 只算一次 | `normalizeSessionKey` + `Set` 去重（`:200-204`）；B2 覆盖 | **未发现缺陷** |
| 7 | 多层子代理（depth 3）在跑，中间层 idle | 顶层 worktree 亮 | `indexRunningSubagentDescendants` 逐层累加；A3 覆盖 | **未发现缺陷** |
| 8 | project **只有一个 worktree**（单 worktree git 项目） | worktree 行存在且可亮 | `worktreeCount = worktrees.length`（含单 worktree）；A1 用 `singleWorktreeProject` | **未发现缺陷** |
| 9 | worktree 内**多会话**，仅 1 条在跑 | 该 worktree 亮，且不误伤兄弟 worktree | `heads.some`；A4 覆盖两 worktree 的 A/B 隔离 | **未发现缺陷** |
| 10 | **当前 blank** 会话在跑 | 计入（与 `runningCount` 一致） | A13；`isVisibleMember` 的 blank 豁免 | **未发现缺陷** |
| 11 | 未分组容器在跑 | 未分组行 `false` | 显式常量 `false`（`:2422`），A8 覆盖 | **未发现缺陷** |
| 12 | 运行中会话数 > 5（顶层区自身被截断） | 仍亮 | `heads` 是截断前全量；顶部区前置只改顺序 | **未发现缺陷**（无专门用例） |
| 13 | 高亮判据被写死 / 常亮 | 测试应红 | 写死 `data-running` 会红（C4，T-5 M1）；**常亮不会红**（F1） | **测试缺口**（P2） |
| 14 | project 折叠、其 worktree 在跑 | project 文件夹亮 | `worktreeResults` 在 `continue` 之前算好（`:2330-2358`） | **未发现缺陷**（无专门用例） |
| 15 | 搜索态 / `wide === false` | 不产生容器行、不误亮 | 搜索只产 session 行（`:2059-2073`）；轨道态提前 return（`sidebar.tsx:2137`） | **未发现缺陷** |
| 16 | 归档会话在跑 | 不计入 | `isVisibleMember` 排除归档；A11 覆盖 | **未发现缺陷** |

---

## 11. 需要父代理决定的事项

1. **结论口径**：是否接受本审查的「**有条件通过**」——即「实现无需返工，但测试锁 + 文档索引 + 视觉验收三件后置事项必须闭环」。
2. **F1–F5 补测归属**：是否需要新建任务（建议 T-7）补 4 条测试锁 + 1 条首拉断言，并把对应变异（建议 M8–M11）登记进设计 §9.2 D 表？若要求 T-4 返工，需重新开放 `test/` 与设计文档的写权限。
3. **AC13 视觉验收排期与执行人**：需要「`npm run build` → 完全重启 DSH Desktop → 刷新 → 按设计 §11 十步人工确认」。在此之前，本需求的**视觉项不得视为交付完成**（`hasRunningTasks` 在宿主 `lib/`，不重启永不亮）。
4. **`docs/README.md` 索引缺失（F6）**：属于我的写入范围之外；请指派文档任务补 `testing/…verification.md` 与 `reviews/…review.md` 两行索引（若放开范围，我可补）。
5. **`docs/PRD.md:688` 状态与 `src/locales.ts` 头注释（F7/F8）**：同属范围外；是否一并修正。
6. **F12 的边界**：是否需要就「`aria-label` 是否算用户裁决禁止的『状态点』」回用户确认；若不确认，接受为已知限制。
7. **AC10 时延量化**：是否要求实测「0.3–1 s」；自动化不可得，需人工计时或 DevTools Network 观察。

---

## 12. 明确声明：视觉未验证

- 本报告**没有**验证任何真实像素、明暗主题观感、光晕观感、悬停/拖拽发糊、`React error #130`、实际请求节奏或端到端时延。
- 原因：当前 GUI 不可脚本化（HTTP 403、无 CDP 端口、无 playwright —— T-2 §6 实测，T-5 §8.1 复核；本任务按要求**未尝试绕过**），且 `hasRunningTasks` 需**重启 DSH Desktop** 才生效（任务禁止重启）。
- 因此：**AC8 的像素部分、AC13 全部、AC10 的「0.3–1 s」均未验证**。本报告只给出结构证据（AST + 实跑单测）与代码事实。

---

## 13. 附录：证据与命令摘要

### 13.1 我实跑的绿/红记录（全部在只读前提或 `/tmp` 副本内）

```text
# 主仓库（只读）
npm run typecheck                                   → exit 0
node --test                                         → tests 456 / pass 456 / fail 0
node --test test/tree-model.test.mjs test/live-state.test.mjs test/sidebar-wiring.test.mjs
                                                    → tests 305 / pass 305 / fail 0

# /tmp 副本（基线）
node --test test/sidebar-wiring.test.mjs             → 24/24
# 变异：heads → selected（需 tsc 构建）
npx tsc -p tsconfig.json → exit 0; node --test test/tree-model.test.mjs
                                                    → 262/263, fail 1 = A10
# 变异：删除着色分支
                                                    → 22/24, fail 2 = C1, C2
# 变异：移除防抖依赖里的签名
                                                    → 23/24, fail 1 = C8
# 变异：着色常亮（移出条件）
                                                    → 24/24（缺口 F1）
# 变异：行根加 background + borderLeft
                                                    → 24/24（缺口 F2）
# 变异：data-running 恒出现 "false"
                                                    → 24/24（缺口 F3）
# 变异：删除 a11y.runningTask 词条（npx tsc → exit 0）
                                                    → 32/32（缺口 F4）
# 变异：删除 mount effect 的首拉 reload()
                                                    → 24/24（缺口 F5）
```

### 13.2 关键只读事实

```text
src/tree-model.ts:1946   runningCount: heads.filter((session) => session.running === true).length   # Q1 口径未变
src/tree-model.ts:1952-1956  hasRunningTasks: heads.some(… running === true || subagentCountOf(…) > 0)
src/tree-model.ts:2357   hasRunningTasks: worktreeResults.some(entry => entry.result.hasRunningTasks === true)
src/tree-model.ts:2422   hasRunningTasks: false                                                      # 未分组显式
src/tree-model.ts:2386-2396  history 行构造点：无 hasRunningTasks
src/sidebar.tsx:790      const runningHighlight = row.kind === 'history' ? false : row.hasRunningTasks === true
src/sidebar.tsx:795      title: props.t('a11y.runningTask')（仅高亮）
src/sidebar.tsx:802-806  条件展开 color/filter（:804 / :805），位于 :798 dimText(12) 之后
src/sidebar.tsx:882      ...(runningHighlight ? { 'data-running': 'true' } : {})
src/sidebar.tsx:1604     const runningSignatureValue = runningSignature(sessionStatus)
src/sidebar.tsx:1683     }, [reload, sessionsSnapshot, currentSessionId, runningSignatureValue])
src/sidebar.tsx:1673     }, [t])            # reload 的 useCallback 依赖，未含签名
src/sidebar.tsx:1688     setInterval(reload, TREE_REFRESH_MS)   # 30 s 兜底
src/sidebar.tsx:1691     window.addEventListener('focus', onFocus)
src/live-state.ts:191-208  runningSignature：entries 守卫 + === true + 归一化去重 + sort/join + try/catch
src/locales.ts:73        'a11y.runningTask': '有任务正在运行'
```

### 13.3 残留状态

- 主仓库**零业务改动**：`git status --porcelain` 25 项与审查开始时一致；新增仅本报告（`docs/reviews/` 下）与检查点追加。
- `/tmp` 副本：`/tmp/t6-mut-ensZpgwx`、`/tmp/t6-mut2-…` 均已 `rm -rf` 删除；无备份残留。
- 未重启 DSH Desktop、未构建、未提交、未切分支、未清理工作区、未读任何凭据。

### 13.4 耗时与尝试

- 约 25 分钟（13:37 开始 → 本报告完成），在时间盒内；无返工，无命令超时。

---

## 14. T-7 处理结果

> 本节由 **T-7（修复/补测/文档收尾）** 在**不改功能行为**的前提下追加；§1–§13 的原始审查结论、
> 发现编号与判定**均未改写**。T-7 只补测试锁与文档，不重开实现；F10–F13 按原建议接受为已知/不改。

### 14.1 处理方式与边界

- **写入范围**：`test/sidebar-wiring.test.mjs`、`test/locales.test.mjs`、`src/locales.ts`（**仅文件头注释**）、
  `docs/README.md`、`docs/PRD.md`、设计/工作记录/本报告。**未编辑** `src/sidebar.tsx`、`src/tree-model.ts`、
  `src/live-state.ts`；未改 `docs/testing` 的 T-5 报告正文；未提交、未切分支、未重启、未清工作区。
- **验证环境**：主仓库实跑 `npm run typecheck` / `npm run build` / 定向测试 / `npm test`；
  变异在 `/tmp` 副本（`rsync` + symlink `node_modules`）内做，主仓库只读，副本用后即删。
- **测试数**：全量 456 → **461**（+5）；`test/sidebar-wiring.test.mjs` 24 → 28，`test/locales.test.mjs` 8 → 9。

### 14.2 F1–F9 逐条处理

| 发现 | 原级别 | T-7 结论 | 处理证据（测试 / 变异 / 文档） |
|---|---|---|---|
| **F1** 着色不锁条件性（常亮全绿） | P2 | **closed** | 新增 C11 `test/sidebar-wiring.test.mjs:1189`：lead span 的 `color` / `filter` 必须落在 `runningHighlight` 的 `whenTrue`（或三元值 + 空 `whenFalse`）；helper `isGuardedByRunningHighlight` 复用 `isRunningHighlightRef` 父链追溯。**M8 实测：C11 红，fail 1**。设计 D 表新增 M8。 |
| **F2** 整行着色 / 竖条 / 状态点零锁 | P2 | **closed** | 新增 C12 `test/sidebar-wiring.test.mjs:1204`：行根 style 子树禁 8 类整行着色键（`background`/`backgroundColor`/`backgroundImage`/`borderLeft`/`borderColor`/`boxShadow`/`color`/`outline`）；`ContainerRowView` 子树禁 `StatusDot` 调用与 `role="status"`（数字徽章不在范围）。**M9 实测：C12 红，fail 1**。设计 D 表新增 M9。 |
| **F3** `data-running` 恒出现全绿 | P2 | **closed** | 新增 C13 `test/sidebar-wiring.test.mjs:1239`：恰好一个 `data-running`；三元形态 `whenFalse` 必须 `undefined`/`void 0`；展开形态属性在 `whenTrue` 且 `whenFalse === {}`。**M10 实测：C13 红，fail 1**（原 §4 复现的 `'true' : 'false'` 写法）。设计 D 表新增 M10。 |
| **F4** 词条存在性/中文文案零测试 | P2 | **closed** | `test/locales.test.mjs:114`：`zh['a11y.runningTask'] === '有任务正在运行'`，并断言 `createT()` 与 `createSeatT(unresolvedSeat)` 均返回该文案（不只遍历词典）。**M11 实测：该用例红，fail 1**（`npx tsc` 仍 exit 0，与本报告 §4 F4 复现一致）。设计 D 表新增 M11。 |
| **F5** 首拉 `reload()` 无断言 | P2 | **closed** | 新增 C14 `test/sidebar-wiring.test.mjs:1278`：依赖恰为 `[reload]` 的 effect 体内存在无参 `reload()` 且位置早于 `setInterval(reload, TREE_REFRESH_MS)`；`onFocus` 闭包内调用位于定时器之后，故「删首拉」必然红而非恒真。**M12 实测：C14 红，fail 1**。设计 D 表新增 M12。 |
| **F6** 总索引缺 testing / reviews | P2 | **closed** | `docs/README.md:38-39`：「本次需求」表新增 T-5 验证报告、T-6 独立审查（含 §14）两行；两文档现可从总入口沿链接到达。 |
| **F7** PRD §12 状态过期 | P2 | **closed** | `docs/PRD.md:688-692`：状态改为「T-4 已实现、T-5 自动项通过、T-6 审查有条件通过、T-7 已补测试锁；AC13 视觉待人工验收」。 |
| **F8** `locales.ts` 头注释漂移 | nit | **closed** | `src/locales.ts:10-13`：「尾部 4 条」→「尾部 5 条」并列入 `a11y.runningTask`；**只改注释**，词条值与顺序未动（M11 可继续验证词条存在性）。 |
| **F9** 工作记录 T-6 口径漂移 | nit | **closed** | `docs/worklog/2026-10-20-running-task-highlight.md:180-181`：T-6 改为「独立审查」，新增 T-7 行；文末新增「T-7 补测与审查闭环」节。 |

### 14.3 F10–F13：accepted / known（本任务不改）

| 发现 | 处理 | 理由与残留 |
|---|---|---|
| **F10** history/flat 容器也计算 `hasRunningTasks` | **accepted（known）** | 保持行为不变；短路需改 `tree-model.ts` 行为（超出 T-7「不改功能行为」范围）。属 `O(容器内可见会话数)` 无用计算，无正确性影响。 |
| **F11** 签名含树里不可见的会话 | **accepted（known）** | 轻微多余 `/tree` 触发（220 ms 合并后个位数/回合）；收敛需在契约层重定义「运行集合」，本轮不做。 |
| **F12** 高亮语义对键盘/读屏不可达 | **accepted（known）** | `title`-only 是 RT3「不加状态点」的直接结果；加 `aria-label` 是否算「状态点」需用户拍板，T-7 无权扩大范围。 |
| **F13** `drop-shadow(0 0 2px)` 糊边风险 | **accepted（known，待视觉验收）** | 只能人工看，已并入设计 §11 第 1/8 步；发糊则退回纯 `color`（视觉微调，不改契约）。 |

### 14.4 结论

- §11 条件②「补 4 条测试锁」与③「文档索引/PRD 状态同步」**已闭环**（实际补了 5 条：C11–C14 + 词条用例）；
  条件①「AC13 视觉人工验收」**仍未完成**，本报告 §12 的「视觉未验证」声明继续有效，
  **视觉项不得视为交付完成**。
- 补锁后「测试全绿」重新成为可信信号：原 §7 表中「零红」的 5 类回退（常亮 / 整行着色 / `data-running` 恒在 /
  删词条 / 删首拉）现在分别由 C11/C12/C13/F4 用例/C14 判红（M8–M12 实测各 fail 1）。
- 本报告 §1–§13 的原始判定（无 P0/P1、P2 × 7、nit × 6、有条件通过）保持原样，仅以本节登记后续处理结果。

---

## 15. T-6 复核（T-7 后）

- **复核时间**：2026-10-20 13:49–13:58（约 9 分钟，在 10 分钟估时 / 20 分钟硬上限内）
- **复核性质**：原审查者（T-6）对 T-7 补测与文档收尾的独立复核；**不采信 T-7 自报数字**，全部重跑 / 重放
- **复核结论**：**T-7 闭环有效** —— F1–F5 的测试锁**真实有效**（我独立复现 5/5 各 `fail 1`）；F6–F9 文档闭环确认；F10–F13 维持 known/accepted；`src/` 功能行为零改动；**视觉仍未验证**（§12 声明继续有效）。发现 **2 个残余 nit（R1/R2）**，不阻塞原「有条件通过」结论。

### 15.1 实跑证据（主仓库只读）

| 检查 | 命令 / 依据 | 结果 |
|---|---|---|
| 新增用例 | `node --test test/sidebar-wiring.test.mjs test/locales.test.mjs` | `tests 37 / pass 37 / fail 0`；C11/C12/C13/C14 与 locales 词条用例**均在列且通过** |
| 全量回归 | `node --test` | `tests 461 / pass 461 / fail 0 / cancelled 0`（T-7 自报 461，我独立复跑一致） |
| 功能文件未被改动 | mtime + `git diff --numstat` | `src/sidebar.tsx 128/142`、`src/tree-model.ts 49/0`、`test/tree-model.test.mjs 269/0` 与 T-6 审查时**逐字相同**；三个 `src` 功能文件 mtime 仍为 13:10–13:12（T-7 未触碰） |
| `src/locales.ts` 仅注释 | `git diff src/locales.ts` | T-7 的净变化 = 文件头注释（2 删 3 增：`尾部 4 条` → `尾部 5 条` 并列入 `a11y.runningTask`）；`zh` 表内容 / 词条值 / 顺序与 T-4 结束时一致（diff 中的 key 行属 T-4 新增，T-7 未改其值与位置） |
| 未提交工作未被覆盖 | `git status --porcelain` | 27 项 = 13 `M` + 14 `??`；与 T-6 审查时相比**仅** `test/locales.test.mjs` 由「未修改」变为「已修改」（T-7 新增用例），其余零变化 |

### 15.2 变异独立复现（`/tmp` 副本，主仓库只读；副本已 `rm -rf`）

| 变异 | 施加方式 | 实际结果 | 判定 |
|---|---|---|---|
| **F1 / M8** 着色常亮 | 把 `color`/`filter` 移出 `runningHighlight` 条件 | `27/28`，**C11 红** | **锁有效** |
| **F2 / M9** 整行着色 + 竖条 | 行根 style 加 `background` + `borderLeft` | `27/28`，**C12 红** | **锁有效** |
| **F3 / M10** `data-running` 恒出现 | `runningHighlight ? 'true' : 'false'` | `27/28`，**C13 红** | **锁有效** |
| **F4 / M11** 删词条 | 删 `'a11y.runningTask'`（副本内 `npx tsc` exit 0 后再跑） | `36/37`，**`locales:` 词条用例红** | **锁有效** |
| **F5 / M12** 删首拉 | 删 mount effect 的第一行 `reload()` | `27/28`，**C14 红** | **锁有效** |

→ T-7 §14 与工作记录中「M8–M12 实测各 fail 1」的**陈述属实**；§7 表中 5 个「零红」缺口已全部转为「有红」，**「测试全绿」重新成为可信信号**。

### 15.3 文档闭环确认（F6–F9）

| 发现 | 状态 | 我复核的证据 |
|---|---|---|
| F6 索引缺失 | **closed** | `docs/README.md:38`（验证报告）、`:39`（独立审查）已进「本次需求」表，总入口可导航 |
| F7 PRD 状态过期 | **closed** | `docs/PRD.md:688-693` 已改为「T-4 已实现 / T-5 自动项通过 / T-6 有条件通过 / T-7 已补测试锁 / AC13 视觉待人工验收」 |
| F8 locales 头注释漂移 | **closed** | `src/locales.ts:10-13` 已改为「尾部 5 条」并列入新 key |
| F9 工作记录 T-6 范围 | **closed** | `docs/worklog/2026-10-20-running-task-highlight.md:180-181`（T-6=独立审查 + 新增 T-7 行）与 `:270` 起的「T-7 补测与审查闭环」节 |
| 设计 §9.2 | **已同步** | C 表 `:449-452`（C11–C14）、D 表 `:465-469`（M8–M12）与测试实现一致 |
| F10–F13 | **仍 known / accepted** | 与 §14.3 一致，无新证据改变定性 |

### 15.4 残余问题（本次新发现，均 nit，不阻塞）

- **R1（nit）C12 的禁止键集合未覆盖 `border` / `filter` / `textShadow`**：我在副本中给行根 style 加 `border: '1px solid #4176e6'` + `filter: 'drop-shadow(…)'` + `textShadow`（整行描边 / 整行发光，语义上仍属 AC8「不整行着色」）→ `28/28` 绿。建议把这三项并入 `test/sidebar-wiring.test.mjs:1214` 的键列表（一行改动）。
- **R2（nit）C14 的顺序断言可被「删首拉 + 把 `onFocus` 前移」绕过**：副本内同时做这两步 → `28/28` 绿（`onFocus` 内的 `reload()` 反而成了最早的 `reload` 调用）。实际影响低（首拉仍由 220 ms 防抖 effect 兜底），但该断言不是无条件强锁；若加固，可要求「无参 `reload()` 是 effect 体的**第一条语句**」。
- **R3（提醒，非缺陷）**：C11/C13 只认 `runningHighlight` 标识符（helper 注释已声明「宁可误报也不漏报」）。若未来内联判据或改名会**误报**而非漏报 —— 方向正确，无需改。

### 15.5 范围、残留状态与 §1–§14 的关系

- 本节**只追加**，未改动 §1–§14 任何内容；§14（由 T-7 追加）的「F1–F9 closed / F10–F13 accepted」经我复核与实测一致。
- 主仓库只读：未改 `src/`、`test/`、既有 `docs/` 内容（本节除外）、未 build、未重启、未提交、未清理工作区；`/tmp/t7-check-*` 副本已删除。
- **唯一仍未闭环项：AC13 视觉 / 真实像素 / 端到端时延**（§12 声明继续有效）。T-7 只补了测试锁，不改变「视觉未验证」的事实；交付前仍须 `npm run build` → 完全重启 DSH Desktop → 按设计 §11 人工十步。

### 15.6 需要父代理决定

1. **R1 / R2 是否现在补**（各一行断言级改动，需重开 `test/` 写权限），还是记入 backlog。
2. **AC13 视觉验收排期与执行人** —— 这是当前唯一阻断「交付完成」的事项。
3. **结论维持**：我的复核意见是**维持「有条件通过」**（条件②③已闭环，条件①视觉验收仍开放）。

### 14.5 T-6 复核补记（R1 / R2）

T-6 在 §14.1–§14.4 之后提出的两个非阻塞 nit **已按建议补锁**（同样**未改功能源码**）：

- **R1 已补**：C12 的整行着色禁止键从 8 类扩为 **11 类**（新增 `border` / `filter` / `textShadow`，
  确保「整行描边 / 发光」也被判红）；测试 `test/sidebar-wiring.test.mjs:1204`，设计 §9.2 C12 同步。
- **R2 已补**：C14 追加「effect 体**第一条语句**必须是无参 `reload()`」，保留原顺序断言，
  堵住「删首拉 + 把 `onFocus` 前移」的绕过写法；测试 `test/sidebar-wiring.test.mjs:1278`，设计 §9.2 C14 同步。

实测：`node --test test/sidebar-wiring.test.mjs` = 28/28 绿；`npm test` = 461/461 绿；
`/tmp` 副本两个绕过变异各 fail 1（加 `border` ⇒ C12 红；删首拉 + `onFocus` 前移 ⇒ C14 红），副本已删。
§1–§13 的原始审查结论与 §14.1–§14.4 的处理结论**均不变**；AC13 视觉仍未验证。

---

## 16. T-6 终核（R1/R2 后）

- **终核时间**：2026-10-20 13:55–13:58（约 3 分钟，在 5 分钟估时 / 10 分钟硬上限内）
- **终核性质**：原审查者对 R1/R2 补锁的**最后一次**独立复核；**不采信自报**，全部重跑 / 重放
- **终核结论**：**R1/R2 补锁有效，两个绕过变异各只红对应用例；功能源码零改动；除 AC13 视觉外无未闭环项。** 我此前 §15.4 的两个 nit **已 closed**，本次终核**未发现新的功能性或测试性缺陷**（仅 1 条文档顺序 nit，见 §16.4）。

### 16.1 实跑证据（主仓库只读）

| 检查 | 命令 / 依据 | 结果 |
|---|---|---|
| 定向套件 | `node --test test/sidebar-wiring.test.mjs` | `tests 28 / pass 28 / fail 0`（C1–C14 全绿） |
| 全量回归 | `node --test` | `tests 461 / pass 461 / fail 0 / cancelled 0` |
| C12 加固内容 | 读 `test/sidebar-wiring.test.mjs:1204-1237` | 禁止键 **11 类**：`background`/`backgroundColor`/`backgroundImage`/`borderLeft`/`borderColor`/**`border`**/`boxShadow`/**`textShadow`**/**`filter`**/`color`/`outline`；另含 `StatusDot` / `role="status"` 两条 |
| C14 加固内容 | 读 `test/sidebar-wiring.test.mjs:1278-1352` | 新增「effect 体**第一条语句**必须是无参 `reload()`」+ 保留「早于 `setInterval`」顺序断言 |
| 功能源码未变 | mtime + `git diff --numstat` | `src/sidebar.tsx` 仍 `128/142`、`src/tree-model.ts` 仍 `49/0`、`test/tree-model.test.mjs` 仍 `269/0`；三个功能文件 mtime 仍 13:10–13:12（本轮补锁只动 `test/sidebar-wiring.test.mjs` → `565/0`，+25 行） |
| 文档同步 | `grep` | 设计 §9.2 C12 `:450`（11 类）/ C14 `:452`（第一条语句）已与实现一致；工作记录 `:373-398`「R1/R2 复核补记」；本报告 §14.5 |

### 16.2 两个绕过变异独立复现（`/tmp` 副本，主仓库只读；副本已 `rm -rf`）

基线：副本内 `node --test test/sidebar-wiring.test.mjs` = `28/28` 绿。

| 绕过变异（T-6 §15.4 曾实测「全绿」） | 施加 | 终核结果 | 判定 |
|---|---|---|---|
| **R1** 行根加 `border` + `filter` + `textShadow`（整行描边 / 发光） | 行根 style 追加三键 | `27/28`，**仅 C12 红** | **已锁死** |
| **R2** 删首拉 + 把 `onFocus` 定义前移到 `setInterval` 之前 | 删除 `reload()` 且上移 `onFocus` | `27/28`，**仅 C14 红** | **已锁死** |

两例均**只红对应用例**，未波及 C1–C11/C13 或既有 24 条断言 ⇒ 断言定位准确、无交叉误伤。

### 16.3 残余与注意事项

1. **唯一未闭环项：AC13 视觉 / 真实像素 / 端到端时延**（§12 声明继续有效）。本轮只加测试锁，不改变「视觉未验证」；仍须 `npm run build` → 完全重启 DSH Desktop → 设计 §11 人工十步。
2. **加固方向是「保守误报」**：若将来把 mount effect 拆成两个 effect（首拉独立）或把判据内联/改名，C14/C11/C13 会红而行为可能正确 —— 属设计已声明的「宁可误报」，需人工确认，不是缺陷。
3. **本轮未验证 build 本身**（禁止 rebuild 主仓库）：`lib` mtime 13:53 晚于测试文件 13:52，且我的只读 `node --test` 461/461 通过；但「`npm run build` 是否仍 exit 0」由 T-7 自报，我**未独立执行**（写 `lib/` 超出本任务范围）。
4. **文档顺序 nit（新发现，仅可读性）**：§14.5 被追加在 §15 之后，编号顺序倒置（14.5 → 15 → 16）。内容经复核**与实现一致**；建议后续整理时把 §14.5 移到 §14.4 之前（**不改内容**）。父代理可决定是否处理。

### 16.4 终核判定

| 维度 | 判定 |
|---|---|
| F1–F5 测试锁（C11–C14 + 词条用例） | **未发现缺陷**（5/5 变异可判红） |
| R1/R2 加固 | **已闭环**（两个绕过变异各只红对应用例） |
| F6–F9 文档闭环 | **未发现缺陷** |
| F10–F13 | **known / accepted（不变）** |
| 功能行为 / 旧 Q1 / 刷新链路 | **未发现缺陷**（与 §1–§13 结论一致） |
| AC13 视觉 | **未验证（唯一开放项）** |
| 整体结论 | **维持「有条件通过」**；阻断项只剩 AC13 人工视觉验收 |

### 16.5 范围与残留状态

- 本节**只追加**，未改动 §1–§15 任何内容（含 T-7 追加的 §14.5）。
- 主仓库只读：未改 `src/`、`test/`、既有 `docs/` 内容（本节除外）；**未 rebuild**、未重启、未提交、未清理工作区。
- `/tmp/t6-final-*` 副本已删除；`git status` 仍为 27 项（仅本报告内容增长）。

## 17. 追加需求（flat 聚合）审查（2026-10-20）

- **任务**：T-10 独立审查（只读源码 / 测试 / 文档；只追加本节 + 检查点）
- **对象**：T-8 的「project 聚合 flat/普通会话」改动（`src/tree-model.ts`、`test/tree-model.test.mjs` A7/A15）与 T-9 的验证报告（[testing §11](../testing/2026-10-20-running-task-highlight-verification.md)）
- **重要前提**：**§1–§16 是「2026-10-20 追加需求」之前的事实**。其中 §3 的 AC4 行「不聚合 history / flat / 未分组」与 A7「flat 不参与」已被 T-8 追加裁决**覆盖**，不再代表现行契约；现行口径以 requirements §2.2 / design §3.3 / INTERFACES §2.2.1 / PRD RT7 为准。
- **结论**：**有条件通过**。未发现 P0 / P1 功能缺陷；行为、计数与 5 份现行文档一致。存在 **1 个 P2 测试缺口**（A15 未锁计数/不渲染，已独立复现「变异全绿」）、**1 个 P2 历史文档反向表述**（research §349），另有 1 个 P3 证据误差（T-9 numstat）与 4 个 nit（含 worklog 历史行）。**条件** = 补 A15 计数断言 + 处理 research 误导；AC13 视觉仍未验证。

### 17.1 只读复跑与独立实验（均由本节作者执行）

| 检查 | 命令 / 方式 | 结果 |
|---|---|---|
| 构建 | `npm run build` | exit 0（**会重写 gitignored 的 `lib/`**，属生成物；`src/`、`test/`、`docs/` 未改） |
| 类型 | `npm run typecheck` | exit 0 |
| 定向 | `node --test test/tree-model.test.mjs` | `tests 264 / pass 264 / fail 0` |
| 全量 | `node --test` | `tests 462 / pass 462 / fail 0 / cancelled 0` |
| 独立反例 | `/tmp/t10-adversarial.mjs`（只读 import `lib/tree-model.js`，10 组输入：R1–R5、R6a/R6b、R7–R9） | 结果见 §17.3 / §17.4 |
| 独立变异 | `/tmp/t10-mut-*` 副本（rsync 排除 `.git`/`node_modules`/`lib` + 软链 `node_modules`，副本已 `rm -rf`） | 基线 264/264；**M-FLAT-2b 264/264 全绿**，同形输入计数 `1/0 → 2/1`（见 F17-1） |
| 范围事实 | `git diff --numstat` | `src/tree-model.ts 73/3`、`test/tree-model.test.mjs 308/0`；工作区 27 项与 T-9 一致 |

> 说明：`npm run build` 是复跑测试的前置（测试直接 import `lib/`）；`lib/` 在 `.gitignore` 中，非业务源文件。本任务**未**改 `src/`、`test/`、其它 `docs/`、配置，未提交、未切分支、未重启 DSH。

### 17.2 需求覆盖矩阵（追加需求 → 实现 → 证据）

| 追加需求点 | 判定 | 实现证据（文件:行号） | 测试 / 实测证据 |
|---|---|---|---|
| 所有 workspace（含非 git）都聚合本 workspace 的 flat 会话 | **通过** | `src/tree-model.ts:2325-2331`（为所有项目建 flat 容器）、`:2375-2377`（判定 OR） | A7 `test/tree-model.test.mjs:1840-1867`；反例 R2 |
| 无 worktree 的 workspace 有任务在跑 ⇒ 文件夹亮 | **通过** | 同上；非 git 的 `containers.flat` 恒存在（`:1737-1747`） | A7；`worktreeCount===0` / 无 worktree 行前置断言 |
| git workspace 有 worktree 且全空闲、flat 在跑 ⇒ project 亮 | **通过（契约形状守卫）** | `:2325-2331`（`project.flatSessions` 合成等价容器） | A15 `:1869-1896`；反例 R2（`hr=true`） |
| worktree 行判定**不变** | **通过** | `:2396` 仍只读 `entry.result.hasRunningTasks`；`emitContainer` `:1955-1959` 未改 | A15 断言 worktree `false`；A1/A4/A5 原样通过 |
| history 桶 / 未分组仍排除 | **通过** | 判定不含 `historyResult`（`:2351-2357` 只含 worktree/flat）；未分组显式常量 `false`（`:2443`） | A6 `:1813-1838`、A8 `:1898-1904`；反例 R3 |
| `runningCount` 的 Q1 口径未动 | **通过** | `runningCount` 仍 `heads.filter(s => s.running===true)`（`:1949`），project 由 `:2371` 求和；未改成新字段别名 | 旧回归锁 `test/tree-model.test.mjs:1677` 通过；反例 R3（`2`） |
| git 的 flat **不渲染、不计入** `sessionCount/runningCount/pendingCount` | **行为通过，测试未锁** ⚠️ | `rendersFlat = containers.flat !== undefined`（`:2333`）、`allResults` 门控（`:2355`）、渲染门控（`:2404`） | 反例 R2 实测 `1/0/0`；**M-FLAT-2b 全绿**（F17-1） |
| 空 `flatSessions` / 无会话安全 | **通过** | `emitContainer` 空 `heads` ⇒ 全 0/false（`:1946-1961`） | 既有 git 项目（flat 空）全部用例；反例 R5/R6a |
| 折叠 / 5 条截断 / 搜索不影响判定 | **通过** | 判定用截断前 `heads`；搜索无容器行 | 反例 R7（第 6 条在跑仍亮）、R8（折叠仍亮）、R9（搜索只产 session 行） |

**AC / RT7 映射核对**：AC3（`docs/requirements/2026-10-20-running-task-highlight.md:108`）与 AC4（`:109`）已改为「worktree **OR** 本 workspace flat；history/未分组排除」；AC12（`:117`）把 flat 聚合列入目标内、并保留搜索/轨道态等非目标；AC13（`:118`）把「普通/flat 会话在任意 workspace 都亮」列入人工项；PRD RT7（`docs/PRD.md:706`）与 design §4（`:184-185`）、INTERFACES §2.2.1 边界表（`:962-963`）逐项对应。**映射完整，未发现缺项**；唯一例外是 AC13 的视觉部分仍未执行（§17.7）。

### 17.3 发现清单

#### P0（阻断）：无

#### P1（高）：无

#### F17-1（P2，测试缺口，**独立复现**）：A15 只锁「亮」，没锁「不计数 / 不渲染」

- **事实**：A15（`test/tree-model.test.mjs:1869-1896`）构造「git + 1 个空闲 worktree + `flatSessions` 有 running」后，只断言 `worktree.hasRunningTasks === false` 与 `project.hasRunningTasks === true`，**没有**断言 `project.sessionCount / runningCount / pendingCount`，也没有断言 flat 会话零渲染。
- **独立复现**（不采信 T-9 结论，自己造变异）：在 `/tmp` 副本把 `src/tree-model.ts:2355` 的 `...(rendersFlat ? [flatResult] : [])` 改为 `flatResult,`（只污染计数、不渲染）⇒ 重建后 `node --test test/tree-model.test.mjs` = **264/264 全绿**；同一形状（`/tmp` 脚本 R2）的 project 计数从 `sessionCount=1 / runningCount=0` 变为 `sessionCount=2 / runningCount=1`；R1（worktrees 空）从 `0/0` 变为 `1/1`。即 **A15 的「flat 不计入」承诺没有任何测试锁**。
- **与 T-9 的差异**：T-9 用 2 条 flat 得到 `1→3`；我用 1 条得到 `1→2`。夹具不同，缺口结论一致。
- **判定：需要补测**（这是本节的明确结论，不是「可选」）。理由：A15 已经专门构造了该形状并锁了契约的一半（亮），剩下的一半是 design §3.3 / INTERFACES §2.2.1 明写的「不渲染、不计入 `sessionCount`」；补 3–4 行断言即可，且是唯一能在数据模型变化时防止计数回归的锁。
- **建议断言**（加在 A15 内，不改既有断言）：
  ```js
  assert.equal(projectRow.sessionCount, 1, 'git flat 不计入 project.sessionCount')
  assert.equal(projectRow.runningCount, 0, 'git flat 不计入 runningCount（Q1 口径）')
  assert.equal(projectRow.pendingCount, 0)
  assert.equal(rows.some((r) => r.kind === 'session' && r.sessionId === 'f-flat'), false, 'git flat 不渲染')
  ```
- **注意**：不要通过把 A15 的 `flatSessions` 改成空数组来「消除缺口」——那会同时删掉 git 合成容器分支的唯一覆盖。

#### F17-2（P2，文档）：research 的现行反向表述且把 flat 与 ungrouped 混为一谈

- `docs/research/2026-10-20-host-capability-verification.md:349` 写「在**非 git 平铺会话**（ungrouped）里跑任务，project 文件夹**不应**亮（用户已拍板"文件夹只聚合 worktree 子项"）」。这里有两层问题：①「只聚合 worktree 子项」已被 T-8 追加裁决覆盖；②把「非 git 平铺会话」直接等同于 `ungrouped` 与现行实现**方向相反**——非 git flat 会话现在**会**让 project 亮，只有 `ungrouped` 不亮。
- `:417` 同样沿用「文件夹只聚合 worktree 子项」。
- 该文件是历史调研快照，按要求不属 T-8 的 4 份现行文档；但**读者（尤其按它执行人工验收的人）会误读为现行**，且它自身没有「已被 T-8 覆盖」的标注。**建议**：文首加一行「历史快照：聚合口径已于 2026-10-20 被 T-8 / RT7 覆盖，见 requirements §2.2」；正文不改（T-10 无写入权，交父代理决定）。

#### F17-3（P3，证据误差）：T-9 的 `src/tree-model.ts 76/0` 与实测不符

- T-9 §11.1 表写 `src/tree-model.ts` 由 `49/0` 变 `76/0`（「T-8 增量 +27」）。当前磁盘实测：`git diff --numstat src/tree-model.ts` = **`73 3`**。3 行删除正是 T-8 对 `flatResult` 三处的替换（`:2332`、`:2355`、`:2404` 对应的旧行），所以 T-8 实际增量是 **+24 / −3**，不是 +27 / 0。
- 排除「T-9 之后又被改」：`stat` 显示 `src/tree-model.ts` mtime = `14:24:57`，早于 T-9 的执行窗口（14:30 起）；`test/tree-model.test.mjs` = `14:24:28`（`308/0`，与 T-9 一致）。
- 影响：**不影响 T-9 的结论**（T-8 仍只改 tree-model + 测试；总数 `1458/152` 与 T-9 一致，仅按文件拆分错误）。但这是 T-9 报告中的事实性误差，记录以便后续引用时校正。

#### F17-4（nit）：文档说「该 workspace 的 flat 容器」，git 项目实现上是 project（repo）级 `flatSessions`

- `src/tree-model.ts:2325-2331` 对 git 项目取的是 `project.flatSessions`；一个 git project（repo）可承载多个 workspace（`src/projects.ts:344-354` 的子目录工作区归属）。
- 真实数据不可观察：git 项目的 `flatSessions` 恒为空（`src/projects.ts:206-214` 只有非 git 才返回 `flat`；`:423-431`），因此「workspace 级」与「project 级」的差异只存在于 A15 这类契约形状。
- 建议（低优先）：requirements RT2 / §2.2、PRD RT7、INTERFACES §2.2.1 的「该 workspace」补一句「非 git 时 project == workspace；git 项目的等价容器是 project 级形状守卫」。当前表述不构成行为矛盾，**P3/nit**。

#### F17-5（nit，独立反例）：git 扫描降级 + flat 在跑 ⇒「幽灵高亮」

- 反例 R1：`isGit:true`、`worktrees:[]`（设计允许的降级形状，既有用例 `test/tree-model.test.mjs:717-742` 锁定「不崩、不吞 flatSessions」）、`flatSessions:[running]` ⇒ 实测 `project.hasRunningTasks = true`，但 `sessionCount=0`、行序列只有 project 一行，**没有任何运行中的可见会话**。
- 判定：字面符合「所有 workspace 聚合 flat」，且该形状在真实数据里不可达（git flat 恒空；`worktrees` 为空只在扫描降级时出现）。**不是缺陷**，但 design §4 边界表没有这一行。建议补一行「git + worktrees 为空 + flat 有值 ⇒ 仅形状守卫，真实数据不可达」，避免未来数据模型变化时把它当 bug。

#### F17-6（nit）：合成容器的键复用与「未来缓存」风险

- 合成 flat 容器复用 `containers.projectKey`（`src/tree-model.ts:2326`）。当前 `emitContainer`（`:1866-1962`）是纯函数：只读 `spec`/`context`，`applyManualOrder` / `truncateSessions` / `sortedByRecency` 都返回新数组，无按键缓存、无副作用 ⇒ 无碰撞。若将来给 `emitContainer` 加按键缓存/索引，需重新评估（T-9 已提，我复核属实）。

#### F17-7（nit，worklog）：历史 RT2 行仍是旧口径，但 T-8 节本身如实

- `docs/worklog/2026-10-20-running-task-highlight.md:54` 的 RT2 行仍写「文件夹只聚合 worktree 子项；不含未分组/flat」，与现行契约相反。它位于**按时间记录**的决策表，同文件 T-8 节（`:402` 起，§1 用户新裁决 / §2 落地取舍 / §3 TDD 证据）已明确声明覆盖 ⇒ **可接受**，不构成「现行文档矛盾」。
- **T-8 自报核实**：A7 反转、A15 新增、`264/264`、`462/462`、`typecheck` / `build` 全绿经我独立复跑**属实**；`:431-470` 的 Green / 全量证据与当前磁盘一致。其 **Red 阶段（262/2）我未独立复现**（不采信也不否定；当前实现下该用例只能通过）。
- 建议（低优先）：在 `:54` 行尾加「（已被 T-8 §402 起覆盖）」提升可检索性；T-10 无写入权，交父代理决定。

### 17.4 回归 / 漏测（已守护 vs 仍缺）

**已守护**：A7/A15（flat 高亮）、`:717-742`（git flat 不渲染）、A6/A8（history / ungrouped 排除）、`:1677`（Q1）、A1–A13（worktree 判定、折叠、截断、归档、blank、子代理同源）。

**缺口（按风险排序）**：

| # | 缺口 | 是否必须补 | 依据 |
|---|---|---|---|
| 1 | **A15 计数/不渲染断言**（F17-1） | **必须**（P2） | 唯一覆盖 git 合成容器的用例；变异 264/264 全绿 |
| 2 | 非 git「flat 仅子代理在跑」⇒ project true 且 `runningCount===0` | 可选（低） | 反例 R4 实测 `hr=true / rc=0`；与 worktree 共用 `emitContainer`，A2 已锁同源，但「所有 workspace」缺少一条直测 |
| 3 | 非 git「flat + history + ungrouped 同时」组合 | 可选（低） | 反例 R3 实测：project `true`（来自 flat）、history 行无字段、ungrouped `false`；A6/A8 已分项守护 |
| 4 | project 折叠 + flat 在跑仍亮 | 可选（低） | 反例 R8 实测 `true`；A9 只覆盖 worktree 折叠 |
| 5 | flat 第 6 条（被 5 条截断）在跑仍亮 | 可选（低） | 反例 R7 实测 `true`；A10 只覆盖 worktree 截断 |

我对「必须补」的判定只给第 1 项：它锁的是文档明写的「不计入」承诺，且用例已存在；2–5 是结构性同源（同一 `emitContainer` / 同一可见性谓词），补测收益低于维护成本。

### 17.5 对 T-9 的复核意见

- **结论方向一致**：T-8 追加需求已落地、git flat 的计数行为正确、计数无测试锁。我用**不同夹具**独立复现了计数缺口（§17.3 F17-1），不是复述。
- **行号核对**：T-9 §11.3 引用的 `src/tree-model.ts:2325-2331`、`:2333`、`:2375-2377`、`:2396`、`:2404` 与 `test/tree-model.test.mjs:1840-1867`、`:1869-1896` 均与当前磁盘逐条一致。
- **需要修正**：①§11.1 的 `76/0` 应为 `73/3`（F17-3）；②§11.6 对 research 的评价偏轻——`:349` 不只是「只聚合 worktree」的旧口径，还把非 git flat 与 ungrouped 混同，方向与现行实现相反（F17-2）。
- **T-9 未覆盖但本次实测正确的场景**：R4 / R7 / R8（§17.4 第 2/4/5 行）；R1（幽灵高亮边界）。
- **未复核项**：T-9 §11.5 的 M-FLAT-1、M-FLAT-2a 我**未重跑**（只复现了 2b；1 由 A7/A15 锁定、2a 由 `:717-742` 锁定，风险低，成本收益不划算）。T-9 的 `typecheck` / `462/462` 我独立复跑一致。

### 17.6 需要父代理决定

1. **是否派工补 A15 的计数/不渲染断言**（推荐：**是**；P2、≤5 行，见 F17-1 的建议断言）。
2. **是否允许新任务给 research `:349`/`:417` 加「已被 T-8 / RT7 覆盖」标注**（推荐：是；T-10 的写入范围仅本报告，不能改）。
3. **是否把 F17-5 的幽灵高亮记为 known/accepted**，并在 design §4 补一行不可达说明（推荐：接受）。
4. **AC13 视觉验收是否安排**：需 `npm run build` + 重启 DSH Desktop 后人工执行设计 §11（本任务未重启、未截图、未抓 DOM）。

### 17.7 视觉未验证声明

- 本任务**未执行**：重启 DSH Desktop、刷新/打开 GUI、截图、抓 DOM、真实像素与端到端时延测量；**未对** `http://127.0.0.1:43120` 发起任何请求（不声称 403 / 可访问性等结果）。
- 本节所有结论只覆盖：纯逻辑行为（`node --test` + `/tmp` 反例）、源码接线事实、测试判别力、文档一致性。**任何「图标是否亮、颜色是否正确」的判断均未验证。**
- **「无 worktree workspace 的文件夹高亮」不能在纯逻辑层确认**：`buildRows` 在 **client bundle** 内（`src/sidebar.tsx:44-54` 导入、`:2887` 调用；`scripts/build-client.mjs:9` 的 entry 是 `src/client.tsx`），新逻辑需重建 `lib/client.js` 并被浏览器加载；旧文档「必须重启 DSH Desktop」的前提与源码事实不符，最小步骤与更正见 **§17.8**。
- 设计 §11 **第 5 步已覆盖**该场景（「在**任何** workspace（含 git 项目）的普通/flat 会话里跑任务 ⇒ 对应 project 文件夹亮」），只是没有单列「无 worktree 的 workspace」；执行第 5 步时额外挑一个非 git 工作区即可，无需新增步骤。

### 17.8 更正：「必须重启 host 才生效」不准确（补核）

> 父代理指出：§17.7 / 旧文档（PRD §12.4、design §11、testing §8）说 `hasRunningTasks` 由宿主
> `lib/tree-model.js` 产出、必须重启 DSH Desktop，与 §17.7 的「client bundle」判断矛盾。本节按源码事实核实。

**① `POST /dsh-worktree-groups/tree` 返回的是原始数据，不是行**

- handler 只做 `const payload = await buildTreePayload(ctx); json(res, 200, payload)`：`src/routes.ts:1391-1400`。
- 响应体类型 `TreePayload = { ok, projects, ungrouped, archivedSessionIds, workspaceByPath }`：`src/routes.ts:820-827`；实际返回 `src/routes.ts:898-905`。
- **没有 `rows` / `RenderRow` / `hasRunningTasks`**；`projects` 是 `buildProjects()` 的原始节点（`worktrees[*].sessions` / `history` / `flatSessions`）。⇒ 宿主不计算高亮判定。

**② `buildRows` 的调用方只有浏览器端（测试除外）**

- `grep -rn "buildRows" src/` ⇒ 仅 `src/sidebar.tsx:44`（import）与 `:2826-2887`（组装 input 并调用），其中 `:2887` 是唯一调用点。
- `src/index.ts` 只 `import { registerRoutes } from './routes.js'`（`:22`）；`src/routes.ts` 只 import `buildProjects` / `collectUngrouped`（`:34`、`:889`），**从不 import `tree-model.ts`**。
- 结论：`buildRows` 只随 `src/client.tsx` 被 esbuild 打进 `lib/client.js` 在浏览器执行；`lib/tree-model.js` 是 tsc 产物，供 `node --test` 与包导出使用，宿主路由不消费它。

**③ flat 聚合的真实生效路径**

- 实测产物：`grep -c hasRunningTasks lib/client.js` = **6**，其中 `lib/client.js:1120` 就是 `worktreeResults.some(...) || flatResult.hasRunningTasks === true`；`lib/tree-model.js` 亦含 6 处（同一份逻辑的另一产物）。
- 所以 **T-8 改的是客户端 bundle，不是宿主模块**。最小步骤：
  1. `npm run build`（`package.json`：`tsc` + `node scripts/build-client.mjs` + `node scripts/clean-jsx.mjs`；只改客户端逻辑时 `npm run build:client` 已足够重建 `lib/client.js`）；
  2. **重新加载侧栏页面**（浏览器重新取 `lib/client.js`）。
- **不需要**为本改动重启 DSH Desktop 的宿主模块：本次未改 `src/index.ts` / `src/routes.ts` / `src/projects.ts`。PRD 自身也写过「客户端 JS 迭代只需刷页」（`docs/PRD.md:539`）。
- **旧说法不准确**：PRD `docs/PRD.md:730`「`hasRunningTasks` 由宿主半边产出（`lib/tree-model.js` → `POST /tree`）」、design `docs/design/2026-10-20-running-task-highlight.md:543`「`npm run build`（含 host 产物）→ 重启 DSH Desktop（否则字段不存在）」、testing `docs/testing/2026-10-20-running-task-highlight-verification.md:340`「完全退出并重启」均把客户端推导误记为宿主产物；**「必须重启」只在首次安装 / 新增 bundle 注册（`docs/PRD.md:668`）时成立**，不适用于本次已安装 bundle 的 JS 迭代。
- **未验证的边界**：DSH / 浏览器对 `lib/client.js` 的缓存策略、运行实例是否会自动热替换该文件；本任务未刷新、未重启、未抓网络。若页面刷新后仍是旧行为，再用「重启 DSH Desktop」兜底（成本高、终结会话），但**不能据此反推逻辑在宿主**。

**对用户的最小操作建议**（按证据排序）：`npm run build` → 重新加载页面（普通刷新；无效再硬刷新）→ 按设计 §11 第 5 步人工确认（同时挑一个**非 git 工作区**和一个 **git 工作区**，后者只可能通过「worktree 在跑」变亮）。仅当刷新无效或处于首次安装场景才需要重启 DSH Desktop。

## 18. T-10 终核（T-11 后）（2026-10-20）

- **任务**：对 T-11（A15 补锁 + 文档更正）做**最终独立复核**，不采信自报
- **结论**：**维持「有条件通过」，条件项已关闭**。F17-1 / F17-2 / F17-3 已闭环；F17-4 / F17-5 已按 known/nit 登记；**唯一开放项 = AC13 视觉验收**（本任务未刷新/未重启/未截图）。

### 18.1 只读复跑与 M13 独立复现

| 检查 | 命令 / 方式 | 结果 |
|---|---|---|
| 定向 | `node --test test/tree-model.test.mjs` | exit 0；`tests 264 / pass 264 / fail 0` |
| 全量 | `node --test` | exit 0；`tests 462 / pass 462 / fail 0` |
| 构建产物新鲜度 | `stat` | `lib/tree-model.js` / `lib/client.js` = 14:59:03，晚于 `src/tree-model.ts` 14:24:57 与 `test` 14:54:22 |
| M13 基线 | `/tmp` 副本 `npx tsc` 后定向跑 | 264/264 |
| **M13 变异** | 复制 `src/tree-model.ts:2355` 的 `...(rendersFlat ? [flatResult] : [])` → `flatResult`（只污染计数） | **263/264，唯一红 = A15**；`AssertionError: git flat 不计入 project.sessionCount（只数 worktree 的 1 条）` |
| M13 计数探针 | 同一 A15 形状只读 import 变异 `lib/tree-model.js` | `sessionCount=2 / runningCount=1 / pendingCount=0 / flat 渲染=false`（干净 lib 为 `1/0/0/false`） |

**A15 补锁核对**（`test/tree-model.test.mjs:1896-1908`）：4 条断言齐全（`sessionCount===1`、`runningCount===0`、`pendingCount===0`、`f-flat` 零渲染），且**既有断言未改**。**F17-1 关闭**。

### 18.2 范围核对（只 test + docs）

- `src/tree-model.ts`：`git diff --numstat` = **`73 3`**（与 T-10 复审一致）、mtime **14:24:57**（未变）；`src/sidebar.tsx` 13:12:58、`src/index.ts` 11:02:11、`src/routes.ts` 13:03:47 —— **功能源码零改动**。
- `test/tree-model.test.mjs`：`320/0`（T-11 前 `308/0`，+12 行 = 4 条断言 + 注释）；`docs/PRD.md 66/0`、`docs/INTERFACES.md 195/1`、测试/设计/需求等同步；`git status` 仍 27 项。
- `/tmp/t11-final-*` 副本用后已 `rm -rf`；本任务未改 `src/`、`test/`、其它 `docs/`。

### 18.3 文档更正核对

- **生效路径**：PRD §12.4（`:732-740`）、requirements §5（`:150-153`）与 AC13（`:121`）、design §11 前提（`:546-550`）+ TOC/F10（`:45`、`:519-521`）、testing §12.4 均为「`npm run build`（或 `build:client`）+ 刷新页面；仅首次安装/新增 bundle 或宿主代码改动才重启」——**表述一致**。
- **F17-2 关闭**：research 文首已有「历史快照（T-11 补注）」覆盖声明（`:5-6`），明确 §8 第 5 步 / §11 第 2 条被 T-8 / RT7 覆盖；正文未改。
- **F17-3 关闭**：testing §12.3 明确更正 `73/3`（非 `76/0`），且不改 §11.1 历史正文。
- **F17-4/F17-5 处理**：requirements §2.2 第 5 条补「非 git 时 `project == workspace`；git 的等价容器是 project 级形状守卫」（`:94-96`）；design §4 新增「git + worktrees 为空 + flat 有值 ⇒ 只判定/不渲染/不计数（known，不可达）」行（`:186`）。
- **F17-7**：worklog `:54` 历史行仍未加覆盖标记，但 T-11 节（`:506` 起）已记录全部处理；维持「可接受」。
- **两处 nit（非阻塞）**：① PRD §12.4 / design F10 引 `src/routes.ts:820-825`、`:1386-1393`，精确范围应为 `820-827`（`TreePayload` 到 `workspaceByPath`）与 `1391-1400`（handler 体）——**内容结论正确**，仅行号范围偏窄；② T-11 自报「INTERFACES 已更正」，实际 INTERFACES 的本次改动是 F17-4 术语（`:951-953`），**没有**生效路径/重启表述（既无旧错也无新更正）——不构成矛盾，但自报措辞略宽。

### 18.4 发现状态总表

| 发现 | T-11 后状态 | 依据 |
|---|---|---|
| F17-1 A15 计数/渲染缺口（P2） | **closed** | A15 4 条断言 + M13 唯一红（§18.1） |
| F17-2 research 反向表述（P2） | **closed** | research 文首覆盖声明 |
| F17-3 T-9 numstat 误报（P3） | **closed** | testing §12.3 登记 73/3 |
| F17-4 workspace/project 措辞（nit） | **closed（文档已补边界）** | requirements §2.2-5 |
| F17-5 git 降级幽灵高亮（nit） | **known / accepted**（design §4 已登记，不修行为） | design §4 新行 |
| F17-6 键复用/未来缓存（nit） | **known**（无当前影响） | 代码事实未变 |
| F17-7 worklog 历史行（nit） | **accepted** | T-11 节已记录 |

**唯一开放项：AC13 人工视觉验收**（重建 client bundle + 刷新页面；亮起/熄灭 ≤1 s、折叠仍亮、子代理一致、任意 workspace 的 flat 亮、history/未分组不误亮、暗色可辨、无渲染错误）。本任务**未**执行该人工步骤，不声称任何像素级结论。

### 18.5 残留状态

- 本节只追加于报告末尾，未改 §1–§17 正文、未改源码/测试。
- `/tmp/t11-final-*` 已删除；`lib/` 为 T-11 构建产物（gitignored）；`git status` 仍 27 项。
- 耗时：约 12 分钟（15:00→15:12），一次 M13 复现即命中，无返工、无阻塞。
