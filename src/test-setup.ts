import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Database-backed tests read the same .env the app does.
 *
 * `maxWorkers: 1` in the Jest config keeps that sound; it is not a performance
 * setting. `dispatchPending()` is network-wide by design - it picks up every
 * office's queued broadcasts, not just the one a test created - so two
 * dispatcher suites in parallel workers send each other's broadcasts through
 * their own fake clients and each sees an empty outbox. Measured: 2 failures
 * in 5 parallel runs, 0 in 6 serial runs. `test:ci` passes --runInBand for the
 * same reason.
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
