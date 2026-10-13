import {json, type RequestHandler} from 'express';

/** Accepted diagrams transfer their original bytes along with teaching. Keep
 * the larger body allowance confined to this owner-authenticated operation. */
export function courseTeachingBodyParser(): RequestHandler {
  const parse = json({limit: '64mb'});
  return (request, response, next) => {
    if (request.method === 'POST' && /^\/api\/course-sources\/units\/[^/]+\/teaching\/ensure$/.test(request.path))
      return parse(request, response, next);
    return next();
  };
}
