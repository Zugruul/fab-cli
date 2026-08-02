import React, { useEffect, useReducer, useState } from 'react';
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

import { checkLlama, checkSqlite, checkTflite } from './checks';
import { initialSmokeState, smokeReducer } from './reducer';
import { summarizeSmokeState } from './summary';
import { MODULE_LABELS, type ModuleId, type SmokeAction } from './types';

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
        <Text style={styles.title}>fab-app device smoke test</Text>
        <Text style={styles.subtitle}>
          {summary.allSettled
            ? `${summary.okCount}/4 native modules ok, ${summary.errorCount}/4 failed`
            : `checking ${summary.pendingCount}/4 native modules…`}
        </Text>
        {(Object.keys(MODULE_LABELS) as ModuleId[]).map(id => (
          <View key={id} style={styles.row} testID={`smoke-row-${id}`}>
            <Text style={styles.rowLabel}>{MODULE_LABELS[id]}</Text>
            <Text style={[styles.rowStatus, statusStyles[state[id].status]]}>
              {state[id].status.toUpperCase()}
            </Text>
            {state[id].detail ? (
              <Text style={styles.rowDetail}>{state[id].detail}</Text>
            ) : null}
          </View>
        ))}
        <Button
          title="Run checks again"
          onPress={() => setRunId(id => id + 1)}
          disabled={!summary.allSettled}
        />
        <Text style={styles.note}>
          Device run: pending human device test via the APP-036 TestFlight
          pipeline.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
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

const statusStyles = StyleSheet.create({
  idle: { color: '#888888' },
  checking: { color: '#b58900' },
  ok: { color: '#1a7f37' },
  error: { color: '#cf222e' },
});

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { padding: 16, gap: 12 },
  title: { fontSize: 20, fontWeight: '700' },
  subtitle: { fontSize: 14, color: '#555555', marginBottom: 8 },
  row: {
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#cccccc',
  },
  rowLabel: { fontSize: 16, fontWeight: '600' },
  rowStatus: { fontSize: 13, fontWeight: '700' },
  rowDetail: { fontSize: 12, color: '#555555', marginTop: 2 },
  note: { marginTop: 16, fontSize: 12, color: '#888888', fontStyle: 'italic' },
});
