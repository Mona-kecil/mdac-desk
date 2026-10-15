import { parseMRZ } from "./mrz.js";
import { mrzCrops } from "./preprocess.js";

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
