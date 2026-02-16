import { z } from "zod";

const jsonSchemaObject = z.object({
  type: z.string(),
}).passthrough();
const capabilitySchema = z.string().regex(
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  "Capabilities must use kebab-case identifiers",
);
const permissionSchema = z.string().regex(
  /^(hooks|storage|alerts|config):[a-z0-9_]+$/,
  "Permissions must be namespaced as <domain>:<action>",
);

export const OpenClawPluginManifestSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  engines: z.object({
    clawforce: z.string().min(1),
    openclaw: z.string().min(1),
  }),
  capabilities: z.array(capabilitySchema).min(1),
  permissions: z.array(permissionSchema).min(1),
  configSchema: jsonSchemaObject,
});

export type OpenClawPluginManifest = z.infer<typeof OpenClawPluginManifestSchema>;

