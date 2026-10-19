import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// Read local CLI/Desktop metadata only; never start an AI CLI to discover models.
export const modelCatalogHost = {
  read: () =>
    readFileSync(
      join(
        process.env.CODEX_HOME || join(homedir(), ".codex"),
        "models_cache.json",
      ),
      "utf8",
    ),
};
export function codexModelWarnings(
  mapped: Record<string, string>,
  now = Date.now(),
): Record<string, string> {
  const warnings: Record<string, string> = {};
  try {
    const data = JSON.parse(modelCatalogHost.read());
    if (
      !Array.isArray(data.models) ||
      !data.models.every(
        (m: unknown) =>
          m &&
          typeof m === "object" &&
          typeof (m as { slug?: unknown }).slug === "string",
      )
    )
      throw new Error("invalid catalog");
    const models: string[] = data.models
      .filter((m: { visibility?: string }) => m.visibility !== "hide")
      .map((m: { slug: string }) => m.slug);
    const fetched = Date.parse(data.fetched_at);
    for (const [id, model] of Object.entries(mapped)) {
      const family = model.match(/^gpt-(\d+(?:\.\d+)*)-(sol|luna)$/)?.[2];
      const version = (s: string) =>
        s
          .match(/^gpt-(\d+(?:\.\d+)*)-/)![1]!
          .split(".")
          .map(Number);
      const newer = family
        ? models
            .filter((s) =>
              new RegExp(`^gpt-\\d+(?:\\.\\d+)*-${family}$`).test(s),
            )
            .sort((a, b) => {
              const av = version(a),
                bv = version(b);
              for (let i = 0; i < Math.max(av.length, bv.length); i++) {
                const delta = (bv[i] ?? 0) - (av[i] ?? 0);
                if (delta) return delta;
              }
              return 0;
            })[0]
        : undefined;
      if (!models.includes(model))
        warnings[id] =
          `模型映射警告：${model} 不在本机 Codex 模型目录中，请检查 CLI/Desktop。`;
      else if (newer && newer !== model)
        warnings[id] =
          `模型映射警告：当前 ${model}，本机 Codex 已列出更新的 ${newer}；请确认映射。`;
      else if (!Number.isFinite(fetched) || now - fetched > 7 * 86400000)
        warnings[id] =
          `模型目录已过期，无法确认 ${model} 是否与 Codex CLI/Desktop 一致。请刷新本机 Codex 模型目录。`;
    }
  } catch {
    for (const [id, model] of Object.entries(mapped))
      warnings[id] =
        `无法读取本机 Codex 模型目录，无法验证 ${model}；请检查 CLI/Desktop。`;
  }
  return warnings;
}
