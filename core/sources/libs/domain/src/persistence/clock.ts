/**
 * Time is an infrastructure concern, but application workflows need one
 * injectable source of truth so hosted and local runtimes make the same
 * decisions when leases, freshness, or scheduling are evaluated.
 *
 * Values are Unix epoch milliseconds. Keeping the port numeric matches the
 * persistence contracts already used by local repositories while avoiding a
 * database or framework date type in the domain layer.
 */
export interface ClockPort {
  now(): number;
}
