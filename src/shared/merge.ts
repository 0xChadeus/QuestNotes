// Three-way page merge for Sync. diff3 over lines, then each conflict hunk is refined line by line when both sides kept
// the base's line count, so independent edits to neighbouring rows merge. Only edits to the same line stay conflicts.
import { diff3Merge } from 'node-diff3'

export interface Conflict { base: string; ours: string; theirs: string }

export function mergeText(base: string, ours: string, theirs: string): { text: string; conflicts: Conflict[] } {
  const out: string[] = []
  const conflicts: Conflict[] = []
  for (const block of diff3Merge(ours.split('\n'), base.split('\n'), theirs.split('\n'), { excludeFalseConflicts: true })) {
    if (block.ok) { out.push(...block.ok); continue }
    const { a, o, b } = block.conflict!
    if (a.length === o.length && b.length === o.length) {
      o.forEach((line, i) => {
        if (a[i] === line) out.push(b[i])
        else if (b[i] === line || a[i] === b[i]) out.push(a[i])
        else { conflicts.push({ base: line, ours: a[i], theirs: b[i] }); out.push(a[i]) }
      })
    } else {
      conflicts.push({ base: o.join('\n'), ours: a.join('\n'), theirs: b.join('\n') })
      out.push(...a)
    }
  }
  return { text: out.join('\n'), conflicts }
}

/** Applies the designer's choices: for each conflict, keep ours or theirs (ours is what mergeText left in place). */
export function resolve(merged: string, conflicts: Conflict[], keepTheirs: boolean[]): string {
  let text = merged
  conflicts.forEach((c, i) => { if (keepTheirs[i]) text = text.replace(c.ours, c.theirs) })
  return text
}
