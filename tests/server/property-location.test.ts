import { describe, expect, it } from 'vitest';
import { canonicalCounty, normalizeCounty } from '../../shared/property-location.ts';

// properties.county is free text from many sources. canonicalCounty is the one
// stored/displayed form: Title Case with the trailing "County" word removed.

describe('canonicalCounty', () => {
  it.each([
    ['Benton', 'Benton'],
    ['Benton County', 'Benton'],
    ['DAVIDSON', 'Davidson'],
    ['APACHE COUNTY', 'Apache'],
    ['Apache County', 'Apache'],
    ['Saguache County', 'Saguache'],
    ['SAGUACHE COUNTY', 'Saguache'],
    ['Washington', 'Washington'],
    ['WASHINGTON COUNTY', 'Washington'],
    ['benton county', 'Benton'],
  ])('strips the suffix and title-cases %j -> %j', (input, expected) => {
    expect(canonicalCounty(input)).toBe(expected);
  });

  it.each([
    ['  Benton  ', 'Benton'],
    ['Benton   County', 'Benton'],
    ['\tGRAND   TRAVERSE \n', 'Grand Traverse'],
    ['Van  Buren County ', 'Van Buren'],
  ])('trims and collapses whitespace in %j', (input, expected) => {
    expect(canonicalCounty(input)).toBe(expected);
  });

  it.each([null, undefined, '', '   ', '\t\n'])('returns null for the blank value %j', (input) => {
    expect(canonicalCounty(input)).toBeNull();
  });

  it.each([
    ['St. Lucie', 'St. Lucie'],
    ['ST. LUCIE COUNTY', 'St. Lucie'],
    ['Miami-Dade', 'Miami-Dade'],
    ['MIAMI-DADE COUNTY', 'Miami-Dade'],
    ['Grays-harbor County', 'Grays-Harbor'],
    ['HOT-SPRING COUNTY', 'Hot-Spring'],
    ['VAN BUREN', 'Van Buren'],
    ['grand traverse county', 'Grand Traverse'],
    ["PRINCE GEORGE'S COUNTY", "Prince George's"],
    ["O'BRIEN", "O'Brien"],
    ['MCDONALD COUNTY', 'McDonald'],
    ['DEKALB', 'DeKalb'],
    ['DeKalb County', 'DeKalb'],
    ['FOND DU LAC', 'Fond du Lac'],
    ['ISLE OF WIGHT COUNTY', 'Isle of Wight'],
    ['LAKE OF THE WOODS', 'Lake of the Woods'],
    ['KING AND QUEEN', 'King and Queen'],
    ['DOÑA ANA COUNTY', 'Doña Ana'],
  ])('keeps the multi-word / punctuated name %j intact -> %j', (input, expected) => {
    expect(canonicalCounty(input)).toBe(expected);
  });

  it.each([
    ['County', 'County'],
    ['COUNTYLINE', 'Countyline'],
    ['County Line', 'County Line'],
    ['Bentonville', 'Bentonville'],
    ['Benton Countyside', 'Benton Countyside'],
  ])('only strips "County" as a trailing word: %j -> %j', (input, expected) => {
    expect(canonicalCounty(input)).toBe(expected);
  });

  const SAMPLES = [
    'Benton', 'Benton County', 'BENTON COUNTY', 'benton county county', ' APACHE  COUNTY ', 'St. Lucie',
    'MIAMI-DADE', 'Grays-harbor County', "PRINCE GEORGE'S", "O'BRIEN", 'MCDONALD', 'DEKALB', 'FOND DU LAC',
    'THE DALLES', 'County', 'A', 'MC', 'DOÑA ANA', 'Test',
  ];

  it.each(SAMPLES)('is idempotent for %j', (input) => {
    const once = canonicalCounty(input);
    expect(canonicalCounty(once)).toBe(once);
  });

  it('gives every spelling of one county the same value', () => {
    const spellings = ['Apache', 'APACHE', 'Apache County', 'APACHE COUNTY', 'apache county', ' Apache  County '];
    expect(new Set(spellings.map(canonicalCounty))).toEqual(new Set(['Apache']));
  });

  // The unique index properties_apn_location_idx keys on normalizeCounty, so
  // rewriting a stored county to its canonical form must not move the row.
  it.each([
    'Benton', 'Benton County', 'BENTON COUNTY', 'DAVIDSON', 'Saguache County', 'St. Lucie County',
    'MIAMI-DADE COUNTY', 'Grays-harbor County', 'HOT-SPRING COUNTY', "Prince George's County", 'Bentonville',
    'MCDONALD COUNTY', 'Van  Buren', 'County',
  ])('leaves the normalizeCounty index key of %j unchanged', (input) => {
    expect(normalizeCounty(canonicalCounty(input))).toBe(normalizeCounty(input));
  });
});
