// A person without a browser, for filling a room. Each is a real session and a
// real socket on the real server.
export const bot = async (base, slug, name, address) => {
  const headers = { 'content-type': 'application/json', 'x-forwarded-for': address };
  const rename = await fetch(`${base}/v1/me`, { method: 'PATCH', headers, body: JSON.stringify({ name }) });
  if (!rename.ok) throw new Error(`bot rename: ${rename.status}`);
  // A new session and its rename each set the cookie, and the last one counts.
  const cookie = rename.headers.getSetCookie().at(-1).split(';')[0];
  const ticket = await fetch(`${base}/v1/rooms/${slug}/ticket`, { method: 'POST', headers: { ...headers, cookie }, body: '{}' });
  if (!ticket.ok) throw new Error(`bot ticket: ${ticket.status}`);
  const socket = new WebSocket(`${base.replace('http', 'ws')}/v1/ws?ticket=${(await ticket.json()).ticket}`);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () => reject(new Error('bot socket failed'));
  });
  const send = (t, d) => socket.send(JSON.stringify({ t, d }));
  const pinger = setInterval(() => send('ping'), 3000);
  return {
    name,
    send,
    say: (text) => send('chat.send', { text }),
    close() {
      clearInterval(pinger);
      socket.close();
    },
  };
};

export const crowd = async (t, slug, count, nameOf = (i) => `Guest ${i + 1}`) => {
  const bots = [];
  for (let i = 0; i < count; i += 1) {
    bots.push(await bot(t.base, slug, nameOf(i), `10.78.${Math.floor(i / 250)}.${(i % 250) + 1}`));
  }
  return bots;
};
