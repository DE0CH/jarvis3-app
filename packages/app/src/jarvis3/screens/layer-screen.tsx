// My instructions & skills: the user's personal layer (docs/API.md section 7). Read, edit and
// delete; Reset to company default (archived, with Undo). Changes apply from the next task.
// When the instance has it set up, each item can be suggested for everyone (suggestions.tsx).
import { useCallback, useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SettingsCard, SettingsInput, SettingsRow, SettingsSection } from "@/components/settings";
import { SettingsTextAreaCard } from "@/components/settings-textarea";
import { Button } from "@/components/ui/button";
import type { PersonalLayerView, PersonalNote, PersonalSkill } from "../api-types";
import { layerStore } from "../client";
import { useAccount, useLayer } from "../hooks";
import { canUndoLayer, INSTRUCTIONS_MAX, isLayerEmpty, validateSkill } from "../plan";
import type { LayerState } from "../stores";
import { Banner, CenteredDialog, EmptyState, Jarvis3Frame } from "../ui";
import {
  SuggestButton,
  SuggestionsCard,
  type SuggestionsState,
  useSuggestions,
} from "./suggestions";
import { countOf } from "../count";

type Pending = { kind: "reset" } | { kind: "skill"; name: string } | { kind: "note"; id: string };

const TITLE = "My instructions & skills";

function undo(): void {
  void layerStore.undo();
}

function dialogText(pending: Pending | null): { title: string; message: string; confirm: string } {
  if (pending?.kind === "reset") {
    return {
      title: "Reset to company default?",
      message:
        "Your instructions, skills and notes are archived and your next task starts with the company's setup only. You can undo this.",
      confirm: "Reset",
    };
  }
  return {
    title: pending?.kind === "skill" ? `Delete the skill "${pending.name}"?` : "Delete this note?",
    message: "It won't be loaded into your next task.",
    confirm: "Delete",
  };
}

export function LayerScreen() {
  const layerState = useLayer();
  const account = useAccount();
  const suggestionsOn = account.me?.features?.suggestions === true;
  const suggestions = useSuggestions(suggestionsOn);
  const suggestState = suggestionsOn ? suggestions : null;
  const [pending, setPending] = useState<Pending | null>(null);
  // Bumped after a Reset so the editors start again from the server's (empty) layer.
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    void layerStore.load();
  }, []);

  const cancel = useCallback(() => setPending(null), []);
  const confirm = useCallback(() => {
    const current = pending;
    setPending(null);
    if (!current) return;
    const run = async () => {
      if (current.kind === "reset") {
        if (await layerStore.reset()) setGeneration((value) => value + 1);
      } else if (current.kind === "skill") {
        await layerStore.deleteSkill(current.name);
      } else {
        await layerStore.deleteNote(current.id);
      }
    };
    void run();
  }, [pending]);

  const layer = layerState.layer;
  if (!layerState.loaded || !layer) {
    return (
      <Jarvis3Frame title={TITLE}>
        {layerState.loaded ? (
          <Banner tone="error">{layerState.error ?? "Couldn't load your instructions."}</Banner>
        ) : (
          <EmptyState title="Loading…" />
        )}
      </Jarvis3Frame>
    );
  }

  const text = dialogText(pending);
  return (
    <Jarvis3Frame title={TITLE} testID="jarvis3-layer">
      <Text style={styles.intro}>
        What you add here is loaded into every task you start, after the company&apos;s own
        instructions. Changes apply from your next task; running tasks keep what they started with.
      </Text>
      <LayerNotices state={layerState} layer={layer} />
      {suggestState ? <SuggestionBanners state={suggestState} /> : null}
      <InstructionsSection
        key={`i-${generation}-${layer.updatedAt ?? ""}`}
        layer={layer}
        busy={layerState.busy}
        suggestions={suggestState}
      />
      <SkillsSection
        key={`s-${generation}`}
        layer={layer}
        onDelete={setPending}
        suggestions={suggestState}
      />
      <NotesSection layer={layer} onDelete={setPending} suggestions={suggestState} />
      {suggestState?.list && suggestState.list.length > 0 ? (
        <SettingsSection title="Suggested for everyone">
          <SuggestionsCard list={suggestState.list} testID="jarvis3-my-suggestions" />
        </SettingsSection>
      ) : null}
      <ResetSection state={layerState} layer={layer} onReset={setPending} />
      <CenteredDialog
        visible={pending !== null}
        title={text.title}
        message={text.message}
        confirmLabel={text.confirm}
        destructive
        onCancel={cancel}
        onConfirm={confirm}
        testID="jarvis3-layer-dialog"
      />
    </Jarvis3Frame>
  );
}

function LayerNotices({ state, layer }: { state: LayerState; layer: PersonalLayerView }) {
  if (state.lastReset) {
    const message =
      state.lastReset.version === null
        ? "Nothing to reset: you were already on the company default."
        : "Reset to company default. Your previous instructions and skills were archived.";
    return (
      <Banner tone="ok" testID="jarvis3-reset-banner">
        {message}
        {canUndoLayer(layer) ? (
          <Button variant="outline" size="sm" onPress={undo} testID="jarvis3-undo">
            Undo
          </Button>
        ) : null}
      </Banner>
    );
  }
  return (
    <>
      {state.notice ? (
        <Banner tone="info" testID="jarvis3-layer-notice">
          {state.notice}
        </Banner>
      ) : null}
      {state.error ? <Banner tone="error">{state.error}</Banner> : null}
    </>
  );
}

function SuggestionBanners({ state }: { state: SuggestionsState }) {
  return (
    <>
      {state.opened ? (
        <Banner tone="ok" testID="jarvis3-suggest-banner">
          {`Suggested. An admin reviews it as pull request #${state.opened.number}.`}
        </Banner>
      ) : null}
      {state.error ? <Banner tone="error">{state.error}</Banner> : null}
    </>
  );
}

const INSTRUCTIONS_TARGET = { kind: "instructions" } as const;

function InstructionsSection({
  layer,
  busy,
  suggestions,
}: {
  layer: PersonalLayerView;
  busy: boolean;
  suggestions: SuggestionsState | null;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? layer.instructions;
  const changed = draft !== null && draft !== layer.instructions;
  const tooLong = text.length > INSTRUCTIONS_MAX;
  const save = useCallback(() => {
    const run = async () => {
      if (await layerStore.setInstructions(text)) setDraft(null);
    };
    void run();
  }, [text]);
  return (
    <SettingsSection title="Instructions">
      <SettingsTextAreaCard
        accessibilityLabel="My instructions"
        value={layer.instructions}
        onChangeText={setDraft}
        placeholder="For example: answer in German; I work in the finance team."
        testID="jarvis3-instructions"
      />
      <View style={styles.rowButtons}>
        {tooLong ? <Text style={styles.error}>Limited to 64,000 characters.</Text> : null}
        {suggestions && !changed && layer.instructions.trim() !== "" ? (
          <SuggestButton
            state={suggestions}
            target={INSTRUCTIONS_TARGET}
            label="Your instructions"
          />
        ) : null}
        <Button
          variant="default"
          size="sm"
          disabled={!changed || tooLong}
          loading={busy && changed}
          onPress={save}
          testID="jarvis3-instructions-save"
        >
          Save
        </Button>
      </View>
    </SettingsSection>
  );
}

function SkillsSection({
  layer,
  onDelete,
  suggestions,
}: {
  layer: PersonalLayerView;
  onDelete: (pending: Pending) => void;
  suggestions: SuggestionsState | null;
}) {
  const [editing, setEditing] = useState<PersonalSkill | "new" | null>(null);
  const addNew = useCallback(() => setEditing("new"), []);
  const done = useCallback(() => setEditing(null), []);
  return (
    <SettingsSection title="Skills">
      <SettingsCard testID="jarvis3-skills">
        {layer.skills.length === 0 ? (
          <SettingsRow
            label="No personal skills"
            hint="A skill teaches the agent one job, in a SKILL.md file."
          />
        ) : null}
        {layer.skills.map((skill) => (
          <SkillRow
            key={skill.name}
            skill={skill}
            onEdit={setEditing}
            onDelete={onDelete}
            suggestions={suggestions}
          />
        ))}
      </SettingsCard>
      {editing ? (
        <SkillEditor
          key={editing === "new" ? "new" : editing.name}
          skill={editing === "new" ? null : editing}
          onDone={done}
        />
      ) : (
        <View style={styles.rowButtons}>
          <Button variant="outline" size="sm" onPress={addNew} testID="jarvis3-skill-add">
            Add skill
          </Button>
        </View>
      )}
    </SettingsSection>
  );
}

function SkillRow({
  skill,
  onEdit,
  onDelete,
  suggestions,
}: {
  skill: PersonalSkill;
  onEdit: (skill: PersonalSkill) => void;
  onDelete: (pending: Pending) => void;
  suggestions: SuggestionsState | null;
}) {
  const count = Object.keys(skill.files).length;
  const target = useMemo(() => ({ kind: "skill" as const, name: skill.name }), [skill.name]);
  const edit = useCallback(() => onEdit(skill), [onEdit, skill]);
  const remove = useCallback(
    () => onDelete({ kind: "skill", name: skill.name }),
    [onDelete, skill.name],
  );
  return (
    <SettingsRow
      label={skill.name}
      hint={countOf(count, "file")}
      testID={`jarvis3-skill-${skill.name}`}
    >
      <View style={styles.inlineButtons}>
        {suggestions ? (
          <SuggestButton state={suggestions} target={target} label={`The skill "${skill.name}"`} />
        ) : null}
        <Button variant="ghost" size="sm" onPress={edit}>
          Edit
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onPress={remove}
          testID={`jarvis3-skill-delete-${skill.name}`}
        >
          Delete
        </Button>
      </View>
    </SettingsRow>
  );
}

function SkillEditor({ skill, onDone }: { skill: PersonalSkill | null; onDone: () => void }) {
  const layerState = useLayer();
  const [name, setName] = useState(skill?.name ?? "");
  const [body, setBody] = useState(skill?.files["SKILL.md"] ?? "");
  const [error, setError] = useState<string | null>(null);

  const save = useCallback(() => {
    const files = { ...skill?.files, "SKILL.md": body };
    const problem = validateSkill(name.trim(), files);
    if (problem) {
      setError(problem);
      return;
    }
    const run = async () => {
      if (await layerStore.putSkill(name.trim(), files)) onDone();
    };
    void run();
  }, [skill, body, name, onDone]);

  return (
    <View style={styles.editor} testID="jarvis3-skill-editor">
      {skill ? null : (
        <SettingsCard>
          <SettingsInput
            label="Name"
            initialValue=""
            onChangeText={setName}
            placeholder="invoices"
          />
        </SettingsCard>
      )}
      <SettingsTextAreaCard
        accessibilityLabel="SKILL.md"
        value={body}
        onChangeText={setBody}
        placeholder={
          "---\nname: invoices\ndescription: How to file a supplier invoice\n---\n\nSteps…"
        }
        testID="jarvis3-skill-body"
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.rowButtons}>
        <Button variant="ghost" size="sm" onPress={onDone}>
          Cancel
        </Button>
        <Button
          variant="default"
          size="sm"
          loading={layerState.busy}
          onPress={save}
          testID="jarvis3-skill-save"
        >
          Save skill
        </Button>
      </View>
    </View>
  );
}

function NotesSection({
  layer,
  onDelete,
  suggestions,
}: {
  layer: PersonalLayerView;
  onDelete: (pending: Pending) => void;
  suggestions: SuggestionsState | null;
}) {
  const [text, setText] = useState("");
  const [inputKey, setInputKey] = useState(0);
  const add = useCallback(() => {
    const run = async () => {
      if (await layerStore.addNote(text.trim())) {
        setText("");
        setInputKey((key) => key + 1);
      }
    };
    void run();
  }, [text]);
  return (
    <SettingsSection title="Things you asked the agent to remember">
      <SettingsCard testID="jarvis3-notes">
        {layer.notes.length === 0 ? (
          <SettingsRow label="Nothing yet" hint='Tell an agent "remember …" and it lands here.' />
        ) : null}
        {layer.notes.map((note) => (
          <NoteRow key={note.id} note={note} onDelete={onDelete} suggestions={suggestions} />
        ))}
      </SettingsCard>
      <SettingsCard>
        <SettingsInput
          key={`note-${inputKey}`}
          label="Add a note"
          initialValue=""
          onChangeText={setText}
          placeholder="My manager is Dana."
        />
      </SettingsCard>
      <View style={styles.rowButtons}>
        <Button
          variant="outline"
          size="sm"
          disabled={text.trim() === ""}
          onPress={add}
          testID="jarvis3-note-add"
        >
          Add note
        </Button>
      </View>
    </SettingsSection>
  );
}

function NoteRow({
  note,
  onDelete,
  suggestions,
}: {
  note: PersonalNote;
  onDelete: (pending: Pending) => void;
  suggestions: SuggestionsState | null;
}) {
  const remove = useCallback(() => onDelete({ kind: "note", id: note.id }), [onDelete, note.id]);
  const target = useMemo(() => ({ kind: "note" as const, noteId: note.id }), [note.id]);
  return (
    <SettingsRow
      label={note.text}
      hint={note.source === "session" ? "Saved by an agent" : "Added by you"}
      testID={`jarvis3-note-${note.id}`}
    >
      <View style={styles.inlineButtons}>
        {suggestions ? (
          <SuggestButton state={suggestions} target={target} label="This note" />
        ) : null}
        <Button variant="ghost" size="sm" onPress={remove}>
          Delete
        </Button>
      </View>
    </SettingsRow>
  );
}

function ResetSection({
  state,
  layer,
  onReset,
}: {
  state: LayerState;
  layer: PersonalLayerView;
  onReset: (pending: Pending) => void;
}) {
  const reset = useCallback(() => onReset({ kind: "reset" }), [onReset]);
  return (
    <SettingsSection title="Company default">
      <SettingsCard>
        <SettingsRow
          label="Reset to company default"
          hint="Archives your instructions, skills and notes and starts empty. You can undo it."
        >
          <Button
            variant="outline"
            size="sm"
            disabled={isLayerEmpty(layer) || state.busy}
            onPress={reset}
            testID="jarvis3-reset"
          >
            Reset
          </Button>
        </SettingsRow>
        {canUndoLayer(layer) && !state.lastReset ? (
          <SettingsRow
            label="Bring back the archived version"
            hint="Your current layer is archived first, so nothing is lost."
          >
            <Button variant="ghost" size="sm" onPress={undo} testID="jarvis3-undo-archived">
              Undo reset
            </Button>
          </SettingsRow>
        ) : null}
      </SettingsCard>
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  intro: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  rowButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: theme.spacing[2],
    marginTop: theme.spacing[2],
  },
  inlineButtons: {
    flexDirection: "row",
    gap: theme.spacing[1],
  },
  editor: {
    gap: theme.spacing[2],
    marginTop: theme.spacing[3],
  },
  error: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.sm,
    flexShrink: 1,
  },
}));
