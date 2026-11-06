import type { Catalogue } from './catalogue';
import { buildIndex, paramKey, unitFor } from './flatten';
import type { ParsedFile } from './types';

export interface AnalysisPoint {
  analId: string;
  analType: string;
  siteId: string;
  siteName: string;
  sampleId: string;
  fractionType: string;
  lithology: string;
  depth: number | null;
  reference: boolean;
  values: Map<string, number>;
}

export interface KeyInfo {
  key: string;
  analType: string;
  unit: string;
  count: number;
  derived?: boolean;
}

const num = (s: string | null | undefined) => (s && /^[+-]?(\d+\.?\d*|\.\d+)$/.test(s) ? Number(s) : null);

/** Numeric results per analysis, with sample context and Rock-Eval indices derived when not reported. */
export function analysisPoints(pf: ParsedFile, cat: Catalogue): { points: AnalysisPoint[]; keys: KeyInfo[] } {
  const ix = buildIndex(pf);
  const byAnal = new Map<string, AnalysisPoint>();
  const keys = new Map<string, KeyInfo>();
  for (const p of pf.params) {
    if (p.num === null || !p.analId) continue;
    let a = byAnal.get(p.analId);
    if (!a) {
      const c = ix.contextOfAnalysis(p.analId);
      a = {
        analId: p.analId,
        analType: c.analysis?.attrs.AnalType ?? '?',
        siteId: c.site?.attrs.SiteID ?? c.sample?.attrs.SiteID ?? '?',
        siteName: c.site?.attrs.SiteName ?? c.sample?.attrs.SiteID ?? '?',
        sampleId: c.sample?.attrs.SampleID ?? '?',
        fractionType: c.fraction?.attrs.FractionType ?? '',
        lithology: c.fraction?.attrs.FLithology ?? c.sample?.attrs.SLithology ?? '',
        depth: num(c.sample?.attrs.LDepth),
        reference: c.analysis?.attrs.ADescription === 'S',
        values: new Map(),
      };
      byAnal.set(p.analId, a);
    }
    const k = paramKey(p);
    a.values.set(k, p.num);
    const info = keys.get(k) ?? { key: k, analType: a.analType, unit: unitFor(p, cat), count: 0 };
    info.count++;
    keys.set(k, info);
  }
  // Derived Rock-Eval indices
  let hiN = 0;
  let piN = 0;
  for (const a of byAnal.values()) {
    if (a.analType !== 'RE') continue;
    const toc = a.values.get('TOC');
    const s1 = a.values.get('S1');
    const s2 = a.values.get('S2');
    if (!a.values.has('HI') && toc && s2 !== undefined && toc > 0) { a.values.set('HI (calc.)', (100 * s2) / toc); hiN++; }
    if (!a.values.has('PI') && s1 !== undefined && s2 !== undefined && s1 + s2 > 0) { a.values.set('PI (calc.)', s1 / (s1 + s2)); piN++; }
  }
  if (hiN) keys.set('HI (calc.)', { key: 'HI (calc.)', analType: 'RE', unit: 'mg HC/g TOC', count: hiN, derived: true });
  if (piN) keys.set('PI (calc.)', { key: 'PI (calc.)', analType: 'RE', unit: 'fraction of 1', count: piN, derived: true });
  const order = Object.keys(cat.analysisTypes);
  const sorted = [...keys.values()].sort((x, y) => (order.indexOf(x.analType) - order.indexOf(y.analType)) || (cat.parameters[x.key]?.sortKey ?? 9e9) - (cat.parameters[y.key]?.sortKey ?? 9e9));
  return { points: [...byAnal.values()], keys: sorted };
}

export interface SamplePoint {
  siteId: string;
  siteName: string;
  sampleId: string;
  depth: number | null;
  reference: boolean;
  values: Map<string, number>;
}

/** Joins results from different analyses of the same sample (mean when a key occurs more than once). */
export function samplePoints(points: AnalysisPoint[]): SamplePoint[] {
  const m = new Map<string, { sp: SamplePoint; sums: Map<string, [number, number]> }>();
  for (const a of points) {
    let e = m.get(a.sampleId);
    if (!e) {
      e = { sp: { siteId: a.siteId, siteName: a.siteName, sampleId: a.sampleId, depth: a.depth, reference: a.reference, values: new Map() }, sums: new Map() };
      m.set(a.sampleId, e);
    }
    for (const [k, v] of a.values) {
      const s = e.sums.get(k) ?? [0, 0];
      e.sums.set(k, [s[0] + v, s[1] + 1]);
    }
  }
  return [...m.values()].map(({ sp, sums }) => {
    for (const [k, [s, n]] of sums) sp.values.set(k, s / n);
    return sp;
  });
}

export interface GcGroup {
  id: string; // detector|peakProperty
  detector: string;
  peakProperty: string;
  analyses: string[];
}

export interface GcAnalysis {
  analId: string;
  label: string;
  groups: Map<string, { name: string; value: number; order: number }[]>;
}

/** GC results grouped by detector and peak property, kept in file order (chromatogram order). */
export function gcData(pf: ParsedFile): { analyses: GcAnalysis[]; groups: GcGroup[] } {
  const ix = buildIndex(pf);
  const analyses = new Map<string, GcAnalysis>();
  const groups = new Map<string, GcGroup>();
  for (const p of pf.params) {
    if (!p.analId || p.num === null || !p.detector || !p.peakProperty) continue;
    const c = ix.contextOfAnalysis(p.analId);
    if (c.analysis?.attrs.AnalType !== 'GC') continue;
    let a = analyses.get(p.analId);
    if (!a) {
      const depth = c.sample?.attrs.LDepth;
      const label = [p.analId, c.site?.attrs.SiteName, c.fraction?.attrs.FractionType, depth && depth !== 'UNKNOWN' ? `${depth} m` : null].filter(Boolean).join(', ');
      a = { analId: p.analId, label, groups: new Map() };
      analyses.set(p.analId, a);
    }
    const gid = `${p.detector}|${p.peakProperty}`;
    const list = a.groups.get(gid) ?? [];
    list.push({ name: p.name, value: p.num, order: Number(p.block) * 1e5 + p.order });
    a.groups.set(gid, list);
    const g = groups.get(gid) ?? { id: gid, detector: p.detector, peakProperty: p.peakProperty, analyses: [] };
    if (!g.analyses.includes(p.analId)) g.analyses.push(p.analId);
    groups.set(gid, g);
  }
  return { analyses: [...analyses.values()], groups: [...groups.values()].sort((x, y) => y.analyses.length - x.analyses.length) };
}
