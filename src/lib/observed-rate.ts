/**
 * observed-rate.ts
 * -----------------------------------------------------------------------------
 * Classifies a sample unit's one-year PCI change into a deterioration-rate
 * bucket. This is descriptive, not predictive: it reads a PCI delta that has
 * already happened, and takes no view on what happens next (that's
 * markov-forecast.ts, out of scope for Metode B).
 *
 * Gated on data authenticity: a class here is only meaningful when both PCI
 * figures being differenced came from an actual survey. `pciIsReal`/
 * `previousPciIsReal` false on either side must return 'tidak_terdefinisi',
 * never a rate computed from a display-filler PCI.
 *
 * Gated on survey regime (metode-b-r1-spec.md section 7): a delta between two
 * years surveyed under different regimes (e.g. RWY 06/24 2025 vs. 2024, where
 * 2024 recorded zero distress) measures a change in survey method, not a
 * change in condition, and must also return 'tidak_terdefinisi'. This guard
 * runs BEFORE every other rule.
 * -----------------------------------------------------------------------------
 */

import { comparableYears } from '../config/surveyRegimes.ts';

export type ObservedRateClass = 'stabil' | 'memburuk' | 'memburuk_cepat' | 'tidak_terdefinisi';

/**
 * dPCI thresholds, provisional - see metode-b-r1-spec.md section 14.
 * Spearman correlation between risk index and one-year PCI drop is weak, so a
 * single year's delta is noisy; these bands group it rather than treat the
 * continuous value as trustworthy on its own.
 */
export const OBSERVED_RATE_THRESHOLDS = {
  stabilMax: 2, // dPCI <= 2 points
  memburukMax: 10, // 2 < dPCI <= 10 points
} as const; // dPCI > 10 falls into memburuk_cepat

export function observedRateClass(
  pci: number,
  previousPci: number | undefined,
  repairedSincePrevious: boolean,
  pciIsReal: boolean,
  previousPciIsReal: boolean,
  branchId: string,
  surveyYear: number,
  previousYear: number | undefined,
): ObservedRateClass {
  if (!pciIsReal || !previousPciIsReal) return 'tidak_terdefinisi';
  if (previousPci === undefined) return 'tidak_terdefinisi';
  if (previousYear === undefined || !comparableYears(branchId, surveyYear, previousYear)) {
    return 'tidak_terdefinisi';
  }
  // A repaired unit's PCI rose because of the repair, not because deterioration
  // reversed - reading that as a rate would conflate maintenance with decay.
  if (repairedSincePrevious) return 'tidak_terdefinisi';

  const dPci = previousPci - pci;
  if (dPci <= OBSERVED_RATE_THRESHOLDS.stabilMax) return 'stabil';
  if (dPci <= OBSERVED_RATE_THRESHOLDS.memburukMax) return 'memburuk';
  return 'memburuk_cepat';
}
