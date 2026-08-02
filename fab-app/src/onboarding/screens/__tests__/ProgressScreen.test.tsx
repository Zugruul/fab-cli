/**
 * @format
 */

// §9.9 component tests: progress screen renders per-artifact state and
// exposes the pause/resume/retry control appropriate to each status —
// never more than one control at a time, and a visible error message on
// failure.
//
// #217: status text and control labels flow through i18next; `labels`
// (per-artifact display names, e.g. "Model pack") and `errorMessage` are
// caller-supplied/already-derived data, not this component's own UI copy,
// so they stay as-is across locales.

import React from "react";
import ReactTestRenderer, { act } from "react-test-renderer";
import { Text } from "react-native";
import { I18nextProvider } from "react-i18next";
import { ProgressScreen } from "../ProgressScreen";
import { initialProgressState } from "../../progressReducer";
import type { ProgressState } from "../../types";
import { createI18nInstance } from "../../../i18n/i18n";
import type { Locale } from "../../../i18n/types";

const labels = { "model-pack": "Model pack", "knowledge-pack": "Knowledge pack" } as const;

function render(
  progress: ProgressState,
  handlers = { onPause: jest.fn(), onResume: jest.fn(), onRetry: jest.fn() },
  locale: Locale = "en",
) {
  let tree: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <I18nextProvider i18n={createI18nInstance(locale)}>
        <ProgressScreen
          progress={progress}
          labels={labels}
          onPause={handlers.onPause}
          onResume={handlers.onResume}
          onRetry={handlers.onRetry}
        />
      </I18nextProvider>,
    );
  });
  return { tree: tree!, ...handlers };
}

describe("ProgressScreen (§9.9 progress with pause/resume/retry)", () => {
  it("queued state shows no control", () => {
    const { tree } = render(initialProgressState());
    expect(() => tree.root.findByProps({ testID: "progress-pause-model-pack" })).toThrow();
    expect(() => tree.root.findByProps({ testID: "progress-resume-model-pack" })).toThrow();
    expect(() => tree.root.findByProps({ testID: "progress-retry-model-pack" })).toThrow();
  });

  it("downloading state shows only a pause control, and tapping it calls onPause", () => {
    const state = { ...initialProgressState(), "model-pack": { status: "downloading" as const, bytesDownloaded: 400, totalBytes: 1000 } };
    const { tree, onPause } = render(state);
    expect(() => tree.root.findByProps({ testID: "progress-resume-model-pack" })).toThrow();
    act(() => {
      tree.root.findByProps({ testID: "progress-pause-model-pack" }).props.onPress();
    });
    expect(onPause).toHaveBeenCalledTimes(1);
  });

  it("paused state shows only a resume control, and tapping it calls onResume", () => {
    const state = { ...initialProgressState(), "model-pack": { status: "paused" as const, bytesDownloaded: 400, totalBytes: 1000 } };
    const { tree, onResume } = render(state);
    expect(() => tree.root.findByProps({ testID: "progress-pause-model-pack" })).toThrow();
    act(() => {
      tree.root.findByProps({ testID: "progress-resume-model-pack" }).props.onPress();
    });
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it("verifying state shows no control", () => {
    const state = { ...initialProgressState(), "knowledge-pack": { status: "verifying" as const, bytesDownloaded: 500, totalBytes: 500 } };
    const { tree } = render(state);
    expect(() => tree.root.findByProps({ testID: "progress-pause-knowledge-pack" })).toThrow();
    expect(() => tree.root.findByProps({ testID: "progress-resume-knowledge-pack" })).toThrow();
    expect(() => tree.root.findByProps({ testID: "progress-retry-knowledge-pack" })).toThrow();
  });

  it("installed state shows no control", () => {
    const state = { ...initialProgressState(), "knowledge-pack": { status: "installed" as const, bytesDownloaded: 500, totalBytes: 500 } };
    const { tree } = render(state);
    expect(() => tree.root.findByProps({ testID: "progress-retry-knowledge-pack" })).toThrow();
  });

  it("failed state shows the error message and a retry control, and tapping it calls onRetry", () => {
    const state = {
      ...initialProgressState(),
      "knowledge-pack": {
        status: "failed" as const,
        bytesDownloaded: 200,
        totalBytes: 500,
        errorKind: "other" as const,
        errorMessage: "connection dropped",
      },
    };
    const { tree, onRetry } = render(state);
    const errorNode = tree.root.findByProps({ testID: "progress-error-knowledge-pack" });
    expect(flatten(errorNode.props.children)).toContain("connection dropped");
    act(() => {
      tree.root.findByProps({ testID: "progress-retry-knowledge-pack" }).props.onPress();
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders status text and controls translated in pt-BR", () => {
    const state = {
      ...initialProgressState(),
      "model-pack": { status: "downloading" as const, bytesDownloaded: 400, totalBytes: 1000 },
    };
    const { tree } = render(state, undefined, "pt-BR");
    expect(tree.root.findByProps({ testID: "progress-status-model-pack" }).props.children).toContain("Baixando");
    expect(
      flatten(tree.root.findByProps({ testID: "progress-pause-model-pack" }).findByType(Text).props.children),
    ).toContain("Pausar");
  });

  it("renders the failed state's retry control translated in pt-BR", () => {
    const state = {
      ...initialProgressState(),
      "knowledge-pack": {
        status: "failed" as const,
        bytesDownloaded: 200,
        totalBytes: 500,
        errorKind: "other" as const,
        errorMessage: "connection dropped",
      },
    };
    const { tree } = render(state, undefined, "pt-BR");
    expect(
      flatten(tree.root.findByProps({ testID: "progress-retry-knowledge-pack" }).findByType(Text).props.children),
    ).toContain("Tentar novamente");
    // errorMessage is already-derived data, not this component's copy — unchanged across locales.
    expect(flatten(tree.root.findByProps({ testID: "progress-error-knowledge-pack" }).props.children)).toContain(
      "connection dropped",
    );
  });
});

function flatten(children: React.ReactNode): string {
  return React.Children.toArray(children).join("");
}
