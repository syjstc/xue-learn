import {createDisplayRegistry, type DisplayNode, type DisplayPlugin} from "./display-registry.js";

type Payload = {value: string};
const validate = (value: unknown): value is Payload => typeof value === "object" && value !== null && typeof (value as Payload).value === "string";
const plugin = (overrides: Partial<DisplayPlugin<Payload>> = {}): DisplayPlugin<Payload> => ({id: "example.card", kind: "example:card", versions: [1], validate, Component: () => null, ...overrides});
const node: DisplayNode = {id: "card-1", kind: "example:card", version: 1, payload: {value: "first"}};

describe("DisplayRegistry", () => {
  it("selects an exact kind and schema version, including kinds outside the course domain", () => {
    const registry = createDisplayRegistry();
    registry.register(plugin());
    expect(registry.resolve(node)).toMatchObject({status: "ready", pluginId: "example.card"});
    expect(registry.resolve({...node, version: 2})).toMatchObject({status: "fallback", failure: {reason: "unsupported"}});
    expect(registry.resolve({...node, kind: "host:live-simulation"})).toMatchObject({status: "fallback", failure: {reason: "unsupported"}});
    registry.register(plugin({id: "example.card.v2", versions: [2]}));
    expect(registry.resolve({...node, version: 2})).toMatchObject({status: "ready", pluginId: "example.card.v2"});
  });

  it("rejects duplicate ids and ambiguous kind/version routes without notifying listeners", () => {
    const registry = createDisplayRegistry();
    const changed = jest.fn();
    registry.subscribe(changed);
    registry.register(plugin());
    expect(() => registry.register(plugin({kind: "other:card"}))).toThrow("id already registered");
    expect(() => registry.register(plugin({id: "other.plugin", versions: [1, 2]}))).toThrow("kind/version already registered");
    expect(changed).toHaveBeenCalledTimes(1);
    expect(registry.getSnapshot()).toBe(1);
  });

  it.each([
    {id: ""}, {kind: " example:card"}, {versions: []}, {versions: [0]},
    {versions: [-1]}, {versions: [1.5]}, {versions: [1, 1]},
  ])("rejects invalid plugin metadata: %j", overrides => {
    expect(() => createDisplayRegistry().register(plugin(overrides))).toThrow();
  });

  it("copies the version list so external mutations cannot change routes", () => {
    const versions = [1];
    const registry = createDisplayRegistry();
    registry.register(plugin({versions}));
    versions.push(2);
    expect(registry.resolve({...node, version: 2})).toMatchObject({status: "fallback", failure: {reason: "unsupported"}});
  });

  it("does not render invalid data and contains validator exceptions", () => {
    const registry = createDisplayRegistry();
    registry.register(plugin());
    expect(registry.resolve({...node, payload: {value: 42}})).toMatchObject({status: "fallback", failure: {reason: "invalid-payload", pluginId: "example.card"}});
    const error = new Error("bad validation");
    registry.register(plugin({id: "example.throw", kind: "example:throw", validate: (_value: unknown): _value is Payload => {throw error;}}));
    expect(registry.resolve({...node, kind: "example:throw"})).toMatchObject({status: "fallback", failure: {reason: "validation-error", error}});
    expect(registry.resolve(node).status).toBe("ready");
  });

  it.each([{id: ""}, {kind: ""}, {version: 0}, {version: Number.NaN}])("rejects malformed envelopes before invoking plugin code: %j", overrides => {
    const registry = createDisplayRegistry();
    const validator = jest.fn(validate);
    registry.register(plugin({validate: (value: unknown): value is Payload => validator(value)}));
    expect(registry.resolve({...node, ...overrides})).toMatchObject({status: "fallback", failure: {reason: "invalid-node"}});
    expect(validator).not.toHaveBeenCalled();
  });

  it("disposes once, notifies subscribers, and does not remove a later replacement", () => {
    const registry = createDisplayRegistry();
    const listener = jest.fn();
    const unsubscribe = registry.subscribe(listener);
    const dispose = registry.register(plugin());
    const first = registry.resolve(node);
    dispose();
    dispose();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(registry.resolve(node)).toMatchObject({status: "fallback", failure: {reason: "unsupported"}});
    registry.register(plugin());
    const replacement = registry.resolve(node);
    if (first.status !== "ready" || replacement.status !== "ready") throw new Error("Expected registered renderers");
    expect(replacement.registration).not.toBe(first.registration);
    dispose();
    expect(registry.resolve(node).status).toBe("ready");
    unsubscribe();
    registry.register(plugin({id: "other", kind: "other:card"}));
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("isolates registrations between independent hosts", () => {
    const first = createDisplayRegistry();
    const second = createDisplayRegistry();
    first.register(plugin());
    expect(first.resolve(node).status).toBe("ready");
    expect(second.resolve(node).status).toBe("fallback");
    expect(second.getSnapshot()).toBe(0);
  });
});
