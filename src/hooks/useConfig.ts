import { useEffect, useState, useCallback } from 'react';
import type { Config } from '../api/types';
import { loadConfig, saveConfig } from '../api/ipc';

const DEFAULT_CONFIG: Config = {
  llm: {
    providers: [],
    default_text_id: '',
    default_vision_id: '',
    default_local_vision_id: '',
    use_local_vision: false,
  },
  screenshot: {
    enabled: true,
    interval_seconds: 30,
    keep_after_analysis: false,
    output_dir: '',
    auto_start: false,
    monitor_index: 0,
    idle_skip_seconds: 120,
    dedup_screenshots: true,
  },
  report: {
    default_template: 'standard',
    language: 'zh-CN',
    user_name: '',
    team: '',
    custom_instructions: '',
  },
  profile: {
    display_name: '',
    aliases: '',
    role: '',
    org: '',
    projects: '',
    responsibilities: '',
    collaborators: '',
    extra: '',
  },
  app: {
    auto_launch_on_boot: false,
    silent_launch: false,
    cleanup_keep_days: 90,
  },
  todo: {
    hotkey: 'Alt+Space',
  },
  nas: {
    enabled: false,
    base_url: '',
    token: '',
    device_id: '',
    device_name: '',
    sync_images: true,
    sync_interval_seconds: 30,
  },
  git: {
    enabled: false,
    repos: [],
    author_emails: [],
    author_names: [],
    poll_interval_seconds: 600,
  },
  shortcuts: {
    local_llm_toggle: 'Ctrl+Alt+L',
  },
  db_path: '',
};

export function useConfig() {
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const cfg = await loadConfig();
      setConfig(cfg);
    } catch (e: any) {
      setError(String(e));
      setConfig(DEFAULT_CONFIG);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = useCallback(async (cfg: Config) => {
    setSaving(true);
    setError(null);
    try {
      await saveConfig(cfg);
      setConfig(cfg);
    } catch (e: any) {
      setError(String(e));
      throw e;
    } finally {
      setSaving(false);
    }
  }, []);

  return { config, setConfig, loading, saving, error, reload, save };
}
