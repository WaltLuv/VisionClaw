import {describe, expect, it} from 'vitest';
import {h, mount} from '../src/dom';

// Everything rendered through this helper may carry text written by a model, a
// website the employee read, an incoming message or another person's card. None
// of it is trusted, so the helper must have no path that interprets markup.
describe('h()', () => {
  it('renders markup in text as literal characters', () => {
    const el = h('p', {text: '<img src=x onerror=alert(1)>'});
    expect(el.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(el.querySelector('img')).toBeNull();
    expect(el.children).toHaveLength(0);
  });

  it('renders markup in children as literal characters', () => {
    const el = h('div', {}, '<script>alert(1)</script>');
    expect(el.querySelector('script')).toBeNull();
    expect(el.textContent).toBe('<script>alert(1)</script>');
  });

  it('renders a card title containing markup as text', () => {
    const el = h('h3', {text: '</h3><iframe src="javascript:alert(1)">'});
    expect(el.querySelector('iframe')).toBeNull();
    expect(el.textContent).toContain('<iframe');
  });

  it('attaches listeners from on* handlers rather than inline attributes', () => {
    let clicked = 0;
    const el = h('button', {onclick: () => {clicked++;}});
    el.click();
    expect(clicked).toBe(1);
    expect(el.getAttribute('onclick')).toBeNull();
  });

  it('sets plain attributes and skips undefined and false', () => {
    const el = h('input', {type: 'text', disabled: false, placeholder: undefined, 'aria-label': 'Name'});
    expect(el.getAttribute('type')).toBe('text');
    expect(el.hasAttribute('disabled')).toBe(false);
    expect(el.hasAttribute('placeholder')).toBe(false);
    expect(el.getAttribute('aria-label')).toBe('Name');
  });

  it('mount replaces previous content instead of appending to it', () => {
    const host = document.createElement('div');
    mount(host, h('p', {text: 'first'}));
    mount(host, h('p', {text: 'second'}));
    expect(host.children).toHaveLength(1);
    expect(host.textContent).toBe('second');
  });
});
