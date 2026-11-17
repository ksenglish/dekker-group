import { useState, useEffect, useMemo } from 'react';
import api from '../../lib/api';
import { planDeck, DECK, COLOURS, PITCH, BOARD_W } from './deckPlan';
import styles from './SalesPresenter.module.css';
import own from './CompositeDeckCalculator.module.css';

// Working out a composite deck in front of the customer.
//
// Two things are happening at once and both matter. The arithmetic has to
// agree with what Bunnings will say at the trade desk — it is checked against
// Ekodeck's own planner, see deckPlan.js — and the customer has to be able to
// see what they are buying, which is why the deck is drawn in the colour they
// picked and the board photograph sits beside it.
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

// A board's own grain, so the drawing reads as timber rather than as a bar
// chart. Two shades either side of the photographed colour.
function shade(hex, by) {
  const n = parseInt(hex.slice(1), 16);
  const clamp = v => Math.max(0, Math.min(255, Math.round(v)));
  const r = clamp(((n >> 16) & 255) * by);
  const g = clamp(((n >> 8) & 255) * by);
  const b = clamp((n & 255) * by);
  return `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

// ── The drawing ─────────────────────────────────────────────────────────────
//
// A plan view at scale, in the chosen colour, with every board drawn where it
// will actually land. Not a stock photograph: the point is that turning the
// boards or adding a picture frame changes the picture, because that is the
// conversation being had over the plan.
function DeckPlan({ plan, hex }) {
  if (!plan) return null;
  const { runMm, spanMm, boardsAcross, frame, rows, piecesPerRow, pieceMm } = plan;

  // The deck as it sits on the ground: length left to right.
  const deckW = boardsAcross ? runMm : spanMm;
  const deckH = boardsAcross ? spanMm : runMm;

  const PAD = 46;
  const scale = Math.min(520 / deckW, 360 / deckH);
  const w = deckW * scale;
  const h = deckH * scale;

  const inset = frame ? (BOARD_W + DECK.board.gapMm / 2) : 0;
  const boards = [];
  for (let i = 0; i < rows; i++) {
    const at = inset + i * PITCH;
    for (let p = 0; p < piecesPerRow; p++) {
      const along = inset + p * (pieceMm + BOARD_W + DECK.board.gapMm / 2);
      boards.push(
        boardsAcross
          ? { x: along, y: at, w: pieceMm, h: BOARD_W, key: `${i}-${p}` }
          : { x: at, y: along, w: BOARD_W, h: pieceMm, key: `${i}-${p}` }
      );
    }
  }

  const grain = shade(hex, 0.86);
  const edge = shade(hex, 0.7);

  return (
    <svg
      className={own.plan}
      viewBox={`0 0 ${w + PAD * 2} ${h + PAD * 2}`}
      role="img"
      aria-label={`Plan of a ${(deckW / 1000).toFixed(1)} by ${(deckH / 1000).toFixed(1)} metre deck`}
    >
      <g transform={`translate(${PAD} ${PAD}) scale(${scale})`}>
        {/* The substrate, which shows through the 6mm gaps the clips set. */}
        <rect x="0" y="0" width={deckW} height={deckH} fill="#1f2937" rx={20 / scale} />
        {/* The frame, drawn as four boards running round the edge with mitred
            corners. Perpendicular to the field, which is the whole reason
            anybody puts one on — and the only way the option is visible on a
            deck where frame and field are the same colour. */}
        {frame && (
          <g>
            <rect x={0} y={0} width={deckW} height={deckH} fill={hex} rx={20 / scale} />
            <rect x={inset} y={inset} width={deckW - inset * 2} height={deckH - inset * 2}
              fill="#1f2937" />
            {/* The groove down each frame board, following the edge it sits on. */}
            <line x1={0} y1={inset / 2} x2={deckW} y2={inset / 2} stroke={grain} strokeWidth={6} />
            <line x1={0} y1={deckH - inset / 2} x2={deckW} y2={deckH - inset / 2} stroke={grain} strokeWidth={6} />
            <line x1={inset / 2} y1={0} x2={inset / 2} y2={deckH} stroke={grain} strokeWidth={6} />
            <line x1={deckW - inset / 2} y1={0} x2={deckW - inset / 2} y2={deckH} stroke={grain} strokeWidth={6} />
            {/* Mitres, so the corners read as four boards rather than one hoop. */}
            {[[0, 0, inset, inset], [deckW, 0, deckW - inset, inset],
              [0, deckH, inset, deckH - inset], [deckW, deckH, deckW - inset, deckH - inset]]
              .map(([x1, y1, x2, y2], i) => (
                <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke={edge} strokeWidth={4} />
              ))}
          </g>
        )}
        {boards.map(b => (
          <g key={b.key}>
            <rect x={b.x} y={b.y} width={b.w} height={b.h} fill={hex} />
            {/* One groove down the middle of each board, as the profile has. */}
            <line
              x1={b.x + (boardsAcross ? 0 : b.w / 2)} y1={b.y + (boardsAcross ? b.h / 2 : 0)}
              x2={b.x + (boardsAcross ? b.w : b.w / 2)} y2={b.y + (boardsAcross ? b.h / 2 : b.h)}
              stroke={grain} strokeWidth={6}
            />
          </g>
        ))}
      </g>

      {/* Dimensions, so the drawing is a plan and not a picture. */}
      <g className={own.dims}>
        <line x1={PAD} y1={PAD + h + 18} x2={PAD + w} y2={PAD + h + 18} />
        <text x={PAD + w / 2} y={PAD + h + 36} textAnchor="middle">
          {(deckW / 1000).toFixed(2)}m
        </text>
        <line x1={PAD + w + 18} y1={PAD} x2={PAD + w + 18} y2={PAD + h} />
        <text
          x={PAD + w + 34} y={PAD + h / 2} textAnchor="middle"
          transform={`rotate(90 ${PAD + w + 34} ${PAD + h / 2})`}
        >
          {(deckH / 1000).toFixed(2)}m
        </text>
      </g>
    </svg>
  );
}

export default function CompositeDeckCalculator({ onPick, onQuantityChange, onRecommend }) {
  const [colour, setColour] = useState(COLOURS[2].key);   // Leatherwood, the usual pick
  const [lengthM, setLengthM] = useState('');
  const [widthM, setWidthM] = useState('');
  const [pictureFrame, setPictureFrame] = useState(false);
  const [boardsAcross, setBoardsAcross] = useState(true);
  const [priceList, setPriceList] = useState([]);

  useEffect(() => {
    api.get('/products').then(r => setPriceList(r.data)).catch(() => {});
  }, []);

  const swatch = COLOURS.find(c => c.key === colour) || COLOURS[0];
  const plan = useMemo(() => planDeck({
    lengthM: parseFloat(lengthM) || 0,
    widthM: parseFloat(widthM) || 0,
    pictureFrame,
    boardsAcross,
  }), [lengthM, widthM, pictureFrame, boardsAcross]);

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

  return (
    <div className={styles.calc}>
      <h3 className={styles.calcTitle}>Composite Deck Calculator</h3>
      <p className={own.sub}>Ekodeck Designer Series · 137 × 23mm board, 5.4m lengths</p>

      {/* ── The colour, which is the first thing a customer has an opinion on ── */}
      <div className={own.colours} role="radiogroup" aria-label="Board colour">
        {COLOURS.map(c => (
          <button
            key={c.key}
            type="button"
            role="radio"
            aria-checked={c.key === colour}
            className={c.key === colour ? own.colourOn : own.colour}
            onClick={() => setColour(c.key)}
            title={`${c.name} — ${c.tone}`}
          >
            <img src={SWATCH(c.key)} alt="" loading="lazy" />
            <span className={isLight(c.hex) ? own.chipDark : own.chipLight}>{c.name}</span>
          </button>
        ))}
      </div>

      <div className={styles.calcGrid}>
        <div className={styles.calcField}>
          <label>Deck length (m)</label>
          <input type="number" min="0" step="0.1" value={lengthM} inputMode="decimal"
            onChange={e => setLengthM(e.target.value)} placeholder="e.g. 6" />
        </div>
        <div className={styles.calcField}>
          <label>Deck width (m)</label>
          <input type="number" min="0" step="0.1" value={widthM} inputMode="decimal"
            onChange={e => setWidthM(e.target.value)} placeholder="e.g. 4" />
        </div>
      </div>

      <div className={own.options}>
        <label className={own.toggle}>
          <input type="checkbox" checked={pictureFrame}
            onChange={e => setPictureFrame(e.target.checked)} />
          <span>
            <strong>Picture frame</strong>
            <em>A board round the edge, hiding the cut ends</em>
          </span>
        </label>
        <label className={own.toggle}>
          <input type="checkbox" checked={!boardsAcross}
            onChange={e => setBoardsAcross(!e.target.checked)} />
          <span>
            <strong>Run the boards the other way</strong>
            <em>{boardsAcross ? 'Along the length at the moment' : 'Across the width at the moment'}</em>
          </span>
        </label>
      </div>

      {/* ── What it looks like ── */}
      <div className={own.preview}>
        {plan ? (
          <DeckPlan plan={plan} hex={swatch.hex} />
        ) : (
          <div className={own.previewEmpty}>Put a length and a width in to see the deck</div>
        )}
        <div className={own.swatchPane}>
          <img className={own.swatchImg} src={SWATCH(swatch.key)} alt={`${swatch.name} board`} />
          <div className={own.swatchName}>{swatch.name}</div>
          <div className={own.swatchTone}>{swatch.tone}</div>
          {SCENE_COLOURS.has(swatch.key) && (
            <img className={own.scene} src={`/ekodeck/${swatch.key}-deck.jpg`}
              alt={`A deck laid in ${swatch.name}`} loading="lazy" />
          )}
        </div>
      </div>

      {plan && (
        <div className={styles.calcResult}>
          <div className={styles.calcResultRow}><span>Deck area</span><strong>{plan.areaM2.toFixed(2)} m²</strong></div>
          <div className={styles.calcResultRow}>
            <span>Boards</span>
            <strong>
              {plan.rows} {plan.rows === 1 ? 'row' : 'rows'}
              {plan.piecesPerRow > 1 ? ` × ${plan.piecesPerRow} lengths` : ''} at {plan.pieceMm}mm
            </strong>
          </div>
          {plan.frame && (
            <div className={styles.calcResultRow}><span>Picture frame</span><strong>{plan.framePieces} boards</strong></div>
          )}
          <div className={styles.calcResultRow}>
            <span>5.4m lengths to order</span><strong>{plan.stockLengths}</strong>
          </div>
          <div className={styles.calcResultRow}>
            <span>QuickFix kits (100lm)</span><strong>{plan.kits}</strong>
          </div>
          <div className={styles.calcResultRow}>
            <span>Joists at {DECK.install.joistSpacingMm}mm centres</span><strong>{plan.joists}</strong>
          </div>
          <div className={styles.calcResultRow}>
            <span>Off the board</span>
            <strong>{plan.linearMetres}lm used · {plan.wastePct}% waste</strong>
          </div>

          {plan.shortfallMatters && (
            <div className={own.warn}>
              The last row leaves <strong>{plan.shortfallMm}mm</strong> uncovered. That is how
              Ekodeck count it too — their planner excludes fascia and edge boards — so either
              add an edge board, or allow one more row and bring the width back to{' '}
              {((plan.spanMm - plan.shortfallMm) / 1000).toFixed(3)}m.
            </div>
          )}

          {boardProduct ? (
            <>
              <div className={styles.calcResultRow}>
                <span>Board ({plan.stockLengths} × ${boardEach.toFixed(2)})</span>
                <strong>${(plan.stockLengths * boardEach).toFixed(2)}</strong>
              </div>
              {kitProduct && (
                <div className={styles.calcResultRow}>
                  <span>Clips ({plan.kits} × ${kitEach.toFixed(2)})</span>
                  <strong>${(plan.kits * kitEach).toFixed(2)}</strong>
                </div>
              )}
              <div className={styles.calcResultRow}>
                <span>Total (inc GST)</span>
                <strong className={styles.calcTotal}>
                  ${(total * 1.15).toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </strong>
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
      )}
    </div>
  );
}
