import PickOrAdd from './PickOrAdd';
import styles from '../../pages/products/Products.module.css';

// Category and its four sub-categories, as one block so every form that edits a
// product offers them the same way.
//
// Each level only offers what actually sits under the level above it. Pick
// Dekker Landscaping and Sub Category 1 stops offering Ventilation, because
// nothing under Dekker Landscaping has ever been called that. A new value is
// still typed on purpose, via the Add button.
//
// Changing a level clears the ones beneath it. Leaving them would keep a
// combination that has never existed — "Dekker Landscaping / Ventilation" —
// which is the thing this is here to prevent.

export const CATEGORY_FIELDS = ['category', 'subcategory_1', 'subcategory_2', 'subcategory_3', 'subcategory_4'];

const LABELS = ['Category', 'Sub Category 1', 'Sub Category 2', 'Sub Category 3', 'Sub Category 4'];
const PLACEHOLDERS = ['e.g. Dekker Air', 'e.g. Ventilation', 'e.g. Extraction', 'e.g. Inline Fans', 'e.g. 150mm'];

// What level `depth` can be, given what has been chosen above it. Before
// anything is chosen every value is offered, so the field still works if
// someone fills it in from the bottom up.
export function optionsAt(paths, chosen, depth) {
  const matching = (paths || []).filter(p =>
    chosen.slice(0, depth).every((v, i) => !v || p[i] === v)
  );
  return [...new Set(matching.map(p => p[depth]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export default function CategoryFields({ values, paths, onChange }) {
  const chosen = CATEGORY_FIELDS.map(f => values[f] || '');

  function pick(depth, v) {
    // The level itself, and everything under it reset — see the note above.
    const next = {};
    next[CATEGORY_FIELDS[depth]] = v;
    for (let i = depth + 1; i < CATEGORY_FIELDS.length; i++) next[CATEGORY_FIELDS[i]] = '';
    onChange(next);
  }

  return CATEGORY_FIELDS.map((field, depth) => (
    <div key={field} className={styles.formGroup}>
      <label>{LABELS[depth]}</label>
      <PickOrAdd
        value={values[field] || ''}
        options={optionsAt(paths, chosen, depth)}
        onChange={v => pick(depth, v)}
        addLabel={depth === 0 ? '+ Add Category' : '+ Add'}
        placeholder={PLACEHOLDERS[depth]}
      />
    </div>
  ));
}
