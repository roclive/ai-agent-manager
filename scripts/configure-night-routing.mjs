import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const home = resolve(process.env.AAM_HOME || '.aam');
const policy = {
  models: ['opencode/deepseek-v4.1-flash-free', 'opencode/glm-5.3-flash-free'],
  auto: true,
  agent: 'aam-night',
  config: {
    small_model: 'opencode/deepseek-v4.1-flash-free',
    agent: {'aam-night': {mode: 'primary', prompt: 'Complete the task in the provided working directory. Inspect existing files before editing. Use tools to make changes and run the specified tests. Never push or publish. Never claim tests passed without running them. Leave a concise factual summary. Follow the task rules.', tools: {bash:true, read:true, edit:true, write:true, glob:true, grep:true, webfetch:false, websearch:false, task:false, todowrite:false, question:false}, permission: {bash:'allow', edit:'allow', external_directory:'deny'}}}
  }
};
writeFileSync(resolve(home, 'opencode-routing.json'), JSON.stringify(policy, null, 2), {mode: 0o600});
console.log('Configured free coding routes; local Saluki fallback disabled at user request');
