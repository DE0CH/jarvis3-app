import { describe, expect, it } from "vitest";
import { splitAttachmentNote } from "./attachment-note";

describe("the session's attachment note", () => {
  it("is taken off the message and turned into file names", () => {
    const message =
      "Read the brief.\n\nThe user attached 2 files to this message (copied into /home/jarvis/workspace/attachments/):\n" +
      '- /home/jarvis/workspace/attachments/code-word.txt (text/plain, 57 bytes; "attachments/x/code-word.txt" in their files)\n' +
      '- "attachments/x/big.pdf" could not be copied (too large)';
    expect(splitAttachmentNote(message)).toEqual({
      text: "Read the brief.",
      files: [
        { name: "code-word.txt", failed: false },
        { name: "big.pdf", failed: true },
      ],
    });
  });
  it("leaves any other message alone", () => {
    expect(
      splitAttachmentNote("The user attached a file to this message, says the prompt"),
    ).toEqual({
      text: "The user attached a file to this message, says the prompt",
      files: [],
    });
  });
});
