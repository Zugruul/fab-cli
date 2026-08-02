/**
 * @format
 */

// §9.4 component tests: the Knowledge screen renders the three provenance
// fields from a "ready" ProvenanceState, and the honest empty state
// ("no knowledge pack installed yet") when none is installed — mirroring
// deriveProvenance's own states so the screen never invents copy of its own.

import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {ProvenanceScreen} from '../ProvenanceScreen';
import type {ProvenanceState} from '../../provenance';

function render(provenance: ProvenanceState) {
  let tree: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <ProvenanceScreen provenance={provenance} />,
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
});

function flatten(children: React.ReactNode): string {
  return React.Children.toArray(children).join('');
}
