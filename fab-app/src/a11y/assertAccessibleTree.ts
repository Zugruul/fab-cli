// #218 (SPEC-APP.md §9.12): a generic accessibility walker over a rendered
// react-test-renderer tree. Every interactive RN primitive present in the
// app today (or likely in future screens) is registered once in POLICIES
// below, keyed by how its accessible NAME can be resolved and whether an
// explicit role is required — this is the only table a future primitive
// touches; findAccessibilityViolations/assertAccessibleTree never change
// per screen (screens.a11y.test.tsx only ever registers a new screen/
// variant, never new check logic, per the #218 brief).
//
// RN's own <Button> needs no separate case: it always renders down to one
// of the Touchable* components below with accessibilityRole="button" and
// its `title` as a nested <Text> child (see react-native's Button.js) — so
// a Button that renders at all is checked automatically via whichever
// Touchable it composes into, exactly like any hand-written Touchable.
//
// Name resolution deliberately only asks "is there SOME non-empty string a
// screen reader could announce" (an explicit accessibilityLabel, resolved
// nested Text content, or — for TextInput only — a placeholder) — it does
// not assert specific translated copy. Content correctness (including
// per-locale translated text) is each screen's own #217 test file's job;
// this only proves *something* accessible is exposed, generically, for
// every registered locale a screen renders under.

import type {ReactTestInstance} from 'react-test-renderer';
import {Pressable, Switch, Text, TextInput, TouchableHighlight, TouchableNativeFeedback, TouchableOpacity, TouchableWithoutFeedback} from 'react-native';

type NameStrategy =
  | 'labelOrText' // Touchable*/Pressable: accessibilityLabel, else resolved nested <Text> content
  | 'labelOnly' // Switch: no text content of its own — must be explicit
  | 'labelOrPlaceholder'; // TextInput: accessibilityLabel, else its own placeholder

interface InteractivePolicy {
  component: unknown;
  displayName: string;
  nameStrategy: NameStrategy;
  /** Switch's accessibilityRole defaults to 'switch' inside react-native
   * itself when not set (see Libraries/Components/Switch/Switch.js) — that
   * default is structurally guaranteed regardless of what the author
   * writes, so it isn't re-checked here. TextInput has no comparable
   * single "role" concept to validate generically. */
  requiresRole: boolean;
}

const POLICIES: InteractivePolicy[] = [
  {component: TouchableOpacity, displayName: 'TouchableOpacity', nameStrategy: 'labelOrText', requiresRole: true},
  {component: TouchableHighlight, displayName: 'TouchableHighlight', nameStrategy: 'labelOrText', requiresRole: true},
  {
    component: TouchableWithoutFeedback,
    displayName: 'TouchableWithoutFeedback',
    nameStrategy: 'labelOrText',
    requiresRole: true,
  },
  {
    component: TouchableNativeFeedback,
    displayName: 'TouchableNativeFeedback',
    nameStrategy: 'labelOrText',
    requiresRole: true,
  },
  {component: Pressable, displayName: 'Pressable', nameStrategy: 'labelOrText', requiresRole: true},
  {component: Switch, displayName: 'Switch', nameStrategy: 'labelOnly', requiresRole: false},
  {component: TextInput, displayName: 'TextInput', nameStrategy: 'labelOrPlaceholder', requiresRole: false},
];

export interface AccessibilityViolation {
  component: string;
  testID?: string;
  reason: string;
}

export function findAccessibilityViolations(root: ReactTestInstance): AccessibilityViolation[] {
  const violations: AccessibilityViolation[] = [];

  for (const policy of POLICIES) {
    const instances = root.findAllByType(policy.component as never);
    for (const instance of instances) {
      const testID = typeof instance.props.testID === 'string' ? instance.props.testID : undefined;

      if (!resolveAccessibleName(instance, policy.nameStrategy)) {
        violations.push({
          component: policy.displayName,
          testID,
          reason: 'no accessible name (accessibilityLabel, visible text, or placeholder)',
        });
      }

      if (policy.requiresRole && !hasAccessibilityRole(instance)) {
        violations.push({
          component: policy.displayName,
          testID,
          reason: 'no accessibilityRole (or role) prop',
        });
      }
    }
  }

  return violations;
}

export function assertAccessibleTree(root: ReactTestInstance): void {
  const violations = findAccessibilityViolations(root);
  if (violations.length === 0) {
    return;
  }
  const details = violations
    .map(v => `- <${v.component}${v.testID ? ` testID="${v.testID}"` : ''}>: ${v.reason}`)
    .join('\n');
  throw new Error(`Found ${violations.length} interactive element(s) without proper accessibility wiring:\n${details}`);
}

function resolveAccessibleName(instance: ReactTestInstance, strategy: NameStrategy): string | undefined {
  const label = instance.props.accessibilityLabel;
  if (typeof label === 'string' && label.trim().length > 0) {
    return label.trim();
  }

  if (strategy === 'labelOrText') {
    const text = flattenNestedText(instance).trim();
    return text.length > 0 ? text : undefined;
  }

  if (strategy === 'labelOrPlaceholder') {
    const placeholder = instance.props.placeholder;
    return typeof placeholder === 'string' && placeholder.trim().length > 0 ? placeholder.trim() : undefined;
  }

  return undefined; // 'labelOnly'
}

function flattenNestedText(instance: ReactTestInstance): string {
  return instance
    .findAllByType(Text)
    .map(node => flattenChildren(node.props.children))
    .join('');
}

function flattenChildren(children: unknown): string {
  if (children == null || typeof children === 'boolean') {
    return '';
  }
  if (typeof children === 'string' || typeof children === 'number') {
    return String(children);
  }
  if (Array.isArray(children)) {
    return children.map(flattenChildren).join('');
  }
  return '';
}

function hasAccessibilityRole(instance: ReactTestInstance): boolean {
  const role = instance.props.accessibilityRole ?? instance.props.role;
  return typeof role === 'string' && role.trim().length > 0;
}
