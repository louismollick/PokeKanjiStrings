import { cleanSpecial } from './cleanSpecial.js';

/**
 * Normalize for comparison
 */
export function normalizeForComparison(text: string): string {
  let normalized = text;

  // Remove speaker names
  normalized = normalized.replace(/^[ぁ-んァ-ヶー一-龯々〆〤]+『/g, '');

  // Remove variables
  normalized = normalized.replace(/\{[0-9A-F]{2}\}/gi, '');
  normalized = normalized.replace(/\[VAR\s+[^\]]+\]/gi, '');

  // Remove control characters and line breaks
  normalized = normalized.replace(/\\c/g, '');
  normalized = normalized.replace(/\\r/g, '');
  normalized = normalized.replace(/\\n/g, '');
  normalized = normalized.replace(/\n/g, '');
  normalized = normalized.replace(/\r/g, '');

  // Normalize ellipsis
  normalized = normalized.replace(/⋯/g, '…');
  normalized = normalized.replace(/……/g, '…');

  // Remove punctuation
  normalized = normalized.replace(/[！!？?。、，,.；;：:（）\(\)「」『』【】\[\]]/g, '');

  // Clean special chars
  normalized = cleanSpecial(normalized);

  // Remove all whitespace
  normalized = normalized.replace(/\s+/g, '');

  return normalized.trim();
}

