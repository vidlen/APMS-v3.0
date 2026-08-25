/**
 * risk-unit-adapter.ts
 * -----------------------------------------------------------------------------
 * Bridges the app's existing sample-unit GeoJSON (SampleUnitProperties, see
 * sample-units.ts) into risk-unit.ts's UnitRiskInput, for the two branches
 * with real per-unit distress and PCI data (metode-b-spec_4.md section 0.6):
 * RWY 06/24 and RWY 07L/25R.
 *
 * DENSITY DIVISOR (section 3.2/8.1):
 *   Raw sample-unit JSON carries no `densityPct` field at all - it has to be
 *   computed here. The naive choice is each unit's own surveyed polygon area
 *   (586-604 m2, see polygonAreaM2 below), but reverse-engineering the
 *   spec's own fixture figures rules that out: unit 16's Raveling High
 *   quantity 4.92 m2 only reproduces the spec's density 0.820 when divided by
 *   a FLAT 600 m2 (4.92 / 600 x 100 = 0.820 exactly; four more fixture
 *   figures match the same divisor to 3-4 decimals). PAVER evidently divides
 *   by the 10m x 60m NOMINAL design area for every unit, not each unit's own
 *   surveyed polygon - so density and area are computed from two different
 *   numbers here, on purpose.
 *
 * QUANTITY UNITS (section 3.2, 4.1):
 *   quantity/quantityUnits are passed through unconverted - 'SqM' and 'M' are
 *   both legitimate PAVER units (L & T CR is linear), and UnitDistress keeps
 *   both fields for exactly this reason. Only a genuinely unrecognised unit
 *   throws.
 * -----------------------------------------------------------------------------
 */

import type { GeoJSONFeature, GeoJSONFeatureCollection } from './geojson-types.ts';
import type { SampleUnitDistress, SampleUnitProperties } from './sample-units.ts';
import type { BranchRole } from '../config/riskScales.ts';
import { canonicalise } from './risk.ts';
import type { UnitDistress, UnitRiskInput, Zone } from './risk-unit.ts';

/** The only two branches with a real (surveyed) per-unit PCI - section 0.6. */
const REAL_PCI_BRANCHES = new Set(['06/24', '07L/25R']);

export function isPciReal(branchId: string): boolean {
  return REAL_PCI_BRANCHES.has(branchId);
}

/** PAVER's own density divisor - the 10m x 60m nominal design area, not the
 *  unit's real surveyed polygon. See the file header. */
const PAVER_DENSITY_DIVISOR_M2 = 600;

function densityPctFor(quantity: number): number {
  return (quantity / PAVER_DENSITY_DIVISOR_M2) * 100;
}

const KNOWN_QUANTITY_UNITS = new Set(['SqM', 'M']);
const KNOWN_SEVERITIES = new Set(['Low', 'Medium', 'High', 'N/A']);

function toUnitDistress(d: SampleUnitDistress): UnitDistress {
  if (!KNOWN_QUANTITY_UNITS.has(d.quantityUnits)) {
    throw new Error(`Unexpected quantityUnits '${d.quantityUnits}' for distress type '${d.type}'`);
  }
  if (!KNOWN_SEVERITIES.has(d.severity)) {
    throw new Error(`Unexpected severity '${d.severity}' for distress type '${d.type}'`);
  }
  return {
    type: canonicalise(d.type),
    severity: d.severity as UnitDistress['severity'],
    quantity: d.quantity,
    quantityUnits: d.quantityUnits as UnitDistress['quantityUnits'],
    densityPct: densityPctFor(d.quantity),
  };
}

function totalPatchingAreaM2(distresses: SampleUnitDistress[] | undefined): number {
  if (!distresses) return 0;
  return distresses
    .filter((d) => canonicalise(d.type) === 'PATCHING' && d.quantityUnits === 'SqM')
    .reduce((sum, d) => sum + d.quantity, 0);
}

/**
 * Real area (m2) of a sample unit's own GeoJSON polygon: equirectangular
 * projection (fine at this footprint, ~10m x 60m) then the shoelace formula.
 * No geospatial dependency (turf etc.) - nothing else in the app needs one,
 * and this is a few lines of plain trigonometry.
 */
export function polygonAreaM2(ring: number[][]): number {
  const R = 6378137; // WGS84 mean radius, m
  const refLat = (ring[0][1] * Math.PI) / 180;
  const pts = ring.map(([lon, lat]) => [
    ((lon * Math.PI) / 180) * R * Math.cos(refLat),
    ((lat * Math.PI) / 180) * R,
  ]);
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}

/** Nominal fallback area (section 7.2 option 3), used only when a feature
 *  carries no usable polygon geometry. */
export const NOMINAL_UNIT_AREA_M2 = 600;

function resolveUnitArea(feature: GeoJSONFeature): { areaM2: number; isNominal: boolean } {
  const geom = feature.geometry;
  if (geom?.type === 'Polygon') {
    const rings = geom.coordinates as unknown as number[][][];
    const ring = rings?.[0];
    if (Array.isArray(ring) && ring.length >= 3) {
      return { areaM2: polygonAreaM2(ring), isNominal: false };
    }
  }
  return { areaM2: NOMINAL_UNIT_AREA_M2, isNominal: true };
}

function zoneFor(unitNumber: number): Zone {
  return unitNumber <= 50 || unitNumber > 250 ? 'ujung' : 'tengah';
}

/**
 * Builds one branch's UnitRiskInput array for one survey year.
 *
 * `previousYearFc` supplies previousPci and repairedSincePrevious (section
 * 7.3: PATCHING area grew versus the previous year) when available; omit it
 * (e.g. no earlier survey) and every unit's rate class naturally resolves to
 * 'tidak_terdefinisi' (observed-rate.ts already requires a defined previousPci).
 */
export function toUnitRiskInputs(
  branchId: string,
  role: BranchRole,
  year: number,
  currentYearFc: GeoJSONFeatureCollection,
  previousYearFc?: GeoJSONFeatureCollection,
): UnitRiskInput[] {
  const previousByUnit = new Map<number, SampleUnitProperties>();
  if (previousYearFc) {
    for (const f of previousYearFc.features) {
      const props = f.properties as unknown as SampleUnitProperties;
      previousByUnit.set(props.sampleUnit, props);
    }
  }

  const pciIsReal = isPciReal(branchId);

  return currentYearFc.features.map((feature) => {
    const props = feature.properties as unknown as SampleUnitProperties;
    const unitNumber = props.sampleUnit;
    const prevProps = previousByUnit.get(unitNumber);
    const { areaM2, isNominal } = resolveUnitArea(feature);

    const repairedSincePrevious = prevProps
      ? totalPatchingAreaM2(props.distresses) > totalPatchingAreaM2(prevProps.distresses)
      : false;

    return {
      branchId,
      unitNumber,
      stationKm: (unitNumber - 1) * 0.01,
      zone: zoneFor(unitNumber),
      areaM2,
      areaIsNominal: isNominal,
      surveyYear: year,
      role,
      distresses: (props.distresses ?? []).map(toUnitDistress),
      pci: props.pci_score,
      pciIsReal,
      previousPci: prevProps?.pci_score,
      previousPciIsReal: prevProps ? pciIsReal : undefined,
      repairedSincePrevious,
    };
  });
}
