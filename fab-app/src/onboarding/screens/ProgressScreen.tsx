import React from "react";
import { SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { ArtifactProgress, OnboardingArtifactId, ProgressState } from "../types";
import { ONBOARDING_ARTIFACT_IDS } from "../progressReducer";
import { formatBytes } from "../sizes";

export interface ProgressScreenProps {
  progress: ProgressState;
  labels: Record<OnboardingArtifactId, string>;
  onPause: (artifact: OnboardingArtifactId) => void;
  onResume: (artifact: OnboardingArtifactId) => void;
  onRetry: (artifact: OnboardingArtifactId) => void;
}

/**
 * Download progress screen (§9.9 "progress with pause/resume/retry"):
 * renders each onboarding artifact's already-derived ArtifactProgress
 * (../progressReducer.ts) and exposes exactly the control valid for its
 * current status — pause while downloading, resume while paused, retry on
 * failure, no control while queued/verifying/installed. The actual
 * pause/resume/retry operations are the caller's responsibility (wiring
 * ArtifactManager/ResumableDownloader per artifact); this component only
 * forwards the tap.
 */
export function ProgressScreen({ progress, labels, onPause, onResume, onRetry }: ProgressScreenProps): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{t("onboarding.progress.title")}</Text>
        {ONBOARDING_ARTIFACT_IDS.map((artifact) => (
          <ArtifactRow
            key={artifact}
            artifact={artifact}
            label={labels[artifact]}
            item={progress[artifact]}
            onPause={() => onPause(artifact)}
            onResume={() => onResume(artifact)}
            onRetry={() => onRetry(artifact)}
          />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

interface ArtifactRowProps {
  artifact: OnboardingArtifactId;
  label: string;
  item: ArtifactProgress;
  onPause: () => void;
  onResume: () => void;
  onRetry: () => void;
}

function ArtifactRow({ artifact, label, item, onPause, onResume, onRetry }: ArtifactRowProps): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <View style={styles.row} testID={`progress-row-${artifact}`}>
      <Text style={styles.label}>{label}</Text>
      <Text testID={`progress-status-${artifact}`}>{statusText(t, item)}</Text>

      {item.status === "downloading" && (
        <TouchableOpacity testID={`progress-pause-${artifact}`} onPress={onPause}>
          <Text style={styles.button}>{t("onboarding.progress.pause")}</Text>
        </TouchableOpacity>
      )}

      {item.status === "paused" && (
        <TouchableOpacity testID={`progress-resume-${artifact}`} onPress={onResume}>
          <Text style={styles.button}>{t("onboarding.progress.resume")}</Text>
        </TouchableOpacity>
      )}

      {item.status === "failed" && (
        <>
          <Text style={styles.error} testID={`progress-error-${artifact}`}>
            {item.errorMessage}
          </Text>
          <TouchableOpacity testID={`progress-retry-${artifact}`} onPress={onRetry}>
            <Text style={styles.button}>{t("onboarding.progress.retry")}</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

function statusText(t: TFunction, item: ArtifactProgress): string {
  switch (item.status) {
    case "queued":
      return t("onboarding.progress.status.queued");
    case "downloading":
      return item.totalBytes != null
        ? t("onboarding.progress.status.downloadingWithTotal", {
            downloaded: formatBytes(item.bytesDownloaded),
            total: formatBytes(item.totalBytes),
          })
        : t("onboarding.progress.status.downloadingUnknownTotal", { downloaded: formatBytes(item.bytesDownloaded) });
    case "paused":
      return t("onboarding.progress.status.paused", { downloaded: formatBytes(item.bytesDownloaded) });
    case "verifying":
      return t("onboarding.progress.status.verifying");
    case "installed":
      return t("onboarding.progress.status.installed");
    case "failed":
      return t("onboarding.progress.status.failed");
    default:
      return "";
  }
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { padding: 16, gap: 16 },
  title: { fontSize: 20, fontWeight: "700" },
  row: { gap: 4 },
  label: { fontSize: 16, fontWeight: "600" },
  button: { fontSize: 14, fontWeight: "600", color: "#0a84ff" },
  error: { fontSize: 12, color: "#cc3333" },
});
