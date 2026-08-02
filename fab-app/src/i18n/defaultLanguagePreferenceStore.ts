// #217: the production LanguagePreferenceStore, backed by
// @op-engineering/op-sqlite — already an fab-app dependency (no new native
// module, per the design doc's constraint). Lazily constructed so importing
// this module never opens a database by itself; only I18nProvider's default
// (no store prop passed) touches it.

import { open } from '@op-engineering/op-sqlite';
import { createLanguagePreferenceStore } from './languageStore';
import type { LanguagePreferenceStore } from './languageStore';

let instance: LanguagePreferenceStore | undefined;

export function getDefaultLanguagePreferenceStore(): LanguagePreferenceStore {
  if (!instance) {
    const db = open({ name: 'fab_app_settings.sqlite' });
    instance = createLanguagePreferenceStore(db);
  }
  return instance;
}
