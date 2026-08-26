import { useState, useCallback, useEffect, useMemo } from "react";
import { useLocation } from "react-router";
import { Plane, ChevronLeft, ChevronRight, Construction } from "lucide-react";
import MapView from "@/components/MapView";
import DetailPanel from "@/components/DetailPanel";
import Legend from "@/components/Legend";
import SurveyYearSelector from "@/components/SurveyYearSelector";
import SearchBar from "@/components/SearchBar";
import StatsBar from "@/components/StatsBar";
import NeedsAttention from "@/components/NeedsAttention";
import SectionsTable from "@/components/SectionsTable";
import PciScalePanel from "@/components/PciScalePanel";
import AdminHeaderControl from "@/components/admin/AdminHeaderControl";
import RiskTab from "@/components/risk/RiskTab";
import { usePavementData } from "@/hooks/usePavementData";
import { usePciScalePanel } from "@/hooks/usePciScalePanel";
import { countByCondition, pciCategories, parsePCIValue, type SectionData } from "@/lib/pci-utils";
import type { SurveyYear } from "@/lib/survey-years";
import { useData, useRepairLog } from "@/lib/data-store";
import { aggregateRepairLog } from "@/lib/repair-log";

// Raised from 640 after measuring the actual content: the workspace tab
// bar's full labels alone need ~742px of scrollWidth (774px of viewport
// once its px-4 padding is counted) - 768 still left it scrollable with no
// affordance. 800 gives that a safety margin. 640 was "phone vs. not
// phone," not "does the desktop chrome actually fit."
// Keep in sync with src/hooks/useNarrowViewport.ts's copy of this constant.
const NARROW_BREAKPOINT = 800;
const MIN_LOADING_SCREEN_MS = 2000;

type WorkspaceTab = "pci" | "risk";

const WORKSPACE_TABS: { id: WorkspaceTab; label: string; shortLabel: string; placeholderCaption?: string }[] = [
  { id: "pci", label: "Pavement Condition Index (PCI)", shortLabel: "PCI" },
  {
    id: "risk",
    label: "Risk Management",
    shortLabel: "Risk",
    placeholderCaption: "No PCI survey data loaded for this year yet",
  },
];

function isNarrowViewport() {
  return typeof window !== "undefined" && window.innerWidth < NARROW_BREAKPOINT;
}

export default function Home() {
  const location = useLocation();
  // Returning from the admin page should land straight on the map — the
  // branded splash is only meant to smooth over the very first page load.
  const skipSplash = (location.state as { fromAdmin?: boolean } | null)?.fromAdmin === true;

  const [selectedYear, setSelectedYear] = useState<SurveyYear>("2025");
  const { sections, unitsBySection, loading, error } = usePavementData(selectedYear);
  const { years } = useData();
  const { records: repairLogRecords } = useRepairLog();
  // Aggregated against THIS year's branch set, not a fixed one - resolveBranch
  // only accepts a location match that exists in the currently loaded network
  // (repair-log.ts), so the aggregate has to be recomputed if the network ever
  // changes shape. sections is already stable across renders that don't
  // actually change the data (usePavementData memoizes it), so this only
  // recomputes when the year or the log itself changes.
  const repairLogAggregate = useMemo(() => {
    const knownBranches = new Set(sections.map((s) => s.Section));
    return aggregateRepairLog(repairLogRecords, knownBranches);
  }, [sections, repairLogRecords]);
  const [isNarrow, setIsNarrow] = useState(isNarrowViewport);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [selectedSection, setSelectedSection] = useState<SectionData | null>(null);
  const [detailedSection, setDetailedSection] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(isNarrowViewport);
  const [minSplashElapsed, setMinSplashElapsed] = useState(skipSplash);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("pci");
  const [hasLoadedOnce, setHasLoadedOnce] = useState(skipSplash);
  const [activeBands, setActiveBands] = useState<Set<string>>(new Set());
  const [showTable, setShowTable] = useState(false);
  const [noBranchNotice, setNoBranchNotice] = useState(false);
  const bandCounts = useMemo(() => countByCondition(sections), [sections]);
  const { docked: panelDocked, pos: panelPos, setDocked: setPanelDocked, setPos: setPanelPos } = usePciScalePanel();

  // Keep the branded splash on screen for a minimum window so it doesn't
  // just flash by when data loads quickly off localhost.
  useEffect(() => {
    if (skipSplash) return;
    const timer = setTimeout(() => setMinSplashElapsed(true), MIN_LOADING_SCREEN_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Only the very first data load should show the full branded splash —
  // switching survey years re-triggers `loading` too, but that should just
  // refresh the map/sidebar in place, not blow away the whole app shell.
  useEffect(() => {
    if (!loading) setHasLoadedOnce(true);
  }, [loading]);

  // Re-check viewport width once right after mount — the very first
  // synchronous read can race a just-applied viewport resize (seen with
  // automated/CDP-driven resizing) — then keep isNarrow in sync on
  // ordinary window resizes without fighting a manual sidebar toggle.
  useEffect(() => {
    const narrow = isNarrowViewport();
    setIsNarrow(narrow);
    setSidebarCollapsed(narrow);
    setViewportWidth(window.innerWidth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onResize = () => {
      setIsNarrow(isNarrowViewport());
      setViewportWidth(window.innerWidth);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const handleFeatureClick = useCallback((section: SectionData | null) => {
    setSelectedSection(section);
  }, []);

  const handleClosePanel = useCallback(() => {
    setSelectedSection(null);
    setDetailedSection(null);
  }, []);

  const handleToggleDetails = useCallback((sectionName: string) => {
    setDetailedSection((prev) => (prev === sectionName ? null : sectionName));
  }, []);

  const handleExitDetails = useCallback(() => {
    setDetailedSection(null);
  }, []);

  const handleToggleBand = useCallback((label: string) => {
    setActiveBands((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }, []);

  const handleClearBands = useCallback(() => {
    setActiveBands(new Set());
  }, []);

  const notifyNoBranch = useCallback(() => {
    setNoBranchNotice(true);
    window.setTimeout(() => setNoBranchNotice(false), 2000);
  }, []);

  // NeedsAttention's "+N more sections below Satisfactory" footer link — pre-
  // seeds the same activeBands/showTable state the Legend filter and table
  // view already use, rather than a second filtering mechanism.
  const handleShowBelowSatisfactory = useCallback(() => {
    const labels = pciCategories
      .filter(
        (c) => ["Fair", "Poor", "Very Poor", "Serious", "Failed"].includes(c.label) && bandCounts[c.label] > 0
      )
      .map((c) => c.label);
    setActiveBands(new Set(labels));
    setShowTable(true);
  }, [bandCounts]);

  // When leaving the per-sample-unit view, fall back to the parent
  // section's aggregate data if a sample unit was selected, so the panel
  // doesn't keep showing a single unit's PCI once the map is back to the
  // section-overview polygons.
  useEffect(() => {
    if (detailedSection === null && selectedSection?.sampleUnit !== undefined) {
      const parent = sections.find((s) => s.Section === selectedSection.Section);
      setSelectedSection(parent ?? null);
    }
  }, [detailedSection, selectedSection, sections]);

  if ((loading && !hasLoadedOnce) || !minSplashElapsed) {
    return (
      <div className="w-full h-screen h-dvh bg-background flex items-center justify-center px-6">
        <div className="flex flex-col items-center gap-10">
          <div className="flex flex-col items-center gap-7">
            <div className="flex items-center gap-8">
              <img
                src="/branding/ugm-logo.png"
                alt="Universitas Gadjah Mada"
                className="h-28 w-28 object-contain"
              />
              <img
                src="/branding/injourney-logo.webp"
                alt="InJourney Airports"
                className="h-28 w-28 object-contain"
              />
            </div>
            <img
              src="/branding/soekarno-hatta-wordmark.png"
              alt="Soekarno-Hatta International Airport, by InJourney Airports"
              className="h-20 w-auto object-contain"
            />
          </div>

          <div className="w-12 h-12 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full h-screen h-dvh bg-background flex items-center justify-center">
        <div className="text-center space-y-3 max-w-md px-6">
          <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
            <span className="text-destructive text-xl">!</span>
          </div>
          <p className="text-foreground font-medium">Failed to load data</p>
          <p className="text-muted-foreground text-sm">{error}</p>
        </div>
      </div>
    );
  }

  // Sample-unit detail is the one view with a wide distress table (Type,
  // Severity, Quantity, Deduct) — a little extra width there lets distress
  // names wrap onto 1-2 lines instead of many; every other view (map,
  // section-level detail, sections table) keeps its original width so the
  // map stays the dominant element on screen.
  const isSampleUnitDetail = !showTable && selectedSection?.sampleUnit !== undefined;
  // A literal "100%" here (instead of a resolved px number) never actually
  // reaches full width: the sidebar's `transition-all` animates `width` via
  // flex-basis, and animating a percentage through flex-basis resolution
  // gets stuck near 0 instead of settling at the target (verified: the
  // identical transition works correctly with a plain px number, as the
  // showTable/isSampleUnitDetail branches below already do).
  // Table view is sized to match a workspace tab's width (tabs are 3 equal
  // flex-1 columns spanning the full app width, so one tab = viewportWidth
  // / 3) — floored at 450, the minimum that fits all 5 columns (after
  // tightening column padding/font-size in SectionsTable) without a
  // horizontal scrollbar (verified natural width: 442px).
  const sidebarWidth = isNarrow
    ? viewportWidth
    : showTable
      ? Math.max(Math.round(viewportWidth / 3), 450)
      : isSampleUnitDetail
        ? 400
        : 320;
  const showPciData = years.find((y) => y.id === selectedYear)?.hasData ?? false;
  // On narrow viewports the sidebar spans the full viewport width, so
  // anchoring the toggle with `right: sidebarWidth` would push it off the
  // left edge of the screen entirely — dock it to the left edge instead.
  const toggleAtLeftEdge = isNarrow && !sidebarCollapsed;

  return (
    <div className="flex flex-col w-full h-screen h-dvh bg-background overflow-hidden">
      {/* Header */}
      <header className="shrink-0 flex items-center justify-between gap-4 min-h-[58px] px-4 pt-[env(safe-area-inset-top)] bg-card border-b border-border shadow-sm z-30">
        <div className="flex items-center gap-[18px] min-w-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-[30px] h-[30px] rounded-md bg-primary flex items-center justify-center shrink-0">
              <Plane size={15} className="text-primary-foreground" />
            </div>
            {/* Narrow viewports show the short real abbreviation instead of
                ellipsis-truncating the long name - the full title's own
                min-content width (even with truncate) still squeezed the
                search input on 375px screens down to an unusably ~40px, and
                a fixed pixel cap tight enough to fix that would have cut the
                full name off mid-word ("AIRPORT P…"). */}
            <div className="leading-tight shrink-0">
              <h1 className="text-foreground font-condensed text-[15.5px] font-semibold tracking-[.055em] uppercase leading-tight truncate">
                {isNarrow ? "APMS" : "Airport Pavement Management System"}
              </h1>
              {!isNarrow && (
                <p className="text-muted-foreground text-[9.5px] font-medium tracking-[.13em] uppercase leading-tight truncate">
                  Soekarno–Hatta International · CGK
                </p>
              )}
            </div>
          </div>

          <SearchBar
            sections={sections}
            onSelect={handleFeatureClick}
            selectedSection={selectedSection}
          />
        </div>

        <div className="flex items-center gap-3">
          {/* Narrow viewports carry title + search + admin already, so the
              selector moves into the sidebar there instead of squeezing
              SearchBar out — see the sidebar-top fallback below. Risk scores
              are computed per survey year (lastInspectionYear tracks it), so
              the Risk tab needs the same year switch as PCI. */}
          {(activeTab === "pci" || activeTab === "risk") && !isNarrow && (
            <SurveyYearSelector selectedYear={selectedYear} onYearChange={setSelectedYear} />
          )}

          <AdminHeaderControl />
        </div>
      </header>

      {/* Workspace tabs */}
      <div
        className="shrink-0 flex items-center justify-center gap-4 bg-card border-b border-border z-20 px-4"
        role="tablist"
      >
        <div className={`flex items-center overflow-x-auto ${isNarrow ? "gap-5" : "gap-[30px]"}`}>
          {WORKSPACE_TABS.map((tab) => (
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

      {/* Body: map + docked sidebar, or a placeholder for modules still in development */}
      {activeTab === "pci" ? (
        <div className="relative flex-1 flex min-h-0">
          {/* "No Branch Found" notice for clicking an empty PCI band —
              centered under the workspace tabs, shared by the Legend and
              PCI Rating panel since both can trigger it. */}
          {noBranchNotice && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-40 pointer-events-none">
              <div className="px-4 py-2 rounded-full bg-popover border border-border shadow-lg text-sm font-medium text-foreground">
                No Branch Found
              </div>
            </div>
          )}

          {/* Map */}
          <div className="relative flex-1 min-w-0">
            {showPciData ? (
              <>
                <MapView
                  key={selectedYear}
                  selectedYear={selectedYear}
                  onFeatureClick={handleFeatureClick}
                  selectedSection={selectedSection}
                  detailedSection={detailedSection}
                  onExitDetails={handleExitDetails}
                  activeBands={activeBands}
                  onClearBands={handleClearBands}
                />

                {/* Attribution overlay (sits on imagery, independent of app theme) */}
                <div className="absolute bottom-0 left-0 right-0 z-20 pointer-events-none">
                  <div className="flex justify-end px-3 pb-1">
                    <p className="text-[11px] text-white/80 [text-shadow:0_1px_3px_rgb(0_0_0_/_0.7)]">
                      Airport Pavement Management System
                    </p>
                  </div>
                </div>

                {/* Floating PCI scale reference — shown over the map by default;
                    collapsing it docks the same panel into the sidebar instead
                    (below Needs Attention in the overview, below Pavement Type
                    in branch/section detail — see those render sites below). */}
                {!panelDocked && (
                  <PciScalePanel
                    pciValue={selectedSection ? parsePCIValue(selectedSection["PCI Rating"]) : undefined}
                    docked={false}
                    onToggleDock={() => setPanelDocked(true)}
                    pos={panelPos}
                    onPosChange={setPanelPos}
                    activeBands={activeBands}
                    onToggleBand={handleToggleBand}
                    bandCounts={bandCounts}
                    onEmptyClick={notifyNoBranch}
                  />
                )}
              </>
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-background">
                <div className="text-center space-y-3 max-w-sm px-6">
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                    <Construction size={20} className="text-primary" />
                  </div>
                  <p className="text-foreground font-medium">{selectedYear} PCI Survey</p>
                  <p className="text-muted-foreground text-sm">
                    This Feature Is Closed Due To WIP
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Sidebar collapse toggle */}
          <button
            onClick={() => setSidebarCollapsed((v) => !v)}
            className={`absolute top-1/2 -translate-y-1/2 z-30 flex items-center justify-center w-6 h-12 bg-primary text-primary-foreground shadow-md hover:bg-primary/90 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:ring-primary ${
              toggleAtLeftEdge ? "rounded-r-md" : "rounded-l-md"
            }`}
            style={toggleAtLeftEdge ? { left: 0 } : { right: sidebarCollapsed ? 0 : sidebarWidth }}
            title={sidebarCollapsed ? "Show panel" : "Hide panel"}
            aria-label={sidebarCollapsed ? "Show panel" : "Hide panel"}
          >
            {sidebarCollapsed ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
          </button>

          {/* Docked sidebar. No width transition: animating this width via
              flex-basis gets the flex layout stuck at the starting value
              instead of settling at the target — verified with both the
              mobile full-width open and the desktop 320->520 table-view
              resize (same widths, no transition, both render correctly).
              Width changes snap instead. */}
          <aside
            className="relative shrink-0 bg-card border-l border-border overflow-hidden"
            style={{ width: sidebarCollapsed ? 0 : sidebarWidth }}
          >
            <div
              className="h-full overflow-y-auto custom-scrollbar pb-[env(safe-area-inset-bottom)]"
              style={{ width: sidebarWidth }}
            >
              {/* Narrow-viewport fallback for the year selector — rendered
                  above the swappable panels below so it still survives
                  section selection and the table view. */}
              {isNarrow && (
                <div className="px-5 py-3 border-b border-border">
                  <SurveyYearSelector selectedYear={selectedYear} onYearChange={setSelectedYear} />
                </div>
              )}

              {showTable && showPciData ? (
                <SectionsTable
                  sections={sections}
                  activeBands={activeBands}
                  onClearBands={handleClearBands}
                  selectedSection={selectedSection}
                  onSelect={handleFeatureClick}
                  onClose={() => setShowTable(false)}
                />
              ) : selectedSection && showPciData ? (
                <DetailPanel
                  section={selectedSection}
                  selectedYear={selectedYear}
                  onClose={handleClosePanel}
                  onViewDetails={handleToggleDetails}
                  isDetailedView={detailedSection === selectedSection.Section}
                  panelDocked={panelDocked}
                  onTogglePanelDock={() => setPanelDocked(false)}
                  activeBands={activeBands}
                  onToggleBand={handleToggleBand}
                  bandCounts={bandCounts}
                  onEmptyClick={notifyNoBranch}
                />
              ) : (
                <>
                  {showPciData && (
                    <StatsBar sections={sections} onOpenTable={() => setShowTable(true)} />
                  )}
                  {showPciData && (
                    <NeedsAttention
                      sections={sections}
                      onSelect={handleFeatureClick}
                      onShowBelowSatisfactory={handleShowBelowSatisfactory}
                    />
                  )}
                  {/* The floating panel over the map is the default PCI
                      reference; this docks in its place only once it's
                      been collapsed, so the two never show at once. */}
                  {panelDocked && (
                    <Legend
                      activeBands={activeBands}
                      onToggleBand={handleToggleBand}
                      onClearBands={handleClearBands}
                      bandCounts={bandCounts}
                      onEmptyClick={notifyNoBranch}
                      onExpand={() => setPanelDocked(false)}
                    />
                  )}
                </>
              )}
            </div>
          </aside>
        </div>
      ) : activeTab === "risk" && showPciData ? (
        <div className="relative flex-1 min-h-0 overflow-y-auto bg-background">
          <RiskTab
            sections={sections}
            selectedYear={selectedYear}
            unitsBySection={unitsBySection}
            repairLogByBranch={repairLogAggregate.byBranch}
            repairLogStats={repairLogAggregate.stats}
          />
        </div>
      ) : (
        <div className="relative flex-1 flex items-center justify-center min-h-0 bg-background">
          <div className="text-center space-y-3 max-w-sm px-6">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
              <Construction size={20} className="text-primary" />
            </div>
            <p className="text-foreground font-medium">
              {WORKSPACE_TABS.find((tab) => tab.id === activeTab)?.label}
            </p>
            <p className="text-muted-foreground text-sm">
              {WORKSPACE_TABS.find((tab) => tab.id === activeTab)?.placeholderCaption}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
