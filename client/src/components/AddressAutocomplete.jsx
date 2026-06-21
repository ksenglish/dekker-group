import { useState, useEffect, useRef } from 'react';
import styles from './AddressAutocomplete.module.css';

// Nominatim (OpenStreetMap) — free, no API key, NZ-restricted
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

export default function AddressAutocomplete({ value, onChange, onSelect, placeholder = 'Start typing an address…' }) {
  const [query, setQuery] = useState(value || '');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef(null);
  const containerRef = useRef(null);

  // Keep query in sync if parent changes value
  useEffect(() => { setQuery(value || ''); }, [value]);

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  function handleChange(e) {
    const q = e.target.value;
    setQuery(q);
    onChange(q); // keep parent field value in sync as user types

    clearTimeout(debounceRef.current);
    if (q.length < 3) { setResults([]); setOpen(false); return; }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          q, countrycodes: 'nz', format: 'json',
          addressdetails: '1', limit: '6',
        });
        const res = await fetch(`${NOMINATIM}?${params}`, {
          headers: { 'Accept-Language': 'en', 'User-Agent': 'DekkerApp/1.0' },
        });
        const data = await res.json();
        setResults(data);
        setOpen(data.length > 0);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 400);
  }

  function handlePick(result) {
    const a = result.address || {};

    // Build street: house number + road
    const street = [a.house_number, a.road].filter(Boolean).join(' ');

    // City: prefer suburb, town, city, village in that order
    const city = a.suburb || a.quarter || a.city_district || a.town || a.city || a.village || '';

    // Region: strip " Region" suffix that NZ uses
    const region = (a.state || '').replace(/ Region$/, '').replace(/ District$/, '');

    const postcode = a.postcode || '';
    const country  = a.country || 'New Zealand';

    // Display label for the street field
    const displayStreet = street || result.display_name.split(',')[0];

    setQuery(displayStreet);
    setOpen(false);
    setResults([]);

    onSelect({ street: displayStreet, city, region, postcode, country });
  }

  return (
    <div className={styles.wrap} ref={containerRef}>
      <div className={styles.inputWrap}>
        <input
          type="text"
          className={styles.input}
          value={query}
          onChange={handleChange}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder={placeholder}
          autoComplete="off"
        />
        {loading && <span className={styles.spinner}>⟳</span>}
      </div>
      {open && results.length > 0 && (
        <ul className={styles.dropdown}>
          {results.map(r => (
            <li key={r.place_id} className={styles.option} onMouseDown={() => handlePick(r)}>
              <span className={styles.optionMain}>{r.display_name.split(',').slice(0, 2).join(',')}</span>
              <span className={styles.optionSub}>{r.display_name.split(',').slice(2).join(',').trim()}</span>
            </li>
          ))}
          <li className={styles.attribution}>© OpenStreetMap contributors</li>
        </ul>
      )}
    </div>
  );
}
