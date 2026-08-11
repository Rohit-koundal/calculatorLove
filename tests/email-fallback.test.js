"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
    deliverEmailWithFallback,
    isEmailJsConfigured
} = require("../script.js");

const templateParams = {
    subject: "Pairly Result: Alex + Jordan — 76%",
    person_one_name: "Alex",
    person_one_dob: "1994-02-18",
    person_one_city: "Jaipur",
    person_two_name: "Jordan",
    person_two_dob: "1996-09-07",
    person_two_city: "Udaipur",
    relationship_start: "2020-04-12",
    contact_email: "alex@example.com",
    love_score: "76%",
    name_score: "68%",
    birthday_score: "83%",
    story_score: "84%",
    result_title: "A lovely rhythm",
    result_message: "A balanced Pairly result.",
    submitted_at: "11 August 2026 at 3:30 pm",
    page_url: "https://pairly.example/",
    browser_device: "Pairly test browser",
    submission_id: "fixture-submission",
    message: "Fixture message"
};

const placeholderConfig = {
    serviceId: "YOUR_EMAILJS_SERVICE_ID",
    templateId: "YOUR_EMAILJS_TEMPLATE_ID",
    publicKey: "YOUR_EMAILJS_PUBLIC_KEY"
};
const configuredEmailJs = {
    serviceId: "service_fixture",
    templateId: "template_fixture",
    publicKey: "public_fixture"
};

test("EmailJS placeholder detection treats its configuration as optional", () => {
    assert.equal(isEmailJsConfigured(placeholderConfig), false);
    assert.equal(isEmailJsConfigured(configuredEmailJs), true);
});

test("placeholder EmailJS values skip directly to one FormSubmit request", async () => {
    const urls = [];
    const result = await deliverEmailWithFallback(templateParams, {
        emailJsConfig: placeholderConfig,
        fetchImplementation: async (url) => {
            urls.push(url);
            return new Response('{"success":"true"}', { status: 200 });
        }
    });

    assert.deepEqual(urls, ["https://formsubmit.co/ajax/rkshekhavat@gmail.com"]);
    assert.equal(result.provider, "FormSubmit");
});

test("configured EmailJS success stops without calling FormSubmit", async () => {
    const urls = [];
    const result = await deliverEmailWithFallback(templateParams, {
        emailJsConfig: configuredEmailJs,
        fetchImplementation: async (url) => {
            urls.push(url);
            return new Response("OK", { status: 200 });
        }
    });

    assert.deepEqual(urls, ["https://api.emailjs.com/api/v1.0/email/send"]);
    assert.equal(result.provider, "EmailJS");
});

test("EmailJS failure calls FormSubmit exactly once and reports useful status", async () => {
    const urls = [];
    const originalError = console.error;
    console.error = () => {};

    try {
        const result = await deliverEmailWithFallback(templateParams, {
            emailJsConfig: configuredEmailJs,
            fetchImplementation: async (url) => {
                urls.push(url);
                return url.includes("emailjs")
                    ? new Response("provider unavailable", { status: 503 })
                    : new Response('{"success":"true"}', { status: 200 });
            }
        });

        assert.deepEqual(urls, [
            "https://api.emailjs.com/api/v1.0/email/send",
            "https://formsubmit.co/ajax/rkshekhavat@gmail.com"
        ]);
        assert.equal(result.provider, "FormSubmit");
    } finally {
        console.error = originalError;
    }
});

test("offline delivery failure rejects without affecting calculation helpers", async () => {
    await assert.rejects(
        deliverEmailWithFallback(templateParams, {
            emailJsConfig: placeholderConfig,
            fetchImplementation: async () => {
                throw new TypeError("Failed to fetch");
            }
        }),
        /Failed to fetch/u
    );
});
