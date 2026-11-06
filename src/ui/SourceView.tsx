import { useEffect, useMemo, useRef, useState } from 'react';
import type { Issue, ParsedFile, Severity } from '../core/types';

const ROW = 21;
const rank: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

export function SourceView(props: { parsed: ParsedFile; issues: Issue[]; focus: { line: number; n: number } | null }) {
  const { parsed, issues } = props;
  const box = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState(0);
  const [height, setHeight] = useState(600);
  const [sel, setSel] = useState<number | null>(props.focus?.line ?? null);
  const [onlyProblems, setOnlyProblems] = useState(false);

  const byLine = useMemo(() => {
    const m = new Map<number, Issue[]>();
    for (const i of issues) if (i.line) (m.get(i.line) ?? m.set(i.line, []).get(i.line)!).push(i);
    return m;
  }, [issues]);

  const visibleLines = useMemo(
    () => (onlyProblems ? parsed.lines.filter((l) => byLine.get(l.no)?.some((i) => i.severity !== 'info')) : parsed.lines),
    [onlyProblems, parsed.lines, byLine],
  );

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!props.focus || !box.current) return;
    setOnlyProblems(false);
    setSel(props.focus.line);
    const top = (props.focus.line - 1) * ROW - box.current.clientHeight / 3;
    box.current.scrollTop = Math.max(0, top);
  }, [props.focus]);

  const problemLines = useMemo(() => [...byLine.entries()].filter(([, l]) => l.some((i) => i.severity !== 'info')).map(([n]) => n).sort((a, b) => a - b), [byLine]);
  const jump = (dir: 1 | -1) => {
    const cur = sel ?? 0;
    const next = dir === 1 ? problemLines.find((n) => n > cur) : [...problemLines].reverse().find((n) => n < cur);
    if (next && box.current) {
      setOnlyProblems(false);
      setSel(next);
      box.current.scrollTop = Math.max(0, (next - 1) * ROW - box.current.clientHeight / 3);
    }
  };

  const first = Math.max(0, Math.floor(scroll / ROW) - 20);
  const last = Math.min(visibleLines.length, Math.ceil((scroll + height) / ROW) + 20);
  const selIssues = sel ? byLine.get(sel) ?? [] : [];

  return (
    <section aria-label="Source">
      <div className="toolbar">
        <button className="btn" onClick={() => jump(-1)} disabled={!problemLines.length}>Previous problem</button>
        <button className="btn" onClick={() => jump(1)} disabled={!problemLines.length}>Next problem</button>
        <label className="note" style={{ display: 'inline-flex', gap: 6 }}>
          <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> Only lines with problems
        </label>
        <span className="meta">
          Delimiter {parsed.delimiter === '\t' ? 'TAB' : parsed.delimiter === ';' ? 'semicolon' : parsed.delimiter === ',' ? 'comma' : 'unknown'}, {parsed.encoding}, {problemLines.length} lines with errors or warnings
        </span>
      </div>
      <div className="source" ref={box} onScroll={(e) => setScroll(e.currentTarget.scrollTop)} tabIndex={0} aria-label="File contents">
        <div style={{ height: visibleLines.length * ROW, position: 'relative', minWidth: 'max-content' }}>
          {visibleLines.slice(first, last).map((l, k) => {
            const iss = byLine.get(l.no);
            const worst = iss?.reduce((a, b) => (rank[b.severity] < rank[a.severity] ? b : a)).severity;
            return (
              <div
                key={l.no}
                className={`src-line k-${l.kind}${sel === l.no ? ' sel' : ''}`}
                style={{ top: (first + k) * ROW }}
                onClick={() => setSel(l.no)}
              >
                <span className="no">{l.no}</span>
                <span className="gut">{worst && <i className={worst} />}</span>
                <span className="txt">{l.text.replace(/\t/g, '→   ') || ' '}</span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="line-issues" aria-live="polite">
        {sel === null ? (
          <p className="note">Select a line to see its problems. Coloured dots mark lines with errors, warnings or notes.</p>
        ) : selIssues.length === 0 ? (
          <p className="note">Line {sel}: no problems.</p>
        ) : (
          selIssues.map((i, k) => (
            <div key={k} className={`iss ${i.severity}`}>
              <strong>{i.code}</strong> {i.message}
              {i.hint && <div className="note">{i.hint}</div>}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
