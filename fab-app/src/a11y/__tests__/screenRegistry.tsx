/**
 * @format
 */

// Shared screen-registration table, extracted from screens.a11y.test.tsx
// (#218) so #219's theme suites (src/theme/__tests__/screens.theme.test.tsx
// and the theme dimension added to screens.a11y.test.tsx itself) reuse the
// exact same "one generic gate check across every screen" shape instead of
// re-deriving it — the SCREENS table below is the only thing a new screen
// touches; each suite's own it.each loop and assertion never change. Not a
// test file itself (jest.config.js's testPathIgnorePatterns mirrors the
// existing testDoubles.ts exclusion precedent), so it carries no `.test.`
// in its name.

import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {I18nextProvider} from 'react-i18next';
import {validModelPackManifest} from '@fab/manifest-schema';
import type {KnowledgePackManifest} from '@fab/manifest-schema';

import {createI18nInstance} from '../../i18n/i18n';
import {I18nProvider} from '../../i18n/I18nProvider';
import {LanguageSwitcher} from '../../i18n/LanguageSwitcher';
import type {LanguagePreferenceStore} from '../../i18n/languageStore';
import type {Locale} from '../../i18n/types';

import {ConsentScreen} from '../../onboarding/screens/ConsentScreen';
import {deriveArtifactSizes} from '../../onboarding/sizes';
import type {ArtifactSizes, ConsentGateState, ProgressState} from '../../onboarding/types';
import {FeatureGate} from '../../onboarding/screens/FeatureGate';
import {ProgressScreen} from '../../onboarding/screens/ProgressScreen';
import {initialProgressState} from '../../onboarding/progressReducer';
import {ProvenanceScreen} from '../../screens/ProvenanceScreen';
import type {ProvenanceState} from '../../provenance';
import {SmokeScreen} from '../../smokeScreen/SmokeScreen';
import {BenchmarkScreen} from '../../benchmark/BenchmarkScreen';
import type {BenchmarkRunResult} from '../../benchmark/types';

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

// APP-024 (#136): a small, complete BenchmarkRunResult fixture — one
// measured metric left "not-run" deliberately, since that's the honest
// state a real device run may carry for e.g. peakRamMb (see
// ../../benchmark/runner.ts).
const benchmarkRunResultFixture: BenchmarkRunResult = {
  tier: '1.7B',
  device: {model: 'iPhone 13 Pro', osVersion: 'iOS 17.5.1'},
  appVersion: '1.0.0',
  buildNumber: '42',
  iterations: 10,
  startedAt: '2026-08-01T00:00:00.000Z',
  completedAt: '2026-08-01T00:01:00.000Z',
  metrics: {
    decodeTokensPerSec: {status: 'measured', value: 12},
    prefillTokensPerSec: {status: 'measured', value: 400},
    ttftWarmMs: {status: 'measured', value: 2000},
    ttftColdMs: {status: 'measured', value: 6000},
    queryEmbeddingLatencyMs: {status: 'measured', value: 200},
    retrievalP95Ms: {status: 'measured', value: 30},
    peakRamMb: {status: 'not-run', reason: 'no on-device RAM sampler wired'},
  },
};

export function fakeLanguageStore(): LanguagePreferenceStore {
  let value: 'system' | Locale = 'system';
  return {
    getPreference: jest.fn(async () => value),
    setPreference: jest.fn(async pref => {
      value = pref;
    }),
  };
}

export async function renderUnderI18next(
  locale: Locale,
  node: React.ReactElement,
): Promise<ReactTestRenderer.ReactTestRenderer> {
  let tree: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<I18nextProvider i18n={createI18nInstance(locale)}>{node}</I18nextProvider>);
  });
  return tree!;
}

export interface ScreenVariant {
  screen: string;
  variant: string;
  render: (locale: Locale) => Promise<ReactTestRenderer.ReactTestRenderer>;
}

export const SCREENS: ScreenVariant[] = [
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
    screen: 'BenchmarkScreen',
    variant: 'idle (run control)',
    render: locale =>
      renderUnderI18next(
        locale,
        <BenchmarkScreen runBenchmark={() => Promise.resolve(benchmarkRunResultFixture)} onExport={() => {}} />,
      ),
  },
  {
    screen: 'BenchmarkScreen',
    variant: 'done (result JSON + export control)',
    render: async locale => {
      let tree: ReactTestRenderer.ReactTestRenderer;
      await act(async () => {
        tree = ReactTestRenderer.create(
          <I18nextProvider i18n={createI18nInstance(locale)}>
            <BenchmarkScreen runBenchmark={() => Promise.resolve(benchmarkRunResultFixture)} onExport={() => {}} />
          </I18nextProvider>,
        );
      });
      await act(async () => {
        tree!.root.findByProps({testID: 'benchmark-run'}).props.onPress();
        await Promise.resolve().then(() => Promise.resolve());
      });
      return tree!;
    },
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
