import { useMemo, useState } from "react";
import { Search, ArrowUp, ArrowDown, ArrowUpDown, X } from "lucide-react";
import type { SectionData } from "@/lib/pci-utils";
import { parsePCIValue, getPCICategory, isNotSurveyed } from "@/lib/pci-utils";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface SectionsTableProps {
  sections: SectionData[];
  activeBands: Set<string>;
  onClearBands: () => void;
  selectedSection: SectionData | null;
  onSelect: (section: SectionData) => void;
  onClose: () => void;
}

type SortKey = "Section" | "Type" | "PCN" | "PCI" | "Condition";
type SortDir = "asc" | "desc";

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "Section", label: "Section" },
  { key: "Type", label: "Type" },
  { key: "PCN", label: "PCN" },
  { key: "PCI", label: "PCI" },
  { key: "Condition", label: "Condition" },
];

export default function SectionsTable({
  sections,
  activeBands,
  onClearBands,
  selectedSection,
  onSelect,
  onClose,
}: SectionsTableProps) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("Section");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = sections.filter((s) => {
      if (
        q &&
        !(
          s.Section.toLowerCase().includes(q) ||
          s.Type.toLowerCase().includes(q) ||
          s.PCN.toLowerCase().includes(q)
        )
      )
        return false;
      if (activeBands.size > 0) {
        const label = getPCICategory(parsePCIValue(s["PCI Rating"])).label;
        if (!activeBands.has(label)) return false;
      }
      return true;
    });

    const dir = sortDir === "asc" ? 1 : -1;
    return filtered.slice().sort((a, b) => {
      if (sortKey === "PCI" || sortKey === "Condition") {
        const pa = parsePCIValue(a["PCI Rating"]);
        const pb = parsePCIValue(b["PCI Rating"]);
        // Unsurveyed always sinks to the bottom, in both directions: it is
        // not a low value and not a high value, so it must not travel with
        // the sort direction.
        if (pa === null && pb === null) return a.Section.localeCompare(b.Section);
        if (pa === null) return 1;
        if (pb === null) return -1;
        if (sortKey === "Condition") {
          const la = getPCICategory(pa).label;
          const lb = getPCICategory(pb).label;
          return la.localeCompare(lb) * dir;
        }
        return (pa - pb) * dir;
      }
      return String(a[sortKey]).localeCompare(String(b[sortKey])) * dir;
    });
  }, [sections, query, activeBands, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-10 bg-card border-b border-border px-4 py-3 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-foreground">
            All Sections{" "}
            <span className="text-muted-foreground font-normal">
              ({rows.length}
              {rows.length !== sections.length ? ` of ${sections.length}` : ""})
            </span>
          </h2>
          <button
            onClick={onClose}
            aria-label="Close table view"
            className="p-1.5 -m-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            title="Close table view"
          >
            <X size={16} />
          </button>
        </div>
        <div className="relative">
          <Search
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter sections..."
            className="h-8 pl-7 text-xs"
          />
        </div>
        {activeBands.size > 0 && (
          <div className="flex items-center flex-wrap gap-1.5">
            <span className="text-[11px] text-muted-foreground">Filtered:</span>
            {[...activeBands].map((b) => (
              <span
                key={b}
                className="text-[11px] px-2 py-0.5 rounded-full bg-primary/15 text-primary font-medium"
              >
                {b}
              </span>
            ))}
            <button
              onClick={onClearBands}
              className="text-[11px] text-primary hover:text-primary/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-sm"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            {COLUMNS.map((col) => (
              <TableHead
                key={col.key}
                className="px-1.5"
                aria-sort={
                  sortKey === col.key ? (sortDir === "asc" ? "ascending" : "descending") : "none"
                }
              >
                <button
                  onClick={() => handleSort(col.key)}
                  className="flex items-center gap-1 h-full w-full text-[11px] font-bold uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-sm"
                >
                  {col.label}
                  {sortKey === col.key ? (
                    sortDir === "asc" ? (
                      <ArrowUp size={11} />
                    ) : (
                      <ArrowDown size={11} />
                    )
                  ) : (
                    <ArrowUpDown size={11} className="opacity-30" />
                  )}
                </button>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((section) => {
            const pci = parsePCIValue(section["PCI Rating"]);
            const cat = getPCICategory(pci);
            const isActive = selectedSection?.Section === section.Section;
            return (
              <TableRow
                key={section.Section}
                onClick={() => {
                  onSelect(section);
                  onClose();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(section);
                    onClose();
                  }
                }}
                tabIndex={0}
                role="button"
                aria-label={`View details for ${section.Section}`}
                className={`cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${isActive ? "bg-primary/10 shadow-[inset_3px_0_0_0_hsl(var(--primary))]" : ""}`}
              >
                <TableCell className="p-1.5 font-medium font-mono text-xs text-foreground">
                  {section.Section}
                </TableCell>
                <TableCell className="p-1.5 text-xs text-muted-foreground">{section.Type}</TableCell>
                <TableCell className="p-1.5 font-mono text-xs text-muted-foreground">
                  {section.PCN}
                </TableCell>
                <TableCell className="p-1.5">
                  {isNotSurveyed(cat) ? (
                    <span className="pci-swatch pci-swatch--not-surveyed inline-flex items-center justify-center min-w-9 px-1.5 h-6 rounded text-xs font-bold">
                      —
                    </span>
                  ) : (
                    <span
                      className="pci-swatch inline-flex items-center justify-center min-w-9 px-1.5 h-6 rounded text-xs font-bold font-mono tabular-nums"
                      style={{ backgroundColor: cat.color, color: cat.textColor }}
                    >
                      {section["PCI Rating"]}
                    </span>
                  )}
                </TableCell>
                <TableCell className="p-1.5 text-xs text-muted-foreground">{cat.label}</TableCell>
              </TableRow>
            );
          })}
          {rows.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={COLUMNS.length}
                className="text-center text-muted-foreground py-8 whitespace-normal"
              >
                No sections match your filters.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
