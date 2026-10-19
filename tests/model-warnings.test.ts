import { afterEach, expect, it, vi } from "vitest";
import {
  codexModelWarnings,
  modelCatalogHost,
} from "../src/core/model-warnings.js";
import { EXECUTOR_META } from "../src/core/executors.js";
afterEach(() => vi.restoreAllMocks());
const now = Date.now();
function catalog(slugs: string[], fetched = now) {
  vi.spyOn(modelCatalogHost, "read").mockReturnValue(
    JSON.stringify({
      fetched_at: new Date(fetched).toISOString(),
      models: slugs.map((slug) => ({ slug })),
    }),
  );
}
it("uses Luna 6 and accepts a current catalog", () => {
  expect(EXECUTOR_META["codex-luna"].model).toBe("gpt-6-luna");
  catalog(["gpt-6-luna"]);
  expect(codexModelWarnings({ luna: "gpt-6-luna" }, now)).toEqual({});
});
it("warns about newer versions numerically without changing mappings", () => {
  catalog(["gpt-6-luna", "gpt-6.1-luna", "gpt-6.10-luna"]);
  expect(codexModelWarnings({ luna: "gpt-6-luna" }, now).luna).toContain(
    "gpt-6.10-luna",
  );
});
it("warns for missing, stale and unreadable catalogs", () => {
  catalog([]);
  expect(codexModelWarnings({ luna: "gpt-6-luna" }, now).luna).toContain(
    "不在",
  );
  vi.restoreAllMocks();
  catalog(["gpt-6-luna"], now - 8 * 86400000);
  expect(codexModelWarnings({ luna: "gpt-6-luna" }, now).luna).toContain(
    "过期",
  );
  vi.restoreAllMocks();
  vi.spyOn(modelCatalogHost, "read").mockImplementation(() => {
    throw new Error("missing");
  });
  expect(codexModelWarnings({ luna: "gpt-6-luna" }, now).luna).toContain(
    "无法读取",
  );
});
