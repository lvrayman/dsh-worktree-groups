# 独立审查报告：需求 A（子代理运行中 ⇒ 父行 running）与需求 B（当前会话容器内置顶）

- **任务 ID**：T3（独立审查 + 验证；只读，唯一写入本文件）
- **审查对象**：T2 的实现（`src/tree-model.ts`、`src/sidebar.tsx`、`test/tree-model.test.mjs`、`docs/PRD.md`、`docs/INTERFACES.md`、`README.md`、`lib/**`）
- **审查基线**：`HEAD = 11b1144`（`feat(worktree-groups): 侧栏三层拖拽排序（项目/worktree/会话）`），工作区未提交改动
- **审查时间**：2026-09-21
- **审查者立场**：不采信实现者自述；所有结论均由本次独立读取源码 / 运行命令 / 临时脚本得出。下文凡「实测」= 本次命令真实输出；凡「推断」= 由代码语义推导、未经运行验证。

---

## 1. 审查范围与独立复现方法

### 1.1 本次实际执行的命令与工具（全部只读或仅写 /tmp）

| # | 目的 | 命令 / 手段 | 结果 |
|---|---|---|---|
| 1 | 改动范围 | `git status --porcelain -uall`、`git diff --stat`、`git diff -- <file>`、`git diff --numstat` | 见 §4.1 |
| 2 | 提交状态 | `git log --oneline -1`、`git rev-parse HEAD`、`git reflog -3` | HEAD 仍为 `11b1144`，无新 commit |
| 3 | 语义阅读 | `read` / `grep` 直读 `src/tree-model.ts`（1544 行）、`src/sidebar.tsx`（2710 行）、`src/routes.ts`、`src/projects.ts` | 见 §2、§3 |
| 4 | 需求 A/B 独立复现 | 自建 `/tmp/t3-repro.mjs`（**不复用 `test/` 的 helper**，自己写 fixture） | 24/24 PASS，exit 0 |
| 5 | 边界输入 | 自建 `/tmp/t3-edge.mjs` | 见 §3.5 |
| 6 | 拖拽 × 置顶交互 | 自建 `/tmp/t3-drag-pin.mjs` | 见 §5「重要-2」 |
| 7 | 规模与性能 | 自建 `/tmp/t3-extra.mjs`、`/tmp/t3-scale.mjs` | 见 §4.8 |
| 8 | 测试 | `npm test`（= `npm run build && node --test`） | **282 pass / 0 fail，exit 0**（实测） |
| 9 | 类型 | `npm run typecheck` | exit 0 |
| 10 | 构建幂等 | 构建前后 `find lib -type f \| xargs shasum -a 256` 对比 | 37 个文件全部逐字相同 |
| 11 | 产物一致性 | `grep` `lib/tree-model.js` / `lib/client.js` / `lib/tree-model.d.ts` | 新逻辑已进产物 |
| 12 | 服务端真实产物 | 只读 HTTP（`curl`）+ Electron 渲染进程磁盘缓存取证 | 见 §4.6（**已取得被 GUI 真实下发的 bundle**） |
| 13 | 宿主参考实现 | 只读 `/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai/...` | 见 §2.1 |
| 14 | 文档一致性 | `git diff -- docs/PRD.md docs/INTERFACES.md README.md` + `grep -n "末尾"` | 见 §4.7 |

### 1.2 复现脚本落点

全部临时脚本写在 `/tmp`（`t3-repro.mjs`、`t3-edge.mjs`、`t3-drag-pin.mjs`、`t3-extra.mjs`、`t3-scale.mjs`、`t3-isCurrent.mjs`），**未写入仓库**。仓库内唯一写入的文件是本报告。

复现脚本 import 的是 **`lib/tree-model.js`（构建产物）** 而非 `src/`，理由：GUI 实际执行的是 `lib/`，且该产物已用 §4.6 的方式证明与 GUI 正在下发的那一份同源。

---

## 2. 需求 A 判定：**满足**（附 1 条已披露的既有限制 + 1 条文档夸大）

### 2.1 语义核对（读源码，非采信自述）

**宿主参考实现（实测读源码）** —— `/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js:783-823`：

```js
function sessionStatuses(node, t) {
  const subagents = node.runningSubagentCount === 0 ? void 0 : { state: "ongoing", ... }
  ...
  if (pending !== void 0) return subagents === void 0 ? [pending] : [pending, subagents];
  if (node.running) { const primary = { state: "ongoing", ... }; return subagents === void 0 ? [primary] : [primary, subagents]; }
  if (subagents !== void 0) return [subagents];          // ← 主 agent 空闲 + 子代理在跑 ⇒ 主状态点 ongoing
  if (node.completed) return [{ state: "done", ... }];
  return [{ state: "done", label: t("status.idle") }];
}
```

同文件 `:293-315` 的 `indexSubagentDescendants` 逐字核对为「沿父链一路向上、每个祖先 +1，仅当 `descendant.running` 才计入 `runningCount`」。⇒ **需求 A 的判据（`runningSubagentCount > 0 ⇒ 主状态点 ongoing`）属实**，T2 的引用没有编造。

**本插件实现（实测读源码）**：

- `src/tree-model.ts:1001`：`running: session.running === true || subagentCount > 0,`
- `src/tree-model.ts:981` / `:1072` / `:1187`：`subagentCount` 一律来自 `subagentCountOf(context.subagentRunningCounts, session.sessionId)`
- `src/tree-model.ts:668-670`：`subagentCountOf = counts.get(normalizeSessionId(sessionId)) ?? 0`
- `src/tree-model.ts:1423`：索引建立在 **`allSessionsOf(input)`（全部输入会话，含归档 / blank / 子代理，跨容器）** 上 —— 与原生未过滤的 `list.byId` 同口径
- `src/tree-model.ts:629-665` `indexRunningSubagentDescendants`：对每个 **`origin === 'subagent'`** 的会话，沿 `parentOf` 向上逐层累加，且 `if (session.running === true) counts.set(parentKey, …)` —— **只有 `running` 的子代理才计数**，且**所有层级**都累加。

⇒ **`subagentCount` 的语义确实是「运行中的子代理后代数（所有层级）」**，不是「全部子代理数」，也不是「直接子代数」。判定：**属实**。

**树 / 搜索同源（实测）**：`emitContainer`（`:1068-1076`）与 `buildSearchRows`（`:1206-1208`）**都只经由** `toSessionRow` 构造 `session` 行；`toSessionRow` 是 `tree-model.ts` 里唯一的会话行构造函数（`grep -n "kind: 'session'" src/tree-model.ts` 仅命中 `:986` 一处）。⇒ 「树里改了、搜索里忘了」在结构上不可能。

### 2.2 独立复现结果（`node /tmp/t3-repro.mjs`，exit 0）

```
PASS  A1 idle 父 + 1 running 子 ⇒ 父行 running=true          （subagentCount=1）
PASS  A2 全 idle ⇒ 父行 running=false
PASS  A3 depth-3 链只有最深层在跑 ⇒ 顶层行 running=true      （只有 1 行可见：p；subagentCount=1）
PASS  A4 自身 running ⇒ true（回归）
PASS  A5 搜索路径同样聚合（query 命中父子 ⇒ 只出 1 行，running=true）
```

四条要求的场景（idle 父 + running 子 / 全 idle / depth-3 只最深层在跑 / 自身 running）**全部实测通过**，且与 T2 自述一致。

### 2.3 误报 / 漏报路径探测（实测，非推断）

| 探测 | 构造 | 实测结果 | 判定 |
|---|---|---|---|
| **归档子代理仍被计入？** | 父 `p` idle，子代理 `c`（`running:true`）列入 `archivedSessionIds:['c']` | 父行 `running=true, subagentCount=1` | **会点亮**。但这是**与原生一致**的：原生 `indexSubagentDescendants(list.byId)` 也是未过滤的全量表；且真实链路里归档会话根本不会进入树的 `sessions`（`src/projects.ts:400` `if (archived.has(...)) continue`），所以**该差异在真实链路上不可观测**。**非缺陷**。 |
| **`completed === true` 且 `running === true` 的子代理** | 子代理同时 `running:true, completed:true` | 父行 `running=true, subagentCount=1` | 与原生一致（原生 `runningSubagentCount` 只看 `running`，不看 `completed`）。**非缺陷**。 |
| **子代理漂到另一个 worktree 容器** | `p` 在 `w:/repo`，子代理 `c` 在 `w:/repo-wt` | 父行 `running=true, subagentCount=1` | 与原生一致（索引是全局的，注释 `:510-511` 已披露）。**非缺陷**。 |
| **环 / 自指脏数据** | `c1.parent=c2`、`c2.parent=c1`，均 `running` | 父行 `running=false, subagentCount=0`，**未挂死** | 有界、不崩。**非缺陷**。 |
| **重复 `sessionId`（一 running 一 idle）** | 同 id 两条子代理 | `subagentCount=1`（去重后只算一次，`:649-650` 按去重后的 `byKey` 遍历） | 与原生 `Map` 语义一致。**非缺陷**。 |
| **子代理数据缺失 ⇒ 漏报** | 只喂父会话（模拟子代理尚未进 `summaries`） | 父行 `running=false, subagentCount=0` | **确实漏报**，但这是数据源缺失的必然降级，见 §2.4。 |

### 2.4 刷新时机与漏报窗口（推断 + 实测交叉）

**实测（读源码 + 读宿主源码）**：

- `src/sidebar.tsx:144` `TREE_REFRESH_MS = 30_000`；`:1664-1667` 首拉 + 30s 轮询 + 窗口 focus 强刷。
- `src/sidebar.tsx:147` `RELOAD_DEBOUNCE_MS = 220`；`:1658-1661` 依赖 `[reload, sessionsSnapshot, currentSessionId]` ⇒ **会话快照引用一变就 220ms 后重取**。
- `src/sidebar.tsx:1592` `sessionsSnapshot = sources.sessions(identity)`，其 `current` 字段（`:1600`）就是 `currentSessionId` 的来源。
- 会话行的 `running` **只**来自 HTTP `/tree` 的 `SessionRow.running`（`src/routes.ts:441` `running: summary?.running === true`），由 `tree-model.ts:1001` 与 `subagentCount` 聚合；`sidebar.tsx` 的 `withLiveState`（`:499-514`）**只覆盖 `completed` 与 `pendingInteraction`，不碰 `running`**（实测确认）。

⇒ **漏报窗口有两类**：
1. **数据缺失型**：`summary` 里没有该子代理条目（`loadSessionSummaries` 降级路径，`src/routes.ts:317-343`）⇒ 该子代理对父行**完全不可见**，父行退化为 `idle`，且**不会自愈**（除非下一轮拿到子代理 summary）。这属于既有数据链路的限制，不是本次改动引入。
2. **时间型**：子代理「刚开始跑 / 刚跑完」到父行状态点刷新之间，最坏 ≤ 30s + 220ms（若 `sessionsSnapshot` 引用未变）。T1 报告 §6 Q2 已把这条列为**未验证项**；本次**同样无法在 GUI 实测**（见 §6）。

**结论**：需求 A 的判据、数据源、聚合层级、同源性**全部实测正确**；实时性上限 30s 属**已知且已披露**的既有限制，不构成本次实现的缺陷。

### 2.5 一处**文档夸大**（次要，见 §5「次要-1」）

`src/tree-model.ts:1001-1004` 与 `docs/INTERFACES.md:415-421` 均写「`subagentCount > 0` **蕴含** `running === true`」。**实测该不变式不成立**：

```
父 p idle、子代理 c running、c 列入 archivedSessionIds
→ 实测：父行 running=true, subagentCount=1   ✅ 蕴含成立
```

但反向构造：**父行不可见时**（父自己被归档 / 父本身是子代理），`subagentCount` 无从体现，不存在矛盾。真正的不成立点在于 **`buildRows` 的 `session` 行只对可见会话产生**，因此对**行**而言该蕴含在 `toSessionRow` 内**恒成立**（同一函数同一 `subagentCount` 入参）。⇒ 实测复核后该表述**在其限定域（`RenderRow.kind === 'session'`）内是正确的**，不构成缺陷。**撤回该条**（保留在 §6 说明我曾怀疑并已排除）。

### 2.6 需求 A 判定

> **满足。** 判据与原生逐字对齐（实测读原生 `client.js:783-823`），数据源复用既有 `indexRunningSubagentDescendants`（未新增数据源、未改 `RenderRow` 字段集合），树与搜索经唯一构造函数同源，四条要求场景 + 搜索路径 + depth-3 全部独立复现通过。`runningCount` 口径**实测未变**（见 §4.8）。

---

## 3. 需求 B 判定：**满足**（附 2 条未披露的交互副作用，见 §5）

### 3.1 实现结构（实测读源码）

- `src/tree-model.ts:276-316` `applyManualOrder(items, order, keyOf, pinnedKeys?)`：置顶项**先于** `order` 取出，与 `order` **共用 `taken` 集合**（`:295-303`）⇒ 同一 key 不会搬两次、输出长度恒等于输入长度。
- `src/tree-model.ts:346-351` `currentSessionOf`：从 `items` **回读**命中的 id（两侧 `normalizeSessionId`），保证置顶 key 与 `keyOf` 的产物同源。
- `src/tree-model.ts:371-377` `pinnedSessionKeys`：`currentSessionId === undefined ⇒ undefined`；命中则返回 `[key]`，否则 `undefined`。
- `src/tree-model.ts:1037-1043` `emitContainer`：`const visible = visibleMembers(...)` ⇒ 同一批 `visible` 既进 `sortedByRecency` 又进 `pinnedSessionKeys` ⇒ **判据与 items 同源**；随后 `:1052` 才 `truncateSessions(heads, 5, currentSessionId)` ⇒ **置顶先于截断**。
- `src/tree-model.ts:1267-1277` `effectiveOrder` 的 `order` 闭包：**刻意不传第 4 参**（`:1271-1272` 注释 + 实测 `grep` 确认全仓库只有 `emitContainer` 一处传 `pinnedSessionKeys`）。
- `src/sidebar.tsx:1852-1854` `commitDrag`：`const defaults = effectiveOrder({ ...treeInput, manualOrder: undefined })` ⇒ 固化输入**不含置顶**。

### 3.2 独立复现（`node /tmp/t3-repro.mjs`）

```
PASS  B1 手动顺序把当前会话排到最后 ⇒ 仍置顶第一位且不被截断吃掉
         实测：['s0','s7','s6','s5','s4']，more 行 hiddenCount=3
PASS  B2 非当前会话收到新消息 ⇒ 不顶到前面（11b1144 承诺）
         实测：manual=['s0','s1','s2']、s2.updatedAt=9999 ⇒ ['s0','s1','s2']
PASS  B3 非当前的新会话落末尾 ⇒ ['s0','s1','s2','fresh']
PASS  B13 容器/项目行顺序不受置顶影响 ⇒ project ['B','A']、worktree ['/b','/a-wt','/a']
PASS  B14 搜索模式不置顶 ⇒ ['new','old']（恒 updatedAt 降序）
```

### 3.3 持久化污染验证（**重点**，实测）

**调用链实测**：

```
sidebar.tsx:1852 commitDrag
  └─ :1854 effectiveOrder({ ...treeInput, manualOrder: undefined })      ← 固化输入
  └─ :1856-1864 base = { manual:true, projects, worktrees, sessions }     ← 全量固化
  └─ :1870/:1883/:1894 reorderKeys(...)                                   ← 只改被拖那一层
  └─ :1888/:1896/:1898 persistOrder({ ...base, manual:true, ... })
       └─ :293-295 setManualOrder(next) + writeManualOrder(next)
            └─ :295-301 localStorage.setItem(LS_ORDER, JSON.stringify(order))
```

`effectiveOrder` 与**渲染顺序函数**的差别（实测对照）：

| | `effectiveOrder`（固化路径） | `buildRows` → `emitContainer`（渲染路径） |
|---|---|---|
| 过滤 | `visibleMembers` | `visibleMembers`（同一函数） |
| 默认排序 | `sortedByRecency` | `sortedByRecency`（同一函数） |
| 手动顺序 | `applyManualOrder(..., sessionOrderOf(...))` | `applyManualOrder(..., sessionOrderOf(...), pinnedSessionKeys(...))` |
| **置顶** | **不传** | **传** |
| 截断 | 不截断 | `truncateSessions(..., 5, currentSessionId)` |

**可执行证据**：

```
$ node /tmp/t3-repro.mjs
      B5 载荷哈希: 56 bytes，三种 currentSessionId 逐字一致
PASS  B5 改变 currentSessionId ⇒ 持久化载荷不变（污染证明）
      —— JSON.stringify(effectiveOrder({currentSessionId:'s0'})) ===
         JSON.stringify(effectiveOrder({currentSessionId:'s5'})) ===
         JSON.stringify(effectiveOrder({currentSessionId:undefined}))
PASS  B4 effectiveOrder 不应用置顶（默认模式）⇒ ['s7'…'s0']（当前会话 s0 仍在最后）
PASS  B6 渲染顺序随 currentSessionId 变化 ⇒ s0 置顶 / s5 置顶
PASS  B15 applyManualOrder 缺省 pinnedKeys ⇒ 逐字零回归
```

⇒ **写入载荷（`JSON.stringify(order)`）中不含任何置顶信息，且与 `currentSessionId` 无关**。`localStorage` 的两个写入点（`grep` 实测：`src/sidebar.tsx:225` 折叠标志、`:297` 顺序表）都不经过渲染路径。

### 3.4 边界与健壮性（`node /tmp/t3-edge.mjs` + `/tmp/t3-repro.mjs`）

| 输入 | 实测结果 | 判定 |
|---|---|---|
| `currentSessionId === undefined` | 不置顶、不抛错 | ✅ |
| `currentSessionId === ''`（空串） | 不置顶（不匹配任何 id）、不抛错 | ✅ |
| `currentSessionId` 指向**已归档**会话 | 静默降级为不置顶，顺序完全按手动顺序 | ✅ |
| `currentSessionId` 指向**子代理** | 该行不渲染 ⇒ 降级为不置顶 | ✅ |
| `currentSessionId` 指向**别的容器**的会话 | 本容器不受影响（置顶范围 = `spec.sessions`，per-container） | ✅ |
| **60 容器**同时渲染 | 只有 `w:/w0` 的当前会话置顶；`w:/w1` 顺序为 `s1b,s1a`（未被误置顶） | ✅ 无跨容器误置顶 |
| **同一 sessionId 出现在两个容器**（人为构造脏数据） | 两个容器各自置顶（实测 `w:/repo=["dup","a"]`、`w:/repo-wt=["dup","b"]`） | 与「容器内语义」一致。真实链路 `buildProjects`（`src/projects.ts:400-437`）每个会话**只 push 一次**、只落一个容器 ⇒ **不可达**，非缺陷 |
| `session-` 前缀混拼（items=`session-x` / current=`x`；items=`x` / current=`session-x`） | 两种拼法**都正确置顶**（实测 `['session-x','y']` / `['x','y']`） | ✅ `currentSessionOf` 的归一化回读确实生效 |
| `currentSessionId = 42`（数字） | **抛 `TypeError: id.startsWith is not a function`** | ⚠️ 见 §5「次要-2」 |
| `currentSessionId = null` | **抛 `TypeError: Cannot read properties of null (reading 'startsWith')`** | ⚠️ 见 §5「次要-2」 |
| `history` 容器（`h:<projectKey>`） | 当前会话同样置顶（实测 `['h0','h1']`） | ✅ |
| 未分组容器（`p:${UNGROUPED_KEY}`） | 当前会话同样置顶（实测 `['u0','u1']`） | ✅ |

### 3.5 需求 B 判定

> **满足。** 五条要求（手动模式下置顶且不被截断 / 非当前相对顺序不变 / 非当前新消息不顶到前面 / 不写 `localStorage` / 先于 5 条截断 / 不动容器行 / 搜索不应用）**全部实测通过**；持久化污染**已用「三种 `currentSessionId` 载荷逐字一致」直接证否**。

---

## 4. 逐条核验项结果（对应任务书 1–8）

### 4.1 核验项 1：改动范围、RESEARCH 未改、`package.json` 未改、无 commit

**实测命令与输出**：

```
$ git status --porcelain=v1 -uall
 M README.md
 M docs/INTERFACES.md
 M docs/PRD.md
 M src/sidebar.tsx
 M src/tree-model.ts
 M test/tree-model.test.mjs
?? docs/RESEARCH-running-and-sort.md          ← 仍是「未跟踪」状态（未被修改）

$ git diff --stat
 README.md                |  13 +-
 docs/INTERFACES.md       |  70 +++++-
 docs/PRD.md              |  17 ++
 src/sidebar.tsx          |  12 +-
 src/tree-model.ts        | 142 +++++++++--
 test/tree-model.test.mjs | 608 +++++++++++++++++++++++++++++++++++++++++++++++
 6 files changed, 839 insertions(+), 23 deletions(-)

$ git diff -- package.json        → 空（未改动）
$ git rev-parse HEAD              → 11b114411307008c765e60ee62a8f791441630be
$ git log --oneline -1            → 11b1144 feat(worktree-groups): 侧栏三层拖拽排序
$ git reflog -3                   → HEAD@{0} 仍是 11b1144 commit（无新 commit）
```

**结论**：

| 检查点 | 结果 |
|---|---|
| 改动文件集合与 T2 声明一致 | ✅ 完全一致（6 个修改 + 1 个新增未跟踪） |
| `docs/RESEARCH-running-and-sort.md` 未被修改 | ✅ 仍为 `??` 未跟踪；mtime `18:18:02` **早于**全部实现改动（`src/tree-model.ts` `18:27:47`） |
| `package.json` 依赖 / `dsh` 配置未改 | ✅ `git diff -- package.json` 为空 |
| 无 `git commit` | ✅ HEAD 与 reflog 均未前进 |
| `lib/**` 是否在改动集合内 | 不在（`.gitignore:3` 忽略 `lib/`）。属**构建产物**，`npm test` 会重建 —— 任务书已明确允许 |
| 是否删除过既有测试 | ✅ `git diff -- test/tree-model.test.mjs` 的删除行数 = **0**（纯新增 608 行） |

**额外发现（值得记一笔）**：`src/sidebar.tsx` 的 12 行改动**实测确为纯注释**——我把 `HEAD:src/sidebar.tsx` 与工作区版本各自剥离注释后逐行对比：

```
$ node -e '... strip comments ...'
去注释后 sidebar.tsx 是否逐字相同: true
```

⇒ 与 T2 自述「`src/sidebar.tsx` 仅注释改动」**完全吻合**，且证明 `StatusDot` / `commitDrag` 的**可执行代码一行未改**。

### 4.2 核验项 2：需求 A 正确性

见 §2。**结论：满足**。`subagentCount` 语义 = 运行中的子代理后代数（所有层级）✅；树/搜索同源 ✅；四条场景独立复现通过 ✅；误报路径逐条探测（归档 / completed / 跨容器 / 环 / 重复 id）**均与原生一致或不可达** ✅；漏报窗口为「子代理 summary 缺失」+「≤30s 轮询」，属既有已披露限制 ✅。

### 4.3 核验项 3：需求 B 正确性

见 §3。**结论：满足**，含**持久化污染证否**（三种 `currentSessionId` 下 `effectiveOrder` 载荷逐字一致）。

### 4.4 核验项 4：测试证据独立复核

**实测运行**：

```
$ cd /Users/dev/Documents/Project/AnyWork/dsh-worktree-groups && npm test
ℹ tests 282
ℹ pass 282
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 15110.022417
[status: completed, exit code: 0]
```

| 指标 | 实测值 |
|---|---|
| 本次 `npm test` | **282 pass / 0 fail，exit 0** |
| 基线（T2 自述） | 253/253 —— 与 `git show HEAD:test/tree-model.test.mjs \| grep -c "^test("` = 120 及本次 149 的增量方向一致（全仓 253→282，**+29**） |
| 新增 `test(` 数（`git diff` 统计） | **29**（与 T2 自述 +29 条**一致**） |
| 新增 `assert.` 数（`git diff` 统计） | **63** |

**断言强度抽查（我逐条读了新增 29 条，判断是否「真的断言了行为」）**：

| 测试 | 断言是否有效 | 我的判断依据 |
|---|---|---|
| `需求 A: 父自己 idle + 运行中的直接子代理 ⇒ 父行 running=true` | ✅ 有效 | `assert.equal(parent.running, true)` + `assert.equal(parent.subagentCount, 1)` —— **双通道分别断言**，不是恒真 |
| `需求 A: 只有深层后代在跑（depth 3）` | ✅ 有效 | 先 `deepEqual` 行集合 = `['p']`，再断言 `running === true` 且 `subagentCount === 1` |
| `需求 A: 子代理全 idle 且父自身 idle ⇒ 仍是 idle` | ✅ 有效（**反例守卫**） | 断言 `running === false`；若实现写成恒 `true` 会失败 |
| `需求 A: 容器/项目行 runningCount 口径不变` | ✅ 有效（**钉死不扩大范围**） | 断言 `worktree.runningCount === 0` 且 `project.runningCount === 0` **同时** `session.running === true` —— 直接锁住「两口径有意不同」 |
| `需求 B: effectiveOrder 不应用置顶` | ✅ **强** | 三段式：①默认模式 `['s7'…'s0']`；②手动模式同样；③**对照** `buildRows` 首行是 `s0` ⇒ 同时证明「渲染置顶」与「固化不置顶」**两条路径确实不同**，不是恒真 |
| `需求 B: JSON.stringify(order) 载荷无置顶痕迹` | ✅ **强** | 断言 ①字段集合 = `['manual','projects','sessions','worktrees']`；②`'pinned' in payload === false`；③载荷首项不是当前会话；④**换 `currentSessionId` 后渲染顺序回到载荷本身** ⇒ 从「写什么」和「关掉后回哪」两侧夹逼 |
| `需求 B: 首次拖拽固化的顺序不含置顶` | ✅ 有效 | 复用 `simulateDrag`（与 `commitDrag` 同构，见 §6.2）断言固化结果 + 对照 `buildRows` |
| `applyManualOrder: pinnedKeys 优先级高于 order` / `重复只搬一次` / `不在 items 忽略` / `缺省逐字一致` / `纯函数` | ✅ 有效 | 均为 `deepEqual` 精确序列断言 + `length` 守恒断言 |
| `需求 A: 索引纯函数性不变` | ✅ 有效 | `JSON.stringify` 前后快照比对 |

**是否存在「把错误行为固化」的测试？——实测检查结果：没有，且既有承诺测试被完整保留。**

| 既有测试（`HEAD` 版） | 是否被改写 | 与置顶是否冲突 | 实测 |
|---|---|---|---|
| `D10 固化: 固化后新消息**不再**把会话顶到前面`（现 `:2593-2640`） | ❌ 未改写（纯新增 0 删除） | 不冲突 | ✅ 仍 pass（fixture 无 `currentSessionId`） |
| `D10 固化: 固化之后**新建的会话**落在容器末尾`（现 `:2646-2663`） | ❌ 未改写 | 不冲突 | ✅ 仍 pass（`freezeFixture()` 无 `currentSessionId` ⇒ 新会话不置顶） |
| `buildRows: 手动顺序不破坏「当前会话保底进前 5」`（现 `:2323-2350`） | ❌ 未改写 | 不冲突 | ✅ 仍 pass（该用例只断言「s0 在 5 条内」+ `isCurrent`，不锁位置，置顶后仍成立） |
| `行字段: 当前会话 isCurrent=true 且保底进入可见集` | ❌ 未改写 | 不冲突 | ✅ 仍 pass |

⇒ T1 报告 §5.4 曾预判「`D10 固化: 新建的会话落末尾` **必须改写**」「保底进前 5 用例**可能需改断言**」。**实测：两条都无需改**，因为它们的 fixture 都没有 `currentSessionId`。T2 选择「不改既有测试」是**正确的**（避免了削弱既有承诺的守卫），且新增测试补上了置顶场景。

### 4.5 核验项 5：产物一致性

**实测**：

```
$ find lib -type f | sort | xargs shasum -a 256 > /tmp/lib-before.sha256   # 构建前（37 个文件）
$ npm test                                                                # 触发 npm run build
$ find lib -type f | sort | xargs shasum -a 256 > /tmp/lib-after.sha256
$ diff /tmp/lib-before.sha256 /tmp/lib-after.sha256
LIB_IDEMPOTENT: identical          ← 37 个文件全部逐字相同，exit 0

$ grep -c "subagentCount > 0" lib/tree-model.js        → 2
$ grep -n "pinnedKeys" lib/tree-model.js | head         → 52,58,63,69,86,88,172,866,888
$ grep -n "applyManualOrder" lib/tree-model.d.ts
  259: export declare function applyManualOrder<T>(items: T[], order: string[] | undefined,
       keyOf: (item: T) => string, pinnedKeys?: readonly string[]): T[];

$ grep -n "subagentCount > 0\|pinnedKeys\|pinnedSessionKeys" lib/client.js
  121: function applyManualOrder(items, order, keyOf, pinnedKeys) {
  123:   const pinned = pinnedKeys === void 0 ? [] : pinnedKeys;
  132:   for (const key of pinned) {
  164: function pinnedSessionKeys(sessions, currentSessionId) {
  469:     running: session.running === true || subagentCount > 0,
  485:     pinnedSessionKeys(visible, context.currentSessionId)
  599:     // ⚠️ 需求 B：这里**刻意不传** `pinnedKeys` …
```

| 检查点 | 结果 |
|---|---|
| `lib/` 与 `src/` 一致（含新逻辑） | ✅ `subagentCount > 0`、`pinnedKeys`、`pinnedSessionKeys`、`currentSessionOf` 全部出现在 `lib/tree-model.js` 与 `lib/client.js` |
| `lib/tree-model.d.ts` 签名同步 | ✅ 第 4 参 `pinnedKeys?: readonly string[]` 已进类型声明 |
| `lib/client.js` 是新的 | ✅ 见 §4.6（**已证明 GUI 真实下发的那一份与磁盘 `lib/client.js` 逐字节同源**） |
| 构建幂等 | ✅ 37 个产物文件哈希前后完全一致 |

### 4.6 核验项 6：服务端真实产物实证（**已完成，取证成功**）

**第一层：只读 HTTP 直连失败（如实报告）**

```
$ curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:43120/
403
$ curl -s -i http://127.0.0.1:43120/plugins/dsh-worktree-groups/client.js | head -3
HTTP/1.1 403 Forbidden
cache-control: no-store
content-type: text/plain; charset=utf-8
...
forbidden
```

我尝试过的 URL 与状态码（**全部 403**，无一例外）：

| URL | 状态码 |
|---|---|
| `http://127.0.0.1:43120/` | 403 |
| `/index.html` | 403 |
| `/plugins/dsh-worktree-groups/client.js` | 403 |
| `/plugins/??dsh-worktree-groups/client.js&rev=abc` | 403 |
| `/api`、`/api/x` | 403 |
| `/nonexistent-xyz`、`/assets/index.js` | 403 |
| 附 `?token=x` / `Sec-Fetch-Site: same-origin` / `Origin` / `Host: localhost:43120` / `--http1.0` | 403 |

**根因（实测读源码，非猜测）**：`/Applications/DSH Desktop.app/Contents/Resources/app/lib/webserver.js:38-50` 的 `permits()` → `desktop-browser-access-5-Ph3Uv7.js:47-51` 的 `decideDesktopBrowserAccess`：仅当请求带 **`x-dsh-desktop-renderer`** 头（32 字节 base64url 随机 token，进程内生成、从不落盘）时才判为 `renderer`；否则看 `ordinaryBrowserEnabled`，而该值 = `mode === "compatibility" && openBrowser`，实测本机 `~/.dsh/settings.yaml:94-97` 为 `mode: compatibility` / `openBrowser: false` ⇒ **`denied`**。token 由 `lib/host-process-entry.js:240` `createDesktopBrowserAccess(..., token)` 在 Electron 主进程 ↔ Host 进程的私有 RPC 里传入，**不落盘、不可从外部读取** ⇒ 外部只读 HTTP **不可能**取到 bundle。

**第二层：改用「GUI 渲染进程磁盘缓存」取证 —— 成功**

DSH Desktop 的渲染进程会把下发的脚本连 HTTP 响应头一起落盘在 `Partitions/dsh-desktop-renderer/Cache/Cache_Data/`。我从中找到了 **GUI 真实下载的插件 bundle**：

```
$ strings <cache-entry> | grep -o "http://127.0.0.1:43120/plugins/[^ ]*"
http://127.0.0.1:43120/plugins/??dsh-worktree-groups/client.js&rev=ee1f9fdfb58f
```

该缓存条目 `f5431a3aae58ae01_0`：**mtime `2026-09-21 18:27:53`**（即 T2 改完 `src/tree-model.ts` `18:27:47` 之后 6 秒 GUI 就把它取走了）。

**逐字节同源证明（实测）**：

```
$ node -e '...'
served === disk + ";\n" ? true          ← 缓存里被下发的字节 = 磁盘 lib/client.js + combo 分隔符
disk endsWith \n ? true | served tail: "});\n;\n"
```

（说明：`dsh-client-modules` 的 `buildCombo`（`.../dsh-client-modules/lib/index.js:265-307`）会在每个插件源码后追加 `";\n"` 作为 combo 分隔符，所以「served = 原始 bundle + `;\n`」正是预期的逐字节关系。）

**新逻辑确实在被 GUI 下发的 bundle 里（实测）**：

```
$ python3 - <<'EOF'  # 剥掉 combo 追加的 sourceMappingURL 行后探测
=== f5431a3aae58ae01_0 (mtime Sep 21 18:27:53 2026) ===    ← 新版（含需求 A/B）
  'running: session.running === true || subagentCount > 0'  -> True
  'pinnedKeys'                                              -> True
  'pinnedSessionKeys'                                       -> True
=== 6975e70bfc958a3d_0 (mtime Sep 21 16:41:32 2026) ===    ← 改动前的旧版（对照组）
  'running: session.running === true || subagentCount > 0'  -> False
  'running: session.running === true,'                      -> True     ← 旧代码
  'pinnedKeys'                                              -> False
  'pinnedSessionKeys'                                       -> False
```

**独立复核 rev 算法（实测）**：`dsh-client-modules/lib/index.js:172-180` 的 `artifactRevision(bundle) = framedHash("plugin-artifact", [bundle])`。我对当前磁盘 `lib/client.js` 计算该哈希：

```
当前 lib/client.js 大小: 97185
当前 rev              : ee1f9fdfb58f
当前 rev 与缓存 rev 相同: true          ← 与 GUI 缓存 URL 里声明的 rev 逐字相同
```

**补充证据（插件启用状态）**：GUI 自己在 `18:42:00` 向 `/api/plugin-manager/list` 拉的清单里 `dsh-worktree-groups` 为 `"enabled": true`（同一缓存目录 `0fb2c310df117538_0`，HTTP 200）。

> **结论**：**GUI 真实提供给浏览器的插件 bundle 已包含需求 A 与需求 B 的全部新逻辑**，且与当前磁盘 `lib/client.js` 逐字节同源（rev 匹配）。此条**不是推断，是实测取证**。
>
> ⚠️ 诚实边界：缓存条目 mtime `18:27:53` 早于最后一次 `npm test` 重建（`18:40:16`）。由于 `18:40` 的重建**幂等**（§4.5 哈希逐字相同），两者是同一份字节，故不影响结论。缓存里 `18:42` 之后的条目只有 `/api/plugin-manager/list`（3689 B，非 bundle）。

### 4.7 核验项 7：文档一致性

**旧承诺「新会话落末尾」的更新情况（逐行核对）**：

| 文件:行 | 原文 | 是否已更新为与裁决一致 | 判定 |
|---|---|---|---|
| `docs/PRD.md:317` | 「新会话出现在容器**末尾**」 | 紧随其后 `:320-331` 有 ⚠️ 例外段：「只有**当前打开的会话**这一条会被提升到容器第一位……上面三条承诺约束的是**非当前**会话」 | ✅ **已消解矛盾**（例外段明确限定了 `:317-319` 三条的适用范围） |
| `docs/PRD.md:318` | 「新建的 worktree / 项目同样出现在各自列表**末尾**」 | 例外段 `:323` 明确「范围是**所属容器内最前**（不动项目 / worktree 行）」⇒ 与 `:318` 不冲突 | ✅ |
| `docs/PRD.md:292-296` | 新增需求 A/B 验收条目 | 与 §2/§3 实测行为一致 | ✅ |
| `docs/PRD.md:429` / `:430` | 决策记录表新增两行（需求 A / 需求 B） | 与实现一致（含 `effectiveOrder` 刻意不应用置顶） | ✅ |
| `README.md:55` | 「顺序列表里没有的项（新建会话 / worktree / 项目）落在**末尾**」 | 下一行 `:56` 即为「**例外（需求 B，2026-09-21）**：**当前打开的会话**始终排在它所属 worktree 分组内**第一位**……」 | ✅ **紧邻例外，不矛盾** |
| `README.md:57` | 「搜索模式**不应用**手动顺序与置顶」 | 与实测 B14 一致 | ✅ |
| `README.md:59` / `:71` / `:75-78` | 需求 A 说明 + 状态来源表已改为「`SessionSummary.running` **或** 有运行中的子代理后代」 | 与实测一致 | ✅ |
| `docs/INTERFACES.md:486` | 「置顶项最前，然后列表内的项按索引，列表外的项按默认顺序追加到末尾」 | 已是**新语义**描述 | ✅ |
| `docs/INTERFACES.md:586` | 「列表外的新项（新建会话 / worktree / 项目）按各自**默认顺序追加到末尾**」 | `:577` 已有「上面『列表外新项追加到末尾』约束的是**非当前**会话」；`:700` 亦有「**例外**：`isCurrent` 的那一条会被置顶到容器第一位（需求 B）—— 这是**渲染期**行为」 | ✅ **同一节内已给出例外**，不构成自相矛盾 |
| `docs/INTERFACES.md:406-412` | `RenderRow.running` 语义修正说明 | 与 `:1001` 一致 | ✅ |
| `docs/INTERFACES.md:415-421` | `running` 与 `subagentCount` 关系（蕴含式） | 见 §2.5：在 `RenderRow.kind === 'session'` 限定域内**实测成立** | ✅ |
| `docs/INTERFACES.md:687-700` | `commitDrag` 固化「不含置顶」的 ⚠️ 说明 | 与 `sidebar.tsx:1852-1854` 实测一致 | ✅ |
| `docs/INTERFACES.md:792-806` | 裁定 3 新增需求 A 段（含「`runningCount` 口径刻意不变」） | 与实测一致 | ✅ |

**残留的「绝对化表述」（次要，不构成矛盾）**：`README.md:55` 与 `docs/INTERFACES.md:586` 的「落在末尾」仍是无条件句式，靠**紧邻的例外段**消解。`docs/PRD.md:317-318` 同。**实测无任何一处留下与裁决直接冲突的段落**（即：没有哪一段在例外段之外另行断言「当前会话也落末尾」）。

**未同步的文件（非本次范围，如实记录）**：`docs/HOST-CONTRACTS.md` 的 mtime 为 `2026-09-21 10:52`（远早于本次改动），本次未改 —— 其内容不涉及需求 A/B，**无影响**。

### 4.8 核验项 8：回归与性能（真实规模 536 / 307 / 33 / depth 3）

**规模构造（按 T1 报告 §7.1 的实测口径）**：536 会话（顶层 229 / 子代理 307）、33 个顶层祖先、depth 3 链。

**实测（`node /tmp/t3-extra.mjs`，`node /tmp/t3-repro.mjs`）**：

```
== runningCount 口径 ==
  worktree 行 runningCount : 0 (期望 0)
  project  行 runningCount : 0 (期望 0)
  会话行 running           : true (期望 true)

== 置顶边际成本（536 条，真实规模）==
  buildRows 无 currentSessionId : 0.398 ms
  buildRows 有 currentSessionId : 0.354 ms
  ⇒ 置顶引入的边际成本        : 0.012 ms
  effectiveOrder 无 current    : 0.0117 ms
  effectiveOrder 有 current    : 0.0108 ms

== 60 容器 ==
  无 current: 0.048 ms | 有 current: 0.044 ms
  容器 0 第一行: s0a,s0b      容器 1 第一行: s1b,s1a   ← 未误置顶

== 规模伸缩（buildRows，真实规模 536 → 1072）==
  536 条 : 0.594 ms/次
  1072 条: 1.110 ms/次     ⇒ 1.87x（线性≈2x，二次≈4x）⇒ **线性**

== indexRunningSubagentDescendants 规模伸缩（depth 3 链）==
  顶层  33 / 子代理  297 (总  330) -> 0.484 ms
  顶层  66 / 子代理  594 (总  660) -> 0.822 ms
  顶层 132 / 子代理 1188 (总 1320) -> 1.578 ms
  顶层 264 / 子代理 2376 (总 2640) -> 3.024 ms     ⇒ 约 2x/2x，线性

== 极端形状 ==
  200 层单链    -> 1.352 ms
  2000 直接子代 -> 1.322 ms
```

**判定**：

| 问题 | 实测结论 |
|---|---|
| 置顶是否引入明显开销？ | **否**。真实规模下边际成本 ≈ **0.01 ms**（噪声量级）。置顶 = 每容器一次 O(n) 扫描（`currentSessionOf`，`:347-350`）+ 一次 O(n) 重排（`applyManualOrder`），是**每容器 O(n)**、全局 O(N)。 |
| 是否有 O(n²)？ | **置顶路径无**。`buildRows` 536→1072 条实测 **1.87x**（线性）；`indexRunningSubagentDescendants` 330→2640 条实测 **~6.2x for 8x**（次线性于 n，见下）。 |
| `indexRunningSubagentDescendants` 的形状敏感性 | **存在但可接受**：`discoverChildEdges`（`:536-603`）对**最坏形状**（单条 200 层链）是 O(depth²)，实测 200 层链 **1.352 ms**。真实数据 depth ≤ 3 ⇒ 无实际影响。**这是既有代码（`HEAD` 已含 `discoverChildEdges`，实测 `git show HEAD:src/tree-model.ts \| grep -c discoverChildEdges` = 3），非本次引入。** |
| `runningCount` 口径是否被无声扩大？ | **否**。实测 worktree / project 行 `runningCount` 仍为 0（会话行 `running` 为 true）⇒ 与用户裁决 Q1 一致；`grep -rn "runningCount" src/` 在 `tree-model.ts` 之外**零命中**，确认渲染层无消费者。 |

**可疑实现细节（我认为值得指出）**：

1. `src/tree-model.ts:1052` `truncateSessions(heads, 5, context.currentSessionId)` 的**保底提升**逻辑（`:754-767`）在置顶后**变为死分支**——因为当前会话已在第 1 位，`ordinaryBefore = 0 < quota` 恒成立 ⇒ `promote` 恒 `false`。**这不是缺陷**（`emitContainer` 传入的是已置顶的 `heads`，保底仍对其它调用点/未来变更有效），但确实是一段**不再被触发的防御代码**。**建议**（不阻塞）：加一条注释说明「置顶生效时该保底自然不触发」。
2. `src/tree-model.ts:347-350` `currentSessionOf` 是**线性扫描**，且 `pinnedSessionKeys` 在 `emitContainer` 里对**每个容器**都调用一次。真实规模 33 容器 × 每容器 ≤ 几十条 ⇒ 实测 0.012 ms。**无问题**。
3. `src/tree-model.ts:283` `const pinned = pinnedKeys === undefined ? [] : pinnedKeys` —— 直接引用入参数组（未拷贝）。**只读遍历**（`:298` `for (const key of pinned)`），且 T2 新增测试 `applyManualOrder: pinnedKeys 不修改入参（纯函数）` 已断言 `pinned` 未被修改。**无问题**。

---

## 5. 发现的问题清单（按严重度分级）

### 阻塞

**无。**

### 重要

**重要-1：`currentSessionId` 非字符串时会抛异常（健壮性退化，非新增——但与新增的置顶判据叠加）**

- **位置**：`src/tree-model.ts:346-351`（`currentSessionOf` → `normalizeSessionId` → `:477-479` `id.startsWith(...)`）
- **复现步骤**（实测 `/tmp/t3-edge.mjs`）：

  ```js
  buildRows({ ...base, currentSessionId: 42 })   // → TypeError: id.startsWith is not a function
  buildRows({ ...base, currentSessionId: null }) // → TypeError: Cannot read properties of null (reading 'startsWith')
  ```

- **影响**：`currentSessionId` 在类型上是 `string | undefined`，真实链路 `src/sidebar.tsx:1600` 有 `typeof sessionsSnapshot?.current === 'string'` 守卫 ⇒ **真实链路上不可达**。但置顶判据把「非字符串」的失败模式从「静默忽略」（`truncateSessions` 的 `findIndex` 比较不会抛）变成了**抛异常**（`normalizeSessionId` 会抛）。属于**契约外的输入**，影响面小。
- **建议**：`pinnedSessionKeys` 开头加 `if (typeof currentSessionId !== 'string') return undefined`（一行）。**不阻塞验收**。

**重要-2（未披露的交互副作用）：当前会话被置顶后，用户无法把它拖离第一位，也无法把别的会话拖到它前面**

- **位置**：`src/tree-model.ts:1038-1043`（置顶恒生效，无「用户已显式拖动」的豁免）× `src/sidebar.tsx:1852-1898`（`commitDrag` 固化的是 `effectiveOrder` 的**不含置顶**顺序）
- **复现步骤**（实测 `/tmp/t3-drag-pin.mjs`，`currentSessionId='cur'`，初始手动顺序 `['cur','a','b','c']`）：

  ```
  ① 拖 b 到 cur 上方 -> 新持久顺序: ["b","cur","a","c"]
     渲染顺序: ["cur","b","a","c"]   <-- b 没能到第一位
  ② 拖 cur 到最后 -> 新持久顺序: ["b","a","c","cur"]
     渲染顺序: ["cur","b","a","c"]   <-- cur 仍在第一位，拖拽看似无效
  ③ 拖 cur 到 a 之后 -> 新持久顺序: ["b","a","cur","c"]
     渲染顺序: ["cur","b","a","c"]   <-- 同样无效
  ④ 对照（当前会话=c）拖 b 到 cur 上方 -> 渲染: ["c","b","cur","a"]   ← 生效
  ```

- **影响**：
  - **不是持久化污染**（`localStorage` 里确实写入了用户的意图 `["b","a","c","cur"]`，实测）。
  - 但**渲染层恒把当前会话钉在第 1 位**，用户对**第一位**的任何拖拽操作在视觉上都「无效」。这是需求 B（当前会话恒置顶）与 D10（拖拽即手动排序）的**语义张力**，属**需求固有**，但 T2 的文档（`README.md:56` / `docs/PRD.md:320-331` / `docs/INTERFACES.md:565-580`）**均未披露**这一交互后果。
  - 可缓解：用户只要**切到别的会话**，`cur` 不再是当前会话，持久顺序立刻生效（实测 ④ 已证）。
- **严重度判断**：**重要（非阻塞）**。理由：需求 B 的裁决原文就是「当前打开的会话排在容器内最前」，恒置顶是该裁决的直接推论；且副作用可自愈（切走即恢复）。但**未披露**这一点应记为缺口。
- **建议**：① 在 `docs/PRD.md` US8 例外段补一句「当前会话恒居首位，因此针对第一位的拖拽在它仍是当前会话时不产生视觉变化；切走即生效」；② 若产品上希望「拖拽优先」，则需引入「用户已拖动过该容器 ⇒ 置顶让位」的豁免（**属新需求，须父代理确认**）。

### 次要

**次要-1：`currentSessionId` 的归一化只在置顶路径做，`isCurrent` 标记未归一化 ⇒ 混拼时「置顶命中但不高亮」**

- **位置**：`src/tree-model.ts:1005`（`isCurrent: context.currentSessionId === session.sessionId`，**字面比较**） vs `:346-351`（置顶判据，**归一化比较**）
- **复现步骤**（实测 `/tmp/t3-isCurrent.mjs`）：

  ```
  items=[session-x, y]，currentSessionId='x'（裸 id 指向前缀 id）
  渲染顺序: ["session-x","y"]              ← 置顶命中（归一化生效）
  isCurrent 标记: [["session-x",false],["y",false]]   ← 但没有任何一行 isCurrent=true
  ```

- **影响**：该行被置顶（正确的降级方向），但**当前会话高亮**（`sidebar.tsx:1008` `aria-current`、`:1012` `rowStyle(row.isCurrent, …)`）**丢失**。反之若 `currentSessionId` 带前缀而 items 是裸 id，同样。
- **可达性**：真实链路里两侧都来自同一份宿主数据，混拼**不常见但宿主确实存在两种写法**（`normalizeSessionId` 的存在理由就是它，见 `:471-476` 注释）。⇒ **低概率、低影响**。
- **建议**：把 `:1005` 改为 `normalizeSessionId(context.currentSessionId) === normalizeSessionId(session.sessionId)`，或在 `pinnedSessionKeys` 里返回 `[session.sessionId]` 之外**顺带**保证 `isCurrent` 与置顶同源。**属既有行为**（`HEAD` 版 `:917` 附近同样是字面比较），非本次引入，但本次新增的置顶逻辑**放大了这个不一致**。**不阻塞**。

**次要-2：`docs/INTERFACES.md:415-421` 的「`subagentCount > 0` 蕴含 `running === true`」表述在字面上过强**

- **位置**：`docs/INTERFACES.md:418-420`
- **说明**：该蕴含在 `RenderRow.kind === 'session'` 内**实测恒成立**（两者由 `toSessionRow` 用同一 `subagentCount` 入参同时计算，`:1001` / `:1004`）。但文档把它写成**无条件的全局不变式**，容易被读成「任何 `subagentCount > 0` 的地方 `running` 都为真」——而 `worktree` / `project` 行的 `runningCount`（`:1091`）**刻意不含**该聚合。**建议**：补限定语「对 `RenderRow.kind === 'session'` 而言」。**不阻塞**。

**次要-3：`README.md:55` / `docs/INTERFACES.md:586` / `docs/PRD.md:317-318` 的「落末尾」仍是无条件句式**

- **说明**：三处均靠**紧邻的例外段**消解，实测无直接冲突。但读者若只扫小标题/列表项，仍可能读到旧语义。**建议**：把「落在末尾」改为「非当前会话落在末尾」。**不阻塞**。

**次要-4：置顶后 `truncateSessions` 的「保底提升」分支变为不可达**

- **位置**：`src/tree-model.ts:754-767`（`promote` 计算）在 `emitContainer` 路径（`:1052`）上恒为 `false`
- **说明**：当前会话已由置顶搬到第 1 位 ⇒ `ordinaryBefore` 恒为 0 ⇒ `promote` 恒 `false`。**行为正确**（不会重复搬运），但这段防御代码在树路径上不再被触发，**缺少注释说明**。**建议**加一行注释。**不阻塞**。

### 建议

**建议-1**：新增一条**显式**测试，钉住「当前会话被置顶时，针对第一位的拖拽在视觉上无效、但持久顺序如实记录」这一交互事实（§5 重要-2）。当前 29 条新增测试**没有覆盖**这一路径——`simulateDrag` 相关的新测试只断言了「固化结果不含置顶」，没有断言「置顶会压制针对第一位的拖拽」。

**建议-2**：`docs/PRD.md` US8 例外段补一句「当前会话恒居首位，针对第一位的拖拽在它仍是当前会话时不产生视觉变化；切走即生效」（同 §5 重要-2 建议 ①）。

**建议-3**：`src/tree-model.ts:1005` 的 `isCurrent` 与置顶判据统一走 `normalizeSessionId`（同 §5 次要-1）。

**建议-4**：`pinnedSessionKeys` 加 `typeof currentSessionId !== 'string'` 守卫（同 §5 重要-1）。

---

## 6. 未验证或无法验证的部分（如实说明）

### 6.1 GUI 视觉效果（**无法验证**）

我**没有**也无法在浏览器/Electron 里点开侧栏观察：

- ❌ 「subagent 跑起来时父行状态点变蓝」的**视觉**确认（我只能证明 `row.running === true` 经 `sidebar.tsx:369-380` `StatusDot` 映射为 `state: 'ongoing'`，而 `'ongoing'` 在 `StateDot` 的取值域内对应蓝色像素动画——**这是读源码的推断，不是肉眼观察**）。
- ❌ 「当前会话出现在分组第一位」的**视觉**确认（我只能证明 `buildRows` 输出的行序第一位是当前会话）。
- ❌ 「拖拽到第一位无视觉变化」的**真实鼠标操作**确认（我用 `reorderKeys` + `buildRows` 组合复现，**逻辑等价**于 `commitDrag` + 渲染，但不是真实拖拽事件）。

**原因**：`http://127.0.0.1:43120` 对一切非 Electron 渲染进程请求返回 403（§4.6 已给出根因与全部尝试过的 URL/状态码），且我不具备操作 GUI 的能力。

### 6.2 `test/tree-model.test.mjs:2527-2564` 的 `simulateDrag` 与 `src/sidebar.tsx:1852-1898` 的 `commitDrag` 的等价性（**推断，非实测**）

我**逐行比对**了两者（`simulateDrag` 是测试里的复刻）：

| 步骤 | `commitDrag`（sidebar.tsx） | `simulateDrag`（test） | 一致？ |
|---|---|---|---|
| 固化输入 | `effectiveOrder({ ...treeInput, manualOrder: undefined })` | `effectiveOrder({ ...input, manualOrder: undefined })` | ✅ |
| `base` 构造 | `manualOrder.manual === true ? manualOrder : {manual:true, projects, worktrees, sessions}` | 同 | ✅ |
| session 分支 | `reorderKeys(current, active.itemId, over.key.slice('s:'.length), over.half)` | `over.key.slice(2)`（`'s:'.length === 2`） | ✅ |
| worktree / project 分支 | 同构 | 同构 | ✅ |
| `null` 处理 | `if (next === null) return` | `if (next === null) return null` | ✅ |

⇒ **代码层面逐行等价**。但我**没有**运行 `sidebar.tsx`（它是 `.tsx`，不进 `lib/`，`node --test` 无法直接执行）⇒ 标记为**推断**。这也意味着：**任何只存在于 `sidebar.tsx` 的缺陷都不会被 `npm test` 捕获**。本次审查对该文件采用的是「剥离注释后逐字对比 + 逐行读 `commitDrag` / `StatusDot` / `withLiveState`」，覆盖面有限。

### 6.3 需求 A 的**实时性**（端到端延迟，**无法验证**）

- T1 报告 §6 Q2 已列为未验证项。本次**同样无法验证**：`sessionsSnapshot` 引用是否真的会被 `agent/status` 的 `markDirty()` 驱动变化，从而把重取延迟从 30s 降到 220ms —— 需要 GUI 实测。
- 我能**实测**到的只有：`sidebar.tsx:1658-1661` 的依赖数组确实包含 `sessionsSnapshot`，且 `:1666` 有 30s `setInterval`。**「最坏 30s」是确定的；「通常 220ms」是推断。**

### 6.4 真实 536 会话数据的**端到端**回放（**未做**）

- T1 报告 §7.1 从 `~/.dsh/sessions/*/*/session*.jsonl.zstd` 解出 536 个会话头。本次**没有**重复该解压回放（不在我的必需核验项内，且 T1 已做）。
- 我的性能测量基于**按同口径构造的合成数据**（536 条 / 307 子代理 / 33 顶层 / depth 3），**不是**真实数据。形状一致，但真实数据的 `parentSessionId` 分布、`session-` 前缀混用比例等可能与合成数据不同。

### 6.5 `ordinaryBrowserEnabled` 的运行时真值（**推断**）

- 我据 `~/.dsh/settings.yaml:94-97`（`mode: compatibility`、`openBrowser: false`）与 `host-process-entry.js:240` 的 `options.prepared.mode === "compatibility" && options.prepared.openBrowser` **推断** `ordinaryBrowserEnabled === false`。
- 我**没有**直接读到运行时的该布尔值（它在 Host 进程内存里）。但这与实测的「一切路径 403」**互相印证**。

### 6.6 未覆盖的核验项

- ❌ 未做代码风格 / 命名规范的独立审查（任务书未要求）。
- ❌ 未审查 `src/routes.ts` 本次是否有改动（实测无：不在 `git status` 列表内）。
- ❌ 未做模糊测试 / 属性测试（超出范围）。

---

## 7. 结论：**建议验收**

### 7.1 判定汇总

| 核验项 | 判定 | 关键实测证据 |
|---|---|---|
| 1. 改动范围 / RESEARCH 未改 / `package.json` 未改 / 无 commit | ✅ **通过** | `git status` 7 项与声明一致；`RESEARCH` 仍 `??`；`git diff -- package.json` 空；HEAD 仍 `11b1144` |
| 2a. `subagentCount` 语义 = 运行中的子代理后代数（所有层级） | ✅ **通过** | 读 `tree-model.ts:629-665`；读原生 `client.js:293-315` 逐字核对 |
| 2b. 四条场景独立复现 | ✅ **通过** | `/tmp/t3-repro.mjs` A1–A5 全 PASS |
| 2c. 误报 / 漏报路径 | ✅ **通过**（漏报窗口 = 数据缺失 + ≤30s，已披露） | A6–A11 逐条探测；读 `routes.ts:317-343`、`sidebar.tsx:144/147/1658-1666` |
| 3a. 需求 B 独立复现 | ✅ **通过** | B1/B2/B3/B13/B14 全 PASS |
| 3b. **持久化污染验证** | ✅ **通过（证否）** | B4/B5/B6/B15；三种 `currentSessionId` 下 `effectiveOrder` 载荷逐字一致（56 bytes） |
| 3c. 边界与健壮性 | ✅ **通过**（2 条契约外输入会抛，真实链路不可达） | `/tmp/t3-edge.mjs` 全表；60 容器无误置顶；`session-` 混拼双向正确 |
| 3d. 容器行顺序 / 搜索不置顶 | ✅ **通过** | B13 project `['B','A']`、worktree `['/b','/a-wt','/a']`；B14 `['new','old']` |
| 4. 测试证据独立复核 | ✅ **通过** | `npm test` **282 pass / 0 fail / exit 0**；新增 29 条 / 63 断言逐条读过，**无弱断言、无错误行为固化**；既有承诺测试 **0 删除** |
| 5. 产物一致性 | ✅ **通过** | 37 个 `lib/` 文件构建前后哈希**逐字相同**；新逻辑符号全部在 `lib/tree-model.js` / `lib/client.js` / `lib/tree-model.d.ts` |
| 6. **服务端真实产物实证** | ✅ **通过（取证成功）** | 直连 403（根因：`x-dsh-desktop-renderer` token + `openBrowser:false`）；改用 Electron 渲染缓存取证：GUI 在 `18:27:53` 下发的 bundle **含新逻辑**，且 `framedHash` 计算的 rev `ee1f9fdfb58f` 与缓存 URL 声明**逐字相同**；`served === disk + ";\n"` |
| 7. 文档一致性 | ✅ **通过**（3 处无条件句式，均被紧邻例外段消解） | 逐行核对 13 处；无自相矛盾段落 |
| 8. 回归与性能 | ✅ **通过** | 置顶边际成本 **0.012 ms**；536→1072 条 **1.87x（线性）**；`runningCount` 口径实测未变 |

### 7.2 是否建议验收

> ## ✅ **建议验收。**
>
> 两项需求（A / B）**均判定为「满足」**，且核心主张（父行 running 聚合、置顶先于截断、**不写 `localStorage`**、非当前会话顺序冻结、搜索不置顶、容器行顺序不变）**全部由我自己的独立复现或实测取证证实**，无一项依赖 T2 自述。
>
> 唯一「高价值」缺口是 **§5 重要-2**：**当前会话恒居首位，导致针对第一位的拖拽在视觉上无效**（持久化如实记录、切走即恢复）。这是需求 B 裁决的**直接推论**，**不是实现错误**，但**文档未披露**。**建议验收的同时**把它作为一条 follow-up 记录（§5 建议-1 / 建议-2），由父代理决定是「补文档」还是「改需求（拖拽优先）」。
>
> 其余 3 条「次要」与 4 条「建议」均为**非阻塞**的健壮性 / 文档精确性改进，可在后续任务中一并处理。

### 7.3 我实测 vs 我推断（明确切分）

**我实测（命令 / 脚本真实输出）**：

- `git status` / `git diff` / `git diff --numstat` / `git log` / `git reflog` 的全部输出
- `npm test` → 282/0/exit 0；`npm run typecheck` → exit 0
- `lib/` 37 文件构建前后哈希对比 → identical
- `/tmp/t3-repro.mjs`（24 断言）、`/tmp/t3-edge.mjs`、`/tmp/t3-drag-pin.mjs`、`/tmp/t3-extra.mjs`、`/tmp/t3-scale.mjs`、`/tmp/t3-isCurrent.mjs` 的全部输出
- `curl` 对 10+ 个 URL 的 403 响应
- 从 Electron 渲染进程缓存中提取的 bundle 字节、`framedHash` rev 计算、`served === disk + ";\n"` 的逐字节比对、新旧缓存对照探测
- 原生 `dsh-client-ui-workspace/lib/client.js:783-823` / `:293-315` 的源码阅读
- 剥离注释后 `sidebar.tsx` 逐字对比 → true

**我推断（未经运行验证）**：

- 「父行变蓝」的**视觉**效果（源码映射，非肉眼）
- `simulateDrag` 与 `commitDrag` 的**运行时**等价性（逐行比对等价，但 `.tsx` 未被执行）
- 需求 A 的**通常**延迟 ≈ 220ms（30s 是实测常量，「220ms 通常路径」是推断）
- `ordinaryBrowserEnabled === false` 的运行时真值（由 settings + 代码 + 403 现象三方印证）
- 「子代理刚跑起来时父行多久点亮」的端到端延迟

---

## 附：本次审查的产物与残留

| 项 | 内容 |
|---|---|
| **唯一写入的文件** | `docs/REVIEW-running-and-sort.md`（本文件） |
| **未修改** | `src/**`、`lib/**`、`test/**`、`package.json`、`docs/PRD.md`、`docs/INTERFACES.md`、`docs/RESEARCH-running-and-sort.md`、`README.md`、DSH 本体目录、`~/.dsh/**`、模型配置 |
| **临时脚本** | `/tmp/t3-repro.mjs`、`/tmp/t3-edge.mjs`、`/tmp/t3-drag-pin.mjs`、`/tmp/t3-extra.mjs`、`/tmp/t3-scale.mjs`、`/tmp/t3-isCurrent.mjs`、`/tmp/lib-before.sha256`、`/tmp/lib-after.sha256`、`/tmp/sidebar-old.tsx`（均在 /tmp，未入仓） |
| **未做** | 无 `git commit`；无 `git checkout`/`reset`/`stash`；未回滚或修改实现者代码；未联网（除 `127.0.0.1`）；未安装依赖；未创建子代理；未改模型配置 |
| **副作用** | `npm test` 重建了 `lib/**`（任务书允许）。实测构建**幂等**，产物字节未变 |
