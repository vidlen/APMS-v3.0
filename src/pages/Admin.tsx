import { useState } from "react";
import { Navigate, Link } from "react-router";
import { Plane, ArrowLeft } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useData } from "@/lib/data-store";
import { useNarrowViewport } from "@/hooks/useNarrowViewport";
import YearManager from "@/components/admin/YearManager";
import SectionEditorTable from "@/components/admin/SectionEditorTable";
import SampleUnitTable from "@/components/admin/SampleUnitTable";
import ImportExportPanel from "@/components/admin/ImportExportPanel";
import RepairLogPanel from "@/components/admin/RepairLogPanel";

type AdminTab = "pci" | "risk";

// shortLabel keeps both tabs on one line on narrow viewports - see the same
// fix on Home.tsx's WORKSPACE_TABS for why (full labels overflowed a 375px
// tab bar with no scroll affordance).
const ADMIN_TABS: { id: AdminTab; label: string; shortLabel: string }[] = [
  { id: "pci", label: "Pavement Condition Index (PCI)", shortLabel: "PCI" },
  { id: "risk", label: "Risk Management", shortLabel: "Risk" },
];

export default function Admin() {
  const { isAdmin, authReady } = useAuth();
  const { years } = useData();
  const isNarrow = useNarrowViewport();
  const [selectedYear, setSelectedYear] = useState<string>(() => years[0]?.id ?? "2025");
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AdminTab>("pci");

  if (!authReady) return null;
  if (!isAdmin) return <Navigate to="/" replace />;

  const handleSelectYear = (year: string) => {
    setSelectedYear(year);
    setExpandedSection(null);
  };

  return (
    <div className="flex flex-col w-full h-screen h-dvh bg-background overflow-hidden">
      <header className="shrink-0 flex items-center gap-4 min-h-16 px-4 pt-[env(safe-area-inset-top)] bg-card border-b border-border shadow-sm z-30">
        <Link
          to="/"
          state={{ fromAdmin: true }}
          className="flex items-center gap-2 p-2 -m-2 rounded-md text-muted-foreground hover:text-foreground transition-colors text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <ArrowLeft size={15} />
          Back to map
        </Link>
        <div className="w-px h-6 bg-border" />
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-md bg-primary flex items-center justify-center shrink-0">
            <Plane size={17} className="text-primary-foreground" />
          </div>
          <div className="leading-tight min-w-0">
            <h1 className="text-foreground text-sm font-bold leading-tight truncate">
              Admin — PCI Survey Data
            </h1>
            <p className="text-muted-foreground text-[11px] leading-tight truncate">
              Airport Pavement Management System
            </p>
          </div>
        </div>
      </header>

      {/* Admin tabs — same tablist pattern as the main workspace tabs
          (src/pages/Home.tsx), so each area gets its own screen instead of
          one long stack. Year selection stays outside the tabs since every
          tab below reads the same selectedYear. */}
      <div
        className="shrink-0 flex items-center justify-center gap-4 bg-card border-b border-border z-20 px-4"
        role="tablist"
      >
        <div className={`flex items-center overflow-x-auto ${isNarrow ? "gap-5" : "gap-[30px]"}`}>
          {ADMIN_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              aria-selected={activeTab === tab.id}
              role="tab"
              className={`shrink-0 py-2.5 font-condensed text-[12.5px] font-semibold tracking-[.13em] uppercase border-b-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${
                activeTab === tab.id
                  ? "text-foreground border-b-primary"
                  : "text-muted-foreground border-b-transparent hover:text-foreground"
              }`}
            >
              {isNarrow ? tab.shortLabel : tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
        <div className="max-w-4xl mx-auto space-y-6">
          <YearManager selectedYear={selectedYear} onSelectYear={handleSelectYear} />

          {activeTab === "pci" && (
            <>
              <div className="panel-surface rounded-lg overflow-hidden">
                <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                  <h2 className="text-sm font-bold text-foreground">
                    Section PCI — {selectedYear}
                  </h2>
                </div>
                <SectionEditorTable year={selectedYear} onEditUnits={setExpandedSection} />
              </div>

              {expandedSection && (
                <SampleUnitTable
                  year={selectedYear}
                  section={expandedSection}
                  onClose={() => setExpandedSection(null)}
                />
              )}

              <ImportExportPanel year={selectedYear} />
            </>
          )}

          {activeTab === "risk" && <RepairLogPanel year={selectedYear} />}
        </div>
      </div>
    </div>
  );
}
