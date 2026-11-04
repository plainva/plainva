import { useEffect, useState } from "react";
import { readTasksPluginSettings, type TaskRecord, type TasksPluginSettings } from "@plainva/core";

/**
 * One load of the vault's tasks per index state, shared by every Tasks query
 * block on screen (plan Tasks-Abfragen, E3): `listTasks()` reads the text of
 * every note, so ten blocks in three open notes must not read it thirty times.
 *
 * The owner is the shell's query service (one per open vault); the key is its
 * index state — the desktop's `fileTreeVersion`, the phone's `bump`. A block
 * keeps the tasks it has while the next state loads, so it never flashes empty.
 */

interface Load<T> {
  key: string;
  promise: Promise<T>;
}

const taskLoads = new WeakMap<object, Load<TaskRecord[]>>();
const settingLoads = new WeakMap<object, Load<TasksPluginSettings | null>>();

function shared<T>(cache: WeakMap<object, Load<T>>, owner: object, key: string, load: () => Promise<T>): Promise<T> {
  const known = cache.get(owner);
  if (known && known.key === key) return known.promise;
  const promise = load();
  cache.set(owner, { key, promise });
  // A failed load is not kept: the next block (or the next state) tries again.
  promise.catch(() => {
    if (cache.get(owner)?.promise === promise) cache.delete(owner);
  });
  return promise;
}

/** The tasks of the vault for `key`, loaded once for all blocks of `owner`. */
export function loadTasksForQueries(owner: object, key: string, load: () => Promise<TaskRecord[]>): Promise<TaskRecord[]> {
  return shared(taskLoads, owner, key, load);
}

/** The path of the Tasks plugin's settings in an Obsidian vault. */
export const TASKS_PLUGIN_SETTINGS_PATH = ".obsidian/plugins/obsidian-tasks-plugin/data.json";

/**
 * The Tasks plugin's settings, once per `key` — only to NAME a global filter or
 * query in the explanation (E12); Plainva applies neither. `read` answers the
 * file's text, or null when there is none.
 */
export function loadTasksPluginSettings(owner: object, key: string, read: () => Promise<string | null>): Promise<TasksPluginSettings | null> {
  return shared(settingLoads, owner, key, async () => {
    const text = await read().catch(() => null);
    return text === null ? null : readTasksPluginSettings(text);
  });
}

export interface TasksForQueries {
  /** Null until the first load of this owner answered. */
  tasks: readonly TaskRecord[] | null;
  failed: boolean;
}

/** The shared load as React state; keeps the last tasks while the next key loads. */
export function useTasksForQueries(owner: object | null | undefined, key: string, load: (() => Promise<TaskRecord[]>) | null): TasksForQueries {
  const [state, setState] = useState<TasksForQueries>({ tasks: null, failed: false });
  useEffect(() => {
    if (!owner || !load) return;
    let alive = true;
    loadTasksForQueries(owner, key, load).then(
      (tasks) => {
        if (alive) setState({ tasks, failed: false });
      },
      () => {
        if (alive) setState((was) => ({ tasks: was.tasks, failed: was.tasks === null }));
      },
    );
    return () => {
      alive = false;
    };
    // `load` is read once per key; a new function for the same key changes nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, key]);
  return state;
}

/** The plugin settings as React state; null while loading and where there are none. */
export function useTasksPluginSettings(owner: object | null | undefined, key: string, read: (() => Promise<string | null>) | null): TasksPluginSettings | null {
  const [settings, setSettings] = useState<TasksPluginSettings | null>(null);
  useEffect(() => {
    if (!owner || !read) return;
    let alive = true;
    void loadTasksPluginSettings(owner, key, read).then((value) => {
      if (alive) setSettings(value);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, key]);
  return settings;
}
