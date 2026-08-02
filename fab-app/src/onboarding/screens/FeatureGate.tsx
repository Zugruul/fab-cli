import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { FeatureAvailability } from "../types";

export interface FeatureGateProps {
  feature: FeatureAvailability;
  featureLabel: string;
  children: React.ReactNode;
}

/**
 * §9.9 degraded-mode navigation: renders `children` when the feature is
 * available, otherwise an honest "not ready" message (never a bare error
 * screen) built from FeatureAvailability's own `reason` — this component
 * never invents copy, it only maps the already-derived state (see
 * ../readiness.ts) to a view, the same split ProvenanceScreen/deriveProvenance
 * use. Intended to wrap the Q&A and scanning screens' bodies.
 */
export function FeatureGate({ feature, featureLabel, children }: FeatureGateProps): React.JSX.Element {
  if (feature.available) {
    return <>{children}</>;
  }
  return (
    <View style={styles.container} testID="feature-gate-not-ready">
      <Text style={styles.title}>{featureLabel} isn&apos;t ready yet</Text>
      <Text style={styles.reason} testID="feature-gate-reason">
        {feature.reason}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 8 },
  title: { fontSize: 16, fontWeight: "600" },
  reason: { fontSize: 14, color: "#666666" },
});
