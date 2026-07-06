/**
 * quiz-grading.ts — 自动判题纯函数。
 *
 * choice/concept/fill_in_blank 可自动判题（客户端确定性判定），
 * short_answer/written/coding 需要 AI 判题。
 *
 * 参考 DeepTutor 的 quiz-question-type.ts 和 QuizViewer.tsx 中的判定逻辑，
 * 适配 AITutor 的 QuizQuestion 结构。
 */

import type { QuizQuestion, QuizQuestionType, QuizAnswerState, QuizJudgmentState } from '@/api/types'

/**
 * 判断题型是否可自动判题。
 * choice、concept、fill_in_blank 为确定性判定，不需要 AI。
 */
export function isAutoGradable(questionType: QuizQuestionType): boolean {
  return questionType === 'choice' || questionType === 'concept' || questionType === 'fill_in_blank'
}

/**
 * 从作答状态中提取用户答案文本。
 * choice/concept 用 selected 字段（选项键），其余用 typed 字段。
 */
export function getUserAnswer(question: QuizQuestion, answer: QuizAnswerState): string {
  if (question.question_type === 'choice' || question.question_type === 'concept') {
    return answer.selected ?? ''
  }
  return answer.typed.trim()
}

/**
 * 判断用户答案是否正确（客户端确定性判定）。
 *
 * - choice: 大写匹配选项键（A/B/C/D），也兼容完整文本匹配
 * - concept: 规范化为 true/false 再比较
 * - fill_in_blank: 小写精确匹配
 * - 非自动判题类型返回 false（需要 AI 判题）
 */
export function isAnswerCorrect(question: QuizQuestion, answer: QuizAnswerState): boolean {
  const userAnswer = getUserAnswer(question, answer)
  if (!userAnswer) return false
  const correct = question.correct_answer.trim()

  if (question.question_type === 'choice') {
    const correctKey = resolveChoiceAnswerKey(correct, question.options)
    return (
      userAnswer.toUpperCase() === correctKey ||
      userAnswer.toUpperCase() === correct.toUpperCase() ||
      userAnswer.toUpperCase() === correct.charAt(0).toUpperCase()
    )
  }

  if (question.question_type === 'concept') {
    const correctTF = resolveConceptAnswer(correct)
    return userAnswer.toLowerCase() === correctTF
  }

  if (question.question_type === 'fill_in_blank') {
    return userAnswer.toLowerCase() === correct.toLowerCase()
  }

  // short_answer/written/coding — 无法自动判定
  return false
}

/**
 * 从正确答案文本中反推选择题的选项键。
 *
 * correct_answer 可能是 "A"、"A. xxx"、"xxx（选项文本）" 等格式，
 * 需要从 options 字典中找到对应的键。
 */
export function resolveChoiceAnswerKey(
  correctAnswer: string,
  options: Record<string, string> | null,
): string {
  // 先尝试直接匹配键（A/B/C/D）
  const trimmed = correctAnswer.trim()
  const firstChar = trimmed.charAt(0).toUpperCase()
  if (['A', 'B', 'C', 'D'].includes(firstChar) && options && firstChar in options) {
    return firstChar
  }

  // 尝试匹配选项文本内容
  if (options) {
    for (const [key, value] of Object.entries(options)) {
      if (value.trim().toLowerCase() === trimmed.toLowerCase()) {
        return key.toUpperCase()
      }
    }
  }

  // 兜底：取首字符
  return firstChar
}

/**
 * 将判断题的正确答案规范化为 "true" 或 "false"。
 *
 * correct_answer 可能是 "true"、"false"、"True"、"正确"、"错误" 等。
 */
export function resolveConceptAnswer(correctAnswer: string): string {
  const normalized = correctAnswer.trim().toLowerCase()
  if (normalized === 'true' || normalized === '正确' || normalized === '对') {
    return 'true'
  }
  if (normalized === 'false' || normalized === '错误' || normalized === '错') {
    return 'false'
  }
  return normalized
}

/**
 * 空作答状态的默认值。
 */
export const EMPTY_ANSWER: QuizAnswerState = {
  selected: null,
  typed: '',
  submitted: false,
}

/**
 * 空判词状态的默认值。
 */
export const EMPTY_JUDGMENT: QuizJudgmentState = {
  text: '',
  isStreaming: false,
  error: null,
}
