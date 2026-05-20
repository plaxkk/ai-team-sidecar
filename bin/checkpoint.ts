// CLI entry point for checkpoint, changelog, and social post operations
import { getDb } from '../src/collector/db.js';
import { createManualCheckpoint } from '../src/analysis/checkpoint-detector.js';
import { generateChangelog, getChangelogEntries, exportChangelogMd } from '../src/analysis/changelog-generator.js';
import { generateXiaohongshuPost, archivePost, getSocialPosts } from '../src/analysis/social-post-generator.js';

const command = process.argv[2];
const projectPath = getArg('--project') || process.cwd();
const label = getArg('--label') || 'Manual checkpoint';

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

function main() {
  const db = getDb();

  switch (command) {
    case 'create': {
      const id = createManualCheckpoint(db, projectPath, label);
      console.log(`✅ Checkpoint #${id} created for ${projectPath}: ${label}`);
      break;
    }

    case 'changelog': {
      const count = generateChangelog(db, projectPath);
      console.log(`📝 Generated ${count} changelog entries`);
      if (count > 0) {
        const filePath = exportChangelogMd(db, projectPath);
        console.log(`📄 CHANGELOG.md exported to: ${filePath}`);
      }
      // Print entries
      const entries = getChangelogEntries(db, projectPath);
      for (const entry of entries) {
        console.log(`  [${entry.change_type}] ${entry.title}`);
      }
      break;
    }

    case 'post': {
      const post = generateXiaohongshuPost(db, projectPath);
      if (!post) {
        console.log('⚠️  No changelog entries found. Run `checkpoint changelog` first.');
        break;
      }
      console.log(`📱 Social post #${post.id} generated:`);
      console.log('---');
      console.log(post.content);
      console.log('---');

      // Auto-archive
      const filePath = archivePost(db, post.id, projectPath);
      if (filePath) {
        console.log(`📁 Archived to: ${filePath}`);
      }
      break;
    }

    case 'list-checkpoints': {
      const rows = db.prepare(
        'SELECT * FROM checkpoints WHERE project_path = ? ORDER BY created_at DESC'
      ).all(projectPath);
      if (rows.length === 0) {
        console.log('No checkpoints found.');
        break;
      }
      for (const row of rows as any[]) {
        const date = new Date(row.created_at).toISOString().slice(0, 19);
        console.log(`  #${row.id} [${row.checkpoint_type}] ${row.label} (${date})`);
      }
      break;
    }

    default:
      console.log('Usage:');
      console.log('  node bin/checkpoint.ts create --project /path/to/project --label "描述"');
      console.log('  node bin/checkpoint.ts changelog --project /path/to/project');
      console.log('  node bin/checkpoint.ts post --project /path/to/project');
      console.log('  node bin/checkpoint.ts list-checkpoints --project /path/to/project');
      process.exit(1);
  }
}

main();
