import type { Issue, Level, ParsedFile } from '../core/types';
import { LEVEL_LABEL } from '../core/parser';

const COLOR: Record<Level | 'filedef', string> = {
  filedef: 'var(--e-filedef)',
  site: 'var(--e-site)',
  sample: 'var(--e-sample)',
  fraction: 'var(--e-fraction)',
  analysis: 'var(--e-analysis)',
  parameter: 'var(--e-parameter)',
};

/** A well-log style overview of the file: one interval per block, ticks where problems are. */
export function FileStrip(props: { parsed: ParsedFile; issues: Issue[]; onLine: (n: number) => void }) {
  const { parsed, issues } = props;
  const total = Math.max(parsed.lines.length, 1);
  const pct = (line: number) => ((line - 1) / total) * 100;
  const firstBlock = parsed.blocks[0]?.defLine ?? total;
  const segs = [
    { key: 'fd', label: 'File definition', from: 1, to: Math.max(1, firstBlock - 1), color: COLOR.filedef, id: '' },
    ...parsed.blocks.map((b, i) => ({
      key: b.id + i,
      label: `Block ${b.id}: ${b.comment || (b.level ? LEVEL_LABEL[b.level] : 'unknown')}`,
      from: b.defLine,
      to: Math.max(b.lastLine, b.defLine),
      color: b.level ? COLOR[b.level] : 'var(--error)',
      id: b.id,
    })),
  ];
  const ticks = issues.filter((i) => i.line && i.severity !== 'info');
  return (
    <aside className="strip" aria-label="File overview">
      <div className="strip-label">Blocks</div>
      <div className="strip-track">
        {segs.map((s) => {
          const h = Math.max(((s.to - s.from + 1) / total) * 100, 0.35);
          const tall = h > 2.2;
          return (
            <button
              key={s.key}
              className="strip-seg"
              style={{ top: `${pct(s.from)}%`, height: `calc(${h}% - 1px)`, background: s.color }}
              title={`${s.label} (lines ${s.from}-${s.to})`}
              aria-label={`${s.label}, lines ${s.from} to ${s.to}`}
              onClick={() => props.onLine(s.from)}
            >
              {tall && s.id && <span>{s.id}</span>}
            </button>
          );
        })}
        {ticks.map((t, i) => (
          <i key={i} className={`strip-tick ${t.severity}`} style={{ top: `${pct(t.line!)}%` }} />
        ))}
      </div>
      <div className="strip-legend" aria-hidden="true">
        {(['site', 'sample', 'fraction', 'analysis', 'parameter'] as Level[]).map((l) => (
          <i key={l} style={{ background: COLOR[l] }} title={LEVEL_LABEL[l]} />
        ))}
      </div>
    </aside>
  );
}
