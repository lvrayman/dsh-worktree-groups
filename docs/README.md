# 文档总索引

本目录集中保存项目需求、设计、契约、调研、测试、审查与工作记录。协作规则见根目录 [AGENTS.md](../AGENTS.md)。

## 阅读顺序

1. 阅读协作规则，明确文档驱动与 TDD 流程。
2. 阅读 [PRD](PRD.md)，确定需求、范围和验收标准。
3. 按任务查阅 [接口契约](INTERFACES.md) 与 [宿主契约](HOST-CONTRACTS.md)。
4. 查阅相关历史调研、审查及工作记录，并核实是否适用于当前版本。

## 需求与契约

| 文档 | 用途 | 大型内容导航 |
| --- | --- | --- |
| [PRD](PRD.md) | 项目需求、决策、用户故事及验收 | §5 决策；§6 用户故事与验收；§8–9 宿主契约与修订；§10 交付状态；§11 后续 |
| [接口契约](INTERFACES.md) | 模块边界、类型、函数签名与契约裁定 | §1 宿主；§2 客户端；§2.5–2.7 依赖规则与裁定；§3 构建约束；§4 测试要求 |
| [宿主契约核实报告](HOST-CONTRACTS.md) | 宿主 API、插件接入约束与核实证据 | A 宿主服务；B 客户端；C 依赖与安装；D 结论；末尾硬约束与未确认项 |

以上导航对应原文标题与编号，保留原路径以免破坏现有引用。报告中的环境、版本和测试数字应按其记录时间理解，不能替代当前验证。

## 历史调研

| 文档 | 主题 |
| --- | --- |
| [运行状态与排序](RESEARCH-running-and-sort.md) | 子代理运行状态传播、新会话排序的数据源与可行方案 |
| [会话掉到侧栏底部](RESEARCH-session-drop-to-bottom.md) | 会话分区、手动排序、落底机制及修复候选 |
| [运行中任务高亮调研](research/2026-10-20-running-task-highlight-research.md) | T-1：容器行运行态的可复用数据、聚合口径冲突（含子代理）、视觉候选与测试边界 |
| [宿主能力核实](research/2026-10-20-host-capability-verification.md) | T-2：`useSessionStatus` 覆盖与频率、图标 `style` 不透传、主题变量真实值、快速刷新可行性、重启与截图限制 |

## 本次需求（2026-10-20）：运行中任务的图标高亮

| 文档 | 用途 |
| --- | --- |
| [需求与验收标准](requirements/2026-10-20-running-task-highlight.md) | 背景、用户已确认口径（RT1–RT6）、AC1–AC13、非目标 |
| [设计](design/2026-10-20-running-task-highlight.md) | 数据流、`hasRunningTasks` 语义与边界、渲染落点、`runningSignature` 与防抖、测试矩阵、人工验收 |
| [工作记录](worklog/2026-10-20-running-task-highlight.md) | T-3 决策与产物；T-4 实现记录；**T-7 补测与审查闭环**（F1–F9 处理、变异证据、视觉未验证） |
| [验证报告](testing/2026-10-20-running-task-highlight-verification.md) | T-5：自动可验证项实测（三组定向 + 全量）、M1–M7 变异、行号校正、视觉未验证声明 |
| [独立审查](reviews/2026-10-20-running-task-highlight-review.md) | T-6：F1–F13 发现与 §14 T-7 处理结果、对 T-5 证据链的复核意见、AC13 未验证 |
| [PRD §12](PRD.md) | 需求汇总、决策表、旧 Q1 裁决保留说明（`runningCount` 不变） |
| [契约 §2.2.1](INTERFACES.md) | `hasRunningTasks` 字段与口径；渲染/刷新接线见 §2.3 与 `runningSignature` 见 §2.3.2 |

## 本次需求（2026-10-21）：Workspace 删除、打开对话选中效果与侧栏底部「最近」分区

| 文档 | 用途 |
| --- | --- |
| [领域术语表（CONTEXT.md）](../CONTEXT.md) | `Workspace`、`Worktree`、`History Bucket`、`Delete Workspace`、`Remove Worktree`、`Active Conversation`、`Ungrouped`、`Recent Section` 定义 |
| [需求与验收标准](requirements/2026-10-21-workspace-delete-selection-recent.md) | 背景、用户已确认决策（WSR1–WSR6）、AC1–AC12、非目标 |
| [设计](design/2026-10-21-workspace-delete-selection-recent.md) | `currentSessionIdOf`、选中高亮、`RECENT_SESSION_LIMIT = 100` 与 `kind: 'recent'`、`POST /dsh-worktree-groups/workspace-remove` 与台账清理 |
| [工作记录](worklog/2026-10-21-workspace-delete-selection-recent.md) | 决策过程、TDD Red→Green 验证与产物记录 |
| [PRD §13](PRD.md) | 2026-10-21 需求汇总与 WSR1–WSR6 决策表 |

## 本次需求（2026-10-21）：移除工作区行的会话数显示

| 文档 | 用途 |
| --- | --- |
| [工作记录](worklog/2026-10-21-workspace-session-count-removal.md) | 需求、范围、Red→Green 证据与产物 |
| [PRD §14](PRD.md) | WSR7 决策：只移除工作区行的渲染，保留 `sessionCount` 数据与「最近」计数 |
| [契约 §2.3](INTERFACES.md) | 渲染层约束与 WSR7 AST 回归锁 |

## 本次缺陷修复（2026-10-22）：同位置「新建会话」保留未发送草稿

| 文档 | 用途 |
| --- | --- |
| [需求与验收标准](requirements/2026-10-22-new-session-draft-retention.md) | 缺陷复现、根因、DR1–DR5 决策与 AC1–AC9 |
| [设计](design/2026-10-22-new-session-draft-retention.md) | 宿主证据（草稿按会话 id 存、`connectBlank` 缺省铸新会话、`createInWorkspace` 按 cwd 复用）、数据流、§3.4 占位行置顶/锁拖（DR4/DR5）、测试矩阵与风险 |
| [工作记录](worklog/2026-10-22-new-session-draft-retention.md) | 根因核实、TDD Red→Green 证据、变更与验证结果；§6 为复验追加缺陷（「新会话」掉到最下面）的修复记录 |
| [PRD §15](PRD.md) | DR1–DR5 决策与非目标 |
| [契约 §2.2 / §2.3 / §2.4](INTERFACES.md) | `SAME_LOCATION_START_SESSION` 常量与 `options` 透传；`isCurrentBlankSession` / `isSessionDragLocked` 与占位行置顶、拖拽锁的 AST 回归锁 |
| [宿主契约 §B1.2](HOST-CONTRACTS.md) | `startSession(workspaceId, options?)` 的复用语义与证据行号 |

## 本次缺陷修复（2026-10-22）：侧栏拖拽排序在陈旧手动顺序表上静默失效

| 文档 | 用途 |
| --- | --- |
| [工作记录](worklog/2026-10-22-sidebar-reorder-stale-order.md) | 根因（持久表是首次拖拽快照，表外新增项 `reorderKeys` 直接返回 null）、DR6 决策、TDD Red→Green 证据与残余风险 |
| [契约 §2.2 / §2.3.1](INTERFACES.md) | `reconcileManualOrder` / `reorderManualScope` 签名与「commitDrag 三层必须走换算入口」约束 |
| [知识库 TreeModel / Sidebar](knowledge/README.md) | 定点修订：新增纯函数与 `commitDrag` 的换算入口 |

## 本次需求（2026-10-29）：「最近」分区按会话最后更新时间（任意活动）倒序

| 文档 | 用途 |
| --- | --- |
| [需求与验收标准](requirements/2026-10-29-recent-any-activity-sort.md) | 根因（`updatedAt` 只随用户发言推进）、RAS1–RAS5 决策、AC1–AC8、已知限制 |
| [设计](design/2026-10-29-recent-any-activity-sort.md) | 宿主 `session/event` 活动表、`lastActivityAt` 数据流、祖先传播、回退与边界、测试矩阵 |
| [工作记录](worklog/2026-10-29-recent-any-activity-sort.md) | 事实核实、TDD Red→Green 证据、变更与验证结果、宿主重载前置条件 |
| [PRD §16](PRD.md) | RAS1–RAS5 决策与非目标 |
| [契约 §1.1 / §1.7 / §2.3.3](INTERFACES.md) | `SessionRow.lastActivityAt`、`src/activity.ts` 导出契约、「最近」排序键与工作区树隔离 |
| [领域术语表](../CONTEXT.md) | `Recent Section` 排序口径改为 `lastActivityAt`（任意活动，回退 `updatedAt`） |

## 本次需求（2026-11-14）：整体性能优化 + 会话列表渐进式展开

| 文档 | 用途 |
| --- | --- |
| [需求与验收标准](requirements/2026-11-14-perf-progressive-expand.md) | 实测根因（`/tree` 0.7–1.4 s、双重扫盘、台账每次重写、30 s 缓存 + 30 s 轮询、abort 饥饿）、PX1–PX6、PERF1–PERF7、PX-AC1–AC6 |
| [设计](design/2026-11-14-perf-progressive-expand.md) | 会话列举缓存、合并器、git 指纹缓存、台账读缓存与节流、ETag/304、实时叠加层、单在途 reload、渐进式截断 |
| [工作记录](worklog/2026-11-14-perf-progressive-expand.md) | TDD Red→Green 证据、基准对比、变更文件、限制（宿主重启后服务端优化才生效） |
| [PRD §17](PRD.md) | PX1–PX6 决策 |
| [契约 §1.5 / §2.2 / §2.3 / §2.3.4](INTERFACES.md) | `/tree` 性能契约、more 行新字段与 `expandLevels`、reload 调度、`mergeLiveSessions` |

## 历史审查与复核

以下为不同阶段的审查记录，不代表本次重新验证或当前问题仍然存在。

| 文档 | 范围 |
| --- | --- |
| [运行状态与排序审查](REVIEW-running-and-sort.md) | 子代理运行状态与会话排序相关变更 |
| [顶部区审查](REVIEW-top-zone.md) | T5 顶部区排序规则的 T6 审查 |
| [修复定向验证](REVIEW-fix-verification.md) | T7 修复的 T8 复核 |
| [运行中顶部区复核](REVIEW-running-only-topzone.md) | T11 顶部区规则复核 |
| [最终验证](REVIEW-final-verification.md) | T14b 阶段最终复核 |

本次知识库工作的审查记录归档在 [`docs/reviews/`](reviews/)，与上述根级历史审查性质不同，单独索引如下。

| 文档 | 范围 |
| --- | --- |
| [知识库事实性审查](reviews/knowledge-base-fact-check.md) | T-REV-01：`docs/knowledge/` 全部 20 篇 md 的事实性核查（对照 `src/`、`test/` 与契约文档） |
| [知识库结构合规审查](reviews/knowledge-base-structure-review.md) | T-REV-02：`docs/knowledge/` 分层纪律、拆分规则、命名约定与索引/链接完整性审查 |

## 工作记录

| 日期 | 记录 |
| --- | --- |
| 2026-09-22 | [初始化仓库协作规范](worklog/2026-09-22-init-agents.md) |
| 2026-09-23 | [侧栏右键菜单渲染裸 key 缺陷修复](worklog/2026-09-23-sidebar-menu-raw-keys.md) |
| 2026-10-19 | [启用插件后侧栏整块渲染失败缺陷修复（宿主图标导出改名）](worklog/2026-10-19-sidebar-render-failure-icons.md) |
| 2026-10-20 | [运行中任务的文件夹 / worktree 图标高亮（文档/契约定稿）](worklog/2026-10-20-running-task-highlight.md) |
| 2026-10-21 | [Workspace 删除、打开对话选中效果与侧栏底部「最近」分区](worklog/2026-10-21-workspace-delete-selection-recent.md) |
| 2026-10-21 | [移除工作区行右侧的会话数显示](worklog/2026-10-21-workspace-session-count-removal.md) |
| 2026-10-22 | [同位置「新建会话」保留未发送草稿（复用空白会话）](worklog/2026-10-22-new-session-draft-retention.md) |
| 2026-10-22 | [手动顺序表陈旧导致侧栏拖拽排序静默失效](worklog/2026-10-22-sidebar-reorder-stale-order.md) |
| 2026-10-29 | [「最近」分区按会话最后更新时间（任意活动）倒序](worklog/2026-10-29-recent-any-activity-sort.md) |
| 2026-11-14 | [整体性能优化 + 会话列表渐进式展开](worklog/2026-11-14-perf-progressive-expand.md) |
| 2026-11-22 | [开源发布准备（信息脱敏、DSH 插件规范补齐、README 重构与 GitHub 发布）](worklog/2026-11-22-open-source-release.md) |
| 2026-11-22 | [dsh remote 控制远端机器 B 时侧栏切换显示机器 B 的 Worktree 工作区树](worklog/2026-11-22-remote-worktree-display.md) |
| 2026-11-24 | [单个会话归档修复与 DSH 原生会话右键菜单支持](worklog/2026-11-24-native-session-context-menu-and-archive.md) |

## 新增文档归档约定

- 需求：`requirements/`；设计：`design/`；重要决策：`decisions/`。
- 调研：`research/`；测试与验证：`testing/`；审查：`reviews/`。
- 所有工作的过程与结果：`worklog/`；失效内容：`archive/`，并标注替代入口。
- 上述目录按需创建。现有大写文件名保留，不在本次规范初始化中迁移。
- 单一主题单独维护；多主题长文按边界拆分，配套章节目录或专题索引。
- 大型专题建立自己的 `README.md`，在本总索引中链接该入口；新增、移动或归档文档时同步维护相关链接。
- 记录实际验证结果，区分当前规范、历史结论、未验证假设和待办事项。

## 知识库

代码知识库位于 `docs/knowledge/`，按**海拔模型**分三层组织：L1 高空俯瞰（域与模块全貌）、L2 中空巡航（模块职责与组件目录）、L3 地面细节（单类 / 单功能的完整实现）。海拔越高细节越少，实现细节只落在 L3，父层仅保留索引与链接。每份文档以 `git-version` / `git-module-path` 锚定代码版本，可支撑后续增量比对。

| 文档 | 用途 |
| --- | --- |
| [知识库总索引](knowledge/README.md) | 知识库唯一入口：L1/L2/L3 分层索引、按问题类型快速检索与目录树 |
| [worktree-groups 知识库（L1 架构总览）](knowledge/l1-architecture/worktree-groups-knowledge-base.md) | 高空俯瞰：域概述、四层架构分层、模块索引、跨模块流程与设计约定 |

- **L2 模块文档**（`docs/knowledge/l2-modules/`，3 篇）：宿主半边、浏览器端半边、树推导纯逻辑的模块级概览。
- **L3 组件文档**（`docs/knowledge/l3-components/`，18 篇）：单文件 / 单功能的实现、契约、边界条件与已知缺陷；Routes 与 Ledger 为「概览 + 子文档」拆分形态。

各层文档清单与链接统一维护在 [知识库总索引](knowledge/README.md)，新增或变动知识库文档时同步更新该索引。

知识库当前基于 `git-version` `9bd9425` 锚定；后续 `src/` 变更后应按各文档的 `git-module-path` 逐份重新锚定，不使用 `HEAD` 统一比对。建立过程见 [建立 worktree-groups 知识库](worklog/2026-09-22-knowledge-base.md)。

> 2026-09-23：因「侧栏右键菜单渲染裸 key」缺陷修复，对 Client / Locales / Sidebar / WebClient 四篇文档做了**定点修订**（锚点仍为 `9bd9425`，修订处已就地标注）；其余文档未复核。详见 [本次工作记录](worklog/2026-09-23-sidebar-menu-raw-keys.md)。

> 2026-10-22：因「同位置新建会话保留草稿」缺陷修复（及同日复验追加的「新会话掉到列表最下面」），对 L3 的 Client / Sidebar / TreeModel 三篇文档做了**定点修订**（`StartSessionOptions`、`SAME_LOCATION_START_SESSION`、`bridge.startSession` 第二参、`isCurrentBlankSession` / `isSessionDragLocked` 与 `emitContainer` 的占位行置顶；锚点仍为 `9bd9425`，修订处已就地标注）；其余知识库文档未复核。详见 [本次工作记录](worklog/2026-10-22-new-session-draft-retention.md)。

> 2026-10-29：新增 [Activity 技术文档](knowledge/l3-components/Activity技术文档.md)（`src/activity.ts`：`session/event` 活动表、LRU、祖先传播、`lastActivityAt`），并对 L3 的 Types / TreeModel / Routes-快照组装三篇做了**定点修订**（`SessionRow.lastActivityAt`、`recentActivityOf`、`buildSessionRows` 接线；锚点仍为 `9bd9425`，未逐行重锚）；其余知识库文档未复核。详见 [本次工作记录](worklog/2026-10-29-recent-any-activity-sort.md)。
