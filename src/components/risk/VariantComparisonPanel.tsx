import { useMemo } from "react";
import type { UnitRiskResult } from "@/lib/risk-unit";
import { RISK_BANDS } from "@/config/riskScales";
import type { IcaoZoneName } from "@/config/icaoMatrix";
import type { DruUrgency } from "@/lib/dru";

interface VariantComparisonPanelProps {
  /** Both variants, scored over the SAME unit set regardless of which is active. */
  resultsA: UnitRiskResult[];
  resultsB: UnitRiskResult[];
}

const ZONES: IcaoZoneName[] = ["Intolerable", "Tolerable", "Acceptable"];
const URGENCIES: DruUrgency[] = [4, 3, 2, 1, "R"];

function countBy<T extends string | number>(results: UnitRiskResult[], key: (r: UnitRiskResult) => T): Map<T, number> {
  const counts = new Map<T, number>();
  for (const r of results) counts.set(key(r), (counts.get(key(r)) ?? 0) + 1);
  return counts;
}

function CompareRow({ label, a, b }: { label: string; a: number; b: number }) {
  const diff = a !== b;
  return (
    <div className="flex items-center justify-between gap-2 py-0.5 text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono tabular-nums ${diff ? "text-foreground font-semibold" : "text-muted-foreground"}`}>
        {a} <span className="text-muted-foreground/60">/</span> {b}
      </span>
    </div>
  );
}

// Section 9.2: renders BOTH likelihood variants side by side, independent of
// whichever one is currently driving the main table - this is what a reader
// actually uses to choose between them, so it has to be on screen rather than
// only in the thesis text.
export default function VariantComparisonPanel({ resultsA, resultsB }: VariantComparisonPanelProps) {
  const degreeA = useMemo(() => countBy(resultsA, (r) => r.band.degree), [resultsA]);
  const degreeB = useMemo(() => countBy(resultsB, (r) => r.band.degree), [resultsB]);
  const zoneA = useMemo(() => countBy(resultsA, (r) => r.icao.zone), [resultsA]);
  const zoneB = useMemo(() => countBy(resultsB, (r) => r.icao.zone), [resultsB]);
  const urgencyA = useMemo(() => countBy(resultsA, (r) => String(r.dru.urgency)), [resultsA]);
  const urgencyB = useMemo(() => countBy(resultsB, (r) => String(r.dru.urgency)), [resultsB]);

  const shifts = useMemo(() => {
    const bByUnit = new Map(resultsB.map((r) => [r.unitNumber, r]));
    let degree = 0,
      zone = 0,
      urgency = 0;
    for (const a of resultsA) {
      const b = bByUnit.get(a.unitNumber);
      if (!b) continue;
      if (a.band.degree !== b.band.degree) degree++;
      if (a.icao.zone !== b.icao.zone) zone++;
      if (a.dru.urgency !== b.dru.urgency) urgency++;
    }
    return { degree, zone, urgency };
  }, [resultsA, resultsB]);

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="bg-card border-b border-border px-4 py-3">
        <h3 className="panel-label">Variant comparison &mdash; A (TDV) vs. B (PCI), both always scored</h3>
        <p className="text-[11px] text-muted-foreground mt-1">Counts shown as A / B; bold where they differ.</p>
      </div>
      <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
            Fine-Kinney degree
          </p>
          {RISK_BANDS.map((band) => (
            <CompareRow key={band.degree} label={`Degree ${band.degree}`} a={degreeA.get(band.degree) ?? 0} b={degreeB.get(band.degree) ?? 0} />
          ))}
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">ICAO zone</p>
          {ZONES.map((zone) => (
            <CompareRow key={zone} label={zone} a={zoneA.get(zone) ?? 0} b={zoneB.get(zone) ?? 0} />
          ))}
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">DRU Urgency</p>
          {URGENCIES.map((u) => (
            <CompareRow key={String(u)} label={String(u)} a={urgencyA.get(String(u)) ?? 0} b={urgencyB.get(String(u)) ?? 0} />
          ))}
        </div>
      </div>
      <div className="px-4 pb-4 text-[11px] text-muted-foreground">
        <span className="font-mono font-semibold text-foreground">{shifts.degree}</span> unit(s) change degree,{" "}
        <span className="font-mono font-semibold text-foreground">{shifts.zone}</span> change zone,{" "}
        <span className="font-mono font-semibold text-foreground">{shifts.urgency}</span> change Urgency between the
        two variants.
      </div>
    </div>
  );
}
