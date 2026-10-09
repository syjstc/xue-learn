# Coding scenario-theater patterns

Prefer one of these dramatic engines:

1. **Debugging investigation:** begin with a symptom and partial evidence. Choices select the next hypothesis, observation point, focused test, or smallest safe experiment. Each consequence reveals evidence rather than announcing correctness.
2. **Code review under constraints:** show a small diff, contract, or test failure. Choices address a concrete risk such as state ownership, error handling, concurrency, security, compatibility, or maintainability.
3. **Architecture tradeoff:** give workload, consistency, ownership, deployment, and operational constraints. Choices change a boundary or dependency and expose both benefit and cost. Pattern names alone are never sufficient reasoning.
4. **Production incident or migration:** balance diagnosis, containment, recovery, data safety, communication, and follow-up. Reward reversible actions and explicit validation without making caution automatically correct in every branch.

Keep technical artifacts small enough to understand in the scene and consistent across beats. A log line, test, schema fragment, trace, or short code excerpt should support an inference the learner can make. Do not fabricate a tool run without showing its result, and do not claim that choosing an option is equivalent to writing or running code.

For architectural thinking, connect every option to at least two forces such as responsibility ownership, dependency direction, consistency, failure isolation, security, operability, performance, or cost of change. Consequences should surface the tradeoff rather than crown a universal best practice.
