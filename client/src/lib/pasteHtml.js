// Pasting formatted text in without losing the formatting.
//
// Paste used to take the plain text off the clipboard and drop everything
// else, so a scope of works copied out of a previous quote or a Word document
// arrived as one undifferentiated block — every bold heading gone, every
// bullet gone, and the whole lot picked up whatever formatting the cursor
// happened to be sitting in. The screenshot that prompted this had a scope of
// works entirely in bold because the caret was inside a bold run.
//
// But the clipboard cannot be trusted either. Word carries half a stylesheet
// with it, Google Docs wraps everything in ids and classes, and a web page
// brings whatever it likes — including things nobody should be putting in a
// quote. So the HTML is read with the browser's own parser, which does not run
// anything, and then rebuilt from scratch out of the handful of tags the app
// actually uses.
//
// Those are the same tags the server's sanitizer allows, deliberately. If this
// kept something the server strips, formatting would survive the paste and
// vanish on save, which is worse than never having it.

const ALLOWED = new Set(['div', 'p', 'span', 'br', 'ul', 'ol', 'li', 'b', 'strong', 'i', 'em', 'u']);
const ALLOWED_STYLE = new Set(['font-weight', 'font-style', 'text-decoration', 'color', 'font-size', 'text-align']);

// Gone, contents and all: there is nothing in them anybody pasted on purpose.
const DISCARD = new Set(['script', 'style', 'meta', 'link', 'head', 'title', 'noscript', 'svg', 'img', 'object', 'iframe', 'embed', 'form', 'input', 'button', 'select', 'textarea']);

// Flattened to a line of their own, so a pasted table or a list of headings
// does not come out as one long sentence.
const AS_BLOCK = new Set(['tr', 'table', 'tbody', 'thead', 'section', 'article', 'header', 'footer', 'blockquote', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

const NBSP = new RegExp(String.fromCharCode(160), 'g');

const escape = s => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * The style attribute, reduced to what the app understands.
 *
 * Font size is the one judgement call. Word pastes 11pt and Google Docs
 * pastes whatever the document was in, and a quote with a paragraph in
 * somebody else's point size in the middle of it looks like a mistake. So a
 * size is kept only when it is already in the pixels this editor writes —
 * which is to say when the text came from this app — and dropped otherwise.
 */
function cleanStyle(raw) {
  if (!raw) return '';
  const kept = [];
  for (const part of raw.split(';')) {
    const at = part.indexOf(':');
    if (at < 0) continue;
    const prop = part.slice(0, at).trim().toLowerCase();
    const value = part.slice(at + 1).trim();
    if (!ALLOWED_STYLE.has(prop) || !value) continue;
    // Word's stand-in for "whatever the default is", which is not a colour.
    if (/^(windowtext|inherit|initial|unset|currentcolor|auto)$/i.test(value)) continue;
    if (prop === 'font-size' && !/^\d+(\.\d+)?px$/i.test(value)) continue;
    kept.push(`${prop}: ${value}`);
  }
  return kept.join('; ');
}

// Word writes a bulleted list as ordinary paragraphs tagged with mso-list,
// with the bullet itself sitting in the text as a character. Left alone they
// paste as a block of lines each starting with a stray ·.
const isWordListItem = el =>
  /mso-list\s*:/i.test(el.getAttribute?.('style') || '')
  || /MsoListParagraph/i.test(el.getAttribute?.('class') || '');

// The glyph Word puts at the front of such a paragraph, and the tab after it.
const stripBullet = html => html
  .replace(/^(\s|&nbsp;|<br\s*\/?>)*[•··•o-]\s*(&nbsp;|\s)*/i, '')
  .trim();

function walk(node, out) {
  for (const child of node.childNodes) {
    // Text
    if (child.nodeType === 3) {
      // Word and Docs pad with non-breaking spaces; they are spaces here.
      const text = child.nodeValue.replace(NBSP, ' ');
      if (text) out.push(escape(text));
      continue;
    }
    if (child.nodeType !== 1) continue;        // comments and the rest

    const tag = child.tagName.toLowerCase();
    if (DISCARD.has(tag) || tag.includes(':')) continue;   // <o:p> and friends

    if (tag === 'br') { out.push('<br>'); continue; }

    if (HEADINGS.has(tag)) {
      const inner = [];
      walk(child, inner);
      if (inner.join('').trim()) out.push(`<div><strong>${inner.join('')}</strong></div>`);
      continue;
    }
    if (AS_BLOCK.has(tag)) {
      const inner = [];
      walk(child, inner);
      if (inner.join('').trim()) out.push(`<div>${inner.join('')}</div>`);
      continue;
    }
    // A table cell runs into the next one without something between them.
    if (tag === 'td' || tag === 'th') {
      const inner = [];
      walk(child, inner);
      if (inner.join('').trim()) out.push(`${inner.join('')} `);
      continue;
    }

    const inner = [];
    walk(child, inner);
    const body = inner.join('');

    if (!ALLOWED.has(tag)) { out.push(body); continue; }   // unwrapped, kept
    // An empty span or div carries nothing but noise.
    if (!body.trim() && tag !== 'li') continue;

    const style = cleanStyle(child.getAttribute('style'));
    // A span with nothing left to say is not worth keeping.
    if (tag === 'span' && !style) { out.push(body); continue; }
    out.push(style ? `<${tag} style="${style}">${body}</${tag}>` : `<${tag}>${body}</${tag}>`);
  }
}

/**
 * Word's bulleted paragraphs, gathered back into a real list.
 *
 * Done on the parsed document before anything else, because by the time it is
 * a string the only thing marking a bullet is a character that could have been
 * typed by anybody.
 */
function rebuildWordLists(body) {
  const doc = body.ownerDocument;
  // Wherever they are: Word wraps the lot in a WordSection div, so looking
  // only at the top level finds nothing and every bullet stays a stray · in
  // the middle of a paragraph.
  const parents = new Set();
  for (const el of body.querySelectorAll('p, div')) {
    if (isWordListItem(el) && el.parentNode) parents.add(el.parentNode);
  }

  for (const parent of parents) {
    const kids = [...parent.children];
    let i = 0;
    while (i < kids.length) {
      if (!isWordListItem(kids[i])) { i++; continue; }
      // Consecutive ones are one list; a plain paragraph between two of them
      // is a break between two lists, which is what it looks like in Word.
      let j = i;
      while (j < kids.length && isWordListItem(kids[j])) j++;
      const list = doc.createElement('ul');
      for (const p of kids.slice(i, j)) {
        // The bullet glyph lives in a span of its own that says to ignore it.
        for (const marker of [...p.querySelectorAll('[style*="mso-list"]')]) {
          if (/ignore/i.test(marker.getAttribute('style') || '')) marker.remove();
        }
        const li = doc.createElement('li');
        li.innerHTML = stripBullet(p.innerHTML);
        list.appendChild(li);
      }
      parent.insertBefore(list, kids[i]);
      for (const p of kids.slice(i, j)) p.remove();
      i = j;
    }
  }
}

/** Clipboard HTML, rebuilt as something this app can keep. */
export function cleanPastedHtml(html) {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  // Word brings its stylesheet along inside conditional comments.
  for (const el of [...doc.body.querySelectorAll('style, meta, link, script, title, xml')]) el.remove();
  rebuildWordLists(doc.body);
  const out = [];
  walk(doc.body, out);
  return out.join('')
    // Runs of empty paragraphs from a word processor's spacing.
    .replace(/(<div><\/div>|<p><\/p>){2,}/g, '<div><br></div>')
    .trim();
}

/**
 * Plain text, kept as the lines it was written in.
 *
 * Without this a pasted list arrives as one paragraph, because the line
 * breaks in a text clipboard mean nothing to a contenteditable. Lines that
 * start with a real bullet character become a real list — a hyphen is left
 * alone, since a line can quite reasonably start with one.
 */
export function plainTextToHtml(text) {
  if (!text) return '';
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let list = null;
  const closeList = () => { if (list) { out.push(`<ul>${list.join('')}</ul>`); list = null; } };

  for (const line of lines) {
    const bullet = /^\s*[•·•·]\s*(.*)$/.exec(line);
    if (bullet) {
      list = list || [];
      list.push(`<li>${escape(bullet[1])}</li>`);
      continue;
    }
    closeList();
    out.push(line.trim() ? `<div>${escape(line)}</div>` : '<div><br></div>');
  }
  closeList();
  return out.join('');
}
