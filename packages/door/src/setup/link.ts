import { join } from "node:path";
import { linkKeyGroup } from "@ep0ch/outliner/link-config";
import type { Facts } from "./model";
import type { Step } from "./plan";
const xml = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const unit = (s: string) => '"' + s.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "%%") + '"';
export function linkInstallStep(f: Facts): Step | undefined {
  if (!f.linkConfig) return;
  const c = f.linkConfig, bun = f.bun.path;
  if (!bun || f.platform === "other") return { id: "machine-link", title: "Install the machine link", status: "manual", why: "Bun and launchd or systemd are required", commands: [] };
  const argv = [bun, f.repo.entry, "link", c.mode];
  const path = f.platform === "linux" ? join(f.home, ".config/systemd/user/ep0ch-link.service") : join(f.home, "Library/LaunchAgents/io.ep0ch.link.plist");
  const text = f.platform === "linux"
    ? `[Unit]\nDescription=ep0ch outbound machine link\nAfter=network-online.target\n\n[Service]\nExecStart=${argv.map(unit).join(" ")}\nEnvironment=${unit(`EP0CH_OUTLINES=${f.host.folder}`)}\nRestart=always\nRestartSec=5\n\n[Install]\nWantedBy=default.target\n`
    : `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>io.ep0ch.link</string><key>ProgramArguments</key><array>${argv.map(a => `<string>${xml(a)}</string>`).join("")}</array><key>EnvironmentVariables</key><dict><key>EP0CH_OUTLINES</key><string>${xml(f.host.folder)}</string></dict><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>5</integer><key>StandardErrorPath</key><string>${xml(join(f.home, "Library/Logs/ep0ch-link.log"))}</string></dict></plist>\n`;
  const machines = c.mode === "serve" ? c.machines : [c.machine];
  return { id: "machine-link", title: "Install the machine link", status: "do", why: `${c.mode}; keys from ${machines.map(linkKeyGroup).join(", ")}; restart on this checkout`, writes: [{ path, text }], commands: f.platform === "linux" ? ["systemctl --user daemon-reload", "systemctl --user enable ep0ch-link", "systemctl --user restart ep0ch-link"] : [`launchctl bootstrap gui/$(id -u) ${path}`, "launchctl kickstart -k gui/$(id -u)/io.ep0ch.link"] };
}
