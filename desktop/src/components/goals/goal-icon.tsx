import { BookOpen } from "lucide-react";
import { cn } from "@xue-learn/core/utils";

type GoalIconProps = {
  title: string;
  iconSvg?: string | null;
  iconTint?: string | null;
  className?: string;
};

const FALLBACK_TINTS = [
  "#EEF0FF",
  "#E8F0FF",
  "#E8F7EF",
  "#FFF3D7",
  "#F4EAFE",
  "#FFE8EE",
];

function fallbackTint(title: string): string {
  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = (hash * 31 + title.charCodeAt(i)) >>> 0;
  }
  return FALLBACK_TINTS[hash % FALLBACK_TINTS.length];
}

export function GoalIcon({
  title,
  iconSvg,
  iconTint,
  className,
}: GoalIconProps) {
  const tint = iconTint || fallbackTint(title);

  return (
    <div
      className={cn(
        "flex size-14 shrink-0 items-center justify-center rounded-2xl border border-border/60 text-primary shadow-sm",
        "[&>span]:size-[57%] [&>svg]:size-[50%]",
        className,
      )}
      style={{ backgroundColor: tint }}
      aria-hidden
    >
      {iconSvg ? (
        <span
          className="flex items-center justify-center [&_svg]:size-full"
          dangerouslySetInnerHTML={{ __html: iconSvg }}
        />
      ) : (
        <BookOpen className="opacity-80" strokeWidth={1.75} />
      )}
    </div>
  );
}
