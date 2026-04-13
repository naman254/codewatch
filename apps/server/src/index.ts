import express from 'express';
import dotenv from 'dotenv';
import { App } from 'octokit';
import fs from 'fs';
import parseDiff from 'parse-diff';
import { createAIChunks } from './services/ai.service.js';
import { reviewQueue } from './queues/reviewQueue.js';
import './workers/reviewWorker.js';
import { redisConnection } from './config/redis.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// --- CONFIGURATION ---
const MAX_DIFF_SIZE_BYTES = 100 * 1024; // 100 KB limit

const privateKey = process.env.GITHUB_PRIVATE_KEY;

if (!privateKey) {
  throw new Error("GITHUB_PRIVATE_KEY is missing from environment variables");
}

const ghApp = new App({
  appId: process.env.GITHUB_APP_ID!,
  privateKey: privateKey,
});

app.use(express.json());

app.post('/webhook', async (req, res) => {
  const event = req.headers['x-github-event'];
  const payload = req.body;

  if (event === 'pull_request' && (payload.action === 'opened' || payload.action === 'synchronize')) {
    const { installation, pull_request, repository } = payload;

    try {
      const octokit = await ghApp.getInstallationOctokit(installation.id);
      const owner = repository.owner.login;
      const repo = repository.name;
      const pullNumber = pull_request.number;

      console.log(`🔍 Fetching diff for PR #${pullNumber}...`);

      const { data: diff } = await octokit.request(
        "GET /repos/{owner}/{repo}/pulls/{pull_number}",
        {
          owner,
          repo,
          pull_number: pullNumber,
          mediaType: { format: "diff" },
        }
      ) as unknown as { data: string };

      // --- PROTECTION LAYER 1: SIZE CHECK ---
      if (typeof diff === 'string' && diff.length > MAX_DIFF_SIZE_BYTES) {
        await octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', {
          owner,
          repo,
          issue_number: pullNumber,
          body: `⚠️ **AI Review Skipped**: Diff size (${(diff.length / 1024).toFixed(2)} KB) exceeds limit.`
        });
        return res.status(200).send('Diff too large');
      }

      // --- PROTECTION LAYER 2: RATE LIMIT ---
      const RATE_LIMIT_WINDOW = 3600; 
      const MAX_REVIEWS_PER_HOUR = 10;
      const rateLimitKey = `rate-limit:repo:${repository.id}`;
      const currentUsage = await redisConnection.incr(rateLimitKey);

      if (currentUsage === 1) await redisConnection.expire(rateLimitKey, RATE_LIMIT_WINDOW);

      if (currentUsage > MAX_REVIEWS_PER_HOUR) {
        const ttl = await redisConnection.ttl(rateLimitKey);
        await octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', {
          owner,
          repo,
          issue_number: pullNumber,
          body: `🚫 **Rate Limit Exceeded**: Try again in ${Math.ceil(ttl / 60)} minutes.`
        });
        return res.status(429).send('Rate limit exceeded');
      }

      // --- INITIAL STATUS COMMENT ---
      // We post this once so the user knows CodeWatch is alive.
      const initialComment = await octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', {
        owner,
        repo,
        issue_number: pullNumber,
        body: "🛡️ **CodeWatch** is analyzing your changes using the **GPT-OSS 120B model**... Hang tight! 🚀"
      });

      const commentId = initialComment.data.id;

      const files = parseDiff(diff);
      const aiBuckets = createAIChunks(files);
      
      console.log(`🧠 Created ${aiBuckets.length} buckets. Sending to Queue...`);

      for (const bucket of aiBuckets) {
        const fileMatch = bucket.match(/--- File: (.*?) ---/);
        const fileName = fileMatch ? fileMatch[1] : (files[0]?.to || 'index.js');

        await reviewQueue.add('analyze-code', {
          bucket,
          installationId: installation.id,
          pullNumber,
          owner,
          repo,
          filePath: fileName,
          commentId // Pass this to the worker so it can update this specific comment
        });
      }

      console.log(`🚀 Added ${aiBuckets.length} jobs to the queue.`);
    } catch (error) {
      console.error("❌ Error processing PR:", error);
    }
  }
  res.status(200).send('OK');
});

app.listen(PORT, () => console.log(`✅ Server ready on port ${PORT}`));