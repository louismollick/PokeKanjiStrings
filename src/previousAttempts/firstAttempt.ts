import * as fs from 'fs';
import * as path from 'path';

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
}

const stats: Stats = {
  totalStrings: 0,
  skippedNoKana: 0,
  processedWithKana: 0,
  foundMatches: 0,
  notFoundMatches: 0
};

/**
 * Parse a txt file from the corpus and return an array of text lines (skipping header)
 */
function parseTxtFile(filePath: string): string[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  const textLines: string[] = [];
  let inHeader = true;
  let headerLineCount = 0;

  for (const line of lines) {
    if (inHeader) {
      // Skip the first 3 lines (header: ~~~, Text File: name, ~~~)
      if (line.trim().startsWith('~~~~~~~~~~~~~~~')) {
        headerLineCount++;
        if (headerLineCount >= 2) {
          inHeader = false;
        }
        continue;
      }
      if (line.trim().startsWith('Text File :')) {
        continue;
      }
    } else {
      textLines.push(line);
    }
  }

  return textLines;
}

/**
 * Check if a string contains Japanese Kana characters
 */
function containsKana(text: string): boolean {
  // Hiragana: U+3040-U+309F, Katakana: U+30A0-U+30FF
  const kanaRegex = /[\u3040-\u309F\u30A0-\u30FF]/;
  return kanaRegex.test(text);
}

/**
 * Check if a string contains Japanese Kanji characters
 */
function containsKanji(text: string): boolean {
  // CJK Unified Ideographs: U+4E00-U+9FFF
  const kanjiRegex = /[\u4E00-\u9FFF]/;
  return kanjiRegex.test(text);
}

/**
 * Normalize a string for comparison by removing variables and special formatting
 */
function normalizeForComparison(text: string): string {
  // Remove XML/HTML tags
  let normalized = text.replace(/<[^>]+>/g, '');
  // Remove variables like {00}, {01}, etc
  normalized = normalized.replace(/\{[0-9A-F]{2}\}/gi, '');
  // Remove variables like [VAR 0101(0000)]
  normalized = normalized.replace(/\[VAR\s+[^\]]+\]/gi, '');
  // Remove control characters like \c (text box control in game files)
  // Two backslashes in source (\c) matches literal backslash-c in the string  
  normalized = normalized.replace(/\\c/g, '');
  // Remove line breaks (both literal \n strings and actual newlines)
  // Two backslashes in source (\n) matches literal backslash-n
  normalized = normalized.replace(/\\n/g, '');
  normalized = normalized.replace(/\n/g, '');
  // Remove all whitespace (including full-width spaces U+3000)
  normalized = normalized.replace(/\s+/g, '');
  normalized = normalized.replace(/　/g, '');
  // Normalize different dash/prolonged sound characters to the same one
  // U+30FC (ー katakana prolonged sound), U+FF0D (－ fullwidth hyphen), U+2014 (— em dash)
  normalized = normalized.replace(/[ー－‐−–—]/g, 'ー');
  // Trim
  normalized = normalized.trim();
  return normalized;
}

/**
 * Extract formatting structure (variables and line breaks) from a string
 */
function extractFormatting(text: string): Array<{ type: 'text' | 'variable' | 'linebreak', value: string }> {
  const result: Array<{ type: 'text' | 'variable' | 'linebreak', value: string }> = [];
  let currentText = '';

  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{' && i + 3 < text.length && text[i + 3] === '}') {
      // Variable like {00}
      if (currentText) {
        result.push({ type: 'text', value: currentText });
        currentText = '';
      }
      result.push({ type: 'variable', value: text.substring(i, i + 4) });
      i += 3; // Skip the variable
    } else if (text[i] === '\\' && i + 1 < text.length && text[i + 1] === 'n') {
      // Line break \n
      if (currentText) {
        result.push({ type: 'text', value: currentText });
        currentText = '';
      }
      result.push({ type: 'linebreak', value: '\\n' });
      i += 1; // Skip the 'n'
    } else {
      currentText += text[i];
    }
  }

  if (currentText) {
    result.push({ type: 'text', value: currentText });
  }

  return result;
}

/**
 * Apply formatting from original text to new text
 * This rebuilds the original text structure but with kanji content from new text
 */
function applyFormatting(originalText: string, newText: string): string {
  // Normalize both (remove all formatting, variables, spaces)
  const originalNormalized = normalizeForComparison(originalText);
  const newNormalized = normalizeForComparison(newText);

  if (originalNormalized === newNormalized) {
    return originalText;
  }

  // Extract formatting structure from original
  const formatting = extractFormatting(originalText);

  // Calculate the percentage of text vs formatting in original
  const originalTextLength = originalNormalized.length;
  const newTextLength = newNormalized.length;

  if (originalTextLength === 0) {
    return originalText;
  }

  // Track position in the new text
  let newTextPos = 0;
  let originalTextPos = 0;
  let result = '';

  for (const item of formatting) {
    if (item.type === 'variable' || item.type === 'linebreak') {
      result += item.value;
    } else {
      // Calculate how much of the original normalized text this segment represents
      const segmentNormalized = normalizeForComparison(item.value);
      const segmentLength = segmentNormalized.length;

      if (segmentLength > 0 && newTextPos < newTextLength) {
        // Calculate proportional length in new text
        const proportion = segmentLength / originalTextLength;
        let targetLength = Math.round(proportion * newTextLength);

        // Ensure we don't go past the end
        if (newTextPos + targetLength > newTextLength) {
          targetLength = newTextLength - newTextPos;
        }

        // Handle case where this is the last text segment - take all remaining
        const isLastSegment = formatting.slice(formatting.indexOf(item) + 1).every(f => f.type !== 'text');
        if (isLastSegment) {
          targetLength = newTextLength - newTextPos;
        }

        if (targetLength > 0) {
          result += newNormalized.substring(newTextPos, newTextPos + targetLength);
          newTextPos += targetLength;
        }
      }
      originalTextPos += segmentLength;
    }
  }

  // If there's remaining text in new, append it
  if (newTextPos < newTextLength) {
    result += newNormalized.substring(newTextPos);
  }

  return result;
}

/**
 * Build a lookup map from Kana text to Kanji text
 */
function buildKanaToKanjiMap(kanaLines: string[], kanjiLines: string[]): Map<string, string> {
  const map = new Map<string, string>();

  // The lines should be aligned between the two files
  const minLength = Math.min(kanaLines.length, kanjiLines.length);

  for (let i = 0; i < minLength; i++) {
    const kanaLine = kanaLines[i].trim();
    const kanjiLine = kanjiLines[i].trim();

    if (kanaLine && kanjiLine) {
      // Add the full line to the map
      const normalizedKana = normalizeForComparison(kanaLine);
      if (normalizedKana) {
        map.set(normalizedKana, kanjiLine);
      }

      // Also split on \c control characters and add sub-segments
      // This handles cases where XML splits differently than TXT
      if (kanaLine.includes('\\c')) {
        const kanaSegments = kanaLine.split('\\c');
        const kanjiSegments = kanjiLine.split('\\c');

        if (kanaSegments.length === kanjiSegments.length) {
          for (let j = 0; j < kanaSegments.length; j++) {
            const kanaSeg = kanaSegments[j].trim();
            const kanjiSeg = kanjiSegments[j].trim();
            if (kanaSeg && kanjiSeg) {
              const normalizedSeg = normalizeForComparison(kanaSeg);
              if (normalizedSeg && !map.has(normalizedSeg)) {
                map.set(normalizedSeg, kanjiSeg);
              }
            }
          }
        }
      }
    }
  }

  console.log(`Built lookup map with ${map.size} entries`);
  return map;
}

/**
 * Find Kanji version of a Kana string using the lookup map
 */
function findKanjiVersion(kanaText: string, lookupMap: Map<string, string>): string | null {
  const normalized = normalizeForComparison(kanaText);

  if (!normalized) {
    return null;
  }

  // Direct lookup
  const directMatch = lookupMap.get(normalized);
  if (directMatch) {
    return directMatch;
  }

  // Try splitting on double line breaks (XML sometimes combines multiple TXT lines)
  // In XML files, \n is stored as literal backslash-n, not as newline character
  if (kanaText.includes('\\n\\n')) {
    const segments = kanaText.split('\\n\\n');
    const kanjiSegments: string[] = [];
    let allFound = true;

    for (const segment of segments) {
      if (!segment.trim()) {
        kanjiSegments.push(segment);
        continue;
      }

      const kanjiSegment = findKanjiVersionSingle(segment, lookupMap);
      if (kanjiSegment) {
        kanjiSegments.push(kanjiSegment);
      } else {
        allFound = false;
        break;
      }
    }

    if (allFound && kanjiSegments.length > 0) {
      return kanjiSegments.join('\\n\\n');
    }
  }

  return null;
}

/**
 * Find Kanji version for a single segment (helper for findKanjiVersion)
 */
function findKanjiVersionSingle(kanaText: string, lookupMap: Map<string, string>): string | null {
  const normalized = normalizeForComparison(kanaText);

  if (!normalized) {
    return null;
  }

  return lookupMap.get(normalized) || null;
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
    // Match XML string elements
    const stringMatch = line.match(/^(\s*<string\s+[^>]*>)(.*?)(<\/string>)$/);

    if (stringMatch) {
      stats.totalStrings++;
      const prefix = stringMatch[1];
      const text = stringMatch[2];
      const suffix = stringMatch[3];

      // Check if the text contains Kana
      if (!containsKana(text)) {
        // Skip strings with no Kana (punctuation, English, etc.)
        stats.skippedNoKana++;
        modifiedContent += line + '\n';
        continue;
      }

      stats.processedWithKana++;

      // Try to find Kanji version
      const kanjiText = findKanjiVersion(text, lookupMap);

      if (kanjiText) {
        // Apply original formatting to the Kanji text
        const formattedKanji = applyFormatting(text, kanjiText);
        stats.foundMatches++;
        modifiedContent += prefix + formattedKanji + suffix + '\n';
      } else {
        // No match found, keep original and log
        stats.notFoundMatches++;
        noMatchEntries.push(line);
        modifiedContent += line + '\n';
      }
    } else {
      // Not a string element, keep as is
      modifiedContent += line + '\n';
    }
  }

  // Write output XML
  fs.writeFileSync(outputPath, modifiedContent, 'utf-8');
  console.log(`Wrote output to ${outputPath}`);

  // Write no-match log
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
    '='.repeat(60),
    'KANA TO KANJI CONVERSION REPORT',
    '='.repeat(60),
    '',
    `Timestamp: ${new Date().toISOString()}`,
    '',
    'STATISTICS:',
    '-'.repeat(60),
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
    '',
    `Strings with no match found: ${stats.notFoundMatches}`,
    `  Percentage of processed: ${stats.processedWithKana > 0 ? ((stats.notFoundMatches / stats.processedWithKana) * 100).toFixed(2) : 0}%`,
    '',
    'FILES:',
    '-'.repeat(60),
    `Input XML: ${DUMP_XML_PATH}`,
    `Output XML: ${OUTPUT_XML_PATH}`,
    `Kana corpus: ${KANA_TXT_PATH}`,
    `Kanji corpus: ${KANJI_TXT_PATH}`,
    `No-match log: ${NO_MATCH_LOG_PATH}`,
    '',
    '='.repeat(60)
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
  console.log('');

  // Step 1: Parse txt files
  console.log('Step 1: Parsing corpus txt files...');
  const kanaLines = parseTxtFile(KANA_TXT_PATH);
  const kanjiLines = parseTxtFile(KANJI_TXT_PATH);
  console.log(`  Kana lines: ${kanaLines.length}`);
  console.log(`  Kanji lines: ${kanjiLines.length}`);
  console.log('');

  // Step 2: Build lookup map
  console.log('Step 2: Building Kana to Kanji lookup map...');
  const lookupMap = buildKanaToKanjiMap(kanaLines, kanjiLines);
  console.log('');

  // Step 3: Process XML
  console.log('Step 3: Processing XML file...');
  processXmlFile(DUMP_XML_PATH, OUTPUT_XML_PATH, lookupMap);
  console.log('');

  // Step 4: Generate report
  console.log('Step 4: Generating report...');
  generateReport();

  console.log('\nConversion complete!');
}

// Run the script
main();
