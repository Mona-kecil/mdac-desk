import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const source = await readFile(
  new URL("../src/lib/import/preprocess.js", import.meta.url),
  "utf8",
);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.route("**/*", (route) => route.abort());
  const result = await page.evaluate(async (source) => {
    const { mrzCrops } = await import(
      `data:text/javascript;base64,${btoa(source)}`
    );
    const original = document.createElement("canvas");
    original.width = 320;
    original.height = 240;
    const drawing = original.getContext("2d");
    drawing.fillStyle = "white";
    drawing.fillRect(80, 0, 160, 240);
    drawing.fillStyle = "black";
    drawing.fillRect(96, 150, 128, 12);
    drawing.fillRect(96, 200, 128, 12);
    const image = await createImageBitmap(original);
    const { canvas, lines } = mrzCrops(image);
    image.close();
    const pixels = canvas
      .getContext("2d")
      .getImageData(0, 0, canvas.width, canvas.height);
    const pixel = (x, y) => [
      ...pixels.data.slice(
        (y * canvas.width + x) * 4,
        (y * canvas.width + x) * 4 + 4,
      ),
    ];
    return {
      originalMargin: [...drawing.getImageData(0, 0, 1, 1).data],
      margin: pixel(0, 0),
      white: pixel(320, 10),
      text: pixel(200, 70),
      opaque: pixels.data.every(
        (value, index) => index % 4 !== 3 || value === 255,
      ),
      lines: lines.length,
    };
  }, source);
  assert.deepEqual(
    result.originalMargin,
    [0, 0, 0, 0],
    "fixture retains transparent sidebars",
  );
  assert.equal(
    result.lines,
    2,
    "transparent sidebars must not merge the two text bands",
  );
  assert.deepEqual(
    result.margin,
    [255, 255, 255, 255],
    "transparent margins become opaque white",
  );
  assert.deepEqual(
    result.white,
    [255, 255, 255, 255],
    "document white remains white",
  );
  assert.deepEqual(
    result.text,
    [0, 0, 0, 255],
    "dark text remains opaque black",
  );
  assert.equal(result.opaque, true, "every preprocessed pixel is opaque");
  console.log(
    "PASS: real Chromium canvas composites transparent sidebars onto white and retains two separate synthetic MRZ text bands. No OCR accuracy claim or network request.",
  );
} finally {
  await browser.close();
}
