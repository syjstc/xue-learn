import {teachingTemplateReactionEquation, type TeachingTemplateContent} from "../../../../libs/domain/src/index.js";
import type {ReactionConfig} from "./templates/discipline-scenes.js";
import {THEME as T} from "./theme.js";

type ReactionContent = TeachingTemplateContent<'chemistry-reaction'>;

/** Positions belong to this drawing component. Chemistry retains the same
 * authored atom IDs and bonds while the renderer allocates bounded space. */
export function teachingTemplateReaction(content: ReactionContent): ReactionConfig {
  const layout = (molecules: ReactionContent['reactants']) => {
    const positions = new Map<string, [number, number]>();
    const labels: {label: string; x: number; y: number}[] = [];
    molecules.forEach((molecule, group) => {
      const x = 500 + (group - (molecules.length - 1) / 2) * Math.min(360, 840 / molecules.length);
      const count = molecule.atoms.length;
      labels.push({label: molecule.label, x, y: 158});
      molecule.atoms.forEach((atom, index) => {
        const angle = -Math.PI / 2 + index * Math.PI * 2 / count;
        const point: [number, number] = count === 1 ? [x, 252] : count === 2 ? [x + (index ? 36 : -36), 252] : [x + Math.cos(angle) * 62, 252 + Math.sin(angle) * 62];
        positions.set(atom.id, point);
      });
    });
    return {positions, labels};
  };
  const before = layout(content.reactants), after = layout(content.products);
  const source = content.reactants.flatMap(molecule => molecule.atoms);
  const elements = [...new Set(source.map(atom => atom.element))];
  const colors = [T.accent, T.caution, T.positive, T.compare];
  const atoms = source.map((atom, index) => {
    const start = before.positions.get(atom.id), end = after.positions.get(atom.id);
    if (!start || !end) throw new Error(`Reaction atom is missing from the conserved inventory: ${atom.id}`);
    return {...atom, color: colors[elements.indexOf(atom.element) % colors.length], start, end,
      loose: [130 + index % 6 * 148, 214 + Math.floor(index / 6) * 95] as [number, number], radius: atom.element.length > 1 ? 28 : 25};
  });
  const bonds = (molecules: ReactionContent['reactants']) => molecules.flatMap(molecule => molecule.bonds.map(bond => {
    const from = atoms.findIndex(atom => atom.id === bond.from), to = atoms.findIndex(atom => atom.id === bond.to);
    if (from < 0 || to < 0) throw new Error('Reaction bond references an unknown atom');
    return [from, to, bond.order] as [number, number, number];
  }));
  return {latex: teachingTemplateReactionEquation(content), atoms, before: bonds(content.reactants), after: bonds(content.products),
    counters: elements.map(element => `${element} × ${source.filter(atom => atom.element === element).length}`),
    reactantLabels: before.labels, productLabels: after.labels};
}
