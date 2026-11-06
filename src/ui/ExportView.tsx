import { useMemo, useState } from 'react';
import type { Catalogue } from '../core/catalogue';
import { buildWorkbook, download, latin1, type ExcelOptions } from '../core/excel';
import { entityTable, FLAT_COLUMNS, flatRows, toDelimited, wideTables } from '../core/flatten';
import { toJson, type JsonOptions } from '../core/json';
import { RULE_BY_CODE, type Profile } from '../core/rules';
import type { ParsedFile } from '../core/types';
import type { ValidationResult } from '../core/validator';

const DELIMS: Record<string, string> = { TAB: '\t', Semicolon: ';', Comma: ',' };

export function ExportView(props: {
  parsed: ParsedFile;
  result: ValidationResult;
  catalogue: Catalogue;
  profile: Profile;
  fileName: string;
  onDone: (msg: string) => void;
}) {
  const { parsed, result, catalogue, profile } = props;
  const base = props.fileName.replace(/\.[^.]+$/, '') || 'gcnpd95';
  const [xl, setXl] = useState<ExcelOptions>({ wide: true, flat: true, entities: true, validation: true });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const wide = useMemo(() => wideTables(parsed, catalogue), [parsed, catalogue]);
  const tables = useMemo(
    () => [
      { id: 'flat', label: 'All results, one row per value (flattened)' },
      ...wide.map((w) => ({ id: `wide:${w.analType}`, label: `${w.analType} results, one row per analysis` })),
      { id: 'sites', label: 'Sample sites' },
      { id: 'samples', label: 'Samples' },
      { id: 'fractions', label: 'Fractions' },
      { id: 'analyses', label: 'Analyses' },
    ],
    [wide],
  );
  const [table, setTable] = useState('flat');
  const [delim, setDelim] = useState('TAB');
  const [enc, setEnc] = useState<'utf8' | 'latin1'>('utf8');
  const [js, setJs] = useState<JsonOptions>({ layout: 'nested', validation: true });

  const json = () => {
    const data = toJson(parsed, catalogue, js, { result, profile });
    const name = `${base}${js.layout === 'flat' ? '_flat' : ''}.json`;
    download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), name);
    props.onDone(`Saved ${name}`);
  };

  const excel = async () => {
    setBusy(true);
    setErr(null);
    try {
      const blob = await buildWorkbook(parsed, result, catalogue, profile, xl);
      download(blob, `${base}.xlsx`);
      props.onDone(`Saved ${base}.xlsx`);
    } catch (e) {
      setErr(`The workbook could not be created: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const text = () => {
    let columns: string[];
    let rows;
    if (table === 'flat') { columns = FLAT_COLUMNS; rows = flatRows(parsed, catalogue); }
    else if (table.startsWith('wide:')) {
      const w = wide.find((x) => `wide:${x.analType}` === table)!;
      columns = w.columns; rows = w.rows;
    } else {
      const src = { sites: parsed.sites, samples: parsed.samples, fractions: parsed.fractions, analyses: parsed.analyses }[table as 'sites']!;
      const t = entityTable(src, catalogue);
      columns = t.columns; rows = t.rows;
    }
    const body = toDelimited(rows, columns, DELIMS[delim]);
    const suffix = table.replace('wide:', '').replace(/[^\w-]/g, '');
    const name = `${base}_${suffix}.txt`;
    const blob = enc === 'latin1' ? new Blob([latin1(body) as BlobPart], { type: 'text/plain;charset=iso-8859-1' }) : new Blob(['﻿' + body], { type: 'text/plain;charset=utf-8' });
    download(blob, name);
    props.onDone(`Saved ${name} (${rows.length.toLocaleString()} rows)`);
  };

  const report = () => {
    const lines = [
      `GC-NPD-95 validation report`,
      `File:      ${parsed.fileName}`,
      `Profile:   ${profile === 'sodir' ? 'Sodir (Norway)' : 'Generic'}`,
      `Catalogue: ${catalogue.source}`,
      `Date:      ${new Date().toLocaleString('sv-SE').slice(0, 16)}`,
      `Result:    ${result.counts.error} errors, ${result.counts.warning} warnings, ${result.counts.info} notes`,
      '',
      ...result.issues.map((i) => {
        const head = `${i.severity.toUpperCase().padEnd(8)}${i.code}  ${i.line ? `line ${String(i.line).padEnd(6)}` : 'file       '}`;
        return `${head}${i.message}${i.hint ? `\n${' '.repeat(head.length)}${i.hint}` : ''}`;
      }),
      '',
      'Checks:',
      ...[...new Set(result.issues.map((i) => i.code))].map((c) => `  ${c}  ${RULE_BY_CODE[c]?.title ?? ''}`),
    ];
    download(new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/plain;charset=utf-8' }), `${base}_validation.txt`);
    props.onDone(`Saved ${base}_validation.txt`);
  };

  const check = (k: keyof ExcelOptions, label: string) => (
    <label>
      <input type="checkbox" checked={xl[k]} onChange={(e) => setXl({ ...xl, [k]: e.target.checked })} /> {label}
    </label>
  );

  return (
    <section aria-label="Export">
      {result.counts.error > 0 && (
        <p className="note" style={{ marginTop: 0 }}>
          The file has {result.counts.error} validation errors. Exports contain the data as it could be read; records that could not be
          interpreted are left out.
        </p>
      )}
      {err && <div className="error-box">{err}</div>}
      <div className="export-list">
        <div className="export-item">
          <div>
            <h3>Excel workbook</h3>
            <p>
              A formatted .xlsx with the transfer job details, then the sheets you choose. Columns have filters and units in the headers;
              numbers are stored as numbers.
            </p>
            <div className="opts">
              {check('wide', `One sheet per analysis type (${wide.map((w) => w.analType).join(', ') || 'none'})`)}
              {check('flat', 'All results flattened')}
              {check('entities', 'Sites, samples, fractions, analyses')}
              {check('validation', 'Validation report')}
            </div>
          </div>
          <button className="btn primary" onClick={excel} disabled={busy}>{busy ? 'Building workbook…' : 'Download Excel workbook'}</button>
        </div>

        <div className="export-item">
          <div>
            <h3>Delimited text</h3>
            <p>
              Character-separated text that opens in any spreadsheet or database tool, like the validator's "flattened text" conversion.
              The flattened table repeats site, sample, fraction and analysis details on every row.
            </p>
            <div className="opts">
              <label>
                Table
                <select className="input" value={table} onChange={(e) => setTable(e.target.value)}>
                  {tables.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </label>
              <label>
                Separator
                <select className="input" value={delim} onChange={(e) => setDelim(e.target.value)}>
                  {Object.keys(DELIMS).map((d) => <option key={d}>{d}</option>)}
                </select>
              </label>
              <label>
                Encoding
                <select className="input" value={enc} onChange={(e) => setEnc(e.target.value as 'utf8' | 'latin1')}>
                  <option value="utf8">UTF-8 (Excel friendly)</option>
                  <option value="latin1">ISO 8859-1</option>
                </select>
              </label>
            </div>
          </div>
          <button className="btn primary" onClick={text}>Download text file</button>
        </div>

        <div className="export-item">
          <div>
            <h3>JSON</h3>
            <p>
              The file as structured data for scripts, databases and web services. Attribute and parameter names are kept as in
              GC-NPD-95, values are numbers where they are numeric, and units come from the dictionary.
            </p>
            <div className="opts">
              <label>
                Layout
                <select className="input" value={js.layout} onChange={(e) => setJs({ ...js, layout: e.target.value as JsonOptions['layout'] })}>
                  <option value="nested">Nested: sites, samples, fractions, analyses, results</option>
                  <option value="flat">Flat: one object per result</option>
                </select>
              </label>
              <label>
                <input type="checkbox" checked={js.validation} onChange={(e) => setJs({ ...js, validation: e.target.checked })} /> Include validation results
              </label>
            </div>
          </div>
          <button className="btn primary" onClick={json}>Download JSON</button>
        </div>

        <div className="export-item">
          <div>
            <h3>Validation report</h3>
            <p>A plain text list of every error, warning and note with line numbers and suggested fixes, for sending back to the laboratory.</p>
          </div>
          <button className="btn primary" onClick={report}>Download report</button>
        </div>
      </div>
    </section>
  );
}
