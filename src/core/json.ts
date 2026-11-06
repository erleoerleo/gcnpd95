import type { Catalogue } from './catalogue';
import { flatRows, numify, unitFor } from './flatten';
import { RULE_BY_CODE, type Profile } from './rules';
import type { EntityRow, ParamRow, ParsedFile } from './types';
import type { ValidationResult } from './validator';

export interface JsonOptions {
  layout: 'nested' | 'flat';
  validation: boolean;
}

type Obj = Record<string, unknown>;

const NUMERIC_ATTRS = new Set(['UDepth', 'LDepth', 'DatumElevation', 'SSLatitude', 'SSLongitude', 'SLatitude', 'SLongitude']);
const DELIM_NAME: Record<string, string> = { ',': 'COMMA', ';': 'SEMICOLON', '\t': 'TAB' };

/** Entity attributes with the GC-NPD-95 names; depths and coordinates as numbers. */
const attrs = (r: EntityRow): Obj => {
  const o: Obj = {};
  for (const [k, v] of Object.entries(r.attrs)) o[k] = NUMERIC_ATTRS.has(k) ? numify(v) : v;
  return o;
};

const result = (p: ParamRow, cat: Catalogue): Obj => {
  const o: Obj = { ParamName: p.name, ParamValue: p.num ?? p.value };
  if (p.detector) o.Detector = p.detector;
  if (p.peakProperty) o.PeakProperty = p.peakProperty;
  if (p.popnNum) o.PopnNum = numify(p.popnNum);
  const unit = unitFor(p, cat);
  if (unit) o.Unit = unit;
  if (p.comment) o.PComments = p.comment;
  return o;
};

function groupBy<T>(rows: T[], key: (r: T) => string | null | undefined): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r) ?? '';
    (m.get(k) ?? m.set(k, []).get(k)!).push(r);
  }
  return m;
}

/**
 * The file as JSON. "nested" follows the GC-NPD-95 data model
 * (transfer job > sites > samples > fractions > analyses > results);
 * "flat" has one object per result with its full context.
 * Records whose parent is missing are kept under "unlinked", so no data is lost.
 */
export function toJson(pf: ParsedFile, cat: Catalogue, opts: JsonOptions, validation?: { result: ValidationResult; profile: Profile }): Obj {
  const transferJob: Obj = {};
  for (const e of pf.fileDef) transferJob[e.name] = e.value;

  const out: Obj = {
    source: { fileName: pf.fileName, encoding: pf.encoding, delimiter: pf.delimiter ? DELIM_NAME[pf.delimiter] ?? pf.delimiter : null },
    transferJob,
  };

  if (opts.layout === 'flat') {
    out.results = flatRows(pf, cat).map(({ Block: _b, Line: _l, ...rest }) => rest);
  } else {
    const samplesBySite = groupBy(pf.samples, (r) => r.attrs.SiteID);
    const fractionsBySample = groupBy(pf.fractions, (r) => r.attrs.SampleID);
    const analysesByFraction = groupBy(pf.analyses, (r) => r.attrs.FractionID);
    const resultsByAnalysis = groupBy(pf.params, (p) => p.analId);
    const used = { samples: new Set<EntityRow>(), fractions: new Set<EntityRow>(), analyses: new Set<EntityRow>(), results: new Set<string>() };

    const analysisObj = (a: EntityRow): Obj => {
      used.analyses.add(a);
      const id = a.attrs.AnalID ?? '';
      used.results.add(id);
      return { ...attrs(a), results: (resultsByAnalysis.get(id) ?? []).map((p) => result(p, cat)) };
    };
    const fractionObj = (f: EntityRow): Obj => {
      used.fractions.add(f);
      return { ...attrs(f), analyses: (analysesByFraction.get(f.attrs.FractionID ?? '') ?? []).map(analysisObj) };
    };
    const sampleObj = (s: EntityRow): Obj => {
      used.samples.add(s);
      return { ...attrs(s), fractions: (fractionsBySample.get(s.attrs.SampleID ?? '') ?? []).map(fractionObj) };
    };
    out.sites = pf.sites.map((s) => ({ ...attrs(s), samples: (samplesBySite.get(s.attrs.SiteID ?? '') ?? []).map(sampleObj) }));

    // Anything that could not be attached to a parent
    const unlinked: Obj = {};
    // (each step marks its children as used, so they are listed once, under their nearest parent)
    const lostSamples = pf.samples.filter((r) => !used.samples.has(r));
    if (lostSamples.length) unlinked.samples = lostSamples.map(sampleObj);
    const lostFractions = pf.fractions.filter((r) => !used.fractions.has(r));
    if (lostFractions.length) unlinked.fractions = lostFractions.map(fractionObj);
    const lostAnalyses = pf.analyses.filter((r) => !used.analyses.has(r));
    if (lostAnalyses.length) unlinked.analyses = lostAnalyses.map(analysisObj);
    const lostResults = pf.params.filter((p) => !used.results.has(p.analId ?? ''));
    if (lostResults.length) unlinked.results = lostResults.map((p) => ({ AnalID: p.analId, ...result(p, cat) }));
    if (Object.keys(unlinked).length) out.unlinked = unlinked;
  }

  if (opts.validation && validation) {
    const { result: r, profile } = validation;
    out.validation = {
      profile: profile === 'sodir' ? 'Sodir (Norway)' : 'Generic',
      catalogue: cat.source,
      errors: r.counts.error,
      warnings: r.counts.warning,
      notes: r.counts.info,
      issues: r.issues.map((i) => ({
        severity: i.severity,
        code: i.code,
        check: RULE_BY_CODE[i.code]?.title,
        line: i.line ?? null,
        message: i.message,
        ...(i.hint ? { hint: i.hint } : {}),
      })),
    };
  }
  return out;
}
