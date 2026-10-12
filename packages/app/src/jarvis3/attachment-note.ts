// The session tells the agent about a first message's attachments by appending a note to the
// message ("The user attached a file to this message (copied into …): - /home/…/name (…)"). The
// person never wrote that note, so the chat shows the message without it and the files as
// attachment chips by name (components/message.tsx UserMessage). Tested in attachment-note.test.ts.

const NOTE =
  /\n\nThe user attached (?:a file|\d+ files) to this message \(copied into [^\n]*\):\n((?:- [^\n]*(?:\n|$))+)\s*$/;

export interface AttachmentChip {
  name: string;
  /** The file couldn't be copied into the chat's workspace. */
  failed: boolean;
}

function baseName(path: string): string {
  const parts = path.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || path;
}

/** The message as the person wrote it, and the attached files' names. */
export function splitAttachmentNote(message: string): { text: string; files: AttachmentChip[] } {
  const match = NOTE.exec(message);
  if (!match) return { text: message, files: [] };
  const files = (match[1] ?? "")
    .split("\n")
    .filter((line) => line.startsWith("- "))
    .map((line): AttachmentChip => {
      const failed = /^- "([^"]+)" could not be copied/.exec(line);
      if (failed) return { name: baseName(failed[1] ?? ""), failed: true };
      const copied = /^- (.+?) \(/.exec(line);
      return { name: baseName(copied?.[1] ?? line.slice(2)), failed: false };
    });
  return { text: message.slice(0, match.index), files };
}
