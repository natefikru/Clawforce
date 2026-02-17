# Supervisor Role

**Role Type**: Multi-agent Operations  
**Complexity**: High  
**Recommended for**: Teams running multiple agents that need centralized status visibility and escalation controls.

## What It Does

- Monitors supervised agents for activity, failures, and cost risk
- Answers real-time workforce status requests
- Escalates incidents and policy/compliance concerns
- Recommends workload redistribution when capacity is uneven

## Requirements

- Multi-agent configuration with `agents[]`
- At least one agent with `role: supervisor`
- `supervises` list configured for each supervisor agent
- OpenClaw channels configured for status reporting

## Notes

- `role: supervisor` is not valid in single-agent mode.
- Supervisor access should remain scoped to listed supervised agents.
