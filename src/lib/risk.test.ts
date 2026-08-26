/**
 * risk.test.ts
 * -----------------------------------------------------------------------------
 * Runnable check for the seven shared Fine-Kinney building blocks risk.ts
 * still exports, now that the branch-level scoring pipeline that used to be
 * tested here (scoreBranch, WORKED_EXAMPLES, findDegreeZoneDisagreements, ...)
 * has been removed - see the file header in risk.ts and the pci-cleanup spec
 * section 11.5. risk-unit.test.ts covers the scoring pipeline that replaced it
 * (Metode B).
 *
 * Uses node:test + node:assert/strict - no new dependency. Run with:
 *   npm test
 * -----------------------------------------------------------------------------
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  escalateLikelihood,
  escalateConsequence,
  recencySteps,
  canonicalise,
  hazardClassFor,
  detectabilityFor,
  bandFor,
} from './risk.ts';

test('escalateLikelihood: zero or negative steps returns the value unchanged', () => {
  assert.equal(escalateLikelihood(3, 0), 3);
  assert.equal(escalateLikelihood(3, -1), 3);
});

test('escalateLikelihood: moves up LIKELIHOOD_VALUES by the given step count', () => {
  assert.equal(escalateLikelihood(0.5, 1), 1);
  assert.equal(escalateLikelihood(0.5, 2), 3);
});

test('escalateLikelihood: clamps at the scale ceiling instead of running off the end', () => {
  assert.equal(escalateLikelihood(6, 5), 10);
});

test('escalateLikelihood: a value not on the scale is returned unchanged', () => {
  assert.equal(escalateLikelihood(4.2, 1), 4.2);
});

test('escalateConsequence: moves up CONSEQUENCE_VALUES and clamps at the ceiling', () => {
  assert.equal(escalateConsequence(3, 1), 7);
  assert.equal(escalateConsequence(40, 1), 100);
  assert.equal(escalateConsequence(100, 3), 100);
});

test('recencySteps: matches INSPECTION_RECENCY_ESCALATION\'s thresholds exactly', () => {
  assert.equal(recencySteps(0), 0);
  assert.equal(recencySteps(2), 0);
  assert.equal(recencySteps(3), 1);
  assert.equal(recencySteps(6), 1);
  assert.equal(recencySteps(7), 2);
  assert.equal(recencySteps(10), 2);
});

test('canonicalise: trims and uppercases, then resolves a DISTRESS_ALIASES entry', () => {
  assert.equal(canonicalise('  raveling and weathering (butiran lepas dan pelapukan) '), 'RAVELING');
  assert.equal(canonicalise('alligator cracking'), 'ALLIGATOR CR');
});

test('canonicalise: an unrecognised string passes through uppercased rather than being dropped', () => {
  assert.equal(canonicalise('some new distress'), 'SOME NEW DISTRESS');
});

test('hazardClassFor: undefined distress falls back to \'other\'', () => {
  assert.equal(hazardClassFor(undefined), 'other');
});

test('hazardClassFor: resolves the hazard class for a known distress, canonicalising first', () => {
  assert.equal(hazardClassFor('RAVELING'), 'fod');
  assert.equal(hazardClassFor('alligator cracking'), 'structural');
});

test('detectabilityFor: no override falls back to the hazard-class default', () => {
  assert.equal(detectabilityFor('structural'), 'hidden');
  assert.equal(detectabilityFor('fod'), 'visible');
  assert.equal(detectabilityFor('other'), 'moderate');
});

test('detectabilityFor: an explicit override wins over the hazard-class default', () => {
  assert.equal(detectabilityFor('fod', 'hidden'), 'hidden');
});

test('bandFor: boundary values 20, 70, 200 and 400 land in the band that starts there', () => {
  assert.equal(bandFor(20).degree, 2);
  assert.equal(bandFor(70).degree, 3);
  assert.equal(bandFor(200).degree, 4);
  assert.equal(bandFor(400).degree, 5);
});

test('bandFor: values inside each band resolve to the expected degree', () => {
  assert.equal(bandFor(0).degree, 1);
  assert.equal(bandFor(19.9).degree, 1);
  assert.equal(bandFor(69.9).degree, 2);
  assert.equal(bandFor(199.9).degree, 3);
  assert.equal(bandFor(399.9).degree, 4);
  assert.equal(bandFor(10000).degree, 5);
});
