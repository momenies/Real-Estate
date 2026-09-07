import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Database-backed tests read the same .env the app does.
 *
 * `process.loadEnvFile` is not usable here: it writes to the real process
 * environment, while Jest hands each test file a sandboxed copy of
 * `process.env`, so the values would never show up.
 */
const envPath = resolve(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (!match) continue;
    const [, key, rawValue = ''] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.trim().replace(/^(['"])(.*)\1$/, '$2');
  }
}
