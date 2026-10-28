/** One process owns admission for its concrete workspace. */
export class WorkspaceServiceLifecycle {
  private accepting = true;
  private requests = 0;
  enter(): (() => void) | null {
    if (!this.accepting) return null;
    this.requests += 1;
    let released = false;
    return () => { if (!released) { released = true; this.requests -= 1; } };
  }
  get activeRequests() { return this.requests; }
  get draining() { return !this.accepting; }
  /** Call while the owner's exclusive DB transaction holds the task-count fence. */
  commitDrain(input: {clientSessions:number; backgroundTasks:number}): boolean {
    if (this.requests || input.clientSessions || input.backgroundTasks) return false;
    this.accepting = false;
    return true;
  }
  resume() { this.accepting = true; }
}
