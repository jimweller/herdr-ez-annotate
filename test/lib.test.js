// node test/lib.test.js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseJsonl, toJsonl, captureOrder, forTerminal, trimQuote, formatCompact, pendingRequest, PENDING_MAX_AGE_MS, submitAction, saveHint, trackClip, clipFallback, CLIP_MAX_AGE_MS } from "../mods/ez-annotate/lib.js";

const a = (id, sel, comment, createdAt, ctx = {}, kind) => ({ selectedText: sel, capturedAt: createdAt, context: ctx, id, comment, createdAt, ...(kind ? { kind } : {}) });
const one = a("1", "  use the reply review.\n", "Is this the TUI?", "2026-10-30T06:00:57.177Z", { terminal_id: "t1" });
const two = a("2", "first\n\n  second  \nthird\nlast", "Fix\nboth", "2026-10-30T06:00:00.000Z", { terminal_id: "t1" });
const ok = a("3", "npm test passed", "", "2026-10-30T07:00:00.000Z", { terminal_id: "t1" }, "ok");
const del = a("4", "rm -rf build", " and this ", "2026-10-30T08:00:00.000Z", { terminal_id: "t2" }, "delete");
const note = a("5", "", "General note", "2026-10-30T09:00:00.000Z", { terminal_id: "t2" });

assert.equal(formatCompact(forTerminal([one, two, ok], "t1")),
`# Annotations on terminal selections

## Annotation 1
Comment on:
\`\`\`
first
…
last
\`\`\`
> Fix
> both

## Annotation 2
Comment on: "use the reply review."
> Is this the TUI?

## Annotation 3
Comment on: "npm test passed"
> ✓ looks good`);

const where = { terminal_id: "t2", workspace_label: "api", tab_label: "server" };
assert.equal(formatCompact([{ ...del, context: where }, note]),
`# Annotations on terminal selections (api / server)

## Annotation 1
Comment on: "rm -rf build"
> ✗ remove/undo this
> and this

## Annotation 2
> General note`);

// A quote with backticks gets a longer fence.
assert.ok(formatCompact([a("7", "x ```y```\nz", "", "")]).includes("````\nx ```y```\nz\n````"));

assert.deepEqual(trimQuote("a\nb"), ["a", "b"]);
assert.deepEqual(trimQuote("x".repeat(5), 3), ["xxx…"]);
assert.deepEqual(forTerminal([one, two, del, { id: "6", context: {} }], "t2").map((x) => x.id), ["4"]);
assert.deepEqual(captureOrder([one, two]).map((x) => x.id), ["2", "1"]);
assert.deepEqual(parseJsonl(toJsonl([one, two]) + "\n"), [one, two]);

// The TUI's own archive file parses as-is (read only).
try {
  const sets = parseJsonl(readFileSync(`${process.env.HOME}/.local/state/herdr/plugins/annotate/archives.jsonl`, "utf8"));
  assert.ok(sets.every((s) => s.version === 1 && Array.isArray(s.annotations)));
  formatCompact(sets.flatMap((s) => s.annotations));
} catch (e) { if (e.code !== "ENOENT") throw e; }

// The key opens the Annotate section and leaves a pending request for the panel. A bare time
// asks the panel to copy the selection itself. With the section shut, the key copies first and
// passes the text, because opening the panel changes the layout before the panel can copy.
assert.deepEqual(pendingRequest(5000, 5000), { text: null, terminal: null });
assert.deepEqual(pendingRequest(5000, 5000 + PENDING_MAX_AGE_MS), { text: null, terminal: null });
assert.equal(pendingRequest(5000, 5001 + PENDING_MAX_AGE_MS), null);
assert.equal(pendingRequest(null, 5000), null);
assert.equal(pendingRequest(undefined, 5000), null);
assert.equal(pendingRequest(9000, 5000), null);
assert.deepEqual(pendingRequest({ at: 5000, text: "npm test", terminal: "t3" }, 5100), { text: "npm test", terminal: "t3" });
assert.deepEqual(pendingRequest({ at: 5000, text: "", terminal: "t3" }, 5100), { text: "", terminal: "t3" });
assert.equal(pendingRequest({ at: 5000, text: "npm test" }, 5001 + PENDING_MAX_AGE_MS), null);
assert.equal(pendingRequest({ text: "npm test" }, 5000), null);


// The comment box: Cmd+Enter (Ctrl+Enter off macOS, GPUI's "secondary") saves; Enter adds a line.
assert.equal(submitAction({ secondary: true }), "save");
assert.equal(submitAction({ secondary: true, shift: true }), "save");
assert.equal(submitAction({}), "newline");
assert.equal(submitAction({ shift: true }), "newline");
assert.equal(submitAction(undefined), "newline");
assert.equal(saveHint("macos"), "Cmd+Enter save · Enter new line · Esc cancel");
assert.equal(saveHint("linux"), "Ctrl+Enter save · Enter new line · Esc cancel");
assert.equal(saveHint("windows"), "Ctrl+Enter save · Enter new line · Esc cancel");
// The clipboard fallback for programs that take the mouse and copy a selection themselves.
// The first read is the baseline: text already on the clipboard is never fresh.
const base = trackClip(null, "old", true, 1000);
assert.deepEqual(base, { text: "old", at: 1000, fresh: false });
assert.equal(trackClip(base, "old", true, 2000), base);
// A change while a terminal is watched is fresh; one made elsewhere is not.
const dragged = trackClip(base, "dragged in claude", true, 2000);
assert.deepEqual(dragged, { text: "dragged in claude", at: 2000, fresh: true });
assert.equal(trackClip(base, "copied in a browser", false, 2000).fresh, false);
assert.equal(trackClip(base, "   ", true, 2000).fresh, false);
// A copy's sentinel (ez-annotate:...) is this mod's own write, from the panel or the top bar.
// Skipping it keeps it out of the fallback, and the restored text then matches the baseline.
assert.equal(trackClip(base, "ez-annotate:1795450101572:0.05", true, 2000), base);
assert.equal(trackClip(trackClip(base, "ez-annotate:abc", true, 2000), "old", true, 2100), base);
// Fresh text is used until it is older than CLIP_MAX_AGE_MS.
assert.equal(clipFallback(dragged, 2000 + CLIP_MAX_AGE_MS), "dragged in claude");
assert.equal(clipFallback(dragged, 2001 + CLIP_MAX_AGE_MS), "");
assert.equal(clipFallback(base, 1000), "");
assert.equal(clipFallback(null, 1000), "");

// install.py binds the send key next to the annotate key, on both modifier sets.
const keys = readFileSync(new URL("../install.py", import.meta.url), "utf8").match(/^KEYS = \{([\s\S]*?)\}$/m)[1];
for (const k of ["ctrl-shift-s", "cmd-shift-s"]) assert.match(keys, new RegExp(`"${k}": f"\\{MOD\\}\\.send"`));

console.log("ok");
