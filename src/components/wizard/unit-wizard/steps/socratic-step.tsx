"use client";

import { SocraticChatPanel } from "../../socratic-chat-panel.tsx";
import type { UnitWizardModel } from "../use-unit-wizard.tsx";

type Props = Pick<
  UnitWizardModel,
  | "socraticThreads"
  | "activeSocraticThreadId"
  | "questions"
  | "sessionBusy"
  | "socraticStreamText"
  | "socraticTurn"
  | "selectSocraticThread"
  | "finishSocratic"
  | "finishDrills"
  | "isLearningDone"
> & { reviewMode?: boolean; conversationMode?: boolean };

export function SocraticStep({
  socraticThreads,
  activeSocraticThreadId,
  questions,
  sessionBusy,
  socraticStreamText,
  socraticTurn,
  selectSocraticThread,
  finishSocratic,
  finishDrills,
  isLearningDone,
  reviewMode = false,
  conversationMode = false,
}: Props) {
  const correctionComplete =
    socraticThreads.length > 0 &&
    socraticThreads.every((thread) => thread.done);

  return (
    <div className="space-y-4">
      {conversationMode ? null : (
        <p className="text-sm text-[var(--text-400)]">
          通过错题列表选择测验错题，每题一条对话。选中后开始引导式修正，帮你自己发现误区。
        </p>
      )}
      <SocraticChatPanel
        conversationMode={conversationMode}
        threads={socraticThreads}
        activeThreadId={activeSocraticThreadId}
        questionReference={(() => {
          const thread = socraticThreads.find(
            (t) => t.id === activeSocraticThreadId,
          );
          if (!thread || thread.quizQuestionIndex == null) return null;
          return questions[thread.quizQuestionIndex]?.question ?? null;
        })()}
        initializing={sessionBusy && socraticThreads.length === 0}
        bootstrapping={
          sessionBusy &&
          socraticThreads.length > 0 &&
          !socraticThreads.find((t) => t.id === activeSocraticThreadId)
            ?.messages.length &&
          !socraticStreamText
        }
        sending={sessionBusy}
        streamingAssistantText={socraticStreamText}
        onSend={(answer) => void socraticTurn(answer)}
        onSelectThread={(threadId) => void selectSocraticThread(threadId)}
        onFinish={() =>
          void (
            correctionComplete
              ? reviewMode
                ? finishDrills()
                : finishSocratic()
              : finishDrills()
          )
        }
        finishLabel={
          reviewMode
            ? correctionComplete
              ? "完成修正"
              : "完成所有错题后继续"
            : isLearningDone
              ? "返回完成页"
              : "完成练习"
        }
        canFinish={!reviewMode || correctionComplete}
      />
    </div>
  );
}
