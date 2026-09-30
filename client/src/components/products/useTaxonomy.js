import { useState, useEffect } from 'react';
import api from '../../lib/api';

// The category tree and supplier list every product form picks from.
//
// Shared so both forms load it the same way, and so the failure is visible:
// swallowing the error made a broken request look exactly like an empty price
// list, which is why an empty Category dropdown gave nobody anything to go on.
//
// `paths` is the distinct combinations. The flat per-level lists come back too,
// for a browser still running a cached bundle from before the tree existed.
export default function useTaxonomy() {
  const [picks, setPicks] = useState({});
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    api.get('/products/taxonomy')
      .then(r => { if (live) { setPicks(r.data || {}); setError(''); } })
      .catch(e => {
        if (!live) return;
        console.error('[products] could not load the category list:', e);
        setError(
          e.response?.status === 404
            ? 'Could not load the existing categories — the app looks out of date. Reload the page.'
            : 'Could not load the existing categories. You can still type them in.'
        );
      });
    return () => { live = false; };
  }, []);

  // An older bundle asking for flat lists, or a newer one asking for the tree,
  // both get what they need — and the tree is rebuilt from the flat lists if
  // it is the server that is behind.
  const paths = picks.paths
    || (Array.isArray(picks.category) ? picks.category.map(c => [c, null, null, null, null]) : []);

  return { picks, paths, error };
}
