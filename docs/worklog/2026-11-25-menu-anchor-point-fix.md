# 工作记录：修复 DSH v0.2.2+ 下侧栏菜单按钮点击不弹出菜单

- **日期**：2026-11-25
- **主题**：修复 DSH `v0.2.2-alpha.2`（当前宿主 `0.2.2-rc.5`）移除 `P.Menu.getAnchorRect` 后，侧栏项目/worktree `…` 菜单按钮与右键菜单无法正常弹出定位的问题
- **状态**：已完成

## 1. 目标与范围

### 需求来源
用户反馈：「这个版本的菜单按钮点击都没有弹出菜单了，需要修复」。

### 根因核实（基于本机运行中 DSH `0.2.2-rc.5` `app.asar`）
经只读核查 `/Applications/DeepSeek Harness.app/Contents/Resources/app.asar`：

1. **宿主破坏性变更（`v0.2.2-alpha.2/css-anchored-menus`）**：
   - 升级指南 `dsh/node_modules/@deepseek-ai/dsh/docs/upgrade-guide/v0.2.2-alpha.2/css-anchored-menus/guide.zh.md` 明确指出：
     - `@deepseek-ai/dsh-client-ui-primitives` 移除了 `useAnchoredPosition` 与 `AnchoredPositionOptions`。
     - `Menu` 将 `getAnchorRect` 替换为 `anchorRef`（外部触发元素 ref）或 `anchorPoint`（`{ x, y }` 客户端视口坐标，与 `event.clientX`/`clientY` 和 `getBoundingClientRect()` 同坐标系）。
2. **宿主运行时源码核实**：
   - `dsh-web-frontend/dist/assets/index-Ciz7DZxv.js` 中的 `Menu` 实现（`function zp`）仅解构 `anchorRef` 与 `anchorPoint`，已完全忽略 `getAnchorRect`：
     - 传入 `anchorPoint` 时，根 `<span>` 获得 `style={{ anchorName: Oe, position: 'fixed', left: re.x, top: re.y, width: 0, height: 0 }}`，portal 菜单（`._portal_70kcw_43`）通过 CSS Anchor Positioning 锚定到该坐标点。
     - 未传 `anchorPoint` 时，`re` 为 `undefined`，根 `<span>` 退化为位于侧栏 flex 容器底部（`flex: 1` 滚动区下方）的普通行内 `0×0` 元素，导致点击项目/worktree 行 `…` 按钮或右键打开 `MenuLayer` 时菜单无法在点击位置弹出。
   - 对比宿主自身 `dsh-client-ui-context-menu/src/client/View.tsx`，其 `MenuOverlay` 使用 `<Menu open={...} anchor={null} portal anchorPoint={point} ... />`。
3. **本插件现状**：
   - `src/sidebar.tsx` 的 `MenuLayer` 仍向 `P.Menu` 传 `getAnchorRect` 与占位 `anchor: <span>`，未传 `anchorPoint`。
   - 全仓所有 `…` 菜单按钮（worktree 行、git 项目行、非 git 项目行）以及项目/worktree 右键菜单和会话降级菜单均经由 `openMenu` → `MenuLayer` → `P.Menu`。
   - `P.Menu` 在新旧宿主版本中均按具名解构 props（无 `...rest` 透传到 DOM），因此同时传 `anchorPoint` 与 `getAnchorRect` 可在不引发 DOM 警告的前提下兼容 DSH `0.2.2+` 与旧版 `< 0.2.2`。

### 验收标准
- **AC1**：`src/sidebar.tsx` 的 `MenuLayer` 渲染 `P.Menu` 时必须传入稳定的 `anchorPoint`（由 `target.x` / `target.y` 经 `useMemo` 派生），并使用 `portal: true` 与 `anchor: null`（对齐 DSH `v0.2.2-alpha.2/css-anchored-menus` 规范与宿主 `MenuOverlay`）。
- **AC2**：保留稳定的 `getAnchorRect`（`useCallback`）以向后兼容 DSH `< 0.2.2` 宿主（新版宿主具名解构忽略多余 prop，旧版宿主继续使用 `getAnchorRect`）。
- **AC3**：补齐回归测试，先观察 Red 再完成最小实现并验证 Green，全量 `npm run typecheck && npm test` 通过。

### 非目标
- 不改变项目/worktree/会话的菜单项清单与业务动作。
- 不替换项目/worktree 自定义 `MenuLayer` 为宿主 `ctx.contextMenus`。

## 2. 计划与决策

1. 在 `test/sidebar-wiring.test.mjs` 新增 `2026-11-25` 回归测试：解析 `src/sidebar.tsx` AST，定位 `MenuLayer` 内 `jsx(P.Menu, { ... })` 调用，断言：
   - 传入 `anchorPoint` 属性，且由 `useMemo` 基于 `anchorX` / `anchorY` 稳定构造；
   - 传入 `portal: true`、`open: true`、`anchor: null`；
   - 保留 `getAnchorRect` 兼容旧宿主。
2. 先运行该定向测试确认 Red。
3. 修改 `src/sidebar.tsx` 的 `MenuLayer`：
   - 新增 `anchorPoint = useMemo(() => ({ x: anchorX, y: anchorY }), [anchorX, anchorY])`；
   - `P.Menu` 改为传 `anchor: null`、`anchorPoint`，保留 `getAnchorRect` 并更新注释。
4. 更新 `docs/HOST-CONTRACTS.md` §B5.2 补充 DSH `v0.2.2-alpha.2` `anchorPoint`/`anchorRef` 宿主契约修订说明。
5. 执行定向测试（Green）、`npm run typecheck`、`npm test` 全量回归并记录结果，更新 `docs/README.md` 索引。

## 3. 执行与验证记录（TDD Red → Green）

### 变更文件
- `src/sidebar.tsx`：`MenuLayer` 新增 `useMemo` 构造的稳定 `anchorPoint = { x: anchorX, y: anchorY }`，向 `P.Menu` 传入 `anchor: null` 与 `anchorPoint`，保留 `getAnchorRect` 兼容旧宿主，并更新注释说明。
- `test/sidebar-wiring.test.mjs`：新增 `2026-11-25/AC1-AC2` AST 接线回归测试，验证 `MenuLayer` 对 `P.Menu` 的 `open`、`portal`、`anchor`、`anchorPoint`（`useMemo` 稳定构造）与 `getAnchorRect` 传参。
- `docs/HOST-CONTRACTS.md`：在 §B5.2 `Menu` 补充 DSH `v0.2.2-alpha.2` `css-anchored-menus` 宿主演进说明。
- `docs/README.md`：补齐本工作记录索引。
- `package.json`、`package-lock.json`：版本号升级 `0.1.3` → `0.1.4` 准备发布。

### TDD Red → Green 证据
1. **Red**：`node --test --test-name-pattern="2026-11-25" test/sidebar-wiring.test.mjs`
   - 结果：1/1 失败（`AssertionError: ★ DSH v0.2.2+ CSS 锚定菜单应传 anchor: null`，且缺少 `anchorPoint`）。
2. **Green**：`npm run typecheck && npm run build && node --test --test-name-pattern="2026-11-25" test/sidebar-wiring.test.mjs`
   - 结果：类型检查 0 错误，构建通过，定向测试 1/1 通过。
3. **全量回归**：`npm test`
   - 结果：**563 pass / 0 fail / 4 skipped**（4 条 skip 为既有旧 `/Applications/DSH Desktop.app` 路径漂移哨兵）。

## 4. 结果与后续
- 已完成源码修复、构建产物（`lib/`）更新、契约文档与回归测试补齐。
- **未执行项 / 人工验证说明**：本会话未在浏览器 GUI 中直接点击验证；需在当前 DSH profile 重新加载/重装本插件后，点击项目行与 worktree 行的 `…` 菜单按钮以及右键菜单，确认菜单在按钮/指针坐标处正常弹出、可点击操作且可按 Esc / 点击外部关闭。
- **后续防回归建议**：现有 `icons` 漂移哨兵仍指向旧路径 `/Applications/DSH Desktop.app/...`（本次 4 条 skip），后续若需加强宿主破坏性升级预警，可补充针对 `app.asar` 或当前 DSH 安装路径的契约漂移检查。
