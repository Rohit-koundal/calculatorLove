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

test("the production worker validates disclosure, recomputes the score, and emails a fixed owner", async () => {
    const workerUrl = `${pathToFileURL(workerPath).href}?email-test=${Date.now()}`;
    const worker = (await import(workerUrl)).default;
    const originalFetch = global.fetch;
    let providerRequest = null;
    global.fetch = async (requestUrl, options) => {
        providerRequest = { requestUrl, options };
        return new Response(JSON.stringify({ TransactionID: "fixture" }), { status: 200 });
    };
    const payload = {
        personOne: { name: "Alex Morgan", dob: "1994-02-18", place: "Jaipur" },
        personTwo: { name: "Jordan Lee", dob: "1996-09-07", place: "Udaipur" },
        relationshipStart: "2020-04-12",
        contactEmail: "alex@example.com",
        disclosureAcknowledged: true,
        privacyNoticeVersion: "2026-08-11",
        result: { score: 1, nameScore: 1, birthdayScore: 1, storyScore: 1 },
        submissionId: "fixture-submission",
        formStartedAt: Date.now() - 2000,
        submittedAt: new Date().toISOString(),
        website: ""
    };

    try {
        const response = await worker.fetch(new Request("https://pairly.test/api/send-result", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Origin": "https://pairly.test",
                "CF-Connecting-IP": "203.0.113.10"
            },
            body: JSON.stringify(payload)
        }), {
            ELASTIC_EMAIL_API_KEY: "test-api-key",
            OWNER_EMAIL: "owner@example.com",
            FROM_EMAIL: "verified@example.com"
        });
        const body = await response.json();
        const providerBody = JSON.parse(providerRequest.options.body);

        assert.equal(response.status, 200);
        assert.deepEqual(body, { sent: true, score: 76 });
        assert.equal(providerRequest.requestUrl, "https://api.elasticemail.com/v4/emails/transactional");
        assert.equal(providerRequest.options.headers["X-ElasticEmail-ApiKey"], "test-api-key");
        assert.deepEqual(providerBody.Recipients.To, ["owner@example.com"]);
        assert.match(providerBody.Content.Subject, /76%/u);
        assert.match(providerBody.Content.Body[1].Content, /Automatic-backup disclosure: shown/u);
    } finally {
        global.fetch = originalFetch;
    }
});

test("the production worker refuses email when the backup disclosure marker is missing", async () => {
    const workerUrl = `${pathToFileURL(workerPath).href}?disclosure-test=${Date.now()}`;
    const worker = (await import(workerUrl)).default;
    const response = await worker.fetch(new Request("https://pairly.test/api/send-result", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disclosureAcknowledged: false })
    }), {});

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { sent: false });
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
