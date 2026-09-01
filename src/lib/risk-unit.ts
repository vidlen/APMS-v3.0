/**
 * risk-unit.ts
 * -----------------------------------------------------------------------------
 * Metode B: Fine-Kinney risk scoring at SAMPLE UNIT granularity, derived
 * directly from each unit's own ASTM D5340 distress records rather than a
 * branch's aggregate PCI. See metode-b-r1-spec.md, which revises the original
 * metode-b-spec_4.md - Likelihood now comes from ASTM deduct value or unit
 * PCI (section 3), Frequency from hazard coverage (section 4), Consequence
 * escalation is capped at 40 (section 5), and the dominant distress is chosen
 * by deduct with an explicit tie-break (section 6).
 *
 * Deliberately mirrors risk.ts's shape (BranchRiskInput/BranchRiskResult ->
 * UnitRiskInput/UnitRiskResult, scoreBranch -> scoreUnit) but is a fully
 * separate path: risk.ts, icao.ts and every existing riskScales.ts Fine-Kinney
 * base scale stay untouched (metode-b-r1-spec.md section 12).
 * -----------------------------------------------------------------------------
 */

import {
  L_FROM_TOTAL_DEDUCT,
  L_FROM_UNIT_PCI,
  DEFAULT_LIKELIHOOD_SOURCE,
  COVERAGE_DIVISOR_M2,
  F_FROM_COVERAGE,
  LINEAR_INFLUENCE_WIDTH_M,
  ROLE_TO_FREQUENCY,
  CONSEQUENCE_MATRIX,
  NO_DISTRESS_CONSEQUENCE,
  CONSEQUENCE_ESCALATION_CAP,
  LIKELIHOOD_VALUES,
  type BranchRole,
  type HazardClass,
  type RiskBand,
  type LikelihoodSource,
} from '../config/riskScales.ts';
import { canonicalise, hazardClassFor, escalateConsequence, bandFor } from './risk.ts';
import { assessIcao, type IcaoAssessment } from './icao.ts';
import { observedRateClass, type ObservedRateClass } from './observed-rate.ts';
import { druFromUnit, type DruRating, type DruRelevancy, type DruUrgency } from './dru.ts';

export type Zone = 'ujung' | 'tengah';

/** ASTM D5340 condition class, read off a unit's own PCI. Diagnostic only -
 *  see UnitRiskResult.astmConditionClass and .likelihoodClassGap. */
export type AstmConditionClass = 'Good' | 'Satisfactory' | 'Fair' | 'Poor' | 'Very Poor' | 'Serious' | 'Failed';

export interface UnitDistress {
  /** Canonical key from DISTRESS_ALIASES, e.g. 'RAVELING', 'L & T CR'. */
  type: string;
  severity: 'Low' | 'Medium' | 'High' | 'N/A';
  /** Raw PAVER quantity. Units DIFFER between distress types - see quantityUnits. */
  quantity: number;
  /** 'SqM' for area distress, 'M' for a linear distress like L & T CR. */
  quantityUnits: 'SqM' | 'M';
  /** ASTM D5340 deduct value for this record, as exported by PAVER. Basis for
   *  TDV (totalDeductValue) and for Likelihood (section 3). */
  deduct: number;
  /** PAVER's own density output. No longer read by the risk path (superseded
   *  by coveragePct, section 4) - kept optional so old fixtures still compile. */
  densityPct?: number;
}

export interface UnitRiskInput {
  branchId: string; // 'RWY 06-24'
  unitNumber: number; // 1 to 300
  stationKm: number;
  zone: Zone;
  areaM2: number; // 586 to 600
  /** true when areaM2 is the 600 m2 design nominal (no polygon geometry was
   *  available), false when it was computed from the unit's own GeoJSON
   *  polygon. Display/provenance only - not read by the risk path (section 4.1). */
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
  /** The calendar year `previousPci` was surveyed in. Required by the
   *  survey-regime guard (observed-rate.ts, comparableYears) - without it a
   *  rate class cannot tell a comparable year pair from an incomparable one. */
  previousSurveyYear?: number;
  /** true when patched area grew versus the previous year. Always false as of
   *  section 7.4 - patched-area growth does not indicate a repair, so the
   *  rule that read it as one has been switched off rather than left backwards. */
  repairedSincePrevious?: boolean;
  /** ASTM D5340 self-consistency: false when this unit's data violates
   *  CDV >= max(deduct) beyond tolerance (risk-unit-adapter.ts, section 10).
   *  Flagged and shown, never used to drop or reweight the unit. */
  astmConsistent: boolean;
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
  /** Total ASTM deduct value across every distress record, PATCHING included. */
  tdv: number;
  /** % of the unit's own area a hazard covers - see coveragePct (section 4.1). */
  coveragePct: number;
  /** Which variant produced `likelihood` for this result. */
  likelihoodSource: LikelihoodSource;
  likelihood: number;
  /** Variant A, always computed regardless of which source is active. */
  likelihoodTdv: number;
  /** Variant B - null on a unit whose PCI is a display filler (pciIsReal false). */
  likelihoodPci: number | null;
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
  /** This unit's ASTM condition class read off its own PCI - diagnostic only. */
  astmConditionClass: AstmConditionClass;
  /** How many LIKELIHOOD_VALUES steps heavier the active `likelihood` reads
   *  than the class its own PCI would imply. 0 = matches. Always 0 under
   *  variant B by construction (L is read from that same class) - see
   *  metode-b-r1-spec.md section 3.5/3.6. Meaningful under variant A only. */
  likelihoodClassGap: number;
  /** False when this unit's ASTM data is internally inconsistent
   *  (CDV < max single deduct beyond tolerance) - see risk-unit-adapter.ts. */
  astmConsistent: boolean;
  trace: string[];
}

/** Distress dominance tie-break (section 6): highest deduct wins; ties broken
 *  by hazard class precedence, then by earliest record. PATCHING competes on
 *  equal footing - it is no longer excluded from dominance. */
export const HAZARD_CLASS_PRECEDENCE: HazardClass[] = ['fod', 'friction', 'structural', 'other'];

/** Sum of every distress record's ASTM deduct value, PATCHING included -
 *  deduct is already unitless, so summing does not mix quantity units the way
 *  summing raw m2/m would (section 3.1). */
export function totalDeductValue(distresses: UnitDistress[]): number {
  return distresses.reduce((sum, d) => sum + d.deduct, 0);
}

/** Variant A: Likelihood from total deduct value (section 3.2). */
export function likelihoodFromDeduct(tdv: number): number {
  for (const band of L_FROM_TOTAL_DEDUCT) {
    if (tdv >= band.minTdv) return band.likelihood;
  }
  return L_FROM_TOTAL_DEDUCT[L_FROM_TOTAL_DEDUCT.length - 1].likelihood;
}

/** Variant B: Likelihood from the unit's own PCI (section 3.6). Caller is
 *  responsible for the pciIsReal gate - this function just reads the table. */
export function likelihoodFromUnitPci(pci: number): number {
  for (const band of L_FROM_UNIT_PCI) {
    if (pci >= band.minPci) return band.likelihood;
  }
  return L_FROM_UNIT_PCI[L_FROM_UNIT_PCI.length - 1].likelihood;
}

/** This unit's ASTM D5340 condition class, read off its own PCI. Uses the
 *  same boundaries as L_FROM_UNIT_PCI, since both derive from the same
 *  seven ASTM classes (section 3.2). */
function astmConditionClassFor(pci: number): AstmConditionClass {
  if (pci >= 85) return 'Good';
  if (pci >= 70) return 'Satisfactory';
  if (pci >= 55) return 'Fair';
  if (pci >= 40) return 'Poor';
  if (pci >= 25) return 'Very Poor';
  if (pci >= 10) return 'Serious';
  return 'Failed';
}

/** % of a unit's own 600 m2 nominal area a hazard covers (section 4.1). A
 *  linear-quantity record (M, e.g. L & T CR) contributes quantity x
 *  LINEAR_INFLUENCE_WIDTH_M as its "area"; an area record (SqM) contributes
 *  its quantity directly. PATCHING is included. */
export function coveragePct(distresses: UnitDistress[]): number {
  const exposedM2 = distresses.reduce((sum, d) => {
    const area = d.quantityUnits === 'M' ? d.quantity * LINEAR_INFLUENCE_WIDTH_M : d.quantity;
    return sum + area;
  }, 0);
  return (exposedM2 / COVERAGE_DIVISOR_M2) * 100;
}

/** Frequency from hazard coverage, capped at the facility role's own ceiling
 *  (ROLE_TO_FREQUENCY) so a non-runway unit never outranks a runway's
 *  exposure regardless of how distressed its own area is (section 4.1). */
export function frequencyFromCoverage(coverage: number, role: BranchRole): number {
  let fromCoverage = F_FROM_COVERAGE[F_FROM_COVERAGE.length - 1].frequency;
  for (const band of F_FROM_COVERAGE) {
    if (coverage >= band.minCoveragePct) {
      fromCoverage = band.frequency;
      break;
    }
  }
  return Math.min(fromCoverage, ROLE_TO_FREQUENCY[role]);
}

interface DominantCandidate {
  index: number;
  type: string;
  deduct: number;
  severity: UnitDistress['severity'];
  hazardClass: HazardClass;
}

/** Picks the dominant distress by highest deduct; ties broken by
 *  HAZARD_CLASS_PRECEDENCE, then by earliest record (section 6). */
function pickDominant(distresses: UnitDistress[], trace: string[]): DominantCandidate | undefined {
  const candidates: DominantCandidate[] = distresses.map((d, index) => ({
    index,
    type: d.type,
    deduct: d.deduct,
    severity: d.severity,
    hazardClass: hazardClassFor(d.type),
  }));
  if (candidates.length === 0) return undefined;

  let best = candidates[0];
  let tie = false;
  for (const cur of candidates.slice(1)) {
    if (cur.deduct > best.deduct) {
      best = cur;
      tie = false;
      continue;
    }
    if (cur.deduct < best.deduct) continue;

    tie = true;
    const bestRank = HAZARD_CLASS_PRECEDENCE.indexOf(best.hazardClass);
    const curRank = HAZARD_CLASS_PRECEDENCE.indexOf(cur.hazardClass);
    if (curRank < bestRank) {
      best = cur;
    } else if (curRank === bestRank && cur.index < best.index) {
      best = cur;
    }
  }
  if (tie) {
    trace.push(
      `Dominant-distress tie broken by hazard-class precedence, then by earliest record: '${best.type}' (deduct ${best.deduct}, record ${best.index})`,
    );
  }
  return best;
}

/** Scores one sample unit end to end: TDV/coverage -> L/F, dominant
 *  distress's hazard class -> C, R = L x F x C, then the ICAO crosswalk, the
 *  observed-rate class and the DRU rating. `source` picks which Likelihood
 *  variant drives R (section 3.6) - defaults to DEFAULT_LIKELIHOOD_SOURCE.
 *  Everything past Likelihood is identical between variants; see the "11" test
 *  that pins this. */
export function scoreUnit(rawInput: UnitRiskInput, source: LikelihoodSource = DEFAULT_LIKELIHOOD_SOURCE): UnitRiskResult {
  const trace: string[] = [];

  // Canonicalise every distress type up front, so every downstream lookup
  // (hazard class, dominance) sees the same canonical key regardless of what
  // the caller passed in.
  const distresses = rawInput.distresses.map((d) => ({ ...d, type: canonicalise(d.type) }));
  const input: UnitRiskInput = { ...rawInput, distresses };

  if (input.areaIsNominal) {
    trace.push(`Area nominal (${input.areaM2} m2): no polygon geometry available for this unit`);
  }

  const tdv = totalDeductValue(distresses);
  const coverage = coveragePct(distresses);
  trace.push(`TDV ${tdv.toFixed(2)} from ${distresses.length} distress record(s) (PATCHING included)`);
  trace.push(`Coverage ${coverage.toFixed(3)}% of the unit's own area (PATCHING and linear distress included)`);

  if (source === 'pci' && !input.pciIsReal) {
    throw new Error(
      `scoreUnit: source 'pci' requires a real survey PCI - unit ${input.unitNumber} on '${input.branchId}' has a display-filler PCI`,
    );
  }

  const likelihoodTdv = likelihoodFromDeduct(tdv);
  const likelihoodPci = input.pciIsReal ? likelihoodFromUnitPci(input.pci) : null;
  let likelihood = source === 'pci' ? (likelihoodPci as number) : likelihoodTdv;
  trace.push(
    `L ${likelihood} from ${source === 'pci' ? `unit PCI ${input.pci} (variant B)` : `TDV ${tdv.toFixed(2)} (variant A)`}` +
      (likelihoodPci !== null
        ? ` - the other variant would give ${source === 'pci' ? likelihoodTdv : likelihoodPci}`
        : ''),
  );

  const dominant = pickDominant(distresses, trace);
  const dominantDistress = dominant?.type ?? '';
  const dominantSeverity: UnitDistress['severity'] = dominant?.severity ?? 'N/A';

  let frequency = frequencyFromCoverage(coverage, input.role);
  trace.push(`F ${frequency} from coverage ${coverage.toFixed(3)}%, capped at role '${input.role}' ceiling ${ROLE_TO_FREQUENCY[input.role]}`);

  const hazardClass = hazardClassFor(dominantDistress || undefined);
  trace.push(`Dominant distress '${dominantDistress || 'none'}' (deduct ${dominant?.deduct.toFixed(2) ?? '0'}) -> hazard class '${hazardClass}'`);

  let consequence = distresses.length === 0 ? NO_DISTRESS_CONSEQUENCE : CONSEQUENCE_MATRIX[input.role][hazardClass];
  trace.push(`C base ${consequence} from role '${input.role}' x hazard class '${hazardClass}'`);

  const hasNonPatchingHigh = distresses.some((d) => d.type !== 'PATCHING' && d.severity === 'High');
  if (hasNonPatchingHigh) {
    const escalated = Math.min(escalateConsequence(consequence, 1), CONSEQUENCE_ESCALATION_CAP);
    if (escalated !== consequence) {
      trace.push(`C escalated ${consequence} -> ${escalated}: a non-PATCHING distress on this unit is High severity`);
      consequence = escalated;
    }
  }

  if (input.overrides?.likelihood !== undefined) {
    trace.push(`L overridden ${likelihood} -> ${input.overrides.likelihood}`);
    likelihood = input.overrides.likelihood;
  }
  if (input.overrides?.frequency !== undefined) {
    trace.push(`F overridden ${frequency} -> ${input.overrides.frequency}`);
    frequency = input.overrides.frequency;
  }
  if (input.overrides?.consequence !== undefined) {
    trace.push(`C overridden ${consequence} -> ${input.overrides.consequence}`);
    consequence = input.overrides.consequence;
  }

  const riskScore = likelihood * frequency * consequence;
  const band = bandFor(riskScore);
  trace.push(`R ${riskScore} = L${likelihood} x F${frequency} x C${consequence} -> degree ${band.degree}`);

  const icao = assessIcao(likelihood, frequency, consequence);
  trace.push(`ICAO cell ${icao.cell} (${icao.zone})`);

  const rate = observedRateClass(
    input.pci,
    input.previousPci,
    input.repairedSincePrevious ?? false,
    input.pciIsReal,
    input.previousPciIsReal ?? false,
    input.branchId,
    input.surveyYear,
    input.previousSurveyYear,
  );
  const deltaPci = input.previousPci !== undefined ? input.previousPci - input.pci : undefined;

  const dru = druFromUnit(input, hazardClass, dominantSeverity, icao.zone, rate, coverage, input.druOverrides);

  const astmConditionClass = astmConditionClassFor(input.pci);
  const likelihoodClassGap = LIKELIHOOD_VALUES.indexOf(likelihood) - LIKELIHOOD_VALUES.indexOf(likelihoodFromUnitPci(input.pci));

  return {
    unitNumber: input.unitNumber,
    zone: input.zone,
    stationKm: input.stationKm,
    tdv,
    coveragePct: coverage,
    likelihoodSource: source,
    likelihood,
    likelihoodTdv,
    likelihoodPci,
    frequency,
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
    astmConditionClass,
    likelihoodClassGap,
    astmConsistent: input.astmConsistent,
    trace,
  };
}

export function scoreUnits(inputs: UnitRiskInput[], source: LikelihoodSource = DEFAULT_LIKELIHOOD_SOURCE): UnitRiskResult[] {
  return inputs.map((input) => scoreUnit(input, source));
}
