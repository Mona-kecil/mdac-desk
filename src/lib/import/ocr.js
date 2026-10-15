import { parseMRZ } from "./mrz.js";

function mrzCrops(image) {
  if (image.width * image.height > 24_000_000)
    throw new Error(
      "Foto maksimal 24 megapiksel. Perkecil gambar lalu coba lagi.",
    );
  const scale = Math.min(2, 3200 / image.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * 0.5 * scale);
  const context = canvas.getContext("2d", { willReadFrequently: true });
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

export async function readPassport(file, onProgress = () => {}) {
  if (!file || file.size > 12 * 1024 * 1024)
    throw new Error("Foto paspor maksimal 12 MB.");
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new Error("Gunakan gambar JPG, PNG, atau WebP.");
  const image = await createImageBitmap(file);
  let crops;
  try {
    crops = mrzCrops(image);
  } finally {
    image.close();
  }
  const { createWorker } = await import("tesseract.js");
  const base = new URL("/ocr/", location.origin).href;
  const worker = await createWorker(
    "eng",
    0,
    {
      workerPath: base + "worker.min.js",
      corePath: base,
      langPath: base,
      workerBlobURL: false,
      legacyCore: true,
      legacyLang: true,
      cachePath: "mdac-desk-eng-legacy-v1",
      logger: (message) => onProgress(message.progress || 0),
    },
    { load_system_dawg: "0", load_freq_dawg: "0" },
  );
  try {
    await worker.setParameters({
      tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<",
      preserve_interword_spaces: "0",
      tessedit_pageseg_mode: "6",
      user_defined_dpi: "300",
    });
    const { data: cropped } = await worker.recognize(crops.canvas);
    const candidates = [cropped];
    if (crops.lines.length === 2) {
      await worker.setParameters({ tessedit_pageseg_mode: "7" });
      const lines = [];
      let confidence = 0;
      for (const line of crops.lines) {
        const { data } = await worker.recognize(line);
        lines.push(data.text.trim());
        confidence += data.confidence;
      }
      candidates.push({ text: lines.join("\n"), confidence: confidence / 2 });
    }
    const ranked = candidates
      .map((data) => ({
        ...parseMRZ(data.text),
        text: data.text,
        confidence: data.confidence,
      }))
      .sort((a, b) => {
        const score = (value) =>
          Object.values(value.profile).filter(Boolean).length * 10 -
          value.issues.filter(
            (issue) =>
              issue.includes("Checksum") || issue.includes("tidak valid"),
          ).length;
        return score(b) - score(a);
      });
    if (Object.keys(ranked[0].profile).length === 0) {
      await worker.setParameters({ tessedit_pageseg_mode: "6" });
      const { data } = await worker.recognize(file);
      const full = {
        ...parseMRZ(data.text),
        text: data.text,
        confidence: data.confidence,
      };
      if (Object.keys(full.profile).length) return full;
    }
    return ranked[0];
  } finally {
    await worker.terminate();
  }
}
