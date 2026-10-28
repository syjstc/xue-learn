import {apiGet, apiPost} from "@/shared/api";
import type {DisplayWorkspaceClient} from "@xue-learn/core/display/workspace";

export const displayWorkspaceClient: DisplayWorkspaceClient = {get: apiGet, post: apiPost};
