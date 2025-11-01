# PokeMMO Kana -> Kanji Strings Conversion

Converts PokeMMO Platinum Japanese XML strings from Kana to Kanji using a hybrid approach: 
1. exact corpus matching with BDSP Kanji corpus [poke-corpus](https://github.com/abcboy101/poke-corpus)
2. LLM processing

## Getting Started

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Install Ollama and Model

```bash
# Install Ollama (local LLM server)
curl -fsSL https://ollama.com/install.sh | sh

# Pull the model (7B parameters, 4-bit quantized)
ollama pull qwen2.5:7b-instruct-q4_K_M

# Verify installation
ollama list
```

### 3. Run Exact Matching

```bash
pnpm start
```

This will:
- Find exact corpus matches (~21% of strings)
- Convert matched strings using LCS-based character mapping
- Generate:
  - `strings/kanji/kanji_strings_sinnoh_ja.xml` - Output with converted strings
  - `logs/no_match_<date>.xml` - Filtered strings for LLM processing (~18,000 strings)
  - `logs/report_<date>.txt` - Conversion statistics

### 4. Run LLM Processing

```bash
pnpm run kanjify
```

This will:
- Load the most recent `no_match_*.xml` file
- Use the prompt template in `src/prompt_template.txt` (with 20 hard-coded examples)
- Process strings in batches of 100
- Update `kanji_strings_sinnoh_ja.xml` with LLM-converted strings

**Expected time:** ~9 hours on RTX 2070 GPU

**Final coverage:** ~95%+ of all strings converted

## Quality Features

- **Variables preserved:** `{00}`, `{01}`, etc. stay in exact positions
- **Line breaks preserved:** `\n` stays in correct positions
- **Particles stay in kana:** の、は、を、が、に、へ、と、で、も、や、か
- **Pokemon names stay katakana:** ピカチュウ, イーブイ, ポケモン
- **Context-aware:** Uses 20 verified examples from the same game

## Smart Filtering

Automatically filters out strings that don't need LLM processing:
- Strings with >80% katakana (Pokemon names, moves)
- Strings with >50% roman letters (codes, abbreviations)  
- Strings already >50% kanji
- Strings with <3 hiragana characters

This reduces LLM processing from 25,206 to ~18,000 strings.

## Prompt Template

The LLM prompt is stored in `src/prompt_template.txt` and includes:
- Complete instructions for Pokemon game text conversion
- 20 hard-coded examples from exact matches
- Rules for preserving variables, linebreaks, particles, and Pokemon names

You can edit this file to customize the LLM behavior.

## Troubleshooting

**"Could not connect to Ollama"**
- Ensure Ollama is installed and running
- Check http://localhost:11434 is accessible
- Run `ollama list` to verify installation

**"Model not found"**
- Pull the model: `ollama pull qwen2.5:7b-instruct-q4_K_M`
- Verify with: `ollama list`

**"Out of memory" during LLM processing**
- Reduce BATCH_SIZE in `kanjify.ts` (default: 100)
- Try BATCH_SIZE=50 or 25 for lower VRAM GPUs

**Want to use a cloud LLM instead?**
- Modify `kanjify.ts` to use Gemini/Claude API instead of Ollama
- Cloud options: Gemini 1.5 Flash, Claude 3.5 Haiku

