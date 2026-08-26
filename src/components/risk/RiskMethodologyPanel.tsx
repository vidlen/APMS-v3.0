import { useState } from "react";
import { BookOpen, ChevronDown } from "lucide-react";
import { DOMINANT_DISTRESS_METRIC } from "@/config/riskScales";

const METRIC_LABEL: Record<string, string> = {
  count: "record count",
  area: "affected area",
  severity_area: "severity x area",
};

// Section 8 (riskScales.ts) read out as prose rather than as a second
// bibliography - the citations themselves live as comments in the config
// files, this panel is the "why" a defence would actually be asked about.
export default function RiskMethodologyPanel() {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 px-5 py-4 text-left hover:bg-secondary/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
      >
        <span className="flex items-center gap-2">
          <BookOpen size={14} className="text-muted-foreground shrink-0" />
          <span className="panel-label">Methodology &amp; literature</span>
        </span>
        <ChevronDown
          size={14}
          className={`text-muted-foreground shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-5 text-xs text-muted-foreground leading-relaxed">
          <p>
            Likelihood comes from the Markov/PCI forecast tiers (<code className="font-mono">risk.ts</code>).
            Frequency comes from operational role. Consequence comes from distress types recorded in
            the airport&apos;s own repair log - 678 dated records over 2025-08-30 to 2026-02-26 - mapped to
            failure modes following Pasindu (2011) and weighted by severity and extent, the closest
            analogue available to an ASTM D5340 deduct value when none is recorded.
          </p>

          <div>
            <p className="text-foreground font-semibold text-[11px] uppercase tracking-wide mb-2">
              Three limits, stated rather than buried
            </p>
            <ul className="space-y-2 list-disc pl-4">
              <li>
                Coverage stops at 31 of 75 branches. The log&apos;s own header reads &quot;Unit: North
                Runway&quot;, so the remaining branches are a scope boundary in the source data, not a
                fault in the join - see the coverage panel above for which of the 44 have no repair
                recorded versus which are outright outside the log&apos;s scope.
              </li>
              <li>
                Severity weighting is linear (<code className="font-mono">SEVERITY_WEIGHT</code>: RINGAN
                1, SEDANG 2, BERAT 3) while ASTM D5340 deduct curves are not. Extent x severity is a
                stand-in for a deduct value the log does not carry, not a claim that the relationship is
                actually linear.
              </li>
              <li>
                The three candidate ranking metrics - count, area, severity x area - disagree on which
                distress dominates a branch, and on the hazard class that follows from it, for 5 of the
                31 covered branches. <code className="font-mono">DOMINANT_DISTRESS_METRIC</code> (currently{" "}
                <span className="text-foreground font-medium">{METRIC_LABEL[DOMINANT_DISTRESS_METRIC]}</span>) is
                a stated modelling decision for exactly that reason, not a default nobody chose.
              </li>
            </ul>
          </div>

          <div>
            <p className="text-foreground font-semibold text-[11px] uppercase tracking-wide mb-2">
              What Pasindu&apos;s model does not reproduce here
            </p>
            <p>
              Pasindu (2011) computes hydroplaning speed and braking distance from a finite-element
              tire-fluid-pavement simulation driven by rut depth, pavement texture depth, cross slope
              and aircraft landing-weight distributions. APMS records none of those measurements, so
              that computation cannot run on this network. What transfers from his work is the
              framing - grouping distresses by the failure mode they drive on aircraft operations
              rather than by pavement-engineering family (see the hazard-class comments in{" "}
              <code className="font-mono">riskScales.ts</code>) - not his numbers.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
