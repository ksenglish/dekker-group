// Taking off a timber paling fence.
//
// The way we build them: 100 x 100 posts concreted 600mm into the ground, no
// more than two metres apart, 100 x 50 rails between them, 150 x 25 palings
// on the face, and a 65 x 35 cap on top if it is asked for.
//
// None of those figures are written down in here as law. They are the
// defaults below, and the real ones live in Presenter Setup — because post
// spacing, rail counts and what a paling covers are decisions the business
// makes, they change, and a number buried in a file is one nobody can change
// when it does. What is in here is the arithmetic those numbers feed.

// How it is built, until somebody says otherwise in Presenter Setup.
//
// The heights are the four we offer. Each carries its own rail count and its
// own post and paling, because those come off the Price List as whole
// products at a length — a 2.4m post and a 1.8m paling are different line
// items, not a length typed into a quote.
export const DEFAULT_SPEC = {
  rules: {
    // No more than this between posts. A bay is whatever is left over when a
    // run is divided up, so the real spacing is always this or less.
    maxSpacingMm: 2000,
    // How far a post goes in the ground. Not part of the fence you can see,
    // but it is what decides which post to buy.
    embedmentMm: 600,
    // Bags of concrete per post.
    bagsPerPost: 2,
    // What one paling covers. 150 is butting them up against each other; set
    // it lower to overlap and higher to leave a gap between them.
    palingCoverMm: 150,
    // Rails and cap are cut from stock lengths. The whole fence's worth is
    // added up and divided by this, which over-orders slightly on purpose —
    // a fence one rail short stops a crew for a day.
    railLengthMm: 4800,
    capLengthMm: 4800,
  },
  heights: [
    { mm: 1200, rails: 2, postProductId: null, palingProductId: null },
    { mm: 1500, rails: 3, postProductId: null, palingProductId: null },
    { mm: 1800, rails: 3, postProductId: null, palingProductId: null },
    { mm: 2000, rails: 3, postProductId: null, palingProductId: null },
  ],
  components: {
    rail: { productId: null },
    cap: { productId: null },
    concrete: { productId: null },
  },
  // Put up at whatever the business charges. Left at nothing rather than a
  // made-up rate, because a made-up rate is a quote nobody checked.
  labour: { perMetre: 0, perPost: 0 },
};

/** The spec as stored, with anything missing filled from the defaults. */
export function readSpec(stored) {
  const s = stored && typeof stored === 'object' ? stored : {};
  const heights = Array.isArray(s.heights) && s.heights.length ? s.heights : DEFAULT_SPEC.heights;
  return {
    rules: { ...DEFAULT_SPEC.rules, ...(s.rules || {}) },
    heights: heights
      .map(h => ({ ...DEFAULT_SPEC.heights.find(d => d.mm === h.mm), ...h }))
      .filter(h => h.mm > 0)
      .sort((a, b) => a.mm - b.mm),
    components: {
      rail: { ...DEFAULT_SPEC.components.rail, ...(s.components?.rail || {}) },
      cap: { ...DEFAULT_SPEC.components.cap, ...(s.components?.cap || {}) },
      concrete: { ...DEFAULT_SPEC.components.concrete, ...(s.components?.concrete || {}) },
    },
    labour: { ...DEFAULT_SPEC.labour, ...(s.labour || {}) },
  };
}

/**
 * The take-off.
 *
 * `runs` are the straight lengths in metres, the same ones the drawing tool
 * produces. Corners are what happens between them, which is why they are not
 * counted separately.
 *
 * Openings are a gateway left in the fence: the palings and rails come out of
 * the run and a post goes each side. What hangs in it is somebody else's line
 * on the quote — a gate is a different thing to build and is not guessed at
 * here.
 */
export function takeOff({
  runs, heightMm, spec, topCap = false, openings = 0, openingWidthMm = 0,
}) {
  const s = readSpec(spec);
  const height = s.heights.find(h => h.mm === Number(heightMm)) || s.heights[0];
  const lengths = (runs || []).map(Number).filter(n => Number.isFinite(n) && n > 0);
  if (!lengths.length || !height) return null;

  const { maxSpacingMm, embedmentMm, bagsPerPost, palingCoverMm,
    railLengthMm, capLengthMm } = s.rules;
  if (!(maxSpacingMm > 0) || !(palingCoverMm > 0)) return null;

  const totalMm = lengths.reduce((t, m) => t + m * 1000, 0);
  const openingMm = Math.max(0, openings) * Math.max(0, openingWidthMm);

  // The openings come out of the longest run, because that is the one with
  // room for them, and the plan shows where that was assumed to be.
  const order = lengths.map((m, i) => i).sort((a, b) => lengths[b] - lengths[a]);
  const runMm = lengths.map(m => m * 1000);
  let owing = openingMm;
  const openingRuns = [];
  for (const i of order) {
    if (owing <= 0) break;
    const off = Math.min(owing, runMm[i]);
    runMm[i] -= off;
    owing -= off;
    openingRuns.push(i);
  }
  const fenceMm = runMm.reduce((t, mm) => t + Math.max(0, mm), 0);

  // Bays per run, each no wider than the maximum. A 7m run is four bays of
  // 1.75m, not three of 2m and a bit over.
  const baysPerRun = runMm.map(mm => Math.ceil(Math.max(0, mm) / maxSpacingMm));
  const bays = baysPerRun.reduce((t, n) => t + n, 0);

  const runCount = lengths.length;
  const corners = Math.max(0, runCount - 1);
  // Every bay needs a post each side and neighbours share, so the fence has
  // one more post than it has bays. A corner is already one of those, because
  // the bays either side of it share it.
  //
  // A gateway adds one post, not two. There are two posts at the opening, but
  // the fence running up to it already had one of them — break a continuous
  // line in two and you go from one post to two, which is one more.
  const extraForOpenings = Math.max(0, openings);
  const posts = bays + 1 + extraForOpenings;

  // Which post to buy: long enough to stand the fence up and go in the
  // ground. The product itself is picked in Presenter Setup, because a 2.4m
  // post is a line on the Price List and not a length typed into a quote.
  const postLengthMm = height.mm + embedmentMm;

  // Palings cover the fence face, run by run, because a run starts and ends
  // on a post and a part paling is still a paling bought whole.
  const palingsPerRun = runMm.map(mm => Math.ceil(Math.max(0, mm) / palingCoverMm));
  const palings = palingsPerRun.reduce((t, n) => t + n, 0);

  // Rails and cap are linear metres, cut from stock lengths.
  const railLm = (fenceMm / 1000) * height.rails;
  const rails = railLengthMm > 0 ? Math.ceil(railLm / (railLengthMm / 1000)) : 0;
  const capLm = topCap ? fenceMm / 1000 : 0;
  const caps = topCap && capLengthMm > 0 ? Math.ceil(capLm / (capLengthMm / 1000)) : 0;

  return {
    runs: lengths,
    runCount,
    totalMetres: Math.round((totalMm / 1000) * 100) / 100,
    fenceMetres: Math.round((fenceMm / 1000) * 100) / 100,

    heightMm: height.mm,
    railsHigh: height.rails,

    bays,
    baysPerRun,
    // The widest bay on the fence, so it can be seen at a glance that nothing
    // is over the maximum.
    widestBayMm: Math.max(0, ...runMm.map((mm, i) => (baysPerRun[i] ? Math.round(mm / baysPerRun[i]) : 0))),

    posts,
    cornerPosts: corners,
    endPosts: 2,
    linePosts: Math.max(0, posts - corners - 2 - extraForOpenings),
    // The extra ones a gateway costs. There are two posts at each opening and
    // this is how many of them the fence did not already have.
    openingPosts: extraForOpenings,
    postLengthMm,
    concreteBags: posts * Math.max(0, bagsPerPost),

    rails,
    railLm: Math.round(railLm * 10) / 10,
    palings,
    palingsPerRun,
    palingCoverMm,

    topCap,
    caps,
    capLm: Math.round(capLm * 10) / 10,

    openings: Math.max(0, openings),
    openingRuns,
    openingWidthMm,

    // What is actually covered once whole palings are counted, so an installer
    // knows there is one to rip down rather than finding out on site.
    palingOvercutMm: Math.max(0, palings * palingCoverMm - fenceMm),
  };
}

/** What it comes to, against the products picked in Presenter Setup. */
export function priceUp({ plan, spec, products }) {
  if (!plan) return null;
  const s = readSpec(spec);
  const height = s.heights.find(h => h.mm === plan.heightMm) || {};
  const find = id => (id ? products.find(p => p.id === id) : null);

  const lines = [
    { key: 'post', label: `Posts ${plan.postLengthMm}mm or longer`, qty: plan.posts, product: find(height.postProductId) },
    { key: 'concrete', label: 'Concrete', qty: plan.concreteBags, product: find(s.components.concrete.productId) },
    { key: 'rail', label: `Rails (${plan.railsHigh} high)`, qty: plan.rails, product: find(s.components.rail.productId) },
    { key: 'paling', label: 'Palings', qty: plan.palings, product: find(height.palingProductId) },
  ];
  if (plan.topCap) {
    lines.push({ key: 'cap', label: 'Top cap', qty: plan.caps, product: find(s.components.cap.productId) });
  }

  const priced = lines.map(l => ({
    ...l,
    unitPrice: l.product?.unit_price || 0,
    total: (l.product?.unit_price || 0) * l.qty,
  }));

  const materials = priced.reduce((t, l) => t + l.total, 0);
  const labour = Math.round((s.labour.perMetre || 0) * 100) * plan.fenceMetres
    + Math.round((s.labour.perPost || 0) * 100) * plan.posts;

  return {
    lines: priced,
    // Which parts have nothing picked for them yet, so a total that is light
    // says why rather than just being wrong.
    missing: priced.filter(l => !l.product).map(l => l.label),
    materials,
    labour: Math.round(labour),
    exGst: Math.round(materials + labour),
    incGst: Math.round((materials + labour) * 1.15),
  };
}
