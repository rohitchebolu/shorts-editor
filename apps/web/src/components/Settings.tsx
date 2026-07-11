import { useState } from "react";
import { saveConfig, testConfig, type Provider, type ProviderConfig } from "../api";

const MODEL_HINTS: Record<Provider, string> = {
  google: "e.g. gemini-2.0-flash  ·  gemini-1.5-pro",
  groq: "e.g. llama-3.3-70b-versatile  ·  llama-3.1-8b-instant",
};

export default function Settings({
  config,
  onSaved,
}: {
  config: ProviderConfig;
  onSaved: (c: ProviderConfig) => void;
}) {
  const [provider, setProvider] = useState<Provider>(config.provider ?? "google");
  const [model, setModel] = useState(config.model || "");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const c = await saveConfig({ provider, model, apiKey: apiKey || undefined });
      setApiKey("");
      onSaved(c);
      setMsg({ kind: "ok", text: "Saved." });
    } catch (e: any) {
      setMsg({ kind: "err", text: e.message });
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setMsg(null);
    try {
      // persist current values first so the test uses them
      await saveConfig({ provider, model, apiKey: apiKey || undefined });
      setApiKey("");
      const r = await testConfig();
      setMsg(
        r.ok
          ? { kind: "ok", text: "Connected — provider & model work." }
          : { kind: "err", text: r.error || "Test failed." }
      );
      onSaved(await (await fetch("/api/config")).json());
    } catch (e: any) {
      setMsg({ kind: "err", text: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h2>
        LLM Provider{" "}
        {config.provider ? (
          <span className={`pill ${config.hasKey ? "ok" : "warn"}`}>
            {config.provider === "google" ? "Gemini" : "Groq"} · {config.model || "no model"} ·{" "}
            {config.hasKey ? "key set" : "no key"}
          </span>
        ) : (
          <span className="pill warn">not configured</span>
        )}
      </h2>
      <div className="row">
        <div className="field" style={{ maxWidth: 180 }}>
          <label>Provider</label>
          <select value={provider} onChange={(e) => setProvider(e.target.value as Provider)}>
            <option value="google">Gemini (Google)</option>
            <option value="groq">Groq</option>
          </select>
        </div>
        <div className="field">
          <label>Model name</label>
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={MODEL_HINTS[provider]}
          />
        </div>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <div className="field grow">
          <label>API key {config.hasKey ? "(leave blank to keep current)" : ""}</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={config.hasKey ? "•••••••• (stored)" : "paste your key"}
          />
        </div>
        <button className="ghost" onClick={test} disabled={busy || !model}>
          Test
        </button>
        <button onClick={save} disabled={busy || !model}>
          Save
        </button>
      </div>
      {msg && (
        <p style={{ marginBottom: 0 }} className={msg.kind === "ok" ? "" : "err"}>
          {msg.text}
        </p>
      )}
      <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
        The key is stored locally on the server ({`.data/config.json`}) and never sent back to the browser.
      </p>
    </div>
  );
}
