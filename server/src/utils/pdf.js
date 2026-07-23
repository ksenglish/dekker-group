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

const LOGO_SIZES = { small: 36, medium: 58, large: 78 };

const STATUS_COLOURS = {
  draft: '#6b7280', approved: '#7c3aed', sent: '#0891b2', accepted: '#16a34a', declined: '#dc2626',
  cancelled: '#6b7280', paid: '#16a34a', overdue: '#dc2626',
};

async function buildPDF({ type, number, customer, jobNumber, jobAddress, items, subtotal, gst, total, status, dueDate, expiresAt, notes, terms, issuedAt, theme = {}, appendixImages = [] }) {
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
  jobNumber = stripDiacritics(jobNumber);
  jobAddress = stripDiacritics(jobAddress);
  customer = {
    ...customer,
    name: stripDiacritics(customer?.name),
    company: stripDiacritics(customer?.company),
    email: stripDiacritics(customer?.email),
    phone: stripDiacritics(customer?.phone),
    address: stripDiacritics(customer?.address),
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

      doc.fontSize(8).font('Helvetica-Bold').fillColor(TEXT);
      doc.text('BILL TO', col1X, y, { width: colW });
      doc.text('JOB DETAILS', col2X, y, { width: colW });
      doc.text('QUOTE DETAILS', col3X, y, { width: colW });
      y += 14;

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
        doc.fontSize(9).font('Helvetica-Bold').fillColor('#dc2626').text(formatDate(expiresAt), col3X, c3y, { width: colW });
        c3y += 16;
      }
      if (t.gstNumber) {
        doc.fontSize(8).font('Helvetica-Bold').fillColor(TEXT).text('GST Number', col3X, c3y, { width: colW });
        c3y += 12;
        doc.fontSize(9).font('Helvetica').fillColor(TEXT).text(t.gstNumber, col3X, c3y, { width: colW });
      }

      y = Math.max(c1y, c2y, c3y) + 16;

      // ── Notes — above the line items ──────────────────────────────
      if (notes) {
        const noteH = doc.fontSize(9).font('Helvetica').heightOfString(notes, { width: W });
        y = ensureSpace(y, 14 + noteH + 10);
        doc.fontSize(8).font('Helvetica-Bold').fillColor(TEXT).text('NOTES', 50, y);
        doc.fontSize(9).font('Helvetica').fillColor(TEXT).text(notes, 50, y + 14, { width: W });
        y += 14 + noteH + 20;
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

      // ── Drawing(s) — each on its own full page, titled "Proposal" ──
      let drewDrawing = false;
      for (const dataUrl of appendixImages || []) {
        try {
          const raw = dataUrl.replace(/^data:image\/\w+;base64,/, '');
          const buf = Buffer.from(raw, 'base64');
          doc.addPage();
          doc.fontSize(18).font('Helvetica-Bold').fillColor(BRAND).text('Proposal', MARGIN, MARGIN);
          const imgTop = MARGIN + 18 + 16;
          doc.image(buf, MARGIN, imgTop, { fit: [W, PAGE_H - imgTop - MARGIN], align: 'center', valign: 'center' });
          drewDrawing = true;
        } catch { /* skip bad drawing */ }
      }
      y = drewDrawing ? MARGIN : y;

      // ── Terms & Conditions — after the drawing ────────────────────
      if (terms) {
        const termsH = doc.fontSize(8).font('Helvetica').heightOfString(terms, { width: W });
        y = ensureSpace(y, 14 + termsH + 10);
        doc.fontSize(8).font('Helvetica-Bold').fillColor(TEXT).text('TERMS & CONDITIONS', 50, y);
        doc.fontSize(8).font('Helvetica').fillColor(TEXT).text(terms, 50, y + 14, { width: W });
        y += 14 + termsH + 20;
      }

      // ── Footer — flows after content instead of pinning to the
      // page bottom, so it can never land on a page of its own. ────
      y = ensureSpace(y, 30);
      doc.moveTo(50, y).lineTo(50 + W, y).strokeColor(LIGHT_GREY).lineWidth(1).stroke();
      doc.fontSize(8).font('Helvetica').fillColor(TEXT)
        .text(t.footerLine1, 50, y + 10, { width: W, align: 'center' })
        .text(t.footerLine2, 50, y + 22, { width: W, align: 'center' });
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

      // ── Bill To ──────────────────────────────────────────────────
      const billY = docY + 70;
      doc.fontSize(8).font('Helvetica-Bold').fillColor(MID_GREY).text('BILL TO', 50, billY);
      doc.fillColor(TEXT).fontSize(11).font('Helvetica-Bold').text(customer.name || '', 50, billY + 14);
      doc.fontSize(9).font('Helvetica');
      let cy = billY + 30;
      if (customer.company) { doc.text(customer.company, 50, cy); cy += 14; }
      if (customer.email)   { doc.text(customer.email, 50, cy); cy += 14; }
      if (customer.phone)   { doc.text(customer.phone, 50, cy); }

      // ── Line items table ─────────────────────────────────────────
      const tableY = billY + 90;
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

  // ── Appendix (pdf-lib merge): product brochures, directly after
  // everything above (drawings are now rendered inline via pdfkit) ─
  const brochureUrls = (items || []).filter(i => i.brochure_base64).map(i => i.brochure_base64);
  if (!brochureUrls.length) return mainBuf;

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

  return Buffer.from(await merged.save());
}

module.exports = { buildPDF };
