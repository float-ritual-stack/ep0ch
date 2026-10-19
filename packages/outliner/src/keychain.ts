/** Read the password of one macOS Keychain item. */
export async function keychainItem(service: string, cwd = "/", timeoutMs = 3000): Promise<string | undefined> {
  if (process.platform !== "darwin") return undefined;
  try {
  const child = Bun.spawn(["/usr/bin/security", "find-generic-password", "-s", service, "-w"], { cwd, stdin: "ignore", stdout: "pipe", stderr: "ignore" });
  const timer = setTimeout(() => child.kill(), timeoutMs);
  try {
    const [text, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    return code === 0 ? text.trim() || undefined : undefined;
  } finally { clearTimeout(timer); }
  } catch { return undefined; }
}
