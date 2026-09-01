/**
 * risk-unit-export.ts
 * -----------------------------------------------------------------------------
 * CSV export for the Risk tab's own unit-result table (metode-b-r1-spec.md
 * section 9.5) - deliberately separate from ImportExportPanel, which belongs
 * to the admin page and exports source GeoJSON, not scored results. A result
 * file that doesn't name its own likelihoodSource cannot be used as a thesis
 * attachment, so the header row always carries it.
 * -----------------------------------------------------------------------------
 */

import type { UnitRiskResult } from './risk-unit.ts';
import type { LikelihoodSource } from '../config/riskScales.ts';

const COLUMNS: { key: string; get: (r: UnitRiskResult) => string | number | boolean }[] = [
  { key: 'unit', get: (r) => r.unitNumber },
  { key: 'zone', get: (r) => r.zone },
  { key: 'stationKm', get: (r) => r.stationKm },
  { key: 'tdv', get: (r) => r.tdv.toFixed(2) },
  { key: 'coveragePct', get: (r) => r.coveragePct.toFixed(3) },
  { key: 'likelihood', get: (r) => r.likelihood },
  { key: 'likelihoodTdv', get: (r) => r.likelihoodTdv },
  { key: 'likelihoodPci', get: (r) => r.likelihoodPci ?? '' },
  { key: 'frequency', get: (r) => r.frequency },
  { key: 'consequence', get: (r) => r.consequence },
  { key: 'riskScore', get: (r) => r.riskScore },
  { key: 'degree', get: (r) => r.band.degree },
  { key: 'icaoCell', get: (r) => r.icao.cell },
  { key: 'icaoZone', get: (r) => r.icao.zone },
  { key: 'hazardClass', get: (r) => r.hazardClass },
  { key: 'dominantDistress', get: (r) => r.dominantDistress },
  { key: 'observedRateClass', get: (r) => r.observedRateClass },
  { key: 'druCell', get: (r) => r.dru.druCell },
  { key: 'druUrgency', get: (r) => String(r.dru.urgency) },
  { key: 'astmConditionClass', get: (r) => r.astmConditionClass },
  { key: 'likelihoodClassGap', get: (r) => r.likelihoodClassGap },
  { key: 'astmConsistent', get: (r) => r.astmConsistent },
  { key: 'pciIsReal', get: (r) => r.pciIsReal },
];

function csvCell(value: string | number | boolean): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Builds the CSV text - a `# ` header block naming the run, then the table. */
export function unitRiskResultsToCsv(
  results: UnitRiskResult[],
  meta: { branchId: string; surveyYear: number; likelihoodSource: LikelihoodSource },
): string {
  const lines = [
    `# branch: ${meta.branchId}`,
    `# surveyYear: ${meta.surveyYear}`,
    `# likelihoodSource: ${meta.likelihoodSource}`,
    `# exportedAt: ${new Date().toISOString()}`,
    COLUMNS.map((c) => c.key).join(','),
    ...results.map((r) => COLUMNS.map((c) => csvCell(c.get(r))).join(',')),
  ];
  return lines.join('\n');
}

/** Triggers a browser download of the CSV - client-side only, no server round trip. */
export function downloadUnitRiskResultsCsv(
  results: UnitRiskResult[],
  meta: { branchId: string; surveyYear: number; likelihoodSource: LikelihoodSource },
): void {
  const csv = unitRiskResultsToCsv(results, meta);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const branchSlug = meta.branchId.replace(/\//g, '-');
  const a = document.createElement('a');
  a.href = url;
  a.download = `risk-${branchSlug}-${meta.surveyYear}-${meta.likelihoodSource}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
