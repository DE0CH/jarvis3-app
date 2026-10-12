// Projects (from the sidebar): the person's own Projects and the shared ones their role may use.
// A Project gives a chat git repos (cloned side by side into its workspace) and secrets (in the
// agent's environment); it is picked in the new chat's composer.
import { useCallback, useEffect, useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { StyleSheet } from "react-native-unistyles";
import { SettingsCard } from "@/components/settings";
import { Button } from "@/components/ui/button";
import type { ProjectView } from "../api-types";
import { projectsStore } from "../client";
import { useAccount, useProjects } from "../hooks";
import { projectSummary } from "../projects";
import { Banner, EmptyState, Jarvis3Frame } from "../ui";

export function ProjectsScreen() {
  const router = useRouter();
  const enabled = useAccount().me?.features?.projects === true;
  const projects = useProjects();
  useEffect(() => {
    if (enabled) void projectsStore.load();
  }, [enabled]);
  const create = useCallback(() => router.push("/projects/new" as Href), [router]);
  const actions = useMemo(
    () =>
      enabled ? (
        <Button variant="default" size="sm" onPress={create} testID="jarvis3-new-project">
          New Project
        </Button>
      ) : null,
    [enabled, create],
  );
  const own = projects.projects.filter((p) => !p.shared);
  const shared = projects.projects.filter((p) => p.shared);
  return (
    <Jarvis3Frame title="Projects" actions={actions} testID="jarvis3-projects-screen">
      {!enabled ? <EmptyState title="This instance has no Projects." /> : null}
      {projects.error ? <Banner tone="error">{projects.error}</Banner> : null}
      {enabled && !projects.loaded ? <EmptyState title="Loading…" /> : null}
      {enabled && projects.loaded && projects.projects.length === 0 ? (
        <EmptyState
          title="No Projects yet"
          hint="A Project gives a chat git repos and secrets. Pick it when you start a chat."
        />
      ) : null}
      {own.length ? <ProjectGroup title="Yours" projects={own} /> : null}
      {shared.length ? <ProjectGroup title="Shared" projects={shared} /> : null}
    </Jarvis3Frame>
  );
}

function ProjectGroup({ title, projects }: { title: string; projects: ProjectView[] }) {
  return (
    <View style={styles.group}>
      <Text style={styles.heading} accessibilityRole="header">
        {title}
      </Text>
      <SettingsCard>
        {projects.map((project) => (
          <ProjectRow key={project.id} project={project} />
        ))}
      </SettingsCard>
    </View>
  );
}

function ProjectRow({ project }: { project: ProjectView }) {
  const router = useRouter();
  const open = useCallback(
    () => router.push(`/projects/${encodeURIComponent(project.id)}` as Href),
    [router, project.id],
  );
  return (
    <Pressable
      onPress={open}
      style={rowStyle}
      accessibilityRole="link"
      testID={`jarvis3-project-${project.id}`}
    >
      <Text style={styles.name}>{project.name}</Text>
      {project.description ? (
        <Text style={styles.meta} numberOfLines={2}>
          {project.description}
        </Text>
      ) : null}
      <Text style={styles.meta}>{projectSummary(project)}</Text>
    </Pressable>
  );
}

function rowStyle({ pressed }: { pressed: boolean }) {
  return [styles.row, pressed && styles.pressed];
}

const styles = StyleSheet.create((theme) => ({
  group: {
    gap: theme.spacing[2],
  },
  heading: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    marginLeft: theme.spacing[1],
  },
  row: {
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
  },
  pressed: {
    backgroundColor: theme.colors.interactionHighlight,
  },
  name: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  meta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
