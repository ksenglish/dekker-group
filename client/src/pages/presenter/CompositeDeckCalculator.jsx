import { useState, useEffect, useMemo } from 'react';
import api from '../../lib/api';
import RunPlanner from '../../components/plan/RunPlanner';
import usePlan from '../../components/plan/usePlan';
import { planDeckShape, DECK, COLOURS } from './deckPlan';
import styles from './SalesPresenter.module.css';
import own from './UrbanFenceCalculator.module.css';
import deck from './CompositeDeckCalculator.module.css';

// Working out a composite deck in front of the customer.
//
// The deck is drawn, not typed. The same plan the fences use — press and drag
// out each edge, type over a measurement to make it exact, pinch to get
// closer — because a back yard is rarely a rectangle and a length and a width
// could not say so. Close the outline, pick a design, and the boards land in
// it.
//
// Two things are happening at once and both matter. The arithmetic has to
// agree with what Bunnings will say at the trade desk — it is checked against
// Ekodeck's own planner, see deckPlan.js — and the customer has to be able to
// see what they are buying.
//
// The drawing is black on white, like Ekodeck's own planner, and so is the
// board: a plan is for reading, and a brown rectangle full of brown lines
// reads as a brown rectangle. The colour they picked is beside it on its own
// photograph, where it looks like the thing it is. Joists and clips are drawn
// the way Ekodeck draw them, down to the red cross on a locking clip.
//
// Designer Series only. That is what Dekker source through Bunnings Trade, and
// a dropdown of ranges nobody stocks is four wrong answers.

const SWATCH = key => `/ekodeck/${key}.jpg`;
const SCENE_COLOURS = new Set(['backbeach', 'leatherwood', 'ironwood', 'riverbank-red']);

// Light colours need dark text on them, and the reverse. Rough luminance is
// plenty for deciding that.
const isLight = hex => {
  const n = parseInt(hex.slice(1), 16);
  return (((n >> 16) & 255) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 > 140;
};

// What laying the boards out can be asked for. Until one is picked the drawing
// is an outline and nothing else — which is the honest state of it, because
// nobody has said yet which way the boards run.
const DESIGNS = [
  { key: 'none', label: 'Outline only', why: 'Just the shape, no boards yet' },
  { key: 'plain', label: 'Plain', why: 'Boards wall to wall, cut ends showing' },
  { key: 'frame', label: 'Picture frame', why: 'A board round the edge, hiding the cut ends' },
];

const LAYERS = [
  ['boards', 'Boards'],
  ['joists', 'Joists/Subframe'],
  ['clips', 'Clips'],
];

const money = n => n.toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── The deck, drawn on the plan ─────────────────────────────────────────────
//
// Everything here comes out of the take-off, so the picture and the order
// cannot disagree: if a board is drawn, it was counted.
function deckOnPlan({ plan, layers }) {
  return ({ unit }) => {
    if (!plan) return null;
    const {
      axis, outline, field, boards, breakers, boardWidthM, joists, joistWidthM, clips, locks,
    } = plan.layout;
    const half = boardWidthM / 2;
    // A board lying along x is drawn long in x and a board's width in y, and
    // the other way about when the boards are turned.
    const boardRect = b => (axis === 'x'
      ? { x: b.a0, y: b.at - half, width: b.a1 - b.a0, height: boardWidthM }
      : { x: b.at - half, y: b.a0, width: boardWidthM, height: b.a1 - b.a0 });
    // A hairline however far in the plan is zoomed, because a line weight is
    // about reading the drawing, not about the deck.
    const line = unit / 9;
    // A clip is a clip. Drawn at the size it really is — 90mm of it showing
    // between two boards — so it sits inside the gap instead of straddling
    // three boards when the plan happens to be zoomed out.
    const CLIP_LONG = 0.09;
    const CLIP_WIDE = 0.04;
    const ARM = 0.05;

    return (
      <g>
        {/* The deck itself, so the grid does not show through it. */}
        <polygon points={outline.map(p => `${p.x},${p.y}`).join(' ')} fill="#fff" />

        {layers.boards && (
          <g fill="none" stroke="#111827" strokeWidth={line}>
            {/* The frame: the strip between the outline and where the field
                starts, mitred at every corner. Four boards on a rectangle,
                six on an L — however many sides the deck turned out to have. */}
            {plan.frame && (
              <>
                <polygon points={outline.map(p => `${p.x},${p.y}`).join(' ')} />
                <polygon points={field.map(p => `${p.x},${p.y}`).join(' ')} />
                {outline.map((p, i) => (
                  <line key={i} x1={p.x} y1={p.y} x2={field[i].x} y2={field[i].y} />
                ))}
              </>
            )}
            {boards.map((b, i) => <rect key={i} {...boardRect(b)} />)}
            {/* The breaker each jointed run lands on, running the other way.
                Without it the joint read as a stripe of missing deck. */}
            {breakers.map((b, i) => (
              <rect key={`k${i}`}
                x={axis === 'x' ? b.a0 : b.c0}
                y={axis === 'x' ? b.c0 : b.a0}
                width={axis === 'x' ? b.a1 - b.a0 : b.c1 - b.c0}
                height={axis === 'x' ? b.c1 - b.c0 : b.a1 - b.a0} />
            ))}
          </g>
        )}

        {/* What the boards are sitting on. Drawn over them rather than under,
            the way Ekodeck draw it, so you can see which board lands where. */}
        {layers.joists && (
          <g fill="#727272" fillOpacity="0.6">
            {joists.map((j, i) => j.spans.map((s, n) => (
              <rect key={`${i}-${n}`}
                x={axis === 'x' ? j.at - joistWidthM / 2 : s.from}
                y={axis === 'x' ? s.from : j.at - joistWidthM / 2}
                width={axis === 'x' ? joistWidthM : s.to - s.from}
                height={axis === 'x' ? s.to - s.from : joistWidthM} />
            )))}
          </g>
        )}

        {/* A clip wherever a board crosses a joist, and the one in the middle
            of each board a locking clip, which is what stops the board
            creeping as it grows and shrinks. */}
        {layers.clips && (
          <g>
            {/* The clip lies across the joist, so it runs the way the joist
                does — against the boards it is holding down. */}
            {clips.map((c, i) => (
              <rect key={i} fill="#111827"
                x={c.x - (axis === 'x' ? CLIP_WIDE : CLIP_LONG) / 2}
                y={c.y - (axis === 'x' ? CLIP_LONG : CLIP_WIDE) / 2}
                width={axis === 'x' ? CLIP_WIDE : CLIP_LONG}
                height={axis === 'x' ? CLIP_LONG : CLIP_WIDE} />
            ))}
            {locks.map((c, i) => (
              <g key={i} stroke="#dc2626" strokeWidth={line * 1.6}>
                <line x1={c.x - ARM} y1={c.y - ARM} x2={c.x + ARM} y2={c.y + ARM} />
                <line x1={c.x + ARM} y1={c.y - ARM} x2={c.x - ARM} y2={c.y + ARM} />
              </g>
            ))}
          </g>
        )}
      </g>
    );
  };
}

export default function CompositeDeckCalculator({
  onPick, onQuantityChange, onRecommend, fullPage = false,
  // The drawing, when somebody else owns it — a plan saved on a job, opened
  // in the Drawing Tool. Left out, the calculator keeps its own.
  plan: heldPlan, onPlanChange,
}) {
  const [colour, setColour] = useState(COLOURS[2].key);   // Leatherwood, the usual pick
  const [design, setDesign] = useState('none');
  const [boardsAcross, setBoardsAcross] = useState(true);
  const [layers, setLayers] = useState({ boards: true, joists: false, clips: false });
  const { points, closed, setPlan } = usePlan(heldPlan, onPlanChange);
  const [priceList, setPriceList] = useState([]);

  useEffect(() => {
    api.get('/products').then(r => setPriceList(r.data)).catch(() => {});
  }, []);

  const swatch = COLOURS.find(c => c.key === colour) || COLOURS[0];
  const plan = useMemo(() => (design === 'none' ? null : planDeckShape({
    points, closed, pictureFrame: design === 'frame', boardsAcross,
  })), [points, closed, design, boardsAcross]);

  // The board in this colour, and the clips, off the Price List. Matched on
  // the colour name appearing in the product, which is how the Boundaryline
  // and Urban imports name things.
  const boardProduct = useMemo(() => priceList.find(p => {
    const hay = `${p.name} ${p.description || ''}`.toLowerCase();
    return hay.includes('ekodeck') && hay.includes(swatch.name.toLowerCase());
  }), [priceList, swatch]);
  const kitProduct = useMemo(() => priceList.find(p => {
    const hay = `${p.name} ${p.description || ''}`.toLowerCase();
    return hay.includes('quickfix') || hay.includes('quick fix');
  }), [priceList]);

  useEffect(() => {
    onQuantityChange?.(plan ? plan.areaM2 : 0);
  }, [plan, onQuantityChange]);
  useEffect(() => {
    onRecommend?.(boardProduct || undefined);
    return () => onRecommend?.(undefined);
  }, [boardProduct, onRecommend]);

  const boardEach = boardProduct ? boardProduct.unit_price / 100 : 0;
  const kitEach = kitProduct ? kitProduct.unit_price / 100 : 0;
  const total = plan ? plan.stockLengths * boardEach + plan.kits * kitEach : 0;

  function drawn({ points: next, closed: shut, objects }) {
    setPlan(now => ({ ...now, points: next, closed: shut, objects: objects ?? now.objects }));
  }
  const setLayer = (key, on) => setLayers(l => ({ ...l, [key]: on }));

  return (
    <div className={fullPage ? own.page : styles.calc}>
      {!fullPage && (
        <>
          <h3 className={styles.calcTitle}>Composite Deck Calculator</h3>
          <p className={own.sub}>Ekodeck Designer Series · 137 × 23mm board, 5.4m lengths</p>
        </>
      )}

      <div className={fullPage ? own.planPane : own.planInline}>
        <RunPlanner
          points={points}
          closed={closed}
          onChange={drawn}
          colour="#111827"
          fill={fullPage}
          showArea
          // A deck is a few metres across, not a boundary. Framed to the 24m
          // the fences use, the usual one sat in a corner of the view with the
          // boards too small to count.
          minSpanM={8}
          overlay={deckOnPlan({ plan, layers })}
          hint="Press and drag out the first edge of the deck. Carry on round, finish on the corner you started at to close it, and type over any measurement to make it exact."
        />
        {plan && layers.clips && (
          <p className={deck.legend}>
            <span className={deck.legendClip} /> Standard clip
            <span className={deck.legendLock}>✕</span> Locking clip
          </p>
        )}
      </div>

      <div className={fullPage ? own.sidePane : own.stacked}>
        {/* ── The design, which is what turns the outline into a deck ──
            First, and above the colours, because until one of these is picked
            the drawing is an outline and the take-off is empty. The colour is
            the conversation; this is the thing that has to be answered. */}
        <div className={deck.designs} role="radiogroup" aria-label="Decking design">
          {DESIGNS.map(d => (
            <button key={d.key} type="button" role="radio" aria-checked={design === d.key}
              className={design === d.key ? deck.designOn : deck.design}
              onClick={() => setDesign(d.key)}>
              <strong>{d.label}</strong>
              <em>{d.why}</em>
            </button>
          ))}
        </div>

        <div className={`${styles.calcGrid} ${own.grid}`}>
          <div className={styles.calcField}>
            <label>Board direction</label>
            <select value={boardsAcross ? 'h' : 'v'}
              onChange={e => setBoardsAcross(e.target.value === 'h')}>
              <option value="h">Horizontal — across the plan</option>
              <option value="v">Vertical — up the plan</option>
            </select>
          </div>
          <div className={styles.calcField}>
            <label>Diagram layers</label>
            <div className={deck.layers}>
              {LAYERS.map(([key, label]) => (
                <label key={key} className={deck.layer}>
                  <input type="checkbox" checked={layers[key]}
                    disabled={!plan}
                    onChange={e => setLayer(key, e.target.checked)} />
                  {label}
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* ── The take-off ── */}
        {plan ? (
          <div className={styles.calcResult}>
            <div className={styles.calcResultRow}>
              <span>Deck area</span><strong>{plan.areaM2.toFixed(2)} m²</strong>
            </div>
            <div className={styles.calcResultRow}>
              <span>Boards</span>
              <strong>{plan.rows} {plan.rows === 1 ? 'row' : 'rows'}, {plan.fieldPieces} pieces</strong>
            </div>
            {/* Ekodeck's planner calls this the proposed sections, and it is
                the part a builder reads: how long every cut is. A rectangle
                has one line here; a shape with a corner out of it has two. */}
            <div className={own.breakdown}>
              {plan.sections.map(s => `${s.count} at ${s.pieceMm}mm`).join(' · ')}
              {plan.joints > 0 && ` · ${plan.joints} ${plan.joints === 1 ? 'breaker' : 'breakers'} in the longest run`}
              {/* The joins are the deck's, not each row's, so they read as
                  straight lines across it. Worth saying, because it is the
                  thing somebody looking at the drawing is checking. */}
              {plan.joinLines > 0 && ` · jointed on ${plan.joinLines} ${plan.joinLines === 1 ? 'line' : 'lines'} across the deck`}
            </div>
            {plan.offLineJoins > 0 && (
              <div className={deck.warn}>
                {plan.offLineJoins} {plan.offLineJoins === 1 ? 'row has' : 'rows have'} a join that
                could not sit on those lines — {plan.offLineJoins === 1 ? 'it starts' : 'they start'} part
                way along, and the piece would have been longer than a board. Moving that edge a little
                either way will usually bring {plan.offLineJoins === 1 ? 'it' : 'them'} back into line.
              </div>
            )}
            {plan.frame && (
              <div className={styles.calcResultRow}>
                <span>Picture frame ({plan.perimeterM.toFixed(2)}m round)</span>
                <strong>{plan.framePieces} boards</strong>
              </div>
            )}
            <div className={styles.calcResultRow}>
              <span>5.4m lengths to order</span><strong>{plan.stockLengths}</strong>
            </div>
            <div className={styles.calcResultRow}>
              <span>QuickFix kits (100lm)</span><strong>{plan.kits}</strong>
            </div>
            <div className={styles.calcResultRow}>
              <span>Clips</span>
              <strong>{plan.clipCount} · {plan.lockCount} locking</strong>
            </div>
            <div className={styles.calcResultRow}>
              <span>Joists at {DECK.install.joistSpacingMm}mm centres</span>
              <strong>{plan.joists} · {plan.joistLm}lm</strong>
            </div>
            <div className={styles.calcResultRow}>
              <span>Off the board</span>
              <strong>{plan.linearMetres}lm used · {plan.wastePct}% waste</strong>
            </div>

            {plan.shortfallMatters && (
              <div className={deck.warn}>
                The last row leaves <strong>{plan.shortfallMm}mm</strong> uncovered. That is how
                Ekodeck count it too — their planner excludes fascia and edge boards — so either
                add an edge board, or bring the width in by that much.
              </div>
            )}

            {boardProduct ? (
              <>
                <div className={styles.calcResultRow}>
                  <span>Board ({plan.stockLengths} × ${money(boardEach)})</span>
                  <strong>${money(plan.stockLengths * boardEach)}</strong>
                </div>
                {kitProduct && (
                  <div className={styles.calcResultRow}>
                    <span>Clips ({plan.kits} × ${money(kitEach)})</span>
                    <strong>${money(plan.kits * kitEach)}</strong>
                  </div>
                )}
                <div className={styles.calcResultRow}>
                  <span>Total (inc GST)</span>
                  <strong className={styles.calcTotal}>${money(total * 1.15)}</strong>
                </div>
                {onPick && (
                  <button className={styles.addToJobBtn}
                    onClick={() => {
                      onPick({ ...boardProduct, quantity: plan.stockLengths });
                      if (kitProduct) onPick({ ...kitProduct, quantity: plan.kits });
                    }}>
                    + Add {plan.stockLengths} lengths{kitProduct ? ` and ${plan.kits} kits` : ''} to Quote
                  </button>
                )}
              </>
            ) : (
              <div className={styles.calcNote} style={{ marginTop: 10 }}>
                Add “Ekodeck Designer Series {swatch.name}” to your Price List to price this and
                put it on a quote. The quantities above are right either way.
              </div>
            )}
          </div>
        ) : (
          <div className={own.empty}>
            {design === 'none'
              ? 'Draw the deck on the plan, then pick a design to lay the boards in it'
              : closed
                ? 'The outline is not big enough for a board yet'
                : 'Close the outline — finish on the corner you started at — to lay the boards'}
          </div>
        )}

        {/* ── The colour, and where it looks like itself ──
            Last, because it changes nothing about the take-off. The deck is
            drawn in black and white whichever of these is picked — a plan is
            for reading, and a brown rectangle full of brown lines reads as a
            brown rectangle. The board is here instead, photographed. */}
        <div className={deck.colours} role="radiogroup" aria-label="Board colour">
          {COLOURS.map(c => (
            <button
              key={c.key}
              type="button"
              role="radio"
              aria-checked={c.key === colour}
              className={c.key === colour ? deck.colourOn : deck.colour}
              onClick={() => setColour(c.key)}
              title={`${c.name} — ${c.tone}`}
            >
              <img src={SWATCH(c.key)} alt="" loading="lazy" />
              <span className={isLight(c.hex) ? deck.chipDark : deck.chipLight}>{c.name}</span>
            </button>
          ))}
        </div>

        <div className={deck.swatchPane}>
          <img className={deck.swatchImg} src={SWATCH(swatch.key)} alt={`${swatch.name} board`} />
          <div className={deck.swatchName}>{swatch.name}</div>
          <div className={deck.swatchTone}>{swatch.tone}</div>
          {SCENE_COLOURS.has(swatch.key) && (
            <img className={deck.scene} src={`/ekodeck/${swatch.key}-deck.jpg`}
              alt={`A deck laid in ${swatch.name}`} loading="lazy" />
          )}
        </div>
      </div>
    </div>
  );
}
