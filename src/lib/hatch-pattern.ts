import { NOT_SURVEYED, NOT_SURVEYED_HATCH } from './pci-utils';

let cached: CanvasPattern | null | undefined;

/** 8x8 diagonal hatch, built once and reused. Screen-space, so it does not
 *  scale with zoom - deliberate: a "no data" marker should read the same at
 *  every zoom level, unlike a fill that represents a quantity. */
export function notSurveyedPattern(): CanvasPattern | null {
  if (cached !== undefined) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 8;
  const ctx = canvas.getContext('2d');
  if (!ctx) return (cached = null);

  ctx.fillStyle = NOT_SURVEYED.fillColor;
  ctx.fillRect(0, 0, 8, 8);

  ctx.strokeStyle = NOT_SURVEYED_HATCH;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  // Bottom-left to top-right, plus the two wrap-around segments so the tile
  // joins seamlessly when repeated.
  ctx.moveTo(0, 8); ctx.lineTo(8, 0);
  ctx.moveTo(-2, 2); ctx.lineTo(2, -2);
  ctx.moveTo(6, 10); ctx.lineTo(10, 6);
  ctx.stroke();

  return (cached = ctx.createPattern(canvas, 'repeat'));
}
