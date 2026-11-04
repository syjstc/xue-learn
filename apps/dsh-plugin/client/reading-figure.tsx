import {useEffect, useState, type ComponentProps} from 'react';
import {ReadingFigure as SharedReadingFigure} from '../../../desktop/src/features/reading/reading-figure';
import {apiFetch} from './api-client';

/** Local image bytes cross the same authenticated DSH transport as course data. */
export function ReadingFigure(props: ComponentProps<typeof SharedReadingFigure>) {
  const source = props.artifact.type === 'image' ? props.artifact.imageUrl : '';
  const local = source.startsWith('/api/');
  const [resource, setResource] = useState<{source: string; url?: string; error?: string}>();
  useEffect(() => {
    if (!local) return;
    const controller = new AbortController();
    let active = true, url: string | undefined;
    void apiFetch(source, {signal: controller.signal}).then(async response => {
      if (!response.ok) throw new Error(`图片读取失败（${response.status}）`);
      const blob = await response.blob();
      if (!active) return;
      url = URL.createObjectURL(blob);
      setResource({source, url});
    }).catch(error => {if (active) setResource({source, error: error.message});});
    return () => {active = false; controller.abort(); if (url) URL.revokeObjectURL(url);};
  }, [source, local]);
  if (!local || props.artifact.type !== 'image') return <SharedReadingFigure {...props} />;
  if (resource?.source !== source || !resource.url) return resource?.error
    ? <p role="alert" className="xl-error">{resource.error}</p> : <p role="status">正在读取图片…</p>;
  return <SharedReadingFigure {...props} artifact={{...props.artifact, imageUrl: resource.url}} />;
}
