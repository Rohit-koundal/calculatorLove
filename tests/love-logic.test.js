"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
    calculateCompatibility,
    createShareText,
    createSubmissionPayload,
    getDobValidationError,
    getRelationshipDateValidationError,
    isRealIsoDate,
    isValidEmail,
    isValidName,
    isValidPlace,
    normalizeText,
    personKey
} = require("../script.js");

const alex = { name: "Alex Morgan", dob: "1994-02-18", place: "Jaipur" };
const jordan = { name: "Jordan Lee", dob: "1996-09-07", place: "Udaipur" };

test("the same inputs always return the same complete result", () => {
    const first = calculateCompatibility(alex, jordan, "2020-04-12");
    const second = calculateCompatibility(alex, jordan, "2020-04-12");
    assert.deepEqual(first, second);
});

test("the versioned formula keeps a fixed golden result", () => {
    assert.deepEqual(
        calculateCompatibility(alex, jordan, "2020-04-12"),
        { score: 76, nameScore: 68, birthdayScore: 83, storyScore: 84 }
    );
});

test("swapping the partners does not change any score", () => {
    const forward = calculateCompatibility(alex, jordan, "2020-04-12");
    const reversed = calculateCompatibility(jordan, alex, "2020-04-12");
    assert.deepEqual(forward, reversed);
});

test("cosmetic name and place differences normalize identically", () => {
    const decoratedAlex = { name: "  ÁLEX   MORGAN ", dob: alex.dob, place: "  JAIPUR " };
    assert.equal(personKey(decoratedAlex), personKey(alex));
    assert.deepEqual(
        calculateCompatibility(decoratedAlex, jordan, "2020-04-12"),
        calculateCompatibility(alex, jordan, "2020-04-12")
    );
    assert.equal(normalizeText("  José  D’Souza "), "jose d souza");
});

test("all score dimensions stay in the declared entertainment range", () => {
    for (let index = 0; index < 100; index += 1) {
        const first = {
            name: `Person ${index} A`,
            dob: `19${String(20 + (index % 70)).padStart(2, "0")}-03-14`,
            place: `City ${index}`
        };
        const second = {
            name: `Person ${index} B`,
            dob: `19${String(20 + ((index + 17) % 70)).padStart(2, "0")}-08-21`,
            place: `Town ${index + 3}`
        };
        const result = calculateCompatibility(first, second);

        Object.values(result).forEach((score) => {
            assert.equal(Number.isInteger(score), true);
            assert.equal(score >= 35 && score <= 99, true);
        });
    }
});

test("each advertised score dimension depends only on its own inputs", () => {
    const baseline = calculateCompatibility(alex, jordan, "2020-04-12");
    const changedBirthday = calculateCompatibility(
        { ...alex, dob: "1988-11-03" },
        jordan,
        "2020-04-12"
    );
    const changedName = calculateCompatibility(
        { ...alex, name: "Taylor Morgan" },
        jordan,
        "2020-04-12"
    );

    assert.equal(changedBirthday.nameScore, baseline.nameScore);
    assert.equal(changedBirthday.storyScore, baseline.storyScore);
    assert.equal(changedName.birthdayScore, baseline.birthdayScore);
    assert.equal(changedName.storyScore, baseline.storyScore);
});

test("date validation accepts real dates and rejects impossible dates", () => {
    assert.equal(isRealIsoDate("2024-02-29"), true);
    assert.equal(isRealIsoDate("2023-02-29"), false);
    assert.equal(isRealIsoDate("2024-13-01"), false);
    assert.equal(isRealIsoDate("not-a-date"), false);
});

test("date range validation rejects future, very old, and pre-birth dates", () => {
    const today = "2026-08-11";
    const oldestDob = "1906-08-11";

    assert.equal(getDobValidationError("", today, oldestDob), "Choose a date of birth.");
    assert.match(getDobValidationError("2027-01-01", today, oldestDob), /future/u);
    assert.match(getDobValidationError("1906-08-10", today, oldestDob), /120 years/u);
    assert.equal(getDobValidationError("1906-08-11", today, oldestDob), "");
    assert.equal(
        getRelationshipDateValidationError("", today, [alex.dob, jordan.dob]),
        ""
    );
    assert.match(
        getRelationshipDateValidationError("2027-01-01", today, [alex.dob, jordan.dob]),
        /future/u
    );
    assert.match(
        getRelationshipDateValidationError(jordan.dob, today, [alex.dob, jordan.dob]),
        /after both/u
    );
    assert.equal(
        getRelationshipDateValidationError("2020-04-12", today, [alex.dob, jordan.dob]),
        ""
    );
});

test("name, place, and optional email validators support realistic input", () => {
    assert.equal(isValidName("李"), true);
    assert.equal(isValidName("O’Connor-Smith"), true);
    assert.equal(isValidName("💘"), false);
    assert.equal(isValidPlace("St. John’s, NL"), true);
    assert.equal(isValidPlace("Brighton & Hove"), true);
    assert.equal(isValidPlace("@@@"), false);
    assert.equal(isValidEmail(""), true);
    assert.equal(isValidEmail("person@example.com"), true);
    assert.equal(isValidEmail("person+pairly@example.co.in"), true);
    assert.equal(isValidEmail("not-an-email"), false);
    assert.equal(isValidEmail("a@b..com"), false);
    assert.equal(isValidEmail("a@-example.com"), false);
    assert.equal(isValidEmail("a@b.c!"), false);
});

test("shared copy includes the result but excludes private dates and places", () => {
    const resultData = {
        personOne: alex,
        personTwo: jordan,
        relationshipStart: "2020-04-12",
        email: "alex@example.com",
        result: calculateCompatibility(alex, jordan, "2020-04-12")
    };
    const copy = createShareText(resultData);

    assert.match(copy, /Alex Morgan \+ Jordan Lee/u);
    assert.doesNotMatch(copy, /1994|1996|2020|Jaipur|Udaipur|alex@example/u);
});

test("the automatic submission payload records the displayed backup notice", () => {
    const resultData = {
        personOne: alex,
        personTwo: jordan,
        relationshipStart: "2020-04-12",
        email: "alex@example.com",
        result: calculateCompatibility(alex, jordan, "2020-04-12")
    };
    const payload = createSubmissionPayload(resultData, {
        submissionId: "fixture-submission",
        formStartedAt: 1000,
        submittedAt: "2026-08-11T10:00:00.000Z",
        pageUrl: "https://pairly.example/",
        userAgent: "Pairly test browser",
        website: ""
    });

    assert.equal(payload.disclosureAcknowledged, true);
    assert.equal(payload.privacyNoticeVersion, "2026-08-11");
    assert.equal(payload.contactEmail, "alex@example.com");
    assert.equal(payload.personOne.dob, alex.dob);
    assert.equal(payload.personTwo.place, jordan.place);
    assert.equal(payload.result.score, 76);
    assert.equal(payload.resultTitle, "A lovely rhythm");
    assert.match(payload.resultMessage, /balanced mix/u);
    assert.equal(payload.pageUrl, "https://pairly.example/");
    assert.equal(payload.userAgent, "Pairly test browser");
});
