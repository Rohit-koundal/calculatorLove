"use strict";

const SCORE_VERSION = "pairly-love-score:v2";
const PRIVACY_NOTICE_VERSION = "2026-08-11";
const MIN_SCORE = 35;
const MAX_SCORE = 99;

// Replace these three values with the IDs from your EmailJS dashboard.
// Set the EmailJS template recipient to {{to_email}}.
const EMAILJS_CONFIG = Object.freeze({
    serviceId: "YOUR_EMAILJS_SERVICE_ID",
    templateId: "YOUR_EMAILJS_TEMPLATE_ID",
    publicKey: "YOUR_EMAILJS_PUBLIC_KEY",
    toEmail: "rkshekhavat@gmail.com"
});
const EMAILJS_ENDPOINT = "https://api.emailjs.com/api/v1.0/email/send";

/**
 * Normalization makes cosmetic differences such as capitalization, repeated
 * spaces, and accents produce the same fingerprint.
 */
function normalizeText(value) {
    return String(value ?? "")
        .normalize("NFKD")
        .replace(/\p{M}/gu, "")
        .toLocaleLowerCase("en")
        .trim()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .replace(/\s+/gu, " ");
}

function encodePart(value) {
    const text = String(value ?? "");
    return `${text.length}:${text}`;
}

function personKey(person) {
    return [
        normalizeText(person.name),
        person.dob,
        normalizeText(person.place)
    ].map(encodePart).join("|");
}

/** A small stable 32-bit hash whose output is repeatable across runs. */
function fnv1a(value) {
    let hash = 0x811c9dc5;

    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }

    return hash >>> 0;
}

function seededUnit(seed) {
    return fnv1a(seed) / 0xffffffff;
}

function characterAffinity(leftValue, rightValue) {
    const left = new Set(normalizeText(leftValue).replace(/\s/gu, ""));
    const right = new Set(normalizeText(rightValue).replace(/\s/gu, ""));
    const union = new Set([...left, ...right]);

    if (union.size === 0) {
        return 0;
    }

    const sharedCount = [...left].filter((character) => right.has(character)).length;
    return sharedCount / union.size;
}

function lifePathNumber(isoDate) {
    let total = isoDate
        .replace(/\D/gu, "")
        .split("")
        .reduce((sum, digit) => sum + Number(digit), 0);

    while (total > 9) {
        total = String(total)
            .split("")
            .reduce((sum, digit) => sum + Number(digit), 0);
    }

    return total;
}

function dimensionScore(seed, affinity) {
    const blend = (seededUnit(seed) * 0.7) + (affinity * 0.3);
    return Math.round(MIN_SCORE + ((MAX_SCORE - MIN_SCORE) * blend));
}

/**
 * Entertainment-only formula:
 * - names: 50% of the total
 * - birthdays: 30%
 * - places and optional relationship date: 20%
 *
 * Each dimension sorts its two corresponding values, so swapping the people
 * cannot change the answer. Versioned seeds keep the formula stable over time.
 */
function calculateCompatibility(personOne, personTwo, relationshipStart = "") {
    const names = [normalizeText(personOne.name), normalizeText(personTwo.name)].sort();
    const birthdays = [personOne.dob, personTwo.dob].sort();
    const places = [normalizeText(personOne.place), normalizeText(personTwo.place)].sort();

    const nameAffinity = characterAffinity(personOne.name, personTwo.name);
    const birthdayDistance = Math.abs(lifePathNumber(personOne.dob) - lifePathNumber(personTwo.dob));
    const birthdayAffinity = 1 - (birthdayDistance / 8);
    const placeAffinity = characterAffinity(personOne.place, personTwo.place);
    const dateAffinity = relationshipStart
        ? seededUnit(`${SCORE_VERSION}|relationship-date|${relationshipStart}`)
        : 0.55;

    const nameScore = dimensionScore(
        `${SCORE_VERSION}|names|${names.map(encodePart).join("|")}`,
        nameAffinity
    );
    const birthdayScore = dimensionScore(
        `${SCORE_VERSION}|birthdays|${birthdays.map(encodePart).join("|")}`,
        birthdayAffinity
    );
    const storyScore = dimensionScore(
        [
            SCORE_VERSION,
            "story",
            ...places.map(encodePart),
            encodePart(relationshipStart || "none")
        ].join("|"),
        (placeAffinity * 0.65) + (dateAffinity * 0.35)
    );
    const score = Math.round(
        (nameScore * 0.5) +
        (birthdayScore * 0.3) +
        (storyScore * 0.2)
    );

    return { score, nameScore, birthdayScore, storyScore };
}

function isRealIsoDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);

    if (!match) {
        return false;
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));

    return date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day;
}

function localIsoDate(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function getDobValidationError(value, today, oldestDob) {
    if (!value) {
        return "Choose a date of birth.";
    }
    if (!isRealIsoDate(value)) {
        return "Choose a valid date of birth.";
    }
    if (value > today) {
        return "A date of birth cannot be in the future.";
    }
    if (value < oldestDob) {
        return "Enter a date within the last 120 years.";
    }
    return "";
}

function getRelationshipDateValidationError(value, today, birthDates) {
    if (!value) {
        return "";
    }
    if (!isRealIsoDate(value)) {
        return "Choose a valid relationship date.";
    }
    if (value > today) {
        return "The relationship date cannot be in the future.";
    }

    const validBirthDates = birthDates.filter(isRealIsoDate).sort();
    const latestBirthDate = validBirthDates[validBirthDates.length - 1];

    if (latestBirthDate && value <= latestBirthDate) {
        return "This date must be after both dates of birth.";
    }
    return "";
}

function isValidName(value) {
    const name = value.trim();
    return name.length >= 1 &&
        name.length <= 60 &&
        /\p{L}/u.test(name) &&
        /^[\p{L}\p{M} .\-'’]+$/u.test(name);
}

function isValidPlace(value) {
    const place = value.trim();
    return place.length >= 1 &&
        place.length <= 80 &&
        /[\p{L}\p{N}]/u.test(place) &&
        /^[\p{L}\p{M}\p{N} .,\-'’()/&]+$/u.test(place);
}

function isValidEmail(value) {
    const email = value.trim();

    if (email === "") {
        return true;
    }
    if (email.length > 254 || /\s/u.test(email)) {
        return false;
    }

    const atIndex = email.lastIndexOf("@");
    if (atIndex <= 0 || atIndex !== email.indexOf("@")) {
        return false;
    }

    const localPart = email.slice(0, atIndex);
    const domain = email.slice(atIndex + 1);
    const domainLabels = domain.split(".");

    if (
        localPart.length > 64 ||
        localPart.startsWith(".") ||
        localPart.endsWith(".") ||
        localPart.includes("..") ||
        !/^[\p{L}\p{N}.!#$%&'*+/=?^_`{|}~-]+$/u.test(localPart) ||
        domain.length > 253 ||
        domainLabels.length < 2
    ) {
        return false;
    }

    const labelsAreValid = domainLabels.every((label) =>
        label.length <= 63 &&
        /^[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?$/u.test(label)
    );
    const topLevelDomain = domainLabels[domainLabels.length - 1];
    const topLevelIsValid = /^(?:\p{L}{2,}|xn--[\p{L}\p{N}-]{2,})$/u.test(topLevelDomain);

    return labelsAreValid && topLevelIsValid;
}

function getResultCopy(resultData) {
    const { score } = resultData.result;

    if (score >= 90) {
        return {
            title: "A rare kind of spark",
            message: "Your pairing lands in Pairly’s brightest tier—a playful sign of strong chemistry, complementary energy, and a story worth celebrating."
        };
    }

    if (score >= 78) {
        return {
            title: "Magnetically matched",
            message: "There is an easy pull in this pairing. Your names, birthday rhythm, and shared details create a wonderfully warm compatibility blend."
        };
    }

    if (score >= 65) {
        return {
            title: "A lovely rhythm",
            message: "You bring a balanced mix of familiarity and surprise—the kind of playful chemistry that keeps a connection interesting."
        };
    }

    if (score >= 50) {
        return {
            title: "Sweet potential",
            message: "Your match has its own charming energy. Different notes can still make a memorable duet when curiosity and care lead the way."
        };
    }

    return {
        title: "A curious beginning",
        message: "Your pairing is delightfully unpredictable. A number never defines a real connection, so let conversation and kindness write the next chapter."
    };
}

function createShareText(resultData) {
    const { personOne, personTwo, result } = resultData;
    return [
        `${personOne.name} + ${personTwo.name}: ${result.score}% compatible on Pairly.`,
        `Name chemistry: ${result.nameScore}%`,
        `Birthday rhythm: ${result.birthdayScore}%`,
        `Shared story: ${result.storyScore}%`,
        "",
        "Same details, same playful result. Pairly is for entertainment—not a scientific assessment."
    ].join("\n");
}

function createSubmissionPayload(resultData, metadata = {}) {
    return {
        personOne: { ...resultData.personOne },
        personTwo: { ...resultData.personTwo },
        relationshipStart: resultData.relationshipStart || "",
        contactEmail: resultData.email || "",
        disclosureAcknowledged: true,
        privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
        result: { ...resultData.result },
        submissionId: metadata.submissionId || "",
        formStartedAt: metadata.formStartedAt || 0,
        submittedAt: metadata.submittedAt || new Date().toISOString(),
        website: metadata.website || ""
    };
}

function initializeCalculator() {
    const form = document.getElementById("loveCalculatorForm");

    if (!form) {
        return;
    }

    const resultPanel = document.getElementById("resultPanel");
    const formStatus = document.getElementById("formStatus");
    const shareStatus = document.getElementById("shareStatus");
    const calculateButton = document.getElementById("calculateButton");
    const calculateButtonText = document.getElementById("calculateButtonText");
    const deliveryNotice = document.getElementById("deliveryNotice");
    const deliveryIcon = document.getElementById("deliveryIcon");
    const deliveryTitle = document.getElementById("deliveryTitle");
    const deliveryMessage = document.getElementById("deliveryMessage");
    const mobileStepLabel = document.getElementById("mobileStepLabel");
    const mobileStepCount = document.getElementById("mobileStepCount");
    const mobileProgressTrack = document.getElementById("mobileProgressTrack");
    const mobileProgressBar = document.getElementById("mobileProgressBar");
    const mobileBackButton = document.getElementById("mobileBackButton");
    const mobileNextButton = document.getElementById("mobileNextButton");
    const mobileViewport = window.matchMedia("(max-width: 720px)");
    let formStartedAt = Date.now();
    let currentMobileStep = 1;
    const calculationFieldIds = [
        "name1", "dob1", "place1", "name2", "dob2", "place2", "relationshipStart"
    ];
    const allFieldIds = [...calculationFieldIds, "email"];
    const fields = Object.fromEntries(
        allFieldIds.map((id) => [id, document.getElementById(id)])
    );
    const today = localIsoDate();
    const oldestDate = new Date();
    oldestDate.setFullYear(oldestDate.getFullYear() - 120);
    const oldestDob = localIsoDate(oldestDate);
    let lastResult = null;

    [fields.dob1, fields.dob2, fields.relationshipStart].forEach((input) => {
        input.max = today;
    });
    fields.dob1.min = oldestDob;
    fields.dob2.min = oldestDob;

    function setFieldError(input, message = "", errorCode = "") {
        const errorElement = document.getElementById(`${input.id}Error`);
        errorElement.textContent = message;
        errorElement.dataset.errorCode = errorCode;

        if (message) {
            input.setAttribute("aria-invalid", "true");
        } else {
            input.removeAttribute("aria-invalid");
        }

        return message === "";
    }

    function validateField(input) {
        const value = input.value.trim();

        if (input.id === "name1" || input.id === "name2") {
            if (!value) {
                return setFieldError(input, "Enter this person’s name.");
            }
            if (!isValidName(value)) {
                return setFieldError(input, "Use 1–60 letters; spaces, apostrophes, periods, and hyphens are okay.");
            }
        }

        if (input.id === "place1" || input.id === "place2") {
            if (!value) {
                return setFieldError(input, "Enter a city or hometown.");
            }
            if (!isValidPlace(value)) {
                return setFieldError(input, "Enter a valid place using 1–80 characters.");
            }
        }

        if (input.id === "dob1" || input.id === "dob2") {
            const dateError = getDobValidationError(value, today, oldestDob);
            if (dateError) {
                return setFieldError(input, dateError);
            }
        }

        if (input.id === "relationshipStart") {
            const relationshipError = getRelationshipDateValidationError(
                value,
                today,
                [fields.dob1.value, fields.dob2.value]
            );
            if (relationshipError) {
                return setFieldError(input, relationshipError);
            }
        }

        if (input.id === "email" && (input.validity.typeMismatch || !isValidEmail(value))) {
            return setFieldError(input, "Enter a complete email address, such as you@example.com.");
        }

        return setFieldError(input);
    }

    function peopleMatch() {
        const requiredValues = [
            fields.name1.value,
            fields.dob1.value,
            fields.place1.value,
            fields.name2.value,
            fields.dob2.value,
            fields.place2.value
        ];

        return requiredValues.every((value) => value.trim() !== "") &&
            personKey({
                name: fields.name1.value,
                dob: fields.dob1.value,
                place: fields.place1.value
            }) === personKey({
                name: fields.name2.value,
                dob: fields.dob2.value,
                place: fields.place2.value
            });
    }

    function setMobileStep(step, shouldFocus = true) {
        const stepLabels = ["First person", "Second person", "Story & backup"];
        currentMobileStep = Math.min(3, Math.max(1, step));
        form.dataset.currentStep = String(currentMobileStep);
        mobileStepLabel.textContent = stepLabels[currentMobileStep - 1];
        mobileStepCount.textContent = `Step ${currentMobileStep} of 3`;
        mobileProgressTrack.setAttribute("aria-valuenow", String(currentMobileStep));
        mobileProgressBar.style.width = `${currentMobileStep * (100 / 3)}%`;
        formStatus.textContent = "";

        if (shouldFocus && mobileViewport.matches) {
            mobileStepLabel.focus({ preventScroll: true });
            document.querySelector(".form-panel").scrollIntoView({
                behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
                block: "start"
            });
        }
    }

    function validateMobileStep(step) {
        const ids = step === 1
            ? ["name1", "dob1", "place1"]
            : ["name2", "dob2", "place2"];
        const valid = ids.map((id) => validateField(fields[id]));

        if (step === 2 && valid.every(Boolean) && peopleMatch()) {
            setFieldError(
                fields.name2,
                "These details match the first person. Add a different person.",
                "duplicate-person"
            );
            valid[0] = false;
        }

        if (valid.some((isValid) => !isValid)) {
            formStatus.textContent = `Please complete the ${step === 1 ? "first" : "second"} person’s details.`;
            form.querySelector('[aria-invalid="true"]')?.focus();
            return false;
        }

        return true;
    }

    function validateForm() {
        formStatus.textContent = "";
        const validity = allFieldIds.map((id) => validateField(fields[id]));

        const samePerson = validity.slice(0, 6).every(Boolean) &&
            personKey({
                name: fields.name1.value,
                dob: fields.dob1.value,
                place: fields.place1.value
            }) === personKey({
                name: fields.name2.value,
                dob: fields.dob2.value,
                place: fields.place2.value
            });

        if (samePerson) {
            setFieldError(
                fields.name2,
                "These details match the first person. Add a different person.",
                "duplicate-person"
            );
            validity[3] = false;
        }

        if (validity.some((isValid) => !isValid)) {
            formStatus.textContent = "Please check the highlighted details before calculating and saving the backup.";
            form.querySelector('[aria-invalid="true"]')?.focus();
            return false;
        }

        return true;
    }

    function getFormData() {
        return {
            personOne: {
                name: fields.name1.value.trim(),
                dob: fields.dob1.value,
                place: fields.place1.value.trim()
            },
            personTwo: {
                name: fields.name2.value.trim(),
                dob: fields.dob2.value,
                place: fields.place2.value.trim()
            },
            relationshipStart: fields.relationshipStart.value,
            email: fields.email.value.trim()
        };
    }

    function setDeliveryState(state, title, message) {
        deliveryNotice.classList.remove("is-success", "is-error");
        deliveryNotice.classList.toggle("is-success", state === "success");
        deliveryNotice.classList.toggle("is-error", state === "error");
        deliveryIcon.textContent = state === "success" ? "✓" : state === "error" ? "!" : "↗";
        deliveryTitle.textContent = title;
        deliveryMessage.textContent = message;
    }

    async function sendConsentedSubmission(resultData) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 12000);
        const submissionId = globalThis.crypto?.randomUUID
            ? globalThis.crypto.randomUUID()
            : `${Date.now()}-${fnv1a(personKey(resultData.personOne) + personKey(resultData.personTwo))}`;
        const payload = createSubmissionPayload(resultData, {
            submissionId,
            formStartedAt,
            submittedAt: new Date().toISOString(),
            website: document.getElementById("website").value
        });

        if (Object.values(EMAILJS_CONFIG).some((value) => value.startsWith("YOUR_EMAILJS_"))) {
            clearTimeout(timeout);
            throw new Error("Add your EmailJS IDs in script.js.");
        }

        const templateParams = {
            to_email: EMAILJS_CONFIG.toEmail,
            subject: `Pairly result: ${payload.personOne.name} + ${payload.personTwo.name} — ${payload.result.score}%`,
            person_one_name: payload.personOne.name,
            person_one_dob: payload.personOne.dob,
            person_one_city: payload.personOne.place,
            person_two_name: payload.personTwo.name,
            person_two_dob: payload.personTwo.dob,
            person_two_city: payload.personTwo.place,
            relationship_start: payload.relationshipStart || "Not provided",
            contact_email: payload.contactEmail || "Not provided",
            love_score: `${payload.result.score}%`,
            name_score: `${payload.result.nameScore}%`,
            birthday_score: `${payload.result.birthdayScore}%`,
            story_score: `${payload.result.storyScore}%`,
            submission_id: payload.submissionId,
            submitted_at: payload.submittedAt,
            privacy_notice: `Automatic backup notice ${payload.privacyNoticeVersion} was shown before calculation.`,
            message: [
                `${payload.personOne.name} + ${payload.personTwo.name}: ${payload.result.score}%`,
                `Person 1: ${payload.personOne.dob}, ${payload.personOne.place}`,
                `Person 2: ${payload.personTwo.dob}, ${payload.personTwo.place}`,
                `Relationship start: ${payload.relationshipStart || "Not provided"}`,
                `Contact email: ${payload.contactEmail || "Not provided"}`
            ].join("\n")
        };

        try {
            const response = await fetch(EMAILJS_ENDPOINT, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    service_id: EMAILJS_CONFIG.serviceId,
                    template_id: EMAILJS_CONFIG.templateId,
                    user_id: EMAILJS_CONFIG.publicKey,
                    template_params: templateParams
                }),
                signal: controller.signal
            });

            if (!response.ok) {
                throw new Error("Delivery was not confirmed.");
            }

            return { sent: true };
        } finally {
            clearTimeout(timeout);
        }
    }

    function setBreakdown(name, value) {
        document.getElementById(`${name}ScoreText`).textContent = `${value}%`;
        document.getElementById(`${name}ScoreBar`).style.width = `${value}%`;
    }

    function renderResult(resultData) {
        const { personOne, personTwo, result } = resultData;
        const copy = getResultCopy(resultData);
        const scoreRing = document.getElementById("scoreRing");

        document.getElementById("pairNames").textContent = `${personOne.name} + ${personTwo.name}`;
        document.getElementById("scoreNumber").textContent = String(result.score);
        document.getElementById("resultTitle").textContent = copy.title;
        document.getElementById("resultMessage").textContent = copy.message;
        scoreRing.style.setProperty("--score", result.score);
        scoreRing.setAttribute("aria-valuenow", String(result.score));
        scoreRing.setAttribute("aria-label", `Compatibility score: ${result.score} percent`);

        ["name", "birthday", "story"].forEach((name) => {
            document.getElementById(`${name}ScoreBar`).style.width = "0";
        });

        resultPanel.hidden = false;
        resultPanel.classList.remove("is-revealed");
        void resultPanel.offsetWidth;
        resultPanel.classList.add("is-revealed");

        requestAnimationFrame(() => {
            setBreakdown("name", result.nameScore);
            setBreakdown("birthday", result.birthdayScore);
            setBreakdown("story", result.storyScore);
        });

        shareStatus.textContent = "";
        document.getElementById("resultTitle").focus({ preventScroll: true });
        resultPanel.scrollIntoView({
            behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
            block: "start"
        });
    }

    form.addEventListener("submit", async (event) => {
        event.preventDefault();

        if (mobileViewport.matches && currentMobileStep < 3) {
            if (validateMobileStep(currentMobileStep)) {
                setMobileStep(currentMobileStep + 1);
            }
            return;
        }

        if (calculateButton.disabled || !validateForm()) {
            return;
        }

        const formData = getFormData();
        lastResult = {
            ...formData,
            result: calculateCompatibility(
                formData.personOne,
                formData.personTwo,
                formData.relationshipStart
            )
        };
        renderResult(lastResult);

        calculateButton.disabled = true;
        form.setAttribute("aria-busy", "true");
        calculateButtonText.textContent = "Sending securely…";
        setDeliveryState(
            "pending",
            "Saving your email backup…",
            "Your score is ready while secure backup delivery finishes."
        );

        try {
            await sendConsentedSubmission(lastResult);
            setDeliveryState(
                "success",
                "Email backup saved.",
                "The disclosed details and result were sent to rkshekhavat@gmail.com."
            );
        } catch (error) {
            setDeliveryState(
                "error",
                "Email delivery could not be confirmed.",
                "Your score still works. Please try again later if you want the owner to receive it."
            );
        } finally {
            calculateButton.disabled = false;
            form.removeAttribute("aria-busy");
            calculateButtonText.textContent = "Calculate & save backup";
        }
    });

    allFieldIds.forEach((id) => {
        const input = fields[id];

        input.addEventListener("blur", () => validateField(input));
        input.addEventListener("input", () => {
            formStatus.textContent = "";
            shareStatus.textContent = "";

            if (input.getAttribute("aria-invalid") === "true") {
                validateField(input);
            }

            const duplicateError = document.getElementById("name2Error");
            if (
                calculationFieldIds.includes(id) &&
                duplicateError.dataset.errorCode === "duplicate-person"
            ) {
                const partnerValues = [
                    fields.name1.value,
                    fields.dob1.value,
                    fields.place1.value,
                    fields.name2.value,
                    fields.dob2.value,
                    fields.place2.value
                ];
                const stillDuplicate = partnerValues.every((value) => value.trim() !== "") &&
                    personKey({
                        name: fields.name1.value,
                        dob: fields.dob1.value,
                        place: fields.place1.value
                    }) === personKey({
                        name: fields.name2.value,
                        dob: fields.dob2.value,
                        place: fields.place2.value
                    });

                if (!stillDuplicate) {
                    validateField(fields.name2);
                }
            }

            if ((id === "dob1" || id === "dob2") && fields.relationshipStart.value) {
                validateField(fields.relationshipStart);
            }

            if (lastResult && calculationFieldIds.includes(id)) {
                lastResult = null;
                resultPanel.hidden = true;
            }
        });
    });

    mobileNextButton.addEventListener("click", () => {
        if (validateMobileStep(currentMobileStep)) {
            setMobileStep(currentMobileStep + 1);
        }
    });

    mobileBackButton.addEventListener("click", () => {
        setMobileStep(currentMobileStep - 1);
    });

    document.getElementById("copyResultButton").addEventListener("click", async () => {
        if (!lastResult) {
            return;
        }

        const text = createShareText(lastResult);

        let textArea = null;

        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(text);
            } else {
                textArea = document.createElement("textarea");
                textArea.value = text;
                textArea.setAttribute("readonly", "");
                textArea.style.position = "fixed";
                textArea.style.opacity = "0";
                document.body.appendChild(textArea);
                textArea.select();

                if (!document.execCommand("copy")) {
                    throw new Error("Copy command was unavailable.");
                }

            }

            shareStatus.textContent = "Result copied to your clipboard.";
        } catch (error) {
            shareStatus.textContent = "Copy was blocked by the browser. Please try again from a secure page.";
        } finally {
            textArea?.remove();
        }
    });

    document.getElementById("startOverButton").addEventListener("click", () => {
        form.reset();
        allFieldIds.forEach((id) => setFieldError(fields[id]));
        formStatus.textContent = "";
        shareStatus.textContent = "";
        setDeliveryState(
            "pending",
            "Saving your email backup…",
            "Your score is ready while secure backup delivery finishes."
        );
        resultPanel.hidden = true;
        lastResult = null;
        formStartedAt = Date.now();
        setMobileStep(1, false);
        fields.name1.focus({ preventScroll: true });
        document.getElementById("calculator").scrollIntoView({
            behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
            block: "start"
        });
    });

    setMobileStep(1, false);
}

if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initializeCalculator);
    } else {
        initializeCalculator();
    }
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        calculateCompatibility,
        createShareText,
        createSubmissionPayload,
        getDobValidationError,
        getRelationshipDateValidationError,
        fnv1a,
        isRealIsoDate,
        isValidEmail,
        isValidName,
        isValidPlace,
        normalizeText,
        personKey
    };
}
