// Generates the landscape A4 week grid with jsPDF + AutoTable.
import { SLOT_KEYS, dayName, addDays, shortDate, weekLabel } from './planner.js';

const NAVY = [31, 59, 115];
const GRAY = [110, 116, 133];
const LINE = [200, 205, 215];
const TEXT = [27, 34, 48];
const PT = 25.4 / 72; // 1pt in mm
const LH = 1.18; // line height factor

let fontCache;
async function loadFonts() {
  if (fontCache) return fontCache;
  const toB64 = async (url) => {
    const buf = await fetch(url).then((r) => { if (!r.ok) throw new Error('font ' + url); return r.arrayBuffer(); });
    let bin = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  };
  fontCache = { regular: await toB64('fonts/NotoSans-Regular.ttf'), bold: await toB64('fonts/NotoSans-Bold.ttf') };
  return fontCache;
}

function registerFonts(doc, fonts) {
  doc.addFileToVFS('NotoSans-Regular.ttf', fonts.regular);
  doc.addFont('NotoSans-Regular.ttf', 'NotoSans', 'normal');
  doc.addFileToVFS('NotoSans-Bold.ttf', fonts.bold);
  doc.addFont('NotoSans-Bold.ttf', 'NotoSans', 'bold');
}

/**
 * Lay out one meal cell into styled lines: [{text, size, bold, color, indent}]
 */
function mealLines(doc, meal, width, fs) {
  if (!meal) return [];
  const out = [];
  out.push({ text: meal.id, size: fs - 1.5, bold: true, color: NAVY });
  doc.setFont('NotoSans', 'bold'); doc.setFontSize(fs + 0.5);
  for (const t of doc.splitTextToSize(meal.title, width)) out.push({ text: t, size: fs + 0.5, bold: true, color: TEXT });
  doc.setFont('NotoSans', 'normal'); doc.setFontSize(fs);
  const indent = doc.getTextWidth('• ');
  for (const line of meal.lines) {
    const parts = doc.splitTextToSize(line, width - indent);
    parts.forEach((p, i) => out.push({ text: p, size: fs, bold: false, color: TEXT, bullet: i === 0, indent }));
  }
  return out;
}

function linesHeight(lines) {
  return lines.reduce((h, l) => h + l.size * PT * LH, 0);
}

function drawLines(doc, lines, x, y) {
  let cy = y;
  for (const l of lines) {
    doc.setFont('NotoSans', l.bold ? 'bold' : 'normal');
    doc.setFontSize(l.size);
    doc.setTextColor(...l.color);
    const lh = l.size * PT * LH;
    if (l.bullet) doc.text('•', x, cy + lh * 0.8);
    doc.text(l.text, x + (l.indent || 0), cy + lh * 0.8);
    cy += lh;
  }
}

function buildDoc(jsPDF, fonts, plan, data, rules, fs) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  registerFonts(doc, fonts);
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 8;
  const byId = new Map(data.meals.map((m) => [m.id, m]));
  const slotMeta = (k) => data.slots.find((s) => s.key === k);

  // header
  doc.setFont('NotoSans', 'normal'); doc.setFontSize(7); doc.setTextColor(...GRAY);
  if (rules.dietitian) doc.text(rules.dietitian.toLocaleUpperCase("tr"), M, M + 3, { charSpace: 0.4 });
  doc.setFontSize(8.5); doc.setTextColor(...TEXT);
  doc.text(`Hafta ${weekLabel(plan.weekStart)}`, W - M, M + 3, { align: 'right' });
  doc.setFont('NotoSans', 'bold'); doc.setFontSize(15); doc.setTextColor(...NAVY);
  doc.text(rules.title, M, M + 10);
  doc.setDrawColor(...NAVY); doc.setLineWidth(0.6);
  doc.line(M, M + 12.5, W - M, M + 12.5);

  const firstCol = 24;
  const dayCol = (W - 2 * M - firstCol) / 7;
  const pad = 1.6;
  const cellW = dayCol - 2 * pad;

  const head = [['Öğün', ...plan.days.map((_, i) => `${dayName(plan.weekStart, i)}\n${shortDate(addDays(plan.weekStart, i))}`)]];
  const body = SLOT_KEYS.map((slot) => [
    { kind: 'slot', meta: slotMeta(slot) },
    ...plan.days.map((d) => ({ kind: 'meal', meal: d[slot] ? byId.get(d[slot]) : null })),
  ]);
  body.push([{ kind: 'slot', meta: { label: rules.checks.join(' / '), time: '' } }, ...plan.days.map(() => ({ kind: 'checks' }))]);

  // pre-compute layouts so AutoTable gets the right heights via a dummy text of matching line count
  const layouts = new Map(); // "row,col" -> lines
  body.forEach((row, r) => row.forEach((cell, c) => {
    if (cell.kind === 'meal') layouts.set(`${r},${c}`, mealLines(doc, cell.meal, cellW, fs));
  }));

  doc.autoTable({
    startY: M + 15,
    margin: { left: M, right: M, top: M, bottom: M },
    head,
    body,
    theme: 'grid',
    tableLineColor: LINE, tableLineWidth: 0.2,
    styles: { font: 'NotoSans', fontSize: fs, cellPadding: pad, lineColor: LINE, lineWidth: 0.2, textColor: TEXT, valign: 'top', overflow: 'linebreak' },
    headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold', fontSize: fs + 1, valign: 'middle', minCellHeight: 9 },
    columnStyles: Object.fromEntries([[0, { cellWidth: firstCol, fillColor: [244, 245, 248] }], ...plan.days.map((_, i) => [i + 1, { cellWidth: dayCol }])]),
    rowPageBreak: 'avoid',
    didParseCell(h) {
      if (h.section === 'head') {
        const t = h.cell.raw.split('\n');
        h.cell.text = t;
        return;
      }
      const raw = h.cell.raw;
      if (raw.kind === 'meal') {
        const lines = layouts.get(`${h.row.index},${h.column.index}`);
        // Give AutoTable a block of the same height: n lines at the cell font size.
        const n = Math.ceil(linesHeight(lines) / (fs * PT * LH));
        h.cell.text = Array(Math.max(n, 1)).fill(' ');
        h.cell.styles.minCellHeight = Math.max(linesHeight(lines) + 2 * pad, 14);
      } else if (raw.kind === 'slot') {
        h.cell.text = [raw.meta.label, raw.meta.time].filter(Boolean);
      } else if (raw.kind === 'checks') {
        h.cell.text = ['', ''];
        h.cell.styles.minCellHeight = 10;
      }
    },
    willDrawCell(h) {
      if (h.section !== 'body') return;
      const raw = h.cell.raw;
      const { x, y, width, height } = h.cell;
      if (raw.kind === 'meal') {
        doc.setFillColor(255, 255, 255); doc.setDrawColor(...LINE); doc.setLineWidth(0.2);
        doc.rect(x, y, width, height, 'FD');
        drawLines(doc, layouts.get(`${h.row.index},${h.column.index}`), x + pad, y + pad);
        return false;
      }
      if (raw.kind === 'slot') {
        doc.setFillColor(244, 245, 248); doc.setDrawColor(...LINE); doc.setLineWidth(0.2);
        doc.rect(x, y, width, height, 'FD');
        doc.setFont('NotoSans', 'bold'); doc.setFontSize(fs + 0.5); doc.setTextColor(...NAVY);
        const tl = doc.splitTextToSize(raw.meta.label, width - 2 * pad);
        doc.text(tl, x + pad, y + pad + (fs + 0.5) * PT);
        if (raw.meta.time) {
          doc.setFont('NotoSans', 'normal'); doc.setFontSize(fs - 0.5); doc.setTextColor(...GRAY);
          doc.text(raw.meta.time, x + pad, y + pad + (fs + 0.5) * PT * LH * tl.length + (fs - 0.5) * PT);
        }
        return false;
      }
      if (raw.kind === 'checks') {
        doc.setFillColor(255, 255, 255); doc.setDrawColor(...LINE); doc.setLineWidth(0.2);
        doc.rect(x, y, width, height, 'FD');
        doc.setFont('NotoSans', 'normal'); doc.setFontSize(fs - 0.5); doc.setTextColor(...GRAY);
        doc.setDrawColor(...GRAY); doc.setLineWidth(0.25);
        rules.checks.forEach((label, i) => {
          const cy = y + pad + i * 4.2;
          doc.rect(x + pad, cy, 2.8, 2.8);
          doc.text(label, x + pad + 4, cy + 2.3);
        });
        return false;
      }
    },
  });

  // footer rules, two columns
  let y = doc.lastAutoTable.finalY + 4;
  const colW = (W - 2 * M - 6) / 2;
  const all = [...rules.rules, ...rules.exchanges];
  const half = Math.ceil(all.length / 2);
  const cols = [all.slice(0, half), all.slice(half)];
  doc.setFont('NotoSans', 'normal'); doc.setFontSize(fs - 0.5); doc.setTextColor(...TEXT);
  let maxY = y;
  cols.forEach((items, ci) => {
    const x = M + ci * (colW + 6);
    let cy = y;
    for (const t of items) {
      const lines = doc.splitTextToSize(t, colW - 4);
      doc.text('•', x, cy + 2.2);
      doc.text(lines, x + 3, cy + 2.2);
      cy += lines.length * (fs - 0.5) * PT * 1.25 + 0.8;
    }
    maxY = Math.max(maxY, cy);
  });

  return { doc, overflow: maxY > H - M || doc.getNumberOfPages() > 1 };
}

export async function generatePdf(plan, data, rules) {
  const jsPDF = window.jspdf?.jsPDF;
  if (!jsPDF) throw new Error('jsPDF yüklenmedi');
  const fonts = await loadFonts();
  let result;
  for (const fs of [7, 6.5, 6, 5.5, 5]) {
    result = buildDoc(jsPDF, fonts, plan, data, rules, fs);
    if (!result.overflow) break;
  }
  result.doc.save(`haftalik-menu-${plan.weekStart}.pdf`);
}
