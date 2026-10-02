import { describe, it, expect } from 'vitest';
import { matchDamagedApn } from '../../scripts/apn-recovery';
import { isDifferentLocation, matchPropertyByLocation, normalizeCounty } from '../../shared/property-location';

describe('matchDamagedApn', () => {
  it('restores dropped leading zeros', () => {
    expect(matchDamagedApn('004399', 4399)).toBe('leading_zeros');
    expect(matchDamagedApn('0005230', 5230)).toBe('leading_zeros');
  });

  it('restores digits lost to scientific notation', () => {
    expect(matchDamagedApn('0130201000603', 130201000000)).toBe('precision');
    expect(matchDamagedApn('090023300010002', 90023300000000)).toBe('precision');
    expect(matchDamagedApn('8896956463901', 8896960000000)).toBe('precision');
  });

  it('restores an APN that was read as an exponent', () => {
    expect(matchDamagedApn('464E222', 4.64e224)).toBe('exponent');
  });

  it('restores rounded decimals from a numeric parent', () => {
    expect(matchDamagedApn(290122262.007, 290122262.01)).toBe('precision');
    // An integer only matches a decimal parent on a row tied by owner + address.
    expect(matchDamagedApn(290122263.003, 290122263)).toBeNull();
    expect(matchDamagedApn(290122263.003, 290122263, false)).toBe('precision');
  });

  it('reports the same value as identical, not as a recovery', () => {
    expect(matchDamagedApn('5553', 5553)).toBe('identical');
    expect(matchDamagedApn(5553, 5553)).toBe('identical');
  });

  it('rejects APNs that are not the same number', () => {
    expect(matchDamagedApn('004398', 4399)).toBeNull();
    expect(matchDamagedApn('06-2-0210-0009', 4399)).toBeNull();
    expect(matchDamagedApn('0130301000603', 130201000000)).toBeNull(); // different digits
    expect(matchDamagedApn('130201000603000', 130201000000)).toBeNull(); // different length
    expect(matchDamagedApn('', 4399)).toBeNull();
  });
});

describe('property location', () => {
  it('normalizes the ways a county is written', () => {
    expect(normalizeCounty('Benton County')).toBe('BENTON');
    expect(normalizeCounty('BENTON')).toBe('BENTON');
    expect(normalizeCounty('Grays-harbor County')).toBe('GRAYSHARBOR');
    expect(normalizeCounty(null)).toBe('');
  });

  it('tells different counties and states apart, and tolerates blanks', () => {
    expect(isDifferentLocation({ state: 'AR', county: 'Washington' }, { state: 'AR', county: 'JOHNSON COUNTY' })).toBe(true);
    expect(isDifferentLocation({ state: 'TX', county: 'Presidio' }, { state: 'NH', county: 'SULLIVAN' })).toBe(true);
    expect(isDifferentLocation({ state: 'AR', county: 'Benton' }, { state: 'AR', county: 'Bentonville' })).toBe(false);
    expect(isDifferentLocation({ state: 'AR', county: 'Benton' }, { state: null, county: null })).toBe(false);
  });

  it('picks the property in the same place', () => {
    const washington = { id: 1, state: 'AR', county: 'Washington' };
    const johnson = { id: 2, state: 'AR', county: 'Johnson' };
    expect(matchPropertyByLocation([washington, johnson], { state: 'AR', county: 'JOHNSON COUNTY' })).toEqual({ match: johnson, ambiguous: false });
    expect(matchPropertyByLocation([washington], { state: 'AR', county: 'Grant' })).toEqual({ match: null, ambiguous: false });
    expect(matchPropertyByLocation([washington], {})).toEqual({ match: washington, ambiguous: false });
    expect(matchPropertyByLocation([washington, johnson], {}).ambiguous).toBe(true);
  });
});
