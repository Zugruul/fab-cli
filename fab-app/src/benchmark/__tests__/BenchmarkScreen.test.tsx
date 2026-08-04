/**
 * @format
 */

// APP-024 (#136): exercises the harness end to end through the actual
// screen entry point in the RN test renderer (dev-brain lesson: "run the
// real thing past green tests" — not just unit tests of the pure pieces),
// with `runBenchmark` stubbed at the screen's own prop boundary. #217:
// every literal flows through i18next's t(), asserted per-locale like
// SmokeScreen.test.tsx / ConsentScreen.test.tsx.

import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {I18nextProvider} from 'react-i18next';
import {BenchmarkScreen} from '../BenchmarkScreen';
import type {BenchmarkRunResult} from '../types';
import {createI18nInstance} from '../../i18n/i18n';
import {LOCALE_BUNDLES, SUPPORTED_LOCALES} from '../../i18n/locales';
import type {Locale} from '../../i18n/types';

const FAKE_RESULT: BenchmarkRunResult = {
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
    peakRamMb: {status: 'not-run', reason: 'no sampler'},
  },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {promise, resolve, reject};
}

async function render(
  runBenchmark: () => Promise<BenchmarkRunResult>,
  onExport?: (json: string) => void,
  locale: Locale = 'en',
) {
  let tree: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <I18nextProvider i18n={createI18nInstance(locale)}>
        <BenchmarkScreen runBenchmark={runBenchmark} onExport={onExport} />
      </I18nextProvider>,
    );
  });
  return tree!;
}

function flatten(children: React.ReactNode): string {
  return React.Children.toArray(children).join('');
}

describe('BenchmarkScreen', () => {
  it('renders idle with an enabled run button and no result yet', async () => {
    const tree = await render(() => Promise.resolve(FAKE_RESULT));
    expect(() => tree.root.findByProps({testID: 'benchmark-title'})).not.toThrow();
    expect(tree.root.findByProps({testID: 'benchmark-run'}).props.disabled).toBeFalsy();
    expect(() => tree.root.findByProps({testID: 'benchmark-result'})).toThrow();
  });

  it('shows a running state (disabled run button) while the promise is pending, then the JSON result once it resolves', async () => {
    const {promise, resolve} = deferred<BenchmarkRunResult>();
    const tree = await render(() => promise);

    act(() => {
      tree.root.findByProps({testID: 'benchmark-run'}).props.onPress();
    });
    expect(tree.root.findByProps({testID: 'benchmark-run'}).props.disabled).toBe(true);
    expect(() => tree.root.findByProps({testID: 'benchmark-status'})).not.toThrow();

    await act(async () => {
      resolve(FAKE_RESULT);
      await promise;
    });

    expect(tree.root.findByProps({testID: 'benchmark-run'}).props.disabled).toBeFalsy();
    const json = flatten(tree.root.findByProps({testID: 'benchmark-result-json'}).props.children);
    expect(JSON.parse(json)).toEqual(FAKE_RESULT);
  });

  it('shows the error message when runBenchmark rejects', async () => {
    const tree = await render(() => Promise.reject(new Error('native module missing')));
    await act(async () => {
      tree.root.findByProps({testID: 'benchmark-run'}).props.onPress();
      await Promise.resolve().then(() => Promise.resolve());
    });
    expect(flatten(tree.root.findByProps({testID: 'benchmark-error'}).props.children)).toContain(
      'native module missing',
    );
  });

  it('renders an export button that calls onExport with the exact displayed JSON, when onExport is provided', async () => {
    const onExport = jest.fn();
    const tree = await render(() => Promise.resolve(FAKE_RESULT), onExport);
    await act(async () => {
      tree.root.findByProps({testID: 'benchmark-run'}).props.onPress();
      await Promise.resolve().then(() => Promise.resolve());
    });
    const json = flatten(tree.root.findByProps({testID: 'benchmark-result-json'}).props.children);
    act(() => {
      tree.root.findByProps({testID: 'benchmark-export'}).props.onPress();
    });
    expect(onExport).toHaveBeenCalledWith(json);
    expect(JSON.parse(json)).toEqual(FAKE_RESULT);
  });

  it('renders no export button when onExport is not provided, even after a result is available', async () => {
    const tree = await render(() => Promise.resolve(FAKE_RESULT));
    await act(async () => {
      tree.root.findByProps({testID: 'benchmark-run'}).props.onPress();
      await Promise.resolve().then(() => Promise.resolve());
    });
    expect(() => tree.root.findByProps({testID: 'benchmark-export'})).toThrow();
  });

  describe.each(SUPPORTED_LOCALES)('translated copy in %s', locale => {
    const bundle = LOCALE_BUNDLES[locale];

    it("renders the title, run button, and note using that locale's text", async () => {
      const tree = await render(() => Promise.resolve(FAKE_RESULT), undefined, locale);
      expect(flatten(tree.root.findByProps({testID: 'benchmark-title'}).props.children)).toBe(bundle.benchmark.title);
      expect(tree.root.findByProps({testID: 'benchmark-run'}).props.title).toBe(bundle.benchmark.run);
      expect(flatten(tree.root.findByProps({testID: 'benchmark-note'}).props.children)).toBe(
        bundle.benchmark.deviceRunNote,
      );
    });
  });
});
