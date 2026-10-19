// Quality gates for local / gateway ("GW") reviewers and planners. These models are weaker than the
// default reviewer, so their output is parsed strictly and anything doubtful is deferred (task stays
// in_review for a stronger backend or a human) instead of being approved or rejected.
export type StrictVerdict = {
  verdict: "approve" | "reject";
  notes: string;
  confidence: number;
};
export type GateDecision =
  | { action: "approve" | "reject"; notes: string }
  | { action: "defer"; reason: string };

export function stripFence(text: string) {
  const m = /^\s*```(?:json)?\s*\n([\s\S]*?)\n\s*```\s*$/i.exec(text);
  return (m ? m[1]! : text).trim();
}

// Whole-output JSON only: no prose scanning, so a quoted example inside prose cannot become a verdict.
export function parseStrictJson(text: string): unknown {
  return JSON.parse(stripFence(text));
}

export function parseStrictVerdict(text: string): StrictVerdict | null {
  let v: Record<string, unknown>;
  try {
    v = parseStrictJson(text) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const keys = Object.keys(v);
  if (keys.some((k) => !["verdict", "notes", "confidence"].includes(k)))
    return null;
  if (v.verdict !== "approve" && v.verdict !== "reject") return null;
  if (typeof v.notes !== "string" || v.notes.length > 20000) return null;
  const c = v.confidence;
  if (typeof c !== "number" || !Number.isFinite(c) || c < 0 || c > 1)
    return null;
  return { verdict: v.verdict, notes: v.notes, confidence: c };
}

export function gateLocalVerdict(
  v: StrictVerdict,
  opts: { minConfidence: number; testsPassed: boolean },
): GateDecision {
  if (v.confidence < opts.minConfidence)
    return {
      action: "defer",
      reason: `confidence ${v.confidence} below ${opts.minConfidence}`,
    };
  if (v.verdict === "approve") {
    if (!opts.testsPassed)
      return { action: "reject", notes: "Tests did not pass" };
    if (/\[P[012]\]/.test(v.notes))
      return {
        action: "defer",
        reason: "approve verdict lists [P0]-[P2] findings",
      };
  }
  return { action: v.verdict, notes: v.notes };
}

// Fetches one chat completion from an OpenAI-compatible gateway (e.g. LiteLLM). Prompt on stdin,
// answer on stdout. Runs as `node -e <script> <baseUrl> <model>`.
export const gwScript = `const fs=require('node:fs');const [base,model]=process.argv.slice(1);(async()=>{const key=process.env.AAM_GW_API_KEY;const r=await fetch(base.replace(/\\/+$/,'')+'/chat/completions',{method:'POST',headers:{'content-type':'application/json',...(key?{authorization:'Bearer '+key}:{})},body:JSON.stringify({model,temperature:0,messages:[{role:'user',content:fs.readFileSync(0,'utf8')}]}),signal:AbortSignal.timeout(240000)});const t=await r.text();if(!r.ok){process.stderr.write('GW HTTP '+r.status+' '+t.slice(0,500));process.exit(1)}const c=JSON.parse(t).choices?.[0]?.message?.content;if(typeof c!=='string'){process.stderr.write('GW response has no content');process.exit(1)}process.stdout.write(c)})().catch(e=>{process.stderr.write(String(e&&e.message||e));process.exit(1)});`;
