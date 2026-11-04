import {useEffect, useRef, useState} from 'react';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {useT} from '@xue-learn/core/i18n';
import {Button} from '@xue-learn/core/ui/button';
import {Textarea} from '../../../desktop/src/components/ui/textarea';
import {GoalTopicPromptDialog, type GoalTopicPromptSubmit} from '../../../desktop/src/components/agent/goal-topic-prompt-dialog';
import {CreationProgress} from '../../../desktop/src/components/agent/goal-creation-progress';
import {GoalInteraction} from './goal-interaction';
import {goalCreationShortStatus, type GoalCreationSessionResponse} from '../../../desktop/src/shared/agent/goal-creation-session';
import {uploadGoalCreationDocuments, uploadGoalCreationUrls, analyzeGoalCreationDocuments} from '../../../desktop/src/shared/agent/goal-documents';
import {consumeSsePost} from '../../../desktop/src/shared/client/consume-sse';
import {apiGet, apiPost, apiRequest} from './api';

type ResumeInput = {toolCallId: string; result: unknown; files?: File[]};
const queryKey = ['dsh-goal-creation'] as const;

export function GoalCreation({onClose, onCreated}: {onClose: () => void; onCreated: (goalId: string) => void}) {
  const t = useT();
  const query = useQueryClient();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [progressText, setProgressText] = useState('');
  const opened = useRef<string | null>(null);
  const active = useQuery<GoalCreationSessionResponse>({
    queryKey: [...queryKey, 'active'],
    queryFn: () => apiGet('/api/agent/goal-creation-sessions/active'),
    refetchInterval: item => item.state.data?.session && item.state.data.session.status !== 'completed' ? 2000 : false,
  });
  useEffect(() => {
    if (!sessionId && active.data?.session?.id) setSessionId(active.data.session.id);
  }, [active.data?.session?.id, sessionId]);
  const snapshot = useQuery<GoalCreationSessionResponse>({
    queryKey: [...queryKey, sessionId], enabled: Boolean(sessionId),
    queryFn: () => apiGet(`/api/agent/goal-creation-sessions/${encodeURIComponent(sessionId!)}`),
    refetchInterval: item => item.state.data?.session?.status === 'completed' ? false : 2000,
  });
  const session = snapshot.data?.session ?? active.data?.session ?? null;
  useEffect(() => {
    if (!session?.goalId || session.status !== 'completed' || opened.current === session.id) return;
    opened.current = session.id;
    onCreated(session.goalId);
  }, [session?.id, session?.goalId, session?.status, onCreated]);
  const refresh = async () => {
    await Promise.all([
      query.invalidateQueries({queryKey}),
      query.invalidateQueries({queryKey: ['dsh-goals']}),
    ]);
  };
  const start = useMutation({mutationFn: async (input: GoalTopicPromptSubmit) => {
    const topic = input.topic.trim();
    if (!topic && !input.files.length && !input.urls.length) throw Error('请先描述学习目标，或加入一份学习资料。');
    setProgressText('正在建立学习空间…');
    const created = await apiPost<GoalCreationSessionResponse>('/api/agent/goal-creation-sessions', {});
    if (!created.session) throw Error('目标创建会话没有启动。');
    const current = created.session;
    setSessionId(current.id);
    if (input.files.length) {
      setProgressText('正在读取上传的学习资料…');
      await uploadGoalCreationDocuments(current.threadId, input.files, current.id);
    }
    if (input.urls.length) {
      setProgressText('正在读取资料链接…');
      const extracted = await uploadGoalCreationUrls(current.threadId, input.urls, current.id);
      if (!input.files.length && !extracted.results.some(item => item.status === 'success')) {
        throw Error(extracted.results.map(item => item.error).filter(Boolean).join('；') || '无法读取资料链接，请检查后重试。');
      }
    }
    let documentSeed;
    if (input.files.length || input.urls.length) {
      setProgressText('正在梳理资料重点…');
      documentSeed = await analyzeGoalCreationDocuments(current.threadId, current.id);
    }
    const seed = topic || documentSeed?.refinedTitle?.trim() || documentSeed?.topic.trim() || '';
    const text = topic || t('desktop.i18n.learnFromMaterials', {topic: seed, files: documentSeed?.filenames.join(', ') ?? ''});
    setProgressText('正在理解你的学习目标…');
    await consumeSsePost(`/api/agent/goal-creation-sessions/${encodeURIComponent(current.id)}/message`, {
      message: text, clientAction: 'start_goal_creation', seedTopic: seed,
      ...(documentSeed ? {documentSeed} : {}), ...(input.isSmallCourse ? {isSmallCourse: true} : {}),
    }, () => {});
  }, onSettled: () => {setProgressText(''); void refresh();}});
  const resume = useMutation({mutationFn: async ({toolCallId, result, files}: ResumeInput) => {
    if (!session) throw Error('目标创建会话已失效。');
    if (files?.length) {
      setProgressText('正在读取上传的学习资料…');
      await uploadGoalCreationDocuments(session.threadId, files, session.id);
    }
    setProgressText('正在继续准备学习目标…');
    await consumeSsePost(`/api/agent/goal-creation-sessions/${encodeURIComponent(session.id)}/resume-interaction`,
      {toolCallId, result}, () => {});
  }, onSettled: () => {setProgressText(''); void refresh();}});
  const send = useMutation({mutationFn: async () => {
    if (!session || !message.trim()) return;
    const text = message.trim();
    setMessage('');
    await consumeSsePost(`/api/agent/goal-creation-sessions/${encodeURIComponent(session.id)}/message`, {message: text}, () => {});
  }, onSettled: () => {void refresh();}});
  const retry = useMutation({mutationFn: async () => {
    if (session) await apiPost(`/api/agent/goal-creation-sessions/${encodeURIComponent(session.id)}/retry`, {});
  }, onSettled: () => {void refresh();}});
  const remove = useMutation({mutationFn: async () => {
    if (!session) return;
    await apiRequest(`/api/agent/goal-creation-sessions/${encodeURIComponent(session.id)}`, {method: 'DELETE', body: JSON.stringify({confirm: 'DELETE'})});
    setSessionId(null);
  }, onSettled: () => {void refresh();}});
  const busy = start.isPending || resume.isPending || send.isPending || retry.isPending || remove.isPending;
  const error = start.error || resume.error || send.error || retry.error || remove.error || snapshot.error || active.error;
  return <section className="xl-creation" aria-label={t('goalCreation.title')}>
    <div className="xl-creation-top">
      <div><span className="xl-eyebrow">好会学 · 学习目标</span><h2>{t('goalCreation.title')}</h2></div>
      <Button type="button" variant="outline" onClick={onClose}>{t('common.close')}</Button>
    </div>
    {!session ? <>
      <div className="xl-creation-intro"><h3>{t('assistant.goalPrompt.goalTitle')}</h3><p>{t('assistant.goalPrompt.goalDescription')}</p></div>
      {!active.isPending && <GoalTopicPromptDialog open initialTopic="" onClose={onClose} onSubmit={input => start.mutate(input)}
        loading={start.isPending} loadingStatus={progressText || (start.error instanceof Error ? start.error.message : '')}
        portalClassName="xuelearn-dsh-portal" allowInstantMicroCourse={false} />}
    </> : <div className="xl-creation-session">
      <header className="xl-creation-session-head">
        <div><h3>{goalCreationShortStatus(session, t)}</h3><p>{session.status === 'waiting_user' ? '请完成下面这一步，学习计划会继续准备。' : progressText || '会学会保存当前进度，稍后可以接着完成。'}</p></div>
        {session.status === 'stopped' && <Button type="button" variant="outline" disabled={busy} onClick={() => remove.mutate()}>删除草稿并重来</Button>}
      </header>
      <CreationProgress session={session} />
      <div className="xl-creation-body">
        {session.pendingInteraction ? <GoalInteraction key={session.pendingInteraction.toolCallId} interaction={session.pendingInteraction}
          disabled={busy} onSubmit={(result, files) => resume.mutate({toolCallId: session.pendingInteraction!.toolCallId, result, files})} />
          : session.status === 'needs_attention' ? <div className="xl-creation-alert"><p>{session.lastError || t('goalCreation.needsAttentionGuidance')}</p>{session.actions.canRetry && <Button type="button" disabled={busy} onClick={() => retry.mutate()}>{t('goalCreation.retry')}</Button>}</div>
          : session.status === 'completed' ? <p className="text-sm text-muted-foreground">{t('goalCreation.firstLessonReady')}</p>
          : session.status === 'stopped' ? <p className="text-sm text-muted-foreground">{t('goalCreation.stoppedCannotContinue')}</p>
          : <p className="xl-creation-wait"><span className="xl-spinner" aria-hidden />{progressText || goalCreationShortStatus(session, t)}</p>}
        {session.status === 'waiting_user' && !session.pendingInteraction && <form className="xl-creation-reply" onSubmit={event => {event.preventDefault(); send.mutate();}}>
          <label htmlFor="xl-creation-message">补充说明</label><Textarea id="xl-creation-message" value={message} onChange={event => setMessage(event.target.value)} placeholder="补充你希望学习的重点或范围" />
          <Button type="submit" disabled={!message.trim() || busy}>发送说明</Button>
        </form>}
        {session.progress?.moduleCount ? <p className="xl-creation-note">已准备 {session.progress.readyModuleCount} / {session.progress.moduleCount} 个模块，{session.progress.readyUnitCount} / {session.progress.unitCount} 节课程。</p> : null}
      </div>
    </div>}
    {error && <p className="xl-error" role="alert">{error instanceof Error ? error.message : String(error)}</p>}
  </section>;
}
