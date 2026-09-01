/**
 * risk-unit.test.ts
 * -----------------------------------------------------------------------------
 * Runnable check for Metode B (sample-unit level Fine-Kinney scoring), mirroring
 * risk.test.ts's pattern. Migrated for metode-b-r1-spec.md - see its section 15
 * for the per-test rationale (kept / rewritten / replaced / deleted).
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
  totalDeductValue,
  coveragePct,
  likelihoodFromDeduct,
  likelihoodFromUnitPci,
  frequencyFromCoverage,
  HAZARD_CLASS_PRECEDENCE,
  scoreUnit,
  scoreUnits,
  type UnitDistress,
  type UnitRiskInput,
} from './risk-unit.ts';
import { observedRateClass } from './observed-rate.ts';
import { comparableYears } from '../config/surveyRegimes.ts';
import { bandFor } from './risk.ts';
import { assessIcao } from './icao.ts';
import { toUnitRiskInputs, astmConsistent } from './risk-unit-adapter.ts';
import type { GeoJSONFeatureCollection } from './geojson-types.ts';

function loadFc(relativePath: string): GeoJSONFeatureCollection {
  return JSON.parse(readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf-8'));
}

/* =============================================================================
 * Fixtures - units 265, 16, 221, real 2025-survey distress records (same raw
 * quantities and deduct values as metode-b-r1-spec.md section 11.2's
 * "old-spec conversion" table), relabelled onto a synthetic 2026-vs-2025
 * comparison so tests 5/6/9 below can exercise the observed-rate path too.
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
    astmConsistent: true,
    ...overrides,
  };
}

const UNIT_265: UnitRiskInput = baseInput({
  unitNumber: 265,
  zone: 'ujung',
  distresses: [
    { type: 'RAVELING', severity: 'High', quantity: 13.81, quantityUnits: 'SqM', deduct: 28.4 },
    { type: 'RAVELING', severity: 'Medium', quantity: 40.94, quantityUnits: 'SqM', deduct: 17.5 },
  ],
  pci: 67.8, // 2026
  previousPci: 66.6, // 2025
  previousPciIsReal: true,
  previousSurveyYear: 2025,
});

const UNIT_16: UnitRiskInput = baseInput({
  unitNumber: 16,
  zone: 'ujung',
  distresses: [
    { type: 'RAVELING', severity: 'Medium', quantity: 43.74, quantityUnits: 'SqM', deduct: 18.0 },
    { type: 'RAVELING', severity: 'High', quantity: 4.92, quantityUnits: 'SqM', deduct: 14.8 },
  ],
  pci: 45.6, // 2026
  previousPci: 77.0, // 2025
  previousPciIsReal: true,
  previousSurveyYear: 2025,
});

const UNIT_221: UnitRiskInput = baseInput({
  unitNumber: 221,
  zone: 'tengah',
  distresses: [
    { type: 'PATCHING', severity: 'Low', quantity: 3.62, quantityUnits: 'SqM', deduct: 2.7 },
    { type: 'RAVELING', severity: 'Low', quantity: 0.12, quantityUnits: 'SqM', deduct: 1.0 },
  ],
  pci: 79.4, // 2026
  previousPci: 96.3, // 2025
  previousPciIsReal: true,
  previousSurveyYear: 2025,
});

/* =============================================================================
 * §3 - TDV, coverage, and PATCHING's new role.
 * ========================================================================== */

test('2. PATCHING contributes to TDV and coverage, but never triggers consequence escalation', () => {
  // Section 6: unit 221's dominant distress by deduct is now PATCHING (2.7 > 1.0).
  assert.equal(totalDeductValue(UNIT_221.distresses), 3.7);
  assert.ok(coveragePct(UNIT_221.distresses) > 0);
  const result = scoreUnit(UNIT_221);
  assert.equal(result.dominantDistress, 'PATCHING');
  // A patching-only-High unit must NOT escalate C (section 5.2) - only a
  // non-PATCHING High-severity record triggers escalation.
  const patchHighOnly: UnitDistress[] = [{ type: 'PATCHING', severity: 'High', quantity: 100, quantityUnits: 'SqM', deduct: 50 }];
  const patched = scoreUnit(baseInput({ distresses: patchHighOnly, role: 'runway' }));
  assert.equal(patched.consequence, 15); // base fod consequence, unescalated
});

/* =============================================================================
 * §11.1 - jangkar terhadap metode induk: a unit with no distress.
 * ========================================================================== */

test('3. a unit with no distress anchors to the parent method: L 0.1, F 0.5, C 1, R 0.05, degree 1, cell 1E', () => {
  const clean = scoreUnit(baseInput({ distresses: [] }));
  assert.equal(clean.tdv, 0);
  assert.equal(clean.coveragePct, 0);
  assert.equal(clean.likelihood, 0.1);
  assert.equal(clean.frequency, 0.5);
  assert.equal(clean.consequence, 1);
  assert.equal(clean.riskScore, 0.05);
  assert.equal(clean.band.degree, 1);
  assert.equal(clean.icao.cell, '1E');
  // Holds under variant B too: TDV 0 and PCI 100 both fall to the lowest level.
  const cleanB = scoreUnit(baseInput({ distresses: [] }), 'pci');
  assert.equal(cleanB.likelihood, 0.1);
  assert.equal(cleanB.riskScore, 0.05);
});

test('3d. a distress recorded in M contributes to coverage via LINEAR_INFLUENCE_WIDTH_M, never any other way', () => {
  const onlyLandT: UnitDistress[] = [{ type: 'L & T CR', severity: 'High', quantity: 0.36, quantityUnits: 'M', deduct: 10 }];
  // 0.36 m x 1.0 m influence width / 600 m2 x 100 = 0.06%.
  assert.equal(coveragePct(onlyLandT), (0.36 * 1.0 / 600) * 100);
  const result = scoreUnit(baseInput({ distresses: onlyLandT, areaM2: 600 }));
  assert.equal(result.dru.extentPct, result.coveragePct);
});

/* =============================================================================
 * §7 - survey-regime guard and observed-rate gating.
 * ========================================================================== */

test('4. observedRateClass is tidak_terdefinisi across an incomparable survey-regime pair', () => {
  // RWY 06/24 2025 (paver-lengkap) vs. 2024 (tanpa-distress): different regimes.
  assert.equal(comparableYears('06/24', 2025, 2024), false);
  assert.equal(observedRateClass(91.75, 99.61, false, true, true, '06/24', 2025, 2024), 'tidak_terdefinisi');
  // Same branch, comparable regime pair: the guard does not block it.
  assert.equal(comparableYears('06/24', 2026, 2025), true);
});

test('4b. observedRateClass is tidak_terdefinisi when either PCI is a display filler', () => {
  assert.equal(observedRateClass(70, 80, false, false, true, '06/24', 2026, 2025), 'tidak_terdefinisi');
  assert.equal(observedRateClass(70, 80, false, true, false, '06/24', 2026, 2025), 'tidak_terdefinisi');
});

test('4c. a unit from a dummy-PCI branch still gets a valid L, C, R and band under variant A, and variant B refuses it', () => {
  const dummyPciUnit = baseInput({
    branchId: 'NP2', // not 06/24 or 07L/25R
    pciIsReal: false,
    previousPciIsReal: false,
    distresses: [{ type: 'RAVELING', severity: 'High', quantity: 10, quantityUnits: 'SqM', deduct: 20 }],
  });
  const result = scoreUnit(dummyPciUnit);
  assert.equal(result.observedRateClass, 'tidak_terdefinisi');
  assert.equal(typeof result.likelihood, 'number');
  assert.equal(typeof result.consequence, 'number');
  assert.equal(typeof result.riskScore, 'number');
  assert.ok(result.band);
  assert.ok(result.riskScore > 0);
  assert.equal(result.likelihoodPci, null);
  // Section 3.6: scoring a display-filler-PCI unit under variant B must throw,
  // never silently score off the fabricated PCI.
  assert.throws(() => scoreUnit(dummyPciUnit, 'pci'));
});

test('5. unit 16 is memburuk_cepat, unit 265 is stabil', () => {
  assert.equal(scoreUnit(UNIT_16).observedRateClass, 'memburuk_cepat');
  assert.equal(scoreUnit(UNIT_265).observedRateClass, 'stabil');
});

/* =============================================================================
 * §11.1 - R, RISK_BANDS boundaries, ICAO crosswalk.
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
 * §11.1 point 2 - IEEE-754 floating point warning (new in this revision, now
 * that F varies instead of being locked at a constant 10).
 * ========================================================================== */

test('6b. R = L x F x C survives non-exact floating point products (e.g. 0.2 x 3 x 40)', () => {
  const result = scoreUnit({ ...UNIT_265, overrides: { likelihood: 0.2, frequency: 3, consequence: 40 } });
  assert.ok(Math.abs(result.riskScore - 24) < 1e-9);
});

/* =============================================================================
 * §11.2/15.4 - the full real network scores without throwing, for all three
 * reference files in section 11.4.
 * ========================================================================== */

test('10. every unit across all three reference files scores without throwing', () => {
  const fc0624_2025 = loadFc('../../public/data/runway-06-24-units-2025.json');
  const fc0624_2024 = loadFc('../../public/data/runway-06-24-units-2024.json');
  const inputs0624_2025 = toUnitRiskInputs('06/24', 'runway', 2025, fc0624_2025, fc0624_2024, 2024);
  assert.equal(inputs0624_2025.length, 300);

  const fc0624_2026 = loadFc('../../public/data/runway-06-24-units-2026.json');
  const inputs0624_2026 = toUnitRiskInputs('06/24', 'runway', 2026, fc0624_2026, fc0624_2025, 2025);
  assert.equal(inputs0624_2026.length, 300);

  const fcRwy2_2026 = loadFc('../../public/data/runway-07L-25R-units-2026.json');
  const fcRwy2_2025 = loadFc('../../public/data/runway-07L-25R-units-2025.json');
  const inputsRwy2 = toUnitRiskInputs('07L/25R', 'runway', 2026, fcRwy2_2026, fcRwy2_2025, 2025);
  assert.equal(inputsRwy2.length, 360);

  for (const source of ['tdv', 'pci'] as const) {
    const results = [...scoreUnits(inputs0624_2025, source), ...scoreUnits(inputs0624_2026, source), ...scoreUnits(inputsRwy2, source)];
    assert.equal(results.length, 960);
    for (const r of results) {
      assert.ok(Number.isFinite(r.riskScore));
      assert.ok(r.band);
      assert.ok(r.icao);
      assert.ok(r.dru);
    }
  }
});

test('11. changing the likelihood source moves L and R but leaves F, C, hazardClass, dominantDistress and observedRateClass alone', () => {
  const fc = loadFc('../../public/data/runway-07L-25R-units-2026.json');
  const prev = loadFc('../../public/data/runway-07L-25R-units-2025.json');
  const inputs = toUnitRiskInputs('07L/25R', 'runway', 2026, fc, prev, 2025);
  const a = scoreUnits(inputs, 'tdv');
  const b = scoreUnits(inputs, 'pci');
  for (let i = 0; i < a.length; i++) {
    assert.equal(a[i].frequency, b[i].frequency, `unit ${a[i].unitNumber} frequency`);
    assert.equal(a[i].consequence, b[i].consequence, `unit ${a[i].unitNumber} consequence`);
    assert.equal(a[i].hazardClass, b[i].hazardClass, `unit ${a[i].unitNumber} hazardClass`);
    assert.equal(a[i].dominantDistress, b[i].dominantDistress, `unit ${a[i].unitNumber} dominantDistress`);
    assert.equal(a[i].observedRateClass, b[i].observedRateClass, `unit ${a[i].unitNumber} observedRateClass`);
  }
});

test('12. the five pinned variant-comparison units land on their documented degrees', () => {
  function degreeFor(branchId: string, year: number, prevYear: number, unit: number, source: 'tdv' | 'pci') {
    const fileFor = (b: string, y: number) => `../../public/data/runway-${b === '06/24' ? '06-24' : '07L-25R'}-units-${y}.json`;
    const cur = loadFc(fileFor(branchId, year));
    const prev = loadFc(fileFor(branchId, prevYear));
    const inputs = toUnitRiskInputs(branchId, 'runway', year, cur, prev, prevYear);
    const result = scoreUnits(inputs, source).find((r) => r.unitNumber === unit);
    if (!result) throw new Error(`unit ${unit} not found`);
    return result.band.degree;
  }

  assert.equal(degreeFor('06/24', 2025, 2024, 215, 'tdv'), 4);
  assert.equal(degreeFor('06/24', 2025, 2024, 215, 'pci'), 1);
  assert.equal(degreeFor('06/24', 2026, 2025, 43, 'tdv'), 4);
  assert.equal(degreeFor('06/24', 2026, 2025, 43, 'pci'), 2);
  assert.equal(degreeFor('06/24', 2026, 2025, 288, 'tdv'), 4);
  assert.equal(degreeFor('06/24', 2026, 2025, 288, 'pci'), 2);
  assert.equal(degreeFor('07L/25R', 2026, 2025, 98, 'tdv'), 5);
  assert.equal(degreeFor('07L/25R', 2026, 2025, 98, 'pci'), 2);
  assert.equal(degreeFor('07L/25R', 2026, 2025, 59, 'tdv'), 5);
  assert.equal(degreeFor('07L/25R', 2026, 2025, 59, 'pci'), 3);
});

/* =============================================================================
 * §15.4 - new unit tests for the section 3/4/6/10 helper functions.
 * ========================================================================== */

test('likelihoodFromDeduct: exact at all six ASTM condition-class boundaries', () => {
  assert.equal(likelihoodFromDeduct(89.999), 6);
  assert.equal(likelihoodFromDeduct(90), 10);
  assert.equal(likelihoodFromDeduct(74.999), 3);
  assert.equal(likelihoodFromDeduct(75), 6);
  assert.equal(likelihoodFromDeduct(59.999), 1);
  assert.equal(likelihoodFromDeduct(60), 3);
  assert.equal(likelihoodFromDeduct(44.999), 0.5);
  assert.equal(likelihoodFromDeduct(45), 1);
  assert.equal(likelihoodFromDeduct(29.999), 0.2);
  assert.equal(likelihoodFromDeduct(30), 0.5);
  assert.equal(likelihoodFromDeduct(14.999), 0.1);
  assert.equal(likelihoodFromDeduct(15), 0.2);
  assert.equal(likelihoodFromDeduct(0), 0.1);
});

test('likelihoodFromUnitPci: exact at all six ASTM condition-class boundaries', () => {
  assert.equal(likelihoodFromUnitPci(85), 0.1);
  assert.equal(likelihoodFromUnitPci(84.999), 0.2);
  assert.equal(likelihoodFromUnitPci(70), 0.2);
  assert.equal(likelihoodFromUnitPci(55), 0.5);
  assert.equal(likelihoodFromUnitPci(40), 1);
  assert.equal(likelihoodFromUnitPci(25), 3);
  assert.equal(likelihoodFromUnitPci(10), 6);
  assert.equal(likelihoodFromUnitPci(9.999), 10);
  assert.equal(likelihoodFromUnitPci(0), 10);
});

test('frequencyFromCoverage: exact at all five coverage boundaries, capped by role', () => {
  assert.equal(frequencyFromCoverage(50, 'runway'), 10);
  assert.equal(frequencyFromCoverage(49.999, 'runway'), 6);
  assert.equal(frequencyFromCoverage(10, 'runway'), 6);
  assert.equal(frequencyFromCoverage(9.999, 'runway'), 3);
  assert.equal(frequencyFromCoverage(2, 'runway'), 3);
  assert.equal(frequencyFromCoverage(1.999, 'runway'), 2);
  assert.equal(frequencyFromCoverage(0.5, 'runway'), 2);
  assert.equal(frequencyFromCoverage(0.499, 'runway'), 1);
  assert.equal(frequencyFromCoverage(0.1, 'runway'), 1);
  assert.equal(frequencyFromCoverage(0.099, 'runway'), 0.5);
  assert.equal(frequencyFromCoverage(0, 'runway'), 0.5);
  // Role ceiling caps a high-coverage unit on a low-exposure facility.
  assert.equal(frequencyFromCoverage(50, 'non_movement'), 0.5);
});

test('dominant-distress tie-break: highest deduct wins; a tie is broken by HAZARD_CLASS_PRECEDENCE, then by earliest record', () => {
  assert.deepEqual(HAZARD_CLASS_PRECEDENCE, ['fod', 'friction', 'structural', 'other']);
  // Tie at deduct 20: ALLIGATOR CR (structural) vs RAVELING (fod) - fod wins by precedence.
  const tie: UnitDistress[] = [
    { type: 'ALLIGATOR CR', severity: 'Medium', quantity: 10, quantityUnits: 'SqM', deduct: 20 },
    { type: 'RAVELING', severity: 'Medium', quantity: 10, quantityUnits: 'SqM', deduct: 20 },
  ];
  const result = scoreUnit(baseInput({ distresses: tie }));
  assert.equal(result.dominantDistress, 'RAVELING');
  assert.equal(result.hazardClass, 'fod');
  assert.ok(result.trace.some((t) => t.includes('tie broken')));

  // Tie at deduct 20, same hazard class (both fod) - earliest record wins.
  const sameClassTie: UnitDistress[] = [
    { type: 'PATCHING', severity: 'Low', quantity: 10, quantityUnits: 'SqM', deduct: 20 },
    { type: 'RAVELING', severity: 'Low', quantity: 10, quantityUnits: 'SqM', deduct: 20 },
  ];
  const result2 = scoreUnit(baseInput({ distresses: sameClassTie }));
  assert.equal(result2.dominantDistress, 'PATCHING');
});

test('astmConsistent: flags a unit whose max single deduct exceeds (100 - PCI) beyond tolerance', () => {
  const consistent: UnitDistress[] = [{ type: 'RAVELING', severity: 'Medium', quantity: 10, quantityUnits: 'SqM', deduct: 20 }];
  assert.equal(astmConsistent(75, consistent), true); // CDV 25 >= deduct 20
  const violating: UnitDistress[] = [{ type: 'BLEEDING', severity: 'High', quantity: 10, quantityUnits: 'SqM', deduct: 60.1 }];
  assert.equal(astmConsistent(97.5, violating), false); // CDV 2.5, deduct 60.1 - unit 215's real numbers
  assert.equal(astmConsistent(100, []), true); // no distress, nothing to violate
});
