// Sync through dugite's bundled git: commit, fetch, merge (never rebase), push. Conflicts in page files are merged line
// by line; only edits to the same line come back to the designer.
import { exec } from 'dugite'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { mergeText } from '../shared/merge'
import type { FileConflict, GitStatus } from '../shared/api'

const git = async (cwd: string, ...args: string[]) => {
  const r = await exec(args, cwd)
  return { ok: r.exitCode === 0, out: String(r.stdout).trim(), err: String(r.stderr).trim() }
}

export async function status(root: string): Promise<GitStatus> {
  const s = await git(root, 'status', '--porcelain=v2', '--branch')
  if (!s.ok) return { repo: false, changed: 0, ahead: 0, behind: 0, upstream: false, remote: false, merging: false }
  const ab = /# branch\.ab \+(\d+) -(\d+)/.exec(s.out)
  const remote = (await git(root, 'remote')).out.length > 0
  const merging = await fs.access(path.join(root, '.git', 'MERGE_HEAD')).then(() => true, () => false)
  return { repo: true, changed: s.out.split('\n').filter((l) => /^[12u?] /.test(l)).length, ahead: +(ab?.[1] ?? 0), behind: +(ab?.[2] ?? 0), upstream: !!ab, remote, merging }
}

export async function init(root: string) {
  await git(root, 'init', '-b', 'main')
  await git(root, 'add', '-A')
  await git(root, 'commit', '-m', 'Start the lore repository')
}

export async function sync(root: string): Promise<{ error?: string; conflicts?: FileConflict[] }> {
  const st = await status(root)
  if (!st.repo) return { error: 'This folder is not shared yet.' }
  if (!st.merging && st.changed) {
    await git(root, 'add', '-A')
    const c = await git(root, 'commit', '-m', `Update ${st.changed} page${st.changed > 1 ? 's' : ''}`)
    if (!c.ok) return { error: c.err || c.out }
  }
  if (!st.remote) return {}
  const f = await git(root, 'fetch')
  if (!f.ok) return { error: f.err }
  if (st.upstream) {
    const m = await git(root, 'merge', '--no-edit', '@{u}')
    if (!m.ok) {
      const conflicts = await autoMerge(root)
      if (conflicts.length) return { conflicts }
      await git(root, 'commit', '--no-edit')
    }
  }
  const p = await git(root, 'push', ...(st.upstream ? [] : ['-u', 'origin', 'HEAD']))
  return p.ok ? {} : { error: p.err }
}

async function autoMerge(root: string): Promise<FileConflict[]> {
  const files = (await git(root, 'diff', '--name-only', '--diff-filter=U')).out.split('\n').filter(Boolean)
  const left: FileConflict[] = []
  for (const file of files) {
    const [base, ours, theirs] = await Promise.all([1, 2, 3].map(async (n) => (await git(root, 'show', `:${n}:${file}`)).out))
    const r = mergeText(base, ours, theirs)
    await fs.writeFile(path.join(root, file), r.text.endsWith('\n') ? r.text : r.text + '\n')
    if (r.conflicts.length) left.push({ file, merged: r.text, conflicts: r.conflicts })
    else await git(root, 'add', file)
  }
  return left
}

/** Writes the designer's chosen versions of conflicted pages and finishes the merge. */
export async function finish(root: string, resolved: { file: string; text: string }[]) {
  for (const r of resolved) {
    await fs.writeFile(path.join(root, r.file), r.text.endsWith('\n') ? r.text : r.text + '\n')
    await git(root, 'add', r.file)
  }
  await git(root, 'commit', '--no-edit')
  return sync(root)
}

export const setRemote = async (root: string, url: string) => { await git(root, 'remote', 'add', 'origin', url) }

export const history = async (root: string, file: string, since: string) =>
  (await git(root, 'log', `--since=${since}`, '--date=short', '--format=%ad %s', '--', file)).out.split('\n').filter(Boolean)
