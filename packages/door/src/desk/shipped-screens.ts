// The shipped screens the door holds from the screens extension's manifest (desk/shipped.ts): the ones that are data
// alone, registered as the extension's own until a host serves them.
import { targetFilled } from "@ep0ch/outline-core/screen-spec";
import { readSpec, registerScreen, screenNames } from "./screen-spec";
import { SHIPPED_EXTENSION, shippedScreens } from "./shipped";

/**
 * Register each shipped screen nobody holds the name of, as the extension's own: read by `readSpec` as any
 * extension's is, and opened on a target the way its spec says (outline-core's `targetFilled`). A name the door keeps
 * for a screen made from its own state (the desk's named layouts, the board's hub), or one a host is serving, stands.
 */
export function holdShippedScreens(): void {
  for (const raw of shippedScreens()) {
    if (screenNames().includes(raw.name)) continue;
    const spec = readSpec(raw);
    registerScreen(spec.name, args => targetFilled(readSpec(raw), args), { extension: SHIPPED_EXTENSION, ...(spec.target ? { target: spec.target.arg } : {}) });
  }
}
