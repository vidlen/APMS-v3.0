/**
 * risk-unit-adapter.ts
 * -----------------------------------------------------------------------------
 * Bridges the app's existing sample-unit GeoJSON (SampleUnitProperties, see
 * sample-units.ts) into risk-unit.ts's UnitRiskInput, for the two branches
 * with real per-unit distress and PCI data (metode-b-r1-spec.md section 0.6):
 * RWY 06/24 and RWY 07L/25R.
 *
 * DEDUCT AND COVERAGE (section 3.3, 4.1):
 *   SampleUnitDistress already carries `deduct` (ASTM D5340, 100% coverage on
 *   every committed unit-year) - passed through unconverted. The old
 *   PAVER-density-based `densityPct` this adapter used to compute is gone:
 *   Likelihood now reads TDV/PCI directly (risk-unit.ts) and Frequency reads
 *   coveragePct, which works from quantity/quantityUnits itself, not a
 *   precomputed density. The 600 m2 divisor that used to live here as
 *   PAVER_DENSITY_DIVISOR_M2 lives on as COVERAGE_DIVISOR_M2 in riskScales.ts,
 *   same value, same reasoning: it's the 10m x 60m NOMINAL design area PAVER
 *   itself divides by for density, not each unit's own surveyed polygon
 *   (586-604 m2) - verified against the fixture figures in metode-b-spec_4.md
 *   (unit 16's Raveling High 4.92 m2 only reproduces its published density
 *   0.820 when divided by a flat 600 m2).
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
    deduct: d.deduct,
  };
}

/**
 * ASTM D5340 self-consistency guard (section 10): CDV can never be smaller
 * than the single highest deduct value on a unit, so (100 - PCI) must be at
 * least as large as max(deduct). A small tolerance absorbs PCI rounding and
 * float error - see ASTM_TOLERANCE.
 */
export const ASTM_TOLERANCE = 0.1;

export function astmConsistent(pci: number, distresses: UnitDistress[]): boolean {
  if (distresses.length === 0) return true;
  const maxDeduct = Math.max(...distresses.map((d) => d.deduct));
  const cdv = 100 - pci;
  return maxDeduct - cdv <= ASTM_TOLERANCE;
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
 * `previousYearFc`/`previousYear` supply previousPci/previousSurveyYear when
 * an earlier survey is available; omit both (e.g. no earlier survey) and
 * every unit's rate class naturally resolves to 'tidak_terdefinisi'
 * (observed-rate.ts already requires a defined previousPci and previousYear).
 *
 * `repairedSincePrevious` is always false (section 7.4): patched-area growth
 * turned out to correlate with FALLING PCI on this data (units flagged by the
 * old rule dropped 9.5-14.2 points on average, versus a rise for unflagged
 * units), so the rule that read it as a repair has been switched off rather
 * than left running backwards. The field itself stays on UnitRiskInput,
 * unused, pending a real replacement signal (a repair-log record falling
 * between the two survey dates).
 */
export function toUnitRiskInputs(
  branchId: string,
  role: BranchRole,
  year: number,
  currentYearFc: GeoJSONFeatureCollection,
  previousYearFc?: GeoJSONFeatureCollection,
  previousYear?: number,
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
    const distresses = (props.distresses ?? []).map(toUnitDistress);

    return {
      branchId,
      unitNumber,
      stationKm: (unitNumber - 1) * 0.01,
      zone: zoneFor(unitNumber),
      areaM2,
      areaIsNominal: isNominal,
      surveyYear: year,
      role,
      distresses,
      pci: props.pci_score,
      pciIsReal,
      previousPci: prevProps?.pci_score,
      previousPciIsReal: prevProps ? pciIsReal : undefined,
      previousSurveyYear: prevProps ? previousYear : undefined,
      repairedSincePrevious: false,
      astmConsistent: astmConsistent(props.pci_score, distresses),
    };
  });
}
