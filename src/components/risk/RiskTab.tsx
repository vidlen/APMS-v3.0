import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import type { SectionData } from "@/lib/pci-utils";
import type { SurveyYear } from "@/lib/survey-years";
import type { GeoJSONFeatureCollection } from "@/lib/geojson-types";
import type { DistressTally } from "@/lib/dominant-distress";
import type { RepairLogStats } from "@/lib/repair-log";
import { usePavementData } from "@/hooks/usePavementData";
import { toUnitRiskInputs } from "@/lib/risk-unit-adapter";
import { scoreUnits, type UnitRiskResult } from "@/lib/risk-unit";
import { downloadUnitRiskResultsCsv } from "@/lib/risk-unit-export";
import { ICAO_GRID_PROVENANCE } from "@/config/icaoMatrix";
import { DEFAULT_LIKELIHOOD_SOURCE, type LikelihoodSource } from "@/config/riskScales";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import IcaoMatrixPanel from "./IcaoMatrixPanel";
import DistressCoveragePanel from "./DistressCoveragePanel";
import RiskMethodologyPanel from "./RiskMethodologyPanel";
import VariantComparisonPanel from "./VariantComparisonPanel";
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
  // Section 9.1: runtime state, not persisted to localStorage - every session
  // starts on DEFAULT_LIKELIHOOD_SOURCE.
  const [likelihoodSource, setLikelihoodSource] = useState<LikelihoodSource>(DEFAULT_LIKELIHOOD_SOURCE);

  const previousYearNum = Number(selectedYear) - 1;
  const previousYear = String(previousYearNum);
  const { unitsBySection: currentUnitsBySection, loading } = usePavementData(selectedYear);
  const { unitsBySection: previousUnitsBySection } = usePavementData(previousYear);

  const inputs = useMemo(() => {
    const currentFc = currentUnitsBySection[branchId];
    if (!currentFc) return [];
    const previousFc = previousUnitsBySection[branchId];
    return toUnitRiskInputs(branchId, "runway", Number(selectedYear), currentFc, previousFc, previousYearNum);
  }, [branchId, selectedYear, previousYearNum, currentUnitsBySection, previousUnitsBySection]);

  // Section 9.1: recompute the WHOLE array on every variant change, never patch
  // riskScore alone - band/icao/dru all depend on likelihood too.
  const results: UnitRiskResult[] = useMemo(() => scoreUnits(inputs, likelihoodSource), [inputs, likelihoodSource]);
  // Section 9.2/9.3: both variants, always scored, independent of which is
  // active - drives the comparison panel and the "shifted only" table mode.
  const resultsA = useMemo(() => scoreUnits(inputs, "tdv"), [inputs]);
  const resultsB = useMemo(() => scoreUnits(inputs, "pci"), [inputs]);

  const handleSelectSource = (source: LikelihoodSource) => {
    setLikelihoodSource(source);
    // Section 9.4 item 1: a cell selected under the old variant may not exist
    // under the new one - clear it rather than leave a filter with no rows.
    setSelectedCell(null);
  };

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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <ToggleGroup type="single" variant="outline" size="sm" value={branchId} onValueChange={(v) => v && setBranchId(v)}>
          {RUNWAY_OPTIONS.map((r) => (
            <ToggleGroupItem key={r.id} value={r.id}>
              {r.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Likelihood</span>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={likelihoodSource}
            onValueChange={(v) => v && handleSelectSource(v as LikelihoodSource)}
          >
            <ToggleGroupItem value="tdv" title="Likelihood from the sum of deduct value across every distress on the unit. Preserves the signal from stacked distress types.">
              A &middot; deduct ASTM
            </ToggleGroupItem>
            <ToggleGroupItem value="pci" title="Likelihood from the unit's own PCI, read on the ASTM condition class. Uses the already-corrected figure, but flattens the top end.">
              B &middot; PCI unit
            </ToggleGroupItem>
          </ToggleGroup>
          <button
            onClick={() => downloadUnitRiskResultsCsv(results, { branchId, surveyYear: Number(selectedYear), likelihoodSource })}
            className="h-8 inline-flex items-center gap-1.5 px-3 rounded-md text-xs font-medium border border-border text-foreground hover:bg-secondary transition-colors"
            title="Export this table's scored results as CSV, with branch/year/variant in the header"
          >
            <Download size={12} /> Export CSV
          </button>
        </div>
      </div>

      <IcaoMatrixPanel results={results} selectedCell={selectedCell} onSelectCell={handleSelectCell} likelihoodSource={likelihoodSource} />

      <VariantComparisonPanel resultsA={resultsA} resultsB={resultsB} />

      <DistressCoveragePanel
        stats={repairLogStats}
        coveredBranches={coveredBranches}
        totalBranches={sections.length}
        sampleUnitBranchCount={Object.keys(unitsBySection).length}
      />

      <RiskMethodologyPanel results={results} likelihoodSource={likelihoodSource} />

      <UnitRiskPanel
        selectedYear={selectedYear}
        results={results}
        compareA={resultsA}
        compareB={resultsB}
        likelihoodSource={likelihoodSource}
        loading={loading}
        selectedCell={selectedCell}
        onClearCellFilter={() => setSelectedCell(null)}
      />
    </div>
  );
}
