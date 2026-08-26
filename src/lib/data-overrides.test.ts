/**
 * data-overrides.test.ts
 * -----------------------------------------------------------------------------
 * mergeSectionRiskMeta is the one piece of non-obvious branching logic in
 * data-overrides.ts (partial-patch merge + delete-on-undefined cleanup), and
 * it backs the Admin Risk Inventory form's "reset to inferred" button - a
 * silently-wrong merge there would leave stale overrides sitting in
 * localStorage. Everything else in this file is straight get/set/parse.
 * -----------------------------------------------------------------------------
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeSectionRiskMeta, mergeSectionInventory, loadOverrides } from './data-overrides.ts';

test('mergeSectionRiskMeta adds a field to an empty override', () => {
  const result = mergeSectionRiskMeta({}, { role: 'runway' });
  assert.deepEqual(result, { role: 'runway' });
});

test('mergeSectionRiskMeta patches one field without touching the others', () => {
  const existing = { role: 'runway' as const, lastInspectionYear: 2024 };
  const result = mergeSectionRiskMeta(existing, { dominantDistress: 'RAVELING' });
  assert.deepEqual(result, { role: 'runway', lastInspectionYear: 2024, dominantDistress: 'RAVELING' });
});

test('mergeSectionRiskMeta deletes a field patched to undefined, rather than storing undefined', () => {
  const existing = { role: 'runway' as const, lastInspectionYear: 2024 };
  const result = mergeSectionRiskMeta(existing, { role: undefined });
  assert.deepEqual(result, { lastInspectionYear: 2024 });
  assert.ok(!('role' in result), 'role key must be absent, not present-with-undefined');
});

test('mergeSectionRiskMeta clearing every field returns an empty object (the "reset" button)', () => {
  const existing = { role: 'runway' as const, lastInspectionYear: 2024, dominantDistress: 'RAVELING' };
  const result = mergeSectionRiskMeta(existing, {
    role: undefined,
    lastInspectionYear: undefined,
    dominantDistress: undefined,
  });
  assert.deepEqual(result, {});
});

// mergeSectionInventory shares mergeSectionRiskMeta's underlying merge-patch
// logic (see mergePatch in data-overrides.ts) - these two cases just confirm
// the section-inventory override (Admin -> Section PCI -> Edit details,
// backing Type/PCN/Dimension/Last Major Construction Year) is wired to it
// correctly, not re-proving the merge semantics themselves.
test('mergeSectionInventory patches one field without touching the others', () => {
  const existing = { Type: 'Asphalt' };
  const result = mergeSectionInventory(existing, { PCN: '111/R/D/W/T' });
  assert.deepEqual(result, { Type: 'Asphalt', PCN: '111/R/D/W/T' });
});

test('mergeSectionInventory clearing every field returns an empty object', () => {
  const existing = { Type: 'Asphalt', PCN: '111/R/D/W/T', Dimension: '3660 x 60 m' };
  const result = mergeSectionInventory(existing, {
    Type: undefined,
    PCN: undefined,
    Dimension: undefined,
  });
  assert.deepEqual(result, {});
});

// loadOverrides reads from a browser-only `localStorage` global that Node's
// test runner doesn't provide - a minimal in-memory stub, scoped to this one
// test, is enough to exercise the whitelist without pulling in a DOM library.
test('loadOverrides drops an unknown field (sectionRehab, from v2.9) while keeping sectionPci intact', () => {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  };
  try {
    store.set(
      'apms-data-overrides-v1',
      JSON.stringify({ sectionPci: { '2025': { NP1: '70' } }, sectionRehab: { '2025': {} } }),
    );
    const result = loadOverrides();
    assert.deepEqual(result.sectionPci, { '2025': { NP1: '70' } });
    assert.ok(!('sectionRehab' in result), 'sectionRehab must not survive the whitelist');
  } finally {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});
