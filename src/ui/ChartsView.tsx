import { useMemo, useState } from 'react';
import type { ChartConfiguration, ChartDataset } from 'chart.js';
import type { Catalogue } from '../core/catalogue';
import { analysisPoints, gcData, samplePoints, type AnalysisPoint, type KeyInfo } from '../core/chartdata';
import type { ParsedFile } from '../core/types';
import { axis, baseOptions, ChartCanvas, POINT_STYLES, useTheme, type Theme } from './ChartCanvas';

type XY = { x: number; y: number; label: string };

const fmt = (v: number) => (Math.abs(v) >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : Number(v.toPrecision(4)).toString());

/** Stable colour/shape per site, in order of first appearance in the file. */
function siteStyles(parsed: ParsedFile, t: Theme) {
  const m = new Map<string, { color: string; shape: (typeof POINT_STYLES)[number]; name: string }>();
  parsed.sites.forEach((s, i) => {
    const id = s.attrs.SiteID ?? `#${i}`;
    m.set(id, { color: t.series[i % t.series.length], shape: POINT_STYLES[Math.floor(i / t.series.length) % POINT_STYLES.length], name: s.attrs.SiteName && s.attrs.SiteName !== 'UNKNOWN' ? s.attrs.SiteName : `${id}${s.attrs.SSComments ? ` (${s.attrs.SSComments})` : ''}` });
  });
  return m;
}

function scatterSets(groups: Map<string, XY[]>, styles: ReturnType<typeof siteStyles>, t: Theme): ChartDataset<'scatter', XY[]>[] {
  return [...groups.entries()].map(([site, data]) => {
    const st = styles.get(site) ?? { color: t.muted, shape: 'crossRot' as const, name: 'Not linked to a site' };
    return {
      type: 'scatter' as const,
      label: st.name,
      data,
      backgroundColor: st.color,
      borderColor: t.surface,
      borderWidth: 1.5,
      pointStyle: st.shape,
      pointRadius: 5,
      pointHoverRadius: 7,
    };
  });
}

export function ChartsView(props: { parsed: ParsedFile; catalogue: Catalogue }) {
  const { parsed, catalogue } = props;
  const t = useTheme();
  const [withRef, setWithRef] = useState(false);
  const data = useMemo(() => analysisPoints(parsed, catalogue), [parsed, catalogue]);
  const styles = useMemo(() => siteStyles(parsed, t), [parsed, t]);
  const points = useMemo(() => data.points.filter((p) => withRef || !p.reference), [data, withRef]);
  const hasRef = data.points.some((p) => p.reference);
  const re = points.filter((p) => p.analType === 'RE');

  if (!data.points.length) return <p className="note">The file contains no numeric results to plot.</p>;

  return (
    <section aria-label="Charts">
      {hasRef && (
        <label className="note" style={{ display: 'inline-flex', gap: 8, marginBottom: 18 }}>
          <input type="checkbox" checked={withRef} onChange={(e) => setWithRef(e.target.checked)} />
          Include reference samples (ADescription S)
        </label>
      )}
      {re.length > 0 && <RockEval points={re} styles={styles} t={t} />}
      <DepthTracks points={points} keys={data.keys} styles={styles} t={t} />
      <GcFingerprint parsed={parsed} t={t} />
      <CrossPlot points={points} keys={data.keys} styles={styles} t={t} />
    </section>
  );
}

function RockEval({ points, styles, t }: { points: AnalysisPoint[]; styles: ReturnType<typeof siteStyles>; t: Theme }) {
  const hiKey = points.some((p) => p.values.has('HI')) ? 'HI' : 'HI (calc.)';
  const configs = useMemo(() => {
    const tooltip = (ctx: { raw: unknown }) => (ctx.raw as XY).label;
    const hiT = new Map<string, XY[]>();
    const s2t = new Map<string, XY[]>();
    let maxToc = 0;
    let maxHi = 0;
    let tMin = 400;
    let tMax = 500;
    for (const p of points) {
      const lab = `Sample ${p.sampleId}${p.depth !== null ? ` at ${p.depth} m` : ''}, ${p.lithology || p.fractionType}`;
      const tmax = p.values.get('TMAX');
      const hi = p.values.get(hiKey);
      const toc = p.values.get('TOC');
      const s2 = p.values.get('S2');
      if (tmax !== undefined && hi !== undefined) {
        (hiT.get(p.siteId) ?? hiT.set(p.siteId, []).get(p.siteId)!).push({ x: tmax, y: hi, label: `${lab}: Tmax ${fmt(tmax)} °C, HI ${fmt(hi)}` });
        maxHi = Math.max(maxHi, hi);
        tMin = Math.min(tMin, tmax);
        tMax = Math.max(tMax, tmax);
      }
      if (toc !== undefined && s2 !== undefined) {
        (s2t.get(p.siteId) ?? s2t.set(p.siteId, []).get(p.siteId)!).push({ x: toc, y: s2, label: `${lab}: TOC ${fmt(toc)} wt%, S2 ${fmt(s2)} mg/g` });
        maxToc = Math.max(maxToc, toc);
      }
    }
    const guide = (data: { x: number; y: number }[], label: string): ChartDataset<'line', { x: number; y: number }[]> => ({
      type: 'line',
      label,
      data,
      borderColor: t.guide,
      borderWidth: 1,
      borderDash: [4, 4],
      pointRadius: 0,
      pointHitRadius: 0,
      fill: false,
    });
    const hiMax = Math.max(900, Math.ceil(maxHi / 100) * 100);
    const xLo = Math.floor((tMin - 5) / 20) * 20;
    const xHi = Math.ceil((tMax + 5) / 20) * 20;
    const kerogen: [number, string][] = [[600, 'Type I'], [300, 'Type II'], [200, 'Type II/III'], [50, 'Type III']];
    const hideGuidesInLegend = { labels: { ...baseOptions(t).plugins.legend.labels, filter: (i: { text: string }) => !i.text.startsWith('guide:') } };

    const tmaxCfg: ChartConfiguration = {
      type: 'scatter',
      data: {
        datasets: [
          ...kerogen.map(([hi, name]) => guide([{ x: xLo, y: hi }, { x: xHi, y: hi }], `guide:${name}`)),
          guide([{ x: 435, y: 0 }, { x: 435, y: hiMax }], 'guide:435'),
          guide([{ x: 470, y: 0 }, { x: 470, y: hiMax }], 'guide:470'),
          ...scatterSets(hiT, styles, t),
        ] as ChartDataset[],
      },
      options: {
        ...baseOptions(t),
        plugins: { ...baseOptions(t).plugins, legend: { ...baseOptions(t).plugins.legend, ...hideGuidesInLegend }, tooltip: { ...baseOptions(t).plugins.tooltip, filter: (i) => !String(i.dataset.label).startsWith('guide:'), callbacks: { label: tooltip } } },
        scales: { x: axis(t, 'Tmax (°C)', { min: xLo, max: xHi, ticks: { color: t.muted, padding: 6, stepSize: 20 } }), y: axis(t, `${hiKey} (mg HC/g TOC)`, { min: 0, max: hiMax }) },
      },
      plugins: [labelPlugin(t, [...kerogen.map(([hi, name]) => ({ x: xLo + 2, y: hi, text: `${name} above` })), { x: 437, y: hiMax * 0.97, text: 'oil window' }, { x: 472, y: hiMax * 0.97, text: 'gas' }])],
    };

    const tocMax = Math.max(2, Math.ceil(maxToc * 1.1));
    const hiLines: [number, string][] = [[600, 'HI 600'], [300, 'HI 300'], [200, 'HI 200'], [50, 'HI 50']];
    const s2Max = Math.max(...[...s2t.values()].flat().map((d) => d.y), 5) * 1.1;
    const s2Cfg: ChartConfiguration = {
      type: 'scatter',
      data: {
        datasets: [
          ...hiLines.map(([hi, name]) => guide([{ x: 0, y: 0 }, { x: tocMax, y: (hi * tocMax) / 100 }], `guide:${name}`)),
          ...scatterSets(s2t, styles, t),
        ] as ChartDataset[],
      },
      options: {
        ...baseOptions(t),
        plugins: { ...baseOptions(t).plugins, legend: { ...baseOptions(t).plugins.legend, ...hideGuidesInLegend }, tooltip: { ...baseOptions(t).plugins.tooltip, filter: (i) => !String(i.dataset.label).startsWith('guide:'), callbacks: { label: tooltip } } },
        scales: { x: axis(t, 'TOC (wt%)', { min: 0, max: tocMax }), y: axis(t, 'S2 (mg HC/g rock)', { min: 0, max: Math.ceil(s2Max) }) },
      },
      plugins: [labelPlugin(t, hiLines.map(([hi, name]) => {
        const xEnd = Math.min(tocMax, (s2Max * 100) / hi) * 0.92;
        return { x: xEnd, y: (hi * xEnd) / 100, text: name };
      }))],
    };
    return { tmaxCfg, s2Cfg };
  }, [points, styles, t, hiKey]);

  return (
    <div className="chart-section">
      <h3>Rock-Eval: kerogen type and maturity</h3>
      <p>
        Kerogen type boundaries after Peters and Cassa (1994); maturity windows at Tmax 435 and 470 °C.
        {hiKey === 'HI (calc.)' && ' HI is calculated as 100 × S2 / TOC because the file does not report it.'}
      </p>
      <div className="chart-row">
        <div className="chart-box"><h4>{hiKey} against Tmax</h4><ChartCanvas config={configs.tmaxCfg} label="Hydrogen index against Tmax" /></div>
        <div className="chart-box"><h4>S2 against TOC</h4><ChartCanvas config={configs.s2Cfg} label="S2 against TOC with hydrogen index lines" /></div>
      </div>
    </div>
  );
}

/** Draws small text labels at data coordinates (guide annotations). */
function labelPlugin(t: Theme, labels: { x: number; y: number; text: string }[]) {
  return {
    id: 'guideLabels',
    afterDatasetsDraw(chart: import('chart.js').Chart) {
      const { ctx, scales, chartArea } = chart;
      ctx.save();
      ctx.font = "11px 'Archivo', system-ui, sans-serif";
      ctx.fillStyle = t.muted;
      ctx.textBaseline = 'bottom';
      const drawn: { x0: number; x1: number; y0: number; y1: number }[] = [];
      for (const l of labels) {
        const px = scales.x.getPixelForValue(l.x);
        const py = scales.y.getPixelForValue(l.y);
        if (px < chartArea.left || px > chartArea.right || py < chartArea.top || py > chartArea.bottom) continue;
        const w = ctx.measureText(l.text).width;
        const box = { x0: px + 2, x1: px + 6 + w, y0: py - 14, y1: py };
        if (px + 2 + w > chartArea.right || drawn.some((d) => box.x0 < d.x1 && box.x1 > d.x0 && box.y0 < d.y1 && box.y1 > d.y0)) continue;
        drawn.push(box);
        ctx.fillText(l.text, px + 2, py - 2);
      }
      ctx.restore();
    },
  };
}

function KeySelect(props: { keys: KeyInfo[]; value: string; onChange: (v: string) => void; label: string; allowEmpty?: boolean }) {
  const byType = new Map<string, KeyInfo[]>();
  for (const k of props.keys) (byType.get(k.analType) ?? byType.set(k.analType, []).get(k.analType)!).push(k);
  return (
    <select className="input" value={props.value} onChange={(e) => props.onChange(e.target.value)} aria-label={props.label}>
      {props.allowEmpty && <option value="">None</option>}
      {[...byType.entries()].map(([type, ks]) => (
        <optgroup key={type} label={type}>
          {ks.map((k) => (
            <option key={k.key} value={k.key}>
              {k.key}{k.unit ? ` (${k.unit})` : ''}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

function DepthTracks({ points, keys, styles, t }: { points: AnalysisPoint[]; keys: KeyInfo[]; styles: ReturnType<typeof siteStyles>; t: Theme }) {
  const withDepth = points.filter((p) => p.depth !== null);
  const depthKeys = useMemo(() => keys.filter((k) => withDepth.some((p) => p.values.has(k.key))), [keys, withDepth]);
  const preferred = ['TOC', 'HI', 'HI (calc.)', 'TMAX', 'PopnMean #1', 'S2', 'd13C', 'S1'].filter((k) => depthKeys.some((d) => d.key === k));
  const initial = [...preferred, ...depthKeys.map((k) => k.key).filter((k) => !preferred.includes(k))].slice(0, 3);
  const [tracks, setTracks] = useState<string[]>(initial);
  const depthRange = useMemo(() => {
    const ds = withDepth.map((p) => p.depth!);
    if (!ds.length) return null;
    const min = Math.min(...ds);
    const max = Math.max(...ds);
    const span = Math.max(max - min, 10);
    const unit = Math.pow(10, Math.floor(Math.log10(span))) / 2;
    return { min: Math.max(0, Math.floor((min - span * 0.03) / unit) * unit), max: Math.ceil((max + span * 0.03) / unit) * unit };
  }, [withDepth]);

  const configs = useMemo(
    () =>
      tracks.map((key) => {
        const groups = new Map<string, XY[]>();
        for (const p of withDepth) {
          const v = p.values.get(key);
          if (v === undefined) continue;
          (groups.get(p.siteId) ?? groups.set(p.siteId, []).get(p.siteId)!).push({ x: v, y: p.depth!, label: `${p.siteName}, sample ${p.sampleId}, ${p.depth} m: ${fmt(v)}` });
        }
        const info = keys.find((k) => k.key === key);
        const cfg: ChartConfiguration = {
          type: 'scatter',
          data: { datasets: scatterSets(groups, styles, t) as ChartDataset[] },
          options: {
            ...baseOptions(t),
            plugins: { ...baseOptions(t).plugins, legend: { display: false }, tooltip: { ...baseOptions(t).plugins.tooltip, callbacks: { label: (c) => (c.raw as XY).label } } },
            scales: {
              x: axis(t, info?.unit ? `${key} (${info.unit})` : key, { position: 'top' }),
              y: axis(t, 'Depth (m below datum)', { reverse: true, min: depthRange?.min, max: depthRange?.max }),
            },
          },
        };
        return cfg;
      }),
    [tracks, withDepth, keys, styles, t, depthRange],
  );

  if (!withDepth.length || !depthKeys.length) return null;
  const sitesShown = [...new Set(withDepth.map((p) => p.siteId))];
  return (
    <div className="chart-section">
      <h3>Depth profile</h3>
      <p>Side-by-side tracks share the depth axis, like a composite log. Depth is the lower sample depth (LDepth) below each site's datum.</p>
      <div className="tracks">
        {tracks.map((key, i) => (
          <div className="track" key={i}>
            <div className="track-head">
              <KeySelect keys={depthKeys} value={key} label={`Track ${i + 1} parameter`} onChange={(v) => setTracks((ts) => ts.map((x, j) => (j === i ? v : x)))} />
              {tracks.length > 1 && (
                <button className="btn ghost" aria-label="Remove track" onClick={() => setTracks((ts) => ts.filter((_, j) => j !== i))}>Remove</button>
              )}
            </div>
            <ChartCanvas config={configs[i]} label={`${key} against depth`} />
          </div>
        ))}
      </div>
      <div className="toolbar" style={{ marginTop: 10 }}>
        {tracks.length < 6 && (
          <button className="btn" onClick={() => setTracks((ts) => [...ts, depthKeys.find((k) => !ts.includes(k.key))?.key ?? depthKeys[0].key])}>Add track</button>
        )}
        <Legend sites={sitesShown} styles={styles} />
      </div>
    </div>
  );
}

function Legend({ sites, styles }: { sites: string[]; styles: ReturnType<typeof siteStyles> }) {
  return (
    <span className="note" style={{ display: 'inline-flex', gap: 16, flexWrap: 'wrap' }}>
      {sites.map((s) => {
        const st = styles.get(s);
        return (
          <span key={s} style={{ display: 'inline-flex', gap: 6, alignItems: 'center', color: 'var(--ink)' }}>
            <i style={{ width: 9, height: 9, borderRadius: st?.shape === 'circle' ? '50%' : 1, background: st?.color, display: 'inline-block', transform: st?.shape === 'rectRot' ? 'rotate(45deg)' : undefined }} />
            {st?.name ?? s}
          </span>
        );
      })}
    </span>
  );
}

function GcFingerprint({ parsed, t }: { parsed: ParsedFile; t: Theme }) {
  const gc = useMemo(() => gcData(parsed), [parsed]);
  const [group, setGroup] = useState(gc.groups[0]?.id ?? '');
  const g = gc.groups.find((x) => x.id === group) ?? gc.groups[0];
  const [selected, setSelected] = useState<string[]>(() => (g ? g.analyses.slice(0, 2) : []));
  const [normalise, setNormalise] = useState(true);
  const avail = g ? g.analyses : [];
  const sel = selected.filter((a) => avail.includes(a));
  const active = sel.length ? sel : avail.slice(0, 1);

  const cfg = useMemo<ChartConfiguration | null>(() => {
    if (!g) return null;
    const names: string[] = [];
    const orderOf = new Map<string, number>();
    for (const id of active) {
      for (const r of gc.analyses.find((a) => a.analId === id)?.groups.get(g.id) ?? []) {
        if (!orderOf.has(r.name)) { orderOf.set(r.name, r.order); names.push(r.name); }
      }
    }
    names.sort((a, b) => orderOf.get(a)! - orderOf.get(b)!);
    const datasets = active.map((id, i) => {
      const rows = gc.analyses.find((a) => a.analId === id)?.groups.get(g.id) ?? [];
      const m = new Map(rows.map((r) => [r.name, r.value]));
      const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1e-12);
      const isIso = g.peakProperty === 'ISOTRATIO';
      return {
        label: gc.analyses.find((a) => a.analId === id)?.label ?? id,
        data: names.map((n) => (m.has(n) ? (normalise && !isIso ? (100 * m.get(n)!) / max : m.get(n)!) : null)),
        backgroundColor: t.series[i % t.series.length],
        borderRadius: 3,
        borderSkipped: 'start' as const,
        maxBarThickness: 18,
        categoryPercentage: 0.8,
        barPercentage: 0.92,
      };
    });
    const unit = g.peakProperty === 'ISOTRATIO' ? `${g.detector} (‰)` : normalise ? '% of largest peak' : g.peakProperty;
    return {
      type: 'bar',
      data: { labels: names, datasets },
      options: {
        ...baseOptions(t),
        plugins: { ...baseOptions(t).plugins, legend: { ...baseOptions(t).plugins.legend, display: active.length > 1 } },
        scales: { x: axis(t, '', { grid: { display: false }, ticks: { color: t.muted, autoSkip: false, maxRotation: 70, minRotation: 0 } }), y: axis(t, unit) },
      },
    };
  }, [g, active.join(), normalise, t, gc]);

  if (!g || !cfg) return null;
  return (
    <div className="chart-section">
      <h3>GC fingerprint</h3>
      <p>Compounds in the order they are reported, one detector and peak property at a time. Compare up to four analyses.</p>
      <div className="toolbar">
        <select className="input" value={g.id} onChange={(e) => { setGroup(e.target.value); setSelected([]); }} aria-label="Detector and peak property">
          {gc.groups.map((x) => (
            <option key={x.id} value={x.id}>
              {/^\d+$/.test(x.detector) ? `m/z ${x.detector}` : x.detector}, {x.peakProperty} ({x.analyses.length} {x.analyses.length === 1 ? 'analysis' : 'analyses'})
            </option>
          ))}
        </select>
        {g.peakProperty !== 'ISOTRATIO' && (
          <label className="note" style={{ display: 'inline-flex', gap: 6 }}>
            <input type="checkbox" checked={normalise} onChange={(e) => setNormalise(e.target.checked)} /> Normalise to largest peak
          </label>
        )}
      </div>
      <div className="filters" role="group" aria-label="Analyses">
        {avail.map((id) => {
          const on = active.includes(id);
          return (
            <button
              key={id}
              className="chip"
              aria-pressed={on}
              disabled={!on && active.length >= 4}
              onClick={() => setSelected(on ? active.filter((x) => x !== id) : [...active, id])}
              title={gc.analyses.find((a) => a.analId === id)?.label}
            >
              {id}
            </button>
          );
        })}
      </div>
      <div className="chart-box"><ChartCanvas config={cfg} label="GC fingerprint bar chart" /></div>
    </div>
  );
}

function CrossPlot({ points, keys, styles, t }: { points: AnalysisPoint[]; keys: KeyInfo[]; styles: ReturnType<typeof siteStyles>; t: Theme }) {
  const samples = useMemo(() => samplePoints(points), [points]);
  const sampleKeys = useMemo(() => keys.filter((k) => samples.filter((s) => s.values.has(k.key)).length >= 2), [keys, samples]);
  const best = useMemo(() => bestPair(samples, sampleKeys.map((k) => k.key)), [samples, sampleKeys]);
  const [x, setX] = useState(best[0]);
  const [y, setY] = useState(best[1]);
  const cfg = useMemo<ChartConfiguration>(() => {
    const groups = new Map<string, XY[]>();
    for (const s of samples) {
      const vx = s.values.get(x);
      const vy = s.values.get(y);
      if (vx === undefined || vy === undefined) continue;
      (groups.get(s.siteId) ?? groups.set(s.siteId, []).get(s.siteId)!).push({ x: vx, y: vy, label: `${s.siteName}, sample ${s.sampleId}${s.depth !== null ? ` (${s.depth} m)` : ''}: ${fmt(vx)}, ${fmt(vy)}` });
    }
    const ux = keys.find((k) => k.key === x)?.unit;
    const uy = keys.find((k) => k.key === y)?.unit;
    return {
      type: 'scatter',
      data: { datasets: scatterSets(groups, styles, t) as ChartDataset[] },
      options: {
        ...baseOptions(t),
        plugins: { ...baseOptions(t).plugins, tooltip: { ...baseOptions(t).plugins.tooltip, callbacks: { label: (c) => (c.raw as XY).label } } },
        scales: { x: axis(t, ux ? `${x} (${ux})` : x), y: axis(t, uy ? `${y} (${uy})` : y) },
      },
    };
  }, [samples, x, y, keys, styles, t]);
  if (sampleKeys.length < 2) return null;
  const n = samples.filter((s) => s.values.has(x) && s.values.has(y)).length;
  return (
    <div className="chart-section">
      <h3>Cross-plot by sample</h3>
      <p>Results from different analyses are matched on their sample. When a sample has several values for a parameter, the mean is plotted.</p>
      <div className="toolbar">
        <label className="note">X <KeySelect keys={sampleKeys} value={x} onChange={setX} label="X parameter" /></label>
        <label className="note">Y <KeySelect keys={sampleKeys} value={y} onChange={setY} label="Y parameter" /></label>
        <span className="meta">{n} {n === 1 ? 'sample' : 'samples'} with both values</span>
      </div>
      <div className="chart-box">
        {n === 0 ? <p className="note">No sample has both of these parameters. Pick another pair.</p> : <ChartCanvas config={cfg} label={`${y} against ${x}`} />}
      </div>
    </div>
  );
}

/** The pair of parameters measured together on most samples (Rock-Eval pairs preferred on ties). */
function bestPair(samples: { values: Map<string, number> }[], keys: string[]): [string, string] {
  const prefer = ['TOC', 'S2', 'TMAX', 'HI', 'HI (calc.)', 'd13C'];
  const cand = [...keys].sort((a, b) => (prefer.indexOf(a) + 1 || 99) - (prefer.indexOf(b) + 1 || 99)).slice(0, 30);
  let best: [string, string] = [cand[0] ?? '', cand[1] ?? ''];
  let bestN = -1;
  for (let i = 0; i < cand.length; i++)
    for (let j = i + 1; j < cand.length; j++) {
      const n = samples.filter((s) => s.values.has(cand[i]) && s.values.has(cand[j])).length;
      if (n > bestN) { bestN = n; best = [cand[i], cand[j]]; }
    }
  return best;
}
