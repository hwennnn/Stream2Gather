import { joinRoom, openTab, react, reenter, sendChat, startRoom, ui } from '../lib/app.mjs';
import { video } from '../lib/fixtures.mjs';
import { flow } from '../lib/runner.mjs';

const golden = video('Golden Hour');

const pair = async (t, url = golden.url) => {
  const a = await t.person('Ana');
  const b = await t.person('Ben');
  const room = await startRoom(t, a, { url });
  await joinRoom(b, room.url);
  return { a, b, room };
};

flow('chat: a message reaches everyone, with its author', async (t) => {
  const { a, b } = await pair(t);
  await sendChat(a.page, 'hello from Ana 👋');
  await t.see('Ana sees it', ui.chatLog(a.page).getByText('hello from Ana 👋'));
  await t.see('Ben sees it', ui.chatLog(b.page).getByText('hello from Ana 👋'));
  await t.see('Ben sees who', ui.chatLog(b.page).getByText('Ana', { exact: true }));
  await t.see('Ana sees it was her', ui.chatLog(a.page).getByText('You', { exact: true }));
  t.eq('the box empties', await ui.chatBox(a.page).inputValue(), '');
  await t.until('the line settles', () =>
    ui.chatLog(a.page).locator('[data-delivery]').filter({ hasText: 'hello from Ana' }).evaluateAll((lines) => lines.length === 0 || lines.every((line) => !line.dataset.delivery)));
});

flow('chat: a Korean word and a name stay whole, on the narrowest phone', async (t) => {
  const a = await t.person('Ana', { viewport: { width: 320, height: 640 }, phone: true });
  const b = await t.person('Ben');
  const room = await startRoom(t, a, { url: golden.url });
  await joinRoom(b, room.url, { name: 'WWWWWWWWWW-WWWWWWWWWW-WWWWWWWWWW' });
  await sendChat(b.page, '잠깐만 간식 좀 챙겨올게요 ㅋㅋㅋㅋ 5분만 기다려줘 '.repeat(4).trim());
  await sendChat(b.page, 'ㅋ'.repeat(120));
  await openTab(a.page, 'Chat');
  const lines = ui.chatLog(a.page).locator('p');
  await t.see('the long laugh', lines.filter({ hasText: 'ㅋㅋㅋㅋㅋㅋㅋㅋ' }));
  const measured = await lines.filter({ hasText: '기다려줘' }).evaluate((line) => {
    const countRows = (rects) => new Set([...rects].map((rect) => Math.round(rect.top))).size;
    const text = [...line.childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
    const words = [...text.textContent.matchAll(/\S+/g)];
    const cut = (word) => {
      const range = document.createRange();
      range.setStart(text, word.index);
      range.setEnd(text, word.index + word[0].length);
      return countRows(range.getClientRects()) > 1;
    };
    const name = countRows(line.querySelector('span').getClientRects());
    // Where a word lands depends on the width, so one width could miss it by luck.
    const split = new Set();
    for (let width = 160; width <= 288; width += 8) {
      line.style.width = `${width}px`;
      for (const word of words) if (cut(word)) split.add(`${word[0]} at ${width}`);
    }
    line.style.width = '';
    return { name, split: [...split] };
  });
  t.eq('the name stays on one line', measured.name, 1);
  t.eq('no Korean word is cut in half', measured.split.slice(0, 3).join(', '), '');
  const laugh = lines.filter({ hasText: 'ㅋㅋㅋㅋㅋㅋㅋㅋ' });
  t.check('a word with no spaces still wraps', await laugh.evaluate((line) => line.scrollWidth <= line.clientWidth && line.getBoundingClientRect().height > 40));
});

flow('chat: Send only works with something to send', async (t) => {
  const { a } = await pair(t);
  const send = a.page.getByRole('button', { name: 'Send' });
  t.check('disabled when empty', await send.isDisabled());
  await ui.chatBox(a.page).fill('    ');
  t.check('disabled for spaces', await send.isDisabled());
  await ui.chatBox(a.page).press('Enter');
  t.eq('nothing sent', await ui.chatLog(a.page).getByText('You', { exact: true }).count(), 0);
  await ui.chatBox(a.page).fill('by button');
  await send.click();
  await t.see('the line', ui.chatLog(a.page).getByText('by button'));
});

flow('chat: the box counts down near 500 and stops there', async (t) => {
  const { a, b } = await pair(t);
  await ui.chatBox(a.page).fill('x'.repeat(460));
  await t.see('the count', a.page.getByText('40 left'));
  await ui.chatBox(a.page).pressSequentially('y'.repeat(60), { delay: 0 });
  t.eq('it stops at 500', (await ui.chatBox(a.page).inputValue()).length, 500);
  await ui.chatBox(a.page).press('Enter');
  await t.see('Ben gets all of it', ui.chatLog(b.page).getByText(`${'x'.repeat(460)}${'y'.repeat(40)}`));
});

flow('chat: code stays text, links are links, and they open away from the room', async (t) => {
  const { a, b } = await pair(t);
  await sendChat(a.page, '<img src=x onerror=window.__xss=1> <b>bold</b> see https://example.com/a?b=1, ok');
  await t.see('the raw text', ui.chatLog(b.page).getByText('<b>bold</b>', { exact: false }));
  t.check('no script ran', !(await b.page.evaluate(() => window.__xss)));
  const link = ui.chatLog(b.page).getByRole('link', { name: 'https://example.com/a?b=1' });
  await t.see('the link, without its comma', link);
  t.eq('opens elsewhere', await link.getAttribute('target'), '_blank');
  t.check('with no way back', /noopener/.test(await link.getAttribute('rel')));
});

flow('chat: history is there for whoever arrives or reloads', async (t) => {
  const { a, b, room } = await pair(t);
  await sendChat(a.page, 'said before Cal came');
  await t.see('sent', ui.chatLog(b.page).getByText('said before Cal came'));
  const c = await t.person('Cal');
  await joinRoom(c, room.url);
  await t.see('Cal can read it', ui.chatLog(c.page).getByText('said before Cal came'));
  t.check('history is not unread', !(await ui.tab(c.page, 'Chat').getByText(/unread/).isVisible()));
  await a.page.reload();
  await reenter(a.page);
  await t.see('Ana keeps it', ui.chatLog(a.page).getByText('said before Cal came'));
  t.eq('and only once', await ui.chatLog(a.page).getByText('said before Cal came').count(), 1);
});

flow('chat: unread shows on the tab and the title, and clears on reading', async (t) => {
  const { a, b } = await pair(t);
  await openTab(b.page, 'Queue');
  await sendChat(a.page, 'one');
  await sendChat(a.page, 'two');
  await t.see('a count on the tab', ui.tab(b.page, 'Chat').getByText('2'));
  await t.until('and in the title', async () => (await b.page.title()).startsWith('(2)'));
  await openTab(b.page, 'Chat');
  await t.gone('the count', ui.tab(b.page, 'Chat').getByText('2'));
  await t.until('the title clears', async () => !(await b.page.title()).startsWith('('));
});

flow('chat: reading back is left alone, and a pill brings you down', async (t) => {
  const { a, b } = await pair(t);
  await b.page.setViewportSize({ width: 1440, height: 500 });
  for (let i = 0; i < 12; i += 1) {
    await sendChat(a.page, `line ${i} ${'padding '.repeat(20)}`);
    await t.sleep(520);
  }
  await t.see('the last line', ui.chatLog(b.page).getByText('line 11'));
  await t.until('Ben stays at the bottom', () => ui.chatLog(b.page).evaluate((log) => log.scrollHeight - log.scrollTop - log.clientHeight < 10));
  await ui.chatLog(b.page).evaluate((log) => { log.scrollTop = 0; });
  await t.sleep(200);
  await sendChat(a.page, 'while you were reading');
  await t.see('the pill', b.page.getByRole('button', { name: /new messages/i }));
  t.eq('Ben stays put', await ui.chatLog(b.page).evaluate((log) => log.scrollTop), 0);
  await b.page.getByRole('button', { name: /new messages/i }).click();
  await t.gone('the pill', b.page.getByRole('button', { name: /new messages/i }));
  await t.until('down at the end', () => ui.chatLog(b.page).evaluate((log) => log.scrollHeight - log.scrollTop - log.clientHeight < 10));
  await ui.chatLog(b.page).evaluate((log) => { log.scrollTop = 0; });
  await t.sleep(200);
  await sendChat(b.page, 'my own line brings me down');
  await t.until('your own line scrolls you down', () => ui.chatLog(b.page).evaluate((log) => log.scrollHeight - log.scrollTop - log.clientHeight < 10));
});

flow('chat: sending too fast keeps the words and says to slow down', async (t) => {
  const { a, b } = await pair(t);
  let refused = false;
  for (let i = 0; i < 12 && !refused; i += 1) {
    await sendChat(a.page, `fast ${i}`);
    refused = await a.page.getByText(/slow down/i).isVisible();
    if (!refused) await t.sleep(10);
  }
  await t.see('the warning', a.page.getByText(/slow down a little.*still here/i));
  const kept = await ui.chatBox(a.page).inputValue();
  t.check('the refused line is back in the box', /^fast \d+$/.test(kept), kept);
  await t.sleep(2600);
  await ui.chatBox(a.page).press('Enter');
  await t.see('it goes through after a pause', ui.chatLog(b.page).getByText(kept, { exact: true }));
  await t.gone('the warning', a.page.getByText(/slow down/i));
  await t.until('Ben has it once', async () => (await ui.chatLog(b.page).getByText(kept, { exact: true }).count()) === 1);
});

flow('chat: a line that gets no answer offers Retry and Remove', async (t) => {
  const { a, b } = await pair(t);
  await a.page.evaluate(() => { window.__net.deaf = true; });
  await sendChat(a.page, 'into the void');
  await t.see('dimmed then failed', ui.chatLog(a.page).getByText(/not sent/i), 7000);
  await a.page.evaluate(() => { window.__net.deaf = false; });
  await ui.chatLog(a.page).getByRole('button', { name: 'Retry' }).click();
  await t.see('Ben gets it', ui.chatLog(b.page).getByText('into the void'));
  await t.gone('the failure', ui.chatLog(a.page).getByText(/not sent/i));
  await t.sleep(1000); // Ana's answer can trail Ben's copy, and going deaf now would lose it.
  await a.page.evaluate(() => { window.__net.deaf = true; });
  await sendChat(a.page, 'changed my mind');
  await t.see('failed again', ui.chatLog(a.page).getByText(/not sent/i), 7000);
  await a.page.evaluate(() => { window.__net.deaf = false; });
  await ui.chatLog(a.page).getByRole('button', { name: /remove/i }).click();
  await t.gone('the line', ui.chatLog(a.page).getByText('changed my mind'));
  await t.sleep(600);
  t.eq('Ben never saw it', await ui.chatLog(b.page).getByText('changed my mind').count(), 0);
});

flow('chat: a line that did arrive is not sent twice after a dropped answer', async (t) => {
  const { a, b } = await pair(t);
  await a.page.evaluate(() => { window.__net.ignoring = true; });
  await sendChat(a.page, 'heard but unanswered');
  await t.see('Ben has it', ui.chatLog(b.page).getByText('heard but unanswered'));
  await t.see('Ana thinks it failed', ui.chatLog(a.page).getByText(/not sent/i), 7000);
  await a.page.evaluate(() => {
    window.__net.ignoring = false;
    window.__net.cut();
  });
  await t.gone('the failure, once history says it landed', ui.chatLog(a.page).getByText(/not sent/i), 8000);
  t.eq('one line for Ana', await ui.chatLog(a.page).getByText('heard but unanswered').count(), 1);
  t.eq('one line for Ben', await ui.chatLog(b.page).getByText('heard but unanswered').count(), 1);
});

flow('reactions: the bar sends to everyone, in the rail, with a name', async (t) => {
  const { a, b } = await pair(t);
  await react(a.page, '🔥');
  await t.see('Ben sees it', ui.rail(b.page).getByText('🔥'));
  await t.see('with the name', ui.rail(b.page).getByText('Ana', { exact: true }));
  await t.see('Ana sees it too', ui.rail(a.page).getByText('🔥'));
  await t.gone('it fades', ui.rail(b.page).getByText('🔥'), 5000);
});

flow('reactions: the picker opens by the chat box on a smaller window', async (t) => {
  const a = await t.person('Ana', { viewport: { width: 1100, height: 800 } });
  const b = await t.person('Ben');
  const room = await startRoom(t, a, { url: golden.url });
  await joinRoom(b, room.url);
  await a.page.getByRole('button', { name: 'Send a reaction' }).click();
  await a.page.getByRole('button', { name: 'React 😂' }).click();
  await t.see('Ben sees it', ui.rail(b.page).getByText('😂'));
  await a.page.keyboard.press('Escape');
  await t.gone('Esc closes it', a.page.getByRole('button', { name: 'React 😂' }));
  await a.page.getByRole('button', { name: 'Send a reaction' }).click();
  await t.see('open again', a.page.getByRole('button', { name: 'React 😂' }));
  await ui.bar(a.page).click();
  await t.gone('a click away closes it', a.page.getByRole('button', { name: 'React 😂' }));
});

flow('reactions: a burst is capped and hurts nothing', async (t) => {
  const { a, b } = await pair(t);
  for (let i = 0; i < 25; i += 1) await react(a.page, '🔥');
  await sendChat(a.page, 'still talking');
  await t.see('chat is unharmed', ui.chatLog(b.page).getByText('still talking'));
});

flow('rename: Edit changes the name for everyone, and it sticks', async (t) => {
  const { a, b, room } = await pair(t);
  await openTab(a.page, 'People');
  await openTab(b.page, 'People');
  const row = (page, name) => ui.rail(page).getByRole('listitem').filter({ hasText: name });
  await row(a.page, 'Ana').getByRole('button', { name: 'Rename' }).click();
  const box = a.page.getByRole('textbox', { name: 'Your name' });
  t.eq('it starts from the current name', await box.inputValue(), 'Ana');
  await box.fill('아나 🌸');
  await box.press('Enter');
  await t.see('Ana sees it', row(a.page, '아나 🌸'));
  await t.see('Ben sees it', row(b.page, '아나 🌸'));
  await openTab(a.page, 'Chat');
  await sendChat(a.page, 'new name');
  await openTab(b.page, 'Chat');
  await t.see('the next line uses it', ui.chatLog(b.page).getByText('아나', { exact: true }));
  await a.page.reload();
  await reenter(a.page);
  await openTab(a.page, 'People');
  await t.see('it survives a reload', row(a.page, '아나 🌸'));
  void room;
});

flow('rename: blanks are refused and Esc walks away', async (t) => {
  const { a } = await pair(t);
  await openTab(a.page, 'People');
  await ui.rail(a.page).getByRole('button', { name: 'Rename' }).click();
  const box = a.page.getByRole('textbox', { name: 'Your name' });
  await box.fill('   ');
  await box.press('Enter');
  await t.see('the refusal', a.page.getByRole('alert').getByText(/can.t be empty/i));
  await box.fill('Nope');
  await box.press('Escape');
  await t.gone('the editor', box);
  await t.see('the old name', ui.rail(a.page).getByRole('listitem').filter({ hasText: 'Ana' }));
});

flow('rename: a host rename reaches the status line and the queue credit', async (t) => {
  const { a, b } = await pair(t);
  await openTab(a.page, 'People');
  await ui.rail(a.page).getByRole('button', { name: 'Rename' }).click();
  await a.page.getByRole('textbox', { name: 'Your name' }).fill('Annie');
  await a.page.getByRole('textbox', { name: 'Your name' }).press('Enter');
  await t.see('saved', ui.rail(a.page).getByRole('listitem').filter({ hasText: 'Annie' }));
  await a.page.evaluate(() => window.__yt.pauseVideo());
  await t.see('Ben sees the new name', ui.bar(b.page).getByText('Paused by Annie'));
});
