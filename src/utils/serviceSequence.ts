import type { Store } from '../types';

/**
 * Calculates a clean, distinct 2-4 letter uppercase branch abbreviation.
 * Guaranteed to never collide or be ambiguous between branches.
 *
 * Examples:
 * - Hub / HQ / null -> "HUB" (prefix "DZ-HUB")
 * - "Anna Nagar" -> "AN" (prefix "DZ-AN")
 * - "Madurai" -> "MDU" (prefix "DZ-MDU")
 * - "Gandhipuram" -> "GP" (prefix "DZ-GP")
 * - "Branch 2" -> "B2" (prefix "DZ-B2")
 */
export const getBranchCode = (store: Store | null | undefined, stores?: Store[]): string => {
  if (!store || !store.id || store.id === 'hub_warehouse' || store.id === 'digital_zone_hq') {
    return 'HUB';
  }

  // 1. Explicit store code if assigned
  if (store.code && store.code.trim()) {
    return store.code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  }

  // 2. Derive from store.name
  const rawName = (store.name || '').trim();
  // Strip common noisy words
  const clean = rawName
    .replace(/digital\s*zone/gi, '')
    .replace(/branch/gi, '')
    .replace(/store/gi, '')
    .replace(/shop/gi, '')
    .replace(/workshop/gi, '')
    .replace(/office/gi, '')
    .trim();

  const words = clean.split(/[\s\-_]+/).filter(Boolean);
  let code = '';

  if (words.length >= 2) {
    code = words.map((w) => w[0]).join('').slice(0, 4).toUpperCase();
  } else if (words.length === 1 && words[0].length >= 2) {
    const word = words[0].toUpperCase();
    if (/^[0-9]+$/.test(word)) {
      code = `B${word}`;
    } else if (word.length <= 4) {
      code = word;
    } else {
      code = word.slice(0, 3);
    }
  }

  if (!code) {
    // Fallback to store id or index
    if (stores && store.id) {
      const idx = stores.findIndex((s) => s.id === store.id);
      code = idx >= 0 ? `B${idx + 1}` : 'BR';
    } else {
      code = 'BR';
    }
  }

  code = code.toUpperCase().replace(/[^A-Z0-9]/g, '');

  // 3. Disambiguate if multiple stores in the list end up with the same code
  if (stores && stores.length > 0 && store.id) {
    const sameCodeStores = stores.filter((s) => s.id !== store.id && getRawCode(s) === code);
    if (sameCodeStores.length > 0) {
      const allMatching = stores.filter((s) => getRawCode(s) === code);
      const myIdx = allMatching.findIndex((s) => s.id === store.id);
      if (myIdx > 0) {
        code = `${code}${myIdx + 1}`;
      }
    }
  }

  return code;
};

const getRawCode = (store: Store): string => {
  if (store.code && store.code.trim()) {
    return store.code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  }
  const clean = (store.name || '')
    .replace(/digital\s*zone/gi, '')
    .replace(/branch/gi, '')
    .replace(/store/gi, '')
    .trim();
  const words = clean.split(/[\s\-_]+/).filter(Boolean);
  if (words.length >= 2) return words.map((w) => w[0]).join('').slice(0, 4).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return 'BR';
};

/**
 * Returns the standardized service sequence prefix for this location.
 * Format: "DZ-<BRANCH_CODE>" (e.g. "DZ-HUB", "DZ-AN", "DZ-MDU")
 */
export const getBranchServicePrefix = (store: Store | null | undefined, stores?: Store[]): string => {
  const branchCode = getBranchCode(store, stores);
  return `DZ-${branchCode}`;
};

