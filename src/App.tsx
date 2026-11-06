import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import bundledCatalogue from './data/catalogue.json';
import { catalogueFromFile, LOOKUP, type Catalogue } from './core/catalogue';
import { decodeBytes, parseGcNpd95 } from './core/parser';
import { validate } from './core/validator';
import type { Profile } from './core/rules';
import { EmptyState } from './ui/EmptyState';
import { FileStrip } from './ui/FileStrip';
import { ValidationView } from './ui/ValidationView';
import { DataView } from './ui/DataView';
import { ChartsView } from './ui/ChartsView';
import { SourceView } from './ui/SourceView';
import { ExportView } from './ui/ExportView';

type Tab = 'validation' | 'data' | 'charts' | 'source' | 'export';
const TABS: [Tab, string][] = [
  ['validation', 'Validation'],
  ['data', 'Data'],
  ['charts', 'Charts'],
  ['source', 'Source'],
  ['export', 'Export'],
];

const BUNDLED = bundledCatalogue as unknown as Catalogue;
const LS_CATALOGUE = 'gcnpd95.catalogue';
const LS_PROFILE = 'gcnpd95.profile';

const store = {
  get(k: string): string | null {
    try { return localStorage.getItem(k); } catch { return null; }
  },
  set(k: string, v: string | null) {
    try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* storage unavailable */ }
  },
};

interface LoadedFile {
  name: string;
  text: string;
  encoding: string;
  size: number;
}

export default function App() {
  const [catalogue, setCatalogue] = useState<Catalogue>(() => {
    const saved = store.get(LS_CATALOGUE);
    if (saved) try { return JSON.parse(saved) as Catalogue; } catch { /* ignore */ }
    return BUNDLED;
  });
  const [profile, setProfile] = useState<Profile>(() => (store.get(LS_PROFILE) === 'generic' ? 'generic' : 'sodir'));
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [tab, setTab] = useState<Tab>('validation');
  const [focusLine, setFocusLine] = useState<{ line: number; n: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [catOpen, setCatOpen] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const topRef = useRef<HTMLElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    const el = topRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty('--topbar-h', `${el.offsetHeight}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const parsed = useMemo(
    () => (file ? parseGcNpd95(file.text, file.name, catalogue, file.encoding) : null),
    [file, catalogue],
  );
  const result = useMemo(() => (parsed ? validate(parsed, catalogue, profile) : null), [parsed, catalogue, profile]);

  const openBytes = useCallback((name: string, bytes: Uint8Array) => {
    const { text, encoding } = decodeBytes(bytes);
    if (!/(^|\n)\s*(Format|00\s*[,;\t]\s*DEFINE)/.test(text.slice(0, 20000))) {
      setLoadError(`"${name}" does not look like a GC-NPD-95 file: no "Format" line or "00,DEFINE BLOCK" line was found near the top.`);
    } else setLoadError(null);
    setFile({ name, text, encoding, size: bytes.length });
    setTab('validation');
    setFocusLine(null);
  }, []);

  const openFile = useCallback(
    async (f: File) => {
      if (/\.(xlsx?|pdf|docx?)$/i.test(f.name)) {
        setLoadError(`"${f.name}" is not a text file. GC-NPD-95 files are plain text, usually .txt or .asc.`);
        return;
      }
      openBytes(f.name, new Uint8Array(await f.arrayBuffer()));
    },
    [openBytes],
  );

  const openExample = useCallback(async () => {
    const res = await fetch(`${import.meta.env.BASE_URL}eksempelfil.txt`);
    openBytes('eksempelfil.txt', new Uint8Array(await res.arrayBuffer()));
  }, [openBytes]);

  const loadCatalogue = async (f: File) => {
    try {
      const c = await catalogueFromFile(f);
      setCatalogue(c);
      store.set(LS_CATALOGUE, JSON.stringify(c));
      setToast(`Catalogue loaded: ${Object.keys(c.parameters).length} parameters, ${Object.keys(c.lookups[LOOKUP.SiteName] ?? {}).length} site names.`);
      setCatOpen(false);
    } catch (e) {
      setToast(`Could not read the catalogue: ${(e as Error).message}`);
    }
  };

  const goToLine = useCallback((line: number) => {
    setFocusLine((f) => ({ line, n: (f?.n ?? 0) + 1 }));
    setTab('source');
  }, []);

  const setProf = (p: Profile) => {
    setProfile(p);
    store.set(LS_PROFILE, p);
  };

  // drag & drop anywhere
  useEffect(() => {
    const over = (e: DragEvent) => e.preventDefault();
    const drop = (e: DragEvent) => {
      e.preventDefault();
      const f = e.dataTransfer?.files?.[0];
      if (f) openFile(f);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [openFile]);

  const errors = result?.counts.error ?? 0;

  return (
    <div className="app">
      <header className="topbar" ref={topRef}>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          GC-NPD-95 Workbench
        </div>
        {file && (
          <div className="file-chip" title={file.name}>
            <strong>{file.name}</strong>
            <span>{parsed?.lines.length.toLocaleString()} lines, {file.encoding}</span>
          </div>
        )}
        <div className="spacer" />
        <div className="seg" role="group" aria-label="Validation profile">
          <button aria-pressed={profile === 'sodir'} onClick={() => setProf('sodir')} title="Full Norwegian reporting rules, including the Sodir wellbore list and company codes">
            Sodir (Norway)
          </button>
          <button aria-pressed={profile === 'generic'} onClick={() => setProf('generic')} title="Format and dictionary rules; Norwegian well list and company codes become warnings">
            Generic
          </button>
        </div>
        <button className="btn" onClick={() => setCatOpen((o) => !o)} aria-expanded={catOpen}>
          Catalogue
        </button>
        <button className="btn primary" onClick={() => fileInput.current?.click()}>
          Open file
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".txt,.asc,.TXT,.ASC,text/plain"
          className="visually-hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) openFile(f);
            e.target.value = '';
          }}
        />
        {catOpen && (
          <CataloguePanel
            catalogue={catalogue}
            isBundled={catalogue === BUNDLED || catalogue.source === BUNDLED.source}
            onLoad={loadCatalogue}
            onReset={() => {
              setCatalogue(BUNDLED);
              store.set(LS_CATALOGUE, null);
              setCatOpen(false);
              setToast('Using the bundled catalogue.');
            }}
            onClose={() => setCatOpen(false)}
          />
        )}
      </header>

      {!file || !parsed || !result ? (
        <EmptyState onFile={openFile} onExample={openExample} error={loadError} />
      ) : (
        <div className="workspace">
          <FileStrip parsed={parsed} issues={result.issues} onLine={goToLine} />
          <main className="main">
            <nav className="tabs" role="tablist" aria-label="Views">
              {TABS.map(([id, label]) => (
                <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
                  {label}
                  {id === 'validation' && errors > 0 && <span className="count">{errors}</span>}
                </button>
              ))}
            </nav>
            {loadError && <div className="error-box">{loadError}</div>}
            {tab === 'validation' && <ValidationView parsed={parsed} result={result} profile={profile} catalogue={catalogue} onLine={goToLine} />}
            {tab === 'data' && <DataView parsed={parsed} catalogue={catalogue} onLine={goToLine} />}
            {tab === 'charts' && <ChartsView parsed={parsed} catalogue={catalogue} />}
            {tab === 'source' && <SourceView parsed={parsed} issues={result.issues} focus={focusLine} />}
            {tab === 'export' && (
              <ExportView parsed={parsed} result={result} catalogue={catalogue} profile={profile} fileName={file.name} onDone={setToast} />
            )}
          </main>
        </div>
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

function CataloguePanel(props: {
  catalogue: Catalogue;
  isBundled: boolean;
  onLoad: (f: File) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const c = props.catalogue;
  const input = useRef<HTMLInputElement>(null);
  return (
    <section className="catalogue-panel" aria-label="Catalogue">
      <h3>Data dictionary</h3>
      <p style={{ margin: 0, color: 'var(--muted)' }}>
        Legal names and codes come from the GC-DIC-V2 catalogue (katalogfil). Load a newer workbook from Sodir to validate against
        recent wells and codes. It is kept in this browser until you reset it.
      </p>
      <dl>
        <dt>Source</dt>
        <dd>{c.source}{props.isBundled ? ' (bundled)' : ''}</dd>
        <dt>Dictionary</dt>
        <dd>{c.dictionaryNames.join(', ')}</dd>
        <dt>Parameters</dt>
        <dd>{Object.keys(c.parameters).length.toLocaleString()}</dd>
        <dt>Wellbores</dt>
        <dd>{Object.keys(c.lookups[LOOKUP.SiteName] ?? {}).length.toLocaleString()}</dd>
        <dt>Companies</dt>
        <dd>{Object.keys(c.lookups[LOOKUP.Company] ?? {}).length.toLocaleString()}</dd>
      </dl>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn primary" onClick={() => input.current?.click()}>Load katalogfil (.xls, .xlsx)</button>
        {!props.isBundled && <button className="btn" onClick={props.onReset}>Use bundled</button>}
        <button className="btn ghost" onClick={props.onClose}>Close</button>
      </div>
      <input
        ref={input}
        type="file"
        accept=".xls,.xlsx"
        className="visually-hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) props.onLoad(f);
          e.target.value = '';
        }}
      />
    </section>
  );
}
