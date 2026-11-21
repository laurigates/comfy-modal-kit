#!/usr/bin/env node
// Tier c — load the real ComfyUI frontend in Chromium and check the pack's
// frontend extensions registered without errors.
//
//   env COMFYUI_URL            e.g. http://127.0.0.1:8188 (required)
//   env PACK_NAME              custom_nodes/ directory name (required)
//   env EXTENSION_NAMES_JSON   JSON array of app.registerExtension names (required, non-empty)
//   env OUT_DIR                smoke.json, console.jsonl, smoke.png land here (required)
//   env READY_TIMEOUT_MS       default 120000
//   env SETTLE_MS              default 3000 — quiet time after the default graph loads
//
// CommonJS + require() on purpose: the workflow installs Playwright into a
// scratch prefix and points NODE_PATH at it, which require() honours and an
// ESM `import` does not.
//
// How the registered extensions are read was checked against the shipped
// frontend (1.57.4, ComfyUI v0.43.1) rather than assumed:
//   - `/scripts/app.js` — the module every pack imports `app` from — is a shim
//     re-exporting `window.comfyAPI.app.app`; that object IS the app the
//     pack registered against.
//   - `ComfyApp.extensions` returns `useExtensionStore().extensions`, the
//     store `registerExtension` writes to (deprecated getter, still present).
//   - `window.app` is assigned in GraphView only after `app.setup()` has run
//     every extension's init/setup hooks, so it doubles as the ready signal.
//   - A pack module that throws at import does NOT surface as a pageerror:
//     extensionLoader.ts catches the rejected import() per extension. What
//     reaches the console is a `[vite:preloadError]` line from the app's own
//     bundle with `url: null` — nothing ties it to the pack (measured: a
//     top-level `throw` in web/dist/index.js on 1.57.4). So after load the
//     harness re-imports each pack module the page already fetched: the
//     module map hands back the SAME evaluation, so a module that threw
//     rejects again with its original error (attributable, exact), while a
//     healthy one resolves without re-running. Attribution also matches the
//     pack's URL in message text, source location and stack.
//   - An extension HOOK that throws (init / setup / nodeCreated / ...) is
//     caught by the frontend and logged from ITS bundle as
//     `Error calling extension '<name>' method '<hook>' {error: ...}`: the
//     message location is a core asset, and Chrome cuts the preview of the
//     error object off before the pack path (measured on 1.57.4). Such an
//     error counts when the quoted name is one the pack registers, and every
//     console error's arguments are also resolved in the page so the full
//     stack — not the truncated preview — is matched against the pack path.
// If the enumeration itself breaks in a future frontend, the known-good gate
// below (core `Comfy.*` extensions must be visible) fails loudly instead of
// reporting every pack extension as missing.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

function need(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`::error::${name} must be set`);
    process.exit(2);
  }
  return v;
}

const baseUrl = need("COMFYUI_URL").replace(/\/+$/, "");
const packName = need("PACK_NAME");
const outDir = need("OUT_DIR");
const expected = JSON.parse(need("EXTENSION_NAMES_JSON"));
if (!Array.isArray(expected) || expected.length === 0) {
  console.error("::error::EXTENSION_NAMES_JSON must be a non-empty JSON array");
  process.exit(2);
}
const readyTimeout = Number(process.env.READY_TIMEOUT_MS || 120000);
const settleMs = Number(process.env.SETTLE_MS || 3000);
const packPath = `/extensions/${encodeURIComponent(packName)}/`;
fs.mkdirSync(outDir, { recursive: true });

const consoleLog = fs.createWriteStream(path.join(outDir, "console.jsonl"));
const failures = [];
const notes = [];
const fromPack = (s) => typeof s === "string" && s.includes(packPath);
const hookErrorRe = /Error calling extension '([^']+)'/;
// Console-argument resolution is async; every pending lookup is awaited
// before the verdict is written.
const pending = [];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  page.on("console", (msg) => {
    const entry = { kind: "console", type: msg.type(), text: msg.text(), url: msg.location().url };
    consoleLog.write(`${JSON.stringify(entry)}\n`);
    const attributed = fromPack(entry.url) || fromPack(entry.text);
    if (attributed) {
      if (entry.type === "error" || (entry.type === "warning" && fromPack(entry.text))) {
        failures.push(`console.${entry.type} from ${entry.url || "?"}: ${entry.text}`);
      } else if (entry.type === "warning") {
        notes.push(`console.warn from the pack: ${entry.text}`);
      }
      return;
    }
    if (entry.type !== "error") return;
    const hook = hookErrorRe.exec(entry.text);
    if (hook && expected.includes(hook[1])) {
      failures.push(`extension hook threw: ${entry.text}`);
      return;
    }
    // Not attributable from the preview: resolve the arguments in the page.
    pending.push(
      Promise.all(
        msg.args().map((h) =>
          h
            .evaluate((v) => {
              if (v && typeof v === "object") {
                const e = v.error ?? v.reason ?? v;
                return String(e?.stack ?? e?.message ?? "");
              }
              return typeof v === "string" ? v : "";
            })
            .catch(() => ""),
        ),
      ).then((parts) => {
        const full = parts.join("\n");
        if (fromPack(full)) {
          consoleLog.write(`${JSON.stringify({ kind: "console-resolved", text: full })}\n`);
          failures.push(`console.error attributed by its stack: ${entry.text.split("\n")[0]} | ${full.split("\n").find((l) => fromPack(l))?.trim() ?? ""}`);
        }
      }),
    );
  });
  page.on("pageerror", (err) => {
    const entry = { kind: "pageerror", text: String(err), stack: err.stack || "" };
    consoleLog.write(`${JSON.stringify(entry)}\n`);
    if (fromPack(entry.stack) || fromPack(entry.text)) {
      failures.push(`uncaught ${entry.text}\n${entry.stack}`);
    }
  });
  page.on("response", (res) => {
    if (fromPack(res.url()) && res.status() >= 400) {
      failures.push(`HTTP ${res.status()} for ${res.url()}`);
    } else if (res.status() >= 500) {
      // Not attributable from the browser side (a pack route lives outside
      // /extensions/<pack>/); tier-browser.sh reads the server log for the
      // traceback that decides it. Recorded so the evidence is in one place.
      notes.push(`HTTP ${res.status()} for ${res.url()}`);
    }
  });
  page.on("requestfailed", (req) => {
    if (fromPack(req.url())) failures.push(`request failed: ${req.url()} (${req.failure()?.errorText})`);
  });

  const result = { pack: packName, url: baseUrl, expected, registered: [], missing: [] };
  try {
    await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => Boolean(window.app && window.comfyAPI?.app?.app), null, {
      timeout: readyTimeout,
    });

    const state = await page.evaluate(() => {
      const app = window.comfyAPI.app.app;
      const list = Array.isArray(app.extensions) ? app.extensions : [];
      return {
        sameApp: window.app === app,
        names: list.map((e) => e?.name).filter((n) => typeof n === "string"),
        frontendVersion: window.__COMFYUI_FRONTEND_VERSION__ ?? null,
      };
    });
    result.frontendVersion = state.frontendVersion;
    result.registered = state.names;

    // Known-good gate: the instrument must see the core extensions before its
    // silence about the pack's can mean anything.
    const core = state.names.filter((n) => n.startsWith("Comfy."));
    result.coreExtensions = core.length;
    if (core.length === 0) {
      failures.push(
        "instrument: app.extensions lists no core Comfy.* extension — the frontend no longer exposes the registry this way; update smoke.cjs",
      );
    }
    if (!state.sameApp) notes.push("window.app !== window.comfyAPI.app.app");

    // Re-import only URLs the page itself fetched: they are in the module map
    // (the loader import()s every .js under the pack's web dir), so this
    // replays their evaluation result instead of evaluating them a second time.
    result.modules = await page.evaluate(async (prefix) => {
      const seen = new Set(
        performance
          .getEntriesByType("resource")
          .map((e) => e.name)
          .filter((u) => {
            const p = new URL(u).pathname;
            return p.startsWith(prefix) && /\.m?js$/.test(p);
          }),
      );
      const out = [];
      for (const url of seen) {
        try {
          await import(url);
          out.push({ url, ok: true });
        } catch (e) {
          out.push({ url, ok: false, error: String(e?.stack || e?.message || e) });
        }
      }
      return out;
    }, packPath);
    for (const m of result.modules.filter((x) => !x.ok)) {
      failures.push(`module ${new URL(m.url).pathname} failed to evaluate: ${m.error.split("\n")[0]}`);
    }
    if (result.modules.length === 0) notes.push(`the page fetched no module under ${packPath}`);

    result.missing = expected.filter((n) => !state.names.includes(n));
    for (const n of result.missing) failures.push(`extension '${n}' is not registered (app.extensions)`);

    // Exercise the graph hooks (nodeCreated / loadedGraphNode / ...) on the
    // default workflow, where most packs do their work. Not an assertion in
    // itself: an error it provokes in the pack is caught by the listeners.
    try {
      await page.evaluate(() => window.comfyAPI.app.app.loadGraphData());
      result.defaultGraphNodes = await page.evaluate(
        () => window.comfyAPI.app.app.graph?.nodes?.length ?? null,
      );
    } catch (e) {
      notes.push(`loading the default graph failed (not attributed to the pack): ${e.message}`);
    }
    await page.waitForTimeout(settleMs);
  } catch (e) {
    failures.push(`frontend never became ready: ${e.message}`);
  }
  await Promise.allSettled(pending);

  await page.screenshot({ path: path.join(outDir, "smoke.png") }).catch(() => {});
  await browser.close();
  consoleLog.end();

  result.failures = failures;
  result.notes = notes;
  result.ok = failures.length === 0;
  fs.writeFileSync(path.join(outDir, "smoke.json"), `${JSON.stringify(result, null, 2)}\n`);
  for (const n of notes) console.log(`note: ${n}`);
  for (const f of failures) console.log(`FAIL: ${f}`);
  console.log(
    result.ok
      ? `PASS: ${expected.length} extension(s) registered, no errors from ${packPath} (frontend ${result.frontendVersion})`
      : `smoke failed with ${failures.length} problem(s)`,
  );
  process.exit(result.ok ? 0 : 1);
})().catch((e) => {
  console.error(`::error::smoke harness crashed: ${e.stack || e}`);
  process.exit(2);
});
