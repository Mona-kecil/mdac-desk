export function mrzCrops(image) {
  if (image.width * image.height > 24_000_000)
    throw new Error(
      "Foto maksimal 24 megapiksel. Perkecil gambar lalu coba lagi.",
    );
  const scale = Math.min(2, 3200 / image.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * 0.5 * scale);
  const context = canvas.getContext("2d", {
    willReadFrequently: true,
    alpha: false,
  });
  context.fillStyle = "white";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(
    image,
    0,
    image.height * 0.5,
    image.width,
    image.height * 0.5,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const counts = new Uint32Array(canvas.height);
  for (let index = 0; index < pixels.data.length; index += 4) {
    const gray =
      pixels.data[index] * 0.299 +
      pixels.data[index + 1] * 0.587 +
      pixels.data[index + 2] * 0.114;
    const value = gray < 170 ? 0 : 255;
    pixels.data[index] = value;
    pixels.data[index + 1] = value;
    pixels.data[index + 2] = value;
    if (value === 0) counts[Math.floor(index / 4 / canvas.width)]++;
  }
  context.putImageData(pixels, 0, 0);
  const bands = [];
  for (let y = 0; y < counts.length; y++) {
    if (counts[y] < Math.max(12, canvas.width * 0.07)) continue;
    const previous = bands.at(-1);
    if (previous && y - previous.end < 5) previous.end = y;
    else bands.push({ start: y, end: y });
  }
  const lines = bands
    .filter((band) => band.end - band.start > 5)
    .slice(-2)
    .map((band) => {
      const line = document.createElement("canvas");
      line.width = canvas.width;
      line.height = band.end - band.start + 32;
      const target = line.getContext("2d");
      target.fillStyle = "white";
      target.fillRect(0, 0, line.width, line.height);
      target.drawImage(
        canvas,
        0,
        Math.max(0, band.start - 12),
        canvas.width,
        Math.min(canvas.height - band.start + 12, line.height),
        0,
        0,
        canvas.width,
        line.height,
      );
      return line;
    });
  return { canvas, lines };
}
