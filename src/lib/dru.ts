/**
 * dru.ts
 * -----------------------------------------------------------------------------
 * Anderson's 4-point DRU rating (Degree / Relevancy / Urgency / Extent) for a
 * sample unit. Source: Anderson, CAPTG, "Risk Assessment Approach for
 * Airfield Pavement Rehabilitation", p. 35 of the PDF ("Risk Assessment - DRU
 * Rating System"). The four-letter/number scales themselves (DruDegree,
 * DruRelevancy, DruUrgency, DruExtent) are reproduced from that source and
 * must not be renumbered.
 *
 * DEVIATION FROM metode-b-spec_4.md SECTION 6.2:
 *   The brief writes druFromUnit(input: UnitRiskInput): DruRating - one
 *   argument. But its own Urgency rule reads "digabungkan dari band
 *   Fine-Kinney dan observedRateClass" (combined from the Fine-Kinney band and
 *   the observed-rate class), and neither the Fine-Kinney band nor the rate
 *   class is a field on UnitRiskInput - both are OUTPUTS of scoring a unit,
 *   computed once already in risk-unit.ts's scoreUnit. Recomputing them here
 *   would mean importing scoreUnit from risk-unit.ts, which already imports
 *   druFromUnit from this file - a real runtime circular dependency, not just
 *   a type one. So this signature takes the already-computed band and rate
 *   class as explicit parameters instead of silently re-deriving them.
 * -----------------------------------------------------------------------------
 */

import type { RiskBand, HazardClass } from '../config/riskScales.ts';
import type { ObservedRateClass } from './observed-rate.ts';
import type { UnitDistress, UnitRiskInput } from './risk-unit.ts';
import { SEVERITY_LEVEL } from '../config/riskScales.ts';

/** Degree - condition of the defect. */
export type DruDegree = 'E' | 'V' | 'L' | 'M' | 'H';
// E  no defect, as-new condition
// V  Very Low - normal wear, no maintenance required
// L  Low      - functions as intended, needs light maintenance
// M  Medium   - not functioning as intended, needs more extensive repair
// H  High     - not functioning as intended, needs major repair

/** Relevancy - how much the defect matters for structural integrity and safety. */
export type DruRelevancy = 1 | 2 | 3 | 4;
// 1  minimum relevance - no structural or safety issue
// 2  minor impact on structural integrity or safety
// 3  structural integrity and safety are disturbed
// 4  maximum relevance - severely disturbed, collapse threatened

/** Urgency - deadline for repair. */
export type DruUrgency = 'M' | 'R' | 1 | 2 | 3 | 4;
// M  Monitor
// R  Routine - routine maintenance work
// 1  not needed before the next detailed inspection, 4+ years
// 2  needed within a period, under 3 years
// 3  needed within a period, under 2 years
// 4  immediate repair, ASAP

/** Extent - percent of the element covered by the defect. */
export type DruExtent = number; // 0 to 100

export interface DruRating {
  degree: DruDegree;
  relevancy: DruRelevancy;
  urgency: DruUrgency;
  extentPct: DruExtent;
  trace: string[];
}

/**
 * Below this extent, a Low-severity defect reads as ordinary wear (V) rather
 * than something needing light maintenance (L). Not from Anderson - a
 * modelling decision this implementation adds to make Degree finer than a
 * flat severity lookup. Needs the same defence as the Relevancy/Urgency
 * tables below (metode-b-spec_4.md section 12 item 4).
 *
 * ponytail: single flat percent, not calibrated per distress type. Revisit if
 * the defence needs Degree=V argued at finer resolution.
 */
export const DRU_V_EXTENT_THRESHOLD_PCT = 1;

const HAZARD_CLASS_RELEVANCY: Record<HazardClass, DruRelevancy> = {
  structural: 3,
  fod: 3, // spec text: "fod bernilai 3 pada runway" - see runway-only note below
  friction: 2,
  other: 1,
};

/** Total area (m2) of every non-PATCHING distress recorded in SqM. Distress
 *  recorded in M (linear, e.g. L & T CR) is excluded - it isn't an area
 *  figure to begin with, so it was never part of "total distress area". */
function totalDistressAreaM2(distresses: UnitDistress[]): number {
  return distresses
    .filter((d) => d.type !== 'PATCHING' && d.quantityUnits === 'SqM')
    .reduce((sum, d) => sum + d.quantity, 0);
}

function highestSeverityWeight(distresses: UnitDistress[]): number {
  let max = 0;
  for (const d of distresses) max = Math.max(max, SEVERITY_LEVEL[d.severity]);
  return max;
}

function degreeFor(distresses: UnitDistress[], extentPct: number, trace: string[]): DruDegree {
  if (distresses.length === 0) {
    trace.push('DRU degree E: no distress recorded');
    return 'E';
  }
  const weight = highestSeverityWeight(distresses);
  if (weight >= SEVERITY_LEVEL.High) {
    trace.push('DRU degree H: highest severity on unit is High');
    return 'H';
  }
  if (weight >= SEVERITY_LEVEL.Medium) {
    trace.push('DRU degree M: highest severity on unit is Medium');
    return 'M';
  }
  // weight is Low (2) or N/A (1) - both below Medium.
  if (weight >= SEVERITY_LEVEL.Low && extentPct >= DRU_V_EXTENT_THRESHOLD_PCT) {
    trace.push(`DRU degree L: highest severity Low, extent ${extentPct.toFixed(2)}% >= ${DRU_V_EXTENT_THRESHOLD_PCT}%`);
    return 'L';
  }
  trace.push(`DRU degree V: highest severity below Medium and extent ${extentPct.toFixed(2)}% < ${DRU_V_EXTENT_THRESHOLD_PCT}%`);
  return 'V';
}

function relevancyFor(hazardClass: HazardClass, role: UnitRiskInput['role'], trace: string[]): DruRelevancy {
  if (hazardClass === 'fod' && role !== 'runway') {
    // Spec text only states the runway case ("fod bernilai 3 pada runway").
    // Non-runway fod is not specified; kept one step below structural rather
    // than left undefined. Flagged for the same defence as the rest of this
    // table - see the file header.
    trace.push("Relevancy 2: hazard class 'fod' on a non-runway role (unspecified in brief, provisional)");
    return 2;
  }
  const relevancy = HAZARD_CLASS_RELEVANCY[hazardClass];
  trace.push(`Relevancy ${relevancy}: hazard class '${hazardClass}'${hazardClass === 'fod' ? ' on runway' : ''}`);
  return relevancy;
}

function urgencyFor(fkDegree: RiskBand['degree'], observedRateClass: ObservedRateClass, trace: string[]): DruUrgency {
  if (fkDegree === 5 || observedRateClass === 'memburuk_cepat') {
    trace.push(`Urgency 4: Fine-Kinney degree ${fkDegree} or observed rate '${observedRateClass}'`);
    return 4;
  }
  if (fkDegree === 4) {
    trace.push('Urgency 3: Fine-Kinney degree 4');
    return 3;
  }
  if (fkDegree === 3) {
    trace.push('Urgency 2: Fine-Kinney degree 3');
    return 2;
  }
  if (fkDegree === 2) {
    trace.push('Urgency 1: Fine-Kinney degree 2');
    return 1;
  }
  trace.push('Urgency R: Fine-Kinney degree 1');
  return 'R';
}

/**
 * Builds a unit's DRU rating. `fkDegree` and `observedRateClass` are the
 * already-computed Fine-Kinney band degree and observed-rate class for this
 * same unit (see the file header on why they're parameters, not recomputed).
 * `overrides` lets Relevancy/Urgency be set manually, since both mappings are
 * this implementation's proposal, not a citation (metode-b-spec_4.md section
 * 6.2's closing note) - an override always wins and is recorded in `trace`.
 */
export function druFromUnit(
  input: UnitRiskInput,
  hazardClass: HazardClass,
  fkDegree: RiskBand['degree'],
  observedRateClass: ObservedRateClass,
  overrides?: { relevancy?: DruRelevancy; urgency?: DruUrgency },
): DruRating {
  const trace: string[] = [];
  const extentAreaM2 = totalDistressAreaM2(input.distresses);
  const extentPct = (extentAreaM2 / input.areaM2) * 100;
  trace.push(`Extent ${extentPct.toFixed(2)}%: ${extentAreaM2.toFixed(2)} m2 of ${input.areaM2} m2 (PATCHING and linear distress excluded)`);

  const degree = degreeFor(input.distresses, extentPct, trace);
  let relevancy = relevancyFor(hazardClass, input.role, trace);
  let urgency = urgencyFor(fkDegree, observedRateClass, trace);

  if (overrides?.relevancy !== undefined) {
    trace.push(`Relevancy overridden ${relevancy} -> ${overrides.relevancy}`);
    relevancy = overrides.relevancy;
  }
  if (overrides?.urgency !== undefined) {
    trace.push(`Urgency overridden ${urgency} -> ${overrides.urgency}`);
    urgency = overrides.urgency;
  }

  return { degree, relevancy, urgency, extentPct, trace };
}
