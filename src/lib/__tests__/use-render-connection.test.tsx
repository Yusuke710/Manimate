// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useRenderConnection } from '../useRenderConnection';

it('connects from local mode by selecting cloud before starting OAuth', async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ mode: 'cloud', status: 'disconnected' }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ mode: 'cloud', status: 'pending' }) });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div');
  const root = createRoot(container);
  function Harness() {
    const { reconnectCloudAuth } = useRenderConnection({ mode: 'local', status: 'ready' });
    return createElement('button', { onClick: reconnectCloudAuth }, 'Connect to Manim-Cloud');
  }
  try {
    await act(async () => root.render(createElement(Harness)));
    await act(async () => container.querySelector('button')!.click());
    expect(fetchMock.mock.calls.map(call => JSON.parse(call[1].body))).toEqual([{ mode: 'cloud' }, { action: 'connect' }]);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
