"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(projectRoot, "index.html"), "utf8");
const script = fs.readFileSync(path.join(projectRoot, "script.js"), "utf8");
const styles = fs.readFileSync(path.join(projectRoot, "styles.css"), "utf8");
const clientSource = `${html}\n${script}\n${styles}`;

test("the page has no third-party requests or browser-side SMTP secrets", () => {
    assert.doesNotMatch(clientSource, /https?:\/\//iu);
    assert.doesNotMatch(clientSource, /smtp|Email\.send|Password\s*:/iu);
    assert.doesNotMatch(clientSource, /[A-F0-9]{32,}/u);
});

test("the page uses form submission without inline JavaScript", () => {
    assert.match(html, /<form[^>]+id="loveCalculatorForm"/u);
    assert.match(html, /<button[^>]+type="submit"/u);
    assert.doesNotMatch(html, /on(?:click|submit|change|input)\s*=/iu);
    assert.doesNotMatch(html, /<input[^>]+\sname=/iu);
    assert.match(html, /<noscript>/u);
    assert.match(script, /form\.addEventListener\("submit"/u);
});

test("automatic backup is clearly disclosed at the one-click action", () => {
    assert.doesNotMatch(html, /id="dataConsent"/u);
    assert.match(html, /Automatic email backup/u);
    assert.match(html, /rkshekhavat@gmail\.com/u);
    assert.match(html, /Calculate &amp; save backup/u);
    assert.match(script, /disclosureAcknowledged: true/u);
    assert.match(script, /fetch\("\/api\/send-result"/u);
    assert.doesNotMatch(script, /mailto:/u);
});

test("the phone layout uses a focused three-step flow", () => {
    assert.match(html, /id="loveCalculatorForm"[^>]+data-current-step="1"/u);
    assert.equal((html.match(/data-mobile-step="[123]"/gu) || []).length, 4);
    assert.match(html, /id="mobileProgressTrack"[^>]+role="progressbar"/u);
    assert.match(html, /id="mobileBackButton"/u);
    assert.match(html, /id="mobileNextButton"/u);
    assert.match(script, /function setMobileStep\(/u);
    assert.match(script, /function validateMobileStep\(/u);
    assert.match(styles, /@media \(max-width: 720px\)/u);
    assert.match(styles, /data-current-step="3"/u);
});

test("the result and validation affordances are available to assistive technology", () => {
    assert.match(html, /id="formStatus"[^>]+role="alert"/u);
    assert.match(html, /id="resultPanel"[^>]+role="region"/u);
    assert.match(html, /id="resultTitle"[^>]+tabindex="-1"/u);
    assert.match(html, /id="scoreRing"[^>]+role="progressbar"/u);
    assert.match(styles, /:focus-visible/u);
    assert.match(styles, /prefers-reduced-motion/u);
});
