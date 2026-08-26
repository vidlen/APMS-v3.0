/**
 * riskScales.ts
 * -----------------------------------------------------------------------------
 * Fine-Kinney calibration for the SHIA Airport Pavement Management System.
 *
 * Every number in this file is a MODELLING DECISION, not a computed result.
 * This is the file an examiner should be able to read end to end and challenge.
 * Keep it flat, keep it commented, and cite the source of each scale.
 *
 * PRIMARY SOURCES
 *  [1] Kinney, G.F. & Wiruth, A.D. (1976). Practical Risk Analysis for Safety
 *      Management. Naval Weapons Center, China Lake, CA.
 *  [2] Seven, E. & Yardim, M.S. (2024). An Integrated Risk Management Model for
 *      Performance Assessment of Airport Pavements: The Case of Istanbul
 *      Airport. Applied Sciences 14(24), 12034. (APIRM model)
 *  [3] ICAO Annex 14, Vol. I - Aerodrome Design and Operations (SMS requirement)
 *  [4] ASTM D5340 - Standard Test Method for Airport Pavement Condition Index
 *  [5] Pasindu, H.R. (2011). Incorporating Risk Considerations in Airport
 *      Runway Pavement Maintenance Management. PhD thesis, National University
 *      of Singapore. (Failure-mode framing for hazard classes; the argument
 *      that distress SEVERITY, not mere presence, sets the effect on aircraft
 *      operations.)
 *  [6] Alberti, S. & Fiori, F. (2019). Integrating Risk Assessment into
 *      Pavement Management Systems. J. Infrastructure Systems 25(1),
 *      05019001. (Road PMS, not airport - cited for two comparisons only,
 *      neither of which changes a value in this file: Table 8's PCI-banded
 *      consequence levels versus this file's PCI-banded likelihood, and
 *      Table 12's PCI-triggered treatment ladder versus rehab.ts's
 *      REHAB_METHODOLOGY. See the Risk tab's methodology panel.)
 *
 * DEVIATION FROM [2] (state this in your methodology chapter):
 *   Seven & Yardim obtain Likelihood from a survey of six Istanbul Airport
 *   experts and take the modal response. This implementation derives Likelihood
 *   from the Markov condition forecast instead, so the score recomputes when a
 *   new survey year is loaded. Frequency and Consequence remain rule-based,
 *   because both depend on operational role rather than pavement condition.
 * -----------------------------------------------------------------------------
 */

/* =============================================================================
 * 1. FINE-KINNEY BASE SCALES  (source [1], reproduced in [2] Tables 5-6)
 * ========================================================================== */

/** Likelihood of the hazardous event occurring. Seven discrete levels. */
export const LIKELIHOOD_SCALE = [
  { value: 0.1, label: 'Virtually impossible' },
  { value: 0.2, label: 'Practically impossible' },
  { value: 0.5, label: 'Conceivable but very unlikely' },
  { value: 1, label: 'Only remotely possible' },
  { value: 3, label: 'Unusual but possible' },
  { value: 6, label: 'Quite possible' },
  { value: 10, label: 'Might well be expected' },
] as const;

/** Exposure frequency: how often personnel or aircraft meet the hazard. */
export const FREQUENCY_SCALE = [
  { value: 0.5, label: 'Very rare (once a year)' },
  { value: 1, label: 'Rare (a few times per year)' },
  { value: 2, label: 'Unusual (monthly)' },
  { value: 3, label: 'Occasional (weekly)' },
  { value: 6, label: 'Frequent (daily)' },
  { value: 10, label: 'Continuous (hourly)' },
] as const;

/** Worst credible consequence. USD figures are from [1]/[2], unadjusted. */
export const CONSEQUENCE_SCALE = [
  { value: 1, label: 'Noticeable (minor first aid, or > USD 100)' },
  { value: 3, label: 'Important (disability, or > USD 1,000)' },
  { value: 7, label: 'Serious (serious injury, or > USD 10,000)' },
  { value: 15, label: 'Very serious (fatality, or > USD 100,000)' },
  { value: 40, label: 'Disaster (few fatalities, or > USD 1,000,000)' },
  { value: 100, label: 'Catastrophe (many fatalities, or > USD 10,000,000)' },
] as const;

/**
 * The seven likelihood levels as a plain number array, used by
 * `escalateLikelihood` to step a value up the scale.
 *
 * The `: number[]` annotation is load-bearing. Without it, `as const` above
 * makes this a union of literal types (0.1 | 0.2 | ... | 10), and TypeScript
 * then rejects `LIKELIHOOD_VALUES.indexOf(someNumber)` because a plain `number`
 * is not assignable to that union.
 */
export const LIKELIHOOD_VALUES: number[] = LIKELIHOOD_SCALE.map((s) => s.value);

/**
 * The six consequence levels as a plain number array, used by
 * `escalateConsequence` (risk.ts, Phase 8) to step a value up the scale the
 * same way `escalateLikelihood` already steps L. Same `: number[]`
 * annotation, same reason - see the note on LIKELIHOOD_VALUES above.
 */
export const CONSEQUENCE_VALUES: number[] = CONSEQUENCE_SCALE.map((s) => s.value);

/* =============================================================================
 * 2. RISK BANDS  (source [2] Table 6)
 *
 * The published table uses open inequalities (R < 20, 20 < R < 70, ...) and so
 * leaves the boundary values 20, 70, 200 and 400 undefined. Resolved here with
 * inclusive lower bounds. Document this resolution in your thesis.
 *
 * ---------------------------------------------------------------------------
 * THESE DEGREES ARE A COMPARISON COLUMN, NOT THE OPERATIONAL VERDICT.
 *
 * R = L x F x C is unbounded, so on a high-consequence high-exposure asset it
 * saturates: a runway (F 10, C 40) in ASTM "Satisfactory" condition at PCI 79
 * scores 1 x 10 x 40 = 400 and reaches degree 5, whose published label reads
 * "consider discontinuing operation". The ranking is still correct; the label
 * is not, and a dashboard that recommends closing a live runway at PCI 79
 * discredits every other screen.
 *
 * The fix is not to re-tune these bands. `R` keeps its job of ORDERING the 75
 * branches. Tolerability is decided by the bounded ICAO Doc 9859 5x5 matrix in
 * `icaoMatrix.ts`, which cannot saturate because it is a 25-cell grid with no
 * arithmetic in it. `kinneyAction` below is reproduced from [1]/[2] for the
 * literature comparison in the results chapter and must never be rendered as
 * an instruction to the operator.
 * ========================================================================== */

export interface RiskBand {
  degree: 1 | 2 | 3 | 4 | 5;
  min: number;
  max: number;
  situation: string;
  /**
   * Kinney's published action for this degree. REPORTING ONLY - see the note
   * above. The operational recommendation comes from the ICAO zone, exposed as
   * `recommendedAction` on a BranchRiskResult.
   */
  kinneyAction: string;
  /** Tailwind-friendly hex for the map ramp and the register table. */
  color: string;
}

export const RISK_BANDS: RiskBand[] = [
  {
    degree: 1,
    min: 0,
    max: 20,
    situation: 'Acceptable risk',
    kinneyAction: 'Routine monitoring at the normal inspection interval',
    color: '#16a34a',
  },
  {
    degree: 2,
    min: 20,
    max: 70,
    situation: 'Possible risk: attention indicated',
    kinneyAction: 'Include in the next programmed maintenance cycle',
    color: '#84cc16',
  },
  {
    degree: 3,
    min: 70,
    max: 200,
    situation: 'Substantial risk: correction needed',
    kinneyAction: 'Monitor closely and schedule corrective works',
    color: '#facc15',
  },
  {
    degree: 4,
    min: 200,
    max: 400,
    situation: 'High risk: immediate correction required',
    kinneyAction: 'Short-term action plan; bring forward in the M&R programme',
    color: '#f97316',
  },
  {
    degree: 5,
    min: 400,
    max: Number.POSITIVE_INFINITY,
    situation: 'Very high risk: consider discontinuing operation',
    kinneyAction: 'Immediate action; consider operational restriction on the branch',
    color: '#dc2626',
  },
];

/* =============================================================================
 * 3. LIKELIHOOD MAPPINGS
 * ========================================================================== */

/**
 * Data-quality escalation. A branch last inspected years ago carries more
 * uncertainty than one surveyed this year, so its likelihood is raised.
 * This is the clause that absorbs the 06/24 data-quality problem into the
 * model instead of leaving it as a caveat.
 *
 * Each entry raises L by `steps` positions on LIKELIHOOD_SCALE.
 */
export const INSPECTION_RECENCY_ESCALATION = [
  { minYearsSinceInspection: 7, steps: 2 },
  { minYearsSinceInspection: 3, steps: 1 },
  { minYearsSinceInspection: 0, steps: 0 },
] as const;

/* =============================================================================
 * 4. FREQUENCY BY OPERATIONAL ROLE
 *
 * Frequency is exposure, so it comes from how often aircraft use the branch,
 * never from its condition. Assign role once per branch in the inventory.
 * If SHIA movement counts per branch are available, replace this table with
 * measured daily movements and band them against FREQUENCY_SCALE.
 * ========================================================================== */

export type BranchRole =
  | 'runway'
  | 'high_speed_exit'
  | 'parallel_taxiway'
  | 'secondary_taxiway'
  | 'active_apron'
  | 'remote_apron'
  | 'non_movement';

export const ROLE_TO_FREQUENCY: Record<BranchRole, number> = {
  runway: 10, //            continuous, every movement
  high_speed_exit: 6, //    daily, every landing rollout
  parallel_taxiway: 6, //   daily
  secondary_taxiway: 3, //  weekly
  active_apron: 6, //       daily, stands in regular use
  remote_apron: 2, //       monthly, overflow and parking
  non_movement: 0.5, //     yearly, shoulders and service areas
};

export const ROLE_LABELS: Record<BranchRole, string> = {
  runway: 'Runway',
  high_speed_exit: 'High-speed exit taxiway',
  parallel_taxiway: 'Parallel taxiway',
  secondary_taxiway: 'Secondary taxiway',
  active_apron: 'Active apron / stand',
  remote_apron: 'Remote or overflow apron',
  non_movement: 'Non-movement area',
};

/* =============================================================================
 * 5. CONSEQUENCE BY ROLE AND HAZARD CLASS
 *
 * Hazard class groups ASTM D5340 distresses by the accident they can cause,
 * because consequence depends on the failure mode and not on the distress name.
 * This grouping - by airport safety pathway rather than by pavement-engineering
 * distress family - follows Pasindu [5]'s framework for runway pavement risk:
 * §3.1 identifies the mechanisms below as the ones that actually reach aircraft
 * operations, and §6.3 develops the case for rutting/depression-type distortion
 * specifically (see the friction group note).
 *
 *   fod        - loose material entering an engine or striking an airframe.
 *                Surface-layer loss and cavities: raveling, weathering,
 *                patching, spalling, jet blast erosion, joint seal damage,
 *                pothole, asphalt stripping.
 *   friction   - loss of braking or directional control, excursion risk.
 *                Pasindu §3.1/§6.3: rutting, depression and other surface
 *                distortion pond water on the pavement, which is what drives
 *                hydroplaning and increased braking distance - the mechanism
 *                his finite-element model (§3.2) quantifies for rut depth
 *                specifically. Bleeding and corrugation/shoving/swell sit in
 *                the same class on the same mechanism: a smoothed or deformed
 *                surface loses the microtexture that skid resistance depends
 *                on. APMS has no rut depth, texture depth or cross-slope data,
 *                so only the classification transfers, not Pasindu's computed
 *                hydroplaning speeds or braking distances - see the
 *                methodology panel in RiskTab for that limit stated in full.
 *   structural - load-carrying failure under an aircraft. Cracking that
 *                indicates the layer beneath is failing, not just the surface:
 *                alligator, longitudinal & transverse, block, slippage, joint
 *                reflection, corner cracking.
 *   other      - appearance and durability, no direct safety pathway.
 *
 * Align these values with the airport's own SMS severity table before the
 * defence [3]. A consequence scale borrowed from the operator's live SMS is far
 * easier to defend than one written by the author.
 * ========================================================================== */

export type HazardClass = 'fod' | 'friction' | 'structural' | 'other';

export const DISTRESS_TO_HAZARD_CLASS: Record<string, HazardClass> = {
  RAVELING: 'fod',
  WEATHERING: 'fod',
  PATCHING: 'fod',
  'JET BLAST EROSION': 'fod',
  'JOINT SEAL DAMAGE': 'fod',
  SPALLING: 'fod',
  // Added for the repair log (section 8). POTHOLE is the second most frequent
  // distress recorded across the North Runway (188 of 678 records) and had no
  // entry, so every pothole scored as hazard class 'other'.
  //
  // POTHOLE has both a FOD pathway and a structural cause, so the choice is a
  // real one: a cavity implies a failing layer underneath, but it also throws
  // loose material an aircraft tyre can strike and ingest. Classified 'fod'
  // following Seven & Yardim [2], who treat pavement-related FOD as
  // safety-critical. On a runway this is also the more conservative reading -
  // CONSEQUENCE_MATRIX gives runway/fod 40 against runway/structural 15.
  POTHOLE: 'fod',
  // Surface layer loss, so debris. 18 records.
  'ASPHALT STRIPPING': 'fod',
  // Pasindu [5] §3.1/§6.3: these pond water on the pavement surface, and
  // ponded water is what drives hydroplaning and increased braking distance.
  // Rutting is the distress his finite-element model computes hydroplaning
  // speed and braking distance for directly (§6.3.1-6.3.4); depression is the
  // same mechanism on a broader footprint; corrugation/shoving/swell are
  // longitudinal-profile distortion with the same drainage consequence.
  POLISHED_AGGREGATE: 'friction',
  RUTTING: 'friction',
  DEPRESSION: 'friction',
  CORRUGATION: 'friction',
  SHOVING: 'friction',
  SWELL: 'friction',
  // Bleeding smooths the surface rather than deforming it, but the safety
  // pathway is the same one Pasindu's framework targets - lost microtexture,
  // lost skid resistance under wet conditions.
  BLEEDING: 'friction',
  // Cracking that indicates the layer BENEATH the surface is failing, not
  // just the surface itself - a load-carrying rather than a drainage or
  // debris pathway. The distinction from the fod/friction groups above is
  // exactly Pasindu [5]'s point in §3.1: consequence follows failure mode,
  // not distress family.
  'ALLIGATOR CR': 'structural',
  'L & T CR': 'structural',
  'BLOCK CR': 'structural',
  'SLIPPAGE CR': 'structural',
  'JT REFLECTION CR': 'structural',
  // Concrete column, Jenis Kerusakan (Beton). A corner break is a slab
  // load-transfer failure, so structural rather than the FOD reading SPALLING
  // gets above.
  'CORNER CR': 'structural',
  'OIL SPILLAGE': 'other',
};

export const CONSEQUENCE_MATRIX: Record<BranchRole, Record<HazardClass, number>> = {
  //                    fod  friction  structural  other
  runway: { fod: 40, friction: 40, structural: 15, other: 7 },
  high_speed_exit: { fod: 15, friction: 15, structural: 7, other: 3 },
  parallel_taxiway: { fod: 15, friction: 7, structural: 7, other: 3 },
  secondary_taxiway: { fod: 7, friction: 7, structural: 7, other: 3 },
  active_apron: { fod: 7, friction: 3, structural: 7, other: 3 },
  remote_apron: { fod: 3, friction: 3, structural: 3, other: 1 },
  non_movement: { fod: 1, friction: 1, structural: 3, other: 1 },
};

/* =============================================================================
 * 6. DETECTABILITY  (locked decision 6)
 *
 * v1 folded inspection-recency escalation directly into L as a silent side
 * effect. That escalation stays (INSPECTION_RECENCY_ESCALATION above) - the
 * fix here is that a SECOND, DISTINCT source of uncertainty gets its own
 * name instead of hiding inside "how stale is the survey": some failure
 * modes are missed by a routine walkover survey no matter how recent it was.
 * Raveling is visible on a walkover; a stripped bond under a sound surface
 * is not.
 *
 * HAZARD_CLASS_DETECTABILITY is a label only - every branch gets one,
 * inferred from its hazard class, and it is always shown (register column,
 * trace). It does NOT touch the score by default: DETECTABILITY_ESCALATION
 * only applies when a branch's `detectability` is explicitly set on
 * BranchRiskInput (an admin override, Admin -> Risk Inventory), never as an
 * automatic default. Reasoning for that split:
 *
 *   1. Calibrating "how much should a hidden defect raise L" for 75 branches
 *      network-wide is exactly the kind of judgment call locked decision 6
 *      says belongs to the author, not to a table applied silently on their
 *      behalf.
 *   2. The brief's own three worked examples (risk.ts, WORKED_EXAMPLES) are
 *      pinned figures reproduced by hand in the thesis. AP-REMOTE-04 carries
 *      a structural distress (ALLIGATOR CR) with no detectability override
 *      set - an automatic hazard-class default would silently move its R
 *      from 36 to 60 and falsify that worked example.
 *
 * So: the label is always live (an admin can see at a glance which branches
 * the register believes are hard to inspect), the score effect is opt-in per
 * branch. Applying it is then a deliberate, traceable choice, not a global
 * recalibration.
 * ========================================================================== */

export type Detectability = 'visible' | 'moderate' | 'hidden';

export const DETECTABILITY_LABELS: Record<Detectability, string> = {
  visible: 'Visible on walkover',
  moderate: 'Detectable with routine testing',
  hidden: 'Hidden - needs specialized inspection',
};

/** Informational default per hazard class. See the section note above. */
export const HAZARD_CLASS_DETECTABILITY: Record<HazardClass, Detectability> = {
  fod: 'visible', //        loose or missing material - visible surface loss
  friction: 'visible', //   bleeding, rutting, polishing - visible deformation
  structural: 'hidden', //  debonding, base failure - the brief's own example
  other: 'moderate',
};

/**
 * Steps added to L, applied ONLY when a branch's detectability is explicitly
 * set (never from the inferred label alone). See the section note above.
 */
export const DETECTABILITY_ESCALATION: Record<Detectability, number> = {
  visible: 0,
  moderate: 0,
  hidden: 1,
};

/* =============================================================================
 * 7. REPAIR LOG: FACILITY JOIN, DISTRESS ALIASES, DOMINANT-DISTRESS METRIC
 *
 * Until v2.8 only 2 of 75 branches had a recorded dominant distress, so 73
 * scored hazard class 'other' and drew their consequence from the bottom
 * column of CONSEQUENCE_MATRIX. This section is what replaces that: the
 * airport's own maintenance repair log, 678 dated records over the period
 * 2025-08-01 to 2026-02-27 (record dates 2025-08-30 to 2026-02-26), which
 * carries a distress type for 31 branches.
 *
 * SOURCE
 *   REKAP KERUSAKAN 2025.xlsx, sheet 'Worksheet', header row 4, 678 data rows,
 *   converted by scripts/convert-repair-log.py into
 *   public/data/repair-log-2025.json.
 *
 * The log's own header reads "Unit: North Runway", so the 44 branches it never
 * mentions are not a fault in the join - see the coverage panel, which splits
 * them into the 12 north-side branches with no repair recorded in the window
 * and the 32 branches outside the log's unit entirely.
 * ========================================================================== */

/** Repair-log facility label -> Section code in pavement-data.json.
 *  Source: REKAP KERUSAKAN 2025.xlsx, Nama Fasilitas column, 22 distinct
 *  labels of which these 16 name exactly one branch. Accounts for 606 of the
 *  678 records.
 *  The log writes runway designators with a dash; the app uses a slash. */
export const FACILITY_TO_BRANCH: Record<string, string> = {
  'RUNWAY 07L/25R': '07L/25R',
  'RUNWAY 06-24': '06/24',
  'RUNWAY 07R/25L': '07R/25L',
  'TAXIWAY NP1': 'NP1',
  'TAXIWAY NP2': 'NP2',
  'TAXIWAY NP3': 'NP3',
  'TAXIWAY NPE': 'NPE',
  'TAXIWAY NPW': 'NPW',
  'TAXIWAY SP1': 'SP1',
  'TAXIWAY SPW': 'SPW',
  'TAXIWAY EC1': 'EC1',
  'TAXIWAY EC2': 'EC2',
  'APRON A': 'Apron A',
  'APRON B': 'Apron B', // AMBIGUOUS: the network also has 'Remote Apron B'. 1 record. Confirm.
  'APRON F': 'Apron F',
  'APRON G': 'Apron G',
};

/** Facility labels that name a group of branches rather than one. 70 records.
 *  Resolve the branch from Lokasi Perbaikan; fall back to unassigned. */
export const FACILITY_GROUPS: string[] = [
  'GATE TAXIWAY N1-N9',
  'GATE CROSS TAXIWAY N3M-N8M',
  'GATE CROSS TAXIWAY NC1-NC9',
  'GATE TAXIWAY M1-M8',
  'GATE CROSS TAXIWAY SC1-SC9',
];

/** Matches a branch code inside a free-text location.
 *
 *  The trailing \b is load-bearing: it is what stops N3 matching inside N3M.
 *  Listing the M-suffixed form first is belt and braces - both orders return
 *  N3M while the boundary is present, and dropping the boundary moves records
 *  onto the wrong branch in silence. repair-log.test.ts asserts on the
 *  boundary, not on the alternation order.
 *
 *  The pattern is deliberately wider than the network: it matches M3-M6 and
 *  S1-S9 shapes that either do not exist as Section codes or belong to another
 *  group. resolveBranch only accepts a match that exists in the loaded
 *  network, so that guard - not this pattern - is what prevents a phantom
 *  branch. Keep both. */
export const LOCATION_BRANCH_PATTERN = /\b(N[1-9]M|N[1-9]|NC[1-9]|M[1-8]|SC[1-9]|S[1-9])\b/;

/** Repair-log distress names -> canonical PAVER/ASTM keys.
 *  Source strings are bilingual (English, Indonesian in parentheses) and are
 *  matched after trim + toUpperCase. Add new spellings here rather than
 *  guessing at runtime. */
export const DISTRESS_ALIASES: Record<string, string> = {
  // --- Jenis Kerusakan (Aspal), 15 strings ---
  'ALLIGATOR/FATIGUE CRACK (RETAK KULIT BUAYA)': 'ALLIGATOR CR',
  'ASPHALT STRIPPING (MENGELUPAS)': 'ASPHALT STRIPPING',
  'BLEEDING (KEGEMUKAN)': 'BLEEDING',
  'BLOCK CRACK (RETAK BLOK)': 'BLOCK CR',
  'CORRUGATION (BERGELOMBANG)': 'CORRUGATION',
  'DEPRESSION (AMBLAS)': 'DEPRESSION',
  'JOINT REFLECTION CRACK - PCC (RETAK SAMBUNGAN - PCC)': 'JT REFLECTION CR',
  'LONGITUDINAL AND TRANSVERSAL CRACK (RETAK MEMANJANG DAN MELINTANG)': 'L & T CR',
  'PATCHING (TAMBALAN)': 'PATCHING',
  'POTHOLE (LUBANG)': 'POTHOLE',
  'RAVELING AND WEATHERING (BUTIRAN LEPAS DAN PELAPUKAN)': 'RAVELING',
  'RUTTING (ALUR)': 'RUTTING',
  'SHOVING OF ASPHALT PAVEMENT FROM PCC (SUNGKUR)': 'SHOVING',
  'SLIPPAGE CRACK (RETAK SABIT)': 'SLIPPAGE CR',
  'SWELLING (PENGEMBANGAN)': 'SWELL',

  // --- Jenis Kerusakan (Beton), 5 strings ---
  'CORNER CRACK (RETAK SUDUT)': 'CORNER CR',
  'SPALLING (LONGITUDINAL AND TRANSVERSE JOINT)': 'SPALLING',
  'SPALLING (CORNER)': 'SPALLING',
  'PATCHING BESAR (LEBIH DARI 0,5 M2) DAN GALIAN UTILITAS': 'PATCHING',
  'POTHOLES (LUBANG)': 'POTHOLE',

  // --- PCI sample-unit spellings, kept from the sample-unit path ---
  'ALLIGATOR CRACKING': 'ALLIGATOR CR',
  'LONGITUDINAL & TRANSVERSE CRACKING': 'L & T CR',
  'LONGITUDINAL/TRANSVERSE CRACKING': 'L & T CR',
  'JOINT REFLECTION CRACKING': 'JT REFLECTION CR',
};

/**
 * How the dominant distress is chosen from repair-log records.
 *
 * The three candidate metrics disagree, and not marginally. Measured on the
 * committed log (see dominant-distress.test.ts, which pins every figure here):
 *
 *   - the dominant distress NAME differs between count and area on 9 of the
 *     31 covered branches;
 *   - the dominant HAZARD CLASS, which is what actually reaches C, differs
 *     across the three metrics on 5 of the 31: 06/24, N1, N4M, N5, NP3.
 *     None of those five depends on how a tie is broken.
 *   - and 2 of those five - N1 and N4M - split on area versus severity_area
 *     ALONE, so the decision still bites even if the count metric is discarded
 *     outright.
 *
 * There is a second, sharper reason to prefer severity_area, found while
 * verifying the first: `count` has a TIED top rank on 5 branches - EC1, N4M,
 * N6, N7 and NC2 - so on those the "most frequent distress" is not defined by
 * the data at all, only by whatever order the tie is resolved in. `area` and
 * `severity_area` tie nowhere on this log; both single out one distress on all
 * 31 covered branches.
 *
 * So this is a stated modelling decision, not a detail: one candidate metric
 * is not even well-defined on a sixth of the covered network.
 *
 * severity_area is chosen because ASTM D5340 [4] deduct values are a function
 * of distress type, severity AND density together. The log carries no deduct
 * value, so extent times severity is the closest analogue available. Pasindu
 * [5] makes the same argument from the safety side: the severity of a distress,
 * not merely its presence, is what determines its effect on aircraft
 * operations.
 */
export const DOMINANT_DISTRESS_METRIC: 'count' | 'area' | 'severity_area' = 'severity_area';

export type DistressSeverityLevel = 'RINGAN' | 'SEDANG' | 'BERAT';

/**
 * Tingkat Kerusakan -> multiplier. Linear by assumption; ASTM deduct curves
 * are not linear. State this in the methodology chapter.
 *
 * A record whose Tingkat Kerusakan is blank gets weight 0, so it counts toward
 * `count` and `area` but contributes nothing to `severity_area`. Two records
 * in the committed log are in this state (both on 07L/25R). Defaulting them to
 * RINGAN would invent a severity that nobody recorded; weight 0 keeps them
 * visible in the other two metrics and the aggregate reports the count so the
 * omission is legible rather than silent.
 *
 * Kept as `Record<string, number>`, not `Record<DistressSeverityLevel, number>`:
 * dominant-distress.ts's severityWeight() probes this with whatever raw
 * Tingkat Kerusakan string the log actually contains, which is untrusted
 * input that could be blank or a typo - hence the `?? 0` fallback there. The
 * literal-union safety that matters is on SEVERITY_CONSEQUENCE_ESCALATION
 * below, which only ever sees a value an admin selected from a closed set.
 */
export const SEVERITY_WEIGHT: Record<string, number> = { RINGAN: 1, SEDANG: 2, BERAT: 3 };

/* =============================================================================
 * 8.1 SEVERITY-WEIGHTED CONSEQUENCE  (Phase 8, gated - Pasindu [5])
 *
 * Section 8 above uses Tingkat Kerusakan to pick WHICH distress dominates a
 * branch. This is a separate, later question: once a distress is chosen,
 * should how BADLY it presents also move the CONSEQUENCE it produces?
 * Pasindu [5] argues yes from the safety side - severity, not mere presence,
 * is what determines a distress's effect on aircraft operations (the same
 * argument already cited for DOMINANT_DISTRESS_METRIC above).
 *
 * This is opt-in per branch, exactly as DETECTABILITY_ESCALATION already is
 * (locked decision 6, risk.ts): a label is not even computed automatically
 * here, because unlike hazardClass - mechanically derivable from a single
 * distress name - a branch's PREVAILING severity requires aggregating the
 * raw Tingkat Kerusakan distribution behind its dominant distress, which
 * DistressTally does not carry forward (it folds straight into
 * severityArea). Building that aggregation to auto-populate every branch
 * would be a second feature, not this one - see the ceiling note below.
 * Set explicitly in Admin -> Risk Inventory (BranchRiskInput.distressSeverity)
 * when a reader has reason to flag one branch's presentation as unusually
 * severe; every branch without one scores exactly as it did before this
 * section existed, which is why WORKED_EXAMPLES in risk.ts is unaffected.
 *
 * Only BERAT escalates. RINGAN and SEDANG stay at the rule's baseline,
 * because CONSEQUENCE_MATRIX's hazard-class values already encode the
 * worst-credible reading for that failure mode at ordinary severity
 * (source [1]/[2]); escalating at every severity level would double-count
 * that headroom. BERAT is the case Pasindu's argument is strongest for - a
 * severely presented failure genuinely changes what could go wrong, not
 * just how likely it is.
 *
 * ponytail: escalates by a flat +1 CONSEQUENCE_SCALE step for BERAT, not a
 * role- or hazard-class-sensitive table. Add a finer calibration (e.g. a
 * runway BERAT escalating further than a non-movement-area BERAT) if the
 * defence needs it argued at that resolution - nothing here blocks it,
 * escalateConsequence (risk.ts) already takes an arbitrary step count.
 * ========================================================================== */

export const SEVERITY_CONSEQUENCE_ESCALATION: Record<DistressSeverityLevel, number> = {
  RINGAN: 0,
  SEDANG: 0,
  BERAT: 1,
};

export const DISTRESS_SEVERITY_LABELS: Record<DistressSeverityLevel, string> = {
  RINGAN: 'Light (Ringan)',
  SEDANG: 'Moderate (Sedang)',
  BERAT: 'Severe (Berat)',
};

/**
 * Precedence for resolving a branch's dominant distress. First hit wins.
 *
 *   admin      an explicit override in Admin -> Risk Inventory
 *   units      PCI sample units, aggregated by deduct
 *   log        the repair log, aggregated by DOMINANT_DISTRESS_METRIC
 *   inventory  KNOWN_DOMINANT_DISTRESS, the two-row reviewed table
 *   none       nothing - hazard class 'other', displayed as a gap
 *
 * Sample units rank above the log because a PCI survey is a systematic census
 * of the pavement, whereas the log is an event record: distress that nobody
 * found, or found and did not fix, never appears in it. A reader may argue the
 * log is more recent and should therefore win, which is exactly why the order
 * is a named constant instead of the order of some if/else chain.
 */
export const DISTRESS_SOURCE_ORDER = ['admin', 'units', 'log', 'inventory'] as const;
export type DistressSource = (typeof DISTRESS_SOURCE_ORDER)[number] | 'none';

/**
 * Of the 44 branches the repair log never reaches (distressSource 'none'),
 * these 12 are north-side codes whose SIBLING branches do appear in the log -
 * M1/M7 are covered but M2/M8 are not, N1/N3/N5-N7/N9 are covered but
 * N2/N4/N8/N8M are not, and so on. For these the gap reads as "no repair was
 * recorded in this window", not a scope boundary.
 *
 * The remaining 32 (everything covered minus this list) are genuinely outside
 * the log's stated scope - its own header reads "Unit: North Runway" - and
 * the coverage panel reports that as a second, distinct reason. Kept as a
 * runtime constant rather than only a test fixture so the panel can render
 * the split instead of a flat "none" count.
 */
export const REPAIR_LOG_NO_RECORD_IN_WINDOW: string[] = [
  'M2', 'M8', 'N2', 'N4', 'N8', 'N8M', 'NC1', 'NC4', 'NC6', 'NC7', 'NC9', 'NCY',
];

/* =============================================================================
 * 9. METODE B - DISTRESS-DERIVED LIKELIHOOD (sample-unit tier, risk-unit.ts)
 *
 * Everything above this section scores a BRANCH from one aggregate PCI value
 * (PCI_TO_LIKELIHOOD, untouched). Metode B scores a SAMPLE UNIT directly from
 * its own distress records - type, severity and PAVER density - so Likelihood
 * no longer passes through PCI at all on this path. PCI_TO_LIKELIHOOD must
 * stay unused here even for a unit with zero distress: that unit gets index 0
 * and likelihood 0.1, never a PCI-derived figure. See metode-b-spec_4.md
 * section 0.6.1 point 5.
 * ========================================================================== */

/** Severity weight, 1 to 4. Unitless, applies to every distress type. */
export const SEVERITY_LEVEL: Record<'N/A' | 'Low' | 'Medium' | 'High', 1 | 2 | 3 | 4> = {
  'N/A': 1,
  Low: 2,
  Medium: 3,
  High: 4,
};

/**
 * Extent-level thresholds, PER DISTRESS TYPE, read against PAVER's own
 * density output. Must stay per-type: L&T CR's density is linear-quantity /
 * area x 100 (m per m2 x 100), while every other type here is area / area x
 * 100 (dimensionless) - the two are not on the same scale, so one shared
 * threshold set would silently compare apples to metres. Thresholds are the
 * Q1/Q2/Q3 quartiles of the 2025 survey's real density distribution per type
 * (metode-b-spec_4.md section 3.4 table).
 *
 * ponytail: fixed thresholds from one survey year, not recalibrated per year.
 * Recalibrate once a second full survey year's density distribution exists.
 */
export const EXTENT_LEVEL_THRESHOLDS: Record<string, [number, number, number]> = {
  RAVELING: [0.05, 0.20, 1.00],
  'L & T CR': [0.08, 0.15, 0.50],
  'ALLIGATOR CR': [0.05, 0.15, 0.35],
  PATCHING: [0.10, 0.25, 0.60],
  BLEEDING: [0.50, 5.0, 20.0],
};

/** Fallback thresholds for a distress type EXTENT_LEVEL_THRESHOLDS has no row for. */
export const EXTENT_LEVEL_FALLBACK: [number, number, number] = [0.05, 0.20, 1.00];

/**
 * Maps a unit's 0..16 distress index onto the seven LIKELIHOOD_VALUES levels.
 * Boundaries are provisional - see metode-b-spec_4.md section 12 item 2.
 */
export const DISTRESS_INDEX_TO_LIKELIHOOD = [
  { minIndex: 13, likelihood: 10 },
  { minIndex: 10, likelihood: 6 },
  { minIndex: 7, likelihood: 3 },
  { minIndex: 5, likelihood: 1 },
  { minIndex: 3, likelihood: 0.5 },
  { minIndex: 1, likelihood: 0.2 },
  { minIndex: 0, likelihood: 0.1 },
] as const;
