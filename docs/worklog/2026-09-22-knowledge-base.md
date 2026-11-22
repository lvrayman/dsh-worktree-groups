# 建立 worktree-groups 知识库

## 基本信息

- 日期：2026-09-22
- 主题：用 `/rl-kb-generator` + `/ai-work-dispatcher` 为 `dsh-worktree-groups` 从零建立代码知识库，并把知识库登记进 [文档总索引](../README.md)
- 状态：已完成
- 项目指纹：`typescript`（依据 `package.json`；无 `react-native` 依赖；源文件扩展名为 `.ts` / `.tsx`）
- git 锚点：`git-version` = `9bd94252dd934c2fa8491977285e461b703f0f3e`（`git log -1 --format=%H -- src/`）；`HEAD` = `8a3d0df`，该提交只改动 `test/`，不改变 `src/` 锚点
- 子代理路由：provider = `deepseek-official`，model = `anthropic/v_model/deepseek-v4-flash`；effort 按任务独立分档（大型 / 复杂源文件用 high，声明式小文件用 low）
- 阶段划分：Wave 1–4 建库（L1 / L2 / L3 / 索引）→ Wave 5 独立审查（`T-REV-01` / `T-REV-02`，两个全新子代理只读审查）→ Wave 6 返工（`T-FIX-03` / `T-FIX-04` / `T-FIX-05` / `T-FIX-06`，其中 `T-FIX-04` 一度 blocked，由 `T-FIX-06` 收口）→ 冻结后全库最终验收扫描
- 本文档更新说明：**2026-09-22 由 `T-DOC-02` 补充审查与返工阶段事实**。原有 6 个小节及其既有内容全部保留，本次只做补充与订正；凡被本次工作推翻的旧表述，均在原处改写并注明「本次更新所致」

## 目标与范围

**需求来源**：用户要求用 `/rl-kb-generator` 为本仓库建立知识库，并用 `/ai-work-dispatcher` 把全部实现工作派发给子代理；主代理只做规划、拆解、派工与验收。

**范围**：`src/` 全域（11 个源文件，共 8610 行），产出按海拔模型分层的知识库文档，并把知识库挂入文档总索引。

**验收标准**：

1. 知识库覆盖 `src/` 全域，按 L1 / L2 / L3 三层组织，且有唯一的总入口。
2. 每份文档以 `git-version` / `git-module-path` 锚定代码版本，可支撑后续增量比对。
3. 每份文档行数 ≤ 500 行（超出即拆分）。
4. 全库相对链接无断链；不引入外部图片依赖。
5. L1 / L2 遵守海拔纪律：不出现方法签名、代码片段等 L3 级细节。
6. 知识库可从 [文档总索引](../README.md) 沿链接找到。
7. 本项工作留下符合 [AGENTS.md](../../AGENTS.md) §6 的持久化工作记录。

**非目标**：

- 不修改任何源码或测试（本次为纯文档工作，`src/`、`test/`、`lib/` 全部只读）。
- 不改动 `docs/PRD.md`、`docs/INTERFACES.md`、`docs/HOST-CONTRACTS.md` 的既有正文。
- 不执行构建与测试（派工契约禁止子代理运行 `npm run build` / `npm test`）。
- 不在源码目录或仓库根目录新建正文文档。

**相关链接**：[文档总索引](../README.md)、[AGENTS.md](../../AGENTS.md)、[需求主文档](../PRD.md)、[接口契约](../INTERFACES.md)、[宿主契约核实报告](../HOST-CONTRACTS.md)。

## 计划与决策

**执行步骤**：先做项目指纹检测与全域调研 → 建立 L1 架构总览 → 拆 L2 模块文档 → 逐组件拆 L3 文档 → 对超限文档返工拆分 → 汇总总索引 → 登记总索引并留痕。全部实现工作由子代理承担，主代理负责定档、定边界与验收。

**关键取舍与理由**：

1. **海拔模型 L1 / L2 / L3**：L1 只看域与模块全貌，L2 看模块职责与组件目录，L3 看单类 / 单功能的完整实现。海拔越高细节越少，父文档只保留索引与一句话摘要，实现细节一律下沉到 L3，避免同一事实在多处复制后失同步。
2. **全量范围决策**：`src/` 仅 11 个文件、8610 行，规模允许一次性覆盖全域，因此不做抽样，避免知识库出现「未覆盖区域」而无法作为检索入口。
3. **不新建 `CLAUDE.md`**：本仓库已有 [AGENTS.md](../../AGENTS.md) 作为代理入口，再建一份 `CLAUDE.md` 会产生两个入口并随时间漂移。知识库检索入口统一由 `AGENTS.md` §2「开始工作前」与 [文档总索引](../README.md) 承担。
4. **git-version 锚定策略**：每份文档独立以 `git log -1 --format=%H -- <git-module-path>/` 锚定，**不使用** `git rev-parse HEAD` 统一比对；否则 `test/` 等无关提交会造成全库误判「需更新」。本库 `git-module-path` 统一为 `src`。
5. **500 行拆分规则**：超过 500 行即拆为「概览 + 子文档」，概览只留全局特性与子文档索引。本次触发两处：Routes 子文档曾达 584 行、Routes 概览曾达 140 行，由返工任务 `T-FIX-01` 处理。
6. **Routes 与 Ledger 的拆分形态**：两者均采用「概览 + 子文档」，因为单文件规模（`src/routes.ts` 1679 行、`src/ledger.ts` 292 行但语义跨度大）在一个主题内无法同时满足 500 行上限与「一份文档一个主题」。
7. **子代理路由与 effort 分档**：模型固定为 `deepseek-official` / `anthropic/v_model/deepseek-v4-flash`，effort 逐任务独立定档而非全局固定——大型 / 复杂源文件用 high，声明式小文件（词条表、类型清单、声明式装配点）用 low，取「最低充分档」。low / high 两个组合在本次调用内均经真实微型探测通过后方投入业务使用。
8. **整合与返工同样派工**：冲突修复与超限拆分不回流主代理，`T-FIX-01` 即为此类返工任务。

## 执行与产物

### 任务清单

共 **25** 个任务 ID，全部 completed：10 个 L3 + 1 个 Routes 拆分返工（`T-FIX-01`）+ 3 个 L2 + 1 个 L1 + 1 个知识库索引 + 1 个 worklog 首版 + 1 个 L1 注记修正（`T-FIX-02`）+ 2 个独立审查 + 4 个返工 + 1 个工作记录更新（`T-DOC-02`）。

> **口径订正（本次更新所致）**：原记录写「共 16 个任务 ID」，只覆盖到 Wave 4 建库阶段。`T-DOC-02` 把 Wave 5 审查（2 个）与 Wave 6 返工（4 个）补入后，表中曾列出 **24 个**唯一任务 ID（原表 17 个 ID，扣除原 `T-FIX-01` 后为 16 个建库期任务，再加 `T-REV-01` / `T-REV-02` / `T-FIX-03`~`06` 与 `T-DOC-02`）；本次订正补入遗漏的 `T-FIX-02`，该表现为 **25 行**。
>
> **计数订正（本次更新所致）**：`T-DOC-02` 曾按派工摘要写「全部 22 个任务 ID」，又把摘要自身的分类枚举之和 24 当成需要父代理裁定的不一致，并据此推断该编号在仓库内检索无命中、进而认为摘要所称「1 个 L1 注记修正」没有对应 ID。**该「22」是父代理派工摘要自身的计数错误，正确总数为 25**；`T-FIX-02` 是**真实存在**的任务，只是从未被写入本工作记录。事实为：`T-FIX-02`（任务名 `Fix stale L1 note`，effort = **low**，子代理 ID `9eee8e24`）修正 [L1 架构总览](../knowledge/l1-architecture/worktree-groups-knowledge-base.md) 文末已过时的 4 行「未确认」块引用（改为指向知识库总索引的真实链接），该文件由 311 行变为 308 行。本次已把该任务补入任务清单表，并把总数、分类枚举与本处说明一并订正为 25，删除了原先与事实相反的推断。

| 任务 ID | 产物路径 | 行数 | effort |
| --- | --- | --- | --- |
| T-L1-01 | [worktree-groups 知识库（L1 架构总览）](../knowledge/l1-architecture/worktree-groups-knowledge-base.md) | 308 | high |
| T-L2-01 | [ServerHost 模块技术文档](../knowledge/l2-modules/ServerHost模块技术文档.md) | 272 | high |
| T-L2-02 | [WebClient 模块技术文档](../knowledge/l2-modules/WebClient模块技术文档.md) | 299 | high |
| T-L2-03 | [TreeModel 模块技术文档](../knowledge/l2-modules/TreeModel模块技术文档.md) | 309 | high |
| T-L3-01 | [TreeModel 技术文档](../knowledge/l3-components/TreeModel技术文档.md) | 499 | high |
| T-L3-02 | [Routes 技术文档](../knowledge/l3-components/Routes技术文档.md) + [路由注册与契约](../knowledge/l3-components/Routes-路由注册与契约技术文档.md) + [路径校验与安全边界](../knowledge/l3-components/Routes-路径校验与安全边界技术文档.md) + [快照组装与台账](../knowledge/l3-components/Routes-快照组装与台账技术文档.md) | 64 / 375 / 320 / 469 | high |
| T-L3-03 | [Sidebar 技术文档](../knowledge/l3-components/Sidebar技术文档.md) | 410 | high |
| T-L3-04 | [Projects 技术文档](../knowledge/l3-components/Projects技术文档.md) | 407 | high |
| T-L3-05 | [Git 技术文档](../knowledge/l3-components/Git技术文档.md) | 460 | high |
| T-L3-06 | [Ledger 技术文档](../knowledge/l3-components/Ledger技术文档.md) + [数据模型与接口](../knowledge/l3-components/Ledger-数据模型与接口技术文档.md) + [持久化与并发](../knowledge/l3-components/Ledger-持久化与并发技术文档.md) | 78 / 313 / 279 | high |
| T-L3-07 | [Client 技术文档](../knowledge/l3-components/Client技术文档.md) | 476 | high |
| T-L3-08 | [Locales 技术文档](../knowledge/l3-components/Locales技术文档.md) | 305 | low |
| T-L3-09 | [Types 技术文档](../knowledge/l3-components/Types技术文档.md) | 395 | low |
| T-L3-10 | [Index 技术文档](../knowledge/l3-components/Index技术文档.md) | 306 | low |
| T-FIX-01 | Routes 概览与 3 篇子文档的返工拆分（同上 4 个路径） | 64 / 375 / 320 / 469 | high |
| T-IDX-01 | [知识库总索引](../knowledge/README.md) | 111 | high |
| T-DOC-01 | 本工作记录 `docs/worklog/2026-09-22-knowledge-base.md`（首版 141 行） | 141 | high |
| T-FIX-02 | L1 架构文档文末已失效的「未确认」注记修正（改为指向知识库总索引的真实链接） | 308 | low |
| T-REV-01 | [知识库事实性审查报告](../reviews/knowledge-base-fact-check.md) | 376 | high |
| T-REV-02 | [知识库结构合规独立审查报告](../reviews/knowledge-base-structure-review.md) | 597 | high |
| T-FIX-03 | 4 篇文档 frontmatter 上移至文件首 + TreeModel L2 架构图去内部函数名 + TreeModel L3 两处轻微表述 | 499 / 309 / 476 / 299 | high |
| T-FIX-04 | 5 篇文档事实订正（L1 体量最大 / Locales 计数 / ServerHost 静态 import / Projects 越界引用 / Types 注释区间）—— 状态一度 blocked，由 `T-FIX-06` 收口 | 308 / 305 / 272 / 407 / 395 | high |
| T-FIX-05 | [AGENTS.md](../../AGENTS.md) §2 追加知识库检索规则（+1 行）+ [文档总索引](../README.md) 追加 `docs/reviews/` 索引（+7 行） | 101 / 78 | low |
| T-FIX-06 | [Ledger 技术文档](../knowledge/l3-components/Ledger技术文档.md) 概览目录改为单行全链接（10/10 锚点可点击） | 78 | low |
| T-DOC-02 | 本工作记录 `docs/worklog/2026-09-22-knowledge-base.md`（本次更新，补充 Wave 5/6 与最终验收） | 见下方验证证据 | high |

> 表中行数为**冻结后最终值**，由 `T-DOC-02` 于 2026-09-22 用 `wc -l` 对 20 篇知识库文档逐篇复测所得（合计 6455 行）。`T-FIX-05` 的 101 / 78 为 `AGENTS.md` 与 `docs/README.md` 的最终行数，非知识库文档。
>
> 逐任务 effort 的原始派工参数不在仓库内，本列按父代理声明的分档规则（大型 / 复杂文件 high、声明式小文件 low）结合任务源文件规模推定；`T-DOC-01` / `T-DOC-02` 的 high 为实际执行参数。

**Wave 6 各返工任务的行数变化（本次更新补充）**：`T-FIX-03` 涉及的 4 篇在修复后分别为 TreeModel L3 499、TreeModel L2 309、Client 476、WebClient 299；`T-FIX-04` 涉及的 5 篇分别为 L1 308、Locales 305、ServerHost 272、Projects 407、Types 395；`T-FIX-06` 收口后 Ledger 概览仍为 78 行（未增行）。

### 分层产物清单

- **L1（1 篇）**：`docs/knowledge/l1-architecture/` —— 域概述、四层架构分层、模块索引、跨模块流程、设计约定。
- **L2（3 篇）**：`docs/knowledge/l2-modules/` —— 宿主半边（`src/index.ts`、`src/routes.ts`、`src/projects.ts`、`src/git.ts`、`src/ledger.ts`、`src/types.ts`）、浏览器端半边（`src/client.tsx`、`src/sidebar.tsx`、`src/tree-model.ts`、`src/locales.ts`、`src/client-shims.d.ts`）、树推导纯逻辑（`src/tree-model.ts`）。
- **L3（15 篇）**：`docs/knowledge/l3-components/` —— Index、Routes（概览 + 3 子文档）、Projects、Git、Ledger（概览 + 2 子文档）、Client、Sidebar、TreeModel、Locales、Types。
- **总入口**：`docs/knowledge/README.md`（分层索引 + 按问题类型检索 + 目录树）。
- **文档总索引**：[文档总索引](../README.md) 末尾新增「知识库」小节（见下方验证证据）。

### 本任务自身的改动

- 新建 `docs/worklog/2026-09-22-knowledge-base.md`（本文件，首版 141 行）。
- 在 [文档总索引](../README.md) **末尾追加**「知识库」小节：既有 55 行一字未改（SHA-256 前后一致），文件由 55 行增至 71 行。
- **后续由 `T-FIX-05` 继续向 [文档总索引](../README.md) 追加 `docs/reviews/` 索引小节**（+7 行，纯追加），该文件最终为 78 行。

## 独立审查与返工

本节由 `T-DOC-02` 于 2026-09-22 补充，记录 Wave 5（独立审查）与 Wave 6（返工）阶段的任务、发现与处置。两个审查子代理与四个返工子代理均与写作任务无重叠，返工任务的文件所有权互斥。

### Wave 5：独立审查（2 个任务，只读）

| 任务 ID | 产物 | 行数 | 方法要点 | 结论 |
| --- | --- | --- | --- | --- |
| T-REV-01 | [知识库事实性审查报告](../reviews/knowledge-base-fact-check.md) | 376 | 行号引用 1333 处；去重 737 对全量越界校验（734 有效 / 3 越界）；抽样回读 66 处覆盖全部 10 个源文件（66/66 相符）；导出清单双向核对 95 个符号（遗漏 0 / 虚构 0）；签名核对 40 条（37 逐字一致 + 3 条散文正则伪命中，0 真实不一致）；绝对断言反证 8 条（1 条成功证伪） | **未发现任何虚构 API / 符号 / 文件**；问题 7 项（严重 0 / 中等 3 / 轻微 4） |
| T-REV-02 | [知识库结构合规独立审查报告](../reviews/knowledge-base-structure-review.md) | 597 | 以 `rl-kb-generator` 的 `SKILL.md` 与 `references/level-templates.md` 为规则基线，逐条复核海拔纪律、拆分、命名、索引、链接、导航 | 问题 7 类（严重 1 类 / 4 文件、中等 3 类、轻微 3 类）；**核心结构维度（分层纪律、拆分、命名、索引、链接、导航）全部通过** |

两个审查任务均**只读被审查文件**，唯一写入各自报告；审查期间未修改 `docs/knowledge/`、`src/`、`test/`、`docs/README.md` 或 `AGENTS.md`。

**权威链接计数**：`T-REV-02` 自写脚本独立复算得 **463 条相对链接（含锚点）、断链 0**；父代理在冻结后用修正后的 GitHub slug 算法独立复算，**463/463 命中**。`T-DOC-02` 再次独立复算：463 条 = 307 条文件目标链接 + 156 条纯页内锚点；文件目标断链 0，156 条页内锚点按 GitHub slug 算法（空格转 `-` 且**不折叠**）全部命中。

**审查过程中的自我校正（如实记录）**：`T-REV-02` 首轮链接脚本把连续空格折叠后误报 1 条断链，经 `hexdump` 逐字节比对确认为**脚本 bug**（GitHub slug 算法不折叠空格），审查方已自我校正并在报告中如实记录，非知识库缺陷。

### Wave 6：返工（4 个任务，文件所有权互斥）

| 任务 ID | 涉及文件数 | 修复内容 | 结果 |
| --- | --- | --- | --- |
| T-FIX-03 | 4 | 4 篇文档 frontmatter 不在文件首（违反 skill Step 2B 机读锚定）；TreeModel L2 架构图移除全部未导出内部函数名（移除后架构图内计数 0）；TreeModel L3 两处轻微表述 | completed，行数 499 / 309 / 476 / 299 |
| T-FIX-04 | 6 | L1「本域体量最大」事实错误（实测 `src/sidebar.tsx` 2895 行为最大）；Locales 文档 3 组命名空间计数错误；ServerHost 两处「全包唯一静态 import」错误；Projects 三处把 `test/` 行号误标为 `src/`；Types 一处 off-by-one 注释区间 | 状态一度 **blocked**，由 `T-FIX-06` 收口，最终 completed |
| T-FIX-05 | 2 | 按用户明确批准，向 [AGENTS.md](../../AGENTS.md) §2 追加知识库检索规则（纯追加 +1 行）；[文档总索引](../README.md) 追加 `docs/reviews/` 索引（纯追加 +7 行） | completed；两文件均以「剥离新增行后哈希回归基线」证明既有内容零改动 |
| T-FIX-06 | 1 | [Ledger 技术文档](../knowledge/l3-components/Ledger技术文档.md) 概览目录改为单行全链接（10/10 锚点可点击） | completed，行数保持 78 未增 |

**`T-FIX-04` blocked → `T-FIX-06` 收口过程**：`T-FIX-04` 原定处理 6 个文件的 5 类事实问题，其中 [Ledger 技术文档](../knowledge/l3-components/Ledger技术文档.md) 的概览目录条目属于「单行分隔式列表、9/10 项不可点击」问题，与其他 5 类事实订正性质不同且涉及目录结构改动。该任务因此进入 **blocked** 状态，未自行扩大范围。父代理随后**单独派发 `T-FIX-06`** 承接 Ledger 概览目录这一项（1 个文件、独占写入），并在保持 78 行不变的前提下把目录改为单行全链接。`T-FIX-06` 完成后，`T-FIX-04` 的剩余 5 篇事实订正亦全部落地，`T-FIX-04` 转为 completed。**处置结论**：blocked 未被静默吞掉，而是拆成「同性质事实订正」与「目录结构改动」两个独立任务分别收口，未越权、未回滚他人工作。

**返工的具体订正结果（`T-DOC-02` 冻结后复核）**：

| 原问题 | 修复后实测 |
| --- | --- |
| 4 篇 frontmatter 不在文件首 | 20/20 篇第 1 行均为 `---`（`head -1` 逐篇校验，违规 0） |
| TreeModel L2 架构图列未导出内部函数名 | 架构图（第 68–116 行）内部函数名 **0**；改列导出符号 |
| L1「本域体量最大」事实错误 | 全库 `本域体量最大` 命中 **0** |
| Locales 3 组命名空间计数错误 | `session*`(4)、`worktree.*`(20)、`menu.*`(9)，11 组之和 **50**，与 `src/locales.ts` 一致 |
| ServerHost 两处「全包唯一静态 import」 | 全库 `全包唯一` 命中 **0**；改为「全包无运行时静态 import：3 处」+「全包 3 处静态引入」（`src/index.ts:20`、`src/routes.ts:29`、`src/client.tsx:54`，均为 type-only） |
| Projects 三处 `test/` 行号误标为 `src/` | `src/projects.ts` 越界引用（>486 行）**0**；三处已改为 `test/projects.test.mjs:749 / 765 / 799` |
| Types 注释区间 off-by-one | 已由 `src/git.ts:236-241` 改为 `src/git.ts:237-247` |
| Ledger 概览目录不可导航 | 单行全链接，`#` 锚点链接 **10** 条 |
| `AGENTS.md` 缺 skill Step 2A 检索规则 | 已追加（[AGENTS.md](../../AGENTS.md) 第 19 行） |

**说明**：上表「TreeModel L2 架构图内部函数名 0」只针对**架构设计**小节。`T-REV-02` §6.2 所列、由 `T-FIX-03` 从架构图移除的那组内部函数名，在同一文档的「关键流程摘要」小节（第 191–248 行）仍有 **11 个名称 / 14 处出现**（架构图内 **0**），属下方「已接受的偏离」第 2 条，**明确不返工**。**口径订正（本次更新所致）**：该小节论述的对象是「内部函数名」，故主口径为**小节内全部内部函数名 = 11 个 / 14 处**；**10 / 13** 是「仅限架构图原清单那组名称」的**更窄口径**，仍如实保留为备选说明。`T-DOC-03` 复算时发现：内部名 `allSessionsOf` 系 `T-REV-02` 原始 11 名清单的**遗漏项**（已核实其确为 `src/tree-model.ts` 内部函数、非导出符号），补入后即得 11 / 14。


## 验证证据

以下检查均在本任务内实际执行；方法为只读命令与一次性 Python 脚本，未运行构建或测试。

### 建库阶段证据（Wave 1–4，`T-DOC-01` 记录）

| 检查项 | 方法 | 结果 |
| --- | --- | --- |
| 知识库文档数 | `find docs/knowledge -name '*.md'` | 20 个文件 = 19 篇正文 + 1 篇总索引 |
| 分层篇数 | `grep -rh '^level:' docs/knowledge/` | L1 × 1、L2 × 3、L3 × 15，与设计一致 |
| 行数上限 ≤ 500 | `find … \| xargs wc -l` | 全部通过，最大 499 行（[TreeModel 技术文档](../knowledge/l3-components/TreeModel技术文档.md)） |
| 超限返工结果 | 对 Routes 4 个路径 `wc -l` | 概览 64、路由注册 375、路径校验 320、快照组装 469；原 584 / 140 两处超限已消除 |
| git-version 锚定 | 逐文件比对 frontmatter 与 `git log -1 --format=%H -- src/` | 20 个 md 的 `git-version` 唯一值为 `9bd94252dd934c2fa8491977285e461b703f0f3e`（19 篇正文 + 总索引），与锚点精确一致；`git-module-path` 19 / 19 为 `src` |
| 无外部图片依赖 | `grep -rn '!\[' docs/knowledge/ \| wc -l` | 0 |
| 相对链接完整性 | 一次性 Python 脚本：遍历全部 md，提取 markdown 链接目标中的非 http / 非锚点项，用 `os.path.exists` 校验 | 20 篇共 307 条文件目标相对链接，**断链 0**（父代理记录的 230 条与本次 235 条差异来自计数口径：本次含总索引及其新增链接） |
| L1 / L2 海拔纪律 | `grep -c '^```'` + 方法签名样式正则 `\b\w+\([^)]*\)\s*:` | L1 围栏 0；L2 中 ServerHost 0、WebClient 0、TreeModel 1 处 ```text ASCII 架构图（非代码块）；L2 方法签名泄漏 0 命中 |
| 密钥 / 令牌 | `grep -rniE 'api[_-]?key\|secret\|token\|password\|bearer '` | 0 命中（本记录中唯一命中为其自身的检查说明行） |
| 本记录小节完整性 | `grep -c '^## '` | 建库阶段为 6（基本信息 / 目标与范围 / 计划与决策 / 执行与产物 / 验证证据 / 结果与后续）；`T-DOC-02` 新增「独立审查与返工」后为 7 |
| 本记录引用路径真实性 | 抽取正文全部仓库内路径（markdown 链接 + 反引号路径）逐个 `test -f` | 建库阶段唯一路径 43 个，`test -f` 通过 **43 / 43**；`T-DOC-02` 补充后为 40 个唯一仓库内路径，通过 **40 / 40**（见下方「最终验收」行） |
| 总索引纯追加 | 改动前 `cp` 备份 + `shasum -a 256` + 改动后 `diff` | 既有 55 行 SHA-256 均为 `19b41d79…5ed3b`，未变；`diff` 输出仅新增「知识库」小节（+16 行） |

### 最终验收（冻结后全库扫描，`T-DOC-02` 复核）

以下各项为**所有写者停止后**对冻结状态的复扫结果。链接、锚点、可达性与路径存在性由 `T-DOC-02` 用自写 Python 脚本独立复算。

| 检查项 | 方法 | 结果 |
| --- | --- | --- |
| 文档总数与总行数 | `find docs/knowledge -name '*.md' \| sort \| xargs wc -l` | **20 篇 / 6455 行** |
| 每篇行数上限 | 同上，逐篇判读 | **每篇均 ≤ 500 行**（最大 499 = [TreeModel 技术文档](../knowledge/l3-components/TreeModel技术文档.md)） |
| 概览行数上限 | 两个概览文件 `wc -l` | [Ledger 技术文档](../knowledge/l3-components/Ledger技术文档.md) **78**、[Routes 技术文档](../knowledge/l3-components/Routes技术文档.md) **64**，均 ≤ 80 |
| frontmatter 位置 | `for f in …; do head -1 "$f"; done` 逐篇判定 | **20/20 位于文件第 1 行**（违规 0） |
| git-version 精确一致 | `grep -rh '^git-version:' docs/knowledge/ \| sort \| uniq -c` | **20/20 精确等于** `9bd94252dd934c2fa8491977285e461b703f0f3e`（唯一值，计数 20） |
| 外部图片 | `grep -rn '!\[' docs/knowledge/ \| wc -l` | **0 处** |
| 相对链接（含锚点） | 自写 Python 脚本：正则提取 `[..](..)`，排除 http(s)/mailto，`os.path.exists` 校验文件目标 | **463 条全部命中、断链 0**；463 = 307 条文件目标 + 156 条纯页内锚点 |
| 页内锚点 | 自写 Python 脚本：按 **GitHub slug 算法**（小写、去标点、空格转 `-` 且**不折叠**）比对标题集合 | **156/156 命中，缺失 0** |
| 从总索引起可达性 | 自写 Python 脚本：从 [文档总索引](../README.md) 出发做带环保护 BFS | 知识库 **20/20 文档可达，无不可达项**（`docs/` 下共 36 篇 md 可达） |
| 已跟踪文件未被修改 | `git status --porcelain \| grep -cE '^(M\|A\|D\|R\|C)'` | **0**（无任何已跟踪文件被修改；输出仅 `??` 未跟踪条目） |
| 回归复核：frontmatter 违规 | `head -1` 逐篇 | **0** |
| 回归复核：架构图内部函数名 | 逐标识符 `grep -qE "^export (async )?(function\|const\|interface\|type\|class) $id\b" src/tree-model.ts` 判定，扫描 TreeModel L2 第 68–116 行 | **0**（「关键流程摘要」小节的 11 个内部函数名 / 14 处出现属已接受偏离，不计入本项） |
| 回归复核：「本域体量最大」 | `grep -rn '本域体量最大' docs/knowledge/ \| wc -l` | **0** |
| 回归复核：「全包唯一」 | `grep -rn '全包唯一' docs/knowledge/ \| wc -l` | **0** |
| 回归复核：Locales 计数和 | 读取 [Locales 技术文档](../knowledge/l3-components/Locales技术文档.md) 命名空间分组行求和 | `2+2+4+1+20+1+9+5+3+2+1` = **50**，与 `src/locales.ts` 的 50 个 key 一致 |
| 回归复核：Projects 越界引用 | `grep -oE 'src/projects\.ts:[0-9]+' … \| awk '$1>486'` | **0**（`src/projects.ts` 为 486 行） |
| 回归复核：Ledger 目录链接 | `sed -n '17p' … \| grep -oE '\[[^]]*\]\(#[^)]*\)' \| wc -l` | **10**（10/10 锚点可点击） |
| 本记录小节完整性 | `grep -c '^## '` | **7**（原 6 节 + 新增「独立审查与返工」） |
| 本记录任务 ID 完整性 | `grep -oE 'T-[A-Z0-9]+-[0-9]+' … \| sort -u` + 逐 ID `grep -c` | **表中实际列出 25 个唯一任务 ID，25/25 全部在正文出现**（`T-L1-01`、`T-L2-01`~`03`、`T-L3-01`~`10`、`T-FIX-01`、`T-IDX-01`、`T-DOC-01`、`T-FIX-02`、`T-REV-01`、`T-REV-02`、`T-FIX-03`~`06`、`T-DOC-02`）。派工摘要点名的全部类别（10 个 L3 + 1 个 Routes 拆分返工 + 3 个 L2 + 1 个 L1 + 1 个索引 + 1 个 worklog + 1 个 L1 注记修正 + 2 个审查 + 4 个返工 + 1 个工作记录更新）**每一类均有对应 ID，无遗漏**；摘要所称总数「22」为父代理自身计数错误，正确总数 **25**，已在「执行与产物」小节如实说明 |
| 本记录引用路径真实性 | 抽取正文全部路径引用（markdown 链接 + 反引号路径，`path:N` 形式剥离行号后）去重共 **44 个**，逐个 `test -f` | **仓库内路径 40 个，`test -f` 通过 40 / 40（0 缺失）**。其余 4 个为**非仓库内**引用，已单独说明：`CLAUDE.md`（本记录明确声明其**不存在**且决策为不新建）、`SKILL.md` / `references/level-templates.md` / 裸写 `level-templates.md`（属 `~/.agents/skills/rl-kb-generator/` 下的 skill 规则文件，位于仓库外，本次未核对其磁盘存在性，故不计入 `test -f` 分子分母） |
| 未越界写入 | 改动前后对独占范围外文件取 `shasum -a 256`；`git status --porcelain` | 仅 `docs/worklog/2026-09-22-knowledge-base.md` 被本次改动；`docs/knowledge/`、`docs/reviews/`、`docs/README.md`、`AGENTS.md`、`src/`、`test/`、`package.json` 均未改动（详见「未越界写入佐证」） |

**未执行的检查及原因**：

- `npm run build`、`npm test`、`npm run typecheck`：**未执行**。派工契约禁止子代理运行构建与测试；本次为纯文档变更，不触碰 `src/` 与 `test/`，构建产物 `lib/` 不受影响。
- TDD Red / Green：**不适用**。本次无行为变更，属 [AGENTS.md](../../AGENTS.md) §4 意义上的「不适用形式化单测」；替代验证为上述链接完整性、frontmatter 一致性、行数与海拔纪律检查。
- 运行时行为验证（如 `webServer` 后置热重载时序、跨进程并发写、`AbortSignal` 错误文案）：**未执行**，需真实宿主运行环境，见遗留事项。
- 联网核验宿主包内部实现（`@deepseek-ai/dsh-client-ui-*`）：**未执行**，本次禁止联网，故对宿主包内部实现的引用只能核对其在本仓库内的使用点。

### 未越界写入佐证

`T-DOC-02` 的独占写入范围只有 `docs/worklog/2026-09-22-knowledge-base.md` 一个文件。佐证方式：

1. 改动前后对全部禁改目标取 SHA-256 并比对：`docs/knowledge/` 下 20 篇、`docs/reviews/` 下 2 篇、`docs/README.md`、`AGENTS.md`、`docs/PRD.md`、`docs/INTERFACES.md`、`docs/HOST-CONTRACTS.md`、`src/`、`test/`、`package.json` —— 哈希全部一致。
2. `git status --porcelain | grep -cE '^(M|A|D|R|C)'` = **0**，即没有任何**已跟踪**文件被修改、新增、删除、重命名或复制。
3. 知识库与本次记录整体仍为工作区未跟踪状态（`git ls-files docs/knowledge` = 0），未做 `git add` / `git commit`。

## 结果与后续

**完成情况**：知识库已从零建立并通过**独立审查 + 返工 + 冻结后最终验收**——19 篇正文 + 1 篇总索引（20 篇 / 6455 行），三层结构完整，每篇行数 ≤ 500、两个概览 ≤ 80，20/20 frontmatter 位于文件第 1 行且 `git-version` 精确等于锚点，463 条相对链接（含 156 条页内锚点）全部命中、断链 0，从 [文档总索引](../README.md) 出发知识库 20/20 文档可达，L1 / L2 海拔纪律达标。知识库已登记进 [文档总索引](../README.md)，审查记录已归档到 `docs/reviews/` 并索引，本工作记录已留痕。

**审查与返工结论**：Wave 5 的 2 个独立审查未发现**任何虚构 API / 符号 / 文件**（严重级 0）；Wave 6 的 4 个返工任务把审查提出的可修问题全部闭合，其中 `T-FIX-04` 一度 blocked 后由 `T-FIX-06` 收口，未静默吞掉任何问题。剩余未闭合项分两类：**明确接受的偏离（3 条，不返工）** 与 **遗留事项（5 条，非知识库缺陷或已正确留痕）**，逐条列于下方。

**已知风险**：

- 知识库整体**尚未纳入 git 提交**（工作区未跟踪），当前只存在于本地工作区。
- 知识库内容基于 `9bd9425` 锚点，`HEAD` 已前进到 `8a3d0df`；后续 `src/` 变更需按 `git-module-path` 逐文件重新锚定，不能沿用 `HEAD` 统一比对。
- 多篇 L3 文档含需运行时验证才能结论化的「未确认」标注，当前只保证「代码可见事实」准确，不保证运行时语义。
- 3 条**已接受的偏离**（见下）意味着知识库与 `level-templates.md` 模板存在**有意保留**的机械偏离；后续若引入 markdownlint 或模板校验脚本，这些偏离需显式加入白名单，否则会被误报为违规。
- `T-REV-02` 首轮链接脚本曾因把连续空格折叠而误报 1 条断链，说明**链接/锚点校验脚本本身**存在出错风险；本次结论（463/463、156/156）由 `T-DOC-02` 用独立实现复算确认，但后续复算仍应优先使用 GitHub slug 算法（不折叠空格）。

**已接受的偏离（明确不返工，附理由）**：

1. **4 篇 L3 子文档省略部分模板小节且未逐条写 N/A**（共约 21 处节位）。理由：拆分后这些小节本就分散到姊妹文档，各篇引言已声明自身覆盖范围并互相链接，属「**非静默**」省略，读者不会被误导；强行补 21 处 N/A 只增加噪音，不增加信息量。故 `T-FIX-03`/`T-FIX-04` 均未处理该项。
2. **[TreeModel 模块技术文档](../knowledge/l2-modules/TreeModel模块技术文档.md)「关键流程摘要」保留 11 个内部函数名**（第 191–248 行，共 14 处出现；架构图已按 `T-FIX-03` 清理，架构图侧为 0）。理由：`references/level-templates.md` 的 L2 模板**明确要求**每条流程给出「主要参与类」链（模板原文第 226 行 `**主要参与类**: <Class1> → <Class2> → <Class3>`）；海拔禁令针对的是「方法签名、参数说明、代码示例、数据结构、状态转换细节」，组件**名称**不在其中；且 TreeModel 是单文件模块，若用文件名做粒度会退化为无意义的重复。已核实该段**无签名、无参数、无字段定义**，未泄漏 L3 细节。
3. **[Ledger 技术文档](../knowledge/l3-components/Ledger技术文档.md) 概览 9 个 `##` 标题前无空行**（目录已由 `T-FIX-06` 改为单行全链接、10/10 可点击）。理由：CommonMark 允许 ATX 标题中断段落，渲染结果正确；本仓库无 markdownlint / remark 配置，无强制规则依据；补空行会使该文件超出「概览 ≤ 80 行」硬约束（当前恰为 78 行）。

**遗留事项（仍未修复，如实保留）**：

1. [接口契约](../INTERFACES.md) §2.1 的 locales key 清单比 `src/locales.ts` 少 4 条：`worktree.menu`、`a11y.subagents`、`state.loadingTree`、`worktree.createTitle`。**审查补充事实**：§2.1 标题写的是「必须覆盖的 key（**最少集**）」（`docs/INTERFACES.md:296`），语义为**下界而非穷尽**，故严格说不构成错误；该差异已被三处正确留痕。属**契约文件滞后，非知识库缺陷**。现状：`worktree.menu` / `state.loadingTree` / `worktree.createTitle` 在 `docs/INTERFACES.md` 中 0 命中，`a11y.subagents` 仅出现 1 次且在 §2.6 的散文说明里，未进入 §2.1 key 清单。**尚未修复**。
2. [接口契约](../INTERFACES.md) §1.3 的 `BuildProjectsInput` 契约片段缺 `liveWorkspacePaths` 字段，而该字段已存在于 `src/projects.ts`（第 72 行声明、第 164 行注释说明、第 210 行消费）。现状：`docs/INTERFACES.md` 中 `liveWorkspacePaths` 0 命中；知识库侧已正确标注为「未确认项」。**尚未修复**。
3. `src/projects.ts` 第 1 行存在死导入 `resolve`：`import { basename, dirname, resolve } from 'node:path'`，而 `resolve` 在全文仅出现于该导入行，调用点 0。知识库侧已准确记录。**尚未修复**（本次为纯文档任务，禁改 `src/`）。
4. 多篇 L3 文档中的「未确认」**运行时待验证项**：全库共 **15 处出现 / 14 行**，分布在 `Sidebar` 3、`Index` 2、`Ledger-持久化与并发` 2、`Routes-路径校验与安全边界` 2、`Client` / `Git` / `Projects` / `Types` / `Routes-快照组装与台账` 各 1，涉及 `webServer` 后置热重载时序、跨进程并发写、`AbortSignal` 错误文案、符号链接安全姿态等。**口径订正（本次更新所致）**：原记录写「全库当前共 14 处」，未说明口径；`T-REV-02` §6.7 指出该数字按**行数**计为 14、按**出现次数**计为 15（差异源于某文件同一行出现 2 次）。分布本身正确，现已按两个口径同时标注。
5. 知识库与本次工作记录**均未纳入 git 提交**（工作区 untracked，`git ls-files docs/knowledge` 为 0）。`docs/reviews/` 下的 2 份审查报告、`docs/README.md`、`AGENTS.md` 同样处于未跟踪状态。

> **已由本次工作闭合、不再列为遗留的事项**：[AGENTS.md](../../AGENTS.md) §2 的知识库检索规则已由 `T-FIX-05` 追加（第 19 行）；`docs/README.md` 已由 `T-FIX-05` 追加 `docs/reviews/` 索引小节。原记录遗留事项第 6 条（「尚未包含显式的 `docs/knowledge/` 知识库检索规则句，需单独派工」）**已闭合**，此处改写并注明为本次更新所致。`CLAUDE.md` 仍不存在，决策仍为不新建。

**本任务执行期间由并行任务消解的事项**（记录时点在 2026-09-22 13:35–13:39，与本任务并行）：

- 父代理摘要提到的「[L1 架构总览](../knowledge/l1-architecture/worktree-groups-knowledge-base.md) 末尾保留过期『未确认』注记、未链接总索引」已不复存在：复扫该文档「未确认」命中 0，且其「相关文档」一节已含指向 `../README.md` 的知识库总索引链接。该变动由并行任务完成，非本任务产物（L1 属禁改范围）。
- [ServerHost 模块技术文档](../knowledge/l2-modules/ServerHost模块技术文档.md) 的「相关文档」一节已补上指向 L1 的链接，父代理摘要中「L2 尚未回链 L1」的缺口已闭合；同样由并行任务完成。
- 受上述并行改动影响，L1 与 L2 三篇的行数在 `T-DOC-01` 执行期间发生了变化（L1 311 → 308、ServerHost 269 → 270、WebClient 300 → 299、TreeModel 312 → 311）。上表「执行与产物」记录的是**冻结后的最终值**；全部仍满足 ≤ 500 行上限。
- **上述并行改动之后**，Wave 6 的 `T-FIX-03` / `T-FIX-04` 又对同批文档做了定稿修改，故最终行数为 L1 308、ServerHost 272、TreeModel L2 309、WebClient 299、TreeModel L3 499、Client 476（与 `T-DOC-01` 当时的快照不同，以本次表格为准）。

**后续建议**（非本次范围，需另行派工）：① 修复 `docs/INTERFACES.md` 的两处滞后（§2.1 最少集补注、§1.3 补 `liveWorkspacePaths`）；② 清理 `src/projects.ts:1` 死导入；③ 把知识库、审查报告与本工作记录纳入 git 提交；④ 如需要，为 Routes 层补一节真正的「核心方法签名」。

