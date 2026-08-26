// PCI Classification based on original qgis2web data
export interface PCICategory {
  min: number;
  max: number;
  label: string;
  color: string;
  fillColor: string;
  textColor: string;
}

/** The out-of-scale marker for a branch with no PCI survey. Deliberately NOT
 *  a member of pciCategories: it is not a band on the 0-100 scale, it is the
 *  absence of a value. Anything that iterates the ramp must not pick it up. */
export interface NotSurveyedCategory {
  label: 'Not Surveyed';
  color: string;
  fillColor: string;
  textColor: string;
  /** Marks this as hatched rather than solid - see hatch-pattern.ts. */
  hatched: true;
}

export type ConditionCategory = PCICategory | NotSurveyedCategory;

export function isNotSurveyed(cat: ConditionCategory): cat is NotSurveyedCategory {
  return (cat as NotSurveyedCategory).hatched === true;
}

export const pciCategories: PCICategory[] = [
  { min: 0, max: 11, label: "Failed", color: "#efefef", fillColor: "rgba(239,239,239,0.72)", textColor: "#333" },
  { min: 11, max: 26, label: "Serious", color: "#b40000", fillColor: "rgba(180,0,0,0.72)", textColor: "#fff" },
  { min: 26, max: 41, label: "Very Poor", color: "#ff6dce", fillColor: "rgba(255,109,206,0.72)", textColor: "#fff" },
  { min: 41, max: 56, label: "Poor", color: "#ff821b", fillColor: "rgba(255,130,27,0.72)", textColor: "#fff" },
  { min: 56, max: 71, label: "Fair", color: "#fefe00", fillColor: "rgba(254,254,0,0.72)", textColor: "#333" },
  { min: 71, max: 86, label: "Satisfactory", color: "#b2df8a", fillColor: "rgba(178,223,138,0.72)", textColor: "#333" },
  { min: 86, max: 100, label: "Good", color: "#5a9a33", fillColor: "rgba(90,154,51,0.72)", textColor: "#fff" },
];

export const NOT_SURVEYED: NotSurveyedCategory = {
  label: 'Not Surveyed',
  color: '#64748b',
  fillColor: 'rgba(100,116,139,0.55)',
  textColor: '#fff',
  hatched: true,
};

/** Hatch stroke colour, shared by the canvas pattern and the CSS swatch so the
 *  map and the legend can never drift apart. */
export const NOT_SURVEYED_HATCH = '#e2e8f0';
export const NOT_SURVEYED_STROKE = '#475569';

export function getPCICategory(pciValue: number | null): ConditionCategory {
  if (pciValue === null || !Number.isFinite(pciValue)) return NOT_SURVEYED;
  // Clamp before matching. A value outside 0..100 is a data error, not an
  // absent survey, so it lands in the nearest real band rather than silently
  // falling through to the last array element the way v2.9 did.
  const clamped = Math.min(100, Math.max(0, pciValue));
  for (const cat of pciCategories) {
    if (clamped >= cat.min && clamped <= cat.max) return cat;
  }
  return pciCategories[0];
}

export function getPCIStyle(pciValue: number | null) {
  const cat = getPCICategory(pciValue);
  return {
    fill: cat.fillColor,
    stroke: isNotSurveyed(cat) ? NOT_SURVEYED_STROKE : "rgba(35,35,35,0.7)",
    strokeWidth: 1,
    hatched: isNotSurveyed(cat),
  };
}

export function getPCIColor(pciValue: number | null): string {
  return getPCICategory(pciValue).color;
}

export interface SectionData {
  Section: string;
  /** Absent for a branch with no PCI survey. Present as a string when a survey
   *  or an admin override supplies one. */
  "PCI Rating"?: string;
  PCN: string;
  Type: string;
  sampleUnit?: number;
  "Last Major Construction Year"?: string;
  Dimension?: string;
}

/** Parses a PCI string. Returns null for absent, blank, or non-numeric input -
 *  never NaN, so callers cannot accidentally propagate it into a comparison
 *  that silently fails. Number(), not parseFloat(): parseFloat('84abc') is 84,
 *  which would let a malformed cell through as a valid reading. */
export function parsePCIValue(pciStr: string | undefined | null): number | null {
  if (pciStr === undefined || pciStr === null) return null;
  const trimmed = pciStr.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

// Overall branch PCI for sections backed by sample units is the mean of
// those units' scores, rounded to 1 decimal place.
export function computeSectionPci(unitScores: number[]): number {
  if (unitScores.length === 0) return 0;
  const avg = unitScores.reduce((sum, s) => sum + s, 0) / unitScores.length;
  return Math.round(avg * 10) / 10;
}

export function formatPciValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

// Count of sections per condition category, including zero-count bands, so
// callers can tell "no sections in this range" apart from "not computed yet".
// Not Surveyed gets its own key alongside the seven PCI bands.
export function countByCondition(sections: SectionData[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const cat of pciCategories) counts[cat.label] = 0;
  counts[NOT_SURVEYED.label] = 0;
  for (const s of sections) {
    const label = getPCICategory(parsePCIValue(s["PCI Rating"])).label;
    counts[label] = (counts[label] ?? 0) + 1;
  }
  return counts;
}

export interface PciSummary {
  /** Mean PCI across surveyed sections only. null when none are surveyed. */
  mean: number | null;
  /** How many sections carried a PCI value. */
  surveyed: number;
  /** How many sections were considered. */
  total: number;
}

// Network-wide average PCI — the single shared source for every "Average
// PCI" figure shown across the app (StatsBar, the tab bar's scope strip),
// so they can never drift apart from one another. Computed over surveyed
// sections only - see PciSummary.
export function averagePci(sections: SectionData[]): PciSummary {
  const values = sections
    .map((s) => parsePCIValue(s['PCI Rating']))
    .filter((v): v is number => v !== null);
  return {
    mean: values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length,
    surveyed: values.length,
    total: sections.length,
  };
}
