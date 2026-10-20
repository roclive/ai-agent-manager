import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Network-free audit of the pinned preflight evidence. Never imports MLX or loads weights.
const evidence = JSON.parse(readFileSync(new URL('../docs/evidence/lfm-metadata.json', import.meta.url), 'utf8'));
const upstream = JSON.parse(readFileSync(new URL('../docs/evidence/lfm-upstream.json', import.meta.url), 'utf8'));
const moe = evidence['LFM2.5-8B-A1B-MLX-4bit'];
const dense = evidence['LFM2.5-2.6B-4bit'];

describe('AAM-39 pinned native MLX evidence', () => {
  it('rejects the 8B artifact under either decimal or binary 4GB limits', () => {
    expect(moe.weight_bytes).toBe(4_764_265_165);
    expect(moe.weight_bytes).toBeGreaterThan(4 * 1024 ** 3);
    expect(moe.repository_bytes).toBe(4_782_228_614);
    expect(dense.repository_bytes).toBeLessThan(4_000_000_000);
    for (const model of [moe, dense]) {
      expect(model.revision).toMatch(/^[a-f0-9]{40}$/);
      expect(model.files.every((f: { bytes: number }) => Number.isSafeInteger(f.bytes) && f.bytes >= 0)).toBe(true);
      expect(model.repository_bytes).toBe(model.files.reduce((n: number, f: { bytes: number }) => n + f.bytes, 0));
    }
  });

  it('does not describe the MoE artifact as uniformly four bit', () => {
    const config = moe['config.json'];
    expect(config.model_type).toBe('lfm2_moe');
    expect(config.num_experts).toBe(32);
    expect(config.num_experts_per_tok).toBe(4);
    expect(config.quantization.bits).toBe(4);
    expect(config.quantization['model.layers.2.feed_forward.gate'].bits).toBe(8);
    expect(config.quantization).toEqual(config.quantization_config);
  });

  it('keeps dense identity and upstream versus conversion context separate', () => {
    const config = dense['config.json'];
    expect(config.architectures).toEqual(['Lfm2ForCausalLM']);
    expect(config.model_type).toBe('lfm2');
    expect(config.num_experts).toBeUndefined();
    expect(config.quantization).toEqual({ bits: 4, group_size: 64, mode: 'affine' });
    expect(config.max_position_embeddings).toBe(128000);
    expect(upstream['LiquidAI/LFM2.5-2.6B'].context_tokens).toBe(131072);
    expect(upstream['LiquidAI/LFM2.5-2.6B'].total_parameters_billion).toBe(2.69);
  });

  it('retains the conversion runner discrepancy instead of assuming mlx-lm compatibility', () => {
    expect(dense.model_card.conversion_runner).toBe('mlx-vlm 0.6.10');
    expect(moe.model_card.conversion_runner).toBe('mlx-lm 0.31.1');
    expect(dense['config.json'].vision_config).toEqual({});
  });

  it('never treats a template or model format as an executed backend', () => {
    for (const model of [moe, dense]) {
      expect(model.chat_template).toContain('tool_call_start');
      expect(model.chat_template).toContain('tools');
      expect(model.runtime_status).toBe('not_run');
      expect(model.backend).toBeNull();
    }
  });

  it('records the cached pinned model metadata and keeps weight size limits explicit', () => {
    const report = readFileSync(new URL('../docs/local-model-eval.md', import.meta.url), 'utf8');
    expect(report).toContain('complete');
    expect(report).toContain('72a08228cf703cd7dc0187abf4edbbd8e935f864');
    expect(report).toContain('1,517,625,850 bytes');
    expect(report).not.toContain('explicitly restricted to writing inside this worktree');
    expect(report).toContain('No model files were downloaded');
  });

  it('records the live native MLX smoke as passed regardless of historical memory blockers', () => {
    const report = readFileSync(new URL('../docs/local-model-eval.md', import.meta.url), 'utf8');
    expect(report).toContain('**AAM-39 passes its current acceptance:**');
    expect(report).toContain('in 2.669 s');
    expect(report).toContain('4.441 s');
    expect(report).toContain('Process exit status 0');
    expect(report).toContain('Superseded historical observations');
  });

  it('does not require other candidates, AAM-60 comparisons, or production recommendations', () => {
    const report = readFileSync(new URL('../docs/local-model-eval.md', import.meta.url), 'utf8');
    expect(report).toContain('Other candidates, JSON/tool use, coding prompts, throughput, peak memory');
    expect(report).toContain('criterion is met');
    expect(report).not.toContain('**P1 live evaluation:** still unresolved.');
  });

  it('records the successful runner, exact prompt and generated response', () => {
    const report = readFileSync(new URL('../docs/local-model-eval.md', import.meta.url), 'utf8');
    expect(report).toContain('mlx-vlm 0.7.8');
    expect(report).toContain('MLX 0.32.4');
    expect(report).toContain('72a08228cf703cd7dc0187abf4edbbd8e935f864');
    expect(report).toContain('Write one short sentence about a quiet garden in the morning.');
    expect(report).toContain('The one short sentence about a quiet garden in the morning.');
    expect(report).toContain('240-second hard timeout');
    expect(report).toContain('1,103 MiB');
  });


  it('keeps prior no-run evidence explicitly historical instead of treating it as a blocker', () => {
    const report = readFileSync(new URL('../docs/local-model-eval.md', import.meta.url), 'utf8');
    expect(report).toContain('## Superseded historical observations');
    expect(report).toContain('do not override the successful smoke or current');
    expect(report).toContain("do not apply to AAM-39's");
  });
});
