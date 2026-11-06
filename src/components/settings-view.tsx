"use client";
import { useState } from "react";
import {
  Check,
  ExternalLink,
  HardDrive,
  Link2,
  Shield,
  Unplug,
} from "lucide-react";
import type { Preferences, Workspace } from "@/lib/types";
import { api, Badge, formatBytes, Spinner } from "./ui";
import { PageHeading, type Actions } from "./workspace";
export default function Settings({
  data,
  actions,
}: {
  data: Workspace;
  actions: Actions;
}) {
  const [preferences, setPreferences] = useState<Preferences>(data.preferences),
    [connecting, setConnecting] = useState(false);
  return (
    <>
      <PageHeading
        title="Settings"
        description="Manage your Canva connection and workspace defaults."
      />
      <div className="settings-grid">
        <section className="panel settings-section">
          <div className="section-head">
            <h2>
              <Link2 size={20} />
              Canva account
            </h2>
            <Badge tone={data.connection.connected ? "green" : "neutral"}>
              {data.connection.connected ? "Connected" : "Not connected"}
            </Badge>
          </div>
          <p>
            Connect your Canva account to inspect source designs, upload
            illustrations and generate editable drafts.
          </p>
          {!!data.connection.missing.length && (
            <div className="notice warning">
              Missing configuration: {data.connection.missing.join(", ")}. Add
              the values to .env.local and restart the application.
            </div>
          )}
          <div className="connection-details">
            <div>
              <Shield size={18} />
              <span>OAuth with PKCE. Tokens encrypted on the server.</span>
            </div>
            <div>
              <Check size={18} />
              <span>Generation creates a new design from your source.</span>
            </div>
          </div>
          <div className="form-actions">
            <button
              className="primary"
              disabled={connecting || !data.connection.configured}
              onClick={async () => {
                setConnecting(true);
                try {
                  const result = await api<{ url: string }>(
                    "canva/connect",
                    "POST",
                  );
                  window.location.assign(result.url);
                } catch (e) {
                  actions.notify((e as Error).message, true);
                  setConnecting(false);
                }
              }}
            >
              {connecting ? <Spinner /> : <Link2 size={17} />}{" "}
              {data.connection.connected ? "Reconnect Canva" : "Connect Canva"}
            </button>
            {data.connection.connected && (
              <button
                onClick={() => {
                  if (
                    window.confirm(
                      "Disconnect Canva and revoke this app’s access?",
                    )
                  )
                    void actions.run(
                      () => api("canva/disconnect", "POST"),
                      "Canva disconnected and consent revoked",
                    );
                }}
              >
                <Unplug size={16} />
                Disconnect
              </button>
            )}
          </div>
          <a
            className="text-link"
            href="https://www.canva.com/developers/"
            target="_blank"
            rel="noreferrer"
          >
            Canva Developer Portal
            <ExternalLink size={14} />
          </a>
        </section>
        <section className="panel settings-section">
          <div className="section-head">
            <h2>
              <HardDrive size={20} />
              Local storage
            </h2>
            <Badge>SQLite</Badge>
          </div>
          <div className="publish-summary">
            <span>Disk usage</span>
            <strong>{formatBytes(data.storage.bytes)}</strong>
            <span>Illustrations</span>
            <strong>{data.storage.assets}</strong>
            <span>Books</span>
            <strong>{data.books.length}</strong>
            <span>Storage location</span>
            <code>data/</code>
          </div>
          <p className="form-note">
            Books, images, tokens and publishing history persist on this device.
            Back up the data folder with the app stopped. Keep the same
            SESSION_SECRET to decrypt a restored connection.
          </p>
          <div className="notice">
            <Shield size={18} />
            <span>
              Single-owner local mode. The server binds to 127.0.0.1; API access
              is restricted to the configured local origin.
            </span>
          </div>
        </section>
      </div>
      <form
        className="panel settings-section preferences-form"
        onSubmit={(e) => {
          e.preventDefault();
          void actions.run(
            () => api("settings", "PUT", preferences),
            "Workspace preferences saved",
          );
        }}
      >
        <div className="section-head">
          <h2>Application preferences</h2>
        </div>
        <div className="preferences-grid">
          <div>
            <h3>Book dimensions</h3>
            <p className="form-note">Defaults for new books, in inches.</p>
            <div className="field-row">
              {(["width", "height", "margin"] as const).map((field) => (
                <label key={field}>
                  {field}
                  <input
                    required
                    type="number"
                    step="0.001"
                    min={field === "margin" ? 0 : 1}
                    max={field === "margin" ? 2 : 30}
                    value={preferences[field]}
                    onChange={(e) =>
                      setPreferences({
                        ...preferences,
                        [field]: Number(e.target.value),
                      })
                    }
                  />
                </label>
              ))}
            </div>
            <label>
              Typeface
              <input
                required
                maxLength={100}
                value={preferences.font}
                onChange={(e) =>
                  setPreferences({ ...preferences, font: e.target.value })
                }
              />
            </label>
          </div>
          <div>
            <h3>Publishing & appearance</h3>
            <label>
              Print resolution target (DPI)
              <input
                required
                type="number"
                min={72}
                max={600}
                value={preferences.dpi}
                onChange={(e) =>
                  setPreferences({
                    ...preferences,
                    dpi: Number(e.target.value),
                  })
                }
              />
            </label>
            <label>
              Preferred finishing export
              <select
                value={preferences.exportFormat}
                onChange={(e) =>
                  setPreferences({
                    ...preferences,
                    exportFormat: e.target.value as Preferences["exportFormat"],
                  })
                }
              >
                <option value="pdf_print">PDF Print</option>
                <option value="png">PNG</option>
              </select>
            </label>
            <p className="form-note">
              Preference for manual export in Canva. This build generates
              editable designs.
            </p>
            <label>
              Theme
              <select
                value={preferences.theme}
                onChange={(e) =>
                  setPreferences({
                    ...preferences,
                    theme: e.target.value as Preferences["theme"],
                  })
                }
              >
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
          </div>
        </div>
        <div className="form-actions">
          <button type="submit" className="primary">
            Save preferences
          </button>
        </div>
      </form>
    </>
  );
}
