import {useEffect, useMemo, useRef, useState} from 'react';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import type {LearningMaterialContent} from '@xue-learn/core/schemas';
import type {DerivationDocumentV1} from '@xue-learn/core/formal-derivation';
import type {TeachingDerivationDocumentV1, TeachingDerivationDerivedV1} from '@xue-learn/core/teaching-derivation';
import {Button} from '@xue-learn/core/ui/button';
// The standalone DSH entry does not load Desktop main.tsx. The renderers need
// these Core layout/painting styles before the Desktop chat/theme overrides.
import '@xue-learn/core/display/runtime.css';
import '@xue-learn/core/display/plugins.css';
import '@xue-learn/core/display/workspace.css';
import {InteractiveMaterialBody} from '../../../desktop/src/components/wizard/interactive-material/interactive-material-body';
import {FormalDerivationSection} from '../../../desktop/src/components/wizard/unit-sections/formal-derivation-section';
import {TeachingDerivationPlayer} from '../../../desktop/src/features/teaching-derivation/teaching-derivation-player';
import {buildAssistantCourseFeed} from '../../../desktop/src/shared/domain/assistant-course-feed';
import {consumeSsePost, type SseEventHandler} from '../../../desktop/src/shared/client/consume-sse';
import {apiGet, apiPost} from './api';
import avatar from '../icon.png';
import './presentation.css';

type Section = {id: string; title: string; sectionKind: string; sourceSectionId?: string; generationStatus: string};
type SectionContent = {
  sectionId: string; contentRevision: number; material: LearningMaterialContent | null;
  derivation?: DerivationDocumentV1 | null;
  teachingDerivation?: TeachingDerivationDocumentV1 | null;
  teachingDerivationDerived?: TeachingDerivationDerivedV1 | null;
};
type Session = {materialPresentation?: {sectionCursors?: Record<string, {contentRevision: number; cursor: number}>} | null};

/** The existing Core Display authoring route and Desktop presentation renderer. */
export function Presentation({unitId, sectionId, onSectionChange, onContinue}: {
  unitId: string; sectionId?: string; onSectionChange: (sectionId: string) => void; onContinue?: () => void;
}) {
  const query = useQueryClient();
  const path = `/api/units/${encodeURIComponent(unitId)}`;
  const sections = useQuery<Section[]>({queryKey: ['dsh-sections', unitId], queryFn: () => apiGet(`${path}/sections`),
    refetchInterval: state => !state.state.data?.length ? 3000 : false});
  const requested = sections.data?.find(section => section.id === sectionId);
  const selected = sections.data?.find(section => section.id === (requested?.sourceSectionId ?? sectionId) && section.sectionKind === 'content')
    ?? sections.data?.find(section => section.sectionKind === 'content');
  const selectedId = selected?.id;
  useEffect(() => {if (selectedId && selectedId !== sectionId) onSectionChange(selectedId);}, [selectedId, sectionId, onSectionChange]);
  const [status, setStatus] = useState('');
  const content = useQuery<SectionContent>({queryKey: ['dsh-presentation', unitId, selectedId], enabled: Boolean(selectedId),
    queryFn: () => apiGet(`${path}/sections/${encodeURIComponent(selectedId!)}/content`),
    refetchInterval: status ? 5000 : false});
  const session = useQuery<Session>({queryKey: ['dsh-presentation-session', unitId], queryFn: () => apiGet(`${path}/session`)});
  const generation = useMutation({mutationFn: async () => {
    let target = selected;
    const progress: SseEventHandler = event => {
      if ('message' in event && typeof event.message === 'string') setStatus(event.message);
    };
    setStatus('正在准备章节安排…');
    // Reading may create a section outline before the structured survey exists.
    // Desktop initializes the survey before authoring Display in either case.
    await consumeSsePost(`${path}/session/stream`, {action: 'generate_sq', onlyIfMissing: true}, progress);
    const prepared = await apiGet<Section[]>(`${path}/sections`);
    query.setQueryData(['dsh-sections', unitId], prepared);
    target = prepared.find(section => section.id === target?.id && section.sectionKind === 'content')
      ?? prepared.find(section => section.sectionKind === 'content');
    if (!target) throw new Error('章节仍在准备中，请稍后重试。');
    onSectionChange(target.id);
    const saved = await apiGet<SectionContent>(`${path}/sections/${encodeURIComponent(target.id)}/content`);
    if (!saved.material && !saved.derivation && !saved.teachingDerivation) {
      setStatus('正在准备本节演示…');
      await consumeSsePost(`${path}/sections/${encodeURIComponent(target.id)}/generate/stream`, {}, progress);
    }
  }, onSuccess: async () => {
    setStatus('');
    await query.invalidateQueries({queryKey: ['dsh-presentation', unitId]});
    void query.invalidateQueries({queryKey: ['dsh-sections', unitId]});
    void query.invalidateQueries({queryKey: ['reading-course', unitId]});
  }, onError: () => setStatus('')});
  const ready = Boolean(content.data?.material || content.data?.derivation || content.data?.teachingDerivation);
  const savedCursor = selectedId ? session.data?.materialPresentation?.sectionCursors?.[selectedId] : undefined;
  return <section className="xl-presentation" aria-label="课程演示">
    <h3>{selected?.title ?? '课程演示'}</h3>
    {(sections.error || content.error || session.error || generation.error) && <p className="xl-error" role="alert">{sections.error?.message || content.error?.message || session.error?.message || generation.error?.message}</p>}
    {status && <p role="status">{status}</p>}
    {!ready && <><p>按步骤观看本节讲解，画面与当前讲解同步。演示内容和播放位置会保存在学习记录中。</p>
      <Button type="button" disabled={generation.isPending || sections.isPending || content.isFetching} onClick={() => generation.mutate()}>{generation.isPending ? '正在准备演示…' : '准备本节演示'}</Button></>}
    {ready && content.data && session.isSuccess && selectedId && <SavedPresentation key={`${selectedId}:${content.data.contentRevision}`} unitId={unitId} content={content.data}
      savedCursor={savedCursor?.contentRevision === content.data.contentRevision ? savedCursor.cursor : undefined} busy={generation.isPending} onContinue={generation.isPending ? undefined : onContinue} />}
  </section>;
}

function SavedPresentation({unitId, content, savedCursor, busy, onContinue}: {
  unitId: string; content: SectionContent; savedCursor?: number; busy: boolean; onContinue?: () => void;
}) {
  const query = useQueryClient();
  const saves = useRef(Promise.resolve());
  const [error, setError] = useState('');
  const persist = (cursor: number) => {
    saves.current = saves.current.catch(() => {}).then(async () => {
      await apiPost(`/api/units/${encodeURIComponent(unitId)}/session`, {action: 'touch_activity', payload: {
        tab: 'material', sectionId: content.sectionId, sectionContentRevision: content.contentRevision, sectionCursor: cursor,
      }});
      query.setQueryData<Session>(['dsh-presentation-session', unitId], previous => ({...previous, materialPresentation: {
        ...previous?.materialPresentation, sectionCursors: {...previous?.materialPresentation?.sectionCursors,
          [content.sectionId]: {contentRevision: content.contentRevision, cursor}},
      }}));
      setError('');
    }).catch(error => setError(error.message));
  };
  return <>{error && <p className="xl-error" role="alert">演示位置保存失败：{error}</p>}
    {content.teachingDerivation ? <TeachingDerivationPlayer document={content.teachingDerivation} derived={content.teachingDerivationDerived}
      assistantName="学习助手" assistantAvatarSrc={avatar} busy={busy} persistedCursor={savedCursor} onCursorChange={persist} onContinue={() => onContinue?.()} />
      : content.derivation ? <FormalDerivationSection document={content.derivation} assistantName="学习助手" assistantAvatarSrc={avatar}
        busy={busy} persistedCursor={savedCursor} onCursorChange={persist} onContinue={() => onContinue?.()} />
      : content.material ? <MaterialPresentation material={content.material} savedCursor={savedCursor} onCursorChange={persist} onContinue={onContinue} /> : null}
  </>;
}

function MaterialPresentation({material, savedCursor, onCursorChange, onContinue}: {
  material: LearningMaterialContent; savedCursor?: number; onCursorChange: (cursor: number) => void; onContinue?: () => void;
}) {
  const turns = useMemo(() => buildAssistantCourseFeed(material), [material]);
  const [cursor, setCursor] = useState(() => Math.max(1, Math.min(turns.length, savedCursor ?? 1)));
  const [playing, setPlaying] = useState(false);
  const jump = (value: number) => {
    const next = Math.max(1, Math.min(turns.length, value));
    setCursor(next); onCursorChange(next);
  };
  useEffect(() => {
    if (!playing || cursor >= turns.length) {if (playing) setPlaying(false); return;}
    const timer = setTimeout(() => jump(cursor + 1), 7000);
    return () => clearTimeout(timer);
  }, [playing, cursor, turns.length]);
  const controls = <nav className="xl-presentation-controls" aria-label="演示播放">
    <Button type="button" variant="outline" size="sm" disabled={cursor <= 1} onClick={() => {setPlaying(false); jump(cursor - 1);}}>上一步</Button>
    <Button type="button" size="sm" onClick={() => {if (cursor >= turns.length) jump(1); setPlaying(value => !value);}}>{playing ? '暂停演示' : '播放演示'}</Button>
    <span role="status">第 {cursor} / {turns.length} 步</span>
    <Button type="button" variant="outline" size="sm" disabled={cursor >= turns.length} onClick={() => {setPlaying(false); jump(cursor + 1);}}>下一步</Button>
    {cursor >= turns.length && onContinue && <Button type="button" size="sm" onClick={onContinue}>完成演示，继续学习</Button>}
  </nav>;
  return <InteractiveMaterialBody material={material} assistantFeed={{
    persona: {name: '学习助手', avatarSrc: avatar}, visibleTurnCount: cursor,
    animatedTurnIndex: cursor - 1, animationEnabled: true, textAnimationEnabled: false, controls,
  }} />;
}
