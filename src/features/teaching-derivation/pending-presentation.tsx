import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '@/shared/api';
import { compileTeachingDerivation, type TeachingDerivationDocumentV1 } from "@xue-learn/core/teaching-derivation";
import { derivationDisplayDocument } from "@xue-learn/core/display/catalog";
import { createDisplayClock } from "@xue-learn/core/display/runtime";
import { DisplayDocumentHost } from "@/features/display/display-block-host";
import { Button } from "@xue-learn/core/ui/button";
import { useT } from "@xue-learn/core/i18n";
type Pending = { revision: number; hash: string; document: TeachingDerivationDocumentV1; issues: { code: string; message: string }[] };
export function PendingTeachingPresentation(props: { unitId: string; sectionId: string; onAccepted: () => void; errorKey: string }) {
 const t=useT();
 const [pending,setPending]=useState<Pending|null>(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 useEffect(()=>{ let active=true; void apiGet<Pending|null>(`/api/units/${props.unitId}/sections/${props.sectionId}/teaching-presentation/pending`).then(p=>{if(active)setPending(p)}).catch(()=>{}); return ()=>{active=false}; },[props.unitId,props.sectionId,props.errorKey]);
 if(!pending)return null;
 const accept=async()=>{setBusy(true);setError('');try{await apiPost(`/api/units/${props.unitId}/sections/${props.sectionId}/teaching-presentation/accept`,{revision:pending.revision,hash:pending.hash});setPending(null);props.onAccepted();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false)}};
 const ordinal=pending.document.steps.length;
 return <section className="space-y-3 rounded-xl border border-amber-300 bg-amber-50/40 p-4">
  <h3 className="font-medium">{t('teachingDerivation.needsAttention')}</h3>
  <ul className="list-disc pl-5 text-sm">{pending.issues.map((issue,i)=><li key={i}>{issue.message}</li>)}</ul>
  <details><summary>{t('teachingDerivation.previewFallback')}</summary><DisplayDocumentHost document={derivationDisplayDocument({document:pending.document,derived:compileTeachingDerivation(pending.document),fromStep:ordinal,toStep:ordinal,progress:1})} clock={createDisplayClock(120,60)} controls={false}/></details>
  <Button disabled={busy} variant="outline" onClick={()=>void accept()}>{t('teachingDerivation.acceptFallback')}</Button>
  {error?<p role="alert">{error}</p>:null}
 </section>;
}
