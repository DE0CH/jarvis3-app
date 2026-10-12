// A chat's two actions, Rename and Delete, as centered dialogs (never alert()/confirm(), never a
// bottom sheet). Used by the sidebar's row menu and the chat header's menu.
import { useCallback, useState } from "react";
import { View } from "react-native";
import { usePathname, useRouter, type Href } from "expo-router";
import { StyleSheet } from "react-native-unistyles";
import { FormTextInput } from "@/components/ui/form-field";
import type { TaskView } from "./api-types";
import { tasksStore } from "./client";
import { chatHref, NEW_CHAT_HREF } from "./nav";
import { Banner, CenteredDialog } from "./ui";

const TITLE_MAX = 120;

type Open = { kind: "rename" | "delete"; chat: TaskView } | null;

export function useChatActions(): {
  rename: (chat: TaskView) => void;
  remove: (chat: TaskView) => void;
  dialogs: React.ReactNode;
} {
  const [open, setOpen] = useState<Open>(null);
  const rename = useCallback((chat: TaskView) => setOpen({ kind: "rename", chat }), []);
  const remove = useCallback((chat: TaskView) => setOpen({ kind: "delete", chat }), []);
  const close = useCallback(() => setOpen(null), []);
  let dialogs: React.ReactNode = null;
  if (open?.kind === "rename") {
    dialogs = <RenameDialog key={`r-${open.chat.id}`} chat={open.chat} onClose={close} />;
  } else if (open?.kind === "delete") {
    dialogs = <DeleteDialog key={`d-${open.chat.id}`} chat={open.chat} onClose={close} />;
  }
  return { rename, remove, dialogs };
}

function RenameDialog({ chat, onClose }: { chat: TaskView; onClose: () => void }) {
  const [title, setTitle] = useState(chat.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = title.trim();
  const save = useCallback(() => {
    if (!trimmed || trimmed.length > TITLE_MAX || busy) return;
    if (trimmed === chat.title) {
      onClose();
      return;
    }
    const run = async () => {
      setBusy(true);
      const failed = await tasksStore.rename(chat.id, trimmed);
      setBusy(false);
      if (failed) setError(failed);
      else onClose();
    };
    void run();
  }, [trimmed, busy, chat.id, chat.title, onClose]);
  return (
    <CenteredDialog
      visible
      title="Rename chat"
      message="The name shows in your chat list."
      confirmLabel="Save"
      busy={busy}
      confirmDisabled={!trimmed || trimmed.length > TITLE_MAX}
      onConfirm={save}
      onCancel={onClose}
      testID="jarvis3-rename-dialog"
    >
      <View style={styles.field}>
        <FormTextInput
          initialValue={chat.title}
          onChangeText={setTitle}
          onSubmitEditing={save}
          returnKeyType="done"
          autoFocus
          selectTextOnFocus
          maxLength={TITLE_MAX}
          accessibilityLabel="Chat name"
          testID="jarvis3-rename-input"
        />
        {error ? <Banner tone="error">{error}</Banner> : null}
      </View>
    </CenteredDialog>
  );
}

function DeleteDialog({ chat, onClose }: { chat: TaskView; onClose: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = useCallback(() => {
    if (busy) return;
    const run = async () => {
      setBusy(true);
      const failed = await tasksStore.remove(chat.id);
      setBusy(false);
      if (failed) {
        setError(failed);
        return;
      }
      onClose();
      // Deleting the open chat goes to a new chat, as the chat apps do.
      if (pathname === chatHref(chat.id)) router.replace(NEW_CHAT_HREF as Href);
    };
    void run();
  }, [busy, chat.id, onClose, pathname, router]);
  return (
    <CenteredDialog
      visible
      title="Delete chat?"
      message={`"${chat.title}" will be removed from your chats.`}
      confirmLabel="Delete"
      destructive
      busy={busy}
      onConfirm={confirm}
      onCancel={onClose}
      testID="jarvis3-delete-dialog"
    >
      {error ? <Banner tone="error">{error}</Banner> : null}
    </CenteredDialog>
  );
}

const styles = StyleSheet.create((theme) => ({
  field: {
    gap: theme.spacing[2],
  },
}));
