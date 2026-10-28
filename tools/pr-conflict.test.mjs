import assert from "node:assert/strict";
import { test } from "node:test";

import { COMMENT, LABEL, MARKER, main } from "./pr-conflict.mjs";

const REPO = "o/r";
const PR = "7";
const PULL_PATH = `repos/${REPO}/pulls/${PR}`;
const COMMENTS_PATH = `repos/${REPO}/issues/${PR}/comments`;
const LABELS_PATH = `repos/${REPO}/issues/${PR}/labels`;

/** A fake gh that records argv and answers from in-memory pull request state. */
function fakeGh({ mergeable = true, labels = [], comments = [] } = {}) {
  const calls = [];
  const queue = Array.isArray(mergeable) ? [...mergeable] : null;
  let current = queue ? undefined : mergeable;
  const state = { labels: new Set(labels), comments: comments.map((body) => ({ body })) };

  const runner = (args) => {
    calls.push(args);
    if (args[0] === "label") return "";

    const method = args.includes("--method") ? args[args.indexOf("--method") + 1] : "GET";
    const path = args.find((arg) => arg.startsWith("repos/"));
    if (method === "GET" && path === PULL_PATH) {
      if (queue) current = queue.shift();
      return JSON.stringify({ mergeable: current, labels: [...state.labels].map((name) => ({ name })) });
    }
    if (method === "GET" && path === COMMENTS_PATH) {
      return state.comments.map((comment) => comment.body).join("\n");
    }
    if (method === "POST" && path === COMMENTS_PATH) {
      const body = args.find((arg) => arg.startsWith("body=")).slice("body=".length);
      state.comments.push({ body });
      return "{}";
    }
    if (method === "POST" && path === LABELS_PATH) {
      state.labels.add(LABEL);
      return "[]";
    }
    if (method === "DELETE" && path === `${LABELS_PATH}/${LABEL}`) {
      state.labels.delete(LABEL);
      return "[]";
    }
    throw new Error(`unexpected gh call: ${args.join(" ")}`);
  };

  return { runner, calls, state };
}

const noSleep = async () => {};
const noLog = () => {};

test("a pull request that merges cleanly is left alone", async () => {
  const gh = fakeGh({ mergeable: true });
  const result = await main({ repo: REPO, pr: PR, runner: gh.runner, sleep: noSleep, log: noLog });

  assert.deepEqual(result, { mergeable: true, labeled: false, unlabeled: false, commented: false });
  assert.deepEqual(gh.calls, [["api", PULL_PATH]]);
});

test("a pull request that merges cleanly loses a stale conflict label and keeps comments", async () => {
  const gh = fakeGh({ mergeable: true, labels: [LABEL], comments: [MARKER] });
  const result = await main({ repo: REPO, pr: PR, runner: gh.runner, sleep: noSleep, log: noLog });

  assert.deepEqual(result, { mergeable: true, labeled: false, unlabeled: true, commented: false });
  assert.equal(gh.state.labels.has(LABEL), false);
  assert.equal(gh.state.comments.length, 1);
  assert.ok(!gh.calls.some((args) => args.includes("POST")));
});

test("a conflicted pull request gets the label and one rebase comment", async () => {
  const gh = fakeGh({ mergeable: false });
  const result = await main({ repo: REPO, pr: PR, runner: gh.runner, sleep: noSleep, log: noLog });

  assert.deepEqual(result, { mergeable: false, labeled: true, unlabeled: false, commented: true });

  const create = gh.calls.find((args) => args[0] === "label");
  assert.ok(create, "creates the conflict label");
  assert.ok(create.includes(LABEL));
  assert.ok(create.includes("--force"));
  assert.ok(create.includes("B60205"));
  assert.ok(create.includes(REPO));
  assert.ok(gh.calls.some((args) => args.includes("POST") && args.includes(LABELS_PATH)));

  assert.equal(gh.state.comments.length, 1);
  assert.equal(gh.state.comments[0].body, COMMENT);
  for (const command of ["git fetch origin main", "git rebase origin/main", "npm run check", "git push --force-with-lease"]) {
    assert.ok(COMMENT.includes(command), `comment mentions: ${command}`);
  }
});

test("an already labeled conflicted pull request is not labeled twice", async () => {
  const gh = fakeGh({ mergeable: false, labels: [LABEL] });
  const result = await main({ repo: REPO, pr: PR, runner: gh.runner, sleep: noSleep, log: noLog });

  assert.deepEqual(result, { mergeable: false, labeled: false, unlabeled: false, commented: true });
  assert.equal(gh.calls.filter((args) => args[0] === "label").length, 0);
  assert.ok(!gh.calls.some((args) => args.includes("POST") && args.includes(LABELS_PATH)));
});

test("an existing rebase comment is not posted again", async () => {
  const gh = fakeGh({ mergeable: false, comments: [`${MARKER}\nold instructions`] });
  const result = await main({ repo: REPO, pr: PR, runner: gh.runner, sleep: noSleep, log: noLog });

  assert.deepEqual(result, { mergeable: false, labeled: true, unlabeled: false, commented: false });
  assert.equal(gh.state.comments.length, 1);
  assert.ok(!gh.calls.some((args) => args.includes("POST") && args.includes(COMMENTS_PATH)));
});

test("polls while mergeable is null and stops at the first boolean", async () => {
  const gh = fakeGh({ mergeable: [null, null, false] });
  const sleeps = [];
  const result = await main({
    repo: REPO,
    pr: PR,
    runner: gh.runner,
    sleep: async (ms) => sleeps.push(ms),
    log: noLog,
    delayMs: 2000,
  });

  assert.equal(result.mergeable, false);
  assert.equal(gh.calls.filter((args) => args[1] === PULL_PATH).length, 3);
  assert.deepEqual(sleeps, [2000, 2000]);
});

test("fails clearly when mergeable stays unknown", async () => {
  const gh = fakeGh({ mergeable: [null, null, null] });
  const sleeps = [];

  await assert.rejects(
    main({ repo: REPO, pr: PR, runner: gh.runner, attempts: 3, delayMs: 50, sleep: async (ms) => sleeps.push(ms) }),
    /mergeable is still unknown after 3 attempts/,
  );
  assert.deepEqual(sleeps, [50, 50]);
});

test("gh failures reject with the command's message", async () => {
  const failure = new Error("gh api failed (exit 1): Not Found");
  await assert.rejects(
    main({
      repo: REPO,
      pr: PR,
      runner: () => {
        throw failure;
      },
    }),
    /exit 1/,
  );
});

test("requires REPO and PR", async () => {
  await assert.rejects(main({ repo: "", pr: PR }), /REPO is not set/);
  await assert.rejects(main({ repo: REPO, pr: "" }), /PR must be a positive integer/);
  await assert.rejects(main({ repo: REPO, pr: "seven" }), /PR must be a positive integer/);
});
