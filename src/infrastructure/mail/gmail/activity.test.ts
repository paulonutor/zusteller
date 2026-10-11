import { expect, it, vi } from 'vitest';
import { createGmailActivity } from './activity';
import { deferred } from '../../../../tests/helpers/mail';

it('waits for the owning window result, isolates request IDs and cleans up listeners on success or failure', async () => {
  const handlers = new Map<string, (payload: unknown) => void>();
  const off = vi.fn();
  const listen = vi.fn(async (event: string, handler: (payload: unknown) => void) => {
    handlers.set(event, handler);
    return off;
  });
  const invoke = vi.fn().mockResolvedValue(undefined);
  const activity = createGmailActivity(invoke, listen);
  const request = activity.perform('refresh');
  await vi.waitFor(() => expect(invoke).toHaveBeenCalled());
  const requestId = invoke.mock.calls[0]![1].requestId;
  const complete = handlers.get('zusteller://gmail-activity-result')!;
  complete({ requestId: 'another-window-request', error: 'Ignore' });
  expect(off).not.toHaveBeenCalled();
  complete({ requestId, error: null });
  await request;
  expect(off).toHaveBeenCalledOnce();
  invoke.mockRejectedValueOnce(new Error('Main window closed'));
  await expect(activity.perform('disconnect')).rejects.toThrow('Main window closed');
  expect(off).toHaveBeenCalledTimes(2);
});

it('returns action errors and ignores callbacks after unsubscribe, including late listener registration', async () => {
  const registration = deferred<() => void>();
  let receive!: (payload: unknown) => void;
  const off = vi.fn();
  const listen = vi.fn((_event: string, handler: typeof receive) => {
    receive = handler;
    return registration.promise;
  });
  const invoke = vi.fn().mockResolvedValue(undefined);
  const activity = createGmailActivity(invoke, listen);
  const handler = vi.fn().mockRejectedValue(new Error('Sign-in failed'));
  const unsubscribe = activity.subscribeActions(handler);
  receive({ requestId: 'one', action: 'connect' });
  await vi.waitFor(() =>
    expect(invoke).toHaveBeenCalledWith('gmail_activity_result', {
      requestId: 'one',
      error: 'Sign-in failed',
    }),
  );
  unsubscribe();
  receive({ requestId: 'two', action: 'connect' });
  expect(handler).toHaveBeenCalledOnce();
  registration.resolve(off);
  await vi.waitFor(() => expect(off).toHaveBeenCalledOnce());
});
