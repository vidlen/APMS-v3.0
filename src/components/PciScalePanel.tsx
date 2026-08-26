import { useRef } from "react";
import { GripVertical, ChevronDown, ChevronUp } from "lucide-react";
import { pciCategories, getPCICategory, isNotSurveyed, NOT_SURVEYED } from "@/lib/pci-utils";

interface PciScalePanelProps {
  /** undefined: no branch selected. null: a branch is selected but has no PCI survey. */
  pciValue?: number | null;
  docked: boolean;
  onToggleDock: () => void;
  pos?: { x: number; y: number } | null;
  onPosChange?: (pos: { x: number; y: number }) => void;
  activeBands: Set<string>;
  onToggleBand: (label: string) => void;
  bandCounts?: Record<string, number>;
  onEmptyClick: () => void;
}

export default function PciScalePanel({
  pciValue,
  docked,
  onToggleDock,
  pos,
  onPosChange,
  activeBands,
  onToggleBand,
  bandCounts,
  onEmptyClick,
}: PciScalePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const dragOrigin = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);

  const activeCategory = pciValue !== undefined ? getPCICategory(pciValue) : null;
  const isActiveNotSurveyed = activeCategory !== null && isNotSurveyed(activeCategory);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (docked) return;
    const panel = panelRef.current;
    const container = panel?.parentElement;
    if (!panel || !container) return;
    const panelRect = panel.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    dragOrigin.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: panelRect.left - containerRect.left,
      originY: panelRect.top - containerRect.top,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const drag = dragOrigin.current;
    const panel = panelRef.current;
    const container = panel?.parentElement;
    if (!drag || !panel || !container) return;
    const containerRect = container.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const x = Math.max(0, Math.min(drag.originX + (e.clientX - drag.startX), containerRect.width - panelRect.width));
    const y = Math.max(0, Math.min(drag.originY + (e.clientY - drag.startY), containerRect.height - panelRect.height));
    onPosChange?.({ x, y });
  };

  const handlePointerUp = () => {
    dragOrigin.current = null;
  };

  return (
    <div
      ref={panelRef}
      className={
        docked
          ? "w-full rounded-md border overflow-hidden bg-[rgba(13,15,18,0.58)] backdrop-blur-[14px]"
          : "absolute z-20 w-56 rounded-md border overflow-hidden bg-[rgba(13,15,18,0.58)] backdrop-blur-[14px]"
      }
      style={
        docked
          ? { borderColor: "rgba(140,152,166,.32)" }
          : {
              ...(pos ? { left: pos.x, top: pos.y } : { right: 12, top: 12 }),
              borderColor: "rgba(140,152,166,.32)",
              boxShadow: "0 8px 24px rgb(0 0 0 / 0.35)",
            }
      }
    >
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className={`flex items-center gap-2 px-2.5 h-8 select-none border-b border-white/10 ${
          docked ? "" : "cursor-grab active:cursor-grabbing"
        }`}
      >
        {!docked && <GripVertical size={13} className="text-muted-foreground shrink-0" />}
        <span className="flex-1 font-condensed text-[11px] font-semibold uppercase tracking-[.1em] text-muted-foreground truncate">
          PCI Rating
        </span>
        <button
          onClick={onToggleDock}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label={docked ? "Expand as floating panel" : "Collapse to sidebar"}
          className="p-1 -m-1 text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-sm shrink-0"
        >
          {docked ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
      </div>

      <div className="p-1.5 space-y-0.5">
        {pciCategories
          .slice()
          .reverse()
          .map((cat) => {
            const isEmpty = bandCounts?.[cat.label] === 0;
            const isCurrent = activeCategory !== null && cat.label === activeCategory.label;
            const isFiltered = activeBands.has(cat.label);
            const isActive = isCurrent || isFiltered;
            return (
              <button
                key={cat.min}
                onClick={() => (isEmpty ? onEmptyClick() : onToggleBand(cat.label))}
                title={
                  isEmpty
                    ? `No sections in the ${cat.label} range`
                    : `Show only ${cat.label} sections on the map`
                }
                className={`w-full flex items-center gap-2.5 px-2 py-1 rounded-sm text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  isActive ? "bg-white/10" : "hover:bg-white/5"
                }`}
              >
                <span
                  className="pci-swatch w-3.5 h-3.5 rounded-sm shrink-0"
                  style={{ backgroundColor: cat.color }}
                />
                <span className="font-mono text-[11px] tabular-nums text-muted-foreground w-[46px] shrink-0 whitespace-nowrap">
                  {cat.min}-{cat.max}
                </span>
                <span
                  className={`text-[11px] font-medium px-1.5 py-0.5 rounded ${isActive ? "" : "text-muted-foreground"}`}
                  style={isActive ? { backgroundColor: cat.color, color: cat.textColor } : undefined}
                >
                  {cat.label}
                </span>
              </button>
            );
          })}
        <div
          aria-disabled
          title="Branches with no PCI survey on record"
          className={`w-full flex items-center gap-2.5 px-2 py-1 rounded-sm text-left ${
            isActiveNotSurveyed ? "bg-white/10" : ""
          }`}
        >
          <span className="pci-swatch pci-swatch--not-surveyed w-3.5 h-3.5 rounded-sm shrink-0" />
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground w-[46px] shrink-0 whitespace-nowrap">
            —
          </span>
          <span
            className={`text-[11px] font-medium px-1.5 py-0.5 rounded ${isActiveNotSurveyed ? "" : "text-muted-foreground"}`}
            style={isActiveNotSurveyed ? { backgroundColor: NOT_SURVEYED.color, color: NOT_SURVEYED.textColor } : undefined}
          >
            {NOT_SURVEYED.label}
          </span>
        </div>
      </div>
    </div>
  );
}
