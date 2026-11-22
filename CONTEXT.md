# Worktree Groups

Organizes DSH sidebar workspaces and conversations by Git repository and worktree lineage, alongside recent activity across all conversations.

## Language

**Workspace (工作区)**:
A top-level sidebar entry representing either a Git repository (merging all registered DSH workspaces that share the same Git common directory) or a standalone non-Git folder.
_Avoid_: Project (in user-facing copy), Account, Group

**Worktree (工作树)**:
A Git working tree belonging to a Git Workspace, rendered as a second-level branch node under that Workspace (including the main working tree marked `[主]`).
_Avoid_: Sub-workspace, Branch folder

**History Bucket (`history-worktree-session`)**:
A virtual container under a Git Workspace that holds conversations whose original Worktree directory no longer exists on disk.
_Avoid_: Archive, Trash, Orphan folder

**Archive Workspace (归档工作空间)**:
Hiding a Workspace (Git or non-Git) and all its conversations from the sidebar (Workspace tree, Ungrouped, and Recent Section) without deleting its DSH workspace registration, disk directories, Git branches, worktrees, or conversation logs.
_Avoid_: Delete Workspace, Remove Worktree

**Unarchive Workspace (放出工作空间)**:
Restoring an archived Workspace and its conversations back to the sidebar, either manually from Settings (`设置 → 通用`) or automatically when the same directory (or a worktree of the same Git repository) is added as a Workspace again.
_Avoid_: Recreate Workspace

**Remove Worktree (移除 worktree)**:
Deleting a secondary Git working tree directory from disk (`git worktree remove`) while keeping its Git branch and moving its conversations into the parent Workspace's History Bucket.
_Avoid_: Delete Workspace

**Active Conversation (当前选中会话)**:
The top-level conversation currently open in the main view (when no other panel overrides the main view), rendered with a distinct selected highlight in the sidebar.
_Avoid_: Focused row, Hovered session

**Ungrouped (未分组)**:
A fallback container at the end of the Workspace tree that holds visible top-level conversations not belonging to any registered Workspace or History Bucket.
_Avoid_: Stray sessions, Loose sessions

**Recent Section (最近)**:
A dedicated section at the bottom of the left sidebar (separated from the Workspace tree by visual spacing) that lists all visible top-level conversations (5 by default, progressively expandable like other session containers) across all Workspaces, History Buckets, and Ungrouped, ordered strictly by last update time descending (`lastActivityAt`: any host `session/event` activity — user/assistant messages, tool runs, subagent/task activity — falling back to `updatedAt` when no activity has been observed in this host process).
_Avoid_: History, Activity log, Last prompt

**Progressive Expand (渐进式展开)**:
The "show more" behavior of every session container (Worktree, History Bucket, non-Git Workspace, Ungrouped, Recent Section): 5 conversations by default; the k-th click reveals 5·k more; "collapse" returns to 5; collapsing the parent row resets it.
_Avoid_: Expand all, Show all


