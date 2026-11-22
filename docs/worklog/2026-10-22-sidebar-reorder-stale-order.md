# 工作记录：手动顺序表陈旧导致侧栏拖拽排序静默失效

- **日期**：2026-10-22
- **主题**：`commitDrag` 换算前未把持久手动顺序表与当前默认顺序对齐，新增项拖不动、也当不了落点
- **状态**：已完成（自动验证全绿；GUI 拖拽复验待用户刷新页面后执行，见 §5）

## 1. 目标与范围

- 缺陷来源：用户 2026-10-22 报告「现在没法拖动工作区进行排序」。
- 期望行为：project（工作区）/ worktree / session 三层都能拖拽重排并持久化 —— 包括**手动模式
  建立之后新增**的工作区、worktree 与会话。
- 非目标：不改变拖拽范围约束（跨容器/跨项目仍禁止）、不改持久化格式、不改渲染排序规则。
- 相关文档：[接口契约 §2.2 / §2.3.1](../INTERFACES.md)、[PRD §13](../PRD.md)
  （手动排序 D10 的原始口径）、[知识库 TreeModel](../knowledge/l3-components/TreeModel技术文档.md)。

## 2. 根因

手动排序（D10）把顺序固化在 `localStorage` 的 `dsh-worktree-groups.order` 里，结构是
`{ manual, projects[], worktrees{项目key: []}, sessions{容器key: []} }`。这份表是**首次拖拽时
的全量快照**，此后：

- 新增工作区 / worktree 不会自动进表；
- 会话只有「尚未落表的新会话」会被 D2 插入表首，其它新增场景（例如表建立后才打开的容器）也可能缺项。

而 `src/sidebar.tsx` 的 `commitDrag` 旧实现**直接**拿持久表做换算：

```ts
const current = manualOrder.manual === true
  ? (manualOrder.projects ?? defaults.projects)
  : defaults.projects
const next = reorderKeys(current, active.itemId, over.key.slice('p:'.length), over.half)
if (next === null) return           // ← 表里没有该 id ⇒ 整次拖拽什么都不写
```

`reorderKeys`（`src/tree-model.ts`）对两种输入明确返回 `null`：

- 拖拽源不在列表里（`keys.indexOf(draggedId) === -1`）；
- 落点不在列表里（`withoutSource.indexOf(overId) === -1`）。

⇒ **表外的新增项既拖不动、也不能当落点**；而渲染期 `applyManualOrder` 对表外项本来就是
「按默认顺序追加到末尾」，所以侧栏看起来是完整、可拖的 —— 只有换算这一步失败，表现就是
「拖不动 / 松手没反应」。三层（project / worktree / session）都走同一段逻辑，因此这是**通用**
缺陷，不只是工作区。

> 观测佐证：本机 `DSH Desktop/Partitions/dsh-desktop-renderer/Local Storage/leveldb` 中的
> `dsh-worktree-groups.order` 为 `{"manual":true,"projects":[...]...}`（手动模式确已开启），
> 而当前会话所在的工作区是近期新增的 —— 正属于「表外项」。

## 3. 决策（DR6）

对齐后再换算，且对齐语义必须与渲染期**逐字一致**：

1. 表内项保持原有相对顺序 —— **包括当前不可见的项**（归档会话 / 归档工作区的槽位不丢，
   取消归档后回到原位）；
2. 表外项按 `effectiveOrder` 的当前默认顺序**追加到末尾**（渲染期正是这样画的）；
3. 去重、忽略非字符串/空串；纯函数，不修改入参；
4. 三层统一走新的唯一入口 `reorderManualScope(order, defaults, draggedId, overId, half)`；
   `sidebar.tsx` 不再直接 import `reorderKeys`。

## 4. TDD 证据

### 4.1 Red

先写 7 条用例（`test/tree-model.test.mjs` 的 `2026-10-22/DR6` 组）与 1 条接线用例
（`test/sidebar-wiring.test.mjs`）。此时 `lib/tree-model.js` 还没有新导出：

```text
SyntaxError: The requested module '../lib/tree-model.js' does not provide an export named 'reconcileManualOrder'
```

其中的**缺陷复现断言**在实现前后都成立（它锁的是旧实现的失败模式）：

```js
assert.equal(
  reorderKeys(stale.projects, '/repo-c/.git', '/repo-a/.git', 'before'),
  null,
  '★ 缺陷复现：陈旧表下 reorderKeys 直接放弃',
)
```

### 4.2 Green（实现后）

```text
✔ reconcileManualOrder: 表外项按默认顺序追加到末尾（与渲染期同语义）
✔ reconcileManualOrder: 保留表内但当前不可见的 id（归档项位置不丢）
✔ reconcileManualOrder: 去重 / 忽略非法项 / 不修改入参
✔ reorderManualScope: 拖拽源不在陈旧表里 ⇒ 仍然生效（修复点）
✔ reorderManualScope: 落点不在陈旧表里 ⇒ 仍然生效（修复点）
✔ reorderManualScope: 自身 / 原地拖拽返回 null（不写表）
✔ 真实场景：新增工作区不在 manual.projects 里 ⇒ 拖到最前必须生效并可渲染
✔ 2026-10-22/DR6 接线：commitDrag 三层都走 reorderManualScope（先对齐默认顺序再换算）
ℹ tests 8 / pass 8 / fail 0
```

接线用例锁定的结构事实：`commitDrag` 内 `reorderManualScope` **恰好 3 处**（project/worktree/
session），第二实参必须可追溯到 `defaults.projects` / `defaults.sessions.get(...)` /
`defaults.worktrees.get(...)`，第一实参必须来自 `manualOrder`；且 `sidebar.tsx` **不得**再
import `reorderKeys`（绕开对齐就会复发）。

## 5. 变更与验证

| 文件 | 变更 |
| --- | --- |
| `src/tree-model.ts` | 新增并导出 `reconcileManualOrder` / `reorderManualScope`（后者 = 对齐 + `reorderKeys`） |
| `src/sidebar.tsx` | `commitDrag` 三层改用 `reorderManualScope`（import 同步替换 `reorderKeys`），补 DR6 注释 |
| `test/tree-model.test.mjs` | 新增 `2026-10-22/DR6` 7 条用例（含「旧实现返回 null」的缺陷复现断言与渲染顺序断言） |
| `test/sidebar-wiring.test.mjs` | 新增 `2026-10-22/DR6 接线`（三层调用数、实参来源、禁止直接 import `reorderKeys`） |
| `docs/INTERFACES.md` | §2.2 新增两个导出签名；§2.3.1 增加「换算入口统一」约束 |
| `docs/knowledge/…`、`docs/README.md` | 定点修订与索引 |

验证：

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | **通过** |
| `npm test`（build + node --test） | **501 tests / pass 501 / fail 0**（原 493 + 新增 8） |
| 产物 | `lib/tree-model.js` / `lib/client.js` 已重建 |
| GUI 拖拽复验 | **未执行**：无浏览器自动化能力，宿主 web server 对非浏览器请求 403。需要刷新页面后实测 |

## 6. 残余风险与后续

1. **若刷新后仍然「完全拖不动」**（按住行没有任何拖拽态、也不出现插入线），说明问题不在
   换算层，而在 `dragHandlersFor` / DOM `draggable` 或宿主 Electron 的拖拽区域。本记录未覆盖
   该分支；排查顺序：`ContainerRowView` 根节点 `draggable` 是否为 `true` →
   `projectDrag` 是否为 `undefined` → 是否有祖先元素带 `-webkit-app-region: drag`。
2. **持久表不会因本次修复被主动重写**：只有用户真正拖拽时才会写入「对齐后的完整顺序」。
   也就是说陈旧表会一直保持陈旧，直到第一次成功拖拽 —— 行为上无影响（渲染始终用
   `applyManualOrder` 的表外追加语义）。
3. 对齐保留表内不可见项 ⇒ 表可能长期包含已删除会话的 id；这是刻意取舍（保住归档槽位），
   与宿主「归档项保留计数槽位」同向。
