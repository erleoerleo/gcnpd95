// Converts the GC-DIC-V2 catalogue workbook into src/data/catalogue.json.
// Usage: npm run catalogue            (reads ./katalogfil.xls)
//        npm run catalogue -- path/to/newer-katalogfil.xlsx
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import * as XLSX from 'xlsx';
import { catalogueFromWorkbook } from '../src/core/catalogue';

const input = resolve(process.argv[2] ?? 'katalogfil.xls');
const wb = XLSX.read(readFileSync(input), { type: 'buffer' });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cat = catalogueFromWorkbook(XLSX as any, wb, basename(input));
const out = resolve('src/data/catalogue.json');
writeFileSync(out, JSON.stringify(cat));
console.log(
  `Wrote ${out}: ${Object.keys(cat.attributes).length} attributes, ${Object.keys(cat.parameters).length} parameters, ` +
    `${Object.keys(cat.lookups['11'] ?? {}).length} site names, ${Object.keys(cat.lookups['3'] ?? {}).length} companies`,
);
