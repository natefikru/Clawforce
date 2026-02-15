# Process Automator Role

**Role Type**: Workflow Automation
**Complexity**: High
**Recommended for**: Teams with repetitive browser-based tasks (data entry, report pulling, form submissions)

## What It Does

- Executes browser-based workflows on schedule or on-demand
- Navigates web interfaces, fills forms, extracts data
- Reports task completion/failure to Slack
- Captures screenshots on errors for debugging

## Requirements

- Slack workspace with bot installed
- Browser automation (Chromium) available in container
- Approval channel for human-in-the-loop mode
- Cron scheduling for automated triggers

## Cost Estimate

- **Local mode (Ollama)**: ~$3-8/day (browser automation is token-heavy)
- **Cloud mode (Claude)**: ~$15-40/day
- Hybrid (70% local): ~$8-15/day

## Customization

Edit `SKILL.md` to:
- Add specific workflow instructions
- Configure error handling behavior
- Adjust approval requirements
- Add credentials via environment variables
