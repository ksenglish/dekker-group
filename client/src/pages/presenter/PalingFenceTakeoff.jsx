import { useState, useEffect, useMemo } from 'react';
import api from '../../lib/api';
import RunPlanner, {
  segmentsOf, setSegmentLength, setTurnAt, turnAt, appendRun, removeSegment,
} from '../../components/plan/RunPlanner';
import { takeOff, priceUp, readSpec } from './palingFence';
import styles from './SalesPresenter.module.css';
import own from './UrbanFenceCalculator.module.css';

// Quoting a timber paling fence in front of the customer.
//
// The same drawing tool as the Urban fence — press and drag out each run, type
// over a measurement to make it exact — over a different take-off, because a
// paling fence is not panels and posts but posts in the ground, rails between
// them and palings on the face.
//
// How we build it is not in here. Post spacing, how deep they go, bags of
// concrete, rails per height, what a paling covers and which Price List item
// each part is all come from Presenter Setup, so the day a supplier swaps a
// paling nobody has to touch the app.

const NEW_RUN_M = 3;

const money = cents => (cents / 100).toLocaleString('en-NZ', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

const isSquare = turn => turn !== null && Math.abs(Math.abs(turn) - 90) < 2;
const squareTurn = turn => (isSquare(turn) ? (turn < 0 ? -90 : 90) : turn);

// ── What goes on the plan ───────────────────────────────────────────────────
//
// A post at every bay, drawn from the count the take-off gives each run, so
// the picture and the figures cannot disagree.
function fenceOnPlan({ plan, hex }) {
  return ({ points, segs, unit }) => {
    if (!points.length) return null;
    return (
      <g>
        {segs.map(s => {
          const bays = plan?.baysPerRun?.[s.i] ?? 0;
          const len = s.metres;
          const ux = len ? (s.b.x - s.a.x) / len : 0;
          const uy = len ? (s.b.y - s.a.y) / len : 0;
          const opening = plan?.openingRuns?.includes(s.i)
            ? plan.openings * ((plan.openingWidthMm || 0) / 1000) : 0;
          const gap = { x: s.b.x - ux * opening, y: s.b.y - uy * opening };

          // Where each post goes along this run.
          const posts = [];
          for (let n = 1; n < bays && len > 0; n++) {
            const at = ((len - opening) / bays) * n;
            posts.push({ x: s.a.x + ux * at, y: s.a.y + uy * at });
          }
          return (
            <g key={s.i}>
              {opening > 0 && (
                <line x1={gap.x} y1={gap.y} x2={s.b.x} y2={s.b.y}
                  stroke="#f1f5f9" strokeWidth={unit * 1.1} strokeLinecap="butt" />
              )}
              {posts.map((p, n) => (
                <rect key={n} x={p.x - unit * 0.45} y={p.y - unit * 0.45}
                  width={unit * 0.9} height={unit * 0.9} fill="#78350f" />
              ))}
            </g>
          );
        })}
        {/* The ends and the corners, which carry the fence either side. */}
        {points.map((p, i) => (
          <rect key={i} x={p.x - unit * 0.7} y={p.y - unit * 0.7}
            width={unit * 1.4} height={unit * 1.4}
            fill={hex} stroke="#fff" strokeWidth={unit * 0.2} />
        ))}
      </g>
    );
  };
}

export default function PalingFenceTakeoff({ onPick, onQuantityChange, fullPage = false }) {
  const [spec, setSpec] = useState(() => readSpec(null));
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  const [heightMm, setHeightMm] = useState(1800);
  const [topCap, setTopCap] = useState(false);
  const [points, setPoints] = useState([]);
  const [closedLoop, setClosedLoop] = useState(false);
  const [draft, setDraft] = useState(null);
  const [openings, setOpenings] = useState(0);
  const [openingWidthMm, setOpeningWidthMm] = useState(1000);

  useEffect(() => {
    Promise.all([
      api.get('/settings/paling-fence').then(r => r.data).catch(() => ({})),
      api.get('/products').then(r => r.data).catch(() => []),
    ]).then(([stored, list]) => {
      const s = readSpec(stored);
      setSpec(s);
      setProducts(list);
      if (!s.heights.some(h => h.mm === 1800)) setHeightMm(s.heights[0]?.mm || 1800);
    }).finally(() => setLoading(false));
  }, []);

  const runs = useMemo(() => {
    const segs = segmentsOf(points, closedLoop);
    return segs.map(s => s.metres);
  }, [points, closedLoop]);
  const segs = useMemo(() => segmentsOf(points, closedLoop), [points, closedLoop]);

  const plan = useMemo(() => takeOff({
    runs, heightMm, spec, topCap, openings, openingWidthMm,
  }), [runs, heightMm, spec, topCap, openings, openingWidthMm]);

  const total = useMemo(() => priceUp({ plan, spec, products }), [plan, spec, products]);

  useEffect(() => { onQuantityChange?.(plan ? plan.fenceMetres : 0); }, [plan, onQuantityChange]);

  function planned({ points: next, closed }) { setPoints(next); setClosedLoop(closed); }

  function fieldFor(s) {
    return draft?.i === s.i ? draft.text : s.metres.toFixed(2);
  }
  function commitTypedRun() {
    if (!draft) return;
    const metres = parseFloat(draft.text);
    setDraft(null);
    if (metres > 0) setPoints(ps => setSegmentLength(ps, draft.i, metres));
  }

  function addToQuote() {
    if (!total) return;
    for (const line of total.lines) {
      if (line.product && line.qty > 0) onPick({ ...line.product, quantity: line.qty });
    }
  }

  const hex = '#78350f';

  if (loading) return <div className={styles.calc}><p className={own.sub}>Loading…</p></div>;

  return (
    <div className={fullPage ? own.page : styles.calc}>
      {!fullPage && (
        <>
          <h3 className={styles.calcTitle}>Paling Fence Calculator</h3>
          <p className={own.sub}>
            100 × 100 posts {spec.rules.embedmentMm}mm in the ground, no more than{' '}
            {(spec.rules.maxSpacingMm / 1000).toFixed(1)}m apart · 100 × 50 rails · 150 × 25 palings
          </p>
        </>
      )}

      <div className={fullPage ? own.planPane : own.planInline}>
        <RunPlanner
          points={points}
          closed={closedLoop}
          onChange={planned}
          colour={hex}
          fill={fullPage}
          labelFor={s => (plan?.baysPerRun?.[s.i]
            ? ` · ${plan.baysPerRun[s.i]} ${plan.baysPerRun[s.i] === 1 ? 'bay' : 'bays'}` : '')}
          overlay={fenceOnPlan({ plan, hex })}
          hint="Press and drag to pull out the first run of fence. Drag the next one off the end of it, and type over any measurement to make it exact."
        />
      </div>

      <div className={fullPage ? own.sidePane : own.stacked}>
        <div className={`${styles.calcGrid} ${own.grid}`}>
          <div className={styles.calcField}>
            <label>Height</label>
            <select value={heightMm} onChange={e => setHeightMm(Number(e.target.value))}>
              {spec.heights.map(h => (
                <option key={h.mm} value={h.mm}>
                  {h.mm}mm · {h.rails} {h.rails === 1 ? 'rail' : 'rails'}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.calcField}>
            <label>Gateways to leave</label>
            <input type="number" min="0" step="1" value={openings}
              onChange={e => setOpenings(Math.max(0, parseInt(e.target.value, 10) || 0))} />
          </div>
          {openings > 0 && (
            <div className={styles.calcField}>
              <label>Opening (mm)</label>
              <input type="number" min="0" step="10" value={openingWidthMm}
                onChange={e => setOpeningWidthMm(Math.max(0, parseInt(e.target.value, 10) || 0))} />
            </div>
          )}
        </div>

        <label className={own.toggle}>
          <input type="checkbox" checked={topCap} onChange={e => setTopCap(e.target.checked)} />
          <span>
            <strong>65 × 35 top cap</strong>
            <em>A capping rail along the top, cut from {spec.rules.capLengthMm}mm lengths</em>
          </span>
        </label>

        {/* The same fence as the drawing, written down. */}
        <div className={own.runs}>
          {segs.map(s => {
            const closing = closedLoop && s.i === segs.length - 1;
            const turn = turnAt(points, s.i, closedLoop);
            return (
              <div className={own.run} key={s.i}>
                <span className={own.runNo}>{s.i + 1}</span>
                {s.i > 0 && !closing && (
                  <select className={own.turn} value={squareTurn(turn)}
                    aria-label={`Which way run ${s.i + 1} turns`}
                    onChange={e => setPoints(ps => setTurnAt(ps, s.i, Number(e.target.value)))}>
                    <option value="-90">↰ turns left</option>
                    <option value="90">↱ turns right</option>
                    {!isSquare(turn) && (
                      <option value={turn}>↗ {Math.abs(Math.round(turn))}°</option>
                    )}
                  </select>
                )}
                <input type="number" min="0" step="0.1" inputMode="decimal"
                  aria-label={`Length of run ${s.i + 1} in metres`}
                  value={fieldFor(s)} disabled={closing}
                  onChange={e => setDraft({ i: s.i, text: e.target.value })}
                  onBlur={() => commitTypedRun()}
                  onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
                <span className={own.unit}>m</span>
                <button type="button" className={own.drop}
                  aria-label={`Remove run ${s.i + 1}`}
                  onClick={() => setPoints(ps => removeSegment(ps, s.i))}>×</button>
              </div>
            );
          })}
          <button type="button" className={own.addRun}
            onClick={() => setPoints(ps => appendRun(ps, NEW_RUN_M))}>
            {segs.length ? '+ Another run (round a corner)' : '+ Start the fence'}
          </button>
        </div>

        {points.length >= 3 && (
          <label className={own.toggle}>
            <input type="checkbox" checked={closedLoop}
              onChange={e => setClosedLoop(e.target.checked)} />
            <span>
              <strong>The fence closes back on itself</strong>
              <em>No end posts, and the last run meets the first at a corner</em>
            </span>
          </label>
        )}

        {/* ── The take-off ── */}
        {plan ? (
          <div className={styles.calcResult}>
            <div className={styles.calcResultRow}>
              <span>Fence</span>
              <strong>
                {plan.fenceMetres}m in {plan.runCount} {plan.runCount === 1 ? 'run' : 'runs'}
                {plan.closedLoop ? ', closed' : ''}
              </strong>
            </div>
            <div className={styles.calcResultRow}>
              <span>Bays</span>
              <strong>
                {plan.bays} at {(plan.widestBayMm / 1000).toFixed(2)}m
                {plan.widestBayMm > spec.rules.maxSpacingMm ? ' — over the maximum' : ''}
              </strong>
            </div>
            <div className={styles.calcResultRow}>
              <span>Posts ({plan.postLengthMm}mm or longer)</span>
              <strong>{plan.posts}</strong>
            </div>
            <div className={own.breakdown}>
              {plan.linePosts} in the line · {plan.endPosts} ends
              {plan.cornerPosts > 0 && ` · ${plan.cornerPosts} ${plan.cornerPosts === 1 ? 'corner' : 'corners'}`}
              {plan.openingPosts > 0 && ` · ${plan.openingPosts} extra at the ${plan.openings === 1 ? 'gateway' : 'gateways'}`}
            </div>
            <div className={styles.calcResultRow}>
              <span>Concrete</span>
              <strong>{plan.concreteBags} bags</strong>
            </div>
            <div className={styles.calcResultRow}>
              <span>Rails ({plan.railsHigh} high, {plan.railLm}lm)</span>
              <strong>{plan.rails} lengths</strong>
            </div>
            <div className={styles.calcResultRow}>
              <span>Palings (at {plan.palingCoverMm}mm cover)</span>
              <strong>{plan.palings}</strong>
            </div>
            {plan.palingOvercutMm > 0 && (
              <div className={styles.calcResultRow}>
                <span>Cut to fit</span>
                <strong>{plan.palingOvercutMm}mm off the last paling</strong>
              </div>
            )}
            {plan.topCap && (
              <div className={styles.calcResultRow}>
                <span>Top cap ({plan.capLm}lm)</span>
                <strong>{plan.caps} lengths</strong>
              </div>
            )}

            {total.materials > 0 ? (
              <>
                {total.lines.filter(l => l.product).map(l => (
                  <div key={l.key} className={styles.calcResultRow}>
                    <span>{l.label} ({l.qty} × ${money(l.unitPrice)})</span>
                    <strong>${money(l.total)}</strong>
                  </div>
                ))}
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
              </>
            ) : null}

            {total.missing.length > 0 && (
              <div className={own.note}>
                Nothing is picked yet for: {total.missing.join(', ').toLowerCase()}. The
                quantities above are right either way — set the Price List items under
                Presenter Setup → Timber Paling Fence Calculator and it prices itself.
              </div>
            )}

            {onPick && total.materials > 0 && (
              <button className={styles.addToJobBtn} onClick={addToQuote}>
                + Add {total.lines.filter(l => l.product).length} lines to Quote
              </button>
            )}
          </div>
        ) : (
          <div className={own.empty}>Draw the fence on the plan to see the take-off</div>
        )}
      </div>
    </div>
  );
}
