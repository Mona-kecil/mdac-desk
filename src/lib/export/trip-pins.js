import { TRIP_FIELDS } from '../domain/schema.js';

export function groupTrips(submissions) {
  const groups = new Map();
  for (const item of submissions) {
    const key = JSON.stringify(TRIP_FIELDS.map(field => item.tripSnapshot[field] || ''));
    if (!groups.has(key)) groups.set(key, { key, trip: item.tripSnapshot, submissions: [] });
    groups.get(key).submissions.push(item);
  }
  return [...groups.values()];
}

export function tripPinRows(submissions) {
  return submissions.map(item => ({ name: item.profileSnapshot.name, pin: item.receipt?.reference || '' }));
}

function lines(context, text, width) {
  const result = [];
  let line = '';
  for (const character of text) {
    if (line && context.measureText(line + character).width > width) {
      result.push(line);
      line = '';
    }
    line += character;
  }
  return [...result, line];
}

export async function tripPinsImage(group) {
  const rows = tripPinRows(group.submissions);
  if (!rows.length) throw Error('Perjalanan ini belum memiliki penumpang.');
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw Error('Browser ini belum dapat membuat gambar. Gunakan ekspor cadangan JSON.');
  const width = 1080, gap = 24, margin = 32, padding = 32;
  const columns = rows.length === 1 ? 1 : 2;
  const cardWidth = (width - margin * 2 - gap * (columns - 1)) / columns;
  const textWidth = cardWidth - padding * 2;
  const nameFont = '600 28px system-ui, sans-serif';
  const pinFont = '500 44px ui-monospace, SFMono-Regular, Consolas, monospace';
  const cards = rows.map(row => {
    context.font = nameFont;
    const name = lines(context, row.name, textWidth);
    context.font = row.pin ? pinFont : '24px system-ui, sans-serif';
    return { name, pin: lines(context, row.pin || 'Belum dicatat', textWidth), recorded: Boolean(row.pin) };
  });
  const bands = [];
  let height = margin;
  for (let index = 0; index < cards.length; index += columns) {
    const band = cards.slice(index, index + columns);
    const nameHeight = Math.max(...band.map(card => card.name.length)) * 36;
    const cardHeight = padding * 2 + nameHeight + 24 + 20 + 8 + Math.max(...band.map(card => card.pin.length)) * 56;
    bands.push({ cards: band, y: height, nameHeight, height: cardHeight });
    height += cardHeight + gap;
  }
  canvas.width = width;
  canvas.height = height - gap + margin;
  context.fillStyle = '#eef4f1';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.textBaseline = 'top';
  for (const band of bands) for (const [column, card] of band.cards.entries()) {
    const x = margin + column * (cardWidth + gap), y = band.y;
    context.fillStyle = '#ffffff';
    context.beginPath();
    context.roundRect(x, y, cardWidth, band.height, 20);
    context.fill();
    context.fillStyle = '#18343b';
    context.font = nameFont;
    card.name.forEach((line, index) => context.fillText(line, x + padding, y + padding + index * 36));
    const labelY = y + padding + band.nameHeight + 24;
    context.fillStyle = '#56706b';
    context.font = '500 18px system-ui, sans-serif';
    context.fillText('PIN', x + padding, labelY);
    context.fillStyle = card.recorded ? '#075e55' : '#56706b';
    context.font = card.recorded ? pinFont : '24px system-ui, sans-serif';
    card.pin.forEach((line, index) => context.fillText(line, x + padding, labelY + 28 + index * 56));
  }
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw Error('Gambar belum dapat dibuat. Coba ekspor lagi.');
  const transport = group.trip.transportNo.replace(/[^A-Za-z0-9-]+/g, '-');
  return { blob, name: `mdac-nama-pin-${group.trip.arrival}-${transport}.png` };
}
