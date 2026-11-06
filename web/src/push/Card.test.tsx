// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Card from './Card';
import { deviceName, readPushState, stopPings, turnOn } from './push';

const post = vi.hoisted(() => vi.fn());
const request = vi.hoisted(() => vi.fn());
const config = vi.hoisted(() => vi.fn());
vi.mock('../api/http', () => ({ post, request, api: { config } }));

const worker = (subscribed: boolean) => {
  const subscription = { toJSON: () => ({ endpoint: 'https://push.test/1', keys: { p256dh: 'k', auth: 'a' } }), unsubscribe: vi.fn() };
  const pushManager = { getSubscription: vi.fn(async () => (subscribed ? subscription : null)), subscribe: vi.fn(async () => subscription) };
  const registration = { pushManager };
  const serviceWorker = { getRegistration: vi.fn(async () => registration), register: vi.fn(async () => registration), ready: Promise.resolve(registration) };
  Object.defineProperty(navigator, 'serviceWorker', { value: serviceWorker, configurable: true });
  return { serviceWorker, pushManager, subscription };
};

const permission = (value: NotificationPermission, answer: NotificationPermission = value) => {
  const requestPermission = vi.fn(async () => answer);
  vi.stubGlobal('Notification', { permission: value, requestPermission });
  return requestPermission;
};

const browser = (userAgent: string, standalone = false) => {
  Object.defineProperty(navigator, 'userAgent', { value: userAgent, configurable: true });
  vi.stubGlobal('matchMedia', () => ({ matches: standalone }));
};

beforeEach(() => {
  vi.stubGlobal('PushManager', class {});
  browser('Chrome/150 Mac OS');
  config.mockResolvedValue({ vapidPublicKey: 'AQID' });
  post.mockResolvedValue({ id: 'd1' });
  request.mockResolvedValue({ devices: [], crews: [{ slug: 'movie', name: 'Movie', notify: 'all' }] });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  localStorage.clear();
});

describe('the ping card', () => {
  it('asks nothing and registers nothing until Allow is pressed', async () => {
    const { serviceWorker, pushManager } = worker(false);
    const ask = permission('default', 'granted');
    render(<Card slug="movie" />);
    const allow = await screen.findByRole('button', { name: 'Allow' });
    expect(screen.getByText('Get a ping when your crew starts watching.')).toBeTruthy();
    expect(ask).not.toHaveBeenCalled();
    expect(serviceWorker.register).not.toHaveBeenCalled();

    fireEvent.click(allow);
    await screen.findByText('You’re on. We’ll ping this device.');
    expect(ask).toHaveBeenCalledOnce();
    expect(serviceWorker.register).toHaveBeenCalledWith('/sw.js');
    expect(pushManager.subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }));
    expect(post).toHaveBeenCalledWith('/v1/push/subscriptions', { endpoint: 'https://push.test/1', keys: { p256dh: 'k', auth: 'a' } });
  });

  it('puts a subscribed browser back under whoever is here, without asking', async () => {
    worker(true);
    const ask = permission('granted');
    render(<Card slug="movie" />);
    await screen.findByText('You’re on. We’ll ping this device.');
    expect(post).toHaveBeenCalledWith('/v1/push/subscriptions', { endpoint: 'https://push.test/1', keys: { p256dh: 'k', auth: 'a' } });
    expect(ask).not.toHaveBeenCalled();
  });

  it('does not save anything for a browser that never said yes', async () => {
    worker(false);
    permission('default');
    render(<Card slug="movie" />);
    await screen.findByRole('button', { name: 'Allow' });
    expect(post).not.toHaveBeenCalled();
  });

  it('lets go of the browser at sign-out, so it stops looking turned on', async () => {
    const { subscription } = worker(true);
    permission('granted');
    localStorage.setItem('s2g:push-device', 'd1');

    await stopPings();

    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
    expect(localStorage.getItem('s2g:push-device')).toBeNull();
  });

  it('says what blocked it, and never asks again', async () => {
    worker(false);
    const ask = permission('denied');
    render(<Card slug="movie" />);
    await screen.findByText(/Notifications are blocked for this site/);
    expect(screen.queryByRole('button', { name: 'Allow' })).toBeNull();
    expect(ask).not.toHaveBeenCalled();
  });

  it('stays quiet when someone closes the prompt without choosing', async () => {
    const { pushManager } = worker(false);
    permission('default', 'default');
    await expect(turnOn('AQID')).resolves.toBe('off');
    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });

  it('shows the Home Screen steps in an iPhone tab, and no Allow', async () => {
    browser('iPhone Safari/605');
    worker(false);
    permission('default');
    render(<Card slug="movie" />);
    await screen.findByText(/Add Stream2Gather to your Home Screen to get pings/);
    expect(screen.queryByRole('button', { name: 'Allow' })).toBeNull();
  });

  it('treats a Home Screen iPhone app like any browser', async () => {
    browser('iPhone Safari/605', true);
    worker(false);
    permission('default');
    await expect(readPushState()).resolves.toBe('off');
  });

  it('shows nothing where push does not exist or has no key', async () => {
    worker(false);
    permission('default');
    config.mockResolvedValue({ vapidPublicKey: '' });
    const { container } = render(<Card slug="movie" />);
    await waitFor(() => expect(config).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });

  it('says so when saving the device fails, and leaves Allow there', async () => {
    worker(false);
    permission('default', 'granted');
    post.mockRejectedValue(new Error('down'));
    render(<Card slug="movie" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Allow' }));
    await screen.findByText('That didn’t work. Try again.');
    expect(screen.getByRole('button', { name: 'Allow' })).toBeTruthy();
  });

  it('lists no devices plainly, and turns a crew off', async () => {
    worker(true);
    permission('granted');
    render(<Card slug="movie" />);
    await screen.findByText('No devices yet.');
    fireEvent.click(screen.getByLabelText('Ping me about this crew'));
    await waitFor(() => expect(request).toHaveBeenCalledWith('/v1/crews/movie/me', { method: 'PATCH', body: '{"notify":"off"}' }));
  });

  it('names a device a person would recognise', () => {
    expect(deviceName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/150 Safari/537')).toBe('Chrome on Mac');
    expect(deviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 18) Version/18 Safari/604')).toBe('Safari on iPhone');
    expect(deviceName('')).toBe('A browser');
  });
});
