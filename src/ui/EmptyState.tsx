import { useRef, useState } from 'react';

export function EmptyState(props: { onFile: (f: File) => void; onExample: () => void; error: string | null }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="empty">
      <div>
        <h1>Check, explore and convert GC-NPD-95 files</h1>
        <div className="privacy" role="note">
          <span className="privacy-icon"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 8V7a3 3 0 1 1 6 0v3H9Zm3 4a2 2 0 0 1 1 3.73V19h-2v-1.27A2 2 0 0 1 12 14Z"/></svg></span>
          <div>
            <strong>Your files never leave your computer</strong>
            <span>
              Validation, charts, fixes and exports all run in this browser tab. Nothing is uploaded, stored or sent anywhere,
              so confidential well data stays with you.
            </span>
          </div>
        </div>
        <p>
          Open a geochemical data file to validate it against the GC-NPD-95 version 2.0 format, the GC-DIC-V2 dictionary and
          Sodir's approved wellbore and company lists for the Diskos database. Inspect sites, samples, fractions and results, plot
          them, fix simple errors, and export to Excel, text or JSON.
        </p>
        <ul>
          <li>Sodir profile: the full Norwegian rules, including the approved wellbore and company lists.</li>
          <li>Generic profile: the same format and dictionary checks, for data from other countries.</li>
          <li>Every problem links to its line in the file, with a suggested fix where one is clear.</li>
        </ul>
      </div>
      <div
        className={`dropzone${over ? ' over' : ''}`}
        onDragEnter={(e) => { e.preventDefault(); setOver(true); }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) props.onFile(f);
        }}
      >
        <div className="core-art" aria-hidden="true">
          <i style={{ height: 70, background: 'linear-gradient(var(--e-sample) 0 30%, var(--e-site) 30% 55%, var(--e-sample) 55% 70%, var(--e-parameter) 70%)' }} />
          <i style={{ height: 58, background: 'linear-gradient(var(--e-site) 0 40%, var(--e-fraction) 40% 75%, var(--e-analysis) 75%)' }} />
          <i style={{ height: 74, background: 'linear-gradient(var(--e-analysis) 0 20%, var(--e-sample) 20% 60%, var(--e-site) 60%)' }} />
          <i style={{ height: 50, background: 'linear-gradient(var(--e-fraction) 0 50%, var(--e-parameter) 50%)' }} />
        </div>
        <div className="big">Drop a .txt or .asc file here</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button className="btn primary" onClick={() => input.current?.click()}>Choose file</button>
          <button className="btn" onClick={props.onExample}>Open Sodir example file</button>
        </div>
        <small>GCH_RAW.ASC and other GC-NPD-95 v2.0 text files, comma, semicolon or TAB delimited. The file is read in your browser, not uploaded.</small>
        {props.error && <div className="error-box" style={{ textAlign: 'left' }}>{props.error}</div>}
        <input
          ref={input}
          type="file"
          accept=".txt,.asc,.TXT,.ASC,text/plain"
          className="visually-hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) props.onFile(f);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}
