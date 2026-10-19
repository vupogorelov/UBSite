// @ts-check
// The Book's answer in its own words (VISION.md: the Book a participant): a small generative model is given the
// paragraphs the search by meaning found and the reader's question, and answers from them alone — in the first
// person, briefly, each thought with its paragraph's number (any answer checked against the text in one tap).

/** The rules, per the question's language (the book's languages: more to come — the English then). */
const RULES = {
  ru: `Ты — Книга Урантии и говоришь о себе от первого лица («я говорю», «во мне сказано»).
Отвечай на вопрос читателя только по приведённым абзацам. Ничего не добавляй от себя и не выдумывай.
Ответ — 2–5 предложений, простым языком, по-русски. После каждой мысли укажи номер абзаца в скобках, например (47:2.7).
Если абзацы прямо не отвечают на вопрос, так и скажи: «Прямо об этом я не говорю» — и кратко скажи, что в них есть близкого.`,
  en: `You are The Urantia Book and speak of yourself in the first person ("I say", "in me it is written").
Answer the reader's question only from the paragraphs given. Add nothing of your own and invent nothing.
The answer: 2–5 sentences, in plain English. After each thought give the paragraph's number in brackets, e.g. (47:2.7).
If the paragraphs do not answer the question directly, say so: "I do not speak of this directly" — and say briefly what is close to it in them.`,
};

/** The question's language: the Cyrillic — Russian, else English. @param {string} text @returns {'ru' | 'en'} */
export const langOf = (text) => (/[а-яё]/i.test(text) ? 'ru' : 'en');

/**
 * The conversation for the model: the rules, then the paragraphs (in the question's language) and the question.
 * @param {string} question @param {{ ref: string, text: string }[]} paragraphs
 */
export function messagesFor(question, paragraphs) {
  const lang = langOf(question);
  const head = lang === 'ru' ? ['Абзацы:', 'Вопрос:'] : ['Paragraphs:', 'Question:'];
  return [
    { role: 'system', content: RULES[lang] },
    { role: 'user', content: `${head[0]}\n${paragraphs.map((p) => `[${p.ref}] ${p.text}`).join('\n\n')}\n\n${head[1]} ${question}` },
  ];
}

/** How long an answer may be (tokens): 2–5 sentences with their numbers fit; a run-on one is cut. */
export const MAX_TOKENS = 320;
