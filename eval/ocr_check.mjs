import fs from 'node:fs/promises';
import path from 'node:path';
import { createWorker } from '../web/node_modules/tesseract.js/src/index.js';

const manifest = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
const worker = await createWorker(['eng', 'hin', 'mar'], 1, {
  corePath: path.resolve('public/ocr/tesseract-core-simd-lstm.wasm.js'),
  langPath: path.resolve('public/ocr'),
  gzip: true,
});
const distance = (a, b) => {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const old = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = old;
    }
  }
  return row[b.length];
};
try {
  let errors = 0;
  let characters = 0;
  let exact = 0;
  for (const sample of manifest) {
    await worker.setParameters({ tessedit_pageseg_mode: 6, lang: sample.language });
    const recognized = (await worker.recognize(sample.image)).data.text.trim();
    const expected = sample.text.replace(/\s+/gu, ' ').trim();
    const actual = recognized.replace(/\s+/gu, ' ').trim();
    const count = distance(expected, actual);
    errors += count;
    characters += expected.length;
    exact += expected === actual ? 1 : 0;
    console.log(`${sample.id}: ${expected === actual ? 'exact' : `${count} character errors`}`);
    console.log(`  expected: ${expected}`);
    console.log(`  OCR:      ${actual}`);
  }
  console.log(`Character accuracy: ${((1 - errors / characters) * 100).toFixed(1)}% (${characters - errors}/${characters})`);
  console.log(`Exact snippets: ${exact}/${manifest.length}`);
} finally {
  await worker.terminate();
}
