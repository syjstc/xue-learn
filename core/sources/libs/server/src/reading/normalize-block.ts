/** Accept unambiguous text aliases without inventing content or component kinds.
 * This runs on complete streamed items, before validation and positional repair. */
export function normalizeReadingBlock(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const block = value as Record<string, unknown>;
  const type = block.type === "prose" ? "paragraph" : block.type;
  const field = type === "paragraph" || type === "heading" ? "text"
    : type === "callout" || type === "accordion" ? "body" : undefined;
  if (!field || block[field] !== undefined || typeof block.content !== "string")
    return type === block.type ? value : {...block, type};
  const {content, ...rest} = block;
  return {...rest, type, [field]: content};
}
