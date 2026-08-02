import Anthropic from "@anthropic-ai/sdk";
import type { TeacherClient, TeacherRequest, TeacherResponse } from "./types.js";

/**
 * Real teacher implementation backed by the Anthropic Messages API
 * (SPEC-APP.md §7.3). Deliberately the ONLY module in pipeline/src/qa that
 * touches the SDK's real transport — every other module takes a
 * `TeacherClient` and is exercised in the gate against a mock (see
 * test/qa.helpers.ts). This class itself is never constructed by the test
 * suite; it's wired up by src/qa/cli.ts and the live-smoke check.
 *
 * temperature is only sent when explicitly configured — recent Claude
 * models (e.g. Sonnet 5) reject a non-default sampling parameter with a
 * 400, so the safe default is to omit it entirely and let the API use its
 * own default rather than guessing a "safe" value.
 */
export class AnthropicTeacherClient implements TeacherClient {
  private readonly client: Anthropic;

  constructor(client?: Anthropic) {
    this.client = client ?? new Anthropic();
  }

  async generate(request: TeacherRequest): Promise<TeacherResponse> {
    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: request.model,
      max_tokens: request.maxTokens,
      system: request.system,
      messages: [{ role: "user", content: request.user }],
    };
    if (typeof request.temperature === "number") {
      params.temperature = request.temperature;
    }

    const response = await this.client.messages.create(params);

    const textBlock = response.content.find(
      (block): block is Anthropic.TextBlock => block.type === "text",
    );

    return {
      text: textBlock?.text ?? "",
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }
}
