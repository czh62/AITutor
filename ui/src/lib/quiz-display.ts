import type { QuizAnswerState, QuizJudgmentState, QuizQuestion } from '@/api/types'
import {
  isAnswerCorrect,
  isAutoGradable,
  resolveChoiceAnswerKey,
  resolveConceptAnswer,
} from './quiz-grading'

export type QuizChipTone = 'active' | 'unanswered' | 'correct' | 'partial' | 'incorrect' | 'submitted'
export type SelectionTone = 'selected' | 'idle'
export type OptionReviewTone = 'correct-selected' | 'incorrect-selected' | 'correct' | 'idle'
export type AnswerReviewKind = 'correct' | 'partial' | 'incorrect' | 'needs-ai'

export function getQuizChipTone({
  isActive,
  question,
  answer,
  judgment,
}: {
  isActive: boolean
  question: QuizQuestion
  answer?: QuizAnswerState
  judgment?: QuizJudgmentState
}): QuizChipTone {
  if (isActive) return 'active'
  if (!answer?.submitted) return 'unanswered'
  if (question.question_type === 'fill_in_blank') {
    const reviewKind = getAnswerReviewKind(question, answer, judgment)
    return reviewKind === 'needs-ai' ? 'submitted' : reviewKind
  }
  if (!isAutoGradable(question.question_type)) {
    const reviewKind = getAnswerReviewKind(question, answer, judgment)
    return reviewKind === 'needs-ai' ? 'submitted' : reviewKind
  }
  return isAnswerCorrect(question, answer) ? 'correct' : 'incorrect'
}

export function getUnsubmittedSelectionTone({ isSelected }: { isSelected: boolean }): SelectionTone {
  return isSelected ? 'selected' : 'idle'
}

export function getAnswerReviewKind(
  question: QuizQuestion,
  answer: QuizAnswerState,
  judgment?: QuizJudgmentState,
): AnswerReviewKind {
  if (question.question_type === 'fill_in_blank') {
    if (isAnswerCorrect(question, answer)) return 'correct'
    return getAiJudgmentVerdict(judgment) ?? 'needs-ai'
  }
  if (!isAutoGradable(question.question_type)) return getAiJudgmentVerdict(judgment) ?? 'needs-ai'
  return isAnswerCorrect(question, answer) ? 'correct' : 'incorrect'
}

export function getAiJudgmentVerdict(judgment?: QuizJudgmentState): Exclude<AnswerReviewKind, 'needs-ai'> | null {
  const text = judgment?.text?.trim()
  if (!text || judgment?.isStreaming || judgment?.error) return null
  if (/❌|不正确|错误|incorrect/i.test(text)) return 'incorrect'
  if (/⚠️|部分正确|partially\s+correct|partial/i.test(text)) return 'partial'
  if (/✅|正确|correct/i.test(text)) return 'correct'
  return null
}

export function getOptionReviewTone({
  question,
  answer,
  optionKey,
}: {
  question: QuizQuestion
  answer: QuizAnswerState
  optionKey: string
}): OptionReviewTone {
  const correctKey = getCorrectOptionKey(question)
  const isCorrectOption = optionKey === correctKey
  const isUserSelected = answer.selected === optionKey

  if (isUserSelected && isCorrectOption) return 'correct-selected'
  if (isUserSelected && !isCorrectOption) return 'incorrect-selected'
  if (isCorrectOption) return 'correct'
  return 'idle'
}

export function getCorrectOptionKey(question: QuizQuestion): string {
  if (question.question_type === 'choice') {
    return resolveChoiceAnswerKey(question.correct_answer, question.options)
  }
  if (question.question_type === 'concept') {
    return resolveConceptAnswer(question.correct_answer)
  }
  return question.correct_answer
}
