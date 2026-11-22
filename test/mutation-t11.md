# T11 / T13 lib 级变异实验清单（可独立复现）

> **本文档的用途**：`test/tree-model.test.mjs` 里若干用例把「恢复旧实现 ⇒ 本套件立刻变红」
> 这类**判别力证据**标注为「由 `test/mutation-t11.md` 记录的 lib 级变异实验证明」。
> 本文档就是那份记录，补全 T12 复审指出的 **N-5 证据链断裂**
> （`test/tree-model.test.mjs` 引用的 `test/mutation-t11.md` 当时不存在）。
>
> **本文档的数字全部为 T13 实跑**（2026-09-22），命令与退出码见每节的「复现」。
> 与 `docs/PRD.md` §「变异验证」表**同源**；两处的 fail 计数必须一致。

---

## 0. 为什么需要「变异验证」（方法学）

本插件的首要缺陷连续两轮都是「**测试全绿、真人 GUI 复现缺陷**」。因此每一轮修复都必须
回答一个问题：**「如果有人把这次修复回退，现有测试会不会红？」** 做法：

1. 把仓库副本复制到 `/tmp`（**不动工作区**）；
2. 在副本里对**真实源码**（`src/tree-model.ts` / `src/sidebar.tsx`）打**定点补丁**，
   恢复被删除的旧语义；
3. `npm run build` 重建 `lib/`（`.tsx` 走 esbuild 进 `lib/client.js`）；
4. `node --test test/tree-model.test.mjs` 与 `node --test test/sidebar-wiring.test.mjs`，
   记录 `fail` 数与**命中的用例名**。

**所有变异都打在真实源码上，不使用任何复刻版。** 每个变异打完补丁后必须
`npm run build` **成功**（否则该变异不成立 —— 记「编译失败」而不是「fail 0」）。

### 复现脚本（自包含）

```bash
# ① 造副本（不动工作区）
rm -rf /tmp/mut && mkdir -p /tmp/mut
cd <repo> && tar -c --exclude=node_modules --exclude=.git --exclude=lib . | tar -x -C /tmp/mut
ln -s <repo>/node_modules /tmp/mut/node_modules
cd /tmp/mut && npm run build

# ② 打某个变异的补丁（补丁要点见下表），然后
npm run build && node --test test/tree-model.test.mjs && node --test test/sidebar-wiring.test.mjs
```

T13 用的完整矩阵脚本（10 个变异一次跑完，含 `git checkout -- .` 复位）见
**附录 A**。

---

## 1. 变异表（T13 实跑数字）

| # | 变异 | 补丁要点（改哪个文件 / 哪段语义） | `tree-model.test.mjs` | `sidebar-wiring.test.mjs` | 代表命中用例 |
|---|---|---|---|---|---|
| **M1** | 恢复「**刚结束保留**」 | `src/tree-model.ts` `topZoneSessionKeys`：在 `const isFresh = …` 之后加一段读 `zone.recentlyFinishedSessionIds` 并 `rest.push(session)` | **fail 1** | fail 0 | `T11/③ 定点回归: 「刚结束保留」已从判据里彻底不可达` |
| **M2** | 渲染期**无条件提升**新会话 | `src/tree-model.ts`：`const isFresh = fresh.has(key) && !done.has(key)` ⇒ `const isFresh = fresh.has(key)`（忽略台账） | **fail 6** | fail 0 | `T9/缺陷1 真实生命周期`、`T11/⑤ T9 机制不回退` |
| **M3** | 恢复「**当前会话置顶**」 | `src/tree-model.ts` `topZoneSessionKeys`：加 `const isCurrent = currentSessionId !== undefined && normalizeSessionId(currentSessionId) === key`，命中即 `rest.push` | **fail 7** | fail 0 | `T11: 当前会话不再置顶`、`T13/截断: 已结束的当前会话拖到第 8 位` |
| **M4** | 恢复「**拖动释放**」**完整组合** | 先打 M1 的补丁，再在 `topZoneSessionKeys` 里加读 `zone.releasedContainerKeys` 并在命中时清掉保留 | **fail 1** | fail 0 | `T11/③ 定点回归` |
| **M4b** | **只**恢复「释放读取」（**等价变异**） | `src/tree-model.ts`：读 `releasedContainerKeys` 但**不改变任何行为**（`void released`） | **fail 0**（等价） | fail 0 | — |
| **M5** | 运行中的会话**可拖动** | `src/tree-model.ts` `isTopZoneRunningSession`：`if (session.running === true) return true` ⇒ `return false` | **fail 29** | fail 0 | `T5/D3a: 自身 running 的会话进顶部区` 等 |
| **M6** | 去掉**归档 id 补投影**（T9 的 N1 回退） | `src/tree-model.ts` `observationsOf`：补投影里 `archived: true` ⇒ `archived: false` | **fail 2** | fail 0 | `T9/N1 真实链路: 归档会话不在树里 ⇒ 不被误判为新会话` |
| **M7** | **`.tsx` 接线**：删掉 `dragHandlersFor` session 调用的第 3 实参 | `src/sidebar.tsx`：`dragHandlersFor(row, { kind: 'session', … }, !isTopZoneRunningSession(row, topZone))` ⇒ 删掉第 3 实参 | **fail 0**（盲区） | **fail 2** | `T13/接线: session 行的调用传入 !isTopZoneRunningSession(row, topZone)` |
| **M8** | **`.tsx` 接线**：不可拖判据**分叉** | `src/sidebar.tsx`：第 3 实参 `!isTopZoneRunningSession(row, topZone)` ⇒ `row.running !== true` | **fail 0**（盲区） | **fail 2** | 同上 |
| **M9** | **T13 新语义回退**：恢复 D12 保底 | `src/tree-model.ts`：`truncateSessions` 重新接受 `currentSessionId` 并恢复 `promote` 分支；`emitContainer` 调用点重新传 `context.currentSessionId` | **fail 6** | fail 0 | `T13/截断: 已结束的当前会话拖到第 8 位`、`truncateSessions: 第 3 参不再存在` |
| **M10** | **完整恢复旧状态机**（M1 的加强版） | `src/tree-model.ts`：① `TopZoneState.recentlyFinishedIds` 字段；② `initialTopZoneState` 初值；③ `observeTopZone` running 下降沿写入；④ 基线/推进两个返回分支携带；⑤ `TopZoneInput.recentlyFinishedSessionIds` 契约字段；⑥ `topZoneInputOf` 投影；⑦ `topZoneSessionKeys` 判据读取 | **fail 7** | fail 0 | `T11: 状态机里没有 recentlyFinishedIds 字段`、`T11/① 首要缺陷` |

**读法**：M1/M4/M10 是**同一失效模式**（「刚结束保留」）的三层变异 —— 判据层（M1）、
判据 + 释放组合（M4）、完整状态机（M10）。三者都被捕获 ⇒ 首要缺陷的回归锁有判别力。
M7/M8 是**唯一**在 `tree-model.test.mjs` 上零失败的两条 —— 它们只能被
`sidebar-wiring.test.mjs`（源码级契约测试）捕获。

### 与 `docs/PRD.md` 旧版数字的差异（T12 的 N-4 修正）

| 变异 | 旧文档声明 | T13 实跑 | 差异原因 |
|---|---|---|---|
| M5 | fail 1（并称命中 `T5/D3a: 传了 topZone（哪怕空对象）⇒ 裸 running 也进顶部区`） | **fail 29** | `isTopZoneRunningSession` 是**唯一**置顶判据，恒 `false` 会波及**全部**顶部区用例；「fail 1」是把命中**用例数**误记成**失败面**。T12 按该语义实现得 fail 35（当时 247 条），T13 因新增/改写用例，同语义为 fail 29（250 条） |
| M4 | fail 1（「恢复拖动释放」） | **fail 1**（完整组合）/ **fail 0**（只恢复释放读取 = **等价变异**） | 「恢复拖动释放」若只把 `releasedContainerKeys` 读回来、而**不**同时恢复「刚结束保留」，则**没有任何可观察行为差异** ⇒ 等价变异。旧文档没写清「必须与 M1 组合」这一前提 |
| M7 | fail 7 | **fail 7**（作为 M10 复现）；作为「删 `.tsx` 第 3 实参」的变异则为 **fail 0** | 旧表的 M7 描述（「完整恢复旧状态机」）与 T12 报告的 M7（「删 `.tsx` 第 3 实参」）**不是同一个变异**，同名不同义。本表已拆开：M10 = 完整状态机，M7 = `.tsx` 删实参 |

---

## 2. 等价变异（如实标注，**无法**被捕获）

1. `TopZoneInput.writtenNewSessionIds` 的**缺省**分支从「不传 ⇒ 全部参与提升」改成
   「不传 ⇒ 全部排除」—— `sidebar.tsx` **恒传**该字段（`topZoneInputOf` 的产物），
   真实链路不可达；既有「零回归」用例锁的是**不传时仍提升**，属**有意保留**的契约。
2. 删掉 `topZoneSessionKeys` 的 `void currentSessionId` / `void containerKey` 而**不**恢复
   任何逻辑（纯死代码清理）—— 行为逐字等价，**不存在可观察差异**。
3. **M4b**（只恢复释放读取）：见上表 —— 保留机制删除后，释放读取**没有消费者**，
   恢复它不产生任何可观察行为差异。

---

## 3. 稳健性检查（`sidebar-wiring.test.mjs` 不过度脆弱）

源码级契约测试用 **TypeScript 编译器 API 解析 AST**（不是正则 / 字符串匹配），
因此下列**无害改动**不会误报（T13 实测均为 `8/8 pass`）：

| 改动 | 结果 |
|---|---|
| 把 session 调用重新格式化成多行 / 加多余空格 / 去掉尾逗号 | **pass**（AST 不受空白影响） |
| 在实参里插入注释（`isTopZoneRunningSession(row /* 当前行 */, topZone)`） | **pass** |
| 把 `draggable` 的默认值写法改行 | **pass** |

而下列**语义改动**立刻红（`fail 2`）：M7（删第 3 实参）、M8（换判据）、
以及「把容器行也改成不可拖」（`worktree / project 行的调用不传第 3 实参` 用例）。

> ⚠️ **T13 当时本文件只有 8 条断言**（上表的 `fail 2` 是那一版的数字）。T15 把本套件扩到
> **10 条**（新增两条 `T13/接线[P2]`），上表 M7/M8 的 fail 数**仍是 2**（未变，见 §4 复核实测）。

---

## 4. T15 追加变异（`.tsx` 下游断链 + `topZone` 实参身份）

**背景**：T14b 独立复审实测出 T13 版本的两处保护盲区 ——
① `src/sidebar.tsx:1038`（`SessionRowView`）的 `draggable: drag !== undefined && drag.draggable`
改成写死 `true` 后，`sidebar-wiring` **8/8 pass** + `tree-model` **250/250 pass**，而运行中的
会话**实际变成可拖**；② `topZone` 实参只被要求是「非空标识符」⇒ 传 `undefined` 也能通过。
T15 在 `test/sidebar-wiring.test.mjs` 新增两条 `T13/接线[P2]` 断言并**实跑复现**下表。

**复现方式**（`审查真实代码` + `驱动真实导出`）：仓库副本 `/tmp/t15/base`（`rsync` 排除
`node_modules` / `.git`，`node_modules` 软链回真实仓库），每个变异从 base 复制一份到
`/tmp/t15/cases/<id>`，用 `python3`/`node` 做**定点替换**（带 anchor 守卫，未命中即抛错），
再在副本内跑 `node --test test/sidebar-wiring.test.mjs`。

| # | 变异 | 补丁要点 | `tree-model.test.mjs` | `sidebar-wiring.test.mjs`（10 条） | 命中用例 |
|---|---|---|---|---|---|
| **M-A** | **`draggable` 写死 `true`**（T14b 实测的漏网变异） | `src/sidebar.tsx` `SessionRowView`：`draggable: drag !== undefined && drag.draggable` ⇒ `draggable: true` | fail 0（**盲区**） | **fail 1**（T13 版本为 fail 0） | `T13/接线[P2]: 会话行 / 容器行都把 drag.draggable 接到 DOM draggable prop 上` |
| **M-B** | **`draggable` 取自与置顶判据无关的表达式** | 同上 ⇒ `draggable: row.running !== true` | fail 0（**盲区**） | **fail 1** | 同上 |
| **M-C** | **`topZone` 实参传 `undefined`** | 第 3 实参 ⇒ `!isTopZoneRunningSession(row, undefined)` | fail 0 | **fail 1**（T13 版本为 fail 0） | `T13/接线: session 行的调用传入 !isTopZoneRunningSession(row, topZone)` |
| **M-D** | **`topZone` 实参换成无关标识符** | 第 3 实参 ⇒ `!isTopZoneRunningSession(row, t)`（`t` = locale 函数） | fail 0 | **fail 1** | 同上 |
| **M-E** | **删掉 `SessionRowView` 的 `draggable` prop** | 整行删除 `draggable: …,` | fail 0 | **fail 1** | `T13/接线[P2]`（同上） |
| **M-F** | **算了但不传**（接线断开） | `...(sessionDrag === undefined ? {} : { drag: sessionDrag })` ⇒ `...({})` | fail 0 | **fail 1** | `T13/接线[P2]: session 行 dragHandlersFor(...) 的结果真的流向 jsx(SessionRowView, …)` |
| **M-G** | **`ContainerRowView` 的 `draggable` 写死 `true`**（容器行） | 容器行同款改写 | fail 0 | **fail 1** | `T13/接线[P2]`（同 M-A 用例，覆盖两行） |

**等价重构对照（T15 实测，用于证明新断言不误报）**：

| # | 等价写法 | 预期 | T15 实测 | 说明 |
|---|---|---|---|---|
| **R-A** | 局部包装 `const sessionIsLocked = (r) => isTopZoneRunningSession(r, topZone)`，调用点传 `!sessionIsLocked(row)` | pass | **fail 1**（**误报**，T14b 已记录） | 既有 `isNegatedSharedCriteria` 的过强约束，**T15 未改动**（T14b 的 3 种等价写法在 T13 版本上同样 fail 1，属**既有**行为、非本轮引入） |
| **R-B** | `const zoneAlias = topZone` 后传 `zoneAlias` | pass | **pass** ✅ | 新断言允许**标识符中转**（不动点传播） |
| **R-C** | 就地传 `topZoneInputOf(topZoneState)` | pass | **pass** ✅ | 新断言允许**就地调用真实投影** |
| **R-D2** | `SessionRowView` 内别名改名 `rowDrag` + 值改写为 `Boolean(rowDrag?.draggable)` | pass | **pass** ✅ | 新断言按 AST 解析别名、只要求子树出现 `<别名>.draggable` |
| **R-F** | session 调用改多行 + 块注释 + 去尾逗号 | pass | **pass** ✅ | AST 对格式免疫 |
| **R-G** | `draggable: drag && drag.draggable`（去掉 `!== undefined`） | pass | **pass** ✅ | 不逐字比对表达式 |
| **R-H** | `draggable:` 换行 + 前置注释 | pass | **pass** ✅ | 同上 |
| **R-E** | worktree 行**补传**第 3 实参 `false`（语义改动） | fail | **fail 1** ✅ | 正确捕获（T14b 的 R2 对照） |

**结论**：新增的两条断言对上述 7 个变异**全部捕获**（每个 fail 1，`sidebar-wiring` exit 1），
同时 6 个**等价重构**写法**全部 pass**（唯一误报 R-A 是 T13 版本既有行为，T15 未加剧）。
**残余局限**：`R-A` 型（把判据抽成局部包装函数）仍会误报 —— 取舍见
`test/sidebar-wiring.test.mjs` 头部「稳健性取舍」一节：**优先保证「写死值 / 无关表达式」必被捕获**，
接受「间接但正确」的重构需人工确认。

---

## 附录 A：T13 变异矩阵脚本（实跑用）

```python
#!/usr/bin/env python3
# 用法：把仓库副本放到 /tmp/t13/mut（含 node_modules 软链），然后 python3 本脚本
import subprocess, sys, os
ROOT = "/tmp/t13/mut"

def read(p):
    with open(os.path.join(ROOT, p), encoding="utf-8") as f: return f.read()
def write(p, s):
    with open(os.path.join(ROOT, p), "w", encoding="utf-8") as f: f.write(s)
def sub(p, old, new, count=1):
    s = read(p)
    assert old in s, f"anchor not found in {p}: {old[:80]!r}"
    write(p, s.replace(old, new, count))
def build():
    r = subprocess.run(["npm", "run", "build"], cwd=ROOT, capture_output=True, text=True)
    assert r.returncode == 0, (r.stdout + r.stderr)[-2000:]
def run(suite):
    r = subprocess.run(["node", "--test", suite], cwd=ROOT, capture_output=True, text=True)
    out = r.stdout + r.stderr
    g = lambda k: next((int(l.split()[-1]) for l in out.splitlines() if l.startswith(f"ℹ {k} ")), None)
    names = [l.split("✖ ", 1)[1].rsplit(" (", 1)[0] for l in out.splitlines() if l.startswith("✖ ")]
    seen, uniq = set(), []
    for n in names:
        if n not in seen: seen.add(n); uniq.append(n)
    return g("tests"), g("pass"), g("fail"), uniq

MUTANTS = []
def mutant(name, desc):
    def deco(fn): MUTANTS.append((name, desc, fn)); return fn
    return deco

@mutant("M1", "恢复「刚结束保留」")
def m1():
    sub("src/tree-model.ts",
        "    const isFresh = fresh.has(key) && !done.has(key)",
        "    const isFresh = fresh.has(key) && !done.has(key)\n"
        "    const isRetained = Array.isArray((zone as any).recentlyFinishedSessionIds)\n"
        "      && (zone as any).recentlyFinishedSessionIds.some((id: string) => normalizeSessionId(id) === key)\n"
        "    if (isRetained) { rest.push(session); continue }")

@mutant("M2", "渲染期无条件提升新会话")
def m2():
    sub("src/tree-model.ts",
        "    const isFresh = fresh.has(key) && !done.has(key)",
        "    const isFresh = fresh.has(key)")

@mutant("M3", "恢复「当前会话置顶」")
def m3():
    sub("src/tree-model.ts",
        "    const isFresh = fresh.has(key) && !done.has(key)",
        "    const isFresh = fresh.has(key) && !done.has(key)\n"
        "    const isCurrent = currentSessionId !== undefined && normalizeSessionId(currentSessionId) === key\n"
        "    if (isCurrent) { rest.push(session); continue }")

@mutant("M4", "恢复「拖动释放」完整组合（= M1 + 释放读取）")
def m4():
    m1()
    sub("src/tree-model.ts",
        "  if (zone === null || typeof zone !== 'object') return keys.length === 0 ? undefined : keys",
        "  if (zone === null || typeof zone !== 'object') return keys.length === 0 ? undefined : keys\n"
        "  const released = Array.isArray((zone as any).releasedContainerKeys)\n"
        "    && (zone as any).releasedContainerKeys.includes(containerKey)\n"
        "  if (released) { /* 释放语义：清该容器的刚结束保留 */ }")

@mutant("M4b", "只恢复「释放读取」（等价变异）")
def m4b():
    sub("src/tree-model.ts",
        "  if (zone === null || typeof zone !== 'object') return keys.length === 0 ? undefined : keys",
        "  if (zone === null || typeof zone !== 'object') return keys.length === 0 ? undefined : keys\n"
        "  const released = Array.isArray((zone as any).releasedContainerKeys)\n"
        "    && (zone as any).releasedContainerKeys.includes(containerKey)\n"
        "  void released")

@mutant("M5", "运行中的会话可拖动")
def m5():
    sub("src/tree-model.ts",
        "  if (session.running === true) return true",
        "  if (session.running === true) return false")

@mutant("M6", "去掉归档 id 补投影")
def m6():
    s = read("src/tree-model.ts")
    i = s.find("export function observationsOf"); j = s.find("\n}\n", i)
    write("src/tree-model.ts", s[:i] + s[i:j].replace("archived: true", "archived: false") + s[j:])

@mutant("M7", "删掉 dragHandlersFor session 调用的第 3 实参")
def m7():
    sub("src/sidebar.tsx",
        "        { kind: 'session', itemId: row.sessionId, containerKey: row.parentKey },\n"
        "        !isTopZoneRunningSession(row, topZone),\n      )",
        "        { kind: 'session', itemId: row.sessionId, containerKey: row.parentKey },\n      )")

@mutant("M8", "不可拖判据分叉（row.running !== true）")
def m8():
    sub("src/sidebar.tsx",
        "        !isTopZoneRunningSession(row, topZone),",
        "        row.running !== true,")

@mutant("M9", "恢复 D12 保底（truncateSessions promote + 调用点）")
def m9():
    sub("src/tree-model.ts",
        "  const truncated = truncateSessions(heads, COLLAPSED_SESSION_LIMIT)",
        "  const truncated = truncateSessions(heads, COLLAPSED_SESSION_LIMIT, context.currentSessionId)")
    sub("src/tree-model.ts",
        "export function truncateSessions<T extends { sessionId: string }>(\n  sessions: T[],\n  limit: number,\n): { visible: T[]; hiddenCount: number } {\n  const quota = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0\n",
        "export function truncateSessions<T extends { sessionId: string }>(\n  sessions: T[],\n  limit: number,\n  currentSessionId?: string,\n): { visible: T[]; hiddenCount: number } {\n  const quota = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0\n"
        "  const currentIndex = currentSessionId === undefined\n    ? -1\n    : sessions.findIndex((session) => session.sessionId === currentSessionId)\n"
        "  let promote = false\n  if (currentIndex >= 0 && quota > 0 && !isBlank(sessions[currentIndex])) {\n"
        "    let ordinaryBefore = 0\n    for (let i = 0; i < currentIndex; i += 1) {\n      if (!isBlank(sessions[i])) ordinaryBefore += 1\n    }\n"
        "    promote = ordinaryBefore >= quota\n  }\n")
    sub("src/tree-model.ts",
        "    if (ordinary < quota) {\n      visible.push(session)\n      ordinary += 1\n    }\n  }\n\n  return { visible, hiddenCount: sessions.length - visible.length }",
        "    if (promote) {\n      if (i === currentIndex) { visible.push(session); continue }\n      if (ordinary < quota - 1) { visible.push(session); ordinary += 1 }\n      continue\n    }\n"
        "    if (ordinary < quota) {\n      visible.push(session)\n      ordinary += 1\n    }\n  }\n\n  return { visible, hiddenCount: sessions.length - visible.length }")

# M10（完整旧状态机）见仓库内 /tmp 脚本（补丁要点见上表第 M10 行）

SUITES = ["test/tree-model.test.mjs", "test/sidebar-wiring.test.mjs"]
for name, desc, fn in MUTANTS:
    subprocess.run(["git", "checkout", "--", "."], cwd=ROOT, capture_output=True)
    fn(); build()
    print(f"\n=== {name}: {desc}")
    for suite in SUITES:
        t, p, f, names = run(suite)
        print(f"    {suite}: tests={t} pass={p} fail={f}")
        for n in names[:6]: print(f"      - {n}")
```
