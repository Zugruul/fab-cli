import Anthropic from "@anthropic-ai/sdk";
import type { JudgeClient, JudgeRequest, JudgeResponse } from "./types.js";

/**
 * Real judge implementation backed by the Anthropic Messages API
 * (SPEC-APP.md §7.4's "teacher-as-judge"). Deliberately the ONLY module in
 * pipeline/src/sampling that touches the SDK's real transport — every
 * other module takes a `JudgeClient` and is exercised in the gate against
 * a mock (see test/sampling.helpers.ts). This class itself is never
 * constructed by the test suite; it's wired up by src/sampling/cli.ts and
 * the live-smoke check. Mirrors qa/teacher.ts's AnthropicTeacherClient.
 *
 * temperature is only sent when explicitly configured — recent Claude
 * models (e.g. Sonnet 5) reject a non-default sampling parameter with a
 * 400, so the safe default is to omit it entirely and let the API use its
 * own default rather than guessing a "safe" value.
 */
export class AnthropicJudgeClient implements JudgeClient {
  private readonly client: Anthropic;

  constructor(client?: Anthropic) {
    this.client = client ?? new Anthropic();
  }

  async check(request: JudgeRequest): Promise<JudgeResponse> {
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
