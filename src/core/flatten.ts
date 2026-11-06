import type { Catalogue } from './catalogue';
import type { EntityRow, ParamRow, ParsedFile } from './types';

export type Row = Record<string, string | number | null>;

export const FLAT_COLUMNS = [
  'TransferID', 'SiteID', 'SiteName', 'Country', 'SiteType',
  'SampleID', 'LabRefNumber', 'OpRefNumber', 'SampleType', 'UDepth', 'LDepth', 'SLithology',
  'FractionID', 'FracRefNumber', 'FractionType', 'FLithology',
  'AnalID', 'AnalType', 'ADescription', 'ALaboratory', 'ADate',
  'ParamName', 'Detector', 'PeakProperty', 'PopnNum', 'ParamValue', 'Unit', 'PComments', 'Block', 'Line',
];

const GC_UNITS: Record<string, string> = {
  AREA: 'peak area',
  HEIGHT: 'peak height',
  CNCAREA: 'concentration (from area)',
  CNCHEIGHT: 'concentration (from height)',
  NORMAREA: '% of sum of areas',
  NORMHEIGHT: '% of sum of heights',
};
const ISO_UNITS: Record<string, string> = { DELTA13C: '‰ PDB', DELTA2H: '‰ SMOW', DELTA18O: '‰ SMOW', DELTA34S: '‰ CDT' };

export function unitFor(p: Pick<ParamRow, 'name' | 'detector' | 'peakProperty'>, cat: Catalogue): string {
  const def = cat.parameters[p.name];
  if (p.peakProperty === 'ISOTRATIO') return ISO_UNITS[p.detector ?? ''] ?? '‰';
  if (p.peakProperty && GC_UNITS[p.peakProperty]) return GC_UNITS[p.peakProperty];
  if (!def) return '';
  return def.unit.startsWith('see NIGOGA') ? '' : def.unit;
}

export interface Context {
  site?: EntityRow;
  sample?: EntityRow;
  fraction?: EntityRow;
  analysis?: EntityRow;
}

export function buildIndex(pf: ParsedFile) {
  const by = (rows: EntityRow[], key: string) => {
    const m = new Map<string, EntityRow>();
    for (const r of rows) {
      const id = r.attrs[key];
      if (id && !m.has(id)) m.set(id, r);
    }
    return m;
  };
  const sites = by(pf.sites, 'SiteID');
  const samples = by(pf.samples, 'SampleID');
  const fractions = by(pf.fractions, 'FractionID');
  const analyses = by(pf.analyses, 'AnalID');
  const contextOfAnalysis = (analId: string | null): Context => {
    const analysis = analId ? analyses.get(analId) : undefined;
    const fraction = analysis ? fractions.get(analysis.attrs.FractionID ?? '') : undefined;
    const sample = fraction ? samples.get(fraction.attrs.SampleID ?? '') : undefined;
    const site = sample ? sites.get(sample.attrs.SiteID ?? '') : undefined;
    return { site, sample, fraction, analysis };
  };
  return { sites, samples, fractions, analyses, contextOfAnalysis };
}

export function paramKey(p: Pick<ParamRow, 'name' | 'detector' | 'peakProperty' | 'popnNum'>): string {
  let k = p.name;
  if (p.detector || p.peakProperty) k += ` [${p.detector ?? '?'} ${p.peakProperty ?? '?'}]`;
  if (p.popnNum) k += ` #${p.popnNum}`;
  return k;
}

const NUMERIC = /^[+-]?(\d+\.?\d*|\.\d+)$/;
/** Numeric text becomes a number (so spreadsheets get real numbers); everything else is kept as text. */
export const numify = (v: string | null | undefined): string | number | null => (v === null || v === undefined ? null : NUMERIC.test(v) ? Number(v) : v);
const NUMERIC_ATTRS = new Set(['UDepth', 'LDepth', 'DatumElevation', 'SSLatitude', 'SSLongitude', 'SLatitude', 'SLongitude']);

const val = (p: ParamRow): string | number => (p.num !== null ? p.num : p.value);

/** One row per reported value, with the full site/sample/fraction/analysis context. */
export function flatRows(pf: ParsedFile, cat: Catalogue): Row[] {
  const ix = buildIndex(pf);
  const transferId = pf.fileDef.find((e) => e.name === 'TransferID')?.value ?? null;
  return pf.params.map((p) => {
    const c = ix.contextOfAnalysis(p.analId);
    const a = (r: EntityRow | undefined, k: string) => r?.attrs[k] ?? null;
    return {
      TransferID: transferId,
      SiteID: a(c.site, 'SiteID') ?? a(c.sample, 'SiteID'),
      SiteName: a(c.site, 'SiteName'),
      Country: a(c.site, 'Country'),
      SiteType: a(c.site, 'SiteType'),
      SampleID: a(c.sample, 'SampleID') ?? a(c.fraction, 'SampleID'),
      LabRefNumber: a(c.sample, 'LabRefNumber'),
      OpRefNumber: a(c.sample, 'OpRefNumber'),
      SampleType: a(c.sample, 'SampleType'),
      UDepth: numify(a(c.sample, 'UDepth')),
      LDepth: numify(a(c.sample, 'LDepth')),
      SLithology: a(c.sample, 'SLithology'),
      FractionID: a(c.fraction, 'FractionID') ?? a(c.analysis, 'FractionID'),
      FracRefNumber: a(c.fraction, 'FracRefNumber'),
      FractionType: a(c.fraction, 'FractionType'),
      FLithology: a(c.fraction, 'FLithology'),
      AnalID: p.analId,
      AnalType: a(c.analysis, 'AnalType'),
      ADescription: a(c.analysis, 'ADescription'),
      ALaboratory: a(c.analysis, 'ALaboratory'),
      ADate: a(c.analysis, 'ADate'),
      ParamName: p.name,
      Detector: p.detector,
      PeakProperty: p.peakProperty,
      PopnNum: p.popnNum,
      ParamValue: val(p),
      Unit: unitFor(p, cat) || null,
      PComments: p.comment,
      Block: p.block,
      Line: p.line,
    };
  });
}

export const WIDE_CONTEXT = ['SiteName', 'SampleID', 'LabRefNumber', 'SampleType', 'UDepth', 'LDepth', 'FractionID', 'FractionType', 'FLithology', 'AnalID', 'ADescription', 'ALaboratory'];

export interface WideTable {
  analType: string;
  columns: string[];
  paramColumns: string[];
  units: Record<string, string>;
  rows: Row[];
}

/** One table per analysis type: one row per analysis, one column per parameter (incl. detector/peak property). */
export function wideTables(pf: ParsedFile, cat: Catalogue): WideTable[] {
  const ix = buildIndex(pf);
  const groups = new Map<string, { keys: string[]; keySet: Set<string>; units: Record<string, string>; rows: Map<string, Row> }>();
  for (const p of pf.params) {
    const c = ix.contextOfAnalysis(p.analId);
    const at = c.analysis?.attrs.AnalType ?? 'Unlinked';
    let g = groups.get(at);
    if (!g) groups.set(at, (g = { keys: [], keySet: new Set(), units: {}, rows: new Map() }));
    const key = paramKey(p);
    if (!g.keySet.has(key)) {
      g.keySet.add(key);
      g.keys.push(key);
      g.units[key] = unitFor(p, cat);
    }
    const rk = p.analId ?? `line ${p.line}`;
    let row = g.rows.get(rk);
    if (!row) {
      row = {};
      for (const col of WIDE_CONTEXT) {
        const src = col.startsWith('Site') ? c.site : ['FractionID', 'FractionType', 'FLithology'].includes(col) ? c.fraction : ['AnalID', 'ADescription', 'ALaboratory'].includes(col) ? c.analysis : c.sample;
        row[col] = NUMERIC_ATTRS.has(col) ? numify(src?.attrs[col]) : src?.attrs[col] ?? null;
      }
      row.AnalID = p.analId;
      g.rows.set(rk, row);
    }
    row[key] = val(p);
  }
  const order = Object.keys(cat.analysisTypes);
  return [...groups.entries()]
    .sort(([a], [b]) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99))
    .map(([analType, g]) => ({
      analType,
      columns: [...WIDE_CONTEXT, ...g.keys],
      paramColumns: g.keys,
      units: g.units,
      rows: [...g.rows.values()],
    }));
}

/** Entity table rows with all attributes that occur, in dictionary order. */
export function entityTable(rows: EntityRow[], cat: Catalogue): { columns: string[]; rows: Row[] } {
  const cols = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r.attrs)) cols.add(k);
  const columns = [...cols].sort((a, b) => (cat.attributes[a]?.sortKey ?? 999) - (cat.attributes[b]?.sortKey ?? 999));
  return {
    columns: [...columns, 'Line'],
    rows: rows.map((r) => {
      const o: Row = { Line: r.line };
      for (const [k, v] of Object.entries(r.attrs)) o[k] = NUMERIC_ATTRS.has(k) ? numify(v) : v;
      return o;
    }),
  };
}

export function toDelimited(rows: Row[], columns: string[], delim: string): string {
  const esc = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return s.includes(delim) || s.includes('"') || /[\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  let out = columns.map(esc).join(delim) + '\r\n';
  for (const r of rows) out += columns.map((c) => esc(r[c])).join(delim) + '\r\n';
  return out;
}
