import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { catalogueFromFile, LOOKUP, type Catalogue } from './core/catalogue';
import { DEFAULT_CATALOGUE } from './core/defaultCatalogue';
import { parseList, withLists } from './core/lists';
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

const BUNDLED = DEFAULT_CATALOGUE;
// v2: catalogues saved before the approved wellbore/company lists were added are ignored
const LS_CATALOGUE = 'gcnpd95.catalogue.v2';
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
  /** the file as opened, while a fixed copy is shown */
  const [original, setOriginal] = useState<LoadedFile | null>(null);
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
    setOriginal(null);
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

  const loadCatalogue = async (kind: CatalogueKind, f: File) => {
    try {
      let c: Catalogue;
      let msg: string;
      if (kind === 'dictionary') {
        c = await catalogueFromFile(f);
        // keep approved lists that were loaded separately
        const keep = (k: 'wellbores' | 'companies', id: number) =>
          catalogue.sources?.[k] ? { names: Object.keys(catalogue.lookups[id] ?? {}), source: catalogue.sources[k]! } : undefined;
        c = withLists(c, { wellbores: keep('wellbores', LOOKUP.SiteName), companies: keep('companies', LOOKUP.Company) });
        msg = `Dictionary loaded: ${Object.keys(c.parameters).length} parameters.`;
      } else {
        const names = parseList(await f.text());
        if (names.length < 10) throw new Error(`only ${names.length} names found; expected one name per line`);
        c = withLists(catalogue, { [kind]: { names, source: f.name } });
        msg = `${kind === 'wellbores' ? 'Wellbore' : 'Company'} list loaded: ${names.length.toLocaleString()} names.`;
      }
      setCatalogue(c);
      store.set(LS_CATALOGUE, JSON.stringify(c));
      setToast(msg);
    } catch (e) {
      setToast(`Could not read ${f.name}: ${(e as Error).message}`);
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
            <span className="local-badge" title="The file is processed in this browser tab only. Nothing is uploaded.">
              <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 8V7a3 3 0 1 1 6 0v3H9Zm3 4a2 2 0 0 1 1 3.73V19h-2v-1.27A2 2 0 0 1 12 14Z"/></svg>
              Processed locally
            </span>
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
            isBundled={catalogue === BUNDLED}
            onLoad={loadCatalogue}
            onReset={() => {
              setCatalogue(BUNDLED);
              store.set(LS_CATALOGUE, null);
              setCatOpen(false);
              setToast('Using the dictionary and lists bundled with the site.');
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
            {tab === 'validation' && (
              <ValidationView
                parsed={parsed}
                result={result}
                profile={profile}
                catalogue={catalogue}
                onLine={goToLine}
                text={file.text}
                fileName={file.name}
                fixedFrom={original?.name ?? null}
                onApplyFixes={(text, summary) => {
                  setOriginal((o) => o ?? file);
                  setFile({ name: 'GCH_RAW.ASC', text, encoding: 'ISO 8859-1', size: text.length });
                  setToast(`${summary}. Validated again.`);
                }}
                onRevert={() => {
                  if (original) setFile(original);
                  setOriginal(null);
                }}
              />
            )}
            {tab === 'data' && <DataView parsed={parsed} catalogue={catalogue} onLine={goToLine} />}
            {tab === 'charts' && <ChartsView parsed={parsed} catalogue={catalogue} />}
            {tab === 'source' && <SourceView parsed={parsed} issues={result.issues} focus={focusLine} />}
            {tab === 'export' && (
              <ExportView parsed={parsed} result={result} catalogue={catalogue} profile={profile} fileName={file.name} text={file.text} onDone={setToast} />
            )}
          </main>
        </div>
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

type CatalogueKind = 'dictionary' | 'wellbores' | 'companies';

function CataloguePanel(props: {
  catalogue: Catalogue;
  isBundled: boolean;
  onLoad: (kind: CatalogueKind, f: File) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const c = props.catalogue;
  const input = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<CatalogueKind>('dictionary');
  const pick = (k: CatalogueKind) => {
    setKind(k);
    if (input.current) {
      input.current.accept = k === 'dictionary' ? '.xls,.xlsx' : '.txt,text/plain';
      input.current.click();
    }
  };
  const count = (id: number) => Object.keys(c.lookups[id] ?? {}).length.toLocaleString();
  return (
    <section className="catalogue-panel" aria-label="Catalogue">
      <h3>Dictionary and approved lists</h3>
      <p style={{ margin: 0, color: 'var(--muted)' }}>
        Codes and parameter names come from the GC-DIC-V2 dictionary (katalogfil). Well names and companies are checked against
        Sodir's approved lists. Files you load here are kept in this browser until you reset.
      </p>
      <dl>
        <dt>Dictionary</dt>
        <dd>{c.source}, {Object.keys(c.parameters).length.toLocaleString()} parameters</dd>
        <dt>Wellbores</dt>
        <dd>{count(LOOKUP.SiteName)} from {c.sources?.wellbores ?? c.source}</dd>
        <dt>Companies</dt>
        <dd>{count(LOOKUP.Company)} from {c.sources?.companies ?? c.source}</dd>
      </dl>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn" onClick={() => pick('wellbores')}>Load wellbore list (.txt)</button>
        <button className="btn" onClick={() => pick('companies')}>Load company list (.txt)</button>
        <button className="btn" onClick={() => pick('dictionary')}>Load katalogfil (.xls, .xlsx)</button>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
        {!props.isBundled && <button className="btn" onClick={props.onReset}>Use the bundled versions</button>}
        <button className="btn ghost" onClick={props.onClose}>Close</button>
      </div>
      <input
        ref={input}
        type="file"
        className="visually-hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) props.onLoad(kind, f);
          e.target.value = '';
        }}
      />
    </section>
  );
}
