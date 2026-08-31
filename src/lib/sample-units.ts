import type { SurveyYear } from "@/lib/survey-years";

// Seed sample-unit source files, keyed by the seed year that owns them.
// Only used to resolve base data for seed years / years cloned from them —
// the live per-year list (including uploaded years) is resolved by the
// data store.
export const SEED_SAMPLE_UNIT_SOURCES: Record<SurveyYear, Record<string, string>> = {
  "2026": {
    "06/24": "/data/runway-06-24-units-2026.json",
    "07L/25R": "/data/runway-07L-25R-units-2026.json",
  },
  "2025": {
    "06/24": "/data/runway-06-24-units-2025.json",
    "07L/25R": "/data/runway-07L-25R-units-2025.json",
  },
  "2024": {
    "06/24": "/data/runway-06-24-units-2024.json",
    "07L/25R": "/data/runway-07L-25R-units-2024.json",
  },
  "2023": {
    "07L/25R": "/data/runway-07L-25R-units-2023.json",
  },
  "2022": {
    "07L/25R": "/data/runway-07L-25R-units-2022.json",
  },
  "2021": {
    "07L/25R": "/data/runway-07L-25R-units-2021.json",
  },
  "2020": {
    "07L/25R": "/data/runway-07L-25R-units-2020.json",
  },
};

export interface SampleUnitDistress {
  type: string;
  severity: string;
  quantity: number;
  quantityUnits: string;
  deduct: number;
}

export interface SampleUnitProperties {
  square_id: number;
  sampleUnit: number;
  sampleUnitSet: string;
  pci_score: number;
  pci_rating: string;
  distresses?: SampleUnitDistress[];
}
