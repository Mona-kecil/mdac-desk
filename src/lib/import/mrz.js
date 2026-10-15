import { isISODate } from "../domain/validate.js";
export function checkDigit(value) {
  const weights = [7, 3, 1];
  return String(
    [...value].reduce(
      (sum, char, index) =>
        sum +
        (char === "<"
          ? 0
          : /\d/.test(char)
            ? Number(char)
            : char.charCodeAt(0) - 55) *
          weights[index % 3],
      0,
    ) % 10,
  );
}
function mrzDate(value, kind, now) {
  if (!/^\d{6}$/.test(value)) return "";
  const year = Number(value.slice(0, 2));
  const current = now.getUTCFullYear();
  let full = 2000 + year;
  if (kind === "birth" && full > current) full -= 100;
  if (kind === "expiry" && full < current - 50) full += 100;
  const iso = `${full}-${value.slice(2, 4)}-${value.slice(4, 6)}`;
  return isISODate(iso) ? iso : "";
}
export function parseMRZ(text, now = new Date()) {
  const lines = text
    .toUpperCase()
    .split(/\r?\n/)
    .map((line) => line.replace(/\s/g, ""))
    .filter((line) => /^[A-Z0-9<]{44}$/.test(line));
  const start = lines.findIndex((line) => line.startsWith("P"));
  const first = lines[start];
  const second = lines[start + 1];
  if (!first || !second)
    return {
      profile: {},
      issues: [
        "MRZ TD3 dua baris (44 karakter) tidak terbaca. Isi data secara manual.",
      ],
    };
  const issues = [];
  for (const [label, value, digit] of [
    ["nomor paspor", second.slice(0, 9), second[9]],
    ["tanggal lahir", second.slice(13, 19), second[19]],
    ["masa berlaku", second.slice(21, 27), second[27]],
    ["data tambahan", second.slice(28, 42), second[42]],
  ]) {
    if (
      !(label === "data tambahan" && digit === "<" && /^<+$/.test(value)) &&
      checkDigit(value) !== digit
    )
      issues.push(`Checksum ${label} tidak cocok. Periksa paspor asli.`);
  }
  if (
    checkDigit(
      second.slice(0, 10) + second.slice(13, 20) + second.slice(21, 43),
    ) !== second[43]
  )
    issues.push("Checksum gabungan MRZ tidak cocok.");
  const profile = {
    name: first.slice(5).replace(/<+/g, " ").trim(),
    passportNo: second.slice(0, 9).replace(/</g, ""),
    nationality: second.slice(10, 13),
    birthDate: mrzDate(second.slice(13, 19), "birth", now),
    passportExpiry: mrzDate(second.slice(21, 27), "expiry", now),
    sex: second[20] === "M" ? "1" : second[20] === "F" ? "2" : "",
  };
  if (!profile.birthDate) issues.push("Tanggal lahir MRZ tidak valid.");
  if (!profile.passportExpiry) issues.push("Tanggal berlaku MRZ tidak valid.");
  issues.push(
    "Negara kelahiran, email, dan telepon tidak ada pada MRZ. Isi dari sumber asli. Tinjau seluruh data sebelum menyimpan.",
  );
  return { profile, issues };
}
