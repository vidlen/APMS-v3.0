import { useMemo } from "react";
import type { IcaoAssessment } from "@/lib/icao";
import { zoneFor } from "@/lib/icao";
import { LF_TO_ICAO_PROBABILITY, C_TO_ICAO_SEVERITY, ICAO_ZONES } from "@/config/icaoMatrix";

interface IcaoMatrixPanelProps {
  /** Only `icao` is read - any scored result works, branch- or unit-level. */
  results: { icao: IcaoAssessment }[];
  selectedCell: string | null;
  onSelectCell: (cell: string | null) => void;
}

// Rows top-to-bottom = probability 5 (Frequent) down to 1 (Extremely
// improbable); columns left-to-right = severity A (Catastrophic) through E
// (Negligible) - the conventional SMS risk-matrix orientation, worst corner
// at top-left.
const PROBABILITIES = [5, 4, 3, 2, 1] as const;
const SEVERITIES = ["A", "B", "C", "D", "E"] as const;

const PROBABILITY_LABELS = Object.fromEntries(
  LF_TO_ICAO_PROBABILITY.map((p) => [p.probability, p.label]),
) as Record<number, string>;
const SEVERITY_LABELS = Object.fromEntries(
  C_TO_ICAO_SEVERITY.map((s) => [s.severity, s.label]),
) as Record<string, string>;

export default function IcaoMatrixPanel({ results, selectedCell, onSelectCell }: IcaoMatrixPanelProps) {
  // Every cell's count, including the ones no branch currently occupies -
  // zoneFor (icao.ts) is the same function assessIcao uses, so a cell's
  // shading here can never disagree with what scoreBranch assigned it.
  const countByCell = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of results) counts[r.icao.cell] = (counts[r.icao.cell] ?? 0) + 1;
    return counts;
  }, [results]);

  const handleClick = (cell: string) => {
    onSelectCell(selectedCell === cell ? null : cell);
  };

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="bg-card border-b border-border px-4 py-3">
        <h3 className="panel-label">ICAO 5&times;5 matrix &mdash; probability &times; severity</h3>
        <p className="text-[11px] text-muted-foreground mt-1">
          Branch counts per cell. Click a cell to filter the register below to it.
        </p>
      </div>
      <div className="p-4 overflow-x-auto">
        <div
          className="grid gap-1 w-fit mx-auto"
          style={{ gridTemplateColumns: `auto repeat(${SEVERITIES.length}, minmax(64px, 1fr))` }}
        >
          {/* Corner + severity headers */}
          <div />
          {SEVERITIES.map((s) => (
            <div
              key={s}
              className="text-center text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground pb-1"
              title={SEVERITY_LABELS[s]}
            >
              {s}
            </div>
          ))}

          {/* Rows - a flat array of grid items (not nested per-row Fragments):
              this project's dev-only inspect-react Vite plugin instruments
              every named JSX element with a `code-path` prop, which
              React.Fragment rejects. flatMap sidesteps the need for a
              Fragment wrapper entirely. */}
          {PROBABILITIES.flatMap((p) => [
            <div
              key={`row-${p}`}
              className="flex items-center justify-end pr-2 text-[10.5px] font-semibold text-muted-foreground whitespace-nowrap"
              title={PROBABILITY_LABELS[p]}
            >
              {p}
            </div>,
            ...SEVERITIES.map((s) => {
              const cell = `${p}${s}`;
              const zone = zoneFor(cell);
              const count = countByCell[cell] ?? 0;
              const isSelected = selectedCell === cell;
              return (
                <button
                  key={cell}
                  onClick={() => handleClick(cell)}
                  title={`${cell}: probability ${PROBABILITY_LABELS[p]}, severity ${SEVERITY_LABELS[s]} - ${zone} - ${count} branch${count === 1 ? "" : "es"}`}
                  className={`pci-swatch aspect-square min-h-12 rounded flex flex-col items-center justify-center font-mono transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                    isSelected ? "ring-2 ring-offset-1 ring-foreground scale-[1.04]" : "hover:scale-[1.03]"
                  }`}
                  style={{ backgroundColor: ICAO_ZONES[zone].color, color: "#fff" }}
                >
                  <span className="text-[10px] font-semibold opacity-85">{cell}</span>
                  <span className="text-base font-bold tabular-nums leading-tight">{count}</span>
                </button>
              );
            }),
          ])}
        </div>
      </div>
    </div>
  );
}
