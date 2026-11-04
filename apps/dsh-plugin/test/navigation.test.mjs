import test from 'node:test';
import assert from 'node:assert/strict';
import {isLearningRoute, positionPath, routePosition} from '../lib/navigation.mjs';
import {parsePosition} from '../lib/state-store.mjs';

test('legacy learning positions migrate to the matching native lesson and activity', () => {
  assert.equal(positionPath(), '/spaces');
  assert.equal(positionPath({goalId: 'g1', unitId: 'u1', sectionId: 'mini-test:s1', tab: 'reading'}), '/goals/g1/units/u1?view=reading&section=mini-test%3As1');
  assert.equal(positionPath({goalId: 'g1', unitId: 'u1', tab: 'practice'}), '/goals/g1/units/u1/diagnostic');
  assert.equal(positionPath({goalId: 'g1', unitId: 'u1', tab: 'display'}), '/goals/g1/units/u1?view=display');
});

test('space, module, settings and native lesson routes survive serialization', () => {
  for (const route of ['/spaces', '/spaces/space-1', '/spaces/unorganized', '/goals/g1?view=catalog',
    '/goals/g1/modules/m1', '/goals/g1/units/u1?view=reading&section=s1',
    '/goals/g1/units/u1/diagnostic', '/settings?tab=appearance', '/reviews', '/today']) {
    assert.equal(positionPath(parsePosition(routePosition(route))), route);
  }
  assert.deepEqual(routePosition('/spaces'), {route: '/spaces'});
  assert.deepEqual(routePosition('/goals/g1/units/u1?view=display&section=s1'), {
    route: '/goals/g1/units/u1?view=display&section=s1', goalId: 'g1', unitId: 'u1', tab: 'display', sectionId: 's1',
  });
});

test('persisted routes cannot navigate to host settings or external destinations', () => {
  for (const route of ['https://other.example/spaces', '//other.example/spaces', '/local/api-keys',
    '/api/workspace-service/drain', '/spaces/../settings', '/spaces/%2e%2e/settings', '/spaces#bad',
    '/spaces\\other', '/spaces\nother', 'http://[', '/spaces/' + 'x'.repeat(180)]) {
    assert.equal(isLearningRoute(route), false, route);
    assert.equal(routePosition(route), null);
    assert.throws(() => parsePosition({route}));
  }
});
