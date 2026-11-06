// Command-line validation, same rules as the web app.
// Usage: npm run validate -- <file> [more files] [--generic] [--json | --json-flat]
// --json writes <file>.json next to each input (nested), --json-flat one object per result.
// Exit code 1 when any file has errors.
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import catJson from '../src/data/catalogue.json';
import type { Catalogue } from '../src/core/catalogue';
import { decodeBytes, parseGcNpd95 } from '../src/core/parser';
import { validate } from '../src/core/validator';
import { toJson } from '../src/core/json';

const args = process.argv.slice(2);
const profile = args.includes('--generic') ? 'generic' : 'sodir';
const files = args.filter((a) => !a.startsWith('--'));
if (!files.length) {
  console.error('Usage: npm run validate -- <file> [more files] [--generic] [--json | --json-flat]');
  process.exit(2);
}
const cat = catJson as unknown as Catalogue;
let failed = false;
for (const f of files) {
  const { text, encoding } = decodeBytes(readFileSync(f));
  const pf = parseGcNpd95(text, basename(f), cat, encoding);
  const r = validate(pf, cat, profile);
  console.log(`\n${f}: ${r.counts.error} errors, ${r.counts.warning} warnings, ${r.counts.info} notes (${profile} profile)`);
  for (const i of r.issues) {
    console.log(`  ${i.severity.padEnd(7)} ${i.code} ${i.line ? `line ${i.line}` : 'file'}: ${i.message}${i.hint ? `\n${' '.repeat(16)}${i.hint}` : ''}`);
  }
  if (args.includes('--json') || args.includes('--json-flat')) {
    const layout = args.includes('--json-flat') ? 'flat' : 'nested';
    const out = f.replace(/\.[^./\\]+$/, '') + (layout === 'flat' ? '_flat' : '') + '.json';
    writeFileSync(out, JSON.stringify(toJson(pf, cat, { layout, validation: true }, { result: r, profile }), null, 2));
    console.log(`  wrote ${out}`);
  }
  if (r.counts.error) failed = true;
}
process.exit(failed ? 1 : 0);
