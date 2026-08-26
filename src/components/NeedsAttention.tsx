import { AlertTriangle, ChevronRight } from "lucide-react";
import type { SectionData } from "@/lib/pci-utils";
import { parsePCIValue, getPCICategory, pciCategories } from "@/lib/pci-utils";

interface NeedsAttentionProps {
  sections: SectionData[];
  onSelect: (section: SectionData) => void;
  onShowBelowSatisfactory: () => void;
}

const MAX_ITEMS = 5;

// A section "needs attention" once it falls below Satisfactory — i.e. Fair
// or worse on the same 7-band scale used everywhere else in the app.
const OK_LABELS = new Set(["Satisfactory", "Good"]);

export default function NeedsAttention({ sections, onSelect, onShowBelowSatisfactory }: NeedsAttentionProps) {
  const scored = sections.map((section) => ({ section, pci: parsePCIValue(section["PCI Rating"]) }));

  // Not Surveyed branches are excluded from the ranked list (decision 1) -
  // filtered explicitly rather than relying on OK_LABELS, which would let
  // them THROUGH (their category label is neither Satisfactory nor Good).
  const notSurveyedCount = scored.filter((s) => s.pci === null).length;

  const flagged = scored
    .filter((s): s is { section: SectionData; pci: number } => s.pci !== null)
    .map((s) => ({ ...s, category: getPCICategory(s.pci) }))
    .filter((s) => !OK_LABELS.has(s.category.label))
    .sort((a, b) => a.pci - b.pci);

  // Read from the frozen ramp rather than hardcoding the hex.
  const poorColor = pciCategories.find((c) => c.label === "Poor")?.color;

  if (flagged.length === 0) {
    return (
      <div className="px-5 py-5 border-b border-border">
        <h2 className="panel-label mb-3 flex items-center gap-2">
          <AlertTriangle size={14} className="text-muted-foreground" />
          Needs attention
        </h2>
        <p className="text-muted-foreground text-xs">
          All surveyed sections are Satisfactory condition or better.
        </p>
        {notSurveyedCount > 0 && (
          <p className="text-muted-foreground/70 text-[11px] mt-1.5">
            {notSurveyedCount} branches not surveyed
          </p>
        )}
      </div>
    );
  }

  const shown = flagged.slice(0, MAX_ITEMS);
  const remaining = flagged.length - shown.length;

  return (
    <div className="px-5 py-5 border-b border-border">
      <div className="flex items-center justify-between mb-3">
        <h2 className="panel-label flex items-center gap-2">
          <AlertTriangle size={14} className="text-muted-foreground" style={poorColor ? { color: poorColor } : undefined} />
          Needs attention
        </h2>
        <span className="font-mono text-[11px] text-muted-foreground tabular-nums">{flagged.length}</span>
      </div>
      <div>
        {shown.map(({ section, pci, category }) => (
          <button
            key={section.Section}
            onClick={() => onSelect(section)}
            className="hairline-row w-full flex items-center gap-3 py-2 text-left transition-colors hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
          >
            <div
              className="pci-swatch w-10 h-7 rounded-md flex items-center justify-center text-[13px] font-bold font-mono tabular-nums shrink-0"
              style={{ backgroundColor: category.color, color: category.textColor }}
            >
              {Math.round(pci)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-foreground text-sm font-medium font-mono truncate">{section.Section}</div>
              <div className="text-muted-foreground text-[11px] truncate">
                {section.Type} · {category.label}
              </div>
            </div>
            <ChevronRight size={14} className="text-muted-foreground shrink-0" />
          </button>
        ))}
      </div>
      {remaining > 0 && (
        <button
          onClick={onShowBelowSatisfactory}
          className="w-full text-primary hover:text-primary/80 text-[11px] mt-2 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-sm"
        >
          +{remaining} more section{remaining === 1 ? "" : "s"} below {pciCategories.at(-2)?.label}
        </button>
      )}
      {notSurveyedCount > 0 && (
        <p className="text-muted-foreground/70 text-[11px] mt-2 text-center">
          {notSurveyedCount} branches not surveyed
        </p>
      )}
    </div>
  );
}
