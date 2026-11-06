import { LOOKUP, type Catalogue, type AttributeDef } from './catalogue';
import { LEVELS, LEVEL_KEY, LEVEL_PARENT_KEY, LEVEL_LABEL, suggest, editDistance } from './parser';
import { severityFor, type Profile } from './rules';
import type { EntityRow, Issue, Level, ParsedFile } from './types';

export const ROCK_SAMPLE_TYPES = new Set(['CCOM', 'COCH', 'COFI', 'COPL', 'COSP', 'DC', 'DCG', 'DCOM', 'OC', 'SWC', 'SCOM', 'SRFC']);
const FILEDEF_ORDER = ['Format', 'Version', 'Dictionary', 'Delimiter'];
const NUM_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const DATE_RE = /^(\d{2})\.(\d{2})\.(\d{4})$/;

export interface ValidationResult {
  issues: Issue[];
  counts: Record<'error' | 'warning' | 'info', number>;
}

export function isValidDate(v: string): boolean {
  const m = v.match(DATE_RE);
  if (!m) return false;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Normalises a Norwegian wellbore name for fuzzy matching (blanks and leading zeros removed). */
export function normaliseWellName(s: string): string {
  return s
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/(^|[/\-])0+(\d)/g, '$1$2');
}

let wellIndexCache: { cat: Catalogue; map: Map<string, string>; names: string[] } | null = null;
function wellIndex(cat: Catalogue) {
  if (wellIndexCache?.cat !== cat) {
    const names = Object.keys(cat.lookups[LOOKUP.SiteName] ?? {});
    const map = new Map<string, string>();
    for (const n of names) map.set(normaliseWellName(n), n);
    wellIndexCache = { cat, map, names };
  }
  return wellIndexCache;
}

export function suggestWell(name: string, cat: Catalogue): string | null {
  const { map, names } = wellIndex(cat);
  const exact = map.get(normaliseWellName(name));
  if (exact) return exact;
  const quad = name.split('/')[0]?.trim();
  const pool = names.filter((n) => n.split('/')[0] === quad);
  let best: string | null = null;
  let bestD = 3;
  const a = normaliseWellName(name);
  for (const n of pool) {
    const d = editDistance(a, normaliseWellName(n), bestD);
    if (d < bestD) { bestD = d; best = n; }
  }
  return best;
}

/** Validates a lithology string such as "CLYST (DK GY) / SST (FGR, LT GY)". Returns problems. */
export function checkLithology(s: string, cat: Catalogue, isFraction: boolean): string[] {
  const out: string[] = [];
  const L = cat.lithology;
  const ci = new Map(Object.keys(L).map((k) => [k.toLowerCase(), k]));
  const parts: string[] = [];
  let depth = 0;
  let curPart = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === '/' && depth === 0) { parts.push(curPart); curPart = ''; } else curPart += ch;
  }
  parts.push(curPart);
  if (depth !== 0) return ['unbalanced parentheses'];
  const code = (c: string, allowed: number[], role: string) => {
    if (!c) { out.push(`empty ${role}`); return; }
    const e = L[c];
    if (!e) {
      const k = ci.get(c.toLowerCase());
      out.push(k ? `"${c}" must be written "${k}"` : `"${c}" is not a lithology code`);
      return;
    }
    if (!e.types.some((t) => allowed.includes(t))) out.push(`"${c}" cannot be used as ${role}`);
  };
  for (const raw of parts) {
    const p = raw.trim();
    const m = p.match(/^([^\s(]+)\s*(?:\((.*)\))?\s*$/);
    if (!m) { out.push(`cannot read "${p}"`); continue; }
    const main = m[1];
    code(main, [1], 'main lithology');
    if (main === 'BULK' && !isFraction) out.push('BULK can only be used for fractions');
    if (m[2] !== undefined) {
      for (const q of m[2].split(',')) {
        const toks = q.trim().split(/\s+/).filter(Boolean);
        if (!toks.length) out.push('empty qualifier');
        toks.forEach((tk, i) => {
          code(tk, [2, 3, 4, 5], 'qualifier');
          if (L[tk]?.types.includes(5) && !L[tk].types.includes(4) && i === toks.length - 1 && toks.length === 1)
            out.push(`colour shade "${tk}" must be followed by a colour`);
        });
      }
    }
  }
  return out;
}

export function validate(pf: ParsedFile, cat: Catalogue, profile: Profile): ValidationResult {
  const issues: Issue[] = [...pf.issues.map((i) => ({ ...i }))];
  const add = (code: string, message: string, line?: number, hint?: string, blockId?: string) =>
    issues.push({ severity: 'error', code, message, line, hint, blockId });

  const companies = cat.lookups[LOOKUP.Company] ?? {};
  const companyList = cat.sources?.companies ? 'the approved company list' : 'the catalogue company codes';
  const wellList = cat.sources?.wellbores ? 'the approved wellbore list' : 'the wellbore list of the catalogue';

  // ---------- File definition ----------
  const fd = new Map<string, { value: string; line: number }>();
  for (const e of pf.fileDef) {
    const def = cat.attributes[e.name];
    if (!def || def.entity !== 'Data_Transfer_Job') {
      const ci = Object.keys(cat.attributes).find((a) => a.toLowerCase() === e.name.toLowerCase() && cat.attributes[a].entity === 'Data_Transfer_Job');
      if (ci) add('D09', `"${e.name}" must be written "${ci}".`, e.line);
      else {
        const s = suggest(e.name, Object.keys(cat.attributes).filter((a) => cat.attributes[a].entity === 'Data_Transfer_Job'));
        add('F04', `"${e.name}" is not a file definition attribute.`, e.line, s ? `Did you mean ${s}?` : undefined);
      }
      if (ci && !fd.has(ci)) fd.set(ci, { value: e.value, line: e.line });
      continue;
    }
    if (fd.has(e.name)) add('F05', `${e.name} is given more than once (first on line ${fd.get(e.name)!.line}).`, e.line);
    else fd.set(e.name, { value: e.value, line: e.line });
  }
  const fdLine = pf.fileDef[0]?.line ?? 1;
  for (const def of Object.values(cat.attributes)) {
    if (def.entity !== 'Data_Transfer_Job' || def.requirement !== 'Mandatory') continue;
    const e = fd.get(def.name);
    if (!e || !e.value) add('F06', `${def.name} is missing from the file definition block. ${def.description}.`, e?.line ?? fdLine);
  }
  const fmt = fd.get('Format');
  if (fmt && fmt.value !== 'GC-NPD-95') add('F07', `Format is "${fmt.value}"; it must be GC-NPD-95.`, fmt.line);
  const ver = fd.get('Version');
  if (ver && ver.value !== '2.0') add('F07', `Version is "${ver.value}"; only version 2.0 is supported.`, ver.line);
  const dic = fd.get('Dictionary');
  if (dic && dic.value && !cat.dictionaryNames.includes(dic.value))
    add('D11', `Dictionary is "${dic.value}"; it must be ${cat.dictionaryNames.join(' or ')}.`, dic.line);
  const del = fd.get('Delimiter');
  if (del && del.value) {
    if (del.value === 'COLUMN') add('F08', 'The column-bound format (Delimiter COLUMN) belongs to version 1.0 and is not supported.', del.line);
    else if (!['COMMA', 'SEMICOLON', 'TAB'].includes(del.value)) {
      const up = del.value.toUpperCase();
      add(up !== del.value && ['COMMA', 'SEMICOLON', 'TAB'].includes(up) ? 'D09' : 'F08', `Delimiter "${del.value}" is not COMMA, SEMICOLON or TAB.`, del.line);
    }
  }
  const td = fd.get('TransferDate');
  if (td && td.value && !isValidDate(td.value)) add('F24', `TransferDate "${td.value}" is not a valid DD.MM.YYYY date.`, td.line);
  const st = fd.get('DTJStatus');
  if (st && st.value && !(st.value in (cat.lookups[LOOKUP.DTJStatus] ?? {})))
    add('D04', `DTJStatus "${st.value}" must be ${Object.keys(cat.lookups[LOOKUP.DTJStatus] ?? {}).join(' (new) or ')} (retransfer).`, st.line);
  for (const k of ['Sender', 'Recipient']) {
    const e = fd.get(k);
    if (e && e.value && !(e.value in companies)) add('S03', `${k} "${e.value}" is not in ${companyList}.`, e.line, companyHint(e.value, cat));
  }
  const order = pf.fileDef.map((e) => e.name);
  if (FILEDEF_ORDER.some((n, i) => order[i] !== n) && FILEDEF_ORDER.every((n) => order.includes(n)))
    add('F09', 'Format, Version, Dictionary and Delimiter should be the first four lines of the file definition block.', fdLine);

  if (profile === 'sodir' && pf.fileName && !/^GCH_RAW\.ASC$/i.test(pf.fileName))
    add('S06', `The file is called "${pf.fileName}". Files reported to Sodir should be named GCH_RAW.ASC.`);

  // ---------- Block order ----------
  let maxLevel = -1;
  let maxBlock = '';
  for (const b of pf.blocks) {
    if (!b.level) continue;
    const li = LEVELS.indexOf(b.level);
    if (li < maxLevel)
      add('M02', `Block ${b.id} (${LEVEL_LABEL[b.level].toLowerCase()}) comes after block ${maxBlock} (${LEVEL_LABEL[LEVELS[maxLevel]].toLowerCase()}); parents should be defined before children.`, b.defLine, undefined, b.id);
    if (li > maxLevel) { maxLevel = li; maxBlock = b.id; }

    // Detector/PeakProperty pairs within each record format
    for (const f of b.formats.values()) {
      f.slots.forEach((s, i) => {
        if (s.kind !== 'attr') return;
        if (s.name === 'Detector' && !(f.slots[i + 1]?.kind === 'attr' && (f.slots[i + 1] as { name: string }).name === 'PeakProperty'))
          add('M09', `Detector in format L${f.n} of block ${b.id} is not directly followed by PeakProperty.`, f.lines[i], undefined, b.id);
        if (s.name === 'PeakProperty' && !(f.slots[i - 1]?.kind === 'attr' && (f.slots[i - 1] as { name: string }).name === 'Detector'))
          add('M09', `PeakProperty in format L${f.n} of block ${b.id} is not directly preceded by Detector.`, f.lines[i], undefined, b.id);
      });
    }
  }

  // ---------- Attribute values ----------
  const checkValue = (def: AttributeDef, v: string, line: number, blockId: string, ctx: { fraction?: boolean }) => {
    switch (def.checkType) {
      case 1:
      case 6:
        if (def.checkType === 6 && v === 'UNKNOWN') break;
        if (!NUM_RE.test(v)) {
          if (/^[+-]?\d+,\d+$/.test(v)) add('F23', `${def.name} "${v}" uses a decimal comma.`, line, `Write ${v.replace(',', '.')}`, blockId);
          else add('D05', `${def.name} must be numeric${def.checkType === 6 ? ' or UNKNOWN' : ''}, found "${v}".`, line, undefined, blockId);
        } else {
          const n = Number(v);
          if ((def.min !== null && n < def.min) || (def.max !== null && n > def.max))
            add('D06', `${def.name} ${v} is outside ${def.min ?? '-∞'} to ${def.max ?? '∞'}.`, line, undefined, blockId);
        }
        break;
      case 2:
        if (!/^\d+$/.test(v) || (def.min !== null && Number(v) < def.min)) add('D07', `${def.name} must be a positive integer, found "${v}".`, line, undefined, blockId);
        break;
      case 4:
        if (!isValidDate(v)) add('F24', `${def.name} "${v}" is not a valid DD.MM.YYYY date.`, line, undefined, blockId);
        break;
      case 7: {
        const probs = checkLithology(v, cat, !!ctx.fraction);
        if (probs.length) add('D08', `${def.name} "${v}": ${probs.join('; ')}.`, line, 'Syntax: MAIN (qualifier, qualifier) / MAIN, e.g. CLYST (DK GY) / SST (FGR)', blockId);
        break;
      }
    }
    if (def.lookupId !== null && def.lookupId !== LOOKUP.SiteName) {
      const legal = cat.lookups[def.lookupId] ?? {};
      if (!(v in legal)) {
        if (def.lookupId === LOOKUP.Company) {
          add(def.name === 'Sender' || def.name === 'Recipient' ? 'S03' : 'S04', `${def.name} "${v}" is not in ${companyList}.`, line, companyHint(v, cat), blockId);
          return;
        }
        const ci = Object.keys(legal).find((k) => k.toLowerCase() === v.toLowerCase());
        if (ci) add('D09', `${def.name} "${v}" must be written "${ci}".`, line, undefined, blockId);
        else {
          const s = suggest(v, Object.keys(legal), 1);
          const list = Object.keys(legal);
          add('D04', `${def.name} "${v}" is not a legal value.`, line, s ? `Did you mean ${s}?` : list.length <= 40 ? `Legal values: ${list.join(', ')}` : undefined, blockId);
        }
      }
    }
  };

  const levelRows: Record<Exclude<Level, 'parameter'>, EntityRow[]> = {
    site: pf.sites,
    sample: pf.samples,
    fraction: pf.fractions,
    analysis: pf.analyses,
  };
  const entityOf: Record<Exclude<Level, 'parameter'>, string> = { site: 'Sample_Site', sample: 'Sample', fraction: 'Fraction', analysis: 'Analysis' };

  // ID registries: id -> first row
  const idx: Record<string, Map<string, EntityRow>> = {};
  for (const lv of ['site', 'sample', 'fraction', 'analysis'] as const) {
    const key = LEVEL_KEY[lv]!;
    const m = new Map<string, EntityRow>();
    for (const r of levelRows[lv]) {
      const id = r.attrs[key];
      if (!id) continue;
      if (m.has(id)) add('M04', `${key} "${id}" is already defined on line ${m.get(id)!.line}.`, r.attrLine[key] ?? r.line, undefined, r.block);
      else m.set(id, r);
    }
    idx[lv] = m;
  }
  const transferId = fd.get('TransferID')?.value;

  for (const lv of ['site', 'sample', 'fraction', 'analysis'] as const) {
    const entity = entityOf[lv];
    const mandatory = Object.values(cat.attributes).filter((a) => a.entity === entity && a.requirement === 'Mandatory');
    const parentKey = LEVEL_PARENT_KEY[lv];
    const parentLevel = LEVELS[LEVELS.indexOf(lv) - 1] as Exclude<Level, 'parameter'> | undefined;
    for (const r of levelRows[lv]) {
      const lineOf = (a: string) => r.attrLine[a] ?? r.line;
      for (const a of [parentKey, ...mandatory.map((m) => m.name)]) {
        if (r.attrs[a] === undefined) add('M03', `${a} is mandatory for ${entity.replace('_', ' ').toLowerCase()} records but block ${r.block} does not define it.`, r.line, undefined, r.block);
        else if (r.attrs[a] === null) add('M03', `${a} has no value.`, lineOf(a), undefined, r.block);
      }
      for (const [a, v] of Object.entries(r.attrs)) {
        if (v === null) continue;
        const def = cat.attributes[a];
        if (!def || a === parentKey) continue;
        checkValue(def, v, lineOf(a), r.block, { fraction: lv === 'fraction' });
      }
      // references
      const pv = r.attrs[parentKey];
      if (pv) {
        if (lv === 'site') {
          if (transferId && pv !== transferId) add('M07', `TransferID "${pv}" differs from the file definition (${transferId}).`, lineOf(parentKey), undefined, r.block);
        } else if (parentLevel) {
          const parent = idx[parentLevel].get(pv);
          if (!parent) {
            const s = suggest(pv, [...idx[parentLevel].keys()], 1);
            add('M05', `${parentKey} "${pv}" is not defined in any ${LEVEL_LABEL[parentLevel].toLowerCase()} block.`, lineOf(parentKey), s ? `Did you mean ${s}?` : undefined, r.block);
          } else if (parent.line > r.line) add('M06', `${parentKey} "${pv}" is defined later, on line ${parent.line}.`, lineOf(parentKey), undefined, r.block);
        }
      }
    }
  }

  // ---------- Conditional rules and site names ----------
  const analysesBySite = new Map<string, EntityRow[]>();
  const sampleOfFraction = (fid: string | null) => (fid ? idx.sample.get(idx.fraction.get(fid)?.attrs.SampleID ?? '') : undefined);
  for (const a of pf.analyses) {
    const s = sampleOfFraction(a.attrs.FractionID ?? null);
    const site = s?.attrs.SiteID;
    if (site) (analysesBySite.get(site) ?? analysesBySite.set(site, []).get(site)!).push(a);
  }
  const knownWells = cat.lookups[LOOKUP.SiteName] ?? {};
  for (const r of pf.sites) {
    const name = r.attrs.SiteName;
    const line = r.attrLine.SiteName ?? r.line;
    if (!name) continue;
    const hasCoords = !!r.attrs.SSLatitude && !!r.attrs.SSLongitude;
    if (name === 'UNKNOWN') {
      const an = analysesBySite.get(r.attrs.SiteID ?? '') ?? [];
      const nonRef = an.filter((a) => a.attrs.ADescription !== 'S');
      if (nonRef.length && !hasCoords)
        add('S05', `Site ${r.attrs.SiteID} is named UNKNOWN but has ${nonRef.length} analyses of normal samples (ADescription A).`, line, 'Use the registered wellbore name, or report coordinates for surface sites.', r.block);
      continue;
    }
    if (name in knownWells) continue;
    const isNorwegianWell = r.attrs.Country === 'NO' && r.attrs.SiteType === 'WELL';
    if (isNorwegianWell) {
      const s = suggestWell(name, cat);
      add('S01', `"${name}" is not in ${wellList}.`, line, s ? `Did you mean ${s}?` : 'Use the compact wellbore name, e.g. 6407/7-A-18 H or 15/9-19 SR2.', r.block);
    } else if (!hasCoords) {
      add('S02', `Site "${name}" is not a registered Norwegian well and has no SSLatitude/SSLongitude.`, line, 'Coordinates are seconds of arc: degrees*3600 + minutes*60 + seconds.', r.block);
    }
  }
  for (const r of pf.samples) {
    const t = r.attrs.SampleType;
    if (t && ROCK_SAMPLE_TYPES.has(t) && !r.attrs.SLithology)
      add('M15', `Sample ${r.attrs.SampleID} is a rock sample (${t}) and needs SLithology (use UNKNOWN if not determined).`, r.line, undefined, r.block);
    if (t === 'OTH' && !r.attrs.SComments) add('M15', `Sample ${r.attrs.SampleID} has SampleType OTH and must be described in SComments.`, r.line, undefined, r.block);
    const u = Number(r.attrs.UDepth);
    const l = Number(r.attrs.LDepth);
    if (NUM_RE.test(r.attrs.UDepth ?? '') && NUM_RE.test(r.attrs.LDepth ?? '') && u > l)
      add('M14', `Sample ${r.attrs.SampleID}: UDepth ${u} is below LDepth ${l}.`, r.attrLine.UDepth ?? r.line, undefined, r.block);
  }
  for (const r of pf.fractions) {
    const s = idx.sample.get(r.attrs.SampleID ?? '');
    const t = s?.attrs.SampleType;
    if (t && ROCK_SAMPLE_TYPES.has(t) && !r.attrs.FLithology)
      add('M15', `Fraction ${r.attrs.FractionID} comes from a rock sample (${t}) and needs FLithology (BULK if the whole sample was used).`, r.line, undefined, r.block);
    if (r.attrs.FractionType === 'OTH' && !r.attrs.FComments)
      add('M15', `Fraction ${r.attrs.FractionID} has FractionType OTH and must be described in FComments.`, r.line, undefined, r.block);
  }
  for (const a of pf.analyses) {
    const t = a.attrs.AnalType;
    if (t && !(t in cat.analysisTypes)) {
      const ci = Object.keys(cat.analysisTypes).find((k) => k.toLowerCase() === t.toLowerCase());
      if (ci) add('D09', `AnalType "${t}" must be written "${ci}".`, a.attrLine.AnalType, undefined, a.block);
      else add('D04', `AnalType "${t}" is not a legal analysis type.`, a.attrLine.AnalType, `Legal values: ${Object.keys(cat.analysisTypes).join(', ')}`, a.block);
    }
  }

  // ---------- Results ----------
  const detectors = cat.lookups[LOOKUP.Detector] ?? {};
  const peaks = cat.lookups[LOOKUP.PeakProperty] ?? {};
  const seen = new Map<string, number>();
  const reportedUnknownParam = new Set<string>();
  const reportedType = new Set<string>();
  const reportedPair = new Set<string>();
  const analysisHasParams = new Set<string>();
  const popDef = cat.attributes.PopnNum;
  for (const p of pf.params) {
    if (!p.analId) {
      add('M03', `Result ${p.name} has no AnalID.`, p.line, undefined, p.block);
      continue;
    }
    analysisHasParams.add(p.analId);
    const an = idx.analysis.get(p.analId);
    if (!an) {
      const key = `ref:${p.analId}:${p.block}`;
      if (!reportedPair.has(key)) {
        reportedPair.add(key);
        const s = suggest(p.analId, [...idx.analysis.keys()], 1);
        add('M05', `AnalID "${p.analId}" is not defined in any analysis block.`, p.line, s ? `Did you mean ${s}?` : undefined, p.block);
      }
    } else if (an.line > p.line) {
      const key = `late:${p.analId}`;
      if (!reportedPair.has(key)) { reportedPair.add(key); add('M06', `AnalID "${p.analId}" is defined later, on line ${an.line}.`, p.line, undefined, p.block); }
    }
    const def = cat.parameters[p.name];
    if (!def) {
      const key = `${p.block}:${p.name}`;
      if (!reportedUnknownParam.has(key)) {
        reportedUnknownParam.add(key);
        const s = suggest(p.name, Object.keys(cat.parameters));
        add('D02', `"${p.name}" is not a parameter name in the dictionary.`, p.line, s ? `Did you mean ${s}?` : undefined, p.block);
      }
    }
    const atype = an?.attrs.AnalType ?? null;
    if (def && atype && atype in cat.analysisTypes && def.analysisType !== atype) {
      const key = `${p.block}:${p.name}:${atype}`;
      if (!reportedType.has(key)) {
        reportedType.add(key);
        add('D03', `${p.name} is a ${def.analysisType} parameter, but analysis ${p.analId} is of type ${atype}.`, p.line, undefined, p.block);
      }
    }
    if (atype === 'GC') {
      const key = `m08:${p.line}:${p.analId}`;
      if ((!p.detector || !p.peakProperty) && !reportedPair.has(key)) {
        reportedPair.add(key);
        add('M08', `GC analysis ${p.analId} reports ${p.name} without ${!p.detector ? 'Detector' : 'PeakProperty'}.`, p.line, 'Specify Detector and PeakProperty before the first compound of every record line.', p.block);
      }
    } else if (atype && (p.detector || p.peakProperty)) {
      const key = `np:${p.block}:${p.analId}`;
      if (!reportedPair.has(key)) { reportedPair.add(key); add('M12', `Analysis ${p.analId} is of type ${atype}, but Detector/PeakProperty is given.`, p.line, undefined, p.block); }
    }
    if (p.detector && !(p.detector in detectors)) {
      const key = `det:${p.line}:${p.detector}`;
      if (!reportedPair.has(key)) { reportedPair.add(key); add('D04', `Detector "${p.detector}" is not a legal detector code.`, p.line, suggestHint(p.detector, Object.keys(detectors)), p.block); }
    }
    if (p.peakProperty && !(p.peakProperty in peaks)) {
      const key = `pk:${p.line}:${p.peakProperty}`;
      if (!reportedPair.has(key)) { reportedPair.add(key); add('D04', `PeakProperty "${p.peakProperty}" is not legal.`, p.line, `Legal values: ${Object.keys(peaks).join(', ')}`, p.block); }
    }
    if (p.popnNum !== null && popDef && (!/^\d+$/.test(p.popnNum) || Number(p.popnNum) < (popDef.min ?? 1)))
      add('D07', `PopnNum must be a positive integer, found "${p.popnNum}".`, p.line, undefined, p.block);
    if (atype === 'VR' && p.name.startsWith('Popn') && p.popnNum === null)
      add('M10', `${p.name} in analysis ${p.analId} needs a PopnNum.`, p.line, undefined, p.block);
    if (def) {
      if (def.numeric || def.checkType === 1 || def.checkType === 2) {
        if (!NUM_RE.test(p.value)) {
          if (/^[+-]?\d+,\d+$/.test(p.value)) add('F23', `${p.name} "${p.value}" uses a decimal comma.`, p.line, `Write ${p.value.replace(',', '.')}`, p.block);
          else if (def.numeric) add('D05', `${p.name} must be numeric, found "${p.value}".`, p.line, undefined, p.block);
        } else {
          const n = Number(p.value);
          if (def.checkType === 2 && !/^\d+$/.test(p.value)) add('D07', `${p.name} must be a positive integer, found "${p.value}".`, p.line, undefined, p.block);
          if ((def.min !== null && n < def.min) || (def.max !== null && n > def.max))
            add('D06', `${p.name} ${p.value} is outside ${def.min ?? '-∞'} to ${def.max ?? '∞'} ${def.unit && !def.unit.startsWith('see') ? def.unit : ''}.`.replace(/ \.$/, '.'), p.line, undefined, p.block);
        }
      }
    }
    const k = [p.analId, p.name, p.detector, p.peakProperty, p.popnNum].join('\u0001');
    if (seen.has(k)) add('M11', `${p.name}${p.detector ? ` (${p.detector}/${p.peakProperty})` : ''} for analysis ${p.analId} was already reported on line ${seen.get(k)}.`, p.line, undefined, p.block);
    else seen.set(k, p.line);
  }

  // ---------- Items without children ----------
  const used = (rows: EntityRow[], key: string) => new Set(rows.map((r) => r.attrs[key]).filter(Boolean) as string[]);
  const sampleUsed = used(pf.samples, 'SiteID');
  const fracUsed = used(pf.fractions, 'SampleID');
  const anUsed = used(pf.analyses, 'FractionID');
  const childless = (rows: EntityRow[], key: string, set: Set<string>, label: string, child: string) => {
    const ids = rows.filter((r) => r.attrs[key] && !set.has(r.attrs[key]!));
    if (ids.length)
      add('M13', `${ids.length} ${label} without ${child}: ${ids.slice(0, 8).map((r) => r.attrs[key]).join(', ')}${ids.length > 8 ? ', …' : ''}.`, ids[0].line, undefined, ids[0].block);
  };
  childless(pf.sites, 'SiteID', sampleUsed, 'site(s)', 'samples');
  childless(pf.samples, 'SampleID', fracUsed, 'sample(s)', 'fractions');
  childless(pf.fractions, 'FractionID', anUsed, 'fraction(s)', 'analyses');
  childless(pf.analyses, 'AnalID', analysisHasParams, 'analysis/analyses', 'results');

  const unknownCount = [...pf.sites, ...pf.samples].filter((r) => Object.values(r.attrs).includes('UNKNOWN')).length;
  if (unknownCount) add('D10', `${unknownCount} site/sample records use UNKNOWN. This is accepted only for historical data and reference samples.`);

  // ---------- Severity by profile ----------
  const out = issues
    .filter((i) => !(profile === 'generic' && i.code === 'S06'))
    .map((i) => ({ ...i, severity: severityFor(i.code, profile) }));
  const rank = { error: 0, warning: 1, info: 2 };
  out.sort((a, b) => rank[a.severity] - rank[b.severity] || (a.line ?? 0) - (b.line ?? 0));
  const counts = { error: 0, warning: 0, info: 0 };
  for (const i of out) counts[i.severity]++;
  return { issues: out, counts };
}

/** Hint for a company name that is not on the approved list: exact spelling, or names that contain it. */
export function companyHint(v: string, cat: Catalogue): string | undefined {
  const names = Object.keys(cat.lookups[LOOKUP.Company] ?? {});
  const up = v.toUpperCase().trim();
  const exact = names.find((n) => n.toUpperCase() === up);
  if (exact) return `Write it exactly as on the list: ${exact}`;
  const words = up.split(/[^A-ZÆØÅ0-9]+/).filter((w) => w.length >= 3);
  const hits = names.filter((n) => words.length && words.every((w) => n.toUpperCase().includes(w))).slice(0, 4);
  if (hits.length) return `Approved names include: ${hits.join(', ')}`;
  const s = suggest(v, names, 2);
  return s ? `Did you mean ${s}?` : undefined;
}

function suggestHint(v: string, list: string[]): string | undefined {
  const s = suggest(v, list, 1);
  return s ? `Did you mean ${s}?` : undefined;
}
