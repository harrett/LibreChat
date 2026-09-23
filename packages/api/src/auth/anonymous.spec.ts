import type { Response, Request } from 'express';
import type { CreateAnonymousSessionParams } from './anonymous';
import { createAnonymousSession, ANONYMOUS_EMAIL_DOMAIN } from './anonymous';

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
