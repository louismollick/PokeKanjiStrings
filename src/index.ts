import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { cleanSpecial } from './utils/cleanSpecial.js';
import { normalizeForComparison } from './utils/normalizeForComparison.js';
import { needsKanjification } from './utils/needsKanjification.js';

// ES module compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Paths
const DUMP_XML_PATH = path.join(__dirname, '../strings/dump/dump_CPU_0_ja.xml');
const OUTPUT_XML_PATH = path.join(__dirname, '../strings/kanji/kanji_strings_sinnoh_ja.xml');
const KANA_TXT_PATH = path.join(__dirname, '../corpus/BrilliantDiamondShiningPearl/ja-Hrkt_message.txt');
const KANJI_TXT_PATH = path.join(__dirname, '../corpus/BrilliantDiamondShiningPearl/ja_message.txt');
const LOGS_DIR = path.join(__dirname, '../logs');

if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
const NO_MATCH_LOG_PATH = path.join(LOGS_DIR, `no_match_${timestamp}.xml`);
const REPORT_PATH = path.join(LOGS_DIR, `report_${timestamp}.txt`);

interface Stats {
  totalXmlStrings: number;
  xmlStringsWithKana: number;
  xmlStringsMatched: number;
  xmlStringsUnmatched: number;
  xmlStringsNeedingLLM: number;
  totalCorpusEntries: number;
  corpusEntriesUsed: number;
}

const stats: Stats = {
  totalXmlStrings: 0,
  xmlStringsWithKana: 0,
  xmlStringsMatched: 0,
  xmlStringsUnmatched: 0,
  xmlStringsNeedingLLM: 0,
  totalCorpusEntries: 0,
  corpusEntriesUsed: 0
};

/**
 * Parse corpus txt file
 */
function parseTxtFile(filePath: string): string[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/);
  const textLines: string[] = [];

  for (const line of lines) {
    if (line === '' || line === '~~~~~~~~~~~~~~~' || line.startsWith('Text File :')) {
      continue;
    }
    textLines.push(line);
  }

  return textLines;
}

/**
 * Check if string contains Kana
 */
function containsKana(text: string): boolean {
  return /[\u3040-\u309F\u30A0-\u30FF]/.test(text);
}

/**
 * Find character-level differences between kana and kanji using LCS
 * Returns array of {kana: string, kanji: string} mappings
 */
interface KanaKanjiMapping {
  kana: string;
  kanji: string;
}

function findKanaKanjiMappings(kanaText: string, kanjiText: string): KanaKanjiMapping[] {
  // Clean both texts (remove variables, spaces, etc but keep content)
  const cleanKana = normalizeForComparison(kanaText);
  const cleanKanji = normalizeForComparison(kanjiText);

  const mappings: KanaKanjiMapping[] = [];

  // Use LCS-based diff to find changed segments
  const diffs = computeDiff(cleanKana, cleanKanji);

  for (const diff of diffs) {
    if (diff.kana !== diff.kanji && diff.kana.length > 0) {
      mappings.push({
        kana: diff.kana,
        kanji: diff.kanji
      });
    }
  }

  return mappings;
}

/**
 * Compute character-level diff using dynamic programming
 */
interface DiffSegment {
  kana: string;
  kanji: string;
}

function computeDiff(kana: string, kanji: string): DiffSegment[] {
  const m = kana.length;
  const n = kanji.length;

  // Build LCS table
  const lcs: number[][] = Array(m + 1).fill(0).map(() => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (kana[i - 1] === kanji[j - 1]) {
        lcs[i][j] = lcs[i - 1][j - 1] + 1;
      } else {
        lcs[i][j] = Math.max(lcs[i - 1][j], lcs[i][j - 1]);
      }
    }
  }

  // Backtrack to find differences
  const segments: DiffSegment[] = [];
  let i = m, j = n;
  let currentKana = '';
  let currentKanji = '';

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && kana[i - 1] === kanji[j - 1]) {
      // Characters match - save any pending diff
      if (currentKana || currentKanji) {
        segments.unshift({
          kana: currentKana.split('').reverse().join(''),
          kanji: currentKanji.split('').reverse().join('')
        });
        currentKana = '';
        currentKanji = '';
      }
      // Add matching segment
      segments.unshift({
        kana: kana[i - 1],
        kanji: kanji[j - 1]
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || lcs[i][j - 1] >= lcs[i - 1][j])) {
      // Character added in kanji
      currentKanji += kanji[j - 1];
      j--;
    } else {
      // Character removed from kana
      currentKana += kana[i - 1];
      i--;
    }
  }

  // Add any remaining diff
  if (currentKana || currentKanji) {
    segments.unshift({
      kana: currentKana.split('').reverse().join(''),
      kanji: currentKanji.split('').reverse().join('')
    });
  }

  // Merge consecutive diff segments
  const merged: DiffSegment[] = [];
  for (const seg of segments) {
    if (merged.length > 0 &&
      merged[merged.length - 1].kana !== merged[merged.length - 1].kanji &&
      seg.kana !== seg.kanji) {
      // Merge with previous diff segment
      merged[merged.length - 1].kana += seg.kana;
      merged[merged.length - 1].kanji += seg.kanji;
    } else {
      merged.push(seg);
    }
  }

  return merged;
}

/**
 * Apply kana→kanji mappings to XML string, preserving structure
 */
function applyMappingsToXml(xmlText: string, mappings: KanaKanjiMapping[]): string {
  let result = xmlText;

  // Apply each mapping once, in order
  for (const mapping of mappings) {
    // Only replace if the kana actually exists in the current result
    if (result.includes(mapping.kana)) {
      // Replace only the first occurrence
      result = result.replace(mapping.kana, mapping.kanji);
    }
  }

  return result;
}

/**
 * Main function
 */
function main(): void {
  console.log('Starting Kana to Kanji conversion (LCS-based approach)...\n');

  // Step 1: Parse corpus
  console.log('Step 1: Parsing corpus...');
  const kanaLines = parseTxtFile(KANA_TXT_PATH);
  const kanjiLines = parseTxtFile(KANJI_TXT_PATH);
  stats.totalCorpusEntries = Math.min(kanaLines.length, kanjiLines.length);
  console.log(`  Corpus entries: ${stats.totalCorpusEntries}\n`);

  // Step 2: Read XML
  console.log('Step 2: Reading XML...');
  const xmlContent = fs.readFileSync(DUMP_XML_PATH, 'utf-8');
  const xmlLines = xmlContent.split(/\r?\n/);
  console.log(`  XML lines: ${xmlLines.length}\n`);

  // Step 3: Parse XML strings with Kana
  console.log('Step 3: Parsing XML strings...');
  interface XmlString {
    lineNum: number;
    prefix: string;
    text: string;
    suffix: string;
    normalized: string;
  }

  const xmlStrings: XmlString[] = [];

  xmlLines.forEach((line: string, lineNum: number) => {
    const match = line.match(/^(\s*<string\s+[^>]*>)(.*?)(<\/string>)$/);
    if (match && match[1] && match[2] && match[3]) {
      stats.totalXmlStrings++;
      const text = match[2];

      if (containsKana(text)) {
        stats.xmlStringsWithKana++;
        xmlStrings.push({
          lineNum: lineNum,
          prefix: match[1],
          text: text,
          suffix: match[3],
          normalized: normalizeForComparison(text)
        });
      }
    }
  });

  console.log(`  Found ${xmlStrings.length} XML strings with Kana\n`);

  // Step 4: Find matches and build kana→kanji mappings
  console.log('Step 4: Finding matches and building mappings...');
  const xmlMatches: Map<number, KanaKanjiMapping[]> = new Map();

  for (let i = 0; i < stats.totalCorpusEntries; i++) {
    if (i % 5000 === 0 && i > 0) {
      console.log(`  Processed ${i}/${stats.totalCorpusEntries} corpus entries...`);
    }

    const kanaCorpus = kanaLines[i];
    const kanjiCorpus = kanjiLines[i];

    if (!kanaCorpus || !kanjiCorpus) continue;

    // Skip if kana == kanji (no changes)
    const normalizedKana = normalizeForComparison(kanaCorpus);
    const normalizedKanji = normalizeForComparison(kanjiCorpus);

    if (normalizedKana === normalizedKanji) continue;
    if (normalizedKana.length < 3) continue;

    // Find exact matches in XML
    for (const xmlStr of xmlStrings) {
      if (xmlStr.normalized === normalizedKana) {
        // Found exact match! Compute kana→kanji mappings
        const mappings = findKanaKanjiMappings(kanaCorpus, kanjiCorpus);

        if (mappings.length > 0) {
          xmlMatches.set(xmlStr.lineNum, mappings);
          stats.corpusEntriesUsed++;
        }

        break; // Only match once per corpus entry
      }
    }
  }

  stats.xmlStringsMatched = xmlMatches.size;
  stats.xmlStringsUnmatched = stats.xmlStringsWithKana - stats.xmlStringsMatched;

  console.log(`  Matched: ${stats.xmlStringsMatched}`);
  console.log(`  Unmatched: ${stats.xmlStringsUnmatched}\n`);

  // Step 5: Apply mappings to XML
  console.log('Step 5: Applying kana→kanji replacements...');
  const modifiedXml: Map<number, string> = new Map();

  for (const [lineNum, mappings] of xmlMatches) {
    const xmlStr = xmlStrings.find(x => x.lineNum === lineNum);
    if (!xmlStr) continue;

    const converted = applyMappingsToXml(xmlStr.text, mappings);
    modifiedXml.set(lineNum, xmlStr.prefix + converted + xmlStr.suffix);
  }

  console.log(`  Applied mappings to ${modifiedXml.size} strings\n`);

  // Step 6: Write output and prepare LLM input
  console.log('Step 6: Writing output and preparing LLM input...');
  let outputContent = '';
  const noMatchEntries: string[] = [];
  const llmInputStrings: { lineNum: number, text: string }[] = [];

  xmlLines.forEach((line: string, lineNum: number) => {
    if (modifiedXml.has(lineNum)) {
      outputContent += modifiedXml.get(lineNum) + '\n';
    } else {
      outputContent += line + '\n';

      // Log unmatched Kana strings
      const xmlStr = xmlStrings.find(x => x.lineNum === lineNum);
      if (xmlStr) {
        noMatchEntries.push(line);

        // Check if this needs LLM processing
        if (needsKanjification(xmlStr.text)) {
          llmInputStrings.push({
            lineNum: lineNum,
            text: xmlStr.text
          });
          stats.xmlStringsNeedingLLM++;
        }
      }
    }
  });

  fs.writeFileSync(OUTPUT_XML_PATH, outputContent, 'utf-8');
  console.log(`  Wrote output: ${OUTPUT_XML_PATH}`);

  if (noMatchEntries.length > 0) {
    // Write filtered LLM input (only strings that need kanjification)
    const llmContent = '<?xml version="1.0" encoding="UTF-8"?>\n<strings_for_llm>\n' +
      llmInputStrings.map(s => `  <string line="${s.lineNum}">${s.text}</string>`).join('\n') +
      '\n</strings_for_llm>';
    fs.writeFileSync(NO_MATCH_LOG_PATH, llmContent, 'utf-8');
    console.log(`  Wrote LLM input: ${NO_MATCH_LOG_PATH} (${llmInputStrings.length} strings)\n`);
  }

  // Step 7: Generate report
  console.log('Step 7: Generating report...');
  generateReport();
  console.log('\nConversion complete!');
}

function generateReport(): void {
  const report = [
    '='.repeat(70),
    'KANA TO KANJI CONVERSION REPORT (LCS-based)',
    '='.repeat(70),
    '',
    `Timestamp: ${new Date().toISOString()}`,
    '',
    'XML STATISTICS:',
    '-'.repeat(70),
    `Total XML string entries: ${stats.totalXmlStrings}`,
    `XML strings containing Kana: ${stats.xmlStringsWithKana}`,
    `  Percentage: ${((stats.xmlStringsWithKana / stats.totalXmlStrings) * 100).toFixed(2)}%`,
    '',
    `XML strings matched and converted: ${stats.xmlStringsMatched}`,
    `  Percentage of Kana strings: ${stats.xmlStringsWithKana > 0 ? ((stats.xmlStringsMatched / stats.xmlStringsWithKana) * 100).toFixed(2) : 0}%`,
    '',
    `XML strings with Kana (unmatched): ${stats.xmlStringsUnmatched}`,
    `  Percentage of Kana strings: ${stats.xmlStringsWithKana > 0 ? ((stats.xmlStringsUnmatched / stats.xmlStringsWithKana) * 100).toFixed(2) : 0}%`,
    '',
    `XML strings ready for LLM processing: ${stats.xmlStringsNeedingLLM}`,
    `  Percentage of unmatched: ${stats.xmlStringsUnmatched > 0 ? ((stats.xmlStringsNeedingLLM / stats.xmlStringsUnmatched) * 100).toFixed(2) : 0}%`,
    '',
    'CORPUS STATISTICS:',
    '-'.repeat(70),
    `Total corpus entries: ${stats.totalCorpusEntries}`,
    `Corpus entries used: ${stats.corpusEntriesUsed}`,
    `  Percentage: ${((stats.corpusEntriesUsed / stats.totalCorpusEntries) * 100).toFixed(2)}%`,
    '',
    'NEXT STEPS:',
    '-'.repeat(70),
    `Run 'pnpm run kanjify' to process ${stats.xmlStringsNeedingLLM} strings with LLM`,
    '',
    'FILES:',
    '-'.repeat(70),
    `Input XML: ${DUMP_XML_PATH}`,
    `Output XML: ${OUTPUT_XML_PATH}`,
    `Kana corpus: ${KANA_TXT_PATH}`,
    `Kanji corpus: ${KANJI_TXT_PATH}`,
    `LLM input: ${NO_MATCH_LOG_PATH}`,
    '',
    '='.repeat(70)
  ].join('\n');

  fs.writeFileSync(REPORT_PATH, report, 'utf-8');
  console.log('\n' + report);
  console.log(`\nReport written to ${REPORT_PATH}`);
}

main();

