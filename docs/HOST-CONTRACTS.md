# DSH 宿主契约核实报告（dsh-worktree-groups）

> 核实对象：DSH Desktop 2.0.10 / 官方包 `@deepseek-ai/*@0.1.5-rc.2` / `@deepseek-ai/cordis@4.0.2`
> 核实方式：**只读**源码阅读 + 在 `/tmp` 中复刻 profile 布局做**实测**（未修改 `DSH Desktop.app`、`~/.dsh`、参考项目）
> 日期：2026-09-21

## 0. 证据路径约定

| 简称 | 绝对路径 |
|---|---|
| `APP` | `/Applications/DSH Desktop.app/Contents/Resources/app` |
| `NODE_MODULES` | `APP/node_modules/@deepseek-ai` |
| `REF` | `/Users/dev/Documents/Project/OpenSource/dsh-coding-workspace` |
| `TARGET` | `/Users/dev/Documents/Project/AnyWork/dsh-worktree-groups` |
| `PROFILE` | `/Users/dev/.dsh/profiles/web` |

---

# A. 宿主服务契约

## A1. `ctx.sessionPersistence`

### A1.1 服务名：**正确**

`NODE_MODULES/dsh-session-persistence/lib/index.js:236-240`（`super(ctx, "sessionPersistence")`）：

```js
var SessionPersistence = class extends Service {
	constructor(ctx) {
		super(ctx, "sessionPersistence");
	}
};
```

### A1.2 `list()` 返回结构

`NODE_MODULES/dsh-session-persistence-jsonl/lib/index.js:2454-2481`：

```js
async list(options) {
	const signal = options?.signal;
	const snapshots = [];
	const listed = new Set();
	const pending = [...this.tracker.pendingEntries()];
	for (const artifact of await this.listArtifacts(signal)) {
		const identity = await stat(artifact.path, { bigint: true });
		listed.add(artifact.header.id);
		snapshots.push({
			header: artifact.header,
			revision: fileRevision(identity),
			sizeBytes: Number(identity.size)
		});
	}
	for (const [id, entry] of pending) if (!listed.has(id)) snapshots.push({
		header: entry.header,
		revision: entry.revision
	});
	return snapshots;
}
```

**返回值**：`Array<{ header: SessionHeader, revision: <opaque>, sizeBytes?: number }>`（`sizeBytes` 只在已实体化时存在）。
`options.signal` 可选（`AbortSignal`）。

> README（`dsh-session-persistence/README.zh.md`，已知限制节）明确："**`list()` 无分页且无过滤**——它返回每个已存储会话的快照"。

### A1.3 是否包含**所有历史会话**（含 cwd 已删除的会话）：**是**

证据链：
1. `listArtifacts()` 直接遍历磁盘目录树，与 cwd 是否仍存在**无关** — `dsh-session-persistence-jsonl/lib/index.js:2858-2888`：

```js
async listArtifacts(signal) {
	const artifacts = [];
	const ids = new Set();
	for (const project of await this.listProjectDirs(signal)) {
		for (const dir of await this.listSessionDirs(project, signal)) {
			const selected = await this.resolveGenerationInDirectory(dir, signal);
			if (selected === void 0) continue;
			header = await this.readGenerationHeader(selected, void 0, signal);
			artifacts.push({ header, path: selected.sourcePath });
		}
	}
	return artifacts;
}
```

2. `listProjectDirs()` 只是 `readdir(this.root)`，不校验目录内 cwd 是否存活 — `dsh-session-persistence-jsonl/lib/index.js:3256-3266`：

```js
async listProjectDirs(signal) {
	const entries = await readdir(this.root, { withFileTypes: true });
	return entries.filter((e) => e.isDirectory()).map((e) => join(this.root, e.name));
}
```

3. **实测佐证**（磁盘实况）：`LogAnalyst-toolbar-refactor` 目录已被删除，但其会话目录仍在：

```
$ ls -d /Users/dev/Documents/Project/Desktop/LogAnalyst-toolbar-refactor
ls: ... No such file or directory
$ ls /Users/dev/.dsh/sessions/ | grep LogAnalyst
--Users-dev-Documents-Project-Desktop-LogAnalyst--
--Users-dev-Documents-Project-Desktop-LogAnalyst-toolbar-refactor--   ← 仍在
```

**结论**：`sessionPersistence.list()` 是获取**全量历史会话 header**（含死 cwd 会话）的正确来源。这正是 PRD D4「双源识别」里"孤儿会话"能被发现的机制基础。

### A1.4 header 上 `cwd` **不总有值**

`dsh-session-persistence-jsonl/lib/index.js:2929-2939`（`currentHeader`，用条件展开构造，`cwd === undefined` 时**不产生该键**）：

```js
return {
	version: SESSION_FORMAT_VERSION,
	id: SessionId(header.id),
	createdAt: header.createdAt,
	...header.cwd === void 0 ? {} : { cwd: header.cwd },      // ← 可能不存在
	...header.parentSession === void 0 ? {} : { parentSession: SessionId(header.parentSession) },
	isSeeded: header.isSeeded,
	...
};
```

物理布局也印证了这一点 — `dsh-session-persistence-jsonl/lib/index.js:901-903`：

```js
function projectDir(root, cwd) {
	if (cwd === void 0) return join(root, "_no-cwd");
	return join(root, projectKey(cwd));
}
```

即**无 cwd 的会话落在 `_no-cwd/` 目录**。`SessionHeader` 的权威声明（`dsh-api-session-controller/lib/typert.host.js:1741`）把 `cwd` 标为可选：

```
export interface SessionHeader {
    readonly version: typeof SESSION_FORMAT_VERSION;
    readonly id: SessionId;
    readonly createdAt: number;
    readonly cwd?: string;                 // ← optional
    readonly parentSession?: SessionId;
    readonly isSeeded: boolean;
    readonly origin?: 'subagent';
    readonly delegationDepth?: number;
    readonly agentPreset?: string;
}
```

> ⚠️ **当前机器上 `ls /Users/dev/.dsh/sessions/` 未出现 `_no-cwd/` 目录**（23 个项目目录，无 `_no-cwd`）。说明此机现存会话**都**带 cwd；但契约上**必须**把 `header.cwd === undefined` 当合法分支处理（子代理 / 某些程序化创建路径可能不传 cwd）。

### A1.5 `SessionHeader` 无仓库指针 —— PRD 判断成立

字段全集见上（`typert.host.js:1741`）。**没有** git repo / worktree / common-dir 任何字段。因此 history 归属确实只能靠自建台账 + 路径启发（PRD D4/D21 成立）。

---

## A2. `ctx.get('sessions')` / `ctx.sessions`

### A2.1 服务名：`sessions`

`NODE_MODULES/dsh-api-session-controller/lib/client.js:3087`：`rootCtx.reflect.provide("sessions", this, void 0);`
宿主侧同名服务由 `NODE_MODULES/dsh-session/lib/index.js:1315` 提供（`super(ctx, "sessions")`）。

### A2.2 `.list()` 返回结构

**客户端 `sessions.list` 不是方法，而是一个 observable 快照源（`{ getSnapshot, subscribe }`）**，由 `dsh-client-ui-session` 装配为标准 hook：

`NODE_MODULES/dsh-client-ui-session/lib/client.js:321-324`：

```js
ctx.slots.provideRoot({ hooks: {
	sessions: ctx.sessions.list,
	sessionPendingInteraction: service.pendingInteractions
} });
```

**快照形状（已逐行定位）** —— `ClientSessions` 构造时建立的 `createSnapshotStore` 初值（`dsh-api-session-controller/lib/client.js:3061-3069`）：

```js
this.list = createSnapshotStore({
	ids: [],
	byId: {},
	current: void 0,
	phase: "pending",
	subagentsByParent: {},
	jobsBySession: {},
	currentAddress: void 0
});
```

`projectList()` 负责把这些键刷新为实时值（`:3071`、`:3214`）。

`byId` 的值是 `SessionSummary`，权威声明在 `dsh-api-session-controller/lib/typert.host.js:1877`：

```
export interface SessionSummary {
    readonly sessionId: SessionId;
    readonly updatedAt: number;
    readonly running: boolean;
    readonly blank: boolean;
    readonly parentSessionId?: SessionId;
    readonly origin?: 'subagent';
    readonly cwd?: string;
    readonly projections?: SessionProjectionHints;
}
```

> 额外确认：`current`（当前会话 id）也在快照上 — 官方用法 `dsh-client-ui-workspace/lib/client.js:1988-1991` 读 `useSessions((state) => { const current = state.current; ... })`。`byId`、`ids`、`phase` 同样可用（同文件 `:2031`、`:1992`）。

**渲染顺序提示**：`byId` 是**扁平** map，但宿主快照的 `items` 顺序经过 `flattenLineage()`（`:554-580`）投影 —— 它按 `parentSessionId` 把子代理会话挂在父会话下并**加 `depth` 字段**，且明确注释「this projection never re-sorts a hydrated list from mutable timestamps」（`:549`）。⇒ **子代理嵌套（US7）可直接复用 `flattenLineage` 的产物顺序 + `depth`**，但该函数**未导出**（`export` 清单在文件尾部，不含它），需自行实现等价逻辑。

**宿主侧 `ctx.sessions.list()`** 完全不同 —— 返回**活着的 Session 实例**，非 header：

`NODE_MODULES/dsh-session/lib/index.js:1562-1564`：

```js
list() {
	return [...this.store.values()].map((entry) => entry.session);
}
```

### A2.3 与 sessionPersistence 的区别

| | `ctx.sessionPersistence.list()` | 客户端 `sessions.list` 快照 | 宿主 `ctx.sessions.list()` |
|---|---|---|---|
| 层级 | 宿主 | 客户端 | 宿主 |
| 覆盖 | **全量磁盘历史**（含死 cwd） | 仅**可见/未归档**的会话摘要 | 仅**进程内活着**的 Session |
| 每项 | `{header, revision, sizeBytes?}` | `SessionSummary`（含 `running/blank/updatedAt`） | `Session` 实例 |
| 用途 | 全量历史 + 孤儿发现 | 侧栏渲染 | 宿主工具执行 |

> **对 PRD 的关键影响**：`SessionSummary` **有** `updatedAt`/`running`/`blank`/`parentSessionId`，但**没有** `createdAt`、**没有** `isSeeded`、**没有** `agentPreset`；`SessionHeader` **有** `createdAt`/`isSeeded`/`agentPreset` 但**没有** `updatedAt`/`running`/`blank`。US4「最近 5 条会话」的排序键 `updatedAt` 只能来自客户端 `sessions` 快照，**不能**来自 `sessionPersistence`。两侧需要按 `sessionId` join。

---

## A3. `ctx.webServer.register` 签名与可复用最小骨架

### A3.1 签名

`NODE_MODULES/dsh-host-webserver/lib/index.js:176-183`：

```js
register(route) {
	const table = route.kind === "exact" ? this.exact : this.prefixes;
	if (table.has(route.path)) throw new Error(`webserver: duplicate ${route.kind} route "${route.path}"`);
	table.set(route.path, route);
	return () => { table.delete(route.path); };   // ← 返回 disposer
}
```

- `route = { kind: 'exact' | 'prefix', path: string, handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void> }`
- 服务名 `webServer`（`dsh-host-webserver/lib/index.js:157`：`super(ctx, "webServer")`）。
- 匹配顺序：**先 exact 全表，再最长 prefix，最后 fallback**（`lib/index.js:321-328`）。
- 同 `(kind, path)` 重复注册**抛错**。
- handler 抛错时服务器回 400，**不会**退出进程（README「失败时的行为」）。
- `ctx.webServer.port` 可读取实际监听端口。

### A3.2 参考插件怎么用（`REF/src/tools/panel-routes.ts`）

注册（`REF/src/tools/panel-routes.ts:57-101`，节选骨架）：

```ts
ctx.effect(
  () =>
    ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-coding-workspace/fs-list',
      handler: async (req, res) => {
        const body = await readBody(req)
        const root = typeof body?.root === 'string' ? body.root : ''
        if (root === '') return json(res, 400, { ok: false, message: '缺少 root' })
        try {
          /* ...业务... */
          json(res, 200, { ok: true, entries })
        } catch (error) {
          json(res, 400, { ok: false, message: error instanceof Error ? error.message : String(error) })
        }
      },
    }),
  'dsh-coding-workspace: fs-list route',
)
```

读 body / 写 JSON 两个私有 helper（`REF/src/tools/panel-routes.ts:842-861`，逐字）：

```ts
// REF/src/tools/panel-routes.ts:842-845
function json(res: import('node:http').ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload))
}

// REF/src/tools/panel-routes.ts:847-861
/** 读取请求体 JSON;失败返回空对象。 */
function readBody(req: import('node:http').IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch {
        resolve({})
      }
    })
    req.on('error', () => resolve({}))
  })
}
```

> `REF/src/tools/workspace-create-route.ts:215-234` 有一份**逐字重复**的同名 helper（同样 861 行的文件里第 215 行起）—— 说明这是参考项目里被复制粘贴的惯例，不是导出模块。

### A3.3 可直接复制的骨架（含 import）

```ts
// src/routes.ts
import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'

/** 写 JSON 响应。 */
function json(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload))
}

/** 读请求体 JSON;解析失败或出错都返回空对象。 */
function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch {
        resolve({})
      }
    })
    req.on('error', () => resolve({}))
  })
}

/**
 * 注册本插件的全部 HTTP 路由。
 * ctx.effect 保证插件卸载时路由一并撤销。
 */
export function registerRoutes(ctx: Context): void {
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/dsh-worktree-groups/projects',
        handler: async (req, res) => {
          const body = await readBody(req)
          const cwd = typeof body.cwd === 'string' ? body.cwd : ''
          if (cwd === '') return json(res, 400, { ok: false, message: '缺少 cwd' })
          try {
            json(res, 200, { ok: true, projects: [] })
          } catch (error) {
            json(res, 400, { ok: false, message: error instanceof Error ? error.message : String(error) })
          }
        },
      }),
    'dsh-worktree-groups: projects route',
  )
}
```

宿主入口需要 `webServer` 在 `inject` 里声明（否则 Cordis 对未声明服务的属性访问会抛错，见 `REF/src/client.tsx:24-25` 的同款注释）：

```ts
// src/index.ts
import type { Context } from '@deepseek-ai/cordis'
import { registerRoutes } from './routes.js'

export const name = 'dsh-worktree-groups'
export const inject = ['webServer']
export function apply(ctx: Context): void {
  registerRoutes(ctx)
}
```

> 若 `webServer` 缺席时应降级而非卡死，用 `ctx.get('webServer')` 判空 + 不写进 `inject`。

---

## A4. `ctx.workspaceRegistry` 确切签名

全部来自 `NODE_MODULES/dsh-workspace/lib/index.js`。类声明在 `:313-334`：

```js
var WorkspaceRegistry = class extends Service {
	static inject = ["storageDomain", "sessionPersistence"];
	constructor(ctx) { super(ctx, "workspaceRegistry"); }
```

### A4.1 `create(path, title?)` → `Promise<Workspace>`

`:365-369`：

```js
async create(path, title) {
	const canonical = await realpathNormalize(path);
	if (!(await stat(canonical)).isDirectory()) throw new Error(`cannot create a workspace at '${canonical}': path is not a directory`);
	return await this.enqueueOperation(() => this.createCanonical(canonical, title));
}
```

JSDoc（`:354-364`）逐字确认**幂等**语义：

> Create or reuse a workspace for an existing directory. The fully qualified path is canonicalized through `fs.realpath`; a relative, nonexistent, or non-directory path rejects. **Repeated calls for the same canonical path return the existing entity without changing its title.** A newly created workspace is prepended to the durable registry order. Different canonical paths may share a display title.

**幂等性结论：对已存在路径是幂等的，但返回现有实体且不更新 title。** 且非目录/不存在路径**抛错**（不是返回 undefined）。

### A4.2 `get(id)` → `Workspace | undefined`（同步）

`:375-377`：

```js
get(id) {
	return this.entities.get(id);
}
```

### A4.3 `list()` → `Workspace[]`（同步，无持久化读）

`:384-390`：

```js
list() {
	return this.requireState().workspaceIds.map((id) => {
		const entity = this.entities.get(id);
		if (entity === undefined) throw new Error(`workspace registry order references missing workspace '${id}'`);
		return entity;
	});
}
```

**注意反直觉命名**：README「创建与排序项目」说 `list()` "shows the project, newest first"，但代码按 `workspaceIds` 顺序，而 `create` 是 **prepend**（`:359` JSDoc 与 `:414` 区域），所以实际是**新建在前**。不要假设是 createdAt 排序。

### A4.4 `delete(id)` → `Promise<boolean>`

`:399-401`：

```js
delete(id) {
	return this.enqueueOperation(() => this.deleteKnown(id));
}
```

JSDoc（`:391-398`）："Unknown ids are an **idempotent no-op** for domain callers... @returns `true` when a record was deleted, `false` when it was unknown."

### A4.5 `Workspace` 实体形状（`WorkspaceEntity`，`:76-140`）

| 成员 | 类型 | 行 |
|---|---|---|
| `id` | `string` | `:79` |
| `path` | `string`（canonical） | `:90-92` |
| `title` | `string \| undefined` | `:93-95` |
| `createdAt` / `updatedAt` | `number` | `:96-101` |
| `sessionIds` | `string[]`（**getter 会过滤**） | `:102-104` |
| `setTitle(title)` | `Promise<void>` | `:105-110` |
| `attachSession(sessionId)` | `Promise<void>` | `:111-131` |

关键陷阱 —— `sessionIds` getter 会**实时过滤**（`:102-104`）：

```js
get sessionIds() {
	return this.record.sessionIds.filter((id) => this.host.sessionPath(id) === this.record.path);
}
```

即：**cwd 目录已被删除的会话不会出现在 `sessionIds` 里**（因为 header 索引未记住其路径）。这正面印证 PRD R3「目录删除后宿主会打 `filtered session from membership` 警告日志」—— 警告在 `dsh-workspace/lib/index.js:744`。

### A4.6 `attachSession` 的强制校验（PRD 第 8 节论断成立）

`NODE_MODULES/dsh-workspace/lib/index.js:111-131`：

```js
async attachSession(sessionId) {
	if (!this.record.sessionIds.includes(sessionId)) {
		const header = await this.host.readSessionHeader(sessionId);
		if (header.cwd === undefined) throw new Error(`cannot attach session '${sessionId}' to workspace '${this.record.path}': its stored header carries no cwd to validate against`);
		let cwd;
		try { cwd = await realpathNormalize(header.cwd); }
		catch (error) { throw new Error(`... its cwd '${header.cwd}' does not resolve ...`); }
		if (!(await stat(cwd)).isDirectory()) throw new Error(`... its cwd '${header.cwd}' is not a directory`);
		if (cwd !== this.record.path) throw new Error(`cannot attach session '${sessionId}' to workspace '${this.record.path}': its cwd resolves to '${cwd}'`);
		this.host.rememberSessionPath(sessionId, cwd);
	}
	await this.mutate(...);
}
```

**结论**：PRD 第 8 节「`attachSession` 强制 `realpath(header.cwd) === workspace.path`，目录已删则**永远无法 attach**」—— **确认成立**，且比 PRD 描述更严格：即使目录存在但 `realpath` 结果不同（符号链接）也会拒绝。

---

## A5. `@deepseek-ai/dsh-home-paths`

### A5.1 确切导出名

`NODE_MODULES/dsh-home-paths/lib/index.js` 末行：

```js
export { DEFAULT_DSH_HOME_DISPLAY, DSH_HOME_DIR_NAME, DSH_HOME_ENV, canonicalizeWatchPath, defaultDshHome, dshHomeDisplay, dshHomePath, expandHomePath, resolveDshHome };
```

**没有 `defaultDshHome` 以外的写法** —— 提问中的 `defaultDshHome()` 名字**正确**。签名与实现（同文件）：

```js
/** Resolve the default DeepSeek Harness home using Node's platform path rules. */
function defaultDshHome() {
	return join(homedir(), DSH_HOME_DIR_NAME);      // DSH_HOME_DIR_NAME = ".dsh"
}
```

**重要区别**（README「解析主目录」小节 + 实现）：

| 函数 | 语义 | 是否读 `$DSH_HOME` |
|---|---|---|
| `defaultDshHome()` | **固定**返回 `~/.dsh` | ❌ 不读 |
| `resolveDshHome(configured?, env?)` | 显式配置 → `$DSH_HOME` → `~/.dsh` | ✅ 读 |
| `dshHomePath(...segments)` | `join(resolveDshHome(), ...segments)` | ✅ 读 |

> ⚠️ **PRD/实现必须选对**：台账文件要落在「用户实际使用的 DSH home」。若本机设了 `$DSH_HOME`，用 `defaultDshHome()` 会把台账写到错误的 `~/.dsh`。**推荐 `dshHomePath('worktree-groups.json')`**（PRD D21 指定 `~/.dsh/worktree-groups.json`，用 `dshHomePath` 同时满足默认情形与 `$DSH_HOME` 覆盖情形）。
>
> 参考插件用的正是 `defaultDshHome`（`REF/src/tools/panel-routes.ts:5`：`import { defaultDshHome } from '@deepseek-ai/dsh-home-paths'`）—— 这是它的一处**可改进点**，不建议照抄。

### A5.2 能否从插件 import：**能，但必须满足前置条件**

`dsh-home-paths/package.json` 的依赖姿态：**零 `dependencies`**，只有 `peerDependencies: { "@deepseek-ai/cordis": "^4.0.2" }`。它是纯工具包（README：「请把它作为库依赖直接使用，**不要**通过 `cordis.yml` 加载」）。

**实测**（在 `/tmp` 复刻 `~/.dsh/profiles/{web,}/node_modules` 布局，用 DSH 自己的 resolver `APP/lib/module-resolution-C8mVg9xZ.js`）：

```
$ node run8.mjs --resolver
entry -> file:///private/tmp/anywork/dsh-worktree-groups/lib/index.js
    hp        => OK(9 exports)      ← @deepseek-ai/dsh-home-paths 解析成功
    tools     => OK(23 exports)
    persist   => OK(18 exports)
    ws        => OK(10 exports)
    cordis    => OK(26 exports)
```

对照 —— **不带** resolver 的裸 Node：

```
$ node run8.mjs
entry -> file:///tmp/simhome/profiles/web/node_modules/@dsh-external/dsh-worktree-groups/lib/index.js
    hp        => ERR_MODULE_NOT_FOUND     ← 全部失败
```

**结论**：解析**依赖 DSH 的 profile package resolver**，而不是 Node 的普通 node_modules 上溯。详见 C13/C14。

---

## A6. 宿主工具 `ctx.tools.register` + `defineTool` 最小骨架

`dsh-tools/README.zh.md:41-57` 给出官方骨架；参考实现在 `REF/src/tools/list.ts:1-41`：

```ts
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export function registerWorktreeList(ctx: Context): void {
  ctx.tools.register(
    defineTool({
      name: 'worktree_list',
      description: '列出指定仓库（默认当前工作目录）的所有 git worktree...',
      parameters: {
        repoPath: { type: 'string' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute(args, exec) {
        const repoPath = args.repoPath ?? process.cwd()
        // exec.signal 是协作式取消信号
        return JSON.stringify({ count: 0, entries: [] })
      },
    }),
  )
}
```

要点（`dsh-tools/README.zh.md:60`）：参数 DSL 支持 `string | number | integer | boolean | null | array | object | json | oneOf`；`output.schema` 声明规范输出，`execute` **只能**返回所声明的 JSON 值。

宿主入口 `inject` 需含 `'tools'`（参考：`REF/src/index.ts:7`：`export const inject = ['tools']`；`dsh-askhuman`：`src/index.ts:9`：`export const inject = ['tools', 'systemPrompt']`）。

> **对本插件的相关性低**：PRD 第 3 节非目标未列宿主工具，D16 范围为「宿主 git/fs 服务 + 侧栏树 + 新建/移除 worktree + 菜单 + 状态点」——全部经 HTTP 路由 + 客户端，**不需要**注册模型工具。仅当希望模型能直接查 worktree 时才需要，属可选。

---

# B. 客户端契约

## B1. `sidebar.workspaces` 槽位：占据者收到的 props 完整列表

### B1.1 官方组件签名（反推基准）

`NODE_MODULES/dsh-client-ui-workspace/lib/client.js:1976`（`WorkspaceBrowser` 入参解构，**逐字**）：

```js
function WorkspaceBrowser({ wide, usePanelInfo, expandSidebar, useSessions, useSessionPendingInteraction, useWorkspaces, useStore, actions, startSession, open, renameSession, forkSession, renameWorkspace, deleteWorkspace, insertWorkspaceBefore, archiveSession, insertSessionBefore, createWorkspace, searchSessions, searchResultLimit, useDirectoryFlow, useHostInfo, renderSlot, t }) {
```

### B1.2 props 来源分三类

**(a) 框架 standard kit**（`APP/node_modules/@deepseek-ai/dsh-client-ui-renderer/lib/client.js`）：

- `standardKit()` `:599-627` —— 合成 `t` / `useStore` / `actions` / `renderSlot` / `renderSlotChain` / `SessionProvider`
- `materializeStandardBinding()` `:538-549` —— 每个 `hooks` 源变成 `use<Name>` prop（`standardHookPropName`，`dsh-client-ui-slots/lib/index.js:7-9`）
- `ContextualEntry` `:633-651` —— 最终 props 合并顺序：`kit` → `injected` → `slotInjected.props` → `contextual` → **`ownerProps`（最后，owner 胜出）**

**(b) slot 级 `slots.provideRoot` 贡献**（全局，对所有 root scope 槽位可用）：

| prop | 提供者（证据） | 数据结构 |
|---|---|---|
| `useSessions` | `dsh-client-ui-session/lib/client.js:321-324`：`ctx.slots.provideRoot({ hooks: { sessions: ctx.sessions.list, sessionPendingInteraction: ... } })` | 选择器 hook：`useSessions(s => s.items)`；快照 `{ items: SessionSummary[], byId, ids, current, archivedSessionIds, state, phase, error }` |
| `useSessionPendingInteraction` | 同上 | 选择器 hook |
| `useWorkspaces` | `dsh-client-ui-workspace/lib/client.js:2730`：`ctx.slots.provideRoot({ hooks: { workspaces: workspaces.list } })` | 快照 `{ items, archivedSessionIds, state, phase, error }`（`dsh-api-workspace-controller/lib/client.js:187-195`） |
| `usePanelInfo` | `dsh-client-ui-layout/lib/client.js:519-522`：`ctx.slots.provideRoot({ hooks: { panelInfo: {...} } })` | `{ activePanelId }` 等 |
| `useHostInfo` | 由 `dsh-client-ui-workspace` 自身经 `inject` 注入（见下 (c)） | `{ home }` |

**(c) 本 entry 的 `inject` 工厂**（`dsh-client-ui-workspace/lib/client.js:2753-2789`，`browserInjected` 返回）：

| prop | 值 / 用途 |
|---|---|
| `startSession(workspaceId, options?)` | 委托 `uiWorkspace.startSession(workspaceId, options)`；无 workspaceId 时按当前/最近工作区兜底。**2026-10-22 核实**：第二参是「空白会话复用」开关 —— 缺省（`undefined`）⇒ `connectBlank(workspaceId, undefined)` 无条件 `sessions.create`（每次铸新会话）；传对象（如 `{ clearPreviousDraft: false }`）⇒ `createInWorkspace` 按 `summary.cwd === workspace.path` 找回同目录 blank 会话并复用其 `sessionId`。证据：`dsh-client-ui-workspace/lib/client.js:1499`（签名）、`:1403`（缺省分支）、`:1418-1434`（`createInWorkspace`）、`:3938` 与 `dsh-client-ui-agent-preset/lib/client.js:2396`（宿主自己的两处用法）。详见 `docs/design/2026-10-22-new-session-draft-retention.md`。 |
| `open(sessionId)` | 打开会话 |
| `searchSessions(query, signal)` | `sessions.search` 的包装（失败抛错） |
| `searchResultLimit` | `sessions.searchResultLimit` |
| `renameSession(sessionId, title)` | 经 `sessions.binding(id).session.rename` |
| `forkSession(sessionId)` | 派生会话 |
| `renameWorkspace(workspaceId, title)` / `deleteWorkspace(workspaceId)` | 工作区改名/删除 |
| `insertWorkspaceBefore` / `insertSessionBefore` | 拖拽排序（本插件非目标） |
| `archiveSession(sessionId)` | 归档会话 |
| `createWorkspace(input)` | `workspaces.create(input)`（**入参是对象 `{path}`**，非字符串！） |
| `hooks.directoryFlow` / `hooks.hostInfo` | **bare source 对**，经 `bindInjectSources`（`:342-357`）变成 `useDirectoryFlow` / `useHostInfo` |

**(d) owner props**（`sidebar` 侧栏自己传的，`dsh-client-ui-sidebar/lib/client.js:285-290`）：

```js
children: renderSlot("sidebar.workspaces", {
	wide,
	expandSidebar: () => { if (collapsed) toggleSidebar(); }
})
```

**(e) standard store 对**（`:2800` 注册时声明了 `store: createWorkspaceViewStore()`）：

| prop | 用途 |
|---|---|
| `useStore` | 选择器 hook，读 `{ groupBy, orderBy, groupExpansion, sessionOrderByAccount, sessionUpdatedAtByAccount }`（`dsh-client-ui-workspace/lib/client.js:194-...`，`persist: "dsh.workspace.view.v5"`） |
| `actions` | 该 store 的 actions：`setGroupBy` / `setOrderBy` / `setGroupExpanded` / `retainAccountKeys` / `syncSessionOrderAccount` / `setSessionOrder` |

### B1.3 逐项确认提问清单

| 提问项 | 在？ | 说明 |
|---|---|---|
| `useWorkspaces` | ✅ | 全局 root hook，**无需自己注入** |
| `useSessions` | ✅ | 全局 root hook，**无需自己注入** |
| `useStore` | ✅ | **仅当注册时声明 `store:` 才有** |
| `renderSlot` | ✅ | **仅当注册时声明 `children:` 才有**（`standardKit` `:613-621`） |
| `useDirectoryFlow` | ✅ | 来自 `inject` 返回的 `hooks.directoryFlow` |
| `t` | ✅ | **仅当注册时声明 `locale:` 才有**（`:602-606`） |
| `actions` | ✅ | 同上，来自 `store` 声明的 `.actions` |

> ⚠️ **`renderSlot` / `t` / `useStore`+`actions` 是条件性的**，不是白送。它们各自对应注册选项 `children` / `locale` / `store`。若只写 `{ name, priority, inject }`，组件收到的 `renderSlot`、`t`、`useStore`、`actions` 全是 `undefined`。参考插件正是如此（`REF/src/client.tsx:2093-2103` 只声明 `name`/`priority`/`inject`），所以它的 `ProjectTreeBrowser` 自己实现了全部 UI 与文案，**没有**用 `renderSlot`/`t`/`useStore`。

### B1.4 ⚠️ `wide` / `expandSidebar`：侧栏「轨道态」必须处理

这是极易遗漏的交互契约。`sidebar` 传入两个 props（`dsh-client-ui-sidebar/lib/client.js:285-290`）：

```js
renderSlot("sidebar.workspaces", {
	wide,
	expandSidebar: () => { if (collapsed) toggleSidebar(); }
})
```

官方组件的处理（`dsh-client-ui-workspace/lib/client.js:2222`、`:2227-2231`、`:2338`）：`!wide` 时**不渲染树、不渲染搜索框**，只渲染 rail 态的图标按钮（CSS `rail` 类，36px 控件），点击时调 `expandSidebar()` 请求侧栏展开。JSDoc（`:1272-1279`）：

> Wide state renders the full browser; **rail state renders the two region icons (search / add workspace) as 36px controls** on the shell's shared rail entry path, each **requesting expansion through the owner share**.

⇒ 若我们的组件忽略 `wide`，在侧栏折叠（轨道态）时会渲染整棵树，**布局会崩**。必须至少：
- `wide === false` 时渲染紧凑入口（如一个 36px 的 worktree 图标按钮），`onClick` 调 `expandSidebar()`；
- `wide === true` 时才渲染三级树。

---

## B2. 声明子槽位 —— ⚠️ **本报告最重要的发现**

### B2.1 官方怎么做

`NODE_MODULES/dsh-client-ui-workspace/lib/client.js:2794-2803`：

```js
ctx.slots.inject("sidebar.workspaces", () => ctx.slots.register({
	name: "sidebar.workspaces",
	children: { "sidebar.workspaces.directoryFlow": {
		kind: "single",
		scope: "root"
	} },
	store: createWorkspaceViewStore(),
	inject: browserInjected,
	locale: NS
}, WorkspaceBrowser));
```

**注意：官方注册 `priority` 缺省（= 0），并在此声明了 `sidebar.workspaces.directoryFlow`。**

### B2.2 「如果不声明 children，原生那个添加工作区子槽位会怎样？」

**正确答案：取决于官方 `ui-workspace` 这一行是否仍然挂载。**

`dsh-client-ui-slots/lib/index.js:100-103` 的 children 冲突检查：

```js
if (options.children) for (const childKey of Object.keys(options.children)) {
	const childRec = this.records.get(childKey);
	if (childRec?.spec) throw new Error(`slot "${childKey}" is already declared (by ${childRec.declaredBy ?? "an unknown entry"})`);
}
```

`releaseEntry()` `:371-391` 在 entry 释放时把 `childRec.spec = undefined` 并级联。

**实测**（用官方 `SlotCore` 直接跑，脚本 `/tmp/ext-plugin-sim/slot-test2.mjs`）：

```
ORDER: ours(-1) first, then official(0):
    ours      -> OK
    official  -> THROW: slot "sidebar.workspaces.directoryFlow" is already declared (by an entry in "sidebar.workspaces")
    rendered priority: [-1]

ORDER: official(0) first, then ours(-1):
    official  -> OK
    ours      -> THROW: slot "sidebar.workspaces.directoryFlow" is already declared (by an entry in "sidebar.workspaces")
    rendered priority: [0]

ONLY OURS (official row disabled): OK | child declared: {"kind":"single","scope":"root"}

SHADOW-ONLY (-1, no children): OK | child still declared by official: {"kind":"single","scope":"root"}
    rendered priority: [-1]
    third-party register into child: OK, entries = 1
```

### B2.3 结论（三条互斥路线，必须选一条）

> **`sidebar.workspaces.directoryFlow` 是 single 槽位的「一次声明」资源。同时挂载的官方 `ui-workspace` 与抢占它的插件都想声明同一 child ⇒ 后注册者抛错。**

这直接推翻 PRD D19 的朴素设想（"重新声明子 slot `sidebar.workspaces.directoryFlow`，接回宿主目录选择器"）。三条可行路线：

**路线 1（推荐，且与「抢占」语义最一致）：不声明 children，只遮蔽。**
`ui-workspace` 仍然挂载并声明了 child（实测 "SHADOW-ONLY" 分支），于是：
- 渲染 winner 是优先级 `-1` 的我们 ✓
- `sidebar.workspaces.directoryFlow` 的 spec **依然存在** ✓
- 因此 `dsh-client-ui-directory-picker-browse/native` 能照常 `slots.inject` 进去 ✓
- **但我们的组件拿不到 `renderSlot`**（因为没声明 children）⇒ **无法把那个已声明的 child 渲染出来**。

⇒ 路线 1 下，PRD D19「保留添加工作区」需要**绕过 renderSlot**：自己在 overlay 里实现目录选择（用 `uiWorkspace.pickDirectory()`，见 B10），或直接调 `ctx.workspaces.create({path})`。

**路线 2：声明 children，并让官方行不挂载。** ⚠️ **实测不可行（会击穿整个 web 启动）**

`ui-workspace` 的 `apply` 里**同时**做两件事（`dsh-client-ui-workspace/lib/client.js:2726-2730` 与 `:2794-2803`）：

```js
function apply(ctx) {
	const sessions = ctx.get("sessions");
	const workspaces = ctx.get("workspaces");
	const uiWorkspace = new UiWorkspaceService(ctx, ctx.remote.directoryPicker, workspaces, sessions);   // ← 提供 uiWorkspace 服务
	...
	ctx.slots.inject("sidebar.workspaces", () => ctx.slots.register({ ..., children: {...} }, WorkspaceBrowser));  // ← 声明 child
```

而 `uiWorkspace` 是**另外 5 个客户端插件的硬 `inject` 依赖**（`super(ctx, "uiWorkspace")` 全安装目录只有这一处 provider）：

| 消费者 | 证据 |
|---|---|
| `dsh-client-ui-sidebar` | `lib/client.js:329-334`：`const inject = ["slots", "layout", "uiWorkspace", "locale"]` |
| `dsh-client-ui-conversation` | `lib/client.js:16466-16474`：含 `"uiWorkspace"` |
| `dsh-client-ui-directory-picker-browse` | `lib/client.js:1012` |
| `dsh-client-ui-directory-picker-native` | `lib/client.js:55`：`const inject = ["slots", "uiWorkspace"]` |
| `dsh-client-ui-agent-preset` | `lib/client.js:1435` |

⇒ 一旦 `disabled: true` 掉 `ui-workspace`，这 5 个插件会**永远 pending**，而 web 启动有**硬失败断言**（`dsh-web-frontend/dist/assets/index-BKQ_L1z6.js` 内 `assertEntriesActive`）：

```js
throw new Error(`web boot: ${String(r.length)} entr${r.length===1?"y":"ies"} did not activate
```

⇒ **整个页面白屏**。**路线 2 作废。**

> **修订**：本节早先版本把路线 2 当作可行备选，那是基于 `SlotCore` 单测（只验证了槽位层面不抛错）而**未检查 `uiWorkspace` 服务的消费者**。以本条为准。

**路线 3（推荐）：声明一个**自己的**新 child 键，不碰官方名。**
`dsh-client-ui-slots/lib/index.js:100-103` 只拒绝**同键重复声明**；新键（如 `sidebar.workspaces.worktreeDirectoryFlow`）完全合法，且能正常拿到 `renderSlot`（`standardKit` `:613-615` 只检查 `entry.children` 非空）。

代价与对策：
- 官方 picker 插件只会往**官方键** `sidebar.workspaces.directoryFlow` 注册（B2.4 实测原文），不会往我们的新键注册。
- ⇒ 我们的组件要自己渲染目录选择 UI：直接调 `ctx.get('uiWorkspace')?.pickDirectory()`，然后 `ctx.workspaces.create({ path })`。
  **返回类型是 `Promise<string | null>`**（`pick()` 的 wire schema 为 `z.union([z.literal(null), z.string()])`，`dsh-api-workspace-controller/lib/typert.host.js:23`；`null` = 用户取消）。参考插件的客户端包装也是这样归一化的（`REF/src/client.tsx:2072-2073`：`Promise.resolve(c.workspaces.pickDirectory()).then((path: unknown) => (typeof path === 'string' ? path : null))`）。
  ⚠️ 另注意：参考插件调用的是 `c.workspaces.pickDirectory()`，但**客户端 `workspaces` 服务并没有 `pickDirectory` 方法**（`dsh-api-workspace-controller/lib/client.js:296-327` 只有 `create`/`rename`/`delete`/`insertBefore`/`insertSessionBefore`/`archiveSession`；`pickDirectory` 在 `uiWorkspace` 上）。**应调 `ctx.get('uiWorkspace').pickDirectory()`**。
- 若坚持要复用官方 picker 组件，可**同时**声明官方键 —— 但这会与官方注册冲突（B2.2 实测抛错），所以**只能二选一**。

**路线 1（次选）：完全不声明 `children`，只遮蔽。**
- 渲染 winner 是我们的 `-1` ✓
- **`renderSlot` 拿到 `undefined`** ⇒ 无法渲染任何子槽位（包括我们自己声明不了的官方键）
- 官方 `ui-workspace` 的 entry 仍在，child 仍被它声明（实测 "SHADOW-ONLY" 分支）⇒ 官方 picker 仍能注入，但**只有官方组件渲染时才可见** —— 而官方组件已被我们遮蔽，所以**等于失效**。
- ⇒ 路线 1 下「添加工作区」（PRD D19）同样需要自实现 picker。

> **结论：路线 3 与路线 1 在"添加工作区"上殊途同归（都要自实现 picker）。但路线 3 多拿到一个可用的 `renderSlot`，对将来扩展（例如把会话右键菜单等做成子槽位）更友好。推荐路线 3。**
>
> 这与参考插件 `REF` 的实情一致：它既不声明 child，也不声明 `locale`/`store`，因此完全自实现 UI、自实现 picker（`REF/src/client.tsx:2072-2073` → `/dsh-coding-workspace/...` HTTP 路由）。

### B2.4 picker 插件如何注册（供判定路线 2/3 用）

`NODE_MODULES/dsh-client-ui-directory-picker-browse/lib/client.js:1080-1089`：

```js
ctx.slots.inject("conversation.hero.workspace.directoryFlow", () => ctx.slots.inject("sidebar.workspaces.directoryFlow", function* () {
	yield ctx.slots.register({ name: "conversation.hero.workspace.directoryFlow", inject: injected }, BrowseDirectoryFlow);
	yield ctx.slots.register({ name: "sidebar.workspaces.directoryFlow", inject: injected }, BrowseDirectoryFlow);
}));
```

`dsh-client-ui-directory-picker-native/lib/client.js:64-70` 同构。
⇒ picker 用 `slots.inject(<child key>)` 等待声明，**谁声明它就跟谁走**。路线 2 下它们会正常注入到我们的声明。

---

## B3. `renderSlot` 签名

`dsh-client-ui-renderer/lib/client.js:280-297`（`boundRenderSlot`）：

```js
binding = (key, owner, opts) => {
	if (!host.isLive(entry)) throw new StaleAuthorizationError(`renderSlot('${key}') from a disposed registration`);
	const declared = entry.children?.[key];
	if (declared === undefined) throw new SlotOwnershipError(`slot '${key}' is not declared by this entry's children`);
	if (declared.kind === "chain") throw new SlotOwnershipError(`slot '${key}' is declared 'chain' — use renderSlotChain`);
	return jsx(SlotOutlet, { slotKey: key, ownerProps: owner, opts });
};
```

**签名：`renderSlot(key: string, owner?: object, opts?: object): ReactElement`**

- `key` **必须**是本 entry 在 `children` 里声明过的键，否则抛 `SlotOwnershipError`。
- `owner` 是传给被渲染子组件 entry 的 owner props（官方用法见下）。
- 身份稳定（按 entry 缓存在 `WeakMap`），可安全传给 memo 组件。
- **ctx 级 `ctx.slots.renderSlot(key, owner)` 只允许 `'root'`**（`:1177-1182`）：

```js
renderSlot(key, owner) {
	if (key !== "root") throw new Error(`ctx-level renderSlot only renders 'root' (got "${key}"); child slots render through the component props face`);
	...
}
```

官方用法（`dsh-client-ui-workspace/lib/client.js:2325`）：

```js
renderDirectoryFlow: (owner) => renderSlot("sidebar.workspaces.directoryFlow", owner),
```

其中 `owner` 由 `WorkspacePickFlow` `:1071` 提供（`{ t, open, anchorRef, useWorkspaces, createWorkspace, useDirectoryFlow, addOnly, side, selectedId, onPick, onClose }`）。

---

## B4. 客户端 `apply(ctx)` 里能访问哪些服务

### B4.1 答案

| 服务 | 客户端存在？ | 提供者（证据） |
|---|---|---|
| `ctx.slots` | ✅ | `dsh-client-ui-renderer/lib/client.js:995`：`super(ctx, "slots")` |
| `ctx.sessions` | ✅ | `dsh-api-session-controller/lib/client.js:3087`：`rootCtx.reflect.provide("sessions", this, void 0)` |
| `ctx.workspaces` | ✅ | `dsh-api-workspace-controller/lib/client.js:297`：`super(ctx, "workspaces")` |
| `ctx.layout` | ✅ | `dsh-client-ui-layout/lib/client.js:523`：`ctx.reflect.provide("layout", layout)` |
| `ctx.locale` | ✅ | `dsh-client-locale/lib/client.js:1378`：`ctx.provide("locale", locale)` |
| `ctx.uiWorkspace` | ✅（额外发现，**关键**） | `dsh-client-ui-workspace/lib/client.js:38`：`super(ctx, "uiWorkspace")`；提供 `startSession`/`openSession`/`openWorkspace`/`connectWorkspace`/`forkSession`/`archiveSession`/`**pickDirectory**`/`listDirectory`/`createDirectory`（`:44-114`） |
| `ctx.remote` | ✅ | 由 `dsh-api-remotes` 提供（官方 `inject` 里含 `"remote"`、`"remote.directoryPicker"`，见 `:2711-2719`） |
| `ctx.store` / `ctx.conversation` / `ctx.conversationInput` | ⚠️ 未确认 | 参考插件用 `(ctx as any).get('conversation')?.input` 兜底探测（`REF/src/client.tsx`），说明它**不保证**存在 |

### B4.2 参考插件 `src/client.tsx` 顶部写法（逐字）

```tsx
// REF/src/client.tsx:118-135
import type { Context } from '@deepseek-ai/cordis'
import * as Primitives from '@deepseek-ai/dsh-client-ui-primitives'
import { Fragment, jsx, jsxs } from 'react/jsx-runtime'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
...
export const name = 'dsh-coding-workspace'

/** slots + sessions/open/fork/binding + workspaces/startSession/rename/delete/archiveSession + locale(i18n)。 */
export const inject = ['slots', 'sessions', 'workspaces', 'locale']
```

`apply` 里的兜底姿势（`REF/src/client.tsx:2000-2011`）：

```tsx
export function apply(ctx: Context): void {
  injectStyles()
  const c = ctx as any
  // i18n:注册面板字典并 bind t。locale 已进 inject(cordis 对未声明服务的
  // 属性/get 访问一律抛 without inject);服务缺席时 i18n.ts 内部退 zh 兜底。
  installLocale(c.locale)
  // 捕获宿主会话列表快照源
  setLiveSessionsSource(c.sessions?.list ?? null)
  setWorkspaceSource(c.workspaces?.list ?? null)
```

惰性 + try/catch 兜底（`REF/src/client.tsx:2109-2127`）：

```tsx
inject: () => ({
  dshwBridge: {
    scope: (sessionId: string) => (ctx.sessions as any).scope?.(sessionId),
    conversationInput: () => {
      try {
        return (ctx as any).get('conversation')?.input
      } catch {
        return undefined
      }
    },
  },
}),
```

**三条可复用的姿势**：
1. 硬依赖写进 `export const inject = [...]`（Cordis 对未声明服务的属性访问**会抛**——参考插件源码注释明确这一点）。
2. 软依赖用 `(ctx as any).get('name')`，且因 `ctx.get` 也可能抛而在 `try/catch` 内。
3. 拿 observable source 时用 `?.` 判空（`c.sessions?.list ?? null`）。

### B4.3 官方 `inject` 声明（对照）

`dsh-client-ui-workspace/lib/client.js:2711-2719`：

```js
const inject = ["slots", "sessions", "workspaces", "locale", "remote", "remote.directoryPicker", "layout"];
```

且 `:2704-2710` 有重要说明：

> The target slots are declared by the ui-sidebar / ui-conversation applies, whose activation order relative to this one is NOT constrained: `dsh.client.inject` edges are **informational** (loading/prefetch metadata, never apply sequencing) and neither owner provides a waitable service. apply therefore depends on each slot declaration through `slots.inject()` instead of assuming order.

⇒ **必须用 `ctx.slots.inject(key, callback)` 等槽位声明，不能假设其它插件已先 apply。**

### B4.4 ⚠️ entry 是**并发创建**的 —— 一次性 `ctx.get()` 探测服务不可靠（2026-09-23 实测核实）

**证据（宿主真实代码）**

1. `dsh-web-frontend/dist/assets/index-*.js` 的 `runPluginBoot`：

   ```js
   const s = this.manifest.plugins.map((a) => a.id)
   await r                                   // prefetchImmediateTier(): Promise.all(immediately 层)
   await Promise.all(s.map(async (a) => {    // ← 所有 entry **并发** create
     this.page.setState(a, 'loading')
     const c = await i.create({ name: a })
     i.resolve(c).fiber === void 0 && this.page.setState(a, 'failed')
   }))
   await i.await()
   this.assertEntriesActive(t)
   ```

2. `assertEntriesActive` 只遍历 **`loader.entries()`**（roster 里的插件行）；任何 `pending`
   （还在等服务）的 entry 都会被判为启动失败：`web boot: N entries did not activate` ⇒ 整页白屏。
3. `dsh-client-locale/lib/client.js` 的 `const inject = ["slots", "remote", "settingsScope"]`
   —— locale 插件自己的 fiber 要等**三个**服务才 apply；`locale` 服务正是在它的 `apply` 里
   `ctx.provide("locale", locale)` 提供的。

**推论（本插件 2026-09-23 缺陷的根因）**

- 只 `inject = ['slots']` 的插件，其 `apply` **可能早于** locale 插件的 apply 执行；此刻
  `ctx.get('locale')` 是 `undefined`。
- 词典注册若写在这个时机（一次性探测 + 缺席静默跳过），注册就**永久丢失**；而装配期（更晚）
  `host.locale` 已经就位 ⇒ 不抛 `SlotAssemblyError` ⇒ entry 正常渲染，但 seat 绑在**空命名空间**
  上 ⇒ 宿主 `translate` 返回 key 本身 ⇒ 界面满屏裸 key。

**正确姿势：`ctx.inject(deps, cb)`（可选 / 迟到服务）**

- `ctx.inject(['locale'], cb)` 建的是**子 fiber**：`locale` 出现时补跑 `cb`，且**不进
  `loader.entries()`**（loader 条目只由 `loader.create()` 建立）⇒ **不会**把本 entry 拖成
  pending，不会白屏。
- 官方客户端插件同样用它处理可选服务：`dsh-client-connection/lib/client.js` 的
  `ctx.inject(["attachments"], (attachmentCtx) => { … })`。
- 对照：把 `locale` 写进**导出的 `inject` 数组**是 D9 明令禁止的（entry 永久 pending ⇒ 白屏）。

---

## B5. `@deepseek-ai/dsh-client-ui-primitives` 全部导出

### B5.1 权威导出清单

> ⚠️ **下面的清单是 `0.1.5-rc.2` 的快照，现已过期（2026-10-19 核实）。**
> 当前 Desktop 2.0.18 / `@deepseek-ai/*@0.2.1-rc.2` 把**图标导出改成了线重后缀**：
> `Icon<Name>Outline|Fill<Regular|Medium>`（`Regular` = 原始 1px，`Medium` = 1.3px），
> 尺寸改由 `size` prop 控制。**旧的 `Icon*16` / `*14` / `*20` 名字全部消失**（实测导出表里
> 已无任何 `Icon*` + 数字后缀的名字）。
>
> 这条漂移曾让本插件侧栏整块渲染失败：直接取 `P.IconPlusOutline16` 得到 `undefined`，
> `jsx(undefined, {})` 抛 `Element type is invalid`。现在图标一律经 `src/icons.ts` 的解析层
> （新旧命名都认、全缺则回落空图标），见 `INTERFACES.md` §2.3.0 与硬约束第 25 条。
>
> **不要把本清单当作可直接使用的名字表**：新增图标时先查解析层，并跑
> `test/icons.test.mjs` 的漂移哨兵（它直接读已安装宿主 `primitives/lib/index.js` 的导出表）。

`NODE_MODULES/dsh-client-ui-primitives/lib/index.js:7906`（**逐字**）：

```js
export { BrandWordmark, Button, CodeBlock, ConnectionIndicator, DEFAULT_DIFF_MAX_LINES, DEFAULT_READ_MAX_LINES, DEFAULT_SEARCH_MAX_LINES, DEFAULT_TERMINAL_MAX_LINES, DiffBlock, DisclosureRow, FISH_LOGO_PATH, FISH_LOGO_VIEWBOX, FileTypeIcon, FishLogo, HoverCard, IconAgentPresetOutline16, IconAlarmClockOutline16, IconApiOutline14, IconArchiveOutline20, IconBranchOutline16, IconBrowseOutline16, IconCheckOutline14, IconCheckOutline16, IconChecklistOutline14, IconChevronDownOutline14, IconChevronLeftOutline14, IconChevronRightOutline14, IconChevronUpOutline14, IconClockOutline16, IconCloseFill14, IconCloseOutline16, IconCodeOutline16, IconContextInjectionOutline16, IconCopyOutline16, IconCordisPluginOutline14, IconDarkOutline16, IconDataOutline16, IconDatabaseOutline16, IconDislikeFill16, IconDislikeOutline16, IconDownloadOutline16, IconEditOutline16, IconEllipsisOutline16, IconEnhanceOutline16, IconFolderClose16, IconFolderOpen16, IconFolderOpenOutline16, IconFollowsystemOutline16, IconFullscreenOutline16, IconGaugeOutline16, IconGlobeOutline14, IconGoalOutline16, IconInspectOutline12, IconLightOutline16, IconLikeFill16, IconLikeOutline16, IconLinkOutline14, IconLinkOutline16, IconListPenOutline16, IconLoadingOutline16, IconNewChatOutline16, IconPanelLeftOutline16, IconPaperclipOutline16, IconPauseOutline16, IconPersonalizationOutline16, IconPlayOutline16, IconPlusOutline16, IconProjectAddOutline16, IconQuestionOutline14, IconQueueOutline14, IconRefreshOutline14, IconRefreshOutline16, IconRightUpOutline14, IconRightUpOutline16, IconSearchOutline16, IconSendOutline14, IconSendOutline16, IconSettingsOutline14, IconSettingsOutline16, IconShareOutline16, IconSkillOutline16, IconSparkle16, IconStopFill16, IconThinkOutline14, IconThinkOutline16, IconTrashOutline16, IconTreeCorner8x10, IconTriangleRightFill14, IconUserOutline16, IconWarningOutline16, Input, JsonBlock, JsonTree, LinkIcon, MarkdownText, Menu, Modal, OnboardingSurface, Pill, ReadBlock, ReferenceIcon, RiskConfirmation, SearchBlock, StateDot, Switch, Tag, TerminalBlock, Toast, Tooltip, WebBlock, classifyFileType, classifyLinkPath, diffTotals, extractMarkdownPlainText, fileExtension, fileSizeText, projectUserText, rankByName, relativeTime, useAnchoredMaxHeight, useAnchoredPosition, useDismissOnOutsidePointer, writeClipboard };
```

**交互组件（非 Icon）**：`Button`、`ConnectionIndicator`、`DisclosureRow`、`FileTypeIcon`（图标容器）、`HoverCard`、`Input`、`Menu`、`Modal`、`OnboardingSurface`、`Pill`、`RiskConfirmation`、`Switch`、`Tag`、`Toast`、`Tooltip`。
**内容块**：`CodeBlock`、`DiffBlock`、`JsonBlock`、`JsonTree`、`MarkdownText`、`ReadBlock`、`SearchBlock`、`TerminalBlock`、`WebBlock`。
**品牌/图形**：`BrandWordmark`、`FishLogo`、`LinkIcon`、`ReferenceIcon`、`FISH_LOGO_PATH`、`FISH_LOGO_VIEWBOX`、`IconTreeCorner8x10`。
**工具函数**：`classifyFileType`、`classifyLinkPath`、`diffTotals`、`extractMarkdownPlainText`、`fileExtension`、`fileSizeText`、`projectUserText`、`rankByName`、`relativeTime`、`writeClipboard`。
**hooks**：`useAnchoredMaxHeight`、`useAnchoredPosition`、`useDismissOnOutsidePointer`。

### B5.2 常用组件 props 签名（源码逐字）

**`Button`** — `lib/index.js:1565`：

```js
function Button({ variant = "ghost", size = "md", icon, className, children, ...rest }) {
	return jsxs("button", {
		type: "button",
		className: clsx(css$2.button, css$2[variant], css$2[size], className),
		...rest,
		children: [icon != null && jsx("span", { className: css$2.icon, children: icon }), children]
	});
}
```

JSDoc（`:1556-1564`）：`variant` = 视觉族（默认 `'ghost'`）；`size` = `'md'` 36px 胶囊 / `'sm'` 28px 紧凑；`icon` = 可选 16px 前置图标节点；native button 属性透传。

**`Menu`** — `lib/index.js:1741`：

```js
function Menu({ open, anchor, items, selectedId, selectedIds, onSelect, onClose, align = "start", side = "bottom", portal = false, closeOnPointerLeave = false, dense = false, compact = false, autoFocus = false, selection = "check", getAnchorRect, footer, className }) {
```

JSDoc（`:1703-1740`，节选）：
- `autoFocus` — 打开时聚焦首项并启用方向键；Escape 聚焦 anchor 的第一个 button
- `anchor` — 触发元素（就地渲染）
- `items` — 可选行 + 可选分隔符
- `onSelect(id)` — 行点击回调（disabled 行与仅展开子菜单的父项不触发）
- `portal` — 渲染进 `document.body`、固定定位；祖先 `overflow` 裁切时用
- `getAnchorRect` — 仅 portal 模式；从宿主自有触发按钮提供 rect（**render-prop anchor / 效果定位代理处测量会与宿主 layout effect 竞争**）
- `selection` — `'check'`（默认，尾部勾）或 `'fill'`（无勾，保持 hover 填充）

> **2026-11-25 宿主演进核实（DSH `0.2.2-rc.5` / `v0.2.2-alpha.2` `css-anchored-menus`）**：`@deepseek-ai/dsh-client-ui-primitives` 移除了 `useAnchoredPosition` 与 `Menu.getAnchorRect`，改为 CSS Anchor Positioning（`anchorRef` 指向触发元素 ref，或 `anchorPoint: { x, y }` 用于按客户端视口坐标打开 portal 菜单，配合 `anchor={null}`）。`Menu` 新旧版本均为具名解构（不向 DOM 透传未知 prop），本插件 `MenuLayer` 同时传 `anchorPoint` 与 `getAnchorRect` 以兼容新旧宿主。详见 [2026-11-25 工作记录](worklog/2026-11-25-menu-anchor-point-fix.md)。

**`items` 条目形状**（从 `isSeparator`/`isLabel` + 渲染逻辑 `:1830-1900` 反推）：

```ts
type MenuEntry =
  | { type: 'separator' }
  | { type: 'label'; id: string; label: ReactNode }
  | {
      id: string
      label: ReactNode
      icon?: ReactNode
      disabled?: boolean
      submenu?: MenuEntry[]
    }
```

依据 `:1691-1696`：

```js
function isSeparator(entry) { return "type" in entry && entry.type === "separator"; }
function isLabel(entry) { return "type" in entry && entry.type === "label"; }
```

以及 `:1854-1880` 使用 `entry.id` / `entry.label` / `entry.icon` / `entry.disabled` / `entry.submenu`。
`onSelect` 收到的是 `entry.id`。

**`Modal`** — `lib/index.js:2315`：

```js
function Modal({ open, onClose, title, closeLabel, description, children, footer, className, contentClassName, headless = false }) {
```

- 自带 Escape 关闭（`:2316-2323`）与 mask 点击关闭
- `createPortal(..., document.body)`
- `closeLabel` 是关闭按钮的 `aria-label`；`headless` 时只渲染 `children`，不带 header/body/footer 外壳

**`Input`** — `lib/index.js:1648`：

```js
function Input({ icon, className, ...rest }) {
	return jsxs("span", { className: clsx(css$6.wrap, className),
		children: [icon != null && jsx("span", { className: css$6.icon, children: icon }),
		           jsx("input", { className: css$6.input, ...rest })] });
}
```

native input 属性透传。**注意它外面包了一层 `<span>`**，宽高由 CSS 决定。

**`Tooltip`** — `lib/index.js:3666`：`function Tooltip({ label, side = "right", delayMs = 0, disabled = false, maxWidth, children })`

**`Tag`** — `lib/index.js:1606`：`function Tag({ tone = "outline", className, children })`（只读，`data-tone` 驱动配色）

**`Pill`** — `lib/index.js:1584`：`function Pill({ active = false, className, children, onClick, ...rest })` —— 给 `onClick` 时渲染成 `<button>`，否则 `<span>`。

**`StateDot`** — `lib/index.js:69`：`function StateDot({ state, size = 10, className })` —— 状态点；官方侧栏用它渲染三态（`dsh-client-ui-workspace/lib/client.js:832`：`jsx(StateDot, { state: statuses[0].state })`，`statuses` 形如 `{ state, label }`）。

### B5.3 `<style>` 注入

primitives **不含 footer/style 注入器**；类样式由各组件模块 CSS 提供。参考插件自己注入全局样式（`REF/src/client.tsx:14-117` 的 `injectStyles()`），并且**用官方 CSS 变量**（如 `--dsw-alias-interactive-bg-hover`、`--dsw-alias-border-l2`、`--dsw-alias-brand-primary`、`--dsw-alias-label-primary`、`--dsw-alias-label-dimmed`）—— 这是保持主题一致的正确做法，建议照搬这套变量名。

---

## B6. client bundle 形态

### B6.1 官方产物 banner/footer（逐字）

`NODE_MODULES/dsh-client-ui-workspace/lib/client.js:1-6`：

```js
window.__ModuleLoader__.load({
	id: "@deepseek-ai/dsh-client-ui-workspace",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
```

尾部 `:2815-2819`：

```js
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
```

### B6.2 参考插件 `scripts/build-client.mjs`（逐字，22 行）

```js
// 客户端半区构建:把 src/client.ts 打成 dsh client-modules 的工厂形态。
// 产物 lib/client.js = window.__ModuleLoader__.load({id, factory:(require,module,exports)=>{...}});
// id 必须等于包名(boot graph 的 entry name == package name)。
import { build } from 'esbuild'

const pkg = 'dsh-coding-workspace'

await build({
  entryPoints: ['src/client.tsx'],
  bundle: true,
  format: 'cjs',
  target: 'es2023',
  outfile: 'lib/client.js',
  external: ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives'],
  banner: {
    // 宿主只传 require;module/exports 由 bundle 自造,尾部 return module.exports(对齐 ui-workspace 产物形态)
    js: `window.__ModuleLoader__.load({id:${JSON.stringify(pkg)},factory:(require)=>{var module={exports:{}};var exports=module.exports;Object.defineProperty(exports,Symbol.toStringTag,{value:"Module"});`,
  },
  footer: {
    js: ';return module.exports;}});',
  },
})
```

**ID 语义确认**：`dsh-client-modules/lib/client.js:230` `register()` 用 `stripClientSuffix(registration.id)`，而 `manifest` 行的 `id` 就是包名（`dsh-client-modules/lib/index.js:331`：`id` 来自包名）。⇒ **banner 的 `id` 必须等于 `package.json` 的 `name`**。

### B6.3 `package.json` 的 `dsh.client` 字段

**Schema 校验**（`dsh-client-modules/lib/index.js:139-152`）：

```js
function parseDshClient(pkgName, value) {
	if (typeof value !== "object" || value === null) throw new Error(`client-modules: ${pkgName} has a non-object dsh.client declaration`);
	if (typeof decl.platform !== "string") throw new Error(`client-modules: ${pkgName} dsh.client.platform must be a string`);
	const inject = optionalStringArray(pkgName, "dsh.client.inject", decl.inject);
	const external = optionalStringArray(pkgName, "dsh.client.external", decl.external);
	if (decl.immediately !== void 0 && typeof decl.immediately !== "boolean") throw new Error(`client-modules: ${pkgName} dsh.client.immediately must be a boolean`);
	return { platform: decl.platform, ...inject !== void 0 ? { inject } : {}, ...external !== void 0 ? { external } : {}, ...decl.immediately !== void 0 ? { immediately: decl.immediately } : {} };
}
```

**扫描条件**（`dsh-client-modules/lib/index.js:649-655`）：

```js
const decl = parseDshClient(packageName, dsh !== null && typeof dsh === "object" ? dsh.client : void 0);
if (decl === void 0 || decl.platform !== "web") { this.pkgMeta.set(sourceKey, null); return null; }
const clientRel = clientExportOf(packageName, pkg.exports);
if (clientRel === void 0) throw new Error(`client-modules: ${packageName} declares dsh.client but exports no "./client" bundle`);
```

⇒ **`platform: "web"` 必需；`exports["./client"]` 必需，否则加载期抛错。**

`external` 语义（`dsh-client-modules/lib/index.js:339-348`）：

> An `external` specifier is either the package row it names (`<pkg>/client` aliases the bare package) or a **static-table name that adds no graph edge**.

并拒绝自引用（`:362`）：

```js
if (dependency === entry) throw new Error(`client-modules: "${entry.id}" requests module "${name}" that it answers itself — a row must not declare its own package in dsh.client.external`);
```

### B6.4 ⚠️ `external` 必须与静态种子表白名单一致

**浏览器端 static seed 白名单**（`APP/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-BKQ_L1z6.js`，函数 `by()`）：

```js
function by(){return{
	react: ec,
	"react/jsx-runtime": ic,
	"react-dom": cc,
	"react-dom/client": fc,
	"@deepseek-ai/cordis": Ha,
	"@deepseek-ai/dsh-client-store": Hc,
	"@deepseek-ai/dsh-client-ui-slots": Ac,
	"@deepseek-ai/dsh-client-ui-primitives": Zg,
	"@deepseek-ai/dsh-client-ui-dockkit": Ey
}}
```

运行时 `require` 未命中种子就抛（`dsh-client-modules/lib/client.js:308`）：

```js
throw new Error(`client-modules: require("${spec}") missed the module table — not a platform seed word, not a materialized module, and no registered package factory (a build-time externals drift, or a dynamic dependency that did not arrive)`);
```

⇒ **bundle 的 esbuild `external` 列表必须 ⊆ 上述白名单**（`external` 里的每个 specifier 都会被 `require(spec)` 调用）。
参考插件用 `['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives']` —— 三个都在白名单 ✓。
PRD 第 8 节的 `external: react, react/jsx-runtime, @deepseek-ai/dsh-client-ui-primitives` —— **正确**。
若想用 `@deepseek-ai/dsh-client-store`（自己管理展开态 store）也在白名单内；`@deepseek-ai/dsh-client-ui-dockkit` 虽在种子表里，但**该包未随 2.0.10 一起发布**（`NODE_MODULES/dsh-client-ui-dockkit` 不存在，实测 `ls` 报 No such file）—— **不要用**。

### B6.5 `immediately` 与 `inject` 的实际作用

- `immediately: true` ⇒ 预取层（`dsh-web-frontend` 里 `prefetchImmediateTier()` 过滤 `t.immediately`），**与 apply 顺序无关**。
- `dsh.client.inject` 是 **informational**（`dsh-client-ui-workspace/lib/client.js:2704-2710` 明确说明：loading/prefetch metadata，**never apply sequencing**）。真正的时序靠 `ctx.slots.inject()`。

### B6.6 `dsh.bundle.patch` 必需

`dsh-app-boot/lib/index.js`（`loadProfileDirectory`）：

```js
const declared = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")).dsh?.bundle?.patch;
if (declared === undefined) throw new Error(`${binName}: profile bundle ${JSON.stringify(packageName)} declares no dsh.bundle in its package.json`);
```

⇒ 作为 profile bundle 被解析时，**`dsh.bundle.patch` 不可缺**，否则加载期抛错。

---

# C. 依赖解析与安装

## C13. 本机 link 插件的依赖姿态（**实测**）

### C13.1 提问指定的两条命令的**实际输出**

```console
$ ls /Users/dev/Documents/Project/AnyWork/dsh-askhuman/node_modules/@deepseek-ai
cordis
dsh-system-prompt
dsh-tools
schemastery

$ ls -la /Users/dev/.dsh/profiles/web/node_modules/@dsh-external/dsh-askhuman
lrwxr-xr-x  1 dev  staff  51 Aug 19 16:00 /Users/dev/.dsh/profiles/web/node_modules/@dsh-external/dsh-askhuman -> /Users/dev/Documents/Project/AnyWork/dsh-askhuman
```

### C13.2 是「真实安装」还是「靠 profile 向上查找」？—— **两者都不是，是第三条路**

`dsh-askhuman/node_modules/@deepseek-ai/*` 全是**指向 npx 缓存**的符号链接（**不是**它自己 `pnpm install` 出来的）：

```console
$ ls -la /Users/dev/Documents/Project/AnyWork/dsh-askhuman/node_modules/@deepseek-ai/
cordis            -> /Users/dev/.npm/_npx/2ede61d9d1d3d32e/node_modules/@deepseek-ai/cordis
dsh-system-prompt -> /Users/dev/.npm/_npx/2ede61d9d1d3d32e/node_modules/@deepseek-ai/dsh-system-prompt
dsh-tools         -> /Users/dev/.npm/_npx/2ede61d9d1d3d32e/node_modules/@deepseek-ai/dsh-tools
schemastery       -> /Users/dev/.npm/_npx/2ede61d9d1d3d32e/node_modules/@deepseek-ai/schemastery
```

这些链接由 `dsh-askhuman/scripts/build.sh` **在构建期**手工创建（`build.sh` 的 `RUNTIME_ROOT="${DSH_RUNTIME_ROOT:-/Users/dev/.npm/_npx/2ede61d9d1d3d32e}"` 分支），**仅供 tsc 解析类型**。

**版本不一致的证据**（说明它不是运行时来源）：

| 包 | askhuman/node_modules（= npx 缓存） | APP（运行时真实） |
|---|---|---|
| `@deepseek-ai/cordis` | **4.0.1** | **4.0.2** |
| `@deepseek-ai/dsh-tools` | **0.1.0-rc.7** | **0.1.5-rc.2** |

```console
$ node -e "console.log(require('/Applications/DSH Desktop.app/.../cordis/package.json').version)"
4.0.2
$ node -e "console.log(require('/Users/dev/.npm/_npx/.../cordis/package.json').version)"
4.0.1
```

**运行时实际用的是哪个？** 实测从插件入口解析：

```console
$ node run5.mjs
entry (loader-anchored) -> file:///Users/dev/Documents/Project/AnyWork/dsh-askhuman/lib/index.js
  imported OK, exports: Config,apply,inject,name,parseTextResult
  cordis instance of dsh-tools dep: file:///Applications/DSH%20Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai/dsh-tools/lib/index.js
```

⇒ **运行时解析到 APP 的 0.1.5-rc.2**，npx 缓存那份**没有被用到**。

### C13.3 解析机制（第三条路的核心）

`dsh-askhuman/package.json` 的正确姿势是：

```json
"peerDependencies": {
  "@deepseek-ai/cordis": ">=4.0.0 <5",
  "@deepseek-ai/dsh-system-prompt": ">=0.0.1-rc <2",
  "@deepseek-ai/dsh-tools": ">=0.0.1-rc <2",
  "@deepseek-ai/schemastery": "^3.18.0"
}
```

真正让 `@deepseek-ai/dsh-tools` 在运行时解析成功的是 **`APP/lib/module-resolution-C8mVg9xZ.js` 装的 `registerHooks` ESM 解析钩子** —— 见 C14。

---

## C14. 新插件 `import '@deepseek-ai/dsh-home-paths'` 能否正确解析？**能，但只在正确的解析链上**

### C14.1 `pnpm link:` 的目录事实（实测）

```console
$ ls /Users/dev/.dsh/profiles/web/node_modules/@deepseek-ai/
（空目录 —— profile 自己的 scope 目录里一个包都没有）
$ ls /Users/dev/.dsh/profiles/node_modules/@deepseek-ai/ | wc -l
     258
$ ls -la /Users/dev/.dsh/profiles/node_modules/@deepseek-ai/dsh-home-paths
lrwxr-xr-x ... -> /Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai/dsh-home-paths
```

⇒ **`$DSH_HOME/profiles/node_modules` 才是安装闭包**（`dsh-app-boot/lib/index.js:646-673` 的 `healProfilesModuleFallback` 维护）。

### C14.2 ⚠️ 关键陷阱：**Node 的普通上溯对 link 插件无效**

插件真实路径在 `~/Documents/Project/...`，其祖先链上**没有任何** `node_modules` 提供 `@deepseek-ai/*`：

```console
$ for d in .../dsh-worktree-groups .../AnyWork .../Project ~ /; do [ -d "$d/node_modules" ] && echo "HAS $d" || echo "none $d"; done
none .../dsh-worktree-groups/node_modules
none .../AnyWork/node_modules
none .../Project/node_modules
（家目录与 / 也无）
```

**实测**（`/tmp` 复刻，插件无 node_modules、无 resolver）：

```
=== plain Node ===
entry -> file:///tmp/simhome/profiles/web/node_modules/@dsh-external/dsh-worktree-groups/lib/index.js
    hp        => ERR_MODULE_NOT_FOUND
    tools     => ERR_MODULE_NOT_FOUND
    persist   => ERR_MODULE_NOT_FOUND
    ws        => ERR_MODULE_NOT_FOUND
    cordis    => ERR_MODULE_NOT_FOUND
```

**加 resolver 后**：

```
=== WITH resolver ===
entry -> file:///private/tmp/anywork/dsh-worktree-groups/lib/index.js
    hp        => OK(9 exports)
    tools     => OK(23 exports)
    persist   => OK(18 exports)
    ws        => OK(10 exports)
    cordis    => OK(26 exports)
```

### C14.3 解析算法（`APP/lib/module-resolution-C8mVg9xZ.js`）

三个锚点，按序回退（`resolveForRegistration` `:296-318`）：

```js
try {
	const resolved = nextResolve(specifier, context);
	if (parentSource === "install" || !isObsoleteProfileFallbackUrl(registration, resolved.url) || parentSource === "profile" && canUseProfileSharedDependencyUrl(registration, parentURL, resolved.url)) {
		track(registration, resolved.url, parentSource);
		return resolved;                       // ← 1) 普通 Node 解析（插件自带 node_modules 会命中）
	}
} catch (cause) { if (!isMissingModule(cause)) throw cause; }
try {
	const resolved = resolveFromAnchor(state, registration, specifier, "profile", context, nextResolve);
	if (!isObsoleteProfileFallbackUrl(registration, resolved.url) || parentSource === "profile" && canUseProfileSharedDependencyUrl(registration, parentURL, resolved.url)) {
		track(registration, resolved.url, "profile");
		return resolved;                       // ← 2) profile 锚点（$DSH_HOME/profiles/web/package.json）
	}
} catch (cause) { if (!isMissingModule(cause)) throw cause; }
const resolved = resolveFromAnchor(state, registration, specifier, "install", context, nextResolve);
track(registration, resolved.url, "install");
return resolved;                             // ← 3) 安装锚点（APP/package.json）
```

其中 profile 锚点的 `createRequire` 解析路径会走到 `$DSH_HOME/profiles/node_modules`（`sharedFallbackDirectory`，`:405-406`）：

```js
sharedFallbackDirectory: join(dirname(profileDirectory), "node_modules"),
```

**实测 profile 锚点直接解析成功**：

```console
$ node -e "createRequire('/Users/dev/.dsh/profiles/web/package.json').resolve('@deepseek-ai/dsh-home-paths')"
/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai/dsh-home-paths/lib/index.js
$ ... resolve('@deepseek-ai/dsh-workspace')      → .../dsh-workspace/lib/index.js
$ ... resolve('@deepseek-ai/dsh-session-persistence') → .../dsh-session-persistence/lib/index.js
$ ... resolve('@deepseek-ai/dsh-client-ui-primitives') → .../dsh-client-ui-primitives/lib/index.js
```

### C14.4 ⚠️ 第二个陷阱：插件自带 `node_modules` 会**优先**命中

实测（在插件自己的 `node_modules/@deepseek-ai/dsh-home-paths` 放一份带 marker 的副本）：

```
entry -> file:///private/tmp/shadow/plugin/lib/index.js
dsh-home-paths resolved FROM the plugin: LOCAL-COPY-IN-PLUGIN-NODE_MODULES
   url: file:///private/tmp/shadow/localhome/lib/index.js
```

**风险**：`@deepseek-ai/cordis` 是**有状态**的（Service/Context/reflect 全是实例身份）。如果插件自带一份 cordis 副本并在运行时被解析到，**Cordis 服务注册会失效**（两个不同的 `Service` 基类）。

**当前 `TARGET` 的实际风险 = 低**（已核实）：

```console
$ grep -rhn "^import" lib/*.js | sed 's/.*from //' | sort -u
'./git.js';
'node:child_process';
'node:fs/promises';
'node:os';
'node:path';
$ grep -n "from '@deepseek-ai/cordis'" src/*.ts
src/index.ts:1:import type { Context } from '@deepseek-ai/cordis'   ← type-only，编译后消失
```

⇒ `TARGET` 的 `lib/` **没有任何 `@deepseek-ai/*` 运行时 import**，自带 `node_modules/@deepseek-ai/cordis` 不会被命中。**但一旦实现里出现 `import { Service } from '@deepseek-ai/cordis'` 之类运行时导入，就会踩雷。**

### C14.5 可执行的确切方案（**推荐**）

**方案 A（推荐，与官方包姿态一致）：`@deepseek-ai/*` 全部走 `peerDependencies` + 从安装闭包解析。**

```jsonc
// package.json
{
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.2",
    "@deepseek-ai/dsh-home-paths": "^0.1.5-rc.2"
  },
  "dependencies": {},                      // 不含任何 @deepseek-ai/*
  "devDependencies": {
    // 仅供 tsc/esbuild 类型与打包解析，见方案细节
  }
}
```

要点：
1. **`@deepseek-ai/dsh-home-paths` 写进 `peerDependencies`**（不改动 `~/.dsh`，安装闭包已有它：`$DSH_HOME/profiles/node_modules/@deepseek-ai/dsh-home-paths → APP/...`，实测存在）。
2. **不放进 `dependencies`** —— 否则 `pnpm install` 会试图从 npm registry 装一份**副本**进插件自己的 `node_modules`，触发 C14.4 的实例分裂（对 `cordis` 尤其致命）。且实测参考项目已因此踩坑：`REF/package.json` 写 `"@deepseek-ai/dsh-home-paths": "0.0.1-rc.3"` 在 `dependencies`，而 `REF/node_modules/@deepseek-ai` **根本不存在**（`ls` 报 No such file），说明其安装并未真正落地。
3. **`pnpm-workspace.yaml` 已设 `autoInstallPeers: false`**（`PROFILE/pnpm-workspace.yaml`），所以 peer 声明**不会**被自动安装 ⇒ 正好。
4. **构建期类型解析**：`devDependencies` 里放本地副本或用 `@types`。`TARGET` 现有做法是 `devDependencies` 含 `@deepseek-ai/cordis`，配合 `tsconfig` 的 `"skipLibCheck": true`。这会让 `node_modules/@deepseek-ai/cordis` 存在（实测存在、v4.0.2 与 APP 同版本），但**只要代码里不出现 cordis 的运行时 import** 就无害。

**方案 B（若必须 import 且 peer 不可靠）：把解析指向 APP 安装目录。**
在构建脚本里把 `node_modules/@deepseek-ai/*` 做成指向 **APP**（而非 npx 缓存）的符号链接。`dsh-askhuman/scripts/build.sh` 已经是这个模式（只是它指向 npx：`RUNTIME_ROOT="${DSH_RUNTIME_ROOT:-/Users/dev/.npm/_npx/2ede61d9d1d3d32e}"`）。

```bash
# 建议改进：把 RUNTIME_ROOT 指向 APP 而非 npx，版本才能与运行时一致
RUNTIME_ROOT="${DSH_RUNTIME_ROOT:-/Applications/DSH Desktop.app/Contents/Resources/app}"
for pkg in cordis dsh-home-paths; do
  link_pkg "@deepseek-ai/$pkg" "node_modules/@deepseek-ai/$pkg" "$RUNTIME_ROOT/node_modules/@deepseek-ai/$pkg"
done
```

> 注意：方案 B 仍然只是**构建期**收益；运行时解析由 DSH resolver 接管，插件自带副本会**遮蔽** APP 副本（实测 C14.4）。因此方案 B 对 `cordis` 仍有实例分裂风险。**结论：`@deepseek-ai/cordis` 永不放进插件自带 `node_modules`，或只做 type-only import。**

---

## C15. web profile 新增一个 bundle 的**确切步骤**

### C15.1 改哪个文件的哪个字段

**文件**：`/Users/dev/.dsh/profiles/web/package.json` —— **两个字段都要改**：

当前内容（实测）：

```json
{
  "name": "dsh-profile-web",
  "private": true,
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dshmarket",
        "@linxin666/dsh-web-all",
        "@dsh-external/dsh-client-ui-skin-maid-atelier",
        "@dsh-external/dsh-askhuman",
        "@dsh-external/dsh-apps-studio-quota",
        "hooks-adapter",
        "dsh-ssh-workspace"
      ]
    }
  },
  "dependencies": {
    "@dsh-external/dsh-askhuman": "link:/Users/dev/Documents/Project/AnyWork/dsh-askhuman",
    ...
  }
}
```

需加：
1. `dsh.profile.bundles` 追加 `"dsh-worktree-groups"`（或 `"@dsh-external/dsh-worktree-groups"` —— **必须与 `dependencies` 的键一致**，见 C15.2 解析规则）。
2. `dependencies` 追加 `"dsh-worktree-groups": "link:/Users/dev/Documents/Project/AnyWork/dsh-worktree-groups"`。

> **包名策略建议**：观察现有惯例，link 插件统一用 `@dsh-external/<name>`（`dsh-askhuman`、`dsh-apps-studio-quota`、`dsh-client-ui-skin-maid-atelier`）。但 `TARGET/package.json` 当前 `name` 是裸 `dsh-worktree-groups`，`cordis.patch.yml` 也用裸名。两种都能工作，**保持一致即可**。⚠️ **不要**用包名 `dsh-client-ui-workspace` 之类的官方名 —— `asar-module-resolver-state` 会做包身份校验（实测报错原文：`dsh-plugin-desktop: profile package identity is invalid for <name>`）。

### C15.2 `cordis.patch.yml` 里 entry 怎么写

插件自己的 patch（`TARGET/cordis.patch.yml`，已存在）：

```yaml
- insert:
    - id: dsh-worktree-groups
      name: dsh-worktree-groups
```

**关键规则**：profile 的 **bundle 列表顺序 = patch 应用顺序**（`dsh-app-boot/lib/index.js:296-299`）：

> the tree is composed by applying each bundle's patch list in `dsh.profile.bundles` order over an empty entry list, then the profile's own patches, then any launcher layers.

而 `id` 是 **patch 定位键**（同一 `id` 可被后续 layer 覆盖/禁用）。所以：
- 若是新 entry，`- insert: [{ id, name }]` 即可。
- **`name` 必须是能被 profile 锚点解析到的模块 specifier** —— 也就是 `dependencies` 里那个键（`resolveBundleDir` 用 `packageDirFromAnchor(anchor, packageName)`，从 `installAnchor` 和 `profileDir` 两个锚点找目录）：

```js
function resolveBundleDir(binName, packageName, installAnchor, profileDir) {
	for (const anchor of [installAnchor, join(profileDir, "package.json")]) {
		const dir = packageDirFromAnchor(anchor, packageName);
		if (dir !== undefined) return dir;
	}
	throw new Error(`${binName}: cannot resolve profile bundle ${JSON.stringify(packageName)} from the dsh installation or ${profileDir}; run 'dsh plugin --profile ${basename(profileDir)} install' if its dependency is not installed`);
}
```

### C15.3 要不要重跑 `pnpm install`？

**要**（生成/刷新 `node_modules/@dsh-external/<name>` 符号链接与 `pnpm-lock.yaml`）。

替代：官方的 `dsh plugin --profile web add <包名|tgz>` 会**自动**把包登记进 `dsh.profile.bundles`（`REF/cordis.patch.yml:2` 注释明确："安装：`dsh plugin --profile web add <tgz>`（add 会自动把本包登记进 `dsh.profile.bundles`）"）。

Dependencies 也可以手工建符号链接（`ln -s`），效果等同 `link:` —— `PROFILE/node_modules/@dsh-external/dsh-askhuman` 就是这样一条普通符号链接。

### C15.4 是否必须重启 DSH Desktop？

**宿主半边：是（新增 entry）。客户端半边：否（刷新页面即可）。**

证据 —— `dsh-app-boot/lib/index.js:311-360` 的 profile patch 生命周期：

```js
const PROFILE_PATCH_TEMPLATE = `# Your patch layer for this dsh profile, applied after every bundle layer: ...`;
...
const PROFILE_TEMPLATES = {
	acp:      { bundles: [...], patchReload: "startup" },
	web:      { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"], patchReload: "live" },
	headless: { bundles: [...], patchReload: "startup" },
	sdk:      { bundles: [...], patchReload: "startup" },
	"sdk-minimal": { ... }
};
```

`web` 的 `patchReload: "live"` ⇒ **profile 自己的 `cordis.patch.yml` 是热重载的**（"user patch file lifecycle; hot-reloaded on long-lived surfaces"）。但：

- **`dsh.profile.bundles` 的变更属于 profile 装载**（`loadProfileDirectory`），**不是** patch 文件热重载范畴 ⇒ 加一个新 bundle **需要重启**。
- 若只是往**已装载** bundle 的 patch 里改 entry 配置，则 `live` 生效。

**本机实际状态印证**：`PROFILE/cordis.patch.yml` 对 `dsh-coding-workspace` 等 5 个 entry 写了 `disabled: true`（说明这些 bundle 仍在某个 bundle 列表里/曾装载），且该文件带 `dsh.patchReload` 语义的 live 注释头。

**结论/建议**：
1. 首次接入：改 `PROFILE/package.json` 的两处 + 跑 `pnpm install`（或 `dsh plugin --profile web add`）⇒ **必须重启 DSH Desktop**。**重启会终结当前会话**（PRD R1 已识别）。
2. 之后迭代**宿主半边 JS 代码**：因 `@deepseek-ai/*` 是 ESM `import`，Node ESM 模块缓存不会热更新 ⇒ 仍需重启。**（参考项目 `REF/cordis.patch.yml` 用拆 4 个 entry 的方式做代码热迭代，本插件应假定宿主改动需重启。）**
3. 之后迭代**客户端半边**：改 `lib/client.js` + **刷新浏览器页面**即可（`dsh-client-hmr` 存在，但仅在 `pnpm run dev:web` 时自动重载）。

---

# D. 结论性判断

## D16. 最小可行依赖清单与构建脚本清单

### D16.1 依赖清单

```jsonc
// package.json 关键字段（对齐 C14.5 方案 A + 官方包姿态）
{
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.2",
    "@deepseek-ai/dsh-home-paths": "^0.1.5-rc.2"
  },
  "dependencies": {},
  "devDependencies": {
    "@deepseek-ai/cordis": "^4.0.2",     // 仅供 tsc 解析 type-only import；不产生运行时引用
    "@types/node": "^26.4.0",
    "@types/react": "~18.3.1",
    "esbuild": "^0.28.2",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "typescript": "^5.5.0"
  }
}
```

逐项理由：

| 包 | 位置 | 理由 |
|---|---|---|
| `@deepseek-ai/cordis` | `peerDependencies` + `devDependencies` | 宿主提供；**运行时实例身份必须唯一**（C14.4）。当前 `TARGET` 已如此 |
| `@deepseek-ai/dsh-home-paths` | **`peerDependencies`** | 只做 `dshHomePath()` 之类的纯函数调用；安装闭包已有（C14.5）。`TARGET` 现在**未声明**，需补 |
| `@deepseek-ai/dsh-client-ui-primitives` | **不装** | 只出现在 client bundle 的 esbuild `external` + `dsh.client.external`，由浏览器种子表提供（B6.4） |
| `react` / `react-dom` / `@types/react` | `devDependencies` | esbuild 打包时 `react`/`react/jsx-runtime` 走 `external`，构建期只需类型与 jsx runtime 解析 |
| `esbuild` / `typescript` / `@types/node` | `devDependencies` | 构建工具 |

> ⚠️ 与当前 `TARGET/package.json` 的**差异**：它现在 `peerDependencies` 只有 `cordis`，`dependencies` 为空 ⇒ **`@deepseek-ai/dsh-home-paths` 未声明**。功能上仍能解析（C14.3 第 2 锚点），但**语义上应补 `peerDependencies`**，否则 bundler/`pnpm install` 的依赖图不完整。
>
> ⚠️ **绝不**把 `@deepseek-ai/*` 放进 `dependencies`（`REF/package.json` 的反例：`"@deepseek-ai/dsh-home-paths": "0.0.1-rc.3"` 在 dependencies，而 `REF/node_modules/@deepseek-ai` 不存在 —— 声明没落地，属死配置）。

### D16.2 `dsh.client` 与 `dsh.bundle`（已正确，保持）

```jsonc
{
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "inject": [],
      "immediately": true,
      "external": ["react", "react/jsx-runtime", "@deepseek-ai/dsh-client-ui-primitives"]
    }
  }
}
```

`inject: []` 的正确性：`dsh.client.inject` **不是** apply 时序保证（B6.5），而本插件的客户端依赖（`slots`/`sessions`/`workspaces`/`locale`/`uiWorkspace`）**不提供可等待服务**，应全部走 `export const inject = [...]`（cordis fiber inject）+ `ctx.slots.inject()`。留空是诚实且无害的。

### D16.3 构建脚本清单

```jsonc
"scripts": {
  "build": "tsc -p tsconfig.json && node scripts/build-client.mjs",
  "typecheck": "tsc -p tsconfig.json --noEmit",
  "build:client": "node scripts/build-client.mjs",
  "test": "npm run build && node --test"
}
```

（`TARGET` 现有 scripts 已经与 `REF` 对齐，**无需改动**。）

`tsconfig.json` 要点（`TARGET` 现有，已与 `REF` 同构）：`"module": "NodeNext"` + `"moduleResolution": "NodeNext"`（**必须**，因为源码用 `./git.js` 显式扩展名的 ESM 风格）+ `"declaration": true` + `"skipLibCheck": true`。

`scripts/build-client.mjs` 骨架（见 B6.2，把 `const pkg` 改成 `'dsh-worktree-groups'`）：

```js
import { build } from 'esbuild'

const pkg = 'dsh-worktree-groups'

await build({
  entryPoints: ['src/client.tsx'],
  bundle: true,
  format: 'cjs',
  target: 'es2023',
  outfile: 'lib/client.js',
  external: ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives'],
  banner: {
    js: `window.__ModuleLoader__.load({id:${JSON.stringify(pkg)},factory:(require)=>{var module={exports:{}};var exports=module.exports;Object.defineProperty(exports,Symbol.toStringTag,{value:"Module"});`,
  },
  footer: {
    js: ';return module.exports;}});',
  },
})
```

### D16.4 PRD 第 8 节契约表的**逐项核验结论**

| PRD 断言 | 核验 |
|---|---|
| `sidebar.workspaces` 是 `single`/`root` | ✅ `dsh-client-ui-sidebar/lib/client.js:391-394` |
| priority 小者渲染 | ✅ `dsh-client-ui-slots/lib/index.js:130`（按 priority 升序）+ `entriesOfSlot` 取每 cell 首个存活者 `:187-201` |
| 同 priority 重复注册抛错 | ✅ 实测：`single slot "sidebar.workspaces" already has a registration at priority 0 — register at a different priority to shadow it (lowest renders)` |
| 子 slot `sidebar.workspaces.directoryFlow`（`single`/`root`，由占用者自己 `children` 声明） | ✅ **声明部分正确，但"由占用者自己声明"会与官方冲突** —— ⚠️ 见 B2，这是 PRD 需要修订的硬约束 |
| `session.create` 接受 `workspaceId` **或** `cwd`（互斥） | ✅ `dsh-api-session-controller/lib/index.js:572`：`if (request.workspaceId !== undefined && request.cwd !== undefined) throw new RemoteError("gateway/bad-request", "session.create accepts workspaceId or cwd, not both", {})` |
| `workspaceRegistry.create(path, title?)` / `.get(id)` / `.list()` / `.delete(id)` | ✅ A4（`delete` 返回 `Promise<boolean>`，非 void） |
| `attachSession` 强制 `realpath(header.cwd) === workspace.path`，目录已删则永远无法 attach | ✅ A4.6（且额外要求 `cwd` 存在） |
| `SessionHeader` 字段全集 | ✅ A1.5（无仓库指针） |
| `SessionSummary` 字段全集 | ✅ A2.2（**额外确认**：还有 `projections`） |
| 折叠常量 `COLLAPSED_SESSION_LIMIT = 5`，文案 `展开其余 {n} 个会话` / `收起` | ✅ `dsh-client-ui-workspace/lib/client.js:23`：`const COLLAPSED_SESSION_LIMIT = 5;`（文案在 zh 字典 `:2674-2675`：`"sessions.count.one": "{n} session"` 等；中文词条在 locale 字典中，本插件自己出中文文案即可） |
| HTTP 路由 `ctx.webServer.register({ kind: 'exact', ... })` | ✅ A3 |
| 客户端 bundle `window.__ModuleLoader__.load({id, factory:(require)=>{...}})` | ✅ B6.1/B6.2 |
| `external: react, react/jsx-runtime, @deepseek-ai/dsh-client-ui-primitives` | ✅ 三者均在浏览器种子表白名单内 B6.4 |

## D17. 与 `docs/PRD.md` 设计冲突的硬约束

### ⚠️ 冲突 1（**严重，必修**）：D19「重新声明子 slot」不可行

**PRD 原文**（`docs/PRD.md:112`）：

> | D19 | 添加工作区 | **保留**：重新声明子 slot `sidebar.workspaces.directoryFlow`，接回宿主目录选择器 |

**PRD 第 8 节**（`:181`）：

> | 子 slot | `sidebar.workspaces.directoryFlow`（`single`/`root`，**由占用者自己 `children` 声明**） |

**冲突事实**：官方 `ui-workspace` **也**在声明它（`dsh-client-ui-workspace/lib/client.js:2796-2799`），且 `SlotCore.register` 对同键重复声明**抛错**（`dsh-client-ui-slots/lib/index.js:100-103`）。**实测两种注册顺序都会有一方抛错**，导致该 entry apply 失败。而 `apply` 抛错会让槽位注册回滚 —— **侧栏会退回官方 UI 或其他占用者**，插件静默失效（PRD R2 的"侧栏空白"风险变体）。

**修订建议**（见 B2.3）：
- **不要**走「声明官方键 `sidebar.workspaces.directoryFlow`」的路子 —— 与官方注册冲突（抛错）。
- **不要**走「`disabled: true` 掉 `ui-workspace`」的路子 —— `uiWorkspace` 是 5 个客户端插件的硬依赖，禁用会导致 web 启动断言失败、**整页白屏**。
- **推荐路线 3**：声明**自己的新 child 键**（如 `sidebar.workspaces.worktreeDirectoryFlow`）以拿到 `renderSlot`，目录选择改调 `ctx.get('uiWorkspace').pickDirectory()` + `ctx.workspaces.create({ path })`。
- **次选路线 1**：完全不声明 `children`，只做 `priority: -1` 遮蔽；picker 同样自实现。

> 附注：参考项目 `REF` **没有**踩这个坑 —— 它的注册只有 `{ name, priority, inject }`（`REF/src/client.tsx:2093-2103`），因此**没有**声明 `directoryFlow`，也就**没有**接回官方目录选择器，而是自己实现了 `pickDirectory` → `/dsh-coding-workspace/...` 的 Modal 流程（`REF/src/client.tsx:2072-2073`）。这是"参考插件是反例"的具体一处：**它放弃了 PRD D19 要保留的能力**。

### ⚠️ 冲突 2（中）：D12 展开态 localStorage 与 `useStore` 不可兼得（若走路线 1）

`useStore` / `actions` 只在注册时声明 `store:` 才有（B1.3）。若选路线 1（不声明 `children`），仍**可以**声明 `store:`（二者独立：`standardKit` `:608-621` 分别判断 `host.storeOf(entry,...)` 与 `entry.children`）。⇒ D12 的展开态持久化**可**用官方 `defineStore({ persist: ... })` 实现（官方 `createWorkspaceViewStore` 是范例，`persist: "dsh.workspace.view.v5"`）。**此条不冲突，但需注意 `store` 与 `children` 无关。**

### ⚠️ 冲突 3（中）：D6/G4「保留原位」与 `workspaceRegistry.sessionIds` 的过滤语义

**PRD D6**（`:68`）："**保留原位**：已有工作区行的会话只看自己的 `sessionIds`/`cwd`，不跨 worktree 重分"。
但 A4.5 已证：`workspace.sessionIds` getter **实时过滤**掉 `realpath` 不再匹配的会话（`dsh-workspace/lib/index.js:102-104`）。

⇒ **直接读 `workspace.sessionIds` 会丢会话**（PRD US5 要求"分布不变"、US3 要求"存量孤儿会话也被接回"）。必须改为**以 `sessionPersistence.list()` 的 header.cwd 为主数据源**做归属计算，`workspaceRegistry` 只用来取 id/path/title。

### ⚠️ 冲突 4（轻）：D21 台账路径应使用 `resolveDshHome()` 而非 `defaultDshHome()`

**PRD D21**（`:60`）："`~/.dsh/worktree-groups.json`，临时文件 + rename 原子写"。
A5.1 已证 `defaultDshHome()` **忽略 `$DSH_HOME`**。建议用 `dshHomePath('worktree-groups.json')`（= `resolveDshHome()` + join），既能落在 `~/.dsh` 默认情形，也尊重 `$DSH_HOME` 覆盖。参考插件用了 `defaultDshHome`（`REF/src/tools/panel-routes.ts:5`）—— **不要照抄这一处**。

### ⚠️ 冲突 5（轻）：`SessionSummary` 无 `createdAt`，`SessionHeader` 无 `updatedAt`

US4「展开默认展示 5 个最近会话」的排序键 `updatedAt` 只在客户端 `sessions` 快照上；`sessionPersistence` 只给 `createdAt`。若某会话在客户端快照里不可见（例如已归档、或属于死 cwd 的孤儿），**没有 `updatedAt` 可用**，需退化到 `header.createdAt`。US3 的 history 桶正是这种情形。

### ⚠️ 冲突 6（轻）：本机无 `_no-cwd` 会话，但代码必须处理 `cwd === undefined`

A1.4：当前 23 个项目目录中无 `_no-cwd`。但 `SessionHeader.cwd` 是可选的、物理布局有 `_no-cwd` 分支。**不能假设 `header.cwd` 一定有值**；`attachSession` 也会因 `cwd === undefined` 明确抛错。

---

# 给实现者的硬约束（易踩坑点清单）

1. **服务名固定**，不要猜：宿主 `sessionPersistence` / `sessions` / `workspaceRegistry` / `webServer` / `tools` / `storageDomain`；客户端 `slots` / `sessions` / `workspaces` / `locale` / `layout` / `uiWorkspace` / `remote`。

2. **`sidebar.workspaces` 的 children 声明是零和资源。** 若要与官方 `ui-workspace` 共存，**不要**声明 `sidebar.workspaces.directoryFlow`（`SlotCore.register` 抛 `slot "..." is already declared`）。**也不要**试图 `disabled: true` 掉 `ui-workspace` —— 它的 `apply` 同时提供 `uiWorkspace` 服务，而该服务是 `ui-sidebar` / `ui-conversation` / `ui-directory-picker-browse` / `ui-directory-picker-native` / `ui-agent-preset` 的硬 `inject` 依赖；禁用会让它们永久 pending，触发 `web boot: N entries did not activate`，**整页白屏**。正确做法：声明一个**自己的新 child 键**（路线 3）。

3. **同 priority 重复注册会抛错**；抢占用 `priority: -1`（官方是 `0`，低者渲染）。错误原文：`single slot "sidebar.workspaces" already has a registration at priority 0 — register at a different priority to shadow it (lowest renders)`。

4. **`renderSlot` / `t` / `useStore`+`actions` 都是条件性 props**，分别对应注册选项 `children` / `locale` / `store`。不加就拿到 `undefined`。`useSessions` / `useWorkspaces` / `useSessionPendingInteraction` / `usePanelInfo` 才是全局白送。

5. **`ctx.slots.inject(key, cb)` 是唯一可靠的时序手段。** `dsh.client.inject` 只是预取元数据（官方源码明确："never apply sequencing"）；其它 client 插件的 apply 顺序不受约束。

6. **必须在最外层包错误边界。** 官方 `SlotErrorBoundary`（`dsh-client-ui-renderer/lib/client.js:519-533`）会捕获并**让 entry abdicate**（`reportEntryError` 带 `abdicate: true`），然后 outlet 投影到 cell 的下一个存活者 —— 也就是**官方 UI 会回来**，用户的树形视图会"无缘无故消失"。更糟的是 `SlotAssemblyError` 会被**重新抛出**（`:522-524`：`if (error instanceof SlotAssemblyError) throw error;`），击穿边界。PRD R2 的顶层错误边界是必需的。

7. **必须处理 `wide === false` 的轨道态。** 侧栏折叠时会以 `wide: false` + `expandSidebar` 渲染同一槽位（B1.4）。忽略它会在折叠态渲染整棵树，布局崩坏。轨道态应渲染 36px 图标入口并调 `expandSidebar()`。

8. **client bundle 的 `external` 必须 ⊆ 浏览器种子白名单**：`react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、`@deepseek-ai/cordis`、`@deepseek-ai/dsh-client-store`、`@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-ui-primitives`、`@deepseek-ai/dsh-client-ui-dockkit`。声明白名单外的 specifier 且真的 `require()` 它 ⇒ **装载期抛错**（原文见 B6.4）。`@deepseek-ai/dsh-client-ui-dockkit` 虽在白名单，但 2.0.10 **未随包发布**，别用。

9. **banner 的 `id` 必须等于 `package.json.name`**，且 `exports["./client"]` 必须存在，否则 `client-modules` 加载期抛 `declares dsh.client but exports no "./client" bundle`。

10. **`dsh.bundle.patch` 必须有**（作为 profile bundle 解析时），否则抛 `declares no dsh.bundle in its package.json`。

11. **`@deepseek-ai/*` 不要放进 `dependencies`。** 会拉进插件自己的 `node_modules`，而解析钩子**优先命中**插件自带副本（实测），`cordis` 一旦出现两份实例，Cordis 服务注册失效。`@deepseek-ai/cordis` 只允许 **type-only import**。

12. **`sessionPersistence.list()` 是全量历史（含死 cwd）的唯一来源；`workspace.sessionIds` 会过滤掉死 cwd 会话。** 归属计算应以 `sessionPersistence.list()[].header.cwd` 为主，`workspaceRegistry` 只取 id/path/title。反之，US5「分布不变」若直接信 `sessionIds` 会丢会话。

13. **`header.cwd` 可能不存在**（`_no-cwd` 分支）。任何 `realpath(header.cwd)` 之前先判 `undefined`。宿主 `attachSession` 会因缺 cwd 明确抛错。

14. **`workspaceRegistry.create` 对已存在路径幂等但不更新 title**；对不存在/非目录路径**抛错**（不是返回 undefined）。`delete` 返回 `Promise<boolean>`，未知 id 是 no-op。

15. **`webServer.register` 返回 disposer，必须放进 `ctx.effect`**；同 `(kind, path)` 重复注册抛错。handler 抛错 → HTTP 400，不退出进程。

16. **`require('http')` 的 body 是流：必须自己收 chunk 并 JSON.parse。** 宿主不代劳（参考项目两份逐字重复的 `readBody`），失败要 `resolve({})` 而非 reject，否则请求悬挂。

17. **路由路径要带自己的命名空间前缀**（如 `/dsh-worktree-groups/...`）—— 路由表是全局的。

18. **台账路径用 `dshHomePath(...)` 而非 `defaultDshHome()`**，否则 `$DSH_HOME` 被覆盖时写错位置。

19. **`SessionSummary` 与 `SessionHeader` 字段不重叠**：`updatedAt`/`running`/`blank`/`parentSessionId` 只在 Summary；`createdAt`/`isSeeded`/`agentPreset` 只在 Header。按 `sessionId` join，且对孤儿会话要有 `updatedAt` 缺失的退化路径。

20. **子代理嵌套（US7）官方已有投影逻辑但未导出**：`flattenLineage()`（`dsh-api-session-controller/lib/client.js:554-580`）按 `parentSessionId` 挂载并产出 `depth`，且明确不按可变时间戳重排。需自行实现等价逻辑。

21. **`bundle.external` 的 esbuild 列表要手写，不能靠 `bundle: true` 自动外置**；`format: 'cjs'` + `target: 'es2023'`，且 **banner 自造 `module`/`exports`**（宿主只给 `require`）。

22. **不要复用官方包名做自己的包名。** `asar-module-resolver-state` 会校验包身份，实测报错：`dsh-plugin-desktop: profile package identity is invalid for <name>`。

23. **改宿主编排配置（`dsh.profile.bundles` 加 bundle）必须重启 DSH Desktop**（`patchReload: "live"` 只覆盖 `cordis.patch.yml` 的内容热重载）；**重启会终结当前会话**（PRD R1）。客户端 JS 迭代只需刷新页面。宿主 JS 迭代因 ESM 模块缓存也需重启。

24. **【2026-09-23】迟到 / 可选服务必须用 `ctx.inject(deps, cb)` 等，不许用一次性 `ctx.get()` 探测。**
    entry 是**并发创建**的（B4.4），`ctx.get()` 在 apply 那一刻拿不到就是 `undefined`，之后**不会**再有机会 ——
    本插件曾因此在启动竞态下漏注册 locale 词典，界面满屏裸 key（`menu.newSession` 这种）。
    `ctx.inject` 建子 fiber，**不进 `loader.entries()`** ⇒ 不会触发 `assertEntriesActive` 白屏（区别于
    把服务名写进导出的 `inject` 数组）。另外：**任何依赖 `t` 的渲染都应有「解不出就回落」的第二层保险**
    （见 `src/locales.ts` 的 `createSeatT`）—— 宿主 seat 在查不到 key 时**返回 key 本身**，不会报错。

25. **【2026-10-19】宿主 primitives 的图标导出名会随版本变，禁止直接取用。**
    `0.1.5-rc.2` 用尺寸后缀（`IconPlusOutline16`），`0.2.1-rc.2` 用线重后缀
    （`IconPlusOutlineRegular` / `Medium`）。直接取用得到 `undefined` ⇒ `jsx(undefined, {})`
    在**渲染期**抛 `Element type is invalid`；这类崩溃**逃过所有纯逻辑单测**（解析层、接线都可能是对的，
    只是某一个调用点漏改）。三条防线：
    ① 所有图标经 `src/icons.ts` 的 `resolveIcon`（候选表新旧兼容 + 全缺回落空图标，永不返回 `undefined`）；
    ② `test/icons.test.mjs` 的 AST 断言禁止 `src/sidebar.tsx` 出现任何 `P.Icon*` 属性访问；
    ③ `test/render-smoke.test.mjs` 按**真实宿主导出表**造 primitives 面，SSR 真渲染一遍
    （**宽态与 `wide: false` 轨道态都要渲染** —— 变异验证实测：只渲宽态会漏掉轨道分支里的同类崩溃）。

26. **【2026-10-19】root standard source 会随宿主版本增删，缺席必须降级，且要定期核对。**
    实测漂移：`0.1.5-rc.2` 有 root hook **`useSessionPendingInteraction`**，`0.2.1-rc.2`
    **已删除**（全宿主 0 处命中）；`useSessions().byId` 条目里的 **`completed` 字段也已删除**。
    现行「等待确认 / 后台完成未读」的唯一来源是 **`useSessionStatus`**：
    `Map<SessionId, { running: boolean, pendingInteraction: { kind } | undefined, completionUnread: boolean }>`
    （`dsh-client-ui-session/lib/client.js` 的 `publishStatus()`）。
    规则：① 取 source 一律经 `asHook()`（缺席 → 恒 `undefined` 占位，**不崩**）；
    ② 状态派生放**纯逻辑模块**（本仓库是 `src/live-state.ts`），否则 `.tsx` 里的取数逻辑零单测；
    ③ 新源优先、旧源兜底，别在漂移时直接删旧路径（宿主回退或其它 profile 组合仍可能需要）；
    ④ `ctx.slots` 的 `listSubTree` 返回的 `standardProps` 是**核对 source 名的权威入口**，
    升级宿主后先查它，再改代码。

---

## 未能确认 / 需要后续验证的点

| # | 事项 | 已查位置 | 状态 |
|---|---|---|---|
| 1 | 客户端 `ctx.conversation` / `conversationInput` 是否存在 | ✅ **已解决** | `dsh-client-ui-conversation/lib/client.js:2856-2859`：`super(ctx, "conversation")` + `this.input = config.input`。⇒ `ctx.get('conversation')?.input` **有效**（参考插件的探测姿势正确） |
| 2 | 客户端 `sessions` 快照的 `byId` / `ids` / `current` / `phase` | ✅ **已解决** | `dsh-api-session-controller/lib/client.js:3061-3069`：`createSnapshotStore({ ids, byId, current, phase, subagentsByParent, jobsBySession, currentAddress })` |
| 3 | `toast` / `showToast` 的官方来源 | ✅ **已解决** | `primitives` **导出** `Toast`（`lib/index.js:3824`：`function Toast({ text, icon, anchor, holdMs = HOLD_MS, onDone })`，且在 `:7906` 导出清单里）。但它是**受控的展示组件**（`holdMs` 后 `onDone`），**没有**全局 toast 队列/portal 服务 ⇒ 队列与 portal 仍需自建 |
| 4 | `$DSH_HOME` 在本机是否被设置 | 只读了 `dsh-home-paths` 的解析规则，未读运行进程环境 | **未能确认**（不影响建议：用 `dshHomePath` 两边都对） |
| 5 | 官方 `ui-workspace` 在 web profile 中的 entry `id` | ✅ **已解决（但结论反转）** | id = `ui-workspace`（`APP/node_modules/@deepseek-ai/dsh-web-app/cordis.patch.yml:283-284`）。**但禁用它会击穿 web 启动**（`uiWorkspace` 是 5 个插件的硬依赖），故该 id 仅供识别，**不可用于 disable** |
