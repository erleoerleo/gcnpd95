import { LOOKUP, type Catalogue } from './catalogue';

export interface NameList {
  names: string[];
  source: string;
}

/** One name per line; blank lines and surrounding whitespace ignored, duplicates removed. */
export function parseList(text: string): string[] {
  const seen = new Set<string>();
  for (const line of text.replace(/^﻿/, '').split(/\r\n|\n|\r/)) {
    const v = line.trim();
    if (v) seen.add(v);
  }
  return [...seen];
}

/**
 * Replaces the catalogue's wellbore names and/or company codes with Sodir's approved lists.
 * Company descriptions from the catalogue are kept where the code is in both.
 */
export function withLists(cat: Catalogue, lists: { wellbores?: NameList; companies?: NameList }): Catalogue {
  const lookups = { ...cat.lookups };
  const sources = { ...cat.sources };
  if (lists.wellbores) {
    lookups[LOOKUP.SiteName] = Object.fromEntries(lists.wellbores.names.map((n) => [n, '']));
    sources.wellbores = lists.wellbores.source;
  }
  if (lists.companies) {
    const old = cat.lookups[LOOKUP.Company] ?? {};
    lookups[LOOKUP.Company] = Object.fromEntries(lists.companies.names.map((n) => [n, old[n] ?? '']));
    sources.companies = lists.companies.source;
  }
  return { ...cat, lookups, sources };
}
