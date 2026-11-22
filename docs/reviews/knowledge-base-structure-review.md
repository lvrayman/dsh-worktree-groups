---
生成时间: 2026-09-22
更新时间: 2026-09-22
git-version: 9bd94252dd934c2fa8491977285e461b703f0f3e
git-module-path: src
level: review
---

# 知识库结构合规独立审查报告（T-REV-02）

> **审查对象**：`docs/knowledge/` 全部 20 篇 md（19 篇正文 + 1 篇总索引）
> **规则权威来源**：`~/.agents/skills/rl-kb-generator/SKILL.md`、`~/.agents/skills/rl-kb-generator/references/level-templates.md`
> **审查者**：独立审查子代理（未参与任何写作任务；未修改任何被审查文件）
> **审查方法**：只读命令 + 自写 Node 脚本；**不采信父代理基线数字，全部独立复算**
> **结论**：结构性硬伤 1 类（4 个文件 frontmatter 位置）＋ 中等偏离 3 类 ＋ 轻微 3 项；核心分层纪律、拆分规则、命名约定、索引完整性、链接完整性、可导航性 **全部通过**

---

## 1. 审查范围与方法（实际执行的命令）

| # | 检查项 | 实际执行的命令 / 方法 |
|---|---|---|
| 1 | 规则基线 | `read` 读取 `SKILL.md`（286 行）与 `references/level-templates.md`（493 行）全文 |
| 2 | 文档清单与行数 | `find docs/knowledge -name '*.md' \| sort \| xargs wc -l` |
| 3 | 海拔纪律（签名） | `grep -nE '^\s*(export )?(async )?(function\|const\|interface\|type\|class) '` 逐篇 L1/L2 |
| 4 | 海拔纪律（参数/类型注解样式） | `grep -nE '\w+\([^)]*\)\s*:'` 逐篇 L1/L2 |
| 5 | 海拔纪律（代码围栏） | `grep -c '^```'` 逐篇 L1/L2 |
| 6 | 海拔纪律（字段定义表） | `grep -nE '^\|\s*(字段\|参数\|属性\|类型\|签名\|方法\|返回值)\s*\|'` 逐篇 L1/L2 |
| 7 | 海拔纪律（状态机图） | `grep -n '状态机\|流转图\|IDLE\|DRAGGING'` 逐篇 L1/L2 + 人工判读上下文 |
| 8 | 围栏内容深挖 | 自写 `/tmp/kbrev/alt.mjs`：逐围栏扫描标识符调用样式（`name(`），并区分围栏内/外 |
| 9 | 内部函数名清单化 | 对 TreeModel L2 架构图逐标识符 `grep -qE "^export (async )?(function\|const\|interface\|type\|class) $id\b" src/tree-model.ts` 判定导出/内部 |
| 10 | L3 小节覆盖矩阵 | 自写 `/tmp/kbrev/matrix.mjs`：15 篇 × 11 小节标题正则匹配 |
| 11 | L3 状态机质量 | 自写 `/tmp/kbrev/sm.mjs`：检测「ASCII 图 + 状态参考表」双要件与 N/A 长度 |
| 12 | 拆分规则 | `wc -l` 对 Routes 4 篇 / Ledger 3 篇；概览 ≤80 行核对；子文档 ≤500 行核对 |
| 13 | 命名约定 | `ls` + `grep -vE '^.+模块技术文档\.md$'` / `'^.+技术文档\.md$'` / `'^.+knowledge-base\.md$'` |
| 14 | **权威链接计数** | 自写 `/tmp/kbrev/linkcheck.mjs`：遍历 20 篇，提取 `[..](..)`，校验目标文件存在性 |
| 15 | 锚点校验 | 自写 `/tmp/kbrev/anchors2.mjs`：按 **GitHub slug 算法**（空格转 `-` 且**不折叠**）校验 147 条页内锚点 |
| 16 | 计数口径对账 | `grep -rhoE '\[[^]]*\]\([^)]+\)'` 及变体；自写 `/tmp/kbrev/variants.mjs` |
| 17 | 索引完整性 | 自写 `/tmp/kbrev/index.mjs` + `/tmp/kbrev/index2.mjs`：磁盘 19 篇 vs README 链接目标集合的双向差集 |
| 18 | 可导航性遍历 | 自写 `/tmp/kbrev/reach2.mjs`（带环保护的 BFS）+ `/tmp/kbrev/dist.mjs`（分层 BFS 求跳数） |
| 19 | 事实核对 | `wc -l src/*.ts src/*.tsx src/*.d.ts`、`grep -c '^export ' src/tree-model.ts`、`grep -c 'test(' test/*.mjs`、`ls src/ \| wc -l` |
| 20 | 仓库规范一致性 | `grep -n 'knowledge' docs/README.md AGENTS.md`、`find src -name '*.md'`、`ls *.md` |
| 21 | 未改动佐证 | `git status --porcelain`、`find docs/knowledge -name '*.md' -exec stat -f '%Sm %N' {} \;`、`date` |

**执行边界遵守情况**：未执行 `npm run build` / `npm test` / `git add` / `git commit` / 联网；未修改 `docs/knowledge/` 下任何文件、`docs/README.md`、`docs/worklog/`、`src/`、`AGENTS.md` 或任何配置。

---

## 2. 规则基线（引用的 skill 规则原文要点与来源行号）

| 编号 | 规则原文要点 | 来源 |
|---|---|---|
| R1 | 「海拔越高，细节越少。当你在 L1/L2 中写下方法签名、参数列表、代码片段、状态机图或数据字段定义时——海拔错了，这些内容属于 L3。在 L1/L2 中只保留"详见 [L3 文档](链接)"。」 | `SKILL.md:28` |
| R2 | L1「**禁止所有技术细节**：API 签名、方法列表、参数说明、代码示例、数据结构定义、状态机图、算法描述。」 | `level-templates.md:15` |
| R3 | L2「**禁止所有技术细节**：方法签名、参数说明、代码示例、数据结构、状态转换细节。」 | `level-templates.md:16` |
| R4 | 判断标准：「如果你在 L1/L2 中发现了方法签名、参数列表、代码片段、状态机图或数据字段定义，这些内容必须移到 L3。」 | `level-templates.md:19` |
| R5 | 「任何知识库 MD 文件超过 **500 行**必须拆分。」 | `level-templates.md:25` |
| R6 | L1 拆分后「原文档保留 ≤80 行摘要」；L2「原文档保留 ≤80 行摘要 + 子文档链接」；L3「概览文档 `<ClassName>技术文档.md`（≤80 行）+ 子文档」 | `level-templates.md:29-31` |
| R7 | 「**L2 中的索引**：拆分后每个子文档单独一行索引，概览文档标注"(概览)"。」 | `level-templates.md:37` |
| R8 | 「Fill in every section — if a section genuinely doesn't apply, note "N/A" with a brief reason rather than omitting it silently.」 | `level-templates.md:39` |
| R9 | L1 模板 5 小节：域概述 / 架构分层 / 模块索引 / 跨模块流程 / 设计约定 | `level-templates.md:64-138` |
| R10 | L2 模板 6 小节：模块概览 / 架构设计 / 组件索引 / 关键流程摘要 / 依赖关系 / 平台适配；架构图注「`<Key classes (不列方法，只列类名)>`」 | `level-templates.md:165-249`（**关键注记在 200 行**） |
| R11 | L3 单文件模板 11 小节：目录/概述/构造参数与依赖/核心方法签名/执行流程/状态机/并发与线程模型/边界条件/代码示例/已知缺陷与注意事项（+ 相关文档） | `level-templates.md:288-427` |
| R12 | 命名约定：L1 `<module-or-domain>-knowledge-base.md`；L2 `<ModuleName>模块技术文档.md`；L3 `<ClassName>技术文档.md` 与 `<ClassName>-<功能>技术文档.md` | `SKILL.md:232-236` |
| R13 | frontmatter 必须记录 `git-version` / `git-module-path`，获取方式 `git log -1 --format="%H" -- <module-path>/` | `SKILL.md:218-230` |
| R14 | **Step 2B 增量更新**：「从 frontmatter 读取 `git-module-path` 和 `git-version`」「每份文档必须用自己的 `git-module-path` 独立**锚定**」 | `SKILL.md:100-106` |
| R15 | L3 质量准则：「State machines have both a flow diagram AND a state reference table」 | `SKILL.md:243` |
| R16 | README 更新 7 条规则：层级表加行 / 快速检索加行 / 目录树加行 / 更新篇数 / 更新时间 / **不重排既有条目** / L3 拆分文档概览与子文档都单独列出 | `level-templates.md:485-493` |
| R17 | AGENTS.md §5：文档正文集中 `docs/`；「大型专题目录必须有自己的 `README.md`」；「确保每份文档都能从总入口沿链接找到」；「不在源码目录或仓库根目录新建方案、报告、日志等正文文档」 | `AGENTS.md` §5 |

---

## 3. 结论摘要表

| 检查项 | 规则依据 | 方法 | 结果 | 证据位置 |
|---|---|---|---|---|
| 海拔纪律 — L1 篇 | R1–R4 | 5 组 grep + 人工判读 | ✅ **通过** | 见 §4.1 |
| 海拔纪律 — ServerHost L2 | R1–R4 | 5 组 grep + 人工判读 | ✅ **通过** | 见 §4.2 |
| 海拔纪律 — WebClient L2 | R1–R4 | 5 组 grep + 人工判读 | ✅ **通过** | 见 §4.3 |
| 海拔纪律 — TreeModel L2 | R1–R4, R10 | 5 组 grep + 围栏深挖 + 导出符号比对 | ⚠️ **中等偏离**（架构图列内部函数名） | 见 §4.4 / §6.2 |
| 500 行上限（20 篇） | R5 | `wc -l` | ✅ **通过**（最大 499） | `TreeModel技术文档.md` 499 行 |
| 拆分概览 ≤80 行 | R6 | `wc -l` | ✅ **通过**（Routes 64 / Ledger 78） | 见 §5 |
| 拆分：子文档 ≤500 行 | R5 | `wc -l` | ✅ **通过**（最大 469） | 见 §5 |
| 拆分：概览 + 子文档索引 + 互链 | R6, R7 | 逐文件人工核对 | ✅ **通过** | 见 §5 |
| L3 模板 11 小节 | R11 | 15 篇标题矩阵 + 5 篇内容抽检 | ✅ **通过**（含 4 篇子文档的声明式豁免，见 §6.3） | 见 §6 |
| L3 状态机双要件 | R15 | 逐篇「ASCII 图 + 状态参考表」检测 | ✅ **通过**（6 篇有状态机者双要件齐备；6 篇 N/A 写明原因） | 见 §6 |
| N/A 是否写明原因 | R8 | 逐处人工判读 | ✅ **通过**（N/A 均给出具体原因） | 见 §6.1 |
| 命名约定 | R12 | 逐文件正则判定 | ✅ **通过**（20/20 合规） | 见 §7 |
| 总索引恰好覆盖 | R16 | 双向差集脚本 | ✅ **通过**（缺 0 / 多 0） | 见 §8.1 |
| 索引篇数标注 | R16 | 表行数 + 目录树标注计数 | ✅ **通过**（1/3/15 与磁盘一致） | 见 §8.1 |
| 快速检索小节 | R16 | 行数与覆盖质量 | ✅ **通过**（12 行，覆盖 19/19 篇） | 见 §8.2 |
| 相对链接断链 | — | 自写脚本全量校验 | ✅ **通过**（**307 条，断链 0**） | 见 §8.3 |
| 页内锚点有效性 | — | GitHub slug 算法校验 | ✅ **通过**（**147 条，全部命中**） | 见 §8.3 |
| 可导航性 | R17 | 从 `docs/README.md` BFS | ✅ **通过**（20/20 可达，≤2 跳） | 见 §9 |
| AGENTS.md §5 一致性 | R17 | 目录扫描 + 入口链接核对 | ✅ **通过**（另见 §6.4 关于 skill Step 2A 规则缺失） | 见 §10 |
| frontmatter 可机读性 | R13, R14 | `head -1` 逐文件判定 | ❌ **严重违规**（4 个文件 frontmatter 不在文件首） | 见 §6.1 |
| 文档事实准确性 | — | 与 `src/` 实测比对 | ⚠️ **中等偏离**（L1 一处「体量最大」表述错误） | 见 §6.5 |

---

## 4. 海拔纪律审查（核心）—— 全部 4 篇 L1/L2 逐篇命中数与判定

### 4.1 L1：`docs/knowledge/l1-architecture/worktree-groups-knowledge-base.md`（308 行）

| 检查方法 | 命中数 | 判定 |
|---|---|---|
| 签名正则 | **0** | 无违规 |
| 参数/类型注解样式 | **0** | 无违规 |
| 代码围栏 `^```` | **0** | 无违规 |
| 字段定义表表头 | **0** | 无违规 |
| 状态机/流转图关键词 | **1**（第 292 行） | ✅ **正当引用** |

- **第 292 行命中判定为正当引用**：原文为「海拔分层（L1 / L2 / L3）｜L1 只保留域概览、模块索引与跨模块流程名称；组件索引下放 L2，**签名、状态机与实现细节下放 L3**」。该行位于「§5 设计约定」表内，是在**声明分层纪律**，并非真的绘制状态机图。依据 R1，此处正是 skill 要求 L1 应做的事，判定通过。
- **架构图合规性**：§2 架构分层（第 62–124 行）用缩进块绘制（**非围栏**），粒度严格为「层名 + 文件名 + 一句话中文职责」，**不含任何函数名/方法名/字段名**，与第 60 行自述「下图只到「层名 + 模块 / 文件名」的粒度，不出现任何函数名、方法名与数据结构」一致，符合 R2。
- **跨模块流程（§4）**：5 条流程均只给「名称 + 一句话目的 + 涉及模块链 + 模块粒度 ASCII 概览图」，符合 R2 的「跨模块流程名称与一句话摘要」。
- **模块索引（§3）**：表头为「模块名 / 路径 / 一句话职责 / L2 文档链接」，非字段定义表，符合 R10 的 L1 模块索引要求。
- **额外核对**：§3 声明的路径并集覆盖 `src/` 全部 11 个文件（`comm` 双向差集为空），「共 3 个模块文档」与磁盘一致。

**L1 判定：海拔纪律通过。**

### 4.2 L2：`docs/knowledge/l2-modules/ServerHost模块技术文档.md`（270 行）

| 检查方法 | 命中数 | 判定 |
|---|---|---|
| 签名正则 | **0** | 无违规 |
| 参数/类型注解样式 | **0** | 无违规 |
| 代码围栏 `^```` | **0** | 无违规 |
| 字段定义表表头 | **0** | 无违规 |
| 状态机/流转图关键词 | **0** | 无违规 |

- 架构图（第 72–101 行）为缩进 ASCII，粒度到「组件文件名 + 职责」，第 70 行自述「不展开任何组件内部步骤」，符合 R10 的「不列方法，只列类名」精神。
- 组件索引表（第 120–132 行）表头为「组件 / 文件 / 文件路径 / 一句话职责 / L3 文档链接」，符合 R10；11 行恰好对应 11 份 L3 文档，且含 4 行 Routes、3 行 Ledger，与磁盘一致。
- 第 107 行「是模块内体量最大（1679 行）也最需要按功能面阅读的组件」——**在 ServerHost 模块内成立**（1679 > 486/336/292/81/50），判定正确。
- 平台适配表（第 251–258 行）为「功能面 / 平台差异与处理」，属 R10 要求的 L2 小节，且第 260–261 行对移动端写明 N/A 及原因。

**ServerHost 判定：海拔纪律通过。**

### 4.3 L2：`docs/knowledge/l2-modules/WebClient模块技术文档.md`（299 行）

| 检查方法 | 命中数 | 判定 |
|---|---|---|
| 签名正则 | **0** | 无违规 |
| 参数/类型注解样式 | **0** | 无违规 |
| 代码围栏 `^```` | **0** | 无违规 |
| 字段定义表表头 | **0** | 无违规 |
| 状态机/流转图关键词 | **0** | 无违规 |

- 架构图（第 82–112 行）为缩进 ASCII，第 80 行自述「不展开任何组件内部步骤，**也不列方法名**」，实际内容确为「文件名 + 职责」，符合 R10。
- 代码统计表（第 46–54 行）表头为「项 / 数值 / 依据」，**不是数据结构字段定义表**，属 L2 模板允许的「代码统计」，不违反 R3。
- 第 118 行「是模块内体量最大的组件（2895 行）」——**在 WebClient 模块内成立**（2895 > 2379/257/101/54），判定正确。
- 第 141 行对 `client-shims.d.ts` 明确标注「（暂无 L3 文档；纯类型声明，无运行时行为）」，与 R10 模板第 216 行的 `（暂无 L3 文档）` 占位写法一致。

**WebClient 判定：海拔纪律通过。**

### 4.4 L2：`docs/knowledge/l2-modules/TreeModel模块技术文档.md`（311 行）

| 检查方法 | 命中数 | 判定 |
|---|---|---|
| 签名正则 | **0** | 无违规 |
| 参数/类型注解样式 | **0** | 无违规 |
| 代码围栏 `^```` | **2**（第 73、115 行，即 **1 个** ```` ```text ```` 块） | ⚠️ **需人工判断 → 见下** |
| 字段定义表表头 | **0** | 无违规 |
| 状态机/流转图关键词 | **1**（第 102 行） | ✅ **正当引用** |

**关于「用围栏画 ASCII 图是否算违规」的判定（依据模板原文）**：

- **围栏本身不违规**。R2/R3 禁止的是「代码片段 / 代码示例」，而 L1/L2 模板**明确要求**用围栏画架构图：`level-templates.md:88-99`（L1 架构分层用 ```` ``` ````）与 `level-templates.md:197-207`（L2 架构设计用 ```` ``` ````，并注明「不列方法，只列类名」）。因此「L2 出现 1 个 ASCII 图围栏」**不构成违规**。
- **但该围栏的粒度违规**。R10 明确要求 L2 架构图「**不列方法，只列类名**」。逐标识符比对 `src/tree-model.ts` 后确认：该图（第 83–114 行）列出的 43 个标识符中，**有 11 个是源码中未导出的内部实现函数**：

  `buildSearchRows`、`collectSearchCandidates`、`containersOfProject`、`discoverChildEdges`、`emitContainer`、`isVisibleMember`、`sortTopZone`、`subagentCountOf`、`toSessionRow`、`ungroupedContainer`、`visibleMembers`

  这 11 个名字只能通过阅读 `src/tree-model.ts` 内部实现获得，属于 R3 禁止的 L2「实现细节」范畴，也超出 R10 的「只列类名」。**判定：中等偏离（偏离模板，非硬规则的字面违反）**——详见 §6.2。

**关于第 102 行命中**：原文「④ 运行时顶部区层（**状态机**由 `observeTopZone` 推进；本层不写持久化）」——是在**标注分层职责**，不是绘制状态机图，判定为正当引用；但该行同时暴露了内部函数名，计入 §6.2。

**TreeModel 判定：海拔纪律**通过 grep 硬指标**，但架构图粒度存在中等偏离。**

### 4.5 海拔纪律汇总

| 文档 | 签名 | 参数注解 | 围栏 | 字段表 | 状态机词 | 综合判定 |
|---|---|---|---|---|---|---|
| L1 worktree-groups | 0 | 0 | 0 | 0 | 1（正当） | ✅ 通过 |
| L2 ServerHost | 0 | 0 | 0 | 0 | 0 | ✅ 通过 |
| L2 WebClient | 0 | 0 | 0 | 0 | 0 | ✅ 通过 |
| L2 TreeModel | 0 | 0 | 2（1 图，合规） | 0 | 1（正当） | ⚠️ 通过（图粒度中等偏离） |

**关键结论**：**四篇 L1/L2 均未出现任何方法签名、参数列表、代码片段或数据字段定义**——父代理关于「L2 方法签名泄漏 0 命中」的基线**经独立复核成立**。唯一实质性海拔问题是 TreeModel L2 架构图的内部函数名粒度。

---

## 5. 拆分规则符合性

### 5.1 500 行上限（全库 20 篇）

`find docs/knowledge -name '*.md' | xargs wc -l` 结果：**全部 ≤ 500 行**，最大值 499（`l3-components/TreeModel技术文档.md`）。✅ 通过。

### 5.2 Routes 拆分形态（4 篇）

| 文件 | 行数 | 规则要求 | 判定 |
|---|---|---|---|
| `Routes技术文档.md`（概览） | **64** | ≤80 行（R6） | ✅ 通过（余量 16 行） |
| `Routes-路由注册与契约技术文档.md` | 375 | ≤500（R5） | ✅ 通过 |
| `Routes-路径校验与安全边界技术文档.md` | 320 | ≤500 | ✅ 通过 |
| `Routes-快照组装与台账技术文档.md` | 469 | ≤500 | ✅ 通过 |

- **概览 + 子文档索引 + 互相链接**：概览第 31–37 行有「子文档索引」表（3 行，每子文档单独一行，符合 R7）；第 56–64 行「相关文档」互链 3 份子文档；每份子文档头部均有 `> **父文档**: [Routes技术文档.md](./Routes技术文档.md)（概览 + 子文档索引）` 回链。✅ 通过。
- **概览未标注「(概览)」于文件名**，但 R7 要求的是**索引表中**标注「(概览)」——`docs/knowledge/README.md:40` 与 `ServerHost模块技术文档.md:123` 均已标注「Routes 技术文档（概览）」。✅ 通过。
- 4 篇合计 1228 行 > 500，属拆分后各篇独立满足上限，符合规则本意。

### 5.3 Ledger 拆分形态（3 篇）

| 文件 | 行数 | 规则要求 | 判定 |
|---|---|---|---|
| `Ledger技术文档.md`（概览） | **78** | ≤80 行（R6） | ✅ 通过（余量 **2 行**，为全库最紧） |
| `Ledger-数据模型与接口技术文档.md` | 313 | ≤500（R5） | ✅ 通过 |
| `Ledger-持久化与并发技术文档.md` | 279 | ≤500 | ✅ 通过 |

- 概览第 15–17 行有「目录」（以 10 个 `｜` 分隔的**单行**列举）；第 70–76 行「相关文档」互链两份子文档；两子文档头部均有 `> **上级概览**: [Ledger技术文档.md](./Ledger技术文档.md) | **姊妹篇**: [...]` 互链。✅ 通过。
- `docs/knowledge/README.md:46`、`:89` 与 `ServerHost模块技术文档.md:129` 均标注「Ledger 技术文档（概览）」。✅ 通过。
- 概览第 13 行如实声明「因成文超过 500 行，按拆分规则拆为本文（概览）+ 两份子文档」。3 篇合计 670 行。

### 5.4 拆分触发条件复核

R5 的 L3 拆分触发条件为「文档超过 500 行」**或**「类覆盖 3 个以上独立子功能」。本次两处拆分均满足第一条件（Routes 合并态 1228 行、Ledger 合并态 670 行），触发理由成立。**未发现「应拆未拆」的文件**：全库最大单篇 499 行，未越线。

**拆分规则综合判定：✅ 通过。**

---

## 6. 问题清单

### 6.1 【严重】4 个文件的 frontmatter 不在文件首，破坏 skill Step 2B 的机读锚定

| 文档:行号 | 问题 | 规则依据 | 建议修法 |
|---|---|---|---|
| `docs/knowledge/l2-modules/TreeModel模块技术文档.md:1-9` | 第 1 行是 H1 `# TreeModel 模块技术文档`，`---` 出现在第 3、9 行，frontmatter 块**不在文件起始位置** | R13（`SKILL.md:218-230`：模板要求 frontmatter 在 H1 之前）、R14（`SKILL.md:100-106`：「**从 frontmatter 读取** `git-module-path` 和 `git-version`」，并要求**逐份独立锚定**） | 把第 3–9 行的 frontmatter 块整体上移到文件第 1 行，H1 移到 frontmatter 之后 |
| `docs/knowledge/l2-modules/WebClient模块技术文档.md:1-9` | 同上：H1 在首行，`---` 在第 3、9 行 | 同上 | 同上 |
| `docs/knowledge/l3-components/Client技术文档.md:1-9` | 同上：H1 在第 1 行，`---` 在第 3、9 行 | 同上 | 同上 |
| `docs/knowledge/l3-components/TreeModel技术文档.md:1-9` | 同上：H1 在第 1 行，`---` 在第 3、9 行 | 同上 | 同上 |

**为什么这是严重（违反硬规则）**：

1. skill 的 L1/L2/L3 三个模板（`level-templates.md:50-58`、`:150-158`、`:274-282`）**无一例外**把 frontmatter 放在 H1 之前；`SKILL.md:220-228` 的示例同样是 frontmatter 打头。
2. Step 2B 是 skill 中**唯一带「❌ 禁止」措辞的强制流程**（`SKILL.md:106`），其输入完全依赖 frontmatter 可被解析；把 frontmatter 放到 H1 之后，任何按标准 frontmatter 解析器（或按行首 `---` 判定）读取的脚本都会读不到 `git-version` / `git-module-path`，导致该文档在增量更新时**被静默跳过或误判为无锚点**。
3. 这是**全库唯一的不一致点**：其余 16 篇（含总索引）frontmatter 均在第 1 行。

**佐证命令与结果**：
```
$ for f in $(find docs/knowledge -name '*.md'); do first=$(head -1 "$f"); \
    [ "$first" != "---" ] && echo "$f : line1=$first"; done
docs/knowledge/l2-modules/TreeModel模块技术文档.md : line1=# TreeModel 模块技术文档
docs/knowledge/l2-modules/WebClient模块技术文档.md : line1=# WebClient 模块技术文档
docs/knowledge/l3-components/Client技术文档.md : line1=# client.tsx（客户端半边入口）技术文档
docs/knowledge/l3-components/TreeModel技术文档.md : line1=# tree-model 技术文档
```
**字段完整性无问题**：20 篇均含 `生成时间`/`更新时间`/`git-version`/`git-module-path`/`level`（总索引无 `生成时间`，属索引合理豁免）。

---

### 6.2 【中等】TreeModel L2 架构图列出 11 个未导出内部函数名，超出「不列方法，只列类名」

| 文档:行号 | 问题 | 规则依据 | 建议修法 |
|---|---|---|---|
| `docs/knowledge/l2-modules/TreeModel模块技术文档.md:83-90` | ② 行推导层列出 `buildRows`、`buildSearchRows`、`collectSearchCandidates`、`isVisibleMember`、`containersOfProject`、`emitContainer`、`visibleMembers`、`applyManualOrder`、`topZoneSessionKeys`、`truncateSessions`、`toSessionRow`、`ungroupedContainer` | R10（`level-templates.md:200`：L2 架构图「`<Key classes (不列方法，只列类名)>`」）、R3（`level-templates.md:16`：L2 禁止「实现细节」） | 把该层收敛为「层名 + 一句话职责」，例如「② 行推导层 — 由入参推出渲染行序列；主入口 1 个，内部辅助函数若干（详见 L3）」；若确需列名，只列 35 个**导出符号**中的关键入口 |
| `docs/knowledge/l2-modules/TreeModel模块技术文档.md:102-104` | ④ 运行时顶部区层列出 `initialTopZoneState`、`observeTopZone`、`observationsOf`、`topZoneInputOf`、`topZoneSessionKeys`、`isTopZoneRunningSession`、`sortTopZone`（其中 `sortTopZone` 未导出） | 同上 | 同上 |
| `docs/knowledge/l2-modules/TreeModel模块技术文档.md:111-113` | ⑤ 子代理与 D2 落表层列出 `nestSubagents`、`discoverChildEdges`、`indexRunningSubagentDescendants`、`subagentCountOf`、`planNewSessionInserts`、`markNewSessionsWritten`、`pendingNewSessionIdsOf`（其中 `discoverChildEdges`、`subagentCountOf` 未导出） | 同上 | 同上 |

**11 个未导出内部函数名（经 `grep -qE "^export (async )?(function|const|interface|type|class) $id\b" src/tree-model.ts` 逐一判定为「非导出」）**：
`buildSearchRows`、`collectSearchCandidates`、`containersOfProject`、`discoverChildEdges`、`emitContainer`、`isVisibleMember`、`sortTopZone`、`subagentCountOf`、`toSessionRow`、`ungroupedContainer`、`visibleMembers`

**为什么定级为「中等」而非「严重」**：
- 严格按 R4 字面（「方法签名、参数列表、代码片段、状态机图或数据字段定义」），**函数名清单不在其列**，故不构成硬规则违反；
- 但 R10 对 L2 架构图的括注是明确的「**不列方法，只列类名**」，此处列了 11 个纯内部函数名，属对模板的实质偏离；
- **缓解因素**：同文件第 70–71 行自述「只到『哪个函数调用哪个函数』的粒度；类型名只作分层标注，**不展开字段定义**」，即作者**有意**选择了函数级粒度并已披露；且未泄漏任何签名、参数或字段，L3 仍保有全部实现细节，**未造成跨层重复维护**。
- **注**：该文档的「组件索引」小节（第 119–189 行，36 行）列出全部 35 个导出符号是**符合** R10 的（L2 组件索引本就要求逐个索引并链接 L3），与本条问题无关。

---

### 6.3 【中等】4 篇 L3 子文档静默省略模板小节，未按规则写 N/A

R8（`level-templates.md:39`）要求「Fill in every section — if a section genuinely doesn't apply, note **"N/A" with a brief reason** rather than **omitting it silently**」。

| 文档 | 模板 11 小节中缺失的节 | 规则依据 | 判定与建议 |
|---|---|---|---|
| `l3-components/Routes-路由注册与契约技术文档.md` | 缺 **构造参数与依赖 / 核心方法签名 / 执行流程 / 状态机 / 并发与线程模型 / 边界条件 / 已知缺陷与注意事项**（7 节） | R11 + R8 | 该文头部第 12–19 行**已声明覆盖范围**（「覆盖路由注册与装配、路由清单与导出符号、5 个端点契约、代码示例」）并指向姊妹篇，属**部分合规**；建议在缺失节处各加一行 `**N/A（见 [姊妹篇](...)）**`，或明确声明「本文为功能拆分文档，11 小节在概览与姊妹篇间分布」 |
| `l3-components/Ledger-数据模型与接口技术文档.md` | 缺 **概述 / 构造参数与依赖 / 执行流程 / 状态机 / 并发与线程模型 / 边界条件 / 已知缺陷与注意事项**（7 节） | R11 + R8 | 同上；第 11–13 行已有范围声明与姊妹篇链接 |
| `l3-components/Ledger-持久化与并发技术文档.md` | 缺 **概述 / 构造参数与依赖 / 核心方法签名 / 代码示例**（4 节） | R11 + R8 | 同上；第 11–13 行已声明「签名与数据结构见姊妹篇」 |
| `l3-components/Routes-路径校验与安全边界技术文档.md` | 缺 **构造参数与依赖 / 核心方法签名 / 代码示例**（3 节） | R11 + R8 | 同上；第 12–19 行已声明范围 |

**为什么定级为「中等」而非「严重」**：
- R8 位于 `level-templates.md` 的「500 行拆分规则」小节内，语境指向**拆分后的文档**；
- **每篇均以引言段声明了自身覆盖范围并指向姊妹篇**，属「非静默」省略——读者不会被误导；
- 但 R8 的字面要求是**逐节 N/A**，4 篇共 21 处节位未写 N/A，属对模板的机械偏离；
- **实质性缺口提示**：`Routes` 层**整体没有「核心方法签名」小节**（概览第 44–49 行仅以散文罗列 22 个导出符号名，无签名），若读者需要 Routes 的公共签名，当前需下钻源码——建议至少在某篇 Routes 子文档补齐签名节。

---

### 6.4 【轻微】skill Step 2A 要求的知识库检索规则未写入 `AGENTS.md`

| 位置 | 问题 | 规则依据 | 建议修法 |
|---|---|---|---|
| `AGENTS.md`（全文无 `knowledge`/`知识库`/`按层级检索` 命中） | skill 前置步骤 2A 要求：读取 `CLAUDE.md` 与 `AGENTS.md`，若不含知识库检索规则则在**对应章节末尾追加**「不管是编写代码……需要项目相关知识时，优先从 `docs/` 目录下按层级检索……」 | `SKILL.md:132-140` | 由主代理决定是否在 `AGENTS.md` §2「开始工作前」末尾追加该行；**本次审查为只读，未改动 `AGENTS.md`** |

**说明**：`CLAUDE.md` 不存在，规则只应落入 `AGENTS.md`。定级「轻微」因为：该规则不在本次知识库的「分层与索引规则」验收范围内，且属于 skill 的前置章节改写动作，非文档结构缺陷。**但需主代理决策**（涉及 `AGENTS.md` 修改权限，超出本次审查独占写入范围）。

---

### 6.5 【中等】L1 一处事实表述错误：「routes.ts 是本域体量最大的源文件」

| 文档:行号 | 问题 | 规则依据 | 建议修法 |
|---|---|---|---|
| `l1-architecture/worktree-groups-knowledge-base.md:128-130` | 原文「端点面只有 `routes.ts` 一个文件……**是本域体量最大的源文件（1679 行）**」 | AGENTS.md §7「需求、设计、接口文档与交付结果一致」；知识库质量要求「文档陈述的代码事实可被精确定位与复现」（同文档第 293 行自述） | 改为「是本域宿主半边体量最大的源文件（1679 行）」或「是本域第二大的源文件（1679 行，仅次于 `src/sidebar.tsx` 的 2895 行）」 |

**佐证命令与结果**：
```
$ wc -l src/*.ts src/*.tsx | sort -rn | head -3
    2895 src/sidebar.tsx     <- 本域真正的最大源文件
    2379 src/tree-model.ts
    1679 src/routes.ts
```
**对照检查**：`ServerHost模块技术文档.md:107` 的同类表述「是**模块内**体量最大（1679 行）」**正确**（ServerHost 模块内 1679 > 486/336/292/81/50）；`WebClient模块技术文档.md:118`「**模块内**体量最大的组件（2895 行）」**正确**。仅 L1 的「本域」限定词错误。

---

### 6.6 【轻微】Ledger 概览的 9 个小节标题前缺少空行，目录为单行分隔式列表

| 文档:行号 | 问题 | 规则依据 | 建议修法 |
|---|---|---|---|
| `l3-components/Ledger技术文档.md:17` | 「目录」以单行 `1. 概述｜2. 构造参数与依赖｜…｜10. [相关文档](#10-相关文档)` 呈现，仅最后一项可点击，其余 9 项**不可导航** | AGENTS.md §5「大型文档必须提供章节目录或独立主题索引」；L3 模板 R11 要求「目录」 | 改为标准多行链接列表，与其余 14 篇 L3 文档保持一致 |
| `l3-components/Ledger技术文档.md:26,31,40,45,50,55,60,65` | `## 2. 构造参数与依赖` 等 9 个标题**紧接上一节正文**，无前置空行 | 一致性风格（其余文档均有空行） | 在每个 `##` 标题前补一个空行 |

**佐证命令与结果**：
```
$ awk 'prev!="" && /^##/ {print "L"NR": "$0} {prev=$0}' docs/knowledge/l3-components/Ledger技术文档.md
L26: ## 2. 构造参数与依赖
L31: ## 3. 核心方法签名
L40: ## 4. 执行流程
L45: ## 5. 状态机
L50: ## 6. 并发与线程模型
L55: ## 7. 边界条件
L60: ## 8. 代码示例
L65: ## 9. 已知缺陷与注意事项
```
（`Routes技术文档.md` 同项检查为空，无此问题。）多数 Markdown 渲染器会容错，故定级轻微。

---

### 6.7 【轻微】工作记录中「未确认」标注计数与实际不符

| 位置 | 问题 | 规则依据 | 建议修法 |
|---|---|---|---|
| `docs/worklog/2026-09-22-knowledge-base.md:133` | 声称「全库当前共 **14 处**」并列出分布（Sidebar 3、Index 2、Ledger-持久化与并发 2、Routes-路径校验与安全边界 2、其余 5 篇各 1） | AGENTS.md §6「验证证据」应可复现 | 按**出现次数**（15 次）而非**行数**（14 行）表述，或注明口径 |

**佐证命令与结果**：
```
$ grep -rc "未确认" docs/knowledge/l3-components/*.md   # 按行计数
Client 1, Git 1, Index 2, Ledger-持久化与并发 2, Projects 1,
Routes-快照组装与台账 1, Routes-路径校验与安全边界 2, Sidebar 3, Types 1  => 合计 14 行
$ grep -rho '未确认' docs/knowledge/l3-components/*.md | wc -l   # 按次数计数
15
```
差异源于某文件同一行出现 2 次。**分布本身正确**，仅总数口径含糊。该文件属只读范围，本次未改动。

---

## 7. 命名约定符合性（逐文件判定）

| 层级 | 规则（R12） | 文件 | 判定 |
|---|---|---|---|
| L1 | `<module-or-domain>-knowledge-base.md` | `l1-architecture/worktree-groups-knowledge-base.md` | ✅ 合规 |
| L2 | `<ModuleName>模块技术文档.md` | `l2-modules/ServerHost模块技术文档.md` | ✅ 合规 |
| L2 | 同上 | `l2-modules/WebClient模块技术文档.md` | ✅ 合规 |
| L2 | 同上 | `l2-modules/TreeModel模块技术文档.md` | ✅ 合规 |
| L3 单文件 | `<ClassName>技术文档.md` | `l3-components/Client技术文档.md` | ✅ 合规 |
| L3 单文件 | 同上 | `l3-components/Git技术文档.md` | ✅ 合规 |
| L3 单文件 | 同上 | `l3-components/Index技术文档.md` | ✅ 合规 |
| L3 单文件 | 同上 | `l3-components/Locales技术文档.md` | ✅ 合规 |
| L3 单文件 | 同上 | `l3-components/Projects技术文档.md` | ✅ 合规 |
| L3 单文件 | 同上 | `l3-components/Sidebar技术文档.md` | ✅ 合规 |
| L3 单文件 | 同上 | `l3-components/TreeModel技术文档.md` | ✅ 合规 |
| L3 单文件 | 同上 | `l3-components/Types技术文档.md` | ✅ 合规 |
| L3 概览 | `<ClassName>技术文档.md` | `l3-components/Routes技术文档.md` | ✅ 合规 |
| L3 概览 | 同上 | `l3-components/Ledger技术文档.md` | ✅ 合规 |
| L3 子文档 | `<ClassName>-<功能>技术文档.md` | `l3-components/Routes-路由注册与契约技术文档.md` | ✅ 合规 |
| L3 子文档 | 同上 | `l3-components/Routes-路径校验与安全边界技术文档.md` | ✅ 合规 |
| L3 子文档 | 同上 | `l3-components/Routes-快照组装与台账技术文档.md` | ✅ 合规 |
| L3 子文档 | 同上 | `l3-components/Ledger-数据模型与接口技术文档.md` | ✅ 合规 |
| L3 子文档 | 同上 | `l3-components/Ledger-持久化与并发技术文档.md` | ✅ 合规 |
| 索引 | — | `README.md` | ✅ 合规（skill 未规定索引文件名） |

**判定命令**：
```
$ ls docs/knowledge/l1-architecture/ | grep -vE '^.+knowledge-base\.md$'   # 空
$ ls docs/knowledge/l2-modules/     | grep -vE '^.+模块技术文档\.md$'      # 空
$ ls docs/knowledge/l3-components/  | grep -vE '^.+技术文档\.md$'          # 空
```
**结论：20/20 全部合规，无不合规项。**

**另核对 SKILL.md:238「Save location」**：L1 落在 `l1-architecture/`、L2 落在 `l2-modules/`、L3 落在 `l3-components/`，三层目录归属**全部正确**。

---

## 8. 总索引完整性与权威链接计数

### 8.1 索引覆盖的「恰好性」（双向差集）

自写脚本将磁盘 19 篇正文的相对路径集合与 `docs/knowledge/README.md` 中提取的链接目标集合做双向差集：

| 检查 | 结果 |
|---|---|
| 磁盘正文（不含索引自身） | **19** 篇 |
| README 中不同的 `.md` 链接目标 | **19** 篇 |
| **磁盘有、索引缺（遗漏行）** | **0**（NONE） |
| **索引有、磁盘无（多余行）** | **0**（NONE） |

**三张层级表的行数与磁盘逐层计数**：

| 层级 | 磁盘实际 | README 表数据行 | 目录树标注 | 判定 |
|---|---|---|---|---|
| L1 架构 | 1 | 1 | 「**1 篇**」 | ✅ 一致 |
| L2 模块 | 3 | 3 | 「**3 篇**」 | ✅ 一致 |
| L3 组件 | 15 | 15 | 「**15 篇**」 | ✅ 一致 |
| 合计 | **19** | 19 | 「共 **19 篇**」＋「合计：1+3+15 = **19 篇**」 | ✅ 一致 |

- README 头部第 11 行「文档总数: **19 篇**（不含本索引自身；L1 架构 1 篇 + L2 模块 3 篇 + L3 组件 15 篇）」——**算术与磁盘均正确**。
- 目录树（第 76–102 行）L3 条目计数为 **15**，逐条与磁盘文件名一一对应（含 `Routes技术文档.md`、`Ledger技术文档.md` 均标注「（概览）」，符合 R16 第 7 条「概览文档和所有子文档都需在 README 中单独列出」）。
- **R16 第 6 条「不重排既有条目」**：L3 表与目录树均按「Client/Git/Index/Ledger…/Types」**字母序稳定排列**，无穿插重排痕迹。✅

### 8.2 「快速检索」小节

| 检查 | 结果 |
|---|---|
| 数据行数 | **12** 行（问题类型 → 建议阅读顺序） |
| 覆盖的**不同**文档数 | **19 / 19**（全库 19 篇正文均至少被一条检索路径引用） |
| 质量抽检 | 覆盖「插件装配」「HTTP 路由与校验」「会话分组」「拖拽落库」「运行态顶部区」「台账持久化」「文案本地化」「git 封装」「类型契约」「客户端抢槽位」「快照组装」「模块边界」12 类典型问题，每行给出 2–3 篇的有序阅读链，**层级顺序合理**（先概览/入口，再细节） |

✅ **通过**。

### 8.3 权威链接计数（自写脚本产出，不沿用他人数字）

**脚本**：`/tmp/kbrev/linkcheck.mjs`（遍历 `docs/knowledge/` 全部 20 篇 md，正则提取 `[..](..)`，排除 `http(s):` 等外部 scheme，用 `fs.existsSync` 校验目标文件）

```
$ node /tmp/kbrev/linkcheck.mjs
files scanned: 20
relative links (incl. anchors, excl. pure "#..."): 307
resolved OK: 307
broken: 0
```

| 口径 | 计数 | 说明 |
|---|---|---|
| **相对链接总数（权威口径）** | **307** | 含带锚点的跨文件链接，不含纯页内 `#...` |
| 校验通过 | **307** | |
| **断链** | **0** | **断链清单为空** |
| 纯页内锚点 `[..](#..)` | 147 | 见下 |
| 全部内联链接（含页内锚点） | 454 | = 307 + 147 |
| 去重后「源文件 → href」对数 | 138 | |
| 去重后解析到的目标文件数 | 24 | 含 `docs/` 下 5 篇非知识库文档 |
| 指向 `docs/knowledge/` 之外的链接 | 19 | 指向 `docs/README.md`、`PRD.md`、`INTERFACES.md`、`HOST-CONTRACTS.md` |

**页内锚点校验**（脚本 `/tmp/kbrev/anchors2.mjs`，按 **GitHub slug 算法**：小写、去 markdown 标记与标点、**空格转 `-` 但不折叠连续空格**）：

```
$ node /tmp/kbrev/anchors2.mjs
in-page anchors (GitHub slug algo, spaces NOT collapsed): 147, resolved: 147, unresolved: 0
```

> **方法论校正记录（重要）**：首轮锚点脚本把连续空格折叠为单个 `-`，误报 1 条「未命中」——`Routes-路径校验与安全边界技术文档.md:40 -> #2-目标路径与符号链接校验d5--d-n2`。逐字节比对（`hexdump`）确认：标题 `## 2. 目标路径与符号链接校验（D5 / D-N2）` 中 `D5 / D-N2` 的斜杠被删除后**留下两个空格**，GitHub 算法据此产出双连字符 `d5--d-n2`，与链接锚点**完全一致**。改用正确算法后 **147/147 全部命中，无真实断链**。此处如实记录，以说明「未发现问题」是经过尝试与校正的结果。

**关于父代理/工作记录中 230/235/307/453 的口径差异**——本次独立复算给出对账表：

| 口径 | 数值 | 与权威口径的关系 |
|---|---|---|
| 全部内联链接（含 147 条页内锚点） | 454 | 权威 307 + 147 |
| 仅跨文件 `.md` 链接（无锚点） | 306 | 权威 307 − 1（唯一 1 条 `.md#锚点` 链接） |
| 排除纯锚点后的相对链接 | **307** | **本次权威口径** |
| 排除知识库总索引的 19 篇正文 | 383 | 含页内锚点 |
| 仅 L3 目录 | 222 | 含页内锚点 |
| 含省略号示例行的宽松 grep | ~453 | 与 453 相差 1，属正则边界差异 |

**结论**：`docs/worklog/2026-09-22-knowledge-base.md:105` 记录的「307 条相对链接，断链 0」**与本次独立复算完全一致**；父代理早期报告的 230/235 为更窄口径（未含总索引或未含某类链接），**307 为权威计数**。

---

## 9. 可导航性遍历结果

**方法**：自写 `/tmp/kbrev/reach2.mjs`（带环保护的 BFS）与 `/tmp/kbrev/dist.mjs`（分层 BFS 求最短跳数），从 `docs/README.md` 出发，沿全部相对 `.md` 链接遍历。

```
$ node /tmp/kbrev/dist.mjs
from docs/README.md — knowledge doc hop distances:
  1 hop(s): 2 docs
  2 hop(s): 18 docs
unreachable: NONE
```

| 检查 | 结果 |
|---|---|
| 从 `docs/README.md` 可达的 `.md` 总数 | **34** |
| 知识库文档总数 | **20** |
| **不可达的知识库文档** | **0（NONE）** |
| 遍历中遇到的断链 | **0** |
| 最大跳数 | **2 跳** |

**典型路径（最短链）**：
- `docs/README.md` → `docs/knowledge/README.md` → 任意 L2/L3 文档（**2 跳**）
- `docs/README.md` → `docs/knowledge/l1-architecture/worktree-groups-knowledge-base.md`（**1 跳**）

**关键入口核对**：`docs/README.md:63` 以「知识库总索引」为标题链接 `knowledge/README.md`，`:64` 直接链接 L1 文档，`:66-67` 说明 L2/L3 各层篇数，`:69` 声明「各层文档清单与链接统一维护在 [知识库总索引]」。**知识库确为「从总入口沿链接可达」**，符合 AGENTS.md §5。✅ **通过**。

---

## 10. 与仓库规范（AGENTS.md §5）一致性

| AGENTS.md §5 要求 | 检查方法 | 结果 |
|---|---|---|
| 除根 `AGENTS.md` 外，正文文档统一放 `docs/` | `ls *.md` | ✅ 根目录仅 `AGENTS.md`、`README.md`（后者为 §5 明示的存量豁免） |
| **不在源码目录**新建方案/报告/日志等正文文档 | `find src -name '*.md'` | ✅ 无任何命中（`src/` 下 11 个文件均为 `.ts`/`.tsx`/`.d.ts`） |
| **大型专题目录必须有自己的 `README.md`** | `test -f docs/knowledge/README.md` | ✅ 存在，111 行，含范围、阅读顺序与子文档入口 |
| **每份文档都能从总入口沿链接找到** | §9 BFS | ✅ 20/20 可达 |
| 大型内容必须建立索引 | README 三张层级表 + 快速检索 + 目录树 | ✅ 齐备 |
| 新增/移动/归档文档时同步更新总索引 | 双向差集（§8.1） | ✅ 缺 0 / 多 0 |
| 使用相对链接、清晰标题层级、状态与来源说明 | 链接脚本 + frontmatter 检查 | ✅ 307 条相对链接 0 断链；20 篇均带 `git-version` 锚点与生成/更新时间 |
| 不记录密钥、令牌或敏感数据 | 人工通读 4 篇 L1/L2 + 抽检 6 篇 L3 | ✅ 未发现凭据类内容 |
| 大型文档提供章节目录或独立主题索引 | 15 篇 L3 中 14 篇有 `## 目录` | ⚠️ 见 §6.6（Ledger 概览目录不可导航） |
| §5 提到 `reviews/` 目录用于审查记录 | `ls docs/reviews/` | ⚠️ **本报告为本目录首个文件**；`docs/README.md` 的「审查」区块（第 35–39 行）仅索引了根级 `REVIEW-*.md` 5 篇，**未索引 `docs/reviews/`** —— 建议主代理在本报告归档后补一行索引 |

---

## 11. 未能验证的项与报告自身局限

| # | 未能验证 / 局限 | 原因 |
|---|---|---|
| 1 | **未执行任何运行时验证**（`npm test`、`npm run build`、`npm run typecheck`） | 任务执行边界明令禁止；且本次为纯文档结构审查，无行为变更 |
| 2 | **未实际执行 skill 的 Step 2B 流程** | 该步骤需 `git log -1 --format=%H -- src/` 逐份比对；本次仅验证「frontmatter 位置是否可被标准解析器读取」，**未验证解析后锚点值与 `git-version` 的一致性**（该值已由工作记录第 103 行声明，本次未独立复算 `9bd9425` 与 `git log` 的对应关系） |
| 3 | **锚点算法为 GitHub slug 推断** | 无法在本环境启动渲染器验证。若目标渲染器（如 VS Code 预览、飞书文档）slug 规则不同，147/147 的结论可能变化；已按主流算法（不折叠空格）取正确结果 |
| 4 | **L3 模板内容深度仅抽检 5 篇** | 按任务要求抽 5 篇（`Index`、`Locales`、`Types`、`Git`、`Projects`）做内容级核对；其余 10 篇仅做**标题级**矩阵核对，**未逐段核对 N/A 原因的具体性**（但已逐篇扫描 `N/A` 关键词分布） |
| 5 | **未审查 L3 文档与源码的事实一致性** | 本次为「结构合规」审查，未逐条比对 L3 中的行号引用、签名原文与 `src/` 实际内容。仅对 L1/L2 的**可枚举事实**（文件数、行数、导出数、测试用例数、最大文件）做了核对 |
| 6 | **未审查 `docs/` 下 5 篇根级 `REVIEW-*.md` 与 2 篇 `RESEARCH-*.md`** | 不在本任务允许读取范围（仅 `docs/knowledge/`、`docs/README.md`、指定 worklog、`AGENTS.md`、skill 文件）；仅通过 `docs/README.md` 的索引情况间接观察（见 §10 末行） |
| 7 | **「未发现问题」项的尝试说明** | 海拔纪律的 4 篇 L1/L2 除 5 组规定 grep 外，另做了围栏内容深挖（逐围栏扫描标识符调用样式）、导出/内部符号比对、表格表头逐条判读；链接检查除规定脚本外，另做锚点逐字节比对与 5 种口径对账；命名检查除正则外另核对三层目录归属。**结论均建立在上述多次尝试之上，非单次 grep 空结果** |
| 8 | **`git status` 佐证的是「未跟踪」而非「未改动」** | `docs/knowledge/`、`docs/README.md`、`AGENTS.md` 在本仓库中均处于 `??`（untracked）状态，**git 无法提供内容级 diff 佐证**。故改用 **mtime 佐证**：20 篇知识库文档的最后修改时间为 `13:05:49`–`13:38:27`，本次审查执行时间为 `13:47:44`，**全部早于审查开始**，且审查期间无任何写入操作指向这些路径 |

---

## 12. 未修改被审查文件的佐证

```
$ git status --porcelain docs/knowledge docs/README.md AGENTS.md
?? AGENTS.md
?? docs/README.md
?? docs/knowledge/
```

（均为 untracked，无内容级 diff 可比，故补 mtime 佐证：）

```
$ find docs/knowledge -name '*.md' -exec stat -f '%Sm %N' -t '%Y-%m-%d %H:%M:%S' {} \; | sort | tail -3
2026-09-22 13:37:11 docs/knowledge/README.md
2026-09-22 13:38:27 docs/knowledge/l1-architecture/worktree-groups-knowledge-base.md
2026-09-22 13:47:44 (审查开始时间)
```

**全部 20 篇知识库文档的 mtime 均 ≤ `13:38:27`，早于本次审查开始时间 `13:47:44`。本次审查仅创建了 `docs/reviews/knowledge-base-structure-review.md` 一个文件，未触碰任何被审查文件。**

---

## 13. 结论与处置建议

### 13.1 问题分级汇总

| 严重度 | 数量 | 条目 |
|---|---|---|
| **严重**（违反硬规则） | **1 类 / 4 个文件** | §6.1 frontmatter 不在文件首（`TreeModel` L2、`WebClient` L2、`Client` L3、`TreeModel` L3） |
| **中等**（偏离模板） | **3 类 / 6 个文件** | §6.2 TreeModel L2 架构图列 11 个内部函数名；§6.3 4 篇 L3 子文档静默省略 21 处节位；§6.5 L1 一处「体量最大」事实错误 |
| **轻微**（风格/记录） | **3 类** | §6.4 `AGENTS.md` 缺 skill Step 2A 检索规则（需主代理决策）；§6.6 Ledger 概览标题空行与不可导航目录；§6.7 worklog「未确认」计数口径 |

### 13.2 建议修复优先级

1. **P0**：§6.1 —— 4 个文件的 frontmatter 上移至第 1 行。**纯位置调整，不改任何内容语义**，但直接决定 skill Step 2B 增量更新能否工作。
2. **P1**：§6.5 —— L1 第 128–130 行「体量最大」限定词修正（一句话改动，消除事实错误）。
3. **P1**：§6.2 —— TreeModel L2 架构图粒度收敛到「层名 + 职责」，去掉 11 个内部函数名。
4. **P2**：§6.3 —— 4 篇 L3 子文档补 21 处 `**N/A（见姊妹篇）**` 标注；并考虑为 Routes 层补一节真正的「核心方法签名」。
5. **P3**：§6.6 / §6.7 —— Ledger 概览排版与 worklog 计数口径。
6. **待决策**：§6.4 —— 是否在 `AGENTS.md` 追加 skill Step 2A 的知识库检索规则（超出本次审查写入范围）。

### 13.3 通过项总结（不因上述问题而否定）

- **海拔纪律**：4 篇 L1/L2 **零方法签名、零参数列表、零代码片段、零字段定义表** —— 核心分层纪律达标。
- **拆分规则**：20 篇全部 ≤500 行；Routes 概览 64 行、Ledger 概览 78 行，均 ≤80 行；概览 + 子文档索引 + 双向互链齐备。
- **命名约定**：20/20 完全合规，三层目录归属正确。
- **索引完整性**：三张表 + 快速检索 + 目录树**恰好覆盖 19 篇**，遗漏 0、多余 0，篇数标注全部一致。
- **链接完整性**：**307 条相对链接，断链 0**；147 条页内锚点全部命中。
- **可导航性**：从 `docs/README.md` 出发，**20/20 知识库文档全部可达，最多 2 跳**。
- **仓库规范**：无正文文档落在源码目录，知识库有独立 README，符合 AGENTS.md §5。

**总评**：知识库在**分层纪律、拆分形态、命名、索引与链接**五个结构维度上**质量达标**；唯一硬伤是 4 个文件的 frontmatter 位置（可机械修复），其余为模板机械偏离与个别事实/排版问题，**不影响知识库的可用性与导航完整性**。
