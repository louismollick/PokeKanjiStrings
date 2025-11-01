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

if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
const NO_MATCH_LOG_PATH = path.join(LOGS_DIR, `no_match_${timestamp}.xml`);
const REPORT_PATH = path.join(LOGS_DIR, `report_${timestamp}.txt`);

interface Stats {
  totalXmlStrings: number;
  xmlStringsWithKana: number;
  xmlStringsModified: number;
  xmlStringsUnmatched: number;
  totalCorpusEntries: number;
  corpusEntriesUsed: number;
  totalReplacements: number;
}

const stats: Stats = {
  totalXmlStrings: 0,
  xmlStringsWithKana: 0,
  xmlStringsModified: 0,
  xmlStringsUnmatched: 0,
  totalCorpusEntries: 0,
  corpusEntriesUsed: 0,
  totalReplacements: 0
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
 * Normalize special characters
 */
function cleanSpecial(text: string): string {
  return text
    .replaceAll('\u00A0', ' ')
    .replaceAll('\u2007', ' ')
    .replaceAll('\u202F', ' ')
    .replaceAll('\u3000', ' ')
    .replaceAll('"', '"')
    .replaceAll('"', '"')
    .replaceAll('\u2018', "'")
    .replaceAll('\u2019', "'")
    .replaceAll('ー', 'ー')
    .replaceAll('－', 'ー')
    .replaceAll('\u2010', 'ー')
    .replaceAll('\u2013', 'ー')
    .replaceAll('\u2014', 'ー')
    .replaceAll('\u2015', 'ー')
    .replaceAll('\u2212', 'ー')
    .replaceAll('-', 'ー')
    .replaceAll('º', '°')
    .replaceAll('˚', '°')
    .replaceAll('ᵒ', '°')
    .replaceAll('〜', '～')
    .replaceAll('‥', '..')
    .replaceAll('…', '...')
    .normalize();
}

/**
 * Normalize for comparison
 */
function normalizeForComparison(text: string): string {
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

/**
 * Prepare corpus text for replacement (keeps linebreaks and punctuation, removes variables and extra spaces)
 */
function prepareCorpusForReplacement(text: string): string {
  let prepared = text;
  
  // Remove control characters (but keep \n)
  prepared = prepared.replace(/\\c/g, '');
  prepared = prepared.replace(/\\r/g, '');
  prepared = prepared.replace(/\r/g, '');
  
  // Remove corpus variables (we'll insert XML variables separately)
  prepared = prepared.replace(/\[VAR\s+[^\]]+\]/gi, '');
  
  // Clean special chars but keep literal \n and punctuation
  prepared = cleanSpecial(prepared);
  
  // Remove extra whitespace (full-width and regular spaces, tabs) but keep \n
  // Note: Keep punctuation!
  prepared = prepared.replace(/[　 \t]+/g, '');
  
  return prepared;
}


/**
 * Extract structure tokens from XML
 */
interface Token {
  type: 'text' | 'variable' | 'linebreak' | 'speaker';
  value: string;
}

function extractStructure(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let currentText = '';

  // Check for speaker name at start
  const speakerMatch = text.match(/^([ぁ-んァ-ヶー一-龯々〆〤]+『)/);
  if (speakerMatch) {
    tokens.push({ type: 'speaker', value: speakerMatch[1] });
    i = speakerMatch[1].length;
  }

  while (i < text.length) {
    // {00} variables
    if (text[i] === '{' && i + 3 < text.length && /[0-9A-F]{2}/i.test(text.substring(i + 1, i + 3)) && text[i + 3] === '}') {
      if (currentText) {
        tokens.push({ type: 'text', value: currentText });
        currentText = '';
      }
      tokens.push({ type: 'variable', value: text.substring(i, i + 4) });
      i += 4;
      continue;
    }

    // \n line breaks
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
 * Rebuild XML using corpus Kanji text (with its linebreaks) and inserting variables from original
 */
function rebuildWithCorpusKanji(structure: Token[], originalNormalized: string, corpusKanji: string): string {
  // Prepare the corpus Kanji (keeps \n, removes extra spaces)
  const preparedKanji = prepareCorpusForReplacement(corpusKanji);
  
  // Extract variable positions from the original structure
  interface VariableInfo {
    variable: string;
    positionInNormalized: number; // Where this variable appears in the normalized text
  }
  
  const variables: VariableInfo[] = [];
  let normalizedPos = 0;
  
  for (const token of structure) {
    if (token.type === 'text') {
      const cleanText = cleanSpecial(token.value).replace(/\s+/g, '');
      normalizedPos += cleanText.length;
    } else if (token.type === 'variable') {
      variables.push({
        variable: token.value,
        positionInNormalized: normalizedPos
      });
    }
    // Skip linebreaks and speakers - we'll use corpus linebreaks instead
  }
  
  // Now insert variables into the prepared Kanji at proportional positions
  const cleanOriginal = cleanSpecial(originalNormalized).replace(/\s+/g, '');
  const cleanKanji = preparedKanji.replace(/\\n/g, ''); // Remove \n for length calculation
  
  if (variables.length === 0) {
    // No variables to insert, just return the prepared Kanji
    return preparedKanji;
  }
  
  // Build result by inserting variables at scaled positions
  let result = '';
  let kanjiTextPos = 0; // Position in cleanKanji (no \n)
  let preparedPos = 0;  // Position in preparedKanji (with \n)
  
  for (const varInfo of variables) {
    // Calculate the proportional position in the new text
    const ratio = varInfo.positionInNormalized / cleanOriginal.length;
    const targetPos = Math.round(ratio * cleanKanji.length);
    
    // Add text from preparedKanji until we reach targetPos (accounting for \n)
    while (kanjiTextPos < targetPos && preparedPos < preparedKanji.length) {
      const char = preparedKanji[preparedPos];
      if (char === '\\' && preparedPos + 1 < preparedKanji.length && preparedKanji[preparedPos + 1] === 'n') {
        result += '\\n';
        preparedPos += 2;
      } else {
        result += char;
        preparedPos++;
        kanjiTextPos++;
      }
    }
    
    // Insert the variable
    result += varInfo.variable;
  }
  
  // Add remaining text
  result += preparedKanji.substring(preparedPos);
  
  return result;
}

/**
 * Main function
 */
function main(): void {
  console.log('Starting Kana to Kanji conversion (substring replacement approach)...\n');

  // Parse corpus
  console.log('Step 1: Parsing corpus...');
  const kanaLines = parseTxtFile(KANA_TXT_PATH);
  const kanjiLines = parseTxtFile(KANJI_TXT_PATH);
  stats.totalCorpusEntries = Math.min(kanaLines.length, kanjiLines.length);
  console.log(`  Corpus entries: ${stats.totalCorpusEntries}\n`);

  // Read XML
  console.log('Step 2: Reading XML...');
  const xmlContent = fs.readFileSync(DUMP_XML_PATH, 'utf-8');
  const xmlLines = xmlContent.split('\n');
  console.log(`  XML lines: ${xmlLines.length}\n`);

  // Parse XML strings
  console.log('Step 3: Parsing XML strings...');
  interface XmlString {
    lineNum: number;
    prefix: string;
    text: string;
    suffix: string;
    originalNormalized: string; // Keep the original for structure alignment
    currentNormalized: string;  // This gets updated as we make replacements
    structure: Token[];
  }

  const xmlStrings: XmlString[] = [];

  xmlLines.forEach((line: string, lineNum: number) => {
    const match = line.match(/^(\s*<string\s+[^>]*>)(.*?)(<\/string>)$/);
    if (match && match[1] && match[2] && match[3]) {
      stats.totalXmlStrings++;
      const text = match[2];
      const hasKana = containsKana(text);

      if (hasKana) {
        stats.xmlStringsWithKana++;
        const normalized = normalizeForComparison(text);
        xmlStrings.push({
          lineNum: lineNum,
          prefix: match[1],
          text: text,
          suffix: match[3],
          originalNormalized: normalized,
          currentNormalized: normalized,
          structure: extractStructure(text)
        });
      }
    }
  });

  console.log(`  Found ${xmlStrings.length} XML strings with Kana\n`);

  // Sort corpus entries by length (longest first) to handle overlaps correctly
  console.log('Step 4: Sorting corpus entries by length...');
  interface CorpusEntry {
    index: number;
    kana: string;
    kanji: string;
    normalizedKana: string;
    normalizedKanji: string;
  }

  const corpusEntries: CorpusEntry[] = [];
  for (let i = 0; i < stats.totalCorpusEntries; i++) {
    const kana = kanaLines[i];
    const kanji = kanjiLines[i];
    if (!kana || !kanji) continue;

    const normalizedKana = normalizeForComparison(kana);
    const normalizedKanji = normalizeForComparison(kanji);

    if (!normalizedKana || normalizedKana.length < 3) continue;

    corpusEntries.push({
      index: i,
      kana: kana,
      kanji: kanji,
      normalizedKana: normalizedKana,
      normalizedKanji: normalizedKanji
    });
  }

  // Sort by normalized length (descending - longest first)
  corpusEntries.sort((a, b) => b.normalizedKana.length - a.normalizedKana.length);
  console.log(`  Sorted ${corpusEntries.length} corpus entries\n`);

  // Process: Replace corpus kana with kanji in XML strings
  console.log('Step 5: Processing replacements (largest matches first)...');
  const modifiedXml: Map<number, string> = new Map();
  const fullyMatchedXml = new Set<number>(); // Track XML strings that had full matches
  const usedCorpusEntries = new Set<number>();

  for (let i = 0; i < corpusEntries.length; i++) {
    if (i % 5000 === 0 && i > 0) {
      console.log(`  Processed ${i}/${corpusEntries.length} corpus entries...`);
    }

    const entry = corpusEntries[i];

    // Try to find this corpus kana in any XML string (replace ALL occurrences)
    for (const xmlStr of xmlStrings) {
      // Skip if this XML was already fully matched (don't let partial matches overwrite full matches)
      if (fullyMatchedXml.has(xmlStr.lineNum)) {
        continue;
      }
      
      if (xmlStr.currentNormalized.includes(entry.normalizedKana)) {
        const beforeReplacement = xmlStr.currentNormalized;
        
        // Check if this is a full match (entire XML = this corpus entry)
        const isFullMatch = (beforeReplacement === entry.normalizedKana);
        
        let rebuilt: string;
        
        if (isFullMatch) {
          // Full match: use corpus Kanji with its linebreaks and punctuation
          rebuilt = rebuildWithCorpusKanji(xmlStr.structure, xmlStr.originalNormalized, entry.kanji);
          // Update current normalized to the kanji version
          xmlStr.currentNormalized = entry.normalizedKanji;
          // Mark as fully matched so it won't be overwritten by partial matches
          fullyMatchedXml.add(xmlStr.lineNum);
        } else {
          // Partial match: need to handle this carefully
          // For now, skip partial matches - we want clean full-string replacements only
          // This ensures we preserve punctuation and formatting from the corpus
          continue;
        }
        
        // Count replacements
        const occurrences = (beforeReplacement.match(new RegExp(entry.normalizedKana.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
        
        // Store the modified line
        modifiedXml.set(xmlStr.lineNum, xmlStr.prefix + rebuilt + xmlStr.suffix);
        
        stats.totalReplacements += occurrences;
        usedCorpusEntries.add(entry.index);
      }
    }
  }

  stats.corpusEntriesUsed = usedCorpusEntries.size;
  stats.xmlStringsModified = modifiedXml.size;
  stats.xmlStringsUnmatched = stats.xmlStringsWithKana - stats.xmlStringsModified;

  console.log(`  Total replacements: ${stats.totalReplacements}`);
  console.log(`  XML strings modified: ${stats.xmlStringsModified}\n`);

  // Write output
  console.log('Step 6: Writing output...');
  let outputContent = '';
  const noMatchEntries: string[] = [];

  xmlLines.forEach((line: string, lineNum: number) => {
    if (modifiedXml.has(lineNum)) {
      const modified = modifiedXml.get(lineNum);
      if (modified) {
        outputContent += modified + '\n';
      }
    } else {
      outputContent += line + '\n';

      // Log unmatched Kana strings
      const xmlStr = xmlStrings.find(x => x.lineNum === lineNum);
      if (xmlStr) {
        noMatchEntries.push(line);
      }
    }
  });

  fs.writeFileSync(OUTPUT_XML_PATH, outputContent, 'utf-8');
  console.log(`  Wrote output: ${OUTPUT_XML_PATH}`);

  if (noMatchEntries.length > 0) {
    const noMatchContent = '<?xml version="1.0" encoding="UTF-8"?>\n<no_matches>\n' +
      noMatchEntries.join('\n') + '\n</no_matches>';
    fs.writeFileSync(NO_MATCH_LOG_PATH, noMatchContent, 'utf-8');
    console.log(`  Wrote no-match log: ${NO_MATCH_LOG_PATH}\n`);
  }

  // Generate report
  console.log('Step 7: Generating report...');
  generateReport();
  console.log('\nConversion complete!');
}

function generateReport(): void {
  const report = [
    '='.repeat(70),
    'KANA TO KANJI CONVERSION REPORT',
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
    `XML strings modified (Kana → Kanji): ${stats.xmlStringsModified}`,
    `  Percentage of Kana strings: ${stats.xmlStringsWithKana > 0 ? ((stats.xmlStringsModified / stats.xmlStringsWithKana) * 100).toFixed(2) : 0}%`,
    '',
    `XML strings with Kana (unmatched): ${stats.xmlStringsUnmatched}`,
    `  Percentage of Kana strings: ${stats.xmlStringsWithKana > 0 ? ((stats.xmlStringsUnmatched / stats.xmlStringsWithKana) * 100).toFixed(2) : 0}%`,
    '',
    'CORPUS STATISTICS:',
    '-'.repeat(70),
    `Total corpus entries: ${stats.totalCorpusEntries}`,
    `Corpus entries used: ${stats.corpusEntriesUsed}`,
    `  Percentage: ${((stats.corpusEntriesUsed / stats.totalCorpusEntries) * 100).toFixed(2)}%`,
    `Total replacements made: ${stats.totalReplacements}`,
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

main();
