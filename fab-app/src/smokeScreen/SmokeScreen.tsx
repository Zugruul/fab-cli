import React, { useEffect, useMemo, useReducer, useState } from 'react';
import {
  Button,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  useCameraDevices,
  useCameraPermission,
} from 'react-native-vision-camera';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { checkLlama, checkSqlite, checkTflite } from './checks';
import { MODULE_IDS, initialSmokeState, smokeReducer } from './reducer';
import { summarizeSmokeState } from './summary';
import type { ModuleId, ModuleStatus, SmokeAction } from './types';
import { useTheme } from '../theme';
import type { ThemeTokens } from '../theme';

/**
 * Device smoke screen (APP-030 / SPEC-APP.md §9.1). Exercises the four
 * native pillars fab-app depends on and reports whether each linked
 * correctly on the running device:
 *  - llama.rn: JSI install only, no model load — reports build info.
 *  - op-sqlite: opens an in-memory DB, creates a vec0 (sqlite-vec) table,
 *    inserts and queries one vector.
 *  - vision-camera: requests camera permission, reports discovered devices.
 *  - fast-tflite: reports that the module loaded (no bundled model to run).
 *
 * This is a manual, human-run device check (SPEC-APP.md §15 "Device
 * (release-gating, manual/scripted)") — it is not part of the merge gate.
 */
export function SmokeScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const { tokens } = useTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const statusStyles = useMemo(() => createStatusStyles(tokens), [tokens]);
  const [state, dispatch] = useReducer(
    smokeReducer,
    undefined,
    initialSmokeState,
  );
  const [runId, setRunId] = useState(0);
  const summary = summarizeSmokeState(state);

  useModuleCheck(dispatch, 'llama', checkLlama, runId);
  useModuleCheck(dispatch, 'sqlite', checkSqlite, runId);
  useModuleCheck(dispatch, 'tflite', checkTflite, runId);
  useCameraModuleCheck(dispatch, runId);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title} testID="smoke-title">
          {t('smoke.title')}
        </Text>
        <Text style={styles.subtitle} testID="smoke-summary">
          {summary.allSettled
            ? t('smoke.summarySettled', { ok: summary.okCount, error: summary.errorCount })
            : t('smoke.summaryChecking', { pending: summary.pendingCount })}
        </Text>
        {MODULE_IDS.map(id => (
          <View key={id} style={styles.row} testID={`smoke-row-${id}`}>
            <Text style={styles.rowLabel}>{t(`smoke.modules.${id}`)}</Text>
            <Text style={[styles.rowStatus, statusStyles[state[id].status]]}>
              {statusLabel(t, state[id].status)}
            </Text>
            {state[id].detail ? (
              <Text style={styles.rowDetail}>{state[id].detail}</Text>
            ) : null}
          </View>
        ))}
        <Button
          testID="smoke-run-checks"
          title={t('smoke.runChecksAgain')}
          onPress={() => setRunId(id => id + 1)}
          disabled={!summary.allSettled}
        />
        <Text style={styles.note} testID="smoke-note">
          {t('smoke.deviceRunNote')}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function statusLabel(t: TFunction, status: ModuleStatus): string {
  return t(`smoke.status.${status}`);
}

function useModuleCheck(
  dispatch: React.Dispatch<SmokeAction>,
  module: ModuleId,
  check: () => Promise<string>,
  runId: number,
): void {
  useEffect(() => {
    let cancelled = false;
    dispatch({ type: 'CHECK_START', module });
    check()
      .then(detail => {
        if (!cancelled) {
          dispatch({ type: 'CHECK_OK', module, detail });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          dispatch({ type: 'CHECK_ERROR', module, detail: describeError(err) });
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);
}

/**
 * vision-camera exposes permission + device discovery as hooks rather than
 * plain functions, so its check can't share the imperative useModuleCheck
 * path above — it reacts to the hook's own state instead.
 */
function useCameraModuleCheck(
  dispatch: React.Dispatch<SmokeAction>,
  runId: number,
): void {
  const { hasPermission, canRequestPermission, requestPermission, status } =
    useCameraPermission();
  const devices = useCameraDevices();

  useEffect(() => {
    let cancelled = false;
    dispatch({ type: 'CHECK_START', module: 'camera' });
    (async () => {
      try {
        const granted =
          hasPermission ||
          (canRequestPermission && (await requestPermission()));
        if (cancelled) {
          return;
        }
        if (!granted) {
          dispatch({
            type: 'CHECK_ERROR',
            module: 'camera',
            detail: `permission ${status}`,
          });
          return;
        }
        dispatch({
          type: 'CHECK_OK',
          module: 'camera',
          detail: `permission granted, ${devices.length} device(s) found`,
        });
      } catch (err) {
        if (!cancelled) {
          dispatch({
            type: 'CHECK_ERROR',
            module: 'camera',
            detail: describeError(err),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function createStatusStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    idle: { color: tokens.mutedText },
    checking: { color: tokens.warning },
    ok: { color: tokens.success },
    error: { color: tokens.danger },
  });
}

function createStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: tokens.background },
    content: { padding: 16, gap: 12 },
    title: { fontSize: 20, fontWeight: '700', color: tokens.text },
    subtitle: { fontSize: 14, color: tokens.mutedText, marginBottom: 8 },
    row: {
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: tokens.border,
    },
    rowLabel: { fontSize: 16, fontWeight: '600', color: tokens.text },
    rowStatus: { fontSize: 13, fontWeight: '700' },
    rowDetail: { fontSize: 12, color: tokens.mutedText, marginTop: 2 },
    note: { marginTop: 16, fontSize: 12, color: tokens.mutedText, fontStyle: 'italic' },
  });
}
