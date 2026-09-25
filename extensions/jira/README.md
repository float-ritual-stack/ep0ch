# Jira Resource extension

Read-only Jira Cloud issue resolution and Markdown rendering through the installed Resource process contract. No Outliner source imports or dependencies: Bun is the runtime. Basic email/API-token and explicit Bearer authentication are separate modes. Credentials never go into the note or Source.

## Install on the service host

Copy this directory to your chosen extension directory (for example `~/.local/share/pi-herdr-outliner/extensions/jira`). In its manifest, replace `command[0]` with the absolute path returned by `command -v bun`. Keep `jira.ts` beside the manifest. No application rebuild or service restart is needed to install/update the extension.

Add the following provider entry to `~/.config/pi-herdr-outliner/resource-extensions.json`, preserving other entries:

```json
{
  "version": 1,
  "providers": {
    "jira": {
      "manifest": "/absolute/path/to/installed-jira/manifest.json",
      "enabled": true,
      "config": {"authMode": "basic", "email": "your-jira-email@example.com"},
      "credentials": {"token": {"keychainService": "jira-api-token"}}
    }
  }
}
```

The Keychain option applies to a macOS service. On Linux, or where a service environment is preferred, use `{"env":"JIRA_API_TOKEN"}`. A remote reader uses the service host's credentials, not the reader host's Keychain. One installed Jira credential/configuration currently serves the service's Jira Sources; per-Source credentials are a future configuration extension.

Create a Jira Source with `origin` (e.g. `https://your-site.atlassian.net`) and `project` (e.g. `PC`), then follow an explicit `[jira::PC-762]`. The old Source `credentialEnv` field is optional and ignored for Jira; authentication belongs to the installed extension. Existing UUIDs and cached representations stay intact. Bare `PC-762` page links retain their existing local-page behavior.

Atlassian documents Basic authentication for API tokens: https://developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis/ . Set `authMode` to `bearer` only for a credential/endpoint that accepts Bearer. This extension uses the configured site's `/rest/api/3/issue/` endpoint; it does not implement Atlassian OAuth token acquisition or the api.atlassian.com cloud-ID gateway.

Use Refresh (`r`) on the Resource. Missing installs, missing credentials, 401, 403 and missing issues report distinct failures while cached content remains readable. Provider errors are mapped to safe host messages. Redirects are rejected. HTTPS is required except for loopback test servers.

The extension does not create Jira comments, modify issues or perform automatic remote refresh. ADF headings, paragraphs, lists, quotes, inline formatting and code become Markdown; unsupported ADF nodes retain their textual children but are not promised visual fidelity.

## Updating and proof

Replace installed files and increment manifest `version` when changing rendering. The next invocation loads the new process. Change `enabled` to disable. Keep raw credentials out of files, shell arguments and logs.

`bun test test/jira-extension.test.ts` in the application repo copies this package outside the checkout and exercises real loopback HTTP authentication, readable ADF, identity and failure behavior through the installed runtime. `bun run test/e2e/jira-extension.ts` exercises local and forwarded Resource readers in a private Herdr session. These fixtures do not establish live Rexall credentials or laptop deployment; PIE-372 owns that field validation.
