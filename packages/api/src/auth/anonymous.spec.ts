import type { RequestHandler, Response, Request } from 'express';
import type { CreateAnonymousSessionParams } from './anonymous';
import {
  createAnonymousProvisioningLimiter,
  createAnonymousSession,
  ANONYMOUS_EMAIL_DOMAIN,
} from './anonymous';

const setup = (appConfig: CreateAnonymousSessionParams['appConfig']) => {
  const created: Parameters<CreateAnonymousSessionParams['createUser']>[] = [];
  const createUser: CreateAnonymousSessionParams['createUser'] = async (...args) => {
    created.push(args);
    return {
      _id: 'user-id',
      id: 'user-id',
      email: args[0].email as string,
      username: args[0].username,
      name: args[0].name,
      role: args[0].role,
      provider: args[0].provider as string,
    };
  };
  const setAuthTokens = jest.fn(async () => 'jwt-token');

  return {
    created,
    setAuthTokens,
    run: () =>
      createAnonymousSession({
        appConfig,
        createUser,
        setAuthTokens,
        req: {} as Request,
        res: {} as Response,
      }),
  };
};

describe('createAnonymousSession', () => {
  it('returns null when anonymous access is not enabled', async () => {
    const off = setup({ registration: {} });
    expect(await off.run()).toBeNull();
    expect(off.created).toHaveLength(0);
    expect(off.setAuthTokens).not.toHaveBeenCalled();

    const absent = setup(undefined);
    expect(await absent.run()).toBeNull();
    expect(absent.created).toHaveLength(0);
  });

  it('issues a token for a passwordless account when enabled', async () => {
    const { run, created, setAuthTokens } = setup({
      registration: { anonymous: true },
      balance: { enabled: true, startBalance: 1000 },
    });

    const session = await run();

    expect(session?.token).toBe('jwt-token');
    expect(session?.user.email).toMatch(new RegExp(`@${ANONYMOUS_EMAIL_DOMAIN}$`));
    expect(session?.user.name).toBe('Guest');
    expect(created[0][0].password).toBeUndefined();
    expect(created[0][1]).toEqual({ enabled: true, startBalance: 1000 });
    expect(setAuthTokens).toHaveBeenCalledWith(
      'user-id',
      expect.anything(),
      null,
      expect.anything(),
    );
  });

  it('gives each caller a distinct identity', async () => {
    const { run } = setup({ registration: { anonymous: true } });

    const [first, second] = [await run(), await run()];

    expect(first?.user.email).not.toBe(second?.user.email);
  });
});

describe('createAnonymousProvisioningLimiter', () => {
  const run = async (
    appConfig: { registration?: { anonymous?: boolean } } | undefined,
    cookies: Record<string, string>,
  ) => {
    const limiter = jest.fn((_req, _res, next) => next()) as unknown as RequestHandler;
    const next = jest.fn();
    const middleware = createAnonymousProvisioningLimiter({
      getAppConfig: async () => appConfig,
      limiter,
    });

    await middleware({ cookies } as unknown as Request, {} as Response, next);

    return { limiter, next };
  };

  it('limits a cookie-less refresh when anonymous access is on', async () => {
    const { limiter } = await run({ registration: { anonymous: true } }, {});

    expect(limiter).toHaveBeenCalledTimes(1);
  });

  it('lets a browser renewing its own session through unmetered', async () => {
    const { limiter, next } = await run(
      { registration: { anonymous: true } },
      { refreshToken: 'existing' },
    );

    expect(limiter).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('does not meter first visits when anonymous access is off', async () => {
    const { limiter, next } = await run({ registration: {} }, {});

    expect(limiter).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });
});
