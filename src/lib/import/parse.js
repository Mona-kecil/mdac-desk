import { PROFILE_FIELDS } from '../domain/schema.js';
import { validateProfile } from '../domain/validate.js';
import { unzipSync } from 'fflate';
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_ROWS = 1000;
export const CSV_TEMPLATE = `${PROFILE_FIELDS.join(',')}\n`;
export function parseCSV(text) {
  const rows = []; let row = []; let field = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i+1] === '"') {field += '"';i++;}
      else if (quoted || !field) quoted = !quoted;
      else throw new Error('Tanda kutip CSV tidak valid.');
    } else if (char === ',' && !quoted) {row.push(field);field='';}
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i+1] === '\n') i++;
      row.push(field); if (row.some(value => value !== '')) rows.push(row);
      row=[];field='';
    } else field += char;
  }
  if (quoted) throw new Error('Tanda kutip CSV belum ditutup.');
  row.push(field);if(row.some(value=>value!=='')) rows.push(row);
  return rows;
}
export async function parseImport(file, mapping = {}) {
  if (!file || file.size > MAX_FILE_BYTES) throw new Error('Berkas maksimal 8 MB.');
  const extension = file.name.toLowerCase().split('.').pop();
  let cells;
  if (extension === 'csv') cells = parseCSV((await file.text()).replace(/^\uFEFF/,''));
  else if (extension === 'xlsx') {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let expanded = 0;
    unzipSync(bytes,{filter(entry) {
      expanded += entry.originalSize;
      if (expanded > 32 * 1024 * 1024) throw new Error('Isi workbook melebihi 32 MB.');
      return false;
    }});
    const {default:readXlsx} = await import('read-excel-file/browser');
    const sheets = await readXlsx(new Blob([bytes]));
    if (sheets.length !== 1) throw new Error('Gunakan workbook dengan satu lembar penumpang.');
    cells = sheets[0].data;
  } else throw new Error('Gunakan berkas CSV atau XLSX. Format XLS lama tidak didukung.');
  if (!cells.length) throw new Error('Berkas tidak memiliki baris.');
  if (cells.length > MAX_ROWS + 1) throw new Error(`Maksimal ${MAX_ROWS} baris penumpang.`);
  const headers = cells[0].map(value => String(value ?? '').trim());
  if (new Set(headers).size !== headers.length) throw new Error('Nama kolom harus unik.');
  const warnings = [];
  const missing = PROFILE_FIELDS.filter(field => !headers.includes(mapping[field] || field));
  if (missing.length) warnings.push(`Kolom belum dipetakan: ${missing.join(', ')}.`);
  const rows = cells.slice(1).map((values,index) => {
    const profile = {}; const issues = [];
    for (const field of PROFILE_FIELDS) {
      const position = headers.indexOf(mapping[field] || field);
      const value = position === -1 ? '' : values[position];
      if (value instanceof Date) {
        profile[field] = '';
        issues.push(`${field}: gunakan teks YYYY-MM-DD, bukan format tanggal spreadsheet.`);
      } else {
        profile[field] = String(value ?? '').trim();
        if (typeof value === 'number' && ['passportNo','phone','phoneCountry'].includes(field)) issues.push(`${field}: simpan sel sebagai teks agar angka nol tidak hilang.`);
      }
    }
    profile.passportNo = profile.passportNo.toUpperCase();
    return {row:index+2,profile,issues:[...issues,...validateProfile(profile)]};
  });
  return {headers,rows,warnings};
}
