/**
 * One cheap structured call. OpenAI is the primary provider (plan decision); OpenRouter is the
 * fallback, used only when OPENAI_API_KEY is absent. Model id comes from LLM_MODEL (default
 * gpt-5-mini); on OpenRouter it is prefixed with "openai/" when no vendor prefix is given.
 * No temperature is sent: GPT-5 models reject anything but the default.
 * Nothing here knows about tickets.
 */
import OpenAI from 'openai';

export interface LlmProvider {
  name: 'openai' | 'openrouter';
  client: OpenAI;
  model: string;
}

const DEFAULT_MODEL = 'gpt-5-mini';
let cached: LlmProvider | undefined;

export function getProvider(): LlmProvider {
  if (cached) return cached;
  const model = process.env.LLM_MODEL ?? DEFAULT_MODEL;
  if (process.env.OPENAI_API_KEY) {
    cached = { name: 'openai', client: new OpenAI(), model: model.replace(/^openai\//, '') };
  } else if (process.env.OPENROUTER_API_KEY) {
    cached = {
      name: 'openrouter',
      client: new OpenAI({ apiKey: process.env.OPENROUTER_API_KEY, baseURL: 'https://openrouter.ai/api/v1' }),
      model: model.includes('/') ? model : `openai/${model}`,
    };
  } else {
    throw new Error('no LLM credential: set OPENAI_API_KEY (or OPENROUTER_API_KEY) in .env');
  }
  return cached;
}

export interface JsonSchemaSpec {
  name: string;
  schema: Record<string, unknown>;
}

/**
 * JSON-schema-constrained completion. Falls back to json_object mode (schema in the prompt)
 * if the provider rejects strict schemas with a 400.
 */
export async function completeJson<T>(system: string, user: string, spec: JsonSchemaSpec): Promise<T> {
  const { client, model } = getProvider();
  const messages = [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: user },
  ];
  let text: string | null | undefined;
  try {
    const res = await client.chat.completions.create({
      model,
      messages,
      response_format: { type: 'json_schema', json_schema: { name: spec.name, strict: true, schema: spec.schema } },
    });
    text = res.choices[0]?.message.content;
  } catch (e: unknown) {
    if ((e as { status?: number })?.status !== 400) throw e;
    const res = await client.chat.completions.create({
      model,
      messages: [...messages, { role: 'system', content: `Return JSON matching this schema: ${JSON.stringify(spec.schema)}` }],
      response_format: { type: 'json_object' },
    });
    text = res.choices[0]?.message.content;
  }
  if (!text) throw new Error('empty completion');
  return JSON.parse(text) as T;
}
