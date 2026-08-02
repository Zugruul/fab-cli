/**
 * @format
 */

// §9.4 component tests: the Knowledge screen renders the three provenance
// fields from a "ready" ProvenanceState, and the honest empty state
// ("no knowledge pack installed yet") when none is installed — mirroring
// deriveProvenance's own states so the screen never invents copy of its own.
//
// #217: the title and the three field templates flow through i18next;
// `provenance.message` (the empty-state text) is already-derived data
// supplied by the caller, not this component's own copy, so it stays
// unchanged across locales — same split FeatureGate's `reason` uses.

import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {I18nextProvider} from 'react-i18next';
import {ProvenanceScreen} from '../ProvenanceScreen';
import type {ProvenanceState} from '../../provenance';
import {createI18nInstance} from '../../i18n/i18n';
import {LOCALE_BUNDLES, SUPPORTED_LOCALES} from '../../i18n/locales';
import type {Locale} from '../../i18n/types';

function render(provenance: ProvenanceState, locale: Locale = 'en') {
  let tree: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <I18nextProvider i18n={createI18nInstance(locale)}>
        <ProvenanceScreen provenance={provenance} />
      </I18nextProvider>,
    );
  });
  return tree!;
}

describe('ProvenanceScreen (§9.4 Knowledge screen)', () => {
  it('renders knowledge up to / CR / legality-as-of from a ready provenance state', () => {
    const tree = render({
      status: 'ready',
      latestSet: 'OTA',
      crVersion: 'Wed, 10 Jun 2026 19:43:38 GMT',
      legalityAsOf: '2026-08-01T22:10:54.711Z',
    });

    const latestSet = tree.root.findByProps({testID: 'provenance-latest-set'});
    const crVersion = tree.root.findByProps({testID: 'provenance-cr-version'});
    const legalityAsOf = tree.root.findByProps({
      testID: 'provenance-legality-as-of',
    });

    expect(flatten(latestSet.props.children)).toContain('OTA');
    expect(flatten(crVersion.props.children)).toContain(
      'Wed, 10 Jun 2026 19:43:38 GMT',
    );
    expect(flatten(legalityAsOf.props.children)).toContain(
      '2026-08-01T22:10:54.711Z',
    );
    expect(() => tree.root.findByProps({testID: 'provenance-empty'})).toThrow();
  });

  it('renders the honest empty state when no knowledge pack is installed', () => {
    const tree = render({
      status: 'not-installed',
      message: 'no knowledge pack installed yet',
    });

    const empty = tree.root.findByProps({testID: 'provenance-empty'});
    expect(flatten(empty.props.children)).toContain(
      'no knowledge pack installed yet',
    );
    expect(() =>
      tree.root.findByProps({testID: 'provenance-latest-set'}),
    ).toThrow();
  });

  it('renders the unverified-chain message distinctly from the ready state', () => {
    const tree = render({
      status: 'unverified',
      message: 'knowledge pack corpusSnapshotHash mismatch',
    });

    const empty = tree.root.findByProps({testID: 'provenance-empty'});
    expect(flatten(empty.props.children)).toContain(
      'knowledge pack corpusSnapshotHash mismatch',
    );
  });

  // #217: parametrized over every registered locale — asserted against
  // that locale's own bundle templates, not hardcoded translated strings,
  // so a future locale added to the registry is covered automatically.
  describe.each(SUPPORTED_LOCALES)('translated copy in %s', locale => {
    const bundle = LOCALE_BUNDLES[locale];

    it("renders the title and field templates using that locale's text", () => {
      const tree = render(
        {
          status: 'ready',
          latestSet: 'OTA',
          crVersion: 'Wed, 10 Jun 2026 19:43:38 GMT',
          legalityAsOf: '2026-08-01T22:10:54.711Z',
        },
        locale,
      );

      expect(
        flatten(tree.root.findByProps({testID: 'provenance-title'}).props.children),
      ).toBe(bundle.screens.provenance.title);
      expect(
        flatten(tree.root.findByProps({testID: 'provenance-latest-set'}).props.children),
      ).toBe(bundle.screens.provenance.knowledgeUpTo.replace('{{set}}', 'OTA'));
      expect(
        flatten(tree.root.findByProps({testID: 'provenance-legality-as-of'}).props.children),
      ).toBe(
        bundle.screens.provenance.legalityAsOf.replace(
          '{{date}}',
          '2026-08-01T22:10:54.711Z',
        ),
      );
    });

    it('renders the empty-state message unchanged (already-derived data, not this component copy)', () => {
      const tree = render(
        {status: 'not-installed', message: 'no knowledge pack installed yet'},
        locale,
      );
      expect(
        flatten(tree.root.findByProps({testID: 'provenance-empty'}).props.children),
      ).toBe('no knowledge pack installed yet');
    });
  });
});

function flatten(children: React.ReactNode): string {
  return React.Children.toArray(children).join('');
}
