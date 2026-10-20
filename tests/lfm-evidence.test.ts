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

  it('records cache and Gemma comparison findings without claiming runtime validation', () => {
    const report = readFileSync(new URL('../docs/local-model-eval.md', import.meta.url), 'utf8');
    expect(report).toContain('complete');
    expect(report).toContain('72a08228cf703cd7dc0187abf4edbbd8e935f864');
    expect(report).toContain('1,517,625,850 bytes');
    expect(report).toContain('No Gemma MLX HF snapshot was present');
    expect(report).toContain('not an MLX-native AAM-60');
    expect(report).not.toContain('explicitly restricted to writing inside this worktree');
    expect(report).toContain('no download is');
  });

  it('keeps the missing live-smoke review finding open when the shared lock is unavailable', () => {
    const report = readFileSync(new URL('../docs/local-model-eval.md', import.meta.url), 'utf8');
    expect(report).toContain('no shared AAM local-model lock was');
    expect(report).toContain('there is no post-run measurement');
    expect(report).toContain('hardware check remains unresolved');
    expect(report).toContain('Offline test success cannot satisfy the');
    expect(report).toContain('No recommendation for unattended AAM-37');
  });

  it('states that live model execution and comparable AAM-60 evidence are still unresolved', () => {
    const report = readFileSync(new URL('../docs/local-model-eval.md', import.meta.url), 'utf8');
    expect(report).toContain('**P1 live evaluation:** still unresolved.');
    expect(report).toContain('no AAM-60 Gemma MLX');
    expect(report).toContain('no AAM-60 Gemma MLX');
    expect(report).toContain('results, frozen prompt set, or Gemma MLX model cache');
    expect(report).toContain('No inference process was started');
    expect(report).toContain('local_model_preference`: **none validated**');
  });

  it('keeps the recorded core test total consistent with the observed Vitest output', () => {
    const report = readFileSync(new URL('../docs/local-model-eval.md', import.meta.url), 'utf8');
    expect(report).toContain('**245 tests / 27 files**');
    expect(report).not.toContain('**244 tests / 27 files**');
  });

  it('does not claim a safe runtime attempt when host headroom and scoped monitoring are unavailable', () => {
    const report = readFileSync(new URL('../docs/local-model-eval.md', import.meta.url), 'utf8');
    expect(report).toContain('Current recheck (2026-10-19)');
    expect(report).toContain('0.85 GiB');
    expect(report).toContain('1,319 MiB');
    expect(report).toContain('produce a useful footprint inventory');
    expect(report).toContain('peak and process-boundary measurements are unavailable');
    expect(report).toContain('No inference process was started');
    expect(report).toContain('local_model_preference');
    expect(report).toContain('none validated');
  });
});
