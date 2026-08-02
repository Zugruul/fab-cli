import React from "react";
import { SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
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
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Downloading</Text>
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
  return (
    <View style={styles.row} testID={`progress-row-${artifact}`}>
      <Text style={styles.label}>{label}</Text>
      <Text testID={`progress-status-${artifact}`}>{statusText(item)}</Text>

      {item.status === "downloading" && (
        <TouchableOpacity testID={`progress-pause-${artifact}`} onPress={onPause}>
          <Text style={styles.button}>Pause</Text>
        </TouchableOpacity>
      )}

      {item.status === "paused" && (
        <TouchableOpacity testID={`progress-resume-${artifact}`} onPress={onResume}>
          <Text style={styles.button}>Resume</Text>
        </TouchableOpacity>
      )}

      {item.status === "failed" && (
        <>
          <Text style={styles.error} testID={`progress-error-${artifact}`}>
            {item.errorMessage}
          </Text>
          <TouchableOpacity testID={`progress-retry-${artifact}`} onPress={onRetry}>
            <Text style={styles.button}>Retry</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

function statusText(item: ArtifactProgress): string {
  switch (item.status) {
    case "queued":
      return "Queued";
    case "downloading":
      return `Downloading ${formatBytes(item.bytesDownloaded)}${
        item.totalBytes != null ? ` / ${formatBytes(item.totalBytes)}` : ""
      }`;
    case "paused":
      return `Paused at ${formatBytes(item.bytesDownloaded)}`;
    case "verifying":
      return "Verifying…";
    case "installed":
      return "Installed";
    case "failed":
      return "Failed";
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
