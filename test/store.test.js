import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { book, emptyState } from '../src/cabin.js';
import { openStore } from '../src/store.js';

const wish = { week: '2026-W45', name: 'Ola Nordmann', today: '2026-W42', now: '2026-10-14T08:00:00.000Z' };
const onDisk = (file) => JSON.parse(readFileSync(file, 'utf8'));

// Each test has a folder of its own, and they are all removed at the end.
const folders = [];
const newFile = () => {
  folders.push(mkdtempSync(join(tmpdir(), 'hytteboka-')));
  return join(folders.at(-1), 'data', 'bok.json');
};
after(() => folders.forEach((folder) => rmSync(folder, { recursive: true, force: true })));

test('a book that is not there yet is made, in a folder that is not there yet', () => {
  const file = newFile();
  const store = openStore(file, () => ({ bookings: {}, draws: { '2027-W12': { label: 'Påske', entries: [] } } }));

  assert.equal(store.state.draws['2027-W12'].label, 'Påske');
  assert.deepEqual(onDisk(file), store.state);
});

test('a change is on disk when it is answered, and is there the next time the book is opened', () => {
  const file = newFile();
  const store = openStore(file, emptyState);

  assert.deepEqual(store.change(book, wish), { ok: true });
  assert.equal(onDisk(file).bookings['2026-W45'].name, 'Ola Nordmann');

  const reopened = openStore(file, () => assert.fail('a book that is there is not made again'));
  assert.equal(reopened.state.bookings['2026-W45'].name, 'Ola Nordmann');
  assert.deepEqual(readdirSync(join(file, '..')), ['bok.json'], 'nothing is left beside the book');
});

test('a wish that is refused leaves the book and the file as they were', () => {
  const file = newFile();
  const store = openStore(file, emptyState);
  store.change(book, wish);
  const before = readFileSync(file, 'utf8');
  const stateBefore = store.state;

  const answer = store.change(book, { ...wish, name: 'Kari Hansen' });

  assert.equal(answer.ok, false);
  assert.equal(store.state, stateBefore);
  assert.equal(readFileSync(file, 'utf8'), before);
});

test('a rule that changes something and then says no has changed nothing', () => {
  const store = openStore(newFile(), emptyState);
  const answer = store.change((state) => {
    state.bookings['2026-W45'] = { name: 'Halvveis', at: wish.now };
    return { ok: false, status: 409, message: 'Nei' };
  });

  assert.equal(answer.ok, false);
  assert.deepEqual(store.state, emptyState());
});

test('a book from before there were PINs is opened with nobody in it', () => {
  const file = newFile();
  openStore(file, () => ({ bookings: {}, draws: {} }));
  assert.deepEqual(openStore(file, emptyState).state.people, {});
});

test('a file that cannot be read stops the start, and is left alone', () => {
  const file = newFile();
  openStore(file, emptyState);
  writeFileSync(file, '{ "bookings": ');

  assert.throws(() => openStore(file, emptyState), SyntaxError);
  assert.equal(readFileSync(file, 'utf8'), '{ "bookings": ');
});
