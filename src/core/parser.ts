import type { Catalogue, EntityType } from './catalogue';
import type {
  Block,
  EntityRow,
  FileDefEntry,
  Issue,
  Level,
  ParamRow,
  ParsedFile,
  RecordFormat,
  Slot,
  SourceLine,
  ValueRecord,
} from './types';

export const DELIMITERS: Record<string, string> = { COMMA: ',', SEMICOLON: ';', TAB: '\t' };

export const LEVELS: Level[] = ['site', 'sample', 'fraction', 'analysis', 'parameter'];
export const LEVEL_ENTITY: Record<Level, EntityType> = {
  site: 'Sample_Site',
  sample: 'Sample',
  fraction: 'Fraction',
  analysis: 'Analysis',
  parameter: 'Parameter',
};
export const ENTITY_LEVEL: Partial<Record<EntityType, Level>> = {
  Sample_Site: 'site',
  Sample: 'sample',
  Fraction: 'fraction',
  Analysis: 'analysis',
  Parameter: 'parameter',
};
/** The identifier attribute each level is keyed on, and the parent reference it carries. */
export const LEVEL_KEY: Record<Level, string | null> = {
  site: 'SiteID',
  sample: 'SampleID',
  fraction: 'FractionID',
  analysis: 'AnalID',
  parameter: null,
};
export const LEVEL_PARENT_KEY: Record<Level, string> = {
  site: 'TransferID',
  sample: 'SiteID',
  fraction: 'SampleID',
  analysis: 'FractionID',
  parameter: 'AnalID',
};
export const LEVEL_LABEL: Record<Level, string> = {
  site: 'Sample site',
  sample: 'Sample',
  fraction: 'Fraction',
  analysis: 'Analysis',
  parameter: 'Results',
};

const PARAM_CONTEXT_ATTRS = new Set(['ParamName', 'ParamValue', 'Detector', 'PeakProperty', 'PopnNum', 'PComments']);

/** Decodes bytes as UTF-8 when valid (warning if non-ASCII), otherwise as ISO 8859-1/Windows-1252. */
export function decodeBytes(bytes: Uint8Array): { text: string; encoding: string } {
  let ascii = true;
  for (let i = 0; i < bytes.length; i++) if (bytes[i] > 127) { ascii = false; break; }
  if (ascii) return { text: new TextDecoder('ascii').decode(bytes), encoding: 'ASCII' };
  try {
    const hasBom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
    const text = new TextDecoder('utf-8', { fatal: true }).decode(hasBom ? bytes.subarray(3) : bytes);
    return { text, encoding: 'UTF-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'ISO 8859-1' };
  }
}

export interface SplitResult {
  fields: string[];
  quoted: boolean[];
  problems: string[];
}

/** Splits a record on the delimiter, honouring double-quote encapsulation ("" = embedded quote). */
export function splitRecord(text: string, delim: string): SplitResult {
  const fields: string[] = [];
  const quoted: boolean[] = [];
  const problems: string[] = [];
  const n = text.length;
  let i = 0;
  for (;;) {
    let j = i;
    while (j < n && (text[j] === ' ' || (text[j] === '\t' && delim !== '\t'))) j++;
    if (j < n && text[j] === '"') {
      let s = '';
      let closed = false;
      j++;
      while (j < n) {
        if (text[j] === '"') {
          if (text[j + 1] === '"') { s += '"'; j += 2; continue; }
          closed = true;
          j++;
          break;
        }
        s += text[j++];
      }
      if (!closed) problems.push('quoted text is not closed with a double quote');
      let k = j;
      while (k < n && text[k] !== delim) k++;
      const trailing = text.slice(j, k).trim();
      if (trailing) problems.push(`text after the closing quote: ${trailing}`);
      fields.push(s);
      quoted.push(true);
      if (k >= n) break;
      i = k + 1;
    } else {
      let k = i;
      while (k < n && text[k] !== delim) k++;
      const raw = text.slice(i, k);
      if (raw.includes('"')) problems.push(`double quote in text that is not encapsulated: ${raw.trim()}`);
      fields.push(raw);
      quoted.push(false);
      if (k >= n) break;
      i = k + 1;
    }
  }
  return { fields, quoted, problems };
}

/** Field value with the missing-value rules applied (empty or blanks = missing). */
const fieldValue = (s: string, q: boolean): string | null => {
  if (q) return s === '' ? null : s;
  const t = s.trim();
  return t === '' ? null : t;
};

const ciIndex = (keys: string[]) => {
  const m = new Map<string, string>();
  for (const k of keys) m.set(k.toLowerCase(), k);
  return m;
};

export function parseGcNpd95(text: string, fileName: string, cat: Catalogue, encoding = 'ASCII'): ParsedFile {
  const issues: Issue[] = [];
  const issue = (code: string, message: string, line?: number, extra?: { hint?: string; blockId?: string }) =>
    issues.push({ severity: 'error', code, message, line, ...extra });

  const attrCi = ciIndex(Object.keys(cat.attributes));
  const paramCi = ciIndex(Object.keys(cat.parameters));

  const resolveToken = (tok: string): Extract<Slot, { kind: 'attr' | 'param' }> => {
    if (cat.attributes[tok]) return { kind: 'attr', name: tok, written: tok };
    const a = attrCi.get(tok.toLowerCase());
    if (a) return { kind: 'attr', name: a, written: tok };
    if (cat.parameters[tok]) return { kind: 'param', name: tok, written: tok };
    const p = paramCi.get(tok.toLowerCase());
    return { kind: 'param', name: p ?? tok, written: tok };
  };

  const rawLines = text.split(/\r\n|\n|\r/);
  if (rawLines.length && rawLines[rawLines.length - 1] === '') rawLines.pop();
  const lines: SourceLine[] = rawLines.map((t, i) => ({ no: i + 1, text: t, kind: 'invalid' }));

  if (encoding === 'UTF-8') {
    const first = lines.find((l) => /[^\x00-\x7f]/.test(l.text));
    issue('F01', 'The file is UTF-8 encoded. GC-NPD-95 requires ISO 8859-1, so special characters (æ, ø, å, °) will be stored differently.', first?.no);
  }

  // ---------- File definition block ----------
  const fileDef: FileDefEntry[] = [];
  let idx = 0;
  let fileDefClosed = false;
  for (; idx < lines.length; idx++) {
    const l = lines[idx];
    const t = l.text;
    if (t.startsWith('//')) { l.kind = 'comment'; continue; }
    if (t.trim() === '') { l.kind = 'blank'; continue; }
    if (t.trimStart().startsWith('-----')) {
      l.kind = 'terminator';
      if (!t.startsWith('-----')) issue('F22', 'The block terminator must start in column 1.', l.no);
      fileDefClosed = true;
      idx++;
      break;
    }
    if (/^\s*00\s*[,;\t]/.test(t)) {
      issue('F02', 'The file definition block is missing or not terminated: a block definition line was found before the first block terminator (-----).', l.no);
      break;
    }
    l.kind = 'filedef';
    const head = t.slice(0, 15);
    let name = head.trim();
    let value = t.slice(15).trim();
    if (/\S\s+\S/.test(head.trim()) || (t.length > 15 && /\S/.test(t[14] ?? '') && /\S/.test(t[15] ?? ''))) {
      const m = t.trim().match(/^(\S+)\s+(.*)$/);
      if (m) { name = m[1]; value = m[2].trim(); }
      issue('F03', `"${name}" is not column-aligned: the value must start in column 16.`, l.no, {
        hint: `${name.padEnd(15, ' ')}${value}`,
      });
    }
    fileDef.push({ name, value, line: l.no });
  }
  if (!fileDefClosed && idx >= lines.length) {
    issue('F02', 'No block terminator (-----) was found after the file definition block.', lines.length || undefined);
  }

  // ---------- Delimiter ----------
  const delimEntry = fileDef.find((e) => e.name === 'Delimiter');
  let delimiter: string | null = delimEntry ? DELIMITERS[delimEntry.value] ?? null : null;
  const guessDelimiter = (): string | null => {
    for (let k = idx; k < lines.length; k++) {
      const m = lines[k].text.match(/^\s*00\s*([,;\t])/);
      if (m) return m[1];
    }
    return null;
  };
  if (!delimEntry) {
    delimiter = guessDelimiter();
  } else if (!delimiter) {
    delimiter = guessDelimiter();
  } else {
    const guessed = guessDelimiter();
    if (guessed && guessed !== delimiter) {
      const name = Object.entries(DELIMITERS).find(([, v]) => v === guessed)?.[0];
      issue('F08', `Delimiter is ${delimEntry.value}, but the data blocks are separated by ${name}.`, delimEntry.line, {
        hint: `Delimiter      ${name}`,
      });
      delimiter = guessed;
    }
  }
  const delim = delimiter ?? ',';

  // ---------- Data blocks ----------
  const blocks: Block[] = [];
  const blockIds = new Map<string, number>();
  type State = 'expectDef' | 'recdef' | 'values';
  let state = 'expectDef' as State;
  const inState = (x: State) => state === x;
  let cur: Block | null = null;
  let l0Attrs: string[] | null = null;
  let lastN = -1;
  let curRecord: ValueRecord | null = null;
  let lastRecLineN = 1;

  const closeRecDef = (b: Block) => {
    determineLevel(b);
    if (b.formats.size === 0) issue('F25', `Block ${b.id} defines no record formats (L1-L9 lines).`, b.defLine, { blockId: b.id });
  };

  const determineLevel = (b: Block) => {
    const attrs = new Set<string>();
    let hasParamSlots = false;
    for (const f of b.formats.values())
      for (const s of f.slots) {
        if (s.kind === 'attr') attrs.add(s.name);
        else if (s.kind === 'param' || s.kind === 'paramValue') hasParamSlots = true;
      }
    const paramAttrs = [...attrs].some((a) => PARAM_CONTEXT_ATTRS.has(a));
    let level: Level | null = null;
    if ((hasParamSlots || paramAttrs) && (attrs.has('AnalID') || ![...attrs].some((a) => ['SiteID', 'SampleID', 'FractionID'].includes(a)))) {
      level = 'parameter';
    } else {
      let depth = -1;
      for (const a of attrs) {
        const lv = ENTITY_LEVEL[cat.attributes[a]?.entity];
        if (lv) depth = Math.max(depth, LEVELS.indexOf(lv));
      }
      if (depth >= 0) level = LEVELS[depth];
    }
    b.level = level;
    if (!level) {
      issue('M01', `Block ${b.id} contains no identifier attribute, so its entity type cannot be determined.`, b.defLine, { blockId: b.id });
      return;
    }
    const entity = LEVEL_ENTITY[level];
    const parentKey = LEVEL_PARENT_KEY[level];
    for (const f of b.formats.values()) {
      f.slots = f.slots.map((s, i) => {
        const line = f.lines[Math.min(i, f.lines.length - 1)];
        if (s.kind === 'param' && level !== 'parameter') {
          const sugg = suggest(s.written, Object.keys(cat.attributes).filter((a) => cat.attributes[a].entity === entity));
          issue('D01', `"${s.written}" is not an attribute of ${entity.replace('_', ' ')}.`, line, {
            blockId: b.id,
            hint: sugg ? `Did you mean ${sugg}?` : undefined,
          });
          return { kind: 'unknown', written: s.written } as Slot;
        }
        if (s.kind === 'attr') {
          const def = cat.attributes[s.name];
          if (def.entity !== entity && s.name !== parentKey) {
            issue('M01', `${s.name} belongs to ${def.entity.replace(/_/g, ' ')}, but block ${b.id} describes ${entity.replace('_', ' ')}.`, line, { blockId: b.id });
          }
        }
        return s;
      });
    }
  };

  const startBlock = (l: SourceLine, t: string) => {
    l.kind = 'blockdef';
    const sp = splitRecord(t, delim);
    const f = sp.fields.map((x, i) => fieldValue(x, sp.quoted[i]) ?? '');
    let id = (f[2] ?? '').trim();
    if (f[0] !== '00' || f[1] !== 'DEFINE BLOCK' || !/^\d\d$/.test(id) || id === '00') {
      let hint = '00,DEFINE BLOCK,nn,Comment';
      if (f[1] && f[1] !== 'DEFINE BLOCK' && f[1].toUpperCase().replace(/\s+/g, ' ') === 'DEFINE BLOCK') hint = 'Write DEFINE BLOCK in capitals with one space.';
      if (/^\d$/.test(id)) hint = `Use two digits for the block identifier: 0${id}.`;
      issue('F10', `Malformed block definition line: ${t.trim()}`, l.no, { hint });
      if (/^\d$/.test(id)) id = '0' + id;
      if (!id) id = `?${blocks.length + 1}`;
    }
    for (const p of sp.problems) issue('F19', `Block definition line: ${p}.`, l.no);
    if (blockIds.has(id)) issue('F11', `Block identifier ${id} was already used on line ${blockIds.get(id)}.`, l.no, { blockId: id });
    else blockIds.set(id, l.no);
    const b: Block = {
      id,
      comment: f.slice(3).filter(Boolean).join(', '),
      defLine: l.no,
      formats: new Map(),
      records: [],
      level: null,
      hasValueBlock: false,
      lastLine: l.no,
    };
    blocks.push(b);
    if (blocks.length === 100) issue('F21', 'The file contains more than 99 block couples.', l.no);
    cur = b;
    l.block = id;
    l0Attrs = null;
    lastN = -1;
    curRecord = null;
    state = 'recdef';
  };

  for (; idx < lines.length; idx++) {
    const l = lines[idx];
    const raw = l.text;
    if (raw.startsWith('//')) { l.kind = 'comment'; continue; }
    if (raw.trim() === '') { l.kind = 'blank'; continue; }
    const t = raw.trimStart();
    if (t.startsWith('//')) {
      l.kind = 'comment';
      issue('F22', 'Comment lines must start with // in columns 1-2.', l.no);
      continue;
    }
    if (t !== raw) issue('F22', 'Records must start in column 1 (leading blanks found).', l.no);
    if (cur) l.block = (cur as Block).id;

    if (t.startsWith('-----')) {
      l.kind = 'terminator';
      if (t.replace(/\s+$/, '') !== '-----' && !/^-+$/.test(t.trim())) {
        issue('F22', 'The block terminator line should contain only five hyphens.', l.no);
      }
      if (inState('recdef') && cur) {
        closeRecDef(cur);
        state = 'values';
        (cur as Block).hasValueBlock = true;
        curRecord = null;
      } else if (inState('values') && cur) {
        if ((cur as Block).records.length === 0) issue('F16', `Value assignment block ${(cur as Block).id} contains no records.`, l.no, { blockId: (cur as Block).id });
        (cur as Block).lastLine = l.no;
        state = 'expectDef';
      } else {
        issue('F20', 'Block terminator without a preceding data block.', l.no);
      }
      continue;
    }

    const sp = splitRecord(t, delim);
    const vals = sp.fields.map((x, i) => fieldValue(x, sp.quoted[i]));
    const head = (sp.fields[0] ?? '').trim();

    if (head === '00') {
      if (inState('recdef') && cur) {
        issue('F12', `Record definition block ${(cur as Block).id} is not terminated before the next block starts.`, l.no, { blockId: (cur as Block).id });
        closeRecDef(cur);
        issue('F15', `Record definition block ${(cur as Block).id} has no value assignment block.`, (cur as Block).defLine, { blockId: (cur as Block).id });
      } else if (inState('values') && cur) {
        issue('F12', `Value assignment block ${(cur as Block).id} is not terminated before the next block starts.`, l.no, { blockId: (cur as Block).id });
      }
      startBlock(l, t);
      continue;
    }

    if (inState('expectDef')) {
      l.kind = 'invalid';
      l.block = undefined;
      if (cur && head === (cur as Block).id) {
        issue('F20', `Value record for block ${head} after the block was terminated.`, l.no, {
          hint: 'Remove the extra ----- line above, or move the record into the block.',
        });
      } else {
        issue('F20', 'Expected a block definition line (00,DEFINE BLOCK,nn) or a comment.', l.no);
      }
      continue;
    }

    const b = cur as unknown as Block;
    for (const p of sp.problems) issue('F19', `${p[0].toUpperCase()}${p.slice(1)}.`, l.no, { blockId: b.id });

    if (inState('recdef')) {
      l.kind = 'recdef';
      const m = head.match(/^L(\d)$/);
      if (!m) {
        issue('F13', `Record definition lines must start with L0-L9, found "${head}".`, l.no, { blockId: b.id });
        continue;
      }
      const n = Number(m[1]);
      const toks = vals.slice(1).filter((v): v is string => v !== null);
      if (n === 0) {
        l0Attrs = toks.map((x) => resolveToken(x)).map((s) => (s.kind === 'attr' ? s.name : s.written));
        for (const s of toks.map(resolveToken))
          if (s.kind === 'attr' && s.written !== s.name)
            issue('D09', `"${s.written}" must be written "${s.name}".`, l.no, { blockId: b.id });
        continue;
      }
      if (n < lastN) issue('F13', `Record format L${n} follows L${lastN}; the numbering must not decrease.`, l.no, { blockId: b.id });
      else if (lastN >= 1 && n > lastN + 1) issue('F14', `Record format jumps from L${lastN} to L${n}.`, l.no, { blockId: b.id });
      if (lastN === -1 && n !== 1) issue('F14', `The first record format is L${n}; it should be L1.`, l.no, { blockId: b.id });
      lastN = Math.max(lastN, n);
      let fmt = b.formats.get(n);
      if (!fmt) { fmt = { n, slots: [], lines: [] } as RecordFormat; b.formats.set(n, fmt); }
      const push = (s: Slot) => {
        fmt!.slots.push(s);
        fmt!.lines.push(l.no);
        if ((s.kind === 'attr' || s.kind === 'param') && s.written !== s.name)
          issue('D09', `"${s.written}" must be written "${s.name}".`, l.no, { blockId: b.id });
      };
      if (toks.length === 0) {
        issue('F13', `Record definition line L${n} names no attribute.`, l.no, { blockId: b.id });
        continue;
      }
      const first = resolveToken(toks[0]);
      if (l0Attrs && toks.length > 1 && first.kind === 'attr' && first.name === 'ParamValue') {
        const fixed: Record<string, string> = {};
        l0Attrs.forEach((a, i) => {
          const v = toks[i + 1];
          if (v !== undefined) fixed[a] = v;
        });
        const pn = fixed.ParamName;
        if (pn !== undefined) {
          const r = resolveToken(pn);
          if (r.kind === 'attr') { push(r); continue; }
          fixed.ParamName = r.name;
          if (r.written !== r.name) issue('D09', `"${r.written}" must be written "${r.name}".`, l.no, { blockId: b.id });
        }
        fmt.slots.push({ kind: 'paramValue', fixed });
        fmt.lines.push(l.no);
        continue;
      }
      for (const tok of toks) {
        const s = resolveToken(tok);
        if (s.kind === 'attr' && s.name === 'ParamValue') {
          fmt.slots.push({ kind: 'paramValue', fixed: {} });
          fmt.lines.push(l.no);
        } else push(s);
      }
      continue;
    }

    // inState('values')
    l.kind = 'value';
    b.lastLine = l.no;
    let n: number;
    if (head === b.id) {
      n = 1;
      curRecord = { line: l.no, lines: [] };
      b.records.push(curRecord);
      lastRecLineN = 1;
    } else {
      const m = head.match(/^L(\d)$/);
      if (m) {
        n = Number(m[1]);
        if (n === 1 || n === 0) {
          issue('F17', `Value records of format L1 start with the block identifier (${b.id}), not ${head}.`, l.no, { blockId: b.id, hint: `${b.id}${delim}${t.slice(head.length + 1)}` });
          continue;
        }
        if (!curRecord) {
          issue('F17', `${head} record without a preceding ${b.id} record.`, l.no, { blockId: b.id });
          continue;
        }
        if (n <= lastRecLineN) {
          issue('F17', `${head} record follows L${lastRecLineN}; continuation records must follow in increasing order.`, l.no, { blockId: b.id });
        }
        lastRecLineN = n;
      } else if (/^\d\d$/.test(head)) {
        issue('F17', `Record belongs to block ${head}, but the current block is ${b.id}.`, l.no, {
          blockId: b.id,
          hint: blockIds.has(head) ? `Block ${head} is defined on line ${blockIds.get(head)}.` : undefined,
        });
        continue;
      } else {
        issue('F17', `Unknown record identifier "${head}" in value block ${b.id}.`, l.no, { blockId: b.id });
        continue;
      }
    }
    const fmt = b.formats.get(n);
    if (!fmt) {
      issue('F17', `Record format L${n} is not defined in block ${b.id}.`, l.no, { blockId: b.id });
      continue;
    }
    const values = vals.slice(1);
    if (values.length > fmt.slots.length) {
      const extra = values.slice(fmt.slots.length);
      if (extra.some((v) => v !== null))
        issue('F18', `${values.length} values given, but format L${n} of block ${b.id} defines ${fmt.slots.length}.`, l.no, {
          blockId: b.id,
          hint: 'Text containing the delimiter must be enclosed in double quotes.',
        });
    }
    curRecord!.lines.push({ n, line: l.no, values: values.slice(0, fmt.slots.length) });
  }

  if (cur && !inState('expectDef')) {
    const b = cur as Block;
    if (inState('recdef')) {
      closeRecDef(b);
      issue('F12', `Record definition block ${b.id} is not terminated (end of file).`, lines.length, { blockId: b.id });
      issue('F15', `Record definition block ${b.id} has no value assignment block.`, b.defLine, { blockId: b.id });
    } else {
      issue('F12', `Value assignment block ${b.id} is not terminated with ----- (end of file).`, lines.length, { blockId: b.id });
    }
  }

  // ---------- Entities and results ----------
  const sites: EntityRow[] = [];
  const samples: EntityRow[] = [];
  const fractions: EntityRow[] = [];
  const analyses: EntityRow[] = [];
  const params: ParamRow[] = [];
  const target: Record<Exclude<Level, 'parameter'>, EntityRow[]> = { site: sites, sample: samples, fraction: fractions, analysis: analyses };

  for (const b of blocks) {
    if (!b.level) continue;
    for (const rec of b.records) {
      if (b.level !== 'parameter') {
        const row: EntityRow = { attrs: {}, attrLine: {}, line: rec.line, block: b.id };
        for (const vl of rec.lines) {
          const fmt = b.formats.get(vl.n)!;
          fmt.slots.forEach((s, i) => {
            if (s.kind !== 'attr') return;
            const v = vl.values[i] ?? null;
            if (v !== null || !(s.name in row.attrs)) {
              row.attrs[s.name] = v;
              row.attrLine[s.name] = vl.line;
            }
          });
        }
        target[b.level].push(row);
        continue;
      }
      let analId: string | null = null;
      for (const vl of rec.lines) {
        const fmt = b.formats.get(vl.n)!;
        const i0 = fmt.slots.findIndex((s) => s.kind === 'attr' && s.name === 'AnalID');
        if (i0 >= 0 && vl.values[i0]) analId = vl.values[i0];
      }
      for (const vl of rec.lines) {
        const fmt = b.formats.get(vl.n)!;
        let detector: string | null = null;
        let peak: string | null = null;
        let popn: string | null = null;
        let pname: string | null = null;
        let commentFrom = params.length;
        fmt.slots.forEach((s, i) => {
          const v = vl.values[i] ?? null;
          const emit = (name: string | null) => {
            if (v === null) return;
            if (!name) {
              issue('M16', `Value "${v}" has no parameter name (ParamName missing before ParamValue).`, vl.line, { blockId: b.id });
              return;
            }
            const numVal = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(v) ? Number(v) : null;
            params.push({
              analId,
              name,
              value: v,
              num: numVal,
              detector,
              peakProperty: peak,
              popnNum: popn,
              comment: null,
              line: vl.line,
              block: b.id,
              order: vl.n * 1000 + i,
            });
          };
          if (s.kind === 'param') emit(s.name);
          else if (s.kind === 'paramValue') {
            if (s.fixed.Detector) detector = s.fixed.Detector;
            if (s.fixed.PeakProperty) peak = s.fixed.PeakProperty;
            if (s.fixed.PopnNum) popn = s.fixed.PopnNum;
            emit(s.fixed.ParamName ?? pname);
          } else if (s.kind === 'attr') {
            if (s.name === 'Detector') detector = v;
            else if (s.name === 'PeakProperty') peak = v;
            else if (s.name === 'PopnNum') popn = v;
            else if (s.name === 'ParamName') pname = v;
            else if (s.name === 'PComments' && v !== null) {
              for (let k = commentFrom; k < params.length; k++) params[k].comment = v;
              commentFrom = params.length;
            }
          }
        });
      }
    }
  }

  return { fileName, encoding, lines, fileDef, delimiter, blocks, sites, samples, fractions, analyses, params, issues };
}

/** Closest candidate by edit distance (case-insensitive), or null when nothing is reasonably close. */
export function suggest(word: string, candidates: string[], maxDist = 2): string | null {
  const w = word.toLowerCase();
  let best: string | null = null;
  let bestD = Infinity;
  for (const c of candidates) {
    const d = editDistance(w, c.toLowerCase(), bestD);
    if (d < bestD) { bestD = d; best = c; }
  }
  return bestD <= Math.max(maxDist, Math.floor(word.length / 4)) && bestD < word.length ? best : null;
}

export function editDistance(a: string, b: string, cap = Infinity): number {
  if (Math.abs(a.length - b.length) >= cap) return cap;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin >= cap) return cap;
    prev = cur;
  }
  return prev[b.length];
}
