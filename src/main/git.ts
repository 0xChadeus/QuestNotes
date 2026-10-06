// Sync through dugite's bundled git: commit, fetch, merge (never rebase), push. Conflicts in page files are merged line
// by line; only edits to the same line come back to the designer. The map file merges by id and never asks.
import { exec } from 'dugite'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'
import { mergeText } from '../shared/merge'
import { mergeMaps } from '../shared/map'
import { writeYaml } from '../shared/page'
import type { FileConflict, GitStatus, Synced } from '../shared/api'

const git = async (cwd: string, ...args: string[]) => {
  const r = await exec(args, cwd)
  return { ok: r.exitCode === 0, out: String(r.stdout).trim(), err: String(r.stderr).trim() }
}

export async function status(root: string): Promise<GitStatus> {
  const s = await git(root, 'status', '--porcelain=v2', '--branch')
  if (!s.ok) return { repo: false, changed: 0, ahead: 0, behind: 0, upstream: false, remote: false, merging: false }
  const ab = /# branch\.ab \+(\d+) -(\d+)/.exec(s.out)
  const url = (await git(root, 'remote', 'get-url', 'origin')).out
  const merging = await fs.access(path.join(root, '.git', 'MERGE_HEAD')).then(() => true, () => false)
  return { repo: true, changed: s.out.split('\n').filter((l) => /^[12u?] /.test(l)).length, ahead: +(ab?.[1] ?? 0), behind: +(ab?.[2] ?? 0), upstream: !!ab, remote: !!url, url, merging }
}

export async function init(root: string) {
  await git(root, 'init', '-b', 'main')
  await git(root, 'add', '-A')
  await git(root, 'commit', '-m', 'Start the lore repository')
}

export async function sync(root: string): Promise<Synced> {
  const st = await status(root)
  if (!st.repo) return { error: 'This folder is not shared yet.' }
  if (!st.merging && st.changed) {
    await git(root, 'add', '-A')
    const c = await git(root, 'commit', '-m', `Update ${st.changed} page${st.changed > 1 ? 's' : ''}`)
    if (!c.ok) return { error: c.err || c.out }
  }
  if (!st.remote) return {}
  const f = await git(root, 'fetch')
  if (!f.ok) return { error: explain(f.err, 'Could not reach the shared copy') }
  const notes: string[] = []
  if (st.upstream) {
    const m = await git(root, 'merge', '--no-edit', '@{u}')
    if (!m.ok) {
      const conflicts = await autoMerge(root, notes)
      if (conflicts.length) return { conflicts, ...told(notes) }
      await git(root, 'commit', '--no-edit')
    }
  }
  const p = await git(root, 'push', ...(st.upstream ? [] : ['-u', 'origin', 'HEAD']))
  return p.ok ? told(notes) : { error: explain(p.err, 'Could not send your changes'), ...told(notes) }
}

const told = (notes: string[]) => (notes.length ? { notes } : {})

/** Git's complaint in a sentence a designer can act on; the first line of git's own words follows. */
function explain(err: string, what: string) {
  const line = err.split('\n').map((l) => l.replace(/^(fatal|error|ERROR):\s*/, '').trim()).find((l) => l && !/^(hint|To |!)/.test(l)) ?? ''
  const why = /rejected|non-fast-forward|fetch first/.test(err) ? 'Someone else sent changes first; Sync again to merge them.'
    : /Could not resolve host|unable to access|Connection|timed out|Network/i.test(err) ? 'Check the network connection.'
    : /Permission denied|publickey|Authentication|403|401/i.test(err) ? 'The remote refused your credentials; check your SSH key or token.'
    : /not found|does not appear to be a git repository|Repository not found/i.test(err) ? 'Check the remote URL in Settings.' : ''
  return `${what}. ${why}${line ? ` (${line})` : ''}`.trim()
}

async function autoMerge(root: string, notes: string[]): Promise<FileConflict[]> {
  const files = (await git(root, 'diff', '--name-only', '--diff-filter=U')).out.split('\n').filter(Boolean)
  const left: FileConflict[] = []
  for (const file of files) {
    const [base, ours, theirs] = await Promise.all([1, 2, 3].map(async (n) => (await git(root, 'show', `:${n}:${file}`)).out))
    if (file === 'views/map.yaml') {
      const r = mergeMaps(...([base, ours, theirs].map((t) => parse(t) ?? {}) as [object, object, object]))
      await fs.writeFile(path.join(root, file), writeYaml(r.map))
      await git(root, 'add', file)
      if (r.clashes.length) notes.push(`You and someone else both moved ${r.clashes.length} item${r.clashes.length > 1 ? 's' : ''} on the map; your positions were kept.`)
      continue
    }
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

/** Adds, changes or (with an empty url) removes the remote the lore folder syncs with. */
export async function setRemote(root: string, url: string) {
  const has = (await git(root, 'remote', 'get-url', 'origin')).ok
  const r = url ? await git(root, 'remote', has ? 'set-url' : 'add', 'origin', url) : has ? await git(root, 'remote', 'remove', 'origin') : { ok: true, err: '' }
  if (!r.ok) throw new Error(r.err)
}

export const history = async (root: string, file: string, since: string) =>
  (await git(root, 'log', `--since=${since}`, '--date=short', '--format=%ad %s', '--', file)).out.split('\n').filter(Boolean)
