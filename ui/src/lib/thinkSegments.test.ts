import { describe, expect, it } from 'vitest'
import { hasModelThinking, parseModelThinkingSegments } from './thinkSegments'

describe('model thinking segments', () => {
  it('splits closed think blocks from visible answer text', () => {
    expect(parseModelThinkingSegments('<think>plan</think>answer')).toEqual([
      { kind: 'think', content: 'plan', closed: true },
      { kind: 'text', content: 'answer' }
    ])
  })

  it('marks open think blocks as streaming', () => {
    expect(parseModelThinkingSegments('before <thinking>\nworking')).toEqual([
      { kind: 'text', content: 'before ' },
      { kind: 'think', content: 'working', closed: false }
    ])
  })

  it('ignores think-looking tags inside fenced code blocks', () => {
    const input = '```xml\n<think>not reasoning</think>\n```\nfinal'
    expect(hasModelThinking(input)).toBe(true)
    expect(parseModelThinkingSegments(input)).toEqual([{ kind: 'text', content: input }])
  })
})
