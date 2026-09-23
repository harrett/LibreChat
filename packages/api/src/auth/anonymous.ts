import { randomUUID } from 'node:crypto';
import { SystemRoles } from 'librechat-data-provider';
import type { BalanceConfig, CreateUserRequest, IUser } from '@librechat/data-schemas';
import type { RequestHandler, Response, Request } from 'express';

export const ANONYMOUS_EMAIL_DOMAIN = 'anonymous.local';

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
  appConfig?: { registration?: { anonymous?: boolean }; balance?: BalanceConfig };
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
  /** ponytail: one account per cookie-less load, kept forever. Add a TTL or a
   * per-IP limiter if this ever faces something noisier than a local browser. */
  const user = await createUser(
    {
      provider: 'local',
      email: `anonymous-${id}@${ANONYMOUS_EMAIL_DOMAIN}`,
      username: `anonymous-${id.slice(0, 8)}`,
      name: 'Guest',
      emailVerified: true,
      role: SystemRoles.USER,
    },
    appConfig.balance,
    true,
    true,
  );

  const userId = user._id.toString();
  const token = await setAuthTokens(userId, res, null, req);

  return { token, user: { ...user, _id: userId, id: userId } };
}
