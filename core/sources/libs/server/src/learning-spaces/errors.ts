export class LearningSpaceError extends Error {
  constructor(
    readonly code:
      | "not_found"
      | "duplicate_name"
      | "invalid_input"
      | "invalid_order"
      | "ownership"
      | "stale",
    message: string,
  ) {
    super(message);
  }
}
