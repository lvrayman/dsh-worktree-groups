# 独立复审报告：T14b 最终验证

- 任务 ID：T14b（独立复审，默认只读；唯一写入本文件）
- 复审对象：`dsh-worktree-groups` 工作树 HEAD `11b1144` + 未提交改动（T11 实现 / T13 收尾）
- 复审时间：本轮会话
- 复审模型：provider=deepseek-official，model=anthropic/v_model/deepseek-v4-flash，effort=high
- 语义基准：用户终裁（顶部区=仅 running 会话，固定最前、不可拖动、仍接受落点；已结束会话不置顶、位置完全由持久拖拽顺序决定；D12「当前会话保底进前 5」已删除）

> 本报告分节增量写入。证据类型标注：`审查真实代码` / `驱动真实导出` / `复刻版` / `推断`。

---

## ① 方法与证据类型

**工作目录**：`/Users/dev/Documents/Project/AnyWork/dsh-worktree-groups`（只读）。
**基线**：HEAD `11b114411307008c765e60ee62a8f791441630be`（`feat(worktree-groups): 侧栏三层拖拽排序`），工作树有未提交改动（T11/T13）：`src/tree-model.ts`、`src/sidebar.tsx`、`test/tree-model.test.mjs`、`docs/PRD.md`、`docs/INTERFACES.md`、`README.md` 修改；`test/sidebar-wiring.test.mjs`、`test/mutation-t11.md`、若干 `docs/REVIEW-*.md` 新增。本轮复审针对**工作树当前内容**（= 待验收内容），非 HEAD。

**证据类型约定**（全文严格执行）：

| 标注 | 含义 |
|---|---|
| `审查真实代码` | 直接读仓库真实文件（`src/**`、`test/**`、`docs/**`、`lib/**`），并给出 file:line |
| `驱动真实导出` | `import` 仓库真实 `lib/*.js`（由 `tsc`/esbuild 从真实 `src/**` 构建）并调用其真实导出函数 |
| `复刻版` | 我自建的等价模型（本轮**仅在变异注入副本**上使用，且均以「真实导出的字节级补丁」方式注入，非重写） |
| `推断` | 无直接实测、由其他证据推理得出（全文仅 1 处，已显式标注） |

**关键方法论**：所有「位置/顺序」结论**只**以 `buildRows`（渲染层）的真实输出为准，不看持久表。我自建的驱动器 `/tmp/t14b/d12-harness.mjs` 与 `/tmp/t14b/zerodisp.mjs` **不照抄** `test/tree-model.test.mjs` 的 `t11Pipeline`，而是自己拼 `SidebarModelInput`、自己从 `RenderRow[]` 里按 `parentKey` 提取会话行，断言 `渲染顺序 === 期望顺序`。

**「修复前」副本的构造方式（重要）**：`/tmp/t14b/prefix-lib/tree-model.js` 是**当前 `lib/tree-model.js` 的字节级副本 + 定点补丁**（把 `truncateSessions` 的 promote 分支与 `emitContainer` 的调用实参**逐字还原成 `git show HEAD:src/tree-model.ts` 的原文**），不是复刻版。补丁脚本见 `/tmp/t14b`（`node -e` 内联），补丁前确认过 `FN NOT FOUND` / `CALL NOT FOUND` 守卫，输出 `PATCHED`。

**只读声明**：本轮**未**修改仓库任何受保护文件；`npm run build` 按任务授权重建 `lib/`（已执行）。所有临时脚本、仓库副本均在 `/tmp/t14b/`。

---

## ② D12 删除判定（渲染层为准）

### ②-0 被审实现（`审查真实代码`）

- `src/tree-model.ts:1578-1581` —— `truncateSessions<T extends { sessionId: string }>(sessions: T[], limit: number)`：**只有 2 个形参**，函数体 `1582-1598` 只有「blank 不计名额 / 前 quota 条」两条规则，**无 promote 分支**。
- `src/tree-model.ts:1874` —— `const truncated = truncateSessions(heads, COLLAPSED_SESSION_LIMIT)`：**只传 2 个实参**，没有 `context.currentSessionId`。
- `git show HEAD:src/tree-model.ts` 对照：旧版 `truncateSessions(sessions, limit, currentSessionId?)` 含 `currentIndex` / `promote` 计算（旧 `680-720` 行）与 `truncateSessions(heads, COLLAPSED_SESSION_LIMIT, context.currentSessionId)`（旧 `961` 行）。⇒ 删除是**真实且完整**的（实参与形参同删），不是「形参留着不用」。

### ②-1 渲染顺序判定（`驱动真实导出`）

命令：
```
node /tmp/t14b/d12-harness.mjs <libDir>
```
驱动器直接 `import <libDir>/tree-model.js` 的真实导出 `buildRows`，构造单 worktree 容器（8 条普通会话，默认顺序 `updatedAt` 降序 = `c0…c7`），把**当前会话 `c3`** 通过 `manualOrder.sessions['w:/repo']` 拖到容器内**每一个**落点 `pos=0..7`，覆盖：

- **折叠**（无 `expandedAllKeys`）与**展开**（`expandedAllKeys = { 'w:/repo': true }`）两种状态；
- **无运行中会话**（场景 A，`topZone.runningSessionIds = []`）；
- **有运行中会话**（场景 B，`c6` 运行中 ⇒ 必须固定最前）；
- **容器 4/5/6/7 条**边界（场景 C：无 more 行 / 恰好 5 条 / 刚过 5 条 / 明显超 5 条）。

结果（真实输出，非摘抄）：

```json
{ "libDir": ".../dsh-worktree-groups/lib", "checks": 64, "exceptions": 0, "failCount": 0, "failures": [] }
```

即：**64 项断言、0 例外**。断言式为 `渲染顺序 === (展开 ? 持久顺序 : 持久顺序.slice(0,5))`，场景 B 额外要求 `c6` 逐字在最前。

### ②-2 修复前复现（`驱动真实导出` + 字节级补丁副本）

命令：
```
node /tmp/t14b/d12-harness.mjs /tmp/t14b/prefix-lib
```
结果：`checks: 64, exceptions: 10, failCount: 10`。失败落点（全部来自**折叠**状态，展开状态 0 失败 —— 与机制一致，因为 promote 只在截断路径起作用）：

| 场景 | 落点 | 实际渲染 | 期望渲染 |
|---|---|---|---|
| A（无 running） | pos=5 | `c0,c1,c2,c4,c3` | `c0,c1,c2,c4,c5` |
| A（无 running） | pos=6 | `c0,c1,c2,c4,c3` | `c0,c1,c2,c4,c5` |
| A（无 running） | pos=7 | `c0,c1,c2,c4,c3` | `c0,c1,c2,c4,c5` |
| B（`c6` running） | pos=4 | `c6,c0,c1,c2,c3` | `c6,c0,c1,c2,c4` |
| B（`c6` running） | pos=5/6/7 | `c6,c0,c1,c2,c3` | `c6,c0,c1,c2,c4` |

### ②-3 「视觉零位移」的直接证据（`驱动真实导出`）

命令：
```
node /tmp/t14b/zerodisp.mjs <libDir>      # 打印 pos=0..7 的 [持久表] vs [渲染结果]
```

| 落点 | 持久表（前缀） | 修复前渲染 | 当前渲染 |
|---|---|---|---|
| pos=4 | `c0,c1,c2,c4,c3,…` | `c0,c1,c2,c4,c3` | `c0,c1,c2,c4,c3` |
| pos=5 | `c0,c1,c2,c4,c5,c3,…` | `c0,c1,c2,c4,c3` | `c0,c1,c2,c4,c5` |
| pos=6 | `c0,c1,c2,c4,c5,c6,c3,…` | `c0,c1,c2,c4,c3` | `c0,c1,c2,c4,c5` |
| pos=7 | `c0,c1,c2,c4,c5,c6,c7,c3` | `c0,c1,c2,c4,c3` | `c0,c1,c2,c4,c5` |

**结论**：修复前，`pos=5/6/7` 三次拖拽的**渲染输出逐字相同**（都是 `c0,c1,c2,c4,c3`）——持久表每次都变了，用户视觉上**零位移**，`c3` 被**钉在可见区第 5 位**。当前实现下三者渲染各不相同、且等于持久表的前 5 项（`c3` 被截断到不可见，即用户终裁明确接受的副作用「看不见就是看不见」）。**这是「修复前会失败、修复后通过」的独立复现，且失败数（10）与「钉在可见区第 5 位 / 视觉零位移」的描述完全吻合。**

### ②-4 逐落点例外计数

| 维度 | 落点数 | 例外数 |
|---|---|---|
| 当前实现（A 折叠 8 + A 展开 8 + B 折叠 8 + B 展开 8 + C 4×2×2=16 断言项，共 64 项断言） | 64 | **0** |
| 修复前副本 | 64 | **10**（A 折叠 pos=5/6/7 各 2 项 = 6；B 折叠 pos=4/5/6/7 各 1 项 = 4） |

（注：A 场景每个落点记 2 项断言 —— 顺序断言 + 「当前会话位次 / more 行 hiddenCount」断言，故 pos=5/6/7 贡献 6 项。）

**判定：D12 删除正确，渲染层行为与用户终裁逐字一致。**

---

## ③ `truncateSessions` 契约收窄彻底性

### ③-1 全部调用点（`审查真实代码`）

命令：`grep -rn "truncateSessions" src/ lib/ test/ docs/`

| 位置 | 形态 | 判定 |
|---|---|---|
| `src/tree-model.ts:1578-1581` | 定义：`(sessions: T[], limit: number)` | ✅ 2 形参 |
| `src/tree-model.ts:1874` | 唯一**代码**调用点：`truncateSessions(heads, COLLAPSED_SESSION_LIMIT)` | ✅ 2 实参 |
| `src/tree-model.ts:48/51/1170/1827/2202/2205/2208/2213` | 注释引用 | ✅ 与实现一致（见 ③-3） |
| `lib/tree-model.js:1085` / `lib/client.js:541` | 构建产物，均为 2 形参；`lib/tree-model.d.ts:840-842` 为 `(sessions: T[], limit: number)` | ✅ 产物已同步 |
| `test/tree-model.test.mjs:111/122/126/128` | 2 实参 + `assert.equal(truncateSessions.length, 2)` | ✅ |
| `docs/**` | **0 命中** | ⚠️ 见 ③-4 |

**结论**：`src/` 内**只有 1 个** `truncateSessions` 调用点，**无任何调用点传多余实参**；`lib/`（含 `client.js` bundle 内的内联副本）已随 `npm run build` 同步为 2 形参。**无死参数、无死代码**。

运行时复核（`驱动真实导出`）：
```
truncateSessions.length = 2
2-arg:        a,b,c,d,e  hiddenCount=1
3-arg('f'):   a,b,c,d,e  hiddenCount=1     # 第 3 实参被 JS 静默忽略
3-arg(undefined): a,b,c,d,e  hiddenCount=1
```
⇒ `promote` 语义**确实不存在**；但也说明**运行时**无法发现「调用点又传了第 3 个实参」（JS 忽略多余实参），该风险只由 `test/tree-model.test.mjs:126` 的 `.length === 2` 断言兜住。

### ③-2 其余 `currentSessionId` 用途是否仍有语义（`审查真实代码`）

`src/tree-model.ts` 里 `currentSessionId` 剩余出现处全部核过，**无一是截断路径**：

| 行 | 用途 | 判定 |
|---|---|---|
| `508-525` | `topZoneSessionKeys` 的**兼容形参位**，函数体 `void currentSessionId` / `void containerKey` | ✅ 显式声明为兼容位，JSDoc 写明「T11 起不再参与任何置顶判定」 |
| `1076` | `SidebarModelInput.currentSessionId?`（可选） | ✅ 仍有语义 |
| `1144` | `EmitContext.currentSessionId` | ✅ |
| `1751-1763` | `isVisibleMember`：blank 会话的**豁免**（当前 blank 会话仍渲染） | ✅ 唯一实质用途，与 JSDoc 一致 |
| `1810` | `toSessionRow` 的 `isCurrent` **高亮**字段 | ✅ |
| `1858` | 传给 `topZoneSessionKeys`（该函数已 void 掉） | ✅ 兼容位传参，行为中性 |
| `2082` / `2251` | `effectiveOrder` / `buildRows` 的入参透传 | ✅ |

⇒ 文档 `1751-1753`「`currentSessionId` 在本文件里**只**剩『blank 会话豁免』这一个用途」**略有措辞不精确**（它还驱动 `isCurrent` 高亮与 `topZoneSessionKeys` 的兼容位传参），但**不构成自相矛盾** —— 该句的语义重心是「它**不再**影响截断」，这一点为真。属**文档瑕疵（P3）**，见 ⑩。

### ③-3 指定行的注释/实现一致性（`审查真实代码`）

| 位置 | 内容 | 与实现一致？ |
|---|---|---|
| `:42-51`（`COLLAPSED_SESSION_LIMIT` 上方） | 「本插件**没有**『当前会话保底进前 limit 条』这条规则了…`truncateSessions` 不再有 `currentSessionId` 参数」 | ✅ 与 `:1578` 签名、`:1874` 调用一致 |
| `:1578` | 「本函数不再接受 `currentSessionId`…`promote` 分支已**整体删除**…副作用：当前会话若被截断到不可见，就是看不见」 | ✅ 与函数体 `1582-1598`（只有 blank 豁免 + 前 quota 条）逐字一致；「接受副作用」与用户终裁一致 |
| `:1753` | 「`truncateSessions` 已无该参数，D12 保底已删除」 | ✅ 事实正确（措辞瑕疵见 ③-2） |
| `:1869-1874` | 「不传任何『当前会话』线索…唯一能『必进可见区』的只有 `topZoneSessionKeys` 的顶部区，它已在**截断之前**由 `applyManualOrder` 排到最前」 | ✅ 与 `:1854-1859`（`applyManualOrder(..., topZoneSessionKeys(...))` 在 `:1874` 截断之前）+ `:1840-1843`（顶部区成员超 5 条仍会被截断）一致 |
| `:2202-2213` | 「截断**只**按传入顺序取前 N 条，**不再**为『当前会话』做任何保底」 | ✅ 与实现一致 |

**无自相矛盾。** 特别是「先于截断生效 ≠ 一定可见」这层措辞已在 `:1840-1843` 与 `:2222-2225` 两处显式澄清，避免了「置顶必然可见」的过度承诺。

### ③-4 契约测试对收窄的判别力（`审查真实代码` + `驱动真实导出`）

`test/tree-model.test.mjs:122-138` 新增用例 `truncateSessions: 8 条普通会话 ⇒ 第 3 参**不再存在**`：
- `assert.equal(truncateSessions.length, 2)` —— 我用真实导出复核：**实测 `2`** ✅。这条断言能捕获「把第 3 形参加回来」。
- 另有 `:139+` 的「当前会话 id 出现在输入里也不改变顺序」用例，覆盖 promote 的**行为**消失（而不只是签名）。

⇒ 签名层 + 行为层**双层锁定**，判别力充分。

### ③-5 文档覆盖缺口（新发现，P3）

`grep -rn "truncateSessions" docs/` **零命中**：`docs/INTERFACES.md` §2.2 冻结的接口清单里**没有** `truncateSessions`。因此「契约收窄」在**冻结契约文档**中无痕迹，只有源码 JSDoc + 测试。考虑到该函数是**导出**的（`lib/tree-model.d.ts:840` 对外可见），建议在 `docs/INTERFACES.md` 补一行签名（属文档改进，非阻塞）。

---

## ④ .tsx 契约测试保护强度与可绕过性分析

### ④-1 是否真的解析**真实** `src/sidebar.tsx`（`审查真实代码`）

`test/sidebar-wiring.test.mjs:48-51`：
```js
const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC_DIR = path.resolve(HERE, '../src')
const SIDEBAR_PATH = path.join(SRC_DIR, 'sidebar.tsx')
```
⇒ 路径由 `import.meta.url` 解析到**仓库真实 `src/sidebar.tsx`**，`:87-90` 用 `ts.createSourceFile(..., ts.ScriptKind.TSX)` 解析**磁盘上的真实源码文本**（`:88 readFileSync(filePath, 'utf8')`）。**不是** fixture、**不是**副本、**不是**对 bundle 的猜测。`:157` 在模块加载期即解析一次。

反向证据（`驱动真实导出`）：把变异注入 `/tmp/t14b/m7|m8/src/sidebar.tsx` 后重跑同一测试文件，**立刻红**（见 ④-3）—— 若它解析的是副本/fixture，改真实源码不会影响结果。

### ④-2 断言覆盖度核对（`审查真实代码`）

任务要求的两条关键覆盖**均已具备**：

| 要求 | 对应断言 | 是否真的覆盖 |
|---|---|---|
| `dragHandlersFor` 第 3 实参 `draggable` | `:161-174`（形参名 `['row','scope','draggable']` + 默认值 `true`）；`:176-190`（返回值含 `draggable` 属性）；`:192-202`（`if (!draggable) return` 守卫）；`:223-227`（`call.arguments.length === 3`） | ✅ 四条独立断言，覆盖「形参存在 / 参数被带出 / 双保险 / 调用点真的传了」 |
| 不可拖判据调用 `isTopZoneRunningSession` | `:231-234`（`isNegatedSharedCriteria(third)`：顶层 `!` + callee 名为 `isTopZoneRunningSession` + **恰好 2 实参**）；`:235-240`（实参个数 = 2）；`:273-284`（必须从 `./tree-model.js` import）；`:286-321`（全 `src/` 仅一份声明、且被置顶与不可拖两处共用） | ✅ |

补充发现（**正面**）：`:192-202` 断言的是 `dragHandlersFor` **函数体内**的 `if (!draggable) return`；而 `SessionRowView` 真正把开关落到 DOM 的地方在 `src/sidebar.tsx:1038`（`draggable: drag !== undefined && drag.draggable`）与 `:921`（`ContainerRowView`）。`:176-190` 只断言「返回值含 `draggable` 属性」，**没有**断言 `SessionRowView` 把它接到 `draggable:` prop 上。⇒ 存在一个**未被覆盖的断链点**（见 ④-4 与 ⑩ P2）。

### ④-3 独立复现 M7 / M8（`驱动真实导出` + 真实源码变异）

变异注入方式：`rsync` 仓库副本到 `/tmp/t14b/m7|m8`，用 `python3` 对 `src/sidebar.tsx` 做**定点替换**（带 `assert old in s` 守卫，替换前打印 `patched`），随后在副本内跑 `npm test`（含 `npm run build`）。

| 变异 | 补丁 | 命中用例（`sidebar-wiring.test.mjs`） | 新套件 fail | 旧套件 `tree-model.test.mjs` fail |
|---|---|---|---|---|
| **M7**：删掉 session 行第 3 实参 | `dragHandlersFor(row, {kind:'session',…}, !isTopZoneRunningSession(row, topZone))` ⇒ 删末行 | `:211`（★ M7 捕获点，`call.arguments.length === 3`）、`:286`（判据共用） | **fail 2**（`ℹ tests 391 / pass 389 / fail 2`，`M7_EXIT=1`） | **fail 0**（`ℹ tests 250 / pass 250 / fail 0`） |
| **M8**：判据分叉 | 第 3 实参 ⇒ `row.running !== true` | `:211`（★ M8 捕获点，`isNegatedSharedCriteria`）、`:286` | **fail 2**（`ℹ tests 391 / pass 389 / fail 2`，`M8_EXIT=1`） | **fail 0**（`ℹ tests 250 / pass 250 / fail 0`） |

**与 `test/mutation-t11.md:57-58` 声明完全吻合**（该表声明 M7/M8 各 `sidebar-wiring` fail 2、`tree-model` fail 0）。⇒ 该测试**不是安慰性测试**，它确实把 `.tsx` 层的两条核心承诺变成可自动执行的红线。

注：`:286` 那条用例在 M7 下也红，原因是它的第 ③ 项断言 `callExpressionsOf(sidebar.sourceFile, 'isTopZoneRunningSession').length >= 1` —— M7 把整个调用删掉了。这是**合理**的连带命中（不是误报）。

### ④-4 可绕过性分析（`驱动真实导出`）

我构造了 3 个「间接写法」变异（均在 `/tmp/t14b/bypass-*`，语义与**正确**实现**完全等价**），只改 `src/sidebar.tsx`：

| 变异 | 写法 | 语义 | 测试结果 |
|---|---|---|---|
| **bypass-a** | 抽局部包装：`const sessionIsLocked = (r) => isTopZoneRunningSession(r, topZone)`，调用点传 `!sessionIsLocked(row)` | 与正解**等价** | **fail 1**（`:211`，`实际：!sessionIsLocked(row)`） |
| **bypass-b** | 变量中转：`const canDragSession = !isTopZoneRunningSession(row, topZone)`，第 3 实参传 `canDragSession` | 与正解**等价** | **fail 1**（`:211`） |
| **bypass-c** | 条件传参：第 3 实参 `isTopZoneRunningSession(row, topZone) ? false : true` | 与正解**等价** | **fail 1**（`:211`） |

**关键判断**：

1. **它不能被「轻易绕过」**：任何**语义等价但写法间接**的重构都会**误报为失败**。⇒ 该测试对「判据必须**字面地**以 `!isTopZoneRunningSession(row, topZone)` 出现在 session 调用点的第 3 实参位置」有**过强**约束。
2. **但这也意味着它抓不住「真正的绕过」**：真正危险的不是间接写法（那些语义仍正确），而是**语义分叉**。我在 ④-3 已证 M8（`row.running !== true`）会被抓。真正能绕过的形式是：
   - **把 `topZone` 实参换成等价但不同的来源**：`:246-250` 只要求第 2 实参是「非空标识符」（正则 `/^[A-Za-z_$][\w$]*$/`），**不校验它到底是不是 `topZone`**。⇒ `!isTopZoneRunningSession(row, someOtherZone)` 或 `!isTopZoneRunningSession(row, undefined)` 会**通过**该断言，但聚合口径可能失效（例如传 `undefined` ⇒ 只认裸 `running`，子代理在跑的会话变成可拖动）。
   - **`draggable` 的下游断链（已实测确证，见 ④-6）**：把 `src/sidebar.tsx:1038` 改成 `draggable: true`（恒定可拖）⇒ `sidebar-wiring` **8/8 pass**、`tree-model` **250/250 pass**，而运行中的会话**实际可拖**（`drag.draggable` 被忽略）。同理把 `:921` 改掉。**这是当前套件最大的保护缺口。**
   - **只删 `SessionRowView` 的 `onDragStart: drag?.onDragStart`** 之类下游接线，同样全绿。
3. **保护强度结论**：该测试是**结构性契约测试**（AST 级），对「接线形状被改动」敏感、对「格式化/空白/注释」免疫，**不是**安慰性测试；但它**不是行为测试** —— 它证明「源码里写了正确的判据与实参」，**不证明**「运行中的会话真的拖不动」。缺口集中在 `dragHandlersFor` 返回值 → `SessionRowView` DOM prop（`:1038`）这一段，以及 `topZone` 实参的**身份**校验。

### ④-5 对任务书中「M7/M8 各 fail 2」的独立确认

任务书与 `test/mutation-t11.md:57-58` 均声明 fail 2。我**独立复现**得到 **fail 2 / fail 0**（旧套件），**吻合**。唯一差异：`test/sidebar-wiring.test.mjs` 的**文件头注释** `:11-14` 仍写着旧数字「**fail 0**（247/247 全绿）」与「**fail 0**（247/247 全绿）」—— 那是 T12 时代**旧套件**的实测值，措辞可读作「本套件命中前的情况」，但**未标注旧套件名与旧总数**，且与同一文件 `:37` 引用的 `test/mutation-t13.md`（**该文件不存在**，见 ⑩ P1）形成悬空引用。属**文档瑕疵**，不影响判别力。

### ④-6 下游断链缺口的**实测确证**（`驱动真实导出` + 真实源码补丁）

把 `src/sidebar.tsx:1038`（`SessionRowView`）的 `draggable: drag !== undefined && drag.draggable` 改为 **`draggable: true`**（= 恒定可拖，`dragHandlersFor` 的 `draggable:false` 被彻底忽略），在 `/tmp/t14b/dbl` 副本上实跑：

| 套件 | 结果 |
|---|---|
| `node --test test/sidebar-wiring.test.mjs` | `ℹ tests 8 / pass 8 / **fail 0**` |
| `node --test test/tree-model.test.mjs` | `ℹ tests 250 / pass 250 / **fail 0**` |

⇒ **两个套件全绿，而「运行中的会话不可拖动」这条 T11 核心承诺被静默破坏。** 这是当前自动回归保护的**真实盲区**（⑩ P2）。

---

## ⑤ 回归红线核验表

证据脚本：`/tmp/t14b/t9.mjs`、`/tmp/t14b/d5.mjs`、`/tmp/t14b/d12-harness.mjs`（均 `驱动真实导出` `lib/tree-model.js`）。

### D1 —— 默认模式零写入（`驱动真实导出` + `审查真实代码`）

| 检查 | 实测 | 判定 |
|---|---|---|
| `insertSessionAtFront({manual:false}, …)` 返回值 | `undefined`（`insertReturns: true`） | ✅ 默认模式不建表 |
| `planNewSessionInserts({manual:false}, …)` | `{changed:false, consumed:[], sessionsKeys:0}` | ✅ 不消费、不写、**不凭空建表**（不把用户静默切成手动模式） |
| 源码守卫 | `src/tree-model.ts:924` `if (order.manual !== true) return undefined`；`:1004` 同式 | ✅ `审查真实代码` |

**用户数据零写入（独立核对）**

命令与结果：

| 对象 | 观测 | 结论 |
|---|---|---|
| `~/Library/.../dsh-desktop-renderer/Local Storage/leveldb/*`（全部 8 个文件） | 在 **45 秒窗口**内 **sha256 逐字节不变**（`000005.ldb 502672e4…`、`000863.log 248bfc50…`、`000865.ldb 59d43d71…`、`CURRENT`、`LOCK`、`LOG`、`LOG.old`、`MANIFEST-000001` 全部一致） | ✅ **用户 localStorage 在本轮零写入** |
| `dsh-worktree-groups.order` 载荷 | 从 leveldb 提取（**只读**）⇒ `{"manual":true,"projects":[…],"worktrees":…,"sessions":…}`；**含 `manual` / `projects` / `worktrees` / `sessions` 四个字段，不含 `topZone` / `runningSessionIds` / `newSessionIds` / `writtenNewSessionIds` / `recentlyFinished` / `releasedContainerKeys`** | ✅ 运行时置顶**未**进持久化（D3e 的持久化侧证据） |
| `~/.dsh/storages/workspace.json` | mtime `11:12:14`，在整个观测窗口（`11:33`–`11:36`）**未变** | ✅ |
| `~/.dsh/settings.yaml` | mtime `10:19:24`，未变 | ✅ |
| `~/.dsh/worktree-groups.json` | mtime **持续**推进（`11:33:56` → `11:34:03` → `11:34:06` → `11:34:22` → `11:36:23`，约 2–15 s 一次），字节大小恒 `62672` | ⚠️ 需独立归因，见下 |

**`~/.dsh/worktree-groups.json` mtime 变化的独立归因**（这是任务书要求「独立判断是否来自 DSH Desktop 自身轮询」的点）：

1. **结构比对**：取两份快照（相隔 14 s，`/tmp/t14b/wg-a.json` / `wg-b.json`），做全路径 diff ⇒ **唯一变化的是 16 个 worktree 的 `lastSeenAt`**（如 `1790048080092 → 1790048096844`，差 15852 ms ≈ 实际间隔），`projects` / `sessions` / `worktrees` 的**集合与顺序完全不变**（`only in A: []`、`only in B: []`）。**无任何排序/置顶/手动顺序字段变化**（全文不含 `manual` / `topZone` / `order` / `runningSessionIds` 等字样，`grep` 实测 `contains 'manual': False` …）。
2. **写入者身份**（`审查真实代码`）：唯一写 `lastSeenAt` 的代码在 **DSH 本体的宿主半区** `src/routes.ts:910-961`（本插件的 HTTP 路由 `ctx.effect`），注释自述：「首次见到填 `firstSeenAt = lastSeenAt = now`；再次见到刷新 `lastSeenAt`」。
3. **写入节流证据**：`src/routes.ts:957-963` 的 `changed` 判据包含 `patched.lastSeenAt !== prior.lastSeenAt` ⇒ **每次刷新 `lastSeenAt` 必然置 `changed = true` ⇒ 必然落盘**。因此只要 DSH 侧栏的 tree 轮询在跑，该文件就会按轮询节奏被重写 —— **与观测到的 2–15 s 节奏吻合**。
4. **无法用 `lsof` 二次确认**（`lsof` 对该路径返回空），故本条属 `推断`（**全文唯一一处**），但推断强度高：文件内容的变化**只**是 `lastSeenAt`，而 `lastSeenAt` **只**由 `routes.ts` 的 tree 路由写，且本插件客户端**没有**任何写该文件的代码路径（`grep -rn "worktree-groups.json" src/` 仅命中 `ledger.ts` 的**服务端** ledger，非浏览器侧）。

⇒ **判定：该 mtime 变化来自 DSH Desktop 自身的 tree 轮询，不是实现者写入**。实现者的写入面（`localStorage` 的三个键）在 45 s 窗口内逐字节不变。

### D2 —— 落表形态 / 幂等 / 刷新后最前（`驱动真实导出`）

| 检查 | 实测 | 判定 |
|---|---|---|
| 插入位置 | `table = ['session-n9','session-n0','session-n1','session-n2']` ⇒ 新会话在最前 | ✅ |
| **形态与 `keyOf` 逐字一致** | `first === 'session-n9'`（带 `session-` 前缀，与 `effectiveOrder` 产物 = 树里真实 id 同形） | ✅ |
| 幂等 | 二次 `planNewSessionInserts` ⇒ `{changed:false, consumed:[], sameRef:true}`（**同一引用**） | ✅ |
| 无死条目 | `table` 中不在 `fullOrder` 里的 id：**`[]`** | ✅ |
| 无重复 | `table.length === new Set(table).size` | ✅ |
| 刷新后仍在最前 | 用固化表重建 `buildRows` ⇒ `['session-n9','session-n0','session-n1','session-n2']` | ✅ |
| 默认模式不落表 | 见 D1 | ✅ |

### T9 台账 —— 拖新会话不回弹（`驱动真实导出`）

`observeTopZone` 两轮（`startedAtMs=1000`，第二轮 `nowMs=2000`，新会话 `session-n9` 晚于启动水位）⇒ `newSessionIds = ['n9']`；`markNewSessionsWritten(state, consumed)` 后 `writtenNewSessionIds = ['n9']`。

用户把 `session-n9` 拖到**第 3 位**（持久表 `['session-n0','session-n1','session-n9','session-n2']`）：

| 渲染期输入 | 渲染结果 | 判定 |
|---|---|---|
| 台账**缺省**（`topZone` 不含 `writtenNewSessionIds`） | `['session-n9','session-n0','session-n1','session-n2']` ⇒ **被搬回最前（弹回）** | 这是**兼容分支**（`src/tree-model.ts:387-389` 明示「缺省 ⇒ 与旧行为逐字一致」） |
| 台账**已记**（真实链路 `topZoneInputOf(state)` 的产物） | `['session-n0','session-n1','session-n9','session-n2']` = **持久表逐字相同** | ✅ **不回弹** |

⇒ T9 修复**有效**，且「缺省即旧行为」这一零回归承诺**逐字成立**（我用真实导出实测复现了两种行为）。

### 顶部区 —— 固定最前 / 不可拖 / 仍接受落点

| 检查 | 证据 | 判定 |
|---|---|---|
| 固定最前 | ②-1 场景 B（`c6` running，8 个落点 × 折叠/展开）⇒ 渲染恒为 `['c6', …持久顺序去掉 c6]`，**0 例外** | ✅ `驱动真实导出` |
| 先于截断生效 | 同上，折叠态 `c6` 恒在可见区第 1 位 | ✅ |
| **不可拖** | `src/sidebar.tsx:2197-2201` 第 3 实参 `!isTopZoneRunningSession(row, topZone)`；落到 DOM 在 `:1038` `draggable: drag !== undefined && drag.draggable` | ✅ `审查真实代码`（并有 ④ 的变异实测） |
| **仍接受落点** | `dragHandlersFor` 的 `draggable` **只**进返回对象的 `draggable` 字段（`:2088`）与 `onDragStart` 守卫（`:2093`）；`accepts`（`:2081-2086`）、`onDragOver`（`:2109`）、`onDrop`（`:2121`）**完全不读** `draggable` ⇒ 运行中行照常当落点 | ✅ `审查真实代码` |
| 顶部区成员 > 5 条时超出者仍被截断 | 注释 `:1840-1843`、`:2222-2225` 与实现一致（截断在 `applyManualOrder` 之后） | ✅ `审查真实代码` |

### D3e —— `effectiveOrder` 硬置 `topZone: undefined`（`驱动真实导出`，含对照组）

| 检查 | 实测 | 判定 |
|---|---|---|
| 载荷逐字一致 | `effectiveOrder(input + topZone:{runningSessionIds:['session-n2'], newSessionIds:['session-n2']})` 与不传 `topZone` 的产物 **JSON 逐字相同**（`effectiveOrderPayloadIdentical: true`），且产物为 `[['w:/repo', ['session-n0','session-n1','session-n2']]]`（`session-n2` 虽 running，**未**被提到最前） | ✅ |
| **对照组（排除恒真）** | 同一份输入下 `buildRows(topZone: undefined)` ⇒ `['session-n0','session-n1','session-n2']`；`buildRows(topZone: {runningSessionIds:['session-n2']})` ⇒ `['session-n2','session-n0','session-n1']`；`controlDiffers: true` | ✅ 证明「置顶机制本身有效」，上一条的「无差异」不是恒真 |
| 源码结构 | `src/tree-model.ts:2090` `topZone: undefined`（硬置，连 `context.topZone` 都不透传）+ `:2096-2100` 的 `applyManualOrder` **不传** `pinnedKeys` | ✅ `审查真实代码` |

### D5 —— 已有会话收到新消息不顶到前面（`驱动真实导出`）

把最旧的 `session-n2` 的 `updatedAt` 从 `1002` 推到 `999999`（模拟新消息）：

| 模式 | 渲染结果 |
|---|---|
| 无手动顺序（默认模式，`updatedAt` 降序） | `['session-n2','session-n9','session-n0','session-n1']`（**按设计**默认排序就该如此，与 D5 不冲突） |
| **手动顺序**（固化表 `['session-n9','session-n0','session-n1','session-n2']`） | `['session-n9','session-n0','session-n1','session-n2']` = **持久表逐字相同** ⇒ `verdict: D5 OK` |

⇒ ✅ `审查真实代码` + `驱动真实导出`：手动模式下 `updatedAt` 推进**不**改变渲染顺序。

### D6 —— `runningCount` 口径不改（`审查真实代码` + `驱动真实导出`）

- `src/tree-model.ts:1909`：`runningCount: heads.filter((session) => session.running === true).length` ⇒ **仍为裸 `running` 口径**，未被改成 `row.running`（聚合口径）。
- 实测：1 条 `running:true` 的容器 ⇒ `worktree.runningCount = 1` ✅。
- 实测（子代理在跑但主会话空闲）：`runningCount = 0`，而同容器 `session-n0` 的**会话行** `running = true`（聚合生效）⇒ **两者刻意不同源，符合 D6**。

### N1 —— 归档会话不被误判为新会话（`审查真实代码` + `驱动真实导出`）

- 实测：基线后首次观测到一条**归档**会话（`updatedAt = 0`，且晚于 `startedAtMs`）⇒ `newSessionIds = []`，且 `runningOf` **不含**该归档 id。✅
- 源码：`src/tree-model.ts:740-743`（`observation.subagent || observation.archived ⇒ continue`，不进 `eligible`）+ `:777-778`（`firstSeenAfterStart` 只在 `eligible` 上判定）+ `:784-786`（归档 id 仍进 `known`，防「取消归档后被判成新会话」）。✅ 与 `:690-702` 的 JSDoc 一致。

### T11 删除项 7 符号不复活（`审查真实代码`）

对 7 个符号逐个 `grep -n` 全部 `src/**`：

| 符号 | `src/` 命中位置 | 判定 |
|---|---|---|
| `recentlyFinished` | 仅 `tree-model.ts:30/477/710`（注释）、`sidebar.tsx:1625`（注释） | ✅ **无代码复活**（注释在描述「已删除」） |
| `releasedContainerKeys` | 仅 `tree-model.ts:482`、`sidebar.tsx:1626/1995/2547`（均注释） | ✅ |
| `isCurrent` **置顶** | 代码里只剩 `tree-model.ts:184`（`RenderRow.isCurrent` 类型）、`:1810`（`toSessionRow` 赋值）、`sidebar.tsx:1017/1021`（`aria-current` + 高亮）；其余为注释 | ✅ **置顶语义已死**，仅剩**高亮**语义（与用户终裁一致） |
| `pinnedSessionKeys` | **`src/` 零命中**、`test/` 零命中（仅历史文档提及） | ✅ |
| `currentSessionOf` | **`src/` 零命中**、`test/` 零命中 | ✅ |
| `releaseTopZoneContainer` | 仅 `tree-model.ts:482`、`sidebar.tsx:1992`（注释） | ✅ |
| `isTopZoneReleasingDrag` | 仅 `tree-model.ts:483`、`sidebar.tsx:1995`（注释） | ✅ |

**结论：7 个符号在 `src/` 内均无代码复活，全部仅存于「说明已删除」的注释或历史文档中。**

---

## ⑥ 测试 / 构建真实数字

全部命令在 `/Users/dev/Documents/Project/AnyWork/dsh-worktree-groups` 顺序执行，日志 `/tmp/t14b-tests.log`。

| # | 命令 | 退出码 | 真实输出 |
|---|---|---|---|
| 1 | `npm test`（第 1 次） | `0` | `ℹ tests 391 / ℹ suites 0 / ℹ pass 391 / ℹ fail 0 / ℹ cancelled 0 / ℹ skipped 0 / ℹ duration_ms 14406` |
| 2 | `npm run typecheck` | `0` | 无输出（`tsc --noEmit` 通过） |
| 3 | `npm test`（第 2 次） | `0` | `ℹ tests 391 / ℹ pass 391 / ℹ fail 0 / ℹ duration_ms 15641` |
| 4 | `npm run build`（A） | `0` | — |
| 5 | `npm run build`（B） | `0` | — |

**构建可复现性（两次比哈希）**：

| 产物 | build A sha256 | build B sha256 | 一致？ |
|---|---|---|---|
| `lib/client.js` | `36c277874c5ad56f16cf83a3bc5f21a1cf561db93beeb959c948e8c20ec1e195` | `36c277874c5ad56f16cf83a3bc5f21a1cf561db93beeb959c948e8c20ec1e195` | ✅ **逐字一致** |
| `lib/tree-model.js` | `d5304adf9892b2a5367ab2ca20f8e51d956052ed79472908bfa40823e05c4392` | `d5304adf9892b2a5367ab2ca20f8e51d956052ed79472908bfa40823e05c4392` | ✅ **逐字一致** |

**HEAD 基线可复现性**：`git archive HEAD | tar -x -C /tmp/t14b/head`，在该副本内 `npm test` ⇒ **`ℹ tests 253 / pass 253 / fail 0`**（exit `0`）。与 `docs/PRD.md:594` 声明一致。✅

**各文件真实条数**（当前工作树，`node --test <file>`）：

| 文件 | 条数 |
|---|---|
| `test/git.test.mjs` | 8 |
| `test/ledger.test.mjs` | 19 |
| `test/projects.test.mjs` | 34 |
| `test/routes.test.mjs` | 72 |
| `test/sidebar-wiring.test.mjs` | **8**（T13 新增） |
| `test/tree-model.test.mjs` | **250** |
| **合计** | **391** ✅ |

**文档数字自洽性核对**：

| 文档声明 | 位置 | 我的实测 | 判定 |
|---|---|---|---|
| HEAD 基线 253 | `docs/PRD.md:594` | 253 | ✅ |
| 当前全量 391 | `docs/PRD.md:595` | 391 | ✅ |
| `tree-model` 单文件 250 | `docs/PRD.md:596` | 250 | ✅ |
| 连跑 2 次均 391 | `docs/PRD.md:603` | 391 / 391 | ✅ |
| `sidebar-wiring` 8 条 | `docs/PRD.md:584` | 8 | ✅ |
| M7/M8 各 fail 2（新套件）/ fail 0（旧套件） | `test/mutation-t11.md:57-58` | 2 / 0 | ✅ |
| HEAD 253（历史报告） | `docs/RESEARCH-running-and-sort.md:6/627/691`、`docs/REVIEW-running-only-topzone.md:219` | 253 | ✅ |
| 380（T11 当时全量，历史值） | `docs/PRD.md:582`、`docs/REVIEW-running-only-topzone.md:222-224` | 380 = 391 − 8（新增 sidebar-wiring）− 3（tree-model 247→250） | ✅ 与历史一致，且 `PRD.md:582` **已显式标注为历史值** |
| 350（T5 时期，历史值） | `docs/REVIEW-fix-verification.md:535` | 属更早轮次，未复核（不在本轮范围） | — |

⇒ **实测与文档声明全部自洽**，无夸大或过时数字（历史值均已被显式标注为历史）。

---

## ⑦ GUI bundle rev

**方法**（`审查真实代码`，只读，**未改任何缓存**）：

1. 读宿主实现：`/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js:172-180`
   ```js
   function framedHash(domain, parts) {
     const hash = createHash("sha1").update(domain).update("\0")
     for (const part of parts) hash.update(`${String(part.byteLength)}:`).update(part)
     return hash.digest("hex").slice(0, HASH_REVISION_LENGTH)   // HASH_REVISION_LENGTH = 12
   }
   function artifactRevision(bundle, sourceMap) {
     return framedHash("plugin-artifact", sourceMap === void 0 ? [bundle] : [bundle, sourceMap.body])
   }
   ```
   `:545-547` 证明 rev 的**唯一输入**是 `readFileSync(record.meta.clientPath)` 的字节（+ 可选 `.map` 的 body）。
2. 磁盘侧：`lib/client.js` 大小 `107885`，**无** `lib/client.js.map` ⇒ `artifactRevision` 只吃 bundle。
3. 按上式在本地重算（Python `hashlib.sha1`，域 `"plugin-artifact"` + `\0` + `f"{len}:{bytes}"`）。

**两个 rev 值**：

| 侧 | 对象 | rev |
|---|---|---|
| **磁盘最新** | `dsh-worktree-groups/lib/client.js`（`npm run build` 产物，mtime `Sep 22 11:31`） | **`57222a7d758d`** |
| **GUI 缓存**（Electron HTTP 缓存命中） | `.../dsh-desktop-renderer/Cache/Cache_Data/144b13166ab5afb5_0`（mtime **`09-22 10:34:51`**）中内嵌的 bundle body | **`57222a7d758d`** |

**一致性判定**：缓存条目里内嵌的 bundle 字节与磁盘 `lib/client.js` **逐字节相同**（`cached[:107885] == disk` ⇒ `True`，且重算 rev 均为 `57222a7d758d`）⇒ **当前 GUI 缓存的就是含 T13 的最新 bundle，用户无需刷新即可加载含 T13 的客户端代码**。

**含 T13 的语义证据（三条独立判据，缓存 body 与磁盘 body 均命中）**：

| 判据 | 09:53 缓存（`rev=3b45db08f3b1`，**T13 之前**） | 10:34 缓存 / 当前磁盘（`rev=57222a7d758d`，**含 T13**） |
|---|---|---|
| `truncateSessions(heads, COLLAPSED_SESSION_LIMIT)`（2 实参 = D12 已删） | **False** | **True** |
| `truncateSessions(heads, COLLAPSED_SESSION_LIMIT, …)`（3 实参 = D12 仍在） | **True** | **False** |
| 存在 `promote` 分支（D12 保底） | **True** | **False** |
| `!isTopZoneRunningSession(row, topZone)`（T11 不可拖接线） | True | True |

⇒ 缓存演化链 `ee03927a9569`(09:13) → `3b45db08f3b1`(09:53) → **`57222a7d758d`(10:34 = 当前磁盘)** 与「T11 先落地、T13 后落地」的时间线吻合，且 **10:34 之后的 GUI 缓存已是 T13 版本**。

**注意**：`rev=57222a7d758d` 这条缓存同时出现在页面图条目 `b0186ff69515df95_0`（10:10）与 bundle 条目 `144b13166ab5afb5_0`（10:34）中 —— 后者是**实际命中的 bundle body**。**我未修改、未清除任何缓存文件**（全程只读 + 本地重算哈希）。

---

## ⑧ 自建变异（选做 —— **已做**）

### ⑧-1 自建变异 V1/V2（`驱动真实导出` + 真实源码补丁）

变异脚本 `/tmp/t14b/mut.mjs`（带 anchor 守卫，`applied`/抛错），在 `/tmp/t14b/mut-V*` 副本上跑 `npm test`。

| 变异 | 补丁要点（`src/tree-model.ts`） | 实跑结果 | 命中用例 |
|---|---|---|---|
| **V1**：**恢复 D12 保底** | `truncateSessions` 重新接受 `currentSessionId?: string` 并恢复 `promote` 分支（含 `currentIndex` / `ordinaryBefore >= quota` / `ordinary < quota - 1`）；`emitContainer` 调用点重新传 `context.currentSessionId` | **fail 6**（`ℹ tests 391 / pass 385 / fail 6`） | ① `truncateSessions: … 第 3 参**不再存在**（T13 已删除保底参数）` ② `行字段: 当前会话被截断到不可见时，isCurrent 标记随之不在任何渲染行上（T13）` ③ `buildRows: 手动顺序**完全决定**当前会话的位置（T13 已删除保底）` ④ `T13/截断: 已结束的当前会话拖到第 8 位 ⇒ 渲染 = 持久顺序前 5 条（**无**保底…）` ⑤ `T13/截断: 当前会话拖到容器内**任意位置** ⇒ 渲染 === 运行中置顶 + 其余逐字持久表（逐落点枚举）` ⑥ `T13/截断: 修复前形态（保底提位）会**立刻**违反上面的渲染契约（判别力证据）` |
| **V2**：**渲染期无条件提升新会话** | `topZoneSessionKeys`：`const isFresh = fresh.has(key) && !done.has(key)` ⇒ `const isFresh = fresh.has(key)`（忽略台账） | **fail 6**（`ℹ tests 391 / pass 385 / fail 6`） | ① `T7/B2 + T9: 收敛**不削弱 D3d**…` ② `T9/缺陷1 真实生命周期: 从树数据重新构造 state 后再编排…` ③ `T9→T11/缺陷2 真实生命周期…` ④ `T9/缺陷1 真实生命周期: 台账**跨「内容有变化」的观测存活**…` ⑤ `T11/⑤ T9 机制不回退: 已落表的新会话被拖到任意位置 ⇒ 渲染跟随（不回弹）` ⑥ `T11/⑤ 定点回归: 去掉台账投影（T9 修复点）⇒ 新会话被拖走后**回弹**（判别力证据）` |

**与 `test/mutation-t11.md` 的独立吻合**：该表 `:56` 声明 M2（与我的 V2 **逐字同一补丁**）为 `tree-model fail 6`，`:60` 声明 M9（与我的 V1 **语义同一**）为 `tree-model fail 6` ⇒ **我实测 V1 = 6、V2 = 6，独立吻合**。✅ 该文档的变异数字**可独立复现**（T12 的 N-4 已修）。

### ⑧-2 等价变异（如实标注）

| 变异 | 做法 | 预期 | 说明 |
|---|---|---|---|
| **V3**（等价） | `void currentSessionId` ⇒ `currentSessionId?.length`（保留形参、不恢复任何逻辑） | **无失败** | `mutation-t11.md §2.2` 已如实标注为**等价变异**。我**未实跑**（与文档一致，且属纯死代码改写），标注为「未实跑，与文档一致」。 |
| M4b（文档标注的等价变异） | 只恢复 `releasedContainerKeys` 读取、不改变行为 | 文档标 `fail 0` | 我**未实跑**（同上）。 |

### ⑧-3 稳健性对照（补充证据，超出任务书要求）

| 改动 | 性质 | `sidebar-wiring` 结果 |
|---|---|---|
| **R1**：把 session 调用改写成多行 + 插入块注释（`row /* 当前渲染行 */`）+ 去掉尾逗号 | **无害**（AST 语义不变） | **8/8 pass** ✅ 不误报 |
| **R2**：给 worktree 行调用**补上**第 3 实参 `false`（容器行也变不可拖） | **语义改动** | **fail 1**（`:253` 「worktree / project 行的调用**不传**第 3 实参」）✅ 正确捕获 |

⇒ 与 `test/mutation-t11.md §3` 的声明一致：AST 断言对格式免疫、对语义敏感。

---

## ⑨ 文档一致性（选做 —— **已做**）

### ⑨-1 `test/mutation-t11.md` ↔ `docs/PRD.md` 变异表一致性

| 变异 | `test/mutation-t11.md:56-60` | `docs/PRD.md:614-624` | 一致？ |
|---|---|---|---|
| M1 恢复「刚结束保留」 | tree-model **fail 1** | fail 1 | ✅ |
| M2 无条件提升新会话 | **fail 6** | fail 6 | ✅（我独立实跑 = **6**） |
| M3 恢复「当前会话置顶」 | **fail 7** | fail 7 | ✅ |
| M4 拖动释放完整组合 | **fail 1** | fail 1 | ✅ |
| M4b 只恢复释放读取（等价） | **fail 0** | fail 0 | ✅ |
| M5 `isTopZoneRunningSession` 恒 false | **fail 29** | fail 29 | ✅（两文档均记录了「1→29」的 N-4 修正） |
| M6 去掉归档补投影 | **fail 2** | fail 2 | ✅ |
| M7 `.tsx` 删第 3 实参 | tree-model **fail 0** / sidebar-wiring **fail 2** | 同 | ✅（我独立实跑 = **0 / 2**） |
| M8 判据分叉 | **fail 0 / fail 2** | 同 | ✅（我独立实跑 = **0 / 2**） |
| M9 恢复 D12 保底 | **fail 6** | fail 6 | ✅（我独立实跑 V1 = **6**） |
| M10 完整恢复旧状态机 | **fail 7** | fail 7 | ✅ |

**至少 1 个变异按补丁要点独立复现且 fail 数吻合**：我复现了 **2 个**（M2→V2 = 6、M9→V1 = 6），**数字逐字吻合**。✅

### ⑨-2 `README.md` / `docs/PRD.md` / `docs/INTERFACES.md` 与最终语义一致性

**结论：与最终语义一致，未发现过时表述。** 逐条核对：

| 检查点 | 文档表述 | 判定 |
|---|---|---|
| D12 保底已删除 | `README.md:48`（「本插件**没有**『当前会话保底提位』这条规则」）、`:113-117`（含 T13 删除说明）、`PRD.md:154`（D12 行显式标注已删）、`:250`、`:464-470` | ✅ 与实现一致 |
| 「刚结束保留」已删除 | `README.md:69`（`~~删除线~~`）、`:149`、`:211`、`PRD.md:310/352/377` | ✅ 均以删除线 / 「已删除」标注 |
| 「当前会话置顶」已删除 | `README.md:170`、`PRD.md:153`（「仅高亮，**不**置顶 —— T11 终裁」）、`:377`、`INTERFACES.md:808-812` | ✅ 与 `src/tree-model.ts:184/1810`（仅高亮）一致 |
| 截断措辞 | `PRD.md:389`（N-6 修正：「**不**等于『运行中的会话一定可见』」）、`README.md:48` | ✅ 与 `src/tree-model.ts:1840-1843` 一致 |
| 顶部区 = 仅运行中（+ 未落表新会话） | `README.md:214`、`PRD.md:582`、`INTERFACES.md:591` | ✅ |
| 测试数字 | `PRD.md:594-596/603`（253 / 391 / 250 / 连跑 2 次）、`README.md` 相关段 | ✅ 全部实测吻合（见 ⑥） |

**唯一过时表述**（属**刻意保留的历史记录**，非缺陷）：`PRD.md:578-579` 的「变更历史」表仍写着 T5 时期「按 `isCurrent` 传入当前会话 id … 一定可见」，但**同一行末尾**已加「⚠️ 该『`isCurrent` 置顶』判据已于 2026-09-22 被用户终裁删除」，`PRD.md:584` 亦已加 T13 行。⇒ **历史记录 + 显式作废标注**，符合变更日志惯例，**判定为可接受**。

### ⑨-3 新发现的文档缺陷（见 ⑩）

- `test/sidebar-wiring.test.mjs:37` 引用 **`test/mutation-t13.md`** —— **该文件不存在**（`ls test/` 只有 `mutation-t11.md`）。属 **N-5 同类缺陷的残留**（T13 声称补写了 `mutation-t11.md`，但文件头注释仍指向 `mutation-t13.md`）。

---

## ⑩ 新发现问题清单

### P1（中）：`test/sidebar-wiring.test.mjs:37` 引用**不存在**的文件 `test/mutation-t13.md`

- **位置**：`test/sidebar-wiring.test.mjs:36-37`
  ```
   * 证据类型：**[审查真实代码]**（对真实源码做 AST 断言）+ 变异验证见
   * `test/mutation-t13.md`。
  ```
- **事实**：`ls test/` ⇒ 只有 `mutation-t11.md`（**无** `mutation-t13.md`）；`grep -rn "mutation-t13"` 全仓**唯一命中**就是这一行。
- **性质**：这正是 T13 自己声称修掉的 **T12 的 N-5**（「`test/mutation-t11.md` 引用不存在」）的**同类残留** —— T13 把变异数据写进了 `mutation-t11.md`，却没有把这一行的引用同步改过去。
- **影响**：**不影响**测试行为（纯注释），但会误导后续读者/复审者去找一个不存在的文件。
- **修复建议**（**不代改**）：把该行改成 `test/mutation-t11.md`（§1 变异表 M7/M8）。

### P2（中）：`.tsx` 契约测试存在**未覆盖的下游断链点**（`draggable` → DOM prop）—— **已实测确证**

- **位置**：`src/sidebar.tsx:1038`（`SessionRowView`）与 `:921`（`ContainerRowView`）
  ```js
  draggable: drag !== undefined && drag.draggable,
  ```
- **事实**：`test/sidebar-wiring.test.mjs` 的 8 条断言只覆盖到 `dragHandlersFor` **返回值含 `draggable` 属性**（`:176-190`），**没有**断言 `SessionRowView` 把该属性接到 DOM 的 `draggable:` prop 上。
- **实测（见 ④-6）**：把 `:1038` 改成 `draggable: true` 后，`sidebar-wiring` **8/8 pass**、`tree-model` **250/250 pass**，而**运行中的会话实际变成可拖** —— 「排在最前但拖得动」会**静默回归**，两个套件都抓不到。
- **修复建议**：加一条 AST 断言 —— 在 `SessionRowView` 函数体内存在 `draggable:` 属性且其值引用 `drag.draggable`（同样对格式免疫）。

### P3（低）：`src/tree-model.ts:1751-1753` 措辞不精确

- **原文**：「`currentSessionId` 在本文件里**只**剩『blank 会话豁免』这一个用途」
- **事实**：它还驱动 `:1810` 的 `RenderRow.isCurrent`（行高亮）与 `:1858` 传给 `topZoneSessionKeys` 的兼容位。
- **性质**：**不构成自相矛盾**（该句的语义重心「它不再影响截断」为真），仅措辞过强。同文件 `src/sidebar.tsx:1852` 的表述是准确的（「**只**服务两件事：① 行上的 `isCurrent` 高亮；② blank 会话豁免」）。
- **修复建议**：与 `sidebar.tsx:1852` 对齐措辞。

### P4（低）：`docs/INTERFACES.md` 未收录 `truncateSessions` 的收窄签名

- **事实**：`grep -rn "truncateSessions" docs/` **零命中**；但该函数是**导出**的（`lib/tree-model.d.ts:840-842`）。
- **影响**：契约文档无该函数的痕迹，「T13 收窄为 `(sessions, limit)`」只能从源码 JSDoc + 测试得知。
- **修复建议**：在 `docs/INTERFACES.md` §2.2 的导出清单补一行签名与「T13 已删除 `currentSessionId`」的说明。

### P5（低，观察项）：`test/sidebar-wiring.test.mjs:11-14` 的数字未标注归属

- **原文**：M7/M8 的旧值写作「**fail 0**（247/247 全绿）」，未标注这是**旧套件 `tree-model.test.mjs`** 的数字，也未标注该总数是 T12 时代的 247（T13 后为 250）。
- **影响**：单独读该表会误以为「本套件 fail 0」。同文件 `:26-34` 的正文其实写清了语义，属可读性问题。

### 未发现问题的项（明确记录）

- **D12 删除**：无残留、无死参数、无死代码，注释与实现一致（②③）。
- **`truncateSessions` 调用点**：`src/` 内唯一且为 2 实参（③-1）。
- **7 个删除符号**：`src/` 内无代码复活（⑤）。
- **T9/D2/D5/D6/N1/D3e**：全部实测通过（⑤）。
- **文档数字**：253 / 391 / 250 / fail 2 / fail 0 / fail 6 / fail 29 等**全部可复现**（⑥⑨）。

---

## ⑪ 未验证 / 未做部分（如实）

| 项 | 状态 | 原因 |
|---|---|---|
| **⑧-2 的 V3 等价变异实跑** | **未实跑** | 它是纯死代码改写（`void x` ⇒ `x?.length`），`test/mutation-t11.md §2.2` 已如实标注为等价变异；实跑价值低且需完整 build+test 周期（约 15 s × 1）。**标注为「未实跑，与文档一致」**。 |
| **M4b 等价变异实跑** | **未实跑** | 同上（文档标 `fail 0`）。 |
| **M1/M3/M4/M5/M6/M10 的逐条独立复现** | **未实跑** | 任务书只要求「至少 1 个」，我实跑了 2 个（M2→V2、M9→V1，fail 数吻合）。其余 6 条**未实跑**；它们与我的 V1/V2 覆盖的失效模式部分重叠（M1/M4/M10 同属「刚结束保留」族、M3 属「当前会话置顶」族），但**我没有对 M5（fail 29）、M6（fail 2）做独立复现** ⇒ 这两个数字**仅来自文档，未经我实测**。 |
| **真实 GUI 交互（真人在侧栏里拖动）** | **未做** | 本轮为只读复审，禁止操作用户 localStorage / GUI。所有「拖动」都是通过 `manualOrder` 载荷 + `buildRows` 真实导出模拟的**渲染层**等价物。 |
| **`~/.dsh/worktree-groups.json` 写入者的 `lsof` 直证** | **未取到** | `lsof <path>` 返回空（Electron 写入是短促 open/write/close）。改用「结构 diff + 写入者代码定位 + 节流判据」三重证据，结论标注为 `推断`。 |
| **`docs/REVIEW-fix-verification.md` 里的 350 条等更早历史数字** | **未复核** | 属 T5/T8 轮次，不在 T13 验收范围。 |
| **`test/routes.test.mjs`（72 条）与 `test/ledger.test.mjs`（19 条）的语义正确性** | **未逐条审查** | 本轮聚焦 T11/T13 的语义面；这两个文件的**条数与全绿**已由 ⑥ 的 `npm test` 覆盖。 |
| **DSH 本体目录的改动检查** | **未做** | 任务书只读；我仅读了 `@deepseek-ai/dsh-client-modules/lib/index.js` 的 `artifactRevision` 实现（⑦），未检查其是否有本地改动。 |

**预算说明**：本轮全程遵守「先建报告、分节增量写入」，未出现上下文吃紧；以上「未做」项均为**主动取舍**（任务书标注为选做或超出范围），**非预算所迫**。

---

## ⑫ 结论：是否建议验收

### **建议验收（无阻塞项）。**

**支持验收的关键证据**：

1. **D12 删除正确**（★1）：用真实导出驱动 `buildRows`，覆盖 64 项断言（8 个落点 × 折叠/展开 × 有/无运行中会话 + 4 个容器大小边界），**0 例外**；在字节级还原的「修复前」副本上**10 例外**，且「当前会话被钉在可见区第 5 位、pos=5/6/7 渲染逐字相同（视觉零位移）」被**逐落点复现** —— 修复前后对比**双向可证**。
2. **契约收窄彻底**（★2）：`src/` 内唯一调用点、2 形参、`lib/` 与 `.d.ts` 同步、无死参数；`:42-51 / :1578 / :1753 / :1869-1874 / :2202-2213` 五处注释与实现**无自相矛盾**。
3. **`.tsx` 契约测试有真实保护力**（★3）：解析**真实** `src/sidebar.tsx`；M7/M8 独立复现 **fail 2 / 旧套件 fail 0**，与文档**逐字吻合**；且对「多行/注释/尾逗号」**免疫**（R1 = 8/8 pass）、对「容器行也改不可拖」**敏感**（R2 = fail 1）。**可绕过性分析已给出**：它能挡住「语义分叉」（M8），也能挡住「间接写法」（我实测 3 种等价写法全部 fail 1），但**挡不住**「`topZone` 实参换成 `undefined`」与「`draggable` → DOM prop 断链」这两类（见 ⑩ P2）。
4. **回归红线全绿**（★4）：D1（含**用户数据零写入**的 45 s 逐字节不变实测 + `worktree-groups.json` 变化的独立归因）、D2、T9、顶部区、D3e（含**对照组**）、D5、D6、N1、T11 七符号 —— **逐条有实测或 file:line 证据**。
5. **测试/构建数字真实可复现**（★5）：`npm test` ×2 = **391/391**、`typecheck` exit 0、`build` ×2 **哈希逐字一致**、HEAD 基线 **253** 可复现、各文件条数合计 391、文档数字**全部自洽**。
6. **GUI bundle rev**（★6）：磁盘 rev = 缓存 rev = **`57222a7d758d`**，缓存 body 与磁盘 `lib/client.js` **逐字节相同** ⇒ **用户无需刷新**即可加载含 T13 的 bundle（缓存条目 mtime 10:34:51 晚于 T13 落地）。

**建议但不阻塞的跟进项**（按优先级）：

| 优先级 | 项 | 位置 |
|---|---|---|
| P1 | 修正悬空引用 `test/mutation-t13.md` ⇒ `test/mutation-t11.md` | `test/sidebar-wiring.test.mjs:37` |
| P2 | 补一条断言覆盖 `draggable` → `SessionRowView` DOM prop 的接线 | `test/sidebar-wiring.test.mjs` + `src/sidebar.tsx:1038` |
| P3 | 措辞与 `sidebar.tsx:1852` 对齐 | `src/tree-model.ts:1751-1753` |
| P4 | 补 `truncateSessions` 收窄签名 | `docs/INTERFACES.md` §2.2 |
| P5 | 变异表数字标注「旧套件 / 旧总数」 | `test/sidebar-wiring.test.mjs:11-14` |

**风险与限制（如实声明）**：

- 本轮所有「拖动」均为**渲染层载荷模拟**，**未**在真实 GUI 里做真人拖拽；因此「不可拖」的**交互层**手感（浏览器不启动 dragstart、不显示拖拽光标）**未经真机验证**，只由源码审查 + AST 契约测试 + 变异测试三方间接支持。
- 「`worktree-groups.json` 由 DSH 自身轮询写入」为 `推断`（`lsof` 不可得），但有三重独立证据（结构 diff 仅 `lastSeenAt`、写入者代码在宿主 `routes.ts`、节流判据保证每次刷新必落盘）。
- 我**未**逐条复现 M1/M3/M4/M5/M6/M10（见 ⑪），其中 **M5 = fail 29** 与 **M6 = fail 2** 两个数字**未经我实测**。

**未做「顺手修」**：本轮**未**修改任何实现者代码或既有文档（仅写入本报告 `docs/REVIEW-final-verification.md`）；上述 P1–P5 全部**只报告、未修复**。
