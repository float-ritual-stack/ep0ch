// OSC 8 is the only terminal control besides SGR that belongs in a drawn row.
export const OSC8 = /\x1b\]8;[^\x00-\x1f\x7f-\x9f;]*;[^\x00-\x1f\x7f-\x9f]*(?:\x07|\x1b\\)/;
export const OSC8_CLOSE = "\x1b]8;;\x1b\\";
export const DRAWN_PART = new RegExp(`(\\x1b\\[[\\d;:]*m|${OSC8.source})`);

export const OSC8_ALL = new RegExp(OSC8.source, "g");
export const OSC8_PART = new RegExp(`(${OSC8.source})`);
export const closesHyperlink = (sequence: string): boolean => /^\x1b\]8;[^;]*;(?:\x07|\x1b\\)$/.test(sequence);
