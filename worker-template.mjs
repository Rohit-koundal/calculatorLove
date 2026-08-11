const EMBEDDED_ASSETS = /*__PAIRLY_EMBEDDED_ASSETS__*/ {};

const SECURITY_HEADERS = {
    "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https://api.emailjs.com; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY"
};

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

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
