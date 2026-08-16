// Turning a flat price list into the Category > Sub Category 1 > Sub Category 2
// tree the browser walks. Kept apart from the component so it can be exercised
// on its own — the drill-down is where the fiddly cases live, not the markup.

export const UNCATEGORISED = 'Uncategorised';

const label = v => (v || '').trim() || UNCATEGORISED;

// Groups rows by a field, alphabetical, with the blank group last.
export function groupBy(rows, field) {
  const map = new Map();
  for (const r of rows) {
    const key = label(r[field]);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] === UNCATEGORISED ? 1 : b[0] === UNCATEGORISED ? -1 : a[0].localeCompare(b[0])))
    .map(([name, items]) => ({ name, items }));
}

// What belongs on screen at a given depth: folders while there's another level
// with names in it, products once there isn't.
//
// `path` is [category, subcategory_1, subcategory_2] as far as the user has
// drilled. Returns folders or items, never both — a level is one or the other.
export function browseView(products, path) {
  if (!products) return { folders: [], items: [] };

  let rows = products;
  if (path.length >= 1) rows = rows.filter(p => label(p.category) === path[0]);
  if (path.length >= 2) rows = rows.filter(p => label(p.subcategory_1) === path[1]);
  if (path.length >= 3) rows = rows.filter(p => label(p.subcategory_2) === path[2]);

  const field = ['category', 'subcategory_1', 'subcategory_2'][path.length];
  if (!field) return { folders: [], items: rows };

  const groups = groupBy(rows, field);
  // Nothing worth drilling into when the only group is the blank one — show
  // the products rather than a folder called "Uncategorised" holding them all.
  if (groups.length === 1 && groups[0].name === UNCATEGORISED) return { folders: [], items: rows };
  return { folders: groups, items: [] };
}
