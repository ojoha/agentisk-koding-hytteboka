// The book is one JSON file, read when the server starts and written after every change.
// The server is a single process and a rule runs from start to end without waiting for anything,
// so two people who press at the same moment are still answered one after the other.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Opens the book in `file`. A file that is not there yet is made from `first()`. */
export function openStore(file, first) {
  let state;
  if (existsSync(file)) {
    // A file that cannot be read stops the server here, rather than being replaced by an empty book.
    state = JSON.parse(readFileSync(file, 'utf8'));
    // A book from before there were PINs.
    state.people ??= {};
  } else {
    state = first();
    write(file, state);
  }

  return {
    get state() {
      return state;
    },

    /** Lets one rule change the book. What the rule did is kept only when it said yes and the file is written. */
    change(rule, wish) {
      const next = structuredClone(state);
      const answer = rule(next, wish);
      if (answer.ok) {
        write(file, next);
        state = next;
      }
      return answer;
    },
  };
}

function write(file, state) {
  // Written beside the file and moved into place, so a crash halfway leaves the old book whole.
  mkdirSync(dirname(file), { recursive: true });
  const draft = `${file}.ny`;
  writeFileSync(draft, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(draft, file);
}
