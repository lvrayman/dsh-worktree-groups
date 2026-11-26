# 2026-11-26：修复新建 Worktree 弹窗显示不全并重构为 IDEA 风格交互

## 基本信息

- **日期**：2026-11-26
- **主题**：修复「新建 worktree」弹窗横向裁切问题，并将表单交互与路径能力对齐 JetBrains IDEA 的 New Worktree 管理逻辑
- **状态**：已完成

## 1. 背景与需求

用户反馈右键新建 worktree 的弹窗目前有两个痛点（附当前弹窗截图与 IDEA `New Worktree` 参考截图）：

1. **弹窗显示不全**：当前 `CreateWorktreeDialog` 内部容器写死 `minWidth: 380`，超过宿主 `P.Modal` 默认内容区宽度，导致右侧输入框、路径预览和「创建」按钮被弹窗容器裁切。
2. **使用逻辑对齐 IDEA 的 New Worktree**：
   - **基于分支（`From branch:`）**：下拉选择仓库所有分支（本地分支 + 远端分支），并标注已检出到现有 worktree 的分支及其目录名（如 `master (dsh-worktree-groups)`）；默认选中主仓当前分支。
   - **新建分支（`[ ] New branch:`）**：复选框 + 文本输入框；默认不勾选，输入框禁用。
     - 未勾选时直接检出 `From branch`；若所选本地分支已在某 worktree 中检出（或远端分支对应的同名本地分支已检出），则禁用提交按钮并给出清晰提示（与 IDEA 中选 `master` 未勾选 `New branch` 时 `Create Worktree` 置灰一致）。
     - 勾选后启用新分支名输入框，以 `From branch` 为起点新建分支；若新分支名为空或与已有本地分支重名，则禁用提交按钮并提示。
   - **目录名（`Project name:`）**：可编辑文本输入框，默认自动跟随 `<主仓名>-<有效分支 sanitize>`（未手动编辑前随 `From branch` / `New branch` 联动，手动编辑后不再自动覆盖）。
   - **位置（`Location:`）**：可编辑文本输入框（默认 `<主仓父目录>`），右侧带目录选择按钮（复用 `actions.pickDirectory()`）。
   - **目标路径预览**：在位置下方展示 `worktree 将创建在：<Location>/<Project name>`。
   - **操作按钮**：`取消` / `创建 Worktree`。

### 验收标准

- **AC1（弹窗布局不裁切）**：`CreateWorktreeDialog`（及侧栏其他弹窗）不写死超过 `P.Modal` 容器宽度的 `minWidth`，所有表单项、预览路径与底部按钮均在弹窗内完整显示，长路径自动换行或省略不撑破容器。
- **AC2（全量分支列举）**：宿主新增 `listRepoBranches(repoPath, signal)` 与 `POST /dsh-worktree-groups/worktree-branches`（支持本地与远端模式转发），返回仓库本地分支与远端分支（排除 `*/HEAD`），标出当前分支与已检出 worktree 的目录名与路径；按「当前分支 → 其余本地分支 → 远端分支」排序。
- **AC3（IDEA 交互状态机）**：纯逻辑模块 `src/worktree-form.ts` 完整实现：
  - 默认未勾选 `新建分支`、`From branch` 默认当前分支、`目录名` 自动为 `<repoName>-<sanitizedBranch>`、`位置` 默认为主仓父目录；
  - 未手动改过 `目录名` 时，切换 `From branch` / 勾选取消 `新建分支` / 输入新分支名都会自动同步 `目录名`；手动编辑后锁定不再覆盖；
  - 未勾选 `新建分支` 且所选本地分支已检出 ⇒ `canSubmit === false` 且返回中文提示；
  - 勾选 `新建分支` 且新分支为空或已存在同名本地分支 ⇒ `canSubmit === false` 且返回中文提示；
  - 未勾选 `新建分支` 且选择远端分支（如 `origin/feat/a`）⇒ 若本地无 `feat/a` 则自动推导 `createBranch: true, branch: 'feat/a', baseRef: 'origin/feat/a'`；若本地已有且未检出则 `createBranch: false, branch: 'feat/a'`；若本地已有且已检出则禁止提交并提示；
  - 校验 `目录名`（非空、不含 `/` 或 `\`、非 `.`/`..`、不以 `.` 开头）、`位置`（非空绝对路径）及最终路径不得等于主仓路径。
- **AC4（自定义目录名与位置）**：后端 `handleWorktreeCreate` / `validateTargetPath` / `resolveRealTargetParents` 支持用户通过 IDEA 表单指定的自定义 `Location`（需为已存在的真实目录）和自定义 `Project name`（不得以 `.` 开头、不得指向主仓或 `.git` 内、目标路径不得已存在或为符号链接、仍防 git 选项注入）。
- **AC5（回归与兼容）**：`npm run typecheck`、`npm run build`、`npm test` 全部通过；未传 `targetPath` 时仍保持原默认推导路径行为。

### 非目标

- 不引入远程 git fetch/prune 或分支删除功能；
- 不改变侧栏树结构、右键菜单入口位置或 worktree 移除逻辑。

## 2. 设计与关键决策

### 2.1 后端接口

1. **`src/types.ts`**：新增 `BranchEntry`：
   ```ts
   export interface BranchEntry {
     name: string
     kind: 'local' | 'remote'
     checkedOutWorktreeName?: string
     checkedOutWorktreePath?: string
     isCurrent?: boolean
   }
   ```
2. **`src/git.ts`**：新增 `listRepoBranches(repoPath, signal)`：
   - 并行执行 `git for-each-ref --format=%(refname:short)\t%(refname)\t%(HEAD) refs/heads refs/remotes` 与 `git worktree list --porcelain`；
   - 过滤 `refs/remotes/*/HEAD`；
   - 将 `worktree list` 中 `branch` 映射为 `checkedOutWorktreePath` / `checkedOutWorktreeName`（`basename(path)`）；
   - 排序：当前分支（`HEAD === '*'`）置首 → 其余本地分支按字典序 → 远端分支按字典序。
3. **`src/routes.ts`**：
   - `ROUTE_PATHS` 新增 `worktreeBranches: '/dsh-worktree-groups/worktree-branches'`；
   - 新增 `handleWorktreeBranches(ctx, res, body, options)`，校验 `repoPath` 在已知仓白名单中，支持远端模式转发；
   - 修订 `validateTargetPath` 与 `resolveRealTargetParents`（同步更新 PRD D5/D7 与契约）：
     - 取消「必须与主仓同父目录」与「basename 必须以主仓名开头」的限制，以支持 IDEA 的自定义 `Location` 与 `Project name`；
     - 保留并强化核心安全边界：必须为绝对路径、目标不得等于主仓、不得落入主仓 `.git` 目录（及任何 `.git` 路径段）、basename 不得以 `.` 开头、目标路径不得已存在（含符号链接）、父目录必须存在且为真实目录、禁止以 `-` 开头或含控制字符的 git 参数。

### 2.2 客户端纯逻辑与 UI

1. **`src/worktree-form.ts`**：纯函数模块（无 React / 宿主依赖，便于 `node --test` 全覆盖）：
   - `sanitizeWorktreeDirSegment(branch)`（与后端 `sanitizeBranchForPath` 同构）
   - `remoteBranchToLocalName(remoteBranch)`（去掉首个 `<remote>/` 前缀）
   - `createInitialWorktreeForm(repoPath, branches)`
   - `syncProjectName(form, repoName)`
   - `evaluateWorktreeForm(form, repoPath, branches)` → `{ targetPath, canSubmit, hint, payload }`
2. **`src/sidebar.tsx`**：
   - 修复弹窗宽度：`CreateWorktreeDialog` 及其他弹窗去掉固定过宽 `minWidth`，统一 `width: '100%', minWidth: 0, boxSizing: 'border-box'`，并为 `CreateWorktreeDialog` 的 `P.Modal` 附加响应式宽度样式类 `.wtg-worktree-modal`（通过幂等 `<style>` 注入，宽 `min(480px, calc(100vw - 32px))`）；
   - 按 IDEA 布局重写 `CreateWorktreeDialog`：打开时异步拉取 `worktree-branches`（拉取期间用已有 worktree 分支做初始种子，加载完成后无闪烁更新），包含 `基于分支`、`[ ] 新建分支` + 输入框、`目录名`、`位置` + 文件夹选择按钮、`worktree 将创建在` 预览与内联提示、`取消` / `创建 Worktree`。

## 3. 执行计划（TDD）

1. Red → Green：`src/types.ts` + `src/git.ts`（`listRepoBranches`）与 `test/git.test.mjs`。
2. Red → Green：`src/routes.ts`（`handleWorktreeBranches` + `validateTargetPath` 修订）与 `test/routes.test.mjs`。
3. Red → Green：`src/worktree-form.ts` 与 `test/worktree-form.test.mjs`。
4. Red → Green：`src/locales.ts` + `src/sidebar.tsx`（`CreateWorktreeDialog` 重构与弹窗宽度修复）与 `test/locales.test.mjs` / `test/render-smoke.test.mjs` / `test/sidebar-wiring.test.mjs`。
5. 文档更新（`PRD.md`、`INTERFACES.md`、`docs/README.md`、本工作记录）与全量 `typecheck` / `build` / `test`。

## 4. 执行与验证记录

### 4.1 变更文件

- `src/types.ts`：新增 `BranchEntry`（含 `name` / `kind` / `checkedOutWorktreeName` / `checkedOutWorktreePath` / `isCurrent`）。
- `src/git.ts`：新增 `listRepoBranches(repoPath, signal)`，并行执行 `git for-each-ref` 与 `git worktree list --porcelain`，过滤 `refs/remotes/*/HEAD`，按「当前分支 → 其余本地分支 → 远端分支」排序并标出已检出 worktree。
- `src/routes.ts`：
  - `ROUTE_PATHS` 新增 `worktreeBranches: '/dsh-worktree-groups/worktree-branches'`，注册并接入远端模式转发；
  - 新增 `handleWorktreeBranches`；
  - 修订 `validateTargetPath` 与 `resolveRealTargetParents`：允许用户自定义的 `Location`（需为已存在的真实目录）与 `Project name`，同时严格保留安全底线（非空绝对路径、不得等于主仓、不得落入 `.git`、不得以 `.` 开头、目标不得已存在或为符号链接、禁止 git 选项注入）。
- `src/worktree-form.ts`：新增零依赖纯逻辑模块，封装 IDEA 风格表单初始态、目录名自动联动/手动锁定、本地/远端分支校验与 `worktree-create` payload 推导。
- `src/locales.ts`：新增 IDEA 风格新建 worktree 弹窗与校验提示词条。
- `src/sidebar.tsx`：
  - 修复 `CreateWorktreeDialog`（以及 `RenameDialog` / `AddWorkspaceDialog` / `RemoveWorktreeDialog`）的固定 `minWidth` 横向溢出缺陷，统一改为 `width: '100%'`, `maxWidth: '100%'`, `minWidth: 0`, `boxSizing: 'border-box'`，并为 `fieldStyle()` 补齐 `width: '100%'`, `minWidth: 0`；
  - 按 IDEA `New Worktree` 重构 `CreateWorktreeDialog`（两列响应式网格：`基于分支` 下拉、`[ ] 新建分支` 复选框+输入框、`目录名`、`位置`+目录选择器按钮、`worktree 将创建在` 预览、内联校验提示与错误提示、`取消`/`创建 Worktree`）。
- 测试文件：`test/git.test.mjs`、`test/routes.test.mjs`、`test/worktree-form.test.mjs`、`test/sidebar-wiring.test.mjs`。

### 4.2 TDD Red → Green 与全量验证证据

1. **`listRepoBranches`（`test/git.test.mjs`）**
   - Red：`npm run build && node --test test/git.test.mjs` → `SyntaxError: The requested module '../lib/git.js' does not provide an export named 'listRepoBranches'`。
   - Green：实现 `BranchEntry` 与 `listRepoBranches` 后重跑 → 9/9 通过。
2. **路由与自定义路径校验（`test/routes.test.mjs`）**
   - Red：`npm run build && node --test test/routes.test.mjs` → `SyntaxError: The requested module '../lib/routes.js' does not provide an export named 'handleWorktreeBranches'`。
   - Green：实现 `handleWorktreeBranches` 与修订 `validateTargetPath` / `resolveRealTargetParents`，更新路由计数断言（5 → 6）后重跑 → 80/80 通过。
3. **IDEA 表单纯逻辑（`test/worktree-form.test.mjs`）**
   - Red：`node --test test/worktree-form.test.mjs` → `ERR_MODULE_NOT_FOUND: lib/worktree-form.js`。
   - Green：实现 `src/worktree-form.ts` 后重跑 → 7/7 通过。
4. **全量类型检查、构建与回归测试**
   - `npm run typecheck && npm test` → **通过**：`578 tests / 574 pass / 0 fail / 4 skipped`（4 条 skipped 为既有的宿主安装路径不可读漂移哨兵，与本次变更无关）。
5. **未自动验证项**
   - DSH 桌面端 / Web GUI 真实弹窗视觉呈现需用户在重启或刷新插件后人工确认（本会话未运行浏览器截图工具）。

### 4.3 复验反馈追加修复（2026-11-26 第二轮）

用户实测反馈 3 个问题并全部完成 Red → Green 修复：
1. **弹窗太窄**：`P.Modal` 默认对话框宽约 380px；通过 `className: 'wtg-worktree-modal'` + `contentClassName: 'wtg-worktree-modal-content'` 与弹窗内作用域 `<style>` 将宽度扩至 `min(740px, calc(100vw - 48px))`（约原宽度两倍）。
2. **「基于分支」仅显示 `—`**：排查出两处叠加原因：
   - `buildTreeView` 原有 `baseCandidates: branchPool.filter((branch) => branch !== node.branch)` 把单 worktree 仓的唯一分支过滤成了空数组 `[]`；
   - 运行中的 DSH 宿主尚未重启，导致 `/dsh-worktree-groups/worktree-branches` 返回 `405` 并回退到空种子。
   - 修复：在 `WorktreeExtra` 保留 `branch` / `isMain`，去掉 `branch !== node.branch` 过滤并新增 `collectInitialBranches` 构造准确的初始分支种子；重启 DSH 宿主后即可再经 `/worktree-branches` 拉取全部本地与远端分支。
3. **未勾选「新建分支」时输入框应可直接输入，输入即自动勾选**：
   - `src/worktree-form.ts` 的 `applyWorktreeFormChange` 在 `patch.newBranch` 非空且未显式传 `newBranchChecked` 时自动将 `newBranchChecked` 置为 `true`；
   - `src/sidebar.tsx` 移除 `new-branch-input` 的 `!form.newBranchChecked` 禁用条件。
4. **验证**：`npm run typecheck && npm test` → `579 tests / 575 pass / 0 fail / 4 skipped`。


