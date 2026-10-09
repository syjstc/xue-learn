import { Badge } from "@/components/ui/badge";

export function DevTag() {
  return (
    <Badge
      variant="outline"
      className="border-amber-300/80 bg-amber-50 font-mono text-[10px] uppercase tracking-wider text-amber-800 dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-200"
    >
      Dev
    </Badge>
  );
}
