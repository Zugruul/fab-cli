import React, { useCallback, useMemo, useReducer } from 'react';
import {
  Button,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import {
  benchmarkScreenReducer,
  initialBenchmarkScreenState,
} from './screenReducer';
import type { BenchmarkRunResult } from './types';
import { useTheme } from '../theme';
import type { ThemeTokens } from '../theme';

export interface BenchmarkScreenProps {
  /** Runs the §8.6 protocol and resolves with its result — a thin wrapper
   * around BenchmarkRunner.run() (./runner.ts) supplied by the caller so
   * this component stays free of any native-module wiring. */
  runBenchmark: () => Promise<BenchmarkRunResult>;
  /** Bare-minimum "export" per this task's pre-refinement UI rule: the
   * screen only shows the result JSON and hands it to this callback on
   * request — actual sharing/file-save wiring (share sheet, clipboard,
   * etc.) is a host-app concern, not built here. No export control is
   * rendered at all when this is omitted, rather than a dead button. */
  onExport?: (resultJson: string) => void;
}

/**
 * On-device benchmark screen (APP-024 / SPEC-APP.md §8.6). Bare-minimum,
 * pre-refinement UI: a button that runs the protocol via the injected
 * `runBenchmark` and displays the resulting JSON — mirrors SmokeScreen's
 * device-run note (real numbers only come from a real device run through
 * the APP-036 TestFlight pipeline; this screen exercises the protocol with
 * whatever clients the host app wires in).
 */
export function BenchmarkScreen({
  runBenchmark,
  onExport,
}: BenchmarkScreenProps): React.JSX.Element {
  const { t } = useTranslation();
  const { tokens } = useTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const [state, dispatch] = useReducer(
    benchmarkScreenReducer,
    undefined,
    initialBenchmarkScreenState,
  );

  const handleRun = useCallback(() => {
    dispatch({ type: 'RUN_START' });
    runBenchmark()
      .then(result => dispatch({ type: 'RUN_OK', result }))
      .catch((err: unknown) =>
        dispatch({ type: 'RUN_ERROR', message: describeError(err) }),
      );
  }, [runBenchmark]);

  const resultJson =
    state.status === 'done' ? JSON.stringify(state.result, null, 2) : undefined;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title} testID="benchmark-title">
          {t('benchmark.title')}
        </Text>
        <Button
          testID="benchmark-run"
          title={t('benchmark.run')}
          onPress={handleRun}
          disabled={state.status === 'running'}
        />
        {state.status === 'running' ? (
          <Text style={styles.status} testID="benchmark-status">
            {t('benchmark.running')}
          </Text>
        ) : null}
        {state.status === 'error' ? (
          <Text style={styles.error} testID="benchmark-error">
            {t('benchmark.error', { message: state.errorMessage })}
          </Text>
        ) : null}
        {state.status === 'done' && resultJson ? (
          <View testID="benchmark-result">
            <Text style={styles.status} testID="benchmark-done">
              {t('benchmark.done')}
            </Text>
            <Text style={styles.json} testID="benchmark-result-json" selectable>
              {resultJson}
            </Text>
            {onExport ? (
              <Button
                testID="benchmark-export"
                title={t('benchmark.export')}
                onPress={() => onExport(resultJson)}
              />
            ) : null}
          </View>
        ) : null}
        <Text style={styles.note} testID="benchmark-note">
          {t('benchmark.deviceRunNote')}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function createStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: tokens.background },
    content: { padding: 16, gap: 12 },
    title: { fontSize: 20, fontWeight: '700', color: tokens.text },
    status: { fontSize: 14, color: tokens.mutedText },
    error: { fontSize: 14, color: tokens.danger },
    json: { fontSize: 11, fontFamily: 'Courier', color: tokens.text },
    note: {
      marginTop: 16,
      fontSize: 12,
      color: tokens.mutedText,
      fontStyle: 'italic',
    },
  });
}
