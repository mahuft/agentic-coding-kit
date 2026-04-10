# Final Prompt Template

Use this template only after the request is ready for implementation.
Output the final prompt body only. Do not wrap it with commentary about your own process.

## Template

```md
# Task

<One-sentence implementation goal.>

## Success Criteria

- <Observable outcome 1>
- <Observable outcome 2>
- <Observable outcome 3>

## Confirmed Context

- Repo/workspace: <path or repo name, or say no repo context>
- Relevant subsystem(s): <packages, services, screens, jobs, commands>
- Existing implementation facts:
  - <fact 1>
  - <fact 2>
  - <fact 3>

## Scope

- In scope:
  - <change 1>
  - <change 2>
- Out of scope:
  - <non-goal 1>
  - <non-goal 2>

## Implementation Requirements

### <Subsystem or flow 1>

- <required behavior>
- <current constraint or invariant to preserve>
- <new logic to add or modify>

### <Subsystem or flow 2>

- <required behavior>
- <integration or call-chain detail>

## Data / Interface Topology

- Inputs:
  - <request fields, config, env vars, events, CLI args>
- Outputs:
  - <response shape, persisted state, emitted event, rendered UI>
- Important types / schemas / contracts:
  - <type or schema detail>
- Data flow:
  - <source> -> <transform> -> <sink>

## Locked Assumptions / Constraints

- <assumption or decision 1>
- <assumption or decision 2>
- <compatibility or migration boundary>
- <things the agent must not change>

## Validation

- <specific test or check 1>
- <specific test or check 2>
- <manual verification 1 if needed>

## Deliverable

- Modify only the necessary files.
- Keep changes consistent with existing style and abstractions.
- Return a concise summary of what changed and any follow-up risks.
```

## Authoring Notes

- Replace placeholders with repo-specific facts.
- Group requirements by subsystem rather than by file unless file-level precision is necessary.
- Name concrete interfaces, commands, routes, tables, and tests when known.
- Keep the prompt short enough to execute, but detailed enough to avoid rediscovery.
- If the repo is missing, rewrite `Confirmed Context` as user-provided facts only.
