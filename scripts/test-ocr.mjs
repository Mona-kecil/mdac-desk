import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createWorker } from "tesseract.js";

const cachePath = await mkdtemp(join(tmpdir(), "mdac-ocr-test-"));
let worker;
try {
  worker = await createWorker(
    "eng",
    0,
    {
      langPath: fileURLToPath(new URL("../static/ocr/", import.meta.url)),
      cachePath,
      legacyCore: true,
      legacyLang: true,
    },
    { load_system_dawg: "0", load_freq_dawg: "0" },
  );
  await worker.setParameters({
    tessedit_pageseg_mode: "6",
    tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<",
    user_defined_dpi: "300",
  });
  const { data } = await worker.recognize(
    fileURLToPath(
      new URL("../tests/fixtures/synthetic-mrz.png", import.meta.url),
    ),
    { rectangle: { left: 0, top: 650, width: 1500, height: 350 } },
  );
  const expected = await readFile(
    new URL("../tests/fixtures/synthetic-mrz.txt", import.meta.url),
    "utf8",
  );
  assert.equal(data.text.trim(), expected.trim());
  console.log(
    "PASS: local legacy Tesseract WASM reads both synthetic TD3 lines without substitutions. This model test does not replace browser crop and upload QA.",
  );
} finally {
  await worker?.terminate();
  await rm(cachePath, { recursive: true, force: true });
}
