import { renderHook } from '@testing-library/react';
import useUserKey from '../useUserKey';

const state: { keyQueryData?: { expiresAt: string | null } } = {};

jest.mock('librechat-data-provider/react-query', () => ({
  useUserKeyQuery: () => ({ data: state.keyQueryData }),
  useUpdateUserKeysMutation: () => ({ mutate: jest.fn() }),
}));

jest.mock('~/data-provider', () => ({
  useGetEndpointsQuery: () => ({ data: {} }),
}));

describe('useUserKey', () => {
  it('reports no expiry when the user has no key stored', () => {
    state.keyQueryData = { expiresAt: null };
    const { result } = renderHook(() => useUserKey('custom-endpoint'));

    expect(result.current.getExpiry()).toBeUndefined();
  });

  it('keeps `never` distinct from a missing key', () => {
    state.keyQueryData = { expiresAt: 'never' };
    const { result } = renderHook(() => useUserKey('custom-endpoint'));

    expect(result.current.getExpiry()).toBe('never');
    expect(result.current.checkExpiry()).toBe(true);
  });

  it('returns the stored expiry date and marks a past one expired', () => {
    state.keyQueryData = { expiresAt: '2020-01-01T00:00:00.000Z' };
    const { result } = renderHook(() => useUserKey('custom-endpoint'));

    expect(result.current.getExpiry()).toBe('2020-01-01T00:00:00.000Z');
    expect(result.current.checkExpiry()).toBe(false);
  });
});
