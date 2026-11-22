# 工作记录：同位置「新建会话」保留草稿（复用空白会话）

- **日期**：2026-10-22
- **主题**：插件侧栏所有「新建会话」入口改为复用同 cwd 的空白会话，修复切换会话后草稿丢失
- **状态**：已完成（自动验证全绿；GUI 人工复验待用户刷新页面后执行，见 §4.4）

## 1. 目标与范围

- 需求来源：用户 2026-10-22 报告的缺陷（见 [需求文档](../requirements/2026-10-22-new-session-draft-retention.md) §1）。
- 验收标准：需求文档 AC1–AC7。
- 非目标：宿主 Shell 顶部「新建会话」按钮、blank 会话渲染规则、草稿存储位置、HTTP 路由与台账。
- 相关文档：[需求](../requirements/2026-10-22-new-session-draft-retention.md)、
  [设计](../design/2026-10-22-new-session-draft-retention.md)、[PRD §15](../PRD.md)、
  [接口契约 §2.3/§2.4](../INTERFACES.md)、[宿主契约 §B1.2](../HOST-CONTRACTS.md)。

## 2. 根因（已核实）

1. **草稿按会话 id 存**：宿主 `dsh-client-ui-conversation/lib/client.js:4426` 的
   `CONVERSATION_STORE_KEY = "dsh.conversation"`，读写键是 `dsh.conversation.<sessionId>`。
   本次实测本机 `DSH Desktop/Partitions/dsh-desktop-renderer/Local Storage/leveldb` 中确实存在
   多条 `dsh.conversation.session-<uuid>` 记录（含一条非空草稿 `{"text":"/remote-app-debugger zui'xi"}`），
   没有任何按 workspace / cwd 维度的草稿键。
2. **插件每次铸新会话**：`src/sidebar.tsx` 的 `newSession()` → `actions.startSession(workspaceId)`
   → `src/client.tsx` 的 `bridge.startSession(workspaceId)` → `uiWorkspace.startSession(workspaceId)`，
   **没有第二参**。宿主 `dsh-client-ui-workspace/lib/client.js:1403` 的
   `connectBlank(workspaceId, reuse)` 在 `reuse === undefined` 时无条件
   `sessions.create({ workspaceId })`。
3. **旧 blank 会话被隐藏**：宿主 `:964` 的 `sessionVisible()` 对 `blank` 会话只放行当前那一条，
   于是带草稿的旧 blank 会话在侧栏不可见 ⇒ 草稿"消失"。
4. **宿主本来支持复用**：`startSession(workspaceId, options)`（`:1499`）在 `options` 存在时走
   `createInWorkspace`（`:1418`），按 `summary.cwd === workspace.path` 找回同目录 blank 会话并
   复用其 `sessionId`（`:1421`）。宿主自己的「添加工作区→开新会话」用的正是
   `startSession(workspaceId, { clearPreviousDraft: false })`（`:3938`）。

## 3. 决策与计划

- **DR1（用户经 AskHuman 确认，2026-10-22）**：同位置已有空白会话时**复用它**，不新建第二条。
- 计划：
  1. 文档：需求 / 设计 / 本工作记录（本文）；
  2. Red：在 `test/sidebar-wiring.test.mjs` 增加 AST 接线断言（T1–T5）与宿主契约锁（T6），先跑出预期失败；
  3. Green：`src/sidebar.tsx` 增加 `StartSessionOptions` / `SAME_LOCATION_START_SESSION`，
     四个「新建会话」入口与 `Actions`/`SidebarBridge` 透传；`src/client.tsx` bridge 透传给
     `uiWorkspace.startSession`；
  4. 回归：`npm run typecheck`、`npm run build`、`npm test`；
  5. 文档收尾：PRD §15、INTERFACES §2.3/§2.4、HOST-CONTRACTS §B1.2、知识库定点修订、README 索引；
  6. 重建 `lib/`，确认宿主可服务新的 `lib/client.js`；GUI 人工复验（若无法执行则如实标注未验证）。

## 4. 执行与产物

### 4.1 TDD Red（先写测试，确认按预期失败）

在 `test/sidebar-wiring.test.mjs` 追加 4 条用例（T1–T3 合并为"全部入口两参"、T4、T5、T6 宿主契约锁）：

```sh
node --test --test-name-pattern="2026-10-22" test/sidebar-wiring.test.mjs
```

实测（实现前）：

```text
✖ 2026-10-22/DR1 同位置新建会话：全部入口都以两参调用 startSession，第二参含 clearPreviousDraft: false
  AssertionError: ★ actions.startSession(workspaceId) 必须传第二参 { clearPreviousDraft: false }：单参会让宿主走
  connectBlank(..., undefined) 分支、每次铸出新空白会话，同位置旧 blank 会话被 sessionVisible() 隐藏 ⇒
  未发送草稿在界面上丢失（2026-10-22 缺陷）。 1 !== 2
✖ 2026-10-22/DR1 接线：Actions.startSession 把 options 同时透传给宿主 props 与 bridge
  AssertionError: ★ 期望恰好 1 个 `startSession: (...) => …` 的 Actions 实现 …（实现存在但只有 1 个形参）
  actual: [ 'workspaceId' ] / expected: [ 'workspaceId', 'options' ]
✖ 2026-10-22/DR1 接线：client.tsx 的 bridge.startSession 把 options 原样转发给 uiWorkspace.startSession
  AssertionError: ★ bridge.startSession 必须声明 (workspaceId, options)
✔ 2026-10-22/DR1 宿主契约锁：安装的 ui-workspace 仍支持「按 cwd 复用 blank 会话」的 startSession options
ℹ tests 4 / pass 1 / fail 3
```

失败原因均为**行为缺失**（缺第二参 / 缺 options 形参），不是语法或环境错误；宿主契约锁在实现前即通过，
说明宿主当前的复用能力确实存在（缺陷出在插件侧接线）。

> 中途一次测试自身的缺陷：`callsOfCalleeText` 只接受属性访问形式的 callee，抓不到 `start(workspaceId, options)`
> （标识符 callee）⇒ 该断言误报"0 次调用"。已把辅助函数放宽到 `Identifier | PropertyAccessExpression`，
> 属于**测试工具修正**，不改变被测契约。

### 4.2 Green（最小实现）

变更文件：

| 文件 | 变更 |
| --- | --- |
| `src/sidebar.tsx` | 新增 `StartSessionOptions`、`SAME_LOCATION_START_SESSION = { clearPreviousDraft: false }`；`Actions` / `SidebarBridge` 的 `startSession` 增加 `options?`；`Actions.startSession` 两条路径原样转发；4 个「新建会话」入口（`newSession`、非 git 工作区 `+`、`CreateWorktreeDialog.onCreated`、project 右键菜单）统一传常量 |
| `src/client.tsx` | `bridge.startSession(workspaceId, options?)` 转发给 `uiWorkspace.startSession(workspaceId, options)`；降级分支注释标明不保留草稿 |
| `test/sidebar-wiring.test.mjs` | 追加 2026-10-22/DR1 四条用例与解析辅助（+239 行） |
| `docs/requirements/…`、`docs/design/…`、本记录、`docs/PRD.md` §15、`docs/INTERFACES.md` §2.3/§2.4、`docs/HOST-CONTRACTS.md` §B1.2、`docs/README.md`、知识库 L3 Client/Sidebar 两篇 | 需求、决策、契约、索引与定点修订 |

Green 实测：

```text
✔ 2026-10-22/DR1 同位置新建会话：全部入口都以两参调用 startSession，第二参含 clearPreviousDraft: false
✔ 2026-10-22/DR1 接线：Actions.startSession 把 options 同时透传给宿主 props 与 bridge
✔ 2026-10-22/DR1 接线：client.tsx 的 bridge.startSession 把 options 原样转发给 uiWorkspace.startSession
✔ 2026-10-22/DR1 宿主契约锁：安装的 ui-workspace 仍支持「按 cwd 复用 blank 会话」的 startSession options
ℹ tests 4 / pass 4 / fail 0
```

### 4.3 回归与产物

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `npm run typecheck` | **通过**（无输出） |
| 全量测试（含 build） | `npm test` | **486 tests / pass 486 / fail 0**，`duration_ms ≈ 22360` |
| 构建产物 | `npm run build`（`npm test` 前置） | `lib/client.js` 143103 B（2026-10-22 09:56） |
| 产物内容 | `grep -o "clearPreviousDraft[^,}]*" lib/client.js` | 命中 `clearPreviousDraft: false`（常量已进 bundle） |
| 文档链接 | 人工核对新增相对链接指向的文件均存在 | 通过（需求 ↔ 设计 ↔ 工作记录 ↔ PRD/INTERFACES/HOST-CONTRACTS/README 互链） |

### 4.4 未验证 / 残余风险

1. **GUI 人工复验（AC7 / 需求 §3）未执行**：当前会话没有浏览器自动化能力，宿主 web server 对
   非浏览器请求一律 403（`curl` 探测 `/` 与 `/client-modules/*` 均 403），无法在本次环境里点按验证。
   插件通过 `link:` 安装于 `~/.dsh/profiles/web`，`lib/` 已重建；**需要在 GUI 里刷新页面后**按
   需求 §1 的 5 步复验（预期：第四条点 `+` 后回到同一空白会话、草稿仍在；侧栏不新增第二条「新会话」）。
2. **宿主契约锁是文本级断言**：宿主升级若只是**改写实现但语义不变**（例如把 `reuse === void 0` 换成
   别的写法），T6 会误报，需要人工复核后更新断言 —— 这是"宁可误报也不漏报"的取舍。
3. **宿主 `createInWorkspace` 依赖客户端 `summary.cwd`**：刚铸出的 blank 会话在下一次列表刷新前
   可能没有 `cwd`（客户端占位 summary 不带 cwd）。极端连点时仍可能铸出第二条空白会话；属宿主既有
   行为，本插件未加去重（避免第二份"猜 blank"的真相）。
4. **复用会按当前默认 agent preset 重放**（宿主 `createSession` 未点名 preset 时的语义），与官方
   「添加工作区 → 开新会话」同源；若不希望改变 preset，需要在插件里显式传 `agentPreset`，本次未做。

## 5. 结果与后续

- 结论：缺陷根因已定位并修复（插件侧接线）；自动回归（4 条新用例 + 486 条全量）与类型检查、构建全部通过。
- 后续：① GUI 刷新后按 AC7 人工复验；② 若宿主升级导致 T6 红，按新实现复核复用语义后再更新断言；
  ③ 若想覆盖宿主 Shell 顶部的「新建会话」按钮，需要另立需求（不在本插件槽位内）。


## 6. 复验追加缺陷（2026-10-22 10:05）：「新会话」掉到列表最下面

### 6.1 症状与根因

用户复验第一轮修复后报告：**草稿保住了，但「新会话」出现在列表最下面**（附截图：`master`
worktree 下「新会话」排在 5 条历史会话之后），期望「新会话应该在最上面」。

根因（第一轮修复的连带效应）：

1. 第一轮把「新建会话」从**铸新会话**改成**复用同目录空白会话**（同一 `sessionId`）；
2. 旧实现下每次都是新会话，`observeTopZone` 会判它为「新会话」（进程内首次观测且
   `updatedAt >= startedAtMs`），于是 `topZoneSessionKeys` 把它提升到容器最前，手动模式下
   D2 还会把它插进固化表首位；
3. 复用之后，同一个 `sessionId` 早在 `known` 里（甚至早于本进程启动水位），既没有
   「首次观测」，也没有 `blank → 非 blank` 转换 ⇒ **不满足「新会话」判据** ⇒ 渲染时它按
   `updatedAt`（创建时间，很旧）排序，手动模式下因不在固化表里被 `applyManualOrder`
   追加到**末尾** ⇒ 用户看到的「最下面」。

宿主对照（原生语义，`dsh-client-ui-workspace/lib/client.js`）：`:983` `sectionMembers` 把
blank 成员排本组最前；`:952` `pinCurrentBlank` 把当前 blank 提到首位；`:2261`
`draggable = drag !== void 0 && !row.blank && !row.archived`（blank 行不可起拖）；
`:2990` drop 时 `source.blank` 直接 return；`:3258` blank 行**仍是落点**。

### 6.2 决策（DR4/DR5）

- **DR4**：当前空白会话（「新会话」占位行）**恒在其容器最前**（先于手动顺序、顶部区、
  5 条截断），判据 `isCurrentBlankSession`，**纯渲染期**、不写持久顺序。
  反向约束：**非 blank** 的当前会话不得因此置顶（T11 终裁不回退）。
- **DR5**：该行**不可起拖**（仍接受落点），判据 `isSessionDragLocked` = 运行中
  （`isTopZoneRunningSession`，与置顶判据同源）∪ 当前空白占位行 —— 否则「钉在最前 + 可拖」
  ⇒ 拖完弹回（T9 缺陷 1 同类）。

### 6.3 TDD 证据

**Red（行为缺失）**：先只加「判据函数」不加「渲染期置顶」，跑新用例：

```text
✖ 2026-10-22/DR4 当前空白会话固定在容器最前：手动顺序把它排到最后也无效
✖ 2026-10-22/DR4 默认（非手动）模式：当前空白会话同样最先，且先于按 updatedAt 的旧会话
✖ 2026-10-22/DR4 占位行最先、运行中的会话紧随其后（顶部区内部规则不变）
✔ 2026-10-22/DR4 反向约束：当前会话**非 blank** 时不得被置顶（T11 终裁不回退）
✔ 2026-10-22/DR4 只有「当前」blank 才置顶：非当前 blank 本就不渲染（不占名额）
✔ 2026-10-22/DR4 `isCurrentBlankSession`：…
ℹ tests 6 / pass 3 / fail 3
```

（这组失败是**临时把 `pinnedKeys` 里的占位行去掉**后重跑得到的判别力证据 —— 直接原因
明确落在「渲染期没有把占位行放到最前」，不是断言写错。）

**Red（接线变更）**：把 `sidebar.tsx` 的拖拽判据换成 `isSessionDragLocked` 后，旧的 T13
接线用例按预期变红（它们钉的是旧判据形式）：

```text
✖ T13/接线: **session 行**的调用传入 `!isTopZoneRunningSession(row, topZone)` 作为第 3 实参
✖ T13/接线: `isTopZoneRunningSession` 从 `./tree-model.js` import（用的是共享实现）
✖ T13/接线: 判据在 `src/` 里只有一份声明，且被「置顶」与「不可拖」两处共用
ℹ tests 39 / pass 36 / fail 3
```

已按 DR5 重写为：第 3 实参必须是 `!isSessionDragLocked(row, topZone)`；`sidebar.tsx` 必须
import `isSessionDragLocked` 且**不得**直接 import `isTopZoneRunningSession`；
`isSessionDragLocked` 在 `src/` 只有一份声明且内部调用 `isTopZoneRunningSession`
（原来的「唯一实现、不得分叉」保护原样保留，只是换成经由新判据）。

**Green**：

```text
node --test test/tree-model.test.mjs    ⇒ ℹ tests 276 / pass 276 / fail 0
node --test test/sidebar-wiring.test.mjs ⇒ ℹ tests 39  / pass 39  / fail 0
```

### 6.4 变更文件

| 文件 | 变更 |
| --- | --- |
| `src/tree-model.ts` | 新增并导出 `isCurrentBlankSession` / `isSessionDragLocked`；`emitContainer` 的 `pinnedKeys` 首位插入当前占位行；`topZoneSessionKeys` 语义不变（只加注释）；`isCurrentSession` 用途说明补第 ④ 条 |
| `src/sidebar.tsx` | 拖拽判据由 `!isTopZoneRunningSession(row, topZone)` 改为 `!isSessionDragLocked(row, topZone)`（import 同步替换），注释补 DR5 |
| `test/tree-model.test.mjs` | 新增 `2026-10-22/DR4`（6 条）与 `DR5`（1 条）用例；T11「同源」用例补注 DR4/DR5 后的差异 |
| `test/sidebar-wiring.test.mjs` | T13 接线三条例按 DR5 重写（含「sidebar 不得绕过 `isSessionDragLocked`」与「内部复用唯一 `isTopZoneRunningSession`」） |
| `docs/…` | 需求 DR4/DR5、AC8/AC9、非目标；设计 §3.4 + T8–T10 + 风险；PRD §15；INTERFACES §2.2/§2.3.1；README 索引；知识库 L3 定点修订 |

### 6.5 验证

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | **通过** |
| `npm test`（build + node --test） | **493 tests / pass 493 / fail 0**（基线 486 + 新增 7） |
| 产物 | `lib/client.js` 已重建（10:15 之后）；`lib/tree-model.d.ts` 含两个新导出 |
| GUI 复验（AC7/AC8 的人工部分） | **未执行**：本会话无浏览器自动化，宿主 web server 对非浏览器请求 403。需要刷新页面后复验「新会话在最上面、且拖不动、草稿仍在」 |

### 6.6 残余风险

1. **「最近」分区里占位行仍按 `updatedAt` 排序**（可能靠后）—— 本次范围只改工作区树内的
   容器；若用户也希望「最近」置顶占位行，需要另立需求。
2. **占位行恒在最前**意味着用户把别的会话拖到「最上面」时，视觉上仍排在占位行之下 ——
   与宿主原生一致（placeholders 恒在最前），已在设计 §5 声明。
3. 若宿主将来把 blank 行的拖拽/渲染语义改掉（例如允许 blank 拖动），DR5 的对照证据失效；
   `test/sidebar-wiring.test.mjs` 的宿主契约锁目前只覆盖 `startSession` 复用语义，**未**锁
   `:2261` 的 blank 拖拽语义（避免过度锁定宿主内部实现），需人工复核宿主升级。
