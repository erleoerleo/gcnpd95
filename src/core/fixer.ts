import { splitRecord } from './parser';
import type { FixProposal, Issue } from './types';

export const SODIR_FILE_NAME = 'GCH_RAW.ASC';

export interface FixGroup {
  group: string;
  code: string;
  title: string;
  from?: string;
  choices: string[];
  confident: boolean;
  /** all items share the same choices, so one selection applies to every item */
  uniform: boolean;
  items: FixProposal[];
  lines: number[];
}

const ORDER = ['F12', 'F03', 'S01', 'S03', 'S04', 'D09', 'F23'];

/** Groups the fixes attached to validation issues (one entry per distinct problem). */
export function collectFixes(issues: Issue[]): FixGroup[] {
  const groups = new Map<string, FixGroup>();
  for (const i of issues) {
    if (!i.fix) continue;
    let g = groups.get(i.fix.group);
    if (!g) {
      g = { group: i.fix.group, code: i.code, title: i.fix.title, from: i.fix.from, choices: i.fix.choices, confident: i.fix.confident, uniform: true, items: [], lines: [] };
      groups.set(i.fix.group, g);
    }
    if (g.items.length && JSON.stringify(g.items[0].choices) !== JSON.stringify(i.fix.choices)) g.uniform = false;
    g.items.push(i.fix);
    if (i.line && !g.lines.includes(i.line)) g.lines.push(i.line);
  }
  const rank = (c: string) => (ORDER.indexOf(c) + 1 || 99);
  return [...groups.values()].sort((a, b) => rank(a.code) - rank(b.code) || (a.lines[0] ?? 0) - (b.lines[0] ?? 0));
}

export interface FixSelection {
  group: FixGroup;
  /** chosen replacement for uniform groups; defaults to the first choice */
  value?: string;
}

const encodeField = (v: string, delim: string) =>
  v.includes(delim) || v.includes('"') || v !== v.trim() ? `"${v.replace(/"/g, '""')}"` : v;

/** Applies the selected fixes to the file text and returns the corrected text (original line endings kept). */
export function applyFixes(text: string, delimiter: string, selections: FixSelection[]): string {
  const eol = /\r\n/.test(text) ? '\r\n' : '\n';
  const lines = text.split(/\r\n|\n|\r/);
  const endsWithEol = lines.length > 1 && lines[lines.length - 1] === '';
  if (endsWithEol) lines.pop();

  const fieldEdits = new Map<number, { field: number; value: string }[]>();
  const lineEdits = new Map<number, string>();
  const inserts = new Set<number>();
  let append = false;

  for (const { group, value } of selections) {
    for (const fix of group.items) {
      const v = group.uniform && value !== undefined ? value : fix.choices[0];
      const t = fix.target;
      if (t.kind === 'field') (fieldEdits.get(t.line) ?? fieldEdits.set(t.line, []).get(t.line)!).push({ field: t.field, value: v });
      else if (t.kind === 'replaceLine') { if (!lineEdits.has(t.line)) lineEdits.set(t.line, v); }
      else if (t.kind === 'fileDef') lineEdits.set(t.line, `${t.name.padEnd(15, ' ')}${v}`);
      else if (t.kind === 'insertBefore') inserts.add(t.line);
      else if (t.kind === 'append') append = true;
    }
  }

  for (const [line, text2] of lineEdits) lines[line - 1] = text2;
  for (const [line, edits] of fieldEdits) {
    const raw = lines[line - 1];
    if (raw === undefined) continue;
    const indent = raw.length - raw.trimStart().length;
    let body = raw.slice(indent);
    const { spans } = splitRecord(body, delimiter);
    for (const e of [...edits].sort((a, b) => b.field - a.field)) {
      const span = spans[e.field];
      if (!span) continue;
      body = body.slice(0, span[0]) + encodeField(e.value, delimiter) + body.slice(span[1]);
    }
    lines[line - 1] = raw.slice(0, indent) + body;
  }
  for (const line of [...inserts].sort((a, b) => b - a)) lines.splice(line - 1, 0, '-----');
  if (append) {
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
    lines.push('-----');
  }
  return lines.join(eol) + (endsWithEol || append ? eol : '');
}

/** Characters that cannot be stored in ISO 8859-1 (they become '?'). */
export function nonLatin1(text: string): string[] {
  const out = new Set<string>();
  for (const ch of text) if (ch.charCodeAt(0) > 255) out.add(ch);
  return [...out];
}
