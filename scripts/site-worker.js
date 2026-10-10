// An asset-only Worker: no storage bindings, credentials or application backend.
export function createSiteWorker(assets) {
  // Each immutable embedded asset is decoded at most once per Worker instance.
  const decoded = new Map();
  const securityHeaders = {
    "Content-Security-Policy": [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
    ].join("; "),
    "Permissions-Policy": [
      "accelerometer=()",
      "autoplay=()",
      "camera=()",
      "geolocation=()",
      "gyroscope=()",
      "microphone=()",
      "payment=()",
      "usb=()",
    ].join(", "),
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Opener-Policy": "same-origin",
  };
  const routes = {
    "/": "/index.html",
    "/index.html": "/index.html",
    "/tracker": "/tracker.html",
    "/tracker.html": "/tracker.html",
    "/manifest.webmanifest": "/manifest.webmanifest",
  };
  return {
    fetch(request) {
      const url = new URL(request.url);
      const headers = new Headers(securityHeaders);
      if (url.protocol === "https:") {
        headers.set(
          "Strict-Transport-Security",
          "max-age=63072000; includeSubDomains; preload",
        );
      }
      if (!["GET", "HEAD"].includes(request.method)) {
        headers.set("Allow", "GET, HEAD");
        headers.set("Cache-Control", "no-store");
        return new Response(null, { status: 405, headers });
      }
      let pathname;
      try {
        pathname = decodeURIComponent(url.pathname);
      } catch {
        return new Response(null, { status: 400, headers });
      }
      const route = pathname.replace(/\/$/u, "") || "/";
      if (
        ["/healthz", "/livez", "/health", "/ready"].includes(
          route.toLowerCase(),
        )
      ) {
        headers.set("Content-Type", "application/json; charset=utf-8");
        headers.set("Cache-Control", "no-store");
        const body = JSON.stringify({
          status: "ok",
          mode: "static",
          persistence: "browser-indexeddb",
        });
        return new Response(request.method === "HEAD" ? null : body, {
          headers,
        });
      }
      const alias = Object.hasOwn(routes, route.toLowerCase())
        ? routes[route.toLowerCase()]
        : null;
      const key = alias ?? pathname;
      const found = Object.hasOwn(assets, key);
      const asset = found ? assets[key] : assets["/404.html"];
      headers.set("Content-Type", asset.type);
      headers.set(
        "Cache-Control",
        alias
          ? "no-store"
          : found
            ? "public, max-age=3600"
            : "public, max-age=0",
      );
      let bytes = decoded.get(asset);
      if (!bytes) {
        bytes = Uint8Array.from(atob(asset.body), (character) =>
          character.charCodeAt(0),
        );
        decoded.set(asset, bytes);
      }
      headers.set("Content-Length", String(bytes.length));
      return new Response(request.method === "HEAD" ? null : bytes, {
        status: found ? 200 : 404,
        headers,
      });
    },
  };
}
