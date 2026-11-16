"use node";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { GoogleGenAI } from "@google/genai";
import { v } from "convex/values";
import { z } from "zod";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { extractionModels, extractionVendor } from "./lib/config";
import {
  ExtractionSchema,
  SYSTEM_PROMPT,
  USER_PROMPT,
  draftFromExtraction,
  extractWithFallback,
  type ExtractionImage,
  type ModelCaller,
} from "./lib/extraction";

/**
 * Reads a Draft Recipe's photos with the configured models (#2) and writes
 * the result back. Convex doesn't retry actions, so the fallback lives here.
 * Scheduled by `recipes.createDraft` / `recipes.retryExtraction`.
 */

const TIMEOUT_MS = 120_000;
const MAX_OUTPUT_TOKENS = 8192;

/** JSON Schema for Gemini, without the `$schema` meta key. */
function geminiSchema(): Record<string, unknown> {
  const schema: Record<string, unknown> = { ...z.toJSONSchema(ExtractionSchema) };
  delete schema.$schema;
  return schema;
}

const base64 = (img: ExtractionImage) => Buffer.from(img.data).toString("base64");

function requireKey(name: string): string {
  const key = process.env[name];
  if (!key) throw new Error(`${name} is not set`);
  return key;
}

/** Claude: thinking off, effort low, schema-constrained structured output. */
function claudeCaller(model: string): ModelCaller {
  return {
    model,
    call: async (images) => {
      const client = new Anthropic({
        apiKey: requireKey("ANTHROPIC_API_KEY"),
        timeout: TIMEOUT_MS,
        maxRetries: 1,
      });
      const message = await client.messages.parse({
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        // Haiku has no between-tools mode; both mean "no up-front thinking".
        thinking: model.includes("haiku") ? { type: "disabled" } : { type: "between_tools" },
        output_config: { effort: "low", format: zodOutputFormat(ExtractionSchema) },
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              ...images.map((img) => ({
                type: "image" as const,
                source: {
                  type: "base64" as const,
                  media_type: "image/jpeg" as const,
                  data: base64(img),
                },
              })),
              { type: "text" as const, text: USER_PROMPT },
            ],
          },
        ],
      });
      if (message.stop_reason !== "end_turn") {
        throw new Error(`stop_reason ${message.stop_reason}`);
      }
      if (!message.parsed_output) throw new Error("no parsed output");
      return message.parsed_output;
    },
  };
}

/** Gemini: ultra_high media resolution; JSON is only syntax-checked, so the caller's output is validated in code. */
function geminiCaller(model: string): ModelCaller {
  return {
    model,
    call: async (images) => {
      const ai = new GoogleGenAI({ apiKey: requireKey("GEMINI_API_KEY") });
      const interaction = await ai.interactions.create({
        model,
        store: false,
        system_instruction: SYSTEM_PROMPT,
        input: [
          ...images.map((img) => ({
            type: "image" as const,
            data: base64(img),
            mime_type: "image/jpeg",
            resolution: "ultra_high",
          })),
          { type: "text" as const, text: USER_PROMPT },
        ],
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema: geminiSchema(),
        },
        generation_config: {
          thinking_level: "low",
          max_output_tokens: MAX_OUTPUT_TOKENS,
        },
      });
      const text = "output_text" in interaction ? interaction.output_text : undefined;
      if (!text) throw new Error("empty output");
      return text;
    },
  };
}

function callersFor(models: string[]): ModelCaller[] {
  return models.map((model) =>
    extractionVendor(model) === "anthropic" ? claudeCaller(model) : geminiCaller(model),
  );
}

export const run = internalAction({
  args: { recipeId: v.id("recipes"), startedAt: v.number() },
  returns: v.null(),
  handler: async (ctx, { recipeId, startedAt }) => {
    const fail = (error: string) =>
      ctx.runMutation(internal.recipes.failExtraction, { recipeId, startedAt, error });
    try {
      const storageIds = await ctx.runQuery(internal.recipes.extractionInput, {
        recipeId,
        startedAt,
      });
      if (storageIds === null) return null; // discarded or superseded
      const images: ExtractionImage[] = [];
      for (const id of storageIds) {
        const blob = await ctx.storage.get(id);
        if (blob === null) {
          await fail("photo missing from storage");
          return null;
        }
        images.push({ data: new Uint8Array(await blob.arrayBuffer()), mediaType: "image/jpeg" });
      }
      const outcome = await extractWithFallback(callersFor(extractionModels()), images);
      if (!outcome.ok) {
        await fail(outcome.error);
        return null;
      }
      await ctx.runMutation(internal.recipes.applyExtraction, {
        recipeId,
        startedAt,
        model: outcome.model,
        draft: draftFromExtraction(outcome.result),
      });
    } catch (err) {
      await fail(err instanceof Error ? err.message : String(err));
    }
    return null;
  },
});
