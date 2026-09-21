import { randomUUID } from "node:crypto";
import { normalizeContent } from "./normalizer.js";

export function extractEvidence(source, query, { maxExcerpts = 6, maxChars = 1_200 } = {}) {
  const content = normalizeContent(source.content);
  if (!content) return [];
  const terms = tokenize(query);
  const sentences = splitSentences(content);
  const ranked = sentences.map((sentence, index) => ({
    sentence,index,
    score: terms.reduce((sum, term) => sum + (sentence.toLowerCase().includes(term) ? 1 : 0), 0),
  }))
    .filter((item) => item.score > 0)
    .sort((a,b)=>b.score-a.score||a.index-b.index)
    .slice(0,maxExcerpts);

  const selected = ranked.length ? ranked : sentences.slice(0, Math.min(maxExcerpts, sentences.length)).map((sentence,index)=>({sentence,index,score:0}));
  return selected.map((item) => {
    const excerpt = item.sentence.slice(0,maxChars);
    const startOffset = content.indexOf(item.sentence);
    return {
      id: randomUUID(),
      sourceId: source.id,
      evidenceType: item.score ? "query_match" : "context",
      excerpt,
      startOffset: startOffset >= 0 ? startOffset : null,
      endOffset: startOffset >= 0 ? startOffset + excerpt.length : null,
      locator: startOffset >= 0 ? "text-offset:" + startOffset : null,
      extractionBasis: item.score ? "deterministic_keyword_sentence_match" : "deterministic_leading_context",
    };
  });
}

function tokenize(text) {
  return [...new Set(String(text??"").toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])].slice(0,20);
}
function splitSentences(text) {
  return String(text??"").split(/(?<=[.!?。！？])\s+/).map((x)=>x.trim()).filter(Boolean);
}
