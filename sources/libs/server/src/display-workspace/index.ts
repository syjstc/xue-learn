import {join} from "node:path";
import {DisplayPluginStore} from "../display-plugins/index.js";
import {createDisplayBuildRuntime, configureDisplayBuildRuntime, configureDisplayPluginCatalog, mathDerivationBuilder, resolveDisplayBuilds, type DisplayBuilder} from "../display-build/index.js";
import {validateDisplayDocument} from "../../../display/src/validation.js";
import type {DisplayDocument} from "../../../display/src/types.js";
import {builtinDisplayManifests} from "../../../../src/components/display-plugins/catalog.js";

/** Hosts own the directory, lifecycle and authenticated owner. Both applications
 * expose the same small plugin/build API and use the same authoring catalog. */
export class DisplayWorkspaceService {
  readonly plugins: DisplayPluginStore;
  readonly builds;
  constructor(options: {directory: string; ownerUserId: string; builders?: readonly DisplayBuilder[]}) {
    this.plugins = new DisplayPluginStore(join(options.directory, "display-plugins"), builtinDisplayManifests);
    this.builds = createDisplayBuildRuntime({directory: join(options.directory, "display-builds"), builders: options.builders ?? [mathDerivationBuilder]});
  }
  async start() {
    configureDisplayPluginCatalog(() => this.plugins.manifests({forGeneration: true}));
    configureDisplayBuildRuntime(this.builds);
    await this.builds.start();
  }
  async stop() {await this.builds.stop();}
  /** Nest calls these on the same instance; Video calls start/stop explicitly. */
  onApplicationBootstrap() {return this.start();}
  onModuleDestroy() {return this.stop();}
  async backgroundTaskCount() {
    return (await this.builds.repository.list()).filter(run => run.status === "pending" || run.status === "running").length;
  }
  async resolveDocument(ownerUserId: string, value: unknown): Promise<DisplayDocument> {
    const errors = validateDisplayDocument(value as DisplayDocument);
    if (errors.some(error => !error.nodeId)) throw Error(errors.map(error => error.message).join("; "));
    return resolveDisplayBuilds(value as DisplayDocument, ownerUserId);
  }
  async getJob(ownerUserId: string, jobId: string) {
    const run = await this.builds.getOwned(jobId, ownerUserId);
    if (!run) return null;
    return {id: run.id, status: run.status, sourceHash: run.sourceHash, inputRevision: run.inputRevision,
      revision: run.revision, artifact: run.artifact, error: run.error};
  }
}
