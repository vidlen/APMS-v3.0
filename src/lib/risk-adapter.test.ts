/**
 * risk-adapter.test.ts
 * -----------------------------------------------------------------------------
 * Pins roleFromSectionName's boundary cases against SHIA's real branch codes
 * (from public/data/pavement-data.json) - the heuristic is a plain lookup
 * table's worth of regex, but it is the one piece of non-obvious branching
 * logic in risk-adapter.ts, so it gets a check. Also pins inferredRoleFor /
 * inferredDominantDistressFor against the reviewed inventory (KNOWN_ROLES /
 * KNOWN_DOMINANT_DISTRESS) layered on top of that heuristic, including its
 * one deliberate exception (S8) that a smarter regex would have missed.
 * -----------------------------------------------------------------------------
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  roleFromSectionName,
  inferredRoleFor,
  inferredDominantDistressFor,
  resolveDominantDistress,
  tallyUnitsByDeduct,
  toBranchRiskInputs,
} from './risk-adapter.ts';
import { scoreBranch } from './risk.ts';
import { aggregateRepairLog, validateRepairLog } from './repair-log.ts';
import type { SectionData } from './pci-utils.ts';
import type { GeoJSONFeatureCollection } from './geojson-types.ts';
import type { DistressTally } from './dominant-distress.ts';

test('roleFromSectionName classifies every branch code shape', () => {
  // Runways: two-digit heading, optional L/C/R suffix.
  assert.equal(roleFromSectionName('06/24'), 'runway');
  assert.equal(roleFromSectionName('07L/25R'), 'runway');
  assert.equal(roleFromSectionName('07R/25L'), 'runway');

  // Full-length parallel taxiways: NP/SP followed by a digit.
  assert.equal(roleFromSectionName('NP1'), 'parallel_taxiway');
  assert.equal(roleFromSectionName('SP2'), 'parallel_taxiway');

  // NPE/NPW/SPE/SPW are short connectors, not the ~3.7km parallel taxiways -
  // NP/SP followed by a letter must NOT match the parallel pattern.
  assert.equal(roleFromSectionName('NPE'), 'secondary_taxiway');
  assert.equal(roleFromSectionName('SPW'), 'secondary_taxiway');

  // Aprons and remote aprons.
  assert.equal(roleFromSectionName('Apron A'), 'active_apron');
  assert.equal(roleFromSectionName('Remote Apron B'), 'remote_apron');

  // Ordinary connector/exit taxiways fall back to secondary_taxiway.
  assert.equal(roleFromSectionName('N3'), 'secondary_taxiway');
  assert.equal(roleFromSectionName('SC4'), 'secondary_taxiway');
});

test('inferredRoleFor prefers the reviewed inventory over the naming heuristic for a real branch', () => {
  // N3 is a bare N-code the heuristic alone would default to
  // secondary_taxiway, but the reviewed inventory (Risk Inventory_Admin.xlsx)
  // classifies it as a high-speed exit taxiway.
  assert.equal(inferredRoleFor('N3'), 'high_speed_exit');
  assert.equal(roleFromSectionName('N3'), 'secondary_taxiway', 'the raw heuristic is unchanged');
});

test('inferredRoleFor keeps the inventory\'s deliberate exception, not the pattern it looks like', () => {
  // S8 is the one bare S-code the inventory does NOT classify as a
  // high-speed exit, unlike every other S1-S9/M1-M8/N1-N9 code - proof this
  // is a reviewed assignment, not a smarter regex over the same codes.
  assert.equal(inferredRoleFor('S8'), 'secondary_taxiway');
});

test('inferredRoleFor falls back to the heuristic for a branch the inventory does not cover', () => {
  assert.equal(inferredRoleFor('ZZ9'), 'secondary_taxiway');
});

test('inferredDominantDistressFor returns the reviewed distress for the 2 of 75 branches that have one', () => {
  assert.equal(inferredDominantDistressFor('06/24'), 'RAVELING');
  assert.equal(inferredDominantDistressFor('07L/25R'), 'L & T CR');
  assert.equal(inferredDominantDistressFor('N3'), undefined, 'no distress recorded for this branch');
});

test('toBranchRiskInputs picks up the reviewed role and distress for a real branch with no admin override', () => {
  const runway: SectionData = { Section: '06/24', 'PCI Rating': '70', PCN: '111/R/D/W/T', Type: 'Asphalt' };
  const [input] = toBranchRiskInputs([runway], '2025');
  assert.equal(input.role, 'runway');
  assert.equal(input.dominantDistress, 'RAVELING');
});

// A synthetic code, deliberately not one of the 75 real branches in
// KNOWN_ROLES (risk-adapter.ts) - these tests exercise the no-known-role,
// no-override fallback path, which a real (now-inventoried) code would no
// longer hit.
const SECTION: SectionData = {
  Section: 'ZZ9',
  'PCI Rating': '82',
  PCN: '111/R/D/W/T',
  Type: 'Asphalt',
};

test('toBranchRiskInputs falls back to the heuristic and the survey year when no override is set', () => {
  const [input] = toBranchRiskInputs([SECTION], '2024');
  assert.equal(input.role, 'secondary_taxiway', 'heuristic default for an unlisted code');
  assert.equal(input.lastInspectionYear, 2024, 'survey year, no admin override');
  assert.equal(input.dominantDistress, undefined);
});

test('toBranchRiskInputs prefers an admin-entered override over the heuristic default', () => {
  const [input] = toBranchRiskInputs([SECTION], '2024', {
    ZZ9: { role: 'runway', lastInspectionYear: 2019, dominantDistress: 'RAVELING', detectability: 'hidden' },
  });
  assert.equal(input.role, 'runway', 'explicit override wins over roleFromSectionName');
  assert.equal(input.lastInspectionYear, 2019, 'explicit override wins over the survey year');
  assert.equal(input.dominantDistress, 'RAVELING');
  assert.equal(input.detectability, 'hidden', 'detectability override reaches the risk engine input');
});

test('toBranchRiskInputs applies a partial override field-by-field, not all-or-nothing', () => {
  const [input] = toBranchRiskInputs([SECTION], '2024', {
    ZZ9: { dominantDistress: 'ALLIGATOR CR' },
  });
  assert.equal(input.role, 'secondary_taxiway', 'role still falls back to the heuristic');
  assert.equal(input.lastInspectionYear, 2024, 'lastInspectionYear still falls back to the survey year');
  assert.equal(input.dominantDistress, 'ALLIGATOR CR', 'only the overridden field changes');
});

test('toBranchRiskInputs threads lfcOverride through as BranchRiskInput.overrides (backlog L)', () => {
  const [input] = toBranchRiskInputs([SECTION], '2024', {
    ZZ9: { lfcOverride: { likelihood: 10, note: 'Expert panel', setBy: 'J. Doe', setOn: '2026-01-15' } },
  });
  assert.deepEqual(input.overrides, {
    likelihood: 10,
    note: 'Expert panel',
    setBy: 'J. Doe',
    setOn: '2026-01-15',
  });
});

test('toBranchRiskInputs leaves overrides undefined when no lfcOverride is set', () => {
  const [input] = toBranchRiskInputs([SECTION], '2024', { ZZ9: { role: 'runway' } });
  assert.equal(input.overrides, undefined);
});

test('toBranchRiskInputs sets markovTriggerProbability for a branch Teammate A\'s forecast covers (backlog M)', () => {
  const [input] = toBranchRiskInputs([SECTION], '2024', {}, {
    ZZ9: { branchId: 'ZZ9', horizonYears: 5, triggerPci: 80, markovTriggerProbability: 0.34 },
  });
  assert.equal(input.markovTriggerProbability, 0.34);
});

test('toBranchRiskInputs leaves markovTriggerProbability undefined for a branch the forecast does not cover', () => {
  const [input] = toBranchRiskInputs([SECTION], '2024', {}, {
    'some-other-branch': { branchId: 'some-other-branch', horizonYears: 5, triggerPci: 80, markovTriggerProbability: 0.34 },
  });
  assert.equal(input.markovTriggerProbability, undefined, 'falls back to Tier 2/3, exactly as before this branch had a forecast');
});

/* =============================================================================
 * DOMINANT-DISTRESS PRECEDENCE (v2.8 brief section 5)
 *
 * Tests 10-13: admin > units > log > inventory > none, first hit wins. Each
 * tier is tested in isolation with resolveDominantDistress, then threaded
 * through toBranchRiskInputs -> scoreBranch to confirm distressSource and
 * dominantDistress actually reach BranchRiskResult, not just the adapter's
 * own return value.
 * ========================================================================== */

function unitsFcOf(distresses: Array<{ type: string; deduct: number }>): GeoJSONFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: distresses.map((d, i) => ({
      type: 'Feature',
      id: i,
      properties: {
        square_id: i,
        sampleUnit: i,
        sampleUnitSet: 'test',
        pci_score: 80,
        pci_rating: 'Satisfactory',
        distresses: [{ type: d.type, severity: 'Medium', quantity: 1, quantityUnits: 'SqM', deduct: d.deduct }],
      },
      geometry: { type: 'Point', coordinates: [0, 0] },
    })),
  };
}

function logTalliesOf(tallies: DistressTally[]): Record<string, DistressTally[]> {
  return { 'TEST-BRANCH': tallies };
}

test('10. a branch covered by both sample units and the log resolves via units, not the log', () => {
  const units = { 'TEST-BRANCH': unitsFcOf([{ type: 'Raveling', deduct: 5 }]) };
  const log = logTalliesOf([{ distress: 'PATCHING', count: 50, area: 10, severityArea: 20, deduct: 0 }]);

  const result = resolveDominantDistress('TEST-BRANCH', undefined, units, log);
  assert.deepEqual(result, { distress: 'RAVELING', source: 'units' });
});

test('11. a branch only in the log resolves via log, ranked by DOMINANT_DISTRESS_METRIC', () => {
  const log = logTalliesOf([
    { distress: 'PATCHING', count: 9, area: 4, severityArea: 8, deduct: 0 },
    { distress: 'POTHOLE', count: 1, area: 1, severityArea: 30, deduct: 0 },
  ]);

  const result = resolveDominantDistress('TEST-BRANCH', undefined, {}, log);
  // DOMINANT_DISTRESS_METRIC is severity_area, so POTHOLE (30) beats PATCHING (8)
  // despite fewer records - this is exactly why the metric is a stated decision.
  assert.deepEqual(result, { distress: 'POTHOLE', source: 'log' });
});

test('12. a branch in neither falls to the reviewed inventory, then to none', () => {
  const covered = resolveDominantDistress('06/24', undefined, {}, {});
  assert.deepEqual(covered, { distress: 'RAVELING', source: 'inventory' });

  const uncovered = resolveDominantDistress('N9', undefined, {}, {});
  assert.deepEqual(uncovered, { distress: undefined, source: 'none' });

  const [input] = toBranchRiskInputs(
    [{ Section: 'N9', 'PCI Rating': '70', PCN: '111/R/D/W/T', Type: 'Asphalt' }],
    '2025',
  );
  const result = scoreBranch(input);
  assert.equal(result.hazardClass, 'other');
  assert.equal(result.distressSource, 'none');
  assert.equal(result.dominantDistress, undefined);
});

test('13. an admin override outranks every other source, including sample units', () => {
  const units = { 'TEST-BRANCH': unitsFcOf([{ type: 'Raveling', deduct: 999 }]) };
  const result = resolveDominantDistress(
    'TEST-BRANCH',
    { dominantDistress: 'ALLIGATOR CR' },
    units,
    {},
  );
  assert.deepEqual(result, { distress: 'ALLIGATOR CR', source: 'admin' });
});

test('an empty units FeatureCollection (no sample units yet) falls through to the log', () => {
  const units = { 'TEST-BRANCH': unitsFcOf([]) };
  const log = logTalliesOf([{ distress: 'PATCHING', count: 1, area: 1, severityArea: 1, deduct: 0 }]);
  const result = resolveDominantDistress('TEST-BRANCH', undefined, units, log);
  assert.deepEqual(result, { distress: 'PATCHING', source: 'log' });
});

test('resolveDominantDistress result flows through toBranchRiskInputs and into the scored result', () => {
  const log = logTalliesOf([{ distress: 'BLOCK CR', count: 1, area: 1, severityArea: 1, deduct: 0 }]);
  const [input] = toBranchRiskInputs(
    [{ Section: 'TEST-BRANCH', 'PCI Rating': '70', PCN: '111/R/D/W/T', Type: 'Asphalt' }],
    '2025',
    {},
    {},
    {},
    log,
  );
  assert.equal(input.dominantDistress, 'BLOCK CR');
  assert.equal(input.distressSource, 'log');

  const result = scoreBranch(input);
  assert.equal(result.dominantDistress, 'BLOCK CR');
  assert.equal(result.distressSource, 'log');
  assert.equal(result.hazardClass, 'structural');
  assert.match(
    result.trace.find((line) => line.startsWith('C ')) ?? '',
    /repair log/,
  );
});

/* =============================================================================
 * tallyUnitsByDeduct
 * ========================================================================== */

test('tallyUnitsByDeduct sums deduct per canonical distress across every sample unit', () => {
  const fc = unitsFcOf([
    { type: 'Raveling', deduct: 3 },
    { type: 'Raveling', deduct: 4 },
    { type: 'Alligator Cracking', deduct: 10 },
  ]);
  const tallies = tallyUnitsByDeduct(fc);
  const byName = Object.fromEntries(tallies.map((t) => [t.distress, t.deduct]));
  assert.deepEqual(byName, { RAVELING: 7, 'ALLIGATOR CR': 10 });
});

test('tallyUnitsByDeduct returns no tallies for a sample unit with no distresses', () => {
  const fc: GeoJSONFeatureCollection = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { square_id: 1, sampleUnit: 1, sampleUnitSet: 'test', pci_score: 100, pci_rating: 'Excellent' },
        geometry: { type: 'Point', coordinates: [0, 0] },
      },
    ],
  };
  assert.deepEqual(tallyUnitsByDeduct(fc), []);
});

/* =============================================================================
 * THE COMMITTED DATA - 06/24 and 07L/25R, the two branches with real sample
 * units AND real log coverage, so units precedence is not hypothetical.
 * ========================================================================== */

function loadUnitsFc(relativePath: string): GeoJSONFeatureCollection {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf-8'),
  );
}

function loadCommittedLogByBranch(): Record<string, DistressTally[]> {
  const log = JSON.parse(
    readFileSync(fileURLToPath(new URL('../../public/data/repair-log-2025.json', import.meta.url)), 'utf-8'),
  );
  const network = new Set<string>(
    JSON.parse(
      readFileSync(fileURLToPath(new URL('../../public/data/pavement-data.json', import.meta.url)), 'utf-8'),
    ).features.map((f: { properties: { Section: string } }) => f.properties.Section),
  );
  const parsed = validateRepairLog(log);
  assert.ok(parsed.ok);
  return aggregateRepairLog(parsed.data, network).byBranch;
}

test('06/24 resolves via units to RAVELING - matches the old reviewed-inventory value', () => {
  const units = { '06/24': loadUnitsFc('../../public/data/runway-06-24-units-2025.json') };
  const result = resolveDominantDistress('06/24', undefined, units, loadCommittedLogByBranch());
  assert.deepEqual(result, { distress: 'RAVELING', source: 'units' });
});

test('07L/25R resolves via units to ALLIGATOR CR - NOT the old reviewed-inventory value of L & T CR', () => {
  // The reviewed table (KNOWN_DOMINANT_DISTRESS) hand-typed 'L & T CR' for
  // this branch. Aggregating the same sample-unit file by total deduct - the
  // metric a PCI survey actually produces - gives ALLIGATOR CR a deduct of
  // 3605 against L & T CR's 1434. Units outranking the reviewed table means
  // v2.8 surfaces the number the survey itself supports, not the hand-typed
  // guess. Both distresses map to hazard class 'structural', so this changes
  // the displayed distress but not the score.
  const units = { '07L/25R': loadUnitsFc('../../public/data/runway-07L-25R-units-2025.json') };
  const result = resolveDominantDistress('07L/25R', undefined, units, loadCommittedLogByBranch());
  assert.deepEqual(result, { distress: 'ALLIGATOR CR', source: 'units' });

  const oldInventoryValue = inferredDominantDistressFor('07L/25R');
  assert.equal(oldInventoryValue, 'L & T CR');
  assert.notEqual(result.distress, oldInventoryValue, 'units precedence overrides the hand-typed table');
});

test('07L/25R: units and log disagree, but both land on hazard class structural, so R is unaffected', () => {
  // The brief calls this out explicitly (section 5): "flag the conflicts" -
  // sample units and the log name different distresses for this branch. This
  // pins that the disagreement is real but the CONSEQUENCE it produces is not,
  // which is what makes it safe to surface as a UI flag (Phase 5) rather than
  // something that needs resolving before the register can be trusted.
  const byBranch = loadCommittedLogByBranch();
  const logWinnerHazard = scoreBranch({
    branchId: '07L/25R', branchName: '07L/25R', role: 'runway',
    currentPci: 84, lastInspectionYear: 2025,
    dominantDistress: byBranch['07L/25R'].sort((a, b) => b.severityArea - a.severityArea)[0].distress,
  }).hazardClass;

  const units = { '07L/25R': loadUnitsFc('../../public/data/runway-07L-25R-units-2025.json') };
  const unitsResult = resolveDominantDistress('07L/25R', undefined, units, byBranch);
  const unitsWinnerHazard = scoreBranch({
    branchId: '07L/25R', branchName: '07L/25R', role: 'runway',
    currentPci: 84, lastInspectionYear: 2025,
    dominantDistress: unitsResult.distress,
  }).hazardClass;

  assert.equal(logWinnerHazard, 'fod', "log's own top pick (PATCHING) is fod");
  assert.equal(unitsWinnerHazard, 'structural', "units' top pick (ALLIGATOR CR) is structural");
  assert.notEqual(logWinnerHazard, unitsWinnerHazard, 'a real, flaggable disagreement');
});
