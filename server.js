// Starts the cabin book: `npm start`, then http://localhost:44210

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createApp } from './src/app.js';
import { firstState } from './src/cabin.js';
import { openStore } from './src/store.js';

const PORT = 44210;
const file = fileURLToPath(new URL('./data/hytteboka.json', import.meta.url));
const keyFile = fileURLToPath(new URL('./data/nokkel', import.meta.url));

// The key that signs the cookies is made the first time, and kept, so people stay who they are after a restart.
if (!existsSync(keyFile)) {
  mkdirSync(fileURLToPath(new URL('./data', import.meta.url)), { recursive: true });
  writeFileSync(keyFile, randomBytes(32), { mode: 0o600 });
}
const secret = readFileSync(keyFile);

// Without a code set, one is made for this run and shown below, so the book still starts with one command.
const managerCode = process.env.KONTORSJEF_KODE || randomBytes(6).toString('base64url');

const store = openStore(file, () => firstState());
const server = createServer(createApp({ store, secret, managerCode }));

// Answers this machine only. Putting the book where the whole office reaches it is a decision still to make.
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Hytteboka er oppe: http://localhost:${PORT}`);
  console.log(`Boka ligger i ${file}`);
  if (!process.env.KONTORSJEF_KODE) {
    console.log(`Koden til kontorsjefen er ${managerCode} (velg din egen med KONTORSJEF_KODE)`);
  }
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    server.closeAllConnections();
  });
}
