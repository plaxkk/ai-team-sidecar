// Backfill historical transcript data
import { findTranscriptFiles, importTranscript } from '../src/collector/transcript-reader.js';
import { getDb } from '../src/collector/db.js';
import { runAnalysis } from '../src/analysis/engine.js';

async function main() {
  const db = getDb();
  const files = findTranscriptFiles();

  if (files.length === 0) {
    console.log('No transcript files found. Looking in ~/.claude/projects for configured project paths.');
    return;
  }

  console.log(`Found ${files.length} transcript file(s):`);
  for (const f of files) {
    console.log(`  ${f}`);
  }

  for (const file of files) {
    const sessionId = file.split('/').pop()?.replace('.jsonl', '') || 'unknown';
    console.log(`\nImporting ${file}...`);
    const count = importTranscript(file, db);
    console.log(`  Imported ${count} entries as session ${sessionId}`);

    if (count > 0) {
      console.log(`  Running analysis...`);
      await runAnalysis(db, sessionId);
    }
  }

  console.log('\nBackfill complete!');
  db.close();
}

main().catch(err => {
  console.error('Backfill error:', err);
  process.exit(1);
});
