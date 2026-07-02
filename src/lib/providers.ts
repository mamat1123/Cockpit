import type { AgentProvider } from "../layout/paneLayout";

export interface ProviderMeta {
  id: AgentProvider;
  label: string;
  shortLabel: string;
  mark: string;
  description: string;
  enabled: boolean;
}

export const PROVIDERS: ProviderMeta[] = [
  {
    id: "claude",
    label: "Claude",
    shortLabel: "CL",
    mark: "C",
    description: "Resume or continue a Claude Code session",
    enabled: true,
  },
  {
    id: "codex",
    label: "Codex",
    shortLabel: "CX",
    mark: "X",
    description: "Create a Codex handoff from this session",
    enabled: true,
  },
  {
    id: "zai",
    label: "z.ai",
    shortLabel: "ZA",
    mark: "Z",
    description: "Claude Code on the GLM (z.ai) backend",
    enabled: true,
  },
];

export function providerMeta(id: AgentProvider): ProviderMeta {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
}
