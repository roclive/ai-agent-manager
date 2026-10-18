// Keep task contents out of shell code. Only provider/transport failures retry.
export function retryable(output) {
  return output.split('\n').some(line => {
    let errorish;
    try {
      const event = JSON.parse(line);
      errorish = event.type === 'error' || event.type === 'turn.failed';
    } catch {
      errorish = /\berror\b|ECONNREFUSED|ECONNRESET|fetch failed|service unavailable/i.test(line);
    }
    return errorish && /usage limit|rate[ _-]?limit|quota|\b429\b|ECONNREFUSED|ECONNRESET|fetch failed|service unavailable/i.test(line);
  });
}
export async function failover(models, run, report = () => {}) {
  for (let i = 0; i < models.length; i++) {
    const result = await run(models[i]);
    if (result.status === 0) return result;
    if (!retryable(result.output) || i === models.length - 1) return result;
    report(models[i], models[i + 1]);
  }
  return { status: 1, output: 'No allowed coding backend configured' };
}
