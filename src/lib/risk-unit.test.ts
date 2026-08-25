/**
 * risk-unit.test.ts
 * -----------------------------------------------------------------------------
 * Runnable check for Metode B (sample-unit level Fine-Kinney scoring), mirroring
 * risk.test.ts's pattern. Fixtures for units 265, 16 and 221 are the three
 * real-survey examples pinned in metode-b-spec_4.md section 8.1.
 *
 * Uses node:test + node:assert/strict - no new dependency. Run with:
 *   npm test
 * -----------------------------------------------------------------------------
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  distressIndex,
  extentLevel,
  likelihoodFromDistressIndex,
  scoreUnit,
  scoreUnits,
  type UnitDistress,
  type UnitRiskInput,
} from './risk-unit.ts';
import { observedRateClass } from './observed-rate.ts';
import { bandFor } from './risk.ts';
import { assessIcao } from './icao.ts';
import { toUnitRiskInputs } from './risk-unit-adapter.ts';
import type { GeoJSONFeatureCollection } from './geojson-types.ts';

function loadFc(relativePath: string): GeoJSONFeatureCollection {
  return JSON.parse(readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf-8'));
}

/* =============================================================================
 * §8.1 fixtures - the three real-survey units pinned in the brief.
 * ========================================================================== */

function baseInput(overrides: Partial<UnitRiskInput>): UnitRiskInput {
  return {
    branchId: '06/24',
    unitNumber: 1,
    stationKm: 0,
    zone: 'tengah',
    areaM2: 600,
    surveyYear: 2026,
    role: 'runway',
    distresses: [],
    pci: 100,
    pciIsReal: true,
    ...overrides,
  };
}

const UNIT_265: UnitRiskInput = baseInput({
  unitNumber: 265,
  zone: 'ujung',
  distresses: [
    { type: 'RAVELING', severity: 'High', quantity: 13.81, quantityUnits: 'SqM', densityPct: 2.302 },
    { type: 'RAVELING', severity: 'Medium', quantity: 40.94, quantityUnits: 'SqM', densityPct: 6.824 },
  ],
  pci: 67.8, // 2026
  previousPci: 66.6, // 2025
  previousPciIsReal: true,
});

const UNIT_16: UnitRiskInput = baseInput({
  unitNumber: 16,
  zone: 'ujung',
  distresses: [
    { type: 'RAVELING', severity: 'Medium', quantity: 43.74, quantityUnits: 'SqM', densityPct: 7.290 },
    { type: 'RAVELING', severity: 'High', quantity: 4.92, quantityUnits: 'SqM', densityPct: 0.820 },
  ],
  pci: 45.6, // 2026
  previousPci: 77.0, // 2025
  previousPciIsReal: true,
});

const UNIT_221: UnitRiskInput = baseInput({
  unitNumber: 221,
  zone: 'tengah',
  distresses: [
    { type: 'PATCHING', severity: 'Low', quantity: 3.62, quantityUnits: 'SqM', densityPct: 0.603 },
    { type: 'RAVELING', severity: 'Low', quantity: 0.12, quantityUnits: 'SqM', densityPct: 0.020 },
  ],
  pci: 79.4, // 2026
  previousPci: 96.3, // 2025
  previousPciIsReal: true,
});

/* =============================================================================
 * §8.2.1 - distressIndex on the three fixtures, exactly.
 * ========================================================================== */

test('1. distressIndex returns 16, 12 and 2 for units 265, 16 and 221', () => {
  assert.equal(distressIndex(UNIT_265.distresses), 16);
  assert.equal(distressIndex(UNIT_16.distresses), 12);
  assert.equal(distressIndex(UNIT_221.distresses), 2);
});

test('2. PATCHING never contributes to distressIndex', () => {
  const patchOnly: UnitDistress[] = [
    { type: 'PATCHING', severity: 'High', quantity: 100, quantityUnits: 'SqM', densityPct: 50 },
  ];
  assert.equal(distressIndex(patchOnly), 0);
  // Unit 221 also pins this: its Patching Low record is the largest by
  // quantity but contributes nothing - only the Raveling Low record (index 2) does.
  assert.equal(distressIndex(UNIT_221.distresses), 2);
});

test('3. a unit with no distress scores index 0 and likelihood 0.1', () => {
  assert.equal(distressIndex([]), 0);
  assert.equal(likelihoodFromDistressIndex(0), 0.1);
});

test('3b. extentLevel thresholds are per distress type, not shared', () => {
  assert.equal(extentLevel('L & T CR', 0.10), 2);
  assert.equal(extentLevel('RAVELING', 0.10), 2);

  assert.equal(extentLevel('L & T CR', 0.30), 3);
  assert.equal(extentLevel('RAVELING', 0.30), 3);

  // 0.60 is where the two thresholds diverge: L&T's third threshold is 0.50
  // (crossed), RAVELING's is 1.00 (not yet crossed).
  assert.equal(extentLevel('L & T CR', 0.60), 4);
  assert.equal(extentLevel('RAVELING', 0.60), 3);
});

test('3c. a unit with only L & T CR is scored against L&T thresholds, not RAVELING\'s', () => {
  const onlyLandT: UnitDistress[] = [
    { type: 'L & T CR', severity: 'High', quantity: 0.36, quantityUnits: 'M', densityPct: 0.60 },
  ];
  // Using L&T's own thresholds: sev(High)=4 x ext(0.60 -> level 4) = 16.
  // A uniform-threshold bug would read RAVELING's thresholds instead and get
  // ext level 3 (score 12), so this test catches exactly that mistake.
  assert.equal(distressIndex(onlyLandT), 16);
});

test('3d. a distress recorded in M never enters an area-based computation', () => {
  const onlyLandT: UnitDistress[] = [
    { type: 'L & T CR', severity: 'High', quantity: 0.36, quantityUnits: 'M', densityPct: 0.60 },
  ];
  const input = baseInput({ distresses: onlyLandT, areaM2: 600 });
  const result = scoreUnit(input);
  // DRU Extent sums only SqM-quantity distress; an M-unit record contributes 0.
  assert.equal(result.dru.extentPct, 0);
});

/* =============================================================================
 * §8.2.4 - observed-rate class gating.
 * ========================================================================== */

test('4. observedRateClass is tidak_terdefinisi when repairedSincePrevious is true', () => {
  assert.equal(observedRateClass(70, 80, true, true, true), 'tidak_terdefinisi');
});

test('4b. observedRateClass is tidak_terdefinisi when either PCI is a display filler', () => {
  assert.equal(observedRateClass(70, 80, false, false, true), 'tidak_terdefinisi');
  assert.equal(observedRateClass(70, 80, false, true, false), 'tidak_terdefinisi');
});

test('4c. a unit from a dummy-PCI branch still gets a valid L, C, R and band', () => {
  const dummyPciUnit = baseInput({
    branchId: 'NP2', // not 06/24 or 07L/25R
    pciIsReal: false,
    previousPciIsReal: false,
    distresses: [{ type: 'RAVELING', severity: 'High', quantity: 10, quantityUnits: 'SqM', densityPct: 2 }],
  });
  const result = scoreUnit(dummyPciUnit);
  assert.equal(result.observedRateClass, 'tidak_terdefinisi');
  assert.equal(typeof result.likelihood, 'number');
  assert.equal(typeof result.consequence, 'number');
  assert.equal(typeof result.riskScore, 'number');
  assert.ok(result.band);
  assert.ok(result.riskScore > 0);
});

test('5. unit 16 is memburuk_cepat, unit 265 is stabil', () => {
  assert.equal(scoreUnit(UNIT_16).observedRateClass, 'memburuk_cepat');
  assert.equal(scoreUnit(UNIT_265).observedRateClass, 'stabil');
});

/* =============================================================================
 * §8.2.6-8 - R, RISK_BANDS boundaries, ICAO crosswalk.
 * ========================================================================== */

test('6. R = L x F x C exactly, with no intermediate rounding', () => {
  const result = scoreUnit(UNIT_265);
  assert.equal(result.riskScore, result.likelihood * result.frequency * result.consequence);
});

test('7. RISK_BANDS boundaries are exact at 20, 70, 200 and 400', () => {
  assert.equal(bandFor(19.999).degree, 1);
  assert.equal(bandFor(20).degree, 2);
  assert.equal(bandFor(69.999).degree, 2);
  assert.equal(bandFor(70).degree, 3);
  assert.equal(bandFor(199.999).degree, 3);
  assert.equal(bandFor(200).degree, 4);
  assert.equal(bandFor(399.999).degree, 4);
  assert.equal(bandFor(400).degree, 5);
});

test('8. ICAO cell 4B lands in the intolerable zone', () => {
  // LF = 1 x 10 = 10 -> probability 4; C = 40 -> severity B.
  const icao = assessIcao(1, 10, 40);
  assert.equal(icao.cell, '4B');
  assert.equal(icao.zone, 'Intolerable');
});

test('9. an L, F or C override wins outright and is recorded in trace', () => {
  const overridden = scoreUnit({ ...UNIT_265, overrides: { likelihood: 10, frequency: 10, consequence: 100 } });
  assert.equal(overridden.likelihood, 10);
  assert.equal(overridden.frequency, 10);
  assert.equal(overridden.consequence, 100);
  assert.equal(overridden.riskScore, 10 * 10 * 100);
  assert.ok(overridden.trace.some((t) => t.includes('L overridden')));
  assert.ok(overridden.trace.some((t) => t.includes('F overridden')));
  assert.ok(overridden.trace.some((t) => t.includes('C overridden')));
});

/* =============================================================================
 * §8.2.10 - the full real network scores without throwing.
 * ========================================================================== */

test('10. all 300 06/24 units and all 360 07L/25R units score without throwing', () => {
  const fc0624 = loadFc('../../public/data/runway-06-24-units-2026.json');
  const prev0624 = loadFc('../../public/data/runway-06-24-units-2025.json');
  const inputs0624 = toUnitRiskInputs('06/24', 'runway', 2026, fc0624, prev0624);
  assert.equal(inputs0624.length, 300);
  const results0624 = scoreUnits(inputs0624);
  assert.equal(results0624.length, 300);

  const fcRwy2 = loadFc('../../public/data/runway-07L-25R-units-2026.json');
  const prevRwy2 = loadFc('../../public/data/runway-07L-25R-units-2025.json');
  const inputsRwy2 = toUnitRiskInputs('07L/25R', 'runway', 2026, fcRwy2, prevRwy2);
  const resultsRwy2 = scoreUnits(inputsRwy2);
  assert.equal(resultsRwy2.length, inputsRwy2.length);

  for (const r of [...results0624, ...resultsRwy2]) {
    assert.ok(Number.isFinite(r.riskScore));
    assert.ok(r.band);
    assert.ok(r.icao);
    assert.ok(r.dru);
  }
});
