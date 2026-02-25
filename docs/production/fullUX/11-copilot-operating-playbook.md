# Copilot Operating Playbook for Full UX Phase

## Objective
Provide deterministic execution rules for AI-assisted development during this refactor.

## Required Workflow Per Task
1. Identify target requirement in this folder.
2. Map required files before editing.
3. Implement the smallest vertical slice needed.
4. Run focused validation on touched files/features.
5. Record decisions/assumptions using decision-log template.

## Change Discipline
- Do not combine unrelated features in one PR.
- Prefer adapters over broad rewrites for in-flight migration.
- Preserve public contracts unless spec explicitly changes them.

## When Specs and Code Differ
- Treat docs in this folder as source-of-truth.
- Update spec + implementation in same PR when requirement changes.

## Required PR Notes (Template)
- Requirement source doc
- Scope and non-scope
- Cutover target surface
- Risk and mitigation
- Tests run and outcomes

## Guardrails
- Never remove replaced legacy paths until acceptance matrix passes.
- Never gate navigation on long-running async fetches.
- Never ship new UI mode without explicit empty/error states.
