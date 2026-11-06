// Stands in for the YouTube Data API. The real server code runs against it, so
// search, trending and link lookups cost no quota. See fixtures/README.md.
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

const load = (name) => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url)));

export const youtube = load('youtube.json');
export const byId = new Map(youtube.videos.map((video) => [video.id, video]));

/** Picks fixture videos by title, so a flow reads as what a viewer sees. */
export const video = (match) => {
  const found = youtube.videos.find(({ snippet }) => snippet.title.includes(match));
  if (!found) throw new Error(`no fixture video matches ${match}`);
  return { id: found.id, title: found.snippet.title, url: `https://www.youtube.com/watch?v=${found.id}` };
};

const send = (response, status, body) => {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
};

const failure = (reason, code) => ({ error: { code, errors: [{ reason }] } });

export const startFixtureApi = async () => {
  const calls = { search: 0, videos: 0 };
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://fixture');
    if (url.pathname === '/search') {
      calls.search += 1;
      const query = url.searchParams.get('q').toLowerCase();
      if (query.includes('break the api')) return send(response, 500, failure('backendError', 500));
      if (query.includes('out of quota')) return send(response, 403, failure('quotaExceeded', 403));
      const ids = query.includes('nothing matches') ? [] : youtube.search;
      return send(response, 200, { items: ids.map((videoId) => ({ id: { kind: 'youtube#video', videoId } })) });
    }
    if (url.pathname === '/videos') {
      calls.videos += 1;
      if (url.searchParams.get('chart')) return send(response, 200, { items: youtube.trending.map((id) => byId.get(id)) });
      const ids = url.searchParams.get('id').split(',');
      return send(response, 200, { items: ids.flatMap((id) => byId.get(id) ?? []) });
    }
    return send(response, 404, failure('notFound', 404));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    calls,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
};
