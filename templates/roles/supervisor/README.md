# Supervisor Workspace Example

**Complexity**: High
**Recommended for**: Teams running multiple agents that need centralized status visibility and escalation controls.

## What It Does

- Monitors supervised agents for activity, failures, and cost risk
- Answers real-time workforce status requests
- Escalates incidents and policy/compliance concerns
- Recommends workload redistribution when capacity is uneven

## Requirements

- Multi-agent configuration with `agents[]`
- At least one agent with a `supervises` list
- `workspace` pointing to a directory with appropriate SOUL.md, HEARTBEAT.md, etc.
- OpenClaw channels configured for status reporting

## Notes

- An agent becomes a supervisor by having a `supervises` field listing other agent names.
- Supervisor access should remain scoped to listed supervised agents.
- `clawforce_workforce_status` is not auto-wired into OpenClaw yet; wire custom tools via `openclaw` overrides once the runtime plugin is installed.
