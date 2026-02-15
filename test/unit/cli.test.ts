import { describe, it, expect } from "vitest";
import { createProgram } from "../../src/cli.js";

describe("CLI", () => {
  it("should have the correct name and description", () => {
    const program = createProgram();
    expect(program.name()).toBe("clawforce");
    expect(program.description()).toContain("Deploy AI agents");
  });

  it("should have version set", () => {
    const program = createProgram();
    expect(program.version()).toMatch(/\d+\.\d+\.\d+/);
  });

  it("should register deploy command", () => {
    const program = createProgram();
    const deploy = program.commands.find((c) => c.name() === "deploy");
    expect(deploy).toBeDefined();
    expect(deploy!.description()).toContain("Deploy");
  });

  it("should register status command", () => {
    const program = createProgram();
    const status = program.commands.find((c) => c.name() === "status");
    expect(status).toBeDefined();
  });

  it("should register stop command", () => {
    const program = createProgram();
    const stop = program.commands.find((c) => c.name() === "stop");
    expect(stop).toBeDefined();
  });

  it("should register audit command", () => {
    const program = createProgram();
    const audit = program.commands.find((c) => c.name() === "audit");
    expect(audit).toBeDefined();
  });

  it("deploy command should have --config option defaulting to ./clawforce.yaml", () => {
    const program = createProgram();
    const deploy = program.commands.find((c) => c.name() === "deploy")!;
    const configOption = deploy.options.find((o) => o.long === "--config");
    expect(configOption).toBeDefined();
    expect(configOption!.defaultValue).toBe("./clawforce.yaml");
  });

  it("audit command should have --tail option defaulting to 50", () => {
    const program = createProgram();
    const audit = program.commands.find((c) => c.name() === "audit")!;
    const tailOption = audit.options.find((o) => o.long === "--tail");
    expect(tailOption).toBeDefined();
    expect(tailOption!.defaultValue).toBe("50");
  });

  it("should register route-test command", () => {
    const program = createProgram();
    const routeTest = program.commands.find((c) => c.name() === "route-test");
    expect(routeTest).toBeDefined();
    expect(routeTest!.description()).toContain("routing");
  });

  it("route-test command should have --config option defaulting to ./clawforce.yaml", () => {
    const program = createProgram();
    const routeTest = program.commands.find((c) => c.name() === "route-test")!;
    const configOption = routeTest.options.find((o) => o.long === "--config");
    expect(configOption).toBeDefined();
    expect(configOption!.defaultValue).toBe("./clawforce.yaml");
  });
});
