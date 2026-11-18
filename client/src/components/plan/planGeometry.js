// The geometry a plan is made of.
//
// Pulled out of the component because it is the part that has to be right and
// the part worth checking on paper: where a dragged wall lands, what happens
// when a measurement is typed over, where a corner turns, how much ground a
// closed shape covers, and where on the fence a gate dropped near it belongs.
//
// Nothing in here knows what is being drawn. A fence, a deck, the outline of a
// house — all the same lines on the same ground.

export const SAME_RUN_DEGREES = 8;

// A drag shorter than this is a tap: on an empty plan it drops the first
// point, and after that it does nothing, because a zero-length wall is not
// something anybody meant to draw.
export const TAP_PX = 6;

const deg = r => (r * 180) / Math.PI;
const rad = d => (d * Math.PI) / 180;

export function turnBetween(a, b) {
  let d = Math.abs(deg(b - a));
  while (d > 360) d -= 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Where a drag from `anchor` towards `raw` actually lands.
 *
 * The angle goes to the nearest grid direction and the length to the nearest
 * step, in that order — a wall that runs along the grid and measures a round
 * number is what somebody dragging a finger across a phone is trying to draw
 * and will never hit by hand.
 */
export function snapTo(anchor, raw, { snapM, angleStepDeg, snapAngles }) {
  const dx = raw.x - anchor.x;
  const dy = raw.y - anchor.y;
  const len = Math.hypot(dx, dy);
  if (len <= 0) return { ...anchor };

  let angle = Math.atan2(dy, dx);
  if (snapAngles && angleStepDeg > 0) {
    const step = rad(angleStepDeg);
    angle = Math.round(angle / step) * step;
  }
  const snapped = Math.max(snapM, Math.round(len / snapM) * snapM);
  // Tidied to a tenth of a millimetre, because the cosine of a right angle is
  // not quite zero and a wall drawn flat should not be stored as running
  // 0.0000000000000004m uphill.
  const tidy = v => Math.round(v * 1e4) / 1e4;
  return {
    x: tidy(anchor.x + Math.cos(angle) * snapped),
    y: tidy(anchor.y + Math.sin(angle) * snapped),
  };
}

/**
 * Setting a measurement by hand.
 *
 * The wall keeps the direction it was drawn in and changes length; everything
 * past it moves along with it, so the rest of the plan keeps its shape instead
 * of the next corner being dragged out of place.
 *
 * In a closed shape the last edge is whatever closes it, which is why it is
 * not offered for editing: a polygon cannot have every side set independently.
 */
export function setSegmentLength(points, index, metres) {
  const n = points.length;
  const a = points[index];
  const b = points[(index + 1) % n];
  if (!a || !b || !(metres > 0)) return points;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (!len) return points;

  const shiftX = (dx / len) * metres - dx;
  const shiftY = (dy / len) * metres - dy;
  // Everything from the far end of this wall onwards, which in a closed shape
  // stops short of the first point — that one is where the shape started and
  // the closing edge absorbs the change.
  return points.map((p, i) => (i > index ? { x: p.x + shiftX, y: p.y + shiftY } : p));
}

/** The straight walls, as drawn. */
export function segmentsOf(points, closed) {
  const segs = [];
  const upto = closed ? points.length : points.length - 1;
  for (let i = 0; i < upto; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    segs.push({ i, a, b, metres: Math.hypot(b.x - a.x, b.y - a.y) });
  }
  return segs;
}

/**
 * Which way the drawing turns at the start of wall `i`, in degrees: negative
 * is a left turn, positive a right one, and zero carries straight on.
 *
 * This is what lets a plan be read back as a list of runs — "12m, then 6m
 * turning left" — without keeping a second copy of the fence in that shape.
 */
export function turnAt(points, i, closed = false) {
  const n = points.length;
  if (i < 1 || i >= n) return null;
  // In an open shape the far end has nothing leading away from it, so there is
  // no turn there. In a closed one the last wall carries on round to the
  // first corner, which is a turn like any other.
  if (!closed && i + 1 >= n) return null;
  const here = points[i];
  const before = Math.atan2(here.y - points[i - 1].y, here.x - points[i - 1].x);
  const to = points[(i + 1) % n];
  if (!to) return null;
  const after = Math.atan2(to.y - here.y, to.x - here.x);
  let d = deg(after - before);
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

function rotateFrom(points, pivotIndex, radians) {
  const pivot = points[pivotIndex];
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return points.map((p, i) => {
    if (i <= pivotIndex) return p;
    const dx = p.x - pivot.x;
    const dy = p.y - pivot.y;
    return { x: pivot.x + dx * cos - dy * sin, y: pivot.y + dx * sin + dy * cos };
  });
}

/**
 * Turn the plan a different way at a corner, swinging everything past it
 * round rather than bending one wall out of place.
 */
export function setTurnAt(points, i, degrees) {
  // Open shapes only: swinging the closing wall of a closed one round would
  // pull it off the corner it closes on, and the shape would no longer close.
  const now = turnAt(points, i, false);
  if (now === null) return points;
  return rotateFrom(points, i, rad(degrees - now));
}

/** Another wall off the end, at a round length and square to the one before. */
export function appendRun(points, metres = 3, degrees = -90) {
  if (!points.length) return [{ x: 0, y: 0 }, { x: metres, y: 0 }];
  if (points.length === 1) return [...points, { x: points[0].x + metres, y: points[0].y }];
  const last = points[points.length - 1];
  const before = points[points.length - 2];
  const heading = Math.atan2(last.y - before.y, last.x - before.x) + rad(degrees);
  return [...points, {
    x: last.x + Math.cos(heading) * metres,
    y: last.y + Math.sin(heading) * metres,
  }];
}

/**
 * Take a wall out and close the gap, so the rest of the plan keeps its shape
 * instead of the corners either side being left hanging.
 */
export function removeSegment(points, i) {
  if (points.length <= 2) return [];
  if (i >= points.length - 1) return points.slice(0, -1);
  const gone = points[i + 1];
  const shiftX = points[i].x - gone.x;
  const shiftY = points[i].y - gone.y;
  return points
    .filter((p, n) => n !== i + 1)
    .map((p, n) => (n > i ? { x: p.x + shiftX, y: p.y + shiftY } : p));
}

// ── What a closed shape covers ──────────────────────────────────────────────

/**
 * The ground inside a closed outline, in square metres.
 *
 * The shoelace: twice the area is the sum of the cross products round the
 * edge, and the sign of it says which way the outline was drawn. Nobody
 * drawing a deck cares which way they went round it, so the sign goes.
 */
export function areaOf(points) {
  const pts = (points || []).filter(p => p && Number.isFinite(p.x) && Number.isFinite(p.y));
  if (pts.length < 3) return 0;
  let twice = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    twice += a.x * b.y - b.x * a.y;
  }
  return Math.abs(twice) / 2;
}

/** The whole way round, closed or not. */
export function perimeterOf(points, closed = false) {
  return segmentsOf(points, closed).reduce((t, s) => t + s.metres, 0);
}

// ── Putting something on the line ───────────────────────────────────────────

/**
 * Where a point dropped near the drawing belongs on it.
 *
 * Gives back the nearest place on the nearest wall: which wall, how far along
 * it, and the point itself. This is what lets a gate be dragged along a fence
 * rather than floating beside it — and it is the same answer a door needs on
 * the wall of a house.
 *
 * `null` when there is nothing to land on.
 */
export function placeOnLine(points, closed, at) {
  const segs = segmentsOf(points, closed);
  let best = null;
  for (const s of segs) {
    const dx = s.b.x - s.a.x;
    const dy = s.b.y - s.a.y;
    const len2 = dx * dx + dy * dy;
    if (!len2) continue;
    // How far along this wall the foot of the perpendicular falls, held to
    // the wall's own ends so a gate cannot be dragged off the end of it.
    let t = ((at.x - s.a.x) * dx + (at.y - s.a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const on = { x: s.a.x + dx * t, y: s.a.y + dy * t };
    const away = Math.hypot(at.x - on.x, at.y - on.y);
    if (!best || away < best.away) {
      best = { run: s.i, atM: t * s.metres, runMetres: s.metres, point: on, away };
    }
  }
  return best;
}

/** Where on the drawing something already placed sits, as a point. */
export function pointOnLine(points, closed, run, atM) {
  const segs = segmentsOf(points, closed);
  const s = segs[run];
  if (!s || !s.metres) return null;
  const t = Math.max(0, Math.min(1, atM / s.metres));
  return {
    x: s.a.x + (s.b.x - s.a.x) * t,
    y: s.a.y + (s.b.y - s.a.y) * t,
    // Along the wall and square to it, so whatever is being drawn there can
    // be drawn the right way round.
    ux: (s.b.x - s.a.x) / s.metres,
    uy: (s.b.y - s.a.y) / s.metres,
    run: s.i,
    runMetres: s.metres,
  };
}

/**
 * Objects on the line, kept honest when the line changes.
 *
 * A wall that is shortened or deleted takes whatever was sitting on it with
 * it. Left alone, a gate placed 8m along a run that is now 5m long sits in
 * mid-air, and the take-off goes on charging for it.
 */
export function pruneObjects(objects, points, closed) {
  const segs = segmentsOf(points, closed);
  return (objects || [])
    // A wall that has gone takes whatever was on it. There is nowhere left
    // for it to be, and leaving it would have the take-off go on charging for
    // a gate in a fence that is not there.
    .filter(o => !!segs[o.run])
    // A wall that has merely been shortened keeps its gate, slid back onto
    // the end of it. Quietly deleting something somebody placed is worse than
    // moving it where they can see it has moved and put it right.
    .map(o => ({ ...o, atM: Math.min(o.atM, segs[o.run].metres) }));
}

// ── Looking at it ───────────────────────────────────────────────────────────
//
// A view is a patch of ground: where its left edge is, where its top edge is,
// and how many metres across it is. The shape of the box it is drawn in turns
// that into a height, which is measured rather than assumed.

/** Zoomed about a point, so whatever is under the fingers stays under them. */
export function zoomAt(view, focus, factor, { minSpan = 2, maxSpan = 2000 } = {}) {
  const span = Math.min(maxSpan, Math.max(minSpan, view.span / factor));
  const k = span / view.span;
  return {
    // The focal point keeps its place: everything else moves in towards it or
    // out away from it by the same proportion.
    x0: focus.x - (focus.x - view.x0) * k,
    y0: focus.y - (focus.y - view.y0) * k,
    span,
  };
}

/** The view that frames what has been drawn, with room round it. */
export function fitView(points, shape, { minSpan = 24, pad = 1.3 } = {}) {
  const pts = (points || []).filter(p => p && Number.isFinite(p.x));
  if (!pts.length) {
    return { x0: -minSpan / 2, y0: -(minSpan * shape) / 2, span: minSpan };
  }
  const xs = pts.map(p => p.x);
  const ys = pts.map(p => p.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const need = Math.max(
    (Math.max(...xs) - Math.min(...xs)) * pad,
    ((Math.max(...ys) - Math.min(...ys)) * pad) / shape,
    minSpan,
  );
  return { x0: cx - need / 2, y0: cy - (need * shape) / 2, span: need };
}

/**
 * How fine the grid should be at this zoom.
 *
 * A metre grid at fifty metres across is a grey smear, and a five metre grid
 * on a three metre deck is no grid at all. Steps through the sizes anybody
 * would actually rule a plan at.
 */
export function gridFor(span) {
  const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 25];
  // Aiming for something like twenty to forty lines across the view.
  const wanted = span / 30;
  return steps.find(s => s >= wanted) || steps[steps.length - 1];
}

// ── Lining up with what is already drawn ────────────────────────────────────

/**
 * A wall being pulled out, slid to line up with a corner already on the plan.
 *
 * Snapping the angle gets a wall square. It does not get the far end of it in
 * line with the corner twelve metres away, which is what anybody drawing the
 * fourth side of anything is actually trying to do — and doing it by eye is
 * how a plan ends up 4.97m where it should be 5.
 *
 * So the direction the wall is going is left alone and only its length moves:
 * slid until its end sits on the same northing or easting as a corner that is
 * already there. The angle lock and the alignment never fight, because one
 * sets the direction and the other sets how far.
 *
 * `tol` is in metres and should come from the zoom — a fixed number of metres
 * would grab from the other side of the paddock when zoomed out.
 */
export function guideSnap(anchor, candidate, anchors, { tol = 0.3 } = {}) {
  const others = (anchors || []).filter(a =>
    a && (Math.abs(a.x - anchor.x) > 1e-9 || Math.abs(a.y - anchor.y) > 1e-9));
  if (!others.length) return { point: candidate, guides: [] };

  // Landing on a corner outright beats lining up with one.
  for (const a of others) {
    if (Math.hypot(candidate.x - a.x, candidate.y - a.y) <= tol) {
      return { point: { x: a.x, y: a.y }, guides: [{ from: a, axis: 'point' }] };
    }
  }

  const dx = candidate.x - anchor.x;
  const dy = candidate.y - anchor.y;
  const len = Math.hypot(dx, dy);
  if (len <= 0) return { point: candidate, guides: [] };
  const ux = dx / len;
  const uy = dy / len;

  // How far along this heading the wall would have to reach for its end to
  // share a corner's easting, or its northing.
  let best = null;
  for (const a of others) {
    const reaches = [];
    if (Math.abs(ux) > 1e-6) reaches.push({ at: (a.x - anchor.x) / ux, axis: 'x', from: a });
    if (Math.abs(uy) > 1e-6) reaches.push({ at: (a.y - anchor.y) / uy, axis: 'y', from: a });
    for (const r of reaches) {
      if (r.at <= 0) continue;              // behind the hand, not in front of it
      const off = Math.abs(r.at - len);
      if (off > tol) continue;
      if (!best || off < best.off) best = { ...r, off };
    }
  }
  if (!best) return { point: candidate, guides: [] };

  return {
    point: { x: anchor.x + ux * best.at, y: anchor.y + uy * best.at },
    guides: [{ from: best.from, axis: best.axis }],
  };
}
