import type { CSSProperties } from "react";
import {
  classroomStageTargetId,
  type CourseDisplayBlock,
  type MaterialStageLayoutPlan,
} from "../../../libs/domain/src/index.js";
import { courseTextBoard } from "../../shared/domain/course-text-board.js";
import { ProseMarkdown } from "../markdown/prose-markdown.js";
import { CourseCallout } from "./course-callout.js";

type TextBoard = NonNullable<ReturnType<typeof courseTextBoard>>;

export function CourseTextBoard({
  board,
  figures,
  plan,
  labels,
}: {
  board: TextBoard;
  figures: readonly CourseDisplayBlock[];
  plan: MaterialStageLayoutPlan;
  labels: Readonly<Record<string, string>>;
}) {
  const targetProps = (index: number) => ({
    "data-stage-index": index,
    "data-focused": plan.items[index]?.focused ? "true" : undefined,
    "data-lp-target": classroomStageTargetId(plan.layout, index),
    "data-lp-lit": plan.items[index]?.focused ? "true" : undefined,
    style: {
      "--text-board-emphasis": (plan.items[index]?.emphasis ?? 0) * plan.focus,
    } as CSSProperties,
  });
  const copy = (content: unknown) => (
    <ProseMarkdown
      content={String(content ?? "")}
      variant="board"
      className="course-text-board-copy"
    />
  );
  return (
    <div
      className="course-text-board"
      data-presentation={board.rows ? "matrix" : "columns"}
    >
      {board.rows ? (
        <table className="course-text-board-table">
          <thead>
            <tr>
              <td aria-hidden="true" />
              {board.columns.map((index) => (
                <th scope="col" key={index} {...targetProps(index)}>
                  {copy(figures[index]!.title)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {board.rows.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                {row.cells.map((text, column) => {
                  const index = board.columns[column]!;
                  return (
                    <td key={index} {...targetProps(index)}>
                      <span
                        className="course-text-board-mobile-label"
                        aria-hidden="true"
                      >
                        {copy(figures[index]!.title)}
                      </span>
                      {copy(text)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div
          className="course-text-board-columns"
          style={
            { "--text-board-columns": board.columns.length } as CSSProperties
          }
        >
          {board.columns.map((index) => (
            <section key={index} {...targetProps(index)}>
              <h3>{copy(figures[index]!.title)}</h3>
              <div className="course-text-board-prose">
                {copy(figures[index]!.body)}
              </div>
            </section>
          ))}
        </div>
      )}
      {board.notes.map((index) => {
        const figure = figures[index]!;
        const variant = figure.variant === "warning" ? "warning" : "tip";
        return (
          <div
            key={index}
            className="course-text-board-note"
            {...targetProps(index)}
          >
            <CourseCallout
              variant={variant}
              label={labels[variant] ?? ""}
              title={figure.title ? copy(figure.title) : undefined}
              body={copy(figure.body)}
            />
          </div>
        );
      })}
    </div>
  );
}
