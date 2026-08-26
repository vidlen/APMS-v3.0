import { useEffect, useRef, useCallback } from "react";
import { X } from "lucide-react";
import { Map, View } from "ol";
import TileLayer from "ol/layer/Tile";
import XYZ from "ol/source/XYZ";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import GeoJSON from "ol/format/GeoJSON";
import { fromLonLat } from "ol/proj";
import { Style, Fill, Stroke, Text } from "ol/style";
import { Zoom, Attribution } from "ol/control";
import type { FeatureLike } from "ol/Feature";
import type { SectionData } from "@/lib/pci-utils";
import { getPCIStyle, getPCICategory, parsePCIValue, isNotSurveyed, NOT_SURVEYED } from "@/lib/pci-utils";
import { notSurveyedPattern } from "@/lib/hatch-pattern";
import { useEffectiveYearData } from "@/lib/data-store";
import type { SurveyYear } from "@/lib/survey-years";
import "ol/ol.css";

interface MapViewProps {
  selectedYear: SurveyYear;
  onFeatureClick: (section: SectionData | null) => void;
  selectedSection: SectionData | null;
  detailedSection: string | null;
  onExitDetails: () => void;
  activeBands: Set<string>;
  onClearBands: () => void;
}

const GEOJSON_PROJECTION_OPTS = {
  dataProjection: "EPSG:4326",
  featureProjection: "EPSG:3857",
};

// Re-expresses an rgba() color string at a different alpha — used to dim
// sections that don't match the legend's active condition filter.
function withAlpha(rgba: string, alpha: number): string {
  const match = rgba.match(/rgba?\(([^)]+)\)/);
  if (!match) return rgba;
  const [r, g, b] = match[1].split(",").map((p) => p.trim());
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export default function MapView({
  selectedYear,
  onFeatureClick,
  selectedSection,
  detailedSection,
  onExitDetails,
  activeBands,
  onClearBands,
}: MapViewProps) {
  const { sectionsFC, unitsBySection } = useEffectiveYearData(selectedYear);
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<Map | null>(null);
  const vectorLayerRef = useRef<VectorLayer | null>(null);
  const baseSourceRef = useRef<VectorSource | null>(null);
  const unitsLayerRef = useRef<VectorLayer | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const detailedSectionRef = useRef<string | null>(null);

  useEffect(() => {
    detailedSectionRef.current = detailedSection;
  }, [detailedSection]);

  // Style function for base pavement features
  const styleFunction = useCallback(
    (feature: FeatureLike) => {
      const props = feature.getProperties();
      const sectionName = props["Section"] as string;
      const isSelected = selectedSection?.Section === sectionName;
      const isDetailedThis = detailedSection === sectionName;

      if (isDetailedThis) {
        // Hide the base polygon for the section that's being shown in detail
        return new Style({});
      }

      const pciValue = parsePCIValue(props["PCI Rating"] as string | undefined);
      const style = getPCIStyle(pciValue);
      const category = getPCICategory(pciValue);

      // When the legend filter is active, dim sections outside the chosen
      // condition band(s) so the matching ones stand out. Selection always
      // wins over dimming, so a selected section stays fully highlighted. A
      // Not Surveyed branch is outside the PCI scale entirely, so the band
      // filter never dims it, regardless of which bands are active.
      const isDimmed =
        activeBands.size > 0 && !isNotSurveyed(category) && !activeBands.has(category.label);

      const fillColor = style.hatched
        ? (notSurveyedPattern() ?? NOT_SURVEYED.fillColor)
        : isDimmed
          ? withAlpha(style.fill, 0.12)
          : style.fill;

      return new Style({
        fill: new Fill({ color: fillColor }),
        stroke: new Stroke({
          color: isSelected
            ? "rgba(255,255,255,0.95)"
            : isDimmed
              ? "rgba(35,35,35,0.25)"
              : style.stroke,
          width: isSelected ? 2.5 : style.strokeWidth,
        }),
      });
    },
    [selectedSection, detailedSection, activeBands]
  );

  // Style function for sample-unit features
  const unitStyleFunction = useCallback(
    (feature: FeatureLike) => {
      const props = feature.getProperties();
      const rawScore = Number(props["pci_score"]);
      const pciValue = Number.isFinite(rawScore) ? rawScore : null;
      const style = getPCIStyle(pciValue);
      const isSelected =
        selectedSection?.sampleUnit === props["sampleUnit"] &&
        selectedSection?.Section === detailedSection;
      return new Style({
        fill: new Fill({ color: style.fill }),
        stroke: new Stroke({
          color: isSelected ? "rgba(255,255,255,0.95)" : "rgba(20,20,20,0.85)",
          width: isSelected ? 2.2 : 0.8,
        }),
        text: new Text({
          text: String(props["sampleUnit"] ?? ""),
          font: '600 10px "Fira Sans", system-ui, sans-serif',
          fill: new Fill({ color: "#111" }),
          stroke: new Stroke({ color: "rgba(255,255,255,0.85)", width: 2 }),
          overflow: false,
        }),
      });
    },
    [selectedSection, detailedSection]
  );

  useEffect(() => {
    if (!mapRef.current) return;

    // Vector source starts empty; features are populated in-memory from the
    // data store once the effective (base + admin overrides) data resolves.
    const vectorSource = new VectorSource();

    // Create vector layer
    const vectorLayer = new VectorLayer({
      source: vectorSource,
      style: styleFunction,
      declutter: true,
    });
    vectorLayerRef.current = vectorLayer;
    baseSourceRef.current = vectorSource;

    // Create map
    const map = new Map({
      target: mapRef.current,
      layers: [
        // Google Satellite base
        new TileLayer({
          source: new XYZ({
            url: "https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
            attributions: "Google Satellite",
          }),
        }),
        vectorLayer,
      ],
      view: new View({
        center: fromLonLat([106.66, -6.12]),
        zoom: 14,
        maxZoom: 19,
        minZoom: 11,
      }),
      controls: [],
    });
    mapInstance.current = map;

    // Add zoom controls
    map.addControl(new Zoom());

    // Add attribution
    map.addControl(new Attribution({ collapsed: true }));

    // Click handler
    map.on("click", (e) => {
      const feature = map.forEachFeatureAtPixel(e.pixel, (f) => f);
      if (feature) {
        const props = feature.getProperties();
        if (props["sampleUnit"] !== undefined) {
          // Sample-unit click: open the same detail panel, inheriting
          // PCN/Type from the parent runway section (sample units share
          // a single PCN — only PCI is measured per sample unit).
          const parentSectionName = detailedSectionRef.current;
          const baseSource = baseSourceRef.current;
          const parentFeature =
            parentSectionName && baseSource
              ? baseSource
                  .getFeatures()
                  .find((f) => f.get("Section") === parentSectionName)
              : undefined;
          const parentProps = parentFeature?.getProperties();
          const pciScore = Number(props["pci_score"]);
          const pciRatingStr = Number.isInteger(pciScore)
            ? String(pciScore)
            : pciScore.toFixed(2);

          onFeatureClick({
            Section: parentSectionName ?? "",
            "PCI Rating": pciRatingStr,
            PCN: (parentProps?.["PCN"] as string) ?? "",
            Type: (parentProps?.["Type"] as string) ?? "",
            sampleUnit: props["sampleUnit"] as number,
            "Last Major Construction Year": parentProps?.["Last Major Construction Year"] as string | undefined,
            Dimension: parentProps?.["Dimension"] as string | undefined,
          });
          return;
        }
        onFeatureClick({
          Section: props["Section"],
          "PCI Rating": props["PCI Rating"],
          PCN: props["PCN"],
          Type: props["Type"],
          "Last Major Construction Year": props["Last Major Construction Year"],
          Dimension: props["Dimension"],
        });
      } else {
        onFeatureClick(null);
      }
    });

    // Hover handler for cursor and tooltip
    const tooltipEl = document.createElement("div");
    tooltipEl.className = "map-tooltip";
    tooltipEl.style.display = "none";
    document.body.appendChild(tooltipEl);
    tooltipRef.current = tooltipEl;

    map.on("pointermove", (e) => {
      const pixel = map.getEventPixel(e.originalEvent);
      const feature = map.forEachFeatureAtPixel(pixel, (f) => f);

      if (feature) {
        const props = feature.getProperties();
        map.getViewport().style.cursor = "pointer";
        tooltipEl.style.display = "block";
        if (props["sampleUnit"] !== undefined) {
          const rawScore = Number(props["pci_score"]);
          const pciValue = Number.isFinite(rawScore) ? rawScore : null;
          const label = getPCICategory(pciValue).label;
          const pciText = pciValue === null ? "Not surveyed" : pciValue.toFixed(2);
          tooltipEl.innerHTML = `<strong>Sample Unit <span class="font-mono">${props["sampleUnit"]}</span></strong> &middot; PCI: <span class="font-mono">${pciText}</span> &middot; ${label}`;
        } else {
          const sectionName = props["Section"];
          const pciValue = parsePCIValue(props["PCI Rating"] as string | undefined);
          const label = getPCICategory(pciValue).label;
          const pciText = pciValue === null ? "Not surveyed" : props["PCI Rating"];
          tooltipEl.innerHTML = `<strong class="font-mono">${sectionName}</strong> &middot; PCI: <span class="font-mono">${pciText}</span> &middot; ${label}`;
        }
        const evt = e.originalEvent as PointerEvent;
        tooltipEl.style.left = evt.pageX + 12 + "px";
        tooltipEl.style.top = evt.pageY - 30 + "px";
      } else {
        map.getViewport().style.cursor = "";
        tooltipEl.style.display = "none";
      }
    });

    // Cleanup
    return () => {
      map.setTarget(undefined);
      if (tooltipEl && tooltipEl.parentNode) {
        tooltipEl.parentNode.removeChild(tooltipEl);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Populate/refresh the base layer whenever the effective section data
  // (base file + admin overrides) resolves or changes.
  useEffect(() => {
    const source = baseSourceRef.current;
    if (!source || !sectionsFC) return;
    const features = new GeoJSON().readFeatures(sectionsFC, GEOJSON_PROJECTION_OPTS);
    source.clear();
    source.addFeatures(features);
  }, [sectionsFC]);

  // Update styles when selection changes
  useEffect(() => {
    if (vectorLayerRef.current) {
      vectorLayerRef.current.setStyle(styleFunction);
    }
  }, [selectedSection, styleFunction]);

  // Fly the view to the selected section so it's always visible after being
  // picked from search, Needs Attention, or the map itself. Skipped for a
  // sample-unit selection — its parent section is already framed.
  useEffect(() => {
    const map = mapInstance.current;
    const source = baseSourceRef.current;
    if (!map || !source) return;
    if (!selectedSection || selectedSection.sampleUnit !== undefined) return;

    const feature = source
      .getFeatures()
      .find((f) => f.get("Section") === selectedSection.Section);
    const geometry = feature?.getGeometry();
    if (!geometry) return;

    map.getView().fit(geometry.getExtent(), {
      duration: 500,
      padding: [60, 60, 60, 60],
      maxZoom: 15,
    });
  }, [selectedSection]);

  // Manage the sample-unit layer when detailedSection (or its effective
  // data — e.g. after an admin edits a unit score) changes
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;

    // Tear down any previous units layer
    if (unitsLayerRef.current) {
      map.removeLayer(unitsLayerRef.current);
      unitsLayerRef.current = null;
    }

    if (!detailedSection) return;

    const fc = unitsBySection[detailedSection];
    if (!fc) return;

    const source = new VectorSource({
      features: new GeoJSON().readFeatures(fc, GEOJSON_PROJECTION_OPTS),
    });

    const layer = new VectorLayer({
      source,
      style: unitStyleFunction,
      declutter: false,
      zIndex: 10,
    });
    unitsLayerRef.current = layer;
    map.addLayer(layer);
    // unitStyleFunction is applied by the effect below whenever it changes,
    // so it's intentionally excluded here to avoid rebuilding the
    // sample-unit layer on every selection change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailedSection, unitsBySection]);

  // Refresh sample-unit styling (e.g. selection highlight) without
  // recreating the layer or its data source
  useEffect(() => {
    if (unitsLayerRef.current) {
      unitsLayerRef.current.setStyle(unitStyleFunction);
    }
  }, [unitStyleFunction]);

  return (
    <>
      <div ref={mapRef} className="w-full h-full" />
      {detailedSection && (
        <button
          onClick={onExitDetails}
          className="panel-surface absolute top-24 left-3 z-30 flex items-center gap-2 hover:border-primary/40 text-foreground text-xs font-medium px-3 py-2 rounded-md transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <span aria-hidden>←</span>
          <span>Back to overview · {detailedSection}</span>
        </button>
      )}
      {/* Persistent condition-filter indicator — survives the sidebar
          swapping to the detail panel or table, where the legend that
          set this filter is no longer on screen. */}
      {activeBands.size > 0 && (
        <div className="panel-surface absolute top-3 right-3 z-30 flex items-center gap-2 px-3 py-2 rounded-md max-w-[260px]">
          <span className="text-[11px] text-muted-foreground shrink-0">Filtered:</span>
          <div className="flex items-center gap-1 flex-wrap min-w-0">
            {[...activeBands].map((label) => (
              <span
                key={label}
                className="text-[11px] px-2 py-0.5 rounded-full bg-primary/15 text-primary font-medium whitespace-nowrap"
              >
                {label}
              </span>
            ))}
          </div>
          <button
            onClick={onClearBands}
            aria-label="Clear condition filter"
            className="shrink-0 p-2 -m-2 text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-sm"
            title="Clear condition filter"
          >
            <X size={13} />
          </button>
        </div>
      )}
    </>
  );
}
