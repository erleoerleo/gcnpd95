import { useMemo, useState } from 'react';
import type { Row } from '../core/flatten';

const PAGE = 250;

export function DataTable(props: {
  columns: string[];
  rows: Row[];
  units?: Record<string, string>;
  onLine?: (n: number) => void;
  label: string;
}) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ col: string; dir: 1 | -1 } | null>(null);
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let r = props.rows;
    if (needle) r = r.filter((row) => props.columns.some((c) => row[c] !== null && row[c] !== undefined && String(row[c]).toLowerCase().includes(needle)));
    if (sort) {
      const { col, dir } = sort;
      r = [...r].sort((a, b) => {
        const x = a[col];
        const y = b[col];
        if (x === null || x === undefined) return 1;
        if (y === null || y === undefined) return -1;
        const nx = typeof x === 'number' ? x : Number(x);
        const ny = typeof y === 'number' ? y : Number(y);
        if (!Number.isNaN(nx) && !Number.isNaN(ny) && String(x).trim() !== '' && String(y).trim() !== '') return (nx - ny) * dir;
        return String(x).localeCompare(String(y), undefined, { numeric: true }) * dir;
      });
    }
    return r;
  }, [props.rows, props.columns, q, sort]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const p = Math.min(page, pages - 1);
  const slice = filtered.slice(p * PAGE, (p + 1) * PAGE);
  const numericCol = useMemo(() => {
    const m: Record<string, boolean> = {};
    for (const c of props.columns) m[c] = props.rows.slice(0, 200).some((r) => typeof r[c] === 'number') || c === 'Line';
    return m;
  }, [props.columns, props.rows]);

  return (
    <div>
      <div className="toolbar">
        <input type="search" placeholder={`Search ${props.label.toLowerCase()}`} value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} aria-label={`Search ${props.label}`} />
        <span className="meta">
          {filtered.length.toLocaleString()} {filtered.length === props.rows.length ? 'rows' : `of ${props.rows.length.toLocaleString()} rows`}
        </span>
      </div>
      <div className="table-wrap">
        <table className="grid">
          <thead>
            <tr>
              {props.columns.map((c) => (
                <th
                  key={c}
                  onClick={() => setSort((s) => (s?.col === c ? (s.dir === 1 ? { col: c, dir: -1 } : null) : { col: c, dir: 1 }))}
                  aria-sort={sort?.col === c ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
                  title="Sort"
                >
                  {c}
                  {sort?.col === c ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                  {props.units?.[c] && <span className="unit">{props.units[c]}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slice.map((r, i) => (
              <tr key={i}>
                {props.columns.map((c) => {
                  const v = r[c];
                  if (c === 'Line' && props.onLine && typeof v === 'number')
                    return (
                      <td key={c} className="num">
                        <button className="linelink" onClick={() => props.onLine!(v)}>{v}</button>
                      </td>
                    );
                  if (v === null || v === undefined) return <td key={c} className="nil">–</td>;
                  return (
                    <td key={c} className={numericCol[c] ? 'num' : undefined} title={String(v).length > 40 ? String(v) : undefined}>
                      {String(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="pager">
          <button className="btn" disabled={p === 0} onClick={() => setPage(p - 1)}>Previous</button>
          <span>Page {p + 1} of {pages}</span>
          <button className="btn" disabled={p >= pages - 1} onClick={() => setPage(p + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}
