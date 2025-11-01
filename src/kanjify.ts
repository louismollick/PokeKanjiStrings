import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import Ollama from 'ollama';

// ES module compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Paths
const LOGS_DIR = path.join(__dirname, '../logs');
const OUTPUT_XML_PATH = path.join(__dirname, '../strings/kanji/kanji_strings_sinnoh_ja.xml');
const PROMPT_TEMPLATE_PATH = path.join(__dirname, 'prompt_template.txt');

// Ollama configuration
const ollama = new Ollama({ host: 'http://localhost:11434' });
const MODEL_NAME = 'qwen2.5:7b-instruct-q4_K_M';

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
 * Process batch with LLM
 */
async function processBatchWithLLM(
  batch: { lineNum: number, text: string }[],
  systemPrompt: string
): Promise<Map<number, string>> {
  const results = new Map<number, string>();

  // Format batch for LLM
  const batchInput = batch.map(item =>
    `<string line="${item.lineNum}">${item.text}</string>`
  ).join('\n');

  const fullPrompt = `${systemPrompt}

${batchInput}

OUTPUT (converted strings in same format):`;

  console.log(`  Processing batch of ${batch.length} strings...`);

  try {
    const response = await ollama.generate({
      model: MODEL_NAME,
      prompt: fullPrompt,
      options: {
        temperature: 0.1,
        num_gpu: 1,
        num_thread: 8
      }
    });

    // Parse response
    const responseText = response.response;
    const regex = /<string line="(\d+)">(.*?)<\/string>/g;
    let match;

    while ((match = regex.exec(responseText)) !== null) {
      const lineNum = parseInt(match[1]);
      const convertedText = match[2];
      results.set(lineNum, convertedText);
    }

    console.log(`  Parsed ${results.size} converted strings from LLM response`);

  } catch (error) {
    console.error(`  Error processing batch:`, error);
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

  // Check if Ollama is running
  console.log('Step 3: Checking Ollama connection...');
  try {
    await ollama.list();
    console.log(`  ✓ Connected to Ollama at http://localhost:11434`);
    console.log(`  Using model: ${MODEL_NAME}\n`);
  } catch (error) {
    console.error('Error: Could not connect to Ollama.');
    console.error('Please ensure Ollama is running: https://ollama.com/');
    console.error('And that the model is installed: ollama pull qwen2.5:7b-instruct-q4_K_M');
    process.exit(1);
  }

  // Process in batches
  console.log('Step 4: Processing with LLM...');
  const BATCH_SIZE = 100;
  const allConversions = new Map<number, string>();

  const totalBatches = Math.ceil(entries.length / BATCH_SIZE);

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

