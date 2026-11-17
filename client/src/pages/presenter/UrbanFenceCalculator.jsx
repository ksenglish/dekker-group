import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import api from '../../lib/api';
import {
  buildCatalogue, suggestPost, postsFor, takeOff, priceUp,
  runsFromPoints, runVertices, DEFAULT_EMBEDMENT_MM,
} from './urbanFence';
import styles from './SalesPresenter.module.css';
import own from './UrbanFenceCalculator.module.css';

// Quoting an Urban Group fence in front of the customer.
//
// The fence itself is the easy part — pick a range, a height and a colour. The
// part that costs money when it is wrong is the posts: one more than the
// panels, a shared one at every corner, two at every gate. Counting those on a
// clipboard is where a quote goes under, and it is the reason this exists
// rather than a per-metre rate.
//
// The ranges, heights, colours, panel widths and post lengths are all read off
// the Price List. Nothing about Urban's range is written down in here, because
// the list is already the record of what we sell and a second copy of it would
// drift without anybody noticing until a quote went out wrong.

// What a fence is drawn on when nothing has been put in yet, in metres. Big
// enough for a suburban boundary without zooming.
const EMPTY_VIEW = 24;
// The plan is 16 : 10, which the view has to match or a drawn square comes out
// a rectangle.
const SHAPE = 0.625;
const SNAP_M = 0.25;
// A drawn line within this of square gets squared up. A boundary is drawn with
// a finger, not a set square.
const SQUARE_DEGREES = 7;

const LABOUR_KEY = 'urbanFenceLabour';

const money = cents => (cents / 100).toLocaleString('en-NZ', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

// The rates are the installer's, not the Price List's, so they live on the
// device that quotes with them rather than being retyped every job.
function loadLabour() {
  try {
    const held = JSON.parse(localStorage.getItem(LABOUR_KEY) || '{}');
    return {
      perMetre: held.perMetre ?? '',
      perPost: held.perPost ?? '',
      perGate: held.perGate ?? '',
    };
  } catch {
    return { perMetre: '', perPost: '', perGate: '' };
  }
}

// ── The plan ────────────────────────────────────────────────────────────────
//
// One drawing for both ways of putting a fence in. Typed lengths are turned
// into a line on the ground the same as drawn ones, so the customer sees the
// shape either way and a corner that was typed by mistake is visible rather
// than buried in a number.

// Typed runs, laid out as a line: east to start, then turning as told.
function pointsFromRuns(runs) {
  const pts = [{ x: 0, y: 0 }];
  let heading = 0;   // radians, 0 = east
  runs.forEach((r, i) => {
    const m = parseFloat(r.m) || 0;
    if (i > 0) heading += (r.turn === 'right' ? Math.PI / 2 : -Math.PI / 2);
    if (m <= 0) return;
    const last = pts[pts.length - 1];
    pts.push({ x: last.x + Math.cos(heading) * m, y: last.y + Math.sin(heading) * m });
  });
  return pts;
}

function FencePlan({ points, closed, plan, drawing, onPoint, hex }) {
  const svgRef = useRef(null);

  // What the plan is looking at, fitted to the fence with room round it.
  const fitted = useMemo(() => {
    if (!points.length) {
      return { x0: -EMPTY_VIEW / 2, y0: -(EMPTY_VIEW * SHAPE) / 2, span: EMPTY_VIEW };
    }
    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    // Doubling rather than fitting exactly, so the scale changes rarely and in
    // steps instead of creeping with every point.
    const need = Math.max(
      (Math.max(...xs) - Math.min(...xs)) * 1.3,
      ((Math.max(...ys) - Math.min(...ys)) * 1.3) / SHAPE,
    );
    let span = EMPTY_VIEW;
    while (span < need) span *= 2;
    return { x0: cx - span / 2, y0: cy - (span * SHAPE) / 2, span };
  }, [points]);

  // The ground under a drawing has to hold still.
  //
  // A view that refits after every point moves the plan under the finger: the
  // second tap lands somewhere else entirely because the scale changed between
  // the two, and a 12m run came out as 2.5m on the first try at this. So while
  // the fence is being drawn the view is a fixed patch of ground, and it only
  // moves when the fence runs off the edge of it.
  const [held, setHeld] = useState(null);
  useEffect(() => {
    if (!drawing) { setHeld(null); return; }
    setHeld(prev => {
      const patch = prev || { x0: -EMPTY_VIEW / 2, y0: -(EMPTY_VIEW * SHAPE) / 2, span: EMPTY_VIEW };
      const fits = points.every(p =>
        p.x >= patch.x0 && p.x <= patch.x0 + patch.span
        && p.y >= patch.y0 && p.y <= patch.y0 + patch.span * SHAPE);
      return fits ? patch : fitted;
    });
  }, [drawing, points, fitted]);

  const bounds = drawing ? (held || fitted) : fitted;
  const w = bounds.span;
  const h = bounds.span * SHAPE;
  const step = w > 40 ? 5 : 1;

  // A click on the plan is a point on the ground, snapped to the quarter metre
  // and squared up to the run before it, because a boundary drawn with a
  // finger is never quite square and a fence always is.
  const handleClick = useCallback(event => {
    // A closed fence has nowhere left to add a corner; Undo opens it again.
    if (!drawing || !onPoint || closed) return;
    const box = svgRef.current?.getBoundingClientRect();
    if (!box) return;
    const x = bounds.x0 + ((event.clientX - box.left) / box.width) * w;
    const y = bounds.y0 + ((event.clientY - box.top) / box.height) * h;
    const snap = v => Math.round(v / SNAP_M) * SNAP_M;
    let next = { x: snap(x), y: snap(y) };

    const last = points[points.length - 1];
    if (last) {
      const dx = next.x - last.x;
      const dy = next.y - last.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      const deg = Math.abs(Math.atan2(dy, dx) * (180 / Math.PI));
      if (len > 0 && Math.min(deg % 90, 90 - (deg % 90)) < SQUARE_DEGREES) {
        next = Math.abs(dx) > Math.abs(dy)
          ? { x: snap(last.x + Math.sign(dx) * len), y: last.y }
          : { x: last.x, y: snap(last.y + Math.sign(dy) * len) };
      }
      // Back on the first point closes the fence off.
      const first = points[0];
      const home = Math.hypot(next.x - first.x, next.y - first.y);
      if (points.length > 2 && home < Math.max(1, w * 0.03)) { onPoint(null, true); return; }
    }
    onPoint(next, false);
  }, [drawing, onPoint, bounds, w, h, points, closed]);

  // Drawn from the fence's corners, not from the taps that made them: three
  // taps down one straight boundary are one run, and the take-off counts them
  // as one, so the drawing has to as well or the gate and the panel marks land
  // on the wrong run.
  const verts = useMemo(() => runVertices(points, closed), [points, closed]);
  const segs = [];
  const upto = closed ? verts.length : verts.length - 1;
  for (let i = 0; i < upto; i++) {
    segs.push([verts[i], verts[(i + 1) % verts.length]]);
  }

  // Posts: both ends of every run. A corner is shared, so drawing them as a
  // set rather than per run is also what makes the picture agree with the
  // count beside it.
  const nodes = verts.map((p, i) => ({
    ...p,
    kind: closed ? 'corner'
      : i === 0 || i === verts.length - 1 ? 'end' : 'corner',
  }));

  return (
    <svg
      ref={svgRef}
      className={drawing ? own.planDrawing : own.plan}
      viewBox={`${bounds.x0} ${bounds.y0} ${w} ${h}`}
      onClick={handleClick}
      role={drawing ? 'button' : 'img'}
      aria-label={plan
        ? `Fence plan, ${plan.totalMetres} metres in ${plan.runCount} ${plan.runCount === 1 ? 'run' : 'runs'}`
        : 'Fence plan'}
    >
      {/* A metre grid, so a length can be read off the drawing. */}
      <defs>
        <pattern id="ufGrid" width={step} height={step} patternUnits="userSpaceOnUse">
          <path d={`M ${step} 0 L 0 0 0 ${step}`} fill="none"
            stroke="#e2e8f0" strokeWidth={w / 900} />
        </pattern>
      </defs>
      <rect x={bounds.x0} y={bounds.y0} width={w} height={h} fill="url(#ufGrid)" />

      {segs.map(([a, b], i) => {
        const panels = plan?.panelsPerRun?.[i] ?? 0;
        const hasGate = plan?.gateRuns?.includes(i);
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        const ux = len ? (b.x - a.x) / len : 0;
        const uy = len ? (b.y - a.y) / len : 0;
        const panelM = (plan?.panelWidthMm || 0) / 1000;
        // Where one panel ends and the next starts: the line posts. Drawn from
        // the count the take-off gives this run, so the picture cannot say one
        // thing and the figures another.
        const joints = [];
        for (let n = 1; n < panels; n++) {
          const at = Math.min(n * panelM, len);
          joints.push({ x: a.x + ux * at, y: a.y + uy * at });
        }
        // The gate opening sits at the far end of the run the take-off put it
        // in, drawn as a gap in the fence with the leaf swung open.
        const gateM = hasGate ? plan.gates * (plan.gateWidthM || 0) : 0;
        const gap = { x: b.x - ux * gateM, y: b.y - uy * gateM };
        const leaf = {
          x: gap.x + uy * (plan?.gateWidthM || 0),
          y: gap.y - ux * (plan?.gateWidthM || 0),
        };
        return (
          <g key={i}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke={hex} strokeWidth={w / 110} strokeLinecap="round" />
            {joints.map((j, n) => (
              <circle key={n} cx={j.x} cy={j.y} r={w / 260} fill="#475569" />
            ))}
            {gateM > 0 && (
              <g>
                {/* The opening, cut out of the fence line. */}
                <line x1={gap.x} y1={gap.y} x2={b.x} y2={b.y}
                  stroke="#f1f5f9" strokeWidth={w / 95} strokeLinecap="butt" />
                {/* The leaf, swung open on the first post of the opening. */}
                <line x1={gap.x} y1={gap.y} x2={leaf.x} y2={leaf.y}
                  stroke="#b45309" strokeWidth={w / 180}
                  strokeDasharray={`${w / 120} ${w / 160}`} />
              </g>
            )}
            <text
              className={own.runLabel}
              x={(a.x + b.x) / 2 + uy * (w / 42)}
              y={(a.y + b.y) / 2 - ux * (w / 42)}
              fontSize={w / 32}
              textAnchor="middle"
            >
              {len.toFixed(2)}m{panels ? ` · ${panels}` : ''}
            </text>
          </g>
        );
      })}

      {nodes.map((n, i) => (
        <circle key={i} cx={n.x} cy={n.y}
          r={n.kind === 'end' ? w / 150 : w / 120}
          fill={n.kind === 'end' ? '#0f172a' : '#b91c1c'}
          stroke="#fff" strokeWidth={w / 500} />
      ))}

      {drawing && points.length > 0 && !closed && (
        <text className={own.hint} x={bounds.x0 + w / 2} y={bounds.y0 + h - w / 50}
          fontSize={w / 40} textAnchor="middle">
          {points.length > 2
            ? 'Tap the next corner — or tap the first post again to close the fence'
            : 'Tap the next corner'}
        </text>
      )}
    </svg>
  );
}

// ── The calculator ──────────────────────────────────────────────────────────

export default function UrbanFenceCalculator({ product, onPick, onQuantityChange, onRecommend }) {
  const [priceList, setPriceList] = useState([]);
  const [range, setRange] = useState('');
  const [heightMm, setHeightMm] = useState(0);
  const [finish, setFinish] = useState('');

  const [mode, setMode] = useState('type');
  const [typed, setTyped] = useState([{ m: '', turn: 'left' }]);
  const [points, setPoints] = useState([]);
  const [closedLoop, setClosedLoop] = useState(false);

  const [gateSku, setGateSku] = useState('');
  const [gateCount, setGateCount] = useState(0);
  const [gateWidthMm, setGateWidthMm] = useState(0);

  const [basePlate, setBasePlate] = useState(false);
  const [postSku, setPostSku] = useState('');
  const [labour, setLabour] = useState(loadLabour);

  useEffect(() => {
    api.get('/products').then(r => setPriceList(r.data)).catch(() => {});
  }, []);
  useEffect(() => {
    try { localStorage.setItem(LABOUR_KEY, JSON.stringify(labour)); } catch { /* private window */ }
  }, [labour]);

  // A presenter product can have an install item linked to it in Presenter
  // Admin — the labour line priced alongside the fence. Where one is set it
  // fills the per-metre rate in, so a device that has never quoted a fence
  // still opens on the business's own rate rather than on nothing. Still
  // editable: what the rate should be is the salesperson's call on the day.
  const installRate = product?.install_product?.unit_price;
  useEffect(() => {
    if (!installRate) return;
    setLabour(l => (l.perMetre === '' ? { ...l, perMetre: String(installRate / 100) } : l));
  }, [installRate]);

  const cat = useMemo(() => buildCatalogue(priceList), [priceList]);

  const ranges = useMemo(
    () => [...new Set(cat.panels.map(p => p.range))].sort(),
    [cat]);
  // The first range on the list once the Price List has loaded, so the
  // calculator opens on something rather than on nothing.
  useEffect(() => {
    if (!range && ranges.length) setRange(ranges[0]);
  }, [range, ranges]);

  const inRange = useMemo(
    () => cat.panels.filter(p => p.range === range),
    [cat, range]);
  const heights = useMemo(
    () => [...new Set(inRange.map(p => p.heightMm))].sort((a, b) => a - b),
    [inRange]);
  useEffect(() => {
    if (heights.length && !heights.includes(heightMm)) setHeightMm(heights[0]);
  }, [heights, heightMm]);

  const atHeight = useMemo(
    () => inRange.filter(p => p.heightMm === heightMm),
    [inRange, heightMm]);
  const finishes = useMemo(
    () => [...new Set(atHeight.map(p => p.finish))],
    [atHeight]);
  useEffect(() => {
    if (finishes.length && !finishes.includes(finish)) setFinish(finishes[0]);
  }, [finishes, finish]);

  const panel = useMemo(
    () => atHeight.find(p => p.finish === finish) || atHeight[0] || null,
    [atHeight, finish]);

  // The posts that suit this fence, shortest first, with the suggestion at the
  // top of the list and the rest there to be overridden — ground conditions
  // decide this and the ground is not on the Price List.
  const suggested = useMemo(() => (panel
    ? suggestPost(cat.posts, {
      heightMm: panel.heightMm, basePlate, range: panel.range, finish: panel.finish,
    })
    : null), [cat, panel, basePlate]);
  const postChoices = useMemo(() => postsFor(cat.posts, {
    basePlate, range: panel?.range, finish: panel?.finish,
  }), [cat, basePlate, panel]);
  const post = useMemo(
    () => postChoices.find(p => p.sku === postSku) || suggested,
    [postChoices, postSku, suggested]);

  const gateChoices = useMemo(
    () => cat.gates.filter(g => g.range === range
      && (!g.heightMm || g.heightMm === heightMm || heights.length === 1)),
    [cat, range, heightMm, heights]);
  const gate = useMemo(
    () => gateChoices.find(g => g.sku === gateSku) || null,
    [gateChoices, gateSku]);
  // A gate kit sized by its stile rather than its opening leaves the opening to
  // be typed; everything else brings its own width.
  useEffect(() => {
    if (gate?.widthMm) setGateWidthMm(gate.widthMm);
  }, [gate]);

  // The two ways in, both ending in the same list of runs.
  const drawnRuns = useMemo(() => runsFromPoints(points, closedLoop), [points, closedLoop]);
  const typedRuns = useMemo(
    () => typed.map(r => parseFloat(r.m)).filter(n => Number.isFinite(n) && n > 0),
    [typed]);
  const runs = mode === 'draw' ? drawnRuns : typedRuns;

  const plan = useMemo(() => {
    const got = takeOff({
      runs,
      panelWidthMm: panel?.widthMm || 0,
      closedLoop,
      gates: gate ? gateCount : 0,
      gateWidthMm: gate ? gateWidthMm : 0,
      postsIncluded: !!panel?.includesPosts,
    });
    return got ? { ...got, gateWidthM: gateWidthMm / 1000 } : null;
  }, [runs, panel, closedLoop, gate, gateCount, gateWidthMm]);

  const total = useMemo(() => priceUp({
    plan,
    panel,
    post,
    gate,
    labourPerMetre: parseFloat(labour.perMetre) || 0,
    labourPerPost: parseFloat(labour.perPost) || 0,
    labourPerGate: parseFloat(labour.perGate) || 0,
  }), [plan, panel, post, gate, labour]);

  // The panel at the top of the product panel follows the selection, so the
  // customer is looking at the fence being discussed.
  useEffect(() => {
    onRecommend?.(panel?.product || undefined);
    return () => onRecommend?.(undefined);
  }, [panel, onRecommend]);
  useEffect(() => {
    onQuantityChange?.(plan ? plan.fenceMetres : 0);
  }, [plan, onQuantityChange]);

  const planPoints = mode === 'draw' ? points : pointsFromRuns(typed);

  function addPoint(pt, close) {
    if (close) { setClosedLoop(true); return; }
    setPoints(ps => [...ps, pt]);
  }

  function addToQuote() {
    if (!plan || !panel) return;
    onPick({ ...panel.product, quantity: plan.panels });
    if (post && plan.posts > 0) onPick({ ...post.product, quantity: plan.posts });
    if (gate && plan.gates > 0) onPick({ ...gate.product, quantity: plan.gates });
  }

  const hex = finish.toLowerCase().includes('white') ? '#94a3b8' : '#1f2937';

  return (
    <div className={styles.calc}>
      <h3 className={styles.calcTitle}>Urban Group Fence Calculator</h3>
      <p className={own.sub}>
        Panels, posts and gates off the Price List · end and corner posts counted
      </p>

      {/* ── What fence ── */}
      <div className={`${styles.calcGrid} ${own.grid}`}>
        <div className={styles.calcField}>
          <label>Range</label>
          <select value={range} onChange={e => { setRange(e.target.value); setGateSku(''); setPostSku(''); }}>
            {ranges.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div className={styles.calcField}>
          <label>Height</label>
          <select value={heightMm} onChange={e => setHeightMm(Number(e.target.value))}>
            {heights.map(h => <option key={h} value={h}>{h}mm</option>)}
          </select>
        </div>
        <div className={styles.calcField}>
          <label>Colour</label>
          <select value={finish} onChange={e => setFinish(e.target.value)}>
            {finishes.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
      </div>

      {panel && (
        <p className={own.picked}>
          {panel.name} · <strong>{panel.widthMm}mm</strong> wide
          {panel.unitPrice > 0 && <> · ${money(panel.unitPrice)} each + GST</>}
        </p>
      )}

      {/* ── The fence line ── */}
      <div className={own.modes} role="tablist" aria-label="How the fence is measured">
        <button type="button" role="tab" aria-selected={mode === 'type'}
          className={mode === 'type' ? own.modeOn : own.mode}
          onClick={() => setMode('type')}>Type the lengths</button>
        <button type="button" role="tab" aria-selected={mode === 'draw'}
          className={mode === 'draw' ? own.modeOn : own.mode}
          onClick={() => setMode('draw')}>Draw it on the plan</button>
      </div>

      {mode === 'type' ? (
        <div className={own.runs}>
          {typed.map((r, i) => (
            <div className={own.run} key={i}>
              <span className={own.runNo}>{i + 1}</span>
              {i > 0 && (
                <select
                  className={own.turn}
                  value={r.turn}
                  aria-label={`Which way run ${i + 1} turns`}
                  onChange={e => setTyped(rs => rs.map((x, n) => (n === i ? { ...x, turn: e.target.value } : x)))}
                >
                  <option value="left">↰ turns left</option>
                  <option value="right">↱ turns right</option>
                </select>
              )}
              <input
                type="number" min="0" step="0.1" inputMode="decimal"
                placeholder={i === 0 ? 'e.g. 12.4' : 'metres'}
                aria-label={`Length of run ${i + 1} in metres`}
                value={r.m}
                onChange={e => setTyped(rs => rs.map((x, n) => (n === i ? { ...x, m: e.target.value } : x)))}
              />
              <span className={own.unit}>m</span>
              {typed.length > 1 && (
                <button type="button" className={own.drop} aria-label={`Remove run ${i + 1}`}
                  onClick={() => setTyped(rs => rs.filter((x, n) => n !== i))}>×</button>
              )}
            </div>
          ))}
          <button type="button" className={own.addRun}
            onClick={() => setTyped(rs => [...rs, { m: '', turn: 'left' }])}>
            + Another run (round a corner)
          </button>
        </div>
      ) : (
        <div className={own.drawBar}>
          <span>
            {points.length === 0
              ? 'Tap the plan where the fence starts.'
              : `${points.length} ${points.length === 1 ? 'point' : 'points'}${closedLoop ? ' · closed' : ''}`}
          </span>
          {/* Undo opens a closed fence back up before it takes a corner off,
              so the last tap can be taken back whatever it was. */}
          <button type="button"
            onClick={() => {
              if (closedLoop) { setClosedLoop(false); return; }
              setPoints(ps => ps.slice(0, -1));
            }}
            disabled={!points.length}>Undo</button>
          <button type="button" onClick={() => { setPoints([]); setClosedLoop(false); }}
            disabled={!points.length}>Clear</button>
        </div>
      )}

      <label className={own.toggle}>
        <input type="checkbox" checked={closedLoop}
          onChange={e => setClosedLoop(e.target.checked)} />
        <span>
          <strong>The fence closes back on itself</strong>
          <em>No end posts, and the last run meets the first at a corner</em>
        </span>
      </label>

      {/* ── The drawing ── */}
      <FencePlan points={planPoints} closed={closedLoop} plan={plan}
        drawing={mode === 'draw'} onPoint={addPoint} hex={hex} />

      {/* ── Posts and gates ── */}
      <div className={`${styles.calcGrid} ${own.grid}`}>
        {/* A bay that comes with its posts has nothing to choose here, and a
            post dropdown on it would read as a second lot to buy. */}
        {!panel?.includesPosts && (
          <div className={styles.calcField}>
            <label>Post</label>
            <select value={post?.sku || ''} onChange={e => setPostSku(e.target.value)}>
              {postChoices.map(p => (
                <option key={p.sku} value={p.sku}>
                  {p.lengthMm}mm · {p.sectionMm}mm {p.material}
                  {p.finish ? ` ${p.finish}` : ''}
                  {suggested && p.sku === suggested.sku ? ' (suggested)' : ''}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className={styles.calcField}>
          <label>Gate</label>
          <select value={gateSku} onChange={e => {
            setGateSku(e.target.value);
            setGateCount(e.target.value ? Math.max(1, gateCount) : 0);
          }}>
            <option value="">No gate</option>
            {gateChoices.map(g => (
              <option key={g.sku} value={g.sku}>
                {g.name.replace(`${range} `, '')}
              </option>
            ))}
          </select>
        </div>
        {gate && (
          <>
            <div className={styles.calcField}>
              <label>How many gates</label>
              <input type="number" min="0" step="1" value={gateCount}
                onChange={e => setGateCount(Math.max(0, parseInt(e.target.value, 10) || 0))} />
            </div>
            <div className={styles.calcField}>
              <label>Opening (mm){!gate.widthMm && ' — kit, so type it'}</label>
              <input type="number" min="0" step="10" value={gateWidthMm}
                onChange={e => setGateWidthMm(Math.max(0, parseInt(e.target.value, 10) || 0))} />
            </div>
          </>
        )}
      </div>

      {!panel?.includesPosts && (
        <label className={own.toggle}>
          <input type="checkbox" checked={basePlate}
            onChange={e => { setBasePlate(e.target.checked); setPostSku(''); }} />
          <span>
            <strong>Bolting the posts down</strong>
            <em>
              {basePlate
                ? 'Base-plate posts, onto concrete or a deck'
                : `Dug in — posts allow ${DEFAULT_EMBEDMENT_MM}mm in the ground`}
            </em>
          </span>
        </label>
      )}

      {/* ── What it costs to put up ── */}
      <div className={`${styles.calcGrid} ${own.grid}`}>
        <div className={styles.calcField}>
          <label>Install per metre ($)</label>
          <input type="number" min="0" step="1" inputMode="decimal" value={labour.perMetre}
            placeholder="0"
            onChange={e => setLabour(l => ({ ...l, perMetre: e.target.value }))} />
        </div>
        <div className={styles.calcField}>
          <label>Per post ($)</label>
          <input type="number" min="0" step="1" inputMode="decimal" value={labour.perPost}
            placeholder="0"
            onChange={e => setLabour(l => ({ ...l, perPost: e.target.value }))} />
        </div>
        <div className={styles.calcField}>
          <label>Per gate ($)</label>
          <input type="number" min="0" step="1" inputMode="decimal" value={labour.perGate}
            placeholder="0"
            onChange={e => setLabour(l => ({ ...l, perGate: e.target.value }))} />
        </div>
      </div>
      <p className={own.sub}>
        {product?.install_product
          ? `Per metre comes from ${product.install_product.name}; all three are editable and kept on this device. `
          : 'Your install rates, kept on this device. '}
        Digging and concreting is charged by the post, so a fence with four corners and
        two gates prices higher than a straight one of the same length.
      </p>

      {/* ── The take-off ── */}
      {plan && panel ? (
        <div className={styles.calcResult}>
          <div className={styles.calcResultRow}>
            <span>Fence</span>
            <strong>
              {plan.totalMetres}m in {plan.runCount} {plan.runCount === 1 ? 'run' : 'runs'}
              {plan.closedLoop ? ', closed' : ''}
            </strong>
          </div>
          <div className={styles.calcResultRow}>
            <span>Panels ({panel.widthMm}mm)</span>
            <strong>
              {plan.panels}
              {plan.runCount > 1 ? ` — ${plan.panelsPerRun.join(' + ')}` : ''}
            </strong>
          </div>
          {plan.offcutMm > 0 && (
            <div className={styles.calcResultRow}>
              <span>Cut to fit</span>
              <strong>
                {plan.offcutPerRun.filter(mm => mm > 0).length === 1
                  ? `${plan.offcutMm}mm off the last panel in run ${plan.offcutPerRun.findIndex(mm => mm > 0) + 1}`
                  : plan.offcutPerRun.map((mm, i) => (mm > 0 ? `${mm}mm in run ${i + 1}` : null))
                    .filter(Boolean).join(', ')}
              </strong>
            </div>
          )}
          {plan.postsIncluded ? (
            <div className={own.note}>
              {plan.postsInFence} posts go in the ground, but a {range} bay comes with
              its posts, so none are added to the quote. The digging is still in the
              install price.
            </div>
          ) : (
            <>
              <div className={styles.calcResultRow}>
                <span>Posts</span>
                <strong>{plan.posts}</strong>
              </div>
              <div className={own.breakdown}>
                {plan.linePosts} in the line
                {plan.endPosts > 0 && ` · ${plan.endPosts} ends`}
                {plan.cornerPosts > 0 && ` · ${plan.cornerPosts} ${plan.cornerPosts === 1 ? 'corner' : 'corners'}`}
                {plan.gatePosts > 0 && ` · ${plan.gatePosts} for the ${plan.gates === 1 ? 'gate' : 'gates'}`}
              </div>
              {post && (
                <div className={styles.calcResultRow}>
                  <span>Post chosen</span>
                  <strong>{post.lengthMm}mm {post.material}</strong>
                </div>
              )}
            </>
          )}
          {plan.gates > 0 && gate && (
            <div className={styles.calcResultRow}>
              <span>Gates</span>
              <strong>{plan.gates} × {(gateWidthMm / 1000).toFixed(2)}m</strong>
            </div>
          )}

          {panel.unitPrice > 0 ? (
            <>
              <div className={styles.calcResultRow}>
                <span>Panels ({plan.panels} × ${money(panel.unitPrice)})</span>
                <strong>${money(total.panelCost)}</strong>
              </div>
              {total.postCost > 0 && (
                <div className={styles.calcResultRow}>
                  <span>Posts ({plan.posts} × ${money(post.unitPrice)})</span>
                  <strong>${money(total.postCost)}</strong>
                </div>
              )}
              {total.gateCost > 0 && (
                <div className={styles.calcResultRow}>
                  <span>Gates ({plan.gates} × ${money(gate.unitPrice)})</span>
                  <strong>${money(total.gateCost)}</strong>
                </div>
              )}
              {total.labour > 0 && (
                <div className={styles.calcResultRow}>
                  <span>Install</span><strong>${money(total.labour)}</strong>
                </div>
              )}
              <div className={styles.calcResultRow}>
                <span>Installed (ex GST)</span><strong>${money(total.exGst)}</strong>
              </div>
              <div className={styles.calcResultRow}>
                <span>Installed (inc GST)</span>
                <strong className={styles.calcTotal}>${money(total.incGst)}</strong>
              </div>
              {total.labour === 0 && (
                <div className={own.note}>
                  No install rate set, so this is materials only. Put a rate in above and
                  it becomes an installed price — and stays set for the next quote.
                </div>
              )}
              {onPick && (
                <button className={styles.addToJobBtn} onClick={addToQuote}>
                  + Add {plan.panels} {plan.panels === 1 ? 'panel' : 'panels'}
                  {plan.posts > 0 ? `, ${plan.posts} posts` : ''}
                  {plan.gates > 0 ? ` and ${plan.gates} ${plan.gates === 1 ? 'gate' : 'gates'}` : ''}
                  {' '}to Quote
                </button>
              )}
            </>
          ) : (
            <div className={styles.calcNote} style={{ marginTop: 10 }}>
              “{panel.name}” has no price on the Price List, so this is a take-off
              rather than a quote. The quantities above are right either way.
            </div>
          )}
        </div>
      ) : (
        <div className={own.empty}>
          {mode === 'draw'
            ? 'Draw the fence on the plan to see the take-off'
            : 'Put the length of the first run in to see the take-off'}
        </div>
      )}
    </div>
  );
}
