// Stage 7: generation. The only part of this app that leaves the machine.
//
// Groq, openai/gpt-oss-120b. The prompt is assembled here and returned to the
// UI verbatim alongside the answer, because "what exactly did you send the
// model?" is the question that makes RAG click, and most demos hide it.

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
export const MODEL = 'openai/gpt-oss-120b';

const SYSTEM_PROMPT = [
  'You answer questions about a Product Requirements Document using ONLY the numbered context chunks provided.',
  '',
  'Rules:',
  '- Cite the chunk you used inline, like [chunk 3]. Every factual sentence needs one.',
  '- If the context does not contain the answer, say exactly: "That is not in the retrieved context." Do not fall back on general knowledge.',
  '- Quote the document\'s own wording for specifics (numbers, timings, field names) rather than paraphrasing them.',
  '- Be concise. Three or four sentences unless asked for more.',
].join('\n');

/** Build the augmented prompt. Kept pure so the UI can render the real thing. */
export function buildPrompt(question, chunks) {
  const context = chunks
    .map((c, i) => `[chunk ${i + 1}] (page ${c.pages.join(', ') || '?'}, similarity ${c.similarity.toFixed(4)})\n${c.text}`)
    .join('\n\n---\n\n');

  const user = `Context:\n\n${context}\n\n---\n\nQuestion: ${question}`;
  return { system: SYSTEM_PROMPT, user, contextChars: context.length };
}

export async function generate(question, chunks, apiKey) {
  if (!apiKey) {
    const err = new Error('GROQ_API_KEY is not set. Add it to RAG_Explorer/.env and restart the server.');
    err.code = 'NO_KEY';
    throw err;
  }
  const prompt = buildPrompt(question, chunks);
  const t0 = Date.now();

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.2,
      max_tokens: 700,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`Groq returned ${res.status}: ${body.slice(0, 400)}`);
    err.code = 'GROQ_ERROR';
    err.status = res.status;
    throw err;
  }

  const json = await res.json();
  return {
    answer: json.choices?.[0]?.message?.content ?? '',
    model: MODEL,
    prompt,
    usage: json.usage ?? null,
    latencyMs: Date.now() - t0,
  };
}
