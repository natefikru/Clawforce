# Research Agent Role

**Role Type**: Research & Analysis
**Complexity**: Medium
**Recommended for**: Teams that need on-demand web research and competitive intelligence

## What It Does

- Accepts research requests via Slack
- Browses the web using browser automation
- Compiles structured reports with source attribution
- Posts draft reports to approval channel before delivery

## Requirements

- Slack workspace with bot installed
- Browser automation (Chromium) available in container
- Approval channel for human-in-the-loop mode

## Cost Estimate

- **Local mode (Ollama)**: ~$2-5/day (research is reasoning-heavy)
- **Cloud mode (Claude)**: ~$10-30/day
- Hybrid (70% local): ~$5-10/day

## Customization

Edit `SKILL.md` to:
- Change report format
- Add domain-specific research instructions
- Adjust source quality requirements
- Modify approval workflow
