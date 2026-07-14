import { describe, expect, it } from 'vitest';
import {
  alphanumericFragments,
  classificationFromMatch,
  matchWhitelistPlate,
  normalisePlate,
} from '../src/plate-match.js';

const whitelist = [
  { plate: '京A12345', category: 'private' as const },
  { plate: '沪B88888', category: 'visitor' as const },
  { plate: 'A99999', category: 'private' as const },
];

describe('normalisePlate', () => {
  it('accepts full Chinese and ASCII plates', () => {
    expect(normalisePlate('京A·12345')).toBe('京A12345');
    expect(normalisePlate('a12345')).toBe('A12345');
  });

  it('accepts incomplete OCR with ≥3 alphanumerics', () => {
    expect(normalisePlate('A123')).toBe('A123');
    expect(normalisePlate('京A12')).toBe('京A12');
    expect(normalisePlate('2345')).toBe('2345');
  });

  it('rejects too-short fragments', () => {
    expect(() => normalisePlate('A1')).toThrow(/invalid/i);
    expect(() => normalisePlate('京A1')).toThrow(/invalid/i);
  });
});

describe('alphanumericFragments', () => {
  it('returns longest-first contiguous windows of length ≥3', () => {
    expect(alphanumericFragments('京A12345')).toEqual([
      'A12345',
      'A1234', '12345',
      'A123', '1234', '2345',
      'A12', '123', '234', '345',
    ]);
  });
});

describe('matchWhitelistPlate', () => {
  it('matches exact plate', () => {
    const match = matchWhitelistPlate('京A12345', whitelist);
    expect(match).toMatchObject({ mode: 'exact', category: 'private', matchedPlate: '京A12345' });
    expect(classificationFromMatch(match)).toBe('registered_private');
  });

  it('matches incomplete scan sharing ≥3 consecutive letters/digits', () => {
    const match = matchWhitelistPlate('A123', whitelist);
    expect(match).toMatchObject({
      mode: 'partial',
      category: 'private',
      matchedPlate: '京A12345',
      fragment: 'A123',
    });
    expect(classificationFromMatch(match)).toBe('registered_private');
  });

  it('matches digit-only fragment against whitelist', () => {
    const match = matchWhitelistPlate('888', whitelist);
    expect(match).toMatchObject({
      mode: 'partial',
      category: 'visitor',
      matchedPlate: '沪B88888',
      fragment: '888',
    });
    expect(classificationFromMatch(match)).toBe('visitor');
  });

  it('prefers longer fragment when multiple whitelist plates match', () => {
    const entries = [
      { plate: '京C12300', category: 'visitor' as const },
      { plate: '京A12345', category: 'private' as const },
    ];
    const match = matchWhitelistPlate('A1234', entries);
    expect(match?.matchedPlate).toBe('京A12345');
    expect(match?.fragment).toBe('A1234');
  });

  it('returns null when no fragment of length ≥3 overlaps', () => {
    expect(matchWhitelistPlate('XYZ9', whitelist)).toBeNull();
    expect(classificationFromMatch(null)).toBe('suspected_external');
  });

  it('matches when OCR reads extra characters (whitelist body ⊆ scan)', () => {
    const match = matchWhitelistPlate('京A12345X', whitelist);
    expect(match).toMatchObject({
      mode: 'partial',
      direction: 'whitelist_in_scan',
      category: 'private',
      matchedPlate: '京A12345',
      fragment: 'A12345',
    });
    expect(classificationFromMatch(match)).toBe('registered_private');
  });

  it('matches ASCII whitelist body inside noisy scan', () => {
    const match = matchWhitelistPlate('XXA99999YY', whitelist);
    expect(match).toMatchObject({
      mode: 'partial',
      direction: 'whitelist_in_scan',
      matchedPlate: 'A99999',
      fragment: 'A99999',
    });
  });

  it('still uses scan_in_whitelist for incomplete OCR shorter than whitelist body', () => {
    const match = matchWhitelistPlate('A123', whitelist);
    expect(match?.direction).toBe('scan_in_whitelist');
  });
});
