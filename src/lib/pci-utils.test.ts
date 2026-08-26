/**
 * pci-utils.test.ts
 * -----------------------------------------------------------------------------
 * Runnable check for the Not Surveyed cleanup: parsePCIValue must never
 * produce NaN, getPCICategory must resolve null/NaN to Not Surveyed rather
 * than silently falling through to the ramp's last element, and averagePci
 * must report its denominator alongside the mean. See pci-cleanup-spec.md
 * section 12.1-12.3.
 * -----------------------------------------------------------------------------
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  parsePCIValue,
  getPCICategory,
  getPCIStyle,
  averagePci,
  countByCondition,
  pciCategories,
  NOT_SURVEYED,
  type SectionData,
} from './pci-utils.ts';

test('parsePCIValue(undefined) is null', () => {
  assert.equal(parsePCIValue(undefined), null);
});

test('parsePCIValue("") and parsePCIValue("   ") are null', () => {
  assert.equal(parsePCIValue(''), null);
  assert.equal(parsePCIValue('   '), null);
});

test('parsePCIValue("abc") is null', () => {
  assert.equal(parsePCIValue('abc'), null);
});

test('parsePCIValue("84abc") is null, not 84', () => {
  assert.equal(parsePCIValue('84abc'), null);
});

test('parsePCIValue("63.7") is 63.7', () => {
  assert.equal(parsePCIValue('63.7'), 63.7);
});

test('getPCICategory(null).label is "Not Surveyed"', () => {
  assert.equal(getPCICategory(null).label, NOT_SURVEYED.label);
});

test('getPCICategory(NaN).label is "Not Surveyed"', () => {
  assert.equal(getPCICategory(NaN).label, NOT_SURVEYED.label);
});

test('getPCICategory(95).label is "Good"', () => {
  assert.equal(getPCICategory(95).label, 'Good');
});

test('getPCICategory(85.5).label is "Satisfactory"', () => {
  assert.equal(getPCICategory(85.5).label, 'Satisfactory');
});

test('getPCICategory(11).label is "Failed" - lower bound inclusive, matching current behaviour', () => {
  assert.equal(getPCICategory(11).label, 'Failed');
});

test('getPCICategory(150).label is "Good" after clamping, not a silent fall-through', () => {
  assert.equal(getPCICategory(150).label, 'Good');
});

test('getPCICategory(-5).label is "Failed"', () => {
  assert.equal(getPCICategory(-5).label, 'Failed');
});

test('NOT_SURVEYED is not a member of pciCategories', () => {
  assert.equal(pciCategories.some((c) => c.label === NOT_SURVEYED.label), false);
});

test('averagePci([]) reports a null mean over zero of zero', () => {
  assert.deepEqual(averagePci([]), { mean: null, surveyed: 0, total: 0 });
});

test('averagePci computes the mean from surveyed sections only', () => {
  const sections: SectionData[] = [
    { Section: 'A', PCN: '', Type: '', 'PCI Rating': '80' },
    { Section: 'B', PCN: '', Type: '', 'PCI Rating': '90' },
    ...Array.from({ length: 73 }, (_, i) => ({ Section: `X${i}`, PCN: '', Type: '' })),
  ];
  const summary = averagePci(sections);
  assert.equal(summary.mean, 85);
  assert.equal(summary.surveyed, 2);
  assert.equal(summary.total, 75);
});

test('countByCondition separates Not Surveyed from the seven condition bands', () => {
  const sections: SectionData[] = [
    { Section: 'A', PCN: '', Type: '', 'PCI Rating': '80' },
    { Section: 'B', PCN: '', Type: '', 'PCI Rating': '90' },
    ...Array.from({ length: 73 }, (_, i) => ({ Section: `X${i}`, PCN: '', Type: '' })),
  ];
  const counts = countByCondition(sections);
  assert.equal(counts['Not Surveyed'], 73);
  const bandTotal = pciCategories.reduce((sum, cat) => sum + (counts[cat.label] ?? 0), 0);
  assert.equal(bandTotal, 2);
});

test('getPCIStyle(null).hatched is true', () => {
  assert.equal(getPCIStyle(null).hatched, true);
});

test('getPCIStyle(90).hatched is false', () => {
  assert.equal(getPCIStyle(90).hatched, false);
});

/* =============================================================================
 * Constant regression - the seven-band ramp is qgis2web output and must not
 * shift because of this cleanup.
 * ========================================================================== */

test('pciCategories hex ramp is unchanged', () => {
  assert.deepEqual(
    pciCategories.map((c) => c.color),
    ['#efefef', '#b40000', '#ff6dce', '#ff821b', '#fefe00', '#b2df8a', '#5a9a33'],
  );
});

/* =============================================================================
 * Data regression - run after scripts/strip-dummy-pci.mjs. Confirms the
 * strip removed exactly the PCI Rating property and nothing else.
 * ========================================================================== */

function loadJson(relativePath: string): { features: { properties: Record<string, unknown> }[] } {
  const url = new URL(relativePath, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), 'utf-8'));
}

test('pavement-data.json: PCI Rating removed from all 75 features, other properties intact', () => {
  const fc = loadJson('../../public/data/pavement-data.json');
  assert.equal(fc.features.length, 75);
  assert.ok(fc.features.every((f) => !('PCI Rating' in f.properties)));
  assert.ok(fc.features.every((f) => typeof f.properties.PCN === 'string'));
});

test('pavement-data-2024.json: PCI Rating removed from all 67 features', () => {
  const fc = loadJson('../../public/data/pavement-data-2024.json');
  assert.equal(fc.features.length, 67);
  assert.ok(fc.features.every((f) => !('PCI Rating' in f.properties)));
});

test('pavement-data-2026.json is untouched: still 2 surveyed features with PCI Rating', () => {
  const fc = loadJson('../../public/data/pavement-data-2026.json');
  assert.equal(fc.features.length, 2);
  assert.ok(fc.features.every((f) => 'PCI Rating' in f.properties));
});
