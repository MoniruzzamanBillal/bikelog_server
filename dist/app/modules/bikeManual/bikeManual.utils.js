"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scoreAndRankChunks = exports.tokenize = exports.chunkManualText = void 0;
const CHUNK_WORD_SIZE = 220;
const CHUNK_WORD_OVERLAP = 40;
const CHUNK_STEP = CHUNK_WORD_SIZE - CHUNK_WORD_OVERLAP;
const MAX_CHUNKS_PER_MANUAL = 500;
const STOPWORDS = new Set([
    "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "at", "for",
    "with", "by", "from", "is", "are", "was", "were", "be", "been", "being",
    "this", "that", "these", "those", "it", "its", "as", "if", "then", "than",
    "so", "such", "not", "no", "do", "does", "did", "will", "would", "can",
    "could", "should", "may", "might", "must", "have", "has", "had", "you",
    "your", "i", "we", "our", "they", "their", "he", "she", "his", "her", "them",
]);
// ! slides a 220-word window with 40-word overlap over the manual's normalized text;
// ! capped at 500 chunks to bound pathologically large PDFs
const chunkManualText = (rawText) => {
    const words = rawText.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
    const chunks = [];
    if (words.length === 0)
        return chunks;
    for (let start = 0; start < words.length; start += CHUNK_STEP) {
        const chunkWords = words.slice(start, start + CHUNK_WORD_SIZE);
        if (chunkWords.length === 0)
            break;
        chunks.push(chunkWords.join(" "));
        if (chunks.length >= MAX_CHUNKS_PER_MANUAL)
            break;
        if (start + CHUNK_WORD_SIZE >= words.length)
            break;
    }
    return chunks;
};
exports.chunkManualText = chunkManualText;
const tokenize = (text) => {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((token) => token.length > 1 && !STOPWORDS.has(token));
};
exports.tokenize = tokenize;
// ! plain in-process keyword/TF-IDF-style scoring — no embeddings API, no vector DB, by
// ! explicit product decision (see spec 18). Doesn't need to be textbook-correct BM25, just
// ! a reasonable relevance signal over what's typically only a few hundred chunks.
const scoreAndRankChunks = (chunks, question, topK) => {
    if (chunks.length === 0)
        return [];
    const questionTokens = Array.from(new Set((0, exports.tokenize)(question)));
    if (questionTokens.length === 0)
        return [];
    const chunkTokenLists = chunks.map((chunk) => (0, exports.tokenize)(chunk.chunkText));
    const chunkCount = chunks.length;
    const docFrequencyByToken = new Map();
    for (const qToken of questionTokens) {
        const df = chunkTokenLists.filter((tokens) => tokens.includes(qToken)).length;
        docFrequencyByToken.set(qToken, df);
    }
    const scoredChunks = chunks.map((chunk, i) => {
        var _a;
        const tokens = chunkTokenLists[i];
        let score = 0;
        for (const qToken of questionTokens) {
            const tf = tokens.filter((token) => token === qToken).length;
            if (tf === 0)
                continue;
            const df = (_a = docFrequencyByToken.get(qToken)) !== null && _a !== void 0 ? _a : 0;
            // ! smoothed idf so a term appearing in every chunk still contributes a small positive weight
            const idf = Math.log((chunkCount + 1) / (df + 1)) + 1;
            score += (1 + Math.log(tf)) * idf;
        }
        return { chunk, score };
    });
    return scoredChunks
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK)
        .map(({ chunk }) => chunk)
        .sort((a, b) => a.chunkIndex - b.chunkIndex);
};
exports.scoreAndRankChunks = scoreAndRankChunks;
