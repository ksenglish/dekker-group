// Helpers for description fields that hold rich text (HTML) from RichTextEditor.
//
// Two complications this deals with:
//  1. Records created before the editor existed hold plain text, which must not
//     be fed through an HTML renderer or line breaks silently collapse.
//  2. Those older rows were never run through the server's sanitizer, so their
//     contents are untrusted. Anything rendered as HTML gets re-sanitized here
//     rather than assuming the column is clean.

const ALLOWED_TAGS = new Set(['DIV', 'P', 'SPAN', 'BR', 'UL', 'OL', 'LI', 'B', 'STRONG', 'I', 'EM', 'U']);
const ALLOWED_STYLE_PROPS = new Set([
  'font-weight', 'font-style', 'text-decoration', 'color', 'font-size', 'text-align',
]);

const LOOKS_LIKE_HTML = /<\/?[a-z][^>]*>/i;

// Does this value carry markup, or is it a plain-text description from before
// the rich text editor was introduced?
export function isHtml(value) {
  return LOOKS_LIKE_HTML.test(value || '');
}

// Flattens rich text to a single line. Use anywhere markup would show up as
// literal tags — list rows, tooltips, map pins, search results.
export function htmlToText(value) {
  if (!value) return '';
  if (!isHtml(value)) return value;
  // Block boundaries must become whitespace *before* the text is pulled out —
  // textContent alone welds "…edge</div><div>and…" into "edgeand".
  const spaced = String(value)
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/(p|div|li|ul|ol|h[1-6]|tr|td)>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ');
  const doc = new DOMParser().parseFromString(spaced, 'text/html');
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
}

// Allowlist sanitizer mirroring the server's. Strips every element and
// attribute the editor never emits, keeping only a filtered style attribute.
export function safeHtml(value) {
  if (!value) return '';
  const doc = new DOMParser().parseFromString(value, 'text/html');

  for (const el of [...doc.body.querySelectorAll('*')]) {
    if (!ALLOWED_TAGS.has(el.tagName)) {
      // Keep the text, drop the element — matches how the server unwraps
      // unknown tags rather than deleting their contents.
      el.replaceWith(...el.childNodes);
      continue;
    }
    const style = el.getAttribute('style') || '';
    for (const attr of [...el.attributes]) el.removeAttribute(attr.name);
    const kept = style.split(';')
      .map(s => s.trim())
      .filter(Boolean)
      .filter(p => ALLOWED_STYLE_PROPS.has(p.split(':')[0].trim().toLowerCase()));
    if (kept.length) el.setAttribute('style', kept.join('; '));
  }
  return doc.body.innerHTML;
}
