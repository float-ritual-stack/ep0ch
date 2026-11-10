import { ReaderPane } from "../desk/panes";
import { deskOf, type Section } from "./showcase";

export const BESIDE_SECTION: Section = {
  key: "beside", need: "open a card an installed extension keeps beside the note you are reading, and put it away", part: "reader attachments: the generic extension adapter, declared by an extension's record", files: "src/surface/extension-attachment.ts, src/surface/attachments.ts, outliner/extensions/beside/",
  aside: "In the power bar, & then install Beside (or act extensions.install id=beside), then act attachment.open target=beside.facts: its facts card (the title, the properties, how many notes sit under it) sits beside the note, drawn by the extension's own render script, and follows the reader to the next note. attachment.place target=beside.facts place=floating floats it, attachment.close target=beside.facts puts it away; removing the extension takes the kind with it (a target= it no longer declares is refused).",
  stage(n, show) {
    const r = new ReaderPane();
    return deskOf({ title: "showcase · beside", panes: [r], names: ["notes"] }, show, [[r, n.shed]]);
  },
};
