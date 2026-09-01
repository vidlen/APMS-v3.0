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
 * REVISED by metode-b-r1-spec.md section 8:
 *   - Urgency is now driven by the ICAO zone (the bounded verdict layer),
 *     never by the Fine-Kinney degree - riskScales.ts states elsewhere that
 *     the degree is "REPORTING ONLY ... must never be rendered as an
 *     instruction to the operator", and Urgency driving repair scheduling is
 *     exactly that instruction.
 *   - Relevancy now has four levels (was two), gated on the dominant
 *     distress's own severity, not just its hazard class.
 *   - Extent is a real axis (druExtentBand/druCell), not a computed-then-
 *     discarded percentage - Anderson p. 36 crosses (Relevancy & Degree) with
 *     Extent to produce the Element Risk Matrix.
 *   - Degree's extent input is now coveragePct (risk-unit.ts section 4.1),
 *     which includes PATCHING and linear distress - the old
 *     totalDistressAreaM2 excluded both.
 *
 * DEVIATION FROM metode-b-spec_4.md SECTION 6.2 (unchanged from the original):
 *   The brief writes druFromUnit(input: UnitRiskInput): DruRating - one
 *   argument. But Urgency needs the already-computed ICAO zone and observed
 *   rate class, and neither is a field on UnitRiskInput - both are OUTPUTS of
 *   scoring a unit, computed once already in risk-unit.ts's scoreUnit.
 *   Recomputing them here would mean importing scoreUnit from risk-unit.ts,
 *   which already imports druFromUnit from this file - a real runtime
 *   circular dependency, not just a type one. So this signature takes them as
 *   explicit parameters instead of silently re-deriving them.
 * -----------------------------------------------------------------------------
 */

import type { HazardClass } from '../config/riskScales.ts';
import type { IcaoZoneName } from '../config/icaoMatrix.ts';
import type { ObservedRateClass } from './observed-rate.ts';
import type { UnitDistress, UnitRiskInput } from './risk-unit.ts';
import { SEVERITY_LEVEL } from '../config/riskScales.ts';

/** Shown next to the DRU table, mirroring ICAO_GRID_PROVENANCE (icaoMatrix.ts). */
export const DRU_PROVENANCE =
  'DRU scale from Anderson (CAPTG) p. 35. The Relevancy and Urgency mappings below are this ' +
  "implementation's research proposal, not content reproduced from that source.";

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
// 3  structural integrity or safety compromised
// 4  maximum relevance - severely compromised, collapse imminent and/or danger to users

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
  /** Smallest DRU_EXTENT_BANDS value >= extentPct - the column Anderson p. 36
   *  actually keys the Element Risk Matrix on. */
  extentBand: number;
  /** "R{relevancy}/D-{degree}/E-{extentBand}" - Anderson's matrix coordinate.
   *  Position marker only; the CRITICAL/WARNING shading on p. 36 is not yet
   *  read from source (section 8.4), so this is never rendered as a verdict. */
  druCell: string;
  trace: string[];
}

/**
 * Below this extent, a Low-severity defect reads as ordinary wear (V) rather
 * than something needing light maintenance (L). Not from Anderson - a
 * modelling decision this implementation adds to make Degree finer than a
 * flat severity lookup. Needs the same defence as the Relevancy/Urgency
 * tables below (metode-b-r1-spec.md section 14 item 4).
 *
 * ponytail: single flat percent, not calibrated per distress type. Revisit if
 * the defence needs Degree=V argued at finer resolution.
 */
export const DRU_V_EXTENT_THRESHOLD_PCT = 1;

/**
 * Extent bands, Anderson p. 36's matrix columns. druExtentBand maps a raw
 * coverage percent onto the smallest band that contains it - coverage 0% and
 * anything under 1% both land in band 1, since that is the matrix's first
 * column; coverage above 100 cannot occur.
 */
export const DRU_EXTENT_BANDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 25, 30, 35, 40, 50, 60, 70, 75, 80, 90, 95, 100];

export function druExtentBand(coverage: number): number {
  for (const band of DRU_EXTENT_BANDS) {
    if (coverage <= band) return band;
  }
  return DRU_EXTENT_BANDS[DRU_EXTENT_BANDS.length - 1];
}

function highestSeverityWeight(distresses: UnitDistress[]): number {
  let max = 0;
  for (const d of distresses) max = Math.max(max, SEVERITY_LEVEL[d.severity]);
  return max;
}

function degreeFor(distresses: UnitDistress[], coverage: number, trace: string[]): DruDegree {
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
  if (weight >= SEVERITY_LEVEL.Low && coverage >= DRU_V_EXTENT_THRESHOLD_PCT) {
    trace.push(`DRU degree L: highest severity Low, coverage ${coverage.toFixed(2)}% >= ${DRU_V_EXTENT_THRESHOLD_PCT}%`);
    return 'L';
  }
  trace.push(`DRU degree V: highest severity below Medium and coverage ${coverage.toFixed(2)}% < ${DRU_V_EXTENT_THRESHOLD_PCT}%`);
  return 'V';
}

/**
 * Relevancy from the dominant distress's hazard class AND its own severity
 * (section 8.2). Anderson p. 35: 2 = "minor impact on structural integrity or
 * safety issue", 3 = "structural integrity or safety compromised", 4 =
 * "severely compromised, collapse imminent and/or danger to users". This
 * mapping is this implementation's research proposal, not a citation.
 */
export function relevancyFor(hazardClass: HazardClass, dominantSeverity: UnitDistress['severity'], trace: string[]): DruRelevancy {
  if (hazardClass === 'other') {
    trace.push("Relevancy 1: hazard class 'other' (or no distress)");
    return 1;
  }
  if (dominantSeverity === 'High') {
    trace.push(`Relevancy 4: hazard class '${hazardClass}', dominant severity High`);
    return 4;
  }
  if (dominantSeverity === 'Medium') {
    trace.push(`Relevancy 3: hazard class '${hazardClass}', dominant severity Medium`);
    return 3;
  }
  trace.push(`Relevancy 2: hazard class '${hazardClass}', dominant severity ${dominantSeverity}`);
  return 2;
}

/**
 * Urgency from the ICAO zone (section 8.3) - never from the Fine-Kinney
 * degree, which riskScales.ts itself states must never drive an operational
 * instruction. On Anderson's own deck (p. 34) Urgency is a column filled in
 * by an inspector per job, not derived from another risk score; deriving it
 * automatically here is a deliberate departure so the model can run over 660
 * units without manual inspection - the manual override path (druOverrides)
 * exists precisely so that departure can be corrected case by case.
 */
export function urgencyFor(zone: IcaoZoneName, rate: ObservedRateClass, hasDistress: boolean, trace: string[]): DruUrgency {
  if (zone === 'Intolerable') {
    trace.push("Urgency 4: ICAO zone 'Intolerable'");
    return 4;
  }
  if (zone === 'Tolerable') {
    const urgency = rate === 'memburuk_cepat' ? 3 : 2;
    trace.push(`Urgency ${urgency}: ICAO zone 'Tolerable', observed rate '${rate}'`);
    return urgency;
  }
  if (hasDistress) {
    trace.push("Urgency 1: ICAO zone 'Acceptable', distress present");
    return 1;
  }
  trace.push("Urgency R: ICAO zone 'Acceptable', no distress");
  return 'R';
}

/**
 * Builds a unit's DRU rating. `hazardClass`/`dominantSeverity` describe the
 * unit's dominant distress; `icaoZone`/`observedRateClass`/`coverage` are the
 * already-computed ICAO zone, observed-rate class and hazard-coverage percent
 * for this same unit (see the file header on why they're parameters, not
 * recomputed). `overrides` lets Relevancy/Urgency be set manually, since both
 * mappings are this implementation's proposal, not a citation - an override
 * always wins and is recorded in `trace`.
 */
export function druFromUnit(
  input: UnitRiskInput,
  hazardClass: HazardClass,
  dominantSeverity: UnitDistress['severity'],
  icaoZone: IcaoZoneName,
  observedRateClass: ObservedRateClass,
  coverage: number,
  overrides?: { relevancy?: DruRelevancy; urgency?: DruUrgency },
): DruRating {
  const trace: string[] = [];

  const degree = degreeFor(input.distresses, coverage, trace);
  let relevancy = relevancyFor(hazardClass, dominantSeverity, trace);
  let urgency = urgencyFor(icaoZone, observedRateClass, input.distresses.length > 0, trace);

  if (overrides?.relevancy !== undefined) {
    trace.push(`Relevancy overridden ${relevancy} -> ${overrides.relevancy}`);
    relevancy = overrides.relevancy;
  }
  if (overrides?.urgency !== undefined) {
    trace.push(`Urgency overridden ${urgency} -> ${overrides.urgency}`);
    urgency = overrides.urgency;
  }

  const extentBand = druExtentBand(coverage);
  const druCell = `R${relevancy}/D-${degree}/E-${extentBand}`;
  trace.push(`Extent band ${extentBand} from coverage ${coverage.toFixed(2)}% -> ${druCell}`);

  return { degree, relevancy, urgency, extentPct: coverage, extentBand, druCell, trace };
}
