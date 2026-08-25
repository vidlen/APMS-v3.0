/**
 * risk-unit.ts
 * -----------------------------------------------------------------------------
 * Metode B: Fine-Kinney risk scoring at SAMPLE UNIT granularity, derived
 * directly from each unit's own distress records rather than a branch's
 * aggregate PCI. See metode-b-spec_4.md sections 3-4.
 *
 * Deliberately mirrors risk.ts's shape (BranchRiskInput/BranchRiskResult ->
 * UnitRiskInput/UnitRiskResult, scoreBranch -> scoreUnit) but is a fully
 * separate path: risk.ts, risk-adapter.ts, icao.ts, markov-forecast.ts and
 * every existing riskScales.ts constant stay untouched (metode-b-spec_4.md
 * section 0, section 10).
 * -----------------------------------------------------------------------------
 */

import {
  SEVERITY_LEVEL,
  EXTENT_LEVEL_THRESHOLDS,
  EXTENT_LEVEL_FALLBACK,
  DISTRESS_INDEX_TO_LIKELIHOOD,
  ROLE_TO_FREQUENCY,
  CONSEQUENCE_MATRIX,
  SEVERITY_CONSEQUENCE_ESCALATION,
  type BranchRole,
  type HazardClass,
  type RiskBand,
} from '../config/riskScales.ts';
import { canonicalise, hazardClassFor, escalateConsequence, bandFor } from './risk.ts';
import { assessIcao, type IcaoAssessment } from './icao.ts';
import { observedRateClass, type ObservedRateClass } from './observed-rate.ts';
import { druFromUnit, type DruRating, type DruRelevancy, type DruUrgency } from './dru.ts';

export type Zone = 'ujung' | 'tengah';

export interface UnitDistress {
  /** Canonical key from DISTRESS_ALIASES, e.g. 'RAVELING', 'L & T CR'. */
  type: string;
  severity: 'Low' | 'Medium' | 'High' | 'N/A';
  /** Raw PAVER quantity. Units DIFFER between distress types - see quantityUnits. */
  quantity: number;
  /** 'SqM' for area distress, 'M' for a linear distress like L & T CR. */
  quantityUnits: 'SqM' | 'M';
  /** PAVER's own density output. Required - the basis for the extent level. */
  densityPct: number;
}

export interface UnitRiskInput {
  branchId: string; // 'RWY 06-24'
  unitNumber: number; // 1 to 300
  stationKm: number;
  zone: Zone;
  areaM2: number; // 586 to 600
  /** true when areaM2 is the 600 m2 design nominal (no polygon geometry was
   *  available), false when it was computed from the unit's own GeoJSON
   *  polygon. See risk-unit-adapter.ts section 7.2. */
  areaIsNominal?: boolean;
  surveyYear: number; // 2025 or 2026
  role: BranchRole; // 'runway'
  distresses: UnitDistress[];
  pci: number;
  /** true when `pci` came from a survey, false when it's a display filler. See section 0.6. */
  pciIsReal: boolean;
  /** Previous year's PCI for this same unit, used for the observed-rate class. */
  previousPci?: number;
  /** true when `previousPci` came from a survey. */
  previousPciIsReal?: boolean;
  /** true when patched area grew versus the previous year. */
  repairedSincePrevious?: boolean;
  overrides?: { likelihood?: number; frequency?: number; consequence?: number };
  /** Manual override for DRU Relevancy/Urgency - both are this implementation's
   *  proposal, not a citation (dru.ts file header), so a defensible manual
   *  override path is required alongside the computed default. */
  druOverrides?: { relevancy?: DruRelevancy; urgency?: DruUrgency };
}

export interface UnitRiskResult {
  unitNumber: number;
  zone: Zone;
  stationKm: number;
  distressIndex: number;
  likelihood: number;
  frequency: number;
  consequence: number;
  riskScore: number; // R = L x F x C
  band: RiskBand;
  icao: IcaoAssessment;
  hazardClass: HazardClass;
  dominantDistress: string;
  observedRateClass: ObservedRateClass;
  pciIsReal: boolean;
  deltaPci?: number;
  dru: DruRating;
  excludedFromRate: boolean; // true when repairedSincePrevious
  trace: string[];
}

/** Distress-type-specific extent level, 1 to 4, read off PAVER's own density
 *  output. Falls back to EXTENT_LEVEL_FALLBACK for a type with no dedicated
 *  thresholds. */
export function extentLevel(distressType: string, densityPct: number): 1 | 2 | 3 | 4 {
  const [q1, q2, q3] = EXTENT_LEVEL_THRESHOLDS[distressType] ?? EXTENT_LEVEL_FALLBACK;
  if (densityPct >= q3) return 4;
  if (densityPct >= q2) return 3;
  if (densityPct >= q1) return 2;
  return 1;
}

/** wSev x wExt for one distress record, 1 to 16. Callers exclude PATCHING
 *  themselves (see distressIndex) - this function scores whatever it's given. */
export function distressScore(d: UnitDistress): number {
  return SEVERITY_LEVEL[d.severity] * extentLevel(d.type, d.densityPct);
}

interface ScoredDistress {
  type: string;
  score: number;
}

function scoreNonPatching(distresses: UnitDistress[]): ScoredDistress[] {
  return distresses.filter((d) => d.type !== 'PATCHING').map((d) => ({ type: d.type, score: distressScore(d) }));
}

/** Max distressScore across a unit's non-PATCHING distress, 0 to 16. Max, not
 *  sum - see metode-b-spec_4.md section 3.3 (ASTM D5340 takes the maximum
 *  CDV, and summing would reopen the cross-type unit-mixing problem). */
export function distressIndex(distresses: UnitDistress[]): number {
  const scored = scoreNonPatching(distresses);
  return scored.length > 0 ? Math.max(...scored.map((s) => s.score)) : 0;
}

/** Maps a 0..16 distress index onto the seven Fine-Kinney likelihood levels. */
export function likelihoodFromDistressIndex(index: number): number {
  for (const band of DISTRESS_INDEX_TO_LIKELIHOOD) {
    if (index >= band.minIndex) return band.likelihood;
  }
  // Unreachable: DISTRESS_INDEX_TO_LIKELIHOOD's last row has minIndex 0.
  return DISTRESS_INDEX_TO_LIKELIHOOD[DISTRESS_INDEX_TO_LIKELIHOOD.length - 1].likelihood;
}

function highestSeverityWeight(distresses: UnitDistress[]): number {
  let max = 0;
  for (const d of distresses) max = Math.max(max, SEVERITY_LEVEL[d.severity]);
  return max;
}

/** Scores one sample unit end to end: distress -> L, role -> F, dominant
 *  distress's hazard class -> C, R = L x F x C, then the ICAO crosswalk, the
 *  observed-rate class and the DRU rating. */
export function scoreUnit(rawInput: UnitRiskInput): UnitRiskResult {
  const trace: string[] = [];

  // Step 1 (section 4.3): canonicalise every distress type up front, so every
  // downstream lookup (extent thresholds, hazard class, PATCHING exclusion)
  // sees the same canonical key regardless of what the caller passed in.
  const distresses = rawInput.distresses.map((d) => ({ ...d, type: canonicalise(d.type) }));
  const input: UnitRiskInput = { ...rawInput, distresses };

  if (input.areaIsNominal) {
    trace.push(`Area nominal (${input.areaM2} m2): no polygon geometry available for this unit`);
  }

  const scored = scoreNonPatching(distresses);
  const idx = scored.length > 0 ? Math.max(...scored.map((s) => s.score)) : 0;
  trace.push(`Distress index ${idx} from ${scored.length} non-PATCHING distress record(s)`);

  const dominant = scored.reduce<ScoredDistress | undefined>(
    (best, cur) => (!best || cur.score > best.score ? cur : best),
    undefined,
  );
  const dominantDistress = dominant?.type ?? '';

  let likelihood = likelihoodFromDistressIndex(idx);
  trace.push(`L ${likelihood} from distress index ${idx}`);

  const frequency = ROLE_TO_FREQUENCY[input.role];
  trace.push(`F ${frequency} from operational role '${input.role}'`);

  const hazardClass = hazardClassFor(dominantDistress || undefined);
  trace.push(`Dominant distress '${dominantDistress || 'none'}' -> hazard class '${hazardClass}'`);

  let consequence = CONSEQUENCE_MATRIX[input.role][hazardClass];
  trace.push(`C base ${consequence} from role '${input.role}' x hazard class '${hazardClass}'`);

  if (highestSeverityWeight(distresses) >= SEVERITY_LEVEL.High) {
    const steps = SEVERITY_CONSEQUENCE_ESCALATION.BERAT;
    if (steps > 0) {
      const escalated = escalateConsequence(consequence, steps);
      trace.push(`C escalated ${consequence} -> ${escalated}: highest severity on unit is High`);
      consequence = escalated;
    }
  }

  let finalFrequency = frequency;
  if (input.overrides?.likelihood !== undefined) {
    trace.push(`L overridden ${likelihood} -> ${input.overrides.likelihood}`);
    likelihood = input.overrides.likelihood;
  }
  if (input.overrides?.frequency !== undefined) {
    trace.push(`F overridden ${finalFrequency} -> ${input.overrides.frequency}`);
    finalFrequency = input.overrides.frequency;
  }
  if (input.overrides?.consequence !== undefined) {
    trace.push(`C overridden ${consequence} -> ${input.overrides.consequence}`);
    consequence = input.overrides.consequence;
  }

  const riskScore = likelihood * finalFrequency * consequence;
  const band = bandFor(riskScore);
  trace.push(`R ${riskScore} = L${likelihood} x F${finalFrequency} x C${consequence} -> degree ${band.degree}`);

  const icao = assessIcao(likelihood, finalFrequency, consequence);
  trace.push(`ICAO cell ${icao.cell} (${icao.zone})`);

  const rate = observedRateClass(
    input.pci,
    input.previousPci,
    input.repairedSincePrevious ?? false,
    input.pciIsReal,
    input.previousPciIsReal ?? false,
  );
  const deltaPci = input.previousPci !== undefined ? input.previousPci - input.pci : undefined;

  const dru = druFromUnit(input, hazardClass, band.degree, rate, input.druOverrides);

  return {
    unitNumber: input.unitNumber,
    zone: input.zone,
    stationKm: input.stationKm,
    distressIndex: idx,
    likelihood,
    frequency: finalFrequency,
    consequence,
    riskScore,
    band,
    icao,
    hazardClass,
    dominantDistress,
    observedRateClass: rate,
    pciIsReal: input.pciIsReal,
    deltaPci,
    dru,
    excludedFromRate: input.repairedSincePrevious ?? false,
    trace,
  };
}

export function scoreUnits(inputs: UnitRiskInput[]): UnitRiskResult[] {
  return inputs.map(scoreUnit);
}
