import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { Ollama } from 'ollama';
import { GoogleGenerativeAI } from '@google/generative-ai';

// ES module compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Paths
const LOGS_DIR = path.join(__dirname, '../logs');
const OUTPUT_XML_PATH = path.join(__dirname, '../strings/kanji/kanji_strings_sinnoh_ja.xml');
const PROMPT_TEMPLATE_PATH = path.join(__dirname, 'prompt_template.txt');

// Configuration - check command line args
const USE_GEMINI = process.argv.includes('--gemini');
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error('Error: GEMINI_API_KEY environment variable is not set');
  process.exit(1);
}

// Ollama configuration
const ollama = new Ollama({ host: 'http://localhost:11434' });
const OLLAMA_MODEL = 'qwen2.5:7b-instruct-q4_K_M';

// Gemini configuration
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const GEMINI_MODEL = 'gemini-2.5-flash';

/**
 * Find the most recent file matching a pattern
 */
function findMostRecentFile(directory: string, pattern: RegExp): string | null {
  const files = fs.readdirSync(directory)
    .filter(file => pattern.test(file))
    .map(file => ({
      name: file,
      path: path.join(directory, file),
      time: fs.statSync(path.join(directory, file)).mtime.getTime()
    }))
    .sort((a, b) => b.time - a.time);

  return files.length > 0 ? files[0].path : null;
}

/**
 * Parse XML string entries from no_match file
 */
function parseNoMatchFile(filePath: string): { lineNum: number, text: string }[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const entries: { lineNum: number, text: string }[] = [];

  const regex = /<string line="(\d+)">(.*?)<\/string>/g;
  let match;

  while ((match = regex.exec(content)) !== null) {
    entries.push({
      lineNum: parseInt(match[1]),
      text: match[2]
    });
  }

  return entries;
}

/**
 * Process batch with LLM (Ollama or Gemini)
 */
async function processBatchWithLLM(
  batch: { lineNum: number, text: string }[],
  systemPrompt: string,
  retryAttempt = 0
): Promise<Map<number, string>> {
  const results = new Map<number, string>();
  const MAX_RETRIES = 3;

  // Format batch for LLM
  const batchInput = batch.map(item =>
    `<string line="${item.lineNum}">${item.text}</string>`
  ).join('\n');

  const fullPrompt = `${systemPrompt}

${batchInput}

OUTPUT (converted strings in same format):`;

  console.log(`  Processing batch of ${batch.length} strings...`);

  try {
    let responseText: string;

    if (USE_GEMINI) {
      // Use Gemini API
      const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
      const result = await model.generateContent(fullPrompt);
      responseText = result.response.text();
    } else {
      // Use Ollama
      const response = await ollama.generate({
        model: OLLAMA_MODEL,
        prompt: fullPrompt,
        keep_alive:"30m",
        options: {
          temperature: 0.1,
          num_ctx: 32768,
          num_gpu: 99,
          num_thread: 8
        }
      });
      responseText = response.response;
    }

    // Parse response
    const regex = /<string line="(\d+)">(.*?)<\/string>/g;
    let match;

    while ((match = regex.exec(responseText)) !== null) {
      const lineNum = parseInt(match[1]);
      const convertedText = match[2];
      results.set(lineNum, convertedText);
    }

    console.log(`  ✓ Parsed ${results.size}/${batch.length} converted strings from LLM response`);

    // Print sample results (first 5)
    if (results.size > 0) {
      console.log(`\n  Sample conversions from this batch:`);
      let count = 0;
      for (const [lineNum, text] of results) {
        if (count >= 5) break;
        const original = batch.find(b => b.lineNum === lineNum)?.text || '';
        console.log(`    Line ${lineNum}:`);
        console.log(`      Before: ${original.substring(0, 80)}${original.length > 80 ? '...' : ''}`);
        console.log(`      After:  ${text.substring(0, 80)}${text.length > 80 ? '...' : ''}`);
        count++;
      }
      console.log('');
    }

    // Check for missing line numbers
    const inputLineNums = new Set(batch.map(b => b.lineNum));
    const outputLineNums = new Set(results.keys());
    const missingLineNums = [...inputLineNums].filter(num => !outputLineNums.has(num));

    if (missingLineNums.length > 0) {
      console.log(`  ⚠️  Warning: ${missingLineNums.length} strings missing from response`);
      
      if (retryAttempt < MAX_RETRIES) {
        console.log(`  🔄 Retrying missing strings (attempt ${retryAttempt + 1}/${MAX_RETRIES})...`);
        
        // Retry only the missing strings
        const missingBatch = batch.filter(b => missingLineNums.includes(b.lineNum));
        const retryResults = await processBatchWithLLM(missingBatch, systemPrompt, retryAttempt + 1);
        
        // Merge retry results
        for (const [lineNum, text] of retryResults) {
          results.set(lineNum, text);
        }
        
        console.log(`  ✓ After retry: ${results.size}/${batch.length} strings converted`);
      } else {
        console.log(`  ❌ Max retries reached. ${missingLineNums.length} strings still missing.`);
        console.log(`     Missing line numbers: ${missingLineNums.slice(0, 10).join(', ')}${missingLineNums.length > 10 ? '...' : ''}`);
      }
    }

  } catch (error) {
    console.error(`  ❌ Error processing batch:`, error);
    
    // Retry the entire batch if it's a connection/API error
    if (retryAttempt < MAX_RETRIES) {
      console.log(`  🔄 Retrying entire batch (attempt ${retryAttempt + 1}/${MAX_RETRIES})...`);
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds before retry
      return await processBatchWithLLM(batch, systemPrompt, retryAttempt + 1);
    } else {
      console.error(`  ❌ Max retries reached. Batch failed.`);
    }
  }

  return results;
}

/**
 * Update XML file with converted strings
 */
function updateXMLFile(conversions: Map<number, string>): void {
  console.log('\nUpdating XML file...');

  const xmlContent = fs.readFileSync(OUTPUT_XML_PATH, 'utf-8');
  const xmlLines = xmlContent.split('\n');

  let updatedCount = 0;

  for (const [lineNum, convertedText] of conversions) {
    const line = xmlLines[lineNum];
    if (line) {
      // Replace the text between <string> tags
      const updated = line.replace(
        /(<string[^>]*>)(.*?)(<\/string>)/,
        `$1${convertedText}$3`
      );
      xmlLines[lineNum] = updated;
      updatedCount++;
    }
  }

  // Write updated XML
  fs.writeFileSync(OUTPUT_XML_PATH, xmlLines.join('\n'), 'utf-8');
  console.log(`  Updated ${updatedCount} strings in ${OUTPUT_XML_PATH}`);
}

/**
 * Main function
 */
async function main() {
  console.log('Starting LLM-based Kana to Kanji conversion...\n');

  // Find most recent no_match file
  console.log('Step 1: Finding input files...');
  const noMatchFile = findMostRecentFile(LOGS_DIR, /^no_match_.*\.xml$/);

  if (!noMatchFile) {
    console.error('Error: Could not find no_match file in logs/');
    console.error('Please run "pnpm start" first to generate this file.');
    process.exit(1);
  }

  console.log(`  Found no_match file: ${path.basename(noMatchFile)}`);
  console.log(`  Using prompt template: prompt_template.txt\n`);

  // Load input data
  console.log('Step 2: Loading input data...');
  const entries = parseNoMatchFile(noMatchFile);
  const systemPrompt = fs.readFileSync(PROMPT_TEMPLATE_PATH, 'utf-8');
  console.log(`  Loaded ${entries.length} strings to convert\n`);

  // Check connection based on selected provider
  console.log(`Step 3: Checking ${USE_GEMINI ? 'Gemini' : 'Ollama'} connection...`);
  if (USE_GEMINI) {
    try {
      // Test Gemini connection with a simple request
      const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
      await model.generateContent('test');
      console.log(`  ✓ Connected to Gemini API`);
      console.log(`  Using model: ${GEMINI_MODEL}`);
      console.log(`  Free tier limits: 10 RPM, 250 RPD\n`);
    } catch (error) {
      console.error('Error: Could not connect to Gemini API.');
      console.error('Please check your API key.');
      process.exit(1);
    }
  } else {
    try {
      await ollama.list();
      console.log(`  ✓ Connected to Ollama at http://localhost:11434`);
      console.log(`  Using model: ${OLLAMA_MODEL}\n`);
    } catch (error) {
      console.error('Error: Could not connect to Ollama.');
      console.error('Please ensure Ollama is running: https://ollama.com/');
      console.error('And that the model is installed: ollama pull qwen2.5:7b-instruct-q4_K_M');
      process.exit(1);
    }
  }

  // Process in batches
  console.log('Step 4: Processing with LLM...');
  // Gemini has much larger context window (~1M tokens) vs Ollama's 32K
  const BATCH_SIZE = USE_GEMINI ? 500 : 200;
  const allConversions = new Map<number, string>();

  const totalBatches = Math.ceil(entries.length / BATCH_SIZE);

  // Rate limiting for Gemini (10 RPM = 6 second delay between requests)
  const GEMINI_DELAY_MS = USE_GEMINI ? 6000 : 0;

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, Math.min(i + BATCH_SIZE, entries.length));
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;

    console.log(`\nBatch ${batchNum}/${totalBatches}:`);
    const conversions = await processBatchWithLLM(batch, systemPrompt);

    // Merge results
    for (const [lineNum, text] of conversions) {
      allConversions.set(lineNum, text);
    }

    console.log(`  Total converted so far: ${allConversions.size}/${entries.length}`);

    // Rate limiting for Gemini
    if (USE_GEMINI && batchNum < totalBatches) {
      console.log(`  Waiting 6 seconds (Gemini rate limit: 10 RPM)...`);
      await new Promise(resolve => setTimeout(resolve, GEMINI_DELAY_MS));
    }
  }

  // Update XML file
  console.log('\n' + '='.repeat(70));
  updateXMLFile(allConversions);

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('CONVERSION COMPLETE');
  console.log('='.repeat(70));
  console.log(`Total strings processed: ${entries.length}`);
  console.log(`Successfully converted: ${allConversions.size}`);
  console.log(`Conversion rate: ${((allConversions.size / entries.length) * 100).toFixed(2)}%`);
  console.log('='.repeat(70));
  console.log(`\nOutput written to: ${OUTPUT_XML_PATH}`);
}

main().catch(console.error);

