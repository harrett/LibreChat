import { randomUUID } from 'node:crypto';
import { logger } from '@librechat/data-schemas';
import { SystemRoles } from 'librechat-data-provider';
import type { BalanceConfig, CreateUserRequest, IUser } from '@librechat/data-schemas';
import type { RequestHandler, Response, Request } from 'express';

export const ANONYMOUS_EMAIL_DOMAIN = 'anonymous.local';
export const DEFAULT_ANONYMOUS_RETENTION_DAYS = 30;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export interface AnonymousProvisioningLimiterParams {
  getAppConfig: () => Promise<{ registration?: { anonymous?: boolean } } | undefined>;
  limiter: RequestHandler;
}

/**
 * Rate-limits only the requests that would mint a new account: a refresh carrying
 * no cookie, on a deployment with anonymous access on. A browser presenting a
 * refresh token is renewing a session it already has and is let through, so the
 * limit never counts ordinary page loads.
 */
export function createAnonymousProvisioningLimiter({
  getAppConfig,
  limiter,
}: AnonymousProvisioningLimiterParams): RequestHandler {
  return async (req, res, next) => {
    if (req.cookies?.refreshToken) {
      return next();
    }
    const appConfig = await getAppConfig();
    if (appConfig?.registration?.anonymous !== true) {
      return next();
    }
    return limiter(req, res, next);
  };
}

export type AnonymousUser = Pick<IUser, 'email' | 'username' | 'name' | 'role' | 'provider'> & {
  _id: string;
  id: string;
};

export interface AnonymousSession {
  token: string;
  user: AnonymousUser;
}

export interface CreateAnonymousSessionParams {
  /** Resolved app config; the session is only issued when `registration.anonymous` is on. */
  appConfig?: {
    registration?: { anonymous?: boolean; anonymousRetentionDays?: number };
    balance?: BalanceConfig;
  };
  createUser: (
    data: CreateUserRequest,
    balanceConfig?: BalanceConfig,
    disableTTL?: boolean,
    returnUser?: boolean,
  ) => Promise<AnonymousUser>;
  setAuthTokens: (
    userId: string,
    res: Response,
    session?: null,
    req?: Request | null,
  ) => Promise<string>;
  req: Request;
  res: Response;
}

/**
 * Issues a session for a browser that presented no refresh token, so a deployment
 * can serve chat without a sign-in step. The account it creates has no password and
 * no recoverable identity — the refresh cookie is the only way back to it, and the
 * `@anonymous.local` email domain is what marks it as one of these.
 *
 * The account carries a `purgeAt` so a TTL index deletes it a fixed number of days
 * after creation — the clock does not reset on use, so a browser that keeps chatting
 * past the window loses its history and its stored provider key.
 *
 * Returns `null` when anonymous access is off, leaving the caller's existing
 * "no refresh token" response in place.
 */
export async function createAnonymousSession({
  appConfig,
  createUser,
  setAuthTokens,
  req,
  res,
}: CreateAnonymousSessionParams): Promise<AnonymousSession | null> {
  if (appConfig?.registration?.anonymous !== true) {
    return null;
  }

  const id = randomUUID();
  const retentionDays =
    appConfig.registration?.anonymousRetentionDays ?? DEFAULT_ANONYMOUS_RETENTION_DAYS;
  const user = await createUser(
    {
      provider: 'local',
      email: `anonymous-${id}@${ANONYMOUS_EMAIL_DOMAIN}`,
      username: `anonymous-${id.slice(0, 8)}`,
      name: 'Guest',
      emailVerified: true,
      role: SystemRoles.USER,
      purgeAt: new Date(Date.now() + retentionDays * ONE_DAY_MS),
    },
    appConfig.balance,
    true,
    true,
  );

  const userId = user._id.toString();
  const token = await setAuthTokens(userId, res, null, req);

  return { token, user: { ...user, _id: userId, id: userId } };
}

export interface RenewAnonymousRetentionParams {
  /** The refreshing account; one without `purgeAt` is not a throwaway and is left alone. */
  user: { _id: { toString(): string }; purgeAt?: Date | string | null };
  /** Read only for a throwaway account, so an ordinary refresh costs no config lookup. */
  getAppConfig?: () => Promise<{ registration?: { anonymousRetentionDays?: number } } | undefined>;
  updateUser: (userId: string, data: { purgeAt: Date }) => Promise<unknown>;
  invalidateUserCache?: (userId: string) => Promise<void>;
}

/**
 * Slides a throwaway account's deletion time forward as it is used, so the window
 * measures idleness rather than age. Called on every session refresh but writes at
 * most once a day per account: while the stored time is still within a day of a
 * full window, the renewal is skipped.
 *
 * Never throws — a session refresh must not fail because retention bookkeeping did.
 */
export async function renewAnonymousRetention({
  user,
  getAppConfig,
  updateUser,
  invalidateUserCache,
}: RenewAnonymousRetentionParams): Promise<void> {
  if (user.purgeAt == null) {
    return;
  }

  const userId = user._id.toString();
  try {
    const appConfig = await getAppConfig?.();
    const retentionDays =
      appConfig?.registration?.anonymousRetentionDays ?? DEFAULT_ANONYMOUS_RETENTION_DAYS;
    const renewed = Date.now() + retentionDays * ONE_DAY_MS;
    if (new Date(user.purgeAt).getTime() > renewed - ONE_DAY_MS) {
      return;
    }

    await updateUser(userId, { purgeAt: new Date(renewed) });
    await invalidateUserCache?.(userId);
  } catch (error) {
    logger.warn('[renewAnonymousRetention] Could not extend the account retention window', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
