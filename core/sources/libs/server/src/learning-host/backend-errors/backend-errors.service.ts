import { Injectable, NotFoundException } from "@nestjs/common";
import { tBackend } from "../../../../common/src/index.js";
import { LearningSpaceOrmProvider } from "../../learning-spaces/learning-space-orm.provider.js";
import {
  queryBackendErrorGroupDetail,
  queryBackendErrorGroups,
  type BackendErrorListParams,
} from "../../observability/index.js";

@Injectable()
export class BackendErrorsService {
  constructor(private readonly learningSpaceOrm: LearningSpaceOrmProvider) {}

  list(params: BackendErrorListParams) {
    return queryBackendErrorGroups(params, this.learningSpaceOrm.observability);
  }

  async detail(id: string) {
    const result = await queryBackendErrorGroupDetail(id, this.learningSpaceOrm.observability);
    if (!result) {
      throw new NotFoundException(tBackend("error.backendError.groupNotFound"));
    }
    return result;
  }
}
