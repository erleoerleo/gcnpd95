# GC-NPD-95 Workbench

A static web app for validating, exploring and converting geochemical data files in the
GC-NPD-95 v2.0 format, the format Sodir (Norwegian Offshore Directorate) requires for
geochemical data sent to the Diskos database.

Everything runs in the browser. Files are never uploaded anywhere, so the app can be hosted
on GitHub Pages or any static host.

## What it does

- **Validation** against the format specification (`spesifikasjon-eng.pdf`) and the GC-DIC-V2
  data dictionary (`katalogfil.xls`), with two profiles:
  - **Sodir (Norway)**: every rule, including the Sodir wellbore list and company codes.
  - **Generic**: the same format, data model and dictionary checks, but well names and company
    codes become warnings. Use it for files from other countries that follow GC-NPD-95.
- Every problem has a rule code, a line number and, where it is clear, a suggested fix
  (for example `6407/07-A-18H` → *Did you mean 6407/7-A-18 H?*).
- **Data**: hierarchy (site, sample, fraction, analysis), entity tables, all results flattened,
  and one wide table per analysis type (RE, GC, ISOT, ...), with units from the dictionary.
- **Charts**: Rock-Eval HI–Tmax and S2–TOC with kerogen type guides, depth tracks
  (composite-log style), GC fingerprints by detector and peak property, and a cross-plot by sample.
- **Source** view with problem markers and previous/next problem navigation.
- **Export** to a formatted Excel workbook, delimited text (TAB, semicolon or comma; UTF-8 or
  ISO 8859-1), JSON, and a plain text validation report.
- **JSON** comes in two layouts. *Nested* follows the data model: `transferJob`, then
  `sites[] > samples[] > fractions[] > analyses[] > results[]`, with the GC-NPD-95 attribute
  names, numeric values as numbers and units from the dictionary. Records whose parent is
  missing are kept under `unlinked`. *Flat* has one object per result with its full context.
  Validation results can be included.
- **Catalogue**: the bundled catalogue is built from `katalogfil.xls`. A newer catalogue
  (.xls or .xlsx) can be loaded in the app; it is remembered in that browser.

All three ways of naming parameters are supported: explicit (`L0,ParamName`), implicit, and
simplified implicit, as well as multi-line records (L1–L9), Detector/PeakProperty context,
PopnNum, PComments, quoted text and missing values.

## Run locally

Requires Node.js 20 or later.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # parser and validator tests, using public/eksempelfil.txt
npm run build      # static site in dist/
```

Validate files from the command line with the same rules (exit code 1 on errors):

```bash
npm run validate -- GCH_RAW.ASC
npm run validate -- data/*.txt --generic
npm run validate -- GCH_RAW.ASC --json        # also writes GCH_RAW.json (nested)
npm run validate -- GCH_RAW.ASC --json-flat   # also writes GCH_RAW_flat.json
```

## Deploy to GitHub Pages

1. Move `deploy.yml` to `.github/workflows/deploy.yml` (on Windows:
   `mkdir .github\workflows` then `move deploy.yml .github\workflows\`).
1. Push this folder to a GitHub repository (branch `main`).
1. In the repository, open **Settings → Pages** and set **Source** to **GitHub Actions**.
1. The workflow in `.github/workflows/deploy.yml` tests, builds and publishes on every push to `main`.

The build uses relative paths, so it works at `https://<user>.github.io/<repo>/` and on any
other static host (Azure Static Web Apps, Netlify, an internal web server). No server-side
code or libraries are needed.

## Update the catalogue

When Sodir publishes a new catalogue, replace `katalogfil.xls` and run:

```bash
npm run catalogue                        # reads ./katalogfil.xls
npm run catalogue -- path/to/newer.xlsx  # or any other path
```

This rewrites `src/data/catalogue.json`, which is bundled into the site.
Users can also load a newer catalogue directly in the app without rebuilding.

## Validation rules

Codes starting with **F** are physical format rules (spec chapter 4), **M** data model and
integrity rules (chapter 2 and the AttributeRule sheet), **D** dictionary rules (legal names,
codes, numeric ranges, lithology syntax), and **S** Sodir reporting rules (wellbore list,
company codes, `GCH_RAW.ASC` file name). The full list with severities per profile is in the
app under *Validation → All checks*, and in `src/core/rules.ts`.

This tool follows the published specification and dictionary closely, but it is not Sodir's
official validator. Run the official validator before submitting.

## Project structure

```
src/core/catalogue.ts   catalogue model and converter from the Excel workbook
src/core/parser.ts      tokenizer and block parser, builds sites/samples/fractions/analyses/results
src/core/validator.ts   all validation rules
src/core/rules.ts       rule codes, titles and severities per profile
src/core/flatten.ts     flat and wide tables, delimited text
src/core/excel.ts       Excel export (ExcelJS, loaded on demand)
src/core/json.ts        JSON export (nested and flat)
src/core/chartdata.ts   data preparation for charts
src/ui/                 React components
scripts/                catalogue builder and command-line validator
test/                   Vitest tests
public/eksempelfil.txt  Sodir's annotated example file, used by "Open Sodir example file"
```
