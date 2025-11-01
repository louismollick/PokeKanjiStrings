import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// ES module compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Paths
const DUMP_XML_PATH = path.join(__dirname, '../strings/dump/dump_CPU_0_ja.xml');
const OUTPUT_XML_PATH = path.join(__dirname, '../strings/kanji/kanji_strings_sinnoh_ja.xml');
const KANA_TXT_PATH = path.join(__dirname, '../corpus/BrilliantDiamondShiningPearl/ja-Hrkt_message.txt');
const KANJI_TXT_PATH = path.join(__dirname, '../corpus/BrilliantDiamondShiningPearl/ja_message.txt');
const LOGS_DIR = path.join(__dirname, '../logs');

// Create logs directory if it doesn't exist
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
const NO_MATCH_LOG_PATH = path.join(LOGS_DIR, `no_match_${timestamp}.xml`);
const REPORT_PATH = path.join(LOGS_DIR, `report_${timestamp}.txt`);

interface Stats {
  totalStrings: number;
  skippedNoKana: number;
  processedWithKana: number;
  foundMatches: number;
  notFoundMatches: number;
  multiSegmentMatches: number;
  partialMatches: number;
}

const stats: Stats = {
  totalStrings: 0,
  skippedNoKana: 0,
  processedWithKana: 0,
  foundMatches: 0,
  notFoundMatches: 0,
  multiSegmentMatches: 0,
  partialMatches: 0
};

/**
 * Parse a txt file from the corpus
 * Returns array of text lines (skipping headers)
 * NOTE: Lines can contain \r\n within them, so we only split on actual line breaks
 */
function parseTxtFile(filePath: string): string[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  // Split on line breaks, but note that \r\n can appear WITHIN lines as escaped text
  const lines = content.split(/\r?\n/);

  const textLines: string[] = [];

  for (const line of lines) {
    // Skip header lines based on poke-corpus logic
    if (line === '' ||
      line === '~~~~~~~~~~~~~~~' ||
      line.startsWith('Text File :')) {
      continue;
    }
    textLines.push(line);
  }

  return textLines;
}

/**
 * Check if a string contains Japanese Kana characters
 */
function containsKana(text: string): boolean {
  const kanaRegex = /[\u3040-\u309F\u30A0-\u30FF]/;
  return kanaRegex.test(text);
}

/**
 * Normalize special characters
 * Combines poke-corpus logic with Japanese-specific handling
 */
function cleanSpecial(text: string): string {
  return text
    // Normalize spaces (following searchWorker.ts logic)
    .replaceAll('\u00A0', ' ')  // non-breaking space -> space
    .replaceAll('\u2007', ' ')  // figure space -> space
    .replaceAll('\u202F', ' ')  // narrow non-breaking space -> space
    .replaceAll('\u3000', ' ')  // fullwidth space -> space

    // Normalize quotes
    .replaceAll('"', '"')       // left/right double quotation -> quotation mark
    .replaceAll('"', '"')
    .replaceAll('\u2018', "'")  // left/right single quotation -> apostrophe
    .replaceAll('\u2019', "'")

    // Normalize ALL dash-like characters to Japanese prolonged sound mark
    // This is critical for matching Katakana words like スピード (speed)
    .replaceAll('ー', 'ー')      // U+30FC katakana prolonged sound (normalize to itself)
    .replaceAll('－', 'ー')      // U+FF0D fullwidth hyphen-minus -> prolonged sound
    .replaceAll('\u2010', 'ー') // hyphen -> prolonged sound
    .replaceAll('\u2013', 'ー') // en dash -> prolonged sound
    .replaceAll('\u2014', 'ー') // em dash -> prolonged sound
    .replaceAll('\u2015', 'ー') // horizontal bar -> prolonged sound
    .replaceAll('\u2212', 'ー') // minus -> prolonged sound
    .replaceAll('-', 'ー')      // regular hyphen-minus -> prolonged sound

    // Normalize degree symbols
    .replaceAll('º', '°')       // masculine ordinal indicator -> degree symbol
    .replaceAll('˚', '°')       // ring above -> degree symbol
    .replaceAll('ᵒ', '°')       // modifier letter small O -> degree symbol

    // Normalize tildes and ellipsis
    .replaceAll('〜', '～')      // wave dash -> fullwidth tilde
    .replaceAll('‥', '..')      // two dot leader -> full stop (x2)
    .replaceAll('…', '...')     // horizontal ellipsis -> full stop (x3)

    .normalize();
}

/**
 * Normalize a string for comparison by removing all formatting
 * This creates a "content-only" version for lookup
 */
function normalizeForComparison(text: string): string {
  let normalized = text;

  // Remove speaker names at the start (e.g., "ナナカマド『" or "主人公『")
  // Pattern: Japanese characters followed by 『 at the start
  normalized = normalized.replace(/^[ぁ-んァ-ヶー一-龯々〆〤]+『/g, '');

  // Remove XML/HTML tags
  normalized = normalized.replace(/<[^>]+>/g, '');

  // Remove variables: {00}, [VAR 0101(0000)], [VAR 0114(0001)], etc.
  normalized = normalized.replace(/\{[0-9A-F]{2}\}/gi, '');
  normalized = normalized.replace(/\[VAR\s+[^\]]+\]/gi, '');

  // Remove control characters  
  normalized = normalized.replace(/\\c/g, '');
  normalized = normalized.replace(/\\r/g, ''); // Literal \r in text

  // Remove line breaks (both \n and actual newlines)
  normalized = normalized.replace(/\\n/g, '');
  normalized = normalized.replace(/\n/g, '');
  normalized = normalized.replace(/\r/g, '');

  // Normalize ellipsis variations
  normalized = normalized.replace(/⋯/g, '…');  // Midline ellipsis -> horizontal ellipsis
  normalized = normalized.replace(/……/g, '…');  // Double to single

  // Remove common punctuation (important for battle messages)
  normalized = normalized.replace(/[！!？?。、，,.；;：:（）\(\)「」『』【】\[\]]/g, '');

  // Clean special characters
  normalized = cleanSpecial(normalized);

  // Remove ALL whitespace for comparison (important for Japanese text)
  normalized = normalized.replace(/\s+/g, '');

  return normalized.trim();
}

/**
 * Extract the structure of a formatted string
 * Returns array of tokens: text segments, variables, line breaks
 */
interface Token {
  type: 'text' | 'variable' | 'linebreak';
  value: string;
}

function extractStructure(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let currentText = '';

  while (i < text.length) {
    // Check for {00} style variables
    if (text[i] === '{' && i + 3 < text.length && /[0-9A-F]{2}/i.test(text.substring(i + 1, i + 3)) && text[i + 3] === '}') {
      if (currentText) {
        tokens.push({ type: 'text', value: currentText });
        currentText = '';
      }
      tokens.push({ type: 'variable', value: text.substring(i, i + 4) });
      i += 4;
      continue;
    }

    // Check for \n line breaks
    if (text[i] === '\\' && i + 1 < text.length && text[i + 1] === 'n') {
      if (currentText) {
        tokens.push({ type: 'text', value: currentText });
        currentText = '';
      }
      tokens.push({ type: 'linebreak', value: '\\n' });
      i += 2;
      continue;
    }

    currentText += text[i];
    i++;
  }

  if (currentText) {
    tokens.push({ type: 'text', value: currentText });
  }

  return tokens;
}

/**
 * Reconstruct a formatted string using structure from original and content from replacement
 * This preserves exact positioning of variables and line breaks
 */
function reconstructWithFormatting(originalText: string, replacementText: string): string {
  const structure = extractStructure(originalText);
  const cleanReplacement = cleanSpecial(replacementText).replace(/\s+/g, '');

  let result = '';
  let replacementIndex = 0;

  for (const token of structure) {
    if (token.type === 'variable' || token.type === 'linebreak') {
      // Keep formatting tokens as-is
      result += token.value;
    } else {
      // Replace text content
      const cleanOriginalSegment = cleanSpecial(token.value).replace(/\s+/g, '');
      const segmentLength = cleanOriginalSegment.length;

      if (segmentLength > 0 && replacementIndex < cleanReplacement.length) {
        // Take corresponding portion from replacement
        const portion = cleanReplacement.substring(replacementIndex, Math.min(replacementIndex + segmentLength, cleanReplacement.length));
        result += portion;
        replacementIndex += portion.length;
      }
    }
  }

  // Append any remaining replacement text
  if (replacementIndex < cleanReplacement.length) {
    result += cleanReplacement.substring(replacementIndex);
  }

  return result;
}

/**
 * Build comprehensive lookup map from Kana to Kanji
 * Includes full lines, sub-segments, and combinations of consecutive lines
 */
function buildKanaToKanjiMap(kanaLines: string[], kanjiLines: string[]): Map<string, string> {
  const map = new Map<string, string>();
  const minLength = Math.min(kanaLines.length, kanjiLines.length);

  for (let i = 0; i < minLength; i++) {
    const kanaLine = kanaLines[i];
    const kanjiLine = kanjiLines[i];

    if (!kanaLine || !kanjiLine) continue;

    // Add full line
    const normalizedFull = normalizeForComparison(kanaLine);
    if (normalizedFull && !map.has(normalizedFull)) {
      map.set(normalizedFull, kanjiLine);
    }

    // Split on \c control character and add sub-segments
    if (kanaLine.includes('\\c')) {
      const kanaSegments = kanaLine.split('\\c');
      const kanjiSegments = kanjiLine.split('\\c');

      if (kanaSegments.length === kanjiSegments.length) {
        for (let j = 0; j < kanaSegments.length; j++) {
          const kanaSeg = kanaSegments[j];
          const kanjiSeg = kanjiSegments[j];
          if (kanaSeg && kanjiSeg) {
            const normalizedSeg = normalizeForComparison(kanaSeg);
            if (normalizedSeg && !map.has(normalizedSeg)) {
              map.set(normalizedSeg, kanjiSeg);
            }
          }
        }
      }
    }

    // Also try splitting on just \n for additional coverage
    if (kanaLine.includes('\\n') && !kanaLine.includes('\\c')) {
      const kanaSegments = kanaLine.split('\\n');
      const kanjiSegments = kanjiLine.split('\\n');

      if (kanaSegments.length === kanjiSegments.length && kanaSegments.length > 1) {
        for (let j = 0; j < kanaSegments.length; j++) {
          const kanaSeg = kanaSegments[j];
          const kanjiSeg = kanjiSegments[j];
          if (kanaSeg && kanjiSeg) {
            const normalizedSeg = normalizeForComparison(kanaSeg);
            if (normalizedSeg && !map.has(normalizedSeg)) {
              map.set(normalizedSeg, kanjiSeg);
            }
          }
        }
      }
    }

    // Add combinations of 2-5 consecutive lines (XML often merges multiple TXT lines)
    for (let lookAhead = 1; lookAhead <= 5 && i + lookAhead < minLength; lookAhead++) {
      const combinedKana: string[] = [kanaLine];
      const combinedKanji: string[] = [kanjiLine];

      for (let j = 1; j <= lookAhead; j++) {
        const nextKana = kanaLines[i + j];
        const nextKanji = kanjiLines[i + j];
        if (nextKana && nextKanji) {
          combinedKana.push(nextKana);
          combinedKanji.push(nextKanji);
        }
      }

      if (combinedKana.length === lookAhead + 1) {
        const kanaCombo = combinedKana.join('\\n\\n');
        const kanjiCombo = combinedKanji.join('\\n\\n');
        const normalizedCombo = normalizeForComparison(kanaCombo);
        if (normalizedCombo && !map.has(normalizedCombo)) {
          map.set(normalizedCombo, kanjiCombo);
        }
      }
    }
  }

  console.log(`Built lookup map with ${map.size} entries`);
  return map;
}

/**
 * Find Kanji version of a Kana string using multiple strategies
 */
function findKanjiVersion(kanaText: string, lookupMap: Map<string, string>): string | null {
  const normalized = normalizeForComparison(kanaText);
  if (!normalized) return null;

  // Strategy 1: Direct lookup
  const directMatch = lookupMap.get(normalized);
  if (directMatch) {
    return directMatch;
  }

  // Strategy 2: Try splitting on \\n\\n (XML combines multiple lines with double breaks)
  if (kanaText.includes('\\n\\n')) {
    const result = trySegmentedMatch(kanaText, '\\n\\n', lookupMap);
    if (result) {
      stats.multiSegmentMatches++;
      return result;
    }
  }

  // Strategy 3: Try splitting on single \\n
  if (kanaText.includes('\\n')) {
    const segments = kanaText.split('\\n');
    if (segments.length > 1 && segments.length <= 10) {
      const result = trySegmentedMatch(kanaText, '\\n', lookupMap);
      if (result) {
        stats.partialMatches++;
        return result;
      }
    }

    // Strategy 3b: For short battle messages like "{00}の\n<move>！",
    // try matching just the content after the first \n
    if (segments.length === 2 && segments[0].length < 20) {
      const mainContent = segments[1];
      const mainNormalized = normalizeForComparison(mainContent);
      const mainMatch = lookupMap.get(mainNormalized);
      if (mainMatch) {
        // Reconstruct with original prefix
        const reconstructed = segments[0] + '\\n' + mainMatch;
        stats.partialMatches++;
        return reconstructed;
      }
    }
  }

  // Strategy 4: Try partial/fuzzy matching for very long strings
  // These might be concatenations of multiple corpus lines
  if (normalized.length > 50 && kanaText.includes('\\n\\n')) {
    const result = tryFuzzyMultilineMatch(kanaText, lookupMap);
    if (result) {
      stats.partialMatches++;
      return result;
    }
  }

  return null;
}

/**
 * Try to match by splitting on a delimiter
 */
function trySegmentedMatch(text: string, delimiter: string, lookupMap: Map<string, string>): string | null {
  const segments = text.split(delimiter);
  const kanjiSegments: string[] = [];
  let allFound = true;

  for (const segment of segments) {
    const trimmed = segment.trim();
    if (!trimmed) {
      kanjiSegments.push(segment);
      continue;
    }

    const segNormalized = normalizeForComparison(trimmed);
    const kanjiSegment = lookupMap.get(segNormalized);

    if (kanjiSegment) {
      kanjiSegments.push(kanjiSegment);
    } else {
      allFound = false;
      break;
    }
  }

  if (allFound && kanjiSegments.length > 0) {
    return kanjiSegments.join(delimiter);
  }

  return null;
}

/**
 * Try to match long concatenated strings by finding partial matches
 * This handles cases where XML merges multiple TXT lines into one
 */
function tryFuzzyMultilineMatch(text: string, lookupMap: Map<string, string>): string | null {
  const normalized = normalizeForComparison(text);

  // Try to find any corpus entries that are substrings of this text
  const matches: Array<{ start: number, end: number, kana: string, kanji: string }> = [];

  for (const [kanaKey, kanjiValue] of lookupMap.entries()) {
    if (kanaKey.length < 20) continue; // Only consider reasonably long strings

    const index = normalized.indexOf(kanaKey);
    if (index !== -1) {
      matches.push({
        start: index,
        end: index + kanaKey.length,
        kana: kanaKey,
        kanji: kanjiValue
      });
    }
  }

  // If we found matches covering most of the string, use them
  if (matches.length > 0) {
    // Sort by start position
    matches.sort((a, b) => a.start - b.start);

    // Check if matches cover a significant portion (>60%) of the text
    const coverage = matches.reduce((sum, m) => sum + (m.end - m.start), 0);
    if (coverage >= normalized.length * 0.6) {
      // Build result by replacing matched portions
      let result = text;
      // Process in reverse order to maintain string positions
      for (let i = matches.length - 1; i >= 0; i--) {
        const match = matches[i];
        // This is complex - for now just return the first long match
        return match.kanji;
      }
    }
  }

  return null;
}

/**
 * Process XML file and replace Kana strings with Kanji
 */
function processXmlFile(
  inputPath: string,
  outputPath: string,
  lookupMap: Map<string, string>
): void {
  const content = fs.readFileSync(inputPath, 'utf-8');
  const lines = content.split('\n');

  const noMatchEntries: string[] = [];
  let modifiedContent = '';

  for (const line of lines) {
    const stringMatch = line.match(/^(\s*<string\s+[^>]*>)(.*?)(<\/string>)$/);

    if (stringMatch) {
      stats.totalStrings++;
      const prefix = stringMatch[1];
      const text = stringMatch[2];
      const suffix = stringMatch[3];

      if (!containsKana(text)) {
        stats.skippedNoKana++;
        modifiedContent += line + '\n';
        continue;
      }

      stats.processedWithKana++;

      const kanjiText = findKanjiVersion(text, lookupMap);

      if (kanjiText) {
        const formattedKanji = reconstructWithFormatting(text, kanjiText);
        stats.foundMatches++;
        modifiedContent += prefix + formattedKanji + suffix + '\n';
      } else {
        stats.notFoundMatches++;
        noMatchEntries.push(line);
        modifiedContent += line + '\n';
      }
    } else {
      modifiedContent += line + '\n';
    }
  }

  fs.writeFileSync(outputPath, modifiedContent, 'utf-8');
  console.log(`Wrote output to ${outputPath}`);

  if (noMatchEntries.length > 0) {
    const noMatchContent = '<?xml version="1.0" encoding="UTF-8"?>\n<no_matches>\n' +
      noMatchEntries.join('\n') + '\n</no_matches>';
    fs.writeFileSync(NO_MATCH_LOG_PATH, noMatchContent, 'utf-8');
    console.log(`Wrote no-match log to ${NO_MATCH_LOG_PATH}`);
  }
}

/**
 * Generate summary report
 */
function generateReport(): void {
  const report = [
    '='.repeat(70),
    'KANA TO KANJI CONVERSION REPORT',
    '='.repeat(70),
    '',
    `Timestamp: ${new Date().toISOString()}`,
    '',
    'STATISTICS:',
    '-'.repeat(70),
    `Total string entries scanned: ${stats.totalStrings}`,
    '',
    `Strings skipped (no Kana): ${stats.skippedNoKana}`,
    `  Percentage: ${((stats.skippedNoKana / stats.totalStrings) * 100).toFixed(2)}%`,
    '',
    `Strings processed (contain Kana): ${stats.processedWithKana}`,
    `  Percentage: ${((stats.processedWithKana / stats.totalStrings) * 100).toFixed(2)}%`,
    '',
    `Strings with match found: ${stats.foundMatches}`,
    `  Percentage of processed: ${stats.processedWithKana > 0 ? ((stats.foundMatches / stats.processedWithKana) * 100).toFixed(2) : 0}%`,
    `  - Direct matches: ${stats.foundMatches - stats.multiSegmentMatches - stats.partialMatches}`,
    `  - Multi-segment matches (\\n\\n): ${stats.multiSegmentMatches}`,
    `  - Partial matches (\\n): ${stats.partialMatches}`,
    '',
    `Strings with no match found: ${stats.notFoundMatches}`,
    `  Percentage of processed: ${stats.processedWithKana > 0 ? ((stats.notFoundMatches / stats.processedWithKana) * 100).toFixed(2) : 0}%`,
    '',
    'FILES:',
    '-'.repeat(70),
    `Input XML: ${DUMP_XML_PATH}`,
    `Output XML: ${OUTPUT_XML_PATH}`,
    `Kana corpus: ${KANA_TXT_PATH}`,
    `Kanji corpus: ${KANJI_TXT_PATH}`,
    `No-match log: ${NO_MATCH_LOG_PATH}`,
    '',
    '='.repeat(70)
  ].join('\n');

  fs.writeFileSync(REPORT_PATH, report, 'utf-8');
  console.log('\n' + report);
  console.log(`\nReport written to ${REPORT_PATH}`);
}

/**
 * Main execution
 */
function main(): void {
  console.log('Starting Kana to Kanji conversion...');
  console.log('Using poke-corpus-inspired preprocessing\n');

  console.log('Step 1: Parsing corpus txt files...');
  const kanaLines = parseTxtFile(KANA_TXT_PATH);
  const kanjiLines = parseTxtFile(KANJI_TXT_PATH);
  console.log(`  Kana lines: ${kanaLines.length}`);
  console.log(`  Kanji lines: ${kanjiLines.length}`);
  console.log('');

  console.log('Step 2: Building Kana to Kanji lookup map...');
  const lookupMap = buildKanaToKanjiMap(kanaLines, kanjiLines);
  console.log('');

  console.log('Step 3: Processing XML file...');
  processXmlFile(DUMP_XML_PATH, OUTPUT_XML_PATH, lookupMap);
  console.log('');

  console.log('Step 4: Generating report...');
  generateReport();

  console.log('\nConversion complete!');
}

main();

