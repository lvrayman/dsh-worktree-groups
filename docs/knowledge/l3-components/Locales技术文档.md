---
生成时间: 2026-09-22
更新时间: 2026-09-22
git-version: 9bd94252dd934c2fa8491977285e461b703f0f3e
git-module-path: src
level: L3
---

# Locales 技术文档（`zh` / `createT` / `createSeatT`）

> **文件路径**: `src/locales.ts`

> ⚠️ **2026-09-23 局部修订**：本文件新增导出 `Translate`（类型）与 `createSeatT`（宿主 seat 的
> 取词兜底），用于修「右键菜单渲染裸 key」缺陷。frontmatter 的 `git-version` 仍是知识库生成时的
> `9bd9425`，**未标注修订的行号锚点均对应旧版本**（当前文件已超过 101 行）。缺陷记录见
> `docs/worklog/2026-09-23-sidebar-menu-raw-keys.md`。

## 目录

- [1. 概述](#1-概述)
- [2. 构造参数与依赖](#2-构造参数与依赖)
- [3. 核心方法签名](#3-核心方法签名)
- [4. 执行流程](#4-执行流程)
- [5. 状态机](#5-状态机)
- [6. 并发与线程模型](#6-并发与线程模型)
- [7. 边界条件](#7-边界条件)
- [8. 代码示例](#8-代码示例)
- [9. 已知缺陷与注意事项](#9-已知缺陷与注意事项)
- [10. 相关文档](#10-相关文档)

## 1. 概述

`src/locales.ts`（全文 101 行）是本插件客户端的**中文词条表 + 取词函数工厂**，属于知识库分层中的 L3 地面细节层。

**职责**：

1. 以 `export const zh`（`src/locales.ts:16-74`）冻结全部中文界面文案，key 稳定、值即最终展示字符串。
2. 以 `export function createT`（`src/locales.ts:89-101`）把「词条表 + 占位符替换 + 缺 key 回退」封装成一个纯函数工厂。
3. 为渲染层提供**永不抛错**的取词入口：缺 key 返回 key 本身，缺占位符变量保留 `{n}` 原样。

**核心特性**：

- **纯逻辑、零依赖**：文件头注释明确声明「不 import react、不 import 任何 `@deepseek-ai/*` 包、不做 IO」（`src/locales.ts:1-13`），因此可被 `node --test` 直接覆盖。经核验，全文无任何 `import` 语句。
- **冻结 key 集**：key 集合是 `docs/INTERFACES.md` §2.1 冻结的最小集；注释指出「少一个就会在界面上露出裸 key。新增 key 请先改契约文件」（`src/locales.ts:7-8`）。
- **可注入词典**：`createT(dict)` 的 `dict` 参数缺省为 `zh`，注释说明用途是「便于后续挂英文表或测试注入」（`src/locales.ts:80`）。
- **原型链安全**：取词与占位符替换均使用 `Object.prototype.hasOwnProperty.call` 判定自有属性（`src/locales.ts:94`、`src/locales.ts:98`），避免 `toString` 等原型链 key 被当成词条（`src/locales.ts:93` 注释）。
- **确定性输出**：同一 `(key, vars)` 输入恒得同一字符串，无随机、无时间、无外部状态。

## 2. 构造参数与依赖

### 2.1 导出符号清单

源码中 `^export` 现有 4 处（**2026-09-23 修订**：原为 2 处），清单如下：

| 序号 | 符号 | 类型 | 定义位置 | 说明 |
| --- | --- | --- | --- | --- |
| 1 | `zh` | `const`，类型注解 `Record<string, string>` | `src/locales.ts:16` | 中文词条表，50 条 key |
| 2 | `createT` | `function`，返回 `Translate` | `src/locales.ts:89`（旧锚点） | 取词函数工厂 |
| 3 | `Translate` | `type`（2026-09-23 新增） | `src/locales.ts` 的 `format` 之前 | 取词函数签名，供 `sidebar.tsx` 等消费方共用，不再各自就地声明 |
| 4 | `createSeatT` | `function`，`(seat: Translate, dict?) => Translate`（2026-09-23 新增） | `src/locales.ts` 尾部 | **宿主 seat 兜底**：seat 返回 key 本身（未解析）或抛错时回落 `dict`（缺省 `zh`）；同一 `(seat, dict)` 返回同一引用 |

> 旧版本中「本文件**不导出**任何 TypeScript `type`」的说法自 2026-09-23 起失效：`Translate`
> 已在本文件导出，`src/sidebar.tsx` 改为 `import { createSeatT, createT, zh, type Translate }`；
> `src/tree-model.ts` 仍就地声明自己的取词类型（未强制统一）。

### 2.2 依赖（本文件 import 的东西）

**无**。`src/locales.ts` 不含任何 `import` / `require` 语句，是依赖图的叶子节点。

### 2.3 被谁使用

| 使用方 | 位置 | 用法 |
| --- | --- | --- |
| `src/sidebar.tsx` | `src/sidebar.tsx:31`（旧锚点） | `import { createSeatT, createT, zh, type Translate } from './locales.js'`（2026-09-23 起含 `createSeatT` / `Translate`） |
| `src/sidebar.tsx` | `src/sidebar.tsx:136` | `const FALLBACK_T: Translate = createT(zh)`，宿主 `t` 缺失时的兜底取词 |
| `src/sidebar.tsx` | `src/sidebar.tsx:1500`、`1517` | 错误边界直接用 `FALLBACK_T('error.title')` / `FALLBACK_T('error.retry')` |
| `src/sidebar.tsx` | `src/sidebar.tsx:1576`（旧锚点） | **2026-09-23 修订**：`const seat = props.t; const t = typeof seat === 'function' ? createSeatT(seat as Translate) : FALLBACK_T`（旧写法直接透传 `props.t`，seat 解不出时会渲染裸 key） |
| `src/client.tsx` | `src/client.tsx:57` | `import { zh } from './locales.js'` |
| `src/client.tsx` | `src/client.tsx:232`（旧锚点） | `locale.register(LOCALE_NS, { zh })`，把词典注册进宿主 locale 服务的自有命名空间 `dsh-worktree-groups`（`LOCALE_NS` 定义于 `src/sidebar.tsx:133`）；**2026-09-23 起该调用位于 `ctx.inject(['locale'], …)` 回调内** |

**两条取词路径**（`src/client.tsx:223-233` 注释明确区分）：

- 组件拿到的 `t` 由 renderer 的 `standardKit` 按 entry 的 `locale` 声明构建，**不是**来自 `locale.register`；`locale` 服务缺席时 `standardKit` 直接抛 `SlotAssemblyError`，entry 被剔除。
- `locale.register(LOCALE_NS, { zh })` 只负责把词典挂到命名空间；注册失败仅 `console.warn`，不阻断（`src/client.tsx:235-237`）。
- `FALLBACK_T` 的适用前提是「组件仍被渲染、只是没拿到 `t`」（`src/client.tsx:42`）。
- **2026-09-23 新增第三条**：seat 存在但**命名空间是空的**（注册迟到 / 漏注册）时，宿主
  `translate` 按规则「本命名空间查不到 → 查 `common` → 还查不到就返回 key 本身」⇒ 界面露裸 key。
  因此 `sidebar.tsx` 的取词入口改为 `createSeatT(seat)`：seat 解不出就回落 `zh`，
  seat 正常解析则逐字透传（不顶掉宿主 `common` 命名空间或其它语言的译文）。

## 3. 核心方法签名

### 3.1 `zh`

```ts
export const zh: Record<string, string>
```

- **参数**：无（常量）。
- **返回值**：不可变语义的普通对象，50 个 key。key 命名空间分组：`section.*`(2)、`search.*`(2)、`session*`(4)、`history.*`(1)、`worktree.*`(20)、`project.*`(1)、`menu.*`(9)、`dialog.*`(5)、`error.*`(3)、`state.*`(2)、`a11y.*`(1)。
- **合法取值范围**：值均为非空中文字符串；含占位符的值只有 5 条 —— `sessions.expand`（`{n}`，`src/locales.ts:23`）、`worktree.removeConfirm`（`{name}`，`:39`）、`worktree.workspaceWarning`（`{message}`，`:45`）、`a11y.subagents`（`{n}`，`:71`）、`worktree.createTitle`（`{name}`，`:73`）。
- **抛错条件**：无。

完整 key 清单（50 条，与 `src/locales.ts:16-74` 逐条对应）：

```text
section.workspaces        工作区                                (17)
section.ungrouped         未分组                                (18)
search.placeholder        搜索会话…                             (19)
search.empty              无匹配结果                            (20)
session.new               新会话                                (21)
session.blank             新会话                                (22)
sessions.expand           展开其余 {n} 个会话                    (23)
sessions.collapse         收起                                  (24)
history.label             history-worktree-session             (25)
worktree.main             主                                    (26)
worktree.create           新建 worktree…                        (27)
worktree.remove           移除 worktree                         (28)
worktree.creating         正在创建…                             (29)
worktree.removing         正在移除…                             (30)
worktree.newBranch        新建分支                              (31)
worktree.useExisting      复用已有分支                          (32)
worktree.branchName       分支名                                (33)
worktree.baseBranch       起始分支                              (34)
worktree.path             路径                                  (35)
worktree.pathHint         默认：<主仓父目录>/<主仓名>-<分支名>    (36)
worktree.confirm          创建                                  (37)
worktree.cancel           取消                                  (38)
worktree.removeConfirm    确定移除 worktree “{name}”？           (39)
worktree.removeKeepBranch 分支会保留，可用 git branch -d 删除。    (40)
worktree.forceRemove      强制删除（丢失未提交改动）              (41)
worktree.dirty            该 worktree 有未提交改动。             (42)
worktree.workspaceWarning worktree 已创建，但注册为工作区失败，未自动新建会话：{message} (45)
project.add               添加工作区…                           (46)
menu.newSession           新建会话                              (47)
menu.reveal               在文件管理器中打开                     (48)
menu.copyPath             复制路径                              (49)
menu.rename               重命名                                (50)
menu.archive              归档                                  (51)
menu.fork                 派生会话                              (52)
menu.removeHistory        移出 history                          (53)
menu.deleteWorkspace      删除工作区                            (54)
menu.resetOrder           恢复默认排序                          (57)
dialog.rename             重命名                                (58)
dialog.renameWorkspace    重命名工作区                          (59)
dialog.renameSession      重命名会话                            (60)
dialog.confirm            确定                                  (61)
dialog.cancel             取消                                  (62)
error.title               侧栏渲染出错                          (63)
error.retry               重试                                  (64)
error.load                加载失败                              (65)
state.loading             加载中…                               (66)
worktree.menu             更多操作                              (70)
a11y.subagents            {n} 个子代理运行中                    (71)
state.loadingTree         正在加载工作区…                       (72)
worktree.createTitle      在 {name} 下新建 worktree             (73)
```

> 注释块 `src/locales.ts:43-44`、`55-56`、`67-69` 记录了 key 的来源决策，不参与 key 计数。

### 3.2 `createT`

```ts
export function createT(
  dict: Record<string, string> = zh,
): (key: string, vars?: Record<string, string | number>) => string
```

**参数 `dict`**：

- 类型 `Record<string, string>`，可选，缺省 `zh`（`src/locales.ts:90`）。
- 合法取值：任意字符串到字符串的映射对象；`undefined` 时使用内置 `zh`。传 `null` 会在取词时被 `hasOwnProperty.call` 拒绝（返回 key 本身），见 §7。

**返回值**：一个新函数 `t(key, vars?)`（`src/locales.ts:92`）。

- `key: string` —— 词条 key。合法取值：`zh` 中的 50 个 key 之一，或任意字符串（未知 key 按回退规则处理）。
- `vars?: Record<string, string | number>` —— 占位符变量表，可选。合法取值：属性名匹配正则 `[A-Za-z0-9_]+` 的字符串/数字值；值经 `String(vars[name])` 转换（`src/locales.ts:98`）。
- 返回 `string`，恒不为 `undefined`。

**抛错条件**：

- `t(key)` 本身**不抛错**：`dict[key]` 在 `hasOwnProperty` 为真时取值，随后 `if (template === undefined) return key` 兜底（`src/locales.ts:94-95`）。
- 唯一可能抛错的点：`dict` 被传入非对象（如 `null`）时，`Object.prototype.hasOwnProperty.call(null, key)` 在严格模式下抛 `TypeError`。源码未对此做防御，属未覆盖路径（见 §9）。
- `createT` 工厂自身不抛错，构造过程只是闭包捕获 `dict`。

### 3.3 占位符替换规则

替换正则固定为 `/\{([A-Za-z0-9_]+)\}/g`（旧锚点 `src/locales.ts:97`；2026-09-23 起抽成内部
`format(template, vars)`，被 `createT` 与 `createSeatT` 共用）：

- 只识别「`{` + 字母/数字/下划线 + `}`」形式；含空格或中文的 `{}` 不参与替换。
- 替换值为 `String(vars[name])`，因此 `0` 会渲染成 `"0"` 而非被当作假值跳过。
- `vars` 中不存在该名字时返回原 `match`（保留 `{n}` 字面量，`src/locales.ts:98`）。
- 同名字符串出现多次时全部替换（`g` 标志）。

### 3.4 `createSeatT`（2026-09-23 新增）

```ts
export function createSeatT(seat: Translate, dict: Record<string, string> = zh): Translate
```

**参数**：

- `seat` —— 宿主 locale seat 的取词函数（组件 props 上的 `t`，由 renderer `standardKit` →
  `localeSeat` → `face.bind(entry.locale)` 构建）。
- `dict` —— 兜底词条表，缺省 `zh`。

**返回值**：与 `seat` 同签名的取词函数；**同一 `(seat, dict)` 组合返回同一引用**（内部用
`WeakMap` 缓存，避免 `sidebar.tsx` 里以 `t` 为依赖的 `useMemo` 每帧失效）。

**语义（三条，逐条有测试 `test/locales.test.mjs`）**：

| 情形 | 输出 |
| --- | --- |
| `seat(key)` 返回**不是** key 的字符串 | **逐字透传**（宿主 `common` 命名空间 / 其它语言的译文不许被顶掉） |
| `seat(key)` 返回 key 本身（宿主 `translate` 的兜底）或 `seat` 抛错 | `dict[key]`（占位符照常替换）；`dict` 也没有 ⇒ 返回 key |
| `dict` 传 `null` | 同 `createT`：`hasOwnProperty.call` 抛 `TypeError`（未防御，见 §9） |

**抛错条件**：`t(key)` 自身**不抛错** —— `seat` 的异常被 `try/catch` 吞掉后走兜底（渲染期绝不
因取词崩，PRD R6）。

## 4. 执行流程

文案 key 从定义到渲染的解析路径（ASCII）：

```text
[1] 定义期（本文件）
    src/locales.ts:16  export const zh = { 'sessions.expand': '展开其余 {n} 个会话', ... }
              |
              |  两个消费口
              v
[2a] 词典注册路径（宿主语言切换用）           [2b] 取词路径（组件渲染用）
     src/client.tsx:57  import { zh }        src/sidebar.tsx:31  import { createT, zh }
              |                                       |
     src/client.tsx:230 serviceOf(ctx,'locale')   src/sidebar.tsx:136 createT(zh) -> FALLBACK_T
              |                                       |
     src/client.tsx:232 locale.register(           src/sidebar.tsx:1576 props.t 为函数 ? props.t
              LOCALE_NS, { zh })                              : FALLBACK_T
              |                                       |            |
     注册失败 -> console.warn 不阻断             宿主 standardKit 按 entry.locale
     (src/client.tsx:235-237)                    构建的 t（优先）
                                                          |
                                                          v
[3] 调用期  t(key, vars?)
     src/sidebar.tsx:1001  props.t('a11y.subagents', { n: row.subagentCount })
     src/tree-model.ts:2345 context.t('history.label')
              |
              v
[4a] sidebar.tsx 的取词入口（2026-09-23 修订）
     createSeatT(seat) 包一层兜底：
       seat(key, vars) 返回 !== key ? 逐字透传 : 回落 zh
               |
               v
[4] createT / 兜底路径共用的 format()（旧锚点 src/locales.ts:92-100）
     hasOwnProperty(dict, key)?
        ├─ 否 -> template = key            (src/locales.ts:94)
        └─ 是 -> template = dict[key]
              |
              v
     template === undefined ? return key    (src/locales.ts:95)
              |
              v
     vars === undefined ? return template   (src/locales.ts:96)
              |
              v
     template.replace(/\{([A-Za-z0-9_]+)\}/g, ...)
        ├─ hasOwnProperty(vars, name) -> String(vars[name])   (src/locales.ts:98)
        └─ 否 -> 返回 match（保留 {n} 原样）                    (src/locales.ts:98)
              |
              v
[5] 渲染期  jsx 属性取值
     src/sidebar.tsx:1249  title: t('worktree.createTitle', { name: state.label })
     src/sidebar.tsx:2443  children: t('state.loadingTree')
     src/tree-model.ts:2345  label: context.t('history.label')
```

## 5. 状态机

**N/A** —— 原因：`src/locales.ts` 的导出都是无状态纯函数 / 常量：常量对象 `zh`（`src/locales.ts:16`）、闭包工厂 `createT`（`src/locales.ts:89`）、兜底包装 `createSeatT`（2026-09-23 新增）。`createSeatT` 内部有一个 `WeakMap` 记忆化缓存，但它只影响「同一 `(seat, dict)` 是否返回同一引用」，不构成可观察的状态迁移；全文无 `let` 声明、无实例字段、无生命周期钩子。

## 6. 并发与线程模型

**N/A（无自有并发语义）** —— 原因：本文件为纯同步函数式代码，不含 `async`/`await`、`Promise`、定时器、事件监听或共享可变状态，因此自身不引入并发。运行时层面它继承宿主（Node / 浏览器渲染进程）的单线程事件循环模型，但该模型由宿主而非本文件决定。需要说明的是：`zh` 作为模块级 `const` 对象，同一进程内所有调用方共享同一引用；由于全文没有任何写操作，多调用方并发读取不会产生竞态。

## 7. 边界条件

| 场景 | 输入 | 实际行为 | 源码定位 |
| --- | --- | --- | --- |
| 缺失 key | `t('not.exists')` | 返回 key 本身 `'not.exists'`，不崩、不返回 `undefined` | `src/locales.ts:94-95` |
| 原型链 key | `t('toString')` | `hasOwnProperty(dict,'toString')` 为假 ⇒ 返回 `'toString'`，不会取到 `Object.prototype.toString` | `src/locales.ts:93-94` |
| 词条值为 `undefined` | `dict = { a: undefined as any }`，`t('a')` | `hasOwnProperty` 为真但 `template === undefined` ⇒ 返回 `'a'` | `src/locales.ts:95` |
| 空文案 | `dict = { a: '' }`，`t('a')` | `'' === undefined` 为假 ⇒ 返回空串 `''`（不会回退成 key） | `src/locales.ts:95-96` |
| 未传 `vars` | `t('sessions.expand')` | 直接返回模板原文 `'展开其余 {n} 个会话'`，占位符原样保留 | `src/locales.ts:96` |
| `vars` 缺占位符名 | `t('sessions.expand', { m: 1 })` | 该占位符保留 `{n}` 原样，其余部分正常 | `src/locales.ts:97-99` |
| 占位符值为 `0` | `t('sessions.expand', { n: 0 })` | `hasOwnProperty` 为真 ⇒ `String(0)` ⇒ `'展开其余 0 个会话'`（不做假值过滤） | `src/locales.ts:98` |
| 未知语言 | 语言非 `zh` | 本文件**只提供 `zh`**，无英文表、无语言选择逻辑；`createT(dict)` 是唯一注入点 | `src/locales.ts:80`、`src/locales.ts:90` |
| 回退语言 | 宿主 `t` 缺失（组件仍被渲染） | 走 `FALLBACK_T = createT(zh)`；若 entry 因 `locale` 服务缺席被 `standardKit` 剔除，则组件根本不渲染，无回退 | `src/sidebar.tsx:136`、`src/client.tsx:223-233` |
| **seat 存在但词典为空**（2026-09-23 新增） | `createSeatT(seat)` 且 `seat(key)` 返回 key 本身 | 回落 `dict[key]`（缺省 `zh`）并替换占位符 ⇒ **不露裸 key**；`dict` 也没有该 key ⇒ 返回 key | `src/locales.ts` 的 `createSeatT`；`test/locales.test.mjs` |
| **seat 抛错**（2026-09-23 新增） | `createSeatT(seat)` 且 `seat(key)` 抛异常 | 异常被吞掉后走同一兜底；取词**永不抛到渲染层** | `src/locales.ts` 的 `createSeatT` |
| `dict` 传 `null` | `createT(null as any)` 后取词 | `hasOwnProperty.call(null, key)` 抛 `TypeError`，源码无防御 | `src/locales.ts:94`（未覆盖路径，见 §9） |
| 重复 key | 对象字面量内同名 key | JS 语义取后者，本文件当前无重复 key（已逐行核对 50 条） | `src/locales.ts:16-74` |
| 非字符串 `vars` 值 | `t('sessions.expand', { n: {} })` | `String({})` ⇒ `'[object Object]'`，不抛错 | `src/locales.ts:98` |

## 8. 代码示例

以下均为真实 key 与真实调用方式（取自源码或 `src/locales.ts:83-87` 的 JSDoc 示例）：

```ts
import { createT, zh } from './locales.js'

// 1) 默认词典（等价于 sidebar.tsx:136 的 FALLBACK_T）
const t = createT()

t('sessions.expand', { n: 29 })   // '展开其余 29 个会话'   (src/locales.ts:23 + :85)
t('not.exists')                   // 'not.exists'          (src/locales.ts:86, 缺 key 回退)
t('sessions.expand')              // '展开其余 {n} 个会话'   (src/locales.ts:87, 占位符原样)

// 2) 显式传入内置表（与 createT() 等价）
const t2 = createT(zh)
t2('state.loadingTree')           // '正在加载工作区…'      (src/locales.ts:72)

// 3) 测试注入自定义词典
const t3 = createT({ 'error.title': 'boom' })
t3('error.title')                 // 'boom'
t3('error.retry')                 // 'error.retry'（注入表中缺失 ⇒ 回退 key）

// 4) 真实渲染调用点
props.t('a11y.subagents', { n: row.subagentCount })      // src/sidebar.tsx:1001
t('worktree.createTitle', { name: state.label })         // src/sidebar.tsx:1249
t('worktree.menu')                                       // src/sidebar.tsx:2280
context.t('history.label')                               // src/tree-model.ts:2345

// 5) 词典注册进宿主 locale 命名空间
locale.register(LOCALE_NS, { zh })                       // src/client.tsx:232
```

## 9. 已知缺陷与注意事项

1. **`worktree.menu` 与 `state.loading` 命名空间混用**：`worktree.menu`（`src/locales.ts:70`）表达的是「更多操作」这一 UI 动作，却挂在 `worktree.` 前缀下；`state.loadingTree`（`:72`）与 `state.loading`（`:66`）语义不同（注释 `src/locales.ts:67-69` 明确：前者专指树数据首拉）。命名一致性不足，但属冻结集，改名会破坏契约。
2. **契约文件与实现存在已知偏差**：`src/locales.ts:10-12` 注释明确记录「尾部 4 条（`worktree.menu` / `a11y.subagents` / `state.loadingTree` / `worktree.createTitle`）是 T5 落地渲染层后补入的实测缺口……`docs/INTERFACES.md` §2.1 的最小集清单待主代理同步更新」。经核验，`docs/INTERFACES.md` §2.1（第 287–346 行，`### 2.2` 起于第 347 行）的 key 清单确实**未列出**注释点名的这 4 条 —— `worktree.menu` / `a11y.subagents` / `state.loadingTree` / `worktree.createTitle`，而 `zh` 已包含它们（`src/locales.ts:70-73`）。§2.1 中 `error.title`（第 341 行）/ `error.retry`（342）/ `error.load`（343）/ `state.loading`（344）均已列出，与源码一致。**结论：偏差范围恰为上述 4 条，实现是事实来源，契约清单滞后。**
3. **`dict = null` 无防御**：`Object.prototype.hasOwnProperty.call(dict, key)` 在 `dict` 为 `null` 时抛 `TypeError`（`src/locales.ts:94`）。当前所有调用方（`src/sidebar.tsx:136`、`src/client.tsx:232`）都传 `zh`，未触发；若后续引入外部词典来源需补校验。
4. **无英文表、无语言选择**：`src/locales.ts` 只导出 `zh`；`createT` 的 `dict` 参数是唯一扩展点（注释 `src/locales.ts:15`「key 稳定，便于后续加英文表」）。当前宿主语言切换只能切换命名空间解析，实际词条仍是中文。
5. **`history.label` 值不是自然语言**：`'history-worktree-session'`（`src/locales.ts:25`）是机器标识符而非可读文案，被 `src/tree-model.ts:2345` 当作 label 使用，若渲染到界面会显示裸标识符。
6. **占位符正则限制**：`/\{([A-Za-z0-9_]+)\}/g`（`src/locales.ts:97`）不支持中文或带空格的变量名；`worktree.pathHint` 值中的 `<主仓父目录>` 使用尖括号而非花括号，因此不参与替换 —— 这是有意设计，但容易被误认为占位符。
7. **无自动化测试覆盖**：`test/` 目录下无任何文件引用 `locales` 或 `createT`（已用 `grep -rn "locales\|createT" test/*.mjs` 核验，无匹配）。本文件的「可被 `node --test` 直接覆盖」是设计属性，非已验证事实。

## 10. 相关文档

- [WebClient 模块技术文档](../l2-modules/WebClient模块技术文档.md)
- [Sidebar 技术文档](../l3-components/Sidebar技术文档.md)
- [worktree-groups 知识库总览](../l1-architecture/worktree-groups-knowledge-base.md)
- 接口契约：`docs/INTERFACES.md` §2.1 `src/locales.ts`（第 287 行起）
