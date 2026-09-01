/**
 * surveyRegimes.ts
 * -----------------------------------------------------------------------------
 * A one-year PCI delta is only a meaningful "how fast did this deteriorate"
 * signal when both years were surveyed the same way. RWY 06/24's 2024 file
 * carries zero distress records against 2025's 530 - not because nothing was
 * there in 2024, but because that survey didn't record it - so a 2025-vs-2024
 * delta measures a change in what was LOOKED AT, not a change in condition.
 * observed-rate.ts's comparableYears guard exists to stop that delta from
 * being read as deterioration.
 *
 * This concept was designed for Metode C (metode-c-spec_v2.md) but is needed
 * earlier, for Metode B's observed-rate class - see metode-b-r1-spec.md
 * section 7.
 * -----------------------------------------------------------------------------
 */

export type SurveyRegime = 'paver-lengkap' | 'paver-sebagian' | 'manual-satu-distress' | 'tanpa-distress';

/** Rezim per branch per survey year. Two years are only comparable when their
 *  regime matches - see comparableYears below. A year missing from this table
 *  is NOT assumed comparable to anything (admin-added years are common, and
 *  this table can never be kept exhaustive for them). */
export const SURVEY_REGIME: Record<string, Record<number, SurveyRegime>> = {
  '06/24': {
    2024: 'tanpa-distress', // 0 distress records in the app's file
    2025: 'paver-lengkap', // 530 records, 5 types
    2026: 'paver-lengkap', // 416 records, 4 types
  },
  '07L/25R': {
    2020: 'manual-satu-distress',
    2021: 'manual-satu-distress',
    2022: 'manual-satu-distress',
    2023: 'manual-satu-distress',
    2024: 'tanpa-distress', // file exists, 360 units, 0 distress records
    2025: 'paver-lengkap',
    2026: 'paver-lengkap',
  },
};

/** True only when both years are known for this branch AND share a regime.
 *  An unknown year (branch/year pair missing from SURVEY_REGIME - admin-added
 *  years are never in this table) is never assumed comparable. */
export function comparableYears(branchId: string, a: number, b: number): boolean {
  const regimeA = SURVEY_REGIME[branchId]?.[a];
  const regimeB = SURVEY_REGIME[branchId]?.[b];
  if (regimeA === undefined || regimeB === undefined) return false;
  return regimeA === regimeB;
}
