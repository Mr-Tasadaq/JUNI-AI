import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

test("frontend exposes Step 11 production UX controls", async () => {
  const [index, app, styles] = await Promise.all([
    readFile(join(root, "index.html"), "utf8"),
    readFile(join(root, "app.js"), "utf8"),
    readFile(join(root, "styles.css"), "utf8"),
  ]);

  assert.match(index, /id="answerReviewButton"/);
  assert.match(index, /id="answerModal"/);
  assert.match(index, /id="composerNotice"/);
  assert.match(index, /id="statusText"/);

  assert.match(app, /async function refreshServiceStatus\(\)/);
  assert.match(app, /async function loadAnswerCandidates\(/);
  assert.match(app, /async function reviewCandidate\(/);
  assert.match(app, /candidate\.content_text/);
  assert.match(app, /answerReviewButton/);

  assert.match(styles, /\.modal-card/);
  assert.match(styles, /\.candidate-card/);
  assert.match(styles, /\.composer-notice/);
});

test("frontend candidate rendering does not inject candidate content as HTML", async () => {
  const app = await readFile(join(root, "app.js"), "utf8");
  const start = app.indexOf("function renderCandidateCard");
  const end = app.indexOf("async function reviewCandidate", start);
  assert.ok(start >= 0 && end > start, "candidate renderer must exist");
  const renderer = app.slice(start, end);

  assert.doesNotMatch(renderer, /innerHTML/);
  assert.match(renderer, /question\.textContent/);
  assert.match(renderer, /answer\.textContent/);
});
