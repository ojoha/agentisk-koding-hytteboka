// What the server answers. `createApp` gives the function `node:http` calls for each request.
//
// Who someone is: the name they gave with its PIN, kept in the cookie `navn`, signed by the server.
// The office manager is whoever gave the manager's code, kept in the cookie `kontorsjef`.
// A change is a posted form. One that went well is answered by sending the browser to the page
// that shows it; one that was refused, by that page again with why.

import { readFile } from 'node:fs/promises';
import {
  book, calendar, cancel, claimName, describe, drawWinner, enter, isKnown, markDraw, nameKey, people, readName,
  resetPin, standingBehind, unmarkDraw, withdraw,
} from './cabin.js';
import { same, sign, unsign } from './identity.js';
import { calendarPage, drawPage, managerLoginPage, managerPage, messagePage } from './pages.js';
import { currentWeek, isWeekId } from './weeks.js';

const HTML = 'text/html; charset=utf-8';
const JSON_TYPE = 'application/json; charset=utf-8';

const FILES = {
  '/stil.css': 'text/css; charset=utf-8',
  '/trekning.js': 'text/javascript; charset=utf-8',
  '/hopp.js': 'text/javascript; charset=utf-8',
  '/hytte.svg': 'image/svg+xml',
};

const WEEK_RULES = { book, avbestill: cancel, 'meld-pa': enter, 'meld-av': withdraw };

// The pages load their own files and nothing else, and run no script written into a page.
const HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
};

const FORM_LIMIT = 10_000;

// After this many wrong PINs for a name, or wrong codes, it is closed for a while.
const TRIES = 5;
const CLOSED_FOR = 15 * 60 * 1000;

/**
 * `secret` signs the cookies. `managerCode` is what the office manager types to get in.
 */
export function createApp({ store, now = () => new Date(), secret, managerCode }) {
  if (!secret || !managerCode) throw new Error('createApp needs a secret and a code for the office manager');
  const today = () => currentWeek(now());
  const failures = new Map();

  const isClosed = (key) => (failures.get(key)?.until ?? 0) > now().getTime();
  const failed = (key) => {
    const count = (failures.get(key)?.count ?? 0) + 1;
    failures.set(key, count >= TRIES ? { count: 0, until: now().getTime() + CLOSED_FOR } : { count, until: 0 });
  };

  // What is signed starts with the cookie's name, so one cookie's value is never believed as another's.
  const remember = (wanted, value, maxAge) =>
    `${wanted}=${encodeURIComponent(sign(secret, `${wanted}:${value}`))}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax`;
  const cookie = (request, wanted) => {
    const match = new RegExp(`(?:^|;\\s*)${wanted}=([^;]*)`).exec(request.headers.cookie ?? '');
    try {
      const value = match ? unsign(secret, decodeURIComponent(match[1])) : null;
      return value?.startsWith(`${wanted}:`) ? value.slice(wanted.length + 1) : null;
    } catch {
      return null;
    }
  };
  // A name counts only while it is in use: when the manager frees it, old cookies with it stop working.
  const nameOf = (request) => {
    const name = readName(cookie(request, 'navn') ?? '');
    return isKnown(store.state, name) ? name : '';
  };
  const isManager = (request) => cookie(request, 'kontorsjef') === 'ja';

  async function answer(request, response) {
    const { pathname } = new URL(request.url, 'http://hytteboka');
    const name = nameOf(request);
    const manager = isManager(request);
    let match;

    const send = (status, body, type = HTML, more = {}) => {
      response.writeHead(status, { ...HEADERS, 'Content-Type': type, ...more });
      response.end(body);
    };
    const goTo = (address, more = {}) => {
      response.writeHead(303, { ...HEADERS, Location: address, ...more });
      response.end();
    };
    const notFound = () =>
      send(404, messagePage({ title: 'Den siden finnes ikke', text: 'Kanskje adressen er skrevet feil.', name }));

    const showCalendar = (status = 200, more = {}) =>
      send(status, calendarPage({ weeks: calendar(store.state, today()), today: today(), name, ...more }));

    const showManager = (status = 200, message) => {
      if (!manager) return send(status, managerLoginPage({ name, message }));
      const weeks = calendar(store.state, today());
      send(status, managerPage({
        draws: weeks.filter((entry) => entry.draw),
        freeWeeks: weeks.filter((entry) => !entry.draw && !entry.booking).map((entry) => entry.week),
        people: people(store.state),
        name,
        message,
      }));
    };

    const showDraw = (week, status = 200, message) => {
      const entry = isWeekId(week) ? describe(store.state, week) : null;
      if (!entry?.draw) return notFound();
      const behind = standingBehind(store.state, week, now().toISOString());
      send(status, drawPage({ ...entry, behind, canDraw: manager, message }));
    };

    if (request.method === 'GET') {
      if (pathname === '/') return showCalendar();
      if (pathname === '/kontorsjef') return showManager();
      if ((match = /^\/trekning\/([^/]+)$/.exec(pathname))) return showDraw(match[1]);
      if (FILES[pathname]) {
        const file = await readFile(new URL(`../public${pathname}`, import.meta.url));
        return send(200, file, FILES[pathname], { 'Cache-Control': 'no-cache' });
      }
      return notFound();
    }

    if (request.method !== 'POST') return notFound();

    // A browser says where a posted form came from. One that another site made it send is turned away.
    const from = request.headers['sec-fetch-site'];
    if (from && from !== 'same-origin' && from !== 'none') {
      return send(403, messagePage({ title: 'Det gikk ikke', text: 'Skjemaet kom ikke fra hytteboka.', name }));
    }

    const form = await readForm(request);
    if (!form) return send(413, messagePage({ title: 'Det gikk ikke', text: 'Skjemaet var for stort.', name }));
    const wish = { today: today(), now: now().toISOString() };

    if (pathname === '/navn') {
      const typed = form.get('navn') ?? '';
      const forget = 'navn=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax';
      if (typed.trim() === '') return goTo('/', { 'Set-Cookie': forget });
      if (!readName(typed)) return showCalendar(400, { message: 'Navnet kan være på 60 tegn.', typedName: typed });

      const key = `navn:${nameKey(typed)}`;
      if (isClosed(key)) {
        return showCalendar(429, { message: 'For mange feil PIN-er. Prøv igjen om 15 minutter.', typedName: typed });
      }
      const result = store.change(claimName, { name: typed, pin: form.get('pin') ?? '' });
      if (!result.ok) {
        if (result.status === 403) failed(key);
        return showCalendar(result.status, { message: result.message, typedName: typed });
      }
      failures.delete(key);
      return goTo('/', { 'Set-Cookie': remember('navn', result.name, 31536000) });
    }

    if ((match = /^\/uker\/([^/]+)\/(book|avbestill|meld-pa|meld-av)$/.exec(pathname))) {
      const [, week, action] = match;
      const result = store.change(WEEK_RULES[action], { ...wish, week, name });
      return result.ok ? goTo(`/#${week}`) : showCalendar(result.status, { message: result.message });
    }

    if (pathname === '/kontorsjef/inn') {
      const key = 'kontorsjef';
      if (isClosed(key)) return showManager(429, 'For mange feil koder. Prøv igjen om 15 minutter.');
      if (!same(form.get('kode') ?? '', managerCode)) {
        failed(key);
        return showManager(403, 'Feil kode.');
      }
      failures.delete(key);
      // Half a day, so a screen left open in the meeting room does not stay the manager's.
      return goTo('/kontorsjef', { 'Set-Cookie': remember('kontorsjef', 'ja', 43200) });
    }

    // Drawing, and everything under /kontorsjef, is the office manager's.
    const wantsData = request.headers.accept?.includes('application/json');
    if (!manager && /^\/(kontorsjef|trekning)\//.test(pathname)) {
      const message = 'Det er bare kontorsjefen som kan gjøre det.';
      if (wantsData) return send(403, JSON.stringify({ message }), JSON_TYPE);
      return showManager(403, message);
    }

    if ((match = /^\/trekning\/([^/]+)\/trekk$/.exec(pathname))) {
      const week = match[1];
      const result = form.get('klar') === 'ja'
        ? store.change(drawWinner, { ...wish, week })
        : { ok: false, status: 400, message: 'Kryss av for at alle som skal se på, er her.' };

      // The draw page's script asks for the answer as data, to show it its own way.
      if (wantsData) {
        const body = result.ok
          ? { winner: result.winner, entries: result.entries, behind: result.behind }
          : { message: result.message };
        return send(result.ok ? 200 : result.status, JSON.stringify(body), JSON_TYPE);
      }
      return result.ok ? goTo(`/trekning/${week}`) : showDraw(week, result.status, result.message);
    }

    if ((match = /^\/kontorsjef\/personer\/([^/]+)\/nullstill$/.exec(pathname))) {
      let key;
      try {
        key = decodeURIComponent(match[1]);
      } catch {
        return notFound();
      }
      const result = store.change(resetPin, { name: key });
      return result.ok ? goTo('/kontorsjef') : showManager(result.status, result.message);
    }

    if (pathname === '/kontorsjef/trekningsuker') {
      const result = store.change(markDraw, { ...wish, week: form.get('uke') ?? '', label: form.get('navn') ?? '' });
      return result.ok ? goTo('/kontorsjef') : showManager(result.status, result.message);
    }

    if ((match = /^\/kontorsjef\/trekningsuker\/([^/]+)\/fjern$/.exec(pathname))) {
      const result = store.change(unmarkDraw, { ...wish, week: match[1] });
      return result.ok ? goTo('/kontorsjef') : showManager(result.status, result.message);
    }

    return notFound();
  }

  return (request, response) =>
    answer(request, response).catch((error) => {
      console.error(error);
      if (response.headersSent) return response.end();
      response.writeHead(500, { ...HEADERS, 'Content-Type': HTML });
      response.end(messagePage({ title: 'Noe gikk galt', text: 'Det er vår feil, ikke din. Prøv igjen om litt.' }));
    });
}

/** The fields of a posted form, or null when more was sent than a form here ever holds. */
async function readForm(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > FORM_LIMIT) return null;
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}
