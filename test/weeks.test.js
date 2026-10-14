import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addWeeks, currentWeek, easterSunday, formatMoment, formatRange, fridaysOf, isWeekId, mondayOf, monthOf, weekIdOf,
  weekNumber, weeksFrom,
} from '../src/weeks.js';

const day = (text) => new Date(`${text}T00:00:00Z`);
const iso = (date) => date.toISOString().slice(0, 10);

test('a week is named after the ISO week, Monday to Sunday, its first Friday is in', () => {
  assert.equal(weekIdOf(day('2026-10-11')), '2026-W41');
  assert.equal(weekIdOf(day('2026-10-12')), '2026-W42');
  assert.equal(weekIdOf(day('2026-10-18')), '2026-W42');
  assert.equal(weekIdOf(day('2026-10-19')), '2026-W43');
});

test('the days around New Year belong to the week they are in, not the year', () => {
  assert.equal(weekIdOf(day('2026-12-31')), '2026-W53');
  assert.equal(weekIdOf(day('2027-01-03')), '2026-W53');
  assert.equal(weekIdOf(day('2027-01-04')), '2027-W01');
  assert.equal(weekIdOf(day('2024-12-30')), '2025-W01');
});

test('a week runs from Friday to Friday', () => {
  const { from, to } = fridaysOf('2026-W42');
  assert.equal(iso(from), '2026-10-16');
  assert.equal(iso(to), '2026-10-23');
  assert.equal(iso(fridaysOf('2027-W12').from), '2027-03-26', 'Easter week starts on Good Friday');
  assert.equal(iso(fridaysOf('2026-W53').from), '2027-01-01');
  assert.equal(iso(fridaysOf('2026-W53').to), iso(fridaysOf('2027-W01').from));
});

test('a week is named from its Monday', () => {
  assert.equal(iso(mondayOf('2026-W42')), '2026-10-12');
  assert.equal(iso(mondayOf('2027-W12')), '2027-03-22');
  assert.equal(iso(mondayOf('2026-W53')), '2026-12-28');
  assert.equal(iso(mondayOf('2027-W01')), '2027-01-04');
});

test('only weeks that exist are weeks', () => {
  assert.equal(isWeekId('2026-W53'), true);
  assert.equal(isWeekId('2027-W53'), false, '2027 has 52 weeks');
  assert.equal(isWeekId('2027-W00'), false);
  assert.equal(isWeekId('2027-W1'), false);
  assert.equal(isWeekId('uke 12'), false);
  assert.equal(isWeekId(undefined), false);
});

test('weeks are counted across New Year', () => {
  assert.equal(addWeeks('2026-W52', 2), '2027-W01');
  assert.deepEqual(weeksFrom('2026-W52', 3), ['2026-W52', '2026-W53', '2027-W01']);
  assert.equal(weekNumber('2027-W08'), 8);
});

test('weeks sort as text', () => {
  const weeks = weeksFrom('2026-W40', 70);
  assert.deepEqual([...weeks].sort(), weeks);
});

test('the week changes on Friday at noon in Norway', () => {
  // Summer time: noon in Oslo is 10:00 UTC.
  assert.equal(currentWeek(new Date('2026-10-16T09:59:59Z')), '2026-W41');
  assert.equal(currentWeek(new Date('2026-10-16T10:00:00Z')), '2026-W42');
  assert.equal(currentWeek(new Date('2026-10-18T12:00:00Z')), '2026-W42', 'Sunday');
  assert.equal(currentWeek(new Date('2026-10-22T21:00:00Z')), '2026-W42', 'Thursday night');
  // Winter time: noon in Oslo is 11:00 UTC.
  assert.equal(currentWeek(new Date('2027-01-01T10:59:59Z')), '2026-W52');
  assert.equal(currentWeek(new Date('2027-01-01T11:00:00Z')), '2026-W53');
  assert.equal(currentWeek(new Date('2027-01-08T11:00:00Z')), '2027-W01');
  // The night summer time starts.
  assert.equal(currentWeek(new Date('2027-03-28T01:30:00Z')), '2027-W12');
});

test('Easter Sunday falls where the almanac says', () => {
  assert.equal(iso(easterSunday(2025)), '2025-04-20');
  assert.equal(iso(easterSunday(2026)), '2026-04-05');
  assert.equal(iso(easterSunday(2027)), '2027-03-28');
  assert.equal(iso(easterSunday(2028)), '2028-04-16');
  assert.equal(iso(easterSunday(2038)), '2038-04-25');
});

test('a week is written with its Fridays', () => {
  assert.equal(formatRange('2026-W42'), 'fre. 16. – fre. 23. oktober 2026');
  assert.equal(formatRange('2027-W12'), 'fre. 26. mars – fre. 2. april 2027');
  assert.equal(formatRange('2026-W52'), 'fre. 25. desember 2026 – fre. 1. januar 2027');
  assert.equal(formatRange('2026-W42', { year: false }), 'fre. 16. – fre. 23. oktober');
  assert.equal(formatRange('2026-W52', { year: false }), 'fre. 25. desember – fre. 1. januar');
});

test('a week is listed under the month most of its nights fall in', () => {
  assert.equal(monthOf('2027-W12'), 'Mars 2027');
  assert.equal(monthOf('2027-W13'), 'April 2027');
  assert.equal(monthOf('2026-W44'), 'November 2026', 'two nights in October, five in November');
  assert.equal(monthOf('2026-W53'), 'Januar 2027');
});

test('a moment is written in Norwegian time', () => {
  const text = formatMoment('2026-10-11T13:42:00.000Z');
  assert.match(text, /11\. oktober 2026/);
  assert.match(text, /15[:.]42/);
});
