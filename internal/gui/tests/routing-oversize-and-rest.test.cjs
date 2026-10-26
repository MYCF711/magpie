// Run with Node's test runner and Playwright on the module path; see README.md.
//
// Three things the Routing page's Accounts and keys list got wrong, all found
// together on one request (the owner, 10-26):
//
//  1. A member whose model's window is known to take less than the request is
//     held out of the gateway's plan (roomy) and so is absent from Route.Order.
//     The page drew a row per seat of Order and left the held-out ones out
//     entirely, so a group of six members came to thirteen rows with one member
//     nowhere on the page — not resting, not barred, not out of allowance, and
//     with nothing said of it. It is drawn at its place now, saying why.
//  2. A resting seat's own allowance line was drawn over its rest, so thirteen
//     rate limited accounts read as thirteen balances, with no word of when
//     they come back. The rest stands; the allowance is only said of a seat
//     that is saying nothing else.
//  3. A model the vendor serves free is not near a limit and is not a failure:
//     its line reads in the row's own colour, never red, and a free seat at
//     100% is not marked "kept for last".
//
// English and Chinese, 1100 and 420 wide, both engines, no backend.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { test } = require("node:test");
const { chromium, webkit } = require("playwright");

const assets = path.resolve(__dirname, "../assets");
const now = new Date();
const ago = (s) => new Date(now.getTime() - s * 1e3).toISOString();
const ahead = (m) => new Date(Date.now() + m * 60e3).toISOString();
const acct = (p, name, user, model, extra = {}) => ({ id: `${p}@${user}`, provider: p, name, who: user, kind: "account", model, plan: "Pro", known: true, used: 10, ...extra });

// its model takes 200K, and this request is longer: roomy holds it out of
// Order and names it in Route.Small instead
const zen = acct("zen", "OpenCode Zen Free", "api-key", "deepseek-v4.1-flash-free", { free: true, used: 100 });
// rate limited, 12 minutes to go
const buddy = acct("buddy", "WorkBuddy", "13307940660", "deepseek-v4.1-flash", { used: 39, rest: { why: "quota", status: 429, until: ahead(12), key: "buddy@13307940660", for: 3600e9 } });
// a free seat that is on and answering nothing: it says "free", not its 100%
const buddyAi = acct("buddy-ai", "WorkBuddy AI", "mycf711", "deepseek-v4.1-flash", { free: true, used: 100 });
const codearts = acct("codearts", "CodeArts", "hw1", "deepseek-v4.1-flash", { used: 4 });

const group = { id: "flash", name: "Flash", routing: "frugal/expiring",
  members: ["zen/deepseek-v4.1-flash-free", "buddy/deepseek-v4.1-flash", "buddy-ai/deepseek-v4.1-flash", "codearts/deepseek-v4.1-flash"] };
const route = {
  id: 1, seq: 1, time: ago(20), agent: "dsh", model: "group/flash", provider: "codearts", done: true, status: 200, ms: 900, tokens: 1200, group,
  order: [codearts, buddyAi, buddy],
  small: [zen],
  tries: [{ id: codearts.id, model: "deepseek-v4.1-flash", start: ago(20), done: true, status: 200, ms: 900 }],
};

const cards = [
  { provider: "buddy", name: "WorkBuddy", kind: "subscription", user: "13307940660", plan: "Free plan", windows: [
    { name: "Credits", used: 39, limit: 3500, amount: 1385.42, display: "1385.42 / 3500", unit: "credits" },
  ] },
  { provider: "zen", name: "OpenCode Zen Free", kind: "subscription", user: "api-key", plan: "OpenCode Zen Free", windows: [] },
  { provider: "buddy-ai", name: "WorkBuddy AI", kind: "subscription", user: "mycf711", plan: "Free plan", windows: [] },
];

function serve(lang) {
  return async (request) => {
    const url = new URL(request.request().url());
    const json = (data) => request.fulfill({ json: data });
    if (url.pathname === "/boot.js") return request.fulfill({ contentType: "text/javascript", body: `window.bootPrefs = {lang:"${lang}",theme:"light",web:true};` });
    if (url.pathname === "/wails/runtime.js") return request.fulfill({ contentType: "text/javascript", body: "export const Window = {};" });
    if (url.pathname === "/api/state") return json({ agents: [{ id: "dsh", name: "DeepSeek Harness", path: "/test/dsh", fields: [] }], profiles: [], settings: { lang, theme: "light" } });
    if (url.pathname === "/api/gateway/trace") {
      if (url.searchParams.get("wait")) { await new Promise((r) => setTimeout(r, 20e3)); return json({}); }
      return json({ mine: true, now: now.toISOString(), seq: 1, totals: { requests: 1, rerouted: 0, errors: 0 }, routes: [route] });
    }
    if (url.pathname === "/api/usage/quotas") return json(cards);
    if (url.pathname === "/api/usage/quotas/history") return json([]);
    if (url.pathname === "/api/gateway/history") return json({ cut: false, days: [], routes: [] });
    if (url.pathname === "/api/groups") return json({ groups: [], pools: [] });
    if (url.pathname === "/api/providers") return json({ providers: [], excluded: [], gateway: { running: true, window: true } });
    if (url.pathname.startsWith("/api/")) return json({});
    const file = path.join(assets, url.pathname === "/" ? "index.html" : url.pathname);
    const contentType = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" }[path.extname(file)];
    await request.fulfill({ body: await fs.readFile(file), contentType });
  };
}

const words = {
  en: {
    oversize: "this request is longer than its window, so it was passed over",
    rest: "rate limited · back in 12 min",
    free: "free",
  },
  zh: {
    oversize: "这个请求比它的窗口长，本轮跳过了它",
    rest: "限流 · 12 分钟后恢复",
    free: "免费",
  },
};

for (const engine of (process.env.BROWSER ? [process.env.BROWSER] : ["chromium", "webkit"])) {
  for (const lang of Object.keys(words)) {
    for (const width of [1100, 420]) {
      test(`${engine} ${lang} ${width}: a free member, a held-out member and a resting one each say their own thing`, async (t) => {
        const browser = await (engine === "webkit" ? webkit.launch() : chromium.launch({ channel: "chromium" }));
        t.after(() => browser.close());
        const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
        page.setDefaultTimeout(5000);
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.route("**/*", serve(lang));
        await page.goto("http://magpie.test/?view=routing");
        await page.locator(".rt-accts li.rt-fold, .rt-accts > li").first().waitFor();
        await page.waitForFunction(() => document.querySelector(".rt-accts li em")?.textContent.trim());
        // let the allowances (one call away) and the redraw after them land
        await page.waitForFunction(() => [...document.querySelectorAll(".rt-accts li em")].some((e) => /free|免费/.test(e.textContent)));
        const rows = await page.locator(".rt-accts > li").evaluateAll((lis) => lis.map((li) => {
          const em = li.querySelector("em");
          return {
            who: li.querySelector(".who")?.textContent ?? null,
            st: em?.textContent.trim() ?? "",
            color: em ? getComputedStyle(em).color : "",
            free: li.classList.contains("free"),
            rest: li.classList.contains("rest"),
            left: li.classList.contains("left"),
          };
        }));
        const row = (who) => {
          const r = rows.find((x) => x.who === who);
          assert.ok(r, `${who} is drawn: ${JSON.stringify(rows)}`);
          return r;
        };
        // 1. the member held out for the request's size is on the page, at its
        //    place and saying why — it is neither resting nor barred
        const z = row("api-key");
        assert.equal(z.st, words[lang].oversize);
        assert(!z.rest, "held out for its window is not resting");
        // 2. the rate limited seat says its rest, with when it is back, and its
        //    allowance line is not drawn over it
        const b = row("13307940660");
        assert.equal(b.st, words[lang].rest);
        assert(b.rest);
        // 3. a free seat says "free", in the row's own colour and never red
        const f = row("mycf711");
        assert.equal(f.st, words[lang].free);
        assert(f.free, "the free row is marked as one");
        assert(!/rgb\(2\d\d, *[0-9]+, *[0-9]+\)/.test(f.color), `free is not red: ${f.color}`);
        // the two engine's own idea of red is what a real failure is in; the
        // resting row is the one that has it
        assert.notEqual(f.color, b.color, "free and resting do not read alike");
        // nothing spills at either width
        if (width < 560) await page.locator(".rt.max560 .rt-accts.max460").waitFor();
        const spills = await page.locator(".rt-accts li").evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().right > document.documentElement.clientWidth + 0.5).map((e) => e.textContent.slice(0, 40)));
        assert.deepEqual(spills, []);
        assert.deepEqual(errors, []);
      });
    }
  }
}
