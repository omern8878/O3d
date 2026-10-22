// Runs the competitor benchmark (O3d vs. Three.js vs. a JS scene graph) in
// headless Chrome on a real WebGPU device and writes:
//   docs/media/benchmark-results.json  raw report
//   docs/media/benchmark-results.md    every scale as Markdown tables
//   docs/media/benchmark-results.png   the dashboard at the largest scale
// and refreshes the README block between the benchmark markers.
//
// Usage: npm run build && npm run benchmark
//   O3D_BENCH_SCALES=10000,50000,100000  entity counts (default)
//   O3D_BENCH_FRAMES=30,120              warm-up, measured frames (default)
//   O3D_BROWSER_CHANNEL=chrome           Playwright browser channel (default)
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { renderBenchmarkMarkdown } from "../apps/playground/src/benchmark/report/benchmark-markdown.ts";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const media = join(root, "docs", "media");
const readmePath = join(root, "README.md");
const PORT = 4181;
const scales = process.env.O3D_BENCH_SCALES ?? "10000,50000,100000";
const frames = process.env.O3D_BENCH_FRAMES ?? "30,120";
const channel = process.env.O3D_BROWSER_CHANNEL ?? "chrome";
const README_START = "<!-- benchmark:start -->";
const README_END = "<!-- benchmark:end -->";
const RUN_TIMEOUT_MS = 30 * 60 * 1000;

mkdirSync(media, { recursive: true });
const server = await startPreviewServer();
const browser = await chromium.launch({
  channel: channel === "chromium" ? undefined : channel,
  headless: true,
  // Exact heap numbers need a forcible GC and unrounded performance.memory.
  args: ["--enable-unsafe-webgpu", "--js-flags=--expose-gc", "--enable-precise-memory-info"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("pageerror", (error) => console.error("page error:", error.message));
  await page.goto(`http://localhost:${PORT}/?benchScales=${scales}&benchFrames=${frames}`);
  await page.waitForSelector("body[data-ready=true]");
  const backend = await page.getAttribute("body", "data-backend");
  if (!(await page.evaluate(() => crossOriginIsolated))) console.warn("warning: page is not cross-origin isolated (timer resolution ~100 µs)");
  console.log(`backend: ${backend}; scales ${scales}; frames ${frames}`);

  await page.click("[data-testid=run-benchmark]");
  const progress = setInterval(async () => {
    const label = await page.locator(".progress-label").innerText().catch(() => "");
    if (label) console.log(label.replace(/\s+/g, " "));
  }, 10_000);
  await page.waitForSelector("[data-testid=benchmark-panel][data-state=done]", { timeout: RUN_TIMEOUT_MS });
  clearInterval(progress);

  const report = await page.evaluate(() => window.__o3dBenchmarkReport);
  writeFileSync(join(media, "benchmark-results.json"), `${JSON.stringify(report, null, 2)}\n`);
  const markdown = renderBenchmarkMarkdown(report);
  writeFileSync(join(media, "benchmark-results.md"), `# Competitor benchmark results\n\n${markdown}`);
  updateReadme(report);

  // A tall viewport so the whole dashboard fits in one screenshot.
  const height = await page.locator(".modal").evaluate((el) => el.scrollHeight + 80);
  await page.setViewportSize({ width: 1280, height: Math.min(height, 6000) });
  await page.waitForTimeout(300);
  await page.locator(".modal").screenshot({ path: join(media, "benchmark-results.png") });
  console.log("wrote benchmark-results.json, .md, .png and the README block");
} finally {
  await browser.close();
  server.kill();
}

/** Replaces the README section between the markers with the largest scale's tables. */
function updateReadme(report) {
  const readme = readFileSync(readmePath, "utf8");
  const start = readme.indexOf(README_START);
  const end = readme.indexOf(README_END);
  if (start < 0 || end < start) {
    console.warn("README has no benchmark markers; skipped");
    return;
  }
  const largest = { ...report, scales: [report.scales.at(-1)] };
  const block = renderBenchmarkMarkdown(largest).replace(/^### /m, "#### ");
  writeFileSync(readmePath, `${readme.slice(0, start + README_START.length)}\n${block}${readme.slice(end)}`);
}

async function startPreviewServer() {
  const child = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], {
    cwd: join(root, "apps", "playground"),
    stdio: "ignore",
  });
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      if ((await fetch(`http://localhost:${PORT}/`)).ok) return child;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  child.kill();
  throw new Error("vite preview did not start; run `npm run build` first.");
}
