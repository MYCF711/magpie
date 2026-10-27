// Run with Node's test runner and Playwright on the module path; see README.md.
// A repository tagged magpie-plugin that says what it is in its own
// package.json (magpie.name, magpie.summary) shows that on its card, said as
// the package's own words: no community badge, and a package that says
// nothing keeps the repository's name and GitHub's description (#3608).
// English and Chinese; the API is faked here.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { test } = require("node:test");
const { chromium, webkit } = require("playwright");

const assets = path.resolve(__dirname, "../assets");

// what its own package.json says, and what a package saying nothing of
// itself keeps: the repository's name and GitHub's description
const repos = [
  {
    spec: "github:someone/magpie-officeace", repo: "someone/magpie-officeace",
    url: "https://github.com/someone/magpie-officeace", owner: "someone",
    description: "the repository's description", stars: 3, license: "MIT", pushed: "2026-10-01T00:00:00Z",
    package: "magpie-officeace", version: "0.3.0",
    name: "OfficeAce", summary: { en: "Unofficial: OfficeAce", zh: "非官方：OfficeAce" },
  },
  {
    spec: "github:someone/magpie-plain", repo: "someone/magpie-plain",
    url: "https://github.com/someone/magpie-plain", owner: "someone",
    description: "a repository description", stars: 1, pushed: "2026-10-01T00:00:00Z",
    package: "magpie-plain", version: "1.0.0",
  },
];

function server(lang) {
  return async (route) => {
    const url = new URL(route.request().url());
    const json = (data) => route.fulfill({ json: data });
    if (url.pathname === "/boot.js") return route.fulfill({ contentType: "text/javascript", body: `window.bootPrefs = {lang:"${lang}",theme:"light",web:false};` });
    if (url.pathname === "/wails/runtime.js") return route.fulfill({ contentType: "text/javascript", body: "export const Window = {};" });
    if (url.pathname === "/api/state") return json({ agents: [], profiles: [], settings: { lang, theme: "light" } });
    if (url.pathname === "/api/providers") return json({ providers: [], presets: [], excluded: [], gateway: { running: true, window: true }, plugins: [] });
    if (url.pathname === "/api/groups") return json({ groups: [], pools: [] });
    if (url.pathname === "/api/gateway/trace") return json({ routes: [] });
    if (url.pathname === "/api/plugins/updates") return json({ checked: "2026-10-01T00:00:00Z", waiting: [], updated: [] });
    if (url.pathname === "/api/plugins/listings") return json({ listings: [] });
    if (url.pathname === "/api/plugins/github") return json({ topic: "magpie-plugin", repos });
    if (url.pathname === "/api/plugins/market" || url.pathname === "/api/plugins") {
      return json({ listings: [], state: { bun: true, bunVersion: "1.3.0", plugins: [] } });
    }
    if (url.pathname.startsWith("/api/")) return json({});
    if (!/^\/[\w./-]*$/.test(url.pathname) || url.host !== "magpie.test") return route.fulfill({ status: 404, body: "" });
    const file = path.join(assets, url.pathname === "/" ? "index.html" : url.pathname);
    const contentType = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" }[path.extname(file)];
    try { await route.fulfill({ body: await fs.readFile(file), contentType }); } catch { await route.fulfill({ status: 404, body: "" }); }
  };
}

const L = {
  en: { own: "Its own words", tip: "Its name and summary are what the package says of itself in its package.json: nobody reviewed them", name: "OfficeAce", summary: "Unofficial: OfficeAce", plain: "magpie-plain", plainSum: "a repository description" },
  zh: { own: "包自己的话", tip: "名字和简介是包在它自己的 package.json 里说的：没有人审阅过", name: "OfficeAce", summary: "非官方：OfficeAce", plain: "magpie-plain", plainSum: "a repository description" },
};

for (const engine of (process.env.BROWSER ? [process.env.BROWSER] : ["chromium", "webkit"])) {
  test(engine + ": a tagged package's own words are on its card, said as its own", async (t) => {
    const browser = await (engine === "webkit" ? webkit.launch() : chromium.launch({ channel: "chromium" }));
    t.after(() => browser.close());
    for (const lang of ["en", "zh"]) {
      await t.test(lang, async () => {
        const w = L[lang];
        const page = await (await browser.newContext({ viewport: { width: 980, height: 820 } })).newPage();
        page.setDefaultTimeout(5000);
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.route("**/*", server(lang));
        await page.goto("http://magpie.test/?view=plugins");
        const own = page.locator('#view-plugins .pm-ghsec .pm-card[data-pkg="github:someone/magpie-officeace"]').first();
        await own.waitFor();
        assert.equal((await own.locator(".pm-name b").textContent()).trim(), w.name);
        assert.equal((await own.locator(".pm-sum").textContent()).trim(), w.summary);
        const chip = own.locator(".pm-chip", { hasText: w.own });
        assert.equal(await chip.count(), 1);
        assert.equal(await chip.getAttribute("title"), w.tip);
        // the package's own words are never the community's: no badge
        assert.equal(await own.locator(".pm-verified").count(), 0);
        // a package that says nothing of itself keeps the card it had
        const plain = page.locator('#view-plugins .pm-ghsec .pm-card[data-pkg="github:someone/magpie-plain"]').first();
        await plain.waitFor();
        assert.equal((await plain.locator(".pm-name b").textContent()).trim(), w.plain);
        assert.equal((await plain.locator(".pm-sum").textContent()).trim(), w.plainSum);
        assert.equal(await plain.locator(".pm-chip", { hasText: w.own }).count(), 0);
        assert.deepEqual(errors, []);
      });
    }
  });
}
