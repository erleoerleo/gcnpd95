import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CATALOGUE } from '../src/core/defaultCatalogue';
import { decodeBytes, parseGcNpd95, splitRecord } from '../src/core/parser';
import { validate, checkLithology } from '../src/core/validator';
import { flatRows, toDelimited } from '../src/core/flatten';
import { toJson } from '../src/core/json';
import { parseList, withLists } from '../src/core/lists';
import { applyFixes, collectFixes } from '../src/core/fixer';
import { placePeaks, peakSigma, trace } from '../src/core/chromatogram';

const cat = DEFAULT_CATALOGUE;
const example = decodeBytes(readFileSync(new URL('../public/eksempelfil.txt', import.meta.url))).text.replace(/\r\n/g, '\n');

const run = (text: string, profile: 'sodir' | 'generic' = 'sodir', name = 'GCH_RAW.ASC') => {
  const pf = parseGcNpd95(text, name, cat);
  return { pf, ...validate(pf, cat, profile) };
};
const codes = (text: string, profile: 'sodir' | 'generic' = 'sodir') =>
  run(text, profile).issues.filter((i) => i.severity !== 'info').map((i) => i.code);
const sub = (from: string, to: string) => {
  expect(example.includes(from), `fixture contains ${from}`).toBe(true);
  return example.replace(from, to);
};

describe('tokenizer', () => {
  it('handles quotes, embedded quotes and empty fields', () => {
    const r = splitRecord('01,"a,b",,"say ""hi""", x ', ',');
    expect(r.fields).toEqual(['01', 'a,b', '', 'say "hi"', ' x ']);
    expect(r.problems).toEqual([]);
  });
  it('reports unterminated quotes', () => {
    expect(splitRecord('01,"abc', ',').problems.length).toBe(1);
  });
});

describe('example file', () => {
  it('has no errors or warnings in the Sodir profile', () => {
    const r = run(example);
    expect(r.counts.error).toBe(0);
    expect(r.counts.warning).toBe(0);
  });
  it('builds the full hierarchy', () => {
    const { pf } = run(example);
    expect([pf.sites.length, pf.samples.length, pf.fractions.length, pf.analyses.length]).toEqual([5, 10, 46, 64]);
    expect(pf.blocks).toHaveLength(26);
    expect(pf.params.find((p) => p.block === '05' && p.name === 'TMAX' && p.analId === '10100-02A14')).toBeUndefined();
    expect(pf.params.find((p) => p.block === '22' && p.detector === 'DELTA2H')?.value).toBe('-222.0');
  });
});

describe('broken variants', () => {
  const cases: [string, string, string, string][] = [
    ['wrong version', 'Version        2.0', 'Version        1.0', 'F07'],
    ['misaligned file definition', 'Contact        Ola Normann', 'Contact Ola Normann', 'F03'],
    ['missing mandatory DTJ attribute', 'Contact        Ola Normann\n', '', 'F06'],
    ['delimiter mismatch', 'Delimiter      COMMA', 'Delimiter      SEMICOLON', 'F08'],
    ['bad block definition', '00,DEFINE BLOCK,03,Fraction data', '00,DEFINE BLOK,03,Fraction data', 'F10'],
    ['duplicate block id', '00,DEFINE BLOCK,06,More Rock-Eval data', '00,DEFINE BLOCK,05,More Rock-Eval data', 'F11'],
    ['record for wrong block', '06,99101-01A01,2.27', '07,99101-01A01,2.27', 'F17'],
    ['too many values', '10,10202-02A54,17.4,18.7,27.6,36.3', '10,10202-02A54,17.4,18.7,27.6,36.3,99', 'F18'],
    ['unquoted delimiter text', '"turbodrilled 4000m-TD"', 'turbodrilled, 4000m-TD', 'F18'],
    ['unterminated quote', '"Poorly washed sample"', '"Poorly washed sample', 'F19'],
    ['decimal comma', '11,10100-04A04,-32.3', '11,10100-04A04,"-32,3"', 'F23'],
    ['bad date', 'TransferDate   15.06.1995', 'TransferDate   31.02.1995', 'F24'],
    ['undefined parent', '03,10101,F10101-01', '03,10109,F10101-01', 'M05'],
    ['duplicate id', '02,W101,10101,', '02,W101,10100,', 'M04'],
    ['missing mandatory value', '04,F10101-01,10101-01A21,RE,A,', '04,F10101-01,10101-01A21,RE,,', 'M03'],
    ['GC without detector', '13,10100-11A03,FID,NORMAREA', '13,10100-11A03,,NORMAREA', 'M08'],
    ['rock sample without lithology', '02,W102,10200,1567.23,1567.23,SWC,78665,S28365,CLYST', '02,W102,10200,1567.23,1567.23,SWC,78665,S28365,', 'M15'],
    ['unknown parameter', 'L1,TOCEOM', 'L1,TOCEOMX', 'D02'],
    ['parameter of wrong analysis type', 'L1,d13C', 'L1,TOC', 'D03'],
    ['illegal code', '03,10100,F10100-01,90001-01,SDUN', '03,10100,F10100-01,90001-01,SDUX', 'D04'],
    ['non numeric value', '08,10100-01A02,2.22,5.704,91.3', '08,10100-01A02,2.22,abc,91.3', 'D05'],
    ['out of range', '06,99201-01A01,11.81', '06,99201-01A01,111.81', 'D06'],
    ['bad lithology', '03,10200,F10200-04,78665-04,SDUN,CLYST (DK GY)', '03,10200,F10200-04,78665-04,SDUN,CLYST (DARK GY)', 'D08'],
    ['case sensitivity', 'L1,FracRefNumber', 'L1,FracRefnumber', 'D09'],
    ['unknown well', '6407/7-A-18 H', '6407/7-A-99 H', 'S01'],
    ['unknown sender', 'Sender         STATOIL', 'Sender         ACME', 'S03'],
    ['attribute from wrong entity', 'L1,FComments', 'L1,SComments', 'M01'],
    ['missing terminator at end', '26,10202-07A61,DELTA13C,ISOTRATIO,-27.8,-27.3,-27.9,-26.8,-27.5,-27.4,-28.1,-26.9,-27.4,-27.8,-27.2,-27.4,-27.6,-28.2,-27.6,-27.3,-27.6,-27.1,-26.9,-27.3,-27.7,-27.3\n-----', '26,10202-07A61,DELTA13C,ISOTRATIO,-27.8', 'F12'],
  ];
  for (const [name, from, to, code] of cases) {
    it(`${name} -> ${code}`, () => {
      expect(codes(sub(from, to))).toContain(code);
    });
  }

  it('suggests the registered well name for a sloppy spelling', () => {
    const r = run(sub('6407/7-A-18 H', '6407/07-A-18H'));
    expect(r.issues.find((i) => i.code === 'S01')?.hint).toContain('6407/7-A-18 H');
  });

  it('downgrades Sodir-specific checks in the generic profile', () => {
    const t = sub('6407/7-A-18 H', '6407/7-A-99 H');
    expect(run(t, 'sodir').counts.error).toBeGreaterThan(0);
    expect(run(t, 'generic').counts.error).toBe(0);
  });

  it('recovers from a file without file definition block', () => {
    const t = example.slice(example.indexOf('// Record Definition Block 01'));
    const r = run(t);
    expect(r.issues.map((i) => i.code)).toContain('F02');
    expect(r.pf.samples.length).toBe(10);
  });

  it('accepts TAB and SEMICOLON delimited files', () => {
    for (const [name, d] of [['TAB', '\t'], ['SEMICOLON', ';']] as const) {
      const lines = example.split(/\r?\n/);
      const conv = lines.map((l) => {
        if (l.startsWith('//') || !/^(\d\d|L\d),/.test(l)) return l;
        return splitRecord(l, ',').fields.map((f) => (f.includes(d) || f.includes(';') ? `"${f}"` : f)).join(d);
      });
      const t = conv.join('\n').replace('Delimiter      COMMA', `Delimiter      ${name}`);
      const r = run(t);
      expect(r.counts.error, name).toBe(0);
      expect(r.pf.params.length).toBe(run(example).pf.params.length);
    }
  });
});

describe('lithology syntax', () => {
  it('accepts the spec examples', () => {
    for (const s of ['CLYST / SLST (LAM)', 'CLYST (SLTY)', 'SST (SIL, CMT)', 'CLYST (LT GY) / CLYST (DK GY)', 'SST (CGR, RD) / SST (FGR, LT GY) / ADD'])
      expect(checkLithology(s, cat, false), s).toEqual([]);
  });
  it('accepts BULK for samples (as Sodir does) but rejects unknown codes', () => {
    expect(checkLithology('BULK', cat, false)).toEqual([]);
    expect(checkLithology('BULK', cat, true)).toEqual([]);
    expect(checkLithology('CLAY (GREY)', cat, false).length).toBe(2);
  });
});

describe('flattening', () => {
  it('produces one row per result with full context', () => {
    const { pf } = run(example);
    const rows = flatRows(pf, cat);
    expect(rows.length).toBe(pf.params.length);
    const r = rows.find((x) => x.AnalID === '10100-01A01' && x.ParamName === 'TOC')!;
    expect(r.SiteName).toBe('6407/7-A-18 H');
    expect(r.LDepth).toBe(1237);
    expect(r.Unit).toBe('wt%');
    const txt = toDelimited([{ a: 'x;y', b: 'z' }], ['a', 'b'], ';');
    expect(txt).toBe('a;b\r\n"x;y";z\r\n');
  });
});

describe('json export', () => {
  it('nests the full hierarchy and keeps every result', () => {
    const { pf, ...res } = run(example);
    const j = toJson(pf, cat, { layout: 'nested', validation: true }, { result: res, profile: 'sodir' }) as any;
    expect(j.transferJob.TransferID).toBe('9501051728');
    expect(j.sites).toHaveLength(5);
    const re = j.sites[0].samples[0].fractions[0].analyses[0];
    expect(re.AnalID).toBe('10100-01A01');
    expect(re.results[0]).toEqual({ ParamName: 'TOC', ParamValue: 3.36, Unit: 'wt%', PComments: 'TOC from RE' });
    const count = (o: any): number => (Array.isArray(o) ? o.reduce((a, x) => a + count(x), 0) : o && typeof o === 'object' ? (o.ParamName !== undefined ? 1 : 0) + Object.values(o).reduce((a: number, x) => a + count(x), 0) : 0);
    expect(count(j.sites)).toBe(pf.params.length);
    expect(j.unlinked).toBeUndefined();
    expect(j.validation.errors).toBe(0);
  });
  it('keeps records with a missing parent under "unlinked"', () => {
    const { pf } = run(sub('03,10101,F10101-01', '03,10109,F10101-01'));
    const j = toJson(pf, cat, { layout: 'nested', validation: false }) as any;
    expect(j.unlinked.fractions[0].FractionID).toBe('F10101-01');
    expect(j.unlinked.fractions[0].analyses[0].results.length).toBeGreaterThan(0);
  });
  it('flat layout has one object per result', () => {
    const { pf } = run(example);
    const j = toJson(pf, cat, { layout: 'flat', validation: false }) as any;
    expect(j.results).toHaveLength(pf.params.length);
    expect(j.results[0].SiteName).toBe('6407/7-A-18 H');
  });
});

describe('approved lists', () => {
  it('uses data/wellbores.txt and data/companies.txt', () => {
    expect(cat.sources).toEqual({ wellbores: 'data/wellbores.txt', companies: 'data/companies.txt' });
    expect(Object.keys(cat.lookups['11']).length).toBeGreaterThan(8000);
    expect(Object.keys(cat.lookups['3']).length).toBeGreaterThan(1000);
  });
  it('accepts a well that is only in the approved list', () => {
    const recent = Object.keys(cat.lookups['11']).find((w) => w.startsWith('6406/') && !example.includes(w))!;
    expect(codes(sub('6407/7-A-18 H', recent))).not.toContain('S01');
  });
  it('rejects an unapproved laboratory and suggests approved names', () => {
    const r = run(sub('04,F10101-01,10101-01A21,RE,A,GEOLABNOR', '04,F10101-01,10101-01A21,RE,A,Equinor'));
    const i = r.issues.find((x) => x.code === 'S04')!;
    expect(i.severity).toBe('error');
    expect(i.hint).toContain('EQUINOR ASA');
    expect(run(sub('04,F10101-01,10101-01A21,RE,A,GEOLABNOR', '04,F10101-01,10101-01A21,RE,A,Equinor'), 'generic').issues.find((x) => x.code === 'S04')!.severity).toBe('warning');
  });
  it('parses lists with BOM, CRLF, blanks and duplicates', () => {
    expect(parseList('﻿A\r\n\r\n B \nA\n')).toEqual(['A', 'B']);
    const c = withLists(cat, { wellbores: { names: ['X/1-1'], source: 'mine.txt' } });
    expect(Object.keys(c.lookups['11'])).toEqual(['X/1-1']);
    expect(c.sources?.wellbores).toBe('mine.txt');
    expect(c.lookups['3']).toBe(cat.lookups['3']);
  });
});

// Real files accepted by the official Sodir validator can be put in data/test (kept out of the
// repository if they are confidential). Every one of them must validate without errors.
describe('files accepted by the official Sodir validator (data/test)', () => {
  const dir = new URL('../data/test/', import.meta.url);
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => /\.(txt|asc)$/i.test(f)) : [];
  it.skipIf(files.length > 0)('no files in data/test (skipped)', () => {});
  for (const f of files) {
    it(`${f} has no errors`, () => {
      const { text, encoding } = decodeBytes(readFileSync(new URL(encodeURIComponent(f), dir)));
      const pf = parseGcNpd95(text, 'GCH_RAW.ASC', cat, encoding);
      const errors = validate(pf, cat, 'sodir').issues.filter((i) => i.severity === 'error');
      expect(errors.map((e) => `${e.code} line ${e.line}: ${e.message}`)).toEqual([]);
    });
  }
});

describe('automatic fixes', () => {
  const broken = example
    .replace(/\n-----\n$/, '\n')
    .replace('Contact        Ola Normann', 'Contact Ola Normann')
    .replace('6407/7-A-18 H', '6407/07-A-18H')
    .replace('04,F10101-01,10101-01A21,RE,A,GEOLABNOR', '04,F10101-01,10101-01A21,RE,A,GeolabNor')
    .replace('04,F10101-02,10101-02A22,RE,A,GEOLABNOR', '04,F10101-02,10101-02A22,RE,A,Equinor')
    .replace('11,10100-04A04,-32.3', '11,10100-04A04,"-32,3"')
    .replace('03,10100,F10100-01,90001-01,SDUN', '03,10100,F10100-01,90001-01,sdun');

  it('finds one fix per problem', () => {
    const groups = collectFixes(run(broken).issues);
    const byCode = Object.fromEntries(groups.map((g) => [g.code + ':' + (g.from ?? ''), g]));
    expect(byCode['F12:'].choices).toEqual(['-----']);
    expect(byCode['S01:6407/07-A-18H']).toMatchObject({ choices: ['6407/7-A-18 H'], confident: true });
    expect(byCode['S04:GeolabNor']).toMatchObject({ choices: ['GEOLABNOR'], confident: true });
    expect(byCode['S04:Equinor'].confident).toBe(false);
    expect(byCode['S04:Equinor'].choices).toContain('EQUINOR ASA');
    expect(byCode['F23:-32,3'].choices).toEqual(['-32.3']);
    expect(byCode['D09:sdun'].choices).toEqual(['SDUN']);
  });

  it('produces a file without errors when the fixes are applied', () => {
    const r = run(broken);
    const groups = collectFixes(r.issues);
    const fixed = applyFixes(broken, ',', groups.map((g) => ({ group: g, value: g.from === 'Equinor' ? 'EQUINOR ASA' : undefined })));
    const after = run(fixed);
    expect(after.issues.filter((i) => i.severity === 'error').map((i) => `${i.code} ${i.message}`)).toEqual([]);
    expect(fixed.endsWith('-----\n')).toBe(true);
    expect(fixed).toContain('Contact        Ola Normann');
    expect(fixed).toContain(',6407/7-A-18 H,');
    expect(fixed).toContain('04,F10101-02,10101-02A22,RE,A,EQUINOR ASA,');
    expect(fixed).toContain('11,10100-04A04,-32.3');
    // untouched lines keep their exact text, including quoting
    expect(fixed).toContain('L2,"80% Claystone, dkgy, laminated; 20% Sandstone, lt gy, fine-grained"');
  });

  it('inserts a missing terminator between blocks and keeps CRLF line endings', () => {
    const t = example.replace('08,10100-01A02,2.22,5.704,91.3\n-----\n', '08,10100-01A02,2.22,5.704,91.3\n').replace(/\n/g, '\r\n');
    const groups = collectFixes(run(t).issues);
    expect(groups.map((g) => g.code)).toContain('F12');
    const fixed = applyFixes(t, ',', groups.map((g) => ({ group: g })));
    expect(fixed).toContain('08,10100-01A02,2.22,5.704,91.3\r\n-----\r\n00,DEFINE BLOCK,09');
    expect(run(fixed).counts.error).toBe(0);
  });
});

describe('reconstructed chromatogram', () => {
  it('places n-alkanes and isoprenoids at retention indices, even when reported at the end', () => {
    const { peaks, axis } = placePeaks(['nC15', 'nC16', 'nC17', 'nC18', 'Pristane', 'Phytane']);
    expect(axis).toBe('retention');
    expect(Object.fromEntries(peaks.map((p) => [p.name, p.x]))).toEqual({ nC15: 1500, nC16: 1600, nC17: 1700, nC18: 1800, Pristane: 1707, Phytane: 1811 });
  });
  it('spaces biomarkers in reported order and interpolates unknowns between anchors', () => {
    expect(placePeaks(['27Ts', '27Tm', '30ab']).axis).toBe('order');
    const p = placePeaks(['nC6', 'MCyC5', 'Benzene', 'Foo', 'nC7']).peaks;
    expect(p[3].x).toBeGreaterThan(654);
    expect(p[3].x).toBeLessThan(700);
  });
  it('keeps neighbouring peaks resolved', () => {
    const xs = [1700, 1707, 1800, 1811];
    const s = peakSigma(xs);
    const tr = trace(xs.map((x) => ({ x, h: 100 })), s, [1650, 1850]);
    const between = tr.filter((q) => q.x > 1702 && q.x < 1705);
    expect(Math.min(...between.map((q) => q.y))).toBeLessThan(60);
  });
});
