// @ts-check
// «Я и Книга»'s answer in words: a generative model is given the paragraphs the search by meaning found and the
// reader's question, and answers from them alone — to the point, in plain spoken language, each thought with its
// paragraph's number (any answer checked against the text in one tap). Not as the Book speaking of itself: no
// "I", no "in me" — the book is not made out to be a mind (the author's word, 2026-10-22).

/**
 * The rules, per the question's language (the book's languages: more to come — the English then). A reader may
 * write their own in place of them (server/bookwords.js: rulesOf).
 */
export const RULES = {
  ru: `Ответь на вопрос читателя по существу, только по приведённым абзацам Книги Урантии. Ничего не добавляй от себя и не выдумывай.
Не говори от лица книги: никаких «я», «во мне», «книга говорит» — просто отвечай на вопрос.
Пиши разговорным, живым языком, как человек, который хорошо знает книгу: 2–5 предложений, по-русски. После каждой мысли укажи номер абзаца в скобках, например (47:2.7).
Если в абзацах есть только близкое к вопросу — коротко скажи, что прямого ответа нет, и что есть близкого, тоже с номерами.
Если по вопросу в абзацах ничего нет, ответь одной фразой: «Такой информации нет.»
Это разговор: если вопрос продолжает или уточняет прежний («а подробнее?», «что это значит?», «расскажи про второе»), он о твоём прошлом ответе — отвечай в его контексте, прежде всего по абзацам, на которые ты опирался; остальные абзацы бери, только если они о том же.`,
  en: `Answer the reader's question to the point, only from the paragraphs of The Urantia Book given. Add nothing of your own and invent nothing.
Do not speak as the book: no "I", no "in me", no "the book says" — just answer the question.
Write in plain, spoken English, as someone who knows the book well: 2–5 sentences. After each thought give the paragraph's number in brackets, e.g. (47:2.7).
If the paragraphs hold only something close to the question, say briefly that there is no direct answer, and what is close, with the numbers too.
If the paragraphs hold nothing on the question, answer in one sentence: "There is no such information."
This is a conversation: if the question goes on from or asks more of an earlier one ("more?", "what does it mean?", "tell about the second"), it is about your last answer — answer in its context, first of all from the paragraphs you drew on; take the others only if they are about the same.`,
};

/** The question's language: the Cyrillic — Russian, else English. @param {string} text @returns {'ru' | 'en'} */
export const langOf = (text) => (/[а-яё]/i.test(text) ? 'ru' : 'en');

/**
 * The conversation for the model: the rules, the talk so far (`history`: the reader's questions and the answers,
 * oldest first), then the paragraphs (in the question's language) and the question. `own`: a reader's own rules
 * (one text for both languages: an English question is answered in English all the same).
 * @param {string} question @param {{ ref: string, text: string }[]} paragraphs
 * @param {{ role: 'user' | 'assistant', content: string }[]} [history] @param {string | null} [own]
 */
export function messagesFor(question, paragraphs, history = [], own = null) {
  const lang = langOf(question);
  const head = lang === 'ru' ? ['Абзацы:', 'Вопрос:'] : ['Paragraphs:', 'Question:'];
  const rules = own ? (lang === 'en' ? `${own}\nAnswer in English.` : own) : RULES[lang];
  return [
    { role: 'system', content: rules },
    ...history,
    { role: 'user', content: `${head[0]}\n${paragraphs.map((p) => `[${p.ref}] ${p.text}`).join('\n\n')}\n\n${head[1]} ${question}` },
  ];
}

/** How long an answer may be (tokens): 2–5 sentences with their numbers fit; a run-on one is cut. */
export const MAX_TOKENS = 320;
