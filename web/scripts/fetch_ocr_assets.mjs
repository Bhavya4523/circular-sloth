import { mkdir, copyFile, readdir, writeFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "public", "ocr");
const require = createRequire(import.meta.url);
const tesseractRoot = path.dirname(require.resolve("tesseract.js/package.json"));
const coreRoot = path.dirname(require.resolve("tesseract.js-core/package.json"));
const pdfRoot = path.dirname(require.resolve("pdfjs-dist/package.json"));
await mkdir(out, { recursive: true });
await copyFile(path.join(tesseractRoot, "dist", "worker.min.js"), path.join(out, "worker.min.js"));
await copyFile(path.join(pdfRoot, "build", "pdf.worker.min.mjs"), path.join(root, "public", "pdf.worker.min.mjs"));
for (const file of await readdir(coreRoot)) {
  if (/^tesseract-core.*\.(?:js|wasm)$/.test(file)) {
    await copyFile(path.join(coreRoot, file), path.join(out, file));
  }
}

const base = "https://tessdata.projectnaptha.com/4.0.0";
for (const language of ["eng", "hin", "mar"]) {
  const destination = path.join(out, `${language}.traineddata.gz`);
  try { if ((await stat(destination)).size > 100_000) continue; } catch { /* Fetch missing build asset. */ }
  const response = await fetch(`${base}/${language}.traineddata.gz`);
  if (!response.ok) throw new Error(`Could not fetch OCR language data (${language}, HTTP ${response.status})`);
  await writeFile(destination, new Uint8Array(await response.arrayBuffer()));
  process.stdout.write(`Fetched OCR language data: ${language}\n`);
}
