// Working out a composite deck: how many boards, how they are cut, what is
// left over, and where every joist and clip lands.
//
// Kept out of the component because it is the part that has to be right. A
// customer standing in their back yard is told a number here and later gets a
// Bunnings docket; the two disagreeing is the thing that costs a job.
//
// The deck is an outline drawn on the plan, not a length and a width. A back
// yard is rarely a rectangle and the drawing tool will happily draw an L, so
// the take-off reads the shape itself: each row of board is a line across the
// outline, and what the line covers is what gets cut. A rectangle is just the
// easy case of that, and it still comes out exactly where it used to.
//
// Calibrated against Ekodeck's own Deck Planner. Their numbers for the same
// inputs, which the tests hold this to:
//
//   5x5, plain             35 boards of 5000mm, 36 lengths, 2 kits
//   3x3, plain             21 boards of 3000mm, 22 lengths, 1 kit
//   10x4, plain            56 boards of 4930mm, 58 lengths, 3 kits
//   5x5, picture frame     33 boards of 4720mm, 38 lengths, 2 kits
import spec from '../../../../shared/ekodeckDesignerSeries.json';

export const DECK = spec;
export const COLOURS = spec.colours;

const { widthMm: BOARD_W, gapMm: GAP, pitchMm: PITCH, lengthMm: STOCK } = spec.board;
const KIT_LM = spec.fixing.coversLinearMetres;
const UPLIFT = 1 + spec.allowance.orderUpliftPct / 100;
const JOIST_SPACING = spec.install.joistSpacingMm;
// What a joist is drawn as. Nothing is counted off it — the subframe is the
// builder's, not Ekodeck's — but it has to be the real width or the picture
// lies about how much of the board is sitting on timber.
const JOIST_W = 45;

// A joint between two boards in the same run takes a board's width, because
// the run lands on a breaker board rather than two cut ends butting together.
const JOINT_MM = BOARD_W + GAP / 2;

const mm = m => Math.round(m * 1000);

// ── Shapes ──────────────────────────────────────────────────────────────────
//
// Enough polygon arithmetic to lay boards inside a drawn outline. All of it in
// millimetres, all of it pure, so it can be checked on paper.

function signedArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function areaOfPoly(poly) { return Math.abs(signedArea(poly)); }

export function perimeterOfPoly(poly) {
  let d = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    d += Math.hypot(q.x - p.x, q.y - p.y);
  }
  return d;
}

function inside(poly, pt) {
  let on = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if ((a.y > pt.y) !== (b.y > pt.y)
      && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) on = !on;
  }
  return on;
}

// One edge moved `by` towards the inside of the shape, as an infinite line.
// Which side is inside is settled by stepping off the middle of the edge and
// looking, rather than by trusting the order the corners were drawn in.
function movedEdge(a, b, by, poly) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (!(len > 0)) return null;
  const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  let n = { x: -u.y, y: u.x };
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const peek = Math.min(by, len) / 100;
  if (!inside(poly, { x: mid.x + n.x * peek, y: mid.y + n.y * peek })) n = { x: -n.x, y: -n.y };
  return { p: { x: a.x + n.x * by, y: a.y + n.y * by }, u };
}

function meet(l1, l2) {
  const d = l1.u.x * l2.u.y - l1.u.y * l2.u.x;
  // Two edges carrying straight on: there is no corner to cut, so the moved
  // line simply continues.
  if (Math.abs(d) < 1e-9) return { x: l2.p.x, y: l2.p.y };
  const t = ((l2.p.x - l1.p.x) * l2.u.y - (l2.p.y - l1.p.y) * l2.u.x) / d;
  return { x: l1.p.x + l1.u.x * t, y: l1.p.y + l1.u.y * t };
}

// The same outline with every edge moved `by` towards the inside and the
// corners taken out to where the moved edges meet. That is exactly what a
// picture frame does: the field starts a board in from every edge, and the
// corners are mitred. On a rectangle it is the rectangle less a board all
// round, which is what makes a framed 5m deck 4720mm of field.
export function insetPolygon(poly, by) {
  if (!(by > 0) || !poly || poly.length < 3) return poly;
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const prev = poly[(i - 1 + poly.length) % poly.length];
    const here = poly[i];
    const next = poly[(i + 1) % poly.length];
    const l1 = movedEdge(prev, here, by, poly);
    const l2 = movedEdge(here, next, by, poly);
    if (!l1 || !l2) return null;
    out.push(meet(l1, l2));
  }
  // Inset further than the shape is wide and it turns itself inside out.
  if (!(areaOfPoly(out) > 0) || areaOfPoly(out) >= areaOfPoly(poly)) return null;
  return out;
}

// Where a line across the shape is actually on the shape. One row of board,
// one joist: both are this. Returns the stretches in order, shortest slivers
// dropped — a 1mm clip of a corner is not a board.
export function spansAt(poly, at, axis) {
  const cross = axis === 'x' ? 'y' : 'x';
  const along = axis === 'x' ? 'x' : 'y';
  const hits = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if ((a[cross] <= at && b[cross] > at) || (b[cross] <= at && a[cross] > at)) {
      const t = (at - a[cross]) / (b[cross] - a[cross]);
      hits.push(a[along] + (b[along] - a[along]) * t);
    }
  }
  hits.sort((p, q) => p - q);
  const spans = [];
  for (let i = 0; i + 1 < hits.length; i += 2) {
    if (hits[i + 1] - hits[i] > 1) spans.push({ from: hits[i], to: hits[i + 1] });
  }
  return spans;
}

function boundsOf(poly) {
  const xs = poly.map(p => p.x);
  const ys = poly.map(p => p.y);
  return {
    x0: Math.min(...xs), x1: Math.max(...xs),
    y0: Math.min(...ys), y1: Math.max(...ys),
  };
}

// ── Cutting ─────────────────────────────────────────────────────────────────

// How a single run is cut.
//
// A run no longer than a board is one piece and there is nothing to decide. A
// longer one is cut into equal pieces with a breaker board between them — but
// how many pieces is a real choice, and taking the first number that fits is
// expensive.
//
// A 6m run cut in two is two 2930mm pieces, and only one of those comes out of
// a 5.4m length: 2470mm of every board goes in the bin. Cut in three it is
// three 1906mm pieces, two to a length, and the same deck takes a third less
// board. On a 6 x 4 deck that is twenty lengths — about two thousand dollars
// of decking ordered for no reason.
//
// So the options are costed and the cheapest wins. Capped at three pieces:
// past that a row has more joints than anybody wants to look at, and the
// saving is no longer the point.
const MAX_PIECES = 3;

function cutRun(runMm) {
  if (runMm <= 0) return { pieces: 0, pieceMm: 0, joints: 0, perLength: 0 };
  // A joint is forced by the length of the run, never chosen to save board.
  // Three 907mm pieces nest five to a length and would make a 3m deck cheaper
  // than one 3m piece — and put two breakers in every row of a deck nobody
  // would accept. So the search starts at the fewest pieces that fit, and only
  // then asks which of the remaining options wastes least.
  if (runMm <= STOCK) {
    return {
      pieces: 1, pieceMm: Math.round(runMm), joints: 0,
      perLength: Math.floor(STOCK / runMm), lengthsPerRow: 1 / Math.floor(STOCK / runMm),
    };
  }

  let fewest = 2;
  while (Math.round((runMm - (fewest - 1) * JOINT_MM) / fewest) > STOCK) fewest++;

  let best = null;
  for (let pieces = fewest; pieces <= Math.max(fewest, MAX_PIECES); pieces++) {
    const pieceMm = Math.round((runMm - (pieces - 1) * JOINT_MM) / pieces);
    if (pieceMm <= 0 || pieceMm > STOCK) continue;
    const perLength = Math.floor(STOCK / pieceMm);
    // Stock lengths per row of deck, which is the thing being minimised.
    const lengthsPerRow = pieces / perLength;
    if (!best || lengthsPerRow < best.lengthsPerRow - 1e-9) {
      best = { pieces, pieceMm, joints: pieces - 1, perLength, lengthsPerRow };
    }
  }
  // Nothing fits in a board: the run is longer than three boards end to end.
  return best || { pieces: 0, pieceMm: 0, joints: 0, perLength: 0 };
}

// Whole boards of stock, nesting as many pieces into each length as fit. Two
// 2386mm pieces come out of one 5400 length; one 5000mm piece does not leave
// enough for a second.
function stockFor(pieceMm, count) {
  if (!count || pieceMm <= 0) return 0;
  const perLength = Math.max(1, Math.floor(STOCK / pieceMm));
  return Math.ceil(count / perLength);
}

// ── The deck ────────────────────────────────────────────────────────────────

/**
 * @param points   the outline drawn on the plan, in metres
 * @param closed   an outline that does not close is not a deck
 * @param pictureFrame  a board round the perimeter, which the field butts into
 * @param boardsAcross  true runs the boards along the x axis of the drawing
 */
export function planDeckShape({ points, closed = true, pictureFrame = false, boardsAcross = true }) {
  if (!closed || !points || points.length < 3) return null;
  const outline = points.map(p => ({ x: p.x * 1000, y: p.y * 1000 }));
  if (!(areaOfPoly(outline) > 0)) return null;

  const axis = boardsAcross ? 'x' : 'y';
  const crossAxis = boardsAcross ? 'y' : 'x';
  const whole = boundsOf(outline);
  const runMm = axis === 'x' ? whole.x1 - whole.x0 : whole.y1 - whole.y0;
  const spanMm = axis === 'x' ? whole.y1 - whole.y0 : whole.x1 - whole.x0;
  if (!(runMm > 0 && spanMm > 0)) return null;

  // The frame takes a board off every edge — and the clip gap with it, the
  // same way a breaker does, because the field lands against the frame rather
  // than butting into it. 137 + 3 = 140, which is what makes a framed 5m deck
  // 4720mm of field rather than 4726mm.
  const field = pictureFrame ? insetPolygon(outline, JOINT_MM) : outline;
  if (!field) return null;
  const inner = boundsOf(field);
  const fieldSpan = axis === 'x' ? inner.y1 - inner.y0 : inner.x1 - inner.x0;
  if (!(fieldSpan > 0)) return null;

  // Rows of board across the field.
  //
  // Rounded down, which is what Ekodeck's planner does and therefore what a
  // Bunnings docket will say: 4100mm of span comes back as 28 boards, not 29.
  // The last board's trailing gap is not needed, hence the +GAP.
  //
  // Rounding down can leave real space — 4100mm of span is covered to 3998mm
  // and 102mm is left over. That is deliberate on their side: their planner
  // says in as many words that fascia and edge boards are not included. It is
  // not safe to leave unsaid on a quote, so the shortfall is measured and
  // handed back, and the calculator says so on screen.
  const rows = Math.floor((fieldSpan + GAP) / PITCH);
  if (rows < 1) return null;
  const coveredMm = rows * PITCH - GAP;
  const shortfallMm = Math.max(0, fieldSpan - coveredMm);

  const crossStart = axis === 'x' ? inner.y0 : inner.x0;

  // Every piece of board that will be cut, and where it goes. One pass, so the
  // drawing and the order cannot tell different stories.
  const boards = [];
  const breakers = new Map();       // where a run is jointed
  const cuts = new Map();           // pieceMm -> how many
  let fieldPieces = 0;
  let fieldMm = 0;
  let nesting = false;
  let mostPieces = 0;
  const rowLines = [];
  for (let i = 0; i < rows; i++) {
    const at = crossStart + i * PITCH + BOARD_W / 2;
    const spans = spansAt(field, at, axis);
    rowLines.push({ at, spans });
    for (const span of spans) {
      const cut = cutRun(span.to - span.from);
      if (!cut.pieces) continue;
      if (cut.pieces > 1 && Math.floor(STOCK / cut.pieceMm) >= 2) nesting = true;
      mostPieces = Math.max(mostPieces, cut.pieces);
      cuts.set(cut.pieceMm, (cuts.get(cut.pieceMm) || 0) + cut.pieces);
      fieldPieces += cut.pieces;
      fieldMm += cut.pieces * cut.pieceMm;
      for (let p = 0; p < cut.pieces; p++) {
        const a0 = span.from + p * (cut.pieceMm + JOINT_MM);
        boards.push({ a0, a1: a0 + cut.pieceMm, at });
        // Where two pieces in the same run meet, the gap between them is a
        // board width because a board goes in it, running the other way, and
        // both cut ends land on it. Noted so the drawing can show one rather
        // than a stripe of bare deck.
        if (p < cut.pieces - 1) {
          const key = Math.round(a0 + cut.pieceMm);
          const was = breakers.get(key) || { a0: key, a1: key + JOINT_MM, c0: at, c1: at };
          breakers.set(key, {
            ...was,
            c0: Math.min(was.c0, at - BOARD_W / 2),
            c1: Math.max(was.c1, at + BOARD_W / 2),
          });
        }
      }
    }
  }
  if (!fieldPieces) return null;

  let fieldStock = 0;
  for (const [pieceMm, count] of cuts) fieldStock += stockFor(pieceMm, count);

  // The frame itself: one run down each edge of the outline, cut from stock
  // like anything else. Mitred at the corners, so each side is the full
  // dimension of the deck.
  let frameStock = 0;
  let framePieces = 0;
  let frameMm = 0;
  if (pictureFrame) {
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i];
      const b = outline[(i + 1) % outline.length];
      const side = Math.hypot(b.x - a.x, b.y - a.y);
      const cut = cutRun(side);
      framePieces += cut.pieces;
      frameStock += stockFor(cut.pieceMm, cut.pieces);
      frameMm += side;
    }
  }

  const linearMetres = (fieldMm + frameMm) / 1000;

  // Ordered a little over the cut list. A deck one board short stops a crew
  // for a day, and the offcut is worth less than the second trip.
  //
  // More when the plan depends on getting two pieces out of every length. On
  // paper 126 pieces at two a board is 63 boards exactly; on site a factory
  // end, a damaged edge or one bad cut means it is not, and there is no slack
  // anywhere in that number. Ekodeck's own planner lands above this on the
  // same decks, which is the check that found it: 8 x 6 comes back as 68 from
  // them and would have been 65 from here.
  const uplift = nesting ? 1.08 : UPLIFT;
  const bareStock = fieldStock + frameStock;
  const stockLengths = Math.round(bareStock * uplift);

  const suppliedMm = stockLengths * STOCK;
  const usedMm = linearMetres * 1000;

  // ── The subframe, and what holds the boards down ──────────────────────────
  //
  // Across the boards, at the spacing Ekodeck require, starting at the end of
  // the deck. Counted off the outline rather than the field, because the frame
  // boards need something under them too.
  const alongStart = axis === 'x' ? whole.x0 : whole.y0;
  const joists = [];
  for (let at = alongStart; at <= alongStart + runMm + 1; at += JOIST_SPACING) {
    const spans = spansAt(outline, Math.min(at, alongStart + runMm - 1), crossAxis);
    if (spans.length) joists.push({ at, spans });
  }
  const joistMm = joists.reduce(
    (sum, j) => sum + j.spans.reduce((s, sp) => s + (sp.to - sp.from), 0), 0);

  // A clip wherever a board crosses a joist, which is what holds it down and
  // sets the 6mm gap. One of them per board is a locking clip, in the middle,
  // so the board grows and shrinks away from a fixed centre instead of
  // creeping down the deck.
  const clips = [];
  const locks = [];
  for (const row of rowLines) {
    for (const span of row.spans) {
      const on = joists.filter(j => j.at >= span.from - 1 && j.at <= span.to + 1);
      if (!on.length) continue;
      const middle = (span.from + span.to) / 2;
      const lock = on.reduce((a, b) => (Math.abs(b.at - middle) < Math.abs(a.at - middle) ? b : a));
      for (const j of on) {
        const point = axis === 'x' ? { x: j.at, y: row.at } : { x: row.at, y: j.at };
        (j === lock ? locks : clips).push(point);
      }
    }
  }

  // The most common cut, which is the one a rectangle has only one of and the
  // one worth leading with on anything else.
  const sections = [...cuts.entries()]
    .map(([pieceMm, count]) => ({ pieceMm, count }))
    .sort((a, b) => b.count - a.count || b.pieceMm - a.pieceMm);

  const toM = v => v / 1000;
  const pointsM = poly => poly.map(p => ({ x: toM(p.x), y: toM(p.y) }));

  return {
    areaM2: areaOfPoly(outline) / 1e6,
    perimeterM: perimeterOfPoly(outline) / 1000,
    rows,
    sections,
    piecesPerRow: mostPieces,
    pieceMm: sections[0]?.pieceMm || 0,
    // Breakers in the longest run on the deck, which is the number anybody
    // looking at the drawing is counting.
    joints: Math.max(0, mostPieces - 1),
    fieldPieces,
    framePieces,
    boards: fieldPieces + framePieces,
    linearMetres: Math.round(linearMetres * 10) / 10,
    stockLengths,
    kits: Math.max(1, Math.ceil(linearMetres / KIT_LM)),
    // How much of what is bought ends up on the deck. Shown because it is the
    // number that explains why a 3x3 deck costs more per square metre than a
    // 5x5 one: a 3m cut off a 5.4m board wastes nearly half of it.
    utilisationPct: suppliedMm ? Math.round((usedMm / suppliedMm) * 100) : 0,
    wastePct: suppliedMm ? 100 - Math.round((usedMm / suppliedMm) * 100) : 0,
    joists: joists.length,
    joistLm: Math.round(joistMm / 100) / 10,
    clipCount: clips.length + locks.length,
    lockCount: locks.length,
    // What the last row leaves, and whether it is enough to mention. A few
    // millimetres is the gaps taking up slack; a hundred is a board.
    shortfallMm: Math.round(shortfallMm),
    shortfallMatters: shortfallMm >= 20,
    frame: pictureFrame,
    boardsAcross,
    runMm: Math.round(runMm),
    spanMm: Math.round(spanMm),
    // Everything the drawing needs, in metres, worked out from the same pass
    // that counted the order.
    layout: {
      axis,
      outline: pointsM(outline),
      field: pointsM(field),
      boards: boards.map(b => ({ a0: toM(b.a0), a1: toM(b.a1), at: toM(b.at) })),
      breakers: [...breakers.values()].map(b => ({
        a0: toM(b.a0), a1: toM(b.a1), c0: toM(b.c0), c1: toM(b.c1),
      })),
      boardWidthM: toM(BOARD_W),
      joists: joists.map(j => ({
        at: toM(j.at),
        spans: j.spans.map(s => ({ from: toM(s.from), to: toM(s.to) })),
      })),
      joistWidthM: toM(JOIST_W),
      clips: clips.map(c => ({ x: toM(c.x), y: toM(c.y) })),
      locks: locks.map(c => ({ x: toM(c.x), y: toM(c.y) })),
    },
  };
}

/**
 * The rectangle case, kept because it is the one Ekodeck's planner is
 * calibrated against and the one the tests hold this to.
 *
 * @param lengthM  the deck along the direction the boards run
 * @param widthM   the deck across them
 */
export function planDeck({ lengthM, widthM, pictureFrame = false, boardsAcross = true }) {
  const L = mm(lengthM);
  const W = mm(widthM);
  if (!(L > 0 && W > 0)) return null;
  // The deck is the same rectangle either way round: turning the boards turns
  // the boards, not the deck. "Length" means the way the boards run, so the
  // rectangle is laid out with that along x and the boards told to follow it.
  const [x, y] = boardsAcross ? [L, W] : [W, L];
  const made = planDeckShape({
    points: [
      { x: 0, y: 0 }, { x: x / 1000, y: 0 },
      { x: x / 1000, y: y / 1000 }, { x: 0, y: y / 1000 },
    ],
    closed: true,
    pictureFrame,
    boardsAcross: true,
  });
  return made ? { ...made, boardsAcross } : null;
}

export { BOARD_W, GAP, PITCH, STOCK, JOIST_SPACING, JOINT_MM };
