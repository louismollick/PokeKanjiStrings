import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { needsKanjification } from './utils/needsKanjification.js';

// ES module compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Paths
const KANJI_XML_PATH = path.join(__dirname, '../strings/kanji/kanji_strings_sinnoh_ja.xml');
const LOGS_DIR = path.join(__dirname, '../logs');

if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
const NO_MATCH_LOG_PATH = path.join(LOGS_DIR, `no_match_${timestamp}.xml`);

/**
 * Check if string contains Kana
 */
function containsKana(text: string): boolean {
  return /[\u3040-\u309F\u30A0-\u30FF]/.test(text);
}

/**
 * Main function
 */
function main(): void {
  console.log('Finding strings that need kanjification...\n');

  // Step 1: Read XML
  console.log('Step 1: Reading XML...');
  if (!fs.existsSync(KANJI_XML_PATH)) {
    console.error(`Error: File not found: ${KANJI_XML_PATH}`);
    console.error('Please run "pnpm start" first to generate the kanji XML file.');
    process.exit(1);
  }

  const xmlContent = fs.readFileSync(KANJI_XML_PATH, 'utf-8');
  const xmlLines = xmlContent.split(/\r?\n/);
  console.log(`  XML lines: ${xmlLines.length}\n`);

  // Step 2: Parse XML strings with Kana that need kanjification
  console.log('Step 2: Finding strings with Kana that need conversion...');
  
  interface KanaString {
    lineNum: number;
    text: string;
  }

  const kanaStrings: KanaString[] = [];
  let totalWithKana = 0;

  xmlLines.forEach((line: string, lineNum: number) => {
    const match = line.match(/^(\s*<string\s+[^>]*>)(.*?)(<\/string>)$/);
    if (match && match[2]) {
      const text = match[2];

      if (containsKana(text)) {
        totalWithKana++;
        
        // Check if it needs kanjification
        if (needsKanjification(text)) {
          kanaStrings.push({
            lineNum: lineNum,
            text: text
          });
        }
      }
    }
  });

  console.log(`  Total strings with Kana: ${totalWithKana}`);
  console.log(`  Strings needing kanjification: ${kanaStrings.length}`);
  console.log(`  Percentage: ${totalWithKana > 0 ? ((kanaStrings.length / totalWithKana) * 100).toFixed(2) : 0}%\n`);

  // Step 3: Write output file
  console.log('Step 3: Writing output...');
  const llmContent = '<?xml version="1.0" encoding="UTF-8"?>\n<strings_for_llm>\n' +
    kanaStrings.map(s => `  <string line="${s.lineNum}">${s.text}</string>`).join('\n') +
    '\n</strings_for_llm>';
  
  fs.writeFileSync(NO_MATCH_LOG_PATH, llmContent, 'utf-8');
  console.log(`  Wrote: ${NO_MATCH_LOG_PATH}\n`);

  // Summary
  console.log('='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log(`Input file: ${KANJI_XML_PATH}`);
  console.log(`Output file: ${NO_MATCH_LOG_PATH}`);
  console.log(`Strings found: ${kanaStrings.length}`);
  console.log('='.repeat(70));
  console.log('\nNext step: Run "pnpm kanjify" or "pnpm kanjify:gemini" to convert these strings.');
}

main();

