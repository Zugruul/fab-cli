// Manual jest mock for @op-engineering/op-sqlite (jest.config.js maps the
// real package to this file). op-sqlite has no native binding in the jest
// environment (no device), so tests that reach for it get a minimal,
// deterministic in-memory fake covering the calls src/smokeScreen/checks.ts
// makes: execute() and close().
export function open() {
  const rows: Array<{ rowid: number; embedding: string }> = [];
  return {
    execute: jest.fn(async (query: string, params?: unknown[]) => {
      if (/^CREATE VIRTUAL TABLE/i.test(query)) {
        return { rowsAffected: 0, rows: [] };
      }
      if (/^INSERT INTO/i.test(query)) {
        rows.push({ rowid: 1, embedding: String(params?.[0]) });
        return { rowsAffected: 1, rows: [] };
      }
      if (/^SELECT/i.test(query)) {
        return {
          rowsAffected: 0,
          rows: rows.map(row => ({ rowid: row.rowid, distance: 0 })),
        };
      }
      return { rowsAffected: 0, rows: [] };
    }),
    close: jest.fn(),
  };
}
