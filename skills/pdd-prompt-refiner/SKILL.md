---
name: pdd-prompt-refiner
description: Turn rough, underspecified, or low-quality coding requests into execution-ready Prompt-Driven Development (PDD) prompts for Codex and similar coding agents. Use when the user wants a better prompt instead of immediate implementation, when the task requires grounding in the current repo before writing the prompt, or when the request contains ambiguity, conflicts, missing context, unclear subsystem boundaries, or incomplete data-flow / interface details.
---

# PDD Prompt Refiner

## Overview

Convert a weak raw request into one final coding prompt that another agent can execute directly.
Do a real dry-run first: inspect the repo, trace relevant code paths, identify conflicts and assumptions, ask targeted clarifying questions, then synthesize the final prompt.

## Core Rules

- Prefer the strongest semantic repo search available first, such as `codebase-retrieval`.
- Use exact-text search such as `rg` only when searching for a known identifier, error string, config key, or path fragment.
- Stay in read-only dry-run mode by default. Do not edit repo-tracked files while refining the prompt.
- Derive facts from the repo before asking the user. Do not ask questions that the codebase can answer.
- Ask only high-impact questions that change the implementation plan, public interface, data model, rollout, or validation strategy.
- Prefer 1–3 multiple-choice questions per round with a recommended option. Use open questions only when choices would be misleading.
- Do not guess through contradictions. If requirements conflict, call out the conflict and ask the user to resolve it.
- Do not output the final prompt until every blocking ambiguity is resolved or explicitly downgraded into a locked assumption.

## Workflow

### 1. Receive the raw request

- Restate the task in one sentence to ensure you understand the user's intent.
- Detect whether the user wants prompt refinement rather than immediate code changes.
- Extract the obvious dimensions up front: target outcome, repo or workspace, likely subsystem, constraints, deliverable, and anything already fixed by the user.
- If there is no repo or the repo is irrelevant, fall back to user-input-only refinement and keep the rest of the workflow lightweight.

### 2. Ground in the repo

- Find the likely entrypoints, owning packages, CLI commands, API routes, background jobs, schemas, tests, configs, or UI surfaces involved.
- Trace the current implementation shape before inventing a target shape.
- Capture only facts that matter to execution: current boundaries, existing abstractions, relevant files, existing tests, configuration knobs, and known invariants.
- Prefer concise fact extraction over long code summaries.
- If the repo clearly answers a question, treat it as resolved and do not ask the user.

### 3. Run a dry implementation pass

- Walk the key call chain end to end.
- Identify touched subsystems, data flow, state transitions, side effects, validation points, and failure modes.
- Infer what the implementing agent will need to know: modules, classes, methods, tables, events, queues, API shapes, config files, and test seams.
- Use `references/dry-run-checklist.md` when you need a structured pass over architecture, control flow, state, and validation.
- Run lightweight non-mutating validation only when it improves confidence, such as listing tests, running a narrow check, or verifying a command exists.

### 4. Build the ambiguity and conflict list

- Separate unknowns into three buckets: repo-resolvable facts, user preferences, and contradictions.
- Convert only the real decision points into questions.
- Highlight contradictions explicitly, such as “reuse existing endpoint” vs “create a new service”, or “no schema changes” vs “add persisted state”.
- If the request is still too vague, narrow it by proposing concrete alternatives based on the repo you inspected.

### 5. Run a clarification round

- Ask 1–3 high-impact questions at a time.
- Prefer multiple-choice options with a recommended default.
- Make each option concrete and implementation-relevant.
- Use `references/question-catalog.md` for common question shapes covering scope, interface, compatibility, data ownership, and validation.
- If the user does not answer every question, proceed only with safe defaults and record them as locked assumptions.

### 6. Synthesize the final prompt

- Read `references/prompt-template.md` before writing the final prompt.
- Output exactly one final prompt body and nothing else when the task is ready.
- Make the prompt directly executable by a coding agent: specific, structured, repo-aware, and decision-complete.
- Follow the language of the user's raw request. Keep technical terms, symbols, APIs, and identifiers in their original form when needed.
- Fold clarified decisions and safe defaults into `Locked assumptions / Constraints` inside the prompt rather than adding a separate appendix.

## Output Contract

Return a single final prompt body only after the task is execution-ready.

That final prompt must include:

- Goal and success criteria
- Confirmed repo/context facts
- Scope and non-goals
- Implementation requirements grouped by subsystem
- Field / type / API / data-flow topology that matters to the change
- Constraints and locked assumptions
- Validation steps
- Expected deliverable format

If blocking ambiguity remains, do not output the final prompt. Continue asking questions instead.

## Question Strategy

- Ask about product intent before coding style when both are unclear.
- Ask about public interfaces, persistence, compatibility, and rollout before asking about naming.
- Prefer choices derived from the current repo state instead of generic choices.
- Collapse low-impact uncertainty into assumptions.
- Keep the user load low: fewer questions, better options, stronger recommendations.

## Quality Bar

The final prompt should let another agent start implementing without needing to rediscover:

- where the change lives,
- what existing behavior must be preserved,
- what new behavior is required,
- which interfaces or data shapes matter,
- what should not be changed,
- and how success will be verified.

If the prompt still sounds generic, you have not grounded enough.

## References

- `references/prompt-template.md` — final prompt skeleton and section contract
- `references/question-catalog.md` — reusable clarification patterns and option styles
- `references/dry-run-checklist.md` — repo-grounding and implementation-analysis checklist
