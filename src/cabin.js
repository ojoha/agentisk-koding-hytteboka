// The rules of the cabin book.
//
// Everything that is stored is one object:
//
//   bookings: { [week]: { name, at } }                       who has the cabin that week
//   draws:    { [week]: { label, entries: [{ name, at }] } } the weeks a winner is drawn for
//   people:   { [key]: { name, pin } }                       the names in use, each with a hash of its PIN
//
// A week has at most one booking, since bookings are kept by week.
// A draw is done when its week has a booking: that booking is the winner, and its `at` is when it was drawn.
// A person's key is their name as `sameName` compares it, so a name has one PIN however it is typed.
//
// Each rule takes the state and what someone wants, and either changes the state and answers
// { ok: true }, or leaves it as it was and answers { ok: false, status, message } with words for the person.

import { randomInt } from 'node:crypto';
import { checkPin, hashPin, isPin } from './identity.js';
import { addWeeks, currentWeek, easterSunday, isWeekId, weekIdOf, weekNumber, weeksFrom } from './weeks.js';

/** How many weeks are shown and can be booked, counting the one we are in. */
export const HORIZON = 52;

/** How many ordinary weeks one person can have ahead. Weeks won in a draw do not count. */
export const QUOTA = 1;

/** For how long someone who won a draw stands behind the others in the next ones. */
const WINNER_WAITS = 365 * 24 * 60 * 60 * 1000;

const NAME_LENGTH = 60;
const LABEL_LENGTH = 40;

export function emptyState() {
  return { bookings: {}, draws: {}, people: {} };
}

/** What the book holds the first time it is opened: the weeks Gro named, set up for a draw. */
export function firstState(now = new Date()) {
  const state = emptyState();
  const today = currentWeek(now);
  const year = Number(today.slice(0, 4));
  const next = (weekIn) => [weekIn(year), weekIn(year + 1)].find((week) => isOpen(week, today));

  const winterBreak = next((y) => `${y}-W08`);
  const easter = next((y) => weekIdOf(easterSunday(y)));
  if (winterBreak) state.draws[winterBreak] = { label: 'Vinterferie', entries: [] };
  if (easter) state.draws[easter] = { label: 'Påske', entries: [] };
  return state;
}

/** A name as someone typed it, tidied. Empty when it cannot be used as a name. */
export function readName(text) {
  const name = tidy(text);
  return name.length <= NAME_LENGTH ? name : '';
}

export function sameName(a, b) {
  return nameKey(a) === nameKey(b);
}

/** The name as it is compared: tidied, and without capital letters. */
export function nameKey(name) {
  return tidy(name).toLocaleLowerCase('nb');
}

/** Whether a name is in use, with a PIN. */
export function isKnown(state, name) {
  return Boolean(name && state.people[nameKey(name)]);
}

/** The names in use, sorted, each with its key. */
export function people(state) {
  return Object.entries(state.people)
    .map(([key, person]) => ({ key, name: person.name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'nb'));
}

/**
 * Someone saying who they are. A name nobody uses yet is theirs, with the PIN they chose.
 * A name in use needs its PIN. The answer has the name as it was first written.
 */
export function claimName(state, { name, pin }) {
  const problem = nameProblem(name);
  if (problem) return problem;
  if (!isPin(pin)) return refuse('PIN-en er 4 til 6 sifre.', 400);

  const key = nameKey(name);
  const person = state.people[key];
  if (!person) {
    state.people[key] = { name: readName(name), pin: hashPin(pin) };
    return done({ name: state.people[key].name, isNew: true });
  }
  if (!checkPin(pin, person.pin)) return refuse(`Feil PIN for ${person.name}.`, 403);
  return done({ name: person.name, isNew: false });
}

/** For the office manager: the name is free again, and the next to use it chooses a new PIN. */
export function resetPin(state, { name }) {
  const key = nameKey(name);
  if (!state.people[key]) return refuse('Det navnet er ikke i bruk.', 404);
  delete state.people[key];
  return done();
}

export function isEntered(draw, name) {
  return draw.entries.some((entry) => sameName(entry.name, name));
}

/** The weeks from this one on, each with what stands in the book about it. */
export function calendar(state, today) {
  return weeksFrom(today, HORIZON).map((week) => describe(state, week));
}

export function describe(state, week) {
  return { week, booking: state.bookings[week] ?? null, draw: state.draws[week] ?? null };
}

export function book(state, { week, name, today, now }) {
  const problem = weekProblem(week, today) ?? nameProblem(name);
  if (problem) return problem;

  const booking = state.bookings[week];
  if (state.draws[week]) {
    return booking
      ? refuse(`Det er trukket lodd om ${uke(week)}, og den gikk til ${booking.name}.`)
      : refuse(`Det trekkes lodd om ${uke(week)}. Meld deg på trekningen i stedet.`);
  }
  if (booking) {
    return sameName(booking.name, name)
      ? refuse(`Du har allerede ${uke(week)}.`)
      : refuse(`${Uke(week)} er allerede booket av ${booking.name}.`);
  }

  const mine = ordinaryWeeksOf(state, name, today);
  if (mine.length >= QUOTA) {
    return refuse(`Du har allerede ${mine.map(uke).join(' og ')}. Du kan ha én vanlig uke om gangen.`);
  }

  state.bookings[week] = { name: readName(name), at: now };
  return done();
}

/** Giving a week up. A week that was won in a draw goes back to be drawn among the others. */
export function cancel(state, { week, name, today }) {
  const problem = weekProblem(week, today) ?? nameProblem(name);
  if (problem) return problem;

  const booking = state.bookings[week];
  if (!booking) return refuse(`${Uke(week)} er ikke booket.`);
  if (!sameName(booking.name, name)) return refuse(`${Uke(week)} er booket av ${booking.name}, ikke av deg.`, 403);

  delete state.bookings[week];
  const draw = state.draws[week];
  if (draw) draw.entries = draw.entries.filter((entry) => !sameName(entry.name, name));
  return done();
}

export function enter(state, { week, name, today, now }) {
  const problem = weekProblem(week, today) ?? nameProblem(name) ?? drawProblem(state, week);
  if (problem) return problem;

  const draw = state.draws[week];
  if (isEntered(draw, name)) return refuse(`Du er allerede påmeldt trekningen om ${uke(week)}.`);

  draw.entries.push({ name: readName(name), at: now });
  return done();
}

export function withdraw(state, { week, name, today }) {
  const problem = weekProblem(week, today) ?? nameProblem(name) ?? drawProblem(state, week);
  if (problem) return problem;

  const draw = state.draws[week];
  if (!isEntered(draw, name)) return refuse(`Du er ikke påmeldt trekningen om ${uke(week)}.`);

  draw.entries = draw.entries.filter((entry) => !sameName(entry.name, name));
  return done();
}

/**
 * Draws the winner and books the week for them. Those who won a draw in the last 12 months
 * stand behind: they can only win when nobody else has entered. Everyone else has the same chance.
 * `pick(count)` answers a whole number from 0 up to, not including, count.
 * `winner` and `behind` are places in `entries`.
 */
export function drawWinner(state, { week, today, now, pick = randomInt }) {
  const problem = weekProblem(week, today) ?? drawProblem(state, week);
  if (problem) return problem;

  const { entries } = state.draws[week];
  if (entries.length === 0) return refuse(`Ingen har meldt seg på trekningen om ${uke(week)} ennå.`);

  const behind = standingBehind(state, week, now);
  const candidates = entries.map((entry, index) => index).filter((index) => !behind.includes(index));
  const winner = candidates[pick(candidates.length)];
  state.bookings[week] = { name: entries[winner].name, at: now };
  return done({ winner, entries: entries.map((entry) => entry.name), behind });
}

/**
 * The places in a draw's entries of those who won another draw in the 12 months before `now`
 * (for a draw that is done, before it was drawn). When all of them did, nobody stands behind.
 */
export function standingBehind(state, week, now) {
  const { entries } = state.draws[week];
  const winners = recentWinners(state, state.bookings[week]?.at ?? now, week);
  const behind = entries.map((entry, index) => index).filter((index) => winners.has(nameKey(entries[index].name)));
  return behind.length < entries.length ? behind : [];
}

function recentWinners(state, now, exceptWeek) {
  const until = Date.parse(now);
  const winners = new Set();
  for (const week of Object.keys(state.draws)) {
    const booking = state.bookings[week];
    if (!booking || week === exceptWeek) continue;
    const at = Date.parse(booking.at);
    if (at <= until && until - at < WINNER_WAITS) winners.add(nameKey(booking.name));
  }
  return winners;
}

export function markDraw(state, { week, label, today }) {
  const problem = weekProblem(week, today);
  if (problem) return problem;

  const title = tidy(label);
  if (title.length > LABEL_LENGTH) return refuse(`Navnet på uka kan være på ${LABEL_LENGTH} tegn.`, 400);
  if (state.draws[week]) return refuse(`Det trekkes allerede lodd om ${uke(week)}.`);
  const booking = state.bookings[week];
  if (booking) return refuse(`${Uke(week)} er allerede booket av ${booking.name}, så den kan det ikke trekkes lodd om.`);

  state.draws[week] = { label: title, entries: [] };
  return done();
}

export function unmarkDraw(state, { week, today }) {
  const problem = weekProblem(week, today) ?? drawProblem(state, week);
  if (problem) return problem;

  const count = state.draws[week].entries.length;
  if (count > 0) {
    return refuse(`${count} har meldt seg på trekningen om ${uke(week)}, så den kan ikke gjøres om til en vanlig uke.`);
  }

  delete state.draws[week];
  return done();
}

export function uke(week) {
  return `uke ${weekNumber(week)}`;
}

export function Uke(week) {
  return `Uke ${weekNumber(week)}`;
}

/** The ordinary weeks someone has booked that are not over. */
function ordinaryWeeksOf(state, name, today) {
  return Object.entries(state.bookings)
    .filter(([week, booking]) => week >= today && !state.draws[week] && sameName(booking.name, name))
    .map(([week]) => week)
    .sort();
}

function isOpen(week, today) {
  return isWeekId(week) && week >= today && week < addWeeks(today, HORIZON);
}

function weekProblem(week, today) {
  if (!isWeekId(week)) return refuse('Den uka finnes ikke.', 404);
  if (week < today) return refuse(`${Uke(week)} er over.`);
  if (!isOpen(week, today)) return refuse(`${Uke(week)} er for langt fram til å stå i boka ennå.`);
  return null;
}

function nameProblem(name) {
  return readName(name) ? null : refuse('Skriv navnet ditt først.', 400);
}

/** Why nobody can enter, leave or draw: there is no draw for the week, or it is done. */
function drawProblem(state, week) {
  if (!state.draws[week]) return refuse(`Det trekkes ikke lodd om ${uke(week)}.`);
  const booking = state.bookings[week];
  if (booking) return refuse(`Trekningen om ${uke(week)} er gjort. Uka gikk til ${booking.name}.`);
  return null;
}

function tidy(text) {
  return String(text ?? '')
    .normalize('NFC')
    .replace(/[\p{Cc}\s]+/gu, ' ')
    .trim();
}

function refuse(message, status = 409) {
  return { ok: false, status, message };
}

function done(more = {}) {
  return { ok: true, ...more };
}
