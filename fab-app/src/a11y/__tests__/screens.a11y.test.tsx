/**
 * @format
 */

// #218 (SPEC-APP.md §9.12): every current screen's interactive elements
// must expose an accessible name + role (assertAccessibleTree.ts). This
// suite is the "adding a future screen requires only registering it, not
// new check logic" mechanism the brief asks for — the SCREENS table below
// is the only thing a new screen touches; the it.each loop and the
// assertion itself never change. Mirrors #217's own zero-config pattern
// (SUPPORTED_LOCALES / LOCALE_BUNDLES iteration) one level up: that one
// is generic over locales, this one is generic over screens+locales.
//
// Each screen may be registered with more than one prop/state variant so
// every one of its conditionally-rendered interactive elements (e.g.
// ProgressScreen's pause vs. resume vs. retry controls) gets exercised at
// least once — a screen with a single unconditional layout only needs one
// variant. Screens with no interactive elements of their own (FeatureGate,
// ProvenanceScreen) are still registered: the assertion is trivially true
// for them today, and stays load-bearing the moment either screen grows a
// control.
//
// Accessible names sourced from i18n text are asserted generically (via
// the walker's own non-empty-string check) — not against a specific
// locale's literal string — so this suite doesn't need its own
// per-locale-string assertions; #217's screen test files already own
// verifying the *content* of translated copy.

import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {I18nextProvider} from 'react-i18next';
import {validModelPackManifest} from '@fab/manifest-schema';
import type {KnowledgePackManifest} from '@fab/manifest-schema';

import {assertAccessibleTree} from '../assertAccessibleTree';
import {createI18nInstance} from '../../i18n/i18n';
import {SUPPORTED_LOCALES} from '../../i18n/locales';
import type {Locale} from '../../i18n/types';
import {I18nProvider} from '../../i18n/I18nProvider';
import {LanguageSwitcher} from '../../i18n/LanguageSwitcher';
import type {LanguagePreferenceStore} from '../../i18n/languageStore';

import {ConsentScreen} from '../../onboarding/screens/ConsentScreen';
import {deriveArtifactSizes} from '../../onboarding/sizes';
import type {ArtifactSizes, ConsentGateState, ProgressState} from '../../onboarding/types';
import {FeatureGate} from '../../onboarding/screens/FeatureGate';
import {ProgressScreen} from '../../onboarding/screens/ProgressScreen';
import {initialProgressState} from '../../onboarding/progressReducer';
import {ProvenanceScreen} from '../../screens/ProvenanceScreen';
import type {ProvenanceState} from '../../provenance';
import {SmokeScreen} from '../../smokeScreen/SmokeScreen';

// BUG-202-style fixture (same shape ConsentScreen.test.tsx uses) — the
// exact sizes don't matter here, only that ConsentScreen renders.
const knowledgePackManifestFixture: KnowledgePackManifest = {
  schemaVersion: '0.1.0',
  version: '1.0.0',
  corpusSnapshotHash: 'd'.repeat(64),
  textEmbedderVersion: 'text-embed-v1',
  visionEmbedderVersion: 'vision-embed-v1',
  printingRegistryVersion: '1.0.0',
  retrievalFloor: 0.42,
  oodThreshold: 0.2,
  chunkCount: 6410,
  indexFiles: [{name: 'chunks.sqlite', sha256: 'e'.repeat(64), sizeBytes: 300_000_000}],
};
const consentSizes: ArtifactSizes = deriveArtifactSizes(validModelPackManifest, knowledgePackManifestFixture);

const progressLabels = {'model-pack': 'Model pack', 'knowledge-pack': 'Knowledge pack'} as const;

function fakeLanguageStore(): LanguagePreferenceStore {
  let value: 'system' | Locale = 'system';
  return {
    getPreference: jest.fn(async () => value),
    setPreference: jest.fn(async pref => {
      value = pref;
    }),
  };
}

async function renderUnderI18next(locale: Locale, node: React.ReactElement): Promise<ReactTestRenderer.ReactTestRenderer> {
  let tree: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<I18nextProvider i18n={createI18nInstance(locale)}>{node}</I18nextProvider>);
  });
  return tree!;
}

interface ScreenVariant {
  screen: string;
  variant: string;
  render: (locale: Locale) => Promise<ReactTestRenderer.ReactTestRenderer>;
}

const SCREENS: ScreenVariant[] = [
  {
    screen: 'ConsentScreen',
    variant: 'ready (accept control)',
    render: locale =>
      renderUnderI18next(
        locale,
        <ConsentScreen gate={{kind: 'ready'}} sizes={consentSizes} onAccept={() => {}} onOverrideCellular={() => {}} />,
      ),
  },
  {
    screen: 'ConsentScreen',
    variant: 'cellular-warning (override control)',
    render: locale =>
      renderUnderI18next(
        locale,
        <ConsentScreen gate={{kind: 'cellular-warning'}} sizes={consentSizes} onAccept={() => {}} onOverrideCellular={() => {}} />,
      ),
  },
  {
    screen: 'ConsentScreen',
    variant: 'waiting-for-network (no controls)',
    render: locale =>
      renderUnderI18next(
        locale,
        <ConsentScreen gate={{kind: 'waiting-for-network'} as ConsentGateState} sizes={consentSizes} onAccept={() => {}} onOverrideCellular={() => {}} />,
      ),
  },
  {
    screen: 'FeatureGate',
    variant: 'not-ready (no controls of its own)',
    render: locale =>
      renderUnderI18next(
        locale,
        <FeatureGate feature={{available: false, reason: 'model pack not installed yet'}} featureLabel="Q&A">
          <></>
        </FeatureGate>,
      ),
  },
  {
    screen: 'ProgressScreen',
    variant: 'model-pack downloading (pause) + knowledge-pack paused (resume)',
    render: locale => {
      const progress: ProgressState = {
        ...initialProgressState(),
        'model-pack': {status: 'downloading', bytesDownloaded: 400, totalBytes: 1000},
        'knowledge-pack': {status: 'paused', bytesDownloaded: 200, totalBytes: 500},
      };
      return renderUnderI18next(
        locale,
        <ProgressScreen progress={progress} labels={progressLabels} onPause={() => {}} onResume={() => {}} onRetry={() => {}} />,
      );
    },
  },
  {
    screen: 'ProgressScreen',
    variant: 'model-pack failed (retry) + knowledge-pack downloading (pause)',
    render: locale => {
      const progress: ProgressState = {
        ...initialProgressState(),
        'model-pack': {status: 'failed', bytesDownloaded: 200, totalBytes: 500, errorKind: 'other', errorMessage: 'connection dropped'},
        'knowledge-pack': {status: 'downloading', bytesDownloaded: 400, totalBytes: 1000},
      };
      return renderUnderI18next(
        locale,
        <ProgressScreen progress={progress} labels={progressLabels} onPause={() => {}} onResume={() => {}} onRetry={() => {}} />,
      );
    },
  },
  {
    screen: 'ProvenanceScreen',
    variant: 'ready (no controls of its own)',
    render: locale =>
      renderUnderI18next(
        locale,
        <ProvenanceScreen
          provenance={
            {status: 'ready', latestSet: 'OTA', crVersion: '1.0', legalityAsOf: '2026-08-01T00:00:00.000Z'} as ProvenanceState
          }
        />,
      ),
  },
  {
    screen: 'SmokeScreen',
    variant: 'default (run-checks-again button)',
    render: locale => renderUnderI18next(locale, <SmokeScreen />),
  },
  {
    screen: 'LanguageSwitcher',
    variant: 'default (one option per registered locale + system)',
    render: async locale => {
      let tree: ReactTestRenderer.ReactTestRenderer;
      await act(async () => {
        tree = ReactTestRenderer.create(
          <I18nProvider store={fakeLanguageStore()} systemLocaleSource={{getSystemLocale: () => locale}}>
            <LanguageSwitcher />
          </I18nProvider>,
        );
      });
      return tree!;
    },
  },
];

describe.each(SUPPORTED_LOCALES)('a11y: every interactive element has a name + role (%s)', locale => {
  it.each(SCREENS.map(s => [`${s.screen} — ${s.variant}`, s.render] as const))('%s', async (_label, render) => {
    const tree = await render(locale);
    assertAccessibleTree(tree.root);
  });
});
