# HR Recruitment Agent · Skills Installation Guide

## Overview

This Skills package enables AI-powered resume screening for MCN industry HR teams.
It covers three steps automatically: resume parsing, job matching, and diagnostic report generation.

Built-in JD knowledge base: 43 positions across 15 departments.
No external knowledge base or platform dependency required.

## Files Included

- `SKILL.md` — Core skill definition, workflow, and built-in JD knowledge base
- `README.md` — This installation guide
- `jd-reference.md` — Standalone JD reference for manual updates

## Installation (claude.ai)

1. Go to claude.ai → Settings → Skills
2. Click "Add Skill" → Upload ZIP file
3. Select `hr-recruitment-agent.zip`
4. Confirm installation

## Trigger Keywords

| Keyword | Action |
|---------|--------|
| Upload resume / Analyze resume / Parse resume | Step 1 only |
| Job matching / Match position | Step 2 only |
| Generate report / Diagnostic card | Step 3 only |
| Paste or upload resume directly | Full 3-step flow |

## Usage

1. Open a new conversation and type any trigger keyword, or directly paste/upload a resume
2. The assistant will automatically run all three steps and output results in one response
3. Start a new conversation for each new candidate

## Updating the JD Knowledge Base

When new positions are added or existing ones change:

1. Edit the JD section at the bottom of `SKILL.md`
2. Follow the existing format:岗位 name, salary, education, experience, duties, requirements, hidden profile
3. Re-zip the folder and reinstall the skill

For reference, see `jd-reference.md` for the full formatted JD library.

## Compatibility

- claude.ai (Pro / Team / Enterprise)
- Any platform supporting Claude Skills (.zip format)
- Works standalone — no Dify, no WeChat Work, no external APIs required
