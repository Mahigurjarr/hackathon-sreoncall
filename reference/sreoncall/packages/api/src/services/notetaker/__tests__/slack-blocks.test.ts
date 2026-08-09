import { describe, it, expect } from 'vitest';
import { buildNotetakerSlackBlocks } from '../../notetaker.service';

function fakeSession(): any {
  return {
    _id: { toString: () => 'sess1' },
    tenant_id: { toString: () => 'ten1' },
    title: 'INC-0001 bridge call',
    summary: 'We fixed the checkout outage.',
    decisions: ['Roll back the TLS cert'],
    suggestions: [
      { _id: { toString: () => 'sg1' }, type: 'ticket', status: 'suggested', payload: { title: 'Add cert check', description: 'monitor expiry' } },
      { _id: { toString: () => 'sg2' }, type: 'runbook', status: 'accepted', payload: { title: 'Rotate cert' } },
    ],
  };
}

describe('buildNotetakerSlackBlocks', () => {
  it('renders header + summary + decisions, Accept/Dismiss buttons for pending, context for decided', () => {
    const blocks = buildNotetakerSlackBlocks(fakeSession());
    expect(blocks[0].type).toBe('header');

    const actions = blocks.find((b) => b.type === 'actions');
    expect(actions).toBeTruthy();
    const ids = actions.elements.map((e: any) => e.action_id);
    expect(ids).toEqual(['notetaker_suggestion_accept', 'notetaker_suggestion_dismiss']);

    // button value carries the routing ids
    expect(JSON.parse(actions.elements[0].value)).toMatchObject({
      session_id: 'sess1',
      suggestion_id: 'sg1',
      tenant_id: 'ten1',
    });

    // the already-accepted suggestion renders as a non-interactive context block
    const ctx = blocks.filter((b) => b.type === 'context');
    expect(ctx.length).toBe(1);
    expect(ctx[0].elements[0].text).toContain('Accepted');
  });

  it('emits no action blocks when there are no pending suggestions', () => {
    const s = fakeSession();
    s.suggestions = [{ _id: { toString: () => 'x' }, type: 'ticket', status: 'dismissed', payload: { title: 'x' } }];
    const blocks = buildNotetakerSlackBlocks(s);
    expect(blocks.find((b) => b.type === 'actions')).toBeFalsy();
  });
});
