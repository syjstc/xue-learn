export type SocraticMessage = {
  role: "assistant" | "user";
  content: string;
  createdAt: string;
};

export type SocraticThreadSource = "quiz" | "feynman" | "general";

export type SocraticThread = {
  id: string;
  label: string;
  /** Full quiz stem for in-panel reference (quiz threads). */
  questionText?: string;
  mistakeHint?: string;
  quizQuestionIndex?: number;
  source: SocraticThreadSource;
  messages: SocraticMessage[];
  done: boolean;
  turn: number;
  updatedAt: string;
};

export function activeSocraticThread(
  threads: SocraticThread[] | undefined,
  activeId: string | undefined,
): SocraticThread | undefined {
  if (!threads?.length) return undefined;
  if (activeId) {
    const found = threads.find((t) => t.id === activeId);
    if (found) return found;
  }
  return threads.find((t) => !t.done) ?? threads[0];
}

export function socraticThreadPreview(thread: SocraticThread): string {
  const last = thread.messages[thread.messages.length - 1];
  if (!last) return "（待开始）";
  const text = last.content.replace(/\s+/g, " ").trim();
  return text.length > 72 ? `${text.slice(0, 72)}…` : text;
}
