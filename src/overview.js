// The overview Gro sends out every Friday: who has the cabin the next four weeks.
// It is plain text, so it can go straight into an e-mail or a chat.

import { describe, Uke } from './cabin.js';
import { comingWeek, formatRange, weeksFrom } from './weeks.js';

export const OVERVIEW_WEEKS = 4;

/** The overview from the week that starts this Friday, as lines of text. */
export function fridayOverview(state, now) {
  const weeks = weeksFrom(comingWeek(now), OVERVIEW_WEEKS).map((week) => describe(state, week));
  return [
    'Hytta de neste fire ukene',
    '',
    ...weeks.map(line),
    '',
    'Uka går fra fredag til fredag. De som reiser, er ute klokka tolv, og de som kommer, kommer etter jobb.',
  ].join('\n');
}

function line({ week, booking, draw }) {
  const label = draw?.label ? ` (${draw.label})` : '';
  return `${Uke(week)}${label}, ${formatRange(week)}: ${who({ booking, draw })}`;
}

function who({ booking, draw }) {
  if (booking) return draw ? `${booking.name}, som vant trekningen` : booking.name;
  if (!draw) return 'ledig';
  const count = draw.entries.length;
  if (count === 0) return 'trekning, ingen påmeldt ennå';
  return `trekning, ${count === 1 ? '1 påmeldt' : `${count} påmeldte`}, ikke trukket ennå`;
}
