const ID = '[A-Za-z0-9_-]{1,160}';
const routes = new RegExp(`^/(?:spaces(?:/(?:${ID}))?|goals(?:/(?:new|creating|${ID})(?:/(?:overview|map|plan|foundations|projects(?:/${ID})?|modules/${ID}(?:/(?:diagnostic|assessment))?|units/${ID}(?:/(?:diagnostic|assessment|supplements/${ID}))?))?)?|today|reviews(?:/${ID}/${ID})?|onboarding|settings|profile|flashcards|404)$`);

export function isLearningRoute(value) {
  if (typeof value !== 'string' || value.length > 1600 || /[\\\r\n#]/.test(value)) return false;
  try {
    const url = new URL(value, 'https://learning.invalid');
    return url.origin === 'https://learning.invalid' && routes.test(url.pathname)
      && value === `${url.pathname}${url.search}`;
  } catch {return false;}
}

/** Migrate v1's lesson-only preference while retaining the full native route. */
export function positionPath(position = {}) {
  if (isLearningRoute(position.route)) return position.route;
  if (!position.goalId || !new RegExp(`^${ID}$`).test(position.goalId)) return '/spaces';
  const base = `/goals/${position.goalId}`;
  if (!position.unitId || !new RegExp(`^${ID}$`).test(position.unitId)) return base;
  const unit = `${base}/units/${position.unitId}`;
  if (position.tab === 'practice') return `${unit}/diagnostic`;
  const search = new URLSearchParams({view: position.tab === 'display' ? 'display' : 'reading'});
  if (position.sectionId) search.set('section', position.sectionId);
  return `${unit}?${search}`;
}

export function routePosition(route) {
  if (!isLearningRoute(route)) return null;
  const url = new URL(route, 'https://learning.invalid');
  const goal = url.pathname.match(new RegExp(`^/goals/(${ID})(?:/|$)`));
  const unit = url.pathname.match(new RegExp(`/units/(${ID})(?:/|$)`));
  return {route,
    ...(goal && !['new', 'creating'].includes(goal[1]) ? {goalId: goal[1]} : {}),
    ...(unit ? {unitId: unit[1], tab: url.pathname.endsWith('/diagnostic') ? 'practice'
      : url.searchParams.get('view') === 'display' ? 'display' : 'reading'} : {}),
    ...(unit && url.searchParams.get('section') ? {sectionId: url.searchParams.get('section')} : {}),
  };
}
