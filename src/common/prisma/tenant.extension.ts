import { Prisma } from '@prisma/client';
import { ForbiddenException } from '@nestjs/common';
import { TenantStore } from '../tenancy/tenant-context';

/**
 * Application-level tenant isolation.
 *
 * Every model listed here carries an `officeId`. The extension rewrites each
 * query so it can only ever touch the office currently in scope - a developer
 * cannot forget the filter, because they never write it. The super admin is
 * the one principal allowed to opt out.
 *
 * PostgreSQL RLS (see prisma/migrations/*_row_level_security) enforces the
 * same rule underneath, for anything that reaches the database outside this
 * client.
 */
const TENANT_MODELS = new Set<string>([
  'OfficeSettings',
  'User',
  'Subscription',
  'Property',
  'PropertyMedia',
  'Lead',
  'Conversation',
  'Message',
  'Broadcast',
  'BroadcastRecipient',
  'PropertyDelivery',
  'LeadDailyQuota',
  'ExternalAccount',
  'ExternalPublication',
  'AuditLog',
]);

/** Models scoped through a parent relation instead of a direct column. */
const RELATION_SCOPED: Record<string, (officeId: string) => object> = {
  SubscriptionEvent: (officeId) => ({ subscription: { officeId } }),
};

/**
 * Operations whose `where` must stay a *unique* input. Prisma requires the
 * unique field at the top level, so the tenant filter is spread alongside it -
 * wrapping these in `AND` would make `{ propertyId_leadId: ... }` unreachable
 * and Prisma would reject the query.
 */
const UNIQUE_WHERE_OPS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'update',
  'delete',
  'upsert',
]);

/** Operations taking a plain filter, where an `AND` wrapper is safe. */
const FILTER_WHERE_OPS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
  'deleteMany',
]);

const mergeFilterWhere = (where: unknown, scope: object): object => {
  if (!where || Object.keys(where as object).length === 0) return { ...scope };
  return { AND: [where, scope] };
};

/**
 * Spreads the tenant scope into a unique `where`. If the caller already pinned
 * that key to a different office, the request is a cross-tenant access attempt
 * and is refused rather than silently rewritten to their own office.
 */
const mergeUniqueWhere = (model: string, where: unknown, scope: object): object => {
  const merged = { ...((where ?? {}) as Record<string, unknown>) };
  for (const [key, value] of Object.entries(scope)) {
    const existing = merged[key];
    if (
      existing !== undefined &&
      typeof existing !== 'object' &&
      existing !== value
    ) {
      throw new ForbiddenException(
        `Cross-office access denied on "${model}": ${key} does not belong to the office in scope.`,
      );
    }
    merged[key] = value;
  }
  return merged;
};

export const tenantExtension = Prisma.defineExtension({
  name: 'tenant-isolation',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const isOffice = model === 'Office';
        const relationScope = RELATION_SCOPED[model];
        if (!isOffice && !relationScope && !TENANT_MODELS.has(model)) {
          return query(args);
        }

        const context = TenantStore.get();
        if (context?.isSuperAdmin) {
          return query(args);
        }

        const officeId = context?.officeId;
        if (!officeId) {
          throw new ForbiddenException(
            `Query on "${model}" was attempted without an office in scope. ` +
              'Wrap it in TenantStore.runAsOffice(), or use the unscoped client deliberately.',
          );
        }

        // The office row is keyed by its own id; everything else by officeId.
        const scope: object = isOffice
          ? { id: officeId }
          : relationScope
            ? relationScope(officeId)
            : { officeId };

        const next = { ...(args as Record<string, unknown>) };

        if (UNIQUE_WHERE_OPS.has(operation)) {
          next.where = mergeUniqueWhere(model, next.where, scope);
        } else if (FILTER_WHERE_OPS.has(operation)) {
          next.where = mergeFilterWhere(next.where, scope);
        }

        // Writes must be stamped, not just filtered, or a row could be created
        // under another office.
        if (!isOffice && !relationScope) {
          if (operation === 'create' || operation === 'upsert') {
            if (operation === 'create') {
              next.data = { ...(next.data as object), officeId };
            } else {
              next.create = { ...(next.create as object), officeId };
              next.update = { ...(next.update as object) };
            }
          }
          if (operation === 'createMany' || operation === 'createManyAndReturn') {
            const data = (next.data ?? []) as Record<string, unknown> | Record<string, unknown>[];
            next.data = Array.isArray(data)
              ? data.map((row) => ({ ...row, officeId }))
              : { ...data, officeId };
          }
        }

        return query(next);
      },
    },
  },
});
