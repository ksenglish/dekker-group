// Taking off an Urban Group fence.
//
// Read off the Price List rather than written down here, because the list is
// already the record of what we sell and at what: ten ranges, four or five
// heights each, two or three colours, and every one of them carries its own
// panel width in its name. A table in this file would be a second copy to keep
// in step, and the first anybody would hear of it drifting is a quote.
//
// The part worth getting right is the posts. A panel is a panel, but a fence
// needs one more post than it has panels, every corner is a post two runs
// share, and a gate wants one at each side. Counting those by hand on site is
// where the money goes missing — a 40m fence with four corners is 18 panels
// and 19 posts, and quoting 18 is a day's wages.

// "Fresno Fence Panel 1800 x 2400mm Textured Black" — height by width, then
// the finish. Every range in the list names itself this way.
const SIZE = /(\d{3,4})\s*x\s*(\d{3,4})\s*mm/i;

// A gate is priced and counted separately from the fence line it sits in.
const isGate = name => /\bgate\b/i.test(name);
const isPost = row => /posts?$/i.test(row.subcategory_2 || '') || /\bpost\b/i.test(row.name || '');

// The finish, as the list writes it: "… 2400mm Textured Black" or "… Black".
function finishOf(name) {
  if (!SIZE.test(String(name))) return 'Standard';
  const after = String(name).split(SIZE).pop() || '';
  return after.replace(/^mm/i, '').trim() || 'Standard';
}

/**
 * Everything on the Price List that is an Urban Group fence, arranged the way
 * somebody picks one: range, then height, then colour.
 */
export function buildCatalogue(products) {
  const panels = [];
  const gates = [];
  const posts = [];

  for (const p of products) {
    const sub1 = p.subcategory_1 || '';
    const sub2 = p.subcategory_2 || '';
    const hay = `${sub1} ${sub2} ${p.name} ${p.description || ''}`;
    if (!/urban group/i.test(hay)) continue;
    if (isPost(p)) { posts.push(readPost(p)); continue; }

    const gate = isGate(p.name);
    // A gate kit is sized by its height and the width of its stile, not the
    // opening — "Pedestrian Gate Kit 1800 x 90mm" is 1800 high and converts a
    // bay, so the opening is the bay's. Taken as unknown here and asked for on
    // screen rather than quietly read as a 90mm gate.
    const m = SIZE.exec(p.name || '')
      || (gate ? /(\d{3,4})\s*x\s*\d+\s*mm/i.exec(p.name || '') : null);
    if (!m) continue;
    const entry = {
      id: p.id,
      sku: p.sku,
      name: p.name,
      range: sub2 && !/posts?$/i.test(sub2) ? sub2 : (p.subcategory_3 || 'Urban Group'),
      heightMm: Number(m[1]),
      widthMm: Number(m[2]) >= 100 ? Number(m[2]) : 0,
      finish: finishOf(p.name),
      // The ColourFence bays come with their posts in the box — "Includes 3x
      // Sheets, Top & Bottom Rails & Posts" — so a fence of them must not have
      // posts counted on top.
      includesPosts: /\bposts?\b/i.test(p.description || ''),
      unitPrice: p.unit_price || 0,
      costPrice: p.cost_price || 0,
      description: p.description || '',
      product: p,
    };
    (gate ? gates : panels).push(entry);
  }

  return { panels, gates, posts: posts.sort((a, b) => a.lengthMm - b.lengthMm) };
}

// "Aluminium Post 65 x 65 x 2.0 x 2500mm" — section, wall, then length. The
// base-plate ones say so in the name and are a different way of standing a
// fence up, so they are kept apart rather than mixed into the same list.
// Some posts belong to one range and must not be offered to another: a Paladin
// Fin post is a 100 x 25 blade the Paladin rails slot into, and a Channel post
// has the groove StabiFence and Fresno boards drop down. Offering either to a
// Secura panel is a quote that cannot be built.
//
// Read off the post rather than listed here, because the list already says so:
// the Channel post's own description reads "For use with StabiFence & Fresno
// Panels", which is two ranges and the reason this hands back several.
function postRanges(name, description) {
  const said = /for use with ([^.\n]+?)\s*panels/i.exec(description || '');
  if (said) {
    const named = said[1].split(/&|,|\band\b/).map(s => s.trim()).filter(Boolean);
    if (named.length) return named;
  }
  if (/paladin/i.test(name)) return ['Paladin'];
  if (/maximus/i.test(name)) return ['Maximus'];
  return null;   // suits anything
}

const finishIn = text => (/\bwhite\b/i.test(text) ? 'White'
  : /\bblack\b/i.test(text) ? 'Black' : null);

function readPost(p) {
  const nums = (p.name.match(/(\d+(?:\.\d+)?)/g) || []).map(Number);
  const lengthMm = nums.length ? Math.max(...nums.filter(n => n >= 1000)) || 0 : 0;
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    lengthMm,
    sectionMm: nums[0] || 0,
    basePlate: /base\s*plate|flange/i.test(`${p.name} ${p.description || ''}`),
    material: /steel/i.test(p.name) ? 'steel' : 'aluminium',
    ranges: postRanges(p.name, p.description),
    finish: finishIn(p.name),
    unitPrice: p.unit_price || 0,
    costPrice: p.cost_price || 0,
    product: p,
  };
}

// How far a post goes in the ground, which is what decides how long it has to
// be. Urban's own post lengths line up with this exactly: 1800, 2100, 2500 and
// 2900mm posts against 1200, 1500, 1800 and 2100mm panels.
//
// A starting point, not a rule — the calculator shows which post it picked and
// lets it be changed, because ground conditions decide this and the ground is
// not in the Price List.
export const DEFAULT_EMBEDMENT_MM = 600;

/**
 * The posts that will actually build this fence, shortest first.
 *
 * The same list the suggestion is picked from and the same list the calculator
 * offers, so what can be chosen by hand is what could have been chosen for
 * you — a dropdown with a Paladin Fin post in it on an Assure fence is a trap
 * whether or not the suggestion avoided it.
 */
export function postsFor(posts, { basePlate = false, range = null, finish = null } = {}) {
  let usable = (posts || []).filter(p => p.basePlate === basePlate && p.lengthMm > 0);
  if (!usable.length) return [];

  // A range that has its own post uses it; everything else uses the general
  // ones. Without this a 2100mm Secura panel is quoted a Paladin Fin post,
  // because the Fin happens to be the shortest thing on the list that reaches.
  const wantRange = String(range || '').toLowerCase();
  const own = range
    ? usable.filter(p => p.ranges
      && p.ranges.some(r => wantRange.includes(r.toLowerCase())
        || r.toLowerCase().includes(wantRange)))
    : [];
  usable = own.length ? own : usable.filter(p => !p.ranges);

  // Where a post comes in colours, the one matching the panel. A black fence
  // with a white post in it is a complaint, not a saving.
  const want = finish ? finishIn(finish) : null;
  if (want) {
    const matched = usable.filter(p => !p.finish || p.finish === want);
    if (matched.length) usable = matched;
  }

  return [...usable].sort((a, b) => a.lengthMm - b.lengthMm);
}

export function suggestPost(posts, { heightMm, basePlate = false, range = null, finish = null }) {
  const wanted = basePlate ? heightMm : heightMm + DEFAULT_EMBEDMENT_MM;
  const usable = postsFor(posts, { basePlate, range, finish });
  if (!usable.length) return null;
  // The shortest post that still reaches. Nothing shorter will do the job, and
  // anything longer is money in the ground.
  return usable.find(p => p.lengthMm >= wanted) || usable[usable.length - 1];
}

/**
 * A drawn fence, turned into the runs the take-off counts.
 *
 * Drawing is point to point, and a hand drawing a long boundary puts several
 * points down a straight edge. Those are one run, not three, and counting them
 * as three would put two corner posts in the middle of a straight fence. So
 * anything that carries on in nearly the same direction is joined back up, and
 * only a real turn starts a new run.
 *
 * `points` are {x, y} in metres. A closed shape repeats nothing — the last
 * point joins back to the first.
 */
export const CORNER_DEGREES = 12;

function turnBetween(a, b) {
  let d = Math.abs(b - a) * (180 / Math.PI);
  while (d > 360) d -= 360;
  return d > 180 ? 360 - d : d;
}

/**
 * The drawn points reduced to the corners of the fence: every point where it
 * actually turns, and none of the ones where the hand simply lifted.
 *
 * The take-off and the drawing both work from this, so a plan can never show
 * one thing and the figures another — which is what happened when the drawing
 * counted strokes and the take-off counted runs.
 */
export function runVertices(points, closed = false) {
  const pts = (points || []).filter(p => p && Number.isFinite(p.x) && Number.isFinite(p.y));
  if (pts.length < 2) return [];

  const segs = [];
  const last = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < last; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > 0.01) segs.push({ a, b, len, angle: Math.atan2(dy, dx) });
  }
  if (!segs.length) return [];

  // Each run starts where the fence last turned and ends where it turns next.
  const runs = [{ a: segs[0].a, b: segs[0].b, angle: segs[0].angle }];
  for (let i = 1; i < segs.length; i++) {
    const run = runs[runs.length - 1];
    if (turnBetween(run.angle, segs[i].angle) < CORNER_DEGREES) {
      run.b = segs[i].b;            // same run, drawn in two strokes
    } else {
      runs.push({ a: segs[i].a, b: segs[i].b, angle: segs[i].angle });
    }
  }
  // A closed shape whose last stroke comes back in line with the first is the
  // same run arriving home, so the two are one and the fence starts further
  // back than the hand did.
  if (closed && runs.length > 2
    && turnBetween(runs[runs.length - 1].angle, runs[0].angle) < CORNER_DEGREES) {
    runs[0].a = runs.pop().a;
  }

  const out = runs.map(r => r.a);
  if (!closed) out.push(runs[runs.length - 1].b);
  return out;
}

export function runsFromPoints(points, closed = false) {
  const v = runVertices(points, closed);
  if (v.length < 2) return [];
  const runs = [];
  const last = closed ? v.length : v.length - 1;
  for (let i = 0; i < last; i++) {
    const a = v[i];
    const b = v[(i + 1) % v.length];
    runs.push(Math.round(Math.hypot(b.x - a.x, b.y - a.y) * 100) / 100);
  }
  return runs;
}

/**
 * The take-off.
 *
 * `runs` are the straight lengths in metres, in the order they are walked.
 * Corners are what happens between them, which is why they are not counted
 * separately: four runs round a section is three corners, or four if it closes
 * back on itself.
 */
export function takeOff({
  runs, panelWidthMm, closedLoop = false, gates = 0, gateWidthMm = 0,
  postsIncluded = false,
}) {
  const lengths = (runs || []).map(Number).filter(n => Number.isFinite(n) && n > 0);
  if (!lengths.length || !panelWidthMm) return null;

  const totalMm = lengths.reduce((s, m) => s + m * 1000, 0);
  const gateMm = Math.max(0, gates) * gateWidthMm;
  // The gates come out of the fence line before the panels are counted: a 12m
  // run with a 1.2m gate in it is 10.8m of fence, not 12.
  const fenceMm = Math.max(0, totalMm - gateMm);

  // The gates come out of the fence line before the panels are counted — a 12m
  // run with a 1.2m gate in it is 10.8m of fence, not 12 — and they come out of
  // the longest run, because that is the one with room for them. Which run a
  // gate actually sits in is the installer's call, and the plan shows where
  // this has put it so it can be moved.
  const order = lengths.map((m, i) => i).sort((a, b) => lengths[b] - lengths[a]);
  const runMm = lengths.map(m => m * 1000);
  let owing = gateMm;
  const gateRuns = [];
  for (const i of order) {
    if (owing <= 0) break;
    const off = Math.min(owing, runMm[i]);
    runMm[i] -= off;
    owing -= off;
    gateRuns.push(i);
  }

  // Panels per run, not off the total, because that is how they are bought: a
  // 4.9m run and a 4.9m run are two part panels, not one whole and one part.
  // Each run starts and ends on a post and the offcut from one does not get
  // carried round a corner into the next.
  const perRun = runMm.map(mm => Math.ceil(Math.max(0, mm) / panelWidthMm));
  const panels = perRun.reduce((s, n) => s + n, 0);

  const runCount = lengths.length;
  // Corners: one between each pair of runs, and one more if the fence closes.
  const corners = closedLoop ? runCount : Math.max(0, runCount - 1);
  // Ends: none if it closes back on itself.
  const ends = closedLoop ? 0 : 2;

  // Every panel needs a post each side, and neighbours share. Across the whole
  // fence that is one more post than panels — less one for every corner, which
  // two runs share, and plus one each side of every gate.
  //
  // Written as the thing it is rather than a formula nobody can check:
  const linePosts = panels + 1 - corners - (closedLoop ? 1 : 0);
  const gatePosts = Math.max(0, gates) * 2;
  const posts = Math.max(0, linePosts) + corners + gatePosts;

  // A ColourFence bay comes with its posts in the box, so a post line on top of
  // it charges for them twice. The counts are still worked out, because the
  // fence still has that many posts in it and they still have to be dug — they
  // are just not a line on the quote.
  const charged = postsIncluded
    ? { posts: 0, endPosts: 0, cornerPosts: 0, gatePosts: 0, linePosts: 0 }
    : {
      // What each post is for, because they are not the same post and not the
      // same price: a corner takes the load of two runs and a gate post takes
      // a gate swinging off it.
      posts,
      endPosts: ends,
      cornerPosts: corners,
      gatePosts,
      linePosts: Math.max(0, posts - ends - corners - gatePosts),
    };

  return {
    runs: lengths,
    runCount,
    totalMetres: Math.round((totalMm / 1000) * 100) / 100,
    fenceMetres: Math.round((fenceMm / 1000) * 100) / 100,
    panels,
    panelWidthMm,
    ...charged,
    postsIncluded,
    // The fence has these whether or not they are charged for, which is what
    // the labour to dig them is worked out on.
    postsInFence: posts,
    cornersInFence: corners,
    // Per run, so the plan can be drawn and the installer can see where the
    // part panel falls rather than finding out on site.
    panelsPerRun: perRun,
    fenceMmPerRun: runMm.map(mm => Math.max(0, Math.round(mm))),
    // What comes off the last panel in each run. Per run because that is where
    // the cut happens: "1200mm to cut" across a fence with four runs could be
    // one cut or four, and the installer needs to know which.
    offcutPerRun: perRun.map((n, i) => Math.max(0, Math.round(n * panelWidthMm - runMm[i]))),
    // Which run the gates were taken out of.
    gateRuns,
    gates: Math.max(0, gates),
    closedLoop,
    coveredMm: panels * panelWidthMm,
    offcutMm: Math.max(0, panels * panelWidthMm - fenceMm),
  };
}

// The money. Materials off the Price List, labour at whatever the business
// charges to put it up — which is a rate on the calculator, not a number
// hidden in here, because it is the thing that changes most often.
export function priceUp({
  plan, panel, post, gate,
  labourPerMetre = 0, labourPerPost = 0, labourPerGate = 0,
}) {
  if (!plan) return null;
  const panelCost = (panel?.unitPrice || 0) * plan.panels;
  const postCost = (post?.unitPrice || 0) * plan.posts;
  const gateCost = (gate?.unitPrice || 0) * plan.gates;
  const materials = panelCost + postCost + gateCost;
  // Three rates because a fence is put up in three different jobs: walking the
  // line and hanging panels, digging and concreting posts, and hanging a gate
  // so it still shuts in a year. A single per-metre rate prices a fence with
  // four corners and two gates the same as a straight one.
  const labour = Math.round(labourPerMetre * 100) * plan.fenceMetres
    + Math.round(labourPerPost * 100) * (plan.posts || plan.postsInFence || 0)
    + Math.round(labourPerGate * 100) * plan.gates;
  return {
    panelCost, postCost, gateCost, materials,
    labour: Math.round(labour),
    exGst: Math.round(materials + labour),
    incGst: Math.round((materials + labour) * 1.15),
  };
}
