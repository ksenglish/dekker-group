// Working out a composite deck: how many boards, how they are cut, what is
// left over.
//
// Kept out of the component because it is the part that has to be right. A
// customer standing in their back yard is told a number here and later gets a
// Bunnings docket; the two disagreeing is the thing that costs a job.
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

// A joint between two boards in the same run takes a board's width, because
// the run lands on a breaker board rather than two cut ends butting together.
const JOINT_MM = BOARD_W + GAP / 2;

const mm = m => Math.round(m * 1000);

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

/**
 * @param lengthM  the deck along the direction the boards run
 * @param widthM   the deck across them
 * @param pictureFrame  a board round the perimeter, which the field butts into
 * @param boardsAcross  false lays the boards along the length instead
 */
export function planDeck({ lengthM, widthM, pictureFrame = false, boardsAcross = true }) {
  const L = mm(lengthM);
  const W = mm(widthM);
  if (!(L > 0 && W > 0)) return null;

  // Which way the boards run decides which dimension they span and which one
  // they stack up across.
  const runMm = boardsAcross ? L : W;
  const spanMm = boardsAcross ? W : L;

  // The frame takes a board off every edge — and the clip gap with it, the
  // same way a breaker does, because the field lands against the frame rather
  // than butting into it. 137 + 3 = 140, which is what makes a framed 5m deck
  // 4720mm of field rather than 4726mm.
  const frame = pictureFrame ? JOINT_MM : 0;
  const fieldRun = runMm - 2 * frame;
  const fieldSpan = spanMm - 2 * frame;
  if (fieldRun <= 0 || fieldSpan <= 0) return null;

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
  const { pieces, pieceMm, joints } = cutRun(fieldRun);
  if (!pieces) return null;   // longer than three boards end to end
  const fieldPieces = rows * pieces;
  const fieldStock = stockFor(pieceMm, fieldPieces);

  // The frame itself: one run down each side, cut from stock like anything
  // else. Mitred at the corners, so each side is the full deck dimension.
  let frameStock = 0;
  let framePieces = 0;
  let frameLm = 0;
  if (pictureFrame) {
    for (const side of [L, L, W, W]) {
      const cut = cutRun(side);
      framePieces += cut.pieces;
      frameStock += stockFor(cut.pieceMm, cut.pieces);
      frameLm += side / 1000;
    }
  }

  const fieldLm = (fieldPieces * pieceMm) / 1000;
  const linearMetres = fieldLm + frameLm;

  // Ordered a little over the cut list. A deck one board short stops a crew
  // for a day, and the offcut is worth less than the second trip.
  //
  // More when the plan depends on getting two pieces out of every length. On
  // paper 126 pieces at two a board is 63 boards exactly; on site a factory
  // end, a damaged edge or one bad cut means it is not, and there is no slack
  // anywhere in that number. Ekodeck's own planner lands above this on the
  // same decks, which is the check that found it: 8 x 6 comes back as 68 from
  // them and would have been 65 from here.
  const relyingOnNesting = pieces > 1 && STOCK / pieceMm >= 2;
  const uplift = relyingOnNesting ? 1.08 : UPLIFT;
  const bareStock = fieldStock + frameStock;
  const stockLengths = Math.round(bareStock * uplift);

  const suppliedMm = stockLengths * STOCK;
  const usedMm = linearMetres * 1000;

  return {
    areaM2: (L * W) / 1e6,
    rows,
    piecesPerRow: pieces,
    pieceMm,
    joints,
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
    // Joists at the spacing Ekodeck requires, so the subframe can be talked
    // about in the same breath. Across the run, plus one to close the end.
    joists: Math.floor(runMm / spec.install.joistSpacingMm) + 1,
    // What the last row leaves, and whether it is enough to mention. A few
    // millimetres is the gaps taking up slack; a hundred is a board.
    shortfallMm,
    shortfallMatters: shortfallMm >= 20,
    frame: pictureFrame,
    boardsAcross,
    runMm,
    spanMm,
  };
}

export { BOARD_W, GAP, PITCH, STOCK };
