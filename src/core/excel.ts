import type { Catalogue } from './catalogue';
import { entityTable, FLAT_COLUMNS, flatRows, wideTables, type Row } from './flatten';
import { RULE_BY_CODE, type Profile } from './rules';
import type { ParsedFile } from './types';
import type { ValidationResult } from './validator';

export interface ExcelOptions {
  wide: boolean;
  flat: boolean;
  entities: boolean;
  validation: boolean;
}

/** Builds a formatted .xlsx workbook. ExcelJS is loaded on demand. */
export async function buildWorkbook(
  pf: ParsedFile,
  result: ValidationResult,
  cat: Catalogue,
  profile: Profile,
  opts: ExcelOptions,
): Promise<Blob> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'GC-NPD-95 Workbench';
  wb.created = new Date();
  const HEAD_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF1B2B30' } };
  const usedNames = new Set<string>();
  const sheetName = (s: string) => {
    let n = s.replace(/[\\/?*[\]:]/g, '-').slice(0, 31);
    let k = 2;
    while (usedNames.has(n.toLowerCase())) n = `${s.slice(0, 28)} ${k++}`;
    usedNames.add(n.toLowerCase());
    return n;
  };

  const addTable = (name: string, columns: string[], rows: Row[], headers?: string[]) => {
    const ws = wb.addWorksheet(sheetName(name), { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.addRow(headers ?? columns);
    for (const r of rows) ws.addRow(columns.map((c) => (r[c] === undefined ? null : r[c])));
    const head = ws.getRow(1);
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    head.fill = HEAD_FILL;
    head.alignment = { vertical: 'middle', wrapText: true };
    head.height = 30;
    columns.forEach((c, i) => {
      let w = (headers?.[i] ?? c).length;
      for (const r of rows.slice(0, 300)) w = Math.max(w, String(r[c] ?? '').length);
      ws.getColumn(i + 1).width = Math.min(Math.max(w + 2, 8), 60);
    });
    if (rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
    return ws;
  };

  // Info sheet
  const info = wb.addWorksheet(sheetName('File'));
  info.columns = [{ width: 26 }, { width: 70 }];
  const title = info.addRow(['GC-NPD-95 file', pf.fileName]);
  title.font = { bold: true, size: 13 };
  info.addRow([]);
  info.addRow(['Transfer job']).font = { bold: true };
  for (const e of pf.fileDef) info.addRow([e.name, e.value]);
  info.addRow([]);
  info.addRow(['Contents']).font = { bold: true };
  info.addRow(['Sample sites', pf.sites.length]);
  info.addRow(['Samples', pf.samples.length]);
  info.addRow(['Fractions', pf.fractions.length]);
  info.addRow(['Analyses', pf.analyses.length]);
  info.addRow(['Result values', pf.params.length]);
  info.addRow([]);
  info.addRow(['Validation']).font = { bold: true };
  info.addRow(['Profile', profile === 'sodir' ? 'Sodir (Norway)' : 'Generic']);
  info.addRow(['Catalogue', cat.source]);
  info.addRow(['Errors', result.counts.error]);
  info.addRow(['Warnings', result.counts.warning]);
  info.addRow(['Notes', result.counts.info]);
  info.addRow(['Exported', new Date().toLocaleString('sv-SE').slice(0, 16)]);

  if (opts.validation) {
    const rows = result.issues.map((i) => ({
      Severity: i.severity,
      Code: i.code,
      Check: RULE_BY_CODE[i.code]?.title ?? '',
      Line: i.line ?? null,
      Message: i.message,
      Hint: i.hint ?? null,
    }));
    const ws = addTable('Validation', ['Severity', 'Code', 'Check', 'Line', 'Message', 'Hint'], rows);
    const colour: Record<string, string> = { error: 'FFA8382B', warning: 'FF9A6A0F', info: 'FF4F6D8A' };
    ws.getColumn(5).width = 90;
    ws.eachRow((row, n) => {
      if (n === 1) return;
      const sev = String(row.getCell(1).value);
      row.getCell(1).font = { bold: true, color: { argb: colour[sev] ?? 'FF000000' } };
    });
  }

  if (opts.wide) {
    for (const w of wideTables(pf, cat)) {
      const headers = w.columns.map((c) => (w.units[c] ? `${c} (${w.units[c]})` : c));
      addTable(`${w.analType} results`, w.columns, w.rows, headers);
    }
  }
  if (opts.flat) addTable('All results', FLAT_COLUMNS, flatRows(pf, cat));
  if (opts.entities) {
    for (const [name, rows] of [['Sites', pf.sites], ['Samples', pf.samples], ['Fractions', pf.fractions], ['Analyses', pf.analyses]] as const) {
      const t = entityTable(rows, cat);
      addTable(name, t.columns, t.rows);
    }
  }

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Encodes text as ISO 8859-1 (characters outside Latin-1 become '?'). */
export function latin1(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    out[i] = c < 256 ? c : 63;
  }
  return out;
}
