// #217 language preference persistence (SPEC-APP.md §13 invariant 5 —
// on-device only, no accounts). Takes a minimal injected db interface
// rather than depending on @op-engineering/op-sqlite directly, mirroring
// onboarding/types.ts's NetworkStateSource / artifacts/types.ts's
// FileSystem pattern: production wires the real op-sqlite `open()`
// (defaultLanguagePreferenceStore.ts), tests supply an in-memory fake.

import type { LanguagePreference } from './types';

export interface LanguagePreferenceDb {
  execute(query: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export interface LanguagePreferenceStore {
  getPreference(): Promise<LanguagePreference>;
  setPreference(preference: LanguagePreference): Promise<void>;
}

const TABLE_SQL = 'CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT)';
const PREFERENCE_KEY = 'language';

function isLanguagePreference(value: unknown): value is LanguagePreference {
  return value === 'system' || value === 'en' || value === 'pt-BR';
}

export function createLanguagePreferenceStore(db: LanguagePreferenceDb): LanguagePreferenceStore {
  let ready: Promise<void> | null = null;
  function ensureReady(): Promise<void> {
    if (!ready) {
      ready = db.execute(TABLE_SQL).then(() => undefined);
    }
    return ready;
  }

  return {
    async getPreference(): Promise<LanguagePreference> {
      await ensureReady();
      const result = await db.execute('SELECT value FROM app_settings WHERE key = ?', [PREFERENCE_KEY]);
      const value = result.rows[0]?.value;
      return isLanguagePreference(value) ? value : 'system';
    },

    async setPreference(preference: LanguagePreference): Promise<void> {
      await ensureReady();
      await db.execute('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', [
        PREFERENCE_KEY,
        preference,
      ]);
    },
  };
}
