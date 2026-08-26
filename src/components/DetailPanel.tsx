import { X, BarChart3, Layers, Grid3x3, Pencil, AlertTriangle } from "lucide-react";
import { getPCICategory, parsePCIValue, isNotSurveyed, pciCategories, type SectionData } from "@/lib/pci-utils";
import PciScalePanel from "@/components/PciScalePanel";
import {
  describePCNPart,
  PCN_PAVEMENT_TYPE,
  PCN_SUBGRADE_CATEGORY,
  PCN_TIRE_PRESSURE,
  PCN_EVALUATION_METHOD,
} from "@/lib/pcn-utils";
import { parseConstructionYear, parseDimension } from "@/lib/section-meta-utils";
import type { SampleUnitDistress } from "@/lib/sample-units";
import { useSectionsWithUnits, useEffectiveYearData, useData } from "@/lib/data-store";
import { useAuth } from "@/lib/auth";
import { useEffect, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

interface DetailPanelProps {
  section: SectionData;
  selectedYear: string;
  onClose: () => void;
  onViewDetails?: (sectionName: string) => void;
  isDetailedView?: boolean;
  panelDocked: boolean;
  onTogglePanelDock: () => void;
  activeBands: Set<string>;
  onToggleBand: (label: string) => void;
  bandCounts?: Record<string, number>;
  onEmptyClick: () => void;
}

function saveOnEnter(e: ReactKeyboardEvent<HTMLInputElement>) {
  if (e.key === "Enter") e.currentTarget.blur();
}

export default function DetailPanel({
  section,
  selectedYear,
  onClose,
  onViewDetails,
  isDetailedView,
  panelDocked,
  onTogglePanelDock,
  activeBands,
  onToggleBand,
  bandCounts,
  onEmptyClick,
}: DetailPanelProps) {
  // Close on escape key
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  const { isAdmin } = useAuth();
  const { setSectionPci, setUnitScore } = useData();
  const sectionsWithUnits = useSectionsWithUnits(selectedYear);
  const hasSampleUnits = sectionsWithUnits.includes(section.Section);
  const isUnitDetail = section.sampleUnit !== undefined;

  // Always read the PCI from the live store rather than the (possibly
  // stale) selected-section snapshot, so an admin edit reflects here
  // immediately without needing to re-select the section on the map.
  const { sectionsFC, unitsBySection } = useEffectiveYearData(selectedYear);
  let livePciStr: string | undefined = section["PCI Rating"];
  // Left undefined (rather than defaulted to []) when the underlying data has
  // no distress field at all, so the panel can tell "not surveyed for this
  // runway/year" apart from "surveyed, zero distress found" and hide the
  // section entirely in the former case instead of implying a clean unit.
  let distresses: SampleUnitDistress[] | undefined;
  if (isUnitDetail) {
    const unitFeature = unitsBySection[section.Section]?.features.find(
      (f) => f.properties["sampleUnit"] === section.sampleUnit
    );
    if (unitFeature) {
      const score = unitFeature.properties["pci_score"] as number;
      livePciStr = Number.isInteger(score) ? String(score) : score.toFixed(2);
      distresses = unitFeature.properties["distresses"] as SampleUnitDistress[] | undefined;
    }
  } else {
    const sectionFeature = sectionsFC?.features.find(
      (f) => f.properties["Section"] === section.Section
    );
    if (sectionFeature) {
      livePciStr = sectionFeature.properties["PCI Rating"] as string | undefined;
    }
  }

  const pciValue = parsePCIValue(livePciStr);
  const category = getPCICategory(pciValue);
  const notSurveyed = isNotSurveyed(category);

  const constructionYear = section["Last Major Construction Year"]
    ? parseConstructionYear(section["Last Major Construction Year"])
    : null;
  const dimension = section.Dimension ? parseDimension(section.Dimension) : null;

  // Parse PCN code (e.g., "111/R/D/W/T") and decode the standardized
  // letter categories into their ICAO Annex 14 meanings.
  const pcnParts = section.PCN.split("/");
  const pcnNumeric = pcnParts[0] || "—";
  const pcnType = pcnParts[1] || "—";
  const pcnSubgrade = pcnParts[2] || "—";
  const pcnTire = pcnParts[3] || "—";
  const pcnMethod = pcnParts[4] || "—";

  const pcnTypeMeaning = describePCNPart(PCN_PAVEMENT_TYPE, pcnType);
  const pcnSubgradeMeaning = describePCNPart(PCN_SUBGRADE_CATEGORY, pcnSubgrade);
  const pcnTireMeaning = describePCNPart(PCN_TIRE_PRESSURE, pcnTire);
  const pcnMethodMeaning = describePCNPart(PCN_EVALUATION_METHOD, pcnMethod);

  // PCI is directly editable for a sample unit, or for a section with no
  // sample units of its own — sections backed by units always show a
  // computed average and are edited via their units instead.
  const canEditPci = isAdmin && (isUnitDetail || !hasSampleUnits);

  const handleSavePci = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      if (isUnitDetail) {
        toast.error("A sample unit score cannot be cleared");
        return;
      }
      setSectionPci(selectedYear, section.Section, undefined);
      toast.success("PCI cleared");
      return;
    }
    const num = Number(trimmed);
    if (Number.isNaN(num) || num < 0 || num > 100) {
      toast.error("PCI must be a number between 0 and 100");
      return;
    }
    if (isUnitDetail && section.sampleUnit !== undefined) {
      setUnitScore(selectedYear, section.Section, section.sampleUnit, num);
    } else {
      setSectionPci(selectedYear, section.Section, trimmed);
    }
    toast.success("PCI updated");
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header — the one signature moment: designator set large in the
          condensed signage face (safe at this size, unlike small labels
          elsewhere), PCI in large mono beside it. The swatch is the only
          fill in the whole panel now — everything below is hairline rules. */}
      <div className="flex items-center justify-between gap-3 px-5 py-5 border-b border-border">
        <div className="flex items-center gap-4 min-w-0">
          <div
            className={`pci-swatch w-[54px] h-[54px] rounded-md flex items-center justify-center text-xl font-bold font-mono tabular-nums shrink-0 ${
              notSurveyed ? "pci-swatch--not-surveyed" : ""
            }`}
            style={notSurveyed ? undefined : { backgroundColor: category.color, color: category.textColor }}
          >
            {pciValue === null ? "—" : Math.round(pciValue)}
          </div>
          <div className="min-w-0">
            <h2 className="text-foreground font-condensed font-semibold text-[27px] uppercase tracking-[.05em] leading-none truncate">
              {section.Section}
              {section.sampleUnit !== undefined && (
                <span className="text-primary"> · {section.sampleUnit}</span>
              )}
            </h2>
            <p className="text-muted-foreground text-xs mt-2">
              {section.sampleUnit !== undefined ? "Sample Unit Details" : "Branch Detail"}
              {" · "}
              {category.label}
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close panel"
          className="w-8 h-8 rounded-md bg-secondary hover:bg-border/60 flex items-center justify-center text-muted-foreground hover:text-foreground transition-all shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <X size={16} />
        </button>
      </div>

      {hasSampleUnits && onViewDetails && (
        <div className="px-5 pt-3">
          <button
            onClick={() => onViewDetails(section.Section)}
            className={`w-full flex items-center justify-center gap-1.5 h-8 px-3 rounded-md border text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              isDetailedView
                ? "bg-primary/10 border-primary/40 text-primary hover:bg-primary/15"
                : "bg-secondary border-border text-muted-foreground hover:bg-border/40 hover:text-foreground"
            }`}
            title={
              isDetailedView
                ? "Return to section overview"
                : "Show per sample-unit PCI"
            }
          >
            <Grid3x3 size={13} />
            <span>{isDetailedView ? "Hide Details" : "See Section Details"}</span>
          </button>
        </div>
      )}

      {/* Content — hairline-divided sections, not filled cards. The PCI and
          scale swatches are the only fills left in the panel; that's the
          thesis: color is a measurement, so it's the only thing that fills. */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar px-5">
        {/* PCI Rating */}
        <section className="py-5">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 size={14} className="text-muted-foreground" />
            <h3 className="panel-label">PCI Rating</h3>
            {canEditPci && <Pencil size={11} className="text-primary" />}
          </div>

          <div className="flex items-end gap-3 mb-3">
            {canEditPci ? (
              <Input
                key={`${selectedYear}-${section.Section}-${section.sampleUnit ?? ""}-${livePciStr}`}
                defaultValue={livePciStr}
                type="number"
                min={0}
                max={100}
                step="0.1"
                className="h-11 w-28 text-3xl font-bold font-mono tabular-nums px-2"
                onBlur={(e) => handleSavePci(e.target.value)}
                onKeyDown={saveOnEnter}
              />
            ) : (
              <span className="text-3xl font-bold font-mono text-foreground tabular-nums">
                {livePciStr ?? "—"}
              </span>
            )}
            <span
              className={`text-xs font-medium px-2.5 py-1 rounded-full mb-1.5 ${
                notSurveyed ? "pci-swatch--not-surveyed" : ""
              }`}
              style={notSurveyed ? undefined : { backgroundColor: category.color, color: category.textColor }}
            >
              {notSurveyed ? "Not surveyed" : category.label}
            </span>
          </div>

          {/* PCI Bar */}
          <div className="mt-4">
            <div className="h-2 bg-border/60 rounded-full overflow-hidden flex">
              {pciCategories.map((cat) => (
                <div
                  key={cat.min}
                  className="h-full transition-all"
                  style={{
                    width: `${cat.max - cat.min}%`,
                    backgroundColor: cat.color,
                  }}
                />
              ))}
            </div>
            <div className="flex justify-between mt-1.5">
              <span className="text-[11px] text-muted-foreground font-mono tabular-nums">0</span>
              <span className="text-[11px] text-muted-foreground font-mono tabular-nums">100</span>
            </div>

            {/* PCI Marker — omitted when unsurveyed, since there is no
                position on the 0-100 scale to point at. */}
            {pciValue !== null && (
              <div
                className="relative h-4 -mt-5"
                style={{ left: `${pciValue}%`, transform: "translateX(-50%)" }}
              >
                <div className="w-0 h-0 border-l-[5px] border-r-[5px] border-t-[6px] border-l-transparent border-r-transparent border-t-foreground absolute top-0 left-1/2 -translate-x-1/2" />
              </div>
            )}
          </div>

          {notSurveyed && (
            <p className="text-muted-foreground text-xs mt-3">
              No PCI survey on record for this branch.
            </p>
          )}
        </section>

        {/* Distress Details — per sample-unit only; sections without
            distress-level data (other runways, other years) leave
            `distresses` undefined and this simply doesn't render. */}
        {isUnitDetail && distresses !== undefined && (
          <section className="py-5 border-t border-border">
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle size={14} className="text-muted-foreground" />
              <h3 className="panel-label">Distress Details</h3>
            </div>

            {distresses.length === 0 ? (
              <p className="text-muted-foreground text-sm">No distress recorded for this sample unit.</p>
            ) : (
              <div className="rounded-md border border-border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Severity</TableHead>
                      <TableHead className="text-right">Quantity</TableHead>
                      <TableHead className="text-right">Deduct</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {distresses.map((d, i) => (
                      <TableRow key={i}>
                        <TableCell className="whitespace-normal text-foreground font-medium text-sm align-top">
                          {d.type}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs align-top">{d.severity}</TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground align-top whitespace-nowrap">
                          {d.quantity} {d.quantityUnits}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground align-top">
                          {d.deduct}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>
        )}

        {/* Last Major Construction — branch-level fact, not per sample-unit */}
        {!isUnitDetail && constructionYear && (
          <section className="py-5 border-t border-border">
            <h3 className="panel-label mb-3">Last Major Construction</h3>
            <div className="flex items-baseline gap-2">
              <span className="text-foreground text-2xl font-bold font-mono tabular-nums">
                {constructionYear.year}
              </span>
              {constructionYear.caption && (
                <span className="text-muted-foreground text-sm">{constructionYear.caption}</span>
              )}
            </div>
          </section>
        )}

        {/* Dimension — branch-level fact, not per sample-unit */}
        {!isUnitDetail && dimension && (
          <section className="py-5 border-t border-border">
            <h3 className="panel-label mb-4">Dimension</h3>
            {dimension.kind === "linear" ? (
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md border border-border px-3 py-2.5 flex flex-col items-center justify-center gap-0.5">
                  <div className="text-[11px] text-muted-foreground/70 uppercase tracking-wider font-semibold leading-none">
                    Length
                  </div>
                  <div className="text-foreground font-bold text-base font-mono leading-none tabular-nums">
                    {dimension.length} m
                  </div>
                </div>
                <div className="rounded-md border border-border px-3 py-2.5 flex flex-col items-center justify-center gap-0.5">
                  <div className="text-[11px] text-muted-foreground/70 uppercase tracking-wider font-semibold leading-none">
                    Width
                  </div>
                  <div className="text-foreground font-bold text-base font-mono leading-none tabular-nums">
                    {dimension.width} m
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-md border border-border px-3 py-2.5 flex flex-col items-center justify-center gap-0.5 max-w-[140px]">
                <div className="text-[11px] text-muted-foreground/70 uppercase tracking-wider font-semibold leading-none">
                  Area
                </div>
                <div className="text-foreground font-bold text-base font-mono leading-none tabular-nums">
                  {dimension.area.toLocaleString()} m²
                </div>
              </div>
            )}
          </section>
        )}

        {/* PCN Value */}
        <section className="py-5 border-t border-border">
          <h3 className="panel-label mb-4">PCN Value</h3>

          <div className="flex items-center gap-2 mb-4">
            <span className="text-base font-bold text-foreground font-mono tracking-wide tabular-nums">
              {section.PCN}
            </span>
          </div>

          {/* PCN Breakdown */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "Load", value: pcnNumeric, desc: "PCN Value", detail: "Reported pavement bearing strength" },
              { label: "Pavement", value: pcnType, desc: pcnTypeMeaning.label, detail: pcnTypeMeaning.description },
              { label: "Subgrade", value: pcnSubgrade, desc: pcnSubgradeMeaning.label, detail: pcnSubgradeMeaning.description },
              { label: "Tire", value: pcnTire, desc: pcnTireMeaning.label, detail: pcnTireMeaning.description },
              { label: "Method", value: pcnMethod, desc: pcnMethodMeaning.label, detail: pcnMethodMeaning.description },
            ].map((item) => (
              <div
                key={item.label}
                title={item.detail}
                className="rounded-md border border-border px-1.5 py-2.5 flex flex-col items-center justify-center gap-1 min-h-[88px]"
              >
                <div className="text-[10px] text-muted-foreground/70 uppercase tracking-wider font-semibold leading-none">
                  {item.label}
                </div>
                <div className="text-foreground font-bold text-base font-mono leading-none tabular-nums">
                  {item.value}
                </div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium leading-tight text-center">
                  {item.desc}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Type */}
        <section className="py-5 border-t border-border">
          <div className="flex items-center gap-2 mb-3">
            <Layers size={14} className="text-muted-foreground" />
            <h3 className="panel-label">Pavement Type</h3>
          </div>
          <p className="text-foreground text-base font-medium">{section.Type}</p>
        </section>

        {panelDocked && (
          <section className="py-5 border-t border-border">
            <PciScalePanel
              pciValue={pciValue}
              docked
              onToggleDock={onTogglePanelDock}
              activeBands={activeBands}
              onToggleBand={onToggleBand}
              bandCounts={bandCounts}
              onEmptyClick={onEmptyClick}
            />
          </section>
        )}
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-border shrink-0">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground/70 text-center">
          APMS — Soekarno-Hatta International Airport
        </p>
      </div>
    </div>
  );
}
