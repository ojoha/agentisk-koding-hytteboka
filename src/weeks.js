// A week on the cabin runs from Friday to Friday. Those who leave are out by noon, and those who
// come arrive after work. A week is named after the ISO week its first Friday is in, written
// "2027-W12": week 12 of 2027 runs from Friday 26 March to Friday 2 April.
// Written that way, weeks sort as text: "2026-W53" < "2027-W01".
//
// Every date here is a calendar day held as midnight UTC, so summer time never moves one.

const DAY = 86_400_000;
const HOUR = 3_600_000;
// From the Monday of an ISO week to the moment the cabin week named after it starts: Friday at noon.
const FRIDAY_NOON = 4 * DAY + 12 * HOUR;
const WEEK_ID = /^(\d{4})-W(\d{2})$/;

const MONTHS = [
  'januar', 'februar', 'mars', 'april', 'mai', 'juni',
  'juli', 'august', 'september', 'oktober', 'november', 'desember',
];

const osloClock = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Oslo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

const osloMoment = new Intl.DateTimeFormat('nb-NO', {
  timeZone: 'Europe/Oslo',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function weekIdOf(date) {
  // A week belongs to the year its Thursday is in.
  const thursday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  thursday.setUTCDate(thursday.getUTCDate() + 4 - (thursday.getUTCDay() || 7));
  const year = thursday.getUTCFullYear();
  const week = Math.ceil(((thursday.getTime() - Date.UTC(year, 0, 1)) / DAY + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** The Monday a week starts on, or null when the text names no week (as "2027-W53" does not). */
export function mondayOf(id) {
  const match = WEEK_ID.exec(id);
  if (!match) return null;
  const year = Number(match[1]);
  const week = Number(match[2]);
  // 4 January is always in week 1.
  const monday = new Date(Date.UTC(year, 0, 4));
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() || 7) + 1 + (week - 1) * 7);
  return weekIdOf(monday) === id ? monday : null;
}

/** The Friday a week starts on, and the Friday it ends on. */
export function fridaysOf(id) {
  const friday = new Date(mondayOf(id).getTime() + 4 * DAY);
  return { from: friday, to: new Date(friday.getTime() + 7 * DAY) };
}

export function isWeekId(id) {
  return typeof id === 'string' && mondayOf(id) !== null;
}

export function weekNumber(id) {
  return Number(id.slice(-2));
}

export function addWeeks(id, count) {
  return weekIdOf(new Date(mondayOf(id).getTime() + count * 7 * DAY));
}

export function weeksFrom(id, count) {
  return Array.from({ length: count }, (_, index) => addWeeks(id, index));
}

/** The week the cabin is in at this moment, by the clock in Norway. A week ends on Friday at noon. */
export function currentWeek(now = new Date()) {
  const parts = Object.fromEntries(osloClock.formatToParts(now).map((part) => [part.type, Number(part.value)]));
  const clock = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  // Moved back to the Monday of its ISO week, Friday at noon starts that week's cabin week.
  return weekIdOf(new Date(clock - FRIDAY_NOON));
}

/** The week that starts on Friday this week, or today when it is Friday, by the calendar in Norway. */
export function comingWeek(now = new Date()) {
  const parts = Object.fromEntries(osloClock.formatToParts(now).map((part) => [part.type, Number(part.value)]));
  const day = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  day.setUTCDate(day.getUTCDate() + ((5 - day.getUTCDay() + 7) % 7));
  return weekIdOf(day);
}

export function easterSunday(year) {
  // The anonymous Gregorian algorithm (Meeus, Jones, Butcher).
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

/** "fre. 26. mars – fre. 2. april 2027", or without the year where a heading above already says it. */
export function formatRange(id, { year = true } = {}) {
  const { from, to } = fridaysOf(id);
  const sameYear = from.getUTCFullYear() === to.getUTCFullYear();
  const opening = year && !sameYear ? ` ${from.getUTCFullYear()}` : '';
  const closing = year ? ` ${to.getUTCFullYear()}` : '';
  if (from.getUTCMonth() === to.getUTCMonth()) return `fre. ${from.getUTCDate()}. – fre. ${formatDay(to)}${closing}`;
  return `fre. ${formatDay(from)}${opening} – fre. ${formatDay(to)}${closing}`;
}

/** "26. mars". */
export function formatDay(date) {
  return `${date.getUTCDate()}. ${MONTHS[date.getUTCMonth()]}`;
}

/** "2027-03-26", for a <time> element. */
export function isoDay(date) {
  return date.toISOString().slice(0, 10);
}

/** The month a week is listed under: the one most of its nights fall in, which is that of its Monday. */
export function monthOf(id) {
  const monday = new Date(fridaysOf(id).from.getTime() + 3 * DAY);
  const name = MONTHS[monday.getUTCMonth()];
  return `${name[0].toUpperCase()}${name.slice(1)} ${monday.getUTCFullYear()}`;
}

/** "11. oktober 2026 kl. 15:42", in Norwegian time, from a stored moment. */
export function formatMoment(iso) {
  return osloMoment.format(new Date(iso));
}
