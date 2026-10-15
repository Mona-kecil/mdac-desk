import { options, cities, PROFILE_FIELDS } from './schema.js';
export function isISODate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(+date) && date.toISOString().slice(0, 10) === value;
}
export function malaysiaToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  return ['year','month','day'].map(type => parts.find(part => part.type === type).value).join('-');
}
export function arrivalRange(now = new Date()) {
  const min = malaysiaToday(now);
  const end = new Date(`${min}T12:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 2);
  return { min, max: end.toISOString().slice(0,10) };
}
const known = (list, value) => options[list].some(option => option.value === value);
export function validateProfile(profile, now = new Date()) {
  const issues = [];
  const labels = {name:'Nama',passportNo:'Nomor paspor',birthDate:'Tanggal lahir',nationality:'Kewarganegaraan',birthPlace:'Negara kelahiran',sex:'Jenis kelamin',passportExpiry:'Masa berlaku paspor',email:'Email',phoneCountry:'Kode telepon',phone:'Nomor telepon'};
  for (const key of PROFILE_FIELDS) if (typeof profile[key] !== 'string' || !profile[key].trim()) issues.push(`${labels[key]} wajib diisi.`);
  if (profile.passportNo && !/^[A-Z0-9]{3,20}$/i.test(profile.passportNo)) issues.push('Nomor paspor harus 3–20 huruf atau angka.');
  if (profile.birthDate && (!isISODate(profile.birthDate) || profile.birthDate > malaysiaToday(now))) issues.push('Tanggal lahir tidak valid. Gunakan YYYY-MM-DD.');
  if (profile.passportExpiry && (!isISODate(profile.passportExpiry) || profile.passportExpiry < malaysiaToday(now))) issues.push('Paspor sudah kedaluwarsa atau tanggal tidak valid.');
  if (profile.birthDate && profile.passportExpiry && profile.passportExpiry <= profile.birthDate) issues.push('Masa berlaku paspor harus setelah tanggal lahir.');
  for (const [field,list] of [['nationality','nationality'],['birthPlace','nationality'],['sex','sex'],['phoneCountry','region']]) if (profile[field] && !known(list,profile[field])) issues.push(`${labels[field]} tidak ada dalam pilihan MDAC.`);
  if (profile.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email)) issues.push('Alamat email tidak valid.');
  if (profile.phone && !/^\d{5,20}$/.test(profile.phone)) issues.push('Nomor telepon harus 5–20 angka tanpa kode negara.');
  return issues;
}
export function validateTrip(trip, now = new Date()) {
  const issues = [];
  const labels = {arrival:'Tanggal tiba',departure:'Tanggal berangkat',transportNo:'Nomor penerbangan/kendaraan',travelMode:'Moda perjalanan',embarkation:'Negara keberangkatan',accommodationKind:'Jenis penginapan',address1:'Alamat penginapan',state:'Negeri',city:'Kode kota',postcode:'Kode pos'};
  for (const key of Object.keys(labels)) if (typeof trip[key] !== 'string' || !trip[key].trim()) issues.push(`${labels[key]} wajib diisi.`);
  const range = arrivalRange(now);
  if (trip.arrival && (!isISODate(trip.arrival) || trip.arrival < range.min || trip.arrival > range.max)) issues.push(`Tanggal tiba harus ${range.min} sampai ${range.max} (waktu Malaysia).`);
  if (trip.departure && (!isISODate(trip.departure) || trip.departure < trip.arrival)) issues.push('Tanggal berangkat harus sama atau setelah tanggal tiba.');
  for (const [field,list] of [['travelMode','trvlMode'],['embarkation','nationality'],['accommodationKind','accommodationStay'],['state','accommodationState']]) if (trip[field] && !known(list,trip[field])) issues.push(`${labels[field]} tidak ada dalam pilihan MDAC.`);
  if (trip.address1 && trip.address1.trim().split(/\s+/).length < 3) issues.push('Alamat penginapan baris 1 harus memuat setidaknya 3 kata.');
  if (trip.city && !(cities[trip.state] || []).some(option => option.value === trip.city)) issues.push('Kota tidak cocok dengan negeri yang dipilih.');
  if (trip.postcode && !/^\d{5}$/.test(trip.postcode)) issues.push('Kode pos Malaysia harus 5 angka.');
  return issues;
}
export function fingerprint(profile, trip) {
  return [profile.nationality, profile.passportNo.trim().toUpperCase(), trip.arrival].join('|');
}
