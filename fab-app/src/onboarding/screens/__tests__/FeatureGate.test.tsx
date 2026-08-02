/**
 * @format
 */

// §9.9 degraded-mode navigation: FeatureGate renders its children when a
// feature is available, and an honest "not ready" message (never a bare
// error) built from FeatureAvailability's own reason when it isn't —
// mirroring ProvenanceScreen's split between pure derivation and
// presentational mapping.
//
// #217: the "{feature} isn't ready yet" template flows through i18next;
// `feature.reason` itself is already-derived data (like ProvenanceScreen's
// `provenance.message`), not UI copy owned by this component, so it's left
// untranslated on purpose and asserted unchanged in both locales.

import React from "react";
import ReactTestRenderer, { act } from "react-test-renderer";
import { Text } from "react-native";
import { I18nextProvider } from "react-i18next";
import { FeatureGate } from "../FeatureGate";
import { createI18nInstance } from "../../../i18n/i18n";
import { LOCALE_BUNDLES, SUPPORTED_LOCALES } from "../../../i18n/locales";
import type { Locale } from "../../../i18n/types";

function render(available: boolean, reason?: string, locale: Locale = "en") {
  let tree: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <I18nextProvider i18n={createI18nInstance(locale)}>
        <FeatureGate feature={{ available, reason }} featureLabel="Q&A">
          <Text testID="qa-content">Ask a question</Text>
        </FeatureGate>
      </I18nextProvider>,
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

  // #217: parametrized over every registered locale — asserted against
  // that locale's own bundle template, not a hardcoded translated string.
  describe.each(SUPPORTED_LOCALES)("not-ready title in %s", locale => {
    it("renders using that locale's template, with the reason left as-is", () => {
      const tree = render(false, "model pack not installed yet", locale);
      const expected = LOCALE_BUNDLES[locale].onboarding.featureGate.notReady.replace("{{feature}}", "Q&A");
      expect(flatten(tree.root.findByProps({ testID: "feature-gate-title" }).props.children)).toBe(expected);
      expect(flatten(tree.root.findByProps({ testID: "feature-gate-reason" }).props.children)).toContain(
        "model pack not installed yet",
      );
    });
  });
});

function flatten(children: React.ReactNode): string {
  return React.Children.toArray(children).join("");
}
