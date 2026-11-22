# 独立审查报告：T5「顶部区」排序规则（T6）

- **任务 ID**：T6（独立审查 + 验证；只读，唯一写入本文件）
- **审查对象**：`/Users/dev/Documents/Project/AnyWork/dsh-worktree-groups`（基线 `11b1144` + T5 未提交改动）
- **角色声明**：**不采信实现者自述**。本报告全部结论来自我本人读代码、跑命令、构造反例；每条附命令 / 退出码 / 真实输出片段或 `file:line`。区分「我实测」与「我推断」。
- **审查时间**：2026-09-21 22:26–23:0x（本机 CST）

---

## ① 审查范围与独立复现方法

### 1.1 审查范围

| 范围 | 具体对象 |
|---|---|
| 实现代码 | `src/tree-model.ts`（742 增 / 17 删）、`src/sidebar.tsx`（133 增 / 3 删） |
| 测试 | `test/tree-model.test.mjs`（1489 增 / 0 删） |
| 文档 | `README.md`、`docs/PRD.md`、`docs/INTERFACES.md` |
| 产物 | `lib/**`（构建产物）、GUI 缓存 bundle |
| 硬约束 | 用户 `localStorage`、`~/.dsh`、三份只读 md、`package.json`、HEAD |

### 1.2 独立复现方法（全部为我自己构造，不依赖 T5 的测试）

1. **纯函数对抗性 harness**：在 `/tmp/t6/` 下新建 `harness.mjs` + `t1.mjs`–`t24.mjs` 共 20 余个脚本，直接 `import` 仓库的 `lib/tree-model.js`（构建产物，非 `src/`），用**真实 id 形态**（带 `session-` 前缀）、**真实数据**（从 `~/.dsh` 与用户 localStorage 解出的真实会话）构造反例。
2. **真实数据取证**：自行解析用户真实 localStorage 排序表（LevelDB SSTable + snappy，自写解压器 `/tmp/t6/lv.py`），核对 T4 声称的 4 条旧表外会话；从 `~/.dsh/sessions/**/session.v3.jsonl.zstd` 读取真实会话头（`zstd -dc`）。
3. **基线对照**：`git show HEAD:test/*.mjs` 导出到 `/tmp/t6/baseline/` 并实跑，得到**真实**基线测试数（不采信「282」这一自述）。
4. **GUI bundle 取证**：读 Electron 渲染进程磁盘缓存，用宿主 `dsh-client-modules` 的 `framedHash` 算法复算 rev，与磁盘 `lib/client.js` 做**逐字节**对比。
5. **载荷逐字对比 + 对照组**：对「运行时置顶不写 localStorage」这一断言，同时验证「输出恒定」**与**「渲染确实随 topZone 变化」，排除恒真断言。

### 1.3 关键复现命令

```bash
# 基线测试数（真实测量，非自述）
git show HEAD:test/tree-model.test.mjs > /tmp/t6/baseline/tree-model.test.mjs   # 及其余 4 个文件
node --test /tmp/t6/baseline/*.mjs      # ⇒ tests 253 / pass 253 / fail 0
# 当前全量
npm test                                # ⇒ tests 337 / pass 337 / fail 0
# 对抗性反例
node /tmp/t6/t1.mjs  … node /tmp/t6/t24.mjs
```

---

## ② 逐条裁决核验（D1–D6）

### D1 —— 手动模式与默认模式都正确；不代改用户 localStorage ⇒ **满足**

| 子项 | 判定 | 证据 |
|---|---|---|
| 默认模式（`manual !== true`）顶部区生效 | ✅ | `/tmp/t6/t19.mjs`：`buildRows(fixture(8 条, { manualOrder:{manual:false}, topZone:{runningSessionIds:['s6']} }))` ⇒ `["s6","s7","s5","s4","s3"]`（s6 置顶） |
| 默认模式不写表、不建表 | ✅ | 同上：`insertSessionAtFront({manual:false}, …)` ⇒ `undefined` |
| 不代改用户 localStorage（代码层） | ✅ | `src/sidebar.tsx:1890` `if (manualOrder.manual !== true) return`；`src/tree-model.ts:857` `if (order.manual !== true) return undefined` |
| 不代改用户 localStorage（文件层） | ✅ | 见 §④「硬约束」：`Local Storage/leveldb/000854.log` mtime `22:23:05`，`000856.ldb` mtime `22:12:23`；本审查在 22:26–23:0x 期间**未再变动**；且 `000854.log` 内容仅 `dsh.sessions.current`，无 `dsh-worktree-groups.order` 写入 |

### D2 —— 新会话插入容器最前 + 写入固化表；幂等；仅手动模式；只写自己 ⇒ **不满足（发现 2 处缺陷）**

| 子项 | 判定 | 证据 |
|---|---|---|
| 纯函数层「插到表首 + 去重 + 幂等」 | ✅ | `/tmp/t6/t1.mjs` ⑥：`insertSessionAtFront({manual:true,sessions:{'w:/repo':['o0','o1']}}, 'w:/repo','n1',…)` ⇒ `["n1","o0","o1"]`，二次调用 ⇒ `undefined` |
| 只在手动模式写 | ✅ | `/tmp/t6/t19.mjs`：`manual:false` ⇒ `undefined` |
| 只写新会话（不带运行时置顶） | ✅ | `/tmp/t6/t12.mjs`：载荷 `{"manual":true,"sessions":{"w:/repo":["session-n1","session-o0","session-o1"]}}`，无 `running`/`current` 项 |
| **写入载荷的 id 形态与树/表一致** | ❌ **阻塞** | 见缺陷 **B1** |
| **写入后「刷新页面仍在新会话在第一位」** | ❌ **阻塞** | 见缺陷 **B1**：`/tmp/t6/t15.mjs` 实测「刷新后渲染顺序 = `["session-o0",…]`，新会话第一位: **false**」 |
| **幂等性在「用户拖动过新会话」之后仍成立** | ❌ **重要** | 见缺陷 **B2**：`/tmp/t6/t24.mjs` 实测拖动后被 effect 搬回表首 |

#### 缺陷 B1（**阻塞**）：D2 写入固化表的 sessionId 被归一化，与树/表真实 id 形态不一致

- **位置**：`src/tree-model.ts:727`（`detectedNew.push(id)`，`id` 是 `normalizeSessionId` 后的**裸 id**）→ `src/tree-model.ts:780`（`newSessionIds: nextFresh`）→ `src/sidebar.tsx:1891`（`const newIds = topZoneState.newSessionIds`）→ `src/sidebar.tsx:1914`（`insertSessionAtFront(next, containerKey, sessionId, …)`）→ `src/tree-model.ts:860`（`const next = [sessionId, ...rest]`，**原样写入**）。
- **机理**：宿主 id 恒带 `session-` 前缀（实测：`~/.dsh/sessions/--Users-dev-Documents-Project-AnyWork--/session-0a1fd499-…/session.v3.jsonl.zstd` 首行 `id = 'session-0a1fd499-65d5-46fd-bce8-5ff0a1f4c67a'`；`@deepseek-ai/dsh-api-session-controller/lib/types/commands.js:92` `brandString(\`session-${randomUUID()}\`)`）。树里的 `sessionId`、以及用户真实固化表里的 54 个条目**全部**带前缀（实测：`/tmp/t6/order_clean.json` 中不带前缀的条目数 = **0**）。而 `observeTopZone` 把 id 归一化成裸 id 存进 `newSessionIds`，D2 effect 又把这个裸 id 原样写进表。
- **后果**：`applyManualOrder`（`src/tree-model.ts:306-313`）用 `keyOf(item)`（= 带前缀的真实 id）在 `indexOf` 里查找；裸 id 永远匹配不上 ⇒ 该条目成为**死条目**（既不置顶、也不报错），并且**顶掉了**表里原本正确的带前缀条目。
- **复现（我实测）**：
  ```
  $ node /tmp/t6/t15.mjs
  newSessionIds = ["0a1fd499-65d5-46fd-bce8-5ff0a1f4c67a"]   ← 归一化后（去 session- 前缀）
  写入表 = ["0a1fd499-…","session-5cad7dab-…","session-0466f987-…"]
  树里 id 形态 = ["session-5cad7dab-…","session-0466f987-…","session-0a1fd499-…"]
  ★ 表首项 === 树的真实 id ? false
  ★ 刷新页面后渲染顺序 = ["session-5cad7dab-…","session-0466f987-…","session-0a1fd499-…"]  新会话第一位: false
  ```
- **影响**：D2 的**全部意义**（「刷新页面后新会话仍在第一位」）**不成立**；同时**污染用户持久顺序**（写入永远无法匹配的死条目，并覆盖原本正确的条目）。这直接违反 D2 原文与 D1「不代改用户 localStorage」的实质。
- **为什么测试没抓到**：`test/tree-model.test.mjs:3960`（`T5/D2 端到端`）与 `:3473`（`T5/D2: 新会话在手动模式下插到容器第一位`）**全部使用裸 id**（`session('new1')` / `'o0'`）构造 fixture，与真实宿主 id 形态不符 ⇒ 测试断言在该形态下恒真。这是「把错误行为固化」的弱断言。
- **注**：`/tmp/t6/t8.mjs` 证明：若 id 形态正确，D2 在「容器已在表里」与「容器不在表里」两种分支下**都能**把新会话放第一位（`★ 新会话第一位: true`）。缺陷**只在 id 形态**这一处，修法明确（写入前用树里的真实 id，或写入时不做归一化）。

#### 缺陷 B2（**重要**）：`newSessionIds` 只增不减 ⇒ 用户拖动新会话后被 D2 effect 静默回滚

- **位置**：`src/tree-model.ts:727/745/780`（`fresh` 集合只 `add` 从不 `delete`；`observeTopZone` 返回的 `newSessionIds` 在整个页面会话内单调增长）；`src/sidebar.tsx:1928` 的依赖数组 `[topZoneState.newSessionIds, manualOrder, tree, t]` ⇒ **每次拖拽（`manualOrder` 变化）都会重跑该 effect**。
- **复现（我实测，已隔离 B1 的 id 形态干扰 —— 假定 `newSessionIds` 是带前缀的正确形态）**：
  ```
  $ node /tmp/t6/t24.mjs
  初始表 = ["session-n1","session-o0",…,"session-o4"]
  effect（幂等）⇒ 有变化: false
  用户把新会话拖到末尾 ⇒ ["session-o0",…,"session-o4","session-n1"]
  ★ effect 重跑（manualOrder 变了 ⇒ React 依赖变化必然重跑）⇒ 有变化: true
  ★ 结果表 = ["session-n1","session-o0",…,"session-o4"]
  ★ 新会话被搬回表首（用户拖动被静默回滚）: true
  ★ 持久顺序被改写: true
  ```
- **影响**：用户在**本页面会话内**无法把「刚建的新会话」拖到别处 —— 拖完立刻被搬回第一位，且**持久顺序被改写**。这是 D2「幂等」承诺的反例（纯函数幂等 ✅，但**编排层不幂等**：状态集合不清理 ⇒ 每次拖拽都重新触发一次「插入」）。刷新页面后 `newSessionIds` 重置 ⇒ 拖动才生效，用户会感到「拖了没用，刷新后又好了」的诡异行为。
- **对照**：`test/tree-model.test.mjs` 有 53 条 T5 用例，但**没有任何一条**覆盖「新会话出现 → 用户拖动该新会话 → effect 重跑」这一时序；`T5/D2: insertSessionAtFront 幂等` 只测纯函数，不测 effect 编排。

### D3 —— 顶部区 a–g ⇒ **全部满足（a–g 逐条实测）**

| 子项 | 判定 | 证据（我实测） |
|---|---|---|
| (a) 仅 subagent 在跑 ⇒ 父会话在顶部区（聚合口径） | ✅ | `/tmp/t6/t2.mjs`：`observationsOf` 给出 `p1 观测 running = true`（p1 自身 `running:false`，仅 `sub1` running）；渲染 `["p1","x0","x1","x2","x3"]` |
| (b) 运行结束后仍保留 | ✅ | 同上：`recentlyFinishedIds = ["r1"]`；渲染 `["r1","y0","y1","y2","y3"]` |
| (c) 当前会话在顶部区第一位 | ✅ | 同上：`["c7","c3","c0","c1","c2"]`（c7 = current，c3 = running） |
| (d) 顶部区之外按既有持久顺序 | ✅ | `/tmp/t6/t3.mjs`：手动顺序 `[d0…d7]`，`d7` 刚结束 ⇒ `["d7","d0","d1","d2","d3"]`，**顶部区外相对顺序保持: true** |
| (e) 运行时置顶不写 localStorage | ✅ | `/tmp/t6/t2.mjs`：5 种不同 `topZone` 输入下 `effectiveOrder` 的**不同载荷数 = 1**（唯一载荷 `["d7",…,"d0"]`）；**对照组**：`buildRows` 渲染序的**不同值数 = 5**（⇒ 断言非恒真） |
| (f) 顶部区先于 5 条截断 | ✅ | 同上：10 条 + `f9` 刚结束 ⇒ `["f9","f0","f1","f2","f3"]`，`f9 可见: true` |
| (g) 顶部区内部顺序确定性 | ✅ | 同上：`updatedAt` 降序 + `sessionId` 升序 tiebreak；**输入顺序反转后输出逐字相同**（`确定性: true`） |
| 补充：搜索模式不应用顶部区 | ✅ | `test` + 我读 `src/tree-model.ts:1802-1816`（`buildSearchRows` 不读 `topZone`） |

### D4 —— 拖动该容器后顶部区保留立即失效 ⇒ **满足（但接线有缺口，见缺陷 I2）**

| 子项 | 判定 | 证据 |
|---|---|---|
| 运行中保留失效 | ✅ | `/tmp/t6/t4.mjs`：未拖动 ⇒ `["fin1","run1",…]`；已拖动 ⇒ `["run1","fin1",…]`（run1 仍 running 但已沉下去） |
| 刚结束保留失效 | ✅ | `/tmp/t6/t5.mjs`（手动顺序把它们排最后）：未拖动 ⇒ `["fin1","run1","q0",…]`；已拖动 ⇒ `["q0","q1","q2","q3","q4"]`（run1/fin1 沉到末尾） |
| 释放幂等 | ✅ | `/tmp/t6/t4.mjs`：`releaseTopZoneContainer(st2,'w:/repo') === st2` ⇒ `幂等(二次同一引用): true` |
| 只释放该容器 | ✅ | `/tmp/t6/t4.mjs`：`w:/repo` 释放后 `["a1","a2",…]`，`w:/repo-wt` 的 `b1` 仍置顶 ⇒ `["b1"]` |
| 当前会话不受释放影响（D3c） | ✅ | `/tmp/t6/t4.mjs`：已拖动 + `currentSessionId='fin1'` ⇒ `["fin1","run1",…]` |
| 刷新后行为恢复 | ✅ | `/tmp/t6/t4.mjs`：`releasedContainerKeys: []` ⇒ `["fin1","run1",…]` |
| D3a/D4 张力如实披露 | ✅ | `docs/PRD.md:388-391`、`docs/INTERFACES.md:677-679` 均有「⚠️ 已知语义张力…按更具体的 D4 执行；刷新页面后…恢复」；`README.md:58` 提到「拖动该分组内的排序（立即失效）」 |

### D5 —— 11b1144 承诺：非当前/非运行中的已有会话收到新消息不顶到前面 ⇒ **满足**

- **我实测**：`/tmp/t6/t3.mjs`：`m0` 的 `updatedAt` 从 1000 推到 9999 ⇒ 渲染 `["m0","m1","m2","m3","m4"]` → `["m0","m1","m2","m3","m4"]`，**冻结: true**。
- **`git diff` 无删除既有断言**：`git diff -U0 test/tree-model.test.mjs | grep "^-" | grep -v "^---" | wc -l` ⇒ **0**。✅
- **基线回归**：`node --test /tmp/t6/baseline/*.mjs`（HEAD 的 5 个测试文件对**当前** `lib/`）⇒ `tests 253 / pass 253 / fail 0`。✅（既有 253 条断言在新实现下全部通过）
- **测试质量抽查**：新增 84 条 `test(`，其中 `T5` 前缀 53 条、其余 31 条属 T2/T3 需求。逐条抽查结论见 §④「测试质量」。

### D6 —— 容器/项目行 runningCount 口径不改 ⇒ **满足**

- **我实测**：`git diff -U0 src/tree-model.ts | grep runningCount` 只命中**注释**行（新增说明），无代码行改动。
- `src/tree-model.ts:1698` 仍为 `heads.filter((session) => session.running === true).length`（裸字段口径，未纳入聚合）。
- `docs/INTERFACES.md:415-431` 新增段落**明确披露**「`worktree`/`project` 行的 `runningCount` 刻意不含该聚合」并说明「这不是全局不变式」。✅

---

## ③ 重点反例结论

### 3.1 旧表外会话（T4 §3.2 的 4 条）不被误插 ⇒ **通过**

**构造方式（我如何区分「基线中已存在」与「首次观测」）**：用 `observeTopZone(state, observations, nowMs)` 的注入式 `nowMs` 做确定化时钟。第一次调用（`baselined: false`）即**建立基线**，把当时 `eligible` 的所有会话写进 `knownSessionIds`；此后任何已 `known` 的 id 都**永不**判新会话。我据此把「页面加载时就已在树里」建模为「首批观测即包含」，把「首次观测」建模为「后续批次才出现」。

| 反例 | 结果 | 证据 |
|---|---|---|
| ① 页面加载时就已在树里的旧表外会话 | `newSessionIds = []` | `/tmp/t6/t1.mjs` |
| ② 5 轮轮询后仍不被误插 | `newSessionIds = []`；渲染 `["o0","acaf03fd","af89d75c","6173f64c","401e6633"]`（o0 在首位） | 同上 |
| ③ `updatedAt` 略小于基线（-1ms） | `newSessionIds = []` | 同上 ③b |
| ③ 旧会话「延迟出现」（首帧缺席、次帧补齐） | `newSessionIds = []` | 同上 ③c |
| ④ `updatedAt` **恰好等于**基线 | `newSessionIds = ["edge-eq"]`（实现用 `>=` ⇒ 判为新会话） | 同上 ③ |
| ⑤ `blank: true → false` 强证据（`updatedAt = 0`） | `newSessionIds = ["n1"]`（不依赖时钟） | 同上 ⑤ |
| ⑥ `updatedAt = NaN` 的新会话 | `newSessionIds = []`（`observationsOf` 把非有限值归 0 ⇒ **漏报**） | 同上 ④ |

**真实数据复核（我独立做的，不采信 T4）**：解出用户真实排序表（LevelDB `000856.ldb`，自写 snappy 解压 + SSTable 解析）：

```
manual=True  containers=22  entries=54
acaf03fd -> []   af89d75c -> []   6173f64c -> []   401e6633 -> []
表内不带 session- 前缀的条目数: 0
```

⇒ 4 条旧会话**确实**不在表里（T4 结论可复现）。我用它们的**真实 `createdAt`**（`zstd -dc` 读会话头：`acaf03fd=2026-09-21T06:10:45Z`、`af89d75c=2026-09-20T14:24:08Z`、`6173f64c=2026-09-18T03:05:56Z`、`401e6633=2026-09-13T13:24:37Z`，均**早于** T4 水位 `2026-09-21T09:01:43Z`）构造真实 LogAnalyst 容器用例（`/tmp/t6/t13.mjs`）：

```
newSessionIds = []                (期望 [])
★ 旧表外会话 af89d75c 是否跳到最前: false   (期望 false)
```

**时钟边界结论**：`updatedAt >= startedAtMs` 在「恰好等于」时判为新会话 —— 这是**有意**的边界（`>=` 而非 `>`），语义上是「不早于本进程启动」⇒ 可接受。真正的残余风险是「**旧**会话的 `updatedAt` 因故晚于基线」（如宿主时钟偏差、`lastPromptAt` 被历史事件推进）—— `/tmp/t6/t20.mjs` 实测此时会被判为新会话并写表；但实现已在 `src/tree-model.ts:661-664` 与 `docs/PRD.md:380-382` **如实披露**该残余不确定性（同机场景不可能），我不重复计为缺陷，仅列为**次要风险**。

### 3.2 写入幂等 ⇒ **纯函数通过，编排层不通过（缺陷 B2）**

- 纯函数 `insertSessionAtFront`：`/tmp/t6/t1.mjs` ⑥ 首次写入 `["n1","o0","o1"]`，二次 `undefined`。✅
- 编排层（`sidebar.tsx:1889-1928`）：`newSessionIds` 不清理 ⇒ 每次 `manualOrder` 变化都重跑并回滚用户拖动。❌ 见 **B2**。
- **空数组表项的反例**（次要）：`/tmp/t6/t19.mjs`：`insertSessionAtFront({manual:true,sessions:{'w:/repo':[]}}, 'w:/repo','NEW',['a','b','c'])` ⇒ `["NEW"]`，**丢掉 `a/b/c`**（`src/tree-model.ts:859` 的 `??` 不覆盖空数组；对照「表项缺失」⇒ `["NEW","a","b","c"]` 正确）。真实链路中 `stringListMapOf`（`src/sidebar.tsx:260-268`）会丢弃空数组键，故当前不可达；列为**次要**。

### 3.3 渲染循环 ⇒ **通过**

- `observeTopZone` 无变化返回同一引用：`/tmp/t6/t6.mjs` 在 528 会话真实规模下 **20/20 次同一引用**；`/tmp/t6/t12.mjs` 显示 D2 effect 在幂等路径**不写**（迭代 1 ⇒ `undefined`）。
- `topZoneInputOf` 每次返回新对象，但 `treeInput` 的 `useMemo` 依赖它 ⇒ 仅在 `topZoneState` 变化时重建；`topZoneState` 由 `observeTopZone` 的引用稳定性兜住 ⇒ **无自激循环**。
- **但存在一次多余重渲染链**：`tree` 变化 → `setTopZoneState` → `topZone` 变 → `treeInput` 变 → D2 effect 依赖 `tree` 与 `manualOrder`（不含 `topZone`）⇒ **不**形成闭环。✅（`/tmp/t6/t24.mjs` 的「回滚」不是循环，是依赖 `manualOrder` 的单次重跑，但每次拖拽都会触发一次 —— 即 B2。）

### 3.4 载荷逐字对比 + 对照组 ⇒ **通过**

见 §② D3(e)：不同 `topZone` 输入下 `effectiveOrder` 载荷**只有 1 种**（逐字相同），而 `buildRows` 渲染序有 **5 种**（对照组证明断言非恒真）。

### 3.5 边界与健壮性 ⇒ **基本通过（含 1 处次要缺口）**

`/tmp/t6/t18.mjs` 我实测：

| 输入 | 结果 |
|---|---|
| 空容器 / 会话不在任何容器 / 仅归档会话 | 不抛错，行序列正常 |
| 重复 id 同容器 | 不抛错（`applyManualOrder` 的 `indexOf` 只认第一个） |
| `currentSessionId ∈ {undefined, '', 42, null, {}, []}` | **全部不抛**（`pinnedSessionKeys` 的 `typeof !== 'string'` 守卫生效，`src/tree-model.ts:384`） |
| `topZone = null` / `{runningSessionIds: 42}` / `{releasedContainerKeys: 42}` | **抛 TypeError** |
| `topZone = 42` / `'x'` / `{runningSessionIds:[42,null,'']}` | 不抛（静默降级） |

`topZone` 是**新增**的可选入参，契约类型是 `TopZoneInput | undefined`（不含 `null`），且调用方 `sidebar.tsx` 只会传 `topZoneInputOf(...)` 的产物 ⇒ `null` / 数字字段**不可达**。列为**次要**（防御性守卫不一致：id 数组元素有守卫，但 `topZone` 容器本身与字段类型没有）。

---

## ④ 问题清单（按严重度）

### 阻塞（必须修复后才能验收）

#### B1. D2 写入固化表的 sessionId 形态错误 ⇒ 「刷新后新会话仍在第一位」不成立 + 污染用户持久顺序

- **位置**：`src/tree-model.ts:727`（`detectedNew.push(id)`，`id` 已归一化）→ `:780`（`newSessionIds`）→ `src/sidebar.tsx:1891, 1914`（原样透传）→ `src/tree-model.ts:860`（`[sessionId, ...rest]` 原样写入）
- **复现**：`node /tmp/t6/t15.mjs` ⇒ `★ 表首项 === 树的真实 id ? false`、`★ 刷新页面后渲染顺序 … 新会话第一位: false`
- **影响**：① D2 的核心承诺（跨刷新保持）失效；② 向用户 `localStorage` 写入**永远无法匹配**的死条目，并顶掉原本正确的带前缀条目 ⇒ 实质违反 D1「不代改用户 localStorage」。
- **根因**：`observeTopZone` 内部统一用归一化 id（`normalizeSessionId`），但**没有在任何地方还原回树里的原始 id**；`insertSessionAtFront` 又原样写入。
- **建议方向**（只报告，不代改）：写入前用 `defaults.sessions` 里的真实 id 反查（`containerKeyOfSession` 已返回容器 key，可顺带返回命中的真实 id），或在 `insertSessionAtFront` 内按归一化比较后写入**表内/树内的原形态**。

#### B2. `newSessionIds` 只增不减 ⇒ 用户拖动新会话后被 D2 effect 静默回滚（幂等性在编排层不成立）

- **位置**：`src/tree-model.ts:745`（`fresh.add(id)`，无删除路径）→ `src/sidebar.tsx:1928`（依赖 `manualOrder` ⇒ 每次拖拽都重跑）→ `src/sidebar.tsx:1914`（重新插入）
- **复现**：`node /tmp/t6/t24.mjs` ⇒ `★ 新会话被搬回表首（用户拖动被静默回滚）: true`、`★ 持久顺序被改写: true`
- **影响**：本页面会话内，用户**无法**把新会话拖离第一位；持久顺序被改写；刷新后行为又不同（`newSessionIds` 重置）⇒ 用户感知为「拖了没用 / 时好时坏」。
- **建议方向**：新会话的「已落表」事实应被消费掉（例如落表后从 `newSessionIds` 移除，或记录「已插入过的 id」集合），使 effect 对同一新会话只生效一次。

### 重要

#### I1. 测试用裸 id 构造 fixture ⇒ 未覆盖真实 id 形态，把错误行为固化

- **位置**：`test/tree-model.test.mjs:3473`、`:3960`（`T5/D2` 端到端）以及绝大多数 T5 用例（`session('new1')` / `'o0'` 等裸 id）
- **影响**：B1 这一阻塞缺陷在 53 条 T5 用例下**全部通过**；「D2 端到端」这条本应抓住它的验收测试因此**恒真**。
- **说明**：仓库内确实有前缀用例（`:3549` `containerKeyOfSession` 前缀混拼、`:3797` 状态机前缀混拼），但它们只覆盖**纯函数**，没有覆盖「写表 → 刷新 → 渲染」的端到端链路。

#### I2. D4 释放只在「会话行拖拽且真重排」时触发 ⇒ 拖动当前会话（第一位）不会释放该容器

- **位置**：`src/sidebar.tsx:1981-1992`（`if (next === null) return` **先于** `releaseTopZoneContainer`）；`reorderKeys`（`src/tree-model.ts:1387-1407`）在「落点等于原位」时返回 `null`
- **我实测**（`/tmp/t6/t11.mjs`）：当前会话恒第一位，用户把它拖到第 3 位 ⇒ `reorderKeys` 返回 `["s1","s2","s3","s0",…]`（非 null ⇒ **会**释放）；但用户把它拖到**紧邻的下一行之前** ⇒ `reorderKeys` 返回 `null` ⇒ **不释放**。此时持久顺序变了（视觉不变，与 `docs/PRD.md:335-337` 的「已知限制」一致），但该容器的运行中/刚结束保留**未失效** ⇒ 与 D4「用户拖动该容器后…立即失效」存在解释空间。
- **判定**：**重要**（语义边界），非阻塞 —— 实现者已在 JSDoc（`src/sidebar.tsx:1969-1972`）声明「原地抖一下鼠标不构成拖动」，该取舍自洽；但「拖动当前会话导致视觉无变化且不释放」这一复合情形**未在文档中披露**。

#### I3. 已归档会话不进 `knownSessionIds` ⇒ 取消归档 + 新消息会误判新会话

- **位置**：`src/tree-model.ts:693-695`（`eligible` 过滤掉 `archived`）→ `:696-702`（`known` 只由 `eligible` 建）
- **我实测**（`/tmp/t6/t14.mjs`）：基线时 `oldarch` 已归档（不进 `known`），之后取消归档且 `updatedAt` 被推进到基线之后 ⇒ `newSessionIds = ["oldarch"]`、`★ 是否误判: true`。
- **可达性**：宿主**没有** `unarchive` API（我实测：`@deepseek-ai/dsh-api-workspace-controller` 只有 `archiveSession`；`@deepseek-ai/dsh-workspace/lib/index.js:446-453` 只做 append），`docs/PRD.md:40` 也写明「宿主暂无 unarchive API」⇒ **当前不可达**。
- **判定**：**重要（潜伏）**。若宿主将来提供取消归档（或用户手改 `~/.dsh/storages/workspace.json`），该旧会话会被误判为新会话并**写进固化表表首**，直接违反 D5。
- **文档**：`src/tree-model.ts:668-669` 有提及「若会话先发消息后被归档再取消归档，基线可能把它记成已知 ⇒ 不判新会话」—— 但这句话**与实测相反**（实测是**会**判新会话），属**误导性表述**。

### 次要

#### S1. `insertSessionAtFront` 遇到「表项为空数组」时丢会话

- `src/tree-model.ts:859` `const base = order.sessions?.[containerKey] ?? fullOrder ?? []` ⇒ 空数组不触发 `??`。`/tmp/t6/t19.mjs`：结果 `["NEW"]`（应 `["NEW","a","b","c"]`）。真实链路不可达（`stringListMapOf` 丢弃空数组键），但纯函数契约不自洽。

#### S2. `topZone` 入参的防御性守卫不一致

- `src/tree-model.ts:513-514` 对 `topZone === undefined` 有守卫，但 `null` / `{runningSessionIds: 42}` / `{releasedContainerKeys: 42}` 会抛 `TypeError`（`/tmp/t6/t18.mjs`）。与同函数内对 id 元素的 `typeof` 守卫（`:533-547`）风格不一致。真实链路不可达。

#### S3. 「旧会话 `updatedAt` 晚于基线」会误判为新会话

- `src/tree-model.ts:724-727`。`/tmp/t6/t20.mjs` 实测：`updatedAt = 基线+50ms` 的旧会话 ⇒ `newSessionIds = ["late-old"]`。已由实现者在 `:661-664` 与 `docs/PRD.md:380-382` 披露，列为**残余风险**而非缺陷。

### 建议

#### R1. 补一条「真实 id 形态」的端到端测试

用 `session-<uuid>` 形态的 fixture 覆盖「新会话 → 落表 → 刷新 → 渲染」全链路，直接锁死 B1 类回归。

#### R2. 补一条「新会话落表后用户拖动」的时序测试

覆盖「新会话出现 → 用户拖动该新会话 → effect 重跑」⇒ 断言持久顺序不被改写（锁死 B2）。

#### R3. 统一 `knownSessionIds` 与「新会话」判定的归档语义

要么把归档会话也记入 `known`（用独立的「曾见过」集合，与 `eligible` 解耦），要么修正 `src/tree-model.ts:668-669` 的 JSDoc 使其与实测一致。

---

## ⑤ 未验证 / 无法验证部分（如实说明）

1. **GUI 视觉行为未做真人/截图验证**。我无法操作 Electron 渲染进程（`openBrowser: false`；直连 `http://127.0.0.1:43120` 全部 403，我实测 `/api/dsh/tree`、`/dsh-worktree-groups/tree` 加 `x-dsh-desktop-renderer: 1` 仍 403）。因此「拖拽插入线、被拖行半透明、点击后的视觉反馈」**未验证**。
2. **`.tsx` 接线（`src/sidebar.tsx` 的 React effect 时序）未在真实 React 运行时验证**。我用**逐行同构的 JS 复刻**（`/tmp/t6/t24.mjs` 等）验证其语义，属「我推断 + 同构实测」，**不是**真实 React 渲染验证。B2 的结论依赖「React 在 `manualOrder` 变化后确实重跑该 effect」这一标准语义 —— 我未在真实 React 中观测。
3. **宿主 `updatedAt` 与渲染进程 `Date.now()` 的时钟一致性未实测**（无法在渲染进程内取时间）。S3 属推断。
4. **「53 条 T5 测试是否全部有效」未逐条判定**：我抽查了 D2/D3/D4/持久化/边界各组的关键用例（见 §② 与 §④ I1），确认**至少** `:3473` / `:3960` 两条端到端用例因 fixture 形态而失去判别力；其余 51 条我读到其断言均**真实断言行为**（非恒真），但未逐条构造反例去证伪。
5. **`~/.dsh` 与 localStorage 的「写入」只做了 mtime + 内容比对**，未做系统级文件审计（如 `fs_usage`）。

---

## ⑥ 产物一致性 / GUI bundle / 文档一致性（独立核验）

### 6.1 改动范围与硬约束 ⇒ **与声明一致**

```
$ git status --porcelain=v1 --untracked-files=all
 M README.md
 M docs/INTERFACES.md
 M docs/PRD.md
 M src/sidebar.tsx
 M src/tree-model.ts
 M test/tree-model.test.mjs
?? docs/RESEARCH-running-and-sort.md
?? docs/RESEARCH-session-drop-to-bottom.md
?? docs/REVIEW-running-and-sort.md

$ git diff --numstat
28	4	README.md
224	7	docs/INTERFACES.md
84	1	docs/PRD.md
133	3	src/sidebar.tsx
742	17	src/tree-model.ts
1489	0	test/tree-model.test.mjs
```

| 硬约束 | 判定 | 证据 |
|---|---|---|
| 三份只读产物未被修改 | ✅ | md5：`b7c5a3a17b10270c9be7a7d140900e45`（RESEARCH-running-and-sort）/ `a646f00a429ec1eca3e3ac96779e4620`（RESEARCH-session-drop-to-bottom）/ `c0b9ff6d47354212a3158ae04420f808`（REVIEW-running-and-sort）；且 `git log -1 -- <三文件>` 为空 ⇒ 仍为**未跟踪**，从未被 commit |
| `package.json` 依赖未改 | ✅ | `git diff --stat package.json` 空；md5 `380d1d691da1cc672e29cea2399d3b59` |
| `~/.dsh` 未改（本任务期间） | ✅ | 我只读访问；`~/.dsh` 下未执行任何写操作 |
| HEAD 仍 `11b1144`、无新 commit | ✅ | `git log --oneline -1` ⇒ `11b1144 feat(worktree-groups): 侧栏三层拖拽排序（项目/worktree/会话）` |
| **用户 localStorage 未被写入** | ✅（就本任务期间而言） | LevelDB `Local Storage/leveldb/` 内 `000854.log` mtime `2026-09-21 22:23:05`、`000856.ldb` mtime `22:12:23`、`MANIFEST-000001` mtime `22:12:23` —— **全部早于**我 22:26 开始的审查，审查期间未再变动。`000854.log` 全文 `strings` 只有 `dsh.sessions.current` 键（值为会话 id / 子代理地址），**无** `dsh-worktree-groups.order` 写入 |
| 三份只读产物之外无越权写入 | ✅ | 本报告是本任务唯一写入文件 |

### 6.2 自报数字的独立核对

| 声明 | 我的实测 | 判定 |
|---|---|---|
| `npm test` 337/337 pass | `tests 337 / pass 337 / fail 0 / cancelled 0` | ✅ |
| typecheck exit 0 | `npm run typecheck` ⇒ exit 0 | ✅ |
| build 幂等 | 连跑两次 `npm run build` ⇒ `lib/client.js` md5 恒为 `dcee25ace05dabc4c0a16b3bd9e1635c`、`lib/tree-model.js` `1049901a9c8a0aa2bccc9a9908d25446`、`lib/index.js` `59205114f9f01dd2b5746711696ddf94` | ✅ |
| 测试删除行数 0 | `git diff -U0 test/tree-model.test.mjs \| grep "^-" \| grep -v "^---" \| wc -l` ⇒ **0** | ✅ |
| 「基线 282」 | **我实测 HEAD 全量 = 253**（`node --test /tmp/t6/baseline/*.mjs` ⇒ `tests 253`）。337 − 253 = 84 条新增；其中 `T5` 前缀 53 条、其余 31 条属 T2/T3 ⇒ **T5 之前**的基线应为 **284**（253 + 31） | ⚠️ 「282」与我的实测**不一致**（差 2）；`docs/PRD.md:496` 的「282 → 335」也与当前实测（337）不符 |
| 新增 53 条测试 | `git diff test/tree-model.test.mjs \| grep -c "^+test('T5"` ⇒ **53** | ✅（`docs/PRD.md:496` 写「335」/「53 条」中条数对、总数旧） |

> 注：「282」可能是**T2 改动前**（即 `11b1144` 原始 HEAD）的另一口径，但我按可复现方式实测得到 **253**，且 T5 自述的「335」与当前「337」不符 ⇒ 该行文档数字**已过时**，属**次要**文档问题。

### 6.3 `lib/` 与 `src/` 一致 + GUI bundle 实证

- **`lib/` 与 `src/` 一致**：`lib/tree-model.js` 含全部新符号（`grep -c topZoneSessionKeys lib/tree-model.js` ⇒ 6 处）；`lib/client.js` 含 `topZoneSessionKeys` / `observeTopZone` / `insertSessionAtFront` / `containerKeyOfSession` / `releaseTopZoneContainer` / `releasedContainerKeys`（各 2–12 处）。✅
- **GUI 正在提供的 bundle 已含 T5 新逻辑（我独立复算 rev 证实）**：
  - 缓存项 `Cache/Cache_Data/41b013c53119a697_0`，mtime `2026-09-21 22:24:09`，URL `…/plugins/??dsh-worktree-groups/client.js&rev=4ab061599df0`。
  - 我用宿主 `framedHash` 算法（`/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js:172-176`，`sha1(domain + "\0" + Σ(len+":"+bytes))` 取前 12 hex）对**磁盘** `lib/client.js`（无 `.map` ⇒ `sourceMap === undefined`）复算 ⇒ **`4ab061599df0`**，与缓存 URL 的 `rev` **逐字相同**。
  - **逐字节对比**：缓存响应体去掉末尾 389 字节（宿主追加的 `;\n//# sourceMappingURL=…` + HTTP 头 + 元数据）后，与磁盘 `lib/client.js` **前 107171 字节完全一致**（`first mismatch idx None`、`num mismatches 0`、`sha1[:12]` 两侧同为 `ca0d581c5d90`）。
  - ⇒ **当前 GUI 加载的 bundle 已包含 T5 新逻辑**，无需用户刷新即可生效（Electron 主进程 13:11:24 启动，渲染进程 13:11:30 启动；22:24:09 的缓存条目即本次会话刷新时拉取）。
- **历史缓存对照**（证明 rev 确实随代码变化）：`22:11:59 rev=3acbd3618d52` → `22:24:09 rev=4ab061599df0`，两次的 bundle 体 md5 不同（`906fa8e9…` vs `d7bcb2cc…`），均含 T5 符号。

### 6.4 文档一致性 ⇒ **基本一致，含 2 处需修正**

| 文档 / 行 | 内容 | 判定 |
|---|---|---|
| `docs/PRD.md:324` | 「**非当前、非运行中、非新会话**的新项出现在容器**末尾**」 | ✅ 旧的无条件「新会话落末尾」句式**已改写** |
| `README.md:57` | 「顺序列表里没有的项（新建 worktree / 项目）落在**末尾**…**新建会话是例外**（见下）」 | ✅ 已改写 |
| `README.md:59-61` | 顶部区三类 + 时间序判据 + 「**不是**『不在排序表里』」+ 唯一写表例外 | ✅ 与实现一致 |
| `docs/PRD.md:335-337`、`README.md:63`、`docs/INTERFACES.md:696` | 「当前会话**恒居首位** ⇒ 针对**第一位的任何拖拽视觉上不产生变化**（持久顺序如实记录，切走即生效）」 | ✅ **已披露** |
| `docs/PRD.md:388-391`、`docs/INTERFACES.md:677-679` | 「⚠️ **已知语义张力**：D3a 说运行中『始终』在顶部区，而 D4 把『运行中保留』纳入失效范围 ⇒ 按更具体的 D4 执行；**刷新页面后恢复**」 | ✅ **已披露** |
| `docs/PRD.md:496` | 「新增 53 条测试（**282 → 335**，既有断言**零删除**）」 | ⚠️ 数字**过时/不符**：实测基线 253、当前 337（见 §6.2）；「零删除」✅ |
| `src/tree-model.ts:668-669` | 「若会话**先发消息后被归档再取消归档**，基线可能把它记成**已知** ⇒ **不判新会话**」 | ❌ **与实测相反**（`/tmp/t6/t14.mjs`：会判新会话）；属**误导性表述**（对应问题 I3） |
| `README.md:58` | 顶部区三类用「**总是**排在…顶部区」，紧接 `:58` 又说「直到你**拖动该分组内的排序**（立即失效）」 | ⚠️ 同一段落内「总是」与「拖动后失效」措辞张力；`README.md` **未**像 PRD/INTERFACES 那样显式点出「D3a/D4 张力」与「刷新恢复」——**建议补齐**（次要） |

**自相矛盾 / 误导性表述汇总**：① `docs/PRD.md:496` 的测试数字（282/335）；② `src/tree-model.ts:668-669` 的归档 JSDoc（与实测相反）；③ `README.md:58` 的「总是」未配张力说明。

### 6.5 性能 ⇒ **通过**

真实规模（我构造：33 顶层祖先 / 297 subagent / 528 总会话 / depth-3 链 / 6 容器）：

```
observationsOf:              1.72 ms   (528 条观测)
observeTopZone(基线):        0.25 ms
20 次无变化轮询:             3.78 ms   (平均 0.19 ms，同一引用 20/20)
20 次 buildRows:             5.08 ms   (平均 0.25 ms)
20 次 buildRows(无 topZone): 2.25 ms   (对照：顶部区开销 ~2.8ms/20 = 0.14ms/次)
20 次 effectiveOrder:        1.49 ms
```

无 O(n²) 迹象（`observeTopZone` 对 `eligible` 做两遍线性扫描；`topZoneSessionKeys` 每个容器线性扫描本容器 `visible`）。`sortTopZone` 为 `O(k log k)`（k = 该容器顶部区成员数）。✅

---

## ⑦ 结论：**不建议验收**

**理由（阻塞项 2 条）**：

1. **B1（阻塞）**：D2 写入固化表的 sessionId 被归一化，与树/表真实 id 形态不一致 ⇒ D2 的核心承诺（「刷新页面后新会话仍在第一位」）**不成立**，且向用户 `localStorage` 写入无法匹配的死条目、顶掉原本正确的条目。
2. **B2（阻塞）**：`newSessionIds` 只增不减 ⇒ 用户在本页面会话内拖动新会话会被 D2 effect **静默回滚**，持久顺序被改写 ⇒ D2 的「幂等」在编排层不成立。

**其余裁决**：D1 ✅、D3(a–g) ✅、D4 ✅（接线缺口 I2）、D5 ✅、D6 ✅。核心算法（`topZoneSessionKeys` / `observeTopZone` 状态机 / `releaseTopZoneContainer` / `observationsOf` / `topZoneInputOf`）的**纯函数语义正确、性能良好、边界稳健**，且「不写 localStorage」这一关键不变式有**载荷逐字 + 对照组**双重证据支撑。

**建议处置顺序**：先修 B1（一行形态问题，收益最大）→ 再修 B2（effect 消费语义）→ 补 R1/R2 两条端到端测试（防止回归）→ 修正 I3 的 JSDoc 与 `docs/PRD.md:496` 的数字 → 决定 I2/S1/S2 的处置。

**未验证部分**（见 §⑤）：GUI 视觉、真实 React 运行时 effect 时序、渲染进程时钟一致性。因此**即使修复阻塞项，最终验收仍需一次真人 GUI 操作**（新建会话 → 发首条消息 → 刷新 → 确认在第一位；拖动新会话 → 确认不被回弹）。

---

### 附：本报告的证据脚本清单（均在 `/tmp/t6/`，不属仓库产物）

| 脚本 | 覆盖 |
|---|---|
| `lv.py` | LevelDB SSTable + snappy 解压（解出用户真实排序表） |
| `harness.mjs` | 对抗性 harness（fixture / id 工具） |
| `t1.mjs` | 旧表外会话、时钟边界、幂等、只写自己 |
| `t2.mjs` | D3 a–g（含载荷对比 + 对照组） |
| `t3.mjs` | D3d/D4/D5/边界（归档/子代理/非法 current/跨容器/未分组） |
| `t4.mjs`, `t5.mjs` | D4 严格复现（运行中 + 刚结束 + 刷新恢复） |
| `t6.mjs` | 性能与引用稳定性（528 会话真实规模） |
| `t7.mjs`, `t15.mjs`, `t17.mjs`, `t21.mjs` | **B1**（id 形态） |
| `t8.mjs`, `t12.mjs`, `t24.mjs`, `t22.mjs` | **B2**（effect 回滚 / 幂等） |
| `t9.mjs`, `t10.mjs`, `t14.mjs` | **I3**（归档→取消归档误判） |
| `t11.mjs` | **I2**（拖动当前会话不释放） |
| `t13.mjs` | 真实数据复现（4 条旧表外会话） |
| `t18.mjs` | 边界健壮性 |
| `t19.mjs` | D1 默认模式 + 空数组表项（**S1**） |
| `t20.mjs` | 基线时序（**S3**） |
| `/tmp/t6/baseline/*.mjs` | HEAD 测试文件实跑（真实基线 253） |
