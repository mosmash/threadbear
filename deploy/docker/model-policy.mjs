// The trial grants only these language models, never image or review endpoints.
export const claudeModels = new Set(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']);
export const codexModels = new Set([
  'gpt-6.1-sol', 'gpt-6-sol', 'gpt-6-luna', 'gpt-6-astra', 'gpt-6.1-terra',
  'gpt-5.6-sol', 'gpt-5.6-luna', 'gpt-5.6-terra',
]);
export const outputLimit = 16384;

export function prepareRequest(path, input) {
  const models = path === '/v1/responses' ? codexModels : claudeModels;
  if (!input || typeof input !== 'object' || Array.isArray(input) || !models.has(input.model)) {
    return { error: 'Model not allowed for this trial', status: 403 };
  }
  if (path === '/v1/responses') {
    const max = input.max_output_tokens ?? outputLimit;
    if (!Number.isInteger(max) || max < 1) return { error: 'Invalid output token limit', status: 400 };
    return { body: { ...input, max_output_tokens: Math.min(max, outputLimit), store: false } };
  }
  if (path !== '/v1/messages/count_tokens' &&
      (!Number.isInteger(input.max_tokens) || input.max_tokens < 1 || input.max_tokens > outputLimit)) {
    return { error: 'Trial output limit is 16384 tokens', status: 400 };
  }
  return { body: input };
}

export function filterModels(body) {
  return { object: 'list', data: (Array.isArray(body?.data) ? body.data : [])
    .filter(row => claudeModels.has(row?.id) || codexModels.has(row?.id)) };
}
