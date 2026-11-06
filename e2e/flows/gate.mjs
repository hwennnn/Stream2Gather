import { joinRoom, startRoom, ui } from '../lib/app.mjs';
import { video } from '../lib/fixtures.mjs';
import { flow } from '../lib/runner.mjs';

const golden = video('Golden Hour');

flow('gate: shows what is on and who is there before anyone joins', async (t) => {
  const host = await t.person('Mina');
  const guest = await t.person('guest');
  const room = await startRoom(t, host, { url: golden.url });
  await guest.page.goto(room.url);
  await t.see('the video', guest.page.getByText(`watching ${golden.title}`));
  await t.see('how far in it is', guest.page.getByText(/^\d+:\d\d in$/));
  await t.see('the host', guest.page.getByRole('heading', { name: /Mina saved you a seat/ }));
  await t.see('the seats', guest.page.getByRole('list', { name: 'In the room' }).getByText('Mina'));
  await t.see('the Join button', ui.join(guest.page));
  t.check('a name is suggested', (await ui.joinName(guest.page).inputValue()).trim().length > 0);
  t.check('nothing plays behind the gate', !(await guest.sample()));
});

flow('gate: an empty room says so', async (t) => {
  const host = await t.person('host');
  const guest = await t.person('guest');
  const room = await startRoom(t, host);
  await guest.page.goto(room.url);
  await t.see('the invitation', guest.page.getByRole('heading', { name: /saved you a seat/i }));
  t.eq('no video to speak of', await guest.page.getByText(/watching/).count(), 0);
});

flow('gate: a paused room says where it stopped', async (t) => {
  const host = await t.person('host');
  const guest = await t.person('guest');
  const room = await startRoom(t, host, { url: golden.url });
  await t.until('it plays', async () => (await host.sample())?.time > 1);
  await host.page.evaluate(() => window.__yt.pauseVideo());
  await t.see('paused for the host', ui.bar(host.page).getByText(/paused by you/i));
  await guest.page.goto(room.url);
  await t.see('where it stopped', guest.page.getByText(/paused at \d+:\d\d/i));
});

flow('gate: the name typed is the name the room sees', async (t) => {
  const host = await t.person('host');
  const room = await startRoom(t, host);
  for (const name of ['하늘이', '🎬 Movie Night 🍿', 'Zoë O’Brien-Müller the Third']) {
    const guest = await t.person('guest');
    await joinRoom(guest, room.url, { name: name.slice(0, 32) });
    await t.expect(`${name} in the chat`, ui.chatLog(host.page).getByText(`${name.slice(0, 32)} joined`));
    await guest.context.close();
  }
});

flow('gate: enter joins, and a cleared name falls back to the suggestion', async (t) => {
  const host = await t.person('host');
  const guest = await t.person('guest');
  const room = await startRoom(t, host);
  await guest.page.goto(room.url);
  await t.see('Join ready', ui.join(guest.page));
  await ui.joinName(guest.page).fill('   ');
  await ui.joinName(guest.page).press('Enter');
  await t.see('the room', ui.rail(guest.page));
  await openPeople(guest);
  const shown = await ui.rail(guest.page).getByRole('listitem').filter({ hasText: '(you)' }).innerText();
  t.check('a real name, not blanks', /[A-Za-z]{3,} [A-Za-z]{3,}/.test(shown), shown);
});

flow('gate: a name is capped at 32 characters', async (t) => {
  const host = await t.person('host');
  const guest = await t.person('guest');
  const room = await startRoom(t, host);
  await guest.page.goto(room.url);
  await t.see('the gate', ui.join(guest.page));
  await ui.joinName(guest.page).fill('');
  await ui.joinName(guest.page).pressSequentially('x'.repeat(40));
  t.eq('the box stops at 32', (await ui.joinName(guest.page).inputValue()).length, 32);
});

flow('gate: a returning guest keeps their name', async (t) => {
  const host = await t.person('host');
  const guest = await t.person('guest');
  const room = await startRoom(t, host);
  await joinRoom(guest, room.url, { name: 'Ada' });
  await guest.page.reload();
  await t.see('the gate or the room', ui.join(guest.page).or(ui.rail(guest.page)));
  if (await ui.join(guest.page).isVisible()) {
    t.eq('the name is kept', await ui.joinName(guest.page).inputValue(), 'Ada');
  }
});

const openPeople = (client) => ui.tab(client.page, 'People').click();
