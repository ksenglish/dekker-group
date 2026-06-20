const PDFDocument = require('pdfkit');

const LIGHT_GREY = '#f1f5f9';
const MID_GREY = '#94a3b8';
const TEXT = '#0f172a';

const DEFAULT_THEME = {
  companyName: 'DEKKER GROUP',
  tagline: 'HVAC Installation & Field Services',
  website: 'dekkergroup.co.nz',
  email: 'kyle@dekkergroup.co.nz',
  phone: '',
  location: 'New Zealand',
  brandColour: '#1e40af',
  footerLine1: 'Thank you for your business.',
  footerLine2: 'Dekker Group · New Zealand · GST registered',
  logoBase64: '',
};

function formatNZD(cents) {
  return '$' + (cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' });
}

function buildPDF({ type, number, customer, items, subtotal, gst, total, status, dueDate, notes, terms, issuedAt, theme = {} }) {
  const t = { ...DEFAULT_THEME, ...theme };
  const BRAND = t.brandColour || '#1e40af';

  // Determine if any item has a product image
  const hasImages = (items || []).some(i => i.media_base64);
  const IMG_COL = 36; // thumbnail width
  const IMG_PAD = hasImages ? IMG_COL + 8 : 0;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = doc.page.width - 100;

    // ── Header bar ──────────────────────────────────────────────
    const headerTextColour = t.transparentHeader ? TEXT : 'white';
    const headerSubColour  = t.transparentHeader ? MID_GREY : 'rgba(255,255,255,0.85)';

    if (!t.transparentHeader) {
      doc.rect(50, 50, W, 70).fill(BRAND);
    } else {
      doc.rect(50, 50, W, 70).fill('#ffffff');
      doc.moveTo(50, 120).lineTo(50 + W, 120).strokeColor('#e2e8f0').lineWidth(1).stroke();
    }

    if (t.logoBase64) {
      try {
        const buf = Buffer.from(t.logoBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
        doc.image(buf, 60, 55, { height: 58, fit: [160, 58] });
      } catch {
        doc.fillColor(t.transparentHeader ? BRAND : 'white').fontSize(22).font('Helvetica-Bold').text(t.companyName, 66, 65);
        doc.fillColor(headerSubColour).fontSize(9).font('Helvetica').text(t.tagline, 66, 92);
      }
    } else {
      doc.fillColor(t.transparentHeader ? BRAND : 'white').fontSize(22).font('Helvetica-Bold').text(t.companyName, 66, 65);
      doc.fillColor(headerSubColour).fontSize(9).font('Helvetica').text(t.tagline, 66, 92);
    }

    // Contact details (right side of header)
    const contactLines = [t.website, t.email, t.phone, t.location].filter(Boolean);
    doc.fillColor(headerSubColour).fontSize(8).font('Helvetica');
    contactLines.forEach((line, i) => {
      doc.text(line, 50, 63 + i * 13, { width: W - 16, align: 'right' });
    });

    doc.fillColor(TEXT);

    // ── Document type + number ───────────────────────────────────
    const docY = 140;
    doc.fontSize(26).font('Helvetica-Bold').fillColor(BRAND).text(type.toUpperCase(), 50, docY);

    const numText = `#${number}`;
    doc.fontSize(11).font('Helvetica').fillColor(MID_GREY).text(numText, 50, docY + 34);

    const statusColour = {
      draft: '#6b7280', sent: '#0891b2', accepted: '#16a34a', declined: '#dc2626',
      paid: '#16a34a', overdue: '#dc2626',
    }[status] || '#6b7280';

    const badgeX = 50 + doc.widthOfString(numText) + 10;
    doc.roundedRect(badgeX, docY + 30, 62, 18, 4).fill(statusColour);
    doc.fontSize(9).font('Helvetica-Bold').fillColor('white')
      .text(status.toUpperCase(), badgeX + 4, docY + 34, { width: 54, align: 'center' });

    // ── Dates block (right) ──────────────────────────────────────
    doc.fillColor(TEXT).fontSize(9).font('Helvetica');
    const dateX = 380;
    doc.text('Issue Date:', dateX, docY);
    doc.font('Helvetica-Bold').text(formatDate(issuedAt || new Date()), dateX + 70, docY);
    if (dueDate) {
      doc.font('Helvetica').text('Due Date:', dateX, docY + 16);
      doc.font('Helvetica-Bold').text(formatDate(dueDate), dateX + 70, docY + 16);
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

    // ── Product Brochure Appendix ────────────────────────────────
    const brochureItems = (items || []).filter(i => i.brochure_base64);
    // Deduplicate by brochure content so same product on multiple lines only appears once
    const seen = new Set();
    for (const item of brochureItems) {
      const key = item.brochure_base64.slice(0, 100);
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        const raw = item.brochure_base64.replace(/^data:image\/\w+;base64,/, '');
        const buf = Buffer.from(raw, 'base64');
        doc.addPage();
        // Full-bleed image with small label header
        doc.rect(0, 0, doc.page.width, 32).fill(BRAND);
        doc.fillColor('white').fontSize(9).font('Helvetica-Bold')
          .text(item.description || 'Product Information', 50, 11, { width: doc.page.width - 100 });
        const imgY = 40;
        const imgH = doc.page.height - imgY - 20;
        doc.image(buf, 0, imgY, { width: doc.page.width, height: imgH, fit: [doc.page.width, imgH], align: 'center', valign: 'center' });
      } catch { /* skip bad image */ }
    }

    doc.end();
  });
}

module.exports = { buildPDF };
