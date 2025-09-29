import { renderResumeTextPreview } from './resume-preview.js';

function sanitizeLine(line) {
  if (!line) return '';
  const normalized = line
    .replace(/\r/g, '')
    .replace(/[\t]/g, '    ')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '?');
  const asciiSafe = normalized.replace(/[^\x20-\x7E]/g, '?');
  return asciiSafe
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function buildContentStream(lines) {
  const body = [
    'BT',
    '/F1 12 Tf',
    '14 TL',
    '72 720 Td',
  ];

  lines.forEach((line, index) => {
    if (index === 0) {
      body.push(`(${sanitizeLine(line)}) Tj`);
    } else {
      body.push('T*');
      body.push(`(${sanitizeLine(line)}) Tj`);
    }
  });

  body.push('ET');
  return body.join('\n');
}

function synthesizePdf(lines) {
  const safeLines = lines.length > 0 ? lines : [''];
  const contentStream = buildContentStream(safeLines);
  const contentBuffer = Buffer.from(contentStream, 'utf8');
  const offsets = [];
  let output = '%PDF-1.4\n';

  const addObject = (id, body) => {
    offsets[id] = output.length;
    output += `${id} 0 obj\n${body}\nendobj\n`;
  };

  addObject(1, '<< /Type /Catalog /Pages 2 0 R >>');
  addObject(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  addObject(
    3,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  );
  addObject(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  addObject(
    5,
    `<< /Length ${contentBuffer.length} >>\nstream\n${contentBuffer.toString('latin1')}\nendstream`,
  );

  const xrefOffset = output.length;
  output += 'xref\n';
  output += '0 6\n';
  output += '0000000000 65535 f \n';
  for (let i = 1; i <= 5; i += 1) {
    const offset = offsets[i] ?? 0;
    output += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  output += 'trailer\n';
  output += '<< /Size 6 /Root 1 0 R >>\n';
  output += 'startxref\n';
  output += `${xrefOffset}\n`;
  output += '%%EOF';

  return Buffer.from(output, 'latin1');
}

export function renderResumePdf(resume) {
  const preview = renderResumeTextPreview(resume);
  const lines = preview.split(/\r?\n/);
  return synthesizePdf(lines);
}
