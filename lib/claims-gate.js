"use strict";

// Claims gate for shared content tools (Carousel Builder, Video Editor,
// Content Studio). The same bytes ship in every tool that carries it.
//
// When it applies (the enforcement rule):
//   1. Candidate install roots: every folder above THIS file's own folder
//      (symlinks resolved) that holds .allsorted-target.json. A copy placed
//      outside the install root by an installer (a skill folder) also follows
//      its studio-root file to the studio it came from and adds the roots
//      above that. No candidate: the gate does not apply.
//   2. The gate applies when ANY candidate root holds a peptide-claims entry
//      (the Claims Check module is installed), OR its
//      allsorted-dist.lock.json sets product.contentClaimsGate, OR that lock
//      exists but cannot be read (fail closed). The topmost such root above
//      the tool that has the module holds the checker and the state folder,
//      so a folder nested inside an install cannot bring its own checker.
//   3. Nothing else turns it on or off: no environment variable, no option,
//      no argument. A caller cannot pass a different folder to look from.
//
// When it applies, publishing or exporting refuses unless every piece of
// content has a receipt that passes
//   peptide-claims verify --receipt <r> --file <f> --kind <k> --strict --state-dir <root>/.peptide-claims-state
// The tool writes the exact text of each piece to a file, the agent gates
// that file (rubric, gate), and the tool verifies the receipt again at the
// moment of publishing or exporting. This file never runs the gate itself,
// never answers the rubric and never writes an owner's reason.
//
// When it does not apply (All Sorted), nothing here runs and the tools behave
// exactly as before.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const MARKER = ".allsorted-target.json";
const LOCK = "allsorted-dist.lock.json";
const MODULE = "peptide-claims";
const STATE = ".peptide-claims-state";
const KINDS = ["caption", "carousel", "video-script", "transcript", "ad", "email", "page", "other"];
const PASS_LABEL = "No listed wording found";
const PASS_SENTENCE = "This is a wording check, not a clearance: a person must still read every piece before it goes out.";
const MAX_TEXT = 2000000;

function exists(file) {
  try {
    fs.lstatSync(file);
    return true;
  } catch {
    return false;
  }
}

function isPlainFile(file) {
  try {
    return fs.lstatSync(file).isFile();
  } catch {
    return false;
  }
}

// Every folder above fromDir (symlinks resolved) that holds the install
// marker, nearest first.
function markerRootsAbove(fromDir) {
  const roots = [];
  let current;
  try {
    current = fs.realpathSync(fromDir);
  } catch {
    return roots;
  }
  for (;;) {
    if (exists(path.join(current, MARKER))) roots.push(current);
    const parent = path.dirname(current);
    if (parent === current) return roots;
    current = parent;
  }
}

// Candidate install roots for this tool: every marker folder above it, and,
// for a copy an installer placed outside the install root (a skill folder in
// the home folder), every marker folder above the Content Studio named by a
// studio-root file above it. More candidates can only turn the gate on: a
// nearer marker never hides a root further up.
function candidateRoots(fromDir) {
  const roots = markerRootsAbove(fromDir);
  let current;
  try {
    current = fs.realpathSync(fromDir);
  } catch {
    return roots;
  }
  for (;;) {
    const pointer = path.join(current, "studio-root");
    if (isPlainFile(pointer)) {
      let named = "";
      try {
        named = fs.readFileSync(pointer, "utf8").trim();
      } catch {
        named = "";
      }
      if (named && path.isAbsolute(named)) for (const root of markerRootsAbove(named)) if (!roots.includes(root)) roots.push(root);
    }
    const parent = path.dirname(current);
    if (parent === current) return roots;
    current = parent;
  }
}

function findInstallRoot(fromDir) {
  return candidateRoots(fromDir)[0] || null;
}

function rootState(root) {
  const installed = exists(path.join(root, MODULE));
  let lockSays = false;
  let lockUnreadable = false;
  const lockFile = path.join(root, LOCK);
  if (exists(lockFile)) {
    try {
      const lock = JSON.parse(fs.readFileSync(lockFile, "utf8"));
      const value = lock && typeof lock === "object" && lock.product && typeof lock.product === "object" ? lock.product.contentClaimsGate : undefined;
      lockSays = value !== undefined && value !== null && value !== false && value !== "";
    } catch {
      lockUnreadable = true;
    }
  }
  const reasons = [];
  if (installed) reasons.push("the Claims Check module is installed");
  if (lockSays) reasons.push("the install lock turns the claims gate on");
  if (lockUnreadable) reasons.push("the install lock could not be read, so the gate stays on");
  return { root, installed, enforced: installed || lockSays || lockUnreadable, reasons };
}

// The rule, worked out from where this file is installed. Never cached: an
// install that adds peptide-claims takes effect on the next call. The gate is
// on when ANY candidate root qualifies; the topmost one above this file that
// does (one that has the module first) holds the checker and the state folder.
function enforcement() {
  const direct = markerRootsAbove(__dirname);
  const states = candidateRoots(__dirname).map(rootState);
  if (!states.length) return { enforced: false, root: null, reason: "not inside an install root" };
  const on = states.filter((state) => state.enforced);
  if (!on.length) return { enforced: false, root: states[0].root, reason: "this install does not use the claims gate" };
  // By ancestry: the topmost root above this file first, then roots named by a
  // studio-root pointer; one that has the module before one that does not.
  const rank = (state) => (direct.includes(state.root) ? -direct.indexOf(state.root) : direct.length);
  const best = (list) => list.slice().sort((a, b) => rank(a) - rank(b))[0];
  const chosen = best(on.filter((state) => state.installed)) || best(on);
  const cli = path.join(chosen.root, MODULE, "bin", "peptide-claims.js");
  return {
    enforced: true,
    root: chosen.root,
    reason: chosen.reasons.join("; "),
    cli,
    cliPresent: isPlainFile(cli),
    stateDir: path.join(chosen.root, STATE),
  };
}

function receiptPathFor(file) {
  return `${file}.receipt.json`;
}

// Writes the exact text of one piece to <dir>/<name>.txt. The bytes are only
// replaced when they differ, so an unchanged piece keeps its receipt, and a
// changed one no longer matches it. A link at that name is removed, never
// followed.
function writePiece(dir, name, text) {
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(String(name))) throw new Error(`Bad claims piece name: ${name}`);
  const body = String(text === undefined || text === null ? "" : text);
  if (Buffer.byteLength(body, "utf8") > MAX_TEXT) throw new Error(`The ${name} text is over 2,000,000 bytes and cannot be checked.`);
  try {
    const stat = fs.lstatSync(dir);
    if (!stat.isDirectory()) throw new Error("not a folder");
  } catch (error) {
    if (error && error.code === "ENOENT") fs.mkdirSync(dir, { recursive: true });
    else throw new Error(`The claims folder ${dir} is not a plain folder.`);
  }
  const file = path.join(dir, `${name}.txt`);
  const bytes = Buffer.from(body, "utf8");
  let stat = null;
  try {
    stat = fs.lstatSync(file);
  } catch {
    stat = null;
  }
  if (stat && !stat.isFile()) {
    if (stat.isDirectory()) throw new Error(`${file} is a folder, not a text file.`);
    fs.unlinkSync(file);
    stat = null;
  }
  if (!stat || !fs.readFileSync(file).equals(bytes)) fs.writeFileSync(file, bytes);
  return file;
}

// Keys that never hold words a reader sees: layout names, file paths, colours,
// sizes and switches. Everything else that is text is collected.
const NOT_TEXT = /^(_.*|layout|template|photo|avatar|logo|image|images|background|bg|src|href|url|link|file|path|tint|size|ratio|width|height|align|theme|style|variant|color|colour|font|fontSize|id|creative|creative_id|cta_type|callToAction|status|pageId|showCta|slide|total)$/i;

function collectText(value, out = [], key = "") {
  if (key && NOT_TEXT.test(key)) return out;
  if (typeof value === "string") {
    const text = value.trim();
    if (text) out.push(text);
  } else if (typeof value === "number" && key) {
    out.push(String(value));
  } else if (Array.isArray(value)) {
    for (const item of value) collectText(item, out, "");
  } else if (value && typeof value === "object") {
    for (const name of Object.keys(value)) collectText(value[name], out, name);
  }
  return out;
}

// The words of a carousel, slide by slide, the same way every time, then the
// brand words the renderer draws on slides (byline, name).
function deckText(deck, brand) {
  const lines = [];
  const title = deck && typeof deck.title === "string" ? deck.title.trim() : "";
  if (title) lines.push(title, "");
  const slides = deck && Array.isArray(deck.slides) ? deck.slides : [];
  slides.forEach((slide, index) => {
    lines.push(`Slide ${index + 1}`);
    lines.push(...collectText(slide));
    lines.push("");
  });
  const brandWords = brand && typeof brand === "object" ? collectText({ byline: brand.byline, name: brand.name }) : [];
  if (brandWords.length) lines.push("Brand words on the slides", ...brandWords, "");
  return `${lines.join("\n").trim()}\n`;
}

function fileHash(file) {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(file, "r");
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    for (;;) {
      const read = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!read) break;
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

const IMAGES_HEADING = "Slide images (sha256), the files these words were rendered into:";

// What a render writes to claims/carousel.txt: the words, then the name and
// SHA-256 of every slide image of that render. The receipt covers both, so it
// stands only for exactly these images.
function carouselWords(deck, brand, files) {
  const images = (Array.isArray(files) ? files : []).map((file) => `${path.basename(file)} ${fileHash(file)}`);
  return `${deckText(deck, brand)}\n${IMAGES_HEADING}\n${images.join("\n")}\n`;
}

// A carousel words file split into its words and its { image name: sha256 }.
// null when it does not list the images it belongs to.
function carouselWordsParts(text) {
  const at = String(text).lastIndexOf(`${IMAGES_HEADING}\n`);
  if (at < 0) return null;
  const images = new Map(String(text).slice(at + IMAGES_HEADING.length + 1).split("\n").filter(Boolean).map((line) => {
    const parts = line.split(" ");
    return [parts[0], parts[1]];
  }));
  return { words: String(text).slice(0, at).trim(), images };
}

// Why the words file does not belong to the slides in this folder, or null.
function carouselBindingProblem(exportDir, wordsFile) {
  let text;
  try {
    text = fs.readFileSync(wordsFile, "utf8");
  } catch {
    return null; // missing is reported as missing
  }
  const parts = carouselWordsParts(text);
  if (!parts) return "the words file does not list the slide images it belongs to; render again";
  const listed = parts.images;
  let present;
  try {
    present = fs.readdirSync(exportDir).filter((name) => /\.png$/i.test(name));
  } catch {
    return "the export folder cannot be read";
  }
  if (!listed.size) return "the words file lists no slide images; render again";
  for (const name of present) if (!listed.has(name)) return `${name} is not one of the slides these words were rendered into; render again`;
  for (const [name, hash] of listed) {
    const file = path.join(exportDir, name);
    if (!isPlainFile(file)) return `${name} is missing; render again`;
    if (fileHash(file) !== hash) return `${name} changed after its words were written; render again`;
  }
  return null;
}

// The pieces of a rendered carousel export. The slide words were written to
// <export>/claims/carousel.txt by the render itself. kind "ad" checks the same
// words again as an ad (claims/ad-slides.txt). extra: [{ name, label, kind, text }]
// adds pieces such as the caption or an ads handoff message; empty text adds
// nothing, because nothing is published from it.
function carouselPieces(exportDir, options = {}) {
  const dir = path.join(exportDir, "claims");
  const rendered = path.join(dir, "carousel.txt");
  const kind = options.kind || "carousel";
  const pieces = [];
  let folderProblem = null;
  try {
    if (!fs.lstatSync(dir).isDirectory()) folderProblem = "the claims folder is not a plain folder";
  } catch (error) {
    if (!error || error.code !== "ENOENT") folderProblem = "the claims folder cannot be read";
  }
  const problem = folderProblem || carouselBindingProblem(exportDir, rendered);
  if (kind === "carousel") {
    pieces.push({ name: "carousel", label: "carousel slides (render again if this is missing)", kind: "carousel", file: rendered, problem });
  } else {
    let text = null;
    if (!problem && isPlainFile(rendered)) text = fs.readFileSync(rendered, "utf8");
    pieces.push({ name: `${kind}-slides`, label: `carousel slides, checked as ${kind} (render again if this is missing)`, kind, file: text === null ? rendered : writePiece(dir, `${kind}-slides`, text), problem });
  }
  if (folderProblem) return pieces;
  for (const item of Array.isArray(options.extra) ? options.extra : []) {
    if (hasText(item.text)) pieces.push({ name: item.name, label: item.label || item.name, kind: item.kind, file: writePiece(dir, item.name, item.text) });
  }
  return pieces;
}

function hasText(text) {
  return typeof text === "string" && text.trim().length > 0;
}

function firstLine(text) {
  return String(text || "").split("\n").map((line) => line.trim()).find(Boolean) || "";
}

// verify --strict for one piece, in a child process with an empty
// environment (no NODE_OPTIONS, no PEPTIDE_CLAIMS_STATE_DIR).
function verifyPiece(mode, piece) {
  const receipt = receiptPathFor(piece.file);
  const base = { name: piece.name, label: piece.label || piece.name, kind: piece.kind, file: piece.file, receipt };
  if (!KINDS.includes(piece.kind)) return { ...base, status: "invalid", reasons: [`unknown kind ${piece.kind}`] };
  if (piece.problem) return { ...base, status: "invalid", reasons: [String(piece.problem)] };
  if (!isPlainFile(piece.file)) return { ...base, status: "missing", reasons: ["the content file is missing"] };
  if (!isPlainFile(receipt)) return { ...base, status: "no-receipt", reasons: ["no receipt yet"] };
  const args = [mode.cli, "verify", "--receipt", receipt, "--file", piece.file, "--kind", piece.kind, "--strict", "--state-dir", mode.stateDir, "--json"];
  const run = spawnSync(process.execPath, args, { cwd: mode.root, env: {}, encoding: "utf8", timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
  let parsed = null;
  try {
    parsed = JSON.parse(run.stdout);
  } catch {
    parsed = null;
  }
  const valid = run.status === 0 && Boolean(parsed) && parsed.valid === true;
  if (!valid) {
    const reasons = parsed && Array.isArray(parsed.reasons) && parsed.reasons.length ? parsed.reasons.map(String) : [firstLine(run.stderr) || firstLine(run.stdout) || (run.error ? String(run.error.message) : `verify exited ${run.status}`)];
    return { ...base, status: "invalid", reasons };
  }
  const info = parsed.receipt || {};
  const accepted = info.accepted_review === true || Boolean(info.accepted_review && typeof info.accepted_review === "object");
  return { ...base, status: "verified", reasons: [], verdict: info.verdict || null, acceptedReview: accepted };
}

function q(value) {
  return `"${String(value).replace(/(["\\$`])/g, "\\$1")}"`;
}

function pieceLine(result) {
  if (result.status === "verified") {
    if (result.acceptedReview) return `- ${result.label} (${result.kind}): REVIEW, accepted by the owner (their reason is in the receipt).`;
    return `- ${result.label} (${result.kind}): ${PASS_LABEL}.`;
  }
  return `- ${result.label} (${result.kind}): ${result.status === "no-receipt" ? "not checked yet" : `receipt does not stand (${result.reasons.slice(0, 3).join("; ")})`}\n    content: ${result.file}\n    receipt: ${result.receipt}`;
}

function instructions(mode, pending) {
  const node = "node";
  const lines = [
    "For each piece above, in this order:",
    `  1. ${node} ${q(mode.cli)} rubric --kind <kind> --file <content> --json`,
    "     Answer the six questions honestly from the content alone. When in doubt, answer yes. Quote the exact words for every yes.",
    `  2. ${node} ${q(mode.cli)} gate --file <content> --kind <kind> --rubric <answers.json> --out <receipt> --state-dir ${q(mode.stateDir)}`,
    "  3. Exit 0: go on to the next piece; when every piece is done, run the publish or export again. Exit 1 (BLOCK): change the wording; nothing overrides a BLOCK.",
    "     Exit 2 (REVIEW): stop and show the owner every finding and every yes answer with the quoted words.",
    "     Only the owner can accept a REVIEW, in their own words: add --accept-review \"<the owner's own words>\" to the same gate command.",
    "     Never write, suggest, pre-fill or reuse a reason yourself. If the owner does not answer, nothing is published or exported.",
  ];
  if (pending.length === 1) lines.push(`Kind for this piece: ${pending[0].kind}.`);
  return lines.join("\n");
}

// check(action, pieces) -> { applies, ok, message, summary, pieces }
// The rule is worked out again here; a caller cannot hand in its own.
//   pieces: [{ name, label, kind, file }]
// applies false: the gate is off for this install; the caller goes on as before.
// applies true and ok false: the caller refuses and shows message.
function check(action, pieces) {
  const mode = enforcement();
  if (!mode.enforced) return { applies: false, ok: true, mode, pieces: [], message: "", summary: "" };
  const head = `Claims Check: ${action}`;
  if (!mode.cliPresent) {
    return { applies: true, ok: false, mode, pieces: [], summary: "", message: `${head} refused. This install needs the Claims Check module at ${path.join(mode.root, MODULE)} (${mode.reason}), and it is not there. Install peptide-claims, then try again.` };
  }
  prepareStateDir(mode);
  const list = Array.isArray(pieces) ? pieces : [];
  if (list.length === 0) return { applies: true, ok: false, mode, pieces: [], summary: "", message: `${head} refused. There was no text to check, so nothing can be confirmed. Nothing was published or exported.` };
  const results = list.map((piece) => verifyPiece(mode, piece));
  const pending = results.filter((result) => result.status !== "verified");
  if (pending.length) {
    return {
      applies: true,
      ok: false,
      mode,
      pieces: results,
      summary: "",
      message: [`${head} refused. Every piece needs a receipt that passes verify --strict; ${pending.length} of ${results.length} do not. Nothing was published or exported.`, ...results.map(pieceLine), instructions(mode, pending)].join("\n"),
    };
  }
  const summary = [`Claims Check, ${results.length} piece(s):`, ...results.map(pieceLine), PASS_SENTENCE].join("\n");
  return { applies: true, ok: true, mode, pieces: results, summary, message: summary };
}

// Makes the state folder ahead of the first gate run, private to the owner,
// with a .gitignore so the seal key is never committed.
function prepareStateDir(mode) {
  if (!mode || !mode.enforced || !mode.stateDir) return;
  try {
    fs.mkdirSync(mode.stateDir, { recursive: true, mode: 0o700 });
    const ignore = path.join(mode.stateDir, ".gitignore");
    if (!exists(ignore)) fs.writeFileSync(ignore, "*\n", { mode: 0o600 });
  } catch {
    /* the gate reports a problem with the folder itself */
  }
}

module.exports = { enforcement, check, writePiece, hasText, collectText, deckText, carouselWords, carouselWordsParts, carouselBindingProblem, fileHash, carouselPieces, candidateRoots, receiptPathFor, prepareStateDir, findInstallRoot, KINDS, PASS_LABEL, PASS_SENTENCE, STATE, MODULE };
