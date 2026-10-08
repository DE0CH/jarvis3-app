import { useCallback, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { StyleSheet } from "react-native-unistyles";
import { SettingsCard, SettingsSelect } from "@/components/settings";
import { SettingsTextAreaCard } from "@/components/settings-textarea";
import { Button } from "@/components/ui/button";
import { tasksStore } from "../client";
import { useAccount } from "../hooks";
import { messageOf } from "../stores";
import { Banner, Jarvis3Frame } from "../ui";

const PROMPT_MAX = 16_000;

function newRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function NewTaskScreen() {
  const router = useRouter();
  const account = useAccount();
  const models = account.models;
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One id per form, so a double press or a retry after a dropped answer creates one task.
  const requestId = useRef(newRequestId());

  const options = useMemo(
    () => (models?.models ?? []).map((entry) => ({ label: entry.label, value: entry.id })),
    [models],
  );
  const selectedModel = model ?? models?.default ?? options[0]?.value ?? "";
  const capReached = account.me?.usage.machineHoursCapReached === true;
  const trimmed = prompt.trim();

  const submit = useCallback(() => {
    if (!trimmed || submitting) return;
    const run = async () => {
      setSubmitting(true);
      setError(null);
      try {
        const task = await tasksStore.create({
          prompt: trimmed,
          ...(selectedModel ? { model: selectedModel } : {}),
          requestId: requestId.current,
        });
        router.replace(`/tasks/${encodeURIComponent(task.id)}` as Href);
      } catch (e) {
        setError(messageOf(e));
        setSubmitting(false);
      }
    };
    void run();
  }, [trimmed, submitting, selectedModel, router]);
  const cancel = useCallback(() => router.back(), [router]);

  return (
    <Jarvis3Frame title="New task" testID="jarvis3-new-task-screen">
      {capReached ? (
        <Banner tone="error">
          Your machine hours for this month are used up. Ask your admin to raise your limit.
        </Banner>
      ) : null}
      <View style={styles.field}>
        <Text style={styles.label}>What should the agent do?</Text>
        <SettingsTextAreaCard
          accessibilityLabel="First message"
          value=""
          onChangeText={setPrompt}
          placeholder="Describe the task, as you would to a colleague."
          testID="jarvis3-new-task-prompt"
          style={styles.prompt}
        />
        {prompt.length > PROMPT_MAX ? (
          <Text style={styles.error}>The first message is limited to 16,000 characters.</Text>
        ) : null}
      </View>
      {options.length > 0 ? (
        <SettingsCard>
          <SettingsSelect
            label="Model"
            hint="The organisation's chosen models."
            value={selectedModel}
            options={options}
            onValueChange={setModel}
          />
        </SettingsCard>
      ) : null}
      {error ? (
        <Banner tone="error" testID="jarvis3-new-task-error">
          {error}
        </Banner>
      ) : null}
      <View style={styles.buttons}>
        <Button variant="ghost" onPress={cancel} testID="jarvis3-new-task-cancel">
          Cancel
        </Button>
        <Button
          variant="default"
          onPress={submit}
          loading={submitting}
          disabled={!trimmed || prompt.length > PROMPT_MAX || capReached}
          testID="jarvis3-new-task-submit"
        >
          Start task
        </Button>
      </View>
    </Jarvis3Frame>
  );
}

const styles = StyleSheet.create((theme) => ({
  field: {
    gap: theme.spacing[2],
  },
  label: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    marginLeft: theme.spacing[1],
  },
  prompt: {
    minHeight: 180,
  },
  error: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.sm,
  },
  buttons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
}));
