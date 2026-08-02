import React from 'react';
import {SafeAreaView, ScrollView, StyleSheet, Text, View} from 'react-native';
import {useTranslation} from 'react-i18next';

import type {ProvenanceState} from '../provenance';

export interface ProvenanceScreenProps {
  provenance: ProvenanceState;
}

/**
 * Knowledge screen (APP-032 / SPEC-APP.md §9.4). Renders "knowledge up to:
 * <latest set>, CR <version>, legality as of <date>" from the active
 * manifests' already-derived ProvenanceState (see ../provenance/deriveProvenance.ts)
 * — this component only maps that state to text, it never derives the
 * fields itself, so it can never invent copy the manifests didn't provide.
 *
 * "not-installed" and "unverified" both render as the same honest empty
 * state (a short explanatory message, no fabricated set/CR/date) — a
 * missing knowledge pack and one whose corpusSnapshotHash doesn't verify
 * are both "there is nothing trustworthy to show yet".
 */
export function ProvenanceScreen({
  provenance,
}: ProvenanceScreenProps): React.JSX.Element {
  const {t} = useTranslation();
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{t('screens.provenance.title')}</Text>
        {provenance.status === 'ready' ? (
          <View testID="provenance-ready">
            <Text style={styles.row} testID="provenance-latest-set">
              {t('screens.provenance.knowledgeUpTo', {set: provenance.latestSet})}
            </Text>
            <Text style={styles.row} testID="provenance-cr-version">
              {t('screens.provenance.crVersion', {version: provenance.crVersion})}
            </Text>
            <Text style={styles.row} testID="provenance-legality-as-of">
              {t('screens.provenance.legalityAsOf', {date: provenance.legalityAsOf})}
            </Text>
          </View>
        ) : (
          <Text style={styles.empty} testID="provenance-empty">
            {provenance.message}
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {flex: 1},
  content: {padding: 16, gap: 8},
  title: {fontSize: 20, fontWeight: '700'},
  row: {fontSize: 14, color: '#333333'},
  empty: {fontSize: 14, color: '#888888', fontStyle: 'italic'},
});
