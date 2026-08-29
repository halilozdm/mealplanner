# Haftalık Menü (Mealplanner)

Small household tool: pick a meal per slot per day from a fixed meal list, download a printable landscape A4 PDF. Static site, no backend. Runs on GitHub Pages, works on iPhone and Android (add to home screen).

## Run locally

```
npx serve .
```

Open `http://localhost:3000`. To test on a phone, open `http://<laptop-ip>:3000` on the same wifi.

Tests (pure logic only):

```
node --test tests/planner.test.mjs
```

## Files

| Path | What |
| --- | --- |
| `index.html` | Markup + CSS, loads vendored jsPDF and `app.js` |
| `app.js` | Views (home, day wizard, recipe viewer), localStorage, share link |
| `planner.js` | Pure logic: plan model, hints, week dates, share link encode/decode |
| `pdf.js` | jsPDF + AutoTable week grid |
| `data/meals.json` | The meal library (the only thing you normally edit) |
| `data/rules.json` | Footer rules and labels for the PDF |
| `recipes/*.jpg` | Recipe cards shown by the "Tarif" button |
| `fonts/` | Noto Sans (Turkish glyphs in the PDF) |
| `vendor/` | jsPDF 2.5.2, jspdf-autotable 3.8.4 |

## Adding or changing a meal

Only the repo owner can do this; the app itself is read-only. Edit `data/meals.json` in the GitHub web editor and commit to `main`. Pages redeploys in about a minute. Then bump `VERSION` in `app.js` so phones refetch the JSON (or just hard refresh).

A meal looks like:

```json
{
  "id": "D23",
  "slot": "aksam",
  "category": "tavuk",
  "title": "Yeni tavuk yemeği",
  "lines": ["200 g tavuk göğsü", "Bol yeşillikli salata"],
  "maxPerWeek": 2,
  "tags": ["egg"],
  "recipe": "recipes/yeni-tavuk.jpg",
  "programs": [5]
}
```

- `id`: slot prefix + next free number. Prefixes: `K` kahvaltı, `T` ara öğün 1, `D` akşam, `L` ara öğün 2. Ids are printed on the PDF.
- `slot`: `kahvalti` | `ara1` | `aksam` | `ara2`.
- `category`: one of the keys listed under `categories` for that slot in the same file. Add a new category there if needed.
- `maxPerWeek` (optional): the weekly "2 kere" limit. Shows a counter and a warning when exceeded.
- `tags` (optional): `egg` (counts toward the 4 egg-breakfast days), `bowl` (breakfast that pairs with the sandwich snack), `sandwichSnack` (the labne/hindi füme snack).
- `recipe` (optional): path to an image in `recipes/`. Keep images around 1200px wide, JPEG.
- `programs`: reference only, which program(s) it came from.

`node --test tests/planner.test.mjs` validates the JSON (unique ids, valid slot/category, prefix).

## Deploy

Repo on GitHub, Settings > Pages > Deploy from branch `main`, folder `/ (root)`. That's it.

## Plan storage

The plan lives in the phone's localStorage. "Paylaş" produces a link with the whole plan encoded in the URL hash, open it on the other phone to import. The ⋯ menu offers "Rastgele doldur" (fills all 28 slots at random while respecting the rules) and "Haftayı temizle". The week can start on any weekday: pick a date in the header and the plan runs seven days from it. The "Tarifler" tab browses the whole meal library by slot and category.

## Meal images

Drop AI-generated meal photos into `images/` named by meal id (`K1.jpg`, `D3.png`, case-insensitive), then run `npm i --no-save sharp && node scripts/optimize-images.mjs`. It writes `images/<ID>.webp` (600px) and adds `"image"` to the meal in `data/meals.json`; bump `VERSION` in `app.js` afterwards. Originals are gitignored, only the WebP files are committed. Prompts live in `docs/image-prompts.md` (generated from `docs/image-prompts.json`).
