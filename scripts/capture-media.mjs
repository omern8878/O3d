// Captures the README media from the production playground build:
//   docs/media/cat-2d-ortho.png, cat-3d-orbit.png, cat-zoomed-culling.png,
//   cat-showcase.webm and cat-showcase.gif.
// The benchmark media come from `npm run benchmark` (scripts/run-benchmarks.mjs).
//
// Usage: npm run build && npm run capture:media
// Uses the installed Google Chrome (real WebGPU) unless O3D_BROWSER_CHANNEL
// names another channel; set it to "chromium" for Playwright's bundled build.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import gifenc from "gifenc";
import { chromium } from "playwright";
import { PNG } from "pngjs";

const { GIFEncoder, applyPalette, quantize } = gifenc;

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const media = join(root, "docs", "media");
const PORT = 4179;
const URL = `http://localhost:${PORT}/`;
const VIEWPORT = { width: 1280, height: 800 };
const GIF_VIEWPORT = { width: 800, height: 500 };
const channel = process.env.O3D_BROWSER_CHANNEL ?? "chrome";

mkdirSync(media, { recursive: true });
const server = await startPreviewServer();
const browser = await chromium.launch({
  channel: channel === "chromium" ? undefined : channel,
  headless: true,
  args: ["--enable-unsafe-webgpu"],
});

try {
  await captureStills();
  await captureGif();
  await captureVideo();
} finally {
  await browser.close();
  server.kill();
}

async function captureStills() {
  const page = await openShowcase(VIEWPORT);

  // 2D: the eyes sit at about (545, 258) and (655, 258) in the default 1280 x 800 framing.
  await page.click("[data-testid=camera-ortho2d]");
  await settle(page, 1200);
  await page.mouse.click(545, 258); // pick the left eye
  await settle(page, 330);
  await shot(page, "cat-2d-ortho.png");

  await page.click("[data-testid=camera-perspective3d]");
  await drag(page, { x: 760, y: 420 }, { x: 690, y: 440 }); // ~0.55 rad orbit, stops the sway
  await settle(page, 1600);
  await shot(page, "cat-3d-orbit.png");

  // Pan the face to the center, then zoom deep into it.
  await page.click("[data-testid=camera-ortho2d]");
  await settle(page, 300);
  await drag(page, { x: 640, y: 290 }, { x: 640, y: 420 });
  await page.mouse.move(640, 400);
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -120);
  await settle(page, 900);
  await shot(page, "cat-zoomed-culling.png");
  await page.close();
}

/**
 * Records the render canvas with the page's own `MediaRecorder` (VP9 WebM),
 * so no ffmpeg is needed and the video shows the WebGPU output only.
 */
async function captureVideo() {
  const page = await openShowcase(VIEWPORT);
  await page.evaluate(() => {
    const canvas = document.querySelector("#render-canvas");
    const recorder = new MediaRecorder(canvas.captureStream(30), {
      mimeType: "video/webm;codecs=vp9",
      videoBitsPerSecond: 6_000_000,
    });
    const chunks = [];
    recorder.ondataavailable = (event) => chunks.push(event.data);
    window.__stopRecording = () =>
      new Promise((resolve) => {
        recorder.onstop = async () => {
          const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
          let binary = "";
          for (let i = 0; i < bytes.length; i += 0x8000) {
            binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          }
          resolve(btoa(binary));
        };
        recorder.stop();
      });
    recorder.start(250);
  });
  await tour(page, VIEWPORT, 1);
  const base64 = await page.evaluate(() => window.__stopRecording());
  writeFileSync(join(media, "cat-showcase.webm"), Buffer.from(base64, "base64"));
  await page.close();
  console.log("wrote cat-showcase.webm");
}

/** Screenshots the tour into an animated GIF (GitHub renders GIFs inline). */
async function captureGif() {
  const page = await openShowcase(GIF_VIEWPORT);
  const gif = GIFEncoder();
  const addFrame = async () => {
    const png = PNG.sync.read(await page.screenshot());
    const palette = quantize(png.data, 256);
    gif.writeFrame(applyPalette(png.data, palette), png.width, png.height, { palette, delay: 90 });
  };
  await tour(page, GIF_VIEWPORT, 0.625, addFrame);
  gif.finish();
  writeFileSync(join(media, "cat-showcase.gif"), gif.bytes());
  await page.close();
  console.log("wrote cat-showcase.gif");
}

/**
 * The scripted walk-through: idle 3D sway, an orbit drag, a pick, 2D ortho,
 * a zoom into the face. `onStep` runs between moves (GIF frames).
 */
async function tour(page, viewport, scale, onStep = () => settle(page, 90)) {
  const at = (x, y) => ({ x: x * scale, y: y * scale });
  const steps = async (n) => { for (let i = 0; i < n; i++) await onStep(); };
  await steps(14);
  await page.mouse.move(at(760, 420).x, at(760, 420).y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(at(760 - i * 14, 420 - i * 3).x, at(760 - i * 14, 420 - i * 3).y);
    await onStep();
  }
  await page.mouse.up();
  await page.mouse.click(at(700, 520).x, at(700, 520).y);
  await steps(10);
  await page.click("[data-testid=camera-ortho2d]");
  await steps(8);
  await page.mouse.move(viewport.width * 0.55, viewport.height * 0.35);
  for (let i = 0; i < 7; i++) {
    await page.mouse.wheel(0, -120);
    await onStep();
  }
  await steps(8);
}

async function openShowcase(viewport) {
  const page = await browser.newPage({ viewport });
  page.on("pageerror", (error) => console.error("page error:", error.message));
  await page.goto(URL);
  await page.waitForSelector("body[data-ready=true]");
  console.log(`backend: ${await page.getAttribute("body", "data-backend")}`);
  await settle(page, 800);
  return page;
}

async function drag(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / 10, from.y + ((to.y - from.y) * i) / 10);
  }
  await page.mouse.up();
}

async function shot(page, name) {
  await page.screenshot({ path: join(media, name) });
  console.log(`wrote ${name}`);
}

function settle(page, ms) {
  return page.waitForTimeout(ms);
}

async function startPreviewServer() {
  const child = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], {
    cwd: join(root, "apps", "playground"),
    stdio: "ignore",
  });
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      if ((await fetch(URL)).ok) return child;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  child.kill();
  throw new Error("vite preview did not start; run `npm run build` first.");
}
