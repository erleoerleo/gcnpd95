import { useRef, useState } from 'react';

export function EmptyState(props: { onFile: (f: File) => void; onExample: () => void; error: string | null }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="empty">
      <div>
        <h1>Check, explore and convert GC-NPD-95 files</h1>
        <p>
          Open a geochemical data file to validate it against the GC-NPD-95 version 2.0 format and the GC-DIC-V2 dictionary used by
          Sodir for the Diskos database. Inspect sites, samples, fractions and results, plot them, and export to Excel or flat text.
        </p>
        <p>
          Files never leave your computer. Everything runs in this browser tab.
        </p>
        <ul>
          <li>Sodir profile: the full Norwegian rules, including the wellbore list and company codes.</li>
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
        <small>GCH_RAW.ASC and other GC-NPD-95 v2.0 text files, comma, semicolon or TAB delimited</small>
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
