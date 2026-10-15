import { cp, mkdir, readdir, writeFile } from "node:fs/promises";
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
    "../node_modules/@tesseract.js-data/eng/4.0.0/eng.traineddata.gz",
    import.meta.url,
  ),
  new URL("eng.traineddata.gz", destination),
);

await cp(
  new URL("../node_modules/tesseract.js/LICENSE.md", import.meta.url),
  new URL("TESSERACT-LICENSE.txt", destination),
);
await cp(
  new URL("../node_modules/tesseract.js-core/LICENSE", import.meta.url),
  new URL("CORE-LICENSE.txt", destination),
);
await writeFile(
  new URL("NOTICE.txt", destination),
  "Tesseract.js and tesseract.js-core use Apache-2.0. Sources: https://github.com/naptha/tesseract.js and https://github.com/naptha/tesseract.js-core. English traineddata is supplied by @tesseract.js-data/eng from https://github.com/naptha/tessdata. This package declares MIT; upstream Tesseract traineddata uses Apache-2.0.\n",
);
