import assert from "node:assert/strict";
import path from "node:path";
import { loadConfig } from "../config.js";
import { dispatchCoworkerRequest } from "../dispatch.js";
import { getRuntimeReadiness } from "../readiness.js";
import { normalizeWebhookRequest } from "../normalization.js";
import { buildSystemPrompt } from "../prompts.js";
import { createSokosumiCompletionEvent, createSokosumiTaskRequest } from "../sokosumi.js";
import { createCoworkerRuntimeTools, RUNTIME_TOOL_NAMES } from "../tools.js";
import { createSokosumiTaskPoller } from "@masumi-network/pi-sokosumi/poller";

const config = loadConfig({
  ...process.env,
  COWORKER_PROMPT_ROOT: path.resolve(process.cwd(), "..", "..", "src", "agents"),
  PI_AGENT_MOCK_RESPONSES: "true"
});

await testPromptLoading();
await testWebhookNormalization();
await testDispatch();
await testSokosumiTaskMapping();
await testSokosumiTaskDefaultsToAgent();
await testRuntimeTools();
await testReadiness();
await testCompletedEventsIncludeCredits();
await testPollerTreatsDelegatedUserCommentAsInput();

console.log("xavi tests passed");

async function testPromptLoading() {
  const telegramPrompt = await buildSystemPrompt({
    promptRoot: config.promptRoot,
    agentId: "xavi",
    surface: "telegram"
  });
  assert.equal(telegramPrompt.agentId, "xavi");
  assert.equal(telegramPrompt.surface, "telegram");
  assert.match(telegramPrompt.systemPrompt, /Xavi/i);
  assert.ok(telegramPrompt.loadedFiles.some((file) => file.endsWith("identity.md")));

  const xaviPrompt = await buildSystemPrompt({
    promptRoot: config.promptRoot,
    agentId: "xavi",
    surface: "sokosumi"
  });
  assert.match(xaviPrompt.systemPrompt, /Xavi/i);
  assert.match(xaviPrompt.systemPrompt, /set_task_event_status/);
  assert.ok(xaviPrompt.loadedFiles.some((file) => file.endsWith("interfaces/sokosumi.md")));
}

async function testWebhookNormalization() {
  const request = normalizeWebhookRequest({
    surface: "telegram",
    headers: {
      "x-user-id": "user-1"
    },
    body: {
      message: {
        text: "Can you edit this?"
      },
      authorization: "secret",
      metadata: {
        organizationId: "org-1"
      }
    }
  });

  assert.equal(request.agentId, "xavi");
  assert.equal(request.surface, "telegram");
  assert.equal(request.userId, "user-1");
  assert.equal(request.organizationId, "org-1");
  assert.equal(request.message, "Can you edit this?");
  assert.equal((request.metadata?.sourcePayload as any).authorization, "[redacted]");
}

async function testDispatch() {
  const result = await dispatchCoworkerRequest(
    {
      agentId: "xavi",
      surface: "telegram",
      userId: "user-2",
      message: "Make this clip social-ready."
    },
    config,
    async ({ request, systemPrompt }) => ({
      agentId: request.agentId,
      reply: `${request.agentId}:${systemPrompt.includes("Xavi")}`
    })
  );

  assert.equal(result.agentId, "xavi");
  assert.equal(result.reply, "xavi:true");
}

async function testSokosumiTaskMapping() {
  const request = createSokosumiTaskRequest({
    task: {
      id: "task-1",
      title: "Edit product video",
      description: "Create short-form edits.",
      metadata: {
        userId: "user-3"
      }
    },
    event: {
      id: "event-1",
      status: "READY",
      comment: "Please handle this for TikTok."
    }
  });

  assert.equal(request.agentId, "xavi");
  assert.equal(request.surface, "sokosumi");
  assert.equal(request.userId, "user-3");
  assert.match(request.message, /TikTok/);
}

async function testSokosumiTaskDefaultsToAgent() {
  const request = createSokosumiTaskRequest({
    task: {
      id: "task-2",
      title: "Ambiguous task",
      description: "No coworker metadata."
    },
    event: {
      id: "event-2",
      status: "READY"
    }
  });
  assert.equal(request.agentId, "xavi");
}

async function testRuntimeTools() {
  const state: any = { toolResults: [] };
  const tools = createCoworkerRuntimeTools({
    agentId: "xavi",
    surface: "sokosumi",
    userId: "user-4",
    message: "test"
  }, state);
  assert.deepEqual(tools.map((tool: any) => tool.name), [...RUNTIME_TOOL_NAMES]);

  const byName = Object.fromEntries(tools.map((tool: any) => [tool.name, tool]));
  const searchResult = await byName.search_docs.execute("search-1", { query: "Xavi" });
  assert.equal(searchResult.details.ok, true);
  assert.ok(searchResult.details.data.results.some((result: any) => result.path.includes("src/agents/xavi")));

  const observationResult = await byName.log_observation.execute("obs-1", {
    observation: "User cares about Sokosumi Pi migration status.",
    category: "preference"
  });
  assert.equal(observationResult.details.effect, "runtime_log");

  await byName.complete_task.execute("complete-1", { summary: "Done." });
  assert.equal(state.taskEventStatus.status, "COMPLETED");
}

async function testReadiness() {
  const readyConfig = loadConfig({
    ...process.env,
    COWORKER_PROMPT_ROOT: config.promptRoot,
    COWORKERS_API_KEY: "test-key",
    OPENROUTER_API_KEY: "test-openrouter-key"
  });
  const readiness = getRuntimeReadiness(readyConfig);
  assert.equal(readiness.ok, true);

  const missingSokosumiKeyConfig = loadConfig({
    ...process.env,
    COWORKER_PROMPT_ROOT: config.promptRoot,
    COWORKERS_API_KEY: "test-key",
    OPENROUTER_API_KEY: "test-openrouter-key",
    SOKOSUMI_TASK_POLLER_ENABLED: "true",
    SOKOSUMI_COWORKER_API_KEY: ""
  });
  const missingSokosumiKeyReadiness = getRuntimeReadiness(missingSokosumiKeyConfig);
  assert.equal(missingSokosumiKeyReadiness.ok, false);
  assert.equal(missingSokosumiKeyReadiness.checks.sokosumiPollingConfigured, false);
}

async function testCompletedEventsIncludeCredits() {
  const event = createSokosumiCompletionEvent({
    agentId: "xavi",
    reply: "done"
  });
  assert.equal(event.status, "COMPLETED");
  assert.equal(event.credits, 0);
}

async function testPollerTreatsDelegatedUserCommentAsInput() {
  const createdEvents: any[] = [];
  const triggerEvent = {
    id: "evt-user-input",
    taskId: "task-input",
    userId: "user-1",
    origin: "USER",
    comment: "Here is the missing detail.",
    createdAt: "2026-01-01T00:01:00.000Z"
  };
  const task = {
    id: "task-input",
    status: "in_progress",
    events: [
      {
        id: "evt-input-required",
        taskId: "task-input",
        coworkerId: "xavi",
        status: "INPUT_REQUIRED",
        comment: "Need details.",
        createdAt: "2026-01-01T00:00:00.000Z"
      },
      triggerEvent
    ]
  };

  const poller = createSokosumiTaskPoller({
    client: {
      async listCoworkerEvents() {
        return { events: [triggerEvent], pagination: {} };
      },
      async getTask() {
        return task;
      },
      async createTaskEvent(_taskId: string, body: any) {
        createdEvents.push(body);
        return { id: `created-${createdEvents.length}`, ...body };
      }
    },
    createCompletedEvent: () => ({
      status: "COMPLETED",
      origin: "SOKOSUMI",
      comment: "Processed the new input.",
      credits: 0
    }),
    createRunningEvent: null
  } as any);

  await poller.tick();
  assert.equal(createdEvents.length, 1);
  assert.equal(createdEvents[0].comment, "Processed the new input.");
}
