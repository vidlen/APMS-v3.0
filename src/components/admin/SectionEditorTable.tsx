import type { KeyboardEvent } from "react";
import { toast } from "sonner";
import { usePavementData } from "@/hooks/usePavementData";
import { useData, useSectionsWithUnits } from "@/lib/data-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import SectionInventoryDialog from "./SectionInventoryDialog";

interface SectionEditorTableProps {
  year: string;
  onEditUnits: (section: string) => void;
}

function saveOnEnter(e: KeyboardEvent<HTMLInputElement>) {
  if (e.key === "Enter") e.currentTarget.blur();
}

export default function SectionEditorTable({ year, onEditUnits }: SectionEditorTableProps) {
  const { sections, loading } = usePavementData(year);
  const sectionsWithUnits = useSectionsWithUnits(year);
  const { overrides, setSectionPci, setSectionInventory } = useData();
  const inventoryOverrides = overrides.sectionInventory[year] ?? {};

  const handleSave = (section: string, raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const num = Number(trimmed);
    if (Number.isNaN(num) || num < 0 || num > 100) {
      toast.error("PCI must be a number between 0 and 100");
      return;
    }
    setSectionPci(year, section, trimmed);
    toast.success(`Updated ${section}`);
  };

  const handleSaveType = (section: string, raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    setSectionInventory(year, section, { Type: trimmed });
    toast.success(`Updated ${section}`);
  };

  const handleSavePcn = (section: string, raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    setSectionInventory(year, section, { PCN: trimmed });
    toast.success(`Updated ${section}`);
  };

  if (loading) {
    return <p className="text-muted-foreground text-sm px-4 py-6">Loading…</p>;
  }

  if (sections.length === 0) {
    return (
      <p className="text-muted-foreground text-sm px-4 py-6">
        No data for {year} yet — import a GeoJSON or clone another year from Survey Years to get
        started.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Section</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>PCN</TableHead>
          <TableHead className="text-right">PCI</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="w-32" />
          <TableHead className="w-28" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {sections.map((s) => {
          const hasUnits = sectionsWithUnits.includes(s.Section);
          return (
            <TableRow key={s.Section}>
              <TableCell className="font-medium text-foreground">{s.Section}</TableCell>
              <TableCell>
                <Input
                  key={`${year}-${s.Section}-type-${s.Type}`}
                  defaultValue={s.Type}
                  className="h-8 w-32"
                  onBlur={(e) => handleSaveType(s.Section, e.target.value)}
                  onKeyDown={saveOnEnter}
                />
              </TableCell>
              <TableCell>
                <Input
                  key={`${year}-${s.Section}-pcn-${s.PCN}`}
                  defaultValue={s.PCN}
                  className="h-8 w-28 font-mono text-xs"
                  onBlur={(e) => handleSavePcn(s.Section, e.target.value)}
                  onKeyDown={saveOnEnter}
                />
              </TableCell>
              <TableCell className="text-right">
                {hasUnits ? (
                  <span
                    className="tabular-nums text-muted-foreground"
                    title="Computed from sample-unit scores"
                  >
                    {s["PCI Rating"] ?? "—"}
                  </span>
                ) : (
                  <Input
                    key={`${year}-${s.Section}-${s["PCI Rating"] ?? ""}`}
                    defaultValue={s["PCI Rating"] ?? ""}
                    placeholder="—"
                    className="h-8 w-20 ml-auto text-right tabular-nums"
                    onBlur={(e) => handleSave(s.Section, e.target.value)}
                    onKeyDown={saveOnEnter}
                  />
                )}
              </TableCell>
              <TableCell>
                <span className="text-xs text-muted-foreground">
                  {s["PCI Rating"] !== undefined ? "Surveyed" : "Not surveyed"}
                </span>
              </TableCell>
              <TableCell>
                <SectionInventoryDialog
                  section={s.Section}
                  current={{
                    dimension: s.Dimension ?? "",
                    lastMajorConstructionYear: s["Last Major Construction Year"] ?? "",
                  }}
                  override={inventoryOverrides[s.Section]}
                  onSave={(patch) => setSectionInventory(year, s.Section, patch)}
                  onClear={() => setSectionInventory(year, s.Section, {
                    Dimension: undefined,
                    "Last Major Construction Year": undefined,
                  })}
                />
              </TableCell>
              <TableCell>
                {hasUnits && (
                  <Button variant="ghost" size="sm" onClick={() => onEditUnits(s.Section)}>
                    Edit units
                  </Button>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
