/**
 * risk.ts
 * -----------------------------------------------------------------------------
 * Shared Fine-Kinney building blocks used by risk-unit.ts (Metode B, the only
 * scoring path left in the app - see the pci-cleanup spec section 11.5).
 *
 * This file used to also hold the branch-level scoring pipeline
 * (scoreBranch/scoreNetwork, BranchRiskInput/BranchRiskResult, the
 * PCI/Markov-derived likelihood tiers, and the network-comparison helpers).
 * That pipeline's only consumers - the Branch Register tab and its Admin
 * Risk Inventory counterpart - were removed because the app's PCI data for
 * 73 of 75 branches wasn't a real survey result (see the pci-cleanup spec,
 * section 0.1), leaving Metode B (RWY 06/24 and 07L/25R only) as the one
 * validated risk-scoring path. What's left here are the seven functions
 * risk-unit.ts actually reuses rather than reimplementing.
 *
 * NOTE ON IMPORT EXTENSIONS
 *   Relative imports below use an explicit `.ts` extension, which is not this
 *   repo's usual convention. It is required so `node --test` can resolve this
 *   module directly (risk.test.ts runs under Node, not Vite); Vite and tsc
 *   both resolve it fine because `allowImportingTsExtensions` is enabled.
 *   Don't "clean up" the extensions away - that breaks `npm test`.
 * -----------------------------------------------------------------------------
 */

import {
  CONSEQUENCE_VALUES,
  DISTRESS_ALIASES,
  DISTRESS_TO_HAZARD_CLASS,
  HAZARD_CLASS_DETECTABILITY,
  INSPECTION_RECENCY_ESCALATION,
  LIKELIHOOD_VALUES,
  RISK_BANDS,
  type Detectability,
  type HazardClass,
  type RiskBand,
} from '../config/riskScales.ts';

/* =============================================================================
 * FACTOR RESOLUTION
 * ========================================================================== */

/** Moves a likelihood value up the Fine-Kinney scale by `steps` positions. */
export function escalateLikelihood(likelihood: number, steps: number): number {
  if (steps <= 0) return likelihood;
  const index = LIKELIHOOD_VALUES.indexOf(likelihood);
  if (index === -1) return likelihood;
  const target = Math.min(index + steps, LIKELIHOOD_VALUES.length - 1);
  return LIKELIHOOD_VALUES[target];
}

/** Moves a consequence value up the Fine-Kinney scale by `steps` positions.
 *  Same shape as escalateLikelihood, for the same reason (Phase 8). */
export function escalateConsequence(consequence: number, steps: number): number {
  if (steps <= 0) return consequence;
  const index = CONSEQUENCE_VALUES.indexOf(consequence);
  if (index === -1) return consequence;
  const target = Math.min(index + steps, CONSEQUENCE_VALUES.length - 1);
  return CONSEQUENCE_VALUES[target];
}

export function recencySteps(yearsSinceInspection: number): number {
  for (const rule of INSPECTION_RECENCY_ESCALATION) {
    if (yearsSinceInspection >= rule.minYearsSinceInspection) return rule.steps;
  }
  return 0;
}

/** Trim + uppercase, then DISTRESS_ALIASES, matching canonicalDistress in
 *  dominant-distress.ts. Duplicated rather than imported so risk.ts keeps its
 *  narrow riskScales.ts-only dependency surface - both read the same table.
 *  Exported for risk-unit.ts (Metode B), which canonicalises the same way
 *  and must not fork the logic into a third copy. */
export function canonicalise(distress: string): string {
  const key = distress.trim().toUpperCase();
  return DISTRESS_ALIASES[key] ?? key;
}

export function hazardClassFor(distress?: string): HazardClass {
  if (!distress) return 'other';
  return DISTRESS_TO_HAZARD_CLASS[canonicalise(distress)] ?? 'other';
}

/** The displayed detectability label: an explicit override, or the hazard-class default. */
export function detectabilityFor(hazardClass: HazardClass, override?: Detectability): Detectability {
  return override ?? HAZARD_CLASS_DETECTABILITY[hazardClass];
}

export function bandFor(riskScore: number): RiskBand {
  for (const band of RISK_BANDS) {
    if (riskScore >= band.min && riskScore < band.max) return band;
  }
  return RISK_BANDS[RISK_BANDS.length - 1];
}
