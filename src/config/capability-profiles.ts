/**
 * Predefined capability presets that expand into OpenClaw tool configurations.
 * Applied after role partials, before openclaw passthrough.
 *
 * minimal: Web search only. Safe default for sensitive environments.
 * standard: Adds browser + memory. Good for most use cases.
 * full: Everything enabled. For power users who want maximum capability.
 */

export type CapabilityProfile = "minimal" | "standard" | "full";

const PROFILES: Record<CapabilityProfile, Record<string, unknown>> = {
  minimal: {
    agents: {
      defaults: {
        tools: {
          web_search: { enabled: true },
          memory: { enabled: false },
          sandbox: { enabled: false },
          browser: { enabled: false },
          exec: { enabled: false },
        },
      },
    },
  },
  standard: {
    agents: {
      defaults: {
        tools: {
          web_search: { enabled: true },
          memory: { enabled: true },
          browser: { enabled: true, headless: true },
          sandbox: { enabled: false },
          exec: { enabled: false },
        },
      },
    },
  },
  full: {
    agents: {
      defaults: {
        tools: {
          web_search: { enabled: true },
          memory: { enabled: true },
          browser: { enabled: true, headless: true },
          sandbox: { enabled: true },
          exec: { enabled: true },
          skills: { enabled: true },
          cron: { enabled: true },
        },
      },
    },
  },
};

export function resolveProfile(profile: CapabilityProfile): Record<string, unknown> {
  return structuredClone(PROFILES[profile]);
}
