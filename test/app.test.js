// The server as people meet it: every request here goes over HTTP to a server on a port of its own,
// with a book in a folder of its own. The day is Wednesday 14 October 2026, in week 42.

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { firstState } from '../src/cabin.js';
import { sign } from '../src/identity.js';
import { openStore } from '../src/store.js';

const NOW = new Date('2026-10-14T10:00:00Z');
const SECRET = 'test-nøkkel';
const CODE = 'kode-til-gro';
const PIN = '1234';
const AUTUMN = '2026-W45';
const EASTER = '2027-W12';

let server;
let origin;
let file;
let clock;
let round = 0;

before(() => {
  server = createServer((request, response) => server.app(request, response));
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      origin = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

// Every test opens a new book, in a folder that is removed at the end.
const folders = [];
beforeEach(() => {
  folders.push(mkdtempSync(join(tmpdir(), 'hytteboka-')));
  file = join(folders.at(-1), 'bok.json');
  clock = NOW;
  round += 1;
  server.app = createApp({
    store: openStore(file, () => firstState(NOW)), now: () => clock, secret: SECRET, managerCode: CODE,
  });
});

after(() => {
  folders.forEach((folder) => rmSync(folder, { recursive: true, force: true }));
  return new Promise((resolve) => server.close(resolve));
});

const post = (path, form = {}, headers = {}) =>
  fetch(origin + path, { method: 'POST', headers, body: new URLSearchParams(form), redirect: 'manual' });

/** The cookie a form answered with, as a browser sends it back. */
async function cookieFrom(path, form) {
  const response = await post(path, form);
  assert.equal(response.status, 303, `${path} let nobody in`);
  return response.headers.get('set-cookie').split(';')[0];
}

/**
 * One person's browser. The first time it is used in a test, it gives the name with the PIN
 * (and the office manager's code, for the manager), and from then on sends the cookies it got.
 */
function person(name, { manager = false } = {}) {
  let cookies;
  let cookiesFor;
  const headers = async () => {
    if (cookiesFor !== round) {
      cookiesFor = round;
      cookies = [];
      if (name) cookies.push(await cookieFrom('/navn', { navn: name, pin: PIN }));
      if (manager) cookies.push(await cookieFrom('/kontorsjef/inn', { kode: CODE }));
    }
    return cookies.length > 0 ? { Cookie: cookies.join('; ') } : {};
  };
  return {
    get: async (path) => fetch(origin + path, { headers: await headers(), redirect: 'manual' }),
    post: async (path, form = {}, more = {}) => post(path, form, { ...(await headers()), ...more }),
  };
}

/** A browser that sends just the cookie it is given. */
const withCookie = (cookie) => ({
  get: (path) => fetch(origin + path, { headers: { Cookie: cookie }, redirect: 'manual' }),
  post: (path, form = {}) => post(path, form, { Cookie: cookie }),
});

const ola = person('Ola Nordmann');
const kari = person('Kari Hansen');
const per = person('Per Olsen');
const visitor = person('');
const gro = person('', { manager: true });
const book = () => JSON.parse(readFileSync(file, 'utf8'));

/** The card of one week on the calendar, as text without tags. */
async function card(who, week) {
  const page = await (await who.get('/')).text();
  const found = new RegExp(`<li class="week[^>]*id="${week}">([\\s\\S]*?)</li>`).exec(page);
  assert.ok(found, `no card for ${week}`);
  return found[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

describe('the calendar', () => {
  test('shows the 52 weeks from this one, with Easter and the winter break set up for a draw', async () => {
    const response = await visitor.get('/');
    const page = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.equal(page.match(/<li class="week /g).length, 52);
    assert.match(page, /<h2>Oktober 2026<\/h2>/);
    assert.match(await card(visitor, '2026-W42'), /^Uke 42 12\.–18\. oktober Denne uka Ledig$/);
    assert.match(await card(visitor, EASTER), /Uke 12 22\.–28\. mars Trekning · Påske Ingen påmeldt ennå Se trekningen/);
    assert.match(await card(visitor, '2027-W08'), /Trekning · Vinterferie/);
  });

  test('asks who you are, and offers no buttons until it knows', async () => {
    const page = await (await visitor.get('/')).text();
    assert.match(page, /Hvem er du\?/);
    assert.doesNotMatch(page, /Book uka/);
    assert.match(await (await ola.get('/')).text(), /Book uka/);
  });

  test('remembers the name someone types with their PIN, and forgets it when they ask', async () => {
    const typed = await visitor.post('/navn', { navn: '  Ola   Nordmann ', pin: PIN });
    assert.equal(typed.status, 303);
    assert.equal(typed.headers.get('location'), '/');
    assert.match(typed.headers.get('set-cookie'), /^navn=navn%3AOla%20Nordmann\.[\w-]+; Path=\/; Max-Age=31536000; HttpOnly/);

    const page = await (await ola.get('/')).text();
    assert.match(page, /Du er <strong>Ola Nordmann<\/strong>/);
    assert.doesNotMatch(page, /Hvem er du\?/);

    const forgotten = await ola.post('/navn');
    assert.equal(forgotten.status, 303);
    assert.match(forgotten.headers.get('set-cookie'), /^navn=; Path=\/; Max-Age=0/);
  });

  test('turns away a name that is too long, and keeps what was typed', async () => {
    const response = await visitor.post('/navn', { navn: 'x'.repeat(61), pin: PIN });
    assert.equal(response.status, 400);
    assert.equal(response.headers.get('set-cookie'), null);
    const page = await response.text();
    assert.match(page, /Navnet kan være på 60 tegn/);
    assert.match(page, new RegExp(`value="${'x'.repeat(61)}"`));
  });

  test('the first to use a name chooses its PIN, and then the name needs it', async () => {
    assert.equal((await visitor.post('/navn', { navn: 'Ola Nordmann', pin: '1234' })).status, 303);
    assert.match(book().people['ola nordmann'].pin, /^scrypt\$/, 'the PIN is kept as a hash');
    assert.doesNotMatch(readFileSync(file, 'utf8'), /"1234"/);

    const wrong = await visitor.post('/navn', { navn: 'ola nordmann', pin: '9999' });
    assert.equal(wrong.status, 403);
    assert.equal(wrong.headers.get('set-cookie'), null);
    assert.match(await wrong.text(), /Feil PIN for Ola Nordmann/);

    const right = await visitor.post('/navn', { navn: 'OLA NORDMANN', pin: '1234' });
    assert.match(right.headers.get('set-cookie'), /^navn=navn%3AOla%20Nordmann\./, 'the name as it was first written');
    assert.equal((await visitor.post('/navn', { navn: 'Kari Hansen', pin: '12' })).status, 400);
  });

  test('after five wrong PINs the name is closed for 15 minutes', async () => {
    await visitor.post('/navn', { navn: 'Ola Nordmann', pin: '1234' });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      assert.equal((await visitor.post('/navn', { navn: 'Ola Nordmann', pin: '0000' })).status, 403);
    }
    const closed = await visitor.post('/navn', { navn: 'Ola Nordmann', pin: '1234' });
    assert.equal(closed.status, 429);
    assert.match(await closed.text(), /For mange feil PIN-er/);
    assert.equal((await visitor.post('/navn', { navn: 'Kari Hansen', pin: '1234' })).status, 303, 'other names are open');

    clock = new Date(NOW.getTime() + 15 * 60 * 1000);
    assert.equal((await visitor.post('/navn', { navn: 'Ola Nordmann', pin: '1234' })).status, 303);
  });

  test('a cookie the server did not sign gives no name', async () => {
    await ola.get('/');
    for (const cookie of [
      'navn=Ola%20Nordmann',
      `navn=${encodeURIComponent(sign('en annen nøkkel', 'navn:Ola Nordmann'))}`,
      `navn=${encodeURIComponent(sign(SECRET, 'kontorsjef:Ola Nordmann'))}`,
    ]) {
      const page = await (await withCookie(cookie).get('/')).text();
      assert.match(page, /Hvem er du\?/, cookie);
      assert.doesNotMatch(page, /Du er <strong>/, cookie);
    }
  });
});

describe('booking', () => {
  test('Ola books a free week, and everyone sees that it is his', async () => {
    const response = await ola.post(`/uker/${AUTUMN}/book`);
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), `/#${AUTUMN}`);

    assert.equal(await card(ola, AUTUMN), 'Uke 45 2.–8. november Du har hytta Si fra deg uka');
    assert.equal(await card(kari, AUTUMN), 'Uke 45 2.–8. november Booket av Ola Nordmann');
    assert.equal(await card(visitor, AUTUMN), 'Uke 45 2.–8. november Booket av Ola Nordmann');
    assert.equal(book().bookings[AUTUMN].name, 'Ola Nordmann');
  });

  test('Kari cannot book the week Ola has', async () => {
    await ola.post(`/uker/${AUTUMN}/book`);
    const response = await kari.post(`/uker/${AUTUMN}/book`);

    assert.equal(response.status, 409);
    assert.match(await response.text(), /role="alert">Uke 45 er allerede booket av Ola Nordmann\./);
    assert.equal(book().bookings[AUTUMN].name, 'Ola Nordmann');
  });

  test('when two press at the same moment, one gets the week and the other is told who did', async () => {
    const answers = await Promise.all([ola.post(`/uker/${AUTUMN}/book`), kari.post(`/uker/${AUTUMN}/book`)]);
    assert.deepEqual(answers.map((answer) => answer.status).sort(), [303, 409]);
    assert.equal(Object.keys(book().bookings).length, 1);
  });

  test('one ordinary week at a time, and a week won in a draw does not count', async () => {
    assert.equal((await ola.post(`/uker/${AUTUMN}/book`)).status, 303);
    const second = await ola.post('/uker/2026-W46/book');
    assert.equal(second.status, 409);
    assert.match(await second.text(), /Du har allerede uke 45\. Du kan ha én vanlig uke om gangen\./);

    await ola.post(`/uker/${EASTER}/meld-pa`);
    assert.equal((await gro.post(`/trekning/${EASTER}/trekk`, { klar: 'ja' })).status, 303);
    assert.equal(book().bookings[EASTER].name, 'Ola Nordmann');
    assert.equal((await ola.post(`/uker/${AUTUMN}/avbestill`)).status, 303);
    assert.equal((await ola.post('/uker/2026-W46/book')).status, 303);
  });

  test('nobody gives up a week in someone else’s name', async () => {
    await ola.post(`/uker/${AUTUMN}/book`);
    const forged = await withCookie('navn=Ola%20Nordmann').post(`/uker/${AUTUMN}/avbestill`);
    assert.equal(forged.status, 400);
    assert.equal(book().bookings[AUTUMN].name, 'Ola Nordmann');
  });

  test('Ola gives the week up, and then Kari can have it', async () => {
    await ola.post(`/uker/${AUTUMN}/book`);
    assert.equal((await kari.post(`/uker/${AUTUMN}/avbestill`)).status, 403);
    assert.equal((await ola.post(`/uker/${AUTUMN}/avbestill`)).status, 303);
    assert.match(await card(kari, AUTUMN), /Ledig Book uka$/);
    assert.equal((await kari.post(`/uker/${AUTUMN}/book`)).status, 303);
  });

  test('nobody books without a name, a week that is over, or a week that does not exist', async () => {
    const nameless = await visitor.post(`/uker/${AUTUMN}/book`);
    assert.equal(nameless.status, 400);
    assert.match(await nameless.text(), /Skriv navnet ditt først/);

    assert.equal((await ola.post('/uker/2026-W41/book')).status, 409);
    assert.equal((await ola.post('/uker/2027-W53/book')).status, 404);
    assert.equal((await ola.post('/uker/2026-W45/stjel')).status, 404);
    assert.deepEqual(book().bookings, {});
  });

  test('a week a winner is drawn for cannot be booked', async () => {
    const response = await ola.post(`/uker/${EASTER}/book`);
    assert.equal(response.status, 409);
    assert.match(await response.text(), /Det trekkes lodd om uke 12\. Meld deg på trekningen i stedet\./);
  });
});

describe('the draw', () => {
  const enterAll = async () => {
    for (const who of [ola, kari, per]) {
      assert.equal((await who.post(`/uker/${EASTER}/meld-pa`)).status, 303);
    }
  };
  const draw = (form = { klar: 'ja' }, headers = { Accept: 'application/json' }) =>
    gro.post(`/trekning/${EASTER}/trekk`, form, headers);

  test('those who want Easter enter, and can leave again', async () => {
    await enterAll();
    assert.match(await card(ola, EASTER), /3 påmeldte Du er med i trekningen Meld meg av Se trekningen$/);
    assert.match(await card(person('Nina Berg'), EASTER), /3 påmeldte Meld meg på Se trekningen$/);

    assert.equal((await ola.post(`/uker/${EASTER}/meld-pa`)).status, 409);
    assert.equal((await ola.post(`/uker/${EASTER}/meld-av`)).status, 303);
    assert.match(await card(ola, EASTER), /2 påmeldte Meld meg på/);
  });

  test('the draw page shows a ticket for each, and the button to the office manager', async () => {
    await enterAll();
    const page = await (await visitor.get(`/trekning/${EASTER}`)).text();
    assert.doesNotMatch(page, /Trekk vinneren/);
    assert.match(page, /3 lodd i hatten\. Kontorsjefen trekker vinneren\./);

    const response = await gro.get(`/trekning/${EASTER}`);
    const managers = await response.text();

    assert.equal(response.status, 200);
    assert.match(managers, /<h1>Påske<\/h1>/);
    assert.match(page, /Uke 12 · 22\.–28\. mars 2027/);
    assert.deepEqual(
      [...managers.matchAll(/<li class="ticket" data-ticket>([^<]*)<\/li>/g)].map((found) => found[1]),
      ['Ola Nordmann', 'Kari Hansen', 'Per Olsen'],
    );
    assert.match(managers, /3 lodd i hatten/);
    assert.match(managers, /Trekk vinneren/);
    assert.match(managers, /<section class="winner" data-winner tabindex="-1" hidden>/);
    assert.match(managers, /<script type="module" src="\/trekning\.js">/);
  });

  test('only the office manager draws', async () => {
    await enterAll();
    const json = await ola.post(`/trekning/${EASTER}/trekk`, { klar: 'ja' }, { Accept: 'application/json' });
    assert.equal(json.status, 403);
    assert.match((await json.json()).message, /bare kontorsjefen/);
    assert.equal((await visitor.post(`/trekning/${EASTER}/trekk`, { klar: 'ja' })).status, 403);
    assert.deepEqual(book().bookings, {});
  });

  test('someone who won a draw in the last 12 months stands behind the others', async () => {
    await ola.post('/uker/2027-W08/meld-pa');
    await gro.post('/trekning/2027-W08/trekk', { klar: 'ja' });
    await enterAll();

    const page = await (await visitor.get(`/trekning/${EASTER}`)).text();
    assert.match(page, /<li class="ticket is-behind" data-ticket>Ola Nordmann<span class="ticket-note">vant siste 12 mnd<\/span><\/li>/);
    assert.match(page, /<li class="ticket" data-ticket>Kari Hansen<\/li>/);

    const drawn = await (await draw()).json();
    assert.deepEqual(drawn.behind, [0]);
    assert.notEqual(drawn.winner, 0);
    assert.notEqual(book().bookings[EASTER].name, 'Ola Nordmann');
  });

  test('the winner is one of those who entered, gets the week, and is drawn once', async () => {
    await enterAll();
    const response = await draw();
    const drawn = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(drawn.entries, ['Ola Nordmann', 'Kari Hansen', 'Per Olsen']);
    assert.ok([0, 1, 2].includes(drawn.winner));
    const winner = drawn.entries[drawn.winner];
    assert.equal(book().bookings[EASTER].name, winner);

    assert.match(await card(visitor, EASTER), new RegExp(`${winner} vant trekningen Se trekningen$`));
    assert.match(await card(person(winner), EASTER), /Du vant trekningen Si fra deg uka Se trekningen$/);

    const page = await (await visitor.get(`/trekning/${EASTER}`)).text();
    assert.match(page, new RegExp(`<p class="winner-name" data-winner-name>${winner}</p>`));
    assert.match(page, /Trukket 14\. oktober 2026 kl\. 12[:.]00 blant 3 påmeldte\./);
    assert.match(page, new RegExp(`<li class="ticket is-winner" data-ticket>${winner}</li>`));
    assert.doesNotMatch(page, /Trekk vinneren/);

    const again = await draw();
    assert.equal(again.status, 409);
    assert.match((await again.json()).message, new RegExp(`Trekningen om uke 12 er gjort\\. Uka gikk til ${winner}\\.`));
    assert.equal(book().bookings[EASTER].name, winner);
    assert.equal((await person('Nina Berg').post(`/uker/${EASTER}/meld-pa`)).status, 409);
  });

  test('without scripts the button leads to the page that names the winner', async () => {
    await enterAll();
    const response = await draw({ klar: 'ja' }, {});
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), `/trekning/${EASTER}`);
    const page = await (await visitor.get(`/trekning/${EASTER}`)).text();
    assert.match(page, new RegExp(`data-winner-name>${book().bookings[EASTER].name}<`));
  });

  test('nothing is drawn until the box is ticked, or before someone has entered', async () => {
    assert.equal((await draw()).status, 409);

    await enterAll();
    const unticked = await draw({}, {});
    assert.equal(unticked.status, 400);
    assert.match(await unticked.text(), /Kryss av for at alle som skal se på, er her\./);
    assert.equal((await draw({})).status, 400);
    assert.deepEqual(book().bookings, {});
  });

  test('a winner who gives the week up opens the draw again for the others', async () => {
    await enterAll();
    const first = await (await draw()).json();
    const winner = first.entries[first.winner];

    assert.equal((await person(winner).post(`/uker/${EASTER}/avbestill`)).status, 303);
    const second = await (await draw()).json();

    assert.equal(second.entries.length, 2);
    assert.ok(!second.entries.includes(winner));
  });

  test('there is no draw page for an ordinary week, or for no week', async () => {
    assert.equal((await visitor.get(`/trekning/${AUTUMN}`)).status, 404);
    assert.equal((await visitor.get('/trekning/tull')).status, 404);
    assert.equal((await gro.post(`/trekning/${AUTUMN}/trekk`, { klar: 'ja' })).status, 404);
  });
});

describe('for the office manager', () => {
  test('the page asks for the code, and lets in the one who has it', async () => {
    const page = await (await ola.get('/kontorsjef')).text();
    assert.match(page, /Koden til kontorsjefen/);
    assert.doesNotMatch(page, /Ukene det trekkes lodd om/);

    const wrong = await post('/kontorsjef/inn', { kode: 'gjett' });
    assert.equal(wrong.status, 403);
    assert.equal(wrong.headers.get('set-cookie'), null);
    assert.match(await wrong.text(), /Feil kode/);

    const right = await post('/kontorsjef/inn', { kode: CODE });
    assert.equal(right.headers.get('location'), '/kontorsjef');
    assert.match(right.headers.get('set-cookie'), /^kontorsjef=[^;]+; Path=\/; Max-Age=43200; HttpOnly/);
    assert.match(await (await gro.get('/kontorsjef')).text(), /Ukene det trekkes lodd om/);
  });

  test('without the code nothing of the manager’s can be done', async () => {
    for (const [path, form] of [
      ['/kontorsjef/trekningsuker', { uke: AUTUMN }],
      [`/kontorsjef/trekningsuker/${EASTER}/fjern`, {}],
      ['/kontorsjef/personer/ola%20nordmann/nullstill', {}],
    ]) {
      assert.equal((await ola.post(path, form)).status, 403, path);
    }
    const forged = withCookie(`kontorsjef=${encodeURIComponent(sign(SECRET, 'navn:ja'))}`);
    assert.match(await (await forged.get('/kontorsjef')).text(), /Koden til kontorsjefen/);
    assert.ok(book().draws[EASTER]);
    assert.ok(book().people['ola nordmann']);
  });

  test('after five wrong codes the door is closed for 15 minutes', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) await post('/kontorsjef/inn', { kode: 'gjett' });
    assert.equal((await post('/kontorsjef/inn', { kode: CODE })).status, 429);
  });

  test('frees a name whose PIN is forgotten, and the old cookie stops working', async () => {
    await ola.post(`/uker/${AUTUMN}/book`);
    const page = await (await gro.get('/kontorsjef')).text();
    assert.match(page, /<span class="person">Ola Nordmann<\/span>/);
    assert.match(page, /action="\/kontorsjef\/personer\/ola%20nordmann\/nullstill"/);

    assert.equal((await gro.post('/kontorsjef/personer/ola%20nordmann/nullstill')).status, 303);
    assert.equal(book().people['ola nordmann'], undefined);
    assert.equal(book().bookings[AUTUMN].name, 'Ola Nordmann', 'the booking stays');
    assert.match(await (await ola.get('/')).text(), /Hvem er du\?/);

    assert.equal((await visitor.post('/navn', { navn: 'Ola Nordmann', pin: '5678' })).status, 303);
    assert.equal((await gro.post('/kontorsjef/personer/ingen/nullstill')).status, 404);
  });

  test('lists the draws, with who has entered', async () => {
    await ola.post(`/uker/${EASTER}/meld-pa`);
    await kari.post(`/uker/${EASTER}/meld-pa`);
    const page = await (await gro.get('/kontorsjef')).text();

    assert.match(page, /<strong>Påske<\/strong>\s*<span>Uke 12 · 22\.–28\. mars 2027<\/span>/);
    assert.match(page, /2 påmeldte: <span class="person">Ola Nordmann, Kari Hansen<\/span>/);
    assert.match(page, new RegExp(`href="/trekning/${EASTER}">Åpne trekningen`));
    assert.match(page, /<option value="2026-W45">Uke 45 · 2\.–8\. november 2026<\/option>/);
    assert.doesNotMatch(page, /<option value="2027-W12">/, 'a week that is set up is not offered again');
  });

  test('sets a week up for a draw, and makes it an ordinary week again while nobody has entered', async () => {
    const made = await gro.post('/kontorsjef/trekningsuker', { uke: AUTUMN, navn: 'Høstferie' });
    assert.equal(made.status, 303);
    assert.equal(made.headers.get('location'), '/kontorsjef');
    assert.match(await card(ola, AUTUMN), /Trekning · Høstferie Ingen påmeldt ennå Meld meg på/);
    assert.equal((await ola.post(`/uker/${AUTUMN}/book`)).status, 409);

    assert.equal((await gro.post(`/kontorsjef/trekningsuker/${AUTUMN}/fjern`)).status, 303);
    assert.match(await card(ola, AUTUMN), /Ledig Book uka$/);
  });

  test('says why a week cannot be set up, or cannot be made ordinary', async () => {
    await ola.post(`/uker/${AUTUMN}/book`);
    const booked = await gro.post('/kontorsjef/trekningsuker', { uke: AUTUMN });
    assert.equal(booked.status, 409);
    assert.match(await booked.text(), /role="alert">Uke 45 er allerede booket av Ola Nordmann/);

    await kari.post(`/uker/${EASTER}/meld-pa`);
    const entered = await gro.post(`/kontorsjef/trekningsuker/${EASTER}/fjern`);
    assert.equal(entered.status, 409);
    assert.match(await entered.text(), /1 har meldt seg på trekningen om uke 12/);

    assert.equal((await gro.post('/kontorsjef/trekningsuker', {})).status, 404);
  });
});

describe('what the server is careful about', () => {
  test('a name is shown as it was typed, never read as markup', async () => {
    const rascal = person('<img src=x onerror=alert(1)>');
    await rascal.post(`/uker/${AUTUMN}/book`);
    await rascal.post(`/uker/${EASTER}/meld-pa`);

    for (const path of ['/', '/kontorsjef', `/trekning/${EASTER}`]) {
      const page = await (await gro.get(path)).text();
      assert.doesNotMatch(page, /<img/, path);
      assert.match(page, /&lt;img src=x onerror=alert\(1\)&gt;/, path);
    }
  });

  test('pages may load their own files and nothing else', async () => {
    const response = await visitor.get('/');
    assert.match(response.headers.get('content-security-policy'), /^default-src 'self';/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  });

  test('a form that another site made the browser send is turned away', async () => {
    const response = await ola.post(`/uker/${AUTUMN}/book`, {}, { 'Sec-Fetch-Site': 'cross-site' });
    assert.equal(response.status, 403);
    assert.deepEqual(book().bookings, {});
    assert.equal((await ola.post(`/uker/${AUTUMN}/book`, {}, { 'Sec-Fetch-Site': 'same-origin' })).status, 303);
  });

  test('a form far bigger than any form here is turned away', async () => {
    const response = await ola.post('/navn', { navn: 'x'.repeat(20_000) });
    assert.equal(response.status, 413);
  });

  test('serves its style, scripts and icon, and says so when a page is not there', async () => {
    for (const [path, type] of [
      ['/stil.css', /text\/css/],
      ['/trekning.js', /text\/javascript/],
      ['/hopp.js', /text\/javascript/],
      ['/hytte.svg', /image\/svg\+xml/],
    ]) {
      const response = await visitor.get(path);
      assert.equal(response.status, 200, path);
      assert.match(response.headers.get('content-type'), type);
      assert.ok((await response.text()).length > 100);
    }

    const missing = await visitor.get('/server.js');
    assert.equal(missing.status, 404);
    assert.match(await missing.text(), /Den siden finnes ikke/);
    assert.equal((await visitor.get('/../package.json')).status, 404);
  });
});
