import { segmentsOf, areaOf, perimeterOf, pointOnLine, pruneObjects } from './planGeometry';
import { PLAN_OBJECTS } from './RunPlanner';

// A drawing, as a file.
//
// What gets saved on the job and attached to a quote. Built from the plan
// rather than scraped out of the editor's own SVG, for two reasons: the
// measurements on screen are HTML chips sitting over the drawing, so a scrape
// loses every number on it; and what the customer sees on a quote should be a
// tidy plan with a title block, not a screenshot of a tool with a grid and a
// zoom control in the corner.
//
// Pure, and takes no React. Hand it a plan and it gives back a string.

const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const round = n => Math.round(n * 100) / 100;

// Where the drawing sits on the page, with room round it for the measurements
// and the title block underneath.
const PAD = 1.6;          // metres of air around the drawing
const TITLE_H = 2.4;      // metres of title block, in the same units

function boundsOf(points) {
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  return {
    x0: Math.min(...xs), x1: Math.max(...xs),
    y0: Math.min(...ys), y1: Math.max(...ys),
  };
}

/**
 * @param points    the corners, in metres
 * @param closed    whether the last corner joins the first
 * @param objects   gates, doors and the like, sitting on the line
 * @param title     what the drawing is called
 * @param subtitle  the job it belongs to, and anything else worth printing
 * @param overlay   extra SVG to draw over the walls — a calculator's own
 *                  marks, as a string, in the same metre coordinates
 * @param showArea  print the area as well as the perimeter, for a closed shape
 */
export function planToSvg({
  points = [], closed = false, objects = [],
  title = 'Drawing', subtitle = '', overlay = '', showArea = true,
} = {}) {
  if (!points.length) return null;

  const segs = segmentsOf(points, closed);
  const held = pruneObjects(objects, points, closed);
  const b = boundsOf(points);
  const w = Math.max(b.x1 - b.x0, 0.001) + PAD * 2;
  const h = Math.max(b.y1 - b.y0, 0.001) + PAD * 2 + TITLE_H;
  const x0 = b.x0 - PAD;
  const y0 = b.y0 - PAD;

  // One ground metre as a fraction of the drawing, so a line weight and a
  // letter are the same size whatever the fence turned out to measure.
  const unit = Math.max(w, h) / 100;
  const line = unit * 0.55;
  const text = unit * 2.6;

  const wall = segs.map(s =>
    `<line x1="${round(s.a.x)}" y1="${round(s.a.y)}" x2="${round(s.b.x)}" y2="${round(s.b.y)}"`
    + ` stroke="#0f172a" stroke-width="${round(line)}" stroke-linecap="round"/>`).join('');

  // The measurement on every wall, laid along it and flipped where it would
  // otherwise read upside down.
  const marks = segs.map(s => {
    const mx = (s.a.x + s.b.x) / 2;
    const my = (s.a.y + s.b.y) / 2;
    let deg = (Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x) * 180) / Math.PI;
    if (deg > 90 || deg < -90) deg += 180;
    const label = `${s.metres.toFixed(2)}m`;
    const pad = unit * 0.6;
    const boxW = label.length * text * 0.56 + pad * 2;
    return `<g transform="translate(${round(mx)} ${round(my)}) rotate(${round(deg)})">`
      + `<rect x="${round(-boxW / 2)}" y="${round(-text * 0.78)}" width="${round(boxW)}"`
      + ` height="${round(text * 1.5)}" rx="${round(unit * 0.5)}" fill="#ffffff"`
      + ` stroke="#cbd5e1" stroke-width="${round(line * 0.4)}"/>`
      + `<text x="0" y="${round(text * 0.42)}" text-anchor="middle" font-size="${round(text)}"`
      + ` font-family="system-ui, sans-serif" fill="#0f172a">${esc(label)}</text></g>`;
  }).join('');

  // Gates and doors: a gap in the wall with the leaf swung out of it, the same
  // way the editor draws them.
  const things = held.map(o => {
    const spec = PLAN_OBJECTS[o.kind] || PLAN_OBJECTS.opening;
    const at = pointOnLine(points, closed, o.run, o.atM);
    if (!at) return '';
    const half = (o.widthM || spec.widthM) / 2;
    const a = { x: at.x - at.ux * half, y: at.y - at.uy * half };
    const c = { x: at.x + at.ux * half, y: at.y + at.uy * half };
    const leaf = { x: a.x + at.uy * half * 2, y: a.y - at.ux * half * 2 };
    return `<line x1="${round(a.x)}" y1="${round(a.y)}" x2="${round(c.x)}" y2="${round(c.y)}"`
      + ` stroke="#ffffff" stroke-width="${round(line * 1.6)}" stroke-linecap="butt"/>`
      + (spec.swing
        ? `<line x1="${round(a.x)}" y1="${round(a.y)}" x2="${round(leaf.x)}" y2="${round(leaf.y)}"`
          + ` stroke="${spec.colour}" stroke-width="${round(line * 0.6)}"`
          + ` stroke-dasharray="${round(unit)} ${round(unit * 0.7)}"/>`
        : '')
      + `<line x1="${round(a.x)}" y1="${round(a.y)}" x2="${round(c.x)}" y2="${round(c.y)}"`
      + ` stroke="${spec.colour}" stroke-width="${round(line * 0.6)}" stroke-linecap="round"/>`;
  }).join('');

  const corners = points.map(p =>
    `<circle cx="${round(p.x)}" cy="${round(p.y)}" r="${round(unit * 0.8)}"`
    + ` fill="#ffffff" stroke="#0f172a" stroke-width="${round(line * 0.5)}"/>`).join('');

  // What it measures, printed on the drawing rather than left to be worked
  // out from the walls. A plan without its figures is a sketch.
  const around = perimeterOf(points, closed);
  const area = closed && points.length > 2 ? areaOf(points) : 0;
  const facts = [
    `${around.toFixed(2)}m around`,
    showArea && area > 0 ? `${area.toFixed(2)}m²` : null,
    `${segs.length} ${segs.length === 1 ? 'run' : 'runs'}`,
  ].filter(Boolean).join('  ·  ');

  const titleY = y0 + h - TITLE_H * 0.55;
  const block =
    `<line x1="${round(x0 + unit)}" y1="${round(y0 + h - TITLE_H)}"`
    + ` x2="${round(x0 + w - unit)}" y2="${round(y0 + h - TITLE_H)}"`
    + ` stroke="#cbd5e1" stroke-width="${round(line * 0.4)}"/>`
    + `<text x="${round(x0 + unit * 1.6)}" y="${round(titleY)}" font-size="${round(text * 1.5)}"`
    + ` font-family="system-ui, sans-serif" font-weight="700" fill="#0f172a">${esc(title)}</text>`
    + `<text x="${round(x0 + unit * 1.6)}" y="${round(titleY + text * 1.8)}" font-size="${round(text)}"`
    + ` font-family="system-ui, sans-serif" fill="#64748b">${esc([subtitle, facts].filter(Boolean).join('  ·  '))}</text>`;

  // A fixed pixel size as well as the viewBox, because a PDF and an <img>
  // both want to know how big this is before they lay it out.
  const px = 1200;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${round(x0)} ${round(y0)} ${round(w)} ${round(h)}"`
    + ` width="${px}" height="${Math.round((px * h) / w)}">`
    + `<rect x="${round(x0)}" y="${round(y0)}" width="${round(w)}" height="${round(h)}" fill="#ffffff"/>`
    + `<g>${overlay || ''}</g>`
    + wall + things + corners + marks + block
    + '</svg>';
}

/** The same thing as a data URL, which is what an upload wants. */
export function planToDataUrl(args) {
  const svg = planToSvg(args);
  if (!svg) return null;
  // unescape(encodeURIComponent(...)) is the usual dance for btoa and
  // non-ASCII; a job name with a macron in it would throw without it.
  const bytes = new TextEncoder().encode(svg);
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}
