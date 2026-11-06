"use client";
import { useState } from "react";
import { ExternalLink, LayoutTemplate, Plus, RefreshCw } from "lucide-react";
import type { Mapping, Template, Workspace } from "@/lib/types";
import { validateTemplate } from "@/lib/validation";
import { api, Badge, date, Empty, Issues, Modal, Spinner } from "./ui";
import { PageHeading, type Actions } from "./workspace";
export default function Templates({
  data,
  actions,
}: {
  data: Workspace;
  actions: Actions;
}) {
  const [register, setRegister] = useState(false),
    [selected, setSelected] = useState<string | null>(
      data.templates[0]?.id ?? null,
    ),
    [loading, setLoading] = useState(false);
  const template = data.templates.find((t) => t.id === selected);
  return (
    <>
      <PageHeading
        title="Templates"
        description="Inspect real Canva fields and map them to your book pages."
      >
        <button className="primary" onClick={() => setRegister(true)}>
          <Plus size={18} />
          Register design
        </button>
      </PageHeading>
      <div className="template-layout">
        <div className="template-list">
          {data.templates.map((t) => (
            <button
              key={t.id}
              className={`template-card ${t.id === selected ? "selected" : ""}`}
              onClick={() => setSelected(t.id)}
            >
              <div className="template-symbol">
                <LayoutTemplate size={31} strokeWidth={1} />
                <span>{t.pageCount ?? "?"}</span>
              </div>
              <h3>{t.name}</h3>
              <p>{t.id}</p>
              <Badge tone={t.checkedAt && !t.error ? "green" : "neutral"}>
                {t.checkedAt && !t.error
                  ? `${t.pageCount ?? "Unknown"} pages · Inspected`
                  : "Unverified"}
              </Badge>
            </button>
          ))}
        </div>
        {template ? (
          <section className="panel template-detail">
            <div className="section-head">
              <div>
                <h2>{template.name}</h2>
                <p>
                  {template.id}{" "}
                  {template.checkedAt &&
                    `· Inspected ${date(template.checkedAt)}`}
                </p>
              </div>
              <a
                className="icon-button"
                href={`https://www.canva.com/design/${template.id}/edit`}
                target="_blank"
                rel="noreferrer"
                aria-label="Open source design in Canva"
              >
                <ExternalLink size={18} />
              </a>
            </div>
            <div className="template-info">
              <div>
                <span>Source pages</span>
                <strong>{template.pageCount ?? "Not inspected"}</strong>
              </div>
              <div>
                <span>Autofill fields</span>
                <strong>
                  {template.dataset
                    ? Object.keys(template.dataset).length
                    : "Not inspected"}
                </strong>
              </div>
              <div>
                <span>Generation mode</span>
                <strong>New design</strong>
              </div>
            </div>
            <div className="notice">
              <LayoutTemplate size={19} />
              <span>
                The source design supplies the dimensions, guides, fonts and
                layers. Generation fills its placeholders in a new editable
                copy.
              </span>
            </div>
            <button
              className="primary"
              disabled={!data.connection.connected || loading}
              onClick={async () => {
                setLoading(true);
                await actions.run(
                  () => api(`templates/${template.id}/inspect`, "POST"),
                  "Live Canva dataset retrieved",
                );
                setLoading(false);
              }}
            >
              {loading ? <Spinner /> : <RefreshCw size={17} />}Inspect live
              dataset
            </button>
            {!data.connection.connected && (
              <p className="form-note">
                Connect Canva in Settings to retrieve this design’s real fields
                and page count.
              </p>
            )}
            {template.error && (
              <div className="notice error">{template.error}</div>
            )}
            {template.dataset ? (
              <MappingEditor
                key={`${template.id}-${template.checkedAt}`}
                template={template}
                actions={actions}
              />
            ) : (
              <Empty
                icon={LayoutTemplate}
                title="Dataset has not been retrieved"
              >
                <p>
                  Expected PAGE_01_IMAGE / PAGE_01_TEXT through page 33. These
                  fields have not been verified.
                </p>
              </Empty>
            )}
          </section>
        ) : (
          <Empty title="Register a Canva design" />
        )}
      </div>
      {register && (
        <Modal title="Register Canva design" onClose={() => setRegister(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              const result = await actions.run(
                () =>
                  api<Template>("templates", "POST", {
                    id: form.get("id"),
                    name: form.get("name"),
                  }),
                "Design registered. Inspect its live dataset next.",
              );
              if (result) {
                setSelected(result.id);
                setRegister(false);
              }
            }}
          >
            <label>
              Design name
              <input name="name" required maxLength={255} />
            </label>
            <label>
              Canva design ID
              <input
                name="id"
                required
                pattern="[A-Za-z0-9_-]{5,100}"
                placeholder="DAHaJgBbCJ4"
              />
            </label>
            <p className="form-note">
              Register the ID of a design with Autofill fields. Its actual page
              count is retrieved from Canva.
            </p>
            <div className="form-actions">
              <button type="button" onClick={() => setRegister(false)}>
                Cancel
              </button>
              <button className="primary">Register design</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
function MappingEditor({
  template,
  actions,
}: {
  template: Template;
  actions: Actions;
}) {
  const [mapping, setMapping] = useState<Mapping>(template.mapping),
    [tab, setTab] = useState("mapping");
  const result = validateTemplate({ ...template, mapping });
  return (
    <div className="mapping-editor">
      <div className="tabs">
        <button
          className={tab === "mapping" ? "active" : ""}
          onClick={() => setTab("mapping")}
        >
          Page mapping
        </button>
        <button
          className={tab === "fields" ? "active" : ""}
          onClick={() => setTab("fields")}
        >
          Dataset fields ({Object.keys(template.dataset!).length})
        </button>
        <button
          className={tab === "validation" ? "active" : ""}
          onClick={() => setTab("validation")}
        >
          Validation ({result.errors.length})
        </button>
      </div>
      {tab === "mapping" ? (
        <>
          <div className="mapping-table">
            <div className="mapping-row table-header">
              <span>PAGE</span>
              <span>IMAGE FIELD</span>
              <span>TEXT FIELD</span>
            </div>
            {mapping.map((m, i) => (
              <div className="mapping-row" key={i}>
                <strong>{String(i + 1).padStart(2, "0")}</strong>
                {(["image", "text"] as const).map((type) => (
                  <select
                    aria-label={`Page ${i + 1} ${type} field`}
                    key={type}
                    value={m[type]}
                    onChange={(e) =>
                      setMapping((rows) =>
                        rows.map((r, n) =>
                          n === i ? { ...r, [type]: e.target.value } : r,
                        ),
                      )
                    }
                  >
                    <option value="">Unassigned</option>
                    {m[type] && !template.dataset?.[m[type]] && (
                      <option value={m[type]}>{m[type]} (missing)</option>
                    )}
                    {Object.entries(template.dataset!).map(
                      ([field, definition]) => (
                        <option value={field} key={field}>
                          {field} · {definition.type}
                        </option>
                      ),
                    )}
                  </select>
                ))}
              </div>
            ))}
          </div>
          <div className="form-actions">
            <span className={result.errors.length ? "error" : "muted"}>
              {result.errors.length} mapping errors
            </span>
            <button
              className="primary"
              onClick={() =>
                void actions.run(
                  () => api(`templates/${template.id}`, "PUT", mapping),
                  "Template mapping saved",
                )
              }
            >
              Save mapping
            </button>
          </div>
        </>
      ) : tab === "fields" ? (
        <div className="dataset-fields">
          {Object.entries(template.dataset!).map(([name, definition]) => (
            <div key={name}>
              <code>{name}</code>
              <Badge>{definition.type}</Badge>
            </div>
          ))}
          {!Object.keys(template.dataset!).length && (
            <p>
              No Autofill fields. Add labels in Canva’s Bulk Create app, then
              inspect again.
            </p>
          )}
        </div>
      ) : (
        <Issues value={result} />
      )}
    </div>
  );
}
