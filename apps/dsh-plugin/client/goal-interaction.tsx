import {useState} from 'react';
import {useT} from '@xue-learn/core/i18n';
import {Button} from '@xue-learn/core/ui/button';
import {Textarea} from '../../../desktop/src/components/ui/textarea';
import {DiscoveryQuestionsCard} from '../../../desktop/src/components/agent/discovery-questions-card';
import {CollectFormCard} from '../../../desktop/src/components/agent/collect-form-card';
import {ConfirmationCard} from '../../../desktop/src/components/agent/confirmation-card';
import {PlanEditorCard} from '../../../desktop/src/components/agent/plan-editor-card';
import {GoalScopeRoadmapPreviewCard} from '../../../desktop/src/components/agent/goal-scope-roadmap-preview-card';
import type {GoalMapPlan} from '../../../desktop/src/shared/api';

type Interaction = {toolCallId: string; toolName: string; uiKind: string; args: Record<string, unknown>};
type FormField = 'level' | 'contentLanguage' | 'generationOptions' | 'isSmallCourse' | 'documents';
type Question = {id: string; text: string; hint?: string; answerKind: 'text' | 'single_choice' | 'multi_choice'; choices?: string[]};

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
function choicesOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(item => {
    if (typeof item === 'string') return item.trim();
    const itemRecord = record(item);
    return String(itemRecord.label ?? itemRecord.text ?? itemRecord.value ?? itemRecord.title ?? '').trim();
  }).filter(Boolean);
}
function questionsOf(args: Record<string, unknown>): Question[] {
  const raw = Array.isArray(args.questions) ? args.questions : args.question ? [{id: 'clarification', text: args.question, choices: args.choices}] : [];
  return raw.map((value, index) => {
    const question = record(value);
    const choices = choicesOf(question.choices);
    const text = String(question.text ?? question.question ?? question.title ?? '').trim();
    if (!text) return null;
    return {
      id: typeof question.id === 'string' && question.id.trim() ? question.id.trim() : `question_${index + 1}`,
      text,
      hint: typeof question.hint === 'string' ? question.hint : undefined,
      answerKind: question.answerKind === 'multi_choice' ? 'multi_choice' as const : question.answerKind === 'text' && !choices.length ? 'text' as const : 'single_choice' as const,
      choices: choices.length ? choices : undefined,
    };
  }).filter((item): item is Question => Boolean(item));
}

/** Render the same learner-facing cards that the XueLearn Desktop flow uses. */
export function GoalInteraction({interaction, disabled, onSubmit}: {
  interaction: Interaction;
  disabled: boolean;
  onSubmit: (result: unknown, files?: File[]) => void;
}) {
  const t = useT();
  const {uiKind, args, toolName} = interaction;
  const [reply, setReply] = useState('');
  if (uiKind === 'discovery_questions') {
    const questions = questionsOf(args);
    return <DiscoveryQuestionsCard questions={questions} disabled={disabled}
      onSkip={toolName === 'ask_discovery_questions' ? () => onSubmit({answers: [], skipped: true}) : undefined}
      onSubmit={answers => onSubmit({answers: answers.map(entry => ({...entry, question: questions.find(question => question.id === entry.questionId)?.text}))})} />;
  }
  if (uiKind === 'form') {
    const fields = Array.isArray(args.fields) ? args.fields.filter((field): field is FormField =>
      ['level', 'contentLanguage', 'generationOptions', 'isSmallCourse', 'documents'].includes(String(field))) : [];
    return <CollectFormCard fields={fields} defaults={record(args.defaults)} labels={record(args.labels) as Record<string, string>}
      disabled={disabled} onSubmit={(values, files) => onSubmit(values, files)} />;
  }
  if (uiKind === 'confirmation_card') return <ConfirmationCard state={Object.keys(record(args.state)).length ? record(args.state) : args}
    contract={record(args.contract)} disabled={disabled} onSubmit={onSubmit} />;
  if (uiKind === 'plan_editor') return <PlanEditorCard plan={(args.plan as GoalMapPlan | null) ?? null}
    isMicroCourse={args.isMicroCourse === true} disabled={disabled} onSubmit={onSubmit} />;
  if (uiKind === 'goal_scope_roadmap_preview') return <GoalScopeRoadmapPreviewCard args={args} disabled={disabled} onSubmit={onSubmit} />;
  return <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
    <p className="text-sm font-semibold text-foreground">{String(args.question ?? t('desktop.ui.toolUiRenderer.pleaseAddMoreDetail'))}</p>
    <Textarea value={reply} onChange={event => setReply(event.target.value)} disabled={disabled} />
    <Button type="button" disabled={disabled || !reply.trim()} onClick={() => onSubmit({answer: reply.trim(), userResponse: reply.trim()})}>{t('assistant.discovery.continue')}</Button>
  </div>;
}
