/**
 * 客户端词条表（中文）。
 *
 * 本文件是**纯逻辑**：不 import react、不 import 任何 `@deepseek-ai/*` 包、不做 IO，
 * 因此可以被 `node --test` 直接覆盖。
 *
 * key 集合是 `docs/INTERFACES.md` §2.1 冻结的最小集：渲染层（T5）只会用到这些 key，
 * 少一个就会在界面上露出裸 key。新增 key 请先改契约文件。
 *
 * 尾部 5 条（`worktree.menu` / `a11y.subagents` / `a11y.runningTask` /
 * `state.loadingTree` / `worktree.createTitle`）是 T5 落地渲染层后补入的实测缺口，
 * 属于同一冻结集（`a11y.runningTask` 由 2026-10-20 运行中高亮需求补入，仍定义在本块内）；
 * `docs/INTERFACES.md` §2.1 的最小集清单待主代理同步更新。
 */

/** 中文词条表（key 稳定，便于后续加英文表）。 */
export const zh: Record<string, string> = {
  'section.workspaces': '工作区',
  'section.ungrouped': '未分组',
  'search.placeholder': '搜索会话…',
  'search.empty': '无匹配结果',
  'session.new': '新会话',
  'session.blank': '新会话',
  'sessions.expand': '展开其余 {n} 个会话',
  /** 2026-11-14 PX1：渐进展开按钮（n = 本次多展开的条数）。 */
  'sessions.expandMore': '展开更多 {n} 个',
  'sessions.collapse': '收起',
  'history.label': 'history-worktree-session',
  'worktree.main': '主',
  'worktree.create': '新建 worktree…',
  'worktree.remove': '移除 worktree',
  'worktree.creating': '正在创建…',
  'worktree.removing': '正在移除…',
  'worktree.newBranch': '新建分支',
  'worktree.useExisting': '复用已有分支',
  'worktree.branchName': '分支名',
  'worktree.baseBranch': '起始分支',
  'worktree.fromBranch': '基于分支',
  'worktree.newBranchPlaceholder': '输入新分支名，如 feature/demo',
  'worktree.projectName': '目录名',
  'worktree.location': '位置',
  'worktree.chooseLocation': '选择目录',
  'worktree.willCreateIn': 'worktree 将创建在：',
  'worktree.localBranches': '本地分支',
  'worktree.remoteBranches': '远端分支',
  'worktree.loadingBranches': '正在加载分支…',
  'worktree.createAction': '创建 Worktree',
  'worktree.hint.branchCheckedOut': '分支 “{branch}” 已在 {worktreeName} 中检出，请勾选“新建分支”或选择其他分支',
  'worktree.hint.branchExists': '本地分支 “{branch}” 已存在，请换一个新分支名',
  'worktree.hint.newBranchRequired': '请输入新分支名',
  'worktree.hint.invalidProjectName': '目录名无效（不能为空、不能以 . 开头、不能包含路径分隔符）',
  'worktree.hint.invalidLocation': '请输入有效的绝对目录路径',
  'worktree.hint.sameAsMainRepo': '目标路径不能与主仓目录相同',
  'worktree.path': '路径',
  'worktree.pathHint': '默认：<主仓父目录>/<主仓名>-<分支名>',
  'worktree.confirm': '创建',
  'worktree.cancel': '取消',
  'worktree.removeConfirm': '确定移除 worktree “{name}”？',
  'worktree.removeKeepBranch': '分支会保留，可用 git branch -d 删除。',
  'worktree.forceRemove': '强制删除（丢失未提交改动）',
  'worktree.dirty': '该 worktree 有未提交改动。',
  // D10：`worktree-create` 返回 `ok:true` 但注册工作区失败时的**非阻塞**提示
  // （worktree 确实建成了，只是没有 workspaceId ⇒ 不会自动开新会话）。
  'worktree.workspaceWarning': 'worktree 已创建，但注册为工作区失败，未自动新建会话：{message}',
  'project.add': '添加工作区…',
  'menu.newSession': '新建会话',
  'menu.reveal': '在文件管理器中打开',
  'menu.copyPath': '复制路径',
  'menu.rename': '重命名',
  'menu.archive': '归档',
  'menu.fork': '派生会话',
  'menu.removeHistory': '移出 history',
  'menu.deleteWorkspace': '删除工作区',
  // D10（2026-09-21 用户决策变更）：拖拽排序落地后，必须有一个**切回默认排序**的入口
  // （「拖拽即切手动排序」的承诺是「直到你手动切回最近更新」）。菜单项即可，不做模式切换 UI。
  'menu.resetOrder': '恢复默认排序',
  'dialog.rename': '重命名',
  'dialog.renameWorkspace': '重命名工作区',
  'dialog.renameSession': '重命名会话',
  'dialog.confirm': '确定',
  'dialog.cancel': '取消',
  'error.title': '侧栏渲染出错',
  'error.retry': '重试',
  'error.load': '加载失败',
  'state.loading': '加载中…',
  // 渲染层（T5）实际使用、原最小集遗漏的 4 条。原由 `sidebar.tsx` 的临时
  // 兜底常量补齐，该常量已随清理彻底删除，这 4 条现为冻结集的正式成员
  // （与 `state.loading` 并存，语义不同：本条专指树数据首拉）。
  'worktree.menu': '更多操作',
  'a11y.subagents': '{n} 个子代理运行中',
  // 2026-10-20 运行中任务高亮：容器行 lead 图标的 `title`（key 唯一，见 INTERFACES §2.1）。
  'a11y.runningTask': '有任务正在运行',
  'state.loadingTree': '正在加载工作区…',
  'worktree.createTitle': '在 {name} 下新建 worktree',
  // 2026-10-21 新增：底部「最近」分区、归档工作空间与设置页恢复管理词条（WSR1/WSR2/WSR6）。
  'section.recent': '最近',
  'menu.archiveWorkspace': '归档工作空间',
  'settings.archivedWorkspaces.title': '已归档的工作空间',
  'settings.archivedWorkspaces.description':
    '归档后的工作空间及其会话不在侧栏显示，可在此放出恢复，或重新添加相同目录自动放出',
  'settings.archivedWorkspaces.empty': '暂无已归档的工作空间',
  'settings.archivedWorkspaces.restore': '放出',
}

/** 取词函数签名（`{name}` 占位符由 `vars.name` 替换）。 */
export type Translate = (key: string, vars?: Record<string, string | number>) => string

/**
 * 把 `{name}` 形式的占位符替换为 `vars.name` 的字符串形式。
 *
 * 占位符缺失时**保留原样** `{n}`（不崩、不抛、不返回 undefined）。
 *
 * @param template 词条模板。
 * @param vars 占位符取值。
 * @returns 替换后的字符串。
 */
function format(template: string, vars?: Record<string, string | number>): string {
  if (vars === undefined) return template
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (match: string, name: string): string =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
  )
}

/**
 * 取词函数工厂。缺 key 时返回 key 本身（不崩、不返回 undefined）；
 * 占位符缺失时保留原样 `{n}`（不崩、不抛）。
 *
 * @param dict 词条表，缺省用 {@link zh}（便于后续挂英文表或测试注入）。
 * @returns `t(key, vars?)`：把 `{name}` 形式的占位符替换为 `vars.name` 的字符串形式。
 *
 * @example
 * const t = createT()
 * t('sessions.expand', { n: 29 }) // '展开其余 29 个会话'
 * t('not.exists')                 // 'not.exists'
 * t('sessions.expand')            // '展开其余 {n} 个会话'
 */
export function createT(dict: Record<string, string> = zh): Translate {
  return (key: string, vars?: Record<string, string | number>): string => {
    // 只用自有属性：避免 'toString' 这类原型链 key 被当成词条。
    const template = Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : key
    if (template === undefined) return key
    return format(template, vars)
  }
}

/**
 * 包装函数缓存：`seat` →（`dict` → 包装后的 `t`）。
 *
 * **为什么必须缓存**：`sidebar.tsx` 里以 `t` 为依赖的 `useMemo` 要求 `t` 引用稳定。
 * 宿主 seat 本身按 (face, ns, revision) 缓存（`localeSeat`），若我们每次渲染都新建一个
 * 包装闭包，那些 `useMemo` 会**每帧失效**（重算整棵树的排序 / 搜索候选）。
 *
 * 用 `WeakMap` 而不是 `Map`：seat 由宿主持有，宿主换掉 seat 后缓存条目可被回收，
 * 不会把宿主对象钉在内存里。
 */
const seatCache = new WeakMap<Translate, WeakMap<Record<string, string>, Translate>>()

/**
 * 把宿主 **locale seat** 包一层「解不出就回落内置中文」的兜底。
 *
 * ## 为什么需要它（2026-09-23 缺陷）
 *
 * 宿主 `locale` 服务的解析规则是：按当前语言的 fallback 链在本 entry 的**命名空间**查表，
 * 再查 `common` 命名空间，**都查不到就返回 key 本身**
 * （`@deepseek-ai/dsh-client-locale/lib/client.js` 的 `translate`）。
 * 而 entry 一旦声明了 `locale`，renderer 就**一定**给组件 seat `t`
 * （`dsh-client-ui-renderer` 的 `standardKit` → `localeSeat`），
 * 于是 `sidebar.tsx` 的 `FALLBACK_T` **永远走不到** —— 词典没注册成功时，侧栏每个取词点
 * （右键菜单项、按钮 `title`/`aria-label`、搜索占位符…）都会显示裸 key。
 *
 * 2026-09-23 的真实触发路径是**启动时序**：`client.tsx` 曾用一次性 `ctx.get('locale')`
 * 探测服务并**静默跳过**注册，而 DSH web 启动**并发创建所有 client entry**
 * （`Promise.all(loader.create(...))`），locale 插件自身还要等
 * `slots`/`remote`/`settingsScope` ⇒ 本插件的 apply 可能先跑 ⇒ 注册被跳过 ⇒
 * seat 绑定到空命名空间 ⇒ 满屏裸 key。
 *
 * 本函数是**治果**的一层：`client.tsx` 改成等 `locale` 出现再注册（治因）之后它仍然保留
 * —— 任何时序、任何宿主语言、任何注册失败下，界面都不会再露 key。
 *
 * ## 语义（逐条有测试）
 *
 * 1. `seat` 返回的**不是** key ⇒ **逐字透传**（宿主 `common` 命名空间的译文、其它语言的
 *    译文都不许被我们顶掉）；
 * 2. `seat` 返回的就是 key（未解析）或 `seat` 抛错 ⇒ 回落本表；本表也没有 ⇒ 返回 key；
 * 3. 回落路径同样替换占位符（否则会显示「展开其余 {n} 个会话」）。
 *
 * @param seat 宿主 seat 取词函数（`kit.t`）。
 * @param dict 兜底词条表，缺省 {@link zh}。
 * @returns 与 `seat` 同签名的取词函数；**同一 (seat, dict) 组合返回同一引用**。
 *
 * @example
 * const t = createSeatT(unresolvedSeat)   // 宿主词典缺席
 * t('menu.newSession')                    // '新建会话'（不是 'menu.newSession'）
 */
export function createSeatT(seat: Translate, dict: Record<string, string> = zh): Translate {
  let perDict = seatCache.get(seat)
  if (perDict === undefined) {
    perDict = new WeakMap()
    seatCache.set(seat, perDict)
  }
  const cached = perDict.get(dict)
  if (cached !== undefined) return cached

  const t: Translate = (key: string, vars?: Record<string, string | number>): string => {
    let resolved: unknown
    try {
      resolved = seat(key, vars)
    } catch {
      // 宿主 locale 服务炸了也不许把异常抛到渲染层（PRD R6：缺失即降级，绝不崩）。
      resolved = undefined
    }
    // 判据只有「seat 是否真的解析了」：返回 key 本身 = 未解析（宿主 translate 的兜底）。
    if (typeof resolved === 'string' && resolved !== key) return resolved
    const template = Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : undefined
    if (template === undefined) return key
    return format(template, vars)
  }

  perDict.set(dict, t)
  return t
}
