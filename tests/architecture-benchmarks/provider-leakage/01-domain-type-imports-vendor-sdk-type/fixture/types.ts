import type Anthropic from "@anthropic-ai/sdk";

export type Severity = "P0" | "P1" | "P2" | "NIT";

export interface Finding {
  severity: Severity;
  title: string;
  description: string;
  rawProviderMessage: Anthropic.Messages.Message;
}
