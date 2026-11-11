// SPDX-License-Identifier: Apache-2.0
// Ordinary buttons keep the workshop usable with keyboard, pointer and ControllerMenu.
export function mountModMenu(packs, mods, open, close) {
  const section = document.createElement('section'); section.id = 'workshop'; section.className = 'overlay'; section.hidden = true;
  const panel = document.createElement('div'); panel.className = 'panel mod-panel'; section.append(panel);
  const element = (tag, text, parent = panel) => { const e = document.createElement(tag); e.textContent = text; parent.append(e); return e; };
  element('h2', 'Mods & modes');
  element('p', 'Choose an installed local pack. Each pack version and mode has a separate save. Switching reloads the game.');
  const choose = (label, id, mode = 'campaign') => {
    const b = element('button', label); b.dataset.profile = `${id}/${mode}`;
    b.addEventListener('click', () => {
      const url = new URL(location.href); url.searchParams.delete('mod'); url.searchParams.delete('mode');
      if (id !== 'vanilla') { url.searchParams.set('mod', id); url.searchParams.set('mode', mode); }
      location.assign(url.href);
    });
  };
  choose('Original campaign', 'vanilla');
  for (const pack of packs) {
    element('h3', `${pack.title} · ${pack.version}`); element('p', pack.description);
    choose(`${pack.title} — Campaign`, pack.id);
    for (const mode of pack.modes ?? []) { choose(mode.title, pack.id, mode.id); element('p', mode.description).className = 'small'; }
  }
  const back = element('button', 'Back'); back.dataset.close = ''; back.addEventListener('click', close);
  document.body.append(section);
  const button = document.createElement('button'); button.id = 'btn-mods'; button.textContent = 'Mods & modes'; button.addEventListener('click', open);
  document.querySelector('.menu-buttons').append(button);
  const status = document.createElement('p'); status.id = 'mod-profile'; status.className = 'small';
  status.textContent = mods.pack ? `${mods.pack.title} · ${mods.mode.title} · API 1` : 'Original campaign · local mod packs available';
  document.querySelector('.menu-card').append(status);
  return section;
}
