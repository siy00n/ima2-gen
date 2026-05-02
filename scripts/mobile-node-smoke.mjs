#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { chromium } from "@playwright/test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DIST_INDEX = join(ROOT, "ui", "dist", "index.html");
const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 430, height: 932 },
];

const SETTINGS = {
  model: "gpt-5.4-mini",
  quality: "low",
  sizePreset: "auto",
  customW: 1920,
  customH: 1088,
  format: "png",
  moderation: "low",
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function getFreePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolvePort(port));
    });
  });
}

async function jsonFetch(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    throw new Error(`${options.method ?? "GET"} ${url} failed (${res.status}): ${text}`);
  }
  return body;
}

async function waitForHealth(baseUrl) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < 15_000) {
    try {
      const health = await jsonFetch(`${baseUrl}/api/health`);
      if (health?.ok) return;
    } catch (err) {
      lastError = err;
    }
    await sleep(250);
  }
  throw new Error(`Server did not become healthy: ${lastError?.message ?? "timeout"}`);
}

function thumbnail(color, label) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="14" fill="${color}"/><text x="32" y="37" text-anchor="middle" font-size="18" font-family="Arial" fill="white">${label}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function tallResultImage() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="2400"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#111827"/><stop offset="0.52" stop-color="#0f766e"/><stop offset="1" stop-color="#f59e0b"/></linearGradient></defs><rect width="900" height="2400" fill="url(#g)"/><circle cx="450" cy="650" r="230" fill="rgba(255,255,255,0.18)"/><rect x="210" y="1180" width="480" height="760" rx="84" fill="rgba(255,255,255,0.16)"/><text x="450" y="2130" text-anchor="middle" font-size="84" font-family="Arial" fill="white">Classic Tall</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function classicHistoryItems() {
  return [
    {
      filename: "mobile-classic-tall.svg",
      url: tallResultImage(),
      createdAt: Date.now(),
      prompt:
        "A tall editorial product image for mobile layout testing, with a long prompt that should remain readable while Download, Copy image, Copy prompt, and Continue here stay tappable.",
      quality: "low",
      size: "1024x2736",
      format: "png",
      provider: "oauth",
      usage: { total_tokens: 321 },
      webSearchCalls: 0,
      kind: "classic",
      isFavorite: false,
    },
  ];
}

function graphNode(id, x, y, data) {
  return {
    id,
    x,
    y,
    data: {
      clientId: id,
      serverNodeId: data.serverNodeId ?? null,
      parentServerNodeId: null,
      name: data.name,
      prompt: data.prompt ?? "",
      imageUrl: data.imageUrl ?? null,
      status: data.status ?? "empty",
      pendingRequestId: data.pendingRequestId ?? null,
      pendingPhase: data.pendingPhase ?? null,
      pendingStartedAt: data.pendingStartedAt ?? null,
      error: data.error,
      elapsed: data.elapsed,
      provider: data.provider,
      quality: data.quality,
      size: data.size,
      format: data.format,
      model: data.model,
      settings: { ...SETTINGS, ...(data.settings ?? {}) },
      createdAt: data.createdAt,
    },
  };
}

function graphEdge(source, target, transfer) {
  return {
    id: `${source}->${target}`,
    source,
    target,
    data: {
      transferContext: true,
      transferSettings: true,
      imageTransfer: "parent",
      maxAncestorImages: 3,
      ...transfer,
    },
  };
}

function createSeedGraph() {
  const now = Date.now();
  const staleThumb = thumbnail("#64748b", "S");
  return {
    nodes: [
      graphNode("n_apple_root", 0, 0, {
        name: "Apple root",
        prompt: "A glossy red apple on a clean white table",
        status: "ready",
        serverNodeId: "seed_apple_root",
        imageUrl: thumbnail("#ef4444", "A"),
        elapsed: 1.2,
        createdAt: now - 80_000,
      }),
      graphNode("n_banana", 280, 0, {
        name: "Banana",
        prompt: "A ripe banana next to the apple",
        status: "ready",
        serverNodeId: "seed_banana",
        imageUrl: thumbnail("#eab308", "B"),
        elapsed: 1.4,
        createdAt: now - 70_000,
      }),
      graphNode("n_paper_cup", 560, 0, {
        name: "Paper cup",
        prompt: "A small paper cup holding the banana peel",
        status: "ready",
        serverNodeId: "seed_paper_cup",
        imageUrl: thumbnail("#14b8a6", "C"),
        elapsed: 1.8,
        createdAt: now - 60_000,
      }),
      graphNode("n_node_1", 840, -90, {
        name: "Node 1",
        prompt: "Turn the paper cup into a product photo",
        status: "empty",
        createdAt: now - 50_000,
      }),
      graphNode("n_node_4", 840, 90, {
        name: "Node 4",
        prompt: "Make the paper cup cinematic with dramatic shadows",
        status: "stale",
        serverNodeId: "seed_node_4_old",
        imageUrl: staleThumb,
        error: "Seeded stale result",
        createdAt: now - 40_000,
      }),
      graphNode("n_busy_child", 1120, -90, {
        name: "Busy child",
        prompt: "A queued child node for cancel-state smoke testing",
        status: "pending",
        pendingRequestId: "rq_busy_child",
        pendingPhase: "queued",
        pendingStartedAt: now,
        createdAt: now - 30_000,
      }),
      graphNode("n_city_root", 0, 300, {
        name: "City root",
        prompt: "A neon city street",
        status: "error",
        error: "Seeded error state",
        createdAt: now - 20_000,
      }),
      graphNode("n_city_empty", 280, 300, {
        name: "City empty child",
        prompt: "",
        status: "empty",
        createdAt: now - 10_000,
      }),
    ],
    edges: [
      graphEdge("n_apple_root", "n_banana", {
        imageTransfer: "parent",
        transferContext: true,
        transferSettings: true,
      }),
      graphEdge("n_banana", "n_paper_cup", {
        imageTransfer: "off",
        transferContext: true,
        transferSettings: true,
      }),
      graphEdge("n_paper_cup", "n_node_1", {
        imageTransfer: "parent",
        transferContext: true,
        transferSettings: true,
      }),
      graphEdge("n_paper_cup", "n_node_4", {
        imageTransfer: "ancestor",
        transferContext: true,
        transferSettings: true,
        maxAncestorImages: 5,
      }),
      graphEdge("n_node_1", "n_busy_child", {
        imageTransfer: "parent",
        transferContext: false,
        transferSettings: true,
      }),
      graphEdge("n_city_root", "n_city_empty", {
        imageTransfer: "off",
        transferContext: false,
        transferSettings: false,
      }),
    ],
  };
}

async function seedSession(baseUrl) {
  const existing = await jsonFetch(`${baseUrl}/api/sessions`);
  for (const session of existing.sessions ?? []) {
    await jsonFetch(`${baseUrl}/api/sessions/${encodeURIComponent(session.id)}`, {
      method: "DELETE",
    });
  }
  const created = await jsonFetch(`${baseUrl}/api/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Mobile Node Smoke" }),
  });
  const sessionId = created.session.id;
  const loaded = await jsonFetch(`${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}`);
  const graph = createSeedGraph();
  await jsonFetch(`${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/graph`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "If-Match": String(loaded.session.graphVersion),
    },
    body: JSON.stringify(graph),
  });
  return { sessionId, graph };
}

async function openMobileNodePage(browser, baseUrl, viewport) {
  const context = await browser.newContext({
    baseURL: baseUrl,
    viewport,
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  await context.addInitScript(() => {
    localStorage.setItem("ima2.uiMode", "node");
    localStorage.setItem("ima2.locale", "en");
  });
  const page = await context.newPage();
  await page.goto("/");
  await page.locator(".mobile-node-workspace").waitFor({ state: "visible", timeout: 15_000 });
  await page.locator(".mobile-node-branch-lane").first().waitFor({ state: "visible", timeout: 15_000 });
  return { context, page };
}

async function openMobileClassicPage(browser, baseUrl, viewport) {
  const context = await browser.newContext({
    baseURL: baseUrl,
    viewport,
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const historyItems = classicHistoryItems();
  await context.route("**/api/history**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("groupBy") === "session") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          sessions: [],
          loose: historyItems,
          total: historyItems.length,
          nextCursor: null,
        }),
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        items: historyItems,
        total: historyItems.length,
        nextCursor: null,
      }),
    });
  });
  await context.addInitScript(() => {
    localStorage.setItem("ima2.uiMode", "classic");
    localStorage.setItem("ima2.locale", "en");
    localStorage.setItem("ima2.selectedFilename", "mobile-classic-tall.svg");
  });
  const page = await context.newPage();
  await page.goto("/");
  await page.locator(".mobile-toolbar").waitFor({ state: "visible", timeout: 15_000 });
  await page.locator(".result-container.visible").waitFor({ state: "visible", timeout: 15_000 });
  return { context, page };
}

async function clickBottomTab(page, name) {
  await page.locator(".mobile-node-tabs").getByRole("button", { name }).click();
}

async function assertMobileToolbarHitTarget(page) {
  const misses = await page.evaluate(() => {
    return [...document.querySelectorAll(".mobile-toolbar__actions button, .mobile-toolbar .lang-toggle__btn")].flatMap((button) => {
      const rect = button.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const target = document.elementFromPoint(x, y);
      return target?.closest("button") === button ? [] : [button.getAttribute("aria-label") || button.textContent?.trim() || "toolbar button"];
    });
  });
  assert(misses.length === 0, `Mobile toolbar hit target blocked at: ${misses.join(", ")}`);
}

async function assertMobileNodeTopbarHitTarget(page) {
  const buttons = await page.locator(".mobile-node-topbar__actions button, .mobile-node-topbar .lang-toggle__btn").all();
  const misses = [];
  for (const button of buttons) {
    await button.evaluate((el) => el.scrollIntoView({ block: "nearest", inline: "center" }));
    await page.waitForTimeout(20);
    const miss = await button.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const target = document.elementFromPoint(x, y);
      return target?.closest("button") === el
        ? ""
        : el.getAttribute("aria-label") || el.textContent?.trim() || "node toolbar button";
    });
    if (miss) misses.push(miss);
  }
  assert(misses.length === 0, `Mobile Node topbar hit target blocked at: ${misses.join(", ")}`);
}

async function assertBottomTabsHitTarget(page) {
  const misses = await page.evaluate(() => {
    return [...document.querySelectorAll(".mobile-node-tabs button")].flatMap((button) => {
      const rect = button.getBoundingClientRect();
      const points = [
        [rect.left + rect.width / 2, rect.top + rect.height / 2, "middle"],
        [rect.left + rect.width / 2, rect.top + rect.height * 0.82, "lower"],
      ];
      return points.flatMap(([x, y, zone]) => {
        const target = document.elementFromPoint(x, y);
        return target?.closest(".mobile-node-tabs button") === button
          ? []
          : [`${button.textContent?.trim() || "tab"} ${zone}`];
      });
    });
  });
  assert(misses.length === 0, `Bottom tab hit target blocked at: ${misses.join(", ")}`);
}

async function assertConnector(page, source, target, expectedTransfer, expectedBadge) {
  const connector = page.locator(`.mobile-node-map-connector[data-source="${source}"][data-target="${target}"]`);
  await connector.waitFor({ state: "attached", timeout: 5_000 });
  assert((await connector.count()) === 1, `Expected one connector ${source}->${target}`);
  assert((await connector.getAttribute("data-image-transfer")) === expectedTransfer, `Wrong IMG state for ${source}->${target}`);
  assert((await connector.locator("path").count()) === 1, `Expected one SVG path for ${source}->${target}`);
  const dash = await connector.locator("path").evaluate((path) => getComputedStyle(path).strokeDasharray);
  if (expectedTransfer === "off") {
    assert(dash !== "none" && dash !== "0px", `Expected dashed off connector for ${source}->${target}, got ${dash}`);
  } else {
    assert(dash === "none" || dash === "0px", `Expected solid connector for ${source}->${target}, got ${dash}`);
  }
  const badge = connector.locator(".mobile-node-map-edge-badge");
  if (expectedBadge) {
    await badge.waitFor({ state: "attached", timeout: 5_000 });
    assert((await badge.count()) === 1, `Expected one badge for ${source}->${target}`);
    assert((await badge.textContent())?.trim() === expectedBadge, `Wrong badge for ${source}->${target}`);
  } else {
    assert((await badge.count()) === 0, `Expected no badge for ${source}->${target}`);
  }
}

async function runViewportSmoke(browser, baseUrl, viewport, screenshotDir) {
  const label = `${viewport.width}x${viewport.height}`;
  const { context, page } = await openMobileNodePage(browser, baseUrl, viewport);
  try {
    await page.locator(".mobile-node-brand strong").filter({ hasText: "Node" }).waitFor({ state: "visible", timeout: 5_000 });
    await page.locator(".mobile-node-brand").filter({ hasText: "OAuth" }).waitFor({ state: "visible", timeout: 5_000 });
    const nodeTopbarHeight = await page.locator(".mobile-node-topbar").evaluate((el) => el.getBoundingClientRect().height);
    assert(nodeTopbarHeight <= 70, `${label}: Node topbar should stay compact, got ${nodeTopbarHeight}px`);
    await assertMobileNodeTopbarHitTarget(page);
    await page.locator(".mobile-node-brand").click();
    await page.locator(".mobile-node-session-sheet").waitFor({ state: "visible", timeout: 5_000 });
    await page.locator(".mobile-node-session-sheet__backdrop").click();
    await page.locator(".mobile-node-session-sheet").waitFor({ state: "hidden", timeout: 5_000 });

    const lanes = page.locator(".mobile-node-branch-lane");
    assert((await lanes.count()) >= 2, `${label}: expected multiple branch lanes`);
    const collapsedCount = await page.locator(".mobile-node-branch-lane.is-collapsed").count();
    assert(collapsedCount === (await lanes.count()), `${label}: all lanes should start collapsed`);

    await page.locator(".mobile-node-node-search").fill("paper cup");
    await page.locator(".mobile-node-list-card").filter({ hasText: "Paper cup" }).first().waitFor({ state: "visible", timeout: 5_000 });
    await page.locator(".mobile-node-node-search").fill("");
    await page.locator(".mobile-node-status-filters").getByRole("button", { name: "Ready" }).click();
    await page.locator(".mobile-node-list-card").filter({ hasText: "Apple root" }).first().waitFor({ state: "visible", timeout: 5_000 });
    await page.locator(".mobile-node-status-filters").getByRole("button", { name: "All" }).click();

    await page.getByRole("button", { name: "Map" }).click();
    await page.locator(".mobile-node-panel--map").waitFor({ state: "visible", timeout: 5_000 });
    await assertConnector(page, "n_banana", "n_paper_cup", "off", "CS");
    await assertConnector(page, "n_paper_cup", "n_node_1", "parent", "CS");
    await assertConnector(page, "n_paper_cup", "n_node_4", "ancestor", "CS");
    await assertConnector(page, "n_node_1", "n_busy_child", "parent", "S");
    await assertConnector(page, "n_city_root", "n_city_empty", "off", null);

    await page.getByRole("button", { name: /Paper cup/ }).click();
    await page.locator(".mobile-node-focus").waitFor({ state: "visible", timeout: 5_000 });
    await page.getByLabel("Prompt").waitFor({ state: "visible", timeout: 5_000 });
    await page.locator(".mobile-node-settings").evaluate((details) => {
      if (!(details instanceof HTMLDetailsElement)) throw new Error("settings is not a details element");
      if (details.open) throw new Error("node settings should be collapsed by default");
    });
    await page.locator(".mobile-node-actions-details").evaluate((details) => {
      if (!(details instanceof HTMLDetailsElement)) throw new Error("actions is not a details element");
      if (details.open) throw new Error("actions should be collapsed by default");
    });

    await page.locator(".mobile-node-connection-summary__main").click();
    await page.locator(".mobile-node-panel--connection").waitFor({ state: "visible", timeout: 5_000 });
    const summaryImg = page.locator(".mobile-node-connection-context__summary .mobile-node-edge-chip--image");
    assert((await summaryImg.textContent())?.trim() === "IMG -", `${label}: expected initial incoming IMG -`);
    await summaryImg.click();
    assert((await summaryImg.textContent())?.trim() === "IMG P", `${label}: IMG quick chip should cycle to parent`);
    await page.getByRole("button", { name: "Done" }).click();
    await page.locator(".mobile-node-focus").waitFor({ state: "visible", timeout: 5_000 });

    await clickBottomTab(page, "Branches");
    await page.locator(".mobile-node-panel--branches").waitFor({ state: "visible", timeout: 5_000 });
    await page.locator(".mobile-node-child-card").filter({ hasText: "Node 1" }).getByRole("button", { name: "Connection settings" }).click();
    await page.locator(".mobile-node-panel--connection").waitFor({ state: "visible", timeout: 5_000 });
    await page.getByRole("button", { name: "Done" }).click();
    await page.locator(".mobile-node-panel--branches").waitFor({ state: "visible", timeout: 5_000 });
    await page.locator(".mobile-node-child-card").filter({ hasText: "Node 1" }).getByRole("button", { name: /Node 1/ }).click();
    await page.locator(".mobile-node-panel--branches").getByText("Node 1", { exact: true }).waitFor({ state: "visible", timeout: 5_000 });

    await clickBottomTab(page, "All");
    await page.locator(".mobile-node-empty--navigator").waitFor({ state: "visible", timeout: 5_000 });
    await page.locator(".mobile-node-branch-lane").filter({ hasText: "Apple root" }).locator(".mobile-node-branch-lane__header").click();
    await page.locator(".mobile-node-list-card").filter({ hasText: "Node 1" }).first().waitFor({ state: "visible", timeout: 5_000 });

    await page.getByRole("button", { name: "Gallery" }).click();
    await page.locator(".gallery").waitFor({ state: "visible", timeout: 5_000 });
    await page.getByLabel("Close gallery").click();
    await page.locator(".gallery").waitFor({ state: "hidden", timeout: 5_000 });
    await page.getByRole("button", { name: "Library" }).click();
    await page.locator(".prompt-library-panel").waitFor({ state: "visible", timeout: 5_000 });
    await page.locator(".prompt-library-panel__close").click();
    await page.locator(".prompt-library-panel").waitFor({ state: "hidden", timeout: 5_000 });
    await assertBottomTabsHitTarget(page);
  } catch (err) {
    await mkdir(screenshotDir, { recursive: true });
    const screenshotPath = join(screenshotDir, `mobile-node-smoke-${label}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    err.message = `${err.message}\nScreenshot: ${screenshotPath}`;
    throw err;
  } finally {
    await context.close();
  }
}

async function runClassicViewportSmoke(browser, baseUrl, viewport, screenshotDir) {
  const label = `${viewport.width}x${viewport.height}`;
  const { context, page } = await openMobileClassicPage(browser, baseUrl, viewport);
  try {
    await page.locator(".mobile-toolbar__title").filter({ hasText: "Classic" }).waitFor({ state: "visible", timeout: 5_000 });
    await page.locator(".mobile-toolbar__subtitle").filter({ hasText: "OAuth" }).waitFor({ state: "visible", timeout: 5_000 });
    await page.locator(".result-img").waitFor({ state: "visible", timeout: 5_000 });
    await page.locator(".result-prompt").waitFor({ state: "visible", timeout: 5_000 });
    for (const name of ["Download", "Copy image", "Copy prompt", "Continue here"]) {
      await page.locator(".result-actions").getByRole("button", { name, exact: true }).waitFor({ state: "visible", timeout: 5_000 });
    }

    const resultLayout = await page.evaluate(() => {
      const image = document.querySelector(".result-img")?.getBoundingClientRect();
      const prompt = document.querySelector(".result-prompt")?.getBoundingClientRect();
      const actions = document.querySelector(".result-actions")?.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      return {
        imageOk: !!image && image.width > 40 && image.height > 80 && image.bottom <= viewportHeight,
        promptOk: !!prompt && prompt.height > 20 && prompt.bottom <= viewportHeight,
        actionsOk: !!actions && actions.height > 40 && actions.bottom <= viewportHeight + 1,
      };
    });
    assert(resultLayout.imageOk, `${label}: Classic tall image is not contained in viewport`);
    assert(resultLayout.promptOk, `${label}: Classic prompt summary is not reachable`);
    assert(resultLayout.actionsOk, `${label}: Classic action bar is not reachable`);

    await assertMobileToolbarHitTarget(page);

    await page.getByRole("button", { name: "Open prompt library" }).click();
    await page.locator(".prompt-library-panel").waitFor({ state: "visible", timeout: 5_000 });
    await page.locator(".prompt-library-panel__close").click();
    await page.locator(".prompt-library-panel").waitFor({ state: "hidden", timeout: 5_000 });

    await page.getByRole("button", { name: "Open gallery" }).click();
    await page.locator(".gallery").waitFor({ state: "visible", timeout: 5_000 });
    await page.getByLabel("Close gallery").click();
    await page.locator(".gallery").waitFor({ state: "hidden", timeout: 5_000 });

    await page.getByRole("button", { name: "Show settings" }).click();
    await page.locator(".right-panel.drawer-open").waitFor({ state: "visible", timeout: 5_000 });
    await page.locator(".right-panel").getByText("Size / Format").waitFor({ state: "visible", timeout: 5_000 });
    await page.locator(".right-panel-toggle").click();
    await page.locator(".right-panel.drawer-open").waitFor({ state: "hidden", timeout: 5_000 });

    await page.locator(".mobile-prompt-peek").click();
    await page.locator(".sidebar--mobile-composer:not(.sidebar--prompt-collapsed) .composer__textarea").waitFor({ state: "visible", timeout: 5_000 });
    await page.getByRole("button", { name: "Hide prompt" }).click();
    await page.locator(".mobile-prompt-peek").waitFor({ state: "visible", timeout: 5_000 });

    await page.getByRole("button", { name: "Node" }).click();
    await page.locator(".mobile-node-workspace").waitFor({ state: "visible", timeout: 5_000 });
  } catch (err) {
    await mkdir(screenshotDir, { recursive: true });
    const screenshotPath = join(screenshotDir, `mobile-classic-smoke-${label}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    err.message = `${err.message}\nScreenshot: ${screenshotPath}`;
    throw err;
  } finally {
    await context.close();
  }
}

async function main() {
  if (!existsSync(DIST_INDEX)) {
    throw new Error("ui/dist/index.html is missing. Run `npm run build` before `npm run test:mobile`.");
  }

  const tmpRoot = await mkdtemp(join(tmpdir(), "ima2-mobile-smoke-"));
  const screenshotDir = join(tmpRoot, "screenshots");
  const dbPath = join(tmpRoot, "sessions.db");
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      IMA2_DB_PATH: dbPath,
      IMA2_NO_OAUTH_PROXY: "1",
      NODE_ENV: "test",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverOutput = "";
  server.stdout.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });
  server.stderr.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });

  let browser = null;
  let keepArtifacts = false;
  try {
    await waitForHealth(baseUrl);
    await seedSession(baseUrl);
    browser = await chromium.launch({ headless: true });
    for (const viewport of VIEWPORTS) {
      await runClassicViewportSmoke(browser, baseUrl, viewport, screenshotDir);
      await runViewportSmoke(browser, baseUrl, viewport, screenshotDir);
    }
    console.log("Mobile Classic and Node smoke passed for 390x844 and 430x932.");
  } catch (err) {
    keepArtifacts = true;
    console.error(serverOutput.trim());
    throw err;
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill("SIGTERM");
    await new Promise((resolveExit) => {
      const timeout = setTimeout(resolveExit, 2_000);
      server.once("exit", () => {
        clearTimeout(timeout);
        resolveExit();
      });
    });
    if (!keepArtifacts) {
      await rm(tmpRoot, { recursive: true, force: true });
    } else {
      console.error(`Kept smoke artifacts: ${tmpRoot}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
