# 工作记录：归档工作空间（含设置页恢复与重添自动放出）、打开对话选中效果与侧栏底部「最近」分区

- **日期**：2026-10-21
- **主题**：Workspace 归档工作空间（设置页管理 + 重添相同目录自动放出）、打开对话选中高亮修复与增强、左边栏底部「最近」100 条会话分区
- **状态**：已完成
- **相关文档**：
  - [领域术语表（CONTEXT.md）](../../CONTEXT.md)
  - [需求与验收标准](../requirements/2026-10-21-workspace-delete-selection-recent.md)
  - [技术设计](../design/2026-10-21-workspace-delete-selection-recent.md)
  - [PRD §13](../PRD.md)
  - [接口契约](../INTERFACES.md)

## 1. 目标与范围

1. **归档工作空间（需求 1 修订）**：
   - 顶层 git 项目行与非 git 工作区行菜单提供「归档工作空间」（非 git 行补齐 hover `…` 按钮及「重命名工作区」）；点击后直接归档。
   - 归档期间工作空间及其会话从侧栏（工作区树、未分组、最近）一并隐藏，底层工作区记录与文件完好保留。
   - 在 DSH「设置 → 通用」（`settings.general.item`）中提供「已归档的工作空间」管理卡片，支持点击「放出」恢复。
   - 在首页或侧栏重新添加相同目录（或同 Git 仓下的目录）作为工作空间时，自动从已归档中放出来。
2. **打开对话选中效果（需求 2）**：
   - 修复宿主 `0.2.1-rc.2` 移除 `sessions.list.current` 导致 `currentSessionId` 恒为 `undefined` 的缺陷，兼容 `byId[*].retainedBy.mainView > 0` + `usePanelInfo` + 乐观选中，并在 `tree-model.ts` 中对 `currentSessionId` 做 `session-` 前缀归一化。
   - 增强选中视觉：高对比度选中底色 + 左侧 3px 品牌色竖条指示器（`active-bar`）+ `fontWeight: 600` + `aria-current="true"` + `data-selected="true"`。
3. **左边栏底部「最近」分区（需求 3）**：
   - 参考 ChatGPT App，在侧栏最下方间隔展示「最近」分区（`marginTop: 18` + 顶部分隔线），汇总全局所有未归档工作空间及未分组的可见主会话，按 `updatedAt` 倒序最多展示 `100` 个（`RECENT_SESSION_LIMIT = 100`），标题可点击整体折叠/展开，不做 5 条截断，不可拖拽，与上方工作区对应行同步选中高亮；原 `未分组` 保留。

## 2. 计划与决策

通过 `/grill-with-docs` 与用户逐项确认了 WSR1–WSR6 决策（含将需求 1 从“删除工作区”修订为“归档工作空间 + 设置页恢复 + 首页重添自动放出”），并将核心领域术语沉淀至根目录 `CONTEXT.md`。

## 3. 执行与产物

| 文件 | 变更内容 |
| --- | --- |
| `CONTEXT.md` | 新建领域术语表，定义 `Workspace`、`Worktree`、`History Bucket`、`Archive Workspace`、`Unarchive Workspace`、`Remove Worktree`、`Active Conversation`、`Ungrouped`、`Recent Section` |
| `src/locales.ts` | 新增 `section.recent`、`menu.archiveWorkspace`、`settings.archivedWorkspaces.*` 词条 |
| `src/live-state.ts` | 新增 `currentSessionIdOf` 纯函数（兼容 `0.2.1` `retainedBy.mainView > 0`、`usePanelInfo`、`0.1.5` `sessions.current` 与乐观选中兜底） |
| `src/tree-model.ts` | 新增 `RECENT_SESSION_LIMIT = 100`、`RECENT_KEY = '__recent__'`、`buildRecentRows`、`SidebarModelInput.includeRecent`、`RenderRow` 的 `recent` 变体与 `rs:<sessionId>` 键，以及 `isCurrentSession` 前缀归一化比较 |
| `src/types.ts` / `src/ledger.ts` | 新增 `ArchivedProjectRow` 与 `LedgerArchivedProject`（`LedgerData.archivedProjects`）持久化 |
| `src/routes.ts` | 新增 `archiveWorkspaceProject`、`unarchiveWorkspaceProject`（支持按 `projectKey` 或 `path` / `realpath` / 同 git 仓 worktree 路径自动解除归档），并在 `buildTreePayload` / `ROUTE_PATHS.tree` / `ROUTE_PATHS.workspaceOpen` 中集成 |
| `src/sidebar.tsx` / `src/client.tsx` | 接入 `currentSessionIdOf`、选中态样式与 `active-bar`、`RecentSectionHeaderView`、菜单「归档工作空间」动作、`ArchivedWorkspacesSettingItem`（注册到 `settings.general.item`，标题行默认折叠/可点击展开并带数量与箭头）及 `workspaces.create` 重添自动放出拦截 |
| `test/*.test.mjs` | 新增 AC1–AC10 对应的单测、集成测试与 AST 接线测试 |

## 4. 验证证据（TDD Red → Green）

| 循环 | Red 阶段命令与结果 | Green 阶段命令与结果 |
| --- | --- | --- |
| 循环 1（`locales`） | `npm run build && node --test test/locales.test.mjs` → **fail 1** (`undefined !== '最近'`) | 补齐 `src/locales.ts` 词条后重跑 → **10 / 10 pass** |
| 循环 2（`live-state`） | `npm run build && node --test test/live-state.test.mjs` → **fail 1** (`does not provide an export named 'currentSessionIdOf'`) | 实现 `currentSessionIdOf` 后重跑 → **23 / 23 pass** |
| 循环 3（`tree-model`） | `npm run build && node --test test/tree-model.test.mjs` → **fail 1** (`does not provide an export named 'RECENT_KEY'`) | 实现 `isCurrentSession` 与 `buildRecentRows` 后重跑 → **268 / 268 pass** |
| 循环 4（`routes` & `ledger`） | `npm run build && node --test test/routes.test.mjs` → **fail 1**（首次因缺少导出红；实现后发现 `updateLedger` 漏保 `archivedProjects` 及 macOS `/var` 软链拼法差异导致 `§10 WSR2` fail 1） | 修复 `updateLedger` 保留 `archivedProjects` 并补齐 `realpath` 路径匹配后重跑 → `ledger` **19 / 19 pass**、`routes` **74 / 74 pass** |
| 循环 5（`sidebar-wiring` & `render-smoke`） | `node --test test/sidebar-wiring.test.mjs` → **fail 3**（AC8/AC9/AC10 尚未接线） | 完成 `src/sidebar.tsx` 与 `src/client.tsx` 接线后重跑 → **33 / 33 pass** |
| 循环 6（真机验收反馈 2 项修复） | ① 宿主未重启时服务端旧路由未过滤已归档工作空间；② `rowStyle` 用 `paddingLeft` 缩进导致左侧空白缩进区也被选中底色覆盖。新增 `AC7-client` 与 `Fix1&Fix2` 测试 → **fail 2** | ① 客户端 `localStorage`（`dsh-worktree-groups.archivedProjects`）与 `SidebarModelInput.archivedProjectKeys` 双写过滤，无需重启宿主即刻隐藏/恢复；② `rowStyle` 改用 `marginLeft: Math.max(0, indent - 6)` 承载缩进，使高亮背景从内容起点开始、排除左侧空白缩进区。重跑 `npm test` → **479 / 479 pass** |
| 循环 7（设置中已归档工作空间列表默认折叠与展开/折叠切换） | `node --test test/sidebar-wiring.test.mjs` → **fail 1**（新增 `2026-10-21/AC8-collapse`：`ArchivedWorkspacesSettingItem 必须声明 expanded state（默认折叠）`；33 条中 32 pass / 1 fail） | `ArchivedWorkspacesSettingItem` 新增 `const [expanded, setExpanded] = useState(false)`；标题行改为 `role="button"` / `tabIndex=0` / `cursor: pointer` / `'aria-expanded': expanded` / Enter+Space 切换，右侧显示数量徽章与 `expanded ? icon('chevronDown') : icon('chevronRight')` 箭头；下方列表/空态用 `expanded ? (...) : null` 门控，默认折叠。重跑定向测试 → **33 / 33 pass**；`npm run typecheck` → **exit 0**；`npm test`（含 build）→ **480 / 480 pass** |

## 5. 结果与后续

- 全部自动化测试（480 条）与类型检查、构建均已通过。
- **生效说明**：刷新页面即可加载最新 `lib/client.js`，工作空间归档/恢复、设置页已归档列表折叠（默认折叠）与选中高亮缩进范围均无需重启 DSH Desktop 即可立即生效。

## 6. 独立审查与文档修正（T-3 / T-4 闭环）

- **T-3 独立审查（2026-10-21）**结论：
  - `npm run typecheck` → **exit 0**；定向测试 **35 / 35 pass**；全量 `npm test` → **480 / 480 pass**；
  - 3 组 AST 变异验证（`ArchivedWorkspacesSettingItem` 默认折叠、`currentSessionIdOf` 的 `mainView` 判定、
    已归档工作空间过滤）**均被测试捕获**（变异体全部 fail），说明相关断言有效、非空转；
  - 唯一发现：文档漂移 —— `docs/INTERFACES.md` §1.5 路由表与需求 AC7/AC8、设计 §2.4.3 / §2.5 仍把
    归档 / 放出写成两个**独立的 POST 端点**（路径为 `/dsh-worktree-groups/` 前缀加归档、放出后缀），
    与真实实现（`ROUTE_PATHS` 仅 5 条、归档/放出复用 `POST /dsh-worktree-groups/tree` 的
    `{ archiveProjectKey, unarchiveProjectKey, unarchivePath }` 请求体）不一致。
- **T-4 文档修正（2026-10-21）**：仅改文档、未动 `src/` 与 `test/`。
  - `docs/INTERFACES.md` §1.5：路由表恢复为 5 行（`tree` / `worktree-create` / `worktree-remove` /
    `reveal` / `workspace-open`），`tree` 行补全请求体 `{ archiveProjectKey?, unarchiveProjectKey?, unarchivePath? }`
    与响应 `archivedProjects`；新增「`tree` 承载归档 / 放出动作」说明与
    `archiveWorkspaceProject` / `unarchiveWorkspaceProject` 导出签名。
  - `docs/requirements/…-workspace-delete-selection-recent.md` AC7 / AC8：改为上述真实路由 + 导出函数 +
    客户端 `localStorage` `dsh-worktree-groups.archivedProjects` 双写同步。
  - `docs/design/…-workspace-delete-selection-recent.md` §2.4.3 / §2.5：同上对齐，并补充客户端在
    `{ unarchivePath }` 与 `{ archiveProjectKey }` 上的实际调用方式。
  - 验证：对 `docs/` 全目录搜索已废弃的归档 / 放出端点路径后缀（即 `workspace-` 加归档/放出动作名）
    → **零匹配（grep exit 1）**，`docs/` 下已不存在把这两个路径当作有效路由契约的表述；
    同时 `docs/INTERFACES.md` 路由表只剩 5 行，与 `ROUTE_PATHS` 一一对应。

## 7. 新增工作区按钮点击无反应缺陷修复（2026-10-21 Fix3 / T-7）

- **状态**：已完成（TDD Red → Green）
- **现象**：在 DSH Desktop 里点击侧栏顶部搜索框右侧的「添加工作区 `+`」按钮**没有任何反应**；
  Web 形态在宿主 `remote.directoryPicker` 缺席时同样无反应、且无任何错误提示。
- **根因**（T-6 已核实，本节只记录结论与出处）：
  1. DSH Desktop 在 `/Applications/DSH Desktop.app/Contents/Resources/app/lib/preload.cjs:24-28`
     注入了 `globalThis.__DSH_DIRECTORY_PICKER__.pick()`（走 Electron 主进程
     `dialog.showOpenDialog`），并注明宿主 macOS `osascript` 选择器（`uiWorkspace.pickDirectory()`
     背后的远程调用）在 Desktop 下会等待 AppleEvents 不显示窗口或超时。
  2. 官方 `@deepseek-ai/dsh-client-ui-directory-picker-native/lib/client.js:63-64` 的真实写法是
     `const desktop = globalThis.__DSH_DIRECTORY_PICKER__; const pick = desktop === void 0 ? () => ctx.uiWorkspace.pickDirectory() : () => desktop.pick()`。
  3. 本插件旧的 `src/client.tsx` `bridge.pickDirectory()` 漏掉 Desktop 分支，直接调
     `uiWorkspace()?.pickDirectory?.()`，并用 `catch { return null }` 把**所有**异常
     （含远程 browse 后端抛出的 `directory-picker/unavailable`）吞成「用户取消」⇒
     `addWorkspace` 静默 return ⇒ **点击毫无反应**。
- **修复设计（三层链路，用户可见行为）**：
  1. **Desktop 优先**：`bridge.pickDirectory()` 先 `typeof globalThis.__DSH_DIRECTORY_PICKER__?.pick === 'function'`
     ⇒ `await pick()`，字符串即路径、非字符串视为取消。
  2. **宿主 native 回退**：无 Desktop 桥时 `uiWorkspace()?.pickDirectory()`，`null` = 用户取消。
  3. **应用内兜底**：两者都不可用 ⇒ **抛** `directory-picker/unavailable`（不再静默吞错）。
     `sidebar.tsx` 的 `addWorkspace` 捕获后 `setAddWorkspaceOpen(true)`，打开
     `AddWorkspaceDialog`（`P.Modal` + 目录绝对路径输入框 + 取消/确定），确认后
     `actions.createWorkspace(path)`（`bridge.createWorkspace`；`bridge` 缺席时回退
     `POST /dsh-worktree-groups/workspace-open`）再 `reload()`；失败在弹窗内显示错误文案，
     **绝不静默无反应**。用户主动取消（`null`）不弹窗。
- **改动文件**：`src/client.tsx`（pickDirectory 三层链路）、`src/sidebar.tsx`（`Actions.createWorkspace`、
  `addWorkspace` 弹窗兜底、`AddWorkspaceDialog`）、`test/sidebar-wiring.test.mjs`（Fix3 AST 测试）、
  `docs/INTERFACES.md`（§2.3 搜索行 / §2.7 裁定 5 补充）、本工作记录；`lib/client.js` 由 `npm test` 构建产出。
- **执行的 TDD 循环**：
  - **Red**：`test/sidebar-wiring.test.mjs` 新增
    `2026-10-21/Fix3: pickDirectory 优先走 __DSH_DIRECTORY_PICKER__.pick 并提供路径输入弹窗兜底`
    （AST 断言 `client.tsx` 的 `pickDirectory` 优先顺序 / 无 `catch` / 抛 `directory-picker/unavailable`；
    `sidebar.tsx` 声明并使用 `AddWorkspaceDialog`、`addWorkspaceOpen` 状态、catch 中打开弹窗）。
  - **Green**：按上述设计改 `src/client.tsx` 与 `src/sidebar.tsx`，`npm run typecheck` + `npm test` 全绿。
- **验证证据**：见 §7.1（Red / Green 命令、退出码与通过数）。
- **限制**：未在真实 DSH Desktop 进程内做人工点击验收（本任务只做自动化验证），Electron 原生框
  依赖宿主 `preload.cjs` 注入的 `__DSH_DIRECTORY_PICKER__`；若宿主未来改名，回退链会转入弹窗兜底而非无反应。

### 7.1 Red / Green 证据

| 阶段 | 命令 | 结果 |
| --- | --- | --- |
| Red | `node --test test/sidebar-wiring.test.mjs` | **exit 1**：`tests 34 / pass 33 / fail 1`，失败点 `AssertionError: ★ pickDirectory 必须先检查 globalThis.__DSH_DIRECTORY_PICKER__…`（行为缺失，非语法/环境错误） |
| Green（定向） | `node --test test/sidebar-wiring.test.mjs` | **exit 0**：`tests 34 / pass 34 / fail 0` |
| Green（类型） | `npm run typecheck` | **exit 0**（`tsc --noEmit` 无输出） |
| Green（全量） | `npm test`（内部 `npm run build` 后 `node --test`） | **exit 0**：`tests 481 / pass 481 / fail 0`；`lib/client.js` 已重建（含 `__DSH_DIRECTORY_PICKER__` 与 `AddWorkspaceDialog`） |

### 7.2 T-8 独立审查发现：目录选择与 `createWorkspace` 异常边界混同（T-9 返工闭环）

- **状态**：已完成（TDD Red → Green）
- **T-8 审查发现**（只记录结论，出处见独立审查记录）：
  1. `src/sidebar.tsx` 的 `actions.addWorkspace` 把 `bridge.pickDirectory()` 与
     `bridge.createWorkspace(picked)` 串在**同一个方法**里，外层 `addWorkspace` 回调只有
     **一个** `try { … } catch { setAddWorkspaceOpen(true) }`。若原生选择器成功选出目录、
     但随后的 `createWorkspace(picked)` 抛错，会**误打开空白 `AddWorkspaceDialog`**，并吞掉真实的
     `createWorkspace` 错误 —— 违背 `docs/INTERFACES.md`「宿主 `createWorkspace` 失败落 `loadError` 行」。
  2. `bridge === undefined` 时若走 `bridge?.pickDirectory()`（可选链）会返回 `undefined` 而不抛错，
     被当成「用户取消」静默返回 ⇒ 无弹窗兜底。
- **修复设计**（两段独立异常边界）：
  1. `Actions` 移除语义混合的 `addWorkspace()`，改为暴露 `pickDirectory(): Promise<string | null>`；
     实现中 `bridge === undefined` 时**显式抛** `directory-picker/unavailable`，否则
     `return await bridge.pickDirectory()`（不 catch，异常原样上抛）。
  2. `addWorkspace` 回调拆成两段 `try/catch`：
     - 第一段（目录选择）：`await actions.pickDirectory()`；抛错 ⇒ `setAddWorkspaceOpen(true); return`；
       返回空值（用户取消 `null`）⇒ 直接 `return`，不弹窗、不报错；非空字符串 ⇒ 继续。
     - 第二段（建档）：`await actions.createWorkspace(picked); reload()`；抛错 ⇒
       `setLoadError(error instanceof Error ? error.message : t('error.load'))`，不再误开弹窗。
- **改动文件**：`src/sidebar.tsx`（`Actions.pickDirectory` + `addWorkspace` 两段异常边界）、
  `test/sidebar-wiring.test.mjs`（Fix3 测试追加 §6 AST 断言：`Actions` 暴露 `pickDirectory`、
  回调内恰有包围 `pickDirectory` / `createWorkspace` 的**两个不同** `try` 语句、选择阶段 catch 含
  `setAddWorkspaceOpen(true)` 且不含 `setLoadError`、创建阶段 catch 含 `setLoadError` 且不含
  `setAddWorkspaceOpen`）；本工作记录；`lib/client.js` 由 `npm test` 构建产出。
- **验证证据**：

| 阶段 | 命令 | 结果 |
| --- | --- | --- |
| Red | `node --test test/sidebar-wiring.test.mjs` | **exit 1**：`tests 34 / pass 33 / fail 1`，失败点 `AssertionError: ★ Actions 必须暴露 pickDirectory()，使目录选择阶段的异常可被 addWorkspace 单独捕获`（行为缺失，非语法/环境错误） |
| Green（定向） | `node --test test/sidebar-wiring.test.mjs` | **exit 0**：`tests 34 / pass 34 / fail 0` |
| Green（类型） | `npm run typecheck` | **exit 0**（`tsc --noEmit` 无输出） |
| Green（全量） | `npm test`（内部 `npm run build` 后 `node --test`） | **exit 0**：`tests 481 / pass 481 / fail 0`；`lib/client.js` 已重建（含 `pickDirectory` 独立方法、两段 `try/catch` 与 `directory-picker/unavailable`） |

- **限制**：仍未在真实 DSH Desktop 进程内人工点击验收；本闭环只验证源码接线与全量自动化回归。
  目录选择器成功但 `createWorkspace` 失败的用户可见行为（`loadError` 行）依赖宿主 `workspaces.create`
  真实抛错路径，自动化测试以 AST 断言固定该分支，未构造真实宿主故障注入。
