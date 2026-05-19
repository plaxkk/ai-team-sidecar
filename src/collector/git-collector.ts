// Git log parser for DORA metrics
// Phase 1: count pushes to main as deploy proxy

import { execSync } from 'child_process';
import path from 'path';

export interface DeployEvent {
  deploy_at: number;
  commit_hash: string;
  commit_message: string;
  deploy_type: string;
}

export interface CommitLeadTime {
  commit_hash: string;
  commit_at: number;
  first_deploy_at: number;
  lead_time_hours: number;
}

/**
 * Parse git log for deploy events.
 * Phase 1: counts pushes to main branch as deploy proxy.
 */
export function parseGitDeploys(projectPath: string): DeployEvent[] {
  try {
    // Get merge commits and direct pushes to main
    const logOutput = execSync(
      `git -C "${projectPath}" log main --pretty=format:"%H|%at|%s" --max-count=100`,
      { encoding: 'utf8', timeout: 10000 }
    );

    if (!logOutput.trim()) return [];

    const events: DeployEvent[] = [];
    for (const line of logOutput.trim().split('\n')) {
      const parts = line.split('|');
      if (parts.length < 3) continue;

      const commitHash = parts[0];
      const timestamp = parseInt(parts[1], 10) * 1000; // git uses seconds
      const message = parts.slice(2).join('|');

      events.push({
        deploy_at: timestamp,
        commit_hash: commitHash,
        commit_message: message,
        deploy_type: 'push_to_main',
      });
    }

    return events;
  } catch {
    return [];
  }
}

/**
 * Calculate lead time between commits and their first deploy.
 */
export function parseCommitLeadTime(projectPath: string): CommitLeadTime[] {
  const deploys = parseGitDeploys(projectPath);
  if (deploys.length === 0) return [];

  // Get all commits (not just main)
  try {
    const logOutput = execSync(
      `git -C "${projectPath}" log --all --pretty=format:"%H|%at" --max-count=200`,
      { encoding: 'utf8', timeout: 10000 }
    );

    if (!logOutput.trim()) return [];

    const deployMap = new Map<string, number>();
    for (const deploy of deploys) {
      deployMap.set(deploy.commit_hash, deploy.deploy_at);
    }

    const leadTimes: CommitLeadTime[] = [];
    for (const line of logOutput.trim().split('\n')) {
      const parts = line.split('|');
      if (parts.length < 2) continue;

      const hash = parts[0];
      const commitAt = parseInt(parts[1], 10) * 1000;

      const deployAt = deployMap.get(hash);
      if (deployAt) {
        const leadTimeHours = (deployAt - commitAt) / (1000 * 60 * 60);
        leadTimes.push({
          commit_hash: hash,
          commit_at: commitAt,
          first_deploy_at: deployAt,
          lead_time_hours: Math.round(leadTimeHours * 100) / 100,
        });
      }
    }

    return leadTimes;
  } catch {
    return [];
  }
}
