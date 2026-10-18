"use strict";
/*
 * The Hook covers family: six cover styles, the item slide and the close.
 * Schema and files first (no browser), then real renders through the layout check in every size.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const { LAYOUTS, SIZES, TEMPLATE_ORDER, HOOK_LAYOUTS, HOOK_LOOKS, HOOK_BACKGROUNDS, validateDeck } = require("../lib/deck-schema.js");
const { renderDeck, findChrome, pngSize } = require("../lib/render.js");
const { normalizeBrand } = require("../lib/brand.js");

const chrome = findChrome();
const noChrome = chrome ? false : "no Chrome, Chromium or Edge found (install one or set CHROME_BIN to run the render tests)";
const tmpDir = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `carousel-hook-${name}-`));
const neutral = () => normalizeBrand({}, null);
const COVERS = ["13-hook-scene", "14-hook-rule", "15-hook-split", "16-hook-footer", "17-hook-teaser", "18-hook-swipe"];
const BG_DIR = path.join(ROOT, "assets", "backgrounds");
const EXAMPLES = fs.readdirSync(path.join(ROOT, "examples")).filter((f) => /^hook-.*\.json$/.test(f)).sort();
const readExample = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, "examples", f), "utf8"));
const html = (id) => fs.readFileSync(path.join(ROOT, "kit", "layouts", id + ".html"), "utf8");

test("the hook family is six covers, an item slide and a close, in the hook group, after the classic ten", () => {
  assert.deepEqual([...HOOK_LAYOUTS], COVERS.concat(["19-hook-item", "20-hook-cta"]));
  assert.deepEqual(TEMPLATE_ORDER.slice(-8), [...HOOK_LAYOUTS]);
  assert.deepEqual([...HOOK_LOOKS], ["navy-orange", "noir-white", "red-blue", "noir-green", "noir-mint", "street-mint"]);
  // each cover opens in its own reference look, and the six covers use all six looks
  assert.deepEqual(COVERS.map((id) => LAYOUTS[id].look), [...HOOK_LOOKS]);
  for (const id of HOOK_LAYOUTS) {
    const spec = LAYOUTS[id];
    assert.equal(spec.group, "hook", id);
    assert.equal(spec.supportsBackground, true, id);
    assert.ok(HOOK_LOOKS.includes(spec.look), `${id}: look`);
    assert.deepEqual(spec.fields.look, { type: "enum", values: [...HOOK_LOOKS] }, id);
    assert.equal(spec.fields.brand_colors.type, "boolean", id);
    assert.equal(spec.fields.brand_fonts.type, "boolean", id);
    for (const f of ["kicker", "handle", "save"]) assert.equal(spec.fields[f].type, "text", `${id}: ${f}`);
  }
  for (const id of COVERS) for (const f of ["headline", "sub", "swipe"]) assert.equal(LAYOUTS[id].fields[f].type, "text", `${id}: ${f}`);
  assert.equal(LAYOUTS["19-hook-item"].fields.image.type, "image");
});

test("a hook slide validates its look and brand opt-ins, and accepts the *word* accent", () => {
  const ok = validateDeck({ slides: [{ layout: "15-hook-split", headline: "7 tools that make you\n*wonder why they're free.*", look: "noir-green", brand_colors: true, brand_fonts: false, show_counter: true }] });
  assert.deepEqual([ok.ok, ok.errors, ok.warnings], [true, [], []]);
  assert.equal(validateDeck({ slides: [{ layout: "15-hook-split", headline: "x", look: "purple" }] }).ok, false);
  assert.equal(validateDeck({ slides: [{ layout: "15-hook-split", headline: "x", brand_colors: "yes" }] }).ok, false);
  assert.equal(validateDeck({ slides: [{ layout: "19-hook-item", what: "No name" }] }).ok, false);
  assert.match(validateDeck({ slides: [{ layout: "16-hook-footer", headline: "Five \u2014 tools" }] }).errors.join(), /em dash/);
});

test("every hook template loads kit/hooks.css and kit/hooks.js before kit.js and opens in its own look", () => {
  const setup = fs.readFileSync(path.join(ROOT, "kit", "hooks.js"), "utf8");
  const css = fs.readFileSync(path.join(ROOT, "kit", "hooks.css"), "utf8");
  // hooks.js knows the same looks as the schema, and every look has a palette
  const looks = JSON.parse(setup.match(/var LOOKS = (\[[^\]]*\])/)[1].replace(/'/g, '"'));
  assert.deepEqual(looks, [...HOOK_LOOKS]);
  for (const look of HOOK_LOOKS) assert.match(css, new RegExp(`\\[data-look="${look}"\\]`), `hooks.css has no palette for ${look}`);
  for (const f of ["look", "brand_colors", "brand_fonts", "show_counter", "tint"]) assert.ok(setup.includes(f), `hooks.js does not read ${f}`);
  for (const id of HOOK_LAYOUTS) {
    const page = html(id);
    assert.ok(page.indexOf('href="../hooks.css"') > page.indexOf('href="../tokens.css"'), `${id}: hooks.css after tokens.css`);
    assert.ok(page.indexOf('src="../hooks.js"') > 0 && page.indexOf('src="../hooks.js"') < page.indexOf('src="../kit.js"'), `${id}: hooks.js before kit.js`);
    assert.match(page, new RegExp(`<main class="slide hook [^"]*" data-bg="photo" data-no-chrome data-look="${LAYOUTS[id].look}">`), id);
    for (const part of ['class="hook-count"', 'data-field="handle"', 'data-field="save"', 'data-field="kicker"']) assert.ok(page.includes(part), `${id}: ${part}`);
    if (COVERS.includes(id)) assert.ok(page.includes('data-field="swipe"') && page.includes('data-field="sub"'), `${id}: swipe and sub`);
  }
});

test("the hook fonts ship with their licences and notice", () => {
  const faces = fs.readFileSync(path.join(ROOT, "kit", "fonts.css"), "utf8");
  const notice = fs.readFileSync(path.join(ROOT, "kit", "fonts", "FONTS-NOTICE.txt"), "utf8");
  for (const [family, file, ofl] of [["Hook Anton", "Anton.woff", "OFL-Anton.txt"], ["Hook Montserrat", "Montserrat-Heavy.woff", "OFL-Montserrat.txt"], ["Hook Inter", "Inter-Heavy.woff", "OFL-Inter.txt"]]) {
    assert.match(faces, new RegExp(`font-family:'${family}'[^}]*fonts/${file.replace(".", "\\.")}`), family);
    const font = fs.readFileSync(path.join(ROOT, "kit", "fonts", file));
    assert.equal(font.subarray(0, 4).toString("latin1"), "wOFF", `${file} is a WOFF file`);
    assert.ok(font.length < 80 * 1024, `${file} is small`);
    assert.ok(notice.includes(file), `the notice names ${file}`);
    assert.match(fs.readFileSync(path.join(ROOT, "kit", "fonts", ofl), "utf8"), /SIL OPEN FONT LICENSE Version 1\.1/);
  }
});

test("every cover's bundled background exists, is a small JPEG, is in PROVENANCE.md and is used by an example deck", () => {
  const files = fs.readdirSync(BG_DIR).filter((f) => f.endsWith(".jpg")).sort();
  const provenance = fs.readFileSync(path.join(BG_DIR, "PROVENANCE.md"), "utf8");
  assert.deepEqual(Object.keys(HOOK_BACKGROUNDS), COVERS, "each cover has one bundled background");
  assert.deepEqual(Object.values(HOOK_BACKGROUNDS).map((rel) => path.basename(rel)).sort(), files, "every bundled image belongs to a cover, and nothing else is in the folder");
  const usedByExamples = new Set();
  for (const f of EXAMPLES) for (const s of readExample(f).slides) {
    for (const src of [s.background && s.background.src, s.image]) if (src) usedByExamples.add(path.basename(src));
  }
  for (const rel of Object.values(HOOK_BACKGROUNDS)) {
    const file = path.join(ROOT, rel), name = path.basename(rel);
    const buf = fs.readFileSync(file);
    assert.equal(buf.subarray(0, 3).toString("hex"), "ffd8ff", `${name} is a JPEG`);
    assert.ok(buf.length < 250 * 1024, `${name} is ${Math.round(buf.length / 1024)} KB, keep backgrounds under 250 KB`);
    assert.ok(!/Exif|XMP|C2PA|jumb/.test(buf.subarray(0, 4096).toString("latin1")), `${name} carries metadata`);
    assert.ok(provenance.includes(`| ${name} |`), `${name} is not in PROVENANCE.md`);
    assert.ok(usedByExamples.has(name), `${name} is not used by any example deck`);
  }
  assert.match(provenance, /no real person, face, trademark, logo, mascot or readable text/);
  assert.ok(!/\u2014/.test(provenance), "PROVENANCE.md has an em dash");
});

test("there is one example deck per cover style, each valid with no warnings and every image path real", () => {
  assert.equal(EXAMPLES.length, 6);
  assert.deepEqual(EXAMPLES.map((f) => readExample(f).slides[0].layout).sort(), [...COVERS].sort());
  for (const f of EXAMPLES) {
    const deck = readExample(f);
    const res = validateDeck(deck);
    assert.deepEqual([res.ok, res.errors, res.warnings], [true, [], []], f);
    assert.ok(deck.slides.every((s) => HOOK_LAYOUTS.includes(s.layout)), `${f}: hook templates only`);
    assert.equal(deck.slides[deck.slides.length - 1].layout, "20-hook-cta", `${f}: ends on the close`);
    assert.ok(deck.slides.some((s) => s.layout === "19-hook-item"), `${f}: has item slides`);
    assert.ok(HOOK_LOOKS.includes(deck.defaults.look), `${f}: one look for the deck`);
    for (const s of deck.slides) for (const src of [s.background && s.background.src, s.image]) {
      if (src) assert.ok(fs.existsSync(path.resolve(ROOT, "examples", src)), `${f}: ${src} does not exist`);
    }
    // generic, editable sample copy: no creator names or handles from the reference posts
    assert.ok(!/bitbyybit|tech origin|syntaix|sebastianhardy|bestapps|theopenstack|github|claude/i.test(JSON.stringify(deck)), `${f}: names a real creator or brand`);
  }
});

/* ---------- real renders ---------- */
const hookDeck = (slides) => ({ title: "Hook", slides });

for (const size of Object.keys(SIZES)) {
  test(`every hook template's sample renders in ${size} on its own background and passes the layout check`, { skip: noChrome }, async () => {
    const dir = tmpDir(`family-${size}`);
    try {
      const slides = HOOK_LAYOUTS.map((id) => JSON.parse(JSON.stringify(LAYOUTS[id].sampleSlide)));
      const res = await renderDeck(hookDeck(slides), { outDir: path.join(dir, "out"), size, brand: neutral(), dataDir: dir, chromePath: chrome });
      assert.equal(res.ok, true, res.qa.issues.join("; "));
      assert.deepEqual(res.warnings, []);
      assert.equal(res.files.length, HOOK_LAYOUTS.length);
      for (const s of res.slides) {
        assert.equal(s.ok, true, `${s.layout}: ${s.issues.join("; ")}`);
        assert.ok(s.textElements > 0, `${s.layout}: no text was rendered`);
        for (const [box, scale] of Object.entries(s.fitScales)) assert.ok(scale >= 0.9, `${s.layout}: ${box} shrank to ${scale} in ${size}`);
      }
      for (const f of res.files) assert.deepEqual(pngSize(f), { w: SIZES[size].w, h: SIZES[size].h });
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}

test("every hook template takes copy at its word caps with every option on, and the barest copy, in every size", { skip: noChrome }, async () => {
  const dir = tmpDir("caps");
  try {
    const pool = ["workflow", "notes", "free", "tools", "screen", "record", "forms", "quick", "setup", "every", "weekly", "simple"];
    const words = (n, from = 0) => Array.from({ length: n }, (_, i) => pool[(i + from) % pool.length]).join(" ");
    const long = HOOK_LAYOUTS.map((id) => {
      const spec = LAYOUTS[id], slide = { layout: id, show_counter: true };
      for (const [name, field] of Object.entries(spec.fields)) if (field.type === "text") slide[name] = words(spec.wordCaps[name]);
      if (slide.handle) slide.handle = "@yourhandle";
      if (slide.number) slide.number = "10";
      if (id === "19-hook-item") slide.image = path.join(ROOT, "assets", "backgrounds", "hook-noir-desk.jpg");
      return slide;
    });
    const short = HOOK_LAYOUTS.map((id) => (id === "19-hook-item" ? { layout: id, name: "Notes" } : { layout: id, headline: "*Go.*" }));
    for (const size of Object.keys(SIZES)) {
      const res = await renderDeck(hookDeck(long.concat(short)), { outDir: path.join(dir, size), size, brand: neutral(), baseDir: ROOT, dataDir: dir, chromePath: chrome });
      assert.deepEqual(res.warnings.filter((w) => /the cap is/.test(w)), [], "the long copy is inside the caps");
      assert.equal(res.ok, true, `${size}: ${res.qa.issues.join("; ")}`);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("every hook example deck renders through the layout check with its bundled backgrounds", { skip: noChrome }, async () => {
  const dir = tmpDir("examples");
  try {
    for (const f of EXAMPLES) {
      const deck = readExample(f);
      const res = await renderDeck(deck, { outDir: path.join(dir, f), brand: neutral(), baseDir: path.join(ROOT, "examples"), dataDir: dir, chromePath: chrome });
      assert.equal(res.ok, true, `${f}: ${res.qa.issues.join("; ")}`);
      assert.equal(res.files.length, deck.slides.length);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("the bundled background, the look and the brand opt-ins each change the picture", { skip: noChrome }, async () => {
  const dir = tmpDir("options");
  try {
    const base = { layout: "14-hook-rule", kicker: "Your brand", headline: "Ten free tools" };
    const warm = normalizeBrand({ colors: { bg: "#F7F0E4", bgDeep: "#F0E6D5", bgAlt: "#E9DBC5", text: "#2A1F17", accent: "#C2542D", accentSoft: "#B0471F", highlight: "#7A2E12" } }, null);
    const variants = [base, Object.assign({}, base, { background: "" }), Object.assign({}, base, { look: "red-blue" }), Object.assign({}, base, { brand_colors: true }), Object.assign({}, base, { brand_fonts: true })];
    const res = await renderDeck(hookDeck(variants), { outDir: path.join(dir, "out"), brand: warm, dataDir: dir, chromePath: chrome });
    assert.equal(res.ok, true, res.qa.issues.join("; "));
    const bytes = res.files.map((f) => fs.readFileSync(f));
    for (let i = 1; i < bytes.length; i++) assert.notEqual(Buffer.compare(bytes[0], bytes[i]), 0, `variant ${i} changed nothing`);
    // a slide's own background replaces the bundled one
    const own = await renderDeck(hookDeck([Object.assign({}, base, { background: { src: "hook-press-night.jpg", tint: 0.3 } })]),
      { outDir: path.join(dir, "own"), brand: warm, baseDir: BG_DIR, dataDir: dir, chromePath: chrome });
    assert.equal(own.ok, true, own.qa.issues.join("; "));
    assert.notEqual(Buffer.compare(bytes[0], fs.readFileSync(own.files[0])), 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("the counter pill and footer add their text, a stray photo is dropped, and an image outside the allowed folders is refused", { skip: noChrome }, async () => {
  const dir = tmpDir("guards"), outside = tmpDir("outside");
  try {
    const plain = { layout: "16-hook-footer", headline: "Six free tools" };
    const res = await renderDeck(hookDeck([plain, Object.assign({}, plain, { show_counter: true }), Object.assign({}, plain, { handle: "@yourhandle", save: "Save for later" }),
      Object.assign({}, plain, { photo: "not-a-real-file.jpg" })]), { outDir: path.join(dir, "out"), brand: neutral(), dataDir: dir, chromePath: chrome });
    assert.equal(res.ok, true, res.qa.issues.join("; "));
    const [a, counted, footed, stray] = res.slides;
    assert.equal(counted.textElements, a.textElements + 1, "the counter pill is one more line of text");
    assert.equal(footed.textElements, a.textElements + 2, "the footer is the handle and the save line");
    assert.equal(stray.textElements, a.textElements);

    // the item's screenshot goes through the same allowlist as every other image
    const file = path.join(outside, "shot.jpg");
    fs.copyFileSync(path.join(BG_DIR, "hook-noir-desk.jpg"), file);
    const refused = await renderDeck(hookDeck([{ layout: "19-hook-item", name: "Notes", image: file }]), { outDir: path.join(dir, "refused"), brand: neutral(), baseDir: dir, dataDir: dir, chromePath: chrome });
    assert.equal(refused.ok, false);
    assert.match(refused.qa.issues.join("; "), /outside the allowed folders/);
  } finally { for (const d of [dir, outside]) fs.rmSync(d, { recursive: true, force: true }); }
});

test("unattended text-only renders skip the bundled background and still pass", { skip: noChrome }, () => {
  const { spawnSync } = require("node:child_process");
  const dir = tmpDir("textonly");
  try {
    const run = spawnSync(process.execPath, [path.join(ROOT, "render.mjs"), "--template", "14-hook-rule", "--out", path.join(dir, "one.png"), "--data-dir", dir, "--result", path.join(dir, "result.json")],
      { cwd: ROOT, encoding: "utf8", env: Object.assign({}, process.env, { CHROME_BIN: chrome, CAROUSEL_UNATTENDED_TEXT_ONLY: "1" }) });
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(pngSize(path.join(dir, "one.png")), { w: 1080, h: 1350 });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
