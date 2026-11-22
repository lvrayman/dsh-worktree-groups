# 独立复审报告：T7 缺陷修复的定向验证（T8）

- **任务 ID**：T8（独立复审，只读；唯一写入本文件）
- **复审对象**：`/Users/dev/Documents/Project/AnyWork/dsh-worktree-groups`（基线 `11b1144` + T5/T7 未提交改动）
- **角色声明**：**不采信 T7 自述**。本报告全部结论来自我本人读代码、跑命令、构造反例与变异测试；每条附命令 / 退出码 / 真实输出或 `file:line`。明确区分「我实测」与「我推断」。
- **复审时间**：2026-09-21 23:5x – 2026-09-22 00:2x（本机 CST）
- **写入边界**：仅本文件。仓库 `src/**`、`lib/**`、`test/**`、既有 `docs/**` 均未修改（变异测试全部在 `/tmp/t8/mut` 的副本里做）。用户 `localStorage`、`~/.dsh` 全程只读。

---

## ① 复审范围与方法

### 1.1 复审范围

| 范围 | 对象 |
|---|---|
| 缺陷修复 | `src/tree-model.ts`（T7 新增 `placementOfSession:893` / `planNewSessionInserts:1024` / `markNewSessionsWritten:1074` / `pendingNewSessionIdsOf:1096` / `isTopZoneReleasingDrag:1127` / `TopZoneState.writtenNewSessionIds:639`） |
| 接线 | `src/sidebar.tsx`（D2 落表 effect `:1901-1938`；I2 释放接线 `:2004-2013`） |
| 测试 | `test/tree-model.test.mjs`（T7 新增 13 条 `:4043-4437`） |
| 回归红线 | D1–D6 逐条 |
| 环境事实 | 用户 `localStorage` 现状、GUI 缓存 bundle rev、测试/构建数字 |

### 1.2 我实际执行的方法（全部独立构造）

1. **变异测试（判别力验证）**：把仓库整树复制到 `/tmp/t8/mut`，在**副本的 `lib/tree-model.js`**（构建产物，测试真实 import 的对象）上逐个还原 T6 缺陷，跑 `node --test` 数失败条数。共 8 个变异：M2 / M2b（B1）、M3（B2）、M4b（I2）、M5b / M5c（I3）、M6（S1）、M7（S2）。**仓库源码零改动**。
2. **真实用户数据驱动**：自写 LevelDB 解析器（`/tmp/t8/ldbstate.py`：SSTable footer varint + snappy raw block 解压 + `.log` 记录重放），从用户真实 `localStorage` 解出**有效**键值状态，再用**用户真实 54 条固化表**跑 D2 落表全链路。
3. **对抗性 harness**：`/tmp/t8/b1.mjs` / `b2.mjs` / `i2.mjs` / `i3.mjs` / `i3b.mjs` / `s12.mjs` / `s1b.mjs` / `fulltable.mjs` / `emptyreal.mjs` / `d3.mjs` / `d3b.mjs`——直接 import 仓库 `lib/tree-model.js`，用真实 `session-<uuid>` 形态构造反例；对 `sidebar.tsx` 的 effect 做**逐行同构 JS 复刻**（含 React 依赖数组语义）。
4. **载荷逐字 + 对照组**：对「运行时置顶不写 localStorage」同时验证「输出恒定」**与**「渲染确实随 topZone 变化」，排除恒真断言（修正了 T6 报告里 `JSON.stringify(Map) === "{}"` 的恒真隐患，见 §⑤-D3(e)）。
5. **GUI bundle 取证**：读 Electron 渲染进程磁盘缓存 + 用宿主 `framedHash`（`dsh-client-modules/lib/index.js:172-176`）对磁盘 `lib/client.js` 复算 rev，并做**逐字节包含**比对。
6. **LevelDB 取证**：自写 `/tmp/t8/ldbstate.py` 解 SSTable（footer varint + snappy raw block + `.log` 重放）与 `/tmp/t8/manifest.py` 解 MANIFEST（**该解析器有 bug，结论已作废**，最终以直接解码 `000856.ldb` + `LOG` 文本为准）。这一步推翻了 T6/T7 对 localStorage 的结论，见 §⑥。

### 1.3 关键命令与退出码

```bash
$ npm test                      # ⇒ tests 350 / pass 350 / fail 0   (连跑 3 次，exit 0)
$ npm run typecheck             # ⇒ exit 0
$ npm run build                 # 连跑两次 ⇒ lib 三文件 md5 恒定（见 §⑤-D2）
$ git diff --numstat -- test/   # ⇒ 1927  0   （删除行 = 0）
$ node --test "test/*.mjs"      # 在 /tmp/t8/baserun 用 HEAD 的 5 个测试文件跑当前 lib ⇒ 253/253
```

---

## ② B1 判定：**真修复**（独立复现证据）

**T6 结论**：落表写入的是 `normalizeSessionId` 后的**裸 id**，与树/表真实形态（恒带 `session-` 前缀）不一致 ⇒ 死条目 + 顶掉正确条目 + 刷新后不在第一位。
**T7 声明**：`placementOfSession` 取「树里的真实 id 形态」，`insertSessionAtFront` 按「表内原形态 > fullOrder > 调用方形态」写入。

### 2.1 我实测：写入形态与 `applyManualOrder` 的 `keyOf` 逐字一致

命令：`node /tmp/t8/b1.mjs`（用真实用户表 + 真实 `session-<uuid>` 形态）

```
user table: containers=22 entries=54 prefixed=54 bare=0
newSessionIds (normalized) = [ '0a1fd499-65d5-46fd-bce8-5ff0a1f4c67a' ]   ← 状态机内仍是裸 id（B1 的形态来源）
  contains BARE new id ? true
written[0] = "session-0a1fd499-65d5-46fd-bce8-5ff0a1f4c67a"
tree real id = "session-0a1fd499-65d5-46fd-bce8-5ff0a1f4c67a"
★ written[0] === tree real id ? true
applyManualOrder order = [ 'session-0a1fd499-…', 'session-49964461-…', 'session-ccdd49c6-…' ]
★ applyManualOrder 首位 === NEW ? true
★ dead entries (逐字匹配失败) = 0 []
★ 既有条目被顶掉的条数 = 0 []
★ 刷新后渲染首项 = "session-0a1fd499-65d5-46fd-bce8-5ff0a1f4c67a"   === NEW ? true
★ 其它容器被改写的个数 = 0
★ 写回后裸 id 条数 = 0
```

**逐字一致性判据**：`applyManualOrder`（`src/tree-model.ts:282-298`）用 `keyOf(item)`（= `item.sessionId`，见 `:2140` 的 `(session) => session.sessionId`）建索引；`placementOfSession`（`:893-905`）返回的 `sessionId` 取自 `effectiveOrder().sessions` 列表元素，而该列表**就是** `applyManualOrder(...).map(s => s.sessionId)` 的产物（`:2143`）⇒ 两处同源。实测 `written[0] === tree real id` 为 `true`。

### 2.2 我实测：以**用户完整真实表**（54 条 / 22 容器）为输入的端到端

命令：`node /tmp/t8/fulltable.mjs`

```
容器 w:/Users/dev/Documents/Project/Workspace/MyProject 用户真实条目 13 全部带前缀: true
树推出的容器 key = [ 'w:/Users/dev/Documents/Project/Workspace/MyProject' ]  与用户表 key 一致: true
--- 用户完整表（54 条 / 22 容器）作为输入 ---
changed = true consumed = [ '0a1fd499-…' ]
★ 发生变化的容器 = [ 'w:/Users/dev/Documents/Project/Workspace/MyProject' ]
★ 目标容器之外被改写的容器数 = 0 (必须 0)
★ projects 未被改: true   ★ worktrees 未被改: true   ★ manual 仍为 true: true
★ 写回后总条目 = 55 带前缀 = 55 裸 id = 0
★ 目标容器外的既有条目逐字未变: true
★ 目标容器死条目 = 0
★ 表首 === 树真实 id: true
★ 刷新后渲染首项 = session-0a1fd499-… === NEW: true
```

⇒ **T6 的 B1 四项判据全部通过**：形态逐字一致 ✅、新条目能被匹配 ✅、无死条目 ✅、不顶掉既有条目 ✅、不改写其它 21 个容器的形态 ✅。

### 2.3 我实测：判别力（变异 M2 / M2b）

在 `/tmp/t8/mut` 副本上把 `writtenId` 还原为 `const writtenId = target`（即 T6 的裸 id 行为）：

```
$ node /tmp/t8/mutate.mjs M2 && node --test
✖ T7/B1 端到端: 真实 `session-<uuid>` 形态下 D2 落表 → 刷新后新会话仍在第一位
✖ T7/B1: `insertSessionAtFront` 写入形态 = 表内/树内原形态（绝不写归一化裸 id）
✖ T7/B2: 落表只发生一次；用户把新会话拖到任意位置后 effect 重跑**不再改写**持久顺序
✖ T7/B2: `planNewSessionInserts` 只消费「落表意图已满足」的 id（不可见的新会话不消费）
✖ T7/S1: `insertSessionAtFront` 遇**空数组**表项 ⇒ 用 `fullOrder` 兜底（不丢会话）
ℹ tests 350 / pass 345 / fail 5
```

另一路变异 M2b（在 `planNewSessionInserts` 里传 `id`（归一化）且不传 `fullOrder`）⇒ `fail 3`（含 `T7/B1 端到端`）。**两条独立变异都能让 B1 回归锁变红 ⇒ 新增端到端用例具备判别力，非恒真。**

### 2.4 残余（新发现，非阻塞，见 §⑧ N3）

若用户的表**已被 T5 的旧 bug 污染**（表里已存在该会话的裸 id 死条目），修复后不会**治愈**它 —— `writtenId` 的①「表内原形态」会优先取到那条裸 id，且因「表首未变」而走幂等分支不写：

```
$ node /tmp/t8/b1b.mjs
污染表（表内有裸 id 死条目）⇒ 写入结果 = [ 'n1', 'session-o0' ]
★ 表首仍为裸 id（死条目未被治愈）? true
```

**我实测**：用户当前真实表中裸 id 条目数 = **0**（`prefixed=54 bare=0`）⇒ 该路径在用户机器上**不适用**。仅当用户在 T5 已生效期间新建过会话才会有残留死条目。列为**观察项**。

---

## ③ B2 判定：**真修复**（含循环与刷新后重复插入分析）

**T6 结论**：`newSessionIds` 只增不减 + 落表 effect 依赖 `manualOrder` ⇒ 用户每次拖拽都重跑并把新会话静默搬回表首。
**T7 声明**：`planNewSessionInserts` + `markNewSessionsWritten` + `pendingNewSessionIdsOf` + `writtenNewSessionIds` 台账，同一新会话只落表一次。

### 3.1 我实测：落表只发生一次；拖到任意位置不被回写

命令：`node /tmp/t8/b2.mjs`（对 `sidebar.tsx:1901-1938` 的 effect 做逐行同构复刻，含依赖数组语义）

```
newSessionIds = [ 'n1' ]
after effect #1: writes = 1 table[0] = session-n1
★ effect 幂等重跑 3 次 ⇒ writes = 1 (必须仍为 1)
★ 拖到末尾后 effect 重跑 ⇒ writes = 1 (必须仍为 1)
★ 拖动结果被保留: true → session-o0,session-o1,session-o2,session-o3,session-o4,session-n1
★ 20 轮重跑后 writes 增量 = 0 (必须 = 0 ⇒ 无写-重渲染-再写循环)
```

- **「写表→重渲染→再写」循环**：我实测 20 轮重跑零增量。机理（我读代码 + 推断）：写表后 `setTopZoneState(markNewSessionsWritten(...))` 改变 `writtenNewSessionIds` ⇒ effect 依赖变化确实会**再跑一次**，但此时 `pendingNewSessionIdsOf(state).length === 0`（`:1905`）⇒ **早退，不写**。⇒ 收敛为「写 1 次 + 重跑 1 次空转」，**不构成自激循环**。✅
- **D3d 不被削弱**：T7 用独立台账而非从 `newSessionIds` 移除；我实测 `first.state.newSessionIds` 仍含新会话（T7 用例 `:4210`，我在变异 M3 下复现其失败，见 §④-I1）。

### 3.2 我实测：刷新页面 / 状态重置后的重复插入分析

```
刷新后 newSessionIds = []          ← 状态机重置；基线把已在树里的新会话记为 known
★ 刷新后 effect ⇒ writes = 0 (必须 = 0 ⇒ 不重复插入)
★ 刷新后表 = session-o0,…,session-o4,session-n1
★ 新会话仍在末尾（用户拖动结果保留）: true
```

⇒ **台账失效（刷新重置）不会导致重复插入**：因为 `newSessionIds` 同时重置，且新会话此时已在基线里 ⇒ 不再被判为新会话。**判定：不是缺陷。** ✅

**极端情形（我构造的边界）**：若刷新后新会话**再次**被判为新会话（例如页面加载瞬间新建、或 S3 的时钟偏差路径）：

```
极端: 刷新后若 NEW 再被判新会话 ⇒ newSessionIds = [ 'n1' ]
★ 极端情形 writes = 1 表[0] = session-n1 (会被搬回表首)
```

即：**一次**回搬。**我的判断**：这是 D2（「新会话总是插入其容器最前」）在该情形下的**应有语义**，不是 B2 的复发（B2 的特征是「每次拖拽都回滚」，此处是「重新判定为新会话时插一次」）。列为**推断 + 可接受**，非缺陷。

### 3.3 我实测：判别力（变异 M3）

```
$ node /tmp/t8/mutate.mjs M3 && node --test      # 删除 done.has(id) 收敛判断
✖ T7/B2: 落表只发生一次；用户把新会话拖到任意位置后 effect 重跑**不再改写**持久顺序
✖ T7/B2: `planNewSessionInserts` 只消费「落表意图已满足」的 id（不可见的新会话不消费）
ℹ tests 350 / pass 348 / fail 2
```

⇒ B2 收敛有**独立**回归锁。✅

### 3.4 D2 其它边界（我实测）

- **只在手动模式写**：`planNewSessionInserts({manual:false}, …)` ⇒ `{order:{manual:false}, consumed:[], changed:false}`（不写、不建表）✅
- **载荷只含新会话**：`{"manual":true,"sessions":{"w:/repo":["session-n1","session-o0",…]}}`，无 `running` / `current` 项 ✅
- **不可见的新会话不消费**（D2 意图不丢失）：`planNewSessionInserts({manual:true}, Map{[w:/repo:['session-a']]}, ['a','ghost'], [])` ⇒ `consumed=['a']`，`ghost` 待其可见后再落表 ✅

---

## ④ I1 / I2 / I3 / S1 / S2 逐条判定

### I1 —— 测试 fixture 覆盖真实形态 + 具备判别力 ⇒ **已处理**

**T7 声明**：用变异回退验证（M2 ⇒ 4 条失败；M3 ⇒ 2 条；M4b/M5b/M5c/M6/M7 各 1 条）。
**我独立复现的 8 个变异（全部在 `/tmp/t8/mut` 副本，仓库源码零改动）**：

| 变异 | 还原的缺陷 | 我实测失败条数 | 失败的用例 |
|---|---|---|---|
| **M2** | B1 全链路（`writtenId = target`） | **5** | `T7/B1 端到端`、`T7/B1 insertSessionAtFront 形态`、`T7/B2 落表只发生一次`、`T7/B2 planNewSessionInserts 消费`、`T7/S1 空数组` |
| **M2b** | B1（编排层传归一化 id） | **3** | `T7/B1 端到端`、`T7/B2 落表只发生一次`、`T7/B2 planNewSessionInserts 消费` |
| **M3** | B2 收敛（删 `done.has`） | **2** | `T7/B2 落表只发生一次`、`T7/B2 planNewSessionInserts 消费` |
| **M4b** | I2（释放判据失效） | **1** | `T7/I2 拖当前会话到紧邻下一行` |
| **M5b** | I3（基线 `known` 不含 `seen`） | **6** | `T5/状态机 无变化同一引用`、`T5/状态机 多轮轮询`、`T7/B1 端到端`、`T7/B2 落表只发生一次`、`T7/B2 收敛不削弱 D3d`、`T7/I3 取消归档不误判` |
| **M5c** | I3（删 `known.add(seen)`） | **1** | `T7/I3 基线之后首次出现且当场归档` |
| **M6** | S1（空数组不兜底） | **1** | `T7/S1 空数组表项` |
| **M7** | S2（删 `null`/非对象守卫） | **1** | `T7/S2 契约外 topZone 输入` |

⇒ **每个 T7 修复点都至少有一条测试在其被还原时变红**，判别力成立。注：我实测的条数与 T7 自述（M2 ⇒ 4、M3 ⇒ 2、M4b/M5b/M5c/M6/M7 各 1）在 M2 上**不一致**（我 5 vs 自述 4），其余一致；我的 M2 多命中的是 `T7/S1`（`writtenId` 变异同时破坏 S1 的空数组兜底断言）。**不构成缺陷，仅为自述数字偏差。**

**断言质量抽查（我逐条读 + 变异验证）**：
- `T7/B1 端到端`（`:4043-4094`）真断言行为：断言 `newSessionIds` 是裸 id（`:4059`）、`written[0] === REAL_IDS.new`（`:4075`）、**无死条目**（`:4077` 遍历树做逐字匹配）、刷新后渲染首项（`:4085`）、原有条目全部保留（`:4089`）。**非恒真**（M2 下变红）。
- `T7/B2 落表只发生一次`（`:4141-4189`）真断言：首次 `changed===true`、二次 `changed===false`、拖动后 `changed===false` 且表逐字等于拖动结果、不产生重复条目。**非恒真**（M3 下变红）。
- `T7/I3`（`:4303-4376`）含**对照组**（`:4326-4338`：真正的新会话仍被判出）⇒ 非恒真。
- `T7/S1`（`:4391-4415`）含**两个对照**（表项缺失、非空表项）⇒ 非恒真。
- `T7/S2`（`:4417-4437`）含**对照组**（合法输入仍置顶，`:4427-4431`）⇒ 非恒真。
- 新增 13 条用例共 **71 处 `assert.`**（我实测），无「只断言不抛错」的弱用例（`doesNotThrow` 均配对照断言）。

**保留项（我实测）**：T6 点名的两条弱用例 **`test/tree-model.test.mjs:3966`（`T5/D2 端到端`）仍用裸 id**（`session('new1')` / `'o0'`）。它**未被删除**（符合「既有断言零删除」），但仍是弱断言；B1 的回归锁已由新增的 `:4043`（真实形态）承担 ⇒ **不影响修复判定**，列为 §⑧ N2（次要）。

**判定：I1 已处理到位。** 测试确实具备判别力（我独立复现 8 个变异全部命中）。

### I2 —— D4 释放接线缺口 ⇒ **已处理**

**T6 结论**：释放挂在 `reorderKeys !== null` 之后 ⇒ 拖当前会话到紧邻行之前（`reorderKeys` 返回 `null`）不释放。
**T7 声明**：新增 `isTopZoneReleasingDrag`（`:1127`），释放移到 `reorderKeys` 之前（`sidebar.tsx:2004`）。

我实测（`node /tmp/t8/i2.mjs`，忠实复刻 `commitDrag` 接线）：

```
--- I2：T6 缺口复现（拖当前会话到紧邻下一行之前）---
reorderKeys(keys, cur, session-r1, before) = null (null = 旧实现的释放判据失效)
★ 释放发生? true (必须 true)
  持久顺序未变（视觉无变化）: true
--- I2 对照：无效拖拽不得误释放 ---
★ 拖到自己身上 ⇒ 释放? false (必须 false)
★ 伪造的跨容器 drop（accepts 应拒）: false (必须 false ⇒ onDrop 早退 ⇒ 不释放)
★ worktree/project 拖拽 ⇒ 释放? false false (必须 false false)
--- I2：释放语义与 D4 一致 ---
释放前 topZoneSessionKeys = [ 'session-cur', 'session-r1' ]
释放后 topZoneSessionKeys = [ 'session-cur' ] (只应剩当前会话)
释放幂等（二次同一引用）: true
释放只影响该容器: [ 'session-b1' ]
空 containerKey 不误释放: true
```

- **任何有效拖拽都释放**：`isTopZoneReleasingDrag('session', 's:cur', 's:session-r1') === true`，与 `reorderKeys` 是否返回 `null` **解耦**（`sidebar.tsx:2004` 先于 `:2010-2013`）。✅
- **无效拖拽不误释放**：拖到自己（`activeKey === overKey`）⇒ `false`；非会话行 ⇒ `false`；跨容器由 `onDrop` 的 `accepts`（`sidebar.tsx:2063-2068`）早退 ⇒ 不释放。✅
- **与 D4 语义一致**：释放后该容器只剩当前会话（D3c 保持），其它容器不受影响，幂等返回同一引用。✅
- **变异 M4b 判别力**：`fail 1`（`T7/I2 拖当前会话到紧邻下一行`）。✅

**一处诚实披露（非缺陷）**：`isTopZoneReleasingDrag` 只判「非会话行 / 同一行 / 空 key」，**不**校验「over 是否同容器」——同容器约束由调用点 `accepts()` 保证。这是**双保险的合理分工**（`onDrop` 已在 `accepts` 为假时 `return`，`:2102`），我实测伪造的跨容器 `drop` 不会到达 `commitDrag`。列为 §⑧ N4（观察项，非缺陷）。

**判定：I2 已处理到位。**

### I3 —— 归档会话的 JSDoc 与行为 ⇒ **JSDoc 已修；行为修复在真实链路不可达（仍未修复，降级为潜伏）**

**T6 结论**：`:668-669` 的 JSDoc 声称归档会话「不判新会话」与实测相反。
**T7 声明**：`:799` 基线分支 `known.add(id)` 覆盖归档；JSDoc `:681-703` 重写，把「谁算旧会话」与「谁参与顶部区判定」分开。

**(a) JSDoc 与行为一致性 —— 我实测（`node /tmp/t8/i3.mjs`）**：

```
--- I3 路径 A：基线时已归档，之后取消归档 + 新消息 ---
baselined, known = [ 's1', 'oldarch' ] （应含 oldarch）
  归档会话不进轨迹: undefined undefined (应 undefined undefined)
★ 取消归档 + 新消息 ⇒ newSessionIds = [] (必须 [])
--- I3 路径 B：基线之后首次出现且当场归档 ---
★ 当场归档 ⇒ newSessionIds = [] (必须 []) known 含 late? true
★ 之后取消归档 ⇒ newSessionIds = [] (必须 [])
--- I3 对照组：真正的新会话仍判得出（断言非恒真）---
★ 真正新会话 ⇒ newSessionIds = [ 'realnew' ] (必须 ["realnew"])
--- I3 副作用核查：归档会话不得进顶部区 ---
★ 渲染行 = [ 'session-o0' ] (归档不得出现)
--- I3 引用稳定性 ---
★ 输入顺序反转 ⇒ 返回同一引用? true (必须 true)
```

⇒ JSDoc（`src/tree-model.ts:691-703`）关于「`knownSessionIds` 含归档与子代理」「`eligible` 排除归档」的表述**与实现逐条一致**，无新的误导表述。T6 点名的错误句（原 `:668-669`）**已被删除**。✅

**(b) 关键新发现：该修复在真实链路不可达（我实测 + 代码取证）**

`src/tree-model.ts:734` 把归档会话从 `eligible` 排除，但 `:730-733` 的 `seen` 收集**只遍历 `observations`**。而 `observationsOf`（`:1493-1515`）的数据源是 `tree.projects / tree.ungrouped`。真实链路里 `buildProjects`（`src/projects.ts:400`、`:480`）**已把归档会话从树里剔除**：

```
$ node /tmp/t8/i3b.mjs
情形1（树里不含归档会话 —— 真实链路）known = [ 's1' ] 含 oldarch? false
  ★ 取消归档 + 新消息 ⇒ newSessionIds = [ 'oldarch' ] ⚠️ 仍误判
情形2（树里含归档会话 —— 单测构造）known = [ 's1', 'oldarch' ] 含 oldarch? true
  ★ 取消归档 + 新消息 ⇒ newSessionIds = [] ✅ 未误判
```

即：T7 的单测 fixture（`test/tree-model.test.mjs:4307-4312`）把**已归档的会话仍留在树里**，与真实链路（已剔除）不符 ⇒ **该用例对真实链路恒真**。

**我实测的用户真实数据**：`~/.dsh/storages/workspace.json` 的 `archivedSessionIds` 共 **173** 条，**全部带 `session-` 前缀，裸 id = 0**。结合 T6 已确证「宿主**无** unarchive API」（`@deepseek-ai/dsh-api-workspace-controller` 只有 `archiveSession`），**结论**：

- **可达性**：当前**不可达**（无 unarchive API）。若用户手改 `~/.dsh/storages/workspace.json` 移除某条归档 id，该旧会话会被 `firstSeenAfterStart` 判为新会话并写进固化表表首（违反 D5）。
- **判定**：**部分修复** —— JSDoc 修正 ✅（真实收益）；行为修复**在真实链路不生效**（测试通过但为恒真路径）❌。**严重度：次要/潜伏**（与 T6 判定的「重要（潜伏）」相比，我下调为次要，因为真实链路下该修复完全不改变行为，不引入回归；但**T7 声明的「已修」在真实链路不成立**，这是对 T7 自述的**事实性纠正**）。

**判定：I3 = 部分修复。** 详见 §⑧ N1。

### S1 —— 空数组表项丢会话 ⇒ **已处理**

我实测（`node /tmp/t8/s12.mjs`）：

```
空数组 + fullOrder: [ 'session-NEW', 'session-a', 'session-b' ]     ← 修复前为 ["session-NEW"]（丢 a/b）
表项缺失 + fullOrder: [ 'session-NEW', 'session-a' ]                ← 对照，行为不变
非空表项（不被 fullOrder 覆盖）: [ 'session-NEW', 'session-x' ]      ← 对照，以表为基底
空数组 + fullOrder undefined: {"sessions":{"w:/repo":["session-NEW"]}}   ← 不抛
空数组 + sessions undefined:  {"sessions":{"w:/repo":["session-NEW"]}}   ← 不抛
fullOrder 含契约外元素: [ 'session-NEW', 'session-a' ]               ← 契约外元素被跳过，不抛
```

用**真实表形态**（该容器为 `[]`）端到端（`node /tmp/t8/emptyreal.mjs`）：

```
空数组容器 ⇒ 落表结果 = [ 'session-0a1fd499-…', 'session-c', 'session-b', 'session-a' ]
★ 既有会话未丢失（3 条都在）: true
★ 新会话在表首: true
★ 其它容器被改写数 = 0
```

变异 M6（还原 `stored ?? fullOrder ?? []`）⇒ `fail 1`（`T7/S1`）。✅

**残留（我实测，非阻塞）**：`insertSessionAtFront` / `planNewSessionInserts` 对 `order.sessions` 的**值**仍不做类型收窄：

```
sessions 项为字符串  => THROW TypeError: base.find is not a function
sessions 项为 null  => THROW TypeError: Cannot read properties of null (reading 'length')
fullOrder 为字符串   => THROW TypeError: base.find is not a function
planNewSessionInserts: newSessionIds/alreadyWritten/sessions 为 null => THROW (not iterable)
```

**真实链路不可达**：`readManualOrder`（`sidebar.tsx:279-302`）经 `stringListMapOf`（`:260-268`）清洗，**非数组值 / 空数组键一律丢弃** ⇒ 值恒为 `string[]`。列为 §⑧ N5（次要）。

**判定：S1 已处理到位。**

### S2 —— `topZone` 契约外输入 ⇒ **已处理**

我实测（`node /tmp/t8/s12.mjs`，含比 T6 更广的输入集）：

```
null / 42 / "x" / true / [] / {}                     => undefined（不抛）
{runningSessionIds:42} / {recentlyFinishedSessionIds:42}
  / {newSessionIds:42} / {releasedContainerKeys:42}  => undefined（不抛）
{runningSessionIds:[42,null,""]}                     => undefined（不抛）
{runningSessionIds:{}} / {releasedContainerKeys:{}}  => undefined（不抛）
{runningSessionIds:['session-a'], releasedContainerKeys:['w:/repo']} => undefined（释放优先，正确）
对照组（合法输入仍置顶）: [ 'session-a' ]              ← 断言非恒真
buildRows(topZone:null) 不抛: true
buildRows(topZone:42) 不抛: true
元素为对象: undefined（不抛）
containerKey=42: undefined（不抛）
```

⇒ T6 点名的三条抛错路径（`null` / `{runningSessionIds:42}` / `{releasedContainerKeys:42}`）**全部消除**。变异 M7 ⇒ `fail 1`（`T7/S2`）。✅

**边界（我实测，属 JS 语言层面而非本函数缺陷）**：`Object.defineProperty` 造出的**抛错 getter** 仍会冒泡（`getter 抛异常 ⇒ THROW: getter boom`）。契约外输入的定义是「类型不符」，不含「恶意 getter」⇒ **不作为缺陷**，仅记录。

**判定：S2 已处理到位。**

---

## ⑤ D1–D6 回归红线核验表

| 红线 | 判定 | 我的实测证据 |
|---|---|---|
| **D1** 手动/默认模式都正确；不代改用户 localStorage | ✅ **满足** | ① 默认模式（`manual !== true`）`planNewSessionInserts` 原样返回、`consumed=[]`、`changed=false`（`/tmp/t8/b2.mjs`）；`insertSessionAtFront` 返回 `undefined`。② 代码层两道闸：`sidebar.tsx:1902`、`tree-model.ts:938/1030`。③ **文件层**：`Local Storage/leveldb/` 全部文件在本任务期间（23:50–00:2x）**mtime 与 sha256 均未变**（详见 §⑥）。④ 用**用户真实 54 条表**跑 D2 后，除目标容器外**零改写**、`projects`/`worktrees` 逐字未变（`/tmp/t8/fulltable.mjs`）。 |
| **D2** 新会话插入容器最前 + 写固化表（唯一落表例外），幂等 | ✅ **满足** | 表首 === 树真实 id（`/tmp/t8/b1.mjs`）；载荷只含该新会话（`{"manual":true,"sessions":{"w:/repo":["session-n1","session-o0",…]}}`）；**幂等**：重跑 3 次 `writes` 恒为 1（`/tmp/t8/b2.mjs`）；刷新后渲染首项仍为新会话（`/tmp/t8/fulltable.mjs`）。 |
| **D3 a–g** 顶部区在截断前生效；运行时置顶**不写** localStorage；`effectiveOrder` 硬置 `topZone: undefined` | ✅ **满足** | 见下方逐条表。 |
| **D4** 拖动该容器后顶部区保留立即失效（用户已裁决 D4 优先于 D3a） | ✅ **满足** | `before release: [fin1, run1, q0]` → `after release: [q0,q1,q2]`；**只释放该容器**（`w:/repo-wt` 的 `b1` 仍置顶）；**当前会话不受影响**（`[fin1, q0]`）；**幂等**（二次同一引用）；刷新后（`releasedContainerKeys: []`）行为恢复。均见 `/tmp/t8/d3.mjs`。 |
| **D5** 已有会话收到新消息**不**顶到前面 | ✅ **满足** | `/tmp/t8/d3.mjs`：`m0.updatedAt` 从 1000 推到 999999 ⇒ 渲染 `[m0,m1,m2] → [m0,m1,m2]`，**frozen: true**。 |
| **D6** 容器/项目行 `runningCount` 口径未改 | ✅ **满足** | `src/tree-model.ts:1956` 仍为 `heads.filter((session) => session.running === true).length`（裸字段口径）。我实测：2 条自身 running ⇒ worktree/project 行 `runningCount = 2`；**只有子代理 running** ⇒ `runningCount = 0`（聚合**未**混入）。`git diff -U0 src/tree-model.ts \| grep runningCount` 只命中**注释**行（新增说明），无代码行改动。 |

### D3 a–g 逐条（`/tmp/t8/d3.mjs` + `/tmp/t8/d3b.mjs`）

| 子项 | 判定 | 证据 |
|---|---|---|
| (a) 运行中会话进顶部区（含仅 subagent 在跑） | ✅ | `running top: [session-run1, session-x0]` |
| (b) 运行结束后仍保留 | ✅ | `finished kept: [session-fin1, session-x0]` |
| (c) 当前会话在顶部区第一位 | ✅ | `current first: [session-x3, session-x0]` |
| (d) 顶部区之外按既有持久顺序 | ✅ | 手动顺序 `[d0…d7]`，`d7` 刚结束 ⇒ `[d7,d0,d1,d2,d3]`，顶部区外相对顺序保持 |
| **(e) 运行时置顶不写 localStorage** | ✅ | **载荷逐字**：5 种不同 `topZone` 输入下 `effectiveOrder` 的**不同载荷数 = 1**（唯一载荷 `["session-d0"…"session-d7"]`）；**对照组**：`buildRows` 渲染序的**不同值数 = 4**（zone0/zone4 相同，zone1/2/3 各异）⇒ **断言非恒真**。⚠️ 我在 T6 方法上做了修正：T6 报告里的 `JSON.stringify(effectiveOrder(...))` 会因 `Map` 序列化成 `"{}"` 而**恒真**（`worktrees`/`sessions` 是 `Map`）；我改为展开 `[...o.sessions]` 后重测，结论仍成立（=1）。 |
| (f) 顶部区先于 5 条截断 | ✅ | 10 条 + `f9` 刚结束 ⇒ 渲染首项 `session-f9`，可见 5 条 |
| (g) 顶部区内部顺序确定性 | ✅ | `updatedAt` 降序 + `sessionId` 升序 tiebreak；输入顺序反转后 `observeTopZone` 返回**同一引用**（`/tmp/t8/i3.mjs`） |
| 补充：`effectiveOrder` 硬置 `topZone: undefined` | ✅ | `src/tree-model.ts:2132`（`topZone: undefined`），结构上杜绝运行时顶部区混进持久顺序 |

---

## ⑥ 用户 localStorage 现状结论（⚠️ 纠正 T7/T6 报告）

### 6.1 我实测的解析方法

自写 `/tmp/t8/ldbstate.py`：解 SSTable footer（varint 取 meta/index handle）→ 解压 index block（snappy raw）→ 解压 data block → 按 `internal key` 的 trailer 取 `(user_key, sequence, type)`；再重放 `.log` 的 write batch；**按 sequence 取每个 user key 的最新记录**（含 `DEL`）。

**关于「哪张表生效」的更正（我自查并纠正）**：我最初另写了一个 MANIFEST 解析器（`/tmp/t8/manifest.py`）试图求出 live set，**该解析器有 bug**（`tag=6` 删除记录未被正确解析，输出「deletes=0」，进而得出「生效表是 `000855.ldb`」这一**错误**结论）。我随后核对目录列表发现 **`000855.ldb` 根本不存在**（`ls 000855.ldb` ⇒ `No such file or directory`）⇒ 该结论作废。

**权威判据（我改用直接解码 + `LOG` 文本）**：

```
$ ls -la *.ldb *.log
-rw-------  34943 Sep  1 17:46 000005.ldb
-rw-------  72710 Sep 21 23:34 000854.log
-rw-------  51514 Sep 21 22:12 000856.ldb

$ python3  # 直接解码两张 .ldb 的全部键（不受 MANIFEST 解析影响）
=== 000005.ldb entries= 29  max_seq= 29     ← 旧 L2 表，只有 dsh.sessions.current / dsh.workspace.view.v5
    order key present? False
=== 000856.ldb entries= 173 max_seq= 8362   ← 22:12 compaction 产物，**含 order 键**
    seq=8299 type=1 len=5838   _http://…\x00\x01dsh-worktree-groups.order
    seq=8301 type=1 len=798    _http://…\x00\x01dsh-worktree-groups.collapsed
    seq=8346 type=1 len=51     _http://…\x00\x01dsh-worktree-groups.expandedAll
    seq=8357 type=1 len=215    _http://…\x00\x01dsh.sessions.current
    seq=8361 type=1 len=71576  _http://…\x00\x01dsh.workspace.view.v5
    order key present? True

$ cat LOG | tail -6      # LevelDB 自身的日志（mtime 22:12:23）
2026/09/21-22:12:23.429 Generated table #856@0: 173 keys, 51514 bytes
2026/09/21-22:12:23.430 compacted to: files[ 0 1 1 0 0 0 0 ]
2026/09/21-22:12:23.431 Delete type=2 #855   ← 被删的是 **000855**（在内存/临时态存在过，从未落盘为本目录文件）
2026/09/21-22:12:23.431 Delete type=2 #851
2026/09/21-22:12:23.431 Delete type=2 #853
2026/09/21-22:12:23.431 Delete type=2 #847
2026/09/21-22:12:23.431 Delete type=2 #849
```

`LOG` 显示最后一次 compaction 是 **22:12:23**（生成 `#856`，删除 `#855`），此后**无任何 compaction / recovery** ⇒ 生效状态 = **`000856.ldb`（seq ≤ 8362）** + **`000854.log`（seq 8363–8369）**。（`000854.log` 的 mtime 23:34 只是追加，不改变 `LOG` 的最后一次 compaction 时间。）我最初的 MANIFEST 结论**已作废**，最终结论**不变**（order 键存在），但证据链改为上述**直接解码 + LOG**，不依赖我那个有 bug 的 MANIFEST 解析器。

### 6.2 我实测的结论

| 项 | 我实测值 | 证据 |
|---|---|---|
| **`dsh-worktree-groups.order` 键是否存在** | ✅ **存在** | `000856.ldb`（22:12 compaction 的产物，`LOG` 显示此后无 compaction ⇒ 生效表）内 `user_key = _http://127.0.0.1:43120\x00\x01dsh-worktree-groups.order`，seq=8299，PUT，value len=5838。`000005.ldb`（旧 L2，29 条，max_seq=29）**不含**该键；`.log`（seq 8363–8369）也不含。全库**无任何该键的 DEL 记录**（我扫了全部 SSTable + log 的全部 `(user_key, seq, type)`）。 |
| **`manual` 状态** | ✅ **`true`**（用户**仍处于手动排序模式**） | `json.loads(value[1:])["manual"] is True`（LevelDB value 前缀 1 字节为类型标记 `0x01`） |
| **固化表条目数** | **54** 条 | 分布：22 个容器（7 条在 `p:__ungrouped__`、16 条在 `p:ws:fb0333d3-…`（= AnyWork）、13 条在 `w:/…/Workspace/MyProject` 等）；`projects` 14 项、`worktrees` 9 键 |
| **id 形态** | **带 `session-` 前缀 54 / 裸 id 0** | `prefixed=54 bare=0` |
| **其它键** | `dsh-worktree-groups.collapsed`(798B, seq 8301)、`dsh-worktree-groups.expandedAll`(51B, seq 8346)、`dsh.sessions.current`(log seq 8367)、`dsh.workspace.view.v5`(log seq 8369, 71760B) | 同一次 `ldbstate.py` 扫描 |
| **本任务期间是否被写入** | ❌ **未写入** | `Local Storage/leveldb/` 全部文件在本任务期间（23:50–00:2x）**mtime 与 sha256 均未变**：`000854.log` mtime `2026-09-21 23:34:24` / sha256 `8345d836…`；`000856.ldb` `22:12:23` / `f340932e…`；`MANIFEST-000001` `22:12:23` / `31845d8d…`。我全程只读。 |
| **MANIFEST / LOG 是否也未被写入** | ❌ **未写入** | `LOG` mtime `22:12:23`、`MANIFEST-000001` mtime `22:12:23` ⇒ LevelDB **未发生 compaction / recovery**（`LOG` 最后一行仍是 22:12:23 的 `Delete type=2 #849`），进一步佐证渲染进程未产生新写入。 |

### 6.3 ⚠️ 对 T7 报告的纠正

> **T7 报告称**：「核验用户 localStorage 时发现**已无** `dsh-worktree-groups.order` 键（仅 `dsh.sessions.current` / `dsh.workspace.view.v`）」。

**我实测该结论错误。** 该键**存在**，值为 `manual:true` + 54 条带前缀条目。T7 得出错误结论的可能原因（**我推断**）：只扫了 `.log`（`000854.log` 里确实只有 `dsh.sessions.current` / `dsh.workspace.view.v5`）与**旧 L2 表** `000005.ldb`（29 条，确实不含该键），未解码 22:12 compaction 的产物 `000856.ldb`（173 条，**含**该键）。T6 报告的同类表述（「`000854.log` 全文只有 `dsh.sessions.current`」⇒ 暗示未写入 order）也**同样片面**。

### 6.4 ⇒ 真人 GUI 复验应在**哪种模式**下进行

**结论：用户当前处于 `manual: true`（手动排序模式），真人 GUI 复验必须在手动模式下进行。** 具体前置：

1. 复验前**不要**点「恢复默认排序」——否则 `manual` 变 `false`，D2 落表 effect 会直接早退（`sidebar.tsx:1902`），**无法验证 D2/B1/B2**。
2. 复验路径：新建会话 → 发首条消息（触发 `blank: true → false`）→ 确认它出现在其容器**第一位** → **刷新页面** → 确认仍在第一位（B1 的验收）；再把该新会话**拖到末尾** → 确认**不回弹**（B2 的验收）。
3. 复验后如需还原：用户表当前 54 条、形态全部正确（无死条目）；T7 修复**不会**破坏既有条目（我实测 `目标容器之外被改写的容器数 = 0`）。

---

## ⑦ GUI bundle 现状结论

### 7.1 我实测的两个 rev 值

**方法**：宿主 `artifactRevision(bundle, sourceMap)` = `framedHash("plugin-artifact", sourceMap === undefined ? [bundle] : [bundle, sourceMap.body])`，即 `sha1(domain + "\0" + Σ(len + ":" + bytes))` 取前 12 hex（`/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js:172-176`）。

```
$ node -e '... framedHash("plugin-artifact",[fs.readFileSync("lib/client.js")]) ...'
bundle len 109870   map? false   ← 构建产物无 client.js.map（scripts/build-client.mjs 未产出 map）
artifactRevision (no map): 75a4e25dd09c
md5(lib/client.js) = 4a030fb204c53133ae7f2f8989b42adf      ← 与 T7 声明的「4a030fb2…」一致
```

| 值 | rev | 来源 |
|---|---|---|
| **磁盘 `lib/client.js` 复算 rev** | **`75a4e25dd09c`** | 我对当前磁盘 bundle 复算（`bundle len 109870`） |
| **GUI 缓存最新条目 URL 里的 rev** | **`75a4e25dd09c`** | `Cache/Cache_Data/5efe8275b8d5c486_0`，mtime **`2026-09-21 23:46:14`**，URL `…/plugins/??dsh-worktree-groups/client.js&rev=75a4e25dd09c` |
| （历史）T6 时的 rev | `4ab061599df0` | `Cache/Cache_Data/41b013c53119a697_0`，mtime `22:24:09` |

**逐字节比对**：缓存响应体在偏移 **107** 处开始即磁盘 `lib/client.js` 的**完整副本**（`full disk contained: True`，重叠区 `mismatches 0`）：

```
$ python3  # 逐字节包含比对
5efe8275b8d5c486_0 len 110366 disk-prefix-at 107
   full disk contained: True
   mismatches in overlap: 0 []
```

**T7 符号存在性（我实测，缓存 vs 磁盘逐项一致）**：

```
cache 5efe8275 isTopZoneReleasingDrag: 2   planNewSessionInserts: 2   placementOfSession: 2   writtenNewSessionIds: 9
disk  lib/client.js 同上逐项相同
```

### 7.2 结论：**GUI 当前提供的 bundle 已含 T7 修复，用户无需刷新即可生效**

- 渲染进程启动于 `2026-09-21 13:11:30`（`ps -eo lstart` 实测 PID 41491/41496），**远早于** 23:46:14 的缓存条目 ⇒ 23:46:14 的条目是**该渲染进程在 23:46 重新拉取**的结果（说明 GUI 在 23:46 前后发生过一次刷新/重载）。
- 23:46:14 的 rev（`75a4e25dd09c`）**等于**磁盘当前 rev ⇒ **缓存与磁盘一致**。
- 补充时间线（`Cache_Data` 内 `dsh-worktree-groups/client.js` 全部条目）：`22:11:59 rev=3acbd3618d52` → `22:24:09 rev=4ab061599df0`（T6 时）→ `23:34:19 rev=fc5b8c46fc3a` → `23:34:58 rev=95cf171c0d68` → **`23:46:14 rev=75a4e25dd09c`**（最新，= 磁盘）。

⚠️ **但有一个「必须刷新」的前置条件需要注意**：`src/sidebar.tsx` 与 `src/tree-model.ts` 的 mtime 分别是 `23:46:08` / `23:34:52`，而 `lib/client.js` 由我在 `23:51:04` 的 `npm test`/`npm run build` **重建**（md5 与 23:46 时相同 ⇒ 源码未变、构建幂等）。因此：

- **若用户在 23:46:14 之后没有再次刷新**：GUI 加载的正是 23:46:14 拉取的 `75a4e25dd09c` = 当前磁盘 rev ⇒ **已含 T7 修复，无需刷新**。
- **若 GUI 在那之后又被重载过**：会拉同一个 rev ⇒ 同样已含修复。

⇒ **明确结论：当前缓存中的 bundle 对应 rev = 磁盘最新 rev = `75a4e25dd09c`，GUI 已加载含 T7 修复的 bundle。用户不必为「加载修复」而刷新；但真人 GUI 复验（§6.4）本身需要一次页面刷新以重置运行时顶部区状态（`newSessionIds` / `writtenNewSessionIds`），这是 D2/B1 验收步骤的一部分，不是 bundle 问题。**

---

## ⑧ 新发现问题清单（按严重度）

### N1（次要 / 潜伏，**纠正 T7 自述**）I3 的行为修复在真实链路**不生效**，其单测为恒真路径

- **位置**：`src/tree-model.ts:730-736`（`seen` 只由 `observations` 收集）↔ `src/projects.ts:400` / `:480`（`buildProjects` 已把归档会话从树里剔除）；测试 `test/tree-model.test.mjs:4307-4312`（fixture 把归档会话**留在树里**）。
- **复现**：`node /tmp/t8/i3b.mjs` ⇒ 真实链路（树不含归档会话）下 `newSessionIds = ['oldarch']`（**仍误判**）；单测路径（树含归档会话）下 `newSessionIds = []`。
- **影响**：T7 声明的「I3 已修」在真实链路**不成立**。当前**不可达**（宿主无 unarchive API，我已确认 `workspace.json` 的 173 条归档 id 全部带前缀）；若用户手改 `~/.dsh/storages/workspace.json` 取消归档，该旧会话会被判为新会话并写进固化表表首（违反 D5）。
- **建议方向（只报告，不代改）**：在 `sidebar.tsx:1827-1831` 的 `observationsOf` 入参里，把 `tree.archivedSessionIds` 也投影成 `archived: true` 的观测（或让 `observeTopZone` 额外接收一个 `seenSessionIds`），使 `seen` 真正覆盖归档会话；并让单测 fixture 与真实链路同构（归档会话**不进**树）。

### N2（次要）T6 点名的弱用例 `T5/D2 端到端`（`:3966`）仍用裸 id

- **位置**：`test/tree-model.test.mjs:3966-3992`（`session('new1')` / `'o0'`）。
- **影响**：该用例对 B1 仍**恒真**（我实测：变异 M2 下它**未**变红）。B1 的判别力已由新增的 `:4043` 承担 ⇒ 不影响修复判定。
- **建议方向**：把它的 fixture 改为 `session-<uuid>` 形态（或直接删除/改名为「纯函数语义」用例），避免后来者误以为它是 D2 的端到端验收。

### N3（观察项）已被 T5 污染的裸 id 死条目不会被修复治愈

- **位置**：`src/tree-model.ts:954-957`（`writtenId` 的①「表内原形态」优先）。
- **复现**：`node /tmp/t8/b1b.mjs` ⇒ 表内已有裸 id 时，`writtenId` 取到该裸 id，且因「表首未变」走幂等分支不写 ⇒ 死条目残留。
- **影响**：**用户当前表裸 id = 0**（我实测）⇒ 不适用；仅对「T5 生效期间新建过会话」的用户有残留。
- **建议方向**：落表时可顺手把「归一化后相同但形态不同」的旧条目**替换**为树里的真实形态（当前实现只替换表首那一条）。

### N4（观察项，非缺陷）`isTopZoneReleasingDrag` 不校验同容器

- **位置**：`src/tree-model.ts:1127-1132`。
- **说明**：同容器约束由 `sidebar.tsx:2063-2068` 的 `accepts()` + `:2102` 的 `onDrop` 早退保证（双保险的合理分工）。我实测伪造的跨容器 drop 不会到达 `commitDrag`。**不建议改动**。

### N5（次要）`insertSessionAtFront` / `planNewSessionInserts` 对 `order.sessions` 的**值**不做类型收窄

- **位置**：`src/tree-model.ts:945-946`（`stored.length` / `base.find`）、`:1040`（`newSessionIds` 可迭代性）。
- **复现**：`node /tmp/t8/s1b.mjs` ⇒ `sessions` 项为字符串 / `null` 时抛 `TypeError`；`newSessionIds`/`alreadyWritten`/`sessions` 为 `null` 时抛 `not iterable`。
- **影响**：**真实链路不可达**（`readManualOrder` 经 `stringListMapOf` 清洗，`sidebar.tsx:260-268`）。与 S2 的修复风格不一致（S2 已收窄 `topZone`）。
- **建议方向**：与 S2 同姿势加 `Array.isArray` 收窄。

### N6（次要）文档数字：`docs/PRD.md:521` 的「**284** → 337」

- **我实测**：HEAD 全量 = **253**（`node --test "test/*.mjs"` 用 HEAD 的 5 个测试文件跑当前 lib ⇒ `tests 253 / pass 253 / fail 0`）；当前全量 = **350**；`T5` 前缀 **53** 条、`T7` 前缀 **13** 条。
- **核对**：`350 − 13 = 337` ✅（T7 行）；`337 − 53 = 284` ✅（T5 行）。⇒ **两处数字自洽**；T6 报告里「282 与实测不符」的告警**已不再适用**（`282` / `335` 已从 PRD 中消失，我 `grep` 实测 0 命中）。
- **唯一保留**：`284` 无法由我**直接**复现（需 T5 之前的历史树快照），我实测能锚定的是 `253`（HEAD）与 `337`（= 350−13）。属**可接受**（减法自洽）。

---

## ⑨ 未验证部分（如实说明）

1. **真人 GUI 操作未做**：我无法操作 Electron 渲染进程（不联网、不启动服务器、不改用户数据）。因此「拖拽插入线、被拖行半透明、点击后的视觉反馈」**未验证**；D2/B1/B2 的最终验收仍需一次真人操作（步骤见 §6.4）。
2. **`.tsx` 接线未在真实 React 运行时验证**：`sidebar.tsx` 的 effect 时序（依赖数组触发、`setState` bail-out）我用**逐行同构 JS 复刻**验证语义（`/tmp/t8/b2.mjs`），属「我推断 + 同构实测」，**不是**真实 React 渲染验证。「无写-重渲染-再写循环」的结论依赖「`pendingNewSessionIdsOf === 0` 时早退」这一**纯函数**判据（我实测），不依赖 React 语义 ⇒ 该结论较硬。
3. **`src/sidebar.tsx` 不进 `lib/`**（构建只产出 `lib/sidebar.d.ts`，`.tsx` 由 `scripts/build-client.mjs` 打进 `lib/client.js`）⇒ `sidebar.tsx` 的接线本身跑不到 `node --test` 里，只能靠同构复刻 + 变异（我的 M4b 变异作用在 `lib/tree-model.js` 的 `isTopZoneReleasingDrag` 上，等价于还原 `sidebar.tsx:2004` 的调用效果）。
4. **渲染进程时钟一致性未实测**（T6 的 S3 残留风险）。我用注入 `nowMs` 的确定化时钟规避，未观测真实 `Date.now()` 与宿主 `updatedAt` 的关系。
5. **`~/.dsh` 与 localStorage 的「写入」只做了 mtime + sha256 比对**，未做系统级文件审计（如 `fs_usage`）。但 MANIFEST/LOG 的 mtime 未变（LevelDB 未发生 compaction/recovery）是较强的旁证。
6. **LevelDB「哪张表生效」的判据**：我最初用自写 MANIFEST 解析器，**发现其有 bug**（`tag=6` 删除记录未正确解析）后已改用**直接解码 `000856.ldb` + LevelDB 自身 `LOG` 文本**作为权威判据（见 §6.1 更正）。§⑥ 的结论（order 键存在、`manual:true`、54 条全带前缀）**不依赖**那个有 bug 的解析器。遗留不确定：`000005.ldb` 与 `000856.ldb` 的**新旧覆盖关系**我未能用 MANIFEST 严格证明（解析器有 bug）；我依据的是「`LOG` 显示最后一次 compaction 是 22:12:23 生成 `#856`、此后无 compaction」+「`000005.ldb` 的 mtime 是 9/1 且 max_seq=29（远小于 8362）」⇒ 我**推断** `000856.ldb` 的 seq 8299 是该键的最新记录。即使该推断有误（例如 `000005.ldb` 更新），`000005.ldb` **也不含** order 键 ⇒ 「该键存在」的结论**不受影响**。
7. **未逐条判定 350 条测试的有效性**：我对 T7 的 13 条逐条读断言 + 8 个变异验证判别力；对 T5 的 53 条与既有 253 条只做了回归（253/253 通过）与关键抽查。

---

## ⑩ 结论：**建议验收**（附 1 条自述纠正与 2 条次要项）

### 10.1 阻塞缺陷

| 缺陷 | T7 声明 | 我的判定 | 依据 |
|---|---|---|---|
| **B1** | 已修 | ✅ **真修复** | 写入形态 === 树真实 id（逐字）；用户真实 54 条表下**死条目 0、顶掉 0、其它容器改写 0**；刷新后渲染首项为新会话；变异 M2/M2b ⇒ `fail 5`/`fail 3` |
| **B2** | 已修 | ✅ **真修复** | 落表只发生一次（重跑 3 次 `writes` 恒 1）；拖到末尾不被回写；20 轮重跑零增量（无自激循环）；刷新后不重复插入；变异 M3 ⇒ `fail 2` |

### 10.2 其余项

| 项 | 判定 |
|---|---|
| **I1** 测试判别力 | ✅ 已处理（我独立复现 **8 个变异全部命中**；抽查无恒真/弱断言，新增 71 处 `assert.`） |
| **I2** D4 释放接线 | ✅ 已处理（有效拖拽必释放、无效拖拽不误释放、语义与 D4 一致；变异 M4b ⇒ `fail 1`） |
| **I3** 归档语义 | ⚠️ **部分修复**：JSDoc 修正 ✅ 真实收益；行为修复在**真实链路不可达**（T7 单测为恒真路径）⇒ 见 N1 |
| **S1** 空数组表项 | ✅ 已处理（真实表形态下端到端不丢会话；变异 M6 ⇒ `fail 1`） |
| **S2** 契约外 `topZone` | ✅ 已处理（T6 的三条抛错路径全消；变异 M7 ⇒ `fail 1`） |
| **D1–D6** | ✅ **全部满足**（逐条证据见 §⑤） |
| **测试/构建** | ✅ `npm test` 连跑 3 次 **350/350 pass / fail 0**；`typecheck` exit 0；`build` 两次 md5 恒定（`client.js 4a030fb2…` / `tree-model.js 31a561d5…` / `index.js 59205114…`）；`git diff --numstat -- test/` = `1927 0`（**删除行 0**） |
| **用户数据安全** | ✅ 本任务期间 `localStorage` 与 `~/.dsh` **零写入**（mtime + sha256 双证） |
| **文档数字** | ✅ `PRD:521` 的「284 → 337」+ T7「337 → 350」与实测（253 / 350 / 53 / 13）**自洽**；T6 的「282 不符」告警已不适用 |

### 10.3 是否建议验收

**建议验收。** 两条阻塞缺陷（B1/B2）经我独立构造的反例与变异测试**确证真正修复**，且无新增回归（D1–D6 全部满足，既有 253 条断言零删除、全绿）。

**验收时需向用户如实说明的三点**：

1. **I3 的修复在真实链路不生效**（N1）——T7 报告「I3 已修」的表述**不准确**；当前不可达（宿主无 unarchive API），但单测与真实链路不同构，不应据此宣称该缺陷已消除。
2. **`docs/PRD.md:521` 的 `284` 无法直接复现**（N6）——虽与实测自洽（337−53），但属推断口径，建议在文档里改写成可复现的「HEAD 253 → 350」。
3. **T6 的弱用例 `:3966` 仍在**（N2）——不影响判定，但建议一并清理，避免后来者误用。

**建议处置顺序**：N1（补 `seen` 的真实链路覆盖 + 让单测 fixture 与真实链路同构）→ N6/N2（文档与弱用例）→ N3/N5（防御性收窄，可选）。

**最终验收仍需一次真人 GUI 操作**（我无法操作渲染进程）：在**手动模式**（用户当前即为此模式）下「新建会话 → 发首条消息 → 确认在容器第一位 → 刷新 → 确认仍在第一位 → 拖到末尾 → 确认不回弹」。

---

### 附：本报告的证据脚本清单（全部在 `/tmp/t8/`，不属仓库产物）

| 脚本 | 覆盖 |
|---|---|
| `ldbstate.py` / `lvlog.py` | LevelDB 状态重建（SSTable footer varint + snappy raw block 解压 + `.log` write batch 重放） |
| `manifest.py` | ⚠️ MANIFEST 解析尝试（**有 bug，结论已作废**；最终以 `000856.ldb` 直接解码 + `LOG` 文本为准） |
| `getorder.py` | 解出用户真实 `dsh-worktree-groups.order`（`/tmp/t8/order_now.json`） |
| `b1.mjs` / `b1b.mjs` / `fulltable.mjs` / `emptyreal.mjs` | **B1**（形态逐字 / 真实 54 条表端到端 / 污染表 / 空数组容器） |
| `b2.mjs` | **B2**（effect 同构复刻 / 幂等 / 拖动 / 循环 / 刷新后重复插入） |
| `i2.mjs` | **I2**（释放接线 / 无效拖拽对照 / 与 D4 一致） |
| `i3.mjs` / `i3b.mjs` | **I3**（归档语义 / 真实链路可达性） |
| `s12.mjs` / `s1b.mjs` | **S1 / S2**（空数组 / 契约外输入对抗性探测） |
| `d3.mjs` / `d3b.mjs` | **D3 a–g / D4 / D5 / D6**（含载荷逐字 + 对照组） |
| `mutate.mjs` + `/tmp/t8/mut` | **8 个变异**（M2/M2b/M3/M4b/M5b/M5c/M6/M7），仓库源码零改动 |
| `/tmp/t8/baserun` | HEAD 的 5 个测试文件对当前 lib 实跑 ⇒ 真实基线 **253** |
