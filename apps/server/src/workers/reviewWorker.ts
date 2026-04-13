import { Worker } from 'bullmq';
import { redisConnection } from '../config/redis.js';
import { analyzeCode } from '../ai.js';
import { App } from 'octokit';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const privateKey = process.env.GITHUB_PRIVATE_KEY;

if (!privateKey) {
  throw new Error("GITHUB_PRIVATE_KEY is missing from environment variables");
}
const ghApp = new App({
  appId: process.env.GITHUB_APP_ID!,
  privateKey: privateKey,
});

export const reviewWorker = new Worker('analyze-code', async (job) => {
  // ONLY ADDED: commentId here
  const { bucket, installationId, pullNumber, owner, repo, filePath, commentId } = job.data;

  console.log(`👷 Worker: Processing PR #${pullNumber} [Job ID: ${job.id}]`);

  try {
    const octokit = await ghApp.getInstallationOctokit(installationId);
    
    const aiReviews = await analyzeCode(bucket);

    console.log('📊 AI Reviews received:', JSON.stringify(aiReviews, null, 2));

    if (aiReviews && aiReviews.length > 0) {
      // --- KEEP YOUR ORIGINAL POST REVIEWS LOGIC ---
      await octokit.request('POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews', {
        owner,
        repo,
        pull_number: pullNumber,
        event: 'COMMENT',
        comments: aiReviews.map((r: any) => {
          const hasRange = r.endLine && Number(r.endLine) > Number(r.line);
          
          // Fix for the 'any' type error we discussed
          const severityMap: any = {
            CRITICAL: { icon: '🔴', label: 'CRITICAL' },
            MEDIUM: { icon: '🟡', label: 'MEDIUM' },
            LOW: { icon: '🔵', label: 'LOW' }
          };
          const severityMetadata = severityMap[r.severity] || { icon: '💡', label: 'SUGGESTION' };

          return {
            path: r.file || filePath,
            body: `${severityMetadata.icon} **${severityMetadata.label}**: ${r.comment}`,
            side: 'RIGHT',
            line: hasRange ? Number(r.endLine) : Number(r.line),
            ...(hasRange && {
              start_line: Number(r.line),
              start_side: 'RIGHT'
            })
          };
        }),
      });

      // --- KEEP YOUR ORIGINAL SUMMARY TABLE LOGIC ---
      const counts = {
        CRITICAL: aiReviews.filter((r: any) => r.severity === 'CRITICAL').length,
        MEDIUM: aiReviews.filter((r: any) => r.severity === 'MEDIUM').length,
        LOW: aiReviews.filter((r: any) => r.severity === 'LOW').length,
      };

      const summaryTable = `
### 🤖 AI Code Review Summary for \`${filePath.split('/').pop()}\`

| Severity | Issues Found |
| :--- | :--- |
| 🔴 **CRITICAL** | ${counts.CRITICAL} |
| 🟡 **MEDIUM** | ${counts.MEDIUM} |
| 🔵 **LOW** | ${counts.LOW} |

---
*Detailed feedback has been added to the **Files changed** tab. Please address the critical items before merging.*
      `;

      // --- ONLY CHANGE: Use PATCH if commentId exists ---
      if (commentId) {
        await octokit.request('PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}', {
          owner,
          repo,
          comment_id: commentId,
          body: summaryTable.trim(),
        });
      } else {
        // Fallback to your old way if for some reason commentId is missing
        await octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', {
          owner,
          repo,
          issue_number: pullNumber,
          body: summaryTable.trim(),
        });
      }

      console.log(`✅ Updated summary for PR #${pullNumber}`);
    } 
  } catch (error) {
    console.error("❌ Worker Error:", error);
    throw error; 
  }
}, { connection: redisConnection });