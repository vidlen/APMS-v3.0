import { BarChart3, ChevronUp } from "lucide-react";
import { pciCategories, NOT_SURVEYED } from "@/lib/pci-utils";

interface LegendProps {
  activeBands: Set<string>;
  onToggleBand: (label: string) => void;
  onClearBands: () => void;
  bandCounts?: Record<string, number>;
  onExpand: () => void;
  onEmptyClick: () => void;
}

export default function Legend({
  activeBands,
  onToggleBand,
  onClearBands,
  bandCounts,
  onExpand,
  onEmptyClick,
}: LegendProps) {
  const filtering = activeBands.size > 0;
  return (
    <div className="px-5 py-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <BarChart3 size={14} className="text-muted-foreground" />
          <h2 className="panel-label">PCI Rating</h2>
        </div>
        <div className="flex items-center gap-3">
          {filtering && (
            <button
              onClick={onClearBands}
              className="text-[11px] text-primary hover:text-primary/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-sm"
            >
              Clear filter
            </button>
          )}
          <button
            onClick={onExpand}
            aria-label="Expand as floating panel"
            className="p-1 -m-1 text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-sm shrink-0"
          >
            <ChevronUp size={13} />
          </button>
        </div>
      </div>
      <div className="space-y-1">
        {pciCategories
          .slice()
          .reverse()
          .map((cat) => {
            const count = bandCounts?.[cat.label];
            const isEmpty = count === 0;
            const isActive = activeBands.has(cat.label);
            const isDimmed = filtering && !isActive;
            return (
              <button
                key={cat.min}
                onClick={() => (isEmpty ? onEmptyClick() : onToggleBand(cat.label))}
                title={
                  isEmpty
                    ? `No sections in the ${cat.label} range`
                    : `Show only ${cat.label} sections on the map`
                }
                className={`w-full flex items-center gap-3.5 py-1.5 px-1.5 -mx-1.5 rounded-md text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  isActive
                    ? "bg-primary/10 ring-1 ring-primary/30"
                    : "hover:bg-secondary/60"
                } ${isDimmed && !isEmpty ? "opacity-45" : ""}`}
              >
                <span
                  className="pci-swatch w-4 h-4 rounded-[5px] shrink-0"
                  style={{ backgroundColor: cat.color }}
                />
                <span className="text-sm text-muted-foreground flex items-baseline gap-2">
                  <span className="font-mono tabular-nums inline-block w-[54px] shrink-0 whitespace-nowrap">
                    {cat.min}-{cat.max}
                  </span>
                  <span className="font-medium text-foreground">{cat.label}</span>
                </span>
              </button>
            );
          })}
      </div>

      <div className="my-3 border-t border-dashed border-border" />
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-1.5">
        Outside PCI scale
      </p>
      <div
        aria-disabled
        title="Branches with no PCI survey on record"
        className="w-full flex items-center gap-3.5 py-1.5 px-1.5 -mx-1.5 rounded-md"
      >
        <span className="pci-swatch pci-swatch--not-surveyed w-4 h-4 rounded-[5px] shrink-0" />
        <span className="text-sm text-muted-foreground flex items-baseline gap-2">
          <span className="font-mono tabular-nums inline-block w-[54px] shrink-0 whitespace-nowrap">
            —
          </span>
          <span className="font-medium text-foreground">{NOT_SURVEYED.label}</span>
          {bandCounts?.[NOT_SURVEYED.label] !== undefined && (
            <span className="font-mono tabular-nums text-muted-foreground">
              {bandCounts[NOT_SURVEYED.label]}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}
