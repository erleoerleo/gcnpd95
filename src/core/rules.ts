import type { Severity } from './types';

export type Profile = 'sodir' | 'generic';

/**
 * format     - physical file format (spec chapter 4), applies everywhere
 * model      - logical data model and its integrity (spec chapter 2)
 * dictionary - GC-DIC-V2 attribute/parameter definitions and legal codes
 * sodir      - Norwegian reporting: Sodir wellbore list and company codes
 */
export type RuleScope = 'format' | 'model' | 'dictionary' | 'sodir';

export interface RuleDef {
  code: string;
  scope: RuleScope;
  severity: Severity;
  title: string;
  /** severity used by the generic (non-Norwegian) profile, when different */
  generic?: Severity;
}

const R = (code: string, scope: RuleScope, severity: Severity, title: string, generic?: Severity): RuleDef => ({
  code,
  scope,
  severity,
  title,
  generic,
});

export const RULES: RuleDef[] = [
  R('F01', 'format', 'warning', 'Character set should be ISO 8859-1'),
  R('F02', 'format', 'error', 'File definition block must come first and end with a block terminator'),
  R('F03', 'format', 'error', 'File definition lines are column-bound: name in columns 1-15, value from column 16'),
  R('F04', 'format', 'error', 'Unknown file definition attribute'),
  R('F05', 'format', 'error', 'File definition attribute given more than once'),
  R('F06', 'format', 'error', 'Mandatory file definition attribute missing'),
  R('F07', 'format', 'error', 'Format must be GC-NPD-95 and Version 2.0'),
  R('F08', 'format', 'error', 'Delimiter must be COMMA, SEMICOLON or TAB'),
  R('F09', 'format', 'info', 'Format, Version, Dictionary and Delimiter should be the first lines'),
  R('F10', 'format', 'error', 'Block definition line must read 00,DEFINE BLOCK,nn'),
  R('F11', 'format', 'error', 'Block identifier used more than once'),
  R('F12', 'format', 'error', 'Data block not closed by a terminator (-----)'),
  R('F13', 'format', 'error', 'Record definition lines must start with L0-L9 in non-decreasing order'),
  R('F14', 'format', 'warning', 'Gap in record format numbering'),
  R('F15', 'format', 'error', 'Record definition block has no value assignment block'),
  R('F16', 'format', 'warning', 'Value assignment block is empty'),
  R('F17', 'format', 'error', 'Value record does not belong to the current block or format'),
  R('F18', 'format', 'error', 'More values than the record format defines'),
  R('F19', 'format', 'error', 'Text with delimiters or quotes must be correctly encapsulated in double quotes'),
  R('F20', 'format', 'error', 'Line outside any data block'),
  R('F21', 'format', 'error', 'At most 99 block couples are allowed'),
  R('F22', 'format', 'warning', 'Record identifiers and terminators must start in column 1'),
  R('F23', 'format', 'error', 'Numbers must use dot as decimal symbol'),
  R('F24', 'format', 'error', 'Dates must be DD.MM.YYYY'),
  R('F25', 'format', 'error', 'Record definition block contains no record format'),
  R('M01', 'model', 'error', 'A block must describe exactly one entity type'),
  R('M02', 'model', 'warning', 'Blocks should follow the hierarchy (site, sample, fraction, analysis, results)'),
  R('M03', 'model', 'error', 'Mandatory attribute missing'),
  R('M04', 'model', 'error', 'Identifier is not unique within the file'),
  R('M05', 'model', 'error', 'Reference to an identifier that is not defined'),
  R('M06', 'model', 'warning', 'Parent is defined after the child that refers to it'),
  R('M07', 'model', 'error', 'TransferID does not match the file definition block'),
  R('M08', 'model', 'error', 'GC results need Detector and PeakProperty'),
  R('M09', 'model', 'error', 'Detector and PeakProperty must be specified together'),
  R('M10', 'model', 'error', 'Vitrinite population results need PopnNum'),
  R('M11', 'model', 'warning', 'Same result reported more than once'),
  R('M12', 'model', 'warning', 'Detector/PeakProperty given for a non-GC analysis'),
  R('M13', 'model', 'info', 'Item without children (no fractions, analyses or results)'),
  R('M14', 'model', 'warning', 'Upper depth is below lower depth'),
  R('M15', 'model', 'error', 'Conditional attribute required (lithology for rock samples, comments for OTH)'),
  R('M16', 'model', 'error', 'Result value without a parameter name'),
  R('D01', 'dictionary', 'error', 'Unknown attribute name'),
  R('D02', 'dictionary', 'error', 'Unknown parameter name'),
  R('D03', 'dictionary', 'error', 'Parameter does not belong to the analysis type', 'warning'),
  R('D04', 'dictionary', 'error', 'Value is not a legal code in the dictionary'),
  R('D05', 'dictionary', 'error', 'Value must be numeric'),
  R('D06', 'dictionary', 'error', 'Value outside the legal range'),
  R('D07', 'dictionary', 'error', 'Value must be a positive integer'),
  R('D08', 'dictionary', 'error', 'Lithology string does not follow the dictionary syntax'),
  R('D09', 'dictionary', 'error', 'Keywords and codes are case-sensitive'),
  R('D10', 'dictionary', 'info', 'UNKNOWN is accepted for historical data only'),
  R('D11', 'dictionary', 'error', 'Dictionary must be GC-DIC-V2'),
  R('D12', 'dictionary', 'info', 'BULK is described as a fraction lithology'),
  R('S01', 'sodir', 'error', 'Norwegian well name not in the approved wellbore list', 'warning'),
  R('S02', 'sodir', 'warning', 'Site not in the wellbore list should have coordinates', 'info'),
  R('S03', 'sodir', 'error', 'Sender/Recipient not in the approved company list', 'warning'),
  R('S04', 'sodir', 'error', 'Company or laboratory not in the approved company list', 'warning'),
  R('S05', 'sodir', 'error', 'SiteName UNKNOWN is only legal for reference samples', 'warning'),
  R('S06', 'sodir', 'info', 'Files reported to Sodir should be named GCH_RAW.ASC', 'info'),
];

export const RULE_BY_CODE: Record<string, RuleDef> = Object.fromEntries(RULES.map((r) => [r.code, r]));

export function severityFor(code: string, profile: Profile): Severity {
  const r = RULE_BY_CODE[code];
  if (!r) return 'error';
  return profile === 'generic' && r.generic ? r.generic : r.severity;
}

export const SCOPE_LABEL: Record<RuleScope, string> = {
  format: 'File format',
  model: 'Data model',
  dictionary: 'Dictionary',
  sodir: 'Sodir reporting',
};
