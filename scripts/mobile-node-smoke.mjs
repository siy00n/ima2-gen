#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
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
const SMOKE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64",
);

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

async function seedSmokeGeneratedAssets() {
  const generatedDir = join(ROOT, "generated");
  await mkdir(generatedDir, { recursive: true });
  const prefix = `mobile_smoke_${Date.now()}`;
  const valid = `${prefix}_valid.png`;
  const invalid = `${prefix}_invalid.png`;
  const validPath = join(generatedDir, valid);
  const invalidPath = join(generatedDir, invalid);
  const validMetaPath = `${validPath}.json`;
  const invalidMetaPath = `${invalidPath}.json`;
  await writeFile(validPath, SMOKE_PNG);
  await writeFile(validMetaPath, JSON.stringify({
    createdAt: Date.now() + 10_000,
    prompt: "Mobile smoke gallery thumbnail fixture",
    kind: "classic",
    provider: "oauth",
  }));
  await writeFile(invalidPath, "hello");
  await writeFile(invalidMetaPath, JSON.stringify({
    createdAt: Date.now() + 20_000,
    prompt: "Invalid smoke gallery fixture should be hidden",
    kind: "classic",
    provider: "oauth",
  }));
  return async () => {
    await rm(validPath, { force: true }).catch(() => {});
    await rm(validMetaPath, { force: true }).catch(() => {});
    await rm(invalidPath, { force: true }).catch(() => {});
    await rm(invalidMetaPath, { force: true }).catch(() => {});
  };
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
  await jsonFetch(`${baseUrl}/api/prompts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Smoke library prompt",
      text: "A compact mobile prompt library row used to verify detail navigation and backdrop closing.",
      tags: ["smoke", "mobile"],
    }),
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

async function mobileBack(page) {
  await page.evaluate(() => {
    window.history.back();
  });
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

async function assertSlideUpSheet(page, selector, label) {
  const sheet = page.locator(selector);
  await page.waitForTimeout(260);
  const motion = await sheet.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return {
      bottomAligned: Math.abs(window.innerHeight - rect.bottom) <= 4,
      animationName: style.animationName,
      animationDuration: style.animationDuration,
    };
  });
  assert(motion.bottomAligned, `${label}: sheet should be bottom aligned`);
  assert(motion.animationName.includes("mobile-sheet-slide-up"), `${label}: sheet should use slide-up animation`);
  assert(motion.animationDuration !== "0s", `${label}: sheet slide-up animation should have duration`);
}

async function assertMobileGalleryPolish(page, label, { expectTile = false } = {}) {
  await page.locator(".gallery__filter-row").waitFor({ state: "visible", timeout: 5_000 });
  const headerLayout = await page.evaluate(() => {
    const search = document.querySelector(".gallery__search");
    const favorite = document.querySelector(".gallery__favorite-filter");
    const group = document.querySelector(".gallery__group-toggle");
    if (!search || !favorite || !group) return null;
    const searchRect = search.getBoundingClientRect();
    const favoriteRect = favorite.getBoundingClientRect();
    const groupRect = group.getBoundingClientRect();
    return {
      searchWidth: searchRect.width,
      searchBottom: searchRect.bottom,
      favoriteTop: favoriteRect.top,
      favoriteHeight: favoriteRect.height,
      groupTop: groupRect.top,
      groupHeight: groupRect.height,
      favoriteRight: favoriteRect.right,
      groupLeft: groupRect.left,
    };
  });
  assert(headerLayout, `${label}: Gallery mobile filter controls are missing`);
  assert(headerLayout.searchWidth >= 280, `${label}: Gallery search should be full width`);
  assert(Math.abs(headerLayout.favoriteTop - headerLayout.groupTop) <= 6, `${label}: Gallery segmented controls should share one row`);
  assert(headerLayout.favoriteRight <= headerLayout.groupLeft + 1, `${label}: Gallery segmented controls should not overlap`);
  assert(headerLayout.searchBottom <= headerLayout.favoriteTop + 6, `${label}: Gallery filters should sit below search`);
  assert(headerLayout.favoriteHeight >= 32 && headerLayout.groupHeight >= 32, `${label}: Gallery segmented controls should keep touch height`);

  if (!expectTile) return;

  await page.locator(".gallery__tile-wrap").first().waitFor({ state: "visible", timeout: 5_000 });
  const tileLayout = await page.evaluate(() => {
    const tile = document.querySelector(".gallery__tile");
    const caption = document.querySelector(".gallery__caption");
    const tileImages = [...document.querySelectorAll(".gallery__tile img")];
    const actionButtons = [...document.querySelectorAll(".gallery__favorite, .gallery__import-node, .gallery__delete")];
    if (!tile || !caption || actionButtons.length === 0) return null;
    const tileRect = tile.getBoundingClientRect();
    const captionRect = caption.getBoundingClientRect();
    const captionStyle = getComputedStyle(caption);
    const actions = actionButtons.map((button) => {
      const rect = button.getBoundingClientRect();
      const isVisible =
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < window.innerHeight &&
        rect.left < window.innerWidth;
      const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return {
        width: rect.width,
        height: rect.height,
        isVisible,
        hit: !isVisible || target?.closest("button") === button,
        backdropFilter: getComputedStyle(button).backdropFilter,
      };
    });
    return {
      tileCount: document.querySelectorAll(".gallery__tile-wrap").length,
      imageSources: tileImages.map((img) => img.getAttribute("src") || ""),
      captions: [...document.querySelectorAll(".gallery__caption-text")].map((captionText) => captionText.textContent || ""),
      tileWidth: tileRect.width,
      tileHeight: tileRect.height,
      captionOpacity: Number.parseFloat(captionStyle.opacity),
      captionBottomInside: captionRect.bottom <= tileRect.bottom + 1,
      captionHeight: captionRect.height,
      actionButtons: actions,
    };
  });
  assert(tileLayout, `${label}: Gallery tile layout is missing`);
  assert(tileLayout.tileCount <= 72, `${label}: Gallery should not render more than the initial tile window`);
  assert(tileLayout.imageSources.every((src) => src.startsWith("data:") || src.includes("/api/history/thumbnail?")), `${label}: Gallery tiles should use thumbnails, not original generated images`);
  assert(!tileLayout.captions.some((text) => text.includes("Invalid smoke gallery fixture")), `${label}: invalid image fixtures should be hidden`);
  assert(tileLayout.tileHeight > tileLayout.tileWidth, `${label}: Gallery mobile tile should keep portrait-ish aspect ratio`);
  assert(tileLayout.captionOpacity >= 0.95, `${label}: Gallery mobile caption should be visible without hover`);
  assert(tileLayout.captionBottomInside, `${label}: Gallery caption should stay inside the tile`);
  assert(tileLayout.captionHeight <= 56, `${label}: Gallery caption should stay compact`);
  for (const action of tileLayout.actionButtons) {
    assert(action.width >= 32 && action.height >= 32, `${label}: Gallery action buttons should keep mobile hit size`);
    assert(action.hit, `${label}: Gallery action button hit target is blocked`);
    assert(action.backdropFilter === "none", `${label}: Gallery action buttons should not use backdrop-filter`);
  }
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
    const topbarActions = page.locator(".mobile-node-topbar__actions");
    assert((await topbarActions.getByRole("button", { name: /^All$/ }).count()) === 0, `${label}: All should not be in Node topbar`);
    assert((await topbarActions.getByRole("button", { name: /^\+ Root$/ }).count()) === 0, `${label}: + Root should not be in Node topbar`);
    await topbarActions.getByRole("button", { name: "Classic" }).waitFor({ state: "visible", timeout: 5_000 });
    await topbarActions.getByRole("button", { name: "Open prompt library" }).waitFor({ state: "visible", timeout: 5_000 });
    await topbarActions.getByRole("button", { name: "Open gallery" }).waitFor({ state: "visible", timeout: 5_000 });
    await topbarActions.getByRole("button", { name: "Settings" }).waitFor({ state: "visible", timeout: 5_000 });
    await assertMobileNodeTopbarHitTarget(page);
    await page.locator(".mobile-node-brand").click();
    await page.locator(".mobile-node-session-sheet").waitFor({ state: "visible", timeout: 5_000 });
    await mobileBack(page);
    await page.locator(".mobile-node-session-sheet").waitFor({ state: "hidden", timeout: 5_000 });

    const lanes = page.locator(".mobile-node-branch-lane");
    assert((await lanes.count()) >= 2, `${label}: expected multiple branch lanes`);
    const collapsedCount = await page.locator(".mobile-node-branch-lane.is-collapsed").count();
    assert(collapsedCount === (await lanes.count()), `${label}: all lanes should start collapsed`);
    const initialLaneCount = await lanes.count();
    await page.getByRole("button", { name: "Add root node" }).click();
    await page.locator(".mobile-node-focus").waitFor({ state: "visible", timeout: 5_000 });
    await clickBottomTab(page, "All");
    await page.locator(".mobile-node-empty--navigator").waitFor({ state: "visible", timeout: 5_000 });
    assert((await lanes.count()) === initialLaneCount + 1, `${label}: All heading add root should create a root lane`);

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
    await page.locator(".mobile-node-prompt textarea").waitFor({ state: "visible", timeout: 5_000 });
    await page.locator(".mobile-node-preview--button").click();
    await page.locator(".image-lightbox").waitFor({ state: "visible", timeout: 5_000 });
    await mobileBack(page);
    await page.locator(".image-lightbox").waitFor({ state: "hidden", timeout: 5_000 });
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
    const connectionDoneHeight = await page.locator(".mobile-node-panel--connection .mobile-node-panel__header").getByRole("button", { name: "Done" }).evaluate((button) => button.getBoundingClientRect().height);
    assert(connectionDoneHeight >= 36, `${label}: Connection Done button should use sheet header sizing`);
    const summaryImg = page.locator(".mobile-node-connection-context__summary .mobile-node-edge-chip--image");
    assert((await summaryImg.textContent())?.trim() === "IMG -", `${label}: expected initial incoming IMG -`);
    await summaryImg.click();
    assert((await summaryImg.textContent())?.trim() === "IMG P", `${label}: IMG quick chip should cycle to parent`);
    await summaryImg.click();
    assert((await summaryImg.textContent())?.trim() === "IMG A", `${label}: IMG quick chip should cycle to ancestor`);
    await summaryImg.click();
    assert((await summaryImg.textContent())?.trim() === "IMG -", `${label}: IMG quick chip should cycle back to off`);
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

    await page.getByRole("button", { name: "Open gallery" }).click();
    await page.locator(".gallery").waitFor({ state: "visible", timeout: 5_000 });
    await page.locator(".gallery__search").waitFor({ state: "visible", timeout: 5_000 });
    await assertSlideUpSheet(page, ".gallery", `${label}: Node Gallery`);
    await assertMobileGalleryPolish(page, `${label}: Node Gallery`, { expectTile: true });
    assert((await page.locator(".gallery__close").count()) === 0, `${label}: Gallery should not show a visible close button`);
    const nodeGalleryHandleContent = await page.locator(".gallery").evaluate((gallery) => getComputedStyle(gallery, "::before").content);
    assert(nodeGalleryHandleContent === "none", `${label}: Gallery should not show a grab handle`);
    await mobileBack(page);
    await page.locator(".gallery").waitFor({ state: "hidden", timeout: 5_000 });
    await page.getByRole("button", { name: "Open prompt library" }).click();
    await page.locator(".prompt-library-panel").waitFor({ state: "visible", timeout: 5_000 });
    await page.locator(".prompt-library-panel__search").waitFor({ state: "visible", timeout: 5_000 });
    await assertSlideUpSheet(page, ".prompt-library-panel__dialog", `${label}: Node Prompt Library`);
    await page.locator(".prompt-library-panel__favorite-filter").waitFor({ state: "visible", timeout: 5_000 });
    await page.locator(".prompt-library-panel__add").waitFor({ state: "visible", timeout: 5_000 });
    await page.locator(".prompt-library-panel__import").waitFor({ state: "visible", timeout: 5_000 });
    assert((await page.locator(".prompt-library-panel__close").count()) === 0, `${label}: Prompt Library should not show a visible close button`);
    const nodeLibraryHandleContent = await page
      .locator(".prompt-library-panel__dialog")
      .evaluate((dialog) => getComputedStyle(dialog, "::before").content);
    assert(nodeLibraryHandleContent === "none", `${label}: Prompt Library should not show a grab handle`);
    await page.locator(".prompt-library-row").first().click();
    await page.locator(".prompt-library-panel__back").waitFor({ state: "visible", timeout: 5_000 });
    await mobileBack(page);
    await page.locator(".prompt-library-panel__search").waitFor({ state: "visible", timeout: 5_000 });
    await page.locator(".prompt-library-panel__add").click();
    await page.locator(".prompt-library-editor").waitFor({ state: "visible", timeout: 5_000 });
    await page.locator(".prompt-library-panel__backdrop").click({ position: { x: 4, y: 4 } });
    await page.locator(".prompt-library-editor").waitFor({ state: "visible", timeout: 5_000 });
    await mobileBack(page);
    await page.locator(".prompt-library-panel__search").waitFor({ state: "visible", timeout: 5_000 });
    await mobileBack(page);
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
    await page.locator(".result-actions__primary").filter({ hasText: "Continue here" }).waitFor({ state: "visible", timeout: 5_000 });
    for (const name of ["Copy image", "Download", "Copy prompt"]) {
      await page.locator(".result-actions__secondary").getByRole("button", { name, exact: true }).waitFor({ state: "visible", timeout: 5_000 });
    }

    const resultLayout = await page.evaluate(() => {
      const image = document.querySelector(".result-img")?.getBoundingClientRect();
      const prompt = document.querySelector(".result-prompt")?.getBoundingClientRect();
      const actions = document.querySelector(".result-actions")?.getBoundingClientRect();
      const primary = document.querySelector(".result-actions__primary")?.getBoundingClientRect();
      const secondaryButtons = [...document.querySelectorAll(".result-actions__secondary button")].map((button) =>
        button.getBoundingClientRect(),
      );
      const viewportHeight = window.innerHeight;
      return {
        imageOk: !!image && image.width > 40 && image.height > 80 && image.bottom <= viewportHeight,
        promptOk: !!prompt && prompt.height > 20 && prompt.bottom <= viewportHeight,
        actionsOk: !!actions && actions.height > 40 && actions.bottom <= viewportHeight + 1,
        primaryOk: !!primary && primary.height >= 44,
        secondaryOk: secondaryButtons.length === 3 && secondaryButtons.every((button) => button.width > 40 && button.height >= 40),
      };
    });
    assert(resultLayout.imageOk, `${label}: Classic tall image is not contained in viewport`);
    assert(resultLayout.promptOk, `${label}: Classic prompt summary is not reachable`);
    assert(resultLayout.actionsOk, `${label}: Classic action bar is not reachable`);
    assert(resultLayout.primaryOk, `${label}: Classic Continue here primary action is too small`);
    assert(resultLayout.secondaryOk, `${label}: Classic secondary result actions are not tappable`);

    const resultSurface = await page.evaluate(() => {
      const panel = document.querySelector(".result-container.visible");
      const stage = document.querySelector(".result-stage");
      const prompt = document.querySelector(".result-prompt");
      const primary = document.querySelector(".result-actions__primary");
      if (!panel || !stage || !prompt || !primary) return null;
      const panelStyle = getComputedStyle(panel);
      const stageStyle = getComputedStyle(stage);
      const promptStyle = getComputedStyle(prompt);
      const primaryStyle = getComputedStyle(primary);
      return {
        panelRadius: Number.parseFloat(panelStyle.borderTopLeftRadius),
        panelBorder: panelStyle.borderTopColor,
        panelBg: panelStyle.backgroundColor,
        stageRadius: Number.parseFloat(stageStyle.borderTopLeftRadius),
        promptRadius: Number.parseFloat(promptStyle.borderTopLeftRadius),
        primaryHeight: primary.getBoundingClientRect().height,
        primaryBg: primaryStyle.backgroundColor,
      };
    });
    assert(resultSurface, `${label}: Classic result surface is missing`);
    assert(resultSurface.panelRadius >= 16, `${label}: Classic result panel should use unified rounded surface`);
    assert(!resultSurface.panelBorder.includes("0, 0)"), `${label}: Classic result panel should have a visible border`);
    assert(!resultSurface.panelBg.includes("0, 0)"), `${label}: Classic result panel should have a visible dark surface`);
    assert(resultSurface.stageRadius >= 12, `${label}: Classic result stage should use panel radius`);
    assert(resultSurface.promptRadius >= 12, `${label}: Classic prompt summary should use panel radius`);
    assert(resultSurface.primaryHeight >= 44, `${label}: Classic primary action should keep touch height`);
    assert(!resultSurface.primaryBg.includes("0, 0)"), `${label}: Classic primary action should keep visible accent surface`);

    await page.locator(".result-image-button").click();
    await page.locator(".image-lightbox").waitFor({ state: "visible", timeout: 5_000 });
    await mobileBack(page);
    await page.locator(".image-lightbox").waitFor({ state: "hidden", timeout: 5_000 });

    await assertMobileToolbarHitTarget(page);

    await page.getByRole("button", { name: "Open prompt library" }).click();
    await page.locator(".prompt-library-panel").waitFor({ state: "visible", timeout: 5_000 });
    await page.locator(".prompt-library-panel__title").waitFor({ state: "visible", timeout: 5_000 });
    await assertSlideUpSheet(page, ".prompt-library-panel__dialog", `${label}: Classic Prompt Library`);
    await page.locator(".prompt-library-panel__search").waitFor({ state: "visible", timeout: 5_000 });
    await page.locator(".prompt-library-panel__favorite-filter").waitFor({ state: "visible", timeout: 5_000 });
    await page.locator(".prompt-library-panel__add").waitFor({ state: "visible", timeout: 5_000 });
    await page.locator(".prompt-library-panel__import").waitFor({ state: "visible", timeout: 5_000 });
    assert((await page.locator(".prompt-library-panel__close").count()) === 0, `${label}: Classic Prompt Library should not show a visible close button`);
    const classicLibraryHandleContent = await page
      .locator(".prompt-library-panel__dialog")
      .evaluate((dialog) => getComputedStyle(dialog, "::before").content);
    assert(classicLibraryHandleContent === "none", `${label}: Classic Prompt Library should not show a grab handle`);
    await page.locator(".prompt-library-panel__backdrop").click({ position: { x: 4, y: 4 } });
    await page.locator(".prompt-library-panel").waitFor({ state: "hidden", timeout: 5_000 });

    await page.getByRole("button", { name: "Open gallery" }).click();
    await page.locator(".gallery").waitFor({ state: "visible", timeout: 5_000 });
    await page.locator(".gallery__search").waitFor({ state: "visible", timeout: 5_000 });
    await assertSlideUpSheet(page, ".gallery", `${label}: Classic Gallery`);
    await page.locator(".gallery__favorite-filter").waitFor({ state: "visible", timeout: 5_000 });
    await page.locator(".gallery__group-toggle").waitFor({ state: "visible", timeout: 5_000 });
    await assertMobileGalleryPolish(page, `${label}: Classic Gallery`, { expectTile: true });
    assert((await page.locator(".gallery__close").count()) === 0, `${label}: Classic Gallery should not show a visible close button`);
    const classicGalleryHandleContent = await page.locator(".gallery").evaluate((gallery) => getComputedStyle(gallery, "::before").content);
    assert(classicGalleryHandleContent === "none", `${label}: Classic Gallery should not show a grab handle`);
    await page.locator(".gallery-backdrop").click({ position: { x: 4, y: 4 } });
    await page.locator(".gallery").waitFor({ state: "hidden", timeout: 5_000 });

    await page.getByRole("button", { name: "Show settings" }).click();
    await page.locator(".right-panel.drawer-open").waitFor({ state: "visible", timeout: 5_000 });
    await page.locator(".mobile-sheet-header--settings").waitFor({ state: "visible", timeout: 5_000 });
    await page.locator(".right-panel").getByText("Size / Format").waitFor({ state: "visible", timeout: 5_000 });
    assert((await page.locator(".right-panel.drawer-open .right-panel-toggle").count()) === 0, `${label}: Classic Settings should not show a visible close button`);
    const settingsHandleContent = await page.locator(".right-panel.drawer-open").evaluate((panel) => getComputedStyle(panel, "::before").content);
    assert(settingsHandleContent === "none", `${label}: Classic Settings should not show a grab handle`);
    await page.locator(".right-panel-backdrop").click({ position: { x: 4, y: 4 } });
    await page.locator(".right-panel.drawer-open").waitFor({ state: "hidden", timeout: 5_000 });
    await page.getByRole("button", { name: "Show settings" }).click();
    await page.locator(".right-panel.drawer-open").waitFor({ state: "visible", timeout: 5_000 });
    await mobileBack(page);
    await page.locator(".right-panel.drawer-open").waitFor({ state: "hidden", timeout: 5_000 });

    await page.locator(".mobile-prompt-peek").click();
    await page.locator(".sidebar--mobile-composer:not(.sidebar--prompt-collapsed) .composer__textarea").waitFor({ state: "visible", timeout: 5_000 });
    assert(
      (await page.locator(".sidebar--mobile-composer:not(.sidebar--prompt-collapsed) .ui-mode-switch").count()) === 0,
      `${label}: Classic composer should not show the Classic/Node mode switch`,
    );
    assert((await page.locator(".mobile-dock-dismiss").count()) === 0, `${label}: floating Hide prompt button should be removed`);
    const handleContent = await page
      .locator(".sidebar--mobile-composer:not(.sidebar--prompt-collapsed)")
      .evaluate((sidebar) => getComputedStyle(sidebar, "::before").content);
    assert(handleContent === "none", `${label}: Classic composer should not show a grab handle`);
    const collapseButton = page.locator(".sidebar--mobile-composer .composer__collapse");
    const dismissSize = await collapseButton.evaluate((button) => {
      const rect = button.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
    assert(dismissSize.width <= 44 && dismissSize.height <= 44, `${label}: Hide prompt should be compact`);
    const composerSurface = await page.evaluate(() => {
      const composer = document.querySelector(".sidebar--mobile-composer:not(.sidebar--prompt-collapsed) .composer");
      const textarea = document.querySelector(".sidebar--mobile-composer:not(.sidebar--prompt-collapsed) .composer__textarea");
      const tool = document.querySelector(".sidebar--mobile-composer:not(.sidebar--prompt-collapsed) .composer__tool");
      const generate = document.querySelector(".sidebar--mobile-composer:not(.sidebar--prompt-collapsed) .generate-btn");
      if (!composer || !textarea || !tool || !generate) return null;
      const composerStyle = getComputedStyle(composer);
      const textareaStyle = getComputedStyle(textarea);
      const toolStyle = getComputedStyle(tool);
      return {
        composerRadius: Number.parseFloat(composerStyle.borderTopLeftRadius),
        composerBorder: composerStyle.borderTopColor,
        textareaRadius: Number.parseFloat(textareaStyle.borderTopLeftRadius),
        toolHeight: tool.getBoundingClientRect().height,
        toolRadius: Number.parseFloat(toolStyle.borderTopLeftRadius),
        generateHeight: generate.getBoundingClientRect().height,
      };
    });
    assert(composerSurface, `${label}: Classic composer surface is missing`);
    assert(composerSurface.composerRadius >= 14, `${label}: Classic composer should use unified rounded surface`);
    assert(!composerSurface.composerBorder.includes("0, 0)"), `${label}: Classic composer should have a visible border`);
    assert(composerSurface.textareaRadius >= 10, `${label}: Classic composer textarea should use unified control radius`);
    assert(composerSurface.toolHeight >= 40, `${label}: Classic composer tools should keep touch height`);
    assert(composerSurface.toolRadius >= 9, `${label}: Classic composer tools should use unified control radius`);
    assert(composerSurface.generateHeight >= 44, `${label}: Classic generate button should keep touch height`);
    await collapseButton.click();
    await page.locator(".mobile-prompt-peek").waitFor({ state: "visible", timeout: 5_000 });
    const promptPeekSurface = await page.locator(".mobile-prompt-peek").evaluate((peek) => {
      const style = getComputedStyle(peek);
      const rect = peek.getBoundingClientRect();
      return {
        height: rect.height,
        border: style.borderTopColor,
        bg: style.backgroundColor,
      };
    });
    assert(promptPeekSurface.height >= 50, `${label}: Classic prompt peek should keep tappable height`);
    assert(!promptPeekSurface.border.includes("0, 0)"), `${label}: Classic prompt peek should have a visible top border`);
    assert(!promptPeekSurface.bg.includes("0, 0)"), `${label}: Classic prompt peek should have a visible dark surface`);
    await page.locator(".mobile-prompt-peek").click();
    await page.locator(".sidebar--mobile-composer:not(.sidebar--prompt-collapsed) .composer__collapse").waitFor({ state: "visible", timeout: 5_000 });

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
  let cleanupGeneratedAssets = async () => {};
  try {
    cleanupGeneratedAssets = await seedSmokeGeneratedAssets();
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
    await cleanupGeneratedAssets().catch(() => {});
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
