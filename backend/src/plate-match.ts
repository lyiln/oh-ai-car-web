export type WhitelistCategory = 'private' | 'visitor';

export interface WhitelistPlateEntry {
  plate: string;
  category: WhitelistCategory;
}

export interface PlateMatchResult {
  /** OCR / reported plate (normalised). */
  scannedPlate: string;
  /** Matched whitelist plate when classified via exact or partial match. */
  matchedPlate: string;
  category: WhitelistCategory;
  /** How the match was made. */
  mode: 'exact' | 'partial';
  /**
   * Contiguous alphanumeric fragment used for partial match (length ≥ minLen).
   * - scan⊆whitelist: fragment from OCR contained in whitelist plate
   * - whitelist⊆scan: full whitelist alphanumeric body contained in OCR
   */
  fragment: string | null;
  /** Which direction produced a partial hit. */
  direction?: 'scan_in_whitelist' | 'whitelist_in_scan';
}

const MIN_FRAGMENT = 3;

/**
 * Normalise plate text for observation matching.
 * Accepts full plates and incomplete OCR (at least 3 A-Z0-9 after optional province).
 */
export function normalisePlate(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('plate is required');
  const plate = value.trim().replace(/[\s\-·・.]/g, '').toUpperCase();
  const chineseFull = /^[\u4e00-\u9fa5][A-Z][A-Z0-9]{5,7}$/.test(plate);
  const asciiFull = /^[A-Z0-9]{5,10}$/.test(plate);
  // Incomplete / slightly oversized OCR: optional Chinese province + ≥3 letters/digits
  const partial = /^[\u4e00-\u9fa5]?[A-Z0-9]{3,12}$/.test(plate);
  if (!chineseFull && !asciiFull && !partial) throw new Error('plate is invalid');
  return plate;
}

/** Alphanumeric-only body used for substring comparison. */
export function plateAlphanumeric(plate: string): string {
  return plate.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Contiguous alphanumeric windows of length ≥ minLen, longest first
 * (regex-style: every substring that could appear in a whitelist plate).
 */
export function alphanumericFragments(plate: string, minLen = MIN_FRAGMENT): string[] {
  const alnum = plateAlphanumeric(plate);
  if (alnum.length < minLen) return [];
  const fragments: string[] = [];
  for (let len = alnum.length; len >= minLen; len -= 1) {
    for (let i = 0; i + len <= alnum.length; i += 1) {
      fragments.push(alnum.slice(i, i + len));
    }
  }
  return fragments;
}

function considerCandidate(
  best: { entry: WhitelistPlateEntry; fragment: string; score: number; direction: NonNullable<PlateMatchResult['direction']> } | null,
  entry: WhitelistPlateEntry,
  fragment: string,
  direction: NonNullable<PlateMatchResult['direction']>,
): typeof best {
  // Longer fragment wins; private preferred on tie; full whitelist⊆scan preferred over
  // an equal-length scan⊆whitelist hit (same alnum body, clearer operator label).
  const score = fragment.length * 10
    + (entry.category === 'private' ? 1 : 0)
    + (direction === 'whitelist_in_scan' ? 2 : 0);
  if (!best || score > best.score) {
    return { entry, fragment, score, direction };
  }
  return best;
}

/**
 * Match a scanned plate against whitelist entries.
 * 1) Exact normalised plate
 * 2) Partial scan⊆whitelist: OCR has contiguous ≥3 letter/digit run inside a whitelist plate
 * 3) Partial whitelist⊆scan: whitelist alphanumeric body (≥3) is contained in OCR (extra chars)
 */
export function matchWhitelistPlate(
  scannedPlate: string,
  entries: WhitelistPlateEntry[],
  minFragmentLen = MIN_FRAGMENT,
): PlateMatchResult | null {
  if (!entries.length) return null;
  const exact = entries.find((entry) => entry.plate === scannedPlate);
  if (exact) {
    return {
      scannedPlate,
      matchedPlate: exact.plate,
      category: exact.category,
      mode: 'exact',
      fragment: null,
    };
  }

  const scannedAlnum = plateAlphanumeric(scannedPlate);
  const fragments = alphanumericFragments(scannedPlate, minFragmentLen);
  let best: {
    entry: WhitelistPlateEntry;
    fragment: string;
    score: number;
    direction: NonNullable<PlateMatchResult['direction']>;
  } | null = null;

  for (const entry of entries) {
    const haystack = plateAlphanumeric(entry.plate);
    // Direction A: incomplete OCR — scan fragment appears inside whitelist plate
    for (const fragment of fragments) {
      if (!haystack.includes(fragment)) continue;
      best = considerCandidate(best, entry, fragment, 'scan_in_whitelist');
      break; // fragments are longest-first for this entry
    }
    // Direction B: OCR with trailing/leading noise — full whitelist body inside scan
    if (haystack.length >= minFragmentLen && scannedAlnum.includes(haystack)) {
      best = considerCandidate(best, entry, haystack, 'whitelist_in_scan');
    }
  }

  if (!best) return null;
  return {
    scannedPlate,
    matchedPlate: best.entry.plate,
    category: best.entry.category,
    mode: 'partial',
    fragment: best.fragment,
    direction: best.direction,
  };
}

export function classificationFromMatch(
  match: PlateMatchResult | null,
): 'registered_private' | 'visitor' | 'suspected_external' {
  if (!match) return 'suspected_external';
  return match.category === 'private' ? 'registered_private' : 'visitor';
}

export function plateMatchDto(match: PlateMatchResult | null): {
  mode: PlateMatchResult['mode'];
  matchedPlate: string;
  fragment: string | null;
  direction?: PlateMatchResult['direction'];
} | null {
  if (!match) return null;
  return {
    mode: match.mode,
    matchedPlate: match.matchedPlate,
    fragment: match.fragment,
    direction: match.direction,
  };
}
