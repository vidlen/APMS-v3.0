/**
 * riskScales.test.ts
 * -----------------------------------------------------------------------------
 * Locks the Fine-Kinney base scales and risk-band boundaries verbatim against
 * their source (see the file header in riskScales.ts) - see pci-cleanup-spec.md
 * section 12.2. These values must never shift silently; a change here means
 * the source citation itself changed, not a refactor.
 * -----------------------------------------------------------------------------
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIKELIHOOD_VALUES, FREQUENCY_SCALE, CONSEQUENCE_VALUES, RISK_BANDS } from './riskScales.ts';

test('LIKELIHOOD_VALUES matches Seven & Yardim (2024) Table 5', () => {
  assert.deepEqual(LIKELIHOOD_VALUES, [0.1, 0.2, 0.5, 1, 3, 6, 10]);
});

test('FREQUENCY_SCALE matches Seven & Yardim (2024) Table 5', () => {
  assert.deepEqual(
    FREQUENCY_SCALE.map((s) => s.value),
    [0.5, 1, 2, 3, 6, 10],
  );
});

test('CONSEQUENCE_VALUES matches Seven & Yardim (2024) Table 5', () => {
  assert.deepEqual(CONSEQUENCE_VALUES, [1, 3, 7, 15, 40, 100]);
});

test('RISK_BANDS boundaries are exact at 20, 70, 200 and 400', () => {
  assert.deepEqual(
    RISK_BANDS.map((b) => [b.min, b.max]),
    [
      [0, 20],
      [20, 70],
      [70, 200],
      [200, 400],
      [400, Number.POSITIVE_INFINITY],
    ],
  );
});
