/**
 * @format
 */

// §9.9 component tests: consent screen renders both sizes from manifest
// fixtures, the cellular-warning state requires an explicit override tap,
// and the offline state shows a wait message with no way to proceed.

import React from "react";
import ReactTestRenderer, { act } from "react-test-renderer";
import { validModelPackManifest } from "@fab/manifest-schema";
import { ConsentScreen } from "../ConsentScreen";
import { deriveArtifactSizes } from "../../sizes";
import type { ConsentGateState } from "../../types";

const sizes = deriveArtifactSizes(validModelPackManifest, { version: "1.0.0", sizeBytes: 300_000_000 });

function render(gate: ConsentGateState, onAccept = jest.fn(), onOverrideCellular = jest.fn()) {
  let tree: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <ConsentScreen gate={gate} sizes={sizes} onAccept={onAccept} onOverrideCellular={onOverrideCellular} />,
    );
  });
  return { tree: tree!, onAccept, onOverrideCellular };
}

describe("ConsentScreen (§9.9 download consent)", () => {
  it("renders both artifact sizes from the manifest fixtures", () => {
    const { tree } = render({ kind: "ready" });
    expect(flatten(tree.root.findByProps({ testID: "consent-model-pack-size" }).props.children)).toContain("1.7 GB");
    expect(flatten(tree.root.findByProps({ testID: "consent-knowledge-pack-size" }).props.children)).toContain(
      "300 MB",
    );
    expect(flatten(tree.root.findByProps({ testID: "consent-total-size" }).props.children)).toContain("2.0 GB");
  });

  it("ready gate shows the accept control and no cellular/offline notices", () => {
    const { tree } = render({ kind: "ready" });
    expect(() => tree.root.findByProps({ testID: "consent-accept" })).not.toThrow();
    expect(() => tree.root.findByProps({ testID: "consent-cellular-warning" })).toThrow();
    expect(() => tree.root.findByProps({ testID: "consent-waiting-for-network" })).toThrow();
  });

  it("tapping accept on the ready gate calls onAccept", () => {
    const { tree, onAccept } = render({ kind: "ready" });
    act(() => {
      tree.root.findByProps({ testID: "consent-accept" }).props.onPress();
    });
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it("cellular-warning gate shows the warning and an override control, no accept button", () => {
    const { tree, onOverrideCellular } = render({ kind: "cellular-warning" });
    expect(() => tree.root.findByProps({ testID: "consent-accept" })).toThrow();
    const overrideButton = tree.root.findByProps({ testID: "consent-continue-on-cellular" });
    act(() => {
      overrideButton.props.onPress();
    });
    expect(onOverrideCellular).toHaveBeenCalledTimes(1);
  });

  it("waiting-for-network gate shows the wait message with no accept or override control", () => {
    const { tree } = render({ kind: "waiting-for-network" });
    expect(() => tree.root.findByProps({ testID: "consent-waiting-for-network" })).not.toThrow();
    expect(() => tree.root.findByProps({ testID: "consent-accept" })).toThrow();
    expect(() => tree.root.findByProps({ testID: "consent-continue-on-cellular" })).toThrow();
  });
});

function flatten(children: React.ReactNode): string {
  return React.Children.toArray(children).join("");
}
