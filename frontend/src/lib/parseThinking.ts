export interface ParsedThinking {
  thinking: string
  body: string
  thinkingClosed: boolean
}

export function parseThinking(content: string): ParsedThinking {
  const openTag = '<think>'
  const closeTag = '</think>'
  const start = content.indexOf(openTag)

  if (start === -1) {
    return {
      thinking: '',
      body: content,
      thinkingClosed: true
    }
  }

  const thinkingStart = start + openTag.length
  const end = content.indexOf(closeTag, thinkingStart)

  if (end === -1) {
    return {
      thinking: content.slice(thinkingStart).trim(),
      body: content.slice(0, start).trim(),
      thinkingClosed: false
    }
  }

  return {
    thinking: content.slice(thinkingStart, end).trim(),
    body: `${content.slice(0, start)}${content.slice(end + closeTag.length)}`.trim(),
    thinkingClosed: true
  }
}
