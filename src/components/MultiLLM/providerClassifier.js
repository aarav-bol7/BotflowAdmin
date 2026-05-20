// Pure model-id → provider classifier.
//
// Why name-based: this LiteLLM gateway returns owned_by="openai" for every
// model regardless of actual provider, and most ids carry no provider prefix.
// So we infer from the id itself. Order matters — first match wins.

const PROVIDER_LABELS = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  xai: 'xAI',
  mistral: 'Mistral',
  zai: 'Zai',
  together: 'Together AI',
  novita: 'Novita',
  fireworks: 'Fireworks',
  vertex_ai: 'Vertex AI',
  bedrock: 'AWS Bedrock',
  azure: 'Azure',
  other: 'Other',
};

export function classifyProvider(id) {
  if (typeof id !== 'string' || !id) return 'other';
  const lower = id.toLowerCase();

  // Slashed ids → take prefix before first slash.
  if (lower.includes('/')) {
    const prefix = lower.split('/')[0];
    if (PROVIDER_LABELS[prefix]) return prefix;
    return 'other';
  }

  // Inference-platform prefixes (the actual routing provider).
  if (lower.startsWith('together-')) return 'together';
  if (lower.startsWith('novita-')) return 'novita';
  if (lower.startsWith('fireworks-')) return 'fireworks';

  // Model-family prefixes.
  if (/^gpt[-0-9]/.test(lower) || lower.startsWith('gpt5') || lower.startsWith('gpt4')) return 'openai';
  if (lower.startsWith('claude')) return 'anthropic';
  if (lower.startsWith('gemini')) return 'google';
  if (lower.startsWith('grok')) return 'xai';
  if (lower.startsWith('mistral') || lower.startsWith('magistral')
      || lower.startsWith('codestral') || lower.startsWith('devstral')) return 'mistral';
  if (lower.startsWith('zai')) return 'zai';

  return 'other';
}

export function providerLabel(key) {
  return PROVIDER_LABELS[key] || key;
}

// Random alphanumeric suffix for the masked-key visual.
function randomSuffix(n = 4) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export function makeMaskedKey() {
  return `sk-${'•'.repeat(10)}${randomSuffix(4)}`;
}

// Group raw LiteLLM models into provider buckets, with ~50% pre-enabled per
// provider. Called once per fetch — never during render.
export function groupModels(rawModels) {
  const buckets = new Map();
  for (const m of rawModels) {
    if (!m || typeof m.id !== 'string') continue;
    const key = classifyProvider(m.id);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push({ id: m.id, enabled: Math.random() < 0.5 });
  }

  const providers = [];
  for (const [key, models] of buckets.entries()) {
    models.sort((a, b) => a.id.localeCompare(b.id));
    providers.push({
      key,
      name: providerLabel(key),
      maskedKey: makeMaskedKey(),
      models,
    });
  }

  // Sort providers alphabetically by display name, but keep "other" last.
  providers.sort((a, b) => {
    if (a.key === 'other') return 1;
    if (b.key === 'other') return -1;
    return a.name.localeCompare(b.name);
  });
  return providers;
}
