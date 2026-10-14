import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyState } from '../src/cabin.js';
import { fridayOverview } from '../src/overview.js';
import { comingWeek } from '../src/weeks.js';

test('the coming week is the one that starts this Friday, or today on a Friday', () => {
  assert.equal(comingWeek(new Date('2026-10-14T10:00:00Z')), '2026-W42', 'Wednesday');
  assert.equal(comingWeek(new Date('2026-10-16T06:00:00Z')), '2026-W42', 'Friday morning');
  assert.equal(comingWeek(new Date('2026-10-16T20:00:00Z')), '2026-W42', 'Friday evening');
  assert.equal(comingWeek(new Date('2026-10-17T10:00:00Z')), '2026-W43', 'Saturday');
  // Half past midnight on Friday in Oslo is still Thursday in UTC.
  assert.equal(comingWeek(new Date('2026-10-15T22:30:00Z')), '2026-W42');
  assert.equal(comingWeek(new Date('2026-12-30T10:00:00Z')), '2026-W53', 'Friday 1 January');
});

test('the overview tells who has the cabin the next four weeks', () => {
  const state = emptyState();
  state.bookings['2027-W06'] = { name: 'Ola Nordmann', at: '2026-10-14T08:00:00.000Z' };
  state.draws['2027-W08'] = { label: 'Vinterferie', entries: [{ name: 'Kari Hansen' }, { name: 'Per Olsen' }] };
  state.draws['2027-W09'] = { label: '', entries: [{ name: 'Kari Hansen' }] };
  state.bookings['2027-W09'] = { name: 'Kari Hansen', at: '2026-10-14T08:00:00.000Z' };

  assert.equal(fridayOverview(state, new Date('2027-02-12T10:00:00Z')), [
    'Hytta de neste fire ukene',
    '',
    'Uke 6, fre. 12. – fre. 19. februar 2027: Ola Nordmann',
    'Uke 7, fre. 19. – fre. 26. februar 2027: ledig',
    'Uke 8 (Vinterferie), fre. 26. februar – fre. 5. mars 2027: trekning, 2 påmeldte, ikke trukket ennå',
    'Uke 9, fre. 5. – fre. 12. mars 2027: Kari Hansen, som vant trekningen',
    '',
    'Uka går fra fredag til fredag. De som reiser, er ute klokka tolv, og de som kommer, kommer etter jobb.',
  ].join('\n'));
});

test('a draw nobody has entered says so', () => {
  const state = emptyState();
  state.draws['2026-W42'] = { label: 'Høstferie', entries: [] };
  assert.match(fridayOverview(state, new Date('2026-10-16T10:00:00Z')), /Uke 42 \(Høstferie\), .*: trekning, ingen påmeldt ennå/);
});
