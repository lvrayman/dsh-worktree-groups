# 独立复审报告：T11「顶部区 = 只有正在运行的会话」

- **任务 ID**：T12（独立复审，默认只读）
- **复审对象**：`dsh-worktree-groups` 工作区未提交改动（`src/tree-model.ts` / `src/sidebar.tsx` / `test/tree-model.test.mjs` / `README.md` / `docs/PRD.md` / `docs/INTERFACES.md`），HEAD = `11b1144`
- **唯一语义基准**：用户终裁「**正在运行的会话固定在顶部，拖不动，只要是结束了的会话就不再固定置顶了**」
- **本报告唯一写入的文件**：`docs/REVIEW-running-only-topzone.md`
- **证据类型标注**：`[审查真实代码]` / `[驱动真实导出]` / `[复刻版]` / `[推断]`。本报告的**所有顺序类结论**均取自 `[驱动真实导出]` 的 `buildRows` 渲染行序列；未使用任何 effect 复刻版作为结论依据。

---

## ① 复审范围与方法

| # | 核验项 | 方法 | 证据类型 |
|---|---|---|---|
| 1 | 首要缺陷（已结束会话拖不动/回弹） | 自建 harness（`/tmp/t12/harness1.mjs`），只 import `lib/tree-model.js` 的**真实导出**，枚举**全部**落点，断言打在 `buildRows` 的会话行序列上 | `[驱动真实导出]` |
| 2 | 运行中判据同源 / 不可拖但仍接受落点 | 驱动 `isTopZoneRunningSession` + `topZoneSessionKeys`；`.tsx` 接线用逐行源码审查 | `[驱动真实导出]` + `[审查真实代码]` |
| 3 | 删除项彻底性 | 全仓 grep 符号 + 逐行读 `.tsx`/`.ts` + 运行时把旧字段塞回 `topZone` 观察零效果 | `[审查真实代码]` + `[驱动真实导出]` |
| 4 | D1–D6 / T9 / N1 回归 | 真实导出驱动 + 只读解析真实 `localStorage` 载荷 | `[驱动真实导出]` |
| 5 | D12 保底交互 | 真实导出驱动，折叠/展开两态对照 | `[驱动真实导出]` |
| 6 | 测试与变异 | `npm test`×2 / `npm run typecheck` / `npm run build`×2；HEAD 副本基线；自建 10 个定点变异 | `[驱动真实导出]` |
| 7 | 产物与 GUI bundle | `lib/` vs `src/` grep；只读解析 Electron 渲染缓存，复算宿主 `artifactRevision` 并与磁盘 `lib/client.js` 逐字节比对 | `[审查真实代码]` |
| 8 | 文档一致性 | 逐行核对三份文档 + 关键词扫描 | `[审查真实代码]` |
| 9 | 用户数据零写入 | leveldb 文件 mtime/sha256 快照 + **空闲归因实验** + **受控构建实验** | `[驱动真实导出]`（观测实验） |

**关于「不能用复刻版自证」**：我**没有**重写 `sidebar.tsx` 的任何 effect。我的 harness 直接调用 `lib/tree-model.js` 的导出（`observeTopZone` / `observationsOf` / `topZoneInputOf` / `planNewSessionInserts` / `markNewSessionsWritten` / `reorderKeys` / `buildRows` / `effectiveOrder`），并按 `sidebar.tsx` 的真实调用**顺序**串联（观测 → 投影 → 落表 → 渲染），与既有测试的做法一致。**`.tsx` 本身无法被 `node --test` 执行**（它不进 `lib/`），因此涉及 `.tsx` 的结论一律显式标注为源码审查，并另做了针对性变异实验（见 §⑦ M7/M8）来量化该盲区。

---

## ② 首要缺陷判定：**已修复**（渲染层全落点枚举）

### 2.1 复现前置（制造真实失效模式）

```
会话集：5 条普通已结束 + session-done（曾在跑）+ session-run（仍在跑）
观测两轮：running={done,run} → running={run}   ⇒ done 是「running 下降沿」
[驱动真实导出] state 字段 = ["baselined","startedAtMs","knownSessionIds","blankOf","runningOf","newSessionIds","writtenNewSessionIds"]
              ⇒ 无 recentlyFinishedIds；投影字段 = ["runningSessionIds","newSessionIds","writtenNewSessionIds"]
              ⇒ 无 recentlyFinishedSessionIds
```

### 2.2 落点**全枚举**（不是抽样）

| 枚举集 | 目标数 × 上下半 | 有效落点 | 渲染 ≠「运行中置顶 + 其余逐字持久表」 | 渲染层真的移动 |
|---|---|---|---|---|
| `done` → {5 条普通 + run} | 6 × 2 = 12 | 10（2 个等价落点 `reorderKeys` 返回 `null`） | **0** | **9** |
| **全矩阵**：每条已结束会话 → 每个落点 | 4 条 × (4+1) × 2 = 40 | 25 | **0** | — |

核心断言（逐字）：

```js
// harness1.mjs
const expected = [RUN, ...next.filter((x) => x !== RUN)]
assert JSON.stringify(renderIds(rows)) === JSON.stringify(expected)   // 10/10 通过
```

**结论**：已结束的会话（含 running 下降沿的「刚结束」会话）拖到容器内**任意**落点后，`buildRows` 的渲染顺序 = 「运行中项置顶」+「其余**逐字**等于持久表顺序」。**不回弹**。

### 2.3 刚结束的会话不再被钉在顶部

`running: true → false` 的下降沿**不产生任何保留态**：`observeTopZone` 返回的 state 里没有任何字段携带「它曾在跑」，`topZoneInputOf` 的投影也不含；`runningSessionIds` 恒为当前在跑者。→ **该失效模式的载体已被彻底移除**。

### 2.4 反复轮询（走 `observeTopZone` 非基线分支）后仍不回弹

```
持久表 ['session-r0', done, 'session-r1', run]，连续 40 轮 observeTopZone(..., now=3000+i*1000)
渲染序列恒为 ["session-run","session-r0","session-done","session-r1"]  ← 唯一值集合大小 = 1
漂移次数 = 0；runningSessionIds 恒 = ["run"]（未把已结束会话塞入）
```

**② 判定：首要缺陷真修复。** 证据类型 `[驱动真实导出]`。

---

## ③ 运行中会话判据一致性判定

### 3.1 判据确实**同一实现**（无分叉）

- `[审查真实代码]` `src/tree-model.ts:437-451` 导出 `isTopZoneRunningSession`；
- `[审查真实代码]` `src/tree-model.ts:564` 置顶侧调用它：`const isRunning = isTopZoneRunningSession(session, zone)`；
- `[审查真实代码]` `src/sidebar.tsx:2197-2201` 不可拖侧调用它：
  ```ts
  const sessionDrag = dragHandlersFor(
    row,
    { kind: 'session', itemId: row.sessionId, containerKey: row.parentKey },
    !isTopZoneRunningSession(row, topZone),
  )
  ```
- 两处**同一个导出函数**，无第二份判据实现。`[驱动真实导出]` 校验：`topZoneSessionKeys(...)` 的置顶集合与 `list.filter(s => isTopZoneRunningSession(s, zone))` 在「无新会话」输入下**逐字相同**（`["session-run2","session-run1"]`）。

### 3.2 一个**有意的不对称**（如实标注，非缺陷）

| 会话类别 | 被置顶 | 可拖动 |
|---|---|---|
| 正在运行 | ✅ | ❌ |
| 尚未落表的新会话 | ✅ | ✅ |

`[驱动真实导出]`：`pinned = ["session-new","session-run"]`，`notDraggable = ["session-run"]` ⇒ 差集 = 新会话。
**判断**：**符合用户终裁**（终裁只说「**正在运行的**会话…拖不动」）。新会话置顶由 D2 落表 + 台账承载，用户拖走后不会被搬回（T9 机制，见 §⑤）。测试用例名「置顶集合 === 不可拖动集合」在**无新会话**输入下成立，其 JSDoc 也已限定该语境 —— 措辞略宽但**不构成误导**（用例本身用无新会话输入）。

### 3.3 运行中行**仍接受落点**

`[审查真实代码]` `src/sidebar.tsx:2081-2086` 的 `accepts()` **不读** `draggable`；第三个参数只写入返回对象的 `draggable` 字段（`:2088`），并在 `onDragStart` 里做「伪造 dragstart 也不进入拖拽态」的双保险（`:2092-2093`）。`onDragOver` / `onDrop` 只依赖 `drag !== null && accepts(drag)`。
`[驱动真实导出]` 对照：把已结束会话拖到 `run1`/`run2` 的上下半（4 组）⇒ 渲染顺序全部符合「运行中置顶 + 持久表」，说明落点语义在计算层成立。

### 3.4 多个运行中会话的相对顺序确定性

`[驱动真实导出]`：`pinned = ["session-run2","session-run1"]`（`updatedAt` 降序）；同输入 20 次渲染，序列差异 **0** 次；`updatedAt` 相同时按 `sessionId` 升序（既有 `byRecency` tiebreak，测试有专门用例）。

**③ 判定：判据同源，运行中不可拖但接受落点，多运行中顺序确定。**

---

## ④ 删除项彻底性判定

### 4.1 符号级（`grep` 全仓）

| 符号 | `src/tree-model.ts` | `lib/tree-model.js` | `lib/tree-model.d.ts` | `lib/client.js` | 判定 |
|---|---|---|---|---|---|
| `recentlyFinishedIds` | 1（**仅注释**） | 1（仅注释） | 1（仅注释） | **0** | 已删 |
| `recentlyFinishedSessionIds` | 1（仅注释） | 1（仅注释） | 1（仅注释） | **0** | 已删 |
| `releasedContainerKeys` | 1（仅注释） | 1（仅注释） | 1（仅注释） | **0** | 已删 |
| `releaseTopZoneContainer` | 1（仅注释） | 1（仅注释） | 1（仅注释） | **0** | 已删 |
| `isTopZoneReleasingDrag` | 1（仅注释） | 1（仅注释） | 1（仅注释） | **0** | 已删 |
| `pinnedSessionKeys` | **0** | 0 | 0 | 0 | 已删 |
| `currentSessionOf` | **0** | 0 | 0 | 0 | 已删 |

`[审查真实代码]` 类型定义实证：`lib/tree-model.d.ts` 的 `TopZoneState` 字段仅 `baselined / startedAtMs / knownSessionIds / blankOf / runningOf / newSessionIds / writtenNewSessionIds`；`TopZoneInput` 仅 `runningSessionIds / newSessionIds / writtenNewSessionIds`。**旧字段不是接口成员**。

### 4.2 `.tsx` 接线残留

`[审查真实代码]` `grep -n "releaseTopZoneContainer\|releasedContainerKeys\|recentlyFinished\|isTopZoneReleasingDrag\|pinnedSessionKeys\|currentSessionOf" src/sidebar.tsx` ⇒ 命中 5 行，**全部位于 `*` / `//` 注释内**（1625、1626、1992、1995、2547），无任何调用。`commitDrag`（`src/sidebar.tsx:2005-2051`）逐行确认：会话/项目/worktree 三个分支都只调 `reorderKeys` + `persistOrder`，**无任何顶部区动作**。
`isCurrent` 在 `.tsx` 只剩**行高亮**用途（`:1017` `aria-current`、`:1021` `rowStyle`），**不参与置顶**。

### 4.3 运行时不可达性（把旧字段塞回去）

`[驱动真实导出]` 向 `topZone` 塞入 `recentlyFinishedSessionIds` / `releasedContainerKeys` / `isCurrent` / `currentSessionId` / `pinnedSessionKeys` 全部旧字段 ⇒ 渲染序列与基线**逐字相同**（`["session-y0","session-y1","session-y2"]`）。→ 旧机制**不可达**。

**④ 判定：删除彻底，无死代码残留，无残留调用。**

---

## ⑤ D1–D6 + T9 两处修复 + N1 回归核验表

全部 `[驱动真实导出]`；`buildRows` 会话行序列为准，持久表仅作对照。

| 红线 | 核验方法 | 实测 | 判定 |
|---|---|---|---|
| **D1** 手动模式 | 持久表与 `updatedAt` 降序**刻意不同**：表 `[o0,o1,run]` ⇒ 渲染 `[run,o0,o1]` | 手动顺序生效 + 运行中置顶 | ✅ |
| **D1** 默认模式 | `manual:false`，`topZone={runningSessionIds:['d2']}` | 渲染 `[d2,d1,d0]`（运行中置顶 + 其余 `updatedAt` 降序） | ✅ |
| **D1** 默认模式不建表 | `planNewSessionInserts({manual:false}, …)` | `{changed:false, consumed:[]}`，`order.sessions === undefined` | ✅ |
| **D2** 新会话判定 | `blank:true → 非 blank` 两轮观测 | `newSessionIds = ["0a1fd499-…"]`（归一化） | ✅ |
| **D2** 落表形态 | 真实 `session-<uuid>` fixture | 表首 = `session-0a1fd499-65d5-46fd-bce8-5ff0a1f4c67a`，**逐字带前缀**（与树 `keyOf` 同形） | ✅ |
| **D2** 幂等 | 再跑 `planNewSessionInserts` | `changed=false`，不产生重复条目 | ✅ |
| **D2** 台账收敛 | `markNewSessionsWritten` 后重跑 | `changed=false, consumed=[]` | ✅ |
| **D2** 刷新后仍在最前 | 丢掉全部运行时状态后 `buildRows` | `renderIds[0] === NEW` | ✅ |
| **D2** 无死条目 / 不顶掉既有 | 表内每个 id 都能被树匹配；3 条既有条目全在 | 全绿 | ✅ |
| **D2** 真实载荷佐证 | 只读解析真实 `localStorage`（4 个版本） | 会话条目 56→58，**保留 56 丢失 0**；每个容器的既有相对顺序**均为子序列（10/10 ok）**；新增 2 条**均位于其容器下标 0**；`projects` 集合不变（顺序变化 = 用户拖拽项目行）；`worktrees` 桶 9→9 | ✅ |
| **T9** 渲染期台账 | 已落表新会话拖到**每个**落点 | 渲染 = 持久表（不回弹）；台账仍只记一次 | ✅ |
| **D3e** `effectiveOrder` 硬置 `topZone:undefined` | 4 组不同 `topZone`（`undefined` / running / 全 running / 含旧字段） | `JSON.stringify` 载荷**逐字一致** | ✅ |
| **D3e** 对照组（排除恒真） | `buildRows` 换 `topZone` | `r0=[z2,z1,z0]` vs `r1=[z2,z0,z1]` ⇒ 渲染**确实**随 `topZone` 变化 | ✅ |
| **D5** 顺序冻结 | 已有会话 `updatedAt` 推到 9,999,999 | 渲染 `[f1,f0]` 不变 | ✅ |
| **D6** `runningCount` | 1 条自身 running + 1 条仅子代理 running | worktree/project `runningCount = 1` = `heads.filter(s=>s.running===true).length`（**不含**子代理聚合）；父行 `running=true`（聚合） | ✅ |
| **N1/I3** 归档 | 真实链路形态（树不含归档，id 仅来自 `archivedSessionIds`） | 归档 id 进 `known`；取消归档 + `updatedAt=9,999,999` ⇒ `newSessionIds = []` | ✅ |
| 搜索模式 | `query='alpha'` + `topZone` | 不应用顶部区（`[s1,s0]` 按 `updatedAt`），行 `depth=0` | ✅ |
| 契约外输入 | `topZone=null` / 数字字段 | 静默降级不抛（既有 S2 用例，M9 变异中被命中） | ✅ |

**⑤ 判定：D1–D6 + T9 + N1 全部通过。**

---

## ⑥ D12 保底机制交互判定

### 6.1 T11 的披露**属实**

`[驱动真实导出]`（`/tmp/t12/harness2-d12.mjs`）：

```
持久表（9 条）：[o0,o1,o2,o3,o4,o5,o6,o7,cur]      ← cur = 当前会话，第 9 位
折叠态（默认，未点「展开其余」）渲染：["session-o0","session-o1","session-o2","session-o3","session-cur"]
展开态（expandedAllKeys）渲染：      全 9 条，cur 仍在第 9 位
```

⇒ 「当前会话拖到第 8/9 位 + 分组折叠」时，渲染顺序**不再**逐字等于持久顺序，`cur` 被保底提到**可见区第 5 位**。披露准确。

### 6.2 我补充发现的三点（T11 未披露）

1. **该交互触发于「默认未折叠」态，而非仅折叠态**：`[驱动真实导出]` 默认入参（`collapsedKeys={}`、`expandedAllKeys={}`）下渲染就是 5 条且含 `cur`；不传 `currentSessionId` 时才渲染 `[o0..o4]`。即**用户无需折叠**，只要容器超过 5 条会话就会看到 `cur` 被保底。
2. **它让「当前会话」在默认态下拖到第 6 位之后出现「视觉零位移」**：拖前 `[o0,o1,o2,o3,cur]` → 拖到第 7 位后仍是 `[o0,o1,o2,o3,cur]`（持久表已变，渲染未变）。对照：**非当前**会话拖到第 7 位则**可见变化**（该行消失、第 5 位由后继补位）。
3. **非当前会话也受截断影响**（拖到第 6 位后从可见区消失），但**没有保底**把它拉回来 ⇒ 保底是 `currentSessionId` 的**专属例外**。

### 6.3 是否违反用户终裁？

**判断：不违反字面终裁，但存在实质冲突，建议主代理提请用户裁决。**

**不违反**的理由：
- 终裁的对象是**「顶部区 / 固定置顶」**（`topZoneSessionKeys` → `applyManualOrder` 的 `pinnedKeys`），而 D12 保底在 `truncateSessions` 内部，作用于**截断阶段**，二者是**不同机制**；
- 保底**不把 `cur` 固定在第 1 位**（`[驱动真实导出]`：`ids[0] === 'o0'`，`cur` 在第 5 位），也没有把它「钉在最前」；
- 它是 2026-09-21 **独立冻结**的裁决（「用户不会看不见自己」），且 T11 未改动 `truncateSessions`；
- 用户终裁句式为「只要是**结束了的**会话就不再固定置顶」——`cur` 在此处并非被置顶，而是被「保底可见」。

**存在实质冲突**的理由：
- 终裁还说了「已结束的会话位置**完全由持久拖拽顺序决定**」（任务书 §终裁 2）。在默认态下，`cur`（已结束）的位置**不**完全由持久顺序决定 —— 保底把它从第 7 位改画到第 5 位；
- 用户可观察到的现象与**首要缺陷同形**：把当前会话往下拖，行**不动**（视觉零位移）；这正是用户本轮投诉的「拖不动/回弹」的**表面特征**（虽然根因不同、且只影响 1 行）；
- 该机制**只在 `currentSessionId` 上触发**，是「当前会话」的一条例外 —— 与用户「删除当前打开的会话置顶例外」的取向**同向性存疑**。

**建议**（不自行改码）：由主代理提请用户二选一 ——
- (A) 保留 D12（现状）：接受「当前会话在默认/折叠态下被保底进前 5」；
- (B) 让 `emitContainer` **不再**传 `currentSessionId` 给 `truncateSessions`（保底在树路径失效，导出契约不变）：彻底满足「位置完全由持久顺序决定」，但用户可能「看不见自己当前会话」。
建议同时把 6.2 的三点补进文档「已知机制交互」段（现文档只写了折叠态）。

---

## ⑦ 测试与变异验证

### 7.1 测试数字（全部实跑，可复现）

| 口径 | 命令 | 实测 | 退出码 |
|---|---|---|---|
| **HEAD 基线**（`11b1144`） | `git archive HEAD \| tar -x -C /tmp/t12/head` 后在该副本 `npm test` | **253 / 253 pass**（`tests 253, pass 253, fail 0`） | 0 |
| **当前全量 #1** | `npm test` | **380 / 380 pass** | 0 |
| **当前全量 #2** | `npm test` | **380 / 380 pass** | 0 |
| `tree-model` 单文件 | `node --test test/tree-model.test.mjs` | **247 / 247 pass** | 0 |
| T11 前缀用例 | `grep -c "^test('T11" test/tree-model.test.mjs` | **46** | — |
| 各文件 `test(` 计数 | `grep -c "^test("` | git 8 + ledger 19 + projects 34 + routes 72 + tree-model 247 = **380** | — |
| `npm run typecheck` | `tsc -p tsconfig.json --noEmit` | 无输出 | **0** |
| `npm run build` ×2 | sha256 | `lib/tree-model.js` = `5dc188e2aac62982ab018ae1ec5275e65d75d2754a4566394e6429429dd122b3`（两次一致）；`lib/client.js` = `5fd07739659f8cc3d001807684fe844a0f19177915cf3c38d14424ca11744ff8`（两次一致） | 0 |
| 确定性 | 同输入渲染 20 次 | 序列差异 **0** 次 | — |

⇒ **HEAD 基线 253 可复现；380/380 可复现；T11 报告的数字与我的实测一致。**

### 7.2 新增用例**确实断言渲染层顺序**（附断言片段）

`[审查真实代码]` 权威口径由 `containerIds(rows)` 定义（`test/tree-model.test.mjs:2748-2750`）：

```js
function containerIds(rows, containerKey = 'w:/repo') {
  return rows.filter((row) => row.kind === 'session' && row.parentKey === containerKey).map((row) => row.sessionId)
}
```

**片段 A** —— 首要缺陷全落点枚举（`:5240-5251`），断言打在 `drag.rerun.ids`（= `buildRows` 输出）：

```js
assert.deepEqual(
  drag.rerun.ids,
  [RUN, ...drag.order.sessions['w:/repo'].filter((id) => id !== RUN)],
  `★ 拖 DONE 到 ${overId} ${half}：渲染顺序必须 = 运行中置顶 + 其余逐字按持久表（不回弹）`,
)
assert.deepEqual(
  drag.rerun.ids.filter((id) => id !== RUN),
  drag.order.sessions['w:/repo'].filter((id) => id !== RUN),
  `★ 拖 DONE 到 ${overId} ${half}：摘掉顶部区成员后渲染顺序 === 持久表顺序`,
)
```

**片段 B** —— T9 已落表新会话拖动（`:5474-5478`）：

```js
assert.deepEqual(
  drag.rerun.ids,
  drag.order.sessions['w:/repo'],
  `★ 已落表的新会话拖到 ${overId} ${half}：渲染 = 持久顺序（不回弹）`,
)
```

**片段 C** —— D12 保底（`:3920-3923`），同样打在 `containerIds(rows)`：

```js
const ids = containerIds(rows)
assert.equal(ids.length, COLLAPSED_SESSION_LIMIT, '仍是 5 条截断')
assert.equal(ids[0], 'o0', '顶部区为空 ⇒ 第一位是持久顺序第一条（不再有 isCurrent 置顶）')
assert.equal(ids.at(-1), 'cur', '★ 保底把当前会话放进可见区（D12 语义）')
```

⇒ **判定：新增/改写的 T11 用例确实以渲染层顺序为断言对象，不是只看持久表。**（对比：`effectiveOrder` 持久化用例故意断言载荷 —— 那是 D3e 的正确对象。）

### 7.3 我自己设计的定点变异（10 个，独立于 T11 的 7 个）

对 `/tmp/t12/mut` **仓库副本**打补丁 → `npm run build` → `node --test test/tree-model.test.mjs`（247 条）。

| # | 变异 | 预期 | 实测 pass/fail | 命中用例（代表） |
|---|---|---|---|---|
| **M1** | 恢复「刚结束保留」判据（`topZoneSessionKeys` 重新读 `recentlyFinishedSessionIds`） | 捕获 | **246 / 1** | `T11/③ 定点回归: 「刚结束保留」已从判据里彻底不可达` |
| **M2** | 渲染期**无条件提升**新会话（忽略 `writtenNewSessionIds` 台账） | 捕获 | **241 / 6** | `T11/⑤ T9 机制不回退`、`T11/⑤ 定点回归`、`T9/缺陷1 真实生命周期`（×3）、`T7/B2 + T9` |
| **M3** | 恢复「当前会话置顶」（`isCurrent`） | 捕获 | **243 / 4** | `T11: 当前会话不再置顶`、`T11: 当前会话在已结束时留在持久顺序位置`、`T11/截断: 已结束的当前会话…保底提升`、`T11/接线: currentSessionId 已不参与置顶` |
| **M4** | 完整恢复旧状态机（字段 + 下降沿 + 投影 + 释放） | 捕获 | **241 / 6** | `T11/① 首要缺陷`、`T11/③ 定点回归`、`T11: 状态机里没有 recentlyFinishedIds`、`T5/状态机: 基线不产生保留态`、`T11: 运行时状态不含已拖动容器`、`T9→T11/缺陷2` |
| **M5** | 判据分叉：置顶只认**裸** `running`，不可拖仍走聚合判据 | 捕获 | **240 / 7** | `T5/D3a: 仅 subagent 在跑 ⇒ 父会话进顶部区`、`T5/D3a: 运行中会话不在本容器`、`T11: 只在其所属容器内置顶` 等 |
| **M6** | 去掉归档 id 补投影（N1 回退） | 捕获 | **243 / 4** | `T11/⑧ N1 不回退`、`T9/N1 真实链路`（×2）、`T9/N1 变异验证` |
| **M9** | T11 文档所述 M5 语义：`isTopZoneRunningSession` 恒 `false` | 捕获 | **212 / 35** | 含文档所指 `T5/D3a: 传了 topZone（哪怕空对象）⇒ 裸 running 也进顶部区`，另有 34 条 |
| **M10** | `isTopZoneRunningSession` 恒 `true` | 捕获 | **203 / 44** | 广泛命中（顶部区/截断/持久化/D5/T9） |
| **M4b** | **只**恢复释放机制（`releasedContainerKeys` 读取，无消费者） | **等价变异** | **247 / 0** | 无 —— 如实标注为**等价变异** |
| **M7** | `.tsx` 接线退化：删掉 `dragHandlersFor` 第三参（运行中又可拖） | 期望捕获 | **247 / 0** ⚠️ | 无 —— **测试盲区** |
| **M8** | `.tsx` 判据分叉：`!isTopZoneRunningSession(...)` → `row.running !== true` | 期望捕获 | **247 / 0** ⚠️ | 无 —— **测试盲区** |

**必须包含的两类已覆盖**：M1（恢复刚结束保留）✅、M2（渲染期无条件提升）✅。

### 7.4 等价变异 / 盲区（如实标注）

1. **M4b 等价变异**：恢复 `releasedContainerKeys` 的**读取**但无任何消费者 ⇒ 行为逐字等价，**无法**被任何测试捕获（正确，不是缺陷）。
2. **M7/M8 —— 真实盲区（新发现问题，见 §⑪ N-1）**：`sidebar.tsx` 的拖拽接线**不在 `lib/`**，`node --test` 跑不到；因此「运行中不可拖」与「判据同源」这两条**在测试层完全无判别力**。当前实现是正确的（§③ 逐行源码审查确认），但**回归保护为零**。
3. 我的 M9/M10 数字（35 / 44）与 T11 文档所载 M5（fail 1）**不同**：T11 的 M5 补丁语义（`isTopZoneRunningSession` 恒 `false`）应命中其文档所指用例，我复现了该用例被命中，但总失败面远大于 1 条。**不视为缺陷** —— 两者的补丁具体写法不同（我的版本同时改了两个 `return true`），但**建议文档把 M5 的补丁写法写明**，否则「fail 1」不可独立复现（见 §⑪ N-4）。

---

## ⑧ 产物与 GUI bundle rev 结论

### 8.1 `lib/` 与 `src/` 一致

`[审查真实代码]` 新符号在两侧同步（`isTopZoneRunningSession` 4/4、`topZoneInputOf` 3/3、`observeTopZone` 6/6、`pendingNewSessionIdsOf` 1/1、`initialTopZoneState` 1/1 …；差异项均为 JSDoc 被 `tsc` 压缩所致，非逻辑差异）。已删符号在 `lib/client.js` 中 **0 次**出现。

### 8.2 GUI 缓存 bundle 的 rev 核验（T3/T6/T8 方法）

复算算法（`[审查真实代码]` 宿主 `@deepseek-ai/dsh-client-modules/lib/index.js:172-179`）：

```js
framedHash(domain, parts) = sha1(domain + "\0" + Σ(String(part.byteLength) + ":" + part)).slice(0,12)
artifactRevision(bundle, sourceMap) = framedHash("plugin-artifact", [bundle] /* 无 .map */)
```

**方法学纠正**：`[审查真实代码]` `lib/index.js:547` 的 `rebuilt()` 对**完整 client.js 文件字节**取 `artifactRevision`，而 `:302` 的 `buildCombo()` 用 `framedHash("combo", [sourceBytes, sourceMap])` 算 combo URL 的 rev。**两者的 rev 不是同一个哈希**。经实测验证：
- 对磁盘 `lib/client.js` 全量字节复算 `artifactRevision` ⇒ **`3b45db08f3b1`**，与缓存里 `plugins/??dsh-worktree-groups/client.js&rev=3b45db08f3b1` **逐字相同** ✅
- 对同一 bundle 复算 `framedHash("combo", …)` ⇒ `a33c56ed1faa` ≠ `3b45db08f3b1`（证明二者确实不同）

**逐字节比对**（`/tmp/t12/cache-rev3.mjs`，只读）：

| 缓存项 | mtime | worktree-groups 模块体字节 | sha256(前 16) | 含旧符号 | 含 `isTopZoneRunningSession` | **与磁盘 factory 体逐字相等** |
|---|---|---|---|---|---|---|
| `a496aa163e20aa4d_0` | 09-21 14:11:59 | 106844 | `cc5afcdb4c2437df` | ✅ | ❌ | ❌ |
| `41b013c53119a697_0` | 09-21 14:24:09 | 107093 | `ca83418e80ea23c3` | ✅ | ❌ | ❌ |
| `495291328ad86394_0` | 09-21 15:34:19 | 109509 | `a484bef5da7f7c4a` | ✅ | ❌ | ❌ |
| `24ef367597da9093_0` | 09-21 15:34:58 | 109568 | `c0268efc99b14261` | ✅ | ❌ | ❌ |
| `5efe8275b8d5c486_0` | 09-21 15:46:14 | 109792 | `a88c9ea438c6f620` | ✅ | ❌ | ❌ |
| `c0ee8009c3d40131_0`（combo 16.6MB） | 09-22 00:52:01 | 109792 | `a88c9ea438c6f620` | ✅ | ❌ | ❌ |
| `3588b103b6d2be57_0` | 09-22 01:13:55 | 110679 | `a6b72f42750eb649` | ✅ | ❌ | ❌ |
| `95480716d28335d7_0`（combo） | 09-22 01:29:23 | 110679 | `a6b72f42750eb649` | ✅ | ❌ | ❌ |
| `53318c434921e90a_0` | 09-22 01:53:24 | 108486 | `9a186a0fd412e5ff` | ❌ | ✅ | ✅ |
| **`7eac58811719ba32_0`（combo，最新）** | **09-22 02:10:24** | **108486** | **`9a186a0fd412e5ff`** | ❌ | ✅ | **✅** |

磁盘 `lib/client.js`：`bytes = 108564`，`sha256 = 5fd07739659f8cc3d001807684fe844a0f19177915cf3c38d14424ca11744ff8`，factory 体 `bytes = 108486`，`sha256 = 9a186a0fd412e5fffdaeca9026a24ad3adb0b37b5f1f96b9ae3099f482f2d1a4`。

**⚠️ 时间线（关键）**：GUI 缓存里含 T11 的 bundle mtime = **2026-09-22 02:10:24**；而工作区当前 `src/tree-model.ts` mtime = **10:07:41**、`src/sidebar.tsx` mtime = **09:53:14**、`lib/client.js` mtime = **10:09:57**。但缓存模块体与**当前磁盘** `lib/client.js` 的 factory 体**逐字节相同**（`sha256` 一致）⇒ **磁盘上的 T11 产物自 02:10 以来内容未变**（后续 mtime 变化来自重复构建，非内容变化）。

### 8.3 结论：**用户无需刷新页面即可加载含 T11 的 bundle**（但需注意 HMR 生效范围）

- 磁盘 `lib/client.js` 的 `artifactRevision` = **`3b45db08f3b1`**
- GUI 缓存中该模块的 rev = **`3b45db08f3b1`**（缓存项 `53318c434921e90a_0`、`7eac58811719ba32_0`）
- **两个 rev 逐字相同，且模块体与磁盘逐字节相同** ⇒ 当前 GUI 已经持有 T11 的代码。

⚠️ **限制（如实披露）**：我**无法**证明渲染进程**内存中已装载**的就是这份 bundle（缓存 ≠ 已执行）。`[审查真实代码]` 缓存里同时存在**旧 bundle**（含 `releaseTopZoneContainer` / `recentlyFinishedSessionIds`）的条目（最新一条 09-22 01:29:23），说明页面在 02:10 前后经历过重载。若用户页面在 02:10 之前打开且此后未刷新/未收到 HMR 推送，则内存里可能仍是旧 bundle。**建议主代理在验收前让用户刷新一次页面**（代价极低），或核对 devtools 中 `plugins/??…dsh-worktree-groups/client.js&rev=` 的实际值是否为 `3b45db08f3b1`。

---

## ⑨ 用户数据零写入证据

### 9.1 快照与哈希

leveldb 目录：`~/Library/Application Support/DSH Desktop/Partitions/dsh-desktop-renderer/Local Storage/leveldb`（**只读**）。

| 文件 | mtime | sha256（10:15:15 快照） |
|---|---|---|
| `000005.ldb` | 09-01 17:46:16 | `502672e4…22cba2` |
| `000856.ldb` | 09-21 22:12:23 | `f340932e…bea300` |
| `000858.ldb` | 09-22 08:51:24 | `855dfb8c…d609318` |
| `000860.ldb` | 09-22 09:24:20 | `e1470d98…98a7c1a26` |
| `000862.ldb` | 09-22 10:06:34 | `ce1bc3df…7a679c9a` |
| `000861.log`（WAL） | 10:15:06 → 10:21:34 | `1ce5563f…` → `ce007d04…` |
| `MANIFEST-000001` | 09-22 10:06:34 | `92830a94…d7454001` |

### 9.2 **归因实验（独立判断，不采信 T11 的说法）**

**实验 A（空闲对照）**：不跑任何测试/构建，静置 35 s ⇒ `000861.log` mtime/size/sha256 **完全不变**（`ce007d044c580e19` → `ce007d044c580e19`）。

**实验 B（受控触发）**：在仓库里执行 `npm run build`（10:24:14 完成），此后每 10 s 采样 ×6（共 60 s）⇒ **所有 leveldb 文件（含 `000861.log`）mtime/size 全部不变**（`10:21:34 / 28685`）。

**实验 C（负载期间变化）**：在 10:06–10:15 期间（我运行 `npm test` ×2 / `npm run build` ×3 / 大量 `node` 脚本），`000861.log` 由 `11696 → 28685` 字节、mtime 持续推进。

**判定**：
- 该 WAL 的写入**不是**由「仓库构建 / 测试」直接引起的（实验 B 证伪）；
- 它是**DSH Desktop 渲染进程自身**在活动（GUI 轮询 / 心跳 / 其他插件写入）产生的 —— 与 T11 报告的说法一致，我**独立验证**了这一点；
- 写入的内容键为**插件自己的三个键**（`dsh-worktree-groups.order` / `.collapsed` / `.expandedAll`），**未发现任何其他键被创建或删除**（`grep` 全 leveldb：仅这三个键命中）。

### 9.3 实现层不写用户数据的证据

`[审查真实代码]` 写入点仅三处：`writeManualOrder`（`src/sidebar.tsx:306`，键 `dsh-worktree-groups.order`）、`writeCollapsed`（`:234`）、`writeExpandedAll`（`:234`）。**全部键前缀 `dsh-worktree-groups.`，不触碰任何宿主键**。顶部区运行时状态是 `useState`（`:1629`），除 D2 落表 effect 外无任何写入（`:1913-1956`）。

### 9.4 真实载荷的**结构**佐证（只读，未输出任何会话 id）

| 检查项 | 实测 |
|---|---|
| 载荷顶层键 | `["manual","projects","sessions","worktrees"]` —— **无 `topZone` / `recentlyFinished` / `released` 痕迹** |
| 会话条目 | 56 → 58（4 个版本），**全部**带 `session-` 前缀（56/56、57/57、58/58、58/58），**裸 id = 0**，**重复条目 = 0** |
| D2 承诺 | 新增 2 条**均在容器下标 0**；既有 56 条**保留 56 / 丢失 0**；每个容器既有相对顺序**均为子序列**（10/10） |
| 项目层 | `projects` 14 条，集合不变（顺序变化 = 用户拖拽项目行，非插件改写） |
| 唯一键 | 全 leveldb 只命中插件的三个键 |

**⑨ 判定：用户 localStorage / 用户数据零写入（本插件）；`000861.log` 的 mtime 变化归因于 DSH Desktop 进程自身活动，非实现者写入。**

---

## ⑩ 文档一致性核对

`[审查真实代码]` 逐行核对 `README.md` / `docs/PRD.md` / `docs/INTERFACES.md`。

### 10.1 已按新语义改写（抽检的具体行）

| 文档:行 | 内容 | 判定 |
|---|---|---|
| `README.md:56-60` | 顶部区 = 只有「正在运行」的会话；「这一类固定在分组最前，并且『拖不动』」；「回弹到顶部是**预期行为**」 | ✅ 与实现一致 |
| `README.md:66-72` | 已结束的会话「位置完全由你的拖拽顺序决定，并且**可以正常拖动** —— 拖到哪就留在哪，不回弹」；列出删除的两条旧行为 | ✅ |
| `README.md:111-115` | 「T11 起不再有『当前会话置顶』」；D12 保底「从恒不可达变成可达」并说明「展开该分组即恢复渲染顺序 = 你的拖拽顺序」 | ✅（但未提「默认未折叠态也触发」，见 §⑪ N-2） |
| `README.md:148-177` | T11 终裁段：删除「刚结束保留」「当前会话置顶」「拖动释放」；新增运行中不可拖、判据同源 | ✅ |
| `README.md:156` | 「早先『拖动后运行中也沉下去、刷新恢复』的表述已**删除**」 | ✅ 该过时表述确已不在正文 |
| `README.md:213-219` | 变更记录 T11 行 + 回归红线逐条 | ✅ |
| `docs/PRD.md:297-308` | US8 顶部区：只有正在运行 + 新会话；「已结束的会话一律不再固定置顶」；「必须可以正常拖动（拖到哪就留在哪，不回弹）」 | ✅ |
| `docs/PRD.md:331-347` | 「例外：只有『正在运行的会话』与『尚未落表的新会话』」；「已删除的两条例外（T11 终裁，不要改回去）」 | ✅ |
| `docs/PRD.md:350-383` | 判据表（a 运行中 ❌不可拖 / b 新会话 ✅可拖）；删除类别逐条；不可拖动判据与置顶判据同源 | ✅ |
| `docs/PRD.md:454-460` | 「已知机制交互」：D12 保底从恒不可达变可达；举例「拖到容器第 8 位 + 折叠态」 | ✅（范围偏窄，见 §⑪ N-2） |
| `docs/PRD.md:567` | T11 缺陷/修复全表；测试数 **380** | ✅ |
| `docs/PRD.md:569-586` | 测试基线：HEAD 253 / 当前 380 / tree-model 247 / T11 前缀 46 / typecheck exit 0 / build 两次 sha256 一致 | ✅ **全部与我的实测逐字一致** |
| `docs/INTERFACES.md:504-514` | 「T11 终裁删除了两个字段（不要加回来）」 | ✅ |
| `docs/INTERFACES.md:551-552` | `runningOf` 只用于投影「现在谁在跑」；旧下降沿机制已删 | ✅ |
| `docs/INTERFACES.md:566-594` | `isTopZoneRunningSession` 为「判据的唯一来源」；已删的两类判据 | ✅ |
| `docs/INTERFACES.md:702-705` | `effectiveOrder` 刻意不应用运行时顶部区，且是「被测试锁定的不变式」 | ✅ |
| `docs/INTERFACES.md:764-786` | 顶部区判据；「T11 起**没有**『当前会话恒第一位』这一层」 | ✅ |
| `docs/INTERFACES.md:798-806` | D12 保底交互披露 | ✅（范围偏窄） |

### 10.2 过时表述扫描

| 关键词 | 结果 |
|---|---|
| 「固定顶部」 | **0 命中** ✅ |
| 「针对第一位拖拽视觉无效」 | **0 命中** ✅ |
| 「拖动后运行中也会沉下去」 | 仅 `README.md:156` —— **明确标注为已删除的旧表述**（非残留） ✅ |
| 「刚结束保留」 | 命中处**全部**为「~~已删除~~ / 已于 T11 删除 / 不要改回去」的显式否定或历史变更记录 ✅ |
| 「当前会话置顶」 | 同上，全部为显式否定 ✅ |
| 「拖不动」/「回弹」 | 命中处均正确区分：**运行中**拖不动/回弹是预期；**已结束**可拖不回弹 ✅ |

### 10.3 测试数字自洽性

| 文档声明 | 我的实测 | 判定 |
|---|---|---|
| HEAD 253 / 253 | 253 / 253 | ✅ |
| 当前 380 / 380（连跑 2 次） | 380 / 380 ×2 | ✅ |
| tree-model 247 / 247 | 247 / 247 | ✅ |
| T11 前缀 46 | 46 | ✅ |
| typecheck exit 0 | exit 0 | ✅ |
| build 两次 sha256 一致，`lib/tree-model.js 5dc188e2…` | `5dc188e2aac6…` 两次一致 | ✅ |

**⑩ 判定：三份文档已按新语义改写，无实质过时表述残留，测试数字与实测自洽。**

---

## ⑪ 新发现问题清单（分级 + file:line + 复现步骤）

> 均为**报告项**，我未修改任何实现代码。

### N-1（中）`sidebar.tsx` 的 T11 交互层改动**零回归保护**
- **位置**：`src/sidebar.tsx:2197-2201`（`dragHandlersFor` 第三参）；`src/sidebar.tsx:2060-2093`
- **现象**：`sidebar.tsx` 不进 `lib/`，`node --test` 无法执行它。我的变异 M7（删掉第三参 ⇒ 运行中又可拖）与 M8（把判据换成 `row.running !== true` ⇒ 分叉）**各 0 失败**（247/247 全绿）。
- **影响**：T11 的两条核心用户可见承诺（运行中不可拖 / 判据同源）**只靠人工审查**，任何后续改动都能无声退化。而本轮缺陷恰恰是「测试全绿、真人复验复现」。
- **复现**：`cp -R src test /tmp/mut && python3 patches/M7.py && npm run build && node --test test/tree-model.test.mjs` ⇒ `pass 247 fail 0`。
- **建议**（供主代理决定）：加一条**源码级契约测试**（读 `src/sidebar.tsx` 文本，断言 `dragHandlersFor(` 的会话行调用含第三个实参且为 `!isTopZoneRunningSession(...)`）——这是唯一能在 `node --test` 里覆盖 `.tsx` 接线的低成本手段。

### N-2（中）D12 保底的**触发面比文档披露的更宽**
- **位置**：`src/tree-model.ts:1564-1621`（`truncateSessions` 的 `promote`）、`src/tree-model.ts:1887`（`emitContainer` 传入 `context.currentSessionId`）
- **现象**：文档（`docs/PRD.md:454-460`、`README.md:113-115`、`docs/INTERFACES.md:802-806`）只描述「拖到容器第 8 位 + **折叠态**」；实测**默认未折叠态**（`collapsedKeys={}`、`expandedAllKeys={}`）下同样触发 —— 只要容器超过 5 条会话，当前会话就被保底进可见区第 5 位。
- **附加现象**：该保底使「当前会话」在默认态下拖到第 6 位之后出现**视觉零位移**（持久表已变、渲染未变）；**非当前**会话在同样操作下会正常消失（可见变化）。
- **复现**：`node /tmp/t12/harness2-d12.mjs`（`判定 F` / `判定 G`）。
- **建议**：文档补「默认态即触发」；是否属「另一种固定置顶」请按 §⑥ 的 (A)/(B) 提请用户裁决。

### N-3（低）`COLLAPSED_SESSION_LIMIT` 与 `truncateSessions` 的注释与事实相反
- **位置**：`src/tree-model.ts:45` 与 `src/tree-model.ts:1577`
- **现象**：两处均写「该保底分支在树路径**恒不触发**」/「本分支**恒不触发**」。但同文件 `:45` 的上文（`:43-44`）与 `docs/PRD.md:250`、`README.md:113`、`docs/INTERFACES.md:802` 都明确说该分支**已变成可达**，且测试 `test/tree-model.test.mjs:3909` 正是锁定它可达。
- **影响**：同一文件内自相矛盾，误导后续维护者（可能误删保底）。
- **复现**：`sed -n '42,47p;1574,1580p' src/tree-model.ts`。
- **建议**：改为「在树路径下，当前会话**未被置顶时**仍可能触发（T11 起可达）」。
- **注**：`lib/tree-model.js:44` / `:1078` 同步带此注释（构建产物），修 `src` 后重建即同步。

### N-4（低）T11 文档的变异表**不可独立复现**
- **位置**：`docs/PRD.md:588-600`
- **现象**：① 文档 M5 声明「`isTopZoneRunningSession` 恒 `false` ⇒ **fail 1**，命中 `T5/D3a: 传了 topZone（哪怕空对象）…`」。我按该语义实现（M9）后确实命中该用例，但总失败面是 **fail 35**（247 条中的 35 条）。② 文档 M4 声明「恢复拖动释放 ⇒ fail 1」，我按「只恢复释放读取」实现（M4b）得到 **fail 0**（等价变异），按「完整恢复」实现（M4）得到 **fail 6**。
- **影响**：数字无法独立复现 ⇒ 违反文档自身「本节只保留可直接复现的数字」的声明。
- **复现**：`/tmp/t12/patches/M9.py`、`M4.py`、`M4b.py` + `/tmp/t12/run2.sh`。
- **建议**：文档为每个变异附上**补丁要点**（改哪个函数、怎么改），或改为「至少捕获 N 条，代表用例为 …」。

### N-5（低）`test/tree-model.test.mjs:5375` 引用不存在的文件
- **位置**：`test/tree-model.test.mjs:5375`
- **现象**：注释称「由 `test/mutation-t11.md` 记录的 lib 级变异实验证明」，但 `test/` 下**没有** `mutation-t11.md`（实测 `ls test/` 仅 5 个 `.mjs`）。
- **影响**：证据链断裂，读者无法找到所述变异实验记录。
- **建议**：补该文件，或把引用改到 `docs/PRD.md:588-600`。

### N-6（信息）顶部区成员数 > 5 时，运行中会话可能被截断吃掉
- **位置**：`src/tree-model.ts:1881-1901`
- **现象**：若同一容器有 6+ 条**运行中**会话，`truncateSessions` 仍只保留前 5 条（`test/tree-model.test.mjs:3948-3959` 锁定该行为）。此时「运行中的会话一定可见」这条 JSDoc（`:2232-2234`）**不成立**。
- **影响**：低（实际很难出现 6 条并发运行会话），且已有测试明确锁定该取舍，属**有意行为**。仅提示 JSDoc 的绝对化措辞。

---

## ⑫ 未验证部分（如实）

1. **真人 GUI 端到端操作**：我**未**在 DSH Desktop 界面里用鼠标实际拖动行。所有结论来自 `buildRows` 真实导出 + `.tsx` 源码审查。理由：任务书限定只读、且我作为子代理不能操作用户 GUI。
2. **渲染进程内存中当前装载的 bundle 版本**：我只证明了**磁盘缓存**中的最新 bundle 与磁盘 `lib/client.js` 逐字节相同（§8.2），**未**证明浏览器内存里执行的就是它。缓存中同时存在旧 bundle 条目。
3. **combo URL 的 rev 复算**：`rev=28f2ef4f697a` 我**未能**复现（我按 `framedHash("combo", parts)` 与 `parts+";\n"` 两种拼接都得到不同值：`fcf42a444ac1` / `18ef7355fb77`）。原因是 `buildCombo` 的 `sourceBytes` 是宿主**自己重新拼装**的 `prepared.source`（含 `sourceMappingURL` 处理），与缓存里已拼接好的文本不逐字相同。**这不影响 §8.2 的结论**（那条用的是单模块 `artifactRevision`，已精确复现）。
4. **`npm test` 之外的测试文件**：我复核了 `git/ledger/projects/routes` 四个文件的 `test(` 计数（8/19/34/72）与全量 380 自洽，但**未**逐条阅读这四个文件的断言内容（T11 未改动它们；`git diff --stat` 显示只改了 `tree-model.test.mjs`）。
5. **D1「用户数据零写入」的强形式**：我证明了本插件只写自己的三个键、且受控构建实验证伪「构建/测试直接导致写入」。但**未**能排除「GUI 自身活动恰好由我的构建间接触发」这一路径（实验 B 的 60 s 窗口内未观测到写入，证据强度有限）。
6. **`docs/RESEARCH-*.md` / 既有五份 `REVIEW-*.md`**：任务书要求核对 `README.md` / `PRD.md` / `INTERFACES.md`，我**未**核对历史调研/审查报告中的过时表述（它们不在要求范围内，且属历史快照）。

---

## ⑬ 结论：是否建议验收

### 建议：**验收（附 1 项需用户裁决 + 5 项文档/测试改进项）**

**可以验收的核心理由**

1. **首要缺陷真修复**（最高优先）：用**真实导出**驱动 `buildRows`，对「已结束会话（含 running 下降沿的刚结束会话）」做了**全落点枚举**（10/10 有效落点 + 4×5×2 全矩阵 25 组），渲染顺序**逐字等于**「运行中置顶 + 持久表」，**0 例外**；40 轮轮询后仍稳定不回弹。**未使用任何复刻版**。
2. **运行中判据真同源**：`isTopZoneRunningSession` 是置顶与「不可拖动」的**唯一**实现（`tree-model.ts:564` 与 `sidebar.tsx:2200` 同调），运行中行仍**接受落点**，多运行中顺序确定。
3. **删除彻底**：7 个旧符号在 `lib/client.js` 中 **0 次**出现；`.tsx` 命中全部为注释；运行时把旧字段塞回去**零效果**。
4. **回归红线全绿**：D1–D6 + T9 两处 + N1 逐条实测通过；`effectiveOrder` 与 `topZone` 无关且有**对照组**证明非恒真；真实 `localStorage` 载荷佐证 D2（既有条目零丢失、相对顺序零破坏、新增条目均在容器下标 0）。
5. **测试与变异可信**：HEAD 基线 **253** 可复现、当前 **380/380** 连跑两次、typecheck exit 0、build 两次哈希一致；新增用例**确实断言渲染层顺序**（附三段断言片段）；我自建的 10 个变异中，含「恢复刚结束保留」（M1 ⇒ fail 1）与「渲染期无条件提升」（M2 ⇒ fail 6）两类必需变异，全部被捕获。
6. **GUI bundle 已含 T11**：磁盘 `lib/client.js` 的 `artifactRevision` = **`3b45db08f3b1`**，与缓存 URL 的 rev **逐字相同**，且模块体与磁盘**逐字节相同**。
7. **用户数据零写入**（本插件）：写入点仅插件自有三个键；受控实验证伪「构建/测试导致写入」；`000861.log` 的变化独立归因于 DSH Desktop 进程自身。

**验收前建议主代理处理**

- **（需用户裁决，中）§⑥ / N-2**：D12「当前会话保底进前 5」在**默认未折叠态**下即可让已结束的当前会话偏离持久顺序，并产生「往下拖但行不动」的视觉零位移。请按 (A) 保留 D12 / (B) 树路径不再传 `currentSessionId` 二选一。**这是唯一可能再次触发用户「拖不动」投诉的残余路径。**
- **（建议，中）N-1**：为 `sidebar.tsx` 的「运行中不可拖 + 判据同源」加**源码级契约测试**，否则该承诺零回归保护（M7/M8 各 0 失败已证明）。
- **（建议，低）N-3**：修 `src/tree-model.ts:45` / `:1577` 与事实相反的「恒不触发」注释。
- **（建议，低）N-4**：文档变异表补补丁要点，使数字可独立复现。
- **（建议，低）N-5**：补 `test/mutation-t11.md` 或改引用。
- **（提示）§8.3**：验收时请用户**刷新一次页面**，以确保内存装载的是 `rev=3b45db08f3b1` 的 bundle（缓存证据充分，但内存装载无法由我验证）。

**残留状态**：无阻塞项。本报告未修改任何实现代码 / 文档 / 用户数据；仅新增本文件 `docs/REVIEW-running-only-topzone.md`。

---

### 附：本次复审用到的可复现脚本（均在 `/tmp/t12/`，不在仓库内）

| 脚本 | 用途 |
|---|---|
| `harness1.mjs` | 41 项独立核验（首要缺陷全枚举、判据同源、删除彻底性、D1–D6/T9/N1、D3e 对照组） |
| `harness2-d12.mjs` | D12 保底交互（折叠/默认/展开三态 + 视觉零位移判定） |
| `harness3-asym.mjs` | 「置顶集合 vs 不可拖集合」不对称性 |
| `harness4-drag-hidden.mjs` | 截断态下拖到不可见区间的行为特征 |
| `cache-rev3.mjs` | 缓存 bundle 与磁盘 `lib/client.js` 逐字节比对 + `artifactRevision` 复算 |
| `ls-inspect.mjs` / `ls-d2-check.mjs` / `ls-proj-diff.mjs` | 只读解析真实 `localStorage` 载荷（结构事实，不输出 id） |
| `run2.sh` + `patches/M*.py` | 10 个定点变异（M1–M10，含等价变异 M4b） |

**所有命令退出码**：`npm test` ×2 → 0；`npm run typecheck` → 0；`npm run build` ×2 → 0；HEAD 副本 `npm test` → 0；`harness1.mjs` → 0（41/41 通过）；变异脚本按设计返回非 0/0（见 §7.3 表）。
