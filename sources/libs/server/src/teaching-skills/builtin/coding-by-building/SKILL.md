---
name: Coding by Building
description: Plan and teach practical programming and software-development goals through runnable examples, prediction, modification, debugging, testing, and building. Use when the learner wants to write code or create software; do not use for purely theoretical computer-science study.
---

# Coding by Building

## Map design

- Sequence lessons around capabilities needed to build progressively more complete software.
- Introduce only the concepts needed for the next meaningful implementation step.
- Revisit concepts through modification, debugging, integration, and less-scaffolded construction.
- End milestones with a coherent feature or small project rather than a vocabulary review.

## Unit teaching

- Start from a concrete problem and a minimal runnable example.
- Explain the mental model by connecting code to observable execution behavior.
- Ask the learner to predict or trace behavior before revealing the result when useful.
- Follow each important new concept with code modification, debugging, or construction practice.
- Include a small feature the learner can build, not only code to read or copy.
- Teach architecture as decisions under forces: name the responsibility, boundary, dependency direction, state ownership, failure mode, and cost of change behind a design rather than presenting patterns as vocabulary.
- Expose programming reasoning through concrete artifacts: requirements, invariants, traces, logs, tests, data flow, API contracts, diffs, and counterexamples. Ask for a prediction or decision before explaining the reasoning.
- Compare credible alternatives and explain when each tradeoff changes; avoid implying that one fashionable pattern is universally correct.
- Present long or multi-line code in language-tagged fenced code blocks (big coding blocks); reserve inline backticks for short identifiers only — never dump functions, schemas, or multi-statement examples into a paragraph or one giant inline span.

## Scenario theater

- Put the learner inside a realistic engineering incident or delivery decision: reproduce a bug, trace state or data flow, review a risky change, choose a boundary, plan a migration, respond to a failing test, or make a constrained architecture tradeoff.
- Ground every decision in concrete technical evidence visible in the story—small code excerpts, logs, stack traces, tests, schemas, diffs, metrics, dependency relationships, or requirements—not managerial dialogue alone.
- Make choices name an executable engineering action and its target, such as adding a focused test, instrumenting a boundary, isolating a dependency, changing a contract, rolling back a release, or validating a hypothesis. Do not use abstract labels like “debug carefully” or “use clean architecture.”
- Consequences must follow program behavior and system constraints: test output changes, a hypothesis is falsified, coupling appears, data is preserved or lost, latency shifts, a rollout becomes safer, or a new failure mode is exposed.
- Include both code-level and design-level thinking when relevant. Architecture choices must state the forces involved—ownership, consistency, reliability, security, operability, performance, and cost of change—rather than reward pattern-name recall.
- Preserve ambiguity when the evidence is incomplete. Let a reasonable choice reveal new information; do not turn every branch into an obvious correct-versus-reckless pair.
- Theater choices are bounded simulation, not proof that the learner can implement working code. Use the lesson's runnable coding, modification, testing, and construction practice for Application or Transfer evidence.

## Practice and evidence

- Recognition questions measure recall or understanding only.
- Application requires writing or modifying working code; transfer requires a meaningfully different problem.
- Prefer tests, expected behavior, and reproducible checks when the environment supports them.
- Treat running provided code or reading a solution as exposure, not mastery.
- Require the learner to explain important implementation choices in terms of behavior, invariants, failure modes, and tradeoffs, then verify those claims against code or tests.

## Adaptation

- Give beginners partial code and explicit steps, then remove scaffolding.
- Give experienced learners constraints, failing tests, design choices, and open-ended integration work.
