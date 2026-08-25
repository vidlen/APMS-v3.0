/**
 * risk.ts
 * -----------------------------------------------------------------------------
 * Fine-Kinney risk scoring for SHIA airside branches.
 *
 * One pure function does the work: `scoreBranch(input)` takes a branch and
 * returns L, F, C, R, the risk degree, the ICAO verdict and an audit trail.
 * No React, no fetch, no side effects, so it unit-tests cleanly and the
 * thesis can quote the worked examples at the bottom of this file.
 *
 * THREE-TIER LIKELIHOOD
 *   Tier 1  Markov probability of reaching a trigger state within the horizon
 *   Tier 2  PCI forecast from a deterioration curve, at the horizon
 *   Tier 3  Today's surveyed PCI
 *
 * The tiers exist so this module never blocks on a teammate's deliverable.
 * Ship with Tier 3 working, upgrade to Tier 1 when the forecast lands, and
 * report the tier used on screen so a reader knows which evidence produced
 * each score.
 *
 * VERDICT VS ENGINE
 *   `riskScore` (R) and `band` (the Fine-Kinney degree) ORDER the network and
 *   are reported for literature comparison only - see the saturation note
 *   above RISK_BANDS in riskScales.ts. `icao` and `recommendedAction` are the
 *   operational verdict a reader should act on (locked decision 3).
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
  CONSEQUENCE_MATRIX,
  CONSEQUENCE_VALUES,
  DETECTABILITY_ESCALATION,
  DISTRESS_ALIASES,
  DISTRESS_TO_HAZARD_CLASS,
  HAZARD_CLASS_DETECTABILITY,
  INSPECTION_RECENCY_ESCALATION,
  LIKELIHOOD_VALUES,
  MARKOV_PROBABILITY_TO_LIKELIHOOD,
  PCI_TO_LIKELIHOOD,
  RISK_BANDS,
  ROLE_TO_FREQUENCY,
  SEVERITY_CONSEQUENCE_ESCALATION,
  type Detectability,
  type DistressSeverityLevel,
  type DistressSource,
  type HazardClass,
  type RiskBand,
  type BranchRole,
} from '../config/riskScales.ts';
import { assessIcao, type IcaoAssessment } from './icao.ts';

/* =============================================================================
 * TYPES
 * ========================================================================== */

export type LikelihoodTier = 'markov' | 'curve' | 'pci';

export interface BranchRiskInput {
  branchId: string;
  branchName: string;
  role: BranchRole;

  /** Most recent surveyed PCI. Required: this is the Tier 3 floor. */
  currentPci: number;

  /** Calendar year of the most recent PCI survey for this branch. */
  lastInspectionYear: number;

  /**
   * Dominant recorded distress. Either a canonical PAVER/ASTM key (for
   * example 'RAVELING', 'ALLIGATOR CR') or one of the repair log's bilingual
   * source strings - hazardClassFor consults DISTRESS_ALIASES first, so
   * either form resolves. Drives the hazard class.
   */
  dominantDistress?: string;

  /**
   * Where dominantDistress came from (section 8, riskScales.ts): an admin
   * override, the PCI sample units, the repair log, the reviewed two-row
   * table, or none. Purely informational - it does not affect the score,
   * only the trace and the register's provenance marker. Callers that don't
   * track provenance (the worked examples, most existing callers) can leave
   * it unset; it is not treated as 'none' for scoring purposes because
   * nothing here reads it except to report it.
   */
  distressSource?: DistressSource;

  /**
   * Explicit detectability override (locked decision 6). When set, this ALSO
   * escalates L by DETECTABILITY_ESCALATION[value] - see the section note
   * above HAZARD_CLASS_DETECTABILITY in riskScales.ts for why that escalation
   * is opt-in rather than an automatic hazard-class default. When unset, the
   * branch still gets a displayed detectability label (BranchRiskResult.
   * detectability), inferred from hazard class, but it has no score effect.
   */
  detectability?: Detectability;

  /**
   * Explicit distress-severity override (Phase 8, gated - see section 8.1,
   * riskScales.ts). When set to 'BERAT', this ALSO escalates C by
   * SEVERITY_CONSEQUENCE_ESCALATION.BERAT (currently +1 CONSEQUENCE_SCALE
   * step); RINGAN/SEDANG apply the label but escalate nothing. Unlike
   * detectability, there is no inferred default when unset - see the section
   * note in riskScales.ts for why a branch's prevailing severity can't be
   * mechanically derived the way hazard class can.
   */
  distressSeverity?: DistressSeverityLevel;

  /** TIER 1. P(branch reaches trigger state within the planning horizon). */
  markovTriggerProbability?: number;

  /** TIER 2. Forecast PCI at the planning horizon from a deterioration curve. */
  forecastPci?: number;

  /** Manual expert overrides. Any field set here wins over the computed value. */
  overrides?: {
    likelihood?: number;
    frequency?: number;
    consequence?: number;
    note?: string;
    setBy?: string;
    setOn?: string;
  };
}

export interface BranchRiskResult {
  branchId: string;
  branchName: string;
  likelihood: number;
  frequency: number;
  consequence: number;
  riskScore: number;
  /** Fine-Kinney band. Comparison column only - see the note at the top of this file. */
  band: RiskBand;
  /** ICAO Doc 9859 cell and zone. This is the operational verdict. */
  icao: IcaoAssessment;
  /** Convenience alias for icao.zoneAction, so a caller need not reach into `icao`. */
  recommendedAction: string;
  hazardClass: HazardClass;
  /** The distress that produced hazardClass, canonicalised. Undefined when no
   *  distress was supplied. */
  dominantDistress?: string;
  /**
   * Where dominantDistress came from - a straight pass-through of
   * BranchRiskInput.distressSource, never inferred here. risk-adapter.ts is
   * the only caller that knows the precedence chain, so it is the only place
   * that should claim 'none' (no evidence from any source). A caller that
   * supplies dominantDistress directly without a source - WORKED_EXAMPLES
   * below, most of risk.test.ts - leaves this undefined rather than have
   * scoreBranch guess 'none' and contradict its own hazardClass.
   */
  distressSource?: DistressSource;
  /** Displayed label - always populated (inferred from hazardClass, or the explicit override). */
  detectability: Detectability;
  /** True only when `detectability` came from an explicit override on the input. */
  detectabilityApplied: boolean;
  /** Set only when the input carried an explicit distressSeverity (Phase 8).
   *  Undefined, not a label, since - unlike detectability - there is no
   *  inferred default to fall back to when unset. */
  distressSeverity?: DistressSeverityLevel;
  /** Steps added to consequence from an explicit distressSeverity override. Zero unless one was set. */
  consequenceEscalationSteps: number;
  likelihoodTier: LikelihoodTier;
  /** Steps added to likelihood because the survey is stale. Zero when current. */
  recencyEscalationSteps: number;
  /** Steps added to likelihood from an explicit detectability override. Zero unless one was set. */
  detectabilityEscalationSteps: number;
  overridden: boolean;
  /** Human-readable trace of how each factor was chosen. */
  trace: string[];
}

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

export function likelihoodFromMarkov(probability: number): number {
  const clamped = Math.min(Math.max(probability, 0), 1);
  for (const band of MARKOV_PROBABILITY_TO_LIKELIHOOD) {
    if (clamped <= band.maxProbability) return band.likelihood;
  }
  return 10;
}

export function likelihoodFromPci(pci: number): number {
  for (const band of PCI_TO_LIKELIHOOD) {
    if (pci >= band.minPci) return band.likelihood;
  }
  return 10;
}

export function recencySteps(yearsSinceInspection: number): number {
  for (const rule of INSPECTION_RECENCY_ESCALATION) {
    if (yearsSinceInspection >= rule.minYearsSinceInspection) return rule.steps;
  }
  return 0;
}

/** Trace-only label for distressSource, section 8 riskScales.ts. 'none' never
 *  reaches this - the trace omits the parenthetical entirely when unset. */
const DISTRESS_SOURCE_LABELS: Record<Exclude<DistressSource, 'none'>, string> = {
  admin: 'admin override',
  units: 'PCI sample units',
  log: 'repair log',
  inventory: 'reviewed inventory',
};

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

/* =============================================================================
 * MAIN SCORING FUNCTION
 * ========================================================================== */

export function scoreBranch(
  input: BranchRiskInput,
  currentYear: number = new Date().getFullYear(),
): BranchRiskResult {
  const trace: string[] = [];
  const overrides = input.overrides ?? {};

  // Computed early: the Consequence section below needs it for C, and the
  // Likelihood section needs it for the detectability escalation, since
  // detectability is inferred from hazard class (see riskScales.ts).
  const hazardClass = hazardClassFor(input.dominantDistress);

  // ---- Likelihood ---------------------------------------------------------
  let tier: LikelihoodTier;
  let baseLikelihood: number;

  if (typeof input.markovTriggerProbability === 'number') {
    tier = 'markov';
    baseLikelihood = likelihoodFromMarkov(input.markovTriggerProbability);
    trace.push(
      `L base ${baseLikelihood} from Markov P(trigger) = ` +
        `${(input.markovTriggerProbability * 100).toFixed(1)}%`,
    );
  } else if (typeof input.forecastPci === 'number') {
    tier = 'curve';
    baseLikelihood = likelihoodFromPci(input.forecastPci);
    trace.push(`L base ${baseLikelihood} from forecast PCI ${input.forecastPci.toFixed(1)}`);
  } else {
    tier = 'pci';
    baseLikelihood = likelihoodFromPci(input.currentPci);
    trace.push(`L base ${baseLikelihood} from current PCI ${input.currentPci.toFixed(1)}`);
  }

  const yearsStale = Math.max(0, currentYear - input.lastInspectionYear);
  const steps = recencySteps(yearsStale);
  let likelihood = escalateLikelihood(baseLikelihood, steps);
  if (steps > 0) {
    trace.push(
      `L raised to ${likelihood}: last survey ${input.lastInspectionYear}, ` +
        `${yearsStale} years stale (+${steps} step${steps > 1 ? 's' : ''})`,
    );
  }

  // Detectability (locked decision 6): a label is always computed, but it
  // only escalates L when explicitly set on the input - see the section
  // note above HAZARD_CLASS_DETECTABILITY in riskScales.ts for why an
  // automatic hazard-class default isn't applied here.
  const detectability = detectabilityFor(hazardClass, input.detectability);
  const detectabilityApplied = input.detectability !== undefined;
  const detectabilitySteps = detectabilityApplied ? DETECTABILITY_ESCALATION[detectability] : 0;
  if (detectabilitySteps > 0) {
    likelihood = escalateLikelihood(likelihood, detectabilitySteps);
    trace.push(
      `L raised to ${likelihood}: detectability set to '${detectability}' ` +
        `(+${detectabilitySteps} step${detectabilitySteps > 1 ? 's' : ''}, explicit override)`,
    );
  } else if (detectabilityApplied) {
    trace.push(`Detectability set to '${detectability}': no escalation at this level`);
  } else {
    trace.push(`Detectability '${detectability}' (inferred from hazard class, not applied to score)`);
  }

  // ---- Frequency ----------------------------------------------------------
  let frequency = ROLE_TO_FREQUENCY[input.role];
  trace.push(`F ${frequency} from operational role '${input.role}'`);

  // ---- Consequence --------------------------------------------------------
  let consequence = CONSEQUENCE_MATRIX[input.role][hazardClass];
  const distressLabel = input.dominantDistress ? canonicalise(input.dominantDistress) : undefined;
  const sourceLabel = input.distressSource && input.distressSource !== 'none'
    ? DISTRESS_SOURCE_LABELS[input.distressSource]
    : undefined;
  trace.push(
    `C ${consequence} from role '${input.role}' x hazard class '${hazardClass}'` +
      (distressLabel ? ` (${distressLabel}${sourceLabel ? `, ${sourceLabel}` : ''})` : ''),
  );

  // Distress severity (Phase 8, gated): opt-in only, no inferred default -
  // see the section note above SEVERITY_CONSEQUENCE_ESCALATION in
  // riskScales.ts for why. Runs before the expert-override block below, so
  // an explicit overrides.consequence still wins outright over this.
  const consequenceEscalationSteps = input.distressSeverity
    ? SEVERITY_CONSEQUENCE_ESCALATION[input.distressSeverity]
    : 0;
  if (consequenceEscalationSteps > 0) {
    consequence = escalateConsequence(consequence, consequenceEscalationSteps);
    trace.push(
      `C raised to ${consequence}: distress severity set to '${input.distressSeverity}' ` +
        `(+${consequenceEscalationSteps} step${consequenceEscalationSteps > 1 ? 's' : ''}, explicit override)`,
    );
  } else if (input.distressSeverity) {
    trace.push(`Distress severity set to '${input.distressSeverity}': no escalation at this level`);
  }

  // ---- Expert overrides ---------------------------------------------------
  let overridden = false;
  if (typeof overrides.likelihood === 'number') {
    trace.push(`L overridden ${likelihood} -> ${overrides.likelihood}`);
    likelihood = overrides.likelihood;
    overridden = true;
  }
  if (typeof overrides.frequency === 'number') {
    trace.push(`F overridden ${frequency} -> ${overrides.frequency}`);
    frequency = overrides.frequency;
    overridden = true;
  }
  if (typeof overrides.consequence === 'number') {
    trace.push(`C overridden ${consequence} -> ${overrides.consequence}`);
    consequence = overrides.consequence;
    overridden = true;
  }
  if (overridden && overrides.note) {
    trace.push(`Override note: ${overrides.note}`);
  }

  // ---- Score (Fine-Kinney - ordering and literature comparison only) ------
  const riskScore = likelihood * frequency * consequence;
  const band = bandFor(riskScore);
  trace.push(
    `R = ${likelihood} x ${frequency} x ${consequence} = ${riskScore.toFixed(1)} ` +
      `-> Fine-Kinney degree ${band.degree} (${band.situation}), comparison only`,
  );

  // ---- ICAO crosswalk (the operational verdict) ----------------------------
  // Computed from the post-override L/F/C, so an expert override moves the
  // ICAO cell too, not just R.
  const icao = assessIcao(likelihood, frequency, consequence);
  trace.push(
    `ICAO L x F = ${(likelihood * frequency).toFixed(1)} -> probability ${icao.probability} ` +
      `(${icao.probabilityLabel}); C ${consequence} -> severity ${icao.severity} ` +
      `(${icao.severityLabel}); cell ${icao.cell} -> ${icao.zone}`,
  );

  return {
    branchId: input.branchId,
    branchName: input.branchName,
    likelihood,
    frequency,
    consequence,
    riskScore,
    band,
    icao,
    recommendedAction: icao.zoneAction,
    hazardClass,
    dominantDistress: distressLabel,
    distressSource: input.distressSource,
    detectability,
    detectabilityApplied,
    distressSeverity: input.distressSeverity,
    consequenceEscalationSteps,
    likelihoodTier: tier,
    recencyEscalationSteps: steps,
    detectabilityEscalationSteps: detectabilitySteps,
    overridden,
    trace,
  };
}

/* =============================================================================
 * NETWORK HELPERS
 * ========================================================================== */

/** Scores every branch and returns them ordered by descending risk. */
export function scoreNetwork(
  branches: BranchRiskInput[],
  currentYear?: number,
): BranchRiskResult[] {
  return branches
    .map((b) => scoreBranch(b, currentYear))
    .sort((a, b) => b.riskScore - a.riskScore);
}

/** Counts branches in each risk degree. Feeds the summary cards on the tab. */
export function riskProfile(results: BranchRiskResult[]): Record<number, number> {
  const profile: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const r of results) profile[r.band.degree] += 1;
  return profile;
}

/**
 * The second results-chapter comparison (backlog J): where Fine-Kinney's
 * degree and the ICAO zone disagree about which branches are the most
 * concerning ones.
 *
 * "Disagree" is defined narrowly and symmetrically: FK degree >= 4 ("high
 * risk" by Kinney's own bands) does not match zone === 'Intolerable'. This
 * is exactly the saturation defect's shape (see the note above RISK_BANDS
 * in riskScales.ts) - a degree-4/5 branch that ICAO does NOT flag as
 * Intolerable is precisely the case that made Kinney's degree label
 * misleading on its own; the XOR also catches the (mechanically possible,
 * if rarer) reverse case where ICAO flags Intolerable on a branch whose
 * FK degree stayed low. Branches where both methods agree - including
 * every branch that is genuinely both high-degree AND Intolerable - are
 * correctly excluded; agreement isn't news.
 */
export function findDegreeZoneDisagreements(results: BranchRiskResult[]): BranchRiskResult[] {
  return results.filter((r) => r.band.degree >= 4 !== (r.icao.zone === 'Intolerable'));
}

/**
 * Compares the PCI-threshold ordering already used in the Rehabilitation Plan
 * tab against the risk ordering, and reports how far each branch moved.
 * The output of this function is the results chapter.
 */
export function comparePriorityOrders(
  branches: BranchRiskInput[],
  currentYear?: number,
): Array<{
  branchId: string;
  branchName: string;
  pciRank: number;
  riskRank: number;
  movement: number;
  currentPci: number;
  riskScore: number;
  riskDegree: number;
}> {
  const byPci = [...branches].sort((a, b) => a.currentPci - b.currentPci);
  const pciRank = new Map(byPci.map((b, i) => [b.branchId, i + 1]));

  const scored = scoreNetwork(branches, currentYear);

  return scored.map((r, i) => {
    const riskRank = i + 1;
    const pRank = pciRank.get(r.branchId) ?? riskRank;
    const source = branches.find((b) => b.branchId === r.branchId)!;
    return {
      branchId: r.branchId,
      branchName: r.branchName,
      pciRank: pRank,
      riskRank,
      movement: pRank - riskRank, // positive means risk promoted the branch
      currentPci: source.currentPci,
      riskScore: r.riskScore,
      riskDegree: r.band.degree,
    };
  });
}

/* =============================================================================
 * WORKED EXAMPLES
 *
 * Put these three in the thesis as manual verification of the code. Each one
 * can be checked with a calculator against the tables in riskScales.ts.
 * ========================================================================== */

export const WORKED_EXAMPLES: BranchRiskInput[] = [
  {
    // Runway touchdown zone, moderate PCI, raveling. Condition looks acceptable
    // and the risk is high, which is the whole point of the module.
    branchId: 'RW-0624-C',
    branchName: 'Runway 06/24 - zone C (2200-3000 m)',
    role: 'runway',
    currentPci: 87.8,
    lastInspectionYear: 2025,
    dominantDistress: 'RAVELING',
    // L 0.2 (PCI 87.8) x F 10 (runway) x C 40 (runway FOD) = 80 -> degree 3
  },
  {
    // Remote apron in worse condition. PCI ranking puts it first, risk does not.
    branchId: 'AP-REMOTE-04',
    branchName: 'Remote apron 04',
    role: 'remote_apron',
    currentPci: 55.0,
    lastInspectionYear: 2025,
    dominantDistress: 'ALLIGATOR CR',
    // L 6 (PCI 55) x F 2 (remote apron) x C 3 = 36 -> degree 2
  },
  {
    // Stale survey on a busy taxiway. Recency escalation does the work.
    branchId: 'TW-NP-12',
    branchName: 'Parallel taxiway NP-12',
    role: 'parallel_taxiway',
    currentPci: 82.0,
    lastInspectionYear: 2019,
    dominantDistress: 'RAVELING',
    // Evaluated at currentYear 2025: 6 years stale, so +1 step.
    // L 0.5 (PCI 82) raised 1 step to 1
    // x F 6 (parallel taxiway) x C 15 (taxiway FOD) = 90 -> degree 3
    //
    // Note for the thesis: a branch at PCI 82 outranks the runway zone at
    // PCI 87.8 here only because its survey is stale. Re-survey it and the
    // escalation clears, L returns to 0.5, and R falls to 45 (degree 2).
  },
];
