import {forwardRef, useImperativeHandle} from 'react';
import type {LabFrameHandle, LabFrameHostProps} from '../../../desktop/src/components/lab/lab-frame-host';

/** This release does not ship Desktop's separate iframe lab runtime. Keep its
 * authored description visible without mounting a missing host route. */
export const LabFrameHost = forwardRef<LabFrameHandle, LabFrameHostProps>(function LabUnavailable({title, fallback}, ref) {
  useImperativeHandle(ref, () => ({send: () => false, reload: () => {}}), []);
  return <section aria-label={title ?? '互动实验'}>{fallback ?? <h4>{title ?? '互动实验'}</h4>}<p>此互动实验暂不支持在当前插件中运行。</p></section>;
});
