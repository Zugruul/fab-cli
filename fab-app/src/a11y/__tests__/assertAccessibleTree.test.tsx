/**
 * @format
 */

// #218 (SPEC-APP.md §9.12): generic accessibility walker. Rather than
// hand-writing "does this Touchable have a role/label" checks per screen
// (which would need new check logic every time a screen is added), this
// walks a rendered react-test-renderer tree once and flags every
// interactive RN primitive (Touchable*, Pressable, Switch, TextInput —
// see ../assertAccessibleTree.ts's POLICIES table) missing an accessible
// name and/or an appropriate role. Per-screen suites (screens.a11y.test.tsx)
// only ever call assertAccessibleTree(tree.root) — this file is what
// proves the walker itself is correct, mirroring how noHardcodedJsxLiterals
// tests the #217 lint rule rather than trusting it by inspection.

import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {Pressable, Switch, Text, TextInput, TouchableOpacity, View} from 'react-native';
import {assertAccessibleTree, findAccessibilityViolations} from '../assertAccessibleTree';

function render(children: React.ReactNode): ReactTestRenderer.ReactTestRenderer {
  let tree: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(<View>{children}</View>);
  });
  return tree!;
}

describe('findAccessibilityViolations / assertAccessibleTree (#218 generic a11y walker)', () => {
  it('passes a tree with no interactive elements at all', () => {
    const tree = render(<Text>Just some text</Text>);
    expect(findAccessibilityViolations(tree.root)).toEqual([]);
    expect(() => assertAccessibleTree(tree.root)).not.toThrow();
  });

  it('passes a Touchable with an explicit accessibilityRole and accessibilityLabel', () => {
    const tree = render(
      <TouchableOpacity
        testID="ok-explicit"
        accessibilityRole="button"
        accessibilityLabel="Save changes"
        onPress={() => {}}>
        <View />
      </TouchableOpacity>,
    );
    expect(findAccessibilityViolations(tree.root)).toEqual([]);
  });

  it('passes a Touchable with an accessibilityRole and its accessible name resolved from nested Text', () => {
    const tree = render(
      <TouchableOpacity testID="ok-text" accessibilityRole="button" onPress={() => {}}>
        <Text>Continue</Text>
      </TouchableOpacity>,
    );
    expect(findAccessibilityViolations(tree.root)).toEqual([]);
  });

  it('flags a Touchable with neither accessibilityLabel nor any text content', () => {
    const tree = render(
      <TouchableOpacity testID="bad-no-name" accessibilityRole="button" onPress={() => {}}>
        <View />
      </TouchableOpacity>,
    );
    const violations = findAccessibilityViolations(tree.root);
    expect(violations).toContainEqual(
      expect.objectContaining({testID: 'bad-no-name', reason: expect.stringContaining('accessible name')}),
    );
  });

  it('flags a Touchable with an accessibilityLabel but no accessibilityRole', () => {
    const tree = render(
      <TouchableOpacity testID="bad-no-role" accessibilityLabel="Save changes" onPress={() => {}}>
        <View />
      </TouchableOpacity>,
    );
    const violations = findAccessibilityViolations(tree.root);
    expect(violations).toContainEqual(
      expect.objectContaining({testID: 'bad-no-role', reason: expect.stringContaining('accessibilityRole')}),
    );
  });

  it('a `role` prop (aria-style) satisfies the role check the same as accessibilityRole', () => {
    const tree = render(
      <Pressable testID="ok-aria-role" role="button" accessibilityLabel="Save changes" onPress={() => {}}>
        <View />
      </Pressable>,
    );
    expect(findAccessibilityViolations(tree.root)).toEqual([]);
  });

  it('passes a Switch that has an explicit accessibilityLabel (no role required — RN defaults it)', () => {
    const tree = render(<Switch testID="ok-switch" accessibilityLabel="Enable notifications" value={false} onValueChange={() => {}} />);
    expect(findAccessibilityViolations(tree.root)).toEqual([]);
  });

  it('flags a Switch with no accessibilityLabel (it has no text content to fall back on)', () => {
    const tree = render(<Switch testID="bad-switch" value={false} onValueChange={() => {}} />);
    const violations = findAccessibilityViolations(tree.root);
    expect(violations).toContainEqual(
      expect.objectContaining({testID: 'bad-switch', reason: expect.stringContaining('accessible name')}),
    );
  });

  it('passes a TextInput with either accessibilityLabel or placeholder', () => {
    const tree = render(
      <View>
        <TextInput testID="ok-input-label" accessibilityLabel="Card name" value="" onChangeText={() => {}} />
        <TextInput testID="ok-input-placeholder" placeholder="Search cards" value="" onChangeText={() => {}} />
      </View>,
    );
    expect(findAccessibilityViolations(tree.root)).toEqual([]);
  });

  it('flags a TextInput with neither accessibilityLabel nor placeholder', () => {
    const tree = render(<TextInput testID="bad-input" value="" onChangeText={() => {}} />);
    const violations = findAccessibilityViolations(tree.root);
    expect(violations).toContainEqual(
      expect.objectContaining({testID: 'bad-input', reason: expect.stringContaining('accessible name')}),
    );
  });

  it('assertAccessibleTree throws a single Error naming every violating element, not just the first', () => {
    const tree = render(
      <View>
        <TouchableOpacity testID="bad-1" onPress={() => {}}>
          <View />
        </TouchableOpacity>
        <TouchableOpacity testID="bad-2" onPress={() => {}}>
          <View />
        </TouchableOpacity>
      </View>,
    );
    let thrown: Error | undefined;
    try {
      assertAccessibleTree(tree.root);
    } catch (err) {
      thrown = err as Error;
    }
    expect(thrown).toBeDefined();
    expect(thrown!.message).toContain('bad-1');
    expect(thrown!.message).toContain('bad-2');
  });
});
