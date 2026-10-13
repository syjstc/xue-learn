import {useSearchParams} from "react-router-dom";
import {DisplayPluginManager, readDisplayPluginSelection, writeDisplayPluginSelection, useDisplayWorkspace} from "@xue-learn/core/display/workspace";
import {displayWorkspaceClient} from "@/features/display/workspace";

export function LocalDisplayPluginsPage() {
  const {refresh} = useDisplayWorkspace();
  const [params, setParams] = useSearchParams();
  return <DisplayPluginManager client={displayWorkspaceClient} onChanged={refresh} selection={readDisplayPluginSelection(params)} onSelectionChange={selection => setParams(writeDisplayPluginSelection(params, selection), {preventScrollReset: true})}/>;
}
