<p align="center">
  <img src="icon.svg" alt="dsh-worktree-groups" width="72" height="72">
</p>

<h1 align="center">dsh-worktree-groups</h1>

<p align="center">
  基于 DeepSeek Harness 插件机制构建的侧栏增强方案，将工作区与会话按 <strong>项目 → Git Worktree → 会话</strong> 三级树分组管理。
</p>

<p align="center">
  <a href="docs/README.md"><img src="https://img.shields.io/badge/%E6%96%87%E6%A1%A3-blue?logo=googledocs&amp;logoColor=white" alt="文档"></a>
  <a href="https://www.npmjs.com/package/dsh-worktree-groups"><img src="https://img.shields.io/npm/v/dsh-worktree-groups?color=CB3837&amp;logo=npm" alt="npm"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue" alt="License: MIT"></a>
  <a href="https://dshfind.com/zh/plugins/lvrayman/dsh-worktree-groups?ref=badge"><img src="https://dshfind.com/api/badge/lvrayman/dsh-worktree-groups?metric=downloads&amp;lang=zh" alt="dshfind 下载量"></a>
</p>

## 告别平铺工作区，按 Git Worktree 自然归位。

DeepSeek Harness 原生侧栏（`@deepseek-ai/dsh-client-ui-workspace`，占据 `sidebar.workspaces` 槽位）将每个注册的工作区渲染成**平级**分组，多个指向同一 Git 仓库不同分支的 worktree 在侧栏中彼此孤立，未主动注册过的 worktree 更是完全不可见。

`dsh-worktree-groups` 以 `priority: -1` 接管 `sidebar.workspaces` 槽位，通过 Git `commonDir` 自动将同一仓库下的所有 worktree 归并到同一个项目节点下，并提供未注册 worktree 自动发现、懒注册、一键新建/移除 worktree、已删 worktree 历史会话回收桶、三层拖拽排序与渐进式展开。

已支持 DeepSeek Harness 桌面版（Desktop）与 Web Host，安装最新版即可使用：

`dsh-worktree-groups@0.1.1`

## 界面结构预览

```text
▾ MyProject                         ← 项目（按 git common dir 自动归并多个 DSH 工作区）
   ▾ develop  [主]                  ← 主 worktree 行（点击行体展开/折叠；运行中任务图标高亮）
      🐋 修复登录跳转…              ← 默认展示 5 条，运行中会话自动置顶
      ⊞ 展开更多 5 个  |  收起      ← 渐进式展开（5 → 10 → 15…）
   ▾ feature/ohos                   ← 已注册 worktree
   ▾ feature/hb4-main               ← 未注册 worktree（自动发现，点 + 时才懒注册）
   ▾ release/6.1.20
   ▾ history-worktree-session       ← 已移除 worktree 的历史会话自动归入此桶
▾ LogAnalyst                        ← 单 worktree 的 Git 项目同样保持三级结构
   ▾ feature/refactor-render
      🐋 会话 1 …
📁 Documents（非 Git）              ← 非 Git 普通目录保持平铺形态
▾ 最近                              ← 跨工作区按最近活动时间倒序（任意活动实时触发）
（未分组）                          ← 侧栏底部，保持原生兜底位置
```

## 主要特性

- **项目 → Worktree → 会话三级树**：按 Git `commonDir` 将指向同一仓库的多个 DSH 工作区自动归并为单个项目节点；所有 Git 项目（含单 worktree 仓库）统一产出 worktree 子行，非 Git 普通目录保持平铺。
- **自动发现未注册 Worktree 与懒注册**：直接解析 `git worktree list --porcelain`，无需事先在 DSH 中逐个添加工作区即可在侧栏看到全部 worktree；仅在首次点击该 worktree 的 `+` 新建会话时才向宿主注册工作区，避免产生冗余注册记录。
- **同位置新建会话草稿保留**：在同一 worktree / 工作区下点击 `+` 新建会话时，若已存在未发送消息的空白会话则自动复用并跳转，避免冲掉未发送的输入框草稿。
- **`history-worktree-session` 历史会话回收桶**：worktree 被移除（通过 UI 移除或外部 `rm -rf`）后，其名下会话不会掉入「未分组」，而是通过「插件台账（`$DSH_HOME/worktree-groups.json`）+ 路径前缀启发（`<主仓名>-<后缀>` 同父目录）」双源识别，自动归入所属项目的 `history-worktree-session` 桶。
- **死工作区自动清理**：非主工作树且磁盘目录已不存在的工作区注册记录会自动从 DSH 注销（仅清理注册表，**绝不触碰磁盘文件与会话日志**）。
- **原地新建与移除 Worktree**：
  - **新建**：项目行 `…` → `新建 worktree…` → 选择新建或复用分支、起始分支与路径（默认 `<主仓父目录>/<主仓名>-<分支名>`）→ 自动执行 `git worktree add`、注册工作区并开启新会话。
  - **移除**：worktree 行 `…` → `移除 worktree` → 遇未提交改动时弹窗警告并提供强制删除选项 → 移除后自动注销工作区（保留 Git 分支）。
- **运行中任务高亮与顶部区**：当会话自身或其下任意层级子代理正在运行时，所属项目文件夹图标、worktree 分支图标实时高亮着色，并将运行中会话固定在该分组顶部（运行中锁定拖拽，运行结束后恢复自由拖拽）。
- **三层拖拽手动排序**：项目、worktree、会话三个层级均支持同容器内上下拖拽排序，首次拖拽即切入手动排序模式（持久化于浏览器 `localStorage`），并随时可通过菜单「恢复默认排序」。
- **渐进式会话展开与底部「最近」分区**：每个容器默认展示前 5 条会话，点击「展开更多 5 个」按步长渐进展开（同行附带「收起」）；侧栏底部提供「最近」分区，按会话最后活动时间（含流式输出与子代理事件）全局倒序展示。
- **工作空间归档与恢复**：支持将暂不使用的项目/工作空间从侧栏归档隐藏，并在 **设置 → 已归档的工作空间** 中随时一键恢复。
- **极致性能与实时响应**：服务端采用 Git 仓库指纹缓存、会话单次扫描复用、并发请求合并（singleflight）、ETag / 304 协商缓存与台账读写节流；客户端内置实时会话叠加层（live-merge），新建会话与新建 worktree 即刻呈现。

## 安装指南

### 方式一：DSH 桌面端插件管理器（推荐）

打开 DeepSeek Harness Desktop，进入 **插件（Plugins） → 添加插件（Add plugin）**：

- **从 npm 安装**（支持在线检查版本与更新）：
  ```text
  dsh-worktree-groups
  ```
- **从 GitHub 安装**：
  ```text
  github:lvrayman/dsh-worktree-groups
  ```

### 方式二：使用 `dsh plugin` CLI 安装

- **Desktop Profile**：
  ```sh
  dsh plugin --profile desktop add -w dsh-worktree-groups@latest
  ```
- **Web Host Profile**：
  ```sh
  dsh plugin --profile web add -w dsh-worktree-groups@latest
  ```

> 也可以将 `dsh-worktree-groups@latest` 替换为 `github:lvrayman/dsh-worktree-groups`。安装或切换来源后，请按提示重启 DeepSeek Harness。

### 方式三：本地源码开发与调试（`pnpm link`）

克隆本仓库并构建后，可通过本地目录或 `link:` 接入对应 Profile：

```sh
git clone https://github.com/lvrayman/dsh-worktree-groups.git
cd dsh-worktree-groups
npm install
npm run build
```

在 DSH 桌面端 **插件 → 添加插件** 中直接选择本地仓库目录，或手动将其链接至 `~/.dsh/profiles/web/package.json`：

```sh
# 1. 在 ~/.dsh/profiles/web/package.json 中：
#    - dsh.profile.bundles 数组追加 "dsh-worktree-groups"
#    - dependencies 追加 "dsh-worktree-groups": "link:/path/to/dsh-worktree-groups"
# 2. 更新 Profile 依赖
cd ~/.dsh/profiles/web && pnpm install
```

本包自带的 [`cordis.patch.yml`](cordis.patch.yml) 由 [`package.json`](package.json) 的 `dsh.bundle.patch` 声明，Profile 启动时自动合并，**无需**手动修改 Profile 的 `cordis.patch.yml`。新增 bundle 后需重启 DSH 生效。

## 侧栏行交互速查

| 行类型 | 悬停按钮 | 交互说明 |
| --- | --- | --- |
| **侧栏顶部（搜索框右侧）** | `+` | 添加工作区（复用宿主目录选择器，缺席时自动回退路径输入弹窗） |
| **Git 项目行** | `…` | `新建 worktree…`、手动排序下的 `恢复默认排序`、`归档工作空间` |
| **Worktree 行** | `+` 与 `…` | `+` 在该 worktree 新建会话（未注册时自动懒注册）；`…` 提供在文件管理器中打开、复制路径、重命名工作区、移除 worktree |
| **非 Git 工作区行** | `+` 与右键菜单 | `+` 在该工作区新建会话；右键菜单支持重命名、归档工作空间、删除工作区、恢复默认排序 |
| **会话行** | `…` 与右键菜单 | 重命名、派生会话（Fork）、归档会话、（history 桶内）移出 history |
| **最近 / 未分组行** | 无 | 点击展开/折叠分区 |

## 已知行为与本地存储说明

- **拖拽顺序与展开状态存储在浏览器端**（`localStorage`）：
  - `dsh-worktree-groups.collapsed`：节点折叠状态
  - `dsh-worktree-groups.expandedAll`：渐进式展开层级
  - `dsh-worktree-groups.order`：三层手动拖拽顺序
  - 更换浏览器或清除站点数据会回退至默认排序，不会影响会话数据。
- **插件台账**：`$DSH_HOME/worktree-groups.json`（默认 `~/.dsh/worktree-groups.json`）仅记录 worktree 历史归属与已归档项目键值，不修改宿主任何原生会话文件。
- **路径前缀启发边界**：`<主仓名>-<后缀>` 同父目录启发式识别在存在同名前缀兄弟仓库（如同时存在 `App` 与 `AppKit`）时可能将后者的孤儿目录归入前者的 history 桶，仅影响展示归属，绝不丢失或改动任何数据。

## 开发与验证

```sh
npm install
npm run typecheck    # TypeScript 类型检查（含 .ts 与 .tsx）
npm run build        # tsc 编译宿主半边 lib/ + esbuild 打包客户端半边 lib/client.js
npm test             # 构建并运行全部 node --test 单元与契约回归测试
```

构建产物：

- `lib/index.js`：宿主半边入口（注册 HTTP 路由、Git worktree 扫描、台账管理与活动追踪）。
- `lib/client.js`：浏览器客户端半边 bundle（`window.__ModuleLoader__.load({ id: "dsh-worktree-groups", ... })`）。

**依赖规范**：`@deepseek-ai/*` 一律不放入 `dependencies`，宿主服务全部通过 `ctx.get(name)` 运行时获取，`@deepseek-ai/cordis` 仅作 `import type` 与 `peerDependencies` 声明，避免与宿主运行时产生多实例冲突。

## 文档导航

本项目采用文档驱动开发（DDD）与三层知识库管理，完整设计、接口契约与历史工作记录均位于 [`docs/`](docs/README.md)：

- [文档总索引](docs/README.md)
- [领域术语表（CONTEXT.md）](CONTEXT.md)
- [产品需求文档（PRD）](docs/PRD.md)
- [模块与接口契约（INTERFACES）](docs/INTERFACES.md)
- [宿主契约核实报告（HOST-CONTRACTS）](docs/HOST-CONTRACTS.md)
- [代码知识库（L1 / L2 / L3 架构与实现详解）](docs/knowledge/README.md)
- [协作规范（AGENTS.md）](AGENTS.md)

## 项目声明与商标

本项目是独立的开源社区项目，不是 DeepSeek 官方产品。DeepSeek 及相关名称和商标归其各自权利人所有。

## 许可

[MIT](LICENSE)
