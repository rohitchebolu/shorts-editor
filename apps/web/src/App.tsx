import { useEffect, useState } from "react";
import Settings from "./components/Settings";
import JobRunner from "./components/JobRunner";
import { getConfig, type ProviderConfig } from "./api";

export default function App() {
  const [config, setConfig] = useState<ProviderConfig | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    getConfig()
      .then((c) => {
        setConfig(c);
        if (!c.provider || !c.hasKey) setShowSettings(true);
      })
      .catch(() => setConfig({ provider: null, model: "", hasKey: false }));
  }, []);

  if (!config) return <div className="app muted">Loading…</div>;

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>Shorts Editor</h1>
          <div className="sub">YouTube URL → auto-clipped vertical short · powered by Gemini / Groq</div>
        </div>
        <button className="ghost" onClick={() => setShowSettings((s) => !s)}>
          {showSettings ? "Hide settings" : "Settings"}
        </button>
      </header>

      {!config.hasKey && !showSettings && (
        <div className="banner">
          No LLM provider configured — <a onClick={() => setShowSettings(true)}>open settings</a> to add Gemini or Groq.
        </div>
      )}

      {showSettings && <Settings config={config} onSaved={setConfig} />}

      <JobRunner config={config} />
    </div>
  );
}
