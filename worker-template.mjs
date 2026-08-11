const EMBEDDED_ASSETS = /*__PAIRLY_EMBEDDED_ASSETS__*/ {};
const SCORE_VERSION = "pairly-love-score:v2";
const PRIVACY_NOTICE_VERSION = "2026-08-11";
const MIN_SCORE = 35;
const MAX_SCORE = 99;
const EMAIL_ENDPOINT = "https://api.elasticemail.com/v4/emails/transactional";
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT = 10;
const requestBuckets = new Map();

const SECURITY_HEADERS = {
    "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY"
};

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
    return [normalizeText(person.name), person.dob, normalizeText(person.place)]
        .map(encodePart)
        .join("|");
}

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
    if (union.size === 0) return 0;
    return [...left].filter((character) => right.has(character)).length / union.size;
}

function lifePathNumber(isoDate) {
    let total = isoDate.replace(/\D/gu, "").split("")
        .reduce((sum, digit) => sum + Number(digit), 0);
    while (total > 9) {
        total = String(total).split("")
            .reduce((sum, digit) => sum + Number(digit), 0);
    }
    return total;
}

function dimensionScore(seed, affinity) {
    const blend = (seededUnit(seed) * 0.7) + (affinity * 0.3);
    return Math.round(MIN_SCORE + ((MAX_SCORE - MIN_SCORE) * blend));
}

function calculateCompatibility(personOne, personTwo, relationshipStart = "") {
    const names = [normalizeText(personOne.name), normalizeText(personTwo.name)].sort();
    const birthdays = [personOne.dob, personTwo.dob].sort();
    const places = [normalizeText(personOne.place), normalizeText(personTwo.place)].sort();
    const birthdayDistance = Math.abs(lifePathNumber(personOne.dob) - lifePathNumber(personTwo.dob));
    const dateAffinity = relationshipStart
        ? seededUnit(`${SCORE_VERSION}|relationship-date|${relationshipStart}`)
        : 0.55;
    const nameScore = dimensionScore(
        `${SCORE_VERSION}|names|${names.map(encodePart).join("|")}`,
        characterAffinity(personOne.name, personTwo.name)
    );
    const birthdayScore = dimensionScore(
        `${SCORE_VERSION}|birthdays|${birthdays.map(encodePart).join("|")}`,
        1 - (birthdayDistance / 8)
    );
    const storyScore = dimensionScore(
        [SCORE_VERSION, "story", ...places.map(encodePart), encodePart(relationshipStart || "none")].join("|"),
        (characterAffinity(personOne.place, personTwo.place) * 0.65) + (dateAffinity * 0.35)
    );
    return {
        score: Math.round((nameScore * 0.5) + (birthdayScore * 0.3) + (storyScore * 0.2)),
        nameScore,
        birthdayScore,
        storyScore
    };
}

function isRealIsoDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
    if (!match) return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day;
}

function isValidName(value) {
    const name = String(value ?? "").trim();
    return name.length >= 1 && name.length <= 60 && /\p{L}/u.test(name) &&
        /^[\p{L}\p{M} .\-'’]+$/u.test(name);
}

function isValidPlace(value) {
    const place = String(value ?? "").trim();
    return place.length >= 1 && place.length <= 80 && /[\p{L}\p{N}]/u.test(place) &&
        /^[\p{L}\p{M}\p{N} .,\-'’()/&]+$/u.test(place);
}

function isValidEmail(value) {
    const email = String(value ?? "").trim();
    if (email === "") return true;
    if (email.length > 254 || /\s/u.test(email)) return false;
    const atIndex = email.lastIndexOf("@");
    if (atIndex <= 0 || atIndex !== email.indexOf("@")) return false;
    const localPart = email.slice(0, atIndex);
    const domainLabels = email.slice(atIndex + 1).split(".");
    if (localPart.length > 64 || localPart.startsWith(".") || localPart.endsWith(".") ||
        localPart.includes("..") || !/^[\p{L}\p{N}.!#$%&'*+/=?^_`{|}~-]+$/u.test(localPart) ||
        domainLabels.length < 2) return false;
    const labelsAreValid = domainLabels.every((label) => label.length <= 63 &&
        /^[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?$/u.test(label));
    const topLevelDomain = domainLabels[domainLabels.length - 1];
    return labelsAreValid && /^(?:\p{L}{2,}|xn--[\p{L}\p{N}-]{2,})$/u.test(topLevelDomain);
}

function validateSubmission(payload) {
    if (!payload || typeof payload !== "object" || payload.disclosureAcknowledged !== true ||
        payload.privacyNoticeVersion !== PRIVACY_NOTICE_VERSION || String(payload.website || "") !== "") {
        return "invalid-disclosure";
    }
    if (!payload.personOne || !payload.personTwo ||
        !isValidName(payload.personOne.name) || !isValidName(payload.personTwo.name) ||
        !isValidPlace(payload.personOne.place) || !isValidPlace(payload.personTwo.place) ||
        !isRealIsoDate(payload.personOne.dob) || !isRealIsoDate(payload.personTwo.dob) ||
        !isValidEmail(payload.contactEmail || "")) {
        return "invalid-details";
    }

    const today = new Date().toISOString().slice(0, 10);
    const oldest = new Date();
    oldest.setUTCFullYear(oldest.getUTCFullYear() - 120);
    const oldestDob = oldest.toISOString().slice(0, 10);
    if ([payload.personOne.dob, payload.personTwo.dob].some((dob) => dob > today || dob < oldestDob)) {
        return "invalid-birthday";
    }
    if (personKey(payload.personOne) === personKey(payload.personTwo)) {
        return "duplicate-person";
    }
    if (payload.relationshipStart) {
        const latestDob = [payload.personOne.dob, payload.personTwo.dob].sort()[1];
        if (!isRealIsoDate(payload.relationshipStart) ||
            payload.relationshipStart > today || payload.relationshipStart <= latestDob) {
            return "invalid-relationship-date";
        }
    }
    if (!Number.isFinite(payload.formStartedAt) || Date.now() - payload.formStartedAt < 750 ||
        Date.now() - payload.formStartedAt > 24 * 60 * 60 * 1000) {
        return "invalid-timing";
    }
    if (typeof payload.submissionId !== "string" ||
        !/^[A-Za-z0-9-]{8,100}$/u.test(payload.submissionId)) {
        return "invalid-submission";
    }
    const submittedTime = Date.parse(payload.submittedAt);
    if (!Number.isFinite(submittedTime) || Math.abs(Date.now() - submittedTime) > 24 * 60 * 60 * 1000) {
        return "invalid-submission-time";
    }
    return "";
}

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/gu, (character) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;"
    })[character]);
}

function jsonResponse(body, status = 200, extraHeaders = {}) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            ...SECURITY_HEADERS,
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            ...extraHeaders
        }
    });
}

function isRateLimited(request) {
    const now = Date.now();
    const rawClient = request.headers.get("CF-Connecting-IP") || "unknown";
    const key = String(fnv1a(rawClient));
    const recent = (requestBuckets.get(key) || []).filter((time) => now - time < RATE_WINDOW_MS);
    if (recent.length >= RATE_LIMIT) return true;
    recent.push(now);
    requestBuckets.set(key, recent);
    if (requestBuckets.size > 5000) {
        for (const [bucketKey, times] of requestBuckets) {
            if (times.every((time) => now - time >= RATE_WINDOW_MS)) requestBuckets.delete(bucketKey);
        }
    }
    return false;
}

function buildEmailContent(payload, result) {
    const rows = [
        ["First person", payload.personOne.name],
        ["First birth date", payload.personOne.dob],
        ["First city", payload.personOne.place],
        ["Second person", payload.personTwo.name],
        ["Second birth date", payload.personTwo.dob],
        ["Second city", payload.personTwo.place],
        ["Relationship start", payload.relationshipStart || "Not provided"],
        ["Contact email", payload.contactEmail || "Not provided"],
        ["Overall score", `${result.score}%`],
        ["Name chemistry", `${result.nameScore}%`],
        ["Birthday rhythm", `${result.birthdayScore}%`],
        ["Shared story", `${result.storyScore}%`],
        ["Disclosure notice", payload.privacyNoticeVersion],
        ["Submission ID", payload.submissionId],
        ["Submitted at", payload.submittedAt || new Date().toISOString()]
    ];
    const htmlRows = rows.map(([label, value]) =>
        `<tr><th style="padding:8px 12px;text-align:left;border-bottom:1px solid #ead8e1">${escapeHtml(label)}</th>` +
        `<td style="padding:8px 12px;border-bottom:1px solid #ead8e1">${escapeHtml(value)}</td></tr>`
    ).join("");
    return {
        html: `<div style="font-family:Arial,sans-serif;color:#321526"><h1>New Pairly submission</h1>` +
            `<p>The automatic-backup disclosure ${escapeHtml(payload.privacyNoticeVersion)} was shown before calculation.</p>` +
            `<table style="border-collapse:collapse;width:100%;max-width:680px">${htmlRows}</table>` +
            `<p style="color:#715566;font-size:12px">Pairly scores are deterministic entertainment results.</p></div>`,
        plainText: ["New Pairly submission", "", "Automatic-backup disclosure: shown before calculation", ...rows.map(([label, value]) => `${label}: ${value}`)].join("\n")
    };
}

async function handleEmailSubmission(request, env) {
    const origin = request.headers.get("Origin");
    if (origin && origin !== new URL(request.url).origin) return jsonResponse({ sent: false }, 403);
    const contentLength = Number(request.headers.get("Content-Length") || 0);
    if (contentLength > 20_000) return jsonResponse({ sent: false }, 413);
    if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
        return jsonResponse({ sent: false }, 415);
    }

    let payload;
    try {
        payload = await request.json();
    } catch {
        return jsonResponse({ sent: false }, 400);
    }

    if (validateSubmission(payload)) return jsonResponse({ sent: false }, 400);
    if (isRateLimited(request)) {
        return jsonResponse({ sent: false }, 429, { "Retry-After": "600" });
    }
    if (!env?.ELASTIC_EMAIL_API_KEY || !isValidEmail(env.OWNER_EMAIL) || !env.OWNER_EMAIL ||
        !isValidEmail(env.FROM_EMAIL) || !env.FROM_EMAIL) {
        return jsonResponse({ sent: false }, 503);
    }

    const result = calculateCompatibility(payload.personOne, payload.personTwo, payload.relationshipStart || "");
    const email = buildEmailContent(payload, result);
    const providerPayload = {
        Recipients: { To: [env.OWNER_EMAIL] },
        Content: {
            Body: [
                { ContentType: "HTML", Charset: "utf-8", Content: email.html },
                { ContentType: "PlainText", Charset: "utf-8", Content: email.plainText }
            ],
            From: env.FROM_EMAIL,
            ReplyTo: payload.contactEmail || env.FROM_EMAIL,
            Subject: `Pairly result ${result.score}% — ${payload.personOne.name} + ${payload.personTwo.name}`
        },
        Options: { ChannelName: "Pairly calculator" }
    };
    let providerResponse;
    try {
        providerResponse = await fetch(EMAIL_ENDPOINT, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-ElasticEmail-ApiKey": env.ELASTIC_EMAIL_API_KEY
            },
            body: JSON.stringify(providerPayload)
        });
    } catch {
        return jsonResponse({ sent: false }, 502);
    }
    if (!providerResponse.ok) return jsonResponse({ sent: false }, 502);
    return jsonResponse({ sent: true, score: result.score });
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        if (url.pathname === "/api/send-result") {
            if (request.method !== "POST") {
                return jsonResponse({ sent: false }, 405, { "Allow": "POST" });
            }
            return handleEmailSubmission(request, env);
        }
        if (request.method !== "GET" && request.method !== "HEAD") {
            return new Response("Method not allowed", {
                status: 405,
                headers: { ...SECURITY_HEADERS, "Allow": "GET, HEAD" }
            });
        }
        const embedded = EMBEDDED_ASSETS[url.pathname];
        if (embedded) {
            return new Response(request.method === "HEAD" ? null : embedded.body, {
                status: 200,
                headers: {
                    ...SECURITY_HEADERS,
                    "Content-Type": embedded.contentType,
                    "Cache-Control": url.pathname === "/" || url.pathname === "/index.html"
                        ? "no-cache"
                        : "public, max-age=3600"
                }
            });
        }
        if (env?.ASSETS) {
            const assetResponse = await env.ASSETS.fetch(request);
            const headers = new Headers(assetResponse.headers);
            Object.entries(SECURITY_HEADERS).forEach(([name, value]) => headers.set(name, value));
            return new Response(request.method === "HEAD" ? null : assetResponse.body, {
                status: assetResponse.status,
                statusText: assetResponse.statusText,
                headers
            });
        }
        return new Response("Not found", { status: 404, headers: SECURITY_HEADERS });
    }
};
