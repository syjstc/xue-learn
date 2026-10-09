# Mathematical visual representations

Use visuals more frequently in mathematics than in other domains because a representation can be part of the mathematical object, not merely an illustration. Still require a specific observation, prediction, construction, or comparison.

## Choose the representation

- Arithmetic and number sense: number lines, arrays, area models, ratios, and scale comparisons when they reveal magnitude or operation meaning.
- Algebra: coordinate plots for function behavior and intersections; parameterized scenes for transformations; tables when discrete input-output structure matters.
- Geometry and trigonometry: labeled points, segments, angles, loci, transformations, unit-circle relationships, and movable constructions when motion reveals an invariant.
- Calculus: paired views of quantity and rate, local secants approaching a tangent, accumulation, signed area, parameterized families, and 3D surfaces when spatial structure matters.
- Linear algebra: vectors, spans, bases, projections, linear transformations, and geometric interpretations of systems. Use a numeric matrix simulator only when the matrix entries or scalar result—not spatial action—are the lesson.
- Probability and statistics: charts for genuine supplied or computed data; mathematical scenes for density or distribution functions. Never invent observations to populate a chart.
- Discrete mathematics and proof: dependency or concept graphs when relationships are the object; diagrams, cases, and counterexamples when they expose structure. Do not force a coordinate plot.

## Author the teaching move

1. State what the learner should predict or inspect.
2. Show one focused representation with readable range, scale, labels, and units.
3. Ask the learner to identify a feature or manipulate one meaningful degree of freedom.
4. Connect the observed feature to the symbolic statement or proof obligation.
5. Change one condition and ask what remains invariant.

Use separate scenes for distinct relationships when combining them would obscure scale, axes, or comparison. Overlay objects only when their shared coordinate system is itself the teaching point. Prefer `math_scene` or `chart` when that specialized component can show the relationship. Use the base `svg_slot` teaching diagram for conceptual relationships, compact schematics, or short geometric derivations; do not draw a chart, plot, or lab as SVG.

## Verify before publication

- Check plotted expressions, domains, intercepts, extrema, asymptotes, discontinuities, orientation, and units against the authored explanation.
- Choose ranges that include all named features with visible margin and do not visually exaggerate a trend.
- Distinguish continuous functions from discrete observations and exact mathematical curves from empirical fits.
- State when a drawing is schematic or not to scale.
- Do not infer causation from a statistical chart or hide uncertainty behind a smooth curve.
