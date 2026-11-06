// GC-DIC-V2 data dictionary ("katalogfil") in a compact JSON form, plus the
// converter that builds it from the official Excel workbook (.xls or .xlsx).

export type EntityType = 'Data_Transfer_Job' | 'Sample_Site' | 'Sample' | 'Fraction' | 'Analysis' | 'Parameter';

export interface AttributeDef {
  name: string;
  entity: EntityType;
  checkType: number;
  min: number | null;
  max: number | null;
  lookupId: number | null;
  requirement: 'Mandatory' | 'Conditional' | 'Optional';
  description: string;
  usage: string;
  sortKey: number;
}

export interface ParameterDef {
  name: string;
  analysisType: string; // AnalType code, e.g. RE, GC
  checkType: number;
  min: number | null;
  max: number | null;
  unit: string;
  numeric: boolean;
  description: string;
  remarks: string;
  usage: string;
  sortKey: number;
}

export interface Catalogue {
  source: string;
  dictionaryNames: string[];
  attributes: Record<string, AttributeDef>;
  lookupGroups: Record<string, string>; // id -> name
  lookups: Record<string, Record<string, string>>; // lookup id -> legal value -> description
  analysisTypes: Record<string, { id: number; comment: string }>;
  parameters: Record<string, ParameterDef>;
  lithology: Record<string, { types: number[]; description: string }>;
  lithologyTypes: Record<string, string>;
  rules: { id: number; text: string; comment: string }[];
  checkTypes: Record<string, string>;
}

export const LOOKUP = {
  Delimiter: 1,
  DTJStatus: 2,
  Company: 3,
  Country: 4,
  SiteType: 5,
  SampleType: 6,
  FractionType: 7,
  ADescription: 8,
  Detector: 9,
  PeakProperty: 10,
  SiteName: 11,
} as const;

// Minimal structural type of the SheetJS module, so this file has no hard dependency on it.
interface XLSXLike {
  utils: { sheet_to_json: (ws: unknown, opts: { header: 1; raw: boolean; defval: null }) => unknown[][] };
}
interface WorkbookLike {
  SheetNames: string[];
  Sheets: Record<string, unknown>;
}

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || str(v) === '') return null;
  const n = typeof v === 'number' ? v : Number(str(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

function rowsOf(XLSX: XLSXLike, wb: WorkbookLike, name: string): Record<string, unknown>[] {
  const sheetName = wb.SheetNames.find((s) => s.trim().toLowerCase() === name.toLowerCase());
  if (!sheetName) throw new Error(`The catalogue has no sheet named "${name}".`);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: true, defval: null });
  const header = (rows[0] ?? []).map((h) => str(h).replace(/\s+/g, '_'));
  return rows.slice(1).map((r) => {
    const o: Record<string, unknown> = {};
    header.forEach((h, i) => (o[h] = r[i]));
    return o;
  });
}

export function catalogueFromWorkbook(XLSX: XLSXLike, wb: WorkbookLike, source: string): Catalogue {
  const dictionaryNames = rowsOf(XLSX, wb, 'Dictionary')
    .map((r) => str(r.Name))
    .filter(Boolean);

  const attributes: Record<string, AttributeDef> = {};
  for (const r of rowsOf(XLSX, wb, 'Attribute')) {
    const name = str(r.Name);
    if (!name) continue;
    attributes[name] = {
      name,
      entity: str(r.Entity_type_logical) as EntityType,
      checkType: num(r.CheckTypeID) ?? 3,
      min: num(r.MinVal),
      max: num(r.MaxVal),
      lookupId: num(r.LookupID),
      requirement: (str(r.Mandatory_Conditional_Optional) || 'Optional') as AttributeDef['requirement'],
      description: str(r.Description),
      usage: str(r.Usage_comment),
      sortKey: num(r.SortKey) ?? 0,
    };
  }

  const lookupGroups: Record<string, string> = {};
  for (const r of rowsOf(XLSX, wb, 'LookupGroup')) {
    const id = num(r.ID);
    if (id !== null) lookupGroups[id] = str(r.Name);
  }

  const lookups: Record<string, Record<string, string>> = {};
  for (const r of rowsOf(XLSX, wb, 'LookupValue')) {
    const id = num(r.LookupID);
    const value = str(r.LegalValue).replace(/^'/, '');
    if (id === null || !value) continue;
    (lookups[id] ??= {})[value] = str(r.Description) || str(r.Usage_comment);
  }

  const analysisTypes: Record<string, { id: number; comment: string }> = {};
  const analysisById: Record<number, string> = {};
  for (const r of rowsOf(XLSX, wb, 'AnalysisType')) {
    const id = num(r.ID);
    const code = str(r.AnalysisType);
    if (id === null || !code) continue;
    analysisTypes[code] = { id, comment: str(r.Usage_comment) };
    analysisById[id] = code;
  }

  const parameters: Record<string, ParameterDef> = {};
  for (const r of rowsOf(XLSX, wb, 'ParameterName')) {
    const name = str(r.ParameterName).replace(/^'/, '');
    const typeId = num(r.AnalysisType);
    if (!name || typeId === null) continue;
    parameters[name] = {
      name,
      analysisType: analysisById[typeId] ?? String(typeId),
      checkType: num(r.CheckTypeID) ?? 1,
      min: num(r.MinVal),
      max: num(r.MaxVal),
      unit: str(r.Unit_of_measure),
      numeric: str(r.Numeric_or_text).toUpperCase() !== 'TXT',
      description: str(r.Parameter_description),
      remarks: str(r.Explanation_remarks),
      usage: str(r.Usage_comment),
      sortKey: num(r.SortKey) ?? 0,
    };
  }

  const lithology: Record<string, { types: number[]; description: string }> = {};
  for (const r of rowsOf(XLSX, wb, 'Lithology')) {
    const code = str(r.Name);
    const t = num(r.LithologyAttrTypeID);
    if (!code || t === null) continue;
    const e = (lithology[code] ??= { types: [], description: str(r.Description) });
    if (!e.types.includes(t)) e.types.push(t);
  }

  const lithologyTypes: Record<string, string> = {};
  for (const r of rowsOf(XLSX, wb, 'LithologyAttrType')) {
    const id = num(r.ID);
    if (id !== null) lithologyTypes[id] = str(r.Name);
  }

  const rules = rowsOf(XLSX, wb, 'AttributeRule')
    .map((r) => {
      const keys = Object.keys(r);
      return { id: num(r.ID) ?? 0, text: str(r[keys[1]]), comment: str(r[keys[2]]) };
    })
    .filter((r) => r.text);

  const checkTypes: Record<string, string> = {};
  for (const r of rowsOf(XLSX, wb, 'CheckType')) {
    const id = num(r.ID);
    if (id !== null) checkTypes[id] = str(r.Name);
  }

  return {
    source,
    dictionaryNames,
    attributes,
    lookupGroups,
    lookups,
    analysisTypes,
    parameters,
    lithology,
    lithologyTypes,
    rules,
    checkTypes,
  };
}

/** Loads a catalogue workbook chosen by the user (browser). SheetJS is loaded on demand. */
export async function catalogueFromFile(file: File): Promise<Catalogue> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
  return catalogueFromWorkbook(XLSX as unknown as XLSXLike, wb, file.name);
}
