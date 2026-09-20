import {h} from '../dom';
import {cameraSection, sendTask} from './today';
import type {Ctx} from './ctx';

/**
 * The camera on its own, for when showing something is the whole point: point
 * the phone at a problem and ask about it. It is the same panel as on Today,
 * not a second copy, so freeze, flip and capture behave identically.
 */
export function camera(ctx: Ctx): HTMLElement {
  const question = h('textarea', {class: 'composer', rows: 2, placeholder: 'What do you want to know about this?', 'aria-label': 'What do you want to know about this?'});
  const ask = h('button', {class: 'primary', disabled: ctx.busy}, ctx.busy ? 'Sending…' : 'Ask about this');
  ask.addEventListener('click', () => {
    const text = question.value.trim();
    if (!text) {ctx.toast('Type what you want to know first.'); return;}
    question.value = '';
    // The photo goes with it: the capture control attaches the frame, and this
    // carries the question that frame is about.
    void sendTask(ctx, text);
  });

  return h('div', {class: 'screen'},
    cameraSection(ctx, (task, visual) => sendTask(ctx, task, visual)),
    h('section', {class: 'card'},
      h('h3', {text: 'Ask about what you see'}),
      h('p', {class: 'note', text: 'Send a photo first, then ask. The employee answers about the picture you sent.'}),
      question,
      h('div', {class: 'row'}, ask),
    ),
  );
}
