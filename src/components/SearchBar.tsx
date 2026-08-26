import { Search, X } from "lucide-react";
import { useState, useMemo, useRef, useEffect } from "react";
import type { SectionData } from "@/lib/pci-utils";
import { getPCICategory, parsePCIValue, isNotSurveyed } from "@/lib/pci-utils";
import { Kbd } from "@/components/ui/kbd";

interface SearchBarProps {
  sections: SectionData[];
  onSelect: (section: SectionData) => void;
  selectedSection: SectionData | null;
}

export default function SearchBar({ sections, onSelect, selectedSection }: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // "/" focuses search from anywhere, matching the on-field key hint below —
  // skipped when the user is already typing into some other field.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "/") return;
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const filtered = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return sections.filter(
      (s) =>
        s.Section.toLowerCase().includes(q) ||
        s.Type.toLowerCase().includes(q) ||
        s.PCN.toLowerCase().includes(q)
    );
  }, [query, sections]);

  const handleSelect = (section: SectionData) => {
    onSelect(section);
    setQuery("");
    setFocused(false);
  };

  // Single cap, no sm: tier: flex-1 + min-w-0 already do the real adaptive
  // sizing (shrinking to whatever room the title/tabs leave at any width),
  // and Tailwind's sm: breakpoint (640px, fixed) doesn't track this app's
  // own narrow-viewport threshold (800px, see NARROW_BREAKPOINT in
  // Home.tsx) - two uncoordinated breakpoints here previously fought each
  // other in the 640-800px range.
  return (
    <div className="relative flex-1 min-w-0 max-w-[180px]">
      <div
        className={`flex items-center gap-2.5 bg-background border border-border rounded-md h-8 px-3 transition-colors ${
          focused ? "border-primary/50 ring-1 ring-primary/30 bg-card" : ""
        }`}
      >
        <Search size={15} className="text-muted-foreground flex-shrink-0" />
        <input
          ref={inputRef}
          type="text"
          placeholder="Search…"
          aria-label="Search branch or PCN"
          role="combobox"
          aria-expanded={focused}
          aria-haspopup="listbox"
          aria-controls="search-results-listbox"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setFocused(false);
          }}
          className="bg-transparent border-none outline-none text-foreground text-sm placeholder:text-muted-foreground w-full min-w-0"
        />
        {query ? (
          <button
            onClick={() => setQuery("")}
            aria-label="Clear search"
            className="p-2 -m-2 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-sm"
          >
            <X size={14} />
          </button>
        ) : (
          !focused && (
            <Kbd className="font-mono shrink-0 border border-border/60" aria-hidden>
              /
            </Kbd>
          )
        )}
      </div>

      {/* Dropdown */}
      {focused && (query.trim() ? true : sections.length > 0) && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setFocused(false)} />
          <div
            id="search-results-listbox"
            role="listbox"
            className="panel-surface absolute top-full left-0 right-0 mt-2 rounded-lg shadow-2xl z-40 max-h-72 overflow-y-auto custom-scrollbar"
          >
            {query.trim() && filtered.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">
                No branches match &quot;{query.trim()}&quot;
              </p>
            ) : (
              (query.trim() ? filtered : sections).map((section) => {
                const pci = parsePCIValue(section["PCI Rating"]);
                const cat = getPCICategory(pci);
                const isActive = selectedSection?.Section === section.Section;
                return (
                  <button
                    key={section.Section}
                    onClick={() => handleSelect(section)}
                    role="option"
                    aria-selected={isActive}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors border-b border-border/60 last:border-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${
                      isActive
                        ? "bg-primary/15 shadow-[inset_3px_0_0_0_hsl(var(--primary))]"
                        : "hover:bg-secondary/60"
                    }`}
                  >
                    <div
                      className={`pci-swatch w-8 h-8 rounded-md flex items-center justify-center text-xs font-bold font-mono tabular-nums flex-shrink-0 ${
                        isNotSurveyed(cat) ? "pci-swatch--not-surveyed" : ""
                      }`}
                      style={isNotSurveyed(cat) ? undefined : { backgroundColor: cat.color, color: cat.textColor }}
                    >
                      {isNotSurveyed(cat) ? "—" : section["PCI Rating"]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-foreground text-sm font-medium font-mono truncate">
                        {section.Section}
                      </div>
                      <div className="text-muted-foreground text-[11px] truncate">
                        {section.Type} · PCN <span className="font-mono">{section.PCN}</span>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}
