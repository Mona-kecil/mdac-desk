import { Parser } from "saxen";
import { PROFILE_FIELDS } from "../domain/schema.js";
import { validateProfile } from "../domain/validate.js";
import { unzipSync } from "fflate";
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_ROWS = 1000;
export const CSV_TEMPLATE = `${PROFILE_FIELDS.join(",")}\n`;
export const MAX_COLUMNS = 100;
export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  let closed = false;
  const pushField = () => {
    row.push(field);
    field = "";
    closed = false;
    if (row.length > MAX_COLUMNS)
      throw new Error(`Maksimal ${MAX_COLUMNS} kolom.`);
  };
  const pushRow = () => {
    pushField();
    if (row.some((value) => value !== "")) rows.push(row);
    row = [];
    if (rows.length > MAX_ROWS + 1)
      throw new Error(`Maksimal ${MAX_ROWS} baris penumpang.`);
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (closed && ![",", "\n", "\r"].includes(char))
      throw new Error("Ada teks setelah penutup tanda kutip CSV.");
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (quoted) {
        quoted = false;
        closed = true;
      } else if (!field) quoted = true;
      else throw new Error("Tanda kutip CSV tidak valid.");
    } else if (char === "," && !quoted) pushField();
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      pushRow();
    } else field += char;
  }
  if (quoted) throw new Error("Tanda kutip CSV belum ditutup.");
  pushRow();
  return rows;
}
export function preflightWorkbook(bytes) {
  let expanded = 0;
  let entries = 0;
  const xml = unzipSync(bytes, {
    filter(entry) {
      expanded += entry.originalSize;
      entries++;
      if (expanded > 32 * 1024 * 1024 || entries > 500)
        throw new Error(
          "Isi workbook melebihi batas ukuran atau jumlah berkas.",
        );
      return true;
    },
  });
  for (const bytes of Object.values(xml)) {
    const text = new TextDecoder().decode(bytes);
    if (!text.trimStart().startsWith("<")) continue;
    let rowCount = 0;
    let cellCount = 0;
    let rowCells = 0;
    let maxRow = 0;
    let maxColumn = 0;
    const parser = new Parser();
    const malformed = () => {
      throw new Error("XML workbook tidak valid.");
    };
    parser.on("error", malformed);
    parser.on("warn", malformed);
    parser.on("openTag", (name, getAttributes, decodeEntities) => {
      const localName = name.split(":").at(-1);
      if (!["row", "c"].includes(localName)) return;
      const attributes = getAttributes();
      const reference =
        attributes.r === undefined ? undefined : decodeEntities(attributes.r);
      if (localName === "row") {
        rowCount++;
        rowCells = 0;
        const number = reference === undefined ? rowCount : Number(reference);
        if (
          !Number.isInteger(number) ||
          number < 1 ||
          number > MAX_ROWS + 1 ||
          rowCount > MAX_ROWS + 1
        )
          throw new Error(
            "Referensi baris XLSX melebihi batas 1000 penumpang.",
          );
        maxRow = Math.max(maxRow, number);
      } else {
        cellCount++;
        rowCells++;
        if (rowCells > MAX_COLUMNS || cellCount > (MAX_ROWS + 1) * MAX_COLUMNS)
          throw new Error("Matriks XLSX melebihi batas kolom atau sel.");
        if (reference !== undefined) {
          const coordinate = /^([A-Z]+)([1-9]\d*)$/.exec(reference);
          if (!coordinate) throw new Error("Referensi sel XLSX tidak valid.");
          const column = [...coordinate[1]].reduce(
            (total, char) => total * 26 + char.charCodeAt(0) - 64,
            0,
          );
          const row = Number(coordinate[2]);
          if (column > MAX_COLUMNS || row > MAX_ROWS + 1)
            throw new Error(
              "Referensi sel XLSX melebihi batas baris atau 100 kolom.",
            );
          maxRow = Math.max(maxRow, row);
          maxColumn = Math.max(maxColumn, column);
        }
      }
      if (maxRow * maxColumn > (MAX_ROWS + 1) * MAX_COLUMNS)
        throw new Error("Matriks XLSX melebihi batas.");
    });
    parser.parse(text);
  }
}
export async function parseImport(file, mapping = {}) {
  if (!file || file.size > MAX_FILE_BYTES)
    throw new Error("Berkas maksimal 8 MB.");
  const extension = file.name.toLowerCase().split(".").pop();
  let cells;
  if (extension === "csv")
    cells = parseCSV((await file.text()).replace(/^\uFEFF/, ""));
  else if (extension === "xlsx") {
    const bytes = new Uint8Array(await file.arrayBuffer());
    preflightWorkbook(bytes);
    const { default: readXlsx } = await import("read-excel-file/browser");
    const sheets = await readXlsx(new Blob([bytes]));
    if (sheets.length !== 1)
      throw new Error("Gunakan workbook dengan satu lembar penumpang.");
    cells = sheets[0].data;
  } else
    throw new Error(
      "Gunakan berkas CSV atau XLSX. Format XLS lama tidak didukung.",
    );
  if (!cells.length) throw new Error("Berkas tidak memiliki baris.");
  if (cells.length > MAX_ROWS + 1)
    throw new Error(`Maksimal ${MAX_ROWS} baris penumpang.`);
  const headers = cells[0].map((value) => String(value ?? "").trim());
  if (new Set(headers).size !== headers.length)
    throw new Error("Nama kolom harus unik.");
  const warnings = [];
  const missing = PROFILE_FIELDS.filter(
    (field) => !headers.includes(mapping[field] || field),
  );
  if (missing.length)
    warnings.push(`Kolom belum dipetakan: ${missing.join(", ")}.`);
  const rows = cells.slice(1).map((values, index) => {
    const profile = {};
    const issues = [];
    for (const field of PROFILE_FIELDS) {
      const position = headers.indexOf(mapping[field] || field);
      const value = position === -1 ? "" : values[position];
      if (value instanceof Date) {
        profile[field] = "";
        issues.push(
          `${field}: gunakan teks YYYY-MM-DD, bukan format tanggal spreadsheet.`,
        );
      } else {
        profile[field] = String(value ?? "").trim();
        if (
          typeof value === "number" &&
          ["passportNo", "phone", "phoneCountry"].includes(field)
        )
          issues.push(
            `${field}: simpan sel sebagai teks agar angka nol tidak hilang.`,
          );
      }
    }
    profile.passportNo = profile.passportNo.toUpperCase();
    return {
      row: index + 2,
      profile,
      issues: [...issues, ...validateProfile(profile)],
    };
  });
  return { headers, rows, warnings };
}
