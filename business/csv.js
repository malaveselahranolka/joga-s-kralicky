import { parseMoneyToMinor, pragueDate } from './domain.js';

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

// Znaménko ve výpisech není jednotné: banky i Stripe píšou příjem kladně
// a výdaj záporně, jiné exporty naopak. Hádat se to nedá, proto je to
// výslovná volba v kroku mapování.
export const SIGN_CONVENTIONS = {
  positive_income: 'Kladná částka = příjem',
  positive_expense: 'Kladná částka = výdaj',
};

function kindFrom(value, amountMinor, signConvention = 'positive_income') {
  const text = String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (text.includes('refund') || text.includes('vrat')) return 'refund';
  if (text.includes('fee') || text.includes('poplat')) return 'fee';
  if (text.includes('advert') || text.includes('reklam') || text.includes('sklik')) return 'ad_spend';
  if (text.includes('transfer') || text.includes('payout') || text.includes('prevod')) return 'transfer';
  if (text.includes('income') || text.includes('prijem')) return 'income';
  if (text.includes('expense') || text.includes('vydaj') || text.includes('naklad')) return 'expense';
  const positiveMeansIncome = signConvention !== 'positive_expense';
  return (amountMinor >= 0) === positiveMeansIncome ? 'income' : 'expense';
}

// Poledne pražského dne. Natvrdo psaný posun +02:00 je v zimě špatně.
function pragueNoon(isoDay) {
  for (const offset of ['+01:00', '+02:00']) {
    const candidate = new Date(`${isoDay}T12:00:00${offset}`);
    if (pragueDate(candidate) === isoDay) return candidate.toISOString();
  }
  return new Date(`${isoDay}T12:00:00Z`).toISOString();
}

function normalizeDate(value) {
  const input = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return pragueNoon(input);
  if (/^\d{4}-\d{2}-\d{2}/.test(input)) {
    const parsed = new Date(input);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  const match = input.match(/^(\d{1,2})[.\/]\s*(\d{1,2})[.\/]\s*(\d{4})$/);
  if (match) return pragueNoon(`${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`);
  return null;
}

export function mapCsvRows(rows, mapping, source = 'csv') {
  // Otisk se počítá z obsahu řádku. Dokud v něm bylo pořadové číslo,
  // stačilo řádky přeskládat a stejný export se naimportoval znovu.
  const occurrences = new Map();
  return rows.map((row, index) => {
    const rawAmount = parseMoneyToMinor(row[mapping.amount]);
    const occurredAt = normalizeDate(row[mapping.date]);
    const errors = [];
    if (rawAmount === null || rawAmount === 0) errors.push('Chybí platná nenulová částka.');
    if (!occurredAt) errors.push('Chybí platné datum.');
    const kind = kindFrom(row[mapping.kind], rawAmount || 0, mapping.signConvention);
    const externalId = String(row[mapping.externalId] || '').trim() || null;
    const content = [source, occurredAt, rawAmount, kind, row[mapping.note] || ''].join('|');
    // Dva opravdu shodné pohyby v jednom souboru se odliší pořadím výskytu
    // téhož obsahu, ne pořadím řádku v souboru.
    const seen = (occurrences.get(content) || 0) + 1;
    occurrences.set(content, seen);
    const fingerprint = externalId ? null : `${content}|${seen}`;
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
