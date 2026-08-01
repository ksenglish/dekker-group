// Allowlist sanitizer for the quote description rich text field. The editor
// only ever emits a small, known set of tags (div/p/span/br/ul/ol/li plus
// b/strong/i/em/u, styled with a handful of CSS props) — this is a safety
// net against a modified/malicious client, not a general-purpose sanitizer.
const ALLOWED_TAGS = new Set(['div', 'p', 'span', 'br', 'ul', 'ol', 'li', 'b', 'strong', 'i', 'em', 'u']);
const ALLOWED_STYLE_PROPS = new Set(['font-weight', 'font-style', 'text-decoration', 'color', 'font-size', 'text-align']);

function sanitizeHtml(html) {
  if (!html) return '';
  // Strip dangerous elements entirely, including their content.
  html = html.replace(/<(script|style|iframe|object|embed)[^>]*>[\s\S]*?<\/\1>/gi, '');
  // Reduce every remaining tag to the allowlist, keeping only a
  // sanitized style attribute.
  html = html.replace(/<\/?([a-zA-Z0-9]+)([^>]*)>/g, (match, tag, attrs) => {
    tag = tag.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) return '';
    if (match.startsWith('</')) return `</${tag}>`;
    const styleMatch = attrs.match(/style\s*=\s*"([^"]*)"/i);
    if (!styleMatch) return `<${tag}>`;
    const props = styleMatch[1].split(';').map(s => s.trim()).filter(Boolean)
      .filter(p => ALLOWED_STYLE_PROPS.has(p.split(':')[0].trim().toLowerCase()));
    return props.length ? `<${tag} style="${props.join('; ')}">` : `<${tag}>`;
  });
  // Belt-and-suspenders in case a malformed tag slipped past the regex above.
  return html.replace(/\son\w+\s*=\s*"[^"]*"/gi, '').replace(/javascript:/gi, '');
}

// Flattens rich text to plain text, for the places a description leaves the
// app as something other than HTML — ArcSite project names, CSV cells, the
// subject line of an email.
function htmlToText(html) {
  if (!html) return '';
  return String(html)
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/(p|div|li|ul|ol)>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = { sanitizeHtml, htmlToText };
