/** ctrl held this long shows every tile's frame controls: a Kitty-protocol terminal reports the press alone, and a ctrl
 * chord must never flash them (Evan, Nov 3: "popping up like instantly"). */
export const XRAY_HOLD_MS = 500;

/** ctrl's frame controls: a press waits XRAY_HOLD_MS, a release or any other key first drops it; a tap toggles. */
export class XrayHold {
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private readonly show: (on?: boolean) => void) {}
  modifier(event: "press" | "release" | "tap"): void {
    const waiting = this.timer;
    this.drop();
    if (event === "press") this.timer = setTimeout(() => { this.timer = undefined; this.show(true); }, XRAY_HOLD_MS);
    else if (!(event === "release" && waiting)) this.show(event === "tap" ? undefined : false);
  }
  drop(): void { clearTimeout(this.timer); this.timer = undefined; }
}
