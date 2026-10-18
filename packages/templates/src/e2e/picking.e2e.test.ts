import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { initSync, wasm_memory } from "@engine/core/pkg/engine.js";
import { CameraController } from "../scene/camera-controller.ts";
import { EntityManager } from "../scene/entity-manager.ts";
import { PickingController } from "../scene/picking-controller.ts";

type Point = [number, number, number];

/**
 * Full-stack picking on the real Wasm module: entities are created through the
 * facade and clicked at the exact screen position their world point projects to.
 */
describe("entity picking end to end", () => {
  const picker = () => new PickingController();

  before(() => {
    const wasmPath = fileURLToPath(import.meta.resolve("@engine/core/pkg/engine_bg.wasm"));
    initSync({ module: readFileSync(wasmPath) });
  });

  /** World point -> NDC, read from the camera's Wasm view-projection matrix. */
  function ndcOf(camera: CameraController, [x, y, z]: Point): [number, number] {
    const m = new Float32Array(
      (wasm_memory() as WebAssembly.Memory).buffer,
      camera.getRawWasmCamera().view_proj_ptr(),
      16,
    );
    const at = (i: number) => m[i]!;
    const w = at(3) * x + at(7) * y + at(11) * z + at(15);
    return [
      (at(0) * x + at(4) * y + at(8) * z + at(12)) / w,
      (at(1) * x + at(5) * y + at(9) * z + at(13)) / w,
    ];
  }

  const pickAt = (
    entities: EntityManager,
    camera: CameraController,
    point: Point,
    controller = picker(),
  ) => controller.pickByNdc(...ndcOf(camera, point), entities, camera);

  describe("2D (orthographic) camera", () => {
    it("picks the right entity out of a 5 x 5 grid and null in the gaps", () => {
      const entities = new EntityManager(4); // small: forces Wasm heap growth
      const camera = new CameraController({ aspect: 1.5 });
      const ids = new Map<number, Point>();
      for (let row = 0; row < 5; row++) {
        for (let col = 0; col < 5; col++) {
          const position: Point = [col * 30 - 60, row * 30 - 60, 0];
          const id = entities.createEntity({
            position: { x: position[0], y: position[1], z: position[2] },
            scale: { x: 10, y: 10, z: 1 },
          });
          ids.set(id, position);
        }
      }

      for (const [id, position] of ids) {
        assert.equal(pickAt(entities, camera, position), id);
      }
      assert.equal(pickAt(entities, camera, [-45, -45, 0]), null); // between cells
      assert.equal(pickAt(entities, camera, [500, 500, 0]), null); // off screen
    });

    it("lets the entity closer to the camera win, in either creation order", () => {
      for (const nearFirst of [true, false]) {
        const entities = new EntityManager(2);
        const camera = new CameraController({ aspect: 1 });
        const spec = (z: number) => ({
          position: { x: 20, y: 20, z },
          scale: { x: 8, y: 8, z: 1 },
        });
        let near: number;
        let far: number;
        if (nearFirst) {
          near = entities.createEntity(spec(5));
          far = entities.createEntity(spec(0));
        } else {
          far = entities.createEntity(spec(0));
          near = entities.createEntity(spec(5));
        }

        assert.equal(pickAt(entities, camera, [20, 20, 0]), near, `nearFirst=${nearFirst}`);
        assert.notEqual(near, far);
      }
    });

    it("follows camera zoom and pan", () => {
      const entities = new EntityManager(2);
      const camera = new CameraController({ aspect: 1 });
      const id = entities.createEntity({
        position: { x: 150, y: 0, z: 0 },
        scale: { x: 10, y: 10, z: 1 },
      });
      const picker = new PickingController();
      const pickNdc = (x: number, y: number) => picker.pickByNdc(x, y, entities, camera);

      // Half-height 100: NDC 0.75 is world x = 75, empty space.
      assert.equal(pickNdc(0.75, 0), null);
      camera.zoom(2); // half-height 200: NDC 0.75 is now world x = 150
      assert.equal(pickNdc(0.75, 0), id);
      assert.equal(pickNdc(0, 0), null);

      camera.zoom(0.5);
      camera.panByPixels(-150, 0, 200); // 1 world unit per pixel: the view moves right by 150
      assert.equal(pickNdc(0, 0), id);
    });
  });

  describe("3D (perspective) camera", () => {
    function createCamera() {
      return new CameraController({
        mode: "3d",
        aspect: 1.6,
        position: { x: 0, y: 5, z: 30 },
        target: { x: 0, y: 0, z: 0 },
      });
    }

    it("picks scattered entities at their projected positions", () => {
      const entities = new EntityManager(2);
      const camera = createCamera();
      const points: Point[] = [
        [0, 0, 0],
        [8, 3, -4],
        [-10, -2, 6],
        [4, 9, -12],
      ];
      const ids = points.map((p) =>
        entities.createEntity({
          position: { x: p[0], y: p[1], z: p[2] },
          scale: { x: 3, y: 3, z: 3 },
        }),
      );

      points.forEach((p, i) => assert.equal(pickAt(entities, camera, p), ids[i]));
      assert.equal(pickAt(entities, camera, [20, -15, 0]), null);
    });

    it("lets the closer entity win along the line of sight", () => {
      for (const frontFirst of [true, false]) {
        const entities = new EntityManager(4);
        const camera = new CameraController({
          mode: "3d",
          position: { x: 0, y: 0, z: 30 },
          target: { x: 0, y: 0, z: 0 },
        });
        const spec = (z: number) => ({
          position: { x: 0, y: 0, z },
          scale: { x: 4, y: 4, z: 4 },
        });
        const order = frontFirst ? [8, 0, -8] : [-8, 0, 8];
        const created = order.map((z) => ({ z, id: entities.createEntity(spec(z)) }));
        const front = created.find((e) => e.z === 8)!.id;

        assert.equal(pickAt(entities, camera, [0, 0, 8]), front, `frontFirst=${frontFirst}`);
      }
    });

    it("follows an orbiting camera", () => {
      const entities = new EntityManager(2);
      const camera = createCamera();
      const id = entities.createEntity({
        position: { x: 6, y: 1, z: 2 },
        scale: { x: 3, y: 3, z: 3 },
      });

      camera.orbit(0.9, 0.35);

      assert.equal(pickAt(entities, camera, [6, 1, 2]), id);
    });
  });

  describe("EntityId resolution after swap-and-pop removals", () => {
    it("returns stable IDs, never dense indices, and null for removed entities", () => {
      const entities = new EntityManager(8);
      const camera = new CameraController({ aspect: 1 });
      const positions: Point[] = [
        [-80, 0, 0],
        [-40, 0, 0],
        [0, 0, 0],
        [40, 0, 0],
        [80, 0, 0],
      ];
      const ids = positions.map((p) =>
        entities.createEntity({
          position: { x: p[0], y: p[1], z: p[2] },
          scale: { x: 10, y: 10, z: 1 },
        }),
      );

      entities.removeEntity(ids[1]!); // last entity (ids[4]) moves into dense slot 1
      entities.removeEntity(ids[0]!); // and ids[3] moves into dense slot 0

      assert.equal(entities.getActiveCount(), 3);
      assert.equal(pickAt(entities, camera, positions[0]!), null);
      assert.equal(pickAt(entities, camera, positions[1]!), null);
      assert.equal(pickAt(entities, camera, positions[2]!), ids[2]);
      assert.equal(pickAt(entities, camera, positions[3]!), ids[3]);
      assert.equal(pickAt(entities, camera, positions[4]!), ids[4]);
    });

    it("picks a recycled ID at its new position only", () => {
      const entities = new EntityManager(2);
      const camera = new CameraController({ aspect: 1 });
      const first = entities.createEntity({
        position: { x: -50, y: 0, z: 0 },
        scale: { x: 10, y: 10, z: 1 },
      });
      entities.removeEntity(first);
      const reused = entities.createEntity({
        position: { x: 50, y: 0, z: 0 },
        scale: { x: 10, y: 10, z: 1 },
      });

      assert.equal(reused, first);
      assert.equal(pickAt(entities, camera, [50, 0, 0]), reused);
      assert.equal(pickAt(entities, camera, [-50, 0, 0]), null);
    });

    it("tracks entities moved with updateEntity", () => {
      const entities = new EntityManager(2);
      const camera = new CameraController({ aspect: 1 });
      const id = entities.createEntity({ scale: { x: 10, y: 10, z: 1 } });

      entities.updateEntity(id, { position: { x: 70, y: -30 } });

      assert.equal(pickAt(entities, camera, [70, -30, 0]), id);
      assert.equal(pickAt(entities, camera, [0, 0, 0]), null);
    });
  });

  describe("pointer coordinates", () => {
    it("resolves a click on an 800 x 600 canvas offset inside the page", () => {
      const entities = new EntityManager(2);
      const camera = new CameraController({ aspect: 800 / 600 });
      const rect = { left: 120, top: 80, width: 800, height: 600 };
      const target: Point = [-60, 40, 0];
      const id = entities.createEntity({
        position: { x: target[0], y: target[1], z: target[2] },
        scale: { x: 10, y: 10, z: 1 },
      });

      const [ndcX, ndcY] = ndcOf(camera, target);
      const clientX = rect.left + ((ndcX + 1) / 2) * rect.width;
      const clientY = rect.top + ((1 - ndcY) / 2) * rect.height;

      assert.equal(picker().pickAtScreenCoords(clientX, clientY, rect, entities, camera), id);
      assert.equal(
        picker().pickAtScreenCoords(clientX + 200, clientY, rect, entities, camera),
        null,
      );
    });
  });
});
