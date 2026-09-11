import { parseMoneyToMinor } from './domain.js';

export function parseCsv(text) {
  const source = String(text || '').replace(/^\uFEFF/, '');
  const firstLine = source.split(/\r?\n/, 1)[0] || '';
  const delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"') {
      if (quoted && source[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(field.trim()); field = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      row.push(field.trim()); field = '';
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else field += char;
  }
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  if (rows.length < 2) return { headers: rows[0] || [], rows: [], delimiter };
  const headers = rows[0].map((header, index) => header || `Sloupec ${index + 1}`);
  return {
    headers,
    rows: rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || '']))),
    delimiter,
  };
}
export function inferMapping(headers) {
  const normalized = headers.map((header) => ({ raw: header, value: header.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') }));
  const find = (patterns) => normalized.find((item) => patterns.some((pattern) => item.value.includes(pattern)))?.raw || '';
  return {
    date: find(['datum','date','created','cas']),
    amount: find(['castka','amount','suma','price','hodnota']),
    kind: find(['typ','kind','type','kategorie']),
    note: find(['popis','description','note','poznamka','memo']),
    externalId: find(['id','reference','variabilni','transaction']),
  };
}

function kindFrom(value, amountMinor) {
  const text = String(value || '').toLowerCase();
  if (text.includes('refund') || text.includes('vrat')) return 'refund';
  if (text.includes('fee') || text.includes('poplat')) return 'fee';
  if (text.includes('advert') || text.includes('reklam') || text.includes('meta') || text.includes('sklik')) return 'ad_spend';
  if (text.includes('transfer') || text.includes('payout') || text.includes('prevod')) return 'transfer';
  if (text.includes('income') || text.includes('prijem') || amountMinor < 0) return 'income';
  return 'expense';
}

function normalizeDate(value) {
  const input = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(input)) return new Date(input.length === 10 ? `${input}T12:00:00+02:00` : input).toISOString();
  const match = input.match(/^(\d{1,2})[.\/]\s*(\d{1,2})[.\/]\s*(\d{4})$/);
  if (match) return new Date(`${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}T12:00:00+02:00`).toISOString();
  return null;
}

export function mapCsvRows(rows, mapping, source = 'csv') {
  return rows.map((row, index) => {
    const rawAmount = parseMoneyToMinor(row[mapping.amount]);
    const occurredAt = normalizeDate(row[mapping.date]);
    const errors = [];
    if (rawAmount === null || rawAmount === 0) errors.push('Chybí platná nenulová částka.');
    if (!occurredAt) errors.push('Chybí platné datum.');
    const kind = kindFrom(row[mapping.kind], rawAmount || 0);
    const externalId = String(row[mapping.externalId] || '').trim() || null;
    const fingerprint = externalId ? null : [source, occurredAt, rawAmount, row[mapping.note] || '', index + 1].join('|');
    return {
      rowNumber: index + 1,
      valid: errors.length === 0,
      errors,
      entry: {
        source,
        external_id: externalId,
        import_fingerprint: fingerprint,
        occurred_at: occurredAt,
        currency: 'CZK',
        amount_minor: Math.abs(rawAmount || 0),
        kind,
        status: 'posted',
        note: String(row[mapping.note] || '').trim() || null,
      },
      raw: row,
    };
  });
}
