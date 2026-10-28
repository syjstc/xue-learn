import { builtinDisplayManifests } from "../display-plugins/catalog.js";
import {
  createDisplayCatalog,
  createDisplayRuntime,
  validateDisplayDocument,
} from "../../../libs/display/src/index.js";
import {
  createDisplayPreviewDocument,
  displayComponentInfo,
  displayPreviewExamples,
  displaySelection,
  readDisplayPluginSelection,
  writeDisplayPluginSelection,
} from "./preview-catalog.js";
import type { DisplayPluginManifest } from "../../../libs/display/src/types.js";
import { readMaterialTeaching } from "../../../libs/domain/src/material-teaching.js";
import { readTeachingTemplateMusicBlock } from "../../../libs/domain/src/material-music-teaching.js";

test("every installed built-in component has a structurally valid, schema-valid preview", async () => {
  const runtime = createDisplayRuntime({
    catalog: createDisplayCatalog(builtinDisplayManifests),
    resolveModule: async (manifest) => ({
      components: Object.fromEntries(
        manifest.components.map((component) => [
          `${component.kind}@${component.version}`,
          () => null,
        ]),
      ),
    }),
  });
  for (const manifest of builtinDisplayManifests)
    for (const component of manifest.components) {
      const samples = displayPreviewExamples(manifest, component);
      expect(samples.length).toBeGreaterThan(0);
      expect(displayComponentInfo(component).title).not.toBe(component.kind);
      for (const sample of samples) {
        if (component.kind.endsWith(":teaching")) {
          const block = (sample.payload as { block: unknown }).block;
          expect(readMaterialTeaching(block)).not.toBeNull();
          if (component.kind === "music:teaching")
            expect(readTeachingTemplateMusicBlock(block)).toBeDefined();
        }
        const document = createDisplayPreviewDocument(
          manifest,
          component,
          sample,
        );
        expect(validateDisplayDocument(document)).toEqual([]);
        expect((await runtime.prepare(document)).issues).toEqual([]);
        expect(runtime.resolve(document.root, document).status).toBe("ready");
      }
    }
  runtime.dispose();
});

test("URL selections preserve unrelated host parameters and exact plugin/component versions", () => {
  const manifest = builtinDisplayManifests[0],
    component = manifest.components[1];
  const selection = displaySelection(manifest, component),
    original = new URLSearchParams("returnTo=%2Fgoals%2Fphysics");
  const params = writeDisplayPluginSelection(original, selection);
  expect(readDisplayPluginSelection(params)).toEqual(selection);
  expect(params.get("returnTo")).toBe("/goals/physics");
  expect(original.has("plugin")).toBe(false);
  expect(writeDisplayPluginSelection(params, null).toString()).toBe(
    original.toString(),
  );
  expect(
    readDisplayPluginSelection(
      new URLSearchParams(
        "plugin=p&version=1&component=c&componentVersion=NaN",
      ),
    ),
  ).toBeNull();
});

test("imported plugin examples and dependency locks are retained, including disabled-version previews", () => {
  const manifest: DisplayPluginManifest = {
    apiVersion: 1,
    id: "example.notes",
    version: "2.0.0",
    execution: "declarative",
    dependencies: [{ id: "org.xuelearn.display.general", version: "1.0.0" }],
    components: [
      {
        kind: "notes:text",
        version: 3,
        examples: [{ message: "hello" }],
        composition: {
          id: "text",
          kind: "general:text",
          version: 1,
          payload: { text: { $display: "payload", path: "message" } },
        },
      },
    ],
  };
  const sample = displayPreviewExamples(manifest, manifest.components[0])[0];
  expect(sample.payload).toEqual({ message: "hello" });
  expect(
    createDisplayPreviewDocument(manifest, manifest.components[0], sample)
      .plugins,
  ).toEqual(
    manifest.dependencies!.concat({
      id: manifest.id,
      version: manifest.version,
    }),
  );
  expect(
    displayPreviewExamples(
      { ...manifest, components: [] },
      { ...manifest.components[0], examples: [] },
    ),
  ).toEqual([]);
});
