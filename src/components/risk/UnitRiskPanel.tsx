import { useMemo, useState } from "react";
import { Info, Wrench } from "lucide-react";
import type { SurveyYear } from "@/lib/survey-years";
import { type UnitRiskResult, type Zone } from "@/lib/risk-unit";
import type { ObservedRateClass } from "@/lib/observed-rate";
import { RISK_BANDS } from "@/config/riskScales";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface UnitRiskPanelProps {
  selectedYear: SurveyYear;
  results: UnitRiskResult[];
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

export default function UnitRiskPanel({
  selectedYear,
  results,
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

  const rows = useMemo(
    () =>
      results.filter((r) => {
        if (hideDummyPci && !r.pciIsReal) return false;
        if (zoneFilter !== "all" && r.zone !== zoneFilter) return false;
        if (degreeFilter !== "all" && r.band.degree !== degreeFilter) return false;
        if (rateFilter !== "all" && r.observedRateClass !== rateFilter) return false;
        if (selectedCell && r.icao.cell !== selectedCell) return false;
        return true;
      }),
    [results, hideDummyPci, zoneFilter, degreeFilter, rateFilter, selectedCell],
  );

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

  return (
    <div className="flex flex-col gap-4">
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
                <TableHead className="px-2">Index</TableHead>
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
                <TableHead className="px-2 w-8" aria-label="Trace" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.unitNumber} className={!r.pciIsReal ? "opacity-60" : undefined}>
                  <TableCell className="px-2 py-1 font-mono text-xs">
                    <span className="inline-flex items-center gap-1">
                      {r.unitNumber}
                      {r.excludedFromRate && (
                        <span title="Repaired since previous survey - excluded from the observed-rate class">
                          <Wrench size={11} className="text-primary shrink-0" aria-label="Repaired since previous survey" />
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
                  <TableCell className="px-2 py-1 font-mono text-xs tabular-nums">{r.distressIndex}</TableCell>
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
                    title={`Relevancy ${r.dru.relevancy}, Urgency ${r.dru.urgency}, Extent ${r.dru.extentPct.toFixed(1)}%`}
                  >
                    {r.dru.degree}/{r.dru.relevancy}/{r.dru.urgency}
                  </TableCell>
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
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={13} className="text-center text-muted-foreground py-8">
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
