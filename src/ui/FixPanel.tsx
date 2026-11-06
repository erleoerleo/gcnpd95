import { useEffect, useMemo, useState } from 'react';
import { download, latin1 } from '../core/excel';
import { applyFixes, collectFixes, nonLatin1, SODIR_FILE_NAME, type FixGroup } from '../core/fixer';
import { RULE_BY_CODE } from '../core/rules';
import type { ParsedFile } from '../core/types';
import type { ValidationResult } from '../core/validator';

export function saveGcFile(text: string) {
  download(new Blob([latin1(text) as BlobPart], { type: 'text/plain;charset=iso-8859-1' }), SODIR_FILE_NAME);
}

interface Pick { on: boolean; value: string }

const linesLabel = (g: FixGroup) =>
  g.lines.length === 0 ? '' : g.lines.length === 1 ? `line ${g.lines[0]}` : `${g.lines.length} lines`;

/** Lists fixable problems, lets the user choose, then applies them or saves the corrected GCH_RAW.ASC. */
export function FixPanel(props: {
  parsed: ParsedFile;
  result: ValidationResult;
  text: string;
  fileName: string;
  fixedFrom: string | null;
  onApply: (text: string, summary: string) => void;
  onRevert: () => void;
  onLine: (n: number) => void;
}) {
  const groups = useMemo(() => collectFixes(props.result.issues), [props.result.issues]);
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  useEffect(() => {
    const p: Record<string, Pick> = {};
    for (const g of groups) p[g.group] = { on: g.confident, value: g.choices[0] };
    setPicks(p);
  }, [groups]);

  const rename = props.fileName.toUpperCase() !== SODIR_FILE_NAME;
  if (!groups.length && !rename && !props.fixedFrom) return null;

  const selected = groups.filter((g) => picks[g.group]?.on);
  const build = () =>
    applyFixes(props.text, props.parsed.delimiter ?? ',', selected.map((g) => ({ group: g, value: picks[g.group]?.value })));
  const lost = nonLatin1(props.text);
  const summary = () => `${selected.length} ${selected.length === 1 ? 'fix' : 'fixes'} applied`;

  return (
    <section className="fix-panel" aria-label="Fix problems">
      <div className="fix-head">
        <div>
          <h3>{groups.length ? `Fix problems automatically (${groups.length})` : 'Save for Sodir'}</h3>
          <p>
            {props.fixedFrom
              ? `This is a corrected copy of ${props.fixedFrom}. Save it as ${SODIR_FILE_NAME}, or go back to the original.`
              : groups.length
                ? 'Ticked fixes are applied to a copy; your original file is not changed. Name corrections are only ticked when there is one right answer.'
                : props.result.counts.error
                  ? 'The remaining errors cannot be fixed automatically. Correct them in the source file.'
                  : 'The file is valid. Save it under the name Sodir expects.'}
          </p>
        </div>
      </div>

      {groups.length > 0 && (
        <ul className="fix-list">
          {groups.map((g) => {
            const p = picks[g.group] ?? { on: g.confident, value: g.choices[0] };
            const set = (x: Partial<Pick>) => setPicks((all) => ({ ...all, [g.group]: { ...p, ...x } }));
            const many = g.uniform && g.choices.length > 1;
            return (
              <li key={g.group}>
                <input type="checkbox" checked={p.on} onChange={(e) => set({ on: e.target.checked })} aria-label={`Apply: ${g.title}`} />
                <div className="fix-what">
                  <span className="fix-rule">{RULE_BY_CODE[g.code]?.title ?? g.code}</span>
                  {g.code === 'F12' ? (
                    <span>{g.title}</span>
                  ) : g.code === 'F03' ? (
                    <span className="fix-code">{g.choices[0]}</span>
                  ) : !g.uniform ? (
                    <span>
                      {g.items.length} values, for example <s>{g.items[0].from}</s> → <b>{g.items[0].choices[0]}</b>
                    </span>
                  ) : (
                    <span>
                      <s>{g.from}</s> →{' '}
                      {many ? (
                        <select className="input" value={p.value} onChange={(e) => set({ value: e.target.value, on: true })} aria-label={`Replacement for ${g.from}`}>
                          {g.choices.map((c) => <option key={c}>{c}</option>)}
                        </select>
                      ) : (
                        <b>{g.choices[0]}</b>
                      )}
                    </span>
                  )}
                </div>
                {g.lines.length > 0 && (
                  <button className="linelink" onClick={() => props.onLine(g.lines[0])}>{linesLabel(g)}</button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {rename && (
        <p className="note fix-rename">
          The file will be saved as {SODIR_FILE_NAME} (now "{props.fileName}"){lost.length ? `. ${lost.join(' ')} cannot be stored in ISO 8859-1 and will become "?".` : ', in the ISO 8859-1 character set Sodir requires.'}
        </p>
      )}

      <div className="fix-actions">
        {groups.length > 0 && (
          <>
            <button className="btn primary" disabled={!selected.length} onClick={() => props.onApply(build(), summary())}>
              Apply {selected.length || ''} {selected.length === 1 ? 'fix' : 'fixes'} and re-validate
            </button>
            <button className="btn" disabled={!selected.length} onClick={() => saveGcFile(build())}>
              Save fixed {SODIR_FILE_NAME}
            </button>
          </>
        )}
        {!groups.length && (
          <button className="btn primary" onClick={() => saveGcFile(props.text)}>Save {SODIR_FILE_NAME}</button>
        )}
        {props.fixedFrom && <button className="btn ghost" onClick={props.onRevert}>Back to the original file</button>}
      </div>
    </section>
  );
}
