import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { spawn } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const PORT = String(20000 + Math.floor(Math.random() * 2000));
const FAKE_HOME = mkdtempSync(join(tmpdir(), "ima2-b9-home-"));
const GEN_DIR = join(process.cwd(), "generated");
const TEST_PREFIX = `b9test_${Date.now()}_`;

async function waitForHealth(base, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(500) });
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("server did not start");
}

describe("History: delete tombstone + pagination", () => {
  let child;
  const base = `http://localhost:${PORT}`;
  const createdFiles = [];

  before(async () => {
    mkdirSync(GEN_DIR, { recursive: true });
    const pngStub = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
      "base64",
    );
    for (let i = 0; i < 3; i++) {
      const ts = Date.now() + i;
      const fn = `${TEST_PREFIX}${ts}_${i}.png`;
      writeFileSync(join(GEN_DIR, fn), pngStub);
      writeFileSync(join(GEN_DIR, `${fn}.json`), JSON.stringify({
        createdAt: ts,
        prompt: `server-search-${TEST_PREFIX}-${i}`,
        kind: "classic",
        provider: "oauth",
        sessionId: `${TEST_PREFIX}session-${i % 2}`,
      }));
      createdFiles.push(fn);
      createdFiles.push(`${fn}.json`);
    }
    const invalidFn = `${TEST_PREFIX}invalid.png`;
    writeFileSync(join(GEN_DIR, invalidFn), "hello");
    createdFiles.push(invalidFn);

    child = spawn("node", ["server.js"], {
      env: {
        ...process.env,
        PORT,
        HOME: FAKE_HOME,
        USERPROFILE: FAKE_HOME,
        IMA2_NO_OAUTH_PROXY: "1",
      },
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    await waitForHealth(base);
  });

  after(async () => {
    if (child && !child.killed) {
      child.kill(process.platform === "win32" ? "SIGINT" : "SIGTERM");
      await new Promise((r) => child.on("exit", r));
    }
    rmSync(FAKE_HOME, { recursive: true, force: true });
    for (const fn of createdFiles) {
      try { rmSync(join(GEN_DIR, fn), { force: true }); } catch {}
    }
    const trash = join(GEN_DIR, ".trash");
    if (existsSync(trash)) {
      for (const e of readdirSync(trash)) {
        if (e.includes(TEST_PREFIX)) {
          try { rmSync(join(trash, e), { force: true }); } catch {}
        }
      }
    }
  });

  it("delete moves file to .trash and restore brings it back", async () => {
    const target = createdFiles[0];
    const srcPath = join(GEN_DIR, target);
    assert.ok(existsSync(srcPath), "seed file exists");

    const delRes = await fetch(`${base}/api/history/${encodeURIComponent(target)}`, {
      method: "DELETE",
    });
    assert.strictEqual(delRes.status, 200, "delete returns 200");
    const delBody = await delRes.json();
    assert.ok(delBody.ok);
    assert.ok(delBody.trashId, "trashId returned");
    assert.ok(!existsSync(srcPath), "source file removed from generated/");

    const trashDir = join(GEN_DIR, ".trash");
    assert.ok(existsSync(trashDir), ".trash/ created");

    const restoreRes = await fetch(
      `${base}/api/history/${encodeURIComponent(target)}/restore`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trashId: delBody.trashId }),
      },
    );
    assert.strictEqual(restoreRes.status, 200, "restore returns 200");
    assert.ok(existsSync(srcPath), "file restored to generated/");
  });

  it("history pagination is deduped by composite cursor", async () => {
    const res1 = await fetch(`${base}/api/history?limit=2`);
    assert.strictEqual(res1.status, 200);
    const page1 = await res1.json();
    assert.ok(Array.isArray(page1.items), "items array present");
    if (!page1.nextCursor) return; // not enough history for pagination

    const { before, beforeFilename } = page1.nextCursor;
    const res2 = await fetch(
      `${base}/api/history?limit=2&before=${before}&beforeFilename=${encodeURIComponent(
        beforeFilename,
      )}`,
    );
    assert.strictEqual(res2.status, 200);
    const page2 = await res2.json();
    const overlap = page2.items.filter((b) =>
      page1.items.some((a) => a.filename === b.filename),
    );
    assert.strictEqual(overlap.length, 0, "no duplicates across pages");
  });

  it("groupBy=session returns sessions + loose arrays", async () => {
    const res = await fetch(`${base}/api/history?groupBy=session&limit=100`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.sessions), "sessions array");
    assert.ok(Array.isArray(body.loose), "loose array");
  });

  it("history exposes thumbnails and hides invalid image files", async () => {
    const res = await fetch(`${base}/api/history?limit=100`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    const invalid = body.items.find((item) => item.filename?.endsWith("invalid.png"));
    assert.strictEqual(invalid, undefined, "invalid png is hidden from history");
    const seededFilename = createdFiles.find((name) => name.endsWith("_1.png"));
    const seeded = body.items.find((item) => item.filename === seededFilename);
    assert.ok(seeded?.thumb?.startsWith("/api/history/thumbnail?"), "thumbnail URL is exposed");

    const thumbRes = await fetch(`${base}${seeded.thumb}`);
    assert.strictEqual(thumbRes.status, 200);
    assert.match(thumbRes.headers.get("content-type") || "", /^image\/webp/);
    const thumbBytes = Buffer.from(await thumbRes.arrayBuffer());
    assert.ok(thumbBytes.length > 0, "thumbnail body is non-empty");
  });

  it("history search and favorite filters paginate over the filtered result set", async () => {
    const query = `server-search-${TEST_PREFIX}`;
    const searchRes1 = await fetch(`${base}/api/history?limit=2&q=${encodeURIComponent(query)}`);
    assert.strictEqual(searchRes1.status, 200);
    const searchPage1 = await searchRes1.json();
    assert.strictEqual(searchPage1.total, 3, "search total is filtered");
    assert.strictEqual(searchPage1.items.length, 2, "search page respects limit");
    assert.ok(searchPage1.items.every((item) => item.prompt?.includes(query)), "search only returns matching prompts");
    assert.ok(searchPage1.nextCursor, "search page exposes cursor");

    const { before, beforeFilename } = searchPage1.nextCursor;
    const searchRes2 = await fetch(
      `${base}/api/history?limit=2&q=${encodeURIComponent(query)}&before=${before}&beforeFilename=${encodeURIComponent(beforeFilename)}`,
    );
    assert.strictEqual(searchRes2.status, 200);
    const searchPage2 = await searchRes2.json();
    assert.strictEqual(searchPage2.total, 3, "cursor search keeps filtered total");
    assert.strictEqual(searchPage2.items.length, 1, "cursor returns remaining filtered result");
    assert.ok(
      !searchPage2.items.some((b) => searchPage1.items.some((a) => a.filename === b.filename)),
      "search cursor has no overlap",
    );

    const favoriteTarget = createdFiles.find((name) => name.endsWith("_1.png"));
    const favoriteRes = await fetch(`${base}/api/history/${encodeURIComponent(favoriteTarget)}/favorite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ favorite: true }),
    });
    assert.strictEqual(favoriteRes.status, 200);

    const favoritesRes = await fetch(`${base}/api/history?favoritesOnly=true&q=${encodeURIComponent(query)}&limit=10`);
    assert.strictEqual(favoritesRes.status, 200);
    const favoritesPage = await favoritesRes.json();
    assert.strictEqual(favoritesPage.total, 1, "favorites total is filtered");
    assert.strictEqual(favoritesPage.items[0]?.filename, favoriteTarget);
    assert.strictEqual(favoritesPage.items[0]?.isFavorite, true);

    const groupedSearchRes = await fetch(`${base}/api/history?groupBy=session&q=${encodeURIComponent(query)}&limit=2`);
    assert.strictEqual(groupedSearchRes.status, 200);
    const groupedSearch = await groupedSearchRes.json();
    const groupedItems = [
      ...groupedSearch.sessions.flatMap((group) => group.items),
      ...groupedSearch.loose,
    ];
    assert.strictEqual(groupedSearch.total, 3, "grouped search total is filtered");
    assert.strictEqual(groupedItems.length, 2, "grouped search page respects limit");
    assert.ok(groupedItems.every((item) => item.prompt?.includes(query)), "grouped search only returns matching prompts");

    const groupedFavoritesRes = await fetch(`${base}/api/history?groupBy=session&favoritesOnly=true&q=${encodeURIComponent(query)}&limit=10`);
    assert.strictEqual(groupedFavoritesRes.status, 200);
    const groupedFavorites = await groupedFavoritesRes.json();
    const groupedFavoriteItems = [
      ...groupedFavorites.sessions.flatMap((group) => group.items),
      ...groupedFavorites.loose,
    ];
    assert.strictEqual(groupedFavorites.total, 1, "grouped favorites total is filtered");
    assert.strictEqual(groupedFavoriteItems[0]?.filename, favoriteTarget);
    assert.strictEqual(groupedFavoriteItems[0]?.isFavorite, true);
  });
});
