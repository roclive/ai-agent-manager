import { expect, it } from 'vitest';
import { failover, retryable } from '../src/workers/opencode-failover.mjs';
it('does not interpret task prose about quotas as provider exhaustion', () => {
  expect(retryable(JSON.stringify({type:'text',part:{text:'Implement quota and 429 handling'}}))).toBe(false);
  expect(retryable(JSON.stringify({type:'error',error:{message:'429 quota exceeded'}}))).toBe(true);
});
it('continues through exhausted free providers to local without running real tools', async () => {
  const seen: string[] = [];
  const switches: string[] = [];
  const result = await failover(['free-a', 'free-b', 'local'], async model => {
    seen.push(model);
    return model === 'local' ? {status: 0, output: 'done'} : {status: 1, output: 'Error: 429 quota exceeded'};
  }, (a,b) => switches.push(`${a}->${b}`));
  expect(result.status).toBe(0);
  expect(seen).toEqual(['free-a','free-b','local']);
  expect(switches).toEqual(['free-a->free-b','free-b->local']);
});
it('does not replay application errors on another model or hide exhaustion', async () => {
  let calls=0;
  expect((await failover(['free','local'], async () => {calls++;return {status: 1,output:'Invalid source syntax'};})).status).toBe(1);
  expect(calls).toBe(1);
  expect((await failover(['free','local'], async () => ({status: 1,output:'Error: quota exceeded'}))).status).toBe(1);
});
