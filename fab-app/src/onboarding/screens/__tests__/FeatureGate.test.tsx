/**
 * @format
 */

// §9.9 degraded-mode navigation: FeatureGate renders its children when a
// feature is available, and an honest "not ready" message (never a bare
// error) built from FeatureAvailability's own reason when it isn't —
// mirroring ProvenanceScreen's split between pure derivation and
// presentational mapping.

import React from "react";
import ReactTestRenderer, { act } from "react-test-renderer";
import { Text } from "react-native";
import { FeatureGate } from "../FeatureGate";

function render(available: boolean, reason?: string) {
  let tree: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <FeatureGate feature={{ available, reason }} featureLabel="Q&A">
        <Text testID="qa-content">Ask a question</Text>
      </FeatureGate>,
    );
  });
  return tree!;
}

describe("FeatureGate", () => {
  it("renders its children when the feature is available", () => {
    const tree = render(true);
    expect(tree.root.findByProps({ testID: "qa-content" }).props.children).toBe("Ask a question");
  });

  it("renders the not-ready message (not the children) when the feature is unavailable", () => {
    const tree = render(false, "model pack not installed yet");
    const reasonNode = tree.root.findByProps({ testID: "feature-gate-reason" });
    expect(flatten(reasonNode.props.children)).toContain("model pack not installed yet");
    expect(() => tree.root.findByProps({ testID: "qa-content" })).toThrow();
  });
});

function flatten(children: React.ReactNode): string {
  return React.Children.toArray(children).join("");
}
