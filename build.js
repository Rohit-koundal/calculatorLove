"use strict";

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = __dirname;
const distRoot = path.join(projectRoot, "dist");
const clientRoot = path.join(distRoot, "client");
const serverRoot = path.join(distRoot, "server");
const hostingSource = path.join(projectRoot, ".openai", "hosting.json");
const textAssets = {
    "/": ["index.html", "text/html; charset=utf-8"],
    "/index.html": ["index.html", "text/html; charset=utf-8"],
    "/styles.css": ["styles.css", "text/css; charset=utf-8"],
    "/script.js": ["script.js", "text/javascript; charset=utf-8"]
};

fs.rmSync(distRoot, { recursive: true, force: true });
fs.mkdirSync(clientRoot, { recursive: true });
fs.mkdirSync(serverRoot, { recursive: true });

for (const [, [fileName]] of Object.entries(textAssets)) {
    fs.copyFileSync(path.join(projectRoot, fileName), path.join(clientRoot, fileName));
}

fs.cpSync(path.join(projectRoot, "public"), path.join(clientRoot, "public"), {
    recursive: true
});

const embeddedAssets = Object.fromEntries(
    Object.entries(textAssets).map(([route, [fileName, contentType]]) => [
        route,
        {
            body: fs.readFileSync(path.join(projectRoot, fileName), "utf8"),
            contentType
        }
    ])
);
const workerTemplate = fs.readFileSync(
    path.join(projectRoot, "worker-template.mjs"),
    "utf8"
);
const placeholder = "/*__PAIRLY_EMBEDDED_ASSETS__*/ {}";

if (!workerTemplate.includes(placeholder)) {
    throw new Error("Worker asset placeholder is missing.");
}

const workerSource = workerTemplate.replace(placeholder, JSON.stringify(embeddedAssets));
fs.writeFileSync(path.join(serverRoot, "index.js"), workerSource, "utf8");
fs.writeFileSync(
    path.join(serverRoot, "package.json"),
    `${JSON.stringify({ type: "module" }, null, 2)}\n`,
    "utf8"
);
if (fs.existsSync(hostingSource)) {
    const hostingTarget = path.join(distRoot, ".openai", "hosting.json");
    fs.mkdirSync(path.dirname(hostingTarget), { recursive: true });
    fs.copyFileSync(hostingSource, hostingTarget);
}
console.log("Pairly build created in dist/.");
