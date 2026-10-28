// Loads a local `.env` file (project root, or server/) into process.env.
// Import this FIRST in index.js so every other file sees the values.
//
// - Real environment variables (Render, Railway, Docker...) always win: this never overwrites them.
// - If there is no .env file, nothing happens. Production hosts normally set variables in a dashboard.
// - Uses Node's built-in loader (Node 20.12+ / 22), so no extra package is needed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

for (const file of [path.join(here, '..', '.env'), path.join(here, '.env')]) {
  if (!fs.existsSync(file)) continue;
  try {
    process.loadEnvFile(file);
  } catch (e) {
    console.warn(`[saath] Could not read ${file}: ${e.message}`);
  }
}
