import { describe, expect, it } from 'vitest'
import {
  collectNarrationCallIds,
  recomputeAnswerContent,
  shouldAppendEventContent
} from './streamEvents'
import type { StreamEvent } from '@/api/types'

const event = (patch: Partial<StreamEvent>): StreamEvent => ({
  type: 'content',
  round: 0,
  content: '',
  metadata: {},
  ...patch
})

describe('stream event helpers', () => {
  it('appends only answer content events', () => {
    expect(shouldAppendEventContent(event({ content: 'plain' }))).toBe(true)
    expect(
      shouldAppendEventContent(
        event({
          content: 'final',
          metadata: { call_id: 'c2', call_kind: 'llm_final_response' }
        })
      )
    ).toBe(true)
    expect(
      shouldAppendEventContent(
        event({
          type: 'tool_call',
          content: 'tool',
          metadata: { call_id: 'tool-1', call_kind: 'tool_call' }
        })
      )
    ).toBe(false)
  })

  it('filters narration calls out of the final answer', () => {
    const events: StreamEvent[] = [
      event({
        content: '我先检索一下。',
        metadata: { call_id: 'round-1', call_kind: 'agent_loop_round' }
      }),
      event({
        type: 'progress',
        content: 'round complete',
        metadata: { call_id: 'round-1', call_state: 'complete', has_tool_calls: true }
      }),
      event({
        content: '最终答案',
        metadata: { call_id: 'final-1', call_kind: 'llm_final_response' }
      })
    ]

    expect(collectNarrationCallIds(events)).toEqual(new Set(['round-1']))
    expect(recomputeAnswerContent(events)).toBe('最终答案')
  })

  it('understands DeepTutor-style narration markers', () => {
    const events: StreamEvent[] = [
      event({
        content: 'Using tools...',
        metadata: { call_id: 'narration', call_kind: 'agent_loop_round' }
      }),
      event({
        type: 'progress',
        content: '',
        metadata: {
          call_id: 'narration',
          trace_kind: 'call_status',
          call_state: 'complete',
          call_role: 'narration'
        }
      }),
      event({
        content: 'Answer.',
        metadata: { call_id: 'answer', call_kind: 'llm_final_response' }
      })
    ]

    expect(collectNarrationCallIds(events)).toEqual(new Set(['narration']))
    expect(recomputeAnswerContent(events)).toBe('Answer.')
  })
})
