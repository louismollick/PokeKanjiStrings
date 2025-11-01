import { normalizeForComparison } from './normalizeForComparison.js';

/**
 * Check if string needs kanji-ification
 * Returns false if string is mostly katakana, punctuation, roman letters, or has any kanji
 */
export function needsKanjification(text: string): boolean {
  const normalized = normalizeForComparison(text);

  if (normalized.length < 3) return false;

  // Count character types
  const hiragana = (normalized.match(/[ぁ-ん]/g) || []).length;
  const katakana = (normalized.match(/[ァ-ヶ]/g) || []).length;
  const kanji = (normalized.match(/[一-龯々]/g) || []).length;
  const roman = (normalized.match(/[a-zA-Z0-9]/g) || []).length;
  const total = normalized.length;

  // Skip if has any kanji already
  if (kanji > 0) return false;

  // Skip if mostly katakana (Pokemon names, moves)
  if (katakana / total > 0.8) return false;

  // Skip if mostly roman letters (codes, abbreviations)
  if (roman / total > 0.5) return false;

  // Skip if very little hiragana (nothing to convert)
  if (hiragana < 3) return false;

  return true;
}

