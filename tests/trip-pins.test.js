import { it, expect } from 'vitest';
import { groupTrips, tripPinRows } from '../src/lib/export/trip-pins.js';

const trip = { arrival: '2026-11-09', departure: '2026-11-12', transportNo: 'TEST123', address1: 'ONE TEST ROAD' };
const record = (name, pin, changes = {}) => ({ profileSnapshot: { name, passportNo: 'PRIVATE', email: 'private@example.invalid' }, tripSnapshot: { ...trip, ...changes }, ...(pin ? { receipt: { reference: pin } } : {}) });

it('groups matching trip snapshots without combining another flight or accommodation', () => {
  const records = [record('ONE', 'aBc123'), record('TWO', 'DeF456'), record('THREE', 'xYz789', { transportNo: 'OTHER123' }), record('FOUR', 'tEsT22', { address1: 'ANOTHER TEST ROAD' })];
  const groups = groupTrips(records);
  expect(groups.map(group => group.submissions.map(item => item.profileSnapshot.name))).toEqual([['ONE', 'TWO'], ['THREE'], ['FOUR']]);
  expect(records[0].tripSnapshot).toEqual(trip);
});

it('exports only names and recorded PINs with their original case', () => {
  expect(tripPinRows([record('TEST PERSON', 'aBcDeF12'), record('PENDING PERSON')])).toEqual([
    { name: 'TEST PERSON', pin: 'aBcDeF12' },
    { name: 'PENDING PERSON', pin: '' },
  ]);
});

it('does not split one trip because snapshot property order differs', () => {
  const a = record('ONE', 'one'), b = record('TWO', 'two');
  b.tripSnapshot = Object.fromEntries(Object.entries(trip).reverse());
  expect(groupTrips([a, b])).toHaveLength(1);
  expect(groupTrips([])).toEqual([]);
});
