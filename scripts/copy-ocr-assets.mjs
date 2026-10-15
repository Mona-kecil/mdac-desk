import { cp, mkdir, readdir } from "node:fs/promises";
const destination = new URL("../static/ocr/", import.meta.url);
await mkdir(destination, { recursive: true });
await cp(
  new URL("../node_modules/tesseract.js/dist/worker.min.js", import.meta.url),
  new URL("worker.min.js", destination),
);
const core = new URL("../node_modules/tesseract.js-core/", import.meta.url);
for (const name of await readdir(core))
  if (/^tesseract-core.*\.(wasm|js)$/.test(name))
    await cp(new URL(name, core), new URL(name, destination));
await cp(
  new URL(
    "../node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz",
    import.meta.url,
  ),
  new URL("eng.traineddata.gz", destination),
);
