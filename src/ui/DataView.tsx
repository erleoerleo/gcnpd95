import { useMemo, useState } from 'react';
import type { Catalogue } from '../core/catalogue';
import { entityTable, FLAT_COLUMNS, flatRows, wideTables } from '../core/flatten';
import type { EntityRow, ParsedFile } from '../core/types';
import { DataTable } from './Table';

type View = 'tree' | 'sites' | 'samples' | 'fractions' | 'analyses' | 'results' | `wide:${string}` | 'filedef';

export function DataView(props: { parsed: ParsedFile; catalogue: Catalogue; onLine: (n: number) => void }) {
  const { parsed, catalogue } = props;
  const [view, setView] = useState<View>('tree');
  const wide = useMemo(() => wideTables(parsed, catalogue), [parsed, catalogue]);
  const flat = useMemo(() => flatRows(parsed, catalogue), [parsed, catalogue]);

  const views: [View, string][] = [
    ['tree', 'Hierarchy'],
    ['filedef', 'Transfer job'],
    ['sites', `Sites (${parsed.sites.length})`],
    ['samples', `Samples (${parsed.samples.length})`],
    ['fractions', `Fractions (${parsed.fractions.length})`],
    ['analyses', `Analyses (${parsed.analyses.length})`],
    ['results', `All results (${parsed.params.length})`],
    ...wide.map((w) => [`wide:${w.analType}`, `${w.analType} table`] as [View, string]),
  ];

  let body: React.ReactNode = null;
  const ent = (rows: EntityRow[], label: string) => {
    const t = entityTable(rows, catalogue);
    return <DataTable key={label} columns={t.columns} rows={t.rows} onLine={props.onLine} label={label} />;
  };
  if (view === 'tree') body = <Tree parsed={parsed} />;
  else if (view === 'filedef')
    body = (
      <DataTable
        key="fd"
        label="Transfer job"
        columns={['Attribute', 'Value', 'Line']}
        rows={parsed.fileDef.map((e) => ({ Attribute: e.name, Value: e.value, Line: e.line }))}
        onLine={props.onLine}
      />
    );
  else if (view === 'sites') body = ent(parsed.sites, 'Sites');
  else if (view === 'samples') body = ent(parsed.samples, 'Samples');
  else if (view === 'fractions') body = ent(parsed.fractions, 'Fractions');
  else if (view === 'analyses') body = ent(parsed.analyses, 'Analyses');
  else if (view === 'results') body = <DataTable key="flat" columns={FLAT_COLUMNS} rows={flat} onLine={props.onLine} label="Results" />;
  else {
    const w = wide.find((x) => `wide:${x.analType}` === view);
    if (w) {
      const desc = catalogue.analysisTypes[w.analType]?.comment;
      body = (
        <>
          {desc && <p className="note" style={{ marginTop: 0 }}>{w.analType}: {desc}</p>}
          <DataTable key={view} columns={w.columns} rows={w.rows} units={w.units} label={`${w.analType} results`} />
        </>
      );
    }
  }

  return (
    <section aria-label="Data">
      <div className="subnav" role="group" aria-label="Table">
        {views.map(([id, label]) => (
          <button key={id} className="chip" aria-pressed={view === id} onClick={() => setView(id)}>{label}</button>
        ))}
      </div>
      {body}
    </section>
  );
}

function Tree({ parsed }: { parsed: ParsedFile }) {
  const model = useMemo(() => {
    const group = (rows: EntityRow[], key: string) => {
      const m = new Map<string, EntityRow[]>();
      for (const r of rows) {
        const k = r.attrs[key] ?? '';
        (m.get(k) ?? m.set(k, []).get(k)!).push(r);
      }
      return m;
    };
    const paramCount = new Map<string, number>();
    for (const p of parsed.params) if (p.analId) paramCount.set(p.analId, (paramCount.get(p.analId) ?? 0) + 1);
    return {
      samples: group(parsed.samples, 'SiteID'),
      fractions: group(parsed.fractions, 'SampleID'),
      analyses: group(parsed.analyses, 'FractionID'),
      paramCount,
    };
  }, [parsed]);
  const many = parsed.samples.length > 60;
  const k = (c: string) => <span className="k" style={{ background: `var(--e-${c})` }} />;
  return (
    <div className="tree">
      {many && <p className="note">Large file: sites are collapsed. Open a site to see its samples.</p>}
      {parsed.sites.map((s, i) => {
        const samples = model.samples.get(s.attrs.SiteID ?? '') ?? [];
        return (
          <details key={i} open={!many}>
            <summary>
              {k('site')}<strong>{s.attrs.SiteName ?? s.attrs.SiteID}</strong>
              <span className="sub">{[s.attrs.SiteID, s.attrs.Country, s.attrs.SiteType, s.attrs.SSComments].filter(Boolean).join(', ')}</span>
            </summary>
            {samples.map((sm, j) => {
              const fr = model.fractions.get(sm.attrs.SampleID ?? '') ?? [];
              const depth = sm.attrs.UDepth === sm.attrs.LDepth ? sm.attrs.LDepth : `${sm.attrs.UDepth}–${sm.attrs.LDepth}`;
              return (
                <details key={j}>
                  <summary>
                    {k('sample')}Sample {sm.attrs.SampleID}
                    <span className="sub">{[sm.attrs.SampleType, depth && `${depth} m`, sm.attrs.SLithology, sm.attrs.OpRefNumber].filter(Boolean).join(', ')}</span>
                  </summary>
                  {fr.map((f, n) => {
                    const an = model.analyses.get(f.attrs.FractionID ?? '') ?? [];
                    return (
                      <details key={n}>
                        <summary>
                          {k('fraction')}Fraction {f.attrs.FractionID}
                          <span className="sub">{[f.attrs.FractionType, f.attrs.FLithology, f.attrs.FComments].filter(Boolean).join(', ')}</span>
                        </summary>
                        {an.length === 0 && <div className="leaf note">No analyses</div>}
                        {an.map((a, m) => (
                          <div className="leaf" key={m}>
                            {k('analysis')}{a.attrs.AnalType} {a.attrs.AnalID}
                            <span className="sub">
                              {[a.attrs.ADescription === 'S' ? 'reference sample' : null, a.attrs.ALaboratory, `${model.paramCount.get(a.attrs.AnalID ?? '') ?? 0} results`].filter(Boolean).join(', ')}
                            </span>
                          </div>
                        ))}
                      </details>
                    );
                  })}
                </details>
              );
            })}
          </details>
        );
      })}
    </div>
  );
}
