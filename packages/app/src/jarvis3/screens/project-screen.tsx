// A Project's page (new, or edit): name, description, repos (https address, optional branch, and
// for a private repo which secret holds its token), secrets (write-only: a stored value is never
// shown, typing replaces it), and for an admin's new Project, Shared with roles. Someone who may
// use a shared Project but not edit it sees it read-only.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { StyleSheet } from "react-native-unistyles";
import { SettingsCard, SettingsSection } from "@/components/settings";
import { SettingsTextAreaCard } from "@/components/settings-textarea";
import { Button } from "@/components/ui/button";
import { FormTextInput } from "@/components/ui/form-field";
import { Switch } from "@/components/ui/switch";
import type { ProjectView } from "../api-types";
import { jarvis3Api, projectsStore } from "../client";
import { useAccount, useProjects } from "../hooks";
import {
  checkDraft,
  createRequest,
  draftFromProject,
  emptyDraft,
  keptKeys,
  type ProjectDraft,
  REPOS_MAX,
  repoFolder,
  SECRETS_MAX,
  updateRequest,
} from "../projects";
import { messageOf } from "../stores";
import { Banner, CenteredDialog, EmptyState, Jarvis3Frame } from "../ui";

/** Draft rows carry a local key so inputs keep their identity when a row above is removed. */
type Keyed<T> = T & { rowKey: number };

export function ProjectScreen({ projectId }: { projectId: string | null }) {
  const projects = useProjects();
  const [project, setProject] = useState<ProjectView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const onSaved = useCallback((next: ProjectView) => {
    setProject(next);
    setSaved(true);
  }, []);
  useEffect(() => {
    if (!projectId) return;
    jarvis3Api
      .getProject(projectId)
      .then(setProject)
      .catch((e: unknown) => setLoadError(messageOf(e)));
  }, [projectId]);
  useEffect(() => {
    void projectsStore.load();
  }, []);
  if (projectId && !project) {
    return (
      <Jarvis3Frame title="Project">
        {loadError ? <EmptyState title={loadError} /> : <EmptyState title="Loading…" />}
      </Jarvis3Frame>
    );
  }
  return (
    <ProjectForm
      key={project?.updatedAt ?? "new"}
      project={project}
      roles={projects.roles}
      saved={saved}
      onSaved={onSaved}
    />
  );
}

type RepoRow = Keyed<ProjectDraft["repos"][number]>;
type SecretRow = Keyed<ProjectDraft["secrets"][number]>;

/** A list of form rows with stable callbacks: add, change one by index, remove one by index. */
function useRows<T extends { rowKey: number }>(initial: () => T[]) {
  const [rows, setRows] = useState<T[]>(initial);
  const change = useCallback(
    (index: number, patch: Partial<T>) =>
      setRows((list) => list.map((row, i) => (i === index ? { ...row, ...patch } : row))),
    [],
  );
  const remove = useCallback(
    (index: number) => setRows((list) => list.filter((_, i) => i !== index)),
    [],
  );
  const add = useCallback((row: T) => setRows((list) => [...list, row]), []);
  return { rows, change, remove, add };
}

let nextRowKey = 1;
const rowKey = () => nextRowKey++;

/** Save (create, or only the changes) and Delete. */
function useProjectActions(
  project: ProjectView | null,
  draft: ProjectDraft,
  onSaved: (project: ProjectView) => void,
) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const save = useCallback(() => {
    const current = draftRef.current;
    const problem = checkDraft(current);
    if (problem) {
      setError(problem);
      return;
    }
    const run = async () => {
      setSaving(true);
      setError(null);
      try {
        if (project) {
          const next = await jarvis3Api.updateProject(project.id, updateRequest(current, project));
          projectsStore.put(next);
          onSaved(next);
        } else {
          const created = await jarvis3Api.createProject(createRequest(current));
          projectsStore.put(created);
          router.replace(`/projects/${encodeURIComponent(created.id)}` as Href);
        }
      } catch (e) {
        setError(messageOf(e));
      } finally {
        setSaving(false);
      }
    };
    void run();
  }, [project, router, onSaved]);
  const remove = useCallback(() => {
    if (!project) return;
    const run = async () => {
      setSaving(true);
      try {
        await jarvis3Api.deleteProject(project.id);
        projectsStore.drop(project.id);
        router.replace("/projects" as Href);
      } catch (e) {
        setError(messageOf(e));
      } finally {
        setSaving(false);
      }
    };
    void run();
  }, [project, router]);
  return { save, remove, saving, error };
}

function ProjectForm({
  project,
  roles,
  saved,
  onSaved,
}: {
  project: ProjectView | null;
  roles: string[];
  saved: boolean;
  onSaved: (project: ProjectView) => void;
}) {
  const me = useAccount().me;
  const isAdmin = me?.user.isAdmin === true;
  const editable = project ? project.canEdit : true;
  const initial = useMemo(() => (project ? draftFromProject(project) : emptyDraft()), [project]);
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [shared, setShared] = useState(initial.shared);
  const [pickedRoles, setPickedRoles] = useState<string[]>(initial.roles);
  const repos = useRows<RepoRow>(() =>
    initial.repos.map((repo) => Object.assign({ rowKey: rowKey() }, repo)),
  );
  const secrets = useRows<SecretRow>(() =>
    initial.secrets.map((secret) => Object.assign({ rowKey: rowKey() }, secret)),
  );
  const [deleting, setDeleting] = useState(false);
  const draft: ProjectDraft = {
    name,
    description,
    shared,
    roles: pickedRoles,
    repos: repos.rows,
    secrets: secrets.rows,
  };
  const tokenKeys = keptKeys(draft);
  const actions = useProjectActions(project, draft, onSaved);

  const addRepo = useCallback(
    () => repos.add({ url: "", ref: "", tokenSecret: "", rowKey: rowKey() }),
    [repos],
  );
  const addSecret = useCallback(
    () => secrets.add({ key: "", value: "", stored: false, removed: false, rowKey: rowKey() }),
    [secrets],
  );
  const toggleRole = useCallback(
    (role: string) =>
      setPickedRoles((list) =>
        list.includes(role) ? list.filter((r) => r !== role) : [...list, role],
      ),
    [],
  );
  const askDelete = useCallback(() => setDeleting(true), []);
  const cancelDelete = useCallback(() => setDeleting(false), []);
  const headerActions = useMemo(
    () =>
      project && editable ? (
        <Button variant="ghost" size="sm" onPress={askDelete} testID="jarvis3-project-delete">
          Delete
        </Button>
      ) : null,
    [project, editable, askDelete],
  );

  return (
    <Jarvis3Frame
      title={project ? project.name : "New Project"}
      actions={headerActions}
      testID="jarvis3-project-screen"
    >
      {editable ? null : (
        <Banner tone="info">
          An admin manages this shared Project. You can use it in your chats.
        </Banner>
      )}
      <SettingsSection title="Project">
        <SettingsCard>
          <View style={styles.block}>
            <Text style={styles.label}>Name</Text>
            <FormTextInput
              initialValue={name}
              onChangeText={setName}
              editable={editable}
              placeholder="Website"
              accessibilityLabel="Name"
              testID="jarvis3-project-name"
            />
          </View>
        </SettingsCard>
        <SettingsTextAreaCard
          accessibilityLabel="Description"
          value={description}
          onChangeText={setDescription}
          placeholder="What it's for (optional)"
          testID="jarvis3-project-description"
        />
      </SettingsSection>

      <SettingsSection title="Repos">
        {repos.rows.length ? (
          <SettingsCard testID="jarvis3-project-repos">
            {repos.rows.map((repo, index) => (
              <RepoEditor
                key={repo.rowKey}
                repo={repo}
                index={index}
                editable={editable}
                tokenKeys={tokenKeys}
                onChange={repos.change}
                onRemove={repos.remove}
              />
            ))}
          </SettingsCard>
        ) : (
          <Text style={styles.hint}>
            No repos yet. Each one is cloned into the chat&apos;s workspace.
          </Text>
        )}
        {editable && repos.rows.length < REPOS_MAX ? (
          <View style={styles.add}>
            <Button variant="outline" size="sm" onPress={addRepo} testID="jarvis3-repo-add">
              Add repo
            </Button>
          </View>
        ) : null}
      </SettingsSection>

      <SettingsSection title="Secrets">
        {secrets.rows.length ? (
          <SettingsCard testID="jarvis3-project-secrets">
            {secrets.rows.map((secret, index) => (
              <SecretEditor
                key={secret.rowKey}
                secret={secret}
                index={index}
                editable={editable}
                onChange={secrets.change}
                onRemove={secrets.remove}
              />
            ))}
          </SettingsCard>
        ) : (
          <Text style={styles.hint}>
            No secrets yet. They reach only this Project&apos;s chats, as environment variables;
            nobody can read a value back.
          </Text>
        )}
        {editable && secrets.rows.length < SECRETS_MAX ? (
          <View style={styles.add}>
            <Button variant="outline" size="sm" onPress={addSecret} testID="jarvis3-secret-add">
              Add secret
            </Button>
          </View>
        ) : null}
      </SettingsSection>

      {isAdmin && (!project || project.shared) ? (
        <Sharing
          shared={shared}
          canSwitch={!project}
          roles={roles}
          picked={pickedRoles}
          editable={editable}
          onShared={setShared}
          onToggleRole={toggleRole}
        />
      ) : null}

      {actions.error ? (
        <Banner tone="error" testID="jarvis3-project-error">
          {actions.error}
        </Banner>
      ) : null}
      {saved ? (
        <Banner tone="ok" testID="jarvis3-project-saved">
          Saved. New chats with this Project get the change.
        </Banner>
      ) : null}
      {editable ? (
        <View style={styles.buttons}>
          <Button
            variant="default"
            onPress={actions.save}
            loading={actions.saving}
            testID="jarvis3-project-save"
          >
            {project ? "Save" : "Create Project"}
          </Button>
        </View>
      ) : null}
      <CenteredDialog
        visible={deleting}
        title="Delete this Project?"
        message="Chats that use it keep running; when they next start they no longer get its repos or secrets."
        confirmLabel="Delete"
        destructive
        busy={actions.saving}
        onConfirm={actions.remove}
        onCancel={cancelDelete}
        testID="jarvis3-project-delete-dialog"
      />
    </Jarvis3Frame>
  );
}

function RepoEditor({
  repo,
  index,
  editable,
  tokenKeys,
  onChange,
  onRemove,
}: {
  repo: RepoRow;
  index: number;
  editable: boolean;
  tokenKeys: string[];
  onChange: (index: number, patch: Partial<RepoRow>) => void;
  onRemove: (index: number) => void;
}) {
  const setUrl = useCallback((url: string) => onChange(index, { url }), [onChange, index]);
  const setRef = useCallback((ref: string) => onChange(index, { ref }), [onChange, index]);
  const setToken = useCallback(
    (tokenSecret: string) => onChange(index, { tokenSecret }),
    [onChange, index],
  );
  const remove = useCallback(() => onRemove(index), [onRemove, index]);
  const choices = useMemo(() => ["", ...tokenKeys], [tokenKeys]);
  return (
    <View style={styles.block}>
      <FormTextInput
        initialValue={repo.url}
        onChangeText={setUrl}
        editable={editable}
        placeholder="https://github.com/org/repo.git"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        accessibilityLabel="Repo address"
        testID={`jarvis3-repo-url-${index}`}
      />
      <View style={styles.inline}>
        <View style={styles.grow}>
          <FormTextInput
            initialValue={repo.ref}
            onChangeText={setRef}
            editable={editable}
            placeholder="Branch (default)"
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Branch or tag"
            size="sm"
            testID={`jarvis3-repo-ref-${index}`}
          />
        </View>
        {editable ? (
          <Button
            variant="ghost"
            size="sm"
            onPress={remove}
            testID={`jarvis3-repo-remove-${index}`}
          >
            Remove
          </Button>
        ) : null}
      </View>
      <Text
        style={styles.hint}
      >{`In the chat: ~/workspace/${repoFolder(repo.url || "repo")}`}</Text>
      {tokenKeys.length || repo.tokenSecret ? (
        <View style={styles.options}>
          <Text style={styles.hint}>Token for a private repo:</Text>
          {choices.map((key) => (
            <Option
              key={key || "none"}
              value={key}
              label={key || "None (public)"}
              selected={repo.tokenSecret === key}
              disabled={!editable}
              onPick={setToken}
              testID={`jarvis3-repo-token-${index}-${key || "none"}`}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function SecretEditor({
  secret,
  index,
  editable,
  onChange,
  onRemove,
}: {
  secret: SecretRow;
  index: number;
  editable: boolean;
  onChange: (index: number, patch: Partial<SecretRow>) => void;
  onRemove: (index: number) => void;
}) {
  const setKey = useCallback(
    (key: string) => onChange(index, { key: key.toUpperCase() }),
    [onChange, index],
  );
  const setValue = useCallback((value: string) => onChange(index, { value }), [onChange, index]);
  const toggleRemoved = useCallback(() => {
    if (secret.stored) onChange(index, { removed: !secret.removed });
    else onRemove(index);
  }, [secret.stored, secret.removed, onChange, onRemove, index]);
  return (
    <View style={[styles.block, secret.removed && styles.removed]}>
      <View style={styles.inline}>
        <View style={styles.grow}>
          {secret.stored ? (
            <Text style={styles.key} testID={`jarvis3-secret-key-${index}`}>
              {secret.key}
            </Text>
          ) : (
            <FormTextInput
              initialValue={secret.key}
              onChangeText={setKey}
              placeholder="NAME"
              autoCapitalize="characters"
              autoCorrect={false}
              accessibilityLabel="Secret name"
              size="sm"
              testID={`jarvis3-secret-key-${index}`}
            />
          )}
        </View>
        {editable ? (
          <Button
            variant="ghost"
            size="sm"
            onPress={toggleRemoved}
            testID={`jarvis3-secret-remove-${index}`}
          >
            {secret.removed ? "Keep" : "Remove"}
          </Button>
        ) : null}
      </View>
      {editable && !secret.removed ? (
        <FormTextInput
          initialValue=""
          onChangeText={setValue}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={secret.stored ? "Stored — type to replace" : "Value"}
          accessibilityLabel={`Value of ${secret.key || "the secret"}`}
          size="sm"
          testID={`jarvis3-secret-value-${index}`}
        />
      ) : null}
      {secret.stored && !editable ? <Text style={styles.hint}>Stored</Text> : null}
    </View>
  );
}

function Sharing({
  shared,
  canSwitch,
  roles,
  picked,
  editable,
  onShared,
  onToggleRole,
}: {
  shared: boolean;
  canSwitch: boolean;
  roles: string[];
  picked: string[];
  editable: boolean;
  onShared: (shared: boolean) => void;
  onToggleRole: (role: string) => void;
}) {
  return (
    <SettingsSection title="Sharing">
      <SettingsCard>
        <View style={[styles.block, styles.inline]}>
          <Text style={[styles.grow, styles.label]}>Shared with roles</Text>
          <Switch
            value={shared}
            onValueChange={onShared}
            disabled={!canSwitch}
            accessibilityLabel="Shared with roles"
            testID="jarvis3-project-shared"
          />
        </View>
        {shared ? (
          <View style={[styles.block, styles.options]}>
            {roles.map((role) => (
              <Option
                key={role}
                value={role}
                label={role}
                selected={picked.includes(role)}
                disabled={!editable}
                onPick={onToggleRole}
                testID={`jarvis3-project-role-${role}`}
              />
            ))}
          </View>
        ) : null}
      </SettingsCard>
    </SettingsSection>
  );
}

function Option({
  value,
  label,
  selected,
  disabled,
  onPick,
  testID,
}: {
  value: string;
  label: string;
  selected: boolean;
  disabled?: boolean;
  onPick: (value: string) => void;
  testID?: string;
}) {
  const press = useCallback(() => onPick(value), [onPick, value]);
  const state = useMemo(() => ({ checked: selected, disabled: !!disabled }), [selected, disabled]);
  return (
    <Pressable
      onPress={press}
      disabled={disabled}
      style={[styles.option, selected && styles.optionSelected]}
      accessibilityRole="checkbox"
      accessibilityState={state}
      testID={testID}
    >
      <Text style={selected ? styles.optionTextSelected : styles.optionText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  block: {
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
  },
  removed: {
    opacity: theme.opacity[50],
  },
  inline: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  grow: {
    flex: 1,
  },
  label: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  key: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontFamily: theme.fontFamily.mono,
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  options: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  option: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  optionSelected: {
    backgroundColor: theme.colors.surface3,
    borderColor: theme.colors.borderAccent,
  },
  optionText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  optionTextSelected: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  add: {
    flexDirection: "row",
    marginTop: theme.spacing[2],
  },
  buttons: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
}));
