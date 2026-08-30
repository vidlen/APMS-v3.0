export type SurveyYear = string;

export interface YearMeta {
  id: SurveyYear;
  label: string;
  clonedFrom: SurveyYear | null;
}

// Years that ship with a committed base GeoJSON file in /public/data.
// This is only the seed list — the live year list (including years added
// by an admin at runtime) is resolved by the data store.
export const SEED_YEARS: YearMeta[] = [
  { id: "2026", label: "2026", clonedFrom: null },
  { id: "2025", label: "2025", clonedFrom: null },
  { id: "2024", label: "2024", clonedFrom: null },
  { id: "2023", label: "2023", clonedFrom: null },
  { id: "2020", label: "2020", clonedFrom: null },
];

const SEED_SECTION_URLS: Record<string, string> = {
  "2026": "/data/pavement-data-2026.json",
  "2025": "/data/pavement-data.json",
  "2024": "/data/pavement-data-2024.json",
  "2020": "/data/pavement-data-2020.json",
};

export function getSeedSectionsUrl(year: SurveyYear): string | null {
  return SEED_SECTION_URLS[year] ?? null;
}
