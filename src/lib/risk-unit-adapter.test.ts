/**
 * risk-unit-adapter.test.ts
 * -----------------------------------------------------------------------------
 * Pins the adapter's data-authenticity and derived-field logic against the
 * real 06/24 sample-unit files - section 0.6's pciIsReal split, plus the
 * repaired-unit count, corrected 2026-08-28 after fixing a sample-unit
 * numbering mismatch between the 2025 and 2026 06/24 survey files (the 2026
 * squares had been walked/labelled in the opposite direction along the
 * runway; metode-b-spec_4.md section 7.3's "65 of 300 units" was computed
 * against that pre-fix data and is stale).
 * -----------------------------------------------------------------------------
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isPciReal, polygonAreaM2, toUnitRiskInputs } from './risk-unit-adapter.ts';
import type { GeoJSONFeatureCollection } from './geojson-types.ts';

function loadFc(relativePath: string): GeoJSONFeatureCollection {
  return JSON.parse(readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf-8'));
}

test('pciIsReal is true only for 06/24 and 07L/25R', () => {
  assert.equal(isPciReal('06/24'), true);
  assert.equal(isPciReal('07L/25R'), true);
  assert.equal(isPciReal('NP2'), false);
  assert.equal(isPciReal('Apron A'), false);
});

test('polygonAreaM2 on a real 06/24 unit polygon lands in the surveyed 586-604 m2 range', () => {
  const fc = loadFc('../../public/data/runway-06-24-units-2025.json');
  const ring = fc.features[0].geometry.coordinates as unknown as number[][][];
  const area = polygonAreaM2(ring[0]);
  assert.ok(area > 585 && area < 605, `expected ~586-604 m2, got ${area}`);
});

test('repairedSincePrevious is always false (section 7.4: the patched-area-growth rule is switched off)', () => {
  const fc2026 = loadFc('../../public/data/runway-06-24-units-2026.json');
  const fc2025 = loadFc('../../public/data/runway-06-24-units-2025.json');
  const inputs = toUnitRiskInputs('06/24', 'runway', 2026, fc2026, fc2025, 2025);
  const repaired = inputs.filter((i) => i.repairedSincePrevious).length;
  assert.equal(repaired, 0);
});

test('every unit from the real-PCI branch is flagged pciIsReal, and carries a defined previousPci and previousSurveyYear', () => {
  const fc2026 = loadFc('../../public/data/runway-06-24-units-2026.json');
  const fc2025 = loadFc('../../public/data/runway-06-24-units-2025.json');
  const inputs = toUnitRiskInputs('06/24', 'runway', 2026, fc2026, fc2025, 2025);
  assert.equal(inputs.length, 300);
  for (const i of inputs) {
    assert.equal(i.pciIsReal, true);
    assert.equal(i.previousPciIsReal, true);
    assert.equal(typeof i.previousPci, 'number');
    assert.equal(i.previousSurveyYear, 2025);
  }
});

test('astmConsistent flags exactly one unit across the whole network: 06/24 2025 unit 215', () => {
  const fc2025 = loadFc('../../public/data/runway-06-24-units-2025.json');
  const fc2024 = loadFc('../../public/data/runway-06-24-units-2024.json');
  const fc2026 = loadFc('../../public/data/runway-06-24-units-2026.json');
  const fcRwy2_2026 = loadFc('../../public/data/runway-07L-25R-units-2026.json');

  const inputs2025 = toUnitRiskInputs('06/24', 'runway', 2025, fc2025, fc2024, 2024);
  const inputs2026 = toUnitRiskInputs('06/24', 'runway', 2026, fc2026, fc2025, 2025);
  const inputsRwy2 = toUnitRiskInputs('07L/25R', 'runway', 2026, fcRwy2_2026);

  const flagged = [...inputs2025, ...inputs2026, ...inputsRwy2].filter((i) => !i.astmConsistent);
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].branchId, '06/24');
  assert.equal(flagged[0].unitNumber, 215);
});

test('an unrecognised quantityUnits value throws rather than silently converting', () => {
  const fc: GeoJSONFeatureCollection = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {
          square_id: 1,
          sampleUnit: 1,
          sampleUnitSet: 'test',
          pci_score: 90,
          pci_rating: 'Good',
          distresses: [{ type: 'Raveling', severity: 'Low', quantity: 1, quantityUnits: 'FT', deduct: 1 }],
        },
        geometry: { type: 'Polygon', coordinates: [] },
      },
    ],
  };
  assert.throws(() => toUnitRiskInputs('06/24', 'runway', 2026, fc));
});

test('a feature with no usable polygon geometry falls back to the 600 m2 nominal area', () => {
  const fc: GeoJSONFeatureCollection = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { square_id: 1, sampleUnit: 1, sampleUnitSet: 'test', pci_score: 90, pci_rating: 'Good' },
        geometry: { type: 'Polygon', coordinates: [] },
      },
    ],
  };
  const [input] = toUnitRiskInputs('06/24', 'runway', 2026, fc);
  assert.equal(input.areaM2, 600);
  assert.equal(input.areaIsNominal, true);
});
