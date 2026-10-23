import type { ClientSession, Types } from 'mongoose';
import { AuditLogModel } from './audit-log.model.js';

export interface AuditEntry {
  familyId?: Types.ObjectId | null;
  actorId: Types.ObjectId | null;
  actorRole: string;
  action: string;
  targetType: string;
  targetId?: Types.ObjectId | null;
  before?: unknown;
  after?: unknown;
  contributionId?: Types.ObjectId | null;
  requestId?: string | null;
  ip?: string | null;
}

const SECRET_KEYS = new Set(['passwordHash', 'password', 'tokenHash', 'contact', 'totpSecret', 'pendingSecret', 'recoveryCodes']);

function redact(value: unknown): unknown {
  if (value == null || typeof value !== 'object') return value ?? null;
  if (Array.isArray(value)) return value.map(redact);
  const proto = Object.getPrototypeOf(value) as unknown;
  // Leave ObjectIds, Dates and other value types intact; only walk plain objects.
  if (proto !== Object.prototype && proto !== null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([k]) => !SECRET_KEYS.has(k))
      .map(([k, v]) => [k, redact(v)]),
  );
}

export class AuditService {
  async record(entry: AuditEntry, session?: ClientSession): Promise<Types.ObjectId> {
    const [doc] = await AuditLogModel.create(
      [{ ...entry, before: redact(entry.before), after: redact(entry.after), at: new Date() }],
      { session },
    );
    return doc!._id;
  }
}
