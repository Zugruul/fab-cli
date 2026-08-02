// Imperative, on-device checks for three of the four native pillars.
// Camera is intentionally excluded here — react-native-vision-camera's
// permission/device APIs are React hooks (useCameraPermission,
// useCameraDevices), not plain functions, so that check lives directly in
// SmokeScreen.tsx alongside the other hook calls.
//
// These functions touch real native modules and are exercised on-device
// only (SPEC-APP.md §9.1); they are not unit tested here — jest never loads
// the real llama.rn/op-sqlite native bindings (see jest.config.js's
// moduleNameMapper + __mocks__/), so any test importing this file runs
// against mocks, not real hardware behaviour.

import { installJsi, BuildInfo } from 'llama.rn';
import { open } from '@op-engineering/op-sqlite';
import { loadTensorflowModel } from 'react-native-fast-tflite';

/** llama.rn: load nothing yet — just verify the native module links and report its build info. */
export async function checkLlama(): Promise<string> {
  await installJsi();
  return `llama.rn native module linked (llama.cpp build ${BuildInfo.number}@${BuildInfo.commit})`;
}

/** op-sqlite: open a DB, create a vec0 virtual table (sqlite-vec), insert + query one vector. */
export async function checkSqlite(): Promise<string> {
  const db = open({ name: 'fab-app-smoke.db', location: ':memory:' });
  try {
    db.execute(
      'CREATE VIRTUAL TABLE smoke_vec_items USING vec0(embedding float[4])',
    );
    await db.execute(
      'INSERT INTO smoke_vec_items(rowid, embedding) VALUES (1, ?)',
      ['[0.1, 0.2, 0.3, 0.4]'],
    );
    const result = await db.execute(
      'SELECT rowid, distance FROM smoke_vec_items WHERE embedding MATCH ? ORDER BY distance LIMIT 1',
      ['[0.1, 0.2, 0.3, 0.4]'],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error('vec0 query returned no rows');
    }
    return `sqlite-vec vec0 table created, inserted, queried — nearest distance ${row.distance}`;
  } finally {
    db.close();
  }
}

/** fast-tflite: report that the module loads (no model file is bundled to load in this smoke test). */
export async function checkTflite(): Promise<string> {
  if (typeof loadTensorflowModel !== 'function') {
    throw new Error(
      'react-native-fast-tflite: loadTensorflowModel export missing',
    );
  }
  return 'react-native-fast-tflite module loaded';
}
