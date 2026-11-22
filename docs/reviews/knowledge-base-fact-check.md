# 知识库事实性审查报告（T-REV-01）

- **审查日期**：2026-09-22
- **审查对象**：`docs/knowledge/` 全部 20 篇 md（6455 行）
- **事实来源**：`src/` 全部源文件、`test/`、`docs/INTERFACES.md`、`docs/PRD.md`、`docs/HOST-CONTRACTS.md`、`package.json`、`cordis.patch.yml`
- **审查角色**：独立审查（只读被审查文件；唯一写入本报告）
- **锚点**：`git-version = 9bd94252dd934c2fa8491977285e461b703f0f3e`（`git log -1 --format=%H -- src/`）
- **结论**：发现问题 **7** 项 —— 严重 0、中等 3、轻微 4。**未发现任何虚构 API／符号／文件**。

---

## 1. 审查范围与方法

### 1.1 实际执行的命令类别

| 类别 | 具体命令 |
|---|---|
| 仓库锚点 | `git log -1 --format=%H -- src/`、`git rev-parse HEAD`、`git status --porcelain`、`git ls-files lib/`、`git check-ignore -v` |
| 清点 | `find`、`ls`、`wc -l`、`md5` |
| 引用抽取 | `grep -rhoE 'src/<file>\.(ts\|tsx):[0-9]+'`、`grep -oE '`:[0-9]+'` |
| 行号回读 | `sed -n '<N>p'`、`sed -n '<N>,<M>p'`、`awk 'NR>=x&&NR<=y'` |
| 导出清单 | `grep -oE '^export (async )?(const\|function\|class\|interface\|type\|enum) [A-Za-z0-9_]+'` |
| 签名比对 | Python3 正则归一化（去注释／折叠空白）后与文档签名逐字比对 |
| 反证 | `grep -c`、`grep -rn`、`comm`、`sort \| uniq -c`、`sort \| uniq -d` |
| 跨文件一致性 | 命名空间前缀计数、行数求和、路由数、`python3 -c` 算术复核 |

### 1.2 未执行的操作（明确标注）

- **未执行** `npm run build` / `npm test` / `npm run typecheck`（任务禁止）。
  ⇒ 因此 `lib/` 下的编译产物**未重新生成**，对 `lib/*.d.ts` 的引用只能核对其**当前磁盘内容**，不能证明其与 `src/` 在锚点处一致。相关结论见 §5 L-3。
- **未执行** 任何写操作于 `docs/knowledge/`、`src/`、`lib/`、`test/`、`docs/` 其他文件（见 §4 佐证）。
- **未联网**，故对宿主包（`@deepseek-ai/dsh-client-ui-*`）内部实现的引用无法独立核验（见 §5「未能验证的项」）。

### 1.3 样本量总览

| 检查项 | 样本量 |
|---|---|
| `src/<file>:<line>` 引用总数 | **1333** 处 |
| 去重后的 `(文件, 行号)` 对，**全部**做范围有效性校验 | **737** 对 |
| 抽样回读并逐条判断与文档描述是否相符 | **66** 处，覆盖 **10** 个源文件 |
| TreeModel L3 文档裸 `:N` 引用（`:N` = `src/tree-model.ts` 第 N 行）逐一回读 | **71** 个符号行号 + 区间引用 |
| 导出清单双向核对 | **10** 个代码文件、**95** 个导出符号 |
| 函数签名逐字核对 | 源码 65 处导出函数／常量声明（62 个唯一名，`name`/`inject`/`apply` 在两个入口文件各一份），比对文档中 **40** 条显式签名 |
| 绝对断言反证 | **8** 条（C1–C8） |
| frontmatter 锚点核对 | **20** 篇（全量） |

---

## 2. 结论摘要表

| # | 检查项 | 方法 | 样本量 | 通过/失败 | 证据位置 |
|---|---|---|---|---|---|
| 1 | 行号引用是否指向相关内容 | `sed -n '<N>p'` 回读 + 与文档描述比对 | 66 处抽样（10 文件） | **通过**（0 处指向无关内容） | §3 无严重项；抽样明细见下 |
| 2 | 行号引用是否越界 | 全部 737 对 `(文件,行号)` 与 `wc -l` 比对 | 737 对 | **失败 3 处**（M-3，均为 `test/` 被误标为 `src/`） | `docs/knowledge/l3-components/Projects技术文档.md:148,255,276` |
| 3 | 导出清单：文档是否遗漏源码导出 | 真实导出清单 → 在对应文档中检索 | 95 个导出 | **通过**（0 遗漏） | 逐文件检索 10 个 L3/L2 文档 |
| 4 | 导出清单：文档是否虚构源码不存在的导出 | `comm -23` 文档导出名 vs 源码导出名 | 95 个导出 | **通过**（0 虚构） | `comm` 输出为空 |
| 5 | 函数签名逐字一致 | 归一化后比对标识符/类型/可选性 | 40 条文档签名 | **通过**（37 逐字一致，3 条为散文正则伪命中，0 真实不一致） | §3 无签名类中等项 |
| 6 | 绝对断言能否被反证 | `grep` 反证 8 条 | 8 条 | **失败 1 条**（C8 → M-2） | `docs/knowledge/l2-modules/ServerHost模块技术文档.md:47,240` |
| 7 | 跨文档事实一致性（行数/导出数/路由数） | 逐项计数复核 | 全部数值型断言 | **失败 1 处**（M-1，Locales 文档内部自相矛盾） | `docs/knowledge/l3-components/Locales技术文档.md:87` |
| 8 | frontmatter `git-version` 是否全等于锚点 | `grep -m1 git-version` × 20 | 20 篇 | **通过**（20/20 一致） | §2.1 |
| 9 | `git-module-path` 是否全为 `src` | `grep -rh \| uniq -c` | 20 篇 | **通过**（20/20 = `src`） | §2.1 |
| 10 | 被引用文件是否存在 | 全部本地路径 `test -e` | 22 个去重路径 | **通过**（唯一"缺失"的 `src/panel-git.ts` 是被文档明确断言为不存在，非问题） | `Routes-路径校验与安全边界技术文档.md:73` |
| 11 | 已知偏差 a/b/c 独立核实 | 见 §4 | 3 条 | **3 条全部成立** | §4 |

### 2.1 frontmatter 与锚点（独立复核）

```console
$ git log -1 --format=%H -- src/
9bd94252dd934c2fa8491977285e461b703f0f3e
$ git rev-parse HEAD
8a3d0dfb93d9f582fcde46a718490b00fd46b16c
$ for f in $(find docs/knowledge -name '*.md' | sort); do grep -m1 'git-version' "$f"; done | sort | uniq -c
  20 git-version: 9bd94252dd934c2fa8491977285e461b703f0f3e
$ grep -rh 'git-module-path' docs/knowledge/ | tr -d ' \r' | sort | uniq -c
  20 git-module-path:src
```

**结论**：父代理基线成立。20/20 篇的 `git-version` 均等于 `src/` 的最后一个提交；仓库 HEAD 确实领先（`8a3d0df`，仅 `test/` 有新增），`src/` 未变，锚点有效。

### 2.2 行号引用准确率

- **范围有效性**：737 个去重 `(文件,行号)` 对中，**734 有效、3 越界**，越界率 0.41%。
- **内容相符性**：66 处抽样回读，**66/66 与文档描述相符**，抽样准确率 100%。
- **TreeModel 裸引用**：71 个符号行号声明**全部命中正确声明**（`awk`/`sed` 回读），0 错位。

---

## 3. 问题清单

### 严重（虚构 API／符号／文件；行号指向无关内容）

**无。**

已执行的反证（均**未能**证伪，即确认不存在虚构）：

1. 全库导出名反向比对：`comm -23 <(文档声明的导出名) <(源码真实导出名)` ⇒ **空**，无虚构导出。
2. 全库反引号标识符扫描：574 个文档标识符中，未出现在 `src/` 的全部命中均属合理范畴（DOM 事件 `dragover`、状态名 `DRAGGING`/`HOVER_ACCEPTED`、Node API `worker_threads`/`EACCES`、`package.json` 字段 `peerDependencies`/`noUnusedLocals`、宿主 API `installLocale`/`provideRoot` 等），**无一是被冒充为本包 API 的虚构符号**。
3. 被引用文件存在性：全部 **22 个**去重本地路径 `test -e`，唯一不存在者 `src/panel-git.ts` 出现在 `Routes-路径校验与安全边界技术文档.md:73`，原文为"`src/panel-git.ts` 里移植过来的 `isSafeRef` **不在本包内**（`src/` 下只有 `git.ts`）" —— 属**正确的否定性断言**，非虚构。
4. 引用行内容相关性：66 处抽样**无一**指向无关内容。

---

### 中等（签名不一致、事实错误、跨文档矛盾）

#### M-1 Locales 文档命名空间计数错误，且与自身声明的总数矛盾

- **位置**：`docs/knowledge/l3-components/Locales技术文档.md:87`
- **原文**：
  > 不可变语义的普通对象，50 个 key。key 命名空间分组：`section.*`(2)、`search.*`(2)、`session*`(3)、`history.*`(1)、`worktree.*`(18)、`project.*`(1)、`menu.*`(10)、`dialog.*`(5)、`error.*`(3)、`state.*`(2)、`a11y.*`(1)。
- **问题**：11 组计数中 **3 组错误**，且 11 组之和为 **48**，与同一句话中声明的 **50** 自相矛盾。
- **源码证据**：
  ```console
  $ grep -oE "^\s+'[a-zA-Z0-9_.]+':" src/locales.ts | tr -d " ':" | sort > /tmp/src_keys.txt
  $ wc -l < /tmp/src_keys.txt
  50
  $ printf "session*   %s (文档称 3)\n" "$(grep -c '^session' /tmp/src_keys.txt)"
  session*   4 (文档称 3)
  $ printf "worktree.* %s (文档称 18)\n" "$(grep -c '^worktree\.' /tmp/src_keys.txt)"
  worktree.* 20 (文档称 18)
  $ printf "menu.*     %s (文档称 10)\n" "$(grep -c '^menu\.' /tmp/src_keys.txt)"
  menu.*     9 (文档称 10)
  ```
  `session*` 的 4 条为 `session.new`、`session.blank`、`sessions.expand`、`sessions.collapse`（文档把 `sessions.*` 的两条漏计一条）。
- **重要澄清**：同文件 `:91-143` 的**完整 50 条 key 清单是正确的**（逐条校验：50 条 key 全在、50 个行号注解全部命中，见下方命令）。故本项是**单行聚合计数**的错误，非清单错误。
  ```console
  # 解析 :94-143 的清单，逐条回读 src/locales.ts 对应行号
  解析条目: 50   行号错配: 0
  源码 key: 50   清单 key: 50   缺失: 无   多余: 无
  ```
- **建议修法**：将 `:87` 改为
  `session*`(4)、`worktree.*`(20)、`menu.*`(9)，其余不变；修正后 11 组之和 = 50，与总数一致。
  （建议同时由脚本生成该计数，避免手工维护漂移。）

#### M-2 ServerHost 文档"全包唯一静态 import"断言为假

- **位置**：`docs/knowledge/l2-modules/ServerHost模块技术文档.md:47`（同义表述重复于 `:240`）
- **原文**（`:46-48`）：
  > `@deepseek-ai/cordis` 仅为 `peerDependencies`，且全包唯一静态 import 是 `src/index.ts` 中的 type-only 引入
- **问题**：该断言**不成立**。无论理解为"全包唯一的 `@deepseek-ai/*` 静态 import"还是"唯一的 `cordis` 静态 import"，都至少漏掉 `src/routes.ts:29`——而 `routes.ts` 正是本文档所辖模块（`:15` 明列 ServerHost = index/routes/projects/git/ledger/types 六文件）。
- **源码证据**：
  ```console
  $ grep -rnE "^\s*import .*from '@deepseek-ai/" src/
  src/routes.ts:29:import type { Context } from '@deepseek-ai/cordis'
  src/sidebar.tsx:26:import * as Primitives from '@deepseek-ai/dsh-client-ui-primitives'
  src/index.ts:20:import type { Context } from '@deepseek-ai/cordis'
  src/client.tsx:54:import type { Context } from '@deepseek-ai/cordis'
  ```
  `cordis` 的 type-only 静态 import 实为 **3 处**（`index.ts:20`、`routes.ts:29`、`client.tsx:54`），非 1 处；`@deepseek-ai/*` 的静态 import 共 **4 处**，其中 `sidebar.tsx:26` 是**值导入**（非 type-only）。
- **佐证（源码自身表述更准确）**：`src/index.ts:6-7` 的自述为"本文件**只** import type ... —— 这是全包唯一允许的 `@deepseek-ai/*` 静态 import"，即限定为**本文件**；文档把它放大成"全包唯一"属**转述时扩大了作用域**。对比 `docs/knowledge/l3-components/Index技术文档.md:33` 写的是"全文件唯一的 `@deepseek-ai/*` 静态 import"（**正确**）。
- **建议修法**：`:47` 与 `:240` 均改为
  「`@deepseek-ai/cordis` 仅为 `peerDependencies`；本包对 `@deepseek-ai/*` 的静态 import 共 4 处，其中 3 处为 type-only 的 `Context`（`src/index.ts:20`、`src/routes.ts:29`、`src/client.tsx:54`，编译后消失），1 处为值导入 `@deepseek-ai/dsh-client-ui-primitives`（`src/sidebar.tsx:26`，宿主 external）」。

#### M-3 Projects 文档 3 处 `test/` 行号被误标为 `src/projects.ts`

- **位置**：`docs/knowledge/l3-components/Projects技术文档.md:148`、`:255`、`:276`
- **原文**：
  - `:148` 「…（`src/projects.ts:283`、`src/projects.ts:749-798` 对应单测）。」
  - `:255` 「…（`src/projects.ts:322` 用 `slice()` 复制后排序；`src/projects.ts:765-798` 有对应单测）。」
  - `:276` 「…不抛错 | `src/projects.ts:310`、`src/projects.ts:799`」
- **问题**：`src/projects.ts` **仅 486 行**，故 `:749-798`、`:765-798`、`:799` 三处**越界**。上下文均已写明"对应单测"，实际指向 `test/projects.test.mjs` 的同号行——属**前缀误标**（`test/` 写成 `src/`），非内容虚构。
- **源码证据**：
  ```console
  $ wc -l < src/projects.ts
  486
  $ grep -oE 'src/projects\.ts:[0-9]+' docs/knowledge/l3-components/Projects技术文档.md \
      | sed 's/.*://' | sort -n | uniq | awk '$1>486'
  749
  765
  799
  $ sed -n '749p;765p;799p' test/projects.test.mjs
  test('不变量: 同一份输入两次调用结果一致（确定性与无隐藏状态）', () => {
  test('不变量: buildProjects 不修改入参数组（纯函数）', () => {
  test('边界: 空输入 ⇒ 两个空结果，不抛错', () => {
  ```
  三处行号在 `test/projects.test.mjs`（804 行）中**确实存在且内容吻合**，证实为路径前缀误标。同文件 `:286`、`:394` 已正确写为 `test/projects.test.mjs:N`，可见是局部笔误。
- **建议修法**：将 `:148`、`:255`、`:276` 中的 `src/projects.ts:749-798`／`:765-798`／`:799` 分别改为 `test/projects.test.mjs:749-798`／`:765-798`／`:799`（`:283`、`:322`、`:310` 指向 `src/projects.ts` 是正确的，保留）。

---

### 轻微（表述含糊、可改进）

#### L-1 TreeModel L3 文档"≤500 行，未触发拆分规则"表述有歧义

- **位置**：`docs/knowledge/l3-components/TreeModel技术文档.md:12`
- **原文**：`> 单文件形态（≤500 行，未触发拆分规则）。下文 :N 指 src/tree-model.ts 第 N 行。`
- **问题**：紧邻上一行刚写明源码为「2379 行」，读者易把"≤500 行"误读为**源码**行数，从而认为与 2379 行矛盾。按拆分纪律，500 行阈值约束的是**成文篇幅**，而本文件确为 499 行。
- **证据**：
  ```console
  $ wc -l "docs/knowledge/l3-components/TreeModel技术文档.md"
  499
  $ wc -l src/tree-model.ts
  2379
  # 同类文档因成文超 500 行而拆分，佐证阈值针对成文：
  $ grep -n '500 行' docs/knowledge/l3-components/Ledger技术文档.md docs/knowledge/l3-components/Routes技术文档.md
  Ledger技术文档.md:13:本文是 `src/ledger.ts` 的 L3 组件文档**概览与导航**。因成文超过 500 行，按拆分规则拆为…
  Routes技术文档.md:17:…全文超过 500 行，按 L3 分层纪律拆为本文（概览）+…
  ```
  ⇒ 事实无误，仅措辞可改进。
- **建议修法**：改为「本文成文 499 行（≤500 行，未触发拆分规则）；源码单文件形态 2379 行」。

#### L-2 Types 文档注释区间起始行差一

- **位置**：`docs/knowledge/l3-components/Types技术文档.md:123`
- **原文**：`（src/git.ts:236-241 注释）`
- **问题**：第 236 行是**空行**，该 JSDoc 注释块实际起于 237、止于 247。属 off-by-one，注释内容本身与文档描述相符。
- **证据**：
  ```console
  $ awk 'NR>=236 && NR<=238{printf "%d: %s\n",NR,$0}' src/git.ts
  236: 
  237: /**
  238:  * 解析工作树根目录（`git rev-parse --show-toplevel`），非 git 仓 / bare 仓返回 `null`。
  $ awk 'NR>=245 && NR<=247{printf "%d: %s\n",NR,$0}' src/git.ts
  245:  * 本函数保留导出，用于「只想知道给定路径落在哪个工作树根」的场景…
  247:  */
  ```
- **建议修法**：改为 `src/git.ts:237-247`。

#### L-3 TreeModel L3 文档以 `lib/` 构建产物作为源码级事实的旁证

- **位置**：`docs/knowledge/l3-components/TreeModel技术文档.md:84`、`:477`
- **原文**：`:84` 「**模块私有**（`lib/tree-model.d.ts:1013` 的 `export {}` 未导出，行号见源码）…」；`:477` 「（`lib/tree-model.d.ts:543` 仍对外导出）」
- **问题**：`lib/` 被 `.gitignore` 忽略且**未被 git 跟踪**，属可重建的构建产物，在干净检出中不存在；引用它对读者而言是**不稳定证据**（虽当前磁盘内容核对无误）。
- **证据**：
  ```console
  $ git check-ignore -v lib/tree-model.d.ts
  .gitignore:3:lib/	lib/tree-model.d.ts
  $ git ls-files lib/
  （空）
  $ sed -n '1013p' lib/tree-model.d.ts
  export {};
  $ sed -n '543p' lib/tree-model.d.ts
  export declare function containerKeyOfSession(sessions: ReadonlyMap<string, readonly string[]>, sessionId: string): string | undefined;
  ```
  当前磁盘内容**与文档描述相符**；但 `lib/tree-model.d.ts` 共 1013 行，`:84` 称其"`export {}` 未导出"的同时又在同句用源码行号列出 33 个私有符号（已核对：33 个符号**全部**在 `src/tree-model.ts` 中有声明，无虚构），故该 `lib/` 引用并非必要证据。
- **建议修法**：删除两处 `lib/tree-model.d.ts` 引用，或改为「见 `src/tree-model.ts` 中未带 `export` 的声明（可用 `grep -c '^export '` 得 35 与总数对照）」。同时建议文档在提及 `lib/` 处统一标注「构建产物，非版本控制内容」。

---

## 4. 三条已知偏差的独立核实结论

| 偏差 | 结论 | 证据命令 | 证据位置 |
|---|---|---|---|
| **a.** `docs/INTERFACES.md` §2.1 locales key 清单比 `src/locales.ts` 少 4 条 | **成立**（但性质为"最小集声明"，非错误） | 见下 | `docs/INTERFACES.md:287-346`、`src/locales.ts:16-74` |
| **b.** `docs/INTERFACES.md` §1.3 缺 `liveWorkspacePaths` 字段 | **成立** | 见下 | `docs/INTERFACES.md:137-183`、`src/projects.ts:72` |
| **c.** `src/projects.ts` 第 1 行有未使用的死导入 `resolve` | **成立** | 见下 | `src/projects.ts:1` |

### 偏差 a：成立，但需修正父代理的表述

```console
$ awk '/^### 2\.1/,/^### 2\.2/' docs/INTERFACES.md | grep -oE '^[a-z][a-zA-Z0-9_.]*\.[a-zA-Z0-9_]+' | sort -u > /tmp/iface_keys.txt
$ wc -l < /tmp/iface_keys.txt
46
$ wc -l < /tmp/src_keys.txt
50
$ comm -23 /tmp/src_keys.txt /tmp/iface_keys.txt
a11y.subagents
state.loadingTree
worktree.createTitle
worktree.menu
$ comm -13 /tmp/src_keys.txt /tmp/iface_keys.txt
（空）
```

- **差值恰为父代理登记的 4 条**，且**无反向虚构**（INTERFACES 未列出源码不存在的 key）。四条均**确实被生产代码使用**：
  ```console
  $ for k in worktree.menu a11y.subagents state.loadingTree worktree.createTitle; do
      printf "%-22s -> %s hits\n" "$k" "$(grep -rho "['\"]$k['\"]" src/ | wc -l | tr -d ' ')"; done
  worktree.menu          -> 5 hits
  a11y.subagents         -> 2 hits
  state.loadingTree      -> 2 hits
  worktree.createTitle   -> 2 hits
  ```
- **关键限定（独立复核修正）**：§2.1 的清单标题为「**必须覆盖的 key（最少集）**」，语义上是**下界**而非穷尽清单，故严格说不构成"文档错误"。且该差异**已被知识库自身正确记录**：`src/locales.ts:10-12` 源码注释、`Locales技术文档.md:293`（结论「偏差范围恰为上述 4 条，实现是事实来源，契约清单滞后」）、`docs/worklog/2026-09-22-knowledge-base.md:131` 三处均有记载。
- **判定**：偏差**真实存在**，但**不是知识库的事实性缺陷**；属 `docs/INTERFACES.md`（本次审查范围外的契约文件）滞后，且已留痕。**建议**：由主代理决定是否同步 `INTERFACES.md`，并在 §2.1 标题处显式加注「实现已超出此最小集 4 条，见 `src/locales.ts:10-12`」。

### 偏差 b：成立

```console
$ grep -c 'liveWorkspacePaths' docs/INTERFACES.md
0
$ grep -n 'liveWorkspacePaths' src/projects.ts
72:  liveWorkspacePaths?: ReadonlySet<string>
164: * （scanRepo 已用 fs.stat 逐条探测过）与调用方传入的 `liveWorkspacePaths` 两个已知事实推断。
210:      const live = input.liveWorkspacePaths
```

- `src/projects.ts:72` 确在 `BuildProjectsInput` 中声明该可选字段，且 `:210` 有消费逻辑；`docs/INTERFACES.md` §1.3 的 `BuildProjectsInput` 片段（`:137-183`）**确实未列出**，全文 0 命中。
- **同样已被知识库自身正确记录**：`Projects技术文档.md:121`（契约片段复现）、`:135`（字段语义）、`:400`（明确标为"未确认项"：`docs/INTERFACES.md` §1.3 未列出而源码已包含，本文件按源码描述）、以及 `docs/worklog/2026-09-22-knowledge-base.md:131`。
- **判定**：成立；知识库侧处理**正确**（按源码描述并显式标注契约滞后）。属 `INTERFACES.md` 待同步项。

### 偏差 c：成立

```console
$ sed -n '1p' src/projects.ts
import { basename, dirname, resolve } from 'node:path'
$ grep -nE 'resolve' src/projects.ts
1:import { basename, dirname, resolve } from 'node:path'
$ for s in basename dirname resolve; do printf "%-9s uses: %s\n" "$s" "$(grep -cE "\b$s\(" src/projects.ts)"; done
basename  uses: 7
dirname   uses: 1
resolve   uses: 0
$ grep -n 'noUnusedLocals' tsconfig.json
（无命中，exit 1）
```

- `resolve` 在 `src/projects.ts` 中**唯一出现处就是导入行本身**，调用点 0 处；`tsconfig.json` 未开启 `noUnusedLocals`，故不阻塞构建。
- **已被知识库自身正确记录**：`Projects技术文档.md:391` 明确写出「`import { resolve } from 'node:path'` 未被使用（`src/projects.ts:1`）…属于可清理的死导入」。
- **判定**：成立；知识库侧已准确记录，**无需修改知识库**。仅建议后续清理源码时同步删除 `Projects技术文档.md:68` 的 `resolve` 提及（该行现列 `basename`、`dirname`、`resolve` 三个符号，删导入后应改为两个）。

---

## 5. 未能验证的项

| # | 项目 | 原因 | 影响 |
|---|---|---|---|
| U-1 | 文档中对**宿主包**内部实现的引用（`dsh-client-ui-slots/lib/index.js:79-81`、`dsh-client-ui-renderer/lib/client.js:604`、`@deepseek-ai/cordis/lib/index.js:762-771` 等，共 **13** 处去重引用） | 本包 `node_modules/@deepseek-ai/` 下**只有 `cordis` 与 `cosmokit`**，无 `dsh-client-ui-*`；任务禁止联网与安装依赖 | 这些断言（如"`slots.register` 重复注册抛错分支在 `index.js:79-81`"）**未独立核实**。注意 `Client技术文档.md:463` 已自行把该类结论标为"**未经本包测试验证**"，态度正确 |
| U-2 | `lib/*.d.ts` 是否与锚点处 `src/` 一致 | 禁止 `npm run build`；`lib/` 未跟踪、无法用 git 佐证其对应版本 | L-3 仅核对了**当前磁盘内容**与文档描述相符，**未验证**其与锚点的一致性 |
| U-3 | `test/*.mjs` 断言语义是否真正覆盖文档所述边界 | 禁止 `npm test` | 仅核对了被引用的 `test/` 行号**存在且用例名与文档描述吻合**（抽样 `projects.test.mjs:749/765/799`、`ledger.test.mjs`、`sidebar-wiring.test.mjs:468-482`），**未执行**用例以确认其通过 |
| U-4 | 文档中"运行期行为"类断言（如 `Sidebar技术文档.md` 的拖拽交互、`Client技术文档.md` 的槽位选举时序） | 属浏览器运行时行为，需真实宿主环境；任务禁止起服务/联网 | 仅做了**静态一致性**核对（符号存在、调用点存在），**未做**行为验证 |
| U-5 | `test/` 全部 63 处带行号引用 | 时间与范围约束，仅抽样核对（`projects.test.mjs` 3 处 + `tree-model.test.mjs` 导入块 + `sidebar-wiring.test.mjs` 1 处 + `ledger.test.mjs` 若干） | 存在未发现的 `test/` 行号错位可能；已知 M-3 即此类问题的实例 |
| U-6 | `docs/` 内 10 处带行号引用（指向 `docs/INTERFACES.md` 等） | 抽样核对（如 `Locales技术文档.md:293` 对 §2.1 第 287–346 行的界定已核对无误） | 未全量核对 |

**未验证 ≠ 通过**：上表各项均未取得独立证据，不应计入通过项。

---

## 6. 报告自身的局限

1. **抽样而非穷举**：行号「内容相符性」只覆盖 66/1333 处（5.0%）。虽然 737 个去重行号对已**全量**做过越界校验（覆盖率高），但"行号有效"不等于"描述正确"——后者依赖抽样。M-3 正是"越界校验"能捕获的类型，而更隐蔽的"行号有效但语义错配"仅靠 66 处抽样不足以完全排除。
2. **三个源文件引用密度极高**：`routes.ts` 545 处、`ledger.ts` 153 处、`sidebar.tsx` 134 处，合计 832 处（62%）。抽样对这些文件各取 8 处，比例偏低；`routes.ts` 单文件 1679 行，语义错配的漏检风险最高。
3. **无运行时验证**：全部结论均基于**静态源码阅读与文本比对**。文档中关于并发时序、React 渲染行为、宿主槽位选举的断言，本报告无法证实或证伪（见 U-4）。
4. **`lib/` 与宿主包不可核验**：受"禁止构建/联网"约束，**2** 处本包 `lib/tree-model.d.ts` 引用与 **13** 处宿主包引用未取得独立证据（见 U-2、U-1）。
5. **`test/` 覆盖不足**：63 处 `test/` 行号引用仅抽样核对，未执行测试。M-3 的存在提示该类别**已知存在错位**，实际错位数可能多于 3 处。
6. **未评审文档的"设计合理性"**：本报告只判断"文档断言 vs 源码真相"的事实一致性，**不评价**架构取舍、命名、文档组织是否恰当，也未评审 `docs/` 下 20 篇以外的文件（`INTERFACES.md` 仅在偏差 a/b 范围内被引用）。
7. **锚点时效性**：全部结论仅对 `git-version 9bd9425` 有效。`src/` 一旦变动，行号类结论即可能失效。

### 6.1 未修改被审查文件的佐证

```console
$ git status --porcelain
?? AGENTS.md
?? docs/README.md
?? docs/RESEARCH-running-and-sort.md
?? docs/RESEARCH-session-drop-to-bottom.md
?? docs/REVIEW-final-verification.md
?? docs/REVIEW-fix-verification.md
?? docs/REVIEW-running-and-sort.md
?? docs/REVIEW-running-only-topzone.md
?? docs/REVIEW-top-zone.md
?? docs/knowledge/          ← 审查前即为未跟踪状态，本报告未改动其中任何文件
?? docs/worklog/
```

审查前后对全部被审查文件取 MD5（`docs/knowledge/**.md` 20 篇 + `src/*.ts(x)` 11 个 + `docs/INTERFACES.md`）并比对，**摘要完全一致**；本报告是本次唯一新增/修改的文件（`docs/reviews/knowledge-base-fact-check.md`）。`docs/knowledge/` 下 20 篇在审查全程**只读**。

---

## 7. 总体评价

知识库的事实质量**显著高于**同类自动生成产物：

- **零虚构**：95 个导出符号双向核对全通过，无一个文档声明的符号在源码中不存在；无虚构文件、无虚构 API。
- **行号精度高**：737 个去重行号 100% 指向有效范围（除 3 处 `test/`→`src/` 误标），66 处抽样 100% 语义相符；`TreeModel技术文档.md` 的 71 个裸 `:N` 引用全部命中正确声明。
- **数值断言可靠**：`ServerHost` 的 2924 行、`WebClient` 的 5686 行、`TreeModel` 的 35 个导出（20 函数 + 2 常量 + 13 类型）、`routes` 的 5 条路由、`Locales` 的 50 条 key 清单与 50 个行号注解——**全部逐项复核无误**。
- **自我批判意识**：三条已知偏差**全部已在知识库内部正确记录**（含源码注释、L3 文档专节、worklog），`Client技术文档.md:463` 还主动标注了"未经本包测试验证"。这是本次审查中最值得肯定的特征。

**7 项问题中，3 项中等（M-1 计数错误、M-2 作用域扩大、M-3 路径前缀误标）均为局部、可精确定位、易修复的缺陷，不涉及任何虚构内容或结构性错误。** 严重级为 0。

### 建议修复优先级

| 优先级 | 问题 | 理由 |
|---|---|---|
| 1 | **M-2** | 唯一"事实错误"型断言（"全包唯一"为假），且**重复出现 2 处**，易误导后续维护者 |
| 2 | **M-1** | 自相矛盾（48 vs 50），且同类计数若靠手工维护会持续漂移 |
| 3 | **M-3** | 3 处越界引用，读者按图索骥会失败 |
| 4 | L-1 / L-2 / L-3 | 表述与引用健壮性改进 |
