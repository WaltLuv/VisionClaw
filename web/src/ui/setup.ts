import {h} from '../dom';
import {employee} from './employee';
import {settings} from './settings';
import type {Ctx} from './ctx';

/**
 * Everything that is configuration rather than work, on one screen behind the
 * gear. Two screens of settings made the app look like it had four jobs; it has
 * one. Connection status comes first because that is what someone checks when
 * something is not working, then who the agent is and what it knows.
 */
export function setup(ctx: Ctx): HTMLElement {
  const screen = h('div', {class: 'screen'});
  for (const source of [settings(ctx), employee(ctx)]) {
    while (source.firstChild) screen.append(source.firstChild);
  }
  return screen;
}
