const PDFDocument = require('pdfkit');
const { PDFDocument: PdfLib } = require('pdf-lib');

const LIGHT_GREY = '#f1f5f9';
const MID_GREY = '#94a3b8';
const TEXT = '#0f172a';

const DEFAULT_THEME = {
  companyName: 'DEKKER GROUP',
  contactDetails: 'dekkergroup.co.nz\nkyle@dekkergroup.co.nz\nNew Zealand',
  gstNumber: '',
  brandColour: '#1e40af',
  footerLine1: 'Thank you for your business.',
  footerLine2: 'Dekker Group · New Zealand · GST registered',
  logoBase64: '',
  logoSize: 'medium',
  logoPosition: 'left',
  contactPosition: 'right',
};

function formatNZD(cents) {
  return '$' + (cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' });
}

// pdfkit's standard fonts (Helvetica etc.) use WinAnsiEncoding, which has no
// glyphs for macron vowels common in NZ place names (e.g. "Ngongotahā") —
// left as-is they corrupt not just that character but everything after it on
// the same line. Fold to plain ASCII rather than risk garbled text.
const COMBINING_MARKS_RE = new RegExp('[\\u0300-\\u036f]', 'g');
function stripDiacritics(value) {
  if (value == null) return value;
  return String(value).normalize('NFD').replace(COMBINING_MARKS_RE, '');
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };
function decodeEntities(str) {
  return str.replace(/&(#39|amp|lt|gt|quot|apos|nbsp);/g, (m, e) => ENTITIES[e] || m);
}

// Bespoke parser for the quote description field — NOT a general HTML
// parser. It only needs to understand the small, known tag vocabulary the
// RichTextEditor emits (div/p/br, ul/ol/li, b/strong/i/em/u, and span with a
// handful of style props), already narrowed by sanitizeHtml.js server-side.
// Produces paragraphs of styled text runs for renderDescriptionHtml to lay
// out with pdfkit.
function parseDescriptionHtml(html) {
  if (!html) return [];
  const tokens = html.match(/<[^>]+>|[^<]+/g) || [];
  const paragraphs = [];
  let curParagraph = null;
  const styleStack = [{ bold: false, italic: false, underline: false, color: null, fontSize: null }];
  const listStack = []; // { type: 'ul' | 'ol', n: number }
  const currentStyle = () => styleStack[styleStack.length - 1];

  function bulletFor() {
    if (!listStack.length) return null;
    const list = listStack[listStack.length - 1];
    if (list.type !== 'ol') return '•';
    list.n += 1;
    return `${list.n}.`;
  }
  function startParagraph(align) {
    curParagraph = { align: align || 'left', bullet: bulletFor(), runs: [] };
    paragraphs.push(curParagraph);
  }
  function pushText(text) {
    const decoded = decodeEntities(text).replace(/\s+/g, ' ');
    if (!decoded.trim() && !decoded) return;
    if (!curParagraph) startParagraph();
    curParagraph.runs.push({ text: decoded, ...currentStyle() });
  }
  function parseStyleAttr(tag) {
    const st = {};
    const m = tag.match(/style\s*=\s*"([^"]*)"/i);
    if (!m) return st;
    m[1].split(';').forEach(rule => {
      const idx = rule.indexOf(':');
      if (idx < 0) return;
      const k = rule.slice(0, idx).trim().toLowerCase();
      const v = rule.slice(idx + 1).trim().toLowerCase();
      if (!k || !v) return;
      if (k === 'font-weight' && (v === 'bold' || /^[7-9]00$/.test(v))) st.bold = true;
      if (k === 'font-style' && v === 'italic') st.italic = true;
      if (k === 'text-decoration' && v.includes('underline')) st.underline = true;
      if (k === 'color') st.color = v;
      if (k === 'font-size') { const n = parseFloat(v); if (!Number.isNaN(n)) st.fontSize = n; }
      if (k === 'text-align' && ['left', 'center', 'right'].includes(v)) st.align = v;
    });
    return st;
  }

  for (const tok of tokens) {
    if (tok[0] !== '<') { pushText(tok); continue; }
    const closing = tok[1] === '/';
    const tagMatch = tok.match(/^<\/?([a-zA-Z0-9]+)/);
    const tag = tagMatch ? tagMatch[1].toLowerCase() : '';
    if (!closing) {
      if (tag === 'br') { curParagraph = null; continue; }
      if (tag === 'div' || tag === 'p') { const st = parseStyleAttr(tok); startParagraph(st.align); continue; }
      if (tag === 'ul' || tag === 'ol') { listStack.push({ type: tag, n: 0 }); continue; }
      if (tag === 'li') { startParagraph(); continue; }
      const st = { ...currentStyle() };
      if (tag === 'b' || tag === 'strong') st.bold = true;
      if (tag === 'i' || tag === 'em') st.italic = true;
      if (tag === 'u') st.underline = true;
      if (tag === 'span') Object.assign(st, parseStyleAttr(tok));
      styleStack.push(st);
    } else {
      if (['b', 'strong', 'i', 'em', 'u', 'span'].includes(tag) && styleStack.length > 1) styleStack.pop();
      if (tag === 'ul' || tag === 'ol') listStack.pop();
    }
  }
  return paragraphs;
}

// Lays out parsed paragraphs with pdfkit, using its `continued` text-run
// feature for inline mixed formatting (bold/italic/underline/colour/size)
// within a wrapped paragraph. Centre/right alignment is approximated by
// measuring the whole line and shifting the start x — fine for the short,
// heading-like lines quote descriptions actually use that way; longer
// wrapped lines fall back to left alignment rather than risk broken layout.
function renderDescriptionHtml(doc, html, x, y, width, ensureSpace) {
  const BASE_SIZE = 9;
  const fontFor = (bold, italic) => {
    if (bold && italic) return 'Helvetica-BoldOblique';
    if (bold) return 'Helvetica-Bold';
    if (italic) return 'Helvetica-Oblique';
    return 'Helvetica';
  };
  const paragraphs = parseDescriptionHtml(html);

  for (const para of paragraphs) {
    if (!para.runs.length && !para.bullet) { y = ensureSpace(y, BASE_SIZE + 4) + BASE_SIZE + 4; continue; }
    const indent = para.bullet ? 14 : 0;
    const runs = para.runs.length ? para.runs : [{ text: '', bold: false, italic: false, underline: false, color: null, fontSize: null }];
    const plainText = (para.bullet ? para.bullet + ' ' : '') + runs.map(r => r.text).join('');
    const maxSize = Math.max(BASE_SIZE, ...runs.map(r => (r.fontSize ? r.fontSize * 0.75 : BASE_SIZE)));
    doc.fontSize(maxSize).font('Helvetica');
    const estHeight = doc.heightOfString(plainText, { width: width - indent }) + 4;
    y = ensureSpace(y, estHeight);

    // Measure total width to see if this line fits on one row (needed to
    // approximate centre/right alignment).
    let totalW = 0;
    if (para.bullet) { doc.fontSize(BASE_SIZE).font('Helvetica'); totalW += doc.widthOfString(para.bullet + ' '); }
    runs.forEach(run => {
      doc.fontSize(run.fontSize ? run.fontSize * 0.75 : BASE_SIZE).font(fontFor(run.bold, run.italic));
      totalW += doc.widthOfString(run.text);
    });
    let startX = x + indent;
    const fits = totalW < width - indent;
    if (fits && para.align === 'center') startX = x + indent + (width - indent - totalW) / 2;
    else if (fits && para.align === 'right') startX = x + width - totalW;

    if (para.bullet) {
      doc.fontSize(BASE_SIZE).font('Helvetica').fillColor(TEXT)
        .text(para.bullet + ' ', startX, y, { continued: true, width: width - indent, lineBreak: !fits });
    }
    runs.forEach((run, i) => {
      const size = run.fontSize ? run.fontSize * 0.75 : BASE_SIZE;
      const isFirst = i === 0 && !para.bullet;
      const opts = {
        continued: i < runs.length - 1,
        underline: !!run.underline,
        width: width - indent,
        lineBreak: !fits,
      };
      doc.fontSize(size).font(fontFor(run.bold, run.italic)).fillColor(run.color || TEXT);
      if (isFirst) doc.text(run.text, startX, y, opts);
      else doc.text(run.text, opts);
    });
    y = doc.y + 4;
  }
  return y;
}

const LOGO_SIZES = { small: 36, medium: 58, large: 78 };

const STATUS_COLOURS = {
  draft: '#6b7280', approved: '#7c3aed', sent: '#0891b2', accepted: '#16a34a', declined: '#dc2626',
  cancelled: '#6b7280', paid: '#16a34a', overdue: '#dc2626',
};

async function buildPDF({ type, number, customer, jobNumber, jobAddress, items, subtotal, gst, total, status, dueDate, expiresAt, notes, terms, paymentTerms, issuedAt, theme = {}, appendixImages = [], partyLabel = 'BILL TO' }) {
  const t = { ...DEFAULT_THEME, ...theme };
  t.companyName = stripDiacritics(t.companyName);
  t.contactDetails = stripDiacritics(t.contactDetails);
  t.gstNumber = stripDiacritics(t.gstNumber);
  const BRAND = t.brandColour || '#1e40af';
  const logoH = LOGO_SIZES[t.logoSize] || 58;
  const logoOnLeft  = (t.logoPosition  || 'left')  === 'left';
  const contactOnLeft = (t.contactPosition || 'right') === 'left';
  const isQuote = type === 'Quote';

  // Sanitize every free-text field once, up front, rather than at each call
  // site — covers customer/job data (often sourced from geocoded addresses)
  // and quote notes/terms/line-item descriptions.
  notes = stripDiacritics(notes);
  terms = stripDiacritics(terms);
  paymentTerms = stripDiacritics(paymentTerms);
  jobNumber = stripDiacritics(jobNumber);
  jobAddress = stripDiacritics(jobAddress);
  customer = {
    ...customer,
    name: stripDiacritics(customer?.name),
    company: stripDiacritics(customer?.company),
    email: stripDiacritics(customer?.email),
    phone: stripDiacritics(customer?.phone),
    address: stripDiacritics(customer?.address),
    gstNumber: stripDiacritics(customer?.gstNumber),
  };
  items = (items || []).map(i => ({ ...i, description: stripDiacritics(i.description) }));

  // Determine if any item has a product image
  const hasImages = items.some(i => i.media_base64);
  const IMG_COL = 36; // thumbnail width
  const IMG_PAD = hasImages ? IMG_COL + 8 : 0;

  const mainBuf = await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const MARGIN = 50;
    const W = doc.page.width - 100;
    const PAGE_H = doc.page.height;

    // Guarantees `needed` points of room below `y`, adding a fresh page if not —
    // used throughout the quote layout instead of pdfkit's own implicit
    // auto-pagination, which was the source of the stray blank pages before
    // (a fixed-to-page-bottom footer drawn after content had already silently
    // overflowed onto a next page it didn't know about).
    function ensureSpace(y, needed) {
      if (y + needed > PAGE_H - MARGIN) {
        doc.addPage();
        return MARGIN;
      }
      return y;
    }

    // ── Header bar ──────────────────────────────────────────────
    const headerSubColour = t.transparentHeader ? MID_GREY : 'rgba(255,255,255,0.85)';

    if (!t.transparentHeader) {
      doc.rect(50, 50, W, 70).fill(BRAND);
    } else {
      doc.rect(50, 50, W, 70).fill('#ffffff');
      doc.moveTo(50, 120).lineTo(50 + W, 120).strokeColor('#e2e8f0').lineWidth(1).stroke();
    }

    // Logo / company name block
    const logoFit  = [Math.round(logoH * 2.8), logoH]; // max width proportional to height
    const logoTopY = 50 + Math.round((70 - logoH) / 2);
    const logoX    = logoOnLeft ? 60 : 50 + W - logoFit[0] - 10;
    const textX    = logoOnLeft ? 66 : 50 + W - 220;
    // Leave room for the contact block when they're on opposite sides — a
    // long trading name (e.g. "Dekker Group Limited T/A Dekker Air") would
    // otherwise run straight under it.
    const nameMaxWidth = logoOnLeft !== contactOnLeft ? W * 0.55 : W - 20;

    function drawCompanyName() {
      let size = 22;
      doc.font('Helvetica-Bold');
      while (size > 11 && doc.fontSize(size).widthOfString(t.companyName) > nameMaxWidth) size -= 1;
      doc.fillColor(t.transparentHeader ? BRAND : 'white').fontSize(size).font('Helvetica-Bold')
        .text(t.companyName, textX, 78, { width: nameMaxWidth, lineBreak: false, ellipsis: true });
    }

    if (t.logoBase64) {
      try {
        const buf = Buffer.from(t.logoBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
        doc.image(buf, logoX, logoTopY, { height: logoH, fit: logoFit });
      } catch {
        drawCompanyName();
      }
    } else {
      drawCompanyName();
    }

    // Contact details block — one free-text field, printed as-is line by
    // line, so the trading entity can order/format it however they want.
    const contactLines = (t.contactDetails || '').split('\n').map(l => l.trim()).filter(Boolean);
    doc.fillColor(headerSubColour).fontSize(8).font('Helvetica');
    if (contactOnLeft) {
      contactLines.forEach((line, i) => doc.text(line, 60, 63 + i * 13, { width: W / 2 }));
    } else {
      contactLines.forEach((line, i) => {
        doc.text(line, 50, 63 + i * 13, { width: W - 16, align: 'right' });
      });
    }

    doc.fillColor(TEXT);

    // ── Document type + number ───────────────────────────────────
    const docY = 140;
    doc.fontSize(26).font('Helvetica-Bold').fillColor(BRAND).text(type.toUpperCase(), 50, docY);

    const numText = `#${number}`;
    doc.fontSize(11).font('Helvetica-Bold').fillColor(TEXT).text(numText, 50, docY + 34);

    // Status badge — internal-status noise a customer doesn't need to see,
    // so it's only shown on invoices, not customer-facing quotes.
    if (!isQuote) {
      const statusColour = STATUS_COLOURS[status] || '#6b7280';
      const badgeX = 50 + doc.widthOfString(numText) + 10;
      doc.roundedRect(badgeX, docY + 30, 62, 18, 4).fill(statusColour);
      doc.fontSize(9).font('Helvetica-Bold').fillColor('white')
        .text(status.toUpperCase(), badgeX + 4, docY + 34, { width: 54, align: 'center' });
    }

    if (isQuote) {
      // ══════════════════════════════════════════════════════════
      // Quote layout — Tradify-style 3-column detail block, notes
      // above the line items, drawing + terms near the end.
      // ══════════════════════════════════════════════════════════

      // ── Bill To / Job Details / Quote Details (3 columns) ────────
      const colGap = 20;
      const colW = (W - colGap * 2) / 3;
      const col1X = 50, col2X = 50 + colW + colGap, col3X = 50 + (colW + colGap) * 2;
      let y = docY + 70;

      // Column 1: customer
      let c1y = y;
      doc.fillColor(TEXT).fontSize(11).font('Helvetica-Bold').text(customer.name || '', col1X, c1y, { width: colW });
      c1y += doc.heightOfString(customer.name || '', { width: colW }) + 4;
      doc.fontSize(9).font('Helvetica').fillColor(TEXT);
      [customer.company, customer.address, customer.email, customer.phone].filter(Boolean).forEach(line => {
        doc.text(line, col1X, c1y, { width: colW });
        c1y += doc.heightOfString(line, { width: colW }) + 2;
      });

      // Column 2: job
      let c2y = y;
      [['Job Number', jobNumber], ['Job Address', jobAddress]].forEach(([label, value]) => {
        if (!value) return;
        doc.fontSize(8).font('Helvetica-Bold').fillColor(TEXT).text(label, col2X, c2y, { width: colW });
        c2y += 12;
        doc.fontSize(9).font('Helvetica').fillColor(TEXT).text(value, col2X, c2y, { width: colW });
        c2y += doc.heightOfString(value, { width: colW }) + 8;
      });

      // Column 3: quote dates + GST number
      let c3y = y;
      doc.fontSize(8).font('Helvetica-Bold').fillColor(TEXT).text('Issue Date', col3X, c3y, { width: colW });
      c3y += 12;
      doc.fontSize(9).font('Helvetica-Bold').fillColor(TEXT).text(formatDate(issuedAt || new Date()), col3X, c3y, { width: colW });
      c3y += 16;
      if (expiresAt) {
        doc.fontSize(8).font('Helvetica-Bold').fillColor(TEXT).text('Expiry Date', col3X, c3y, { width: colW });
        c3y += 12;
        doc.fontSize(9).font('Helvetica-Bold').fillColor(TEXT).text(formatDate(expiresAt), col3X, c3y, { width: colW });
        c3y += 16;
      }
      if (t.gstNumber) {
        doc.fontSize(8).font('Helvetica-Bold').fillColor(TEXT).text('GST Number', col3X, c3y, { width: colW });
        c3y += 12;
        doc.fontSize(9).font('Helvetica').fillColor(TEXT).text(t.gstNumber, col3X, c3y, { width: colW });
      }

      y = Math.max(c1y, c2y, c3y) + 16;

      // ── Description — above the line items ──────────────────────────
      if (notes) {
        y = renderDescriptionHtml(doc, notes, 50, y, W, ensureSpace);
        y += 10;
      }

      // ── Line items table ─────────────────────────────────────────
      y = ensureSpace(y, 22);
      const colDesc  = 50 + IMG_PAD;
      const colQty   = 340;
      const colUnit  = 390;
      const colTotal = 460;
      const descWidth = colQty - colDesc - 10;
      const ROW_H = hasImages ? 42 : 20;

      doc.rect(50, y, W, 22).fill(BRAND);
      doc.fillColor('white').fontSize(9).font('Helvetica-Bold');
      doc.text('DESCRIPTION', colDesc, y + 7);
      doc.text('QTY',         colQty,  y + 7, { width: 45, align: 'right' });
      doc.text('UNIT PRICE',  colUnit, y + 7, { width: 65, align: 'right' });
      doc.text('TOTAL',       colTotal, y + 7, { width: 65, align: 'right' });
      y += 22;

      doc.fillColor(TEXT).font('Helvetica');
      (items || []).forEach((item, i) => {
        y = ensureSpace(y, ROW_H);
        const lineTotal = item.unit_price * item.quantity;
        if (i % 2 === 1) doc.rect(50, y, W, ROW_H).fill(LIGHT_GREY);

        if (hasImages && item.media_base64) {
          try {
            const buf = Buffer.from(item.media_base64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
            doc.image(buf, 52, y + 3, { width: IMG_COL, height: IMG_COL, fit: [IMG_COL, IMG_COL] });
          } catch { /* skip bad image */ }
        }

        const textY = hasImages ? y + 8 : y + 6;
        doc.fillColor(TEXT).fontSize(9)
          .text(item.description || '', colDesc, textY, { width: descWidth })
          .text(String(item.quantity), colQty,   textY, { width: 45, align: 'right' })
          .text(formatNZD(item.unit_price), colUnit, textY, { width: 65, align: 'right' })
          .text(formatNZD(lineTotal), colTotal,  textY, { width: 65, align: 'right' });
        y += ROW_H;
      });

      y = ensureSpace(y, 10);
      doc.moveTo(50, y + 8).lineTo(50 + W, y + 8).strokeColor(LIGHT_GREY).lineWidth(1).stroke();
      y += 20;

      // ── Totals ───────────────────────────────────────────────────
      y = ensureSpace(y, 60);
      const totX = 380;
      doc.fontSize(9).font('Helvetica-Bold').fillColor(TEXT);
      doc.text('Subtotal',   totX, y);
      doc.text('GST (15%)',  totX, y + 18);
      doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(11);
      doc.text('Total (NZD)', totX, y + 40);

      doc.font('Helvetica').fontSize(9).fillColor(TEXT);
      doc.text(formatNZD(subtotal), totX, y,      { width: W - totX + 50, align: 'right' });
      doc.text(formatNZD(gst),      totX, y + 18, { width: W - totX + 50, align: 'right' });
      doc.font('Helvetica-Bold').fontSize(11).fillColor(BRAND);
      doc.text(formatNZD(total),    totX, y + 40, { width: W - totX + 50, align: 'right' });
      y += 70;

      // ── Payment Terms — same spot Terms & Conditions used to occupy,
      // before the drawing. Terms & Conditions itself now lives at the very
      // end of the document, after the brochures (see below). ───────────
      if (paymentTerms) {
        const ptH = doc.fontSize(9).font('Helvetica').heightOfString(paymentTerms, { width: W });
        y = ensureSpace(y, 14 + ptH + 10);
        doc.fontSize(8).font('Helvetica-Bold').fillColor(TEXT).text('PAYMENT TERMS', 50, y);
        doc.fontSize(9).font('Helvetica').fillColor(TEXT).text(paymentTerms, 50, y + 14, { width: W });
        y += 14 + ptH + 20;
      }

      // ── Drawing(s) — each on its own full page, titled "Proposal" ──
      // No footer follows: a full-page drawing leaves no room for one, and
      // forcing a fresh page just to print a footer line left a near-blank
      // page between the Proposal and the brochures. The quote ends here;
      // Terms & Conditions still gets its own page, appended after
      // brochures below.
      for (const dataUrl of appendixImages || []) {
        try {
          const raw = dataUrl.replace(/^data:image\/\w+;base64,/, '');
          const buf = Buffer.from(raw, 'base64');
          doc.addPage();
          doc.fontSize(18).font('Helvetica-Bold').fillColor(BRAND).text('Proposal', MARGIN, MARGIN);
          const imgTop = MARGIN + 18 + 16;
          doc.image(buf, MARGIN, imgTop, { fit: [W, PAGE_H - imgTop - MARGIN], align: 'center', valign: 'center' });
        } catch { /* skip bad drawing */ }
      }
    } else {
      // ══════════════════════════════════════════════════════════
      // Invoice layout — unchanged from before.
      // ══════════════════════════════════════════════════════════

      // ── Dates block (right) ──────────────────────────────────────
      doc.fillColor(TEXT).fontSize(9).font('Helvetica');
      const dateX = 380;
      let dateRowY = docY;
      doc.text('Issue Date:', dateX, dateRowY);
      doc.font('Helvetica-Bold').text(formatDate(issuedAt || new Date()), dateX + 70, dateRowY);
      dateRowY += 16;
      if (dueDate) {
        doc.font('Helvetica').text('Due Date:', dateX, dateRowY);
        doc.font('Helvetica-Bold').text(formatDate(dueDate), dateX + 70, dateRowY);
        dateRowY += 16;
      }

      // ── Party block (Bill To, or the supplier on a buyer created invoice) ──
      const billY = docY + 70;
      doc.fontSize(8).font('Helvetica-Bold').fillColor(MID_GREY).text(partyLabel, 50, billY);
      doc.fillColor(TEXT).fontSize(11).font('Helvetica-Bold').text(customer.name || '', 50, billY + 14);
      doc.fontSize(9).font('Helvetica');
      let cy = billY + 30;
      if (customer.company) { doc.text(customer.company, 50, cy); cy += 14; }
      // Multi-line addresses are common — advance past however many lines it takes
      if (customer.address) {
        const addrW = 240;
        doc.text(customer.address, 50, cy, { width: addrW });
        cy += doc.heightOfString(customer.address, { width: addrW }) + 2;
      }
      if (customer.email)   { doc.text(customer.email, 50, cy); cy += 14; }
      if (customer.phone)   { doc.text(customer.phone, 50, cy); cy += 14; }
      if (customer.gstNumber) { doc.text(`GST No: ${customer.gstNumber}`, 50, cy); cy += 14; }

      // ── Line items table ─────────────────────────────────────────
      // Keep the original 90pt gap for short party blocks, but push down if
      // an address/GST number made it taller, so the two never collide.
      const tableY = Math.max(billY + 90, cy + 12);
      const colDesc  = 50 + IMG_PAD;
      const colQty   = 340;
      const colUnit  = 390;
      const colTotal = 460;
      const descWidth = colQty - colDesc - 10;
      const ROW_H = hasImages ? 42 : 20;

      doc.rect(50, tableY, W, 22).fill(BRAND);
      doc.fillColor('white').fontSize(9).font('Helvetica-Bold');
      doc.text('DESCRIPTION', colDesc,  tableY + 7);
      doc.text('QTY',         colQty,   tableY + 7, { width: 45, align: 'right' });
      doc.text('UNIT PRICE',  colUnit,  tableY + 7, { width: 65, align: 'right' });
      doc.text('TOTAL',       colTotal, tableY + 7, { width: 65, align: 'right' });

      doc.fillColor(TEXT).font('Helvetica');
      let rowY = tableY + 22;

      (items || []).forEach((item, i) => {
        const lineTotal = item.unit_price * item.quantity;
        if (i % 2 === 1) doc.rect(50, rowY, W, ROW_H).fill(LIGHT_GREY);

        // Product thumbnail
        if (hasImages) {
          if (item.media_base64) {
            try {
              const buf = Buffer.from(item.media_base64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
              doc.image(buf, 52, rowY + 3, { width: IMG_COL, height: IMG_COL, fit: [IMG_COL, IMG_COL] });
            } catch { /* skip bad image */ }
          }
        }

        const textY = hasImages ? rowY + 8 : rowY + 6;
        doc.fillColor(TEXT).fontSize(9)
          .text(item.description || '', colDesc, textY, { width: descWidth })
          .text(String(item.quantity), colQty,   textY, { width: 45, align: 'right' })
          .text(formatNZD(item.unit_price), colUnit, textY, { width: 65, align: 'right' })
          .text(formatNZD(lineTotal), colTotal,  textY, { width: 65, align: 'right' });
        rowY += ROW_H;
      });

      doc.moveTo(50, rowY + 8).lineTo(50 + W, rowY + 8).strokeColor(LIGHT_GREY).lineWidth(1).stroke();
      rowY += 20;

      // ── Totals ───────────────────────────────────────────────────
      const totX = 380;
      doc.fontSize(9).font('Helvetica').fillColor(MID_GREY);
      doc.text('Subtotal',   totX, rowY);
      doc.text('GST (15%)',  totX, rowY + 18);
      doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(11);
      doc.text('Total (NZD)', totX, rowY + 40);

      doc.font('Helvetica').fontSize(9).fillColor(TEXT);
      doc.text(formatNZD(subtotal), totX, rowY,      { width: W - totX + 50, align: 'right' });
      doc.text(formatNZD(gst),      totX, rowY + 18, { width: W - totX + 50, align: 'right' });
      doc.font('Helvetica-Bold').fontSize(11).fillColor(BRAND);
      doc.text(formatNZD(total),    totX, rowY + 40, { width: W - totX + 50, align: 'right' });

      // ── Notes ────────────────────────────────────────────────────
      let afterTotalsY = rowY + 80;
      if (notes) {
        doc.fontSize(8).font('Helvetica-Bold').fillColor(MID_GREY).text('NOTES', 50, afterTotalsY);
        doc.fontSize(9).font('Helvetica').fillColor(TEXT).text(notes, 50, afterTotalsY + 14, { width: W });
        afterTotalsY += 14 + doc.heightOfString(notes, { width: W }) + 20;
      }

      // ── Terms & Conditions ───────────────────────────────────────
      if (terms) {
        doc.fontSize(8).font('Helvetica-Bold').fillColor(MID_GREY).text('TERMS & CONDITIONS', 50, afterTotalsY);
        doc.fontSize(8).font('Helvetica').fillColor(MID_GREY).text(terms, 50, afterTotalsY + 14, { width: W });
      }

      // ── Footer ───────────────────────────────────────────────────
      const footY = doc.page.height - 60;
      doc.rect(50, footY, W, 1).fill(LIGHT_GREY);
      doc.fontSize(8).font('Helvetica').fillColor(MID_GREY)
        .text(t.footerLine1, 50, footY + 8,  { width: W, align: 'center' })
        .text(t.footerLine2, 50, footY + 20, { width: W, align: 'center' });
    }

    doc.end();
  });

  // ── Appendix (pdf-lib merge): product brochures, then — for quotes —
  // Terms & Conditions as the very last page(s) of the document. ─────
  const brochureUrls = (items || []).filter(i => i.brochure_base64).map(i => i.brochure_base64);
  const needsTermsPage = isQuote && !!terms;
  if (!brochureUrls.length && !needsTermsPage) return mainBuf;

  const merged = await PdfLib.load(mainBuf);

  const seenBrochures = new Set();
  for (const dataUrl of brochureUrls) {
    const key = dataUrl.slice(0, 100);
    if (seenBrochures.has(key)) continue;
    seenBrochures.add(key);
    try {
      if (dataUrl.startsWith('data:application/pdf')) {
        const raw = dataUrl.replace(/^data:application\/pdf;base64,/, '');
        const brochureDoc = await PdfLib.load(Buffer.from(raw, 'base64'));
        const pageIndices = brochureDoc.getPageIndices();
        const copied = await merged.copyPages(brochureDoc, pageIndices);
        copied.forEach(p => merged.addPage(p));
      } else {
        const raw = dataUrl.replace(/^data:image\/\w+;base64,/, '');
        const imgBuf = Buffer.from(raw, 'base64');
        const page = merged.addPage([595, 842]); // A4
        const img = dataUrl.startsWith('data:image/png') ? await merged.embedPng(imgBuf) : await merged.embedJpg(imgBuf);
        const { width, height } = img.scaleToFit(595, 842);
        page.drawImage(img, { x: (595 - width) / 2, y: (842 - height) / 2, width, height });
      }
    } catch { /* skip bad brochure */ }
  }

  // Terms & Conditions, built as its own small pdfkit document (so its text
  // wraps and paginates using pdfkit's own layout engine rather than
  // reimplementing that by hand in pdf-lib), then spliced on as final pages —
  // always last, after every brochure.
  if (needsTermsPage) {
    const TERMS_MARGIN = 50;
    const termsBuf = await new Promise((resolve, reject) => {
      const termsDoc = new PDFDocument({ margin: TERMS_MARGIN, size: 'A4' });
      const termsW = termsDoc.page.width - TERMS_MARGIN * 2;
      const chunks = [];
      termsDoc.on('data', c => chunks.push(c));
      termsDoc.on('end', () => resolve(Buffer.concat(chunks)));
      termsDoc.on('error', reject);
      termsDoc.fontSize(16).font('Helvetica-Bold').fillColor(BRAND).text('Terms & Conditions', TERMS_MARGIN, TERMS_MARGIN);
      termsDoc.fontSize(9).font('Helvetica').fillColor(TEXT).text(terms, TERMS_MARGIN, TERMS_MARGIN + 30, { width: termsW });
      termsDoc.end();
    });
    const termsPdf = await PdfLib.load(termsBuf);
    const copiedTerms = await merged.copyPages(termsPdf, termsPdf.getPageIndices());
    copiedTerms.forEach(p => merged.addPage(p));
  }

  return Buffer.from(await merged.save());
}

module.exports = { buildPDF };
