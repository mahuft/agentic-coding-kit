# Clarification Question Catalog

Use these patterns when the dry-run reveals decisions that materially change implementation.
Prefer multiple-choice questions with a recommended option first.

## Scope Boundary

Use when the request is unclear about how much surface area to change.

```text
To make the implementation precise, which scope should I target?
1. Patch the existing flow only (Recommended) — keep the current entrypoints and change the minimum necessary code.
2. Refactor the surrounding module — allow medium internal restructuring while keeping the same external behavior.
3. Introduce a new flow/module — add a separate path instead of changing the current one.
```

## Public Interface Choice

Use when the task could change an API, CLI, component props, schema, or storage contract.

```text
Which interface direction should I lock in?
1. Preserve the existing public interface (Recommended) — fit the change behind current routes, props, or commands.
2. Extend the existing interface — add fields/options while keeping backward compatibility.
3. Redesign the interface — allow breaking changes and update callers accordingly.
```

## Data Ownership

Use when it is unclear where new state or logic should live.

```text
Where should the new source of truth live?
1. Reuse the existing owning module/store/table (Recommended) — minimize new state surfaces.
2. Add a dedicated module/store/table — isolate the new behavior behind a new owner.
3. Keep it transient only — compute at runtime and do not persist it.
```

## Compatibility / Migration

Use when persistence, API contracts, or user-visible behavior may change.

```text
What compatibility boundary should I honor?
1. Full backward compatibility (Recommended) — no breaking changes to existing callers or stored data.
2. Soft migration — allow additive changes plus a migration path.
3. Breaking redesign — optimize the target design and update all affected consumers.
```

## Validation Depth

Use when there are multiple realistic ways to verify the work.

```text
How deep should validation go?
1. Targeted checks only (Recommended) — run the narrowest relevant tests or commands.
2. Targeted + adjacent coverage — include nearby integration paths that could regress.
3. Broad package-level validation — run the package’s wider verification suite.
```

## Contradiction Resolution

Use when the request contains mutually incompatible requirements.

```text
I found a conflict that changes the implementation approach:
- <constraint A>
- <constraint B>

Which one should take priority?
1. Prioritize A (Recommended) — <impact summary>
2. Prioritize B — <impact summary>
3. Hybrid compromise — <impact summary>
```

## Open Question Fallback

Use an open question only when realistic choices would be fake precision.

```text
I can proceed, but one missing detail still changes the implementation plan:
<single concrete question>
```

## Selection Rules

- Ask about behavior and boundaries before naming or style.
- Ask the smallest question that unlocks the plan.
- Base options on repo facts you already found.
- Include impact in each option so the user can choose quickly.
- If a question does not change code shape, keep it out of the clarification round.
