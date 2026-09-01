import { useMemo, useState } from "react";
import { BookOpen, ChevronDown } from "lucide-react";
import type { UnitRiskResult } from "@/lib/risk-unit";
import type { LikelihoodSource } from "@/config/riskScales";
import { DRU_PROVENANCE } from "@/lib/dru";

interface RiskMethodologyPanelProps {
  results: UnitRiskResult[];
  likelihoodSource: LikelihoodSource;
}

const SOURCE_LABEL: Record<LikelihoodSource, string> = {
  tdv: "A - total ASTM deduct value (TDV)",
  pci: "B - unit PCI",
};

// Section 9 (metode-b-r1-spec.md) read out as prose rather than as a second
// bibliography - the citations themselves live as comments in the config
// files, this panel is the "why" a defence would actually be asked about.
export default function RiskMethodologyPanel({ results, likelihoodSource }: RiskMethodologyPanelProps) {
  const [open, setOpen] = useState(false);

  const undefinedRate = useMemo(() => {
    const units = results.filter((r) => r.observedRateClass === "tidak_terdefinisi");
    return { count: units.length, total: results.length };
  }, [results]);

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
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">
            Likelihood: {SOURCE_LABEL[likelihoodSource]}
          </span>
        </span>
        <ChevronDown
          size={14}
          className={`text-muted-foreground shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-5 text-xs text-muted-foreground leading-relaxed">
          <p>
            Likelihood comes from each sample unit&apos;s own ASTM D5340 distress records - either its total deduct
            value (variant A) or its own PCI read on the same condition-class boundaries (variant B), currently{" "}
            <span className="text-foreground font-medium">{SOURCE_LABEL[likelihoodSource]}</span>. Frequency comes
            from how much of the unit&apos;s own area a hazard covers, capped at the facility role&apos;s exposure
            ceiling. Consequence comes from the dominant distress&apos;s failure mode (fod / friction / structural /
            other) crossed with the facility role, escalated one step - never past 40 - when a non-patching distress
            on the unit is High severity. The operational verdict is the ICAO Doc 9859 zone, not the Fine-Kinney
            degree; DRU Urgency follows that same zone.
          </p>

          <div>
            <p className="text-foreground font-semibold text-[11px] uppercase tracking-wide mb-2">
              Three limits, stated rather than buried
            </p>
            <ul className="space-y-2 list-disc pl-4">
              <li>
                Deduct value and hazard coverage are correlated (roughly 0.76-0.81 Pearson across the committed
                runways) because a denser distress record scores both higher deduct and higher coverage. This is
                accepted with eyes open: deduct measures how damaged a unit is, coverage measures how often an
                aircraft actually meets it - related, but not the same question.
              </li>
              <li>
                A linear-quantity distress (metres, e.g. L &amp; T CR) is folded into coverage using a 1.0 m
                influence width - roughly a main-gear track plus spray. This is a research decision, not a citation,
                and is open to recalibration.
              </li>
              <li>
                DRU Relevancy and Urgency are this implementation&apos;s own proposal, not content reproduced from
                Anderson - see the provenance note below.
              </li>
            </ul>
          </div>

          <div className="rounded-md border border-dashed border-border px-3 py-2.5">
            <p className="text-foreground font-semibold text-[11px] uppercase tracking-wide mb-1">DRU provenance</p>
            <p>{DRU_PROVENANCE}</p>
          </div>

          <div className="rounded-md border border-dashed border-border px-3 py-2.5">
            <p className="text-foreground font-semibold text-[11px] uppercase tracking-wide mb-1">
              ICAO Doc 9859 Table 4 - Intolerable zone, source wording
            </p>
            <p className="italic">&quot;Take immediate action to mitigate the risk or stop the activity.&quot;</p>
            <p className="mt-1.5">
              Shown here as the source text, separate from this app&apos;s own action sentence (ICAO_ZONES.Intolerable
              in icaoMatrix.ts), which is deliberately softer - see that file&apos;s own note on why a live runway is
              never told to close from this dashboard.
            </p>
          </div>

          <div>
            <p className="text-foreground font-semibold text-[11px] uppercase tracking-wide mb-2">
              Observed-rate class: undefined units
            </p>
            <p>
              <span className="font-mono font-semibold text-foreground">{undefinedRate.count}</span> of{" "}
              {undefinedRate.total} units on this runway/year show observed-rate class &quot;Undefined&quot;
              (tidak_terdefinisi) - either their previous-year comparison uses a display-filler PCI, or the two
              years being compared were surveyed under different regimes (e.g. a full PAVER survey compared against
              a year with zero recorded distress) and are therefore not a meaningful one-year delta.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
