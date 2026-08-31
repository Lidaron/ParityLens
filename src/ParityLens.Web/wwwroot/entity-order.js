const ENTITY_ORDER = [
  'users',
  'groups',
  'guests',
  'recipients',
  'organizations',
  'tenant-settings',
  'tenant-configs',
  'unified-policies',
  'unified-policy-rules',
  'unified-policy-settings',
  'data-encryption-policies',
  'cross-tenant-access-policies',
  'resource-objects',
  'shard-directory-metadata',
  'ag-connected-accounts',
  'combined-context',
  'substrate-ib',
  'system',
];

const ENTITY_RANK = new Map(ENTITY_ORDER.map((id, index) => [id, index]));

export function logicallyOrderedEntities(entities) {
  return [...(entities ?? [])].sort((left, right) => {
    const leftRank = ENTITY_RANK.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = ENTITY_RANK.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    return leftRank - rightRank
      || String(left.name ?? left.id).localeCompare(String(right.name ?? right.id));
  });
}