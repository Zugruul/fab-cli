// #217: createLanguagePreferenceStore persists the manual language override
// (SPEC-APP.md §13 invariant 5 — on-device only, no accounts) behind a
// minimal injected db interface (mirrors onboarding/types.ts's
// NetworkStateSource and artifacts/types.ts's FileSystem pattern) rather
// than the real op-sqlite binding, so this suite runs fully offline with a
// deterministic in-memory fake instead of the jest op-sqlite mock (which is
// shaped for the sqlite-vec smoke check, not a generic key/value table).

import { createLanguagePreferenceStore } from '../languageStore';
import type { LanguagePreferenceDb } from '../languageStore';

function createFakeDb(): LanguagePreferenceDb & { table: Map<string, string> } {
  const table = new Map<string, string>();
  return {
    table,
    execute: jest.fn(async (query: string, params: unknown[] = []) => {
      if (/^CREATE TABLE/i.test(query)) {
        return { rows: [] };
      }
      if (/^INSERT OR REPLACE INTO/i.test(query)) {
        const [key, value] = params as [string, string];
        table.set(key, value);
        return { rows: [] };
      }
      if (/^SELECT/i.test(query)) {
        const [key] = params as [string];
        const value = table.get(key);
        return { rows: value === undefined ? [] : [{ value }] };
      }
      return { rows: [] };
    }),
  };
}

describe('createLanguagePreferenceStore', () => {
  it('defaults to "system" when nothing has been persisted yet', async () => {
    const store = createLanguagePreferenceStore(createFakeDb());
    await expect(store.getPreference()).resolves.toBe('system');
  });

  it('persists and returns a manually chosen override', async () => {
    const store = createLanguagePreferenceStore(createFakeDb());
    await store.setPreference('pt-BR');
    await expect(store.getPreference()).resolves.toBe('pt-BR');
  });

  it('round-trips across separate store instances sharing the same db, applied without reinstall', async () => {
    const db = createFakeDb();
    await createLanguagePreferenceStore(db).setPreference('en');
    const secondStore = createLanguagePreferenceStore(db);
    await expect(secondStore.getPreference()).resolves.toBe('en');
  });

  it('falls back to "system" if a corrupt/unrecognized value is stored', async () => {
    const db = createFakeDb();
    db.table.set('language', 'fr');
    const store = createLanguagePreferenceStore(db);
    await expect(store.getPreference()).resolves.toBe('system');
  });

  it('setPreference("system") clears back to the default', async () => {
    const db = createFakeDb();
    const store = createLanguagePreferenceStore(db);
    await store.setPreference('pt-BR');
    await store.setPreference('system');
    await expect(store.getPreference()).resolves.toBe('system');
  });
});
