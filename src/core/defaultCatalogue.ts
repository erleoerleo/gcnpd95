// The catalogue bundled with the site: the GC-DIC-V2 dictionary (from data/katalogfil.xls,
// via `npm run catalogue`) combined with Sodir's approved wellbore and company lists,
// which are read straight from data/*.txt at build time. Edit those files to update the lists.
import catalogueJson from '../data/catalogue.json';
import wellboresTxt from '../../data/wellbores.txt?raw';
import companiesTxt from '../../data/companies.txt?raw';
import type { Catalogue } from './catalogue';
import { parseList, withLists } from './lists';

export const DEFAULT_CATALOGUE: Catalogue = withLists(catalogueJson as unknown as Catalogue, {
  wellbores: { names: parseList(wellboresTxt), source: 'data/wellbores.txt' },
  companies: { names: parseList(companiesTxt), source: 'data/companies.txt' },
});
