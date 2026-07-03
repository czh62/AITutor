import { describe, expect, it } from 'vitest'
import {
  getAnswerReviewKind,
  getOptionReviewTone,
  getQuizChipTone,
  getUnsubmittedSelectionTone,
} from './quiz-display'
import type { QuizAnswerState, QuizQuestion } from '@/api/types'

const submitted = (patch: Partial<QuizAnswerState>): QuizAnswerState => ({
  selected: null,
  typed: '',
  submitted: true,
  ...patch,
})

const conceptQuestion: QuizQuestion = {
  question_id: 'q1',
  question: 'React 是声明式 UI 库。',
  question_type: 'concept',
  difficulty: 'easy',
  options: null,
  correct_answer: 'true',
  explanation: 'React encourages declarative UI.',
  topic: 'React',
}

const writtenQuestion: QuizQuestion = {
  question_id: 'q2',
  question: '解释闭包。',
  question_type: 'written',
  difficulty: 'medium',
  options: null,
  correct_answer: '略',
  explanation: '略',
  topic: 'JavaScript',
}

const fillBlankQuestion: QuizQuestion = {
  question_id: 'q3',
  question: '在DERL框架中，智能体在生命周期内通过____来学习智能行为。',
  question_type: 'fill_in_blank',
  difficulty: 'easy',
  options: null,
  correct_answer: '强化学习',
  explanation: 'DERL框架使用强化学习（Reinforcement Learning）学习智能行为。',
  topic: 'DERL',
}

describe('quiz display state', () => {
  it('uses blue for the active question chip regardless of submitted correctness', () => {
    expect(getQuizChipTone({ isActive: true, question: conceptQuestion, answer: submitted({ selected: 'true' }) })).toBe('active')
  })

  it('uses blue for a selected answer before submission', () => {
    expect(getUnsubmittedSelectionTone({ isSelected: true })).toBe('selected')
  })

  it('marks a wrong submitted concept answer red and the correct answer green', () => {
    const answer = submitted({ selected: 'false' })

    expect(getOptionReviewTone({ question: conceptQuestion, answer, optionKey: 'false' })).toBe('incorrect-selected')
    expect(getOptionReviewTone({ question: conceptQuestion, answer, optionKey: 'true' })).toBe('correct')
  })

  it('treats subjective submitted answers as requiring AI judgment', () => {
    expect(getAnswerReviewKind(writtenQuestion, submitted({ typed: '闭包会捕获词法作用域。' }))).toBe('needs-ai')
  })

  it('sends non-exact fill-in-blank answers to AI judgment instead of marking them wrong', () => {
    expect(getAnswerReviewKind(fillBlankQuestion, submitted({ typed: 'RL' }))).toBe('needs-ai')
    expect(getQuizChipTone({ isActive: false, question: fillBlankQuestion, answer: submitted({ typed: 'RL' }) })).toBe('submitted')
  })

  it('updates AI-judged fill-in-blank answers from the judgment verdict', () => {
    const answer = submitted({ typed: 'RL' })
    const judgment = { text: '✅ 正确。RL 是 Reinforcement Learning 的常用缩写。', isStreaming: false, error: null }

    expect(getAnswerReviewKind(fillBlankQuestion, answer, judgment)).toBe('correct')
    expect(getQuizChipTone({ isActive: false, question: fillBlankQuestion, answer, judgment })).toBe('correct')
  })

  it('updates AI-judged subjective answers from partial and incorrect verdicts', () => {
    const answer = submitted({ typed: '闭包会捕获作用域，但没有说明函数返回后仍可访问。' })

    expect(getAnswerReviewKind(writtenQuestion, answer, {
      text: '⚠️ 部分正确。回答提到了作用域，但缺少生命周期说明。',
      isStreaming: false,
      error: null,
    })).toBe('partial')
    expect(getAnswerReviewKind(writtenQuestion, answer, {
      text: '❌ 不正确。这个回答没有解释闭包。',
      isStreaming: false,
      error: null,
    })).toBe('incorrect')
  })
})
