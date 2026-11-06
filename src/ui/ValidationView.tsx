import { useMemo, useState } from 'react';
import type { Catalogue } from '../core/catalogue';
import { RULES, RULE_BY_CODE, SCOPE_LABEL, severityFor, type Profile } from '../core/rules';
import type { Issue, ParsedFile, Severity } from '../core/types';
import type { ValidationResult } from '../core/validator';

const SEV_LABEL: Record<Severity, string> = { error: 'Error', warning: 'Warning', info: 'Note' };
const plural = (n: number, w: string) => `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`;

export function ValidationView(props: {
  parsed: ParsedFile;
  result: ValidationResult;
  profile: Profile;
  catalogue: Catalogue;
  onLine: (n: number) => void;
}) {
  const { parsed, result, profile } = props;
  const { error, warning, info } = result.counts;
  const [show, setShow] = useState<Record<Severity, boolean>>({ error: true, warning: true, info: true });

  const groups = useMemo(() => {
    const m = new Map<string, Issue[]>();
    for (const i of result.issues) {
      if (!show[i.severity]) continue;
      (m.get(i.code) ?? m.set(i.code, []).get(i.code)!).push(i);
    }
    return [...m.entries()];
  }, [result.issues, show]);

  const target = profile === 'sodir' ? 'Sodir' : 'the generic profile';
  const verdict =
    error > 0
      ? { cls: 'bad', mark: '!', title: profile === 'sodir' ? `${plural(error, 'error')} to fix before submitting to Sodir` : `${plural(error, 'error')} in format or dictionary`, text: `${plural(warning, 'warning')} and ${plural(info, 'note')} as well. Select a line number to see it in the file.` }
      : warning > 0
        ? { cls: 'warn', mark: '?', title: `No errors, ${plural(warning, 'warning')} to review`, text: `The file follows GC-NPD-95 v2.0 and passes the error checks for ${target}.` }
        : { cls: 'ok', mark: '✓', title: profile === 'sodir' ? 'No problems found for Sodir reporting' : 'No problems found', text: `The file follows GC-NPD-95 v2.0 and the ${props.catalogue.dictionaryNames[0] ?? 'GC-DIC-V2'} dictionary.${info ? ` ${plural(info, 'note')} below.` : ''}` };

  const params = parsed.params.length;
  return (
    <section aria-label="Validation">
      <div className={`verdict ${verdict.cls}`}>
        <div className="mark" aria-hidden="true">{verdict.mark}</div>
        <h2>{verdict.title}</h2>
        <p>{verdict.text}</p>
      </div>

      <div className="stats">
        <Stat n={parsed.sites.length} label="sites" />
        <Stat n={parsed.samples.length} label="samples" />
        <Stat n={parsed.fractions.length} label="fractions" />
        <Stat n={parsed.analyses.length} label="analyses" />
        <Stat n={params} label="result values" />
        <Stat n={parsed.blocks.length} label="data blocks" />
      </div>

      <div className="filters" role="group" aria-label="Show severities">
        {(['error', 'warning', 'info'] as Severity[]).map((s) => (
          <button key={s} className="chip" aria-pressed={show[s]} onClick={() => setShow((x) => ({ ...x, [s]: !x[s] }))}>
            {SEV_LABEL[s]}s ({result.counts[s]})
          </button>
        ))}
      </div>

      {groups.length === 0 && <p className="note">Nothing to show for the selected severities.</p>}
      {groups.map(([code, list]) => (
        <IssueGroup key={code} code={code} list={list} onLine={props.onLine} defaultOpen={groups.length <= 6 || list[0].severity === 'error'} />
      ))}

      <details className="rules-ref">
        <summary>All checks ({RULES.length})</summary>
        <p className="note">
          Severities shown for the {profile === 'sodir' ? 'Sodir' : 'generic'} profile. The generic profile keeps format, model and
          dictionary checks, and treats the Norwegian wellbore list and company codes as advice.
        </p>
        <div className="table-wrap" style={{ maxHeight: 'none' }}>
          <table className="grid">
            <thead>
              <tr><th>Code</th><th>Area</th><th>Severity</th><th>Check</th></tr>
            </thead>
            <tbody>
              {RULES.map((r) => (
                <tr key={r.code}>
                  <td>{r.code}</td>
                  <td>{SCOPE_LABEL[r.scope]}</td>
                  <td><span className={`sev ${severityFor(r.code, profile)}`}>{SEV_LABEL[severityFor(r.code, profile)]}</span></td>
                  <td>{r.title}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className="stat">
      <b>{n.toLocaleString()}</b>
      <span>{label}</span>
    </div>
  );
}

function IssueGroup(props: { code: string; list: Issue[]; onLine: (n: number) => void; defaultOpen: boolean }) {
  const [all, setAll] = useState(false);
  const rule = RULE_BY_CODE[props.code];
  const sev = props.list[0].severity;
  const shown = all ? props.list : props.list.slice(0, 100);
  return (
    <details className="rule-group" open={props.defaultOpen}>
      <summary>
        <span className={`sev ${sev}`}>{SEV_LABEL[sev]}</span>
        <span className="code">{props.code}</span>
        <span className="title">{rule?.title ?? props.code}</span>
        <span className="n">{props.list.length}×</span>
      </summary>
      <ul className="occ">
        {shown.map((i, k) => (
          <li key={k}>
            {i.line ? (
              <button className="linelink" onClick={() => props.onLine(i.line!)}>line {i.line}</button>
            ) : (
              <span className="note">file</span>
            )}
            <span>
              {i.message}
              {i.hint && <span className="hint">{i.hint}</span>}
            </span>
          </li>
        ))}
        {!all && props.list.length > 100 && (
          <li>
            <span />
            <button className="btn ghost" onClick={() => setAll(true)}>Show all {props.list.length}</button>
          </li>
        )}
      </ul>
    </details>
  );
}
