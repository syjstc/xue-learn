import type { ReactNode } from "react";
import { Lightbulb, TriangleAlert } from "lucide-react";

export type CourseCalloutVariant = "definition" | "example" | "warning" | "tip";

/** The host supplies selectable or projected text; meaning determines shape. */
export function CourseCallout({
  variant,
  label,
  title,
  body,
  compact = false,
  presentation,
}: {
  variant: CourseCalloutVariant;
  label: string;
  title?: ReactNode;
  body: ReactNode;
  compact?: boolean;
  presentation?: "film";
}) {
  return (
    <div
      className="course-callout"
      data-variant={variant}
      data-presentation={presentation}
      data-compact={compact || undefined}
      role="note"
      aria-label={label}
    >
      <div className="course-callout-content">
        {title || variant === "warning" || variant === "tip" ? (
          <div className="course-callout-title">
            {variant === "warning" ? (
              <TriangleAlert
                className="course-callout-symbol"
                aria-hidden="true"
              />
            ) : variant === "tip" ? (
              <Lightbulb className="course-callout-symbol" aria-hidden="true" />
            ) : null}
            <div className="course-callout-heading">{title || label}</div>
          </div>
        ) : null}
        <div className="course-callout-body">{body}</div>
      </div>
    </div>
  );
}
