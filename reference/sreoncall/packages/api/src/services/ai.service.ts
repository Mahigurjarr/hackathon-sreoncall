import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { logger } from '../utils/logger';
import { Tenant } from '../models/tenant.model';
import { decryptToken } from '../utils/encryption';
import type { AIProvider } from './ai-providers';

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const MAX_TOKENS = 4096;

let _client: OpenAI | null = null;

function getClient(): OpenAI | null {
  if (_client) return _client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    logger.warn('OPENAI_API_KEY not set — AI features will use fallback templates');
    return null;
  }
  _client = new OpenAI({ apiKey });
  return _client;
}

export function isAIAvailable(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

// ─── Tenant AI client ────────────────────────────────────────────────────────

export interface TenantAIClient {
  provider: AIProvider;
  model: string;
  openai?: OpenAI;
  anthropic?: Anthropic;
  google?: GoogleGenerativeAI;
}

export async function getClientForTenant(tenantId: string): Promise<TenantAIClient | null> {
  const tenant = await Tenant.findById(tenantId).select('ai_config').lean();
  const cfg = (tenant as any)?.ai_config;
  if (!cfg?.provider || !cfg?.api_key_encrypted) return null;

  let apiKey: string;
  try {
    apiKey = decryptToken(cfg.api_key_encrypted);
  } catch {
    logger.error('Failed to decrypt tenant AI key — COMMS_ENCRYPTION_KEY may be missing or rotated', { tenantId });
    return null;
  }

  if (cfg.provider === 'openai') {
    return { provider: 'openai', model: cfg.model, openai: new OpenAI({ apiKey }) };
  }
  if (cfg.provider === 'anthropic') {
    return { provider: 'anthropic', model: cfg.model, anthropic: new Anthropic({ apiKey }) };
  }
  if (cfg.provider === 'google') {
    return { provider: 'google', model: cfg.model, google: new GoogleGenerativeAI(apiKey) };
  }
  return null;
}

// ─── Standard completion ─────────────────────────────────────────────────────

export interface CompletionOptions {
  system: string;
  userMessage: string;
  maxTokens?: number;
  /** When true, request a JSON object response (OpenAI response_format json_object). */
  jsonMode?: boolean;
  /**
   * Optional strict JSON schema (OpenAI provider only). When present, uses
   * response_format: { type: 'json_schema', json_schema: { …, strict: true } } instead of the
   * looser json_object mode — guaranteeing the reply matches the shape. Ignored by Anthropic/Google
   * (they don't take OpenAI's response_format); those branches keep returning free-form JSON text,
   * which parseGenerated* still handles. `schema` must be a strict-mode object schema
   * (additionalProperties:false, every property in `required`).
   */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
}

export interface CompletionResult {
  text: string;
  input_tokens: number;
  output_tokens: number;
  model: string;
}

export async function generateCompletion(
  opts: CompletionOptions & { tenantId?: string },
): Promise<CompletionResult> {
  // Tenant-scoped: use tenant's own AI client
  if (opts.tenantId) {
    const tenantClient = await getClientForTenant(opts.tenantId);
    if (!tenantClient) {
      return {
        text: 'AI features require configuration. Go to Settings → AI to add your API key.',
        input_tokens: 0,
        output_tokens: 0,
        model: 'disabled',
      };
    }
    return generateCompletionWithClient(tenantClient, opts);
  }
  // Platform-scoped fallback (system/internal use)
  const client = getClient();
  if (!client) {
    return { text: opts.userMessage, input_tokens: 0, output_tokens: 0, model: 'fallback' };
  }
  return generateCompletionWithOpenAI(client, opts);
}

async function generateCompletionWithClient(
  tc: TenantAIClient,
  opts: CompletionOptions,
): Promise<CompletionResult> {
  try {
    if (tc.provider === 'openai' && tc.openai) {
      return generateCompletionWithOpenAI(tc.openai, { ...opts, model: tc.model });
    }
    if (tc.provider === 'anthropic' && tc.anthropic) {
      const msg = await tc.anthropic.messages.create({
        model: tc.model,
        max_tokens: opts.maxTokens || MAX_TOKENS,
        system: opts.system,
        messages: [{ role: 'user', content: opts.userMessage }],
      });
      const text = msg.content.find((b) => b.type === 'text')?.text ?? '';
      return { text, input_tokens: msg.usage.input_tokens, output_tokens: msg.usage.output_tokens, model: tc.model };
    }
    if (tc.provider === 'google' && tc.google) {
      const genModel = tc.google.getGenerativeModel({ model: tc.model, systemInstruction: opts.system });
      const result = await genModel.generateContent(opts.userMessage);
      const text = result.response.text();
      const usage = result.response.usageMetadata;
      return {
        text,
        input_tokens: usage?.promptTokenCount ?? 0,
        output_tokens: usage?.candidatesTokenCount ?? 0,
        model: tc.model,
      };
    }
    return { text: opts.userMessage, input_tokens: 0, output_tokens: 0, model: 'fallback' };
  } catch (err: any) {
    logger.error('Tenant AI completion error', { provider: tc.provider, error: err.message });
    return { text: err.message || 'AI request failed', input_tokens: 0, output_tokens: 0, model: 'error' };
  }
}

export async function generateCompletionWithOpenAI(
  client: OpenAI,
  opts: CompletionOptions & { model?: string },
): Promise<CompletionResult> {
  const resolvedModel = opts.model || MODEL;
  const isReasoningModel = /^o\d/.test(resolvedModel);

  // Build the create() request for a given response-format mode. o-series (reasoning) models
  // accept no response_format at all.
  const buildRequest = (mode: 'schema' | 'object' | 'none') => ({
    model: resolvedModel,
    ...(isReasoningModel
      ? { max_completion_tokens: opts.maxTokens || MAX_TOKENS }
      : { max_tokens: opts.maxTokens || MAX_TOKENS }),
    messages: [
      { role: 'system' as const, content: opts.system },
      { role: 'user' as const, content: opts.userMessage },
    ],
    ...(mode === 'schema' && opts.jsonSchema
      ? {
          response_format: {
            type: 'json_schema' as const,
            json_schema: { name: opts.jsonSchema.name, schema: opts.jsonSchema.schema, strict: true },
          },
        }
      : mode === 'object'
        ? { response_format: { type: 'json_object' as const } }
        : {}),
  });

  const toResult = (response: OpenAI.Chat.Completions.ChatCompletion): CompletionResult => ({
    text: response.choices[0]?.message?.content || '',
    input_tokens: response.usage?.prompt_tokens || 0,
    output_tokens: response.usage?.completion_tokens || 0,
    model: resolvedModel,
  });

  // Prefer strict json_schema when supplied (and supported); json_object otherwise; none for o-series.
  const initialMode: 'schema' | 'object' | 'none' = isReasoningModel
    ? 'none'
    : opts.jsonSchema
      ? 'schema'
      : opts.jsonMode
        ? 'object'
        : 'none';

  try {
    return toResult(await client.chat.completions.create(buildRequest(initialMode)));
  } catch (err: any) {
    // A BYOK tenant's model/proxy may not support json_schema (older snapshots, gpt-3.5, OpenAI-
    // compatible proxies). Rather than hard-fail such tenants to the deterministic fallback — a
    // REGRESSION vs the json_object mode that worked before — downgrade ONCE to json_object.
    if (initialMode === 'schema') {
      logger.warn('OpenAI json_schema unsupported; downgrading to json_object', {
        model: resolvedModel,
        error: err?.message,
      });
      try {
        return toResult(await client.chat.completions.create(buildRequest('object')));
      } catch (err2: any) {
        logger.error('OpenAI completion error (after json_object downgrade)', { error: err2?.message });
        return { text: opts.userMessage, input_tokens: 0, output_tokens: 0, model: 'fallback' };
      }
    }
    logger.error('OpenAI completion error', { error: err.message });
    return { text: opts.userMessage, input_tokens: 0, output_tokens: 0, model: 'fallback' };
  }
}

// ─── Vision completion (for architecture diagram images) ────────────────────

export async function generateVisionCompletion(opts: {
  system: string;
  imageBase64: string;
  mimeType: string;
  textPrompt?: string;
  maxTokens?: number;
  tenantId?: string;
}): Promise<CompletionResult> {
  if (opts.tenantId) {
    const tc = await getClientForTenant(opts.tenantId);
    if (!tc) {
      return {
        text: 'AI features require configuration. Go to Settings → AI to add your API key.',
        input_tokens: 0,
        output_tokens: 0,
        model: 'disabled',
      };
    }
    return generateVisionCompletionWithClient(tc, opts);
  }

  // Platform-scoped fallback (system/internal use)
  const client = getClient();
  if (!client) {
    return { text: '[]', input_tokens: 0, output_tokens: 0, model: 'fallback' };
  }
  return generateVisionCompletionWithOpenAI(client, MODEL, opts);
}

async function generateVisionCompletionWithOpenAI(
  client: OpenAI,
  model: string,
  opts: { system: string; imageBase64: string; mimeType: string; textPrompt?: string; maxTokens?: number },
): Promise<CompletionResult> {
  try {
    const response = await client.chat.completions.create({
      model,
      max_tokens: opts.maxTokens || MAX_TOKENS,
      messages: [
        { role: 'system', content: opts.system },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:${opts.mimeType};base64,${opts.imageBase64}` },
            },
            ...(opts.textPrompt ? [{ type: 'text' as const, text: opts.textPrompt }] : []),
          ],
        },
      ],
    });

    return {
      text: response.choices[0]?.message?.content || '',
      input_tokens: response.usage?.prompt_tokens || 0,
      output_tokens: response.usage?.completion_tokens || 0,
      model,
    };
  } catch (err: any) {
    logger.error('AI vision completion error', { error: err.message });
    return { text: '[]', input_tokens: 0, output_tokens: 0, model: 'fallback' };
  }
}

async function generateVisionCompletionWithClient(
  tc: TenantAIClient,
  opts: { system: string; imageBase64: string; mimeType: string; textPrompt?: string; maxTokens?: number },
): Promise<CompletionResult> {
  try {
    if (tc.provider === 'openai' && tc.openai) {
      return generateVisionCompletionWithOpenAI(tc.openai, tc.model, opts);
    }
    if (tc.provider === 'anthropic' && tc.anthropic) {
      const msg = await tc.anthropic.messages.create({
        model: tc.model,
        max_tokens: opts.maxTokens || MAX_TOKENS,
        system: opts.system,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: opts.mimeType as any, data: opts.imageBase64 },
              },
              ...(opts.textPrompt ? [{ type: 'text' as const, text: opts.textPrompt }] : []),
            ],
          },
        ],
      });
      const text = msg.content.find((b) => b.type === 'text')?.text ?? '';
      return { text, input_tokens: msg.usage.input_tokens, output_tokens: msg.usage.output_tokens, model: tc.model };
    }
    if (tc.provider === 'google' && tc.google) {
      const genModel = tc.google.getGenerativeModel({ model: tc.model, systemInstruction: opts.system });
      const result = await genModel.generateContent([
        { inlineData: { mimeType: opts.mimeType, data: opts.imageBase64 } },
        ...(opts.textPrompt ? [{ text: opts.textPrompt }] : []),
      ]);
      const text = result.response.text();
      const usage = result.response.usageMetadata;
      return {
        text,
        input_tokens: usage?.promptTokenCount ?? 0,
        output_tokens: usage?.candidatesTokenCount ?? 0,
        model: tc.model,
      };
    }
    return { text: '[]', input_tokens: 0, output_tokens: 0, model: 'fallback' };
  } catch (err: any) {
    logger.error('Tenant AI vision completion error', { provider: tc.provider, error: err.message });
    return { text: '[]', input_tokens: 0, output_tokens: 0, model: 'error' };
  }
}

// ─── Multi-turn completion ───────────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function generateChatCompletion(
  system: string,
  messages: ChatMessage[],
  maxTokens?: number,
  tenantId?: string,
): Promise<CompletionResult> {
  if (tenantId) {
    const tc = await getClientForTenant(tenantId);
    if (!tc) {
      return {
        text: 'AI features require configuration. Go to Settings → AI to add your API key.',
        input_tokens: 0,
        output_tokens: 0,
        model: 'disabled',
      };
    }
    try {
      if (tc.provider === 'openai' && tc.openai) {
        const response = await tc.openai.chat.completions.create({
          model: tc.model,
          max_tokens: maxTokens || MAX_TOKENS,
          messages: [
            { role: 'system', content: system },
            ...messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
          ],
        });
        return {
          text: response.choices[0]?.message?.content || '',
          input_tokens: response.usage?.prompt_tokens || 0,
          output_tokens: response.usage?.completion_tokens || 0,
          model: tc.model,
        };
      }
      if (tc.provider === 'anthropic' && tc.anthropic) {
        const msg = await tc.anthropic.messages.create({
          model: tc.model,
          max_tokens: maxTokens || MAX_TOKENS,
          system,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
        });
        const text = msg.content.find((b) => b.type === 'text')?.text ?? '';
        return {
          text,
          input_tokens: msg.usage.input_tokens,
          output_tokens: msg.usage.output_tokens,
          model: tc.model,
        };
      }
      if (tc.provider === 'google' && tc.google) {
        const genModel = tc.google.getGenerativeModel({ model: tc.model, systemInstruction: system });
        const chat = genModel.startChat({
          history: messages.slice(0, -1).map((m) => ({
            role: m.role === 'user' ? 'user' : 'model',
            parts: [{ text: m.content }],
          })),
        });
        const last = messages[messages.length - 1];
        const result = await chat.sendMessage(last?.content ?? '');
        const text = result.response.text();
        const usage = result.response.usageMetadata;
        return {
          text,
          input_tokens: usage?.promptTokenCount ?? 0,
          output_tokens: usage?.candidatesTokenCount ?? 0,
          model: tc.model,
        };
      }
    } catch (err: any) {
      logger.error('Tenant AI chat completion error', { provider: tc.provider, error: err.message });
      return { text: err.message || 'AI request failed', input_tokens: 0, output_tokens: 0, model: 'error' };
    }
  }

  // existing platform-key path
  const client = getClient();
  if (!client) {
    return {
      text: 'AI features are not available. Please configure OPENAI_API_KEY.',
      input_tokens: 0,
      output_tokens: 0,
      model: 'fallback',
    };
  }

  try {
    const response = await client.chat.completions.create({
      model: MODEL,
      max_tokens: maxTokens || MAX_TOKENS,
      messages: [
        { role: 'system', content: system },
        ...messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      ],
    });

    return {
      text: response.choices[0]?.message?.content || '',
      input_tokens: response.usage?.prompt_tokens || 0,
      output_tokens: response.usage?.completion_tokens || 0,
      model: MODEL,
    };
  } catch (err: any) {
    logger.error('AI chat completion error, falling back', { error: err.message });
    return {
      text: 'AI features are temporarily unavailable. Please try again later.',
      input_tokens: 0,
      output_tokens: 0,
      model: 'fallback',
    };
  }
}

// ─── Streaming completion ────────────────────────────────────────────────────

export interface StreamCallbacks {
  onText: (text: string) => void;
  onDone: (usage: { input_tokens: number; output_tokens: number }) => void;
  onError: (error: Error) => void;
}

// ─── Tool-use completion (for agent orchestrator) ────────────────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, any>;
}

export interface ToolUseCompletionOptions {
  system: string;
  userMessage: string;
  tools: ToolDefinition[];
  model?: string;
  maxTokens?: number;
  tenantId?: string;
}

export interface ToolUseResult {
  text_blocks: string[];
  tool_calls: { tool_name: string; tool_input: Record<string, any> }[];
  input_tokens: number;
  output_tokens: number;
  model: string;
}

export async function generateToolUseCompletion(opts: ToolUseCompletionOptions): Promise<ToolUseResult> {
  if (opts.tenantId) {
    const tenantClient = await getClientForTenant(opts.tenantId);
    if (!tenantClient) {
      return {
        text_blocks: ['AI features require configuration. Go to Settings → AI to add your API key.'],
        tool_calls: [],
        input_tokens: 0,
        output_tokens: 0,
        model: 'disabled',
      };
    }
    if (tenantClient.provider === 'openai' && tenantClient.openai) {
      return generateToolUseWithOpenAI(tenantClient.openai, { ...opts, model: tenantClient.model });
    }
    if (tenantClient.provider === 'anthropic' && tenantClient.anthropic) {
      return generateToolUseWithAnthropic(tenantClient.anthropic, { ...opts, model: tenantClient.model });
    }
    // Google: no tool-use path yet
    return {
      text_blocks: ['Tool-use AI is only available with OpenAI or Anthropic. Switch providers in Settings → AI.'],
      tool_calls: [],
      input_tokens: 0,
      output_tokens: 0,
      model: 'disabled',
    };
  }

  const client = getClient();

  if (!client) {
    return {
      text_blocks: ['AI features are not available. Please configure OPENAI_API_KEY.'],
      tool_calls: [],
      input_tokens: 0,
      output_tokens: 0,
      model: 'fallback',
    };
  }

  return generateToolUseWithOpenAI(client, opts);
}

async function generateToolUseWithOpenAI(
  client: OpenAI,
  opts: ToolUseCompletionOptions,
): Promise<ToolUseResult> {
  const model = opts.model || MODEL;
  try {
    const openaiTools: OpenAI.Chat.Completions.ChatCompletionTool[] = opts.tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));

    const response = await client.chat.completions.create({
      model,
      max_tokens: opts.maxTokens || MAX_TOKENS,
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.userMessage },
      ],
      tools: openaiTools,
    });

    const choice = response.choices[0];
    const textBlocks: string[] = [];
    const toolCalls: { tool_name: string; tool_input: Record<string, any> }[] = [];

    if (choice?.message?.content) {
      textBlocks.push(choice.message.content);
    }

    if (choice?.message?.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        if (tc.type === 'function') {
          toolCalls.push({
            tool_name: tc.function.name,
            tool_input: JSON.parse(tc.function.arguments || '{}'),
          });
        }
      }
    }

    return {
      text_blocks: textBlocks,
      tool_calls: toolCalls,
      input_tokens: response.usage?.prompt_tokens || 0,
      output_tokens: response.usage?.completion_tokens || 0,
      model,
    };
  } catch (err: any) {
    logger.error('AI tool-use completion error', { error: err.message });
    return {
      text_blocks: [`AI tool-use completion failed: ${err.message}`],
      tool_calls: [],
      input_tokens: 0,
      output_tokens: 0,
      model: 'fallback',
    };
  }
}

async function generateToolUseWithAnthropic(
  client: Anthropic,
  opts: ToolUseCompletionOptions,
): Promise<ToolUseResult> {
  // Anthropic has no platform-wide fallback model (MODEL/getClient() are
  // OpenAI-only) — a missing tenant model here is a config bug, not a case
  // to silently default away from.
  const model = opts.model;
  if (!model) {
    return {
      text_blocks: ['AI tool-use completion failed: no Anthropic model configured for this tenant.'],
      tool_calls: [],
      input_tokens: 0,
      output_tokens: 0,
      model: 'fallback',
    };
  }
  try {
    const anthropicTools = opts.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema as Anthropic.Tool.InputSchema,
    }));

    const msg = await client.messages.create({
      model,
      max_tokens: opts.maxTokens || MAX_TOKENS,
      system: opts.system,
      messages: [{ role: 'user', content: opts.userMessage }],
      tools: anthropicTools,
    });

    const textBlocks: string[] = [];
    const toolCalls: { tool_name: string; tool_input: Record<string, any> }[] = [];

    for (const block of msg.content) {
      if (block.type === 'text') {
        textBlocks.push(block.text);
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          tool_name: block.name,
          tool_input: (block.input as Record<string, any>) || {},
        });
      }
    }

    return {
      text_blocks: textBlocks,
      tool_calls: toolCalls,
      input_tokens: msg.usage?.input_tokens || 0,
      output_tokens: msg.usage?.output_tokens || 0,
      model,
    };
  } catch (err: any) {
    logger.error('AI tool-use completion error (Anthropic)', { error: err.message });
    return {
      text_blocks: [`AI tool-use completion failed: ${err.message}`],
      tool_calls: [],
      input_tokens: 0,
      output_tokens: 0,
      model: 'fallback',
    };
  }
}

// ─── Streaming completion ────────────────────────────────────────────────────

export async function streamChatCompletion(
  system: string,
  messages: ChatMessage[],
  callbacks: StreamCallbacks,
  maxTokens?: number,
  tenantId?: string,
): Promise<void> {
  if (tenantId) {
    const tc = await getClientForTenant(tenantId);
    if (!tc) {
      callbacks.onText('AI features require configuration. Go to Settings → AI to add your API key.');
      callbacks.onDone({ input_tokens: 0, output_tokens: 0 });
      return;
    }
    if (tc.provider === 'openai' && tc.openai) {
      // Use tenant OpenAI client to stream
      try {
        const stream = await tc.openai.chat.completions.create({
          model: tc.model,
          max_tokens: maxTokens || MAX_TOKENS,
          messages: [
            { role: 'system', content: system },
            ...messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
          ],
          stream: true,
          stream_options: { include_usage: true },
        });

        let usage = { input_tokens: 0, output_tokens: 0 };

        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta;
          if (delta?.content) {
            callbacks.onText(delta.content);
          }
          if (chunk.usage) {
            usage = {
              input_tokens: chunk.usage.prompt_tokens || 0,
              output_tokens: chunk.usage.completion_tokens || 0,
            };
          }
        }

        callbacks.onDone(usage);
        return;
      } catch (err: any) {
        logger.error('Tenant AI streaming error', { error: err.message });
        callbacks.onText('AI features are temporarily unavailable. Your question has been saved and you can try again later when the AI service is restored.');
        callbacks.onDone({ input_tokens: 0, output_tokens: 0 });
        return;
      }
    }
    // Non-OpenAI providers don't support streaming in this implementation
    callbacks.onText('Streaming AI is only available with OpenAI. Switch to OpenAI in Settings → AI.');
    callbacks.onDone({ input_tokens: 0, output_tokens: 0 });
    return;
  }

  const client = getClient();
  if (!client) {
    callbacks.onText('AI features are not available. Please configure OPENAI_API_KEY.');
    callbacks.onDone({ input_tokens: 0, output_tokens: 0 });
    return;
  }

  try {
    const stream = await client.chat.completions.create({
      model: MODEL,
      max_tokens: maxTokens || MAX_TOKENS,
      messages: [
        { role: 'system', content: system },
        ...messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      ],
      stream: true,
      stream_options: { include_usage: true },
    });

    let usage = { input_tokens: 0, output_tokens: 0 };

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (delta?.content) {
        callbacks.onText(delta.content);
      }
      if (chunk.usage) {
        usage = {
          input_tokens: chunk.usage.prompt_tokens || 0,
          output_tokens: chunk.usage.completion_tokens || 0,
        };
      }
    }

    callbacks.onDone(usage);
  } catch (err: any) {
    logger.error('AI streaming error, sending fallback response', { error: err.message });
    callbacks.onText('AI features are temporarily unavailable. Your question has been saved and you can try again later when the AI service is restored.');
    callbacks.onDone({ input_tokens: 0, output_tokens: 0 });
  }
}
