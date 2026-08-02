import React, { useMemo } from "react";
import { SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { ArtifactSizes, ConsentGateState } from "../types";
import { formatBytes } from "../sizes";
import { useTheme } from "../../theme";
import type { ThemeTokens } from "../../theme";

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
  const { t } = useTranslation();
  const { tokens } = useTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{t("onboarding.consent.title")}</Text>

        <View testID="consent-sizes">
          <Text style={styles.row} testID="consent-model-pack-size">
            {t("onboarding.consent.modelPackSize", { size: formatBytes(sizes.modelPackBytes) })}
          </Text>
          <Text style={styles.row} testID="consent-knowledge-pack-size">
            {t("onboarding.consent.knowledgePackSize", { size: formatBytes(sizes.knowledgePackBytes) })}
          </Text>
          <Text style={styles.row} testID="consent-total-size">
            {t("onboarding.consent.totalSize", { size: formatBytes(sizes.totalBytes) })}
          </Text>
        </View>

        {gate.kind === "waiting-for-network" && (
          <Text style={styles.notice} testID="consent-waiting-for-network">
            {t("onboarding.consent.waitingForNetwork")}
          </Text>
        )}

        {gate.kind === "cellular-warning" && (
          <View testID="consent-cellular-warning">
            <Text style={styles.notice} testID="consent-cellular-warning-text">
              {t("onboarding.consent.cellularWarning")}
            </Text>
            <TouchableOpacity
              testID="consent-continue-on-cellular"
              accessibilityRole="button"
              onPress={onOverrideCellular}
            >
              <Text style={styles.button}>{t("onboarding.consent.continueOnCellular")}</Text>
            </TouchableOpacity>
          </View>
        )}

        {gate.kind === "ready" && (
          <TouchableOpacity testID="consent-accept" accessibilityRole="button" onPress={onAccept}>
            <Text style={styles.button}>{t("onboarding.consent.download")}</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: tokens.background },
    content: { padding: 16, gap: 12 },
    title: { fontSize: 20, fontWeight: "700", color: tokens.text },
    row: { fontSize: 14, color: tokens.text },
    notice: { fontSize: 14, color: tokens.warning },
    button: { fontSize: 16, fontWeight: "600", color: tokens.accent },
  });
}
