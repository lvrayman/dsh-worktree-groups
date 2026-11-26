/**
 * 2026-11-26 IDEA 风格新建 worktree 表单纯逻辑测试（AC3）。
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  applyWorktreeFormChange,
  createInitialWorktreeForm,
  evaluateWorktreeForm,
  remoteBranchToLocalName,
  sanitizeWorktreeDirSegment,
} from '../lib/worktree-form.js'

const REPO = '/Users/dev/Documents/Project/DSH/dsh-worktree-groups'

const SAMPLE_BRANCHES = [
  {
    name: 'master',
    kind: 'local',
    isCurrent: true,
    checkedOutWorktreeName: 'dsh-worktree-groups',
    checkedOutWorktreePath: REPO,
  },
  {
    name: 'develop',
    kind: 'local',
  },
  {
    name: 'feature/ohos',
    kind: 'local',
    checkedOutWorktreeName: 'dsh-worktree-groups-ohos',
    checkedOutWorktreePath: '/Users/dev/Documents/Project/DSH/dsh-worktree-groups-ohos',
  },
  {
    name: 'origin/main',
    kind: 'remote',
  },
  {
    name: 'origin/feature/remote-only',
    kind: 'remote',
  },
  {
    name: 'origin/feature/ohos',
    kind: 'remote',
  },
  {
    name: 'origin/develop',
    kind: 'remote',
  },
]

test('2026-11-26/AC3 初始状态对齐 IDEA：默认选当前分支、不勾选新建分支、自动填充目录名与父目录、已检出分支禁用提交', () => {
  const form = createInitialWorktreeForm(REPO, SAMPLE_BRANCHES)
  assert.equal(form.fromBranch, 'master')
  assert.equal(form.newBranchChecked, false)
  assert.equal(form.newBranch, '')
  assert.equal(form.projectName, 'dsh-worktree-groups-master')
  assert.equal(form.projectNameTouched, false)
  assert.equal(form.location, '/Users/dev/Documents/Project/DSH')

  const evalResult = evaluateWorktreeForm(form, REPO, SAMPLE_BRANCHES)
  assert.equal(evalResult.targetPath, '/Users/dev/Documents/Project/DSH/dsh-worktree-groups-master')
  assert.equal(evalResult.canSubmit, false, 'master 已检出且未勾选新建分支 ⇒ 禁用提交（与 IDEA 一致）')
  assert.deepEqual(evalResult.hint, {
    code: 'branchCheckedOut',
    branch: 'master',
    worktreeName: 'dsh-worktree-groups',
  })
  assert.equal(evalResult.payload, null)
})

test('2026-11-26/AC3 切换到未检出的本地分支 ⇒ 目录名自动同步且允许直接检出', () => {
  const init = createInitialWorktreeForm(REPO, SAMPLE_BRANCHES)
  const next = applyWorktreeFormChange(init, { fromBranch: 'develop' }, REPO, SAMPLE_BRANCHES)

  assert.equal(next.projectName, 'dsh-worktree-groups-develop')
  assert.equal(next.projectNameTouched, false)

  const evalResult = evaluateWorktreeForm(next, REPO, SAMPLE_BRANCHES)
  assert.equal(evalResult.canSubmit, true)
  assert.equal(evalResult.hint, null)
  assert.deepEqual(evalResult.payload, {
    repoPath: REPO,
    branch: 'develop',
    createBranch: false,
    targetPath: '/Users/dev/Documents/Project/DSH/dsh-worktree-groups-develop',
  })
})

test('2026-11-26/AC3 勾选新建分支：空名禁用，输入合法名自动同步目录名并产出 createBranch:true + baseRef', () => {
  const init = createInitialWorktreeForm(REPO, SAMPLE_BRANCHES)
  const checked = applyWorktreeFormChange(init, { newBranchChecked: true }, REPO, SAMPLE_BRANCHES)

  const emptyEval = evaluateWorktreeForm(checked, REPO, SAMPLE_BRANCHES)
  assert.equal(emptyEval.canSubmit, false)
  assert.deepEqual(emptyEval.hint, { code: 'newBranchRequired' })

  const typed = applyWorktreeFormChange(checked, { newBranch: 'feature/demo' }, REPO, SAMPLE_BRANCHES)
  assert.equal(typed.projectName, 'dsh-worktree-groups-feature-demo')

  const validEval = evaluateWorktreeForm(typed, REPO, SAMPLE_BRANCHES)
  assert.equal(validEval.canSubmit, true)
  assert.equal(validEval.hint, null)
  assert.deepEqual(validEval.payload, {
    repoPath: REPO,
    branch: 'feature/demo',
    createBranch: true,
    baseRef: 'master',
    targetPath: '/Users/dev/Documents/Project/DSH/dsh-worktree-groups-feature-demo',
  })

  // 与已有本地分支重名 ⇒ 禁止提交
  const dup = applyWorktreeFormChange(checked, { newBranch: 'develop' }, REPO, SAMPLE_BRANCHES)
  const dupEval = evaluateWorktreeForm(dup, REPO, SAMPLE_BRANCHES)
  assert.equal(dupEval.canSubmit, false)
  assert.deepEqual(dupEval.hint, { code: 'branchExists', branch: 'develop' })
})

test('2026-11-26/AC3 手动修改目录名后锁定，不再被切换分支或输入新分支名覆盖', () => {
  const init = createInitialWorktreeForm(REPO, SAMPLE_BRANCHES)
  const manual = applyWorktreeFormChange(init, { projectName: 'my-custom-dir' }, REPO, SAMPLE_BRANCHES)
  assert.equal(manual.projectNameTouched, true)
  assert.equal(manual.projectName, 'my-custom-dir')

  const afterBranch = applyWorktreeFormChange(manual, { fromBranch: 'develop' }, REPO, SAMPLE_BRANCHES)
  assert.equal(afterBranch.projectName, 'my-custom-dir', '手动编辑后切换分支不得覆盖目录名')

  const afterNew = applyWorktreeFormChange(
    afterBranch,
    { newBranchChecked: true, newBranch: 'feat/x' },
    REPO,
    SAMPLE_BRANCHES,
  )
  assert.equal(afterNew.projectName, 'my-custom-dir', '手动编辑后输入新分支名不得覆盖目录名')
})

test('2026-11-26/AC3 未勾选新建分支时选择远端分支：无同名本地分支则跟踪新建，有且未检出则检出，已检出则禁用', () => {
  const init = createInitialWorktreeForm(REPO, SAMPLE_BRANCHES)

  // 1) origin/feature/remote-only：本地无同名 ⇒ createBranch:true, branch:'feature/remote-only', baseRef:'origin/feature/remote-only'
  const remoteOnly = applyWorktreeFormChange(
    init,
    { fromBranch: 'origin/feature/remote-only' },
    REPO,
    SAMPLE_BRANCHES,
  )
  assert.equal(remoteOnly.projectName, 'dsh-worktree-groups-feature-remote-only')
  const eval1 = evaluateWorktreeForm(remoteOnly, REPO, SAMPLE_BRANCHES)
  assert.equal(eval1.canSubmit, true)
  assert.deepEqual(eval1.payload, {
    repoPath: REPO,
    branch: 'feature/remote-only',
    createBranch: true,
    baseRef: 'origin/feature/remote-only',
    targetPath: '/Users/dev/Documents/Project/DSH/dsh-worktree-groups-feature-remote-only',
  })

  // 2) origin/develop：本地已有 develop 且未检出 ⇒ createBranch:false, branch:'develop'
  const remoteLocalFree = applyWorktreeFormChange(init, { fromBranch: 'origin/develop' }, REPO, SAMPLE_BRANCHES)
  const eval2 = evaluateWorktreeForm(remoteLocalFree, REPO, SAMPLE_BRANCHES)
  assert.equal(eval2.canSubmit, true)
  assert.deepEqual(eval2.payload, {
    repoPath: REPO,
    branch: 'develop',
    createBranch: false,
    targetPath: '/Users/dev/Documents/Project/DSH/dsh-worktree-groups-develop',
  })

  // 3) origin/feature/ohos：本地已有 feature/ohos 且已在 worktree 检出 ⇒ 禁用并提示
  const remoteCheckedOut = applyWorktreeFormChange(
    init,
    { fromBranch: 'origin/feature/ohos' },
    REPO,
    SAMPLE_BRANCHES,
  )
  const eval3 = evaluateWorktreeForm(remoteCheckedOut, REPO, SAMPLE_BRANCHES)
  assert.equal(eval3.canSubmit, false)
  assert.deepEqual(eval3.hint, {
    code: 'branchCheckedOut',
    branch: 'feature/ohos',
    worktreeName: 'dsh-worktree-groups-ohos',
  })
})

test('2026-11-26/AC3 校验非法目录名、相对位置与等于主仓路径', () => {
  const base = applyWorktreeFormChange(
    createInitialWorktreeForm(REPO, SAMPLE_BRANCHES),
    { fromBranch: 'develop' },
    REPO,
    SAMPLE_BRANCHES,
  )

  for (const badName of ['', '   ', '.hidden', '..', 'a/b', 'a\\b']) {
    const res = evaluateWorktreeForm({ ...base, projectName: badName }, REPO, SAMPLE_BRANCHES)
    assert.equal(res.canSubmit, false, `非法目录名应禁用：${JSON.stringify(badName)}`)
    assert.deepEqual(res.hint, { code: 'invalidProjectName' })
  }

  for (const badLoc of ['', '   ', 'relative/dir']) {
    const res = evaluateWorktreeForm({ ...base, location: badLoc }, REPO, SAMPLE_BRANCHES)
    assert.equal(res.canSubmit, false, `非法位置应禁用：${JSON.stringify(badLoc)}`)
    assert.deepEqual(res.hint, { code: 'invalidLocation' })
  }

  const sameAsMain = evaluateWorktreeForm(
    { ...base, projectName: 'dsh-worktree-groups', location: '/Users/dev/Documents/Project/DSH' },
    REPO,
    SAMPLE_BRANCHES,
  )
  assert.equal(sameAsMain.canSubmit, false)
  assert.deepEqual(sameAsMain.hint, { code: 'sameAsMainRepo' })
})

test('2026-11-26/AC3 工具函数：sanitizeWorktreeDirSegment 与 remoteBranchToLocalName', () => {
  assert.equal(sanitizeWorktreeDirSegment('feature/foo bar'), 'feature-foo-bar')
  assert.equal(sanitizeWorktreeDirSegment('///'), 'worktree')
  assert.equal(remoteBranchToLocalName('origin/feature/a'), 'feature/a')
  assert.equal(remoteBranchToLocalName('upstream/main'), 'main')
  assert.equal(remoteBranchToLocalName('main'), 'main')
})

test('2026-11-26/AC3 未勾选新建分支时直接输入新分支名 ⇒ 自动勾选新建分支并联动目录名（对齐 IDEA）', () => {
  const init = createInitialWorktreeForm(REPO, SAMPLE_BRANCHES)
  assert.equal(init.newBranchChecked, false)

  // 未勾选状态直接输入新分支名
  const typed = applyWorktreeFormChange(init, { newBranch: 'feature/auto-check' }, REPO, SAMPLE_BRANCHES)
  assert.equal(typed.newBranchChecked, true, '输入非空新分支名应自动勾选新建分支')
  assert.equal(typed.newBranch, 'feature/auto-check')
  assert.equal(typed.projectName, 'dsh-worktree-groups-feature-auto-check')

  const evalResult = evaluateWorktreeForm(typed, REPO, SAMPLE_BRANCHES)
  assert.equal(evalResult.canSubmit, true)
  assert.deepEqual(evalResult.payload, {
    repoPath: REPO,
    branch: 'feature/auto-check',
    createBranch: true,
    baseRef: 'master',
    targetPath: '/Users/dev/Documents/Project/DSH/dsh-worktree-groups-feature-auto-check',
  })

  // 仅输入空白不应自动勾选
  const whitespace = applyWorktreeFormChange(init, { newBranch: '   ' }, REPO, SAMPLE_BRANCHES)
  assert.equal(whitespace.newBranchChecked, false, '仅输入空白不应自动勾选')
})
