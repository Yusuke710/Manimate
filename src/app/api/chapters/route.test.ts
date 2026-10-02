import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({read: vi.fn(), update: vi.fn(), stat: vi.fn(), session: {agent_session_id: 'run' as string | null, video_path: '/video.mp4', last_video_url: '/api/files?_v=42', chapters: '[{"name":"Stale","start":0,"duration":99}]'}}));
vi.mock('@/lib/local/config', () => ({getLocalSessionPaths: () => ({projectDir: '/project'})}));
vi.mock('@/lib/local/session-store', () => ({getLocalSession: () => mocks.session, updateLocalSession: mocks.update}));
vi.mock('@/lib/local/chapters', async importOriginal => ({...await importOriginal<object>(), readLocalProjectChapters: mocks.read}));
vi.mock('node:fs/promises', () => ({default: {stat: mocks.stat}}));
import { GET } from './route';
beforeEach(() => { vi.clearAllMocks(); mocks.session.agent_session_id = 'run'; });
it('rechecks inputs even when stored chapters exist, and clears stale results', async () => {
  const current = [{name: 'New clip', start: 0, duration: 5}];
  mocks.read.mockResolvedValueOnce(current).mockResolvedValueOnce([]);
  const request = () => new NextRequest('http://localhost/api/chapters?session_id=test');
  expect(await (await GET(request())).json()).toEqual(current);
  expect(await (await GET(request())).json()).toEqual([]);
  expect(mocks.update).toHaveBeenLastCalledWith('test', {chapters: null});
});

it('preserves supplied handoff chapters only while its video version matches', async () => {
  mocks.session.agent_session_id = null;
  mocks.stat.mockResolvedValueOnce({mtimeMs: 42}).mockResolvedValueOnce({mtimeMs: 43});
  mocks.read.mockResolvedValue([]);
  const request = () => new NextRequest('http://localhost/api/chapters?session_id=test');
  expect(await (await GET(request())).json()).toEqual([{name: 'Stale', start: 0, duration: 99}]);
  expect(mocks.read).not.toHaveBeenCalled();
  expect(await (await GET(request())).json()).toEqual([]);
});
