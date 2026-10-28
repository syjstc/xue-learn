export function mainlineTeachingIntent(options: string | undefined) {
  const contract =
    (options ?? "")
      .split("[User-confirmed goal contract — authoritative]")[1]
      ?.split(/\n\s*\n/)[0] ?? "";
  const field = (name: string) =>
    contract
      .split("\n")
      .find((line) => line.startsWith(name + ":"))
      ?.slice(name.length + 1)
      .trim();
  return {
    startingLevel: field("Starting level"),
    targetLevel: field("Target level (destination, not starting level)"),
    outcomes:
      field("Observable exit outcomes")
        ?.split(";")
        .map((v) => v.trim())
        .filter(Boolean) ?? [],
  };
}
