import React from "react";
import { InlineMathText, hasInlineMath } from "./inline-math-text.js";
import { FixedMathText } from "./fixed-math-text.js";

/** Keep ordinary SVG text identical; typeset authored formulas in a fixed HTML
 * lane at the same anchor. Callers can supply narrower diagram clearances. */
export function SvgMathText({
  children,
  mathWidth = 300,
  mathHeight,
  ...props
}: React.SVGProps<SVGTextElement> & {
  mathWidth?: number;
  mathHeight?: number;
}) {
  const pieces = React.Children.toArray(children);
  const text = pieces.every(
    (part) => typeof part === "string" || typeof part === "number",
  )
    ? pieces.join("")
    : "";
  if (!hasInlineMath(text)) return <text {...props}>{children}</text>;
  const {
    x = 0,
    y = 0,
    fontSize = 22,
    textAnchor = "start",
    fill = "currentColor",
    fontWeight,
    style,
    ...rest
  } = props;
  const size = Number(fontSize),
    height = mathHeight ?? size * 2.8;
  const align =
    textAnchor === "middle" ? "center" : textAnchor === "end" ? "end" : "start";
  return (
    <g {...rest}>
      <foreignObject
        x={
          Number(x) -
          (align === "center" ? mathWidth / 2 : align === "end" ? mathWidth : 0)
        }
        y={Number(y) - size * 0.3 - height / 2}
        width={mathWidth}
        height={height}
        data-svg-math-text="true"
      >
        <FixedMathText
          enabled
          contentKey={JSON.stringify([
            text,
            mathWidth,
            height,
            size,
            fontWeight,
          ])}
          style={{
            ...style,
            fontSize: size,
            fontWeight,
            color: fill,
            textAlign: align,
            lineHeight: 1.25,
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
          }}
        >
          <InlineMathText text={text} />
        </FixedMathText>
      </foreignObject>
    </g>
  );
}
