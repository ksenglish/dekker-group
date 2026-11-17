import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import styles from './RunPlanner.module.css';

// Drawing a run of something on the ground.
//
// A fence, a retaining wall, a boundary, the edge of a deck — all the same
// drawing: press, drag out a wall, let go, drag the next one off the end of
// it. Lengths snap to the grid as they are drawn and can be typed over
// afterwards, which is how anybody who has used ArcSite expects it to work and
// is the only way a measurement taken off a plan ever ends up exact.
//
// Deliberately knows nothing about what is being drawn. What the segments
// mean — panels, posts, gates, piles — is drawn on top through `overlay`, and
// named through `labelFor`. The arithmetic belongs to whatever is using it.

// How far off a straight line a drag has to be before it counts as a new wall
// rather than a continuation of the one before. Below this the two are merged,
// so a boundary drawn in two pulls is one run and does not sprout a corner
// post in the middle of it.
const SAME_RUN_DEGREES = 8;

// A drag shorter than this is a tap: on an empty plan it drops the first
// point, and after that it does nothing, because a zero-length wall is not
// something anybody meant to draw.
const TAP_PX = 6;

const deg = r => (r * 180) / Math.PI;
const rad = d => (d * Math.PI) / 180;

function turnBetween(a, b) {
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

export default function RunPlanner({
  points = [],
  closed = false,
  onChange,
  // The ground: a metre grid, a tenth of a metre of precision, and walls that
  // run square or at 45° unless that is turned off for an odd boundary.
  gridM = 1,
  snapM = 0.1,
  angleStepDeg = 45,
  minSpanM = 24,
  shape = 0.625,            // the plan is 16 : 10
  colour = '#1f2937',
  labelFor,                 // (segment) => extra text after the measurement
  overlay,                  // (ctx) => svg nodes drawn under the walls
  hint = 'Press and drag to draw a wall. Drag the next one off the end of it.',
  readOnly = false,
}) {
  const boxRef = useRef(null);
  const [drag, setDrag] = useState(null);       // { kind, anchor, to, index }
  const [editing, setEditing] = useState(null); // segment index
  const [typed, setTyped] = useState('');
  const [snapAngles, setSnapAngles] = useState(true);

  const live = drag?.kind === 'vertex'
    ? points.map((p, i) => (i === drag.index ? drag.to : p))
    : points;
  const previewing = drag?.kind === 'draw' && drag.to;

  // The ground under the drawing has to hold still.
  //
  // A view that refits after every stroke moves the plan under the finger: the
  // next drag lands somewhere else entirely because the scale changed between
  // the two. So the view is a patch of ground that only grows, and only when
  // the drawing runs off the edge of it.
  const fitted = useMemo(() => {
    const all = previewing ? [...live, drag.to] : live;
    if (!all.length) {
      return { x0: -minSpanM / 2, y0: -(minSpanM * shape) / 2, span: minSpanM };
    }
    const xs = all.map(p => p.x);
    const ys = all.map(p => p.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const need = Math.max(
      (Math.max(...xs) - Math.min(...xs)) * 1.35,
      ((Math.max(...ys) - Math.min(...ys)) * 1.35) / shape,
    );
    let span = minSpanM;
    while (span < need) span *= 2;
    return { x0: cx - span / 2, y0: cy - (span * shape) / 2, span };
  }, [live, previewing, drag, minSpanM, shape]);

  const [held, setHeld] = useState(null);
  useEffect(() => {
    setHeld(prev => {
      const patch = prev
        || { x0: -minSpanM / 2, y0: -(minSpanM * shape) / 2, span: minSpanM };
      const all = previewing ? [...live, drag.to] : live;
      // Kept clear of the edge, so a corner never sits under the border and a
      // measurement at the end of a run has somewhere to be printed.
      const edge = patch.span * 0.04;
      const fits = all.every(p =>
        p.x >= patch.x0 + edge && p.x <= patch.x0 + patch.span - edge
        && p.y >= patch.y0 + edge && p.y <= patch.y0 + patch.span * shape - edge);
      return fits ? patch : fitted;
    });
  }, [live, previewing, drag, fitted, minSpanM, shape]);

  const view = held || fitted;
  const w = view.span;
  const h = view.span * shape;
  const step = w > 48 ? 5 : gridM;
  // One ground metre as a fraction of the view, for sizing marks that should
  // look the same however far out the plan is zoomed.
  const unit = w / 100;

  const toGround = useCallback(event => {
    const box = boxRef.current?.getBoundingClientRect();
    if (!box) return null;
    return {
      x: view.x0 + ((event.clientX - box.left) / box.width) * w,
      y: view.y0 + ((event.clientY - box.top) / box.height) * h,
    };
  }, [view, w, h]);

  const onGrid = useCallback(g => ({
    x: Math.round(g.x / snapM) * snapM,
    y: Math.round(g.y / snapM) * snapM,
  }), [snapM]);

  // ── Drawing ───────────────────────────────────────────────────────────────

  function pointerDown(event) {
    if (readOnly || editing !== null) return;
    const g = toGround(event);
    if (!g) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);

    // A press on a corner picks that corner up to move it — except the open
    // end of the drawing, which is the pen tip: dragging off it is how the
    // next wall gets drawn, and it is the commonest thing anybody does here.
    const tip = closed ? -1 : live.length - 1;
    const grab = live.findIndex((p, i) =>
      i !== tip && Math.hypot(p.x - g.x, p.y - g.y) < unit * 2.5);
    if (grab >= 0) {
      setDrag({ kind: 'vertex', index: grab, to: live[grab], startedAt: { x: event.clientX, y: event.clientY } });
      return;
    }

    const anchor = points.length ? points[points.length - 1] : onGrid(g);
    setDrag({
      kind: 'draw',
      anchor,
      to: points.length ? snapTo(anchor, g, { snapM, angleStepDeg, snapAngles }) : anchor,
      startedAt: { x: event.clientX, y: event.clientY },
    });
  }

  function pointerMove(event) {
    if (!drag) return;
    const g = toGround(event);
    if (!g) return;
    if (drag.kind === 'vertex') {
      setDrag({ ...drag, to: onGrid(g) });
      return;
    }
    setDrag({ ...drag, to: snapTo(drag.anchor, g, { snapM, angleStepDeg, snapAngles }) });
  }

  function pointerUp(event) {
    if (!drag) return;
    const moved = Math.hypot(
      event.clientX - drag.startedAt.x, event.clientY - drag.startedAt.y);
    // Taken from where the finger actually came up rather than from the last
    // move it reported. A quick flick can land with no move events in between,
    // and the wall would be committed at zero length.
    const here = toGround(event);
    const next = !here ? drag.to
      : drag.kind === 'vertex' ? onGrid(here)
        : snapTo(drag.anchor, here, { snapM, angleStepDeg, snapAngles });
    setDrag(null);
    if (!next) return;

    if (drag.kind === 'vertex') {
      if (moved < TAP_PX) return;
      onChange?.({ points: points.map((p, i) => (i === drag.index ? next : p)), closed });
      return;
    }

    // A tap rather than a drag. On an empty plan it is where the fence starts;
    // after that there is nothing it could sensibly mean.
    if (moved < TAP_PX) {
      if (!points.length) onChange?.({ points: [next], closed: false });
      return;
    }
    if (!points.length) {
      onChange?.({ points: [drag.anchor, next], closed: false });
      return;
    }

    // Let go on the first corner and the shape closes.
    const first = points[0];
    if (points.length >= 3 && Math.hypot(next.x - first.x, next.y - first.y) < unit * 3) {
      onChange?.({ points, closed: true });
      return;
    }

    // Carrying on in the same direction lengthens the wall rather than adding
    // a corner to the middle of it.
    const last = points[points.length - 1];
    const before = points.length >= 2 ? points[points.length - 2] : null;
    const heading = Math.atan2(next.y - last.y, next.x - last.x);
    if (before) {
      const was = Math.atan2(last.y - before.y, last.x - before.x);
      if (turnBetween(was, heading) < SAME_RUN_DEGREES) {
        onChange?.({ points: [...points.slice(0, -1), next], closed });
        return;
      }
    }
    onChange?.({ points: [...points, next], closed });
  }

  // ── Measurements ──────────────────────────────────────────────────────────

  const segs = useMemo(() => segmentsOf(live, closed), [live, closed]);
  // The closing edge of a shape is whatever length closes it, so it is shown
  // but not offered for editing.
  const editableUpto = closed ? segs.length - 1 : segs.length;

  function commitLength(i) {
    const metres = parseFloat(typed);
    setEditing(null);
    if (!(metres > 0)) return;
    onChange?.({ points: setSegmentLength(points, i, metres), closed });
  }

  // Where a label sits on screen, as a percentage of the plan, so the inputs
  // can be real HTML rather than something drawn inside the SVG.
  const place = p => ({
    left: `${((p.x - view.x0) / w) * 100}%`,
    top: `${((p.y - view.y0) / h) * 100}%`,
  });

  const previewLen = previewing
    ? Math.hypot(drag.to.x - drag.anchor.x, drag.to.y - drag.anchor.y) : 0;

  return (
    <div className={styles.wrap}>
      <div
        ref={boxRef}
        className={readOnly ? styles.plan : styles.planLive}
        style={{ aspectRatio: `${1} / ${shape}` }}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={() => setDrag(null)}
      >
        <svg
          className={styles.svg}
          viewBox={`${view.x0} ${view.y0} ${w} ${h}`}
          role="img"
          aria-label={points.length
            ? `Plan of ${segs.length} ${segs.length === 1 ? 'run' : 'runs'}, ${
              segs.reduce((s, g) => s + g.metres, 0).toFixed(1)} metres`
            : 'An empty plan'}
        >
          <defs>
            <pattern id="rpGrid" width={step} height={step} patternUnits="userSpaceOnUse">
              <path d={`M ${step} 0 L 0 0 0 ${step}`} fill="none"
                stroke="#e2e8f0" strokeWidth={w / 900} />
            </pattern>
          </defs>
          <rect x={view.x0} y={view.y0} width={w} height={h} fill="url(#rpGrid)" />

          {segs.map(s => (
            <line key={s.i} x1={s.a.x} y1={s.a.y} x2={s.b.x} y2={s.b.y}
              stroke={colour} strokeWidth={unit * 0.9} strokeLinecap="round" />
          ))}

          {/* Whatever the walls are made of — panels, posts, piles — drawn on
              top of the line so a gate can cut an opening out of it. */}
          {overlay?.({ points: live, closed, segs, view, unit })}

          {/* The wall being dragged out, with the grid line it is running
              along, so it is clear what it has snapped to. */}
          {previewing && previewLen > 0 && (
            <g>
              <line x1={drag.anchor.x} y1={view.y0} x2={drag.anchor.x} y2={view.y0 + h}
                stroke="#bfdbfe" strokeWidth={unit * 0.18} />
              <line x1={view.x0} y1={drag.anchor.y} x2={view.x0 + w} y2={drag.anchor.y}
                stroke="#bfdbfe" strokeWidth={unit * 0.18} />
              <line x1={drag.anchor.x} y1={drag.anchor.y} x2={drag.to.x} y2={drag.to.y}
                stroke={colour} strokeWidth={unit * 0.9} strokeLinecap="round"
                opacity="0.55" />
            </g>
          )}

          {/* Handles on the corners. Where the caller draws its own corners —
              posts, piles — only the one being moved is marked, so the plan
              does not end up with two things on every corner saying different
              things about it. */}
          {!readOnly && live.map((p, i) => (
            (overlay && drag?.index !== i) ? null : (
              <circle key={i} cx={p.x} cy={p.y} r={unit * (drag?.index === i ? 1.6 : 1)}
                fill={drag?.index === i ? 'none' : '#fff'}
                stroke={drag?.index === i ? '#2563eb' : colour}
                strokeWidth={unit * 0.35} />
            )
          ))}
        </svg>

        {/* ── The measurements, editable where they can be ── */}
        {segs.map(s => {
          const mid = { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 };
          const open = editing === s.i;
          if (open) {
            return (
              <div key={s.i} className={styles.chipEdit} style={place(mid)}
                onPointerDown={e => e.stopPropagation()}>
                <input
                  autoFocus type="number" min="0" step="0.1" inputMode="decimal"
                  aria-label={`Length of run ${s.i + 1} in metres`}
                  value={typed}
                  onChange={e => setTyped(e.target.value)}
                  onBlur={() => commitLength(s.i)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') commitLength(s.i);
                    if (e.key === 'Escape') setEditing(null);
                  }}
                />
                <span>m</span>
              </div>
            );
          }
          const fixed = readOnly || s.i >= editableUpto;
          return (
            <button
              key={s.i}
              type="button"
              className={fixed ? styles.chipFixed : styles.chip}
              style={place(mid)}
              disabled={fixed}
              title={fixed
                ? 'This one is whatever length closes the shape'
                : 'Tap to type an exact measurement'}
              onPointerDown={e => e.stopPropagation()}
              onClick={() => { setTyped(s.metres.toFixed(2)); setEditing(s.i); }}
            >
              {s.metres.toFixed(2)}m{labelFor ? labelFor(s) : ''}
            </button>
          );
        })}

        {/* What the wall being dragged measures, where the hand can see it. */}
        {previewing && previewLen > 0 && (
          <div className={styles.readout} style={place(drag.to)}>
            {previewLen.toFixed(2)}m
          </div>
        )}

        {!points.length && !drag && (
          <div className={styles.empty}>{hint}</div>
        )}
      </div>

      {!readOnly && (
        <div className={styles.bar}>
          <label className={styles.snap}>
            <input type="checkbox" checked={snapAngles}
              onChange={e => setSnapAngles(e.target.checked)} />
            Square to the grid
          </label>
          <span className={styles.spacer}>
            {points.length >= 3 && !closed && 'Finish on the first corner to close the shape'}
          </span>
          <button type="button" disabled={!points.length}
            onClick={() => (closed
              ? onChange?.({ points, closed: false })
              : onChange?.({ points: points.slice(0, -1), closed: false }))}>
            Undo
          </button>
          <button type="button" disabled={!points.length}
            onClick={() => onChange?.({ points: [], closed: false })}>
            Clear
          </button>
        </div>
      )}
    </div>
  );
}
