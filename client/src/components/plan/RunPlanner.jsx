import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import {
  snapTo, setSegmentLength, segmentsOf, turnAt, setTurnAt, appendRun, removeSegment,
  areaOf, perimeterOf, placeOnLine, pointOnLine, pruneObjects,
  zoomAt, fitView, gridFor, turnBetween, SAME_RUN_DEGREES, TAP_PX,
} from './planGeometry';
import styles from './RunPlanner.module.css';

// Drawing something on the ground.
//
// A fence, a retaining wall, the edge of a deck, the outline of a house — all
// the same drawing. Tap along the corners or drag out each wall, pinch to get
// closer, type over any measurement to make it exact, and drop a gate or a
// door onto the line where it goes.
//
// Deliberately knows nothing about what is being drawn. What the walls are
// made of is drawn on top through `overlay`, named through `labelFor`, and
// counted by whoever is using it. The geometry is in planGeometry.js, on its
// own, where it can be checked on paper.

export {
  snapTo, setSegmentLength, segmentsOf, turnAt, setTurnAt, appendRun, removeSegment,
  areaOf, perimeterOf, placeOnLine, pointOnLine, pruneObjects, fitView, gridFor,
};

// What the objects that can be dropped on a line look like. The caller says
// which of these it offers; nothing here assumes a fence.
export const PLAN_OBJECTS = {
  gate: { label: 'Gate', widthM: 1, colour: '#b45309', swing: true },
  door: { label: 'Door', widthM: 0.86, colour: '#0f766e', swing: true },
  window: { label: 'Window', widthM: 1.2, colour: '#0369a1', swing: false },
  opening: { label: 'Opening', widthM: 1, colour: '#64748b', swing: false },
};

const uid = () => Math.random().toString(36).slice(2, 10);

export default function RunPlanner({
  points = [],
  closed = false,
  // Things sitting on the line: gates, doors, windows. Each is
  // { id, kind, run, atM, widthM }.
  objects = [],
  onChange,
  // The ground: a metre grid, a tenth of a metre of precision, and walls that
  // run square or at 45° unless that is turned off for an odd boundary.
  snapM = 0.1,
  angleStepDeg = 45,
  minSpanM = 24,
  aspect = 1.6,             // the shape of the plan when it is not filling
  fill = false,             // take the height of whatever it is sitting in
  colour = '#1f2937',
  labelFor,                 // (segment) => extra text after the measurement
  overlay,                  // (ctx) => svg nodes drawn over the walls
  // Which of PLAN_OBJECTS may be dropped on the line. Empty offers none.
  objectKinds = [],
  // Shown for a closed outline, where the ground inside it is the point.
  showArea = false,
  hint = 'Tap the corners, or press and drag out each wall.',
  readOnly = false,
}) {
  const boxRef = useRef(null);
  const [drag, setDrag] = useState(null);
  const [cursor, setCursor] = useState(null);     // where the next corner would go
  const [editing, setEditing] = useState(null);
  const [typed, setTyped] = useState('');
  const [snapAngles, setSnapAngles] = useState(true);
  const [drawing, setDrawing] = useState(false);  // mid-chain, tapping corners
  const [panning, setPanning] = useState(false);  // the hand, for a mouse

  // The shape of the view has to be the shape of the box it is drawn in, or a
  // square drawn on it comes out a rectangle and a right angle comes out bent.
  const [shape, setShape] = useState(1 / aspect);
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setShape(height / width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Where the plan is looking.
  //
  // It frames what has been drawn until somebody moves it, and then it is
  // theirs. A view that keeps re-framing itself is one that moves the ground
  // out from under the finger drawing on it, and a view that never frames
  // itself opens on an empty patch miles from the fence.
  const [view, setView] = useState(() => fitView(points, 1 / aspect, { minSpan: minSpanM }));
  const [theirs, setTheirs] = useState(false);
  useEffect(() => {
    if (theirs) return;
    setView(v => {
      if (!points.length) return fitView([], shape, { minSpan: minSpanM });
      // Only when the drawing has run off the edge, and never to re-centre on
      // what is already on screen. A view that reframes itself after every
      // corner moves the ground out from under the finger putting the next
      // one down — tap twelve metres along and the second tap lands at seven,
      // because the scale changed between them.
      const edge = v.span * 0.05;
      const fits = points.every(p =>
        p.x >= v.x0 + edge && p.x <= v.x0 + v.span - edge
        && p.y >= v.y0 + edge && p.y <= v.y0 + v.span * shape - edge);
      return fits ? v : fitView(points, shape, { minSpan: minSpanM });
    });
  }, [points, shape, minSpanM, theirs]);

  const w = view.span;
  const h = view.span * shape;
  const step = gridFor(w);
  // One ground metre as a fraction of the view, for sizing marks that should
  // look the same however far in the plan is zoomed.
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

  const live = drag?.kind === 'vertex'
    ? points.map((p, i) => (i === drag.index ? drag.to : p))
    : points;
  const segs = useMemo(() => segmentsOf(live, closed), [live, closed]);
  const held = pruneObjects(objects, live, closed);

  // ── Zooming and moving about ──────────────────────────────────────────────

  const zoom = useCallback((factor, focus) => {
    setTheirs(true);
    setView(v => zoomAt(v, focus || { x: v.x0 + v.span / 2, y: v.y0 + (v.span * shape) / 2 },
      factor, { minSpan: 1, maxSpan: 4000 }));
  }, [shape]);

  function onWheel(event) {
    if (readOnly) return;
    event.preventDefault();
    const at = toGround(event);
    if (at) zoom(event.deltaY < 0 ? 1.18 : 1 / 1.18, at);
  }

  // Two fingers: pinch to zoom, and move them together to move the plan.
  const pinch = useRef(null);
  const touches = useRef(new Map());

  function startPinch() {
    const two = [...touches.current.values()].slice(0, 2);
    if (two.length < 2) return;
    pinch.current = {
      gap: Math.hypot(two[0].x - two[1].x, two[0].y - two[1].y),
      mid: { x: (two[0].x + two[1].x) / 2, y: (two[0].y + two[1].y) / 2 },
      view,
    };
    setDrag(null);
    setDrawing(false);
  }

  function movePinch() {
    const two = [...touches.current.values()].slice(0, 2);
    if (two.length < 2 || !pinch.current) return;
    const box = boxRef.current?.getBoundingClientRect();
    if (!box) return;
    const gap = Math.hypot(two[0].x - two[1].x, two[0].y - two[1].y);
    const mid = { x: (two[0].x + two[1].x) / 2, y: (two[0].y + two[1].y) / 2 };
    const start = pinch.current;
    const factor = start.gap > 0 ? gap / start.gap : 1;

    // Zoom about the point between the fingers, then slide by however far
    // that point has travelled, so the plan follows the hand.
    const spanBefore = start.view.span;
    const span = Math.min(4000, Math.max(1, spanBefore / factor));
    const k = span / spanBefore;
    const focusGround = {
      x: start.view.x0 + ((start.mid.x - box.left) / box.width) * spanBefore,
      y: start.view.y0 + ((start.mid.y - box.top) / box.height) * spanBefore * shape,
    };
    const moved = {
      x: ((mid.x - start.mid.x) / box.width) * span,
      y: ((mid.y - start.mid.y) / box.height) * span * shape,
    };
    setTheirs(true);
    setView({
      x0: focusGround.x - (focusGround.x - start.view.x0) * k - moved.x,
      y0: focusGround.y - (focusGround.y - start.view.y0) * k - moved.y,
      span,
    });
  }

  // ── Drawing ───────────────────────────────────────────────────────────────

  // Where the next corner would land: square to the wall before it, and on
  // the grid. The same answer whether it came from a drag or from hovering
  // between taps.
  const aim = useCallback(raw => {
    const anchor = points.length ? points[points.length - 1] : null;
    if (!anchor) return onGrid(raw);
    return snapTo(anchor, raw, { snapM, angleStepDeg, snapAngles });
  }, [points, onGrid, snapM, angleStepDeg, snapAngles]);

  // Would this land on the first corner and close the shape?
  const closesHere = useCallback(at => {
    if (closed || points.length < 3 || !at) return false;
    return Math.hypot(at.x - points[0].x, at.y - points[0].y) < Math.max(0.3, unit * 3);
  }, [closed, points, unit]);

  function addCorner(at) {
    if (closesHere(at)) {
      onChange?.({ points, closed: true, objects: held });
      setDrawing(false);
      setCursor(null);
      return;
    }
    if (!points.length) { onChange?.({ points: [at], closed: false, objects: held }); return; }

    // Carrying on in the same direction lengthens the wall rather than adding
    // a corner to the middle of it.
    const last = points[points.length - 1];
    const before = points.length >= 2 ? points[points.length - 2] : null;
    const heading = Math.atan2(at.y - last.y, at.x - last.x);
    if (Math.hypot(at.x - last.x, at.y - last.y) < snapM) return;
    if (before) {
      const was = Math.atan2(last.y - before.y, last.x - before.x);
      if (turnBetween(was, heading) < SAME_RUN_DEGREES) {
        onChange?.({ points: [...points.slice(0, -1), at], closed, objects: held });
        return;
      }
    }
    onChange?.({ points: [...points, at], closed, objects: held });
  }

  function pointerDown(event) {
    if (readOnly || editing !== null) return;
    touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touches.current.size === 2) { startPinch(); return; }
    if (touches.current.size > 2) return;

    const g = toGround(event);
    if (!g) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const startedAt = { x: event.clientX, y: event.clientY };

    if (panning) { setDrag({ kind: 'pan', startedAt, view }); return; }

    // Something sitting on the line is picked up before the line is.
    const grabObject = held.find(o => {
      const at = pointOnLine(live, closed, o.run, o.atM);
      return at && Math.hypot(at.x - g.x, at.y - g.y) < unit * 2.5;
    });
    if (grabObject) { setDrag({ kind: 'object', id: grabObject.id, startedAt }); return; }

    // A press on a corner picks that corner up to move it — except the open
    // end of the drawing, which is the pen tip.
    const tip = closed ? -1 : live.length - 1;
    const grab = live.findIndex((p, i) =>
      i !== tip && Math.hypot(p.x - g.x, p.y - g.y) < unit * 2.5);
    if (grab >= 0) {
      setDrag({ kind: 'vertex', index: grab, to: live[grab], startedAt });
      return;
    }

    setDrag({ kind: 'draw', anchor: points.length ? points[points.length - 1] : onGrid(g), to: aim(g), startedAt });
  }

  function pointerMove(event) {
    if (touches.current.has(event.pointerId)) {
      touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    if (touches.current.size >= 2) { movePinch(); return; }

    const g = toGround(event);
    if (!g) return;

    if (!drag) {
      // Hovering between taps, so the next wall can be seen before it is
      // committed. Only a mouse ever does this; a finger is either down or
      // somewhere else entirely.
      if (drawing && points.length && event.pointerType !== 'touch') setCursor(aim(g));
      return;
    }
    if (drag.kind === 'pan') {
      const box = boxRef.current?.getBoundingClientRect();
      if (!box) return;
      setTheirs(true);
      setView({
        x0: drag.view.x0 - ((event.clientX - drag.startedAt.x) / box.width) * drag.view.span,
        y0: drag.view.y0 - ((event.clientY - drag.startedAt.y) / box.height) * drag.view.span * shape,
        span: drag.view.span,
      });
      return;
    }
    if (drag.kind === 'vertex') { setDrag({ ...drag, to: onGrid(g) }); return; }
    if (drag.kind === 'object') {
      const where = placeOnLine(live, closed, g);
      if (where) {
        onChange?.({
          points, closed,
          objects: held.map(o => (o.id === drag.id ? { ...o, run: where.run, atM: where.atM } : o)),
        });
      }
      return;
    }
    setDrag({ ...drag, to: aim(g) });
  }

  function pointerUp(event) {
    touches.current.delete(event.pointerId);
    if (touches.current.size < 2) pinch.current = null;
    if (!drag) return;

    const moved = Math.hypot(
      event.clientX - drag.startedAt.x, event.clientY - drag.startedAt.y);
    const here = toGround(event);
    setDrag(null);
    if (drag.kind === 'pan' || drag.kind === 'object') return;
    if (!here) return;

    if (drag.kind === 'vertex') {
      if (moved < TAP_PX) return;
      onChange?.({
        points: points.map((p, i) => (i === drag.index ? onGrid(here) : p)),
        closed, objects: held,
      });
      return;
    }

    // A tap puts a corner down and leaves the pen on the paper. A drag draws
    // the wall in one go. Both end up in the same place; which one somebody
    // uses is whether they are on a phone or a mouse.
    if (moved < TAP_PX) {
      addCorner(aim(here));
      setDrawing(true);
      setCursor(null);
      return;
    }
    addCorner(snapTo(drag.anchor, here, { snapM, angleStepDeg, snapAngles }));
    setDrawing(true);
  }

  // Finishing a chain, by keyboard or by the button.
  const stopDrawing = useCallback(() => { setDrawing(false); setCursor(null); }, []);
  useEffect(() => {
    if (!drawing) return undefined;
    const key = e => {
      if (e.key === 'Enter' || e.key === 'Escape') stopDrawing();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [drawing, stopDrawing]);

  // ── Measurements ──────────────────────────────────────────────────────────

  const editableUpto = closed ? segs.length - 1 : segs.length;

  function commitLength(i) {
    const metres = parseFloat(typed);
    setEditing(null);
    if (!(metres > 0)) return;
    onChange?.({ points: setSegmentLength(points, i, metres), closed, objects: held });
  }

  const place = p => ({
    left: `${((p.x - view.x0) / w) * 100}%`,
    top: `${((p.y - view.y0) / h) * 100}%`,
  });

  const preview = drag?.kind === 'draw' ? drag.to : (drawing ? cursor : null);
  const previewFrom = drag?.kind === 'draw' ? drag.anchor
    : (points.length ? points[points.length - 1] : null);
  const previewLen = preview && previewFrom
    ? Math.hypot(preview.x - previewFrom.x, preview.y - previewFrom.y) : 0;

  const area = showArea && closed ? areaOf(live) : 0;
  const around = perimeterOf(live, closed);

  function addObject(kind) {
    const spec = PLAN_OBJECTS[kind];
    if (!spec || !segs.length) return;
    // Dropped in the middle of the longest wall, where there is most room for
    // it, and dragged from there to where it really goes.
    const longest = segs.reduce((a, b) => (b.metres > a.metres ? b : a), segs[0]);
    onChange?.({
      points, closed,
      objects: [...held, { id: uid(), kind, run: longest.i, atM: longest.metres / 2, widthM: spec.widthM }],
    });
  }
  function dropObject(id) {
    onChange?.({ points, closed, objects: held.filter(o => o.id !== id) });
  }

  return (
    <div className={fill ? styles.wrapFill : styles.wrap}>
      <div
        ref={boxRef}
        className={readOnly ? styles.plan : (panning ? styles.planPan : styles.planLive)}
        style={fill ? undefined : { aspectRatio: `${aspect} / 1` }}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={e => { touches.current.delete(e.pointerId); setDrag(null); }}
        onPointerLeave={() => setCursor(null)}
        onWheel={onWheel}
      >
        <svg
          className={styles.svg}
          viewBox={`${view.x0} ${view.y0} ${w} ${h}`}
          role="img"
          aria-label={points.length
            ? `Plan of ${segs.length} ${segs.length === 1 ? 'wall' : 'walls'}, ${around.toFixed(1)} metres`
            : 'An empty plan'}
        >
          <defs>
            <pattern id={`rpGrid${step}`} width={step} height={step} patternUnits="userSpaceOnUse">
              <path d={`M ${step} 0 L 0 0 0 ${step}`} fill="none"
                stroke="#e2e8f0" strokeWidth={w / 900} />
            </pattern>
          </defs>
          <rect x={view.x0} y={view.y0} width={w} height={h} fill={`url(#rpGrid${step})`} />

          {/* The ground inside a closed outline, which on a deck is the whole
              point of drawing it. */}
          {closed && live.length > 2 && (
            <polygon
              points={live.map(p => `${p.x},${p.y}`).join(' ')}
              fill={colour} fillOpacity="0.07" stroke="none"
            />
          )}

          {segs.map(s => (
            <line key={s.i} x1={s.a.x} y1={s.a.y} x2={s.b.x} y2={s.b.y}
              stroke={colour} strokeWidth={unit * 0.9} strokeLinecap="round" />
          ))}

          {overlay?.({ points: live, closed, segs, view, unit, objects: held })}

          {/* Gates, doors and windows, drawn where they were dropped: a gap in
              the wall, and the leaf swung out of it where it has one. */}
          {held.map(o => {
            const spec = PLAN_OBJECTS[o.kind] || PLAN_OBJECTS.opening;
            const at = pointOnLine(live, closed, o.run, o.atM);
            if (!at) return null;
            const half = (o.widthM || spec.widthM) / 2;
            const a = { x: at.x - at.ux * half, y: at.y - at.uy * half };
            const b = { x: at.x + at.ux * half, y: at.y + at.uy * half };
            const leaf = { x: a.x + at.uy * half * 2, y: a.y - at.ux * half * 2 };
            return (
              <g key={o.id}>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                  stroke="#f8fafc" strokeWidth={unit * 1.25} strokeLinecap="butt" />
                {spec.swing && (
                  <line x1={a.x} y1={a.y} x2={leaf.x} y2={leaf.y}
                    stroke={spec.colour} strokeWidth={unit * 0.5}
                    strokeDasharray={`${unit * 0.8} ${unit * 0.6}`} />
                )}
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                  stroke={spec.colour} strokeWidth={unit * 0.45} strokeLinecap="round" />
              </g>
            );
          })}

          {/* The wall being drawn, with the grid lines it is running along. */}
          {preview && previewFrom && previewLen > 0 && (
            <g>
              <line x1={previewFrom.x} y1={view.y0} x2={previewFrom.x} y2={view.y0 + h}
                stroke="#bfdbfe" strokeWidth={unit * 0.18} />
              <line x1={view.x0} y1={previewFrom.y} x2={view.x0 + w} y2={previewFrom.y}
                stroke="#bfdbfe" strokeWidth={unit * 0.18} />
              <line x1={previewFrom.x} y1={previewFrom.y} x2={preview.x} y2={preview.y}
                stroke={colour} strokeWidth={unit * 0.9} strokeLinecap="round" opacity="0.55" />
              {closesHere(preview) && (
                <circle cx={points[0].x} cy={points[0].y} r={unit * 2}
                  fill="none" stroke="#16a34a" strokeWidth={unit * 0.4} />
              )}
            </g>
          )}

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
          if (editing === s.i) {
            return (
              <div key={s.i} className={styles.chipEdit} style={place(mid)}
                onPointerDown={e => e.stopPropagation()}>
                <input
                  autoFocus type="number" min="0" step="0.1" inputMode="decimal"
                  aria-label={`Length of wall ${s.i + 1} in metres`}
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

        {/* Something on the line, with a handle to drag it along and a way to
            take it off again. */}
        {/* The label sits on top of the thing it names, which is also exactly
            where a finger goes to drag it. So the label does not swallow the
            press — it falls through to the plan, which picks the gate up —
            and only the ✕ on the end of it takes the gate off. */}
        {!readOnly && held.map(o => {
          const at = pointOnLine(live, closed, o.run, o.atM);
          if (!at) return null;
          const spec = PLAN_OBJECTS[o.kind] || PLAN_OBJECTS.opening;
          return (
            <div key={o.id} className={styles.objectTag}
              style={{ ...place(at), borderColor: spec.colour, color: spec.colour }}
              title={`${spec.label} — drag it along the line to move it`}
            >
              {spec.label} {(o.widthM || spec.widthM).toFixed(2)}m
              <button type="button" className={styles.objectOff}
                aria-label={`Take the ${spec.label.toLowerCase()} off`}
                onPointerDown={e => e.stopPropagation()}
                onClick={() => dropObject(o.id)}
              >
                ✕
              </button>
            </div>
          );
        })}

        {preview && previewFrom && previewLen > 0 && (
          <div className={styles.readout} style={place(preview)}>
            {previewLen.toFixed(2)}m
          </div>
        )}

        {!points.length && !drag && <div className={styles.empty}>{hint}</div>}

        {/* Zoom, where a thumb can reach it. */}
        {!readOnly && (
          <div className={styles.zoom}>
            <button type="button" onClick={() => zoom(1.4)} title="Closer">+</button>
            <button type="button" onClick={() => zoom(1 / 1.4)} title="Further out">−</button>
            <button type="button" title="Frame what is drawn"
              onClick={() => { setTheirs(false); setView(fitView(points, shape, { minSpan: minSpanM })); }}>
              ⤢
            </button>
          </div>
        )}
      </div>

      {!readOnly && (
        <div className={styles.bar}>
          <label className={styles.snap}>
            <input type="checkbox" checked={snapAngles}
              onChange={e => setSnapAngles(e.target.checked)} />
            Square to the grid
          </label>
          <button type="button" className={panning ? styles.toolOn : styles.tool}
            onClick={() => setPanning(p => !p)}
            title="Move the plan about instead of drawing on it">
            ✋ Move
          </button>
          {objectKinds.map(kind => (
            <button type="button" key={kind} className={styles.tool}
              disabled={!segs.length}
              onClick={() => addObject(kind)}>
              + {PLAN_OBJECTS[kind]?.label || kind}
            </button>
          ))}
          <span className={styles.spacer}>
            {drawing && points.length >= 3 && !closed && 'Finish on the first corner to close it'}
            {showArea && closed && area > 0 && `${area.toFixed(1)}m² · ${around.toFixed(1)}m round`}
          </span>
          {drawing && (
            <button type="button" className={styles.tool} onClick={stopDrawing}>Done</button>
          )}
          <button type="button" disabled={!points.length}
            onClick={() => (closed
              ? onChange?.({ points, closed: false, objects: held })
              : onChange?.({ points: points.slice(0, -1), closed: false, objects: held }))}>
            Undo
          </button>
          <button type="button" disabled={!points.length}
            onClick={() => { stopDrawing(); onChange?.({ points: [], closed: false, objects: [] }); }}>
            Clear
          </button>
        </div>
      )}
    </div>
  );
}
