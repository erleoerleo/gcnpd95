export type Severity = 'error' | 'warning' | 'info';

/** Where a fix is applied. Field indexes count the record identifier as field 0. */
export type FixTarget =
  | { kind: 'field'; line: number; field: number }
  | { kind: 'fileDef'; line: number; name: string }
  | { kind: 'replaceLine'; line: number }
  | { kind: 'insertBefore'; line: number }
  | { kind: 'append' };

export interface FixProposal {
  /** issues with the same group are fixed together with one choice */
  group: string;
  title: string;
  from?: string;
  /** replacement value(s); the first is the default */
  choices: string[];
  /** true when there is exactly one right answer (ticked by default) */
  confident: boolean;
  target: FixTarget;
}

export interface Issue {
  severity: Severity;
  code: string;
  message: string;
  line?: number;
  blockId?: string;
  hint?: string;
  fix?: FixProposal;
}

export type LineKind =
  | 'comment'
  | 'blank'
  | 'filedef'
  | 'terminator'
  | 'blockdef'
  | 'recdef'
  | 'value'
  | 'invalid';

export interface SourceLine {
  no: number; // 1-based
  text: string;
  kind: LineKind;
  block?: string; // block id the line belongs to
}

export interface FileDefEntry {
  name: string;
  value: string;
  line: number;
}

export type Slot =
  | { kind: 'attr'; name: string; written: string }
  | { kind: 'param'; name: string; written: string }
  | { kind: 'paramValue'; fixed: Record<string, string> }
  | { kind: 'unknown'; written: string };

export interface RecordFormat {
  n: number;
  slots: Slot[];
  lines: number[];
}

export interface ValueLine {
  n: number;
  line: number;
  values: (string | null)[];
}

export interface ValueRecord {
  line: number;
  lines: ValueLine[];
}

export type Level = 'site' | 'sample' | 'fraction' | 'analysis' | 'parameter';

export interface Block {
  id: string;
  comment: string;
  defLine: number;
  formats: Map<number, RecordFormat>;
  records: ValueRecord[];
  level: Level | null;
  hasValueBlock: boolean;
  lastLine: number;
}

export interface EntityRow {
  attrs: Record<string, string | null>;
  /** line on which each attribute value was given */
  attrLine: Record<string, number>;
  /** field index (record identifier = 0) on that line */
  attrField: Record<string, number>;
  line: number;
  block: string;
}

export interface ParamRow {
  analId: string | null;
  name: string;
  value: string;
  num: number | null;
  detector: string | null;
  peakProperty: string | null;
  popnNum: string | null;
  comment: string | null;
  line: number;
  /** field index of the value on its line (record identifier = 0) */
  field: number;
  block: string;
  /** order of appearance within the block definition, used to keep chromatogram order */
  order: number;
}

export interface ParsedFile {
  fileName: string;
  encoding: string;
  lines: SourceLine[];
  fileDef: FileDefEntry[];
  delimiter: string | null;
  blocks: Block[];
  sites: EntityRow[];
  samples: EntityRow[];
  fractions: EntityRow[];
  analyses: EntityRow[];
  params: ParamRow[];
  issues: Issue[];
}
