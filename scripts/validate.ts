// Command-line validation, same rules as the web app.
// Usage: npm run validate -- <file> [more files] [--generic] [--json | --json-flat]
// --json writes <file>.json next to each input (nested), --json-flat one object per result.
// --fix applies the fixes that have exactly one right answer and writes GCH_RAW.ASC
//       (ISO 8859-1) in the folder of the input; name corrections with several candidates are listed only.
// Exit code 1 when any file has errors.
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { DEFAULT_CATALOGUE } from '../src/core/defaultCatalogue';
import { decodeBytes, parseGcNpd95 } from '../src/core/parser';
import { validate } from '../src/core/validator';
import { toJson } from '../src/core/json';
import { applyFixes, collectFixes, SODIR_FILE_NAME } from '../src/core/fixer';

const args = process.argv.slice(2);
const profile = args.includes('--generic') ? 'generic' : 'sodir';
const files = args.filter((a) => !a.startsWith('--'));
if (!files.length) {
  console.error('Usage: npm run validate -- <file> [more files] [--generic] [--json | --json-flat] [--fix]');
  process.exit(2);
}
const cat = DEFAULT_CATALOGUE;
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
  if (args.includes('--fix')) {
    const groups = collectFixes(r.issues);
    const sure = groups.filter((g) => g.confident);
    const out = join(dirname(f), SODIR_FILE_NAME);
    if (basename(f).toUpperCase() === SODIR_FILE_NAME && !sure.length) console.log('  nothing to fix');
    else {
      const fixed = applyFixes(text, pf.delimiter ?? ',', sure.map((g) => ({ group: g })));
      writeFileSync(out, Buffer.from(fixed, 'latin1'));
      const after = validate(parseGcNpd95(fixed, SODIR_FILE_NAME, cat, 'ISO 8859-1'), cat, profile);
      console.log(`  wrote ${out} with ${sure.length} fixes: ${after.counts.error} errors, ${after.counts.warning} warnings left`);
    }
    for (const g of groups.filter((x) => !x.confident))
      console.log(`  choose by hand: ${g.title} (line ${g.lines.join(', ')}): ${g.choices.slice(0, 5).join(' | ')}`);
  }
  if (r.counts.error) failed = true;
}
process.exit(failed ? 1 : 0);
