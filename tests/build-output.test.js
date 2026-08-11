"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const projectRoot = path.resolve(__dirname, "..");
const workerPath = path.join(projectRoot, "dist", "server", "index.js");

test("the production worker serves the page and local assets with security headers", async () => {
    const workerUrl = `${pathToFileURL(workerPath).href}?test=${Date.now()}`;
    const worker = (await import(workerUrl)).default;
    const pageResponse = await worker.fetch(new Request("https://pairly.test/"), {});
    const styleResponse = await worker.fetch(new Request("https://pairly.test/styles.css"), {});

    assert.equal(pageResponse.status, 200);
    assert.match(pageResponse.headers.get("content-type"), /text\/html/u);
    assert.match(pageResponse.headers.get("content-security-policy"), /default-src 'self'/u);
    assert.match(await pageResponse.text(), /Two people\./u);
    assert.equal(styleResponse.status, 200);
    assert.match(styleResponse.headers.get("content-type"), /text\/css/u);
    assert.match(await styleResponse.text(), /\.calculator-shell/u);
});

test("the production worker rejects mutating requests", async () => {
    const workerUrl = `${pathToFileURL(workerPath).href}?method-test=${Date.now()}`;
    const worker = (await import(workerUrl)).default;
    const response = await worker.fetch(new Request("https://pairly.test/", {
        method: "POST"
    }), {});

    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "GET, HEAD");
});

test("the production policy permits the two configured email endpoints", async () => {
    const workerUrl = `${pathToFileURL(workerPath).href}?csp-test=${Date.now()}`;
    const worker = (await import(workerUrl)).default;
    const response = await worker.fetch(new Request("https://pairly.test/"), {});
    const policy = response.headers.get("content-security-policy");

    assert.match(policy, /connect-src 'self' https:\/\/api\.emailjs\.com https:\/\/formsubmit\.co/u);
    assert.doesNotMatch(policy, /elasticemail|smtpjs/iu);
});

test("the social preview is included in the production asset tree", () => {
    const image = fs.readFileSync(path.join(projectRoot, "dist", "client", "public", "og.png"));
    assert.deepEqual([...image.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(image.length > 100_000, true);
});

test("the production build carries the Sites hosting metadata", () => {
    const hosting = JSON.parse(fs.readFileSync(
        path.join(projectRoot, "dist", ".openai", "hosting.json"),
        "utf8"
    ));
    assert.match(hosting.project_id, /^appgprj_/u);
});
