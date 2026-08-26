import { useMemo, useState } from "react";
import type { SectionData } from "@/lib/pci-utils";
import type { SurveyYear } from "@/lib/survey-years";
import type { GeoJSONFeatureCollection } from "@/lib/geojson-types";
import type { DistressTally } from "@/lib/dominant-distress";
import type { RepairLogStats } from "@/lib/repair-log";
import { usePavementData } from "@/hooks/usePavementData";
import { toUnitRiskInputs } from "@/lib/risk-unit-adapter";
import { scoreUnits, type UnitRiskResult } from "@/lib/risk-unit";
import { ICAO_GRID_PROVENANCE } from "@/config/icaoMatrix";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import IcaoMatrixPanel from "./IcaoMatrixPanel";
import DistressCoveragePanel from "./DistressCoveragePanel";
import RiskMethodologyPanel from "./RiskMethodologyPanel";
import UnitRiskPanel from "./UnitRiskPanel";

interface RiskTabProps {
  sections: SectionData[];
  selectedYear: SurveyYear;
  /** PCI sample units already loaded for this year (usePavementData), keyed
   *  by Section. Used only to count branches with sample-unit distress
   *  evidence for the coverage panel below - Metode B itself fetches its own
   *  current/previous-year data per selected runway (see the useMemo below). */
  unitsBySection?: Record<string, GeoJSONFeatureCollection>;
  /** The repair log, already aggregated against this year's branch set
   *  (Home.tsx: aggregateRepairLog(...).byBranch) - used only for the
   *  coverage panel's branch-union count, not for scoring. */
  repairLogByBranch?: Record<string, DistressTally[]>;
  /** Same aggregation's resolution counts, for the coverage panel. */
  repairLogStats?: RepairLogStats;
}

const EMPTY_UNITS: Record<string, GeoJSONFeatureCollection> = {};
const EMPTY_LOG: Record<string, DistressTally[]> = {};
const EMPTY_STATS: RepairLogStats = {
  total: 0,
  byFacility: 0,
  byLocation: 0,
  unresolvedGroup: 0,
  unknownFacility: 0,
  skippedNoDistress: 0,
  aggregatedWithoutSeverity: 0,
  aggregated: 0,
  branchesCovered: 0,
};

// Metode B only has real per-unit distress + PCI for these two branches
// (metode-b-spec_4.md section 0.6) - every other branch has no sample-unit
// collection to score at all, so the tab is scoped to a choice between them.
const RUNWAY_OPTIONS: { id: string; label: string }[] = [
  { id: "06/24", label: "RWY 06/24" },
  { id: "07L/25R", label: "RWY 07L/25R" },
];

export default function RiskTab({
  sections,
  selectedYear,
  unitsBySection = EMPTY_UNITS,
  repairLogByBranch = EMPTY_LOG,
  repairLogStats = EMPTY_STATS,
}: RiskTabProps) {
  const [branchId, setBranchId] = useState<string>(RUNWAY_OPTIONS[0].id);
  const [selectedCell, setSelectedCell] = useState<string | null>(null);

  const previousYear = String(Number(selectedYear) - 1);
  const { unitsBySection: currentUnitsBySection, loading } = usePavementData(selectedYear);
  const { unitsBySection: previousUnitsBySection } = usePavementData(previousYear);

  const results: UnitRiskResult[] = useMemo(() => {
    const currentFc = currentUnitsBySection[branchId];
    if (!currentFc) return [];
    const previousFc = previousUnitsBySection[branchId];
    const inputs = toUnitRiskInputs(branchId, "runway", Number(selectedYear), currentFc, previousFc);
    return scoreUnits(inputs);
  }, [branchId, selectedYear, currentUnitsBySection, previousUnitsBySection]);

  // "Covered" here means the union of branches with sample-unit distress
  // evidence or repair-log evidence - the two sources that still have any
  // way to fire post-cleanup (the admin-override and reviewed-inventory
  // tiers had no live writer left once the Branch Register admin screen was
  // removed, and both real-evidence branches already resolve via sample
  // units, so this union reproduces the old precedence-chain count exactly
  // for the committed data).
  const coveredBranches = useMemo(() => {
    const covered = new Set<string>(Object.keys(unitsBySection));
    for (const [branch, tallies] of Object.entries(repairLogByBranch)) {
      if (tallies.length > 0) covered.add(branch);
    }
    return covered.size;
  }, [unitsBySection, repairLogByBranch]);

  const handleSelectCell = (cell: string | null) => {
    setSelectedCell((prev) => (prev === cell ? null : cell));
  };

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-5">
      <div>
        <h2 className="font-condensed text-xl font-semibold tracking-tight text-foreground">
          Risk Management
        </h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-[70ch]">
          Sample-unit level Fine-Kinney scoring (Metode B) for RWY 06/24 and RWY 07L/25R, using
          ICAO Doc 9859 for the operational verdict.
        </p>
        <p className="text-xs text-muted-foreground/80 italic mt-1 max-w-[70ch]">
          Calculated only using processes found in literature, not yet adhering to Angkasa Pura's SMS.
          Still subject to change.
        </p>
      </div>

      <p className="text-[11px] text-muted-foreground border border-dashed border-border rounded-md px-3 py-2">
        {ICAO_GRID_PROVENANCE}
      </p>

      <ToggleGroup type="single" variant="outline" size="sm" value={branchId} onValueChange={(v) => v && setBranchId(v)}>
        {RUNWAY_OPTIONS.map((r) => (
          <ToggleGroupItem key={r.id} value={r.id}>
            {r.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <IcaoMatrixPanel results={results} selectedCell={selectedCell} onSelectCell={handleSelectCell} />

      <DistressCoveragePanel
        stats={repairLogStats}
        coveredBranches={coveredBranches}
        totalBranches={sections.length}
        sampleUnitBranchCount={Object.keys(unitsBySection).length}
      />

      <RiskMethodologyPanel />

      <UnitRiskPanel
        selectedYear={selectedYear}
        results={results}
        loading={loading}
        selectedCell={selectedCell}
        onClearCellFilter={() => setSelectedCell(null)}
      />
    </div>
  );
}
