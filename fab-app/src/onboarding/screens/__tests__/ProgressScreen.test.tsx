/**
 * @format
 */

// §9.9 component tests: progress screen renders per-artifact state and
// exposes the pause/resume/retry control appropriate to each status —
// never more than one control at a time, and a visible error message on
// failure.

import React from "react";
import ReactTestRenderer, { act } from "react-test-renderer";
import { ProgressScreen } from "../ProgressScreen";
import { initialProgressState } from "../../progressReducer";
import type { ProgressState } from "../../types";

const labels = { "model-pack": "Model pack", "knowledge-pack": "Knowledge pack" } as const;

function render(progress: ProgressState, handlers = { onPause: jest.fn(), onResume: jest.fn(), onRetry: jest.fn() }) {
  let tree: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <ProgressScreen
        progress={progress}
        labels={labels}
        onPause={handlers.onPause}
        onResume={handlers.onResume}
        onRetry={handlers.onRetry}
      />,
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
});

function flatten(children: React.ReactNode): string {
  return React.Children.toArray(children).join("");
}
