---
git-version: 5d2fe5126f9eae89c95f397d0b99c658ad6a9e26
git-module-path: src/icons.ts
level: L3
更新时间: 2026-10-19
状态: 现行
---

# Icons 技术文档（`src/icons.ts`）

> 定位：宿主 `@deepseek-ai/dsh-client-ui-primitives` 的**图标解析层**。
> 上游：`INTERFACES.md` §2.3 / §2.3.0；`HOST-CONTRACTS.md` §B5.1 与硬约束第 25 条；
> 下游：`src/sidebar.tsx` 的 `icon(name, props?)` 助手。

## 1. 存在理由（缺陷史）

**症状**（2026-10-19 用户报告）：启用 `dsh-worktree-groups` 后**侧栏整块渲染失败**。

**根因**：`src/sidebar.tsx` 直接以**尺寸后缀**取宿主图标：

```ts
const Chevron = row.expanded ? P.IconChevronDownOutline14 : P.IconChevronRightOutline14
jsx(P.IconPlusOutline16, {})
```

这些名字在宿主 `@deepseek-ai/dsh-client-ui-primitives@0.1.5-rc.2` 上成立
（导出快照见 `HOST-CONTRACTS.md` §B5.1）。宿主 `0.2.1-rc.2` 把图标导出改成了
**线重后缀**：

| 版本 | 命名 | 尺寸来源 |
|---|---|---|
| `0.1.5-rc.2` | `IconPlusOutline16` / `IconChevronDownOutline14` / `IconArchiveOutline20` | 名字自带 |
| `0.2.1-rc.2` | `IconPlusOutlineRegular`（1px）/ `IconPlusOutlineMedium`（1.3px） | `size` prop |

实测 `0.2.1-rc.2` 的导出表里**已无任何 `Icon*` + 数字后缀的名字**，于是 17 个
`P.Icon*` 全部求值为 `undefined`：

```ts
const LeadIcon = P.IconBranchOutline16   // undefined
jsx(LeadIcon, {})                        // Element type is invalid … got: undefined
```

崩溃点是**渲染期**，不是装载期：`SidebarBoundary` 把它接管成「侧栏渲染出错」；
若抛在边界之外，宿主 `SlotErrorBoundary` 会 `abdicate` 整个 entry，侧栏静默回落官方 UI。

## 2. 导出符号

| 符号 | 形态 | 用途 |
|---|---|---|
| `ICON_SPECS` | `Record<IconName, { candidates: readonly string[]; size: number }>` | 逻辑名 → 候选宿主导出名（新命名在前）+ 默认尺寸 |
| `IconName` | `keyof typeof ICON_SPECS` | 逻辑名联合类型（编译期拦住拼写错误） |
| `ICON_NAMES` | `readonly IconName[]` | 声明顺序稳定，供测试与诊断遍历 |
| `resolveIcon(face, name)` | `→ { Component, candidate }` | 命中候选或回落空图标；**永不返回 `undefined` Component** |
| `unresolvedIcons(face)` | `→ IconName[]` | 该宿主面下一个候选都不存在的图标（漂移诊断） |
| `iconSize(name)` | `→ number` | 默认尺寸（调用方显式 `size` 优先） |

`face` 是宿主 primitives 模块对象（`sidebar.tsx` 把 esbuild external 的
`Primitives` 传进来），因此本文件**不 import 任何 `@deepseek-ai/*`**，可被
`node --test` 直接执行。

## 3. 候选表

16 个逻辑名，每个都是「新命名 → 旧命名」两段：

```ts
chevronDown: { candidates: ['IconChevronDownOutlineRegular', 'IconChevronDownOutline14'], size: 14 }
plus:        { candidates: ['IconPlusOutlineRegular', 'IconPlusOutline16'], size: 16 }
archive:     { candidates: ['IconArchiveOutlineRegular', 'IconArchiveOutline20'], size: 20 }
```

⇒ 插件对两个宿主版本**同时成立**，不跟宿主版本硬绑定。

## 4. 关键行为与不变量

1. **缺席回落**：候选全缺 ⇒ `Component` 是内部 `NullIcon`，渲染 `null`。
   React 收到 `null` 是合法的"不渲染"，侧栏其余部分照常工作。
2. **引用稳定**：结果按 `(face, name)` 缓存（`WeakMap<face, Map<name, ResolvedIcon>>`，
   缺失时另有一张按名字的 `Map`）。同一宿主面重复解析必须返回**同一组件引用** ——
   否则 `sidebar.tsx` 里以图标为局部变量的渲染每帧拿到新组件类型，React 会把它当新
   组件卸载重建（打断拖拽 / hover 态）。
3. **非函数不算命中**：`iconAt` 只认 `typeof value === 'function'`，宿主导出同名常量
   不会被误当组件。
4. **纯逻辑**：无 IO、无 react、无全局状态（缓存是模块级但只做记忆化）。

## 5. 调用方契约（`src/sidebar.tsx`）

```ts
function icon(name: IconName, props?: Any): ReactNode {
  const resolved = resolveIcon(P, name)
  if (resolved.candidate === undefined) return null
  return jsx(resolved.Component, { size: iconSize(name), ...props })
}
```

- **禁止**在 `src/sidebar.tsx` 出现任何 `P.Icon*` 直接访问（AST 断言钉死）。
- `icon()` 返回**元素**而不是组件类型，调用点因此不可能再出现 `jsx(undefined, …)` 形态。

## 6. 验证

| 用例 | 断言 |
|---|---|
| `test/icons.test.mjs` 新命名面 | 16 个全部解析到 `*Regular`，`unresolvedIcons` 为空 |
| 同上 旧命名面 | 16 个全部解析到 `Icon*16/14/20`（向后兼容） |
| 同上 空面 | 全部回落空图标，渲染 `null`；`unresolvedIcons` 等于全部 |
| 同上 引用稳定 | 同面重复解析 `Component` 严格相等 |
| 同上 候选表 | 每个逻辑名首个候选必须以 `Regular`/`Medium` 结尾 |
| 同上 漂移哨兵 | 直接读已安装宿主 `primitives/lib/index.js` 的 `export {…}`，逐个核对首选候选；宿主再改名会指名缺失项 |
| 同上 接线 AST | `sidebar.tsx` 无 `P.Icon*`；且必须从 `./icons.js` 引入并调用 `resolveIcon` |
| `test/render-smoke.test.mjs` | 按真实宿主导出表造 primitives 面，SSR 渲染 `wide` 与 `wide: false` 两个分支，断言未被错误边界接管 |

**变异验证（判别力证据）**：把 `icon('panelLeft')` 改回 `jsx(P.IconPanelLeftOutline16, {})`
并重建，`test/icons.test.mjs` 的接线断言红；`test/render-smoke.test.mjs` **在只渲染宽态时
不红**（该图标只在 `wide: false` 轨道分支），补上轨道态渲染后两条用例全红 —— 这条缺口
就是"只测宽态"会漏掉整类渲染期崩溃的实证。

## 7. 已知边界

- 只覆盖**已声明**的 16 个逻辑名；新增图标必须同时改 `ICON_SPECS` 与契约文档。
- 候选表是"已知两个版本"的外推，宿主若引入第三种命名，由漂移哨兵发现，不自动适配。
- 尺寸：`*Regular` 在宿主里默认 `size = 16`；`chevronDown`/`chevronRight` 记 14、
  `archive` 记 20 是为了保持旧命名下的视觉尺寸。若宿主改画板，需要人工核对。
