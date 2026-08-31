import assert from 'node:assert/strict';
import test from 'node:test';

import { logicallyOrderedEntities } from '../../src/ParityLens.Web/wwwroot/entity-order.js';

test('entities follow directory, tenant, policy, resource, and specialized order', () => {
  const input = [
    entity('system'),
    entity('cross-tenant-access-policies'),
    entity('groups'),
    entity('tenant-configs'),
    entity('users'),
    entity('resource-objects'),
    entity('unified-policy-settings'),
    entity('guests'),
  ];

  assert.deepEqual(logicallyOrderedEntities(input).map(item => item.id), [
    'users',
    'groups',
    'guests',
    'tenant-configs',
    'unified-policy-settings',
    'cross-tenant-access-policies',
    'resource-objects',
    'system',
  ]);
  assert.equal(input[0].id, 'system');
});

test('unknown entities follow known entities alphabetically', () => {
  const ordered = logicallyOrderedEntities([
    { id: 'z-new', name: 'Zulu' },
    entity('users'),
    { id: 'a-new', name: 'Alpha' },
  ]);

  assert.deepEqual(ordered.map(item => item.id), ['users', 'a-new', 'z-new']);
});

function entity(id) {
  return { id, name: id };
}