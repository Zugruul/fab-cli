import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { FeatureAvailability } from "../types";
import { useTheme } from "../../theme";
import type { ThemeTokens } from "../../theme";

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
  const { t } = useTranslation();
  const { tokens } = useTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  if (feature.available) {
    return <>{children}</>;
  }
  return (
    <View style={styles.container} testID="feature-gate-not-ready">
      <Text style={styles.title} testID="feature-gate-title">
        {t("onboarding.featureGate.notReady", { feature: featureLabel })}
      </Text>
      <Text style={styles.reason} testID="feature-gate-reason">
        {feature.reason}
      </Text>
    </View>
  );
}

function createStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    container: { padding: 16, gap: 8 },
    title: { fontSize: 16, fontWeight: "600", color: tokens.text },
    reason: { fontSize: 14, color: tokens.mutedText },
  });
}
