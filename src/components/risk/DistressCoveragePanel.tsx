import type { RepairLogStats } from "@/lib/repair-log";
import { REPAIR_LOG_NO_RECORD_IN_WINDOW } from "@/config/riskScales";

interface DistressCoveragePanelProps {
  stats: RepairLogStats;
  /** Branches with a resolved dominant distress from ANY source (admin, PCI
   *  sample units, the repair log, or the reviewed inventory) - read from the
   *  register's own results, not recomputed here, so this panel and the
   *  register can never quietly disagree about what counts as "covered". */
  coveredBranches: number;
  totalBranches: number;
  /** Section codes with PCI sample units loaded for the current year. */
  sampleUnitBranchCount: number;
}

function Stat({ value, label, tone }: { value: number; label: string; tone?: "muted" }) {
  return (
    <div className="flex-1 flex flex-col items-center gap-1 px-2 first:pl-0 last:pr-0">
      <div
        className={`font-mono text-lg font-bold tabular-nums leading-tight ${
          tone === "muted" ? "text-muted-foreground" : "text-foreground"
        }`}
      >
        {value}
      </div>
      <div className="text-[9px] tracking-[.07em] uppercase text-muted-foreground text-center leading-tight">
        {label}
      </div>
    </div>
  );
}

// A register that hides the gap reads as full coverage when 44 of 75 branches
// have no distress evidence at all (brief section 7/8.3). This panel exists
// so that gap is a number on screen, not something a reader has to notice by
// scanning "no evidence" down the register's Distress column.
export default function DistressCoveragePanel({
  stats,
  coveredBranches,
  totalBranches,
  sampleUnitBranchCount,
}: DistressCoveragePanelProps) {
  const uncovered = totalBranches - coveredBranches;
  const noRecordInWindow = REPAIR_LOG_NO_RECORD_IN_WINDOW.length;
  const outsideLogScope = Math.max(0, uncovered - noRecordInWindow);

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="px-5 py-4">
        <h3 className="panel-label mb-3">Maintenance repair-log coverage</h3>
        <p className="text-[11px] text-muted-foreground -mt-2 mb-3">
          Which branches the airport's own repair log has evidence for - unrelated to Metode B's risk-assessment
          coverage below, which is scored from PCI sample units on RWY 06/24 and RWY 07L/25R only.
        </p>

        <div className="flex divide-x divide-border">
          <Stat value={coveredBranches} label={`of ${totalBranches} branches covered`} />
          <Stat value={sampleUnitBranchCount} label="from PCI sample units" />
          <Stat value={stats.branchesCovered} label="from the repair log" />
          <Stat value={uncovered} label="no evidence" tone="muted" />
        </div>

        {uncovered > 0 && (
          <div className="mt-4 rounded-md border border-dashed border-border px-3 py-2.5 space-y-1.5">
            <p className="text-[11px] text-muted-foreground leading-snug">
              <span className="font-mono font-semibold text-foreground">{noRecordInWindow}</span>{" "}
              of the {uncovered} uncovered branches have a sibling that DOES appear in the log (e.g.
              M1 is covered, M2 is not) - the gap there is no repair recorded in this window, not a
              scope boundary.
            </p>
            <p className="text-[11px] text-muted-foreground leading-snug">
              The remaining{" "}
              <span className="font-mono font-semibold text-foreground">{outsideLogScope}</span> are
              genuinely outside the log's stated scope - its own header reads{" "}
              <span className="italic">"Unit: North Runway"</span>.
            </p>
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[10.5px] text-muted-foreground">
          <span title="Resolved to a branch from the Nama Fasilitas column directly">
            <span className="font-mono font-medium text-foreground">{stats.byFacility}</span> resolved
            by facility
          </span>
          <span title="Resolved to a branch by reading the Lokasi Perbaikan text inside a group label">
            <span className="font-mono font-medium text-foreground">{stats.byLocation}</span> by
            location
          </span>
          <span title="A group label whose location text named no branch in the loaded network">
            <span className="font-mono font-medium text-foreground">{stats.unresolvedGroup}</span>{" "}
            unresolved group
          </span>
          <span title="A facility label that is not a Section code and not a group (APRON KARGO)">
            <span className="font-mono font-medium text-foreground">{stats.unknownFacility}</span>{" "}
            unknown facility
          </span>
          <span title="Neither an asphalt nor a concrete distress type - skipped and counted, never guessed as 'other'">
            <span className="font-mono font-medium text-foreground">{stats.skippedNoDistress}</span>{" "}
            skipped, no distress type
          </span>
        </div>
      </div>
    </div>
  );
}
