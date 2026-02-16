import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/config/parse.js", () => ({
  parseConfig: vi.fn(),
}));

vi.mock("../../../src/plugins/compiler.js", () => ({
  enabledPluginsForConfig: vi.fn(),
  buildPluginsToExtensions: vi.fn(),
  watchPluginsToExtensions: vi.fn(),
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: {
    header: vi.fn(),
    step: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}));

import { parseConfig } from "../../../src/config/parse.js";
import {
  buildPluginsToExtensions,
  enabledPluginsForConfig,
  watchPluginsToExtensions,
} from "../../../src/plugins/compiler.js";
import {
  pluginsBundleCommand,
  pluginsWatchCommand,
} from "../../../src/commands/plugins-watch.js";

describe("plugins commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(parseConfig).mockReturnValue({
      name: "test",
      role: "research-agent",
      slack: {
        app_token: "xapp-test",
        bot_token: "xoxb-test",
        approval_channel: "C0123456789",
        allowed_channels: [],
      },
      models: {
        primary: "anthropic/claude-sonnet-4-5",
        api_key: "sk-ant-test",
      },
    } as never);
  });

  it("bundles enabled plugins", async () => {
    vi.mocked(enabledPluginsForConfig).mockReturnValue([
      "clawforce-router",
      "clawforce-compliance",
    ]);

    await pluginsBundleCommand({ config: "./clawforce.yaml" });

    expect(buildPluginsToExtensions).toHaveBeenCalledWith(
      ["clawforce-router", "clawforce-compliance"],
      expect.stringContaining("clawforce-test/config/extensions"),
    );
  });

  it("throws when no plugins are selected", async () => {
    vi.mocked(enabledPluginsForConfig).mockReturnValue([]);
    await expect(
      pluginsBundleCommand({ config: "./clawforce.yaml" }),
    ).rejects.toThrow("No discovered plugins selected");
  });

  it("starts watch and closes on SIGINT", async () => {
    vi.mocked(enabledPluginsForConfig).mockReturnValue(["clawforce-router"]);
    const close = vi.fn().mockResolvedValue(undefined);
    vi.mocked(watchPluginsToExtensions).mockResolvedValue({ close });
    let sigintHandler: (() => void) | undefined;
    const onceSpy = vi.spyOn(process, "once").mockImplementation((
      event: string | symbol,
      listener: (...args: unknown[]) => void,
    ) => {
      if (event === "SIGINT") {
        sigintHandler = listener as () => void;
      }
      return process;
    });

    const watchPromise = pluginsWatchCommand({ config: "./clawforce.yaml" });
    await Promise.resolve();
    expect(sigintHandler).toBeDefined();
    sigintHandler?.();
    await watchPromise;
    onceSpy.mockRestore();

    expect(watchPluginsToExtensions).toHaveBeenCalledWith(
      ["clawforce-router"],
      expect.stringContaining("clawforce-test/config/extensions"),
    );
    expect(close).toHaveBeenCalledTimes(1);
  });
});
