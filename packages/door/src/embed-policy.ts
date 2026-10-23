import { isOutlineNote } from "./authored";
import type { Msg } from "./board";

/** The one place that decides whether this surface can expand an outline embed. */
export const expandsEmbeds = (available: boolean, note?: Msg): boolean => available && (!note || isOutlineNote(note));
