import { useMemo, useState } from "react";
import { AlertTriangle, Info, ShieldAlert } from "lucide-react";
import type { SurveyYear } from "@/lib/survey-years";
import { type UnitRiskResult, type Zone } from "@/lib/risk-unit";
import type { ObservedRateClass } from "@/lib/observed-rate";
import type { LikelihoodSource } from "@/config/riskScales";
import { RISK_BANDS } from "@/config/riskScales";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface UnitRiskPanelProps {
  selectedYear: SurveyYear;
  results: UnitRiskResult[];
  /** Both variants, always scored regardless of which is active - drives the
   *  "units that shift" mode (section 9.3). Keyed by unitNumber inside. */
  compareA: UnitRiskResult[];
  compareB: UnitRiskResult[];
  likelihoodSource: LikelihoodSource;
  loading: boolean;
  /** Set by clicking a cell in IcaoMatrixPanel above - narrows the table to
   *  that cell, on top of whatever the panel's own filters already exclude. */
  selectedCell: string | null;
  onClearCellFilter: () => void;
}

const ZONE_LABELS: Record<Zone, string> = { ujung: "End", tengah: "Middle" };

const RATE_LABELS: Record<ObservedRateClass, string> = {
  stabil: "Stable",
  memburuk: "Worsening",
  memburuk_cepat: "Worsening Fast",
  tidak_terdefinisi: "Undefined",
};

const RATE_COLORS: Record<ObservedRateClass, string> = {
  stabil: "#16a34a",
  memburuk: "#f59e0b",
  memburuk_cepat: "#dc2626",
  tidak_terdefinisi: "#6b7280",
};

const SOURCE_LABEL: Record<LikelihoodSource, string> = { tdv: "A - TDV", pci: "B - PCI" };

interface ShiftInfo {
  degreeA: number;
  degreeB: number;
  zoneA: string;
  zoneB: string;
  urgencyA: string;
  urgencyB: string;
  degreeGap: number;
  shifted: boolean;
}

export default function UnitRiskPanel({
  selectedYear,
  results,
  compareA,
  compareB,
  likelihoodSource,
  loading,
  selectedCell,
  onClearCellFilter,
}: UnitRiskPanelProps) {
  const [zoneFilter, setZoneFilter] = useState<"all" | Zone>("all");
  const [degreeFilter, setDegreeFilter] = useState<"all" | number>("all");
  const [rateFilter, setRateFilter] = useState<"all" | ObservedRateClass>("all");
  // Section 0.6.2: dummy-PCI rows must be clearly marked AND filterable out -
  // defaults to hidden since a thesis-facing table should default to real data.
  const [hideDummyPci, setHideDummyPci] = useState(true);
  // Section 9.3: the mode actually used when explaining the two variants -
  // narrows the table to units that disagree between A and B.
  const [showShiftedOnly, setShowShiftedOnly] = useState(false);

  const shiftByUnit = useMemo(() => {
    const bByUnit = new Map(compareB.map((r) => [r.unitNumber, r]));
    const map = new Map<number, ShiftInfo>();
    for (const a of compareA) {
      const b = bByUnit.get(a.unitNumber);
      if (!b) continue;
      const shifted = a.band.degree !== b.band.degree || a.icao.zone !== b.icao.zone || a.dru.urgency !== b.dru.urgency;
      map.set(a.unitNumber, {
        degreeA: a.band.degree,
        degreeB: b.band.degree,
        zoneA: a.icao.zone,
        zoneB: b.icao.zone,
        urgencyA: String(a.dru.urgency),
        urgencyB: String(b.dru.urgency),
        degreeGap: Math.abs(a.band.degree - b.band.degree),
        shifted,
      });
    }
    return map;
  }, [compareA, compareB]);

  const shiftedCount = useMemo(() => [...shiftByUnit.values()].filter((s) => s.shifted).length, [shiftByUnit]);

  const rows = useMemo(() => {
    let filtered = results.filter((r) => {
      if (hideDummyPci && !r.pciIsReal) return false;
      if (zoneFilter !== "all" && r.zone !== zoneFilter) return false;
      if (degreeFilter !== "all" && r.band.degree !== degreeFilter) return false;
      if (rateFilter !== "all" && r.observedRateClass !== rateFilter) return false;
      if (selectedCell && r.icao.cell !== selectedCell) return false;
      if (showShiftedOnly && !shiftByUnit.get(r.unitNumber)?.shifted) return false;
      return true;
    });
    if (showShiftedOnly) {
      filtered = [...filtered].sort(
        (a, b) => (shiftByUnit.get(b.unitNumber)?.degreeGap ?? 0) - (shiftByUnit.get(a.unitNumber)?.degreeGap ?? 0),
      );
    }
    return filtered;
  }, [results, hideDummyPci, zoneFilter, degreeFilter, rateFilter, selectedCell, showShiftedOnly, shiftByUnit]);

  const degreeCounts = useMemo(() => {
    const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const r of results) counts[r.band.degree] += 1;
    return counts;
  }, [results]);

  const zoneCounts = useMemo(() => {
    const counts: Record<Zone, number> = { ujung: 0, tengah: 0 };
    for (const r of results) counts[r.zone] += 1;
    return counts;
  }, [results]);

  if (loading) {
    return <div className="text-sm text-muted-foreground px-4 py-10 text-center">Loading sample units...</div>;
  }

  if (results.length === 0) {
    return (
      <div className="text-sm text-muted-foreground px-4 py-10 text-center">
        No sample-unit data for this runway in {selectedYear}.
      </div>
    );
  }

  const colSpan = 13 + (showShiftedOnly ? 3 : 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="panel-label">
          Sample units &mdash; likelihood variant <span className="text-foreground">{SOURCE_LABEL[likelihoodSource]}</span>
        </h3>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={zoneFilter} onValueChange={(v) => setZoneFilter(v as "all" | Zone)}>
            <SelectTrigger className="h-8 w-28 text-xs">
              <SelectValue placeholder="Zone" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All zones</SelectItem>
              <SelectItem value="ujung">End</SelectItem>
              <SelectItem value="tengah">Middle</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={String(degreeFilter)}
            onValueChange={(v) => setDegreeFilter(v === "all" ? "all" : Number(v))}
          >
            <SelectTrigger className="h-8 w-32 text-xs">
              <SelectValue placeholder="Degree" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All degrees</SelectItem>
              {RISK_BANDS.map((b) => (
                <SelectItem key={b.degree} value={String(b.degree)}>
                  Degree {b.degree}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={rateFilter} onValueChange={(v) => setRateFilter(v as "all" | ObservedRateClass)}>
            <SelectTrigger className="h-8 w-40 text-xs">
              <SelectValue placeholder="Rate" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All rates</SelectItem>
              {(Object.keys(RATE_LABELS) as ObservedRateClass[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {RATE_LABELS[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <button
            onClick={() => setHideDummyPci((v) => !v)}
            className={`h-8 px-3 rounded-md text-xs font-medium border transition-colors ${
              hideDummyPci
                ? "border-border text-foreground hover:bg-secondary"
                : "border-primary text-primary bg-primary/10"
            }`}
            title="Units whose PCI is a display filler, not a survey result - see section 0.6"
          >
            {hideDummyPci ? "Dummy PCI hidden" : "Dummy PCI shown"}
          </button>

          <button
            onClick={() => setShowShiftedOnly((v) => !v)}
            className={`h-8 px-3 rounded-md text-xs font-medium border transition-colors ${
              showShiftedOnly
                ? "border-primary text-primary bg-primary/10"
                : "border-border text-foreground hover:bg-secondary"
            }`}
            title="Only units whose degree, ICAO zone or DRU Urgency differ between variant A and variant B"
          >
            {showShiftedOnly ? `Shifted only (${shiftedCount})` : "Show shifted only"}
          </button>

          {selectedCell && (
            <button
              onClick={onClearCellFilter}
              className="h-8 px-3 rounded-md text-xs font-medium border border-primary text-primary bg-primary/10"
            >
              Cell {selectedCell} &middot; Clear
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
        {RISK_BANDS.map((b) => (
          <div key={b.degree} className="flex flex-col items-center gap-0.5 rounded-md border border-border py-2">
            <span className="font-mono text-lg font-bold tabular-nums" style={{ color: b.color }}>
              {degreeCounts[b.degree]}
            </span>
            <span className="text-[9px] uppercase tracking-wide text-muted-foreground">Deg {b.degree}</span>
          </div>
        ))}
        {(["ujung", "tengah"] as Zone[]).map((z) => (
          <div key={z} className="flex flex-col items-center gap-0.5 rounded-md border border-border py-2">
            <span className="font-mono text-lg font-bold tabular-nums text-foreground">{zoneCounts[z]}</span>
            <span className="text-[9px] uppercase tracking-wide text-muted-foreground">{ZONE_LABELS[z]}</span>
          </div>
        ))}
      </div>

      <div className="text-[11px] text-muted-foreground">
        {rows.length} of {results.length} units shown
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        <div className="overflow-x-auto overflow-y-auto max-h-[600px]">
          <Table>
            <TableHeader className="sticky top-0 bg-card z-10">
              <TableRow>
                <TableHead className="px-2">Unit</TableHead>
                <TableHead className="px-2">Station</TableHead>
                <TableHead className="px-2">Zone</TableHead>
                <TableHead className="px-2">TDV</TableHead>
                <TableHead className="px-2">Coverage</TableHead>
                <TableHead className="px-2">L</TableHead>
                <TableHead className="px-2">F</TableHead>
                <TableHead className="px-2">C</TableHead>
                <TableHead className="px-2">R</TableHead>
                <TableHead className="px-2">Degree</TableHead>
                <TableHead className="px-2">ICAO</TableHead>
                <TableHead className="px-2">Rate</TableHead>
                <TableHead className="px-2" title="Degree / Relevancy / Urgency (Anderson DRU)">
                  DRU
                </TableHead>
                {showShiftedOnly && (
                  <>
                    <TableHead className="px-2 whitespace-nowrap">Degree A&rarr;B</TableHead>
                    <TableHead className="px-2 whitespace-nowrap">Zone A&rarr;B</TableHead>
                    <TableHead className="px-2 whitespace-nowrap">Urgency A&rarr;B</TableHead>
                  </>
                )}
                <TableHead className="px-2 w-8" aria-label="Trace" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const shift = shiftByUnit.get(r.unitNumber);
                return (
                  <TableRow key={r.unitNumber} className={!r.pciIsReal ? "opacity-60" : undefined}>
                    <TableCell className="px-2 py-1 font-mono text-xs">
                      <span className="inline-flex items-center gap-1">
                        {r.unitNumber}
                        {!r.astmConsistent && (
                          <span title="ASTM D5340 self-consistency violation: max single deduct exceeds (100 - PCI) - see the data-quality guard in risk-unit-adapter.ts">
                            <AlertTriangle size={11} className="text-destructive shrink-0" aria-label="ASTM inconsistent" />
                          </span>
                        )}
                        {likelihoodSource === "tdv" && r.likelihoodClassGap >= 2 && (
                          <span
                            title={`Likelihood reads ${r.likelihoodClassGap} step(s) heavier than this unit's own ASTM condition class (${r.astmConditionClass}) would suggest - see section 3.5`}
                          >
                            <ShieldAlert size={11} className="text-primary shrink-0" aria-label="Likelihood/PCI class gap" />
                          </span>
                        )}
                        {!r.pciIsReal && (
                          <span
                            className="text-[8px] px-1 py-0.5 rounded-full bg-secondary text-muted-foreground uppercase tracking-wide"
                            title="Display-filler PCI, not a survey result"
                          >
                            dummy
                          </span>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="px-2 py-1 font-mono text-xs tabular-nums">{r.stationKm.toFixed(2)}</TableCell>
                    <TableCell className="px-2 py-1 text-xs">{ZONE_LABELS[r.zone]}</TableCell>
                    <TableCell className="px-2 py-1 font-mono text-xs tabular-nums">{r.tdv.toFixed(2)}</TableCell>
                    <TableCell className="px-2 py-1 font-mono text-xs tabular-nums">{r.coveragePct.toFixed(3)}%</TableCell>
                    <TableCell className="px-2 py-1 font-mono text-xs tabular-nums">{r.likelihood}</TableCell>
                    <TableCell className="px-2 py-1 font-mono text-xs tabular-nums">{r.frequency}</TableCell>
                    <TableCell className="px-2 py-1 font-mono text-xs tabular-nums">{r.consequence}</TableCell>
                    <TableCell className="px-2 py-1 font-mono text-xs font-semibold tabular-nums">
                      {r.riskScore.toFixed(1)}
                    </TableCell>
                    <TableCell className="px-2 py-1">
                      <span
                        className="inline-flex items-center justify-center w-6 h-6 rounded text-[11px] font-bold font-mono"
                        style={{ backgroundColor: r.band.color, color: "#fff" }}
                      >
                        {r.band.degree}
                      </span>
                    </TableCell>
                    <TableCell className="px-2 py-1">
                      <span
                        className="inline-flex items-center px-2 h-6 rounded text-[11px] font-bold font-mono whitespace-nowrap"
                        style={{ backgroundColor: r.icao.zoneColor, color: "#fff" }}
                        title={r.icao.zone}
                      >
                        {r.icao.cell}
                      </span>
                    </TableCell>
                    <TableCell className="px-2 py-1">
                      <span
                        className="text-[11px] font-medium whitespace-nowrap"
                        style={{ color: RATE_COLORS[r.observedRateClass] }}
                        title={r.deltaPci !== undefined ? `dPCI ${r.deltaPci.toFixed(1)}` : undefined}
                      >
                        {RATE_LABELS[r.observedRateClass]}
                      </span>
                    </TableCell>
                    <TableCell
                      className="px-2 py-1 font-mono text-xs whitespace-nowrap"
                      title={`Relevancy ${r.dru.relevancy}, Urgency ${r.dru.urgency}, Extent ${r.dru.extentPct.toFixed(1)}% (${r.dru.druCell})`}
                    >
                      {r.dru.degree}/{r.dru.relevancy}/{r.dru.urgency}
                    </TableCell>
                    {showShiftedOnly && shift && (
                      <>
                        <TableCell className="px-2 py-1 font-mono text-xs whitespace-nowrap">
                          {shift.degreeA} &rarr; {shift.degreeB}
                          {shift.degreeGap >= 2 && (
                            <span title="Degree shift of 2 or more - often a data-quality signal, not just a variant difference (section 3.6)">
                              {" "}
                              <ShieldAlert size={10} className="inline text-destructive" aria-label="Large shift" />
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="px-2 py-1 text-xs whitespace-nowrap">
                          {shift.zoneA} &rarr; {shift.zoneB}
                        </TableCell>
                        <TableCell className="px-2 py-1 font-mono text-xs whitespace-nowrap">
                          {shift.urgencyA} &rarr; {shift.urgencyB}
                        </TableCell>
                      </>
                    )}
                    <TableCell className="px-2 py-1">
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            className="p-1 rounded-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                            title="Show how this unit was scored"
                            aria-label={`Show trace for unit ${r.unitNumber}`}
                          >
                            <Info size={14} />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-96 text-xs" align="end">
                          <p className="font-condensed font-semibold uppercase tracking-wide text-[11px] text-muted-foreground mb-2">
                            Unit {r.unitNumber} - trace
                          </p>
                          <div className="flex items-center gap-3 mb-2 text-[11px]">
                            <span className={likelihoodSource === "tdv" ? "text-foreground font-semibold" : "text-muted-foreground"}>
                              L (TDV, A) {r.likelihoodTdv}
                              {likelihoodSource === "tdv" && " ← used"}
                            </span>
                            <span className={likelihoodSource === "pci" ? "text-foreground font-semibold" : "text-muted-foreground"}>
                              L (PCI, B) {r.likelihoodPci ?? "n/a"}
                              {likelihoodSource === "pci" && " ← used"}
                            </span>
                          </div>
                          <ul className="space-y-1.5">
                            {r.trace.map((line, i) => (
                              <li key={i} className="text-foreground/90 leading-snug">
                                {line}
                              </li>
                            ))}
                          </ul>
                          <div className="mt-2.5 pt-2.5 border-t border-border">
                            <p className="font-condensed font-semibold uppercase tracking-wide text-[10px] text-muted-foreground mb-1.5">
                              DRU
                            </p>
                            <ul className="space-y-1">
                              {r.dru.trace.map((line, i) => (
                                <li key={i} className="text-foreground/90 leading-snug">
                                  {line}
                                </li>
                              ))}
                            </ul>
                          </div>
                        </PopoverContent>
                      </Popover>
                    </TableCell>
                  </TableRow>
                );
              })}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={colSpan} className="text-center text-muted-foreground py-8">
                    No units match your filter.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
