import { expect, test } from "bun:test";
import {
  MAX_REMOTE_ENTITY_COMMENT_LENGTH,
  ResourceCatalogError,
  normalizeResourceAddress,
  normalizeResourceProviderCommandInput,
  normalizeResourceRevisionRef,
  normalizeResourceSourceInput,
  resourceRevisionRefEquals,
  type Resource,
  type ResourceSource,
} from "../src/resources";
import {
  DefaultRemoteEntityProviderClient,
  type RemoteEntityResource,
  type RemoteEntitySource,
} from "../src/remote-entity";

const SOURCE_ID = "11111111-1111-4111-8111-111111111111";
const RESOURCE_ID = "22222222-2222-4222-8222-222222222222";
const CREATED_AT = "2026-09-17T10:00:00.000Z";

function jiraSource(): Extract<ResourceSource, { provider: `ext:${string}` }> {
  return {
    id: SOURCE_ID,
    name: "Platform Jira",
    provider: "ext:jira",
    boundary: {
      kind: "ext:jira",
      origin: "https://jira.example.com",
      project: "PLAT",
      credentialEnv: "JIRA_TOKEN",
    },
    policy: { deniedCapabilities: [] },
    version: 1,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

function jiraResource(key = "PLAT-7"): Extract<Resource, { provider: `ext:${string}` }> {
  return {
    id: RESOURCE_ID,
    sourceId: SOURCE_ID,
    provider: "ext:jira",
    address: { kind: "ext:jira", entityId: "10001", key },
    version: 1,
    addressVersion: 1,
    mediaType: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

function linearSource(): Extract<ResourceSource, { provider: "linear" }> {
  return {
    id: SOURCE_ID,
    name: "Product Linear",
    provider: "linear",
    boundary: {
      kind: "linear",
      origin: "https://api.linear.app",
      workspace: "workspace-1",
      credentialEnv: "LINEAR_API_KEY",
    },
    policy: { deniedCapabilities: [] },
    version: 1,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

function linearResource(identifier = "ENG-9"): Extract<Resource, { provider: "linear" }> {
  return {
    id: RESOURCE_ID,
    sourceId: SOURCE_ID,
    provider: "linear",
    address: { kind: "linear", entityId: "issue-immutable-id", identifier },
    version: 1,
    addressVersion: 1,
    mediaType: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

test("Jira and Linear source boundaries normalize explicit credential references without secrets", () => {
  expect(normalizeResourceSourceInput({
    name: " Jira ",
    provider: "ext:jira",
    boundary: {
      origin: "https://jira.example.com/",
      project: "plat",
      credentialEnv: "JIRA_TOKEN",
    },
  })).toEqual({
    name: "Jira",
    provider: "ext:jira",
    boundary: {
      origin: "https://jira.example.com",
      project: "PLAT",
      credentialEnv: "JIRA_TOKEN",
    },
    policy: { deniedCapabilities: [] },
  });

  expect(normalizeResourceSourceInput({
    name: "Linear",
    provider: "linear",
    boundary: {
      origin: "https://api.linear.app/",
      workspace: "workspace-1",
      credentialEnv: "LINEAR_API_KEY",
    },
  })).toMatchObject({
    provider: "linear",
    boundary: {
      origin: "https://api.linear.app",
      workspace: "workspace-1",
      credentialEnv: "LINEAR_API_KEY",
    },
  });
});

test("remote entity canonical identity ignores mutable Jira and Linear locators", () => {
  const jira = jiraSource();
  const jiraOld = normalizeResourceAddress(jira, {
    kind: "ext:jira",
    entityId: "10001",
    key: "PLAT-7",
  });
  const jiraMoved = normalizeResourceAddress(jira, {
    kind: "ext:jira",
    entityId: "10001",
    key: "PLAT-42",
  });
  expect(jiraOld.canonicalKey).toBe("10001");
  expect(jiraMoved.canonicalKey).toBe(jiraOld.canonicalKey);

  const linear = linearSource();
  const linearOld = normalizeResourceAddress(linear, {
    kind: "linear",
    entityId: "issue-immutable-id",
    identifier: "ENG-9",
  });
  const linearMoved = normalizeResourceAddress(linear, {
    kind: "linear",
    entityId: "issue-immutable-id",
    identifier: "CORE-12",
  });
  expect(linearMoved.canonicalKey).toBe(linearOld.canonicalKey);

  const resource = jiraResource();
  const offsetRevision = normalizeResourceRevisionRef({
    resourceId: resource.id,
    addressVersion: resource.addressVersion,
    revision: {
      kind: "ext:jira",
      validator: { kind: "updated-at", value: "2026-09-17T12:00:00+02:00" },
    },
  }, resource);
  const utcRevision = normalizeResourceRevisionRef({
    resourceId: resource.id,
    addressVersion: resource.addressVersion,
    revision: {
      kind: "ext:jira",
      validator: { kind: "updated-at", value: "2026-09-17T10:00:00.000Z" },
    },
  }, resource);
  expect(resourceRevisionRefEquals(offsetRevision, utcRevision)).toBe(true);
});

test("Linear observation maps GraphQL issue response without changing entity identity", async () => {
  const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), init });
    return jsonResponse({
      data: {
        issue: {
          id: "issue-immutable-id",
          identifier: "CORE-12",
          title: "Ship remote entities",
          description: "Consumer-visible **Markdown**.",
          url: "https://linear.app/acme/issue/CORE-12/ship-remote-entities",
          updatedAt: "2026-09-17T11:00:00.000Z",
          priorityLabel: "Urgent",
          state: { name: "Started" },
          assignee: { name: "Lin Ear" },
          labels: { nodes: [{ name: "provider" }, { name: "entity" }] },
          team: {
            key: "CORE",
            organization: { id: "workspace-1", urlKey: "acme", name: "Acme" },
          },
        },
      },
    });
  }) as typeof fetch;
  const client = new DefaultRemoteEntityProviderClient({
    fetch: fetcher,
    resolveCredential: () => "linear-secret",
    now: () => "2026-09-17T11:01:00.000Z",
  });

  expect(requests).toHaveLength(0);
  const document = await client.observe(linearResource(), linearSource());

  expect(requests).toHaveLength(1);
  expect(requests[0]?.url).toBe("https://api.linear.app/graphql");
  expect(requests[0]?.init?.method).toBe("POST");
  expect(JSON.parse(String(requests[0]?.init?.body))).toMatchObject({
    variables: { id: "issue-immutable-id" },
  });
  expect(document).toMatchObject({
    title: "Ship remote entities",
    metadata: {
      identifier: "CORE-12",
      status: "Started",
      priority: "Urgent",
      assignee: "Lin Ear",
      labels: ["entity", "provider"],
      team: "CORE",
    },
    externalUrl: "https://linear.app/acme/issue/CORE-12/ship-remote-entities",
    sourceSnapshot: {
      provider: "linear",
      entityId: "issue-immutable-id",
      locator: "CORE-12",
    },
    commandDescriptors: [{ provider: "linear", command: "comment.create" }],
  });
  expect(document.markdown).toContain("Consumer-visible **Markdown**.");
});

test("Linear comment commands map provider responses into token-free receipts", async () => {
  const linearRequests: RequestInit[] = [];
  const linearClient = new DefaultRemoteEntityProviderClient({
    fetch: (async (_input: string | URL | Request, init?: RequestInit) => {
      if (init) linearRequests.push(init);
      return jsonResponse({
        data: {
          commentCreate: {
            success: true,
            comment: { id: "linear-comment-1" },
          },
        },
      });
    }) as typeof fetch,
    resolveCredential: () => "linear-secret",
    now: () => "2026-09-17T12:01:00.000Z",
  });
  const linearReceipt = await linearClient.execute(linearResource(), linearSource(), {
    provider: "linear",
    command: "comment.create",
    payload: { body: "A Linear comment" },
  });
  expect(JSON.parse(String(linearRequests[0]?.body))).toMatchObject({
    variables: {
      issueId: "issue-immutable-id",
      body: "A Linear comment",
    },
  });
  expect(linearReceipt).toEqual({
    resourceId: RESOURCE_ID,
    provider: "linear",
    command: "comment.create",
    entityId: "issue-immutable-id",
    externalId: "linear-comment-1",
    executedAt: "2026-09-17T12:01:00.000Z",
  });
  expect(JSON.stringify(linearReceipt)).not.toContain("linear-secret");
});

test("provider requests abort on the configured deadline", async () => {
  let aborted = false;
  const client = new DefaultRemoteEntityProviderClient({
    fetch: ((_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        signal?.addEventListener("abort", () => {
          aborted = true;
          reject(signal.reason);
        }, { once: true });
      })) as typeof fetch,
    resolveCredential: () => "secret",
    requestTimeoutMs: 5,
  });

  await expect(client.observe(linearResource(), linearSource())).rejects.toThrow(
    "linear provider request failed",
  );
  expect(aborted).toBe(true);
});

test("command ingress rejects unknown, excess, and oversized input before provider I/O", async () => {
  let credentialResolutions = 0;
  let fetches = 0;
  const client = new DefaultRemoteEntityProviderClient({
    fetch: (async () => {
      fetches += 1;
      return jsonResponse({ id: "comment-1" });
    }) as unknown as typeof fetch,
    resolveCredential: () => {
      credentialResolutions += 1;
      return "secret";
    },
  });

  expect(() => normalizeResourceProviderCommandInput({
    provider: "ext:jira",
    command: "issue.delete",
    payload: { body: "No" },
  })).toThrow(ResourceCatalogError);
  expect(() => normalizeResourceProviderCommandInput({
    provider: "ext:jira",
    command: "comment.create",
    payload: { body: "No", privileged: true },
  })).toThrow(ResourceCatalogError);
  expect(() => normalizeResourceProviderCommandInput({
    provider: "linear",
    command: "comment.create",
    payload: { body: "x".repeat(MAX_REMOTE_ENTITY_COMMENT_LENGTH + 1) },
  })).toThrow(ResourceCatalogError);

  const malformed = {
    provider: "ext:jira",
    command: "comment.create",
    payload: { body: "Looks valid" },
    entityId: "different-issue",
  };
  await expect(client.execute(
    jiraResource() satisfies RemoteEntityResource,
    jiraSource() satisfies RemoteEntitySource,
    malformed as never,
  )).rejects.toMatchObject({ code: "invalid-input" });
  expect(credentialResolutions).toBe(0);
  expect(fetches).toBe(0);
});
