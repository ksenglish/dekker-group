const PDFDocument = require('pdfkit');

const TEXT = '#0f172a';
const MID_GREY = '#64748b';
const LIGHT_GREY = '#f1f5f9';
const RULE = '#e2e8f0';

const MARGIN = 50;
const PAGE_W = 595.28; // A4 pt
const PAGE_H = 841.89;
const CONTENT_W = PAGE_W - MARGIN * 2;

function formatDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' });
}

const WORK_TYPE_LABEL = { addition: 'Addition', alteration: 'Alteration', new_work: 'New work' };
const RISK_LABEL = { low_risk: 'Low risk', general: 'General', high_risk: 'High-risk' };
const COMPLIANCE_PART_LABEL = { part1: 'Part 1 of AS/NZS 3000', part2: 'Part 2 of AS/NZS 3000' };
const PARTS_SCOPE_LABEL = { all: 'All', parts: 'Parts' };

// Builds the Electrical Certificate of Compliance & Electrical Safety
// Certificate PDF from a submitted job_electrical_coc row. Deliberately not a
// pixel-for-pixel replica of the original AS/NZS layout — it's a clean,
// letterhead-branded digital re-typesetting covering every field on it.
async function buildElectricalCocPDF({ job, form, theme = {} }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: MARGIN, size: 'A4' });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    let y = MARGIN;

    function ensureSpace(needed) {
      if (y + needed > PAGE_H - MARGIN) {
        doc.addPage();
        y = MARGIN;
      }
    }

    function sectionHeader(title) {
      ensureSpace(26);
      doc.rect(MARGIN, y, CONTENT_W, 20).fill(theme.brandColour || '#1e40af');
      doc.fillColor('white').fontSize(10).font('Helvetica-Bold').text(title, MARGIN + 8, y + 5);
      doc.fillColor(TEXT);
      y += 30;
    }

    function field(label, value, opts = {}) {
      const width = opts.width || CONTENT_W;
      doc.fontSize(8).font('Helvetica-Bold').fillColor(MID_GREY);
      const labelHeight = doc.heightOfString(label, { width });
      doc.fontSize(9).font('Helvetica').fillColor(TEXT);
      const text = value || '—';
      const valueHeight = doc.heightOfString(text, { width });
      ensureSpace(labelHeight + valueHeight + 10);
      doc.fontSize(8).font('Helvetica-Bold').fillColor(MID_GREY).text(label, MARGIN, y, { width });
      y += labelHeight + 2;
      doc.fontSize(9).font('Helvetica').fillColor(TEXT).text(text, MARGIN, y, { width });
      y += valueHeight + 10;
    }

    function fieldRow(fields) {
      // fields: [{label, value}, ...] laid out side by side, equal width
      const width = (CONTENT_W - (fields.length - 1) * 16) / fields.length;
      doc.fontSize(8).font('Helvetica-Bold');
      const labelH = Math.max(...fields.map(f => doc.heightOfString(f.label, { width })));
      doc.fontSize(9).font('Helvetica');
      const valueH = Math.max(...fields.map(f => doc.heightOfString(f.value || '—', { width })));
      ensureSpace(labelH + valueH + 10);
      fields.forEach((f, i) => {
        const x = MARGIN + i * (width + 16);
        doc.fontSize(8).font('Helvetica-Bold').fillColor(MID_GREY).text(f.label, x, y, { width });
        doc.fontSize(9).font('Helvetica').fillColor(TEXT).text(f.value || '—', x, y + labelH + 2, { width });
      });
      y += labelH + valueH + 10;
    }

    function checkbox(x, yy, checked) {
      doc.rect(x, yy, 9, 9).lineWidth(1).strokeColor(TEXT).stroke();
      if (checked) {
        doc.fontSize(9).font('Helvetica-Bold').fillColor(TEXT).text('X', x + 1.2, yy - 1.5);
      }
    }

    // Tri-state Yes/No question rendered as two checkboxes
    function yesNo(label, value) {
      ensureSpace(20);
      doc.fontSize(9).font('Helvetica').fillColor(TEXT).text(label, MARGIN, y, { width: CONTENT_W - 130 });
      const boxesX = MARGIN + CONTENT_W - 120;
      checkbox(boxesX, y, value === true);
      doc.fontSize(9).font('Helvetica').fillColor(TEXT).text('Yes', boxesX + 13, y - 1);
      checkbox(boxesX + 55, y, value === false);
      doc.fontSize(9).font('Helvetica').fillColor(TEXT).text('No', boxesX + 68, y - 1);
      y += 20;
    }

    function choiceRow(label, options, selected) {
      ensureSpace(20);
      doc.fontSize(8).font('Helvetica-Bold').fillColor(MID_GREY).text(label, MARGIN, y);
      y += 12;
      let x = MARGIN;
      options.forEach(([key, optLabel]) => {
        checkbox(x, y, selected === key);
        doc.fontSize(9).font('Helvetica').fillColor(TEXT).text(optLabel, x + 13, y - 1);
        x += 13 + doc.widthOfString(optLabel) + 20;
      });
      y += 18;
    }

    function divider() {
      ensureSpace(10);
      doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_W, y).strokeColor(RULE).lineWidth(1).stroke();
      y += 10;
    }

    // ── Letterhead ──────────────────────────────────────────────
    doc.rect(MARGIN, y, CONTENT_W, 50).fill(theme.brandColour || '#1e40af');
    doc.fillColor('white').fontSize(15).font('Helvetica-Bold').text(theme.companyName || 'DEKKER GROUP', MARGIN + 12, y + 10);
    doc.fontSize(8).font('Helvetica').fillColor('rgba(255,255,255,0.85)').text(theme.tagline || '', MARGIN + 12, y + 30);
    doc.fillColor(TEXT);
    y += 62;

    doc.fontSize(15).font('Helvetica-Bold').fillColor(theme.brandColour || '#1e40af')
      .text('ELECTRICAL CERTIFICATE OF COMPLIANCE & ELECTRICAL SAFETY CERTIFICATE', MARGIN, y, { width: CONTENT_W });
    y += doc.heightOfString('ELECTRICAL CERTIFICATE OF COMPLIANCE & ELECTRICAL SAFETY CERTIFICATE', { width: CONTENT_W }) + 8;
    doc.fontSize(8).font('Helvetica').fillColor(MID_GREY)
      .text('Certifies that installations or part installations under Part 1 or Part 2 of AS/NZS 3000 are safe to be connected to the specified system of electrical supply.', MARGIN, y, { width: CONTENT_W });
    y += doc.heightOfString('x', { width: CONTENT_W }) * 2 + 10;

    field('Reference / Certificate ID No.', form.reference_no);
    field('Location Details', form.location_details);
    field('Contact Details (Name and address)', form.contact_details);
    fieldRow([
      { label: 'Name of Electrical Worker', value: form.electrical_worker_name },
      { label: 'Registration / Practising Licence Number', value: form.licence_number },
    ]);
    field('Phone & Email', form.phone_email);
    field('Name and Registration Number of Person(s) Supervised', form.supervised_persons);

    // ── Certificate of Compliance ─────────────────────────────────
    sectionHeader('Certificate of Compliance');

    choiceRow('Type of Work', [['addition', 'Addition'], ['alteration', 'Alteration'], ['new_work', 'New work']], form.work_type);
    choiceRow('The Prescribed Electrical Work Is', [['low_risk', 'Low risk'], ['general', 'General'], ['high_risk', 'High-risk']], form.risk_level);
    if (form.risk_level === 'high_risk') field('High-risk — Specify', form.high_risk_detail);

    choiceRow('Means of Compliance', [['part1', 'Part 1 of AS/NZS 3000'], ['part2', 'Part 2 of AS/NZS 3000']], form.compliance_part);

    yesNo('Additional standards or electrical code of practice were required?', form.additional_standards_required);
    if (form.additional_standards_required) field('Additional Standards — Specify', form.additional_standards_detail);

    field('Date or Range of Dates Prescribed Electrical Work Undertaken', form.work_date_range);
    yesNo('Contains fittings that are safe to connect to a power supply?', form.fittings_safe);
    field('Specify Type of Supply System', form.supply_system_type);
    yesNo('The installation has an earthing system that is correctly rated (where applicable)', form.earthing_correctly_rated);

    choiceRow('Parts of the Installation That Are Safe to Connect to a Power Supply', [['all', 'All'], ['parts', 'Parts']], form.parts_scope);
    if (form.parts_scope === 'parts') field('Parts — Specify', form.parts_scope_detail);

    yesNo('The work relies on manufacturer’s instructions', form.relies_on_manual);
    if (form.relies_on_manual) fieldRow([{ label: 'Identify', value: form.manual_identify }, { label: 'Link', value: form.manual_link }]);

    yesNo('The work has been done in accordance with a certified design', form.relies_on_certified_design);
    if (form.relies_on_certified_design) fieldRow([{ label: 'Identify', value: form.design_identify }, { label: 'Link', value: form.design_link }]);

    yesNo('The work relies on a Supplier Declaration of Conformity (SDoC)', form.relies_on_sdoc);
    if (form.relies_on_sdoc) fieldRow([{ label: 'Identify', value: form.sdoc_identify }, { label: 'Link', value: form.sdoc_link }]);

    yesNo('Satisfactorily tested per the Electricity (Safety) Regulations 2010', form.satisfactorily_tested);

    divider();
    field('Description of Work', form.description_of_work);

    fieldRow([
      { label: 'Polarity (Independent Earth)', value: form.test_polarity },
      { label: 'Insulation Resistance (Ohms)', value: form.test_insulation_resistance },
    ]);
    fieldRow([
      { label: 'Earth Continuity (Ohms)', value: form.test_earth_continuity },
      { label: 'Bonding (Ohms)', value: form.test_bonding },
    ]);
    fieldRow([
      { label: 'Fault Loop Impedance (Ohms)', value: form.test_fault_loop_impedance },
      { label: 'Other', value: form.test_other },
    ]);

    divider();
    ensureSpace(30);
    doc.fontSize(8).font('Helvetica-Oblique').fillColor(MID_GREY)
      .text('By signing, the certifier confirms the completed prescribed electrical work has been done lawfully and safely, and the information in this certificate is correct.', MARGIN, y, { width: CONTENT_W });
    y += doc.heightOfString('x', { width: CONTENT_W }) * 2 + 8;
    fieldRow([
      { label: 'Certifier’s Signature', value: form.coc_certifier_signature },
      { label: 'Date', value: formatDate(form.coc_signed_date) },
    ]);

    // ── Electrical Safety Certificate ──────────────────────────────
    sectionHeader('Electrical Safety Certificate');
    doc.fontSize(8).font('Helvetica-Oblique').fillColor(MID_GREY)
      .text('By signing, the certifier confirms the installation (or part of it) to which this Electrical Safety Certificate applies is connected to a power supply and is safe to use. This certificate also confirms the work complies with the building code for the purposes of Section 19(1)(e) of the Building Act 2004.', MARGIN, y, { width: CONTENT_W });
    y += doc.heightOfString('x', { width: CONTENT_W }) * 4 + 8;

    fieldRow([
      { label: 'Certifier’s Name', value: form.esc_certifier_name },
      { label: 'Registration / Practising Licence Number', value: form.esc_licence_number },
    ]);
    fieldRow([
      { label: 'Certifier’s Signature', value: form.esc_certifier_signature },
      { label: 'Certificate Issue Date', value: formatDate(form.esc_issue_date) },
    ]);
    field('Connection Date', formatDate(form.esc_connection_date));

    divider();
    doc.fontSize(8).font('Helvetica-Bold').fillColor(MID_GREY)
      .text('CUSTOMER COPY — THIS IS AN IMPORTANT DOCUMENT AND SHOULD BE RETAINED FOR A MINIMUM OF 7 YEARS', MARGIN, y, { width: CONTENT_W, align: 'center' });

    doc.end();
  });
}

module.exports = { buildElectricalCocPDF };
