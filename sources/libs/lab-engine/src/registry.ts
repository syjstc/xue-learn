export type LabComponentContext = {
  componentId: string;
  version: 1;
};

export type LabComponentDefinition<TProps = unknown, TNode = unknown> = {
  type: string;
  maxInstances?: number;
  validate: (props: TProps) => readonly string[];
  normalize?: (props: TProps) => TProps;
  create?: (props: TProps, context: LabComponentContext) => TNode;
};

export class LabComponentRegistry<TNode = unknown> {
  private definitions = new Map<
    string,
    LabComponentDefinition<unknown, TNode>
  >();

  register<TProps>(definition: LabComponentDefinition<TProps, TNode>) {
    if (!definition.type.trim()) throw new Error("Component type is required");
    if (this.definitions.has(definition.type)) {
      throw new Error(`Component already registered: ${definition.type}`);
    }
    this.definitions.set(
      definition.type,
      definition as LabComponentDefinition<unknown, TNode>,
    );
    return this;
  }

  get(type: string) {
    return this.definitions.get(type);
  }

  has(type: string) {
    return this.definitions.has(type);
  }

  validate(type: string, props: unknown) {
    const definition = this.get(type);
    if (!definition) return [`Unknown Lab component: ${type}`];
    return definition.validate(props);
  }

  list() {
    return [...this.definitions.keys()];
  }
}
