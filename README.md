# GC-NPD-95 Workbench

A static web app for validating, exploring and converting geochemical data files in the
GC-NPD-95 v2.0 format, the format Sodir (Norwegian Offshore Directorate) requires for
geochemical data sent to the Diskos database.

Everything runs in the browser. Files are never uploaded anywhere, so the app can be hosted
on any static web server, such as gcnpd95.no.

## What it does

- **Validation** against the format specification (`data/spesifikasjon-eng.pdf`), the GC-DIC-V2
  data dictionary (`data/katalogfil.xls`) and Sodir's approved lists of wellbore names
  (`data/wellbores.txt`) and companies (`data/companies.txt`), with two profiles:
  - **Sodir (Norway)**: every rule, including the approved wellbore and company lists.
  - **Generic**: the same format, data model and dictionary checks, but well names and company
    codes become warnings. Use it for files from other countries that follow GC-NPD-95.
- Every problem has a rule code, a line number and, where it is clear, a suggested fix
  (for example `6407/07-A-18H` → *Did you mean 6407/7-A-18 H?*).
- **Automatic fixes** for simple errors, previewed before they are applied: missing block
  terminators (`-----`), misspelled wellbore and company names (replaced with a name from the
  approved lists), codes in the wrong case, decimal commas and misaligned file definition lines.
  Fixes with one right answer are ticked by default; for names with several candidates you pick
  one. The corrected file can be re-validated in place and saved as `GCH_RAW.ASC` (ISO 8859-1),
  the name Sodir requires. The original file is never changed.
- **Data**: hierarchy (site, sample, fraction, analysis), entity tables, all results flattened,
  and one wide table per analysis type (RE, GC, ISOT, ...), with units from the dictionary.
- **Charts**: Rock-Eval HI–Tmax and S2–TOC with kerogen type guides, depth tracks
  (composite-log style), GC peaks per detector and peak property as a reconstructed chromatogram
  or as bars, and a cross-plot by sample. GC-NPD-95 holds one value per compound, not the detector
  signal, so the chromatogram draws each reported peak as a Gaussian: n-alkanes, pristane, phytane
  and C1–C9 light hydrocarbons at approximate retention indices, other compounds (e.g. m/z 191 and
  217 biomarkers) in reported elution order. Up to four analyses can be overlaid or stacked.
- **Source** view with problem markers and previous/next problem navigation.
- **Export** the file itself as `GCH_RAW.ASC`, or convert it to a formatted Excel workbook, delimited text (TAB, semicolon or comma; UTF-8 or
  ISO 8859-1), JSON, and a plain text validation report.
- **JSON** comes in two layouts. *Nested* follows the data model: `transferJob`, then
  `sites[] > samples[] > fractions[] > analyses[] > results[]`, with the GC-NPD-95 attribute
  names, numeric values as numbers and units from the dictionary. Records whose parent is
  missing are kept under `unlinked`. *Flat* has one object per result with its full context.
  Validation results can be included.
- **Catalogue**: newer versions of the dictionary (.xls or .xlsx) and of the approved lists (.txt)
  can be loaded in the app under *Catalogue*; they are remembered in that browser.

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
npm run validate -- lab_report.txt --fix      # writes a corrected GCH_RAW.ASC next to it
```

`--fix` applies only the fixes that have one right answer and lists name corrections with
several candidates, so you can choose those in the app.

## Deploy to gcnpd95.no (own server)

The site is static files, so any web server can host it. The workflow in
`.github/workflows/deploy.yml` tests and builds on every push to `main`, then copies `dist/` to
`/var/www/gcnpd95` on the server with rsync over SSH. The copy step is skipped until the
repository secrets below exist.

**Domain and DNS (Domeneshop).** Register `gcnpd95.no` (private individuals need a Norid PID,
companies an organisation number). Add A records for `gcnpd95.no` and `www.gcnpd95.no` with the
server's public IP. If the IP can change (home connection), install `deploy/domeneshop-dyndns.sh`
and run it every 5 minutes from cron instead; it uses Domeneshop's DynDNS API.

**Server (Ubuntu, nginx).** Once:

```bash
sudo adduser --disabled-password --gecos "" deploy
sudo mkdir -p /var/www/gcnpd95 && sudo chown deploy:deploy /var/www/gcnpd95
sudo apt install -y rsync
sudo cp deploy/nginx-gcnpd95.no.conf /etc/nginx/sites-available/gcnpd95.no
sudo ln -s /etc/nginx/sites-available/gcnpd95.no /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d gcnpd95.no -d www.gcnpd95.no
```

Ports 80 and 443 must reach the server. Using Caddy instead of nginx: add `deploy/Caddyfile`
to the Caddy config; it handles the certificate itself.

**Deploy key and secrets.** Create a key pair that may only log in as `deploy`:

```bash
ssh-keygen -t ed25519 -N "" -C "github-actions gcnpd95" -f gcnpd95_deploy
sudo -u deploy mkdir -p -m 700 /home/deploy/.ssh
cat gcnpd95_deploy.pub | sudo -u deploy tee -a /home/deploy/.ssh/authorized_keys
ssh-keyscan -p 22 <server-host>      # output = DEPLOY_KNOWN_HOSTS
```

In GitHub: Settings → Secrets and variables → Actions → New repository secret:
`DEPLOY_HOST` (server host name or IP), `DEPLOY_USER` (`deploy`), `DEPLOY_KEY` (contents of
`gcnpd95_deploy`), `DEPLOY_KNOWN_HOSTS`, and `DEPLOY_PORT` if SSH does not use port 22.
Then re-run the workflow from the Actions tab, or push.

**Privacy by design.** Fonts are bundled with the site, and both the nginx and Caddy configs send a
Content-Security-Policy (`deploy/csp.txt`) with `connect-src 'self'`: the browser blocks any attempt
by the page to send data to another server. `npm run preview` serves the build with the same policy.

## Update the approved lists and the dictionary

**Wellbores and companies.** `data/wellbores.txt` and `data/companies.txt` hold one name per line
and are read directly when the site is built. Replace or edit them (also fine in the GitHub web
editor) and push; the site redeploys with the new lists. Names must match exactly, including
case and spacing (`6407/7-A-18 H`, `EQUINOR ENERGY AS`).

**Dictionary.** When Sodir publishes a new GC-DIC-V2 workbook, replace `data/katalogfil.xls` and run:

```bash
npm run catalogue                        # reads data/katalogfil.xls
npm run catalogue -- path/to/newer.xlsx  # or any other path
```

This rewrites `src/data/catalogue.json` (parameter names, units, codes). The approved lists
always take precedence over the wellbore and company tables inside the workbook.

## Validation rules

Codes starting with **F** are physical format rules (spec chapter 4), **M** data model and
integrity rules (chapter 2 and the AttributeRule sheet), **D** dictionary rules (legal names,
codes, numeric ranges, lithology syntax), and **S** Sodir reporting rules (approved wellbore
and company lists, `GCH_RAW.ASC` file name). The full list with severities per profile is in the
app under *Validation → All checks*, and in `src/core/rules.ts`.

This tool follows the published specification and dictionary closely, but it is not Sodir's
official validator. Run the official validator before submitting.

## Project structure

```
src/core/catalogue.ts   catalogue model and converter from the Excel workbook
src/core/lists.ts       approved wellbore/company lists (data/*.txt) applied to the catalogue
src/core/parser.ts      tokenizer and block parser, builds sites/samples/fractions/analyses/results
src/core/validator.ts   all validation rules
src/core/rules.ts       rule codes, titles and severities per profile
src/core/flatten.ts     flat and wide tables, delimited text
src/core/excel.ts       Excel export (ExcelJS, loaded on demand)
src/core/json.ts        JSON export (nested and flat)
src/core/chartdata.ts   data preparation for charts
src/core/chromatogram.ts  peak placement (retention index / elution order) and reconstructed traces
src/ui/                 React components
scripts/                catalogue builder and command-line validator
test/                   Vitest tests
data/                   Sodir documents, the dictionary workbook and the approved lists
public/eksempelfil.txt  Sodir's annotated example file, used by "Open Sodir example file"
```
