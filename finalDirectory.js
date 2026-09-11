import PDFDocument from 'pdfkit';

const BREAKER_KINDS = new Set([
  '1p_unknown', '2p_unknown', '1p_standard', '2p_standard',
  '1p_afci', '2p_afci', '1p_gfci', '2p_gfci',
  '1p_dual', '2p_dual', '1p_surge', '2p_surge',
]);

function cleanText(value, limit = 280) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

export function normalizeVerifiedDirectory(input, now = new Date()) {
  const recordId = cleanText(input?.recordId, 120);
  const verifiedBy = cleanText(input?.verifiedBy, 120);
  if (!recordId) throw new Error('Panel record ID is required.');
  if (!verifiedBy) throw new Error('Verifier name is required.');
  if (!Array.isArray(input?.rows) || input.rows.length < 2 || input.rows.length > 84) {
    throw new Error('The corrected breaker directory must contain between 2 and 84 circuit positions.');
  }

  const seen = new Set();
  const rows = input.rows.map((row) => {
    const circuit = positiveInteger(row?.circuit);
    if (!circuit || circuit > 84 || seen.has(circuit)) throw new Error('The corrected breaker directory contains an invalid circuit position.');
    seen.add(circuit);
    const breakerKind = BREAKER_KINDS.has(row?.breakerKind) ? row.breakerKind : '1p_unknown';
    return {
      circuit,
      amps: positiveInteger(row?.amps),
      breakerKind,
      poles: breakerKind.startsWith('2p_') ? 2 : 1,
      breakerType: breakerKind.replace(/^\dp_/, ''),
      description: cleanText(row?.description),
      continuationOf: positiveInteger(row?.continuationOf),
      aiConfidence: Number.isFinite(Number(row?.confidenceScore)) ? Number(row.confidenceScore) : null,
      aiNotes: cleanText(row?.notes, 500),
      verificationStatus: 'Verified',
    };
  }).sort((a, b) => a.circuit - b.circuit);

  return {
    schemaVersion: 1,
    recordId,
    verificationStatus: 'Verified',
    verifiedBy,
    verifiedAt: now.toISOString(),
    job: {
      id: cleanText(input?.job?.id, 80),
      serviceTitanId: cleanText(input?.job?.serviceTitanId || input?.job?.id, 80),
      customer: cleanText(input?.job?.customer, 160),
      address: cleanText(input?.job?.address, 240),
    },
    panel: {
      name: cleanText(input?.panel?.name || 'Panel', 120),
      manufacturer: cleanText(input?.panel?.manufacturer || 'Unknown', 120),
      mainAmps: positiveInteger(input?.panel?.mainAmps),
      spaces: rows.length,
    },
    circuits: rows,
  };
}

function breakerLabel(row) {
  if (!row) return '';
  const family = row.breakerType === 'unknown' ? 'Verify type' : row.breakerType.toUpperCase();
  return `${row.amps ? `${row.amps}A` : 'Verify amps'} · ${row.poles}P ${family}`;
}

function description(row, byCircuit) {
  if (!row) return '';
  if (row.continuationOf) return `Continues circuit ${row.continuationOf}`;
  return row.description || 'Unlabeled';
}

function fitText(doc, text, width, fontSize) {
  const value = cleanText(text, 280);
  doc.fontSize(fontSize);
  if (doc.widthOfString(value) <= width) return value;
  let shortened = value;
  while (shortened.length > 1 && doc.widthOfString(`${shortened}…`) > width) shortened = shortened.slice(0, -1);
  return `${shortened.trim()}…`;
}

export function createFinalDirectoryPdf(directory) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', layout: 'landscape', margin: 24, info: {
      Title: `Electrical Panel Directory - ${directory.job.address || directory.recordId}`,
      Author: 'GEN3 Electric & HVAC',
      Subject: `Verified panel directory ${directory.recordId}`,
    } });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const navy = '#0c294a';
    const blue = '#168dcc';
    const green = '#b5d334';
    const ink = '#203b55';
    const muted = '#657b8f';
    const line = '#ccd8e1';
    const x = 24;
    const pageWidth = 744;

    doc.rect(x, 24, pageWidth, 42).fill(navy);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(23).text('GEN3', x + 14, 32, { width: 80 });
    doc.fillColor(green).fontSize(9).text('ELECTRIC & HVAC', x + 92, 42, { width: 110 });
    doc.fillColor('#ffffff').fontSize(16).text('VERIFIED ELECTRICAL PANEL DIRECTORY', x + 260, 37, { width: 470, align: 'right' });

    doc.fillColor(ink).font('Helvetica-Bold').fontSize(11).text(directory.panel.name || 'Panel', x, 76, { width: 250 });
    doc.fillColor(muted).font('Helvetica').fontSize(8).text(directory.job.address || 'Address not available', x, 91, { width: 330 });
    doc.fillColor(ink).font('Helvetica-Bold').fontSize(8).text(`Job #${directory.job.id || '—'}`, x + 350, 78, { width: 120 });
    doc.text(`${directory.panel.manufacturer || 'Unknown'} · ${directory.panel.mainAmps ? `${directory.panel.mainAmps}A Main` : 'Main amps not recorded'}`, x + 480, 78, { width: 264, align: 'right' });
    doc.fillColor(muted).font('Helvetica').fontSize(7.5).text(`Verified by ${directory.verifiedBy} · ${new Date(directory.verifiedAt).toLocaleString('en-US')}`, x + 350, 92, { width: 394, align: 'right' });

    const tableY = 111;
    const physicalRows = Math.ceil(directory.circuits.length / 2);
    const tableBottom = 568;
    const headerHeight = 18;
    const rowHeight = Math.min(22, (tableBottom - tableY - headerHeight) / Math.max(1, physicalRows));
    const columns = [28, 88, 238, 238, 88, 28];
    const starts = [x];
    for (let i = 0; i < columns.length - 1; i += 1) starts.push(starts[i] + columns[i]);

    doc.rect(x, tableY, pageWidth, headerHeight).fill(blue);
    const headers = ['CKT', 'BREAKER', 'LEFT / ODD CIRCUIT', 'RIGHT / EVEN CIRCUIT', 'BREAKER', 'CKT'];
    headers.forEach((header, i) => {
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(7).text(header, starts[i] + 3, tableY + 6, { width: columns[i] - 6, align: i === 2 ? 'left' : i === 3 ? 'right' : 'center' });
    });

    const byCircuit = Object.fromEntries(directory.circuits.map((row) => [row.circuit, row]));
    for (let index = 0; index < physicalRows; index += 1) {
      const y = tableY + headerHeight + index * rowHeight;
      const odd = byCircuit[index * 2 + 1];
      const even = byCircuit[index * 2 + 2];
      if (index % 2 === 1) doc.rect(x, y, pageWidth, rowHeight).fill('#f4f7f9');
      doc.strokeColor(line).lineWidth(0.5).moveTo(x, y + rowHeight).lineTo(x + pageWidth, y + rowHeight).stroke();
      const fontSize = rowHeight < 13 ? 6 : rowHeight < 17 ? 7 : 8;
      const baseline = y + Math.max(2, (rowHeight - fontSize) / 2 - 1);
      const values = [odd?.circuit || '', breakerLabel(odd), description(odd, byCircuit), description(even, byCircuit), breakerLabel(even), even?.circuit || ''];
      values.forEach((value, i) => {
        const align = i === 2 ? 'left' : i === 3 ? 'right' : 'center';
        const weight = i === 0 || i === 5 ? 'Helvetica-Bold' : 'Helvetica';
        doc.fillColor(i === 0 || i === 5 ? navy : ink).font(weight).fontSize(fontSize)
          .text(fitText(doc, value, columns[i] - 6, fontSize), starts[i] + 3, baseline, { width: columns[i] - 6, align, lineBreak: false });
      });
    }

    let vertical = x;
    for (const width of columns) {
      doc.strokeColor(line).lineWidth(0.5).moveTo(vertical, tableY).lineTo(vertical, tableY + headerHeight + physicalRows * rowHeight).stroke();
      vertical += width;
    }
    doc.moveTo(x + pageWidth, tableY).lineTo(x + pageWidth, tableY + headerHeight + physicalRows * rowHeight).stroke();
    doc.fillColor(muted).font('Helvetica').fontSize(6.5).text(`Permanent record: ${directory.recordId} · Generated by GEN3 Panel Labeler`, x, 579, { width: pageWidth, align: 'center' });
    doc.end();
  });
}
