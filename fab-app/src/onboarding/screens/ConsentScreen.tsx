import React from "react";
import { SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { ArtifactSizes, ConsentGateState } from "../types";
import { formatBytes } from "../sizes";

export interface ConsentScreenProps {
  gate: ConsentGateState;
  sizes: ArtifactSizes;
  onAccept: () => void;
  onOverrideCellular: () => void;
}

/**
 * First-run download consent screen (§9.9): shows the model pack +
 * knowledge pack sizes (from ../sizes.ts, itself derived from the
 * manifests) and gates the accept action on the already-derived
 * ConsentGateState (../consentGate.ts) — this component only maps that
 * state to a view, it never re-derives network/consent logic itself.
 */
export function ConsentScreen({ gate, sizes, onAccept, onOverrideCellular }: ConsentScreenProps): React.JSX.Element {
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Download FAB knowledge & model</Text>

        <View testID="consent-sizes">
          <Text style={styles.row} testID="consent-model-pack-size">
            Model pack: {formatBytes(sizes.modelPackBytes)}
          </Text>
          <Text style={styles.row} testID="consent-knowledge-pack-size">
            Knowledge pack: {formatBytes(sizes.knowledgePackBytes)}
          </Text>
          <Text style={styles.row} testID="consent-total-size">
            Total: {formatBytes(sizes.totalBytes)}
          </Text>
        </View>

        {gate.kind === "waiting-for-network" && (
          <Text style={styles.notice} testID="consent-waiting-for-network">
            No connection — waiting for Wi-Fi or cellular to download.
          </Text>
        )}

        {gate.kind === "cellular-warning" && (
          <View testID="consent-cellular-warning">
            <Text style={styles.notice}>You&apos;re on cellular. We recommend Wi-Fi for this download.</Text>
            <TouchableOpacity testID="consent-continue-on-cellular" onPress={onOverrideCellular}>
              <Text style={styles.button}>Continue on Cellular</Text>
            </TouchableOpacity>
          </View>
        )}

        {gate.kind === "ready" && (
          <TouchableOpacity testID="consent-accept" onPress={onAccept}>
            <Text style={styles.button}>Download</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { padding: 16, gap: 12 },
  title: { fontSize: 20, fontWeight: "700" },
  row: { fontSize: 14, color: "#333333" },
  notice: { fontSize: 14, color: "#996600" },
  button: { fontSize: 16, fontWeight: "600", color: "#0a84ff" },
});
