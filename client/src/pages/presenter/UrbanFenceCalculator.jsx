import { useState, useEffect, useMemo } from 'react';
import api from '../../lib/api';
import RunPlanner, {
  segmentsOf, setSegmentLength, setTurnAt, turnAt, appendRun, removeSegment,
} from '../../components/plan/RunPlanner';
import {
  buildCatalogue, suggestPost, postsFor, takeOff, priceUp,
  runsFromPoints, DEFAULT_EMBEDMENT_MM,
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

const LABOUR_KEY = 'urbanFenceLabour';

// A new run added from the list rather than drawn, before its length is typed.
const NEW_RUN_M = 3;

// Most fences turn square, and the list of runs says so in words. One drawn
// off square is kept at the angle it was drawn and named in degrees, rather
// than being quietly rounded to a right angle it does not have.
const isSquare = turn => turn !== null && Math.abs(Math.abs(turn) - 90) < 2;
const squareTurn = turn => (isSquare(turn) ? (turn < 0 ? -90 : 90) : turn);

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

// ── What goes on the plan ───────────────────────────────────────────────────
//
// The drawing itself is RunPlanner, which knows nothing about fences. What it
// is given here is the fence: a panel mark at every joint, the gate drawn as
// an opening with the leaf swung out of it, and posts coloured for what they
// are. All of it from the take-off's own counts, so the picture and the
// figures beside it cannot disagree.
function fenceOnPlan({ plan }) {
  return ({ points, closed, segs, unit }) => {
    if (!points.length) return null;
    const panelM = (plan?.panelWidthMm || 0) / 1000;
    const gateM = plan?.gateWidthM || 0;

    return (
      <g>
        {segs.map(s => {
          const panels = plan?.panelsPerRun?.[s.i] ?? 0;
          const len = s.metres;
          const ux = len ? (s.b.x - s.a.x) / len : 0;
          const uy = len ? (s.b.y - s.a.y) / len : 0;

          // Where one panel ends and the next begins.
          const joints = [];
          for (let n = 1; n < panels && panelM > 0; n++) {
            const at = Math.min(n * panelM, len);
            joints.push({ x: s.a.x + ux * at, y: s.a.y + uy * at });
          }

          // The gate sits at the far end of whichever run the take-off put it
          // in, so the plan shows where the opening has been assumed to be.
          const opening = plan?.gateRuns?.includes(s.i) ? plan.gates * gateM : 0;
          const gap = { x: s.b.x - ux * opening, y: s.b.y - uy * opening };
          const leaf = { x: gap.x + uy * gateM, y: gap.y - ux * gateM };

          return (
            <g key={s.i}>
              {joints.map((j, n) => (
                <circle key={n} cx={j.x} cy={j.y} r={unit * 0.4} fill="#475569" />
              ))}
              {opening > 0 && (
                <g>
                  <line x1={gap.x} y1={gap.y} x2={s.b.x} y2={s.b.y}
                    stroke="#f1f5f9" strokeWidth={unit * 1.1} strokeLinecap="butt" />
                  <line x1={gap.x} y1={gap.y} x2={leaf.x} y2={leaf.y}
                    stroke="#b45309" strokeWidth={unit * 0.55}
                    strokeDasharray={`${unit * 0.8} ${unit * 0.6}`} />
                </g>
              )}
            </g>
          );
        })}

        {/* Posts, coloured for what each one is: an end takes one run, a
            corner takes two. */}
        {points.map((p, i) => {
          const end = !closed && (i === 0 || i === points.length - 1);
          return (
            <circle key={i} cx={p.x} cy={p.y} r={end ? unit * 0.75 : unit * 0.95}
              fill={end ? '#0f172a' : '#b91c1c'} stroke="#fff" strokeWidth={unit * 0.2} />
          );
        })}
      </g>
    );
  };
}

// ── The calculator ──────────────────────────────────────────────────────────

export default function UrbanFenceCalculator({ product, onPick, onQuantityChange, onRecommend }) {
  const [priceList, setPriceList] = useState([]);
  const [range, setRange] = useState('');
  const [heightMm, setHeightMm] = useState(0);
  const [finish, setFinish] = useState('');

  // One fence, drawn or typed. Both are views of the same line on the ground:
  // drawing moves the corners and typing sets a measurement, and neither has a
  // copy of the other to fall out of step with.
  const [points, setPoints] = useState([]);
  const [closedLoop, setClosedLoop] = useState(false);
  const [draft, setDraft] = useState(null);   // a measurement part-typed

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

  const runs = useMemo(() => runsFromPoints(points, closedLoop), [points, closedLoop]);
  const segs = useMemo(() => segmentsOf(points, closedLoop), [points, closedLoop]);

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

  function planned({ points: next, closed }) {
    setPoints(next);
    setClosedLoop(closed);
  }

  // A measurement being typed is held as it is typed and applied when the
  // field is left. Applying every keystroke would redraw the fence from "1"
  // on the way to "12", and the plan would jump about under the hand.
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

      {/* ── The fence line ──
          Drag it out on the plan, or type the runs underneath. The same fence
          either way: a measurement typed below moves the corner on the plan,
          and a wall dragged on the plan changes the number below it. */}
      <RunPlanner
        points={points}
        closed={closedLoop}
        onChange={planned}
        colour={hex}
        labelFor={s => (plan?.panelsPerRun?.[s.i]
          ? ` · ${plan.panelsPerRun[s.i]}` : '')}
        overlay={fenceOnPlan({ plan })}
        hint="Press and drag to pull out the first run of fence. Drag the next one off the end of it, and type over any measurement to make it exact."
      />

      <div className={own.runs}>
        {segs.map(s => {
          // The last wall of a closed fence is whatever length and bearing
          // close it, so neither is offered for editing — a shape cannot have
          // every side set independently and still meet itself.
          const closing = closedLoop && s.i === segs.length - 1;
          const turn = turnAt(points, s.i, closedLoop);
          return (
            <div className={own.run} key={s.i}>
              <span className={own.runNo}>{s.i + 1}</span>
              {s.i > 0 && !closing && (
                <select
                  className={own.turn}
                  value={squareTurn(turn)}
                  aria-label={`Which way run ${s.i + 1} turns`}
                  onChange={e => setPoints(ps => setTurnAt(ps, s.i, Number(e.target.value)))}
                >
                  <option value="-90">↰ turns left</option>
                  <option value="90">↱ turns right</option>
                  {/* An angle drawn off square is kept and named rather than
                      quietly rounded to one of the two above. */}
                  {!isSquare(turn) && (
                    <option value={turn}>↗ {Math.abs(Math.round(turn))}°</option>
                  )}
                </select>
              )}
              <input
                type="number" min="0" step="0.1" inputMode="decimal"
                aria-label={`Length of run ${s.i + 1} in metres`}
                value={fieldFor(s)}
                disabled={closing}
                title={closing ? 'This one is whatever length closes the fence' : undefined}
                onChange={e => setDraft({ i: s.i, text: e.target.value })}
                onBlur={() => commitTypedRun()}
                onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
              />
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
          Draw the fence on the plan, or start it below, to see the take-off
        </div>
      )}
    </div>
  );
}
