// The chat apps' composer: one rounded box with the text on top and a row of controls under it
// (attach, model, Projects on the left; send on the right), the same surface as Paseo's own chat
// composer. Used by the new chat and by a chat whose agent isn't connected; a live chat uses
// Paseo's composer. Enter sends on the web (Shift+Enter for a new line); on phones the send
// button sends.
import {
  forwardRef,
  type ReactNode,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Pressable, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ArrowUp } from "lucide-react-native";
import { EditingTextInput, type EditingTextInputHandle } from "@/components/ui/text-input";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { isWeb } from "@/constants/platform";
import type { Theme } from "@/styles/theme";

export const MESSAGE_MAX = 16_000;

export interface ChatComposerHandle {
  focus(): void;
  /** Puts text back into the box (a send that failed). */
  setText(text: string): void;
}

export const ChatComposer = forwardRef<
  ChatComposerHandle,
  {
    placeholder: string;
    autoFocus?: boolean;
    /** A send is in flight: the button spins and the box doesn't take another. */
    busy?: boolean;
    disabled?: boolean;
    /** Sends; resolves true when the text went (the box is then cleared). */
    onSend: (text: string) => Promise<boolean>;
    /** Chips above the text (attached files, picked Projects). */
    top?: ReactNode;
    /** Controls left of the send button. */
    tools?: ReactNode;
    /** Something to send even with no text (attachments only) — never for this app: text is required. */
    testID?: string;
  }
>(function ChatComposer(
  { placeholder, autoFocus, busy, disabled, onSend, top, tools, testID },
  ref,
) {
  const input = useRef<EditingTextInputHandle>(null);
  const [text, setText] = useState("");
  const trimmed = text.trim();
  const canSend = trimmed.length > 0 && text.length <= MESSAGE_MAX && !busy && !disabled;

  useImperativeHandle(
    ref,
    () => ({
      focus: () => input.current?.focus(),
      setText: (value: string) => {
        input.current?.replaceText(value);
        setText(value);
      },
    }),
    [],
  );

  const send = useCallback(() => {
    if (!canSend) return;
    const run = async () => {
      if (!(await onSend(trimmed))) return;
      input.current?.replaceText("");
      setText("");
    };
    void run();
  }, [canSend, trimmed, onSend]);
  const sendState = useMemo(() => ({ disabled: !canSend, busy: !!busy }), [canSend, busy]);

  const onKeyPress = useCallback(
    (event: { nativeEvent: { key: string; shiftKey?: boolean; isComposing?: boolean } }) => {
      const native = event.nativeEvent;
      if (native.key !== "Enter" || native.shiftKey || native.isComposing) return;
      (event as unknown as { preventDefault?: () => void }).preventDefault?.();
      send();
    },
    [send],
  );

  return (
    <View style={styles.box} testID={testID}>
      {top}
      <ComposerTextInput
        ref={input}
        multiline
        autoFocus={autoFocus}
        editable={!disabled}
        placeholder={placeholder}
        onChangeText={setText}
        onKeyPress={isWeb ? onKeyPress : undefined}
        accessibilityLabel="Message"
        testID={testID ? `${testID}-input` : undefined}
        style={styles.input}
      />
      <View style={styles.row}>
        <View style={styles.tools}>{tools}</View>
        <Pressable
          onPress={send}
          disabled={!canSend}
          style={[styles.send, !canSend && styles.sendDisabled]}
          accessibilityRole="button"
          accessibilityLabel="Send"
          accessibilityState={sendState}
          testID={testID ? `${testID}-send` : undefined}
        >
          {busy ? (
            <LoadingSpinner size={16} color="white" />
          ) : (
            <ThemedArrow size={18} uniProps={onAccent} />
          )}
        </Pressable>
      </View>
    </View>
  );
});

// Paseo's composer placeholder colour.
const ComposerTextInput = withUnistyles(EditingTextInput, (theme) => ({
  placeholderTextColor: theme.colors.surface4,
}));
const ThemedArrow = withUnistyles(ArrowUp);
const onAccent = (theme: Theme) => ({ color: theme.colors.accentForeground });

const styles = StyleSheet.create((theme) => ({
  box: {
    gap: theme.spacing[2],
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.borderAccent,
    borderRadius: theme.borderRadius["2xl"],
    paddingTop: { xs: theme.spacing[3], md: theme.spacing[4] },
    paddingBottom: { xs: theme.spacing[2], md: theme.spacing[3] },
    paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[4] },
  },
  input: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.content,
    minHeight: 24,
    maxHeight: 200,
    padding: 0,
    // as Paseo's composer: no lineHeight on native (the first character on a new line would
    // make the box jump), and no focus ring on the web (the box is the focus)
    ...(isWeb
      ? ({
          lineHeight: theme.fontSize.content * 1.4,
          outlineStyle: "none",
          outlineWidth: 0,
          outlineColor: "transparent",
        } as object)
      : {}),
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  tools: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[1],
    flexShrink: 1,
    marginLeft: -theme.spacing[1],
  },
  send: {
    width: 32,
    height: 32,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  sendDisabled: {
    opacity: theme.opacity[50],
  },
}));
