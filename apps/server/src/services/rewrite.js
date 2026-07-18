import { Configuration, DashscopeApi } from 'dashscope-sdk-official'

function getDashscopeClient() {
  const apiKey = String(process.env.BAILIAN_API_KEY || '').trim()

  if (!apiKey) {
    throw new Error('未配置百炼 API Key，无法调用改写模型。')
  }

  return new DashscopeApi(
    new Configuration({
      apiKey
    })
  )
}

function getRewriteModel() {
  return String(process.env.BAILIAN_REWRITE_MODEL || 'qwen3.7-max').trim()
}

function getDefaultRequirement(rewriteRequirement) {
  return String(rewriteRequirement || '').trim() || '无特殊要求，请按“意思相近、低重复率、篇幅接近原文”的原则改写。'
}

function buildRewriteMessages({ rewriteRequirement, sourceCopy }) {
  const requirement = getDefaultRequirement(rewriteRequirement)

  return [
    {
      role: 'system',
      content:
        '你是一名短视频口播文案改写助手。你的任务是保持原文核心意思、表达目的、情绪节奏和大致篇幅，在尽量降低重复率的前提下完成改写。只输出改写后的最终文案，不要输出分析、标题、说明、分点、括号提示或任何额外内容。'
    },
    {
      role: 'user',
      content: `请根据下面的信息改写短视频口播文案。

改写要求：
${requirement}

原始口播文案：
${String(sourceCopy || '').trim()}`
    }
  ]
}

function extractMessageTextFromContent(content) {
  if (typeof content === 'string') {
    return content
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') {
          return item
        }

        if (typeof item?.text === 'string') {
          return item.text
        }

        return ''
      })
      .join('')
  }

  if (typeof content?.text === 'string') {
    return content.text
  }

  return ''
}

function extractGenerationText(result) {
  const outputText = typeof result?.output?.text === 'string' ? result.output.text : ''

  if (outputText) {
    return outputText
  }

  const messageContent = result?.output?.choices?.[0]?.message?.content
  const messageText = extractMessageTextFromContent(messageContent)

  if (messageText) {
    return messageText
  }

  const plainMessageText = typeof result?.output?.choices?.[0]?.message?.text === 'string'
    ? result.output.choices[0].message.text
    : ''

  return plainMessageText
}

function normalizeText(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .trim()
}

export async function rewriteCopyByRequirement({ rewriteRequirement, sourceCopy }) {
  const cleanSourceCopy = String(sourceCopy || '').trim()

  if (!cleanSourceCopy) {
    throw new Error('原始口播文案不能为空。')
  }

  const client = getDashscopeClient()
  const result = await client.createGeneration({
    model: getRewriteModel(),
    messages: buildRewriteMessages({
      rewriteRequirement,
      sourceCopy: cleanSourceCopy
    }),
    result_format: 'message',
    temperature: 0.85,
    top_p: 0.9,
    max_tokens: 2048,
    enable_thinking: false
  })

  if (result?.code) {
    throw new Error(result.message || result.code)
  }

  const rewrittenCopy = normalizeText(extractGenerationText(result))

  if (!rewrittenCopy) {
    throw new Error('改写模型已返回结果，但没有解析出有效文案。')
  }

  return {
    rewrittenCopy,
    model: getRewriteModel(),
    requestId: result?.request_id || ''
  }
}

export async function* streamRewriteCopyByRequirement({ rewriteRequirement, sourceCopy }) {
  const cleanSourceCopy = String(sourceCopy || '').trim()

  if (!cleanSourceCopy) {
    throw new Error('原始口播文案不能为空。')
  }

  const client = getDashscopeClient()
  const model = getRewriteModel()
  const stream = await client.createGeneration({
    model,
    messages: buildRewriteMessages({
      rewriteRequirement,
      sourceCopy: cleanSourceCopy
    }),
    stream: true,
    incremental_output: true,
    result_format: 'message',
    temperature: 0.85,
    top_p: 0.9,
    max_tokens: 2048,
    enable_thinking: false
  })

  let fullText = ''
  let requestId = ''

  for await (const chunk of stream) {
    if (chunk?.code) {
      throw new Error(chunk.message || chunk.code)
    }

    requestId = chunk?.request_id || requestId
    const deltaText = extractGenerationText(chunk)

    if (!deltaText) {
      continue
    }

    fullText += deltaText

    yield {
      type: 'delta',
      text: deltaText,
      accumulatedText: fullText,
      requestId,
      model
    }
  }

  const rewrittenCopy = normalizeText(fullText)

  if (!rewrittenCopy) {
    throw new Error('改写模型流式返回完成，但没有得到有效文案。')
  }

  yield {
    type: 'done',
    rewrittenCopy,
    requestId,
    model
  }
}
