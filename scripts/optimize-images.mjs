// Convert images/<ID>.(jpg|jpeg|png) to images/<ID>.webp (600px, q80) and set
// "image": "images/<ID>.webp" on the matching meal in data/meals.json (textual
// insert, keeps the hand-written formatting). Re-running is idempotent.
// Usage: npm i --no-save sharp && node scripts/optimize-images.mjs
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const sharp = createRequire(import.meta.url)('sharp');

const SIZE = 600;
const src = readdirSync('images').filter((f) => /\.(jpe?g|png)$/i.test(f));
let json = readFileSync('data/meals.json', 'utf8');
const ids = new Set(JSON.parse(json).meals.map((m) => m.id));

let done = 0;
for (const f of src) {
  const id = f.replace(/\.[^.]+$/, '').toUpperCase();
  if (!ids.has(id)) { console.warn(`skip ${f}: no meal with id ${id}`); continue; }
  const out = `images/${id}.webp`;
  await sharp(`images/${f}`).resize(SIZE, SIZE, { fit: 'cover' }).webp({ quality: 80 }).toFile(out);
  const idLine = `"id": "${id}",`;
  if (!json.includes(`${idLine} "image": "${out}",`)) {
    json = json.replace(idLine, `${idLine} "image": "${out}",`);
  }
  done++;
}
writeFileSync('data/meals.json', json);
const n = JSON.parse(json).meals.filter((m) => m.image).length;
console.log(`${done} image(s) optimized, ${n} meals with image in meals.json`);
