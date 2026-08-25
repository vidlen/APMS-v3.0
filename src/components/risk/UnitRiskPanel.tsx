import { useMemo, useState } from "react";
import { Info, Wrench } from "lucide-react";
import { usePavementData } from "@/hooks/usePavementData";
import type { SurveyYear } from "@/lib/survey-years";
import { toUnitRiskInputs } from "@/lib/risk-unit-adapter";
import { scoreUnits, type UnitRiskResult, type Zone } from "@/lib/risk-unit";
import type { ObservedRateClass } from "@/lib/observed-rate";
import { RISK_BANDS } from "@/config/riskScales";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

interface UnitRiskPanelProps {
  selectedYear: SurveyYear;
}

// Metode B only has real per-unit distress + PCI for these two branches
// (metode-b-spec_4.md section 0.6) - every other branch has no sample-unit
// collection to score at all, so the panel is scoped to a choice between them.
const RUNWAY_OPTIONS: { id: string; label: string }[] = [
  { id: "06/24", label: "RWY 06/24" },
  { id: "07L/25R", label: "RWY 07L/25R" },
];

const ZONE_LABELS: Record<Zone, string> = { ujung: "Ujung", tengah: "Tengah" };

const RATE_LABELS: Record<ObservedRateClass, string> = {
  stabil: "Stabil",
  memburuk: "Memburuk",
  memburuk_cepat: "Memburuk cepat",
  tidak_terdefinisi: "Tidak terdefinisi",
};

const RATE_COLORS: Record<ObservedRateClass, string> = {
  stabil: "#16a34a",
  memburuk: "#f59e0b",
  memburuk_cepat: "#dc2626",
  tidak_terdefinisi: "#6b7280",
};

export default function UnitRiskPanel({ selectedYear }: UnitRiskPanelProps) {
  const [branchId, setBranchId] = useState<string>(RUNWAY_OPTIONS[0].id);
  const [zoneFilter, setZoneFilter] = useState<"all" | Zone>("all");
  const [degreeFilter, setDegreeFilter] = useState<"all" | number>("all");
  const [rateFilter, setRateFilter] = useState<"all" | ObservedRateClass>("all");
  // Section 0.6.2: dummy-PCI rows must be clearly marked AND filterable out -
  // defaults to hidden since a thesis-facing table should default to real data.
  const [hideDummyPci, setHideDummyPci] = useState(true);

  const previousYear = String(Number(selectedYear) - 1);
  const { unitsBySection, loading } = usePavementData(selectedYear);
  const { unitsBySection: previousUnitsBySection } = usePavementData(previousYear);

  const results: UnitRiskResult[] = useMemo(() => {
    const currentFc = unitsBySection[branchId];
    if (!currentFc) return [];
    const previousFc = previousUnitsBySection[branchId];
    const inputs = toUnitRiskInputs(branchId, "runway", Number(selectedYear), currentFc, previousFc);
    return scoreUnits(inputs);
  }, [branchId, selectedYear, unitsBySection, previousUnitsBySection]);

  const rows = useMemo(
    () =>
      results.filter((r) => {
        if (hideDummyPci && !r.pciIsReal) return false;
        if (zoneFilter !== "all" && r.zone !== zoneFilter) return false;
        if (degreeFilter !== "all" && r.band.degree !== degreeFilter) return false;
        if (rateFilter !== "all" && r.observedRateClass !== rateFilter) return false;
        return true;
      }),
    [results, hideDummyPci, zoneFilter, degreeFilter, rateFilter],
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
        No sample-unit data for {branchId} in {selectedYear}.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ToggleGroup type="single" variant="outline" size="sm" value={branchId} onValueChange={(v) => v && setBranchId(v)}>
          {RUNWAY_OPTIONS.map((r) => (
            <ToggleGroupItem key={r.id} value={r.id}>
              {r.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        <div className="flex flex-wrap items-center gap-2">
          <Select value={zoneFilter} onValueChange={(v) => setZoneFilter(v as "all" | Zone)}>
            <SelectTrigger className="h-8 w-28 text-xs">
              <SelectValue placeholder="Zona" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua zona</SelectItem>
              <SelectItem value="ujung">Ujung</SelectItem>
              <SelectItem value="tengah">Tengah</SelectItem>
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
              <SelectItem value="all">Semua degree</SelectItem>
              {RISK_BANDS.map((b) => (
                <SelectItem key={b.degree} value={String(b.degree)}>
                  Degree {b.degree}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={rateFilter} onValueChange={(v) => setRateFilter(v as "all" | ObservedRateClass)}>
            <SelectTrigger className="h-8 w-40 text-xs">
              <SelectValue placeholder="Laju" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua laju</SelectItem>
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
            title="Unit dengan PCI pengisi tampilan (bukan hasil survei) - lihat bagian 0.6"
          >
            {hideDummyPci ? "Dummy PCI disembunyikan" : "Dummy PCI ditampilkan"}
          </button>
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
        {rows.length} dari {results.length} unit ditampilkan
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        <div className="overflow-x-auto overflow-y-auto max-h-[600px]">
          <Table>
            <TableHeader className="sticky top-0 bg-card z-10">
              <TableRow>
                <TableHead className="px-2">Unit</TableHead>
                <TableHead className="px-2">Stasiun</TableHead>
                <TableHead className="px-2">Zona</TableHead>
                <TableHead className="px-2">Indeks</TableHead>
                <TableHead className="px-2">L</TableHead>
                <TableHead className="px-2">F</TableHead>
                <TableHead className="px-2">C</TableHead>
                <TableHead className="px-2">R</TableHead>
                <TableHead className="px-2">Degree</TableHead>
                <TableHead className="px-2">ICAO</TableHead>
                <TableHead className="px-2">Laju</TableHead>
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
                        <span title="Diperbaiki sejak survei sebelumnya - dikecualikan dari kelas laju">
                          <Wrench size={11} className="text-primary shrink-0" aria-label="Repaired since previous survey" />
                        </span>
                      )}
                      {!r.pciIsReal && (
                        <span
                          className="text-[8px] px-1 py-0.5 rounded-full bg-secondary text-muted-foreground uppercase tracking-wide"
                          title="PCI pengisi tampilan, bukan hasil survei"
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
                          title="Tampilkan cara unit ini dinilai"
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
                    Tidak ada unit yang cocok dengan penyaring.
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
