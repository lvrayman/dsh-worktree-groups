# PRD：dsh-worktree-groups

> DSH 侧栏按 git worktree 分组的插件
> 状态：已定稿（21 项决策全部由用户拍板） | 日期：2026-09-21

## 1. 背景与问题

DSH 原生侧栏（`@deepseek-ai/dsh-client-ui-workspace`，占据 `sidebar.workspaces`）把**每个 dsh 工作区**渲染成一个平级分组，工作区之间没有"属于同一个 git 仓"的概念。

对并行开发的实际影响（用户机器上的真实数据）：

| 工作区 | 分支 | 会话数（成员账本 `sessionIds`） |
|---|---|---|
| `/Project/Workspace/MyProject` | develop（主仓） | 34 |
| `/Project/Workspace/MyProject-ohos` | feature/ohos（其 worktree） | 2 |

> 这两个数字取自 `workspace.json` 的 `sessionIds`（**成员关系账本**，含已归档）。它与会话文件的实际数量、以及扣掉归档后的「落位量」三者**互不相等**——详见 §6 US5 的验收方法修正。此处的用途只是说明「两个工作区其实同属一个仓」，**不要**拿它当验收基准。


侧栏里这是两个互不相干的行，看不出后者是前者的 worktree；而该仓另外 4 个 worktree（`MyProject-6.1.20` / `-hb4-main` / `-js-target` / `-kotlin2420`）在侧栏里**完全不可见**——因为没人给它们注册过 dsh 工作区。

参考项目 `dsh-coding-workspace` 尝试用自建血缘文件（`worktree-lineage.json`）+ 自定义侧栏解决，但用户实际使用中存在问题，且该插件已在本机 `cordis.patch.yml` 中被整体 `disabled`。

## 2. 目标

| # | 需求（用户原话） | 落点 |
|---|---|---|
| G1 | 侧边还是按照工作区打开；若该工作区是 git 项目，判断有无其他 worktree，有的话在里面展示每个 worktree，可以在 worktree 下面新建对话 | 三级树 + worktree 行 `+` |
| G2 | 当 worktree 被关闭时，worktree 中的会话归类到这个工作区里面，需要一个名为 `history-worktree-session` 的子目录存放 | 虚拟桶 |
| G3 | worktree 行为类似项目，可展开折叠；展开默认展示 5 个最近会话，超出显示"展开其余 xx 个会话" | 每节点独立 5 条截断 |
| G4 | 安装插件后，原先的会话保留在原有工作区所在的 worktree 中 | 不过滤、不重分 |

## 3. 非目标（本期明确不做）

- ~~拖拽排序（树结构变了，拖拽语义复杂）~~ ⇒ **2026-09-21 用户决策变更：改为已实现**，
  见 §5.5.2（D10 修订）
- 顶部栏会话 TAB 页、文件编辑器、Git Changes/Logs 面板（参考项目那套工作台）
- 中英双语（只做中文，词条集中在一个 locales 对象，便于后续国际化）
- 会话全文搜索（宿主 `sessions.search`），只做本地过滤
- 归档会话查看视图（宿主暂无 unarchive API）

## 4. 交付形态

| 项 | 决定 |
|---|---|
| 包名 | `dsh-worktree-groups` |
| 路径 | `/Users/dev/Documents/Project/AnyWork/dsh-worktree-groups` |
| 安装 | `pnpm link:` 进 `~/.dsh/profiles/web` + `cordis.patch.yml` 新增 entry（与 `dsh-askhuman` 同款） |
| 规模 | 宿主约 600 行 TS，客户端约 1200 行 TSX |
| 交付节奏 | 一次做全量 → 自测（tsc + 构建 + node 单测）→ 用户选时机重启验收 |

## 5. 21 项决策（已定稿）

### 5.1 交付与安装

| # | 决策 | 结论 |
|---|---|---|
| D1 | 交付形态 | **全新独立包 + 侧栏新建/删除 worktree 按钮**（不改造参考项目） |
| D9 | 代码位置与安装 | `/Project/AnyWork/dsh-worktree-groups`，pnpm link，包名 `dsh-worktree-groups` |
| D16 | 本次范围 | **一次做全量**：宿主 git/fs 服务 + 侧栏树 + 新建/移除 worktree + 菜单 + 状态点 |
| D17 | 验收时机 | 主代理自测（tsc + 构建 + 单测）→ 告知重启时机 → 用户重启验收 |
| D15 | 国际化 | 只做中文，词条集中在 `locales.ts` |
| D20 | 搜索深度 | 本地过滤（会话标题 / 工作区名 / 项目名 / 分支名），即时扁平结果 |
| D21 | 台账介质 | `~/.dsh/worktree-groups.json`，临时文件 + rename 原子写 |

### 5.2 侧栏树形与边界

| # | 决策 | 结论 |
|---|---|---|
| D2 | 树形 | **项目 → worktree（含主仓，标 `[主]`）→ 会话**；`history-worktree-session` 为项目下平级末节点 |
| D3 | 项目边界 | **按 git common dir 合并**多个 dsh 工作区为一个项目节点 |
| D6 | 需求 G4 语义 | **保留原位**：已有工作区行的会话只看自己的 `sessionIds`/`cwd`，不跨 worktree 重分 |
| D11 | 非 git / 单 worktree | **非 git 工作区保持平铺**；**git 项目一律产出 worktree 子行**（含单 worktree 的仓）—— 2026-09-21 用户决策变更，见 §5.2.1；未分组保持侧栏底部 |

**树形示例**（2026-09-21 修订后）：

```
▾ MyProject                          ← 项目（git common dir 归并）
   ▾ develop  [主]                  ← worktree 行（点行体展开/折叠）
      🐋 会话1 … ②                 ← 默认 5 条；② = 运行中的子代理数（为 0 时不画）
      ⊞ 展开其余 29 个会话
   ▾ feature/ohos
      🐋 会话1 …
   ▾ feature/hb4-main               ← 未注册（点 + 才注册）
   ▾ history-worktree-session       ← 已关闭 worktree 的会话
▾ LogAnalyst                        ← **单 worktree 的 git 项目**
   ▾ feature/refactor-render        ← 同样产出 worktree 子行（D11 修订）
      🐋 会话1 …
📁 Documents（非 git）               ← 唯一的平铺形态，与今天一致
（未分组）                            ← 底部，保持原生位置
```

> **子代理会话不产生行**（2026-09-21 需求变更）：`origin === 'subagent'` 的会话在树上与搜索结果里
> 都不出现（与原生 `sessionVisible` 一致），只在父会话行上以计数胶囊体现「有几个在跑」。

#### 5.2.1 D11 修订：单 worktree 的 git 项目不再平铺（2026-09-21 用户决策变更）

**变更前**：`hasWorktreeRows = isGit && worktrees.length > 1` —— 只有**多** worktree 的 git 项目
才产出 worktree 子行；单 worktree 的 git 项目与非 git 工作区一样，会话直接平铺在项目行下。

**变更后**：`hasWorktreeRows = isGit === true` —— **只要是 git 项目就产出 worktree 子行，
不论 worktree 有几个**。`flat`（平铺）容器**只留给非 git 工作区**。

**用户原话依据**（2026-09-21）：

> 现在工作区如果本身是 git，则工作区上会有 `+` 和 `...` 两个按钮，`+` 表示新增 worktree，
> `...` 里面是新建会话、新建工作区、新建 worktree
> - 如果这个工作区不是 git，应该只有 `+` 按钮，表示新建这个工作区的会话
> - 如果这个工作区是 git，则不需要 `+` 按钮，只需要 `...` 按钮，里面包含新建 worktree 一个选项，
>   暂时不需要其他选项
> - 另外添加工作区应该还是在顶部单独的按钮（原生），不要在二级菜单里面

用户在「单 worktree 的 git 项目怎么摆 `+`」的三选一里明确选了 **C：让单 worktree 的 git 项目
也显示 worktree 子行，`+` 就在子行上**。这条**推翻了本决策的另一半**：D11 原文的「单 worktree
保持平铺」作废。

**按钮布局（本次一并落地）**：

| 行类型 | hover 按钮 | 按钮行为 | 右键菜单 |
|---|---|---|---|
| git 项目行 | 只有 `…` | `…` 里只有「新建 worktree」一项 | 保留（同 `…`） |
| git 项目下的 worktree 行 | `+` 与 `…` | `+` = 在该 worktree 新建会话（懒注册 D5）；`…` = D14 全套 | 保留 |
| 非 git 工作区行 | 只有 `+` | `+` = 在该工作区新建会话 | **保留**（唯一的重命名 / 删除工作区入口） |
| 未分组行 | 无 | —— | 无（§2.6 裁定 1） |

**「添加工作区」**（D19）从二级菜单移到侧栏**顶部搜索框右侧的独立 `+` 图标按钮**
（对齐原生 `sectionHeader` 的「区头标签 + 搜索槽 + `headerActions`」布局）；
`project.add` 词条不变，点击仍走 `actions.addWorkspace()`（`pickDirectory` → `workspaces.create`）。

### 5.3 history 桶

| # | 决策 | 结论 |
|---|---|---|
| D4 | 关闭判定 | **目录不存在（或非有效 worktree）+ 双源识别**（自制台账 + 路径启发），自动入桶 |
| D18 | 死工作区记录 | **自动 `ctx.workspaceRegistry.delete`**（仅非主仓且目录不存在；不碰磁盘、不碰会话日志） |

路径启发规则：死目录的父目录 == 主仓父目录 **且** 死目录 basename 以主仓 basename 开头 ⇒ 归属该项目。
（可覆盖用户存量孤儿会话，如 `~/Documents/Project/Desktop/LogAnalyst-toolbar-refactor`，主仓 `LogAnalyst` 仍在。）

### 5.4 注册与生命周期

| # | 决策 | 结论 |
|---|---|---|
| D5 | 注册策略 | **懒注册**：只在点 worktree 行 `+` 时 `workspaceRegistry.create` + `session.create({workspaceId})` |
| D7 | 新建 worktree | **简化弹窗**：分支名 + 是否新建分支 + 起始分支；路径默认 `<主仓父目录>/<主仓名>-<分支名 sanitize>` |
| D8 | 移除 worktree | `git worktree remove` → 脏则弹确认提供**强制删除** → 注销工作区；**分支保留** |
| D13 | git 扫描 | 按 common dir 去重（同仓只跑一次）；缓存 30s + 窗口聚焦强刷；全部 worktree 做目录存在性探测 |

### 5.5 交互与保真

| # | 决策 | 结论 |
|---|---|---|
| D10 | 原生能力 | **全量保留**：搜索 + 新会话按钮 + 会话右键菜单（重命名/归档/派生/删除工作区）+ 三态状态点 + **当前会话高亮**（仅高亮，**不**置顶 —— T11 终裁）；**拖拽排序已实现**（2026-09-21 用户决策变更，见 §5.5.2）。**子代理会话不渲染任何行**（2026-09-21 需求变更：撤销原「+ 子代理嵌套」，改为与原生 `sessionVisible` 逐字对齐；父行保留「N 个子代理运行中」胶囊，n = **运行中的**子代理后代数 = 原生 `runningSubagentCount`） |
| D12 | 折叠细节 | 每个节点各自 **5 条** + 独立展开态；history 桶同样计数；展开态 localStorage 持久化。⚠️ **「当前会话保底进前 5」已于 T13（2026-09-22 用户终裁）删除** —— 拖拽顺序完全优先，被截断到不可见就是看不见 |
| D14 | **worktree 行**交互 | 行体点击 = 展开/折叠；hover 显 `[+]` 与 `[…]`；右键 = 同一菜单；菜单含 新建会话 / 在文件管理器中打开 / 复制路径 / 重命名工作区 / 移除 worktree（红） |
| D19 | 添加工作区 | **保留能力、改入口**（2026-09-21）：自建子 slot `sidebar.workspaces.worktreeDirectoryFlow` + 自实现 `pickDirectory`；**入口从二级菜单移到侧栏顶部搜索框右侧的独立 `+` 按钮**（用户原话：「添加工作区应该还是在顶部单独的按钮（原生），不要在二级菜单里面」） |

#### 5.5.1 行按钮布局（2026-09-21 用户决策变更）

| 行 | hover 按钮 | 各自行为 |
|---|---|---|
| git 项目行 | **只有 `…`** | `…` 菜单**只有**「新建 worktree」一项（「新建会话」「添加工作区」都已移除） |
| worktree 行（含单 worktree 的 git 项目的唯一子行） | `+` 与 `…` | `+` = 在该 worktree 新建会话（懒注册 D5）；`…` = D14 全套 |
| 非 git 工作区行 | **只有 `+`** | `+` = 在该工作区新建会话；**无 `…`**（其唯一菜单项与 `+` 重复） |
| 未分组行 | 无 | 无关（§2.6 裁定 1） |
| 侧栏顶部（搜索框右侧） | 独立 `+` 图标按钮 | 添加工作区（`t('project.add')`） |

**右键菜单不受本次布局调整影响**：非 git 工作区行去掉 `…` 按钮后，**右键菜单保留**
（它是「重命名工作区 / 删除工作区」的唯一入口；用户说的是 hover 上的**按钮**，右键不是按钮）。

#### 5.5.2 D10 修订：拖拽排序**已实现**（2026-09-21 用户决策变更）

**变更前**：D10 原文为「拖拽排序不做」，§3 非目标第一条同样写着「拖拽排序（树结构变了，
拖拽语义复杂）」。

**用户原话依据**（2026-09-21）：

> 工作区和会话拖动排序功能没有了，拖动排序还是需要的

随后用户在二选一里明确选了 **A**：

> 拖拽后自动切到「手动排序」并持久化到 localStorage。后续新消息**不再**把会话顶到前面，
> 直到你手动切回「最近更新」。最简单、无额外 UI。

**变更后**：三个层级（项目 / worktree / 会话）都可拖拽排序，顺序存浏览器 `localStorage`。
实现契约见 `docs/INTERFACES.md` §2.3.1。

| 项 | 决定 |
|---|---|
| 拖拽范围 | project：顶层项目之间；worktree：**同一项目内**；session：**同一容器内** |
| 硬约束 | session **不可跨容器**（= 改 cwd/归属，宿主禁止）；worktree **不可跨项目**（= 移仓，物理不可能）；未分组行**不参与**（但作为静止边界） |
| 交互 | HTML5 原生拖拽 API（`draggable` + `dataTransfer`）；上半/下半决定插到前/后；插入指示线；被拖行降不透明度；`onDragEnd` 清理状态 |
| 持久化 | `localStorage` 键 `dsh-worktree-groups.order`；**首次拖拽置 `manual: true` 并全量固化当前顺序** |
| 切回默认 | 项目行 `…` 菜单新增 `menu.resetOrder`（「恢复默认排序」），**仅 `manual === true` 时显示** |
| 搜索模式 | **不应用**手动顺序（搜索结果恒按 `updatedAt` 降序） |
| 轨道态 | `wide === false` 下不启用拖拽（只渲染图标，没有行可拖） |

**为什么不用宿主排序 API**（`workspaces.insertBefore` / `insertSessionBefore`）：

1. `insertSessionBefore(workspaceId, sessionId, beforeSessionId)` 要求被拖会话与锚点**同属一个
   workspace**（否则抛 `WorkspaceMoveInvalidError`）。真实数据里 MyProject 的 6 个 worktree
   **只有 2 个已注册**，其余 4 个的会话不在任何 workspace 里；history 桶、未分组的会话同理 ——
   **无法统一覆盖**。
2. `insertBefore(workspaceId, beforeWorkspaceId)` 只能排 dsh 工作区，而树里**未注册的 worktree
   没有 workspaceId**，项目节点还可能对应多个工作区 —— 同样无法统一。

**裁定：统一使用浏览器本地顺序**。理由：对未注册 worktree、history 桶、未分组**全部适用**，
语义一致；且这是**视图偏好**而非宿主数据，不该污染宿主注册表。（原生也是双轨：workspace
顺序走宿主、session 顺序走浏览器本地 store。）

**「拖拽即手动」的实现要点**：第一次拖拽时把**当前看到的顺序整体写下来**（`manual: true`）。
只把被拖的那一项挪到前面、其余仍按 `updatedAt` 排的话，下一条新消息照样会把它的容器顶到
前面 —— 用户会认为「排序没生效」。固化用的是**不折叠、不截断**的完整顺序，所以「第 6 条
之后」的会话也被正确冻结。


## 6. 用户故事与验收标准

### US1 侧栏按 worktree 分组（G1）

- 打开 DSH，侧栏首个项目节点为 `MyProject`
- 其下 worktree 行包含 `develop [主]` 与 `feature/ohos`，且 `feature/hb4-main` / `feature/js-target` / `feature/6.1.20` / `feature/kotlin2420`（未注册）也**可见**
- `Documents`（非 git）表现为单行平铺，与今天完全一致
- **只有 1 个 worktree 的仓（`LogAnalyst` / `DemoBox` / `SKIE`）同样出现 worktree 子行**
  （D11 2026-09-21 修订；此前是不出现子行、会话直接挂在项目行下）
- git 项目行 hover 只有 `…`（菜单里只有「新建 worktree」）；`+`（新建会话）在 worktree 行上
- 非 git 工作区行 hover 只有 `+`（新建该工作区的会话），无 `…`；右键菜单仍在
- 「添加工作区」在侧栏**顶部搜索框右侧**的独立 `+` 按钮上，不在任何二级菜单里

### US2 在 worktree 下新建对话（G1）

- hover `feature/hb4-main` 行 → 点 `+`
- 首次点击触发懒注册：`workspaceRegistry.create(<path>)` → `session.create({workspaceId})`
- 新会话出现在该 worktree 行下，并被打开
- 未注册的 worktree 在注册前**不产生**任何 dsh 工作区记录

### US3 worktree 被关闭后会话入桶（G2）

- 对某个有会话的 worktree 执行"移除 worktree"（或外部 `rm -rf`）
- 该 worktree 行消失，其会话出现在 `history-worktree-session` 桶下
- 该 worktree 的 dsh 工作区记录被自动注销
- 会话日志文件完好无损
- 存量孤儿会话（`LogAnalyst-toolbar-refactor`）也被路径启发接回 `LogAnalyst` 的 history 桶

### US4 展开折叠与 5 条截断（G3）

- 任一 worktree 行展开时最多显示 5 条非空会话，第 6 条起为"展开其余 N 个会话"
- 点击后全部展开，变为"收起"
- **当前打开的会话若排在 6 位之后，就落在被截断区、整行不可见**（⚠️ **T13 修订**：D12 原有的
  「当前会话保底进前 5」已按用户终裁**删除** —— 该保底在 T11 删除「当前会话置顶」后变成
  **可达**，并让「把当前会话往下拖」出现**视觉零位移**（与用户投诉的首要缺陷同形）。
  用户裁决「**拖拽顺序完全优先**」，并明确接受「当前会话被截断到不可见就是看不见」这一副作用。
  原生靠自动全展开绕过，本插件不再用保底绕过）
- 刷新页面后展开态保持

### US5 存量会话原地保留（G4）

> ⚠️ **验收方法修正（2026-09-21，独立审查发现）**
>
> 本节上文表格里的「34 / 2」与本文档早期版本的「33 / 1」**都不应作为验收基准**。它们来自 `workspace.json` 的 `sessionIds`，那是**成员关系账本**（含已归档、且会被 `getter` 实时过滤），**不等于**当前实际存在的会话。
>
> **正确的验收方法**：不要比对任何硬编码数字——会话文件在持续增长（每开一个会话就多一个），任何写死的数字都会在几小时内失效。应比对**不变量**：
>
> ```
> 落位会话数（worktrees[].sessions + history + flatSessions + ungrouped）
>   === 输入会话总数 − 归档会话数
> ```
>
> 用真实数据实测（2026-09-21 多个时间点）：**差额恒为 0，重复恒为 0**。这才是「没丢会话」的证据。
>
> 若你要看具体项目的直观效果：`MyProject` 下会看到主仓 `develop` 行挂着它的会话、`MyProject-ohos` 的会话挂在 `feature/ohos` 行——**与安装前完全一致**，没有任何会话被搬移。

- 安装插件后，`MyProject` 与 `MyProject-ohos` 的会话**分布不变**
- 无任何会话被搬移或隐藏
- 对账满足上式（差额 0、重复 0）


### US6 新建 / 移除 worktree（D7/D8）

- 项目行 hover `…` → 菜单里只有「新建 worktree」→ 弹窗 → 输入 `feature/demo` → 创建
  （2026-09-21 修订：`+` 已从项目行移除，D7 的入口改为 `…` 菜单里的唯一一项）
- 磁盘出现 `<主仓父目录>/<主仓名>-feature-demo`，`git worktree list` 可见
- 侧栏立即出现该 worktree 行并自动开一个新会话
- 对该行执行"移除 worktree"→ 目录消失、工作区注销、分支仍在（`git branch` 可见）

### US7 原生能力保真（D10）

- 搜索框输入关键词 → 扁平结果列表（匹配会话标题 / 工作区名 / 项目名 / 分支名）
- 搜索框右侧的独立 `+` 按钮 → 打开系统目录选择器 → 新建工作区（D19 的入口，2026-09-21 移到顶部）
- 会话右键 → 重命名 / 归档 / 派生 均可用
- **git 项目行右键 / `…`** → 只有「新建 worktree」一项
- **非 git 工作区行右键** → 保留「新建会话」与后续扩展项（hover 上只有 `+`，没有 `…`）
- **子代理会话不出现在侧栏列表里**（与原生一致）：只有主 agent 的会话有行；父会话行右侧用计数胶囊显示「N 个子代理运行中」（n = 运行中的子代理后代数，所有层级；为 0 时不显示胶囊）
- 搜索同样搜不到子代理会话
- 运行中 / 等待确认 / 后台完成三态状态点正确显示
- **有子代理在跑 ⇒ 父会话行状态点也是「运行中」**（需求 A，2026-09-21）：主 agent 自己空闲、
  但它下面**任意层级**有子代理在跑时，父行状态点是蓝色 ongoing（对齐原生
  `sessionStatuses`：`runningSubagentCount > 0` ⇒ 主状态点即 ongoing），而不是灰色 idle。
  子代理全不跑且主 agent 空闲 ⇒ 仍是 idle；主 agent 自己在跑 ⇒ 照旧 ongoing（不受影响）。
- **顶部区（T11，2026-09-22 用户终裁；取代 T5/T9 的 D3a/D3c/D4 全部安排）**：
  每个容器内，**只有「正在运行」的会话**（自身 running **或** 任意层级有运行中的子代理，
  即既有聚合 `running` 口径）进入容器**顶部区** —— 它们固定在**所属容器最前**，
  先于 5 条截断生效（⚠️ **但顶部区成员超过 5 条时，超出的部分仍会被截断** —— 见 US4 的
  5 条上限；这是**有意行为**，由 `T5/截断: 顶部区成员数 > 5 时，只有前 5 条可见` 锁定），
  区内按 `updatedAt` 降序；并且**不可拖动**
  （拖它们无效果；回弹到顶部是**预期行为**）。此外**尚未落表的新会话**同样由渲染期提升
  （D2 的唯一例外，见 US8）。
  顶部区是**运行时内存状态**（刷新即重置），**不写** `localStorage` ——
  **唯一例外**是新会话的「插入固化表」（D2，见 US8）。
  ⚠️ **已结束的会话一律不再固定置顶**：「刚结束保留」（recentlyCompleted / finished retention）
  与「当前打开的会话置顶」（`isCurrent`）两个机制已按用户终裁**删除**。已结束的会话
  （含用户正在查看的旧会话、含刚刚跑完的会话）位置**完全由持久拖拽顺序决定**，
  并且**必须可以正常拖动**（拖到哪就留在哪，不回弹）。
  用户原话：「正在运行的会话固定在顶部，拖不动，只要是结束了的会话就不再固定置顶了」。
- 当前打开会话高亮（当前会话本身是子代理时同样不显示该行，与原生一致）

### US8 拖拽排序（D10 修订，2026-09-21）

**三个层级都能拖，且范围被约束死**：

- 拖动**项目行**到另一个项目行的上半 / 下半 ⇒ 插入线出现在该行上方 / 下方，松手后项目顺序改变
- 拖动**worktree 行**到**同一项目内**另一个 worktree 行 ⇒ 顺序改变
- 拖动**会话行**到**同一容器内**另一个会话行 ⇒ 顺序改变
- 把会话拖到**别的容器**（另一个 worktree / history 桶 / 未分组）的行上 ⇒ **不显示插入线**、
  光标为「禁止」、松手无任何变化（会话不会被搬走）
- 把 worktree 拖到**别的项目**的 worktree 行上 ⇒ 同上，无任何变化
- **未分组行**不参与拖拽；项目**拖不到未分组之后**（未分组恒为最后一个 project 行）

**手动排序的持久化与「不再顶到前面」**：

- 任意一次有效拖拽之后，刷新页面 ⇒ 顺序保持（`localStorage` 键 `dsh-worktree-groups.order`）
- 拖拽之后在某个容器里发一条新消息 ⇒ 该会话**不会**被顶到容器最前（顺序已冻结）；
  **非当前、非运行中、非新会话**的新项出现在容器**末尾**
- 新建的 worktree / 项目同样出现在各自列表**末尾**
- 被归档 / 删除的会话从顺序表里消失后，其余项顺序不受影响（不产生空洞）
- ⚠️ **例外（T11，2026-09-22 用户终裁）：只有「正在运行的会话」与「尚未落表的新会话」
  这两类会被提升到容器最前。**
  上面三条承诺约束的是**其余**会话 —— 既没在跑、也不是新会话 ⇒ 顺序照旧冻结。
  范围是**所属容器内最前**（不动项目 / worktree 行），时机在 5 条截断**之前**，
  且**纯运行时推导、不写进持久顺序**：
  - 手动排序已持久化时，运行中的会话仍出现在其 worktree 分组内第一位，且不被 5 条截断吞掉；
    它**不可拖动**（拖拽接线不给它安装 `draggable`）。
  - **已结束的会话（含刚收到新消息的、含刚跑完的、含用户正在查看的）相对顺序与上面三条
    承诺逐字不变**，并且**可以正常拖动** —— 拖到分组内任意位置后
    **渲染顺序 === 持久表顺序**（不回弹）。
  - `localStorage` 里的顺序内容**不含置顶**（`effectiveOrder` 刻意不应用任何运行时顶部区，
    固化的是真实顺序）；
  - 搜索模式**不应用**顶部区（与「搜索不应用手动顺序」保持一致）。
  - ⚠️ **已删除的两条例外（T11 终裁，不要改回去）**：
    ① **「当前打开的会话置顶」** —— 用户明确选择**不保留**该例外：当前会话若不处于运行中，
    就不置顶，留在其持久顺序位置；
    ② **「刚结束保留」（recentlyCompleted）** —— 会话跑完后**不再**留在顶部区。
    这两条曾导致用户看到「刚结束运行的会话 / 当前正在运行的会话」两段都**拖不动、会回弹**。

**顶部区（T11，2026-09-22 用户终裁）—— 取代 T5/T9 的全部安排**

> **背景（两轮真人 GUI 复验）**：
> ① T5 修复了用户报告的「新会话 / 刚结束的会话掉到侧栏最下面」；
> ② T9 修复了「拖动新会话弹回原位」与「同分组里运行中的会话掉到最下面」；
> ③ **但第二轮真人 GUI 复验又发现缺陷**：侧栏呈现三段 ——
> `刚结束运行的会话 / 当前正在运行的会话 / 其余会话`，且**前两段都拖不动、会回弹**。
> 用户据此给出**终裁**（本节的唯一语义基准）：
>
> > **正在运行的会话固定在顶部，拖不动，只要是结束了的会话就不再固定置顶了。**

- **每个 worktree 容器内各自生效**（**不改变** project / worktree 容器行顺序）：

  | # | 类别 | 判据 | 可拖动？ | 持久化 |
  |---|---|---|---|---|
  | a | **正在运行** | 自身 `running` **或** 任意层级有运行中的子代理（需求 A 的聚合 `running` 口径） | **❌ 不可拖动**（拖拽接线不安装 `draggable`） | ❌ 不写 |
  | b | **新会话（尚未落表）** | 本进程内观测到 `blank: true → 非 blank` 的转换，或首次观测到且 `updatedAt ≥ 本进程基线时刻`；**且**不在落表台账里 | ✅ 可拖动（拖走后由持久顺序承载） | ✅ **唯一例外**：插入固化表最前（D2） |

  ⚠️ **已删除的类别（T11 终裁，不要改回去）**：
  - ~~**刚运行结束保留**~~（`recentlyFinishedSessionIds` / `TopZoneState.recentlyFinishedIds`）——
    已结束的会话不再固定置顶。**这是本轮首要缺陷（拖不动 / 回弹）的根因**：它把会话钉在顶部区，
    `buildRows` 无论持久顺序怎么写都把它画回最前。
  - ~~**当前会话**~~（`isCurrent` 置顶）—— 用户明确选择**不保留**该例外。
  - ~~**拖动释放**~~（`releasedContainerKeys` / `releaseTopZoneContainer` /
    `isTopZoneReleasingDrag`）—— 它的唯一目的是「拖动容器 ⇒ 清除该容器的刚结束保留」，
    保留机制删除后它失去全部语义，属死代码，一并删除。

- **顶部区内部顺序**：按 `updatedAt` 降序（`sessionId` 升序 tiebreak）。
  选择理由：① 确定性（复用既有 `byRecency`）；② 与容器内默认排序 / 搜索排序同向；
  ③ T4 已确证 `updatedAt` **不随 agent / subagent 活动推进**，所以「只有 subagent 在跑、
  长期无 prompt」的会话 `updatedAt` 可能很旧 —— 它仍**进入**顶部区（除非顶部区成员本身
  超过 5 条，见下），只是区内排得靠后；顶部区的**首要语义是「在 5 条截断之前生效」**，
  区内精排是次要诉求。
- **时机**：顶部区在 5 条截断**之前**生效 ⇒ 顶部区成员**在截断前就已排在最前**。
  ⚠️ **措辞修正（T13 的 N-6）**：这**不**等于「运行中的会话一定可见」—— 同一容器若有
  **6 条以上**运行中的会话，`truncateSessions` 仍只保留前 5 条（`test/tree-model.test.mjs` 的
  `T5/截断: 顶部区成员数 > 5 时，只有前 5 条可见` 明确锁定该取舍），第 6 条起会被截断。
  该场景实际很难出现（需 6 条并发运行会话），属**有意行为**，不是缺陷。
- **不可拖动（T11 新增）**：运行中的会话行**不安装拖拽接线**（`draggable: false`），
  但仍**接受落点**（别的会话可以拖到它上方/下方）。判据与置顶判据**同源** ——
  都走 `isTopZoneRunningSession`（`src/tree-model.ts` 的导出纯函数），
  因此「排在最前的行」与「拖不动的行」**不可能分叉**。
- **持久化不变式**：除 D2 的新会话插入外，运行时顶部区**绝不写** `localStorage`
  （`effectiveOrder` 内部把 `context.topZone` **硬置 `undefined`**，从结构上杜绝污染）。
- **新会话插入固化表（D2，唯一例外）**：
  - **只在手动模式下写**（`manual === true`）。默认模式下新会话本来就排最前，
    且**凭空建表会把用户静默切成手动模式** ⇒ 绝不写、不建表。
  - **幂等**：已在表首 ⇒ 不产生任何 `localStorage` 写入（不在每次渲染时反复写）。
  - **去重**：先把该 id 从列表里全部剔除再插到首位 ⇒ 不产生重复条目。
  - **只写这一个新会话**：`running` 与新会话提升本身一律**不进表**。
  - **写入形态必须是树/表里的真实 id（T6 缺陷 B1 修复）**：宿主真实会话 id 恒带 `session-`
    前缀（实测 `~/.dsh/sessions/**` 的会话头 `id = 'session-<uuid>'`；用户真实固化表
    `dsh-worktree-groups.order` 的 **55** 个会话条目**全部**带前缀），而状态机内部一律用
    归一化（去前缀）id 比较。落表前必须用 `placementOfSession` 还原成**树里的原形态**，
    否则写入的是**永远匹配不上的死条目**（`applyManualOrder` 用树里的真实 id 去 `indexOf`），
    并顶掉原本正确的条目 —— D2 的核心承诺「刷新页面后新会话仍在第一位」会因此**不成立**，
    且实质违反 D1「不代改用户 localStorage」。
  - **编排层收敛（T6 缺陷 B2 修复；T9 缺陷 1 补齐第二重作用）**：落表 effect 的依赖含
    `manualOrder` ⇒ 用户**每次拖拽都会重跑**，而 `newSessionIds` 在本进程内**只增不减**
    （它是顶部区输入，不能因落表而移除）。因此必须记录「已落表台账」
    （`writtenNewSessionIds`），它回答**两件事**：
    ① **不再重复写持久表** —— 同一个新会话的落表只发生一次，用户随后把它拖到任何位置都
    **不会被静默改写**；
    ② **已落表的新会话不再被渲染期提升** —— 它的「在容器最前」已由**持久顺序**承载
    （`topZoneInputOf` 把台账投影进 `TopZoneInput.writtenNewSessionIds`，
    `topZoneSessionKeys` 据此把它排除出顶部区）。
    ⚠️ **只有 ① 不够**：T7 只做了 ①，真人 GUI 复验当场发现「用户把新会话拖到分组内另一个
    位置后，它**弹回原位**」—— 持久表确实没被改写，但 `buildRows` 仍按运行时顶部区把它画回
    最前。两条合起来才是「用户拖到哪就留在哪」。
  - **「拖动新会话弹回原位」缺陷（T9 缺陷 1）的完整成因**：`observeTopZone` 的
    `newSessionIds` 只增不减 ⇒ 新会话在整个页面会话内都命中渲染期顶部区
    ⇒ 用户拖动只改了持久表，渲染结果仍被提升回表首。修复 = 台账投影进渲染期输入，
    已落表 ⇒ 不再提升（未落表 ⇒ 仍提升，零回归）。
- **「新会话」判定口径与残余不确定性**（**关键**，避免把旧会话误插到最前）：
  T4 实测真实 `localStorage` 表里 AnyWork 容器只固化 16 条，而有 **6 条可见顶层会话不在表里**，
  其中**只有 2 条**晚于固化水位，另外 **4 条是旧会话**（水位之前就存在，只是固化快照不完整）。
  ⇒ **不能**按「不在固化表里」判定新会话。本实现用**双重时间序证据**：
  ① 本进程内观测到 `blank: true → 非 blank`（强证据，宿主只在 `user/message` 时翻 `blank`）；
  ② 首次观测到且 `updatedAt ≥` 本进程基线时刻（覆盖「新建 + 发首条消息都在两次轮询之间」的窄窗口）。
  **基线**（本进程首次拿到树数据）里出现过的会话**永远不判新会话**。
  - **残余不确定性**：若「创建会话 + 发首条消息」全部发生在**首次树数据到达之前**
    （页面刚加载的窄窗口内），该会话进入基线 ⇒ **漏报**，它在手动模式下仍会落末尾
    （重开页面后已在基线里，属可接受降级）。宿主时钟与渲染进程时钟严重不一致时会误判
    （同机场景不可能）。⚠️ **另一条已披露的残余风险（T6 次要项 S3）**：**旧**会话的
    `updatedAt` 若因故（宿主时钟偏差 / `lastPromptAt` 被历史事件推进）晚于本进程基线，
    且它在本进程内**首次**出现，则会被判为新会话（**误报**）—— 同机场景不可能，
    保持如实披露、不做强制消除（强行加「表外即新」之类判据会引入 T4 实测的 4 条旧会话误插）。
- **与 `11b1144` 的关系**：**非运行中、非新会话**的已有会话收到新消息，
  顺序**仍然冻结**（承诺保持，有测试锁定）。
- **历史数据影响（N3，如实说明）**：B1（T6 缺陷，T7 已修）曾在用户固化表里写入过
  **裸 id**（无 `session-` 前缀）的**死条目**。这类条目在 `applyManualOrder` 里永远匹配不上
  任何树里的会话 ⇒ 既占位置又不生效。**T9 实读用户真实 `localStorage` 核对：当前裸 id = 0**
  （`dsh-worktree-groups.order`：`manual:true`、55 条 id **全部**带 `session-` 前缀、10 个容器、
  `projects` 14 项、`worktrees` 9 键），即该污染**已不存在**，无需治愈。若将来在其他机器上
  发现裸 id 死条目，按「不代改用户数据」（D1）原则**只报告、不自动清理**。
- **归档语义（T6 缺陷 I3 提出；T9 修好真实链路）**：「谁算旧会话」（`knownSessionIds`，
  **含归档与子代理**）与「谁参与顶部区判定」（`eligible`，**排除归档与子代理**）是两个不同的
  事实。归档会话进 `known` ⇒ 即便之后被取消归档、`updatedAt` 又被推进到基线之后，也**不会**
  被误判为新会话（否则会把一条**旧**会话插到固化表表首，违反 D5）；但它**不**进
  `blankOf` / `runningOf` 轨迹、**不**进 `newSessionIds`、也不置顶。
  ⚠️ **真实链路修复（T9 的 N1）**：`buildProjects`（`src/projects.ts`）已经把归档会话**从树里
  剔除**，所以 T7 的「归档会话进 `known`」在真实链路下**空转**（`seen` 里根本没有归档会话）
  —— T8 实测真实链路形态下 `newSessionIds = ['oldarch']`（**仍误判**），而 T7 的单测 fixture
  把归档会话同时放进树与 `archivedSessionIds`，与真实链路**不同构**（属恒真测试）。
  修复：`observationsOf` 把 `archivedSessionIds` **单独投影**成 `archived: true` 的观测，
  使 `seen` 真正覆盖归档会话；单测 fixture 也改为真实链路形态（树里不含归档会话）。
  宿主当前**没有** unarchive API，该路径暂不可达，但用户手改
  `~/.dsh/storages/workspace.json` 或宿主将来提供 API 都会让它可达，故按正确语义实现。
- **搜索模式不应用顶部区**（与「搜索不应用手动顺序」一致）。
- ⚠️ **D12 保底已删除（T13，2026-09-22 用户终裁）**：T11 删除 `isCurrent` 置顶后，
  D12 的「当前会话保底进前 5」（`truncateSessions` 的 `promote` 分支）在**树路径上从
  恒不可达变成可达**。T12 复审实测其触发面比原披露更宽：**默认未折叠态下容器超过 5 条
  会话即触发**（例：持久表 `[o0..o7,cur]` ⇒ 渲染 `[o0,o1,o2,o3,cur]`；把 `cur` 拖到
  第 7 位 ⇒ **渲染视觉零位移**，与用户投诉的首要缺陷**同形**）。
  **用户裁决：删除该保底，拖拽顺序完全优先**；用户明确接受副作用（当前会话若被截断到
  不可见，就是看不见）。实现：`truncateSessions` 的 `promote` 分支与其 `currentSessionId`
  形参**一并删除**（该导出函数的契约同步收窄为 `(sessions, limit)`，不再是「当前会话保底」
  的载体）；`emitContainer` 的调用点不再传任何「当前会话」线索。
  ⇒ **渲染层对已结束会话（含当前打开的会话）的位置完全由持久拖拽顺序决定**：
  渲染顺序 === 「运行中置顶 + 尚未落表新会话」∪ 持久顺序，再取前 5 条。
  回归锁：`T13/截断: 当前会话拖到容器内**任意位置** ⇒ 渲染 === 运行中置顶 + 其余逐字持久表（逐落点枚举）`。

**切回默认排序**：

- 处于手动排序时，项目行 `…` 菜单（git 项目与非 git 工作区**都有**）出现「恢复默认排序」
- 点击后 ⇒ 立即恢复默认顺序（项目 = 宿主顺序 / worktree = 主树在前 + 分支字典序 /
  会话 = `updatedAt` 降序），且 `localStorage` 里的顺序键被清除（刷新后仍是默认顺序）
- **未手动排过时不显示该项**（菜单里不出现无效项）

**不破坏既有交互**：

- 拖拽可用之后，行点击展开 / 折叠、hover 显示 `+` / `…`、右键菜单**全部照旧**
- 按住 `+` / `…` 按钮拖动**不会**拖走整行
- 拖到空白处松手 / 按 Esc 取消 ⇒ 插入线消失，不留残影
- `wide === false`（侧栏折叠成轨道）时不可拖，也不崩

## 7. 风险与缓解

| # | 风险 | 缓解 |
|---|---|---|
| R1 | 新增插件行需重启 DSH Desktop 才生效，重启会终结当前会话 | 主代理自测完备后交用户选时机；重启后若未加载，按日志修宿主半边（客户端半边改完刷页即可） |
| R2 | 抢占 `sidebar.workspaces`（single slot，priority -1）后若组件抛错，侧栏空白 | 顶层错误边界：捕获后渲染可读错误提示，不静默白屏 |
| R3 | 目录删除后宿主 `workspaceRegistry` 会打 `filtered session from membership` 警告日志 | 正常现象，写入 README 已知行为 |
| R4 | 路径启发可能误判（把无关目录的会话归入项目） | 误判仅影响 history 桶归属；提供"移出 history"菜单动作纠正 |
| R5 | `git worktree remove` 遇脏工作区失败 | 弹确认框，明示"将丢失未提交改动"，用户显式确认后 `--force` |
| R6 | 宿主升级导致 slot 契约或服务名变化 | 运行时对缺失服务惰性降级（`ctx.get` 返回 undefined 时不崩），README 记录依赖的宿主契约 |
| **R7** | **`entry.locale` 声明是「声明即无退路」**：locale 服务缺席时 renderer 的 `standardKit` 抛 `SlotAssemblyError` ⇒ entry abdicate（回落官方 ui-workspace）。抛出点在父层，组件的错误边界接不到 | 当前 profile 安全（`dsh-web-app` 挂了 `locale`）。已把真实失败模式写进 `client.tsx` 注释。若将来要在无 locale 的组合里工作，唯一出路是去掉 `entry.locale` 声明、改用 `ctx.get('locale')` 手动绑定（代价：失去语言切换自动重渲染） |
| **R8** | **三态状态点依赖客户端 live fact**：宿主 `SessionSummary` 不含 `pendingInteraction`/`completed` | 客户端状态覆盖层从 `useSessionPendingInteraction` 与 `useSessions().byId[].completed` 补齐。`test/routes.test.mjs` 钉死「HTTP 面给不出这两个字段」这一边界，防止误删覆盖层 |
| **R9** | 平铺项目的搜索 haystack 缺少分支名 | **已由 D11 修订彻底消解**：`flat` 容器现在**只**服务非 git 工作区（它本来就没有分支名），所有 git 项目（含单 worktree）都走 worktree 子行，`ContainerSpec.worktree` 天然非空 ⇒ 分支名自动进入 haystack。原先「按 `worktrees.length === 1` 给 flat 挂 `worktree`」的特例已删除。分支名搜索在三种形态下都有回归用例锁定 |

## 8. 依赖的宿主契约（已核实）

| 契约 | 事实 |
|---|---|
| `sidebar.workspaces` | `single` / `root`；**priority 小者渲染**；ui-workspace 占 0，本插件用 **-1** 遮蔽；同 priority 重复注册会抛错 |
| 子 slot | `sidebar.workspaces.directoryFlow`（`single`/`root`，由占用者自己 `children` 声明） |
| 新会话 | `session.create` 接受 `workspaceId` **或** `cwd`（互斥），不能同传 |
| 工作区注册 | `ctx.workspaceRegistry.create(path, title?)` / `.get(id)` / `.list()` / `.delete(id)` |
| 成员校验 | `attachSession` 强制 `realpath(header.cwd) === workspace.path`，目录已删则**永远无法 attach** |
| `SessionHeader` | 只有 `version/id/createdAt/cwd/parentSession/isSeeded/origin/delegationDepth/agentPreset`——**无仓库指针**，故 history 归属必须自建台账 |
| `SessionSummary` | `sessionId/updatedAt/running/blank/parentSessionId/origin/cwd/projections` |
| 折叠常量 | 原生 `COLLAPSED_SESSION_LIMIT = 5`，文案 `展开其余 {n} 个会话` / `收起` |
| HTTP 路由 | `ctx.webServer.register({ kind: 'exact', ... })` |
| 客户端 bundle | `window.__ModuleLoader__.load({id:<包名>, factory:(require)=>{...}})`；`external: react, react/jsx-runtime, @deepseek-ai/dsh-client-ui-primitives` |

## 9. 契约调研后的修订（2026-09-21，均有实测证据）

`docs/HOST-CONTRACTS.md`（1756 行，17 问答）用实测推翻了本文档的若干假设。以下为**已裁定**的修订，裁决全文见 `docs/INTERFACES.md` §2.7。

| 原决策 | 修订 | 依据 |
|---|---|---|
| **D19** 重新声明 `sidebar.workspaces.directoryFlow` 接回原生目录选择器 | **不可行，改为自建新键** `sidebar.workspaces.worktreeDirectoryFlow` + 自实现 picker（`ctx.get('uiWorkspace').pickDirectory()` → `ctx.workspaces.create({path})`）。**用户可见行为不变** | `SlotCore.register` 对同键重复声明抛错（`dsh-client-ui-slots/lib/index.js:100-103`），而官方 ui-workspace 自己就声明了该键；且它同时提供 `uiWorkspace` 服务，被 5 个客户端插件硬 inject，禁用会导致 `web boot: N entries did not activate` 整页白屏 |
| **D21** 台账用 `defaultDshHome()` | 改用 **`dshHomePath('worktree-groups.json')`** | `defaultDshHome()` = `homedir()/.dsh`，**不读 `$DSH_HOME`**；`dshHomePath()` 会读。本机 `DSH_HOME=/Users/dev/.dsh` 恰好相同，故当前无可见差异，但换 `$DSH_HOME` 后会写错位置 |
| **D6/G4** 用 `workspace.sessionIds` 判断归属 | **禁止**，改用 `session.cwd`（T1 的 `buildProjects` 已经是这么做的） | `sessionIds` 是会实时过滤的 getter（`dsh-workspace/lib/index.js:102-104`），cwd 不匹配的会话被静默剔除 ⇒ 会**丢会话**。全量来源 = `sessionPersistence.list()`（含死 cwd） |
| **D10** 「+ 子代理嵌套」 | **撤销**，改为与原生 `sessionVisible` 逐字对齐：**子代理会话不渲染任何行**（树上与搜索都不出现），只保留父行的「N 个子代理运行中」胶囊 | **用户需求变更**（2026-09-21）：「当前的会话列表把所有 subagent 的会话也都列了出来，这个没有必要，只需要列出主 agent 的会话即可」。原决策本是「有意偏离原生」，现回归原生 |

**两条新增的硬约束**

- **孤儿会话排序回退**：`updatedAt` 只在 `SessionSummary` 上，`SessionHeader` 只有 `createdAt`。取值顺序 = `summary.updatedAt ?? header.createdAt ?? 0`，**必须**回退，否则孤儿会话会 NaN 排序。
- **`cwd` 可选**：`SessionHeader.cwd` 可能缺失（宿主有 `_no-cwd` 分支），缺失的会话一律进「未分组」。
- **`wide: false` 轨道态**：宿主在侧栏折叠时以 `wide: false` 渲染**同一槽位**，组件必须渲染紧凑 icon 列，否则布局崩。

**`external` 白名单**：浏览器静态种子白名单只有 9 项，`external` 必须是其子集，否则装载期抛错。本插件用 `react` / `react/jsx-runtime` / `@deepseek-ai/dsh-client-ui-primitives`，均在白名单内。

**安装步骤补充**：`PROFILE/package.json` **两处**都要改（`dsh.profile.bundles` + `dependencies: link:`）。profile 的 `patchReload: "live"` **只覆盖 patch 文件内容热重载**，**加新 bundle 必须重启 DSH Desktop**；客户端 JS 迭代只需刷页。

## 10. 交付状态（2026-09-21）

### 已交付

| 项 | 状态 |
|---|---|
| 包位置 | `/Users/dev/Documents/Project/AnyWork/dsh-worktree-groups` |
| 安装 | 已装进 `~/.dsh/profiles/web`（`bundles` + `dependencies: link:`），`pnpm install` 完成，符号链接建立 |
| 加载链验证 | 用宿主**自己的** `resolveOverlayPackage` / `findOverlayPackage` 实测解析成功；宿主半边 `import()` 加载 OK（`name` / `inject: ["webServer"]`） |
| 槽位共存验证 | 用宿主**真实 `SlotCore`** 实测：原生 ui-workspace（priority 0，声明官方子键）与本插件（priority -1，声明自建子键）**都能注册**，渲染胜出者 priority = -1 |
| 构建 | `typecheck` exit 0 / `build` exit 0 |
| 测试 | **246/246 全绿**（`test/` 5 个文件，`node --test`）；基线 194 条；子代理过滤需求变更净增 20 → 219；**D10 拖拽排序净增 27 → 246** |
| 真实数据回放 | 460 会话 → 落位 319 + 未分组 7 = 非归档 326，**差额 0**；`MyProject` 正确合并为 1 项目 6 worktree（4 个未注册可见） |
| 真实数据回放（2026-09-21 子代理过滤） | 用真实 session header（320 会话，其中 **132 个 subagent**，含 `delegationDepth` 3 的多层链）+ 真实 workspace/projcache 回放：渲染会话行 24 条，其中 subagent **0** 条；落位层 `151 + 7 + 162 = 320` ✔；渲染层 `24(可见) + 2(截断) + 162(归档) + 132(隐藏 subagent) = 320` ✔；`subagentCount` 与逐字移植的原生 `indexSubagentDescendants` 在 **320 个 id 上全部一致**（27 个父会话有正计数，最大 11） |
| 真实数据回放（2026-09-21 D10 拖拽排序） | 用真实 `workspace.json`（16 工作区）+ 真实 `session_projcache.json`（**274 会话**）+ 真实 `git worktree list`（9 仓）跑 `buildProjects → buildRows`：不传 `manualOrder` 与传 `manual:false` 的 89 行输出**逐字一致**（零回归 ✔）；三层手动顺序各自生效 ✔（会话层取 `w:…/MyProject` 容器，21 条可见会话反转后渲染首条即手动首项）；落位 `274/274`，**差额 0、重复 0** ✔；worktree 层（MyProject 7 个 worktree）与 project 层（14 个项目）反转顺序均生效 ✔；未分组仍是最后一个 project 行 ✔ |

### 实施过程中发现并修复的缺陷（按发现顺序）

| 来源 | 缺陷 | 处置 |
|---|---|---|
| T1×T4 集成验证 | D-1 `label` 返回 `undefined`（违反冻结契约） | 已修 |
| T1×T4 集成验证 | D-2 死 worktree 扣住会话（违反 T1 自述不变量 + D18 未实现） | 已修（规则 2 加 `exists` 判定 + `isKnownLivePath` 语义修正 + D18 清扫） |
| T1×T4 集成验证 | D-3 7/15 工作区 `workspaceId` 不可达 | 已修（子目录工作区挂最长前缀） |
| T1×T4 集成验证 | D-4 history 桶空容器行 | 已修（存在性 ⟺ 非空，同源于可见性判定） |
| T5 实现 | `tsconfig.json` **不含 `.tsx`** ⇒ `typecheck` 从未检查 UI 文件 | 已修（`.tsx` 纳入 + `jsx: preserve` + 最小 shim） |
| T5 实现 | `expandedAll` 时不产 more 行 ⇒ **US4 的「收起」不可达** | 已修（全量展示时仍产 more 行且保留真实 `hiddenCount`） |
| T6 单测 | 偏差 A：单 worktree 的 git 项目搜不到自己分支名 | 已修（当时靠 flat 容器带 `worktree`）。**D11 修订后该特例已删除**：单 worktree 的 git 项目改走 worktree 子行，分支名天然可搜 |
| 用户决策变更（2026-09-21） | **D11 的「单 worktree 保持平铺」被推翻**：用户在单 worktree 项目的 `+` 摆放三选一里选了 C（显示 worktree 子行，`+` 落在子行上） | 已改：`hasWorktreeRows = isGit === true`；`flat` 容器只留给非 git 工作区；`buildTreeView` 对**所有** git 项目构建 `WorktreeExtra`；`worktreeCount` 语义变为「git 项目恒 = worktrees.length」 |
| 用户决策变更（2026-09-21） | **侧栏行按钮布局重做**：git 项目行只要 `…`（内容仅「新建 worktree」）；非 git 工作区行只要 `+`；「添加工作区」移出二级菜单 | 已改：项目行按 `isGit` 二分渲染动作按钮；项目菜单项从 3 项减到 1 项（非 git 走右键时保留「新建会话」）；`MENU.addWorkspace` 常量与分支删除；顶部搜索行新增独立 `+` 按钮（`t('project.add')`） |
| T7 独立对抗审查 | 21 个缺陷（4 阻塞） | **全部阻塞已修**：D-1 未安装 / D-2 三态只亮两态 / D-3 起始分支跨仓污染 / D-23 测试虚假信心；重要项 D-5～D-11 已修；次要项 D-13 已修；D-9 注释已按真实失败模式改写 |
| 主代理真实数据回放 | **`mainPath` 解析错误** ⇒ 项目标题显示 worktree 名 | 已修（改用 `worktree list` 的 `isMain` 条目；两入口的 `RepoInfo` 逐字节相同） |
| 用户需求变更（2026-09-21） | **侧栏列出了所有 subagent 会话**（原 D10「+ 子代理嵌套」），用户明确要求「只需要列出主 agent 的会话」 | 已修：`isVisibleMember` 逐字对齐原生 `sessionVisible`（新增 `origin !== 'subagent'` 条件），树与搜索**同一谓词**过滤 |
| 用户需求变更（2026-09-21） | **计数胶囊文案与事实不符**：`subagentCount` 统计「直接子代数（不论是否在跑）」，而文案 `a11y.subagents` 是「N 个子代理**运行中**」⇒ 不跑的子代理被算进「运行中」 | 已修：改为统计**运行中的子代理后代数（所有层级）**，与原生 `runningSubagentCount` 逐字一致（真实数据 320 个 id 上与原生参考实现零差异） |
| 用户需求变更（2026-09-21） | **拖拽排序缺失**：D10 原文「拖拽排序不做」，用户要求「拖动排序还是需要的」，并在二选一里选了 A（拖拽即切手动排序并持久化） | 已实现（D10 修订，§5.5.2）：三层拖拽 + `localStorage` 手动顺序 + `menu.resetOrder` 切回默认。范围约束（session 不跨容器 / worktree 不跨项目 / 未分组不参与）在 `onDragOver` 的 `accepts()` 与 `effectiveOrder` 的计算侧**双保险**。真实数据回放（16 工作区 / 274 会话 / 9 仓）：零回归逐字一致、三层顺序均生效、落位差额 0、重复 0 |
| D-23 测试补写 | D-N1 `baseRef` 选项注入（`--no-checkout` 被当选项执行） | 已修（`isSafeGitArg` 挡前导 `-` + `--` 分隔符，fixture 实测兼容性） |
| D-23 测试补写 | D-N2 符号链接绕过 D-5（文件树铺到仓外） | 已修（`realpath` 解析父目录 + `lstat` 识破符号链接；顺带修好 macOS `/var` 拼法误报） |
| 用户需求变更（2026-09-21） | **需求 A：父会话行状态点在「主 agent 空闲但有 subagent 在跑」时是灰 idle**（原实现只读该会话自己的 `SessionSummary.running`），而原生此场景是蓝 ongoing | 已修：`tree-model.ts` 的 `toSessionRow` 把 `running` 算成 `该会话自己的 running \|\| subagentCount > 0`（`subagentCount` = 原生 `runningSubagentCount`，所有层级的**运行中**子代理后代数，多层链由 `indexRunningSubagentDescendants` 一并累加）。判据写在构造函数里 ⇒ 树与搜索**同源**。`runningCount` 口径**不变**（渲染层无消费者，不扩大范围） |
| 用户需求变更（2026-09-21） | **需求 B：新建 / 当前打开的会话没有排在其 worktree 分组最前**。默认模式下宿主 `connectWorkspace` 会**复用**同 cwd 的旧 blank 会话 ⇒ 它 `updatedAt` 很旧、排末尾；手动模式下 `applyManualOrder` 把不在顺序表里的项一律追加末尾，且被 5 条截断吃掉后**整行不可见** | 已修：`applyManualOrder` 新增可选第 4 参 `pinnedKeys`（置顶），`emitContainer` 按 `isCurrent` 传入当前会话 id（**不限于 blank**）。置顶在 5 条截断**之前**生效 ⇒ 一定可见。**纯运行时推导**：`effectiveOrder`（首次拖拽固化 `localStorage` 的输入）刻意**不应用**置顶。⚠️ **该「`isCurrent` 置顶」判据已于 2026-09-22 被用户终裁删除**（见下方 T11 行）：`pinnedKeys` 这一**机制**保留，但**唯一**来源变成 `topZoneSessionKeys`（正在运行 / 尚未落表的新会话） |
| 用户缺陷报告（2026-09-21） | **T5：「新会话 / 刚结束的会话掉到侧栏最下面」**。T4 实测确证根因：用户处于手动排序模式（真实 `localStorage` 表 `"manual":true`），而 `applyManualOrder` 对「不在持久顺序表里」的会话一律**追加到末尾**；新会话新建时是 `blank`、被可见性谓词过滤 ⇒ **不进首次拖拽固化快照**；会话结束后 `isCurrent` 变 false ⇒ T2 的当前会话置顶立即失效 ⇒ 掉回末尾（折叠时被 5 条截断吃掉、整行不可见）。分桶与会话结束**无关**（`grep running src/projects.ts` = 0 匹配），且宿主**不**在会话结束时更新 `updatedAt` ⇒ 「运行中在顶部」无法靠排序键实现 | 已修（用户裁决 D2/D3/D4，见 US8「顶部区」段）：① `topZoneSessionKeys` 把顶部区判据从「仅 `isCurrent`」扩展为 `isCurrent ∪ running（含子代理聚合）∪ 刚结束保留 ∪ 新会话`，**先于 5 条截断**生效；② `observeTopZone` 运行时状态机（纯函数，可单测）判定「新会话」= `blank: true → 非 blank` 的**时间序**证据（**不是**「不在固化表里」—— T4 实测有 4 条旧表外会话，会被误插），并在出现新会话时清空「刚结束保留」；③ `insertSessionAtFront` 只在**手动模式**下把新会话**幂等、去重**地插到其容器固化表最前（D2 的**唯一**落表例外）；④ `releaseTopZoneContainer` 实现 D4 拖动释放；⑤ `currentSessionId` 非字符串的 `TypeError` 加防御守卫（T3 次要问题 1）；⑥ `truncateSessions` 保底分支在树路径不可达的说明补注释（T3 次要问题 3）。T5 新增 53 条测试（**284 → 337**，既有断言**零删除**）。⚠️ **① 的「刚结束保留」「当前会话置顶」两类与 ④ 的释放机制已于 2026-09-22 被用户终裁删除**（见下方 T11 行）；② ③ ⑤ ⑥ 保留 |
| 独立审查阻塞项（2026-09-21，T6 `docs/REVIEW-top-zone.md`） | **B1：D2 写入固化表的 sessionId 形态错误** —— `observeTopZone` 内部用归一化 id（去 `session-` 前缀），落表时把这个**裸 id** 原样写进用户固化表；而 `applyManualOrder` 用树里的**真实 id**（恒带前缀）去 `indexOf` ⇒ 永远匹配不上的**死条目**，并顶掉原本正确的条目。D2 的核心承诺「刷新页面后新会话仍在第一位」**不成立**，实质违反 D1。**B2：`newSessionIds` 只增不减** ⇒ 落表 effect 依赖 `manualOrder`，用户拖动新会话必重跑并把它**静默搬回表首**（编排层不幂等） | 已修（T7，2026-09-21）：**B1** 新增 `placementOfSession`（返回容器 key + **树里的真实 id 形态**），落表前还原原形态；`insertSessionAtFront` 按「表内原形态 > `fullOrder`（= 树里的真实 id）> 调用方形态」取写法，绝不写死条目。**B2** 新增 `planNewSessionInserts`（纯函数编排）+ `markNewSessionsWritten` / `pendingNewSessionIdsOf`：落表后把 id 记进 `TopZoneState.writtenNewSessionIds` 台账 ⇒ **同一个新会话的落表只发生一次**，用户随后拖动**不被回滚**。⚠️ 台账与 `newSessionIds` **分开**记 —— 后者是 D3d 的顶部区输入，新会话在整个页面会话内都应被提升到顶部区。同步修 I2（D4 释放判据解耦出 `isTopZoneReleasingDrag`：拖当前会话到紧邻行也释放；⚠️ 该函数已于 2026-09-22 随释放机制被 T11 删除）、I3（归档会话进 `known` ⇒ 取消归档 + 新消息不误判新会话）、S1（空数组表项用 `fullOrder` 兜底）、S2（契约外 `topZone` 输入不抛 `TypeError`）。T7 新增 13 条测试（**337 → 350**，既有断言**零删除**），其中 D2 端到端用例改用真实 `session-<uuid>` 形态（I1：原用例全用裸 id ⇒ 对 B1 恒真） |
| **真人 GUI 复验缺陷（2026-09-22，T9）** | **缺陷 1：拖动新会话弹回原位**（手动模式下，用户把刚建的新会话拖到分组内另一位置 ⇒ 它被搬回原位）。**缺陷 2：同一分组里另一个正在运行的会话掉到最下面**（拖拽释放语义过宽）。**N1/I3：归档会话在真实链路下仍被误判为新会话**（`buildProjects` 已把归档会话从树里剔除 ⇒ T7 的 `known.add(seen)` 空转；T8 实测真实链路 `newSessionIds = ['oldarch']`）。**N2**：一条端到端用例仍用裸 id fixture（弱用例）。**N6**：PRD 测试数字含不可复现的中间值 | 已修（T9，2026-09-22）：**缺陷 1** —— `topZoneInputOf` 把 `writtenNewSessionIds` 台账**投影进渲染期输入**（`TopZoneInput.writtenNewSessionIds`，新增字段，缺省 ⇒ 旧行为零回归），`topZoneSessionKeys` 据此把**已落表**的新会话排除出渲染期提升 ⇒ 用户拖到哪就留在哪（此前 T7 只做了「不重复写表」，`buildRows` 仍按运行时顶部区把它画回最前）。**缺陷 2** —— `releaseTopZoneContainer` 的语义**收窄为「只清该容器的刚结束保留」**：运行中的会话（D3a）**始终留在顶部区、拖拽不得使其沉底**，当前会话（D3c）不受影响；旧语义「运行中一并失效、刷新恢复」被用户重新裁决**删除**（⚠️ 整个释放机制已于 2026-09-22 被 T11 终裁删除，见下方 T11 行）。**N1/I3** —— `observationsOf` 把 `archivedSessionIds` **单独投影**成 `archived: true` 的观测（真实链路形态下归档会话**不在树里**），单测 fixture 同步改为真实形态。**N2** —— 该用例改用真实 `session-<uuid>` 形态（含「载荷里没有裸 id」回归锁）。**N6** —— 本节测试数字改为**可复现**口径（见下方「测试基线」）。T9 新增/改写测试后全量 **361** 条（`npm test`，见「测试基线」） |
| **真人 GUI 复验缺陷（2026-09-22 第二轮，T11）** | 侧栏呈现三段：`刚结束运行的会话 / 当前正在运行的会话 / 其余会话`，**前两段都拖不动、会回弹**。用户终裁：「**正在运行的会话固定在顶部，拖不动，只要是结束了的会话就不再固定置顶了**」，并明确**不保留**「当前打开的会话」置顶例外。根因（T11 诊断，驱动真实导出复现）：① **「刚结束保留」**（`recentlyFinishedIds`）把 running 下降沿的会话钉在顶部区 ⇒ `buildRows` 无论持久顺序怎么写都把它画回最前（渲染层「拖不动 / 回弹」）；② **「当前会话置顶」**（`isCurrent`）把用户正在查看的旧会话也钉在最前，同样拖不动；③ **「拖动释放」**（`releasedContainerKeys` / `releaseTopZoneContainer` / `isTopZoneReleasingDrag`）的唯一目的是清 ①，① 删除后成为死代码 | 已修（T11，2026-09-22）：**① 删除「刚结束保留」** —— `TopZoneState.recentlyFinishedIds`、`TopZoneInput.recentlyFinishedSessionIds` 字段与 `observeTopZone` 的 running 下降沿写入全部删除。**② 删除「当前会话置顶」** —— `topZoneSessionKeys` 不再读 `currentSessionId`（签名保留仅为向后兼容）、`pinnedSessionKeys` / `currentSessionOf` 死代码删除。**③ 删除「拖动释放」** —— `releaseTopZoneContainer` / `isTopZoneReleasingDrag` / `TopZoneState.releasedContainerKeys` / `TopZoneInput.releasedContainerKeys` 全部删除；`sidebar.tsx` 的 `commitDrag` 不再有任何顶部区动作（拖拽只改写持久顺序）。**④ 新增「运行中不可拖动」** —— 导出纯函数 `isTopZoneRunningSession`（置顶判据与不可拖判据**同源**），`sidebar.tsx` 的 `dragHandlersFor` 新增 `draggable` 参数，运行中的会话行 `draggable: false`（仍接受落点）。**⑤ 清理** `sortTopZone` 的「当前会话恒第一位」表述、`truncateSessions` 保底分支注释、`buildRows` / `effectiveOrder` / `applyManualOrder` 的过时 JSDoc。**保留不回退**：D1（手动/默认模式、不代改用户数据）、D2（新会话落表 + 台账 + `session-` 前缀形态 + 幂等）、D3e（运行时置顶不写 localStorage）、D5（顺序冻结）、D6（`runningCount` 口径）、T9 的渲染期台账修复与归档投影修复。T11 新增/改写测试后全量 **380** 条（`npm test`；⚠️ **该数字是 T11 当时的历史值**，T13 后为 **391**，见下一行与「测试基线」）；新增 **7** 个定点变异实验证明判别力（⚠️ 该表已于 T13 重做 —— 补丁要点 + 修正 fail 计数 + 拆出 M7/M8/M9/M10，见「T11 / T13 变异验证」） |

| **用户终裁（2026-09-22，T13）** | **D12「当前会话保底进前 5」删除**。背景：T11 删除「当前会话置顶」后，`truncateSessions` 的 `promote` 分支从「恒不可达」变成**可达**；T12 复审实测其触发面比原文档披露更宽 —— **默认未折叠态下容器超过 5 条会话即触发**（持久表 `[o0..o7,cur]` ⇒ 渲染 `[o0,o1,o2,o3,cur]`；把 `cur` 拖到第 7 位 ⇒ **渲染视觉零位移**，与用户投诉的首要缺陷**同形**）。**用户裁决：删除该保底，拖拽顺序完全优先**，并接受「当前会话被截断到不可见就是看不见」。**T12 的 N-1**：`src/sidebar.tsx` 不进 `lib/`，T11 的「运行中不可拖 + 判据同源」**零自动回归保护**（T12 实测 M7/M8 变异均 **fail 0**）。**N-3/N-4/N-5/N-6**：注释自相矛盾、变异表不可独立复现、`test/mutation-t11.md` 引用不存在、JSDoc「运行中一定可见」措辞过绝对 | 已修（T13，2026-09-22）：**① 删除 D12 保底** —— `truncateSessions` 的 `promote` 分支与其 `currentSessionId` 形参**一并删除**（导出契约同步收窄为 `(sessions, limit)`，**不留死参数**）；`emitContainer` 调用点不再传「当前会话」线索。**渲染层对已结束会话（含当前会话）的位置完全由持久拖拽顺序决定**。**② 新增源码级契约测试** `test/sidebar-wiring.test.mjs`（8 条）：用 TypeScript 编译器 API 解析**真实 `src/sidebar.tsx`**，断言 `dragHandlersFor` 三形参 / `draggable` 带进返回值 / `onDragStart` 的 `!draggable` 守卫 / session 行调用传入 `!isTopZoneRunningSession(row, topZone)` / worktree·project 行**不传**第 3 实参 / 判据从 `./tree-model.js` import / 全 `src/` 只有**一份**判据声明。M7/M8 变异各 **fail 2**（此前 fail 0），且**格式化 / 注释 / 实参换行不误报**（AST 断言，实测 8/8 pass）。**③ 注释统一**：`COLLAPSED_SESSION_LIMIT`、`truncateSessions`、`emitContainer`、`isVisibleMember`、`buildRows` 的「恒不触发 / 一定可见」矛盾表述全部按 T13 真实状态改写；**④ 文档与测试引用**：`test/mutation-t11.md` **补写**（含每个变异的补丁要点 + T13 实跑 fail 数 + 可执行脚本，N-5）；`docs/PRD.md` 变异表补**补丁要点列**并修正 fail 计数（M5：1→**29**；M4 拆为 M4 完整组合 fail 1 / M4b 等价 fail 0；M6：4→**2**；M7 拆为 M7 `.tsx` 删实参 / M10 完整状态机 fail 7，N-4）；顶部区「一定可见」措辞改为「在截断前生效，但成员 >5 时仍会被截断」（N-6）。**保留不回退**：D1/D2/D3e/D5/D6、T9 台账与归档投影、T11 的运行中不可拖 + 判据同源。全量 **391** 条（`npm test`；⚠️ **T13 当时值**，T15 收尾后为 **393**）；变异矩阵 **11 个**（M1–M10 + M4b）证明判别力（见「测试基线」下方与 `test/mutation-t11.md`） |

| **独立复审跟进（2026-09-22，T15）** | **T14b 复审（`docs/REVIEW-final-verification.md`）结论「建议验收，无阻塞」，提出 5 项非阻塞跟进**：P1 `test/sidebar-wiring.test.mjs:37` 引用**不存在**的 T13 变异记录文件（该文件从未创建，`test/` 下只有 `test/mutation-t11.md`）；P2（最重要）`.tsx` 契约测试存在**真实保护盲区** —— `SessionRowView`（`sidebar.tsx:1038`）的 `draggable` 改成写死 `true` 后 `sidebar-wiring` 8/8 + `tree-model` 250/250 **全绿**，而运行中的会话**实际变成可拖**；且 `topZone` 实参身份未被校验（只要求「非空标识符」⇒ 传 `undefined` 也通过）；P3 `tree-model.ts:1751-1753`「只**剩** blank 豁免一个用途」措辞过强；P4 `docs/INTERFACES.md` 未收录 `truncateSessions` 收窄后的导出签名；P5 `sidebar-wiring.test.mjs:11-14` 的 `fail 0` / `247` 未标注归属旧套件 | 已修（T15，2026-09-22）：**① P1** 引用改为 `test/mutation-t11.md`（§1 变异表 M7/M8），并全仓脚本化扫描 305 处 `*.md` 引用确认**不再有指向不存在文件的引用**（仅余 DSH 本体包相对路径、测试 fixture 文件名、只读历史报告内的自我描述三类误报）。**② P2** `test/sidebar-wiring.test.mjs` 由 **8 条扩到 10 条**，新增两条 `T13/接线[P2]`：`SessionRowView` / `ContainerRowView` 必须把 `drag.draggable` 接到 DOM `draggable` prop（按 AST 解析局部别名，允许改名与等价表达式）；`topZone` 实参必须**身份可追溯**到 `topZoneInputOf(...)` 或其标识符中转（不动点传播），不得写死 `undefined` / 换无关来源；并新增「接线连通」检查（`sessionDrag` 必须真的传进 `jsx(SessionRowView, …)`）。**变异验证（/tmp 副本实跑）**：M-A `draggable: true` 写死、M-B `draggable: row.running !== true`、M-C `topZone ⇒ undefined`、M-D `topZone ⇒ t`、M-E 删 prop、M-F 算了但没传、M-G 容器行同款 —— **7 个各 fail 1**；6 个等价重构（别名改名 / 标识符中转 / 就地 `topZoneInputOf` / 多行+注释 / 去 `!== undefined`）**全部 pass**；既有 R-A（判据抽局部包装函数）仍误报（T13 版本既有行为，T15 未加剧，已在文件头「稳健性取舍」如实声明）。**③ P3** 改为「只**服务三件事**：blank 豁免 / `isCurrent` 高亮 / `topZoneSessionKeys` 兼容形参位」。**④ P4** `docs/INTERFACES.md` §2.2 补录 `truncateSessions` 导出契约（`(sessions, limit) => { visible, hiddenCount }`）与「D12 保底已删除、不得复活」。**⑤ P5** 头注释标注「旧套件 `tree-model.test.mjs` / T12 时代 247 条」。**回归**：全量 **393 / 393 pass**（连跑 2 次）、`typecheck` exit 0、`build` ×2 哈希一致、HEAD 基线 **253** 可复现；D1/D2/T9/D3e/D5/D6/N1/T11 七符号与顶部区红线逐条复验（见 `test/mutation-t11.md` §4） |

### 测试基线（**可复现**口径，2026-09-22 T13 实跑）

> ⚠️ 本节**只保留可直接复现的数字**。历史中间值（「284」等）**无法由任何现存命令复现**
> （需要 T5 之前的历史树快照），已从本节删除；变更记录里保留的「284 → 337」「337 → 350」
> 是历史叙述，其**可复现锚点**是下面的数字。**不要照抄任何前序报告里的数字。**

| 口径 | 命令 | 实测 |
|---|---|---|
| **HEAD 基线**（`11b1144` 的 5 个测试文件） | `git archive HEAD \| tar -x -C /tmp/t13-head` 后在该副本里 `npm test` | **253 / 253 pass**（exit 0） |
| **当前全量（T13 时点）** | `npm test`（= `npm run build && node --test`） | **391 / 391 pass**（exit 0） |
| **当前全量（T15 收尾后）** | `npm test`（= `npm run build && node --test`） | **393 / 393 pass**（exit 0）；连跑 2 次一致 |
| 其中 `tree-model` 单文件 | `node --test test/tree-model.test.mjs` | **250 / 250 pass** |
| 其中 `sidebar-wiring` 单文件（T13 新增 8 条，T15 扩到 **10** 条） | `node --test test/sidebar-wiring.test.mjs` | **10 / 10 pass** |
| 其中 T11 前缀用例 | `grep -c "^test('T11" test/tree-model.test.mjs` | T11 **46** |
| 其中 T13 前缀用例 | `grep -c "^test('T13" test/tree-model.test.mjs test/sidebar-wiring.test.mjs` | T13 **4 + 10 = 14**（T15 后） |

- **测试数只能这样复现**：`npm test` 会先 `npm run build` 重建 `lib/`，所以「HEAD 测试 ×
  当前 lib」的 253 必须在 `/tmp` 的 HEAD 副本里跑（见上表命令）。
- **连跑 2 次**：两次 `npm test` 均 **393 / 393 pass**（exit 0）（T13 时点为 391 / 391）。
- **`npm run typecheck`**：exit 0。
- **`npm run build` 连跑两次**：`lib/tree-model.js` 的 sha256 **一致**（确定性构建）。

### T11 / T13 变异验证（判别力证据）

对 `/tmp` 仓库副本打**定点补丁**恢复旧失效模式，再跑测试套件。

> ⚠️ **本节数字全部为 T13（2026-09-22）实跑**，每个变异都附**补丁要点**（改哪个文件 /
> 哪段语义）⇒ **可独立复现**（T12 复审的 N-4）。完整清单与可执行脚本见
> **`test/mutation-t11.md`**（含每个变异的补丁要点、命中用例名、稳健性检查）。
> 表内 `tree-model` 列 = `node --test test/tree-model.test.mjs`（250 条）；
> `wiring` 列 = `node --test test/sidebar-wiring.test.mjs`（T13 新增 8 条 ⇒ T15 扩到 **10** 条；
> 下表 M1–M10 的 `wiring` 数字为 **T13 的 8 条版本**，T15 复核 M7/M8 仍为 **fail 2**）。

| # | 变异 | 补丁要点（文件 / 语义） | `tree-model` | `wiring` | 被捕获的用例（代表） |
|---|---|---|---|---|---|
| M1 | 恢复「**刚结束保留**」 | `tree-model.ts` `topZoneSessionKeys`：在 `isFresh` 之后加读 `zone.recentlyFinishedSessionIds` 并 `rest.push` | **fail 1** | 0 | `T11/③ 定点回归: 「刚结束保留」已从判据里彻底不可达` |
| M2 | 渲染期**无条件提升**新会话 | `tree-model.ts`：`isFresh = fresh.has(key) && !done.has(key)` ⇒ `fresh.has(key)` | **fail 6** | 0 | `T9/缺陷1 真实生命周期`、`T11/⑤ T9 机制不回退` |
| M3 | 恢复「**当前会话置顶**」 | `tree-model.ts` `topZoneSessionKeys`：加 `isCurrent` 判据并 `rest.push` | **fail 7** | 0 | `T11: 当前会话不再置顶`、`T13/截断: 已结束的当前会话拖到第 8 位` |
| M4 | 恢复「**拖动释放**」**完整组合** | 先打 M1 补丁，再加读 `zone.releasedContainerKeys` 并在命中时清保留 | **fail 1** | 0 | `T11/③ 定点回归` |
| M4b | **只**恢复「释放读取」（**等价变异**） | `tree-model.ts`：读 `releasedContainerKeys` 但不改变行为（`void released`） | **fail 0**（等价） | 0 | —（见下方「等价变异」） |
| M5 | 运行中的会话**可拖动** | `tree-model.ts` `isTopZoneRunningSession`：`return true` ⇒ `return false` | **fail 29** | 0 | `T5/D3a: 自身 running 的会话进顶部区` 等 |
| M6 | 去掉**归档 id 补投影**（N1 回退） | `tree-model.ts` `observationsOf` 补投影：`archived: true` ⇒ `archived: false` | **fail 2** | 0 | `T9/N1 真实链路: 归档会话不在树里 ⇒ 不被误判为新会话` |
| **M7** | **`.tsx` 接线**：删掉 `dragHandlersFor` session 调用的第 3 实参 | `sidebar.tsx`：删掉 `!isTopZoneRunningSession(row, topZone)` 实参 | **fail 0**（盲区） | **fail 2** | `T13/接线: session 行的调用传入 !isTopZoneRunningSession(row, topZone)` |
| **M8** | **`.tsx` 接线**：不可拖判据**分叉** | `sidebar.tsx`：第 3 实参 ⇒ `row.running !== true` | **fail 0**（盲区） | **fail 2** | 同上 |
| M9 | **T13 新语义回退**：恢复 D12 保底 | `tree-model.ts`：`truncateSessions` 重新接受 `currentSessionId` + 恢复 `promote`；`emitContainer` 调用点重新传参 | **fail 6** | 0 | `T13/截断: 已结束的当前会话拖到第 8 位`、`truncateSessions: 第 3 参不再存在` |
| M10 | **完整恢复旧状态机** | `tree-model.ts`：`TopZoneState.recentlyFinishedIds` 字段 + 初值 + `observeTopZone` 下降沿写入 + 两个返回分支 + `TopZoneInput.recentlyFinishedSessionIds` + `topZoneInputOf` 投影 + 判据读取 | **fail 7** | 0 | `T11: 状态机里没有 recentlyFinishedIds 字段`、`T11/① 首要缺陷` |

- **M1 / M4 / M10 是同一失效模式（「刚结束保留」）的三层变异**：判据层（M1）、
  判据+释放组合（M4）、完整状态机（M10）。三者都被捕获 ⇒ 首要缺陷的回归锁有判别力。
- **M2 覆盖「渲染期无条件提升」**这一独立失效模式（T9 缺陷 1 的回退）。
- **M5 覆盖「不可拖动」判据**（但注意它的失败面是 **29 条**，不是旧文档写的 1 条 ——
  `isTopZoneRunningSession` 是**唯一**置顶判据，恒 `false` 会波及全部顶部区用例）。
- **M6** 覆盖归档投影（T9 的 N1 修复）。
- **M7 / M8 是 `.tsx` 盲区**：`sidebar.tsx` 不进 `lib/`，`tree-model.test.mjs` 对它们
  **零失败**；只有 T13 新增的源码级契约测试 `test/sidebar-wiring.test.mjs` 能捕获。
- **M-A…M-G（T15 追加，`.tsx` 下游断链 + `topZone` 实参身份）**：T14b 复审实测出 T13 版本
  的两处保护盲区 —— `SessionRowView`（`sidebar.tsx:1038`）的 `draggable` 写死 `true` 时两套件
  全绿（运行中的会话实际可拖），以及 `topZone` 实参只被要求「非空标识符」（传 `undefined` 也通过）。
  T15 在 `test/sidebar-wiring.test.mjs` 新增两条 `T13/接线[P2]` 断言（8 → 10 条）后实跑：
  `draggable` 写死 `true` / 写死无关表达式 / 删 prop / 容器行同款 / `topZone` 传 `undefined` /
  `topZone` 换无关标识符 / 「算了但没传」—— **7 个变异各 fail 1**（`sidebar-wiring` exit 1），
  而 6 个等价重构写法（别名改名 / 标识符中转 / 就地调用 `topZoneInputOf` / 多行+注释 / 去 `!== undefined`）
  **全部 pass**。唯一误报是「把判据抽成局部包装函数」（T13 版本既有行为，T15 未加剧）。
  逐条补丁要点、命中用例与等价对照见 **`test/mutation-t11.md` §4**。
- **M9 覆盖 T13 本轮的核心裁决**（删除 D12 保底）—— 把保底加回来会立刻让 6 条用例红。
- **等价变异（如实标注，无法被捕获）**：
  1. 把 `TopZoneInput.writtenNewSessionIds` 的**缺省**分支从「不传 ⇒ 全部参与提升」改成
     「不传 ⇒ 全部排除」——`sidebar.tsx` **恒传**该字段（`topZoneInputOf` 的产物），
     真实链路不可达；且既有「零回归」用例锁的是**不传时仍提升**，属**有意保留**的契约。
  2. 把 `topZoneSessionKeys` 的 `void currentSessionId` 删掉而**不**恢复任何逻辑
     （纯死代码清理）——行为逐字等价，**不存在可观察差异**，属等价变异。
  3. **M4b：只恢复 `releasedContainerKeys` 的读取**（而**不**同时恢复「刚结束保留」）——
     保留机制删除后释放读取**没有消费者**，恢复它零可观察差异。旧文档把 M4 记作
     「fail 1」时没写清「必须与 M1 组合」这一前提，T12 复审实测「只恢复释放读取」为
     **fail 0**（等价变异）⇒ 已在本表拆成 M4（完整组合，fail 1）与 M4b（等价，fail 0）。
  4. ~~把 `truncateSessions` 的 `promote` 分支删除~~ —— **该分支已于 T13 删除**（用户终裁），
     不再是「有意保留」的契约；删除它的变异即 **M9 的反向**（恢复它 ⇒ fail 6）。

### 验收须知

1. **必须重启 DSH Desktop**：新增 bundle 需要重新装载 loader 层，`patchReload: "live"` 只覆盖 patch 文件内容的热重载。重启会终结当前会话。
2. **重启后若侧栏仍是原生样式**：说明 entry 未激活。检查 `~/.dsh/logs/` 与浏览器控制台；宿主半边问题需再重启，客户端半边改完刷页即可。
3. **验收请比对不变量而非硬编码数字**（见 §6 US5 的修正）——会话数在持续增长。
4. 首次使用会创建 `~/.dsh/worktree-groups.json`（插件私有台账，记录见过的 worktree 与会话归属）；删除它不影响会话，只会丢失「已关闭 worktree 的会话归位」的历史知识。

## 11. 待办 / 后续

- ~~拖拽排序（需要为三层树重新定义拖拽语义）~~ ⇒ **已实现**（2026-09-21 用户决策变更，D10 修订，见 §5.5.2）
- 中英双语（补一张 en 表 + 接 `ctx.locale`）
- 归档会话查看视图（等宿主 unarchive API）
- `history-worktree-session` 的跨项目全局视图（当前只按项目分桶）

## 12. 追加需求：运行中任务的文件夹 / worktree 图标高亮（2026-10-20）

**需求原文**（用户 2026-10-20）：「workspace 内任意 worktree 有正在运行的任务时，**文件夹高亮**；
worktree 有正在运行的任务时，**其 icon 高亮**。」

**文档**：[需求与验收标准](requirements/2026-10-20-running-task-highlight.md)（AC1–AC13）·
[设计](design/2026-10-20-running-task-highlight.md)（字段语义、边界、渲染落点、刷新、测试矩阵）·
[工作记录](worklog/2026-10-20-running-task-highlight.md)。
**状态**：**T-4 已实现**、**T-5 自动项通过**（定向 + 全量测试、typecheck、build 全绿，变异 M1–M7 已验证）、
**T-6 审查有条件通过**（无 P0/P1；F1–F5 为测试判别力缺口，F6–F9 为文档项）、**T-7 已补测试锁**
（C11–C14 + locale 词条用例，M8–M12 变异全部按预期变红）并完成文档收尾；
**T-8 追加需求已落地**（RT7：所有 workspace 的 project 行聚合本 workspace 的 flat/普通会话，
A7 反转 + 新增 A15，定向 264/264、全量回归与文档同步见工作记录 T-8）；
**T-11 已补锁并更正生效路径**（A15 增加计数/不渲染断言 + M13 变异，堵住 F17-1；「必须重启 DSH Desktop」
改为「重建 client bundle + 刷新页面」，见 §12.4 与审查 §17.8）；
**AC13 视觉待人工验收**（需 `npm run build`（或 `build:client`）→ 刷新页面 → 按设计 §11 十步确认；
刷新无效再重启兜底）。
本节只登记需求与决策，不改变 §5 的 21 项既有决策。

### 12.1 决策表（本轮，编号 `RT*` 与既有 `D*` 不混用）

| # | 问题 | 结论 | 落地约束 |
|---|---|---|---|
| **RT1** | 「正在运行的任务」是否包含子代理 | **包含**（用户拍板）：会话自身 `running === true` **或** 该会话有运行中的子代理 | worktree 判据用聚合口径，与会话行蓝点**同源**（`tree-model.ts` 的 `subagentCountOf` 索引） |
| **RT2** | 文件夹（project）行聚合范围 | **worktree 子项 OR 该 workspace 的普通/flat 会话**（2026-10-20 追加裁决覆盖原「只聚合 worktree 子项」，见 RT7）；**不含**未分组、**不含** history 桶 | project 判据 = `worktrees.some(w => w.hasRunningTasks === true) \|\| flat.hasRunningTasks === true`；未分组行恒 `false` |
| **RT3** | 视觉 | **只高亮** workspace 文件夹图标与 worktree 行首图标（用户拍板）；不整行、不加状态点；主题强调色 + 轻微光晕 | 落点：`ContainerRowView` 的 lead `span`；`color: var(--dsw-alias-state-business-primary, #4176e6)` + `filter: drop-shadow(0 0 2px …)` |
| **RT4** | 刷新 | 接入宿主会话运行状态做**防抖快速刷新**（约 0.3–1 s，用户拍板）；**保留** 30 s 轮询与 focus 强刷 | `runningSignature(status)` + 既有 220 ms 防抖；**禁止**把签名放进 `reload` 的 `useCallback` 依赖 |
| **RT5** | 数据模型（主代理定稿） | `RenderRow` 的 `project` / `worktree` 行新增**必填布尔** `hasRunningTasks`（**additive**） | 字段集合冻结下的 additive 修订；`history`/`session`/`more` 不变 |
| **RT6** | 可访问性与测试钩子（主代理定稿） | locale key **`a11y.runningTask`** = 「有任务正在运行」；高亮行根 `data-running="true"` | key 与文案唯一；`data-running` 仅在 `true` 时出现 |
| **RT7** | **追加需求：所有 workspace 聚合普通/flat 会话**（用户 2026-10-20 追加拍板） | 「无 worktree 的工作区，如果有任务在进行，文件夹 icon 也要高亮」；追问后明确 **所有 workspace 都统计普通会话** —— worktree 都空闲、但有 flat 会话在跑时 project 文件夹也要亮，不局限于完全没有 worktree 的 workspace | project 判定追加 `\|\| flatResult.hasRunningTasks === true`（只取**该 workspace** 的 flat 容器，不并入 `allResults`；非 git 时 `project == workspace`，git 项目的等价容器是 project 级 `flatSessions`，仅作形状守卫）；history / 未分组仍排除；worktree 行判定不变 |

### 12.2 旧裁决 Q1 原样保留（`runningCount` 不改）

`runningCount` 的口径与「渲染层无消费者」的既有裁决**继续有效**，原文保留在：

- [INTERFACES §2.6 裁定 3](INTERFACES.md)：「⚠️ **`runningCount` 的口径刻意不变**（仍只数 `session.running`）：
  渲染层**无消费者**（`grep runningCount src/sidebar.tsx` 为空），用户裁决 Q1 明确「不改」，避免无声扩大契约。」
- §10「实施过程中发现并修复的缺陷」表的需求 A 行：
  「`runningCount` 口径**不变**（渲染层无消费者，不扩大范围）」。
- 回归锁：`test/tree-model.test.mjs` 的「需求 A: 容器/项目行的 runningCount 口径**不变**」用例**保持通过、不得反转**。

**本轮的唯一变化是「新的消费者改用新字段」**：容器高亮读 `hasRunningTasks`，**不读** `runningCount`。
因此「`runningCount === 0` 但 `hasRunningTasks === true`」（只有子代理在跑）是**预期**行为，不是缺陷；
Q1 管的是 `runningCount` 的计数口径，不是「容器行永远不能有运行态视觉」。

### 12.3 非目标（与需求文档 §4 一致）

不加状态点 / 不整行着色 / 不加数字徽章；`history` 的 clock 不高亮；未分组、history **不参与**
project 聚合（flat/普通会话自 2026-10-20 追加裁决起**参与**）；`wide === false` 轨道态与搜索态不处理；
不改宿主、全局配置与 `cordis.patch.yml`；不新增宿主图标名。

### 12.4 验收方式（含两个硬限制）

1. **生效路径：重建 client bundle + 刷新页面（T-11 更正，依据审查 §17.8）**：`hasRunningTasks` 由
   `src/tree-model.ts` 的 `buildRows` 计算，而 `buildRows` **只在 client bundle**
   （`src/sidebar.tsx` → `src/client.tsx` → `lib/client.js`）；宿主 `POST /tree` 只返回原始
   `projects` / `ungrouped`（`src/routes.ts:820-825`、`:1386-1393`），**不产出**该字段。
   ⇒ 最小步骤 = `npm run build`（或只改客户端时的 `npm run build:client`）→ **普通刷新页面**
   （必要时硬刷新）；刷新无效再重启兜底。**仅**「首次安装 / 新增 bundle」（§5 :668）或改了宿主代码
   （`src/index.ts` / `src/routes.ts` / `src/projects.ts`）时才**必须**重启 DSH Desktop。
   （旧说法「由宿主半边产出、必须重启」不准确，已在 T-11 更正；`=== true` 保护仍在：字段缺失不崩。）
2. **视觉只能人工验收**：当前 GUI 无法脚本截图 / 抓 DOM（HTTP 403、无 CDP 端口、无 playwright，T-2 §6）；
   `test/render-smoke.test.mjs` 是 SSR、不跑 effect、渲染不出容器行，不能代替肉眼。
   人工清单见[设计文档 §11](design/2026-10-20-running-task-highlight.md)。

## 13. 追加需求：Workspace 删除、打开对话选中效果与侧栏底部「最近」分区（2026-10-21）

**需求原文**（用户 2026-10-21）：
1. workspace 增加删除选项
2. 打开对话时，对应的对话要有选中效果
3. 参考 ChatGPT App，在左边栏最下面有一个“最近”，按最近活跃时间倒序展示最近的会话，最多展示 100 个，跟工作区有一定的间距

**文档**：[领域术语表](../CONTEXT.md) ·
[需求与验收标准](requirements/2026-10-21-workspace-delete-selection-recent.md)（WSR1–WSR6、AC1–AC12）·
[设计](design/2026-10-21-workspace-delete-selection-recent.md) ·
[工作记录](worklog/2026-10-21-workspace-delete-selection-recent.md)。

| # | 决策 | 结论 |
|---|---|---|
| **WSR1** | 归档工作空间入口 | 顶层「git 项目行」与「非 git 工作区行」的 `…` 菜单与右键菜单均增加「归档工作空间」；非 git 工作区行补齐 hover `…` 按钮及「重命名工作区」；`未分组` 不显示；点击后直接归档（无需弹窗确认） |
| **WSR2** | 归档语义、设置页恢复与重添自动放出 | 归档状态持久化在 `worktree-groups.json` 的 `archivedProjects`，保留宿主 `workspaceRegistry` 记录；归档期间该工作空间及其会话在工作区树、`未分组` 和 `最近` 中一并隐藏；在「设置 → 通用」（`settings.general.item`）提供「已归档的工作空间」列表与「放出」按钮，标题行支持点击折叠/展开且**默认折叠**（显示已归档数量与 `chevronRight` / `chevronDown` 箭头，展开后显示列表或空态）；在首页或侧栏重新添加相同目录时自动从已归档中放出 |
| **WSR3** | 当前选中会话数据源 | `src/live-state.ts` 新增 `currentSessionIdOf`，兼容宿主 `0.2.1-rc.2` 的 `byId[*].retainedBy.mainView > 0`（受 `usePanelInfo` 约束）、旧版 `sessionsSnapshot.current` 与点击乐观选中；`tree-model.ts` 对 `currentSessionId` 统一做 `session-` 前缀归一化 |
| **WSR4** | 选中对话行视觉 | 高对比度选中底色 + 左侧 3px 品牌蓝指示条 + `fontWeight: 600` + `aria-current="true"` + `data-selected="true"` |
| **WSR5** | 「最近」范围与「未分组」 | **全局汇总 + 保留「未分组」**：「最近」汇总全局所有未归档工作空间及未分组的可见主会话（按归一化 `sessionId` 去重），工作区列表末尾仍保留 `未分组` |
| **WSR6** | 「最近」展示与交互 | 侧栏最下方，与工作区留出明显间距（18px）；标题「最近」可点击整体折叠/展开（默认展开，不做 5 条截断），按 `updatedAt` 倒序最多展示 `100` 个（`RECENT_SESSION_LIMIT = 100`）；不可拖拽，保留状态点/子代理胶囊/右键菜单，与上方工作区对应行同步选中高亮 |

## 14. 追加需求：移除工作区行的会话数显示（2026-10-21）

**需求原文**（用户 2026-10-21）：「现在工作区会显示里面的会话数，去除这个会话数的显示」。

**文档**：[工作记录](worklog/2026-10-21-workspace-session-count-removal.md) ·
[接口契约 §2.3](INTERFACES.md)。

| # | 决策 | 结论 |
|---|---|---|
| **WSR7** | 工作区行的会话数 | 顶层工作区行（`RenderRow.kind === 'project'`，含 `未分组`）**不再渲染**右侧的 `sessionCount` 数字；图标、折叠箭头、名称、`[主]` 标记与 hover 动作按钮保持不变。`sessionCount` 字段与统计口径（只数顶层会话）**保留**在数据层，供折叠计数、状态派生与测试使用；「最近」分区标题行的数量显示**不在本次范围**，保持现状。 |


## 15. 追加需求：同位置「新建会话」保留未发送草稿（2026-10-22）

**需求原文**（用户 2026-10-22）：「在新建一个会话后，输入了一部分内容，此时我切换到其他会话，再点击新建会话，没有了刚才输入的草稿；
同个位置（同个 worktree 或无 worktree 的工作空间）的新会话是要保留草稿的。」

**根因**：草稿按**会话 id** 持久化在浏览器 `localStorage`（`dsh.conversation.<sessionId>`,
宿主 `dsh-client-ui-conversation/lib/client.js:4426/4464`）；插件侧栏所有「新建会话」入口
都以**单参**调用 `uiWorkspace.startSession(workspaceId)`，宿主 `connectBlank(..., undefined)`
分支因此**每次铸新空白会话**（`dsh-client-ui-workspace/lib/client.js:1403`），而带草稿的旧
blank 会话又被 `sessionVisible()` 的「blank 只显示当前那一条」隐藏（`:964`）⇒ 草稿在界面上
不可达。

**文档**：[需求与验收标准](requirements/2026-10-22-new-session-draft-retention.md) ·
[设计](design/2026-10-22-new-session-draft-retention.md) ·
[工作记录](worklog/2026-10-22-new-session-draft-retention.md) ·
[接口契约 §2.3 / §2.4](INTERFACES.md) ·
[宿主契约 §B1.2](HOST-CONTRACTS.md)。

| # | 决策 | 结论 |
|---|---|---|
| **DR1** | 同位置已存在带草稿的空白会话时点「新建会话」 | **复用该空白会话**：宿主 `startSession(workspaceId, { clearPreviousDraft: false })` → `createInWorkspace` 按 `summary.cwd === workspace.path` 找回 blank 会话并复用同一 `sessionId`，对话区按同一 id 恢复草稿；不再铸第二条。用户经 AskHuman 确认（2026-10-22）。 |
| **DR2** | 「同个位置」的判据 | 以**目录（cwd）**为准：同一 worktree 路径，或同一无 worktree 的非 git 工作区路径；跨 worktree 不互相复用（宿主 `createInWorkspace` 的 `cwd` 过滤天然满足）。 |
| **DR3** | 生效入口 | 插件自有的全部「新建会话」入口：worktree 行 `+`、worktree 右键菜单、非 git 工作区行 `+`、非 git 工作区右键菜单、新建 worktree 成功后的自动开新会话。宿主 Shell 顶部「新建会话」按钮不属于本插件槽位，**不改**。 |
| **DR4** | 复用后「新会话」的位置（2026-10-22 复验追加） | 当前打开的**空白会话**（「新会话」占位行）**恒在其容器最前**：先于手动排序、先于顶部区、先于 5 条截断（判据 `isCurrentBlankSession`，渲染期推导、**不写**持久顺序）。与宿主 `sectionMembers` / `pinCurrentBlank` 同语义。反向约束：**非 blank** 的当前会话不得因此置顶（T11 终裁不回退）。 |
| **DR5** | 该占位行的拖拽（2026-10-22 复验追加） | **不可起拖**（仍接受别的会话落到它上/下方）：判据 `isSessionDragLocked` = 运行中（与置顶判据同源）∪ 当前空白占位行。否则被钉在最前的行「拖完弹回」；宿主原生同样不给 blank 行起拖。 |

**非目标**：不改 blank 会话的渲染规则；不迁移 `dsh.conversation.<id>` 存储；不新增路由、
不改台账；不修改宿主 Shell 顶部按钮。

## 16. 追加需求：「最近」分区按会话最后更新时间（任意活动）倒序（2026-10-29）

**需求原文**（用户 2026-10-29）：「最下面的『最近』中，如果历史对话有更新，应该上浮到上面，即根据最后更新时间倒序」。

**根因**：「最近」的排序代码本身按 `updatedAt` 降序，但宿主 `updatedAt = max(createdAt, lastPromptAt)`
（`dsh-api-session-controller/lib/types/list.js`），而 `lastPromptAt` **只在用户发言时推进**；助手回复、
工具执行、子代理/后台任务活动都不会改变它 ⇒ 持续被更新的会话停在最后一次用户发言的位置。

**文档**：[需求与验收标准](requirements/2026-10-29-recent-any-activity-sort.md)（RAS1–RAS5、AC1–AC8）·
[设计](design/2026-10-29-recent-any-activity-sort.md) ·
[工作记录](worklog/2026-10-29-recent-any-activity-sort.md) ·
[接口契约 §2.3.3](INTERFACES.md) · [领域术语表](../CONTEXT.md)。

| # | 决策 | 结论 |
|---|---|---|
| **RAS1** | 「最后更新时间」口径 | **任何活动都算**：用户消息、助手回复、工具调用/结果、turn 事件、子代理活动。用户经 AskHuman 确认（2026-10-29）。 |
| **RAS2** | 活动时间数据源 | 宿主 Cordis 事件 `session/event(session, event)` 的 `event.time`，取会话历史最大值；进程内 `Map` 记录（LRU 上限 4096），不读日志、不扫盘。 |
| **RAS3** | 子代理归属 | 子代理事件时间沿 `parentSessionId` 传播到祖先主会话；「最近」仍只渲染可见主会话。 |
| **RAS4** | 回退与持久化 | `lastActivityAt = max(updatedAt, 活动记录)`；无记录时等于 `updatedAt`。活动表**不做**跨重启持久化，重启后回退 `updatedAt`（已披露限制）。 |
| **RAS5** | 影响面 | 只有「最近」分区使用 `lastActivityAt`；上方工作区树的容器顺序、顶部区与手动排序保持按 `updatedAt` / 手动表不变。 |

**非目标**：不改收录范围、可见性过滤与 100 条上限；不改客户端轮询节奏；不改宿主对 `updatedAt`
的定义；不为活动表新增持久化文件。

## 17. 追加需求：整体性能优化 + 会话列表渐进式展开（2026-11-14）

**需求原文**（用户 2026-11-14）：「插件性能有点差，比如新的 worktree 显示不及时，会话多时新增会话出现得比较慢，
对整个插件进行无与伦比的性能优化」；「展开其余会话：首次点击额外展开 5 个，再次点击再展开 10 个，以此类推，
每次点击多展开 5 个；收起工作区或 worktree 自动折叠；最下面的『最近』也使用一样的逻辑，且不再限制 100 个」。

**文档**：[需求与验收标准](requirements/2026-11-14-perf-progressive-expand.md)（PX1–PX6、PERF1–PERF7、PX-AC1–AC6）·
[设计](design/2026-11-14-perf-progressive-expand.md) · [工作记录](worklog/2026-11-14-perf-progressive-expand.md) ·
[接口契约 §1.5 / §2.2 / §2.3 / §2.3.4](INTERFACES.md) · [领域术语表](../CONTEXT.md)。

| # | 决策 | 结论 |
|---|---|---|
| **PX1** | 展开节奏 | 默认 5；第 k 次点击多展开 5·k 条（可见 5/10/20/35/55…） |
| **PX2** | 收起入口 | 展开过一次后同一行提供「收起」；全部展开完只剩「收起」 |
| **PX3** | 联动 | 折叠工作区 / worktree / 「最近」⇒ 其下容器层级清零 |
| **PX4** | 「最近」 | 默认 5 条，同样渐进展开，取消 100 条上限（覆盖 §13 WSR6 的 100 条与 §16 非目标中的上限表述） |
| **PX5** | 持久化 | 层级存 `localStorage['dsh-worktree-groups.expandLevels']` |
| **PX6** | 子代理模型 | 用户指定 DeepSeek Flash，但会话路由不允许，经确认改用 GLM |

**非目标**：不改会话归属规则、手动排序、顶部区与「最近」排序口径；不改宿主代码。
